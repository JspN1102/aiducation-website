const ASSET_VERSION = '20260915a';
const pictureURL = new URL(`./media/shishi/guide-v2.webp?v=${ASSET_VERSION}`, import.meta.url).href;
const modelURL = new URL(`./media/shishi/guide-v2.glb?v=${ASSET_VERSION}`, import.meta.url).href;
let instanceID = 0;
const HINTS = {
  lesson: ['一起出發吧', '先聽一聽、讀一讀，再找一找、練一練。「看一看」的動畫還在準備中。'],
  record: ['一次讀好一句', '先按「聽示範」，再按「開始朗讀」讀這一句。'],
  write: ['一筆一筆來', '先看筆順，再在格子裡寫。寫錯一筆，可以撤回再試。'],
  quiz: ['先看這一題的提示', '聽清楚、看仔細，再動手試一試。不確定，可以再聽一次。'],
  report: ['挑一個地方練好', '先看看哪個字需要改進，點字聽一聽，再跟著讀一次。'],
  explore: ['找找詩中的線索', '轉動模型，看看不同角度，再說說你發現了甚麼。'],
  chat: ['把好奇說出來', '可以選一個小問題，也可以打字，問詩人你想知道的事。']
};

/** A small contextual guide. It never changes scores, starts audio or navigates. */
export function mountShishi(container, options = {}) {
  if (!container) throw new TypeError('A Shishi guide container is required');
  let settings = {view: 'lesson', ...options};
  let dead = false, open = false, paused = false, generation = 0;
  let pending = null, viewer = null, loadTimer = null, attempted = false;
  let attentionTimer = null, interacting = false;
  let drag = null, suppressClick = false, position = null, userPosition = false, placementFrame = null;
  const heldPointers = new Set();
  const events = new AbortController(), id = `shishi-guide-${++instanceID}`;
  const guide = document.createElement('aside');
  guide.className = 'shishi-guide';guide.setAttribute('aria-label', '詩詩學習向導');
  guide.innerHTML = `<section class="shishi-bubble" id="${id}" aria-labelledby="${id}-title" hidden>
    <div class="shishi-bubble-heading"><h2 id="${id}-title"></h2><button type="button" class="shishi-dismiss" aria-label="關閉提示"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
    <p class="shishi-hint-text" role="status" aria-live="polite"></p><button type="button" class="shishi-understood">明白了</button>
  </section><button type="button" class="shishi-guide-button" aria-label="問詩詩：現在怎麼做" aria-controls="${id}" aria-expanded="false">
    <span class="shishi-guide-art" aria-hidden="true"><img src="${pictureURL}" width="72" height="72" alt="" decoding="async"><span class="shishi-guide-fallback" hidden>詩</span><span class="shishi-guide-canvas"></span></span>
  </button>`;
  container.replaceChildren(guide);
  const q = selector => guide.querySelector(selector), button = q('.shishi-guide-button');
  const bubble = q('.shishi-bubble'), holder = q('.shishi-guide-canvas'), picture = q('img'), fallback = q('.shishi-guide-fallback');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function placeBubble() {
    if (!open) return;
    const r = guide.getBoundingClientRect(), b = bubble.getBoundingClientRect();
    const x = Math.max(10, Math.min(innerWidth - b.width - 10, r.left));
    const y = r.top > b.height + 20 ? r.top - b.height - 10 : Math.min(innerHeight - b.height - 10, r.bottom + 10);
    bubble.style.left = `${x}px`;bubble.style.top = `${Math.max(10,y)}px`;
  }
  function setPosition(x, y) {
    const r = button.getBoundingClientRect();
    position = {x:Math.max(8,Math.min(innerWidth-r.width-8,x)),y:Math.max(8,Math.min(innerHeight-r.height-8,y))};
    guide.style.left = `${position.x}px`;guide.style.top = `${position.y}px`;guide.style.bottom = 'auto';placeBubble();
  }
  function avoidControls() {
    placementFrame=null;
    if(dead||guide.hidden||open||drag||userPosition)return;
    const {width,height}=button.getBoundingClientRect();if(!width||!height)return;
    const adviceHeader=document.querySelector('#panel-advice:not([hidden]) .ai-report-header');
    if(innerWidth<=700&&adviceHeader){const r=adviceHeader.getBoundingClientRect();setPosition(r.left+2,r.top);return;}
    const explorationStage=document.querySelector('.view-explore .explore-stage');
    if(innerWidth<=700&&innerHeight<=650&&explorationStage){const r=explorationStage.getBoundingClientRect();setPosition(r.left+4,r.top+8);return;}
    const obstacles=[...document.querySelectorAll('#main button,#main a,#main input,#main textarea,#main canvas,.lesson-bar a,.lesson-bar summary')]
      .filter(el=>el.checkVisibility()&&!el.closest('details:not([open]) nav'))
      .map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height&&r.bottom>0&&r.top<innerHeight);
    const textAreas=[...document.querySelectorAll('#main h1,#main h2,#main h3,#main p,#main legend,#main ruby,.lesson-title')]
      .filter(el=>el.checkVisibility()).map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height);
    const overlap=(x,y,r)=>Math.max(0,Math.min(x+width+5,r.right)-Math.max(x-5,r.left))*Math.max(0,Math.min(y+height+5,r.bottom)-Math.max(y-5,r.top));
    const bottom=innerHeight-height-8,right=innerWidth-width-8;
    const candidates=[];
    for(let y=bottom;y>=80;y-=24){candidates.push({x:8,y},{x:right,y});}
    if(position)candidates.unshift(position);
    let best=null;
    for(const c of candidates){const area=obstacles.reduce((sum,r)=>sum+overlap(c.x,c.y,r),0);const textArea=textAreas.reduce((sum,r)=>sum+overlap(c.x,c.y,r),0);const score=area*100+textArea*10+(bottom-c.y)+(c.x>8?100:0);if(!best||score<best.score)best={...c,score};}
    if(best)setPosition(best.x,best.y);
  }
  function schedulePlacement(){if(placementFrame===null)placementFrame=requestAnimationFrame(avoidControls);}
  function close(restoreFocus = false) {
    open = false;bubble.hidden = true;button.setAttribute('aria-expanded', 'false');
    viewer?.settle();updateMotion();
    if (restoreFocus && !guide.hidden && !button.disabled && !dead) button.focus({preventScroll: true});
  }
  function updateMotion() {
    const hidden = guide.hidden || document.hidden;
    const running = !hidden && !button.disabled && !interacting && !drag;
    guide.dataset.motion = hidden?'hidden':reducedMotion.matches?'reduced':running?'idle':'paused';
    viewer?.updateMotion({running,hidden,quiet:open});
  }
  function refreshHint() {
    let hint;
    try {hint = typeof settings.getHint === 'function' ? settings.getHint() : null;} catch { /* Page state may change while the guide opens. */ }
    const standard = HINTS[settings.view] || HINTS.lesson;
    q('h2').textContent = String(hint?.title || standard[0]);
    q('.shishi-hint-text').textContent = String(hint?.text || standard[1]);
  }
  function updateVisibility() {
    if (dead) return;
    const active = document.activeElement;
    const editing = !!active?.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"]');
    const keyboard = !!window.visualViewport && innerHeight - window.visualViewport.height > 140;
    const modal = !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([hidden])');
    const expandedModel=!!document.querySelector('.explore.is-expanded');
    guide.hidden = settings.hidden === true || settings.view === 'library' || settings.view === 'home' || editing || keyboard || modal || expandedModel;
    button.disabled = paused || settings.disabled === true;
    if (guide.hidden || button.disabled) close();
    updateMotion();
    schedulePlacement();
    if (!guide.hidden && !button.disabled && !viewer && !pending) scheduleModel();
  }
  function stopModel() {
    generation++;clearTimeout(loadTimer);loadTimer = null;pending?.abort();pending = null;
    viewer?.destroy();viewer = null;holder.replaceChildren();guide.dataset.model = 'picture';
  }
  function scheduleModel(force = false) {
    if (loadTimer || dead || guide.hidden || paused || viewer || pending || (attempted && !force)) return;
    loadTimer = setTimeout(() => {loadTimer = null;loadModel();}, 60);
  }
  async function loadModel() {
    if (dead || guide.hidden || paused || pending || viewer) return;
    const turn = ++generation, controller = new AbortController();pending = controller;attempted = true;
    const current = () => !dead && turn === generation && !controller.signal.aborted;
    const timeout = setTimeout(() => controller.abort(), 30000);let parsed = null;
    guide.dataset.model = 'loading';
    try {
      const [{THREE,GLTFLoader},{createShishiMotion}] = await Promise.all([
        import('./vendor/poetry-three.mjs?v=20260913a'),
        import('./shishi-motion.mjs?v=20260915b')
      ]);
      if (!current()) return;
      const response = await fetch(modelURL, {signal: controller.signal, cache: 'no-cache', credentials: 'same-origin'});
      const bytes = await readModel(response, controller.signal);if (!current()) return;
      parsed = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', gltf => {
        if (!current()) {disposeObject(gltf.scene);reject(new DOMException('Aborted', 'AbortError'));}else resolve(gltf);
      }, reject));
      if (!current()) {disposeObject(parsed.scene);parsed = null;return;}
      viewer = createViewer({THREE,createShishiMotion,root:parsed.scene,holder,reducedMotion,onLost(){if(!dead)stopModel();}});
      parsed = null;guide.dataset.model = 'ready';updateMotion();
    } catch {
      if (parsed) disposeObject(parsed.scene);
      if (!dead && turn === generation) guide.dataset.model = 'picture';
    } finally {clearTimeout(timeout);if (turn === generation) pending = null;}
  }
  function checkPicture() {const missing = picture.complete && !picture.naturalWidth;picture.hidden = missing;fallback.hidden = !missing;}
  picture.addEventListener('load', checkPicture, {signal: events.signal});picture.addEventListener('error', checkPicture, {signal: events.signal});checkPicture();
  button.addEventListener('click', () => {
    if (suppressClick) {suppressClick=false;return;}
    if (dead || button.disabled || guide.hidden) return;if (open) {close();return;}
    try {if (typeof settings.onOpen === 'function' && settings.onOpen() === false) return;} catch {return;}
    clearTimeout(attentionTimer);heldPointers.clear();interacting=false;
    refreshHint();open = true;bubble.hidden = false;placeBubble();button.setAttribute('aria-expanded', 'true');updateMotion();viewer?.greet();
    if (!viewer && !pending) scheduleModel(true);
    if (button.matches(':focus-visible')) q('.shishi-dismiss').focus({preventScroll: true});
  }, {signal: events.signal});
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || button.disabled || !event.isPrimary) return;
    const r=button.getBoundingClientRect();suppressClick=false;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top,moved:false};
    button.setPointerCapture(event.pointerId);updateMotion();
  },{signal:events.signal});
  button.addEventListener('pointermove', event => {
    if (!drag || event.pointerId!==drag.id) return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if (!drag.moved && Math.hypot(dx,dy)<8) return;
    if (!drag.moved) {drag.moved=true;userPosition=true;close();guide.dataset.dragging='true';}
    setPosition(drag.left+dx,drag.top+dy);
  },{signal:events.signal});
  const endDrag=event=>{
    if(!drag || event.pointerId!==drag.id)return;
    suppressClick=drag.moved;drag=null;delete guide.dataset.dragging;updateMotion();
  };
  button.addEventListener('pointerup',endDrag,{signal:events.signal});
  button.addEventListener('pointercancel',endDrag,{signal:events.signal});
  button.addEventListener('lostpointercapture',endDrag,{signal:events.signal});
  window.addEventListener('resize',()=>{if(position)setPosition(position.x,position.y);placeBubble();schedulePlacement();},{signal:events.signal});
  q('.shishi-dismiss').addEventListener('click', () => close(true), {signal: events.signal});
  q('.shishi-understood').addEventListener('click', () => close(true), {signal: events.signal});
  document.addEventListener('keydown', event => {if (event.key === 'Escape' && open) {event.preventDefault();close(true);}}, {signal: events.signal});
  document.addEventListener('pointerdown', event => {
    if(guide.contains(event.target))return;
    if(open)close();
    if(event.target.closest?.('#main')){clearTimeout(attentionTimer);heldPointers.add(event.pointerId);interacting=true;updateMotion();}
  }, {signal: events.signal});
  const releaseAttention = event => {
    heldPointers.delete(event.pointerId);if(heldPointers.size||!interacting)return;
    clearTimeout(attentionTimer);attentionTimer=setTimeout(()=>{interacting=false;updateMotion();},1400);
  };
  document.addEventListener('pointerup',releaseAttention,{signal:events.signal});
  document.addEventListener('pointercancel',releaseAttention,{signal:events.signal});
  window.addEventListener('blur',()=>{
    // A mouse released outside the browser must not leave the guide paused forever.
    if(heldPointers.size){heldPointers.clear();clearTimeout(attentionTimer);interacting=false;updateMotion();}
  },{signal:events.signal});
  document.addEventListener('focusin', updateVisibility, {signal: events.signal});
  document.addEventListener('focusout', () => queueMicrotask(updateVisibility), {signal: events.signal});
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){clearTimeout(attentionTimer);heldPointers.clear();interacting=false;}
    else viewer?.resize();updateMotion();
  }, {signal: events.signal});
  reducedMotion.addEventListener('change',updateMotion,{signal:events.signal});
  window.visualViewport?.addEventListener('resize', updateVisibility, {signal: events.signal});
  const observer = new MutationObserver(records => {if (records.some(record => !guide.contains(record.target))) updateVisibility();});
  observer.observe(document.body, {attributes: true, attributeFilter: ['open', 'hidden', 'aria-modal'], childList: true, subtree: true});
  const layoutObserver=new ResizeObserver(schedulePlacement);layoutObserver.observe(container.ownerDocument.querySelector('#app')||document.body);
  updateVisibility();
  return {
    pause(value = true) {paused = !!value;updateVisibility();},
    update(next = {}) {
      if ((next.view && next.view !== settings.view) || (next.poem && next.poem !== settings.poem)) {clearTimeout(attentionTimer);heldPointers.clear();interacting=false;close();}
      if(next.view && next.view!==settings.view){position=null;userPosition=false;guide.style.left='';guide.style.top='';guide.style.bottom='';}
      settings = {...settings, ...next};if (open) {refreshHint();placeBubble();}updateVisibility();
    },
    destroy() {if (dead) return;dead = true;clearTimeout(attentionTimer);cancelAnimationFrame(placementFrame);events.abort();observer.disconnect();layoutObserver.disconnect();stopModel();guide.remove();}
  };
}

const MAX_MODEL_BYTES = 12 * 1024 * 1024;
async function readModel(response, signal) {
  if (!response.ok) throw new Error('model-unavailable');
  if (Number(response.headers.get('content-length')) > MAX_MODEL_BYTES) throw new Error('model-too-large');let buffer;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];let total = 0;
    try {
      for (;;) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');const {done, value} = await reader.read();if (done) break;
        total += value.byteLength;if (total > MAX_MODEL_BYTES) throw new Error('model-too-large');chunks.push(value);
      }
    } catch (error) {await reader.cancel().catch(() => {});throw error;}finally {reader.releaseLock();}
    const bytes = new Uint8Array(total);let offset = 0;for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.byteLength;}buffer = bytes.buffer;
  } else buffer = await response.arrayBuffer();
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_MODEL_BYTES) throw new Error('invalid-model');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== buffer.byteLength || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('invalid-model');
  const length = header.getUint32(12, true);if (20 + length > buffer.byteLength) throw new Error('invalid-model');
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  for (const entry of [...(data.buffers || []), ...(data.images || [])]) {if (entry.uri && !entry.uri.startsWith('data:')) throw new Error('external-model-resource');}
  return buffer;
}
function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material || materials.has(material)) continue;materials.add(material);
      for (const value of Object.values(material)) {if (!value?.isTexture) continue;textures.add(value);if (value.source?.data?.close) images.add(value.source.data);}
    }
  });
  textures.forEach(texture => texture.dispose());materials.forEach(material => material.dispose());geometries.forEach(geometry => geometry.dispose());images.forEach(bitmap => bitmap.close());
}
function createViewer({THREE,createShishiMotion,root,holder,reducedMotion,onLost}) {
  let renderer, resizeObserver, motion, dead = false;const listeners = new AbortController();
  try {
    renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));renderer.setClearColor(0x000000, 0);renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;renderer.toneMappingExposure = 1.08;
    const scene = new THREE.Scene();scene.add(new THREE.HemisphereLight(0xfffcf1, 0x78978b, 2.6));
    const key = new THREE.DirectionalLight(0xfffbf0, 3.1);key.position.set(-3, 5, 5);scene.add(key);
    const fill = new THREE.DirectionalLight(0xe0eef8, 1.6);fill.position.set(4, 2, -3);scene.add(fill);
    root.updateMatrixWorld(true);const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);if (!Number.isFinite(longest) || longest <= 0) throw new Error('empty-model');
    const centre = box.getCenter(new THREE.Vector3()), scale = 2 / longest;
    const model = new THREE.Group();model.add(root);model.scale.setScalar(scale);model.position.copy(centre).multiplyScalar(-scale);
    const pivot = new THREE.Group();pivot.add(model);scene.add(pivot);
    const camera = new THREE.PerspectiveCamera(32, 1, .01, 30);camera.position.set(0, .04, 4.0);camera.lookAt(0, 0, 0);
    const canvas = renderer.domElement;canvas.setAttribute('aria-hidden', 'true');let renders = 0;
    const render = () => {if (!dead && !document.hidden) {renderer.render(scene, camera);canvas.dataset.renders = String(++renders);}};
    const resize = () => {
      if (dead) return;const bounds = holder.getBoundingClientRect();if (!bounds.width || !bounds.height) return;
      renderer.setSize(bounds.width, bounds.height, false);camera.aspect = bounds.width / bounds.height;camera.updateProjectionMatrix();render();
    };
    motion=createShishiMotion({THREE,root,pivot,canvas,render,reducedMotion});
    canvas.addEventListener('webglcontextlost', event => {event.preventDefault();if (!dead) onLost();}, {signal: listeners.signal});
    holder.append(canvas);resizeObserver = new ResizeObserver(resize);resizeObserver.observe(holder);resize();
    return {greet:motion.greet,settle:motion.settle,updateMotion:motion.update,resize,destroy() {if (dead) return;dead = true;motion.destroy();listeners.abort();resizeObserver.disconnect();disposeObject(root);renderer.dispose();renderer.forceContextLoss();canvas.remove();}};
  } catch (error) {dead = true;motion?.destroy();listeners.abort();resizeObserver?.disconnect();renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();throw error;}
}
