/* ============================================================
   NITRO HORIZON — 3D endless traffic racer
   Pure Three.js. 100% procedural: zero external assets.
   Portal-ready: CrazyGames / Yandex Games SDK auto-detected.
   MIT License.
============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

(() => {
'use strict';

/* ---------------- error trap (QA aid) ---------------- */
const fatalEl = document.getElementById('fatal');
/* The on-screen error bar is a debugging aid, not something players should see.
   Show it only when explicitly asked for via #debug. */
const DEBUG = location.hash.indexOf('debug') >= 0;
window.addEventListener('error', (e) => {
  console.error('[nitro]', e.message || e.error);
  if (!DEBUG) return;
  try {
    fatalEl.style.display = 'block';
    fatalEl.textContent = 'Error: ' + (e.message || e.error) + '\n' + (e.filename || '') + ' :' + (e.lineno || '');
  } catch (_) {}
});

/* ---------------- tiny utils ---------------- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }
};

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const dom = {
  canvas: $('game'), loading: $('loading'), fader: $('fader'), pops: $('pops'),
  hud: $('hud'), score: $('score'), best: $('best'), coins: $('coins'), combo: $('combo'),
  speed: $('speed'), nitroFill: $('nitroFill'),
  menu: $('menu'), btnStart: $('btnStart'), qualitySeg: $('qualitySeg'), soundSeg: $('soundSeg'),
  helpDesk: $('helpDesk'), helpTouch: $('helpTouch'), menuBest: $('menuBest'),
  over: $('gameover'), newBest: $('newBest'), finalScore: $('finalScore'), finalBest: $('finalBest'),
  finalCoins: $('finalCoins'), finalDist: $('finalDist'), btnRetry: $('btnRetry'), btnMenu: $('btnMenu'),
  finalDrift: $('finalDrift'), finalTop: $('finalTop'),
  paused: $('paused'), btnResume: $('btnResume'), btnRestart: $('btnRestart'), btnMenu2: $('btnMenu2'),
  ghostSeg: $('ghostSeg'), replayNote: $('replayNote'), brightSeg: $('brightSeg'),
  touchUI: $('touchUI'), touchL: $('touchL'), touchR: $('touchR'), nitroBtn: $('nitroBtn'),
  brakeBtn: $('brakeBtn'), fps: $('fps'), gear: $('gear'), pauseBtn: $('pauseBtn')
};

/* ---------------- quality ---------------- */
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
/* px is capped hard: pixel count is the #1 cost on a full-screen racer.
   Even "high" stays at 1.5x — beyond that you pay 2-4x fill rate for almost no
   visible gain at this art style, which is what made the game feel laggy. */
const QUALITIES = {
  low:  { px: 0.75, shadow: 0,    fogFar: 300, aniso: 1, bloom: false },
  med:  { px: 1.0,  shadow: 1024, fogFar: 380, aniso: 4, bloom: true },
  high: { px: 1.5,  shadow: 1536, fogFar: 460, aniso: 8, bloom: true }
};
let qualityName = store.get('nh.q', IS_TOUCH ? 'med' : 'high');
if (!QUALITIES[qualityName]) qualityName = 'high';
let Q = QUALITIES[qualityName];

/* ---------------- renderer / scene / camera ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true, powerPreference: 'high-performance' });
/* AgX (new in recent three.js) is a filmic transform with far better highlight
   roll-off and hue retention than ACES — saturated reds/oranges stop turning
   into flat white blobs, which is most of the "realistic colour" difference. */
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;       // AgX sits darker than ACES, so lift a little
renderer.outputColorSpace = THREE.SRGBColorSpace;
/* Shadows only need recomputing when the sun actually moves, not every frame. */
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.shadowMap.enabled = Q.shadow > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* WebGL context loss (tab backgrounded on mobile, driver reset, GPU pressure)
   used to leave a permanently black canvas. Prevent the default so the browser
   restores the context, and pause until it's back. */
dom.canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  console.warn('[nitro] WebGL context lost — waiting for restore');
}, false);
dom.canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  console.warn('[nitro] WebGL context restored');
  try { resize(); } catch (_) {}
}, false);
let contextLost = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe8a06e, 55, Q.fogFar);
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 1400);
camera.position.set(0, 4.4, 9);

/* ---------------- post-processing (r185 EffectComposer + UnrealBloom) ---------------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.72, 0.95);
composer.addPass(bloomPass);
/* ---- radial speed blur + subtle vignette/grade (custom shader pass) ----
   Streaks the image outward from the vanishing point as speed rises. This is
   what sells 300 km/h far more than any geometry change. Runs as a single
   cheap 8-tap pass, and is skipped entirely when strength is ~0. */
const SpeedBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0 },      // 0 = off
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uVignette: { value: 0.42 },   // stronger corner falloff = far easier on the eyes
    uSat: { value: 1.2 },         // AgX desaturates by design — put the punch back
    uContrast: { value: 1.05 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uStrength, uVignette, uSat, uContrast;
    uniform vec2 uCenter;
    varying vec2 vUv;
    void main(){
      vec2 dir = vUv - uCenter;
      float dist = length(dir);
      vec4 col = texture2D(tDiffuse, vUv);
      if (uStrength > 0.001) {
        /* taper to zero at the centre so the car stays sharp */
        float amt = uStrength * smoothstep(0.06, 0.55, dist);
        vec4 sum = col;
        for (int i = 1; i <= 7; i++) {
          float t = float(i) / 7.0;
          sum += texture2D(tDiffuse, vUv - dir * amt * t);
        }
        col = sum / 8.0;
      }
      /* --- filmic finish: vignette, saturation, contrast, subtle warm/cool split --- */
      float vig = 1.0 - uVignette * dist * dist * 2.2;
      col.rgb *= clamp(vig, 0.0, 1.0);
      /* saturation around Rec.709 luma */
      float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb = mix(vec3(luma), col.rgb, uSat);
      /* S-curve contrast: richer blacks without crushing detail */
      col.rgb = clamp((col.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
      /* cinematic split-tone: cool shadows, warm highlights */
      col.rgb += vec3(-0.008, -0.002, 0.014) * (1.0 - luma);
      col.rgb += vec3(0.014, 0.005, -0.010) * luma;
      gl_FragColor = clamp(col, 0.0, 1.0);
    }`
};
const speedBlurPass = new ShaderPass(SpeedBlurShader);
composer.addPass(speedBlurPass);
composer.addPass(new OutputPass());
let useBloom = !!Q.bloom;

/* ---------------- road constants ---------------- */
const LANES = [-5.1, -1.7, 1.7, 5.1];
const EDGE_X = 6.55;            // player clamp
const PLAYER_HL = 2.08, PLAYER_HW = 0.92;

/* ---------------- day / night cycle ---------------- */
const CYCLE = 210; // seconds for a full day
/* Palette reworked for AgX: deeper, more saturated skies with warmer low-sun
   light and cooler shadow fill — the natural warm/cool split real daylight has. */
/* Light budget deliberately restrained: the old daytime values (sun 4.1 + hemi 1.1
   over pale sand) turned the whole desert into a reflector and glared. Midday is
   now a hazier, softer, more filmic look rather than a white-out. */
const RAW_STOPS = [
  { t: 0.00, top: 0x1d3a7a, hor: 0xe0763a, sun: 0xf0a05e, sunI: 1.5, hemi: 0x7089c8, gnd: 0x6a4a2c, hemiI: 0.42, fog: 0xc4783e, night: 0.12, exp: 0.94 },
  { t: 0.16, top: 0x1f5fb8, hor: 0x8ab4d0, sun: 0xf6e2c0, sunI: 2.2, hemi: 0x8aa8d0, gnd: 0x7a5c3c, hemiI: 0.62, fog: 0x9ab8cc, night: 0.0,  exp: 0.9  },
  { t: 0.34, top: 0x1a56c0, hor: 0xa4c4dc, sun: 0xf8ecd8, sunI: 2.5, hemi: 0x94b4dc, gnd: 0x806040, hemiI: 0.68, fog: 0xaec8da, night: 0.0,  exp: 0.88 },
  { t: 0.50, top: 0x453092, hor: 0xe06828, sun: 0xf08a40, sunI: 1.9, hemi: 0x9c7ec4, gnd: 0x5e3e28, hemiI: 0.5,  fog: 0xd07636, night: 0.06, exp: 0.94 },
  { t: 0.60, top: 0x141a4e, hor: 0xb83644, sun: 0xe05e34, sunI: 0.95, hemi: 0x42509a, gnd: 0x362824, hemiI: 0.36, fog: 0x6a3650, night: 0.5,  exp: 0.94 },
  { t: 0.72, top: 0x03050f, hor: 0x0c1230, sun: 0x90aaee, sunI: 0.34, hemi: 0x18265a, gnd: 0x0a0a14, hemiI: 0.24, fog: 0x080d1e, night: 1.0,  exp: 0.9  },
  { t: 0.88, top: 0x04081c, hor: 0x0f183a, sun: 0x90aaee, sunI: 0.34, hemi: 0x1c2a60, gnd: 0x0c0c18, hemiI: 0.26, fog: 0x0b1228, night: 1.0,  exp: 0.9  },
  { t: 0.97, top: 0x15265a, hor: 0x854056, sun: 0xe89464, sunI: 0.9, hemi: 0x4e5ea0, gnd: 0x362824, hemiI: 0.36, fog: 0x5c3a52, night: 0.5,  exp: 0.92 }
];
const STOPS = RAW_STOPS.map(s => ({
  t: s.t, sunI: s.sunI, hemiI: s.hemiI, night: s.night, exp: s.exp,
  top: new THREE.Color(s.top), hor: new THREE.Color(s.hor), sun: new THREE.Color(s.sun),
  hemi: new THREE.Color(s.hemi), gnd: new THREE.Color(s.gnd), fog: new THREE.Color(s.fog)
}));
const SKY = {
  top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(),
  hemi: new THREE.Color(), gnd: new THREE.Color(), fog: new THREE.Color(),
  sunI: 1, hemiI: 1, night: 0, exp: 1
};
function sampleSky(t) {
  let a = STOPS[STOPS.length - 1], b = STOPS[0];
  for (let i = 0; i < STOPS.length; i++) {
    if (STOPS[i].t <= t) { a = STOPS[i]; b = STOPS[(i + 1) % STOPS.length]; }
  }
  let span = b.t - a.t; if (span <= 0) span += 1;
  let f = t - a.t; if (f < 0) f += 1; f = clamp(f / span, 0, 1);
  f = f * f * (3 - 2 * f);
  SKY.top.copy(a.top).lerp(b.top, f);   SKY.hor.copy(a.hor).lerp(b.hor, f);
  SKY.sun.copy(a.sun).lerp(b.sun, f);   SKY.hemi.copy(a.hemi).lerp(b.hemi, f);
  SKY.gnd.copy(a.gnd).lerp(b.gnd, f);   SKY.fog.copy(a.fog).lerp(b.fog, f);
  SKY.sunI = lerp(a.sunI, b.sunI, f);   SKY.hemiI = lerp(a.hemiI, b.hemiI, f);
  SKY.night = lerp(a.night, b.night, f); SKY.exp = lerp(a.exp, b.exp, f);
}
const sunDirV = new THREE.Vector3(0.5, 0.4, -0.6);
const lightDirV = new THREE.Vector3(0.5, 0.6, -0.4);
function updateSunDir(t) {
  let elev, az;
  if (t < 0.6) { const k = t / 0.6; elev = Math.sin(k * Math.PI); az = lerp(0.85, -0.85, k); }
  else { const k = (t - 0.6) / 0.4; elev = -0.16 - 0.1 * Math.sin(k * Math.PI); az = -0.85; }
  sunDirV.set(az, elev * 0.92 + 0.02, -0.55).normalize();
  lightDirV.set(az * 0.7, Math.max(elev * 0.9, 0.42), -0.42).normalize();
}

/* ---------------- lights ---------------- */
const hemi = new THREE.HemisphereLight(0xbcd8ff, 0xa8845e, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = Q.shadow > 0;
sun.shadow.mapSize.set(Q.shadow || 1024, Q.shadow || 1024);
/* tight shadow frustum = far more texel density around the car (crisper) AND cheaper */
sun.shadow.camera.left = -17; sun.shadow.camera.right = 17;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 20; sun.shadow.camera.far = 150;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
scene.add(sun); scene.add(sun.target);
/* Rim light from behind-camera-left: gives the car's curves a defining edge
   highlight instead of flat shading, which is most of what separates a
   "cheap" render from a polished one. Cheap: no shadow map. */
const rimLight = new THREE.DirectionalLight(0xbfe0ff, 0.8);
rimLight.position.set(-6, 3.4, 7);
scene.add(rimLight);
/* Warm bounce from the road surface up into the bodywork. */
const bounce = new THREE.DirectionalLight(0xffd9a8, 0.32);
bounce.position.set(2, -3, 1);
scene.add(bounce);

/* ---------------- sky dome ---------------- */
const REV = parseInt(THREE.REVISION) || 158;
const CS_CHUNK = REV >= 154 ? 'colorspace_fragment' : 'encodings_fragment';
const skyU = {
  uTop: { value: new THREE.Color(0x2c4a86) }, uHor: { value: new THREE.Color(0xff9a5c) },
  uSunCol: { value: new THREE.Color(0xffc98a) }, uSunDir: { value: sunDirV },
  uNight: { value: 0 }, uTime: { value: 0 }
};
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: `
    varying vec3 vDir;
    void main(){
      vDir = position;
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p; gl_Position.z = p.w;
    }`,
  fragmentShader: `
    varying vec3 vDir;
    uniform vec3 uTop, uHor, uSunCol, uSunDir;
    uniform float uNight, uTime;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 d = normalize(vDir);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(uHor, uTop, pow(h, 0.62));
      col = mix(col, uHor * 0.82, clamp(-d.y * 4.0, 0.0, 1.0));
      /* Rayleigh-ish horizon brightening: real skies are palest just above the
         horizon because you look through more atmosphere. */
      float lowBand = exp(-max(d.y, 0.0) * 5.5);
      col = mix(col, uHor * 1.06, lowBand * 0.42);
      float s = max(dot(d, normalize(uSunDir)), 0.0);
      /* softer disc + wider forward-scatter halo, and a subtle warm band along
         the whole horizon on the sun's side (aerial perspective) */
      col += uSunCol * (pow(s, 1400.0) * 1.1 + pow(s, 60.0) * 0.2 + pow(s, 6.0) * 0.1);
      col += uSunCol * pow(s, 2.0) * lowBand * 0.14;
      /* gentle vertical banding breaks up the flat gradient (cloud haze strata) */
      col *= 1.0 + sin(d.y * 22.0 + uTime * 0.05) * 0.012;
      if (uNight > 0.02 && d.y > 0.03) {
        vec2 sp = d.xz / (d.y + 0.18) * 36.0;
        vec2 cell = floor(sp); vec2 f = fract(sp) - 0.5;
        float hh = hash(cell);
        float star = step(0.978, hh) * smoothstep(0.16, 0.02, length(f));
        col += vec3(1.0, 0.98, 0.9) * star * uNight * (0.55 + 0.45 * sin(uTime * 2.4 + hh * 38.0));
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <${CS_CHUNK}>
    }`
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(980, 20, 10), skyMat);
skyMesh.frustumCulled = false;
scene.add(skyMesh);

/* ---------------- procedural textures ---------------- */
function makeTex(w, h, draw, repX, repY, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX || 1, repY || 1);
  /* trilinear mipmapping + anisotropy: this is what removes the shimmering /
     crawling aliasing on the road as it scrolls — a huge perceived-quality win */
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
  if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/* asphalt: one tile = 17 m wide x 20 m long */
const roadTex = makeTex(512, 1024, (g, w, h) => {
  g.fillStyle = '#33363d'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4200; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.08)';
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const pxm = w / 17; // px per metre
  const cx = w / 2;
  g.fillStyle = 'rgba(0,0,0,0.10)'; // wheel-polish bands
  LANES.forEach(lx => {
    g.fillRect(cx + (lx - 0.62) * pxm - 8, 0, 16, h);
    g.fillRect(cx + (lx + 0.62) * pxm - 8, 0, 16, h);
  });
  // solid edge lines
  g.fillStyle = 'rgba(245,240,225,0.92)';
  g.fillRect(cx - 6.8 * pxm - 3, 0, 6, h);
  g.fillRect(cx + 6.8 * pxm - 3, 0, 6, h);
  // dashed separators (dash 2.6 m, gap 3.4 m)
  const dash = 2.6 / 20 * h, gap = 3.4 / 20 * h;
  [-3.4, 0, 3.4].forEach(lx => {
    for (let y = 0; y < h; y += dash + gap) {
      g.fillStyle = 'rgba(240,235,215,0.85)';
      g.fillRect(cx + lx * pxm - 3, y, 6, dash);
    }
  });
}, 1, 50);
/* sand */
/* Desert floor: deeper ochre base with mottled patches, scattered scrub and
   wind ripples. The old flat pale #cfa76c acted like a giant bounce card and
   was the main source of glare — this is darker and far more interesting. */
const sandTex = makeTex(512, 512, (g, w, h) => {
  g.fillStyle = '#8f6c40'; g.fillRect(0, 0, w, h);
  /* broad tonal patches so the ground isn't one uniform sheet */
  for (let i = 0; i < 60; i++) {
    g.fillStyle = pick(['#98744a', '#846138', '#a07d50', '#7a5a34']);
    g.globalAlpha = 0.35;
    const r = 30 + Math.random() * 90;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, 7); g.fill();
  }
  /* wind ripples */
  g.globalAlpha = 0.14;
  g.strokeStyle = '#5e4426'; g.lineWidth = 2;
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h, amp = 3 + Math.random() * 7;
    g.beginPath();
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * amp);
    g.stroke();
  }
  /* grain + sparse scrub */
  for (let i = 0; i < 3400; i++) {
    g.globalAlpha = 0.2 + Math.random() * 0.35;
    g.fillStyle = pick(['#a17c4c', '#79582f', '#b08b58', '#6a4c28']);
    const r = 1 + Math.random() * 4;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 130; i++) {
    g.globalAlpha = 0.5;
    g.fillStyle = pick(['#5c6236', '#4a5230', '#6a7040']);
    const x = Math.random() * w, y = Math.random() * h, s = 2 + Math.random() * 4;
    g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}, 48, 48);
/* guard rail: tile = 8 m */
const railTex = makeTex(256, 64, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#b9c2cc'); grd.addColorStop(0.5, '#8b949f'); grd.addColorStop(0.55, '#6c757f'); grd.addColorStop(1, '#9aa3ad');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(0, h * 0.46, w, 4);
  g.fillStyle = '#4a525c';                    // posts
  g.fillRect(10, 6, 14, h - 12); g.fillRect(w / 2 + 10, 6, 14, h - 12);
}, 125, 1);
/* light pool under street lamps */
const poolTex = makeTex(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,220,150,0.9)'); grd.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
/* clouds */
const cloudTex = makeTex(256, 128, (g, w, h) => {
  for (let i = 0; i < 18; i++) {
    const x = w * (0.15 + Math.random() * 0.7), y = h * (0.3 + Math.random() * 0.4), r = 12 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 2, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }
});
/* lit windows for the skyline */
const winTex = makeTex(64, 128, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (let y = 6; y < h - 6; y += 12) for (let x = 6; x < w - 6; x += 10) {
    if (Math.random() < 0.55) {
      g.fillStyle = pick(['#ffd9a0', '#ffeecc', '#bfe0ff', '#ffc070']);
      g.fillRect(x, y, 6, 7);
    }
  }
});

/* ---------------- environment reflections ---------------- */
(function makeEnv() {
  /* A richer probe: banded sky (zenith → horizon haze), warm desert ground, a
     bright sun disc and a soft horizon glow band. More tonal steps here means
     the clearcoat picks up believable gradients as the car rolls, instead of
     one flat wash of colour. */
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 20);
  const pos = geo.attributes.position;
  const cols = [];
  const zenith = new THREE.Color(0x2a5fc8);
  const skyMid = new THREE.Color(0x86b6ee);
  const haze   = new THREE.Color(0xffe0b8);
  const gndNear = new THREE.Color(0xb08a58);
  const gndFar  = new THREE.Color(0x4a3520);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0.28) {
      tmp.copy(skyMid).lerp(zenith, Math.pow((y - 0.28) / 0.72, 0.8));
    } else if (y > 0) {
      tmp.copy(haze).lerp(skyMid, y / 0.28);          // horizon haze band
    } else {
      tmp.copy(gndNear).lerp(gndFar, Math.pow(-y, 0.5));
    }
    cols.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  /* sun disc — gives paint and glass a crisp moving highlight */
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff4e0 })
  );
  sunBall.position.set(4.5, 5.5, -5); envScene.add(sunBall);
  /* soft bounce card low and opposite, so the far side of the body isn't dead */
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc890, side: THREE.DoubleSide })
  );
  card.position.set(-5, 1.2, 4); card.lookAt(0, 1, 0); envScene.add(card);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.04).texture;
  pm.dispose();
})();

/* ---------------- static world ---------------- */
const world = new THREE.Group(); scene.add(world);
/* Objects we move manually get matrixAutoUpdate=false + explicit updates, skipping
   per-frame matrix recomputation for the whole static scene graph. */
function freeze(o) { o.matrixAutoUpdate = false; o.updateMatrix(); return o; }

/* roughness map so the asphalt catches varying specular sheen instead of reading flat */
const roadRoughTex = makeTex(256, 256, (g, w, h) => {
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) {
    const v = 140 + Math.random() * 110 | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}, 4, 120, false);
const roadMat = new THREE.MeshStandardMaterial({
  map: roadTex, roughness: 0.9, metalness: 0.06, envMapIntensity: 0.35,
  roughnessMap: roadRoughTex,
  emissive: 0xffffff, emissiveMap: roadTex, emissiveIntensity: 0
});
const road = new THREE.Mesh(new THREE.PlaneGeometry(17, 1000), roadMat);
road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -420);
road.receiveShadow = true; world.add(freeze(road));

const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0, envMapIntensity: 0.08 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1700, 1500), sandMat);
ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.07, -420);
world.add(freeze(ground));   // no shadow receive: it's outside the shadow frustum anyway

const railMat = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.6 });
[-8.7, 8.7].forEach(x => {
  const rail = new THREE.Mesh(new THREE.PlaneGeometry(1000, 0.5), railMat);
  rail.rotation.y = Math.PI / 2; rail.position.set(x, 0.42, -420);
  world.add(freeze(rail));
});

/* mountains + skyline (distant silhouettes) */
const mountMat = new THREE.MeshStandardMaterial({ color: 0x4a4066, roughness: 1, flatShading: true, envMapIntensity: 0 });
/* Mountains and skyline never move relative to each other, so bake each group
   into ONE geometry: 21 static draw calls collapse to 2. */
{
  const parts = [];
  for (let i = 0; i < 11; i++) {
    const r = rand(60, 150), h = rand(45, 115);
    const g = new THREE.ConeGeometry(r, h, 5);
    const side = i % 2 === 0 ? 1 : -1;
    g.rotateY(rand(Math.PI * 2));
    g.translate(side * rand(55, 330) + rand(-20, 20), h / 2 - 6, -rand(400, 520));
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  world.add(freeze(new THREE.Mesh(merged, mountMat)));
}
const bldMat = new THREE.MeshStandardMaterial({
  color: 0x0d1524, roughness: 0.9, emissive: 0xffd9a0, emissiveMap: winTex, emissiveIntensity: 0
});
{
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const w = rand(10, 24), h = rand(22, 78), d = rand(10, 20);
    const g = new THREE.BoxGeometry(w, h, d);
    const side = i < 11 ? -1 : 1;   // cluster mostly left, a few right for depth
    g.translate(side * rand(46, 230), h / 2 - 2, -rand(370, 480));
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  world.add(freeze(new THREE.Mesh(merged, bldMat)));
}

/* clouds */
const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.55, depthWrite: false, fog: true });
const clouds = [];
for (let i = 0; i < 9; i++) {
  const sp = new THREE.Sprite(cloudMat);
  const s = rand(50, 110);
  sp.scale.set(s, s * 0.38, 1);
  sp.position.set(rand(-280, 280), rand(60, 140), -rand(180, 520));
  clouds.push(sp); world.add(sp);
}

/* ---- aerial-perspective haze curtains ----
   Two soft gradient walls standing in front of the mountains and mid-ground.
   Real distance reads as *desaturation and lifted contrast*, not just fog colour,
   and these give the landscape genuine layered depth for two draw calls. */
const hazeTex = makeTex(8, 128, (g, w, h) => {
  const grd = g.createLinearGradient(0, h, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const hazeMats = [];
[[-360, 60, 0.5], [-250, 34, 0.34]].forEach(([z, hgt, op]) => {
  const m = new THREE.MeshBasicMaterial({
    map: hazeTex, transparent: true, opacity: op, depthWrite: false, fog: false
  });
  hazeMats.push(m);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1500, hgt), m);
  mesh.position.set(0, hgt / 2 - 5, z);
  world.add(freeze(mesh));
});

/* glow sprites (cheap bloom) */
const glowTex = makeTex(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
function makeGlowMat(color, opacity) {
  const m = new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  m.toneMapped = false;
  return m;
}
const sunGlowMat = makeGlowMat(0xffd9a0, 0.5);
const sunGlow = new THREE.Sprite(sunGlowMat);
sunGlow.scale.set(320, 320, 1);
scene.add(sunGlow);
const lampGlowMat = makeGlowMat(0xffe2ae, 0);
const trafficGlowMat = makeGlowMat(0xff3020, 0.4);

/* birds (day-time flocks) */
const birdMat = new THREE.MeshBasicMaterial({ color: 0x141c28, side: THREE.DoubleSide });
const birdGeo = new THREE.PlaneGeometry(0.72, 0.3);
const flocks = [];
for (let f = 0; f < 2; f++) {
  const g = new THREE.Group();
  const birds = [];
  for (let b = 0; b < 5; b++) {
    const m = new THREE.Mesh(birdGeo, birdMat);
    m.position.set(b * 1.4 - 2.8, Math.abs(b - 2) * -0.7, Math.abs(b - 2) * 1.2);
    g.add(m); birds.push(m);
  }
  g.position.set(rand(-240, 240), rand(34, 64), -rand(170, 330));
  g.userData = { birds, dir: f === 0 ? 1 : -1, ph: rand(6) };
  flocks.push(g); world.add(g);
}

/* street lamps (pooled, recycled) */
const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.6, metalness: 0.5 });
const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, emissive: 0xffe2ae, emissiveIntensity: 0 });
const lampPoolMat = new THREE.MeshBasicMaterial({
  map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
});
const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.6, 8);
const armGeo = new THREE.BoxGeometry(0.14, 0.12, 1.9);
const headGeo = new THREE.BoxGeometry(0.34, 0.14, 0.72);
const poolGeo = new THREE.PlaneGeometry(8, 11);
const LAMP_N = 12, LAMP_GAP = 55;
const lamps = [];
for (let i = 0; i < LAMP_N; i++) {
  const g = new THREE.Group();
  const side = i % 2 === 0 ? 1 : -1;
  /* pole + arm share one material — bake them into a single mesh */
  const pg = poleGeo.clone(); pg.translate(side * 8.1, 2.8, 0);
  const ag = armGeo.clone(); ag.translate(side * 7.2, 5.5, 0);
  const structure = mergeGeometries([pg, ag], false);
  pg.dispose(); ag.dispose();
  const pole = new THREE.Mesh(structure, lampPoleMat);
  const head = new THREE.Mesh(headGeo, lampHeadMat); head.position.set(side * 6.35, 5.42, 0);
  const pool = new THREE.Mesh(poolGeo, lampPoolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(side * 6.3, 0.04, 0);
  const lg = new THREE.Sprite(lampGlowMat); lg.scale.set(4.2, 4.2, 1); lg.position.set(side * 6.35, 5.45, 0);
  g.add(pole, head, pool, lg);
  g.position.z = 20 - i * LAMP_GAP;
  lamps.push(g); world.add(g);
}

/* overhead sign gantries — big speed landmarks */
function makeSignTex(text) {
  return makeTex(512, 128, (g, w, h) => {
    g.fillStyle = '#175f38'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#f2f6f0';
    g.font = 'italic 900 54px system-ui, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}
const trussMat = new THREE.MeshStandardMaterial({ color: 0x2e3844, roughness: 0.6, metalness: 0.5 });
const gantryPoleGeo = new THREE.BoxGeometry(0.34, 6.4, 0.34);
const trussGeo = new THREE.BoxGeometry(18.6, 0.72, 0.5);
const signGeo = new THREE.PlaneGeometry(5.6, 1.4);
const SIGN_TEXTS = ['NITRO CITY   24', 'HORIZON BEACH   8', 'PALM COAST   47'];
const signMats = [];
const gantries = [];
for (let i = 0; i < 3; i++) {
  const g = new THREE.Group();
  [-8.9, 8.9].forEach(x => {
    const p = new THREE.Mesh(gantryPoleGeo, trussMat);
    p.position.set(x, 3.2, 0); g.add(p);
  });
  const truss = new THREE.Mesh(trussGeo, trussMat);
  truss.position.y = 6.55; g.add(truss);
  const sTex = makeSignTex(SIGN_TEXTS[i]);
  const sMat = new THREE.MeshStandardMaterial({
    map: sTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: sTex, emissiveIntensity: 0.15
  });
  signMats.push(sMat);
  const sign = new THREE.Mesh(signGeo, sMat);
  sign.position.set(rand(-3.5, 3.5), 5.6, 0.42);
  g.add(sign);
  g.position.z = -220 - i * 380;
  gantries.push(g); world.add(g);
}

/* roadside scenery (pooled) */
const duneMat = new THREE.MeshStandardMaterial({ color: 0x8a6740, roughness: 1, flatShading: true, envMapIntensity: 0.06 });
const duneGeo = new THREE.SphereGeometry(1, 7, 5);
const dunes = [];
for (let i = 0; i < 20; i++) {
  const m = new THREE.Mesh(duneGeo, duneMat);
  resetDune(m, true); dunes.push(m); world.add(freeze(m));
}
function resetDune(m, init) {
  const side = Math.random() < 0.5 ? 1 : -1;
  m.scale.set(rand(9, 32), rand(2.2, 6.5), rand(8, 24));
  m.position.set(side * rand(26, 120), -0.4, init ? -rand(0, 700) : -rand(560, 760));
}
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7a44, roughness: 0.9, side: THREE.DoubleSide });
const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 1, 6);
const leafGeo = new THREE.PlaneGeometry(0.72, 2.7);
/* Each palm was a Group of 8 meshes (12 palms = 96 draw calls). Bake trunk +
   fronds into ONE geometry per palm: 96 → 12. Materials differ, so merge with
   groups and hand the mesh an array material. */
const palms = [];
for (let i = 0; i < 12; i++) {
  const hgt = rand(3.4, 5.4);
  const tg = trunkGeo.clone();
  tg.scale(1, hgt, 1);
  tg.translate(0, hgt / 2, 0);
  const leafParts = [];
  const nL = 7;
  for (let k = 0; k < nL; k++) {
    const lg = leafGeo.clone();
    const ry = (k / nL) * Math.PI * 2 + rand(0.3);
    lg.rotateX(-0.95 + rand(-0.15, 0.15));
    lg.rotateY(ry);
    lg.translate(Math.sin(ry) * 0.9, hgt + 0.1, Math.cos(ry) * 0.9);
    leafParts.push(lg);
  }
  const leavesMerged = mergeGeometries(leafParts, false);
  leafParts.forEach(g => g.dispose());
  const merged = mergeGeometries([tg, leavesMerged], true);   // groups → 2 materials
  tg.dispose(); leavesMerged.dispose();
  const m = new THREE.Mesh(merged, [trunkMat, leafMat]);
  resetSideProp(m, true, 11, 42); palms.push(m); world.add(m);
}
const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 1, flatShading: true });
const rocks = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.7, 2.1)), rockMat);
  m.scale.y = rand(0.5, 0.85); m.rotation.y = rand(6);
  resetSideProp(m, true, 10, 55); rocks.push(m); world.add(freeze(m));
}
function resetSideProp(o, init, minX, maxX) {
  const side = Math.random() < 0.5 ? 1 : -1;
  o.position.set(side * rand(minX, maxX), 0, init ? -rand(0, 680) : -rand(560, 780));
  o.rotation.y = rand(6);
}

/* ---------------- car factory ---------------- */
const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 18);
wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.3, metalness: 0.9 });
/* Physical glass: dark tint with a real specular sheet, so windows catch the sky
   and the sun instead of looking like flat black panels. */
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x070b12, roughness: 0.06, metalness: 0.25,
  clearcoat: 1, clearcoatRoughness: 0.03,
  reflectivity: 0.5, envMapIntensity: 0.72    // higher turns windows into sky mirrors
});
const tailMat = new THREE.MeshStandardMaterial({ color: 0x550808, emissive: 0xff2418, emissiveIntensity: 0.8 });
const headMatT = new THREE.MeshStandardMaterial({ color: 0xcccccc, emissive: 0xffffff, emissiveIntensity: 0.3 });

/* sculpted body shells: extrude a side profile with beveled (rounded) edges */
function extrudeCar(profile, width, mat, bevelTh, bevelSz) {
  const bt = bevelTh === undefined ? 0.07 : bevelTh;
  const bs = bevelSz === undefined ? 0.05 : bevelSz;
  const shape = new THREE.Shape();
  profile.forEach((p, i) => { if (i === 0) shape.moveTo(p[0], p[1]); else shape.lineTo(p[0], p[1]); });
  const depth = Math.max(0.1, width - 2 * bt);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 2, steps: 1, curveSegments: 4
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2); // profile +x becomes -z (car front)
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}
/* soft contact shadow under every car — grounds them visually */
const blobTex = makeTex(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.78)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
function addBlob(g, w, l) {
  const b = new THREE.Mesh(new THREE.PlaneGeometry(w, l), blobMat);
  b.rotation.x = -Math.PI / 2;
  b.position.y = 0.02;
  g.add(b);
}

function addWheels(g, spec) {
  const zs = spec.L / 2 - spec.wheelR - 0.28;
  const ws = [];
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.scale.set(spec.wheelW || 0.3, spec.wheelR, spec.wheelR);
    w.position.set(sx * (spec.W / 2 - 0.1), spec.wheelR, sz * zs);
    w.rotation.order = 'YXZ';
    g.add(w); ws.push(w);
  });
  return ws;
}
function buildTrafficCar(spec, color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.55, envMapIntensity: 0.8 });
  if (spec.truck) {
    const cab = extrudeCar([
      [1.1, 0.25], [1.1, 1.9], [2.55, 1.95], [3.25, 1.15], [3.8, 1.05], [3.8, 0.25], [3.0, 0.32], [1.8, 0.32]
    ], spec.W * 0.94, bodyMat, 0.08, 0.06);
    const cargoMat = new THREE.MeshStandardMaterial({ color: spec.cargo, roughness: 0.7, metalness: 0.15 });
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(spec.W, 2.5, spec.L - 2.9), cargoMat);
    cargo.position.set(0, 1.5, 1.45); cargo.castShadow = true;
    g.add(cab, cargo);
  } else {
    const shell = extrudeCar(spec.profile, spec.W, bodyMat);
    const canopy = extrudeCar(spec.canopy, spec.W * 0.8, glassMat, 0.05, 0.04);
    g.add(shell, canopy);
  }
  const tl = new THREE.Mesh(new THREE.BoxGeometry(spec.W * 0.72, 0.12, 0.06), tailMat);
  tl.position.set(0, spec.tailY, spec.L / 2 + 0.01);
  const hl = new THREE.Mesh(new THREE.BoxGeometry(spec.W * 0.66, 0.1, 0.06), headMatT);
  hl.position.set(0, spec.headY, -spec.L / 2 - 0.01);
  const tg = new THREE.Sprite(trafficGlowMat);
  tg.scale.set(2.0, 1.1, 1); tg.position.set(0, spec.tailY + 0.02, spec.L / 2 + 0.2);
  g.add(tl, hl, tg);
  addBlob(g, spec.W + 0.7, spec.L + 0.5);
  const ws = addWheels(g, spec);
  return { g, ws };
}
const TRAFFIC_SPECS = [
  { /* sedan */
    L: 4.5, W: 1.84, wheelR: 0.34, tailY: 0.52, headY: 0.42,
    profile: [[-2.24, 0.24], [-2.24, 0.64], [-1.85, 0.7], [0.6, 0.72], [1.5, 0.62], [2.24, 0.54], [2.24, 0.22], [1.6, 0.3], [-1.6, 0.3]],
    canopy: [[-1.45, 0.7], [-1.2, 1.12], [0.0, 1.14], [0.85, 0.7]],
    colors: [0x9aa7b8, 0x30507a, 0x7a3038, 0xd8cfc0, 0x3d5c50]
  },
  { /* hatchback */
    L: 3.9, W: 1.76, wheelR: 0.33, tailY: 0.58, headY: 0.4,
    profile: [[-1.95, 0.26], [-1.95, 0.8], [-1.62, 0.86], [0.9, 0.62], [1.95, 0.52], [1.95, 0.22], [1.3, 0.3], [-1.3, 0.3]],
    canopy: [[-1.68, 0.84], [-1.3, 1.14], [0.15, 1.08], [0.8, 0.62]],
    colors: [0xc8b830, 0x2a6a8a, 0xb85028, 0x8a8f98, 0x50356a]
  },
  { /* suv */
    L: 4.9, W: 1.98, wheelR: 0.4, tailY: 0.7, headY: 0.52,
    profile: [[-2.45, 0.3], [-2.45, 0.92], [2.0, 0.9], [2.45, 0.7], [2.45, 0.3], [1.7, 0.4], [-1.7, 0.4]],
    canopy: [[-2.22, 0.9], [-2.0, 1.56], [1.1, 1.56], [1.62, 0.88]],
    colors: [0x24343f, 0x5a2a2a, 0x2f4f3f, 0x6a6f78, 0x8a6a2a]
  },
  { /* truck */
    L: 7.6, W: 2.2, truck: true, wheelR: 0.44, wheelW: 0.36, tailY: 0.6, headY: 0.6,
    colors: [0xb02828, 0x2a5a9a, 0xd8d0c8], cargo: 0xd8d4cc
  }
];

/* ---------------- player car ---------------- */
const player = {
  g: new THREE.Group(), body: new THREE.Group(), wheels: [], x: 0, steer: 0,
  vx: 0, prevVx: 0, slip: 0, gear: 0, rpm: 0,
  roll: 0, pitch: 0, susPhase: 0, prevSpeed: 25
};
(function buildPlayer() {
  const g = player.g;
  const car = player.body;      // suspended chassis — pitches/rolls/bounces over the wheels
  g.add(car);
  /* Real automotive paint: a metallic base flake under a smooth clearcoat, plus
     iridescent sheen at grazing angles. This is what makes the body read as
     lacquered metal rather than coloured plastic. */
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xc8102e, roughness: 0.38, metalness: 0.55,
    clearcoat: 1, clearcoatRoughness: 0.04,
    sheen: 0.5, sheenRoughness: 0.35, sheenColor: 0xff8090,
    envMapIntensity: 1.5
  });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.4 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.35, metalness: 0.7 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc8ced8, roughness: 0.18, metalness: 1, envMapIntensity: 1.6 });
  player.paint = paint;

  /* ---- MAIN BODY: low, wide supercar silhouette ----
     Lower nose, longer hood, fast-raked screen, muscular haunch, cut-off kamm tail. */
  const shell = extrudeCar([
    [-2.14, 0.14],                       // splitter lip
    [-2.14, 0.44], [-1.98, 0.56],        // low nose
    [-1.5, 0.62], [-0.85, 0.66],         // hood, gently rising
    [-0.35, 0.68],                       // cowl
    [0.95, 0.62], [1.62, 0.58],          // shoulder line into haunch
    [2.02, 0.5], [2.1, 0.4],             // kamm tail cut
    [2.1, 0.16], [1.5, 0.26], [-1.5, 0.26]   // underside
  ], 1.9, paint);
  car.add(shell);
  /* greenhouse: separate tapered glass canopy (narrower = "tumblehome") */
  const canopy = extrudeCar([
    [-0.42, 0.68], [-0.12, 1.02], [0.62, 1.04], [1.15, 0.63]
  ], 1.36, glassMat, 0.05, 0.04);
  car.add(canopy);
  /* roof spine in body colour so the glass doesn't look like a bubble */
  const roof = extrudeCar([[0.0, 1.0], [0.15, 1.06], [0.66, 1.05], [0.72, 0.99]], 1.2, paint, 0.04, 0.03);
  car.add(roof);
  /* front splitter + rear diffuser (carbon) */
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.06, 0.42), carbonMat);
  splitter.position.set(0, 0.13, -2.0); car.add(splitter);
  const diffuser = extrudeCar([[1.9, 0.1], [2.12, 0.1], [2.12, 0.34], [1.9, 0.24]], 1.7, carbonMat, 0.04, 0.03);
  car.add(diffuser);
  /* side skirts, flared arches */
  [[-1], [1]].forEach(([s]) => {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 2.5), carbonMat);
    skirt.position.set(s * 0.93, 0.25, 0.15); car.add(skirt);
    /* wheel arch flares — shallow blisters that hug the tyre tops without
       breaking the shoulder line (a full torus here pokes through the body) */
    [[-1.35], [1.42]].forEach(([az]) => {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.055, 5, 9, Math.PI * 0.62), paint);
      arch.rotation.y = Math.PI / 2;
      arch.rotation.x = Math.PI * 0.19;    // centre the arc over the wheel
      arch.position.set(s * 0.9, 0.3, az);
      car.add(arch);
    });
    /* side mirror on a stalk */
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), darkTrim);
    stalk.position.set(s * 0.97, 0.72, -0.28); car.add(stalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.16), paint);
    mirror.position.set(s * 1.08, 0.75, -0.3); mirror.castShadow = true; car.add(mirror);
    /* quad exhaust tips */
    [[0.22], [0.42]].forEach(([ex]) => {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.14, 10), chromeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(s * ex, 0.28, 2.12); car.add(tip);
    });
  });
  /* hood vents + intake slats (dark inserts read as depth) */
  [[-0.4], [0.4]].forEach(([vx]) => {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.5), carbonMat);
    vent.position.set(vx, 0.655, -1.15); car.add(vent);
  });
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, 0.06), carbonMat);
  grille.position.set(0, 0.32, -2.13); car.add(grille);
  /* swan-neck rear wing */
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.055, 0.4), carbonMat);
  wing.position.set(0, 1.0, 1.88); wing.rotation.x = -0.08; wing.castShadow = true; car.add(wing);
  [[-0.66], [0.66]].forEach(([sx]) => {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.14), carbonMat);
    strut.position.set(sx, 0.84, 1.93); strut.rotation.x = 0.18; car.add(strut);
  });
  /* headlights: slim angled LED bars + inner projector */
  player.headMat = new THREE.MeshStandardMaterial({ color: 0xe8f2ff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  [[-1], [1]].forEach(([s]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.075, 0.1), player.headMat);
    bar.position.set(s * 0.6, 0.47, -2.03); bar.rotation.z = s * 0.12; car.add(bar);
    const proj = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), player.headMat);
    proj.position.set(s * 0.42, 0.44, -2.06); car.add(proj);
  });
  /* full-width taillight bar (modern supercar signature) */
  player.tailMat = new THREE.MeshStandardMaterial({ color: 0x400606, emissive: 0xff1a10, emissiveIntensity: 1.4 });
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.085, 0.05), player.tailMat);
  tailBar.position.set(0, 0.47, 2.1); car.add(tailBar);
  [[-1], [1]].forEach(([s]) => {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.06), player.tailMat);
    pod.position.set(s * 0.62, 0.47, 2.09); car.add(pod);
  });
  /* light glows */
  player.headGlowMat = makeGlowMat(0xfff2cc, 0.2);
  [[-0.58], [0.58]].forEach(([sx]) => {
    const hg = new THREE.Sprite(player.headGlowMat);
    hg.scale.set(1.6, 1.4, 1); hg.position.set(sx, 0.47, -2.16); car.add(hg);
  });
  /* Tail glow is tuned for the chase view at distance. Kept small and low-opacity
     so the close menu shot doesn't blow the whole rear of the car into a white
     smear once bloom is applied. */
  player.tailGlowMat = makeGlowMat(0xff2418, 0.3);
  const tgl = new THREE.Sprite(player.tailGlowMat);
  tgl.scale.set(1.9, 0.62, 1); tgl.position.set(0, 0.48, 2.2); car.add(tgl);
  /* taillight light-trails */
  player.trailMat = new THREE.MeshBasicMaterial({
    color: 0xff2a14, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, toneMapped: false
  });
  player.trails = [];
  const trailGeo = new THREE.BoxGeometry(0.32, 0.05, 1);
  [[-0.6], [0.6]].forEach(([sx]) => {
    const t = new THREE.Mesh(trailGeo, player.trailMat);
    t.position.set(sx, 0.47, 2.6); car.add(t); player.trails.push(t);
  });
  /* staggered rubber: fat rears like a real RWD supercar */
  const spec = { L: 4.24, W: 1.94, wheelR: 0.38, wheelW: 0.36 };
  player.wheels = addWheels(g, spec);   // wheels stay on the root: planted
  /* alloy rim: hub disc + 5 spokes, so wheels read as wheels when they spin */
  const spokeGeo = new THREE.BoxGeometry(0.05, 0.5, 0.09);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.35, metalness: 0.85 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd83820, roughness: 0.5, metalness: 0.3 });
  player.wheels.forEach((w, i) => {
    if (i >= 2) w.scale.x *= 1.16;             // wider rear tyres
    const hub = new THREE.Mesh(wheelGeo, hubMat);
    hub.scale.set(1.08, 0.5, 0.5); w.add(hub);
    for (let s = 0; s < 5; s++) {
      const sp = new THREE.Mesh(spokeGeo, hubMat);
      sp.rotation.x = (s / 5) * Math.PI * 2;
      sp.scale.set(1, 1.6, 1);
      w.add(sp);
    }
    /* brake disc + red caliper visible through the spokes */
    const disc = new THREE.Mesh(wheelGeo, discMat);
    disc.scale.set(0.55, 0.72, 0.72); w.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.12), caliperMat);
    cal.position.set(0, 0.42, 0); w.add(cal);
  });
  /* neon underglow + contact shadow (root: stay flat on the road) */
  player.glowMat = new THREE.MeshBasicMaterial({
    map: poolTex, color: 0x18d8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.9), player.glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05; g.add(glow);
  addBlob(g, 2.5, 4.7);
  /* nitro flames */
  player.flames = [];
  const flameGeo = new THREE.ConeGeometry(0.09, 0.62, 8);
  flameGeo.rotateX(Math.PI / 2);
  player.flameMat = new THREE.MeshBasicMaterial({
    color: 0x63d9ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
  });
  [[-0.44], [0.44]].forEach(([sx]) => {
    const f = new THREE.Mesh(flameGeo, player.flameMat);
    f.position.set(sx, 0.3, 2.35); f.visible = false;
    car.add(f); player.flames.push(f);
  });
  /* headlight spot */
  player.spot = new THREE.SpotLight(0xffeccc, 0, 100, 0.5, 0.5, 1.0);
  player.spot.position.set(0, 1.2, -1.5);
  const tgt = new THREE.Object3D(); tgt.position.set(0, 0, -42);
  g.add(tgt); player.spot.target = tgt; g.add(player.spot);
  scene.add(g);
})();

/* Ghost namespace is declared here (before the mesh builder) and filled in below. */
const Ghost = { enabled: store.get('nh.ghost', '1') === '1', mesh: null, play: null, rec: [] };

/* ---------------- ghost car mesh (translucent clone of the player shell) ---------------- */
(function buildGhost() {
  const gm = new THREE.MeshBasicMaterial({
    color: 0x7fe4ff, transparent: true, opacity: 0.26,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true
  });
  const g = new THREE.Group();
  const shell = extrudeCar([
    [-2.06, 0.2], [-2.06, 0.62], [-1.65, 0.72], [-0.6, 0.76], [0.2, 0.68],
    [1.2, 0.5], [2.0, 0.44], [2.06, 0.38], [2.06, 0.2], [1.5, 0.3], [-1.5, 0.3]
  ], 1.84, gm);
  shell.castShadow = false;
  const canopy = extrudeCar([[-1.2, 0.74], [-1.0, 1.08], [-0.15, 1.1], [0.6, 0.72]], 1.46, gm, 0.05, 0.04);
  canopy.castShadow = false;
  g.add(shell, canopy);
  g.visible = false;
  scene.add(g);
  Ghost.mesh = g; Ghost.mat = gm;   // Ghost methods are attached later (see GhostImpl)
})();

/* ---------------- traffic pool ---------------- */
const TRAFFIC_N = 14;
const traffic = [];
for (let i = 0; i < TRAFFIC_N; i++) {
  const spec = TRAFFIC_SPECS[i % TRAFFIC_SPECS.length];
  const color = spec.colors[(i * 7 + 3) % spec.colors.length];
  const built = buildTrafficCar(spec, color);
  const g = built.g;
  g.visible = false; scene.add(g);
  traffic.push({
    g, ws: built.ws, on: false, lane: 0, xPos: 0, zPos: -999, speed: 20,
    hl: spec.L / 2, hw: spec.W / 2, truck: !!spec.truck, passed: false, spin: 0
  });
}
const LANE_SPEED = [23.5, 21, 18.5, 16];
function laneBlocked(lane, z, gap) {
  for (const c of traffic) if (c.on && c.lane === lane && Math.abs(c.zPos - z) < gap) return true;
  return false;
}
function sliceCount(z, win) {
  let n = 0;
  for (const c of traffic) if (c.on && Math.abs(c.zPos - z) < win) n++;
  return n;
}
function spawnTraffic(zBase) {
  const slot = traffic.find(c => !c.on);
  if (!slot) return;
  const lane = slot.truck ? randi(2, 3) : randi(0, 3);
  const z = zBase - rand(0, 60);
  if (laneBlocked(lane, z, 85) || sliceCount(z, 26) >= 2) return;
  slot.on = true; slot.passed = false; slot.spin = 0; slot.blinked = false;
  slot.lane = lane;
  slot.xPos = LANES[lane] + rand(-0.2, 0.2);
  slot.zPos = z;
  slot.speed = LANE_SPEED[lane] + rand(-1.5, 1.5) - (slot.truck ? 2 : 0);
  slot.g.visible = true;
  slot.g.rotation.set(0, 0, 0);
  slot.g.position.set(slot.xPos, 0, slot.zPos);
}
function clearTraffic() {
  traffic.forEach(c => { c.on = false; c.g.visible = false; c.zPos = -999; });
}

/* ---------------- coins (instanced) ---------------- */
const COIN_N = 72;
const coinGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.14, 20);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffc23c, metalness: 1, roughness: 0.25, emissive: 0x7a4a08, emissiveIntensity: 0.4, envMapIntensity: 1.4
});
const coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, COIN_N);
coinMesh.frustumCulled = false;
if (THREE.DynamicDrawUsage !== undefined) coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(coinMesh);
const coinData = [];
for (let i = 0; i < COIN_N; i++) coinData.push({ on: false, x: 0, z: -999, phase: rand(6) });
const dummy = new THREE.Object3D();
const MAT_ZERO = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
for (let i = 0; i < COIN_N; i++) coinMesh.setMatrixAt(i, MAT_ZERO);
function spawnCoinRow(zBase) {
  const lane = randi(0, 3);
  const n = randi(5, 9);
  const z0 = zBase - rand(0, 40);
  for (let k = 0; k < n; k++) {
    const z = z0 - k * 6.4;
    if (laneBlocked(lane, z, 24)) continue;
    const slot = coinData.find(c => !c.on);
    if (!slot) return;
    slot.on = true; slot.x = LANES[lane]; slot.z = z; slot.phase = rand(6);
  }
}
function clearCoins() { coinData.forEach(c => c.on = false); }

/* ---------------- nitro pickups ---------------- */
const canMat = new THREE.MeshStandardMaterial({
  color: 0x0d9ed8, metalness: 0.8, roughness: 0.25, emissive: 0x0a7ab8, emissiveIntensity: 0.9, envMapIntensity: 1.2
});
const canRingMat = new THREE.MeshBasicMaterial({ color: 0x6fe8ff, transparent: true, opacity: 0.9, fog: false, toneMapped: false });
const pickups = [];
for (let i = 0; i < 3; i++) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.86, 12), canMat);
  body.position.y = 0.55;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.22, 8), canMat);
  cap.position.y = 1.06;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 8, 24), canRingMat);
  ring.position.y = 0.6; ring.rotation.x = Math.PI / 2;
  g.add(body, cap, ring);
  g.visible = false; scene.add(g);
  pickups.push({ g, on: false, x: 0, z: -999 });
}
function spawnPickup(zBase) {
  const slot = pickups.find(p => !p.on);
  if (!slot) return;
  const lane = randi(0, 3);
  const z = zBase - rand(0, 50);
  if (laneBlocked(lane, z, 26)) return;
  slot.on = true; slot.x = LANES[lane]; slot.z = z;
  slot.g.visible = true;
  slot.g.position.set(slot.x, 0, slot.z);
}
function clearPickups() { pickups.forEach(p => { p.on = false; p.g.visible = false; }); }

/* ---------------- particles (instanced debris/sparks) ---------------- */
const P_N = 220;
const partMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.15, 0.15, 0.15),
  new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }),
  P_N
);
partMesh.frustumCulled = false;
if (THREE.DynamicDrawUsage !== undefined) partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(partMesh);
const pData = [];
const tmpColor = new THREE.Color();
for (let i = 0; i < P_N; i++) {
  pData.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s: 1 });
  partMesh.setMatrixAt(i, MAT_ZERO);
  partMesh.setColorAt(i, tmpColor.setHex(0xffffff));
}
function spawnBurst(x, y, z, n, colors, spMin, spMax, up) {
  let made = 0;
  for (let i = 0; i < P_N && made < n; i++) {
    const p = pData[i];
    if (p.on) continue;
    p.on = true; p.life = 0; p.max = rand(0.45, 1.15); p.s = rand(0.5, 1.7);
    const a = rand(Math.PI * 2), b = rand(-1, 1);
    const sp = rand(spMin, spMax);
    p.vx = Math.cos(a) * sp * Math.sqrt(1 - b * b);
    p.vz = Math.sin(a) * sp * Math.sqrt(1 - b * b);
    p.vy = Math.abs(b) * sp * 0.7 + (up || 3);
    p.x = x + rand(-0.5, 0.5); p.y = y + rand(-0.3, 0.3); p.z = z + rand(-0.5, 0.5);
    partMesh.setColorAt(i, tmpColor.setHex(pick(colors)));
    made++;
  }
  if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
}
const FIRE_COLS = [0xffe8a0, 0xffb050, 0xff7030, 0xff4518, 0x8a8a8a];
const SPARK_COLS = [0xfff0c0, 0xffd870, 0xffa040];
const GOLD_COLS = [0xffe080, 0xffc23c, 0xfff6d0];
const CYAN_COLS = [0x8ef2ff, 0x2fc4e8, 0xd8fbff];
const SMOKE_COLS = [0xb8b2aa, 0xd8d2c8, 0x8e8880];

/* ---------------- skid marks (instanced, recycled) ---------------- */
const MARK_N = 60;
const markMesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.3, 1.5),
  new THREE.MeshBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.5, depthWrite: false }),
  MARK_N
);
markMesh.frustumCulled = false;
markMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(markMesh);
const markData = [];
for (let i = 0; i < MARK_N; i++) { markData.push({ on: false, x: 0, z: 0 }); markMesh.setMatrixAt(i, MAT_ZERO); }
let markCursor = 0;
function layMark(x, z) {
  /* two stripes = the rear tyre pair */
  for (const off of [-0.62, 0.62]) {
    const m = markData[markCursor];
    m.on = true; m.x = x + off; m.z = z;
    markCursor = (markCursor + 1) % MARK_N;
  }
}
function clearMarks() {
  for (let i = 0; i < MARK_N; i++) { markData[i].on = false; markMesh.setMatrixAt(i, MAT_ZERO); }
  markMesh.instanceMatrix.needsUpdate = true;
}
function updateMarks(dt) {
  let any = false;
  for (let i = 0; i < MARK_N; i++) {
    const m = markData[i];
    if (!m.on) continue;
    any = true;
    m.z += playSpeed * dt;
    if (m.z > 14) { m.on = false; markMesh.setMatrixAt(i, MAT_ZERO); continue; }
    dummy.position.set(m.x, 0.012, m.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    markMesh.setMatrixAt(i, dummy.matrix);
  }
  if (any) markMesh.instanceMatrix.needsUpdate = true;
}

/* ---------------- speed lines ---------------- */
const slGroup = new THREE.Group(); scene.add(slGroup);
const slMat = new THREE.MeshBasicMaterial({
  color: 0xcfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
});
const slGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
const speedLines = [];
for (let i = 0; i < 26; i++) {
  const m = new THREE.Mesh(slGeo, slMat);
  resetSpeedLine(m, true);
  speedLines.push(m); slGroup.add(m);
}
function resetSpeedLine(m, init) {
  const side = Math.random() < 0.5 ? 1 : -1;
  /* keep them low and near the road: high-flying streaks read as scratches in the sky */
  m.position.set(side * rand(3.2, 9), rand(0.15, 2.4), init ? rand(-70, 4) : -rand(45, 80));
  m.scale.set(rand(0.5, 1), rand(0.5, 1), rand(5, 11));
}

/* ---------------- popups ---------------- */
function popup(text, cls, xPct, yPct) {
  if (dom.pops.childElementCount > 7) dom.pops.firstElementChild.remove();
  const d = document.createElement('div');
  d.className = 'pop ' + (cls || '');
  d.textContent = text;
  d.style.left = (xPct == null ? 50 : xPct) + '%';
  d.style.top = (yPct == null ? 40 : yPct) + '%';
  d.addEventListener('animationend', () => d.remove());
  dom.pops.appendChild(d);
}
const projV = new THREE.Vector3();
function popupAt3D(text, cls, x, y, z) {
  projV.set(x, y, z).project(camera);
  if (projV.z > 1) return;
  popup(text, cls, (projV.x * 0.5 + 0.5) * 100, (-projV.y * 0.5 + 0.5) * 100);
}

/* ---------------- audio (fully procedural WebAudio) ---------------- */
const audio = {
  ctx: null, master: null, sfx: null, musicBus: null,
  enabled: store.get('nh.snd', '1') === '1',
  engine: null, engineGain: null, engineFilter: null, wind: null, windGain: null, windFilter: null,
  musicOn: false, nextNote: 0, step: 0, timer: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.42; this.musicBus.connect(this.master);
    /* engine */
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.detune.value = -1195;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfx);
    o1.start(); o2.start();
    this.engine = o1; this.engine2 = o2; this.engineFilter = f; this.engineGain = g;
    /* wind */
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0;
    src.connect(wf); wf.connect(wg); wg.connect(this.sfx);
    src.start();
    this.windFilter = wf; this.windGain = wg;
    /* music delay bus */
    const dl = ctx.createDelay(1); dl.delayTime.value = 0.281;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.musicBus);
    this.delaySend = dl;
    this.startMusic();
  },
  resume() {
    try {
      if (!this.ctx) return;
      this.ctx.resume();
      /* Re-anchor the sequencer to "now". Without this, nextNote is still back in
         suspended time and schedule() dumps a burst of stacked notes on resume. */
      if (this.nextNote < this.ctx.currentTime) this.nextNote = this.ctx.currentTime + 0.05;
    } catch (_) {}
  },
  suspend() { try { this.ctx && this.ctx.suspend(); } catch (_) {} },
  setEnabled(on) {
    this.enabled = on; store.set('nh.snd', on ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.03);
  },
  engineUpdate(speed, nitroK, running, rpm) {
    if (!this.ctx) return;
    /* pitch follows RPM within the current gear, so shifts drop the note like a real box */
    const r = rpm === undefined ? Math.min(speed / 80, 1) : rpm;
    const f = 52 + r * 118 + speed * 0.22 + nitroK * 26;
    this.engine.frequency.value = f;
    this.engine2.frequency.value = f;
    this.engineFilter.frequency.value = 300 + r * 900 + speed * 6 + nitroK * 800;
    this.engineGain.gain.value = running ? Math.min(0.16, 0.075 + speed * 0.001) : 0;
    this.windFilter.frequency.value = 700 + speed * 22;
    this.windGain.gain.value = running ? Math.min(0.14, Math.max(0, speed - 14) * 0.002) : 0;
  },
  blip(freq, dur, type, vol, when, slide) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noiseHit(dur, filterType, freq, vol, freqEnd) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t); src.stop(t + dur + 0.05);
  },
  coin() { this.blip(1180, 0.08, 'sine', 0.22); this.blip(1760, 0.12, 'sine', 0.18, 0.06); },
  pickup() { this.blip(520, 0.3, 'sine', 0.22, 0, 1040); this.noiseHit(0.35, 'highpass', 400, 0.12, 3200); },
  nitroFx() { this.noiseHit(0.6, 'highpass', 260, 0.2, 2600); },
  swish() { this.noiseHit(0.22, 'bandpass', 800, 0.28, 2400); },
  scrape() { this.noiseHit(0.16, 'highpass', 1600, 0.14); },
  crash0() { this.noiseHit(0.3, 'lowpass', 700, 0.4, 160); this.blip(90, 0.22, 'sine', 0.3, 0, 50); },
  skid() { this.noiseHit(0.3, 'bandpass', 480, 0.2, 260); },
  overdriveFx() { this.blip(660, 0.12, 'square', 0.16); this.blip(880, 0.12, 'square', 0.16, 0.09); this.blip(1320, 0.22, 'square', 0.15, 0.18); },
  gearShift() { this.noiseHit(0.09, 'bandpass', 320, 0.13); },
  crash() {
    this.noiseHit(0.75, 'lowpass', 900, 0.85, 120);
    this.blip(64, 0.5, 'sine', 0.7, 0, 30);
    this.noiseHit(0.3, 'highpass', 2000, 0.3);
  },
  click() { this.blip(320, 0.06, 'square', 0.1); },
  /* --- generative synthwave loop --- */
  CHORDS: [
    [110.00, 130.81, 164.81],   // Am
    [87.31, 110.00, 130.81],    // F
    [130.81, 164.81, 196.00],   // C
    [98.00, 123.47, 146.83]     // G
  ],
  startMusic() {
    if (this.musicOn || !this.ctx) return;
    this.musicOn = true;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 55);
  },
  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const SPB = 60 / 108 / 2; // 8th notes @108bpm
    /* guard against a huge catch-up loop after a long tab suspend */
    if (this.nextNote < this.ctx.currentTime - 1) this.nextNote = this.ctx.currentTime + 0.05;
    let guard = 0;
    while (this.nextNote < this.ctx.currentTime + 0.18 && guard++ < 32) {
      const bar = Math.floor(this.step / 8) % 4;
      const chord = this.CHORDS[bar];
      const idx = this.step % 8;
      const note = chord[idx % 3] * (idx < 4 ? 2 : 4);
      this.playNote(note, this.nextNote, 0.11, 0.085);
      if (idx === 0) this.playPad(chord, this.nextNote, SPB * 8);
      this.nextNote += SPB;
      this.step++;
    }
  },
  playNote(freq, t, dur, vol) {
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicBus); g.connect(this.delaySend);
    o.start(t); o.stop(t + dur + 0.1);
  },
  playPad(chord, t, dur) {
    chord.forEach((f0, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f0; o.detune.value = i === 1 ? 6 : -5;
      const fl = this.ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 380;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028, t + 0.6);
      g.gain.setValueAtTime(0.028, t + dur - 0.7);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(fl); fl.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + dur + 0.1);
    });
  }
};

const GhostImpl = {
  SAMPLE: 6,                 // metres between samples
  nextRec: 0, idx: 0,
  load() {
    try {
      const raw = store.get('nh.ghostdata', '');
      if (!raw) return;
      const arr = JSON.parse(raw);
      /* validate every sample: one NaN/undefined from corrupt storage would
         propagate into the ghost's position and throw off Three.js matrices */
      if (Array.isArray(arr) && arr.length > 3 && arr.every(v => typeof v === 'number' && isFinite(v))) {
        this.play = arr;
      }
    } catch (_) { this.play = null; }
  },
  save() {
    try { store.set('nh.ghostdata', JSON.stringify(this.rec.slice(0, 4000))); } catch (_) {}
  },
  start() {
    this.rec = []; this.nextRec = 0; this.idx = 0;
    if (this.mesh) this.mesh.visible = false;
  },
  record(dist, x) {
    if (dist < this.nextRec) return;
    this.nextRec = dist + this.SAMPLE;
    if (this.rec.length < 4000) this.rec.push(Math.round(x * 100) / 100);
  },
  /* returns ghost world-Z offset relative to player, or null when unavailable */
  update(dist) {
    if (!this.mesh) return;
    const show = this.enabled && this.play && state === 'play';
    if (!show) { this.mesh.visible = false; return; }
    const i = dist / this.SAMPLE;
    const i0 = Math.floor(i);
    if (i0 >= this.play.length - 1) { this.mesh.visible = false; return; }
    const gx = lerp(this.play[i0], this.play[i0 + 1], i - i0);
    this.mesh.visible = true;
    this.mesh.position.set(gx, 0, 0);   // same distance = alongside you
    return gx;
  },
  commitIfBest(isBest) { if (isBest && this.rec.length > 3) { this.save(); this.play = this.rec.slice(); return true; } return false; }
};
Object.assign(Ghost, GhostImpl);
Ghost.load();

/* ---------------- portal SDK adapter (CrazyGames / Yandex) ---------------- */
const Portal = {
  type: null, sdk: null,
  async init() {
    try {
      if (window.CrazyGames && window.CrazyGames.SDK) {
        this.type = 'crazygames'; this.sdk = window.CrazyGames.SDK;
        if (this.sdk.init) await this.sdk.init();
      } else if (window.YaGames) {
        this.type = 'yandex';
        this.sdk = await window.YaGames.init();
      }
    } catch (_) {}
  },
  ready() {
    try {
      if (this.type === 'yandex' && this.sdk && this.sdk.features && this.sdk.features.LoadingAPI) this.sdk.features.LoadingAPI.ready();
      if (this.type === 'crazygames' && this.sdk.game && this.sdk.game.loadingStop) this.sdk.game.loadingStop();
    } catch (_) {}
  },
  gameplayStart() { try { if (this.type === 'crazygames' && this.sdk.game && this.sdk.game.gameplayStart) this.sdk.game.gameplayStart(); } catch (_) {} },
  gameplayStop() { try { if (this.type === 'crazygames' && this.sdk.game && this.sdk.game.gameplayStop) this.sdk.game.gameplayStop(); } catch (_) {} },
  happy() { try { if (this.type === 'crazygames' && this.sdk.game && this.sdk.game.happytime) this.sdk.game.happytime(); } catch (_) {} }
};

/* ---------------- game state ---------------- */
const input = { left: false, right: false, nitro: false, brake: false };
let state = 'menu';           // menu | play | crash | over
let paused = false;
let dayT = 0.045;             // start at golden dawn
let playSpeed = 20;           // world scroll m/s
let distance = 0, score = 0, coinCount = 0;
let best = parseInt(store.get('nh.best', '0'), 10) || 0;
let nitroTank = 40, nitroK = 0;
let combo = 0, comboT = 0;
let nextTrafficDist = 40, nextCoinDist = 60, nextPickupDist = 300;
let crashT = 0, timeScale = 1;
let overdrive = false, overdriveT = 0, nextMilestone = 1000, topSpeed = 0;
let fpsEMA = 60, dynScale = 1, lowFpsT = 0, highFpsT = 0, now0 = 0, shadowTick = 0;
/* user-facing brightness: scales exposure so nobody has to squint */
let brightness = parseFloat(store.get('nh.bright', '0.88'));
if (!(brightness > 0.4 && brightness <= 1.2)) brightness = 0.88;
let shakeAmp = 0, scrapeCd = 0, skidCd = 0, sideSwipeCd = 0;
let driftT = 0, driftScore = 0, driftBank = 0;
let camW = 0;                 // 0 = menu orbit, 1 = chase
let menuCamA = 0;
let spinGlobal = 0;
let portalReady = false;
let lastHudScore = -1, lastHudSpeed = -1, lastHudCoins = -1, lastHudComboTxt = '', lastHudGear = '';

function fmtInt(n) { return Math.floor(n).toLocaleString('en-US'); }

function setPanel(name) {
  dom.menu.classList.toggle('hidden', name !== 'menu');
  dom.over.classList.toggle('hidden', name !== 'over');
  dom.paused.classList.toggle('hidden', name !== 'paused');
  dom.hud.classList.toggle('hidden', !(name === 'hud' || name === 'paused'));
  if (dom.touchUI) dom.touchUI.classList.toggle('hidden', !(IS_TOUCH && name === 'hud'));
}
function blinkFade() {
  dom.fader.classList.add('on');
  setTimeout(() => dom.fader.classList.remove('on'), 220);
}
function repairPlayer() {
  player.g.rotation.set(0, 0, 0);
  player.g.position.set(player.x, 0, 0);
  player.body.rotation.set(0, 0, 0);
  player.body.position.set(0, 0, 0);
  player.vx = 0; player.prevVx = 0; player.slip = 0; player.gear = 0; player.rpm = 0;
  player.pitch = 0; player.roll = 0; player.prevSpeed = playSpeed;
  player.vy = 0; player.rvx = 0; player.rvy = 0; player.rvz = 0;
}
function enterMenu() {
  state = 'menu'; paused = false;
  player.x = 0; player.steer = 0;
  repairPlayer();
  clearTraffic(); clearCoins(); clearPickups(); clearMarks(); clearParticles();
  /* stale VFX/flags left over from the previous run would bleed into the menu */
  player.flames.forEach(f => f.visible = false);
  player.trails.forEach(t => t.visible = false);
  player.trailMat.opacity = 0;
  if (Ghost.mesh) Ghost.mesh.visible = false;
  nitroK = 0; overdrive = false; combo = 0; comboT = 0;
  driftT = 0; driftBank = 0; shakeAmp = 0; timeScale = 1;
  dom.pops.textContent = '';
  dom.menuBest.textContent = best > 0 ? 'BEST SCORE  ' + fmtInt(best) : '';
  setPanel('menu');
}
function startGame() {
  audio.init(); audio.resume();
  paused = false;                        // never start a run in a paused state
  blinkFade();
  clearTraffic(); clearCoins(); clearPickups(); clearParticles();
  dom.pops.textContent = '';             // drop leftover popups from the last run
  if (dom.replayNote) dom.replayNote.classList.add('hidden');
  distance = 0; score = 0; coinCount = 0;
  /* reset the auto-quality state so a bad previous run doesn't cripple this one */
  lowFpsT = 0; highFpsT = 0;
  player.flames.forEach(f => f.visible = false);
  nitroTank = 40; nitroK = 0; combo = 0; comboT = 0;
  overdrive = false; overdriveT = 0; nextMilestone = 1000;
  driftT = 0; driftBank = 0; driftScore = 0; sideSwipeCd = 0; topSpeed = 0;
  clearMarks();
  nextTrafficDist = 30; nextCoinDist = 80; nextPickupDist = 320;
  player.x = 0; player.steer = 0;
  repairPlayer();
  playSpeed = 25; timeScale = 1; shakeAmp = 0;
  Ghost.start();
  /* seed the road ahead */
  for (let i = 0; i < 7; i++) spawnTraffic(-(85 + i * 55));
  spawnCoinRow(-190); spawnCoinRow(-330);
  state = 'play'; paused = false;
  setPanel('hud');
  Portal.gameplayStart();
}
function doCrash(hitCar) {
  state = 'crash'; crashT = 0; timeScale = 0.3;
  shakeAmp = 1.5; overdrive = false;
  audio.crash();
  dom.fader.classList.add('crash', 'on');
  setTimeout(() => dom.fader.classList.remove('crash', 'on'), 180);
  try { if (navigator.vibrate) navigator.vibrate(200); } catch (_) {}
  const midX = (player.x + hitCar.xPos) / 2, midZ = hitCar.zPos / 2;
  spawnBurst(midX, 1.0, midZ, 80, FIRE_COLS, 4, 15, 5);
  spawnBurst(midX, 0.6, midZ, 40, SPARK_COLS, 8, 20, 2);
  player.rvx = rand(3.5, 6.5); player.rvy = rand(-3, 3); player.rvz = rand(-6, 6) * (Math.random() < 0.5 ? -1 : 1);
  player.vy = rand(4.5, 7);
  hitCar.spin = rand(-3, 3);
  hitCar.speed = Math.max(4, hitCar.speed * 0.4);
  Portal.gameplayStop();
}
function gameOver() {
  state = 'over';
  const sc = Math.floor(score);
  const isBest = sc > best;
  if (isBest) { best = sc; store.set('nh.best', best); Portal.happy(); }
  const savedGhost = Ghost.commitIfBest(isBest);
  if (dom.replayNote) dom.replayNote.classList.toggle('hidden', !savedGhost);
  if (Ghost.mesh) Ghost.mesh.visible = false;
  dom.finalScore.textContent = fmtInt(sc);
  dom.finalBest.textContent = fmtInt(best);
  dom.finalCoins.textContent = fmtInt(coinCount);
  dom.finalDist.textContent = (distance / 1000).toFixed(2) + ' km';
  if (dom.finalDrift) dom.finalDrift.textContent = fmtInt(driftScore);
  if (dom.finalTop) dom.finalTop.textContent = Math.round(topSpeed * 3.6) + ' km/h';
  dom.newBest.classList.toggle('hidden', !isBest);
  setPanel('over');
}
function setPaused(p) {
  if (state !== 'play' && state !== 'crash') return;
  if (paused === p) return;
  paused = p;
  setPanel(p ? 'paused' : 'hud');
  if (p) {
    audio.suspend();
    /* release held inputs: keyup never fires if focus was lost, which
       previously left the car steering or boosting by itself on resume */
    input.left = input.right = input.nitro = input.brake = false;
    if (dom.touchL) dom.touchL.classList.remove('held');
    if (dom.touchR) dom.touchR.classList.remove('held');
  } else {
    audio.resume();
    lastT = performance.now();     // don't simulate the paused duration
  }
}

/* ---------------- input ---------------- */
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyN' || e.code === 'Space') { input.nitro = true; e.preventDefault(); }
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') { input.brake = true; e.preventDefault(); }
  else if (e.code === 'KeyP' || e.code === 'Escape') { if (!e.repeat) setPaused(!paused); }
  else if (e.code === 'Enter') {
    if (state === 'menu' || state === 'over') { audio.init(); startGame(); }
    else if (paused) setPaused(false);
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyN' || e.code === 'Space') input.nitro = false;
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') input.brake = false;
});
function bindHold(el, prop) {
  if (!el) return;
  const on = (e) => {
    e.preventDefault();
    input[prop] = true; el.classList.add('held');
    /* capture the pointer so we still get the release even if the finger
       slides off the element — otherwise the control sticks on permanently */
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const off = (e) => {
    if (e) e.preventDefault();
    input[prop] = false; el.classList.remove('held');
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('lostpointercapture', off);
  /* safety net: any pointer release anywhere clears the hold */
  addEventListener('pointerup', off);
}
bindHold(dom.touchL, 'left');
bindHold(dom.touchR, 'right');
bindHold(dom.nitroBtn, 'nitro');
bindHold(dom.brakeBtn, 'brake');
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

/* Leaving the pause screen MUST go through unpause(): setting `paused = false`
   directly skipped audio.resume(), which left the whole game permanently silent. */
function unpause() {
  if (paused) { paused = false; audio.resume(); }
  lastT = performance.now();
  input.left = input.right = input.nitro = input.brake = false;
}
dom.btnStart.addEventListener('click', () => { audio.init(); audio.click(); startGame(); });
dom.btnRetry.addEventListener('click', () => { audio.click(); startGame(); });
dom.btnMenu.addEventListener('click', () => { audio.click(); blinkFade(); enterMenu(); });
dom.btnResume.addEventListener('click', () => { audio.click(); setPaused(false); });
if (dom.pauseBtn) dom.pauseBtn.addEventListener('click', (e) => {
  e.stopPropagation(); audio.click(); setPaused(true);
});
dom.btnRestart.addEventListener('click', () => { audio.click(); unpause(); startGame(); });
dom.btnMenu2.addEventListener('click', () => { audio.click(); unpause(); blinkFade(); enterMenu(); });

function refreshSegs() {
  dom.qualitySeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === qualityName));
  dom.soundSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.s === '1') === audio.enabled));
  if (dom.ghostSeg) dom.ghostSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.g === '1') === Ghost.enabled));
  if (dom.brightSeg) dom.brightSeg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', Math.abs(parseFloat(b.dataset.b) - brightness) < 0.02));
}
if (dom.brightSeg) dom.brightSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  brightness = parseFloat(b.dataset.b);
  store.set('nh.bright', brightness);
  refreshSegs(); audio.click();
});
if (dom.ghostSeg) dom.ghostSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  Ghost.enabled = b.dataset.g === '1';
  store.set('nh.ghost', Ghost.enabled ? '1' : '0');
  refreshSegs(); audio.click();
});
dom.qualitySeg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  qualityName = b.dataset.q; store.set('nh.q', qualityName);
  applyQuality(); refreshSegs(); audio.click();
});
dom.soundSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  audio.init();
  audio.setEnabled(b.dataset.s === '1');
  refreshSegs(); audio.click();
});
if (IS_TOUCH) { dom.helpDesk.classList.add('hidden'); dom.helpTouch.classList.remove('hidden'); }

addEventListener('blur', () => {
  input.left = input.right = input.nitro = input.brake = false;
  if (state === 'play' && !paused) setPaused(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state === 'play' && !paused) setPaused(true);
    audio.suspend();
  } else if (!paused) {
    audio.resume();
    lastT = performance.now();     // avoid one giant delta after returning
  }
});

function applyQuality() {
  Q = QUALITIES[qualityName];
  dynScale = 1; lowFpsT = 0; highFpsT = 0;
  useBloom = !!Q.bloom;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.px));
  const sh = Q.shadow > 0;
  renderer.shadowMap.enabled = sh;
  sun.castShadow = sh;
  if (sh) {
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  resize();
}
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  bloomPass.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

/* ---------------- per-frame updates ---------------- */
function updateAtmosphere(rdt) {
  dayT = (dayT + rdt / CYCLE) % 1;
  sampleSky(dayT);
  updateSunDir(dayT);
  const night = SKY.night;
  skyU.uTop.value.copy(SKY.top); skyU.uHor.value.copy(SKY.hor);
  skyU.uSunCol.value.copy(SKY.sun); skyU.uNight.value = night;
  skyU.uTime.value += rdt;
  hemi.color.copy(SKY.hemi); hemi.groundColor.copy(SKY.gnd); hemi.intensity = SKY.hemiI;
  sun.color.copy(SKY.sun); sun.intensity = SKY.sunI;
  /* rim/bounce follow the sky so they read as real light, not a fixed studio setup */
  rimLight.color.copy(SKY.hor);
  rimLight.intensity = 0.22 + (1 - night) * 0.3 + night * 0.2;
  bounce.color.copy(SKY.gnd);
  bounce.intensity = 0.08 + (1 - night) * 0.16;
  const tx = player.x * 0.4;
  sun.target.position.set(tx, 0, -16);
  sun.position.set(tx + lightDirV.x * 100, lightDirV.y * 100, -16 + lightDirV.z * 100);
  scene.fog.color.copy(SKY.fog);
  scene.fog.far = Q.fogFar * (1 - night * 0.16);
  renderer.toneMappingExposure = SKY.exp * 1.1 * brightness;
  /* refresh the shadow map a few times a second instead of every frame:
     the sun crawls, so this is visually identical and much cheaper */
  shadowTick += rdt;
  if (shadowTick > 0.1) { shadowTick = 0; renderer.shadowMap.needsUpdate = true; }
  /* night-driven glow */
  lampHeadMat.emissiveIntensity = night * 1.5;
  lampPoolMat.opacity = night * 0.5;
  bldMat.emissiveIntensity = night * 1.7;
  tailMat.emissiveIntensity = 0.55 + night * 1.9;
  if (state === 'menu') player.tailMat.emissiveIntensity = 0.85;
  headMatT.emissiveIntensity = 0.25 + night * 1.2;
  player.headMat.emissiveIntensity = 0.5 + night * 1.4;
  player.spot.intensity = night * 230;
  player.glowMat.opacity = Math.min(0.85, night * 0.5 + nitroK * 0.35 + (overdrive ? 0.3 : 0));
  coinMat.emissiveIntensity = 0.4 + night * 1.0;
  cloudMat.opacity = 0.55 * (1 - night * 0.82);
  /* v1.1: glows, emissive road lines, birds */
  roadMat.emissiveIntensity = night * 0.07;
  lampGlowMat.opacity = night * 0.4;
  signMats.forEach(m => { m.emissiveIntensity = 0.12 + night * 0.8; });
  /* haze curtains take the fog colour so they read as atmosphere, not geometry */
  hazeMats.forEach((m, i) => {
    m.color.copy(SKY.fog);
    m.opacity = (i === 0 ? 0.52 : 0.32) * (1 - night * 0.45);
  });
  trafficGlowMat.opacity = 0.22 + night * 0.5;
  /* glows fade right down in the menu — the camera is much closer there */
  const glowScale = state === 'menu' ? 0.3 : 1;
  player.headGlowMat.opacity = (0.12 + night * 0.7) * glowScale;
  player.tailGlowMat.opacity = (0.14 + night * 0.4) * glowScale;
  sunGlowMat.color.copy(SKY.sun);
  sunGlowMat.opacity = Math.max(0, 0.1 + (SKY.sunI / 3.6) * 0.42) * clamp(1 + sunDirV.y * 5, 0, 1);
  sunGlow.position.set(
    camera.position.x + sunDirV.x * 820,
    camera.position.y + sunDirV.y * 820,
    camera.position.z + sunDirV.z * 820
  );
  const birdVis = night < 0.5;
  for (const f of flocks) {
    f.visible = birdVis;
    if (birdVis) {
      f.position.x += f.userData.dir * 3.5 * rdt;
      if (Math.abs(f.position.x) > 270) f.position.x = -f.userData.dir * 260;
      const bt = skyU.uTime.value * 7 + f.userData.ph;
      f.userData.birds.forEach((b, i) => { b.scale.y = 0.35 + Math.abs(Math.sin(bt + i)); });
    }
  }
}

function scrollWorld(dt) {
  const dz = playSpeed * dt;
  distance += dz;
  roadTex.offset.y += dz / 20;
  sandTex.offset.y += dz / 23.4; // 1500/64 world units per tile
  railTex.offset.x -= dz / 8;
  for (const l of lamps) { l.position.z += dz; if (l.position.z > 25) l.position.z -= LAMP_N * LAMP_GAP; }
  for (const gt of gantries) { gt.position.z += dz; if (gt.position.z > 30) gt.position.z -= 3 * 380; }
  for (const d of dunes) { d.position.z += dz; if (d.position.z > 40) resetDune(d, false); d.updateMatrix(); }
  for (const p of palms) { p.position.z += dz; if (p.position.z > 30) resetSideProp(p, false, 11, 42); }
  for (const r of rocks) { r.position.z += dz; if (r.position.z > 30) resetSideProp(r, false, 10, 55); r.updateMatrix(); }
  for (const c of clouds) { c.position.x += dt * 1.5; if (c.position.x > 300) c.position.x = -300; }
}

function updateTraffic(dt) {
  for (const c of traffic) {
    if (!c.on) continue;
    const zPrev = c.zPos;                       // for swept collision (see below)
    c.zPos += (playSpeed - c.speed) * dt;
    if (c.spin) c.g.rotation.y += c.spin * dt;
    c.g.position.set(c.xPos, 0, c.zPos);
    const twr = c.speed * 2.7 * dt;
    for (const w of c.ws) w.rotation.x += twr;
    if (c.zPos > 30) { c.on = false; c.g.visible = false; continue; }
    if (state !== 'play') continue;
    const dx = Math.abs(c.xPos - player.x);
    const dzAbs = Math.abs(c.zPos);
    /* ---- traffic AI: drivers notice you closing and react ---- */
    if (!c.truck && c.zPos < -6 && c.zPos > -60 && dx < 2.6) {
      const closing = playSpeed - c.speed;
      if (closing > 8) {
        /* ease aside toward the lane edge away from you (a "let him past" nudge) */
        const away = Math.sign(c.xPos - player.x) || 1;
        c.xPos = clamp(c.xPos + away * 1.5 * dt, LANES[c.lane] - 1.15, LANES[c.lane] + 1.15);
        if (!c.blinked) { c.blinked = true; c.speed = Math.max(8, c.speed - rand(0.5, 1.8)); }
      }
    } else if (c.blinked && c.zPos > 4) {
      c.blinked = false;
      c.xPos = damp(c.xPos, LANES[c.lane], 3, dt);   // drift back to lane centre
    }
    /* ---- collision: head-on = crash, glancing side-swipe = survivable ----
       SWEPT test: at 300 km/h a single frame moves the car ~4 m, so a simple
       "are we overlapping right now" check lets cars tunnel straight through
       each other. We test whether the gap was crossed at any point this frame. */
    const zHit = (c.hl + PLAYER_HL) * 0.8, xHit = (c.hw + PLAYER_HW) * 0.84;
    const zLo = Math.min(zPrev, c.zPos), zHi = Math.max(zPrev, c.zPos);
    const zOverlap = zLo < zHit && zHi > -zHit;
    if (zOverlap && dx < xHit) {
      const glancing = dx > xHit * 0.68 && dzAbs > zHit * 0.42 && Math.abs(playSpeed - c.speed) < 26;
      if (glancing && sideSwipeCd <= 0) {
        /* SIDESWIPE: both cars get shoved, sparks fly, you keep driving */
        sideSwipeCd = 0.7;
        const dir = Math.sign(player.x - c.xPos) || 1;
        player.vx += dir * 5.4;
        player.x += dir * 0.22;
        c.xPos -= dir * 0.5;
        c.speed = Math.max(6, c.speed - 3);
        playSpeed = Math.max(10, playSpeed - 7);
        combo = 0; comboT = 0; overdrive = false;
        shakeAmp = Math.max(shakeAmp, 0.62);
        spawnBurst((player.x + c.xPos) / 2, 0.6, c.zPos, 16, SPARK_COLS, 4, 12, 2);
        audio.scrape(); audio.crash0();
        popup('SIDESWIPE!', 'big warn', 50, 32);
        try { if (navigator.vibrate) navigator.vibrate(70); } catch (_) {}
      } else if (!glancing) {
        doCrash(c);
        return;
      }
    }
    /* near miss: the moment the car passes the player */
    if (!c.passed && c.zPos > 2.4) {
      c.passed = true;
      if (dx < c.hw + PLAYER_HW + 1.35 && playSpeed > 30) {
        combo = (comboT > 0) ? combo + 1 : 1;
        comboT = 3.2;
        const pts = 50 * combo * (overdrive ? 2 : 1);
        score += pts;
        popup('NEAR MISS +' + pts, 'big cyan', 50, 34);
        audio.swish();
        if (combo >= 4 && !overdrive) {
          overdrive = true; overdriveT = 7;
          popup('OVERDRIVE ×2', 'big warn', 50, 24);
          audio.overdriveFx();
        }
      }
    }
  }
  if (state === 'play') {
    if (distance > nextTrafficDist) {
      spawnTraffic(-(Q.fogFar + 40 + rand(0, 120)));
      const density = Math.max(0.5, 1 - distance / 14000);
      nextTrafficDist = distance + rand(30, 55) * density;
    }
    if (distance > nextCoinDist) {
      spawnCoinRow(-(Q.fogFar + 20 + rand(0, 90)));
      nextCoinDist = distance + rand(95, 170);
    }
    if (distance > nextPickupDist) {
      spawnPickup(-(Q.fogFar + 30 + rand(0, 80)));
      nextPickupDist = distance + rand(380, 640);
    }
  }
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
}

function updateCoins(dt) {
  spinGlobal += dt * 3.2;
  for (let i = 0; i < COIN_N; i++) {
    const c = coinData[i];
    if (!c.on) { coinMesh.setMatrixAt(i, MAT_ZERO); continue; }
    const zPrev = c.z;
    c.z += playSpeed * dt;
    if (c.z > 16) { c.on = false; coinMesh.setMatrixAt(i, MAT_ZERO); continue; }
    /* swept pickup test: at high speed a coin could jump past the car in one frame */
    const passed = zPrev < 1.9 && c.z > -1.9;
    if (state === 'play' && passed && Math.abs(c.x - player.x) < 1.35) {
      c.on = false;
      coinMesh.setMatrixAt(i, MAT_ZERO);
      coinCount++; score += 25;
      spawnBurst(c.x, 1, c.z, 7, GOLD_COLS, 2, 6, 3);
      popupAt3D('+25', 'gold', c.x, 1.4, c.z);
      audio.coin();
      continue;
    }
    dummy.position.set(c.x, 0.85 + Math.sin(spinGlobal * 0.8 + c.phase) * 0.12, c.z);
    dummy.rotation.set(0, spinGlobal + c.phase, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    coinMesh.setMatrixAt(i, dummy.matrix);
  }
  coinMesh.instanceMatrix.needsUpdate = true;
}

function updatePickups(dt) {
  for (const p of pickups) {
    if (!p.on) continue;
    const zPrev = p.z;
    p.z += playSpeed * dt;
    if (p.z > 16) { p.on = false; p.g.visible = false; continue; }
    p.g.position.set(p.x, 0.15 + Math.sin(spinGlobal + p.x) * 0.1, p.z);
    p.g.rotation.y += dt * 2.4;
    if (state === 'play' && zPrev < 2 && p.z > -2 && Math.abs(p.x - player.x) < 1.4) {
      p.on = false; p.g.visible = false;
      nitroTank = Math.min(100, nitroTank + 45);
      spawnBurst(p.x, 1, p.z, 14, CYAN_COLS, 3, 8, 4);
      popupAt3D('NITRO +45', 'cyan', p.x, 1.6, p.z);
      audio.pickup();
    }
  }
}

function clearParticles() {
  for (let i = 0; i < P_N; i++) { pData[i].on = false; partMesh.setMatrixAt(i, MAT_ZERO); }
  partMesh.instanceMatrix.needsUpdate = true;
}
function updateParticles(dt) {
  let any = false;
  for (let i = 0; i < P_N; i++) {
    const p = pData[i];
    if (!p.on) continue;
    any = true;
    p.life += dt;
    if (p.life >= p.max) { p.on = false; partMesh.setMatrixAt(i, MAT_ZERO); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += (p.vz + playSpeed) * dt;
    p.vy -= 17 * dt;
    if (p.y < 0.08) { p.y = 0.08; p.vy *= -0.42; p.vx *= 0.8; p.vz *= 0.8; }
    const s = p.s * (1 - p.life / p.max);
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.life * 7, p.life * 9, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    partMesh.setMatrixAt(i, dummy.matrix);
  }
  if (any) partMesh.instanceMatrix.needsUpdate = true;
}

function updateSpeedLines(dt) {
  const kmh = playSpeed * 3.6;
  /* subtler by day (they'd look like film scratches), stronger at night / on boost */
  const op = (clamp((kmh - 165) / 180, 0, 1) * 0.2 + nitroK * 0.22) * (0.45 + SKY.night * 0.55);
  slMat.opacity = state === 'play' || state === 'crash' ? op : 0;
  slGroup.visible = slMat.opacity > 0.02;
  if (!slGroup.visible) return;
  for (const m of speedLines) {
    m.position.z += playSpeed * 2.6 * dt;
    if (m.position.z > 8) resetSpeedLine(m, false);
  }
}

function updatePlayer(dt, rdt) {
  if (state === 'play') {
    const nitroActive = input.nitro && nitroTank > 0;
    const braking = input.brake && !nitroActive;
    if (nitroActive) {
      nitroTank = Math.max(0, nitroTank - 27 * dt);
      if (nitroK < 0.1) audio.nitroFx();
    } else {
      nitroTank = Math.min(100, nitroTank + 1.9 * dt); // slow passive regen
    }
    nitroK = damp(nitroK, nitroActive ? 1 : 0, 6, dt);

    /* ---- longitudinal vehicle physics: engine torque vs drag & rolling resistance ---- */
    const vMax = 76 + Math.min(distance * 0.0008, 8);          // ~275-300 km/h terminal
    const engineForce = (1 - Math.pow(playSpeed / (vMax + nitroK * 32), 2.1)) * 22;
    const drag = 0.0062 * playSpeed * playSpeed;                // quadratic aero drag
    const roll = 0.42 * playSpeed;                              // rolling resistance
    const brakeF = braking ? 30 + playSpeed * 0.42 : 0;
    const accelF = Math.max(0, engineForce) * (1 + nitroK * 1.5) * 1.35 - drag * 0.16 - roll * 0.05 - brakeF;
    playSpeed = clamp(playSpeed + accelF * dt, 6, vMax + nitroK * 34);
    /* gear simulation drives the engine note */
    const gearSpan = (vMax + 34) / 6;
    const gear = Math.min(5, Math.floor(playSpeed / gearSpan));
    if (gear !== player.gear) {
      if (gear > player.gear && state === 'play') { audio.gearShift(); shakeAmp = Math.max(shakeAmp, 0.07); }
      player.gear = gear;
    }
    player.rpm = (playSpeed - gear * gearSpan) / gearSpan;      // 0..1 within gear
    if (playSpeed > topSpeed) topSpeed = playSpeed;
    score += playSpeed * dt * 1.25 * (1 + nitroK * 0.5) * (overdrive ? 2 : 1);
    /* brake feedback */
    player.tailMat.emissiveIntensity = braking ? 4.2 : 1.4 + SKY.night * 1.3;
    if (braking) player.tailGlowMat.opacity = 0.75;
    if (braking && playSpeed > 32 && scrapeCd <= 0) { scrapeCd = 0.34; audio.skid(); }
    /* overdrive timer */
    if (overdrive) { overdriveT -= dt; if (overdriveT <= 0) overdrive = false; }
    /* distance milestones */
    if (distance >= nextMilestone) {
      score += 500;
      popup((nextMilestone / 1000) + ' KM  +500', 'big gold', 50, 28);
      audio.pickup();
      nextMilestone += 1000;
    }

    const steerIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    /* steering rack slows at speed (like real rack + tyre load) */
    player.steer = damp(player.steer, steerIn, 6.5 + 5 / (1 + playSpeed * 0.03), dt);
    /* ---- lateral tyre model: steer force vs grip, with slip when overdriven ---- */
    const desiredVx = player.steer * (9.4 + playSpeed * 0.075);
    const grip = 26 * (braking ? 1.35 : 1);                     // braking loads the front tyres
    const slipLimit = 12.5;
    player.vx = damp(player.vx, desiredVx, grip / (1 + Math.abs(player.vx) * 0.16), dt);
    player.slip = clamp((Math.abs(player.vx) - slipLimit * 0.62) / slipLimit, 0, 1);
    if (player.slip > 0.35 && skidCd <= 0) {                    // tyres howl + smoke when sliding
      skidCd = 0.16;
      audio.skid();
      spawnBurst(player.x - Math.sign(player.vx) * 0.85, 0.16, 1.7, 2, SMOKE_COLS, 0.6, 2.2, 0.8);
      layMark(player.x, 1.6);                                    // leave rubber on the road
    }
    if (skidCd > 0) skidCd -= dt;
    if (sideSwipeCd > 0) sideSwipeCd -= dt;
    /* ---- DRIFT SCORING: hold a slide to bank points, land it for the payout ---- */
    if (player.slip > 0.3 && playSpeed > 30) {
      driftT += dt;
      driftBank += player.slip * playSpeed * dt * 2.2;
    } else if (driftT > 0) {
      if (driftT > 0.55 && driftBank > 40) {
        const pts = Math.round(driftBank) * (overdrive ? 2 : 1);
        score += pts;
        driftScore += pts;
        popup('DRIFT +' + fmtInt(pts), 'big cyan', 50, 40);
        audio.coin();
      }
      driftT = 0; driftBank = 0;
    }
    player.x += player.vx * dt;
    if (Math.abs(player.x) > EDGE_X) {
      player.x = clamp(player.x, -EDGE_X, EDGE_X);
      player.vx *= 0.5;
      if (scrapeCd <= 0 && Math.abs(player.steer) > 0.25) {
        scrapeCd = 0.25;
        spawnBurst(player.x + Math.sign(player.x) * 1.05, 0.5, 0.5, 6, SPARK_COLS, 2, 7, 2);
        audio.scrape();
        shakeAmp = Math.max(shakeAmp, 0.12);
      }
    }
    if (scrapeCd > 0) scrapeCd -= dt;
    player.g.position.x = player.x;
    player.g.position.z = 0;
    /* yaw = heading into the slide (counter-steer look) */
    player.g.rotation.y = damp(player.g.rotation.y, -player.vx * 0.021 - player.steer * 0.05, 9, dt);
    /* suspension + weight transfer: chassis moves over planted wheels */
    const accel = (playSpeed - player.prevSpeed) / Math.max(dt, 0.0001);
    player.prevSpeed = playSpeed;
    const pitchT = clamp(accel * 0.006, -0.06, 0.05) - (braking ? 0.045 : 0) + nitroK * 0.03;
    player.pitch = damp(player.pitch, pitchT, 6, dt);
    /* body roll follows real lateral acceleration, not just stick input */
    const latAccel = (player.vx - player.prevVx) / Math.max(dt, 0.0001);
    player.prevVx = player.vx;
    player.roll = damp(player.roll, clamp(-player.vx * 0.011 - latAccel * 0.0016, -0.2, 0.2), 7, dt);
    player.susPhase += dt * (7 + playSpeed * 0.4);
    const bump = Math.sin(player.susPhase) * 0.55 + Math.sin(player.susPhase * 2.63 + 1.7) * 0.45;
    player.body.position.y = bump * clamp(playSpeed - 14, 0, 70) * 0.00075;
    player.body.rotation.x = player.pitch + bump * 0.004;
    player.body.rotation.z = player.roll;
    player.body.rotation.y = -player.steer * 0.045;
    /* wheels: spin + front-wheel steering */
    const wRot = playSpeed / 0.36 * dt * (1 + player.slip * 0.5);
    player.wheels.forEach((w, i) => {
      w.rotation.x += wRot;
      if (i < 2) w.rotation.y = -player.steer * 0.34 - player.slip * Math.sign(player.vx) * 0.12;
    });
    /* flames */
    const fOn = nitroK > 0.08;
    player.flames.forEach(f => {
      f.visible = fOn;
      if (fOn) f.scale.set(1, 1, 0.7 + Math.random() * 0.9 + nitroK * 0.5);
    });
    /* taillight light-trails */
    const tLen = clamp(playSpeed * 0.045, 0, 4.2) + nitroK * 2.2;
    const tOp = SKY.night * 0.42 + nitroK * 0.3;
    player.trailMat.opacity = tOp;
    player.trails.forEach(t => {
      t.visible = tOp > 0.03;
      t.scale.z = tLen;
      t.position.z = 2.2 + tLen / 2;
    });
    player.glowMat.color.setHex(overdrive ? 0xff9a30 : 0x18d8ff);
  } else if (state === 'crash') {
    playSpeed = damp(playSpeed, 0, 3.2, dt);
    nitroK = damp(nitroK, 0, 8, dt);
    player.flames.forEach(f => f.visible = false);
    player.trailMat.opacity = 0;
    player.trails.forEach(t => t.visible = false);
    player.tailMat.emissiveIntensity = 1.4;
    player.g.rotation.x += player.rvx * dt;
    player.g.rotation.y += player.rvy * dt;
    player.g.rotation.z += player.rvz * dt;
    player.g.position.y += player.vy * dt;
    player.vy -= 20 * dt;
    if (player.g.position.y < 0) {
      player.g.position.y = 0;
      if (player.vy < -3) {
        spawnBurst(player.x, 0.4, 0, 10, SPARK_COLS, 3, 9, 3);
        shakeAmp = Math.max(shakeAmp, 0.3);
      }
      player.vy *= -0.35;
      player.rvx *= 0.55; player.rvy *= 0.55; player.rvz *= 0.55;
    }
    crashT += rdt;
    timeScale = damp(timeScale, 1, 1.6, rdt);
    if (crashT > 2.1) gameOver();
  } else if (state === 'menu') {
    playSpeed = damp(playSpeed, 20, 2, dt);
    player.trailMat.opacity = 0;
    player.trails.forEach(t => t.visible = false);
    player.body.rotation.x = damp(player.body.rotation.x, 0, 4, dt);
    player.body.rotation.z = damp(player.body.rotation.z, 0, 4, dt);
    player.body.position.y = Math.sin(performance.now() * 0.002) * 0.006;
    player.x = damp(player.x, Math.sin(performance.now() * 0.00022) * 3.0, 2, dt);
    player.g.position.x = player.x;
    player.g.rotation.z = 0; player.g.rotation.y = 0;
    const wRot = playSpeed / 0.36 * dt;
    player.wheels.forEach(w => { w.rotation.x += wRot; });
  } else { /* over */
    playSpeed = damp(playSpeed, 0, 3, dt);
  }
}

const camPos = new THREE.Vector3(0, 4.4, 9);
const camLook = new THREE.Vector3(0, 1, -12);
/* dedicated scratch vector — sharing projV with popupAt3D corrupted the camera
   target on any frame that spawned a popup, which showed up as a visual hitch */
const camTarget = new THREE.Vector3();
function updateCamera(rdt) {
  camW = damp(camW, state === 'menu' ? 0 : 1, 2.2, rdt);
  menuCamA += rdt * 0.1;
  /* MENU: slow cinematic dolly on the right side of the car, framed so the
     bottom-left UI never sits on top of it (a full orbit put the car behind
     the text half the time and read as a screensaver). */
  const sway = Math.sin(menuCamA) * 0.5;
  const ox = player.x + 5.2 + sway * 1.6;
  const oz = 6.4 + Math.cos(menuCamA * 0.8) * 1.1;
  const oh = 2.5 + Math.sin(menuCamA * 1.3) * 0.28;
  /* chase position */
  const cx = player.x * 0.55, cy = 3.95 + nitroK * 0.22, cz = 8.35 - nitroK * 0.55;
  camPos.set(lerp(ox, cx, camW), lerp(oh, cy, camW), lerp(oz, cz, camW));
  if (shakeAmp > 0.003) {
    camPos.x += rand(-1, 1) * shakeAmp * 0.35;
    camPos.y += rand(-1, 1) * shakeAmp * 0.28;
    shakeAmp *= Math.exp(-3.2 * rdt);
  }
  const rumble = Math.max(0, (playSpeed - 58) / 110) * 0.05 + nitroK * 0.045;
  if (rumble > 0.001 && state === 'play') {
    camPos.x += rand(-1, 1) * rumble;
    camPos.y += rand(-1, 1) * rumble * 0.7;
  }
  camera.position.lerp(camPos, 1 - Math.exp(-9 * rdt));
  /* menu look target: slightly ahead of the car so the shot has depth */
  const lx = lerp(player.x - 0.5, player.x * 0.82, camW);
  const ly = lerp(0.72, 1.0, camW);
  const lz = lerp(-3.5, -14, camW);
  camLook.lerp(camTarget.set(lx, ly, lz), 1 - Math.exp(-10 * rdt));
  camera.lookAt(camLook);
  camera.rotateZ(-player.steer * 0.028 * camW);
  const targetFov = state === 'menu' ? 42 : 64 + playSpeed * 0.17 + nitroK * 9;
  camera.fov = damp(camera.fov, clamp(targetFov, 50, 104), 5, rdt);
  camera.updateProjectionMatrix();
}

function updateHud() {
  const sc = Math.floor(score);
  if (sc !== lastHudScore) { lastHudScore = sc; dom.score.textContent = fmtInt(sc); dom.best.textContent = 'BEST ' + fmtInt(Math.max(best, sc)); }
  const sp = Math.round(playSpeed * 3.6);
  if (sp !== lastHudSpeed) { lastHudSpeed = sp; dom.speed.innerHTML = sp + ' <em>km/h</em>'; }
  if (coinCount !== lastHudCoins) { lastHudCoins = coinCount; dom.coins.innerHTML = '<span class="coinDot"></span>' + fmtInt(coinCount); }
  const cb = comboT > 0 && combo > 1 ? combo : 0;
  const comboTxt = overdrive ? 'OVERDRIVE ×2' + (cb ? ' · ×' + cb : '') : (cb ? 'COMBO ×' + cb : '');
  if (comboTxt !== lastHudComboTxt) {
    lastHudComboTxt = comboTxt;
    dom.combo.textContent = comboTxt;
    dom.combo.classList.toggle('od', overdrive);
  }
  dom.speed.classList.toggle('hot', sp >= 250 && player.slip < 0.3);
  dom.speed.classList.toggle('drift', player.slip > 0.3);
  if (dom.gear) {
    const gTxt = String(player.gear + 1);
    if (gTxt !== lastHudGear) { lastHudGear = gTxt; dom.gear.textContent = gTxt; }
  }
  dom.nitroFill.style.width = nitroTank.toFixed(0) + '%';
}

/* ---------------- FPS meter + dynamic resolution ---------------- */
function applyPixelRatio() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.px) * dynScale);
  composer.setPixelRatio(renderer.getPixelRatio());
}
let fpsShownAt = 0;
function updatePerf(rdt) {
  fpsEMA = lerp(fpsEMA, 1 / Math.max(rdt, 0.0001), 0.06);
  /* update the label ~4x/sec: writing DOM text every frame costs layout work */
  if (dom.fps && now0 - fpsShownAt > 250) {
    fpsShownAt = now0;
    dom.fps.textContent = Math.round(fpsEMA) + ' FPS';
  }
  if (fpsEMA < 50) { lowFpsT += rdt; highFpsT = 0; }
  else if (fpsEMA > 58) { highFpsT += rdt; lowFpsT = 0; }
  else { lowFpsT = 0; highFpsT = 0; }
  if (lowFpsT > 1.2) {                             // struggling → shed load fast
    lowFpsT = 0;
    if (dynScale > 0.55) { dynScale = Math.max(0.55, dynScale - 0.15); applyPixelRatio(); }
    else if (useBloom) { useBloom = false; }        // bloom is the next-biggest cost
    else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; sun.castShadow = false; }
  } else if (highFpsT > 5 && dynScale < 1) {       // healthy again: restore res
    dynScale = Math.min(1, dynScale + 0.15);
    applyPixelRatio(); highFpsT = 0;
  }
}

/* ---------------- main loop ---------------- */
let lastT = performance.now();
/* Frame-time smoothing: raw rAF deltas jitter (vsync beats, GC, compositor),
   and feeding that jitter straight into motion is what reads as "not smooth".
   We clamp outliers and blend toward a running average, so movement stays fluid
   even when a frame arrives late. */
let dtAvg = 1 / 60;
let frameErrors = 0;
/* fixed-timestep simulation */
const FIXED_DT = 1 / 120, MAX_STEPS = 8;
let accum = 0;
function simulate(h) {
  scrollWorld(h);
  updateTraffic(h);
  updateCoins(h);
  updatePickups(h);
  /* The accumulator holds *scaled* time, so one fixed slice of scaled time is
     h / timeScale of real time. updatePlayer needs the real value for the crash
     timer and slow-mo recovery, otherwise the wreck sequence stretches ~3x. */
  updatePlayer(h, h / Math.max(timeScale, 0.05));
}
function loop(now) {
  requestAnimationFrame(loop);
  let raw = (now - lastT) / 1000;
  lastT = now;
  if (paused || contextLost) return;
  now0 = now;
  if (!(raw > 0)) raw = dtAvg;
  raw = Math.min(raw, 0.1);                 // never simulate a huge jump
  dtAvg = dtAvg * 0.8 + raw * 0.2;          // running average
  /* if this frame is close to the average, use the average (kills micro-jitter) */
  const rdt = Math.abs(raw - dtAvg) < dtAvg * 0.35 ? dtAvg : Math.min(raw, 0.05);
  const dt = rdt * timeScale;

  /* One bad frame must never kill the game. Before this guard, a single thrown
     exception escaped the rAF callback and the whole thing froze on-screen with
     no way back. Now we log it once, skip the frame, and keep rendering. */
  try {
    updateAtmosphere(rdt);
    /* FIXED-TIMESTEP PHYSICS (120 Hz) with an accumulator.
       Variable-dt integration makes handling feel different at 30 vs 144 fps and
       lets a long frame overshoot; stepping a constant slice keeps the car's
       response identical on every device and is the single biggest contributor
       to the game feeling "tight" rather than floaty. */
    accum += dt;
    let steps = 0;
    while (accum >= FIXED_DT && steps < MAX_STEPS) {
      simulate(FIXED_DT);
      accum -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) accum = 0;      // fell too far behind: drop the debt
    /* visual-only systems run once per frame at the real delta */
    updateParticles(dt);
    updateMarks(dt);
    updateSpeedLines(dt);
    updateCamera(rdt);
    if (state === 'play') { Ghost.record(distance, player.x); Ghost.update(distance); }
    else if (Ghost.mesh && state !== 'crash') Ghost.mesh.visible = false;
    updateHud();
    updatePerf(rdt);
    audio.engineUpdate(playSpeed, nitroK, state === 'play' || state === 'crash', player.rpm);
  } catch (err) {
    frameErrors++;
    if (frameErrors <= 3) console.error('[nitro] frame error:', err);
    if (frameErrors === 12) {           // persistent: fail safe back to the menu
      try { enterMenu(); } catch (_) {}
    }
  }

  try {
    /* blur ramps in above ~170 km/h and surges on nitro / during a slide */
    const kmh = playSpeed * 3.6;
    const blur = clamp((kmh - 170) / 260, 0, 1) * 0.016
               + nitroK * 0.022
               + player.slip * 0.01;
    speedBlurPass.uniforms.uStrength.value = state === 'menu' ? 0 : blur;
    /* pull the streak centre toward where the car is heading */
    speedBlurPass.uniforms.uCenter.value.set(0.5 - player.x * 0.012, 0.52);
    bloomPass.enabled = useBloom;
    if (useBloom) bloomPass.strength = 0.26 + SKY.night * 0.16 + nitroK * 0.18;
    /* Always go through the composer: the grade/vignette pass is cheap and we
       want consistent colour on every quality level, not just when bloom is on. */
    composer.render();
  } catch (err) {
    /* composer/WebGL hiccup → fall back to a plain render rather than stop drawing */
    console.warn('[nitro] composer failed, falling back to direct render', err);
    useBloom = false;
    try { renderer.render(scene, camera); } catch (_) {}
  }

  if (!portalReady) {
    portalReady = true;
    Portal.ready();
    dom.loading.classList.add('off');
    setTimeout(() => { try { dom.loading.remove(); } catch (_) {} }, 600);
  }
}

/* ---------------- boot ---------------- */
/* QA / fun: force time of day via URL hash (#night, #sunset, #day, #dawn) */
if (location.hash === '#night') dayT = 0.7;
else if (location.hash === '#sunset') dayT = 0.5;
else if (location.hash === '#day') dayT = 0.25;
else if (location.hash === '#dawn') dayT = 0.02;
Portal.init();
refreshSegs();
enterMenu();
applyQuality();
requestAnimationFrame(loop);

})();
