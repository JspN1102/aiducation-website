'use strict';
// The per-grade resource pack scope against the real catalogue, challenge data
// and recording indexes. No network, no account data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scope = require('../scripts/build-pack-scope.cjs');

const root = path.resolve(__dirname, '..');
const packed = () => JSON.parse(fs.readFileSync(path.join(root, 'deploy/media-manifest.json'), 'utf8')).assets.map(asset => asset.source.replace(/^\/maanshan\//, ''));

test('every published file is shared or marked for known grades only', async () => {
  const catalogue = await scope.loadCatalogue();
  const classify = scope.classifier(catalogue, await scope.loadIndexes());
  const grades = new Set(catalogue.map(poem => poem.grade));
  assert.equal(grades.size, 6);
  let shared = 0;
  for (const file of packed()) {
    const result = classify(file);
    if (result === null) { shared++; continue; }
    assert.ok(Array.isArray(result) && result.length > 0, file);
    assert.deepEqual(result, [...new Set(result)].sort((a, b) => a - b), file);
    assert.ok(result.every(grade => grades.has(grade)), file);
  }
  assert.ok(shared > 0 && shared < packed().length);
});

test('each kind of file goes to the grade that uses it', async () => {
  const catalogue = await scope.loadCatalogue();
  const indexes = await scope.loadIndexes();
  const classify = scope.classifier(catalogue, indexes);
  const grade = slug => catalogue.find(poem => poem.slug === slug).grade;
  // Shared by every grade.
  assert.equal(classify('vendor/fonts/noto-sans-tc-variants.woff2'), null);
  assert.equal(classify('media/shishi-guide.webp'), null);
  assert.equal(classify('media/paper-crane-v2.webp'), null);
  assert.equal(classify('media/challenges/sound-market-v1.webp'), null);
  assert.equal(classify('media/challenges/sound-pod-v1.webp'), null);
  // One poem's own folders, models, official recitations, games and challenge pictures.
  assert.deepEqual(classify('media/yong-e/cover.webp'), [grade('yong-e')]);
  assert.deepEqual(classify('media/gui-yuan-tian-ju/animation-20260919b.mp4'), [grade('gui-yuan-tian-ju')]);
  assert.deepEqual(classify('media/exploration/gui-yuan-tian-ju/model.glb'), [grade('gui-yuan-tian-ju')]);
  assert.deepEqual(classify('media/recitations/edb-20260921/grade3-poem.mp3'), [3]);
  assert.equal(classify('media/recitations/edb-20260921/grade9-poem.mp3'), null);
  assert.deepEqual(classify('media/poem-games/yong-e/goose.webp'), [grade('yong-e')]);
  assert.deepEqual(classify('media/poem-games/farewell/shore-20260919.webp'), [grade('zeng-wang-lun')]);
  assert.deepEqual(classify('media/poem-games/river/far-waiting.webp'), [grade('bo-chuan-gua-zhou')]);
  assert.deepEqual(classify('media/poem-games/garden/garden-bed.webp'), [grade('gui-yuan-tian-ju')]);
  assert.deepEqual(classify('media/poem-games/rain-catcher/leaf-boat.webp'), [grade('zao-chun')]);
  assert.deepEqual(classify('media/poem-games/mountain-peak.webp'), [grade('ti-xi-lin-bi')]);
  assert.deepEqual(classify('media/poem-games/spring-near.webp'), [grade('zao-chun')]);
  assert.equal(classify('media/poem-games/unknown-game/art.webp'), null);
  assert.deepEqual(classify('media/living-scenes/bean-v1.glb'), [grade('gui-yuan-tian-ju')]);
  assert.deepEqual(classify('media/challenges/field-soil-v1.webp'), [grade('gui-yuan-tian-ju')]);
  assert.deepEqual(classify('media/challenges/ti-xi-lin-bi-side.webp'), [grade('ti-xi-lin-bi')]);
  assert.deepEqual(classify('media/challenges/zao-chun-far.webp'), [grade('zao-chun')]);
  // Recordings: a poem line belongs to its poem, a word-bank phrase to everyone,
  // a character to every poem that contains it.
  const line = indexes.speech['鵝鵝鵝'];
  assert.ok(line);
  assert.deepEqual(classify('media/speech/' + line), [grade('yong-e')]);
  const bank = indexes.speech['白菜'];
  assert.ok(bank);
  assert.equal(classify('media/speech/' + bank), null);
  const word = indexes.words['鵝|é'];
  assert.ok(word);
  assert.ok(classify('media/words/' + word).includes(grade('yong-e')));
  assert.equal(classify('media/speech/not-in-any-index.mp3'), null);
});

test('the stored scope file is current', async () => {
  const {text} = await scope.build();
  assert.equal(fs.readFileSync(path.join(root, 'deploy/pack-scope.json'), 'utf8'), text);
  const stored = JSON.parse(text);
  assert.equal(stored.schemaVersion, 1);
  const files = new Set(packed());
  for (const file of Object.keys(stored.grades)) assert.ok(files.has(file), file);
});
