'use strict';
// Which listening form (police / clinic / chest / shop) each 聽音 question of a round uses. Pure rule, no network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../maanshan/challenge.mjs'),import('../maanshan/challenge-data.mjs'),import('../maanshan/challenge-state.mjs')]);
const ONE=['yong-e','zeng-wang-lun','ti-xi-lin-bi','bo-chuan-gua-zhou','gui-yuan-tian-ju','zao-chun'];
const TWO=['yong-xue','hua-ji','qi-bu-shi','jue-ju','zheng-ren-mai-lu','ke-zhi'];
const forms=(soundFormId,roundTwo,n)=>Array.from({length:n},(_,i)=>soundFormId(roundTwo,n,i));

test('rule by number of listening questions in the round',async()=>{
 const [{soundFormId}]=await modules;
 assert.deepEqual(forms(soundFormId,false,1),['police']);
 assert.deepEqual(forms(soundFormId,true,1),['clinic']);
 assert.deepEqual(forms(soundFormId,false,2),['police','clinic']);
 assert.deepEqual(forms(soundFormId,true,2),['chest','shop']);
 assert.deepEqual(forms(soundFormId,false,3),['police','clinic','chest']);
 assert.deepEqual(forms(soundFormId,true,3),['police','clinic','shop']);
 for(const roundTwo of [false,true]){
  assert.deepEqual(forms(soundFormId,roundTwo,4),['police','clinic','chest','shop']);
  assert.deepEqual(forms(soundFormId,roundTwo,6),['police','clinic','chest','shop','police','clinic']);
 }
});

test('unknown position falls back to police (round one) / chest (round two)',async()=>{
 const [{soundFormId}]=await modules;
 for(const [count,index] of [[0,0],[2,-1],[2,2],[3,5],[NaN,0],[2,undefined],[undefined,0],[2,1.5]]){
  assert.equal(soundFormId(false,count,index),'police');
  assert.equal(soundFormId(true,count,index),'chest');
 }
});

test('real rounds: form follows the saved order of the round, every poem and mode',async()=>{
 const [{soundForm},{CHALLENGE_SETS},{newAttempt}]=await modules;
 const expected={1:'police clinic chest shop',2:'police clinic chest shop',3:'police clinic chest shop',4:'police clinic chest',5:'police clinic',6:'police clinic'};
 const expectedTwo={1:'police clinic chest shop',2:'police clinic chest shop',3:'police clinic chest shop',4:'police clinic shop',5:'chest shop',6:'chest shop'};
 for(const [list,table,roundTwo] of [[ONE,expected,false],[TWO,expectedTwo,true]])for(const slug of list){
  const set=CHALLENGE_SETS[slug],bank=set.bank||set.items,poem={slug};
  for(const seed of ['a','b','c']){
   const attempt=newAttempt(set,{seed});
   const sound=attempt.itemIds.map(id=>bank.find(item=>item.id===id)).filter(item=>item.type==='sound');
   assert.equal(sound.map(item=>soundForm(poem,item,attempt.itemIds).id).join(' '),table[set.grade],slug+' standard');
   const advanced=newAttempt(set,{seed,mode:'advanced'});
   const hard=advanced.itemIds.map(id=>bank.find(item=>item.id===id)).filter(item=>item.type==='sound');
   const want=set.grade<=3?'police clinic chest shop':roundTwo?'clinic':'police';
   assert.equal(hard.map(item=>soundForm(poem,item,advanced.itemIds).id).join(' '),want,slug+' advanced');
  }
  // Without a saved round the canonical five-question list decides (two listening questions).
  const canonical=set.items.filter(item=>item.type==='sound');
  assert.equal(canonical.map(item=>soundForm(poem,item).id).join(' '),roundTwo?'chest shop':'police clinic',slug+' canonical');
  // An item outside the round falls back.
  assert.equal(soundForm(poem,{id:'not-in-round'},attempt0(set,newAttempt)).id,roundTwo?'chest':'police');
 }
 assert.equal(soundForm({slug:'unknown-poem'},{id:'x'}).id,'police');
});
const attempt0=(set,newAttempt)=>newAttempt(set,{seed:'z'}).itemIds;
