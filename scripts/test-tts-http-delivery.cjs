const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const https = require('node:https');

const key = 'a'.repeat(64), storage = new Map();
let synthesisCalls = 0;
let lastSynthesisText, lastSynthesisVoice, lastSynthesisSpeed, lastCacheText, lastCacheProfile;
const cachePath = require.resolve('../api/_lib/tts-cache');
require.cache[cachePath] = {
  exports: {
    CACHE_VERSION: 'test',
    cacheKey: ({text,profile}) => { lastCacheText = text; lastCacheProfile=profile; return key; },
    hasAudio: async value => storage.has(value) ? {status: 'hit'} : {status: 'miss'},
    readAudio: async value => storage.has(value) ? {status: 'hit', audio: storage.get(value)} : {status: 'miss'},
    writeAudio: async (value, audio) => { storage.set(value, audio); return true; }
  }
};

const realRequest = https.request;
https.request = (_, callback) => {
  synthesisCalls++;
  const request = new EventEmitter();
  request.setTimeout = () => {};
  request.end = payload => {
    const parsed = JSON.parse(payload);
    lastSynthesisText = parsed.Text;
    lastSynthesisVoice = parsed.VoiceType;
    lastSynthesisSpeed = parsed.Speed;
    const response = new EventEmitter();
    callback(response);
    process.nextTick(() => {
      response.emit('data', Buffer.from(JSON.stringify({Response: {Audio: Buffer.alloc(3200, 1).toString('base64')}})));
      response.emit('end');
    });
  };
  return request;
};
process.env.TENCENT_SECRET_ID = 'test-id';
process.env.TENCENT_SECRET_KEY = 'test-key';

const handler = require('../api/tts');
async function request(method, {query, body, headers} = {}) {
  const response = {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.setHeader('Content-Type', 'application/json'); this.body = value; return this; },
    end(value) { this.body = value; return this; }
  };
  await handler({method, query, body, headers}, response);
  return response;
}

async function run() {
  const body = {text: '朗讀', voice: 403001, speed: -0.25, delivery: 'url', allowSSML: true};
  const first = await request('POST', {body});
  assert.equal(first.statusCode, 200);
  assert.equal(lastSynthesisVoice, 403001);
  assert.equal(lastSynthesisSpeed, -0.25);
  assert.equal(lastSynthesisText, '<speak>朗讀</speak>');
  assert.equal(first.headers['x-tts-cache'], 'MISS-STORED');
  assert.match(first.body.url, /^\/api\/tts\/\?key=[0-9a-f]{64}&sig=[0-9a-f]{64}$/);
  const url = new URL(first.body.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  const full = await request('GET', {query});
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers['content-type'], 'audio/wav');
  assert.equal(full.headers['content-length'], full.body.length);
  assert.equal(full.body.toString('ascii', 0, 4), 'RIFF');
  const partial = await request('GET', {query, headers: {range: 'bytes=0-43'}});
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers['content-range'], `bytes 0-43/${full.body.length}`);
  assert.equal(partial.body.length, 44);
  const head = await request('HEAD', {query});
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers['content-length'], full.body.length);
  const invalid = await request('GET', {query: {...query, sig: '0'.repeat(64)}});
  assert.equal(invalid.statusCode, 404);
  const unsatisfiable = await request('GET', {query, headers: {range: `bytes=${full.body.length}-`}});
  assert.equal(unsatisfiable.statusCode, 416);
  const repeat = await request('POST', {body});
  assert.equal(repeat.headers['x-tts-cache'], 'HIT');
  assert.equal(repeat.body.url, first.body.url);
  assert.equal(synthesisCalls, 1);
  const legacy = await request('POST', {body: {...body, delivery: undefined}});
  assert.equal(legacy.headers['content-type'], 'audio/wav');
  assert.deepEqual(legacy.body, full.body);
  storage.clear();
  const traditional = '請寫出「還鄉」的「還」。';
  await request('POST', {body: {...body, text: traditional}});
  assert.equal(lastCacheText, traditional);
  assert.equal(lastSynthesisText, '<speak>请写出，还乡的<phoneme alphabet="py" ph="huan2">环</phoneme>。</speak>');
  storage.clear();
  const marked = '<speak><break time="160ms"/>請寫出「<phoneme alphabet="py" ph="huan2">還</phoneme>鄉」的「<phoneme alphabet="py" ph="huan2">還</phoneme>」。</speak>';
  await request('POST', {body: {...body, text: marked}});
  assert.equal(lastCacheText, marked);
  assert.equal(lastSynthesisText, '<speak>请写出，还乡的<phoneme alphabet="py" ph="huan2">环</phoneme>。</speak>');
  storage.clear();
  await request('POST', {body: {...body, text: '请写出「还乡」的「还」。'}});
  assert.equal(lastSynthesisText, '<speak>请写出，还乡的<phoneme alphabet="py" ph="huan2">环</phoneme>。</speak>');
  storage.clear();
  const poemLine = '<speak><phoneme alphabet="py" ph="he4">荷</phoneme><phoneme alphabet="py" ph="chang2">長</phoneme><phoneme alphabet="py" ph="chong2">重</phoneme><phoneme alphabet="py" ph="zhong4">種</phoneme></speak>';
  await request('POST', {body: {...body, text: poemLine}});
  assert.equal(lastSynthesisText, '<speak><phoneme alphabet="py" ph="he4 chang2 chong2 zhong4">贺常崇仲</phoneme></speak>');
  assert.equal(lastCacheProfile, 'pcm-silence-180-80-v1-ssml-flow-v3-natural');
  storage.clear();
  const connectedPoem = '<speak><phoneme alphabet="py" ph="qu1">曲</phoneme><phoneme alphabet="py" ph="xiang4">項</phoneme><phoneme alphabet="py" ph="xiang4">向</phoneme><phoneme alphabet="py" ph="tian1">天</phoneme><phoneme alphabet="py" ph="ge1">歌</phoneme>，<phoneme alphabet="py" ph="bai2">白</phoneme><phoneme alphabet="py" ph="mao2">毛</phoneme>。</speak>';
  await request('POST', {body: {...body, text: connectedPoem}});
  assert.equal(lastSynthesisText, '<speak><phoneme alphabet="py" ph="qu1 xiang4 xiang4 tian1 ge1">区項向天歌</phoneme>，<phoneme alphabet="py" ph="bai2 mao2">白毛</phoneme>。</speak>');
  storage.clear();
  await request('POST', {body: {...body, text: '<speak><phoneme alphabet="py" ph="dai4 yue4 he4 chu2 gui1">帶月荷鋤歸</phoneme></speak>'}});
  assert.equal(lastSynthesisText, '<speak><phoneme alphabet="py" ph="dai4 yue4 he4 chu2 gui1">帶月贺鋤歸</phoneme></speak>');
  storage.clear();
  await request('POST', {body: {...body, text: '<speak><phoneme alphabet="py" ph="dao4 xia2 cao3 mu4 chang2">道狹草木長</phoneme></speak>'}});
  assert.equal(lastSynthesisText, '<speak><phoneme alphabet="py" ph="dao4 xia2 cao3 mu4 chang2">道狹草木常</phoneme></speak>');
  storage.clear();
  await request('POST', {body: {...body, text: '還有'}});
  assert.equal(lastSynthesisText, '<speak>還有</speak>');
  storage.clear();
  await request('POST', {body: {...body, text: '测试', allowSSML: false}});
  assert.equal(lastSynthesisText, '测试');
  storage.clear();
  await request('POST', {body: {...body, text: '他說：「草盛豆苗稀，帶月荷鋤歸。」', allowSSML: false}});
  assert.equal(lastSynthesisText, '他說：「草胜豆苗稀，帶月賀鋤歸。」');
  storage.clear();
  await request('POST', {body: {...body, text: '钟山只隔数重山，明月何时照我还。', allowSSML: false}});
  assert.equal(lastSynthesisText, '钟山只隔树崇山，明月何时照我环。');
  storage.clear();
  await request('POST', {body: {...body, text: '鐘山只隔數重山，橫看成嶺側成峰。', allowSSML: false}});
  assert.equal(lastSynthesisText, '鐘山只隔樹崇山，衡看成嶺側成峰。');
  storage.clear();
  await request('POST', {body: {...body, text: '请写出「还乡」的「还」。', allowSSML: false}});
  assert.equal(lastSynthesisText, '请写出，环乡的环。');
  process.stdout.write('HTTP TTS delivery: PASS\n');
}
run().catch(error => { process.exitCode = 1; console.error(error); }).finally(() => { https.request = realRequest; });
