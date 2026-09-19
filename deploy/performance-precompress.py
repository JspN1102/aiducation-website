"""Prepare deterministic gzip sidecars for public Mandarin text assets.

Dry-run by default. With --write, only .gz sidecars inside <public-root>/maanshan
are atomically created; source files are never edited. Run during release build,
before enabling gzip_static and before switching the current release symlink.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import os
import tempfile


TEXT_SUFFIXES = {'.html', '.js', '.mjs', '.css', '.json', '.svg'}
MAX_SOURCE_BYTES = 16 * 1024 * 1024


def precompress(public_root, write=False):
    root = Path(public_root).resolve(strict=True)
    directory = root / 'maanshan'
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('Expected a regular public maanshan directory')
    result = {'mode': 'write' if write else 'dry-run', 'files': [], 'unchanged': 0}
    for source in sorted(directory.rglob('*')):
        if source.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if source.is_symlink() or not source.resolve(strict=True).is_relative_to(directory.resolve()):
            raise ValueError('Public text source must not escape its directory')
        if not source.is_file():
            continue
        target = source.with_name(source.name + '.gz')
        if target.is_symlink():
            raise ValueError('Refusing to overwrite a symlinked gzip sidecar')
        stat = source.stat()
        if not 1024 <= stat.st_size <= MAX_SOURCE_BYTES:
            if write and target.is_file():
                target.unlink()
            continue
        content = source.read_bytes()
        compressed = gzip.compress(content, compresslevel=9, mtime=0)
        if len(compressed) >= len(content) * .95:
            if write and target.is_file():
                target.unlink()
            continue
        if write:
            if target.is_file() and target.read_bytes() == compressed and target.stat().st_mtime_ns == stat.st_mtime_ns:
                result['unchanged'] += 1
            else:
                descriptor, temporary = tempfile.mkstemp(prefix='.performance-gzip-', dir=source.parent)
                temporary = Path(temporary)
                try:
                    with os.fdopen(descriptor, 'wb') as stream:
                        stream.write(compressed)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.chmod(temporary, stat.st_mode & 0o777)
                    os.utime(temporary, ns=(stat.st_atime_ns, stat.st_mtime_ns))
                    os.replace(temporary, target)
                finally:
                    if temporary.exists():
                        temporary.unlink()
        result['files'].append({'path': source.relative_to(root).as_posix(), 'bytes': len(content),
                                'gzipBytes': len(compressed), 'sha256': hashlib.sha256(content).hexdigest(),
                                'gzipSHA256': hashlib.sha256(compressed).hexdigest()})
    result['fileCount'] = len(result['files'])
    result['sourceBytes'] = sum(row['bytes'] for row in result['files'])
    result['gzipBytes'] = sum(row['gzipBytes'] for row in result['files'])
    return result


def verify_precompressed(public_root):
    """Derive the complete expected sidecars from current public source bytes.

    No saved manifest is trusted: a missing or changed gzip prevents deployment
    no-op. This also rejects stale sidecars after a source stops qualifying.
    """
    root = Path(public_root).resolve(strict=True)
    expected = precompress(root, write=False)
    paths = set()
    errors = []
    for row in expected['files']:
        source = root / row['path']
        target = source.with_name(source.name + '.gz')
        paths.add(target)
        if not target.is_file() or target.is_symlink():
            errors.append({'path': row['path'], 'reason': 'missing gzip'})
        elif target.stat().st_size != row['gzipBytes'] or hashlib.sha256(target.read_bytes()).hexdigest() != row['gzipSHA256']:
            errors.append({'path': row['path'], 'reason': 'gzip content mismatch'})
        elif target.stat().st_mtime_ns != source.stat().st_mtime_ns:
            errors.append({'path': row['path'], 'reason': 'gzip modification time mismatch'})
    for source in (root / 'maanshan').rglob('*'):
        if source.suffix.lower() in TEXT_SUFFIXES and source.is_file():
            target = source.with_name(source.name + '.gz')
            if target.exists() and target not in paths:
                errors.append({'path': source.relative_to(root).as_posix(), 'reason': 'stale gzip for ineligible source'})
    return {'verified': not errors, 'fileCount': len(paths), 'sourceBytes': expected['sourceBytes'],
            'gzipBytes': expected['gzipBytes'], 'errors': errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-root', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true')
    mode.add_argument('--verify', action='store_true')
    parser.add_argument('--summary', action='store_true')
    args = parser.parse_args()
    result = verify_precompressed(args.public_root) if args.verify else precompress(args.public_root, args.write)
    displayed = {key: result[key] for key in ('fileCount', 'sourceBytes', 'gzipBytes', 'unchanged', 'verified', 'errors') if key in result} if args.summary else result
    if args.summary and 'errors' in displayed:
        displayed['errors'] = displayed['errors'][:10]
    print(json.dumps(displayed, indent=2))
    if args.verify and not result['verified']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
