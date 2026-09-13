import * as THREE from 'three';
import { SCALE, Stage, clearGroup } from './core';
import {
  G, groundTexture, mat, makeGround, makePerson, makeTree, mesh, shade,
} from './kit';
import type { Building, Prop, Town, TownNPC } from '../game/town';
import type { GameState } from '../game/state';

const TS = 48;

const PLOT_TINT: Record<string, { bed: string; crop: string; accent: string }> = {
  herb: { bed: '#57452f', crop: '#7fae52', accent: '#c8e08a' },
  wood: { bed: '#4f3f2c', crop: '#4d7c3c', accent: '#8a6440' },
  ore: { bed: '#4a4642', crop: '#95999f', accent: '#c9cdd6' },
  gemdust: { bed: '#3f3a48', crop: '#57d4d0', accent: '#9be0d2' },
};

export class TownView {
  group = new THREE.Group();
  private npcs = new Map<string, THREE.Group>();
  private yard = new THREE.Group();
  private water: THREE.Mesh | null = null;
  private stage: Stage;
  private town: Town;
  private tex: THREE.Texture;
  private lastYardKey = '';

  constructor(stage: Stage, town: Town, st: GameState) {
    this.stage = stage;
    this.town = town;
    const rich = st.village.preset === 'thriving';

    stage.scene.background = new THREE.Color('#a8c8e0');
    stage.scene.fog = new THREE.Fog('#c9d8e0', 40, 190);
    stage.hemi.color = new THREE.Color('#dbeaff');
    stage.hemi.groundColor = new THREE.Color(rich ? '#5d7a44' : '#5a6142');
    stage.hemi.intensity = 1.05;
    stage.sun.color = new THREE.Color('#ffdcae');
    stage.sun.intensity = 1.7;

    const g1 = rich ? '#6f9250' : '#6b7a4c';
    const g2 = rich ? '#7d9d58' : '#77855a';
    this.tex = groundTexture(town.w, town.h, town.tiles, g1, g2);
    const ground = makeGround(town.w, town.h, TS, [], this.tex, '#ffffff');
    this.group.add(ground);

    // ------------------------------------------------------------- the roads
    for (const r of town.roads) {
      const dx = r.x2 - r.x1, dy = r.y2 - r.y1;
      const len = Math.hypot(dx, dy);
      const road = mesh(G.plane(), mat('#8a7355'),
        ((r.x1 + r.x2) / 2) * SCALE, 0.02, ((r.y1 + r.y2) / 2) * SCALE,
        len * SCALE, r.w * SCALE, 1);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = -Math.atan2(dy, dx);
      road.castShadow = false;
      this.group.add(road);
    }
    const cx = (town.w * TS) / 2, cy = (town.h * TS) / 2;
    const square = mesh(G.disc(), mat('#907754'), cx * SCALE, 0.03, cy * SCALE,
      500 * SCALE, 380 * SCALE, 1);
    square.rotation.x = -Math.PI / 2;
    square.castShadow = false;
    this.group.add(square);

    // -------------------------------------------------------------- the town
    for (const b of town.buildings) this.group.add(buildingMesh(b));
    for (const p of town.props) {
      const o = propMesh(p, rich);
      if (o) this.group.add(o);
      if (p.kind === 'moat') this.water = o as THREE.Mesh;
    }

    this.group.add(this.yard);
    this.syncYard(st, true);
    stage.world.add(this.group);
  }

  dispose(): void {
    this.stage.world.remove(this.group);
    clearGroup(this.group);
    this.tex.dispose();
  }

  sync(st: GameState, now: number): void {
    for (const n of this.town.npcs) {
      let o = this.npcs.get(n.id);
      if (!o) {
        o = npcMesh(n);
        this.npcs.set(n.id, o);
        this.group.add(o);
      }
      o.position.set(n.x * SCALE, 0, n.y * SCALE);
      o.rotation.y = -n.facing + Math.PI / 2;
      const walking = n.kind !== 'guard';
      o.position.y = walking ? Math.abs(Math.sin(n.walkT * 9)) * 0.05 : 0;
    }
    if (this.water) {
      const m = this.water.material as THREE.MeshLambertMaterial;
      m.emissiveIntensity = 1;
      this.water.position.y = 0.015 + Math.sin(now * 0.0011) * 0.012;
    }
    this.syncYard(st, false);
  }

  /** Plots rebuild only when something about them actually changed. */
  private syncYard(st: GameState, force: boolean): void {
    const key = st.homestead.plots
      .map((p) => p.id + (p.owned ? 1 : 0) + p.level + p.workers + Math.floor(p.pending ?? 0))
      .join('|');
    if (!force && key === this.lastYardKey) return;
    this.lastYardKey = key;
    clearGroup(this.yard);
    for (const spot of this.town.yard) {
      const plot = st.homestead.plots.find((p) => p.id === spot.id);
      if (!plot) continue;
      this.yard.add(plotMesh(spot.x, spot.y, plot));
    }
  }
}

// ------------------------------------------------------------------ builders

function buildingMesh(b: Building): THREE.Group {
  const g = new THREE.Group();
  const w = b.w * SCALE, d = b.d * SCALE;
  const wallH = (b.storeys > 1 ? 3.4 : 2.5);
  const cx = (b.x + b.w / 2) * SCALE, cz = (b.y + b.d / 2) * SCALE;

  if (b.id === 'gate') {
    // two piers and a lintel: you walk through the middle
    const pierW = 46 * SCALE;
    for (const side of [-1, 1]) {
      g.add(mesh(G.box(), mat('#9d9284'),
        cx + side * (w / 2 + pierW / 2 - 0.1), 3.0, cz, pierW, 6.0, d));
    }
    g.add(mesh(G.box(), mat('#8e8375'), cx, 6.4, cz, w + pierW * 2, 0.9, d * 1.05));
    for (let i = -3; i <= 3; i++) {
      g.add(mesh(G.box(), mat('#b0a598'), cx + i * 0.62, 7.1, cz, 0.42, 0.55, d * 1.05));
    }
    // raised portcullis
    for (let i = -2; i <= 2; i++) {
      g.add(mesh(G.box(), mat('#5f5750'), cx + i * 0.34, 5.5, cz - d * 0.3, 0.08, 1.1, 0.08));
    }
    const banner = mesh(G.plane(), mat('#4a5f8a'), cx, 4.5, cz - d * 0.42, 1.0, 2.0, 1);
    banner.castShadow = false;
    g.add(banner);
    return g;
  }

  // walls
  g.add(mesh(G.box(), mat(b.color), cx, wallH / 2, cz, w, wallH, d));
  // timber bands
  g.add(mesh(G.box(), mat(shade(b.color, -46)), cx, wallH - 0.12, cz, w + 0.04, 0.16, d + 0.04));
  g.add(mesh(G.box(), mat(shade(b.color, -46)), cx, 0.1, cz, w + 0.04, 0.2, d + 0.04));

  // roof: a low pyramid with an overhang
  const roof = mesh(G.cone(), mat(b.roof), cx, wallH + 0.85, cz, w * 0.92, 1.7, d * 0.92);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  g.add(mesh(G.box(), mat(shade(b.roof, -22)), cx, wallH + 0.06, cz, w + 0.5, 0.16, d + 0.5));

  // door on the south face
  const door = mesh(G.box(), mat('#33261d'), cx, 0.95, cz + d / 2 + 0.02, 0.85, 1.9, 0.1);
  g.add(door);
  // windows, warm
  const glass = mat('#ffd98f', { emissive: '#8a5f1e' });
  for (const off of [-0.34, 0.34]) {
    g.add(mesh(G.box(), glass, cx + off * w, 1.5, cz + d / 2 + 0.02, w * 0.16, 0.6, 0.1));
    if (b.storeys > 1) {
      g.add(mesh(G.box(), glass, cx + off * w, 2.7, cz + d / 2 + 0.02, w * 0.16, 0.55, 0.1));
    }
  }
  // chimney
  g.add(mesh(G.box(), mat(shade(b.color, -30)), cx + w * 0.28, wallH + 1.5, cz - d * 0.2,
    0.4, 1.3, 0.4));
  return g;
}

function propMesh(p: Prop, rich: boolean): THREE.Object3D | null {
  const x = p.x * SCALE, z = p.y * SCALE;
  switch (p.kind) {
    case 'tree': return place(makeTree(p.variant, rich, 1.45), x, z);
    case 'sapling': return place(makeTree(p.variant, rich, 0.6), x, z);
    case 'bush': {
      const g = new THREE.Group();
      g.add(mesh(G.sphere(), mat(rich ? '#4f8040' : '#5c6a3c'), 0, 0.32, 0, 0.9, 0.6, 0.9));
      return place(g, x, z);
    }
    case 'lantern': {
      const g = new THREE.Group();
      const h = p.variant === 1 ? 2.4 : 1.9;
      g.add(mesh(G.cyl(), mat('#4a4038'), 0, h / 2, 0, 0.07, h, 0.07));
      g.add(mesh(G.box(), mat('#ffd98f', { emissive: '#c88a24' }), 0, h + 0.2, 0, 0.28, 0.36, 0.28));
      return place(g, x, z);
    }
    case 'well': {
      const g = new THREE.Group();
      g.add(mesh(G.cyl(), mat('#8a8378'), 0, 0.4, 0, 1.4, 0.8, 1.4));
      g.add(mesh(G.cyl(), mat('#2a3f46'), 0, 0.82, 0, 1.15, 0.06, 1.15));
      for (const side of [-1, 1]) {
        g.add(mesh(G.cyl(), mat('#6b4a2a'), side * 0.62, 1.5, 0, 0.09, 2.0, 0.09));
      }
      const roof = mesh(G.cone(), mat('#8c4a3f'), 0, 2.8, 0, 2.0, 1.0, 2.0);
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      return place(g, x, z);
    }
    case 'stall': {
      const g = new THREE.Group();
      const c = p.color ?? '#b8524e';
      g.add(mesh(G.box(), mat('#7a5a3a'), 0, 0.5, 0, 3.4, 0.2, 1.6));
      for (const sx of [-1.6, 1.6]) {
        for (const sz of [-0.7, 0.7]) {
          g.add(mesh(G.box(), mat('#6b4a2a'), sx, 0.9, sz, 0.12, 1.8, 0.12));
        }
      }
      const awn = mesh(G.box(), mat(c), 0, 2.0, 0, 3.8, 0.12, 2.0);
      awn.rotation.x = 0.16;
      g.add(awn);
      const goods = ['#d05a4a', '#e0b64f', '#7fae52', '#a86fd0'];
      for (let i = 0; i < 4; i++) {
        g.add(mesh(G.sphere(), mat(goods[(i + p.variant) % 4]), -1.2 + i * 0.8, 0.72, 0,
          0.28, 0.28, 0.28));
      }
      return place(g, x, z);
    }
    case 'bench': {
      const g = new THREE.Group();
      g.add(mesh(G.box(), mat('#7a5a3a'), 0, 0.42, 0, 2.2, 0.14, 0.6));
      g.add(mesh(G.box(), mat('#7a5a3a'), 0, 0.8, -0.24, 2.2, 0.6, 0.12));
      return place(g, x, z);
    }
    case 'barrel': return place(one(G.cyl(), '#8a6440', 0.55, 1.1, 0.55), x, z);
    case 'crate': return place(one(G.box(), '#9a7a4e', 1.0, 1.0, 1.0), x, z);
    case 'haybale': return place(one(G.cyl(), '#c8a24b', 0.8, 1.4, 0.8), x, z);
    case 'pot': return place(one(G.cylT(), '#a8603f', 0.5, 0.7, 0.5), x, z);
    case 'dummy': {
      const g = new THREE.Group();
      g.add(mesh(G.cyl(), mat('#6b4a2a'), 0, 0.6, 0, 0.1, 1.2, 0.1));
      g.add(mesh(G.cyl(), mat('#c8a875'), 0, 1.5, 0, 0.5, 1.0, 0.5));
      g.add(mesh(G.box(), mat('#8a6a44'), 0, 1.7, 0, 1.7, 0.16, 0.16));
      g.add(mesh(G.sphere(), mat('#c8a875'), 0, 2.2, 0, 0.44, 0.44, 0.44));
      return place(g, x, z);
    }
    case 'rack': {
      const g = new THREE.Group();
      g.add(mesh(G.box(), mat('#6b4a2a'), 0, 1.2, 0, 2.2, 0.12, 0.3));
      g.add(mesh(G.box(), mat('#6b4a2a'), 0, 0.15, 0, 2.2, 0.3, 0.5));
      for (let i = -1; i <= 1; i++) {
        g.add(mesh(G.box(), mat('#c9ccd6'), i * 0.6, 0.8, 0, 0.1, 1.3, 0.06));
      }
      return place(g, x, z);
    }
    case 'signpost': {
      const g = new THREE.Group();
      g.add(mesh(G.cyl(), mat('#6b4a2a'), 0, 1.0, 0, 0.07, 2.0, 0.07));
      g.add(mesh(G.box(), mat('#8a6a44'), -0.5, 1.7, 0, 1.1, 0.4, 0.1));
      return place(g, x, z);
    }
    case 'cart': {
      const g = new THREE.Group();
      g.add(mesh(G.box(), mat('#8a6440'), 0, 0.8, 0, 2.4, 0.7, 1.2));
      for (const sx of [-0.8, 0.8]) {
        const wl = mesh(G.cyl(), mat('#4a3a2a'), sx, 0.45, 0.7, 0.9, 0.14, 0.9);
        wl.rotation.x = Math.PI / 2;
        g.add(wl);
      }
      return place(g, x, z);
    }
    case 'shopsign': {
      const g = new THREE.Group();
      g.add(mesh(G.box(), mat('#4a3a2a'), 0, 2.6, 0, 0.08, 0.6, 0.08));
      g.add(mesh(G.box(), mat(p.color ?? '#8c4a3f'), 0, 2.1, 0, 0.9, 0.6, 0.1));
      return place(g, x, z);
    }
    case 'banner': {
      const b = mesh(G.plane(), mat(p.color ?? '#8c4a3f'), x, 2.0, z, 0.9, 2.2, 1);
      b.castShadow = false;
      return b;
    }
    case 'crops': {
      const g = new THREE.Group();
      g.add(mesh(G.box(), mat('#5a4632'), 0, 0.08, 0, 1.8, 0.16, 0.8));
      return place(g, x, z);
    }
    case 'fence': {
      if (p.x2 === undefined || p.y2 === undefined) return null;
      const dx = p.x2 - p.x, dy = p.y2 - p.y;
      const len = Math.hypot(dx, dy) * SCALE;
      if (len < 0.01) return null;
      const g = new THREE.Group();
      if (p.variant === 2) {
        // the city wall
        g.add(mesh(G.box(), mat('#8e8375'), 0, 1.5, 0, len, 3.0, 0.7));
        const merlons = Math.max(1, Math.floor(len / 0.7));
        for (let i = 0; i < merlons; i++) {
          g.add(mesh(G.box(), mat('#9d9284'), -len / 2 + 0.35 + i * 0.7, 3.25, 0, 0.36, 0.5, 0.72));
        }
      } else {
        g.add(mesh(G.box(), mat('#8a6a44'), 0, 0.9, 0, len, 0.08, 0.08));
        g.add(mesh(G.box(), mat('#8a6a44'), 0, 0.55, 0, len, 0.08, 0.08));
        g.add(mesh(G.box(), mat('#6b4a2a'), -len / 2, 0.6, 0, 0.12, 1.2, 0.12));
      }
      g.position.set((p.x + p.x2) / 2 * SCALE, 0, (p.y + p.y2) / 2 * SCALE);
      g.rotation.y = -Math.atan2(dy, dx);
      return g;
    }
    case 'moat': {
      const w = (p.w ?? 0) * SCALE, h = (p.h ?? 0) * SCALE;
      const water = mesh(G.plane(), mat('#3f6b7a', { emissive: '#0e2830', opacity: 0.92 }),
        (p.x + (p.w ?? 0) / 2) * SCALE, 0.02, (p.y + (p.h ?? 0) / 2) * SCALE, w, h, 1);
      water.rotation.x = -Math.PI / 2;
      water.castShadow = false;
      return water;
    }
    case 'bridge': {
      const w = (p.w ?? 0) * SCALE, h = (p.h ?? 0) * SCALE;
      const g = new THREE.Group();
      g.add(mesh(G.box(), mat('#8a6440'), 0, 0.12, 0, w, 0.24, h));
      for (const side of [-1, 1]) {
        g.add(mesh(G.box(), mat('#6b4a2a'), side * (w / 2 - 0.06), 0.62, 0, 0.12, 0.76, h));
      }
      g.position.set((p.x + (p.w ?? 0) / 2) * SCALE, 0, (p.y + (p.h ?? 0) / 2) * SCALE);
      return g;
    }
    case 'lilypad': {
      const l = mesh(G.disc(), mat('#4a7a4a'), x, 0.05, z, 0.5, 0.5, 1);
      l.rotation.x = -Math.PI / 2;
      l.castShadow = false;
      return l;
    }
    case 'flowerbed': {
      const g = new THREE.Group();
      g.add(mesh(G.cyl(), mat('#5a4632'), 0, 0.08, 0, 1.1, 0.16, 1.1));
      const cols = ['#e0607a', '#e8c15a', '#8f7fe0', '#e88f5a'];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(G.sphere(), mat(cols[(i + p.variant) % 4]),
          Math.cos(a) * 0.45, 0.28, Math.sin(a) * 0.45, 0.16, 0.16, 0.16));
      }
      return place(g, x, z);
    }
    case 'laundry': {
      if (p.x2 === undefined || p.y2 === undefined) return null;
      const g = new THREE.Group();
      const cols = ['#e8e0d0', '#a8c4e0', '#e0b6c8', '#d8d2a8'];
      for (let i = 1; i <= 4; i++) {
        const f = i / 5;
        const lx = (p.x + (p.x2 - p.x) * f) * SCALE;
        const lz = (p.y + (p.y2 - p.y) * f) * SCALE;
        const c = mesh(G.plane(), mat(cols[i % 4]), lx, 2.2, lz, 0.5, 0.7, 1);
        c.castShadow = false;
        g.add(c);
      }
      return g;
    }
    default:
      return null;
  }
}

function one(g: THREE.BufferGeometry, color: string, sx: number, sy: number, sz: number): THREE.Group {
  const grp = new THREE.Group();
  grp.add(mesh(g, mat(color), 0, sy / 2, 0, sx, sy, sz));
  return grp;
}

function place(g: THREE.Group, x: number, z: number): THREE.Group {
  g.position.set(x, 0, z);
  return g;
}

function npcMesh(n: TownNPC): THREE.Group {
  const a = n.appearance;
  if (n.kind === 'cat') {
    const g = new THREE.Group();
    g.add(mesh(G.box(), mat('#4a4038'), 0, 0.22, 0, 0.28, 0.24, 0.6));
    g.add(mesh(G.sphere(), mat('#4a4038'), 0, 0.42, 0.3, 0.3, 0.3, 0.3));
    g.add(mesh(G.cone(), mat('#4a4038'), -0.08, 0.6, 0.3, 0.1, 0.16, 0.1));
    g.add(mesh(G.cone(), mat('#4a4038'), 0.08, 0.6, 0.3, 0.1, 0.16, 0.1));
    return g;
  }
  const scale = n.kind === 'kid' ? 0.7 : n.kind === 'elder' ? 0.92 : 1;
  const cloth = n.kind === 'guard' ? '#5f6b82' : a.cloth;
  const hair = n.kind === 'elder' ? '#ded8cc' : a.hair;
  const p = makePerson(cloth, a.skin, hair, scale * 1.02);
  if (n.kind === 'guard') {
    p.root.add(mesh(G.sphere(), mat('#aeb6c4'), 0, 1.68 * scale, 0, 0.36, 0.24, 0.34));
    const spear = mesh(G.cyl(), mat('#6b4a2a'), 0.42, 1.15, 0, 0.05, 2.3, 0.05);
    p.root.add(spear);
    p.root.add(mesh(G.cone(), mat('#c9ccd6'), 0.42, 2.45, 0, 0.13, 0.36, 0.13));
  }
  return p.root;
}

function plotMesh(
  sx: number, sy: number,
  plot: { resource: string; owned: boolean; level: number; workers: number; pending: number },
): THREE.Group {
  const g = new THREE.Group();
  const W = 116 * SCALE, H = 68 * SCALE;
  const tint = PLOT_TINT[plot.resource] ?? PLOT_TINT.herb;
  g.position.set((sx + 58) * SCALE, 0, (sy + 34) * SCALE);

  if (!plot.owned) {
    g.add(mesh(G.box(), mat('#6a6250'), 0, 0.06, 0, W, 0.12, H));
    g.add(mesh(G.cyl(), mat('#6b4a2a'), 0, 0.6, 0, 0.07, 1.2, 0.07));
    g.add(mesh(G.box(), mat('#c8b69a'), 0, 1.2, 0, 1.1, 0.5, 0.08));
    return g;
  }

  g.add(mesh(G.box(), mat(tint.bed), 0, 0.09, 0, W, 0.18, H));
  const rows = Math.min(5, plot.level);
  const per = 4 + Math.min(4, plot.level);
  for (let r = 0; r < rows; r++) {
    const rz = -H / 2 + (H / (rows + 1)) * (r + 1);
    for (let i = 0; i < per; i++) {
      const px = -W / 2 + (W / (per + 1)) * (i + 1);
      if (plot.resource === 'ore' || plot.resource === 'gemdust') {
        const glow = plot.resource === 'gemdust'
          ? mat(tint.crop, { emissive: shade(tint.crop, -110) }) : mat(tint.crop);
        g.add(mesh(G.cone(), glow, px, 0.34, rz, 0.14, 0.42, 0.14));
      } else if (plot.resource === 'wood') {
        g.add(mesh(G.cyl(), mat('#6b4a2a'), px, 0.32, rz, 0.05, 0.32, 0.05));
        g.add(mesh(G.sphere(), mat(tint.crop), px, 0.58, rz, 0.28, 0.28, 0.28));
      } else {
        g.add(mesh(G.cone(), mat(tint.crop), px, 0.34, rz, 0.1, 0.38, 0.1));
        g.add(mesh(G.sphere(), mat(tint.accent), px, 0.55, rz, 0.1, 0.1, 0.1));
      }
    }
  }

  for (let i = 0; i < Math.min(6, plot.workers); i++) {
    const a = i * 2.1;
    const wp = makePerson(['#7a6a52', '#6a7d4a', '#7a5b4a', '#5f7f6f'][i % 4], '#e0b98f', '#c8a24b', 0.95);
    wp.root.position.set(Math.cos(a) * (W / 2 + 0.6), 0, H / 2 + 0.7 + Math.sin(a) * 0.4);
    wp.root.rotation.y = a;
    g.add(wp.root);
  }

  const pend = Math.floor(plot.pending ?? 0);
  if (pend > 0) {
    const bx = W / 2 - 0.3, bz = -H / 2 - 0.4;
    g.add(mesh(G.cyl(), mat('#8a6440'), bx, 0.24, bz, 0.5, 0.48, 0.5));
    const heap = Math.min(8, 1 + Math.floor(Math.log2(pend + 1)));
    for (let i = 0; i < heap; i++) {
      g.add(mesh(G.sphere(), mat(tint.crop),
        bx + ((i % 3) - 1) * 0.16, 0.54 + Math.floor(i / 3) * 0.14, bz + ((i % 2) - 0.5) * 0.16,
        0.16, 0.16, 0.16));
    }
    const mark = mesh(G.cone(), mat('#ffe28a', { emissive: '#8a6a10' }), bx, 1.3, bz, 0.22, 0.5, 0.22);
    mark.rotation.x = Math.PI;
    g.add(mark);
  }
  return g;
}
