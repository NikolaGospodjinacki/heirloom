import * as THREE from 'three';
import { SCALE, Stage, clearGroup } from './core';
import {
  G, groundTexture, mat, makeBone, makeCrystal, makeFern, makeFlower, makeGround,
  makeMushroom, makePit, makeReed, makeRock, makeStump, makeTree, makeBeast, makeOoze,
  makePerson, mesh, shade,
} from './kit';
import { MONSTERS } from '../game/content';
import type { Mob, Zone } from '../game/zone';
import { ITEM_DEFS } from '../game/items';

const TS = 48;

interface MobView { root: THREE.Group; body: THREE.Mesh; baseColor: THREE.Color; defId: string }

/**
 * Owns the three.js side of a zone. The simulation is untouched: every frame
 * this reads the sim and moves objects to match.
 */
export class ZoneView {
  group = new THREE.Group();
  private mobs = new Map<string, MobView>();
  private nodes = new Map<string, THREE.Group>();
  private drops = new Map<string, THREE.Group>();
  private telegraphs: { mesh: THREE.Mesh; key: object }[] = [];
  private particles: THREE.Points;
  private pGeo: THREE.BufferGeometry;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private motes: THREE.Points;
  private mGeo: THREE.BufferGeometry;
  private critters = new Map<number, THREE.Group>();
  private slashArc: THREE.Mesh;
  private projectiles = new Map<number, THREE.Mesh>();
  private impactRings: { mesh: THREE.Mesh; born: number; total: number }[] = [];
  private stage: Stage;
  private zone: Zone;
  private groundTex: THREE.Texture;

  constructor(stage: Stage, zone: Zone) {
    this.stage = stage;
    this.zone = zone;
    const def = zone.def;
    stage.scene.background = new THREE.Color(def.skyTop);
    stage.scene.fog = new THREE.Fog(def.skyBottom, 26, 135);
    stage.hemi.color = new THREE.Color(def.skyTop);
    stage.hemi.groundColor = new THREE.Color(def.ground);

    // ---------------------------------------------------------------- ground
    this.groundTex = groundTexture(def.w, def.h, zone.tiles, def.ground, def.ground2);
    const ground = makeGround(def.w, def.h, TS, zone.chasms, this.groundTex, '#ffffff');
    this.group.add(ground);
    for (const c of zone.chasms) this.group.add(makePit(c, 14, shade(def.ground, -70)));

    // --------------------------------------------------------------- terrain
    for (const p of zone.plateaus) {
      const h = p.z * SCALE;
      const top = mesh(
        G.box(), mat(shade(def.ground2, 8)),
        (p.x + p.w / 2) * SCALE, h / 2, (p.y + p.h / 2) * SCALE,
        p.w * SCALE, h, p.h * SCALE,
      );
      top.receiveShadow = true;
      this.group.add(top);
      // a lip so the edge reads as a cliff you have to jump
      const lip = mesh(
        G.box(), mat(shade(def.ground, -26)),
        (p.x + p.w / 2) * SCALE, h - 0.06, (p.y + p.h) * SCALE,
        p.w * SCALE + 0.06, 0.16, 0.2,
      );
      this.group.add(lip);
    }

    // ------------------------------------------------------------- backdrop
    this.group.add(makeHorizon(def.w * TS * SCALE, def.h * TS * SCALE, def.backdrop, def.skyBottom));

    // ---------------------------------------------------------------- flora
    for (const f of zone.flora) {
      const o = floraMesh(f.kind, f.variant, def.id !== 'barrows' && def.id !== 'ridge');
      if (!o) continue;
      o.position.set(f.x * SCALE, f.gz * SCALE, f.y * SCALE);
      o.rotation.y = (f.x + f.y) % 6.28;
      const s = 0.8 + ((f.x * 7 + f.y * 13) % 40) / 100;
      o.scale.setScalar(s);
      o.traverse((n) => { (n as THREE.Mesh).castShadow = false; });
      this.group.add(o);
    }

    // ------------------------------------------------------------ particles
    const MAXP = 700;
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAXP * 3);
    this.pCol = new Float32Array(MAXP * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(this.pGeo, new THREE.PointsMaterial({
      size: 0.17, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    const MAXM = 220;
    this.mGeo = new THREE.BufferGeometry();
    this.mGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXM * 3), 3));
    this.motes = new THREE.Points(this.mGeo, new THREE.PointsMaterial({
      size: 0.14, color: new THREE.Color(def.ambienceColor), transparent: true,
      opacity: 0.55, depthWrite: false,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    // ------------------------------------------------------------- the road
    const pad = mesh(G.ring(), mat('#e0b64f', { emissive: '#4a3a10' }),
      zone.exitX * SCALE, 0.05, zone.exitY * SCALE, 4.4, 4.4, 4.4);
    pad.rotation.x = -Math.PI / 2;
    pad.castShadow = false;
    this.group.add(pad);

    // ----------------------------------------------------------- the swing
    const arcGeo = new THREE.RingGeometry(0.35, 1.9, 24, 1, -0.9, 1.8);
    this.slashArc = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color('#fff6e0'), transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    this.slashArc.rotation.x = -Math.PI / 2;
    this.slashArc.visible = false;
    this.group.add(this.slashArc);

    stage.world.add(this.group);
  }

  dispose(): void {
    this.stage.world.remove(this.group);
    clearGroup(this.group);
    this.groundTex.dispose();
  }

  // -------------------------------------------------------------- per frame

  sync(now: number): void {
    const z = this.zone;
    this.syncMobs();
    this.syncNodes();
    this.syncDrops(now);
    this.syncProjectiles();
    this.syncTelegraphs(now);
    this.syncImpacts(now);
    this.syncParticles();
    this.syncMotes();
    this.syncCritters(now);

    // the swing arc, laid on the ground in front of you
    if (z.slashes.length) {
      const s = z.slashes[z.slashes.length - 1];
      const k = 1 - s.t / (s.life ?? 0.24);
      this.slashArc.visible = k > 0;
      (this.slashArc.material as THREE.MeshBasicMaterial).opacity = 0.55 * k;
      (this.slashArc.material as THREE.MeshBasicMaterial).color.set(s.color ?? '#fff6e0');
      this.slashArc.position.set(s.x * SCALE, z.groundZ * SCALE + 0.08, s.y * SCALE);
      this.slashArc.rotation.z = -s.ang + Math.PI / 2;
      const r = (s.range / 34) * 0.9;
      this.slashArc.scale.set(r, r, 1);
    } else {
      this.slashArc.visible = false;
    }
  }

  private syncMobs(): void {
    const seen = new Set<string>();
    for (const m of this.zone.mobs) {
      seen.add(m.uid);
      let v = this.mobs.get(m.uid);
      if (!v) {
        v = buildMob(m);
        this.mobs.set(m.uid, v);
        this.group.add(v.root);
      }
      const md = MONSTERS[m.defId];
      const dying = m.state === 'dead';
      v.root.position.set(m.x * SCALE, m.gz * SCALE, m.y * SCALE);
      v.root.rotation.y = -m.facing + Math.PI / 2;
      if (dying) {
        const k = Math.max(0, 1 - m.dead / 1.2);
        v.root.scale.setScalar(k);
        v.root.rotation.z = m.dead * 1.5;
      }
      const bodyMat = v.body.material as THREE.MeshLambertMaterial;
      if (m.hitFlash > 0) bodyMat.emissive.setRGB(0.9, 0.9, 0.9);
      else if (m.slowT > 0) bodyMat.emissive.set('#12384a');
      else bodyMat.emissive.setRGB(0, 0, 0);
      // a squat as it winds up, so you can read the tell in the silhouette
      const wind = m.windup > 0 ? Math.min(1, m.windup / 0.5) : 0;
      const sq = 1 - wind * 0.14;
      if (!dying) v.root.scale.set(1 + wind * 0.1, sq, 1 + wind * 0.1);
      void md;
    }
    for (const [uid, v] of this.mobs) {
      if (seen.has(uid)) continue;
      this.group.remove(v.root);
      this.mobs.delete(uid);
    }
  }

  private syncNodes(): void {
    for (const n of this.zone.nodes) {
      let o = this.nodes.get(n.uid);
      if (!o) {
        o = n.kind === 'tree'
          ? makeTree(n.variant, this.zone.def.id !== 'barrows', 1.15)
          : makeRock(n.variant, shade(this.zone.def.ground2, 26), 1.25);
        o.position.set(n.x * SCALE, n.gz * SCALE, n.y * SCALE);
        o.rotation.y = (n.x * 0.13) % 6.28;
        this.nodes.set(n.uid, o);
        this.group.add(o);
      }
      const gone = n.respawn > 0;
      o.visible = !gone;
      if (gone) continue;
      const shakeAmt = n.shakeT > 0 ? Math.sin(n.shakeT * 70) * 0.06 * (n.shakeT / 0.18) : 0;
      o.rotation.z = shakeAmt;
      const hurt = n.hp < n.maxHp ? 1 - (n.hp / n.maxHp) * 0.12 : 1;
      o.scale.setScalar(hurt);
    }
  }

  private syncDrops(now: number): void {
    const seen = new Set<string>();
    for (const d of this.zone.drops) {
      seen.add(d.uid);
      let o = this.drops.get(d.uid);
      if (!o) {
        o = new THREE.Group();
        const col = itemColor(d.item.defId);
        const cube = mesh(G.box(), mat(col, { emissive: shade(col, -110) }), 0, 0, 0, 0.3, 0.3, 0.3);
        o.add(cube);
        if (d.item.rarity !== 'common') {
          const beam = mesh(G.cyl(), new THREE.MeshBasicMaterial({
            color: new THREE.Color(rarityColor(d.item.rarity)),
            transparent: true, opacity: 0.22, depthWrite: false,
          }), 0, 2.2, 0, 0.34, 4.4, 0.34);
          beam.castShadow = false;
          o.add(beam);
        }
        this.drops.set(d.uid, o);
        this.group.add(o);
      }
      o.position.set(d.x * SCALE, d.gz * SCALE + 0.28 + d.z * SCALE, d.y * SCALE);
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
      const s = p.size / 22;
      o.scale.setScalar(Math.max(0.22, s));
      o.position.set(p.x * SCALE, z.groundZ * SCALE + 0.95, p.y * SCALE);
    }
  }

  private syncTelegraphs(now: number): void {
    for (const t of this.telegraphs) this.group.remove(t.mesh);
    this.telegraphs = [];
    for (const tg of this.zone.telegraphs) {
      const k = Math.min(1, tg.t / Math.max(0.01, tg.total));
      let m: THREE.Mesh;
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(tg.color), transparent: true,
        opacity: 0.18 + k * 0.3, side: THREE.DoubleSide, depthWrite: false,
      });
      if (tg.kind === 'circle') {
        m = new THREE.Mesh(new THREE.CircleGeometry(tg.r * SCALE, 40), material);
      } else if (tg.kind === 'cone') {
        m = new THREE.Mesh(
          new THREE.CircleGeometry(tg.r * SCALE, 32, -tg.arc, tg.arc * 2), material,
        );
      } else {
        m = new THREE.Mesh(new THREE.PlaneGeometry(tg.len * SCALE, tg.wide * SCALE), material);
      }
      m.rotation.x = -Math.PI / 2;
      if (tg.kind === 'cone') m.rotation.z = -tg.ang;
      if (tg.kind === 'line') {
        m.rotation.z = -tg.ang;
        m.position.set(
          (tg.x + Math.cos(tg.ang) * tg.len / 2) * SCALE, 0.07,
          (tg.y + Math.sin(tg.ang) * tg.len / 2) * SCALE,
        );
      } else {
        m.position.set(tg.x * SCALE, 0.07, tg.y * SCALE);
      }
      m.castShadow = false;
      this.group.add(m);
      this.telegraphs.push({ mesh: m, key: tg });
    }
    void now;
  }

  private syncImpacts(now: number): void {
    for (const im of this.zone.impacts) {
      const known = this.impactRings.find((r) => (r as unknown as { src?: object }).src === im);
      if (known) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(im.r * SCALE * 0.2, im.r * SCALE, 40),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(im.color), transparent: true, opacity: 0.5,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(im.x * SCALE, 0.09, im.y * SCALE);
      ring.castShadow = false;
      this.group.add(ring);
      const rec = { mesh: ring, born: now, total: Math.max(0.08, im.t) * 1000 };
      (rec as unknown as { src: object }).src = im;
      this.impactRings.push(rec);
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
      const s = age < 1 ? 1 : 1 + (age - 1) * 0.5;
      r.mesh.scale.setScalar(s);
    }
  }

  private syncParticles(): void {
    const ps = this.zone.particles;
    const n = Math.min(ps.length, this.pPos.length / 3);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      this.pPos[i * 3] = p.x * SCALE;
      this.pPos[i * 3 + 1] = p.z * SCALE + 0.2;
      this.pPos[i * 3 + 2] = p.y * SCALE;
      col.set(p.color);
      this.pCol[i * 3] = col.r; this.pCol[i * 3 + 1] = col.g; this.pCol[i * 3 + 2] = col.b;
    }
    for (let i = n; i < this.pPos.length / 3; i++) this.pPos[i * 3 + 1] = -999;
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.setDrawRange(0, Math.max(1, n));
  }

  private syncMotes(): void {
    const arr = this.mGeo.attributes.position.array as Float32Array;
    const ms = this.zone.motes;
    const n = Math.min(ms.length, arr.length / 3);
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      const k = Math.sin((m.t / m.life) * Math.PI);
      arr[i * 3] = m.x * SCALE;
      arr[i * 3 + 1] = k > 0 ? m.z * SCALE + 0.6 : -999;
      arr[i * 3 + 2] = m.y * SCALE;
    }
    this.mGeo.attributes.position.needsUpdate = true;
    this.mGeo.setDrawRange(0, Math.max(1, n));
  }

  private syncCritters(now: number): void {
    this.zone.critters.forEach((c, i) => {
      let o = this.critters.get(i);
      if (!o) {
        o = makeCritter(c.kind);
        this.critters.set(i, o);
        this.group.add(o);
      }
      o.position.set(c.x * SCALE, c.z * SCALE + 0.3, c.y * SCALE);
      o.rotation.y = now * 0.001 + i;
      if (c.kind === 'butterfly' || c.kind === 'bird') {
        o.children.forEach((w, wi) => {
          w.rotation.z = Math.sin(now * 0.02 + wi * Math.PI) * 0.7;
        });
      }
    });
  }
}

// ------------------------------------------------------------------ helpers

function buildMob(m: Mob): MobView {
  const d = MONSTERS[m.defId];
  const s = d.size / 15;
  let parts;
  if (d.family === 'ooze') parts = makeOoze(d.color, d.accent, s);
  else if (d.family === 'beast') parts = makeBeast(d.color, d.accent, s);
  else if (d.family === 'boss') parts = buildBoss(m.defId, d.color, d.accent, s);
  else parts = makePerson(d.color, shade(d.color, 30), d.accent, s * 1.15);
  parts.root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  // the body material is shared from the cache, and hit flash must not light up
  // every wolf on the map, so this one gets its own copy
  const own = (parts.body.material as THREE.MeshLambertMaterial).clone();
  parts.body.material = own;
  return {
    root: parts.root, body: parts.body,
    baseColor: new THREE.Color(d.color), defId: m.defId,
  };
}

function buildBoss(id: string, color: string, accent: string, s: number) {
  if (id === 'emberwyrm') {
    const root = new THREE.Group();
    const body = mesh(G.sphere(), mat(color), 0, 1.5 * s, 0, 2.4 * s, 1.7 * s, 3.4 * s);
    root.add(body);
    for (const side of [-1, 1]) {
      const wing = mesh(G.box(), mat(shade(color, -22)), side * 2.4 * s, 2.1 * s, -0.2 * s,
        3.2 * s, 0.14 * s, 1.9 * s);
      wing.rotation.z = side * 0.35;
      root.add(wing);
    }
    const neck = mesh(G.cyl(), mat(color), 0, 2.4 * s, 1.9 * s, 0.6 * s, 2.0 * s, 0.6 * s);
    neck.rotation.x = 0.8;
    root.add(neck);
    root.add(mesh(G.sphere(), mat(shade(color, 12)), 0, 3.1 * s, 2.9 * s, 1.0 * s, 0.8 * s, 1.5 * s));
    root.add(mesh(G.sphere(), mat(accent, { emissive: shade(accent, -80) }),
      -0.32 * s, 3.3 * s, 3.4 * s, 0.2 * s, 0.2 * s, 0.2 * s));
    root.add(mesh(G.sphere(), mat(accent, { emissive: shade(accent, -80) }),
      0.32 * s, 3.3 * s, 3.4 * s, 0.2 * s, 0.2 * s, 0.2 * s));
    const tail = mesh(G.cone(), mat(color), 0, 1.3 * s, -3.4 * s, 0.7 * s, 3.4 * s, 0.7 * s);
    tail.rotation.x = Math.PI / 2;
    root.add(tail);
    for (const [lx, lz] of [[-1.2, 1.0], [1.2, 1.0], [-1.2, -1.0], [1.2, -1.0]]) {
      root.add(mesh(G.box(), mat(shade(color, -30)), lx * s, 0.5 * s, lz * s, 0.5 * s, 1.0 * s, 0.5 * s));
    }
    return { root, body };
  }
  if (id === 'quarry_golem') {
    const root = new THREE.Group();
    const body = mesh(G.box(), mat(color), 0, 2.3 * s, 0, 2.6 * s, 2.6 * s, 1.8 * s);
    root.add(body);
    root.add(mesh(G.box(), mat(shade(color, 14)), 0, 4.1 * s, 0, 1.5 * s, 1.1 * s, 1.4 * s));
    root.add(mesh(G.sphere(), mat(accent, { emissive: shade(accent, -70) }),
      -0.4 * s, 4.15 * s, 0.72 * s, 0.24 * s, 0.24 * s, 0.24 * s));
    root.add(mesh(G.sphere(), mat(accent, { emissive: shade(accent, -70) }),
      0.4 * s, 4.15 * s, 0.72 * s, 0.24 * s, 0.24 * s, 0.24 * s));
    for (const side of [-1, 1]) {
      root.add(mesh(G.box(), mat(shade(color, -14)), side * 1.9 * s, 2.4 * s, 0,
        0.9 * s, 2.4 * s, 0.9 * s));
    }
    for (const side of [-1, 1]) {
      root.add(mesh(G.box(), mat(shade(color, -30)), side * 0.7 * s, 0.5 * s, 0,
        0.8 * s, 1.1 * s, 0.9 * s));
    }
    root.add(mesh(G.sphere(), mat(accent, { emissive: shade(accent, -50) }),
      0, 2.4 * s, 0.95 * s, 0.4 * s, 0.4 * s, 0.2 * s));
    return { root, body };
  }
  if (id === 'grovewarden' || id === 'fangmaw') {
    const p = makeBeast(color, accent, s * 1.5);
    p.root.add(mesh(G.sphere(), mat(shade(color, 18)), 0, 1.5 * s, -0.5 * s,
      1.4 * s, 1.0 * s, 1.2 * s));
    return p;
  }
  // the Hollow King
  const root = new THREE.Group();
  const body = mesh(G.cone(), mat(color), 0, 1.6 * s, 0, 2.2 * s, 3.2 * s, 2.2 * s);
  root.add(body);
  root.add(mesh(G.sphere(), mat(shade(color, 26)), 0, 3.5 * s, 0, 0.9 * s, 0.9 * s, 0.9 * s));
  for (let i = -2; i <= 2; i++) {
    root.add(mesh(G.cone(), mat(accent, { emissive: shade(accent, -80) }),
      i * 0.3 * s, 4.2 * s, 0, 0.12 * s, 0.7 * s, 0.12 * s));
  }
  return { root, body };
}

function floraMesh(kind: string, variant: number, lush: boolean): THREE.Group | null {
  switch (kind) {
    case 'grass': return makeGrassTuft(variant, lush);
    case 'flower': return makeFlower(variant);
    case 'mushroom': return makeMushroom(variant);
    case 'fern': return makeFern(variant);
    case 'reed': return makeReed();
    case 'stump': return makeStump();
    case 'crystal': return makeCrystal(variant);
    case 'bone': return makeBone(variant);
    default: return null;
  }
}

function makeGrassTuft(variant: number, lush: boolean): THREE.Group {
  const g = new THREE.Group();
  const cols = lush ? ['#6f9a52', '#7fa85c', '#5f8a46'] : ['#7a7f4a', '#6a7340', '#87884e'];
  const m = mat(cols[variant % 3]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + variant;
    const blade = mesh(G.cone(), m, Math.cos(a) * 0.1, 0.18, Math.sin(a) * 0.1, 0.07, 0.38, 0.07);
    blade.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    g.add(blade);
  }
  return g;
}

function makeCritter(kind: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'firefly') {
    g.add(mesh(G.sphere(), new THREE.MeshBasicMaterial({ color: 0x9be0d2 }), 0, 0, 0, 0.1, 0.1, 0.1));
    return g;
  }
  if (kind === 'rabbit') {
    g.add(mesh(G.sphere(), mat('#a89880'), 0, 0, 0, 0.4, 0.32, 0.5));
    g.add(mesh(G.sphere(), mat('#a89880'), 0, 0.18, 0.26, 0.24, 0.24, 0.24));
    g.add(mesh(G.box(), mat('#8f8070'), -0.07, 0.36, 0.24, 0.06, 0.24, 0.05));
    g.add(mesh(G.box(), mat('#8f8070'), 0.07, 0.36, 0.24, 0.06, 0.24, 0.05));
    return g;
  }
  const col = kind === 'bird' ? '#3a3a42' : '#f0e0a0';
  for (const side of [-1, 1]) {
    const w = mesh(G.plane(), new THREE.MeshBasicMaterial({
      color: new THREE.Color(col), side: THREE.DoubleSide,
    }), side * 0.14, 0, 0, 0.28, 0.2, 1);
    w.castShadow = false;
    g.add(w);
  }
  return g;
}

/** A ring of distant peaks sitting past the map edge. */
function makeHorizon(mapW: number, mapH: number, kind: string, tint: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'none') return g;
  const cx = mapW / 2, cz = mapH / 2;
  const radius = Math.max(mapW, mapH) * 0.78 + 40;
  const tall = kind === 'peaks' ? 46 : kind === 'mountains' ? 34 : kind === 'crags' ? 24 : 14;
  const count = 46;
  const rockA = mat(shade(tint, -58));
  const rockB = mat(shade(tint, -34));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const h = tall * (0.5 + Math.abs(jitter) * 0.9);
    const r = radius * (0.86 + Math.abs(Math.cos(i * 3.1)) * 0.22);
    const peak = mesh(i % 2 ? G.cone() : G.cone(), i % 3 ? rockA : rockB,
      cx + Math.cos(a) * r, h / 2 - 4, cz + Math.sin(a) * r,
      h * 0.95, h, h * 0.95);
    peak.castShadow = false;
    peak.receiveShadow = false;
    g.add(peak);
    if (kind === 'peaks' && h > tall * 0.9) {
      const cap = mesh(G.cone(), mat('#e6ebf5'),
        cx + Math.cos(a) * r, h - h * 0.12, cz + Math.sin(a) * r,
        h * 0.3, h * 0.26, h * 0.3);
      cap.castShadow = false;
      g.add(cap);
    }
  }
  return g;
}

function itemColor(defId: string): string {
  return ITEM_DEFS[defId]?.color ?? '#c9ccd6';
}

function rarityColor(r: string): string {
  return ({
    common: '#b9b4a7', uncommon: '#63c76a', rare: '#5a9ded',
    epic: '#b464e0', legendary: '#e8a33d',
  } as Record<string, string>)[r] ?? '#b9b4a7';
}
