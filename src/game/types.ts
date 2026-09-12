export type ClassId = 'warrior' | 'wizard';

export type StatKey = 'str' | 'int' | 'vit' | 'agi' | 'luck';
export type Stats = Record<StatKey, number>;

export const STAT_NAMES: Record<StatKey, string> = {
  str: 'Strength',
  int: 'Intellect',
  vit: 'Vitality',
  agi: 'Agility',
  luck: 'Luck',
};

export type SkillKey =
  | 'blade' | 'sorcery' | 'hunting' | 'slaying'
  | 'woodcutting' | 'mining' | 'haggling' | 'vigor';

export const SKILL_NAMES: Record<SkillKey, string> = {
  blade: 'Bladework',
  sorcery: 'Sorcery',
  hunting: 'Hunting',
  slaying: 'Slaying',
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  haggling: 'Haggling',
  vigor: 'Vigor',
};

export type Skills = Record<SkillKey, { xp: number }>;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#b9b4a7',
  uncommon: '#63c76a',
  rare: '#5a9ded',
  epic: '#b464e0',
  legendary: '#e8a33d',
};

export const RARITY_MULT: Record<Rarity, number> = {
  common: 1, uncommon: 1.35, rare: 1.8, epic: 2.5, legendary: 3.6,
};

export type ItemKind =
  | 'weapon' | 'offhand' | 'head' | 'body' | 'feet' | 'trinket'
  | 'consumable' | 'loot' | 'gem' | 'tool';

/** Cell offsets, origin top-left. e.g. a 1x3 sword is [[0,0],[0,1],[0,2]] */
export type Shape = ReadonlyArray<readonly [number, number]>;

export interface ItemMods {
  atk?: number;
  spellPower?: number;
  armor?: number;
  hp?: number;
  speed?: number;
  critChance?: number;
  attackSpeed?: number;   // multiplier, 1.1 = 10% faster
  range?: number;         // weapons only, in world px
  /** flat stat bonuses */
  stats?: Partial<Stats>;
}

export interface ItemDef {
  defId: string;
  name: string;
  kind: ItemKind;
  shape: Shape;
  baseValue: number;
  mods?: ItemMods;
  /** weapon delivery style */
  attack?: 'swing' | 'thrust' | 'bolt';
  tier: number;
  desc?: string;
  color: string;
  /** loot only: what monster/activity family it comes from */
  tags?: string[];
  stackable?: boolean;
}

export interface Item {
  uid: string;
  defId: string;
  name: string;
  rarity: Rarity;
  /** rotation in 90-degree steps */
  rot: 0 | 1 | 2 | 3;
  /** grid position, null if not placed */
  gx: number;
  gy: number;
  mods: ItemMods;
  value: number;
  /** enhancement level from gems */
  plus: number;
  count: number;
}

export interface Appearance {
  skin: string;
  hair: string;
  cloth: string;
  accent: string;
  build: number;      // 0..1 slim..broad
  hairStyle: number;
  height: number;     // 0.9..1.15
}

export interface Trait {
  id: string;
  name: string;
  desc: string;
  good: boolean;
}

export interface Hero {
  name: string;
  classId: ClassId;
  stats: Stats;
  appearance: Appearance;
  skills: Skills;
  hp: number;
  mana: number;
  trait: Trait;
  /** memories carried from prior lives */
  generation: number;
}

export type QuestKind = 'kill' | 'gather' | 'chop' | 'mine' | 'boss';

export interface Quest {
  id: string;
  title: string;
  kind: QuestKind;
  target: string;       // monsterId / resource id
  targetName: string;
  need: number;
  have: number;
  zoneId: string;
  rewardGold: number;
  rewardXp: number;
  rewardSkill: SkillKey;
  rewardItemDef?: string;
  giver: string;
  flavor: string;
  danger: number;
}

export interface VillageNPC {
  role: 'shopkeeper' | 'guildmaster' | 'smith';
  name: string;
  line: string;
  priceMod: number;
}

export interface Village {
  name: string;
  prosperity: number;      // 0..100
  era: number;             // increments each generation
  npcs: VillageNPC[];
  preset: 'thriving' | 'struggling';
}

export interface Homestead {
  plots: {
    id: string;
    name: string;
    resource: string;
    owned: boolean;
    level: number;
    workers: number;
    progress: number;
    cost: number;
  }[];
  resources: Record<string, number>;
}
