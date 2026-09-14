import type { Quest, SkillKey } from './types';
import { RNG, uid } from './rng';
import type { TerrainStyle } from './terrain';
import { CONTRACT_MERIT, RANKS, rankDef } from './ranks';

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
  /** wings, horns, a crown: small touches on the shared body shapes */
  look?: 'wings' | 'horns' | 'tusks' | 'hood';
}

const M = (m: MonsterDef) => m;

export const MONSTERS: Record<string, MonsterDef> = {
  // ------------------------------------------------------------ F: the meadow
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
  spitter: M({
    id: 'spitter', name: 'Bile Spitter', family: 'ooze', hp: 30, atk: 8, armor: 1, speed: 34, size: 14,
    color: '#7fae52', accent: '#d6f0a8', aggro: 300, attackRange: 250, attackCd: 2.0, xp: 18,
    gold: [3, 9], drops: [['slime_core', 0.6]], gearChance: 0.08,
    skill: 'slaying', danger: 2,
    ranged: { speed: 250, color: '#a8e05f', size: 7 },
  }),
  // ------------------------------------------------------------ E: the woods
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
  archer: M({
    id: 'archer', name: 'Goblin Slinger', family: 'humanoid', hp: 34, atk: 11, armor: 2, speed: 74, size: 14,
    color: '#7f9c58', accent: '#c96b3a', aggro: 340, attackRange: 290, attackCd: 1.7, xp: 26,
    gold: [7, 18], drops: [['goblin_ear', 0.55], ['iron_ore', 0.12]], gearChance: 0.18,
    skill: 'slaying', danger: 3,
    ranged: { speed: 330, color: '#e0d0a0', size: 5 },
  }),
  // ------------------------------------------------------------- D: the fen
  bandit: M({
    id: 'bandit', name: 'Road Bandit', family: 'humanoid', hp: 62, atk: 13, armor: 4, speed: 78, size: 16,
    color: '#6b5643', accent: '#a33c3c', aggro: 240, attackRange: 32, attackCd: 1.1, xp: 34,
    gold: [12, 30], drops: [['bandit_purse', 0.4], ['gem', 0.08]], gearChance: 0.28,
    skill: 'slaying', danger: 3, look: 'hood',
  }),
  // --------------------------------------------------------- C: the barrows
  ghoul: M({
    id: 'ghoul', name: 'Barrow Ghoul', family: 'undead', hp: 78, atk: 15, armor: 5, speed: 58, size: 17,
    color: '#8a8f7d', accent: '#4d3f52', aggro: 210, attackRange: 30, attackCd: 1.3, xp: 46,
    gold: [10, 26], drops: [['rotten_fang', 0.5], ['gem', 0.12]], gearChance: 0.3,
    skill: 'slaying', danger: 4,
  }),
  hexer: M({
    id: 'hexer', name: 'Barrow Hexer', family: 'undead', hp: 58, atk: 17, armor: 4, speed: 52, size: 16,
    color: '#6a5c86', accent: '#b8a0e0', aggro: 330, attackRange: 270, attackCd: 2.1, xp: 52,
    gold: [14, 32], drops: [['rotten_fang', 0.5], ['gem', 0.16]], gearChance: 0.3,
    skill: 'slaying', danger: 4, look: 'hood',
    ranged: { speed: 210, color: '#c39bff', size: 8 },
  }),
  // -------------------------------------------------------- B: the mountain
  frost_wolf: M({
    lunge: { range: 215, speed: 480 },
    id: 'frost_wolf', name: 'Frost Wolf', family: 'beast', hp: 72, atk: 16, armor: 4, speed: 96, size: 16,
    color: '#c9d4de', accent: '#7fa8c4', aggro: 250, attackRange: 26, attackCd: 0.95, xp: 58,
    gold: [12, 26], drops: [['wolf_pelt', 0.6], ['gem', 0.1]], gearChance: 0.2,
    skill: 'hunting', danger: 5,
  }),
  harpy: M({
    id: 'harpy', name: 'Crag Harpy', family: 'humanoid', hp: 60, atk: 17, armor: 3, speed: 86, size: 15,
    color: '#8a7a9c', accent: '#e0c080', aggro: 360, attackRange: 280, attackCd: 1.6, xp: 62,
    gold: [14, 30], drops: [['gem', 0.16], ['silver_ore', 0.2]], gearChance: 0.22,
    skill: 'slaying', danger: 5, look: 'wings',
    ranged: { speed: 320, color: '#e8d8a0', size: 6 },
  }),
  troll: M({
    id: 'troll', name: 'Stair Troll', family: 'humanoid', hp: 170, atk: 24, armor: 9, speed: 50, size: 21,
    color: '#6f8a6a', accent: '#d8c9a8', aggro: 200, attackRange: 38, attackCd: 1.6, xp: 90,
    gold: [20, 44], drops: [['iron_ore', 0.5], ['silver_ore', 0.3]], gearChance: 0.35,
    skill: 'slaying', danger: 6, look: 'tusks',
  }),
  // ------------------------------------------------------ A: the ashen field
  husk: M({
    id: 'husk', name: 'Ashen Husk', family: 'undead', hp: 120, atk: 26, armor: 8, speed: 62, size: 17,
    color: '#5a524e', accent: '#e8703d', aggro: 230, attackRange: 30, attackCd: 1.2, xp: 88,
    gold: [18, 40], drops: [['rotten_fang', 0.4], ['gem', 0.18]], gearChance: 0.32,
    skill: 'slaying', danger: 7,
  }),
  imp: M({
    id: 'imp', name: 'Cinder Imp', family: 'humanoid', hp: 80, atk: 24, armor: 4, speed: 88, size: 13,
    color: '#8c3f34', accent: '#ffb060', aggro: 360, attackRange: 300, attackCd: 1.4, xp: 84,
    gold: [16, 36], drops: [['gem', 0.2]], gearChance: 0.25,
    skill: 'slaying', danger: 7, look: 'horns',
    ranged: { speed: 340, color: '#ff8a3d', size: 7 },
  }),
  hellhound: M({
    lunge: { range: 230, speed: 520 },
    id: 'hellhound', name: 'Hellhound', family: 'beast', hp: 110, atk: 28, armor: 6, speed: 104, size: 17,
    color: '#4a2a26', accent: '#ff7a30', aggro: 280, attackRange: 28, attackCd: 0.9, xp: 96,
    gold: [18, 40], drops: [['wolf_pelt', 0.5], ['monster_heart', 0.05]], gearChance: 0.25,
    skill: 'hunting', danger: 7,
  }),

  // ------------------------------------------------------------------ bosses
  old_tusker: M({
    id: 'old_tusker', name: 'Old Tusker', title: 'The Barley Tyrant', family: 'boss',
    hp: 300, atk: 16, armor: 5, speed: 66, size: 27,
    color: '#6b4a33', accent: '#efe6d0', aggro: 400, attackRange: 44, attackCd: 1.3, xp: 220,
    gold: [60, 120], drops: [['boar_hide', 1], ['boar_tusk', 1], ['monster_heart', 0.6]], gearChance: 1,
    skill: 'hunting', danger: 3,
    attacks: [
      { id: 'gore', name: 'Gore', kind: 'arc', range: 76, windup: 0.55, cd: 2.8, dmg: 1, arc: 1.1, color: '#efe6d0' },
      { id: 'charge', name: 'Charge', kind: 'charge', range: 360, minRange: 120, windup: 0.8, cd: 5.5, dmg: 1.3, chargeSpeed: 580, chargeTime: 0.5, color: '#d0603f' },
      { id: 'wallow', name: 'Wallow', kind: 'slam', range: 110, windup: 1.0, cd: 8, dmg: 1.1, radius: 140, color: '#8a6440' },
    ],
  }),
  grovewarden: M({
    id: 'grovewarden', name: 'The Grovewarden', title: 'Bear of Thornwood', family: 'boss',
    hp: 520, atk: 24, armor: 10, speed: 58, size: 32,
    color: '#6a4a33', accent: '#d8c9a8', aggro: 420, attackRange: 60, attackCd: 1.3, xp: 400,
    gold: [130, 240], drops: [['monster_heart', 1], ['gem', 0.8], ['heartwood', 1]], gearChance: 1,
    skill: 'hunting', danger: 5,
    attacks: [
      { id: 'swipe', name: 'Swipe', kind: 'arc', range: 96, windup: 0.5, cd: 2.4, dmg: 1, arc: 1.5, color: '#d8c9a8' },
      { id: 'rush', name: 'Rush', kind: 'charge', range: 380, minRange: 150, windup: 0.85, cd: 7, dmg: 1.5, chargeSpeed: 600, chargeTime: 0.5, color: '#e06a4a' },
      { id: 'stomp', name: 'Stomp', kind: 'slam', range: 130, windup: 0.95, cd: 8, dmg: 1.3, radius: 165, color: '#a8804a' },
    ],
  }),
  fangmaw: M({
    id: 'fangmaw', name: 'Fangmaw', title: 'Terror of the Fen', family: 'boss',
    hp: 640, atk: 28, armor: 10, speed: 64, size: 29,
    color: '#5d4038', accent: '#e2c35a', aggro: 440, attackRange: 46, attackCd: 1.2, xp: 520,
    gold: [180, 300], drops: [['monster_heart', 1], ['gem', 0.8], ['wolf_pelt', 1]], gearChance: 1,
    skill: 'slaying', danger: 6,
    attacks: [
      { id: 'maul', name: 'Maul', kind: 'arc', range: 82, windup: 0.5, cd: 2.4, dmg: 1, arc: 1.3, color: '#e2c35a' },
      { id: 'pounce', name: 'Pounce', kind: 'charge', range: 340, minRange: 130, windup: 0.72, cd: 6, dmg: 1.35, chargeSpeed: 600, chargeTime: 0.45, color: '#d0603f' },
      { id: 'howl', name: 'Howl', kind: 'summon', range: 500, windup: 1.1, cd: 15, dmg: 0, spawn: 'wolf', spawnCount: 3, color: '#cfd8e8' },
    ],
  }),
  hollow_king: M({
    id: 'hollow_king', name: 'The Hollow King', title: 'Once a Squire of the Hero', family: 'boss',
    hp: 820, atk: 32, armor: 12, speed: 60, size: 30,
    color: '#4a4358', accent: '#9be0d2', aggro: 440, attackRange: 52, attackCd: 1.1, xp: 720,
    gold: [240, 400], drops: [['monster_heart', 1], ['gem', 1], ['rotten_fang', 1]], gearChance: 1,
    skill: 'slaying', danger: 8,
    attacks: [
      { id: 'reap', name: 'Reap', kind: 'arc', range: 96, windup: 0.45, cd: 2.2, dmg: 1, arc: 1.6, color: '#9be0d2' },
      { id: 'grasp', name: 'Grasping Dark', kind: 'slam', range: 260, windup: 1.0, cd: 6, dmg: 1.2, radius: 130, color: '#7a5fa8' },
      { id: 'court', name: 'Call the Court', kind: 'summon', range: 520, windup: 1.2, cd: 14, dmg: 0, spawn: 'ghoul', spawnCount: 3, color: '#b8a0e0' },
    ],
  }),
  quarry_golem: M({
    id: 'quarry_golem', name: 'The Quarry Golem', title: 'It Was Here First', family: 'boss',
    hp: 900, atk: 32, armor: 20, speed: 42, size: 34,
    color: '#77767e', accent: '#9be0d2', aggro: 430, attackRange: 74, attackCd: 1.5, xp: 760,
    gold: [260, 420], drops: [['monster_heart', 1], ['gem', 1], ['silver_ore', 1]], gearChance: 1,
    skill: 'mining', danger: 8,
    attacks: [
      { id: 'slam', name: 'Slam', kind: 'slam', range: 120, windup: 1.05, cd: 4.5, dmg: 1.5, radius: 150, color: '#c8b06a' },
      { id: 'boulders', name: 'Boulder Volley', kind: 'volley', range: 460, minRange: 130, windup: 0.9, cd: 6, dmg: 0.9, shots: 3, spread: 0.34, projSpeed: 290, color: '#9a9ea6' },
      { id: 'sweep', name: 'Backhand', kind: 'arc', range: 110, windup: 0.6, cd: 3.2, dmg: 1.1, arc: 1.8, color: '#9be0d2' },
    ],
  }),
  stormtalon: M({
    id: 'stormtalon', name: 'Stormtalon', title: 'Queen of the Greyspine', family: 'boss',
    hp: 1150, atk: 36, armor: 12, speed: 70, size: 36,
    color: '#6a6f80', accent: '#e8d8a0', aggro: 560, attackRange: 80, attackCd: 1.2, xp: 1050,
    gold: [380, 650], drops: [['monster_heart', 1], ['gem', 1], ['silver_ore', 1]], gearChance: 1,
    skill: 'hunting', danger: 9,
    attacks: [
      { id: 'rake', name: 'Talon Rake', kind: 'arc', range: 110, windup: 0.5, cd: 2.6, dmg: 1.1, arc: 1.4, color: '#e8d8a0' },
      { id: 'dive', name: 'Dive', kind: 'charge', range: 460, minRange: 160, windup: 0.95, cd: 6, dmg: 1.5, chargeSpeed: 720, chargeTime: 0.5, color: '#cfe0f0' },
      { id: 'gale', name: 'Gale', kind: 'cone', range: 320, windup: 1.0, cd: 7, dmg: 1.2, arc: 0.6, color: '#bfe0f0' },
      { id: 'feathers', name: 'Feather Storm', kind: 'volley', range: 520, minRange: 120, windup: 0.8, cd: 5.5, dmg: 0.8, shots: 7, spread: 0.6, projSpeed: 320, color: '#d8d2c4' },
      { id: 'cry', name: 'Cry of the Peaks', kind: 'summon', range: 560, windup: 1.1, cd: 18, dmg: 0, spawn: 'harpy', spawnCount: 2, color: '#e8d8a0' },
    ],
  }),
  herald: M({
    id: 'herald', name: 'Vessarine', title: 'Herald of Ash', family: 'boss',
    hp: 1600, atk: 42, armor: 16, speed: 64, size: 32,
    color: '#3a2a38', accent: '#ff8a3d', aggro: 580, attackRange: 70, attackCd: 1.0, xp: 1600,
    gold: [600, 1000], drops: [['monster_heart', 1], ['gem', 1], ['heartwood', 1]], gearChance: 1,
    skill: 'slaying', danger: 11,
    attacks: [
      { id: 'ashblade', name: 'Ashblade', kind: 'arc', range: 100, windup: 0.45, cd: 2.2, dmg: 1.1, arc: 1.5, color: '#ff8a3d' },
      { id: 'step', name: 'Shadow Step', kind: 'charge', range: 420, minRange: 140, windup: 0.6, cd: 5, dmg: 1.3, chargeSpeed: 820, chargeTime: 0.35, color: '#b464e0' },
      { id: 'lances', name: 'Cinder Lances', kind: 'volley', range: 560, minRange: 100, windup: 0.8, cd: 5, dmg: 0.9, shots: 6, spread: 0.55, projSpeed: 380, color: '#ff8a3d' },
      { id: 'pyre', name: 'Pyre', kind: 'slam', range: 200, windup: 1.2, cd: 8, dmg: 1.5, radius: 200, color: '#e8703d' },
      { id: 'hellfire', name: 'Hellfire', kind: 'cone', range: 340, windup: 1.1, cd: 7, dmg: 1.4, arc: 0.5, color: '#ff6a2a' },
      { id: 'court', name: 'Rise, Ashen Court', kind: 'summon', range: 600, windup: 1.2, cd: 16, dmg: 0, spawn: 'husk', spawnCount: 3, color: '#b464e0' },
    ],
  }),
  /** kept so that very old saves still load; nothing spawns it any more */
  emberwyrm: M({
    id: 'emberwyrm', name: 'Emberwyrm', title: 'Retired', family: 'boss',
    hp: 1100, atk: 38, armor: 16, speed: 54, size: 42,
    color: '#8c3f34', accent: '#e8a33d', aggro: 520, attackRange: 90, attackCd: 1.2, xp: 1100,
    gold: [420, 720], drops: [['monster_heart', 1]], gearChance: 1,
    skill: 'slaying', danger: 10,
    attacks: [
      { id: 'tail', name: 'Tail Sweep', kind: 'arc', range: 130, windup: 0.55, cd: 3.4, dmg: 1.25, arc: 2.4, behind: true, color: '#c96b3a' },
    ],
  }),
};

/** Bosses that can be rolled as an ordinary contract once their trial is behind you. */
export const BOSS_POOL = ['old_tusker', 'grovewarden', 'fangmaw', 'hollow_king', 'quarry_golem', 'stormtalon', 'herald'];

export type Backdrop = 'none' | 'hills' | 'mountains' | 'crags' | 'peaks';
export type Ambience = 'pollen' | 'leaves' | 'mist' | 'embers' | 'fireflies' | 'snow';

export interface ZoneDef {
  id: string;
  name: string;
  desc: string;
  /** the plate you need before the gate lets you out this way */
  rank: number;
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
  style: TerrainStyle;
  ambience: Ambience;
  ambienceColor: string;
  /** scattered dressing: bushes, flowers, mushrooms, stumps, reeds */
  flora: number;
  /** the boss that lives here */
  boss: string;
  /** other big things that can be hunted here on contract */
  extraBosses?: string[];
  /** critters that flee from you */
  critters: number;
  skyTop: string;
  skyBottom: string;
}

export const ZONES: Record<string, ZoneDef> = {
  meadow: {
    id: 'meadow', name: 'Kestrel Meadow', rank: 0,
    desc: 'Boars, slimes and long grass. Where every copper plate starts.',
    w: 40, h: 40, ground: '#5f8c4a', ground2: '#6c9a53', density: 12, trees: 26, rocks: 8, danger: 1,
    spawns: [['boar', 0.5], ['slime', 0.3], ['spitter', 0.2]],
    treeLoot: [['log', 0.9], ['heartwood', 0.05]],
    rockLoot: [['iron_ore', 0.8], ['gem', 0.05], ['silver_ore', 0.12]],
    style: 'meadow', ambience: 'pollen', ambienceColor: '#fff2b0',
    flora: 150, boss: 'old_tusker', critters: 10,
    skyTop: '#8fb8d8', skyBottom: '#cfe0c0',
  },
  woods: {
    id: 'woods', name: 'Thornwood', rank: 1,
    desc: 'Old trees, older wolves, and a bear the guild calls by name.',
    w: 42, h: 42, ground: '#3f6b3c', ground2: '#4a7a44', density: 16, trees: 70, rocks: 12, danger: 2,
    spawns: [['wolf', 0.35], ['goblin', 0.3], ['archer', 0.2], ['boar', 0.15]],
    treeLoot: [['log', 0.85], ['heartwood', 0.14]],
    rockLoot: [['iron_ore', 0.7], ['silver_ore', 0.2], ['gem', 0.08]],
    style: 'woods', ambience: 'leaves', ambienceColor: '#c8b06a',
    flora: 210, boss: 'grovewarden', critters: 14,
    skyTop: '#6f8f9c', skyBottom: '#9db08a',
  },
  fen: {
    id: 'fen', name: 'Mireholt Fen', rank: 2,
    desc: 'Bandit country, and Fangmaw country. Wet, cold, and worth good coin.',
    w: 44, h: 44, ground: '#4d5f4a', ground2: '#586b52', density: 18, trees: 30, rocks: 16, danger: 3,
    spawns: [['bandit', 0.34], ['wolf', 0.22], ['archer', 0.22], ['spitter', 0.22]],
    treeLoot: [['log', 0.7], ['heartwood', 0.25]],
    rockLoot: [['iron_ore', 0.55], ['silver_ore', 0.3], ['gem', 0.14]],
    style: 'fen', ambience: 'mist', ambienceColor: '#cfe0e8',
    flora: 170, boss: 'fangmaw', critters: 8,
    skyTop: '#6a7480', skyBottom: '#8a917f',
  },
  barrows: {
    id: 'barrows', name: 'The Sunken Barrows', rank: 3,
    desc: 'The Hero buried his dead here, eighty years ago. They did not all stay buried.',
    w: 46, h: 46, ground: '#4a4550', ground2: '#544e5c', density: 22, trees: 10, rocks: 30, danger: 5,
    spawns: [['ghoul', 0.4], ['hexer', 0.3], ['bandit', 0.18], ['archer', 0.12]],
    treeLoot: [['log', 0.5], ['heartwood', 0.4]],
    rockLoot: [['silver_ore', 0.45], ['gem', 0.28], ['iron_ore', 0.27]],
    style: 'barrows', ambience: 'fireflies', ambienceColor: '#9be0d2',
    flora: 120, boss: 'hollow_king', critters: 4,
    skyTop: '#3d3a4a', skyBottom: '#5d5560',
  },
  ridge: {
    id: 'ridge', name: 'Greyspine Peak', rank: 4,
    desc: 'The old maps call it the Giant’s Stair. Something with a wingspan like a barn nests at the top.',
    w: 46, h: 46, ground: '#5f8a4c', ground2: '#6c9656', density: 18, trees: 22, rocks: 34, danger: 7,
    spawns: [['frost_wolf', 0.35], ['harpy', 0.25], ['troll', 0.2], ['archer', 0.2]],
    treeLoot: [['log', 0.6], ['heartwood', 0.35]],
    rockLoot: [['silver_ore', 0.4], ['gem', 0.35], ['iron_ore', 0.25]],
    style: 'mountain', ambience: 'snow', ambienceColor: '#ffffff',
    flora: 110, boss: 'stormtalon', extraBosses: ['quarry_golem'], critters: 4,
    skyTop: '#9fb8d0', skyBottom: '#dfe8ee',
  },
  ashen: {
    id: 'ashen', name: 'The Ashen Field', rank: 5,
    desc: 'Where the Hero ended the Long Night. Eighty years on, the ground is still warm.',
    w: 46, h: 46, ground: '#5a4a44', ground2: '#66544c', density: 22, trees: 6, rocks: 30, danger: 10,
    spawns: [['husk', 0.4], ['imp', 0.3], ['hellhound', 0.3]],
    treeLoot: [['log', 0.3], ['heartwood', 0.6]],
    rockLoot: [['silver_ore', 0.35], ['gem', 0.45], ['iron_ore', 0.2]],
    style: 'ashen', ambience: 'embers', ambienceColor: '#e8873d',
    flora: 80, boss: 'herald', critters: 0,
    skyTop: '#6a4a44', skyBottom: '#b07050',
  },
};

export const ZONE_ORDER = ['meadow', 'woods', 'fen', 'barrows', 'ridge', 'ashen'];

// ------------------------------------------------------------------- quests

const KILL_TITLES: Record<string, string[]> = {
  boar: ['Boars in the Barley', 'The Turnip Raiders'],
  slime: ['Slimes in the Well Field', 'Something Is Eating the Cabbages'],
  spitter: ['Spitters by the Mill Pond'],
  wolf: ['Wolves at the Wagons', 'The Shepherd’s Complaint'],
  goblin: ['Goblin Raiders', 'Ears for the Bounty Clerk'],
  archer: ['Slingers on the Old Road'],
  bandit: ['Bandits on the Fen Road', 'The Toll Nobody Voted For'],
  ghoul: ['Put the Barrow Dead Back Down'],
  hexer: ['Snuff the Hexers’ Candles'],
  frost_wolf: ['Frost Wolves on the Stair'],
  harpy: ['Harpies Over the Pass'],
  troll: ['A Troll Toll'],
  husk: ['The Husks of the Field', 'Lay the Long Night to Rest'],
  imp: ['Imps in the Cinders'],
  hellhound: ['Hounds of the Long Night'],
};

const GIVERS = [
  'Farmer Odd', 'The Miller', 'Captain of the Watch', 'The Apothecary', 'The Chapel',
  'A Widow in Black', 'The Caravan Master', 'The Reeve', 'The Guild Clerk',
];

const KILL_FLAVOR = [
  'Farmer Odd lost three fields to them. He is not a rich man.',
  'They came down from the high ground last week and have not left.',
  'The caravan will not run this road until it is cleared.',
  'A child saw them near the well. That is close enough.',
  'The last party that took this came back short one member.',
];
const GATHER_FLAVOR = [
  'The smith is out of stock and the militia is out of patience.',
  'Winter comes whether we are ready or not.',
  'Pay is fair. The work is not glamorous.',
];
const RECOVER: Record<string, { title: string; flavor: string }[]> = {
  meadow: [{ title: 'The Shepherd’s Lost Satchel', flavor: 'He dropped it running from a boar. His lunch is in it, and his pride.' }],
  woods: [{ title: 'A Courier’s Last Letters', flavor: 'The courier was found. The letters were not. Three families are waiting.' }],
  fen: [{ title: 'The Survey Journal', flavor: 'A surveyor went into the fen with a journal and came out without either.' }],
  barrows: [{ title: 'Grave Goods of the Hero’s Dead', flavor: 'Robbers dug them up. The chapel wants them back where they belong.' }],
  ridge: [{ title: 'Supplies of a Lost Expedition', flavor: 'An expedition cached food on the Stair and never came down for it.' }],
  ashen: [{ title: 'Relics of the Long Night', flavor: 'Swords and banners from the last battle. The ground keeps giving them back.' }],
};
const BOSS_FLAVOR = [
  'Four adventurers took this contract. None came back. The purse has grown.',
  'The guild does not post this lightly. Make your will first.',
  'It has learned to recognise guild plates. Take yours off, if you like.',
];

/** Named troublemakers for bounty notices, by the kind of creature they are. */
export const ELITE_NAMES: Record<string, string[]> = {
  boar: ['Scarback', 'Old Mud'], slime: ['The Big One'], spitter: ['Bilegut'],
  wolf: ['One-Ear', 'Greymuzzle'], goblin: ['Grisk the Cruel'], archer: ['Deadeye Pip'],
  bandit: ['Red Halden', 'Two-Knives Maud'], ghoul: ['The Gnawer'], hexer: ['Mother Wick'],
  frost_wolf: ['Whitefang'], harpy: ['Shrieking Oda'], troll: ['Borg the Toll'],
  husk: ['The Burned Captain'], imp: ['Cinderwit'], hellhound: ['Scorch'],
};

const REWARD_ITEMS = [
  ['copper_ring', 'boots', 'leather_cap', 'buckler'],
  ['bone_charm', 'buckler', 'wand', 'dagger'],
  ['kite_shield', 'iron_helm', 'heart_locket', 'greatsword'],
  ['chainmail', 'robe', 'runewood_staff', 'battleaxe'],
  ['heart_locket', 'runed_axe', 'deepiron_pick', 'kite_shield'],
  ['greatsword', 'runewood_staff', 'chainmail', 'robe'],
  ['heart_locket', 'greatsword', 'runewood_staff', 'chainmail'],
];

function zoneFor(rank: number): string {
  const r = Math.max(0, Math.min(5, rank));
  return ZONE_ORDER[r];
}

function scaleFor(cr: number): number {
  return Math.pow(1 + cr * 0.9, 1.3);
}

/** Merit for a contract, depending on whose plate takes it. */
export function meritFor(cr: number, yourRank: number, kind: Quest['kind']): number {
  const base = CONTRACT_MERIT[Math.max(0, Math.min(CONTRACT_MERIT.length - 1, cr))];
  const kindMult = kind === 'boss' ? 2 : kind === 'bounty' ? 1.4 : kind === 'chop' || kind === 'mine' ? 0.8 : 1;
  const rel = cr < yourRank ? 0.5 : cr > yourRank ? 1.5 : 1;
  return Math.round(base * kindMult * rel);
}

function contract(
  r: RNG, cr: number, yourRank: number, prosperity: number, allowBoss: boolean,
): Quest {
  const zoneId = zoneFor(cr);
  const zone = ZONES[zoneId];
  const pros = 0.8 + prosperity / 100 * 0.5;
  const sc = scaleFor(cr);
  const roll = r.next();
  const base = {
    id: uid(), zoneId, have: 0, rank: cr, giver: r.pick(GIVERS),
  };

  if (allowBoss && roll < 0.2) {
    const pool = [zone.boss, ...(zone.extraBosses ?? [])];
    const bossId = r.pick(pool);
    const m = MONSTERS[bossId];
    return {
      ...base, title: 'Contract: ' + m.name, kind: 'boss', target: bossId, targetName: m.name,
      need: 1, rewardGold: Math.round(240 * sc * pros), rewardXp: Math.round(180 * sc),
      rewardSkill: m.skill, flavor: r.pick(BOSS_FLAVOR), danger: m.danger, giver: 'The Guild',
      rewardItemDef: r.pick(REWARD_ITEMS[Math.min(6, cr + 1)]),
      merit: meritFor(cr, yourRank, 'boss'),
    };
  }
  if (roll < 0.6) {
    const mid = r.pick(zone.spawns.map((s) => s[0]));
    const m = MONSTERS[mid];
    const need = r.int(5, 9);
    return {
      ...base, title: r.pick(KILL_TITLES[mid] ?? ['Cull the ' + m.name + 's']), kind: 'kill',
      target: mid, targetName: m.name, need,
      rewardGold: Math.round(need * (5 + m.danger * 3) * sc * pros),
      rewardXp: Math.round(need * m.xp * 0.6), rewardSkill: m.skill,
      flavor: r.pick(KILL_FLAVOR), danger: m.danger, merit: meritFor(cr, yourRank, 'kill'),
    };
  }
  if (roll < 0.8) {
    const rec = r.pick(RECOVER[zoneId]);
    const need = r.int(2, 3);
    return {
      ...base, title: rec.title, kind: 'recover', target: 'cache', targetName: 'lost things found',
      need, rewardGold: Math.round(70 * sc * pros), rewardXp: Math.round(60 * sc),
      rewardSkill: 'footwork', flavor: rec.flavor, danger: zone.danger,
      merit: meritFor(cr, yourRank, 'recover'),
    };
  }
  const chop = r.chance(0.5);
  const need = r.int(6, 12);
  return {
    ...base,
    title: chop ? r.pick(['Timber for the Mill', 'Beams for the Chapel Roof']) : r.pick(['Ore for the Forge', 'Iron for the Watch']),
    kind: chop ? 'chop' : 'mine', target: chop ? 'log' : 'iron_ore', targetName: chop ? 'Oak Log' : 'Iron Ore',
    need, rewardGold: Math.round(need * 7 * sc * pros), rewardXp: need * 14,
    rewardSkill: chop ? 'woodcutting' : 'mining', flavor: r.pick(GATHER_FLAVOR), danger: zone.danger,
    merit: meritFor(cr, yourRank, chop ? 'chop' : 'mine'),
  };
}

function bounty(r: RNG, cr: number, yourRank: number, prosperity: number): Quest {
  const zoneId = zoneFor(cr);
  const zone = ZONES[zoneId];
  const mid = r.pick(zone.spawns.map((s) => s[0]));
  const m = MONSTERS[mid];
  const name = r.pick(ELITE_NAMES[mid] ?? ['The Brute']);
  const sc = scaleFor(cr);
  const pros = 0.8 + prosperity / 100 * 0.5;
  return {
    id: uid(), zoneId, have: 0, rank: cr,
    title: 'Wanted: ' + name, kind: 'bounty', target: mid, targetName: name + ' (' + m.name + ')',
    eliteName: name, need: 1,
    rewardGold: Math.round(150 * sc * pros), rewardXp: Math.round(m.xp * 6),
    rewardSkill: m.skill, giver: 'Captain of the Watch',
    flavor: name + ' is bigger than the rest, meaner than the rest, and has a price on its head.',
    danger: m.danger + 1, merit: meritFor(cr, yourRank, 'bounty'),
    rewardItemDef: r.pick(REWARD_ITEMS[Math.min(6, cr)]),
  };
}

/**
 * The board always has work at your plate, one easy posting, one a plate above
 * you for the ambitious, and usually a bounty. Nobody should look at it and
 * find nothing worth doing.
 */
export function rollBoard(r: RNG, rank: number, prosperity: number): Quest[] {
  const top = Math.min(5, rank);
  const plan = [top, top, Math.max(0, top - 1), Math.min(5, rank + 1)];
  const out = plan.map((cr) => contract(r, cr, rank, prosperity, cr < rank));
  if (r.chance(0.75)) out.push(bounty(r, Math.min(5, top + (r.chance(0.3) ? 1 : 0)), rank, prosperity));
  return out;
}

const TRIAL_FLAVOR = [
  'Old Tusker has eaten half the barley in Kestrel and a scarecrow. Bring back a tusk and you wear iron.',
  'The Grovewarden killed two iron plates last spring. Walk out of Thornwood and you have earned bronze.',
  'Fangmaw hunts the fen road. The bronze plates that went after it are why the purse is so large.',
  'The Hollow King was a squire to the Hero once. Give him the rest he was denied, and you wear silver.',
  'Stormtalon has nested on the Greyspine since before I lost the arm. Take her, and you are gold.',
  'Vessarine. The last of the Heralds. If she is walking, the Long Night is not over. End it.',
];

/** The contract the veteran offers when your merit says you are ready. */
export function trialQuest(rank: number): Quest | null {
  const R = RANKS[rank];
  if (!R || !R.trialBoss || !R.trialZone) return null;
  const m = MONSTERS[R.trialBoss];
  const next = rankDef(rank + 1);
  return {
    id: 'trial-' + rank, title: 'Trial for the ' + next.plate, kind: 'boss', trial: true,
    target: R.trialBoss, targetName: m.name, need: 1, have: 0, zoneId: R.trialZone,
    rewardGold: Math.round(200 * scaleFor(rank)), rewardXp: Math.round(260 * scaleFor(rank)),
    rewardSkill: m.skill, giver: 'Garran Holt', flavor: TRIAL_FLAVOR[rank] ?? '',
    danger: m.danger, rank, merit: 0,
  };
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
