// The on-demand extension of the two Chinese fonts. The subset fonts hold
// every character of the platform's own files; text that comes from no file
// (AI replies, speech-to-text results, names, server messages) can use any
// common character, and without this it would show those characters in a
// system font in the middle of a Noto sentence. scripts/build-maanshan-fonts.py
// cuts the common characters into slices of about 200 (font-slices.mjs); each
// slice is a FontFace of the same family with a unicode-range, so the browser
// downloads a slice only when the page shows one of its characters, and never
// for text the main subset already covers (the ranges leave those out).
// Like the main fonts, a slice comes from the route the session favours and
// falls back to the other copy. Nothing about the pupil is sent or stored.
import {FONT_SLICES} from './font-slices.mjs?v=20261006-school45';
import {orderRoutes} from './media-route.mjs?v=20260923-school23';

export const EXTENSION_FAMILIES = Object.freeze({sans: 'Noto Sans HK', serif: 'Noto Serif HK'});

// CSS unicode-range of the characters of text, consecutive code points merged.
export function unicodeRange(text) {
  const codes = [...new Set(Array.from(text, ch => ch.codePointAt(0)))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < codes.length; i++) {
    let j = i;
    while (j + 1 < codes.length && codes[j + 1] === codes[j] + 1) j++;
    const low = codes[i].toString(16).toUpperCase(), high = codes[j].toString(16).toUpperCase();
    parts.push(j > i ? `U+${low}-${high}` : `U+${low}`);
    i = j;
  }
  return parts.join(',');
}

export function slicePath(slice, key) {
  return `/maanshan/vendor/fonts/noto-${key}-hk-${slice.name}.woff2`;
}

// The src of one slice's face: the favoured route first, the other copy as
// the browser's fallback when the first fails to load.
export function sliceSource(slice, key, {remote = {}, preferPublic, memory} = {}) {
  const path = slicePath(slice, key), local = new URL(path, import.meta.url);
  local.searchParams.set('v', slice.versions[key]);
  const options = {};
  if (preferPublic !== undefined) options.preferPublic = preferPublic;
  if (memory !== undefined) options.memory = memory;
  return orderRoutes(local.href, remote[path], options).map(candidate => `url("${candidate.url}") format("woff2")`).join(', ');
}

// Add every slice as an unloaded face of each family. families maps sans and
// serif to the family names of the page (the teacher pages use their own);
// remote maps a slice path to its public copy (media-fonts.mjs).
export function installFontExtension({doc = globalThis.document, families = EXTENSION_FAMILIES, remote = {}, preferPublic, memory, slices = FONT_SLICES} = {}) {
  if (!doc?.fonts?.add || typeof FontFace !== 'function') return [];
  const faces = [];
  for (const slice of slices) {
    if (!slice.text) continue;
    const range = unicodeRange(slice.text);
    for (const [key, family] of Object.entries(families)) {
      try {
        const face = new FontFace(family, sliceSource(slice, key, {remote, preferPublic, memory}),
          {weight: '400 700', style: 'normal', display: 'swap', unicodeRange: range});
        doc.fonts.add(face);
        faces.push(face);
      } catch { /* a face the browser rejects leaves those characters to the system font */ }
    }
  }
  return faces;
}
