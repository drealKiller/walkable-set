import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const WALK_SPEED    = 2.0;
const RUN_SPEED     = 4.5;
const GRAVITY       = -12;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.3;
const RAY_LENGTH    = PLAYER_RADIUS + 0.05;

export class CharacterController {
  constructor(scene, camera, renderer, colliderMeshes) {
    this.scene          = scene;
    this.camera         = camera;
    this.renderer       = renderer;
    this.colliderMeshes = colliderMeshes;

    this.mixer         = null;
    this.model         = null;
    this.namedActions  = {};
    this.currentAction = null;

    this.velocity  = new THREE.Vector3();
    this.yaw       = 0;   // character + camera facing direction
    this.pitch     = 0;   // FPV vertical look
    this.isFPV     = false;
    this.freeLook  = false; // C key toggle
    this.isLoaded  = false;
    this.keys      = {};

    this.collisionEnabled = false;
    setTimeout(() => { this.collisionEnabled = true; }, 1500);

    this.raycaster = new THREE.Raycaster();

    // OrbitControls — used in free look mode (both FPV and TPV)
    this.orbit = new OrbitControls(camera, renderer.domElement);
    this.orbit.enableDamping      = true;
    this.orbit.dampingFactor      = 0.08;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance        = 0.5;
    this.orbit.maxDistance        = 20;
    this.orbit.maxPolarAngle      = Math.PI / 1.6;
    this.orbit.enabled            = false; // off by default

    this._pointerLocked = false;
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = !!document.pointerLockElement;
    });

    this._setupInput();
  }

  // ── Load ──────────────────────────────────────────────────────────────
  load(onProgress) {
    return new Promise((resolve) => {
      const loader = new GLTFLoader();
      loader.load(
        '/models/character.glb',
        (gltf) => {
          this.model = gltf.scene;
          this.model.traverse((child) => {
            if (child.isMesh) child.castShadow = true;
          });

          this.model.position.set(0, 0, 0);
          this.scene.add(this.model);

          // Animations
          this.mixer = new THREE.AnimationMixer(this.model);
          console.log('[Character] Clips:', gltf.animations.map(c => c.name));

          const find = (keywords) => {
            for (const kw of keywords) {
              const clip = gltf.animations.find(c => c.name.toLowerCase().includes(kw));
              if (clip) return this.mixer.clipAction(clip);
            }
            return gltf.animations.length ? this.mixer.clipAction(gltf.animations[0]) : null;
          };

          this.namedActions = {
            idle: find(['idle', 'stand', 'breathing', 'survey']),
            walk: find(['walk']),
            run:  find(['run', 'jog', 'sprint']),
          };

          this._playNamed('idle');

         // TPV: show mesh, set camera behind character
          this.model.traverse(c => { if (c.isMesh) c.visible = true; });
          this.yaw = 0; this.pitch = 0;
          this._applyLockedCamera();

          this.isLoaded = true;
          onProgress(100);
          resolve();
        },
        (xhr) => {
          if (xhr.total) onProgress(80 + (xhr.loaded / xhr.total) * 18);
        }
      );
    });
  }

  // ── Input ─────────────────────────────────────────────────────────────
  _setupInput() {
   window.addEventListener('keydown', (e) => {
  this.keys[e.code] = true;

  // C — toggle free look
  if (e.code === 'KeyC') {
    this.freeLook = !this.freeLook;
    this._applyFreeLookState();
  }

  // V — toggle FPV / TPV
  if (e.code === 'KeyV') {
    const toFPV = !this.isFPV;
    this.setFPV(toFPV);
    document.getElementById('btn-fpv').classList.toggle('active', toFPV);
    document.getElementById('btn-tpv').classList.toggle('active', !toFPV);
  }
});

    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Click canvas to lock pointer (locked camera mode only)
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.freeLook && !this._pointerLocked) {
        this.renderer.domElement.requestPointerLock();
      }
    });

    // Mouse look — only in locked camera mode
    document.addEventListener('mousemove', (e) => {
      if (this.freeLook || !this._pointerLocked) return;
      this.yaw   -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch));
    });
  }

  // ── Apply free look state ─────────────────────────────────────────────
  _applyFreeLookState() {
    if (this.freeLook) {
      // Enter free look — release pointer lock, enable orbit
      if (document.pointerLockElement) document.exitPointerLock();
      this.orbit.enabled = true;
      // Always show character in free look so you can orbit around it
      if (this.model) {
        this.model.traverse(c => { if (c.isMesh) c.visible = true; });
      }
      // Point orbit at character
      if (this.model) {
        const target = this.model.position.clone().add(new THREE.Vector3(0, 1, 0));
        this.orbit.target.copy(target);
        // In FPV, pull camera back so you can see the character
        if (this.isFPV) {
          this.camera.position.set(
            this.model.position.x - Math.sin(this.yaw) * 4,
            this.model.position.y + 2,
            this.model.position.z - Math.cos(this.yaw) * 4
          );
        }
        this.orbit.update();
      }
    } else {
      // Exit free look — re-lock camera
      this.orbit.enabled = false;
      // In FPV hide the mesh again
      if (this.isFPV && this.model) {
        this.model.traverse(c => { if (c.isMesh) c.visible = false; });
      }
      // Re-lock pointer
      this.renderer.domElement.requestPointerLock();
    }
  }

  // ── View toggle (FPV / TPV buttons) ───────────────────────────────────
  setFPV(val) {
  this.isFPV = val;
  if (this.model) {
    const showMesh = !val || this.freeLook;
    this.model.traverse(c => { if (c.isMesh) c.visible = showMesh; });
  }
  if (!this.freeLook) {
    if (val) this.yaw += Math.PI; // flip to face forward when entering FPV
    this._applyLockedCamera();
    if (!this._pointerLocked) this.renderer.domElement.requestPointerLock();
  }
}

  // ── Teleport ──────────────────────────────────────────────────────────
  teleportTo(pos) {
    if (!this.model) return;
    this.model.position.set(pos.x, pos.y, pos.z);
    this.velocity.set(0, 0, 0);
    this.collisionEnabled = false;
    setTimeout(() => { this.collisionEnabled = true; }, 800);
    if (this.freeLook) {
      this.orbit.target.copy(this.model.position.clone().add(new THREE.Vector3(0, 1, 0)));
      this.orbit.update();
    }
  }

  // ── Collision ─────────────────────────────────────────────────────────
  _wouldCollide(moveDir) {
    if (!this.collisionEnabled || !this.colliderMeshes.length || moveDir.lengthSq() === 0) return false;
    const origin = this.model.position.clone();
    origin.y += PLAYER_HEIGHT * 0.5;
    const dir = moveDir.clone().normalize();
    this.raycaster.set(origin, dir);
    this.raycaster.far = RAY_LENGTH;
    if (this.raycaster.intersectObjects(this.colliderMeshes, true).length > 0) return true;
    for (const angle of [-0.4, 0.4]) {
      const sideDir = dir.clone().applyEuler(new THREE.Euler(0, angle, 0));
      this.raycaster.set(origin, sideDir);
      this.raycaster.far = RAY_LENGTH * 0.8;
      if (this.raycaster.intersectObjects(this.colliderMeshes, true).length > 0) return true;
    }
    return false;
  }

  // ── Locked camera (default — follows character) ───────────────────────
  _applyLockedCamera() {
    if (!this.model) return;
    if (this.isFPV) {
      // Head height, facing yaw+pitch direction
      const head = this.model.position.clone();
      head.y += PLAYER_HEIGHT;
      this.camera.position.copy(head);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    } else {
      // Float behind and above character
      const offset = new THREE.Vector3(
        -Math.sin(this.yaw) * 5,
        2.5,
        -Math.cos(this.yaw) * 5
      );
      const target = this.model.position.clone().add(new THREE.Vector3(0, 1, 0));
      this.camera.position.copy(this.model.position.clone().add(offset));
      this.camera.lookAt(target);
    }
  }

  // ── Animations ────────────────────────────────────────────────────────
  _playNamed(name) {
    const next = this.namedActions[name];
    if (!next || next === this.currentAction) return;
    if (this.currentAction) this.currentAction.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    this.currentAction = next;
  }

  // ── Movement ──────────────────────────────────────────────────────────
  _applyMovement(delta) {
    const isRunning = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed     = isRunning ? RUN_SPEED : WALK_SPEED;

    // In free look mode, yaw comes from the orbit camera's azimuth
    // so movement stays relative to where you're looking
    let yaw = this.yaw;
    if (this.freeLook) {
      // Derive yaw from orbit camera's position relative to character
      const dir = this.camera.position.clone().sub(this.model.position);
      yaw = Math.atan2(dir.x, dir.z) + Math.PI;
    }

   const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));

    
    const moveDir = new THREE.Vector3();
    if (this.isFPV) {
      if (this.keys['KeyW'] || this.keys['ArrowUp'])    moveDir.add(forward);
      if (this.keys['KeyS'] || this.keys['ArrowDown'])  moveDir.sub(forward);
      if (this.keys['KeyA'] || this.keys['ArrowLeft'])  moveDir.sub(right);
      if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.add(right);
} else {
  
      if (this.keys['KeyS'] || this.keys['ArrowDown'])    moveDir.add(forward);
      if (this.keys['KeyW'] || this.keys['ArrowUp'])  moveDir.sub(forward);
      if (this.keys['KeyD'] || this.keys['ArrowRight'])  moveDir.sub(right);
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir.add(right);
}

    const isMoving = moveDir.lengthSq() > 0;

    // Ground detection — raycast downward to follow slopes and stairs
const groundOrigin = this.model.position.clone();
groundOrigin.y += 1; // start ray slightly above feet
this.raycaster.set(groundOrigin, new THREE.Vector3(0, -1, 0));
this.raycaster.far = 2.5;
const groundHits = this.raycaster.intersectObjects(this.colliderMeshes, true);

if (groundHits.length > 0) {
  const groundY = groundHits[0].point.y;
  if (this.model.position.y < groundY) {
    // Snap up to ground (climbing slope/stair)
    this.model.position.y = groundY;
    this.velocity.y = 0;
  } else {
    // Apply gravity when airborne
    this.velocity.y += GRAVITY * delta;
    this.model.position.y += this.velocity.y * delta;
    if (this.model.position.y < groundY) {
      this.model.position.y = groundY;
      this.velocity.y = 0;
    }
  }
} else {
  // No ground detected — fall with gravity, floor clamp at Y=0
  this.velocity.y += GRAVITY * delta;
  this.model.position.y += this.velocity.y * delta;
  if (this.model.position.y < 0) {
    this.model.position.y = 0;
    this.velocity.y = 0;
  }
}

    // Horizontal movement + collision sliding
    if (isMoving) {
      moveDir.normalize();
      if (!this._wouldCollide(moveDir)) {
        this.model.position.addScaledVector(moveDir, speed * delta);
      } else {
        const moveX = new THREE.Vector3(moveDir.x, 0, 0);
        const moveZ = new THREE.Vector3(0, 0, moveDir.z);
        if (moveX.lengthSq() > 0 && !this._wouldCollide(moveX)) {
          this.model.position.addScaledVector(moveX.normalize(), speed * delta);
        } else if (moveZ.lengthSq() > 0 && !this._wouldCollide(moveZ)) {
          this.model.position.addScaledVector(moveZ.normalize(), speed * delta);
        }
      }
      this.model.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    this._playNamed(isMoving ? (isRunning ? 'run' : 'walk') : 'idle');
    return isMoving;
  }

  // ── Update ────────────────────────────────────────────────────────────
  update(delta) {
    if (!this.isLoaded) return;
    this.mixer.update(delta);

    this._applyMovement(delta);

    if (this.freeLook) {
      // Free look: orbit handles camera, but target follows character
      const target = this.model.position.clone().add(new THREE.Vector3(0, 1, 0));
      this.orbit.target.lerp(target, 0.1);
      this.orbit.update();
    } else {
      // Locked: camera snaps to character
      this._applyLockedCamera();
    }

    return this.model.position;
  }

  getPosition() {
    return this.model ? this.model.position : new THREE.Vector3();
  }
}