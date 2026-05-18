import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
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
renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
renderer.outputColorSpace    = THREE.SRGBColorSpace;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;

// ── Scene & Camera ────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog   = new THREE.Fog(0x8a9bb0, 40, 120);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000);
camera.position.set(0, 1.7, 0);

// ── HDRI Sky ──────────────────────────────────────────────────────────────────
const rgbeLoader = new RGBELoader();
rgbeLoader.load('/sky2.hdr', (texture) => {
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
const composer = new EffectComposer(renderer);

// 1 — Base scene render
composer.addPass(new RenderPass(scene, camera));

// 2 — Bloom: glow on moderately bright surfaces (gold trims, emissives, sky)
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.15,  // strength
  0.15,   // radius
  5   // threshold — fires on moderately bright surfaces (was 12, essentially off)
);
composer.addPass(bloom);

// 3 — FXAA: fast anti-aliasing, applied after bloom
const fxaa = new ShaderPass(FXAAShader);
fxaa.uniforms['resolution'].value.set(
  1 / window.innerWidth,
  1 / window.innerHeight
);
composer.addPass(fxaa);

// 4 — Film grain: subtle cinematic texture (keep noise low or it looks cheap)
const film = new FilmPass(
  0.18,  // noise intensity
  false  // grayscale: false = colour noise
);
composer.addPass(film);

// 5 — Vignette + colour grade: custom ShaderPass
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse:   { value: null },
    vignette:   { value: 0.55 },  // 0 = none, 1 = heavy
    saturation: { value: 1.15 },  // 1 = neutral
    contrast:   { value: 1.06 },
    brightness: { value: 0.0 },   // additive lift
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // Saturation
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(lum), c.rgb, saturation);

      // Contrast + brightness
      c.rgb = (c.rgb - 0.5) * contrast + 0.5 + brightness;

      // Vignette
      vec2 uv2 = vUv * (1.0 - vUv.yx);
      float vig = pow(uv2.x * uv2.y * 15.0, vignette);
      c.rgb *= clamp(vig, 0.0, 1.0);

      gl_FragColor = c;
    }`
});
composer.addPass(gradePass);

// 6 — OutputPass: colour space conversion — always last
composer.addPass(new OutputPass());

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

// ── Background Music ──────────────────────────────────────────────────────────
const audio = new Audio('/Lucky Dube - reggae strong.mp3');
audio.loop   = true;
audio.volume = 0.4;
audio.play().catch(() => {
  // Browser blocks autoplay until user interacts — start on first click
  document.addEventListener('click', () => audio.play(), { once: true });
});

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
  }, 3500);

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

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
  fxaa.uniforms['resolution'].value.set(
    1 / window.innerWidth,
    1 / window.innerHeight
  );
});

// ── Animate ───────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (character) {
    const pos = character.update(delta);
    if (pos && sectionManager) sectionManager.update(pos);

    // Temporary — log position every 2 seconds
    if (!window._lastLog || Date.now() - window._lastLog > 2000) {
      const pos = character.getPosition();
      console.log(`Position: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`);
      window._lastLog = Date.now();
    }

    // Shadow camera follows player
    dirLight.position.set(pos.x + 5, pos.y + 10, pos.z + 5);
    dirLight.target.position.set(pos.x, pos.y, pos.z);
    dirLight.target.updateMatrixWorld();
  }

  composer.render();
}

// ── Go ────────────────────────────────────────────────────────────────────────
init().catch(console.error);