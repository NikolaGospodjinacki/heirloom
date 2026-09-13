import type { ClassId } from './types';

export type AbilityKey = 'q' | 'e' | 'r' | 'f';
export type Resource = 'mana' | 'stamina';

export interface AbilityDef {
  id: string;
  key: AbilityKey;
  name: string;
  desc: string;
  classId: ClassId;
  cd: number;
  cost: number;
  resource: Resource;
  color: string;
  glyph: string;
  ult?: boolean;
}

/**
 * Four buttons, always the same four buttons. Warriors pay stamina, which means
 * every ability is competing with a dash; wizards pay mana, which is competing
 * with basic attacks. That tension is the whole point.
 */
export const ABILITIES: AbilityDef[] = [
  // ------------------------------------------------------------- warrior
  {
    id: 'cleave', key: 'q', classId: 'warrior', name: 'Cleave',
    desc: 'A wide horizontal swing. Hits everything in a broad arc for 160% and shoves it back.',
    cd: 4.5, cost: 16, resource: 'stamina', color: '#e0956a', glyph: 'C',
  },
  {
    id: 'bash', key: 'f', classId: 'warrior', name: 'Shield Bash',
    desc: 'Shoulder forward. The first thing you hit is stunned for a second and a half.',
    cd: 8, cost: 20, resource: 'stamina', color: '#c8b06a', glyph: 'B',
  },
  {
    id: 'rally', key: 'e', classId: 'warrior', name: 'Rally',
    desc: 'Second wind. Heals a fifth of your health and adds 35% damage for six seconds.',
    cd: 24, cost: 22, resource: 'stamina', color: '#7fc27a', glyph: 'R',
  },
  {
    id: 'whirlwind', key: 'r', classId: 'warrior', name: 'Whirlwind', ult: true,
    desc: 'Spin for a second and a half, hitting everything around you four times. You can walk while spinning.',
    cd: 28, cost: 34, resource: 'stamina', color: '#e06a5a', glyph: 'W',
  },

  // -------------------------------------------------------------- wizard
  {
    id: 'lance', key: 'q', classId: 'wizard', name: 'Frost Lance',
    desc: 'A shard that passes through everything in a line for 150% and halves its speed.',
    cd: 4.5, cost: 13, resource: 'mana', color: '#7fc2e0', glyph: 'F',
  },
  {
    id: 'nova', key: 'f', classId: 'wizard', name: 'Arcane Nova',
    desc: 'Detonate where you stand. Everything close takes 130% and is thrown off you.',
    cd: 8, cost: 18, resource: 'mana', color: '#b48fe8', glyph: 'N',
  },
  {
    id: 'font', key: 'e', classId: 'wizard', name: 'Mana Font',
    desc: 'Draw deep. Restores 45% of your mana and shields you for a quarter of your health.',
    cd: 24, cost: 0, resource: 'mana', color: '#7fa8e0', glyph: 'M',
  },
  {
    id: 'meteor', key: 'r', classId: 'wizard', name: 'Meteor', ult: true,
    desc: 'Call down a rock where the cursor is. It takes a moment to land, and then it is 320%.',
    cd: 28, cost: 32, resource: 'mana', color: '#e0803f', glyph: 'X',
  },
];

export const ABILITY_ORDER: AbilityKey[] = ['q', 'f', 'e', 'r'];

export function abilitiesFor(classId: ClassId): AbilityDef[] {
  const mine = ABILITIES.filter((a) => a.classId === classId);
  return ABILITY_ORDER.map((k) => mine.find((a) => a.key === k)!).filter(Boolean);
}

export function abilityById(id: string): AbilityDef | undefined {
  return ABILITIES.find((a) => a.id === id);
}
