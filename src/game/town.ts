import { TS, shadow } from '../render/view';
import { drawGround, drawHero, roundRect, shade } from '../render/draw';
import { gearLook } from '../render/look';
import { RNG } from './rng';
import type { GameState } from './state';
import type { Appearance, Village } from './types';
import { rollAppearance } from './bloodline';

export type BuildingId =
  | 'guild' | 'shop' | 'smith' | 'home' | 'gate' | 'inn'
  | 'bakery' | 'tailor' | 'apothecary' | 'house';

export interface Building {
  id: BuildingId;
  key: string;
  name: string;
  x: number; y: number;
  w: number; d: number;
  color: string;
  roof: string;
  /** null for flavour buildings you cannot enter */
  prompt: string | null;
  sign?: string;
  /** lit windows at dusk */
  warm: boolean;
  storeys: number;
}

export type PropKind =
  | 'lantern' | 'stall' | 'barrel' | 'crate' | 'flowerbed' | 'bench' | 'fence'
  | 'dummy' | 'rack' | 'signpost' | 'cart' | 'laundry' | 'bush' | 'tree'
  | 'sapling' | 'pot' | 'haybale' | 'well' | 'banner' | 'crops'
  | 'moat' | 'bridge' | 'shopsign' | 'lilypad' | 'statue' | 'tower' | 'hedge';

export interface Prop {
  kind: PropKind;
  x: number; y: number;
  variant: number;
  /** fence and laundry run to a second point */
  x2?: number; y2?: number;
  /** moat and bridge are rectangles */
  w?: number; h?: number;
  color?: string;
  label?: string;
}

export type NpcKind = 'guard' | 'kid' | 'elder' | 'merchant' | 'folk' | 'cat'
  | 'clerk' | 'veteran' | 'elf' | 'adventurer';

/** Small touches that make the important people recognisable at a glance. */
export interface NpcLook { ears?: boolean; beard?: string; patch?: boolean; cape?: string; staff?: boolean; sword?: boolean; oneArm?: boolean }

export interface TownNPC {
  id: string;
  kind: NpcKind;
  name: string;
  x: number; y: number;
  hx: number; hy: number;
  homeR: number;
  t: number;
  facing: number;
  walkT: number;
  speed: number;
  appearance: Appearance;
  lines: string[];
  /** guards hold their post */
  fixed: boolean;
  look?: NpcLook;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Something you can walk up to and use that is not a person or a door: a plaque, a board, the road. */
export interface Spot { id: string; x: number; y: number; label: string; prompt: string; r?: number }

export interface Mote { x: number; y: number; vx: number; vy: number; t: number; life: number; s: number }

export interface Town {
  w: number; h: number;
  tiles: Uint8Array;
  buildings: Building[];
  props: Prop[];
  npcs: TownNPC[];
  colliders: Rect[];
  motes: Mote[];
  roads: { x1: number; y1: number; x2: number; y2: number; w: number }[];
  px: number; py: number;
  facing: number;
  walkT: number;
  time: number;
  gateX: number; gateY: number;
  /** where the homestead plots are laid out, filled in at build time */
  yard: { id: string; x: number; y: number }[];
  spots: Spot[];
}

export type Interact =
  | { kind: 'building'; b: Building }
  | { kind: 'npc'; n: TownNPC }
  | { kind: 'spot'; s: Spot }
  | null;

// --------------------------------------------------------------- population

const KID_NAMES = ['Pim', 'Nell', 'Tobin', 'Wren', 'Bo', 'Sissel', 'Fen'];
const ELDER_NAMES = ['Old Marta', 'Grandpa Ove', 'Granny Hild', 'Old Bardolf'];
const FOLK_NAMES = ['Ilsa', 'Corin', 'Rue', 'Halvard', 'Mera', 'Tam', 'Josa', 'Peret'];
const GUARD_NAMES = ['Sergeant Bram', 'Watchman Ode', 'Corporal Yew', 'Guardsman Pell'];

const KID_LINES = [
  ['When I grow up I am going to wear an adamant plate. Like the Hero!', 'The elf at the guild said I would make a good copper. What does that mean?'],
  ['You have a real sword! Can I hold it? No? Fine.', 'When I grow up I am going to fight a dragon. A small one first.'],
  ['I found a frog by the fountain and now I cannot find the frog.', 'If you see a frog, it is mine.'],
  ['Mum says adventurers all die young. You look fine to me!'],
  ['Bet you cannot jump over the whole fountain. Bet you.'],
  ['My sister went to the guild and came back with a scar and a hat. I want the hat.'],
];
const ELDER_LINES = [
  ['I have watched four of your family walk out that gate.', 'Three came back. Sit down some time, will you?'],
  ['The bell used to ring at dusk. Nobody rings it now.', 'Not for any reason. We just stopped.'],
  ['My knees tell the weather better than the almanac. Rain by evening.'],
  ['Eat something before you go. You all forget to eat.'],
];
const FOLK_LINES = [
  ['Morning. Roads have been quiet, which is either good news or the other kind.'],
  ['If you are heading out, the meadow is thick with boar this season.'],
  ['My husband swears he saw lights over the fen. He also swears at the cat.'],
  ['New face at the guild every month. Old face in the ground every other.', 'Sorry. Long week.'],
  ['They say if you donate enough to the village, the roofs stop leaking.', 'They say a lot of things. That one seems to be true.'],
  ['Careful out there. Come back and buy something.'],
];
const MERCHANT_LINES = [
  ['Fresh from the caravan. Mostly fresh. Fresh enough.'],
  ['I do not haggle before noon. After noon I am a different man.'],
  ['Buy two and I will pretend that is a discount.'],
];
const GUARD_LINES = [
  ['That statue in the square? Edric Harrow. Born three streets from here.', 'Every child in Ashford has tried to climb it. Most of them fell off.'],
  ['Road is open. Keep your hood down past the treeline.'],
  ['Gate shuts at dark. Bang on it and I will let you in, grumbling.'],
  ['Guild business? Go on through. Try to come back.'],
  ['Fourth adventurer today. Two came back. Statistically you are fine.'],
];
const CAT_LINES = [
  ['The cat looks at you.', 'The cat continues to look at you.'],
  ['The cat permits one (1) scratch behind the ear.'],
  ['The cat is asleep in the exact centre of the road.'],
];

function linesFor(kind: NpcKind, r: RNG): string[] {
  switch (kind) {
    case 'kid': return r.pick(KID_LINES);
    case 'elder': return r.pick(ELDER_LINES);
    case 'merchant': return r.pick(MERCHANT_LINES);
    case 'guard': return r.pick(GUARD_LINES);
    case 'cat': return r.pick(CAT_LINES);
    default: return r.pick(FOLK_LINES);
  }
}

function nameFor(kind: NpcKind, r: RNG): string {
  switch (kind) {
    case 'kid': return r.pick(KID_NAMES);
    case 'elder': return r.pick(ELDER_NAMES);
    case 'guard': return r.pick(GUARD_NAMES);
    case 'cat': return r.pick(['Biscuit', 'Mackerel', 'Duchess', 'Sir Lump']);
    default: return r.pick(FOLK_NAMES);
  }
}

// -------------------------------------------------------------------- build

export function buildTown(st: GameState): Town {
  const W = 40, H = 40;
  const tiles = new Uint8Array(W * H);
  for (let i = 0; i < tiles.length; i++) tiles[i] = Math.random() < 0.16 ? 1 : 0;

  const cx = (W * TS) / 2;
  const cy = (H * TS) / 2;
  const rich = st.village.preset === 'thriving';
  // Faces and names stay put for a whole era, even though the map is rebuilt
  // every time you walk back through the gate.
  const r = new RNG(st.village.era * 7919 + 104729);

  const buildings: Building[] = [];
  const props: Prop[] = [];
  const npcs: TownNPC[] = [];
  const roads: Town['roads'] = [];

  const B = (
    id: BuildingId, key: string, name: string, x: number, y: number,
    w: number, d: number, color: string, roof: string,
    prompt: string | null, storeys = 1,
  ) => {
    buildings.push({ id, key, name, x, y, w, d, color, roof, prompt, warm: true, storeys });
  };

  // ------------------------------------------------------ the shop street
  // Two facing rows down a narrow lane running north out of the square.
  const laneX = cx;
  const westX = laneX - 268, eastX = laneX + 118;
  const step = 178;
  const top = cy - 240;
  B('bakery', 'bakery', 'Ostrun Bakery', westX, top, 150, 118, '#b6a184', '#9d5f4a', null, 2);
  B('shop', 'shop', 'General Store', eastX, top + 26, 154, 122, '#a89577', '#4f6b7a', 'buy & sell', 2);
  B('apothecary', 'apothecary', 'Apothecary', westX - 4, top - step, 142, 114, '#9fa887', '#5c6b4a', null, 2);
  B('smith', 'smith', 'Smithy', eastX + 4, top - step + 14, 150, 118, '#8c7f74', '#584a44', 'enhance gear', 1);
  B('tailor', 'tailor', 'Thimble & Thread', westX + 2, top - step * 2, 140, 112, '#b09a8e', '#7a5b7a', null, 2);
  B('house', 'hs1', '', eastX - 2, top - step * 2 + 10, 138, 110, '#ad9a80', '#6a5b7a', null, 2);
  // hanging signs and lanterns line the lane
  for (let i = 0; i < 3; i++) {
    props.push({ kind: 'shopsign', x: westX + 150, y: top - step * i + 44, variant: i, color: ['#9d5f4a', '#5c6b4a', '#7a5b7a'][i] });
    props.push({ kind: 'shopsign', x: eastX - 6, y: top - step * i + 62, variant: i + 1, color: ['#4f6b7a', '#584a44', '#6a5b7a'][i] });
    props.push({ kind: 'lantern', x: laneX - 74, y: top - step * i + 108, variant: 0 });
    props.push({ kind: 'lantern', x: laneX + 74, y: top - step * i + 108, variant: 0 });
    props.push({ kind: 'crate', x: westX + 158, y: top - step * i + 128, variant: 0 });
    props.push({ kind: 'barrel', x: eastX - 16, y: top - step * i + 132, variant: 1 });
  }
  props.push({ kind: 'laundry', x: westX + 150, y: top - step - 20, x2: eastX, y2: top - step - 6, variant: 0 });
  props.push({ kind: 'cart', x: laneX - 40, y: top - step * 2 - 60, variant: 0 });

  // ------------------------------------------------------------- the guild
  B('guild', 'guild', 'Adventurers Guild', cx - 620, cy - 150, 200, 160, '#9d8156', '#8c4a3f', 'quest board', 2);
  // training yard beside it
  const yardX = cx - 690, yardY = cy + 120;
  const yardW = 300, yardH = 210;
  for (let i = 0; i * 40 < yardW; i++) {
    props.push({ kind: 'fence', x: yardX + i * 40, y: yardY, x2: yardX + (i + 1) * 40, y2: yardY, variant: 0 });
    props.push({ kind: 'fence', x: yardX + i * 40, y: yardY + yardH, x2: yardX + (i + 1) * 40, y2: yardY + yardH, variant: 0 });
  }
  for (let i = 0; i * 42 < yardH; i++) {
    props.push({ kind: 'fence', x: yardX, y: yardY + i * 42, x2: yardX, y2: yardY + (i + 1) * 42, variant: 1 });
    props.push({ kind: 'fence', x: yardX + yardW, y: yardY + i * 42, x2: yardX + yardW, y2: yardY + (i + 1) * 42, variant: 1 });
  }
  props.push({ kind: 'dummy', x: yardX + 70, y: yardY + 76, variant: 0 });
  props.push({ kind: 'dummy', x: yardX + 158, y: yardY + 128, variant: 1 });
  props.push({ kind: 'dummy', x: yardX + 44, y: yardY + 166, variant: 2 });
  props.push({ kind: 'rack', x: yardX + 232, y: yardY + 54, variant: 0 });
  props.push({ kind: 'haybale', x: yardX + 236, y: yardY + 164, variant: 0 });
  props.push({ kind: 'signpost', x: yardX + 150, y: yardY - 8, variant: 0 });
  // guild colours hang on the hall itself, not behind it
  props.push({ kind: 'banner', x: cx - 606, y: cy - 46, variant: 0, color: '#8c4a3f' });
  props.push({ kind: 'banner', x: cx - 452, y: cy - 46, variant: 0, color: '#8c4a3f' });

  // --------------------------------------------------------------- the inn
  B('inn', 'inn', 'The Gilded Sow', cx + 380, cy - 80, 210, 170, '#a98a63', '#7a4a3f', 'rest & rumours', 2);
  props.push({ kind: 'bench', x: cx + 402, y: cy + 108, variant: 0 });
  props.push({ kind: 'bench', x: cx + 520, y: cy + 108, variant: 0 });
  props.push({ kind: 'lantern', x: cx + 372, y: cy + 96, variant: 0 });
  props.push({ kind: 'lantern', x: cx + 596, y: cy + 96, variant: 0 });
  props.push({ kind: 'barrel', x: cx + 604, y: cy + 40, variant: 0 });
  props.push({ kind: 'barrel', x: cx + 618, y: cy + 66, variant: 1 });
  props.push({ kind: 'crate', x: cx + 356, y: cy + 40, variant: 0 });

  // --------------------------------------------------------- your homestead
  B('home', 'home', 'Your Homestead', cx - 560, cy + 340, 168, 138, '#9a8560', '#6a7d4a', 'homestead & chest', 1);
  props.push({ kind: 'pot', x: cx - 566, y: cy + 484, variant: 0 });
  props.push({ kind: 'laundry', x: cx - 400, y: cy + 400, x2: cx - 300, y2: cy + 430, variant: 0 });

  // ------------------------------------------------------ plain houses
  B('house', 'h1', '', cx + 150, cy + 250, 118, 100, '#ad9a80', '#6a5b7a', null, 1);
  B('house', 'h2', '', cx + 300, cy + 300, 108, 96, '#a3917a', '#5f7a6a', null, 2);
  B('house', 'h3', '', cx - 180, cy - 640, 112, 98, '#b0a086', '#7a6a4a', null, 1);
  B('house', 'h4', '', cx + 60, cy - 640, 124, 104, '#a89578', '#6a4a5a', null, 2);
  if (rich) {
    B('house', 'h5', '', cx + 620, cy + 320, 116, 100, '#b3a186', '#5a6b7a', null, 2);
    B('house', 'h6', '', cx - 290, cy + 470, 110, 96, '#ab9880', '#7a5b4a', null, 1);
  }

  // ------------------------------------------------------------- the gate
  const gateY = cy + 690;
  const gateX = cx;
  B('gate', 'gate', 'City Gate', gateX - 46, gateY - 40, 92, 96, '#8e8375', '#4a443c', 'set out', 1);

  // A ditch outside the wall, and one wooden bridge across it.
  const moatY = gateY + 74;
  const moatH = 86;
  props.push({ kind: 'moat', x: 0, y: moatY, w: W * TS, h: moatH, variant: 0 });
  props.push({ kind: 'bridge', x: gateX - 62, y: moatY - 16, w: 124, h: moatH + 32, variant: 0 });
  for (let i = 0; i < 7; i++) {
    props.push({
      kind: 'lilypad', variant: i % 3,
      x: gateX + (i - 3) * 190 + (i % 2 ? 60 : -40), y: moatY + 22 + (i % 3) * 18,
    });
  }
  props.push({ kind: 'lantern', x: gateX - 74, y: moatY + moatH + 22, variant: 1 });
  props.push({ kind: 'lantern', x: gateX + 74, y: moatY + moatH + 22, variant: 1 });

  // the town wall, all the way round: no edge of Ashford is invisible
  const wallL = TS * 2, wallR = W * TS - TS * 2, wallT = TS * 2, wallB = gateY + 28;
  const wallRun = (x1: number, y1: number, x2: number, y2: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 74));
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n;
      props.push({
        kind: 'fence', variant: 2,
        x: x1 + (x2 - x1) * a, y: y1 + (y2 - y1) * a, x2: x1 + (x2 - x1) * b, y2: y1 + (y2 - y1) * b,
      });
    }
  };
  wallRun(gateX + 46, wallB, wallR, wallB);
  wallRun(gateX - 46, wallB, wallL, wallB);
  wallRun(wallL, wallT, wallR, wallT);
  wallRun(wallL, wallT, wallL, wallB);
  wallRun(wallR, wallT, wallR, wallB);
  for (const [tx, ty] of [[wallL, wallT], [wallR, wallT], [wallL, wallB], [wallR, wallB]] as [number, number][]) {
    props.push({ kind: 'tower', x: tx, y: ty, variant: 0 });
  }
  // past the moat the road runs south between hedges, and that is the way out
  for (let x = TS; x < W * TS; x += 58) {
    if (Math.abs(x - gateX) < 100) continue;
    props.push({ kind: 'hedge', x, y: moatY + moatH + 50, variant: Math.floor(x / 58) % 3 });
  }
  props.push({ kind: 'banner', x: gateX - 62, y: gateY - 50, variant: 1, color: '#4a5f8a' });
  props.push({ kind: 'banner', x: gateX + 50, y: gateY - 50, variant: 1, color: '#4a5f8a' });
  // in front of the wall, where they light the way in
  props.push({ kind: 'lantern', x: gateX - 122, y: gateY + 50, variant: 1 });
  props.push({ kind: 'lantern', x: gateX + 122, y: gateY + 50, variant: 1 });

  // ------------------------------------------------------------ the square
  // the Hero, in stone, where the well used to be
  props.push({ kind: 'statue', x: cx, y: cy + 10, variant: 0 });
  const stallCount = rich ? 5 : 2;
  const stallHues = ['#b8524e', '#4f7fa8', '#6a9a52', '#a8894f', '#8a5fa8'];
  for (let i = 0; i < stallCount; i++) {
    // spread round the ring, skipping the mouth of the main road
    const a = -Math.PI * 0.86 + (i / Math.max(1, stallCount - 1)) * Math.PI * 1.72;
    props.push({
      kind: 'stall', variant: i,
      x: cx + Math.cos(a) * 215, y: cy + Math.sin(a) * 158 + 26,
      color: stallHues[i % stallHues.length],
    });
  }
  for (let i = 0; i < (rich ? 8 : 3); i++) {
    const a = r.float(0, Math.PI * 2);
    props.push({
      kind: 'flowerbed', variant: r.int(0, 3),
      x: cx + Math.cos(a) * r.float(120, 300), y: cy + Math.sin(a) * r.float(90, 220),
    });
  }
  props.push({ kind: 'bench', x: cx - 130, y: cy + 90, variant: 0 });
  props.push({ kind: 'bench', x: cx + 96, y: cy - 84, variant: 1 });
  props.push({ kind: 'signpost', x: cx + 30, y: cy + 190, variant: 0 });

  // ------------------------------------------------------- roads and lamps
  const road = (x1: number, y1: number, x2: number, y2: number, w = 62) =>
    roads.push({ x1, y1, x2, y2, w });
  road(gateX, moatY + moatH + 40, cx, cy, 78);    // bridge to square
  road(cx, cy, cx, top - step * 2 - 90, 96);      // the lane, running north
  road(cx, cy, cx + 470, cy + 40, 56);            // to the inn
  road(cx, cy, cx - 470, cy - 40, 56);            // to the guild
  road(cx - 300, cy + 40, cx - 500, cy + 350, 48); // to home

  for (let i = 0; i < 6; i++) {
    props.push({ kind: 'lantern', x: cx - 62, y: cy + 130 + i * 96, variant: 0 });
    props.push({ kind: 'lantern', x: cx + 62, y: cy + 178 + i * 96, variant: 0 });
  }

  // ------------------------------------------------------ trees and greenery
  const treeSpots: [number, number][] = [
    [cx - 760, cy - 420], [cx - 700, cy + 640], [cx + 700, cy - 420], [cx + 760, cy + 560],
    [cx - 90, cy + 360], [cx + 210, cy - 200], [cx - 250, cy + 200], [cx + 640, cy - 300],
    [cx - 420, cy - 560], [cx + 380, cy + 560], [cx + 120, cy + 480], [cx - 640, cy + 120],
  ];
  for (const [x, y] of treeSpots) props.push({ kind: 'tree', x, y, variant: r.int(0, 2) });
  for (let i = 0; i < (rich ? 26 : 14); i++) {
    props.push({
      kind: 'bush', variant: r.int(0, 2),
      x: r.float(TS * 3, W * TS - TS * 3), y: r.float(TS * 3, H * TS - TS * 3),
    });
  }
  for (let i = 0; i < 6; i++) {
    props.push({ kind: 'sapling', variant: r.int(0, 1), x: cx + r.float(-500, 500), y: cy + r.float(-500, 500) });
  }

  // ----------------------------------------------------------------- people
  const addNpc = (kind: NpcKind, x: number, y: number, radius: number, fixed = false) => {
    npcs.push({
      id: kind + npcs.length,
      kind,
      name: nameFor(kind, r),
      x, y, hx: x, hy: y, homeR: radius,
      t: r.float(0, 4),
      facing: Math.PI / 2,
      walkT: r.float(0, 6),
      speed: kind === 'kid' ? 74 : kind === 'elder' ? 20 : kind === 'cat' ? 30 : 34,
      appearance: rollAppearance(r),
      lines: linesFor(kind, r),
      fixed,
    });
  };

  addNpc('guard', gateX - 92, gateY + 66, 0, true);
  addNpc('guard', gateX + 92, gateY + 66, 0, true);
  addNpc('elder', cx - 122, cy + 96, 26);
  for (let i = 0; i < stallCount; i++) {
    const p = props.filter((x) => x.kind === 'stall')[i];
    if (p) addNpc('merchant', p.x, p.y + 34, 22);
  }
  const folkCount = rich ? 7 : 3;
  for (let i = 0; i < folkCount; i++) {
    addNpc('folk', cx + r.float(-380, 380), cy + r.float(-300, 300), 130);
  }
  const kidCount = rich ? 4 : 2;
  for (let i = 0; i < kidCount; i++) {
    addNpc('kid', cx + r.float(-220, 220), cy + r.float(-160, 200), 170);
  }
  addNpc('cat', cx + r.float(-200, 200), cy + r.float(-160, 160), 90);
  if (rich) addNpc('elder', cx + 104, cy - 78, 24);

  // ------------------------------------------------------------- colliders
  const colliders: Rect[] = [];
  for (const b of buildings) {
    if (b.id === 'gate') {
      // the arch is walkable; the two piers are not
      colliders.push({ x: b.x - 34, y: b.y + b.d * 0.45, w: 36, h: b.d * 0.55 });
      colliders.push({ x: b.x + b.w - 2, y: b.y + b.d * 0.45, w: 36, h: b.d * 0.55 });
      continue;
    }
    colliders.push({ x: b.x + 4, y: b.y + b.d * 0.35, w: b.w - 8, h: b.d * 0.65 });
  }
  for (const p of props) {
    if (p.kind === 'fence' && p.variant === 2 && p.x2 !== undefined && p.y2 !== undefined) {
      const x0 = Math.min(p.x, p.x2), x1 = Math.max(p.x, p.x2);
      const y0 = Math.min(p.y, p.y2), y1 = Math.max(p.y, p.y2);
      if (x1 - x0 >= y1 - y0) colliders.push({ x: x0, y: p.y - 10, w: x1 - x0, h: 30 });
      else colliders.push({ x: p.x - 16, y: y0, w: 32, h: y1 - y0 });
    }
    if (p.kind === 'well') colliders.push({ x: p.x - 26, y: p.y - 14, w: 52, h: 28 });
    if (p.kind === 'statue') colliders.push({ x: p.x - 32, y: p.y - 22, w: 64, h: 34 });
    if (p.kind === 'tower') colliders.push({ x: p.x - 34, y: p.y - 34, w: 68, h: 68 });
    if (p.kind === 'moat' && p.w && p.h) {
      const bridge = props.find((b) => b.kind === 'bridge');
      const bx = bridge?.x ?? 0, bw = bridge?.w ?? 0;
      colliders.push({ x: p.x, y: p.y, w: Math.max(0, bx - p.x), h: p.h });
      colliders.push({ x: bx + bw, y: p.y, w: Math.max(0, p.x + p.w - bx - bw), h: p.h });
    }
    if (p.kind === 'tree') colliders.push({ x: p.x - 10, y: p.y - 8, w: 20, h: 16 });
  }
  // the hedges south of the moat leave only the road
  colliders.push({ x: 0, y: moatY + moatH + 24, w: gateX - 66, h: 200 });
  colliders.push({ x: gateX + 66, y: moatY + moatH + 24, w: W * TS - gateX - 66, h: 200 });

  const motes: Mote[] = [];
  for (let i = 0; i < 60; i++) {
    motes.push({
      x: r.float(0, W * TS), y: r.float(0, H * TS),
      vx: r.float(-9, 9), vy: r.float(-14, -4),
      t: r.float(0, 6), life: r.float(4, 9), s: r.float(1.2, 2.6),
    });
  }

  const spots: Spot[] = [
    { id: 'statue', x: cx, y: cy + 56, label: 'Statue of Edric Harrow', prompt: 'read the plaque', r: 56 },
    { id: 'road', x: gateX, y: moatY + moatH + 96, label: 'The Road South', prompt: 'set out', r: 64 },
  ];

  const yard = [
    { id: 'herbs', x: cx - 596, y: cy + 524 },
    { id: 'orchard', x: cx - 456, y: cy + 524 },
    { id: 'vein', x: cx - 596, y: cy + 616 },
    { id: 'font', x: cx - 456, y: cy + 616 },
  ];

  return {
    w: W, h: H, tiles, buildings, props, npcs, colliders, motes, roads, yard, spots,
    px: gateX, py: gateY + 96,
    facing: -Math.PI / 2, walkT: 0, time: 0,
    gateX, gateY: gateY + 40,
  };
}

// ------------------------------------------------------------- interaction

export function nearestInteract(t: Town): Interact {
  let best: Interact = null;
  let bd = 999999;
  for (const b of t.buildings) {
    if (!b.prompt) continue;
    const d = Math.hypot(t.px - (b.x + b.w / 2), t.py - (b.y + b.d + 16));
    if (d < 86 && d < bd) { bd = d; best = { kind: 'building', b }; }
  }
  for (const n of t.npcs) {
    const d = Math.hypot(t.px - n.x, t.py - n.y);
    if (d < 72 && d < bd) { bd = d; best = { kind: 'npc', n }; }
  }
  for (const s of t.spots ?? []) {
    const d = Math.hypot(t.px - s.x, t.py - s.y);
    if (d < (s.r ?? 70) && d < bd) { bd = d; best = { kind: 'spot', s }; }
  }
  return best;
}

function blocked(t: Town, x: number, y: number): boolean {
  for (const c of t.colliders) {
    if (x > c.x - 8 && x < c.x + c.w + 8 && y > c.y - 4 && y < c.y + c.h + 4) return true;
  }
  return false;
}

export function tickTown(t: Town, dt: number, mx: number, my: number, speed: number): void {
  t.time += dt;
  const len = Math.hypot(mx, my);
  if (len > 0.01) {
    const nx = mx / len, ny = my / len;
    // resolve one axis at a time so you slide along walls instead of sticking
    const tryX = t.px + nx * speed * dt;
    if (!blocked(t, tryX, t.py)) t.px = Math.max(40, Math.min(t.w * TS - 40, tryX));
    const tryY = t.py + ny * speed * dt;
    if (!blocked(t, t.px, tryY)) t.py = Math.max(40, Math.min(t.h * TS - 40, tryY));
    t.facing = Math.atan2(ny, nx);
    t.walkT += dt;
  }

  for (const n of t.npcs) {
    if (n.fixed) {
      n.facing = Math.PI / 2;
      continue;
    }
    n.t -= dt;
    if (n.t <= 0) {
      n.t = n.kind === 'kid' ? 0.8 + Math.random() * 1.6 : 2 + Math.random() * 5;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * n.homeR;
      n.hx = n.x + Math.cos(a) * r;
      n.hy = n.y + Math.sin(a) * r;
    }
    const dx = n.hx - n.x, dy = n.hy - n.y;
    const d = Math.hypot(dx, dy);
    if (d > 5) {
      const stepX = n.x + (dx / d) * n.speed * dt;
      const stepY = n.y + (dy / d) * n.speed * dt;
      if (!blocked(t, stepX, n.y)) n.x = stepX;
      if (!blocked(t, n.x, stepY)) n.y = stepY;
      n.facing = Math.atan2(dy, dx);
      n.walkT += dt;
    }
  }

  for (const m of t.motes) {
    m.t += dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.t > m.life) {
      m.t = 0;
      m.x = Math.random() * t.w * TS;
      m.y = Math.random() * t.h * TS;
    }
  }
}

// ------------------------------------------------------------------ drawing

function lanternGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255, 214, 140, ' + a + ')');
  g.addColorStop(1, 'rgba(255, 200, 120, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawProp(ctx: CanvasRenderingContext2D, p: Prop, t: number, rich: boolean): void {
  const x = p.x, y = p.y;
  switch (p.kind) {
    case 'tree': {
      shadow(ctx, x, y, 22, 0.26);
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 5, y - 34, 10, 34);
      const greens = rich ? ['#4d7c3c', '#568a42', '#3f6b34'] : ['#5f6b3a', '#6a7340', '#4f5a30'];
      ctx.fillStyle = greens[p.variant % 3];
      ctx.beginPath();
      ctx.arc(x, y - 52, 26, 0, Math.PI * 2);
      ctx.arc(x - 18, y - 40, 18, 0, Math.PI * 2);
      ctx.arc(x + 18, y - 40, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.arc(x - 9, y - 62, 12, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'sapling':
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x - 2, y - 16, 4, 16);
      ctx.fillStyle = rich ? '#5f9a48' : '#6a7340';
      ctx.beginPath(); ctx.arc(x, y - 22, 10, 0, Math.PI * 2); ctx.fill();
      break;
    case 'bush':
      ctx.fillStyle = rich ? '#4f8040' : '#5c6a3c';
      ctx.beginPath();
      ctx.arc(x, y - 7, 11, 0, Math.PI * 2);
      ctx.arc(x - 8, y - 3, 8, 0, Math.PI * 2);
      ctx.arc(x + 8, y - 3, 8, 0, Math.PI * 2);
      ctx.fill();
      if (rich && p.variant === 1) {
        ctx.fillStyle = '#e8879c';
        ctx.beginPath(); ctx.arc(x - 4, y - 12, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 6, y - 9, 2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'flowerbed': {
      ctx.fillStyle = '#5a4632';
      ctx.beginPath(); ctx.ellipse(x, y, 20, 11, 0, 0, Math.PI * 2); ctx.fill();
      const cols = ['#e0607a', '#e8c15a', '#8f7fe0', '#e88f5a'];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + p.variant;
        ctx.fillStyle = cols[(i + p.variant) % cols.length];
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 12, y + Math.sin(a) * 6 - 3, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'crops':
      ctx.fillStyle = '#5a4632';
      ctx.fillRect(x - 18, y - 6, 36, 14);
      ctx.fillStyle = ['#7fae52', '#9ab85f', '#c8a24b'][p.variant % 3];
      for (let i = 0; i < 5; i++) {
        const h = 12 + Math.sin(t * 1.4 + i + x * 0.01) * 2;
        ctx.fillRect(x - 15 + i * 7, y - h, 3, h);
      }
      break;
    case 'lantern': {
      const post = p.variant === 1 ? 40 : 32;
      shadow(ctx, x, y, 7, 0.22);
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(x - 2.5, y - post, 5, post);
      ctx.fillStyle = '#33302b';
      ctx.fillRect(x - 8, y - post - 12, 16, 13);
      const flicker = 0.72 + Math.sin(t * 3 + x) * 0.07;
      ctx.fillStyle = 'rgba(255,214,140,' + flicker + ')';
      ctx.fillRect(x - 5.5, y - post - 10, 11, 9);
      break;
    }
    case 'statue': {
      shadow(ctx, x, y, 30, 0.3);
      ctx.fillStyle = '#8f877c';
      roundRect(ctx, x - 28, y - 26, 56, 26, 4); ctx.fill();
      ctx.fillStyle = '#a39b8f';
      ctx.fillRect(x - 32, y - 30, 64, 6);
      ctx.fillStyle = 'rgba(40,30,20,0.35)';
      ctx.fillRect(x - 12, y - 18, 24, 8);
      const stone = '#b8b0a4', deep = '#958d82';
      ctx.fillStyle = deep;
      roundRect(ctx, x - 8, y - 56, 7, 26, 3); ctx.fill();
      roundRect(ctx, x + 1, y - 56, 7, 26, 3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 12, y - 90); ctx.lineTo(x - 19, y - 36); ctx.lineTo(x - 7, y - 42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = stone;
      roundRect(ctx, x - 12, y - 94, 24, 44, 6); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 102, 9, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(x + 10, y - 88); ctx.rotate(-2.1);
      roundRect(ctx, 0, -3, 22, 6, 3); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = deep; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 21, y - 108); ctx.lineTo(x + 21, y - 114); ctx.stroke();
      ctx.save();
      ctx.shadowColor = '#ffd27a'; ctx.shadowBlur = 16; ctx.fillStyle = '#ffe0a0';
      roundRect(ctx, x + 15, y - 127, 12, 13, 3); ctx.fill();
      ctx.restore();
      ctx.fillStyle = deep;
      ctx.fillRect(x - 17, y - 72, 3, 38);
      break;
    }
    case 'hedge': {
      shadow(ctx, x, y, 26, 0.22);
      ctx.fillStyle = rich ? '#4a7a3c' : '#56663a';
      ctx.beginPath();
      ctx.arc(x - 16, y - 12, 13, 0, Math.PI * 2);
      ctx.arc(x, y - 17, 15, 0, Math.PI * 2);
      ctx.arc(x + 16, y - 12, 13, 0, Math.PI * 2);
      ctx.rect(x - 28, y - 14, 56, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.arc(x - 4, y - 24, 7, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'well':
      shadow(ctx, x, y, 28, 0.28);
      ctx.fillStyle = '#8a8378';
      ctx.beginPath(); ctx.ellipse(x, y, 27, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a6b7a';
      ctx.beginPath(); ctx.ellipse(x, y - 2, 19, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.14 + Math.sin(t * 1.7) * 0.05) + ')';
      ctx.beginPath(); ctx.ellipse(x - 4, y - 4, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 24, y - 44, 5, 44);
      ctx.fillRect(x + 19, y - 44, 5, 44);
      ctx.fillStyle = '#8c4a3f';
      ctx.beginPath();
      ctx.moveTo(x - 32, y - 44); ctx.lineTo(x, y - 62); ctx.lineTo(x + 32, y - 44);
      ctx.closePath(); ctx.fill();
      break;
    case 'stall': {
      shadow(ctx, x, y, 30, 0.24);
      ctx.fillStyle = '#7a5a3a';
      ctx.fillRect(x - 34, y - 22, 68, 22);
      ctx.fillStyle = '#8f6a44';
      ctx.fillRect(x - 34, y - 26, 68, 6);
      // awning
      const c = p.color ?? '#b8524e';
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? c : '#efe3cf';
        ctx.fillRect(x - 36 + i * 12, y - 62, 12, 18);
      }
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 34, y - 62, 4, 40);
      ctx.fillRect(x + 30, y - 62, 4, 40);
      // goods
      const goods = ['#d05a4a', '#e0b64f', '#7fae52', '#a86fd0'];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = goods[(i + p.variant) % goods.length];
        ctx.beginPath(); ctx.arc(x - 22 + i * 15, y - 28, 5, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'bench':
      shadow(ctx, x, y, 18, 0.2);
      ctx.fillStyle = '#7a5a3a';
      ctx.fillRect(x - 22, y - 12, 44, 7);
      ctx.fillRect(x - 22, y - 24, 44, 5);
      ctx.fillStyle = '#5f4630';
      ctx.fillRect(x - 20, y - 5, 4, 6);
      ctx.fillRect(x + 16, y - 5, 4, 6);
      break;
    case 'barrel':
      shadow(ctx, x, y, 11, 0.22);
      ctx.fillStyle = '#8a6440';
      roundRect(ctx, x - 11, y - 24, 22, 24, 5); ctx.fill();
      ctx.fillStyle = '#5f4630';
      ctx.fillRect(x - 11, y - 18, 22, 3);
      ctx.fillRect(x - 11, y - 9, 22, 3);
      break;
    case 'crate':
      shadow(ctx, x, y, 12, 0.22);
      ctx.fillStyle = '#9a7a4e';
      ctx.fillRect(x - 12, y - 22, 24, 22);
      ctx.strokeStyle = '#6b512f'; ctx.lineWidth = 2;
      ctx.strokeRect(x - 12, y - 22, 24, 22);
      ctx.beginPath(); ctx.moveTo(x - 12, y - 22); ctx.lineTo(x + 12, y); ctx.stroke();
      break;
    case 'haybale':
      shadow(ctx, x, y, 16, 0.22);
      ctx.fillStyle = '#c8a24b';
      roundRect(ctx, x - 17, y - 24, 34, 24, 7); ctx.fill();
      ctx.strokeStyle = '#9a7a30'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 6, y - 24); ctx.lineTo(x - 6, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 6, y - 24); ctx.lineTo(x + 6, y); ctx.stroke();
      break;
    case 'pot':
      shadow(ctx, x, y, 9, 0.2);
      ctx.fillStyle = '#a8603f';
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 14); ctx.lineTo(x + 9, y - 14); ctx.lineTo(x + 6, y); ctx.lineTo(x - 6, y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5f9a48';
      ctx.beginPath(); ctx.arc(x, y - 20, 8, 0, Math.PI * 2); ctx.fill();
      break;
    case 'dummy':
      shadow(ctx, x, y, 13, 0.24);
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 3, y - 26, 6, 26);
      ctx.fillStyle = '#c8a875';
      roundRect(ctx, x - 13, y - 54, 26, 30, 8); ctx.fill();
      ctx.fillStyle = '#8a6a44';
      ctx.fillRect(x - 20, y - 46, 40, 6);
      ctx.beginPath(); ctx.arc(x, y - 60, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7a3a34'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 40, 7, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'rack':
      shadow(ctx, x, y, 16, 0.2);
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 22, y - 8, 44, 6);
      ctx.fillRect(x - 22, y - 40, 44, 5);
      ctx.fillRect(x - 22, y - 40, 4, 38);
      ctx.fillRect(x + 18, y - 40, 4, 38);
      ctx.strokeStyle = '#c9ccd6'; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 14 + i * 14, y - 38);
        ctx.lineTo(x - 14 + i * 14, y - 8);
        ctx.stroke();
      }
      break;
    case 'signpost':
      shadow(ctx, x, y, 8, 0.2);
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 3, y - 42, 6, 42);
      ctx.fillStyle = '#8a6a44';
      ctx.fillRect(x - 26, y - 42, 26, 11);
      ctx.fillRect(x + 2, y - 28, 26, 11);
      break;
    case 'cart':
      shadow(ctx, x, y, 24, 0.22);
      ctx.fillStyle = '#8a6440';
      ctx.fillRect(x - 26, y - 26, 52, 18);
      ctx.fillStyle = '#4a3a2a';
      ctx.beginPath(); ctx.arc(x - 16, y - 6, 9, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 16, y - 6, 9, 0, Math.PI * 2); ctx.fill();
      break;
    case 'banner': {
      const c = p.color ?? '#8c4a3f';
      ctx.fillStyle = c;
      const sway = Math.sin(t * 1.3 + x * 0.02) * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 20, y + sway);
      ctx.lineTo(x + 20 + sway * 0.3, y + 56);
      ctx.lineTo(x + 10, y + 48);
      ctx.lineTo(x, y + 56);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(c, 40);
      ctx.fillRect(x + 6, y + 16, 8, 8);
      break;
    }
    case 'fence': {
      if (p.x2 === undefined || p.y2 === undefined) break;
      if (p.variant === 2) {
        // city wall
        const x0 = Math.min(p.x, p.x2), x1 = Math.max(p.x, p.x2);
        ctx.fillStyle = '#8e8375';
        ctx.fillRect(x0, p.y - 46, x1 - x0, 46);
        ctx.fillStyle = '#6f6558';
        ctx.fillRect(x0, p.y - 12, x1 - x0, 12);
        ctx.fillStyle = '#9d9284';
        for (let bx = x0; bx < x1 - 8; bx += 26) ctx.fillRect(bx, p.y - 56, 16, 12);
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        for (let by = p.y - 40; by < p.y; by += 11) {
          ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#8a6a44';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 14); ctx.lineTo(p.x2, p.y2 - 14);
        ctx.moveTo(p.x, p.y - 24); ctx.lineTo(p.x2, p.y2 - 24);
        ctx.stroke();
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(p.x - 2, p.y - 30, 4, 30);
      }
      break;
    }
    case 'moat': {
      const w = p.w ?? 0, h = p.h ?? 0;
      ctx.fillStyle = '#3f5f6b';
      ctx.fillRect(x, y, w, h);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(20,36,44,0.75)');
      g.addColorStop(0.35, 'rgba(90,150,160,0.25)');
      g.addColorStop(1, 'rgba(20,36,44,0.65)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      // banks
      ctx.fillStyle = '#7a6a4f';
      ctx.fillRect(x, y - 8, w, 10);
      ctx.fillRect(x, y + h - 2, w, 10);
      // ripples
      ctx.strokeStyle = 'rgba(210,240,245,0.22)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 26; i++) {
        const rx = x + ((i * 173) % w);
        const ry = y + 14 + ((i * 61) % (h - 28));
        const ph = Math.sin(t * 1.6 + i) * 6;
        ctx.beginPath();
        ctx.moveTo(rx - 9 + ph, ry);
        ctx.quadraticCurveTo(rx + ph, ry - 3, rx + 9 + ph, ry);
        ctx.stroke();
      }
      break;
    }
    case 'lilypad':
      ctx.fillStyle = ['#4a7a4a', '#568a52', '#3f6b42'][p.variant % 3];
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(t * 0.7 + x * 0.01) * 3, y, 11, 7, 0, 0.4, Math.PI * 2 + 0.1);
      ctx.fill();
      if (p.variant === 1) {
        ctx.fillStyle = '#e8b6d0';
        ctx.beginPath(); ctx.arc(x + 2, y - 3, 3, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'bridge': {
      const w = p.w ?? 0, h = p.h ?? 0;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + 5, y + 8, w, h);
      ctx.fillStyle = '#8a6440';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#7a5636';
      for (let py = y + 4; py < y + h - 3; py += 13) ctx.fillRect(x + 3, py, w - 6, 9);
      // rails
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(x - 6, y, 7, h);
      ctx.fillRect(x + w - 1, y, 7, h);
      for (let py = y; py < y + h; py += 30) {
        ctx.fillRect(x - 8, py, 11, 7);
        ctx.fillRect(x + w - 3, py, 11, 7);
      }
      break;
    }
    case 'shopsign': {
      const c = p.color ?? '#8c4a3f';
      ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(x, y - 46); ctx.lineTo(x, y - 30); ctx.stroke();
      const sway = Math.sin(t * 1.2 + x * 0.02) * 0.06;
      ctx.save();
      ctx.translate(x, y - 30);
      ctx.rotate(sway);
      ctx.fillStyle = c;
      roundRect(ctx, -16, 0, 32, 22, 4); ctx.fill();
      ctx.strokeStyle = '#e8d9b8'; ctx.lineWidth = 1.6;
      roundRect(ctx, -13, 3, 26, 16, 3); ctx.stroke();
      ctx.fillStyle = '#e8d9b8';
      ctx.beginPath(); ctx.arc(0, 11, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
    }
    case 'laundry': {
      if (p.x2 === undefined || p.y2 === undefined) break;
      ctx.strokeStyle = 'rgba(60,50,40,0.7)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 52); ctx.lineTo(p.x2, p.y2 - 52);
      ctx.stroke();
      const cols = ['#e8e0d0', '#a8c4e0', '#e0b6c8', '#d8d2a8'];
      for (let i = 1; i <= 4; i++) {
        const f = i / 5;
        const lx = p.x + (p.x2 - p.x) * f;
        const ly = p.y + (p.y2 - p.y) * f - 52;
        const sway = Math.sin(t * 1.6 + i) * 2.5;
        ctx.fillStyle = cols[i % cols.length];
        ctx.beginPath();
        ctx.moveTo(lx - 9, ly);
        ctx.lineTo(lx + 9, ly);
        ctx.lineTo(lx + 7 + sway, ly + 22);
        ctx.lineTo(lx - 7 + sway, ly + 22);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
}

/** A townhouse seen from a high angle: roof plane on top, front wall below. */
function house(ctx: CanvasRenderingContext2D, b: Building, t: number, warmth: number): void {
  const roofH = b.d * 0.6;
  const wallH = b.d - roofH;

  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  roundRect(ctx, b.x + 8, b.y + 10, b.w, b.d, 6);
  ctx.fill();

  // front wall
  ctx.fillStyle = b.color;
  ctx.fillRect(b.x + 5, b.y + roofH, b.w - 10, wallH);
  // timber framing, the whole storybook-village thing
  ctx.strokeStyle = 'rgba(70,52,38,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(b.x + 5, b.y + roofH + 3); ctx.lineTo(b.x + b.w - 5, b.y + roofH + 3);
  const bays = Math.max(2, Math.round(b.w / 46));
  for (let i = 1; i < bays; i++) {
    const bx = b.x + 5 + ((b.w - 10) / bays) * i;
    ctx.moveTo(bx, b.y + roofH + 3); ctx.lineTo(bx, b.y + b.d - 2);
  }
  ctx.stroke();
  ctx.fillStyle = shade(b.color, -34);
  ctx.fillRect(b.x + 5, b.y + b.d - 6, b.w - 10, 6);

  // door
  const dw = 24, dx = b.x + b.w / 2 - dw / 2;
  const dTop = b.y + roofH + wallH * 0.16;
  ctx.fillStyle = '#3a2b21';
  roundRect(ctx, dx, dTop, dw, wallH * 0.84, 8);
  ctx.fill();
  ctx.fillStyle = '#c8a24b';
  ctx.beginPath(); ctx.arc(dx + dw - 6, dTop + wallH * 0.45, 2, 0, Math.PI * 2); ctx.fill();

  // windows, warm when it is getting dark
  const winY = b.y + roofH + wallH * 0.26;
  const lit = 'rgba(255,' + Math.round(214 - warmth * 20) + ',' + Math.round(150 - warmth * 40) + ',' + (0.55 + warmth * 0.45) + ')';
  for (const wx of [b.x + 16, b.x + b.w - 30]) {
    ctx.fillStyle = b.warm ? lit : '#4a4a52';
    roundRect(ctx, wx, winY, 14, 14, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(60,44,32,0.7)'; ctx.lineWidth = 1.6;
    roundRect(ctx, wx, winY, 14, 14, 3); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wx + 7, winY); ctx.lineTo(wx + 7, winY + 14);
    ctx.moveTo(wx, winY + 7); ctx.lineTo(wx + 14, winY + 7);
    ctx.stroke();
  }
  // upper storey windows sit on the roof plane, cheating a little
  if (b.storeys > 1) {
    for (const wx of [b.x + b.w * 0.28 - 7, b.x + b.w * 0.72 - 7]) {
      ctx.fillStyle = b.warm ? lit : '#4a4a52';
      roundRect(ctx, wx, b.y + roofH - 26, 14, 14, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(50,36,26,0.8)'; ctx.lineWidth = 1.6;
      roundRect(ctx, wx, b.y + roofH - 26, 14, 14, 3); ctx.stroke();
    }
  }

  // roof
  ctx.fillStyle = b.roof;
  roundRect(ctx, b.x - 6, b.y - 8, b.w + 12, roofH + 6, 5);
  ctx.fill();
  ctx.fillStyle = shade(b.roof, -26);
  ctx.fillRect(b.x - 6, b.y + roofH - 6, b.w + 12, 8);
  ctx.strokeStyle = 'rgba(0,0,0,0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = b.y - 2; y < b.y + roofH - 8; y += 8) {
    ctx.moveTo(b.x - 6, y); ctx.lineTo(b.x + b.w + 6, y);
  }
  ctx.stroke();
  ctx.fillStyle = shade(b.roof, 30);
  ctx.fillRect(b.x - 6, b.y - 8, b.w + 12, 5);

  // chimney and smoke
  const chX = b.x + b.w * 0.76;
  ctx.fillStyle = shade(b.color, -30);
  ctx.fillRect(chX, b.y - 24, 15, 22);
  ctx.fillStyle = shade(b.color, -50);
  ctx.fillRect(chX - 2, b.y - 27, 19, 5);
  for (let i = 0; i < 3; i++) {
    const pt = (t * 0.42 + i * 0.33) % 1;
    ctx.fillStyle = 'rgba(226,220,210,' + (0.30 * (1 - pt)) + ')';
    ctx.beginPath();
    ctx.arc(chX + 7 + Math.sin(pt * 6 + i) * 9, b.y - 30 - pt * 58, 5 + pt * 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

function gateHouse(ctx: CanvasRenderingContext2D, b: Building, t: number): void {
  const pierW = 46, pierH = 130;
  const y0 = b.y - 34;
  for (const px of [b.x - 34, b.x + b.w - 12]) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundRect(ctx, px + 7, y0 + pierH - 6, pierW, 28, 4); ctx.fill();
    ctx.fillStyle = '#9d9284';
    ctx.fillRect(px, y0, pierW, pierH);
    ctx.fillStyle = '#8e8375';
    ctx.fillRect(px, y0 + pierH - 22, pierW, 22);
    ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = y0 + 8; y < y0 + pierH; y += 13) { ctx.moveTo(px, y); ctx.lineTo(px + pierW, y); }
    ctx.stroke();
    ctx.fillStyle = '#b0a598';
    for (let i = 0; i < 3; i++) ctx.fillRect(px + 3 + i * 16, y0 - 12, 11, 13);
  }
  // arch
  ctx.fillStyle = '#2b2622';
  ctx.beginPath();
  ctx.moveTo(b.x + 12, y0 + pierH);
  ctx.lineTo(b.x + 12, y0 + 52);
  ctx.quadraticCurveTo(b.x + b.w / 2, y0 + 2, b.x + b.w - 12, y0 + 52);
  ctx.lineTo(b.x + b.w - 12, y0 + pierH);
  ctx.closePath();
  ctx.fill();
  // portcullis, raised
  ctx.strokeStyle = '#5f5750'; ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const gx = b.x + 18 + i * 14;
    ctx.beginPath(); ctx.moveTo(gx, y0 + 12); ctx.lineTo(gx, y0 + 38); ctx.stroke();
  }
  // lintel and banner
  ctx.fillStyle = '#8e8375';
  ctx.fillRect(b.x - 40, y0 - 22, b.w + 80, 22);
  ctx.fillStyle = '#4a5f8a';
  const sway = Math.sin(t * 1.1) * 2;
  ctx.beginPath();
  ctx.moveTo(b.x + b.w / 2 - 16, y0 - 2);
  ctx.lineTo(b.x + b.w / 2 + 16, y0 - 2);
  ctx.lineTo(b.x + b.w / 2 + 14 + sway, y0 + 40);
  ctx.lineTo(b.x + b.w / 2, y0 + 32);
  ctx.lineTo(b.x + b.w / 2 - 14 + sway, y0 + 40);
  ctx.closePath();
  ctx.fill();
}

export function drawTownNpc(ctx: CanvasRenderingContext2D, n: TownNPC, near: boolean): void {
  const a = n.appearance;
  if (n.kind === 'cat') {
    shadow(ctx, n.x, n.y, 8, 0.2);
    const bob = Math.sin(n.walkT * 8) * 1.2;
    ctx.fillStyle = '#4a4038';
    roundRect(ctx, n.x - 10, n.y - 12 + bob, 20, 10, 5); ctx.fill();
    ctx.beginPath(); ctx.arc(n.x + 8, n.y - 15 + bob, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(n.x + 5, n.y - 19 + bob); ctx.lineTo(n.x + 7, n.y - 24 + bob); ctx.lineTo(n.x + 9, n.y - 19 + bob);
    ctx.moveTo(n.x + 10, n.y - 19 + bob); ctx.lineTo(n.x + 12, n.y - 24 + bob); ctx.lineTo(n.x + 13, n.y - 19 + bob);
    ctx.fill();
    ctx.strokeStyle = '#4a4038'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(n.x - 10, n.y - 10 + bob);
    ctx.quadraticCurveTo(n.x - 20, n.y - 18 + bob, n.x - 16, n.y - 26 + bob);
    ctx.stroke();
    ctx.fillStyle = '#e8d05a';
    ctx.fillRect(n.x + 9, n.y - 16 + bob, 1.6, 1.6);
    if (near) prompt(ctx, n.x, n.y - 36, n.name);
    return;
  }

  const scale = n.kind === 'kid' ? 0.72 : n.kind === 'elder' ? 0.9 : 1;
  const H = 40 * a.height * scale;
  const bob = Math.sin(n.walkT * 11) * 1.8;
  shadow(ctx, n.x, n.y, 10 * scale, 0.24);
  ctx.save();
  ctx.translate(n.x, n.y - bob);
  const look = n.look ?? {};
  if (look.cape) {
    ctx.fillStyle = look.cape;
    ctx.beginPath();
    ctx.moveTo(-8 * scale, -H + 12); ctx.lineTo(8 * scale, -H + 12);
    ctx.lineTo(11 * scale, -2); ctx.lineTo(-11 * scale, -2);
    ctx.closePath(); ctx.fill();
  }

  ctx.fillStyle = shade(a.cloth, -46);
  ctx.fillRect(-5 * scale, -13 * scale, 4 * scale, 13 * scale);
  ctx.fillRect(1 * scale, -13 * scale, 4 * scale, 13 * scale);

  ctx.fillStyle = n.kind === 'guard' ? '#5f6b82' : a.cloth;
  roundRect(ctx, -7.5 * scale, -H + 10, 15 * scale, H - 22, 4);
  ctx.fill();
  ctx.fillStyle = n.kind === 'guard' ? '#c9ccd6' : a.accent;
  ctx.fillRect(-7.5 * scale, -H + 19, 15 * scale, 3);

  ctx.fillStyle = a.skin;
  ctx.beginPath(); ctx.arc(0, -H + 3, 8.4 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = n.kind === 'elder' ? '#ded8cc' : a.hair;
  ctx.beginPath(); ctx.arc(0, -H + 1.5, 8.7 * scale, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#20242c';
  ctx.fillRect(-3.4 * scale, -H + 3, 1.8, 2.2);
  ctx.fillRect(1.8 * scale, -H + 3, 1.8, 2.2);

  if (look.ears) {
    ctx.fillStyle = a.skin;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 7 * scale, -H + 1); ctx.lineTo(s * 16 * scale, -H - 6); ctx.lineTo(s * 7.5 * scale, -H + 6);
      ctx.closePath(); ctx.fill();
    }
  }
  if (look.beard) {
    ctx.fillStyle = look.beard;
    ctx.beginPath(); ctx.ellipse(0, -H + 8.5, 6.5 * scale, 5.5 * scale, 0, 0, Math.PI); ctx.fill();
  }
  if (look.patch) {
    ctx.fillStyle = '#1a1714';
    ctx.fillRect(-4.6 * scale, -H + 2.2, 3.8, 3.2);
    ctx.strokeStyle = '#1a1714'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-8.4 * scale, -H); ctx.lineTo(8.4 * scale, -H + 4); ctx.stroke();
  }
  if (look.staff) {
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(11 * scale, -H - 10); ctx.lineTo(10 * scale, 0); ctx.stroke();
    ctx.fillStyle = '#9be0d2';
    ctx.beginPath(); ctx.arc(11 * scale, -H - 12, 3, 0, Math.PI * 2); ctx.fill();
  }
  if (look.sword) {
    ctx.fillStyle = '#c9ccd6';
    ctx.fillRect(-12 * scale, -H + 18, 2.4, 20);
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(-13.5 * scale, -H + 16, 5, 3);
  }
  if (n.kind === 'guard') {
    ctx.fillStyle = '#aeb6c4';
    ctx.beginPath(); ctx.arc(0, -H + 2, 9.4 * scale, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(-9.4 * scale, -H + 2, 18.8 * scale, 3);
    // spear
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(11 * scale, -H - 12, 3, H + 12);
    ctx.fillStyle = '#c9ccd6';
    ctx.beginPath();
    ctx.moveTo(12.5 * scale, -H - 26); ctx.lineTo(16 * scale, -H - 10); ctx.lineTo(9 * scale, -H - 10);
    ctx.closePath(); ctx.fill();
  }
  if (n.kind === 'elder') {
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(10, -H + 16); ctx.lineTo(12, 0); ctx.stroke();
  }
  ctx.restore();

  if (near) prompt(ctx, n.x, n.y - H - 22, n.name);
}

function prompt(ctx: CanvasRenderingContext2D, x: number, y: number, label: string): void {
  ctx.font = '700 12px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  const w = ctx.measureText(label).width + 34;
  ctx.fillStyle = 'rgba(20,17,14,0.82)';
  roundRect(ctx, x - w / 2, y - 15, w, 20, 6);
  ctx.fill();
  ctx.fillStyle = '#ffe28a';
  ctx.fillText('[E] ' + label, x, y - 1);
}

const PLOT_TINT: Record<string, { bed: string; crop: string; accent: string }> = {
  herb: { bed: '#57452f', crop: '#7fae52', accent: '#c8e08a' },
  wood: { bed: '#4f3f2c', crop: '#4d7c3c', accent: '#8a6440' },
  ore: { bed: '#4a4642', crop: '#95999f', accent: '#c9cdd6' },
  gemdust: { bed: '#3f3a48', crop: '#57d4d0', accent: '#9be0d2' },
};

/**
 * The homestead you can actually look at. Rows multiply with the plot level,
 * a hired hand shows up for every wage you pay, and uncollected harvest piles
 * in a basket until somebody carries it in.
 */
export function drawPlot(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  plot: { id: string; resource: string; owned: boolean; level: number; workers: number; pending: number },
  t: number,
): void {
  const W = 116, H = 68;
  const tint = PLOT_TINT[plot.resource] ?? PLOT_TINT.herb;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(ctx, x + 4, y + 5, W, H, 6);
  ctx.fill();

  if (!plot.owned) {
    ctx.fillStyle = '#6a6250';
    roundRect(ctx, x, y, W, H, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2;
    roundRect(ctx, x + 3, y + 3, W - 6, H - 6, 5); ctx.stroke();
    // for sale stake
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(x + W / 2 - 2, y + 6, 4, 26);
    ctx.fillStyle = '#c8b69a';
    roundRect(ctx, x + W / 2 - 22, y - 8, 44, 16, 3); ctx.fill();
    ctx.fillStyle = '#5a4a38';
    ctx.font = '700 9px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('FOR SALE', x + W / 2, y + 3);
    ctx.restore();
    return;
  }

  // tilled bed
  ctx.fillStyle = tint.bed;
  roundRect(ctx, x, y, W, H, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, W, H, 6); ctx.stroke();

  // one furrow per level, capped so it stays readable
  const rows = Math.min(5, plot.level);
  const rowH = (H - 12) / rows;
  for (let r = 0; r < rows; r++) {
    const ry = y + 6 + r * rowH + rowH / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x + 6, ry - rowH / 2 + 1, W - 12, rowH - 2);
    const per = 4 + Math.min(4, plot.level);
    for (let i = 0; i < per; i++) {
      const cxp = x + 12 + (i * (W - 24)) / (per - 1);
      const grow = 0.7 + 0.3 * Math.sin(t * 1.1 + i + r);
      if (plot.resource === 'ore' || plot.resource === 'gemdust') {
        ctx.fillStyle = tint.crop;
        if (plot.resource === 'gemdust') { ctx.shadowColor = tint.accent; ctx.shadowBlur = 8; }
        ctx.beginPath();
        ctx.moveTo(cxp, ry - 7 * grow);
        ctx.lineTo(cxp + 4, ry);
        ctx.lineTo(cxp - 4, ry);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
      } else if (plot.resource === 'wood') {
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(cxp - 1.4, ry - 8 * grow, 2.8, 8 * grow);
        ctx.fillStyle = tint.crop;
        ctx.beginPath(); ctx.arc(cxp, ry - 10 * grow, 5 * grow, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = tint.crop;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cxp, ry);
        ctx.lineTo(cxp + Math.sin(t * 1.6 + i) * 2, ry - 9 * grow);
        ctx.stroke();
        ctx.fillStyle = tint.accent;
        ctx.beginPath(); ctx.arc(cxp + Math.sin(t * 1.6 + i) * 2, ry - 10 * grow, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // a hired hand for every wage
  for (let i = 0; i < Math.min(6, plot.workers); i++) {
    const a = t * 0.5 + i * 2.1;
    const wx = x + 14 + ((i * 37) % (W - 28)) + Math.sin(a) * 9;
    const wy = y + H + 12 + Math.cos(a * 0.8) * 5;
    shadow(ctx, wx, wy, 7, 0.2);
    const bob = Math.abs(Math.sin(a * 3)) * 2;
    ctx.fillStyle = ['#7a6a52', '#6a7d4a', '#7a5b4a', '#5f7f6f'][i % 4];
    roundRect(ctx, wx - 4.5, wy - 17 - bob, 9, 13, 3); ctx.fill();
    ctx.fillStyle = '#e0b98f';
    ctx.beginPath(); ctx.arc(wx, wy - 20 - bob, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8a24b';
    ctx.beginPath(); ctx.arc(wx, wy - 21 - bob, 6, Math.PI, Math.PI * 2); ctx.fill();
  }

  // the pile waiting to be carried in
  const pend = Math.floor(plot.pending ?? 0);
  if (pend > 0) {
    const bx = x + W - 12, by = y - 6;
    shadow(ctx, bx, by + 8, 12, 0.24);
    ctx.fillStyle = '#8a6440';
    roundRect(ctx, bx - 12, by - 8, 24, 16, 4); ctx.fill();
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 1.6;
    roundRect(ctx, bx - 12, by - 8, 24, 16, 4); ctx.stroke();
    const heap = Math.min(7, 1 + Math.floor(Math.log2(pend + 1)));
    ctx.fillStyle = tint.crop;
    for (let i = 0; i < heap; i++) {
      ctx.beginPath();
      ctx.arc(bx - 8 + (i % 4) * 5, by - 10 - Math.floor(i / 4) * 4, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const bounce = Math.abs(Math.sin(t * 3)) * 4;
    ctx.fillStyle = '#ffe28a';
    ctx.font = '800 15px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('!', bx, by - 26 - bounce);
    ctx.font = '700 10px ui-sans-serif, system-ui';
    ctx.fillStyle = '#e8dcc0';
    ctx.fillText(String(pend), bx, by + 20);
  }
  ctx.restore();
}

export function drawTown(
  ctx: CanvasRenderingContext2D, t: Town, st: GameState, near: Interact,
): void {
  const v: Village = st.village;
  const rich = v.preset === 'thriving';
  const tint = rich ? 10 : -18;
  drawGround(ctx, t.w, t.h, t.tiles, rich ? '#6f9250' : '#6b7a4c', rich ? '#7d9d58' : '#77855a', tint);

  // ------------------------------------------------------------- cobbles
  ctx.save();
  ctx.lineCap = 'round';
  for (const r of t.roads) {
    ctx.strokeStyle = 'rgba(146,124,92,0.72)';
    ctx.lineWidth = r.w;
    ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,100,74,0.5)';
    ctx.lineWidth = r.w - 10;
    ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke();
  }
  // the square itself
  const cx = (t.w * TS) / 2, cy = (t.h * TS) / 2;
  ctx.fillStyle = 'rgba(146,124,92,0.72)';
  ctx.beginPath(); ctx.ellipse(cx, cy, 250, 190, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(90,74,54,0.13)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 52);
    ctx.lineTo(cx + Math.cos(a) * 248, cy + Math.sin(a) * 188);
    ctx.stroke();
  }
  for (const rr of [110, 160, 210]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.76, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();

  // ------------------------------------------------------- depth-sorted pass
  type R = { d: number; f: () => void };
  const list: R[] = [];

  for (const p of t.props) {
    // water and the deck over it are ground, not scenery: they go under everything
    const d = p.kind === 'moat' ? -99999
      : p.kind === 'bridge' ? -99998
        : p.kind === 'lilypad' ? -99997
          : p.kind === 'fence' && p.variant === 2 ? p.y + 1
            : p.y;
    list.push({ d, f: () => drawProp(ctx, p, t.time, rich) });
  }
  for (const b of t.buildings) {
    list.push({
      d: b.y + b.d,
      f: () => {
        if (b.id === 'gate') gateHouse(ctx, b, t.time);
        else house(ctx, b, t.time, 0.35);
        if (!b.name) return;
        const sx = b.x + b.w / 2;
        const isNear = near?.kind === 'building' && near.b.key === b.key;
        ctx.font = '600 12.5px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(b.name).width;
        ctx.fillStyle = 'rgba(24,20,16,0.72)';
        roundRect(ctx, sx - tw / 2 - 8, b.y - 46, tw + 16, 19, 6);
        ctx.fill();
        ctx.fillStyle = isNear ? '#ffe28a' : '#eee6d6';
        ctx.fillText(b.name, sx, b.y - 32);
        if (isNear && b.prompt) prompt(ctx, sx, b.y + b.d + 30, b.prompt);
      },
    });
  }
  for (const spot of t.yard) {
    const plot = st.homestead.plots.find((pp) => pp.id === spot.id);
    if (!plot) continue;
    list.push({ d: spot.y + 30, f: () => drawPlot(ctx, spot.x, spot.y, plot, t.time) });
  }
  for (const n of t.npcs) {
    const isNear = near?.kind === 'npc' && near.n.id === n.id;
    list.push({ d: n.y, f: () => drawTownNpc(ctx, n, isNear) });
  }
  list.push({
    d: t.py,
    f: () => drawHero(ctx, t.px, t.py, st.hero.appearance, t.facing, t.walkT,
      { gear: gearLook(st.equipped) }),
  });

  list.sort((a, b) => a.d - b.d);
  for (const r of list) r.f();

  // -------------------------------------------------------------- warm light
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of t.props) {
    if (p.kind !== 'lantern') continue;
    const post = p.variant === 1 ? 40 : 32;
    const flick = 1 + Math.sin(t.time * 3.1 + p.x) * 0.06;
    lanternGlow(ctx, p.x, p.y - post - 6, 86 * flick, 0.16);
  }
  for (const b of t.buildings) {
    if (!b.warm) continue;
    lanternGlow(ctx, b.x + b.w / 2, b.y + b.d * 0.78, 92, 0.06);
  }
  ctx.restore();

  // ------------------------------------------------------------------ motes
  ctx.save();
  for (const m of t.motes) {
    const k = Math.sin((m.t / m.life) * Math.PI);
    ctx.globalAlpha = 0.34 * k;
    ctx.fillStyle = '#fff2c8';
    ctx.beginPath();
    ctx.arc(m.x, m.y - 40, m.s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Screen-space pass: the golden-hour wash that makes the place feel like home. */
export function drawTownAmbience(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, 'rgba(255, 206, 128, 0.55)');
  g.addColorStop(1, 'rgba(120, 140, 200, 0.30)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.save();
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(24, 16, 10, 0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
