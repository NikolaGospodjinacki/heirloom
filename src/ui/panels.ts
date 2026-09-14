import type { EquipSlot, Item, SkillKey } from '../game/types';
import {
  EQUIP_SLOTS, RARITY_COLOR, SKILL_COLOR, SKILL_EFFECT, SKILL_NAMES, STAT_NAMES,
} from '../game/types';
import { ITEM_DEFS, displayName, isGear, itemValue, makeItem, slotOf } from '../game/items';
import { autoPlace, remove, usedCells } from '../game/backpack';
import { levelProgress } from '../game/bloodline';
import { MONSTERS, ZONES, ZONE_ORDER } from '../game/content';
import { RANKS, rankDef } from '../game/ranks';
import { veteran } from './story';
import type { Party } from '../net/party';
import { TECHNIQUES, canLearn, techById } from '../game/techniques';
import {
  GameState, PLOT_DEFS, RESOURCE_NAMES, clickPlot, collectAll, collectPlot,
  completeQuest, derived, equip, pendingTotal, refreshBoard, rollShopStock, skillLevel,
  unequip, upgradeCost, workerCost, pushLog,
} from '../game/state';
import { rng } from '../game/rng';
import { drawHero } from '../render/draw';
import { gearLook } from '../render/look';
import { clear, el, fmt, hideTip, showTip, toast } from './dom';
import { GridView, SlotView, dropZones, itemTooltip } from './grid';

/** What the party screen can ask the game to do. */
export interface PartyApi {
  current: () => Party | null;
  host: () => Promise<void>;
  join: (code: string) => Promise<void>;
  leave: () => void;
  invite: () => string;
}

export interface UICtx {
  st: GameState;
  close: () => void;
  refresh: () => void;
  travel: (zoneId: string, bossTarget?: string) => void;
  save: () => void;
  /** a promotion just happened: show the ceremony */
  promoted: (rank: number) => void;
  party: PartyApi;
}

export type PanelKind =
  | 'bag' | 'char' | 'tech' | 'guild' | 'shop' | 'smith' | 'home' | 'gate'
  | 'registry' | 'trophies' | 'memorial' | 'party';

let liveViews: GridView[] = [];
let liveSlots: SlotView[] = [];
let liveLoops: number[] = [];
let rerender: (() => void) | null = null;

export function closePanel(): void {
  for (const v of liveViews) v.destroy();
  for (const s of liveSlots) s.destroy();
  for (const id of liveLoops) cancelAnimationFrame(id);
  liveViews = []; liveSlots = []; liveLoops = [];
  dropZones.length = 0;
  rerender = null;
  hideTip();
  clear(document.getElementById('overlay')!);
}

export function panelOpen(): boolean {
  return document.getElementById('overlay')!.childElementCount > 0;
}

export function openPanel(kind: PanelKind, ctx: UICtx): void {
  closePanel();
  const overlay = document.getElementById('overlay')!;
  const scrim = el('div', { class: 'scrim' });
  const host = el('div');
  scrim.append(host);
  overlay.append(scrim);
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) { closePanel(); ctx.refresh(); }
  });

  const build = () => {
    for (const v of liveViews) v.destroy();
    for (const s of liveSlots) s.destroy();
    for (const id of liveLoops) cancelAnimationFrame(id);
    liveViews = []; liveSlots = []; liveLoops = [];
    dropZones.length = 0;
    clear(host);
    let node: HTMLElement;
    switch (kind) {
      case 'bag': node = bagPanel(ctx); break;
      case 'char': node = charPanel(ctx); break;
      case 'tech': node = techPanel(ctx); break;
      case 'guild': node = guildPanel(ctx); break;
      case 'shop': node = shopPanel(ctx); break;
      case 'smith': node = smithPanel(ctx); break;
      case 'home': node = homePanel(ctx); break;
      case 'gate': node = gatePanel(ctx); break;
      case 'registry': node = registryPanel(ctx); break;
      case 'trophies': node = trophiesPanel(ctx); break;
      case 'memorial': node = memorialPanel(ctx); break;
      case 'party': node = partyPanel(ctx); break;
    }
    host.append(node);
  };
  rerender = build;
  build();
}

export function refreshPanel(): void { rerender?.(); }

function shell(title: string, sub: string, body: HTMLElement, width: number): HTMLElement {
  const p = el('div', { class: 'panel', style: 'width:min(' + width + 'px, 94vw)' });
  const close = el('button', { class: 'x' }, '✕');
  close.addEventListener('click', () => { closePanel(); });
  p.append(
    el('header', {},
      el('div', {}, el('h2', {}, title), el('div', { class: 'sub' }, sub)),
      close),
    el('div', { class: 'body' }, body),
  );
  return p;
}

// ---------------------------------------------------------------- paper doll

/** Live-rendering hero preview that reflects whatever is in the slots. */
function dollCanvas(ctx: UICtx): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const W = 132, H = 210;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cv.className = 'dollcanvas';
  const c = cv.getContext('2d')!;
  const t0 = performance.now();
  let swingT = 0;

  cv.addEventListener('click', () => { swingT = 0.35; });

  const loop = (now: number) => {
    const t = (now - t0) / 1000;
    if (swingT > 0) swingT = Math.max(0, swingT - 1 / 60);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H * 0.78);
    c.scale(2.1, 2.1);
    // face the viewer, idle bob
    drawHero(c, 0, 0, ctx.st.hero.appearance, Math.PI / 2, t * 0.8, {
      gear: gearLook(ctx.st.equipped),
      swing: swingT, swingMax: 0.35,
    });
    c.restore();
    liveLoops[0] = requestAnimationFrame(loop);
  };
  liveLoops.push(requestAnimationFrame(loop));
  return cv;
}

function makeSlot(ctx: UICtx, slot: EquipSlot): SlotView {
  const st = ctx.st;
  const v = new SlotView({
    slot,
    get: () => st.equipped[slot],
    set: (it) => {
      if (it === null) { st.equipped[slot] = null; }
      else if (!equip(st, it)) { toast('No room in the pack for what you are wearing'); return false; }
      ctx.refresh(); ctx.save();
      return true;
    },
    accepts: (it) => slotOf(it) === slot,
    onChange: () => { refreshStats(ctx); },
  });
  liveSlots.push(v);
  return v;
}

let statsHost: HTMLElement | null = null;
function refreshStats(ctx: UICtx): void {
  if (!statsHost) return;
  const fresh = statBlock(ctx);
  statsHost.replaceWith(fresh);
  statsHost = fresh;
}

function statBlock(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const d = derived(st);
  const box = el('div', { class: 'side' });
  const g = el('div', { class: 'statblock' }, el('h4', {}, 'In the field'));
  const rows: [string, string][] = [
    ['Attack', String(d.atk)],
    ['Spell power', String(d.spellPower)],
    ['Armour', String(d.armor)],
    ['Max health', String(d.maxHp)],
    ['Move speed', String(d.speed)],
    ['Crit', Math.round(d.crit * 100) + '%'],
    ['Swing rate', d.attackSpeed.toFixed(2) + 'x'],
    ['Dash charges', String(d.dash.charges)],
    ['Chop power', d.chopPower > 0 ? d.chopPower.toFixed(1) + 'x' : 'bare hands'],
    ['Mine power', d.minePower > 0 ? d.minePower.toFixed(1) + 'x' : 'bare hands'],
    ['vs beasts', '+' + Math.round((d.beastMult - 1) * 100) + '%'],
    ['vs everything else', '+' + Math.round((d.slayMult - 1) * 100) + '%'],
  ];
  for (const [k, v] of rows) g.append(el('div', { class: 'srow' }, el('span', {}, k), el('b', {}, v)));
  box.append(g);

  const s = el('div', { class: 'statblock' }, el('h4', {}, 'Body'));
  for (const [k, name] of Object.entries(STAT_NAMES)) {
    s.append(el('div', { class: 'srow' },
      el('span', {}, name), el('b', {}, String(d.stats[k as keyof typeof d.stats]))));
  }
  box.append(s);

  const used = usedCells(st.bag);
  box.append(el('div', { class: 'muted center' }, used + ' / ' + (st.bag.w * st.bag.h) + ' cells used'));
  return box;
}

// -------------------------------------------------------------------- BAG

function bagPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const wrap = el('div', { style: 'display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;justify-content:center' });

  // --- paper doll column
  const doll = el('div', { class: 'doll' });
  const left = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const right = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  for (const s of ['head', 'body', 'feet'] as EquipSlot[]) left.append(makeSlot(ctx, s).host);
  for (const s of ['weapon', 'offhand', 'tool'] as EquipSlot[]) right.append(makeSlot(ctx, s).host);
  doll.append(left, el('div', { class: 'cv' }, dollCanvas(ctx)), right);

  const dollCol = el('div', {});
  dollCol.append(
    doll,
    el('div', { class: 'muted center', style: 'margin-top:10px;width:290px' },
      'Drag gear onto a slot, or double-click it in the pack. Trinkets and gems work from inside the pack. '
      + 'The tool slot is what chops and mines \u2014 your weapon has nothing to do with it.'),
  );

  // --- pack grid
  const view = new GridView({
    grid: st.bag,
    onChange: () => { ctx.refresh(); refreshStats(ctx); ctx.save(); },
    onClickItem: (it, e) => { if (e.detail === 2) useOrEquip(ctx, it); },
  });
  liveViews.push(view);

  const gridCol = el('div', {});
  gridCol.append(
    el('div', { class: 'muted', style: 'margin-bottom:6px' }, 'PACK'),
    view.host,
  );

  statsHost = statBlock(ctx);
  wrap.append(dollCol, gridCol, statsHost);
  return shell(
    'Kit',
    'What you wear, and what you can carry home. Both die with you.',
    wrap, 1060,
  );
}

function useOrEquip(ctx: UICtx, it: Item): void {
  const def = ITEM_DEFS[it.defId];
  const d = derived(ctx.st);
  if (def.kind === 'consumable') {
    if (it.defId === 'healing_draught') {
      ctx.st.hp = Math.min(d.maxHp, ctx.st.hp + 45);
      toast('Drank a Healing Draught');
    } else {
      ctx.st.mana = Math.min(d.maxMana, ctx.st.mana + 40);
      toast('Drank a Mana Draught');
    }
    it.count -= 1;
    if (it.count <= 0) remove(ctx.st.bag, it.uid);
  } else if (slotOf(it)) {
    if (!equip(ctx.st, it)) { toast('No room in the pack for what you are wearing'); return; }
    toast('Equipped ' + displayName(it));
  } else {
    return;
  }
  ctx.refresh(); ctx.save();
  refreshPanel();
}

// -------------------------------------------------------------- CHARACTER

function skillCard(st: GameState, k: SkillKey): HTMLElement {
  const p = levelProgress(st.hero.skills[k]?.xp ?? 0);
  const inherited = st.legacy.legacy[k] ?? 0;
  const pct = p.need ? (p.into / p.need) * 100 : 0;
  const card = el('div', { class: 'skillcard' });
  card.append(
    el('div', { class: 'top' },
      el('b', { style: 'color:' + SKILL_COLOR[k] }, SKILL_NAMES[k]),
      el('span', {}, 'level ' + p.level + '   ' + Math.floor(p.into) + ' / ' + p.need + ' xp')),
    el('div', { class: 'track', style: 'height:8px;border-radius:5px;background:#16120f;overflow:hidden;margin:6px 0 5px' },
      el('i', { style: 'display:block;height:100%;width:' + pct + '%;background:' + SKILL_COLOR[k] })),
    el('div', { class: 'eff', style: 'font-size:11px;color:#8c8069' },
      'per level: ' + SKILL_EFFECT[k] + (inherited > 0 ? '   ·   inherited ' + fmt(inherited) + ' xp' : '')),
  );
  return card;
}

function charPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const d = derived(st);
  const body = el('div', { style: 'display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap' });

  const leftCol = el('div', { style: 'width:330px;flex:none' });
  leftCol.append(el('div', { class: 'statblock' },
    el('h4', {}, 'Bloodline'),
    el('div', { class: 'srow' }, el('span', {}, 'Name'), el('b', {}, st.hero.name)),
    el('div', { class: 'srow' }, el('span', {}, 'Calling'), el('b', {}, st.hero.classId)),
    el('div', { class: 'srow' }, el('span', {}, 'Generation'), el('b', {}, String(st.generation))),
    el('div', { class: 'srow' }, el('span', {}, 'Blood bonus'), el('b', {}, '+' + st.legacy.bloodlineBonus + ' to every stat')),
    el('div', { class: 'srow' }, el('span', {}, 'Memory'), el('b', { style: 'color:#8fc2e0' }, String(st.memory))),
    el('div', { class: 'sep' }),
    el('div', { style: 'font-weight:700;color:' + (st.hero.trait.good ? '#8fd07a' : '#e0a25a') }, st.hero.trait.name),
    el('div', { class: 'muted' }, st.hero.trait.desc),
  ));

  const stats = el('div', { class: 'statblock', style: 'margin-top:12px' }, el('h4', {}, 'Attributes'));
  for (const [k, name] of Object.entries(STAT_NAMES)) {
    stats.append(el('div', { class: 'srow' }, el('span', {}, name),
      el('b', {}, String(d.stats[k as keyof typeof d.stats]))));
  }
  leftCol.append(stats);

  const life = el('div', { class: 'statblock', style: 'margin-top:12px' }, el('h4', {}, 'This life'));
  const L: [string, string][] = [
    ['Kills', String(st.lifetime.kills)],
    ['Contracts', String(st.lifetime.questsDone)],
    ['Trees felled', String(st.lifetime.treesFelled)],
    ['Rocks broken', String(st.lifetime.rocksMined)],
    ['Gold earned', fmt(st.lifetime.goldEarned)],
    ['Minutes alive', String(Math.round((Date.now() - st.lifetime.born) / 60000))],
  ];
  for (const [k, v] of L) life.append(el('div', { class: 'srow' }, el('span', {}, k), el('b', {}, v)));
  leftCol.append(life);

  if (st.epitaphs.length) {
    const graves = el('div', { class: 'statblock', style: 'margin-top:12px' }, el('h4', {}, 'The graves'));
    for (const e of st.epitaphs.slice(0, 6)) {
      graves.append(el('div', { class: 'muted', style: 'padding:3px 0' },
        'Gen ' + e.gen + ' · ' + e.name + ' — killed by ' + e.cause + ' (' + e.kills + ' kills)'));
    }
    leftCol.append(graves);
  }

  const right = el('div', { style: 'flex:1;min-width:340px' });
  right.append(el('h4', { style: 'margin:0 0 4px;font-size:11px;letter-spacing:.1em;color:#8c8069' },
    'SKILLS'));
  right.append(el('div', { class: 'muted', style: 'margin-bottom:12px' },
    'You get better at what you actually do. A quarter of every skill passes to your heir.'));
  for (const k of Object.keys(SKILL_NAMES) as SkillKey[]) right.append(skillCard(st, k));

  body.append(leftCol, right);
  return shell('Character', st.hero.name + ', generation ' + st.generation, body, 880);
}

// -------------------------------------------------------------- TECHNIQUES

function techPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  body.append(el('div', { class: 'muted', style: 'margin-bottom:14px' },
    'Movement is not equipment. What one of your name learns to do with their feet, the next one is born knowing. ' +
    'Memory is earned by living a life worth remembering and spent by whoever comes after.'));

  const tiers = Math.max(...TECHNIQUES.map((t) => t.tier)) + 1;
  const tree = el('div', { class: 'tree' });
  for (let i = 0; i < tiers; i++) {
    const col = el('div', { class: 'treecol' });
    for (const t of TECHNIQUES.filter((x) => x.tier === i)) {
      const known = st.techniques.includes(t.id);
      const able = canLearn(st.techniques, st.memory, t);
      const card = el('div', { class: 'tech ' + (known ? 'known' : able ? 'able' : 'locked') });
      card.append(
        el('div', { class: 'cost' + (known ? ' have' : '') }, known ? 'known' : t.cost + ' mem'),
        el('b', {}, t.name),
        el('p', {}, t.desc),
      );
      if (!known && t.requires.length) {
        const missing = t.requires.filter((r) => !st.techniques.includes(r));
        if (missing.length) {
          card.append(el('div', { class: 'muted', style: 'margin-top:6px;font-size:10.5px' },
            'needs ' + missing.map((m) => techById(m)?.name ?? m).join(', ')));
        }
      }
      if (able) {
        card.addEventListener('click', () => {
          st.memory -= t.cost;
          st.techniques.push(t.id);
          pushLog(st, 'Learned ' + t.name + '.', 'level');
          toast(t.name + ' learned');
          refreshPanel(); ctx.refresh(); ctx.save();
        });
      }
      col.append(card);
    }
    tree.append(col);
  }
  body.append(tree);
  return shell('The Body Remembers', st.memory + ' memory unspent', body, 900);
}

// ----------------------------------------------------------------- GUILD

function platePill(n: number): HTMLElement {
  const R = rankDef(n);
  const pill = el('span', { class: 'plate', style: 'background:' + R.color }, R.letter);
  pill.title = R.plate;
  return pill;
}

function meritBar(have: number, need: number): HTMLElement {
  const fill = el('i', { style: 'width:' + Math.min(100, (have / Math.max(1, need)) * 100) + '%' });
  return el('div', { class: 'bar merit', style: 'margin-top:6px;height:10px' }, fill,
    el('span', { style: 'line-height:10px;font-size:8.5px' }, have + ' / ' + need + ' merit'));
}

function guildPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  const R = rankDef(st.rank);

  body.append(el('div', { class: 'rowcard', style: 'margin-bottom:12px;border-color:' + R.color },
    platePill(st.rank),
    el('div', { class: 'grow' },
      el('div', { class: 't' }, R.plate + ' \u00b7 ' + R.title),
      el('div', { class: 's' }, Number.isFinite(R.merit)
        ? (st.merit >= R.merit ? 'Ready for your trial. See ' + veteran(st).name + ' by the fire.' : 'Finished contracts earn merit toward your next trial.')
        : 'You wear the last plate there is.'),
      Number.isFinite(R.merit) ? meritBar(st.merit, R.merit) : null,
    ),
  ));

  if (st.active) {
    const q = st.active;
    const done = q.have >= q.need;
    const card = el('div', { class: 'rowcard', style: 'border-color:' + (done ? '#7a6a2c' : '#4a4038') });
    card.append(platePill(q.rank), el('div', { class: 'grow' },
      el('div', { class: 't' }, q.title),
      el('div', { class: 's' }, q.have + ' / ' + q.need + ' \u00b7 ' + ZONES[q.zoneId].name
        + (q.trial ? ' \u00b7 report to ' + veteran(st).name : '')),
    ));
    if (done && !q.trial) {
      const b = el('button', { class: 'btn primary' }, 'Turn in  (+' + q.rewardGold + 'g, +' + q.merit + ' merit)');
      b.addEventListener('click', () => {
        const res = completeQuest(st);
        ctx.refresh(); refreshPanel(); ctx.save();
        if (res.promoted) ctx.promoted(st.rank);
      });
      card.append(b);
    } else if (!done) {
      const b = el('button', { class: 'btn small danger' }, 'Abandon');
      b.addEventListener('click', () => { st.active = null; refreshPanel(); ctx.refresh(); });
      card.append(b);
    }
    body.append(
      el('h4', { style: 'margin:0 0 8px;font-size:11px;letter-spacing:.1em;color:#8c8069' }, q.trial ? 'YOUR TRIAL' : 'ACTIVE CONTRACT'),
      card, el('div', { class: 'sep' }));
  }

  const list = el('div', { class: 'list' });
  for (const q of st.board) {
    const stretch = q.rank > st.rank;
    const tooHigh = q.rank > st.rank + 1;
    const row = el('div', { class: 'rowcard' + (st.active || tooHigh ? '' : ' click') + (tooHigh ? ' locked' : '') });
    row.append(
      platePill(q.rank),
      el('div', { class: 'grow' },
        el('div', { class: 't' }, q.title + (stretch ? '  \u2191' : '')),
        el('div', { class: 's' }, ZONES[q.zoneId].name + ' \u00b7 ' + q.need + ' \u00d7 ' + q.targetName
          + (stretch ? ' \u00b7 a plate above yours' : '')),
        el('div', { class: 's' }, el('em', {}, q.giver + ': ' + q.flavor)),
      ),
      el('div', { style: 'text-align:right;flex:none' },
        el('div', { class: 't', style: 'color:#e0b64f' }, q.rewardGold + 'g'),
        el('div', { class: 's', style: 'color:#8fd6e0' }, '+' + q.merit + ' merit'),
        el('div', { class: 's', style: 'color:' + SKILL_COLOR[q.rewardSkill] },
          '+' + Math.round(q.rewardXp) + ' ' + SKILL_NAMES[q.rewardSkill]),
      ),
    );
    if (!st.active && !tooHigh) {
      row.addEventListener('click', () => {
        st.active = { ...q, have: 0 };
        st.board = st.board.filter((x) => x.id !== q.id);
        pushLog(st, 'Accepted: ' + q.title, 'good');
        refreshPanel(); ctx.refresh(); ctx.save();
      });
    }
    list.append(row);
  }
  body.append(list);

  if (!st.active) {
    const rerollBtn = el('button', { class: 'btn small', style: 'margin-top:12px' }, 'Ask for new postings (10g)');
    (rerollBtn as HTMLButtonElement).disabled = st.gold < 10;
    rerollBtn.addEventListener('click', () => {
      st.gold -= 10; refreshBoard(st); refreshPanel(); ctx.refresh();
    });
    body.append(rerollBtn);
  }

  return shell('Quest Board', 'Adventurers Guild of ' + st.village.name, body, 720);
}

function registryPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  const list = el('div', { class: 'list' });
  for (const R of RANKS) {
    const current = R.n === st.rank;
    const opens = ZONE_ORDER.find((id) => ZONES[id].rank === R.n);
    const trial = R.trialBoss ? MONSTERS[R.trialBoss] : null;
    const row = el('div', {
      class: 'rowcard' + (R.n > st.rank ? ' locked' : ''),
      style: current ? 'border-color:' + R.color : '',
    });
    row.append(platePill(R.n), el('div', { class: 'grow' },
      el('div', { class: 't' }, R.letter + '-rank \u00b7 ' + R.plate + ' \u00b7 ' + R.title
        + (current ? '   (you)' : R.n < st.rank ? '   \u2713' : '')),
      el('div', { class: 's' }, (opens ? 'Opens ' + ZONES[opens].name + '. ' : '')
        + (trial && R.trialZone ? 'Trial for the next plate: ' + trial.name + ' in ' + ZONES[R.trialZone].name + '.' : 'The Hero wore this one.')),
      current && Number.isFinite(R.merit) ? meritBar(st.merit, R.merit) : null,
    ));
    list.append(row);
  }
  body.append(list, el('div', { class: 'sep' }), el('div', { class: 'muted' },
    'Each plate is worth +5% damage and +8 health. The best plate your family has worn: '
    + rankDef(st.renown ?? 0).plate + '. The guild lets a new heir start at the '
    + rankDef(Math.floor((st.renown ?? 0) / 2)).plate + '.'));
  return shell('Registry of Plates', 'Adventurer ranks, F to S', body, 680);
}

function trophiesPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  const ids = Object.keys(st.trophies ?? {}).filter((id) => MONSTERS[id]);
  if (!ids.length) body.append(el('div', { class: 'muted' }, 'Empty hooks, and a brass plaque that says: reserved.'));
  const list = el('div', { class: 'list' });
  for (const id of ids) {
    const md = MONSTERS[id];
    list.append(el('div', { class: 'rowcard' },
      el('div', { class: 'swatch', style: 'background:' + md.color }),
      el('div', { class: 'grow' }, el('div', { class: 't' }, md.name), el('div', { class: 's' }, md.title ?? '')),
      el('div', { class: 't', style: 'color:#e0b64f' }, '\u00d7 ' + st.trophies[id]),
    ));
  }
  body.append(list);
  return shell('Trophy Wall', 'Everything the ' + st.hero.name.split(' ').pop() + 's have put down', body, 540);
}

function memorialPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  if (!st.epitaphs.length) body.append(el('div', { class: 'muted' }, 'No names from your family on the wall. Keep it that way.'));
  const list = el('div', { class: 'list' });
  for (const e of st.epitaphs) {
    list.append(el('div', { class: 'rowcard' },
      platePill(e.rank ?? 0),
      el('div', { class: 'grow' },
        el('div', { class: 't' }, e.name),
        el('div', { class: 's' }, 'Generation ' + e.gen + ' \u00b7 killed by ' + e.cause + ' \u00b7 ' + e.kills + ' kills')),
    ));
  }
  body.append(list);
  return shell('The Wall of Names', 'Adventurers of Ashford who did not come home', body, 560);
}

function partyPanel(ctx: UICtx): HTMLElement {
  const api = ctx.party;
  const p = api.current();
  const body = el('div');
  if (!p) {
    body.append(el('p', { class: 'muted', style: 'margin-top:0;line-height:1.55' },
      'Play with friends. Everyone brings their own hero and their own save. When the host sets out, the party follows; '
      + 'monsters get tougher for every friend; loot is rolled for each of you; and if you go down, a friend has thirty seconds to pick you up.'));
    const hostBtn = el('button', { class: 'btn primary', style: 'padding:11px 20px' }, 'Host a party');
    hostBtn.addEventListener('click', () => {
      (hostBtn as HTMLButtonElement).disabled = true;
      hostBtn.textContent = 'Opening a room\u2026';
      api.host().then(() => refreshPanel()).catch((e: Error) => { toast(e.message, 4200); refreshPanel(); });
    });
    const input = el('input', { class: 'textin', maxlength: '8', placeholder: 'CODE' }) as HTMLInputElement;
    const joinBtn = el('button', { class: 'btn' }, 'Join');
    const go = () => {
      const code = input.value.trim();
      if (!code) return;
      (joinBtn as HTMLButtonElement).disabled = true;
      joinBtn.textContent = 'Joining\u2026';
      api.join(code).then(() => refreshPanel()).catch((e: Error) => { toast(e.message, 4600); refreshPanel(); });
    };
    joinBtn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    body.append(
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, hostBtn,
        el('span', { class: 'muted' }, 'or join with a code'), input, joinBtn),
      el('div', { class: 'sep' }),
      el('div', { class: 'muted' }, 'Connections go straight between players. On very strict office networks that can fail; the same Wi-Fi or a phone hotspot almost always works.'),
    );
    return shell('Party', 'Adventure together', body, 620);
  }

  body.append(el('div', { class: 'muted', style: 'margin-bottom:6px' },
    p.role === 'host' ? 'You are hosting. Share this code, or the link:' : 'You are in a party. Code:'));
  body.append(el('div', { class: 'partycode' }, p.code));
  const copy = el('button', { class: 'btn', style: 'margin-top:10px' }, 'Copy invite link');
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(api.invite()).then(() => toast('Invite link copied')).catch(() => toast(api.invite(), 6000));
  });
  body.append(copy, el('div', { class: 'sep' }));
  const list = el('div', { class: 'list' });
  const where: Record<string, string> = { town: 'in town', hall: 'at the guild', zone: 'out adventuring', death: 'dead', creation: 'making a character' };
  list.append(el('div', { class: 'rowcard' }, platePill(ctx.st.rank),
    el('div', { class: 'grow' }, el('div', { class: 't' }, ctx.st.hero.name + ' (you)'),
      el('div', { class: 's' }, ctx.st.hero.classId + (p.role === 'host' ? ' \u00b7 host' : '')))));
  for (const m of p.memberList()) {
    const s = m.state;
    list.append(el('div', { class: 'rowcard' }, platePill(m.profile.rank),
      el('div', { class: 'grow' }, el('div', { class: 't' }, m.profile.name),
        el('div', { class: 's' }, m.profile.classId + (m.id === p.hostId ? ' \u00b7 host' : '')
          + ' \u00b7 ' + (s ? (s.dn ? 'DOWN' : where[s.sc] ?? s.sc) : 'arriving'))),
      s ? el('div', { class: 's' }, Math.ceil(s.hp) + ' / ' + s.mh) : null));
  }
  body.append(list);
  const leave = el('button', { class: 'btn danger', style: 'margin-top:14px' }, p.role === 'host' ? 'Close the party' : 'Leave the party');
  leave.addEventListener('click', () => { api.leave(); refreshPanel(); });
  body.append(leave);
  return shell('Party', p.size + (p.size === 1 ? ' adventurer' : ' adventurers'), body, 560);
}

// ------------------------------------------------------------------ SHOP

let shopTab: 'buy' | 'sell' | 'village' = 'buy';
export function setShopTab(t: 'buy' | 'sell' | 'village'): void { shopTab = t; }

function modSummary(it: Item): string {
  const m = it.mods;
  const bits: string[] = [];
  if (m.atk) bits.push('+' + m.atk + ' atk');
  if (m.spellPower) bits.push('+' + m.spellPower + ' sp');
  if (m.armor) bits.push('+' + m.armor + ' arm');
  if (m.hp) bits.push('+' + m.hp + ' hp');
  if (m.speed) bits.push((m.speed > 0 ? '+' : '') + m.speed + ' spd');
  if (m.critChance) bits.push('+' + Math.round(m.critChance * 100) + '% crit');
  return bits.join('  ') || ITEM_DEFS[it.defId].desc || '—';
}

function skillGain(ctx: UICtx, k: SkillKey, n: number): void {
  ctx.st.hero.skills[k].xp += n;
}

function shopPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const d = derived(st);
  const keeper = st.village.npcs.find((n) => n.role === 'shopkeeper')!;
  const body = el('div');
  const tabs = el('div', { class: 'tabs' });
  const content = el('div');

  const mk = (id: typeof shopTab, label: string) => {
    const b = el('button', { class: 'tab' + (shopTab === id ? ' on' : '') }, label);
    b.addEventListener('click', () => { shopTab = id; draw(); });
    return b;
  };

  function draw(): void {
    for (const v of liveViews) v.destroy();
    liveViews = [];
    clear(tabs); clear(content);
    tabs.append(mk('buy', 'Buy'), mk('sell', 'Sell'), mk('village', 'Village'));
    if (shopTab === 'buy') drawBuy();
    else if (shopTab === 'sell') drawSell();
    else drawVillage();
  }

  function drawBuy(): void {
    const list = el('div', { class: 'list' });
    if (st.shopStock.length === 0) {
      list.append(el('div', { class: 'muted center' }, 'Sold out. Come back after a run.'));
    }
    for (const it of st.shopStock) {
      const price = Math.max(1, Math.round(itemValue(it) * d.buyMult));
      const row = el('div', { class: 'rowcard click' });
      row.append(
        el('div', {
          class: 'swatch',
          style: 'background:' + ITEM_DEFS[it.defId].color + ';border-color:' + RARITY_COLOR[it.rarity],
        }),
        el('div', { class: 'grow' },
          el('div', { class: 't', style: 'color:' + RARITY_COLOR[it.rarity] }, displayName(it)),
          el('div', { class: 's' }, modSummary(it)),
        ),
        el('div', { class: 't', style: 'color:#e0b64f;flex:none' }, price + 'g'),
      );
      row.addEventListener('mouseenter', (e) => showTip(itemTooltip(it), e.clientX, e.clientY));
      row.addEventListener('mousemove', (e) => showTip(itemTooltip(it), e.clientX, e.clientY));
      row.addEventListener('mouseleave', hideTip);
      row.addEventListener('click', () => {
        if (st.gold < price) { toast('Not enough gold'); return; }
        if (!autoPlace(st.bag, it)) { toast('No room in your pack'); return; }
        st.gold -= price;
        st.shopStock = st.shopStock.filter((x) => x.uid !== it.uid);
        skillGain(ctx, 'haggling', 6);
        hideTip(); draw(); ctx.refresh(); ctx.save();
      });
      list.append(row);
    }
    content.append(list);
  }

  function drawSell(): void {
    const wrap = el('div', { class: 'bp-wrap' });
    const view = new GridView({
      grid: st.bag,
      onChange: () => ctx.refresh(),
      onClickItem: (it) => {
        const price = Math.max(1, Math.round(itemValue(it) * d.sellMult));
        remove(st.bag, it.uid);
        st.gold += price;
        st.lifetime.goldEarned += price;
        skillGain(ctx, 'haggling', 4 + Math.round(price / 12));
        toast('Sold ' + displayName(it) + ' for ' + price + 'g');
        hideTip(); draw(); ctx.refresh(); ctx.save();
      },
    });
    liveViews.push(view);

    const side = el('div', { class: 'side' });
    side.append(el('div', { class: 'statblock' },
      el('h4', {}, 'Selling'),
      el('div', { class: 'muted' }, 'Click anything in the pack to sell it. Worn gear is safe.'),
      el('div', { class: 'sep' }),
      el('div', { class: 'srow' }, el('span', {}, 'Sell rate'), el('b', {}, Math.round(d.sellMult * 100) + '%')),
      el('div', { class: 'srow' }, el('span', {}, 'Buy rate'), el('b', {}, Math.round(d.buyMult * 100) + '%')),
      el('div', { class: 'srow' }, el('span', {}, 'Haggling'), el('b', {}, 'Lv ' + skillLevel(st, 'haggling'))),
    ));

    const junk = el('button', { class: 'btn' }, 'Sell all loot');
    junk.addEventListener('click', () => {
      let total = 0;
      for (const it of [...st.bag.items]) {
        if (ITEM_DEFS[it.defId].kind !== 'loot') continue;
        total += Math.max(1, Math.round(itemValue(it) * d.sellMult));
        remove(st.bag, it.uid);
      }
      if (total === 0) { toast('No loot to sell'); return; }
      st.gold += total;
      st.lifetime.goldEarned += total;
      skillGain(ctx, 'haggling', 10);
      toast('Sold loot for ' + total + 'g');
      draw(); ctx.refresh(); ctx.save();
    });
    side.append(junk);

    const resBox = el('div', { class: 'statblock' }, el('h4', {}, 'Homestead goods'));
    let any = false;
    for (const p of PLOT_DEFS) {
      const amt = st.homestead.resources[p.resource] ?? 0;
      if (amt <= 0) continue;
      any = true;
      const price = Math.round(amt * p.sell * d.sellMult * 2);
      const b = el('button', { class: 'btn small' },
        'Sell ' + fmt(amt) + ' ' + RESOURCE_NAMES[p.resource] + ' (' + fmt(price) + 'g)');
      b.addEventListener('click', () => {
        st.homestead.resources[p.resource] = 0;
        st.gold += price;
        st.lifetime.goldEarned += price;
        skillGain(ctx, 'haggling', 8);
        draw(); ctx.refresh(); ctx.save();
      });
      resBox.append(el('div', { style: 'margin-top:6px' }, b));
    }
    if (!any) resBox.append(el('div', { class: 'muted' }, 'Nothing harvested yet.'));
    side.append(resBox);

    wrap.append(view.host, side);
    content.append(wrap);
  }

  function drawVillage(): void {
    const v = st.village;
    const box = el('div');
    box.append(el('div', { class: 'statblock' },
      el('h4', {}, v.name + ' — era ' + v.era),
      el('div', { class: 'srow' }, el('span', {}, 'Mood'),
        el('b', { style: 'color:' + (v.preset === 'thriving' ? '#8fd07a' : '#e0a25a') }, v.preset)),
      el('div', { class: 'srow' }, el('span', {}, 'Prosperity'), el('b', {}, Math.round(v.prosperity) + ' / 100')),
      el('div', { class: 'bar xp', style: 'margin-top:6px' }, el('i', { style: 'width:' + v.prosperity + '%' })),
      el('div', { class: 'muted', style: 'margin-top:10px' },
        'A prosperous village stocks better goods, pays more for contracts and charges less. ' +
        'It decays a little every time one of your name is buried. Donations carry over to your heirs.'),
    ));
    const row = el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' });
    for (const amt of [50, 200, 1000]) {
      const b = el('button', { class: 'btn' }, 'Donate ' + amt + 'g');
      (b as HTMLButtonElement).disabled = st.gold < amt;
      b.addEventListener('click', () => {
        st.gold -= amt;
        st.donated += amt;
        st.village.prosperity = Math.min(100, st.village.prosperity + amt / 55);
        pushLog(st, 'Donated ' + amt + 'g to ' + v.name + '.', 'good');
        toast('The village will remember this');
        draw(); ctx.refresh(); ctx.save();
      });
      row.append(b);
    }
    box.append(row);
    box.append(el('div', { class: 'muted', style: 'margin-top:10px' },
      'Donated this life: ' + fmt(st.donated) + 'g'));
    content.append(box);
  }

  draw();
  body.append(tabs, content);
  return shell('General Store', keeper.name, body, 800);
}

// ----------------------------------------------------------------- SMITH

function smithPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const smith = st.village.npcs.find((n) => n.role === 'smith')!;
  const body = el('div');
  const dust = st.homestead.resources.gemdust ?? 0;

  body.append(el('div', { class: 'statblock' },
    el('h4', {}, 'Materials'),
    el('div', { class: 'srow' }, el('span', {}, 'Gem dust'), el('b', {}, fmt(dust))),
    el('div', { class: 'srow' }, el('span', {}, 'Rough gems in pack'),
      el('b', {}, String(st.bag.items.filter((i) => i.defId === 'gem').reduce((a, b) => a + b.count, 0)))),
  ));

  const grind = el('button', { class: 'btn small', style: 'margin:10px 0' },
    'Grind all rough gems (15 dust each)');
  grind.addEventListener('click', () => {
    const gems = st.bag.items.filter((i) => i.defId === 'gem');
    const n = gems.reduce((a, b) => a + b.count, 0);
    if (n === 0) { toast('No gems'); return; }
    for (const g of gems) remove(st.bag, g.uid);
    st.homestead.resources.gemdust += n * 15;
    toast('Ground ' + n + ' gems into ' + n * 15 + ' dust');
    refreshPanel(); ctx.refresh(); ctx.save();
  });
  body.append(grind);

  body.append(el('div', { class: 'sep' }));
  body.append(el('h4', { style: 'margin:0 0 8px;font-size:11px;letter-spacing:.1em;color:#8c8069' }, 'ENHANCE'));

  const list = el('div', { class: 'list' });
  const worn = EQUIP_SLOTS.map((s) => st.equipped[s]).filter((x): x is Item => !!x);
  const carried = st.bag.items.filter(isGear);
  const all = [...worn, ...carried];
  if (all.length === 0) list.append(el('div', { class: 'muted center' }, 'Nothing to work on.'));
  for (const it of all) {
    const cost = Math.round(30 * Math.pow(1.7, it.plus));
    const goldCost = Math.round(20 * Math.pow(1.6, it.plus));
    const row = el('div', { class: 'rowcard' });
    const b = el('button', { class: 'btn small primary' }, '+1  (' + cost + ' dust, ' + goldCost + 'g)');
    (b as HTMLButtonElement).disabled = dust < cost || st.gold < goldCost || it.plus >= 10;
    b.addEventListener('click', () => {
      st.homestead.resources.gemdust -= cost;
      st.gold -= goldCost;
      it.plus += 1;
      toast(displayName(it) + ' enhanced');
      refreshPanel(); ctx.refresh(); ctx.save();
    });
    row.append(
      el('div', {
        class: 'swatch',
        style: 'background:' + ITEM_DEFS[it.defId].color + ';border-color:' + RARITY_COLOR[it.rarity],
      }),
      el('div', { class: 'grow' },
        el('div', { class: 't', style: 'color:' + RARITY_COLOR[it.rarity] },
          displayName(it) + (worn.includes(it) ? '  (worn)' : '')),
        el('div', { class: 's' }, modSummary(it)),
      ),
      b,
    );
    list.append(row);
  }
  body.append(list);

  body.append(el('div', { class: 'sep' }));
  const bagCost = Math.round(220 * Math.pow(2.1, st.bag.h - 6));
  const expand = el('button', { class: 'btn' },
    'Buy a bigger pack: ' + st.bag.w + '×' + (st.bag.h + 1) + ' (' + fmt(bagCost) + 'g)');
  (expand as HTMLButtonElement).disabled = st.gold < bagCost || st.bag.h >= 10;
  expand.addEventListener('click', () => {
    st.gold -= bagCost;
    st.bag.h += 1;
    toast('Your pack now holds another row');
    refreshPanel(); ctx.refresh(); ctx.save();
  });
  body.append(expand);

  return shell('Smithy', smith.name, body, 660);
}

// -------------------------------------------------------------- HOMESTEAD

let homeTab: 'work' | 'chest' = 'work';

function homePanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  const tabs = el('div', { class: 'tabs' });
  const content = el('div');
  const mk = (id: typeof homeTab, label: string) => {
    const b = el('button', { class: 'tab' + (homeTab === id ? ' on' : '') }, label);
    b.addEventListener('click', () => { homeTab = id; draw(); });
    return b;
  };

  function draw(): void {
    for (const v of liveViews) v.destroy();
    liveViews = [];
    clear(tabs); clear(content);
    tabs.append(mk('work', 'Grounds'), mk('chest', 'Heirloom Chest'));
    if (homeTab === 'work') drawWork(); else drawChest();
  }

  function drawWork(): void {
    const res = el('div', { class: 'statblock', style: 'margin-bottom:12px' }, el('h4', {}, 'Stores'));
    const rr = el('div', { class: 'grid2' });
    for (const p of PLOT_DEFS) {
      rr.append(el('div', { class: 'srow' },
        el('span', {}, RESOURCE_NAMES[p.resource]),
        el('b', {}, fmt(st.homestead.resources[p.resource] ?? 0))));
    }
    res.append(rr);
    content.append(res);

    const waiting = pendingTotal(st);
    const collectRow = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:12px' });
    const collect = el('button', { class: 'btn primary' },
      waiting > 0 ? 'Collect ' + fmt(waiting) + ' from the yard' : 'Nothing to collect');
    (collect as HTMLButtonElement).disabled = waiting <= 0;
    collect.addEventListener('click', () => {
      const got = collectAll(st);
      toast('Carried in ' + fmt(got));
      draw(); ctx.refresh(); ctx.save();
    });
    const auto = el('button', { class: 'btn small' + (st.homestead.autoCollect ? ' primary' : '') },
      st.homestead.autoCollect ? 'Hands carry it in' : 'Hands leave it in the yard');
    auto.addEventListener('click', () => {
      st.homestead.autoCollect = !st.homestead.autoCollect;
      if (st.homestead.autoCollect) collectAll(st);
      draw(); ctx.refresh(); ctx.save();
    });
    collectRow.append(collect, auto);
    content.append(collectRow);

    const grid = el('div', { class: 'grid2' });
    for (const plot of st.homestead.plots) {
      const pd = PLOT_DEFS.find((x) => x.id === plot.id)!;
      const card = el('div', { class: 'plot' + (plot.owned ? '' : ' locked') });
      card.append(el('div', { class: 'h' },
        el('b', {}, plot.name),
        el('span', { class: 'amt' }, plot.owned ? 'Lv ' + plot.level : 'locked')));

      if (!plot.owned) {
        const b = el('button', { class: 'btn primary' }, 'Buy the plot (' + fmt(plot.cost) + 'g)');
        (b as HTMLButtonElement).disabled = st.gold < plot.cost;
        b.addEventListener('click', () => {
          st.gold -= plot.cost; plot.owned = true;
          toast('You bought the ' + plot.name);
          draw(); ctx.refresh(); ctx.save();
        });
        card.append(el('div', { class: 'muted' }, 'Produces ' + RESOURCE_NAMES[plot.resource] + '.'), b);
      } else {
        const gain = el('div', { class: 'muted', style: 'opacity:0;transition:opacity .3s;color:#9ec96a;font-weight:700;height:14px' }, '');
        const harvest = el('div', { class: 'harvest' }, 'Work the ' + plot.name.toLowerCase());
        harvest.addEventListener('click', () => {
          const got = clickPlot(st, plot.id);
          gain.textContent = '+' + got + ' ' + RESOURCE_NAMES[plot.resource];
          gain.style.opacity = '1';
          setTimeout(() => { gain.style.opacity = '0'; }, 420);
          const cells = content.querySelectorAll('.statblock .srow b');
          PLOT_DEFS.forEach((pp, i) => {
            if (cells[i]) cells[i].textContent = fmt(st.homestead.resources[pp.resource] ?? 0);
          });
        });
        card.append(harvest, gain);
        card.append(el('div', { class: 'prog' }, el('i', { style: 'width:' + plot.progress * 100 + '%' })));
        if ((plot.pending ?? 0) > 0) {
          const pick = el('button', { class: 'btn small primary' },
            'Pick up ' + fmt(plot.pending) + ' ' + RESOURCE_NAMES[plot.resource]);
          pick.addEventListener('click', () => {
            collectPlot(st, plot.id);
            draw(); ctx.refresh(); ctx.save();
          });
          card.append(pick);
        }

        const wc = workerCost(plot);
        const uc = upgradeCost(plot);
        const row = el('div', { style: 'display:flex;gap:6px' });
        const hire = el('button', { class: 'btn small' }, 'Hire hand (' + fmt(wc) + 'g)');
        (hire as HTMLButtonElement).disabled = st.gold < wc;
        hire.addEventListener('click', () => {
          st.gold -= wc; plot.workers += 1; draw(); ctx.refresh(); ctx.save();
        });
        const up = el('button', { class: 'btn small' }, 'Improve (' + fmt(uc) + 'g)');
        (up as HTMLButtonElement).disabled = st.gold < uc;
        up.addEventListener('click', () => {
          st.gold -= uc; plot.level += 1; draw(); ctx.refresh(); ctx.save();
        });
        row.append(hire, up);
        card.append(row);
        card.append(el('div', { class: 'muted' },
          plot.workers + ' hand' + (plot.workers === 1 ? '' : 's') + ' · ' +
          (plot.workers > 0
            ? (plot.workers * plot.level / pd.secs).toFixed(2) + '/s while you are away'
            : 'idle')));
      }
      grid.append(card);
    }
    content.append(grid);
    content.append(el('div', { class: 'muted', style: 'margin-top:12px' },
      'The land is family property. Plots, hands and stores all survive your death.'));
  }

  function drawChest(): void {
    const wrap = el('div', { class: 'bp-wrap' });
    const chestView = new GridView({ grid: st.chest, onChange: () => { ctx.refresh(); ctx.save(); } });
    const bagView = new GridView({ grid: st.bag, onChange: () => { ctx.refresh(); ctx.save(); } });
    liveViews.push(chestView, bagView);
    wrap.append(
      el('div', {},
        el('div', { class: 'muted', style: 'margin-bottom:6px' }, 'HEIRLOOM CHEST — survives your death'),
        chestView.host),
      el('div', {},
        el('div', { class: 'muted', style: 'margin-bottom:6px' }, 'YOUR PACK — buried with you'),
        bagView.host),
    );
    content.append(wrap);
    content.append(el('div', { class: 'muted', style: 'margin-top:12px' },
      'Drag anything you want your heir to inherit into the chest. It gives no bonuses while it sits there.'));
  }

  draw();
  body.append(tabs, content);
  return shell('Homestead', 'The house your line keeps rebuilding.', body, 800);
}

// ------------------------------------------------------------------ GATE

export function restCost(st: GameState): number {
  return Math.max(5, Math.round(12 * st.village.npcs[0].priceMod));
}

function gatePanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  const list = el('div', { class: 'list' });
  const q = st.active;
  const party = ctx.party.current();
  const follower = !!party && party.role === 'guest';

  for (const id of ZONE_ORDER) {
    const z = ZONES[id];
    const locked = z.rank > st.rank;
    const isQuest = !!q && q.zoneId === z.id;
    const row = el('div', {
      class: 'rowcard' + (locked || follower ? ' locked' : ' click'),
      style: isQuest ? 'border-color:#7a6a2c' : '',
    });
    const btn = el('button', { class: 'btn' + (isQuest && !locked ? ' primary' : '') },
      locked ? 'Locked' : follower ? 'Leader decides' : 'Travel');
    (btn as HTMLButtonElement).disabled = locked || follower;
    row.append(
      platePill(z.rank),
      el('div', { class: 'grow' },
        el('div', { class: 't' }, z.name),
        el('div', { class: 's' }, locked ? 'The guild will not send anyone below the ' + rankDef(z.rank).plate + ' out this way.' : z.desc),
        isQuest ? el('div', { class: 's', style: 'color:#e0b64f' }, (q!.trial ? 'Your trial' : 'Your contract') + ' is here') : null,
      ),
      btn,
    );
    if (!locked && !follower) {
      row.addEventListener('click', () => {
        const boss = q && q.kind === 'boss' && q.zoneId === z.id ? q.target : undefined;
        closePanel();
        ctx.travel(z.id, boss);
      });
    }
    list.append(row);
  }
  body.append(list);

  const d = derived(st);
  body.append(el('div', { class: 'sep' }));
  if (follower) {
    body.append(el('div', { class: 'muted', style: 'margin-bottom:8px;color:#9fe0c0' },
      'You are in a party. When the host sets out, you will follow them automatically.'));
  } else if (party) {
    body.append(el('div', { class: 'muted', style: 'margin-bottom:8px;color:#9fe0c0' },
      'Your party will follow you wherever you go. Their contracts come along too.'));
  }
  body.append(el('div', { class: 'muted' },
    'Health: ' + Math.ceil(st.hp) + ' / ' + d.maxHp +
    '. The gate does not heal you \u2014 take a bed at the Gilded Sow first.'));

  return shell('The Road South', 'Where the road goes, and who the guild lets walk it.', body, 660);
}

// ------------------------------------------------------------------ misc

export function restockShop(st: GameState): void {
  st.shopStock = rollShopStock(rng, st.village);
}

export function grantStarterKit(st: GameState): void {
  autoPlace(st.bag, makeItem(rng, 'healing_draught', 'common'));
}

export function unequipAll(st: GameState): void {
  for (const s of EQUIP_SLOTS) unequip(st, s);
}
