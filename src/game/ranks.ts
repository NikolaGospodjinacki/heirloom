/**
 * Adventurer ranks. Every guild on the continent grades its people by the
 * plate they wear. You start on copper, and each promotion is a trial against
 * something that has killed better adventurers than you.
 */

export interface RankDef {
  n: number;
  letter: 'F' | 'E' | 'D' | 'C' | 'B' | 'A' | 'S';
  plate: string;
  color: string;
  /** merit you need before the veteran will offer the trial for the next plate */
  merit: number;
  trialBoss: string | null;
  trialZone: string | null;
  /** what people call someone wearing this plate */
  title: string;
}

export const RANKS: RankDef[] = [
  { n: 0, letter: 'F', plate: 'Copper Plate', color: '#c07a45', merit: 60, trialBoss: 'old_tusker', trialZone: 'meadow', title: 'Fledgling' },
  { n: 1, letter: 'E', plate: 'Iron Plate', color: '#9aa1ab', merit: 150, trialBoss: 'grovewarden', trialZone: 'woods', title: 'Wanderer' },
  { n: 2, letter: 'D', plate: 'Bronze Plate', color: '#cd8b4a', merit: 300, trialBoss: 'fangmaw', trialZone: 'fen', title: 'Blade for Hire' },
  { n: 3, letter: 'C', plate: 'Silver Plate', color: '#d6dde6', merit: 520, trialBoss: 'hollow_king', trialZone: 'barrows', title: 'Veteran' },
  { n: 4, letter: 'B', plate: 'Gold Plate', color: '#e8c15a', merit: 850, trialBoss: 'stormtalon', trialZone: 'ridge', title: 'Champion' },
  { n: 5, letter: 'A', plate: 'Mithril Plate', color: '#8fd6e0', merit: 1300, trialBoss: 'herald', trialZone: 'ashen', title: 'Legend' },
  { n: 6, letter: 'S', plate: 'Adamant Plate', color: '#c9a0f0', merit: Infinity, trialBoss: null, trialZone: null, title: 'Hero of the Age' },
];

export const MAX_RANK = RANKS.length - 1;

export function rankDef(n: number): RankDef {
  return RANKS[Math.max(0, Math.min(MAX_RANK, Math.floor(n)))];
}

/** Merit a contract of this rank is worth, before any adjustment for who takes it. */
export const CONTRACT_MERIT = [20, 30, 45, 65, 90, 120, 160];

/** What wearing a better plate does for you. Guild training, and people getting out of your way. */
export function rankPerks(n: number): { dmg: number; hp: number; stats: number } {
  return { dmg: 0.05 * n, hp: 8 * n, stats: n >= MAX_RANK ? 2 : 0 };
}

export function rankLabel(n: number): string {
  const r = rankDef(n);
  return r.letter + ' · ' + r.plate;
}
