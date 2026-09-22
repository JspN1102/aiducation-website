"""Validate the public COS manifest and generate exact Vercel media routes.

The caller must omit ``excludedFiles`` from its deployment output. Redirects
alone do not prevent duplicate binaries from consuming Deployment Storage.
No credentials, network access or production mutations are used here.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


COS_ORIGIN = 'https://aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com'
SOURCE = re.compile(r'/maanshan/media/(?:[a-z0-9_-]+/)*[a-z0-9_-]+\.(?:mp4|glb|webp)\Z')
AUDIO_FILENAME = re.compile(r'[a-z0-9][a-z0-9_-]*\.mp3\Z')


def validated_assets(manifest):
    """Return independent sorted entries, rejecting unsafe or stale routing keys."""
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1:
        raise ValueError('Unsupported media manifest schema')
    if manifest.get('origin') != COS_ORIGIN:
        raise ValueError('Unexpected COS origin')
    entries = manifest.get('assets')
    if not isinstance(entries, list) or not entries:
        raise ValueError('Media manifest must contain assets')
    sources, destinations, result = set(), set(), []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError('Media entry must be an object')
        source = entry.get('source', '')
        if not isinstance(source, str) or not SOURCE.fullmatch(source):
            raise ValueError('Media source must be an exact supported public asset path')
        sha, md5 = entry.get('sha256', ''), entry.get('md5', '')
        if not isinstance(sha, str) or not re.fullmatch(r'[a-f0-9]{64}', sha):
            raise ValueError('Invalid media SHA256')
        if not isinstance(md5, str) or not re.fullmatch(r'[a-f0-9]{32}', md5):
            raise ValueError('Invalid media MD5')
        if type(entry.get('bytes')) is not int or entry['bytes'] <= 0:
            raise ValueError('Invalid media byte count')
        model, image = source.endswith('.glb'), source.endswith('.webp')
        versioned = model or image
        expected_path = '/published/' + sha[:20] + source if versioned else source
        destination = entry.get('destination', '')
        if destination != COS_ORIGIN + expected_path:
            raise ValueError('COS destination does not match source and content digest')
        parsed = urlsplit(destination)
        if parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('COS routes must not contain query secrets or fragments')
        expected_type = 'model/gltf-binary' if model else 'image/webp' if image else 'video/mp4'
        if entry.get('contentType') != expected_type:
            raise ValueError('Unexpected media content type')
        expected_cache = 'public, max-age=31536000, immutable' if versioned else 'public, max-age=2592000'
        if entry.get('objectCacheControl') != expected_cache:
            raise ValueError('Unexpected media object cache policy')
        if source in sources or destination in destinations:
            raise ValueError('Duplicate media source or destination')
        sources.add(source)
        destinations.add(destination)
        result.append(deepcopy(entry))
    return sorted(result, key=lambda asset: asset['source'])


def build_media_config(manifest):
    """Pure function: exact 307 routes, revalidated redirects and omitted files.

    ``redirects`` and ``headers`` can merge into vercel.json. The other keys
    belong to the packager, not the Vercel configuration schema. Every mapped
    image is omitted individually and redirected exactly; no broad media
    directory is redirected. Animations (``videos``) and 3D models
    (``models``) have two routes instead: the same file is deployed on the
    page's own origin and published on COS, and the browser keeps whichever
    route answers, because Hong Kong networks often lose packets to Guangzhou
    COS while mainland networks are slow to reach Vercel.
    """
    assets = validated_assets(manifest)
    routed = [asset for asset in assets if asset['contentType'] == 'image/webp']
    videos = [asset for asset in assets if asset['contentType'] == 'video/mp4']
    models = [asset for asset in assets if asset['contentType'] == 'model/gltf-binary']
    route = lambda asset: {'source': asset['source'], 'destination': asset['destination'], 'bytes': asset['bytes']}
    return {
        'redirects': [{'source': asset['source'], 'destination': asset['destination'],
                       'statusCode': 307} for asset in routed],
        'headers': [{'source': asset['source'], 'headers': [
            {'key': 'Cache-Control', 'value': 'no-cache'}]} for asset in routed],
        'excludedFiles': [asset['source'].lstrip('/') for asset in routed],
        'totalExcludedBytes': sum(asset['bytes'] for asset in routed),
        'videos': [route(asset) for asset in videos],
        'models': [route(asset) for asset in models],
    }


def build_video_module(manifest):
    """Exact public animation copies for the browser's second playback route.

    ``maanshan/animation-source.mjs`` starts with the route the session probe
    favours and switches to the other copy when playback errors or stalls.
    This module imports nothing so it never lengthens the versioned import
    chain of the page.
    """
    videos = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'video/mp4']
    return ('// Generated by deploy/media_config.py --write. Public animation copies only.\n'
            'export const VIDEO_ASSETS = Object.freeze(' +
            json.dumps({asset['source']: asset['destination'] for asset in videos}, indent=2) + ');\n')


def build_model_module(manifest):
    """Exact public 3D model copies for the browser's hedged second route.

    ``maanshan/model-source.mjs`` downloads a model from the route the session
    favours and also from the other copy when the first fails, stalls or is
    slow; the first complete valid model wins. Content-addressed objects never
    change, so the page may cache them indefinitely. This module imports
    nothing so it never lengthens the versioned import chain of the page.
    """
    models = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'model/gltf-binary']
    return ('// Generated by deploy/media_config.py --write. Public 3D model copies only.\n'
            'export const MODEL_ASSETS = Object.freeze(' +
            json.dumps({asset['source']: asset['destination'] for asset in models}, indent=2) + ');\n')


def verify_local_assets(repo, manifest):
    """Read each local binary before packaging; fail closed if mapping is stale.

    Files must still exist locally whether the packager excludes them from
    deployment output or ships them as the second route. A new local video or
    model requires a new COS mapping.
    """
    root = Path(repo).resolve(strict=True)
    assets = validated_assets(manifest)
    for asset in assets:
        path = (root / asset['source'].lstrip('/')).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError('Media file must stay within the source repository')
        if path.stat().st_size != asset['bytes']:
            raise ValueError('Media byte count changed: ' + asset['source'])
        sha = hashlib.sha256()
        md5 = hashlib.md5()
        with path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                sha.update(chunk)
                md5.update(chunk)
        if sha.hexdigest() != asset['sha256'] or md5.hexdigest() != asset['md5']:
            raise ValueError('Media content changed: ' + asset['source'])
    return {'verifiedFiles': len(assets), 'verifiedBytes': sum(asset['bytes'] for asset in assets)}


def build_image_module(manifest):
    """One exact public image map shared by page previews and painting loading.

    Public COS copies are requested first once a small probe shows that the
    browser can reach the host and decode WebP. Full-size compatible copies on
    the same origin remain the fallback and the choice for older tablets; an
    unreachable external host must not strand pupils on tiny previews.
    """
    assets = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'image/webp']
    images = {asset['source']: asset['destination'] for asset in assets}
    probe = min(assets, key=lambda asset: asset['bytes'])['destination'] if assets else ''
    return ('// Generated by deploy/media_config.py --write. Public teaching images only.\n'
            'import {COMPAT_IMAGES} from "./image-compat.mjs?v=20260920-art2";\n'
            'import {preferPublicImages, probePublicImages} from "./image-policy.mjs?v=20260922-school16";\n'
            'export const IMAGE_ASSETS = Object.freeze(' + json.dumps(images, indent=2) + ');\n'
            'export const publicImagesReady = probePublicImages(' + json.dumps(probe) + ');\n'
            'export function imageAsset(source) {\n'
            '  if (typeof source !== "string") return source;\n'
            '  const path = source.startsWith("media/") ? "/maanshan/" + source : source.split("?")[0];\n'
            '  const local = COMPAT_IMAGES[path], remote = IMAGE_ASSETS[path];\n'
            '  return (preferPublicImages() ? remote || local : local || remote) || source;\n'
            '}\n')


def build_nginx_config(manifest):
    return ''.join('location = ' + asset['source'] +
                   ' { add_header Cache-Control "no-cache"; return 307 ' +
                   asset['destination'] + '; }\n' for asset in validated_assets(manifest))


def obsolete_audio_files(repo):
    """Return POSIX repository-relative old MP3 paths safe to omit from output.

    Parse the two trusted JSON object exports as data, never execute JavaScript.
    A malformed index or missing current audio fails packaging before omission.
    Index files, all referenced recordings and non-MP3 fallbacks remain intact.
    """
    root = Path(repo).resolve(strict=True)
    obsolete = set()
    for folder, export in [('speech', 'SPEECH_AUDIO_FILES'), ('words', 'WORD_AUDIO_FILES')]:
        directory = root / 'maanshan' / 'media' / folder
        if directory.is_symlink() or not directory.resolve(strict=True).is_relative_to(root):
            raise ValueError('Audio directory must stay within the source repository')
        index = directory / 'index.mjs'
        if index.is_symlink():
            raise ValueError('Audio index must not be a symlink')
        source = index.read_text(encoding='utf-8')
        match = re.fullmatch(r'\s*export\s+const\s+' + export +
                             r'\s*=\s*Object\.freeze\(\s*(\{.*\})\s*\);?\s*', source, re.DOTALL)
        if not match:
            raise ValueError('Unexpected audio index format: ' + folder)
        def unique_keys(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('Duplicate audio index key: ' + folder)
                result[key] = value
            return result
        mapping = json.loads(match.group(1), object_pairs_hook=unique_keys)
        if not isinstance(mapping, dict) or not mapping:
            raise ValueError('Audio index must be a nonempty object: ' + folder)
        current = set()
        for filename in mapping.values():
            if not isinstance(filename, str) or not AUDIO_FILENAME.fullmatch(filename):
                raise ValueError('Unsafe audio filename in index: ' + folder)
            target = directory / filename
            if target.is_symlink() or not target.is_file():
                raise ValueError('Referenced audio is missing or not a regular file: ' + folder + '/' + filename)
            if not target.resolve(strict=True).is_relative_to(root):
                raise ValueError('Referenced audio escapes the source repository')
            current.add(filename)
        for target in directory.iterdir():
            if target.suffix.lower() != '.mp3':
                continue
            if target.is_symlink() or not target.is_file() or not AUDIO_FILENAME.fullmatch(target.name):
                raise ValueError('Unexpected MP3 path in audio directory: ' + folder)
            if target.name not in current:
                obsolete.add(target.relative_to(root).as_posix())
    return obsolete


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Generate public COS image, animation and model URLs and Nginx routes.')
    parser.add_argument('--write', action='store_true', help='Write generated files; otherwise check for stale files.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / 'deploy/media-manifest.json').read_text(encoding='utf-8'))
    verify_local_assets(root, manifest)
    generated = {root / 'maanshan/media-images.mjs': build_image_module(manifest),
                 root / 'maanshan/media-videos.mjs': build_video_module(manifest),
                 root / 'maanshan/media-models.mjs': build_model_module(manifest),
                 root / 'deploy/maanshan-media.conf': build_nginx_config(manifest)}
    for path, body in generated.items():
        if args.write:
            path.write_text(body, encoding='utf-8', newline='\n')
        elif not path.is_file() or path.read_text(encoding='utf-8') != body:
            raise SystemExit('Stale generated media config: ' + str(path.relative_to(root)))
    print(json.dumps({'generatedFiles': len(generated), 'assets': len(manifest['assets']), 'mode': 'write' if args.write else 'check'}))
