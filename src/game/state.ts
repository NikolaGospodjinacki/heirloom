import type {
  ClassId, EquipSlot, Hero, Homestead, Item, Quest, SkillKey, Stats, Village,
} from './types';
import { EQUIP_SLOTS } from './types';
import { RNG, rng, uid } from './rng';
import { Grid, makeGrid, autoPlace, remove } from './backpack';
import { ITEM_DEFS, itemMods, makeItem, slotOf } from './items';
import {
  BloodlineMemory, emptySkills, levelFromXp, rollHero, rollVillage,
} from './bloodline';
import { rollQuests, SHOP_STOCK_POOL, SHOP_STOCK_RICH, ZONES } from './content';
import { DashProfile, dashProfile, memoryEarned } from './techniques';

export const SAVE_KEY = 'heirloom.save.v2';
export const SAVE_VERSION = 2;

export interface Lifetime {
  kills: number;
  questsDone: number;
  bosses: number;
  goldEarned: number;
  treesFelled: number;
  rocksMined: number;
  born: number;
}

export type Equipment = Record<EquipSlot, Item | null>;

export function emptyEquipment(): Equipment {
  return { weapon: null, offhand: null, head: null, body: null, feet: null, tool: null };
}

export interface GameState {
  version: number;
  seed: number;
  hero: Hero;
  bag: Grid;
  equipped: Equipment;
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
  stamina: number;
  lifetime: Lifetime;
  legacy: BloodlineMemory;
  generation: number;
  donated: number;
  /** bloodline knowledge, kept across deaths */
  techniques: string[];
  memory: number;
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
  const equipped = emptyEquipment();

  const starter = classId === 'warrior'
    ? ['shortsword', 'padded_tunic', 'axe']
    : ['apprentice_staff', 'wizard_hat', 'axe'];
  for (const d of starter) {
    const it = makeItem(r, d, 'common');
    const slot = slotOf(it);
    if (slot) equipped[slot] = it; else autoPlace(bag, it);
  }
  autoPlace(bag, makeItem(r, 'healing_draught', 'common'));

  const st: GameState = {
    version: SAVE_VERSION, seed, hero, bag, equipped, chest: makeGrid(5, 3),
    gold: 35, village, homestead: newHomestead(),
    board: rollQuests(r, 4, 50, 1), active: null,
    shopStock: rollShopStock(r, village),
    scene: 'town', zoneId: 'meadow',
    hp: 1, mana: 1, stamina: 1,
    lifetime: { kills: 0, questsDone: 0, bosses: 0, goldEarned: 0, treesFelled: 0, rocksMined: 0, born: Date.now() },
    legacy, generation: 1, donated: 0,
    techniques: ['dash', 'jump'], memory: 1,
    log: [], lastRealTick: Date.now(), epitaphs: [],
  };
  const d = derived(st);
  st.hp = d.maxHp; st.mana = d.maxMana; st.stamina = d.maxStamina;
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
  maxStamina: number;
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
  /** damage multipliers by target family */
  beastMult: number;
  slayMult: number;
  goldMult: number;
  boltCost: number;
  /** seconds rooted at the start of a cast */
  castTime: number;
  manaRegen: number;
  hpRegen: number;
  staminaRegen: number;
  chopMult: number;
  mineMult: number;
  /** how hard the equipped tool bites; 0 means bare hands */
  chopPower: number;
  minePower: number;
  tool: Item | null;
  dash: DashProfile;
  jump: { height: number; duration: number; staminaCost: number; pounce: boolean };
}

export function skillLevel(st: GameState, k: SkillKey): number {
  return levelFromXp(st.hero.skills[k]?.xp ?? 0);
}

/** Everything the hero is currently benefiting from: worn gear + loose accessories. */
export function activeItems(st: GameState): Item[] {
  const out: Item[] = [];
  for (const s of EQUIP_SLOTS) {
    const it = st.equipped[s];
    if (it) out.push(it);
  }
  for (const it of st.bag.items) {
    const k = ITEM_DEFS[it.defId].kind;
    if (k === 'trinket') out.push(it);
  }
  return out;
}

export function derived(st: GameState): Derived {
  const h = st.hero;
  const stats: Stats = { ...h.stats };
  let hp = 0, sp = 0, armor = 0, atk = 0, speedBonus = 0, crit = 0;

  for (const it of activeItems(st)) {
    const m = itemMods(it);
    hp += m.hp ?? 0;
    sp += m.spellPower ?? 0;
    armor += m.armor ?? 0;
    atk += m.atk ?? 0;
    speedBonus += m.speed ?? 0;
    crit += m.critChance ?? 0;
    if (m.stats) for (const [k, v] of Object.entries(m.stats)) stats[k as keyof Stats] += v ?? 0;
  }

  const weapon = st.equipped.weapon;
  const tool = st.equipped.tool;
  const toolMods = tool ? itemMods(tool) : null;
  const t = h.trait.id;
  const L = (k: SkillKey) => skillLevel(st, k);
  const vigor = L('vigor'), blade = L('blade'), sorcery = L('sorcery');
  const hunting = L('hunting'), slaying = L('slaying'), foot = L('footwork');
  const hag = L('haggling');

  let maxHp = 46 + stats.vit * 6 + vigor * 5 + hp;
  if (t === 'ironblood') maxHp += 30;
  if (t === 'sickly') maxHp -= 25;

  const maxMana = 24 + stats.int * 5 + sorcery * 4;
  const maxStamina = 60 + stats.agi * 2 + foot * 2;

  let atkTotal = atk + stats.str * 0.9 + blade * 0.9;
  let spTotal = sp + stats.int * 0.92 + sorcery * 0.95;
  if (t === 'brute') { atkTotal *= 1.3; spTotal *= 0.75; }
  if (t === 'mageborn') { atkTotal *= 0.85; spTotal *= 1.35; }

  let speed = 118 + stats.agi * 2.2 + foot * 1.6 + speedBonus;
  if (t === 'swift') speed *= 1.18;
  if (t === 'clumsy') speed *= 0.88;
  if (st.techniques.includes('long_stride')) speed *= 1.12;

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
  buyMult *= Math.max(0.6, 1 - hag * 0.012);
  sellMult *= 1 + hag * 0.018;
  if (t === 'merchant') { buyMult *= 0.85; sellMult *= 1.2; }

  return {
    maxHp: Math.max(10, Math.round(maxHp)),
    maxMana: Math.round(maxMana),
    maxStamina: Math.round(maxStamina),
    atk: Math.max(1, Math.round(atkTotal * 10) / 10),
    spellPower: Math.max(0, Math.round(spTotal * 10) / 10),
    armor: Math.round(armor + stats.agi * 0.2 + vigor * 0.4),
    speed: Math.round(speed),
    crit: Math.min(0.75, 0.03 + stats.luck * 0.006 + blade * 0.0035 + crit),
    attackSpeed: (wm?.attackSpeed ?? 1) * (1 + stats.agi * 0.008),
    range: wm?.range ?? 26,
    attackStyle: wdef?.attack ?? 'swing',
    weapon,
    stats,
    xpMult,
    luckMult: Math.max(0.2, luckMult),
    buyMult,
    sellMult,
    beastMult: 1 + hunting * 0.04,
    slayMult: 1 + slaying * 0.04,
    goldMult: 1 + slaying * 0.03,
    boltCost: Math.max(4.5, 10 - sorcery * 0.16),
    castTime: Math.max(0.13, 0.26 - sorcery * 0.004),
    manaRegen: 0.9 + stats.int * 0.07 + sorcery * 0.05,
    hpRegen: 0.6 + vigor * 0.09,
    staminaRegen: 11 + foot * 0.6,
    chopMult: 1 + L('woodcutting') * 0.08,
    mineMult: 1 + L('mining') * 0.08,
    chopPower: toolMods?.chop ?? 0,
    minePower: toolMods?.mine ?? 0,
    tool,
    dash: dashProfile(st.techniques, foot),
    jump: {
      height: st.techniques.includes('high_vault') ? 44 : 32,
      duration: st.techniques.includes('high_vault') ? 0.52 : 0.42,
      staminaCost: 12,
      pounce: st.techniques.includes('pounce'),
    },
  };
}

// -------------------------------------------------------------------- equip

/** Move an item from the pack into its slot. Whatever was there goes back to the pack. */
export function equip(st: GameState, it: Item): boolean {
  const slot = slotOf(it);
  if (!slot) return false;
  const prev = st.equipped[slot];
  remove(st.bag, it.uid);
  st.equipped[slot] = it;
  if (prev) {
    if (!autoPlace(st.bag, prev)) {
      // no room for the old piece: put it back on and abort
      st.equipped[slot] = prev;
      autoPlace(st.bag, it);
      return false;
    }
  }
  pushLog(st, 'Equipped ' + it.name + '.', 'info');
  return true;
}

export function unequip(st: GameState, slot: EquipSlot): boolean {
  const it = st.equipped[slot];
  if (!it) return false;
  if (!autoPlace(st.bag, it)) return false;
  st.equipped[slot] = null;
  return true;
}

// -------------------------------------------------------------------- xp/log

/** Set by grantXp so the HUD can show the skill you are actually training. */
export interface XpPing { skill: SkillKey; amount: number; level: number; levelled: boolean; at: number }
export let lastXp: XpPing | null = null;
export function clearXpPing(): void { lastXp = null; }

export function grantXp(st: GameState, k: SkillKey, amount: number): boolean {
  if (!st.hero.skills[k]) st.hero.skills[k] = { xp: 0 };
  const before = skillLevel(st, k);
  const gained = Math.max(0, Math.round(amount * derived(st).xpMult));
  st.hero.skills[k].xp += gained;
  const after = skillLevel(st, k);
  const levelled = after > before;
  if (gained > 0) lastXp = { skill: k, amount: gained, level: after, levelled, at: performance.now() };
  if (levelled) pushLog(st, skillTitle(k) + ' level ' + after + '.', 'level');
  return levelled;
}

function skillTitle(k: SkillKey): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
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
  if (q.kind === 'boss') st.lifetime.bosses++;
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

  const retain = 0.25 + Math.min(0.25, st.generation * 0.02);
  const legacy: BloodlineMemory = { legacy: {}, bloodlineBonus: st.legacy.bloodlineBonus };
  for (const k of Object.keys(st.hero.skills) as SkillKey[]) {
    const carried = Math.floor(st.hero.skills[k].xp * retain) + Math.floor((st.legacy.legacy[k] ?? 0) * 0.5);
    if (carried > 0) legacy.legacy[k] = carried;
  }
  if (st.lifetime.questsDone >= 3) legacy.bloodlineBonus += 1;
  if (st.lifetime.kills >= 40) legacy.bloodlineBonus += 1;
  legacy.bloodlineBonus = Math.min(8, legacy.bloodlineBonus);

  const earned = memoryEarned(st.lifetime.kills, st.lifetime.questsDone, st.lifetime.bosses, st.generation);
  st.memory += earned;

  const drift = -4 + st.donated / 220 + st.lifetime.questsDone * 0.9;
  const prosperity = Math.max(5, Math.min(100, st.village.prosperity + drift));
  const gen = st.generation + 1;
  const village = rollVillage(rng, prosperity, st.village.era + 1, st.village.name, st.village.npcs);
  const hero = rollHero(rng, st.hero.classId, gen, legacy);

  st.hero = hero;
  st.generation = gen;
  st.legacy = legacy;
  st.village = village;
  // The pack and everything worn is buried with the body. The chest at home is not.
  st.bag = makeGrid(7, 6);
  st.equipped = emptyEquipment();
  st.gold = Math.round(st.gold * 0.25) + 20;
  st.donated = 0;
  st.lifetime = { kills: 0, questsDone: 0, bosses: 0, goldEarned: 0, treesFelled: 0, rocksMined: 0, born: Date.now() };
  st.active = null;
  st.shopStock = rollShopStock(rng, village);
  refreshBoard(st);
  const d = derived(st);
  st.hp = d.maxHp; st.mana = d.maxMana; st.stamina = d.maxStamina;
  st.scene = 'town';
  pushLog(st, hero.name + ' takes up the name. Generation ' + gen + '.', 'good');
}

export function lastMemoryEarned(st: GameState): number {
  return memoryEarned(st.lifetime.kills, st.lifetime.questsDone, st.lifetime.bosses, st.generation);
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
    if (st.version !== SAVE_VERSION) return null;
    if (!st.hero || !st.bag) return null;
    if (st.scene === 'zone') st.scene = 'town';
    if (!st.hero.skills) st.hero.skills = emptySkills();
    for (const k of Object.keys(emptySkills()) as SkillKey[]) {
      if (!st.hero.skills[k]) st.hero.skills[k] = { xp: 0 };
    }
    if (!st.equipped) st.equipped = emptyEquipment();
    if (st.equipped.tool === undefined) (st.equipped as Equipment).tool = null;
    if (!st.techniques.includes('jump')) st.techniques.push('jump');
    if (!st.techniques) st.techniques = ['dash'];
    if (typeof st.memory !== 'number') st.memory = 0;
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
