import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function loadScene(renderer, onProgress) {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    // colliderMeshes: array of actual Mesh objects for precise raycast collision
    const colliderMeshes = [];
    let boothScene    = null;
    let colliderScene = null;

    let boothDone     = false;
    let collidersDone = false;

    function checkDone() {
      if (!boothDone || !collidersDone) return;
      // Parent the colliders to the booth now that BOTH are loaded — order-independent,
      // so collision never silently vanishes when colliders win the load race.
      if (colliderScene && boothScene) {
        boothScene.add(colliderScene);
        boothScene.updateMatrixWorld(true);  // bake world matrices for raycasting
      }
      resolve({ boothScene, colliderMeshes });
    }

    // Load booth visual
    loader.load(
      '/models/booth.glb',
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
        colliderScene = gltf.scene;
        colliderScene.updateMatrixWorld(true);
        colliderScene.traverse((child) => {
          if (child.isMesh) {
            // Hidden from every render pass (incl. the GTAO AO GBuffer) but still
            // raycastable — three's Raycaster ignores `.visible`, so ground/wall
            // collision rays against these meshes keep working.
            child.material = new THREE.MeshBasicMaterial({ visible: false });
            child.visible = false;
            colliderMeshes.push(child);
          }
        });
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