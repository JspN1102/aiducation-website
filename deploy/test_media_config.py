import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import media_config


def entry(source, data, group=None, group_members=None):
    sha = hashlib.sha256(data).hexdigest()
    extension = source[source.rfind('.'):]
    if group:
        prefix = '/published/g-' + media_config.group_id(group_members or [(source, sha)])
    elif extension != '.mp4':
        prefix = '/published/' + sha[:20]
    else:
        prefix = ''
    result = {'source': source, 'destination': media_config.COS_ORIGIN + prefix + source,
              'bytes': len(data), 'sha256': sha, 'md5': hashlib.md5(data).hexdigest(),
              'contentType': media_config.TYPES[extension],
              'objectCacheControl': media_config.MONTH if extension == '.mp4' else media_config.IMMUTABLE}
    if group:
        result['group'] = group
    return result


def fixture(model=False, image=False, font=False, audio=False):
    data = b'representative fixture content'
    if font:
        source = '/maanshan/vendor/fonts/serif.woff2'
    elif audio:
        source = '/maanshan/media/words/clip-1.mp3'
    else:
        source = '/maanshan/media/test/' + ('model.glb' if model else 'scene-1.webp' if image else 'animation-20260919.mp4')
    return {'schemaVersion': 1, 'origin': media_config.COS_ORIGIN,
            'assets': [entry(source, data, group='words' if audio else None)]}, data


def audio_fixture():
    clips = {'/maanshan/media/words/clip-1.mp3': b'first clip', '/maanshan/media/words/clip-2.mp3': b'second clip',
             '/maanshan/media/recitations/edb/grade1-line1.mp3': b'recitation'}
    members = {}
    for source, data in clips.items():
        members.setdefault(media_config.AUDIO_SOURCE.fullmatch(source).group(1), []).append((source, hashlib.sha256(data).hexdigest()))
    assets = [entry(source, data, group=media_config.AUDIO_SOURCE.fullmatch(source).group(1),
                    group_members=members[media_config.AUDIO_SOURCE.fullmatch(source).group(1)]) for source, data in clips.items()]
    return {'schemaVersion': 1, 'origin': media_config.COS_ORIGIN, 'assets': assets}, clips


class MediaConfigTests(unittest.TestCase):
    # Every model the pages load: exploration viewers (grades 4-6), the
    # assessment viewer's older models, the mountain game and the living field.
    PAGE_MODELS = ['exploration/bo-chuan-gua-zhou/model-20260919b.glb', 'exploration/bo-chuan-gua-zhou/model.glb',
                   'exploration/gui-yuan-tian-ju/model-20260920a.glb', 'exploration/gui-yuan-tian-ju/model.glb',
                   'exploration/ti-xi-lin-bi/model.glb', 'exploration/zao-chun/model-20260919b.glb',
                   'exploration/zao-chun/model.glb', 'living-scenes/bean-v1.glb', 'living-scenes/grass-v1.glb']

    def test_repository_manifest_gives_every_published_file_two_routes(self):
        root = Path(__file__).parent.parent
        manifest = json.loads((root / 'deploy/media-manifest.json').read_text(encoding='utf-8'))
        original = copy.deepcopy(manifest)
        config = media_config.build_media_config(manifest)
        by_type = lambda kind: [a['source'] for a in manifest['assets'] if a['contentType'] == kind]
        # Nothing is redirected away from the deployment: a redirect would leave one route.
        self.assertEqual(config['redirects'], [])
        self.assertEqual(config['headers'], [])
        self.assertEqual(config['excludedFiles'], [])
        self.assertEqual(config['totalExcludedBytes'], 0)
        self.assertEqual([m['source'] for m in config['models']], by_type('model/gltf-binary'))
        for name in self.PAGE_MODELS:
            self.assertIn('/maanshan/media/' + name, [m['source'] for m in config['models']])
        images = [i['source'] for i in config['images']]
        self.assertEqual(images, by_type('image/webp'))
        poems = json.loads((root / 'maanshan/poems.json').read_text(encoding='utf-8'))['poems']
        for poem in poems:
            for name in ['cover-final.webp', 'avatar.webp'] + [f'scene-{line["scene"]}.webp' for line in poem['lines']]:
                self.assertIn('/maanshan/media/' + poem['slug'] + '/' + name, images)
            # Every current animation has both routes: deployed copy and COS copy.
            self.assertIn('/maanshan/' + poem['animation']['src'], [v['source'] for v in config['videos']])
        self.assertEqual([v['source'] for v in config['videos']], by_type('video/mp4'))
        self.assertTrue(config['videos'])
        # The page's fonts and every current recording have a public copy too.
        self.assertEqual([f['source'] for f in config['fonts']], by_type('font/woff2'))
        self.assertIn('/maanshan/vendor/fonts/noto-serif-tc.woff2', [f['source'] for f in config['fonts']])
        self.assertEqual(len(config['audio']), len(by_type('audio/mpeg')))
        self.assertEqual(set(config['audioGroups']), {'words', 'speech', 'recitations/edb-20260921'})
        for name, group in config['audioGroups'].items():
            self.assertRegex(group['prefix'], r'^https://[^/]+/published/g-[a-f0-9]{20}$')
            self.assertEqual(group['bytes'], sum(a['bytes'] for a in manifest['assets'] if a.get('group') == name))
        self.assertEqual(media_config.verify_audio_groups(root, manifest)['audioGroups'], 3)
        self.assertEqual(manifest, original)

    def test_image_digest_type_and_cache_are_verified_before_routes(self):
        manifest, data = fixture(image=True)
        config = media_config.build_media_config(manifest)
        self.assertIn('/published/' + hashlib.sha256(data).hexdigest()[:20], config['images'][0]['destination'])
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
        self.assertIn('return imageRoutes(path, IMAGE_ASSETS[path], COMPAT_IMAGES[path])[0] || source;', module)
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
        self.assertEqual(config['models'], [])
        self.assertEqual(config['images'], [])
        # The Guangzhou origin still redirects animations: its uplink is shared by the whole class.
        self.assertIn('location = ' + manifest['assets'][0]['source'], media_config.build_nginx_config(manifest))

    def test_generated_model_module_maps_only_models_which_ship_on_both_routes(self):
        manifest, data = fixture(model=True)
        module = media_config.build_model_module(manifest)
        self.assertIn('export const MODEL_ASSETS = Object.freeze(', module)
        self.assertIn(json.dumps(manifest['assets'][0]['source']) + ': ' + json.dumps(manifest['assets'][0]['destination']), module)
        self.assertIn('/published/' + hashlib.sha256(data).hexdigest()[:20] + '/', module)
        self.assertNotIn('import ', module)
        config = media_config.build_media_config(manifest)
        # Models are deployed on the page's origin as well, so nothing is redirected or omitted.
        self.assertEqual(config['redirects'], [])
        self.assertEqual(config['headers'], [])
        self.assertEqual(config['excludedFiles'], [])
        self.assertEqual(config['totalExcludedBytes'], 0)
        self.assertEqual(config['models'], [{'source': manifest['assets'][0]['source'],
                                            'destination': manifest['assets'][0]['destination'],
                                            'bytes': manifest['assets'][0]['bytes']}])
        self.assertEqual(config['videos'], [])
        for other in [fixture()[0], fixture(image=True)[0]]:
            self.assertEqual(media_config.build_model_module(other).count('https://'), 0)
            self.assertEqual(media_config.build_media_config(other)['models'], [])
        # The Guangzhou origin still redirects models: its uplink is shared by the whole class.
        self.assertIn('location = ' + manifest['assets'][0]['source'], media_config.build_nginx_config(manifest))

    def test_generated_font_module_maps_only_fonts_and_imports_nothing(self):
        manifest, data = fixture(font=True)
        module = media_config.build_font_module(manifest)
        self.assertIn('export const FONT_ASSETS = Object.freeze(', module)
        self.assertIn(json.dumps('/maanshan/vendor/fonts/serif.woff2') + ': ' + json.dumps(manifest['assets'][0]['destination']), module)
        self.assertIn('/published/' + hashlib.sha256(data).hexdigest()[:20] + '/', module)
        self.assertNotIn('import ', module)
        config = media_config.build_media_config(manifest)
        self.assertEqual(config['fonts'], [{'source': manifest['assets'][0]['source'],
                                           'destination': manifest['assets'][0]['destination'],
                                           'bytes': manifest['assets'][0]['bytes']}])
        self.assertEqual(config['excludedFiles'], [])
        self.assertEqual(media_config.build_font_module(fixture(image=True)[0]).count('https://'), 0)
        for source in ['/maanshan/vendor/fonts/../../api/x.woff2', '/maanshan/vendor/serif.woff2', '/maanshan/media/serif.woff2']:
            changed = copy.deepcopy(manifest)
            changed['assets'][0]['source'] = source
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'exact supported'):
                media_config.build_media_config(changed)
        self.assertIn('location = /maanshan/vendor/fonts/serif.woff2', media_config.build_nginx_config(manifest))

    def test_recorded_audio_is_validated_as_complete_folder_groups(self):
        manifest, clips = audio_fixture()
        config = media_config.build_media_config(manifest)
        self.assertEqual(set(config['audioGroups']), {'words', 'recitations/edb'})
        self.assertEqual(config['audioGroups']['words']['files'], sorted(s for s in clips if '/words/' in s))
        self.assertEqual(config['audioGroups']['words']['bytes'], sum(len(d) for s, d in clips.items() if '/words/' in s))
        self.assertEqual({a['source']: a['destination'] for a in config['audio']}, {a['source']: a['destination'] for a in manifest['assets']})
        module = media_config.build_audio_module(manifest)
        self.assertNotIn('import ', module)
        self.assertIn('"/maanshan/media/words/": ' + json.dumps(config['audioGroups']['words']['prefix'] + '/maanshan/media/words/'), module)
        self.assertIn('"/maanshan/media/recitations/edb/": ', module)
        # A folder listed incompletely, a changed clip or a wrong folder name changes the group id.
        incomplete = copy.deepcopy(manifest)
        incomplete['assets'] = [a for a in incomplete['assets'] if not a['source'].endswith('clip-2.mp3')]
        with self.assertRaisesRegex(ValueError, 'content digest'):
            media_config.build_media_config(incomplete)
        changed = copy.deepcopy(manifest)
        changed['assets'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'content digest'):
            media_config.build_media_config(changed)
        renamed = copy.deepcopy(manifest)
        renamed['assets'][0]['group'] = 'speech'
        with self.assertRaisesRegex(ValueError, 'folder group'):
            media_config.build_media_config(renamed)
        ungrouped = copy.deepcopy(manifest)
        del ungrouped['assets'][0]['group']
        with self.assertRaisesRegex(ValueError, 'folder group'):
            media_config.build_media_config(ungrouped)
        image, _ = fixture(image=True)
        image['assets'][0]['group'] = 'test'
        with self.assertRaisesRegex(ValueError, 'groups'):
            media_config.build_media_config(image)
        for entry_ in config['audio']:
            self.assertIn('location = ' + entry_['source'] + ' { add_header Cache-Control "no-cache"; return 307 ' + entry_['destination'] + '; }',
                          media_config.build_nginx_config(manifest))

    def test_audio_groups_must_cover_every_referenced_and_recitation_clip(self):
        manifest, clips = audio_fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for source, data in clips.items():
                target = root / source.lstrip('/')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            (root / 'maanshan/media/speech').mkdir()
            (root / 'maanshan/media/speech/index.mjs').write_text('export const SPEECH_AUDIO_FILES = Object.freeze({});', encoding='utf-8')
            (root / 'maanshan/media/words/index.mjs').write_text('export const WORD_AUDIO_FILES = Object.freeze({"a|b": "clip-1.mp3", "c|d": "clip-2.mp3"});', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'nonempty'):
                media_config.verify_audio_groups(root, manifest)
            (root / 'maanshan/media/speech/index.mjs').write_text('export const SPEECH_AUDIO_FILES = Object.freeze({"a|b": "s.mp3"});', encoding='utf-8')
            (root / 'maanshan/media/speech/s.mp3').write_bytes(b's')
            with self.assertRaisesRegex(ValueError, 'no verified COS mapping: speech/s.mp3'):
                media_config.verify_audio_groups(root, manifest)
            speech = entry('/maanshan/media/speech/s.mp3', b's', group='speech')
            complete = {**manifest, 'assets': manifest['assets'] + [speech]}
            self.assertEqual(media_config.verify_audio_groups(root, complete), {'audioGroups': 3, 'audioFiles': 4})
            (root / 'maanshan/media/recitations/edb/grade1-line2.mp3').write_bytes(b'new line')
            with self.assertRaisesRegex(ValueError, 'no verified COS mapping: recitations/edb/grade1-line2.mp3'):
                media_config.verify_audio_groups(root, complete)

    def test_pack_manifest_lists_every_file_relative_to_the_page_with_a_content_version(self):
        manifest, clips = audio_fixture()
        manifest['assets'] += [fixture(image=True)[0]['assets'][0], fixture(font=True)[0]['assets'][0], fixture()[0]['assets'][0]]
        pack = json.loads(media_config.build_pack_manifest(manifest))
        self.assertEqual(pack['schemaVersion'], 1)
        self.assertEqual(pack['cache'], media_config.PACK_CACHE)
        self.assertEqual(len(pack['assets']), len(manifest['assets']))
        self.assertEqual(pack['totalBytes'], sum(a['bytes'] for a in manifest['assets']))
        self.assertIn({'path': 'vendor/fonts/serif.woff2', 'remote': fixture(font=True)[0]['assets'][0]['destination'],
                       'bytes': 30, 'sha256': hashlib.sha256(b'representative fixture content').hexdigest(), 'type': 'font/woff2'}, pack['assets'])
        self.assertTrue(all(not a['path'].startswith('/') and a['path'].startswith(('media/', 'vendor/fonts/')) for a in pack['assets']))
        self.assertRegex(pack['version'], r'^[a-f0-9]{20}$')
        reordered = {**manifest, 'assets': list(reversed(manifest['assets']))}
        self.assertEqual(json.loads(media_config.build_pack_manifest(reordered))['version'], pack['version'])
        changed = copy.deepcopy(manifest)
        changed['assets'][0]['sha256'] = '1' * 64
        changed['assets'][0]['destination'] = media_config.COS_ORIGIN + '/published/g-' + media_config.group_id(
            [(a['source'], a['sha256']) for a in changed['assets'] if a.get('group') == 'words']) + changed['assets'][0]['source']
        changed['assets'][1]['destination'] = changed['assets'][0]['destination'].replace('clip-1', 'clip-2')
        self.assertNotEqual(json.loads(media_config.build_pack_manifest(changed))['version'], pack['version'])

    def test_pack_manifest_marks_grade_specific_files(self):
        manifest, _ = audio_fixture()
        manifest['assets'] += [fixture(font=True)[0]['assets'][0]]
        plain = json.loads(media_config.build_pack_manifest(manifest))
        paths = [asset['path'] for asset in plain['assets']]
        pack = json.loads(media_config.build_pack_manifest(manifest, {paths[0]: [1], paths[1]: [2, 5]}))
        self.assertEqual([asset.get('grades') for asset in pack['assets']], [[1], [2, 5]] + [None] * (len(paths) - 2))
        self.assertEqual(pack['version'], plain['version'])
        self.assertEqual(pack['totalBytes'], plain['totalBytes'])
        self.assertEqual(json.loads(media_config.build_pack_manifest(manifest, {})), plain)
        with self.assertRaisesRegex(ValueError, 'does not publish: media/gone.webp'):
            media_config.build_pack_manifest(manifest, {'media/gone.webp': [1]})

    def test_pack_scope_file_is_validated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'deploy').mkdir()
            target = root / media_config.PACK_SCOPE
            for bad in ([2, 1], [], [0], [1, 1], ['1'], [13], 1):
                target.write_text(json.dumps({'schemaVersion': 1, 'grades': {'media/a.webp': bad}}), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'Invalid pack scope entry: media/a.webp'):
                    media_config.load_pack_scope(root)
            target.write_text(json.dumps({'schemaVersion': 2, 'grades': {}}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Unsupported pack scope schema'):
                media_config.load_pack_scope(root)
            target.write_text(json.dumps({'schemaVersion': 1, 'grades': {'media/a.webp': [1, 3], 'media/b.mp3': [6]}}), encoding='utf-8')
            self.assertEqual(media_config.load_pack_scope(root), {'media/a.webp': [1, 3], 'media/b.mp3': [6]})

    def test_index_meta_tags_follow_the_manifest(self):
        manifest, _ = fixture(image=True)
        html = ('<head>\n<meta name="school-cos-probe" content="">\n<meta name="school-pack" content="old">\n'
                '<meta name="school-cos-probe" content="">\n</head>')
        with self.assertRaisesRegex(ValueError, 'exactly one school-cos-probe'):
            media_config.render_index_meta(html, manifest)
        html = '<head>\r\n<meta name="school-cos-probe" content="">\r\n<meta name="school-pack" content="old">\r\n</head>'
        rendered = media_config.render_index_meta(html, manifest)
        self.assertIn('<meta name="school-cos-probe" content="' + manifest['assets'][0]['destination'] + '">\r\n', rendered)
        self.assertIn('<meta name="school-pack" content="' + json.loads(media_config.build_pack_manifest(manifest))['version'] + '">\r\n', rendered)
        self.assertEqual(media_config.render_index_meta(rendered, manifest), rendered)
        with self.assertRaisesRegex(ValueError, 'school-pack'):
            media_config.render_index_meta('<meta name="school-cos-probe" content="">', manifest)

    def test_repository_generated_files_are_current(self):
        root = Path(__file__).parent.parent
        manifest = json.loads((root / 'deploy/media-manifest.json').read_text(encoding='utf-8'))
        self.assertEqual((root / 'maanshan/media-videos.mjs').read_text(encoding='utf-8'), media_config.build_video_module(manifest))
        self.assertEqual((root / 'maanshan/media-models.mjs').read_text(encoding='utf-8'), media_config.build_model_module(manifest))
        self.assertEqual((root / 'maanshan/media-images.mjs').read_text(encoding='utf-8'), media_config.build_image_module(manifest))
        self.assertEqual((root / 'maanshan/media-fonts.mjs').read_text(encoding='utf-8'), media_config.build_font_module(manifest))
        self.assertEqual((root / 'maanshan/media-audio.mjs').read_text(encoding='utf-8'), media_config.build_audio_module(manifest))
        self.assertEqual((root / 'maanshan/pack-manifest.json').read_text(encoding='utf-8'),
                         media_config.build_pack_manifest(manifest, media_config.load_pack_scope(root)))
        self.assertEqual((root / 'deploy/maanshan-media.conf').read_text(encoding='utf-8'), media_config.build_nginx_config(manifest))
        index = (root / 'maanshan/index.html').read_text(encoding='utf-8')
        self.assertEqual(index, media_config.render_index_meta(index, manifest))

    def test_compatible_copies_are_full_resolution_and_cover_every_poem_image(self):
        from PIL import Image
        root = Path(__file__).parent.parent
        source = (root / 'maanshan/image-compat.mjs').read_text('utf-8')
        compatible = json.loads(source.split('Object.freeze(', 1)[1].rsplit(');', 1)[0])
        manifest = json.loads((root / 'deploy/media-manifest.json').read_text('utf-8'))
        published = {asset['source'] for asset in manifest['assets'] if asset['contentType'] == 'image/webp'}
        excluded = set(media_config.build_media_config(manifest)['excludedFiles'])
        poems = json.loads((root / 'maanshan/poems.json').read_text(encoding='utf-8'))['poems']
        for poem in poems:
            for name in ['cover-final.webp', 'avatar.webp'] + [f'scene-{line["scene"]}.webp' for line in poem['lines']]:
                self.assertIn('/maanshan/media/' + poem['slug'] + '/' + name, compatible)
        for webp, path in compatible.items():
            self.assertIn(webp, published)
            self.assertTrue(path.startswith('/maanshan/media/compatible/'))
            self.assertNotIn(path.lstrip('/'), excluded)
            with Image.open(root / path.lstrip('/')) as image, Image.open(root / webp.lstrip('/')) as original:
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
                       '/maanshan/media/%2e%2e/test.mp4', '/api/model.glb', '/maanshan/media/avatar.exe',
                       '/maanshan/media/words/index.mjs', '/maanshan/media/words/Clip.mp3']:
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
