import { RNG, rng, uid } from './rng';
import { MONSTERS, MonsterDef, ZONES, ZoneDef } from './content';
import { TS } from '../render/view';
import type { Item, SkillKey } from './types';
import { SKILL_COLOR, SKILL_NAMES } from './types';
import { makeItem, ITEM_DEFS } from './items';
import { autoPlace } from './backpack';
import { GameState, derived, grantXp, pushLog, skillLevel } from './state';
import { abilitiesFor, AbilityDef, AbilityKey } from './abilities';

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
}

export interface Slash {
  x: number; y: number; ang: number; t: number; range: number; arc: number;
  color?: string;
  life?: number;
}

export interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  color: string; size: number;
  grav: number;
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
}

/** A hit that lands later: meteors, slams, anything with a delay. */
export interface Impact {
  x: number; y: number; r: number;
  t: number;
  dmg: number;
  fromPlayer: boolean;
  color: string;
  knock: number;
}

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

export interface Zone {
  def: ZoneDef;
  mobs: Mob[];
  nodes: Node[];
  drops: Drop[];
  popups: Popup[];
  projectiles: Projectile[];
  slashes: Slash[];
  particles: Particle[];
  telegraphs: Telegraph[];
  impacts: Impact[];
  plateaus: Plateau[];
  chasms: Chasm[];
  flora: Flora[];
  critters: Critter[];
  motes: Mote[];
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
}

// ------------------------------------------------------------------ terrain

export function standZ(z: Zone, x: number, y: number): number {
  let best = 0;
  for (const p of z.plateaus) {
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h && p.z > best) best = p.z;
  }
  return best;
}

export function inChasm(z: Zone, x: number, y: number): boolean {
  for (const c of z.chasms) {
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return true;
  }
  return false;
}

function buildTerrain(z: Zone, def: ZoneDef, r: RNG): void {
  const W = def.w * TS, H = def.h * TS;
  if (def.terrain === 'rolling') {
    for (let i = 0; i < 5; i++) {
      const w = r.float(240, 460), h = r.float(200, 380);
      z.plateaus.push({
        x: r.float(TS * 2, W - w - TS * 2), y: r.float(TS * 2, H - h - TS * 3),
        w, h, z: r.pick([20, 24, 28]),
      });
    }
  } else if (def.terrain === 'broken') {
    for (let i = 0; i < 4; i++) {
      const w = r.float(220, 420), h = r.float(180, 320);
      z.plateaus.push({
        x: r.float(TS * 2, W - w - TS * 2), y: r.float(TS * 2, H - h - TS * 4),
        w, h, z: r.pick([22, 26]),
      });
    }
    for (let i = 0; i < 7; i++) {
      const w = r.float(90, 190), h = r.float(80, 150);
      const c = {
        x: r.float(TS * 3, W - w - TS * 3), y: r.float(TS * 3, H - h - TS * 5),
        w, h,
      };
      // never drop a hole on the way out of the zone
      if (Math.hypot(c.x - z.exitX, c.y - z.exitY) < 340) continue;
      z.chasms.push(c);
    }
  } else if (def.terrain === 'ridge') {
    // A stepped climb toward the summit. Each riser is short enough to vault.
    const tiers = [
      { frac: 0.74, z: 20 },
      { frac: 0.55, z: 42 },
      { frac: 0.37, z: 64 },
      { frac: 0.20, z: 86 },
      { frac: 0.06, z: 108 },
    ];
    for (const t of tiers) {
      const inset = (1 - t.frac) * 0.16 * W;
      z.plateaus.push({ x: inset, y: 0, w: W - inset * 2, h: H * t.frac, z: t.z });
    }
    // ravines cut across the lower slopes so you have to look where you land
    for (let i = 0; i < 5; i++) {
      const w = r.float(130, 230), h = r.float(70, 110);
      const c = { x: r.float(TS * 3, W - w - TS * 3), y: r.float(H * 0.58, H * 0.86), w, h };
      if (Math.hypot(c.x - z.exitX, c.y - z.exitY) < 320) continue;
      z.chasms.push(c);
    }
  }
}

// -------------------------------------------------------------------- build

export function buildZone(zoneId: string, st: GameState, bossTarget?: string): Zone {
  const def = ZONES[zoneId];
  const r = new RNG((Math.random() * 0xffffffff) >>> 0);
  const W = def.w * TS, H = def.h * TS;
  const tiles = new Uint8Array(def.w * def.h);
  for (let i = 0; i < tiles.length; i++) tiles[i] = r.chance(0.22) ? 1 : 0;

  const d = derived(st);
  const z: Zone = {
    def, mobs: [], nodes: [], drops: [], popups: [], projectiles: [], slashes: [],
    particles: [], telegraphs: [], impacts: [],
    plateaus: [], chasms: [], flora: [], critters: [], motes: [],
    exitX: W * 0.5, exitY: H * 0.94,
    px: W * 0.5, py: H * 0.86,
    facing: -Math.PI / 2, atkCd: 0, swingT: 0, hurtT: 0, time: 0,
    bossSpawned: false, bossUid: null, nearExit: false, tiles,
    jumpZ: 0, jumpVz: 0, airborne: false, groundZ: 0,
    safeX: W * 0.5, safeY: H * 0.86,
    dashLock: 0, staminaLock: 0, castT: 0, castMax: 0,
    dashT: 0, dashDirX: 0, dashDirY: 0,
    dashCharges: d.dash.charges, dashRecharge: 0,
    iframes: 0, momentumT: 0, dashTrail: [],
    abilityCd: {}, buffAtk: 0, buffAtkT: 0, shield: 0, spinT: 0, spinTick: 0,
    shake: 0, hitstop: 0, killGlow: 0,
  };

  buildTerrain(z, def, r);

  const farFromExit = (x: number, y: number, dist = 260) =>
    Math.hypot(x - z.exitX, y - z.exitY) > dist;
  const placeable = (x: number, y: number) => !inChasm(z, x, y);

  for (let i = 0; i < def.trees; i++) {
    let x = 0, y = 0, tries = 0;
    do { x = r.float(TS, W - TS); y = r.float(TS, H - TS); tries++; }
    while ((!farFromExit(x, y, 150) || !placeable(x, y)) && tries < 24);
    z.nodes.push({
      uid: uid(), kind: 'tree', x, y, hp: 34, maxHp: 34,
      variant: r.int(0, 2), hitFlash: 0, shakeT: 0, respawn: 0, gz: standZ(z, x, y),
    });
  }
  for (let i = 0; i < def.rocks; i++) {
    let x = 0, y = 0, tries = 0;
    do { x = r.float(TS, W - TS); y = r.float(TS, H - TS); tries++; }
    while ((!farFromExit(x, y, 150) || !placeable(x, y)) && tries < 24);
    z.nodes.push({
      uid: uid(), kind: 'rock', x, y, hp: 46, maxHp: 46,
      variant: r.int(0, 2), hitFlash: 0, shakeT: 0, respawn: 0, gz: standZ(z, x, y),
    });
  }

  // ------------------------------------------------------------- undergrowth
  const floraKinds: FloraKind[] =
    def.id === 'barrows' ? ['bone', 'crystal', 'mushroom', 'grass']
      : def.id === 'fen' ? ['reed', 'mushroom', 'grass', 'fern']
        : def.id === 'ridge' ? ['crystal', 'stump', 'grass', 'bone']
          : def.id === 'woods' ? ['fern', 'mushroom', 'grass', 'stump', 'flower']
            : ['grass', 'flower', 'fern', 'stump'];
  for (let i = 0; i < def.flora; i++) {
    const x = r.float(8, W - 8), y = r.float(8, H - 8);
    if (inChasm(z, x, y)) continue;
    z.flora.push({ kind: r.pick(floraKinds), x, y, variant: r.int(0, 3), gz: standZ(z, x, y) });
  }

  // ---------------------------------------------------------------- critters
  const critterKind: CritterKind =
    def.ambience === 'fireflies' ? 'firefly'
      : def.id === 'woods' ? 'rabbit' : 'butterfly';
  for (let i = 0; i < def.critters; i++) {
    const x = r.float(TS * 2, W - TS * 2), y = r.float(TS * 2, H - TS * 2);
    z.critters.push({
      kind: i % 4 === 3 ? 'bird' : critterKind,
      x, y, z: 0, vx: 0, vy: 0, t: r.float(0, 5), flee: 0, hx: x, hy: y,
    });
  }

  for (let i = 0; i < 90; i++) {
    z.motes.push({
      x: r.float(0, W), y: r.float(0, H), z: r.float(6, 70),
      vx: r.float(-14, 14), vy: r.float(-10, 10),
      t: r.float(0, 8), life: r.float(5, 11), s: r.float(1.2, 2.8),
    });
  }

  for (let i = 0; i < def.density; i++) spawnMob(z, r, pickSpawn(r, def));

  if (bossTarget && MONSTERS[bossTarget]) {
    const m = spawnMob(z, r, bossTarget);
    if (def.terrain === 'ridge') { m.x = W * 0.5; m.y = H * 0.1; }
    else { m.x = W * 0.5 + r.float(-200, 200); m.y = H * 0.16; }
    m.gz = standZ(z, m.x, m.y);
    z.bossSpawned = true;
    z.bossUid = m.uid;
  }
  return z;
}

function pickSpawn(r: RNG, def: ZoneDef): string {
  let roll = r.next();
  for (const [id, w] of def.spawns) { roll -= w; if (roll <= 0) return id; }
  return def.spawns[0][0];
}

function spawnMob(z: Zone, r: RNG, defId: string, atX?: number, atY?: number): Mob {
  const d = MONSTERS[defId];
  const W = z.def.w * TS, H = z.def.h * TS;
  let x = atX ?? 0, y = atY ?? 0;
  if (atX === undefined) {
    let tries = 0;
    do {
      x = r.float(TS * 2, W - TS * 2);
      y = r.float(TS * 2, H - TS * 2);
      tries++;
    } while ((Math.hypot(x - z.exitX, y - z.exitY) < 320 || inChasm(z, x, y)) && tries < 30);
  }
  const m: Mob = {
    uid: uid(), defId, x, y, hp: d.hp, maxHp: d.hp, cd: r.float(0, 1),
    windup: 0, state: 'idle', wanderT: r.float(0, 3), wx: x, wy: y,
    hitFlash: 0, facing: r.float(0, Math.PI * 2), dead: 0, aggroed: false,
    kbx: 0, kby: 0, stun: 0, lungeT: 0, lungeX: 0, lungeY: 0,
    atkIdx: -1, atkCds: (d.attacks ?? []).map(() => r.float(0, 2)),
    chargeT: 0, chargeX: 0, chargeY: 0, slowT: 0, gz: standZ(z, x, y),
  };
  z.mobs.push(m);
  return m;
}

// ------------------------------------------------------------------- effects

export function popup(
  z: Zone, x: number, y: number, text: string, color: string, size = 13, life = 1.1,
): void {
  z.popups.push({ x, y, t: 0, text, color, vy: -40, size, life });
}

export function xpPopup(z: Zone, k: SkillKey, amount: number): void {
  if (amount <= 0) return;
  z.popups.push({
    x: z.px + (Math.random() - 0.5) * 24, y: z.py - 46, t: 0,
    text: '+' + amount + ' ' + SKILL_NAMES[k], color: SKILL_COLOR[k],
    vy: -26, size: 11, life: 1.3,
  });
}

export function burst(
  z: Zone, x: number, y: number, n: number, color: string,
  opts: { speed?: number; size?: number; life?: number; up?: number; grav?: number } = {},
): void {
  const speed = opts.speed ?? 130;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    z.particles.push({
      x, y, z: opts.up ?? 14,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7,
      vz: (opts.up ?? 14) > 0 ? 40 + Math.random() * 90 : 0,
      life: 0, maxLife: (opts.life ?? 0.45) * (0.7 + Math.random() * 0.6),
      color, size: (opts.size ?? 3) * (0.6 + Math.random() * 0.8),
      grav: opts.grav ?? 320,
    });
  }
}

function shakeIt(z: Zone, amount: number): void {
  z.shake = Math.min(22, z.shake + amount);
}

function telegraph(z: Zone, t: Omit<Telegraph, 't'>): void {
  z.telegraphs.push({ ...t, t: 0 });
}

// -------------------------------------------------------------------- combat

export interface ZoneEvents {
  onDeath: (cause: string) => void;
  onExit: () => void;
}

function famMult(md: MonsterDef, d: ReturnType<typeof derived>): number {
  return md.family === 'beast' ? d.beastMult : d.slayMult;
}

function playerAtk(z: Zone, d: ReturnType<typeof derived>): number {
  return d.atk * (1 + (z.buffAtkT > 0 ? z.buffAtk : 0));
}

const TOOL_REACH = 52;

function nodeInFront(z: Zone, arc: number): Node | null {
  let best: Node | null = null;
  let bd = Infinity;
  for (const n of z.nodes) {
    if (n.respawn > 0) continue;
    const dist = Math.hypot(n.x - z.px, n.y - z.py);
    if (dist > TOOL_REACH) continue;
    if (Math.abs(angDiff(Math.atan2(n.y - z.py, n.x - z.px), z.facing)) > arc) continue;
    if (dist < bd) { bd = dist; best = n; }
  }
  return best;
}

function harvestSwing(z: Zone, st: GameState, n: Node): void {
  const d = derived(st);
  const isTree = n.kind === 'tree';
  const power = isTree ? d.chopPower : d.minePower;
  const skillMult = isTree ? d.chopMult : d.mineMult;
  const bite = (power > 0 ? 9 * power : 2.2) * skillMult;
  n.hp -= bite;
  n.hitFlash = 0.1;
  n.shakeT = 0.18;
  z.swingT = 0.22;
  z.hitstop = Math.max(z.hitstop, 0.02);
  shakeIt(z, power > 0 ? 1.8 : 0.8);
  burst(z, n.x, n.y - 18, power > 0 ? 6 : 2, isTree ? '#6b4a2a' : '#9a9ea6',
    { speed: 90, size: 2.6, life: 0.4, up: 16 });
  if (power <= 0 && z.time % 3 < 0.05) {
    popup(z, z.px, z.py - 56, 'you need a tool for this', '#e0a25a', 11, 1.2);
  }
  const key: SkillKey = isTree ? 'woodcutting' : 'mining';
  if (grantXp(st, key, 4)) levelBurst(z, key);
  xpPopup(z, key, 4);
  if (n.hp <= 0) harvestNode(z, st, n);
}

export function playerAttack(z: Zone, st: GameState): void {
  if (z.atkCd > 0 || z.dashT > 0 || z.castT > 0) return;
  const d = derived(st);
  const arc = d.attackStyle === 'thrust' ? 0.55 : 1.35;

  const node = nodeInFront(z, 1.5);
  if (node) {
    z.atkCd = 0.42;
    harvestSwing(z, st, node);
    return;
  }

  z.atkCd = 1 / Math.max(0.25, d.attackSpeed);

  if (d.attackStyle === 'bolt') {
    if (st.mana < d.boltCost) {
      popup(z, z.px, z.py - 30, 'out of mana', '#7fa8e0', 12, 0.8);
      z.atkCd = 0.3;
      return;
    }
    z.castT = d.castTime;
    z.castMax = d.castTime;
    return;
  }

  z.swingT = 0.2;
  z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: d.range, arc });
  meleeHit(z, st, d, arc, d.range, playerAtk(z, d), z.airborne && d.jump.pounce ? 1.6 : 1, 190);
}

function meleeHit(
  z: Zone, st: GameState, d: ReturnType<typeof derived>,
  arc: number, range: number, base: number, mult: number, knock: number,
): number {
  let hits = 0;
  for (const m of z.mobs) {
    if (m.state === 'dead') continue;
    const dx = m.x - z.px, dy = m.y - z.py;
    const dist = Math.hypot(dx, dy);
    const md = MONSTERS[m.defId];
    if (dist > range + md.size) continue;
    if (arc < Math.PI && Math.abs(angDiff(Math.atan2(dy, dx), z.facing)) > arc) continue;
    const crit = Math.random() < d.crit;
    const dmg = base * famMult(md, d) * mult * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
    damageMob(z, st, m, dmg, crit, Math.atan2(dy, dx), knock);
    if (mult > 1.5) m.stun = Math.max(m.stun, 0.5);
    hits++;
  }
  if (hits > 0) {
    if (grantXp(st, 'blade', 3)) levelBurst(z, 'blade');
    xpPopup(z, 'blade', 3);
  }
  return hits;
}

function releaseBolt(z: Zone, st: GameState): void {
  const d = derived(st);
  if (st.mana < d.boltCost) return;
  st.mana -= d.boltCost;
  const crit = Math.random() < d.crit;
  const dmg = d.spellPower * (1 + (z.buffAtkT > 0 ? z.buffAtk : 0)) * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
  const SPEED = 330;
  z.projectiles.push({
    x: z.px, y: z.py - 18,
    vx: Math.cos(z.facing) * SPEED, vy: Math.sin(z.facing) * SPEED,
    life: d.range / SPEED + 0.05, dmg, crit, color: '#9d7bff',
    hostile: false, size: 7,
  });
  burst(z, z.px + Math.cos(z.facing) * 18, z.py + Math.sin(z.facing) * 18, 7, '#9d7bff',
    { speed: 70, size: 2.5, life: 0.3, up: 18 });
  shakeIt(z, 1.4);
  if (grantXp(st, 'sorcery', 4)) levelBurst(z, 'sorcery');
  xpPopup(z, 'sorcery', 4);
}

export function levelBurst(z: Zone, k: SkillKey): void {
  burst(z, z.px, z.py - 20, 26, SKILL_COLOR[k], { speed: 150, size: 3.4, life: 0.8, up: 20, grav: 120 });
  popup(z, z.px, z.py - 62, SKILL_NAMES[k].toUpperCase() + ' UP', SKILL_COLOR[k], 17, 1.6);
  shakeIt(z, 3);
}

// ----------------------------------------------------------------- abilities

export function abilityReady(z: Zone, st: GameState, a: AbilityDef): boolean {
  if ((z.abilityCd[a.id] ?? 0) > 0) return false;
  const have = a.resource === 'mana' ? st.mana : st.stamina;
  return have >= a.cost;
}

export function castAbility(
  z: Zone, st: GameState, key: AbilityKey, aimX: number, aimY: number,
): boolean {
  const a = abilitiesFor(st.hero.classId).find((x) => x.key === key);
  if (!a) return false;
  if (z.dashT > 0 || z.spinT > 0) return false;
  if ((z.abilityCd[a.id] ?? 0) > 0) {
    popup(z, z.px, z.py - 54, a.name + ' not ready', '#8fa8c0', 11, 0.6);
    return false;
  }
  const have = a.resource === 'mana' ? st.mana : st.stamina;
  if (have < a.cost) {
    popup(z, z.px, z.py - 54, 'not enough ' + a.resource, '#8fa8c0', 11, 0.7);
    return false;
  }
  const d = derived(st);
  if (a.resource === 'mana') st.mana -= a.cost;
  else { st.stamina -= a.cost; z.staminaLock = Math.max(z.staminaLock, 0.5); }
  z.abilityCd[a.id] = a.cd;
  z.castT = 0;

  switch (a.id) {
    // --------------------------------------------------------- warrior
    case 'cleave': {
      z.swingT = 0.26;
      z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: d.range * 1.7, arc: 1.15, color: '#e0956a', life: 0.3 });
      meleeHit(z, st, d, 1.15, d.range * 1.7, playerAtk(z, d), 1.6, 320);
      burst(z, z.px + Math.cos(z.facing) * 40, z.py + Math.sin(z.facing) * 40, 16, '#e0956a',
        { speed: 220, size: 3.2, life: 0.4, up: 18 });
      shakeIt(z, 5);
      break;
    }
    case 'bash': {
      const dx = Math.cos(z.facing), dy = Math.sin(z.facing);
      z.dashT = 0.16;
      z.dashDirX = dx; z.dashDirY = dy;
      z.iframes = Math.max(z.iframes, 0.16);
      z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: 70, arc: 0.7, color: '#c8b06a', life: 0.28 });
      // resolve after the shove so it connects at the far end
      z.impacts.push({
        x: z.px + dx * 66, y: z.py + dy * 66, r: 62, t: 0.14,
        dmg: playerAtk(z, d) * 1.2, fromPlayer: true, color: '#c8b06a', knock: 420,
      });
      shakeIt(z, 6);
      break;
    }
    case 'rally': {
      st.hp = Math.min(d.maxHp, st.hp + d.maxHp * 0.2);
      z.buffAtk = 0.35;
      z.buffAtkT = 6;
      popup(z, z.px, z.py - 56, 'RALLY', '#7fc27a', 18, 1.4);
      burst(z, z.px, z.py - 16, 30, '#7fc27a', { speed: 160, size: 3.4, life: 0.9, up: 20, grav: 90 });
      shakeIt(z, 4);
      break;
    }
    case 'whirlwind': {
      z.spinT = 1.5;
      z.spinTick = 0;
      popup(z, z.px, z.py - 56, 'WHIRLWIND', '#e06a5a', 18, 1.4);
      shakeIt(z, 7);
      break;
    }

    // ---------------------------------------------------------- wizard
    case 'lance': {
      const SPEED = 620;
      z.projectiles.push({
        x: z.px, y: z.py - 18,
        vx: Math.cos(z.facing) * SPEED, vy: Math.sin(z.facing) * SPEED,
        life: 0.75, dmg: d.spellPower * 1.5 * (1 + (z.buffAtkT > 0 ? z.buffAtk : 0)),
        crit: false, color: '#7fc2e0', hostile: false, size: 9,
        pierce: true, slow: 2.5, hit: new Set<string>(),
      });
      burst(z, z.px, z.py - 18, 12, '#7fc2e0', { speed: 90, size: 2.6, life: 0.35, up: 18 });
      shakeIt(z, 3);
      break;
    }
    case 'nova': {
      z.impacts.push({
        x: z.px, y: z.py, r: 118, t: 0.05,
        dmg: d.spellPower * 1.3, fromPlayer: true, color: '#b48fe8', knock: 380,
      });
      telegraph(z, { kind: 'circle', x: z.px, y: z.py, r: 118, ang: 0, arc: 0, len: 0, wide: 0, total: 0.16, color: '#b48fe8' });
      burst(z, z.px, z.py - 14, 40, '#b48fe8', { speed: 320, size: 3.4, life: 0.5, up: 16, grav: 120 });
      shakeIt(z, 7);
      break;
    }
    case 'font': {
      st.mana = Math.min(d.maxMana, st.mana + d.maxMana * 0.45);
      z.shield = Math.max(z.shield, d.maxHp * 0.25);
      popup(z, z.px, z.py - 56, 'WARDED', '#7fa8e0', 17, 1.4);
      burst(z, z.px, z.py - 16, 26, '#7fa8e0', { speed: 130, size: 3, life: 0.9, up: 22, grav: 60 });
      break;
    }
    case 'meteor': {
      const tx = aimX, ty = aimY;
      telegraph(z, { kind: 'circle', x: tx, y: ty, r: 130, ang: 0, arc: 0, len: 0, wide: 0, total: 1.15, color: '#e0803f' });
      z.impacts.push({
        x: tx, y: ty, r: 130, t: 1.15,
        dmg: d.spellPower * 3.2, fromPlayer: true, color: '#e0803f', knock: 300,
      });
      popup(z, z.px, z.py - 56, 'METEOR', '#e0803f', 18, 1.4);
      break;
    }
    default: break;
  }

  const trainer: SkillKey = st.hero.classId === 'warrior' ? 'blade' : 'sorcery';
  if (grantXp(st, trainer, 10)) levelBurst(z, trainer);
  xpPopup(z, trainer, 10);
  return true;
}

// ------------------------------------------------------------------- damage

function harvestNode(z: Zone, st: GameState, n: Node): void {
  const table = n.kind === 'tree' ? z.def.treeLoot : z.def.rockLoot;
  const d = derived(st);
  let roll = Math.random() / Math.max(0.3, d.luckMult);
  let picked = table[0][0];
  for (const [id, w] of table) { roll -= w; if (roll <= 0) { picked = id; break; } }
  const skill: SkillKey = n.kind === 'tree' ? 'woodcutting' : 'mining';
  const lvl = skillLevel(st, skill);
  const qty = 1 + (Math.random() < lvl * 0.03 ? 1 : 0);
  dropItem(z, n.x, n.y, makeItem(rng, picked, 'common', qty), rng);
  if (grantXp(st, skill, 26)) levelBurst(z, skill);
  xpPopup(z, skill, 26);
  if (n.kind === 'tree') st.lifetime.treesFelled++; else st.lifetime.rocksMined++;
  burst(z, n.x, n.y - 24, 18, n.kind === 'tree' ? '#4d7c3c' : '#8a8d96',
    { speed: 150, size: 3.2, life: 0.7, up: 26 });
  shakeIt(z, 4);
  z.hitstop = Math.max(z.hitstop, 0.05);
  n.respawn = 22 + Math.random() * 18;
  n.hp = n.maxHp;

  const q = st.active;
  if (q && (q.kind === 'chop' || q.kind === 'mine') && q.target === picked && q.zoneId === z.def.id) {
    q.have = Math.min(q.need, q.have + qty);
    popup(z, n.x, n.y - 40, q.have + '/' + q.need, '#f0d67a', 14);
  }
}

export function damageMob(
  z: Zone, st: GameState, m: Mob, raw: number, crit: boolean,
  fromAngle: number, knockback: number,
): void {
  const md = MONSTERS[m.defId];
  const dmg = Math.max(1, raw - md.armor * 0.5);
  m.hp -= dmg;
  m.hitFlash = 0.16;
  m.aggroed = true;
  if (m.state === 'idle') m.state = 'chase';
  const kbScale = md.family === 'boss' ? 0.16 : 1;
  m.kbx += Math.cos(fromAngle) * knockback * kbScale;
  m.kby += Math.sin(fromAngle) * knockback * kbScale;
  if (md.family !== 'boss') m.stun = Math.max(m.stun, crit ? 0.22 : 0.1);

  popup(z, m.x, m.y - md.size - 10 - m.gz, Math.round(dmg) + (crit ? '!' : ''),
    crit ? '#ffd166' : '#fff1e0', crit ? 20 : 13 + Math.min(8, dmg / 8));
  burst(z, m.x, m.y - md.size * 0.7 - m.gz, crit ? 12 : 6, crit ? '#ffd166' : '#ffb4a2',
    { speed: crit ? 200 : 130, size: crit ? 3.4 : 2.6, life: 0.35, up: md.size });

  z.hitstop = Math.max(z.hitstop, crit ? 0.085 : 0.045);
  shakeIt(z, crit ? 6 : 2.6);

  if (m.hp <= 0) killMob(z, st, m);
}

/** Every way a monster can land a blow funnels through here. */
function hitPlayer(
  z: Zone, st: GameState, md: MonsterDef, d: ReturnType<typeof derived>,
  ev: ZoneEvents, scale: number, ignoreJump = false,
): void {
  if (z.iframes > 0) {
    popup(z, z.px, z.py - 44, 'dodged', '#9fe0c0', 13, 0.8);
    if (grantXp(st, 'footwork', 12)) levelBurst(z, 'footwork');
    xpPopup(z, 'footwork', 12);
    return;
  }
  if (z.airborne && !md.ranged && !ignoreJump) {
    popup(z, z.px, z.py - 44, 'over it', '#9fe0c0', 13, 0.8);
    if (grantXp(st, 'footwork', 10)) levelBurst(z, 'footwork');
    xpPopup(z, 'footwork', 10);
    return;
  }
  const raw = md.atk * scale * (0.85 + Math.random() * 0.3);
  let dmg = Math.max(1, raw - d.armor * 0.55);
  if (z.shield > 0) {
    const absorbed = Math.min(z.shield, dmg);
    z.shield -= absorbed;
    dmg -= absorbed;
    popup(z, z.px + 20, z.py - 50, '-' + Math.round(absorbed), '#7fa8e0', 13, 0.8);
  }
  if (dmg <= 0) return;
  st.hp -= dmg;
  z.hurtT = 0.26;
  z.castT = 0;
  shakeIt(z, 7);
  z.hitstop = Math.max(z.hitstop, 0.06);
  popup(z, z.px, z.py - 38, '-' + Math.round(dmg), '#ff6b6b', 16);
  burst(z, z.px, z.py - 18, 10, '#c8352c', { speed: 150, size: 3, life: 0.4, up: 16 });
  if (grantXp(st, 'vigor', Math.round(dmg * 0.6))) levelBurst(z, 'vigor');
  if (st.hp <= 0) ev.onDeath(md.name);
}

function killMob(z: Zone, st: GameState, m: Mob): void {
  const md = MONSTERS[m.defId];
  m.state = 'dead';
  m.dead = 0;
  st.lifetime.kills++;
  const d = derived(st);
  const boss = md.family === 'boss';

  const skill: SkillKey = md.skill;
  if (grantXp(st, skill, md.xp)) levelBurst(z, skill);
  xpPopup(z, skill, md.xp);
  const vig = Math.round(md.xp * 0.25);
  if (grantXp(st, 'vigor', vig)) levelBurst(z, 'vigor');

  const gold = Math.round(
    (md.gold[0] + Math.random() * (md.gold[1] - md.gold[0])) *
    d.goldMult * (st.hero.trait.id === 'cursed' ? 1.6 : 1),
  );
  st.gold += gold;
  st.lifetime.goldEarned += gold;
  popup(z, m.x + 18, m.y - md.size - m.gz, '+' + gold + 'g', '#f5c542', 13);

  burst(z, m.x, m.y - md.size * 0.6 - m.gz, boss ? 80 : 20, md.color,
    { speed: boss ? 340 : 190, size: 4, life: 0.9, up: md.size });
  z.hitstop = Math.max(z.hitstop, boss ? 0.35 : 0.09);
  shakeIt(z, boss ? 20 : 5);
  z.killGlow = boss ? 0.6 : 0.25;
  if (boss) {
    popup(z, m.x, m.y - md.size * 2 - m.gz, md.name.toUpperCase() + ' FALLS', '#ffd166', 24, 3);
    pushLog(st, md.name + ' is dead. ' + (md.title ?? ''), 'good');
    st.lifetime.bosses++;
  }

  const beastBonus = md.family === 'beast' ? skillLevel(st, 'hunting') * 0.03 : 0;
  for (const [defId, chance] of md.drops) {
    if (Math.random() < chance * d.luckMult + beastBonus) {
      dropItem(z, m.x, m.y, makeItem(rng, defId, 'common', 1), rng);
    }
  }
  if (Math.random() < md.gearChance * d.luckMult) {
    const it = makeItem(rng, gearForFamily(md), boss ? bossRarity() : undefined);
    dropItem(z, m.x, m.y, it, rng);
    if (it.rarity !== 'common' && it.rarity !== 'uncommon') {
      popup(z, m.x, m.y - md.size - 30 - m.gz, it.rarity.toUpperCase() + '!', '#ffd166', 16, 1.8);
      shakeIt(z, 7);
    }
  }

  const q = st.active;
  if (q && (q.kind === 'kill' || q.kind === 'boss') && q.target === m.defId && q.zoneId === z.def.id) {
    q.have = Math.min(q.need, q.have + 1);
    popup(z, m.x, m.y - md.size - 32 - m.gz, q.have + '/' + q.need, '#f0d67a', 15);
    if (q.have >= q.need) pushLog(st, 'Objective complete. Report to the guild.', 'good');
  }
}

function bossRarity(): 'rare' | 'epic' | 'legendary' {
  const r = Math.random();
  return r < 0.12 ? 'legendary' : r < 0.5 ? 'epic' : 'rare';
}

function dropItem(z: Zone, x: number, y: number, item: Item, r: RNG): void {
  z.drops.push({
    uid: uid(), item,
    x: x + r.float(-16, 16), y: y + r.float(-16, 16),
    t: 0, vz: 110, z: 26, gz: standZ(z, x, y),
  });
}

const GEAR_BY_FAMILY: Record<string, string[]> = {
  beast: ['leather_cap', 'boots', 'bone_charm', 'padded_tunic', 'dagger', 'axe'],
  ooze: ['wand', 'copper_ring', 'boots'],
  humanoid: ['shortsword', 'buckler', 'leather_cap', 'axe', 'pickaxe', 'padded_tunic', 'copper_ring'],
  undead: ['wizard_hat', 'bone_charm', 'apprentice_staff', 'iron_helm', 'chainmail'],
  boss: ['greatsword', 'runewood_staff', 'kite_shield', 'chainmail', 'robe', 'heart_locket',
    'iron_helm', 'battleaxe', 'prospectors_kit', 'runed_axe', 'deepiron_pick'],
};
function gearForFamily(md: MonsterDef): string {
  const pool = GEAR_BY_FAMILY[md.family] ?? GEAR_BY_FAMILY.humanoid;
  return pool[Math.floor(Math.random() * pool.length)];
}

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------- jump

export function tryJump(z: Zone, st: GameState): boolean {
  const d = derived(st);
  if (z.airborne || z.dashT > 0) return false;
  if (!st.techniques.includes('jump')) return false;
  if (st.stamina < d.jump.staminaCost) {
    popup(z, z.px, z.py - 50, 'winded', '#8fa8c0', 11, 0.6);
    return false;
  }
  st.stamina -= d.jump.staminaCost;
  z.staminaLock = Math.max(z.staminaLock, 0.4);
  z.airborne = true;
  z.jumpVz = (2 * d.jump.height) / (d.jump.duration / 2);
  z.castT = 0;
  burst(z, z.px, z.py, 8, '#d8d2c4', { speed: 70, size: 2.2, life: 0.3, up: 2, grav: 40 });
  if (grantXp(st, 'footwork', 3)) levelBurst(z, 'footwork');
  return true;
}

function tickJump(z: Zone, st: GameState, dt: number, ev: ZoneEvents): void {
  if (!z.airborne) return;
  const d = derived(st);
  const g = (2 * d.jump.height) / (d.jump.duration / 2) / (d.jump.duration / 2);
  z.jumpVz -= g * dt;
  z.jumpZ += z.jumpVz * dt;
  if (z.jumpZ <= 0) {
    z.jumpZ = 0;
    z.jumpVz = 0;
    z.airborne = false;
    if (inChasm(z, z.px, z.py)) {
      // you did not make it
      z.px = z.safeX; z.py = z.safeY;
      z.groundZ = standZ(z, z.px, z.py);
      const dmg = Math.max(4, d.maxHp * 0.08);
      st.hp -= dmg;
      z.hurtT = 0.4;
      shakeIt(z, 10);
      popup(z, z.px, z.py - 40, '-' + Math.round(dmg), '#ff6b6b', 16);
      pushLog(st, 'You fell.', 'bad');
      if (st.hp <= 0) { ev.onDeath('a long drop'); return; }
    } else {
      burst(z, z.px, z.py, 7, '#cdc6b6', { speed: 90, size: 2.2, life: 0.25, up: 2, grav: 40 });
      shakeIt(z, 1.2);
    }
  }
}

// ---------------------------------------------------------------------- dash

export function tryDash(z: Zone, st: GameState, mx: number, my: number): boolean {
  const d = derived(st);
  if (z.dashT > 0 || z.dashLock > 0) return false;
  if (z.dashCharges <= 0) {
    popup(z, z.px, z.py - 50, 'winded', '#8fa8c0', 11, 0.6);
    return false;
  }
  if (st.stamina < d.dash.staminaCost) {
    popup(z, z.px, z.py - 50, 'no stamina', '#8fa8c0', 11, 0.6);
    return false;
  }
  const len = Math.hypot(mx, my);
  const dx = len > 0.01 ? mx / len : Math.cos(z.facing);
  const dy = len > 0.01 ? my / len : Math.sin(z.facing);

  z.dashCharges--;
  st.stamina -= d.dash.staminaCost;
  z.staminaLock = 0.7;
  z.dashLock = d.dash.lockout;
  z.castT = 0;
  z.dashT = d.dash.duration;
  z.dashDirX = dx; z.dashDirY = dy;
  z.iframes = Math.max(z.iframes, d.dash.iframes);
  z.facing = Math.atan2(dy, dx);
  if (d.dash.momentum) z.momentumT = 2;

  burst(z, z.px, z.py, 12, '#cfd8e8', { speed: 110, size: 2.6, life: 0.35, up: 8, grav: 60 });
  shakeIt(z, d.dash.blink ? 5 : 2);
  if (grantXp(st, 'footwork', 6)) levelBurst(z, 'footwork');
  xpPopup(z, 'footwork', 6);
  return true;
}

// ------------------------------------------------------------------ movement

export interface StepState { groundZ: number; jumpZ: number; airborne: boolean }
export type StepResult =
  | { ok: false }
  | { ok: true; groundZ: number; jumpZ: number; airborne: boolean; fell: boolean };

/**
 * Can you put a foot at (x, y) from this state? You walk off ledges freely, but
 * climbing one needs the apex of a jump to clear the lip, and holes are walls
 * until you are airborne. Pure, so it can be reasoned about and tested.
 */
export function resolveStep(z: Zone, x: number, y: number, s: StepState): StepResult {
  if (inChasm(z, x, y) && !s.airborne) return { ok: false };
  const height = s.groundZ + s.jumpZ;
  const tz = standZ(z, x, y);
  if (tz > s.groundZ) {
    if (!s.airborne || height < tz - 3) return { ok: false };
    return { ok: true, groundZ: tz, jumpZ: Math.max(0, height - tz), airborne: true, fell: false };
  }
  if (tz < s.groundZ) {
    return { ok: true, groundZ: tz, jumpZ: height - tz, airborne: true, fell: !s.airborne };
  }
  return { ok: true, groundZ: s.groundZ, jumpZ: s.jumpZ, airborne: s.airborne, fell: false };
}

function stepPlayer(z: Zone, nx: number, ny: number): void {
  const W = z.def.w * TS, H = z.def.h * TS;
  const apply = (r: StepResult): boolean => {
    if (!r.ok) return false;
    z.groundZ = r.groundZ;
    z.jumpZ = r.jumpZ;
    if (r.airborne && !z.airborne) z.jumpVz = 0;
    z.airborne = r.airborne;
    return true;
  };
  const cx = Math.max(20, Math.min(W - 20, nx));
  if (apply(resolveStep(z, cx, z.py, z))) z.px = cx;
  const cy = Math.max(20, Math.min(H - 20, ny));
  if (apply(resolveStep(z, z.px, cy, z))) z.py = cy;
  if (!z.airborne && !inChasm(z, z.px, z.py)) { z.safeX = z.px; z.safeY = z.py; }
}

// ---------------------------------------------------------------------- boss

function pickBossAttack(m: Mob, md: MonsterDef, dist: number): number {
  const options: number[] = [];
  (md.attacks ?? []).forEach((a, i) => {
    if (m.atkCds[i] > 0) return;
    if (dist > a.range) return;
    if (a.minRange !== undefined && dist < a.minRange) return;
    options.push(i);
  });
  if (!options.length) return -1;
  return options[Math.floor(Math.random() * options.length)];
}

function startBossAttack(z: Zone, m: Mob, md: MonsterDef, i: number): void {
  const a = md.attacks![i];
  m.atkIdx = i;
  m.windup = a.windup;
  m.atkCds[i] = a.cd;
  m.cd = 0.55;
  const ang = a.behind ? m.facing + Math.PI : m.facing;

  if (a.kind === 'slam') {
    telegraph(z, {
      kind: 'circle', x: m.x, y: m.y, r: a.radius ?? 120,
      ang: 0, arc: 0, len: 0, wide: 0, total: a.windup, color: a.color,
    });
  } else if (a.kind === 'cone') {
    telegraph(z, {
      kind: 'cone', x: m.x, y: m.y, r: a.range, ang, arc: a.arc ?? 0.6,
      len: 0, wide: 0, total: a.windup, color: a.color,
    });
  } else if (a.kind === 'arc') {
    telegraph(z, {
      kind: 'cone', x: m.x, y: m.y, r: a.range, ang, arc: a.arc ?? 1.2,
      len: 0, wide: 0, total: a.windup, color: a.color,
    });
  } else if (a.kind === 'charge') {
    telegraph(z, {
      kind: 'line', x: m.x, y: m.y, r: 0, ang: m.facing, arc: 0,
      len: (a.chargeSpeed ?? 500) * (a.chargeTime ?? 0.45), wide: MONSTERS[m.defId].size * 2,
      total: a.windup, color: a.color,
    });
  }
  popup(z, m.x, m.y - md.size * 2.2 - m.gz, a.name, a.color, 14, a.windup + 0.3);
}

function fireBossAttack(
  z: Zone, st: GameState, m: Mob, md: MonsterDef, d: ReturnType<typeof derived>, ev: ZoneEvents,
): void {
  const a = md.attacks![m.atkIdx];
  if (!a) return;
  const dx = z.px - m.x, dy = z.py - m.y;
  const dist = Math.hypot(dx, dy);
  const ang = a.behind ? m.facing + Math.PI : m.facing;

  switch (a.kind) {
    case 'arc':
    case 'cone': {
      const within = dist <= a.range + 12
        && Math.abs(angDiff(Math.atan2(dy, dx), ang)) <= (a.arc ?? 1.2);
      z.slashes.push({ x: m.x, y: m.y, ang, t: 0, range: a.range, arc: a.arc ?? 1.2, color: a.color, life: 0.3 });
      burst(z, m.x + Math.cos(ang) * a.range * 0.5, m.y + Math.sin(ang) * a.range * 0.5,
        14, a.color, { speed: 200, size: 3.4, life: 0.45, up: 16 });
      shakeIt(z, 6);
      if (within) hitPlayer(z, st, md, d, ev, a.dmg);
      break;
    }
    case 'slam': {
      const r = a.radius ?? 130;
      z.impacts.push({ x: m.x, y: m.y, r, t: 0.02, dmg: 0, fromPlayer: false, color: a.color, knock: 0 });
      burst(z, m.x, m.y, 40, a.color, { speed: 300, size: 4, life: 0.6, up: 12, grav: 200 });
      shakeIt(z, 12);
      z.hitstop = Math.max(z.hitstop, 0.06);
      if (dist <= r) hitPlayer(z, st, md, d, ev, a.dmg, true);
      break;
    }
    case 'charge': {
      m.chargeT = a.chargeTime ?? 0.45;
      m.chargeX = Math.cos(m.facing) * (a.chargeSpeed ?? 500);
      m.chargeY = Math.sin(m.facing) * (a.chargeSpeed ?? 500);
      break;
    }
    case 'volley': {
      const shots = a.shots ?? 3;
      const spread = a.spread ?? 0.3;
      const base = Math.atan2(dy, dx);
      for (let i = 0; i < shots; i++) {
        const off = shots === 1 ? 0 : (i / (shots - 1) - 0.5) * spread * 2;
        const sp = a.projSpeed ?? 300;
        z.projectiles.push({
          x: m.x, y: m.y - md.size, vx: Math.cos(base + off) * sp, vy: Math.sin(base + off) * sp,
          life: (a.range + 100) / sp, dmg: md.atk * a.dmg, crit: false,
          color: a.color, hostile: true, size: 8,
        });
      }
      shakeIt(z, 4);
      break;
    }
    case 'summon': {
      const n = a.spawnCount ?? 2;
      for (let i = 0; i < n; i++) {
        const ang2 = (i / n) * Math.PI * 2;
        const sx = m.x + Math.cos(ang2) * 90;
        const sy = m.y + Math.sin(ang2) * 90;
        const spawned = spawnMob(z, rng, a.spawn ?? 'wolf', sx, sy);
        spawned.aggroed = true;
        spawned.state = 'chase';
        burst(z, sx, sy, 18, a.color, { speed: 160, size: 3, life: 0.5, up: 14 });
      }
      popup(z, m.x, m.y - md.size * 2 - m.gz, a.name + '!', a.color, 16, 1.4);
      shakeIt(z, 6);
      break;
    }
  }
}

// ---------------------------------------------------------------------- tick

export function tickZone(
  z: Zone, st: GameState, dtRaw: number,
  input: { mx: number; my: number; attack: boolean },
  ev: ZoneEvents,
): void {
  let dt = dtRaw;
  if (z.hitstop > 0) {
    z.hitstop = Math.max(0, z.hitstop - dtRaw);
    dt = dtRaw * 0.06;
  }
  z.time += dtRaw;
  z.shake *= Math.pow(0.0016, dtRaw);
  z.killGlow = Math.max(0, z.killGlow - dtRaw * 1.6);

  const d = derived(st);
  const W = z.def.w * TS, H = z.def.h * TS;

  for (const k of Object.keys(z.abilityCd)) {
    z.abilityCd[k] = Math.max(0, z.abilityCd[k] - dt);
  }
  if (z.buffAtkT > 0) z.buffAtkT -= dt;

  // ---- player movement
  let speed = d.speed;
  if (z.momentumT > 0) { z.momentumT -= dt; speed *= 1.35; }
  if (z.castT > 0) speed *= 0.34;
  if (z.spinT > 0) speed *= 0.6;

  if (z.dashT > 0) {
    z.dashT -= dt;
    const ds = d.speed * d.dash.speed;
    stepPlayer(z, z.px + z.dashDirX * ds * dt, z.py + z.dashDirY * ds * dt);
    z.dashTrail.push({ x: z.px, y: z.py, z: z.groundZ + z.jumpZ, t: 0 });
    if (d.dash.bullRush) {
      for (const m of z.mobs) {
        if (m.state === 'dead' || m.stun > 0.3) continue;
        const md = MONSTERS[m.defId];
        if (Math.hypot(m.x - z.px, m.y - z.py) < md.size + 20) {
          damageMob(z, st, m, playerAtk(z, d) * 0.5 * famMult(md, d), false,
            Math.atan2(z.dashDirY, z.dashDirX), 340);
        }
      }
    }
  } else {
    const len = Math.hypot(input.mx, input.my);
    if (len > 0.01) {
      const nx = input.mx / len, ny = input.my / len;
      stepPlayer(z, z.px + nx * speed * dt, z.py + ny * speed * dt);
      if (Math.random() < dt * 0.9) grantXp(st, 'footwork', 1);
    }
  }
  for (const t of z.dashTrail) t.t += dtRaw;
  z.dashTrail = z.dashTrail.filter((t) => t.t < 0.3);

  z.iframes = Math.max(0, z.iframes - dt);
  z.atkCd = Math.max(0, z.atkCd - dt);
  z.dashLock = Math.max(0, z.dashLock - dt);
  z.staminaLock = Math.max(0, z.staminaLock - dt);
  z.swingT = Math.max(0, z.swingT - dtRaw);
  z.hurtT = Math.max(0, z.hurtT - dtRaw);
  tickJump(z, st, dt, ev);
  if (st.hp <= 0) return;

  // ---- whirlwind keeps hitting while you walk
  if (z.spinT > 0) {
    z.spinT -= dt;
    z.spinTick -= dt;
    if (z.spinTick <= 0) {
      z.spinTick = 0.34;
      z.slashes.push({ x: z.px, y: z.py, ang: z.time * 14, t: 0, range: d.range * 1.5, arc: Math.PI, color: '#e06a5a', life: 0.3 });
      meleeHit(z, st, d, Math.PI * 2, d.range * 1.5, playerAtk(z, d), 0.85, 200);
      burst(z, z.px, z.py - 12, 10, '#e06a5a', { speed: 200, size: 2.8, life: 0.3, up: 14 });
      shakeIt(z, 3);
    }
  } else if (z.castT > 0) {
    z.castT -= dt;
    if (z.castT <= 0) { z.castT = 0; releaseBolt(z, st); }
  } else if (input.attack) {
    playerAttack(z, st);
  }

  if (z.dashCharges < d.dash.charges) {
    z.dashRecharge += dt;
    if (z.dashRecharge >= d.dash.cooldown) { z.dashRecharge = 0; z.dashCharges++; }
  } else {
    z.dashRecharge = 0;
  }

  st.mana = Math.min(d.maxMana, st.mana + dt * d.manaRegen);
  if (z.staminaLock <= 0) {
    st.stamina = Math.min(d.maxStamina, st.stamina + dt * d.staminaRegen);
  }

  // ---- mobs
  for (const m of z.mobs) {
    m.hitFlash = Math.max(0, m.hitFlash - dt);
    m.stun = Math.max(0, m.stun - dt);
    m.slowT = Math.max(0, m.slowT - dt);
    m.gz = standZ(z, m.x, m.y);

    if (Math.abs(m.kbx) > 1 || Math.abs(m.kby) > 1) {
      const nx = clamp(m.x + m.kbx * dt, 16, W - 16);
      const ny = clamp(m.y + m.kby * dt, 16, H - 16);
      if (!inChasm(z, nx, ny)) { m.x = nx; m.y = ny; }
      const decay = Math.pow(0.0009, dt);
      m.kbx *= decay; m.kby *= decay;
    }

    if (m.state === 'dead') { m.dead += dtRaw; continue; }
    if (m.stun > 0) continue;

    const md = MONSTERS[m.defId];
    const spd = md.speed * (m.slowT > 0 ? 0.5 : 1);
    const dx = z.px - m.x, dy = z.py - m.y;
    const dist = Math.hypot(dx, dy);

    if (!m.aggroed && dist < md.aggro) { m.aggroed = true; m.state = 'chase'; }
    if (m.aggroed && dist > md.aggro * 2.6 && md.family !== 'boss') { m.aggroed = false; m.state = 'idle'; }

    m.cd = Math.max(0, m.cd - dt);
    for (let i = 0; i < m.atkCds.length; i++) m.atkCds[i] = Math.max(0, m.atkCds[i] - dt);

    // ------------------------------------------------------------ boss brain
    if (md.attacks && m.aggroed) {
      m.facing = Math.atan2(dy, dx);
      if (m.chargeT > 0) {
        m.chargeT -= dt;
        const nx = clamp(m.x + m.chargeX * dt, 16, W - 16);
        const ny = clamp(m.y + m.chargeY * dt, 16, H - 16);
        if (!inChasm(z, nx, ny)) { m.x = nx; m.y = ny; }
        burst(z, m.x, m.y, 2, md.accent, { speed: 60, size: 3, life: 0.3, up: 8, grav: 60 });
        const a = md.attacks[m.atkIdx];
        if (Math.hypot(z.px - m.x, z.py - m.y) < md.size + 24) {
          hitPlayer(z, st, md, d, ev, a?.dmg ?? 1, true);
          if (st.hp <= 0) return;
          m.chargeT = 0;
          shakeIt(z, 10);
        }
        continue;
      }
      if (m.windup > 0) {
        m.windup -= dt;
        if (m.windup <= 0) {
          fireBossAttack(z, st, m, md, d, ev);
          if (st.hp <= 0) return;
        }
        continue;
      }
      if (m.cd <= 0) {
        const pick = pickBossAttack(m, md, dist);
        if (pick >= 0) { startBossAttack(z, m, md, pick); continue; }
      }
      // reposition: bosses close to their preferred band
      const want = md.attackRange * 0.8;
      if (dist > want) {
        const nx = m.x + (dx / dist) * spd * dt;
        const ny = m.y + (dy / dist) * spd * dt;
        if (!inChasm(z, nx, ny)) { m.x = nx; m.y = ny; }
      }
      continue;
    }

    // ------------------------------------------------------- ordinary brain
    if (m.lungeT > 0) {
      m.lungeT -= dt;
      const nx = clamp(m.x + m.lungeX * dt, 16, W - 16);
      const ny = clamp(m.y + m.lungeY * dt, 16, H - 16);
      if (!inChasm(z, nx, ny)) { m.x = nx; m.y = ny; }
      if (Math.hypot(z.px - m.x, z.py - m.y) < md.size + 22 && z.iframes <= 0 && !z.airborne) {
        hitPlayer(z, st, md, d, ev, 1);
        if (st.hp <= 0) return;
        m.lungeT = 0;
      }
      continue;
    }

    if (m.state === 'idle') {
      m.wanderT -= dt;
      if (m.wanderT <= 0) {
        m.wanderT = 1.5 + Math.random() * 3;
        m.wx = clamp(m.x + (Math.random() - 0.5) * 220, 20, W - 20);
        m.wy = clamp(m.y + (Math.random() - 0.5) * 220, 20, H - 20);
      }
      const wdx = m.wx - m.x, wdy = m.wy - m.y;
      const wd = Math.hypot(wdx, wdy);
      if (wd > 6) {
        const nx = m.x + (wdx / wd) * spd * 0.35 * dt;
        const ny = m.y + (wdy / wd) * spd * 0.35 * dt;
        if (!inChasm(z, nx, ny)) { m.x = nx; m.y = ny; }
        m.facing = Math.atan2(wdy, wdx);
      }
    } else {
      m.facing = Math.atan2(dy, dx);
      if (m.windup > 0) {
        m.windup -= dt;
        if (m.windup <= 0) {
          if (md.ranged) {
            const sp = md.ranged.speed;
            const ang = Math.atan2(z.py - m.y, z.px - m.x);
            z.projectiles.push({
              x: m.x, y: m.y - md.size, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: (md.attackRange + 80) / sp,
              dmg: md.atk * (0.85 + Math.random() * 0.3),
              crit: false, color: md.ranged.color, hostile: true, size: md.ranged.size,
            });
          } else if (md.lunge && dist > md.attackRange + 30 && dist < md.lunge.range) {
            m.lungeT = 0.3;
            m.lungeX = (dx / dist) * md.lunge.speed;
            m.lungeY = (dy / dist) * md.lunge.speed;
            burst(z, m.x, m.y, 6, md.accent, { speed: 80, size: 2.4, life: 0.3, up: 6 });
          } else if (Math.hypot(z.px - m.x, z.py - m.y) < md.attackRange + 14) {
            hitPlayer(z, st, md, d, ev, 1);
            if (st.hp <= 0) return;
          }
        }
      } else if (md.ranged && dist < md.attackRange * 0.45) {
        const nx = m.x - (dx / dist) * spd * 0.8 * dt;
        const ny = m.y - (dy / dist) * spd * 0.8 * dt;
        if (!inChasm(z, nx, ny)) { m.x = nx; m.y = ny; }
      } else if (dist > (md.ranged ? md.attackRange * 0.85 : md.attackRange)) {
        const nx = m.x + (dx / dist) * spd * dt;
        const ny = m.y + (dy / dist) * spd * dt;
        if (!inChasm(z, nx, ny)) { m.x = nx; m.y = ny; }
      } else if (m.cd <= 0) {
        m.cd = md.attackCd;
        m.windup = md.ranged ? 0.5 : 0.38;
      } else if (md.lunge && m.cd < md.attackCd * 0.4 && dist > md.attackRange + 40
        && dist < md.lunge.range && Math.random() < dt * 1.4) {
        m.cd = md.attackCd;
        m.windup = 0.34;
      }
    }

    for (const o of z.mobs) {
      if (o === m || o.state === 'dead') continue;
      const ox = m.x - o.x, oy = m.y - o.y;
      const od = Math.hypot(ox, oy);
      const want = MONSTERS[m.defId].size + MONSTERS[o.defId].size;
      if (od > 0.01 && od < want) {
        m.x += (ox / od) * (want - od) * 0.5 * dt * 8;
        m.y += (oy / od) * (want - od) * 0.5 * dt * 8;
      }
    }
  }
  z.mobs = z.mobs.filter((m) => m.state !== 'dead' || m.dead < 1.2);

  const alive = z.mobs.filter((m) => m.state !== 'dead').length;
  if (alive < z.def.density && Math.random() < dt * 0.35) {
    const m = spawnMob(z, rng, pickSpawn(rng, z.def));
    if (Math.hypot(m.x - z.px, m.y - z.py) < 420) { m.x = Math.random() * W; m.y = Math.random() * H; }
  }

  // ---- nodes
  for (const n of z.nodes) {
    n.hitFlash = Math.max(0, n.hitFlash - dt);
    n.shakeT = Math.max(0, n.shakeT - dtRaw);
    if (n.respawn > 0) n.respawn -= dtRaw;
  }

  // ---- delayed impacts
  for (const im of z.impacts) {
    im.t -= dt;
    if (im.t > 0) continue;
    if (im.fromPlayer) {
      for (const m of z.mobs) {
        if (m.state === 'dead') continue;
        const md = MONSTERS[m.defId];
        if (Math.hypot(m.x - im.x, m.y - im.y) > im.r + md.size) continue;
        damageMob(z, st, m, im.dmg * famMult(md, d), Math.random() < d.crit,
          Math.atan2(m.y - im.y, m.x - im.x), im.knock);
      }
    }
    burst(z, im.x, im.y, 34, im.color, { speed: 300, size: 4, life: 0.6, up: 14, grav: 200 });
    shakeIt(z, 9);
    z.hitstop = Math.max(z.hitstop, 0.06);
  }
  z.impacts = z.impacts.filter((im) => im.t > 0);

  // ---- projectiles
  for (const p of z.projectiles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (Math.random() < dt * 40) {
      z.particles.push({
        x: p.x, y: p.y, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 0.25, color: p.color, size: 3, grav: 0,
      });
    }
    if (p.hostile) {
      if (Math.hypot(z.px - p.x, z.py - p.y) < 15 + p.size) {
        if (z.iframes > 0) {
          popup(z, z.px, z.py - 44, 'dodged', '#9fe0c0', 13, 0.8);
          if (grantXp(st, 'footwork', 14)) levelBurst(z, 'footwork');
        } else {
          let dmg = Math.max(1, p.dmg - d.armor * 0.55);
          if (z.shield > 0) {
            const abs = Math.min(z.shield, dmg);
            z.shield -= abs; dmg -= abs;
          }
          if (dmg > 0) {
            st.hp -= dmg;
            z.hurtT = 0.24;
            z.castT = 0;
            shakeIt(z, 5);
            popup(z, z.px, z.py - 38, '-' + Math.round(dmg), '#ff6b6b', 15);
            burst(z, p.x, p.y, 8, p.color, { speed: 130, size: 3, life: 0.35, up: 10 });
            if (grantXp(st, 'vigor', Math.round(dmg * 0.6))) levelBurst(z, 'vigor');
            if (st.hp <= 0) { ev.onDeath('a thrown rock'); return; }
          }
        }
        p.life = 0;
      }
      continue;
    }
    for (const m of z.mobs) {
      if (m.state === 'dead') continue;
      if (p.hit?.has(m.uid)) continue;
      const md = MONSTERS[m.defId];
      if (Math.hypot(m.x - p.x, m.y - p.y) < md.size + 9) {
        damageMob(z, st, m, p.dmg * famMult(md, d), p.crit, Math.atan2(p.vy, p.vx), p.pierce ? 90 : 140);
        if (p.slow) m.slowT = Math.max(m.slowT, p.slow);
        burst(z, p.x, p.y, 10, p.color, { speed: 150, size: 3, life: 0.4, up: 0, grav: 0 });
        if (p.pierce) { p.hit?.add(m.uid); } else { p.life = 0; break; }
      }
    }
  }
  z.projectiles = z.projectiles.filter((p) => p.life > 0);

  for (const s of z.slashes) s.t += dtRaw;
  z.slashes = z.slashes.filter((s) => s.t < (s.life ?? 0.24));

  for (const tg of z.telegraphs) tg.t += dtRaw;
  z.telegraphs = z.telegraphs.filter((tg) => tg.t < tg.total);

  // ---- particles
  for (const p of z.particles) {
    p.life += dtRaw;
    p.x += p.vx * dtRaw;
    p.y += p.vy * dtRaw;
    p.z = Math.max(0, p.z + p.vz * dtRaw);
    p.vz -= p.grav * dtRaw;
    p.vx *= Math.pow(0.05, dtRaw);
    p.vy *= Math.pow(0.05, dtRaw);
  }
  z.particles = z.particles.filter((p) => p.life < p.maxLife);
  if (z.particles.length > 600) z.particles.splice(0, z.particles.length - 600);

  // ---- critters scatter when you get close
  for (const c of z.critters) {
    c.t += dtRaw;
    const away = Math.hypot(c.x - z.px, c.y - z.py);
    if (away < 130) c.flee = 1.4;
    if (c.flee > 0) {
      c.flee -= dtRaw;
      const a = Math.atan2(c.y - z.py, c.x - z.px);
      const sp = c.kind === 'rabbit' ? 220 : c.kind === 'bird' ? 260 : 90;
      c.x += Math.cos(a) * sp * dtRaw;
      c.y += Math.sin(a) * sp * dtRaw;
      if (c.kind === 'bird') c.z = Math.min(70, c.z + 90 * dtRaw);
    } else {
      if (c.kind === 'bird') c.z = Math.max(0, c.z - 40 * dtRaw);
      const wob = Math.sin(c.t * 1.6) * 22;
      c.x += Math.cos(c.t * 0.7) * 16 * dtRaw;
      c.y += Math.sin(c.t * 0.9) * 12 * dtRaw + wob * dtRaw * 0.4;
    }
    c.x = clamp(c.x, 20, W - 20);
    c.y = clamp(c.y, 20, H - 20);
  }

  // ---- ambient motes
  for (const mo of z.motes) {
    mo.t += dtRaw;
    mo.x += mo.vx * dtRaw;
    mo.y += mo.vy * dtRaw;
    if (mo.t > mo.life) {
      mo.t = 0;
      mo.x = z.px + (Math.random() - 0.5) * 1400;
      mo.y = z.py + (Math.random() - 0.5) * 1400;
      mo.z = 6 + Math.random() * 70;
    }
  }

  // ---- drops
  for (const dr of z.drops) {
    dr.t += dtRaw;
    dr.vz -= 340 * dtRaw;
    dr.z = Math.max(0, dr.z + dr.vz * dtRaw);
    if (dr.z <= 0) dr.vz = 0;
    const dist = Math.hypot(dr.x - z.px, dr.y - z.py);
    if (dr.t > 0.45 && dist < 100) {
      const pull = 1 - dist / 100;
      dr.x += (z.px - dr.x) * pull * 8 * dtRaw;
      dr.y += (z.py - dr.y) * pull * 8 * dtRaw;
    }
    if (dr.t > 0.45 && dist < 28) {
      if (autoPlace(st.bag, dr.item)) {
        popup(z, z.px, z.py - 54, dr.item.name, '#cfe8b0', 12, 1);
        burst(z, z.px, z.py - 14, 5, ITEM_DEFS[dr.item.defId].color,
          { speed: 60, size: 2.4, life: 0.3, up: 12 });
        dr.t = -999;
      } else if (z.time % 1.2 < dtRaw) {
        popup(z, z.px, z.py - 54, 'pack is full', '#ff9c6b', 12, 1);
      }
    }
  }
  z.drops = z.drops.filter((dr) => dr.t > -900);

  for (const p of z.popups) { p.t += dtRaw; p.y += p.vy * dtRaw; p.vy += 52 * dtRaw; }
  z.popups = z.popups.filter((p) => p.t < p.life);

  z.nearExit = Math.hypot(z.px - z.exitX, z.py - z.exitY) < 58;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function bossMob(z: Zone): Mob | null {
  if (!z.bossUid) return null;
  return z.mobs.find((m) => m.uid === z.bossUid && m.state !== 'dead') ?? null;
}
