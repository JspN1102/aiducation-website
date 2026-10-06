import { SPEECH_AUDIO_FILES } from './media/speech/index.mjs?v=20261006-school43';
import { ROUND2_SPEECH_AUDIO_FILES } from './media/round2-tts-20261006/index.mjs?v=20261006-school45';
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
