import test from 'node:test';
import assert from 'node:assert/strict';
import {readOnlyJSON} from '../maanshan/read-only-json.mjs';

const json = (body = {enabled:true}, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});

test('one early transport or successful-response body reset retries a GET and retains its options',async()=>{
 for(const failure of ['fetch','body']){
  const calls=[];
  const result=await readOnlyJSON('/api/school-auth/',{credentials:'same-origin',cache:'no-store',headers:{'X-Test':'synthetic'},fetchImpl:async(url,options)=>{
   calls.push({url,options});
   if(calls.length===1){if(failure==='fetch')throw new TypeError('Failed to fetch');return {ok:true,status:200,json:async()=>{throw new TypeError('Body reset');}};}
   return json();
  }});
  assert.equal(result.data.enabled,true);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');assert.equal(call.options.headers['X-Test'],'synthetic');}
  assert.equal(calls[0].options.signal,calls[1].options.signal,'attempts share the same deadline signal');
 }
});

test('only gateway unavailability statuses retry, and the retry count is bounded',async()=>{
 for(const status of [502,503,504]){
  let calls=0,cancelled=0;
  const result=await readOnlyJSON('/read',{fetchImpl:async()=>{calls++;return calls===1?{ok:false,status,body:{cancel:async()=>cancelled++}}:json();}});
  assert.equal(result.response.status,200);assert.equal(calls,2);assert.equal(cancelled,1);
 }
 let calls=0;const failed=await readOnlyJSON('/read',{fetchImpl:async()=>{calls++;return json({code:'AUTH_UNAVAILABLE'},503);}});
 assert.equal(failed.response.status,503);assert.equal(calls,2);
});

test('denied, conflict, rate-limit, malformed JSON and validation failures are not retried',async()=>{
 for(const status of [400,401,403,404,409,429,500]){
  let calls=0;const result=await readOnlyJSON('/read',{fetchImpl:async()=>{calls++;return json({code:'denied'},status);}});
  assert.equal(result.response.status,status);assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(readOnlyJSON('/read',{fetchImpl:async()=>{calls++;return new Response('{broken');}}),SyntaxError);assert.equal(calls,1);
 calls=0;const malformed=await readOnlyJSON('/read',{fetchImpl:async()=>{calls++;return json({unexpected:true});}});
 assert.deepEqual(malformed.data,{unexpected:true});assert.equal(calls,1,'application validators run once after parsing');
});

test('a slow transport failure is not replayed',async t=>{
 let clock=1000,calls=0;t.mock.method(Date,'now',()=>clock);
 await assert.rejects(readOnlyJSON('/read',{fetchImpl:async()=>{calls++;clock+=4500;throw new TypeError('slow reset');}}),/slow reset/);
 assert.equal(calls,1);
});

test('the original deadline includes backoff and the second request body',async()=>{
 let calls=0;const started=Date.now();
 await assert.rejects(readOnlyJSON('/read',{timeout:190,fetchImpl:async(_url,{signal})=>{
  calls++;
  if(calls===1)return json({},503);
  return {ok:true,status:200,json:()=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})};
 }}),{name:'TimeoutError'});
 assert.equal(calls,2);assert(Date.now()-started<320,'second attempt must not receive an additional190ms');
});

test('abort during backoff stops retries and already aborted callers make no request',async()=>{
 const controller=new AbortController();let calls=0;
 const pending=readOnlyJSON('/read',{signal:controller.signal,fetchImpl:async()=>{calls++;setTimeout(()=>controller.abort(),10);return json({},503);}});
 await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
 await assert.rejects(readOnlyJSON('/read',{signal:controller.signal,fetchImpl:async()=>{calls++;return json();}}),{name:'AbortError'});assert.equal(calls,1);
});

test('the helper refuses POST and never repeats a second transport error',async()=>{
 let calls=0;await assert.rejects(readOnlyJSON('/write',{method:'POST',fetchImpl:async()=>{calls++;return json();}}),/READ_ONLY_GET_REQUIRED/);assert.equal(calls,0);
 await assert.rejects(readOnlyJSON('/read',{fetchImpl:async()=>{calls++;throw new TypeError('reset again');}}),/reset again/);assert.equal(calls,2);
});
