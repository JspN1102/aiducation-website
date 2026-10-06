#!/usr/bin/env node
// Every character the school platform can put on screen from its own files,
// for scripts/build-maanshan-fonts.py (what the subset fonts must hold) and
// server/font-coverage.test.cjs (which fails when a file gains a character the
// shipped fonts lack). One definition serves both so they cannot drift.
//
//   client  maanshan/**/*.{mjs,js,json,html,css} except vendor/, media/ and the
//           generated app.bundle.css and font-slices.mjs (the extension's
//           character list, which is no text of its own): interface, poems (poems.json and
//           poems-preview.json), games, teacher pages, stories, quiz data,
//           canvas text (poetry-card.mjs). Whole files are read, comments
//           included, so nothing visible is missed (a few comment characters
//           cost a few glyphs), plus what escapes spell out: \uXXXX in
//           JavaScript strings and JSON, &#...; in HTML, \XXXX in CSS.
//           These characters go into the subset fonts every page loads.
//   server  api/*.js and api/_lib/*: error and status messages, teacher
//           summaries and the prompts that shape AI replies. Comments are left
//           out (most are Simplified Chinese developer notes), and so are the
//           mandarin-assessment site's own endpoints. These characters must be
//           in the subset fonts or the on-demand extension.
//   media   maanshan/media/** data files are audio and asset lookup tables
//           (words/index.mjs, speech/index.mjs, recitation manifests,
//           ASSET-SOURCES.md, rain-catcher glyph provenance): their keys repeat
//           text the poems and interface already show, plus Simplified Chinese
//           keys for the speech services, and none is displayed. MEDIA_VISIBLE
//           would list a media data file whose text is shown.
//   dynamic AI replies, speech-to-text results and names come from no file:
//           scripts/font-common-chars.txt lists the common characters the
//           on-demand extension holds for them.
//
// Usage: node scripts/font-text.cjs [--json]   (prints a summary or the sets)
// No network, no account data.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_EXTENSIONS = new Set(['.mjs', '.js', '.json', '.html', '.css']);
const CLIENT_SKIP = new Set(['vendor', 'media']);
// Generated files under maanshan/: the stylesheet bundle repeats its sources;
// the extension's slice list is written by the font build itself.
const CLIENT_GENERATED = new Set(['app.bundle.css', 'font-slices.mjs']);
// Endpoints of the older mandarin-assessment site, which has its own pages.
const SERVER_SKIP = new Set(['api/chat.js', 'api/report.js']);
const MEDIA_VISIBLE = Object.freeze([]);
// Always in the subset fonts: printable ASCII, Latin-1 and Latin Extended-A/B,
// Latin Extended Additional.
const BASE_RANGES = Object.freeze([[0x20, 0x7E], [0xA0, 0x24F], [0x1E00, 0x1EFF]]);

const isHan = code => (code >= 0x3400 && code <= 0x9FFF) || (code >= 0xF900 && code <= 0xFAFF) || (code >= 0x20000 && code <= 0x3FFFF);
// Characters that must render in the Chinese font of the sentence: Han,
// CJK punctuation and symbols, bopomofo, CJK forms and full-width forms.
const isChineseText = code => isHan(code) || (code >= 0x3000 && code <= 0x303F) || (code >= 0x3100 && code <= 0x312F) ||
  (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF01 && code <= 0xFF60);

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function clientFiles(root = ROOT) {
  const files = [], base = path.join(root, 'maanshan');
  walk(base, file => {
    const parts = path.relative(base, file).split(path.sep);
    if (parts.some(part => CLIENT_SKIP.has(part)) || (parts.length === 1 && CLIENT_GENERATED.has(parts[0]))) return;
    if (CLIENT_EXTENSIONS.has(path.extname(file))) files.push(file);
  });
  for (const name of MEDIA_VISIBLE) files.push(path.join(base, name));
  return files;
}

function serverFiles(root = ROOT) {
  const files = [];
  for (const name of fs.readdirSync(path.join(root, 'api')).sort()) {
    if (name.endsWith('.js') && !SERVER_SKIP.has('api/' + name)) files.push(path.join(root, 'api', name));
  }
  walk(path.join(root, 'api/_lib'), file => { if (/\.(c?js|mjs)$/.test(file)) files.push(file); });
  return files;
}

// JavaScript split into code without comments and the bodies of its string
// and template literals. Regular expression literals stay in the code, so a
// "//" inside a pattern or a URL is not taken for a comment, and the \u
// escapes of a character class are not taken for text.
const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
function lexJs(source) {
  let code = '', i = 0, last = '', word = '';
  const strings = [], braces = []; // brace depth of each open template ${ ... }
  const n = source.length;
  const regexAllowed = () => !last || REGEX_AFTER.has(last) || REGEX_KEYWORDS.has(word);
  function readString(quote) {
    let j = i + 1;
    while (j < n && source[j] !== quote && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
    strings.push(source.slice(i + 1, j));
    code += source.slice(i, j + 1); i = j + 1; last = quote; word = '';
  }
  function readTemplate() { // from a backtick or the } that closes a ${...}
    let j = i + 1;
    while (j < n) {
      if (source[j] === '\\') { j += 2; continue; }
      if (source[j] === '`' || (source[j] === '$' && source[j + 1] === '{')) break;
      j++;
    }
    strings.push(source.slice(i + 1, j));
    if (j >= n) { code += source.slice(i); i = n; return; }
    if (source[j] === '`') { code += source.slice(i, j + 1); i = j + 1; last = '`'; word = ''; return; }
    code += source.slice(i, j + 2); i = j + 2; braces.push(0); last = '{'; word = '';
  }
  while (i < n) {
    const c = source[i], next = source[i + 1];
    if (c === '/' && next === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { const end = source.indexOf('*/', i + 2); code += ' '; i = end < 0 ? n : end + 2; continue; }
    if (c === '"' || c === "'") { readString(c); continue; }
    if (c === '`') { readTemplate(); continue; }
    if (c === '{' && braces.length) braces[braces.length - 1]++;
    if (c === '}' && braces.length) {
      if (braces[braces.length - 1] === 0) { braces.pop(); readTemplate(); continue; }
      braces[braces.length - 1]--;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(source[j])) j++;
      code += source.slice(i, j); i = j; last = '/'; word = ''; continue;
    }
    code += c; i++;
    if (/\s/.test(c)) continue;
    if (/[A-Za-z0-9_$]/.test(c)) { word = (/[A-Za-z0-9_$]/.test(last) ? word : '') + c; last = c; }
    else { last = c; word = ''; }
  }
  return {code, strings};
}

const fromCode = value => { try { return String.fromCodePoint(value); } catch { return ''; } };
// The characters that escapes in a JavaScript string body spell out.
function jsEscapes(text) {
  let out = '';
  for (const m of text.matchAll(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g)) out += fromCode(parseInt(m[1] || m[2], 16));
  // Join surrogate pairs written as two \u escapes.
  return out.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, pair => pair);
}
const htmlEscapes = text => [...text.matchAll(/&#x([0-9a-fA-F]+);|&#([0-9]+);/g)].map(m => fromCode(m[1] ? parseInt(m[1], 16) : Number(m[2]))).join('');
const cssEscapes = text => [...text.matchAll(/\\([0-9a-fA-F]{1,6})\s?/g)].map(m => fromCode(parseInt(m[1], 16))).join('');

// The text of one file as the fonts must cover it.
function visibleText(file, source, {comments}) {
  const extension = path.extname(file);
  if (extension === '.json') return source + JSON.stringify(JSON.parse(source), null, 0).replace(/\\u[0-9a-fA-F]{4}/g, '') + jsEscapes(source);
  if (extension === '.css') return source + cssEscapes(source);
  if (extension === '.html') {
    // Inline scripts are lexed like modules; the markup gives its entities.
    let extra = htmlEscapes(source);
    for (const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) extra += lexJs(m[1]).strings.map(jsEscapes).join('');
    return source + extra;
  }
  const {code, strings} = lexJs(source);
  return (comments ? source : code) + strings.map(jsEscapes).join('');
}

function codes(text) {
  const set = new Set();
  for (const ch of text) set.add(ch.codePointAt(0));
  return set;
}

const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

// The characters each file contributes, by group and file.
function scan(root = ROOT) {
  const groups = {client: new Map(), server: new Map()};
  for (const file of clientFiles(root)) groups.client.set(relative(root, file), codes(visibleText(file, fs.readFileSync(file, 'utf8'), {comments: true})));
  for (const file of serverFiles(root)) groups.server.set(relative(root, file), codes(visibleText(file, fs.readFileSync(file, 'utf8'), {comments: false})));
  return groups;
}

// Printable characters only: no controls, surrogates, private use or
// variation selectors.
const printable = code => code >= 0x20 && !(code >= 0x7F && code < 0xA0) && !(code >= 0xD800 && code <= 0xDFFF) &&
  !(code >= 0xE000 && code <= 0xF8FF) && !(code >= 0xFE00 && code <= 0xFE0F) && code !== 0xFEFF && !(code >= 0x200B && code <= 0x200F);

function requiredCharacters(root = ROOT) {
  const groups = scan(root);
  const union = map => { const all = new Set(); for (const set of map.values()) for (const code of set) if (printable(code)) all.add(code); return all; };
  const base = new Set();
  for (const [low, high] of BASE_RANGES) for (let code = low; code <= high; code++) base.add(code);
  return {base, client: union(groups.client), server: union(groups.server), groups};
}

module.exports = {ROOT, BASE_RANGES, MEDIA_VISIBLE, isHan, isChineseText, clientFiles, serverFiles, lexJs, visibleText, scan, requiredCharacters};

if (require.main === module) {
  const {base, client, server, groups} = requiredCharacters();
  const sorted = set => [...set].sort((a, b) => a - b);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({base: sorted(base), client: sorted(client), server: sorted(server),
      clientFiles: groups.client.size, serverFiles: groups.server.size}));
  } else {
    const han = set => [...set].filter(isHan).length;
    console.log(JSON.stringify({clientFiles: groups.client.size, serverFiles: groups.server.size,
      clientHan: han(client), serverHan: han(server), serverOnlyHan: [...server].filter(code => isHan(code) && !client.has(code)).length}));
  }
}
