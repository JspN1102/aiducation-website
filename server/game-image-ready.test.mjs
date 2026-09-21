import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForImageElement, createGameImageLoader} from '../maanshan/poem-games/image-ready.mjs';

class ImageElement extends EventTarget {
  complete = false;
  naturalWidth = 0;
  loadListeners = new Set();
  addEventListener(type,listener,...rest) { if(type==='load')this.loadListeners.add(listener);super.addEventListener(type,listener,...rest); }
  removeEventListener(type,listener,...rest) { if(type==='load')this.loadListeners.delete(listener);super.removeEventListener(type,listener,...rest); }
  decode() { return Promise.reject(new Error('The source changed')); }
  loaded() { this.complete = true; this.naturalWidth = 1200; this.dispatchEvent(new Event('load')); }
}

test('a replacement image may load after the original decode rejects', async () => {
  const image = new ImageElement();
  const pending = waitForImageElement(image, {timeout: 100});
  await Promise.resolve();
  image.dispatchEvent(new Event('error'));
  image.loaded();
  assert.equal(await pending, image);
});

test('a permanently unavailable image still rejects within its deadline', async () => {
  const image = new ImageElement();
  await assert.rejects(waitForImageElement(image, {timeout: 10}), /timed out/);
});

test('leaving a game cancels an image wait', async () => {
  const controller = new AbortController();
  const pending = waitForImageElement(new ImageElement(), {signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
});

test('a decoded cached image does not need another load event', async () => {
  const image = new ImageElement();
  image.loaded();
  assert.equal(await waitForImageElement(image), image);
});

test('a game timeout offers retry but late images recover only after every required image loads',async()=>{
 const load=createGameImageLoader({timeout:5}),first=new ImageElement(),second=new ImageElement();
 let announce,notices=0,ready=false;const timeout=new Promise(resolve=>announce=resolve);
 const pending=load([first,second],{onTimeout(){notices++;announce();}}).then(()=>{ready=true;});
 await timeout;assert.equal(notices,1);assert.equal(ready,false);
 first.loaded();await Promise.resolve();assert.equal(ready,false);
 second.dispatchEvent(new Event('error'));await Promise.resolve();assert.equal(ready,false);
 second.loaded();await pending;assert.equal(ready,true);assert.equal(notices,1);
 assert.equal(first.loadListeners.size,0);assert.equal(second.loadListeners.size,0);
});

test('a previously loaded image whose source changes must be ready again before the group enables',async()=>{
 const load=createGameImageLoader({timeout:100}),first=new ImageElement(),second=new ImageElement();
 first.loaded();let ready=false;const pending=load([first,second]).then(()=>{ready=true;});
 first.complete=false;first.naturalWidth=0;second.loaded();await Promise.resolve();assert.equal(ready,false);
 first.loaded();await pending;assert.equal(ready,true);
});

test('retry cancels the old wait, so stale image loads cannot complete or time out the current generation',async()=>{
 const load=createGameImageLoader({timeout:100}),stale=new ImageElement(),fresh=new ImageElement();
 const old=load([stale]),oldResult=assert.rejects(old,{name:'AbortError'});let ready=false;
 const current=load([fresh]).then(()=>{ready=true;});await oldResult;
 stale.loaded();await Promise.resolve();assert.equal(ready,false);assert.equal(stale.loadListeners.size,0);
 fresh.loaded();await current;assert.equal(ready,true);assert.equal(fresh.loadListeners.size,0);
});

test('destroy cancels an already timed-out recovery and removes listeners before late loads arrive',async()=>{
 const controller=new AbortController(),load=createGameImageLoader({signal:controller.signal,timeout:5}),image=new ImageElement();
 let announce,ready=false;const timeout=new Promise(resolve=>announce=resolve);
 const pending=load([image],{onTimeout:announce}).then(()=>{ready=true;});
 const rejected=assert.rejects(pending,{name:'AbortError'});await timeout;controller.abort();await rejected;
 image.loaded();await Promise.resolve();assert.equal(ready,false);assert.equal(image.loadListeners.size,0);
 await assert.rejects(load([image]),{name:'AbortError'});
});
