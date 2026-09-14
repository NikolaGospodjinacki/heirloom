import { RNG } from './rng';
import type { GameState } from './state';
import type { Mote, Rect, Spot, Town, TownNPC } from './town';
import { TS } from './terrain';
import { rollAppearance } from './bloodline';
import { SYLWEN, clerk, localParty, veteran } from '../ui/story';

/**
 * The inside of the Adventurers Guild. It reuses the town's walking and talking
 * so it gets the same feel, with its own furniture and the people who matter:
 * the clerk, the veteran who runs trials, the elf who never left, and whichever
 * party is drinking in the corner this generation.
 */

export type FurnitureKind =
  | 'counter' | 'table' | 'bench' | 'fireplace' | 'board' | 'registry' | 'trophies'
  | 'memorial' | 'shelf' | 'barrel' | 'rug' | 'window' | 'banner' | 'crate' | 'plant' | 'pillar';

export interface Furniture {
  kind: FurnitureKind;
  x: number; y: number;
  w: number; d: number;
  /** height in world units, for boxes */
  h?: number;
  color?: string;
  variant?: number;
  solid?: boolean;
}

export interface Hall extends Town {
  furniture: Furniture[];
  /** where the door out is, in sim px */
  doorX: number; doorY: number;
}

export const HALL_W = 20;
export const HALL_H = 15;

export function buildHall(st: GameState): Hall {
  const W = HALL_W * TS, H = HALL_H * TS;
  const r = new RNG(st.village.era * 4241 + 17);
  const furniture: Furniture[] = [];
  const npcs: TownNPC[] = [];
  const F = (f: Furniture) => furniture.push({ solid: true, ...f });

  // the back wall carries the work: the board, the counter, the registry of plates
  F({ kind: 'board', x: W * 0.26, y: 132, w: 170, d: 20, h: 2.6, solid: false });
  F({ kind: 'registry', x: W * 0.74, y: 132, w: 170, d: 20, h: 2.6, solid: false });
  F({ kind: 'counter', x: W / 2, y: 236, w: 250, d: 44, h: 1.4, color: '#6b4a2a' });
  F({ kind: 'shelf', x: W / 2, y: 132, w: 150, d: 24, h: 3.4, solid: false });
  F({ kind: 'window', x: 72, y: 300, w: 12, d: 120, solid: false });
  F({ kind: 'window', x: W - 72, y: 520, w: 12, d: 120, solid: false });
  F({ kind: 'banner', x: W * 0.12, y: 124, w: 60, d: 10, color: '#8c4a3f', solid: false });
  F({ kind: 'banner', x: W * 0.88, y: 124, w: 60, d: 10, color: '#8c4a3f', solid: false });

  // the fire, and the veteran's chair beside it
  F({ kind: 'fireplace', x: W - 150, y: 150, w: 150, d: 44, h: 3.2 });
  F({ kind: 'bench', x: W - 150, y: 300, w: 90, d: 30, h: 0.6, color: '#5a3e24' });

  // the memorial on the west wall, trophies on the east
  F({ kind: 'memorial', x: 60, y: 520, w: 20, d: 200, h: 2.6, solid: false });
  F({ kind: 'trophies', x: W - 60, y: 330, w: 20, d: 150, h: 2.8, solid: false });

  // tables and the corner where the local party drinks
  F({ kind: 'rug', x: W / 2, y: 470, w: 380, d: 200, color: '#5e4a3a', solid: false });
  F({ kind: 'table', x: 250, y: 470, w: 100, d: 70, h: 0.95 });
  F({ kind: 'table', x: W / 2 + 40, y: 500, w: 100, d: 70, h: 0.95 });
  F({ kind: 'table', x: W - 270, y: 560, w: 100, d: 70, h: 0.95 });
  F({ kind: 'bench', x: 250, y: 525, w: 110, d: 24, h: 0.55, color: '#5a3e24' });
  F({ kind: 'bench', x: W / 2 + 40, y: 555, w: 110, d: 24, h: 0.55, color: '#5a3e24' });
  F({ kind: 'bench', x: 160, y: 300, w: 100, d: 30, h: 0.6, color: '#5a3e24' });
  F({ kind: 'pillar', x: W * 0.32, y: 360, w: 30, d: 30, h: 5 });
  F({ kind: 'pillar', x: W * 0.68, y: 360, w: 30, d: 30, h: 5 });
  for (const [x, y] of [[110, 180], [140, 640], [W - 110, 650], [W * 0.38, 640]] as [number, number][]) {
    F({ kind: r.chance(0.5) ? 'barrel' : 'crate', x, y, w: 36, d: 36, h: 0.9, variant: r.int(0, 1) });
  }
  F({ kind: 'plant', x: W * 0.42, y: 170, w: 30, d: 30, solid: false });

  // ------------------------------------------------------------------ people
  const person = (
    id: string, kind: TownNPC['kind'], name: string, x: number, y: number,
    appearance: TownNPC['appearance'], look: TownNPC['look'], lines: string[] = [],
  ) => {
    npcs.push({
      id, kind, name, x, y, hx: x, hy: y, homeR: 0, t: 0, facing: Math.PI / 2,
      walkT: r.float(0, 4), speed: 0, appearance, lines, fixed: true, look,
    });
  };
  const c = clerk(st);
  // close enough to the counter that you can talk to her across it
  person('clerk', 'clerk', c.name, W / 2, 216, c.appearance, {});
  const v = veteran(st);
  person('veteran', 'veteran', v.name, W - 150, 288, v.appearance,
    { beard: v.appearance.beard, patch: v.appearance.patch, oneArm: !v.successor, cape: '#3a5a6a' });
  person('elf', 'elf', SYLWEN.name, 160, 288, SYLWEN.appearance, { ears: true, cape: '#3f6a4a', staff: true });
  const party = localParty(st);
  const seats: [number, number][] = [[205, 468], [295, 468], [250, 510]];
  party.members.forEach((m, i) => {
    const [x, y] = seats[i];
    person('adv:' + m.name, 'adventurer', m.name, x, y, rollAppearance(new RNG(st.village.era * 97 + i * 13)),
      { cape: '#8a3f47', sword: i === 0, staff: i === 1 });
  });
  if (st.village.preset === 'thriving') {
    person('newcomer', 'folk', 'A Nervous Recruit', W / 2 + 90, 440, rollAppearance(r),
      {}, ['First day. They gave me a copper plate and a pat on the back.', 'Is it normal for the plate to feel this heavy?']);
  }

  // --------------------------------------------------------------- colliders
  const colliders: Rect[] = [
    { x: 0, y: 0, w: W, h: 150 },               // back wall
    { x: 0, y: 0, w: 40, h: H },                // west wall
    { x: W - 40, y: 0, w: 40, h: H },           // east wall
    { x: 0, y: H - 18, w: W / 2 - 60, h: 40 },  // the front wall, either side of the door
    { x: W / 2 + 60, y: H - 18, w: W / 2 - 60, h: 40 },
  ];
  for (const f of furniture) {
    if (!f.solid) continue;
    colliders.push({ x: f.x - f.w / 2, y: f.y - f.d / 2, w: f.w, h: f.d });
  }

  const spots: Spot[] = [
    { id: 'board', x: W * 0.26, y: 190, label: 'Quest Board', prompt: 'read the postings', r: 70 },
    { id: 'registry', x: W * 0.74, y: 190, label: 'Registry of Plates', prompt: 'look at the ranks', r: 70 },
    { id: 'trophies', x: W - 110, y: 380, label: 'Trophy Wall', prompt: 'look at the trophies', r: 70 },
    { id: 'memorial', x: 100, y: 540, label: 'The Wall of Names', prompt: 'read the names', r: 80 },
    { id: 'door', x: W / 2, y: H - 40, label: 'Back to Ashford', prompt: 'leave the hall', r: 60 },
  ];

  const motes: Mote[] = [];
  for (let i = 0; i < 40; i++) {
    motes.push({
      x: r.float(60, W - 60), y: r.float(160, H - 60),
      vx: r.float(-5, 5), vy: r.float(-8, -2),
      t: r.float(0, 6), life: r.float(5, 10), s: r.float(1, 2),
    });
  }

  return {
    w: HALL_W, h: HALL_H, tiles: new Uint8Array(HALL_W * HALL_H),
    buildings: [], props: [], npcs, colliders, motes, roads: [], yard: [], spots,
    px: W / 2, py: H - 90, facing: -Math.PI / 2, walkT: 0, time: 0,
    gateX: W / 2, gateY: H - 40,
    furniture, doorX: W / 2, doorY: H - 40,
  };
}
