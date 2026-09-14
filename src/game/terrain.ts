import { RNG } from './rng';

/**
 * Zones are a grid of columns, Minecraft style. Every tile has a height in
 * steps and a kind. One step up you simply walk; two steps needs a jump; three
 * needs the high vault; anything taller is a wall. You can always walk off an
 * edge, and a ravine is a real hole you can fall into.
 */

export const TS = 48;
/** sim units per height step */
export const STEP = 12;

export const T_GROUND = 0;
export const T_PIT = 1;
export const T_WATER = 2;
export const T_BRIDGE = 3;

/** standing height of a ravine floor */
export const PIT_Z = -84;
/** outside the map entirely */
export const OUT_Z = 99999;

export type TerrainStyle = 'meadow' | 'woods' | 'fen' | 'barrows' | 'mountain' | 'ashen';

export interface Terrain {
  w: number; h: number;
  /** height of each tile, in steps */
  hts: Uint8Array;
  /** T_GROUND, T_PIT, T_WATER or T_BRIDGE */
  ter: Uint8Array;
  /** 1 where the tile is part of the wall around the zone */
  border: Uint8Array;
  /** 1 where you can walk to from the road in without jumping */
  reach: Uint8Array;
  style: TerrainStyle;
  /** the column the bridge out of the zone crosses the river at */
  exitTx: number;
  /** the flat top where a boss waits, in tiles */
  arena: { tx: number; ty: number; r: number } | null;
}

// ------------------------------------------------------------------- queries

export function tileIndex(t: Terrain, x: number, y: number): number {
  const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
  if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return -1;
  return ty * t.w + tx;
}

/** The height you would stand at over (x, y), in sim units. */
export function groundAt(t: Terrain, x: number, y: number): number {
  const i = tileIndex(t, x, y);
  if (i < 0) return OUT_Z;
  if (t.ter[i] === T_PIT) return PIT_Z;
  return t.hts[i] * STEP;
}

export function kindAt(t: Terrain, x: number, y: number): number {
  const i = tileIndex(t, x, y);
  return i < 0 ? T_GROUND : t.ter[i];
}

export function isPit(t: Terrain, x: number, y: number): boolean {
  return kindAt(t, x, y) === T_PIT;
}

export function isWater(t: Terrain, x: number, y: number): boolean {
  const i = tileIndex(t, x, y);
  return i >= 0 && t.ter[i] === T_WATER;
}

/** Somewhere a monster, a tree or a treasure can sit. */
export function isOpen(t: Terrain, x: number, y: number): boolean {
  const i = tileIndex(t, x, y);
  if (i < 0) return false;
  return (t.ter[i] === T_GROUND) && !t.border[i] && t.reach[i] === 1;
}

/** Could a walker with no jump move from height `fromZ` onto (x, y)? */
export function walkable(t: Terrain, fromZ: number, x: number, y: number): boolean {
  const i = tileIndex(t, x, y);
  if (i < 0) return false;
  const k = t.ter[i];
  if (k === T_PIT || k === T_WATER) return false;
  return t.hts[i] * STEP <= fromZ + STEP + 0.5;
}

// --------------------------------------------------------------------- noise

type Noise = (x: number, y: number) => number;

function makeNoise(seed: number): Noise {
  const r = new RNG(seed);
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  r.shuffle(base);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = r.float(-1, 1);
  const at = (i: number, j: number) => vals[perm[(perm[i & 255] + j) & 255]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
}

function fbm(n: Noise, x: number, y: number, octaves = 4): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += n(x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function gauss(dx: number, dy: number, s: number): number {
  return Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
}

export function noiseFor(seed: number): { at: Noise; fbm: (x: number, y: number, o?: number) => number } {
  const n = makeNoise(seed);
  return { at: n, fbm: (x, y, o = 4) => fbm(n, x, y, o) };
}

// ---------------------------------------------------------------- generation

/** Continuous height, in steps, before it is cut into columns. */
function heightField(style: TerrainStyle, w: number, h: number, seed: number): (tx: number, ty: number) => number {
  const n = makeNoise(seed);
  const m = makeNoise(seed ^ 0x5bd1e995);
  return (tx, ty) => {
    const nx = tx / (w - 1), ny = ty / (h - 1);
    switch (style) {
      case 'meadow':
        return (fbm(n, tx * 0.055, ty * 0.055) + 0.12) * 5.2 + (1 - ny) * 1.2;
      case 'woods':
        return (fbm(n, tx * 0.07, ty * 0.07) + 0.18) * 6 + (1 - ny) * 1.6;
      case 'fen':
        return (fbm(n, tx * 0.09, ty * 0.09) - 0.02) * 3.2;
      case 'barrows':
        return Math.abs(fbm(n, tx * 0.08, ty * 0.08)) * 9 + (1 - ny) * 1.2 - 0.4;
      case 'ashen':
        return Math.abs(fbm(n, tx * 0.06, ty * 0.06)) * 4.2 + (1 - ny) * 0.8;
      case 'mountain': {
        // One great mass rising to the north, with shoulders to either side and
        // hollows in its flanks. The southern quarter stays foothills.
        let v = Math.pow(1 - ny, 1.08) * 14.5;
        v += gauss(nx - 0.5, ny - 0.1, 0.15) * 5;
        v += gauss(nx - 0.2, ny - 0.34, 0.11) * 4.2;
        v += gauss(nx - 0.8, ny - 0.3, 0.12) * 4.6;
        v -= gauss(nx - 0.34, ny - 0.56, 0.08) * 3.4;
        v -= gauss(nx - 0.68, ny - 0.63, 0.08) * 3.2;
        v += ((1 - Math.abs(fbm(m, tx * 0.08, ty * 0.08))) * 3 - 1.6);
        v += fbm(n, tx * 0.16, ty * 0.16) * 1.6;
        if (ny > 0.78) v *= Math.max(0.15, (1 - ny) / 0.22);
        return Math.min(19, v);
      }
    }
  };
}

export function generateTerrain(style: TerrainStyle, w: number, h: number, r: RNG): Terrain {
  const N = w * h;
  const hts = new Uint8Array(N);
  const ter = new Uint8Array(N);
  const border = new Uint8Array(N);
  const reach = new Uint8Array(N);
  const exitTx = Math.floor(w / 2);
  const idx = (x: number, y: number) => y * w + x;
  const field = heightField(style, w, h, r.int(1, 0x7ffffff));
  const jag = makeNoise(r.int(1, 0x7ffffff));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      hts[idx(x, y)] = Math.max(0, Math.min(40, Math.floor(field(x, y))));
    }
  }

  // --------------------------------------------------------- water and holes
  if (style === 'fen') {
    const pools = makeNoise(r.int(1, 0x7ffffff));
    for (let y = 4; y < h - 8; y++) {
      for (let x = 4; x < w - 4; x++) {
        if (fbm(pools, x * 0.12, y * 0.12, 3) < -0.26) {
          ter[idx(x, y)] = T_WATER;
          hts[idx(x, y)] = 0;
        }
      }
    }
  }
  const ravines = style === 'mountain' ? 4 : style === 'ashen' ? 9 : style === 'barrows' ? 7
    : style === 'fen' ? 4 : 2;
  for (let i = 0; i < ravines; i++) {
    const horizontal = r.chance(0.6);
    const len = r.int(3, style === 'ashen' ? 8 : 6);
    const thick = r.int(1, 2);
    const x0 = r.int(4, w - 5 - (horizontal ? len : thick));
    const y0 = r.int(style === 'mountain' ? Math.floor(h * 0.42) : 5, h - 12 - (horizontal ? thick : len));
    for (let a = 0; a < len; a++) {
      for (let b = 0; b < thick; b++) {
        const x = horizontal ? x0 + a : x0 + b;
        const y = horizontal ? y0 + b : y0 + a;
        if (Math.abs(x - exitTx) < 5 && y > h - 14) continue;
        ter[idx(x, y)] = T_PIT;
      }
    }
  }

  // ------------------------------------------------------------ the summit
  let arena: Terrain['arena'] = null;
  if (style === 'mountain') {
    arena = { tx: exitTx, ty: 6, r: 5 };
  } else if (style !== 'fen') {
    arena = { tx: exitTx + r.int(-6, 6), ty: r.int(7, 10), r: 4 };
  }
  if (arena) {
    const top = hts[idx(arena.tx, arena.ty)];
    for (let y = arena.ty - arena.r; y <= arena.ty + arena.r; y++) {
      for (let x = arena.tx - arena.r - 1; x <= arena.tx + arena.r + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (Math.hypot(x - arena.tx, (y - arena.ty) * 1.2) > arena.r + 0.5) continue;
        hts[idx(x, y)] = top;
        ter[idx(x, y)] = T_GROUND;
      }
    }
  }

  // ------------------------------------------- the road in, and the clearing
  for (let y = h - 10; y < h; y++) {
    for (let x = exitTx - 4; x <= exitTx + 4; x++) {
      hts[idx(x, y)] = 0;
      ter[idx(x, y)] = T_GROUND;
    }
  }

  // ------------------------------------------------------------ the border
  const wallRise = style === 'mountain' ? 6 : 5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const thick = 2 + (jag(x * 0.35, y * 0.35) > 0.25 ? 1 : 0);
      const edge = Math.min(x, w - 1 - x, y);
      if (edge >= thick) continue;
      if (y >= h - 4) continue;
      border[idx(x, y)] = 1;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (!border[i]) continue;
      let near = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || border[idx(xx, yy)]) continue;
          near = Math.max(near, hts[idx(xx, yy)]);
        }
      }
      hts[i] = Math.min(60, near + wallRise + (jag(x * 0.5 + 7, y * 0.5) > 0 ? 1 : 0));
      ter[i] = T_GROUND;
    }
  }

  // ------------------------------------------- the river along the south edge
  for (let y = h - 3; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      hts[i] = 0;
      ter[i] = Math.abs(x - exitTx) <= 1 ? T_BRIDGE : T_WATER;
      border[i] = 0;
    }
  }
  for (let x = 0; x < w; x++) {
    if (!border[idx(x, h - 4)]) { hts[idx(x, h - 4)] = 0; ter[idx(x, h - 4)] = T_GROUND; }
  }

  carveReach(w, h, hts, ter, border, reach, idx(exitTx, h - 6));
  return { w, h, hts, ter, border, reach, style, exitTx, arena };
}

/**
 * Make sure every open tile can be walked to from the road without jumping.
 * Where a ledge cannot be reached, cut the smallest possible stair into it and
 * carry on. Cliffs survive everywhere a path already exists, so jumping is
 * always a shortcut and never a requirement.
 */
function carveReach(
  w: number, h: number, hts: Uint8Array, ter: Uint8Array,
  border: Uint8Array, reach: Uint8Array, start: number,
): void {
  const N = w * h;
  const open = (i: number) => !border[i] && (ter[i] === T_GROUND || ter[i] === T_BRIDGE);
  const queue: number[] = [];
  const visit = (i: number) => {
    if (reach[i] || !open(i)) return;
    reach[i] = 1;
    queue.push(i);
  };
  const flood = () => {
    while (queue.length) {
      const c = queue.pop()!;
      const cx = c % w, cy = (c / w) | 0;
      const around: [number, number][] = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (const [x, y] of around) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const n = y * w + x;
        if (hts[n] <= hts[c] + 1) visit(n);
      }
    }
  };
  visit(start);
  flood();

  for (let guard = 0; guard < 4000; guard++) {
    let bestA = -1, bestB = -1, bestD = Infinity, bridge = -1;
    let missing = false;
    for (let b = 0; b < N; b++) {
      if (reach[b] || border[b]) continue;
      if (ter[b] === T_GROUND || ter[b] === T_BRIDGE) missing = true;
      const bx = b % w, by = (b / w) | 0;
      const around: [number, number][] = [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]];
      for (const [x, y] of around) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const a = y * w + x;
        if (!reach[a]) continue;
        if (open(b)) {
          const d = hts[b] - hts[a];
          if (d < bestD) { bestD = d; bestA = a; bestB = b; }
        } else if (bridge < 0 && (ter[b] === T_WATER || ter[b] === T_PIT)) {
          // a hole or pool between here and somewhere unreachable: fill it
          for (const [ux, uy] of [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]] as [number, number][]) {
            if (ux < 0 || uy < 0 || ux >= w || uy >= h) continue;
            const u = uy * w + ux;
            if (!reach[u] && open(u)) { bridge = b; bestA = bestB < 0 ? a : bestA; break; }
          }
        }
      }
    }
    if (!missing) return;
    if (bestB >= 0) {
      hts[bestB] = Math.min(hts[bestB], hts[bestA] + 1);
      visit(bestB);
    } else if (bridge >= 0) {
      ter[bridge] = T_GROUND;
      hts[bridge] = hts[bestA];
      visit(bridge);
    } else {
      return;
    }
    flood();
  }
}

/** A random open tile, as sim coordinates at its centre, or null. */
export function randomOpen(
  t: Terrain, r: RNG, ok: (x: number, y: number) => boolean = () => true, tries = 60,
): [number, number] | null {
  for (let i = 0; i < tries; i++) {
    const x = r.float(TS * 2, (t.w - 2) * TS);
    const y = r.float(TS * 2, (t.h - 4) * TS);
    if (isOpen(t, x, y) && ok(x, y)) return [x, y];
  }
  return null;
}
