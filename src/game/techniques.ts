/**
 * Movement techniques. These are BLOODLINE knowledge: bought with Memory and
 * kept forever, because the body remembers what the name learned. This is the
 * meta-progression that is not just bigger numbers.
 */
export interface Technique {
  id: string;
  name: string;
  desc: string;
  cost: number;
  requires: string[];
  /** column in the tree view */
  tier: number;
}

export const TECHNIQUES: Technique[] = [
  {
    id: 'dash', name: 'Sidestep', tier: 0, cost: 0, requires: [],
    desc: 'A short burst of speed. Brief invulnerability at the start of the move.',
  },
  {
    id: 'long_stride', name: 'Long Stride', tier: 1, cost: 1, requires: ['dash'],
    desc: '+12% movement speed, always.',
  },
  {
    id: 'second_wind', name: 'Second Wind', tier: 1, cost: 2, requires: ['dash'],
    desc: 'A second dash charge.',
  },
  {
    id: 'phase_step', name: 'Phase Step', tier: 2, cost: 2, requires: ['dash'],
    desc: 'Invulnerability lasts the whole dash instead of the first instant.',
  },
  {
    id: 'momentum', name: 'Momentum', tier: 2, cost: 2, requires: ['long_stride'],
    desc: 'Landing a dash grants +35% speed for 2 seconds.',
  },
  {
    id: 'quick_recovery', name: 'Quick Recovery', tier: 2, cost: 2, requires: ['second_wind'],
    desc: 'Dash charges refill 35% faster.',
  },
  {
    id: 'bull_rush', name: 'Bull Rush', tier: 3, cost: 3, requires: ['momentum'],
    desc: 'Dashing through an enemy knocks it back and deals half your attack.',
  },
  {
    id: 'third_wind', name: 'Third Wind', tier: 3, cost: 4, requires: ['quick_recovery'],
    desc: 'A third dash charge.',
  },
  {
    id: 'blink', name: 'Blink', tier: 4, cost: 5, requires: ['phase_step'],
    desc: 'The dash becomes an instant hop. Nothing can touch you between here and there.',
  },
];

export function techById(id: string): Technique | undefined {
  return TECHNIQUES.find((t) => t.id === id);
}

export function canLearn(known: string[], memory: number, t: Technique): boolean {
  if (known.includes(t.id)) return false;
  if (memory < t.cost) return false;
  return t.requires.every((r) => known.includes(r));
}

export interface DashProfile {
  charges: number;
  cooldown: number;      // seconds to refill one charge
  duration: number;      // seconds of dash movement
  speed: number;         // multiplier on move speed
  iframes: number;       // seconds of invulnerability from dash start
  momentum: boolean;
  bullRush: boolean;
  blink: boolean;
  staminaCost: number;
}

export function dashProfile(known: string[], footworkLevel: number): DashProfile {
  let charges = 1;
  if (known.includes('second_wind')) charges++;
  if (known.includes('third_wind')) charges++;

  let cooldown = 1.15 * (1 - Math.min(0.45, footworkLevel * 0.015));
  if (known.includes('quick_recovery')) cooldown *= 0.65;

  const blink = known.includes('blink');
  const duration = blink ? 0.09 : 0.19;
  const iframes = blink ? duration : known.includes('phase_step') ? duration : 0.1;

  return {
    charges,
    cooldown,
    duration,
    speed: blink ? 7.5 : 3.4,
    iframes,
    momentum: known.includes('momentum'),
    bullRush: known.includes('bull_rush'),
    blink,
    staminaCost: 18,
  };
}

/** Memory earned by a life, spent on techniques by the heir. */
export function memoryEarned(kills: number, quests: number, bosses: number, gen: number): number {
  let m = 0;
  m += Math.floor(quests / 2);
  m += Math.floor(kills / 35);
  m += bosses * 2;
  if (gen === 1) m += 1; // the first of the name always leaves something
  return Math.max(1, m);
}
