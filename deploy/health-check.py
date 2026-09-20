#!/usr/bin/python3
"""Local read-only checks. Reports contain no credentials, student rows or remote API calls."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

STATE = Path('/var/lib/maanshan-health')
PG_ROOT = Path('/var/backups/maanshan')
BLOB_ROOT = Path('/home/ubuntu/maanshan-backups/blob')
RESTORE_STATE = Path('/var/lib/maanshan-restore')
DEPLOY = Path('/srv/maanshan/current/deploy')
PG_BIN = Path('/usr/lib/postgresql/14/bin')
DIRECT_POSTGRES = Path('/etc/maanshan/direct-postgres.enabled')
STANDBY_ENABLE = Path('/etc/maanshan/standby.enabled')
MAX_AGE = 30 * 3600


def run(args, timeout=15):
    # Capture and discard raw stderr: driver errors may contain private details.
    result = subprocess.run([str(a) for a in args], stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError('command_failed')
    return result.stdout.decode('utf-8', 'strict')


def private_dir(directory):
    if directory.is_symlink():
        raise RuntimeError('directory_link')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        raise RuntimeError('directory_permissions')


def save_report(directory, prefix, report, keep):
    private_dir(directory)
    content = json.dumps(report, sort_keys=True, indent=2).encode()
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    destination = directory / f'{prefix}-{stamp}.json'
    with destination.open('xb') as stream:
        os.chmod(destination, 0o600)
        stream.write(content)
    fd, tmp = tempfile.mkstemp(prefix='.latest-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
        os.replace(tmp, directory / f'{prefix}-latest.json')
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    # Only this script's timestamped reports are removed, never backups.
    history = sorted(p for p in directory.glob(f'{prefix}-*.json')
                     if re.fullmatch(re.escape(prefix) + r'-\d{8}T\d{12}Z\.json', p.name))
    for old in history[:-keep]:
        if old.is_file() and not old.is_symlink():
            old.unlink()


def latest_pg(root=PG_ROOT):
    files = [p for p in root.iterdir() if re.fullmatch(r'maanshan-\d{8}T\d{6}(?:\d{6})?Z(?:-standby-(?:before|after))?\.dump', p.name)]
    if not files:
        raise RuntimeError('missing_pg_backup')
    return max(files, key=lambda p: (p.lstat().st_mtime_ns, p.name))


def latest_blob(root=BLOB_ROOT):
    folders = sorted(p for p in root.iterdir() if re.fullmatch(r'\d{8}T\d{15}Z', p.name))
    if not folders or folders[-1].is_symlink() or not folders[-1].is_dir():
        raise RuntimeError('missing_or_invalid_blob_backup')
    return folders[-1] / 'records.json'


def file_info(file, now=None):
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size == 0:
        raise RuntimeError('invalid_or_public_backup')
    age = (time.time() if now is None else now) - info.st_mtime
    if age < -300 or age > MAX_AGE:
        raise RuntimeError('stale_backup')
    return {'name': file.name if file.suffix == '.dump' else file.parent.name + '/records.json',
            'bytes': info.st_size, 'mtimeNs': info.st_mtime_ns, 'ageHours': round(max(0, age) / 3600, 2)}


def read_report(filename):
    try:
        if filename.is_symlink() or filename.stat().st_size > 65536:
            return {}
        return json.loads(filename.read_text())
    except (OSError, ValueError):
        return {}


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def backup_check(kind, previous):
    file = latest_pg() if kind == 'postgres' else latest_blob()
    info = file_info(file)
    cached = previous.get('checks', {}).get(kind + '_backup', {})
    if cached.get('ok') and all(cached.get(k) == info[k] for k in ('name', 'bytes', 'mtimeNs')):
        return {**cached, **info, 'cachedIntegrity': True}
    if kind == 'postgres':
        run([PG_BIN / 'pg_restore', '--list', file], 45)
        return {'ok': True, **info, 'sha256': sha256(file), 'verification': 'archive-directory-only', 'cachedIntegrity': False}
    checked = json.loads(run(['/usr/sbin/runuser', '-u', 'ubuntu', '--', '/usr/bin/node', DEPLOY / 'standby-import.cjs', 'verify', '--input', file], 60))
    if checked.get('ok') is not True:
        raise RuntimeError('invalid_blob_export')
    return {'ok': True, **info, **checked, 'verification': 'full-records-and-checksum', 'cachedIntegrity': False}


def collect():
    # Explicit operations marker: the school API now writes directly to the
    # local database. Retired Blob exports/imports are not part of its health.
    direct_postgres = DIRECT_POSTGRES.exists()
    report = {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'ok': True, 'checks': {},
              'storageMode': 'direct-postgres' if direct_postgres else 'blob-with-postgres-standby',
              'notifications': 'none-local-report-only'}
    previous = read_report(STATE / 'health-latest.json')

    def check(name, operation):
        try:
            result = operation()
            report['checks'][name] = result
            if result.get('ok') is not True:
                report['ok'] = False
        except Exception:
            report['checks'][name] = {'ok': False, 'error': 'check_failed'}
            report['ok'] = False

    def resource_check():
        memory = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
        available = memory['MemAvailable'] / memory['MemTotal']
        disk = shutil.disk_usage('/srv/maanshan')
        load = os.getloadavg()[1] / max(1, os.cpu_count() or 1)
        def cpu():
            values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
            return sum(values), values[3] + values[4]
        total1, idle1 = cpu()
        time.sleep(.2)
        total2, idle2 = cpu()
        busy = 100 * (1 - (idle2 - idle1) / max(1, total2 - total1))
        return {'ok': available >= .10 and disk.free / disk.total >= .10 and disk.free >= 2 * 1024**3 and load < 2,
                'memoryAvailablePercent': round(available * 100, 1), 'diskFreeGiB': round(disk.free / 1024**3, 2),
                'diskFreePercent': round(disk.free / disk.total * 100, 1), 'cpuLoad5mPerCore': round(load, 2),
                'cpuBusySamplePercent': round(busy, 1)}

    def api_check():
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:3100/api/health', timeout=5) as response:
            data = json.loads(response.read(2048))
        return {'ok': data.get('ok') is True, 'scope': 'local-process-only-no-paid-provider-calls'}

    def unit_check(unit, timer=False):
        output = run(['systemctl', 'show', unit, '--property=ActiveState,Result,LoadState,NextElapseUSecRealtime'])
        values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
        good = values.get('LoadState') == 'loaded' and values.get('ActiveState') == 'active'
        if not timer:
            good = good and values.get('Result', 'success') == 'success'
        return {'ok': good, 'active': values.get('ActiveState', 'unknown'), 'result': values.get('Result', '')}

    def backup_service_check(unit):
        output = run(['systemctl', 'show', unit, '--property=Result,ExecMainStatus,LoadState'])
        values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
        return {'ok': values.get('LoadState') == 'loaded' and values.get('Result') == 'success' and values.get('ExecMainStatus') == '0'}

    def restore_check():
        data = read_report(RESTORE_STATE / 'restore-latest.json')
        when = dt.datetime.fromisoformat(data['at']).timestamp()
        return {'ok': data.get('ok') is True and -300 <= time.time() - when <= MAX_AGE,
                'lastCheck': data['at'], 'verification': data.get('verification', 'unknown'), 'backup': data.get('backup', {})}

    check('resources', resource_check)
    check('api', api_check)
    for unit in ('maanshan.service', 'nginx.service', 'postgresql@14-main.service'):
        check(unit, lambda unit=unit: unit_check(unit))
    backup_timers = ['maanshan-backup.timer', 'maanshan-health-restore.timer']
    backup_services = ['maanshan-backup.service']
    if not direct_postgres:
        backup_timers.append('maanshan-bridge-backup.timer')
        backup_services.append('maanshan-bridge-backup.service')
    for unit in backup_timers:
        check(unit, lambda unit=unit: unit_check(unit, True))
    for unit in backup_services:
        check(unit, lambda unit=unit: backup_service_check(unit))
    check('postgres_backup', lambda: backup_check('postgres', previous))
    if not direct_postgres:
        check('blob_backup', lambda: backup_check('blob', previous))
    check('postgres_restore', restore_check)
    if not direct_postgres and STANDBY_ENABLE.exists():
        check('maanshan-standby-import.timer', lambda: unit_check('maanshan-standby-import.timer', True))
        def standby_check():
            data = read_report(Path('/var/lib/maanshan-standby/standby-latest.json'))
            age = time.time() - dt.datetime.fromisoformat(data['at']).timestamp()
            return {'ok': data.get('ok') is True and -300 <= age <= MAX_AGE,
                    'lastCheck': data['at'], 'postgresAfterBackup': data.get('afterBackup', {}).get('name')}
        check('standby_copy', standby_check)
    return report


if __name__ == '__main__':
    os.umask(0o077)
    try:
        result = collect()
        save_report(STATE, 'health', result, 96)  # roughly 24 hours; bounded even after repeated manual starts
        print(json.dumps({'ok': result['ok'], 'failedChecks': [k for k, v in result['checks'].items() if not v.get('ok')], 'notifications': 'none'}))
        sys.exit(0 if result['ok'] else 1)
    except Exception:
        print('{"ok":false,"error":"local_health_report_failed"}')
        sys.exit(1)
