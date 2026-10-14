'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const repo=path.resolve(__dirname,'..'),dir=path.join(repo,'maanshan/vendor/hanzi-data');
const load=()=>import(pathToFileURL(path.join(repo,'maanshan/writing-neatness.mjs')).href);
const medians=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')).medians;
// Pupil ink is canvas coordinates (y down) at any scale and position.
const onCanvas=(strokes,scale=0.5,dx=40,dy=30)=>strokes.map(s=>s.map(([x,y])=>[dx+x*scale,dy+(900-y)*scale]));

test('the standard strokes of every dictation character pass without a hint',async()=>{
 const {judgeNeatness}=await load();
 for(const file of fs.readdirSync(dir)){
  const r=judgeNeatness(onCanvas(medians(file)),medians(file));
  assert.ok(r&&r.pass&&!r.hint&&r.residual<0.01&&r.missing===0&&r.extra===0,file+' '+JSON.stringify(r));
 }
});
test('a slanted, squashed but tidy character still passes',async()=>{
 const {judgeNeatness}=await load(),m=medians('5cb8.json');
 const ink=onCanvas(m).map(s=>s.map(([x,y])=>[x*1.3+y*0.25,y*0.8]));
 assert.equal(judgeNeatness(ink,m).pass,true);
});
test('bent strokes: a little passes, more gets a hint, a scramble fails',async()=>{
 const {judgeNeatness,NEATNESS}=await load(),m=medians('5cb8.json');
 // each stroke pushed sideways along a wave, as an unsteady finger does
 const bend=amp=>onCanvas(m,1,0,0).map((s,k)=>s.map(([x,y],i)=>[x+amp*Math.sin(i*1.7+k),y+amp*Math.cos(i*1.3+k*2)]));
 const results=[20,60,100,140,180].map(amount=>judgeNeatness(bend(amount),m));
 assert.ok(results[0].pass&&!results[0].hint&&results[0].close,JSON.stringify(results[0]));
 assert.ok(results[2].pass&&!results[2].close,'everyday iPad writing passes but is too loose to rescue a part: '+JSON.stringify(results[2]));
 assert.ok(results[3].pass&&results[3].hint,JSON.stringify(results[3]));
 assert.ok(results.at(-1).pass===false&&results.at(-1).residual>=NEATNESS.fail,JSON.stringify(results.at(-1)));
 for(let i=1;i<results.length;i++)assert.ok(results[i].residual>=results[i-1].residual-0.005,'residual rises with the mess');
});
test('two or more strokes over fail; one over is allowed',async()=>{
 const {judgeNeatness}=await load(),m=medians('5cb8.json'),ink=onCanvas(m);
 assert.equal(judgeNeatness([...ink,ink[0]],m).pass,true);
 assert.equal(judgeNeatness([...ink,ink[0],ink[1]],m).pass,false);
});
test('two or more missing strokes fail; one missing stroke is allowed',async()=>{
 const {judgeNeatness}=await load(),m=medians('5cb8.json'),ink=onCanvas(m);
 const one=judgeNeatness(ink.slice(0,-1),m),two=judgeNeatness(ink.slice(0,-2),m);
 assert.ok(one.pass&&one.missing===1,JSON.stringify(one));
 assert.ok(!two.pass&&two.missing>=2,JSON.stringify(two));
});
test('one scribbled line for a many-stroke character fails',async()=>{
 const {judgeNeatness}=await load();
 assert.equal(judgeNeatness([[[100,200],[300,260],[420,300]]],medians('5cb8.json')).pass,false);
});
test('nothing to judge gives no verdict',async()=>{
 const {judgeNeatness}=await load(),m=medians('5cb8.json');
 assert.equal(judgeNeatness([],m),null);
 assert.equal(judgeNeatness([[]],m),null);
 assert.equal(judgeNeatness(onCanvas(m),undefined),null);
 assert.equal(judgeNeatness(onCanvas(m),[]),null);
});
