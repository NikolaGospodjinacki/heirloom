import type { Item, ItemDef, Rarity, Shape, ItemMods } from './types';
import { RARITY_MULT } from './types';
import { RNG, uid } from './rng';

const S = {
  d1: [[0, 0]] as Shape,
  v2: [[0, 0], [0, 1]] as Shape,
  v3: [[0, 0], [0, 1], [0, 2]] as Shape,
  v4: [[0, 0], [0, 1], [0, 2], [0, 3]] as Shape,
  h2: [[0, 0], [1, 0]] as Shape,
  sq2: [[0, 0], [1, 0], [0, 1], [1, 1]] as Shape,
  rect23: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]] as Shape,
  ell: [[0, 0], [0, 1], [1, 1]] as Shape,
};

export const ITEM_DEFS: Record<string, ItemDef> = {};
function def(d: ItemDef) { ITEM_DEFS[d.defId] = d; return d; }

// ---------------------------------------------------------------- weapons
def({ defId: 'shortsword', name: 'Shortsword', kind: 'weapon', shape: S.v3, tier: 1, baseValue: 26, color: '#c9ccd6',
  attack: 'swing', mods: { atk: 7, range: 34, attackSpeed: 1 }, desc: 'Honest steel.' });
def({ defId: 'dagger', name: 'Dagger', kind: 'weapon', shape: S.v2, tier: 1, baseValue: 18, color: '#d6d2c4',
  attack: 'thrust', mods: { atk: 4, range: 26, attackSpeed: 1.6, critChance: 0.1 }, desc: 'Quick and mean.' });
def({ defId: 'greatsword', name: 'Greatsword', kind: 'weapon', shape: S.v4, tier: 2, baseValue: 70, color: '#aeb6c4',
  attack: 'swing', mods: { atk: 16, range: 44, attackSpeed: 0.62 }, desc: 'Takes both hands and a grudge.' });
def({ defId: 'axe', name: 'Woodsman Axe', kind: 'weapon', shape: S.ell, tier: 1, baseValue: 34, color: '#b98a52',
  attack: 'swing', mods: { atk: 9, range: 32, attackSpeed: 0.85 }, desc: 'Fells trees twice as fast.' });
def({ defId: 'pickaxe', name: 'Pickaxe', kind: 'weapon', shape: S.ell, tier: 1, baseValue: 34, color: '#8d94a3',
  attack: 'swing', mods: { atk: 6, range: 30, attackSpeed: 0.9 }, desc: 'Bites stone twice as fast.' });
def({ defId: 'apprentice_staff', name: 'Apprentice Staff', kind: 'weapon', shape: S.v3, tier: 1, baseValue: 30, color: '#8f6ac2',
  attack: 'bolt', mods: { atk: 3, spellPower: 8, range: 190, attackSpeed: 0.9 }, desc: 'Hums when it rains.' });
def({ defId: 'runewood_staff', name: 'Runewood Staff', kind: 'weapon', shape: S.v4, tier: 2, baseValue: 82, color: '#6f4fd6',
  attack: 'bolt', mods: { atk: 4, spellPower: 17, range: 220, attackSpeed: 0.85 }, desc: 'Old words, still angry.' });
def({ defId: 'wand', name: 'Hazel Wand', kind: 'weapon', shape: S.v2, tier: 1, baseValue: 22, color: '#a37ddb',
  attack: 'bolt', mods: { atk: 2, spellPower: 5, range: 165, attackSpeed: 1.5 }, desc: 'Chatty little thing.' });

// ---------------------------------------------------------------- armour
def({ defId: 'buckler', name: 'Buckler', kind: 'offhand', shape: S.sq2, tier: 1, baseValue: 28, color: '#8a6f4a',
  mods: { armor: 4, hp: 8 } });
def({ defId: 'kite_shield', name: 'Kite Shield', kind: 'offhand', shape: S.rect23, tier: 2, baseValue: 64, color: '#6c7f9c',
  mods: { armor: 10, hp: 22, speed: -6 } });
def({ defId: 'leather_cap', name: 'Leather Cap', kind: 'head', shape: S.h2, tier: 1, baseValue: 16, color: '#8b6239',
  mods: { armor: 2, hp: 6 } });
def({ defId: 'iron_helm', name: 'Iron Helm', kind: 'head', shape: S.sq2, tier: 2, baseValue: 44, color: '#9aa1ab',
  mods: { armor: 6, hp: 14 } });
def({ defId: 'wizard_hat', name: 'Pointed Hat', kind: 'head', shape: S.ell, tier: 1, baseValue: 24, color: '#5f4a9c',
  mods: { spellPower: 5, hp: 4 } });
def({ defId: 'padded_tunic', name: 'Padded Tunic', kind: 'body', shape: S.rect23, tier: 1, baseValue: 32, color: '#8f7a5a',
  mods: { armor: 5, hp: 18 } });
def({ defId: 'chainmail', name: 'Chainmail', kind: 'body', shape: S.rect23, tier: 2, baseValue: 88, color: '#98a0ac',
  mods: { armor: 13, hp: 34, speed: -8 } });
def({ defId: 'robe', name: 'Star-Thread Robe', kind: 'body', shape: S.rect23, tier: 2, baseValue: 76, color: '#4b3f8f',
  mods: { armor: 3, spellPower: 12, hp: 12 } });
def({ defId: 'boots', name: 'Travel Boots', kind: 'feet', shape: S.h2, tier: 1, baseValue: 20, color: '#7a5533',
  mods: { armor: 1, speed: 14 } });

// ---------------------------------------------------------------- trinkets
def({ defId: 'copper_ring', name: 'Copper Ring', kind: 'trinket', shape: S.d1, tier: 1, baseValue: 30, color: '#c98b4b',
  mods: { stats: { luck: 1 } } });
def({ defId: 'bone_charm', name: 'Bone Charm', kind: 'trinket', shape: S.d1, tier: 1, baseValue: 34, color: '#ded6bd',
  mods: { critChance: 0.05 } });
def({ defId: 'heart_locket', name: 'Heart Locket', kind: 'trinket', shape: S.d1, tier: 2, baseValue: 60, color: '#d1596b',
  mods: { hp: 25 } });

// ---------------------------------------------------------------- consumable
def({ defId: 'healing_draught', name: 'Healing Draught', kind: 'consumable', shape: S.v2, tier: 1, baseValue: 25, color: '#d4525f',
  desc: 'Restores 45 health. Right-click to drink.' });
def({ defId: 'mana_draught', name: 'Mana Draught', kind: 'consumable', shape: S.v2, tier: 1, baseValue: 25, color: '#4f7fd4',
  desc: 'Restores 40 mana. Right-click to drink.' });

// ---------------------------------------------------------------- loot / gems
const loot = (id: string, name: string, v: number, c: string, tags: string[], shape: Shape = S.d1) =>
  def({ defId: id, name, kind: 'loot', shape, tier: 1, baseValue: v, color: c, tags, stackable: true });

loot('boar_hide', 'Boar Hide', 9, '#8a6144', ['beast'], S.h2);
loot('boar_tusk', 'Boar Tusk', 12, '#e3dcc4', ['beast']);
loot('wolf_pelt', 'Wolf Pelt', 15, '#8e8e96', ['beast'], S.h2);
loot('slime_core', 'Slime Core', 11, '#6fd08c', ['ooze']);
loot('goblin_ear', 'Goblin Ear', 8, '#7fa054', ['humanoid']);
loot('bandit_purse', 'Cut Purse', 30, '#c2a24b', ['humanoid']);
loot('rotten_fang', 'Rotten Fang', 18, '#cfc7ae', ['undead']);
loot('log', 'Oak Log', 6, '#8a6033', ['wood'], S.h2);
loot('heartwood', 'Heartwood', 40, '#c07f3a', ['wood'], S.h2);
loot('iron_ore', 'Iron Ore', 10, '#95999f', ['stone']);
loot('silver_ore', 'Silver Ore', 26, '#c9cdd6', ['stone']);
def({ defId: 'gem', name: 'Rough Gem', kind: 'gem', shape: S.d1, tier: 1, baseValue: 55, color: '#57d4d0',
  stackable: true, tags: ['gem'], desc: 'Smiths use these to enhance gear.' });
def({ defId: 'monster_heart', name: 'Monster Heart', kind: 'loot', shape: S.sq2, tier: 3, baseValue: 140, color: '#b0364b',
  stackable: true, tags: ['boss'], desc: 'Still warm. Collectors pay dearly.' });

// ---------------------------------------------------------------- affixes
interface Affix { name: string; prefix: boolean; mods: ItemMods; weight: number }
const AFFIXES: Affix[] = [
  { name: 'Keen', prefix: true, weight: 3, mods: { critChance: 0.06 } },
  { name: 'Heavy', prefix: true, weight: 3, mods: { atk: 4, attackSpeed: -0.12 } },
  { name: 'Swift', prefix: true, weight: 3, mods: { attackSpeed: 0.2 } },
  { name: 'Sturdy', prefix: true, weight: 3, mods: { armor: 4, hp: 10 } },
  { name: 'Arcane', prefix: true, weight: 3, mods: { spellPower: 6 } },
  { name: 'Fleet', prefix: true, weight: 2, mods: { speed: 12 } },
  { name: 'Cruel', prefix: true, weight: 2, mods: { atk: 6 } },
  { name: 'of the Bear', prefix: false, weight: 3, mods: { stats: { str: 2 }, hp: 12 } },
  { name: 'of the Fox', prefix: false, weight: 3, mods: { stats: { agi: 2 }, speed: 8 } },
  { name: 'of the Owl', prefix: false, weight: 3, mods: { stats: { int: 2 }, spellPower: 4 } },
  { name: 'of the Ox', prefix: false, weight: 3, mods: { stats: { vit: 3 } } },
  { name: 'of Fortune', prefix: false, weight: 2, mods: { stats: { luck: 3 } } },
  { name: 'of Reach', prefix: false, weight: 2, mods: { range: 10 } },
];

function mergeMods(a: ItemMods, b: ItemMods, scale = 1): ItemMods {
  const out: ItemMods = { ...a, stats: { ...(a.stats ?? {}) } };
  for (const k of Object.keys(b) as (keyof ItemMods)[]) {
    if (k === 'stats') continue;
    const bv = b[k] as number | undefined;
    if (bv === undefined) continue;
    out[k] = (((out[k] as number) ?? 0) + bv * scale) as never;
  }
  if (b.stats) {
    for (const [k, v] of Object.entries(b.stats)) {
      const key = k as keyof NonNullable<ItemMods['stats']>;
      out.stats![key] = (out.stats![key] ?? 0) + Math.round((v ?? 0) * scale);
    }
  }
  return out;
}

function roundMods(m: ItemMods): ItemMods {
  const out: ItemMods = { stats: m.stats };
  for (const k of Object.keys(m) as (keyof ItemMods)[]) {
    if (k === 'stats') continue;
    const v = m[k] as number | undefined;
    if (v === undefined) continue;
    out[k] = (k === 'critChance' || k === 'attackSpeed' ? Math.round(v * 100) / 100 : Math.round(v)) as never;
  }
  if (out.stats && Object.keys(out.stats).length === 0) delete out.stats;
  return out;
}

const RARITY_TABLE: [Rarity, number][] = [
  ['common', 0.58], ['uncommon', 0.26], ['rare', 0.11], ['epic', 0.042], ['legendary', 0.008],
];

export function rollRarity(r: RNG, luckBonus = 0): Rarity {
  let roll = r.next() - luckBonus * 0.015;
  for (const [rar, w] of RARITY_TABLE) {
    roll -= w;
    if (roll <= 0) return rar;
  }
  return 'common';
}

export function makeItem(r: RNG, defId: string, rarity?: Rarity, count = 1): Item {
  const d = ITEM_DEFS[defId];
  if (!d) throw new Error('no such item def: ' + defId);
  const plain = d.kind === 'loot' || d.kind === 'gem' || d.kind === 'consumable';
  const rar: Rarity = rarity ?? (plain ? 'common' : rollRarity(r));
  const mult = RARITY_MULT[rar];
  let mods: ItemMods = mergeMods({}, d.mods ?? {}, plain ? 1 : mult);
  // range and base swing speed are weapon identity, not rarity scaling
  if (d.mods?.range) mods.range = d.mods.range;
  if (d.mods?.attackSpeed) mods.attackSpeed = d.mods.attackSpeed;

  let name = d.name;
  const affixCount = { common: 0, uncommon: 1, rare: 1, epic: 2, legendary: 3 }[rar];
  if (affixCount > 0 && !plain) {
    const pool = r.shuffle([...AFFIXES]);
    let pre = '', suf = '';
    for (let i = 0; i < affixCount && i < pool.length; i++) {
      const a = pool[i];
      mods = mergeMods(mods, a.mods, rar === 'legendary' ? 1.4 : 1);
      if (a.prefix && !pre) pre = a.name + ' ';
      else if (!a.prefix && !suf) suf = ' ' + a.name;
      else if (!pre) pre = a.name + ' ';
    }
    name = pre + name + suf;
  }
  mods = roundMods(mods);
  const value = Math.max(1, Math.round(d.baseValue * mult * (0.85 + r.next() * 0.3)));
  return { uid: uid(), defId, name, rarity: rar, rot: 0, gx: -1, gy: -1, mods, value, plus: 0, count };
}

/** Effective mods including +enhancement. */
export function itemMods(it: Item): ItemMods {
  if (it.plus === 0) return it.mods;
  const scale = 1 + it.plus * 0.12;
  const out = mergeMods({}, it.mods, 1);
  for (const k of ['atk', 'spellPower', 'armor', 'hp'] as const) {
    if (out[k]) out[k] = Math.round((out[k] as number) * scale);
  }
  return out;
}

export function itemValue(it: Item): number {
  return Math.round(it.value * (1 + it.plus * 0.35)) * it.count;
}

export function displayName(it: Item): string {
  return it.plus > 0 ? it.name + ' +' + it.plus : it.name;
}

/** Rotate a shape n quarter turns, normalised back to the origin. */
export function rotatedShape(shape: Shape, rot: number): [number, number][] {
  let cells = shape.map(([x, y]) => [x, y] as [number, number]);
  for (let i = 0; i < (rot & 3); i++) cells = cells.map(([x, y]) => [-y, x] as [number, number]);
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY] as [number, number]);
}

export function itemCells(it: Item): [number, number][] {
  return rotatedShape(ITEM_DEFS[it.defId].shape, it.rot);
}

export function shapeSize(shape: Shape, rot: number): [number, number] {
  const cells = rotatedShape(shape, rot);
  return [Math.max(...cells.map((c) => c[0])) + 1, Math.max(...cells.map((c) => c[1])) + 1];
}

export function isGear(it: Item): boolean {
  const k = ITEM_DEFS[it.defId].kind;
  return k === 'weapon' || k === 'offhand' || k === 'head' || k === 'body' || k === 'feet' || k === 'trinket';
}
