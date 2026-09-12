import './style.css';

import { applyCamera, clampCamera, screenToWorldPoint, Camera, TS } from './render/view';
import {
  drawBorder, drawDrop, drawExitPad, drawGround, drawHero, drawMob, drawNode,
  drawPopup, drawProjectile, drawSlash,
} from './render/draw';
import { Town, buildTown, drawTown, nearestBuilding, tickTown } from './game/town';
import { Zone, buildZone, tickZone } from './game/zone';
import {
  GameState, derived, die, load, newGame, pushLog, save, tickHomestead, wipe,
} from './game/state';
import { drawHud } from './ui/hud';
import { closePanel, openPanel, panelOpen, refreshPanel, restockShop, UICtx } from './ui/panels';
import { clear, el, toast } from './ui/dom';
import { cancelDrag } from './ui/grid';
import { TRAITS } from './game/bloodline';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let W = 0, H = 0, DPR = 1;

function resize(): void {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
}
resize();
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ state

let st: GameState | null = null;
let town: Town | null = null;
let zone: Zone | null = null;
const cam: Camera = { x: 0, y: 0, zoom: 1 };

/** Chunky JRPG scale, but never so tight that a wolf can charge in unseen. */
function targetZoom(): number {
  return Math.max(1.3, Math.min(2.1, Math.min(W, H) / 520));
}
let walkT = 0;

const keys = new Set<string>();
let mouseX = 0, mouseY = 0;
let mouseDown = false;

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'tab') { e.preventDefault(); toggle('bag'); }
  else if (k === 'c') { if (st && st.scene !== 'creation') toggle('char'); }
  else if (k === 'escape') { if (panelOpen()) { cancelDrag(); closePanel(); } }
  else if (k === 'e') { interact(); }
  else if (k === 'm') { if (st && st.scene === 'town') toggle('gate'); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
window.addEventListener('mouseup', () => { mouseDown = false; });
window.addEventListener('blur', () => { mouseDown = false; });
document.addEventListener('mouseleave', () => { mouseDown = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { mouseDown = false; keys.clear(); } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function uiCtx(): UICtx {
  return {
    st: st!,
    close: closePanel,
    refresh: () => { if (st) drawHud(st, st.scene === 'zone' ? 'zone' : 'town'); },
    travel: (zoneId, boss) => startRun(zoneId, boss),
    save: () => { if (st) save(st); },
  };
}

function toggle(kind: 'bag' | 'char' | 'gate'): void {
  if (!st || st.scene === 'creation' || st.scene === 'death') return;
  if (panelOpen()) { cancelDrag(); closePanel(); return; }
  openPanel(kind, uiCtx());
}

function interact(): void {
  if (!st || panelOpen()) return;
  if (st.scene === 'zone' && zone) {
    if (zone.nearExit) returnToTown();
    return;
  }
  if (st.scene !== 'town' || !town) return;
  const b = nearestBuilding(town);
  if (!b) return;
  const map = { guild: 'guild', shop: 'shop', smith: 'smith', home: 'home', gate: 'gate' } as const;
  openPanel(map[b.id], uiCtx());
}

// ----------------------------------------------------------------- scenes

function startRun(zoneId: string, boss?: string): void {
  if (!st) return;
  st.zoneId = zoneId;
  zone = buildZone(zoneId, st, boss);
  st.scene = 'zone';
  pushLog(st, 'You set out for ' + zone.def.name + '.', 'info');
  save(st);
}

function returnToTown(): void {
  if (!st) return;
  st.scene = 'town';
  zone = null;
  town = buildTown(st);
  // arrive at the gate
  const gate = town.buildings.find((b) => b.id === 'gate')!;
  town.px = gate.x + gate.w / 2;
  town.py = gate.y + gate.d + 40;
  restockShop(st);
  save(st);
}

function onDeath(cause: string): void {
  if (!st) return;
  st.scene = 'death';
  zone = null;
  pushLog(st, st.hero.name + ' was killed by ' + cause + '.', 'bad');
  save(st);
  showDeath(cause);
}

// -------------------------------------------------------------- creation

function showCreation(): void {
  const overlay = document.getElementById('overlay')!;
  clear(overlay);
  const scrim = el('div', { class: 'scrim' });
  const box = el('div', { class: 'big' });
  box.append(
    el('h1', {}, 'HEIRLOOM'),
    el('p', { class: 'lead' },
      'A life is short and mostly unlucky. A bloodline is long. Choose what the first of your name was good at.'),
  );
  const cards = el('div', { class: 'classcards' });

  const mk = (id: 'warrior' | 'wizard', name: string, desc: string, bits: string) => {
    const c = el('div', { class: 'classcard' });
    c.append(el('h3', {}, name), el('p', {}, desc), el('div', { class: 'muted' }, bits));
    c.addEventListener('click', () => {
      st = newGame(id);
      town = buildTown(st);
      clear(overlay);
      save(st);
      toast('The ' + st.hero.name.split(' ').pop() + ' line begins');
    });
    return c;
  };
  cards.append(
    mk('warrior', 'Warrior',
      'Steel in hand, close enough to smell the boar. Swings, bleeds, endures.',
      'STR 8 · VIT 8 · starts with a shortsword'),
    mk('wizard', 'Wizard',
      'Bolts from a safe distance, as long as the mana holds and nothing gets close.',
      'INT 9 · starts with an apprentice staff'),
  );
  box.append(cards);

  const traitList = el('div', { class: 'muted', style: 'margin-top:20px' },
    'Every heir is rolled fresh: attributes, looks, and one trait out of ' + TRAITS.length + '. Some of them are gifts.');
  box.append(traitList);

  const cont = document.createElement('div');
  cont.style.marginTop = '14px';
  const wipeBtn = el('button', { class: 'btn small danger' }, 'Erase saved bloodline');
  wipeBtn.addEventListener('click', () => { wipe(); toast('Save erased'); });
  cont.append(wipeBtn);
  box.append(cont);

  scrim.append(box);
  overlay.append(scrim);
}

// ------------------------------------------------------------------ death

function showDeath(cause: string): void {
  const overlay = document.getElementById('overlay')!;
  clear(overlay);
  const scrim = el('div', { class: 'scrim' });
  const box = el('div', { class: 'big death' });
  const s = st!;
  box.append(
    el('h1', {}, 'YOU DIED'),
    el('p', { class: 'epitaph' },
      s.hero.name + ', generation ' + s.generation + ', killed by ' + cause + '. ' +
      s.lifetime.kills + ' kills, ' + s.lifetime.questsDone + ' contracts, ' +
      Math.round((Date.now() - s.lifetime.born) / 60000) + ' minutes of life.'),
  );

  const keep = el('div', { class: 'heirbox' });
  keep.append(el('h3', { style: 'margin:0 0 10px' }, 'What survives you'));
  keep.append(el('div', { class: 'muted' }, '▸ A quarter of every skill, passed down as instinct.'));
  keep.append(el('div', { class: 'muted' }, '▸ Everything in the heirloom chest at home (' + s.chest.items.length + ' items).'));
  keep.append(el('div', { class: 'muted' }, '▸ The homestead: plots, hired hands and stores.'));
  keep.append(el('div', { class: 'muted' }, '▸ A quarter of your coin, ' + Math.round(s.gold * 0.25) + 'g, found under the floor.'));
  keep.append(el('div', { class: 'sep' }));
  keep.append(el('div', { class: 'warn' }, '▸ Your pack and everything in it is buried with you.'));
  if (s.donated > 0) {
    keep.append(el('div', { class: 'muted' }, '▸ ' + s.village.name + ' remembers the ' + s.donated + 'g you gave.'));
  }
  box.append(keep);

  const b = el('button', { class: 'btn primary', style: 'margin-top:22px;padding:12px 26px;font-size:14px' },
    'Years pass…');
  b.addEventListener('click', () => {
    die(s, cause);
    town = buildTown(s);
    clear(overlay);
    save(s);
    toast(s.hero.name + ' takes up the name');
    showHeirIntro();
  });
  box.append(b);
  scrim.append(box);
  overlay.append(scrim);
}

function showHeirIntro(): void {
  const s = st!;
  const overlay = document.getElementById('overlay')!;
  const scrim = el('div', { class: 'scrim' });
  const box = el('div', { class: 'big' });
  const d = derived(s);
  box.append(
    el('h1', { style: 'font-size:30px' }, s.hero.name),
    el('p', { class: 'lead' }, 'Generation ' + s.generation + ' of the line, in ' + s.village.name +
      ' — a ' + s.village.preset + ' village these days.'),
  );
  const grid = el('div', { class: 'heirbox' });
  const row = (k: string, v: string) => el('div', { class: 'srow' }, el('span', {}, k), el('b', {}, v));
  grid.append(
    row('Strength', String(s.hero.stats.str)),
    row('Intellect', String(s.hero.stats.int)),
    row('Vitality', String(s.hero.stats.vit)),
    row('Agility', String(s.hero.stats.agi)),
    row('Luck', String(s.hero.stats.luck)),
    el('div', { class: 'sep' }),
    el('div', { class: 't', style: 'font-weight:700;color:' + (s.hero.trait.good ? '#8fd07a' : '#e0a25a') }, s.hero.trait.name),
    el('div', { class: 'muted' }, s.hero.trait.desc),
    el('div', { class: 'sep' }),
    row('Max health', String(d.maxHp)),
    row('Inherited skill', Object.keys(s.legacy.legacy).length + ' disciplines'),
  );
  box.append(grid);
  const b = el('button', { class: 'btn primary', style: 'margin-top:20px;padding:11px 24px' }, 'Take up the name');
  b.addEventListener('click', () => { clear(overlay); });
  box.append(b);
  scrim.append(box);
  overlay.append(scrim);
}

// ------------------------------------------------------------------- loop

function moveVector(): [number, number] {
  let ix = 0, iy = 0;
  if (keys.has('w') || keys.has('arrowup')) iy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) iy += 1;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (ix === 0 && iy === 0) return [0, 0];
  const l = Math.hypot(ix, iy);
  return [ix / l, iy / l];
}

let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(DPR, DPR);

  if (!st) {
    paintBackdrop();
    requestAnimationFrame(frame);
    return;
  }

  tickHomestead(st, dt);
  st.lastRealTick = Date.now();

  if (st.scene === 'town' && town) {
    const blocked = panelOpen();
    const [mx, my] = blocked ? [0, 0] : moveVector();
    if (mx || my) walkT += dt;
    town.walkT = walkT;
    const d = derived(st);
    tickTown(town, dt, mx, my, d.speed * 0.85);
    cam.zoom = targetZoom();
    cam.x = town.px; cam.y = town.py;
    clampCamera(cam, town.w * TS, town.h * TS, W, H);
    ctx.save();
    applyCamera(ctx, cam, W, H);
    drawTown(ctx, town, st, blocked ? null : nearestBuilding(town));
    ctx.restore();
    drawHud(st, 'town');
    // gentle out-of-combat regen
    st.hp = Math.min(d.maxHp, st.hp + dt * 1.2);
    st.mana = Math.min(d.maxMana, st.mana + dt * 3);
  } else if (st.scene === 'zone' && zone) {
    const blocked = panelOpen();
    const [mx, my] = blocked ? [0, 0] : moveVector();
    if (mx || my) walkT += dt;

    // face the cursor
    if (!blocked) {
      const [wx, wy] = screenToWorldPoint(cam, W, H, mouseX, mouseY);
      const dx = wx - zone.px, dy = wy - zone.py;
      if (Math.hypot(dx, dy) > 6) zone.facing = Math.atan2(dy, dx);
    }

    const attack = !blocked && (keys.has(' ') || mouseDown);
    tickZone(zone, st, dt, { mx, my, attack }, {
      onDeath: (cause) => onDeath(cause),
      onExit: returnToTown,
    });

    if (st.scene === 'zone' && zone) {
      cam.zoom = targetZoom();
      cam.x += (zone.px - cam.x) * Math.min(1, dt * 8);
      cam.y += (zone.py - cam.y) * Math.min(1, dt * 8);
      clampCamera(cam, zone.def.w * TS, zone.def.h * TS, W, H);
      ctx.save();
      applyCamera(ctx, cam, W, H);
      renderZone(zone, st);
      ctx.restore();
      drawHud(st, 'zone');
      if (zone.hurtT > 0) {
        ctx.fillStyle = 'rgba(180,40,30,' + (zone.hurtT * 0.9) + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }
  } else if (st.scene === 'creation') {
    paintBackdrop();
  } else {
    paintBackdrop();
  }

  requestAnimationFrame(frame);
}

function renderZone(z: Zone, s: GameState): void {
  drawGround(ctx, z.def.w, z.def.h, z.tiles, z.def.ground, z.def.ground2, 0);
  drawBorder(ctx, z.def.w, z.def.h);
  drawExitPad(ctx, z);

  type R = { d: number; f: () => void };
  const list: R[] = [];
  for (const n of z.nodes) list.push({ d: n.y, f: () => drawNode(ctx, n) });
  for (const m of z.mobs) list.push({ d: m.y, f: () => drawMob(ctx, m) });
  for (const dr of z.drops) list.push({ d: dr.y, f: () => drawDrop(ctx, dr) });
  list.push({
    d: z.py,
    f: () => drawHero(ctx, z.px, z.py, s.hero.appearance, z.facing, walkT, z.hurtT, z.swingT),
  });
  list.sort((a, b) => a.d - b.d);
  for (const r of list) r.f();

  for (const sl of z.slashes) drawSlash(ctx, sl);
  for (const p of z.projectiles) drawProjectile(ctx, p);
  for (const p of z.popups) drawPopup(ctx, p);
}

function paintBackdrop(): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#241d18');
  g.addColorStop(1, '#12100e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const t = performance.now() * 0.0002;
  ctx.save();
  ctx.globalAlpha = 0.09;
  for (let i = 0; i < 26; i++) {
    const a = t + i;
    const x = (Math.sin(a * 1.7 + i) * 0.5 + 0.5) * W;
    const y = (Math.cos(a * 1.3 + i * 2) * 0.5 + 0.5) * H;
    ctx.fillStyle = '#e0b64f';
    ctx.beginPath();
    ctx.arc(x, y, 40 + i, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------- boot

function boot(): void {
  const loaded = load();
  if (loaded) {
    st = loaded;
    // hands kept working while the tab was closed
    const away = Math.min(8 * 3600, (Date.now() - (loaded.lastRealTick || Date.now())) / 1000);
    if (away > 30) {
      const before = { ...loaded.homestead.resources };
      tickHomestead(loaded, away);
      const gained = Object.entries(loaded.homestead.resources)
        .map(([k, v]) => [k, Math.round(v - (before[k] ?? 0))] as [string, number])
        .filter(([, v]) => v > 0);
      if (gained.length) {
        toast('While you were away your hands brought in ' +
          gained.map(([k, v]) => v + ' ' + k).join(', '), 4200);
      }
    }
    if (st.scene === 'death') { showDeath('unknown causes'); }
    else { st.scene = 'town'; town = buildTown(st); }
  } else {
    showCreation();
  }
  setInterval(() => { if (st) save(st); }, 5000);
  requestAnimationFrame(frame);
}

boot();

// dev helper
(window as unknown as Record<string, unknown>).HEIRLOOM = {
  get state() { return st; },
  get town() { return town; },
  get zone() { return zone; },
  keys,
  wipe: () => { wipe(); location.reload(); },
  refreshPanel,
};
