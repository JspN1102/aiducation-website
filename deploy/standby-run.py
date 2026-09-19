#!/usr/bin/python3
"""Optional daily standby import bracketed by private PostgreSQL snapshots."""
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('local_health', Path(__file__).with_name('health-check.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
STATE = Path('/var/lib/maanshan-standby')
ENABLE = Path('/etc/maanshan/standby.enabled')


def snapshot(stage):
    root = health.PG_ROOT
    if stage not in ('before', 'after') or root.is_symlink() or root.stat().st_mode & 0o077:
        raise RuntimeError('invalid_snapshot_destination')
    if shutil.disk_usage(root).free < 2 * 1024**3:
        raise RuntimeError('insufficient_snapshot_space')
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = root / f'maanshan-{stamp}-standby-{stage}.dump'
    fd, temporary = tempfile.mkstemp(prefix='.standby-', dir=root)
    pg_user = pwd.getpwnam('postgres')
    try:
        os.fchown(fd, pg_user.pw_uid, pg_user.pw_gid)
        with os.fdopen(fd, 'wb') as stream:
            result = subprocess.run(['/usr/sbin/runuser', '-u', 'postgres', '--', str(health.PG_BIN / 'pg_dump'),
               '--host=/var/run/postgresql', '--port=5432', '--username=postgres', '--format=custom', 'maanshan_db'],
               stdout=stream, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=120,
               env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
            if result.returncode:
                raise RuntimeError('snapshot_failed')
            stream.flush()
            os.fsync(stream.fileno())
        health.run([health.PG_BIN / 'pg_restore', '--list', temporary], 30)
        digest = health.sha256(Path(temporary))
        # link is exclusive: never replace an existing backup.
        os.link(temporary, target)
        return {'name': target.name, 'sha256': digest, 'bytes': target.stat().st_size, 'mode': '0600'}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def reconcile(report):
    marker = ENABLE.lstat()
    if ENABLE.is_symlink() or not ENABLE.is_file() or marker.st_uid != 0 or marker.st_mode & 0o077:
        raise RuntimeError('standby_not_explicitly_enabled')
    service = health.run(['systemctl', 'show', 'maanshan-bridge-backup.service',
       '--property=Result,ExecMainStatus,ActiveState'])
    status = dict(line.split('=', 1) for line in service.splitlines() if '=' in line)
    if status.get('Result') != 'success' or status.get('ExecMainStatus') != '0' or status.get('ActiveState') != 'inactive':
        raise RuntimeError('latest_blob_backup_service_not_successful')
    newest = health.latest_blob()
    health.file_info(newest)
    node = '/usr/bin/node'
    importer = health.DEPLOY / 'standby-import.cjs'
    # Validates complete current snapshot before even making a database backup.
    validated = json.loads(health.run(['/usr/sbin/runuser', '-u', 'ubuntu', '--', node, importer, 'verify', '--input', newest], 60))
    if not validated.get('ok'):
        raise RuntimeError('invalid_snapshot')
    report['beforeBackup'] = snapshot('before')
    result = json.loads(health.run(['/usr/sbin/runuser', '-u', 'ubuntu', '--', '/usr/bin/env',
       'MAANSHAN_STANDBY_ENABLE=1', node, '--env-file=/home/ubuntu/maanshan-shared/app.env',
       importer, 'import', '--input', newest, '--expected-sha256', validated['sha256'], '--apply'], 180))
    if result.get('ok') is not True or result.get('dryRun') is not False or result.get('exportSha256') != validated['sha256']:
        raise RuntimeError('standby_import_failed')
    report['import'] = result
    report['afterBackup'] = snapshot('after')
    report['ok'] = True


if __name__ == '__main__':
    os.umask(0o077)
    report = {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'ok': False,
              'notifications': 'none-local-report-only', 'sourceDeleted': False}
    try:
        health.private_dir(STATE)
        with (STATE / 'run.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                reconcile(report)
            except Exception:
                report['error'] = 'standby_import_or_snapshot_failed'
            health.save_report(STATE, 'standby', report, 14)
    except Exception:
        # No raw stderr, env values, SQL or student payloads are logged.
        report['ok'] = False
    print(json.dumps({'ok': report['ok'], 'sourceDeleted': False, 'notifications': 'none'}))
    sys.exit(0 if report['ok'] else 1)
