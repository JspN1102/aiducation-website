from pathlib import Path
import gzip
import importlib.util
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('precompress', Path(__file__).with_name('performance-precompress.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrecompressionTests(unittest.TestCase):
    def fixture(self, root):
        directory = root / 'maanshan'
        directory.mkdir()
        source = directory / 'app.mjs'
        source.write_bytes(b'export const sample = "repeatable public content";\n' * 100)
        return source

    def test_dry_run_is_read_only_and_sidecar_roundtrips_without_source_change(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            source = self.fixture(root)
            original, modified = source.read_bytes(), source.stat().st_mtime_ns
            dry = module.precompress(root)
            self.assertEqual(dry['fileCount'], 1)
            self.assertEqual(len(list(root.rglob('*.gz'))), 0)
            written = module.precompress(root, write=True)
            sidecar = source.with_name('app.mjs.gz')
            self.assertEqual(gzip.decompress(sidecar.read_bytes()), original)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(source.stat().st_mtime_ns, modified)
            self.assertEqual(sidecar.stat().st_mtime_ns, modified)
            self.assertEqual(written['files'], dry['files'])
            self.assertEqual(module.precompress(root, write=True)['unchanged'], 1)
            self.assertTrue(module.verify_precompressed(root)['verified'])

    def test_rebuild_updates_changed_source_atomically(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            source = self.fixture(root)
            module.precompress(root, write=True)
            replacement = b'changed content\n' * 100
            source.write_bytes(replacement)
            module.precompress(root, write=True)
            self.assertEqual(gzip.decompress(source.with_name('app.mjs.gz').read_bytes()), replacement)
            self.assertFalse(list(root.rglob('.performance-gzip-*')))

    def test_does_not_compress_small_files_media_or_files_outside_public_app(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            self.fixture(root)
            (root / 'maanshan/small.json').write_text('{}')
            (root / 'maanshan/model.glb').write_bytes(b'MODEL' * 1000)
            (root / 'private.json').write_bytes(b'PRIVATE' * 1000)
            result = module.precompress(root, write=True)
            self.assertEqual([row['path'] for row in result['files']], ['maanshan/app.mjs'])
            self.assertFalse((root / 'private.json.gz').exists())
            self.assertFalse((root / 'maanshan/model.glb.gz').exists())

    def test_shrinking_source_removes_stale_sidecar(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            source = self.fixture(root)
            module.precompress(root, write=True)
            source.write_bytes(b'export const a = 1;')
            module.precompress(root, write=True)
            self.assertFalse(source.with_name('app.mjs.gz').exists())

    def test_verifier_rejects_missing_corrupt_and_stale_sidecars(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            source = self.fixture(root)
            self.assertFalse(module.verify_precompressed(root)['verified'])
            module.precompress(root, write=True)
            sidecar = source.with_name('app.mjs.gz')
            sidecar.write_bytes(b'corrupt')
            self.assertFalse(module.verify_precompressed(root)['verified'])
            module.precompress(root, write=True)
            source.write_bytes(b'short')
            self.assertFalse(module.verify_precompressed(root)['verified'])
            module.precompress(root, write=True)
            self.assertTrue(module.verify_precompressed(root)['verified'])

    def test_refuses_symlinked_public_source(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            self.fixture(root)
            outside = root / 'outside.json'
            outside.write_bytes(b'not public' * 1000)
            try:
                (root / 'maanshan/linked.json').symlink_to(outside)
            except OSError:
                self.skipTest('Symlink creation unavailable for current Windows account')
            with self.assertRaisesRegex(ValueError, 'escape'):
                module.precompress(root, write=True)
            self.assertFalse((root / 'maanshan/linked.json.gz').exists())


if __name__ == '__main__':
    unittest.main()
