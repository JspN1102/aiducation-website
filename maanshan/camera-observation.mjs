// Keep camera observation inside the page. Requesting immersive WebXR can
// launch an AR-service installer even when isSessionSupported() returns true.
// This mode overlays a movable model; it does not claim surface tracking.
export function startCameraObservation(video, {mediaDevices = globalThis.navigator?.mediaDevices, timeoutMs = 15000, onEnd} = {}) {
  let stopped = false, stream = null, timer = null, finish;
  const listeners = [];
  const cancelled = new Promise(resolve => { finish = resolve; });
  const stopTracks = source => source?.getTracks().forEach(track => track.stop());
  function stop(reason = 'closed') {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    listeners.splice(0).forEach(([track, callback]) => track.removeEventListener('ended', callback));
    stopTracks(stream);
    stream = null;
    video.pause();
    video.srcObject = null;
    finish({ok: false, reason});
    onEnd?.(reason);
  }
  const ready = (async () => {
    if (!mediaDevices?.getUserMedia) { stop('unsupported'); return {ok: false, reason: 'unsupported'}; }
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    const opening = (async () => {
      try {
        const source = await mediaDevices.getUserMedia({
          audio: false,
          video: {facingMode: {ideal: 'environment'}, width: {ideal: 960}, height: {ideal: 720}, frameRate: {ideal: 24, max: 30}}
        });
        if (stopped) { stopTracks(source); return {ok: false, reason: 'closed'}; }
        stream = source;
        for (const track of source.getVideoTracks()) {
          const ended = () => stop('ended');
          track.addEventListener('ended', ended, {once: true});
          listeners.push([track, ended]);
        }
        video.muted = true;
        video.playsInline = true;
        video.srcObject = source;
        await video.play();
        if (stopped) return {ok: false, reason: 'closed'};
        clearTimeout(timer);
        return {ok: true};
      } catch (error) {
        const reason = ['NotAllowedError', 'SecurityError'].includes(error?.name) ? 'permission_denied'
          : ['NotFoundError', 'OverconstrainedError'].includes(error?.name) ? 'no_camera'
          : error?.name === 'NotReadableError' ? 'busy' : 'unavailable';
        stop(reason);
        return {ok: false, reason};
      }
    })();
    return Promise.race([opening, cancelled]);
  })();
  return {ready, stop};
}
