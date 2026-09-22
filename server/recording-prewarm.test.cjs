'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const previousLocation=globalThis.location;
test.before(()=>{globalThis.location=new URL('https://mandarin.aiducation.asia/school/');});
test.after(()=>{if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('prewarm sends one discarded GET to the account route and throttles repeats',async()=>{
  const {prewarmAssessment}=await import('../maanshan/recording-audio.mjs');
  const calls=[];let cancelled=0;let clock=1_000_000;
  const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,body:{cancel:async()=>{cancelled++;}}};};
  assert.equal(prewarmAssessment({fetchImpl,now:()=>clock}),true);
  assert.equal(prewarmAssessment({fetchImpl,now:()=>clock+5_000}),false);
  await tick();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/school-auth/');
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.credentials,'same-origin');
  assert.equal(calls[0].options.cache,'no-store');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(cancelled,1);
  assert.equal(prewarmAssessment({fetchImpl,now:()=>clock+31_000}),true);
  await tick();
  assert.equal(calls.length,2);
});

test('prewarm never throws or leaves an unhandled rejection when the request fails',async()=>{
  const {prewarmAssessment}=await import('../maanshan/recording-audio.mjs');
  let unhandled=null;const onUnhandled=reason=>{unhandled=reason;};
  process.on('unhandledRejection',onUnhandled);
  try{
    const clock=5_000_000;
    assert.equal(prewarmAssessment({fetchImpl:async()=>{throw new TypeError('Failed to fetch');},now:()=>clock}),true);
    await tick();await tick();
    assert.equal(unhandled,null);
    assert.equal(prewarmAssessment({fetchImpl:()=>{throw new Error('sync failure');},now:()=>clock+60_000}),true);
    await tick();await tick();
    assert.equal(unhandled,null);
  }finally{process.off('unhandledRejection',onUnhandled);}
});

test('prewarm is skipped while offline or without fetch',async()=>{
  const {prewarmAssessment}=await import('../maanshan/recording-audio.mjs');
  let calls=0;const fetchImpl=async()=>{calls++;return {body:null};};
  const clock=9_000_000;
  const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true,writable:true});
  try{assert.equal(prewarmAssessment({fetchImpl,now:()=>clock}),false);}
  finally{if(previousNavigator)Object.defineProperty(globalThis,'navigator',previousNavigator);else delete globalThis.navigator;}
  assert.equal(prewarmAssessment({fetchImpl:null,now:()=>clock}),false);
  await tick();
  assert.equal(calls,0);
});
