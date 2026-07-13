import * as THREE from 'three';
import { createGLTFLoader } from './loaders.js';

export function loadScene(renderer, onProgress) {
  return new Promise((resolve) => {
    const loader = createGLTFLoader(renderer);   // Draco + KTX2 enabled
    // On touch devices load the lighter booth (1024px textures) to cut GPU memory.
    const isMobile = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window) || /[?&]mobile\b/.test(location.search);
    const boothURL = isMobile ? '/models/booth.mobile.glb' : '/models/booth.glb';
    // colliderMeshes: array of actual Mesh objects for precise raycast collision
    const colliderMeshes = [];
    let boothScene = null;

    let boothDone     = false;
    let collidersDone = false;

    function checkDone() {
      if (boothDone && collidersDone) resolve({ boothScene, colliderMeshes });
    }

    // Load booth visual
    loader.load(
      boothURL,
      (gltf) => {
        boothScene = gltf.scene;
        boothScene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow    = true;
            child.receiveShadow = true;
          }
        });
        onProgress(50);
        boothDone = true;
        checkDone();
      },
      (xhr) => {
        if (xhr.total) onProgress((xhr.loaded / xhr.total) * 40);
      }
    );

    // Load colliders — use real meshes so raycasting respects actual geometry
    loader.load(
      '/models/colliders.glb',
      (gltf) => {
        const colScene = gltf.scene;
        colScene.updateMatrixWorld(true);
        colScene.traverse((child) => {
          if (child.isMesh) {
            // Invisible but present for raycasting
            child.material = new THREE.MeshBasicMaterial({ visible: false });
            colliderMeshes.push(child);
          }
        });
        // Parent to boothScene so world matrices stay correct
        if (boothScene) boothScene.add(colScene);
        onProgress(80);
        collidersDone = true;
        checkDone();
      },
      undefined,
      (err) => {
        console.warn('No colliders.glb found, continuing without collision:', err);
        collidersDone = true;
        checkDone();
      }
    );
  });
}