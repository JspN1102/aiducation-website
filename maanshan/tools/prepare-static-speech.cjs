'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const work = path.resolve(process.env.MAANSHAN_AUDIO_WORK || path.join(os.tmpdir(), 'maanshan-audio'));
const endpoint = process.env.MAANSHAN_TTS_ENDPOINT || 'https://aiducation.asia/api/tts';
const voice = 101015, speed = -0.25;
const directories = { words: path.join(root, 'media/words'), speech: path.join(root, 'media/speech') };
const exportsByKind = { words: 'WORD_AUDIO_FILES', speech: 'SPEECH_AUDIO_FILES' };
const reportPath = path.join(work, 'static-speech-generation.json');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const optionalJSON = file => fs.existsSync(file) ? readJSON(file) : {};
const normalize = text => text.normalize('NFC').trim();
const { poems } = readJSON(path.join(root, 'poems.json'));
const pronunciation = readJSON(path.join(root, 'pronunciation.json'));
const previous = optionalJSON(reportPath);
const legacy = optionalJSON(path.join(work, 'word-audio-generation.json'));
const wordEntries = new Map(), speechEntries = new Map(), conversion = new Map();

for (const pair of ['馬马','藍蓝','雞鸡','熱热','樂乐','頭头','爭争','親亲','鍋锅','帥帅','環环','黃黄','沖冲','圓圆','雲云','細细','書书','樹树','嗎吗','隊队','車车','國国','試试','髮发','鐵铁','氣气','彎弯','領领','來来','銀银','蠻蛮','觀观','複复','鄉乡','飯饭','愛爱','頸颈','聽听','別别','濕湿']) {
  const [traditional, simplified] = Array.from(pair); conversion.set(traditional, simplified);
}
for (const poem of poems) for (const line of poem.lines) {
  assert.equal(Array.from(line.text).length, Array.from(line.simplified).length, 'Traditional/simplified alignment');
  assert.equal(Array.from(line.text).length, line.pinyin.length, 'Poem pinyin alignment');
  Array.from(line.text).forEach((char, index) => conversion.set(char, Array.from(line.simplified)[index]));
}
const simplified = text => Array.from(text).map(char => conversion.get(char) || char).join('');
function numberedPinyin(value) {
  value = normalize(value).toLowerCase();
  let tone = Number(value.match(/[1-5]$/)?.[0]) || 5;
  const marks = ['āēīōūǖ', 'áéíóúǘ', 'ǎěǐǒǔǚ', 'àèìòùǜ'];
  for (let index = 0; index < marks.length; index++) if (Array.from(value).some(char => marks[index].includes(char))) tone = index + 1;
  const base = value.normalize('NFD').replace(/[\u0304\u0301\u030c\u0300]/g, '').normalize('NFC').replace(/[1-5]$/, '').replace(/ü|u:/g, 'v');
  assert.match(base + tone, /^[a-z]+[1-5]$/, 'Invalid pinyin');
  return base + tone;
}
function addWord(char, pinyin, source) {
  char = normalize(char); pinyin = normalize(pinyin).toLowerCase();
  assert.equal(Array.from(char).length, 1, 'Expected one focus character');
  const key = char + '|' + pinyin, ph = numberedPinyin(pinyin);
  if (!wordEntries.has(key)) wordEntries.set(key, { char, pinyin, simplified: simplified(char), ph, file: char.codePointAt(0).toString(16) + '-' + ph + '.mp3', sources: [] });
  wordEntries.get(key).sources.push(source);
}
const escapeXML = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const phoneme = (char, pinyin) => '<phoneme alphabet="py" ph="' + numberedPinyin(pinyin) + '">' + escapeXML(simplified(char)) + '</phoneme>';
function addSpeech(text, pinyin, source) {
  text = normalize(text);
  const chars = Array.from(text), readings = (Array.isArray(pinyin) ? pinyin : pinyin.split(/\s+/)).map(value => normalize(value).toLowerCase());
  assert.equal(chars.filter(char => /\p{Script=Han}/u.test(char)).length, readings.length, 'Pinyin alignment: ' + text);
  let index = 0;
  const ssml = '<speak>' + chars.map(char => /\p{Script=Han}/u.test(char) ? phoneme(char, readings[index++]) : escapeXML(char)).join('') + '</speak>';
  if (speechEntries.has(text)) {
    assert.equal(speechEntries.get(text).ssml, ssml, 'Conflicting reading for ' + text);
    speechEntries.get(text).sources.push(source); return;
  }
  speechEntries.set(text, { text, pinyin: readings.join(' '), ssml, file: hash(Buffer.from(text + '|' + readings.join(' '))).slice(0, 20) + '.mp3', sources: [source] });
}
for (const poem of poems) for (const [lineIndex, line] of poem.lines.entries()) {
  Array.from(line.text).forEach((char, index) => addWord(char, line.pinyin[index], 'poem:' + poem.slug + ':' + lineIndex));
  addSpeech(line.text, line.pinyin, 'poem:' + poem.slug + ':' + lineIndex);
}
const samples = [];
for (const [key, group] of Object.entries(pronunciation.groups)) for (const sample of group.examples || []) samples.push({ ...sample, source: 'group:' + key });
for (const [key, group] of Object.entries(pronunciation.tones)) for (const sample of group.examples || []) samples.push({ ...sample, source: 'tone:' + key });
for (const [key, item] of Object.entries(pronunciation.characters)) for (const sample of item.contrasts || []) samples.push({ ...sample, source: 'character:' + key });
for (const sample of samples) {
  const index = Array.from(sample.text).indexOf(sample.focusChar);
  assert.ok(index >= 0, 'Missing focusChar: ' + sample.text);
  const pinyin = sample.focusPinyin || sample.pinyin.split(/\s+/)[index];
  addWord(sample.focusChar, pinyin, sample.source);
  const readings = sample.pinyin.split(/\s+/); if (sample.focusPinyin) readings[index] = sample.focusPinyin;
  addSpeech(sample.text, readings, sample.source);
}

// Add explicit contextual readings here when adding a dictation word.
// An optional dictation item.wordPinyin string/array takes precedence over this table.
const dictationPinyin = {
  '白鵝':'bái é','彎曲':'wān qū','頸項':'jǐng xiàng','唱歌':'chàng gē','白色':'bái sè','羽毛':'yǔ máo','紅色':'hóng sè','水波':'shuǐ bō',
  '乘舟':'chéng zhōu','聽聞':'tīng wén','岸上':'àn shàng','踏歌':'tà gē','水潭':'shuǐ tán','深水':'shēn shuǐ','千尺':'qiān chǐ','送別':'sòng bié','友情':'yǒu qíng',
  '橫看':'héng kàn','山嶺':'shān lǐng','側面':'cè miàn','山峯':'shān fēng','遠近':'yuǎn jìn','高低':'gāo dī','識字':'shí zì','廬山':'lú shān','緣由':'yuán yóu',
  '瓜洲':'guā zhōu','相隔':'xiāng gé','數重山':'shù chóng shān','重山':'chóng shān','綠色':'lǜ sè','江岸':'jiāng àn','照耀':'zhào yào','還鄉':'huán xiāng',
  '豆苗':'dòu miáo','稀疏':'xī shū','清晨':'qīng chén','荒穢':'huāng huì','荷鋤':'hè chú','鋤頭':'chú tou','霑濕':'zhān shī','愛惜':'ài xī','心願':'xīn yuàn',
  '天街':'tiān jiē','滋潤':'zī rùn','潤如酥':'rùn rú sū','遙望':'yáo wàng','卻無':'què wú','處所':'chù suǒ','絕勝':'jué shèng','柳樹':'liǔ shù','滿城':'mǎn chéng',
};
for (const poem of poems) for (const item of poem.dictation) {
  const supplied = item.wordPinyin || dictationPinyin[item.word];
  assert.ok(supplied, 'Unspecified dictation phrase: ' + item.word);
  const reading = Array.isArray(supplied) ? supplied.join(' ') : supplied;
  assert.equal(reading.split(/\s+/)[Array.from(item.word).indexOf(item.char)], item.pinyin, 'Dictation focus reading mismatch');
  addWord(item.char, item.pinyin, 'dictation:' + poem.slug);
  addSpeech(`${item.word}，${item.word}的${item.char}。`, `${reading} ${reading} de ${item.pinyin}`, 'dictation:' + poem.slug);
}

const inventories = { words: wordEntries, speech: speechEntries };
const report = { version: 2, startedAt: new Date().toISOString(), voice, speed, words: {}, speech: {}, requests: [] };
const verified = new Map(), existingHashes = new Map();
function filePath(kind, file) {
  assert.equal(typeof file, 'string', 'Expected a filename');
  assert.match(file, /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.mp3$/, 'Unsafe audio filename');
  return path.join(directories[kind], file);
}
function command(executable, args) {
  const result = spawnSync(executable, args, { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(executable + ': ' + result.error.message);
  if (result.status !== 0) throw new Error(executable + ' failed: ' + result.stderr.toString());
  return result.stdout;
}
function audioInfo(file, kind) {
  if (verified.has(file)) return verified.get(file);
  const data = JSON.parse(command('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const pcm = command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  let energy = 0, peak = 0, activeSamples = 0;
  for (let index = 0; index < pcm.length; index += 2) { const sample = pcm.readInt16LE(index); energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) > 300) activeSamples++; }
  const duration = Number(data.format.duration);
  assert.ok(duration > 0.1 && duration < (kind === 'words' ? 3 : 20), 'Audio duration out of bounds: ' + file);
  assert.ok(peak > 1000 && activeSamples > 300, 'Audio has no clear speech signal: ' + file);
  assert.equal(data.streams[0].codec_name, 'mp3');
  const info = { duration, codec: 'mp3', bytes: fs.statSync(file).size, pcmHash: hash(pcm), sha256: hash(fs.readFileSync(file)), rms: Math.round(Math.sqrt(energy / (pcm.length / 2))), peak, activeSamples };
  verified.set(file, info);
  if (verified.size % 50 === 0) console.log(JSON.stringify({ validatedAudioFiles: verified.size }));
  return info;
}
async function readIndex(kind) {
  const file = path.join(directories[kind], 'index.mjs');
  if (!fs.existsSync(file)) return {};
  const value = (await import(pathToFileURL(file).href))[exportsByKind[kind]];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Invalid audio index: ' + kind);
  for (const filename of Object.values(value)) filePath(kind, filename);
  return { ...value };
}
function knownEntry(kind, key) { return previous[kind]?.[key] || (kind === 'words' ? legacy.entries?.[key] : undefined); }
function validateKnown(kind, key, entry) {
  const known = knownEntry(kind, key);
  if (!known) return;
  if (known.pinyin) assert.equal(known.pinyin, entry.pinyin, 'Reading changed for existing audio: ' + key);
  if (known.ph && entry.ph) assert.equal(known.ph, entry.ph, 'Phoneme changed: ' + key);
}
function resolveEntry(kind, key, entry, files) {
  validateKnown(kind, key, entry);
  const indexed = files[key];
  // A deterministic speech filename includes the requested pinyin. Changing a
  // reading is a deliberate migration, never an implicit replacement.
  if (kind === 'speech' && indexed && /^[a-f0-9]{20}\.mp3$/.test(indexed)) {
    assert.equal(indexed, entry.file, 'Reading changed for indexed speech: ' + key);
  }
  let selected = indexed;
  if (!selected && fs.existsSync(filePath(kind, entry.file))) selected = entry.file;
  if (!selected && kind === 'words') {
    const alias = files[entry.simplified + '|' + entry.pinyin];
    if (alias && fs.existsSync(filePath(kind, alias))) selected = alias;
  }
  return { ...entry, file: selected || entry.file };
}
function save() { fs.mkdirSync(work, { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
async function synthesize(entry, kind) {
  const key = kind === 'words' ? entry.char + '|' + entry.pinyin : entry.text;
  const output = filePath(kind, entry.file);
  const ssml = kind === 'words' ? '<speak>' + phoneme(entry.char, entry.pinyin) + '</speak>' : entry.ssml;
  assert.ok(!fs.existsSync(output), 'Refusing to replace existing audio: ' + key);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const request = { kind, key, attempt, status: null, startedAt: new Date().toISOString() };
    report.requests.push(request); save();
    const temporary = output + '.' + crypto.randomUUID() + '.pending';
    try {
      const started = Date.now();
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ssml, voice, speed }), signal: AbortSignal.timeout(25000) });
      request.status = response.status;
      assert.ok(response.ok && response.headers.get('content-type')?.startsWith('audio/'), 'TTS rejected request: HTTP ' + response.status);
      fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
      const info = audioInfo(temporary, kind);
      // COPYFILE_EXCL prevents replacing media even if another process created it.
      fs.copyFileSync(temporary, output, fs.constants.COPYFILE_EXCL);
      request.elapsedMs = Date.now() - started;
      report[kind][key] = { ...entry, ssml, ...info, generated: true }; save();
      console.log(JSON.stringify({ generated: kind, key, duration: info.duration, bytes: info.bytes })); return;
    } catch (error) {
      request.error = error.message; save();
      if (attempt === 3 || fs.existsSync(output)) throw error;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}
function addMapping(files, key, file) {
  if (!Object.hasOwn(files, key)) files[key] = file;
}
function appendMappings(existing) {
  const files = { words: { ...existing.words }, speech: { ...existing.speech } };
  // All primary word keys come first so a simplified alias never displaces a
  // different established character, e.g. 祇 and 只 both pronounced zhi3.
  for (const [key, entry] of wordEntries) addMapping(files.words, key, entry.file);
  for (const entry of wordEntries.values()) addMapping(files.words, entry.simplified + '|' + entry.pinyin, entry.file);
  for (const [key, entry] of speechEntries) addMapping(files.speech, key, entry.file);
  for (const [key, entry] of speechEntries) addMapping(files.speech, simplified(key), entry.file);
  for (const poem of poems) for (const line of poem.lines) {
    const file = speechEntries.get(line.text).file;
    addMapping(files.speech, line.text + line.punctuation, file);
    addMapping(files.speech, simplified(line.text) + line.punctuation, file);
  }
  for (const kind of Object.keys(files)) for (const [key, file] of Object.entries(existing[kind])) assert.equal(files[kind][key], file, 'Existing mapping changed');
  return files;
}
function polyphonicChecks() {
  const groups = new Map();
  for (const [key, entry] of wordEntries) {
    if (!groups.has(entry.char)) groups.set(entry.char, []);
    groups.get(entry.char).push(report.words[key]);
  }
  return [...groups].filter(([, entries]) => entries.length > 1).map(([char, entries]) => {
    assert.equal(new Set(entries.map(entry => entry.pcmHash)).size, entries.length, 'Polyphonic audio collapsed: ' + char);
    assert.equal(new Set(entries.map(entry => entry.file)).size, entries.length, 'Polyphonic URLs collapsed: ' + char);
    return { char, distinctDecodedAudio: true, readings: entries.map(entry => ({ pinyin: entry.pinyin, file: entry.file, duration: entry.duration, pcmHash: entry.pcmHash })) };
  });
}
function writeIndex(kind, files, oldFiles) {
  // Skip unchanged indexes to retain exact bytes and modification times.
  if (JSON.stringify(files) === JSON.stringify(oldFiles) && fs.existsSync(path.join(directories[kind], 'index.mjs'))) return;
  const target = path.join(directories[kind], 'index.mjs');
  const temporary = target + '.' + crypto.randomUUID() + '.pending';
  fs.writeFileSync(temporary, 'export const ' + exportsByKind[kind] + ' = Object.freeze(' + JSON.stringify(files, null, 2) + ');\n', { flag: 'wx' });
  fs.renameSync(temporary, target);
}
async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || ['--check', '--reuse-only', '--generate'].includes(args[0])), 'Usage: node prepare-static-speech.cjs [--check|--reuse-only|--generate]');
  const mode = args[0] || '--inventory';
  report.mode = mode;
  const existing = { words: await readIndex('words'), speech: await readIndex('speech') };
  const missing = [];
  for (const kind of Object.keys(inventories)) for (const [key, entry] of inventories[kind]) {
    const resolved = resolveEntry(kind, key, entry, existing[kind]);
    inventories[kind].set(key, resolved);
    if (!fs.existsSync(filePath(kind, resolved.file))) missing.push({ kind, key, file: resolved.file });
  }
  report.inventory = { poemPositions: poems.reduce((sum, poem) => sum + poem.lines.reduce((n, line) => n + Array.from(line.text).length, 0), 0), comparisonSamples: samples.length, focusWords: wordEntries.size, uniquePhrases: speechEntries.size, poemLines: poems.reduce((sum, poem) => sum + poem.lines.length, 0), dictationPrompts: poems.reduce((sum, poem) => sum + poem.dictation.length, 0), missing };
  if (mode === '--inventory') { console.log(JSON.stringify(report.inventory, null, 2)); return; }
  // Fail before network or mutation for missing historical mappings whose key
  // is no longer represented by source content: there is no safe synthesis text.
  for (const kind of Object.keys(existing)) {
    const expected = new Set([...inventories[kind].values()].map(entry => entry.file));
    for (const file of Object.values(existing[kind])) assert.ok(fs.existsSync(filePath(kind, file)) || (mode === '--generate' && expected.has(file)), 'Missing historical audio: ' + kind + '/' + file);
    const onDisk = fs.existsSync(directories[kind]) ? fs.readdirSync(directories[kind]).filter(file => file.endsWith('.mp3')) : [];
    // Preserve and validate orphan MP3s too; removed source content is not a deletion request.
    for (const file of onDisk) {
      const absolute = filePath(kind, file), info = audioInfo(absolute, kind);
      existingHashes.set(absolute, info.sha256);
    }
  }
  for (const kind of Object.keys(inventories)) for (const [key, entry] of inventories[kind]) {
    const file = filePath(kind, entry.file);
    if (!fs.existsSync(file)) continue;
    const info = audioInfo(file, kind), known = knownEntry(kind, key);
    if (known?.sha256) assert.equal(info.sha256, known.sha256, 'Existing audio differs from its saved hash: ' + key);
    report[kind][key] = { ...entry, ssml: kind === 'words' ? '<speak>' + phoneme(entry.char, entry.pinyin) + '</speak>' : entry.ssml, ...info, reused: true };
  }
  assert.ok(mode === '--generate' || missing.length === 0, 'Missing ' + missing.length + ' audio files; only --generate can request new audio');
  if (mode === '--generate') {
    const parsed = new URL(endpoint); assert.ok(['http:', 'https:'].includes(parsed.protocol), 'Invalid TTS endpoint protocol');
    for (const folder of Object.values(directories)) fs.mkdirSync(folder, { recursive: true });
    const queue = [...missing];
    let failed = false;
    const results = await Promise.allSettled(Array.from({ length: 3 }, async () => {
      while (!failed && queue.length) {
        const item = queue.shift();
        try { await synthesize(inventories[item.kind].get(item.key), item.kind); }
        catch (error) { failed = true; throw error; }
      }
    }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  const files = appendMappings(existing);
  for (const kind of Object.keys(files)) for (const file of Object.values(files[kind])) assert.ok(fs.existsSync(filePath(kind, file)), 'Index points to missing audio');
  report.polyphonicChecks = polyphonicChecks();
  for (const [file, sha256] of existingHashes) assert.equal(hash(fs.readFileSync(file)), sha256, 'Existing audio changed during run');
  report.coverage = { existingFilesPreserved: existingHashes.size, existingWordMappingsPreserved: Object.keys(existing.words).length, existingSpeechMappingsPreserved: Object.keys(existing.speech).length, wordFiles: new Set(Object.values(files.words)).size, wordKeysIncludingAliases: Object.keys(files.words).length, speechFiles: new Set(Object.values(files.speech)).size, speechTextKeysIncludingAliases: Object.keys(files.speech).length, generatedFiles: Object.values(report.words).concat(Object.values(report.speech)).filter(entry => entry.generated).length, polyphonicCharacters: report.polyphonicChecks.length };
  report.completedAt = new Date().toISOString();
  if (mode !== '--check') {
    for (const folder of Object.values(directories)) fs.mkdirSync(folder, { recursive: true });
    // Helpers are deliberately not rewritten: their cache version belongs to deployment.
    for (const kind of Object.keys(files)) writeIndex(kind, files[kind], existing[kind]);
    save();
  }
  console.log(JSON.stringify({ completed: true, mode, ...report.coverage, requests: report.requests.length, ...(mode === '--check' ? {} : { report: reportPath }) }));
}
main().catch(error => {
  // Endpoint values and response bodies are omitted from logs and reports.
  console.error(error.message); process.exitCode = 1;
});
