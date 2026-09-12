import type { Appearance } from '../game/types';
import { toScreen, shadow, TS } from './view';
import { MONSTERS } from '../game/content';
import type { Drop, Mob, Node, Popup, Projectile, Slash, Zone } from '../game/zone';
import { ITEM_DEFS } from '../game/items';
import { RARITY_COLOR } from '../game/types';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// ------------------------------------------------------------------- ground

export function drawGround(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  tiles: Uint8Array, c1: string, c2: string, seedTint = 0,
): void {
  const a = shade(c1, seedTint);
  const b = shade(c2, seedTint);
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, w * TS, h * TS);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const v = tiles[ty * w + tx];
      const x = tx * TS, y = ty * TS;
      if (v) {
        ctx.fillStyle = b;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x, y, TS, TS);
        ctx.globalAlpha = 1;
      }
      // tufts: cheap texture so the ground is not a flat colour field
      if (((tx * 7 + ty * 13) & 7) === 0) {
        ctx.fillStyle = shade(v ? c2 : c1, seedTint + 16);
        ctx.fillRect(x + 12, y + 22, 3, 6);
        ctx.fillRect(x + 17, y + 18, 3, 10);
        ctx.fillRect(x + 22, y + 24, 3, 5);
      }
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let tx = 0; tx <= w; tx++) { ctx.moveTo(tx * TS, 0); ctx.lineTo(tx * TS, h * TS); }
  for (let ty = 0; ty <= h; ty++) { ctx.moveTo(0, ty * TS); ctx.lineTo(w * TS, ty * TS); }
  ctx.stroke();
}

export function drawBorder(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(10,14,10,0.6)';
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, w * TS, h * TS);
  ctx.restore();
}

// -------------------------------------------------------------------- actor

export function drawHero(
  ctx: CanvasRenderingContext2D, wx: number, wy: number,
  app: Appearance, facing: number, walkT: number, hurt = 0, swing = 0,
): void {
  const [sx, sy] = toScreen(wx, wy);
  shadow(ctx, wx, wy, 13, 0.28);
  const bob = Math.sin(walkT * 11) * 2.2;
  const H = 42 * app.height;
  const bodyW = 15 + app.build * 6;

  ctx.save();
  ctx.translate(sx, sy - bob);
  if (hurt > 0) { ctx.globalAlpha = 0.55 + Math.sin(hurt * 60) * 0.35; }

  // legs
  ctx.fillStyle = shade(app.cloth, -46);
  const legSwing = Math.sin(walkT * 11) * 4;
  roundRect(ctx, -6, -13 + legSwing * 0.2, 5, 13 - legSwing, 2.5); ctx.fill();
  roundRect(ctx, 1, -13 - legSwing * 0.2, 5, 13 + legSwing, 2.5); ctx.fill();

  // body
  ctx.fillStyle = app.cloth;
  roundRect(ctx, -bodyW / 2, -H + 12, bodyW, H - 24, 5);
  ctx.fill();
  ctx.fillStyle = app.accent;
  ctx.fillRect(-bodyW / 2, -H + 20, bodyW, 3);

  // head
  ctx.fillStyle = app.skin;
  ctx.beginPath();
  ctx.arc(0, -H + 4, 9.5, 0, Math.PI * 2);
  ctx.fill();

  // hair
  ctx.fillStyle = app.hair;
  ctx.beginPath();
  if (app.hairStyle === 0) ctx.arc(0, -H + 2, 9.8, Math.PI, Math.PI * 2);
  else if (app.hairStyle === 1) { ctx.arc(0, -H + 3, 10.2, Math.PI * 0.9, Math.PI * 2.1); }
  else if (app.hairStyle === 2) { ctx.arc(0, -H + 1, 9.5, Math.PI, Math.PI * 2); ctx.rect(-10, -H + 1, 20, 6); }
  else { ctx.arc(0, -H + 2, 10.6, Math.PI * 0.85, Math.PI * 2.15); }
  ctx.fill();

  // eyes, facing-aware
  const fx = Math.cos(facing) * 2.4;
  ctx.fillStyle = '#20242c';
  if (Math.sin(facing) > -0.55) {
    ctx.fillRect(-4 + fx, -H + 4, 2, 2.6);
    ctx.fillRect(2 + fx, -H + 4, 2, 2.6);
  }

  // weapon arm hint
  if (swing > 0) {
    ctx.save();
    ctx.rotate(-facing * 0.15);
    ctx.strokeStyle = '#e8e4d8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bodyW / 2, -H + 20);
    ctx.lineTo(bodyW / 2 + 14, -H + 12);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export function drawMob(ctx: CanvasRenderingContext2D, m: Mob): void {
  const d = MONSTERS[m.defId];
  const [sx, sy] = toScreen(m.x, m.y);
  const dying = m.state === 'dead';
  const alpha = dying ? Math.max(0, 1 - m.dead / 1.2) : 1;
  shadow(ctx, m.x, m.y, d.size * 0.85, 0.25 * alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  if (dying) { ctx.rotate(m.dead * 1.4); ctx.scale(1, 1 - m.dead * 0.5); }
  const bob = Math.sin(m.x * 0.05 + m.y * 0.05 + performance.now() * 0.004) * 1.6;
  ctx.translate(0, bob);

  const flash = m.hitFlash > 0;
  const body = flash ? '#ffffff' : d.color;

  if (d.family === 'ooze') {
    const squish = 1 + Math.sin(performance.now() * 0.005) * 0.12;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, -d.size * 0.5, d.size * squish, d.size * 0.75 / squish, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : d.accent;
    ctx.beginPath();
    ctx.arc(-d.size * 0.3, -d.size * 0.7, 2.4, 0, Math.PI * 2);
    ctx.arc(d.size * 0.3, -d.size * 0.7, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (d.family === 'beast') {
    ctx.fillStyle = body;
    roundRect(ctx, -d.size, -d.size * 1.25, d.size * 2, d.size * 1.25, d.size * 0.5);
    ctx.fill();
    // snout in facing direction
    const fx = Math.cos(d.family === 'beast' ? m.facing : 0);
    ctx.fillStyle = flash ? '#fff' : shade(d.color, -30);
    roundRect(ctx, fx > 0 ? d.size * 0.6 : -d.size * 1.4, -d.size * 0.85, d.size * 0.8, d.size * 0.5, 3);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : d.accent;
    ctx.fillRect(fx > 0 ? d.size * 1.0 : -d.size * 1.3, -d.size * 0.95, 3, 5);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(-3, -d.size * 1.05, 2.4, 2.4);
    ctx.fillRect(3, -d.size * 1.05, 2.4, 2.4);
  } else {
    // upright: humanoid / undead / boss
    const H = d.size * 2.5;
    ctx.fillStyle = shade(body, -40);
    roundRect(ctx, -5, -12, 4, 12, 2); ctx.fill();
    roundRect(ctx, 1, -12, 4, 12, 2); ctx.fill();
    ctx.fillStyle = body;
    roundRect(ctx, -d.size * 0.6, -H + 8, d.size * 1.2, H - 20, 4);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : shade(d.color, 22);
    ctx.beginPath();
    ctx.arc(0, -H + 2, d.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : d.accent;
    ctx.fillRect(-4, -H + 1, 2.6, 2.6);
    ctx.fillRect(2, -H + 1, 2.6, 2.6);
    if (d.family === 'boss') {
      ctx.strokeStyle = d.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-d.size * 0.5, -H - 2); ctx.lineTo(-d.size * 0.7, -H - 12);
      ctx.moveTo(d.size * 0.5, -H - 2); ctx.lineTo(d.size * 0.7, -H - 12);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (!dying && (m.hp < m.maxHp || d.family === 'boss')) {
    const w = Math.max(26, d.size * 2.2);
    const y = sy - d.size * 2.9 - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(sx - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = d.family === 'boss' ? '#d4453f' : '#c8534b';
    ctx.fillRect(sx - w / 2, y, w * Math.max(0, m.hp / m.maxHp), 4);
  }
  if (!dying && m.windup > 0) {
    ctx.fillStyle = 'rgba(255,90,70,' + (0.35 + 0.4 * Math.sin(performance.now() * 0.03)) + ')';
    ctx.beginPath();
    ctx.ellipse(sx, sy, d.attackRange, d.attackRange * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawNode(ctx: CanvasRenderingContext2D, n: Node): void {
  if (n.respawn > 0) {
    const [sx, sy] = toScreen(n.x, n.y);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = n.kind === 'tree' ? '#3d5c30' : '#5a5a5f';
    ctx.beginPath(); ctx.ellipse(sx, sy, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const [sx, sy] = toScreen(n.x, n.y);
  const flash = n.hitFlash > 0;
  shadow(ctx, n.x, n.y, n.kind === 'tree' ? 16 : 13, 0.3);
  ctx.save();
  ctx.translate(sx, sy);
  if (flash) ctx.translate(Math.random() * 3 - 1.5, 0);
  if (n.kind === 'tree') {
    ctx.fillStyle = flash ? '#fff' : '#6b4a2a';
    ctx.fillRect(-4, -26, 8, 26);
    const greens = ['#3f6b34', '#4d7c3c', '#355c2c'];
    ctx.fillStyle = flash ? '#fff' : greens[n.variant % greens.length];
    ctx.beginPath();
    ctx.arc(0, -38, 18, 0, Math.PI * 2);
    ctx.arc(-11, -30, 12, 0, Math.PI * 2);
    ctx.arc(11, -30, 12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = flash ? '#fff' : ['#7c7f88', '#6a6d76', '#8a8d96'][n.variant % 3];
    ctx.beginPath();
    ctx.moveTo(-14, 0); ctx.lineTo(-9, -16); ctx.lineTo(2, -20); ctx.lineTo(13, -12); ctx.lineTo(11, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(-9, -16); ctx.lineTo(2, -20); ctx.lineTo(0, -10); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  if (n.hp < n.maxHp) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - 15, sy + 4, 30, 4);
    ctx.fillStyle = '#c7b26a';
    ctx.fillRect(sx - 14, sy + 5, 28 * (n.hp / n.maxHp), 2);
  }
}

export function drawDrop(ctx: CanvasRenderingContext2D, dr: Drop): void {
  const [sx, sy] = toScreen(dr.x, dr.y);
  const def = ITEM_DEFS[dr.item.defId];
  shadow(ctx, dr.x, dr.y, 7, 0.22);
  const glow = RARITY_COLOR[dr.item.rarity];
  ctx.save();
  ctx.translate(sx, sy - dr.z - 6);
  ctx.rotate(Math.sin(dr.t * 3) * 0.2);
  if (dr.item.rarity !== 'common') {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = def.color;
  roundRect(ctx, -6, -6, 12, 12, 3);
  ctx.fill();
  ctx.strokeStyle = glow;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
  const [sx, sy] = toScreen(p.x, p.y);
  ctx.save();
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.ellipse(sx, sy - 22, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawSlash(ctx: CanvasRenderingContext2D, s: Slash): void {
  const [sx, sy] = toScreen(s.x, s.y);
  const p = s.t / 0.22;
  ctx.save();
  ctx.translate(sx, sy - 14);
  ctx.rotate(s.ang);
  ctx.strokeStyle = 'rgba(255,250,230,' + (0.85 * (1 - p)) + ')';
  ctx.lineWidth = 5 - p * 3;
  ctx.beginPath();
  ctx.arc(0, 0, s.range * (0.6 + p * 0.5), -0.9, 0.9);
  ctx.stroke();
  ctx.restore();
}

export function drawPopup(ctx: CanvasRenderingContext2D, p: Popup): void {
  const [sx, sy] = toScreen(p.x, p.y);
  const a = Math.max(0, 1 - p.t / 1.1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = '700 13px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(p.text, sx, sy - 30);
  ctx.fillStyle = p.color;
  ctx.fillText(p.text, sx, sy - 30);
  ctx.restore();
}

export function drawExitPad(ctx: CanvasRenderingContext2D, z: Zone): void {
  const [sx, sy] = toScreen(z.exitX, z.exitY);
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.003);
  ctx.save();
  ctx.strokeStyle = 'rgba(240,214,122,' + (0.4 + pulse * 0.5) + ')';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx, sy, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(240,214,122,0.10)';
  ctx.fill();
  ctx.font = (z.nearExit ? '700 13px' : '600 12px') + ' ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = z.nearExit ? '#ffe28a' : 'rgba(245,235,200,0.75)';
  ctx.fillText(z.nearExit ? '[E] back to town' : 'the road home', sx, sy - 52);
  ctx.restore();
}
