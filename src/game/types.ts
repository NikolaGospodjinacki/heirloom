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
  | 'woodcutting' | 'mining' | 'haggling' | 'vigor' | 'footwork';

export const SKILL_NAMES: Record<SkillKey, string> = {
  blade: 'Bladework',
  sorcery: 'Sorcery',
  hunting: 'Hunting',
  slaying: 'Slaying',
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  haggling: 'Haggling',
  vigor: 'Vigor',
  footwork: 'Footwork',
};

/** What each level actually buys you. Shown verbatim in the skills panel. */
export const SKILL_EFFECT: Record<SkillKey, string> = {
  blade: '+0.9 attack, +0.35% crit',
  sorcery: '+1.1 spell power, +4 max mana, cheaper bolts',
  hunting: '+4% damage to beasts, +3% beast drop rate',
  slaying: '+4% damage to monsters and men, +3% gold from kills',
  woodcutting: '+8% chop speed, better wood',
  mining: '+8% mining speed, better ore and gems',
  haggling: 'buy 1.2% cheaper, sell 1.8% dearer',
  vigor: '+5 max health, +0.4 armour, faster recovery',
  footwork: '+1.6 move speed, -1.5% dash cooldown, +2 stamina',
};

export const SKILL_COLOR: Record<SkillKey, string> = {
  blade: '#d8896a',
  sorcery: '#9a7bd6',
  hunting: '#8fb85f',
  slaying: '#d0605a',
  woodcutting: '#b0813f',
  mining: '#8f98a8',
  haggling: '#e0b64f',
  vigor: '#5fae7a',
  footwork: '#5fb0d4',
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

/** The five paper-doll slots. Everything else lives loose in the pack. */
export type EquipSlot = 'weapon' | 'offhand' | 'head' | 'body' | 'feet' | 'tool';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'offhand', 'head', 'body', 'feet', 'tool'];
export const SLOT_NAMES: Record<EquipSlot, string> = {
  weapon: 'Weapon', offhand: 'Off-hand', head: 'Head', body: 'Body', feet: 'Feet', tool: 'Tool',
};

/** How a piece of gear is drawn on the little person. */
export type Silhouette =
  | 'sword' | 'greatsword' | 'dagger' | 'axe' | 'pick' | 'staff' | 'wand'
  | 'shield_small' | 'shield_tall'
  | 'hatchet' | 'miner_pick' | 'sickle'
  | 'cap' | 'helm' | 'hat'
  | 'tunic' | 'mail' | 'robe'
  | 'boots';

/** Cell offsets, origin top-left. e.g. a 1x3 sword is [[0,0],[0,1],[0,2]] */
export type Shape = ReadonlyArray<readonly [number, number]>;

export interface ItemMods {
  atk?: number;
  /** tools only: how fast this bites wood / stone */
  chop?: number;
  mine?: number;
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
  slot?: EquipSlot;
  visual?: Silhouette;
  /** paper-doll tint; falls back to color */
  tint?: string;
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
  /** pointed ears, for the one elf in town */
  ears?: 'elf';
  beard?: string;
  patch?: boolean;
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

export type QuestKind = 'kill' | 'gather' | 'chop' | 'mine' | 'boss' | 'bounty' | 'recover';

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
  /** the plate this work is graded for, F = 0 */
  rank: number;
  /** merit toward your next promotion trial */
  merit: number;
  /** a promotion trial rather than ordinary work */
  trial?: boolean;
  /** bounties: the name the notice gives the brute */
  eliteName?: string;
}

export interface VillageNPC {
  role: 'shopkeeper' | 'guildmaster' | 'smith';
  name: string;
  line: string;
  priceMod: number;
  appearance: Appearance;
  /** flavour that changes with the village mood */
  mood: string[];
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
    /** what the hired hands have piled up, waiting to be collected */
    pending: number;
  }[];
  resources: Record<string, number>;
  /** hands carry it straight to the store instead of leaving a pile */
  autoCollect: boolean;
}
