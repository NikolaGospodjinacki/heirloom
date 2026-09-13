import * as THREE from 'three';
import { EYE, SCALE, Stage, facingFromDir } from './core';
import { G, mat, mesh, shade } from './kit';
import type { GearLook } from './look3';

/**
 * Mouse-look, pointer lock, and the pair of hands in front of the camera.
 * It never moves the player itself: it reports a direction and the simulation
 * decides whether that direction is allowed.
 */
export class FirstPerson {
  yaw = -Math.PI / 2;
  pitch = 0;
  sens = 0.0022;
  locked = false;
  /** pointer lock was refused (embedded browsers usually refuse it) */
  lockFailed = false;
  /** a mouse button is held and the camera follows the drag */
  dragging = false;
  /** town has no attack, so a left-drag can look around there too */
  allowLeftDrag = true;
  bob = 0;
  private stage: Stage;
  private canvas: HTMLCanvasElement;
  private rigHand = new THREE.Group();
  private weaponSlot = new THREE.Group();
  private offSlot = new THREE.Group();
  private swing = 0;
  private swingMax = 0.2;
  private lastGear = '';

  constructor(stage: Stage, canvas: HTMLCanvasElement) {
    this.stage = stage;
    this.canvas = canvas;
    stage.rig.add(this.rigHand);
    this.rigHand.add(this.weaponSlot, this.offSlot);
    this.weaponSlot.position.set(0.42, -0.36, -0.62);
    this.offSlot.position.set(-0.44, -0.34, -0.6);

    // Hold right mouse to look, like an old MMO. This works in every browser,
    // including embedded ones that refuse pointer lock outright.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 || (e.button === 0 && this.allowLeftDrag)) this.dragging = true;
      if (e.button === 0) this.requestLock();
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('blur', () => { this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.dragging) return;
      const dx = e.movementX ?? 0;
      const dy = e.movementY ?? 0;
      // unlocked drags report bigger jumps on some platforms; clamp the spikes
      const cap = this.locked ? 400 : 120;
      this.yaw -= Math.max(-cap, Math.min(cap, dx)) * this.sens;
      this.pitch -= Math.max(-cap, Math.min(cap, dy)) * this.sens;
      const lim = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
  }

  requestLock(): void {
    if (this.locked || this.lockFailed) return;
    try {
      const req = this.canvas.requestPointerLock as unknown as (() => Promise<void> | void) | undefined;
      const p = req?.call(this.canvas);
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => { this.lockFailed = true; });
      }
    } catch {
      this.lockFailed = true;
    }
  }

  /** Is the camera currently steerable by the mouse at all? */
  get looking(): boolean {
    return this.locked || this.dragging;
  }
  release(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Sim-space facing angle, taken from where the camera actually points. */
  facing(): number {
    const d = new THREE.Vector3();
    this.stage.camera.getWorldDirection(d);
    d.y = 0;
    if (d.lengthSq() < 1e-6) return 0;
    d.normalize();
    return facingFromDir(d);
  }

  /** WASD relative to where you are looking, in sim coordinates. */
  moveVector(fwd: number, strafe: number): [number, number] {
    if (fwd === 0 && strafe === 0) return [0, 0];
    const th = this.facing();
    const cx = Math.cos(th), cy = Math.sin(th);
    const mx = cx * fwd - cy * strafe;
    const my = cy * fwd + cx * strafe;
    const l = Math.hypot(mx, my);
    return [mx / l, my / l];
  }

  /** Where the crosshair meets the ground, for placing a Meteor. */
  aimPoint(fallbackDist = 260): [number, number] {
    const cam = this.stage.camera;
    const d = new THREE.Vector3();
    cam.getWorldDirection(d);
    const origin = cam.getWorldPosition(new THREE.Vector3());
    if (d.y < -0.02) {
      const t = origin.y / -d.y;
      const p = origin.clone().addScaledVector(d, t);
      return [p.x / SCALE, p.z / SCALE];
    }
    const p = origin.clone().addScaledVector(d, fallbackDist * SCALE);
    return [p.x / SCALE, p.z / SCALE];
  }

  startSwing(duration = 0.2): void {
    this.swing = duration;
    this.swingMax = duration;
  }

  /** Rebuild the hands when the equipped look changes. */
  setGear(look: GearLook): void {
    const key = (look.weapon?.vis ?? '-') + look.weapon?.color + '|'
      + (look.offhand?.vis ?? '-') + look.offhand?.color;
    if (key === this.lastGear) return;
    this.lastGear = key;
    clear(this.weaponSlot);
    clear(this.offSlot);
    this.weaponSlot.add(makeHand('#e0ab7d'));
    if (look.weapon) this.weaponSlot.add(makeViewWeapon(look.weapon.vis, look.weapon.color));
    if (look.offhand) this.offSlot.add(makeViewShield(look.offhand.vis, look.offhand.color));
    else this.offSlot.add(makeHand('#e0ab7d'));
  }

  update(dt: number, moving: boolean, hurt: number, air: number): void {
    const cam = this.stage.camera;
    cam.rotation.set(this.pitch, this.yaw, 0);

    if (moving) this.bob += dt * 9.5;
    const bobY = moving ? Math.sin(this.bob) * 0.035 : 0;
    const bobX = moving ? Math.cos(this.bob * 0.5) * 0.024 : 0;
    this.rigHand.position.set(bobX, bobY - Math.min(0.12, air * 0.004), 0);

    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt);
    const p = this.swing > 0 ? 1 - this.swing / this.swingMax : -1;
    if (p >= 0) {
      // a quick down-and-across chop that returns to guard
      const s = Math.sin(p * Math.PI);
      this.weaponSlot.rotation.set(-1.5 * s, 0.9 * s, -0.9 * s);
      this.weaponSlot.position.set(0.42 - 0.34 * s, -0.36 + 0.16 * s, -0.62 - 0.3 * s);
    } else {
      this.weaponSlot.rotation.set(0, 0, 0);
      this.weaponSlot.position.set(0.42, -0.36, -0.62);
    }
    // flinch
    this.rigHand.rotation.z = hurt > 0 ? Math.sin(hurt * 40) * 0.09 : 0;
  }

  /** Camera at the player's eyes. */
  place(simX: number, simY: number, height: number): void {
    this.stage.camera.position.set(simX * SCALE, height * SCALE + EYE, simY * SCALE);
  }
}

function clear(g: THREE.Group): void {
  while (g.children.length) g.remove(g.children[0]);
}

function makeHand(skin: string): THREE.Mesh {
  const m = mesh(G.box(), mat(skin), 0, -0.06, 0.16, 0.16, 0.16, 0.3);
  m.castShadow = false;
  return m;
}

function makeViewWeapon(vis: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(color);
  const wood = mat('#6b4a2a');
  const gold = mat('#c8a24b');
  switch (vis) {
    case 'greatsword':
    case 'sword': {
      const long = vis === 'greatsword';
      g.add(mesh(G.box(), wood, 0, 0, 0.1, 0.05, 0.05, 0.2));
      g.add(mesh(G.box(), gold, 0, 0, -0.02, 0.24, 0.05, 0.05));
      const bl = long ? 1.5 : 1.05;
      g.add(mesh(G.box(), steel, 0, 0, -0.04 - bl / 2, 0.075, 0.03, bl));
      break;
    }
    case 'dagger':
      g.add(mesh(G.box(), wood, 0, 0, 0.08, 0.045, 0.045, 0.16));
      g.add(mesh(G.box(), steel, 0, 0, -0.28, 0.05, 0.022, 0.5));
      break;
    case 'axe':
      g.add(mesh(G.box(), wood, 0, 0, -0.3, 0.05, 0.05, 0.95));
      g.add(mesh(G.box(), steel, 0.1, 0, -0.72, 0.22, 0.03, 0.3));
      break;
    case 'staff':
      g.add(mesh(G.cyl(), wood, 0, 0.1, -0.5, 0.05, 1.7, 0.05).rotateX(Math.PI / 2));
      g.add(mesh(G.sphere(), mat(color, { emissive: shade(color, -100) }), 0, 0.1, -1.3, 0.24, 0.24, 0.24));
      break;
    case 'wand':
      g.add(mesh(G.cyl(), wood, 0, 0, -0.28, 0.035, 0.6, 0.035).rotateX(Math.PI / 2));
      g.add(mesh(G.sphere(), mat(color, { emissive: shade(color, -100) }), 0, 0, -0.6, 0.14, 0.14, 0.14));
      break;
    case 'hatchet':
      g.add(mesh(G.box(), wood, 0, 0, -0.22, 0.045, 0.045, 0.7));
      g.add(mesh(G.box(), steel, 0.08, 0, -0.54, 0.18, 0.028, 0.24));
      break;
    case 'miner_pick':
      g.add(mesh(G.box(), wood, 0, 0, -0.22, 0.045, 0.045, 0.7));
      g.add(mesh(G.box(), steel, 0, 0, -0.56, 0.5, 0.05, 0.06));
      break;
    default:
      g.add(mesh(G.box(), steel, 0, 0, -0.3, 0.08, 0.05, 0.7));
  }
  g.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  return g;
}

function makeViewShield(vis: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const tall = vis === 'shield_tall';
  const face = mesh(G.box(), mat(color), 0, 0, -0.2, tall ? 0.52 : 0.46, tall ? 0.7 : 0.46, 0.07);
  g.add(face);
  g.add(mesh(G.sphere(), mat(shade(color, 45)), 0, 0, -0.25, 0.14, 0.14, 0.1));
  g.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  return g;
}
