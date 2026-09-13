import * as THREE from 'three';
import { SCALE, Stage } from './core';

/**
 * The HD-2D camera. High, tilted, always looking north, following the player
 * like a diorama on a desk. Its yaw never changes, so WASD stays aligned with
 * the screen and every painted standee always faces it.
 */
export class Diorama {
  pitch = -0.74;
  dist = 27;
  minDist = 14;
  maxDist = 44;
  mouseX = 0;
  mouseY = 0;
  private target = new THREE.Vector3();
  private stage: Stage;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private snapped = false;

  constructor(stage: Stage, canvas: HTMLCanvasElement) {
    this.stage = stage;
    stage.camera.fov = 34;
    stage.camera.near = 0.5;
    stage.camera.far = 900;
    stage.camera.updateProjectionMatrix();
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = 1 + Math.sign(e.deltaY) * 0.08;
      this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist * step));
    }, { passive: false });
  }

  /** Ease toward the player. The first call after a scene change snaps instead of swooping. */
  follow(simX: number, simY: number, height: number, dt: number): void {
    const tx = simX * SCALE, ty = height * SCALE, tz = simY * SCALE;
    if (!this.snapped) {
      this.target.set(tx, ty, tz);
      this.snapped = true;
    }
    const k = Math.min(1, dt * 7);
    this.target.x += (tx - this.target.x) * k;
    this.target.y += (ty - this.target.y) * Math.min(1, dt * 4);
    this.target.z += (tz - this.target.z) * k;
    this.apply();
  }

  snap(): void { this.snapped = false; }

  apply(): void {
    const cam = this.stage.camera;
    const c = Math.cos(this.pitch), s = Math.sin(this.pitch);
    // looking north and down: sit south of the target and above it
    cam.position.set(this.target.x, this.target.y - s * this.dist, this.target.z + c * this.dist);
    cam.rotation.set(this.pitch, 0, 0);
    cam.updateMatrixWorld();
  }

  /** Where the cursor meets the ground at a given height, in sim units. */
  aim(viewW: number, viewH: number, groundHeight: number): [number, number] {
    this.ndc.set((this.mouseX / viewW) * 2 - 1, -(this.mouseY / viewH) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
    this.plane.constant = -groundHeight * SCALE;
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) {
      return [this.target.x / SCALE, this.target.z / SCALE];
    }
    return [this.hit.x / SCALE, this.hit.z / SCALE];
  }

  /** Standees lean back by this much so the tilted camera does not squash them. */
  get spriteLean(): number {
    return this.pitch * 0.42;
  }

  focus(): THREE.Vector3 {
    return this.target;
  }
}
