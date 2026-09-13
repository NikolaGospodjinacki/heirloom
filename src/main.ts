import './style.css';

import { clearGroup, makeStage, trackSun } from './render3/core';
import { Diorama } from './render3/diorama';
import { Sprite } from './render3/sprite';
import { makePost, setMood } from './render3/post';
import { Overlay } from './render3/overlay';
import { ZoneView, zoneMood } from './render3/zoneView';
import { TownView } from './render3/townView';
import { drawHero, setSpriteMode } from './render/draw';
import { setBlobShadows } from './render/view';
import { gearLook, swingPiece } from './render/look';
import { Town, buildTown, nearestInteract, tickTown } from './game/town';
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

// The 2D art paints standees here: no painted blob shadows, no ground rings.
setSpriteMode(true);
setBlobShadows(false);

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('over2d') as HTMLCanvasElement;
const stage = makeStage(canvas);
const diorama = new Diorama(stage, canvas);
const post = makePost(stage);
const over = new Overlay(overlayCanvas);

let W = 0, H = 0;
function resize(): void {
  W = window.innerWidth;
  H = window.innerHeight;
  stage.resize(W, H);
  post.resize(W, H);
  over.resize(W, H);
}
resize();
window.addEventListener('resize', resize);

// The hero lives on the scene itself, so it survives every scene change.
const hero = new Sprite(124, 128, { res: 3, footPad: 10 });
stage.scene.add(hero.mesh);

// ------------------------------------------------------------------ state

let st: GameState | null = null;
let town: Town | null = null;
let zone: Zone | null = null;
let townView: TownView | null = null;
let zoneView: ZoneView | null = null;
let walkT = 0;
let townFacing = -Math.PI / 2;

const keys = new Set<string>();
let mouseDown = false;

function uiBlocking(): boolean {
  return panelOpen() || dialogueOpen() || (!!st && st.scene !== 'town' && st.scene !== 'zone');
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (dialogueOpen()) return;
  const inZone = !!(st && st.scene === 'zone' && zone && !uiBlocking());
  const NUM_TO_KEY: Record<string, AbilityKey> = { '1': 'q', '2': 'f', '3': 'e', '4': 'r' };
  const abilKey = NUM_TO_KEY[k]
    ?? (k === 'q' || k === 'e' || k === 'r' || k === 'f' ? k as AbilityKey : null);
  if (inZone && abilKey) {
    const [ax, ay] = aimGround();
    castAbility(zone!, st!, abilKey, ax, ay);
    return;
  }
  if (k === 'tab') { e.preventDefault(); toggle('bag'); }
  else if (k === 'c') { if (!inZone) toggle('char'); }
  else if (k === 'k') { if (!inZone) toggle('tech'); }
  else if (k === 'escape') { if (panelOpen()) { cancelDrag(); closePanel(); } }
  else if (k === 'e' || k === 'x') { interact(); }
  else if (k === 'm') { if (st && st.scene === 'town') toggle('gate'); }
  else if (k === ' ') {
    e.preventDefault();
    if (inZone) tryJump(zone!, st!);
  } else if (k === 'shift') {
    if (inZone) {
      const [mx, my] = moveInput();
      tryDash(zone!, st!, mx, my);
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { mouseDown = false; keys.clear(); }
});

canvas.addEventListener('mousedown', (e) => {
  if (uiBlocking()) return;
  if (e.button === 0) mouseDown = true;
  if (e.button === 2 && st && st.scene === 'zone' && zone) {
    const [mx, my] = moveInput();
    tryDash(zone, st, mx, my);
  }
});
window.addEventListener('mouseup', () => { mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** WASD on the screen's own axes: the camera never turns, so north is always up. */
function moveInput(): [number, number] {
  let ix = 0, iy = 0;
  if (keys.has('w') || keys.has('arrowup')) iy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) iy += 1;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (!ix && !iy) return [0, 0];
  const l = Math.hypot(ix, iy);
  return [ix / l, iy / l];
}

function aimGround(): [number, number] {
  const h = st && st.scene === 'zone' && zone ? zone.groundZ : 0;
  return diorama.aim(W, H, h);
}

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
  if (!st || panelOpen() || dialogueOpen()) return;
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

function dropViews(): void {
  zoneView?.dispose(); zoneView = null;
  townView?.dispose(); townView = null;
  clearGroup(stage.world);
  diorama.snap();
}

function startRun(zoneId: string, boss?: string): void {
  if (!st) return;
  dropViews();
  st.zoneId = zoneId;
  zone = buildZone(zoneId, st, boss);
  st.scene = 'zone';
  zoneView = new ZoneView(stage, zone);
  setMood(post, zoneMood(zone.def));
  pushLog(st, 'You set out for ' + zone.def.name + '.', 'info');
  save(st);
}

function returnToTown(): void {
  if (!st) return;
  dropViews();
  st.scene = 'town';
  zone = null;
  town = buildTown(st);
  town.px = town.gateX;
  town.py = town.gateY + 150;
  townFacing = -Math.PI / 2;
  townView = new TownView(stage, town, st);
  setMood(post, 'town');
  restockShop(st);
  save(st);
}

function enterTown(): void {
  if (!st) return;
  dropViews();
  st.scene = 'town';
  zone = null;
  town = buildTown(st);
  townView = new TownView(stage, town, st);
  setMood(post, 'town');
}

function onDeath(cause: string): void {
  if (!st) return;
  st.scene = 'death';
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
      'A life is short and mostly unlucky. A bloodline is long. '
      + 'Choose what the first of your name was good at.'),
  );
  const cards = el('div', { class: 'classcards' });
  const mk = (id: 'warrior' | 'wizard', name: string, desc: string, bits: string) => {
    const c = el('div', { class: 'classcard' });
    c.append(el('h3', {}, name), el('p', {}, desc), el('div', { class: 'muted' }, bits));
    c.addEventListener('click', () => {
      st = newGame(id);
      resetHud();
      clear(overlay);
      enterTown();
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
    'Every heir is rolled fresh: attributes, looks, and one trait out of ' + TRAITS.length + '. '
    + 'Movement techniques (' + TECHNIQUES.length + ' of them) are learned once and never forgotten.'));
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
      s.hero.name + ', generation ' + s.generation + ', killed by ' + cause + '. '
      + s.lifetime.kills + ' kills, ' + s.lifetime.questsDone + ' contracts, '
      + Math.round((Date.now() - s.lifetime.born) / 60000) + ' minutes of life.'),
  );
  const keepBox = el('div', { class: 'heirbox' });
  keepBox.append(el('h3', { style: 'margin:0 0 10px' }, 'What survives you'));
  const line = (t: string, cls = 'muted') => keepBox.append(el('div', { class: cls }, '▸ ' + t));
  line('A quarter of every skill, passed down as instinct.');
  line(mem + ' memory — your heir can spend it on techniques you learned the hard way.');
  line('Everything in the heirloom chest at home (' + s.chest.items.length + ' items).');
  line('The homestead: plots, hired hands and stores.');
  line('A quarter of your coin, ' + Math.round(s.gold * 0.25) + 'g, found under the floor.');
  keepBox.append(el('div', { class: 'sep' }));
  line('Your pack and everything you were wearing is buried with you.', 'warn');
  if (s.donated > 0) line(s.village.name + ' remembers the ' + s.donated + 'g you gave.');
  box.append(keepBox);
  const b = el('button', {
    class: 'btn primary', style: 'margin-top:22px;padding:12px 26px;font-size:14px',
  }, 'Years pass…');
  b.addEventListener('click', () => {
    die(s, cause);
    resetHud();
    clear(overlay);
    enterTown();
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
      'Generation ' + s.generation + ' of the line, in ' + s.village.name
      + ' — a ' + s.village.preset + ' village these days.'),
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

function nearHarvest(z: Zone): boolean {
  for (const n of z.nodes) {
    if (n.respawn > 0) continue;
    if (Math.hypot(n.x - z.px, n.y - z.py) < 56) return true;
  }
  return false;
}

/** One frame of simulation and drawing. Split out so it can be driven by hand for captures. */
function step(dt: number, now: number): void {
  if (!st) { post.render(); return; }
  tickHomestead(st, dt);
  st.lastRealTick = Date.now();
  const blocked = uiBlocking();
  const d = derived(st);
  const s = st;
  over.begin();

  if (s.scene === 'town' && town && townView) {
    const t = town;
    const [mx, my] = blocked ? [0, 0] : moveInput();
    if (mx || my) { walkT += dt; townFacing = Math.atan2(my, mx); }
    t.walkT = walkT;
    tickTown(t, dt, mx, my, d.speed * 0.9);
    t.facing = townFacing;

    hero.paint(t.px, t.py, (c) => drawHero(c, t.px, t.py, s.hero.appearance, townFacing, walkT,
      { gear: gearLook(s.equipped) }));
    diorama.follow(t.px, t.py, 0, dt);
    hero.place(t.px, t.py, 0, diorama.spriteLean);
    trackSun(stage, t.px, t.py);
    townView.sync(s, now, diorama);

    post.render();
    over.townLabels(stage.camera, t, blocked ? null : nearestInteract(t));
    drawHud(s, 'town', null);
    s.hp = Math.min(d.maxHp, s.hp + dt * d.hpRegen * 2);
    s.mana = Math.min(d.maxMana, s.mana + dt * 4);
    s.stamina = Math.min(d.maxStamina, s.stamina + dt * d.staminaRegen * 2);
  } else if (s.scene === 'zone' && zone && zoneView) {
    const [mx, my] = blocked ? [0, 0] : moveInput();
    if (mx || my) walkT += dt;
    if (!blocked) {
      const [ax, ay] = aimGround();
      if (Math.hypot(ax - zone.px, ay - zone.py) > 6) zone.facing = Math.atan2(ay - zone.py, ax - zone.px);
    }
    tickZone(zone, s, dt, { mx, my, attack: !blocked && mouseDown }, { onDeath, onExit: returnToTown });

    if (s.scene === 'zone' && zone && zoneView) {
      const z = zone;
      const harvesting = z.swingT > 0 && nearHarvest(z);
      hero.paint(z.px, z.py, (c) => drawHero(c, z.px, z.py, s.hero.appearance, z.facing, walkT, {
        hurt: z.hurtT, swing: z.swingT, swingMax: harvesting ? 0.22 : 0.2,
        gear: swingPiece(gearLook(s.equipped), harvesting),
        iframes: z.iframes, shield: z.shield > 0, spin: z.spinT > 0,
      }));
      diorama.follow(z.px, z.py, z.groundZ, dt);
      if (z.shake > 0.2) {
        stage.camera.position.x += (Math.random() - 0.5) * z.shake * 0.022;
        stage.camera.position.y += (Math.random() - 0.5) * z.shake * 0.022;
      }
      hero.place(z.px, z.py, z.groundZ + z.jumpZ, diorama.spriteLean);
      trackSun(stage, z.px, z.py);
      zoneView.sync(now, diorama);

      post.render();
      over.popups(stage.camera, z);
      over.mobBars(stage.camera, z, (id) => MONSTERS[id].size, z.bossUid);
      if (z.nearExit) over.hint('[X] the road home');
      const boss = bossMob(z);
      if (boss) {
        const bd = MONSTERS[boss.defId];
        over.bossBar(bd.name, bd.title ?? '', boss.hp / boss.maxHp);
      }
      over.flash('#b4281e', z.hurtT * 0.7);
      over.flash('#fff0c8', z.killGlow * 0.2);
      over.lowHealth(Math.max(0, 1 - (s.hp / d.maxHp) / 0.3) * 0.9);
      drawHud(s, 'zone', z);
    }
  } else {
    post.render();
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
  step(dt, now);
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
        toast('While you were away your hands brought in '
          + gained.map(([k, v]) => v + ' ' + k).join(', '), 4200);
      }
    }
    if (st.scene === 'death') { enterTown(); showDeath('unknown causes'); }
    else enterTown();
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
  keys, stage, diorama, post, hero,
  step,
  /** Drive a couple of frames by hand and send the result to the local capture sink. */
  capture: async (name: string, frames = 3) => {
    for (let i = 0; i < frames; i++) step(1 / 60, performance.now());
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return 'no blob';
    const res = await fetch('http://localhost:5199/?name=' + encodeURIComponent(name), {
      method: 'POST', body: blob,
    });
    return name + ' ' + (await res.text()) + ' ' + blob.size;
  },
  wipe: () => { wipe(); location.reload(); },
  refreshPanel,
};
