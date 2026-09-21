import json
from pathlib import Path
import re
import tempfile
import unittest

from module_preloads import ModuleGraph, render_index, preload_data


class ModulePreloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.index = '<head><link rel="modulepreload" href="app.js?v=1"><script type="module" src="bootstrap.mjs?v=1"></script></head>'
        files = {
            'app.js': "import {ready} from './bootstrap.mjs?v=1';\nimport './base.mjs?v=2';\nconst quiz=()=>import('./challenge.mjs?v=3');\nconst ar=()=>import('./exploration.mjs?v=4');",
            'bootstrap.mjs': "import './base.mjs?v=2';\nexport const ready=true;",
            'base.mjs': "/*\nimport './commented.mjs';\n*/\n// import './missing.mjs';\nexport {value} from './nested/leaf.mjs?v=5';\nconst lazy=()=>import('./vendor/three.mjs');",
            'nested/leaf.mjs': "export * from '../bootstrap.mjs?v=1';\nexport const value=1;",
            'challenge.mjs': "import './base.mjs?v=2';\nconst game=()=>import('./poem-games/index.mjs?v=6');",
            'exploration.mjs': "export const scene=()=>import('./vendor/three.mjs');",
            'poem-games/index.mjs': "const games={'one':()=>import('./one.mjs?v=7'),'two':()=>import('./two.mjs?v=8')};",
            'poem-games/one.mjs': "import {value} from '../nested/leaf.mjs?v=5';\nexport const model=()=>import('../vendor/three.mjs');",
            'poem-games/two.mjs': "export const value=2;",
        }
        for filename, source in files.items():
            path = self.root / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(source, encoding='utf-8')

    def test_static_graph_keeps_queries_and_handles_reexports_and_cycles(self):
        self.assertEqual(ModuleGraph(self.root).closure(['app.js?v=1']),
                         ['app.js?v=1', 'bootstrap.mjs?v=1', 'base.mjs?v=2', 'nested/leaf.mjs?v=5'])

    def test_generate_is_inert_idempotent_and_excludes_dynamic_vendor(self):
        result = render_index(self.root, self.index)
        self.assertEqual(result, render_index(self.root, result))
        self.assertEqual(result.count('type="module"'), 1)
        self.assertEqual(result.count('href="app.js?v=1"'), 1)
        self.assertNotIn('three.mjs', result)
        self.assertNotIn('.glb', result)
        self.assertNotIn('commented.mjs', result)
        metadata = json.loads(re.search(r'type="application/json">(.*?)</script>', result)[1])
        self.assertEqual(metadata['quiz']['games']['two'], ['poem-games/two.mjs?v=8'])
        self.assertNotIn('poem-games/two.mjs?v=8', metadata['quiz']['common'])
        self.assertEqual(metadata['explore'], ['exploration.mjs?v=4'])

    def test_source_versions_recomputed_and_relative_paths_are_portable(self):
        before = render_index(self.root, self.index)
        path = self.root / 'base.mjs'
        path.write_text(path.read_text().replace('leaf.mjs?v=5', 'leaf.mjs?v=new'), encoding='utf-8')
        after = render_index(self.root, before)
        self.assertIn('href="nested/leaf.mjs?v=new"', after)
        self.assertNotIn('href="nested/leaf.mjs?v=5"', after)
        self.assertNotIn('/maanshan/', after)
        self.assertNotIn('/school/', after)

    def test_missing_dependency_or_entry_fails_instead_of_dropping_hints(self):
        (self.root / 'nested/leaf.mjs').unlink()
        with self.assertRaises(FileNotFoundError):
            render_index(self.root, self.index)
        with self.assertRaises(ValueError):
            render_index(self.root, '<head></head>')

    def test_query_variants_are_distinct_but_each_is_visited_once(self):
        (self.root / 'variants.mjs').write_text("import './nested/leaf.mjs?v=1';\nimport './nested/leaf.mjs?v=2';\nimport './nested/leaf.mjs?v=1';", encoding='utf-8')
        urls = ModuleGraph(self.root).closure(['variants.mjs'])
        self.assertEqual(urls.count('nested/leaf.mjs?v=1'), 1)
        self.assertEqual(urls.count('nested/leaf.mjs?v=2'), 1)

    def test_real_project_contains_six_games_and_never_preloads_model_runtime(self):
        root = Path(__file__).resolve().parent.parent / 'maanshan'
        _, startup, activities = preload_data(root, (root / 'index.html').read_text(encoding='utf-8'))
        self.assertGreater(len(startup), 25)
        self.assertEqual(len(activities['quiz']['games']), 6)
        all_urls = startup + activities['quiz']['common'] + activities['explore']
        for urls in activities['quiz']['games'].values():
            all_urls += urls
        self.assertFalse(any('three' in url or '.glb' in url or 'mountain-viewer' in url for url in all_urls))


if __name__ == '__main__':
    unittest.main()
