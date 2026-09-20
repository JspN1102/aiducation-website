"""Simulate export successes/failures; never call Blob or read student data."""
from pathlib import Path
import json
import os
import shlex
import subprocess
import tempfile
import unittest


@unittest.skipIf(os.name == 'nt', 'POSIX shell job is tested on Linux')
class BackupTests(unittest.TestCase):
    def scenario(self, fail=''):
        with tempfile.TemporaryDirectory(prefix='school-backup-test-') as temporary:
            folder = Path(temporary)
            node = folder / 'fake-node'
            node.write_text('''#!/usr/bin/python3
import os,sys,json
from pathlib import Path
args=sys.argv[1:]
if args[0]=='-':os.execv('/usr/bin/node',['node',*args])
flag='--output' if '--output' in args else '--export-output'
target=Path(args[args.index(flag)+1])
if os.environ.get('SCHOOL_BACKUP_TEST_FAIL')==target.name:sys.exit(1)
target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
data={'format':'synthetic-records-original-v1'} if target.name=='records.json' else {'synthetic':True}
fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as stream:json.dump(data,stream)
''')
            node.chmod(0o700)
            root = folder / 'private-backups'
            script = Path(__file__).with_name('backup-bridge.sh').read_text().replace(
                'backup_root=/home/ubuntu/maanshan-backups/blob', 'backup_root=' + shlex.quote(str(root))).replace('/usr/bin/node', shlex.quote(str(node)))
            job = folder / 'job.sh'; job.write_text(script)
            result = subprocess.run(['/bin/sh', str(job)], capture_output=True,
                 env={**os.environ, 'SCHOOL_BACKUP_TEST_FAIL': fail})
            directories = list(root.iterdir()); self.assertEqual(len(directories), 1)
            target = directories[0]
            self.assertEqual(json.loads((target / 'records.json').read_text())['format'], 'synthetic-records-original-v1')
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)
            if fail:
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((target / 'complete.json').exists())
            else:
                self.assertEqual(result.returncode, 0)
                complete = json.loads((target / 'complete.json').read_text())
                self.assertEqual(len(complete['files']), 5)
                self.assertEqual(complete['format'], 'maanshan-private-daily-backup-v3')
            for file in target.iterdir():
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)

    def test_completed_account_and_audit_exports_publish_private_marker(self):
        self.scenario()

    def test_failed_account_export_keeps_original_records_without_completion_marker(self):
        self.scenario('school-accounts.snapshot.json')

    def test_failed_teacher_report_export_never_publishes_completion_marker(self):
        self.scenario('teacher-reports.index.json')


if __name__ == '__main__':
    unittest.main()
