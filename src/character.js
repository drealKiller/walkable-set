import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Tuning ──────────────────────────────────────────────────────────────────
const WALK_SPEED    = 2.0;
const RUN_SPEED     = 4.5;
const GRAVITY       = -14;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.3;

// Ground / steps
const STEP_HEIGHT         = 0.5;  // max height the player auto-climbs (curbs, stairs)
const GROUND_PROBE        = 2.0;  // how far below the feet we still look for ground to fall toward
const SLOPE_MIN_NORMAL_Y  = 0.4;  // a surface counts as floor only if its up-normal exceeds this (~66° max slope)

// Horizontal collision is sampled as a vertical capsule of rays at these heights (relative to
// feet). The lowest ray sits ABOVE STEP_HEIGHT so climbable steps/curbs aren't read as walls —
// they pass the horizontal check and get lifted by the ground-snap instead.
const RAY_HEIGHTS = [STEP_HEIGHT + 0.1, 1.0, 1.5];

// Third-person camera
const TPV_DIST       = 5;
const TPV_LOOK_HEIGHT = 1.2;
const TPV_MIN_DIST   = 0.8;   // never pull the camera closer than this on occlusion
const TPV_PITCH_MIN  = -0.35;
const TPV_PITCH_MAX  = 0.9;

// First-person camera
const FPV_EYE_HEIGHT = PLAYER_HEIGHT * 0.92;

// Smoothing rates (per second) — used as 1 - exp(-k·dt) so they're frame-rate independent
const CAM_K    = 9;    // TPV camera position follow
const LOOK_K   = 14;   // camera aim follow
const TURN_K   = 12;   // character turn toward move direction
const ACCEL_K  = 18;   // horizontal velocity ease (mild inertia)
const GROUND_K = 16;   // vertical settle onto ground / stairs

const MOUSE_SENS = 0.0022;
const DOWN = new THREE.Vector3(0, -1, 0);

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

    this.velocity  = new THREE.Vector3();  // vertical only (y)
    this.yaw       = 0;   // camera/look azimuth (mouse-driven in locked mode)
    this.pitch     = 0;   // vertical look
    this.isFPV     = true;   // first-person is the default view
    this.freeLook  = false;
    this.isLoaded  = false;
    this.keys      = {};

    this.grounded      = false;
    this.lastGroundY   = undefined;   // last valid floor height, used as a fall-safety
    this._targetYaw    = 0;           // heading the model eases toward
    this._snap         = true;        // when true, the camera jumps instead of damping (boot / teleport / view switch)

    this.collisionEnabled = true;

    this.raycaster = new THREE.Raycaster();

    // ── Reusable scratch objects — the per-frame hot path allocates nothing ──
    this._fwd        = new THREE.Vector3();
    this._right      = new THREE.Vector3();
    this._moveDir    = new THREE.Vector3();
    this._targetVel  = new THREE.Vector3();
    this._hVel       = new THREE.Vector3();  // horizontal velocity (x,z)
    this._step       = new THREE.Vector3();
    this._dir        = new THREE.Vector3();
    this._slide      = new THREE.Vector3();
    this._normal     = new THREE.Vector3();
    this._origin     = new THREE.Vector3();
    this._tmp        = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._camDir     = new THREE.Vector3();
    this._camLookAt  = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._head       = new THREE.Vector3();
    this._euler      = new THREE.Euler(0, 0, 0, 'YXZ');
    this._normalMat  = new THREE.Matrix3();

    // OrbitControls — only used in free-look mode (C key)
    this.orbit = new OrbitControls(camera, renderer.domElement);
    this.orbit.enableDamping      = true;
    this.orbit.dampingFactor      = 0.08;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance        = 0.5;
    this.orbit.maxDistance        = 20;
    this.orbit.maxPolarAngle      = Math.PI / 1.6;
    this.orbit.enabled            = false;

    this._pointerLocked = false;
    this._dragging      = false;
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = !!document.pointerLockElement;
    });

    this._setupInput();
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  load(onProgress) {
    return new Promise((resolve) => {
      const loader = new GLTFLoader();
      loader.load(
        '/models/character.glb',
        (gltf) => {
          this.model = gltf.scene;
          this.model.traverse((child) => {
            if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
          });
          this.model.position.set(0, 0, 0);
          this.scene.add(this.model);

          this.mixer = new THREE.AnimationMixer(this.model);
          if (import.meta.env && import.meta.env.DEV) {
            console.log('[Character] Clips:', gltf.animations.map((c) => c.name));
          }

          const find = (keywords) => {
            for (const kw of keywords) {
              const clip = gltf.animations.find((c) => c.name.toLowerCase().includes(kw));
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

          // Spawn facing into the scene, settled on the ground. Default view is FPV, so the
          // mesh starts hidden (it's shown again in TPV / free-look); then snap the camera.
          this.yaw = 0; this.pitch = 0;
          this.model.rotation.y = Math.PI; this._targetYaw = Math.PI;
          this.model.traverse((c) => { if (c.isMesh) c.visible = !this.isFPV; });
          this._snapToGround(this.model.position);
          this._camLookAt.copy(this.model.position).setY(this.model.position.y + TPV_LOOK_HEIGHT);
          this._snap = true;

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

  // ── Input ─────────────────────────────────────────────────────────────────
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

    // Look controls (locked-camera mode):
    //  • Click → request pointer lock for immersive, hands-free mouse-look.
    //  • Drag (hold mouse button) → always works, even if pointer lock is
    //    unavailable/blocked (e.g. an embedded preview or sandboxed iframe).
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', () => {
      if (this.freeLook) return;
      this._dragging = true;
      if (!this._pointerLocked) {
        const req = canvas.requestPointerLock();
        // Swallow rejection if the browser blocks it — drag-to-look still covers us.
        if (req && typeof req.catch === 'function') req.catch(() => {});
      }
    });
    window.addEventListener('mouseup',   () => { this._dragging = false; });
    window.addEventListener('mouseleave', () => { this._dragging = false; });

    // Mouse look — when pointer-locked (any movement) or while dragging (fallback).
    document.addEventListener('mousemove', (e) => {
      if (this.freeLook) return;
      if (!this._pointerLocked && !this._dragging) return;
      this.yaw   -= e.movementX * MOUSE_SENS;
      this.pitch -= e.movementY * MOUSE_SENS;
      this.pitch  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch));
    });
  }

  _applyFreeLookState() {
    this._snap = true;
    if (this.freeLook) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.orbit.enabled = true;
      if (this.model) {
        this.model.traverse((c) => { if (c.isMesh) c.visible = true; });
        this._lookTarget.copy(this.model.position).setY(this.model.position.y + 1);
        this.orbit.target.copy(this._lookTarget);
        if (this.isFPV) {
          // Pull the camera back off the head so the character is visible to orbit around
          this.camera.position.set(
            this.model.position.x - Math.sin(this.yaw) * 4,
            this.model.position.y + 2,
            this.model.position.z - Math.cos(this.yaw) * 4
          );
        }
        this.orbit.update();
      }
    } else {
      this.orbit.enabled = false;
      if (this.isFPV && this.model) {
        this.model.traverse((c) => { if (c.isMesh) c.visible = false; });
      }
      this.renderer.domElement.requestPointerLock();
    }
  }

  // ── View toggle (FPV / TPV) ─────────────────────────────────────────────────
  setFPV(val) {
    this.isFPV = val;
    this._snap = true;   // jump to the new pose rather than sliding between very different views
    if (this.model) {
      const showMesh = !val || this.freeLook;  // hide the mesh only in locked FPV
      this.model.traverse((c) => { if (c.isMesh) c.visible = showMesh; });
    }
    if (!this.freeLook && !this._pointerLocked) {
      this.renderer.domElement.requestPointerLock();
    }
  }

  // ── Teleport (section jump) ──────────────────────────────────────────────────
  teleportTo(pos) {
    if (!this.model) return;
    this.model.position.x = pos.x;
    this.model.position.z = pos.z;
    this._snapToGround(pos);          // land on the real floor, never float / clip
    this.velocity.set(0, 0, 0);
    this._hVel.set(0, 0, 0);
    this._snap = true;                // camera jumps to the new location instead of flying across the set
    if (this.freeLook) {
      this._lookTarget.copy(this.model.position).setY(this.model.position.y + 1);
      this.orbit.target.copy(this._lookTarget);
      this.orbit.update();
    }
  }

  // Drop a position onto the ground directly below it (used for spawn + teleport).
  _snapToGround(pos) {
    this._origin.set(pos.x, pos.y + STEP_HEIGHT + 2, pos.z);
    this.raycaster.set(this._origin, DOWN);
    this.raycaster.near = 0;
    this.raycaster.far  = STEP_HEIGHT + 2 + GROUND_PROBE + 4;
    const groundY = this._firstFloorHit(this.raycaster.intersectObjects(this.colliderMeshes, false));
    this.model.position.y = groundY !== null ? groundY : pos.y;
    this.lastGroundY = this.model.position.y;
  }

  // ── Collision helpers ────────────────────────────────────────────────────────
  // Nearest horizontal hit across the capsule of rays, or null. far scales with the
  // intended step distance so fast movement / low framerate can't tunnel through walls.
  _collideDir(dir, dist) {
    const far = PLAYER_RADIUS + dist;
    let nearest = null;
    for (const h of RAY_HEIGHTS) {
      this._origin.copy(this.model.position);
      this._origin.y += h;
      this.raycaster.set(this._origin, dir);
      this.raycaster.near = 0;
      this.raycaster.far  = far;
      const hits = this.raycaster.intersectObjects(this.colliderMeshes, false);
      if (hits.length && (!nearest || hits[0].distance < nearest.distance)) nearest = hits[0];
    }
    return nearest;
  }

  // World-space horizontal normal of a hit, written into `out` (normalized, y=0).
  _worldNormal(hit, out) {
    if (!hit.face) { out.set(0, 0, 0); return; }
    this._normalMat.getNormalMatrix(hit.object.matrixWorld);
    out.copy(hit.face.normal).applyNormalMatrix(this._normalMat);
    out.y = 0;
    const l = out.length();
    if (l > 1e-6) out.multiplyScalar(1 / l); else out.set(0, 0, 0);
  }

  // Sweep a horizontal displacement, sub-stepping and sliding along wall normals.
  // Returns true if the body actually moved.
  _moveWithCollision(disp) {
    this._dir.set(disp.x, 0, disp.z);
    const len = this._dir.length();
    if (len < 1e-6) return false;
    this._dir.multiplyScalar(1 / len);

    const maxStep = PLAYER_RADIUS * 0.75;
    const n   = Math.max(1, Math.ceil(len / maxStep));
    const sub = len / n;
    let moved = false;

    for (let i = 0; i < n; i++) {
      const hit = this._collideDir(this._dir, sub);
      if (!hit) {
        this.model.position.x += this._dir.x * sub;
        this.model.position.z += this._dir.z * sub;
        moved = true;
        continue;
      }
      // Slide: project the desired direction onto the wall plane.
      this._worldNormal(hit, this._normal);
      if (this._normal.lengthSq() < 1e-6) continue;
      const dot = this._dir.x * this._normal.x + this._dir.z * this._normal.z;
      this._slide.set(this._dir.x - this._normal.x * dot, 0, this._dir.z - this._normal.z * dot);
      const sLen = this._slide.length();
      if (sLen <= 1e-4) continue;
      this._slide.multiplyScalar(1 / sLen);
      if (!this._collideDir(this._slide, sub * sLen)) {
        this.model.position.x += this._slide.x * sub * sLen;
        this.model.position.z += this._slide.z * sub * sLen;
        moved = true;
      }
    }
    return moved;
  }

  // Pick the first downward hit that is actually a walkable floor (up-facing normal).
  _firstFloorHit(hits) {
    for (const h of hits) {
      if (!h.face) return h.point.y;
      this._normalMat.getNormalMatrix(h.object.matrixWorld);
      this._tmp.copy(h.face.normal).applyNormalMatrix(this._normalMat).normalize();
      if (this._tmp.y > SLOPE_MIN_NORMAL_Y) return h.point.y;
    }
    return null;
  }

  // ── Ground resolution — run AFTER the horizontal move ────────────────────────
  _resolveGround(delta) {
    this._origin.copy(this.model.position);
    this._origin.y += STEP_HEIGHT;
    this.raycaster.set(this._origin, DOWN);
    this.raycaster.near = 0;
    this.raycaster.far  = STEP_HEIGHT + GROUND_PROBE;
    const groundY = this._firstFloorHit(this.raycaster.intersectObjects(this.colliderMeshes, false));

    if (groundY !== null) {
      this.lastGroundY = groundY;
      const dy = groundY - this.model.position.y;
      if (dy > -STEP_HEIGHT) {
        // On the floor, or within a step up/down — settle smoothly so stairs don't pop.
        this.model.position.y = THREE.MathUtils.damp(this.model.position.y, groundY, GROUND_K, delta);
        this.velocity.y = 0;
        this.grounded = true;
      } else {
        // Floor is well below the feet — fall toward it under gravity.
        this.velocity.y += GRAVITY * delta;
        this.model.position.y += this.velocity.y * delta;
        if (this.model.position.y <= groundY) {
          this.model.position.y = groundY;
          this.velocity.y = 0;
          this.grounded = true;
        } else {
          this.grounded = false;
        }
      }
    } else {
      // No ground within reach — keep falling (never hard-clamp to world Y=0).
      this.velocity.y += GRAVITY * delta;
      this.model.position.y += this.velocity.y * delta;
      this.grounded = false;
      const killFloor = (this.lastGroundY ?? 0) - 30;
      if (this.model.position.y < killFloor) {
        this.model.position.y = this.lastGroundY ?? 0;
        this.velocity.y = 0;
      }
    }
  }

  // ── Yaw used to build the movement basis (single source of truth) ────────────
  _moveYaw() {
    if (this.freeLook) {
      // Forward = the direction the camera looks (from the camera toward its target).
      this._tmp.copy(this.camera.position).sub(this.orbit.target);
      return Math.atan2(this._tmp.x, this._tmp.z);
    }
    return this.yaw;
  }

  // ── Animations ────────────────────────────────────────────────────────────
  _playNamed(name) {
    const next = this.namedActions[name];
    if (!next || next === this.currentAction) return;
    if (this.currentAction) this.currentAction.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    this.currentAction = next;
  }

  // ── Movement ──────────────────────────────────────────────────────────────
  _applyMovement(delta) {
    const isRunning = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed     = isRunning ? RUN_SPEED : WALK_SPEED;
    const yaw       = this._moveYaw();

    // One consistent right-handed basis for BOTH views.
    // At yaw=0: forward = (0,0,-1) into the screen, right = (1,0,0).
    this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    this._moveDir.set(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    this._moveDir.add(this._fwd);
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  this._moveDir.sub(this._fwd);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) this._moveDir.add(this._right);
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  this._moveDir.sub(this._right);
    if (this._moveDir.lengthSq() > 0) this._moveDir.normalize();

    // Mild inertia: ease horizontal velocity toward the target (frame-rate independent).
    this._targetVel.set(this._moveDir.x * speed, 0, this._moveDir.z * speed);
    const va = 1 - Math.exp(-ACCEL_K * delta);
    this._hVel.x += (this._targetVel.x - this._hVel.x) * va;
    this._hVel.z += (this._targetVel.z - this._hVel.z) * va;

    // Horizontal step + collision
    this._step.set(this._hVel.x * delta, 0, this._hVel.z * delta);
    const stepLen = Math.hypot(this._step.x, this._step.z);
    if (stepLen > 1e-5) {
      if (this.collisionEnabled) this._moveWithCollision(this._step);
      else { this.model.position.x += this._step.x; this.model.position.z += this._step.z; }
    }

    // Ground (resolved against the POST-move position)
    this._resolveGround(delta);

    // Turn the model toward the actual movement direction, damped.
    const moveMag = Math.hypot(this._hVel.x, this._hVel.z);
    if (moveMag > 0.15) this._targetYaw = Math.atan2(this._hVel.x, this._hVel.z);
    let dYaw = this._targetYaw - this.model.rotation.y;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));  // shortest path
    this.model.rotation.y += dYaw * (1 - Math.exp(-TURN_K * delta));

    // Animation follows the real speed, not raw key state.
    const animMoving  = moveMag > 0.2;
    const animRunning = moveMag > WALK_SPEED + 0.4;
    this._playNamed(animMoving ? (animRunning ? 'run' : 'walk') : 'idle');
    return animMoving;
  }

  // ── Camera ──────────────────────────────────────────────────────────────────
  _updateCamera(delta) {
    // Free look: OrbitControls owns the camera; just ease its pivot toward the head.
    if (this.freeLook) {
      this._lookTarget.copy(this.model.position).setY(this.model.position.y + 1);
      const t = this._snap ? 1 : 1 - Math.exp(-LOOK_K * delta);
      this.orbit.target.lerp(this._lookTarget, t);
      this.orbit.update();
      this._snap = false;
      return;
    }

    // First person: lock to the head instantly (no follow lag → no motion sickness).
    if (this.isFPV) {
      this._head.copy(this.model.position).setY(this.model.position.y + FPV_EYE_HEIGHT);
      this.camera.position.copy(this._head);
      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(this._euler);
      this._snap = false;
      return;
    }

    // Third person: spherical offset behind the character (yaw orbit + pitch tilt).
    const p  = Math.max(TPV_PITCH_MIN, Math.min(TPV_PITCH_MAX, this.pitch));
    const cp = Math.cos(p), sp = Math.sin(p);
    this._desiredPos.set(
      this.model.position.x + Math.sin(this.yaw) * TPV_DIST * cp,
      this.model.position.y + TPV_LOOK_HEIGHT + TPV_DIST * sp,
      this.model.position.z + Math.cos(this.yaw) * TPV_DIST * cp
    );
    this._lookTarget.copy(this.model.position).setY(this.model.position.y + TPV_LOOK_HEIGHT);

    // Camera-wall occlusion: pull in if something is between the head and the camera.
    this._camDir.subVectors(this._desiredPos, this._lookTarget);
    const maxDist = this._camDir.length();
    if (maxDist > 1e-4) {
      this._camDir.multiplyScalar(1 / maxDist);
      this.raycaster.set(this._lookTarget, this._camDir);
      this.raycaster.near = 0;
      this.raycaster.far  = maxDist;
      const hit = this.raycaster.intersectObjects(this.colliderMeshes, false)[0];
      if (hit) {
        const d = Math.max(TPV_MIN_DIST, hit.distance - 0.2);
        this._desiredPos.copy(this._lookTarget).addScaledVector(this._camDir, d);
      }
    }

    const a = this._snap ? 1 : 1 - Math.exp(-CAM_K * delta);
    this.camera.position.lerp(this._desiredPos, a);
    this._camLookAt.lerp(this._lookTarget, this._snap ? 1 : 1 - Math.exp(-LOOK_K * delta));
    this.camera.lookAt(this._camLookAt);
    this._snap = false;
  }

  // ── Update ────────────────────────────────────────────────────────────────
  update(delta) {
    if (!this.isLoaded) return null;
    this.mixer.update(delta);
    this._applyMovement(delta);
    this._updateCamera(delta);
    return this.model.position;
  }

  getPosition() {
    return this.model ? this.model.position : new THREE.Vector3();
  }
}
