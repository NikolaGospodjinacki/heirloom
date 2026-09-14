import * as THREE from 'three';
import { SCALE, Stage, clearGroup } from './core';
import { Sprite, standee } from './sprite';
import { boxUV, plankMaterial, stoneMaterial, tex } from './paint';
import type { Diorama } from './diorama';
import type { Furniture, Hall } from '../game/hall';
import { drawProp, drawTownNpc } from '../game/town';
import { MONSTERS } from '../game/content';
import { RANKS, rankDef } from '../game/ranks';
import type { GameState } from '../game/state';
import { RNG } from '../game/rng';

/**
 * The inside of the guild, as a cutaway doll's house: the back wall tall and
 * full of things to read, the side walls low, the front wall hardly there, so
 * the camera looks straight in. Lit by the fire and two lamps, with the
 * trophies and names of your family on the walls.
 */
export class HallView {
  group = new THREE.Group();
  private npcs = new Map<string, Sprite>();
  private standees: THREE.Mesh[] = [];
  private fire: THREE.PointLight;
  private flames: THREE.Mesh;
  private owned: { dispose: () => void }[] = [];
  private motes: THREE.Points;
  private stage: Stage;
  private hall: Hall;
  private frame = 0;
  private leaned = false;

  constructor(stage: Stage, hall: Hall, st: GameState) {
    this.stage = stage;
    this.hall = hall;
    const W = hall.w * 48 * SCALE, H = hall.h * 48 * SCALE;

    stage.scene.background = new THREE.Color('#15100c');
    stage.scene.fog = null;
    stage.hemi.color = new THREE.Color('#ffd9a8');
    stage.hemi.groundColor = new THREE.Color('#3a2a1c');
    stage.hemi.intensity = 1.35;
    stage.sun.color = new THREE.Color('#ffe2b8');
    stage.sun.intensity = 1.1;

    // ---------------------------------------------------------------- floor
    const floorTex = floorTexture(hall.w, hall.h);
    this.owned.push(floorTex);
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
    this.owned.push(floorMat);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---------------------------------------------------------------- walls
    const backTex = wallTexture(W, 6);
    this.owned.push(backTex);
    const plaster = new THREE.MeshLambertMaterial({ map: backTex });
    this.owned.push(plaster);
    const wood = plankMaterial();
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, 6, 1), [wood, wood, wood, wood, plaster, wood]);
    back.position.set(W / 2, 3, 6.9);
    back.receiveShadow = true;
    back.castShadow = true;
    this.group.add(back);
    for (const side of [0, 1]) {
      const geo = new THREE.BoxGeometry(1.2, 2.4, H - 6.4);
      boxUV(geo, 1.2, 2.4, H - 6.4, 2);
      const wall = new THREE.Mesh(geo, wood);
      wall.position.set(side ? W - 0.6 : 0.6, 1.2, 6.4 + (H - 6.4) / 2);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.group.add(wall);
    }
    for (const side of [-1, 1]) {
      const len = W / 2 - 3.2;
      const geo = new THREE.BoxGeometry(len, 0.7, 0.8);
      boxUV(geo, len, 0.7, 0.8, 2);
      const low = new THREE.Mesh(geo, wood);
      low.position.set(W / 2 + side * (3.2 + len / 2), 0.35, H - 0.4);
      this.group.add(low);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.6, 0.6), wood);
      post.position.set(W / 2 + side * 3.1, 1.8, H - 0.4);
      post.castShadow = true;
      this.group.add(post);
    }

    // ----------------------------------------------------------- furniture
    for (const f of hall.furniture) this.furnish(f, st, W, H);

    // --------------------------------------------------------------- light
    this.fire = new THREE.PointLight('#ff9a4a', 26, 16, 1.5);
    const fp = hall.furniture.find((f) => f.kind === 'fireplace');
    const fx = (fp?.x ?? hall.w * 48 - 150) * SCALE, fz = (fp?.y ?? 150) * SCALE;
    this.fire.position.set(fx, 1.4, fz + 1.4);
    this.group.add(this.fire);
    this.flames = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 1.1, 0.35), transparent: true, opacity: 0.9,
    }));
    this.flames.position.set(fx, 0.9, fz + 1.12);
    this.group.add(this.flames);
    for (const [lx, lz] of [[W * 0.3, H * 0.52], [W * 0.7, H * 0.52]] as [number, number][]) {
      const lamp = new THREE.PointLight('#ffc27a', 22, 22, 1.3);
      lamp.position.set(lx, 4.2, lz);
      this.group.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.5, 0.8) }));
      bulb.position.set(lx, 4.2, lz);
      this.group.add(bulb);
    }
    const windowLight = new THREE.PointLight('#bcd4ff', 7, 12, 1.6);
    windowLight.position.set(2.2, 2.6, 300 * SCALE);
    this.group.add(windowLight);

    const pos = new Float32Array(hall.motes.length * 3);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({
      size: 0.12, color: new THREE.Color('#ffe8b0'), transparent: true, opacity: 0.6, depthWrite: false,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    stage.world.add(this.group);
  }

  private furnish(f: Furniture, st: GameState, _W: number, _H: number): void {
    const x = f.x * SCALE, z = f.y * SCALE, w = f.w * SCALE, d = f.d * SCALE, h = f.h ?? 1;
    const wood = plankMaterial();
    const box = (bw: number, bh: number, bd: number, m: THREE.Material, px: number, py: number, pz: number) => {
      const geo = new THREE.BoxGeometry(bw, bh, bd);
      boxUV(geo, bw, bh, bd, 1.6);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    switch (f.kind) {
      case 'counter':
        box(w, h, d, wood, x, h / 2, z);
        box(w + 0.3, 0.14, d + 0.3, new THREE.MeshLambertMaterial({ color: new THREE.Color('#8a6440') }), x, h + 0.07, z);
        break;
      case 'table': {
        box(w, 0.14, d, wood, x, h, z);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.16, h, 0.16, wood, x + sx * (w / 2 - 0.2), h / 2, z + sz * (d / 2 - 0.2));
        const mug = new THREE.MeshLambertMaterial({ color: new THREE.Color('#c9b48a') });
        box(0.22, 0.3, 0.22, mug, x - 0.5, h + 0.2, z - 0.2);
        box(0.22, 0.3, 0.22, mug, x + 0.4, h + 0.2, z + 0.25);
        break;
      }
      case 'bench':
        box(w, h, d, new THREE.MeshLambertMaterial({ color: new THREE.Color(f.color ?? '#5a3e24') }), x, h / 2, z);
        break;
      case 'pillar':
        box(w, h, d, wood, x, h / 2, z);
        break;
      case 'shelf': {
        box(w, h, d, wood, x, h / 2, z);
        const r = new RNG(3);
        for (let row = 0; row < 3; row++) {
          for (let i = 0; i < 10; i++) {
            const col = ['#8a3f47', '#4f6b7a', '#6a9a52', '#a8894f', '#6a4a7d'][r.int(0, 4)];
            box(0.18, 0.5, 0.2, new THREE.MeshLambertMaterial({ color: new THREE.Color(col) }),
              x - w / 2 + 0.4 + i * (w - 0.8) / 9, 0.6 + row * 1.05, z + d / 2 + 0.02);
          }
        }
        break;
      }
      case 'fireplace': {
        const stone = stoneMaterial('#8f857a');
        box(w, h, d, stone, x, h / 2, z);
        box(w * 0.55, h * 0.45, 0.2, new THREE.MeshBasicMaterial({ color: new THREE.Color('#140c08') }), x, h * 0.26, z + d / 2 + 0.02);
        box(w + 0.4, 0.25, d + 0.4, stoneMaterial('#a39b8f'), x, h * 0.62, z);
        break;
      }
      case 'board':
      case 'registry':
      case 'memorial':
      case 'trophies': {
        const onSide = f.kind === 'memorial' || f.kind === 'trophies';
        const cw = onSide ? f.d : f.w, chh = Math.round(h / SCALE);
        const canvas = boardTexture(f.kind, st, cw, chh);
        this.owned.push(canvas);
        const m = new THREE.MeshLambertMaterial({ map: canvas });
        this.owned.push(m);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry((onSide ? d : w), h), m);
        if (f.kind === 'memorial') { plane.rotation.y = Math.PI / 2; plane.position.set(x + 0.62, 1.9, z); }
        else if (f.kind === 'trophies') { plane.rotation.y = -Math.PI / 2; plane.position.set(x - 0.62, 1.9, z); }
        else plane.position.set(x, 2.6, 6.38);
        plane.receiveShadow = true;
        this.group.add(plane);
        break;
      }
      case 'rug': {
        const rugTex = rugTexture(f.color ?? '#7a3f3a');
        this.owned.push(rugTex);
        const m = new THREE.MeshLambertMaterial({ map: rugTex });
        this.owned.push(m);
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(x, 0.02, z);
        rug.receiveShadow = true;
        this.group.add(rug);
        break;
      }
      case 'window': {
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(d, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.4, 1.6) }));
        const west = f.x < 200;
        glow.rotation.y = west ? Math.PI / 2 : -Math.PI / 2;
        glow.position.set(west ? 1.22 : x - 0.62 + 0.0, 1.7, z);
        if (!west) glow.position.x = (this.hall.w * 48 - 40) * SCALE - 0.02;
        this.group.add(glow);
        const shaft = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.8), new THREE.MeshBasicMaterial({
          color: new THREE.Color('#fff2d0'), transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide,
        }));
        shaft.rotation.x = -Math.PI / 2;
        shaft.position.set(west ? 3.2 : (this.hall.w * 48 - 40) * SCALE - 2, 0.03, z);
        this.group.add(shaft);
        break;
      }
      case 'banner': {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.6), new THREE.MeshLambertMaterial({ color: new THREE.Color(f.color ?? '#8c4a3f') }));
        b.position.set(x, 3.4, 6.37);
        this.group.add(b);
        const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshLambertMaterial({
          color: new THREE.Color('#e0b64f'), emissive: new THREE.Color('#3a2a08'),
        }));
        emblem.position.set(x, 3.6, 6.36);
        this.group.add(emblem);
        break;
      }
      case 'barrel':
      case 'crate':
      case 'plant': {
        const kind = f.kind === 'plant' ? 'pot' : f.kind;
        const m = standee('hall:' + kind + ':' + (f.variant ?? 0), 34, 38, 4,
          (c, fx, fy) => drawProp(c, { kind, x: fx, y: fy, variant: f.variant ?? 0 }, 0, true), 2.5);
        m.position.set(x, 0, z);
        m.scale.setScalar(1.35);
        this.standees.push(m);
        this.group.add(m);
        break;
      }
    }
  }

  dispose(): void {
    for (const s of this.npcs.values()) s.dispose();
    for (const o of this.owned) o.dispose();
    this.stage.world.remove(this.group);
    clearGroup(this.group);
  }

  sync(now: number, cam: Diorama): void {
    this.frame++;
    const lean = cam.spriteLean;
    if (!this.leaned) {
      for (const m of this.standees) m.rotation.x = lean;
      this.leaned = true;
    }
    for (const n of this.hall.npcs) {
      let s = this.npcs.get(n.id);
      if (!s) {
        s = new Sprite(64, 88, { res: 2.5, footPad: 4 });
        this.npcs.set(n.id, s);
        this.group.add(s.mesh);
      }
      if ((this.frame + n.id.length) % 2 === 0) s.paint(n.x, n.y, (c) => drawTownNpc(c, n, false));
      s.place(n.x, n.y, 0, lean);
    }
    this.fire.intensity = 24 + Math.sin(now * 0.011) * 3 + Math.sin(now * 0.027) * 2;
    this.flames.scale.set(1 + Math.sin(now * 0.02) * 0.05, 1 + Math.sin(now * 0.017) * 0.12, 1);
    const arr = this.motes.geometry.attributes.position.array as Float32Array;
    this.hall.motes.forEach((m, i) => {
      const k = Math.sin((m.t / m.life) * Math.PI);
      arr[i * 3] = m.x * SCALE;
      arr[i * 3 + 1] = k > 0 ? 0.6 + (m.t / m.life) * 3.2 : -99;
      arr[i * 3 + 2] = m.y * SCALE;
    });
    this.motes.geometry.attributes.position.needsUpdate = true;
  }
}

// ----------------------------------------------------------------- textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

function floorTexture(wT: number, hT: number): THREE.CanvasTexture {
  const [cv, c] = canvas(wT * 64, hT * 64);
  const r = new RNG(12);
  const rowH = 14;
  for (let y = 0; y < cv.height; y += rowH) {
    let x = -r.float(0, 60);
    while (x < cv.width) {
      const len = r.float(90, 240);
      const v = r.int(-14, 12);
      c.fillStyle = 'rgb(' + (122 + v) + ',' + (86 + v) + ',' + (56 + v) + ')';
      c.fillRect(x, y, len, rowH);
      c.fillStyle = 'rgba(30,18,10,0.55)';
      c.fillRect(x + len - 1, y, 1.5, rowH);
      c.fillStyle = 'rgba(255,230,190,0.07)';
      c.fillRect(x, y + 1, len, 2);
      x += len;
    }
    c.fillStyle = 'rgba(30,18,10,0.5)';
    c.fillRect(0, y + rowH - 1, cv.width, 1.2);
  }
  return tex(cv);
}

function wallTexture(wU: number, hU: number): THREE.CanvasTexture {
  const [cv, c] = canvas(wU * 40, hU * 40);
  const W = cv.width, H = cv.height;
  c.fillStyle = '#d9c9a8';
  c.fillRect(0, 0, W, H);
  const r = new RNG(8);
  for (let i = 0; i < 400; i++) {
    c.fillStyle = r.chance(0.5) ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)';
    c.fillRect(r.float(0, W), r.float(0, H), r.float(4, 18), r.float(2, 6));
  }
  // wainscot
  c.fillStyle = '#6b4a2a';
  c.fillRect(0, H * 0.62, W, H * 0.38);
  for (let x = 0; x < W; x += 36) {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x, H * 0.62, 2, H * 0.38);
  }
  c.fillStyle = '#4a3220';
  c.fillRect(0, H * 0.6, W, 8);
  // timber frame
  c.fillStyle = '#4a3220';
  for (let x = 0; x < W; x += 130) c.fillRect(x, 0, 12, H * 0.6);
  c.fillRect(0, 0, W, 10);
  return tex(cv);
}

function rugTexture(color: string): THREE.CanvasTexture {
  const [cv, c] = canvas(256, 140);
  c.fillStyle = color;
  c.fillRect(0, 0, 256, 140);
  c.strokeStyle = '#e0b64f';
  c.lineWidth = 4;
  c.strokeRect(10, 10, 236, 120);
  c.lineWidth = 2;
  c.strokeRect(20, 20, 216, 100);
  c.fillStyle = 'rgba(224,182,79,0.6)';
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.moveTo(128, 40 + i * 0); c.lineTo(158, 70); c.lineTo(128, 100); c.lineTo(98, 70);
    c.closePath();
  }
  c.fill();
  return tex(cv);
}

/** The things on the walls, painted fresh from the save: postings, plates, trophies, names. */
function boardTexture(kind: string, st: GameState, wPx: number, hPx: number): THREE.CanvasTexture {
  const S = 2;
  const [cv, c] = canvas(wPx * S, hPx * S);
  c.scale(S, S);
  c.fillStyle = '#5a3e24';
  c.fillRect(0, 0, wPx, hPx);
  c.fillStyle = '#6b4a2a';
  c.fillRect(4, 4, wPx - 8, hPx - 8);
  c.textAlign = 'center';
  const r = new RNG(st.village.era * 11 + st.board.length);
  if (kind === 'board') {
    c.fillStyle = '#efe3c4';
    c.font = '700 11px Georgia, serif';
    c.fillText('CONTRACTS', wPx / 2, 16);
    const n = Math.max(3, st.board.length + 2);
    for (let i = 0; i < n; i++) {
      const px = 14 + (i % 4) * ((wPx - 28) / 4) + r.float(-3, 3), py = 26 + Math.floor(i / 4) * 44 + r.float(-2, 4);
      c.save();
      c.translate(px + 16, py + 18);
      c.rotate(r.float(-0.12, 0.12));
      c.fillStyle = r.chance(0.2) ? '#e8d8b0' : '#f0e6cc';
      c.fillRect(-16, -18, 32, 36);
      c.fillStyle = 'rgba(60,40,20,0.5)';
      for (let l = 0; l < 4; l++) c.fillRect(-11, -10 + l * 7, 22 - r.int(0, 8), 2);
      c.fillStyle = '#a33c3c';
      c.beginPath(); c.arc(0, -15, 2.4, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  } else if (kind === 'registry') {
    c.fillStyle = '#efe3c4';
    c.font = '700 11px Georgia, serif';
    c.fillText('REGISTRY OF PLATES', wPx / 2, 16);
    RANKS.forEach((R, i) => {
      const px = 12 + i * ((wPx - 24) / 7) + 2, py = 30;
      const pw = (wPx - 24) / 7 - 4;
      c.fillStyle = R.color;
      c.fillRect(px, py, pw, 44);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(px, py + 40, pw, 4);
      c.fillStyle = '#1a1410';
      c.font = '700 16px Georgia, serif';
      c.fillText(R.letter, px + pw / 2, py + 29);
      if (i === st.rank) {
        c.strokeStyle = '#fff2c0';
        c.lineWidth = 2;
        c.strokeRect(px - 2, py - 2, pw + 4, 48);
      }
    });
    c.fillStyle = '#efe3c4';
    c.font = '600 9px Georgia, serif';
    c.fillText('You wear the ' + rankDef(st.rank).plate, wPx / 2, 96);
  } else if (kind === 'trophies') {
    c.fillStyle = '#efe3c4';
    c.font = '700 11px Georgia, serif';
    c.fillText('TROPHIES', wPx / 2, 16);
    const ids = Object.keys(st.trophies ?? {});
    if (!ids.length) {
      c.font = 'italic 10px Georgia, serif';
      c.fillText('Nothing yet.', wPx / 2, hPx / 2);
    }
    ids.slice(0, 8).forEach((id, i) => {
      const md = MONSTERS[id];
      if (!md) return;
      const px = 22 + (i % 4) * ((wPx - 30) / 4), py = 34 + Math.floor(i / 4) * 52;
      c.fillStyle = '#4a3220';
      c.beginPath(); c.moveTo(px - 14, py - 10); c.lineTo(px + 14, py - 10); c.lineTo(px + 14, py + 8); c.lineTo(px, py + 20); c.lineTo(px - 14, py + 8); c.closePath(); c.fill();
      c.fillStyle = md.color;
      c.beginPath(); c.ellipse(px, py + 2, 10, 8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = md.accent;
      c.fillRect(px - 5, py - 1, 3, 3); c.fillRect(px + 2, py - 1, 3, 3);
      c.fillStyle = '#efe3c4';
      c.font = '600 7px Georgia, serif';
      c.fillText(md.name.replace('The ', ''), px, py + 30);
    });
  } else {
    c.fillStyle = '#efe3c4';
    c.font = '700 11px Georgia, serif';
    c.fillText('THE WALL OF NAMES', wPx / 2, 16);
    c.font = '600 8px Georgia, serif';
    const names = st.epitaphs.slice(0, 10);
    if (!names.length) {
      c.font = 'italic 10px Georgia, serif';
      c.fillText('No ' + st.hero.name.split(' ').pop() + ' is on it. Yet.', wPx / 2, hPx / 2);
    }
    names.forEach((e, i) => {
      c.fillStyle = '#efe3c4';
      c.fillText(e.name + ' · ' + (e.rank !== undefined ? rankDef(e.rank).letter : 'F'), wPx / 2, 34 + i * 12);
    });
  }
  return tex(cv);
}
