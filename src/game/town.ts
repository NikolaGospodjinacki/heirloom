import { TS, shadow } from '../render/view';
import { drawGround, drawHero, roundRect } from '../render/draw';
import type { GameState } from './state';
import type { Village } from './types';

export type BuildingId = 'guild' | 'shop' | 'smith' | 'home' | 'gate';

export interface Building {
  id: BuildingId;
  name: string;
  x: number; y: number;
  w: number; d: number; h: number;
  color: string;
  roof: string;
  prompt: string;
}

export interface Town {
  w: number; h: number;
  tiles: Uint8Array;
  buildings: Building[];
  px: number; py: number;
  facing: number;
  walkT: number;
  decor: { x: number; y: number; kind: number }[];
  npcs: { x: number; y: number; t: number; hue: string; home: [number, number] }[];
}

const LAYOUT: Omit<Building, 'x' | 'y'>[] = [
  { id: 'guild', name: 'Adventurers Guild', w: 150, d: 130, h: 96, color: '#8a6a4a', roof: '#8c4a3f', prompt: 'quest board' },
  { id: 'shop', name: 'General Store', w: 130, d: 120, h: 78, color: '#7d7050', roof: '#4f6b7a', prompt: 'buy & sell' },
  { id: 'smith', name: 'Smithy', w: 120, d: 110, h: 72, color: '#6d6258', roof: '#5a4a44', prompt: 'enhance gear' },
  { id: 'home', name: 'Your Homestead', w: 140, d: 120, h: 80, color: '#7a6a52', roof: '#6a7d4a', prompt: 'homestead & chest' },
  { id: 'gate', name: 'Village Gate', w: 60, d: 150, h: 110, color: '#6b6257', roof: '#4a443c', prompt: 'set out' },
];

export function buildTown(st: GameState): Town {
  const w = 30, h = 30;
  const tiles = new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) tiles[i] = Math.random() < 0.18 ? 1 : 0;

  const cx = (w * TS) / 2, cy = (h * TS) / 2;
  const spots: Record<BuildingId, [number, number]> = {
    guild: [cx - 300, cy - 250],
    shop: [cx + 210, cy - 230],
    smith: [cx + 250, cy + 120],
    home: [cx - 330, cy + 130],
    gate: [cx - 30, cy + 400],
  };
  const buildings: Building[] = LAYOUT.map((b) => ({ ...b, x: spots[b.id][0], y: spots[b.id][1] }));

  const decor: Town['decor'] = [];
  for (let i = 0; i < 46; i++) {
    decor.push({
      x: Math.random() * w * TS, y: Math.random() * h * TS,
      kind: Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2,
    });
  }

  const npcCount = st.village.preset === 'thriving' ? 7 : 3;
  const hues = ['#8a5c4a', '#4f6b7a', '#6a7d4a', '#7a6a92', '#93704a', '#5f7f6f'];
  const npcs: Town['npcs'] = [];
  for (let i = 0; i < npcCount; i++) {
    const x = cx + (Math.random() - 0.5) * 460;
    const y = cy + (Math.random() - 0.5) * 460;
    npcs.push({ x, y, t: Math.random() * 6, hue: hues[i % hues.length], home: [x, y] });
  }

  return { w, h, tiles, buildings, px: cx, py: cy + 150, facing: -Math.PI / 2, walkT: 0, decor, npcs };
}

export function nearestBuilding(t: Town): Building | null {
  let best: Building | null = null;
  let bd = 999999;
  for (const b of t.buildings) {
    const d = Math.hypot(t.px - (b.x + b.w / 2), t.py - (b.y + b.d + 14));
    if (d < 78 && d < bd) { bd = d; best = b; }
  }
  return best;
}

export function tickTown(t: Town, dt: number, mx: number, my: number, speed: number): void {
  const len = Math.hypot(mx, my);
  if (len > 0.01) {
    const nx = mx / len, ny = my / len;
    t.px = Math.max(30, Math.min(t.w * TS - 30, t.px + nx * speed * dt));
    t.py = Math.max(30, Math.min(t.h * TS - 30, t.py + ny * speed * dt));
    t.facing = Math.atan2(ny, nx);
    t.walkT += dt;
  }
  for (const n of t.npcs) {
    n.t -= dt;
    if (n.t <= 0) {
      n.t = 2 + Math.random() * 5;
      n.home[0] += (Math.random() - 0.5) * 120;
      n.home[1] += (Math.random() - 0.5) * 120;
    }
    const dx = n.home[0] - n.x, dy = n.home[1] - n.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) { n.x += (dx / d) * 34 * dt; n.y += (dy / d) * 34 * dt; }
  }
}

// -------------------------------------------------------------------- render

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/** A house seen from a high angle: roof plane on top, a slice of front wall below it. */
function house(ctx: CanvasRenderingContext2D, b: Building): void {
  const roofH = b.d * 0.66;
  const wallH = b.d - roofH;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  roundRect(ctx, b.x + 7, b.y + 9, b.w, b.d, 5);
  ctx.fill();
  ctx.restore();

  // front wall
  ctx.fillStyle = b.color;
  ctx.fillRect(b.x + 5, b.y + roofH, b.w - 10, wallH);
  ctx.fillStyle = shadeHex(b.color, -26);
  ctx.fillRect(b.x + 5, b.y + b.d - 5, b.w - 10, 5);

  // door
  const dw = 22, dx = b.x + b.w / 2 - dw / 2;
  ctx.fillStyle = '#33261d';
  ctx.fillRect(dx, b.y + roofH + wallH * 0.18, dw, wallH * 0.82);
  ctx.fillStyle = '#c8a24b';
  ctx.fillRect(dx + dw - 6, b.y + roofH + wallH * 0.55, 3, 3);

  // windows
  ctx.fillStyle = '#e8cf8a';
  const wy = b.y + roofH + wallH * 0.3;
  ctx.fillRect(b.x + 16, wy, 13, 13);
  ctx.fillRect(b.x + b.w - 29, wy, 13, 13);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(b.x + 16, wy, 13, 13);
  ctx.strokeRect(b.x + b.w - 29, wy, 13, 13);

  // roof, overhanging a little on each side
  ctx.fillStyle = b.roof;
  roundRect(ctx, b.x - 4, b.y - 6, b.w + 8, roofH + 6, 4);
  ctx.fill();
  ctx.fillStyle = shadeHex(b.roof, -22);
  ctx.fillRect(b.x - 4, b.y + roofH - 4, b.w + 8, 6);
  // shingle rows
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = b.y + 4; y < b.y + roofH - 4; y += 9) {
    ctx.moveTo(b.x - 4, y); ctx.lineTo(b.x + b.w + 4, y);
  }
  ctx.stroke();
  // ridge highlight
  ctx.fillStyle = shadeHex(b.roof, 26);
  ctx.fillRect(b.x - 4, b.y - 6, b.w + 8, 5);
}

export function drawTown(
  ctx: CanvasRenderingContext2D, t: Town, st: GameState, near: Building | null,
): void {
  const v: Village = st.village;
  const tint = v.preset === 'thriving' ? 8 : -18;
  drawGround(ctx, t.w, t.h, t.tiles, '#6d8f4f', '#7b9b58', tint);

  // dirt paths radiating from the square
  ctx.save();
  ctx.strokeStyle = 'rgba(126,102,68,0.6)';
  ctx.lineWidth = 30;
  ctx.lineCap = 'round';
  const cx = (t.w * TS) / 2, cy = (t.h * TS) / 2;
  for (const b of t.buildings) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(b.x + b.w / 2, b.y + b.d + 16);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(126,102,68,0.6)';
  ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // village well in the square
  ctx.fillStyle = '#77716a';
  ctx.beginPath(); ctx.ellipse(cx, cy, 18, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b2723';
  ctx.beginPath(); ctx.ellipse(cx, cy - 2, 12, 9, 0, 0, Math.PI * 2); ctx.fill();

  type Renderable = { d: number; f: () => void };
  const list: Renderable[] = [];

  for (const dec of t.decor) {
    list.push({
      d: dec.y, f: () => {
        if (dec.kind === 0) {
          ctx.fillStyle = v.preset === 'thriving' ? '#8fb063' : '#7d8a56';
          for (let i = 0; i < 3; i++) ctx.fillRect(dec.x - 4 + i * 4, dec.y - 6 - (i % 2) * 3, 2, 8);
        } else if (dec.kind === 1) {
          shadow(ctx, dec.x, dec.y, 13, 0.25);
          ctx.fillStyle = '#6b4a2a'; ctx.fillRect(dec.x - 3, dec.y - 22, 6, 22);
          ctx.fillStyle = v.preset === 'thriving' ? '#4d7c3c' : '#6a6b3a';
          ctx.beginPath(); ctx.arc(dec.x, dec.y - 32, 16, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.beginPath(); ctx.arc(dec.x - 5, dec.y - 37, 7, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = '#8d8f96';
          ctx.beginPath(); ctx.ellipse(dec.x, dec.y, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
        }
      },
    });
  }

  for (const b of t.buildings) {
    list.push({
      d: b.y + b.d, f: () => {
        house(ctx, b);
        const sx = b.x + b.w / 2;
        ctx.font = '600 12px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(b.name).width;
        ctx.fillStyle = 'rgba(20,18,16,0.66)';
        roundRect(ctx, sx - tw / 2 - 7, b.y - 30, tw + 14, 18, 5);
        ctx.fill();
        ctx.fillStyle = near?.id === b.id ? '#ffe28a' : '#e8e2d4';
        ctx.fillText(b.name, sx, b.y - 17);
        if (near?.id === b.id) {
          ctx.fillStyle = '#ffe28a';
          ctx.font = '700 12px ui-sans-serif, system-ui';
          ctx.fillText('[E] ' + b.prompt, sx, b.y + b.d + 32);
        }
      },
    });
  }

  for (const n of t.npcs) {
    list.push({
      d: n.y, f: () => {
        shadow(ctx, n.x, n.y, 9, 0.22);
        ctx.fillStyle = n.hue;
        roundRect(ctx, n.x - 6, n.y - 26, 12, 20, 4); ctx.fill();
        ctx.fillStyle = '#e0b98f';
        ctx.beginPath(); ctx.arc(n.x, n.y - 30, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a2a1c';
        ctx.beginPath(); ctx.arc(n.x, n.y - 32, 7, Math.PI, Math.PI * 2); ctx.fill();
      },
    });
  }

  list.push({
    d: t.py, f: () => drawHero(ctx, t.px, t.py, st.hero.appearance, t.facing, t.walkT),
  });

  list.sort((a, b) => a.d - b.d);
  for (const r of list) r.f();
}
