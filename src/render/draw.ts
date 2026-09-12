import type { Appearance, Silhouette } from '../game/types';
import { toScreen, shadow, TS } from './view';
import { MONSTERS } from '../game/content';
import type { Drop, Mob, Node, Particle, Popup, Projectile, Slash, Zone } from '../game/zone';
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

export function shade(hex: string, amt: number): string {
  if (!hex.startsWith('#')) return hex;
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

// -------------------------------------------------------------- paper doll

export interface GearPiece { vis: Silhouette; color: string; glow: string | null }
export interface GearLook {
  weapon: GearPiece | null;
  offhand: GearPiece | null;
  head: GearPiece | null;
  body: GearPiece | null;
  feet: GearPiece | null;
}
export const NO_GEAR: GearLook = { weapon: null, offhand: null, head: null, body: null, feet: null };

export interface HeroDraw {
  hurt?: number;
  /** seconds left in the swing, 0 when idle */
  swing?: number;
  swingMax?: number;
  gear?: GearLook;
  iframes?: number;
  dashing?: boolean;
}

/** Weapon held out at `ang`, sweeping through the swing. */
function drawWeapon(ctx: CanvasRenderingContext2D, p: GearPiece, ang: number, scale: number): void {
  ctx.save();
  ctx.rotate(ang);
  const c = p.color;
  if (p.glow) { ctx.shadowColor = p.glow; ctx.shadowBlur = 9; }
  switch (p.vis) {
    case 'dagger':
      ctx.fillStyle = '#4a3a2c'; ctx.fillRect(6, -1.6, 5, 3.2);
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(11, -2.6); ctx.lineTo(11 + 13 * scale, 0); ctx.lineTo(11, 2.6);
      ctx.closePath(); ctx.fill();
      break;
    case 'sword':
      ctx.fillStyle = '#4a3a2c'; ctx.fillRect(5, -1.8, 6, 3.6);
      ctx.fillStyle = '#c8a24b'; ctx.fillRect(10, -4.5, 2.6, 9);
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(12.6, -3); ctx.lineTo(12.6 + 22 * scale, 0); ctx.lineTo(12.6, 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(c, 40); ctx.fillRect(13, -1, 20 * scale, 1);
      break;
    case 'greatsword':
      ctx.fillStyle = '#3e3126'; ctx.fillRect(3, -2.2, 9, 4.4);
      ctx.fillStyle = '#c8a24b'; ctx.fillRect(11, -6.5, 3, 13);
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(14, -4.4); ctx.lineTo(14 + 32 * scale, 0); ctx.lineTo(14, 4.4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(c, 40); ctx.fillRect(15, -1.2, 28 * scale, 1.6);
      break;
    case 'axe':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(4, -1.8, 20 * scale, 3.6);
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(18 * scale, -8); ctx.lineTo(26 * scale, -3);
      ctx.lineTo(26 * scale, 3); ctx.lineTo(18 * scale, 8);
      ctx.closePath(); ctx.fill();
      break;
    case 'pick':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(4, -1.8, 19 * scale, 3.6);
      ctx.strokeStyle = c; ctx.lineWidth = 3.4; ctx.beginPath();
      ctx.moveTo(15 * scale, -9); ctx.quadraticCurveTo(23 * scale, 0, 15 * scale, 9);
      ctx.stroke();
      break;
    case 'staff':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(2, -2, 30 * scale, 4);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(32 * scale, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(c, 70);
      ctx.beginPath(); ctx.arc(32 * scale, -1.5, 2.6, 0, Math.PI * 2); ctx.fill();
      break;
    case 'wand':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(3, -1.6, 15 * scale, 3.2);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(19 * scale, 0, 4, 0, Math.PI * 2); ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawShield(ctx: CanvasRenderingContext2D, p: GearPiece, ang: number): void {
  ctx.save();
  ctx.rotate(ang);
  ctx.translate(9, 0);
  const tall = p.vis === 'shield_tall';
  ctx.fillStyle = p.color;
  if (tall) {
    ctx.beginPath();
    ctx.moveTo(-5, -10); ctx.lineTo(5, -10); ctx.lineTo(5, 4); ctx.lineTo(0, 12); ctx.lineTo(-5, 4);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = shade(p.color, -45);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = shade(p.color, 45);
  ctx.beginPath(); ctx.arc(0, tall ? -2 : 0, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawHero(
  ctx: CanvasRenderingContext2D, wx: number, wy: number,
  app: Appearance, facing: number, walkT: number, o: HeroDraw = {},
): void {
  const [sx, sy] = toScreen(wx, wy);
  const gear = o.gear ?? NO_GEAR;
  const hurt = o.hurt ?? 0;
  const swing = o.swing ?? 0;
  const swingMax = o.swingMax ?? 0.2;

  shadow(ctx, wx, wy, 12, 0.3);

  const bob = Math.sin(walkT * 12) * 2.2;
  const H = 42 * app.height;
  const bodyW = 15 + app.build * 6;
  const faceAway = Math.sin(facing) < -0.4;
  const cosF = Math.cos(facing);

  ctx.save();
  ctx.translate(sx, sy - bob);

  if (o.iframes && o.iframes > 0) ctx.globalAlpha = 0.45 + Math.sin(performance.now() * 0.05) * 0.25;
  else if (hurt > 0) ctx.globalAlpha = 0.55 + Math.sin(hurt * 70) * 0.35;

  const swingP = swing > 0 ? 1 - swing / swingMax : -1;
  // rest position: weapon held out to the character's right
  const restAng = facing - 1.05;
  const weaponAng = swingP >= 0
    ? facing - 1.25 + swingP * 2.5
    : restAng;
  const shieldAng = facing - 1.0;

  // ---- things drawn BEHIND the body when facing away
  if (faceAway && gear.weapon) drawWeapon(ctx, gear.weapon, weaponAng, 1);
  if (faceAway && gear.offhand) drawShield(ctx, gear.offhand, shieldAng);

  // ---- legs / boots
  const legSwing = Math.sin(walkT * 12) * 4;
  const legColor = gear.feet ? gear.feet.color : shade(app.cloth, -46);
  ctx.fillStyle = legColor;
  roundRect(ctx, -6, -13 + legSwing * 0.2, 5, 13 - legSwing, 2.5); ctx.fill();
  roundRect(ctx, 1, -13 - legSwing * 0.2, 5, 13 + legSwing, 2.5); ctx.fill();
  if (gear.feet) {
    ctx.fillStyle = shade(gear.feet.color, -40);
    ctx.fillRect(-6.5, -3, 6, 3);
    ctx.fillRect(0.5, -3, 6, 3);
  }

  // ---- torso, tinted by body armour
  const bodyCol = gear.body ? gear.body.color : app.cloth;
  const isRobe = gear.body?.vis === 'robe';
  const isMail = gear.body?.vis === 'mail';
  ctx.fillStyle = bodyCol;
  if (isRobe) {
    ctx.beginPath();
    ctx.moveTo(-bodyW / 2, -H + 12);
    ctx.lineTo(bodyW / 2, -H + 12);
    ctx.lineTo(bodyW / 2 + 4, -1);
    ctx.lineTo(-bodyW / 2 - 4, -1);
    ctx.closePath();
    ctx.fill();
  } else {
    roundRect(ctx, -bodyW / 2, -H + 12, bodyW, H - 24, 5);
    ctx.fill();
  }
  if (isMail) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = -H + 15; y < -6; y += 3) { ctx.moveTo(-bodyW / 2, y); ctx.lineTo(bodyW / 2, y); }
    ctx.stroke();
  }
  // belt / trim
  ctx.fillStyle = gear.body ? shade(bodyCol, -50) : app.accent;
  ctx.fillRect(-bodyW / 2, -H + 22, bodyW, 3);
  if (gear.body?.glow) {
    ctx.save();
    ctx.shadowColor = gear.body.glow; ctx.shadowBlur = 10;
    ctx.strokeStyle = gear.body.glow; ctx.lineWidth = 1;
    roundRect(ctx, -bodyW / 2, -H + 12, bodyW, H - 24, 5);
    ctx.stroke();
    ctx.restore();
  }

  // ---- arms
  ctx.fillStyle = app.skin;
  const armSwing = Math.sin(walkT * 12) * 3;
  roundRect(ctx, -bodyW / 2 - 3.4, -H + 16 + armSwing * 0.4, 3.6, 12, 1.8); ctx.fill();
  roundRect(ctx, bodyW / 2 - 0.2, -H + 16 - armSwing * 0.4, 3.6, 12, 1.8); ctx.fill();

  // ---- head
  ctx.fillStyle = app.skin;
  ctx.beginPath();
  ctx.arc(0, -H + 4, 9.5, 0, Math.PI * 2);
  ctx.fill();

  // ---- hair
  ctx.fillStyle = app.hair;
  ctx.beginPath();
  if (faceAway) {
    ctx.arc(0, -H + 4, 9.6, 0, Math.PI * 2);
  } else if (app.hairStyle === 0) {
    ctx.arc(0, -H + 2, 9.8, Math.PI, Math.PI * 2);
  } else if (app.hairStyle === 1) {
    ctx.arc(0, -H + 3, 10.2, Math.PI * 0.9, Math.PI * 2.1);
  } else if (app.hairStyle === 2) {
    ctx.arc(0, -H + 1, 9.5, Math.PI, Math.PI * 2); ctx.rect(-10, -H + 1, 20, 6);
  } else {
    ctx.arc(0, -H + 2, 10.6, Math.PI * 0.85, Math.PI * 2.15);
  }
  ctx.fill();

  // ---- headgear
  if (gear.head) {
    const g = gear.head;
    ctx.fillStyle = g.color;
    if (g.vis === 'hat') {
      ctx.beginPath();
      ctx.ellipse(0, -H - 1, 13, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-7, -H - 2); ctx.lineTo(0, -H - 20); ctx.lineTo(7, -H - 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(g.color, 50);
      ctx.fillRect(-7.5, -H - 5, 15, 3);
    } else if (g.vis === 'helm') {
      ctx.beginPath();
      ctx.arc(0, -H + 3, 10.4, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(-10.4, -H + 3, 20.8, 3.5);
      if (!faceAway) {
        ctx.fillStyle = shade(g.color, -45);
        ctx.fillRect(-1.2, -H - 5, 2.4, 12);
      }
    } else {
      ctx.beginPath();
      ctx.arc(0, -H + 2.5, 10, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(g.color, -35);
      ctx.fillRect(-10, -H + 1.5, 20, 2.4);
    }
    if (g.glow) {
      ctx.save();
      ctx.shadowColor = g.glow; ctx.shadowBlur = 10;
      ctx.strokeStyle = g.glow; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, -H + 2, 10.6, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // ---- face
  if (!faceAway) {
    const fx = cosF * 2.4;
    ctx.fillStyle = '#20242c';
    ctx.fillRect(-4 + fx, -H + 4, 2, 2.6);
    ctx.fillRect(2 + fx, -H + 4, 2, 2.6);
  }

  // ---- things drawn IN FRONT when facing the camera
  if (!faceAway && gear.offhand) drawShield(ctx, gear.offhand, shieldAng);
  if (!faceAway && gear.weapon) drawWeapon(ctx, gear.weapon, weaponAng, 1);

  ctx.restore();
}

/** Big head-and-shoulders for the conversation screen. */
export function drawPortrait(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, app: Appearance, t = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const breathe = Math.sin(t * 1.6) * 0.6;
  ctx.translate(0, breathe);

  // shoulders
  ctx.fillStyle = app.cloth;
  ctx.beginPath();
  ctx.moveTo(-34, 60);
  ctx.quadraticCurveTo(-30, 22, 0, 20);
  ctx.quadraticCurveTo(30, 22, 34, 60);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = app.accent;
  ctx.beginPath();
  ctx.moveTo(-10, 22); ctx.lineTo(0, 44); ctx.lineTo(10, 22);
  ctx.closePath(); ctx.fill();

  // neck
  ctx.fillStyle = shade(app.skin, -28);
  ctx.fillRect(-6, 8, 12, 16);

  // head
  ctx.fillStyle = app.skin;
  ctx.beginPath();
  ctx.ellipse(0, -6, 21, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.beginPath(); ctx.ellipse(-21, -4, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(21, -4, 4, 6, 0, 0, Math.PI * 2); ctx.fill();

  // hair
  ctx.fillStyle = app.hair;
  ctx.beginPath();
  if (app.hairStyle === 0) {
    ctx.ellipse(0, -14, 22, 19, 0, Math.PI, Math.PI * 2);
    ctx.rect(-22, -14, 44, 5);
  } else if (app.hairStyle === 1) {
    ctx.ellipse(0, -12, 24, 22, 0, Math.PI * 0.86, Math.PI * 2.14);
  } else if (app.hairStyle === 2) {
    ctx.ellipse(0, -16, 22, 17, 0, Math.PI, Math.PI * 2);
    ctx.rect(-24, -16, 48, 22);
  } else {
    ctx.ellipse(0, -13, 23, 21, 0, Math.PI * 0.8, Math.PI * 2.2);
  }
  ctx.fill();

  // brows + eyes
  const blink = (Math.sin(t * 0.9) > 0.985) ? 0.15 : 1;
  ctx.fillStyle = shade(app.hair, -30);
  ctx.fillRect(-13.5, -12.5, 10, 2.2);
  ctx.fillRect(3.5, -12.5, 10, 2.2);
  ctx.fillStyle = '#ebe2d2';
  ctx.beginPath(); ctx.ellipse(-8.5, -5, 4, 2.9 * blink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(8.5, -5, 4, 2.9 * blink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3229';
  ctx.beginPath(); ctx.ellipse(-8, -4.6, 2, 2.5 * blink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(9, -4.6, 2, 2.5 * blink, 0, 0, Math.PI * 2); ctx.fill();
  if (blink > 0.5) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(-8.7, -5.6, 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(8.3, -5.6, 0.8, 0, Math.PI * 2); ctx.fill();
  }
  // upper lids keep the eyes from reading as saucers
  ctx.fillStyle = app.skin;
  ctx.fillRect(-13, -9.4, 9, 2.2);
  ctx.fillRect(4, -9.4, 9, 2.2);

  // nose + mouth
  ctx.strokeStyle = shade(app.skin, -60);
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0.5, -2); ctx.lineTo(-1.5, 4); ctx.lineTo(1.5, 4.6); ctx.stroke();
  ctx.strokeStyle = shade(app.skin, -85);
  ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(-5.5, 10.5); ctx.quadraticCurveTo(0, 13.5, 5.5, 10.5); ctx.stroke();

  ctx.restore();
}

// -------------------------------------------------------------------- mobs

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
  // squash on impact
  if (m.hitFlash > 0) {
    const k = m.hitFlash / 0.16;
    ctx.scale(1 + 0.18 * k, 1 - 0.14 * k);
  }

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
    const fx = Math.cos(m.facing);
    ctx.fillStyle = flash ? '#fff' : shade(d.color, -30);
    roundRect(ctx, fx > 0 ? d.size * 0.6 : -d.size * 1.4, -d.size * 0.85, d.size * 0.8, d.size * 0.5, 3);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : d.accent;
    ctx.fillRect(fx > 0 ? d.size * 1.0 : -d.size * 1.3, -d.size * 0.95, 3, 5);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(-3, -d.size * 1.05, 2.4, 2.4);
    ctx.fillRect(3, -d.size * 1.05, 2.4, 2.4);
  } else {
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
    const k = 1 - m.windup / 0.38;
    ctx.strokeStyle = 'rgba(255,90,70,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, d.attackRange, d.attackRange * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,90,70,' + (0.10 + 0.22 * k) + ')';
    ctx.fill();
  }
}

export function drawNode(ctx: CanvasRenderingContext2D, n: Node): void {
  const [sx, sy] = toScreen(n.x, n.y);
  if (n.respawn > 0) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = n.kind === 'tree' ? '#3d5c30' : '#5a5a5f';
    ctx.beginPath(); ctx.ellipse(sx, sy, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const flash = n.hitFlash > 0;
  shadow(ctx, n.x, n.y, n.kind === 'tree' ? 16 : 13, 0.3);
  ctx.save();
  ctx.translate(sx, sy);
  if (n.shakeT > 0) {
    const k = n.shakeT / 0.18;
    ctx.translate(Math.sin(n.shakeT * 90) * 4 * k, 0);
    ctx.rotate(Math.sin(n.shakeT * 70) * 0.05 * k);
  }
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
    ctx.fillStyle = flash ? '#fff' : 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.arc(-6, -44, 8, 0, Math.PI * 2); ctx.fill();
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
  const rare = dr.item.rarity !== 'common';

  if (rare) {
    // a beam so you notice the good stuff from across the field
    const pulse = 0.45 + 0.3 * Math.sin(performance.now() * 0.005);
    const g = ctx.createLinearGradient(sx, sy - 90, sx, sy);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, glow);
    ctx.save();
    ctx.globalAlpha = pulse * 0.5;
    ctx.fillStyle = g;
    ctx.fillRect(sx - 7, sy - 90, 14, 90);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(sx, sy - dr.z - 6);
  ctx.rotate(Math.sin(dr.t * 3) * 0.2);
  if (rare) { ctx.shadowColor = glow; ctx.shadowBlur = 14; }
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
  ctx.shadowBlur = 16;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, 7, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 3, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawSlash(ctx: CanvasRenderingContext2D, s: Slash): void {
  const [sx, sy] = toScreen(s.x, s.y);
  const p = s.t / 0.24;
  const sweep = s.arc;
  ctx.save();
  ctx.translate(sx, sy - 16);
  ctx.rotate(s.ang - sweep + p * sweep * 2);
  ctx.strokeStyle = 'rgba(255,252,240,' + (0.9 * (1 - p)) + ')';
  ctx.lineWidth = 6 - p * 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, s.range * 0.85, -0.5, 0.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,150,' + (0.4 * (1 - p)) + ')';
  ctx.lineWidth = 12 - p * 9;
  ctx.stroke();
  ctx.restore();
}

export function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  const [sx, sy] = toScreen(p.x, p.y);
  const k = 1 - p.life / p.maxLife;
  ctx.save();
  ctx.globalAlpha = Math.max(0, k);
  ctx.fillStyle = p.color;
  const s = p.size * (0.4 + k * 0.6);
  ctx.fillRect(sx - s / 2, sy - p.z - s / 2, s, s);
  ctx.restore();
}

export function drawDashTrail(
  ctx: CanvasRenderingContext2D, trail: { x: number; y: number; t: number }[], app: Appearance,
): void {
  for (const t of trail) {
    const k = 1 - t.t / 0.3;
    const [sx, sy] = toScreen(t.x, t.y);
    ctx.save();
    ctx.globalAlpha = k * 0.22;
    ctx.fillStyle = app.cloth;
    roundRect(ctx, sx - 7, sy - 34, 14, 30, 5);
    ctx.fill();
    ctx.restore();
  }
}

export function drawPopup(ctx: CanvasRenderingContext2D, p: Popup): void {
  const [sx, sy] = toScreen(p.x, p.y);
  const k = p.t / p.life;
  const a = Math.max(0, 1 - k * k);
  const pop = p.t < 0.09 ? 1 + (0.09 - p.t) * 4 : 1;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(sx, sy - 30);
  ctx.scale(pop, pop);
  ctx.font = '800 ' + p.size + 'px ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(p.text, 0, 0);
  ctx.fillStyle = p.color;
  ctx.fillText(p.text, 0, 0);
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
