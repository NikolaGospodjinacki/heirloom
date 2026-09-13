import * as THREE from 'three';
import { SCALE, Stage, clearGroup } from './core';
import { G, mat, makeGround, makeSkirt, mesh, shade } from './kit';
import { Sprite, standee } from './sprite';
import { cliffFaceMaterial, grainTexture, paintZoneGround, roadStrip, withGrain } from './paint';
import type { Diorama } from './diorama';
import type { Mood } from './post';
import { MONSTERS } from '../game/content';
import type { ZoneDef } from '../game/content';
import { inChasm, standZ } from '../game/zone';
import type { Chasm, Node as ResourceNode, Plateau, Zone } from '../game/zone';
import { RNG } from '../game/rng';
import { ITEM_DEFS } from '../game/items';
import { drawCritter, drawFlora, drawMob, drawNode } from '../render/draw';

const TS = 48;

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

/**
 * The zone as an HD-2D diorama: real terrain, cliffs and holes, with every
 * creature, tree and tuft of grass a painted standee made by the 2D art.
 * The simulation is untouched; this only reads it.
 */
export class ZoneView {
  group = new THREE.Group();
  private mobs = new Map<string, Sprite>();
  private nodes = new Map<string, NodeView>();
  private critters = new Map<number, Sprite>();
  private flora: { mesh: THREE.Mesh; phase: number; sways: boolean }[] = [];
  private drops = new Map<string, THREE.Group>();
  private telegraphs: THREE.Mesh[] = [];
  private particles: THREE.Points;
  private pGeo: THREE.BufferGeometry;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private motes: THREE.Points;
  private mGeo: THREE.BufferGeometry;
  private slashArc: THREE.Mesh;
  private projectiles = new Map<number, THREE.Mesh>();
  private impactRings: { mesh: THREE.Mesh; born: number; total: number; src: object }[] = [];
  private stage: Stage;
  private zone: Zone;
  private groundTex: THREE.Texture;
  private glowTex: THREE.Texture | null = null;
  private leaned = false;

  constructor(stage: Stage, zone: Zone) {
    this.stage = stage;
    this.zone = zone;
    const def = zone.def;

    stage.scene.background = new THREE.Color(def.skyBottom);
    stage.scene.fog = new THREE.Fog(def.skyBottom, 54, 165);
    stage.hemi.color = new THREE.Color(shade(def.skyTop, 40));
    stage.hemi.groundColor = new THREE.Color(def.ground);
    stage.hemi.intensity = 1.55;
    stage.sun.color = new THREE.Color('#ffe2b4');
    stage.sun.intensity = 1.8;

    // ---------------------------------------------------------------- ground
    const mapW = def.w * TS * SCALE, mapH = def.h * TS * SCALE;
    const paint = paintZoneGround(def, zone.tiles, zone.chasms, zone.plateaus, { x: zone.exitX, y: zone.exitY });
    this.groundTex = paint.map;
    this.glowTex = paint.glow;
    const grain = grainTexture(def.terrain === 'ridge' || def.ambience === 'fireflies' ? 'gravel' : 'grass');
    const groundMat = withGrain(new THREE.MeshLambertMaterial({ map: paint.map }), grain, 1.15);
    if (paint.glow) {
      groundMat.emissiveMap = paint.glow;
      groundMat.emissive = new THREE.Color('#ffffff');
      groundMat.emissiveIntensity = 1.9;
    }
    this.group.add(makeGround(def.w, def.h, TS, zone.chasms, paint.map, '#ffffff', groundMat));
    this.group.add(makeSkirt(mapW, mapH, 400, paint.edge,
      withGrain(new THREE.MeshLambertMaterial({ color: new THREE.Color(paint.edge) }), grain, 1.15)));
    this.group.add(roadStrip(zone.exitX * SCALE, mapH, 3.8, 70));

    const ember = def.ambience === 'embers';
    const pitMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(ember ? '#3a1d12' : shade(def.ground, -84)) });
    for (const c of zone.chasms) {
      const pit = pitGeometry(zone, c, 14);
      const inside = new THREE.Mesh(pit.geo, pitMat);
      inside.receiveShadow = true;
      this.group.add(inside);
      if (!ember) continue;
      // lava a little way down, bright enough to bloom, lighting the walls of the ravine
      const cx = (c.x + c.w / 2) * SCALE, cz = (c.y + c.h / 2) * SCALE;
      const lava = new THREE.Mesh(new THREE.PlaneGeometry(c.w * SCALE, c.h * SCALE),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.72, 0.2) }));
      lava.rotation.x = -Math.PI / 2;
      lava.position.set(cx, pit.rim - 2.2, cz);
      this.group.add(lava);
      const heat = new THREE.PointLight('#ff7a30', 14, 11, 1.4);
      heat.position.set(cx, pit.rim - 1.0, cz);
      this.group.add(heat);
    }

    // ------------------------------------------------------ cliffs and ledges
    // Each ledge is its walls, running from the ground beside them up to the
    // top, and a lid that reuses the ground painting where it sits on the map.
    const face = cliffFaceMaterial(def);
    for (const p of [...zone.plateaus].sort((a, b) => a.z - b.z)) {
      const walls = new THREE.Mesh(riserGeometry(zone, p), face);
      walls.castShadow = true;
      walls.receiveShadow = true;
      this.group.add(walls);

      const top = new THREE.Mesh(lidGeometry(p, zone.chasms, mapW, mapH), groundMat);
      top.position.y = p.z * SCALE + 0.01;
      top.receiveShadow = true;
      this.group.add(top);
    }

    this.group.add(this.outskirts(def, mapW, mapH));

    this.group.add(makeHorizon(mapW, mapH, def.backdrop, def.skyBottom));

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
      size: 0.22, color: new THREE.Color(def.ambienceColor), transparent: true,
      opacity: 0.7, depthWrite: false,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    // ------------------------------------------------------------- the road
    const pad = mesh(G.ring(), mat('#e0b64f', { emissive: '#6a5018' }),
      zone.exitX * SCALE, 0.05, zone.exitY * SCALE, 4.4, 4.4, 4.4);
    pad.rotation.x = -Math.PI / 2;
    pad.castShadow = false;
    this.group.add(pad);

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

  /** Woods and boulders past the edge of the map, so the world does not stop at a line. */
  private outskirts(def: ZoneDef, mapW: number, mapH: number): THREE.Group {
    const g = new THREE.Group();
    const r = new RNG(def.w * 53 + def.h * 7 + 11);
    const roadX = this.zone.exitX * SCALE;
    const treeShare = def.trees / Math.max(1, def.trees + def.rocks);
    for (let i = 0; i < 170; i++) {
      const side = r.int(0, 3);
      const out = 1.5 + Math.pow(r.next(), 1.7) * 28;
      let x: number, z: number;
      if (side === 0) { x = r.float(-30, mapW + 30); z = mapH + out; }
      else if (side === 1) { x = r.float(-30, mapW + 30); z = -out; }
      else if (side === 2) { x = -out; z = r.float(-10, mapH + 10); }
      else { x = mapW + out; z = r.float(-10, mapH + 10); }
      if (side === 0 && Math.abs(x - roadX) < 4) continue;
      const tree = r.chance(treeShare);
      const v = r.int(0, 2);
      const m = tree
        ? standee('outskirts:tree:' + v, 68, 66, 4, (c, fx, fy) => drawNode(c, stillNode('tree', fx, fy, v)), 2.5)
        : standee('outskirts:rock:' + v, 40, 30, 4, (c, fx, fy) => drawNode(c, stillNode('rock', fx, fy, v)), 2.5);
      m.position.set(x, 0, z);
      m.scale.setScalar((tree ? 1.9 : 1.4) * r.float(0.85, 1.2));
      this.flora.push({ mesh: m, phase: 0, sways: false });
      g.add(m);
    }
    return g;
  }

  dispose(): void {
    for (const s of this.mobs.values()) s.dispose();
    for (const n of this.nodes.values()) n.sprite.dispose();
    for (const s of this.critters.values()) s.dispose();
    for (const t of this.telegraphs) { t.geometry.dispose(); (t.material as THREE.Material).dispose(); }
    this.stage.world.remove(this.group);
    clearGroup(this.group);
    this.groundTex.dispose();
    this.glowTex?.dispose();
  }

  sync(now: number, cam: Diorama): void {
    const lean = cam.spriteLean;
    const f = cam.focus();
    const near = (sx: number, sy: number, r = 48) =>
      Math.abs(sx * SCALE - f.x) < r && Math.abs(sy * SCALE - f.z) < r * 1.2;

    if (!this.leaned) {
      for (const fl of this.flora) fl.mesh.rotation.x = lean;
      this.leaned = true;
    }

    this.syncMobs(lean, near);
    this.syncNodes(lean, near);
    this.syncCritters(now, lean, near);
    for (const fl of this.flora) {
      if (!fl.sways) continue;
      fl.mesh.rotation.z = Math.sin(now * 0.0016 + fl.phase) * 0.07;
    }
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
      if (!s) {
        const d = MONSTERS[m.defId];
        const boss = d.family === 'boss';
        const sw = boss ? Math.max(70, d.size * 5.8) : Math.max(46, d.size * 3.8);
        const sh = boss ? Math.max(70, d.size * 4.0) : Math.max(46, d.size * 3.5);
        s = new Sprite(sw, sh, { res: boss ? 2 : 2.5, footPad: boss ? Math.round(d.size * 0.5) : 8 });
        s.mesh.scale.setScalar(boss ? 1.25 : 1.15);
        this.mobs.set(m.uid, s);
        this.group.add(s.mesh);
      }
      const show = near(m.x, m.y);
      s.mesh.visible = show;
      if (show) s.paint(m.x, m.y - m.gz, (c) => drawMob(c, m));
      s.place(m.x, m.y, m.gz, lean);
    }
    for (const [uid, s] of this.mobs) {
      if (seen.has(uid)) continue;
      this.group.remove(s.mesh);
      s.dispose();
      this.mobs.delete(uid);
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
      s.place(c.x, c.y, c.z, lean);
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
    this.slashArc.position.set(s.x * SCALE, z.groundZ * SCALE + 0.08, s.y * SCALE);
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
        o.add(mesh(G.box(), mat(col, { emissive: shade(col, -100) }), 0, 0, 0, 0.36, 0.36, 0.36));
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
    for (let i = 0; i < 40; i++) {
      const p = z.projectiles[i];
      let o = this.projectiles.get(i);
      if (!p) { if (o) o.visible = false; continue; }
      if (!o) {
        o = mesh(G.sphere(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0, 0, 0.3, 0.3, 0.3);
        o.castShadow = false;
        this.projectiles.set(i, o);
        this.group.add(o);
      }
      o.visible = true;
      (o.material as THREE.MeshBasicMaterial).color.set(p.color);
      o.scale.setScalar(Math.max(0.26, p.size / 20));
      o.position.set(p.x * SCALE, z.groundZ * SCALE + 1.0, p.y * SCALE);
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
      if (tg.kind === 'line') {
        m.position.set((tg.x + Math.cos(tg.ang) * tg.len / 2) * SCALE, 0.07,
          (tg.y + Math.sin(tg.ang) * tg.len / 2) * SCALE);
      } else {
        m.position.set(tg.x * SCALE, 0.07, tg.y * SCALE);
      }
      m.castShadow = false;
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
      ring.position.set(im.x * SCALE, 0.09, im.y * SCALE);
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
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      const k = Math.sin((m.t / m.life) * Math.PI);
      arr[i * 3] = m.x * SCALE;
      arr[i * 3 + 1] = k > 0 ? m.z * SCALE + 0.8 : -999;
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

/** A ring of distant peaks past the map edge, only really seen near the north side. */
function makeHorizon(mapW: number, mapH: number, kind: string, tint: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'none') return g;
  const cx = mapW / 2, cz = mapH / 2;
  const radius = Math.max(mapW, mapH) * 0.8 + 40;
  const tall = kind === 'peaks' ? 52 : kind === 'mountains' ? 38 : kind === 'crags' ? 26 : 16;
  const rockA = mat(shade(tint, -54));
  const rockB = mat(shade(tint, -30));
  const count = 46;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const jitter = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    const h = tall * (0.5 + jitter * 0.9);
    const r = radius * (0.86 + Math.abs(Math.cos(i * 3.1)) * 0.22);
    const peak = mesh(G.cone(), i % 3 ? rockA : rockB,
      cx + Math.cos(a) * r, h / 2 - 4, cz + Math.sin(a) * r, h * 0.95, h, h * 0.95);
    peak.castShadow = false;
    peak.receiveShadow = false;
    g.add(peak);
    if (kind === 'peaks' && h > tall * 0.9) {
      const cap = mesh(G.cone(), mat('#e6ebf5'),
        cx + Math.cos(a) * r, h - h * 0.12, cz + Math.sin(a) * r, h * 0.3, h * 0.26, h * 0.3);
      cap.castShadow = false;
      g.add(cap);
    }
  }
  return g;
}

/**
 * The walls of one ledge, in short runs. Each run goes from the ground just
 * outside it up to the top, so a step up from a lower tier is only as tall as
 * the step, and runs are left out wherever a ravine has cut into the ledge. The
 * face repeats along a wall and stretches once up it, which keeps the turf at
 * the lip and the shadow at the foot whatever the height.
 */
function riserGeometry(zone: Zone, p: Plateau): THREE.BufferGeometry {
  const top = p.z * SCALE;
  const x0 = p.x * SCALE, x1 = (p.x + p.w) * SCALE;
  const z0 = p.y * SCALE, z1 = (p.y + p.h) * SCALE;
  const along = 2.6;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const wall = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const runs = Math.max(1, Math.ceil(len / 2));
    for (let s = 0; s < runs; s++) {
      const k0 = s / runs, k1 = (s + 1) / runs, km = (s + 0.5) / runs;
      const mx = (ax + (bx - ax) * km) / SCALE, my = (az + (bz - az) * km) / SCALE;
      if (inChasm(zone, mx - nx * 3, my - nz * 3)) continue;
      const base = standZ(zone, mx + nx * 3, my + nz * 3) * SCALE;
      if (top - base < 0.05) continue;
      const i0 = pos.length / 3;
      pos.push(
        ax + (bx - ax) * k0, base - 0.02, az + (bz - az) * k0,
        ax + (bx - ax) * k1, base - 0.02, az + (bz - az) * k1,
        ax + (bx - ax) * k1, top, az + (bz - az) * k1,
        ax + (bx - ax) * k0, top, az + (bz - az) * k0,
      );
      for (let i = 0; i < 4; i++) nor.push(nx, 0, nz);
      const uA = (len * k0) / along, uB = (len * k1) / along;
      uv.push(uA, 0, uB, 0, uB, 1, uA, 1);
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }
  };
  wall(x0, z1, x1, z1, 0, 1);    // south, facing the camera
  wall(x1, z0, x0, z0, 0, -1);   // north
  wall(x1, z1, x1, z0, 1, 0);    // east
  wall(x0, z0, x0, z1, -1, 0);   // west
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** The top of a ledge, painted from the ground map, with a hole wherever a ravine cuts into it. */
function lidGeometry(p: Plateau, chasms: Chasm[], mapW: number, mapH: number): THREE.BufferGeometry {
  const x0 = p.x * SCALE, x1 = (p.x + p.w) * SCALE;
  const z0 = p.y * SCALE, z1 = (p.y + p.h) * SCALE;
  // built with z negated, like the ground, so laying it flat leaves it facing up
  const shape = new THREE.Shape();
  shape.moveTo(x0, -z0);
  shape.lineTo(x1, -z0);
  shape.lineTo(x1, -z1);
  shape.lineTo(x0, -z1);
  shape.closePath();
  const inset = 0.03;
  for (const c of chasms) {
    const hx0 = Math.max(c.x * SCALE, x0 + inset), hx1 = Math.min((c.x + c.w) * SCALE, x1 - inset);
    const hz0 = Math.max(c.y * SCALE, z0 + inset), hz1 = Math.min((c.y + c.h) * SCALE, z1 - inset);
    if (hx1 - hx0 < 0.05 || hz1 - hz0 < 0.05) continue;
    const hole = new THREE.Path();
    hole.moveTo(hx0, -hz0);
    hole.lineTo(hx0, -hz1);
    hole.lineTo(hx1, -hz1);
    hole.lineTo(hx1, -hz0);
    hole.closePath();
    shape.holes.push(hole);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / mapW;
    uv[i * 2 + 1] = 1 - pos.getZ(i) / mapH;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * The inside of a ravine: four walls facing in and a floor far below. Each
 * wall's top follows the ground along its edge, so a ravine cut into a ledge is
 * lined all the way up to the lip. `rim` is the lowest point of that lip.
 */
function pitGeometry(zone: Zone, c: Chasm, depth: number): { geo: THREE.BufferGeometry; rim: number } {
  const x0 = c.x * SCALE, x1 = (c.x + c.w) * SCALE;
  const z0 = c.y * SCALE, z1 = (c.y + c.h) * SCALE;
  const bottom = -depth;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let rim = Infinity;
  const wall = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void => {
    const runs = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
    for (let s = 0; s < runs; s++) {
      const k0 = s / runs, k1 = (s + 1) / runs, km = (s + 0.5) / runs;
      // the ground just outside this stretch of the edge
      const sx = (ax + (bx - ax) * km) / SCALE - nx * 3, sy = (az + (bz - az) * km) / SCALE - nz * 3;
      const top = standZ(zone, sx, sy) * SCALE + 0.02;
      rim = Math.min(rim, top);
      const i0 = pos.length / 3;
      pos.push(
        ax + (bx - ax) * k0, bottom, az + (bz - az) * k0,
        ax + (bx - ax) * k1, bottom, az + (bz - az) * k1,
        ax + (bx - ax) * k1, top, az + (bz - az) * k1,
        ax + (bx - ax) * k0, top, az + (bz - az) * k0,
      );
      for (let i = 0; i < 4; i++) nor.push(nx, 0, nz);
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }
  };
  wall(x0, z0, x1, z0, 0, 1);    // north wall, facing south into the hole
  wall(x1, z1, x0, z1, 0, -1);   // south wall
  wall(x0, z1, x0, z0, 1, 0);    // west wall
  wall(x1, z0, x1, z1, -1, 0);   // east wall
  const i0 = pos.length / 3;
  pos.push(x0, bottom, z1, x1, bottom, z1, x1, bottom, z0, x0, bottom, z0);
  for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
  idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return { geo: g, rim: Number.isFinite(rim) ? rim : 0 };
}

/** A tree or boulder that is only ever looked at: never hit, never shaking. */
function stillNode(kind: 'tree' | 'rock', x: number, y: number, variant: number): ResourceNode {
  return { uid: '', kind, x, y, hp: 1, maxHp: 1, variant, hitFlash: 0, shakeT: 0, respawn: 0, gz: 0 };
}

/** How the grade should feel in a zone. */
export function zoneMood(def: ZoneDef): Mood {
  if (def.ambience === 'embers') return 'ember';
  if (def.ambience === 'fireflies') return 'gloom';
  return 'wild';
}
