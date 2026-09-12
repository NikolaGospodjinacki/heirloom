import { RNG, rng, uid } from './rng';
import { MONSTERS, MonsterDef, ZONES, ZoneDef } from './content';
import { TS } from '../render/view';
import type { Item, SkillKey } from './types';
import { SKILL_COLOR, SKILL_NAMES } from './types';
import { makeItem, ITEM_DEFS } from './items';
import { autoPlace } from './backpack';
import { GameState, derived, grantXp, pushLog, skillLevel } from './state';

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
  /** leap in progress */
  lungeT: number;
  lungeX: number; lungeY: number;
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
}

export interface Drop {
  uid: string;
  item: Item;
  x: number; y: number;
  t: number;
  vz: number;
  z: number;
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
  /** fired by a monster at the player rather than the other way round */
  hostile: boolean;
  size: number;
}

export interface Slash {
  x: number; y: number; ang: number; t: number; range: number; arc: number;
}

export interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  color: string; size: number;
  grav: number;
}

export interface Zone {
  def: ZoneDef;
  mobs: Mob[];
  nodes: Node[];
  drops: Drop[];
  popups: Popup[];
  projectiles: Projectile[];
  slashes: Slash[];
  particles: Particle[];
  exitX: number; exitY: number;
  px: number; py: number;
  facing: number;
  atkCd: number;
  swingT: number;
  hurtT: number;
  time: number;
  bossSpawned: boolean;
  nearExit: boolean;
  tiles: Uint8Array;
  // --- movement
  jumpZ: number;
  jumpVz: number;
  airborne: boolean;
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
  dashTrail: { x: number; y: number; t: number }[];
  // --- feel
  shake: number;
  hitstop: number;
  killGlow: number;
}

export function buildZone(zoneId: string, st: GameState, bossTarget?: string): Zone {
  const def = ZONES[zoneId];
  const r = new RNG((Math.random() * 0xffffffff) >>> 0);
  const W = def.w * TS, H = def.h * TS;
  const tiles = new Uint8Array(def.w * def.h);
  for (let i = 0; i < tiles.length; i++) tiles[i] = r.chance(0.22) ? 1 : 0;

  const d = derived(st);
  const z: Zone = {
    def, mobs: [], nodes: [], drops: [], popups: [], projectiles: [], slashes: [], particles: [],
    exitX: W * 0.5, exitY: H * 0.94,
    px: W * 0.5, py: H * 0.86,
    facing: -Math.PI / 2, atkCd: 0, swingT: 0, hurtT: 0, time: 0,
    bossSpawned: false, nearExit: false, tiles,
    jumpZ: 0, jumpVz: 0, airborne: false,
    dashLock: 0, staminaLock: 0, castT: 0, castMax: 0,
    dashT: 0, dashDirX: 0, dashDirY: 0,
    dashCharges: d.dash.charges, dashRecharge: 0,
    iframes: 0, momentumT: 0, dashTrail: [],
    shake: 0, hitstop: 0, killGlow: 0,
  };

  const farFromExit = (x: number, y: number, dist = 260) =>
    Math.hypot(x - z.exitX, y - z.exitY) > dist;

  for (let i = 0; i < def.trees; i++) {
    let x = 0, y = 0, tries = 0;
    do { x = r.float(TS, W - TS); y = r.float(TS, H - TS); tries++; } while (!farFromExit(x, y, 150) && tries < 20);
    z.nodes.push({ uid: uid(), kind: 'tree', x, y, hp: 34, maxHp: 34, variant: r.int(0, 2), hitFlash: 0, shakeT: 0, respawn: 0 });
  }
  for (let i = 0; i < def.rocks; i++) {
    let x = 0, y = 0, tries = 0;
    do { x = r.float(TS, W - TS); y = r.float(TS, H - TS); tries++; } while (!farFromExit(x, y, 150) && tries < 20);
    z.nodes.push({ uid: uid(), kind: 'rock', x, y, hp: 46, maxHp: 46, variant: r.int(0, 2), hitFlash: 0, shakeT: 0, respawn: 0 });
  }

  for (let i = 0; i < def.density; i++) spawnMob(z, r, pickSpawn(r, def));

  if (bossTarget && MONSTERS[bossTarget]) {
    const m = spawnMob(z, r, bossTarget);
    m.x = W * 0.5 + r.float(-200, 200);
    m.y = H * 0.18;
    z.bossSpawned = true;
  }
  return z;
}

function pickSpawn(r: RNG, def: ZoneDef): string {
  let roll = r.next();
  for (const [id, w] of def.spawns) { roll -= w; if (roll <= 0) return id; }
  return def.spawns[0][0];
}

function spawnMob(z: Zone, r: RNG, defId: string): Mob {
  const d = MONSTERS[defId];
  const W = z.def.w * TS, H = z.def.h * TS;
  let x = 0, y = 0, tries = 0;
  do {
    x = r.float(TS * 2, W - TS * 2);
    y = r.float(TS * 2, H - TS * 2);
    tries++;
  } while (Math.hypot(x - z.exitX, y - z.exitY) < 320 && tries < 30);
  const m: Mob = {
    uid: uid(), defId, x, y, hp: d.hp, maxHp: d.hp, cd: r.float(0, 1),
    windup: 0, state: 'idle', wanderT: r.float(0, 3), wx: x, wy: y,
    hitFlash: 0, facing: r.float(0, Math.PI * 2), dead: 0, aggroed: false,
    kbx: 0, kby: 0, stun: 0, lungeT: 0, lungeX: 0, lungeY: 0,
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
  z.shake = Math.min(18, z.shake + amount);
}

// -------------------------------------------------------------------- combat

export interface ZoneEvents {
  onDeath: (cause: string) => void;
  onExit: () => void;
}

function famMult(md: MonsterDef, d: ReturnType<typeof derived>): number {
  return md.family === 'beast' ? d.beastMult : d.slayMult;
}

/** Reach for harvesting is the same for everyone: you step up to the tree. */
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

/**
 * Harvesting is its own action, driven by the tool slot, not the weapon. A
 * wizard with a pickaxe mines exactly as well as a warrior with one.
 */
function harvestSwing(z: Zone, st: GameState, n: Node): void {
  const d = derived(st);
  const isTree = n.kind === 'tree';
  const power = isTree ? d.chopPower : d.minePower;
  const skillMult = isTree ? d.chopMult : d.mineMult;
  // bare hands work, but you will regret them
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

  // A tree in front of you takes priority over casting a bolt past it.
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
    // Casting is a commitment: you are rooted to a shuffle while it winds up.
    z.castT = d.castTime;
    z.castMax = d.castTime;
    return;
  }

  z.swingT = 0.2;
  z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: d.range, arc });
  let hitMobs = 0;
  const pounceBonus = z.airborne && d.jump.pounce ? 1.6 : 1;

  for (const m of z.mobs) {
    if (m.state === 'dead') continue;
    const dx = m.x - z.px, dy = m.y - z.py;
    const dist = Math.hypot(dx, dy);
    const md = MONSTERS[m.defId];
    if (dist > d.range + md.size) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), z.facing)) > arc) continue;
    const crit = Math.random() < d.crit;
    const dmg = d.atk * famMult(md, d) * pounceBonus * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
    damageMob(z, st, m, dmg, crit, z.facing, pounceBonus > 1 ? 300 : 190);
    if (pounceBonus > 1) m.stun = Math.max(m.stun, 0.5);
    hitMobs++;
  }

  if (hitMobs > 0) {
    if (grantXp(st, 'blade', 3)) levelBurst(z, 'blade');
    xpPopup(z, 'blade', 3);
  }
}

/** Fires when the cast bar fills. */
function releaseBolt(z: Zone, st: GameState): void {
  const d = derived(st);
  if (st.mana < d.boltCost) return;
  st.mana -= d.boltCost;
  const crit = Math.random() < d.crit;
  const dmg = d.spellPower * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
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
  const kbScale = md.family === 'boss' ? 0.22 : 1;
  m.kbx += Math.cos(fromAngle) * knockback * kbScale;
  m.kby += Math.sin(fromAngle) * knockback * kbScale;
  m.stun = Math.max(m.stun, crit ? 0.22 : 0.1);

  popup(z, m.x, m.y - md.size - 10, Math.round(dmg) + (crit ? '!' : ''),
    crit ? '#ffd166' : '#fff1e0', crit ? 20 : 13 + Math.min(8, dmg / 8));
  burst(z, m.x, m.y - md.size * 0.7, crit ? 12 : 6, crit ? '#ffd166' : '#ffb4a2',
    { speed: crit ? 200 : 130, size: crit ? 3.4 : 2.6, life: 0.35, up: md.size });

  z.hitstop = Math.max(z.hitstop, crit ? 0.085 : 0.045);
  shakeIt(z, crit ? 6 : 2.6);

  if (m.hp <= 0) killMob(z, st, m);
}

/** Every way a monster can land a blow funnels through here. */
function hitPlayer(
  z: Zone, st: GameState, md: MonsterDef, d: ReturnType<typeof derived>,
  ev: ZoneEvents, scale: number,
): void {
  if (z.iframes > 0) {
    popup(z, z.px, z.py - 44, 'dodged', '#9fe0c0', 13, 0.8);
    if (grantXp(st, 'footwork', 12)) levelBurst(z, 'footwork');
    xpPopup(z, 'footwork', 12);
    return;
  }
  if (z.airborne && !md.ranged) {
    popup(z, z.px, z.py - 44, 'over it', '#9fe0c0', 13, 0.8);
    if (grantXp(st, 'footwork', 10)) levelBurst(z, 'footwork');
    xpPopup(z, 'footwork', 10);
    return;
  }
  const raw = md.atk * scale * (0.85 + Math.random() * 0.3);
  const dmg = Math.max(1, raw - d.armor * 0.55);
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
  popup(z, m.x + 18, m.y - md.size, '+' + gold + 'g', '#f5c542', 13);

  burst(z, m.x, m.y - md.size * 0.6, md.family === 'boss' ? 60 : 20, md.color,
    { speed: md.family === 'boss' ? 300 : 190, size: 4, life: 0.8, up: md.size });
  z.hitstop = Math.max(z.hitstop, md.family === 'boss' ? 0.3 : 0.09);
  shakeIt(z, md.family === 'boss' ? 16 : 5);
  z.killGlow = 0.25;

  const beastBonus = md.family === 'beast' ? skillLevel(st, 'hunting') * 0.03 : 0;
  for (const [defId, chance] of md.drops) {
    if (Math.random() < chance * d.luckMult + beastBonus) {
      dropItem(z, m.x, m.y, makeItem(rng, defId, 'common', 1), rng);
    }
  }
  if (Math.random() < md.gearChance * d.luckMult) {
    const it = makeItem(rng, gearForFamily(md));
    dropItem(z, m.x, m.y, it, rng);
    if (it.rarity !== 'common' && it.rarity !== 'uncommon') {
      popup(z, m.x, m.y - md.size - 30, it.rarity.toUpperCase() + '!', '#ffd166', 16, 1.8);
      shakeIt(z, 7);
    }
  }

  const q = st.active;
  if (q && (q.kind === 'kill' || q.kind === 'boss') && q.target === m.defId && q.zoneId === z.def.id) {
    q.have = Math.min(q.need, q.have + 1);
    popup(z, m.x, m.y - md.size - 32, q.have + '/' + q.need, '#f0d67a', 15);
    if (q.have >= q.need) pushLog(st, 'Objective complete. Report to the guild.', 'good');
  }
}

function dropItem(z: Zone, x: number, y: number, item: Item, r: RNG): void {
  z.drops.push({
    uid: uid(), item,
    x: x + r.float(-16, 16), y: y + r.float(-16, 16),
    t: 0, vz: 110, z: 26,
  });
}

const GEAR_BY_FAMILY: Record<string, string[]> = {
  beast: ['leather_cap', 'boots', 'bone_charm', 'padded_tunic', 'dagger'],
  ooze: ['wand', 'copper_ring', 'boots'],
  humanoid: ['shortsword', 'buckler', 'leather_cap', 'axe', 'pickaxe', 'padded_tunic', 'copper_ring'],
  undead: ['wizard_hat', 'bone_charm', 'apprentice_staff', 'iron_helm', 'chainmail'],
  boss: ['greatsword', 'runewood_staff', 'kite_shield', 'chainmail', 'robe', 'heart_locket', 'iron_helm'],
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
  // solve the arc from the height we want and the time we want to be up
  const half = d.jump.duration / 2;
  z.jumpVz = (2 * d.jump.height) / half;
  z.castT = 0;
  burst(z, z.px, z.py, 8, '#d8d2c4', { speed: 70, size: 2.2, life: 0.3, up: 2, grav: 40 });
  if (grantXp(st, 'footwork', 3)) levelBurst(z, 'footwork');
  return true;
}

function tickJump(z: Zone, st: GameState, dt: number): void {
  if (!z.airborne) return;
  const d = derived(st);
  const g = (4 * d.jump.height) / (d.jump.duration * d.jump.duration / 2) / 2 * 4;
  z.jumpVz -= g * dt;
  z.jumpZ += z.jumpVz * dt;
  if (z.jumpZ <= 0) {
    z.jumpZ = 0;
    z.jumpVz = 0;
    z.airborne = false;
    burst(z, z.px, z.py, 7, '#cdc6b6', { speed: 90, size: 2.2, life: 0.25, up: 2, grav: 40 });
    shakeIt(z, 1.2);
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

// ---------------------------------------------------------------------- tick

export function tickZone(
  z: Zone, st: GameState, dtRaw: number,
  input: { mx: number; my: number; attack: boolean },
  ev: ZoneEvents,
): void {
  // Hit stop: freeze the world for a few frames on impact. Most of the punch is here.
  let dt = dtRaw;
  if (z.hitstop > 0) {
    z.hitstop = Math.max(0, z.hitstop - dtRaw);
    dt = dtRaw * 0.06;
  }
  z.time += dtRaw;
  z.shake *= Math.pow(0.0016, dtRaw);
  z.killGlow = Math.max(0, z.killGlow - dtRaw * 2);

  const d = derived(st);
  const W = z.def.w * TS, H = z.def.h * TS;

  // ---- player movement
  let speed = d.speed;
  if (z.momentumT > 0) { z.momentumT -= dt; speed *= 1.35; }
  if (z.castT > 0) speed *= 0.34;

  if (z.dashT > 0) {
    z.dashT -= dt;
    const ds = d.speed * d.dash.speed;
    z.px = clamp(z.px + z.dashDirX * ds * dt, 20, W - 20);
    z.py = clamp(z.py + z.dashDirY * ds * dt, 20, H - 20);
    // afterimages, not a smear: one every few frames reads as speed
    const lastT = z.dashTrail[z.dashTrail.length - 1];
    if (!lastT || Math.hypot(lastT.x - z.px, lastT.y - z.py) > 16) {
      z.dashTrail.push({ x: z.px, y: z.py, t: 0 });
    }
    if (d.dash.bullRush) {
      for (const m of z.mobs) {
        if (m.state === 'dead' || m.stun > 0.3) continue;
        const md = MONSTERS[m.defId];
        if (Math.hypot(m.x - z.px, m.y - z.py) < md.size + 20) {
          damageMob(z, st, m, d.atk * 0.5 * famMult(md, d), false,
            Math.atan2(z.dashDirY, z.dashDirX), 340);
        }
      }
    }
  } else {
    const len = Math.hypot(input.mx, input.my);
    if (len > 0.01) {
      const nx = input.mx / len, ny = input.my / len;
      z.px = clamp(z.px + nx * speed * dt, 20, W - 20);
      z.py = clamp(z.py + ny * speed * dt, 20, H - 20);
      // footwork trains by covering ground
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
  tickJump(z, st, dt);

  if (z.castT > 0) {
    z.castT -= dt;
    if (z.castT <= 0) { z.castT = 0; releaseBolt(z, st); }
  } else if (input.attack) {
    playerAttack(z, st);
  }

  // ---- dash charges refill one at a time
  if (z.dashCharges < d.dash.charges) {
    z.dashRecharge += dt;
    if (z.dashRecharge >= d.dash.cooldown) {
      z.dashRecharge = 0;
      z.dashCharges++;
    }
  } else {
    z.dashRecharge = 0;
  }

  // ---- resources
  st.mana = Math.min(d.maxMana, st.mana + dt * d.manaRegen);
  if (z.staminaLock <= 0) {
    st.stamina = Math.min(d.maxStamina, st.stamina + dt * d.staminaRegen);
  }

  // ---- mobs
  for (const m of z.mobs) {
    m.hitFlash = Math.max(0, m.hitFlash - dt);
    m.stun = Math.max(0, m.stun - dt);

    // knockback decays fast; it is punctuation, not physics
    if (Math.abs(m.kbx) > 1 || Math.abs(m.kby) > 1) {
      m.x = clamp(m.x + m.kbx * dt, 16, W - 16);
      m.y = clamp(m.y + m.kby * dt, 16, H - 16);
      const decay = Math.pow(0.0009, dt);
      m.kbx *= decay; m.kby *= decay;
    }

    if (m.state === 'dead') { m.dead += dtRaw; continue; }
    if (m.stun > 0) continue;

    const md = MONSTERS[m.defId];

    // a leap in progress overrides everything else
    if (m.lungeT > 0) {
      m.lungeT -= dt;
      m.x = clamp(m.x + m.lungeX * dt, 16, W - 16);
      m.y = clamp(m.y + m.lungeY * dt, 16, H - 16);
      if (Math.hypot(z.px - m.x, z.py - m.y) < md.size + 22 && z.iframes <= 0 && !z.airborne) {
        hitPlayer(z, st, md, d, ev, 1);
        m.lungeT = 0;
      }
      continue;
    }
    const dx = z.px - m.x, dy = z.py - m.y;
    const dist = Math.hypot(dx, dy);

    if (!m.aggroed && dist < md.aggro) { m.aggroed = true; m.state = 'chase'; }
    if (m.aggroed && dist > md.aggro * 2.4) { m.aggroed = false; m.state = 'idle'; }

    m.cd = Math.max(0, m.cd - dt);

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
        m.x += (wdx / wd) * md.speed * 0.35 * dt;
        m.y += (wdy / wd) * md.speed * 0.35 * dt;
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
        // ranged mobs back away rather than let you stand on them
        m.x -= (dx / dist) * md.speed * 0.8 * dt;
        m.y -= (dy / dist) * md.speed * 0.8 * dt;
      } else if (dist > (md.ranged ? md.attackRange * 0.85 : md.attackRange)) {
        m.x += (dx / dist) * md.speed * dt;
        m.y += (dy / dist) * md.speed * dt;
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
        // a jump does not clear an arrow, only a dash does
        if (z.iframes > 0) {
          popup(z, z.px, z.py - 44, 'dodged', '#9fe0c0', 13, 0.8);
          if (grantXp(st, 'footwork', 14)) levelBurst(z, 'footwork');
        } else {
          const dmg = Math.max(1, p.dmg - d.armor * 0.55);
          st.hp -= dmg;
          z.hurtT = 0.24;
          z.castT = 0;
          shakeIt(z, 5);
          popup(z, z.px, z.py - 38, '-' + Math.round(dmg), '#ff6b6b', 15);
          burst(z, p.x, p.y, 8, p.color, { speed: 130, size: 3, life: 0.35, up: 10 });
          if (grantXp(st, 'vigor', Math.round(dmg * 0.6))) levelBurst(z, 'vigor');
          if (st.hp <= 0) { ev.onDeath('an arrow'); return; }
        }
        p.life = 0;
      }
      continue;
    }
    for (const m of z.mobs) {
      if (m.state === 'dead') continue;
      const md = MONSTERS[m.defId];
      if (Math.hypot(m.x - p.x, m.y - p.y) < md.size + 9) {
        damageMob(z, st, m, p.dmg * famMult(md, d), p.crit, Math.atan2(p.vy, p.vx), 140);
        burst(z, p.x, p.y, 10, p.color, { speed: 150, size: 3, life: 0.4, up: 0, grav: 0 });
        p.life = 0;
        break;
      }
    }
  }
  z.projectiles = z.projectiles.filter((p) => p.life > 0);

  for (const s of z.slashes) s.t += dtRaw;
  z.slashes = z.slashes.filter((s) => s.t < 0.24);

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
  if (z.particles.length > 500) z.particles.splice(0, z.particles.length - 500);

  // ---- drops: magnetise, then pick up
  for (const dr of z.drops) {
    dr.t += dtRaw;
    dr.vz -= 340 * dtRaw;
    dr.z = Math.max(0, dr.z + dr.vz * dtRaw);
    if (dr.z <= 0) dr.vz = 0;
    const dist = Math.hypot(dr.x - z.px, dr.y - z.py);
    if (dr.t > 0.45 && dist < 90) {
      const pull = 1 - dist / 90;
      dr.x += (z.px - dr.x) * pull * 8 * dtRaw;
      dr.y += (z.py - dr.y) * pull * 8 * dtRaw;
    }
    if (dr.t > 0.45 && dist < 26) {
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

  // ---- popups
  for (const p of z.popups) { p.t += dtRaw; p.y += p.vy * dtRaw; p.vy += 52 * dtRaw; }
  z.popups = z.popups.filter((p) => p.t < p.life);

  z.nearExit = Math.hypot(z.px - z.exitX, z.py - z.exitY) < 58;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
