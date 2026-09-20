"""Prepare an isolated Mandarin-only Vercel site; never deploy the company site."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess

from media_config import build_media_config, verify_local_assets, obsolete_audio_files

ROOT = Path(__file__).resolve().parent.parent
API_FILES = {'soe.js', 'tts.js', 'maanshan-chat.js', 'maanshan-report.js',
             'maanshan-save.js', 'maanshan-data.js', 'handwriting.js',
             'school-auth.js', 'research-events.js', 'teacher-analytics.js', 'challenge-result.js', 'teacher-tools.js'}
RELAY_FILE = 'api/_lib/guangzhou-relay.cjs'
# Keep one function per existing school endpoint (the Hobby limit is 12).
# The 65-second Guangzhou report route is capped by Vercel's 60-second limit;
# the relay enforces its own shorter upstream deadline before that limit.
FUNCTION_SECONDS = {name: 60 for name in API_FILES}


def relay_entry(filename):
    """A URL cannot select an upstream route; only this fixed allowlist can."""
    if filename not in API_FILES:
        raise ValueError('Unknown school API entry.')
    return ("'use strict';\n"
            "const {relay}=require('./_lib/guangzhou-relay.cjs');\n"
            f"module.exports=(req,res)=>relay('{Path(filename).stem}',req,res);\n")


def functions_config():
    if set(FUNCTION_SECONDS) != API_FILES or len(API_FILES) != 12:
        raise RuntimeError('School relay endpoints and duration limits disagree.')
    return {'api/' + name: {'maxDuration': FUNCTION_SECONDS[name]}
            for name in sorted(API_FILES)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--team-id', required=True)
    args = parser.parse_args()
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise RuntimeError('Commit the reviewed changes before packaging.')
    destination = Path(args.destination).resolve()
    if destination == ROOT or destination.is_relative_to(ROOT):
        raise RuntimeError('Use an isolated directory outside the source checkout.')
    if destination.exists():
        raise RuntimeError('Use a fresh destination; existing deployments are preserved.')
    source_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    media = json.loads((ROOT / 'deploy/media-manifest.json').read_text(encoding='utf-8'))
    verify_local_assets(ROOT, media)
    media_config = build_media_config(media)
    omit = set(media_config['excludedFiles']) | obsolete_audio_files(ROOT)
    # The recital buttons and old 3D mascot have been removed from this platform.
    # Keep old assessment mountain/river models for existing browser records.
    unused = {'maanshan/media/shishi/model.glb', 'maanshan/media/shishi/guide-v2.glb',
              'maanshan/media/challenges/sound-pod-v1.glb',
              'maanshan/media/exploration/gui-yuan-tian-ju/model.glb',
              'maanshan/media/exploration/yong-e/model.glb',
              'maanshan/media/exploration/zeng-wang-lun/model.glb'}
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    destination.mkdir(parents=True)
    copied, skipped = [], []
    for relative in paths:
        if not relative or any(part.startswith('.') for part in Path(relative).parts):
            continue
        public = relative.startswith('maanshan/') or relative == 'favicon.png'
        # All stateful/auth/research/provider work stays on Guangzhou. None of
        # the old Blob, database or AI modules belongs in a public function.
        runtime = relative == RELAY_FILE or relative in {'api/' + name for name in API_FILES}
        if not (public or runtime or relative in {'package.json', 'package-lock.json'}):
            continue
        source = ROOT / relative
        if source.is_symlink():
            raise RuntimeError('Unexpected symlink in deployment input.')
        if relative in omit or relative in unused or relative.endswith('/recital.mp4'):
            skipped.append({'path': relative, 'bytes': source.stat().st_size})
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if relative in {'api/' + name for name in API_FILES}:
            target.write_text(relay_entry(Path(relative).name), encoding='utf-8')
        else:
            shutil.copyfile(source, target)
        copied.append({'path': relative, 'bytes': target.stat().st_size,
                       'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    expected_runtime = {RELAY_FILE} | {'api/' + name for name in API_FILES}
    packaged_runtime = {row['path'] for row in copied if row['path'].startswith('api/')}
    if packaged_runtime != expected_runtime:
        raise RuntimeError('The school relay runtime is incomplete; commit all reviewed relay files.')
    poems = json.loads((ROOT / 'maanshan/poems.json').read_text(encoding='utf-8'))['poems']
    for poem in poems:
        video = 'maanshan/' + poem['animation']['src']
        if video not in omit:
            raise RuntimeError('A current animation has no verified COS mapping.')
    config = {
        'trailingSlash': True,
        'regions': ['hkg1'],
        'functions': functions_config(),
        'redirects': [{'source': '/', 'destination': '/maanshan/', 'statusCode': 307},
                      {'source': '/favicon.ico', 'destination': '/favicon.png', 'statusCode': 307},
                      *media_config['redirects']],
        'headers': [
            {'source': '/(.*)', 'headers': [
                {'key': 'X-Content-Type-Options', 'value': 'nosniff'},
                {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}]},
            {'source': '/maanshan/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=0, must-revalidate'}]},
            {'source': '/maanshan/media/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=2592000'}]},
            {'source': '/maanshan/vendor/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=2592000'}]},
            {'source': '/api/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'private, no-store'}]},
            *media_config['headers'],
        ],
    }
    (destination / 'vercel.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
    (destination / '.vercelignore').write_text('.env*\n.git/\nnode_modules/\n', encoding='utf-8')
    (destination / '.vercel').mkdir()
    (destination / '.vercel/project.json').write_text(json.dumps({
        'projectId': args.project_id, 'orgId': args.team_id,
        'projectName': 'aiducation-mandarin-temporary'}), encoding='utf-8')
    # This metadata is deliberately outside the public deploy directory.
    summary = {'sourceCommit': source_commit, 'directory': str(destination),
               'projectId': args.project_id, 'files': copied, 'excluded': skipped,
               'fileCount': len(copied), 'uploadBytes': sum(row['bytes'] for row in copied),
               'omittedBytes': sum(row['bytes'] for row in skipped),
               'companyProjectUnchanged': True,
               'apiRuntime': 'guangzhou-ssh-relay', 'apiFunctions': len(API_FILES)}
    destination.with_suffix('.manifest.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps({key: summary[key] for key in summary if key not in ['files', 'excluded']}))


if __name__ == '__main__':
    main()
