import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForImageElement} from '../maanshan/poem-games/image-ready.mjs';

class ImageElement extends EventTarget {
  complete = false;
  naturalWidth = 0;
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
