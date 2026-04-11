// ====== 3D 中秋文化馆 — Immersive Mid-Autumn Cultural Hall ======
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ==================== STATE ====================
let scene, camera, renderer, css2dRenderer, composer, bloomPass, controls;
let animFrameId = null, mid3dInited = false, elapsed = 0;
let currentSceneName = 'hall';
const signObjects = [];
const animCallbacks = []; // per-frame callbacks for current scene

// ==================== SCENE TRANSITION ====================
function fadeIn() {
  const el = document.getElementById('scene-transition');
  el.classList.add('active');
  return new Promise(r => setTimeout(r, 500));
}
function fadeOut() {
  const el = document.getElementById('scene-transition');
  el.classList.remove('active');
  return new Promise(r => setTimeout(r, 500));
}
function setTransitionText(t) {
  document.getElementById('scene-transition-text').textContent = t;
}

// ==================== DISPOSE HELPERS ====================
function disposeObject(obj) {
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    if (Array.isArray(obj.material)) obj.material.forEach(m => disposeMat(m));
    else disposeMat(obj.material);
  }
}
function disposeMat(m) {
  if (m.map) m.map.dispose();
  if (m.emissiveMap) m.emissiveMap.dispose();
  m.dispose();
}
function clearScene() {
  animCallbacks.length = 0;
  signObjects.length = 0;
  if (!scene) return;
  while (scene.children.length > 0) {
    const c = scene.children[0];
    scene.remove(c);
    c.traverse(disposeObject);
  }
}

// Helper: create object and set position/rotation
function place(obj, x, y, z, rx, ry, rz) {
  if (x !== undefined) obj.position.set(x, y || 0, z || 0);
  if (rx !== undefined) obj.rotation.set(rx, ry || 0, rz || 0);
  return obj;
}

// ==================== POPUP ====================
window.openMid3dPopup = function(title, pinyin, poem, explains) {
  document.getElementById('mid3d-title').textContent = title;
  document.getElementById('mid3d-pinyin').textContent = pinyin;
  document.getElementById('mid3d-poem').innerHTML = poem;
  document.getElementById('mid3d-explain').innerHTML = explains
    .map(e => '<div class="mid3d-explain-card"><b>' + e.w + '</b>' + e.m + '</div>').join('');
  document.getElementById('mid3d-overlay').classList.add('show');
};
window.closeMid3dPopup = function(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('mid3d-overlay').classList.remove('show');
};

// ==================== PROCEDURAL HELPERS ====================
function makeLantern(color, r, h, intensity) {
  const g = new THREE.Group();
  // body — glowing cylinder
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.85, h, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  g.add(body);
  // top/bottom caps
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.5, r * 0.5, h * 0.08, 12),
    new THREE.MeshStandardMaterial({ color: 0x8b6914, metalness: 0.6, roughness: 0.4 })
  );
  cap.position.y = h / 2;
  g.add(cap);
  const cap2 = cap.clone(); cap2.position.y = -h / 2; g.add(cap2);
  // inner light
  const pl = new THREE.PointLight(color, intensity || 0.5, r * 8);
  g.add(pl);
  return g;
}

function makeCanvasTexture(text, w, h, font, color, bg) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg || 'transparent';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color || '#f5e6c8';
  ctx.font = font || '32px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  const lh = parseInt(font) * 1.4 || 44;
  const startY = h / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * lh));
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeSilhouette(shape, height, color) {
  // Glowing flat silhouette using PlaneGeometry + custom shader
  const geo = new THREE.PlaneGeometry(height * 0.5, height);
  const mat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(color || 0xffd080) }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){
        float d = distance(vUv, vec2(0.5, 0.5));
        float body = smoothstep(0.48, 0.35, d);
        float glow = smoothstep(0.5, 0.2, d) * 0.3;
        float alpha = body + glow;
        alpha *= 0.7 + 0.3 * sin(uTime * 0.5);
        gl_FragColor = vec4(uColor, alpha);
      }`
  });
  return new THREE.Mesh(geo, mat);
}

// ==================== WATER SHADER ====================
const waterVertShader = `
  uniform float uTime;
  varying vec2 vUv; varying vec3 vWorldPos;
  void main(){
    vUv = uv;
    vec3 p = position;
    p.y += sin(p.x * 2.0 + uTime) * 0.08 + sin(p.z * 3.0 + uTime * 0.7) * 0.05;
    vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const waterFragShader = `
  uniform float uTime; uniform vec3 uColor;
  varying vec2 vUv; varying vec3 vWorldPos;
  void main(){
    float ripple = sin(vUv.x * 20.0 + uTime * 2.0) * sin(vUv.y * 20.0 + uTime * 1.5) * 0.5 + 0.5;
    vec3 col = uColor + ripple * 0.08;
    float fresnel = pow(1.0 - abs(dot(normalize(vWorldPos - cameraPosition), vec3(0,1,0))), 2.0);
    col += vec3(0.15, 0.12, 0.06) * fresnel;
    gl_FragColor = vec4(col, 0.85);
  }`;

// ==================== SCENE 1: GRAND HALL (大廳) ====================
function buildHall() {
  scene.background = new THREE.Color(0x1a1408);
  scene.fog = new THREE.FogExp2(0x1a1408, 0.01);
  camera.position.set(0, 3, 14);
  controls.target.set(0, 2, 0);

  // Ambient + warm directional
  scene.add(new THREE.AmbientLight(0x332200, 0.4));
  const dir = new THREE.DirectionalLight(0xffd080, 0.6);
  dir.position.set(0, 10, 5); scene.add(dir);

  // Ground — dark stone circle
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(20, 64),
    new THREE.MeshStandardMaterial({ color: 0x1c1810, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5;
  scene.add(ground);

  // ---- MOON with procedural crater shader ----
  const moonGeo = new THREE.SphereGeometry(2.8, 64, 64);
  const moonMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vNormal; varying vec2 vUv;
      void main(){ vNormal=normal; vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vNormal; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      void main(){
        float n = noise(vUv*8.0)*0.5 + noise(vUv*16.0)*0.25 + noise(vUv*32.0)*0.125;
        vec3 base = vec3(1.0,0.92,0.7);
        vec3 crater = vec3(0.85,0.78,0.55);
        vec3 col = mix(base, crater, smoothstep(0.4,0.6,n));
        float rim = pow(1.0-max(dot(vNormal,vec3(0,0,1)),0.0),2.0);
        col += vec3(1.0,0.85,0.5)*rim*0.4;
        float pulse = 0.85 + 0.15*sin(uTime*0.8);
        gl_FragColor = vec4(col*pulse, 1.0);
      }`
  });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.position.set(0, 4, 0); scene.add(moon);
  animCallbacks.push(dt => { moonMat.uniforms.uTime.value = elapsed; });

  // Moon point light
  const moonPL = new THREE.PointLight(0xffd080, 2.5, 40);
  moonPL.position.set(0, 4, 0); scene.add(moonPL);
  animCallbacks.push(() => {
    bloomPass.strength = 1.3 + 0.4 * Math.sin(elapsed * 0.8);
  });

  // ---- LANTERNS (12) ----
  const lanternColors = [0xff3322, 0xff5533, 0xee2211, 0xff4422, 0xcc2200, 0xff6633];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 7 + Math.sin(i * 2.3) * 2;
    const l = makeLantern(lanternColors[i % lanternColors.length], 0.3, 0.6, 0.4);
    l.position.set(Math.sin(a) * r, 3.5 + Math.sin(i * 1.7) * 0.8, Math.cos(a) * r);
    scene.add(l);
    const baseY = l.position.y;
    animCallbacks.push(() => { l.position.y = baseY + Math.sin(elapsed * 1.2 + i) * 0.15; });
  }

  // ---- WOOD SIGNS (5 orbiting) ----
  const LABELS = ['節日介紹', '中秋習俗', '傳說故事', '詩詞欣賞', '製作教程'];
  const SCENE_NAMES = ['history', 'customs', 'street', 'poetry', 'craft'];
  const signR = 6;
  LABELS.forEach((label, i) => {
    const theta = (i / LABELS.length) * Math.PI * 2;
    const div = document.createElement('div');
    div.className = 'wood-sign';
    div.textContent = label;
    div.addEventListener('click', () => window.switchScene(SCENE_NAMES[i]));
    const obj = new CSS2DObject(div);
    obj.position.set(Math.sin(theta) * signR, 2.5 + Math.sin(i * 1.2) * 0.3, Math.cos(theta) * signR);
    obj.userData = { baseTheta: theta, radius: signR };
    scene.add(obj); signObjects.push(obj);
  });
  animCallbacks.push(() => {
    signObjects.forEach(obj => {
      const t = obj.userData.baseTheta + elapsed * 0.3;
      obj.position.x = Math.sin(t) * obj.userData.radius;
      obj.position.z = Math.cos(t) * obj.userData.radius;
    });
  });

  // ---- STARS (twinkling) ----
  const starCount = 500;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i*3] = (Math.random()-0.5)*100;
    starPos[i*3+1] = Math.random()*40+5;
    starPos[i*3+2] = (Math.random()-0.5)*100;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffeedd, size: 0.15, transparent: true });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);
  animCallbacks.push(() => { starMat.opacity = 0.6 + 0.4 * Math.sin(elapsed * 1.5); });

  // ---- SILHOUETTE (ancient lady at entrance) ----
  const lady = makeSilhouette('lady', 2.5, 0xffd080);
  lady.position.set(-4, 0.8, 6); scene.add(lady);
  animCallbacks.push(() => { lady.material.uniforms.uTime.value = elapsed; });

  document.getElementById('scene-back-btn').classList.remove('show');
}

// ==================== SCENE 2: HISTORY AREA (歷史科普區) ====================
function buildHistory() {
  scene.background = new THREE.Color(0x12100a);
  scene.fog = new THREE.FogExp2(0x12100a, 0.02);
  camera.position.set(0, 3, 10);
  controls.target.set(0, 1.5, 0);
  scene.add(new THREE.AmbientLight(0x332200, 0.3));

  // Floor
  scene.add(place(new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a1610, roughness: 0.95 })
  ), 0, 0, 0, -Math.PI/2));

  // Back wall
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(16, 6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2a2418 })
  );
  wall.position.set(0, 3, -5); scene.add(wall);

  // Central scroll — unrolled calligraphy
  const scrollTex = makeCanvasTexture(
    '中秋節源於上古天象崇拜\n由上古時代秋夕祭月演變而來\n至唐宋時期盛行全國\n明清已成為中國主要節日之一',
    512, 512, '36px serif', '#3a2510', '#f0e0c0'
  );
  const scroll = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshStandardMaterial({ map: scrollTex, side: THREE.DoubleSide })
  );
  scroll.position.set(0, 2.5, -4.5); scene.add(scroll);
  // Scroll rods
  [-1.5, 1.5].forEach(dy => {
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 4.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b6914, metalness: 0.5 })
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 2.5 + dy, -4.4); scene.add(rod);
  });

  // 5 artifact pedestals with items
  const artifacts = [
    { name: '青銅鼎', x: -5, info: { w: '青銅鼎', m: '商周時期祭祀重器，象徵權力與莊嚴' } },
    { name: '玉璧', x: -2.5, info: { w: '玉璧', m: '圓形玉器，古人用於祭天，象徵天圓' } },
    { name: '古琴', x: 0, info: { w: '古琴', m: '七弦琴，文人雅士必備，中秋撫琴賞月' } },
    { name: '陶罐', x: 2.5, info: { w: '陶罐', m: '唐代月餅模具，見證中秋食俗演變' } },
    { name: '銅鏡', x: 5, info: { w: '銅鏡', m: '古人認為鏡如明月，中秋有「照月」習俗' } },
  ];
  artifacts.forEach((a, i) => {
    // Pedestal
    const ped = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.2, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.7 })
    );
    ped.position.set(a.x, 0.6, 0); scene.add(ped);
    // Accent light
    const sl = new THREE.PointLight(0xffd080, 0.6, 4);
    sl.position.set(a.x, 2.5, 0.5); scene.add(sl);
    // Artifact object
    let obj;
    if (i === 0) { // 鼎 — cylinder + legs
      obj = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b8040, metalness: 0.7, roughness: 0.3 }));
    } else if (i === 1) { // 玉璧 — torus
      obj = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 16, 32),
        new THREE.MeshStandardMaterial({ color: 0x4a9e6f, transparent: true, opacity: 0.8, roughness: 0.2 }));
      obj.rotation.x = Math.PI / 2;
    } else if (i === 2) { // 古琴 — flat box
      obj = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.6 }));
    } else if (i === 3) { // 陶罐 — lathe
      const pts = [new THREE.Vector2(0,0),new THREE.Vector2(0.2,0),new THREE.Vector2(0.25,0.15),
        new THREE.Vector2(0.15,0.35),new THREE.Vector2(0.18,0.4),new THREE.Vector2(0,0.4)];
      obj = new THREE.Mesh(new THREE.LatheGeometry(pts, 16),
        new THREE.MeshStandardMaterial({ color: 0xb08050, roughness: 0.8 }));
    } else { // 銅鏡 — circle
      obj = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32),
        new THREE.MeshStandardMaterial({ color: 0xc0a060, metalness: 0.9, roughness: 0.1, side: THREE.DoubleSide }));
    }
    obj.position.set(a.x, 1.4, 0); scene.add(obj);
    animCallbacks.push(() => { obj.rotation.y = elapsed * 0.5 + i; });
    // Label
    const lbl = document.createElement('div');
    lbl.className = 'obj-label';
    lbl.textContent = a.name;
    lbl.addEventListener('click', () => window.openMid3dPopup(
      '歷史文物 · ' + a.name, '', a.name,
      [a.info, { w: '年代', m: '商周至唐宋時期' }]
    ));
    const lo = new CSS2DObject(lbl);
    lo.position.set(a.x, 2, 0.5); scene.add(lo);
  });

  // Scholar silhouette
  const scholar = makeSilhouette('scholar', 2.2, 0x80c0a0);
  scholar.position.set(3, 1.1, -3); scene.add(scholar);
  animCallbacks.push(() => { scholar.material.uniforms.uTime.value = elapsed; });

  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE 3: ANCIENT STREET (古街夜市) ====================
function buildStreet() {
  scene.background = new THREE.Color(0x0e0c06);
  scene.fog = new THREE.FogExp2(0x0e0c06, 0.018);
  camera.position.set(0, 4, 12);
  controls.target.set(0, 1.5, -2);
  scene.add(new THREE.AmbientLight(0x221800, 0.3));
  scene.add(place(new THREE.DirectionalLight(0xffa040, 0.3), 5, 8, 3));

  // Street ground
  const streetTex = makeCanvasTexture('', 256, 256, '12px serif', '#333', '#2a2418');
  const street = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 30),
    new THREE.MeshStandardMaterial({ map: streetTex, roughness: 0.95 })
  );
  street.rotation.x = -Math.PI / 2; scene.add(street);

  // ---- STALLS (5 on each side) ----
  const stalls = [
    { name: '月餅坊', x: -3.5, z: -6, color: 0x8b4513 },
    { name: '茶館', x: 3.5, z: -6, color: 0x5c3d1e },
    { name: '絲綢莊', x: -3.5, z: -2, color: 0x8b2252 },
    { name: '燈謎攤', x: 3.5, z: -2, color: 0xcc6600 },
    { name: '小吃攤', x: -3.5, z: 2, color: 0x6b4226 },
    { name: '民間藝術', x: 3.5, z: 2, color: 0x4a6741 },
  ];
  stalls.forEach((s, i) => {
    // Stall frame
    const frame = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.5),
      new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.8 }));
    base.position.y = 1; frame.add(base);
    // Poles
    [[-1, 0, -0.6], [1, 0, -0.6], [-1, 0, 0.6], [1, 0, 0.6]].forEach(p => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 6),
        new THREE.MeshStandardMaterial({ color: 0x5c3d1e }));
      pole.position.set(p[0], 1, p[2]); frame.add(pole);
    });
    // Canopy
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 1.8),
      new THREE.MeshStandardMaterial({ color: s.color, transparent: true, opacity: 0.7 }));
    canopy.position.y = 2.1; frame.add(canopy);
    // Stall light
    const sl = new THREE.PointLight(0xffaa44, 0.5, 5);
    sl.position.y = 1.8; frame.add(sl);
    frame.position.set(s.x, 0, s.z); scene.add(frame);

    // Name label
    const lbl = document.createElement('div');
    lbl.className = 'obj-label';
    lbl.textContent = s.name;
    lbl.addEventListener('click', () => onStallClick(s.name));
    const lo = new CSS2DObject(lbl);
    lo.position.set(s.x, 2.5, s.z); scene.add(lo);
  });

  // ---- LANTERN SEA (35+) ----
  for (let i = 0; i < 35; i++) {
    const colors = [0xff3322, 0xff5533, 0xffaa22, 0xff6644, 0xee4411];
    const l = makeLantern(colors[i % colors.length], 0.15 + Math.random() * 0.2, 0.3 + Math.random() * 0.3, 0.3);
    l.position.set((Math.random()-0.5)*10, 2.8 + Math.random()*1.5, (Math.random()-0.5)*16 - 2);
    scene.add(l);
    const baseY = l.position.y;
    animCallbacks.push(() => { l.position.y = baseY + Math.sin(elapsed * 0.8 + i * 0.7) * 0.1; });
  }

  // ---- SMOKE PARTICLES ----
  const smokeCount = 80;
  const smokeGeo = new THREE.BufferGeometry();
  const smokePos = new Float32Array(smokeCount * 3);
  for (let i = 0; i < smokeCount; i++) {
    smokePos[i*3] = (Math.random()-0.5)*8;
    smokePos[i*3+1] = 1.5 + Math.random()*2;
    smokePos[i*3+2] = (Math.random()-0.5)*14 - 2;
  }
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  const smokeMat = new THREE.PointsMaterial({ color: 0xccaa88, size: 0.3, transparent: true, opacity: 0.15 });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  scene.add(smoke);
  animCallbacks.push(() => {
    const p = smokeGeo.attributes.position.array;
    for (let i = 0; i < smokeCount; i++) { p[i*3+1] += 0.003; if (p[i*3+1] > 5) p[i*3+1] = 1.5; }
    smokeGeo.attributes.position.needsUpdate = true;
  });

  // ---- PEDESTRIAN SILHOUETTES (10) ----
  for (let i = 0; i < 10; i++) {
    const ped = makeSilhouette('ped', 1.5 + Math.random()*0.5, 0xffa060);
    const startX = (Math.random()-0.5)*6;
    const z = (Math.random()-0.5)*14 - 2;
    ped.position.set(startX, 0.8, z);
    scene.add(ped);
    const speed = 0.2 + Math.random()*0.3;
    const dir = Math.random() > 0.5 ? 1 : -1;
    animCallbacks.push(() => {
      ped.material.uniforms.uTime.value = elapsed;
      ped.position.x += speed * dir * 0.005;
      if (ped.position.x > 5) ped.position.x = -5;
      if (ped.position.x < -5) ped.position.x = 5;
    });
  }

  // Moon in sky (smaller, distant)
  const skyMoon = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffd080, emissiveIntensity: 0.7 })
  );
  skyMoon.position.set(3, 12, -15); scene.add(skyMoon);
  scene.add(place(new THREE.PointLight(0xffd080, 1, 30), 3, 12, -15));

  document.getElementById('scene-back-btn').classList.add('show');
}

function onStallClick(name) {
  const data = {
    '月餅坊': { t: '月餅坊', p: 'yuè bǐng fāng', poem: '月餅', ex: [
      { w: '廣式月餅', m: '皮薄餡豐，蓮蓉蛋黃最為經典' },
      { w: '蘇式月餅', m: '層層酥皮，鮮肉餡料，酥脆可口' },
      { w: '冰皮月餅', m: '現代創新，冷藏食用，口感清爽' }
    ]},
    '茶館': { t: '中秋茶道', p: 'chá dào', poem: '品茗賞月', ex: [
      { w: '桂花茶', m: '中秋應景，桂花飄香，清甜回甘' },
      { w: '鐵觀音', m: '配月餅最佳，去膩解甜' },
      { w: '普洱茶', m: '陳年醇厚，適合秋夜慢品' }
    ]},
    '絲綢莊': { t: '絲綢文化', p: 'sī chóu', poem: '絲綢之美', ex: [
      { w: '蜀錦', m: '四川名錦，色彩絢麗，工藝精湛' },
      { w: '雲錦', m: '南京特產，皇家御用，金碧輝煌' }
    ]},
    '燈謎攤': { t: '中秋燈謎', p: 'dēng mí', poem: '猜燈謎', ex: [
      { w: '謎面', m: '「十五的月亮」打一成語 → 正大光明' },
      { w: '謎面', m: '「舉頭望明月」打一城市 → 仰光' },
      { w: '謎面', m: '「中秋菊開」打一成語 → 花好月圓' }
    ]},
    '小吃攤': { t: '中秋美食', p: 'měi shí', poem: '傳統小吃', ex: [
      { w: '桂花糕', m: '桂花飄香的傳統糕點' },
      { w: '芋頭酥', m: '外酥內軟，中秋應節食品' },
      { w: '柚子', m: '中秋必備水果，「柚」諧音「佑」' }
    ]},
    '民間藝術': { t: '民間藝術', p: 'mín jiān yì shù', poem: '傳統工藝', ex: [
      { w: '剪紙', m: '紅紙剪出嫦娥奔月、玉兔搗藥圖案' },
      { w: '泥塑兔兒爺', m: '北京傳統中秋玩具，兔首人身' },
      { w: '花燈', m: '手工紮制各式花燈，中秋提燈遊玩' }
    ]},
  };
  const d = data[name] || { t: name, p: '', poem: name, ex: [{ w: '敬請期待', m: '更多內容即將上線' }] };
  window.openMid3dPopup(d.t, d.p, d.poem, d.ex);
}

// ==================== SCENE 4: POETRY WATER PAVILION (詩詞水閣) ====================
function buildPoetry() {
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog = new THREE.FogExp2(0x0a0e14, 0.012);
  camera.position.set(0, 4, 12);
  controls.target.set(0, 2, 0);
  scene.add(new THREE.AmbientLight(0x1a2040, 0.4));

  // ---- WATER SURFACE ----
  const waterGeo = new THREE.PlaneGeometry(40, 40, 80, 80);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x0a1520) } },
    vertexShader: waterVertShader, fragmentShader: waterFragShader,
    transparent: true, side: THREE.DoubleSide
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = -0.3;
  scene.add(water);
  animCallbacks.push(() => { waterMat.uniforms.uTime.value = elapsed; });

  // ---- PAVILION (亭子) ----
  const pavG = new THREE.Group();
  // Floor
  pavG.add(place(new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 0.15, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2a18 })
  ), 0, 0.08, 0));
  // 6 pillars
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 3.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b2020, roughness: 0.6 })
    );
    pillar.position.set(Math.sin(a) * 2.5, 1.75, Math.cos(a) * 2.5);
    pavG.add(pillar);
  }
  // Roof
  pavG.add(place(new THREE.Mesh(
    new THREE.ConeGeometry(3.5, 1.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 })
  ), 0, 4, 0));
  // Roof tip ornament
  pavG.add(place(new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.5 })
  ), 0, 4.8, 0));
  scene.add(pavG);

  // Pavilion warm light
  scene.add(place(new THREE.PointLight(0xffa050, 1, 10), 0, 3, 0));

  // ---- KONGMING LANTERNS (120) ----
  const kmCount = 120;
  const kmGeo = new THREE.BufferGeometry();
  const kmPos = new Float32Array(kmCount * 3);
  const kmSizes = new Float32Array(kmCount);
  for (let i = 0; i < kmCount; i++) {
    kmPos[i*3] = (Math.random()-0.5)*30;
    kmPos[i*3+1] = 3 + Math.random()*15;
    kmPos[i*3+2] = (Math.random()-0.5)*30;
    kmSizes[i] = 0.3 + Math.random()*0.5;
  }
  kmGeo.setAttribute('position', new THREE.BufferAttribute(kmPos, 3));
  kmGeo.setAttribute('size', new THREE.BufferAttribute(kmSizes, 1));
  const kmMat = new THREE.PointsMaterial({
    color: 0xffcc66, size: 0.5, transparent: true, opacity: 0.7,
    sizeAttenuation: true
  });
  const kms = new THREE.Points(kmGeo, kmMat);
  scene.add(kms);
  animCallbacks.push(() => {
    const p = kmGeo.attributes.position.array;
    for (let i = 0; i < kmCount; i++) {
      p[i*3+1] += 0.005 + Math.sin(elapsed + i) * 0.001;
      p[i*3] += Math.sin(elapsed * 0.3 + i * 0.5) * 0.002;
      if (p[i*3+1] > 20) { p[i*3+1] = 3; p[i*3] = (Math.random()-0.5)*30; }
    }
    kmGeo.attributes.position.needsUpdate = true;
    kmMat.opacity = 0.5 + 0.2 * Math.sin(elapsed * 0.6);
  });

  // ---- MOON (distant, reflected in water) ----
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(2, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffd080, emissiveIntensity: 0.8 })
  );
  moon.position.set(0, 10, -15); scene.add(moon);
  scene.add(place(new THREE.PointLight(0xffd080, 1.5, 40), 0, 10, -15));

  // ---- POEM SCROLLS on pavilion pillars ----
  const poems = [
    { title: '水調歌頭 · 蘇軾', lines: '明月幾時有\n把酒問青天\n不知天上宮闕\n今夕是何年', pinyin: 'míng yuè jǐ shí yǒu', ex: [
      { w: '明月', m: '明亮的月亮，指中秋滿月' }, { w: '幾時', m: '什麼時候' },
      { w: '把酒', m: '端起酒杯' }, { w: '宮闕', m: '天上的宮殿' }
    ]},
    { title: '靜夜思 · 李白', lines: '床前明月光\n疑是地上霜\n舉頭望明月\n低頭思故鄉', pinyin: 'chuáng qián míng yuè guāng', ex: [
      { w: '明月光', m: '明亮的月光灑在床前' }, { w: '疑', m: '懷疑、好像' },
      { w: '舉頭', m: '抬起頭來' }, { w: '思故鄉', m: '思念遠方的家鄉' }
    ]},
    { title: '月夜憶舍弟 · 杜甫', lines: '戍鼓斷人行\n邊秋一雁聲\n露從今夜白\n月是故鄉明', pinyin: 'lù cóng jīn yè bái', ex: [
      { w: '戍鼓', m: '邊防駐軍的鼓聲' }, { w: '斷人行', m: '行人斷絕，宵禁' },
      { w: '露從今夜白', m: '今夜起進入白露節氣' }, { w: '月是故鄉明', m: '總覺得故鄉的月亮更明亮' }
    ]},
  ];
  poems.forEach((p, i) => {
    const a = (i / poems.length) * Math.PI * 2 + Math.PI / 6;
    const lbl = document.createElement('div');
    lbl.className = 'obj-label';
    lbl.textContent = p.title.split('·')[0].trim();
    lbl.style.fontSize = '14px'; lbl.style.padding = '6px 14px';
    lbl.addEventListener('click', () => window.openMid3dPopup(
      p.title, p.pinyin, p.lines.replace(/\n/g, '<br>'), p.ex
    ));
    const lo = new CSS2DObject(lbl);
    lo.position.set(Math.sin(a) * 5, 3, Math.cos(a) * 5);
    scene.add(lo);
  });

  // Floating main poem text
  const mainPoem = document.createElement('div');
  mainPoem.style.cssText = 'color:rgba(255,220,150,0.6);font-family:"Noto Serif TC",serif;font-size:18px;letter-spacing:3px;line-height:2;text-align:center;pointer-events:none;';
  mainPoem.innerHTML = '明月幾時有<br>把酒問青天<br>不知天上宮闕<br>今夕是何年';
  const mainPoemObj = new CSS2DObject(mainPoem);
  mainPoemObj.position.set(0, 2.5, 0); scene.add(mainPoemObj);

  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE 5: CRAFT TUTORIAL (製作教程) ====================
function buildCraft() {
  scene.background = new THREE.Color(0x14120c);
  scene.fog = new THREE.FogExp2(0x14120c, 0.015);
  camera.position.set(0, 4, 8);
  controls.target.set(0, 1.5, 0);
  scene.add(new THREE.AmbientLight(0x332200, 0.5));
  scene.add(place(new THREE.DirectionalLight(0xffd080, 0.8), 3, 6, 4));

  // Work table
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.15, 3),
    new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.7 })
  );
  table.position.set(0, 1, 0); scene.add(table);
  // Table legs
  [[-2.7,-0.5,-1.2],[2.7,-0.5,-1.2],[-2.7,-0.5,1.2],[2.7,-0.5,1.2]].forEach(p => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,1,6),
      new THREE.MeshStandardMaterial({ color: 0x4a2a10 }));
    leg.position.set(p[0], p[1], p[2]); scene.add(leg);
  });

  // 4 steps displayed on table
  const steps = [
    { name: '和麵', x: -2, desc: '揉製餅皮', color: 0xf5e6c8, ex: [
      { w: '材料', m: '中筋麵粉、轉化糖漿、花生油、鹼水' },
      { w: '要點', m: '糖漿與油充分乳化後再加麵粉，靜置 2 小時' }
    ]},
    { name: '包餡', x: -0.7, desc: '蓮蓉蛋黃', color: 0xd4a040, ex: [
      { w: '餡料', m: '蓮蓉 + 鹹蛋黃，餡皮比例 6:4' },
      { w: '技巧', m: '虎口收口法，確保餡料完全包裹' }
    ]},
    { name: '壓模', x: 0.7, desc: '花紋成型', color: 0xc8a050, ex: [
      { w: '模具', m: '傳統木質模具或現代按壓式模具' },
      { w: '花紋', m: '常見「花好月圓」「嫦娥奔月」圖案' }
    ]},
    { name: '烘烤', x: 2, desc: '金黃出爐', color: 0xffa030, ex: [
      { w: '溫度', m: '200°C 烤 5 分鐘定型，刷蛋液，180°C 再烤 15 分鐘' },
      { w: '回油', m: '密封放置 2-3 天，餅皮回油後口感最佳' }
    ]},
  ];
  steps.forEach((s, i) => {
    // Step platform
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18 })
    );
    plat.position.set(s.x, 1.15, 0); scene.add(plat);

    // Step object
    let obj;
    if (i === 0) { // dough ball
      obj = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16),
        new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.9 }));
    } else if (i === 1) { // wrapped ball (two-tone)
      const outer = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16),
        new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.7 }));
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xe8c040 }));
      inner.position.y = 0.05;
      obj = new THREE.Group(); obj.add(outer); obj.add(inner);
    } else if (i === 2) { // mooncake shape
      obj = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 16),
        new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.5 }));
    } else { // glowing finished mooncake
      obj = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 16),
        new THREE.MeshStandardMaterial({ color: 0xd4a030, emissive: 0xffa030, emissiveIntensity: 0.4 }));
    }
    obj.position.set(s.x, 1.45, 0); scene.add(obj);
    animCallbacks.push(() => {
      if (obj.rotation) obj.rotation.y = elapsed * 0.6 + i;
    });

    // Accent light
    scene.add(place(new THREE.PointLight(0xffd080, 0.4, 3), s.x, 2.2, 0.5));

    // Label
    const lbl = document.createElement('div');
    lbl.className = 'obj-label';
    lbl.textContent = '步驟' + (i+1) + '：' + s.name;
    lbl.addEventListener('click', () => window.openMid3dPopup(
      '步驟' + (i+1) + '：' + s.name, '', s.desc, s.ex
    ));
    const lo = new CSS2DObject(lbl);
    lo.position.set(s.x, 2, 0.8); scene.add(lo);
  });

  // Ingredient display behind table
  const ingredients = ['麵粉', '糖漿', '蛋黃', '蓮蓉', '花生油'];
  ingredients.forEach((name, i) => {
    const x = -2 + i * 1;
    const jar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.6 })
    );
    jar.position.set(x, 1.25, -1); scene.add(jar);
    const lbl = document.createElement('div');
    lbl.className = 'obj-label';
    lbl.textContent = name;
    lbl.style.fontSize = '11px';
    const lo = new CSS2DObject(lbl);
    lo.position.set(x, 1.6, -1); scene.add(lo);
  });

  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE 2b: CUSTOMS (中秋習俗) ====================
function buildCustoms() {
  scene.background = new THREE.Color(0x10100a);
  scene.fog = new THREE.FogExp2(0x10100a, 0.015);
  camera.position.set(0, 3, 10);
  controls.target.set(0, 1.5, 0);
  scene.add(new THREE.AmbientLight(0x332200, 0.4));
  scene.add(place(new THREE.DirectionalLight(0xffd080, 0.5), 3, 8, 5));

  // Floor
  scene.add(place(new THREE.Mesh(
    new THREE.CircleGeometry(12, 32),
    new THREE.MeshStandardMaterial({ color: 0x1a1610, roughness: 0.95 })
  ), 0, 0, 0, -Math.PI/2));

  // 4 custom display stations in a circle
  const customs = [
    { name: '賞月', icon: '🌕', desc: '中秋之夜，全家團聚，設宴賞月', ex: [
      { w: '時間', m: '農曆八月十五夜晚' },
      { w: '活動', m: '擺設香案、供品，全家圍坐賞月' },
      { w: '寓意', m: '月圓人團圓，寄託對親人的思念' }
    ]},
    { name: '吃月餅', icon: '🥮', desc: '月餅象徵團圓美滿', ex: [
      { w: '起源', m: '相傳元末朱元璋藏紙條於餅中傳遞消息' },
      { w: '種類', m: '廣式、蘇式、京式、潮式等各地風味' },
      { w: '習俗', m: '切月餅時按家中人數均分，象徵團圓' }
    ]},
    { name: '提燈籠', icon: '🏮', desc: '兒童提花燈遊玩', ex: [
      { w: '材料', m: '竹篾紮骨架，彩紙糊面，內置蠟燭' },
      { w: '造型', m: '兔子燈、蓮花燈、走馬燈等' },
      { w: '活動', m: '孩子們提燈結伴遊玩，增添節日氣氛' }
    ]},
    { name: '猜燈謎', icon: '🎋', desc: '燈籠上掛謎語', ex: [
      { w: '形式', m: '將謎語寫在紙條上掛於花燈下' },
      { w: '獎品', m: '猜中者可獲得小禮品' },
      { w: '意義', m: '啟迪智慧，增進節日互動樂趣' }
    ]},
  ];
  customs.forEach((c, i) => {
    const a = (i / customs.length) * Math.PI * 2;
    const r = 4;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;

    // Display stand
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.7 })
    );
    stand.position.set(x, 0.4, z); scene.add(stand);

    // Glowing orb on top
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd080, emissive: 0xffa050, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 })
    );
    orb.position.set(x, 1.2, z); scene.add(orb);
    animCallbacks.push(() => { orb.position.y = 1.2 + Math.sin(elapsed + i * 1.5) * 0.15; });

    // Light
    scene.add(place(new THREE.PointLight(0xffa050, 0.5, 5), x, 2, z));

    // Label
    const lbl = document.createElement('div');
    lbl.className = 'obj-label';
    lbl.textContent = c.icon + ' ' + c.name;
    lbl.style.fontSize = '14px';
    lbl.addEventListener('click', () => window.openMid3dPopup(c.name, '', c.desc, c.ex));
    const lo = new CSS2DObject(lbl);
    lo.position.set(x, 2, z); scene.add(lo);
  });

  // Lanterns
  for (let i = 0; i < 15; i++) {
    const l = makeLantern(0xff3322, 0.2, 0.4, 0.3);
    l.position.set((Math.random()-0.5)*10, 3+Math.random()*2, (Math.random()-0.5)*10);
    scene.add(l);
    const by = l.position.y;
    animCallbacks.push(() => { l.position.y = by + Math.sin(elapsed + i) * 0.1; });
  }

  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE MANAGER ====================
const sceneBuilders = {
  hall: buildHall,
  history: buildHistory,
  customs: buildCustoms,
  street: buildStreet,
  poetry: buildPoetry,
  craft: buildCraft,
};
const sceneNames = {
  hall: '大廳', history: '歷史科普', customs: '中秋習俗',
  street: '古街夜市', poetry: '詩詞水閣', craft: '製作教程'
};

window.switchScene = async function(name) {
  if (name === currentSceneName) return;
  setTransitionText(sceneNames[name] || '');
  await fadeIn();
  clearScene();
  sceneBuilders[name]();
  currentSceneName = name;
  controls.update();
  await fadeOut();
};

window.switchToHall = function() { window.switchScene('hall'); };

// ==================== INIT & LIFECYCLE ====================
window.initMid3dScene = function() {
  if (mid3dInited) return;
  mid3dInited = true;
  const container = document.getElementById('three-container');
  const W = container.clientWidth, H = container.clientHeight;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(W, H);
  css2dRenderer.domElement.classList.add('css2d-layer');
  container.appendChild(css2dRenderer.domElement);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 1.5, 0.4, 0.85);
  composer.addPass(bloomPass);

  controls = new OrbitControls(camera, css2dRenderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 22;

  buildHall();
  window.addEventListener('resize', onResize);
  window.resumeMid3dScene();
};

function onResize() {
  const c = document.getElementById('three-container');
  if (!c || !camera) return;
  const W = c.clientWidth, H = c.clientHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
  css2dRenderer.setSize(W, H);
  composer.setSize(W, H);
}

function animate() {
  animFrameId = requestAnimationFrame(animate);
  elapsed += 0.008;
  animCallbacks.forEach(fn => fn());
  controls.update();
  composer.render();
  css2dRenderer.render(scene, camera);
}

window.resumeMid3dScene = function() {
  if (animFrameId === null && mid3dInited) animate();
};
window.pauseMid3dScene = function() {
  if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null; }
};

// Auto-init if p-3d is the active page
if (document.getElementById('p-3d').classList.contains('active')) {
  try {
    window.initMid3dScene();
  } catch (e) {
    console.error('3D init failed:', e);
    // Fallback to museum page
    document.getElementById('p-3d').classList.remove('active');
    document.getElementById('p-museum').classList.add('active');
    const bn3d = document.getElementById('bn-3d');
    const bnM = document.getElementById('bn-museum');
    if (bn3d) bn3d.classList.remove('on');
    if (bnM) bnM.classList.add('on');
  }
}
