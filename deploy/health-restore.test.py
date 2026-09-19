"""Regression checks: a timed-out pg_ctl must never cause live cluster deletion."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restore', Path(__file__).with_name('health-restore.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipIf(os.name == 'nt', 'POSIX restore isolation is verified on Linux')
class RestoreTests(unittest.TestCase):
    def timeout_case(self, stop_succeeds):
        # A short path also observes the Unix-domain socket length limit.
        with tempfile.TemporaryDirectory(prefix='mr-') as temporary:
            root = Path(temporary); root.chmod(0o700)
            backup = root / 'fixture.dump'; backup.write_bytes(b'private fixture'); backup.chmod(0o600)
            calls = []
            def run(args, timeout):
                name = Path(args[0]).name
                calls.append((name, args[-1]))
                if name == 'initdb':
                    Path(args[args.index('-D') + 1]).mkdir()
                if name == 'pg_ctl' and args[-1] == 'start':
                    data = Path(args[args.index('-D') + 1]); (data / 'postmaster.pid').write_text('test')
                    raise subprocess.TimeoutExpired('pg_ctl', 25)
                if name == 'pg_ctl' and args[-1] == 'stop':
                    self.assertTrue(Path(args[args.index('-D') + 1]).exists())
                    if not stop_succeeds:
                        raise RuntimeError('cannot confirm stop')
                return ''
            with patch.object(module.health, 'RESTORE_STATE', root), patch.object(module.health, 'latest_pg', return_value=backup), patch.object(module.health, 'run', side_effect=run):
                with self.assertRaises(Exception):
                    module.restore()
            self.assertIn(('pg_ctl', 'stop'), calls)
            self.assertEqual(bool(list(root.glob('work-*'))), not stop_succeeds)

    def test_start_timeout_stops_cluster_before_cleanup(self):
        self.timeout_case(True)

    def test_uncertain_stop_keeps_work_directory(self):
        self.timeout_case(False)


if __name__ == '__main__':
    unittest.main()
