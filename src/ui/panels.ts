import type { Item, SkillKey } from '../game/types';
import { RARITY_COLOR, SKILL_NAMES, STAT_NAMES } from '../game/types';
import { ITEM_DEFS, displayName, isGear, itemValue, makeItem } from '../game/items';
import { autoPlace, remove, usedCells } from '../game/backpack';
import { levelProgress } from '../game/bloodline';
import { ZONES } from '../game/content';
import {
  GameState, PLOT_DEFS, RESOURCE_NAMES, clickPlot, completeQuest, derived,
  refreshBoard, rollShopStock, skillLevel, upgradeCost, workerCost, pushLog,
} from '../game/state';
import { rng } from '../game/rng';
import { clear, el, fmt, hideTip, toast } from './dom';
import { GridView, dropZones, itemTooltip } from './grid';

export interface UICtx {
  st: GameState;
  close: () => void;
  refresh: () => void;
  travel: (zoneId: string, bossTarget?: string) => void;
  save: () => void;
}

export type PanelKind = 'bag' | 'guild' | 'shop' | 'smith' | 'home' | 'char' | 'gate';

let liveViews: GridView[] = [];
let rerender: (() => void) | null = null;

export function closePanel(): void {
  for (const v of liveViews) v.destroy();
  liveViews = [];
  dropZones.length = 0;
  rerender = null;
  hideTip();
  const o = document.getElementById('overlay')!;
  clear(o);
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
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) { closePanel(); ctx.refresh(); } });

  const build = () => {
    for (const v of liveViews) v.destroy();
    liveViews = [];
    dropZones.length = 0;
    clear(host);
    let node: HTMLElement;
    switch (kind) {
      case 'bag': node = bagPanel(ctx); break;
      case 'guild': node = guildPanel(ctx); break;
      case 'shop': node = shopPanel(ctx); break;
      case 'smith': node = smithPanel(ctx); break;
      case 'home': node = homePanel(ctx); break;
      case 'char': node = charPanel(ctx); break;
      case 'gate': node = gatePanel(ctx); break;
    }
    host.append(node);
  };
  rerender = build;
  build();
}

export function refreshPanel(): void { rerender?.(); }

function shell(title: string, sub: string, body: HTMLElement, width: number, footer?: HTMLElement): HTMLElement {
  const p = el('div', { class: 'panel', style: 'width:' + width + 'px' });
  const close = el('button', { class: 'x' }, '✕');
  close.addEventListener('click', () => { closePanel(); });
  p.append(
    el('header', {},
      el('div', {}, el('h2', {}, title), el('div', { class: 'sub' }, sub)),
      close),
    el('div', { class: 'body' }, body),
  );
  if (footer) p.append(footer);
  return p;
}

// ------------------------------------------------------------------- BAG

function statSide(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const d = derived(st);
  const box = el('div', { class: 'side' });

  const g = el('div', { class: 'statblock' }, el('h4', {}, 'Loadout'));
  const rows: [string, string][] = [
    ['Attack', String(d.atk)],
    ['Spell Power', String(d.spellPower)],
    ['Armour', String(d.armor)],
    ['Max Health', String(d.maxHp)],
    ['Move Speed', String(d.speed)],
    ['Crit', Math.round(d.crit * 100) + '%'],
    ['Swing Rate', d.attackSpeed.toFixed(2) + 'x'],
    ['Weapon', d.weapon ? displayName(d.weapon) : 'bare hands'],
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
  box.append(el('div', { class: 'muted center' },
    used + ' / ' + (st.bag.w * st.bag.h) + ' cells used'));
  box.append(el('div', { class: 'muted center' },
    'Drag to arrange · R rotates · gear only works while it is in the bag'));
  return box;
}

function bagPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const wrap = el('div', { class: 'bp-wrap' });
  const view = new GridView({
    grid: st.bag,
    onChange: () => { ctx.refresh(); refreshPanel(); },
    onClickItem: (it, e) => {
      if (e.detail === 2) useOrToggle(ctx, it);
    },
  });
  liveViews.push(view);
  wrap.append(view.host, statSide(ctx));
  return shell(
    'Pack',
    'Everything you own is on your back. Gear must be inside the bag to count.',
    wrap, 760,
  );
}

function useOrToggle(ctx: UICtx, it: Item): void {
  const def = ITEM_DEFS[it.defId];
  if (def.kind !== 'consumable') return;
  const d = derived(ctx.st);
  if (it.defId === 'healing_draught') {
    ctx.st.hp = Math.min(d.maxHp, ctx.st.hp + 45);
    toast('Drank a Healing Draught');
  } else {
    ctx.st.mana = Math.min(d.maxMana, ctx.st.mana + 40);
    toast('Drank a Mana Draught');
  }
  it.count -= 1;
  if (it.count <= 0) remove(ctx.st.bag, it.uid);
  ctx.refresh();
  refreshPanel();
}

// ----------------------------------------------------------------- GUILD

function dangerPill(d: number): HTMLElement {
  const label = d <= 1 ? 'trivial' : d <= 2 ? 'easy' : d <= 3 ? 'risky' : d <= 4 ? 'deadly' : 'suicidal';
  return el('span', { class: 'pill d' + Math.min(6, d) }, label);
}

function guildPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');

  if (st.active) {
    const q = st.active;
    const done = q.have >= q.need;
    const card = el('div', { class: 'rowcard', style: 'border-color:' + (done ? '#7a6a2c' : '#4a4038') });
    card.append(el('div', { class: 'grow' },
      el('div', { class: 't' }, q.title),
      el('div', { class: 's' }, q.have + ' / ' + q.need + ' · ' + ZONES[q.zoneId].name),
    ));
    if (done) {
      const b = el('button', { class: 'btn primary' }, 'Turn in  (+' + q.rewardGold + 'g)');
      b.addEventListener('click', () => { completeQuest(st); ctx.refresh(); refreshPanel(); ctx.save(); });
      card.append(b);
    } else {
      const b = el('button', { class: 'btn small danger' }, 'Abandon');
      b.addEventListener('click', () => { st.active = null; refreshPanel(); ctx.refresh(); });
      card.append(b);
    }
    body.append(el('h4', { style: 'margin:0 0 8px;font-size:11px;letter-spacing:.1em;color:#8c8069' }, 'ACTIVE CONTRACT'), card, el('div', { class: 'sep' }));
  }

  const list = el('div', { class: 'list' });
  for (const q of st.board) {
    const row = el('div', { class: 'rowcard' + (st.active ? '' : ' click') });
    row.append(
      dangerPill(q.danger),
      el('div', { class: 'grow' },
        el('div', { class: 't' }, q.title),
        el('div', { class: 's' }, ZONES[q.zoneId].name + ' · ' + q.need + ' × ' + q.targetName),
        el('div', { class: 's' }, el('em', {}, q.flavor)),
      ),
      el('div', { style: 'text-align:right;flex:none' },
        el('div', { class: 't', style: 'color:#e0b64f' }, q.rewardGold + 'g'),
        el('div', { class: 's' }, '+' + Math.round(q.rewardXp) + ' ' + SKILL_NAMES[q.rewardSkill]),
      ),
    );
    if (!st.active) {
      row.addEventListener('click', () => {
        st.active = { ...q, have: 0 };
        st.board = st.board.filter((x) => x.id !== q.id);
        pushLog(st, 'Accepted: ' + q.title, 'good');
        refreshPanel();
        ctx.refresh();
        ctx.save();
      });
    }
    list.append(row);
  }
  body.append(list);

  if (!st.active) {
    const rerollBtn = el('button', { class: 'btn small', style: 'margin-top:12px' }, 'Ask for new postings (10g)');
    rerollBtn.disabled = st.gold < 10;
    rerollBtn.addEventListener('click', () => {
      st.gold -= 10; refreshBoard(st); refreshPanel(); ctx.refresh();
    });
    body.append(rerollBtn);
  }

  const gm = st.village.npcs.find((n) => n.role === 'guildmaster')!;
  return shell(
    'Adventurers Guild',
    'Guildmaster ' + gm.name + ' — "' + gm.line + '"',
    body, 660,
  );
}

// ------------------------------------------------------------------ SHOP

function shopPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const d = derived(st);
  const keeper = st.village.npcs.find((n) => n.role === 'shopkeeper')!;
  const body = el('div');
  const tabs = el('div', { class: 'tabs' });
  const content = el('div');
  let tab: 'buy' | 'sell' | 'village' = shopTab;

  const setTab = (t: typeof tab) => { shopTab = t; tab = t; draw(); };
  const mk = (id: typeof tab, label: string) => {
    const b = el('button', { class: 'tab' + (tab === id ? ' on' : '') }, label);
    b.addEventListener('click', () => setTab(id));
    return b;
  };

  function draw(): void {
    clear(tabs); clear(content);
    tabs.append(mk('buy', 'Buy'), mk('sell', 'Sell'), mk('village', 'Village'));
    if (tab === 'buy') drawBuy();
    else if (tab === 'sell') drawSell();
    else drawVillage();
  }

  function drawBuy(): void {
    const list = el('div', { class: 'list' });
    if (st.shopStock.length === 0) list.append(el('div', { class: 'muted center' }, 'Sold out. Come back after a run.'));
    for (const it of st.shopStock) {
      const price = Math.max(1, Math.round(itemValue(it) * d.buyMult));
      const row = el('div', { class: 'rowcard click' });
      row.append(
        el('div', { class: 'swatch', style: 'background:' + ITEM_DEFS[it.defId].color + ';border-color:' + RARITY_COLOR[it.rarity] }),
        el('div', { class: 'grow' },
          el('div', { class: 't', style: 'color:' + RARITY_COLOR[it.rarity] }, displayName(it)),
          el('div', { class: 's' }, modSummary(it)),
        ),
        el('div', { class: 't', style: 'color:#e0b64f;flex:none' }, price + 'g'),
      );
      row.addEventListener('mouseenter', (e) => import('./dom').then((m) => m.showTip(itemTooltip(it), e.clientX, e.clientY)));
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
      onChange: () => { ctx.refresh(); },
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
      el('div', { class: 'muted' }, 'Click any item in your pack to sell it. Haggling level and village mood set the price.'),
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

    // resources from the homestead sell straight from the pile
    const resBox = el('div', { class: 'statblock' }, el('h4', {}, 'Homestead Goods'));
    let any = false;
    for (const p of PLOT_DEFS) {
      const amt = st.homestead.resources[p.resource] ?? 0;
      if (amt <= 0) continue;
      any = true;
      const price = Math.round(amt * p.sell * d.sellMult * 2);
      const b = el('button', { class: 'btn small' }, 'Sell ' + fmt(amt) + ' ' + RESOURCE_NAMES[p.resource] + ' (' + fmt(price) + 'g)');
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
      el('div', { class: 'srow' }, el('span', {}, 'Mood'), el('b', { style: 'color:' + (v.preset === 'thriving' ? '#8fd07a' : '#e0a25a') }, v.preset)),
      el('div', { class: 'srow' }, el('span', {}, 'Prosperity'), el('b', {}, Math.round(v.prosperity) + ' / 100')),
      el('div', { class: 'bar xp', style: 'margin-top:6px' },
        el('i', { style: 'width:' + v.prosperity + '%' })),
      el('div', { class: 'muted', style: 'margin-top:10px' },
        'A prosperous village stocks better goods, pays more for contracts and charges less. It decays a little every time a Greyrat is buried. Donations carry over to your heirs.'),
    ));

    const row = el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' });
    for (const amt of [50, 200, 1000]) {
      const b = el('button', { class: 'btn' }, 'Donate ' + amt + 'g');
      b.disabled = st.gold < amt;
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
    box.append(el('div', { class: 'muted', style: 'margin-top:10px' }, 'Donated this life: ' + fmt(st.donated) + 'g'));
    content.append(box);
  }

  draw();
  body.append(tabs, content);
  return shell(
    'General Store',
    keeper.name + ' — "' + keeper.line + '"',
    body, 780,
  );
}

let shopTab: 'buy' | 'sell' | 'village' = 'buy';

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

// ----------------------------------------------------------------- SMITH

function smithPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const smith = st.village.npcs.find((n) => n.role === 'smith')!;
  const body = el('div');
  const dust = st.homestead.resources.gemdust ?? 0;

  body.append(el('div', { class: 'statblock' },
    el('h4', {}, 'Materials'),
    el('div', { class: 'srow' }, el('span', {}, 'Gem Dust'), el('b', {}, fmt(dust))),
    el('div', { class: 'srow' }, el('span', {}, 'Rough Gems in pack'),
      el('b', {}, String(st.bag.items.filter((i) => i.defId === 'gem').reduce((a, b) => a + b.count, 0)))),
    el('div', { class: 'muted', style: 'margin-top:8px' },
      'Each enhancement adds +12% to a piece of gear. Grind rough gems into dust, or let the Crystal Font at home fill the barrel for you.'),
  ));

  const grind = el('button', { class: 'btn small', style: 'margin:10px 0' }, 'Grind all Rough Gems (×15 dust each)');
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
  const gear = st.bag.items.filter(isGear);
  if (gear.length === 0) list.append(el('div', { class: 'muted center' }, 'No gear in your pack.'));
  for (const it of gear) {
    const cost = Math.round(30 * Math.pow(1.7, it.plus));
    const goldCost = Math.round(20 * Math.pow(1.6, it.plus));
    const row = el('div', { class: 'rowcard' });
    const b = el('button', { class: 'btn small primary' }, '+1  (' + cost + ' dust, ' + goldCost + 'g)');
    b.disabled = dust < cost || st.gold < goldCost || it.plus >= 10;
    b.addEventListener('click', () => {
      st.homestead.resources.gemdust -= cost;
      st.gold -= goldCost;
      it.plus += 1;
      toast(displayName(it) + ' enhanced');
      refreshPanel(); ctx.refresh(); ctx.save();
    });
    row.append(
      el('div', { class: 'swatch', style: 'background:' + ITEM_DEFS[it.defId].color + ';border-color:' + RARITY_COLOR[it.rarity] }),
      el('div', { class: 'grow' },
        el('div', { class: 't', style: 'color:' + RARITY_COLOR[it.rarity] }, displayName(it)),
        el('div', { class: 's' }, modSummary(it)),
      ),
      b,
    );
    list.append(row);
  }
  body.append(list);

  body.append(el('div', { class: 'sep' }));
  const bagCost = Math.round(220 * Math.pow(2.1, st.bag.h - 6));
  const expand = el('button', { class: 'btn' }, 'Buy a bigger pack: ' + st.bag.w + '×' + (st.bag.h + 1) + ' (' + fmt(bagCost) + 'g)');
  expand.disabled = st.gold < bagCost || st.bag.h >= 10;
  expand.addEventListener('click', () => {
    st.gold -= bagCost;
    st.bag.h += 1;
    toast('Your pack now holds another row');
    refreshPanel(); ctx.refresh(); ctx.save();
  });
  body.append(expand);
  body.append(el('div', { class: 'muted', style: 'margin-top:6px' }, 'Pack size is lost with the body. Everything is.'));

  return shell('Smithy', smith.name + ' — "' + smith.line + '"', body, 640);
}

// -------------------------------------------------------------- HOMESTEAD

function homePanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  const tabs = el('div', { class: 'tabs' });
  const content = el('div');
  let tab: 'work' | 'chest' = homeTab;
  const mk = (id: typeof tab, label: string) => {
    const b = el('button', { class: 'tab' + (tab === id ? ' on' : '') }, label);
    b.addEventListener('click', () => { homeTab = id; tab = id; draw(); });
    return b;
  };

  function draw(): void {
    clear(tabs); clear(content);
    tabs.append(mk('work', 'Grounds'), mk('chest', 'Heirloom Chest'));
    if (tab === 'work') drawWork(); else drawChest();
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

    const grid = el('div', { class: 'grid2' });
    for (const plot of st.homestead.plots) {
      const pd = PLOT_DEFS.find((x) => x.id === plot.id)!;
      const card = el('div', { class: 'plot' + (plot.owned ? '' : ' locked') });
      card.append(el('div', { class: 'h' },
        el('b', {}, plot.name),
        el('span', { class: 'amt' }, plot.owned ? 'Lv ' + plot.level : 'locked')));

      if (!plot.owned) {
        const b = el('button', { class: 'btn primary' }, 'Buy the plot (' + fmt(plot.cost) + 'g)');
        b.disabled = st.gold < plot.cost;
        b.addEventListener('click', () => {
          st.gold -= plot.cost; plot.owned = true;
          toast('You bought the ' + plot.name);
          draw(); ctx.refresh(); ctx.save();
        });
        card.append(el('div', { class: 'muted' }, 'Produces ' + RESOURCE_NAMES[plot.resource] + '.'), b);
      } else {
        const harvest = el('div', { class: 'harvest' }, 'Work the ' + plot.name.toLowerCase());
        harvest.addEventListener('click', () => {
          const got = clickPlot(st, plot.id);
          const amt = card.querySelector('.gain') as HTMLElement | null;
          if (amt) { amt.textContent = '+' + got; amt.style.opacity = '1'; setTimeout(() => { amt.style.opacity = '0'; }, 400); }
          updateNumbers();
        });
        card.append(harvest);
        card.append(el('div', { class: 'prog' }, el('i', { style: 'width:' + plot.progress * 100 + '%' })));

        const wc = workerCost(plot);
        const uc = upgradeCost(plot);
        const row = el('div', { style: 'display:flex;gap:6px' });
        const hire = el('button', { class: 'btn small' }, 'Hire hand (' + fmt(wc) + 'g)');
        hire.disabled = st.gold < wc;
        hire.addEventListener('click', () => {
          st.gold -= wc; plot.workers += 1; draw(); ctx.refresh(); ctx.save();
        });
        const up = el('button', { class: 'btn small' }, 'Improve (' + fmt(uc) + 'g)');
        up.disabled = st.gold < uc;
        up.addEventListener('click', () => {
          st.gold -= uc; plot.level += 1; draw(); ctx.refresh(); ctx.save();
        });
        row.append(hire, up);
        card.append(row);
        card.append(el('div', { class: 'muted' },
          plot.workers + ' hand' + (plot.workers === 1 ? '' : 's') + ' · ' +
          (plot.workers > 0 ? (plot.workers * plot.level / pd.secs).toFixed(2) + '/s while you are away' : 'idle')));
        card.append(el('div', { class: 'gain muted', style: 'opacity:0;transition:opacity .3s;color:#9ec96a;font-weight:700' }, ''));
      }
      grid.append(card);
    }
    content.append(grid);
    content.append(el('div', { class: 'muted', style: 'margin-top:12px' },
      'The land is family property. Plots, hands and stores all survive your death.'));
  }

  function updateNumbers(): void {
    const res = content.querySelectorAll('.statblock .srow b');
    PLOT_DEFS.forEach((p, i) => {
      if (res[i]) res[i].textContent = fmt(st.homestead.resources[p.resource] ?? 0);
    });
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
      'Drag anything you want your heir to inherit into the chest. Gear in the chest gives you no bonuses while it sits there.'));
  }

  draw();
  body.append(tabs, content);
  return shell('Homestead', 'The house your line keeps rebuilding.', body, 800);
}

let homeTab: 'work' | 'chest' = 'work';

// ------------------------------------------------------------- CHARACTER

function charPanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const d = derived(st);
  const body = el('div', { class: 'bp-wrap' });

  const left = el('div', { style: 'width:340px' });
  left.append(el('div', { class: 'statblock' },
    el('h4', {}, 'Bloodline'),
    el('div', { class: 'srow' }, el('span', {}, 'Name'), el('b', {}, st.hero.name)),
    el('div', { class: 'srow' }, el('span', {}, 'Calling'), el('b', {}, st.hero.classId)),
    el('div', { class: 'srow' }, el('span', {}, 'Generation'), el('b', {}, String(st.generation))),
    el('div', { class: 'srow' }, el('span', {}, 'Blood bonus'), el('b', {}, '+' + st.legacy.bloodlineBonus + ' to all stats')),
    el('div', { class: 'sep' }),
    el('div', { class: 't', style: 'font-weight:700;color:' + (st.hero.trait.good ? '#8fd07a' : '#e0a25a') }, st.hero.trait.name),
    el('div', { class: 'muted' }, st.hero.trait.desc),
  ));

  const stats = el('div', { class: 'statblock', style: 'margin-top:12px' }, el('h4', {}, 'Attributes'));
  for (const [k, name] of Object.entries(STAT_NAMES)) {
    stats.append(el('div', { class: 'srow' }, el('span', {}, name),
      el('b', {}, String(d.stats[k as keyof typeof d.stats]))));
  }
  left.append(stats);

  if (st.epitaphs.length) {
    const graves = el('div', { class: 'statblock', style: 'margin-top:12px' }, el('h4', {}, 'The Graves'));
    for (const e of st.epitaphs.slice(0, 6)) {
      graves.append(el('div', { class: 'muted', style: 'padding:3px 0' },
        'Gen ' + e.gen + ' · ' + e.name + ' — killed by ' + e.cause + ' (' + e.kills + ' kills)'));
    }
    left.append(graves);
  }

  const right = el('div', { style: 'flex:1;min-width:300px' });
  right.append(el('h4', { style: 'margin:0 0 10px;font-size:11px;letter-spacing:.1em;color:#8c8069' }, 'SKILLS — you get better at what you do'));
  for (const k of Object.keys(SKILL_NAMES) as SkillKey[]) {
    const p = levelProgress(st.hero.skills[k].xp);
    const inherited = st.legacy.legacy[k] ?? 0;
    right.append(el('div', { style: 'margin-bottom:9px' },
      el('div', { style: 'display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px' },
        el('span', {}, SKILL_NAMES[k] + (inherited > 0 ? ' · inherited' : '')),
        el('b', { style: 'color:#e0b64f' }, 'Lv ' + p.level)),
      el('div', { class: 'bar xp' }, el('i', { style: 'width:' + (p.need ? (p.into / p.need) * 100 : 0) + '%' })),
    ));
  }

  body.append(left, right);
  return shell('Character', 'Skills carry a fraction of themselves into your descendants.', body, 780);
}

// ------------------------------------------------------------------ GATE

function gatePanel(ctx: UICtx): HTMLElement {
  const st = ctx.st;
  const body = el('div');
  const list = el('div', { class: 'list' });
  const q = st.active;

  for (const z of Object.values(ZONES)) {
    const isQuest = q && q.zoneId === z.id;
    const row = el('div', { class: 'rowcard click', style: isQuest ? 'border-color:#7a6a2c' : '' });
    row.append(
      dangerPill(z.danger),
      el('div', { class: 'grow' },
        el('div', { class: 't' }, z.name),
        el('div', { class: 's' }, z.desc),
        isQuest ? el('div', { class: 's', style: 'color:#e0b64f' }, 'Your contract is here') : null,
      ),
      el('button', { class: 'btn' + (isQuest ? ' primary' : '') }, 'Travel'),
    );
    row.addEventListener('click', () => {
      const boss = q && q.kind === 'boss' && q.zoneId === z.id ? q.target : undefined;
      closePanel();
      ctx.travel(z.id, boss);
    });
    list.append(row);
  }
  body.append(list);
  const d = derived(st);
  body.append(el('div', { class: 'sep' }));
  body.append(el('div', { class: 'muted' },
    'Health: ' + Math.ceil(st.hp) + ' / ' + d.maxHp +
    '. You do not heal by walking through the gate — rest at home or drink something.'));

  const rest = el('button', { class: 'btn', style: 'margin-top:10px' }, 'Rest at the inn (' + restCost(st) + 'g)');
  rest.disabled = st.gold < restCost(st) || st.hp >= d.maxHp;
  rest.addEventListener('click', () => {
    st.gold -= restCost(st);
    st.hp = d.maxHp; st.mana = d.maxMana;
    toast('You sleep until dawn');
    refreshPanel(); ctx.refresh(); ctx.save();
  });
  body.append(rest);

  return shell('Village Gate', 'Where the road starts.', body, 620);
}

export function restCost(st: GameState): number {
  return Math.max(5, Math.round(12 * st.village.npcs[0].priceMod));
}

// -------------------------------------------------------------- SHOP RESET

export function restockShop(st: GameState): void {
  st.shopStock = rollShopStock(rng, st.village);
}

export function grantStarterKit(st: GameState): void {
  autoPlace(st.bag, makeItem(rng, 'healing_draught', 'common'));
}
