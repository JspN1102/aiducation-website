import { SPEECH_AUDIO_FILES } from './media/speech/index.mjs?v=20260908e';

export function getSpeechAudioURL(text) {
  if (typeof text !== 'string') return null;
  const key = text.normalize('NFC').trim();
  const file = Object.hasOwn(SPEECH_AUDIO_FILES, key) ? SPEECH_AUDIO_FILES[key] : null;
  return file ? new URL('./media/speech/' + file, import.meta.url).href : null;
}
