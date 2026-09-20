import {readModel} from './exploration.mjs?v=20260921-school6';
import {modelPixelRatio} from './model-quality.mjs?v=20260921-ar1';

// Source meshes own GPU resources; plant clones only borrow them. Rendering is
// scheduled by interaction, resize or a density change, never by an idle loop.
export function mountLivingField(holder, {density = {}, onStatus = () => {}} = {}) {
  if (!holder?.ownerDocument) throw new TypeError('A field holder is required.');
  const doc = holder.ownerDocument, view = doc.defaultView;
  const network = new view.AbortController(), events = new view.AbortController();
  const geometries = new Set(), materials = new Set(), textures = new Set(), bitmaps = new Set(), skeletons = new Set();
  const disposed = new WeakSet(), closed = new WeakSet();
  let dead = false, failed = false, renderer = null, controls = null, scene = null;
  let camera = null, plants = null, models = [], frame = 0, observer = null, canvas = null, timer = 0;
  let current = normalize(density);
  const alive = () => !dead && !failed && !network.signal.aborted;
  const asset = name => new URL(`./media/${name}`, import.meta.url).href;
  function normalize(value) {
    const chosen = key => ['dense', 'sparse'].includes(value?.[key]) ? value[key] : null;
    return {grass: chosen('grass'), beans: chosen('beans')};
  }
  function status(message, state) {
    if (!dead && typeof onStatus === 'function') onStatus(message, {state});
  }
  function ownTexture(texture) {
    if (!texture?.isTexture) return;
    textures.add(texture);
    const images = texture.source?.data ?? texture.image;
    for (const image of Array.isArray(images) ? images : [images]) if (typeof image?.close === 'function') bitmaps.add(image);
  }
  function ownMaterial(material) {
    if (!material) return;
    materials.add(material);
    Object.values(material).forEach(ownTexture);
    for (const uniform of Object.values(material.uniforms || {})) {
      const values = Array.isArray(uniform?.value) ? uniform.value : [uniform?.value];
      values.forEach(ownTexture);
    }
  }
  function ownObject(root) {
    root?.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(ownMaterial);
      if (node.skeleton) {skeletons.add(node.skeleton);ownTexture(node.skeleton.boneTexture);}
    });
  }
  function disposeResources() {
    // Skeleton.dispose also disposes its bone texture, so detach that texture
    // and let the shared texture ownership set release it exactly once.
    for (const skeleton of skeletons) {
      if (!disposed.has(skeleton)) {disposed.add(skeleton);skeleton.boneTexture = null;skeleton.dispose?.();}
    }
    for (const resources of [textures, materials, geometries]) {
      for (const resource of resources) if (!disposed.has(resource)) {disposed.add(resource);resource.dispose?.();}
      resources.clear();
    }
    skeletons.clear();
    for (const bitmap of bitmaps) if (!closed.has(bitmap)) {closed.add(bitmap);bitmap.close();}
    bitmaps.clear();
  }
  function release() {
    view.clearTimeout(timer);timer = 0;
    if (frame) view.cancelAnimationFrame(frame);frame = 0;
    observer?.disconnect();observer = null;
    events.abort();
    controls?.removeEventListener('change', render);controls?.dispose();controls = null;
    plants?.clear();plants = null;scene?.clear();scene = null;models = [];camera = null;
    disposeResources();
    if (renderer) {renderer.dispose();renderer.forceContextLoss();renderer = null;}
    canvas?.remove();canvas = null;
  }
  function fail(state = 'error') {
    if (dead || failed) return;
    failed = true;network.abort();release();
    status(state === 'context-lost' ? '立體畫面暫時中斷，可以切回插畫。' : '暫時轉不開，切回插畫也能種。', state);
  }
  function render() {
    if (!alive() || frame || !renderer || !camera || doc.hidden) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (!alive() || !renderer || !scene || !camera || doc.hidden) return;
      try {renderer.render(scene, camera);} catch {fail();}
    });
  }
  function populate() {
    if (!alive() || !plants || models.length !== 2) return;
    plants.clear();
    const counts = [current.grass === 'dense' ? 52 : current.grass === 'sparse' ? 7 : 0,
      current.beans === 'dense' ? 14 : current.beans === 'sparse' ? 3 : 0];
    counts.forEach((count, kind) => {
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399963 + (kind ? 1.2 : 0), radius = Math.sqrt((i + .4) / (count + .8)) * 1.9;
        const plant = models[kind].clone(true);
        plant.position.set(Math.cos(angle) * radius, .09, Math.sin(angle) * radius * .76);
        plant.rotation.y = i * 1.9;plant.scale.multiplyScalar(.82 + (i % 5) * .07);plants.add(plant);
      }
    });
    render();
  }
  async function loadPlant(THREE, GLTFLoader, name, kind) {
    try {
      const response = await fetch(asset(`living-scenes/${name}-v1.glb`), {signal: network.signal, cache: 'no-cache'});
      const bytes = await readModel(response, network.signal);
      if (!alive()) return null;
      const parsed = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', resolve, reject));
      // A parse cannot be aborted. Its success callback still has an owner,
      // including when its sibling failed or the child left the page earlier.
      for (const source of new Set([parsed.scene, ...(parsed.scenes || [])])) ownObject(source);
      if (!alive()) {disposeResources();return null;}
      const model = parsed.scene, box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      if (box.isEmpty() || !Number.isFinite(extent) || extent <= 0) throw new Error('empty-plant');
      const group = new THREE.Group();
      model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));group.add(model);
      group.scale.setScalar((kind === 0 ? .56 : .66) / extent);
      return group;
    } catch (error) {fail();throw error;}
  }
  async function loadSoil(THREE) {
    try {
      const response = await fetch(asset('challenges/field-soil-v1.webp'), {signal: network.signal, cache: 'no-cache'});
      if (!response.ok) throw new Error('soil-unavailable');
      const blob = await response.blob();
      if (!alive()) return null;
      let image, bitmap = false;
      if (typeof view.createImageBitmap === 'function') {
        image = await view.createImageBitmap(blob, {imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
        bitmap = true;bitmaps.add(image);
      } else {
        // Old browsers still release the temporary object URL on load, error,
        // or route cancellation. No renderer exists while image decoding waits.
        image = await new Promise((resolve, reject) => {
          const img = new view.Image(), url = view.URL.createObjectURL(blob);
          const finish = error => {
            img.onload = img.onerror = null;network.signal.removeEventListener('abort', abort);view.URL.revokeObjectURL(url);
            if (error) {img.src = '';reject(error);} else resolve(img);
          };
          const abort = () => finish(new view.DOMException('Aborted', 'AbortError'));
          img.onload = () => finish();img.onerror = () => finish(new Error('soil-decode'));
          network.signal.addEventListener('abort', abort, {once: true});img.src = url;
          if (network.signal.aborted) abort();
        });
      }
      if (!alive()) {disposeResources();return null;}
      const map = new THREE.Texture(image);map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = !bitmap;map.needsUpdate = true;ownTexture(map);return map;
    } catch (error) {fail();throw error;}
  }
  async function load() {
    status('正在準備立體植物…', 'loading');
    if (!alive()) return;
    timer = view.setTimeout(() => fail('timeout'), 35000);
    try {
      const {THREE, GLTFLoader, OrbitControls} = await import('./vendor/poetry-three.mjs?v=20260913a');
      if (!alive()) return;
      const outcomes = await Promise.allSettled([
        loadPlant(THREE, GLTFLoader, 'grass', 0), loadPlant(THREE, GLTFLoader, 'bean', 1), loadSoil(THREE)
      ]);
      if (!alive()) {disposeResources();return;}
      if (outcomes.some(result => result.status !== 'fulfilled' || !result.value)) throw new Error('incomplete-field');
      models = outcomes.slice(0, 2).map(result => result.value);
      const map = outcomes[2].value;
      // Allocate the context only when both models and the soil are ready.
      renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
      canvas = renderer.domElement;renderer.setClearColor(0, 0);
      for (const texture of textures) texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      renderer.outputColorSpace = THREE.SRGBColorSpace;renderer.toneMapping = THREE.ACESFilmicToneMapping;renderer.toneMappingExposure = 1.1;
      scene = new THREE.Scene();scene.add(new THREE.HemisphereLight(0xfffcf0, 0x8b9b79, 2));
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);sun.position.set(-3, 6, 5);scene.add(sun);
      const fill = new THREE.DirectionalLight(0xd5e8f0, 1);fill.position.set(3, 2, -2);scene.add(fill);
      const geometry = new THREE.CylinderGeometry(2.23, 2.16, .19, 64);geometries.add(geometry);
      const material = new THREE.MeshStandardMaterial({map, roughness: 1, color: 0xe0ccab});ownMaterial(material);
      const earth = new THREE.Mesh(geometry, material);earth.scale.z = .8;earth.position.y = -.035;scene.add(earth);
      plants = new THREE.Group();scene.add(plants);
      camera = new THREE.PerspectiveCamera(37, 1, .1, 50);camera.position.set(0, 4.7, 5.7);camera.lookAt(0, .2, 0);
      controls = new OrbitControls(camera, canvas);controls.target.set(0, .15, 0);controls.enableDamping = false;controls.enablePan = false;
      controls.minDistance = 4.5;controls.maxDistance = 9;controls.minPolarAngle = .18;controls.maxPolarAngle = Math.PI * .44;
      controls.update();controls.addEventListener('change', render);
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
      canvas.setAttribute('role', 'img');canvas.setAttribute('aria-label', '你種的立體詩田。拖動或按方向鍵轉動，雙指縮放，Home 鍵回到原來角度。');canvas.tabIndex = 0;
      canvas.addEventListener('keydown', event => {
        if (!alive() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') {controls.target.set(0, .15, 0);camera.position.set(0, 4.7, 5.7);}
        else {
          const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
          spherical.theta += event.key === 'ArrowLeft' ? -.15 : event.key === 'ArrowRight' ? .15 : 0;
          spherical.phi = THREE.MathUtils.clamp(spherical.phi + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0), .18, Math.PI * .44);
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        }
        controls.update();render();
      }, {signal: events.signal});
      canvas.addEventListener('webglcontextlost', event => {event.preventDefault();fail('context-lost');}, {signal: events.signal});
      holder.replaceChildren(canvas);
      const resize = () => {
        if (!alive() || !renderer) return;
        const {width, height} = holder.getBoundingClientRect();if (!width || !height) return;
        camera.aspect = width / height;camera.updateProjectionMatrix();renderer.setPixelRatio(modelPixelRatio(width, height, view.devicePixelRatio));renderer.setSize(width, height, false);render();
      };
      if (view.ResizeObserver) {observer = new view.ResizeObserver(resize);observer.observe(holder);}
      else view.addEventListener('resize', resize, {signal: events.signal});
      doc.addEventListener('visibilitychange', render, {signal: events.signal});
      resize();populate();status('拖一拖，換個角度看看。', 'ready');
    } catch {fail();}
    finally {view.clearTimeout(timer);timer = 0;}
  }
  void load();
  return {
    setDensity(value) {
      if (!alive()) return;
      const next = normalize(value);
      if (next.grass === current.grass && next.beans === current.beans) return;
      current = next;populate();
    },
    destroy() {if (dead) return;dead = true;network.abort();release();}
  };
}
