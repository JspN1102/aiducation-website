const {test} = require('node:test');
const assert = require('node:assert/strict');
const cameraModule = import('../maanshan/camera-observation.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixtures(play = async () => {}) {
  const track = new EventTarget();track.stops = 0;track.stop = () => track.stops++;
  const stream = {getTracks: () => [track], getVideoTracks: () => [track]};
  const video = {srcObject: null, play, pause() {this.paused = true;}};
  return {track, stream, video};
}
test('browser camera opens without audio, plays inline and releases on close', async () => {
  const {startCameraObservation} = await cameraModule, f = fixtures();let constraints;
  const camera = startCameraObservation(f.video, {mediaDevices: {getUserMedia: async value => {constraints = value;return f.stream;}}});
  assert.deepEqual(await camera.ready, {ok: true});
  assert.equal(constraints.audio, false);assert.equal(constraints.video.facingMode.ideal, 'environment');
  assert.equal(f.video.srcObject, f.stream);assert.equal(f.video.muted, true);assert.equal(f.video.playsInline, true);
  camera.stop();camera.stop();assert.equal(f.track.stops, 1);assert.equal(f.video.srcObject, null);
});
test('missing camera API and rejected permission settle instead of opening a system AR service', async () => {
  const {startCameraObservation} = await cameraModule;
  for (const [reason, mediaDevices] of [['unsupported', {}], ['permission_denied', {getUserMedia: async () => {throw {name: 'NotAllowedError'};}}], ['no_camera', {getUserMedia: async () => {throw {name: 'NotFoundError'};}}]]) {
    const f = fixtures();assert.deepEqual(await startCameraObservation(f.video, {mediaDevices}).ready, {ok: false, reason});
    assert.equal(f.video.srcObject, null);
  }
});
test('leaving while permission is pending resolves immediately and stops a late camera stream', async () => {
  const {startCameraObservation} = await cameraModule, f = fixtures();let grant;
  const camera = startCameraObservation(f.video, {mediaDevices: {getUserMedia: () => new Promise(resolve => {grant = resolve;})}});
  camera.stop();assert.deepEqual(await camera.ready, {ok: false, reason: 'closed'});
  grant(f.stream);await tick();assert.equal(f.track.stops, 1);assert.equal(f.video.srcObject, null);
});
test('an unanswered permission prompt times out and still releases a later stream', async () => {
  const {startCameraObservation} = await cameraModule, f = fixtures();let grant;
  const camera = startCameraObservation(f.video, {timeoutMs: 5, mediaDevices: {getUserMedia: () => new Promise(resolve => {grant = resolve;})}});
  assert.deepEqual(await camera.ready, {ok: false, reason: 'timeout'});
  grant(f.stream);await tick();assert.equal(f.track.stops, 1);assert.equal(f.video.srcObject, null);
});
test('playback failure and device disconnection release the camera', async () => {
  const {startCameraObservation} = await cameraModule;
  const failure = fixtures(async () => {throw {name: 'NotReadableError'};});
  assert.deepEqual(await startCameraObservation(failure.video, {mediaDevices: {getUserMedia: async () => failure.stream}}).ready, {ok: false, reason: 'busy'});
  assert.equal(failure.track.stops, 1);
  const f = fixtures(), ended = [];
  const camera = startCameraObservation(f.video, {mediaDevices: {getUserMedia: async () => f.stream}, onEnd: reason => ended.push(reason)});
  await camera.ready;f.track.dispatchEvent(new Event('ended'));assert.deepEqual(ended, ['ended']);assert.equal(f.video.srcObject, null);
});
test('model drawing buffers preserve retina detail within the pixel budget', async () => {
  const {modelPixelRatio} = await import('../maanshan/model-quality.mjs');
  assert.equal(modelPixelRatio(700, 500, 2), 2);
  assert.equal(modelPixelRatio(390, 400, 3), 2);
  assert.equal(modelPixelRatio(700, 500, 1), 1);
  const ratio = modelPixelRatio(1600, 1000, 3);assert(ratio > 1);assert(1600 * 1000 * ratio * ratio <= 2400001);
});
