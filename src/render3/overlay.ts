import * as THREE from 'three';
import { SCALE } from './core';
import type { Zone } from '../game/zone';
import type { Interact } from '../game/town';

/**
 * A flat canvas over the 3D one. Damage numbers, world labels, the crosshair
 * and the boss bar all live here, projected from world space, because text is
 * still much cheaper and crisper in 2D.
 */
export class Overlay {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  private v = new THREE.Vector3();

  constructor(cv: HTMLCanvasElement) {
    this.cv = cv;
    this.ctx = cv.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w; this.h = h;
    this.cv.width = Math.floor(w * this.dpr);
    this.cv.height = Math.floor(h * this.dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
  }

  begin(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.scale(this.dpr, this.dpr);
  }

  /** World (sim x, sim y, sim height) to screen. Returns null when behind you. */
  project(cam: THREE.Camera, sx: number, sy: number, sz: number): [number, number, number] | null {
    this.v.set(sx * SCALE, sz * SCALE, sy * SCALE);
    const dist = this.v.distanceTo(cam.position);
    this.v.project(cam);
    if (this.v.z > 1) return null;
    return [(this.v.x * 0.5 + 0.5) * this.w, (-this.v.y * 0.5 + 0.5) * this.h, dist];
  }

  crosshair(hot: boolean, casting: number): void {
    const c = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    c.save();
    c.strokeStyle = hot ? 'rgba(255,220,150,0.95)' : 'rgba(255,255,255,0.65)';
    c.lineWidth = 2;
    const gap = 5 + (casting > 0 ? casting * 9 : 0);
    const len = 7;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
      c.beginPath();
      c.moveTo(cx + dx * gap, cy + dy * gap);
      c.lineTo(cx + dx * (gap + len), cy + dy * (gap + len));
      c.stroke();
    }
    c.fillStyle = hot ? 'rgba(255,220,150,0.9)' : 'rgba(255,255,255,0.5)';
    c.beginPath(); c.arc(cx, cy, 1.6, 0, Math.PI * 2); c.fill();
    if (casting > 0) {
      c.strokeStyle = 'rgba(157,123,255,0.9)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * casting);
      c.stroke();
    }
    c.restore();
  }

  popups(cam: THREE.Camera, z: Zone): void {
    const c = this.ctx;
    for (const p of z.popups) {
      const s = this.project(cam, p.x, p.y, 40);
      if (!s) continue;
      const [x, y, dist] = s;
      const k = p.t / p.life;
      const a = Math.max(0, 1 - k * k);
      const scale = Math.max(0.45, Math.min(1.25, 14 / Math.max(2, dist)));
      c.save();
      c.globalAlpha = a;
      c.translate(x, y - p.t * 34);
      c.scale(scale, scale);
      c.font = '800 ' + p.size + 'px ui-monospace, SFMono-Regular, monospace';
      c.textAlign = 'center';
      c.lineWidth = 3.5;
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.strokeText(p.text, 0, 0);
      c.fillStyle = p.color;
      c.fillText(p.text, 0, 0);
      c.restore();
    }
  }

  /** Health pips over anything hurt, so you can tell what you are fighting. */
  mobBars(cam: THREE.Camera, z: Zone, sizes: (defId: string) => number, bossUid: string | null): void {
    const c = this.ctx;
    for (const m of z.mobs) {
      if (m.state === 'dead' || m.hp >= m.maxHp) continue;
      if (m.uid === bossUid) continue;
      const s = this.project(cam, m.x, m.y, m.gz + sizes(m.defId) * 2.6);
      if (!s) continue;
      const [x, y, dist] = s;
      if (dist > 60) continue;
      const w = Math.max(26, 900 / Math.max(6, dist));
      c.save();
      c.globalAlpha = Math.max(0.25, 1 - dist / 70);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
      c.fillStyle = '#c8534b';
      c.fillRect(x - w / 2, y, w * Math.max(0, m.hp / m.maxHp), 4);
      c.restore();
    }
  }

  worldLabel(
    cam: THREE.Camera, sx: number, sy: number, sz: number,
    title: string, prompt: string | null, hot: boolean,
  ): void {
    const s = this.project(cam, sx, sy, sz);
    if (!s) return;
    const [x, y, dist] = s;
    if (dist > 46) return;
    const c = this.ctx;
    c.save();
    c.globalAlpha = Math.max(0.15, Math.min(1, 1.6 - dist / 34));
    c.font = '600 13px ui-sans-serif, system-ui';
    c.textAlign = 'center';
    const tw = c.measureText(title).width;
    c.fillStyle = 'rgba(20,17,14,0.75)';
    round(c, x - tw / 2 - 9, y - 15, tw + 18, 21, 6);
    c.fill();
    c.fillStyle = hot ? '#ffe28a' : '#eee6d6';
    c.fillText(title, x, y);
    if (prompt && hot) {
      c.font = '700 12px ui-sans-serif, system-ui';
      const pt = '[E] ' + prompt;
      const pw = c.measureText(pt).width;
      c.fillStyle = 'rgba(20,17,14,0.82)';
      round(c, x - pw / 2 - 9, y + 10, pw + 18, 20, 6);
      c.fill();
      c.fillStyle = '#ffe28a';
      c.fillText(pt, x, y + 24);
    }
    c.restore();
  }

  townLabels(cam: THREE.Camera, town: { buildings: { name: string; prompt: string | null; key: string; x: number; y: number; w: number; d: number }[]; npcs: { id: string; name: string; x: number; y: number; kind: string }[] }, near: Interact): void {
    for (const b of town.buildings) {
      if (!b.name) continue;
      const hot = near?.kind === 'building' && near.b.key === b.key;
      this.worldLabel(cam, b.x + b.w / 2, b.y + b.d / 2, 90, b.name, b.prompt, hot);
    }
    for (const n of town.npcs) {
      const hot = near?.kind === 'npc' && near.n.id === n.id;
      if (!hot) continue;
      this.worldLabel(cam, n.x, n.y, n.kind === 'cat' ? 24 : 46, n.name, 'talk', true);
    }
  }

  bossBar(name: string, title: string, frac: number): void {
    const c = this.ctx;
    const w = Math.min(560, this.w * 0.6);
    const x = (this.w - w) / 2;
    const y = 22;
    c.save();
    c.fillStyle = 'rgba(14,11,9,0.82)';
    round(c, x - 10, y - 8, w + 20, 44, 9); c.fill();
    c.strokeStyle = 'rgba(200,120,90,0.55)';
    c.lineWidth = 1.5;
    round(c, x - 10, y - 8, w + 20, 44, 9); c.stroke();
    c.font = '700 14px Cinzel, Georgia, serif';
    c.textAlign = 'center';
    c.fillStyle = '#ffd7a8';
    c.fillText(name, x + w / 2, y + 6);
    if (title) {
      c.font = '600 10px ui-sans-serif, system-ui';
      c.fillStyle = 'rgba(220,190,160,0.7)';
      c.fillText(title.toUpperCase(), x + w / 2, y + 32);
    }
    c.fillStyle = '#241a16';
    round(c, x, y + 12, w, 9, 5); c.fill();
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#d8483f');
    g.addColorStop(1, '#e88a3f');
    c.fillStyle = g;
    round(c, x, y + 12, Math.max(2, w * Math.max(0, frac)), 9, 5); c.fill();
    c.restore();
  }

  flash(color: string, alpha: number): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.save();
    c.globalAlpha = Math.min(1, alpha);
    c.fillStyle = color;
    c.fillRect(0, 0, this.w, this.h);
    c.restore();
  }

  /** A soft red frame when you are nearly dead. */
  lowHealth(k: number): void {
    if (k <= 0) return;
    const c = this.ctx;
    const g = c.createRadialGradient(
      this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.28,
      this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.66,
    );
    g.addColorStop(0, 'rgba(150,20,20,0)');
    g.addColorStop(1, 'rgba(150,20,20,' + (0.5 * k) + ')');
    c.save();
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
    c.restore();
  }

  hint(text: string): void {
    const c = this.ctx;
    c.save();
    c.font = '600 14px ui-sans-serif, system-ui';
    c.textAlign = 'center';
    const w = c.measureText(text).width;
    c.fillStyle = 'rgba(14,11,9,0.72)';
    round(c, this.w / 2 - w / 2 - 14, this.h * 0.62, w + 28, 30, 8);
    c.fill();
    c.fillStyle = '#efe6d4';
    c.fillText(text, this.w / 2, this.h * 0.62 + 20);
    c.restore();
  }
}

function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
