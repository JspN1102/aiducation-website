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
  for (const slug of ['bo-chuan-gua-zhou','gui-yuan-tian-ju','zao-chun']) {
    const bytes=fs.readFileSync(path.join(__dirname,'../maanshan/media/exploration',slug,EXPLORATION_CONTENT[slug].modelFile));
    const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    assert.equal(validateGLB(buffer),buffer);
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
