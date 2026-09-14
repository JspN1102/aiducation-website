const guideURL = new URL('./media/shishi-guide.webp', import.meta.url).href;
const modelURL = new URL('./media/shishi/model.glb', import.meta.url).href;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let instanceID = 0;

const HINTS = {
  library: ['今天想讀哪一首？', '選一本詩集，和我一起把古詩讀成畫。', '去選一首詩'],
  read: ['先聽一聽，再讀一讀', '按「聽朗讀」聽清楚字音，準備好就按「我來讀」。', '好，我去聽一聽'],
  record: ['一次讀好一句就行', '先聽示範，再按咪高峰讀這一句。放慢一點，字音更清楚。', '好，我來試試'],
  write: ['先看筆順，再動手', '按「看筆順」跟着看一次，再在格子裏寫。寫錯了可以撤回一筆。', '好，我來寫寫'],
  quiz: ['今天想怎樣闖關？', '挑一種玩法，先看清楚這一題的提示，再動動手。', '好，我去闖關'],
  report: ['找一個字，讀得更好', '看看要練習的字，點一下聽字音，再試着讀一遍。', '好，我去練一個字'],
  explore: ['把詩裏的線索找出來', '看一看畫面，讀一讀題目。想看另一面，可以按「轉一轉」。', '好，一起找線索'],
  chat: ['把好奇的事問出來', '可以選下面的小問題，也可以打字，問詩人一件你想知道的事。', '好，我去問問']
};
const JOURNEY = [['read', '朗讀', 'record'], ['write', '寫字', 'write'], ['quiz', '闖關', 'quiz'], ['explore', '探索', 'explore']];

function symbol(name) {
  const paths = {
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    turn: '<path d="M4 8a8 8 0 1 1 0 8M4 3v5h5"/><path d="m10 9 5 3-5 3Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    reset: '<path d="M4 9a8 8 0 1 1 0 7M4 4v5h5"/>',
    left: '<path d="m14 6-6 6 6 6"/>',
    right: '<path d="m10 6 6 6-6 6"/>',
    leaf: '<path d="M19 4c-9-2-15 5-12 11s14 1 12-11ZM5 20 15 9"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}

/**
 * A quiet, optional companion. It never records, scores, starts audio or writes
 * progress. The caller supplies true completion flags and owns navigation.
 * progress may be a function so a journey card opened later is still current.
 */
export function mountShishi(container, {view = 'library', poem, progress = {}, onNavigate} = {}) {
  if (!container) throw new TypeError('A Shishi entrance container is required');
  const id = `shishi-${++instanceID}`;
  const hint = HINTS[view] || HINTS.library;
  let dead = false, tab = 'hint', generation = 0, pending = null, viewer = null;
  const events = new AbortController();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shishi-entrance';
  button.setAttribute('aria-label', '找詩詩幫忙');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', id);
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `<span class="shishi-avatar"><img src="${guideURL}" alt="" width="48" height="48" decoding="async"><span aria-hidden="true">詩</span></span><span>詩詩</span>`;
  container.replaceChildren(button);

  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = 'shishi-dialog';
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.innerHTML = `<div class="shishi-sheet">
    <header class="shishi-header"><div><p class="shishi-eyebrow">你的古詩小伙伴</p><h2 id="${id}-title">和詩詩一起</h2></div><button type="button" class="shishi-icon-button" data-shishi="close" aria-label="關閉詩詩">${symbol('close')}</button></header>
    <div class="shishi-tabs" role="tablist" aria-label="找詩詩做甚麼">${[['hint', '怎樣玩'], ['friend', '小伙伴'], ['journey', '旅程卡']].map(([key, label], i) => `<button type="button" id="${id}-tab-${key}" role="tab" data-shishi="tab" data-tab="${key}" aria-controls="${id}-panel-${key}" aria-selected="${!i}" tabindex="${i ? '-1' : '0'}">${label}</button>`).join('')}</div>
    <section class="shishi-panel shishi-hint" id="${id}-panel-hint" role="tabpanel" aria-labelledby="${id}-tab-hint">
      <div class="shishi-hello-art"><img src="${guideURL}" alt="古詩小伙伴詩詩" width="200" height="200" decoding="async"><span class="shishi-art-fallback" hidden aria-hidden="true">詩</span><span class="shishi-hello-note" aria-hidden="true">一起試試吧</span></div>
      <h3>${hint[0]}</h3><p class="shishi-instruction">${hint[1]}</p>
      <button type="button" class="shishi-primary" data-shishi="close">${hint[2]}${symbol('arrow')}</button>
      ${poem && view !== 'explore' ? `<button type="button" class="shishi-link" data-shishi="navigate" data-view="explore">${symbol('leaf')}也可以去詩境找發現${symbol('arrow')}</button>` : ''}
    </section>
    <section class="shishi-panel shishi-friend" id="${id}-panel-friend" role="tabpanel" aria-labelledby="${id}-tab-friend" hidden>
      <div class="shishi-stage"><img class="shishi-standing" src="${guideURL}" alt="陪你讀古詩的詩詩" width="260" height="260" decoding="async"><span class="shishi-art-fallback" hidden aria-hidden="true">詩</span><div class="shishi-canvas" hidden></div><span class="shishi-stage-caption">你好，我是詩詩</span></div>
      <p class="shishi-model-status" role="status">一起聽字音、找詩意，一步一步來。</p>
      <div class="shishi-model-actions"><button type="button" class="shishi-primary" data-shishi="model">${symbol('turn')}轉一轉</button><div class="shishi-turn-tools" hidden><button type="button" class="shishi-icon-button" data-shishi="left" aria-label="向左轉一點">${symbol('left')}</button><button type="button" class="shishi-secondary" data-shishi="reset">${symbol('reset')}回正面</button><button type="button" class="shishi-icon-button" data-shishi="right" aria-label="向右轉一點">${symbol('right')}</button></div></div>
    </section>
    <section class="shishi-panel shishi-journey" id="${id}-panel-journey" role="tabpanel" aria-labelledby="${id}-tab-journey" hidden></section>
  </div>`;
  document.body.append(dialog);
  const q = selector => dialog.querySelector(selector);
  const stage = q('.shishi-stage'), holder = q('.shishi-canvas'), standing = q('.shishi-standing');
  const status = q('.shishi-model-status'), modelButton = q('[data-shishi="model"]'), modelTools = q('.shishi-turn-tools');
  const hintPicture = q('.shishi-hello-art img'), avatar = button.querySelector('img');
  for (const picture of [standing, hintPicture, avatar]) {
    const updatePicture = () => {
      const missing = picture.complete && !picture.naturalWidth;
      picture.classList.toggle('shishi-image-missing', missing);
      if (picture.nextElementSibling?.matches('.shishi-art-fallback')) picture.nextElementSibling.hidden = !missing;
      if (picture === avatar) button.classList.toggle('shishi-avatar-missing', missing);
    };
    picture.addEventListener('load', updatePicture, {signal: events.signal});
    picture.addEventListener('error', updatePicture, {signal: events.signal});
    updatePicture();
  }

  function stopModel() {
    generation++;
    pending?.abort();
    pending = null;
    viewer?.destroy();
    viewer = null;
    holder.replaceChildren();
    holder.hidden = true;
    standing.hidden = false;
    stage.classList.remove('shishi-model-visible');
    stage.removeAttribute('aria-busy');
    modelTools.hidden = true;
    modelButton.hidden = false;
    modelButton.disabled = false;
    modelButton.removeAttribute('aria-busy');
    status.textContent = '一起聽字音、找詩意，一步一步來。';
  }

  function renderJourney() {
    const target = q('.shishi-journey');
    if (!poem) {
      target.innerHTML = `<div class="shishi-journey-mark" aria-hidden="true">${symbol('leaf')}</div><h3>每首詩，都有自己的旅程</h3><p class="shishi-instruction">先選一首古詩，就可以在這裏看見你的學習足跡。</p><button type="button" class="shishi-primary" data-shishi="close">去選一首詩${symbol('arrow')}</button>`;
      return;
    }
    let completed = {};
    try {completed = (typeof progress === 'function' ? progress() : progress) || {};} catch { /* unavailable state must never look completed */ }
    target.innerHTML = `<p class="shishi-eyebrow">這首詩的小足跡</p><h3>《${escapeHTML(poem.title)}》</h3><div class="shishi-journey-grid">${JOURNEY.map(([key, label, destination]) => `<button type="button" class="shishi-stop ${completed[key] === true ? 'is-complete' : ''}" data-shishi="navigate" data-view="${destination}"><span class="shishi-stop-mark" aria-hidden="true">${completed[key] === true ? symbol('check') : symbol('leaf')}</span><strong>${label}</strong><span>${completed[key] === true ? '已完成' : '去試試'}</span>${symbol('arrow')}</button>`).join('')}</div><p class="shishi-journey-note">完成一項，留下一片葉子。按小卡片就能出發。</p>`;
  }

  function selectTab(next, focus = false) {
    if (next !== tab) stopModel();
    tab = next;
    for (const tabButton of dialog.querySelectorAll('[role="tab"]')) {
      const selected = tabButton.dataset.tab === tab;
      tabButton.setAttribute('aria-selected', String(selected));
      tabButton.tabIndex = selected ? 0 : -1;
      document.getElementById(tabButton.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tabButton.focus();
    }
    if (tab === 'journey') renderJourney();
  }

  function close() {
    stopModel();
    if (dialog.open) dialog.close();
    button.setAttribute('aria-expanded', 'false');
    if (!dead && button.isConnected) button.focus({preventScroll: true});
  }

  async function loadModel() {
    if (dead || pending || viewer || !dialog.open || tab !== 'friend') return;
    const turn = ++generation, controller = new AbortController();
    pending = controller;
    const current = () => !dead && dialog.open && tab === 'friend' && generation === turn && !controller.signal.aborted;
    let parsed = null;
    const timeout = setTimeout(() => controller.abort(), 35000);
    modelButton.disabled = true;
    modelButton.setAttribute('aria-busy', 'true');
    stage.setAttribute('aria-busy', 'true');
    status.textContent = '詩詩正在準備，請稍等一下…';
    try {
      const {THREE, GLTFLoader, OrbitControls} = await import('./vendor/poetry-three.mjs?v=20260913a');
      if (!current()) return;
      const response = await fetch(modelURL, {signal: controller.signal, credentials: 'same-origin', cache: 'no-cache'});
      const buffer = await readModel(response, controller.signal);
      if (!current()) return;
      parsed = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', gltf => {
        if (!current()) {disposeObject(gltf.scene); reject(new DOMException('Aborted', 'AbortError'));}
        else resolve(gltf);
      }, reject));
      if (!current()) {disposeObject(parsed.scene); parsed = null; return;}
      holder.hidden = false;
      viewer = createViewer({THREE, OrbitControls, root: parsed.scene, holder, onLost() {
        if (dead) return;
        stopModel();
        status.textContent = '我們先看圖片吧。想轉一轉，可以再試一次。';
      }});
      parsed = null;
      standing.hidden = true;
      stage.classList.add('shishi-model-visible');
      modelButton.hidden = true;
      modelTools.hidden = false;
      status.textContent = '拖一拖，看看另一面；也可以按左右箭嘴。';
      viewer.resize();
      q('[data-shishi="reset"]').focus({preventScroll: true});
    } catch (error) {
      if (parsed) disposeObject(parsed.scene);
      if (dead || generation !== turn) return;
      viewer?.destroy();
      viewer = null;
      holder.replaceChildren();
      holder.hidden = true;
      standing.hidden = false;
      status.textContent = '我們先看圖片吧。想轉一轉，可以再試一次。';
    } finally {
      clearTimeout(timeout);
      if (!dead && generation === turn) {
        pending = null;
        modelButton.disabled = false;
        modelButton.removeAttribute('aria-busy');
        stage.removeAttribute('aria-busy');
      }
    }
  }

  button.addEventListener('click', () => {
    if (dead || dialog.open) return;
    selectTab('hint');
    dialog.showModal();
    button.setAttribute('aria-expanded', 'true');
    q('[role="tab"][aria-selected="true"]').focus({preventScroll: true});
  }, {signal: events.signal});
  dialog.addEventListener('cancel', event => {event.preventDefault(); close();}, {signal: events.signal});
  dialog.addEventListener('close', () => {
    stopModel();
    button.setAttribute('aria-expanded', 'false');
    if (!dead && button.isConnected) button.focus({preventScroll: true});
  }, {signal: events.signal});
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
      return;
    }
    const action = event.target.closest('[data-shishi]');
    if (!action || action.disabled || dead) return;
    switch (action.dataset.shishi) {
      case 'close': close(); break;
      case 'tab': selectTab(action.dataset.tab); break;
      case 'model': loadModel(); break;
      case 'reset': viewer?.reset(); break;
      case 'left': viewer?.turn(-Math.PI / 8); break;
      case 'right': viewer?.turn(Math.PI / 8); break;
      case 'navigate': {
        const destination = action.dataset.view;
        close();
        if (typeof onNavigate === 'function') onNavigate(destination);
        else if (poem?.slug) location.hash = `${encodeURIComponent(poem.slug)}/${destination}`;
        break;
      }
    }
  }, {signal: events.signal});
  q('[role="tablist"]').addEventListener('keydown', event => {
    const keys = ['hint', 'friend', 'journey'], index = keys.indexOf(tab);
    const next = event.key === 'ArrowRight' ? keys[(index + 1) % keys.length]
      : event.key === 'ArrowLeft' ? keys[(index + keys.length - 1) % keys.length]
      : event.key === 'Home' ? keys[0] : event.key === 'End' ? keys.at(-1) : null;
    if (next) {event.preventDefault(); selectTab(next, true);}
  }, {signal: events.signal});
  const routeChanged = () => {if (dialog.open || pending || viewer) close();};
  window.addEventListener('hashchange', routeChanged, {signal: events.signal});
  window.addEventListener('popstate', routeChanged, {signal: events.signal});

  return {destroy() {
    if (dead) return;
    dead = true;
    stopModel();
    events.abort();
    if (dialog.open) dialog.close();
    dialog.remove();
    button.remove();
  }};
}

const MAX_MODEL_BYTES = 12 * 1024 * 1024;
async function readModel(response, signal) {
  if (!response.ok) throw new Error('model-unavailable');
  if (Number(response.headers.get('content-length')) > MAX_MODEL_BYTES) throw new Error('model-too-large');
  let buffer;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    try {
      for (;;) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const {done, value} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_MODEL_BYTES) throw new Error('model-too-large');
        chunks.push(value);
      }
    } catch (error) {await reader.cancel().catch(() => {}); throw error;}
    finally {reader.releaseLock();}
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    buffer = bytes.buffer;
  } else buffer = await response.arrayBuffer();
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_MODEL_BYTES) throw new Error('invalid-model');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== buffer.byteLength || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('invalid-model');
  const length = header.getUint32(12, true);
  if (20 + length > buffer.byteLength) throw new Error('invalid-model');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  for (const entry of [...(json.buffers || []), ...(json.images || [])]) {
    if (entry.uri && !entry.uri.startsWith('data:')) throw new Error('external-model-resource');
  }
  return buffer;
}

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (!value?.isTexture) continue;
        textures.add(value);
        if (value.source?.data?.close) images.add(value.source.data);
      }
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
  images.forEach(bitmap => bitmap.close());
}

function createViewer({THREE, OrbitControls, root, holder, onLost}) {
  let renderer, controls, resizeObserver, dead = false;
  const listeners = new AbortController();
  try {
    renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfffbef, 0x92a6a0, 2.6));
    const key = new THREE.DirectionalLight(0xfff8ed, 3.4);
    key.position.set(-3, 5, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xddeef2, 1.4);
    fill.position.set(4, 2, -3);
    scene.add(fill);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error('empty-model');
    const centre = box.getCenter(new THREE.Vector3()), scale = 2 / longest;
    const modelGroup = new THREE.Group();
    modelGroup.add(root);
    modelGroup.scale.setScalar(scale);
    modelGroup.position.copy(centre).multiplyScalar(-scale);
    const pivot = new THREE.Group();
    pivot.add(modelGroup);
    scene.add(pivot);
    const camera = new THREE.PerspectiveCamera(34, 1, .01, 100);
    camera.position.set(0, .14, 4.5);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '立體詩詩。拖動畫面或使用方向鍵旋轉，Home 鍵回正面。');
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.autoRotate = false;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = Math.PI * .16;
    controls.maxPolarAngle = Math.PI * .82;
    controls.rotateSpeed = .7;
    controls.target.set(0, 0, 0);
    controls.update();
    controls.saveState();
    const render = () => {if (!dead) renderer.render(scene, camera);};
    // Render only when touched, resized or clicked. No loop, drift or autoplay.
    controls.addEventListener('change', render);
    const resize = () => {
      if (dead) return;
      const bounds = holder.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      renderer.setSize(bounds.width, bounds.height, false);
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      render();
    };
    const turn = angle => {pivot.rotation.y += angle; render();};
    const reset = () => {pivot.rotation.set(0, 0, 0); controls.reset(); render();};
    canvas.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); turn((event.key === 'ArrowLeft' ? -1 : 1) * Math.PI / 8);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); pivot.rotation.x = Math.max(-.5, Math.min(.5, pivot.rotation.x + (event.key === 'ArrowUp' ? -.12 : .12))); render();
      } else if (event.key === 'Home') {event.preventDefault(); reset();}
    }, {signal: listeners.signal});
    canvas.addEventListener('webglcontextlost', event => {event.preventDefault(); if (!dead) onLost();}, {signal: listeners.signal});
    holder.append(canvas);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(holder);
    resize();
    return {resize, turn, reset, destroy() {
      if (dead) return;
      dead = true;
      listeners.abort();
      resizeObserver.disconnect();
      controls.dispose();
      disposeObject(root);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    }};
  } catch (error) {
    dead = true;
    listeners.abort();
    resizeObserver?.disconnect();
    controls?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    throw error; // The caller still owns and disposes root if setup failed.
  }
}
