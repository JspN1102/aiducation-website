import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import media_config


def fixture(model=False, image=False):
    data = b'representative fixture content'
    sha = hashlib.sha256(data).hexdigest()
    source = '/maanshan/media/test/' + ('model.glb' if model else 'scene-1.webp' if image else 'animation-20260919.mp4')
    entry = {'source': source,
             'destination': media_config.COS_ORIGIN + ('/published/' + sha[:20] if model or image else '') + source,
             'bytes': len(data), 'sha256': sha, 'md5': hashlib.md5(data).hexdigest(),
             'contentType': 'model/gltf-binary' if model else 'image/webp' if image else 'video/mp4',
             'objectCacheControl': 'public, max-age=31536000, immutable' if model or image else 'public, max-age=2592000'}
    return {'schemaVersion': 1, 'origin': media_config.COS_ORIGIN, 'assets': [entry]}, data


class MediaConfigTests(unittest.TestCase):
    def test_repository_manifest_routes_every_excluded_binary_and_only_those(self):
        manifest = json.loads(Path(__file__).with_name('media-manifest.json').read_text(encoding='utf-8'))
        original = copy.deepcopy(manifest)
        config = media_config.build_media_config(manifest)
        routed = [a for a in manifest['assets'] if a['contentType'] != 'video/mp4']
        videos = [a for a in manifest['assets'] if a['contentType'] == 'video/mp4']
        self.assertEqual(len(config['redirects']), len(routed))
        images = [a for a in manifest['assets'] if a['contentType'] == 'image/webp']
        poems = json.loads((Path(__file__).parent.parent / 'maanshan/poems.json').read_text(encoding='utf-8'))['poems']
        for poem in poems:
            for name in ['cover-final.webp', 'avatar.webp'] + [f'scene-{line["scene"]}.webp' for line in poem['lines']]:
                self.assertIn('/maanshan/media/' + poem['slug'] + '/' + name, [a['source'] for a in images])
            # Every current animation has both routes: deployed copy and COS copy.
            self.assertIn('/maanshan/' + poem['animation']['src'], [v['source'] for v in config['videos']])
        self.assertEqual([v['source'] for v in config['videos']], [a['source'] for a in videos])
        self.assertTrue(videos)
        self.assertFalse(any(p.endswith('.mp4') for p in config['excludedFiles']))
        self.assertFalse(any(r['source'].endswith('.mp4') for r in config['redirects']))
        self.assertEqual(config['totalExcludedBytes'], sum(a['bytes'] for a in routed))
        self.assertEqual({r['source'].lstrip('/') for r in config['redirects']}, set(config['excludedFiles']))
        self.assertTrue(all(r['statusCode'] == 307 for r in config['redirects']))
        self.assertTrue(all(h['headers'] == [{'key': 'Cache-Control', 'value': 'no-cache'}] for h in config['headers']))
        self.assertEqual(manifest, original)
        self.assertFalse(any(p.endswith('.mp3') for p in config['excludedFiles']))

    def test_image_digest_type_and_cache_are_verified_before_exact_routes(self):
        manifest, data = fixture(image=True)
        config = media_config.build_media_config(manifest)
        self.assertIn('/published/' + hashlib.sha256(data).hexdigest()[:20], config['redirects'][0]['destination'])
        for key, invalid in [('contentType', 'video/mp4'), ('objectCacheControl', 'public, max-age=30'),
                             ('sha256', '0' * 64)]:
            changed = copy.deepcopy(manifest)
            changed['assets'][0][key] = invalid
            with self.subTest(key=key), self.assertRaises(ValueError):
                media_config.build_media_config(changed)
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / manifest['assets'][0]['source'].lstrip('/')
            target.parent.mkdir(parents=True)
            target.write_bytes(data)
            self.assertEqual(media_config.verify_local_assets(folder, manifest)['verifiedFiles'], 1)

    def test_generated_image_module_and_nginx_use_only_verified_public_mappings(self):
        manifest, _ = fixture(image=True)
        module = media_config.build_image_module(manifest)
        self.assertIn(manifest['assets'][0]['destination'], module)
        self.assertIn('return (preferPublicImages() ? remote || local : local || remote) || source;', module)
        self.assertIn('probePublicImages(' + json.dumps(manifest['assets'][0]['destination']) + ')', module)
        nginx = media_config.build_nginx_config(manifest)
        self.assertIn('location = ' + manifest['assets'][0]['source'], nginx)
        self.assertIn('add_header Cache-Control "no-cache"; return 307 ', nginx)

    def test_generated_video_module_maps_only_animations_and_imports_nothing(self):
        manifest, _ = fixture()
        module = media_config.build_video_module(manifest)
        self.assertIn('export const VIDEO_ASSETS = Object.freeze(', module)
        self.assertIn(json.dumps(manifest['assets'][0]['source']) + ': ' + json.dumps(manifest['assets'][0]['destination']), module)
        self.assertNotIn('import ', module)
        config = media_config.build_media_config(manifest)
        self.assertEqual(config['redirects'], [])
        self.assertEqual(config['excludedFiles'], [])
        self.assertEqual(config['videos'], [{'source': manifest['assets'][0]['source'],
                                            'destination': manifest['assets'][0]['destination'],
                                            'bytes': manifest['assets'][0]['bytes']}])
        image_manifest, _ = fixture(image=True)
        self.assertEqual(media_config.build_video_module(image_manifest).count('https://'), 0)
        self.assertEqual(media_config.build_media_config(image_manifest)['videos'], [])
        # The Guangzhou origin still redirects animations: its uplink is shared by the whole class.
        self.assertIn('location = ' + manifest['assets'][0]['source'], media_config.build_nginx_config(manifest))

    def test_repository_generated_files_are_current(self):
        root = Path(__file__).parent.parent
        manifest = json.loads((root / 'deploy/media-manifest.json').read_text(encoding='utf-8'))
        self.assertEqual((root / 'maanshan/media-videos.mjs').read_text(encoding='utf-8'), media_config.build_video_module(manifest))
        self.assertEqual((root / 'maanshan/media-images.mjs').read_text(encoding='utf-8'), media_config.build_image_module(manifest))
        self.assertEqual((root / 'deploy/maanshan-media.conf').read_text(encoding='utf-8'), media_config.build_nginx_config(manifest))

    def test_all_poem_images_have_full_resolution_independent_compatible_copies(self):
        from PIL import Image
        root = Path(__file__).parent.parent
        source = (root / 'maanshan/image-compat.mjs').read_text('utf-8')
        compatible = json.loads(source.split('Object.freeze(', 1)[1].rsplit(');', 1)[0])
        manifest = json.loads((root / 'deploy/media-manifest.json').read_text('utf-8'))
        excluded = set(media_config.build_media_config(manifest)['excludedFiles'])
        for asset in manifest['assets']:
            if asset['contentType'] != 'image/webp':
                continue
            path = compatible[asset['source']]
            self.assertTrue(path.startswith('/maanshan/media/compatible/'))
            self.assertNotIn(path.lstrip('/'), excluded)
            with Image.open(root / path.lstrip('/')) as image, Image.open(root / asset['source'].lstrip('/')) as original:
                image.load()
                self.assertIn(image.format, ['JPEG', 'PNG'])
                self.assertEqual(image.size, original.size)

    def test_modified_video_same_size_is_rejected(self):
        manifest, data = fixture()
        with tempfile.TemporaryDirectory() as directory:
            asset = Path(directory) / manifest['assets'][0]['source'].lstrip('/')
            asset.parent.mkdir(parents=True)
            asset.write_bytes(data)
            self.assertEqual(media_config.verify_local_assets(directory, manifest)['verifiedFiles'], 1)
            asset.write_bytes(b'X' + data[1:])
            with self.assertRaisesRegex(ValueError, 'content changed'):
                media_config.verify_local_assets(directory, manifest)

    def test_changed_length_or_missing_source_rejected(self):
        manifest, data = fixture()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                media_config.verify_local_assets(directory, manifest)
            asset = Path(directory) / manifest['assets'][0]['source'].lstrip('/')
            asset.parent.mkdir(parents=True)
            asset.write_bytes(data + b'new')
            with self.assertRaisesRegex(ValueError, 'byte count changed'):
                media_config.verify_local_assets(directory, manifest)

    def test_model_digest_must_match_cos_key(self):
        manifest, _ = fixture(model=True)
        media_config.build_media_config(manifest)
        manifest['assets'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'content digest'):
            media_config.build_media_config(manifest)

    def test_non_hash_video_must_not_be_marked_immutable(self):
        manifest, _ = fixture()
        manifest['assets'][0]['objectCacheControl'] = 'public, max-age=31536000, immutable'
        with self.assertRaisesRegex(ValueError, 'cache policy'):
            media_config.build_media_config(manifest)

    def test_untrusted_or_ambiguous_destinations_rejected(self):
        for suffix in ['?token=private', '#fragment', '/extra']:
            manifest, _ = fixture()
            manifest['assets'][0]['destination'] += suffix
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                media_config.build_media_config(manifest)
        manifest, _ = fixture()
        manifest['origin'] = 'https://other.example'
        with self.assertRaisesRegex(ValueError, 'COS origin'):
            media_config.build_media_config(manifest)

    def test_traversal_redirect_patterns_and_non_media_sources_rejected(self):
        for source in ['/maanshan/media/../api/tts.mp4', '/maanshan/media/:path*.mp4',
                       '/maanshan/media/%2e%2e/test.mp4', '/api/model.glb', '/maanshan/media/avatar.exe']:
            manifest, _ = fixture()
            manifest['assets'][0]['source'] = source
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'exact supported'):
                media_config.build_media_config(manifest)

    def test_duplicate_paths_and_bad_counts_rejected(self):
        manifest, _ = fixture()
        manifest['assets'] *= 2
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            media_config.build_media_config(manifest)
        for invalid in [True, 0, -1, '5']:
            manifest, _ = fixture()
            manifest['assets'][0]['bytes'] = invalid
            with self.subTest(value=invalid), self.assertRaisesRegex(ValueError, 'byte count'):
                media_config.build_media_config(manifest)


class AudioInclusionTests(unittest.TestCase):
    def make_indexes(self, root):
        for folder, export in [('speech', 'SPEECH_AUDIO_FILES'), ('words', 'WORD_AUDIO_FILES')]:
            directory = root / 'maanshan' / 'media' / folder
            directory.mkdir(parents=True)
            (directory / 'index.mjs').write_text('export const ' + export + ' = Object.freeze({"word":"current.mp3", "alias":"current.mp3"});', encoding='utf-8')
            (directory / 'current.mp3').write_bytes(b'current')
            (directory / 'old.mp3').write_bytes(b'old')
            (directory / 'fallback.m4a').write_bytes(b'fallback')

    def test_omit_only_unreferenced_mp3s_preserving_aliases_and_fallbacks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_indexes(root)
            self.assertEqual(media_config.obsolete_audio_files(root), {
                'maanshan/media/speech/old.mp3', 'maanshan/media/words/old.mp3'})

    def test_missing_current_recording_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_indexes(root)
            (root / 'maanshan/media/words/current.mp3').unlink()
            with self.assertRaisesRegex(ValueError, 'Referenced audio is missing'):
                media_config.obsolete_audio_files(root)

    def test_index_javascript_or_traversal_is_not_evaluated(self):
        for value in ['export const SPEECH_AUDIO_FILES = Object.freeze({}); alert("bad");',
                      'export const SPEECH_AUDIO_FILES = Object.freeze({"a":"../private.mp3"});',
                      'export const SPEECH_AUDIO_FILES = Object.freeze({"a": "/private.mp3"});',
                      'export const SPEECH_AUDIO_FILES = Object.freeze({"a": "https://x/a.mp3"});',
                      'export const SPEECH_AUDIO_FILES = Object.freeze({"a": "one.mp3", "a": "two.mp3"});']:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.make_indexes(root)
                (root / 'maanshan/media/speech/index.mjs').write_text(value, encoding='utf-8')
                with self.assertRaises(ValueError):
                    media_config.obsolete_audio_files(root)


if __name__ == '__main__':
    unittest.main()
