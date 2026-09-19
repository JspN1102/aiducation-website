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
SOURCE = re.compile(r'/maanshan/media/(?:[a-z0-9_-]+/)*[a-z0-9_-]+\.(?:mp4|glb)\Z')
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
        model = source.endswith('.glb')
        expected_path = '/published/' + sha[:20] + source if model else source
        destination = entry.get('destination', '')
        if destination != COS_ORIGIN + expected_path:
            raise ValueError('COS destination does not match source and content digest')
        parsed = urlsplit(destination)
        if parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('COS routes must not contain query secrets or fragments')
        expected_type = 'model/gltf-binary' if model else 'video/mp4'
        if entry.get('contentType') != expected_type:
            raise ValueError('Unexpected media content type')
        expected_cache = 'public, max-age=31536000, immutable' if model else 'public, max-age=2592000'
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
    asset is omitted individually; no broad media directory is redirected.
    """
    assets = validated_assets(manifest)
    return {
        'redirects': [{'source': asset['source'], 'destination': asset['destination'],
                       'statusCode': 307} for asset in assets],
        'headers': [{'source': asset['source'], 'headers': [
            {'key': 'Cache-Control', 'value': 'no-cache'}]} for asset in assets],
        'excludedFiles': [asset['source'].lstrip('/') for asset in assets],
        'totalExcludedBytes': sum(asset['bytes'] for asset in assets),
    }


def verify_local_assets(repo, manifest):
    """Read each local binary before packaging; fail closed if mapping is stale.

    Files must still exist locally even though the packager excludes them from
    deployment output. A new local video or model requires a new COS mapping.
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
