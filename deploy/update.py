"""One-command deployment from a clean local Git checkout (Python + paramiko).

Uses a dedicated local SSH key, never bundles .env or node_modules. The server
keeps previous releases; failed health checks automatically restore the prior one.
"""
from pathlib import Path
import argparse, datetime, hashlib, json, shlex, subprocess, sys
import paramiko

ROOT=Path(__file__).resolve().parent.parent
PUBLIC={'maanshan','mandarin-assessment','assets','poetry','wenhuacun','awards'}
RUNTIME={'api','server','deploy'}

def command(client, script, input_text=None, timeout=180):
    stdin,stdout,stderr=client.exec_command(script,timeout=timeout)
    if input_text: stdin.write(input_text)
    stdin.channel.shutdown_write()
    output=stdout.read().decode('utf-8','replace')
    error=stderr.read().decode('utf-8','replace')
    if stdout.channel.recv_exit_status()!=0:
        raise RuntimeError('Remote deployment step failed: '+error[-2000:])
    return output

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--host',default='134.175.149.14')
    parser.add_argument('--user',default='ubuntu')
    parser.add_argument('--key',default=str(Path.home()/'.ssh/maanshan_deploy'))
    parser.add_argument('--known-hosts',default=str(Path.home()/'.ssh/maanshan_known_hosts'))
    args=parser.parse_args()
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT).strip():
        raise RuntimeError('Commit the intended website changes before deployment.')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    release='/srv/maanshan/releases/'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+commit[:10]
    paths=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode('utf-8').split('\0')
    manifest=[]
    for rel in paths:
        if not rel or any(p.startswith('.') for p in Path(rel).parts):continue
        top=rel.split('/')[0]
        if top in PUBLIC or rel in ['index.html','favicon.png']:dest='public/'+rel
        elif top in RUNTIME or rel in ['package.json','package-lock.json']:dest=rel
        else:continue
        source=ROOT/rel
        if source.is_symlink():raise RuntimeError('Unexpected local symlink')
        manifest.append({'source':rel,'path':dest,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})
    client=paramiko.SSHClient();client.load_host_keys(args.known_hosts)
    client.connect(args.host,username=args.user,key_filename=args.key,look_for_keys=False,allow_agent=False,timeout=20)
    try:
        data={'release':release,'manifest':manifest,'commit':commit}
        prepare="""from pathlib import Path
import json,hashlib,shutil,os
data=DATA
release=Path(data['release']);release.mkdir(parents=True,exist_ok=False)
current=Path('/srv/maanshan/current')
missing=[]
for item in data['manifest']:
 dest=release/item['path'];dest.parent.mkdir(parents=True,exist_ok=True)
 old=current/item['path']
 if old.is_file() and hashlib.sha256(old.read_bytes()).hexdigest()==item['sha256']:
  shutil.copyfile(old,dest)
 else:missing.append(item['path'])
(release/'maanshan').symlink_to('public/maanshan',target_is_directory=True)
(release/'release-manifest.json').write_text(json.dumps(data),encoding='utf-8')
print(json.dumps(missing))
""".replace('DATA',repr(data))
        missing=set(json.loads(command(client,'python3 -',prepare)))
        sftp=client.open_sftp()
        for item in manifest:
            if item['path'] in missing:sftp.put(str(ROOT/item['source']),release+'/'+item['path'])
        sftp.close()
        print('Uploaded',len(missing),'changed files.',flush=True)
        verification="""from pathlib import Path
import json,hashlib
p=Path(RELEASE)
data=json.loads((p/'release-manifest.json').read_text())
for item in data['manifest']:
 assert hashlib.sha256((p/item['path']).read_bytes()).hexdigest()==item['sha256'], 'Release file mismatch'
print('All release hashes verified.')
""".replace('RELEASE',repr(release))
        print(command(client,'python3 -',verification),flush=True)
        build='set -e\ncd '+shlex.quote(release)+'\nnpm ci --no-audit --no-fund\nnpm run build:server\n'
        print(command(client,build),flush=True)
        activate="""set -e
previous=$(readlink -f /srv/maanshan/current)
release=RELEASE
ln -s "$release" /srv/maanshan/current.next
mv -Tf /srv/maanshan/current.next /srv/maanshan/current
healthy=0
if sudo -n timeout 20s systemctl restart maanshan; then
  for attempt in $(seq 1 20); do
    if curl -fsS --max-time 3 http://127.0.0.1:3100/api/health >/dev/null; then healthy=1; break; fi
    sleep 1
  done
fi
if [ "$healthy" = 1 ]; then
  curl -fsS --max-time 10 --resolve mandarin.aiducation.asia:443:127.0.0.1 https://mandarin.aiducation.asia/maanshan/ >/dev/null || healthy=0
fi
if [ "$healthy" != 1 ]; then
  ln -s "$previous" /srv/maanshan/current.rollback
  mv -Tf /srv/maanshan/current.rollback /srv/maanshan/current
  sudo -n timeout 20s systemctl restart maanshan
  printf 'Health check failed; previous release restored.\\n' >&2
  exit 1
fi
printf 'Deployment healthy. Previous release retained: %s\\n' "$previous"
""".replace('RELEASE',shlex.quote(release))
        print(command(client,activate,timeout=150),flush=True)
        print('Live: https://mandarin.aiducation.asia/maanshan/')
        print('Release:',release)
    finally:client.close()

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error),file=sys.stderr);sys.exit(1)
