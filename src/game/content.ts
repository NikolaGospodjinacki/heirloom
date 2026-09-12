import type { Quest, SkillKey } from './types';
import { RNG, uid } from './rng';

export interface MonsterDef {
  id: string;
  name: string;
  family: 'beast' | 'ooze' | 'humanoid' | 'undead' | 'boss';
  hp: number;
  atk: number;
  armor: number;
  speed: number;
  size: number;
  color: string;
  accent: string;
  aggro: number;
  attackRange: number;
  attackCd: number;
  xp: number;
  gold: [number, number];
  /** defId -> chance */
  drops: [string, number][];
  gearChance: number;
  skill: SkillKey;
  danger: number;
}

const M = (m: MonsterDef) => m;

export const MONSTERS: Record<string, MonsterDef> = {
  boar: M({
    id: 'boar', name: 'Wild Boar', family: 'beast', hp: 32, atk: 6, armor: 1, speed: 62, size: 15,
    color: '#7a5a41', accent: '#e6dfc8', aggro: 150, attackRange: 26, attackCd: 1.4, xp: 12,
    gold: [2, 7], drops: [['boar_hide', 0.6], ['boar_tusk', 0.35]], gearChance: 0.09,
    skill: 'hunting', danger: 1,
  }),
  slime: M({
    id: 'slime', name: 'Bog Slime', family: 'ooze', hp: 24, atk: 4, armor: 0, speed: 40, size: 13,
    color: '#5fbf85', accent: '#c9f7d8', aggro: 120, attackRange: 24, attackCd: 1.6, xp: 8,
    gold: [1, 5], drops: [['slime_core', 0.5]], gearChance: 0.07,
    skill: 'slaying', danger: 1,
  }),
  wolf: M({
    id: 'wolf', name: 'Grey Wolf', family: 'beast', hp: 44, atk: 9, armor: 2, speed: 88, size: 15,
    color: '#7d8089', accent: '#d9dde4', aggro: 230, attackRange: 26, attackCd: 1.0, xp: 22,
    gold: [4, 12], drops: [['wolf_pelt', 0.55], ['boar_tusk', 0.15]], gearChance: 0.12,
    skill: 'hunting', danger: 2,
  }),
  goblin: M({
    id: 'goblin', name: 'Goblin Scrapper', family: 'humanoid', hp: 40, atk: 8, armor: 3, speed: 70, size: 14,
    color: '#6f9349', accent: '#c9a24b', aggro: 200, attackRange: 30, attackCd: 1.2, xp: 20,
    gold: [6, 16], drops: [['goblin_ear', 0.6], ['iron_ore', 0.2]], gearChance: 0.18,
    skill: 'slaying', danger: 2,
  }),
  bandit: M({
    id: 'bandit', name: 'Road Bandit', family: 'humanoid', hp: 62, atk: 13, armor: 4, speed: 78, size: 16,
    color: '#6b5643', accent: '#a33c3c', aggro: 240, attackRange: 32, attackCd: 1.1, xp: 34,
    gold: [12, 30], drops: [['bandit_purse', 0.4], ['gem', 0.08]], gearChance: 0.28,
    skill: 'slaying', danger: 3,
  }),
  ghoul: M({
    id: 'ghoul', name: 'Barrow Ghoul', family: 'undead', hp: 78, atk: 15, armor: 5, speed: 58, size: 17,
    color: '#8a8f7d', accent: '#4d3f52', aggro: 210, attackRange: 30, attackCd: 1.3, xp: 46,
    gold: [10, 26], drops: [['rotten_fang', 0.5], ['gem', 0.12]], gearChance: 0.3,
    skill: 'slaying', danger: 4,
  }),
  fangmaw: M({
    id: 'fangmaw', name: 'Fangmaw, Terror of the Fen', family: 'boss', hp: 320, atk: 24, armor: 8, speed: 66, size: 26,
    color: '#5d4038', accent: '#e2c35a', aggro: 340, attackRange: 40, attackCd: 1.25, xp: 260,
    gold: [90, 180], drops: [['monster_heart', 1], ['gem', 0.7], ['wolf_pelt', 0.8]], gearChance: 1,
    skill: 'slaying', danger: 6,
  }),
  hollow_king: M({
    id: 'hollow_king', name: 'The Hollow King', family: 'boss', hp: 520, atk: 33, armor: 12, speed: 60, size: 28,
    color: '#4a4358', accent: '#9be0d2', aggro: 360, attackRange: 44, attackCd: 1.1, xp: 480,
    gold: [180, 320], drops: [['monster_heart', 1], ['gem', 1], ['rotten_fang', 1]], gearChance: 1,
    skill: 'slaying', danger: 8,
  }),
};

export interface ZoneDef {
  id: string;
  name: string;
  desc: string;
  w: number;
  h: number;
  ground: string;
  ground2: string;
  spawns: [string, number][];
  density: number;
  trees: number;
  rocks: number;
  danger: number;
  treeLoot: [string, number][];
  rockLoot: [string, number][];
}

export const ZONES: Record<string, ZoneDef> = {
  meadow: {
    id: 'meadow', name: 'Kestrel Meadow', desc: 'Boars, bees and long grass. Where every apprentice starts.',
    w: 34, h: 34, ground: '#5f8c4a', ground2: '#6c9a53', density: 12, trees: 22, rocks: 8, danger: 1,
    spawns: [['boar', 0.6], ['slime', 0.4]],
    treeLoot: [['log', 0.9], ['heartwood', 0.05]],
    rockLoot: [['iron_ore', 0.8], ['gem', 0.05], ['silver_ore', 0.12]],
  },
  woods: {
    id: 'woods', name: 'Thornwood', desc: 'Old trees, older wolves. Goblins keep a camp somewhere in here.',
    w: 38, h: 38, ground: '#3f6b3c', ground2: '#4a7a44', density: 16, trees: 46, rocks: 10, danger: 2,
    spawns: [['wolf', 0.45], ['goblin', 0.4], ['boar', 0.15]],
    treeLoot: [['log', 0.85], ['heartwood', 0.14]],
    rockLoot: [['iron_ore', 0.7], ['silver_ore', 0.2], ['gem', 0.08]],
  },
  fen: {
    id: 'fen', name: 'Mireholt Fen', desc: 'Bandit country. Wet, cold, and worth good coin.',
    w: 40, h: 40, ground: '#4d5f4a', ground2: '#586b52', density: 18, trees: 20, rocks: 16, danger: 3,
    spawns: [['bandit', 0.45], ['ghoul', 0.3], ['wolf', 0.25]],
    treeLoot: [['log', 0.7], ['heartwood', 0.25]],
    rockLoot: [['iron_ore', 0.55], ['silver_ore', 0.3], ['gem', 0.14]],
  },
  barrows: {
    id: 'barrows', name: 'The Sunken Barrows', desc: 'Nobody who goes deep comes back the same. Or at all.',
    w: 42, h: 42, ground: '#4a4550', ground2: '#544e5c', density: 22, trees: 8, rocks: 24, danger: 5,
    spawns: [['ghoul', 0.6], ['bandit', 0.25], ['goblin', 0.15]],
    treeLoot: [['log', 0.5], ['heartwood', 0.4]],
    rockLoot: [['silver_ore', 0.45], ['gem', 0.28], ['iron_ore', 0.27]],
  },
};

// ------------------------------------------------------------------- quests

const KILL_FLAVOR = [
  'Farmer Odd lost three fields to them. He is not a rich man.',
  'They came down from the ridge last week and have not left.',
  'The caravan will not run this road until it is cleared.',
  'A child saw them near the well. That is close enough.',
];
const GATHER_FLAVOR = [
  'The smith is out of stock and the militia is out of patience.',
  'Winter comes whether we are ready or not.',
  'Pay is fair. The work is not glamorous.',
];
const BOSS_FLAVOR = [
  'Four adventurers took this contract. None came back. The purse has grown.',
  'The guild does not post this lightly. Make your will first.',
];

export function rollQuests(r: RNG, count: number, prosperity: number, tier: number): Quest[] {
  const out: Quest[] = [];
  const zonePool = ['meadow', 'woods', 'fen', 'barrows'].slice(0, Math.min(4, 1 + tier));
  for (let i = 0; i < count; i++) {
    const zoneId = r.pick(zonePool);
    const zone = ZONES[zoneId];
    const kindRoll = r.next();
    const bossOk = tier >= 2 && i === count - 1 && r.chance(0.45);
    let q: Quest;
    const prosMult = 0.8 + prosperity / 100 * 0.5;

    if (bossOk) {
      const bossId = tier >= 4 ? r.pick(['fangmaw', 'hollow_king']) : 'fangmaw';
      const m = MONSTERS[bossId];
      q = {
        id: uid(), title: 'Contract: ' + m.name, kind: 'boss', target: bossId, targetName: m.name,
        need: 1, have: 0, zoneId, rewardGold: Math.round(r.int(260, 480) * prosMult),
        rewardXp: 200, rewardSkill: 'slaying', giver: 'Guild', flavor: r.pick(BOSS_FLAVOR),
        danger: m.danger, rewardItemDef: r.pick(['gem', 'heart_locket', 'kite_shield']),
      };
    } else if (kindRoll < 0.5) {
      const mid = r.pick(zone.spawns.map((s) => s[0]));
      const m = MONSTERS[mid];
      const need = r.int(4, 9);
      q = {
        id: uid(), title: 'Cull the ' + m.name + 's', kind: 'kill', target: mid, targetName: m.name,
        need, have: 0, zoneId, rewardGold: Math.round(need * (6 + m.danger * 7) * prosMult),
        rewardXp: need * m.xp * 0.6, rewardSkill: m.skill, giver: 'Guild', flavor: r.pick(KILL_FLAVOR),
        danger: m.danger,
      };
    } else if (kindRoll < 0.75) {
      const need = r.int(6, 14);
      q = {
        id: uid(), title: 'Timber for the Village', kind: 'chop', target: 'log', targetName: 'Oak Log',
        need, have: 0, zoneId, rewardGold: Math.round(need * 8 * prosMult), rewardXp: need * 14,
        rewardSkill: 'woodcutting', giver: 'Guild', flavor: r.pick(GATHER_FLAVOR), danger: zone.danger,
      };
    } else {
      const need = r.int(5, 12);
      q = {
        id: uid(), title: 'Ore for the Forge', kind: 'mine', target: 'iron_ore', targetName: 'Iron Ore',
        need, have: 0, zoneId, rewardGold: Math.round(need * 10 * prosMult), rewardXp: need * 16,
        rewardSkill: 'mining', giver: 'Guild', flavor: r.pick(GATHER_FLAVOR), danger: zone.danger,
      };
    }
    out.push(q);
  }
  return out;
}

export const SHOP_STOCK_POOL = [
  'shortsword', 'dagger', 'axe', 'pickaxe', 'wand', 'apprentice_staff', 'buckler',
  'leather_cap', 'padded_tunic', 'boots', 'copper_ring', 'bone_charm', 'wizard_hat',
];
export const SHOP_STOCK_RICH = [
  'greatsword', 'runewood_staff', 'kite_shield', 'iron_helm', 'chainmail', 'robe', 'heart_locket',
];
