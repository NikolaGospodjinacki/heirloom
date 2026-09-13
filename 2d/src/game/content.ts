import type { Quest, SkillKey } from './types';
import { RNG, uid } from './rng';

/**
 * A single telegraphed move. Ordinary monsters have none and use the simple
 * chase-and-swing path; anything with a list of these runs the boss brain.
 */
export interface MobAttack {
  id: string;
  name: string;
  kind: 'arc' | 'charge' | 'slam' | 'cone' | 'volley' | 'summon';
  /** furthest distance at which the boss will consider this move */
  range: number;
  minRange?: number;
  windup: number;
  cd: number;
  /** multiplier on the monster attack stat */
  dmg: number;
  radius?: number;
  arc?: number;
  /** arc/cone moves fired behind the boss instead of in front */
  behind?: boolean;
  chargeSpeed?: number;
  chargeTime?: number;
  shots?: number;
  spread?: number;
  projSpeed?: number;
  spawn?: string;
  spawnCount?: number;
  color: string;
}

export interface MonsterDef {
  id: string;
  name: string;
  family: 'beast' | 'ooze' | 'humanoid' | 'undead' | 'boss';
  /** bosses run this list instead of the plain attack */
  attacks?: MobAttack[];
  /** drawn bigger and with a name plate over the health bar */
  title?: string;
  /** ranged attackers fire a projectile instead of swinging */
  ranged?: { speed: number; color: string; size: number };
  /** telegraphed leap that closes distance before the swing */
  lunge?: { range: number; speed: number };
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
    lunge: { range: 190, speed: 430 },
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
  spitter: M({
    id: 'spitter', name: 'Bile Spitter', family: 'ooze', hp: 30, atk: 8, armor: 1, speed: 34, size: 14,
    color: '#7fae52', accent: '#d6f0a8', aggro: 300, attackRange: 250, attackCd: 2.0, xp: 18,
    gold: [3, 9], drops: [['slime_core', 0.6]], gearChance: 0.08,
    skill: 'slaying', danger: 2,
    ranged: { speed: 250, color: '#a8e05f', size: 7 },
  }),
  archer: M({
    id: 'archer', name: 'Goblin Slinger', family: 'humanoid', hp: 34, atk: 11, armor: 2, speed: 74, size: 14,
    color: '#7f9c58', accent: '#c96b3a', aggro: 340, attackRange: 290, attackCd: 1.7, xp: 26,
    gold: [7, 18], drops: [['goblin_ear', 0.55], ['iron_ore', 0.12]], gearChance: 0.18,
    skill: 'slaying', danger: 3,
    ranged: { speed: 330, color: '#e0d0a0', size: 5 },
  }),
  hexer: M({
    id: 'hexer', name: 'Barrow Hexer', family: 'undead', hp: 58, atk: 17, armor: 4, speed: 52, size: 16,
    color: '#6a5c86', accent: '#b8a0e0', aggro: 330, attackRange: 270, attackCd: 2.1, xp: 52,
    gold: [14, 32], drops: [['rotten_fang', 0.5], ['gem', 0.16]], gearChance: 0.3,
    skill: 'slaying', danger: 4,
    ranged: { speed: 210, color: '#c39bff', size: 8 },
  }),
  fangmaw: M({
    id: 'fangmaw', name: 'Fangmaw', title: 'Terror of the Fen', family: 'boss',
    hp: 380, atk: 22, armor: 8, speed: 62, size: 28,
    color: '#5d4038', accent: '#e2c35a', aggro: 420, attackRange: 46, attackCd: 1.25, xp: 300,
    gold: [90, 180], drops: [['monster_heart', 1], ['gem', 0.7], ['wolf_pelt', 0.8]], gearChance: 1,
    skill: 'slaying', danger: 6,
    attacks: [
      { id: 'maul', name: 'Maul', kind: 'arc', range: 82, windup: 0.52, cd: 2.6, dmg: 1, arc: 1.3, color: '#e2c35a' },
      { id: 'pounce', name: 'Pounce', kind: 'charge', range: 340, minRange: 130, windup: 0.75, cd: 6.5, dmg: 1.35, chargeSpeed: 560, chargeTime: 0.45, color: '#d0603f' },
      { id: 'howl', name: 'Howl', kind: 'summon', range: 500, windup: 1.1, cd: 16, dmg: 0, spawn: 'wolf', spawnCount: 2, color: '#cfd8e8' },
    ],
  }),
  grovewarden: M({
    id: 'grovewarden', name: 'The Grovewarden', title: 'Bear of Thornwood', family: 'boss',
    hp: 520, atk: 26, armor: 10, speed: 58, size: 32,
    color: '#6a4a33', accent: '#d8c9a8', aggro: 420, attackRange: 60, attackCd: 1.3, xp: 400,
    gold: [130, 240], drops: [['monster_heart', 1], ['gem', 0.8], ['heartwood', 1]], gearChance: 1,
    skill: 'hunting', danger: 6,
    attacks: [
      { id: 'swipe', name: 'Swipe', kind: 'arc', range: 96, windup: 0.5, cd: 2.4, dmg: 1, arc: 1.5, color: '#d8c9a8' },
      { id: 'rush', name: 'Rush', kind: 'charge', range: 380, minRange: 150, windup: 0.85, cd: 7, dmg: 1.5, chargeSpeed: 600, chargeTime: 0.5, color: '#e06a4a' },
      { id: 'stomp', name: 'Stomp', kind: 'slam', range: 130, windup: 0.95, cd: 8, dmg: 1.3, radius: 165, color: '#a8804a' },
    ],
  }),
  quarry_golem: M({
    id: 'quarry_golem', name: 'The Quarry Golem', title: 'It Was Here First', family: 'boss',
    hp: 760, atk: 30, armor: 20, speed: 42, size: 34,
    color: '#77767e', accent: '#9be0d2', aggro: 430, attackRange: 74, attackCd: 1.5, xp: 560,
    gold: [200, 340], drops: [['monster_heart', 1], ['gem', 1], ['silver_ore', 1]], gearChance: 1,
    skill: 'mining', danger: 7,
    attacks: [
      { id: 'slam', name: 'Slam', kind: 'slam', range: 120, windup: 1.05, cd: 4.5, dmg: 1.5, radius: 150, color: '#c8b06a' },
      { id: 'boulders', name: 'Boulder Volley', kind: 'volley', range: 460, minRange: 130, windup: 0.9, cd: 6, dmg: 0.9, shots: 3, spread: 0.34, projSpeed: 290, color: '#9a9ea6' },
      { id: 'sweep', name: 'Backhand', kind: 'arc', range: 110, windup: 0.6, cd: 3.2, dmg: 1.1, arc: 1.8, color: '#9be0d2' },
    ],
  }),
  hollow_king: M({
    id: 'hollow_king', name: 'The Hollow King', title: 'Crowned in the Dark', family: 'boss',
    hp: 640, atk: 32, armor: 12, speed: 60, size: 30,
    color: '#4a4358', accent: '#9be0d2', aggro: 420, attackRange: 52, attackCd: 1.1, xp: 620,
    gold: [180, 320], drops: [['monster_heart', 1], ['gem', 1], ['rotten_fang', 1]], gearChance: 1,
    skill: 'slaying', danger: 8,
    attacks: [
      { id: 'reap', name: 'Reap', kind: 'arc', range: 96, windup: 0.45, cd: 2.2, dmg: 1, arc: 1.6, color: '#9be0d2' },
      { id: 'grasp', name: 'Grasping Dark', kind: 'slam', range: 260, windup: 1.0, cd: 6, dmg: 1.2, radius: 130, color: '#7a5fa8' },
      { id: 'court', name: 'Call the Court', kind: 'summon', range: 520, windup: 1.2, cd: 14, dmg: 0, spawn: 'ghoul', spawnCount: 3, color: '#b8a0e0' },
    ],
  }),
  emberwyrm: M({
    id: 'emberwyrm', name: 'Emberwyrm', title: 'The Thing On The Hill', family: 'boss',
    hp: 1100, atk: 38, armor: 16, speed: 54, size: 42,
    color: '#8c3f34', accent: '#e8a33d', aggro: 520, attackRange: 90, attackCd: 1.2, xp: 1100,
    gold: [420, 720], drops: [['monster_heart', 1], ['gem', 1], ['silver_ore', 1], ['heartwood', 1]], gearChance: 1,
    skill: 'slaying', danger: 10,
    attacks: [
      { id: 'breath', name: 'Ember Breath', kind: 'cone', range: 300, windup: 1.15, cd: 6.5, dmg: 1.4, arc: 0.55, color: '#e8703d' },
      { id: 'buffet', name: 'Wing Buffet', kind: 'slam', range: 150, windup: 0.7, cd: 7, dmg: 1.1, radius: 190, color: '#e8c15a' },
      { id: 'tail', name: 'Tail Sweep', kind: 'arc', range: 130, windup: 0.55, cd: 3.4, dmg: 1.25, arc: 2.4, behind: true, color: '#c96b3a' },
      { id: 'spit', name: 'Cinder Spit', kind: 'volley', range: 520, minRange: 200, windup: 0.85, cd: 5.5, dmg: 0.85, shots: 5, spread: 0.5, projSpeed: 300, color: '#e8703d' },
    ],
  }),
};

/** Bosses that can be rolled as a contract, cheapest first. */
export const BOSS_POOL = ['fangmaw', 'grovewarden', 'quarry_golem', 'hollow_king', 'emberwyrm'];

export type Backdrop = 'none' | 'hills' | 'mountains' | 'crags' | 'peaks';
export type Terrain = 'flat' | 'rolling' | 'ridge' | 'broken';
export type Ambience = 'pollen' | 'leaves' | 'mist' | 'embers' | 'fireflies';

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
  backdrop: Backdrop;
  terrain: Terrain;
  ambience: Ambience;
  ambienceColor: string;
  /** scattered dressing: bushes, flowers, mushrooms, stumps, reeds */
  flora: number;
  /** the boss that lives here */
  boss: string;
  /** critters that flee from you */
  critters: number;
  skyTop: string;
  skyBottom: string;
}

export const ZONES: Record<string, ZoneDef> = {
  meadow: {
    id: 'meadow', name: 'Kestrel Meadow', desc: 'Boars, bees and long grass. Where every apprentice starts.',
    w: 36, h: 36, ground: '#5f8c4a', ground2: '#6c9a53', density: 12, trees: 26, rocks: 8, danger: 1,
    spawns: [['boar', 0.5], ['slime', 0.3], ['spitter', 0.2]],
    treeLoot: [['log', 0.9], ['heartwood', 0.05]],
    rockLoot: [['iron_ore', 0.8], ['gem', 0.05], ['silver_ore', 0.12]],
    backdrop: 'hills', terrain: 'rolling', ambience: 'pollen', ambienceColor: '#fff2b0',
    flora: 150, boss: 'fangmaw', critters: 10,
    skyTop: '#8fb8d8', skyBottom: '#cfe0c0',
  },
  woods: {
    id: 'woods', name: 'Thornwood', desc: 'Old trees, older wolves, and something big that the guild will not name.',
    w: 42, h: 42, ground: '#3f6b3c', ground2: '#4a7a44', density: 16, trees: 78, rocks: 12, danger: 2,
    spawns: [['wolf', 0.35], ['goblin', 0.3], ['archer', 0.2], ['boar', 0.15]],
    treeLoot: [['log', 0.85], ['heartwood', 0.14]],
    rockLoot: [['iron_ore', 0.7], ['silver_ore', 0.2], ['gem', 0.08]],
    backdrop: 'hills', terrain: 'rolling', ambience: 'leaves', ambienceColor: '#c8b06a',
    flora: 210, boss: 'grovewarden', critters: 14,
    skyTop: '#6f8f9c', skyBottom: '#9db08a',
  },
  fen: {
    id: 'fen', name: 'Mireholt Fen', desc: 'Bandit country. Wet, cold, and worth good coin.',
    w: 44, h: 44, ground: '#4d5f4a', ground2: '#586b52', density: 18, trees: 30, rocks: 18, danger: 3,
    spawns: [['bandit', 0.34], ['ghoul', 0.22], ['wolf', 0.22], ['archer', 0.22]],
    treeLoot: [['log', 0.7], ['heartwood', 0.25]],
    rockLoot: [['iron_ore', 0.55], ['silver_ore', 0.3], ['gem', 0.14]],
    backdrop: 'crags', terrain: 'broken', ambience: 'mist', ambienceColor: '#cfe0e8',
    flora: 170, boss: 'fangmaw', critters: 8,
    skyTop: '#6a7480', skyBottom: '#8a917f',
  },
  barrows: {
    id: 'barrows', name: 'The Sunken Barrows', desc: 'Nobody who goes deep comes back the same. Or at all.',
    w: 46, h: 46, ground: '#4a4550', ground2: '#544e5c', density: 22, trees: 10, rocks: 30, danger: 5,
    spawns: [['ghoul', 0.4], ['hexer', 0.3], ['bandit', 0.18], ['archer', 0.12]],
    treeLoot: [['log', 0.5], ['heartwood', 0.4]],
    rockLoot: [['silver_ore', 0.45], ['gem', 0.28], ['iron_ore', 0.27]],
    backdrop: 'crags', terrain: 'broken', ambience: 'fireflies', ambienceColor: '#9be0d2',
    flora: 120, boss: 'hollow_king', critters: 4,
    skyTop: '#3d3a4a', skyBottom: '#5d5560',
  },
  ridge: {
    id: 'ridge', name: 'Cinder Ridge',
    desc: 'A climb, and something asleep at the top of it. Bring rope and better ideas.',
    w: 46, h: 46, ground: '#6b4a3d', ground2: '#7a5645', density: 16, trees: 14, rocks: 34, danger: 7,
    spawns: [['hexer', 0.3], ['archer', 0.25], ['ghoul', 0.25], ['bandit', 0.2]],
    treeLoot: [['log', 0.6], ['heartwood', 0.35]],
    rockLoot: [['silver_ore', 0.4], ['gem', 0.35], ['iron_ore', 0.25]],
    backdrop: 'peaks', terrain: 'ridge', ambience: 'embers', ambienceColor: '#e8873d',
    flora: 90, boss: 'emberwyrm', critters: 2,
    skyTop: '#8a4a3f', skyBottom: '#d8894f',
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
  const zonePool = ['meadow', 'woods', 'fen', 'barrows', 'ridge'].slice(0, Math.min(5, 1 + tier));
  for (let i = 0; i < count; i++) {
    const zoneId = r.pick(zonePool);
    const zone = ZONES[zoneId];
    const kindRoll = r.next();
    const bossOk = tier >= 2 && i === count - 1 && r.chance(0.45);
    let q: Quest;
    const prosMult = 0.8 + prosperity / 100 * 0.5;

    if (bossOk) {
      const bossId = ZONES[zoneId].boss;
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
  'greatsword', 'runewood_staff', 'kite_shield', 'iron_helm', 'chainmail', 'robe',
  'heart_locket', 'battleaxe', 'prospectors_kit',
];
/** The store always keeps the basic tools on the shelf. Nobody should be stuck. */
export const SHOP_STAPLES = ['axe', 'pickaxe'];
