"""Prepare an isolated Mandarin-only Vercel site; never deploy the company site."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess

from media_config import build_media_config, verify_local_assets, obsolete_audio_files
from public_school import TEXT_SUFFIXES, public_path, public_source, public_routes, is_authoring_file
from module_preloads import render_index

ROOT = Path(__file__).resolve().parent.parent
API_FILES = {'soe.js', 'tts.js', 'maanshan-chat.js', 'maanshan-report.js',
             'maanshan-save.js', 'maanshan-data.js', 'handwriting.js',
             'school-auth.js', 'school-recordings.js', 'research-events.js', 'teacher-analytics.js', 'challenge-result.js', 'teacher-tools.js'}
RELAY_FILE = 'api/_lib/guangzhou-relay.cjs'
RELAY_RUNTIME = {RELAY_FILE, 'api/_lib/response-encoding.cjs'}
# One shared function serves the thirteen fixed school endpoints.
# Guangzhou persists long report jobs and returns 202 for polling. Individual
# relay requests still finish before Vercel's 60-second function deadline.
FUNCTION_SECONDS = {name: 60 for name in API_FILES}


def relay_entry(filename):
    """A URL cannot select an upstream route; only this fixed allowlist can."""
    if filename not in API_FILES:
        raise ValueError('Unknown school API entry.')
    return ("'use strict';\n"
            "const {relay}=require('./_lib/guangzhou-relay.cjs');\n"
            f"module.exports=(req,res)=>relay('{Path(filename).stem}',req,res);\n")


def functions_config():
    if set(FUNCTION_SECONDS) != API_FILES or len(API_FILES) != 13:
        raise RuntimeError('School relay endpoints and duration limits disagree.')
    return {'api/school-gateway.js': {'maxDuration': 60}}


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
    # The recital buttons, old 3D mascot and lower-grade models (no AR below
    # grade 4) are not used by this platform. The older mountain, river and
    # field models remain the assessment viewer's models.
    unused = {'maanshan/media/shishi/model.glb', 'maanshan/media/shishi/guide-v2.glb',
              'maanshan/media/challenges/sound-pod-v1.glb',
              'maanshan/media/exploration/yong-e/model.glb',
              'maanshan/media/exploration/zeng-wang-lun/model.glb'}
    # Every deployed 3D model also needs its verified COS copy: the page hedges
    # between the two routes, so a model with one route would fail alone.
    published_models = {model['source'].lstrip('/') for model in media_config['models']}
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    destination.mkdir(parents=True)
    copied, skipped, models = [], [], 0
    for relative in paths:
        if not relative or any(part.startswith('.') for part in Path(relative).parts):
            continue
        public = relative.startswith('maanshan/') or relative == 'favicon.png'
        # All stateful/auth/research/provider work stays on Guangzhou. None of
        # the old Blob, database or AI modules belongs in a public function.
        runtime = relative in RELAY_RUNTIME
        if not (public or runtime or relative in {'package.json', 'package-lock.json'}):
            continue
        source = ROOT / relative
        if source.is_symlink():
            raise RuntimeError('Unexpected symlink in deployment input.')
        if relative in omit or relative in unused or relative.endswith('/recital.mp4') or is_authoring_file(relative):
            skipped.append({'path': relative, 'bytes': source.stat().st_size})
            continue
        if relative.endswith('.glb'):
            if relative not in published_models:
                raise RuntimeError('A deployed 3D model has no verified COS mapping: ' + relative)
            models += 1
        target_relative = public_path(relative)
        target = destination / target_relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if relative in {'api/' + name for name in API_FILES}:
            target.write_text(relay_entry(Path(relative).name), encoding='utf-8')
        elif relative.startswith('maanshan/') and target.suffix in TEXT_SUFFIXES:
            content = source.read_text(encoding='utf-8')
            if relative == 'maanshan/index.html' and 'bootstrap.mjs' in content:
                content = render_index(ROOT / 'maanshan', content)
            target.write_text(public_source(content), encoding='utf-8', newline='')
        else:
            shutil.copyfile(source, target)
        copied.append({'path': target_relative, 'bytes': target.stat().st_size,
                       'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    gateway=destination/'api/school-gateway.js'
    gateway.write_text("'use strict';\nmodule.exports=require('./_lib/guangzhou-relay.cjs').gateway;\n",encoding='utf-8')
    copied.append({'path':'api/school-gateway.js','bytes':gateway.stat().st_size,'sha256':hashlib.sha256(gateway.read_bytes()).hexdigest()})
    expected_runtime = RELAY_RUNTIME | {'api/school-gateway.js'}
    packaged_runtime = {row['path'] for row in copied if row['path'].startswith('api/')}
    if packaged_runtime != expected_runtime:
        raise RuntimeError('The school relay runtime is incomplete; commit all reviewed relay files.')
    # Animations ship on this origin as well: the page falls back between the
    # deployed copy and the COS copy, so both must exist for every current poem.
    poems = json.loads((ROOT / 'maanshan/poems.json').read_text(encoding='utf-8'))['poems']
    published = {video['source'].lstrip('/') for video in media_config['videos']}
    for poem in poems:
        video = 'maanshan/' + poem['animation']['src']
        if video not in published or video in omit:
            raise RuntimeError('A current animation has no verified COS mapping.')
    config = {
        'trailingSlash': True,
        'regions': ['iad1'],
        'functions': functions_config(),
        'rewrites': [{'source':'/api/'+Path(name).stem+'/', 'destination':'/api/school-gateway/?__school_route='+Path(name).stem} for name in sorted(API_FILES)],
        'redirects': [{'source': '/', 'destination': '/school/', 'statusCode': 307},
                      {'source': '/maanshan', 'destination': '/school/', 'statusCode': 307},
                      {'source': '/maanshan/', 'destination': '/school/', 'statusCode': 307},
                      {'source': '/maanshan/:path*', 'destination': '/school/:path*', 'statusCode': 307},
                      {'source': '/favicon.ico', 'destination': '/favicon.png', 'statusCode': 307},
                      *public_routes(media_config['redirects'])],
        'headers': [
            {'source': '/(.*)', 'headers': [
                {'key': 'X-Content-Type-Options', 'value': 'nosniff'},
                {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}]},
            {'source': '/school/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=0, must-revalidate'}]},
            {'source': '/school/recovery-sw.js', 'headers': [
                {'key': 'Cache-Control', 'value': 'no-cache'},
                {'key': 'Service-Worker-Allowed', 'value': '/'}]},
            {'source': '/school/media/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=2592000'}]},
            {'source': '/school/vendor/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=2592000'}]},
            {'source': '/api/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'private, no-store'}]},
            *public_routes(media_config['headers']),
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
               'dualRouteVideos': len(published), 'dualRouteModels': models,
               'companyProjectUnchanged': True,
               'apiRuntime': 'guangzhou-ssh-relay', 'apiFunctions': 1}
    destination.with_suffix('.manifest.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps({key: summary[key] for key in summary if key not in ['files', 'excluded']}))


if __name__ == '__main__':
    main()
