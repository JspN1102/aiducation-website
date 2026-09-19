"""Offline failure/retention tests; no network, services, or production writes."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('health', Path(__file__).with_name('health-check.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthTests(unittest.TestCase):
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
