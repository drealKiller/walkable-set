import * as THREE from 'three';
import { loadScene } from './scene.js';
import { CharacterController } from './character.js';
import { SectionManager, SECTIONS } from './sections.js';

// ── Renderer ─────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.outputColorSpace  = THREE.SRGBColorSpace;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ── Scene & Camera ────────────────────────────────────────────────────────────
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x0a1520);
scene.fog        = new THREE.Fog(0x0a1520, 20, 60);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0, 1.7, 0);

// ── Lighting ──────────────────────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.1;
dirLight.shadow.camera.far  = 50;
dirLight.shadow.camera.left = -15;
dirLight.shadow.camera.right = 15;
dirLight.shadow.camera.top   = 15;
dirLight.shadow.camera.bottom = -15;
scene.add(dirLight);

// Accent fill — cool blue tint matching booth aesthetic
const fillLight = new THREE.PointLight(0x00e5ff, 0.4, 30);
fillLight.position.set(-5, 3, 0);
scene.add(fillLight);

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
  setProgress(10, 'Loading booth...');

  // 1. Load booth + colliders
  const { boothScene, colliderMeshes } = await loadScene(renderer, (pct) => {
    setProgress(pct, pct < 60 ? 'Loading booth...' : 'Loading colliders...');
  });
  scene.add(boothScene);

  setProgress(80, 'Loading character...');

  // 2. Load character
  character = new CharacterController(scene, camera, renderer, colliderMeshes);
  await character.load((pct) => setProgress(pct, 'Loading character...'));

  setProgress(100, 'Ready!');

  // 3. Section manager
  sectionManager = new SectionManager(
    (key, isTeleport) => {
      if (isTeleport !== false) {
        // Jump list button clicked → teleport
        const sec = SECTIONS[key];
        character.teleportTo(sec.spawnPoint);
      }
    },
    () => {}
  );

  // 4. Hide loading screen
  setTimeout(() => {
    loadingScreen.classList.add('hidden');
  }, 400);

  // 5. Start loop
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
});

// ── Animate ───────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05); // cap delta to avoid huge jumps

  if (character) {
    const pos = character.update(delta);
    if (pos && sectionManager) sectionManager.update(pos);
  }

  renderer.render(scene, camera);
}

// ── Go ────────────────────────────────────────────────────────────────────────
init().catch(console.error);