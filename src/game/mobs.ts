import { RNG, rng, uid } from './rng';
import { MONSTERS, MonsterDef, ZoneDef } from './content';
import { GameState, derived } from './state';
import { TS, groundAt, isOpen, randomOpen, walkable } from './terrain';
import {
  Mob, Projectile, Zone, ZoneEvents,
  angDiff, burst, clamp, emit, mobBurst, mobCallout, mobRing, mobSlash, shakeIt, telegraph,
} from './zonecore';
import { hitPlayer, shotHitMe } from './combat';

type D = ReturnType<typeof derived>;

/** Anyone a monster might go after: you, or a friend in the same zone. */
export interface Target { id: string; x: number; y: number; z: number; airborne: boolean; local: boolean }

/** How far up or down a monster can reach to hit someone. */
const MOB_REACH_Z = 36;

export function heroTargets(z: Zone): Target[] {
  const out: Target[] = [];
  if (!z.over && !z.downed) {
    out.push({ id: z.net?.selfId ?? 'me', x: z.px, y: z.py, z: z.groundZ + z.jumpZ, airborne: z.airborne, local: true });
  }
  const now = performance.now();
  for (const r of z.remotes) {
    if (r.downed || now - r.seen > 5000) continue;
    out.push({ id: r.id, x: r.x, y: r.y, z: r.gz + r.jz, airborne: r.airborne, local: false });
  }
  return out;
}

function nearest(ts: Target[], x: number, y: number, current: string): { t: Target; dist: number } | null {
  let best: Target | null = null, bd = Infinity;
  for (const t of ts) {
    let dd = Math.hypot(t.x - x, t.y - y);
    // stick with whoever it is already chasing unless someone is a lot closer
    if (t.id === current) dd *= 0.75;
    if (dd < bd) { bd = dd; best = t; }
  }
  return best ? { t: best, dist: Math.hypot(best.x - x, best.y - y) } : null;
}

function strike(
  z: Zone, st: GameState, t: Target, md: MonsterDef, d: D, ev: ZoneEvents,
  scale: number, ignoreJump = false,
): void {
  if (t.local) hitPlayer(z, st, md, d, ev, scale, ignoreJump);
  else z.net?.hurt(t.id, { defId: md.id, scale, ignoreJump, raw: 0, cause: md.name });
}

// -------------------------------------------------------------------- spawn

export function pickSpawn(r: RNG, def: ZoneDef): string {
  let roll = r.next();
  for (const [id, w] of def.spawns) { roll -= w; if (roll <= 0) return id; }
  return def.spawns[0][0];
}

export function spawnMob(
  z: Zone, r: RNG, defId: string, atX?: number, atY?: number, elite: string | null = null,
): Mob {
  const d = MONSTERS[defId];
  let x = atX ?? 0, y = atY ?? 0;
  if (atX === undefined || atY === undefined) {
    const p = randomOpen(z.terrain, r, (px, py) => Math.hypot(px - z.exitX, py - z.exitY) > 420);
    if (p) { x = p[0]; y = p[1]; } else { x = z.exitX; y = z.exitY - 700; }
  }
  // a party of four should not make a boar a speed bump
  const party = 1 + 0.55 * Math.max(0, z.partySize - 1);
  const hp = Math.round(d.hp * party * (elite ? 4 : 1));
  const gz = Math.max(0, Math.min(9000, groundAt(z.terrain, x, y)));
  const m: Mob = {
    uid: uid(), defId, x, y, hp, maxHp: hp, cd: r.float(0, 1),
    windup: 0, state: 'idle', wanderT: r.float(0, 3), wx: x, wy: y,
    hitFlash: 0, facing: r.float(0, Math.PI * 2), dead: 0, aggroed: false,
    kbx: 0, kby: 0, stun: 0, lungeT: 0, lungeX: 0, lungeY: 0,
    atkIdx: -1, atkCds: (d.attacks ?? []).map(() => r.float(0, 2)),
    chargeT: 0, chargeX: 0, chargeY: 0, slowT: 0, gz,
    elite, atkMul: elite ? 1.6 : 1, target: '', nx: x, ny: y, ngz: gz,
  };
  z.mobs.push(m);
  return m;
}

/** Monsters walk up one step at a time, drop down anything, and never walk into a hole. */
function moveMob(z: Zone, m: Mob, nx: number, ny: number): void {
  const W = z.def.w * TS, H = z.def.h * TS;
  nx = clamp(nx, 16, W - 16);
  ny = clamp(ny, 16, H - 16);
  const t = z.terrain;
  if (walkable(t, m.gz, nx, ny)) { m.x = nx; m.y = ny; }
  else if (walkable(t, m.gz, nx, m.y)) { m.x = nx; }
  else if (walkable(t, m.gz, m.x, ny)) { m.y = ny; }
  else return;
  m.gz = groundAt(t, m.x, m.y);
}

function wander(z: Zone, m: Mob, spd: number, dt: number): void {
  const W = z.def.w * TS, H = z.def.h * TS;
  m.wanderT -= dt;
  if (m.wanderT <= 0) {
    m.wanderT = 1.5 + Math.random() * 3;
    m.wx = clamp(m.x + (Math.random() - 0.5) * 220, 20, W - 20);
    m.wy = clamp(m.y + (Math.random() - 0.5) * 220, 20, H - 20);
  }
  const wdx = m.wx - m.x, wdy = m.wy - m.y;
  const wd = Math.hypot(wdx, wdy);
  if (wd > 6) {
    moveMob(z, m, m.x + (wdx / wd) * spd * 0.35 * dt, m.y + (wdy / wd) * spd * 0.35 * dt);
    m.facing = Math.atan2(wdy, wdx);
  }
}

// --------------------------------------------------------------------- tick

/** The monsters' half of a frame. Only the copy that owns the fight runs this. */
export function tickMobs(z: Zone, st: GameState, dt: number, dtRaw: number, ev: ZoneEvents): void {
  const d = derived(st);
  const heroes = heroTargets(z);

  for (const m of z.mobs) {
    m.hitFlash = Math.max(0, m.hitFlash - dt);
    m.stun = Math.max(0, m.stun - dt);
    m.slowT = Math.max(0, m.slowT - dt);

    if (Math.abs(m.kbx) > 1 || Math.abs(m.kby) > 1) {
      moveMob(z, m, m.x + m.kbx * dt, m.y + m.kby * dt);
      const decay = Math.pow(0.0009, dt);
      m.kbx *= decay; m.kby *= decay;
    }

    if (m.state === 'dead') { m.dead += dtRaw; continue; }
    if (m.stun > 0) continue;

    const md = MONSTERS[m.defId];
    const spd = md.speed * (m.slowT > 0 ? 0.5 : 1);
    m.cd = Math.max(0, m.cd - dt);
    for (let i = 0; i < m.atkCds.length; i++) m.atkCds[i] = Math.max(0, m.atkCds[i] - dt);

    const near = nearest(heroes, m.x, m.y, m.target);
    if (!near) {
      if (md.family !== 'boss') {
        m.aggroed = false;
        m.state = 'idle';
        wander(z, m, spd, dt);
      }
      continue;
    }
    const tgt = near.t;
    m.target = tgt.id;
    const dx = tgt.x - m.x, dy = tgt.y - m.y;
    const dist = Math.max(0.001, near.dist);
    const dz = Math.abs(tgt.z - m.gz);

    if (!m.aggroed && dist < md.aggro) { m.aggroed = true; m.state = 'chase'; }
    if (m.aggroed && dist > md.aggro * 2.6 && md.family !== 'boss') { m.aggroed = false; m.state = 'idle'; }

    // ------------------------------------------------------------ boss brain
    if (md.attacks && m.aggroed) {
      m.facing = Math.atan2(dy, dx);
      if (m.chargeT > 0) {
        m.chargeT -= dt;
        moveMob(z, m, m.x + m.chargeX * dt, m.y + m.chargeY * dt);
        burst(z, m.x, m.y, 2, md.accent, { speed: 60, size: 3, life: 0.3, up: 8, grav: 60, base: m.gz });
        const a = md.attacks[m.atkIdx];
        for (const h of heroes) {
          if (Math.hypot(h.x - m.x, h.y - m.y) >= md.size + 24 || Math.abs(h.z - m.gz) > MOB_REACH_Z + 20) continue;
          strike(z, st, h, md, d, ev, (a?.dmg ?? 1) * m.atkMul, true);
          m.chargeT = 0;
          shakeIt(z, 10);
        }
        if (z.over) return;
        continue;
      }
      if (m.windup > 0) {
        m.windup -= dt;
        if (m.windup <= 0) {
          fireBossAttack(z, st, m, md, d, ev, heroes, tgt);
          if (z.over) return;
        }
        continue;
      }
      if (m.cd <= 0) {
        const pick = pickBossAttack(m, md, dist);
        if (pick >= 0) { startBossAttack(z, m, md, pick); continue; }
      }
      if (dist > md.attackRange * 0.8) {
        moveMob(z, m, m.x + (dx / dist) * spd * dt, m.y + (dy / dist) * spd * dt);
      }
      continue;
    }

    // ------------------------------------------------------- ordinary brain
    if (m.lungeT > 0) {
      m.lungeT -= dt;
      moveMob(z, m, m.x + m.lungeX * dt, m.y + m.lungeY * dt);
      for (const h of heroes) {
        if (h.airborne || Math.abs(h.z - m.gz) > MOB_REACH_Z) continue;
        if (Math.hypot(h.x - m.x, h.y - m.y) >= md.size + 22) continue;
        strike(z, st, h, md, d, ev, m.atkMul);
        m.lungeT = 0;
        break;
      }
      if (z.over) return;
      continue;
    }

    if (m.state === 'idle') {
      wander(z, m, spd, dt);
    } else {
      m.facing = Math.atan2(dy, dx);
      if (m.windup > 0) {
        m.windup -= dt;
        if (m.windup <= 0) {
          if (md.ranged) {
            const sp = md.ranged.speed;
            const ang = Math.atan2(dy, dx);
            z.projectiles.push({
              x: m.x, y: m.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: (md.attackRange + 80) / sp,
              dmg: md.atk * m.atkMul * (0.85 + Math.random() * 0.3),
              crit: false, color: md.ranged.color, hostile: true, size: md.ranged.size,
              from: md.name, z: m.gz + md.size,
            });
          } else if (md.lunge && dist > md.attackRange + 30 && dist < md.lunge.range) {
            m.lungeT = 0.3;
            m.lungeX = (dx / dist) * md.lunge.speed;
            m.lungeY = (dy / dist) * md.lunge.speed;
            burst(z, m.x, m.y, 6, md.accent, { speed: 80, size: 2.4, life: 0.3, up: 6, base: m.gz });
          } else if (dist < md.attackRange + 14 && dz < MOB_REACH_Z) {
            strike(z, st, tgt, md, d, ev, m.atkMul);
            if (z.over) return;
          }
        }
      } else if (md.ranged && dist < md.attackRange * 0.45) {
        moveMob(z, m, m.x - (dx / dist) * spd * 0.8 * dt, m.y - (dy / dist) * spd * 0.8 * dt);
      } else if (dist > (md.ranged ? md.attackRange * 0.85 : md.attackRange)) {
        moveMob(z, m, m.x + (dx / dist) * spd * dt, m.y + (dy / dist) * spd * dt);
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
      const want = md.size + MONSTERS[o.defId].size;
      if (od > 0.01 && od < want) {
        moveMob(z, m, m.x + (ox / od) * (want - od) * 0.5 * dt * 8, m.y + (oy / od) * (want - od) * 0.5 * dt * 8);
      }
    }
  }
  z.mobs = z.mobs.filter((m) => m.state !== 'dead' || m.dead < 1.2);

  const alive = z.mobs.filter((m) => m.state !== 'dead').length;
  if (alive < z.def.density && Math.random() < dt * 0.35) {
    const p = randomOpen(z.terrain, rng, (x, y) =>
      heroes.every((h) => Math.hypot(h.x - x, h.y - y) > 520) && Math.hypot(x - z.exitX, y - z.exitY) > 420);
    if (p) spawnMob(z, rng, pickSpawn(rng, z.def), p[0], p[1]);
  }
}

/** Guests: monsters glide toward wherever the host last said they were. */
export function tickMobsGuest(z: Zone, dt: number, dtRaw: number): void {
  const k = Math.min(1, dtRaw * 14);
  for (const m of z.mobs) {
    m.hitFlash = Math.max(0, m.hitFlash - dt);
    if (m.state === 'dead') { m.dead += dtRaw; continue; }
    const dx = m.nx - m.x, dy = m.ny - m.y;
    if (dx * dx + dy * dy > 180 * 180) { m.x = m.nx; m.y = m.ny; }
    else { m.x += dx * k; m.y += dy * k; }
    m.gz += (m.ngz - m.gz) * k;
    m.windup = Math.max(0, m.windup - dt);
  }
  z.mobs = z.mobs.filter((m) => m.state !== 'dead' || m.dead < 1.2);
}

/** Host: did a hostile shot hit you, or a friend? */
export function hostileShotHits(z: Zone, st: GameState, p: Projectile, ev: ZoneEvents): boolean {
  const pz = p.z ?? 0;
  if (!z.over && !z.downed && Math.hypot(z.px - p.x, z.py - p.y) < 15 + p.size
    && Math.abs(z.groundZ + z.jumpZ + 18 - pz) < 60) {
    shotHitMe(z, st, p.dmg, p.color, ev, p.from ?? 'a stray shot');
    return true;
  }
  const now = performance.now();
  for (const r of z.remotes) {
    if (r.downed || now - r.seen > 5000) continue;
    if (Math.hypot(r.x - p.x, r.y - p.y) >= 15 + p.size || Math.abs(r.gz + r.jz + 18 - pz) >= 60) continue;
    z.net?.hurt(r.id, { defId: '', scale: 1, ignoreJump: false, raw: p.dmg, cause: p.from ?? 'a stray shot' });
    burst(z, p.x, p.y, 8, p.color, { speed: 130, size: 3, life: 0.35, up: 10, base: r.gz });
    return true;
  }
  return false;
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
  const gz = m.gz;

  if (a.kind === 'slam') {
    telegraph(z, { kind: 'circle', x: m.x, y: m.y, r: a.radius ?? 120, ang: 0, arc: 0, len: 0, wide: 0, total: a.windup, color: a.color, z: gz });
  } else if (a.kind === 'cone') {
    telegraph(z, { kind: 'cone', x: m.x, y: m.y, r: a.range, ang, arc: a.arc ?? 0.6, len: 0, wide: 0, total: a.windup, color: a.color, z: gz });
  } else if (a.kind === 'arc') {
    telegraph(z, { kind: 'cone', x: m.x, y: m.y, r: a.range, ang, arc: a.arc ?? 1.2, len: 0, wide: 0, total: a.windup, color: a.color, z: gz });
  } else if (a.kind === 'charge') {
    telegraph(z, {
      kind: 'line', x: m.x, y: m.y, r: 0, ang: m.facing, arc: 0,
      len: (a.chargeSpeed ?? 500) * (a.chargeTime ?? 0.45), wide: md.size * 2,
      total: a.windup, color: a.color, z: gz,
    });
  }
  mobCallout(z, m.x, m.y - md.size * 2.2, gz + md.size * 2.6, a.name, a.color, 14, a.windup + 0.3);
}

function fireBossAttack(
  z: Zone, st: GameState, m: Mob, md: MonsterDef, d: D, ev: ZoneEvents,
  heroes: Target[], tgt: Target,
): void {
  const a = md.attacks![m.atkIdx];
  if (!a) return;
  const ang = a.behind ? m.facing + Math.PI : m.facing;

  switch (a.kind) {
    case 'arc':
    case 'cone': {
      mobSlash(z, m.x, m.y, m.gz, ang, a.range, a.arc ?? 1.2, a.color);
      mobBurst(z, m.x + Math.cos(ang) * a.range * 0.5, m.y + Math.sin(ang) * a.range * 0.5, m.gz, 14, a.color, 200, 3.4);
      shakeIt(z, 6);
      for (const h of heroes) {
        const hx = h.x - m.x, hy = h.y - m.y;
        if (Math.hypot(hx, hy) > a.range + 12) continue;
        if (Math.abs(angDiff(Math.atan2(hy, hx), ang)) > (a.arc ?? 1.2)) continue;
        if (Math.abs(h.z - m.gz) > 70) continue;
        strike(z, st, h, md, d, ev, a.dmg * m.atkMul);
      }
      break;
    }
    case 'slam': {
      const r = a.radius ?? 130;
      mobRing(z, m.x, m.y, m.gz, r, a.color);
      mobBurst(z, m.x, m.y, m.gz, 40, a.color, 300, 4);
      shakeIt(z, 12);
      emit(z, { k: 'shake', a: 8 });
      z.hitstop = Math.max(z.hitstop, 0.06);
      for (const h of heroes) {
        if (Math.hypot(h.x - m.x, h.y - m.y) > r || Math.abs(h.z - m.gz) > 80) continue;
        strike(z, st, h, md, d, ev, a.dmg * m.atkMul, true);
      }
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
      const base = Math.atan2(tgt.y - m.y, tgt.x - m.x);
      for (let i = 0; i < shots; i++) {
        const off = shots === 1 ? 0 : (i / (shots - 1) - 0.5) * spread * 2;
        const sp = a.projSpeed ?? 300;
        z.projectiles.push({
          x: m.x, y: m.y, vx: Math.cos(base + off) * sp, vy: Math.sin(base + off) * sp,
          life: (a.range + 100) / sp, dmg: md.atk * a.dmg * m.atkMul, crit: false,
          color: a.color, hostile: true, size: 8, from: md.name, z: m.gz + md.size,
        });
      }
      shakeIt(z, 4);
      break;
    }
    case 'summon': {
      const n = (a.spawnCount ?? 2) + Math.floor(Math.max(0, z.partySize - 1) / 2);
      for (let i = 0; i < n; i++) {
        const ang2 = (i / n) * Math.PI * 2;
        let sx = m.x + Math.cos(ang2) * 90;
        let sy = m.y + Math.sin(ang2) * 90;
        if (!isOpen(z.terrain, sx, sy)) { sx = m.x; sy = m.y; }
        const spawned = spawnMob(z, rng, a.spawn ?? 'wolf', sx, sy);
        spawned.aggroed = true;
        spawned.state = 'chase';
        mobBurst(z, sx, sy, spawned.gz, 18, a.color, 160, 3);
      }
      mobCallout(z, m.x, m.y - md.size * 2, m.gz + md.size * 2.8, a.name + '!', a.color, 16, 1.4);
      shakeIt(z, 6);
      break;
    }
  }
}
