"""Add an isolated school entrance to the exact saved company deployment.

This only builds files. It never changes DNS, Vercel, server settings or secrets.
Run package-vercel.py first at the same clean commit, then pass that directory.
"""
from pathlib import Path, PurePosixPath
import argparse
import copy
import hashlib
import json
import re
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BASE_COMMIT = '7a39b1a94ddc06aecaab05a92f5d26c632b5520a'
BASE_ARCHIVE = Path('D:/桌面/马鞍山/初春小雨五字精修_20260919/website-7a39b1a.zip')
BASE_SHA256 = '3bfe427f2abfcc2117d5d24600e307b6ef6de43b06fbb0227df10ef3c1a6159c'
COMPANY_PROJECT = 'prj_bqY58Gj2ysGIw7UaFgfU6AheN4Us'
SCHOOL_PROJECT = 'prj_BXHyIePcHYn42fprA8v1zB2rvSF1'
TEAM = 'team_6bMNzzu5QidBaJlDV3R4icEd'
SCHOOL_ORIGIN = 'https://mandarin.aiducation.asia'
API_NAMES = frozenset(['soe', 'tts', 'maanshan-chat', 'maanshan-report',
                      'maanshan-save', 'maanshan-data', 'handwriting',
                      'school-auth', 'school-recordings', 'research-events',
                      'teacher-analytics', 'challenge-result', 'teacher-tools'])
TEXT_SUFFIXES = {'.js', '.mjs', '.html', '.json', '.css'}
LOCAL_LITERAL = re.compile(r'([\"\'`])(/maanshan/|/api/)')
REMOTE_URL = re.compile(r'https?://[^\s\"\'`<>]+')


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def safe_relative(name):
    path = PurePosixPath(name)
    if not name or '\\' in name or ':' in name or path.is_absolute() or any(
            part in ('', '.', '..') for part in name.split('/')):
        raise ValueError('Unsafe package path.')
    for part in path.parts:
        if part.startswith('.env') or part in ('.git', '.vercel') or '.private.' in part:
            raise ValueError('Private file is not allowed in a public package.')
    return path


def relocate_path(value):
    """Only leading local paths change; COS paths inside URLs stay intact."""
    if value.startswith('/maanshan/'):
        return '/school/' + value[len('/maanshan/'):]
    if value.startswith('/api/'):
        return '/school-api/' + value[len('/api/'):]
    return value


def relocate_source(source):
    before_urls = REMOTE_URL.findall(source)
    result = LOCAL_LITERAL.sub(lambda match: match[1] + relocate_path(match[2]), source)
    # Anchored JavaScript regular expressions are not string literals. Keep
    # API normalisation predicates consistent if a later source uses them.
    result = result.replace(r'/^\/api\/', r'/^\/school-api\/')
    result = result.replace(r'/^\/maanshan\/', r'/^\/school\/')
    if REMOTE_URL.findall(result) != before_urls:
        raise ValueError('A remote asset URL was changed during relocation.')
    return result


def merge_config(company, school):
    result = copy.deepcopy(company)
    if result.get('trailingSlash') is not True or school.get('trailingSlash') is not True:
        raise ValueError('Both deployments must use trailing slashes.')
    if 'routes' in company:
        raise ValueError('Legacy routes require a separately reviewed migration.')
    expected = {'/api/' + name + '/' for name in API_NAMES}
    if {row['source'] for row in school.get('rewrites', [])} != expected:
        raise ValueError('The school API whitelist has changed; review the package.')
    result.setdefault('rewrites', []).extend([
        {'source': '/school-api/' + name + '/',
         'destination': SCHOOL_ORIGIN + '/api/' + name + '/'}
        for name in sorted(API_NAMES)])
    # Do not copy the school root redirect, global headers, function settings,
    # project identity or gateway runtime over the existing company routes.
    for kind in ('redirects', 'headers'):
        rows = []
        for original in school.get(kind, []):
            if not original['source'].startswith(('/maanshan/', '/api/')):
                continue
            row = copy.deepcopy(original)
            row['source'] = relocate_path(row['source'])
            if 'destination' in row:
                row['destination'] = relocate_path(row['destination'])
            rows.append(row)
        result.setdefault(kind, []).extend(rows)
    # Chat clients can include a Chinese question mark in a pasted link. Keep
    # this exact punctuation typo from turning the school entrance into a 404.
    result.setdefault('redirects', []).extend([
        {'source': source, 'destination': '/school/', 'statusCode': 307}
        for source in ['/school/？', '/school/？/', '/school/%EF%BC%9F', '/school/%EF%BC%9F/']
    ])
    return result


def school_inputs(directory, source_commit):
    manifest_path = directory.with_suffix('.manifest.json')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('sourceCommit') != source_commit or manifest.get('projectId') != SCHOOL_PROJECT:
        raise ValueError('School package must match the reviewed current commit and school project.')
    if manifest.get('apiRuntime') != 'guangzhou-ssh-relay':
        raise ValueError('School package must use the Guangzhou data source.')
    records = {}
    for row in manifest['files']:
        name = str(safe_relative(row['path']))
        if name in records:
            raise ValueError('Duplicate school manifest entry.')
        path = directory / name
        if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
            raise ValueError('School package contains an unsafe link.')
        if not path.is_file() or path.stat().st_size != row['bytes'] or sha256(path) != row['sha256']:
            raise ValueError('School input differs from its verified manifest: ' + name)
        records[name] = row
    actual = {p.relative_to(directory).as_posix() for p in (directory / 'maanshan').rglob('*') if p.is_file()}
    if actual != {name for name in records if name.startswith('maanshan/')}:
        raise ValueError('Unmanifested school assets must not enter the company deployment.')
    return records


def build_package(base_archive, school_directory, destination, source_commit):
    if destination.exists():
        raise ValueError('Use a fresh destination; existing releases are preserved.')
    if destination.resolve().is_relative_to(ROOT.resolve()) or destination.resolve().is_relative_to(school_directory.resolve()):
        raise ValueError('Use an isolated destination outside both source directories.')
    if sha256(base_archive) != BASE_SHA256:
        raise ValueError('Company backup SHA256 does not match the saved production release.')
    inputs = school_inputs(school_directory, source_commit)
    school_config = json.loads((school_directory / 'vercel.json').read_text(encoding='utf-8'))
    original_hashes = {}
    if base_archive.name != f'website-{BASE_COMMIT[:7]}.zip':
        raise ValueError('Company backup filename is not the exact deployed revision.')
    with zipfile.ZipFile(base_archive) as archive:
        if archive.comment.decode('ascii').strip() != BASE_COMMIT:
            raise ValueError('Company backup commit is not the exact deployed revision.')
        names = set()
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = str(safe_relative(info.filename))
            if name in names or name.startswith(('school/', 'school-api/')) or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('Unexpected company backup member.')
            names.add(name)
        company_config = json.loads(archive.read('vercel.json'))
        config = merge_config(company_config, school_config)
        destination.mkdir(parents=True)
        for info in archive.infolist():
            if info.is_dir():
                continue
            data = archive.read(info)
            target = destination / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            original_hashes[info.filename] = hashlib.sha256(data).hexdigest()
    added = []
    for name in sorted(inputs):
        if not name.startswith('maanshan/'):
            continue
        target_name = 'school/' + name[len('maanshan/'):]
        target = destination / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        data = (school_directory / name).read_bytes()
        if target.suffix in TEXT_SUFFIXES:
            data = relocate_source(data.decode('utf-8')).encode('utf-8')
        target.write_bytes(data)
        added.append({'path': target_name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    (destination / 'vercel.json').write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    (destination / '.vercel').mkdir()
    (destination / '.vercel/project.json').write_text(json.dumps({
        'projectId': COMPANY_PROJECT, 'orgId': TEAM, 'projectName': 'aiducation-website'}), encoding='utf-8')
    for name, expected in original_hashes.items():
        if name != 'vercel.json' and sha256(destination / name) != expected:
            raise ValueError('An existing company file was changed: ' + name)
    metadata = {'companyCommit': BASE_COMMIT, 'schoolCommit': source_commit,
                'companyArchiveSha256': BASE_SHA256, 'projectId': COMPANY_PROJECT,
                'originalFileCount': len(original_hashes), 'originalFiles': original_hashes,
                'addedFiles': added, 'apiOrigin': SCHOOL_ORIGIN, 'apiRouteCount': len(API_NAMES),
                'database': 'existing-guangzhou-postgres', 'dnsChanged': False,
                'requires': ['Guangzhou auth explicitly accepts https://aiducation.asia',
                             'School pages fail closed instead of using the company demo fallback',
                             'Generated TTS URL is mapped to the school API prefix by the client',
                             'Live rewrite preserves Origin, Cookie, CSRF, binary downloads and streaming']}
    destination.with_suffix('.manifest.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    return {key: value for key, value in metadata.items() if key not in ('originalFiles', 'addedFiles')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--school-directory', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--base-archive', default=str(BASE_ARCHIVE))
    args = parser.parse_args()
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip():
        raise RuntimeError('Commit reviewed changes before packaging.')
    source_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    base = subprocess.check_output(['git', 'rev-parse', BASE_COMMIT + '^{commit}'], cwd=ROOT, text=True).strip()
    if base != BASE_COMMIT:
        raise RuntimeError('The original production commit is unavailable.')
    print(json.dumps(build_package(Path(args.base_archive), Path(args.school_directory).resolve(),
                                   Path(args.destination).resolve(), source_commit), ensure_ascii=False))


if __name__ == '__main__':
    main()
