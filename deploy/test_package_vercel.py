"""School packaging must isolate the relay without modifying Guangzhou APIs."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('package_vercel',HERE/'package-vercel.py')
packager=importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageRelayTests(unittest.TestCase):
    def test_entries_forward_untouched_requests_to_fixed_routes(self):
        entries={name:packager.relay_entry(name) for name in packager.API_FILES}
        script=r"""
const vm=require('node:vm'),assert=require('node:assert/strict');
const entries=JSON.parse(process.argv[1]);
for(const [name,source] of Object.entries(entries)){
 let called;
 const context={module:{exports:{}},require(path){
  assert.equal(path,'./_lib/guangzhou-relay.cjs');
  return {relay:(...args)=>{called=args;return 'forwarded';}};
 }};
 vm.runInNewContext(source,context);
 const req={url:'/api/teacher-tools?tool=analysis&reportId=test',body:Buffer.from('raw'),headers:{cookie:'test-only'}},res={};
 assert.equal(context.module.exports(req,res),'forwarded');
 assert.equal(called[0],name.replace(/\.js$/,''));
 assert.strictEqual(called[1],req);assert.strictEqual(called[2],res);
 assert.equal(req.url,'/api/teacher-tools?tool=analysis&reportId=test');
}
"""
        subprocess.run(['node','-e',script,json.dumps(entries)],check=True,capture_output=True)
        for invalid in ['chat.js','../soe.js','teacher-tools.js?tool=analysis']:
            with self.assertRaises(ValueError):packager.relay_entry(invalid)

    def test_function_limits_have_no_business_content_tracing(self):
        config=packager.functions_config()
        self.assertEqual(len(config),1)
        self.assertEqual(config['api/school-gateway.js'],{'maxDuration':60})
        self.assertTrue(all(value=={'maxDuration':60} for value in config.values()), 'Every function must outlive the relay 55-second deadline.')

    def test_package_contains_only_relay_runtime_and_source_is_untouched(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp);root=base/'source';root.mkdir();destination=base/'school'
            fixture={
                'maanshan/index.html':'school-only',
                'maanshan/recovery-sw.js':(packager.ROOT/'maanshan/recovery-sw.js').read_text(encoding='utf-8'),
                'maanshan/app.mjs':"const image='/maanshan/media/one.webp';const remote='https://cos.example/maanshan/media/one.webp';fetch('/api/school-auth/');",
                'maanshan/poems.json':json.dumps({'poems':[{'animation':{'src':'media/example/animation.mp4'}}]}),
                'maanshan/media/example/animation.mp4':'omit-media',
                'maanshan/media/example/ASSET-SOURCES.md':'private authoring notes',
                'maanshan/vendor/licenses/example.txt':'required third-party notice',
                'deploy/media-manifest.json':json.dumps({'assets':[]}),
                'api/_lib/guangzhou-relay.cjs':(packager.ROOT/'api/_lib/guangzhou-relay.cjs').read_text(encoding='utf-8'),
                'api/_lib/response-encoding.cjs':(packager.ROOT/'api/_lib/response-encoding.cjs').read_text(encoding='utf-8'),
                'api/_lib/teacher-analysis.cjs':'private Blob implementation',
                'api/_lib/school-auth.cjs':'private authentication implementation',
                'server/index.cjs':'private server implementation',
                'api/unrelated-company-api.js':'company source',
                'index.html':'company website',
                '.env':'DO_NOT_COPY',
                'package.json':json.dumps({'dependencies':{'ssh2':'^1.17.0'}}),
                'package-lock.json':'{}',
            }
            fixture.update({'api/'+name:'original Guangzhou implementation '+name for name in packager.API_FILES})
            for relative,content in fixture.items():
                file=root/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_text(content,encoding='utf-8')
            originals={name:(root/name).read_bytes() for name in fixture}
            def git(args,**kwargs):
                if args[1:]==['status','--porcelain']:return b''
                if args[1:]==['rev-parse','HEAD']:return 'a'*40+'\n'
                if args[1:]==['ls-files','-z']:return '\0'.join(fixture).encode()
                raise AssertionError(args)
            media={'excludedFiles':['maanshan/media/example/animation.mp4'],'redirects':[],'headers':[]}
            arguments=['package-vercel.py','--destination',str(destination),'--project-id','school-test','--team-id','team-test']
            with patch.object(packager,'ROOT',root),patch.object(packager.subprocess,'check_output',side_effect=git),patch.object(packager,'verify_local_assets'),patch.object(packager,'build_media_config',return_value=media),patch.object(packager,'obsolete_audio_files',return_value=set()),patch.object(sys,'argv',arguments),contextlib.redirect_stdout(io.StringIO()):
                packager.main()
            runtime=sorted(p.relative_to(destination).as_posix() for p in (destination/'api').rglob('*') if p.is_file())
            self.assertEqual(runtime,sorted(['api/_lib/guangzhou-relay.cjs','api/_lib/response-encoding.cjs','api/school-gateway.js']))
            self.assertFalse((destination/'server').exists())
            for name,original in originals.items():self.assertEqual((root/name).read_bytes(),original)
            self.assertFalse((destination/'index.html').exists())
            self.assertFalse((destination/'maanshan').exists())
            self.assertFalse((destination/'school/media/example/ASSET-SOURCES.md').exists())
            self.assertTrue((destination/'school/vendor/licenses/example.txt').exists())
            self.assertEqual((destination/'school/index.html').read_text(), 'school-only')
            worker=(destination/'school/recovery-sw.js').read_text(encoding='utf-8')
            self.assertEqual(worker,fixture['maanshan/recovery-sw.js'])
            app=(destination/'school/app.mjs').read_text()
            self.assertIn("image='/school/media/one.webp'", app)
            self.assertIn("https://cos.example/maanshan/media/one.webp", app)
            self.assertIn("fetch('/api/school-auth/')", app)
            redirects=json.loads((destination/'vercel.json').read_text())['redirects']
            headers=json.loads((destination/'vercel.json').read_text())['headers']
            worker_headers=next(row['headers'] for row in headers if row['source']=='/school/recovery-sw.js')
            self.assertIn({'key':'Service-Worker-Allowed','value':'/'},worker_headers)
            self.assertIn({'key':'Cache-Control','value':'no-cache'},worker_headers)
            self.assertIn({'source':'/', 'destination':'/school/', 'statusCode':307}, redirects)
            self.assertIn({'source':'/maanshan/', 'destination':'/school/', 'statusCode':307}, redirects)
            self.assertIn({'source':'/maanshan', 'destination':'/school/', 'statusCode':307}, redirects)
            self.assertIn({'source':'/maanshan/:path*', 'destination':'/school/:path*', 'statusCode':307}, redirects)
            self.assertFalse((destination/'.env').exists())
            for name in packager.API_FILES:self.assertFalse((destination/'api'/name).exists())
            self.assertIn('.gateway',(destination/'api/school-gateway.js').read_text())
            manifest=json.loads(destination.with_suffix('.manifest.json').read_text())
            self.assertEqual(manifest['apiRuntime'],'guangzhou-ssh-relay')
            self.assertEqual(manifest['apiFunctions'],1)
            for row in manifest['files']:
                data=(destination/row['path']).read_bytes()
                self.assertEqual(row['bytes'],len(data))
                self.assertEqual(row['sha256'],hashlib.sha256(data).hexdigest())
            self.assertEqual(json.loads((destination/'vercel.json').read_text())['functions'],packager.functions_config())
            # Load the actual isolated gateway: only ssh2 is substituted, while
            # relative runtime imports must resolve from the packaged directory.
            script=r"""
const assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
const original=Module._load;
Module._load=function(id,...args){if(id==='ssh2')return {Client:class{}};return original.call(this,id,...args);};
assert.equal(typeof require(path.join(process.argv[1],'api/school-gateway.js')),'function');
const encoding=require(path.join(process.argv[1],'api/_lib/response-encoding.cjs'));
assert.equal(encoding.acceptsGzip('gzip'),true);assert.equal(encoding.acceptsGzip('gzip;q=0, *;q=1'),false);
"""
            subprocess.run(['node','-e',script,str(destination)],check=True,capture_output=True)
            # A helper present on disk but missing from reviewed/tracked inputs
            # must not silently produce a deployable but broken gateway.
            fixture.pop('api/_lib/response-encoding.cjs')
            arguments[2]=str(base/'incomplete')
            with patch.object(packager,'ROOT',root),patch.object(packager.subprocess,'check_output',side_effect=git),patch.object(packager,'verify_local_assets'),patch.object(packager,'build_media_config',return_value=media),patch.object(packager,'obsolete_audio_files',return_value=set()),patch.object(sys,'argv',arguments),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError,'runtime is incomplete'):packager.main()


if __name__=='__main__':unittest.main()
