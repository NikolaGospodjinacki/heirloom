import type { Appearance, ClassId, Hero, Skills, SkillKey, Stats, Trait, Village, VillageNPC } from './types';
import { RNG } from './rng';

const FIRST = [
  'Rudeus', 'Aldric', 'Bren', 'Cass', 'Doran', 'Elric', 'Fenn', 'Garrick', 'Hale', 'Ivo',
  'Jarek', 'Kelda', 'Lira', 'Maro', 'Nessa', 'Orin', 'Perrin', 'Quill', 'Roswyn', 'Sable',
  'Tomas', 'Ulf', 'Vera', 'Wyn', 'Yorick', 'Zelda', 'Mira', 'Corvin', 'Piers', 'Sylva',
];
const HOUSE = [
  'Greyrat', 'Ashvale', 'Thornbury', 'Holloway', 'Marsh', 'Duncan', 'Varden',
  'Fairweather', 'Blackstock', 'Ironmoor', 'Wexley', 'Pendry', 'Calloway', 'Redfen',
];
const NPC_FIRST = ['Boreas', 'Ghislaine', 'Zenith', 'Paul', 'Lilia', 'Sauros', 'Nanahoshi', 'Talhand', 'Elinalise', 'Gustav', 'Wilma', 'Otto', 'Bertha', 'Sig'];

export function heroName(r: RNG): string {
  return r.pick(FIRST) + ' ' + r.pick(HOUSE);
}
export function surnameOf(name: string): string {
  const p = name.split(' ');
  return p[p.length - 1];
}
export function npcName(r: RNG): string {
  return r.pick(NPC_FIRST) + ' ' + r.pick(HOUSE);
}

const SKIN = ['#f0c9a4', '#e0ab7d', '#c68a5e', '#9a6440', '#6f4529', '#f6dcc0'];
const HAIR = ['#2b2118', '#5b3a1e', '#9c6b2f', '#d8c07a', '#c95b3a', '#e8e4dc', '#4a5f8a', '#7a3f6d'];
const CLOTH = ['#4d6a92', '#7a4a3a', '#43704f', '#6a4a7d', '#8a6f3a', '#3f4a5c', '#8a3f47'];
const ACCENT = ['#d8b45a', '#c7d0dd', '#b06a3a', '#5ec2b4', '#d16f8a'];

export function rollAppearance(r: RNG): Appearance {
  return {
    skin: r.pick(SKIN),
    hair: r.pick(HAIR),
    cloth: r.pick(CLOTH),
    accent: r.pick(ACCENT),
    build: r.float(0, 1),
    hairStyle: r.int(0, 3),
    height: r.float(0.9, 1.14),
  };
}

export const TRAITS: Trait[] = [
  { id: 'none', name: 'Unremarkable', desc: 'No gift, no curse.', good: true },
  { id: 'prodigy', name: 'Prodigy', desc: '+25% skill experience.', good: true },
  { id: 'ironblood', name: 'Ironblood', desc: '+30 max health.', good: true },
  { id: 'lucky', name: 'Born Lucky', desc: 'Noticeably better drops.', good: true },
  { id: 'swift', name: 'Fleet-Footed', desc: '+18% movement speed.', good: true },
  { id: 'mageborn', name: 'Mageborn', desc: '+35% spell power, -15% weapon damage.', good: true },
  { id: 'brute', name: 'Brute', desc: '+30% weapon damage, -25% spell power.', good: true },
  { id: 'merchant', name: 'Merchant Blood', desc: 'Buy 15% cheaper, sell 20% dearer.', good: true },
  { id: 'sickly', name: 'Sickly', desc: '-25 max health, but +2 to every stat.', good: false },
  { id: 'cursed', name: 'Ill-Starred', desc: 'Worse drops, but gold finds you.', good: false },
  { id: 'clumsy', name: 'Clumsy', desc: '-12% movement speed, +20% experience.', good: false },
];

export function emptySkills(): Skills {
  const keys: SkillKey[] = ['blade', 'sorcery', 'hunting', 'slaying', 'woodcutting', 'mining', 'haggling', 'vigor'];
  const s = {} as Skills;
  for (const k of keys) s[k] = { xp: 0 };
  return s;
}

/** RS-style: cheap early, brutal late. */
export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.pow(xp / 42, 1 / 1.55)) + 1);
}
export function xpForLevel(level: number): number {
  return Math.ceil(Math.pow(Math.max(0, level - 1), 1.55) * 42);
}
export function levelProgress(xp: number): { level: number; into: number; need: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, into: xp - base, need: next - base };
}

export interface BloodlineMemory {
  /** fraction of each skill xp carried to the heir */
  legacy: Partial<Record<SkillKey, number>>;
  /** permanent stat floor earned across lives */
  bloodlineBonus: number;
}

export function rollHero(r: RNG, classId: ClassId, gen: number, memory: BloodlineMemory): Hero {
  const base: Stats = classId === 'warrior'
    ? { str: 8, int: 3, vit: 8, agi: 5, luck: 4 }
    : { str: 3, int: 9, vit: 5, agi: 5, luck: 5 };
  const stats = { ...base };
  // Every heir is a dice roll. Sometimes you get a monster, sometimes a weakling.
  const spread = 7;
  for (const k of Object.keys(stats) as (keyof Stats)[]) {
    stats[k] = Math.max(1, stats[k] + r.bell(-spread, spread, 3) + memory.bloodlineBonus);
  }
  const trait = r.chance(0.55) ? r.pick(TRAITS.slice(1)) : TRAITS[0];
  if (trait.id === 'sickly') for (const k of Object.keys(stats) as (keyof Stats)[]) stats[k] += 2;

  const skills = emptySkills();
  for (const [k, frac] of Object.entries(memory.legacy)) {
    skills[k as SkillKey].xp = Math.floor((frac ?? 0));
  }

  return {
    name: heroName(r),
    classId,
    stats,
    appearance: rollAppearance(r),
    skills,
    hp: 1, mana: 1,
    trait,
    generation: gen,
  };
}

// ------------------------------------------------------------------ village

const VILLAGE_NAMES = ['Buena', 'Roa', 'Millis', 'Fittoa', 'Hollowmere', 'Ashford', 'Stonebrook', 'Larkfen'];

const THRIVING_LINES = [
  'Trade has been good. Take a look at the good stock.',
  'The road is safe again, thanks to folk like you.',
  'We are building a new granary. Fine times.',
];
const STRUGGLING_LINES = [
  'Half the young ones left for the city. Buy something, please.',
  'Wolves at the fence again. Nobody sleeps well.',
  'Prices are what they are. I have mouths to feed.',
];

export function rollVillage(r: RNG, prosperity: number, era: number, prevName?: string): Village {
  const preset: Village['preset'] = prosperity >= 50 ? 'thriving' : 'struggling';
  const lines = preset === 'thriving' ? THRIVING_LINES : STRUGGLING_LINES;
  const priceBase = preset === 'thriving' ? 0.92 : 1.12;
  const npcs: VillageNPC[] = [
    { role: 'shopkeeper', name: npcName(r), line: r.pick(lines), priceMod: priceBase * r.float(0.94, 1.08) },
    { role: 'guildmaster', name: npcName(r), line: r.pick(lines), priceMod: 1 },
    { role: 'smith', name: npcName(r), line: r.pick(lines), priceMod: priceBase * r.float(0.94, 1.08) },
  ];
  return {
    name: prevName ?? r.pick(VILLAGE_NAMES),
    prosperity,
    era,
    npcs,
    preset,
  };
}
