import type { ZoneDef } from './content';
import type { Item, SkillKey } from './types';
import { SKILL_COLOR, SKILL_NAMES } from './types';
import { Terrain, groundAt, isPit, isWater } from './terrain';

// ------------------------------------------------------------------- shapes

export interface Mob {
  uid: string;
  defId: string;
  x: number; y: number;
  hp: number; maxHp: number;
  cd: number;
  windup: number;
  state: 'idle' | 'chase' | 'attack' | 'dead';
  wanderT: number;
  wx: number; wy: number;
  hitFlash: number;
  facing: number;
  dead: number;
  aggroed: boolean;
  kbx: number; kby: number;
  stun: number;
  lungeT: number;
  lungeX: number; lungeY: number;
  /** boss brain */
  atkIdx: number;
  atkCds: number[];
  chargeT: number;
  chargeX: number; chargeY: number;
  slowT: number;
  /** draw elevation, from the terrain under it */
  gz: number;
  /** a named brute off a bounty notice: bigger, meaner, better loot */
  elite: string | null;
  /** damage multiplier, for elites and for bigger parties */
  atkMul: number;
  /** the hero it is chasing, by id */
  target: string;
  /** guests only: where the host last put it */
  nx: number; ny: number; ngz: number;
}

export interface Node {
  uid: string;
  kind: 'tree' | 'rock';
  x: number; y: number;
  hp: number; maxHp: number;
  variant: number;
  hitFlash: number;
  shakeT: number;
  respawn: number;
  gz: number;
}

export interface Drop {
  uid: string;
  item: Item;
  x: number; y: number;
  t: number;
  vz: number;
  z: number;
  gz: number;
}

export interface Popup {
  x: number; y: number; t: number;
  text: string; color: string; vy: number;
  size: number;
  life: number;
  /** height the text floats from */
  z?: number;
}

export interface Projectile {
  x: number; y: number; vx: number; vy: number;
  life: number; dmg: number; crit: boolean; color: string;
  hostile: boolean;
  size: number;
  /** passes through targets instead of stopping */
  pierce?: boolean;
  slow?: number;
  hit?: Set<string>;
  /** hostile shots: the attacker, for the death screen */
  from?: string;
  z?: number;
}

export interface Slash {
  x: number; y: number; ang: number; t: number; range: number; arc: number;
  color?: string;
  life?: number;
  z?: number;
}

export interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  color: string; size: number;
  grav: number;
  /** the ground it lands on */
  g?: number;
}

/** The red shape on the floor that tells you where not to be. */
export interface Telegraph {
  kind: 'circle' | 'cone' | 'line';
  x: number; y: number;
  r: number;
  ang: number;
  arc: number;
  len: number;
  wide: number;
  t: number;
  total: number;
  color: string;
  z?: number;
}

/** A hit that lands later: meteors, slams, anything with a delay. */
export interface Impact {
  x: number; y: number; r: number;
  t: number;
  dmg: number;
  fromPlayer: boolean;
  color: string;
  knock: number;
  z?: number;
}

/** Still used by the old top-down drawing helpers. */
export interface Plateau { x: number; y: number; w: number; h: number; z: number }
export interface Chasm { x: number; y: number; w: number; h: number }

export type FloraKind = 'grass' | 'flower' | 'mushroom' | 'stump' | 'reed' | 'fern' | 'crystal' | 'bone';
export interface Flora { kind: FloraKind; x: number; y: number; variant: number; gz: number }

export type CritterKind = 'butterfly' | 'bird' | 'rabbit' | 'firefly';
export interface Critter {
  kind: CritterKind;
  x: number; y: number; z: number;
  vx: number; vy: number;
  t: number;
  flee: number;
  hx: number; hy: number;
}

export interface Mote { x: number; y: number; z: number; vx: number; vy: number; t: number; life: number; s: number }

/** Something lost in the zone for a recovery contract. Only its finder can see it. */
export interface Cache { uid: string; x: number; y: number; gz: number; found: boolean }

// ------------------------------------------------------------------- co-op

/** Another player standing in the same zone, as far as monsters are concerned. */
export interface RemoteHero {
  id: string;
  name: string;
  x: number; y: number;
  gz: number; jz: number;
  facing: number;
  airborne: boolean;
  iframes: number;
  downed: boolean;
  bleed: number;
  hp: number; maxHp: number;
  /** performance.now() of the last report */
  seen: number;
}

/** A blow the host's monsters landed on somebody else's hero. */
export interface HurtMsg {
  defId: string;
  scale: number;
  ignoreJump: boolean;
  /** projectile damage, already rolled; 0 for melee */
  raw: number;
  cause: string;
}

/** Effects the host's monsters make, replayed by everyone else. */
export type NetFx =
  | { k: 'burst'; x: number; y: number; z: number; n: number; c: string; s: number; sz: number }
  | { k: 'pop'; x: number; y: number; z: number; text: string; c: string; size: number; life: number }
  | { k: 'slash'; x: number; y: number; z: number; ang: number; range: number; arc: number; c: string }
  | { k: 'ring'; x: number; y: number; z: number; r: number; c: string }
  | { k: 'shake'; a: number };

/**
 * The seam between the simulation and the network. The zone never touches a
 * socket; it calls these and the party layer does the rest.
 */
export interface ZoneNet {
  role: 'host' | 'guest';
  selfId: string;
  /** guest: tell the host a blow landed */
  hitMob(uid: string, raw: number, crit: boolean, ang: number, knock: number, stun: number, slow: number): void;
  /** guest: tell the host a tree or rock took a bite */
  harvest(uid: string, bite: number): void;
  /** host: somebody else's hero got hit */
  hurt(id: string, h: HurtMsg): void;
  /** host: a monster died, and everyone nearby gets paid */
  killed(m: Mob): void;
  /** host: somebody else finished a tree or a rock */
  nodeDone(uid: string, byId: string): void;
}

export interface ZoneEvents {
  onDeath: (cause: string) => void;
  onExit: () => void;
}

// --------------------------------------------------------------------- zone

export interface Zone {
  def: ZoneDef;
  terrain: Terrain;
  /** instance id, so co-op players know they are in the same place */
  key: string;
  seed: number;
  mobs: Mob[];
  nodes: Node[];
  drops: Drop[];
  popups: Popup[];
  projectiles: Projectile[];
  slashes: Slash[];
  particles: Particle[];
  telegraphs: Telegraph[];
  impacts: Impact[];
  flora: Flora[];
  critters: Critter[];
  motes: Mote[];
  caches: Cache[];
  exitX: number; exitY: number;
  px: number; py: number;
  facing: number;
  atkCd: number;
  swingT: number;
  hurtT: number;
  time: number;
  bossSpawned: boolean;
  bossUid: string | null;
  nearExit: boolean;
  tiles: Uint8Array;
  // --- movement
  jumpZ: number;
  jumpVz: number;
  airborne: boolean;
  groundZ: number;
  safeX: number; safeY: number;
  dashLock: number;
  staminaLock: number;
  castT: number;
  castMax: number;
  dashT: number;
  dashDirX: number; dashDirY: number;
  dashCharges: number;
  dashRecharge: number;
  iframes: number;
  momentumT: number;
  dashTrail: { x: number; y: number; z: number; t: number }[];
  // --- abilities
  abilityCd: Record<string, number>;
  buffAtk: number;
  buffAtkT: number;
  shield: number;
  spinT: number;
  spinTick: number;
  // --- feel
  shake: number;
  hitstop: number;
  killGlow: number;
  // --- co-op
  /** true when this copy runs the monsters: playing alone, or hosting */
  auth: boolean;
  net: ZoneNet | null;
  remotes: RemoteHero[];
  partySize: number;
  /** co-op only: on the ground, waiting for a friend */
  downed: boolean;
  bleedT: number;
  lastCause: string;
  /** the death screen has been asked for; stop simulating this hero */
  over: boolean;
  /** host: monster effects waiting to go out with the next snapshot */
  fxOut: NetFx[];
  /** guests: hostile shots as the host last saw them */
  netProj: { x: number; y: number; z: number; color: string; size: number }[];
}

// ------------------------------------------------------------------ helpers

export function standZ(z: Zone, x: number, y: number): number {
  return groundAt(z.terrain, x, y);
}

export function inChasm(z: Zone, x: number, y: number): boolean {
  return isPit(z.terrain, x, y);
}

export function inWater(z: Zone, x: number, y: number): boolean {
  return isWater(z.terrain, x, y);
}

export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function popup(
  z: Zone, x: number, y: number, text: string, color: string, size = 13, life = 1.1, zz?: number,
): void {
  z.popups.push({ x, y, t: 0, text, color, vy: -40, size, life, z: zz });
}

export function xpPopup(z: Zone, k: SkillKey, amount: number): void {
  if (amount <= 0) return;
  z.popups.push({
    x: z.px + (Math.random() - 0.5) * 24, y: z.py - 46, t: 0,
    text: '+' + amount + ' ' + SKILL_NAMES[k], color: SKILL_COLOR[k],
    vy: -26, size: 11, life: 1.3, z: z.groundZ + 40,
  });
}

export function burst(
  z: Zone, x: number, y: number, n: number, color: string,
  opts: { speed?: number; size?: number; life?: number; up?: number; grav?: number; base?: number } = {},
): void {
  const speed = opts.speed ?? 130;
  const base = opts.base ?? 0;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    z.particles.push({
      x, y, z: base + (opts.up ?? 14), g: base,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7,
      vz: (opts.up ?? 14) > 0 ? 40 + Math.random() * 90 : 0,
      life: 0, maxLife: (opts.life ?? 0.45) * (0.7 + Math.random() * 0.6),
      color, size: (opts.size ?? 3) * (0.6 + Math.random() * 0.8),
      grav: opts.grav ?? 320,
    });
  }
}

export function shakeIt(z: Zone, amount: number): void {
  z.shake = Math.min(22, z.shake + amount);
}

export function telegraph(z: Zone, t: Omit<Telegraph, 't'>): void {
  z.telegraphs.push({ ...t, t: 0 });
}

/** Queue an effect for the other players, if this copy is the host. */
export function emit(z: Zone, fx: NetFx): void {
  if (z.net && z.net.role === 'host' && z.fxOut.length < 120) z.fxOut.push(fx);
}

/** Replay an effect the host sent. */
export function applyFx(z: Zone, fx: NetFx): void {
  switch (fx.k) {
    case 'burst':
      burst(z, fx.x, fx.y, fx.n, fx.c, { speed: fx.s, size: fx.sz, up: 14, base: fx.z });
      break;
    case 'pop':
      popup(z, fx.x, fx.y, fx.text, fx.c, fx.size, fx.life, fx.z);
      break;
    case 'slash':
      z.slashes.push({ x: fx.x, y: fx.y, ang: fx.ang, t: 0, range: fx.range, arc: fx.arc, color: fx.c, life: 0.3, z: fx.z });
      break;
    case 'ring':
      z.impacts.push({ x: fx.x, y: fx.y, r: fx.r, t: 0.02, dmg: 0, fromPlayer: false, color: fx.c, knock: 0, z: fx.z });
      break;
    case 'shake':
      shakeIt(z, fx.a);
      break;
  }
}

/** A monster's visible effect: shown here and sent to everyone else. */
export function mobBurst(z: Zone, x: number, y: number, gz: number, n: number, color: string, speed = 200, size = 3.4): void {
  burst(z, x, y, n, color, { speed, size, life: 0.5, up: 14, base: gz });
  emit(z, { k: 'burst', x, y, z: gz, n, c: color, s: speed, sz: size });
}

export function mobCallout(z: Zone, x: number, y: number, gz: number, text: string, color: string, size = 14, life = 1.2): void {
  popup(z, x, y, text, color, size, life, gz);
  emit(z, { k: 'pop', x, y, z: gz, text, c: color, size, life });
}

export function mobSlash(z: Zone, x: number, y: number, gz: number, ang: number, range: number, arc: number, color: string): void {
  z.slashes.push({ x, y, ang, t: 0, range, arc, color, life: 0.3, z: gz });
  emit(z, { k: 'slash', x, y, z: gz, ang, range, arc, c: color });
}

export function mobRing(z: Zone, x: number, y: number, gz: number, r: number, color: string): void {
  z.impacts.push({ x, y, r, t: 0.02, dmg: 0, fromPlayer: false, color, knock: 0, z: gz });
  emit(z, { k: 'ring', x, y, z: gz, r, c: color });
}
