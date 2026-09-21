"""The emergency entrance must preserve the deployed company and its old APIs."""
from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('company_fallback', HERE / 'package-company-fallback.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class CompanyFallbackTests(unittest.TestCase):
    def test_only_local_absolute_paths_are_relocated(self):
        source = r'''const auth='/api/school-auth/';
const image="/maanshan/media/scene.webp";
const template=`/maanshan/${name}`;
const remote="https://cos.example/published/123/maanshan/media/scene.webp";
const remoteAPI='https://other.example/api/example/';
const pattern=/^\/api\//;
const normalise = path.startsWith('/api/') ? path.replace(/\/+$/, '')+'/' : path;
const relative=new URL('./media/a.png',import.meta.url);
'''
        actual = packager.relocate_source(source)
        self.assertIn("const auth='/school-api/school-auth/';", actual)
        self.assertIn('const image="/school/media/scene.webp";', actual)
        self.assertIn('const template=`/school/${name}`;', actual)
        self.assertIn('https://cos.example/published/123/maanshan/media/scene.webp', actual)
        self.assertIn('https://other.example/api/example/', actual)
        self.assertIn(r'const pattern=/^\/school-api\//;', actual)
        self.assertIn("path.startsWith('/school-api/')", actual)
        self.assertIn("new URL('./media/a.png',import.meta.url)", actual)

    def fixtures(self, base):
        school = base / 'school-input'; school.mkdir()
        files = {
            'maanshan/index.html': '<script type="module" src="app.mjs"></script>',
            'maanshan/app.mjs': "fetch('/api/school-auth/');const image='/maanshan/media/scene.webp';",
            'maanshan/media/scene.webp': 'binary-image-fixture',
            'maanshan/media-images.mjs': 'const map={"/maanshan/media/scene.webp":"https://cos.example/maanshan/media/scene.webp"};',
            'api/school-gateway.js': 'private school gateway must not replace original APIs',
            'package.json': '{"school":true}',
        }
        rows = []
        for name, content in files.items():
            p = school / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(content, encoding='utf-8')
            rows.append({'path': name, 'bytes': p.stat().st_size, 'sha256': packager.sha256(p)})
        school.with_suffix('.manifest.json').write_text(json.dumps({
            'sourceCommit': 'a' * 40, 'projectId': packager.SCHOOL_PROJECT,
            'apiRuntime': 'guangzhou-ssh-relay', 'files': rows}), encoding='utf-8')
        config = {'trailingSlash': True, 'regions': ['iad1'],
                  'functions': {'api/school-gateway.js': {'maxDuration': 60}},
                  'rewrites': [{'source': '/api/' + name + '/', 'destination': '/api/school-gateway/?__school_route=' + name} for name in packager.API_NAMES],
                  'redirects': [{'source': '/', 'destination': '/maanshan/', 'statusCode': 307},
                                {'source': '/maanshan/media/model.glb', 'destination': 'https://cos.example/maanshan/media/model.glb', 'statusCode': 307}],
                  'headers': [{'source': '/(.*)', 'headers': [{'key': 'School-Global', 'value': 'do-not-copy'}]},
                              {'source': '/maanshan/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=0, must-revalidate'}]},
                              {'source': '/api/:path*', 'headers': [{'key': 'Cache-Control', 'value': 'private, no-store'}]}]}
        (school / 'vercel.json').write_text(json.dumps(config), encoding='utf-8')
        original_config = {'trailingSlash': True, 'functions': {'api/tts.js': {'maxDuration': 20}},
                           'redirects': [{'source': '/awards/', 'destination': '/awards/gesa-2026/', 'permanent': False}],
                           'headers': [{'source': '/maanshan/:path*', 'headers': [{'key': 'Legacy', 'value': 'unchanged'}]}]}
        original = {'index.html': b'Company homepage', 'api/tts.js': b'original tts',
                    'maanshan/app.mjs': b'Original demo', 'wenhuacun/index.html': b'Village',
                    'mandarin-assessment/index.html': b'Assessment', 'awards/gesa-2026/index.html': b'Awards',
                    'package.json': b'{"original":true}', 'package-lock.json': b'{"lockfileVersion":3}',
                    '.vercelignore': b'.env*\n.git/\nnode_modules/\n',
                    'vercel.json': json.dumps(original_config).encode()}
        archive = base / f'website-{packager.BASE_COMMIT[:7]}.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.comment = packager.BASE_COMMIT.encode('ascii')
            for name, content in original.items(): z.writestr(name, content)
        return school, archive, original

    def test_build_preserves_all_old_files_and_appends_only_school_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); school, archive, original = self.fixtures(base); destination = base / 'release'
            with patch.object(packager, 'BASE_SHA256', packager.sha256(archive)):
                result = packager.build_package(archive, school, destination, 'a' * 40)
            for name, content in original.items():
                if name != 'vercel.json': self.assertEqual((destination / name).read_bytes(), content)
            self.assertFalse((destination / 'api/school-gateway.js').exists())
            self.assertFalse((destination / '.env').exists())
            self.assertIn('/school-api/school-auth/', (destination / 'school/app.mjs').read_text())
            config = json.loads((destination / 'vercel.json').read_text())
            self.assertEqual(config['functions'], {'api/tts.js': {'maxDuration': 20}})
            self.assertNotIn('regions', config)
            self.assertEqual(len(config['rewrites']), 13)
            for route in config['rewrites']:
                name = route['source'].removeprefix('/school-api/').removesuffix('/')
                self.assertIn(name, packager.API_NAMES)
                self.assertEqual(route['destination'], packager.SCHOOL_ORIGIN + '/api/' + name + '/')
            self.assertFalse(any(row['source'] == '/' for row in config['redirects']))
            self.assertIn({'source': '/school/media/model.glb', 'destination': 'https://cos.example/maanshan/media/model.glb', 'statusCode': 307}, config['redirects'])
            self.assertFalse(any(row['source'] == '/(.*)' for row in config['headers']))
            self.assertEqual(result['apiRouteCount'], 13)
            manifest = json.loads(destination.with_suffix('.manifest.json').read_text())
            for row in manifest['addedFiles']:
                self.assertEqual(packager.sha256(destination / row['path']), row['sha256'])
            self.assertEqual(json.loads((destination / '.vercel/project.json').read_text())['projectId'], packager.COMPANY_PROJECT)

    def test_input_tampering_or_stale_commit_cannot_be_packaged(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); school, archive, _ = self.fixtures(base)
            with self.assertRaisesRegex(ValueError, 'match the reviewed current commit'):
                packager.school_inputs(school, 'b' * 40)
            (school / 'maanshan/app.mjs').write_text('tampered')
            with self.assertRaisesRegex(ValueError, 'differs from its verified manifest'):
                packager.school_inputs(school, 'a' * 40)

    def test_unknown_school_files_and_bad_archive_fail_before_output_exists(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); school, archive, _ = self.fixtures(base); destination = base / 'release'
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                packager.build_package(archive, school, destination, 'a' * 40)
            self.assertFalse(destination.exists())
            (school / 'maanshan/.env').write_text('private fixture')
            with patch.object(packager, 'BASE_SHA256', packager.sha256(archive)):
                with self.assertRaisesRegex(ValueError, 'Unmanifested school assets'):
                    packager.build_package(archive, school, destination, 'a' * 40)
            self.assertFalse(destination.exists())

    def test_archive_members_cannot_escape_or_include_private_files(self):
        for value in ['../file', '/root', 'C:/file', 'a\\file', '.env', 'api/.env.production',
                      '.vercel/project.json', '.git/config', 'accounts.private.json', 'a/../b']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                packager.safe_relative(value)
        self.assertEqual(str(packager.safe_relative('.vercelignore')), '.vercelignore')
        self.assertEqual(str(packager.safe_relative('maanshan/app.mjs')), 'maanshan/app.mjs')

    def test_unknown_gateway_api_cannot_be_added_implicitly(self):
        with tempfile.TemporaryDirectory() as temp:
            school, _, _ = self.fixtures(Path(temp))
            config = json.loads((school / 'vercel.json').read_text())
            config['rewrites'].append({'source': '/api/private-database/', 'destination': '/api/school-gateway/'})
            with self.assertRaisesRegex(ValueError, 'whitelist has changed'):
                packager.merge_config({'trailingSlash': True}, config)


if __name__ == '__main__':
    unittest.main()
