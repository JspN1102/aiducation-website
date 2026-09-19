const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {validateEvent, aggregateEvents} = require('../api/_lib/research-store.cjs');

test('optional game observations validate, retain modes and never become exam measurements', async () => {
  const {createProcessResearch} = await import('../maanshan/poem-games/research.mjs');
  let alive=true, seq=0;
  const events=[], sessionId=randomUUID();
  const research=createProcessResearch((type,fields)=>{
    const event={eventId:randomUUID(),sessionId,seq:++seq,clientAt:new Date().toISOString(),activeMs:seq*10,
      poemId:1,appVersion:'test',contentVersion:'test',...fields,type,context:{mode:'standard',...fields.context}};
    events.push(event);
  },{prefix:'game.goose',alive:()=>alive});
  research.present('feather',{position:0,total:3,optionOrder:['white','red','green']});
  research.present('feather',{position:0,total:3,optionOrder:['white','red','green']});
  research.answer('feather','red',false);research.hint('feather');
  research.answer('feather','white',true);
  research.action('feather','ridge','camera_rotate');research.error('assets','timeout');
  research.complete();research.complete();
  assert.equal(events.filter(e=>e.type==='item_presented').length,1);
  assert.equal(events.filter(e=>e.type==='retry').length,1);
  assert.equal(events.filter(e=>e.response?.choiceId==='completed').length,1);
  assert.deepEqual(events.filter(e=>e.type==='answer_submitted').map(e=>[e.attemptNo,e.result.correct]),[[1,false],[2,true]]);
  assert.ok(events.every(e=>e.context.mode==='standard'&&e.context.itemType==='microgame'));
  const rows=events.map(event=>({researchId:'test-pupil',grade:1,cls:'A',source:'client',serverReceivedAt:event.clientAt,event,qualityFlags:[]}));
  events.forEach(event=>validateEvent(event));
  const summary=aggregateEvents(rows,{from:'2020-01-01',to:'2030-01-01'});
  assert.equal(summary.summary.clientReported.measuredN,0);
  const count=events.length;alive=false;research.answer('water','green',true);research.hint('water');
  assert.equal(events.length,count);
});

test('failed or absent optional research callbacks cannot interrupt a game', async () => {
  const {createProcessResearch} = await import('../maanshan/poem-games/research.mjs');
  for(const callback of [undefined,()=>{throw new Error('offline');},()=>Promise.reject(new Error('offline'))]){
    const research=createProcessResearch(callback,{prefix:'game.test'});
    assert.doesNotThrow(()=>{research.answer('step','choice',true);research.hint('step');research.reset();});
  }
  await new Promise(resolve=>setImmediate(resolve));
});

test('free replay state applies to hints, answers and completion without replacing parent modes elsewhere', async () => {
  const {createProcessResearch}=await import('../maanshan/poem-games/research.mjs');
  const events=[];let replay=false;
  const research=createProcessResearch((type,fields)=>events.push({type,...fields}),{prefix:'game.rain',context:()=>replay?{mode:'free'}:{}});
  research.answer('word.0','option.0',true);
  assert.equal(events[0].context.mode,undefined);
  replay=true;research.reset();events.length=0;
  research.present('word.0',{position:0,total:5});research.hint('word.0','audio');research.answer('word.0','option.0',true);research.complete();
  assert.ok(events.every(e=>e.context.mode==='free'));
});
