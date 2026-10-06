const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('model drawing buffers preserve retina detail within the pixel budget', async () => {
  const {modelPixelRatio} = await import('../maanshan/model-quality.mjs');
  assert.equal(modelPixelRatio(700, 500, 2), 2);
  assert.equal(modelPixelRatio(390, 400, 3), 2);
  assert.equal(modelPixelRatio(700, 500, 1), 1);
  const ratio = modelPixelRatio(1600, 1000, 3);
  assert(ratio > 1);assert(1600 * 1000 * ratio * ratio <= 2400001);
  // The exploration viewer's 3.0 MP budget keeps an expanded 820x1180 iPad stage
  // (780x908 CSS) at the full 2x; the shared 2.4 MP default would drop it to 1.84x.
  assert(modelPixelRatio(780, 908, 2) < 1.9);
  assert.equal(modelPixelRatio(780, 908, 2, 3000000), 2);
  const viewerRatio = modelPixelRatio(1146, 815, 2, 3000000);
  assert(viewerRatio > 1.6 && viewerRatio < 2);assert(1146 * 815 * viewerRatio * viewerRatio <= 3000001);
  assert.equal(modelPixelRatio(728, 752, 2, 3000000), modelPixelRatio(728, 752, 2));
  // 3x phones keep 2x under the shared default, and only the viewer's own
  // maxRatio lets their stages (362x243 normal, 402x660 expanded) render at 3x.
  assert.equal(modelPixelRatio(362, 243, 3, 3000000), 2);
  assert.equal(modelPixelRatio(362, 243, 3, 3000000, 3), 3);
  assert.equal(modelPixelRatio(402, 660, 3, 3000000, 3), 3);
  assert.equal(modelPixelRatio(362, 243, 2.75, 3000000, 3), 2.75);
  assert.equal(modelPixelRatio(700, 500, 2, 3000000, 3), 2);
  const phoneRatio = modelPixelRatio(800, 600, 3, 3000000, 3);
  assert(phoneRatio > 2 && phoneRatio < 3);assert(800 * 600 * phoneRatio * phoneRatio <= 3000001);
});

test('all selected observation models are bounded self-contained GLBs', async () => {
  const {validateGLB} = await import('../maanshan/model-source.mjs');
  const {EXPLORATION_CONTENT} = await import('../maanshan/exploration-data.mjs');
  for (const slug of ['bo-chuan-gua-zhou','gui-yuan-tian-ju','zao-chun','jue-ju','zheng-ren-mai-lu','ke-zhi']) {
    const bytes=fs.readFileSync(path.join(__dirname,'../maanshan/media/exploration',slug,EXPLORATION_CONTENT[slug].modelFile));
    const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    assert.equal(validateGLB(buffer),buffer);
  }
});

test('HD models fall back to a lite copy that every device can decode', async () => {
  const {supportsHDModel} = await import('../maanshan/exploration.mjs');
  const {EXPLORATION_CONTENT} = await import('../maanshan/exploration-data.mjs');
  const json = file => {
    const bytes=fs.readFileSync(path.join(__dirname,'../maanshan/media/exploration',file));
    return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
  };
  const lite = Object.entries(EXPLORATION_CONTENT).filter(([,content])=>content.liteModelFile);
  assert.deepEqual(lite.map(([slug])=>slug).sort(),['jue-ju','ke-zhi']);
  for (const [slug,content] of lite) {
    assert.ok(content.liteAssetVersion,slug);
    assert.ok((json(slug+'/'+content.modelFile).extensionsRequired||[]).includes('EXT_texture_webp'),slug);
    // The lite copy needs no extension, so iOS 13 Safari and WebGL 1 can show it.
    assert.deepEqual(json(slug+'/'+content.liteModelFile).extensionsRequired||[],[],slug);
  }
  const ua = (userAgent, extra={}) => supportsHDModel({userAgent, ...extra});
  assert.equal(ua('Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1'), false);
  assert.equal(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.1'), false);
  assert.equal(ua('Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'), true);
  assert.equal(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'), true);
  // iPadOS asking for the desktop site: the Safari version is the iPadOS version.
  const desktop = v => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'+(v?' Version/'+v:'')+' Safari/605.1.15';
  assert.equal(ua(desktop('13.1.2'),{maxTouchPoints:5}), false);
  assert.equal(ua(desktop('16.6'),{maxTouchPoints:5}), true);
  assert.equal(ua(desktop(''),{maxTouchPoints:5}), false);
  assert.equal(ua(desktop('13.1.2'),{maxTouchPoints:0}), true);
  assert.equal(ua('Mozilla/5.0 (Linux; Android 9; SM-T295) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',{deviceMemory:1}), false);
  assert.equal(ua('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',{deviceMemory:4}), true);
  assert.equal(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'), true);
  assert.equal(supportsHDModel(undefined), true);
});

test('grades 1-3 have no AR exploration entry or AR file', async () => {
  const {EXPLORATION_CONTENT} = await import('../maanshan/exploration-data.mjs');
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname,'../maanshan',file),'utf8')).poems;
  const lower = [...read('poems.json'),...read('poems-preview.json')].filter(poem=>Number(poem.grade)<=3);
  assert.equal(lower.length,6);
  for (const poem of lower) {
    assert.equal(EXPLORATION_CONTENT[poem.slug],undefined,poem.slug);
    // No AR model or scene picture is left. ti-xi-lin-bi keeps only its
    // model.glb, because the mountain game (not AR) loads it.
    const folder=path.join(__dirname,'../maanshan/media/exploration',poem.slug);
    assert.deepEqual(fs.existsSync(folder)?fs.readdirSync(folder):[],poem.slug==='ti-xi-lin-bi'?['model.glb']:[],poem.slug);
  }
});

test('preview poems 10-12 each carry a grounded two-step observation', async () => {
  const {EXPLORATION_CONTENT} = await import('../maanshan/exploration-data.mjs');
  const {poems} = JSON.parse(fs.readFileSync(path.join(__dirname,'../maanshan/poems-preview.json'),'utf8'));
  const bare = s => String(s).replace(/[\s，。、；：？！「」『』]/g,'');
  assert.equal(poems.length,6);
  for (const poem of poems.filter(poem=>Number(poem.grade)>=4)) {
    const entry=EXPLORATION_CONTENT[poem.slug];
    assert(entry,poem.slug);assert.notEqual(poem.explore,false);
    assert(fs.existsSync(path.join(__dirname,'../maanshan/media/exploration',poem.slug,'scene.webp')),poem.slug);
    const text=bare(poem.lines.map(line=>line.text).join(''));
    assert.equal(entry.observations.length,2);
    for (const step of entry.observations) {
      assert(text.includes(bare(step.verse)),`${poem.slug}: ${step.verse}`);
      assert(step.verse.includes(step.word[0]),`${poem.slug}: ${step.word[0]}`);
      assert.equal(step.choices.length,2);assert([0,1].includes(step.answer));
    }
  }
});

test('invalid or externally linked model files cannot start extra downloads', async () => {
  const {validateGLB} = await import('../maanshan/model-source.mjs');
  assert.throws(()=>validateGLB(new ArrayBuffer(19)),/invalid-model/);
  const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},images:[{uri:'https://example.invalid/texture.png'}]}));
  const length=Math.ceil(json.length/4)*4,bytes=Buffer.alloc(20+length,32);
  bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);
  assert.throws(()=>validateGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),/external-model-resource/);
});
