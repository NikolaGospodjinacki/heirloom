import * as THREE from 'three';
import { roundRect } from '../render/draw';
import type { ZoneDef } from '../game/content';
import type { Building, Town } from '../game/town';
import { RNG } from '../game/rng';
import { shade } from './kit';

/** Texture density for painted walls, in pixels per world unit. */
export const PX_PER_UNIT = 40;

function cvs(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

export function tex(cv: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

function keep(o: object): void {
  (o as { keep?: boolean }).keep = true;
}

/** Scale a box's UVs face by face so a repeating texture keeps one size everywhere. */
export function boxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, unit: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z, four vertices each
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / unit, uv.getY(i) * dims[f][1] / unit);
    }
  }
  uv.needsUpdate = true;
}

/** Soft pools of warm light scattered over the ground, so it is never one flat colour. */
function dapple(c: CanvasRenderingContext2D, W: number, H: number, n: number, r: RNG): void {
  for (let i = 0; i < n; i++) {
    const x = r.float(0, W), y = r.float(0, H), rad = r.float(60, 240);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,238,186,0.11)');
    g.addColorStop(1, 'rgba(255,238,186,0)');
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

// ------------------------------------------------------------------- ground

type Rect = { x: number; y: number; w: number; h: number };

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/** A soft round stain of colour that fades to nothing at its edge. */
function soft(c: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string, alpha: number): void {
  const g = c.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

/**
 * Open ground without the tile grid. The 2D map's light and dark tiles become
 * soft overlapping stains, so the field keeps its pattern and loses its squares.
 */
function paintField(
  c: CanvasRenderingContext2D, wT: number, hT: number, tiles: Uint8Array,
  c1: string, c2: string, tint: number, r: RNG,
): void {
  const W = wT * 48, H = hT * 48;
  c.fillStyle = shade(c1, tint);
  c.fillRect(0, 0, W, H);
  const light = shade(c2, tint);
  for (let ty = 0; ty < hT; ty++) {
    for (let tx = 0; tx < wT; tx++) {
      if (!tiles[ty * wT + tx]) continue;
      soft(c, tx * 48 + 24 + r.float(-16, 16), ty * 48 + 24 + r.float(-16, 16), r.float(36, 62), light, 0.5);
    }
  }
  // hollows and sunlit swells, much bigger than a tile
  for (let i = 0; i < (W * H) / 26000; i++) {
    const dark = r.chance(0.55);
    soft(c, r.float(0, W), r.float(0, H), r.float(60, 170),
      shade(c1, tint + (dark ? -26 : 22)), dark ? 0.26 : 0.18);
  }
}

/** The average colour around the rim of a painting, for the ground that carries on past it. */
function edgeColor(cv: HTMLCanvasElement): string {
  const c = cv.getContext('2d')!;
  const b = 6;
  let rr = 0, gg = 0, bb = 0, n = 0;
  const add = (x: number, y: number, w: number, h: number): void => {
    const d = c.getImageData(x, y, w, h).data;
    for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
  };
  add(0, 0, cv.width, b);
  add(0, cv.height - b, cv.width, b);
  add(0, 0, b, cv.height);
  add(cv.width - b, 0, b, cv.height);
  const hx = (v: number): string => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0');
  return '#' + hx(rr) + hx(gg) + hx(bb);
}

/** Shadow gathering at the foot of each wall of a ledge, fading out across the ground below. */
function footShadow(c: CanvasRenderingContext2D, p: Rect, d: number): void {
  const strip = (x: number, y: number, w: number, h: number, x0: number, y0: number, x1: number, y1: number): void => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(26,16,10,0.42)');
    g.addColorStop(0.35, 'rgba(26,16,10,0.2)');
    g.addColorStop(1, 'rgba(26,16,10,0)');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
  };
  const bottom = p.y + p.h, right = p.x + p.w;
  strip(p.x - d * 0.4, bottom, p.w + d * 0.8, d, 0, bottom, 0, bottom + d);
  strip(p.x - d, p.y, d, p.h, p.x, 0, p.x - d, 0);
  strip(right, p.y, d, p.h, right, 0, right + d, 0);
  strip(p.x, p.y - d, p.w, d, 0, p.y, 0, p.y - d);
}

function tracePath(c: CanvasRenderingContext2D, pts: [number, number][]): void {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
}

function paintRoad(
  c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number,
  w: number, r: RNG, cobbles = true,
): void {
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(150,126,92,0.92)';
  c.lineWidth = w + 10;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.strokeStyle = 'rgba(128,104,74,0.8)';
  c.lineWidth = w - 10;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  // cobbles in town, loose stones on a country track
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.floor(len / (cobbles ? 9 : 16));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const px = x1 + (x2 - x1) * k + r.float(-w * 0.4, w * 0.4);
    const py = y1 + (y2 - y1) * k + r.float(-w * 0.4, w * 0.4);
    c.fillStyle = r.chance(0.5) ? 'rgba(170,146,110,0.55)' : 'rgba(104,84,60,0.35)';
    if (cobbles) {
      roundRect(c, px, py, r.float(6, 11), r.float(5, 8), 2.5);
    } else {
      c.beginPath();
      c.ellipse(px, py, r.float(2, 4), r.float(1.5, 3), 0, 0, Math.PI * 2);
    }
    c.fill();
  }
}

export interface GroundPaint {
  map: THREE.CanvasTexture;
  /** glowing cracks for the emissive channel, where a zone has them */
  glow: THREE.CanvasTexture | null;
  /** the colour the ground carries on in past the edge of the map */
  edge: string;
}

export function paintZoneGround(
  def: ZoneDef, tiles: Uint8Array, chasms: Rect[], plateaus: (Rect & { z: number })[],
  exit: { x: number; y: number },
): GroundPaint {
  const S = 0.5;
  const W = def.w * 48, H = def.h * 48;
  const [cv, c] = cvs(W * S, H * S);
  c.scale(S, S);
  const r = new RNG(def.w * 131 + def.h * 17);
  const ember = def.ambience === 'embers';
  // a touch brighter than the 2D map: the diorama is lit, not flat, and reads darker
  paintField(c, def.w, def.h, tiles, def.ground, def.ground2, 14, r);
  const edge = edgeColor(cv);
  dapple(c, W, H, Math.round((W * H) / 70000), r);
  for (let i = 0; i < (W * H) / 50000; i++) {
    const x = r.float(0, W), y = r.float(0, H), rx = r.float(30, 100);
    c.fillStyle = 'rgba(92,72,50,0.10)';
    c.beginPath();
    c.ellipse(x, y, rx, rx * r.float(0.45, 0.8), r.float(0, 3), 0, Math.PI * 2);
    c.fill();
  }
  // the track you came in on, from the way out to the edge of the map
  paintRoad(c, exit.x, exit.y, exit.x, H + 40, 60, r, false);

  // Higher ground is a shade lighter (on the ridge, ashier with every step up),
  // and shadow gathers at the foot of every wall without spilling onto higher ground.
  const sorted = [...plateaus].sort((a, b) => a.z - b.z);
  for (const p of sorted) {
    c.fillStyle = ember ? 'rgba(206,190,180,0.07)' : 'rgba(255,246,210,0.05)';
    c.fillRect(p.x, p.y, p.w, p.h);
  }
  for (const p of sorted) {
    c.save();
    c.beginPath();
    c.rect(-100, -100, W + 200, H + 200);
    for (const q of sorted) if (q.z > p.z) c.rect(q.x, q.y, q.w, q.h);
    c.clip('evenodd');
    footShadow(c, p, 36);
    c.restore();
    // the lip catches the light
    c.fillStyle = 'rgba(255,250,225,0.16)';
    c.fillRect(p.x, p.y + p.h - 6, p.w, 6);
    c.fillRect(p.x, p.y, 4, p.h);
    c.fillRect(p.x + p.w - 4, p.y, 4, p.h);
  }

  // crumbly rims, so holes read as edges rather than missing polygons
  for (const ch of chasms) {
    c.fillStyle = ember ? 'rgba(40,20,12,0.6)' : 'rgba(46,32,22,0.5)';
    roundRect(c, ch.x - 16, ch.y - 16, ch.w + 32, ch.h + 32, 24);
    c.fill();
  }

  let glow: THREE.CanvasTexture | null = null;
  if (ember) {
    // Cinder Ridge smoulders: dark scars in the rock with a hot seam in each,
    // painted once for colour and again for the glow the bloom picks up.
    const [gcv, g] = cvs(W * S, H * S);
    g.scale(S, S);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    for (const ctx of [c, g]) { ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }
    const count = Math.round((W * H) / 90000);
    for (let i = 0; i < count; i++) {
      let x = r.float(0, W), y = r.float(0, H), ang = r.float(0, Math.PI * 2);
      const pts: [number, number][] = [[x, y]];
      const steps = r.int(5, 14);
      for (let k = 0; k < steps; k++) {
        ang += r.float(-0.9, 0.9);
        const len = r.float(10, 26);
        x += Math.cos(ang) * len;
        y += Math.sin(ang) * len;
        pts.push([x, y]);
      }
      tracePath(c, pts); c.strokeStyle = 'rgba(30,16,10,0.7)'; c.lineWidth = 7; c.stroke();
      tracePath(c, pts); c.strokeStyle = '#d8602a'; c.lineWidth = 2.2; c.stroke();
      tracePath(g, pts); g.strokeStyle = 'rgba(255,110,40,0.4)'; g.lineWidth = 6; g.stroke();
      tracePath(g, pts); g.strokeStyle = '#ffb060'; g.lineWidth = 2.2; g.stroke();
    }
    glow = tex(gcv);
  }
  return { map: tex(cv), glow, edge };
}

/** The whole town floor: grass, roads, the paved square, the banks of the moat, and the road out. */
export function paintTownGround(t: Town, rich: boolean): GroundPaint {
  const S = 0.75;
  const W = t.w * 48, H = t.h * 48;
  const [cv, c] = cvs(W * S, H * S);
  c.scale(S, S);
  const r = new RNG(t.w * 977 + 3);
  paintField(c, t.w, t.h, t.tiles, rich ? '#6f9250' : '#6b7a4c', rich ? '#7d9d58' : '#77855a', rich ? 10 : -18, r);
  const edge = edgeColor(cv);
  dapple(c, W, H, 30, r);

  for (const rd of t.roads) paintRoad(c, rd.x1, rd.y1, rd.x2, rd.y2, rd.w, r);
  // the road carries on south past the bridge and out of town
  const moat = t.props.find((p) => p.kind === 'moat');
  if (moat) paintRoad(c, t.gateX, moat.y + (moat.h ?? 0) + 20, t.gateX, H + 40, 78, r);

  const cx = W / 2, cy = H / 2;
  c.fillStyle = 'rgba(156,134,100,0.96)';
  c.beginPath(); c.ellipse(cx, cy, 256, 196, 0, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < 1400; i++) {
    const a = r.float(0, Math.PI * 2), d = Math.sqrt(r.next());
    const px = cx + Math.cos(a) * 250 * d, py = cy + Math.sin(a) * 190 * d;
    c.fillStyle = r.chance(0.5) ? 'rgba(186,162,124,0.55)' : 'rgba(110,90,66,0.3)';
    roundRect(c, px - 5, py - 4, r.float(8, 13), r.float(6, 9), 3);
    c.fill();
  }
  c.strokeStyle = 'rgba(92,76,56,0.22)';
  c.lineWidth = 3;
  for (const rr of [110, 170, 230]) {
    c.beginPath(); c.ellipse(cx, cy, rr, rr * 0.76, 0, 0, Math.PI * 2); c.stroke();
  }

  for (const p of t.props) {
    if (p.kind === 'moat' && p.w && p.h) {
      c.fillStyle = '#5f5039';
      c.fillRect(p.x, p.y - 16, p.w, p.h + 32);
      c.fillStyle = 'rgba(90,120,60,0.5)';
      c.fillRect(p.x, p.y - 20, p.w, 5);
      c.fillRect(p.x, p.y + p.h + 15, p.w, 5);
    }
  }
  return { map: tex(cv), glow: null, edge };
}

// ---------------------------------------------------------------- materials

const cached = new Map<string, THREE.MeshLambertMaterial>();

function cachedMat(key: string, make: () => THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  let m = cached.get(key);
  if (!m) {
    m = make();
    keep(m);
    cached.set(key, m);
  }
  return m;
}

export function roofMaterial(color: string): THREE.MeshLambertMaterial {
  return cachedMat('roof' + color, () => {
    const S = 128, rows = 6, tile = S / rows;
    const [cv, c] = cvs(S, S);
    c.fillStyle = shade(color, -44);
    c.fillRect(0, 0, S, S);
    const r = new RNG(parseInt(color.slice(1), 16) || 7);
    for (let row = 0; row < rows; row++) {
      const y = row * tile;
      const off = row % 2 ? tile / 2 : 0;
      for (let col = -1; col <= rows; col++) {
        const x = col * tile + off;
        c.fillStyle = shade(color, r.int(-14, 10));
        roundRect(c, x + 1, y + 1, tile - 2, tile - 1, 5);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.fillRect(x + 1, y + tile - 4, tile - 2, 3);
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(x + 4, y + 3, tile - 8, 2);
      }
    }
    return new THREE.MeshLambertMaterial({ map: tex(cv, true) });
  });
}

export function stoneMaterial(tint = '#9d9284'): THREE.MeshLambertMaterial {
  return cachedMat('stone' + tint, () => {
    const S = 128;
    const [cv, c] = cvs(S, S);
    c.fillStyle = shade(tint, -38);
    c.fillRect(0, 0, S, S);
    const r = new RNG(99);
    const rowH = S / 5;
    for (let row = 0; row < 5; row++) {
      const off = row % 2 ? 16 : 0;
      for (let x = -32 + off; x < S; x += 32) {
        c.fillStyle = shade(tint, r.int(-16, 12));
        roundRect(c, x + 2, row * rowH + 2, 28, rowH - 4, 3);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(x + 4, row * rowH + 3, 22, 2);
      }
    }
    return new THREE.MeshLambertMaterial({ map: tex(cv, true) });
  });
}

export function plankMaterial(): THREE.MeshLambertMaterial {
  return cachedMat('plank', () => {
    const S = 128;
    const [cv, c] = cvs(S, S);
    const r = new RNG(5);
    const plankH = S / 8;
    for (let i = 0; i < 8; i++) {
      c.fillStyle = shade('#8a6440', r.int(-16, 12));
      c.fillRect(0, i * plankH, S, plankH);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(0, i * plankH + plankH - 2, S, 2);
      c.fillStyle = 'rgba(40,24,12,0.6)';
      c.fillRect(r.int(8, S - 8), i * plankH + plankH / 2 - 1, 3, 3);
    }
    return new THREE.MeshLambertMaterial({ map: tex(cv, true) });
  });
}

/**
 * The wall of a ledge, painted to stretch once over its whole height: turf
 * curling over the lip, layered stone, and shadow gathering at the foot. It
 * repeats along the wall and never up it.
 */
export function cliffFaceMaterial(def: ZoneDef): THREE.MeshLambertMaterial {
  return cachedMat('cliffface:' + def.id, () => {
    const CW = 256, CH = 96;
    const [cv, c] = cvs(CW, CH);
    const ember = def.ambience === 'embers';
    const gloom = def.ambience === 'fireflies';
    const rock = ember ? '#5e4238' : gloom ? '#5d5866' : def.terrain === 'broken' ? '#6f6a57' : '#8a7156';
    const turf = ember ? '#7e6a60' : shade(def.ground2, 6);
    const r = new RNG(def.w * 7 + def.h * 3 + 1);
    const across = (fn: (ox: number) => void): void => { fn(-CW); fn(0); fn(CW); };

    c.fillStyle = rock;
    c.fillRect(0, 0, CW, CH);
    // bedding planes
    for (let y = 14; y < CH; y += r.int(8, 13)) {
      c.fillStyle = shade(rock, r.int(-14, 10));
      c.fillRect(0, y, CW, r.int(3, 6));
    }
    // stones, each with a lit top and a dark underside
    for (let i = 0; i < 54; i++) {
      const x = r.float(0, CW), y = r.float(16, CH - 10), w = r.float(12, 32), h = r.float(7, 15);
      const tone = shade(rock, r.int(-16, 16));
      across((ox) => {
        c.fillStyle = 'rgba(0,0,0,0.24)';
        roundRect(c, x + ox, y + 2, w, h, 4); c.fill();
        c.fillStyle = tone;
        roundRect(c, x + ox, y, w, h, 4); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.13)';
        c.fillRect(x + ox + 3, y + 1, Math.max(1, w - 6), 2);
      });
    }
    // a few deep cracks running down the face
    c.strokeStyle = 'rgba(20,12,8,0.35)';
    c.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const pts: [number, number][] = [];
      let x = r.float(0, CW);
      for (let y = 12; y < CH; y += r.float(8, 16)) { pts.push([x, y]); x += r.float(-5, 5); }
      if (pts.length < 2) continue;
      across((ox) => {
        tracePath(c, pts.map(([px, py]) => [px + ox, py] as [number, number]));
        c.stroke();
      });
    }
    // shadow pooling at the foot
    const foot = c.createLinearGradient(0, CH * 0.45, 0, CH);
    foot.addColorStop(0, 'rgba(18,10,6,0)');
    foot.addColorStop(1, 'rgba(18,10,6,0.5)');
    c.fillStyle = foot;
    c.fillRect(0, 0, CW, CH);
    // turf over the lip: a shaded underside, then the grass itself, hanging in tufts
    const tufts: [number, number, number][] = [];
    for (let x = 0; x < CW; x += r.float(5, 11)) tufts.push([x, r.float(3, 11), r.float(3, 6)]);
    c.fillStyle = shade(turf, -30);
    c.fillRect(0, 0, CW, 14);
    for (const [x, len, w] of tufts) {
      across((ox) => { c.beginPath(); c.ellipse(x + ox, 13, w, len + 2, 0, 0, Math.PI); c.fill(); });
    }
    c.fillStyle = turf;
    c.fillRect(0, 0, CW, 11);
    for (const [x, len, w] of tufts) {
      across((ox) => { c.beginPath(); c.ellipse(x + ox, 10, w * 0.8, len, 0, 0, Math.PI); c.fill(); });
    }
    c.fillStyle = 'rgba(255,250,222,0.28)';
    c.fillRect(0, 0, CW, 3);
    const t = tex(cv);
    t.wrapS = THREE.RepeatWrapping;
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

/** A dirt road that fades into the grass at its edges and repeats along its length. */
export function roadMaterial(): THREE.MeshLambertMaterial {
  return cachedMat('road', () => {
    const RW = 64, RH = 128;
    const [cv, c] = cvs(RW, RH);
    const edge = c.createLinearGradient(0, 0, RW, 0);
    edge.addColorStop(0, 'rgba(150,126,92,0)');
    edge.addColorStop(0.08, 'rgba(150,126,92,0.92)');
    edge.addColorStop(0.92, 'rgba(150,126,92,0.92)');
    edge.addColorStop(1, 'rgba(150,126,92,0)');
    c.fillStyle = edge;
    c.fillRect(0, 0, RW, RH);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(128,104,74,0.8)';
    c.fillRect(RW * 0.18, 0, RW * 0.64, RH);
    const r = new RNG(77);
    for (let i = 0; i < 60; i++) {
      const x = r.float(6, RW - 6), y = r.float(0, RH);
      c.fillStyle = r.chance(0.5) ? 'rgba(170,146,110,0.55)' : 'rgba(104,84,60,0.4)';
      const rx = r.float(1.2, 2.8), ry = r.float(1, 2);
      for (const oy of [-RH, 0, RH]) {
        c.beginPath(); c.ellipse(x, y + oy, rx, ry, 0, 0, Math.PI * 2); c.fill();
      }
    }
    // wheel ruts
    c.fillStyle = 'rgba(96,76,54,0.35)';
    c.fillRect(RW * 0.3, 0, 3, RH);
    c.fillRect(RW * 0.7 - 3, 0, 3, RH);
    const t = tex(cv);
    t.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshLambertMaterial({
      map: t, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
  });
}

/** A road carrying on south from the edge of the map, over the ground beyond it. */
export function roadStrip(x: number, mapH: number, width: number, length: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * (length / (width * 2)));
  uv.needsUpdate = true;
  const m = new THREE.Mesh(geo, roadMaterial());
  m.position.set(x, 0.02, mapH - 0.6 + length / 2);
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

export type Grain = 'grass' | 'gravel';
const grains = new Map<Grain, THREE.Texture>();

/**
 * A small tiling texture of blades or grit, centred on mid-grey. The ground
 * multiplies it in at world scale: the big painting carries the colour and
 * this carries the grain up close.
 */
export function grainTexture(kind: Grain): THREE.Texture {
  const hit = grains.get(kind);
  if (hit) return hit;
  const S = 256;
  const [cv, c] = cvs(S, S);
  c.fillStyle = 'rgb(128,128,128)';
  c.fillRect(0, 0, S, S);
  const r = new RNG(kind === 'grass' ? 41 : 43);
  // every mark is drawn nine times over, so the ones crossing an edge wrap round
  const tile = (fn: (ox: number, oy: number) => void): void => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  for (let i = 0; i < 36; i++) {
    const x = r.float(0, S), y = r.float(0, S), rad = r.float(16, 44);
    const col = r.chance(0.5) ? '#ffffff' : '#000000';
    const a = r.float(0.05, 0.09);
    tile((ox, oy) => soft(c, x + ox, y + oy, rad, col, a));
  }
  if (kind === 'grass') {
    c.lineCap = 'round';
    for (let i = 0; i < 1500; i++) {
      const x = r.float(0, S), y = r.float(0, S);
      const len = r.float(3, 8), lean = r.float(-2.4, 2.4);
      c.strokeStyle = r.chance(0.55)
        ? 'rgba(255,255,230,' + r.float(0.1, 0.2).toFixed(3) + ')'
        : 'rgba(0,0,0,' + r.float(0.1, 0.22).toFixed(3) + ')';
      c.lineWidth = r.float(1, 1.8);
      tile((ox, oy) => {
        c.beginPath();
        c.moveTo(x + ox, y + oy);
        c.quadraticCurveTo(x + ox + lean * 0.2, y + oy - len * 0.6, x + ox + lean, y + oy - len);
        c.stroke();
      });
    }
  } else {
    for (let i = 0; i < 560; i++) {
      const x = r.float(0, S), y = r.float(0, S);
      const rx = r.float(1.4, 4.6), ry = rx * r.float(0.5, 0.85);
      const lit = 'rgba(255,248,236,' + r.float(0.12, 0.26).toFixed(3) + ')';
      tile((ox, oy) => {
        c.fillStyle = 'rgba(0,0,0,0.24)';
        c.beginPath(); c.ellipse(x + ox, y + oy + 1, rx, ry, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = lit;
        c.beginPath(); c.ellipse(x + ox, y + oy - 0.5, rx * 0.8, ry * 0.7, 0, 0, Math.PI * 2); c.fill();
      });
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  keep(t);
  grains.set(kind, t);
  return t;
}

/**
 * Multiply a grain texture into a lit material. It is sampled in world space,
 * so it runs on unbroken across the map, the tops of ledges and the ground past
 * the edge. Two samples at different scales and angles hide the repeat.
 */
export function withGrain<T extends THREE.Material>(m: T, grain: THREE.Texture, strength: number, unitsPerTile = 4): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.grainMap = { value: grain };
    sh.uniforms.grainScale = { value: 1 / unitsPerTile };
    sh.uniforms.grainStrength = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform float grainScale;\nvarying vec2 vGrainUv;\nvoid main() {')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vGrainUv = (modelMatrix * vec4(transformed, 1.0)).xz * grainScale;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform sampler2D grainMap;\nuniform float grainStrength;\nvarying vec2 vGrainUv;\nvoid main() {')
      .replace('#include <map_fragment>', [
        '#include <map_fragment>',
        '  vec3 grainA = texture2D(grainMap, vGrainUv).rgb;',
        '  vec3 grainB = texture2D(grainMap, mat2(0.8, -0.6, 0.6, 0.8) * vGrainUv * 0.43 + 0.37).rgb;',
        '  diffuseColor.rgb *= max(vec3(0.0), 1.0 + (grainA + grainB - 1.0) * grainStrength);',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'grain';
  return m;
}

export function waterMaterial(): THREE.MeshLambertMaterial {
  return cachedMat('water', () => {
    const S = 128;
    const [cv, c] = cvs(S, S);
    c.fillStyle = '#4c8794';
    c.fillRect(0, 0, S, S);
    const r = new RNG(3);
    c.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      c.strokeStyle = r.chance(0.5) ? 'rgba(220,245,248,0.35)' : 'rgba(30,70,80,0.3)';
      const x = r.float(0, S), y = r.float(0, S), w = r.float(10, 22);
      c.beginPath();
      c.moveTo(x - w, y);
      c.quadraticCurveTo(x, y - 4, x + w, y);
      c.stroke();
    }
    const t = tex(cv, true);
    return new THREE.MeshLambertMaterial({
      map: t, emissive: new THREE.Color('#16343c'), transparent: true, opacity: 0.94,
    });
  });
}

// ------------------------------------------------------------------ facades

interface WallOpts {
  wU: number;
  hU: number;
  door: boolean;
  storeys: number;
  base: string;
  shutter: string;
  warm: boolean;
  flowers: boolean;
  r: RNG;
}

function arch(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.beginPath();
  c.moveTo(x, y + h);
  c.lineTo(x, y + w / 2);
  c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
  c.lineTo(x + w, y + h);
  c.closePath();
}

function drawDoor(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.fillStyle = '#2e2016';
  arch(c, x - 7, y - 7, w + 14, h + 7);
  c.fill();
  c.fillStyle = '#7a4e2c';
  arch(c, x, y, w, h);
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.24)';
  for (let i = 1; i < 4; i++) c.fillRect(x + (i * w) / 4 - 1, y + w * 0.25, 2, h - w * 0.25);
  c.fillStyle = '#2a2a2e';
  c.fillRect(x, y + h * 0.3, w * 0.5, 5);
  c.fillRect(x, y + h * 0.72, w * 0.5, 5);
  c.fillStyle = '#d8b45a';
  c.beginPath();
  c.arc(x + w * 0.8, y + h * 0.56, Math.max(3, w * 0.05), 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#8f877c';
  c.fillRect(x - 12, y + h - 2, w + 24, 8);
}

function drawWindow(
  c: CanvasRenderingContext2D, g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, o: WallOpts, flowers: boolean,
): void {
  const f = Math.max(3, Math.round(w * 0.09));
  // shutters
  c.fillStyle = o.shutter;
  c.fillRect(x - w * 0.36 - f, y - f, w * 0.36, h + f * 2);
  c.fillRect(x + w + f, y - f, w * 0.36, h + f * 2);
  c.fillStyle = 'rgba(0,0,0,0.2)';
  for (let yy = y; yy < y + h; yy += 5) {
    c.fillRect(x - w * 0.36 - f, yy, w * 0.36, 1.5);
    c.fillRect(x + w + f, yy, w * 0.36, 1.5);
  }
  // frame, glass, mullions
  c.fillStyle = '#3a2a1e';
  c.fillRect(x - f, y - f, w + f * 2, h + f * 2);
  const gl = c.createLinearGradient(x, y, x, y + h);
  if (o.warm) {
    gl.addColorStop(0, '#fff2c4');
    gl.addColorStop(1, '#f0a048');
  } else {
    gl.addColorStop(0, '#a8bccc');
    gl.addColorStop(1, '#6a7f92');
  }
  c.fillStyle = gl;
  c.fillRect(x, y, w, h);
  c.fillStyle = '#3a2a1e';
  c.fillRect(x + w / 2 - f / 2, y, f, h);
  c.fillRect(x, y + h / 2 - f / 2, w, f);
  c.fillStyle = '#a3845e';
  c.fillRect(x - f * 2, y + h + f, w + f * 4, f * 1.5);
  if (o.warm) {
    g.fillStyle = '#ffb24a';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#000';
    g.fillRect(x + w / 2 - f / 2, y, f, h);
    g.fillRect(x, y + h / 2 - f / 2, w, f);
  }
  if (flowers) {
    const by = y + h + f * 2.6;
    c.fillStyle = '#6b4a2a';
    c.fillRect(x - f * 2, by, w + f * 4, f * 2.4);
    const cols = ['#e0607a', '#f2c85a', '#f4efe6', '#9a86e8'];
    for (let i = 0; i < 10; i++) {
      c.fillStyle = i % 3 === 0 ? '#5f8a46' : cols[o.r.int(0, 3)];
      c.beginPath();
      c.arc(x - f + (i / 9) * (w + f * 2), by - o.r.float(0, f * 1.8), f * 0.95, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function paintWall(o: WallOpts): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const P = PX_PER_UNIT;
  const W = Math.max(8, Math.round(o.wU * P)), H = Math.max(8, Math.round(o.hU * P));
  const [cv, c] = cvs(W, H);
  const [gv, g] = cvs(W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);

  const plaster = shade(o.base, 30);
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(plaster, 8));
  grad.addColorStop(1, shade(plaster, -12));
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 60; i++) {
    c.fillStyle = o.r.chance(0.5) ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)';
    c.fillRect(o.r.float(0, W), o.r.float(0, H), o.r.float(2, 7), o.r.float(2, 5));
  }

  // stone plinth
  const plinth = Math.round(P * 0.55);
  c.fillStyle = shade(o.base, -42);
  c.fillRect(0, H - plinth, W, plinth);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(0, H - plinth / 2, W, 2);
  for (let row = 0; row < 2; row++) {
    for (let x = row ? P * 0.35 : 0; x < W; x += P * 0.7) {
      c.fillRect(x, H - plinth + (row * plinth) / 2, 2, plinth / 2);
    }
  }

  // timber frame
  const beam = '#4a3526';
  const t = Math.max(6, Math.round(P * 0.18));
  const bays = Math.max(1, Math.round(o.wU / 1.9));
  const bayW = W / bays;
  const upper = H - plinth;
  const storeyLine = o.storeys > 1 ? Math.round(upper * 0.5) : -1;
  c.fillStyle = beam;
  c.fillRect(0, 0, W, t);
  c.fillRect(0, upper - t, W, t);
  if (storeyLine > 0) c.fillRect(0, storeyLine - t / 2, W, t);
  for (let i = 0; i <= bays; i++) c.fillRect(Math.round(i * bayW - t / 2), 0, t, upper);

  const doorBay = o.door ? Math.floor(bays / 2) : -1;
  const floors: [number, number][] = storeyLine > 0 ? [[storeyLine, upper], [0, storeyLine]] : [[0, upper]];
  for (let i = 0; i < bays; i++) {
    const bx = i * bayW;
    for (const [top, bottom] of floors) {
      const ground = bottom === upper;
      const room = bottom - top;
      if (ground && i === doorBay) {
        const dw = Math.min(bayW * 0.6, P * 1.3);
        const dh = Math.min(room - t * 1.4, P * 2.5);
        drawDoor(c, bx + bayW / 2 - dw / 2, bottom - t - dh, dw, dh);
        continue;
      }
      const ww = Math.min(bayW * 0.44, P * 0.95);
      const wh = Math.min(room * 0.46, P * 1.05);
      const wx = bx + bayW / 2 - ww / 2;
      const wy = top + (room - wh) * (ground ? 0.4 : 0.48);
      drawWindow(c, g, wx, wy, ww, wh, o, ground && o.flowers);
    }
  }

  const gg = c.createLinearGradient(0, H * 0.55, 0, H);
  gg.addColorStop(0, 'rgba(40,30,20,0)');
  gg.addColorStop(1, 'rgba(40,30,20,0.2)');
  c.fillStyle = gg;
  c.fillRect(0, 0, W, H);
  return { map: tex(cv), glow: tex(gv) };
}

export interface Facade {
  front: THREE.MeshLambertMaterial;
  back: THREE.MeshLambertMaterial;
  side: THREE.MeshLambertMaterial;
  cap: THREE.MeshLambertMaterial;
  gable: THREE.MeshLambertMaterial;
  textures: THREE.Texture[];
}

export function facadeMaterials(b: Building, wallH: number, seed: number): Facade {
  const r = new RNG(seed || 1);
  const shutters = ['#4f6b7a', '#6a7d4a', '#8a4a3f', '#5f6b82', '#7a5b7a'];
  const base = { base: b.color, storeys: b.storeys, r, warm: b.warm, shutter: r.pick(shutters) };
  const wU = b.w * 0.05, dU = b.d * 0.05;
  const front = paintWall({ ...base, wU, hU: wallH, door: true, flowers: r.chance(0.75) });
  const back = paintWall({ ...base, wU, hU: wallH, door: false, flowers: false });
  const side = paintWall({ ...base, wU: dU, hU: wallH, door: false, flowers: r.chance(0.35) });
  const lam = (p: { map: THREE.Texture; glow: THREE.Texture }) => new THREE.MeshLambertMaterial({
    map: p.map, emissive: new THREE.Color('#ffb14e'), emissiveMap: p.glow, emissiveIntensity: 0.85,
  });
  return {
    front: lam(front),
    back: lam(back),
    side: lam(side),
    cap: new THREE.MeshLambertMaterial({ color: new THREE.Color(shade(b.color, -30)) }),
    gable: new THREE.MeshLambertMaterial({ color: new THREE.Color(shade(b.color, 30)), side: THREE.DoubleSide }),
    textures: [front.map, front.glow, back.map, back.glow, side.map, side.glow],
  };
}

/** A pitched roof with its ridge running along x, thick enough to show at the eaves. */
export function gableRoof(
  wU: number, dU: number, rise: number, overhang: number,
  roof: THREE.Material, gable: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const half = dU / 2 + overhang;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  const len = wU + overhang * 2;
  const thick = 0.18;
  for (const side of [1, -1]) {
    const geo = new THREE.BoxGeometry(len, thick, slope);
    boxUV(geo, len, thick, slope, 2.4);
    const m = new THREE.Mesh(geo, roof);
    m.position.set(0, rise / 2, (side * half) / 2);
    m.rotation.x = side * ang;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  const tri = new THREE.Shape();
  tri.moveTo(-dU / 2, 0);
  tri.lineTo(dU / 2, 0);
  tri.lineTo(0, rise * (dU / 2) / half);
  tri.closePath();
  const tg = new THREE.ShapeGeometry(tri);
  for (const sx of [-wU / 2, wU / 2]) {
    const m = new THREE.Mesh(tg, gable);
    m.position.set(sx, 0, 0);
    m.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
