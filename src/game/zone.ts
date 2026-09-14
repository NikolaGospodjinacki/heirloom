import { RNG, uid } from './rng';
import { MONSTERS, ZONES } from './content';
import { autoPlace } from './backpack';
import { ITEM_DEFS, slotOf } from './items';
import { GameState, derived, grantXp, pushLog } from './state';
import {
  STEP, T_PIT, T_WATER, TS, Terrain, generateTerrain, groundAt, isOpen, randomOpen, tileIndex,
} from './terrain';
import {
  CritterKind, FloraKind, Mob, Zone, ZoneEvents,
  burst, clamp, popup, shakeIt, standZ,
} from './zonecore';
import {
  damageMob, downOrDie, famMult, levelBurst, meleeHit, playerAtk, playerAttack, releaseBolt,
} from './combat';
import { hostileShotHits, pickSpawn, spawnMob, tickMobs, tickMobsGuest } from './mobs';

export * from './zonecore';
export {
  REACH_Z, abilityReady, applyHurt, castAbility, damageMob, mobDeathFx, nearestCache, nodeDoneForMe,
  openCache, remoteHarvest, remoteHitMob, remoteKill, reviveMe,
} from './combat';
export { spawnMob } from './mobs';

// -------------------------------------------------------------------- build

export interface BuildOpts {
  /** bosses to wake: your contract, or a friend's */
  bosses?: string[];
  /** named brutes off bounty notices */
  elites?: { defId: string; name: string }[];
  partySize?: number;
  seed?: number;
  /** lost things to hide for a recovery contract */
  caches?: number;
}

const FLORA_BY_STYLE: Record<string, FloraKind[]> = {
  meadow: ['grass', 'flower', 'fern', 'stump', 'grass'],
  woods: ['fern', 'mushroom', 'grass', 'stump', 'flower'],
  fen: ['reed', 'mushroom', 'grass', 'fern', 'reed'],
  barrows: ['bone', 'crystal', 'mushroom', 'grass'],
  mountain: ['grass', 'crystal', 'stump', 'flower', 'grass'],
  ashen: ['bone', 'crystal', 'stump'],
};

function blankZone(
  def: Zone['def'], terrain: Terrain, tiles: Uint8Array, seed: number, dashCharges: number,
): Zone {
  const exitX = (terrain.exitTx + 0.5) * TS;
  const startY = (def.h - 5.5) * TS;
  return {
    def, terrain, key: uid(), seed,
    mobs: [], nodes: [], drops: [], popups: [], projectiles: [], slashes: [],
    particles: [], telegraphs: [], impacts: [], flora: [], critters: [], motes: [], caches: [],
    exitX, exitY: (def.h - 1.4) * TS,
    px: exitX, py: startY,
    facing: -Math.PI / 2, atkCd: 0, swingT: 0, hurtT: 0, time: 0,
    bossSpawned: false, bossUid: null, nearExit: false, tiles,
    jumpZ: 0, jumpVz: 0, airborne: false, groundZ: 0,
    safeX: exitX, safeY: startY,
    dashLock: 0, staminaLock: 0, castT: 0, castMax: 0,
    dashT: 0, dashDirX: 0, dashDirY: 0,
    dashCharges, dashRecharge: 0,
    iframes: 0, momentumT: 0, dashTrail: [],
    abilityCd: {}, buffAtk: 0, buffAtkT: 0, shield: 0, spinT: 0, spinTick: 0,
    shake: 0, hitstop: 0, killGlow: 0,
    auth: true, net: null, remotes: [], partySize: 1,
    downed: false, bleedT: 0, lastCause: '', over: false, fxOut: [], netProj: [],
  };
}

export function buildZone(zoneId: string, st: GameState, opts: BuildOpts = {}): Zone {
  const def = ZONES[zoneId] ?? ZONES.meadow;
  const seed = opts.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  const r = new RNG(seed);
  const terrain = generateTerrain(def.style, def.w, def.h, r);
  const tiles = new Uint8Array(def.w * def.h);
  for (let i = 0; i < tiles.length; i++) tiles[i] = r.chance(0.22) ? 1 : 0;

  const z = blankZone(def, terrain, tiles, seed, derived(st).dash.charges);
  z.partySize = Math.max(1, opts.partySize ?? 1);
  const W = def.w * TS, H = def.h * TS;
  const away = (x: number, y: number, dd: number) => Math.hypot(x - z.exitX, y - z.exitY) > dd;

  for (let i = 0; i < def.trees + def.rocks; i++) {
    const tree = i < def.trees;
    const p = randomOpen(terrain, r, (x, y) =>
      away(x, y, 240) && !(tree && def.style === 'mountain' && groundAt(terrain, x, y) > STEP * 12));
    if (!p) continue;
    z.nodes.push({
      uid: 'n' + i, kind: tree ? 'tree' : 'rock', x: p[0], y: p[1],
      hp: tree ? 34 : 46, maxHp: tree ? 34 : 46,
      variant: r.int(0, 2), hitFlash: 0, shakeT: 0, respawn: 0, gz: groundAt(terrain, p[0], p[1]),
    });
  }

  const kinds = FLORA_BY_STYLE[def.style] ?? FLORA_BY_STYLE.meadow;
  for (let i = 0; i < def.flora; i++) {
    const x = r.float(8, W - 8), y = r.float(8, H - 8);
    const idx = tileIndex(terrain, x, y);
    if (idx < 0 || terrain.ter[idx] !== 0) continue;
    z.flora.push({ kind: r.pick(kinds), x, y, variant: r.int(0, 3), gz: terrain.hts[idx] * STEP });
  }

  for (let i = 0; i < def.density; i++) spawnMob(z, r, pickSpawn(r, def));

  const bosses = (opts.bosses ?? []).filter((id) => !!MONSTERS[id]);
  bosses.forEach((id, i) => {
    const a = terrain.arena;
    let x = a ? (a.tx + 0.5) * TS : W * 0.5;
    let y = a ? (a.ty + 0.5) * TS : H * 0.2;
    x += (i - (bosses.length - 1) / 2) * 150;
    if (!isOpen(terrain, x, y)) {
      const p = randomOpen(terrain, r, (_px, py) => py < H * 0.4, 200);
      if (p) { x = p[0]; y = p[1]; }
    }
    const m = spawnMob(z, r, id, x, y);
    if (!z.bossUid) z.bossUid = m.uid;
    z.bossSpawned = true;
  });

  for (const e of opts.elites ?? []) {
    if (!MONSTERS[e.defId]) continue;
    const p = randomOpen(terrain, r, (x, y) => away(x, y, 800), 200);
    if (p) spawnMob(z, r, e.defId, p[0], p[1], e.name);
  }

  dressLocal(z, r);
  addCaches(z, r, opts.caches ?? 0);
  return z;
}

/** Butterflies, birds and drifting motes: every player's copy has its own. */
function dressLocal(z: Zone, r: RNG): void {
  const def = z.def;
  const W = def.w * TS, H = def.h * TS;
  const critterKind: CritterKind =
    def.ambience === 'fireflies' ? 'firefly'
      : def.style === 'woods' ? 'rabbit' : 'butterfly';
  for (let i = 0; i < def.critters; i++) {
    const p = randomOpen(z.terrain, r);
    if (!p) continue;
    z.critters.push({
      kind: i % 4 === 3 ? 'bird' : critterKind,
      x: p[0], y: p[1], z: 0, vx: 0, vy: 0, t: r.float(0, 5), flee: 0, hx: p[0], hy: p[1],
    });
  }
  for (let i = 0; i < 90; i++) {
    z.motes.push({
      x: r.float(0, W), y: r.float(0, H), z: r.float(6, 70),
      vx: r.float(-14, 14), vy: r.float(-10, 10),
      t: r.float(0, 8), life: r.float(5, 11), s: r.float(1.2, 2.8),
    });
  }
}

export function addCaches(z: Zone, r: RNG, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = randomOpen(z.terrain, r, (x, y) =>
      Math.hypot(x - z.exitX, y - z.exitY) > 700
      && z.caches.every((c) => Math.hypot(c.x - x, c.y - y) > 480), 300);
    if (p) z.caches.push({ uid: uid(), x: p[0], y: p[1], gz: groundAt(z.terrain, p[0], p[1]), found: false });
  }
}

// ------------------------------------------------------------- co-op init

const FLORA_KINDS: FloraKind[] = ['grass', 'flower', 'mushroom', 'stump', 'reed', 'fern', 'crystal', 'bone'];

/** Everything a guest needs to stand in the host's copy of a zone. */
export interface ZoneInit {
  key: string; seed: number; defId: string; partySize: number;
  w: number; h: number;
  hts: number[]; ter: number[]; border: number[]; reach: number[];
  exitTx: number; arena: Terrain['arena'];
  tiles: number[];
  /** uid, kind (0 tree, 1 rock), x, y, variant, gz */
  nodes: [string, number, number, number, number, number][];
  /** kind, x, y, variant, gz, repeated */
  flora: number[];
  mobs: Mob[];
  bossUid: string | null;
}

export function zoneInit(z: Zone): ZoneInit {
  const t = z.terrain;
  const flora: number[] = [];
  for (const f of z.flora) flora.push(FLORA_KINDS.indexOf(f.kind), Math.round(f.x), Math.round(f.y), f.variant, f.gz);
  return {
    key: z.key, seed: z.seed, defId: z.def.id, partySize: z.partySize,
    w: t.w, h: t.h,
    hts: Array.from(t.hts), ter: Array.from(t.ter), border: Array.from(t.border), reach: Array.from(t.reach),
    exitTx: t.exitTx, arena: t.arena, tiles: Array.from(z.tiles),
    nodes: z.nodes.map((n) => [n.uid, n.kind === 'tree' ? 0 : 1, Math.round(n.x), Math.round(n.y), n.variant, n.gz]),
    flora,
    mobs: z.mobs.filter((m) => m.state !== 'dead').map((m) => ({ ...m, atkCds: [...m.atkCds] })),
    bossUid: z.bossUid,
  };
}

export function zoneFromInit(init: ZoneInit, st: GameState, caches = 0): Zone {
  const def = ZONES[init.defId] ?? ZONES.meadow;
  const terrain: Terrain = {
    w: init.w, h: init.h,
    hts: Uint8Array.from(init.hts), ter: Uint8Array.from(init.ter),
    border: Uint8Array.from(init.border), reach: Uint8Array.from(init.reach),
    style: def.style, exitTx: init.exitTx, arena: init.arena,
  };
  const z = blankZone(def, terrain, Uint8Array.from(init.tiles), init.seed, derived(st).dash.charges);
  z.key = init.key;
  z.auth = false;
  z.partySize = init.partySize;
  for (const [nuid, kind, x, y, variant, gz] of init.nodes) {
    const hp = kind === 0 ? 34 : 46;
    z.nodes.push({
      uid: nuid, kind: kind === 0 ? 'tree' : 'rock', x, y, hp, maxHp: hp,
      variant, hitFlash: 0, shakeT: 0, respawn: 0, gz,
    });
  }
  for (let i = 0; i + 4 < init.flora.length; i += 5) {
    z.flora.push({
      kind: FLORA_KINDS[init.flora[i]] ?? 'grass', x: init.flora[i + 1], y: init.flora[i + 2],
      variant: init.flora[i + 3], gz: init.flora[i + 4],
    });
  }
  for (const m of init.mobs) z.mobs.push({ ...m, nx: m.x, ny: m.y, ngz: m.gz });
  z.bossUid = init.bossUid;
  z.bossSpawned = !!init.bossUid;
  const r = new RNG((Math.random() * 0xffffffff) >>> 0);
  dressLocal(z, r);
  addCaches(z, r, caches);
  return z;
}

// ---------------------------------------------------------------------- jump

export function tryJump(z: Zone, st: GameState): boolean {
  const d = derived(st);
  if (z.airborne || z.dashT > 0 || z.downed) return false;
  if (!st.techniques.includes('jump')) return false;
  if (st.stamina < d.jump.staminaCost) {
    popup(z, z.px, z.py - 50, 'winded', '#8fa8c0', 11, 0.6, z.groundZ + 56);
    return false;
  }
  st.stamina -= d.jump.staminaCost;
  z.staminaLock = Math.max(z.staminaLock, 0.4);
  z.airborne = true;
  z.jumpVz = (2 * d.jump.height) / (d.jump.duration / 2);
  z.castT = 0;
  burst(z, z.px, z.py, 8, '#d8d2c4', { speed: 70, size: 2.2, life: 0.3, up: 2, grav: 40, base: z.groundZ });
  if (grantXp(st, 'footwork', 3)) levelBurst(z, 'footwork');
  return true;
}

function tickJump(z: Zone, st: GameState, dt: number, ev: ZoneEvents): void {
  if (!z.airborne) return;
  const d = derived(st);
  const g = (2 * d.jump.height) / (d.jump.duration / 2) / (d.jump.duration / 2);
  z.jumpVz -= g * dt;
  z.jumpZ += z.jumpVz * dt;
  if (z.jumpZ > 0) return;
  z.jumpZ = 0;
  z.jumpVz = 0;
  z.airborne = false;
  const i = tileIndex(z.terrain, z.px, z.py);
  const kind = i >= 0 ? z.terrain.ter[i] : 0;
  if (kind === T_PIT) {
    // you did not make it
    z.px = z.safeX; z.py = z.safeY;
    z.groundZ = standZ(z, z.px, z.py);
    const dmg = Math.max(4, d.maxHp * 0.08);
    st.hp -= dmg;
    z.hurtT = 0.4;
    shakeIt(z, 10);
    popup(z, z.px, z.py - 40, '-' + Math.round(dmg), '#ff6b6b', 16, 1.1, z.groundZ + 44);
    pushLog(st, 'You fell.', 'bad');
    if (st.hp <= 0) downOrDie(z, st, ev, 'a long drop');
  } else if (kind === T_WATER) {
    burst(z, z.px, z.py, 22, '#9fd4e8', { speed: 140, size: 3, life: 0.5, up: 4, grav: 200, base: z.groundZ });
    popup(z, z.px, z.py - 40, 'splash', '#9fd4e8', 13, 0.9, z.groundZ + 40);
    z.px = z.safeX; z.py = z.safeY;
    z.groundZ = standZ(z, z.px, z.py);
  } else {
    burst(z, z.px, z.py, 7, '#cdc6b6', { speed: 90, size: 2.2, life: 0.25, up: 2, grav: 40, base: z.groundZ });
    shakeIt(z, 1.2);
  }
}

// ---------------------------------------------------------------------- dash

export function tryDash(z: Zone, st: GameState, mx: number, my: number): boolean {
  const d = derived(st);
  if (z.dashT > 0 || z.dashLock > 0 || z.downed) return false;
  if (z.dashCharges <= 0) {
    popup(z, z.px, z.py - 50, 'winded', '#8fa8c0', 11, 0.6, z.groundZ + 56);
    return false;
  }
  if (st.stamina < d.dash.staminaCost) {
    popup(z, z.px, z.py - 50, 'no stamina', '#8fa8c0', 11, 0.6, z.groundZ + 56);
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

  burst(z, z.px, z.py, 12, '#cfd8e8', { speed: 110, size: 2.6, life: 0.35, up: 8, grav: 60, base: z.groundZ });
  shakeIt(z, d.dash.blink ? 5 : 2);
  if (grantXp(st, 'footwork', 6)) levelBurst(z, 'footwork');
  return true;
}

// ------------------------------------------------------------------ movement

export interface StepState { groundZ: number; jumpZ: number; airborne: boolean }
export type StepResult =
  | { ok: false }
  | { ok: true; groundZ: number; jumpZ: number; airborne: boolean; fell: boolean };

/**
 * Can you put a foot at (x, y) from this state? One step up or down you just
 * walk. Taller ledges need the top of a jump to clear the lip. You can always
 * walk off an edge, including into a ravine. Water stops you unless you are in
 * the air. Pure, so it can be reasoned about and tested.
 */
export function resolveStep(t: Terrain, x: number, y: number, s: StepState): StepResult {
  const i = tileIndex(t, x, y);
  if (i < 0) return { ok: false };
  const kind = t.ter[i];
  if (kind === T_WATER && !s.airborne) return { ok: false };
  const height = s.groundZ + s.jumpZ;
  const tz = groundAt(t, x, y);
  if (tz > s.groundZ) {
    const rise = tz - s.groundZ;
    if (!s.airborne) {
      if (rise <= STEP + 0.5 && s.jumpZ <= 0) return { ok: true, groundZ: tz, jumpZ: 0, airborne: false, fell: false };
      return { ok: false };
    }
    if (height < tz - 3) return { ok: false };
    return { ok: true, groundZ: tz, jumpZ: Math.max(0, height - tz), airborne: true, fell: false };
  }
  if (tz < s.groundZ) {
    const drop = s.groundZ - tz;
    if (!s.airborne && drop <= STEP + 0.5 && kind !== T_PIT) {
      return { ok: true, groundZ: tz, jumpZ: 0, airborne: false, fell: false };
    }
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
  const cx = clamp(nx, 20, W - 20);
  if (apply(resolveStep(z.terrain, cx, z.py, z))) z.px = cx;
  const cy = clamp(ny, 20, H - 20);
  if (apply(resolveStep(z.terrain, z.px, cy, z))) z.py = cy;
  const i = tileIndex(z.terrain, z.px, z.py);
  if (!z.airborne && i >= 0 && z.terrain.ter[i] !== T_PIT && z.terrain.ter[i] !== T_WATER) {
    z.safeX = z.px; z.safeY = z.py;
  }
}

// ---------------------------------------------------------------------- tick

export function tickZone(
  z: Zone, st: GameState, dtRaw: number,
  input: { mx: number; my: number; attack: boolean },
  ev: ZoneEvents,
): void {
  if (z.over) return;
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

  if (z.downed) {
    z.bleedT -= dtRaw;
    if (z.bleedT <= 0) {
      z.downed = false;
      z.over = true;
      ev.onDeath(z.lastCause || 'bleeding out');
      return;
    }
  }

  // ---- player movement
  let speed = d.speed;
  if (z.momentumT > 0) { z.momentumT -= dt; speed *= 1.35; }
  if (z.castT > 0) speed *= 0.34;
  if (z.spinT > 0) speed *= 0.6;
  if (z.downed) speed *= 0.18;

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
      if (!z.downed && Math.random() < dt * 0.9) grantXp(st, 'footwork', 1);
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
  if (z.over) return;

  if (!z.downed) {
    // ---- whirlwind keeps hitting while you walk
    if (z.spinT > 0) {
      z.spinT -= dt;
      z.spinTick -= dt;
      if (z.spinTick <= 0) {
        z.spinTick = 0.34;
        z.slashes.push({ x: z.px, y: z.py, ang: z.time * 14, t: 0, range: d.range * 1.5, arc: Math.PI, color: '#e06a5a', life: 0.3, z: z.groundZ });
        meleeHit(z, st, d, Math.PI * 2, d.range * 1.5, playerAtk(z, d), 0.85, 200);
        burst(z, z.px, z.py - 12, 10, '#e06a5a', { speed: 200, size: 2.8, life: 0.3, up: 14, base: z.groundZ });
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
  }

  // ---- monsters
  if (z.auth) tickMobs(z, st, dt, dtRaw, ev);
  else tickMobsGuest(z, dt, dtRaw);
  if (z.over) return;

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
        if (Math.abs(m.gz - (im.z ?? m.gz)) > 70) continue;
        damageMob(z, st, m, im.dmg * famMult(md, d), Math.random() < d.crit,
          Math.atan2(m.y - im.y, m.x - im.x), im.knock);
      }
    }
    burst(z, im.x, im.y, 34, im.color, { speed: 300, size: 4, life: 0.6, up: 14, grav: 200, base: im.z ?? 0 });
    shakeIt(z, 9);
    z.hitstop = Math.max(z.hitstop, 0.06);
  }
  z.impacts = z.impacts.filter((im) => im.t > 0);

  // ---- projectiles
  for (const p of z.projectiles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (Math.random() < dt * 40) {
      z.particles.push({
        x: p.x, y: p.y, z: p.z ?? 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 0.25, color: p.color, size: 3, grav: 0, g: -9999,
      });
    }
    // shots stop against the face of a cliff
    if (groundAt(z.terrain, p.x, p.y) > (p.z ?? 0) + 4) {
      p.life = 0;
      burst(z, p.x, p.y, 5, p.color, { speed: 90, size: 2.4, life: 0.3, up: 0, grav: 0, base: p.z ?? 0 });
      continue;
    }
    if (p.hostile) {
      if (z.auth && hostileShotHits(z, st, p, ev)) p.life = 0;
      if (z.over) return;
      continue;
    }
    for (const m of z.mobs) {
      if (m.state === 'dead') continue;
      if (p.hit?.has(m.uid)) continue;
      const md = MONSTERS[m.defId];
      if (Math.abs(m.gz + md.size - (p.z ?? 0)) > 70) continue;
      if (Math.hypot(m.x - p.x, m.y - p.y) < md.size + 9) {
        damageMob(z, st, m, p.dmg * famMult(md, d), p.crit, Math.atan2(p.vy, p.vx), p.pierce ? 90 : 140, 0, p.slow ?? 0);
        burst(z, p.x, p.y, 10, p.color, { speed: 150, size: 3, life: 0.4, up: 0, grav: 0, base: p.z ?? 0 });
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
    p.z = Math.max(p.g ?? 0, p.z + p.vz * dtRaw);
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
      mo.z = z.groundZ + 6 + Math.random() * 70;
    }
  }

  // ---- drops
  for (const dr of z.drops) {
    dr.t += dtRaw;
    dr.vz -= 340 * dtRaw;
    dr.z = Math.max(0, dr.z + dr.vz * dtRaw);
    if (dr.z <= 0) dr.vz = 0;
    if (z.downed || Math.abs(dr.gz - z.groundZ) > 50) continue;
    const dist = Math.hypot(dr.x - z.px, dr.y - z.py);
    if (dr.t > 0.45 && dist < 100) {
      const pull = 1 - dist / 100;
      dr.x += (z.px - dr.x) * pull * 8 * dtRaw;
      dr.y += (z.py - dr.y) * pull * 8 * dtRaw;
    }
    if (dr.t > 0.45 && dist < 28) {
      // an empty slot fills itself, so you see the change on the character
      const slot = slotOf(dr.item);
      if (slot && !st.equipped[slot]) {
        st.equipped[slot] = dr.item;
        popup(z, z.px, z.py - 54, 'equipped ' + dr.item.name, '#ffe28a', 13, 1.3, z.groundZ + 64);
        burst(z, z.px, z.py - 24, 16, '#ffe28a', { speed: 120, size: 3, life: 0.6, up: 22, grav: 90, base: z.groundZ });
        pushLog(st, 'Equipped ' + dr.item.name + '.', 'good');
        dr.t = -999;
      } else if (autoPlace(st.bag, dr.item)) {
        popup(z, z.px, z.py - 54, dr.item.name, '#cfe8b0', 12, 1, z.groundZ + 60);
        burst(z, z.px, z.py - 14, 5, ITEM_DEFS[dr.item.defId].color,
          { speed: 60, size: 2.4, life: 0.3, up: 12, base: z.groundZ });
        dr.t = -999;
      } else if (z.time % 1.2 < dtRaw) {
        popup(z, z.px, z.py - 54, 'pack is full', '#ff9c6b', 12, 1, z.groundZ + 60);
      }
    }
  }
  z.drops = z.drops.filter((dr) => dr.t > -900);

  for (const p of z.popups) { p.t += dtRaw; p.y += p.vy * dtRaw; p.vy += 52 * dtRaw; }
  z.popups = z.popups.filter((p) => p.t < p.life);

  z.nearExit = !z.downed && z.py > (z.def.h - 2.7) * TS && Math.abs(z.px - z.exitX) < TS * 1.7;
}

export function bossMob(z: Zone): Mob | null {
  if (!z.bossUid) return null;
  return z.mobs.find((m) => m.uid === z.bossUid && m.state !== 'dead') ?? null;
}
