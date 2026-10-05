'use strict';
// Preview poems 7-12 each open their round with their own game. No network, no account data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const modules=Promise.all([import('../maanshan/challenge-state.mjs'),import('../maanshan/challenge-data.mjs')]);
const preview=JSON.parse(fs.readFileSync(path.join(root,'maanshan/poems-preview.json'),'utf8')).poems;

test('each preview bank has exactly one game with its own id and a loader',async()=>{
 const [,data]=await modules;
 const dispatcher=fs.readFileSync(path.join(root,'maanshan/poem-games/index.mjs'),'utf8');
 const ids=new Set();
 for(const poem of preview){
  const games=data.CHALLENGE_SETS[poem.slug].bank.filter(item=>item.type==='microgame');
  assert.equal(games.length,1,poem.slug);
  assert.equal(games[0].id,`p${poem.id}-play-20261005`);assert.equal(games[0].slug,poem.slug);
  assert(games[0].title&&games[0].prompt&&games[0].explanation,poem.slug);
  ids.add(games[0].id);
  const loader=new RegExp(`'${poem.slug}':\\(\\)=>import\\('\\./([a-z-]+\\.mjs)\\?v=[^']+'\\)\\.then\\(m=>m\\.(mount[A-Za-z]+)\\)`).exec(dispatcher);
  assert(loader,poem.slug);
  assert.match(fs.readFileSync(path.join(root,'maanshan/poem-games',loader[1]),'utf8'),new RegExp(`export function ${loader[2]}\\(`));
 }
 assert.equal(ids.size,6);
 // The first six poems keep the ids their saved answers already use.
 assert.equal(data.POEM_GAME_ITEMS['yong-e'].id,'g1-play-20260918');
 assert.equal(data.POEM_GAME_ITEMS['zao-chun'].id,'g6-play-20260918');
});

test('new preview rounds open with the game; rounds saved before the games still load',async()=>{
 const [state,data]=await modules;
 for(const poem of preview){
  const set=data.CHALLENGE_SETS[poem.slug],game=`p${poem.id}-play-20261005`;
  for(const seed of ['one','two','three'])assert.equal(state.newAttempt(set,{seed}).itemIds[0],game,poem.slug);
  // A round started while the bank had no game opened with the hands-on question.
  const before={...set,bank:set.bank.filter(item=>item.type!=='microgame')};
  const saved=state.newAttempt(before,{seed:'before-games'});
  assert.equal(saved.itemIds[0],`p${poem.id}-m1`);
  const restored=state.readAttempt(JSON.parse(JSON.stringify(saved)),set);
  assert(restored,poem.slug);assert.deepEqual(restored.itemIds,saved.itemIds);
  assert.equal(state.prepareAttempt(set,JSON.parse(JSON.stringify(saved))).attemptId,saved.attemptId,poem.slug);
  // Its next round switches to the game.
  assert.equal(state.newAttempt(set,{previous:restored,seed:'after'}).itemIds[0],game);
 }
});
