const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),poems=require('../maanshan/poems.json').poems;
const manifest=require('../maanshan/media/recitations/edb-20260921/manifest.json');
test('all official title, author and lesson recordings resolve to verified clips without changing lesson counts',async()=>{
 const {getRecitationAudioURL,getRecitationTextURL}=await import('../maanshan/recitation-audio.mjs');
 const {getSpeechAudioURL}=await import('../maanshan/speech-audio.mjs');
 assert.equal(manifest.grades.length,6);let count=0;
 for(const poem of poems){
  const recorded=manifest.grades.find(g=>g.grade===poem.grade);assert.equal(recorded.slug,poem.slug);assert.equal(poem.lines.length,4);
  for(const [name,clip] of Object.entries(recorded.segments)){
   const bytes=fs.readFileSync(path.join(root,'maanshan',clip.src));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),clip.sha256);assert.equal(bytes.length,clip.bytes);
   assert(clip.sourceStartSeconds>=0&&clip.sourceEndSeconds>clip.sourceStartSeconds&&clip.sourceEndSeconds<=recorded.sourceDurationSeconds);count++;
  }
  for(const kind of ['title','author'])assert(getRecitationAudioURL(poem,kind).endsWith(recorded.segments[kind].src));
  for(const [i,line] of poem.lines.entries()){
   const url=getRecitationAudioURL(poem,'line',i);assert(url.endsWith(recorded.segments['line'+(i+1)].src));assert.equal(getSpeechAudioURL(line.text),url);assert.equal(getSpeechAudioURL(line.simplified+line.punctuation),url);
   if(poem.grade===5)for(const clause of line.text.split('，'))assert(getRecitationTextURL(clause).includes('-verse'));
  }
  assert.equal(getRecitationAudioURL(poem,'line',4),null);
 }
 assert.equal(count,44);assert.equal(poems.find(p=>p.grade===5).author,'陶潛');
 assert.equal(getRecitationTextURL('請選一首古詩開始學習'),null);
 assert.equal(getRecitationTextURL('潤'),null);
 assert(getSpeechAudioURL('滋潤，滋潤的潤。').includes('/media/speech/'));
});
