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

test('grades 1-3 have no AR exploration entry or preview AR folder', async () => {
  const {EXPLORATION_CONTENT} = await import('../maanshan/exploration-data.mjs');
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname,'../maanshan',file),'utf8')).poems;
  const lower = [...read('poems.json'),...read('poems-preview.json')].filter(poem=>Number(poem.grade)<=3);
  assert.equal(lower.length,6);
  for (const poem of lower) {
    assert.equal(EXPLORATION_CONTENT[poem.slug],undefined,poem.slug);
    // ti-xi-lin-bi keeps its model.glb because the mountain game (not AR) loads it.
    assert(!fs.existsSync(path.join(__dirname,'../maanshan/media/exploration',poem.slug,'model.glb')) || poem.slug==='ti-xi-lin-bi',poem.slug);
  }
  for (const slug of ['yong-xue','hua-ji','qi-bu-shi']) {
    assert(!fs.existsSync(path.join(__dirname,'../maanshan/media/exploration',slug)),slug);
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
