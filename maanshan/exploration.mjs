import {EXPLORATION_CONTENT} from './exploration-data.mjs?v=20260914b';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ICONS = {
  turn: '<path d="M7 7a7 7 0 1 1-2 8M3 7h4V3"/><path d="m10 9 5 3-5 3Z"/>',
  picture: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1"/>',
  sound: '<path d="m11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
const MAX_MODEL_BYTES = 12 * 1024 * 1024;

// Generated assets are self-contained GLBs. Reject external references so a
// model can never silently start unbounded third-party texture downloads.
function validateGLB(buffer) {
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_MODEL_BYTES) throw new Error('invalid-model');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 ||
      header.getUint32(8, true) !== buffer.byteLength || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('invalid-model');
  const length = header.getUint32(12, true);
  if (20 + length > buffer.byteLength) throw new Error('invalid-model');
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  for (const entry of [...(data.buffers || []), ...(data.images || [])]) {
    if (entry.uri && !entry.uri.startsWith('data:')) throw new Error('external-model-resource');
  }
  return buffer;
}

async function readModel(response, signal) {
  if (!response.ok) throw new Error('model-unavailable');
  if (Number(response.headers.get('content-length')) > MAX_MODEL_BYTES) throw new Error('model-too-large');
  if (!response.body?.getReader) return validateGLB(await response.arrayBuffer());
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
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return validateGLB(bytes.buffer);
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

/**
 * An optional, local poetry observation activity. onComplete receives only
 * {poemId, observations, version, completedAt}; it is never an assessment score.
 */
export function mountExploration(container, {poem, speakWord, onComplete} = {}) {
  const content = EXPLORATION_CONTENT[poem?.slug];
  if (!container || !content) throw new Error('Unknown poem exploration');
  const assetBase = new URL(`./media/exploration/${poem.slug}/`, import.meta.url);
  const imageURL = new URL('scene.webp', assetBase).href;
  let dead = false, observation = 0, correct = false, completed = false, notified = false;
  let mode = 'picture', loadGeneration = 0, pending = null, viewer = null;
  let imageFailed = false;
  container.innerHTML = `<section class="explore" aria-labelledby="explore-title">
    <header class="explore-heading"><div><p class="explore-eyebrow">一首詩，兩個小發現</p><h2 id="explore-title">走進詩裏</h2></div>
      <img class="explore-motif" src="media/poetry-motifs/${content.motif}.svg" alt="" width="56" height="56"></header>
    <div class="explore-layout"><div class="explore-visual">
      <div class="explore-stage" data-explore-stage>
        <img class="explore-scene" src="${escapeHTML(imageURL)}" alt="${escapeHTML(content.alt)}" decoding="async" fetchpriority="high">
        <div class="explore-image-fallback" hidden><img src="media/poetry-motifs/${content.motif}.svg" alt="" width="90" height="90"><p>畫面暫時未能打開</p><button type="button" data-explore="retry-image">再試一次</button></div>
        <div class="explore-canvas" data-explore-canvas hidden></div>
        <button class="explore-expand" type="button" data-explore="expand" aria-expanded="false" aria-label="放大觀察">${icon('expand')}<span>放大觀察</span></button>
        <span class="explore-scene-name">${escapeHTML(content.scene)}</span>
        <span class="explore-view-label" data-explore-view-label hidden></span>
        <div class="explore-loading" role="status" hidden><span class="explore-spinner" aria-hidden="true"></span><span>正在準備，請稍等…</span></div>
      </div>
      <div class="explore-view-controls"><div class="explore-mode" role="group" aria-label="觀察方式">
        <button type="button" data-explore="picture" aria-pressed="true">${icon('picture')}看畫面</button>
        <button type="button" data-explore="model" aria-pressed="false">${icon('turn')}轉一轉</button>
      </div><p class="explore-gesture" data-explore-gesture>看看畫面，再找詩裏的小發現。</p></div>
      <div class="explore-model-tools" role="group" aria-label="轉動觀察" hidden>
        <div class="explore-presets">${(content.presets || []).map(item => `<button type="button" data-explore="preset" data-preset="${item.id}" aria-pressed="false">${item.label}</button>`).join('')}</div>
        <div class="explore-zoom"><button type="button" data-explore="zoom-in" aria-label="放大" title="放大">${icon('plus')}</button><button type="button" data-explore="zoom-out" aria-label="縮小" title="縮小">${icon('minus')}</button><button type="button" data-explore="reset" aria-label="回到原來角度" title="回到原來角度">${icon('reset')}</button></div>
      </div>
      <p class="explore-notice" role="status" hidden></p>
    </div><div class="explore-card" data-explore-card></div></div>
  </section>`;
  const q = selector => container.querySelector(selector);
  const section = q('.explore'), stage = q('[data-explore-stage]'), canvasHolder = q('[data-explore-canvas]');
  const picture = q('.explore-scene'), pictureFallback = q('.explore-image-fallback');
  const card = q('[data-explore-card]'), loading = q('.explore-loading'), notice = q('.explore-notice');
  const tools = q('.explore-model-tools'), modelButton = q('[data-explore="model"]');
  const activityEvents = new AbortController();
  container.addEventListener('error', event => {
    if (event.target.matches?.('.explore-guide img, .explore-finish-shishi')) event.target.hidden = true;
  }, {capture: true, signal: activityEvents.signal});

  function announce(message = '') {
    notice.textContent = message;
    notice.hidden = !message;
  }
  function imageError() {
    imageFailed = true;
    picture.hidden = true;
    pictureFallback.hidden = false;
    stage.classList.add('explore-image-missing');
  }
  picture.addEventListener('error', imageError, {signal: activityEvents.signal});
  picture.addEventListener('load', () => {
    imageFailed = false;
    picture.hidden = false;
    pictureFallback.hidden = true;
    stage.classList.remove('explore-image-missing');
  }, {signal: activityEvents.signal});
  if (picture.complete && !picture.naturalWidth) imageError();

  function renderCard(focus = false) {
    if (dead) return;
    q('[data-explore-view-label]').hidden = true;
    if (completed) {
      card.innerHTML = `<div class="explore-card-top"><span class="explore-step">${icon('check')}兩個發現，都找到了</span></div>
        <div class="explore-finish"><img class="explore-finish-shishi" src="media/shishi-guide.webp" alt="詩詩" width="90" height="100"><h3 tabindex="-1">把發現帶回詩裏</h3><p>${escapeHTML(content.finish)}</p></div>
        <div class="explore-finish-actions"><a class="explore-next" href="#${escapeHTML(poem.slug)}/read">回到古詩${icon('arrow')}</a><button class="explore-again" type="button" data-explore="again">再找一次</button></div>`;
    } else {
      const item = content.observations[observation];
      card.innerHTML = `<div class="explore-card-top"><span class="explore-step">小發現 ${observation + 1} / ${content.observations.length}</span><div class="explore-dots" aria-hidden="true">${content.observations.map((_, i) => `<i class="${i <= observation ? 'is-filled' : ''}"></i>`).join('')}</div></div>
        <div class="explore-title-row"><h3 tabindex="-1">${escapeHTML(item.title)}</h3><button class="explore-clue" type="button" data-explore="inspect" aria-label="請詩詩提示觀察線索">找線索${icon('turn')}</button></div>
        <div class="explore-verse"><p>${escapeHTML(item.verse)}</p><button class="explore-word" type="button" data-explore="word" aria-label="聽${escapeHTML(item.word[0])}的讀音 ${escapeHTML(item.word[1])}"><span><small>${escapeHTML(item.word[1])}</small>${escapeHTML(item.word[0])}</span>${icon('sound')}</button></div>
        <fieldset class="explore-question"><legend>${escapeHTML(item.question)}</legend><div class="explore-answers">${item.choices.map((choice, i) => `<button type="button" data-explore="answer" data-answer="${i}" aria-pressed="false"><span class="explore-answer-dot" aria-hidden="true"></span>${escapeHTML(choice)}</button>`).join('')}</div></fieldset>
        <div class="explore-guide"><img src="media/shishi-guide.webp" alt="" width="52" height="64" decoding="async"><div><span class="explore-guide-name">詩詩陪你看</span><p class="explore-feedback" aria-live="polite">${escapeHTML(item.guide)}</p></div></div>
        <button class="explore-next" type="button" data-explore="next" disabled>${observation + 1 === content.observations.length ? '收好小發現' : '下一個發現'}${icon('arrow')}</button>`;
    }
    if (focus) card.querySelector('h3')?.focus({preventScroll: true});
  }

  function selectPreset(id) {
    viewer?.preset(id);
    q('.explore-presets').querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.preset === id));
    });
    const label = q('[data-explore-view-label]');
    label.textContent = content.presets?.find(item => item.id === id)?.label || '近看細節';
    label.hidden = mode !== 'model';
  }

  function clearPreset() {
    q('.explore-presets').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
    q('[data-explore-view-label]').hidden = true;
  }

  function setExpanded(expanded) {
    section.classList.toggle('is-expanded', expanded);
    const button = q('[data-explore="expand"]');
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? '回到小發現' : '放大觀察');
    button.innerHTML = `${icon(expanded ? 'arrow' : 'expand')}<span>${expanded ? '回到小發現' : '放大觀察'}</span>`;
  }

  container.addEventListener('keydown', event => {
    if (event.key === 'Escape' && section.classList.contains('is-expanded')) {
      setExpanded(false);
      q('[data-explore="expand"]').focus({preventScroll: true});
    }
  }, {signal: activityEvents.signal});

  function stopPending() {
    loadGeneration++;
    pending?.abort();
    pending = null;
    loading.hidden = true;
    stage.removeAttribute('aria-busy');
    modelButton.removeAttribute('aria-busy');
  }
  function releaseViewer() {
    viewer?.destroy();
    viewer = null;
  }
  function showPicture() {
    stopPending();
    releaseViewer();
    mode = 'picture';
    canvasHolder.hidden = true;
    tools.hidden = true;
    section.classList.remove('is-model');
    q('[data-explore="picture"]').setAttribute('aria-pressed', 'true');
    modelButton.setAttribute('aria-pressed', 'false');
    clearPreset();
    q('[data-explore-view-label]').hidden = true;
    q('[data-explore-gesture]').textContent = '看看畫面，再找詩裏的小發現。';
  }

  async function showModel() {
    if (dead || pending || mode === 'model') return;
    announce();
    const generation = ++loadGeneration, controller = new AbortController();
    pending = controller;
    const current = () => !dead && generation === loadGeneration && !controller.signal.aborted;
    loading.hidden = false;
    stage.setAttribute('aria-busy', 'true');
    modelButton.setAttribute('aria-busy', 'true');
    const timeout = setTimeout(() => controller.abort(), 35000);
    let parsed = null;
    try {
      // Both imports and the model fetch start only after the explicit button.
      const {THREE, GLTFLoader, OrbitControls} = await import('./vendor/poetry-three.mjs?v=20260913a');
      if (!current()) return;
      const response = await fetch(new URL('model.glb', assetBase), {signal: controller.signal, credentials: 'same-origin'});
      const buffer = await readModel(response, controller.signal);
      if (!current()) return;
      parsed = await new Promise((resolve, reject) => {
        new GLTFLoader().parse(buffer, '', gltf => {
          if (!current()) {disposeObject(gltf.scene); reject(new DOMException('Aborted', 'AbortError'));}
          else resolve(gltf);
        }, reject);
      });
      if (!current()) {disposeObject(parsed.scene); parsed = null; return;}
      viewer = createViewer({THREE, OrbitControls, gltf: parsed, holder: canvasHolder, stage, content,
        onInteract: clearPreset,
        onContextLost: () => {if (!dead) {showPicture(); announce('畫面已切回插畫，繼續找詩裏的線索吧。');}}
      });
      parsed = null; // Viewer now owns all model resources.
      mode = 'model';
      section.classList.add('is-model');
      canvasHolder.hidden = false;
      pictureFallback.hidden = true;
      tools.hidden = false;
      q('[data-explore="picture"]').setAttribute('aria-pressed', 'false');
      modelButton.setAttribute('aria-pressed', 'true');
      q('[data-explore-gesture]').textContent = '拖一拖換角度，雙指縮放。';
      viewer.resize();
    } catch (error) {
      if (parsed) disposeObject(parsed.scene);
      if (dead || generation !== loadGeneration) return;
      releaseViewer();
      canvasHolder.hidden = true;
      announce(error?.message === 'webgl-unavailable'
        ? '這部裝置暫時不能轉動畫面。看圖也能完成小發現。'
        : '暫時轉不開，按「轉一轉」再試。看圖也能繼續。');
    } finally {
      clearTimeout(timeout);
      if (!dead && generation === loadGeneration) {
        pending = null;
        loading.hidden = true;
        stage.removeAttribute('aria-busy');
        modelButton.removeAttribute('aria-busy');
      }
    }
  }

  container.addEventListener('click', event => {
    const button = event.target.closest('[data-explore]');
    if (!button || !container.contains(button) || button.disabled || dead) return;
    const action = button.dataset.explore;
    if (action === 'expand') setExpanded(!section.classList.contains('is-expanded'));
    else if (action === 'picture') {showPicture(); announce(); if (imageFailed) pictureFallback.hidden = false;}
    else if (action === 'model') showModel();
    else if (action === 'retry-image') {
      pictureFallback.hidden = true;
      picture.hidden = false;
      picture.src = `${imageURL}?retry=${Date.now()}`;
    } else if (action === 'zoom-in') {clearPreset(); viewer?.zoom(.8);}
    else if (action === 'zoom-out') {clearPreset(); viewer?.zoom(1.25);}
    else if (action === 'reset') {clearPreset(); viewer?.reset();}
    else if (action === 'preset') selectPreset(button.dataset.preset);
    else if (action === 'inspect' && !completed) {
      const item = content.observations[observation];
      if (item.inspect === 'picture') showPicture();
      else if (mode === 'model') selectPreset(item.inspect);
      if (!correct) card.querySelector('.explore-feedback').textContent = item.clue;
    }
    else if (action === 'word' && !completed) {
      const [char, pinyin] = content.observations[observation].word;
      if (typeof speakWord === 'function') {
        Promise.resolve(speakWord(char, pinyin, button)).catch(() => {if (!dead) announce('這個字暫時未能播放，請再試一次。');});
      }
    } else if (action === 'answer' && !completed && !correct) {
      const item = content.observations[observation], answer = Number(button.dataset.answer);
      card.querySelectorAll('[data-explore="answer"]').forEach(option => {
        option.classList.remove('is-wrong');
        option.setAttribute('aria-pressed', 'false');
      });
      button.setAttribute('aria-pressed', 'true');
      const feedback = card.querySelector('.explore-feedback');
      if (answer === item.answer) {
        correct = true;
        button.classList.add('is-correct');
        button.querySelector('.explore-answer-dot').innerHTML = icon('check');
        card.querySelectorAll('[data-explore="answer"]').forEach(option => option.disabled = true);
        feedback.textContent = item.feedback;
        feedback.classList.add('is-correct');
        q('[data-explore="next"]').disabled = false;
      } else {
        button.classList.add('is-wrong');
        feedback.textContent = '再看看上面的詩句，換一個答案試試。';
      }
    } else if (action === 'next' && correct) {
      if (observation + 1 === content.observations.length) {
        completed = true;
        if (!notified) {
          notified = true;
          if (typeof onComplete === 'function') onComplete({poemId: poem.id, observations: content.observations.length, version: 1, completedAt: new Date().toISOString()});
        }
      } else {observation++; correct = false;}
      renderCard(true);
    } else if (action === 'again') {
      observation = 0; correct = false; completed = false;
      renderCard(true);
    }
  }, {signal: activityEvents.signal});
  renderCard();
  return {
    destroy() {
      if (dead) return;
      dead = true;
      stopPending();
      releaseViewer();
      activityEvents.abort();
      container.replaceChildren();
    }
  };
}

function createViewer({THREE, OrbitControls, gltf, holder, stage, content, onInteract, onContextLost}) {
  let renderer;
  try {renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});}
  catch {throw new Error('webgl-unavailable');}
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${content.object}，可用方向鍵轉動，加減鍵縮放，Home 鍵回到原來角度`);
  canvas.tabIndex = 0;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .02, 100);
  const model = gltf.scene, wrapper = new THREE.Group();
  const originalBounds = new THREE.Box3().setFromObject(model), size = originalBounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) {renderer.dispose(); renderer.forceContextLoss(); throw new Error('empty-model');}
  model.position.sub(originalBounds.getCenter(new THREE.Vector3()));
  wrapper.add(model);
  wrapper.scale.setScalar(2.6 / longest);
  model.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      // Keep each asset's PBR maps and material response. Anisotropy preserves
      // wood grain, feathers and soil detail when children inspect an angle.
      for (const value of Object.values(material || {})) {
        if (value?.isTexture) value.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      }
    }
  });
  scene.add(wrapper);
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0x92a59b, 1.7));
  const sunlight = new THREE.DirectionalLight(0xfff3df, 2.8);
  sunlight.position.set(-3, 8, 5);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -3;
  sunlight.shadow.camera.right = sunlight.shadow.camera.top = 3;
  sunlight.shadow.normalBias = .02;
  sunlight.shadow.bias = -.0001;
  scene.add(sunlight);
  const fill = new THREE.DirectionalLight(0xe3edf5, 1.5);
  fill.position.set(4, 3, -3);
  scene.add(fill);
  const normalizedBounds = new THREE.Box3().setFromObject(wrapper), sphere = normalizedBounds.getBoundingSphere(new THREE.Sphere());
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({opacity: .075}));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = normalizedBounds.min.y - .018;
  ground.receiveShadow = true;
  scene.add(ground);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.autoRotate = false;
  controls.rotateSpeed = .6;
  controls.zoomSpeed = .75;
  controls.minPolarAngle = .18;
  controls.maxPolarAngle = Math.PI * .52;
  controls.target.copy(sphere.center);
  let disposed = false, frame = 0, baseDistance = 6, transition = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const normalDirection = new THREE.Vector3(...(content.initialView || [3.3, 2.4, 5.8])).normalize();
  const requestRender = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(time => {
      frame = 0;
      if (disposed) return;
      if (transition) {
        const progress = Math.min(1, (time - transition.started) / 360);
        const eased = 1 - Math.pow(1 - progress, 3);
        camera.position.lerpVectors(transition.from, transition.to, eased);
        controls.update();
        if (progress === 1) transition = null;
      }
      renderer.render(scene, camera);
      if (transition) requestRender();
    });
  };
  const setView = (direction, distance, animate = true) => {
    const to = controls.target.clone().addScaledVector(direction, distance);
    if (animate && !reducedMotion) transition = {from: camera.position.clone(), to, started: performance.now()};
    else {transition = null; camera.position.copy(to); controls.update();}
    requestRender();
  };
  const reset = () => setView(normalDirection, baseDistance);
  const resize = () => {
    if (disposed) return;
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    const previousDistance = camera.position.distanceTo(controls.target);
    const ratio = previousDistance && baseDistance ? previousDistance / baseDistance : 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const limitingAngle = Math.min(halfVerticalFov, Math.atan(Math.tan(halfVerticalFov) * camera.aspect));
    baseDistance = sphere.radius / Math.sin(limitingAngle) * 1.16;
    controls.minDistance = baseDistance * .52;
    controls.maxDistance = baseDistance * 1.9;
    const direction = camera.position.clone().sub(controls.target).normalize();
    setView(direction.lengthSq() ? direction : normalDirection, baseDistance * THREE.MathUtils.clamp(ratio, .52, 1.9), false);
    renderer.setSize(width, height, false);
    requestRender();
  };
  const zoom = factor => {
    const direction = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(direction.length() * factor, controls.minDistance, controls.maxDistance);
    setView(direction.normalize(), distance);
  };
  const preset = id => {
    if (id === 'front') setView(new THREE.Vector3(0, .28, 1).normalize(), baseDistance);
    else if (id === 'side') setView(new THREE.Vector3(1, .28, 0).normalize(), baseDistance);
    else if (id === 'top') setView(new THREE.Vector3(.35, 1.25, .65).normalize(), baseDistance * .9);
    else if (id === 'detail') setView(new THREE.Vector3(.8, .12, 1).normalize(), baseDistance * .7);
    else if (id === 'far') setView(normalDirection, baseDistance * 1.55);
    else if (id === 'near') setView(normalDirection, baseDistance * .67);
  };
  function keydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'].includes(event.key)) return;
    event.preventDefault();
    onInteract?.();
    if (event.key === 'Home') reset();
    else if (event.key === '+' || event.key === '=') zoom(.85);
    else if (event.key === '-' || event.key === '_') zoom(1.18);
    else {
      const offset = camera.position.clone().sub(controls.target), polar = new THREE.Spherical().setFromVector3(offset);
      if (event.key === 'ArrowLeft') polar.theta -= .15;
      if (event.key === 'ArrowRight') polar.theta += .15;
      if (event.key === 'ArrowUp') polar.phi -= .12;
      if (event.key === 'ArrowDown') polar.phi += .12;
      polar.phi = THREE.MathUtils.clamp(polar.phi, controls.minPolarAngle, controls.maxPolarAngle);
      setView(new THREE.Vector3().setFromSpherical(polar).normalize(), polar.radius, false);
    }
  }
  canvas.addEventListener('keydown', keydown);
  const interrupt = () => {transition = null; onInteract?.();};
  const contextLost = event => {event.preventDefault(); if (!disposed) onContextLost?.();};
  canvas.addEventListener('webglcontextlost', contextLost);
  controls.addEventListener('start', interrupt);
  controls.addEventListener('change', requestRender);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  holder.replaceChildren(canvas);
  camera.position.copy(normalDirection).multiplyScalar(baseDistance);
  resize();
  setView(normalDirection, baseDistance, false);
  return {
    resize, zoom, reset, preset,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      transition = null;
      resizeObserver.disconnect();
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('webglcontextlost', contextLost);
      controls.removeEventListener('start', interrupt);
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      disposeObject(scene);
      sunlight.shadow.map?.dispose();
      renderer.renderLists?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      scene.clear();
    }
  };
}
