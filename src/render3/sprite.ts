import * as THREE from 'three';
import { SCALE } from './core';

/**
 * Standees are unlit: the drawing already carries its own shading. This tint
 * warms them into the golden light of the scene around them.
 */
export const SPRITE_TINT = new THREE.Color(1.0, 0.96, 0.88);

function keep(o: object): void {
  (o as { keep?: boolean }).keep = true;
}

function makeTex(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** An upright plane whose pivot is at the feet, so leaning and scaling keep it planted. */
function standeeGeometry(simW: number, simH: number, footPad: number): THREE.PlaneGeometry {
  const w = simW * SCALE, h = simH * SCALE;
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2 - footPad * SCALE, 0);
  return g;
}

/**
 * A painted standee for something that moves or changes. It owns a small
 * canvas the old 2D draw code paints into, and a plane in the world that shows
 * it upright and leaning back toward the camera. It casts a real shadow in the
 * exact shape of the drawing.
 */
export class Sprite {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  readonly footX: number;
  readonly footY: number;
  readonly res: number;
  /** a faint silhouette drawn wherever something stands between it and the camera */
  readonly ghost: THREE.Mesh | null = null;

  constructor(
    simW: number, simH: number,
    opts: { res?: number; footPad?: number; castShadow?: boolean; xray?: boolean } = {},
  ) {
    const pad = opts.footPad ?? 4;
    this.res = opts.res ?? 2;
    this.footX = simW / 2;
    this.footY = simH - pad;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(simW * this.res);
    this.canvas.height = Math.ceil(simH * this.res);
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = makeTex(this.canvas);

    const mat = new THREE.MeshBasicMaterial({
      map: this.tex, color: SPRITE_TINT, alphaTest: 0.42, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(standeeGeometry(simW, simH, pad), mat);
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = false;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, map: this.tex, alphaTest: 0.42,
    });
    if (opts.xray) {
      // only the part above the feet, so the ground itself never shows it
      const w = simW * SCALE, h = (simH - pad) * SCALE;
      const g = new THREE.PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
      const uvs = g.attributes.uv;
      const vMin = pad / simH;
      for (let i = 0; i < uvs.count; i++) uvs.setY(i, vMin + uvs.getY(i) * (1 - vMin));
      const gm = new THREE.MeshBasicMaterial({
        map: this.tex, color: new THREE.Color('#a8ccff'), transparent: true, opacity: 0.45,
        alphaTest: 0.3, depthFunc: THREE.GreaterDepth, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const ghost = new THREE.Mesh(g, gm);
      ghost.renderOrder = 20;
      this.mesh.add(ghost);
      this.ghost = ghost;
    }
  }

  /**
   * Paint with a function that draws in world coordinates. The transform puts
   * the given world point exactly on the feet of the canvas.
   */
  paint(worldX: number, worldY: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.res, 0, 0, this.res,
      this.res * (this.footX - worldX), this.res * (this.footY - worldY));
    draw(c);
    this.tex.needsUpdate = true;
  }

  place(simX: number, simY: number, simZ: number, lean: number): void {
    this.mesh.position.set(simX * SCALE, simZ * SCALE, simY * SCALE);
    this.mesh.rotation.set(lean, 0, 0);
  }

  dispose(): void {
    if (this.ghost) {
      this.ghost.geometry.dispose();
      (this.ghost.material as THREE.Material).dispose();
    }
    this.tex.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.mesh.customDepthMaterial as THREE.Material | undefined)?.dispose();
  }
}

interface StandeeEntry { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial; depth: THREE.MeshDepthMaterial }
const standees = new Map<string, StandeeEntry>();

/**
 * Many copies of one static painting: a variant of tree, a kind of flower.
 * Texture, geometry and materials are made once and shared by every copy.
 */
function standeeEntry(
  key: string, simW: number, simH: number, footPad: number,
  draw: (ctx: CanvasRenderingContext2D, footX: number, footY: number) => void,
  res: number,
): StandeeEntry {
  let e = standees.get(key);
  if (!e) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(simW * res);
    cv.height = Math.ceil(simH * res);
    const c = cv.getContext('2d')!;
    c.setTransform(res, 0, 0, res, 0, 0);
    draw(c, simW / 2, simH - footPad);
    const tex = makeTex(cv);
    const geo = standeeGeometry(simW, simH, footPad);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: SPRITE_TINT, alphaTest: 0.42, side: THREE.DoubleSide,
    });
    const depth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42,
    });
    keep(geo); keep(mat);
    e = { geo, mat, depth };
    standees.set(key, e);
  }
  return e;
}

export function standee(
  key: string, simW: number, simH: number, footPad: number,
  draw: (ctx: CanvasRenderingContext2D, footX: number, footY: number) => void,
  res = 2,
): THREE.Mesh {
  const e = standeeEntry(key, simW, simH, footPad, draw, res);
  const m = new THREE.Mesh(e.geo, e.mat);
  m.customDepthMaterial = e.depth;
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

const decals = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial }>();

function flatGeometry(simW: number, simH: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(simW * SCALE, simH * SCALE);
  // canvas top is north, the same way up the 2D map was
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A painting laid flat on the ground and shared: flowerbeds, garden rows, lily pads. */
export function decal(
  key: string, simW: number, simH: number,
  draw: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void,
  res = 2,
): THREE.Mesh {
  let e = decals.get(key);
  if (!e) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(simW * res);
    cv.height = Math.ceil(simH * res);
    const c = cv.getContext('2d')!;
    c.setTransform(res, 0, 0, res, 0, 0);
    draw(c, simW / 2, simH / 2);
    const tex = makeTex(cv);
    const geo = flatGeometry(simW, simH);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: SPRITE_TINT, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    keep(geo); keep(mat);
    e = { geo, mat };
    decals.set(key, e);
  }
  const m = new THREE.Mesh(e.geo, e.mat);
  m.renderOrder = 1;
  return m;
}

/**
 * A one-off flat painting for something that changes, like a garden plot.
 * The caller owns it: dispose the texture on userData.tex when replacing it.
 */
export function freshDecal(
  simW: number, simH: number,
  draw: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void,
  res = 2,
): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(simW * res);
  cv.height = Math.ceil(simH * res);
  const c = cv.getContext('2d')!;
  c.setTransform(res, 0, 0, res, 0, 0);
  draw(c, simW / 2, simH / 2);
  const tex = makeTex(cv);
  const m = new THREE.Mesh(flatGeometry(simW, simH), new THREE.MeshBasicMaterial({
    map: tex, color: SPRITE_TINT, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  m.renderOrder = 1;
  m.userData.tex = tex;
  return m;
}

/**
 * Hundreds of copies of one painting in a single draw: the woods past the edge
 * of the map, the boulders on a mountainside. Positions are in world units.
 */
export function standeeInstances(
  key: string, simW: number, simH: number, footPad: number,
  draw: (ctx: CanvasRenderingContext2D, footX: number, footY: number) => void,
  res: number,
  items: { x: number; y: number; z: number; s: number }[],
  lean: number,
  castShadow = true,
): THREE.InstancedMesh {
  const e = standeeEntry(key, simW, simH, footPad, draw, res);
  const m = new THREE.InstancedMesh(e.geo, e.mat, Math.max(1, items.length));
  m.customDepthMaterial = e.depth;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, 0));
  const mtx = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  items.forEach((it, i) => {
    v.set(it.x, it.y, it.z);
    sc.setScalar(it.s);
    mtx.compose(v, q, sc);
    m.setMatrixAt(i, mtx);
  });
  m.count = items.length;
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = castShadow;
  m.receiveShadow = false;
  m.computeBoundingSphere();
  return m;
}
