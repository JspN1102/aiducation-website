import { WORD_AUDIO_FILES } from './media/words/index.mjs?v=20260908e';

export function getWordAudioURL(char, pinyin) {
  if (typeof char !== 'string' || typeof pinyin !== 'string') return null;
  const key = char.normalize('NFC') + '|' + pinyin.normalize('NFC').toLowerCase().trim();
  const file = Object.hasOwn(WORD_AUDIO_FILES, key) ? WORD_AUDIO_FILES[key] : null;
  return file ? new URL('./media/words/' + file, import.meta.url).href : null;
}
