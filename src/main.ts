import './style.css';

import { clearGroup, makeStage, trackSun } from './render3/core';
import { Diorama } from './render3/diorama';
import { Sprite } from './render3/sprite';
import { makePost, setMood } from './render3/post';
import { Overlay } from './render3/overlay';
import { ZoneView, zoneMood } from './render3/zoneView';
import { TownView } from './render3/townView';
import { HallView } from './render3/hallView';
import { RemotesView } from './render3/remotes';
import { drawHero, setSpriteMode } from './render/draw';
import { setBlobShadows } from './render/view';
import { gearLook, swingPiece } from './render/look';
import { Town, buildTown, nearestInteract, tickTown } from './game/town';
import { Hall, buildHall } from './game/hall';
import {
  RemoteHero, Zone, ZoneEvents, ZoneInit, bossMob, buildZone, castAbility, nearestCache,
  openCache, tickZone, tryDash, tryJump, zoneFromInit,
} from './game/zone';
import { MONSTERS, trialQuest } from './game/content';
import { rankDef } from './game/ranks';
import type { AbilityKey } from './game/abilities';
import type { Appearance } from './game/types';
import {
  GameState, completeQuest, derived, die, lastMemoryEarned, load, newGame, pushLog, save,
  surname, tickHomestead, wipe,
} from './game/state';
import { drawHud, resetHud } from './ui/hud';
import {
  PanelKind, PartyApi, UICtx, closePanel, openPanel, panelOpen, refreshPanel, restCost, restockShop, setShopTab,
} from './ui/panels';
import { closeDialogue, dialogueOpen, openDialogue } from './ui/dialogue';
import { innRumour, innTalk, shopTalk, smithTalk, townsfolkTalk } from './ui/talk';
import {
  HERO, adventurerTalk, clerkTalk, hallIntro, promotionScene, ranksExplained, sylwenHero,
  sylwenHollowing, sylwenLedger, sylwenTalk, veteranStory, veteranTalk,
} from './ui/story';
import { clear, el, toast } from './ui/dom';
import { cancelDrag } from './ui/grid';
import { TRAITS } from './game/bloodline';
import { TECHNIQUES } from './game/techniques';
import { HeroState, Party, PartyHooks, Profile } from './net/party';

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

// The hero and friends live on the scene itself, so they survive every scene change.
const hero = new Sprite(124, 128, { res: 3, footPad: 10, xray: true });
stage.scene.add(hero.mesh);
const remotes = new RemotesView(stage.scene);

// ------------------------------------------------------------------ state

let st: GameState | null = null;
let town: Town | null = null;
let hall: Hall | null = null;
let zone: Zone | null = null;
let townView: TownView | null = null;
let hallView: HallView | null = null;
let zoneView: ZoneView | null = null;
let party: Party | null = null;
let walkT = 0;
let townFacing = -Math.PI / 2;
let reviveT = 0;
let reviveId = '';
let syncT = 0;

const keys = new Set<string>();
let mouseDown = false;

const zoneEvents: ZoneEvents = {
  onDeath: (cause) => onDeath(cause),
  onExit: () => returnToTown(),
};

function activeParty(): Party | null {
  return party && !party.closed ? party : null;
}

function uiBlocking(): boolean {
  return panelOpen() || dialogueOpen()
    || (!!st && st.scene !== 'town' && st.scene !== 'zone' && st.scene !== 'hall');
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
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
  else if (k === 'p') { toggle('party'); }
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
window.addEventListener('beforeunload', () => party?.leave());

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

function hudScene(): 'town' | 'zone' | 'hall' {
  return st?.scene === 'zone' ? 'zone' : st?.scene === 'hall' ? 'hall' : 'town';
}

function uiCtx(): UICtx {
  return {
    st: st!,
    close: closePanel,
    refresh: () => { if (st) drawHud(st, hudScene(), zone, activeParty()); },
    travel: (zoneId, boss) => startRun(zoneId, boss),
    save: () => { if (st) save(st); },
    promoted: (rank) => celebrate(rank),
    party: partyApi,
  };
}

function toggle(kind: PanelKind): void {
  if (!st || st.scene === 'creation' || st.scene === 'death') return;
  if (dialogueOpen()) return;
  if (panelOpen()) { cancelDrag(); closePanel(); return; }
  openPanel(kind, uiCtx());
}

// --------------------------------------------------------------- the town

function interact(): void {
  if (!st || panelOpen() || dialogueOpen()) return;
  if (st.scene === 'zone' && zone) {
    if (zone.nearExit) { leaveZone(); return; }
    const cache = nearestCache(zone);
    if (cache) openCache(zone, st, cache);
    return;
  }
  if (st.scene === 'hall' && hall) { hallInteract(); return; }
  if (st.scene !== 'town' || !town) return;
  const hit = nearestInteract(town);
  if (!hit) return;
  const c = uiCtx();
  const leave = () => { closeDialogue(); };

  if (hit.kind === 'npc') {
    openDialogue(townsfolkTalk(hit.n, st, leave));
    return;
  }
  if (hit.kind === 'spot') {
    townSpot(hit.s.id);
    return;
  }
  const b = hit.b;
  switch (b.id) {
    case 'guild': enterHall(); break;
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

const STONE: Appearance = {
  skin: '#b8b0a4', hair: '#958d82', cloth: '#a39b8f', accent: '#8f877c', build: 0.6, hairStyle: 0, height: 1,
};

function townSpot(id: string): void {
  if (!st) return;
  if (id === 'road') { openPanel('gate', uiCtx()); return; }
  if (id === 'statue') {
    const s = st;
    openDialogue({
      name: HERO, role: 'The Lantern Hero', appearance: STONE, tint: '#6a6458',
      lines: [
        'EDRIC HARROW. BORN IN ASHFORD. HE CARRIED THE LIGHT INTO THE LONG NIGHT, AND CARRIED IT HOME.',
        'Someone has left fresh flowers at the base. Someone always does.',
        (s.renown ?? 0) >= 6
          ? 'A second plaque has been set beneath his: the ' + surname(s.hero.name) + ' family. Adamant.'
          : 'The stone lantern in his raised hand has been rubbed smooth by a century of children.',
      ],
      choices: [{ label: 'Walk on', run: closeDialogue }],
    });
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

// ------------------------------------------------------------ the guild hall

function hallInteract(): void {
  if (!st || !hall) return;
  const hit = nearestInteract(hall);
  if (!hit) return;
  const c = uiCtx();
  if (hit.kind === 'spot') {
    switch (hit.s.id) {
      case 'board': openPanel('guild', c); break;
      case 'registry': openPanel('registry', c); break;
      case 'trophies': openPanel('trophies', c); break;
      case 'memorial': openPanel('memorial', c); break;
      case 'door': leaveHall(); break;
    }
    return;
  }
  if (hit.kind !== 'npc') return;
  const n = hit.n;
  switch (n.kind) {
    case 'clerk': talkClerk(); break;
    case 'veteran': talkVeteran(); break;
    case 'elf': talkSylwen(); break;
    case 'adventurer': openDialogue(adventurerTalk(st, n.name, closeDialogue)); break;
    default: openDialogue(townsfolkTalk(n, st, closeDialogue)); break;
  }
}

function talkClerk(): void {
  if (!st) return;
  const s = st;
  const c = uiCtx();
  openDialogue(clerkTalk(s, {
    board: () => { closeDialogue(); openPanel('guild', c); },
    turnIn: () => {
      const res = completeQuest(s);
      closeDialogue();
      save(s);
      toast('Contract complete' + (res.merit ? ': +' + res.merit + ' merit' : ''));
      if (res.promoted) celebrate(s.rank);
    },
    ranks: () => openDialogue(ranksExplained(s, talkClerk)),
    leave: closeDialogue,
  }));
}

function talkVeteran(): void {
  if (!st) return;
  const s = st;
  openDialogue(veteranTalk(s, {
    accept: () => {
      const q = trialQuest(s.rank);
      closeDialogue();
      if (!q) return;
      s.active = q;
      pushLog(s, 'Accepted: ' + q.title, 'good');
      save(s);
      toast('Trial accepted: ' + q.targetName);
    },
    turnIn: () => {
      const res = completeQuest(s);
      save(s);
      closeDialogue();
      if (res.promoted) celebrate(s.rank);
    },
    story: () => openDialogue(veteranStory(s, talkVeteran)),
    leave: closeDialogue,
  }));
}

function talkSylwen(): void {
  if (!st) return;
  const s = st;
  openDialogue(sylwenTalk(s, {
    hero: () => openDialogue(sylwenHero(talkSylwen)),
    hollowing: () => openDialogue(sylwenHollowing(talkSylwen)),
    ledger: () => openDialogue(sylwenLedger(s, talkSylwen)),
    leave: closeDialogue,
  }));
}

/** A new plate: a moment of fanfare, then the veteran says a few words. */
function celebrate(rank: number): void {
  if (!st) return;
  const s = st;
  const R = rankDef(rank);
  save(s);
  const overlay = document.getElementById('overlay')!;
  const promo = el('div', { class: 'promo' },
    el('div', { class: 'plateBig', style: 'background:' + R.color }, R.letter),
    el('h1', {}, R.plate),
    el('p', {}, s.hero.name + ' is ' + R.letter + '-rank now. ' + R.title + '.'));
  overlay.append(promo);
  setTimeout(() => {
    promo.remove();
    if (st === s) openDialogue(promotionScene(s, rank, closeDialogue));
  }, 2600);
}

// ----------------------------------------------------------------- scenes

function dropViews(): void {
  zoneView?.dispose(); zoneView = null;
  townView?.dispose(); townView = null;
  hallView?.dispose(); hallView = null;
  clearGroup(stage.world);
  diorama.snap();
}

function startRun(zoneId: string, boss?: string): void {
  if (!st) return;
  const p = activeParty();
  if (p && p.role === 'guest') { toast('Your party leader chooses where to go'); return; }
  const s = st;
  const q = s.active;
  const bosses: string[] = boss ? [boss] : [];
  const elites: { defId: string; name: string }[] = [];
  if (q && q.zoneId === zoneId && q.kind === 'bounty' && q.eliteName) elites.push({ defId: q.target, name: q.eliteName });
  if (p) {
    const want = p.wantsFor(zoneId);
    for (const b of want.bosses) if (!bosses.includes(b)) bosses.push(b);
    elites.push(...want.elites.filter((e) => !elites.some((x) => x.name === e.name)));
  }
  const caches = q && q.kind === 'recover' && q.zoneId === zoneId ? Math.max(0, q.need - q.have) + 1 : 0;
  dropViews();
  s.zoneId = zoneId;
  zone = buildZone(zoneId, s, { bosses, elites, partySize: p ? p.size : 1, caches });
  if (p) p.zoneStarted(zone);
  s.scene = 'zone';
  zoneView = new ZoneView(stage, zone);
  setMood(post, zoneMood(zone.def));
  diorama.dist = 27;
  pushLog(s, 'You set out for ' + zone.def.name + (p ? ' with your party' : '') + '.', 'info');
  save(s);
}

/** Guests: the host set out, so we go too. */
function followIntoZone(init: ZoneInit): void {
  const p = activeParty();
  if (!st || !p) return;
  if (st.scene === 'death' || st.scene === 'creation') return;
  if (zone && zone.key === init.key) return;
  if (panelOpen()) { cancelDrag(); closePanel(); }
  if (dialogueOpen()) closeDialogue();
  const s = st;
  const q = s.active;
  const caches = q && q.kind === 'recover' && q.zoneId === init.defId ? Math.max(0, q.need - q.have) + 1 : 0;
  dropViews();
  zone = zoneFromInit(init, s, caches);
  zone.net = p.zoneNet(zone);
  s.zoneId = init.defId;
  s.scene = 'zone';
  zoneView = new ZoneView(stage, zone);
  setMood(post, zoneMood(zone.def));
  diorama.dist = 27;
  toast('Following the party to ' + zone.def.name, 2600);
  pushLog(s, 'You followed the party to ' + zone.def.name + '.', 'info');
}

function leaveZone(): void {
  if (!st || !zone) return;
  const p = activeParty();
  if (p && p.role === 'host') p.zoneEnded(zone, st.hero.name + ' led the party home.');
  returnToTown();
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
  diorama.dist = 27;
  restockShop(st);
  save(st);
}

function enterTown(): void {
  if (!st) return;
  dropViews();
  st.scene = 'town';
  zone = null;
  hall = null;
  town = buildTown(st);
  townView = new TownView(stage, town, st);
  setMood(post, 'town');
  diorama.dist = 27;
}

function enterHall(): void {
  if (!st) return;
  dropViews();
  st.scene = 'hall';
  hall = buildHall(st);
  hallView = new HallView(stage, hall, st);
  setMood(post, 'hall');
  diorama.dist = 30;
  townFacing = -Math.PI / 2;
  const intro = hallIntro(st, closeDialogue);
  if (intro) openDialogue(intro);
}

function leaveHall(): void {
  if (!st) return;
  dropViews();
  st.scene = 'town';
  hall = null;
  town = buildTown(st);
  const g = town.buildings.find((b) => b.id === 'guild');
  if (g) { town.px = g.x + g.w / 2; town.py = g.y + g.d + 44; }
  townFacing = Math.PI / 2;
  townView = new TownView(stage, town, st);
  setMood(post, 'town');
  diorama.dist = 27;
  save(st);
}

function onDeath(cause: string): void {
  if (!st) return;
  const p = activeParty();
  if (p && p.role === 'host' && zone) p.zoneEnded(zone, st.hero.name + ' has fallen, and the party falls back.');
  st.scene = 'death';
  pushLog(st, st.hero.name + ' was killed by ' + cause + '.', 'bad');
  save(st);
  showDeath(cause);
}

// ------------------------------------------------------------------ party

function myProfile(): Profile {
  const s = st!;
  return {
    id: party?.selfId ?? '', name: s.hero.name, classId: s.hero.classId,
    appearance: s.hero.appearance, look: gearLook(s.equipped), rank: s.rank, gen: s.generation,
  };
}

const partyHooks: PartyHooks = {
  st: () => st,
  zone: () => zone,
  events: () => zoneEvents,
  enterZone: (init) => followIntoZone(init),
  zoneEnded: (reason) => {
    toast(reason, 3400);
    if (st && st.scene === 'zone') returnToTown();
  },
  toast: (text) => toast(text, 2800),
  changed: () => refreshPanel(),
};

const partyApi: PartyApi = {
  current: () => activeParty(),
  host: async () => {
    if (!st) throw new Error('Make your character first.');
    party?.leave();
    party = null;
    party = await Party.host(myProfile(), partyHooks);
    toast('Party open. Code: ' + party.code, 3600);
  },
  join: async (code) => {
    if (!st) throw new Error('Make your character first.');
    party?.leave();
    party = null;
    party = await Party.join(code, myProfile(), partyHooks);
  },
  leave: () => {
    const p = party;
    if (!p) return;
    party = null;
    if (zone && !zone.auth) {
      p.leave();
      remotes.clear();
      returnToTown();
    } else {
      if (zone && p.role === 'host') p.zoneEnded(zone, 'The party broke up.');
      p.leave();
      remotes.clear();
      if (zone) { zone.net = null; zone.remotes = []; zone.partySize = 1; }
    }
    toast('You left the party');
  },
  invite: () => location.origin + location.pathname + '?join=' + (party?.code ?? ''),
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function myState(d: ReturnType<typeof derived>): HeroState {
  const s = st!;
  if (s.scene === 'zone' && zone) {
    const z = zone;
    const harvesting = z.swingT > 0 && nearHarvest(z);
    return {
      sc: 'zone', zk: z.key, x: Math.round(z.px), y: Math.round(z.py), gz: z.groundZ, jz: Math.round(z.jumpZ),
      f: r2(z.facing), w: r2(walkT), sw: r2(z.swingT), sm: harvesting ? 0.22 : 0.2, hv: harvesting ? 1 : 0,
      hu: r2(z.hurtT), ifr: r2(z.iframes), sh: z.shield > 0 ? 1 : 0, sp: z.spinT > 0 ? 1 : 0,
      c: z.castMax > 0 && z.castT > 0 ? r2(1 - z.castT / z.castMax) : 0,
      hp: Math.max(0, Math.ceil(s.hp)), mh: d.maxHp, dn: z.downed ? 1 : 0, bl: Math.ceil(z.bleedT),
    };
  }
  const t = s.scene === 'hall' ? hall : s.scene === 'town' ? town : null;
  return {
    sc: s.scene, zk: '', x: Math.round(t?.px ?? 0), y: Math.round(t?.py ?? 0), gz: 0, jz: 0,
    f: r2(townFacing), w: r2(walkT), sw: 0, sm: 0.2, hv: 0, hu: 0, ifr: 0, sh: 0, sp: 0, c: 0,
    hp: Math.max(0, Math.ceil(s.hp)), mh: d.maxHp, dn: 0, bl: 0,
  };
}

function partyTick(dt: number, d: ReturnType<typeof derived>): void {
  const p = activeParty();
  if (!p || !st) return;
  syncT -= dt;
  if (syncT <= 0) {
    syncT = 1;
    p.setProfile(myProfile());
    const q = st.active;
    p.setQuest(q ? { kind: q.kind, zoneId: q.zoneId, target: q.target, eliteName: q.eliteName } : null);
  }
  p.tick(dt, myState(d));
}

function drawFriends(sceneName: string, zoneKey: string): void {
  const p = activeParty();
  remotes.sync(p ? p.memberList() : [], sceneName, zoneKey, diorama.spriteLean);
}

function friendTags(sceneName: string, zoneKey: string): void {
  const p = activeParty();
  if (!p) return;
  const now = performance.now();
  for (const m of p.memberList()) {
    const s = m.state;
    if (!s || s.sc !== sceneName || (sceneName === 'zone' && s.zk !== zoneKey) || now - m.seen > 6000) continue;
    over.heroTag(stage.camera, m.rx, m.ry, m.rz, m.profile.name, s.hp / Math.max(1, s.mh),
      rankDef(m.profile.rank).color, !!s.dn, s.bl);
  }
}

function autoJoin(code: string): void {
  toast('Joining party ' + code.toUpperCase() + '…', 2600);
  partyApi.join(code).catch((e: Error) => toast(e.message, 5200));
  const url = new URL(location.href);
  url.searchParams.delete('join');
  history.replaceState(null, '', url.toString());
}

// -------------------------------------------------------------- creation

function showCreation(joinCode: string | null): void {
  const overlay = document.getElementById('overlay')!;
  clear(overlay);
  const scrim = el('div', { class: 'scrim' });
  const box = el('div', { class: 'big' });
  box.append(
    el('h1', {}, 'HEIRLOOM'),
    el('p', { class: 'lead' },
      'Eighty years after the Hero came home, the guild in his village still hands out copper plates. '
      + 'A life is short and mostly unlucky. A bloodline is long. Choose what the first of your name was good at.'),
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
      if (joinCode) autoJoin(joinCode);
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
  if (joinCode) {
    box.append(el('div', { class: 'invite' },
      'You have been invited to a party (' + joinCode.toUpperCase() + '). Pick a class and you will join them.'));
  }
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
      s.hero.name + ', ' + rankDef(s.rank).plate + ', generation ' + s.generation + ', killed by ' + cause + '. '
      + s.lifetime.kills + ' kills, ' + s.lifetime.questsDone + ' contracts, '
      + Math.round((Date.now() - s.lifetime.born) / 60000) + ' minutes of life.'),
  );
  const keepBox = el('div', { class: 'heirbox' });
  keepBox.append(el('h3', { style: 'margin:0 0 10px' }, 'What survives you'));
  const line = (t: string, cls = 'muted') => keepBox.append(el('div', { class: cls }, '▸ ' + t));
  line('A quarter of every skill, passed down as instinct.');
  line(mem + ' memory — your heir can spend it on techniques you learned the hard way.');
  line('The guild remembers the name: your heir starts at the ' + rankDef(Math.floor(Math.max(s.renown ?? 0, s.rank) / 2)).plate + '.');
  line('Everything in the heirloom chest at home (' + s.chest.items.length + ' items).');
  line('The homestead: plots, hired hands and stores.');
  line('A quarter of your coin, ' + Math.round(s.gold * 0.25) + 'g, found under the floor.');
  keepBox.append(el('div', { class: 'sep' }));
  line('Your pack and everything you were wearing is buried with you. Your name goes on the wall at the guild.', 'warn');
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
      + ' — a ' + s.village.preset + ' village these days. The guild hands you the ' + rankDef(s.rank).plate + '.'),
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

/** One frame of simulation and, unless hidden, drawing. Split out so it can be driven by hand. */
function step(dt: number, now: number, render = true): void {
  if (!st) { if (render) post.render(); return; }
  tickHomestead(st, dt);
  st.lastRealTick = Date.now();
  const blocked = uiBlocking();
  const d = derived(st);
  const s = st;
  if (render) over.begin();

  const walker = s.scene === 'town' ? town : s.scene === 'hall' ? hall : null;
  if (walker && (townView || hallView)) {
    const t = walker;
    const [mx, my] = blocked ? [0, 0] : moveInput();
    if (mx || my) { walkT += dt; townFacing = Math.atan2(my, mx); }
    t.walkT = walkT;
    tickTown(t, dt, mx, my, d.speed * 0.9);
    t.facing = townFacing;
    s.hp = Math.min(d.maxHp, s.hp + dt * d.hpRegen * 2);
    s.mana = Math.min(d.maxMana, s.mana + dt * 4);
    s.stamina = Math.min(d.maxStamina, s.stamina + dt * d.staminaRegen * 2);
    partyTick(dt, d);
    // walking off down the road south is the same as asking at the gate
    if (s.scene === 'town' && render && !blocked && t.py > t.h * 48 - 60) {
      t.py -= 50;
      openPanel('gate', uiCtx());
    }
    if (!render) return;

    hero.paint(t.px, t.py, (c) => drawHero(c, t.px, t.py, s.hero.appearance, townFacing, walkT,
      { gear: gearLook(s.equipped), rank: s.rank, rankColor: rankDef(s.rank).color }));
    diorama.follow(t.px, t.py, 0, dt);
    hero.place(t.px, t.py, 0, diorama.spriteLean);
    trackSun(stage, t.px, t.py);
    if (s.scene === 'town' && townView) townView.sync(s, now, diorama);
    if (s.scene === 'hall' && hallView) hallView.sync(now, diorama);
    drawFriends(s.scene, '');

    post.render();
    const near = blocked ? null : nearestInteract(t);
    over.townLabels(stage.camera, t, near);
    if (near && near.kind === 'spot') {
      over.worldLabel(stage.camera, near.s.x, near.s.y, 60, near.s.label, near.s.prompt, true);
    }
    friendTags(s.scene, '');
    drawHud(s, s.scene === 'hall' ? 'hall' : 'town', null, activeParty());
    return;
  }

  if (s.scene === 'zone' && zone && zoneView) {
    const z = zone;
    const [mx, my] = blocked ? [0, 0] : moveInput();
    if (mx || my) walkT += dt;
    if (!blocked && render && !z.downed) {
      const [ax, ay] = aimGround();
      if (Math.hypot(ax - z.px, ay - z.py) > 6) z.facing = Math.atan2(ay - z.py, ax - z.px);
    }
    tickZone(z, s, dt, { mx, my, attack: !blocked && mouseDown }, zoneEvents);
    if (s.scene !== 'zone' || zone !== z || !zoneView) { if (render) post.render(); return; }

    // picking a friend up off the ground: hold X beside them
    let helping: RemoteHero | null = null;
    if (!blocked && !z.downed && keys.has('x')) {
      helping = z.remotes.find((r) => r.downed && Math.hypot(r.x - z.px, r.y - z.py) < 80) ?? null;
    }
    if (helping) {
      if (reviveId !== helping.id) { reviveId = helping.id; reviveT = 0; }
      reviveT += dt;
      if (reviveT >= 2.5) {
        activeParty()?.revive(helping.id);
        toast('You pulled ' + helping.name + ' back to their feet');
        reviveT = 0;
        reviveId = '';
      }
    } else {
      reviveT = 0;
      reviveId = '';
    }
    partyTick(dt, d);
    if (!render) return;

    const harvesting = z.swingT > 0 && nearHarvest(z);
    hero.paint(z.px, z.py, (c) => drawHero(c, z.px, z.py, s.hero.appearance, z.facing, walkT, {
      hurt: z.hurtT, swing: z.swingT, swingMax: harvesting ? 0.22 : 0.2,
      gear: swingPiece(gearLook(s.equipped), harvesting),
      iframes: z.iframes, shield: z.shield > 0, spin: z.spinT > 0,
      rank: s.rank, rankColor: rankDef(s.rank).color, downed: z.downed,
    }));
    diorama.follow(z.px, z.py, z.groundZ, dt);
    if (z.shake > 0.2) {
      stage.camera.position.x += (Math.random() - 0.5) * z.shake * 0.022;
      stage.camera.position.y += (Math.random() - 0.5) * z.shake * 0.022;
    }
    hero.place(z.px, z.py, z.groundZ + z.jumpZ, diorama.spriteLean);
    trackSun(stage, z.px, z.py);
    zoneView.sync(now, diorama);
    drawFriends('zone', z.key);

    post.render();
    const cam = stage.camera;
    over.popups(cam, z);
    over.mobBars(cam, z, (id) => MONSTERS[id].size, z.bossUid);
    for (const m of z.mobs) {
      if (!m.elite || m.state === 'dead') continue;
      if (Math.hypot(m.x - z.px, m.y - z.py) > 900) continue;
      over.worldLabel(cam, m.x, m.y, m.gz + MONSTERS[m.defId].size * 3.4, m.elite, null, true);
    }
    friendTags('zone', z.key);
    const p = activeParty();
    if (helping) {
      over.ring(cam, helping.x, helping.y, helping.gz, Math.min(1, reviveT / 2.5), '#9fe0c0', 'Helping ' + helping.name + ' up');
    } else {
      const downedFriend = z.remotes.find((r) => r.downed && Math.hypot(r.x - z.px, r.y - z.py) < 110);
      if (downedFriend && !z.downed) over.hint('[Hold X] help ' + downedFriend.name + ' up');
      else if (z.nearExit) over.hint(p && p.role === 'host' && p.members.size ? '[X] lead the party home' : '[X] the road home');
      else if (nearestCache(z)) over.hint('[X] search it');
    }
    const boss = bossMob(z);
    if (boss) {
      const bd = MONSTERS[boss.defId];
      over.bossBar(bd.name, bd.title ?? '', boss.hp / boss.maxHp);
    }
    over.flash('#b4281e', z.hurtT * 0.7);
    over.flash('#fff0c8', z.killGlow * 0.2);
    over.lowHealth(Math.max(0, 1 - (s.hp / d.maxHp) / 0.3) * 0.9);
    if (z.downed) {
      over.banner('YOU ARE DOWN', Math.ceil(z.bleedT) + 's — a friend can pick you up by holding X beside you');
    }
    drawHud(s, 'zone', z, p);
    return;
  }
  if (render) post.render();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
  step(dt, now, true);
}

/**
 * A hidden tab gets no animation frames. A party must not freeze because its
 * host tabbed away to answer a message, so a worker keeps the simulation going.
 */
function startBackgroundTicker(): void {
  try {
    const src = 'setInterval(function () { postMessage(0); }, 50);';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = () => {
      if (!document.hidden || !activeParty()) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      step(dt, now, false);
    };
  } catch { /* no workers: a hidden tab simply pauses */ }
}

// ------------------------------------------------------------------- boot

function boot(): void {
  const joinCode = new URLSearchParams(location.search).get('join');
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
    if (joinCode) autoJoin(joinCode);
  } else {
    showCreation(joinCode);
  }
  setInterval(() => { if (st) save(st); }, 5000);
  requestAnimationFrame(frame);
  startBackgroundTicker();
}

boot();

(window as unknown as Record<string, unknown>).HEIRLOOM = {
  get state() { return st; },
  get town() { return town; },
  get hall() { return hall; },
  get zone() { return zone; },
  get party() { return party; },
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
  travel: (id: string, boss?: string) => startRun(id, boss),
  enterHall: () => enterHall(),
  api: partyApi,
  refreshPanel,
};
