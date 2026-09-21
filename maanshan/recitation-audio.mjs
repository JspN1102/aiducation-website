import { EDB_RECITATIONS } from './recitation-index.mjs?v=20260921-edb1';

const normalize = value => String(value || '').normalize('NFC').replace(/[\s，。！？、；：,.!?;:「」《》]/gu, '');
const phrases = new Map();
for (const entry of EDB_RECITATIONS) {
  for (const [text, file] of Object.entries(entry.phrases)) phrases.set(normalize(text), file);
  phrases.set(normalize(entry.title), `grade${entry.grade}-title.mp3`);
  phrases.set(normalize(entry.author), `grade${entry.grade}-author.mp3`);
}
function audioURL(file) {
  return new URL('./media/recitations/edb-20260921/' + file, import.meta.url).href;
}
export function getRecitationAudioURL(poem, kind, lineIndex = 0) {
  const entry = EDB_RECITATIONS.find(item => item.grade === Number(poem?.grade));
  if (!entry || !['title', 'author', 'line'].includes(kind)) return null;
  if (kind === 'line' && (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= entry.lineCount)) return null;
  return audioURL(`grade${entry.grade}-${kind === 'line' ? 'line' + (lineIndex + 1) : kind}.mp3`);
}
export function getRecitationTextURL(text) {
  if (typeof text !== 'string') return null;
  const file = phrases.get(normalize(text));
  return file ? audioURL(file) : null;
}
