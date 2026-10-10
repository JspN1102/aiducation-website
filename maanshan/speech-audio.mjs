import { SPEECH_AUDIO_FILES } from './media/speech/index.mjs?v=20261006-school43';
import { ROUND2_SPEECH_AUDIO_FILES } from './media/round2-tts-20261006/index.mjs?v=20261007-school46';
import { getRecitationTextURL } from './recitation-audio.mjs?v=20261005-school40';

export function getSpeechAudioURL(text) {
  if (typeof text !== 'string') return null;
  const recitation = getRecitationTextURL(text);
  if (recitation) return recitation;
  const key = text.normalize('NFC').trim();
  if (Object.hasOwn(SPEECH_AUDIO_FILES, key)) return new URL('./media/speech/' + SPEECH_AUDIO_FILES[key], import.meta.url).href;
  if (Object.hasOwn(ROUND2_SPEECH_AUDIO_FILES, key)) return new URL('./media/round2-tts-20261006/' + ROUND2_SPEECH_AUDIO_FILES[key], import.meta.url).href;
  return null;
}

// Tencent reads at most 150 characters per request (TextTooLong beyond), so a long
// text is read in parts: whole sentences where they fit, then clauses, then a cut.
export function speechChunks(text, max = 120) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return [];
  const size = part => Array.from(part).length;
  const pieces = (part, pattern) => part.match(pattern) || [part];
  const fit = part => {
    if (size(part) <= max) return [part];
    const clauses = pieces(part, /[^，、,：:]+[，、,：:]*|[，、,：:]+/g);
    if (clauses.length > 1) return pack(clauses.flatMap(fit));
    const chars = Array.from(part), out = [];
    for (let i = 0; i < chars.length; i += max) out.push(chars.slice(i, i + max).join(''));
    return out;
  };
  const pack = parts => {
    const out = [];
    for (const part of parts) {
      if (out.length && size(out[out.length - 1] + part) <= max) out[out.length - 1] += part;
      else out.push(part);
    }
    return out;
  };
  const sentences = pieces(value, /[^。！？；!?;…]+[。！？；!?;…」』”’）)]*|[。！？；!?;…」』”’）)]+/g);
  return pack(sentences.flatMap(fit)).map(part => part.trim()).filter(Boolean);
}
