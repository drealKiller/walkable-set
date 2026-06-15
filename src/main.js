import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadScene } from './scene.js';
import { CharacterController } from './character.js';
import { SectionManager, SECTIONS } from './sections.js';

// ── Renderer ──────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFShadowMap;
renderer.outputColorSpace    = THREE.SRGBColorSpace;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;

// ── Scene & Camera ────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog   = new THREE.Fog(0x8a9bb0, 40, 120);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000);
camera.position.set(0, 1.7, 0);

// ── HDRI Sky ──────────────────────────────────────────────────────────────────
const hdrLoader = new HDRLoader();
hdrLoader.load('/sky2.hdr', (texture) => {
  texture.mapping   = THREE.EquirectangularReflectionMapping;
  scene.background  = texture;
  scene.environment = texture;
});

// ── Lighting ──────────────────────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near   = 0.1;
dirLight.shadow.camera.far    = 50;
dirLight.shadow.camera.left   = -15;
dirLight.shadow.camera.right  = 15;
dirLight.shadow.camera.top    = 15;
dirLight.shadow.camera.bottom = -15;
scene.add(dirLight);

// ── Post Processing ───────────────────────────────────────────────────────────
// Every knob lives in POST so the look is trivial to tune. The whole chain can be
// toggled at runtime with the FX button (or the P key) — see `postEnabled`.
const POST = {
  bloomStrength:  0.05,   // glow intensity on bright highlights
  bloomRadius:    0.60,
  bloomThreshold: 0.85,   // only HDR luminance above this blooms
  saturation:     1.10,   // 1 = neutral
  contrast:       1.05,   // 1 = neutral (gentle, around linear mid-grey)
  vignette:       0.10,   // 0 = none → larger = darker corners
};

const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());

// 1 — Base scene render (linear HDR)
composer.addPass(new RenderPass(scene, camera));

// 2 — Bloom: soft glow on bright highlights only, before tone mapping
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  POST.bloomStrength, POST.bloomRadius, POST.bloomThreshold
);
composer.addPass(bloom);

// 3 — Colour grade + vignette: gentle and tasteful (no cheap film grain / heavy vignette)
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse:   { value: null },
    saturation: { value: POST.saturation },
    contrast:   { value: POST.contrast },
    vignette:   { value: POST.vignette },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // Saturation, around perceptual luma
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(luma), c.rgb, saturation);

      // Gentle contrast around linear mid-grey so highlights don't blow out
      c.rgb = (c.rgb - 0.18) * contrast + 0.18;

      // Soft vignette
      vec2 q = vUv * (1.0 - vUv.yx);
      float vig = pow(q.x * q.y * 15.0, vignette);
      c.rgb *= clamp(vig, 0.0, 1.0);

      gl_FragColor = c;
    }`
});
composer.addPass(gradePass);

// 4 — SMAA: higher-quality anti-aliasing than FXAA
composer.addPass(new SMAAPass());

// 5 — OutputPass: ACES tone mapping + sRGB encode — always last
composer.addPass(new OutputPass());

// Whole-chain on/off. When off we render straight to screen (renderer keeps its
// own ACES tone mapping + sRGB, so the image stays consistent — just without FX).
let postEnabled = true;

// ── Loading UI ────────────────────────────────────────────────────────────────
const loadingScreen = document.getElementById('loading-screen');
const loadingBar    = document.getElementById('loading-bar');
const loadingLabel  = document.getElementById('loading-label');

function setProgress(pct, label) {
  loadingBar.style.width = `${pct}%`;
  if (label) loadingLabel.textContent = label;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
let character;
let sectionManager;

async function init() {
  setProgress(6, 'Loading grounds...');

  const { boothScene, colliderMeshes } = await loadScene(renderer, (pct) => {
    setProgress(pct, pct < 60 ? 'Loading grounds...' : 'Loading colliders...');
  });
  scene.add(boothScene);

  setProgress(80, 'Loading character...');

  character = new CharacterController(scene, camera, renderer, colliderMeshes);
  await character.load((pct) => setProgress(pct, 'Loading character...'));

  setProgress(100, 'Welcome.');

  sectionManager = new SectionManager(
    (key, isTeleport) => {
      if (isTeleport !== false) {
        const sec = SECTIONS[key];
        character.teleportTo(sec.spawnPoint);
      }
    },
    () => {}
  );

  setTimeout(() => {
    loadingScreen.classList.add('hidden');
  }, 1000);

  requestAnimationFrame(animate);
}

// ── View Toggle ───────────────────────────────────────────────────────────────
document.getElementById('btn-fpv').addEventListener('click', () => {
  if (!character) return;
  character.setFPV(true);
  document.getElementById('btn-fpv').classList.add('active');
  document.getElementById('btn-tpv').classList.remove('active');
});
document.getElementById('btn-tpv').addEventListener('click', () => {
  if (!character) return;
  character.setFPV(false);
  document.getElementById('btn-fpv').classList.remove('active');
  document.getElementById('btn-tpv').classList.add('active');
});

// ── Post-processing Toggle (FX button + P key) ──────────────────────────────────
const btnFx = document.getElementById('btn-fx');
function setPost(on) {
  postEnabled = on;
  btnFx.classList.toggle('active', on);
}
btnFx.addEventListener('click', (e) => { e.stopPropagation(); setPost(!postEnabled); });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyP') setPost(!postEnabled); });

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);   // resizes bloom + SMAA internally
});

// ── Animate ───────────────────────────────────────────────────────────────────
const timer = new THREE.Timer();

function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.05);

  if (character) {
    const pos = character.update(delta);
    if (pos && sectionManager) sectionManager.update(pos);

    // Shadow camera follows player
    dirLight.position.set(pos.x + 5, pos.y + 10, pos.z + 5);
    dirLight.target.position.set(pos.x, pos.y, pos.z);
    dirLight.target.updateMatrixWorld();
  }

  if (postEnabled) composer.render();
  else             renderer.render(scene, camera);
}

// ── Go ────────────────────────────────────────────────────────────────────────
init().catch(console.error);