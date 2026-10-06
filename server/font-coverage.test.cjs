'use strict';
// The shipped subset fonts against every character the platform's files can
// show (scripts/font-text.cjs, the same scan the font build uses). Fails when
// a poem, game, page or server message gains a character the fonts lack: run
//   python scripts/build-maanshan-fonts.py --source-directory <fonts>
// (see the script) and commit the fonts it writes. No network, no account data.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {pathToFileURL} = require('node:url');
const text = require('../scripts/font-text.cjs');

const root = path.resolve(__dirname, '..');
const fonts = path.join(root, 'maanshan/vendor/fonts');
const FAMILIES = ['sans', 'serif'];
const show = codes => [...codes].slice(0, 40).map(code => String.fromCodePoint(code) + ' U+' + code.toString(16).toUpperCase()).join(', ');

// The character map of a WOFF2 font: header, table directory, the Brotli
// stream, then the cmap table's Unicode subtables (formats 4 and 12).
const TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT',
  'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
const cmaps = new Map();
function cmap(file) {
  if (cmaps.has(file)) return cmaps.get(file);
  const data = fs.readFileSync(file);
  assert.equal(data.readUInt32BE(0), 0x774f4632, file + ' is not WOFF2');
  const tables = data.readUInt16BE(12);
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) { const byte = data[offset++]; value = value * 128 + (byte & 0x7f); if (!(byte & 0x80)) return value; }
    throw new Error('bad UIntBase128 in ' + file);
  };
  const directory = [];
  for (let i = 0; i < tables; i++) {
    const flags = data[offset++];
    let tag = TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) { tag = data.toString('latin1', offset, offset + 4); offset += 4; }
    const length = base128(), version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    directory.push({tag, length: transformed ? base128() : length});
  }
  const stream = zlib.brotliDecompressSync(data.subarray(offset, offset + data.readUInt32BE(20)));
  let start = 0, table = null;
  for (const entry of directory) {
    if (entry.tag === 'cmap') table = stream.subarray(start, start + entry.length);
    start += entry.length;
  }
  assert.ok(table, file + ' has no cmap');
  const codes = new Set();
  for (let i = 0; i < table.readUInt16BE(2); i++) {
    const platform = table.readUInt16BE(4 + i * 8), encoding = table.readUInt16BE(6 + i * 8), at = table.readUInt32BE(8 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = table.readUInt16BE(at);
    if (format === 4) {
      const segments = table.readUInt16BE(at + 6) / 2, ends = at + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = table.readUInt16BE(ends + s * 2), first = table.readUInt16BE(starts + s * 2), delta = table.readUInt16BE(deltas + s * 2), range = table.readUInt16BE(ranges + s * 2);
        for (let code = first; code <= end && code !== 0xffff; code++) {
          let glyph;
          if (range === 0) glyph = (code + delta) & 0xffff;
          else { glyph = table.readUInt16BE(ranges + s * 2 + range + (code - first) * 2); if (glyph) glyph = (glyph + delta) & 0xffff; }
          if (glyph) codes.add(code);
        }
      }
    } else if (format === 12) {
      for (let g = 0, groups = table.readUInt32BE(at + 12); g < groups; g++) {
        const first = table.readUInt32BE(at + 16 + g * 12), last = table.readUInt32BE(at + 20 + g * 12), glyph = table.readUInt32BE(at + 24 + g * 12);
        for (let code = first; code <= last; code++) if (glyph + code - first) codes.add(code);
      }
    }
  }
  cmaps.set(file, codes);
  return codes;
}

const font = name => path.join(fonts, name + '.woff2');
const union = (...sets) => { const all = new Set(); for (const set of sets) for (const code of set) all.add(code); return all; };
const missing = (wanted, have) => [...wanted].filter(code => !have.has(code));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
const loadSlices = async () => (await import(pathToFileURL(path.join(root, 'maanshan/font-slices.mjs')).href)).FONT_SLICES;
const main = family => union(cmap(font(`noto-${family}-hk`)), cmap(font(`noto-${family}-hk-variants`)));
const extension = (family, slices) => union(...slices.map(slice => cmap(font(`noto-${family}-hk-${slice.name}`))));
const required = text.requiredCharacters(root);

test('the font reader matches a known subset', () => {
  const pinyin = cmap(font('school-pinyin-400'));
  for (const ch of 'aɑgɡāǎǚḿ') assert.ok(pinyin.has(ch.codePointAt(0)), ch);
  assert.ok(!pinyin.has('中'.codePointAt(0)));
  const sans = cmap(font('noto-sans-hk'));
  for (const ch of '紅冠梅花飛入都不見，。「」') assert.ok(sans.has(ch.codePointAt(0)), ch);
});

test('every Chinese character of the platform files is in both main fonts', () => {
  const wanted = [...required.client].filter(text.isChineseText);
  assert.ok(wanted.length > 1400, 'the scan found the platform text');
  for (const family of FAMILIES) {
    const lacking = missing(wanted, main(family));
    assert.deepEqual(lacking, [], `noto-${family}-hk lacks ${lacking.length}: ${show(lacking)}. Rebuild with scripts/build-maanshan-fonts.py.`);
  }
});

test('the round-two poems and games are covered, including 紅冠 and 梅花', () => {
  // 詠雪, 畫雞, 七步詩, 絕句, 鄭人買履 and 客至, and the preview poems.
  const files = ['snow-count', 'rooster', 'seven-steps', 'couplet', 'shoe-market', 'guest']
    .map(name => path.join(root, 'maanshan/poem-games', name + '.mjs')).concat(path.join(root, 'maanshan/poems-preview.json'));
  for (const file of files) {
    const codes = [...text.visibleText(file, fs.readFileSync(file, 'utf8'), {comments: true})].map(ch => ch.codePointAt(0)).filter(text.isChineseText);
    for (const family of FAMILIES) assert.deepEqual(show(missing(codes, main(family))), '', path.basename(file) + ' ' + family);
  }
  for (const family of FAMILIES) for (const ch of '紅冠梅花') assert.ok(main(family).has(ch.codePointAt(0)), family + ' ' + ch);
});

test('server messages and the common characters are in the fonts or the on-demand extension', async () => {
  const slices = await loadSlices();
  const common = fs.readFileSync(path.join(root, 'scripts/font-common-chars.txt'), 'utf8').split('\n')
    .filter(line => line && !line.startsWith('#')).join('');
  const wanted = union([...required.server].filter(text.isChineseText), [...common].map(ch => ch.codePointAt(0)).filter(text.isChineseText));
  assert.ok(wanted.size > 6800);
  for (const family of FAMILIES) {
    const lacking = missing(wanted, union(main(family), extension(family, slices)));
    assert.deepEqual(lacking, [], `noto-${family}-hk and its extension lack ${lacking.length}: ${show(lacking)}`);
  }
});

test('extension slices are disjoint from the main fonts and from each other, and their files hold them', async () => {
  const slices = await loadSlices();
  assert.ok(slices.length > 0);
  const seen = new Set(), names = new Set();
  for (const slice of slices) {
    assert.match(slice.name, /^ext-\d{2,}$/);
    assert.ok(!names.has(slice.name)); names.add(slice.name);
    const codes = [...slice.text].map(ch => ch.codePointAt(0));
    assert.equal(new Set(codes).size, codes.length, slice.name + ' repeats a character');
    for (const family of FAMILIES) {
      assert.deepEqual(show(missing(codes, cmap(font(`noto-${family}-hk-${slice.name}`)))), '', slice.name + ' ' + family);
      assert.deepEqual(show(codes.filter(code => main(family).has(code))), '', slice.name + ' overlaps the main ' + family + ' font');
      assert.equal(slice.versions[family], digest(font(`noto-${family}-hk-${slice.name}`)), slice.name + ' ' + family + ' version');
    }
    for (const code of codes) { assert.ok(!seen.has(code), slice.name + ' repeats ' + String.fromCodePoint(code)); seen.add(code); }
  }
  // No slice file is left out of the list.
  const files = fs.readdirSync(fonts).filter(name => /-ext-\d+\.woff2$/.test(name)).sort();
  assert.deepEqual(files, FAMILIES.flatMap(family => [...names].map(name => `noto-${family}-hk-${name}.woff2`)).sort());
});

test('both families cover the same characters', async () => {
  const slices = await loadSlices();
  assert.deepEqual(show(missing(union(main('sans'), extension('sans', slices)), union(main('serif'), extension('serif', slices)))), '');
  assert.deepEqual(show(missing(union(main('serif'), extension('serif', slices)), union(main('sans'), extension('sans', slices)))), '');
});

test('the stylesheets name exactly the variant characters', () => {
  for (const family of FAMILIES) {
    const expected = [...cmap(font(`noto-${family}-hk-variants`))].sort((a, b) => a - b).map(code => 'U+' + code.toString(16).toUpperCase()).join(',');
    for (const sheet of ['maanshan/styles.css', 'maanshan/teacher-dashboard.css']) {
      const css = fs.readFileSync(path.join(root, sheet), 'utf8');
      const face = new RegExp(`@font-face\\{[^}]*noto-${family}-hk-variants\\.woff2[^}]*unicode-range:([^;}]*)`).exec(css);
      assert.ok(face, sheet + ' ' + family);
      assert.equal(face[1], expected, sheet + ' ' + family);
    }
  }
});

test('every font URL carries the version of the file it names', () => {
  let count = 0;
  for (const file of text.clientFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/vendor\/fonts\/([a-z0-9-]+\.woff2)\?v=([A-Za-z0-9_-]+)/g)) {
      const target = path.join(fonts, match[1]);
      assert.ok(fs.existsSync(target), path.relative(root, file) + ' names ' + match[1]);
      assert.equal(match[2], digest(target), path.relative(root, file) + ' ' + match[1]);
      count++;
    }
    for (const match of source.matchAll(/path: '\/maanshan\/vendor\/fonts\/([a-z0-9-]+\.woff2)', version: '([^']*)'/g)) {
      assert.equal(match[2], digest(path.join(fonts, match[1])), 'font-source.mjs ' + match[1]);
      count++;
    }
  }
  assert.ok(count >= 15, 'font references found: ' + count);
});

test('the shipped app.bundle.css carries the same font faces as styles.css', () => {
  // index.html loads only the bundle, so a skipped rebuild would keep old font
  // versions and unicode-ranges while every source stylesheet looks right.
  const faces = css => [...css.matchAll(/@font-face\{[^}]*\}/g)].map(match => match[0]);
  const source = faces(fs.readFileSync(path.join(root, 'maanshan/styles.css'), 'utf8'));
  const bundle = new Set(faces(fs.readFileSync(path.join(root, 'maanshan/app.bundle.css'), 'utf8')));
  assert.ok(source.length >= 4, 'styles.css font faces: ' + source.length);
  for (const face of source) assert.ok(bundle.has(face), 'app.bundle.css lacks ' + face.slice(0, 120));
  const check = require('node:child_process').spawnSync(process.execPath, [path.join(root, 'scripts/build-maanshan-css.cjs'), '--check'], {encoding: 'utf8'});
  assert.equal(check.status, 0, check.stderr);
});
