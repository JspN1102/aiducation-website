import {readModel, createViewer, disposeObject} from './exploration.mjs?v=20260921-school2';

// Assessment viewer: no verse, vocabulary, answer caption or exploration hints.
export function mountChallengeModel(holder, {slug, poster, label = '轉動觀察', controls = []} = {}) {
  const controller = new AbortController();
  let dead = false, busy = false, viewer = null, parsed = null, pending = null;
  holder.innerHTML = `<div class="challenge-model-stage"><img class="challenge-model-poster" alt="觀察畫面" decoding="async"><div class="challenge-model-canvas" hidden></div><span class="challenge-model-status" role="status"></span></div><div class="challenge-model-tools"><button type="button" data-model="load">${label}</button>${controls.map((c, i) => `<button type="button" data-model="preset" data-preset="${i}" hidden>${c.label}</button>`).join('')}</div>`;
  const q = s => holder.querySelector(s), stage = q('.challenge-model-stage'), image = q('img'), canvas = q('.challenge-model-canvas'), status = q('[role="status"]');
  image.src = poster;
  image.addEventListener('error', () => {image.hidden = true; status.textContent = '畫面暫時未能打開，請再試一次。';}, {signal: controller.signal});
  async function load() {
    if (dead || busy) return;
    if (viewer) {viewer.reset(); return;}
    busy = true; status.textContent = '正在準備觀察畫面…';
    const request = new AbortController(); pending = request;
    const timeout = setTimeout(() => request.abort(), 35000);
    try {
      const {THREE, GLTFLoader, OrbitControls} = await import('./vendor/poetry-three.mjs?v=20260913a');
      if (dead || request.signal.aborted) throw new Error('cancelled');
      const response = await fetch(`media/exploration/${slug}/model.glb`, {signal: request.signal, cache: 'no-cache'});
      const buffer = await readModel(response, request.signal);
      if (dead || request.signal.aborted) throw new Error('cancelled');
      parsed = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
      if (dead || request.signal.aborted) {disposeObject(parsed.scene); parsed = null; throw new Error('cancelled');}
      canvas.hidden = false;
      viewer = createViewer({THREE, OrbitControls, gltf: parsed, holder: canvas, stage,
        content: {object: '觀察物件', initialView: slug === 'ti-xi-lin-bi' ? [1, .32, 0] : slug === 'gui-yuan-tian-ju' ? [0, 1.05, 1] : slug === 'zao-chun' ? [0,.14,1] : [3.3, 2.4, 5.8],
          ...(slug==='zao-chun'?{presetViews:{far:{direction:[0,.14,1],distance:1.25},near:{direction:[0,1.1,1],distance:.75}}}:{})},
        onContextLost: () => {viewer?.destroy(); viewer = null; canvas.hidden = true; image.hidden = false; status.textContent = '可以繼續看圖觀察。';}});
      parsed = null; image.hidden = true; status.textContent = '';
      q('[data-model="load"]').textContent = '回到原來角度';
      holder.querySelectorAll('[data-model="preset"]').forEach(b => b.hidden = false);
    } catch {
      if (parsed) disposeObject(parsed.scene); parsed = null;
      if (!dead) {canvas.hidden = true; status.textContent = '暫時轉不開，看圖也能繼續。';}
    } finally {clearTimeout(timeout); busy = false; if(pending === request)pending = null;}
  }
  holder.addEventListener('click', event => {
    const button = event.target.closest('[data-model]'); if (!button || dead) return;
    if (button.dataset.model === 'load') load();
    if (button.dataset.model === 'preset') viewer?.preset(controls[Number(button.dataset.preset)]?.id);
  }, {signal: controller.signal});
  return {destroy() {dead = true; controller.abort(); pending?.abort(); viewer?.destroy(); viewer = null; holder.replaceChildren();}};
}
