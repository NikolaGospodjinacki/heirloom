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

/** A descendant: mostly the parent's face, with a couple of things rerolled. */
export function descendantOf(r: RNG, parent: Appearance): Appearance {
  const a = { ...parent };
  a.skin = r.chance(0.75) ? parent.skin : r.pick(SKIN);
  a.hair = r.chance(0.6) ? parent.hair : r.pick(HAIR);
  a.hairStyle = r.chance(0.35) ? parent.hairStyle : r.int(0, 3);
  a.cloth = r.pick(CLOTH);
  a.accent = r.pick(ACCENT);
  a.build = Math.max(0, Math.min(1, parent.build + r.float(-0.25, 0.25)));
  a.height = Math.max(0.88, Math.min(1.16, parent.height + r.float(-0.06, 0.06)));
  return a;
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
  const keys: SkillKey[] = ['blade', 'sorcery', 'hunting', 'slaying', 'woodcutting', 'mining', 'haggling', 'vigor', 'footwork'];
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

const THRIVING_LINES: Record<VillageNPC['role'], string[]> = {
  shopkeeper: [
    'Trade has been good. Take a look at the proper stock, not the shelf by the door.',
    'Caravans twice a month now. I can afford to be picky about what I buy.',
    'Coin moves, and when coin moves everybody eats. What do you need?',
  ],
  guildmaster: [
    'Full board today. Half of it is honest work, the other half pays better.',
    'We have had three good years. Do not be the one who ends them.',
    'Adventurers with your name have sat in that chair before. Some walked out again.',
  ],
  smith: [
    'Charcoal is cheap and my forge is hot. Bring me something worth ruining.',
    'I have apprentices now. Two of them are even useful.',
    'Good steel, fair price. That is the whole speech.',
  ],
};
const STRUGGLING_LINES: Record<VillageNPC['role'], string[]> = {
  shopkeeper: [
    'Half the young ones left for the city. Buy something. Please.',
    'I sell what I can get, and lately I cannot get much.',
    'Prices are what they are. I have mouths to feed and no caravan since spring.',
  ],
  guildmaster: [
    'Board is thin. Nobody posts work they cannot pay for.',
    'Wolves at the fence again. Nobody in this village sleeps well.',
    'I have buried more adventurers than I have hired. Do not take that personally.',
  ],
  smith: [
    'Fuel costs more than the steel. Do not ask me how that works.',
    'I mend pots now. Pots. Bring me a real commission.',
    'Everything I make gets sold south. Nothing stays here.',
  ],
};

export function rollVillage(
  r: RNG, prosperity: number, era: number, prevName?: string, prev?: VillageNPC[],
): Village {
  const preset: Village['preset'] = prosperity >= 50 ? 'thriving' : 'struggling';
  const lines = preset === 'thriving' ? THRIVING_LINES : STRUGGLING_LINES;
  const priceBase = preset === 'thriving' ? 0.92 : 1.12;
  const roles: VillageNPC['role'][] = ['shopkeeper', 'guildmaster', 'smith'];
  const npcs: VillageNPC[] = roles.map((role) => {
    const parent = prev?.find((p) => p.role === role);
    // The shop does not change hands, it changes generations. Faces stay in the family.
    const appearance = parent ? descendantOf(r, parent.appearance) : rollAppearance(r);
    const name = parent
      ? r.pick(NPC_FIRST) + ' ' + surnameOf(parent.name)
      : npcName(r);
    return {
      role, name, appearance,
      line: r.pick(lines[role]),
      mood: r.shuffle([...lines[role]]),
      priceMod: role === 'guildmaster' ? 1 : priceBase * r.float(0.94, 1.08),
    };
  });
  return { name: prevName ?? r.pick(VILLAGE_NAMES), prosperity, era, npcs, preset };
}
