"""Copy a verified, private recovery snapshot to this computer over pinned SSH.

The source ZIP is separate. This snapshot contains live credentials, certificates,
the database and generated speech. Never attach it to a public delivery package.
"""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import shlex
import subprocess
import tarfile

import paramiko


FILES = ('database.dump', 'database-roles.sql', 'runtime-config.tar.gz', 'speech-cache.tar.gz')
CONFIG_PATHS = (
    'home/ubuntu/maanshan-shared/app.env',
    'etc/nginx',
    'etc/letsencrypt',
    'etc/systemd/system/maanshan.service',
    'etc/systemd/system/maanshan-backup.service',
    'etc/systemd/system/maanshan-backup.timer',
    'usr/local/lib/maanshan-backup.sh',
    'usr/local/lib/maanshan-certbot-dnspod.py',
)
OPTIONAL_CONFIG_PATHS = (
    'home/ubuntu/maanshan-shared/bridge-backup.env',
    'home/ubuntu/maanshan-shared/research.env',
    'etc/systemd/system/research-sync.service',
    'etc/systemd/system/research-sync.timer',
    'etc/systemd/system/maanshan-bridge-backup.service',
    'etc/systemd/system/maanshan-bridge-backup.timer',
    'usr/local/lib/maanshan-bridge-backup.sh',
    'etc/systemd/system/maanshan-health-check.service',
    'etc/systemd/system/maanshan-health-check.timer',
    'etc/systemd/system/maanshan-health-restore.service',
    'etc/systemd/system/maanshan-health-restore.timer',
    'etc/systemd/system/maanshan-standby-import.service',
    'etc/systemd/system/maanshan-standby-import.timer',
    'etc/maanshan/standby.enabled',
    'usr/local/lib/maanshan-maintenance/health-check.py',
    'usr/local/lib/maanshan-maintenance/health-restore.py',
    'usr/local/lib/maanshan-maintenance/standby-run.py',
    'var/lib/maanshan-health/health-latest.json',
    'var/lib/maanshan-restore/restore-latest.json',
    'var/lib/maanshan-standby/standby-latest.json',
)


def private_directory(path):
    path.mkdir(parents=True, exist_ok=False, mode=0o700)
    if os.name == 'nt':
        # /grant:r alone leaves unrelated explicit grants intact. Query SIDs, then
        # remove every additional grant with icacls (no SACL privilege required).
        environment = os.environ.copy()
        environment['MAANSHAN_BACKUP_ACL_PATH'] = str(path)
        acl_query = '''$ErrorActionPreference = 'Stop'
$backupSids = @((Get-Acl -LiteralPath $env:MAANSHAN_BACKUP_ACL_PATH).Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
@{ user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; sids = $backupSids } | ConvertTo-Json -Compress
'''
        def query_acl():
            return json.loads(subprocess.check_output(
                ['powershell', '-NoProfile', '-NonInteractive', '-Command', acl_query],
                env=environment, text=True,
            ))
        permissions = query_acl()
        allowed = {permissions['user'], 'S-1-5-18'}
        subprocess.run(
            ['icacls', str(path), '/inheritance:r', '/grant:r',
             '*' + permissions['user'] + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'],
            check=True, capture_output=True,
        )
        extra = set(query_acl()['sids']) - allowed
        if extra:
            subprocess.run(['icacls', str(path), '/remove'] + ['*' + sid for sid in sorted(extra)],
                           check=True, capture_output=True)
        if set(query_acl()['sids']) != allowed:
            raise RuntimeError('Unable to restrict the private backup directory.')
    else:
        path.chmod(0o700)


def remote(client, command, stdin_text=None, timeout=180):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    if stdin_text:
        stdin.write(stdin_text)
    stdin.channel.shutdown_write()
    output = stdout.read().decode('utf-8')
    # Never include remote diagnostics in an exception: they may contain secrets.
    stderr.read()
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError('Remote backup operation failed; private files were not published.')
    return output


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def check_archive(path):
    count = 0
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            if member.name.startswith('/') or '..' in Path(member.name).parts:
                raise RuntimeError('Unexpected archive path.')
            if member.isfile():
                with archive.extractfile(member) as stream:
                    while stream.read(1024 * 1024):
                        pass
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='134.175.149.14')
    parser.add_argument('--user', default='ubuntu')
    parser.add_argument('--key', default=str(Path.home() / '.ssh/maanshan_deploy'))
    parser.add_argument('--known-hosts', default=str(Path.home() / '.ssh/maanshan_known_hosts'))
    parser.add_argument('--destination', default='D:/桌面/马鞍山/腾讯云迁移_20260919/私密服务器备份')
    args = parser.parse_args()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    destination = Path(args.destination).resolve() / stamp
    private_directory(destination)
    client = paramiko.SSHClient()
    client.load_host_keys(args.known_hosts)
    client.connect(args.host, username=args.user, key_filename=args.key,
                   look_for_keys=False, allow_agent=False, timeout=20)
    staging = None
    staging_valid = False
    files = FILES
    try:
        optional_code = '''import json,pathlib
configs = [name for name in OPTIONAL_CONFIGS if pathlib.Path('/' + name).is_file()]
print(json.dumps({'configs': configs, 'blobBackups': pathlib.Path('/home/ubuntu/maanshan-backups/blob').is_dir()}))
'''.replace('OPTIONAL_CONFIGS', repr(OPTIONAL_CONFIG_PATHS))
        optional = json.loads(remote(client, 'sudo -n python3 -', optional_code))
        config_paths = CONFIG_PATHS + tuple(optional['configs'])
        if optional['blobBackups']:
            files += ('blob-student-backups.tar.gz',)
        staging = remote(client, 'umask 077; mktemp -d /home/ubuntu/maanshan-shared/recovery-XXXXXXXXXX').strip()
        if not staging.startswith('/home/ubuntu/maanshan-shared/recovery-') or '/' in staging.rsplit('recovery-', 1)[-1]:
            raise RuntimeError('Unexpected remote staging directory.')
        staging_valid = True
        script = '\n'.join([
            'set -eu', 'umask 077', 'cd ' + shlex.quote(staging),
            'sudo -n -u postgres pg_dump --format=custom maanshan_db > database.dump',
            'sudo -n -u postgres pg_restore --list < database.dump > /dev/null',
            'sudo -n -u postgres pg_dumpall --roles-only > database-roles.sql',
            'sudo -n tar -czf - -C / ' + ' '.join(map(shlex.quote, config_paths)) + ' > runtime-config.tar.gz',
            "tar --exclude='*.tmp' -czf speech-cache.tar.gz -C /home/ubuntu/maanshan-shared tts-cache",
        ])
        if optional['blobBackups']:
            script += '\n' + "tar --exclude='*.tmp' -czf blob-student-backups.tar.gz -C /home/ubuntu/maanshan-backups blob"
        remote(client, script)
        metadata_code = '''import hashlib,json,pathlib
p=pathlib.Path(STAGING)
release=pathlib.Path('/srv/maanshan/current').resolve()
manifest=json.loads((release/'release-manifest.json').read_text())
files={}
for name in FILES:
 h=hashlib.sha256()
 with (p/name).open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 files[name]={'bytes':(p/name).stat().st_size,'sha256':h.hexdigest()}
print(json.dumps({'release':str(release),'commit':manifest['commit'],'files':files}))
'''.replace('STAGING', repr(staging)).replace('FILES', repr(files))
        metadata = json.loads(remote(client, 'python3 -', metadata_code))
        with client.open_sftp() as sftp:
            for name in files:
                partial = destination / (name + '.partial')
                sftp.get(staging + '/' + name, str(partial))
                if partial.stat().st_size != metadata['files'][name]['bytes'] or digest(partial) != metadata['files'][name]['sha256']:
                    raise RuntimeError('Backup transfer checksum mismatch.')
                partial.replace(destination / name)
        with (destination / 'database.dump').open('rb') as stream:
            if stream.read(5) != b'PGDMP':
                raise RuntimeError('Invalid PostgreSQL backup header.')
        for name in files[2:]:
            metadata['files'][name]['readableFiles'] = check_archive(destination / name)
        metadata.update({'createdAtUTC': stamp, 'private': True,
                         'includesTemporaryStudentBackups': optional['blobBackups'],
                         'optionalConfigPaths': optional['configs'],
                         'databaseListValidatedOnServer': True,
                         'allTransferredHashesMatch': True})
        (destination / 'manifest.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
        (destination / '请勿公开.txt').write_text(
            '这是私密灾备，包含 API 密钥、证书私钥和学生数据。仅保存在受限目录，不可分享或放入公开压缩包。\n'
            '恢复时请结合独立 website-版本号.zip 和部署说明，由管理员选择对应配置和数据库恢复。\n'
            '服务器仍有每日数据库备份；这个命令是手动下载到本机，电脑关机不会自动下载。\n', encoding='utf-8')
        print(json.dumps({'ok': True, 'directory': str(destination), 'commit': metadata['commit'],
                          'files': {name: metadata['files'][name]['bytes'] for name in files}}, ensure_ascii=True))
    finally:
        try:
            if staging_valid:
                # Remove only this run's exact files, never a recursive directory.
                cleanup = '\n'.join(['rm -f -- ' + shlex.quote(staging + '/' + name) for name in files])
                cleanup += '\nrmdir -- ' + shlex.quote(staging)
                remote(client, cleanup)
        finally:
            client.close()


if __name__ == '__main__':
    main()
