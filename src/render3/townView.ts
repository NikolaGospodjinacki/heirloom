import * as THREE from 'three';
import { SCALE, Stage, clearGroup } from './core';
import { makeGround, makeSkirt, shade } from './kit';
import { Sprite, decal, freshDecal, standee } from './sprite';
import {
  boxUV, facadeMaterials, gableRoof, grainTexture, paintTownGround, plankMaterial, roadStrip, roofMaterial,
  withGrain,
  stoneMaterial, waterMaterial,
} from './paint';
import type { Diorama } from './diorama';
import type { Building, Prop, Town } from '../game/town';
import { drawPlot, drawProp, drawTownNpc } from '../game/town';
import { RNG } from '../game/rng';
import type { GameState } from '../game/state';

const TS = 48;

/** Props that stand up: drawing box (sim px), foot pad, and how big they read next to a person. */
const STANDEE: Record<string, [number, number, number, number]> = {
  tree: [100, 96, 6, 1.6],
  sapling: [32, 42, 3, 1.3],
  bush: [44, 28, 4, 1.35],
  lantern: [26, 62, 3, 1.4],
  well: [80, 90, 20, 1.3],
  stall: [86, 74, 4, 1.4],
  bench: [56, 36, 6, 1.25],
  barrel: [32, 34, 4, 1.3],
  crate: [34, 32, 4, 1.3],
  haybale: [44, 34, 4, 1.3],
  pot: [28, 38, 4, 1.25],
  dummy: [50, 80, 4, 1.35],
  rack: [54, 52, 6, 1.3],
  signpost: [64, 52, 4, 1.3],
  cart: [76, 44, 8, 1.35],
};

/** Props painted flat onto the ground. */
const DECAL: Record<string, [number, number]> = {
  flowerbed: [50, 34],
  crops: [44, 32],
  lilypad: [32, 22],
};

interface Puff { mesh: THREE.Mesh; base: THREE.Vector3; phase: number }

/**
 * The village as an HD-2D diorama. Timber-framed buildings with painted
 * facades and pitched roofs, a real moat and bridge, lanterns that actually
 * light the cobbles, and every person and prop a standee painted by the
 * original 2D art.
 */
export class TownView {
  group = new THREE.Group();
  private npcs = new Map<string, Sprite>();
  private standees: THREE.Mesh[] = [];
  private yard = new THREE.Group();
  private yardTex: THREE.Texture[] = [];
  private ownedTex: THREE.Texture[] = [];
  private lamps: THREE.Vector3[] = [];
  private lights: THREE.PointLight[] = [];
  private puffs: Puff[] = [];
  private water: THREE.MeshLambertMaterial | null = null;
  private stage: Stage;
  private town: Town;
  private groundTex: THREE.Texture;
  private lastYardKey = '';
  private frame = 0;
  private leaned = false;

  constructor(stage: Stage, town: Town, st: GameState) {
    this.stage = stage;
    this.town = town;
    const rich = st.village.preset === 'thriving';

    // late afternoon: warm sun, warm haze, long soft shadows
    stage.scene.background = new THREE.Color('#e8d4b0');
    stage.scene.fog = new THREE.Fog('#e3cfa6', 46, 170);
    stage.hemi.color = new THREE.Color('#ffe6c0');
    stage.hemi.groundColor = new THREE.Color(rich ? '#6a7f4a' : '#5f6146');
    stage.hemi.intensity = 1.2;
    stage.sun.color = new THREE.Color('#ffcf94');
    stage.sun.intensity = 1.85;

    const paint = paintTownGround(town, rich);
    this.groundTex = paint.map;
    const mapW = town.w * TS * SCALE, mapH = town.h * TS * SCALE;
    const grain = grainTexture('grass');
    this.group.add(makeGround(town.w, town.h, TS, [], paint.map, '#ffffff',
      withGrain(new THREE.MeshLambertMaterial({ map: paint.map }), grain, 0.8)));
    this.group.add(makeSkirt(mapW, mapH, 400, paint.edge,
      withGrain(new THREE.MeshLambertMaterial({ color: new THREE.Color(paint.edge) }), grain, 0.8)));
    this.group.add(this.outskirts(rich, mapW, mapH));

    for (const b of town.buildings) this.group.add(this.building(b));
    for (const p of town.props) {
      const o = this.prop(p, rich);
      if (o) this.group.add(o);
      if (p.kind === 'lantern') this.lamps.push(new THREE.Vector3(p.x * SCALE, 2.9, p.y * SCALE));
    }

    for (let i = 0; i < 10; i++) {
      const l = new THREE.PointLight('#ffb05a', 0, 12, 1.6);
      l.castShadow = false;
      this.group.add(l);
      this.lights.push(l);
    }

    this.group.add(this.yard);
    this.syncYard(st, true);
    stage.world.add(this.group);
  }

  dispose(): void {
    for (const s of this.npcs.values()) s.dispose();
    for (const t of this.yardTex) t.dispose();
    for (const t of this.ownedTex) t.dispose();
    this.stage.world.remove(this.group);
    clearGroup(this.group);
    this.groundTex.dispose();
  }

  sync(st: GameState, now: number, cam: Diorama): void {
    this.frame++;
    const lean = cam.spriteLean;
    const f = cam.focus();

    if (!this.leaned) {
      for (const m of this.standees) m.rotation.x = lean;
      this.leaned = true;
    }

    for (const n of this.town.npcs) {
      let s = this.npcs.get(n.id);
      if (!s) {
        const cat = n.kind === 'cat';
        s = new Sprite(cat ? 48 : 60, cat ? 44 : 84, { res: 2.5, footPad: 4 });
        this.npcs.set(n.id, s);
        this.group.add(s.mesh);
      }
      const close = Math.abs(n.x * SCALE - f.x) < 46 && Math.abs(n.y * SCALE - f.z) < 56;
      s.mesh.visible = close;
      if (close && (this.frame + n.id.length) % 2 === 0) {
        s.paint(n.x, n.y, (c) => drawTownNpc(c, n, false));
      }
      s.place(n.x, n.y, 0, lean);
    }

    // light the lanterns nearest the camera; there are too many to light them all
    if (this.frame % 12 === 1) {
      const sorted = [...this.lamps].sort((a, b) =>
        (a.x - f.x) ** 2 + (a.z - f.z) ** 2 - ((b.x - f.x) ** 2 + (b.z - f.z) ** 2));
      this.lights.forEach((l, i) => {
        const p = sorted[i];
        if (!p) { l.intensity = 0; return; }
        l.position.copy(p);
        l.intensity = 9;
      });
    }
    for (const l of this.lights) {
      if (l.intensity > 0) l.intensity = 8.4 + Math.sin(now * 0.006 + l.position.x) * 0.9;
    }

    if (this.water?.map) this.water.map.offset.set((now * 0.00003) % 1, (now * 0.00001) % 1);

    for (const p of this.puffs) {
      const k = ((now * 0.00032 + p.phase) % 1 + 1) % 1;
      p.mesh.position.set(p.base.x + Math.sin(k * 5 + p.phase) * 0.5, p.base.y + k * 3.4, p.base.z);
      p.mesh.scale.setScalar(0.35 + k * 1.1);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.34 * (1 - k);
    }

    this.syncYard(st, false);
  }

  // --------------------------------------------------------------- buildings

  private building(b: Building): THREE.Group {
    if (b.id === 'gate') return this.gate(b);
    const g = new THREE.Group();
    const w = b.w * SCALE, d = b.d * SCALE;
    const cx = (b.x + b.w / 2) * SCALE, cz = (b.y + b.d / 2) * SCALE;
    const wallH = b.storeys > 1 ? 5.2 : 3.4;

    const fm = facadeMaterials(b, wallH, Math.round(b.x * 7 + b.y * 13));
    this.ownedTex.push(...fm.textures);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, wallH, d),
      [fm.side, fm.side, fm.cap, fm.cap, fm.front, fm.back],
    );
    box.position.set(cx, wallH / 2, cz);
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);

    const rise = Math.min(3.6, d * 0.5);
    const roof = gableRoof(w, d, rise, 0.55, roofMaterial(b.roof), fm.gable);
    roof.position.set(cx, wallH, cz);
    g.add(roof);

    const chH = rise + 1.6;
    const chGeo = new THREE.BoxGeometry(0.8, chH, 0.8);
    boxUV(chGeo, 0.8, chH, 0.8, 1.6);
    const chimney = new THREE.Mesh(chGeo, stoneMaterial('#8a8078'));
    const chX = cx + w * 0.27, chZ = cz - d * 0.14;
    chimney.position.set(chX, wallH + chH / 2, chZ);
    chimney.castShadow = true;
    g.add(chimney);

    const smokeMat = () => new THREE.MeshBasicMaterial({
      color: new THREE.Color('#efe7da'), transparent: true, opacity: 0.3, depthWrite: false,
    });
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), smokeMat());
      puff.castShadow = false;
      g.add(puff);
      this.puffs.push({
        mesh: puff,
        base: new THREE.Vector3(chX, wallH + chH + 0.2, chZ),
        phase: i / 3 + (b.x % 7) * 0.1,
      });
    }
    return g;
  }

  private gate(b: Building): THREE.Group {
    const g = new THREE.Group();
    const w = b.w * SCALE;
    // The piers straddle the town wall, which runs 28px inside the gate's south
    // edge. Kept shallow, they leave the guards room to stand in front of them.
    const cx = (b.x + b.w / 2) * SCALE, cz = (b.y + b.d - 28) * SCALE;
    const stone = stoneMaterial();
    const pierW = 2.6, pierH = 7.6, depth = 1.9;
    for (const side of [-1, 1]) {
      const geo = new THREE.BoxGeometry(pierW, pierH, depth);
      boxUV(geo, pierW, pierH, depth, 2.2);
      const pier = new THREE.Mesh(geo, stone);
      pier.position.set(cx + side * (w / 2 + pierW / 2), pierH / 2, cz);
      pier.castShadow = true;
      pier.receiveShadow = true;
      g.add(pier);
      const capGeo = new THREE.BoxGeometry(pierW + 0.4, 0.5, depth + 0.4);
      boxUV(capGeo, pierW + 0.4, 0.5, depth + 0.4, 2.2);
      const cap = new THREE.Mesh(capGeo, stoneMaterial('#b0a598'));
      cap.position.set(cx + side * (w / 2 + pierW / 2), pierH + 0.25, cz);
      cap.castShadow = true;
      g.add(cap);
    }
    const lintelW = w + pierW * 2 + 0.6;
    const lintelGeo = new THREE.BoxGeometry(lintelW, 1.6, depth);
    boxUV(lintelGeo, lintelW, 1.6, depth, 2.2);
    const lintel = new THREE.Mesh(lintelGeo, stone);
    lintel.position.set(cx, pierH - 0.8, cz);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    g.add(lintel);
    for (let i = 0; i < 6; i++) {
      const mx = cx - lintelW / 2 + 0.5 + i * ((lintelW - 1) / 5);
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, depth), stoneMaterial('#b0a598'));
      merlon.position.set(mx, pierH + 0.35, cz);
      merlon.castShadow = true;
      g.add(merlon);
    }
    // the raised portcullis, its teeth just showing
    const iron = new THREE.MeshLambertMaterial({ color: new THREE.Color('#3c3834') });
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), iron);
      bar.position.set(cx - w / 2 + 0.4 + i * ((w - 0.8) / 5), pierH - 2.1, cz + depth / 2 - 0.3);
      g.add(bar);
    }
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 2.6),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#3f5a8a'), side: THREE.DoubleSide }),
    );
    banner.position.set(cx, pierH - 2.4, cz + depth / 2 + 0.03);
    g.add(banner);
    const emblem = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 20),
      new THREE.MeshLambertMaterial({ color: new THREE.Color('#e0b64f'), emissive: new THREE.Color('#3a2a08') }),
    );
    emblem.position.set(cx, pierH - 2.2, cz + depth / 2 + 0.05);
    g.add(emblem);
    return g;
  }

  /** Woods and hedgerows past the edge of town, and the road running south out of it. */
  private outskirts(rich: boolean, mapW: number, mapH: number): THREE.Group {
    const g = new THREE.Group();
    const roadX = this.town.gateX * SCALE;
    g.add(roadStrip(roadX, mapH, 4.8, 70));
    const r = new RNG(this.town.w * 31 + 5);
    for (let i = 0; i < 150; i++) {
      const side = r.int(0, 3);
      const out = 2 + Math.pow(r.next(), 1.6) * 30;
      let x: number, z: number;
      if (side === 0) { x = r.float(-34, mapW + 34); z = mapH + out; }
      else if (side === 1) { x = r.float(-34, mapW + 34); z = -out; }
      else if (side === 2) { x = -out; z = r.float(-10, mapH + 10); }
      else { x = mapW + out; z = r.float(-10, mapH + 10); }
      if (side === 0 && Math.abs(x - roadX) < 5) continue;
      const kind = r.chance(0.3) ? 'bush' : 'tree';
      const v = r.int(0, 2);
      const [w, h, pad, scale] = STANDEE[kind];
      const key = 'town:' + kind + ':' + v + '::' + (rich ? 1 : 0);
      const m = standee(key, w, h, pad, (c, fx, fy) => drawProp(c, { kind, x: fx, y: fy, variant: v }, 0, rich), 2.5);
      m.position.set(x, 0, z);
      m.scale.setScalar(scale * r.float(0.85, 1.2));
      this.standees.push(m);
      g.add(m);
    }
    return g;
  }

  // ------------------------------------------------------------------- props

  private prop(p: Prop, rich: boolean): THREE.Object3D | null {
    const sd = STANDEE[p.kind];
    if (sd) {
      const [w, h, pad, scale] = sd;
      const key = 'town:' + p.kind + ':' + p.variant + ':' + (p.color ?? '') + ':' + (rich ? 1 : 0);
      const m = standee(key, w, h, pad, (c, fx, fy) => drawProp(c, { ...p, x: fx, y: fy }, 0, rich), 2.5);
      m.position.set(p.x * SCALE, 0, p.y * SCALE);
      m.scale.setScalar(scale);
      this.standees.push(m);
      return m;
    }
    const dc = DECAL[p.kind];
    if (dc) {
      const key = 'decal:' + p.kind + ':' + p.variant + ':' + (rich ? 1 : 0);
      const m = decal(key, dc[0], dc[1], (c, x, y) => drawProp(c, { ...p, x, y }, 0, rich), 2.5);
      m.position.set(p.x * SCALE, p.kind === 'lilypad' ? 0.08 : 0.03, p.y * SCALE);
      m.scale.setScalar(1.35);
      return m;
    }

    switch (p.kind) {
      case 'moat': {
        const w = (p.w ?? 0) * SCALE, h = (p.h ?? 0) * SCALE;
        const geo = new THREE.PlaneGeometry(w, h);
        geo.rotateX(-Math.PI / 2);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 3, uv.getY(i) * h / 3);
        uv.needsUpdate = true;
        const mat = waterMaterial();
        this.water = mat;
        const water = new THREE.Mesh(geo, mat);
        water.position.set((p.x + (p.w ?? 0) / 2) * SCALE, 0.04, (p.y + (p.h ?? 0) / 2) * SCALE);
        water.receiveShadow = true;
        return water;
      }
      case 'bridge': {
        const w = (p.w ?? 0) * SCALE, h = (p.h ?? 0) * SCALE;
        const g = new THREE.Group();
        const deckGeo = new THREE.BoxGeometry(w, 0.3, h);
        boxUV(deckGeo, w, 0.3, h, 1.8);
        const deck = new THREE.Mesh(deckGeo, plankMaterial());
        deck.position.set(0, 0.18, 0);
        deck.castShadow = true;
        deck.receiveShadow = true;
        g.add(deck);
        const wood = new THREE.MeshLambertMaterial({ color: new THREE.Color('#6b4a2a') });
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, h), wood);
          rail.position.set(side * (w / 2 - 0.1), 1.05, 0);
          rail.castShadow = true;
          g.add(rail);
          for (let z = -h / 2 + 0.2; z <= h / 2; z += 1.4) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), wood);
            post.position.set(side * (w / 2 - 0.1), 0.6, z);
            post.castShadow = true;
            g.add(post);
          }
        }
        g.position.set((p.x + (p.w ?? 0) / 2) * SCALE, 0, (p.y + (p.h ?? 0) / 2) * SCALE);
        return g;
      }
      case 'fence': {
        if (p.x2 === undefined || p.y2 === undefined) return null;
        const dx = p.x2 - p.x, dy = p.y2 - p.y;
        const len = Math.hypot(dx, dy) * SCALE;
        if (len < 0.01) return null;
        const g = new THREE.Group();
        if (p.variant === 2) {
          const wallGeo = new THREE.BoxGeometry(len + 0.02, 3.4, 1.1);
          boxUV(wallGeo, len, 3.4, 1.1, 2.2);
          const wall = new THREE.Mesh(wallGeo, stoneMaterial());
          wall.position.y = 1.7;
          wall.castShadow = true;
          wall.receiveShadow = true;
          g.add(wall);
          const count = Math.max(1, Math.floor(len / 1.2));
          for (let i = 0; i < count; i++) {
            const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.14), stoneMaterial('#b0a598'));
            merlon.position.set(-len / 2 + 0.6 + i * 1.2, 3.7, 0);
            merlon.castShadow = true;
            g.add(merlon);
          }
        } else {
          const wood = new THREE.MeshLambertMaterial({ color: new THREE.Color('#8a6a44') });
          for (const y of [0.55, 0.95]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), wood);
            rail.position.y = y;
            rail.castShadow = true;
            g.add(rail);
          }
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.16),
            new THREE.MeshLambertMaterial({ color: new THREE.Color('#6b4a2a') }));
          post.position.set(-len / 2, 0.62, 0);
          post.castShadow = true;
          g.add(post);
        }
        g.position.set(((p.x + p.x2) / 2) * SCALE, 0, ((p.y + p.y2) / 2) * SCALE);
        g.rotation.y = -Math.atan2(dy, dx);
        return g;
      }
      case 'laundry': {
        if (p.x2 === undefined || p.y2 === undefined) return null;
        const g = new THREE.Group();
        const cols = ['#e8e0d0', '#a8c4e0', '#e0b6c8', '#d8d2a8'];
        for (let i = 1; i <= 4; i++) {
          const k = i / 5;
          const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.9),
            new THREE.MeshLambertMaterial({ color: new THREE.Color(cols[i % 4]), side: THREE.DoubleSide }));
          cloth.position.set((p.x + (p.x2 - p.x) * k) * SCALE, 2.5, (p.y + (p.y2 - p.y) * k) * SCALE);
          cloth.castShadow = true;
          g.add(cloth);
        }
        return g;
      }
      default:
        // banners and hanging signs belong on walls; they come back in a later pass
        return null;
    }
  }

  /** Garden plots repaint only when something about them actually changed. */
  private syncYard(st: GameState, force: boolean): void {
    const key = st.homestead.plots
      .map((p) => p.id + (p.owned ? 1 : 0) + p.level + p.workers + Math.floor(p.pending ?? 0))
      .join('|');
    if (!force && key === this.lastYardKey) return;
    this.lastYardKey = key;
    clearGroup(this.yard);
    for (const t of this.yardTex) t.dispose();
    this.yardTex = [];
    for (const spot of this.town.yard) {
      const plot = st.homestead.plots.find((p) => p.id === spot.id);
      if (!plot) continue;
      const m = freshDecal(150, 140, (c, cx, cy) => drawPlot(c, cx - 58, cy - 34, plot, 0), 2);
      m.position.set((spot.x + 58) * SCALE, 0.03, (spot.y + 34) * SCALE);
      this.yardTex.push(m.userData.tex as THREE.Texture);
      this.yard.add(m);
    }
  }
}

export function shadeFor(hex: string): string {
  return shade(hex, 0);
}
