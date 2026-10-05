import { EDB_RECITATIONS } from './recitation-index.mjs?v=20261005-school40';

const variants = {'祇':'只','峯':'峰','霑':'沾','鐘':'鍾'};
const normalize = value => String(value || '').normalize('NFC').replace(/[\s，。！？、；：,.!?;:「」『』《》]/gu, '').replace(/[祇峯霑鐘]/gu,char=>variants[char]);
const phrases = new Map();
const verses = new Map();
for (const entry of EDB_RECITATIONS) {
  const clip = file => entry.folder + '/' + file;
  for (const [text, file] of Object.entries(entry.phrases)) {
    phrases.set(normalize(text), clip(file));
    verses.set(normalize(text), clip(file));
  }
  const lines = Array.from({length:entry.lineCount},(_,i)=>Object.entries(entry.phrases).filter(([,file])=>file===`${entry.prefix}-line${i+1}.mp3`).map(([text])=>text));
  for (const text of lines.reduce((prefixes,aliases)=>prefixes.flatMap(prefix=>aliases.map(alias=>prefix+alias)),[''])) {
    phrases.set(normalize(text), clip(`${entry.prefix}-poem.mp3`));
  }
  phrases.set(normalize(entry.title), clip(`${entry.prefix}-title.mp3`));
  phrases.set(normalize(entry.author), clip(`${entry.prefix}-author.mp3`));
}
function audioURL(clip) {
  return new URL('./media/recitations/' + clip, import.meta.url).href;
}
export function getRecitationAudioURL(poem, kind, lineIndex = 0) {
  const entry = EDB_RECITATIONS.find(item => item.poemId === Number(poem?.id));
  if (!entry || !['title', 'author', 'line', 'poem'].includes(kind)) return null;
  if (kind === 'line' && (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= entry.lineCount)) return null;
  return audioURL(`${entry.folder}/${entry.prefix}-${kind === 'line' ? 'line' + (lineIndex + 1) : kind}.mp3`);
}
export function getRecitationTextURL(text) {
  if (typeof text !== 'string') return null;
  const file = phrases.get(normalize(text));
  return file ? audioURL(file) : null;
}
// Games can ask for a couplet or several verses together. Resolve every word
// against the official clips; never switch that request back to synthetic voice.
const verseKeys = [...verses.keys()].sort((a,b)=>b.length-a.length);
export function getRecitationSequence(text) {
  const direct=getRecitationTextURL(text);
  if(direct)return [direct];
  let remaining=normalize(text);const result=[];
  while(remaining){
    const key=verseKeys.find(verse=>remaining.startsWith(verse));
    if(!key)return null;
    result.push(audioURL(verses.get(key)));remaining=remaining.slice(key.length);
  }
  return result.length?result:null;
}
