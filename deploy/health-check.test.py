"""Offline failure/retention tests; no network, services, or production writes."""
import importlib.util
from contextlib import ExitStack
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('health', Path(__file__).with_name('health-check.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthTests(unittest.TestCase):
    def collect_mode(self, direct=False, standby=False, failed_backup=None):
        """Exercise the actual collection routing with only OS/API I/O replaced."""
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary)
            direct_marker, standby_marker = root / 'direct.enabled', root / 'standby.enabled'
            if direct:
                direct_marker.touch()
            if standby:
                standby_marker.touch()
            stack.enter_context(mock.patch.object(health, 'DIRECT_POSTGRES', direct_marker))
            stack.enter_context(mock.patch.object(health, 'STANDBY_ENABLE', standby_marker))
            def read_local(path, *args, **kwargs):
                if str(path).replace('\\', '/') == '/proc/meminfo':
                    return 'MemTotal: 4000000 kB\nMemAvailable: 2000000 kB\n'
                return 'cpu 100 0 50 900 0 0 0 0\n'
            stack.enter_context(mock.patch.object(health.Path, 'read_text', read_local))
            stack.enter_context(mock.patch.object(health.shutil, 'disk_usage', return_value=mock.Mock(free=10 * 1024**3, total=20 * 1024**3)))
            stack.enter_context(mock.patch.object(health.os, 'getloadavg', return_value=(0.1, 0.1, 0.1), create=True))
            stack.enter_context(mock.patch.object(health.time, 'sleep'))
            opener = mock.Mock()
            opener.open.return_value.__enter__ = mock.Mock(return_value=mock.Mock(read=mock.Mock(return_value=b'{"ok":true}')))
            opener.open.return_value.__exit__ = mock.Mock(return_value=False)
            stack.enter_context(mock.patch.object(health.urllib.request, 'build_opener', return_value=opener))
            command = stack.enter_context(mock.patch.object(health, 'run', return_value='ActiveState=active\nResult=success\nLoadState=loaded\nExecMainStatus=0\n'))
            checked_reports = []
            def read_report(path):
                checked_reports.append(str(path))
                return {'ok': True, 'at': health.dt.datetime.now(health.dt.timezone.utc).isoformat(), 'verification': 'fixture-full-restore'}
            stack.enter_context(mock.patch.object(health, 'read_report', side_effect=read_report))
            def check_backup(kind, previous):
                if kind == failed_backup:
                    raise RuntimeError('fixture_backup_failed')
                return {'ok': True}
            backups = stack.enter_context(mock.patch.object(health, 'backup_check', side_effect=check_backup))
            report = health.collect()
            return report, [call.args[0][2] for call in command.call_args_list], [call.args[0] for call in backups.call_args_list], checked_reports

    def test_no_direct_marker_preserves_blob_and_optional_standby_checks(self):
        report, units, backups, reports = self.collect_mode(standby=True)
        self.assertTrue(report['ok'])
        self.assertEqual(report['storageMode'], 'blob-with-postgres-standby')
        self.assertEqual(backups, ['postgres', 'blob'])
        self.assertIn('maanshan-bridge-backup.timer', units)
        self.assertIn('maanshan-bridge-backup.service', units)
        self.assertIn('maanshan-standby-import.timer', units)
        self.assertIn('standby_copy', report['checks'])
        self.assertTrue(any('standby-latest.json' in path for path in reports))
        report, _, _, _ = self.collect_mode(failed_backup='blob')
        self.assertFalse(report['ok'])
        self.assertFalse(report['checks']['blob_backup']['ok'])
        self.assertNotIn('standby_copy', report['checks'])

    def test_direct_postgres_ignores_legacy_blob_and_standby_even_if_old_marker_remains(self):
        report, units, backups, reports = self.collect_mode(direct=True, standby=True, failed_backup='blob')
        self.assertTrue(report['ok'])
        self.assertEqual(report['storageMode'], 'direct-postgres')
        self.assertEqual(backups, ['postgres'])
        self.assertFalse(any('bridge' in unit or 'standby' in unit for unit in units))
        self.assertFalse(any('standby-latest.json' in path for path in reports))
        self.assertNotIn('blob_backup', report['checks'])
        self.assertNotIn('standby_copy', report['checks'])
        for name in ('resources', 'api', 'maanshan.service', 'nginx.service', 'postgresql@14-main.service',
                     'maanshan-backup.timer', 'maanshan-backup.service', 'maanshan-health-restore.timer',
                     'postgres_backup', 'postgres_restore'):
            self.assertTrue(report['checks'][name]['ok'], name)

    def test_direct_postgres_still_fails_when_database_backup_fails(self):
        report, _, backups, _ = self.collect_mode(direct=True, failed_backup='postgres')
        self.assertFalse(report['ok'])
        self.assertEqual(backups, ['postgres'])
        self.assertFalse(report['checks']['postgres_backup']['ok'])
        self.assertTrue(report['checks']['postgres_restore']['ok'])

    @unittest.skipIf(os.name == 'nt', 'POSIX permissions are verified on the Linux target')
    def test_bounded_private_reports_do_not_delete_backups_or_foreign_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            foreign = root / 'health-mine.json'
            foreign.write_text('keep')
            for i in range(8):
                health.save_report(root, 'health', {'ok': True, 'sequence': i}, 3)
            files = list(root.glob('health-*.json'))
            self.assertEqual(len(files), 5)  # three history, latest, foreign
            self.assertEqual(json.loads((root / 'health-latest.json').read_text())['sequence'], 7)
            self.assertEqual(foreign.read_text(), 'keep')
            if os.name != 'nt':
                self.assertEqual((root / 'health-latest.json').stat().st_mode & 0o777, 0o600)

    @unittest.skipIf(os.name == 'nt', 'POSIX permissions are verified on the Linux target')
    def test_backup_freshness_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / 'maanshan-20260920T020000Z.dump'
            file.write_bytes(b'fixture')
            file.chmod(0o600)
            self.assertEqual(health.file_info(file)['bytes'], 7)
            with self.assertRaises(RuntimeError):
                health.file_info(file, time.time() + 31 * 3600)
            if os.name != 'nt':
                link = Path(temporary) / 'link.dump'
                link.symlink_to(file)
                with self.assertRaises(RuntimeError):
                    health.file_info(link)

    def test_latest_dump_includes_after_import_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old = root / 'maanshan-20260920T020000Z.dump'
            newer = root / 'maanshan-20260920T040000123456Z-standby-after.dump'
            old.write_bytes(b'old'); newer.write_bytes(b'new')
            os.utime(old, (100, 100)); os.utime(newer, (200, 200))
            (root / '.standby-incomplete').write_bytes(b'not a finished backup')
            self.assertEqual(health.latest_pg(root), newer)

    def test_latest_blob_does_not_hide_a_failed_newer_export(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old = root / '20260919T031500000000000Z'; old.mkdir()
            new = root / '20260920T031500000000000Z'; new.mkdir()
            (old / 'records.json').write_text('{}')
            self.assertEqual(health.latest_blob(root), new / 'records.json')
            with self.assertRaises(FileNotFoundError):
                health.file_info(health.latest_blob(root))


if __name__ == '__main__':
    unittest.main()
