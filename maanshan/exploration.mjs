import {EXPLORATION_CONTENT} from './exploration-data.mjs?v=20260920a';
import {createProcessResearch} from './poem-games/research.mjs?v=20260920a';
import {modelPixelRatio} from './model-quality.mjs?v=20260921-ar1';
import {fetchModel, loadBudget, MODEL_LOAD_TIMEOUT_MS} from './model-source.mjs?v=20260922-school22';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ICONS = {
  ar: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
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

export function disposeObject(root) {
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
export function mountExploration(container, {poem, speakWord, onComplete, onResearch, modelTimeoutMs = MODEL_LOAD_TIMEOUT_MS} = {}) {
  const content = EXPLORATION_CONTENT[poem?.slug];
  if (!container || !content) throw new Error('Unknown poem exploration');
  if (Number(poem.grade) <= 3) {
    container.innerHTML = '<p class="explore-unavailable" role="status">這個年級不設 AR 體驗，請返回學習路線。</p>';
    return {destroy(){container.replaceChildren();}};
  }
  const assetBase = new URL(`./media/exploration/${poem.slug}/`, import.meta.url);
  const assetURL = name => {
    const url = new URL(name, assetBase);
    if (content.assetVersion) url.searchParams.set('v', content.assetVersion);
    return url;
  };
  const imageURL = assetURL('scene.webp').href;
  let dead = false, observation = 0, correct = false, completed = false, notified = false;
  let mode = 'picture', loadGeneration = 0, pending = null, viewer = null;
  let imageFailed = false, imagePending = true;
  const research=createProcessResearch(onResearch,{prefix:`p${poem.id}.explore`,activity:'explore',context:{mode:'free'},alive:()=>!dead});
  const researchStep=()=>`observation.${observation}`;
  container.innerHTML = `<section class="explore" aria-labelledby="explore-title">
    <header class="explore-heading"><div><p class="explore-eyebrow">一首詩，兩個小發現</p><h2 id="explore-title">AR體驗</h2></div>
      <img class="explore-motif" src="media/poetry-motifs/${content.motif}.svg" alt="" width="56" height="56"></header>
    <div class="explore-layout"><div class="explore-visual">
      <div class="explore-stage" data-explore-stage>
        <img class="explore-scene" src="${escapeHTML(imageURL)}" alt="${escapeHTML(content.alt)}" decoding="async" fetchpriority="high">
        <div class="explore-image-loading" role="status"><img src="media/poetry-motifs/${content.motif}.svg" alt="" width="80" height="80"><p>正在準備畫面…</p></div>
        <div class="explore-image-fallback" hidden><img src="media/poetry-motifs/${content.motif}.svg" alt="" width="90" height="90"><p>畫面暫時未能打開</p><button type="button" data-explore="retry-image">再試一次</button></div>
        <div class="explore-canvas" data-explore-canvas hidden></div>
        <button class="explore-expand" type="button" data-explore="expand" aria-expanded="false" aria-label="放大觀察">${icon('expand')}<span>放大觀察</span></button>
        <span class="explore-scene-name">${escapeHTML(content.scene)}</span>
        <span class="explore-view-label" data-explore-view-label hidden></span>
        <div class="explore-loading" role="status" hidden><span class="explore-spinner" aria-hidden="true"></span><span>正在準備，請稍等…</span></div>
      </div>
      <div class="explore-view-controls"><button class="explore-ar-entry" type="button" data-explore="ar">${icon('ar')}<span>點擊體驗 AR</span></button></div>
      <div class="explore-model-tools" role="group" aria-label="轉動觀察" hidden>
        <p class="explore-model-hint">拖動轉一轉，雙指放大縮小。</p>
        <div class="explore-zoom"><button type="button" data-explore="zoom-in" aria-label="放大" title="放大">${icon('plus')}</button><button type="button" data-explore="zoom-out" aria-label="縮小" title="縮小">${icon('minus')}</button><button type="button" data-explore="reset" aria-label="回到原來角度" title="回到原來角度">${icon('reset')}</button></div>
      </div>
      <p class="explore-notice" role="status" hidden></p>
    </div><div class="explore-card" data-explore-card></div></div>
  </section>`;
  const q = selector => container.querySelector(selector);
  const section = q('.explore'), stage = q('[data-explore-stage]'), canvasHolder = q('[data-explore-canvas]');
  const picture = q('.explore-scene'), pictureFallback = q('.explore-image-fallback'), pictureLoading = q('.explore-image-loading');
  const card = q('[data-explore-card]'), loading = q('.explore-loading'), notice = q('.explore-notice');
  const tools = q('.explore-model-tools'), modelButton = q('[data-explore="ar"]'), modelEntry = q('.explore-view-controls');
  const activityEvents = new AbortController();
  container.addEventListener('error', event => {
    if (event.target.matches?.('.explore-guide img, .explore-finish-shishi')) event.target.hidden = true;
  }, {capture: true, signal: activityEvents.signal});

  function announce(message = '') {
    notice.textContent = message;
    notice.hidden = !message;
  }
  function syncPicture() {
    picture.hidden = imagePending || imageFailed;
    pictureLoading.hidden = !imagePending || mode !== 'picture';
    pictureFallback.hidden = !imageFailed || mode !== 'picture';
    stage.classList.toggle('explore-image-missing', imageFailed);
  }
  function imageError() {
    if(!imageFailed)research.error('image');
    imagePending = false;
    imageFailed = true;
    syncPicture();
  }
  function imageLoaded() {
    imagePending = false;
    imageFailed = false;
    syncPicture();
  }
  picture.addEventListener('error', imageError, {signal: activityEvents.signal});
  picture.addEventListener('load', imageLoaded, {signal: activityEvents.signal});
  if (picture.complete) picture.naturalWidth ? imageLoaded() : imageError();
  else syncPicture();

  function renderCard(focus = false) {
    if (dead) return;
    card.removeAttribute('data-feedback');
    q('[data-explore-view-label]').hidden = true;
    if (completed) {
      card.innerHTML = `<div class="explore-card-top"><span class="explore-step">${icon('check')}兩個發現，都找到了</span></div>
        <div class="explore-finish"><div class="explore-finish-mark" aria-hidden="true">${icon('check')}</div><h3 tabindex="-1">小發現，收好啦！</h3><p>${escapeHTML(content.finish)}</p></div>
        <div class="explore-finish-actions"><button class="explore-again" type="button" data-explore="again">再玩一次</button><a class="explore-next" href="#${escapeHTML(poem.slug)}/quiz">進入練一練${icon('arrow')}</a></div>`;
    } else {
      const item = content.observations[observation];
      research.present(researchStep(),{position:observation,total:content.observations.length,optionOrder:item.choices.map((_,i)=>`choice.${i}`)});
      card.innerHTML = `<div class="explore-card-top"><span class="explore-step">小發現 ${observation + 1} / ${content.observations.length}</span><div class="explore-dots" aria-hidden="true">${content.observations.map((_, i) => `<i class="${i <= observation ? 'is-filled' : ''}"></i>`).join('')}</div></div>
        <div class="explore-verse"><p>${escapeHTML(item.verse)}</p><button class="explore-word" type="button" data-explore="word" aria-label="聽${escapeHTML(item.word[0])}的讀音 ${escapeHTML(item.word[1])}"><span><small>${escapeHTML(item.word[1])}</small>${escapeHTML(item.word[0])}</span>${icon('sound')}</button></div>
        <fieldset class="explore-question"><legend tabindex="-1">${escapeHTML(item.question)}</legend><div class="explore-answers">${item.choices.map((choice, i) => `<button type="button" data-explore="answer" data-answer="${i}" aria-pressed="false"><span class="explore-answer-dot" aria-hidden="true"></span>${escapeHTML(choice)}</button>`).join('')}</div></fieldset>
        <p class="explore-feedback" aria-live="polite"></p>
        <button class="explore-next" type="button" data-explore="next" disabled>${observation + 1 === content.observations.length ? '收好小發現' : '下一個發現'}${icon('arrow')}</button>`;
    }
    if (focus) card.querySelector('legend, h3')?.focus({preventScroll: true});
  }

  function clearPreset() {
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
    modelEntry.hidden = false;
    section.classList.remove('is-model');
    syncPicture();
    clearPreset();
    q('[data-explore-view-label]').hidden = true;
  }

  async function showModel() {
    if (dead || pending) return null;
    if (viewer) return viewer;
    const generation = ++loadGeneration, controller = new AbortController();
    pending = controller;
    const current = () => !dead && generation === loadGeneration && !controller.signal.aborted;
    loading.hidden = false;
    stage.setAttribute('aria-busy', 'true');
    modelButton.setAttribute('aria-busy', 'true');
    // The deadline restarts on every sign of progress; only silence expires it.
    const budget = loadBudget(() => controller.abort(), {timeoutMs: modelTimeoutMs});
    let parsed = null;
    try {
      // Both imports and the model fetch start only after the explicit button.
      const {THREE, GLTFLoader, OrbitControls} = await import('./vendor/poetry-three.mjs?v=20260913a');
      // A timed-out load must still reach the catch below so the child is told
      // and offered a retry, instead of the spinner silently disappearing.
      if (!current()) throw new DOMException('Aborted', 'AbortError');
      budget.touch();
      // Deployed copy and public COS copy race; see model-source.mjs.
      const buffer = await fetchModel(assetURL(content.modelFile || 'model.glb'), {signal: controller.signal, onProgress: budget.touch});
      if (!current()) throw new DOMException('Aborted', 'AbortError');
      parsed = await new Promise((resolve, reject) => {
        new GLTFLoader().parse(buffer, '', gltf => {
          if (!current()) {disposeObject(gltf.scene); reject(new DOMException('Aborted', 'AbortError'));}
          else resolve(gltf);
        }, reject);
      });
      if (!current()) {disposeObject(parsed.scene); parsed = null; throw new DOMException('Aborted', 'AbortError');}
      viewer = createViewer({THREE, OrbitControls, gltf: parsed, holder: canvasHolder, stage, content,
        onInteract: clearPreset,
        onInteractionEnd: kind => research.action(researchStep(),kind,kind),
        onContextLost: () => {if (!dead) {research.error('model','unsupported');showPicture(); announce('畫面已切回插畫，繼續找詩裏的線索吧。');}}
      });
      parsed = null; // Viewer now owns all model resources.
      mode = 'model';
      syncPicture();
      section.classList.add('is-model');
      canvasHolder.hidden = false;
      pictureFallback.hidden = true;
      tools.hidden = false;
      modelEntry.hidden = true;
      viewer.resize();
      return viewer;
    } catch (error) {
      if (parsed) disposeObject(parsed.scene);
      if (dead || generation !== loadGeneration) return;
      research.error('model',controller.signal.aborted?'timeout':error?.message==='webgl-unavailable'?'unsupported':'network');
      releaseViewer();
      canvasHolder.hidden = true;
      announce(error?.message === 'webgl-unavailable'
        ? '這部裝置暫時不能轉動畫面。看圖也能完成小發現。'
        : '模型暫時未能打開，再按「點擊體驗 AR」試試。看圖也能繼續。');
    } finally {
      budget.clear();
      if (!dead && generation === loadGeneration) {
        pending = null;
        loading.hidden = true;
        stage.removeAttribute('aria-busy');
        modelButton.removeAttribute('aria-busy');
      }
    }
  }

  async function startExperience() {
    if (dead || pending || viewer) return;
    research.action('experience','start');
    modelButton.disabled = true;
    announce();
    try {await showModel();}
    finally {if (!dead) modelButton.disabled = false;}
  }

  container.addEventListener('click', event => {
    const button = event.target.closest('[data-explore]');
    if (!button || !container.contains(button) || button.disabled || dead) return;
    const action = button.dataset.explore;
    if (action === 'ar') startExperience();
    else if (action === 'expand') {research.action(researchStep(),section.classList.contains('is-expanded')?'collapse':'expand');setExpanded(!section.classList.contains('is-expanded'));}
    else if (action === 'retry-image') {
      research.retry('image');
      imagePending = true;
      imageFailed = false;
      syncPicture();
      const retryURL = new URL(imageURL);
      retryURL.searchParams.set('retry', Date.now());
      picture.src = retryURL.href;
    } else if (action === 'zoom-in') {clearPreset();if(viewer){viewer.zoom(.8);research.action(researchStep(),'in','camera_zoom');}}
    else if (action === 'zoom-out') {clearPreset();if(viewer){viewer.zoom(1.25);research.action(researchStep(),'out','camera_zoom');}}
    else if (action === 'reset') {clearPreset();if(viewer){viewer.reset();research.action(researchStep(),'reset','camera_reset');}}
    else if (action === 'word' && !completed) {
      const [char, pinyin] = content.observations[observation].word;
      if (typeof speakWord === 'function') {
        const step=researchStep();research.hint(step,'audio');
        Promise.resolve().then(()=>speakWord(char, pinyin, button)).then(ok=>{if(ok===false)research.error(step,'audio_unavailable');}).catch(() => {research.error(step,'audio_unavailable');if (!dead) announce('這個字暫時未能播放，請再試一次。');});
      }
    } else if (action === 'answer' && !completed && !correct) {
      card.dataset.feedback='answer';
      const item = content.observations[observation], answer = Number(button.dataset.answer);
      research.answer(researchStep(),`choice.${answer}`,answer===item.answer);
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
        research.hint(researchStep());
        button.classList.add('is-wrong');
        feedback.textContent = item.clue;
      }
    } else if (action === 'next' && correct) {
      if (observation + 1 === content.observations.length) {
        completed = true;
        research.complete();
        if (!notified) {
          notified = true;
          if (typeof onComplete === 'function') onComplete({poemId: poem.id, observations: content.observations.length, version: 1, completedAt: new Date().toISOString()});
        }
      } else {observation++; correct = false;}
      renderCard(true);
    } else if (action === 'again') {
      research.reset();
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

export function createViewer({THREE, OrbitControls, gltf, holder, stage, content, onInteract, onInteractionEnd, onContextLost}) {
  let renderer;
  const lightRendering = matchMedia('(pointer: coarse), (max-width: 1100px)').matches;
  try {renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});}
  catch {throw new Error('webgl-unavailable');}
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${content.object}，可用方向鍵轉動，加減鍵縮放，Home 鍵回到原來角度`);
  canvas.tabIndex = 0;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !lightRendering;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
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
        if (value?.isTexture) value.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
    }
  });
  scene.add(wrapper);
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0x92a59b, 1.7));
  const sunlight = new THREE.DirectionalLight(0xfff3df, 2.8);
  sunlight.position.set(-3, 8, 5);
  sunlight.castShadow = !lightRendering;
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
  let visible = true;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const normalDirection = new THREE.Vector3(...(content.initialView || [3.3, 2.4, 5.8])).normalize();
  const requestRender = () => {
    if (disposed || frame || document.hidden || !visible) return;
    frame = requestAnimationFrame(time => {
      frame = 0;
      if (disposed || document.hidden || !visible) return;
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
    baseDistance = sphere.radius / Math.sin(limitingAngle) * 1.16 * (content.viewDistance || 1);
    controls.minDistance = baseDistance * .52;
    controls.maxDistance = baseDistance * 1.9;
    const direction = camera.position.clone().sub(controls.target).normalize();
    setView(direction.lengthSq() ? direction : normalDirection, baseDistance * THREE.MathUtils.clamp(ratio, .52, 1.9), false);
    renderer.setPixelRatio(modelPixelRatio(width, height));
    renderer.setSize(width, height, false);
    requestRender();
  };
  const zoom = factor => {
    const direction = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(direction.length() * factor, controls.minDistance, controls.maxDistance);
    setView(direction.normalize(), distance);
  };
  const preset = id => {
    if (content.presetViews?.[id]) {
      const view = content.presetViews[id];
      setView(new THREE.Vector3(...view.direction).normalize(), baseDistance * view.distance);
    }
    else if (id === 'front') setView(new THREE.Vector3(0, .28, 1).normalize(), baseDistance);
    else if (id === 'side') setView(new THREE.Vector3(1, .28, 0).normalize(), baseDistance);
    else if (id === 'top') setView(new THREE.Vector3(.35, 1.25, .65).normalize(), baseDistance * .9);
    else if (id === 'detail') setView(new THREE.Vector3(.8, .12, 1).normalize(), baseDistance * .7);
    else if (id === 'far') setView(normalDirection, baseDistance * 1.55);
    else if (id === 'near') setView(normalDirection, baseDistance * .67);
  };
  function keydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'].includes(event.key)) return;
    event.preventDefault();
    keyboardInteractions.add(event.key==='Home'?'camera_reset':['+','=','-','_'].includes(event.key)?'camera_zoom':'camera_rotate');
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
  const keyboardInteractions=new Set();
  const finishKeyboard=()=>{if(!disposed)keyboardInteractions.forEach(kind=>onInteractionEnd?.(kind));keyboardInteractions.clear();};
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('keyup', finishKeyboard);
  canvas.addEventListener('blur', finishKeyboard);
  let interactionStart=null;
  // OrbitControls can emit another start when a second finger joins or leaves.
  // Keep the first position until the full gesture ends, including a pinch.
  const interrupt = () => {transition = null;if(!interactionStart)interactionStart=camera.position.clone().sub(controls.target); onInteract?.();};
  const finishInteraction=()=>{
    if(disposed||!interactionStart)return;
    const before=interactionStart;interactionStart=null;
    const after=camera.position.clone().sub(controls.target);
    if(Math.abs(before.length()-after.length())>.0001)onInteractionEnd?.('camera_zoom');
    if(before.normalize().distanceToSquared(after.normalize())>.000001)onInteractionEnd?.('camera_rotate');
  };
  const contextLost = event => {event.preventDefault(); if (!disposed) onContextLost?.();};
  canvas.addEventListener('webglcontextlost', contextLost);
  controls.addEventListener('start', interrupt);
  controls.addEventListener('change', requestRender);
  controls.addEventListener('end', finishInteraction);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const visibilityObserver = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) {resize(); requestRender();}
  });
  visibilityObserver.observe(stage);
  const resume = () => {if (!document.hidden && visible) requestRender();};
  document.addEventListener('visibilitychange', resume);
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
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', resume);
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('keyup', finishKeyboard);
      canvas.removeEventListener('blur', finishKeyboard);
      canvas.removeEventListener('webglcontextlost', contextLost);
      controls.removeEventListener('start', interrupt);
      controls.removeEventListener('change', requestRender);
      controls.removeEventListener('end', finishInteraction);
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
