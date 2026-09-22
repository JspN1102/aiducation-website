"""Validate the public COS manifest and generate the browser's second routes.

Every teaching binary ships on the page's own origin (the Vercel deployment)
and is published on COS as well; the browser keeps whichever route answers,
because Hong Kong networks often lose packets to Guangzhou COS while mainland
networks are slow to reach Vercel. The Guangzhou origin, whose uplink is
shared by the whole class, still redirects every published file to COS.
No credentials, network access or production mutations are used here.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


COS_ORIGIN = 'https://aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com'
SOURCE = re.compile(r'/maanshan/(?:media/(?:[a-z0-9_-]+/)*[a-z0-9_-]+\.(?:mp4|glb|webp|mp3|m4a)'
                    r'|vendor/fonts/[a-z0-9_-]+\.woff2)\Z')
AUDIO_SOURCE = re.compile(r'/maanshan/media/((?:[a-z0-9_-]+/)*[a-z0-9_-]+)/[a-z0-9_-]+\.(?:mp3|m4a)\Z')
AUDIO_FILENAME = re.compile(r'[a-z0-9][a-z0-9_-]*\.mp3\Z')
TYPES = {'.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.webp': 'image/webp',
         '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2'}
IMMUTABLE = 'public, max-age=31536000, immutable'
MONTH = 'public, max-age=2592000'
VERSION_TAG = '20260923-school23'
PACK_CACHE = 'maanshan-pack-v1'
PACK_SCOPE = 'deploy/pack-scope.json'


def group_id(members):
    """Shared prefix of one recorded-audio folder: digest of every clip's digest."""
    lines = sorted(source + ' ' + sha for source, sha in members)
    return hashlib.sha256('\n'.join(lines).encode()).hexdigest()[:20]


def validated_assets(manifest):
    """Return independent sorted entries, rejecting unsafe or stale routing keys.

    Models, images and fonts are content addressed (``/published/<sha256[:20]>``).
    Recorded audio is published per folder under ``/published/g-<group id>``,
    where the group id is recomputed here from every clip of that folder, so a
    manifest that lists a folder incompletely or with a changed clip fails.
    Animations keep their path with a 30-day object cache.
    """
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1:
        raise ValueError('Unsupported media manifest schema')
    if manifest.get('origin') != COS_ORIGIN:
        raise ValueError('Unexpected COS origin')
    entries = manifest.get('assets')
    if not isinstance(entries, list) or not entries:
        raise ValueError('Media manifest must contain assets')
    sources, destinations, result, groups = set(), set(), [], {}
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
        extension = source[source.rfind('.'):]
        audio = AUDIO_SOURCE.fullmatch(source)
        group = entry.get('group')
        if audio:
            if group != audio.group(1):
                raise ValueError('Recorded audio must name its folder group: ' + source)
            groups.setdefault(group, []).append((source, sha))
        elif group is not None:
            raise ValueError('Only recorded audio is published in groups: ' + source)
        if entry.get('contentType') != TYPES[extension]:
            raise ValueError('Unexpected media content type')
        versioned = extension != '.mp4'
        if entry.get('objectCacheControl') != (IMMUTABLE if versioned else MONTH):
            raise ValueError('Unexpected media object cache policy')
        destination = entry.get('destination', '')
        if not isinstance(destination, str):
            raise ValueError('COS destination must be a string')
        if source in sources or destination in destinations:
            raise ValueError('Duplicate media source or destination')
        sources.add(source)
        destinations.add(destination)
        result.append(deepcopy(entry))
    ids = {name: group_id(members) for name, members in groups.items()}
    for entry in result:
        source, sha = entry['source'], entry['sha256']
        if entry.get('group'):
            prefix = '/published/g-' + ids[entry['group']]
        elif not source.endswith('.mp4'):
            prefix = '/published/' + sha[:20]
        else:
            prefix = ''
        if entry['destination'] != COS_ORIGIN + prefix + source:
            raise ValueError('COS destination does not match source and content digest: ' + source)
        parsed = urlsplit(entry['destination'])
        if parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('COS routes must not contain query secrets or fragments')
    return sorted(result, key=lambda asset: asset['source'])


def build_media_config(manifest):
    """Pure function: every published file and its two routes.

    ``redirects`` and ``headers`` can merge into vercel.json and are now empty:
    nothing is redirected away from the deployment any more, because a
    redirect would leave a file with the COS route only. ``excludedFiles`` is
    kept for the packager and is empty for the same reason. Animations
    (``videos``), 3D models (``models``), teaching images (``images``), fonts
    and recorded audio (``audio``, grouped by folder in ``audioGroups``) ship
    on the page's own origin and on COS.
    """
    assets = validated_assets(manifest)
    by_type = lambda kind: [asset for asset in assets if asset['contentType'] == kind and not asset.get('group')]
    route = lambda asset: {'source': asset['source'], 'destination': asset['destination'], 'bytes': asset['bytes']}
    audio = [asset for asset in assets if asset.get('group')]
    groups = {}
    for asset in audio:
        prefix = asset['destination'][:asset['destination'].rindex(asset['source'])]
        group = groups.setdefault(asset['group'], {'prefix': prefix, 'files': [], 'bytes': 0})
        group['files'].append(asset['source'])
        group['bytes'] += asset['bytes']
    return {
        'redirects': [],
        'headers': [],
        'excludedFiles': [],
        'totalExcludedBytes': 0,
        'videos': [route(asset) for asset in by_type('video/mp4')],
        'models': [route(asset) for asset in by_type('model/gltf-binary')],
        'images': [route(asset) for asset in by_type('image/webp')],
        'fonts': [route(asset) for asset in by_type('font/woff2')],
        'audio': [route(asset) for asset in audio],
        'audioGroups': groups,
    }


def _module(comment, name, mapping):
    return ('// Generated by deploy/media_config.py --write. ' + comment + '\n'
            'export const ' + name + ' = Object.freeze(' + json.dumps(mapping, indent=2) + ');\n')


def build_video_module(manifest):
    """Exact public animation copies for the browser's second playback route.

    ``maanshan/animation-source.mjs`` starts with the route the session probe
    favours and switches to the other copy when playback errors or stalls.
    This module imports nothing so it never lengthens the versioned import
    chain of the page.
    """
    videos = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'video/mp4']
    return _module('Public animation copies only.', 'VIDEO_ASSETS',
                   {asset['source']: asset['destination'] for asset in videos})


def build_model_module(manifest):
    """Exact public 3D model copies for the browser's hedged second route.

    ``maanshan/model-source.mjs`` downloads a model from the route the session
    favours and also from the other copy when the first fails, stalls or is
    slow; the first complete valid model wins. Content-addressed objects never
    change, so the page may cache them indefinitely. This module imports
    nothing so it never lengthens the versioned import chain of the page.
    """
    models = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'model/gltf-binary']
    return _module('Public 3D model copies only.', 'MODEL_ASSETS',
                   {asset['source']: asset['destination'] for asset in models})


def build_font_module(manifest):
    """Exact public font copies: ``maanshan/font-source.mjs`` loads each face
    from the route the session favours and falls back to the other copy."""
    fonts = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'font/woff2']
    return _module('Public font copies only.', 'FONT_ASSETS',
                   {asset['source']: asset['destination'] for asset in fonts})


def build_audio_module(manifest):
    """One public prefix per recorded-audio folder.

    ``maanshan/audio-source.mjs`` derives the COS copy of any clip from its
    folder prefix, so the page does not carry a map of hundreds of clips. The
    packager checks that every clip the indexes reference is in its group.
    """
    groups = build_media_config(manifest)['audioGroups']
    mapping = {'/maanshan/media/' + name + '/': group['prefix'] + '/maanshan/media/' + name + '/'
               for name, group in sorted(groups.items())}
    return _module('Public recorded audio folders only.', 'AUDIO_GROUPS', mapping)


def pack_entries(manifest):
    """Every published file as the resource pack lists it: path relative to
    the page, both routes' digest and size, in a stable order."""
    entries = []
    for asset in validated_assets(manifest):
        entries.append({'path': asset['source'][len('/maanshan/'):], 'remote': asset['destination'],
                        'bytes': asset['bytes'], 'sha256': asset['sha256'], 'type': asset['contentType']})
    return entries


def pack_version(entries):
    lines = sorted(entry['path'] + ' ' + entry['sha256'] for entry in entries)
    return hashlib.sha256('\n'.join(lines).encode()).hexdigest()[:20]


def load_pack_scope(repo):
    """Which grades each packed file serves, as ``scripts/build-pack-scope.cjs``
    derived it from the poems, challenges and recording indexes. Files absent
    from the scope reach every pack."""
    root = Path(repo).resolve(strict=True)
    data = json.loads((root / PACK_SCOPE).read_text(encoding='utf-8'))
    if not isinstance(data, dict) or data.get('schemaVersion') != 1 or not isinstance(data.get('grades'), dict):
        raise ValueError('Unsupported pack scope schema')
    scope = {}
    for path, grades in data['grades'].items():
        if (not isinstance(path, str) or not isinstance(grades, list) or not grades or len(grades) > 12
                or any(type(grade) is not int or grade < 1 or grade > 12 for grade in grades)
                or grades != sorted(set(grades))):
            raise ValueError('Invalid pack scope entry: ' + str(path))
        scope[path] = list(grades)
    return scope


def build_pack_manifest(manifest, scope=None):
    """The offline resource pack: what ``maanshan/resource-pack.mjs`` downloads
    in the background and ``maanshan/recovery-sw.js`` serves from the cache.

    ``version`` changes whenever any file changes, so a pack downloaded for an
    older deployment is recognised as outdated instead of served stale. Paths
    are relative to the page, so the same file works under ``/school/`` and
    ``/maanshan/``. With a ``scope`` (``load_pack_scope``) an entry carries the
    ``grades`` whose pupils need it; entries without ``grades`` reach every
    pack. The scope changes neither the version nor the byte total.
    """
    entries = pack_entries(manifest)
    if scope:
        stale = sorted(set(scope) - {entry['path'] for entry in entries})
        if stale:
            raise ValueError('Pack scope lists a file the media manifest does not publish: ' + stale[0])
        for entry in entries:
            if entry['path'] in scope:
                entry['grades'] = list(scope[entry['path']])
    return json.dumps({'schemaVersion': 1, 'version': pack_version(entries), 'cache': PACK_CACHE,
                       'totalBytes': sum(entry['bytes'] for entry in entries), 'assets': entries},
                      indent=1, ensure_ascii=True) + '\n'


def verify_local_assets(repo, manifest):
    """Read each local binary before packaging; fail closed if mapping is stale.

    Files must still exist locally because the packager ships every one of
    them as the page's own route. A new local file requires a new COS mapping.
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


def probe_image(manifest):
    """The smallest public image: one request settles the session's route."""
    images = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'image/webp']
    return min(images, key=lambda asset: (asset['bytes'], asset['source']))['destination'] if images else ''


def build_image_module(manifest):
    """One exact public image map shared by page previews and painting loading.

    Every WebP ships on the page's own origin and on COS; ``imageRoutes`` in
    ``maanshan/image-policy.mjs`` orders the two by the session's route memory
    and probe. Full-size JPEG/PNG copies on the same origin remain the choice
    for browsers that cannot decode WebP and the last fallback for the rest.
    """
    assets = [asset for asset in validated_assets(manifest) if asset['contentType'] == 'image/webp']
    images = {asset['source']: asset['destination'] for asset in assets}
    return ('// Generated by deploy/media_config.py --write. Public teaching images only.\n'
            'import {COMPAT_IMAGES} from "./image-compat.mjs?v=20260920-art2";\n'
            'import {imageRoutes, probePublicImages} from "./image-policy.mjs?v=' + VERSION_TAG + '";\n'
            'export const IMAGE_ASSETS = Object.freeze(' + json.dumps(images, indent=2) + ');\n'
            'export const publicImagesReady = probePublicImages(' + json.dumps(probe_image(manifest)) + ');\n'
            'export function imageAsset(source) {\n'
            '  if (typeof source !== "string") return source;\n'
            '  const path = source.startsWith("media/") ? "/maanshan/" + source : source.split("?")[0];\n'
            '  return imageRoutes(path, IMAGE_ASSETS[path], COMPAT_IMAGES[path])[0] || source;\n'
            '}\n')


def render_index_meta(html, manifest):
    """Keep ``maanshan/index.html`` current: the inline early probe points at
    the smallest public image, and the page announces the resource pack
    version so the worker never serves a pack of an older deployment."""
    values = {'school-cos-probe': probe_image(manifest), 'school-pack': pack_version(pack_entries(manifest))}
    for name, value in values.items():
        pattern = re.compile('<meta name="' + name + '" content="[^"]*">')
        if len(pattern.findall(html)) != 1:
            raise ValueError('index.html must carry exactly one ' + name + ' meta tag')
        html = pattern.sub('<meta name="' + name + '" content="' + value + '">', html)
    return html


def build_nginx_config(manifest):
    return ''.join('location = ' + asset['source'] +
                   ' { add_header Cache-Control "no-cache"; return 307 ' +
                   asset['destination'] + '; }\n' for asset in validated_assets(manifest))


def audio_indexes(repo):
    """Map each audio folder to the clip names its trusted index references.

    Parse the two JSON object exports as data, never execute JavaScript.
    A malformed index or missing current audio fails packaging.
    """
    root = Path(repo).resolve(strict=True)
    referenced = {}
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
        referenced[folder] = current
    return referenced


def obsolete_audio_files(repo):
    """Return POSIX repository-relative old MP3 paths safe to omit from output.

    Index files, all referenced recordings and non-MP3 fallbacks remain intact.
    """
    root = Path(repo).resolve(strict=True)
    obsolete = set()
    for folder, current in audio_indexes(root).items():
        directory = root / 'maanshan' / 'media' / folder
        for target in directory.iterdir():
            if target.suffix.lower() != '.mp3':
                continue
            if target.is_symlink() or not target.is_file() or not AUDIO_FILENAME.fullmatch(target.name):
                raise ValueError('Unexpected MP3 path in audio directory: ' + folder)
            if target.name not in current:
                obsolete.add(target.relative_to(root).as_posix())
    return obsolete


def verify_audio_groups(repo, manifest):
    """Every clip the indexes reference must be in its folder's COS group, and
    every current official recitation clip as well, so no recording is left
    with the deployment route only."""
    root = Path(repo).resolve(strict=True)
    groups = build_media_config(manifest)['audioGroups']
    for folder, current in audio_indexes(root).items():
        published = {Path(source).name for source in groups.get(folder, {}).get('files', [])}
        missing = sorted(current - published)
        if missing:
            raise ValueError('Recorded audio has no verified COS mapping: ' + folder + '/' + missing[0])
    recitations = root / 'maanshan/media/recitations'
    for directory in sorted(path for path in recitations.iterdir() if path.is_dir()):
        name = 'recitations/' + directory.name
        published = {Path(source).name for source in groups.get(name, {}).get('files', [])}
        clips = {path.name for path in directory.iterdir() if path.suffix == '.mp3' and path.is_file()}
        missing = sorted(clips - published)
        if missing:
            raise ValueError('Recorded audio has no verified COS mapping: ' + name + '/' + missing[0])
    return {'audioGroups': len(groups), 'audioFiles': sum(len(group['files']) for group in groups.values())}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Generate public COS routes for images, animations, models, fonts and audio.')
    parser.add_argument('--write', action='store_true', help='Write generated files; otherwise check for stale files.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / 'deploy/media-manifest.json').read_text(encoding='utf-8'))
    verify_local_assets(root, manifest)
    verify_audio_groups(root, manifest)
    scope = load_pack_scope(root)
    index = root / 'maanshan/index.html'
    generated = {root / 'maanshan/media-images.mjs': build_image_module(manifest),
                 root / 'maanshan/media-videos.mjs': build_video_module(manifest),
                 root / 'maanshan/media-models.mjs': build_model_module(manifest),
                 root / 'maanshan/media-fonts.mjs': build_font_module(manifest),
                 root / 'maanshan/media-audio.mjs': build_audio_module(manifest),
                 root / 'maanshan/pack-manifest.json': build_pack_manifest(manifest, scope),
                 root / 'deploy/maanshan-media.conf': build_nginx_config(manifest),
                 index: render_index_meta(index.read_text(encoding='utf-8'), manifest)}
    for path, body in generated.items():
        if args.write:
            if path != index or path.read_text(encoding='utf-8') != body:
                path.write_text(body, encoding='utf-8', newline='' if path == index else '\n')
        elif not path.is_file() or path.read_text(encoding='utf-8') != body:
            raise SystemExit('Stale generated media config: ' + str(path.relative_to(root)))
    print(json.dumps({'generatedFiles': len(generated), 'assets': len(manifest['assets']), 'mode': 'write' if args.write else 'check'}))
