import './style.css';

import { applyCamera, clampCamera, screenToWorldPoint, Camera, TS } from './render/view';
import {
  drawBackdrop, drawBorder, drawBossBar, drawChasm, drawCritter, drawDashTrail, drawDrop,
  drawExitPad, drawFlora, drawGround, drawHero, drawMob, drawMote, drawNode, drawParticle,
  drawPlateau, drawPopup, drawProjectile, drawSlash, drawTelegraph,
} from './render/draw';
import { gearLook, swingPiece } from './render/look';
import {
  Town, buildTown, drawTown, drawTownAmbience, nearestInteract, tickTown,
} from './game/town';
import { Zone, bossMob, buildZone, castAbility, tickZone, tryDash, tryJump } from './game/zone';
import { MONSTERS } from './game/content';
import type { AbilityKey } from './game/abilities';
import {
  GameState, derived, die, lastMemoryEarned, load, newGame, pushLog, save,
  tickHomestead, wipe,
} from './game/state';
import { drawHud, resetHud } from './ui/hud';
import {
  closePanel, openPanel, panelOpen, refreshPanel, restCost, restockShop, setShopTab, UICtx,
} from './ui/panels';
import { closeDialogue, dialogueOpen, openDialogue } from './ui/dialogue';
import { guildTalk, innRumour, innTalk, shopTalk, smithTalk, townsfolkTalk } from './ui/talk';
import { clear, el, toast } from './ui/dom';
import { cancelDrag } from './ui/grid';
import { TRAITS } from './game/bloodline';
import { TECHNIQUES } from './game/techniques';

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
let walkT = 0;

const keys = new Set<string>();
let mouseX = 0, mouseY = 0;
let mouseDown = false;

/** Anything modal is open: panels or a conversation. */
function uiBlocking(): boolean {
  return panelOpen() || dialogueOpen();
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (dialogueOpen()) return;           // the dialogue owns its own keys
  const inZone = st && st.scene === 'zone' && zone && !uiBlocking();
  // Abilities live on Q E R F because W A S D are the feet. 1-4 work as well.
  const NUM_TO_KEY: Record<string, AbilityKey> = { '1': 'q', '2': 'f', '3': 'e', '4': 'r' };
  const abilKey = NUM_TO_KEY[k] ?? (k === 'q' || k === 'e' || k === 'r' || k === 'f' ? k as AbilityKey : null);
  if (inZone && abilKey) {
    const [wx, wy] = screenToWorldPoint(cam, W, H, mouseX, mouseY);
    castAbility(zone!, st!, abilKey, wx, wy);
    return;
  }
  if (k === 'tab') { e.preventDefault(); toggle('bag'); }
  else if (k === 'c') { if (!inZone) toggle('char'); }
  else if (k === 'k') { if (!inZone) toggle('tech'); }
  else if (k === 'escape') { if (panelOpen()) { cancelDrag(); closePanel(); } }
  else if (k === 'e') { interact(); }
  else if (k === 'x') { interact(); }
  else if (k === 'm') { if (st && st.scene === 'town') toggle('gate'); }
  else if (k === ' ') {
    e.preventDefault();
    if (st && st.scene === 'zone' && zone && !uiBlocking()) tryJump(zone, st);
  } else if (k === 'shift') {
    if (st && st.scene === 'zone' && zone && !uiBlocking()) {
      const [mx, my] = moveVector();
      tryDash(zone, st, mx, my);
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; });
document.addEventListener('mouseleave', () => { mouseDown = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { mouseDown = false; keys.clear(); }
});

canvas.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2 && st && st.scene === 'zone' && zone && !uiBlocking()) {
    const [mx, my] = moveVector();
    tryDash(zone, st, mx, my);
  }
});
window.addEventListener('mouseup', () => { mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function uiCtx(): UICtx {
  return {
    st: st!,
    close: closePanel,
    refresh: () => { if (st) drawHud(st, st.scene === 'zone' ? 'zone' : 'town', zone); },
    travel: (zoneId, boss) => startRun(zoneId, boss),
    save: () => { if (st) save(st); },
  };
}

function toggle(kind: 'bag' | 'char' | 'tech' | 'gate'): void {
  if (!st || st.scene === 'creation' || st.scene === 'death') return;
  if (dialogueOpen()) return;
  if (panelOpen()) { cancelDrag(); closePanel(); return; }
  openPanel(kind, uiCtx());
}

// --------------------------------------------------------------- buildings

function interact(): void {
  if (!st || uiBlocking()) return;
  if (st.scene === 'zone' && zone) {
    if (zone.nearExit) returnToTown();
    return;
  }
  if (st.scene !== 'town' || !town) return;
  const hit = nearestInteract(town);
  if (!hit) return;
  const c = uiCtx();
  const leave = () => { closeDialogue(); };

  if (hit.kind === 'npc') {
    openDialogue(townsfolkTalk(hit.n, st, leave));
    return;
  }

  const b = hit.b;
  switch (b.id) {
    case 'guild':
      openDialogue(guildTalk(st, {
        board: () => { closeDialogue(); openPanel('guild', c); },
        turnIn: () => { closeDialogue(); openPanel('guild', c); },
        leave,
      }));
      break;
    case 'shop':
      openDialogue(shopTalk(st, {
        buy: () => { closeDialogue(); setShopTab('buy'); openPanel('shop', c); },
        sell: () => { closeDialogue(); setShopTab('sell'); openPanel('shop', c); },
        village: () => { closeDialogue(); setShopTab('village'); openPanel('shop', c); },
        leave,
      }));
      break;
    case 'smith':
      openDialogue(smithTalk(st, {
        forge: () => { closeDialogue(); openPanel('smith', c); },
        leave,
      }));
      break;
    case 'inn': openInn(); break;
    case 'home': openPanel('home', c); break;
    case 'gate': openPanel('gate', c); break;
    default: break;
  }
}

function openInn(): void {
  if (!st) return;
  const cost = restCost(st);
  const rest = () => {
    if (!st) return;
    const d = derived(st);
    if (st.gold < cost) { toast('You cannot afford a bed'); return; }
    if (st.hp >= d.maxHp && st.mana >= d.maxMana) { toast('You are already rested'); return; }
    st.gold -= cost;
    st.hp = d.maxHp; st.mana = d.maxMana; st.stamina = d.maxStamina;
    pushLog(st, 'You slept at the inn.', 'good');
    save(st);
    closeDialogue();
    toast('You sleep until dawn');
  };
  openDialogue(innTalk(st, cost, {
    rest,
    rumour: () => openDialogue(innRumour(st!, cost, { rest, leave: closeDialogue })),
    leave: closeDialogue,
  }));
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
  town.px = town.gateX;
  town.py = town.gateY + 84;
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
      'A life is short and mostly unlucky. A bloodline is long. ' +
      'Choose what the first of your name was good at.'),
  );
  const cards = el('div', { class: 'classcards' });
  const mk = (id: 'warrior' | 'wizard', name: string, desc: string, bits: string) => {
    const c = el('div', { class: 'classcard' });
    c.append(el('h3', {}, name), el('p', {}, desc), el('div', { class: 'muted' }, bits));
    c.addEventListener('click', () => {
      st = newGame(id);
      town = buildTown(st);
      resetHud();
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
  box.append(el('div', { class: 'muted', style: 'margin-top:20px' },
    'Every heir is rolled fresh: attributes, looks, and one trait out of ' + TRAITS.length + '. ' +
    'Movement techniques (' + TECHNIQUES.length + ' of them) are learned once and never forgotten.'));

  const wipeBtn = el('button', { class: 'btn small danger' }, 'Erase saved bloodline');
  wipeBtn.addEventListener('click', () => { wipe(); toast('Save erased'); });
  box.append(el('div', { style: 'margin-top:14px' }, wipeBtn));

  scrim.append(box);
  overlay.append(scrim);
}

// ------------------------------------------------------------------ death

function showDeath(cause: string): void {
  const overlay = document.getElementById('overlay')!;
  clear(overlay);
  const s = st!;
  const scrim = el('div', { class: 'scrim' });
  const box = el('div', { class: 'big death' });
  const mem = lastMemoryEarned(s);
  box.append(
    el('h1', {}, 'YOU DIED'),
    el('p', { class: 'epitaph' },
      s.hero.name + ', generation ' + s.generation + ', killed by ' + cause + '. ' +
      s.lifetime.kills + ' kills, ' + s.lifetime.questsDone + ' contracts, ' +
      Math.round((Date.now() - s.lifetime.born) / 60000) + ' minutes of life.'),
  );

  const keep = el('div', { class: 'heirbox' });
  keep.append(el('h3', { style: 'margin:0 0 10px' }, 'What survives you'));
  const line = (t: string, cls = 'muted') => keep.append(el('div', { class: cls }, '▸ ' + t));
  line('A quarter of every skill, passed down as instinct.');
  line(mem + ' memory — your heir can spend it on techniques you learned the hard way.');
  line('Everything in the heirloom chest at home (' + s.chest.items.length + ' items).');
  line('The homestead: plots, hired hands and stores.');
  line('A quarter of your coin, ' + Math.round(s.gold * 0.25) + 'g, found under the floor.');
  keep.append(el('div', { class: 'sep' }));
  line('Your pack and everything you were wearing is buried with you.', 'warn');
  if (s.donated > 0) line(s.village.name + ' remembers the ' + s.donated + 'g you gave.');
  box.append(keep);

  const b = el('button', {
    class: 'btn primary',
    style: 'margin-top:22px;padding:12px 26px;font-size:14px',
  }, 'Years pass…');
  b.addEventListener('click', () => {
    die(s, cause);
    town = buildTown(s);
    resetHud();
    clear(overlay);
    save(s);
    showHeirIntro();
  });
  box.append(b);
  scrim.append(box);
  overlay.append(scrim);
}

function showHeirIntro(): void {
  const s = st!;
  const overlay = document.getElementById('overlay')!;
  clear(overlay);
  const scrim = el('div', { class: 'scrim' });
  const box = el('div', { class: 'big' });
  const d = derived(s);
  box.append(
    el('h1', { style: 'font-size:30px' }, s.hero.name),
    el('p', { class: 'lead' },
      'Generation ' + s.generation + ' of the line, in ' + s.village.name +
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
    el('div', { style: 'font-weight:700;color:' + (s.hero.trait.good ? '#8fd07a' : '#e0a25a') },
      s.hero.trait.name),
    el('div', { class: 'muted' }, s.hero.trait.desc),
    el('div', { class: 'sep' }),
    row('Max health', String(d.maxHp)),
    row('Inherited skill', Object.keys(s.legacy.legacy).length + ' disciplines'),
    row('Memory to spend', String(s.memory)),
  );
  box.append(grid);
  const b = el('button', { class: 'btn primary', style: 'margin-top:20px;padding:11px 24px' },
    'Take up the name');
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
    const blocked = uiBlocking();
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
    drawTown(ctx, town, st, blocked ? null : nearestInteract(town));
    ctx.restore();
    drawTownAmbience(ctx, W, H);
    drawHud(st, 'town', null);

    st.hp = Math.min(d.maxHp, st.hp + dt * (d.hpRegen * 2));
    st.mana = Math.min(d.maxMana, st.mana + dt * 4);
    st.stamina = Math.min(d.maxStamina, st.stamina + dt * d.staminaRegen * 2);
  } else if (st.scene === 'zone' && zone) {
    const blocked = uiBlocking();
    const [mx, my] = blocked ? [0, 0] : moveVector();
    if (mx || my) walkT += dt;

    if (!blocked) {
      const [wx, wy] = screenToWorldPoint(cam, W, H, mouseX, mouseY);
      const dx = wx - zone.px, dy = wy - zone.py;
      if (Math.hypot(dx, dy) > 6) zone.facing = Math.atan2(dy, dx);
    }

    const attack = !blocked && mouseDown;
    tickZone(zone, st, dt, { mx, my, attack }, {
      onDeath,
      onExit: returnToTown,
    });

    if (st.scene === 'zone' && zone) {
      cam.zoom = targetZoom();
      cam.x += (zone.px - cam.x) * Math.min(1, dt * 8);
      cam.y += (zone.py - cam.y) * Math.min(1, dt * 8);
      clampCamera(cam, zone.def.w * TS, zone.def.h * TS, W, H, 300);

      const shake = zone.shake;
      ctx.save();
      applyCamera(ctx, cam, W, H);
      if (shake > 0.2) {
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      }
      renderZone(zone, st);
      ctx.restore();
      drawHud(st, 'zone', zone);

      const boss = bossMob(zone);
      if (boss) {
        const bd = MONSTERS[boss.defId];
        drawBossBar(ctx, W, bd.name, bd.title ?? '', boss.hp / boss.maxHp);
      }

      if (zone.killGlow > 0) {
        ctx.fillStyle = 'rgba(255,240,200,' + zone.killGlow * 0.22 + ')';
        ctx.fillRect(0, 0, W, H);
      }
      if (zone.hurtT > 0) {
        ctx.fillStyle = 'rgba(180,40,30,' + zone.hurtT * 0.9 + ')';
        ctx.fillRect(0, 0, W, H);
      }
      if (st.hp / derived(st).maxHp < 0.28) {
        const pulse = 0.10 + 0.07 * Math.sin(now * 0.005);
        ctx.fillStyle = 'rgba(150,20,20,' + pulse + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }
  } else {
    paintBackdrop();
  }

  requestAnimationFrame(frame);
}

/** Chunky JRPG scale, but never so tight that a wolf can charge in unseen. */
function targetZoom(): number {
  return Math.max(1.3, Math.min(1.95, Math.min(W, H) / 560));
}

function renderZone(z: Zone, s: GameState): void {
  drawBackdrop(ctx, z.def.w * TS, z.def.backdrop, cam.x, z.def.skyTop, z.def.skyBottom);
  drawGround(ctx, z.def.w, z.def.h, z.tiles, z.def.ground, z.def.ground2, 0);
  for (const c of z.chasms) drawChasm(ctx, c);
  // low ground first so tall ground overlaps it correctly
  const tiers = [...z.plateaus].sort((a, b) => a.z - b.z);
  for (const p of tiers) drawPlateau(ctx, p, z.def.ground2, z.def.ground);
  drawBorder(ctx, z.def.w, z.def.h);
  drawExitPad(ctx, z);
  for (const tg of z.telegraphs) drawTelegraph(ctx, tg);
  drawDashTrail(ctx, z.dashTrail, s.hero.appearance);

  type R = { d: number; f: () => void };
  const list: R[] = [];
  for (const f of z.flora) list.push({ d: f.y - f.gz, f: () => drawFlora(ctx, f, z.time) });
  for (const n of z.nodes) list.push({ d: n.y - n.gz, f: () => drawNode(ctx, n) });
  for (const m of z.mobs) list.push({ d: m.y - m.gz, f: () => drawMob(ctx, m) });
  for (const dr of z.drops) list.push({ d: dr.y - dr.gz, f: () => drawDrop(ctx, dr) });
  for (const c of z.critters) list.push({ d: c.y, f: () => drawCritter(ctx, c, z.time) });
  const heroZ = z.groundZ + z.jumpZ;
  list.push({
    d: z.py - z.groundZ,
    f: () => {
      const harvesting = z.swingT > 0 && nearHarvest(z);
      drawHero(ctx, z.px, z.py, s.hero.appearance, z.facing, walkT, {
        hurt: z.hurtT, swing: z.swingT, swingMax: harvesting ? 0.22 : 0.2,
        gear: swingPiece(gearLook(s.equipped), harvesting),
        iframes: z.iframes,
        z: heroZ,
        cast: z.castMax > 0 && z.castT > 0 ? 1 - z.castT / z.castMax : 0,
        shield: z.shield > 0,
        spin: z.spinT > 0,
      });
    },
  });
  list.sort((a, b) => a.d - b.d);
  for (const r of list) r.f();

  for (const sl of z.slashes) drawSlash(ctx, sl);
  for (const p of z.projectiles) drawProjectile(ctx, p);
  for (const p of z.particles) drawParticle(ctx, p);
  for (const mo of z.motes) drawMote(ctx, mo, z.def.ambienceColor, z.time);
  for (const p of z.popups) drawPopup(ctx, p);
}

/** True when the swing currently playing is a harvest rather than an attack. */
function nearHarvest(z: Zone): boolean {
  for (const n of z.nodes) {
    if (n.respawn > 0) continue;
    if (Math.hypot(n.x - z.px, n.y - z.py) < 56) return true;
  }
  return false;
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
    if (st.scene === 'death') showDeath('unknown causes');
    else { st.scene = 'town'; town = buildTown(st); }
  } else {
    showCreation();
  }
  setInterval(() => { if (st) save(st); }, 5000);
  requestAnimationFrame(frame);
}

boot();

(window as unknown as Record<string, unknown>).HEIRLOOM = {
  get state() { return st; },
  get town() { return town; },
  get zone() { return zone; },
  keys,
  wipe: () => { wipe(); location.reload(); },
  refreshPanel,
};
