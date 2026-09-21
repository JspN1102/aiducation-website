"""Offline release checks; these tests never connect to or restart a server."""
from pathlib import Path
import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.spec_from_file_location('maanshan_update', Path(__file__).with_name('update.py'))
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)


class CurrentReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.release = Path(self.temporary.name) / 'current'
        self.page = b'<!doctype html><title>Mandarin</title>'
        self.file = self.release / 'public/maanshan/index.html'
        self.file.parent.mkdir(parents=True)
        self.file.write_bytes(self.page)
        self.manifest = [{'path': 'public/maanshan/index.html', 'sha256': hashlib.sha256(self.page).hexdigest()}]
        self.metadata = self.release / 'release-manifest.json'
        self.metadata.write_text(json.dumps({'commit': 'test-commit', 'manifest': self.manifest}), encoding='utf-8')
        self.process_directory = self.release
        self.pid = b'123\n'
        self.health = b'{"ok":true}'
        self.served_page = self.page
        self.compressed = b'{"verified":true}'

    def external(self, command, **_kwargs):
        if command[0] == 'systemctl':
            return self.pid
        if command[0] == 'readlink':
            return str(self.process_directory).encode()
        if command[0] == 'curl' and command[-1].endswith('/api/health'):
            return self.health
        if command[0] == 'curl':
            return self.served_page
        if command[0] == 'python3' and '--verify' in command:
            return self.compressed
        self.fail('Unexpected external command')

    def inspect(self, release=None):
        source = update.current_release_probe('test-commit', self.manifest)
        source = source.replace("Path('/srv/maanshan/current')", 'Path(' + repr(str(release or self.release)) + ')')
        output = io.StringIO()
        with patch.object(update.subprocess, 'check_output', side_effect=self.external), contextlib.redirect_stdout(output):
            try:
                exec(compile(source, '<release-probe>', 'exec'), {})
            except SystemExit as error:
                self.assertEqual(error.code, 0)
        return json.loads(output.getvalue())

    def test_healthy_same_release_requires_matching_files_and_served_page(self):
        self.assertTrue(self.inspect()['matches'])

    def test_different_commit_requires_deployment(self):
        self.metadata.write_text(json.dumps({'commit': 'previous-commit', 'manifest': self.manifest}))
        self.assertFalse(self.inspect()['matches'])

    def test_corrupt_or_missing_file_is_repaired_not_skipped(self):
        self.file.write_bytes(b'changed-after-deployment')
        self.assertFalse(self.inspect()['matches'])
        self.file.unlink()
        self.assertFalse(self.inspect()['matches'])

    def test_stopped_service_or_previous_release_process_cannot_skip(self):
        self.pid = b'0\n'
        self.assertFalse(self.inspect()['matches'])
        self.pid = b'123\n'
        self.process_directory = self.release.parent / 'previous'
        self.assertFalse(self.inspect()['matches'])

    def test_wrong_public_page_or_invalid_health_cannot_skip(self):
        self.served_page = b'<title>Old deployment</title>'
        self.assertFalse(self.inspect()['matches'])
        self.served_page = self.page
        self.health = b'not json'
        self.assertFalse(self.inspect()['matches'])
        self.health = b'[]'
        self.assertFalse(self.inspect()['matches'])

    def test_missing_or_corrupted_generated_gzip_requires_repair(self):
        self.compressed = b'{"verified":false}'
        self.assertFalse(self.inspect()['matches'])
        self.compressed = b'not json'
        self.assertFalse(self.inspect()['matches'])

    def test_bad_or_missing_metadata_is_not_treated_as_an_empty_server(self):
        self.metadata.write_text('not json')
        with self.assertRaises(json.JSONDecodeError):
            self.inspect()
        self.metadata.unlink()
        with self.assertRaises(FileNotFoundError):
            self.inspect()

    def test_metadata_permission_error_stops_before_deploying(self):
        with patch.object(Path, 'read_text', side_effect=PermissionError('denied')):
            with self.assertRaises(PermissionError):
                self.inspect()

    def test_duplicate_manifest_entries_are_rejected(self):
        self.metadata.write_text(json.dumps({'commit': 'test-commit', 'manifest': self.manifest * 2}))
        with self.assertRaisesRegex(RuntimeError, 'Duplicate'):
            self.inspect()

    def test_nonexistent_current_is_explicitly_distinguished(self):
        self.assertEqual(self.inspect(self.release.parent / 'not-deployed'), {'present': False, 'matches': False})


class DeploymentBranchesTests(unittest.TestCase):
    def run_main(self, arguments, remote_results):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'maanshan').mkdir()
        (root / 'maanshan/index.html').write_bytes(b'<title>Mandarin</title>')
        client = MagicMock()
        def git(command, **_kwargs):
            if command[1] == 'status': return b''
            if command[1] == 'rev-parse': return 'a' * 40 + '\n'
            if command[1] == 'ls-files': return b'maanshan/index.html\0'
            self.fail('Unexpected local command')
        output = io.StringIO()
        with patch.object(update, 'ROOT', root), patch.object(update.sys, 'argv', ['update.py'] + arguments), \
             patch.object(update.subprocess, 'check_output', side_effect=git), \
             patch.object(update.paramiko, 'SSHClient', return_value=client), \
             patch.object(update, 'command', side_effect=remote_results) as command, contextlib.redirect_stdout(output):
            update.main()
        return client, command, output.getvalue()

    def test_same_release_never_uploads_builds_or_restarts(self):
        client, command, output = self.run_main([], [json.dumps({'matches': True, 'release': '/srv/maanshan/releases/current'})])
        self.assertEqual(command.call_count, 1)
        client.open_sftp.assert_not_called()
        client.close.assert_called_once()
        self.assertIn('no restart needed', output)

    def test_force_explicitly_rebuilds_without_the_skip_probe(self):
        client, command, _ = self.run_main(['--force'], ['[]', 'verified', 'built', 'healthy'])
        self.assertEqual(command.call_count, 4)
        client.open_sftp.assert_called_once()
        self.assertIn('systemctl restart', command.call_args_list[-1].args[1])

    def test_drifted_same_release_follows_the_normal_repair_deployment(self):
        client, command, _ = self.run_main([], [json.dumps({'present': True, 'matches': False}), '[]', 'verified', 'built', 'healthy'])
        self.assertEqual(command.call_count, 5)
        client.open_sftp.assert_called_once()

    def test_invalid_probe_response_or_ssh_failure_aborts_without_upload(self):
        for response in ['not json', RuntimeError('SSH permission denied')]:
            with self.assertRaises((json.JSONDecodeError, RuntimeError)):
                self.run_main([], [response])

    def test_repeated_same_version_has_a_unique_release_suffix(self):
        _, _, first = self.run_main(['--force'], ['[]', 'verified', 'built', 'healthy'])
        _, _, second = self.run_main(['--force'], ['[]', 'verified', 'built', 'healthy'])
        first_release = [line for line in first.splitlines() if line.startswith('Release:')][0]
        second_release = [line for line in second.splitlines() if line.startswith('Release:')][0]
        self.assertNotEqual(first_release, second_release)
        self.assertRegex(first_release, r'-aaaaaaaaaa-[0-9a-f]{8}$')


if __name__ == '__main__':
    unittest.main()
