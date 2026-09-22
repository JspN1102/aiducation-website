'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),{execFileSync}=require('node:child_process');
const {transcodeToWav,wavFromPcm,FORMATS,MAX_INPUT_BYTES,TranscodeError,isTransient}=require('../api/_lib/audio-transcode.cjs');
const {validateWav}=require('../api/_lib/school-recordings.cjs');
const WEBM=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(200,7)]);
const MP4=Buffer.concat([Buffer.from([0,0,0,0x18]),Buffer.from('ftypisom'),Buffer.alloc(200,9)]);
function fakeSpawn({exit=0,pcm=Buffer.alloc(32000,1),delayMs=0,spawnError=null,hang=false}={}) {
 const calls=[];
 const spawn=(command,args,options)=>{
  calls.push({command,args,options});
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
  child.kill=()=>{child.killed=true;setImmediate(()=>{child.stdout.end();child.emit('close',null);});};
  if(spawnError){setImmediate(()=>child.emit('error',spawnError));return child;}
  const file=args[args.indexOf('-i')+1];
  setTimeout(()=>{
   if(child.killed)return;
   calls.at(-1).inputExisted=fs.existsSync(file);
   for(let i=0;i<pcm.length;i+=16384)child.stdout.write(pcm.subarray(i,i+16384));
   if(hang)return;
   child.stdout.end();child.emit('close',exit);
  },delayMs);
  return child;
 };
 return {spawn,calls};
}
test('ffmpeg is invoked on a private temp file with a forced demuxer, no network protocols and the PCM contract',async()=>{
 const f=fakeSpawn({pcm:Buffer.alloc(48000,3)}),tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'transcode-'));
 const wav=await transcodeToWav(WEBM,'webm',{spawnImpl:f.spawn,tmpDir,ffmpeg:'ffmpeg-test'});
 assert.equal(validateWav(wav),1500);assert.deepEqual(wav.subarray(44),Buffer.alloc(48000,3));
 const [call]=f.calls;assert.equal(call.command,'ffmpeg-test');assert.equal(call.inputExisted,true);
 const file=call.args[call.args.indexOf('-i')+1];assert(file.startsWith(tmpDir));assert.equal(fs.existsSync(file),false,'temp input is removed');
 const joined=call.args.join(' ');
 assert.match(joined,/-nostdin/);assert.match(joined,/-protocol_whitelist file -f matroska,webm -i /);assert.match(joined,/-ac 1 -ar 16000 -acodec pcm_s16le -f s16le pipe:1$/);
 assert.match(joined,/-vn -sn -dn -map_metadata -1 -t 32\.05/);assert.equal(call.options.stdio[0],'ignore');
 assert.deepEqual(fs.readdirSync(tmpDir),[]);fs.rmdirSync(tmpDir);
 const mp4=await transcodeToWav(MP4,'mp4',{spawnImpl:fakeSpawn().spawn});assert.equal(validateWav(mp4),1000);
});
test('unsupported formats, mismatched containers and oversized inputs never reach ffmpeg',async()=>{
 const f=fakeSpawn();
 for(const [input,format,code] of [[WEBM,'flac','UNSUPPORTED_FORMAT'],[WEBM,undefined,'UNSUPPORTED_FORMAT'],[WEBM,'mp4','INVALID_INPUT'],[MP4,'webm','INVALID_INPUT'],[Buffer.alloc(0),'webm','INVALID_INPUT'],[Buffer.concat([WEBM,Buffer.alloc(MAX_INPUT_BYTES)]),'webm','INVALID_INPUT'],['text','webm','INVALID_INPUT']]){
  await assert.rejects(transcodeToWav(input,format,{spawnImpl:f.spawn}),error=>error instanceof TranscodeError&&error.code===code);
 }
 assert.equal(f.calls.length,0);assert.deepEqual(Object.keys(FORMATS).sort(),['aac','m4a','mp3','mp4','ogg','webm']);
});
test('decoder failures map to stable codes and only transient ones are retryable',async()=>{
 const codeOf=async options=>{try{await transcodeToWav(WEBM,'webm',options);return 'ok';}catch(error){return error.code;}};
 assert.equal(await codeOf({spawnImpl:fakeSpawn({spawnError:Object.assign(new Error('nope'),{code:'ENOENT'})}).spawn}),'FFMPEG_UNAVAILABLE');
 assert.equal(await codeOf({spawnImpl:fakeSpawn({exit:1,pcm:Buffer.alloc(0)}).spawn}),'DECODE_FAILED');
 assert.equal(await codeOf({spawnImpl:fakeSpawn({pcm:Buffer.alloc(7000)}).spawn}),'TOO_SHORT');
 assert.equal(await codeOf({spawnImpl:fakeSpawn({pcm:Buffer.alloc(32000*32+2)}).spawn}),'TOO_LONG');
 assert.equal(await codeOf({spawnImpl:fakeSpawn({hang:true}).spawn,timeoutMs:30}),'TIMEOUT');
 assert.equal(await codeOf({spawnImpl:fakeSpawn({pcm:Buffer.alloc(32001)}).spawn}),'ok','an odd trailing byte is dropped');
 assert.equal(isTransient(new TranscodeError('TIMEOUT')),true);assert.equal(isTransient(new TranscodeError('FFMPEG_UNAVAILABLE')),true);assert.equal(isTransient(new TranscodeError('BUSY')),true);
 assert.equal(isTransient(new TranscodeError('DECODE_FAILED')),false);assert.equal(isTransient(new Error('TIMEOUT')),false);
});
test('concurrency is bounded and excess load is refused quickly instead of queueing forever',async()=>{
 const f=fakeSpawn({delayMs:40});
 const results=await Promise.allSettled(Array.from({length:20},()=>transcodeToWav(WEBM,'webm',{spawnImpl:f.spawn})));
 const busy=results.filter(r=>r.status==='rejected'&&r.reason.code==='BUSY').length,ok=results.filter(r=>r.status==='fulfilled').length;
 assert.equal(ok,15);assert.equal(busy,5);assert.equal(f.calls.length,15);
});
test('wavFromPcm writes the exact header validateWav requires',()=>{
 const wav=wavFromPcm(Buffer.alloc(8000,5));assert.equal(validateWav(wav),250);assert.equal(wav.readUInt32LE(4),wav.length-8);assert.equal(wav.readUInt32LE(40),8000);
});
function ffmpegAvailable(){try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}}
test('real ffmpeg decodes an Opus WebM and an AAC MP4 recording to the stored WAV format',{skip:!ffmpegAvailable()&&'ffmpeg not installed'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'transcode-real-'));
 try{
  for(const [name,args,format] of [['clip.webm',['-c:a','libopus','-b:a','48k'],'webm'],['clip.mp4',['-c:a','aac','-b:a','64k','-movflags','+frag_keyframe+empty_moov'],'mp4']]){
   const file=path.join(dir,name);
   execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2.5','-ac','1',...args,file],{stdio:'ignore'});
   const input=fs.readFileSync(file),wav=await transcodeToWav(input,format);
   const duration=validateWav(wav);assert(duration>=2450&&duration<=2600,`${name} duration ${duration}`);
   assert(input.length<wav.length/2,`${name} compact input is smaller than PCM`);
   let peak=0;for(let i=44;i<wav.length;i+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(i)));assert(peak>1000,'decoded audio is not silent');
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
