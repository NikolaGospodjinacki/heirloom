import type { Appearance, Silhouette } from '../game/types';
import { toScreen, shadow, TS } from './view';
import { MONSTERS } from '../game/content';
import type {
  Chasm, Critter, Drop, Flora, Mob, Mote, Node, Particle, Plateau, Popup,
  Projectile, Slash, Telegraph, Zone,
} from '../game/zone';
import type { Backdrop } from '../game/content';
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
        ctx.globalAlpha = 0.3;
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
  tool: GearPiece | null;
}
export const NO_GEAR: GearLook = {
  weapon: null, offhand: null, head: null, body: null, feet: null, tool: null,
};

export interface HeroDraw {
  /** height off the ground, for jumps and standing on things */
  z?: number;
  shield?: boolean;
  spin?: boolean;
  /** 0..1 while a spell is winding up */
  cast?: number;
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
    case 'hatchet':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(2, -1.5, 16 * scale, 3);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(13 * scale, -6.5); ctx.lineTo(20 * scale, -2.5);
      ctx.lineTo(20 * scale, 2.5); ctx.lineTo(13 * scale, 6.5);
      ctx.closePath(); ctx.fill();
      break;
    case 'miner_pick':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(2, -1.5, 15 * scale, 3);
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(11 * scale, -7.5); ctx.quadraticCurveTo(19 * scale, 0, 11 * scale, 7.5);
      ctx.stroke();
      break;
    case 'sickle':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(2, -1.5, 12 * scale, 3);
      ctx.strokeStyle = c; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(13 * scale, -4, 6.5, 0.5, 3.4);
      ctx.stroke();
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
  const air = o.z ?? 0;

  // the shadow staying put on the ground is what sells the hop
  shadow(ctx, wx, wy, 12 * (1 - Math.min(0.45, air / 90)), 0.3 * (1 - Math.min(0.5, air / 80)));

  if (o.shield) {
    ctx.save();
    ctx.translate(sx, sy - 22 - air);
    ctx.scale(1, 0.9);
    const pulse = 0.35 + Math.sin(performance.now() * 0.005) * 0.12;
    ctx.strokeStyle = 'rgba(127,168,224,' + pulse + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(127,168,224,0.10)';
    ctx.fill();
    ctx.restore();
  }
  if (o.spin) {
    ctx.save();
    ctx.translate(sx, sy - air);
    ctx.scale(1, 0.5);
    ctx.strokeStyle = 'rgba(224,106,90,0.55)';
    ctx.lineWidth = 4;
    const a = performance.now() * 0.02;
    ctx.beginPath(); ctx.arc(0, 0, 46, a, a + 2.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 46, a + Math.PI, a + Math.PI + 2.4); ctx.stroke();
    ctx.restore();
  }
  if (o.cast && o.cast > 0) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, 0.42);
    ctx.strokeStyle = 'rgba(157,123,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.cast);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(157,123,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  const bob = Math.sin(walkT * 12) * 2.2;
  const H = 42 * app.height;
  const bodyW = 15 + app.build * 6;
  const faceAway = Math.sin(facing) < -0.4;
  const cosF = Math.cos(facing);

  ctx.save();
  ctx.translate(sx, sy - bob - air);

  if (o.iframes && o.iframes > 0) ctx.globalAlpha = 0.45 + Math.sin(performance.now() * 0.05) * 0.25;
  else if (hurt > 0) ctx.globalAlpha = 0.55 + Math.sin(hurt * 70) * 0.35;

  const swingP = swing > 0 ? 1 - swing / swingMax : -1;
  // rest position: weapon held out to the character's right
  const restAng = facing - 1.05;
  const weaponAng = swingP >= 0
    ? facing - 1.25 + swingP * 2.5
    : restAng;
  const shieldAng = facing - 1.0;

  // ---- the tool rides on your back unless it is doing the work
  const harvesting = swingP >= 0 && !gear.weapon;
  if (gear.tool && !harvesting) {
    ctx.save();
    ctx.translate(0, -H * 0.55);
    ctx.rotate(-0.9);
    ctx.globalAlpha = 0.9;
    drawWeapon(ctx, gear.tool, 0, 0.72);
    ctx.restore();
  }

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
  const [sx, sy0] = toScreen(m.x, m.y);
  const sy = sy0 - m.gz;
  const dying = m.state === 'dead';
  const alpha = dying ? Math.max(0, 1 - m.dead / 1.2) : 1;
  shadow(ctx, m.x, m.y - m.gz, d.size * 0.85, 0.25 * alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  if (m.slowT > 0) {
    ctx.shadowColor = '#7fc2e0';
    ctx.shadowBlur = 12;
  }
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
  } else if (d.family === 'boss') {
    drawBoss(ctx, d.id, d.size, body, d.accent, flash, m.facing);
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
  }
  ctx.restore();

  if (!dying && m.hp < m.maxHp && d.family !== 'boss') {
    const w = Math.max(26, d.size * 2.2);
    const y = sy - d.size * 2.9 - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(sx - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = '#c8534b';
    ctx.fillRect(sx - w / 2, y, w * Math.max(0, m.hp / m.maxHp), 4);
  }
  if (!dying && m.windup > 0 && !d.attacks) {
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

/** Bosses are big enough to deserve their own silhouettes. */
function drawBoss(
  ctx: CanvasRenderingContext2D, id: string, size: number,
  body: string, accent: string, flash: boolean, facing: number,
): void {
  const face = Math.cos(facing) >= 0 ? 1 : -1;
  const t = performance.now() * 0.003;

  if (id === 'grovewarden' || id === 'fangmaw') {
    // four legs, heavy shoulders, low head
    ctx.fillStyle = shade(body, -46);
    for (const lx of [-size * 0.7, -size * 0.25, size * 0.25, size * 0.7]) {
      roundRect(ctx, lx - 3.5, -16, 7, 16, 3); ctx.fill();
    }
    ctx.fillStyle = body;
    roundRect(ctx, -size, -size * 1.5, size * 2, size * 1.42, size * 0.55);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : shade(body, 20);
    roundRect(ctx, -size * 0.95, -size * 1.72, size * 0.95, size * 0.7, size * 0.34);
    ctx.fill();
    // head, hanging forward
    ctx.fillStyle = flash ? '#fff' : shade(body, -14);
    ctx.beginPath();
    ctx.ellipse(face * size * 0.92, -size * 1.02, size * 0.52, size * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(face * size * 1.22, -size * 1.12, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(face * size * 1.22, -size * 0.94, 3, 0, Math.PI * 2); ctx.fill();
    // ears
    ctx.fillStyle = shade(body, -30);
    ctx.beginPath(); ctx.arc(-size * 0.5, -size * 1.82, size * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(size * 0.1, -size * 1.86, size * 0.2, 0, Math.PI * 2); ctx.fill();
    return;
  }

  if (id === 'quarry_golem') {
    ctx.fillStyle = shade(body, -40);
    roundRect(ctx, -size * 0.62, -22, size * 0.48, 22, 5); ctx.fill();
    roundRect(ctx, size * 0.16, -22, size * 0.48, 22, 5); ctx.fill();
    ctx.fillStyle = body;
    roundRect(ctx, -size * 0.9, -size * 2.1, size * 1.8, size * 1.55, 10);
    ctx.fill();
    // slab arms
    ctx.fillStyle = shade(body, -16);
    roundRect(ctx, -size * 1.42, -size * 1.9, size * 0.55, size * 1.5, 9); ctx.fill();
    roundRect(ctx, size * 0.87, -size * 1.9, size * 0.55, size * 1.5, 9); ctx.fill();
    // head chunk
    ctx.fillStyle = flash ? '#fff' : shade(body, 16);
    roundRect(ctx, -size * 0.44, -size * 2.62, size * 0.88, size * 0.62, 6);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = 10;
    ctx.fillRect(-size * 0.3, -size * 2.42, size * 0.2, 5);
    ctx.fillRect(size * 0.1, -size * 2.42, size * 0.2, 5);
    // core
    ctx.beginPath();
    ctx.arc(0, -size * 1.25, 5 + Math.sin(t) * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    return;
  }

  if (id === 'emberwyrm') {
    // wings behind
    ctx.fillStyle = shade(body, -26);
    const flap = Math.sin(t * 1.3) * 0.22;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * size * 0.5, -size * 1.6);
      ctx.rotate(s * (0.5 + flap));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s * size * 1.5, -size * 0.9, s * size * 2.0, size * 0.25);
      ctx.quadraticCurveTo(s * size * 1.1, size * 0.1, 0, size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // tail
    ctx.strokeStyle = body;
    ctx.lineWidth = size * 0.34;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-face * size * 0.6, -size * 0.5);
    ctx.quadraticCurveTo(-face * size * 1.8, -size * 0.2 + Math.sin(t) * 6, -face * size * 2.4, -size * 0.9);
    ctx.stroke();
    // legs and body
    ctx.fillStyle = shade(body, -40);
    for (const lx of [-size * 0.5, size * 0.5]) { roundRect(ctx, lx - 5, -20, 10, 20, 4); ctx.fill(); }
    ctx.fillStyle = body;
    roundRect(ctx, -size * 0.8, -size * 1.7, size * 1.6, size * 1.5, size * 0.5);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : shade(body, 26);
    roundRect(ctx, -size * 0.5, -size * 1.35, size * 1.0, size * 0.9, size * 0.34);
    ctx.fill();
    // neck and head
    ctx.strokeStyle = body;
    ctx.lineWidth = size * 0.42;
    ctx.beginPath();
    ctx.moveTo(face * size * 0.4, -size * 1.5);
    ctx.quadraticCurveTo(face * size * 1.1, -size * 2.4, face * size * 1.5, -size * 2.1);
    ctx.stroke();
    ctx.fillStyle = flash ? '#fff' : shade(body, -8);
    ctx.beginPath();
    ctx.ellipse(face * size * 1.62, -size * 2.05, size * 0.46, size * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // horns and eye
    ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(face * size * 1.4, -size * 2.32);
    ctx.lineTo(face * size * 1.15, -size * 2.8);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.shadowColor = accent; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(face * size * 1.78, -size * 2.12, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    return;
  }

  // the Hollow King and anything else: tall, robed, crowned
  const H = size * 2.7;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, -H + 12);
  ctx.lineTo(size * 0.5, -H + 12);
  ctx.lineTo(size * 1.05, 0);
  ctx.lineTo(-size * 1.05, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = flash ? '#fff' : shade(body, 24);
  ctx.beginPath(); ctx.arc(0, -H + 4, size * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent; ctx.shadowBlur = 10;
  ctx.fillRect(-size * 0.24, -H + 2, size * 0.16, 4);
  ctx.fillRect(size * 0.08, -H + 2, size * 0.16, 4);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = accent; ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    const bx = i * size * 0.24;
    ctx.moveTo(bx, -H - 4);
    ctx.lineTo(bx, -H - 14 - Math.abs(i) * -3);
  }
  ctx.stroke();
}

/** Health bar with a name, pinned to the top of the screen. */
export function drawBossBar(
  ctx: CanvasRenderingContext2D, W: number, name: string, title: string, frac: number,
): void {
  const w = Math.min(560, W * 0.6);
  const x = (W - w) / 2;
  const y = 22;
  ctx.save();
  ctx.fillStyle = 'rgba(14,11,9,0.82)';
  roundRect(ctx, x - 10, y - 8, w + 20, 44, 9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,120,90,0.55)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 10, y - 8, w + 20, 44, 9);
  ctx.stroke();

  ctx.font = '700 14px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd7a8';
  ctx.fillText(name, x + w / 2, y + 6);
  if (title) {
    ctx.font = '600 10px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(220,190,160,0.7)';
    ctx.fillText(title.toUpperCase(), x + w / 2, y + 32);
  }

  ctx.fillStyle = '#241a16';
  roundRect(ctx, x, y + 12, w, 9, 5); ctx.fill();
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#d8483f');
  g.addColorStop(1, '#e88a3f');
  ctx.fillStyle = g;
  roundRect(ctx, x, y + 12, Math.max(2, w * Math.max(0, frac)), 9, 5);
  ctx.fill();
  ctx.restore();
}

export function drawNode(ctx: CanvasRenderingContext2D, n: Node): void {
  const [sx, sy0] = toScreen(n.x, n.y);
  const sy = sy0 - n.gz;
  if (n.respawn > 0) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = n.kind === 'tree' ? '#3d5c30' : '#5a5a5f';
    ctx.beginPath(); ctx.ellipse(sx, sy, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const flash = n.hitFlash > 0;
  shadow(ctx, n.x, n.y - n.gz, n.kind === 'tree' ? 16 : 13, 0.3);
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
  const [sx, sy0] = toScreen(dr.x, dr.y);
  const sy = sy0 - dr.gz;
  const def = ITEM_DEFS[dr.item.defId];
  shadow(ctx, dr.x, dr.y - dr.gz, 7, 0.22);
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
  ctx.fillText(z.nearExit ? '[X] back to town' : 'the road home', sx, sy - 52);
  ctx.restore();
}


// ------------------------------------------------------------------ terrain

export function drawChasm(ctx: CanvasRenderingContext2D, c: Chasm): void {
  ctx.save();
  ctx.fillStyle = '#100d12';
  roundRect(ctx, c.x, c.y, c.w, c.h, 16);
  ctx.fill();
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.5, 'rgba(30,22,30,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = g;
  roundRect(ctx, c.x, c.y, c.w, c.h, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 5;
  roundRect(ctx, c.x, c.y, c.w, c.h, 16);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 2;
  roundRect(ctx, c.x + 3, c.y + 3, c.w - 6, c.h - 6, 14);
  ctx.stroke();
  ctx.restore();
}

/** Raised ground: a flat top lifted by its own height, with a lit cliff face. */
export function drawPlateau(
  ctx: CanvasRenderingContext2D, p: Plateau, top: string, side: string,
): void {
  ctx.save();
  // the cliff face is the band between the real footprint and the lifted top
  ctx.fillStyle = side;
  roundRect(ctx, p.x, p.y + p.h - p.z - 14, p.w, p.z + 14, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(p.x, p.y + p.h - 6, p.w, 6);
  // strata
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = p.y + p.h - p.z; y < p.y + p.h; y += 7) {
    ctx.moveTo(p.x + 4, y); ctx.lineTo(p.x + p.w - 4, y);
  }
  ctx.stroke();
  // the walkable top
  ctx.fillStyle = top;
  roundRect(ctx, p.x, p.y - p.z, p.w, p.h, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  roundRect(ctx, p.x + 2, p.y - p.z + 2, p.w - 4, p.h - 4, 9);
  ctx.stroke();
  ctx.restore();
}

// -------------------------------------------------------------- undergrowth

export function drawFlora(ctx: CanvasRenderingContext2D, f: Flora, t: number): void {
  const x = f.x, y = f.y - f.gz;
  const sway = Math.sin(t * 1.4 + f.x * 0.03) * 1.6;
  switch (f.kind) {
    case 'grass':
      ctx.strokeStyle = ['#6f9a52', '#7fa85c', '#5f8a46', '#87b062'][f.variant];
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(x + i * 3, y);
        ctx.quadraticCurveTo(x + i * 3 + sway, y - 6, x + i * 4 + sway * 1.6, y - 11);
      }
      ctx.stroke();
      break;
    case 'flower': {
      const cols = ['#e0607a', '#e8c15a', '#8f7fe0', '#e88f5a'];
      ctx.strokeStyle = '#5f8a46'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sway, y - 9); ctx.stroke();
      ctx.fillStyle = cols[f.variant];
      ctx.beginPath(); ctx.arc(x + sway, y - 11, 2.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'mushroom':
      ctx.fillStyle = '#e8e0cf';
      ctx.fillRect(x - 1.4, y - 6, 2.8, 6);
      ctx.fillStyle = ['#c8564a', '#9a7fd0', '#c8964a', '#7aa85c'][f.variant];
      ctx.beginPath(); ctx.ellipse(x, y - 7, 5.4, 3.6, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(x - 1.6, y - 8.4, 0.9, 0, Math.PI * 2); ctx.fill();
      break;
    case 'fern':
      ctx.strokeStyle = ['#3f6b34', '#4a7a3e', '#356030', '#548a46'][f.variant];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + i * 6, y - 10, x + i * 9 + sway, y - 4);
      }
      ctx.stroke();
      break;
    case 'reed':
      ctx.strokeStyle = '#7a8a4a'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(x + i * 4, y);
        ctx.lineTo(x + i * 4 + sway * 2, y - 20 - i * 3);
      }
      ctx.stroke();
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(x - 1 + sway * 2, y - 26, 2.6, 7);
      break;
    case 'stump':
      shadow(ctx, f.x, f.y - f.gz, 11, 0.22);
      ctx.fillStyle = '#6b4a2a';
      roundRect(ctx, x - 10, y - 13, 20, 13, 4); ctx.fill();
      ctx.fillStyle = '#8a6440';
      ctx.beginPath(); ctx.ellipse(x, y - 13, 10, 4.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y - 13, 5.5, 2.4, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'crystal': {
      const cols = ['#57d4d0', '#9b7fe0', '#e8a33d', '#7fc2e0'];
      const c = cols[f.variant];
      ctx.fillStyle = c;
      ctx.shadowColor = c; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x, y - 20); ctx.lineTo(x + 5, y - 7); ctx.lineTo(x, y); ctx.lineTo(x - 5, y - 7);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
    case 'bone':
      ctx.fillStyle = '#cfc7ae';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(f.variant * 0.7);
      roundRect(ctx, -9, -2, 18, 4, 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-9, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
  }
}

export function drawCritter(ctx: CanvasRenderingContext2D, c: Critter, t: number): void {
  const x = c.x, y = c.y - c.z;
  switch (c.kind) {
    case 'butterfly': {
      const flap = Math.abs(Math.sin(t * 9 + c.t));
      ctx.fillStyle = '#f0e0a0';
      ctx.beginPath(); ctx.ellipse(x - 3, y - 18, 3.4 * flap + 1, 4, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8c15a';
      ctx.beginPath(); ctx.ellipse(x + 3, y - 18, 3.4 * flap + 1, 4, 0.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'firefly': {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.2 + c.t * 3));
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#9be0d2';
      ctx.shadowColor = '#9be0d2'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(x, y - 24, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
    }
    case 'bird': {
      const flap = Math.sin(t * 12 + c.t) * 5;
      shadow(ctx, c.x, c.y, 5, 0.15);
      ctx.strokeStyle = '#3a3a42';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 6 + flap);
      ctx.quadraticCurveTo(x, y - 12, x + 7, y - 6 + flap);
      ctx.stroke();
      break;
    }
    case 'rabbit': {
      shadow(ctx, c.x, c.y, 7, 0.2);
      const hop = c.flee > 0 ? Math.abs(Math.sin(t * 14)) * 6 : 0;
      ctx.fillStyle = '#a89880';
      roundRect(ctx, x - 7, y - 11 - hop, 14, 9, 4); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 6, y - 13 - hop, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8f8070';
      roundRect(ctx, x + 4, y - 22 - hop, 2.4, 8, 1.2); ctx.fill();
      roundRect(ctx, x + 7.5, y - 22 - hop, 2.4, 8, 1.2); ctx.fill();
      break;
    }
  }
}

export function drawTelegraph(ctx: CanvasRenderingContext2D, tg: Telegraph): void {
  const k = Math.min(1, tg.t / Math.max(0.01, tg.total));
  ctx.save();
  ctx.translate(tg.x, tg.y);
  ctx.scale(1, 0.62);
  const fill = 'rgba(228,90,60,' + (0.10 + k * 0.26) + ')';
  const line = 'rgba(255,140,100,' + (0.55 + k * 0.4) + ')';
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = 3;

  if (tg.kind === 'circle') {
    ctx.beginPath(); ctx.arc(0, 0, tg.r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, tg.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,160,110,0.30)';
    ctx.beginPath(); ctx.arc(0, 0, tg.r * k, 0, Math.PI * 2); ctx.fill();
  } else if (tg.kind === 'cone') {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, tg.r, tg.ang - tg.arc, tg.ang + tg.arc);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,160,110,0.28)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, tg.r * k, tg.ang - tg.arc, tg.ang + tg.arc);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.rotate(tg.ang);
    ctx.fillRect(0, -tg.wide / 2, tg.len, tg.wide);
    ctx.strokeRect(0, -tg.wide / 2, tg.len, tg.wide);
    ctx.fillStyle = 'rgba(255,160,110,0.28)';
    ctx.fillRect(0, -tg.wide / 2, tg.len * k, tg.wide);
  }
  ctx.restore();
}

export function drawMote(ctx: CanvasRenderingContext2D, m: Mote, color: string, t: number): void {
  const k = Math.sin((m.t / m.life) * Math.PI);
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.4 * k;
  ctx.fillStyle = color;
  const drift = Math.sin(t * 0.9 + m.x * 0.01) * 4;
  ctx.beginPath();
  ctx.arc(m.x + drift, m.y - m.z, m.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ backdrop

/** Parallax silhouettes behind the world. Screen space, drawn before anything. */
/**
 * Distant scenery, drawn in world space just past the northern edge of the map
 * so it sits behind the ground instead of being covered by it. The horizontal
 * offset fakes parallax without leaving world coordinates.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D, mapW: number, kind: Backdrop,
  camX: number, skyTop: string, skyBottom: string,
): void {
  const x0 = -1400, x1 = mapW + 1400;
  const horizon = 30;
  const sky = ctx.createLinearGradient(0, -1100, 0, horizon);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(x0, -1100, x1 - x0, 1100 + horizon);
  if (kind === 'none') return;

  const layers: { par: number; h: number; col: string; jag: number; step: number }[] =
    kind === 'peaks' ? [
      { par: 0.06, h: 640, col: 'rgba(96,90,124,0.72)', jag: 300, step: 420 },
      { par: 0.13, h: 470, col: 'rgba(72,64,92,0.86)', jag: 230, step: 300 },
      { par: 0.22, h: 300, col: 'rgba(48,42,58,0.96)', jag: 150, step: 210 },
    ] : kind === 'crags' ? [
      { par: 0.07, h: 480, col: 'rgba(88,92,100,0.7)', jag: 180, step: 320 },
      { par: 0.16, h: 300, col: 'rgba(56,60,66,0.9)', jag: 120, step: 220 },
    ] : kind === 'mountains' ? [
      { par: 0.07, h: 540, col: 'rgba(100,108,128,0.72)', jag: 260, step: 360 },
      { par: 0.16, h: 340, col: 'rgba(62,70,84,0.9)', jag: 170, step: 240 },
    ] : [
      { par: 0.08, h: 300, col: 'rgba(96,120,96,0.62)', jag: 90, step: 360 },
      { par: 0.17, h: 190, col: 'rgba(68,90,70,0.82)', jag: 60, step: 250 },
    ];

  for (const L of layers) {
    const off = -camX * L.par;
    const base = horizon;
    ctx.fillStyle = L.col;
    ctx.beginPath();
    ctx.moveTo(x0, base);
    const startX = Math.floor((x0 - off) / L.step) * L.step;
    for (let x = startX; x < x1 - off + L.step * 2; x += L.step) {
      const sx = x + off;
      const seed = Math.sin(x * 0.0031) * 0.5 + 0.5;
      const seed2 = Math.sin(x * 0.0073 + 2) * 0.5 + 0.5;
      ctx.lineTo(sx, base - L.h * (0.35 + seed * 0.25));
      ctx.lineTo(sx + L.step * 0.5, base - L.h * (0.6 + seed2 * 0.4) - L.jag * 0.15);
    }
    ctx.lineTo(x1, base);
    ctx.closePath();
    ctx.fill();
    if (kind === 'peaks' && L.par < 0.1) {
      ctx.fillStyle = 'rgba(230,235,245,0.55)';
      for (let x = startX; x < x1 - off + L.step * 2; x += L.step) {
        const sx = x + off + L.step * 0.5;
        const seed2 = Math.sin(x * 0.0073 + 2) * 0.5 + 0.5;
        const peak = base - L.h * (0.6 + seed2 * 0.4) - L.jag * 0.15;
        ctx.beginPath();
        ctx.moveTo(sx, peak);
        ctx.lineTo(sx + 42, peak + 62);
        ctx.lineTo(sx - 42, peak + 62);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}
