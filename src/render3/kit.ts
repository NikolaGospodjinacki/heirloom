import * as THREE from 'three';
import { SCALE } from './core';

/** Materials and geometries are shared and never disposed with a scene. */
const matCache = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: string, opts: { flat?: boolean; emissive?: string; opacity?: number } = {}): THREE.MeshLambertMaterial {
  const key = color + '|' + (opts.emissive ?? '') + '|' + (opts.opacity ?? 1);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color('#000000'),
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    (m as unknown as { keep: boolean }).keep = true;
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    (g as unknown as { keep: boolean }).keep = true;
    geoCache.set(key, g);
  }
  return g;
}

export const G = {
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  sphere: () => geo('sph', () => new THREE.IcosahedronGeometry(0.5, 1)),
  rock: () => geo('rock', () => new THREE.IcosahedronGeometry(0.5, 0)),
  cone: () => geo('cone', () => new THREE.ConeGeometry(0.5, 1, 7)),
  cyl: () => geo('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
  cylT: () => geo('cylT', () => new THREE.CylinderGeometry(0.35, 0.5, 1, 7)),
  plane: () => geo('plane', () => new THREE.PlaneGeometry(1, 1)),
  ring: () => geo('ring', () => new THREE.RingGeometry(0.44, 0.5, 40)),
  disc: () => geo('disc', () => new THREE.CircleGeometry(0.5, 36)),
};

export function mesh(
  g: THREE.BufferGeometry, m: THREE.Material,
  x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1,
): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

export function shade(hex: string, amt: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// -------------------------------------------------------------------- flora

export function makeTree(variant: number, rich: boolean, height = 1): THREE.Group {
  const g = new THREE.Group();
  const trunkH = 1.5 * height;
  const trunk = mesh(G.cylT(), mat('#6b4a2a'), 0, trunkH / 2, 0, 0.22, trunkH, 0.22);
  g.add(trunk);
  const greens = rich ? ['#4d7c3c', '#568a42', '#3f6b34'] : ['#5f6b3a', '#6a7340', '#4f5a30'];
  const c = greens[variant % greens.length];
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = (1.5 - t * 0.75) * height;
    const y = trunkH + t * 1.5 * height;
    const cone = mesh(G.cone(), mat(i === 0 ? c : shade(c, 12)), 0, y, 0, r, 1.5 * height, r);
    g.add(cone);
  }
  return g;
}

export function makeRock(variant: number, tint = '#7c7f88', size = 1): THREE.Group {
  const g = new THREE.Group();
  const base = mesh(G.rock(), mat(tint), 0, 0.34 * size, 0, 1.5 * size, 0.9 * size, 1.4 * size);
  base.rotation.set(variant * 0.6, variant * 1.1, variant * 0.3);
  g.add(base);
  if (variant % 2 === 0) {
    g.add(mesh(G.rock(), mat(shade(tint, 14)), 0.5 * size, 0.2 * size, -0.3 * size,
      0.7 * size, 0.5 * size, 0.7 * size));
  }
  return g;
}

export function makeStump(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(), mat('#6b4a2a'), 0, 0.25, 0, 0.55, 0.5, 0.55));
  g.add(mesh(G.cyl(), mat('#8a6440'), 0, 0.51, 0, 0.56, 0.04, 0.56));
  return g;
}

export function makeMushroom(variant: number): THREE.Group {
  const g = new THREE.Group();
  const caps = ['#c8564a', '#9a7fd0', '#c8964a', '#7aa85c'];
  g.add(mesh(G.cyl(), mat('#e8e0cf'), 0, 0.12, 0, 0.07, 0.24, 0.07));
  g.add(mesh(G.sphere(), mat(caps[variant % 4]), 0, 0.26, 0, 0.34, 0.22, 0.34));
  return g;
}

export function makeCrystal(variant: number): THREE.Group {
  const g = new THREE.Group();
  const cols = ['#57d4d0', '#9b7fe0', '#e8a33d', '#7fc2e0'];
  const c = cols[variant % 4];
  const m = mat(c, { emissive: shade(c, -110) });
  for (let i = 0; i < 3; i++) {
    const h = 0.5 + (i % 2) * 0.4;
    const s = mesh(G.cone(), m, (i - 1) * 0.16, h / 2, (i % 2) * 0.12, 0.18, h, 0.18);
    s.rotation.z = (i - 1) * 0.22;
    g.add(s);
  }
  return g;
}

export function makeBone(variant: number): THREE.Group {
  const g = new THREE.Group();
  const m = mat('#cfc7ae');
  const shaft = mesh(G.cyl(), m, 0, 0.06, 0, 0.06, 0.7, 0.06);
  shaft.rotation.z = Math.PI / 2;
  shaft.rotation.y = variant * 0.7;
  g.add(shaft);
  return g;
}

export function makeFern(variant: number): THREE.Group {
  const g = new THREE.Group();
  const greens = ['#3f6b34', '#4a7a3e', '#356030', '#548a46'];
  const m = mat(greens[variant % 4]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const blade = mesh(G.cone(), m, Math.cos(a) * 0.16, 0.22, Math.sin(a) * 0.16, 0.1, 0.5, 0.1);
    blade.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    g.add(blade);
  }
  return g;
}

export function makeReed(): THREE.Group {
  const g = new THREE.Group();
  const m = mat('#7a8a4a');
  for (let i = 0; i < 4; i++) {
    const h = 0.8 + (i % 3) * 0.25;
    const s = mesh(G.cyl(), m, (i - 1.5) * 0.1, h / 2, (i % 2) * 0.08, 0.035, h, 0.035);
    s.rotation.z = (i - 1.5) * 0.06;
    g.add(s);
  }
  return g;
}

export function makeFlower(variant: number): THREE.Group {
  const g = new THREE.Group();
  const cols = ['#e0607a', '#e8c15a', '#8f7fe0', '#e88f5a'];
  g.add(mesh(G.cyl(), mat('#5f8a46'), 0, 0.16, 0, 0.025, 0.32, 0.025));
  g.add(mesh(G.sphere(), mat(cols[variant % 4]), 0, 0.34, 0, 0.14, 0.1, 0.14));
  return g;
}

// ------------------------------------------------------------------ actors

export interface ActorParts {
  root: THREE.Group;
  body: THREE.Mesh;
  head?: THREE.Mesh;
}

/** A stubby low-poly person. Used for NPCs and humanoid monsters. */
export function makePerson(
  cloth: string, skin: string, hair: string, scale = 1,
): ActorParts {
  const root = new THREE.Group();
  const legH = 0.5 * scale;
  const bodyH = 0.72 * scale;
  root.add(mesh(G.box(), mat(shade(cloth, -46)), -0.13 * scale, legH / 2, 0, 0.2 * scale, legH, 0.22 * scale));
  root.add(mesh(G.box(), mat(shade(cloth, -46)), 0.13 * scale, legH / 2, 0, 0.2 * scale, legH, 0.22 * scale));
  const body = mesh(G.box(), mat(cloth), 0, legH + bodyH / 2, 0, 0.56 * scale, bodyH, 0.36 * scale);
  root.add(body);
  root.add(mesh(G.box(), mat(skin), -0.34 * scale, legH + bodyH * 0.62, 0, 0.14 * scale, 0.5 * scale, 0.16 * scale));
  root.add(mesh(G.box(), mat(skin), 0.34 * scale, legH + bodyH * 0.62, 0, 0.14 * scale, 0.5 * scale, 0.16 * scale));
  const head = mesh(G.sphere(), mat(skin), 0, legH + bodyH + 0.24 * scale, 0, 0.46 * scale, 0.48 * scale, 0.44 * scale);
  root.add(head);
  const cap = mesh(G.sphere(), mat(hair), 0, legH + bodyH + 0.31 * scale, -0.02 * scale, 0.48 * scale, 0.34 * scale, 0.46 * scale);
  root.add(cap);
  return { root, body, head };
}

/** Four legs, low head. Boars, wolves, bears. */
export function makeBeast(color: string, accent: string, scale = 1): ActorParts {
  const root = new THREE.Group();
  const m = mat(color);
  const legH = 0.42 * scale;
  for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    root.add(mesh(G.box(), mat(shade(color, -40)), lx * scale, legH / 2, lz * scale,
      0.16 * scale, legH, 0.16 * scale));
  }
  const body = mesh(G.box(), m, 0, legH + 0.32 * scale, 0, 0.86 * scale, 0.62 * scale, 1.24 * scale);
  root.add(body);
  const head = mesh(G.box(), mat(shade(color, -12)), 0, legH + 0.44 * scale, 0.78 * scale,
    0.54 * scale, 0.5 * scale, 0.52 * scale);
  root.add(head);
  root.add(mesh(G.box(), mat(accent), -0.18 * scale, legH + 0.36 * scale, 1.02 * scale,
    0.08 * scale, 0.2 * scale, 0.1 * scale));
  root.add(mesh(G.box(), mat(accent), 0.18 * scale, legH + 0.36 * scale, 1.02 * scale,
    0.08 * scale, 0.2 * scale, 0.1 * scale));
  return { root, body, head };
}

export function makeOoze(color: string, accent: string, scale = 1): ActorParts {
  const root = new THREE.Group();
  const body = mesh(G.sphere(), mat(color, { opacity: 0.92 }), 0, 0.42 * scale, 0,
    1.1 * scale, 0.86 * scale, 1.1 * scale);
  root.add(body);
  root.add(mesh(G.sphere(), mat(accent), -0.2 * scale, 0.58 * scale, 0.42 * scale, 0.16, 0.16, 0.16));
  root.add(mesh(G.sphere(), mat(accent), 0.2 * scale, 0.58 * scale, 0.42 * scale, 0.16, 0.16, 0.16));
  return { root, body };
}

// ------------------------------------------------------------------ ground

/** One canvas covering the whole map, painted like the old tile pass. */
export function groundTexture(
  w: number, h: number, tiles: Uint8Array, c1: string, c2: string,
): THREE.CanvasTexture {
  const px = 4;
  const cv = document.createElement('canvas');
  cv.width = w * px; cv.height = h * px;
  const c = cv.getContext('2d')!;
  c.fillStyle = c1;
  c.fillRect(0, 0, cv.width, cv.height);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (!tiles[ty * w + tx]) continue;
      c.globalAlpha = 0.35;
      c.fillStyle = c2;
      c.fillRect(tx * px, ty * px, px, px);
      c.globalAlpha = 1;
    }
  }
  // a little noise so large flats do not read as plastic
  for (let i = 0; i < w * h * 2; i++) {
    const x = Math.floor(Math.random() * cv.width);
    const y = Math.floor(Math.random() * cv.height);
    c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.045)';
    c.fillRect(x, y, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The map floor as a shape with the ravines cut out of it, so you can see and
 * fall into real holes rather than looking at a dark rug.
 */
export function makeGround(
  wTiles: number, hTiles: number, tileSize: number,
  chasms: { x: number; y: number; w: number; h: number }[],
  tex: THREE.Texture, color: string, material?: THREE.Material,
): THREE.Mesh {
  const W = wTiles * tileSize * SCALE;
  const H = hTiles * tileSize * SCALE;
  // The shape is built with y negated so that rotating it -90 degrees about X
  // lands it at +z with its normal pointing up. Getting this backwards puts the
  // whole map behind the origin, which is a memorable way to lose an afternoon.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(W, 0);
  shape.lineTo(W, -H);
  shape.lineTo(0, -H);
  shape.closePath();
  for (const c of chasms) {
    const hole = new THREE.Path();
    const x0 = c.x * SCALE, y0 = -c.y * SCALE;
    const x1 = (c.x + c.w) * SCALE, y1 = -(c.y + c.h) * SCALE;
    hole.moveTo(x0, y0);
    hole.lineTo(x0, y1);
    hole.lineTo(x1, y1);
    hole.lineTo(x1, y0);
    hole.closePath();
    shape.holes.push(hole);
  }
  const g = new THREE.ShapeGeometry(shape, 2);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / W;
    uv[i * 2 + 1] = 1 - pos.getZ(i) / H;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = material ?? new THREE.MeshLambertMaterial({ map: tex, color: new THREE.Color(color) });
  const mesh0 = new THREE.Mesh(g, m);
  mesh0.receiveShadow = true;
  return mesh0;
}

/**
 * Ground that carries on past the edge of the map. Without it the tilted
 * camera looks straight off the world into the background colour. The map
 * area is cut out, so holes in the real ground still read as holes.
 */
export function makeSkirt(
  W: number, H: number, pad: number, color: string, material?: THREE.Material,
): THREE.Mesh {
  // The cut-out is a little smaller than the map, so the skirt tucks under its
  // edge instead of leaving a hairline of background showing between the two.
  const lap = 1;
  const shape = new THREE.Shape();
  shape.moveTo(-pad, pad);
  shape.lineTo(W + pad, pad);
  shape.lineTo(W + pad, -(H + pad));
  shape.lineTo(-pad, -(H + pad));
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(lap, -lap);
  hole.lineTo(lap, -(H - lap));
  hole.lineTo(W - lap, -(H - lap));
  hole.lineTo(W - lap, -lap);
  hole.closePath();
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const mm = material ?? new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
  mm.polygonOffset = true;
  mm.polygonOffsetFactor = 2;
  mm.polygonOffsetUnits = 4;
  const m = new THREE.Mesh(g, mm);
  m.position.y = -0.04;
  m.receiveShadow = true;
  return m;
}
