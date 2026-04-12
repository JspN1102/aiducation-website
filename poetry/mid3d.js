// ====== 3D 中秋文化馆 — Genshin-Style NPR Mid-Autumn Hall ======
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ==================== TOON GRADIENT MAPS ====================
function makeToonGradient(steps) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true; return tex;
}
const toonGrad3 = makeToonGradient(3);
const toonGrad5 = makeToonGradient(5);
function toonMat(color, grad) {
  return new THREE.MeshToonMaterial({ color, gradientMap: grad || toonGrad3 });
}

// ==================== QUALITY SETTINGS ====================
const Quality = {
  HIGH: { outline: true, bloom: true, smaa: true, shadows: true, pixelRatio: Math.min(window.devicePixelRatio, 2) },
  LOW:  { outline: false, bloom: true, smaa: true, shadows: false, pixelRatio: 1 }
};
let qKey = (window.innerWidth < 768) ? 'LOW' : 'HIGH';
function Q() { return Quality[qKey]; }

// ==================== STATE ====================
let scene, camera, renderer, css2dRenderer, composer, bloomPass, outlinePass, controls;
let animFrameId = null, mid3dInited = false, elapsed = 0;
let currentSceneName = 'hall';
const signObjects = [], animCallbacks = [], outlineObjects = [];
let raycaster, pointer;

// ==================== SCENE TRANSITION ====================
function fadeIn() { const el = document.getElementById('scene-transition'); el.classList.add('active'); return new Promise(r => setTimeout(r, 500)); }
function fadeOut() { const el = document.getElementById('scene-transition'); el.classList.remove('active'); return new Promise(r => setTimeout(r, 500)); }
function setTransitionText(t) { document.getElementById('scene-transition-text').textContent = t; }

// ==================== DISPOSE HELPERS ====================
function disposeObject(obj) {
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) { if (Array.isArray(obj.material)) obj.material.forEach(m => disposeMat(m)); else disposeMat(obj.material); }
}
function disposeMat(m) { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); }
function clearScene() {
  animCallbacks.length = 0; signObjects.length = 0; outlineObjects.length = 0;
  if (!scene) return;
  while (scene.children.length > 0) { const c = scene.children[0]; scene.remove(c); c.traverse(disposeObject); }
}
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
  // Flat bright body — bloom makes it glow
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.85, h, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  g.add(body);
  const capMat = toonMat(0xc8a030, toonGrad3);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, h * 0.08, 12), capMat);
  cap.position.y = h / 2; g.add(cap);
  const cap2 = cap.clone(); cap2.position.y = -h / 2; g.add(cap2);
  const pl = new THREE.PointLight(color, intensity || 0.5, r * 8);
  g.add(pl);
  return g;
}
function makeCanvasTexture(text, w, h, font, color, bg) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg || 'transparent'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color || '#f5e6c8'; ctx.font = font || '32px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  const lh = parseInt(font) * 1.4 || 44;
  const startY = h / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * lh));
  const tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true; return tex;
}
function makeSignSprite(text, sceneName) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 256, 96);
  grad.addColorStop(0, '#5c3d1e'); grad.addColorStop(0.5, '#8b6914'); grad.addColorStop(1, '#5c3d1e');
  ctx.fillStyle = grad; ctx.roundRect(4, 4, 248, 88, 8); ctx.fill();
  ctx.strokeStyle = '#3a2510'; ctx.lineWidth = 3; ctx.roundRect(4, 4, 248, 88, 8); ctx.stroke();
  ctx.fillStyle = '#f5e6c8'; ctx.font = 'bold 36px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.5, 0.94, 1);
  sprite.userData = { sceneName, label: text };
  return sprite;
}

function buildHorizon() {
  const sky = scene.background;
  const skyC = new THREE.Color(sky);
  const mtC = new THREE.Color(skyC).multiplyScalar(0.4);
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSkyColor: { value: new THREE.Vector3(skyC.r, skyC.g, skyC.b) },
        uMountainColor: { value: new THREE.Vector3(mtC.r, mtC.g, mtC.b) },
        uLayerIndex: { value: i }
      },
      vertexShader: waterVertShader, fragmentShader: horizonFragShader,
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(80, 15), mat);
    plane.position.set((i - 1.5) * 3, 5 + i * 1.5, -30 - i * 5);
    scene.add(plane);
  }
}

function buildFallingParticles(count, color, spread, yMax) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = Math.random() * yMax;
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size: 0.12, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  scene.add(new THREE.Points(geo, mat));
  animCallbacks.push(() => {
    const p = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      p[i * 3] += Math.sin(elapsed * 0.4 + i) * 0.005 + 0.003;
      p[i * 3 + 1] -= 0.015;
      p[i * 3 + 2] += Math.cos(elapsed * 0.3 + i * 0.5) * 0.003;
      if (p[i * 3 + 1] < 0) {
        p[i * 3] = (Math.random() - 0.5) * spread;
        p[i * 3 + 1] = yMax + Math.random() * 2;
        p[i * 3 + 2] = (Math.random() - 0.5) * spread;
      }
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 0.6 + 0.3 * Math.sin(elapsed * 1.5);
  });
}

function buildClutter(configs) {
  const dummy = new THREE.Object3D();
  configs.forEach(cfg => {
    const im = new THREE.InstancedMesh(cfg.geometry, cfg.material, cfg.count);
    for (let i = 0; i < cfg.count; i++) {
      const xr = cfg.xRange, zr = cfg.zRange;
      dummy.position.set(
        xr[0] + Math.random() * (xr[1] - xr[0]),
        cfg.yBase + Math.random() * 0.02,
        zr[0] + Math.random() * (zr[1] - zr[0])
      );
      const s = cfg.scaleRange[0] + Math.random() * (cfg.scaleRange[1] - cfg.scaleRange[0]);
      dummy.scale.setScalar(s);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    scene.add(im);
    outlineObjects.push(im);
  });
}

// ==================== ANIME SHADER SOURCES ====================
const waterVertShader = `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }`;
const waterFragShader = `
  varying vec2 vUv;
  void main(){
    vec3 col = vec3(0.08, 0.07, 0.06);
    gl_FragColor = vec4(col, 1.0);
  }`;
const cloudFragShader = `
  uniform float uTime; uniform float uOpacity; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){v+=a*noise(p);p*=2.0;a*=0.5;} return v; }
  void main(){
    vec2 uv = vUv + vec2(uTime*0.02, 0.0);
    float f = fbm(uv*3.0);
    // Hard-edge solid cloud
    float solid = step(0.42, f);
    // Rim glow around edge
    float rim = smoothstep(0.35, 0.42, f) * (1.0 - solid);
    float edgeFade = smoothstep(0.0,0.25,vUv.x)*smoothstep(1.0,0.75,vUv.x)*smoothstep(0.0,0.25,vUv.y)*smoothstep(1.0,0.75,vUv.y);
    // Cloud body: purple-tinted
    vec3 bodyCol = vec3(0.25, 0.18, 0.35);
    // Rim: warm moonlight
    vec3 rimCol = vec3(0.9, 0.75, 0.5);
    vec3 col = bodyCol * solid + rimCol * rim;
    float alpha = (solid * 0.7 + rim * 0.5) * uOpacity * edgeFade;
    gl_FragColor = vec4(col, alpha);
  }`;

const horizonFragShader = `
  uniform vec3 uSkyColor;
  uniform vec3 uMountainColor;
  uniform float uLayerIndex;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  void main(){
    float freq = 3.0 + uLayerIndex * 1.5;
    float height = 0.3 + noise(vec2(vUv.x * freq, uLayerIndex)) * 0.4
                       + noise(vec2(vUv.x * freq * 2.0, uLayerIndex + 5.0)) * 0.15;
    float alpha = step(vUv.y, height);
    float fade = uLayerIndex / 3.0;
    vec3 col = mix(uMountainColor, uSkyColor, fade * 0.7);
    gl_FragColor = vec4(col, alpha);
  }`;

const windCanopyVertShader = `
  uniform float uTime;
  varying vec2 vUv;
  void main(){
    vUv = uv;
    vec3 pos = position;
    float wave = sin(pos.x * 3.0 + uTime * 2.5) * 0.12
               + sin(pos.y * 2.0 + uTime * 1.8) * 0.08;
    pos.z += wave * uv.x * 0.8;
    pos.y += wave * uv.x * 0.25;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }`;
const windCanopyFragShader = `
  varying vec2 vUv;
  uniform vec3 uColor;
  void main(){
    float shade = 0.85 + 0.15 * vUv.y;
    gl_FragColor = vec4(uColor * shade, 1.0);
  }`;

const cobblestoneFragShader = `
  varying vec2 vUv;
  uniform vec3 uBaseColor;
  uniform vec3 uLineColor;
  vec2 hash2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }
  float voronoi(vec2 p){
    vec2 n=floor(p), f=fract(p); float md=8.0;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 g=vec2(float(i),float(j));
      vec2 o=hash2(n+g);
      vec2 r=g+o-f;
      md=min(md,dot(r,r));
    }
    return md;
  }
  void main(){
    vec2 uv = vUv * 12.0;
    float v = voronoi(uv);
    float edge = 1.0 - smoothstep(0.02, 0.08, v);
    vec3 col = mix(uBaseColor, uLineColor, edge);
    col *= 0.9 + 0.1 * fract(sin(dot(floor(uv), vec2(12.9, 78.2))) * 43758.5);
    gl_FragColor = vec4(col, 1.0);
  }`;

// ==================== COMPOSER BUILDER ====================
function rebuildComposer() {
  if (!renderer || !scene || !camera) return;
  const W = renderer.domElement.width, H = renderer.domElement.height;
  if (composer) composer.dispose();
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Dreamy anime bloom — large radius, low threshold
  if (Q().bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.8, 0.6, 0.7);
    composer.addPass(bloomPass);
  }
  // Outline (ink lines on architecture)
  if (Q().outline) {
    try {
      outlinePass = new OutlinePass(new THREE.Vector2(W, H), scene, camera);
      outlinePass.edgeStrength = 3.0;
      outlinePass.edgeThickness = 1.5;
      outlinePass.visibleEdgeColor.set('#1a1025');
      outlinePass.hiddenEdgeColor.set('#0a0510');
      outlinePass.selectedObjects = outlineObjects;
      composer.addPass(outlinePass);
    } catch(e) { console.warn('OutlinePass unavailable:', e); }
  }
  // SMAA
  if (Q().smaa) {
    try { composer.addPass(new SMAAPass(W, H)); } catch(e) { console.warn('SMAA unavailable:', e); }
  }
  // OutputPass
  try { composer.addPass(new OutputPass()); } catch(e) { console.warn('OutputPass unavailable:', e); }
}

// ==================== SCENE 1: GRAND HALL ====================
function buildHall() {
  scene.background = new THREE.Color(0x1a0e30);
  scene.fog = new THREE.FogExp2(0x1a0e30, 0.01);
  camera.position.set(0, 4, 16); controls.target.set(0, 2, 0);

  // Anime lighting: purple ambient + warm gold moon directional
  scene.add(new THREE.AmbientLight(0x3a2860, 0.5));
  const dir = new THREE.DirectionalLight(0xffeebb, 0.5);
  dir.position.set(2, 12, 5);
  if (Q().shadows) {
    dir.castShadow = true; dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -15; dir.shadow.camera.right = 15;
    dir.shadow.camera.top = 15; dir.shadow.camera.bottom = -15;
    dir.shadow.bias = -0.002;
  }
  scene.add(dir);
  // Cool rim light
  const rim = new THREE.DirectionalLight(0x6688cc, 0.3);
  rim.position.set(0, 5, -10); scene.add(rim);

  // ---- ANIME WATER ----
  const waterGeo = new THREE.PlaneGeometry(60, 60);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: waterVertShader, fragmentShader: waterFragShader,
    side: THREE.DoubleSide
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = -2;
  scene.add(water);

  // ---- STONE PLATFORM (toon) ----
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(8, 8.5, 0.6, 32), toonMat(0x4a4050, toonGrad5));
  platform.position.y = -1.7; platform.castShadow = true; platform.receiveShadow = true;
  scene.add(platform); outlineObjects.push(platform);
  // Gold ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.15, 8, 32), toonMat(0xc8a030, toonGrad3));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -1.38;
  scene.add(ring); outlineObjects.push(ring);

  // ---- 8 RED PILLARS (toon) ----
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = Math.sin(a) * 7, pz = Math.cos(a) * 7;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 5, 12), toonMat(0xaa3030, toonGrad3));
    col.position.set(px, 0.5, pz); col.castShadow = true; col.receiveShadow = true;
    scene.add(col); outlineObjects.push(col);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), toonMat(0xc8a030, toonGrad3));
    cap.position.set(px, 3.05, pz); scene.add(cap); outlineObjects.push(cap);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.2, 12), toonMat(0x4a4050, toonGrad5));
    base.position.set(px, -1.3, pz); scene.add(base);
  }

  // ---- MOON GATE (toon) ----
  const gateGroup = new THREE.Group();
  const gateRing = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.25, 16, 32, Math.PI), toonMat(0x5a5560, toonGrad5));
  gateRing.castShadow = true; gateGroup.add(gateRing); outlineObjects.push(gateRing);
  const gp1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), toonMat(0x5a5560, toonGrad5));
  gp1.position.set(-2.5, -0.5, 0); gp1.castShadow = true; gateGroup.add(gp1); outlineObjects.push(gp1);
  const gp2 = gp1.clone(); gp2.position.set(2.5, -0.5, 0); gateGroup.add(gp2); outlineObjects.push(gp2);
  gateGroup.position.set(0, 2.5, -8); scene.add(gateGroup);

  // ---- ALTAR (toon) ----
  const altar = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1), toonMat(0x7a4a20, toonGrad3));
  altar.position.set(0, -0.8, 0); altar.castShadow = true; altar.receiveShadow = true;
  scene.add(altar); outlineObjects.push(altar);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16, 0, Math.PI*2, 0, Math.PI/2), toonMat(0xd4a030, toonGrad3));
  bowl.position.set(0, -0.15, 0); scene.add(bowl); outlineObjects.push(bowl);

  // ---- MOON (bright shader + huge glow) ----
  const moonMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vNormal; varying vec2 vUv;
      void main(){ vNormal=normal; vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vNormal; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=0.48;} return v; }
      void main(){
        vec2 sp=vUv*6.0; float n1=fbm(sp); float n2=fbm(sp*2.3+3.7);
        float craters=smoothstep(0.55,0.7,n1)*0.25;
        float maria=smoothstep(0.3,0.5,n2)*0.15;
        vec3 bright=vec3(0.75,0.72,0.65); vec3 dark=vec3(0.55,0.52,0.42);
        vec3 col=mix(bright,dark,craters+maria);
        float rim=pow(1.0-max(dot(vNormal,vec3(0,0,1)),0.0),2.0);
        col+=vec3(0.8,0.7,0.4)*rim*0.3;
        float pulse=0.92+0.08*sin(uTime*0.6);
        gl_FragColor=vec4(col*pulse,1.0);
      }`
  });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.5, 64, 64), moonMat);
  moon.position.set(0, 7, -5); scene.add(moon);
  animCallbacks.push(() => { moonMat.uniforms.uTime.value = elapsed; });
  // Huge dreamy glow
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = 256; glowCanvas.height = 256;
  const gCtx = glowCanvas.getContext('2d');
  const gGrad = gCtx.createRadialGradient(128,128,15,128,128,128);
  gGrad.addColorStop(0,'rgba(255,230,160,0.4)'); gGrad.addColorStop(0.3,'rgba(255,200,100,0.15)'); gGrad.addColorStop(1,'rgba(200,150,80,0)');
  gCtx.fillStyle = gGrad; gCtx.fillRect(0,0,256,256);
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glowSprite.scale.set(8, 8, 1); glowSprite.position.copy(moon.position); scene.add(glowSprite);
  // Moon light
  const moonPL = new THREE.PointLight(0xffd080, 0.8, 30);
  moonPL.position.copy(moon.position); scene.add(moonPL);
  animCallbacks.push(() => { if (bloomPass) bloomPass.strength = 0.7 + 0.2 * Math.sin(elapsed * 0.6); });

  // ---- ANIME CLOUDS (solid puffy shapes) ----
  for (let i = 0; i < 8; i++) {
    const cw = 8 + Math.random() * 6, ch = 2.5 + Math.random() * 2;
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: Math.random() * 100 }, uOpacity: { value: 0.6 + Math.random() * 0.3 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: cloudFragShader, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const cloud = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), cloudMat);
    const cx = (Math.random()-0.5)*25, cy = 6+Math.random()*8, cz = -5-Math.random()*15;
    cloud.position.set(cx, cy, cz); scene.add(cloud);
    const speed = 0.1+Math.random()*0.15, startX = cx;
    animCallbacks.push(() => {
      cloudMat.uniforms.uTime.value = elapsed + i * 10;
      cloud.position.x = startX + Math.sin(elapsed * speed * 0.3 + i) * 3;
    });
  }

  // ---- LANTERNS (14) — flat bright, bloom does the glow ----
  const lanternColors = [0xff3322, 0xff5533, 0xee2211, 0xff4422, 0xcc2200, 0xff6633, 0xffaa22];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 7 + Math.sin(i * 2.3) * 2.5;
    const l = makeLantern(lanternColors[i % lanternColors.length], 0.25, 0.5, 0.6);
    const baseY = 3.5 + Math.sin(i * 1.7) * 1.2;
    l.position.set(Math.sin(a) * r, baseY, Math.cos(a) * r);
    scene.add(l);
    animCallbacks.push(() => { l.position.y = baseY + Math.sin(elapsed * 1.0 + i * 0.9) * 0.25; });
  }

  // ---- ORBITING SIGN SPRITES (5) ----
  const LABELS = ['節日介紹', '中秋習俗', '傳說故事', '詩詞欣賞', '製作教程'];
  const SCENE_NAMES = ['history', 'customs', 'street', 'poetry', 'craft'];
  const signR = 6;
  LABELS.forEach((label, i) => {
    const theta = (i / LABELS.length) * Math.PI * 2;
    const sprite = makeSignSprite(label, SCENE_NAMES[i]);
    sprite.position.set(Math.sin(theta)*signR, 2.8+Math.sin(i*1.2)*0.3, Math.cos(theta)*signR);
    sprite.userData.baseTheta = theta; sprite.userData.radius = signR;
    scene.add(sprite); signObjects.push(sprite);
  });
  animCallbacks.push(() => {
    signObjects.forEach(obj => {
      const t = obj.userData.baseTheta + elapsed * 0.25;
      obj.position.x = Math.sin(t) * obj.userData.radius;
      obj.position.z = Math.cos(t) * obj.userData.radius;
      obj.position.y = 2.8 + Math.sin(elapsed * 0.8 + obj.userData.baseTheta) * 0.3;
    });
  });

  // ---- STARS (blue-white, bigger) ----
  const starCount = 800;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i*3]=(Math.random()-0.5)*120; starPos[i*3+1]=Math.random()*50+5; starPos[i*3+2]=(Math.random()-0.5)*120;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xccddff, size: 0.18, transparent: true });
  scene.add(new THREE.Points(starGeo, starMat));
  animCallbacks.push(() => { starMat.opacity = 0.6 + 0.35 * Math.sin(elapsed * 1.2); });

  // ---- FIREFLIES (big, bright, magical) ----
  const ffCount = 80;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(ffCount * 3);
  for (let i = 0; i < ffCount; i++) {
    ffPos[i*3]=(Math.random()-0.5)*18; ffPos[i*3+1]=Math.random()*5+0.3; ffPos[i*3+2]=(Math.random()-0.5)*18;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const ffMat = new THREE.PointsMaterial({ color: 0xffee44, size: 0.25, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(ffGeo, ffMat));
  animCallbacks.push(() => {
    const p = ffGeo.attributes.position.array;
    for (let i = 0; i < ffCount; i++) {
      p[i*3] += Math.sin(elapsed*0.5+i)*0.004; p[i*3+1] += Math.sin(elapsed*0.8+i*0.7)*0.003;
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffMat.opacity = 0.7 + 0.25 * Math.sin(elapsed * 2.5 + Math.random());
  });

  // ---- HORIZON MOUNTAINS ----
  buildHorizon();

  // ---- FALLING LEAVES (golden autumn) ----
  buildFallingParticles(200, 0xffcc44, 18, 12);

  // Update outline pass
  if (outlinePass) outlinePass.selectedObjects = outlineObjects;
  document.getElementById('scene-back-btn').classList.remove('show');
}

// ==================== SCENE 2: HISTORY ====================
function buildHistory() {
  scene.background = new THREE.Color(0x18102a); scene.fog = new THREE.FogExp2(0x18102a, 0.02);
  camera.position.set(0, 3, 10); controls.target.set(0, 1.5, 0);
  scene.add(new THREE.AmbientLight(0x3a2860, 0.4));
  scene.add(place(new THREE.DirectionalLight(0xffeebb, 0.6), 2, 8, 4));
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uBaseColor: { value: new THREE.Vector3(0.17, 0.13, 0.21) }, uLineColor: { value: new THREE.Vector3(0.08, 0.05, 0.10) } },
    vertexShader: waterVertShader, fragmentShader: cobblestoneFragShader, side: THREE.DoubleSide
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20,20), floorMat);
  floor.receiveShadow = true; scene.add(place(floor,0,0,0,-Math.PI/2)); outlineObjects.push(floor);
  const scrollTex = makeCanvasTexture('中秋節源於上古天象崇拜\n至唐宋時期盛行全國\n明清已成為主要節日',512,512,'36px serif','#3a2510','#f0e0c0');
  const scroll = new THREE.Mesh(new THREE.PlaneGeometry(4,3), new THREE.MeshBasicMaterial({map:scrollTex,side:THREE.DoubleSide}));
  scroll.position.set(0,2.5,-4.5); scene.add(scroll);
  const artifacts = [{name:'青銅鼎',x:-4},{name:'玉璧',x:-2},{name:'古琴',x:0},{name:'陶罐',x:2},{name:'銅鏡',x:4}];
  artifacts.forEach((a,i) => {
    scene.add(place(new THREE.PointLight(0xffd080,0.6,4),a.x,2.5,0.5));
    const obj = new THREE.Mesh(new THREE.SphereGeometry(0.25,16,16), toonMat(0x6b8040, toonGrad3));
    obj.castShadow = true; obj.position.set(a.x,1.4,0); scene.add(obj); outlineObjects.push(obj);
    animCallbacks.push(()=>{obj.rotation.y=elapsed*0.5+i;});
    const lbl = document.createElement('div'); lbl.className='obj-label'; lbl.textContent=a.name;
    lbl.addEventListener('click',()=>window.openMid3dPopup(a.name,'',a.name,[{w:a.name,m:'歷史文物展品'}]));
    const lo = new CSS2DObject(lbl); lo.position.set(a.x,2,0.5); scene.add(lo);
  });

  // ---- MICRO-CLUTTER ----
  buildClutter([
    { geometry: new THREE.SphereGeometry(0.05,6,6), material: toonMat(0x4a4050,toonGrad3), count: 30, xRange:[-8,8], zRange:[-8,8], yBase:0.05, scaleRange:[0.8,1.5] },
    { geometry: new THREE.BoxGeometry(0.07,0.07,0.07), material: toonMat(0x3a3040,toonGrad3), count: 20, xRange:[-8,8], zRange:[-8,8], yBase:0.04, scaleRange:[0.7,1.2] }
  ]);

  if (outlinePass) outlinePass.selectedObjects = outlineObjects;
  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE 3: STREET ====================
function buildStreet() {
  scene.background = new THREE.Color(0x1a1228); scene.fog = new THREE.FogExp2(0x1a1228, 0.018);
  camera.position.set(0, 4, 12); controls.target.set(0, 1.5, -2);
  scene.add(new THREE.AmbientLight(0x3a2860, 0.4));
  scene.add(place(new THREE.DirectionalLight(0xffeebb, 0.5), 2, 8, 4));

  // ---- COBBLESTONE FLOOR ----
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uBaseColor: { value: new THREE.Vector3(0.23, 0.17, 0.22) }, uLineColor: { value: new THREE.Vector3(0.12, 0.08, 0.10) } },
    vertexShader: waterVertShader, fragmentShader: cobblestoneFragShader, side: THREE.DoubleSide
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 30), floorMat);
  floor.receiveShadow = true; scene.add(place(floor, 0, 0, 0, -Math.PI / 2)); outlineObjects.push(floor);

  const stalls = [{name:'月餅坊',x:-3.5,z:-4},{name:'茶館',x:3.5,z:-4},{name:'燈謎攤',x:-3.5,z:1},{name:'小吃攤',x:3.5,z:1}];
  const canopyMats = [];
  stalls.forEach((s) => {
    scene.add(place(new THREE.PointLight(0xffaa44,0.5,5),s.x,2,s.z));
    const lbl = document.createElement('div'); lbl.className='obj-label'; lbl.textContent=s.name;
    lbl.addEventListener('click',()=>window.openMid3dPopup(s.name,'',s.name,[{w:s.name,m:'古街夜市攤位'}]));
    const lo = new CSS2DObject(lbl); lo.position.set(s.x,2.5,s.z); scene.add(lo);

    // ---- WIND CANOPY ----
    const cMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Vector3(0.7, 0.2, 0.15) } },
      vertexShader: windCanopyVertShader, fragmentShader: windCanopyFragShader, side: THREE.DoubleSide
    });
    canopyMats.push(cMat);
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2, 10, 10), cMat);
    canopy.position.set(s.x, 2.8, s.z); canopy.rotation.x = -Math.PI / 2;
    scene.add(canopy);
  });
  animCallbacks.push(() => { canopyMats.forEach(m => { m.uniforms.uTime.value = elapsed; }); });

  for(let i=0;i<25;i++){const l=makeLantern([0xff3322,0xff5533,0xffaa22][i%3],0.15,0.3,0.3);l.position.set((Math.random()-0.5)*10,2.8+Math.random()*1.5,(Math.random()-0.5)*14);scene.add(l);const by=l.position.y;animCallbacks.push(()=>{l.position.y=by+Math.sin(elapsed*0.8+i*0.7)*0.1;});}

  // ---- HORIZON MOUNTAINS ----
  buildHorizon();

  // ---- MICRO-CLUTTER ----
  buildClutter([
    { geometry: new THREE.BoxGeometry(0.08,0.08,0.08), material: toonMat(0x5a4a40,toonGrad3), count: 40, xRange:[-5,5], zRange:[-12,12], yBase:0.04, scaleRange:[0.8,1.5] },
    { geometry: new THREE.CylinderGeometry(0.04,0.04,0.06,6), material: toonMat(0x6a5a50,toonGrad3), count: 30, xRange:[-5,5], zRange:[-12,12], yBase:0.03, scaleRange:[0.7,1.3] }
  ]);

  if (outlinePass) outlinePass.selectedObjects = outlineObjects;
  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE 4: POETRY ====================
function buildPoetry() {
  scene.background = new THREE.Color(0x0e1428); scene.fog = new THREE.FogExp2(0x0e1428, 0.012);
  camera.position.set(0, 4, 12); controls.target.set(0, 2, 0);
  scene.add(new THREE.AmbientLight(0x2a3060, 0.5));
  scene.add(place(new THREE.DirectionalLight(0xffeebb, 0.6), 2, 10, 4));
  const wMat = new THREE.ShaderMaterial({uniforms:{},vertexShader:waterVertShader,fragmentShader:waterFragShader,side:THREE.DoubleSide});
  const w2 = new THREE.Mesh(new THREE.PlaneGeometry(40,40),wMat); w2.rotation.x=-Math.PI/2; w2.position.y=-0.3; scene.add(w2);
  const pavG = new THREE.Group();
  const pavFloor = new THREE.Mesh(new THREE.CylinderGeometry(3,3,0.15,8), toonMat(0x4a3a28, toonGrad5));
  pavG.add(place(pavFloor,0,0.08,0)); outlineObjects.push(pavFloor);
  for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;const p=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,3.5,8),toonMat(0xaa3030,toonGrad3));p.position.set(Math.sin(a)*2.5,1.75,Math.cos(a)*2.5);pavG.add(p);outlineObjects.push(p);}
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.5,1.5,8), toonMat(0x3a3a4a, toonGrad5));
  pavG.add(place(roof,0,4,0)); outlineObjects.push(roof);
  scene.add(pavG); scene.add(place(new THREE.PointLight(0xffa050,1,10),0,3,0));
  const moon=new THREE.Mesh(new THREE.SphereGeometry(2,32,32),new THREE.MeshBasicMaterial({color:0xfff4d6}));moon.position.set(0,10,-15);scene.add(moon);
  const poems=[{title:'水調歌頭',ex:[{w:'明月',m:'中秋滿月'},{w:'把酒',m:'端起酒杯'}]},{title:'靜夜思',ex:[{w:'疑',m:'懷疑'},{w:'霜',m:'白色冰晶'}]}];
  poems.forEach((p,i)=>{const a=(i/poems.length)*Math.PI*2;const lbl=document.createElement('div');lbl.className='obj-label';lbl.textContent=p.title;lbl.addEventListener('click',()=>window.openMid3dPopup(p.title,'','',p.ex));const lo=new CSS2DObject(lbl);lo.position.set(Math.sin(a)*5,3,Math.cos(a)*5);scene.add(lo);});

  // ---- HORIZON MOUNTAINS ----
  buildHorizon();

  // ---- FALLING PETALS (pink) ----
  buildFallingParticles(150, 0xffaacc, 12, 10);

  if (outlinePass) outlinePass.selectedObjects = outlineObjects;
  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE 5: CUSTOMS ====================
function buildCustoms() {
  scene.background = new THREE.Color(0x18102a); scene.fog = new THREE.FogExp2(0x18102a, 0.015);
  camera.position.set(0, 3, 10); controls.target.set(0, 1.5, 0);
  scene.add(new THREE.AmbientLight(0x3a2860, 0.5));
  scene.add(place(new THREE.DirectionalLight(0xffeebb, 0.6), 2, 8, 4));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12,32), toonMat(0x2a2035, toonGrad5));
  floor.receiveShadow = true; scene.add(place(floor,0,0,0,-Math.PI/2)); outlineObjects.push(floor);
  const customs=[{name:'賞月',ex:[{w:'寓意',m:'月圓人團圓'}]},{name:'吃月餅',ex:[{w:'種類',m:'廣式蘇式京式'}]},{name:'提燈籠',ex:[{w:'造型',m:'兔子燈蓮花燈'}]},{name:'猜燈謎',ex:[{w:'意義',m:'啟迪智慧'}]}];
  customs.forEach((c,i)=>{const a=(i/4)*Math.PI*2;const r=4;const x=Math.sin(a)*r,z=Math.cos(a)*r;
    const orb=new THREE.Mesh(new THREE.SphereGeometry(0.35,16,16),new THREE.MeshBasicMaterial({color:0xffd080}));orb.position.set(x,1.2,z);scene.add(orb);
    animCallbacks.push(()=>{orb.position.y=1.2+Math.sin(elapsed+i*1.5)*0.15;});
    scene.add(place(new THREE.PointLight(0xffa050,0.5,5),x,2,z));
    const lbl=document.createElement('div');lbl.className='obj-label';lbl.textContent=c.name;lbl.addEventListener('click',()=>window.openMid3dPopup(c.name,'','',c.ex));
    const lo=new CSS2DObject(lbl);lo.position.set(x,2,z);scene.add(lo);});
  for(let i=0;i<12;i++){const l=makeLantern(0xff3322,0.2,0.4,0.3);l.position.set((Math.random()-0.5)*10,3+Math.random()*2,(Math.random()-0.5)*10);scene.add(l);}
  if (outlinePass) outlinePass.selectedObjects = outlineObjects;
  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE 6: CRAFT ====================
function buildCraft() {
  scene.background = new THREE.Color(0x1a1228); scene.fog = new THREE.FogExp2(0x1a1228, 0.015);
  camera.position.set(0, 4, 8); controls.target.set(0, 1.5, 0);
  scene.add(new THREE.AmbientLight(0x3a2860, 0.5));
  scene.add(place(new THREE.DirectionalLight(0xffeebb,0.8),3,6,4));
  const table = new THREE.Mesh(new THREE.BoxGeometry(6,0.15,3), toonMat(0x7a4a20, toonGrad3));
  table.receiveShadow = true; table.castShadow = true; scene.add(place(table,0,1,0)); outlineObjects.push(table);
  const steps=[{name:'和麵',x:-2},{name:'包餡',x:-0.7},{name:'壓模',x:0.7},{name:'烘烤',x:2}];
  steps.forEach((s,i)=>{
    const obj=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,0.12,16),toonMat(0xd4a030,toonGrad3));
    obj.castShadow=true; obj.position.set(s.x,1.3,0);scene.add(obj);outlineObjects.push(obj);
    animCallbacks.push(()=>{obj.rotation.y=elapsed*0.6+i;});
    scene.add(place(new THREE.PointLight(0xffd080,0.4,3),s.x,2.2,0.5));
    const lbl=document.createElement('div');lbl.className='obj-label';lbl.textContent=s.name;
    lbl.addEventListener('click',()=>window.openMid3dPopup(s.name,'','',[]));
    const lo=new CSS2DObject(lbl);lo.position.set(s.x,2,0.8);scene.add(lo);});

  // ---- MICRO-CLUTTER (table items + floor debris) ----
  buildClutter([
    { geometry: new THREE.CylinderGeometry(0.03,0.03,0.05,6), material: toonMat(0xd4a030,toonGrad3), count: 25, xRange:[-2.5,2.5], zRange:[-1,1], yBase:1.1, scaleRange:[0.8,1.5] },
    { geometry: new THREE.BoxGeometry(0.06,0.06,0.06), material: toonMat(0x5a4a40,toonGrad3), count: 25, xRange:[-3,3], zRange:[-2,2], yBase:0.03, scaleRange:[0.7,1.3] }
  ]);

  if (outlinePass) outlinePass.selectedObjects = outlineObjects;
  document.getElementById('scene-back-btn').classList.add('show');
}

// ==================== SCENE MANAGER ====================
const sceneBuilders={hall:buildHall,history:buildHistory,customs:buildCustoms,street:buildStreet,poetry:buildPoetry,craft:buildCraft};
const sceneNames={hall:'大廳',history:'歷史科普',customs:'中秋習俗',street:'古街夜市',poetry:'詩詞水閣',craft:'製作教程'};
window.switchScene=async function(name){if(name===currentSceneName)return;setTransitionText(sceneNames[name]||'');await fadeIn();clearScene();sceneBuilders[name]();currentSceneName=name;controls.update();await fadeOut();};
window.switchToHall=function(){window.switchScene('hall');};

// ==================== RAYCASTER ====================
function onPointerDown(event){
  if(!raycaster||signObjects.length===0)return;
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.x=((event.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(signObjects);
  if(hits.length>0){const sn=hits[0].object.userData.sceneName;if(sn)window.switchScene(sn);}
}

// ==================== QUALITY TOGGLE ====================
window.toggleGraphics = function() {
  qKey = (qKey === 'HIGH') ? 'LOW' : 'HIGH';
  const btn = document.getElementById('gfx-toggle');
  if (btn) btn.textContent = qKey === 'HIGH' ? '画质: 高' : '画质: 低';
  if (renderer) {
    renderer.setPixelRatio(Q().pixelRatio);
    renderer.shadowMap.enabled = Q().shadows;
    if (Q().shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  rebuildComposer();
  clearScene(); sceneBuilders[currentSceneName](); controls.update();
};

// ==================== INIT & LIFECYCLE ====================
window.initMid3dScene=function(){
  if(mid3dInited)return; mid3dInited=true;
  const container=document.getElementById('three-container');
  const W=container.clientWidth||window.innerWidth, H=container.clientHeight||window.innerHeight;
  scene=new THREE.Scene(); camera=new THREE.PerspectiveCamera(60,W/H,0.1,1000);
  raycaster=new THREE.Raycaster(); pointer=new THREE.Vector2();
  renderer=new THREE.WebGLRenderer({antialias:false,alpha:false});
  renderer.setSize(W,H); renderer.setPixelRatio(Q().pixelRatio);
  renderer.setClearColor(0x1a0e30,1);
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=0.9;
  if(Q().shadows){renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;}
  container.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('pointerdown',onPointerDown);
  css2dRenderer=new CSS2DRenderer(); css2dRenderer.setSize(W,H);
  css2dRenderer.domElement.classList.add('css2d-layer'); container.appendChild(css2dRenderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=0.05;controls.enablePan=false;controls.minDistance=4;controls.maxDistance=22;
  rebuildComposer();
  buildHall(); window.addEventListener('resize',onResize);
  const fb=document.getElementById('three-fallback');if(fb)fb.style.display='none';
  const gfxBtn=document.getElementById('gfx-toggle');if(gfxBtn)gfxBtn.textContent=qKey==='HIGH'?'画质: 高':'画质: 低';
  window.resumeMid3dScene();
};
function onResize(){const c=document.getElementById('three-container');if(!c||!camera)return;const W=c.clientWidth||window.innerWidth,H=c.clientHeight||window.innerHeight;camera.aspect=W/H;camera.updateProjectionMatrix();renderer.setSize(W,H);css2dRenderer.setSize(W,H);rebuildComposer();}
function animate(){
  animFrameId=requestAnimationFrame(animate); elapsed+=0.008;
  try{
    animCallbacks.forEach(fn=>fn());controls.update();
    if(composer){composer.render();}else{renderer.render(scene,camera);}
    css2dRenderer.render(scene,camera);
  }catch(e){console.error('Render error:',e);if(composer){composer=null;}}
}
window.resumeMid3dScene=function(){if(animFrameId===null&&mid3dInited)animate();};
window.pauseMid3dScene=function(){if(animFrameId!==null){cancelAnimationFrame(animFrameId);animFrameId=null;}};

if(document.getElementById('p-3d').classList.contains('active')){
  try{window.initMid3dScene();}catch(e){console.error('3D init failed:',e);document.getElementById('p-3d').classList.remove('active');document.getElementById('p-museum').classList.add('active');}
}