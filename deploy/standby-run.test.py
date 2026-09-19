"""Linux-only wrapper tests with snapshots and import commands mocked."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

if os.name == 'nt':
    raise unittest.SkipTest('fcntl, peer authentication, and wrapper permissions are verified on Linux')

spec = importlib.util.spec_from_file_location('standby_run', Path(__file__).with_name('standby-run.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WrapperTests(unittest.TestCase):
    def setup_reconcile(self, directory, events, fail=None):
        marker = Mock()
        marker.lstat.return_value = Mock(st_uid=0, st_mode=0o100600)
        marker.is_symlink.return_value = False
        marker.is_file.return_value = True
        def run(args, timeout=15):
            if args[0] == 'systemctl':
                return 'Result=success\nExecMainStatus=0\nActiveState=inactive\n' if fail != 'export' else 'Result=exit-code\nExecMainStatus=1\nActiveState=failed\n'
            if 'verify' in args:
                events.append('verify')
                if fail == 'verify':
                    raise RuntimeError('bad export')
                return json.dumps({'ok': True, 'sha256': 'safe-hash'})
            events.append('import')
            self.assertIn('--expected-sha256', args)
            if fail == 'import':
                raise RuntimeError('transaction rolled back')
            return json.dumps({'ok': True, 'dryRun': False, 'exportSha256': 'safe-hash'})
        def snapshot(stage):
            events.append(stage)
            if fail == stage:
                raise RuntimeError('snapshot failed')
            return {'name': stage + '.dump'}
        return [patch.object(module, 'ENABLE', marker), patch.object(module.health, 'latest_blob', return_value=directory / 'records.json'),
                patch.object(module.health, 'file_info', return_value={}), patch.object(module.health, 'run', side_effect=run),
                patch.object(module, 'snapshot', side_effect=snapshot)]

    def scenario(self, fail=None):
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            events, report = [], {}
            for context in self.setup_reconcile(Path(temporary), events, fail):
                stack.enter_context(context)
            if fail:
                with self.assertRaises(RuntimeError):
                    module.reconcile(report)
            else:
                module.reconcile(report)
            return events, report

    def test_success_is_bracketed_by_two_snapshots(self):
        events, report = self.scenario()
        self.assertEqual(events, ['verify', 'before', 'import', 'after'])
        self.assertTrue(report['ok'])

    def test_export_failure_or_invalid_data_never_touches_pg(self):
        self.assertEqual(self.scenario('export')[0], [])
        self.assertEqual(self.scenario('verify')[0], ['verify'])

    def test_before_snapshot_failure_prevents_import(self):
        self.assertEqual(self.scenario('before')[0], ['verify', 'before'])

    def test_failed_import_retains_before_snapshot_and_does_not_claim_success(self):
        events, report = self.scenario('import')
        self.assertEqual(events, ['verify', 'before', 'import'])
        self.assertIn('beforeBackup', report)
        self.assertNotIn('ok', report)

    def test_after_snapshot_failure_keeps_successful_import_fact_for_recovery(self):
        events, report = self.scenario('after')
        self.assertEqual(events, ['verify', 'before', 'import', 'after'])
        self.assertTrue(report['import']['ok'])
        self.assertNotIn('ok', report)


if __name__ == '__main__':
    unittest.main()
