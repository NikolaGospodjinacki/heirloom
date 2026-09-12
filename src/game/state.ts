import type {
  ClassId, Hero, Homestead, Item, Quest, SkillKey, Stats, Village,
} from './types';
import { RNG, rng, uid } from './rng';
import { Grid, makeGrid, autoPlace } from './backpack';
import { ITEM_DEFS, itemMods, makeItem } from './items';
import {
  BloodlineMemory, emptySkills, levelFromXp, rollHero, rollVillage,
} from './bloodline';
import { rollQuests, SHOP_STOCK_POOL, SHOP_STOCK_RICH, ZONES } from './content';

export const SAVE_KEY = 'heirloom.save.v1';

export interface Lifetime {
  kills: number;
  questsDone: number;
  goldEarned: number;
  treesFelled: number;
  rocksMined: number;
  born: number;
}

export interface GameState {
  version: number;
  seed: number;
  hero: Hero;
  bag: Grid;
  chest: Grid;
  gold: number;
  village: Village;
  homestead: Homestead;
  board: Quest[];
  active: Quest | null;
  shopStock: Item[];
  scene: 'creation' | 'town' | 'zone' | 'death';
  zoneId: string;
  hp: number;
  mana: number;
  lifetime: Lifetime;
  legacy: BloodlineMemory;
  generation: number;
  donated: number;
  log: { t: string; kind: string; at: number }[];
  lastRealTick: number;
  epitaphs: { name: string; gen: number; cause: string; kills: number }[];
}

export const PLOT_DEFS = [
  { id: 'herbs', name: 'Herb Patch', resource: 'herb', cost: 0, per: 1, secs: 2.5, sell: 4 },
  { id: 'orchard', name: 'Orchard', resource: 'wood', cost: 120, per: 1, secs: 3.5, sell: 7 },
  { id: 'vein', name: 'Ore Vein', resource: 'ore', cost: 400, per: 1, secs: 5, sell: 14 },
  { id: 'font', name: 'Crystal Font', resource: 'gemdust', cost: 1400, per: 1, secs: 9, sell: 40 },
];

export const RESOURCE_NAMES: Record<string, string> = {
  herb: 'Herbs', wood: 'Timber', ore: 'Ore', gemdust: 'Gem Dust',
};

function newHomestead(): Homestead {
  return {
    plots: PLOT_DEFS.map((p, i) => ({
      id: p.id, name: p.name, resource: p.resource,
      owned: i === 0, level: 1, workers: 0, progress: 0, cost: p.cost,
    })),
    resources: { herb: 0, wood: 0, ore: 0, gemdust: 0 },
  };
}

export function rollShopStock(r: RNG, village: Village): Item[] {
  const rich = village.preset === 'thriving';
  const n = rich ? 8 : 5;
  const pool = rich ? [...SHOP_STOCK_POOL, ...SHOP_STOCK_RICH] : SHOP_STOCK_POOL;
  const out: Item[] = [];
  for (let i = 0; i < n; i++) out.push(makeItem(r, r.pick(pool)));
  out.push(makeItem(r, 'healing_draught', 'common'));
  out.push(makeItem(r, 'healing_draught', 'common'));
  if (rich) out.push(makeItem(r, 'mana_draught', 'common'));
  return out;
}

export function newGame(classId: ClassId): GameState {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const r = new RNG(seed);
  const legacy: BloodlineMemory = { legacy: {}, bloodlineBonus: 0 };
  const hero = rollHero(r, classId, 1, legacy);
  const village = rollVillage(r, 50, 1);
  const bag = makeGrid(7, 6);

  const starter = classId === 'warrior'
    ? ['shortsword', 'padded_tunic', 'healing_draught']
    : ['apprentice_staff', 'wizard_hat', 'healing_draught'];
  for (const d of starter) autoPlace(bag, makeItem(r, d, 'common'));

  const st: GameState = {
    version: 1, seed, hero, bag, chest: makeGrid(5, 3),
    gold: 35, village, homestead: newHomestead(),
    board: rollQuests(r, 4, 50, 1), active: null,
    shopStock: rollShopStock(r, village),
    scene: 'town', zoneId: 'meadow',
    hp: 1, mana: 1,
    lifetime: { kills: 0, questsDone: 0, goldEarned: 0, treesFelled: 0, rocksMined: 0, born: Date.now() },
    legacy, generation: 1, donated: 0, log: [],
    lastRealTick: Date.now(), epitaphs: [],
  };
  const d = derived(st);
  st.hp = d.maxHp; st.mana = d.maxMana;
  pushLog(st, 'The ' + surname(hero.name) + ' line begins in ' + village.name + '.', 'good');
  return st;
}

export function surname(name: string): string {
  const p = name.split(' ');
  return p[p.length - 1];
}

// ------------------------------------------------------------------ derived

export interface Derived {
  maxHp: number;
  maxMana: number;
  atk: number;
  spellPower: number;
  armor: number;
  speed: number;
  crit: number;
  attackSpeed: number;
  range: number;
  attackStyle: 'swing' | 'thrust' | 'bolt';
  weapon: Item | null;
  stats: Stats;
  xpMult: number;
  luckMult: number;
  buyMult: number;
  sellMult: number;
}

export function skillLevel(st: GameState, k: SkillKey): number {
  return levelFromXp(st.hero.skills[k].xp);
}

export function derived(st: GameState): Derived {
  const h = st.hero;
  const stats: Stats = { ...h.stats };
  let hp = 0, sp = 0, armor = 0, atk = 0, speedBonus = 0, crit = 0, aspd = 0;
  let weapon: Item | null = null;

  for (const it of st.bag.items) {
    const def = ITEM_DEFS[it.defId];
    if (def.kind === 'loot' || def.kind === 'gem' || def.kind === 'consumable') continue;
    const m = itemMods(it);
    hp += m.hp ?? 0;
    sp += m.spellPower ?? 0;
    armor += m.armor ?? 0;
    atk += m.atk ?? 0;
    speedBonus += m.speed ?? 0;
    crit += m.critChance ?? 0;
    if (m.stats) for (const [k, v] of Object.entries(m.stats)) stats[k as keyof Stats] += v ?? 0;
    if (def.kind === 'weapon') {
      // best weapon by attack contribution wins the "held" slot
      const score = (m.atk ?? 0) + (m.spellPower ?? 0);
      const cur = weapon ? (itemMods(weapon).atk ?? 0) + (itemMods(weapon).spellPower ?? 0) : -1;
      if (score > cur) weapon = it;
      else aspd += 0;
    }
  }

  const t = h.trait.id;
  const vigor = skillLevel(st, 'vigor');
  const blade = skillLevel(st, 'blade');
  const sorcery = skillLevel(st, 'sorcery');

  let maxHp = 46 + stats.vit * 6 + vigor * 5 + hp;
  if (t === 'ironblood') maxHp += 30;
  if (t === 'sickly') maxHp -= 25;

  const maxMana = 24 + stats.int * 5 + sorcery * 4;

  let atkTotal = atk + stats.str * 0.9 + blade * 0.8;
  let spTotal = sp + stats.int * 1.1 + sorcery * 1.0;
  if (t === 'brute') { atkTotal *= 1.3; spTotal *= 0.75; }
  if (t === 'mageborn') { atkTotal *= 0.85; spTotal *= 1.35; }

  let speed = 118 + stats.agi * 2.2 + speedBonus;
  if (t === 'swift') speed *= 1.18;
  if (t === 'clumsy') speed *= 0.88;

  const wdef = weapon ? ITEM_DEFS[weapon.defId] : null;
  const wm = weapon ? itemMods(weapon) : null;

  let xpMult = 1;
  if (t === 'prodigy') xpMult *= 1.25;
  if (t === 'clumsy') xpMult *= 1.2;

  let luckMult = 1 + stats.luck * 0.02;
  if (t === 'lucky') luckMult += 0.35;
  if (t === 'cursed') luckMult -= 0.3;

  let buyMult = st.village.npcs[0].priceMod;
  let sellMult = 0.45 * (2 - st.village.npcs[0].priceMod);
  const hag = skillLevel(st, 'haggling');
  buyMult *= Math.max(0.6, 1 - hag * 0.012);
  sellMult *= 1 + hag * 0.018;
  if (t === 'merchant') { buyMult *= 0.85; sellMult *= 1.2; }

  return {
    maxHp: Math.max(10, Math.round(maxHp)),
    maxMana: Math.round(maxMana),
    atk: Math.max(1, Math.round(atkTotal * 10) / 10),
    spellPower: Math.max(0, Math.round(spTotal * 10) / 10),
    armor: Math.round(armor + stats.agi * 0.2),
    speed: Math.round(speed),
    crit: Math.min(0.75, 0.03 + stats.luck * 0.006 + crit),
    attackSpeed: (wm?.attackSpeed ?? 1) * (1 + stats.agi * 0.008) + aspd,
    range: wm?.range ?? 26,
    attackStyle: wdef?.attack ?? 'swing',
    weapon,
    stats,
    xpMult,
    luckMult: Math.max(0.2, luckMult),
    buyMult,
    sellMult,
  };
}

// -------------------------------------------------------------------- xp/log

export function grantXp(st: GameState, k: SkillKey, amount: number): boolean {
  const before = skillLevel(st, k);
  st.hero.skills[k].xp += Math.max(0, Math.round(amount * derived(st).xpMult));
  const after = skillLevel(st, k);
  if (after > before) {
    pushLog(st, k.toUpperCase() + ' reached level ' + after + '.', 'level');
    return true;
  }
  return false;
}

export function pushLog(st: GameState, t: string, kind = 'info'): void {
  st.log.push({ t, kind, at: Date.now() });
  if (st.log.length > 120) st.log.shift();
}

// ------------------------------------------------------------------ homestead

export function tickHomestead(st: GameState, dt: number): void {
  for (const plot of st.homestead.plots) {
    if (!plot.owned || plot.workers <= 0) continue;
    const d = PLOT_DEFS.find((p) => p.id === plot.id)!;
    const rate = plot.workers * plot.level / d.secs;
    plot.progress += rate * dt;
    if (plot.progress >= 1) {
      const got = Math.floor(plot.progress);
      plot.progress -= got;
      st.homestead.resources[plot.resource] += got * d.per;
    }
  }
}

export function clickPlot(st: GameState, plotId: string): number {
  const plot = st.homestead.plots.find((p) => p.id === plotId);
  if (!plot || !plot.owned) return 0;
  const d = PLOT_DEFS.find((p) => p.id === plot.id)!;
  const got = plot.level * d.per;
  st.homestead.resources[plot.resource] += got;
  return got;
}

export function workerCost(plot: Homestead['plots'][number]): number {
  const d = PLOT_DEFS.find((p) => p.id === plot.id)!;
  return Math.round((40 + d.cost * 0.35) * Math.pow(1.6, plot.workers));
}
export function upgradeCost(plot: Homestead['plots'][number]): number {
  const d = PLOT_DEFS.find((p) => p.id === plot.id)!;
  return Math.round((60 + d.cost * 0.5) * Math.pow(1.85, plot.level - 1));
}

// -------------------------------------------------------------------- quests

export function refreshBoard(st: GameState): void {
  const tier = Math.min(4, 1 + Math.floor(st.lifetime.questsDone / 3) + Math.floor(st.generation / 2));
  st.board = rollQuests(rng, 4, st.village.prosperity, tier);
}

export function completeQuest(st: GameState): void {
  const q = st.active;
  if (!q || q.have < q.need) return;
  st.gold += q.rewardGold;
  st.lifetime.goldEarned += q.rewardGold;
  st.lifetime.questsDone++;
  grantXp(st, q.rewardSkill, q.rewardXp);
  grantXp(st, 'haggling', 12);
  st.village.prosperity = Math.min(100, st.village.prosperity + 1.5 + q.danger * 0.5);
  if (q.rewardItemDef) {
    const it = makeItem(rng, q.rewardItemDef);
    if (!autoPlace(st.bag, it)) pushLog(st, 'No room for ' + it.name + ' - it was left behind.', 'bad');
    else pushLog(st, 'Reward: ' + it.name, 'good');
  }
  pushLog(st, 'Quest complete: ' + q.title + '  (+' + q.rewardGold + 'g)', 'good');
  st.active = null;
  refreshBoard(st);
}

// ---------------------------------------------------------------- death/heir

export function die(st: GameState, cause: string): void {
  st.epitaphs.unshift({
    name: st.hero.name, gen: st.generation, cause, kills: st.lifetime.kills,
  });
  if (st.epitaphs.length > 12) st.epitaphs.pop();

  // Memories: a slice of every skill carries into the blood.
  const retain = 0.25 + Math.min(0.25, st.generation * 0.02);
  const legacy: BloodlineMemory = { legacy: {}, bloodlineBonus: st.legacy.bloodlineBonus };
  for (const k of Object.keys(st.hero.skills) as SkillKey[]) {
    const carried = Math.floor(st.hero.skills[k].xp * retain) + Math.floor((st.legacy.legacy[k] ?? 0) * 0.5);
    if (carried > 0) legacy.legacy[k] = carried;
  }
  // Deeds harden the bloodline itself.
  if (st.lifetime.questsDone >= 3) legacy.bloodlineBonus += 1;
  if (st.lifetime.kills >= 40) legacy.bloodlineBonus += 1;
  legacy.bloodlineBonus = Math.min(8, legacy.bloodlineBonus);

  // The village moves on without you.
  const drift = -4 + st.donated / 220 + st.lifetime.questsDone * 0.9;
  const prosperity = Math.max(5, Math.min(100, st.village.prosperity + drift));
  const gen = st.generation + 1;
  const village = rollVillage(rng, prosperity, st.village.era + 1, st.village.name);

  const hero = rollHero(rng, st.hero.classId, gen, legacy);

  st.hero = hero;
  st.generation = gen;
  st.legacy = legacy;
  st.village = village;
  // The bag is lost with the body. The chest at home is family property and stays.
  st.bag = makeGrid(7, 6);
  st.gold = Math.round(st.gold * 0.25) + 20;
  st.donated = 0;
  st.lifetime = { kills: 0, questsDone: 0, goldEarned: 0, treesFelled: 0, rocksMined: 0, born: Date.now() };
  st.active = null;
  st.shopStock = rollShopStock(rng, village);
  refreshBoard(st);
  const d = derived(st);
  st.hp = d.maxHp; st.mana = d.maxMana;
  st.scene = 'town';
  pushLog(st, hero.name + ' takes up the name. Generation ' + gen + '.', 'good');
}

export function classSkills(c: ClassId): SkillKey[] {
  return c === 'warrior' ? ['blade', 'vigor'] : ['sorcery', 'vigor'];
}

// ------------------------------------------------------------------- persist

export function save(st: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(st));
  } catch { /* quota / private mode - not fatal */ }
}

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const st = JSON.parse(raw) as GameState;
    if (st.version !== 1) return null;
    if (!st.hero || !st.bag) return null;
    // A run in progress is abandoned on reload; you wake up in town.
    if (st.scene === 'zone') st.scene = 'town';
    if (!st.hero.skills) st.hero.skills = emptySkills();
    st.lastRealTick = Date.now();
    return st;
  } catch {
    return null;
  }
}

export function wipe(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export function zoneName(id: string): string {
  return ZONES[id]?.name ?? id;
}

export function newUid(): string { return uid(); }
