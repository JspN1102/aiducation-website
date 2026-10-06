import { WORD_AUDIO_FILES } from './media/words/index.mjs?v=20261006-school43';
import { ROUND2_WORD_AUDIO_FILES } from './media/round2-tts-20261006/index.mjs?v=20261007-school46';

export function getWordAudioURL(char, pinyin) {
  if (typeof char !== 'string' || typeof pinyin !== 'string') return null;
  const key = char.normalize('NFC') + '|' + pinyin.normalize('NFC').toLowerCase().trim();
  if (Object.hasOwn(WORD_AUDIO_FILES, key)) return new URL('./media/words/' + WORD_AUDIO_FILES[key], import.meta.url).href;
  // Poems 7-12's own readings live in their own folder, so the published words folder keeps its COS group.
  if (Object.hasOwn(ROUND2_WORD_AUDIO_FILES, key)) return new URL('./media/round2-tts-20261006/' + ROUND2_WORD_AUDIO_FILES[key], import.meta.url).href;
  return null;
}
