import * as THREE from 'three';
import { SCALE, Stage, clearGroup } from './core';
import { G, mat, mesh } from './kit';
import { Sprite, standee, standeeInstances } from './sprite';
import { plankMaterial, soft } from './paint';
import {
  TerrainMeshes, WorldGrid, buildTerrainMeshes, buildWorldGrid, gridTopSim, paintWorld,
} from './terrainMesh';
import type { Diorama } from './diorama';
import { SPRITE_LEAN } from './diorama';
import type { Mood } from './post';
import { MONSTERS } from '../game/content';
import type { ZoneDef } from '../game/content';
import { TS, T_PIT, noiseFor } from '../game/terrain';
import type { Node as ResourceNode, Zone } from '../game/zone';
import { standZ } from '../game/zone';
import { ITEM_DEFS } from '../game/items';
import { RNG } from '../game/rng';
import { drawCritter, drawFlora, drawMob, drawNode } from '../render/draw';

/** Drawing box in sim px, and how far below the feet the drawing reaches. */
const FLORA_SIZE: Record<string, [number, number, number]> = {
  grass: [24, 18, 2],
  flower: [16, 20, 2],
  mushroom: [18, 16, 2],
  fern: [28, 18, 2],
  reed: [20, 34, 2],
  stump: [28, 24, 4],
  crystal: [16, 28, 2],
  bone: [30, 14, 6],
};
const SWAYS = new Set(['grass', 'fern', 'reed', 'flower']);

const CRITTER_SIZE: Record<string, [number, number, number]> = {
  butterfly: [22, 28, 2],
  firefly: [14, 34, 2],
  bird: [24, 22, 2],
  rabbit: [28, 32, 4],
};

interface NodeView { sprite: Sprite; dirty: boolean }
interface CacheView { mesh: THREE.Object3D; beam: THREE.Mesh; uid: string }

/**
 * The zone as an HD-2D diorama: stepped terrain you can climb, real holes and
 * water, woods and peaks that carry on past the edge of the map, and every
 * creature, tree and tuft of grass a painted standee made by the 2D art.
 * The simulation is untouched; this only reads it.
 */
export class ZoneView {
  group = new THREE.Group();
  private mobs = new Map<string, Sprite>();
  private eliteRings = new Map<string, THREE.Mesh>();
  private nodes = new Map<string, NodeView>();
  private critters = new Map<number, Sprite>();
  private flora: { mesh: THREE.Mesh; phase: number; sways: boolean }[] = [];
  private drops = new Map<string, THREE.Group>();
  private caches: CacheView[] = [];
  private telegraphs: THREE.Mesh[] = [];
  private particles: THREE.Points;
  private pGeo: THREE.BufferGeometry;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private motes: THREE.Points;
  private mGeo: THREE.BufferGeometry;
  private slashArc: THREE.Mesh;
  private projectiles: THREE.Mesh[] = [];
  private impactRings: { mesh: THREE.Mesh; born: number; total: number; src: object }[] = [];
  private stage: Stage;
  private zone: Zone;
  private terrain: TerrainMeshes;
  private paintTex: THREE.Texture[] = [];
  private leaned = false;

  constructor(stage: Stage, zone: Zone) {
    this.stage = stage;
    this.zone = zone;
    const def = zone.def;

    const haze = def.style === 'mountain' ? '#c9d6e2' : def.skyBottom;
    stage.scene.background = new THREE.Color(haze);
    // fog only for the far outlands; the ground you are standing on stays crisp
    stage.scene.fog = new THREE.Fog(haze, 85, 240);
    stage.hemi.color = new THREE.Color(def.style === 'mountain' ? '#e8f0ff' : def.skyTop).lerp(new THREE.Color('#ffffff'), 0.3);
    stage.hemi.groundColor = new THREE.Color(def.ground);
    stage.hemi.intensity = def.style === 'mountain' ? 1.05 : 1.45;
    stage.sun.color = new THREE.Color(def.style === 'mountain' ? '#fff2dc' : '#ffe2b4');
    stage.sun.intensity = def.style === 'barrows' ? 1.3 : def.style === 'mountain' ? 1.6 : 1.8;

    // --------------------------------------------------------------- terrain
    const grid = buildWorldGrid(zone.terrain, zone.seed);
    const paint = paintWorld(grid, def, zone.seed);
    this.paintTex.push(paint.map);
    if (paint.glow) this.paintTex.push(paint.glow);
    this.terrain = buildTerrainMeshes(grid, def, paint);
    this.group.add(this.terrain.group);
    if (def.style === 'ashen') this.group.add(lavaPools(grid));

    this.buildBridge(def);
    this.dressOutlands(grid, def, zone.seed);

    // ---------------------------------------------------------- undergrowth
    for (const f of zone.flora) {
      const size = FLORA_SIZE[f.kind];
      if (!size) continue;
      const m = standee('flora:' + f.kind + ':' + f.variant, size[0], size[1], size[2],
        (c, fx, fy) => drawFlora(c, { ...f, x: fx, y: fy, gz: 0 }, 0), 3);
      m.position.set(f.x * SCALE, f.gz * SCALE, f.y * SCALE);
      m.scale.setScalar(1.35);
      m.castShadow = f.kind === 'stump' || f.kind === 'reed' || f.kind === 'crystal';
      this.flora.push({ mesh: m, phase: (f.x * 0.07 + f.y * 0.05) % 6.28, sways: SWAYS.has(f.kind) });
      this.group.add(m);
    }

    // ------------------------------------------------------ lost belongings
    for (const c of zone.caches) {
      const m = standee('cache', 40, 34, 4, (ctx, fx, fy) => drawCache(ctx, fx, fy), 3);
      m.position.set(c.x * SCALE, c.gz * SCALE, c.y * SCALE);
      m.scale.setScalar(1.3);
      const beam = mesh(G.cyl(), new THREE.MeshBasicMaterial({
        color: new THREE.Color('#ffe28a'), transparent: true, opacity: 0.3, depthWrite: false,
      }), c.x * SCALE, c.gz * SCALE + 3.2, c.y * SCALE, 0.4, 6.4, 0.4);
      beam.castShadow = false;
      this.group.add(m, beam);
      this.caches.push({ mesh: m, beam, uid: c.uid });
    }

    // ------------------------------------------------------------ particles
    const MAXP = 700;
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAXP * 3);
    this.pCol = new Float32Array(MAXP * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(this.pGeo, new THREE.PointsMaterial({
      size: 0.3, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    const MAXM = 220;
    this.mGeo = new THREE.BufferGeometry();
    this.mGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXM * 3), 3));
    this.motes = new THREE.Points(this.mGeo, new THREE.PointsMaterial({
      size: def.ambience === 'snow' ? 0.26 : 0.22, color: new THREE.Color(def.ambienceColor), transparent: true,
      opacity: def.ambience === 'snow' ? 0.9 : 0.7, depthWrite: false,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    const arcGeo = new THREE.RingGeometry(0.35, 1.9, 24, 1, -0.9, 1.8);
    this.slashArc = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color('#fff6e0'), transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.slashArc.rotation.x = -Math.PI / 2;
    this.slashArc.visible = false;
    this.group.add(this.slashArc);

    stage.world.add(this.group);
  }

  /** The river crossing out of the zone, and the arch over the road home. */
  private buildBridge(def: ZoneDef): void {
    const t = this.zone.terrain;
    const x0 = (t.exitTx - 1) * TS * SCALE, x1 = (t.exitTx + 2) * TS * SCALE;
    const z0 = (t.h - 3) * TS * SCALE - 0.2, z1 = t.h * TS * SCALE + 0.6;
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.Group();
    const deckGeo = new THREE.BoxGeometry(w, 0.3, d);
    const deck = new THREE.Mesh(deckGeo, plankMaterial());
    deck.position.set((x0 + x1) / 2, 0.05, (z0 + z1) / 2);
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);
    const wood = new THREE.MeshLambertMaterial({ color: new THREE.Color('#6b4a2a') });
    for (const side of [-1, 1]) {
      const rx = (x0 + x1) / 2 + side * (w / 2 - 0.12);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, d), wood);
      rail.position.set(rx, 1.0, (z0 + z1) / 2);
      rail.castShadow = true;
      g.add(rail);
      for (let z = z0 + 0.3; z <= z1; z += 1.5) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), wood);
        post.position.set(rx, 0.55, z);
        post.castShadow = true;
        g.add(post);
      }
    }
    // an arch where the road leaves: you can see this is the way out
    const ax = (x0 + x1) / 2, az = t.h * TS * SCALE + 0.3;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, 4.2, 0.42), wood);
      post.position.set(ax + side * (w / 2 + 0.2), 2.1, az);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.45, 0.5), wood);
    beam.position.set(ax, 4.1, az);
    beam.castShadow = true;
    g.add(beam);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.12), plankMaterial());
    sign.position.set(ax, 3.35, az + 0.2);
    g.add(sign);
    const lamp = mesh(G.box(), mat('#ffcf7a', { emissive: '#ffb050' }), ax + w / 2 + 0.2, 4.7, az, 0.3, 0.36, 0.3);
    lamp.castShadow = false;
    g.add(lamp);
    const light = new THREE.PointLight('#ffb05a', def.style === 'barrows' ? 10 : 5, 10, 1.6);
    light.position.set(ax, 3.4, az - 0.6);
    g.add(light);
    this.group.add(g);
  }

  /** Woods, pines, boulders and dead trees on the high ground past the map and on its border. */
  private dressOutlands(grid: WorldGrid, def: ZoneDef, seed: number): void {
    const r = new RNG(seed ^ 0x1b873593);
    const n = noiseFor(seed ^ 0x6c62272e);
    const t = grid.map;
    const buckets = new Map<string, { x: number; y: number; z: number; s: number }[]>();
    const add = (key: string, gx: number, gy: number, s: number) => {
      const top = gridTopSim(grid, gx, gy);
      if (top < 0) return;
      const list = buckets.get(key) ?? [];
      const x = (gx + grid.ox + r.float(0.15, 0.85)) * TS * SCALE;
      const y = (gy + grid.oy + r.float(0.2, 0.9)) * TS * SCALE;
      list.push({ x, y: top * SCALE, z: y, s });
      buckets.set(key, list);
    };
    for (let gy = 0; gy < grid.h; gy++) {
      for (let gx = 0; gx < grid.w; gx++) {
        const gi = gy * grid.w + gx;
        if (grid.ter[gi] !== 0) continue;
        const mx = gx + grid.ox, my = gy + grid.oy;
        const inside = grid.inMap[gi] === 1;
        if (inside && !t.border[my * t.w + mx]) continue;
        if (my >= t.h - 5 && Math.abs(mx - t.exitTx) <= 2) continue;
        const dens = n.fbm(gx * 0.11, gy * 0.11, 3);
        const steps = grid.hts[gi];
        switch (def.style) {
          case 'woods':
            if (r.chance(0.55 + dens * 0.3)) add('tree:' + r.int(0, 2), gx, gy, r.float(1.7, 2.4));
            if (r.chance(0.25)) add('tree:' + r.int(0, 2), gx, gy, r.float(1.5, 2.1));
            break;
          case 'meadow':
            if (r.chance(0.28 + dens * 0.35)) add('tree:' + r.int(0, 2), gx, gy, r.float(1.6, 2.2));
            else if (r.chance(0.05)) add('rock:' + r.int(0, 2), gx, gy, r.float(1.2, 1.8));
            break;
          case 'fen':
            if (r.chance(0.16 + dens * 0.2)) add('dead:' + r.int(0, 1), gx, gy, r.float(1.4, 2));
            else if (r.chance(0.18)) add('reed', gx, gy, r.float(1.4, 1.8));
            break;
          case 'barrows':
            if (r.chance(0.12)) add('dead:' + r.int(0, 1), gx, gy, r.float(1.5, 2.1));
            else if (r.chance(0.12)) add('rock:' + r.int(0, 2), gx, gy, r.float(1.3, 2));
            break;
          case 'mountain':
            if (steps < 12 && r.chance(0.3 + dens * 0.25)) add(steps > 7 ? 'pine:snow' : 'pine:' + r.int(0, 1), gx, gy, r.float(1.6, 2.3));
            else if (r.chance(0.08)) add('rock:' + r.int(0, 2), gx, gy, r.float(1.4, 2.4));
            break;
          case 'ashen':
            if (r.chance(0.05)) add('dead:1', gx, gy, r.float(1.4, 2));
            else if (r.chance(0.1)) add('rock:' + r.int(0, 2), gx, gy, r.float(1.3, 2.2));
            break;
        }
      }
    }
    for (const [key, items] of buckets) {
      const [kind, variant] = key.split(':');
      const v = Number(variant) || 0;
      let m: THREE.InstancedMesh;
      if (kind === 'tree') {
        m = standeeInstances('out:tree:' + v, 68, 66, 4, (c, fx, fy) => drawNode(c, stillNode('tree', fx, fy, v)), 2.5, items, SPRITE_LEAN);
      } else if (kind === 'rock') {
        m = standeeInstances('out:rock:' + v, 40, 30, 4, (c, fx, fy) => drawNode(c, stillNode('rock', fx, fy, v)), 2.5, items, SPRITE_LEAN);
      } else if (kind === 'pine') {
        m = standeeInstances('out:pine:' + variant, 56, 92, 4, (c, fx, fy) => drawPine(c, fx, fy, v, variant === 'snow'), 2.5, items, SPRITE_LEAN);
      } else if (kind === 'dead') {
        m = standeeInstances('out:dead:' + v, 60, 74, 4, (c, fx, fy) => drawDeadTree(c, fx, fy, v, def.style === 'ashen'), 2.5, items, SPRITE_LEAN);
      } else {
        m = standeeInstances('out:reed', 20, 34, 2, (c, fx, fy) => drawFlora(c, { kind: 'reed', x: fx, y: fy, variant: 0, gz: 0 }, 0), 3, items, SPRITE_LEAN, false);
      }
      this.group.add(m);
    }
  }

  dispose(): void {
    for (const s of this.mobs.values()) s.dispose();
    for (const n of this.nodes.values()) n.sprite.dispose();
    for (const s of this.critters.values()) s.dispose();
    for (const t of this.telegraphs) { t.geometry.dispose(); (t.material as THREE.Material).dispose(); }
    this.stage.world.remove(this.group);
    clearGroup(this.group);
    this.terrain.dispose();
    for (const t of this.paintTex) t.dispose();
  }

  sync(now: number, cam: Diorama): void {
    const lean = cam.spriteLean;
    const f = cam.focus();
    const near = (sx: number, sy: number, r = 48) =>
      Math.abs(sx * SCALE - f.x) < r && Math.abs(sy * SCALE - f.z) < r * 1.2;

    if (!this.leaned) {
      for (const fl of this.flora) fl.mesh.rotation.x = lean;
      for (const c of this.caches) c.mesh.rotation.x = lean;
      this.leaned = true;
    }

    this.syncMobs(lean, near);
    this.syncNodes(lean, near);
    this.syncCritters(now, lean, near);
    for (const fl of this.flora) {
      if (!fl.sways) continue;
      fl.mesh.rotation.z = Math.sin(now * 0.0016 + fl.phase) * 0.07;
    }
    for (const c of this.caches) {
      const found = this.zone.caches.find((x) => x.uid === c.uid)?.found ?? true;
      c.mesh.visible = !found;
      c.beam.visible = !found;
      (c.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(now * 0.004) * 0.1;
    }
    const wm = this.terrain.water.map;
    if (wm) wm.offset.set((now * 0.00003) % 1, (now * 0.00001) % 1);
    this.syncDrops(now);
    this.syncProjectiles();
    this.syncTelegraphs();
    this.syncImpacts(now);
    this.syncParticles();
    this.syncMotes();
    this.syncSlash();
  }

  private syncMobs(lean: number, near: (x: number, y: number, r?: number) => boolean): void {
    const seen = new Set<string>();
    for (const m of this.zone.mobs) {
      seen.add(m.uid);
      let s = this.mobs.get(m.uid);
      const d = MONSTERS[m.defId];
      if (!s) {
        const boss = d.family === 'boss';
        const sw = boss ? Math.max(70, d.size * 6.2) : Math.max(46, d.size * 4.4);
        const sh = boss ? Math.max(80, d.size * 4.8) : Math.max(46, d.size * 3.9);
        s = new Sprite(sw, sh, { res: boss ? 2 : 2.5, footPad: boss ? Math.round(d.size * 0.5) : 8 });
        s.mesh.scale.setScalar((boss ? 1.25 : 1.15) * (m.elite ? 1.4 : 1));
        this.mobs.set(m.uid, s);
        this.group.add(s.mesh);
        if (m.elite) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 32), new THREE.MeshBasicMaterial({
            color: new THREE.Color('#ffd166'), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
          }));
          ring.rotation.x = -Math.PI / 2;
          this.eliteRings.set(m.uid, ring);
          this.group.add(ring);
        }
      }
      const show = near(m.x, m.y);
      s.mesh.visible = show;
      if (show) s.paint(m.x, m.y - m.gz, (c) => drawMob(c, m));
      s.place(m.x, m.y, m.gz, lean);
      const ring = this.eliteRings.get(m.uid);
      if (ring) {
        ring.visible = show && m.state !== 'dead';
        ring.position.set(m.x * SCALE, m.gz * SCALE + 0.06, m.y * SCALE);
        ring.scale.setScalar(d.size / 12);
      }
    }
    for (const [uid, s] of this.mobs) {
      if (seen.has(uid)) continue;
      this.group.remove(s.mesh);
      s.dispose();
      this.mobs.delete(uid);
      const ring = this.eliteRings.get(uid);
      if (ring) {
        this.group.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        this.eliteRings.delete(uid);
      }
    }
  }

  private syncNodes(lean: number, near: (x: number, y: number, r?: number) => boolean): void {
    for (const n of this.zone.nodes) {
      let v = this.nodes.get(n.uid);
      if (!v) {
        const tree = n.kind === 'tree';
        const s = new Sprite(tree ? 68 : 40, tree ? 66 : 30, { res: 2.5, footPad: 4 });
        s.mesh.scale.setScalar(tree ? 1.9 : 1.4);
        v = { sprite: s, dirty: true };
        this.nodes.set(n.uid, v);
        this.group.add(s.mesh);
        s.place(n.x, n.y, n.gz, lean);
      }
      const gone = n.respawn > 0;
      v.sprite.mesh.visible = !gone && near(n.x, n.y, 60);
      if (gone) { v.dirty = true; continue; }
      const active = n.hitFlash > 0 || n.shakeT > 0;
      if (active || v.dirty) {
        v.sprite.paint(n.x, n.y - n.gz, (c) => drawNode(c, n));
        v.dirty = active;
      }
    }
  }

  private syncCritters(now: number, lean: number, near: (x: number, y: number, r?: number) => boolean): void {
    this.zone.critters.forEach((c, i) => {
      let s = this.critters.get(i);
      if (!s) {
        const size = CRITTER_SIZE[c.kind] ?? [24, 28, 2];
        s = new Sprite(size[0], size[1], { res: 3, footPad: size[2], castShadow: c.kind !== 'firefly' });
        s.mesh.scale.setScalar(1.3);
        this.critters.set(i, s);
        this.group.add(s.mesh);
      }
      const show = near(c.x, c.y);
      s.mesh.visible = show;
      if (show) s.paint(c.x, c.y, (ctx) => drawCritter(ctx, { ...c, z: 0 }, now / 1000));
      const ground = standZ(this.zone, c.x, c.y);
      s.place(c.x, c.y, Math.max(0, Math.min(2000, ground)) + c.z, lean);
    });
  }

  private syncSlash(): void {
    const z = this.zone;
    if (!z.slashes.length) { this.slashArc.visible = false; return; }
    const s = z.slashes[z.slashes.length - 1];
    const k = 1 - s.t / (s.life ?? 0.24);
    const m = this.slashArc.material as THREE.MeshBasicMaterial;
    this.slashArc.visible = k > 0;
    m.opacity = 0.6 * k;
    m.color.set(s.color ?? '#fff6e0');
    this.slashArc.position.set(s.x * SCALE, (s.z ?? z.groundZ) * SCALE + 0.1, s.y * SCALE);
    this.slashArc.rotation.z = -s.ang + Math.PI / 2;
    const r = (s.range / 34) * 0.9;
    this.slashArc.scale.set(r, r, 1);
  }

  private syncDrops(now: number): void {
    const seen = new Set<string>();
    for (const d of this.zone.drops) {
      seen.add(d.uid);
      let o = this.drops.get(d.uid);
      if (!o) {
        o = new THREE.Group();
        const col = ITEM_DEFS[d.item.defId]?.color ?? '#c9ccd6';
        o.add(mesh(G.box(), mat(col, { emissive: shadeHex(col, -100) }), 0, 0, 0, 0.36, 0.36, 0.36));
        if (d.item.rarity !== 'common') {
          const beam = mesh(G.cyl(), new THREE.MeshBasicMaterial({
            color: new THREE.Color(rarityColor(d.item.rarity)),
            transparent: true, opacity: 0.26, depthWrite: false,
          }), 0, 2.4, 0, 0.36, 4.8, 0.36);
          beam.castShadow = false;
          o.add(beam);
        }
        this.drops.set(d.uid, o);
        this.group.add(o);
      }
      o.position.set(d.x * SCALE, d.gz * SCALE + 0.32 + d.z * SCALE, d.y * SCALE);
      o.rotation.y = now * 0.0018;
      o.children[0].rotation.x = now * 0.0022;
    }
    for (const [uid, o] of this.drops) {
      if (seen.has(uid)) continue;
      this.group.remove(o);
      this.drops.delete(uid);
    }
  }

  private syncProjectiles(): void {
    const z = this.zone;
    const shots: { x: number; y: number; z: number; color: string; size: number }[] = [];
    for (const p of z.projectiles) shots.push({ x: p.x, y: p.y, z: p.z ?? z.groundZ + 18, color: p.color, size: p.size });
    for (const p of z.netProj) shots.push(p);
    for (let i = 0; i < Math.max(shots.length, this.projectiles.length); i++) {
      const p = shots[i];
      let o = this.projectiles[i];
      if (!p) { if (o) o.visible = false; continue; }
      if (!o) {
        o = mesh(G.sphere(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0, 0, 0.3, 0.3, 0.3);
        o.castShadow = false;
        this.projectiles.push(o);
        this.group.add(o);
      }
      o.visible = true;
      (o.material as THREE.MeshBasicMaterial).color.set(p.color);
      o.scale.setScalar(Math.max(0.26, p.size / 20));
      o.position.set(p.x * SCALE, p.z * SCALE, p.y * SCALE);
    }
  }

  private syncTelegraphs(): void {
    for (const t of this.telegraphs) {
      this.group.remove(t);
      t.geometry.dispose();
      (t.material as THREE.Material).dispose();
    }
    this.telegraphs = [];
    for (const tg of this.zone.telegraphs) {
      const k = Math.min(1, tg.t / Math.max(0.01, tg.total));
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(tg.color), transparent: true,
        opacity: 0.2 + k * 0.32, side: THREE.DoubleSide, depthWrite: false,
      });
      let m: THREE.Mesh;
      if (tg.kind === 'circle') {
        m = new THREE.Mesh(new THREE.CircleGeometry(tg.r * SCALE, 40), material);
      } else if (tg.kind === 'cone') {
        m = new THREE.Mesh(new THREE.CircleGeometry(tg.r * SCALE, 32, -tg.arc, tg.arc * 2), material);
      } else {
        m = new THREE.Mesh(new THREE.PlaneGeometry(tg.len * SCALE, tg.wide * SCALE), material);
      }
      m.rotation.x = -Math.PI / 2;
      if (tg.kind !== 'circle') m.rotation.z = -tg.ang;
      const y = (tg.z ?? 0) * SCALE + 0.08;
      if (tg.kind === 'line') {
        m.position.set((tg.x + Math.cos(tg.ang) * tg.len / 2) * SCALE, y,
          (tg.y + Math.sin(tg.ang) * tg.len / 2) * SCALE);
      } else {
        m.position.set(tg.x * SCALE, y, tg.y * SCALE);
      }
      m.castShadow = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.telegraphs.push(m);
    }
  }

  private syncImpacts(now: number): void {
    for (const im of this.zone.impacts) {
      if (this.impactRings.some((r) => r.src === im)) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(im.r * SCALE * 0.2, im.r * SCALE, 40),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(im.color), transparent: true, opacity: 0.5,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(im.x * SCALE, (im.z ?? 0) * SCALE + 0.1, im.y * SCALE);
      this.group.add(ring);
      this.impactRings.push({ mesh: ring, born: now, total: Math.max(0.08, im.t) * 1000, src: im });
    }
    for (let i = this.impactRings.length - 1; i >= 0; i--) {
      const r = this.impactRings[i];
      const age = (now - r.born) / r.total;
      if (age >= 1.35) {
        this.group.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.impactRings.splice(i, 1);
        continue;
      }
      const mm = r.mesh.material as THREE.MeshBasicMaterial;
      mm.opacity = age < 1 ? 0.25 + age * 0.4 : Math.max(0, 0.65 - (age - 1) * 2);
      r.mesh.scale.setScalar(age < 1 ? 1 : 1 + (age - 1) * 0.5);
    }
  }

  private syncParticles(): void {
    const ps = this.zone.particles;
    const cap = this.pPos.length / 3;
    const n = Math.min(ps.length, cap);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      this.pPos[i * 3] = p.x * SCALE;
      this.pPos[i * 3 + 1] = p.z * SCALE + 0.3;
      this.pPos[i * 3 + 2] = p.y * SCALE;
      col.set(p.color);
      this.pCol[i * 3] = col.r;
      this.pCol[i * 3 + 1] = col.g;
      this.pCol[i * 3 + 2] = col.b;
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.setDrawRange(0, n);
  }

  private syncMotes(): void {
    const arr = this.mGeo.attributes.position.array as Float32Array;
    const ms = this.zone.motes;
    const n = Math.min(ms.length, arr.length / 3);
    const snow = this.zone.def.ambience === 'snow';
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      const k = Math.sin((m.t / m.life) * Math.PI);
      arr[i * 3] = m.x * SCALE;
      const fall = snow ? (1 - m.t / m.life) * 3 : 0;
      arr[i * 3 + 1] = k > 0 ? m.z * SCALE + 0.8 + fall : -999;
      arr[i * 3 + 2] = m.y * SCALE;
    }
    this.mGeo.attributes.position.needsUpdate = true;
    this.mGeo.setDrawRange(0, n);
  }
}

function rarityColor(r: string): string {
  return ({
    common: '#b9b4a7', uncommon: '#63c76a', rare: '#5a9ded',
    epic: '#b464e0', legendary: '#e8a33d',
  } as Record<string, string>)[r] ?? '#b9b4a7';
}

function shadeHex(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt / 255);
  return '#' + c.getHexString();
}

/** A tree or boulder that is only ever looked at: never hit, never shaking. */
function stillNode(kind: 'tree' | 'rock', x: number, y: number, variant: number): ResourceNode {
  return { uid: '', kind, x, y, hp: 1, maxHp: 1, variant, hitFlash: 0, shakeT: 0, respawn: 0, gz: 0 };
}

function drawPine(c: CanvasRenderingContext2D, x: number, y: number, variant: number, snow: boolean): void {
  c.fillStyle = '#5b4030';
  c.fillRect(x - 3, y - 14, 6, 14);
  const greens = snow ? ['#3a5a48', '#44664f'] : ['#2f5a3a', '#3a6a42'];
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const w = 24 - i * 4.5, top = y - 12 - i * 15;
    c.fillStyle = greens[(i + variant) % 2];
    c.beginPath();
    c.moveTo(x - w, top);
    c.lineTo(x, top - 26);
    c.lineTo(x + w, top);
    c.closePath();
    c.fill();
    if (snow) {
      c.fillStyle = '#eef3f7';
      c.beginPath();
      c.moveTo(x - w * 0.55, top - 12);
      c.lineTo(x, top - 26);
      c.lineTo(x + w * 0.55, top - 12);
      c.closePath();
      c.fill();
    } else {
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.beginPath();
      c.moveTo(x - w * 0.6, top - 4);
      c.lineTo(x - 2, top - 22);
      c.lineTo(x - 2, top - 4);
      c.closePath();
      c.fill();
    }
  }
}

function drawDeadTree(c: CanvasRenderingContext2D, x: number, y: number, variant: number, charred: boolean): void {
  c.strokeStyle = charred ? '#2a2220' : '#5a4a3e';
  c.lineCap = 'round';
  c.lineWidth = 6;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + (variant ? 3 : -2), y - 46); c.stroke();
  c.lineWidth = 3;
  const limbs: [number, number, number, number][] = [
    [x, y - 30, x - 16, y - 46], [x + 1, y - 38, x + 14, y - 58], [x - 1, y - 44, x - 8, y - 64],
  ];
  for (const [a, b, cc, d] of limbs) { c.beginPath(); c.moveTo(a, b); c.lineTo(cc, d); c.stroke(); }
  if (charred) {
    c.fillStyle = 'rgba(255,120,50,0.6)';
    c.fillRect(x - 1, y - 20, 2, 5);
  }
}

function drawCache(c: CanvasRenderingContext2D, x: number, y: number): void {
  soft(c, x, y - 12, 18, '#ffe28a', 0.35);
  c.fillStyle = '#6b4a2a';
  c.beginPath(); c.roundRect(x - 13, y - 16, 26, 16, 3); c.fill();
  c.fillStyle = '#8a6440';
  c.beginPath(); c.roundRect(x - 14, y - 22, 28, 8, 4); c.fill();
  c.fillStyle = '#d8b45a';
  c.fillRect(x - 2, y - 17, 4, 6);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fillRect(x - 11, y - 21, 20, 2);
}

/** Molten rock at the bottom of every hole in the Ashen Field. */
function lavaPools(grid: WorldGrid): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  for (let gy = 0; gy < grid.h; gy++) {
    for (let gx = 0; gx < grid.w; gx++) {
      if (grid.ter[gy * grid.w + gx] !== T_PIT) continue;
      const x0 = (gx + grid.ox) * TS * SCALE, x1 = x0 + TS * SCALE;
      const z0 = (gy + grid.oy) * TS * SCALE, z1 = z0 + TS * SCALE;
      const b = pos.length / 3;
      pos.push(x0, -2.4, z0, x1, -2.4, z0, x1, -2.4, z1, x0, -2.4, z1);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.72, 0.2) }));
  m.castShadow = false;
  return m;
}

/** How the grade should feel in a zone. */
export function zoneMood(def: ZoneDef): Mood {
  if (def.ambience === 'embers') return 'ember';
  if (def.ambience === 'fireflies') return 'gloom';
  if (def.ambience === 'snow') return 'snow';
  return 'wild';
}

