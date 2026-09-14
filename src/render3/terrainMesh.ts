import * as THREE from 'three';
import { SCALE } from './core';
import { RNG } from '../game/rng';
import type { ZoneDef } from '../game/content';
import {
  STEP, T_BRIDGE, T_PIT, T_WATER, TS, Terrain, TerrainStyle, noiseFor,
} from '../game/terrain';
import { grainTexture, soft, tex, tracePath, waterMaterial, withGrain } from './paint';

/**
 * The zone and the land around it, as one grid of columns. The playable map
 * sits in the middle; the outlands carry the same terrain on past its edges,
 * rising into hills or peaks, so the world never stops at a line.
 */

/** tiles of outlands to the north, east and west */
export const OUT = 20;
/** tiles of outlands to the south, past the river */
export const OUT_S = 12;
/** one tile, in world units */
export const TILE_U = TS * SCALE;
/** one height step, in world units */
export const STEP_U = STEP * SCALE;
const PIT_FLOOR = -6;
const WATER_Y = -0.32;
const PX = 24;

export interface WorldGrid {
  w: number; h: number;
  /** map tile coordinates of grid tile (0, 0) */
  ox: number; oy: number;
  hts: Int16Array;
  ter: Uint8Array;
  inMap: Uint8Array;
  map: Terrain;
}

export function buildWorldGrid(t: Terrain, seed: number): WorldGrid {
  const w = t.w + OUT * 2, h = t.h + OUT + OUT_S;
  const ox = -OUT, oy = -OUT;
  const hts = new Int16Array(w * h);
  const ter = new Uint8Array(w * h);
  const inMap = new Uint8Array(w * h);
  const n = noiseFor(seed ^ 0x2545f491);
  const style = t.style;
  const slope = style === 'mountain' ? 0.9 : style === 'fen' ? 0.1 : style === 'ashen' ? 0.22 : style === 'barrows' ? 0.38 : 0.3;
  const amp = style === 'mountain' ? 6 : style === 'fen' ? 1.4 : 3.2;

  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const mx = gx + ox, my = gy + oy;
      const gi = gy * w + gx;
      if (mx >= 0 && my >= 0 && mx < t.w && my < t.h) {
        const i = my * t.w + mx;
        hts[gi] = t.hts[i];
        ter[gi] = t.ter[i];
        inMap[gi] = 1;
        continue;
      }
      // the river keeps running east and west, out of sight
      if (my >= t.h - 3 && my < t.h) { ter[gi] = T_WATER; continue; }
      const dx = mx < 0 ? -mx : mx >= t.w ? mx - t.w + 1 : 0;
      const dy = my < 0 ? -my : my >= t.h ? my - t.h + 1 : 0;
      const dOut = Math.max(dx, dy);
      const nv = n.fbm(gx * 0.09, gy * 0.09, 4);
      if (my >= t.h) {
        // lowlands past the river: fields and copses, the road running south
        if (Math.abs(mx - t.exitTx) <= 1) continue;
        hts[gi] = Math.max(0, Math.floor((dOut - 2) * 0.25 + nv * 2.4));
        continue;
      }
      const cx = Math.max(0, Math.min(t.w - 1, mx)), cy = Math.max(0, Math.min(t.h - 1, my));
      let v = t.hts[cy * t.w + cx] + dOut * slope + nv * amp;
      if (style === 'mountain') v += Math.max(0, dOut - 5) * 0.45 + n.fbm(gx * 0.21, gy * 0.21, 2) * 2.5;
      hts[gi] = Math.max(0, Math.min(90, Math.floor(v)));
      if (style === 'fen' && nv < -0.3 && dOut > 2) { ter[gi] = T_WATER; hts[gi] = 0; }
    }
  }
  return { w, h, ox, oy, hts, ter, inMap, map: t };
}

// ------------------------------------------------------------------ palette

interface Band { ground: [string, string]; wall: string; lip: string | null }

function band(style: TerrainStyle, steps: number, def: ZoneDef): Band {
  switch (style) {
    case 'mountain':
      if (steps <= 3) return { ground: ['#5f8a4c', '#6a9454'], wall: '#7a5f46', lip: '#6f9e58' };
      if (steps <= 7) return { ground: ['#6a8352', '#768660'], wall: '#6f6a64', lip: '#7a9a60' };
      if (steps <= 12) return { ground: ['#8a877f', '#7b7870'], wall: '#5f646d', lip: null };
      return { ground: ['#dde5ec', '#cdd7e0'], wall: '#6d7885', lip: '#eef3f8' };
    case 'ashen':
      return { ground: ['#5c4c46', '#4e403b'], wall: '#4a3a36', lip: '#6a5a52' };
    case 'barrows':
      return { ground: [def.ground, def.ground2], wall: '#5d5866', lip: '#6a6478' };
    case 'fen':
      return { ground: [def.ground, def.ground2], wall: '#6f6a57', lip: '#63765a' };
    case 'woods':
      return { ground: [def.ground, def.ground2], wall: '#7a6450', lip: '#557f48' };
    default:
      return { ground: [def.ground, def.ground2], wall: '#8a7156', lip: '#77a85c' };
  }
}

function rgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ----------------------------------------------------------------- painting

export interface WorldPaint { map: THREE.CanvasTexture; glow: THREE.CanvasTexture | null }

/** One painting over the whole grid, map and outlands alike, at map detail. */
export function paintWorld(grid: WorldGrid, def: ZoneDef, seed: number): WorldPaint {
  const W = grid.w * PX, H = grid.h * PX;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const r = new RNG(seed ^ 0x51ed270b);
  const n = noiseFor(seed ^ 0x68e31da4);
  const style = grid.map.style;
  const at = (gx: number, gy: number) => gy * grid.w + gx;

  const colorOf = (gx: number, gy: number): string => {
    const gi = at(gx, gy);
    const b = band(style, grid.hts[gi], def);
    return n.at(gx * 0.7, gy * 0.7) > 0 ? b.ground[0] : b.ground[1];
  };

  // flat colour per column, then soft stains over it so the grid disappears
  for (let gy = 0; gy < grid.h; gy++) {
    for (let gx = 0; gx < grid.w; gx++) {
      const gi = at(gx, gy);
      const k = grid.ter[gi];
      c.fillStyle = k === T_PIT ? '#1f1712' : k === T_WATER || k === T_BRIDGE ? '#3f5f62' : colorOf(gx, gy);
      c.fillRect(gx * PX, gy * PX, PX, PX);
    }
  }
  for (let i = 0; i < grid.w * grid.h * 1.1; i++) {
    const gx = r.int(0, grid.w - 1), gy = r.int(0, grid.h - 1);
    const gi = at(gx, gy);
    if (grid.ter[gi] !== 0) continue;
    const x = (gx + r.next()) * PX, y = (gy + r.next()) * PX;
    soft(c, x, y, PX * r.float(0.7, 1.3), colorOf(gx, gy), 0.5);
  }
  // hollows and sunlit swells, much bigger than a tile
  for (let i = 0; i < (W * H) / 9000; i++) {
    const dark = r.chance(0.55);
    soft(c, r.float(0, W), r.float(0, H), r.float(30, 90), dark ? '#20180f' : '#fff4d0', dark ? 0.14 : 0.08);
  }
  if (style === 'mountain') {
    // bare rock breaking through the grass, and scree below the cliffs
    for (let i = 0; i < (W * H) / 5000; i++) {
      const gx = r.int(0, grid.w - 1), gy = r.int(0, grid.h - 1);
      const s = grid.hts[at(gx, gy)];
      if (s < 3 || s > 12) continue;
      soft(c, (gx + r.next()) * PX, (gy + r.next()) * PX, r.float(8, 20), '#8a8780', 0.45);
    }
  }

  // shadow gathering at the foot of every wall, light catching every lip
  const edge = (gx: number, gy: number, dx: number, dy: number, color: string, a: number, depth: number) => {
    const x = gx * PX, y = gy * PX;
    let g: CanvasGradient;
    if (dx === 1) { g = c.createLinearGradient(x + PX, 0, x + PX - depth, 0); }
    else if (dx === -1) { g = c.createLinearGradient(x, 0, x + depth, 0); }
    else if (dy === 1) { g = c.createLinearGradient(0, y + PX, 0, y + PX - depth); }
    else { g = c.createLinearGradient(0, y, 0, y + depth); }
    g.addColorStop(0, color.replace('A', String(a)));
    g.addColorStop(1, color.replace('A', '0'));
    c.fillStyle = g;
    c.fillRect(x, y, PX, PX);
  };
  for (let gy = 0; gy < grid.h; gy++) {
    for (let gx = 0; gx < grid.w; gx++) {
      const gi = at(gx, gy);
      if (grid.ter[gi] !== 0) continue;
      const me = grid.hts[gi];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
        const ni = at(nx, ny);
        if (grid.ter[ni] !== 0 && grid.ter[ni] !== T_BRIDGE) {
          if (grid.ter[ni] === T_PIT) edge(gx, gy, dx, dy, 'rgba(30,18,10,A)', 0.55, PX * 0.5);
          continue;
        }
        const them = grid.hts[ni];
        if (them > me) edge(gx, gy, dx, dy, 'rgba(24,16,10,A)', Math.min(0.5, 0.2 + (them - me) * 0.08), PX * 0.75);
        else if (them < me) edge(gx, gy, dx, dy, 'rgba(255,248,220,A)', 0.22, PX * 0.18);
      }
    }
  }

  // the track in from the bridge, and the road south past the river
  const exX = (grid.map.exitTx - grid.ox + 0.5) * PX;
  const roadTop = (grid.map.h - 9 - grid.oy) * PX;
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(146,122,90,0.85)';
  c.lineWidth = PX * 1.6;
  c.beginPath(); c.moveTo(exX, roadTop); c.lineTo(exX, H + PX); c.stroke();
  c.strokeStyle = 'rgba(122,100,72,0.7)';
  c.lineWidth = PX * 0.9;
  c.beginPath(); c.moveTo(exX, roadTop + PX); c.lineTo(exX, H + PX); c.stroke();
  for (let i = 0; i < 160; i++) {
    const y = r.float(roadTop, H), x = exX + r.float(-PX * 0.7, PX * 0.7);
    c.fillStyle = r.chance(0.5) ? 'rgba(176,152,116,0.5)' : 'rgba(96,78,56,0.35)';
    c.beginPath(); c.ellipse(x, y, r.float(1.5, 3.5), r.float(1, 2.5), 0, 0, Math.PI * 2); c.fill();
  }

  let glow: THREE.CanvasTexture | null = null;
  if (style === 'ashen') {
    // the field smoulders: dark scars with a hot seam, painted again for the bloom
    const gcv = document.createElement('canvas');
    gcv.width = W; gcv.height = H;
    const g = gcv.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    for (const ctx of [c, g]) { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }
    for (let i = 0; i < (W * H) / 26000; i++) {
      let x = r.float(0, W), y = r.float(0, H), ang = r.float(0, Math.PI * 2);
      const pts: [number, number][] = [[x, y]];
      for (let k = 0; k < r.int(5, 13); k++) {
        ang += r.float(-0.9, 0.9);
        const len = r.float(5, 13);
        x += Math.cos(ang) * len;
        y += Math.sin(ang) * len;
        pts.push([x, y]);
      }
      tracePath(c, pts); c.strokeStyle = 'rgba(30,16,10,0.7)'; c.lineWidth = 3.6; c.stroke();
      tracePath(c, pts); c.strokeStyle = '#d8602a'; c.lineWidth = 1.2; c.stroke();
      tracePath(g, pts); g.strokeStyle = 'rgba(255,110,40,0.45)'; g.lineWidth = 3.2; g.stroke();
      tracePath(g, pts); g.strokeStyle = '#ffb060'; g.lineWidth = 1.2; g.stroke();
    }
    glow = tex(gcv);
  }
  return { map: tex(cv), glow };
}

// ------------------------------------------------------------------- meshes

let stoneTex: THREE.CanvasTexture | null = null;
let lipTex: THREE.CanvasTexture | null = null;

/** A pale stone that the wall colour tints: layered courses, lit tops, dark cracks. */
function stoneTexture(): THREE.CanvasTexture {
  if (stoneTex) return stoneTex;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#c9c2b6';
  c.fillRect(0, 0, S, S);
  const r = new RNG(71);
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  for (let i = 0; i < 70; i++) {
    const x = r.float(0, S), y = r.float(0, S), w = r.float(14, 34), h = r.float(8, 16);
    const v = r.int(-24, 22);
    const tone = 'rgb(' + (201 + v) + ',' + (194 + v) + ',' + (182 + v) + ')';
    wrap((ox, oy) => {
      c.fillStyle = 'rgba(40,30,20,0.28)';
      c.beginPath(); c.roundRect(x + ox, y + oy + 2, w, h, 4); c.fill();
      c.fillStyle = tone;
      c.beginPath(); c.roundRect(x + ox, y + oy, w, h, 4); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.2)';
      c.fillRect(x + ox + 3, y + oy + 1, Math.max(1, w - 6), 2);
    });
  }
  stoneTex = tex(cv, true);
  (stoneTex as { keep?: boolean }).keep = true;
  return stoneTex;
}

/** Turf curling over a lip: white, so each band can tint it grass, snow or ash. */
function lipTexture(): THREE.CanvasTexture {
  if (lipTex) return lipTex;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d')!;
  const r = new RNG(9);
  c.fillStyle = '#b8b8b8';
  c.fillRect(0, 0, S, S * 0.3);
  for (let x = -4; x < S + 4; x += r.float(3, 6)) {
    const len = r.float(S * 0.25, S * 0.75), wd = r.float(2.5, 5);
    for (const ox of [-S, 0, S]) {
      c.fillStyle = '#9a9a9a';
      c.beginPath(); c.ellipse(x + ox, S * 0.26, wd, len * 0.55, 0, 0, Math.PI); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.ellipse(x + ox, S * 0.22, wd * 0.8, len * 0.45, 0, 0, Math.PI); c.fill();
    }
  }
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, S, S * 0.2);
  lipTex = tex(cv, true);
  (lipTex as { keep?: boolean }).keep = true;
  return lipTex;
}

function topY(grid: WorldGrid, gi: number): number {
  const k = grid.ter[gi];
  if (k === T_PIT) return PIT_FLOOR;
  if (k === T_WATER || k === T_BRIDGE) return WATER_Y;
  return grid.hts[gi] * STEP_U;
}

export interface TerrainMeshes {
  group: THREE.Group;
  water: THREE.MeshLambertMaterial;
  dispose: () => void;
}

export function buildTerrainMeshes(grid: WorldGrid, def: ZoneDef, paint: WorldPaint): TerrainMeshes {
  const group = new THREE.Group();
  const style = grid.map.style;
  const disposables: { dispose: () => void }[] = [];

  // ---------------------------------------------------------------- tops
  const tp: number[] = [], tu: number[] = [], ti: number[] = [];
  const wp: number[] = [], wu: number[] = [], wi: number[] = [];
  for (let gy = 0; gy < grid.h; gy++) {
    for (let gx = 0; gx < grid.w; gx++) {
      const gi = gy * grid.w + gx;
      const k = grid.ter[gi];
      const x0 = (gx + grid.ox) * TILE_U, x1 = x0 + TILE_U;
      const z0 = (gy + grid.oy) * TILE_U, z1 = z0 + TILE_U;
      if (k === T_WATER || k === T_BRIDGE) {
        const b = wp.length / 3;
        wp.push(x0, WATER_Y, z0, x1, WATER_Y, z0, x1, WATER_Y, z1, x0, WATER_Y, z1);
        wu.push(x0 / 3, -z0 / 3, x1 / 3, -z0 / 3, x1 / 3, -z1 / 3, x0 / 3, -z1 / 3);
        wi.push(b, b + 2, b + 1, b, b + 3, b + 2);
        continue;
      }
      const y = topY(grid, gi);
      const b = tp.length / 3;
      tp.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      const u0 = gx / grid.w, u1 = (gx + 1) / grid.w;
      const v0 = 1 - gy / grid.h, v1 = 1 - (gy + 1) / grid.h;
      tu.push(u0, v0, u1, v0, u1, v1, u0, v1);
      ti.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
  topGeo.setIndex(ti);
  topGeo.computeVertexNormals();
  const grain = grainTexture(style === 'mountain' || style === 'ashen' || style === 'barrows' ? 'gravel' : 'grass');
  const topMat = withGrain(new THREE.MeshLambertMaterial({ map: paint.map }), grain, 1.1);
  if (paint.glow) {
    topMat.emissiveMap = paint.glow;
    topMat.emissive = new THREE.Color('#ffffff');
    topMat.emissiveIntensity = 1.8;
  }
  const tops = new THREE.Mesh(topGeo, topMat);
  tops.receiveShadow = true;
  group.add(tops);
  disposables.push(topGeo, topMat);

  const water = waterMaterial();
  if (wp.length) {
    const waterGeo = new THREE.BufferGeometry();
    waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
    waterGeo.setIndex(wi);
    waterGeo.computeVertexNormals();
    const wm = new THREE.Mesh(waterGeo, water);
    wm.receiveShadow = true;
    group.add(wm);
    disposables.push(waterGeo);
  }

  // ---------------------------------------------------------------- walls
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const lp: number[] = [], ln: number[] = [], lu: number[] = [], lc: number[] = [], li: number[] = [];

  const addWall = (
    ax: number, az: number, bx: number, bz: number, nx: number, nz: number,
    yBot: number, yTop: number, wall: [number, number, number], lip: [number, number, number] | null,
  ) => {
    if (yTop - yBot < 0.05) return;
    // wind the quad so its face points along (nx, nz)
    if ((bx - ax) * nz - (bz - az) * nx < 0) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
    const len = Math.hypot(bx - ax, bz - az);
    const base = pos.length / 3;
    pos.push(ax, yBot, az, bx, yBot, bz, bx, yTop, bz, ax, yTop, az);
    for (let i = 0; i < 4; i++) nor.push(nx, 0, nz);
    uv.push(0, yBot / TILE_U, len / TILE_U, yBot / TILE_U, len / TILE_U, yTop / TILE_U, 0, yTop / TILE_U);
    const dark = yBot < -1 ? 0.3 : 0.5;
    col.push(wall[0] * dark, wall[1] * dark, wall[2] * dark, wall[0] * dark, wall[1] * dark, wall[2] * dark);
    col.push(wall[0], wall[1], wall[2], wall[0], wall[1], wall[2]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    if (!lip) return;
    const o = 0.035, drop = Math.min(0.42, (yTop - yBot) * 0.8);
    const lb = lp.length / 3;
    lp.push(
      ax + nx * o, yTop - drop, az + nz * o, bx + nx * o, yTop - drop, bz + nz * o,
      bx + nx * o, yTop + 0.02, bz + nz * o, ax + nx * o, yTop + 0.02, az + nz * o,
    );
    for (let i = 0; i < 4; i++) { ln.push(nx, 0.4, nz); lc.push(lip[0], lip[1], lip[2]); }
    lu.push(0, 0, len / TILE_U * 1.5, 0, len / TILE_U * 1.5, 1, 0, 1);
    li.push(lb, lb + 1, lb + 2, lb, lb + 2, lb + 3);
  };

  const tint = (gi: number) => {
    const k = grid.ter[gi];
    if (k === T_PIT) return { wall: rgb('#4a3a2e'), lip: null };
    const b = band(style, grid.hts[gi], def);
    return { wall: rgb(b.wall), lip: b.lip ? rgb(b.lip) : null };
  };

  // walls facing south and north, merged along each row
  for (const dir of [1, -1]) {
    for (let gy = 0; gy < grid.h; gy++) {
      const ny = gy + dir;
      if (ny < 0 || ny >= grid.h) continue;
      let run: { x0: number; bot: number; top: number; gi: number } | null = null;
      const flush = (xEnd: number) => {
        if (!run) return;
        const z = (dir > 0 ? gy + 1 : gy) + grid.oy;
        const t = tint(run.gi);
        addWall((run.x0 + grid.ox) * TILE_U, z * TILE_U, (xEnd + grid.ox) * TILE_U, z * TILE_U, 0, dir,
          run.bot, run.top, t.wall, t.lip);
        run = null;
      };
      for (let gx = 0; gx <= grid.w; gx++) {
        if (gx === grid.w) { flush(gx); break; }
        const gi = gy * grid.w + gx, ni = ny * grid.w + gx;
        const top = topY(grid, gi), bot = topY(grid, ni);
        if (top <= bot + 0.01 || grid.ter[gi] === T_WATER || grid.ter[gi] === T_BRIDGE) { flush(gx); continue; }
        if (run && (run.top !== top || run.bot !== bot)) flush(gx);
        if (!run) run = { x0: gx, bot, top, gi };
      }
    }
  }
  // walls facing east and west, merged down each column
  for (const dir of [1, -1]) {
    for (let gx = 0; gx < grid.w; gx++) {
      const nx = gx + dir;
      if (nx < 0 || nx >= grid.w) continue;
      let run: { y0: number; bot: number; top: number; gi: number } | null = null;
      const flush = (yEnd: number) => {
        if (!run) return;
        const x = (dir > 0 ? gx + 1 : gx) + grid.ox;
        const t = tint(run.gi);
        addWall(x * TILE_U, (run.y0 + grid.oy) * TILE_U, x * TILE_U, (yEnd + grid.oy) * TILE_U, dir, 0,
          run.bot, run.top, t.wall, t.lip);
        run = null;
      };
      for (let gy = 0; gy <= grid.h; gy++) {
        if (gy === grid.h) { flush(gy); break; }
        const gi = gy * grid.w + gx, ni = gy * grid.w + nx;
        const top = topY(grid, gi), bot = topY(grid, ni);
        if (top <= bot + 0.01 || grid.ter[gi] === T_WATER || grid.ter[gi] === T_BRIDGE) { flush(gy); continue; }
        if (run && (run.top !== top || run.bot !== bot)) flush(gy);
        if (!run) run = { y0: gy, bot, top, gi };
      }
    }
  }

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  wallGeo.setIndex(idx);
  const wallMat = new THREE.MeshLambertMaterial({ map: stoneTexture(), vertexColors: true });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);
  disposables.push(wallGeo, wallMat);

  if (lp.length) {
    const lipGeo = new THREE.BufferGeometry();
    lipGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lipGeo.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
    lipGeo.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
    lipGeo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    lipGeo.setIndex(li);
    lipGeo.computeVertexNormals();
    const lipMat = new THREE.MeshLambertMaterial({
      map: lipTexture(), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide,
    });
    const lips = new THREE.Mesh(lipGeo, lipMat);
    lips.receiveShadow = true;
    group.add(lips);
    disposables.push(lipGeo, lipMat);
  }

  return {
    group,
    water,
    dispose: () => { for (const d of disposables) d.dispose(); },
  };
}

/** World-unit height of the ground at a grid tile, for dressing the outlands. */
export function gridTopSim(grid: WorldGrid, gx: number, gy: number): number {
  const gi = gy * grid.w + gx;
  const k = grid.ter[gi];
  if (k === T_PIT) return -120;
  if (k === T_WATER || k === T_BRIDGE) return -6;
  return grid.hts[gi] * STEP;
}
