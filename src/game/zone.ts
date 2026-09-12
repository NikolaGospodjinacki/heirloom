import { RNG, rng, uid } from './rng';
import { MONSTERS, MonsterDef, ZONES, ZoneDef } from './content';
import { TS } from '../render/view';
import type { Item } from './types';
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
}

export interface Node {
  uid: string;
  kind: 'tree' | 'rock';
  x: number; y: number;
  hp: number; maxHp: number;
  variant: number;
  hitFlash: number;
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
}

export interface Projectile {
  x: number; y: number; vx: number; vy: number;
  life: number; dmg: number; crit: boolean; color: string;
}

export interface Slash {
  x: number; y: number; ang: number; t: number; range: number;
}

export interface Zone {
  def: ZoneDef;
  mobs: Mob[];
  nodes: Node[];
  drops: Drop[];
  popups: Popup[];
  projectiles: Projectile[];
  slashes: Slash[];
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
}

export function buildZone(zoneId: string, st: GameState, bossTarget?: string): Zone {
  const def = ZONES[zoneId];
  const r = new RNG((Math.random() * 0xffffffff) >>> 0);
  const W = def.w * TS, H = def.h * TS;
  const tiles = new Uint8Array(def.w * def.h);
  for (let i = 0; i < tiles.length; i++) tiles[i] = r.chance(0.22) ? 1 : 0;

  const z: Zone = {
    def, mobs: [], nodes: [], drops: [], popups: [], projectiles: [], slashes: [],
    exitX: W * 0.5, exitY: H * 0.94,
    px: W * 0.5, py: H * 0.9,
    facing: -Math.PI / 2, atkCd: 0, swingT: 0, hurtT: 0, time: 0,
    bossSpawned: false, nearExit: false, tiles,
  };

  const farFromExit = (x: number, y: number, d = 260) =>
    Math.hypot(x - z.exitX, y - z.exitY) > d;

  for (let i = 0; i < def.trees; i++) {
    let x = 0, y = 0, tries = 0;
    do { x = r.float(TS, W - TS); y = r.float(TS, H - TS); tries++; } while (!farFromExit(x, y, 150) && tries < 20);
    z.nodes.push({ uid: uid(), kind: 'tree', x, y, hp: 34, maxHp: 34, variant: r.int(0, 2), hitFlash: 0, respawn: 0 });
  }
  for (let i = 0; i < def.rocks; i++) {
    let x = 0, y = 0, tries = 0;
    do { x = r.float(TS, W - TS); y = r.float(TS, H - TS); tries++; } while (!farFromExit(x, y, 150) && tries < 20);
    z.nodes.push({ uid: uid(), kind: 'rock', x, y, hp: 46, maxHp: 46, variant: r.int(0, 2), hitFlash: 0, respawn: 0 });
  }

  for (let i = 0; i < def.density; i++) spawnMob(z, r, pickSpawn(r, def));

  if (bossTarget && MONSTERS[bossTarget]) {
    const m = spawnMob(z, r, bossTarget);
    m.x = W * 0.5 + r.float(-200, 200);
    m.y = H * 0.18;
    z.bossSpawned = true;
  }
  void st;
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
  };
  z.mobs.push(m);
  return m;
}

export function popup(z: Zone, x: number, y: number, text: string, color: string): void {
  z.popups.push({ x, y, t: 0, text, color, vy: -34 });
}

function dropItem(z: Zone, x: number, y: number, item: Item, r: RNG): void {
  z.drops.push({
    uid: uid(), item,
    x: x + r.float(-14, 14), y: y + r.float(-14, 14),
    t: 0, vz: 90, z: 26,
  });
}

// ------------------------------------------------------------------- combat

export interface ZoneEvents {
  onDeath: (cause: string) => void;
  onExit: () => void;
}

export function playerAttack(z: Zone, st: GameState): void {
  if (z.atkCd > 0) return;
  const d = derived(st);
  z.atkCd = 1 / Math.max(0.25, d.attackSpeed);
  z.swingT = 0.18;

  if (d.attackStyle === 'bolt') {
    const cost = 4;
    if (st.mana < cost) {
      popup(z, z.px, z.py, 'no mana', '#7fa8e0');
      return;
    }
    st.mana -= cost;
    const crit = Math.random() < d.crit;
    const dmg = d.spellPower * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
    z.projectiles.push({
      x: z.px, y: z.py,
      vx: Math.cos(z.facing) * 420, vy: Math.sin(z.facing) * 420,
      life: d.range / 420 + 0.1, dmg, crit, color: '#9d7bff',
    });
    grantXp(st, 'sorcery', 2);
    return;
  }

  z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: d.range });
  const arc = d.attackStyle === 'thrust' ? 0.5 : 1.5;
  let hitSomething = false;

  for (const m of z.mobs) {
    if (m.state === 'dead') continue;
    const dx = m.x - z.px, dy = m.y - z.py;
    const dist = Math.hypot(dx, dy);
    const md = MONSTERS[m.defId];
    if (dist > d.range + md.size) continue;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(angDiff(ang, z.facing)) > arc) continue;
    const crit = Math.random() < d.crit;
    const dmg = d.atk * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
    damageMob(z, st, m, dmg, crit);
    hitSomething = true;
  }

  // Harvesting is the same swing, just against wood and stone.
  const wdef = d.weapon ? ITEM_DEFS[d.weapon.defId] : null;
  for (const n of z.nodes) {
    if (n.respawn > 0) continue;
    const dist = Math.hypot(n.x - z.px, n.y - z.py);
    if (dist > d.range + 20) continue;
    const ang = Math.atan2(n.y - z.py, n.x - z.px);
    if (Math.abs(angDiff(ang, z.facing)) > arc) continue;
    const isTree = n.kind === 'tree';
    const tool = isTree ? 'axe' : 'pickaxe';
    const bonus = wdef?.defId === tool ? 2.2 : 1;
    const skill = isTree ? skillLevel(st, 'woodcutting') : skillLevel(st, 'mining');
    const dmg = (6 + d.atk * 0.5 + skill * 1.2) * bonus;
    n.hp -= dmg;
    n.hitFlash = 0.12;
    hitSomething = true;
    grantXp(st, isTree ? 'woodcutting' : 'mining', 3);
    popup(z, n.x, n.y - 20, '-' + Math.round(dmg), '#d9cf9a');
    if (n.hp <= 0) harvestNode(z, st, n);
  }

  if (hitSomething) grantXp(st, 'blade', 2);
}

function harvestNode(z: Zone, st: GameState, n: Node): void {
  const table = n.kind === 'tree' ? z.def.treeLoot : z.def.rockLoot;
  const d = derived(st);
  let roll = Math.random() / Math.max(0.3, d.luckMult);
  let picked = table[0][0];
  for (const [id, w] of table) { roll -= w; if (roll <= 0) { picked = id; break; } }
  const skill = n.kind === 'tree' ? skillLevel(st, 'woodcutting') : skillLevel(st, 'mining');
  const qty = 1 + (Math.random() < skill * 0.03 ? 1 : 0);
  dropItem(z, n.x, n.y, makeItem(rng, picked, 'common', qty), rng);
  grantXp(st, n.kind === 'tree' ? 'woodcutting' : 'mining', 22);
  if (n.kind === 'tree') st.lifetime.treesFelled++; else st.lifetime.rocksMined++;
  n.respawn = 22 + Math.random() * 18;
  n.hp = n.maxHp;

  const q = st.active;
  if (q && (q.kind === 'chop' || q.kind === 'mine') && q.target === picked && q.zoneId === z.def.id) {
    q.have = Math.min(q.need, q.have + qty);
    popup(z, n.x, n.y - 36, q.have + '/' + q.need, '#f0d67a');
  }
}

export function damageMob(z: Zone, st: GameState, m: Mob, raw: number, crit: boolean): void {
  const md = MONSTERS[m.defId];
  const dmg = Math.max(1, raw - md.armor * 0.5);
  m.hp -= dmg;
  m.hitFlash = 0.15;
  m.aggroed = true;
  m.state = 'chase';
  popup(z, m.x, m.y - md.size - 8, (crit ? '!' : '') + Math.round(dmg), crit ? '#ffd166' : '#fff1e0');
  if (m.hp <= 0) killMob(z, st, m);
}

function killMob(z: Zone, st: GameState, m: Mob): void {
  const md = MONSTERS[m.defId];
  m.state = 'dead';
  m.dead = 0;
  st.lifetime.kills++;
  const d = derived(st);
  grantXp(st, md.skill, md.xp);
  grantXp(st, 'vigor', Math.round(md.xp * 0.25));

  const gold = Math.round((md.gold[0] + Math.random() * (md.gold[1] - md.gold[0])) * (st.hero.trait.id === 'cursed' ? 1.6 : 1));
  st.gold += gold;
  st.lifetime.goldEarned += gold;
  popup(z, m.x, m.y - md.size, '+' + gold + 'g', '#f5c542');

  for (const [defId, chance] of md.drops) {
    if (Math.random() < chance * d.luckMult) dropItem(z, m.x, m.y, makeItem(rng, defId, 'common', 1), rng);
  }
  if (Math.random() < md.gearChance * d.luckMult) {
    dropItem(z, m.x, m.y, makeItem(rng, gearForFamily(md)), rng);
  }

  const q = st.active;
  if (q && (q.kind === 'kill' || q.kind === 'boss') && q.target === m.defId && q.zoneId === z.def.id) {
    q.have = Math.min(q.need, q.have + 1);
    popup(z, m.x, m.y - md.size - 26, q.have + '/' + q.need, '#f0d67a');
    if (q.have >= q.need) pushLog(st, 'Objective complete. Report to the guild.', 'good');
  }
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

// --------------------------------------------------------------------- tick

export function tickZone(
  z: Zone, st: GameState, dt: number,
  input: { mx: number; my: number; attack: boolean },
  ev: ZoneEvents,
): void {
  z.time += dt;
  const d = derived(st);
  const W = z.def.w * TS, H = z.def.h * TS;

  // ---- player movement
  const len = Math.hypot(input.mx, input.my);
  if (len > 0.01) {
    const nx = input.mx / len, ny = input.my / len;
    z.px = clamp(z.px + nx * d.speed * dt, 20, W - 20);
    z.py = clamp(z.py + ny * d.speed * dt, 20, H - 20);
    z.facing = Math.atan2(ny, nx);
  }

  z.atkCd = Math.max(0, z.atkCd - dt);
  z.swingT = Math.max(0, z.swingT - dt);
  z.hurtT = Math.max(0, z.hurtT - dt);
  if (input.attack) playerAttack(z, st);

  // ---- regen
  st.mana = Math.min(d.maxMana, st.mana + dt * (1.6 + d.stats.int * 0.12));

  // ---- mobs
  for (const m of z.mobs) {
    m.hitFlash = Math.max(0, m.hitFlash - dt);
    if (m.state === 'dead') { m.dead += dt; continue; }
    const md = MONSTERS[m.defId];
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
          // land the blow if the player is still there
          if (Math.hypot(z.px - m.x, z.py - m.y) < md.attackRange + 14) {
            const raw = md.atk * (0.85 + Math.random() * 0.3);
            const dmg = Math.max(1, raw - d.armor * 0.55);
            st.hp -= dmg;
            z.hurtT = 0.22;
            popup(z, z.px, z.py - 30, '-' + Math.round(dmg), '#ff6b6b');
            grantXp(st, 'vigor', Math.round(dmg * 0.6));
            if (st.hp <= 0) { ev.onDeath(md.name); return; }
          }
        }
      } else if (dist > md.attackRange) {
        m.x += (dx / dist) * md.speed * dt;
        m.y += (dy / dist) * md.speed * dt;
      } else if (m.cd <= 0) {
        m.cd = md.attackCd;
        m.windup = 0.35;
      }
    }

    // crude separation so mobs do not stack into one pixel
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

  // ---- respawn pressure keeps the zone alive
  const alive = z.mobs.filter((m) => m.state !== 'dead').length;
  if (alive < z.def.density && Math.random() < dt * 0.35) {
    const m = spawnMob(z, rng, pickSpawn(rng, z.def));
    // never pop in on top of the player
    if (Math.hypot(m.x - z.px, m.y - z.py) < 420) { m.x = Math.random() * W; m.y = Math.random() * H; }
  }

  // ---- nodes
  for (const n of z.nodes) {
    n.hitFlash = Math.max(0, n.hitFlash - dt);
    if (n.respawn > 0) n.respawn -= dt;
  }

  // ---- projectiles
  for (const p of z.projectiles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    for (const m of z.mobs) {
      if (m.state === 'dead') continue;
      const md = MONSTERS[m.defId];
      if (Math.hypot(m.x - p.x, m.y - p.y) < md.size + 8) {
        damageMob(z, st, m, p.dmg, p.crit);
        p.life = 0;
        break;
      }
    }
  }
  z.projectiles = z.projectiles.filter((p) => p.life > 0);

  // ---- slashes
  for (const s of z.slashes) s.t += dt;
  z.slashes = z.slashes.filter((s) => s.t < 0.22);

  // ---- drops: hop, settle, then get vacuumed up
  for (const dr of z.drops) {
    dr.t += dt;
    dr.vz -= 320 * dt;
    dr.z = Math.max(0, dr.z + dr.vz * dt);
    if (dr.z <= 0) dr.vz = 0;
    if (dr.t > 0.4 && Math.hypot(dr.x - z.px, dr.y - z.py) < 34) {
      if (autoPlace(st.bag, dr.item)) {
        popup(z, z.px, z.py - 40, dr.item.name, '#cfe8b0');
        dr.t = -999;
        const q = st.active;
        if (q && (q.kind === 'chop' || q.kind === 'mine') && q.target === dr.item.defId) { /* counted at harvest */ }
      } else if (z.time % 1 < dt) {
        popup(z, z.px, z.py - 40, 'bag full', '#ff9c6b');
      }
    }
  }
  z.drops = z.drops.filter((dr) => dr.t > -900);

  // ---- popups
  for (const p of z.popups) { p.t += dt; p.y += p.vy * dt; p.vy += 42 * dt; }
  z.popups = z.popups.filter((p) => p.t < 1.1);

  // ---- exit: stepping on the pad only offers the road, it does not take it
  z.nearExit = Math.hypot(z.px - z.exitX, z.py - z.exitY) < 58;
  void ev;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
