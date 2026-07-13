import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// Shared decoders — created once and reused across every GLTF load. The Draco
// decoder and Basis/KTX2 transcoder binaries are served from public/ (so they
// resolve at /draco/ and /basis/ in both dev and the production build).
let dracoLoader = null;
let ktx2Loader  = null;

/**
 * Build a GLTFLoader wired for Draco-compressed geometry (KHR_draco_mesh_compression)
 * and KTX2/Basis-compressed textures (KHR_texture_basisu). Uncompressed glTF still
 * loads normally — the decoders only engage when the model actually uses them.
 *
 * @param {THREE.WebGLRenderer} renderer  required by KTX2Loader to detect GPU texture support
 */
export function createGLTFLoader(renderer) {
  const loader = new GLTFLoader();

  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');     // public/draco/  (wasm + js fallback)
  }
  loader.setDRACOLoader(dracoLoader);

  if (!ktx2Loader) {
    ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath('/basis/');   // public/basis/  (basis_transcoder.*)
  }
  ktx2Loader.detectSupport(renderer);
  loader.setKTX2Loader(ktx2Loader);

  return loader;
}
