'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalog}=require('../api/_lib/poems.js');
const {poetSystemPrompt,POET_PROMPT_VERSION,POET_LIVE_VERSION}=require('../api/_lib/poet-prompt.cjs');
const {poetFacts}=require('../api/_lib/poet-facts.cjs');

test('every poem has a 詩人小檔案 in live chats, and prepared presets keep their prompt',()=>{
 for(const poem of catalog){
  assert.match(poetFacts(poem),new RegExp('詩人小檔案（'+poem.author+'）'),poem.title);
  assert.ok(poetSystemPrompt(poem,poem.grade,{facts:true}).includes(poetFacts(poem)),poem.title);
  assert.doesNotMatch(poetSystemPrompt(poem,poem.grade),/詩人小檔案/,poem.title);
 }
 assert.equal(POET_PROMPT_VERSION,'poet-conversation-20260922-v1');
 assert.match(POET_LIVE_VERSION,/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/);
});

test('the facts pupils asked about on 2026-10-13 are in the sheet',()=>{
 const sheet=id=>poetFacts(catalog.find(p=>p.id===id));
 assert.match(sheet(5),/程氏妹/);assert.match(sheet(5),/翟氏/);
 assert.match(sheet(9),/崔氏/);assert.match(sheet(9),/曹沖/);
 assert.match(sheet(2),/汪倫/);assert.match(sheet(3),/蘇八娘/);
});
