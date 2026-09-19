#!/usr/bin/python3
"""Restore the latest dump into a disposable PostgreSQL cluster, never the main cluster."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('local_health', Path(__file__).with_name('health-check.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


def restore():
    root = health.RESTORE_STATE
    health.private_dir(root)
    # A killed prior run needs inspection. Do not accumulate disposable clusters
    # or guess whether another postgres process still owns an old directory.
    if any(root.glob('work-*')):
        raise RuntimeError('previous_restore_work_requires_review')
    backup = health.latest_pg()
    info = health.file_info(backup)
    # Resource limits are explicit. Large restores require a separate planned drill.
    if info['bytes'] > 512 * 1024**2 or shutil.disk_usage(root).free < max(1024**3, info['bytes'] * 8):
        raise RuntimeError('restore_capacity_limit')
    digest = health.sha256(backup)
    work = Path(tempfile.mkdtemp(prefix='work-', dir=root))
    database = work / 'data'
    socket = work / 'socket'
    socket.mkdir(mode=0o700)
    started = False

    def command(name, args, timeout=60):
        return health.run([health.PG_BIN / name, *args], timeout)

    try:
        if len(os.fsencode(str(socket / '.s.PGSQL.65439'))) >= 108:
            raise RuntimeError('private_socket_path_too_long')
        # Local trust is confined to a 0700 private Unix socket. No TCP listener.
        command('initdb', ['-D', database, '--encoding=UTF8', '--no-locale', '--auth-local=trust', '--auth-host=reject'])
        settings = ("listen_addresses = ''\nport = 65439\n"
                    f"unix_socket_directories = '{socket}'\n"
                    "unix_socket_permissions = 0700\nshared_buffers = '16MB'\n"
                    "work_mem = '1MB'\nmaintenance_work_mem = '16MB'\nmax_connections = 10\n"
                    "max_wal_size = '128MB'\nmin_wal_size = '32MB'\nlogging_collector = off\n"
                    "log_statement = 'none'\nlog_min_messages = 'panic'\n")
        with (database / 'postgresql.conf').open('a') as stream:
            stream.write(settings)
        started = True
        command('pg_ctl', ['-D', database, '-l', work / 'postgres.log', '-w', '-t', '15', 'start'], 25)
        connection = ['--host', socket, '--port', '65439', '--username', 'postgres']
        command('createdb', [*connection, 'restore_check'])
        command('pg_restore', [*connection, '--dbname', 'restore_check', '--exit-on-error', '--no-owner', '--no-privileges', backup], 180)
        rows = command('psql', [*connection, '--dbname', 'restore_check', '-X', '-A', '-t', '--set', 'ON_ERROR_STOP=1',
          '-c', "SELECT count(*) FROM public.student_data;"])
        if not rows.strip().isdigit():
            raise RuntimeError('invalid_restored_table')
        # Check expected columns and the sync uniqueness index, without exposing records.
        schema = command('psql', [*connection, '--dbname', 'restore_check', '-X', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '-c',
          "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='student_data' "
          "AND column_name IN ('student_id','grade','cls','poem_id','section','payload','sync_id','updated_at');"])
        unique = command('psql', [*connection, '--dbname', 'restore_check', '-X', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '-c',
          "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='student_data' "
          "AND indexdef LIKE 'CREATE UNIQUE INDEX% (sync_id)';"])
        if schema.strip() != '8' or not unique.strip().isdigit() or int(unique.strip()) < 1:
            raise RuntimeError('restored_schema_mismatch')
        if health.sha256(backup) != digest:
            raise RuntimeError('backup_changed_during_restore')
        return {'ok': True, 'backup': {**info, 'sha256': digest}, 'restoredStudentRows': int(rows),
                'verification': 'full-restore-private-unix-socket-cluster', 'productionDatabaseTouched': False}
    finally:
        stopped = not started or not (database / 'postmaster.pid').exists()
        if not stopped:
            try:
                command('pg_ctl', ['-D', database, '-m', 'immediate', '-w', '-t', '15', 'stop'], 25)
                stopped = True
            except Exception:
                # Never remove a live cluster. systemd kills this unit's children on exit.
                stopped = False
        if stopped and work.parent.resolve() == root.resolve() and work.name.startswith('work-') and not work.is_symlink():
            shutil.rmtree(work)
        if not stopped:
            raise RuntimeError('isolated_restore_cleanup_failed')


if __name__ == '__main__':
    os.umask(0o077)
    result = {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'notifications': 'none-local-report-only'}
    try:
        result.update(restore())
    except Exception:
        result.update({'ok': False, 'error': 'isolated_restore_failed', 'productionDatabaseTouched': False})
    try:
        health.save_report(health.RESTORE_STATE, 'restore', result, 14)
        # No student data, command stderr or credentials reach journal.
        print(json.dumps({'ok': result['ok'], 'verification': result.get('verification', 'failed'), 'notifications': 'none'}))
    except Exception:
        result['ok'] = False
        print('{"ok":false,"error":"restore_report_failed"}')
    sys.exit(0 if result['ok'] else 1)
