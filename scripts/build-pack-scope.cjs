#!/usr/bin/env node
// Which grade needs which published file. The school roster gives every pupil
// one grade and the platform shows that grade's poem only, so a pupil's
// resource pack (maanshan/resource-pack.mjs) leaves out the other poems'
// animations, models, pictures and recordings. This script reads the media
// manifest, the poem catalogue, the challenge data and the recording indexes,
// decides which grades each file serves, and writes deploy/pack-scope.json for
// deploy/media_config.py to fold into maanshan/pack-manifest.json. Files that
// belong to no poem (fonts, the guide sprite, the sound shop, the shared word
// bank recordings) stay unlisted and reach every pack; teachers and all-grade
// test accounts download everything. Run after changing media, poems or
// challenges; --check fails when the stored file is stale. No network, no
// account data.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const root = path.resolve(__dirname, '..');
const OUTPUT = path.join(root, 'deploy/pack-scope.json');
// Game artwork sits under a folder or file prefix named after the game, not the poem.
const GAME_ART = Object.freeze({'yong-e': 'yong-e', farewell: 'zeng-wang-lun', river: 'bo-chuan-gua-zhou',
  garden: 'gui-yuan-tian-ju', 'rain-catcher': 'zao-chun', mountain: 'ti-xi-lin-bi', spring: 'zao-chun'});
// The living field (the scene-builder challenge) draws these; the sound shop belongs to every grade.
const LIVING_FIELD = Object.freeze(['media/challenges/field-soil-v1.webp', 'media/living-scenes/']);

const normalize = text => String(text).normalize('NFC').replace(/[\s，。！？、；：,.!?;:「」『』《》（）()]/gu, '');
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => strings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => strings(item, out));
  return out;
}
const unique = grades => grades.length ? [...new Set(grades)].sort((a, b) => a - b) : null;
const load = file => import(pathToFileURL(path.join(root, 'maanshan', file)).href);

// One entry per poem: its grade, every text the app may read aloud for it, the
// files and models its challenges name, and whether it grows the living field.
async function loadCatalogue() {
  const poems = JSON.parse(fs.readFileSync(path.join(root, 'maanshan/poems.json'), 'utf8')).poems;
  const {CHALLENGE_SETS} = await load('challenge-data.mjs');
  return poems.map(poem => {
    const set = CHALLENGE_SETS[poem.slug] || {};
    const items = [...(set.items || []), ...(set.bank || [])];
    const all = [...strings(poem), ...strings(set)];
    return {
      slug: poem.slug, grade: Number(poem.grade),
      texts: [...new Set(all.map(normalize).filter(Boolean))],
      files: [...new Set(all.filter(text => text.startsWith('media/')))],
      models: [...new Set(items.map(item => item.modelSlug).filter(Boolean))],
      livingField: items.some(item => item.type === 'scene-builder')
    };
  });
}

async function loadIndexes() {
  const [{SPEECH_AUDIO_FILES}, {WORD_AUDIO_FILES}] = await Promise.all([load('media/speech/index.mjs'), load('media/words/index.mjs')]);
  return {speech: SPEECH_AUDIO_FILES, words: WORD_AUDIO_FILES};
}

// Recording indexes map text to file; invert them to the texts each file reads.
function byFile(index) {
  const map = new Map();
  for (const [key, file] of Object.entries(index)) {
    if (!map.has(file)) map.set(file, []);
    map.get(file).push(key);
  }
  return map;
}

// Returns classify(file): the sorted grades that need the file, or null when
// every pack carries it.
function classifier(catalogue, indexes) {
  const grades = new Map(catalogue.map(poem => [poem.slug, poem.grade]));
  const known = new Set(catalogue.map(poem => poem.grade));
  const speech = byFile(indexes.speech), words = byFile(indexes.words);
  const owning = test => unique(catalogue.filter(test).map(poem => poem.grade));
  const reading = test => owning(poem => poem.texts.some(test));
  return function classify(file) {
    const parts = file.split('/');
    if (parts[0] !== 'media') return null;
    const named = owning(poem => poem.files.includes(file));
    if (named) return named;
    if (grades.has(parts[1])) return [grades.get(parts[1])];
    if (parts[1] === 'exploration') return owning(poem => poem.slug === parts[2] || poem.models.includes(parts[2]));
    if (parts[1] === 'recitations') {
      const match = /^grade(\d+)-/.exec(parts[parts.length - 1]);
      return match && known.has(Number(match[1])) ? [Number(match[1])] : null;
    }
    // A speech clip reads a phrase; a word clip reads one character. Each
    // belongs to every poem whose texts contain it, and to every pack otherwise.
    if (parts[1] === 'speech') return unique((speech.get(parts[2]) || []).flatMap(key => {
      const text = normalize(key);
      return text ? reading(candidate => candidate === text || (text.length >= 2 && candidate.includes(text))) || [] : [];
    }));
    if (parts[1] === 'words') return unique((words.get(parts[2]) || []).flatMap(key => {
      const char = normalize(key.split('|')[0]);
      return char ? reading(candidate => candidate.includes(char)) || [] : [];
    }));
    if (parts[1] === 'poem-games') {
      const game = parts.length > 3 ? parts[2] : parts[2].split('-')[0];
      return GAME_ART[game] ? [grades.get(GAME_ART[game])] : null;
    }
    if (LIVING_FIELD.some(prefix => file.startsWith(prefix))) return owning(poem => poem.livingField);
    return null;
  };
}

function packedFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'deploy/media-manifest.json'), 'utf8'));
  return manifest.assets.map(asset => ({file: asset.source.replace(/^\/maanshan\//, ''), bytes: asset.bytes}));
}

async function build() {
  const classify = classifier(await loadCatalogue(), await loadIndexes());
  const scope = {};
  const totals = new Map();
  for (const {file, bytes} of packedFiles().sort((a, b) => a.file < b.file ? -1 : 1)) {
    const grades = classify(file);
    if (grades) scope[file] = grades;
    for (const grade of grades || ['shared']) {
      const total = totals.get(grade) || {files: 0, bytes: 0};
      total.files++;total.bytes += bytes;
      totals.set(grade, total);
    }
  }
  return {text: JSON.stringify({schemaVersion: 1, grades: scope}, null, 1) + '\n', totals};
}

async function main() {
  const check = process.argv.includes('--check');
  const {text, totals} = await build();
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : null;
  if (check) {
    if (current !== text) throw new Error('deploy/pack-scope.json is stale; run node scripts/build-pack-scope.cjs');
    console.log('Pack scope matches current media, poems and challenges.');
  } else if (current !== text) {
    fs.writeFileSync(OUTPUT, text);
    console.log('Updated deploy/pack-scope.json.');
  } else console.log('deploy/pack-scope.json already current.');
  const shared = totals.get('shared') || {files: 0, bytes: 0};
  const summary = {};
  for (const [grade, total] of [...totals].filter(([key]) => key !== 'shared').sort((a, b) => a[0] - b[0])) {
    summary['grade' + grade] = {files: total.files + shared.files, megabytes: Math.round((total.bytes + shared.bytes) / 1048576)};
  }
  console.log(JSON.stringify({shared: {files: shared.files, megabytes: Math.round(shared.bytes / 1048576)}, ...summary}));
}

module.exports = {GAME_ART, LIVING_FIELD, normalize, loadCatalogue, loadIndexes, classifier, build};
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
