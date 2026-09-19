"""One-command deployment from a clean local Git checkout (Python + paramiko).

Uses a dedicated local SSH key, never bundles .env or node_modules. The server
keeps previous releases; failed health checks automatically restore the prior one.
"""
from pathlib import Path
import argparse, datetime, hashlib, json, shlex, subprocess, sys, uuid
import paramiko

ROOT=Path(__file__).resolve().parent.parent
PUBLIC={'maanshan','mandarin-assessment','assets','poetry','wenhuacun','awards'}
RUNTIME={'api','server','deploy'}

def current_release_probe(commit, manifest):
    """Verify a same-version release before deciding a deployment is unnecessary."""
    desired={'commit':commit,'files':{item['path']:item['sha256'] for item in manifest}}
    return """from pathlib import Path
import hashlib,json,subprocess
desired=DESIRED
current=Path('/srv/maanshan/current')
if not current.exists():
 if current.is_symlink():raise RuntimeError('The current release symlink is broken; inspect it before deploying.')
 print(json.dumps({'present':False,'matches':False}));raise SystemExit(0)
release=current.resolve(strict=True)
stored=json.loads((release/'release-manifest.json').read_text(encoding='utf-8'))
if not isinstance(stored,dict) or not isinstance(stored.get('commit'),str) or not isinstance(stored.get('manifest'),list):
 raise RuntimeError('Invalid current release metadata; inspect it before deploying.')
files={}
for item in stored['manifest']:
 if not isinstance(item,dict) or not isinstance(item.get('path'),str) or not isinstance(item.get('sha256'),str):
  raise RuntimeError('Invalid current file metadata; inspect it before deploying.')
 if item['path'] in files:raise RuntimeError('Duplicate current file metadata; inspect it before deploying.')
 files[item['path']]=item['sha256']
state={'present':True,'release':str(release),'matches':False}
if stored['commit']!=desired['commit']:
 print(json.dumps(state));raise SystemExit(0)
if files!=desired['files']:
 print(json.dumps(state));raise SystemExit(0)
for name,expected in desired['files'].items():
 filename=release/name
 if not filename.is_file() or hashlib.sha256(filename.read_bytes()).hexdigest()!=expected:
  print(json.dumps(state));raise SystemExit(0)
# HTTP health alone could belong to an old process after a manual symlink change.
pid=subprocess.check_output(['systemctl','show','maanshan','--property=MainPID','--value'],timeout=5).decode().strip()
healthy=False
if pid.isdigit() and int(pid)>0:
 try:
  working=subprocess.check_output(['readlink','-f','/proc/'+pid+'/cwd'],timeout=5).decode().strip()
  if Path(working)==release:
   health=subprocess.check_output(['curl','-fsS','--max-time','3','http://127.0.0.1:3100/api/health'],timeout=5)
   page=subprocess.check_output(['curl','-fsS','--max-time','10','--resolve','mandarin.aiducation.asia:443:127.0.0.1','https://mandarin.aiducation.asia/maanshan/'],timeout=12)
   status=json.loads(health)
   healthy=isinstance(status,dict) and status.get('ok') is True and hashlib.sha256(page).hexdigest()==desired['files']['public/maanshan/index.html']
 except (subprocess.CalledProcessError,subprocess.TimeoutExpired,json.JSONDecodeError):
  healthy=False
state['matches']=healthy
print(json.dumps(state))
""".replace('DESIRED',repr(desired))


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
    parser.add_argument('--force',action='store_true',help='Rebuild and restart even when the same release is healthy.')
    args=parser.parse_args()
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT).strip():
        raise RuntimeError('Commit the intended website changes before deployment.')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    release='/srv/maanshan/releases/'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+commit[:10]+'-'+uuid.uuid4().hex[:8]
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
        if not args.force:
            current=json.loads(command(client,'python3 -',current_release_probe(commit,manifest)))
            if current.get('matches') is True:
                print('Already current: '+commit[:10]+'. Release files and live service verified; no restart needed.')
                print('Live: https://mandarin.aiducation.asia/maanshan/')
                print('Release:',current['release'])
                return
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
exec 9>/srv/maanshan/.deploy.lock
if ! flock -n 9; then
  printf 'Deployment activation lock unavailable; no release was switched.\\n' >&2
  exit 1
fi
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
