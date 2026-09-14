import { RNG, rng } from './rng';
import { MONSTERS, MonsterDef } from './content';
import type { Item, SkillKey } from './types';
import { makeItem } from './items';
import { GameState, derived, grantXp, pushLog, skillLevel } from './state';
import { abilitiesFor, AbilityDef, AbilityKey } from './abilities';
import { uid } from './rng';
import {
  Cache, HurtMsg, Mob, Node, Zone, ZoneEvents,
  angDiff, burst, popup, shakeIt, standZ, telegraph, xpPopup,
} from './zonecore';
import { SKILL_COLOR, SKILL_NAMES } from './types';

type D = ReturnType<typeof derived>;

/** How far apart in height you and a monster can be and still trade blows. */
export const REACH_Z = 40;
/** Everyone this close to a kill shares in it. */
export const CREDIT_RANGE = 1100;

export function famMult(md: MonsterDef, d: D): number {
  return md.family === 'beast' ? d.beastMult : d.slayMult;
}

export function playerAtk(z: Zone, d: D): number {
  return d.atk * (1 + (z.buffAtkT > 0 ? z.buffAtk : 0));
}

function heroZ(z: Zone): number {
  return z.groundZ + z.jumpZ;
}

// ------------------------------------------------------------------ harvest

const TOOL_REACH = 52;

export function nodeInFront(z: Zone, arc: number): Node | null {
  let best: Node | null = null;
  let bd = Infinity;
  for (const n of z.nodes) {
    if (n.respawn > 0) continue;
    if (Math.abs(n.gz - z.groundZ) > REACH_Z) continue;
    const dist = Math.hypot(n.x - z.px, n.y - z.py);
    if (dist > TOOL_REACH) continue;
    if (Math.abs(angDiff(Math.atan2(n.y - z.py, n.x - z.px), z.facing)) > arc) continue;
    if (dist < bd) { bd = dist; best = n; }
  }
  return best;
}

function resetNode(n: Node): void {
  n.respawn = 22 + Math.random() * 18;
  n.hp = n.maxHp;
}

export function harvestSwing(z: Zone, st: GameState, n: Node): void {
  const d = derived(st);
  const isTree = n.kind === 'tree';
  const power = isTree ? d.chopPower : d.minePower;
  const skillMult = isTree ? d.chopMult : d.mineMult;
  const bite = (power > 0 ? 9 * power : 2.2) * skillMult;
  n.hitFlash = 0.1;
  n.shakeT = 0.18;
  z.swingT = 0.22;
  z.hitstop = Math.max(z.hitstop, 0.02);
  shakeIt(z, power > 0 ? 1.8 : 0.8);
  burst(z, n.x, n.y - 18, power > 0 ? 6 : 2, isTree ? '#6b4a2a' : '#9a9ea6',
    { speed: 90, size: 2.6, life: 0.4, up: 16, base: n.gz });
  if (power <= 0 && z.time % 3 < 0.05) {
    popup(z, z.px, z.py - 56, 'you need a tool for this', '#e0a25a', 11, 1.2, heroZ(z) + 50);
  }
  const key: SkillKey = isTree ? 'woodcutting' : 'mining';
  if (grantXp(st, key, 4)) levelBurst(z, key);
  xpPopup(z, key, 4);
  if (!z.auth) {
    n.hp = Math.max(1, n.hp - bite);
    z.net?.harvest(n.uid, bite);
    return;
  }
  n.hp -= bite;
  if (n.hp <= 0) {
    resetNode(n);
    harvestReward(z, st, n);
  }
}

/** Host: another player's axe or pick took a bite out of something. */
export function remoteHarvest(z: Zone, nodeUid: string, bite: number, byId: string): void {
  const n = z.nodes.find((x) => x.uid === nodeUid);
  if (!n || n.respawn > 0) return;
  n.hp -= bite;
  n.hitFlash = 0.1;
  n.shakeT = 0.18;
  if (n.hp > 0) return;
  resetNode(n);
  burst(z, n.x, n.y - 24, 14, n.kind === 'tree' ? '#4d7c3c' : '#8a8d96',
    { speed: 150, size: 3.2, life: 0.7, up: 26, base: n.gz });
  z.net?.nodeDone(n.uid, byId);
}

/** Guest: the host says our last swing finished it. */
export function nodeDoneForMe(z: Zone, st: GameState, nodeUid: string): void {
  const n = z.nodes.find((x) => x.uid === nodeUid);
  if (!n) return;
  resetNode(n);
  harvestReward(z, st, n);
}

export function harvestReward(z: Zone, st: GameState, n: Node): void {
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
    { speed: 150, size: 3.2, life: 0.7, up: 26, base: n.gz });
  shakeIt(z, 4);
  z.hitstop = Math.max(z.hitstop, 0.05);

  const q = st.active;
  if (q && (q.kind === 'chop' || q.kind === 'mine') && q.target === picked && q.zoneId === z.def.id) {
    q.have = Math.min(q.need, q.have + qty);
    popup(z, n.x, n.y - 40, q.have + '/' + q.need, '#f0d67a', 14, 1.1, n.gz + 60);
  }
}

// ------------------------------------------------------------------ attacks

export function playerAttack(z: Zone, st: GameState): void {
  if (z.atkCd > 0 || z.dashT > 0 || z.castT > 0 || z.downed) return;
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
      popup(z, z.px, z.py - 30, 'out of mana', '#7fa8e0', 12, 0.8, heroZ(z) + 46);
      z.atkCd = 0.3;
      return;
    }
    z.castT = d.castTime;
    z.castMax = d.castTime;
    return;
  }

  z.swingT = 0.2;
  z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: d.range, arc, z: heroZ(z) });
  meleeHit(z, st, d, arc, d.range, playerAtk(z, d), z.airborne && d.jump.pounce ? 1.6 : 1, 190);
}

export function meleeHit(
  z: Zone, st: GameState, d: D,
  arc: number, range: number, base: number, mult: number, knock: number,
): number {
  let hits = 0;
  const hz = heroZ(z);
  for (const m of z.mobs) {
    if (m.state === 'dead') continue;
    if (Math.abs(m.gz - hz) > REACH_Z) continue;
    const dx = m.x - z.px, dy = m.y - z.py;
    const dist = Math.hypot(dx, dy);
    const md = MONSTERS[m.defId];
    if (dist > range + md.size) continue;
    if (arc < Math.PI && Math.abs(angDiff(Math.atan2(dy, dx), z.facing)) > arc) continue;
    const crit = Math.random() < d.crit;
    const dmg = base * famMult(md, d) * mult * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
    damageMob(z, st, m, dmg, crit, Math.atan2(dy, dx), knock, mult > 1.5 ? 0.5 : 0);
    hits++;
  }
  if (hits > 0) {
    if (grantXp(st, 'blade', 3)) levelBurst(z, 'blade');
    xpPopup(z, 'blade', 3);
  }
  return hits;
}

export function releaseBolt(z: Zone, st: GameState): void {
  const d = derived(st);
  if (st.mana < d.boltCost) return;
  st.mana -= d.boltCost;
  const crit = Math.random() < d.crit;
  const dmg = d.spellPower * (1 + (z.buffAtkT > 0 ? z.buffAtk : 0)) * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1);
  const SPEED = 330;
  z.projectiles.push({
    x: z.px, y: z.py,
    vx: Math.cos(z.facing) * SPEED, vy: Math.sin(z.facing) * SPEED,
    life: d.range / SPEED + 0.05, dmg, crit, color: '#9d7bff',
    hostile: false, size: 7, z: heroZ(z) + 20,
  });
  burst(z, z.px + Math.cos(z.facing) * 18, z.py + Math.sin(z.facing) * 18, 7, '#9d7bff',
    { speed: 70, size: 2.5, life: 0.3, up: 18, base: z.groundZ });
  shakeIt(z, 1.4);
  if (grantXp(st, 'sorcery', 4)) levelBurst(z, 'sorcery');
  xpPopup(z, 'sorcery', 4);
}

export function levelBurst(z: Zone, k: SkillKey): void {
  burst(z, z.px, z.py - 20, 26, SKILL_COLOR[k], { speed: 150, size: 3.4, life: 0.8, up: 20, grav: 120, base: z.groundZ });
  popup(z, z.px, z.py - 62, SKILL_NAMES[k].toUpperCase() + ' UP', SKILL_COLOR[k], 17, 1.6, heroZ(z) + 70);
  shakeIt(z, 3);
}

// ---------------------------------------------------------------- abilities

export function abilityReady(z: Zone, st: GameState, a: AbilityDef): boolean {
  if ((z.abilityCd[a.id] ?? 0) > 0) return false;
  const have = a.resource === 'mana' ? st.mana : st.stamina;
  return have >= a.cost;
}

export function castAbility(
  z: Zone, st: GameState, key: AbilityKey, aimX: number, aimY: number,
): boolean {
  const a = abilitiesFor(st.hero.classId).find((x) => x.key === key);
  if (!a || z.downed) return false;
  if (z.dashT > 0 || z.spinT > 0) return false;
  const hz = heroZ(z);
  if ((z.abilityCd[a.id] ?? 0) > 0) {
    popup(z, z.px, z.py - 54, a.name + ' not ready', '#8fa8c0', 11, 0.6, hz + 60);
    return false;
  }
  const have = a.resource === 'mana' ? st.mana : st.stamina;
  if (have < a.cost) {
    popup(z, z.px, z.py - 54, 'not enough ' + a.resource, '#8fa8c0', 11, 0.7, hz + 60);
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
      z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: d.range * 1.7, arc: 1.15, color: '#e0956a', life: 0.3, z: hz });
      meleeHit(z, st, d, 1.15, d.range * 1.7, playerAtk(z, d), 1.6, 320);
      burst(z, z.px + Math.cos(z.facing) * 40, z.py + Math.sin(z.facing) * 40, 16, '#e0956a',
        { speed: 220, size: 3.2, life: 0.4, up: 18, base: z.groundZ });
      shakeIt(z, 5);
      break;
    }
    case 'bash': {
      const dx = Math.cos(z.facing), dy = Math.sin(z.facing);
      z.dashT = 0.16;
      z.dashDirX = dx; z.dashDirY = dy;
      z.iframes = Math.max(z.iframes, 0.16);
      z.slashes.push({ x: z.px, y: z.py, ang: z.facing, t: 0, range: 70, arc: 0.7, color: '#c8b06a', life: 0.28, z: hz });
      // resolve after the shove so it connects at the far end
      z.impacts.push({
        x: z.px + dx * 66, y: z.py + dy * 66, r: 62, t: 0.14,
        dmg: playerAtk(z, d) * 1.2, fromPlayer: true, color: '#c8b06a', knock: 420, z: z.groundZ,
      });
      shakeIt(z, 6);
      break;
    }
    case 'rally': {
      st.hp = Math.min(d.maxHp, st.hp + d.maxHp * 0.2);
      z.buffAtk = 0.35;
      z.buffAtkT = 6;
      popup(z, z.px, z.py - 56, 'RALLY', '#7fc27a', 18, 1.4, hz + 64);
      burst(z, z.px, z.py - 16, 30, '#7fc27a', { speed: 160, size: 3.4, life: 0.9, up: 20, grav: 90, base: z.groundZ });
      shakeIt(z, 4);
      break;
    }
    case 'whirlwind': {
      z.spinT = 1.5;
      z.spinTick = 0;
      popup(z, z.px, z.py - 56, 'WHIRLWIND', '#e06a5a', 18, 1.4, hz + 64);
      shakeIt(z, 7);
      break;
    }

    // ---------------------------------------------------------- wizard
    case 'lance': {
      const SPEED = 620;
      z.projectiles.push({
        x: z.px, y: z.py,
        vx: Math.cos(z.facing) * SPEED, vy: Math.sin(z.facing) * SPEED,
        life: 0.75, dmg: d.spellPower * 1.5 * (1 + (z.buffAtkT > 0 ? z.buffAtk : 0)),
        crit: false, color: '#7fc2e0', hostile: false, size: 9,
        pierce: true, slow: 2.5, hit: new Set<string>(), z: hz + 20,
      });
      burst(z, z.px, z.py - 18, 12, '#7fc2e0', { speed: 90, size: 2.6, life: 0.35, up: 18, base: z.groundZ });
      shakeIt(z, 3);
      break;
    }
    case 'nova': {
      z.impacts.push({
        x: z.px, y: z.py, r: 118, t: 0.05,
        dmg: d.spellPower * 1.3, fromPlayer: true, color: '#b48fe8', knock: 380, z: z.groundZ,
      });
      telegraph(z, { kind: 'circle', x: z.px, y: z.py, r: 118, ang: 0, arc: 0, len: 0, wide: 0, total: 0.16, color: '#b48fe8', z: z.groundZ });
      burst(z, z.px, z.py - 14, 40, '#b48fe8', { speed: 320, size: 3.4, life: 0.5, up: 16, grav: 120, base: z.groundZ });
      shakeIt(z, 7);
      break;
    }
    case 'font': {
      st.mana = Math.min(d.maxMana, st.mana + d.maxMana * 0.45);
      z.shield = Math.max(z.shield, d.maxHp * 0.25);
      popup(z, z.px, z.py - 56, 'WARDED', '#7fa8e0', 17, 1.4, hz + 64);
      burst(z, z.px, z.py - 16, 26, '#7fa8e0', { speed: 130, size: 3, life: 0.9, up: 22, grav: 60, base: z.groundZ });
      break;
    }
    case 'meteor': {
      const tx = aimX, ty = aimY;
      const gz = Math.max(0, standZ(z, tx, ty));
      telegraph(z, { kind: 'circle', x: tx, y: ty, r: 130, ang: 0, arc: 0, len: 0, wide: 0, total: 1.15, color: '#e0803f', z: gz });
      z.impacts.push({
        x: tx, y: ty, r: 130, t: 1.15,
        dmg: d.spellPower * 3.2, fromPlayer: true, color: '#e0803f', knock: 300, z: gz,
      });
      popup(z, z.px, z.py - 56, 'METEOR', '#e0803f', 18, 1.4, hz + 64);
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

export function damageMob(
  z: Zone, st: GameState, m: Mob, raw: number, crit: boolean,
  fromAngle: number, knockback: number, stun = 0, slow = 0,
): void {
  const md = MONSTERS[m.defId];
  const dmg = Math.max(1, raw - md.armor * 0.5);
  m.hitFlash = 0.16;
  popup(z, m.x, m.y - md.size - 10, Math.round(dmg) + (crit ? '!' : ''),
    crit ? '#ffd166' : '#fff1e0', crit ? 20 : 13 + Math.min(8, dmg / 8), 1.1, m.gz + md.size * 2.4);
  burst(z, m.x, m.y - md.size * 0.7, crit ? 12 : 6, crit ? '#ffd166' : '#ffb4a2',
    { speed: crit ? 200 : 130, size: crit ? 3.4 : 2.6, life: 0.35, up: md.size, base: m.gz });
  z.hitstop = Math.max(z.hitstop, crit ? 0.085 : 0.045);
  shakeIt(z, crit ? 6 : 2.6);

  if (!z.auth) {
    // the host decides whether it dies; we only show the blow landing
    m.hp = Math.max(1, m.hp - dmg);
    z.net?.hitMob(m.uid, raw, crit, fromAngle, knockback, stun, slow);
    return;
  }
  applyMobHit(m, md, dmg, crit, fromAngle, knockback, stun, slow);
  if (m.hp <= 0) killMob(z, st, m);
}

function applyMobHit(
  m: Mob, md: MonsterDef, dmg: number, crit: boolean,
  ang: number, knock: number, stun: number, slow: number,
): void {
  m.hp -= dmg;
  m.aggroed = true;
  if (m.state === 'idle') m.state = 'chase';
  const kbScale = md.family === 'boss' ? 0.16 : m.elite ? 0.45 : 1;
  m.kbx += Math.cos(ang) * knock * kbScale;
  m.kby += Math.sin(ang) * knock * kbScale;
  if (md.family !== 'boss') m.stun = Math.max(m.stun, crit ? 0.22 : 0.1);
  if (stun > 0) m.stun = Math.max(m.stun, stun);
  if (slow > 0) m.slowT = Math.max(m.slowT, slow);
}

/** Host: a blow from another player's copy of the fight. */
export function remoteHitMob(
  z: Zone, st: GameState, mobUid: string, raw: number, crit: boolean,
  ang: number, knock: number, stun: number, slow: number,
): void {
  const m = z.mobs.find((x) => x.uid === mobUid && x.state !== 'dead');
  if (!m) return;
  const md = MONSTERS[m.defId];
  const dmg = Math.max(1, raw - md.armor * 0.5);
  m.hitFlash = 0.16;
  popup(z, m.x, m.y - md.size - 10, String(Math.round(dmg)), '#d8cbb8', 11, 0.9, m.gz + md.size * 2.4);
  burst(z, m.x, m.y - md.size * 0.7, 4, '#ffb4a2', { speed: 110, size: 2.4, life: 0.3, up: md.size, base: m.gz });
  applyMobHit(m, md, dmg, crit, ang, knock, stun, slow);
  if (m.hp <= 0) killMob(z, st, m);
}

/** The body falling over: no rewards, just the show. */
export function mobDeathFx(z: Zone, m: Mob): void {
  const md = MONSTERS[m.defId];
  m.state = 'dead';
  m.dead = 0;
  const boss = md.family === 'boss';
  burst(z, m.x, m.y - md.size * 0.6, boss ? 80 : m.elite ? 40 : 20, md.color,
    { speed: boss ? 340 : 190, size: 4, life: 0.9, up: md.size, base: m.gz });
  z.hitstop = Math.max(z.hitstop, boss ? 0.35 : 0.09);
  shakeIt(z, boss ? 20 : m.elite ? 10 : 5);
  z.killGlow = boss ? 0.6 : 0.25;
  if (boss) {
    popup(z, m.x, m.y - md.size * 2, md.name.toUpperCase() + ' FALLS', '#ffd166', 24, 3, m.gz + md.size * 3);
  } else if (m.elite) {
    popup(z, m.x, m.y - md.size * 2, m.elite.toUpperCase() + ' IS DEAD', '#ffd166', 19, 2.4, m.gz + md.size * 3);
  }
}

/** Host or solo: something died. Everyone close enough gets paid. */
export function killMob(z: Zone, st: GameState, m: Mob): void {
  mobDeathFx(z, m);
  z.net?.killed(m);
  const near = !z.net || Math.hypot(m.x - z.px, m.y - z.py) < CREDIT_RANGE;
  if (near && !z.over) rewardKill(z, st, m.defId, m.x, m.y, m.gz, m.elite);
}

/** Guest: the host says a monster died. */
export function remoteKill(
  z: Zone, st: GameState, mobUid: string, defId: string,
  x: number, y: number, gz: number, elite: string | null,
): void {
  const m = z.mobs.find((mm) => mm.uid === mobUid);
  if (m && m.state !== 'dead') mobDeathFx(z, m);
  if (!z.over && Math.hypot(x - z.px, y - z.py) < CREDIT_RANGE) rewardKill(z, st, defId, x, y, gz, elite);
}

export function rewardKill(
  z: Zone, st: GameState, defId: string, x: number, y: number, gz: number, elite: string | null,
): void {
  const md = MONSTERS[defId];
  if (!md) return;
  st.lifetime.kills++;
  const d = derived(st);
  const boss = md.family === 'boss';
  const big = elite ? 5 : 1;

  const skill: SkillKey = md.skill;
  if (grantXp(st, skill, md.xp * big)) levelBurst(z, skill);
  xpPopup(z, skill, md.xp * big);
  const vig = Math.round(md.xp * big * 0.25);
  if (grantXp(st, 'vigor', vig)) levelBurst(z, 'vigor');

  const gold = Math.round(
    (md.gold[0] + Math.random() * (md.gold[1] - md.gold[0])) * big *
    d.goldMult * (st.hero.trait.id === 'cursed' ? 1.6 : 1),
  );
  st.gold += gold;
  st.lifetime.goldEarned += gold;
  popup(z, x + 18, y - md.size, '+' + gold + 'g', '#f5c542', 13, 1.1, gz + md.size * 2);

  if (boss) {
    pushLog(st, md.name + ' is dead. ' + (md.title ?? ''), 'good');
    st.lifetime.bosses++;
    st.trophies[defId] = (st.trophies[defId] ?? 0) + 1;
  } else if (elite) {
    pushLog(st, elite + ' will not be terrorising anyone any more.', 'good');
  }

  const beastBonus = md.family === 'beast' ? skillLevel(st, 'hunting') * 0.03 : 0;
  for (const [id, chance] of md.drops) {
    if (Math.random() < chance * d.luckMult + beastBonus) {
      dropItem(z, x, y, makeItem(rng, id, 'common', 1), rng);
    }
  }
  if (elite || Math.random() < md.gearChance * d.luckMult) {
    const it = makeItem(rng, gearForFamily(md), boss ? bossRarity() : elite ? eliteRarity() : undefined);
    dropItem(z, x, y, it, rng);
    if (it.rarity !== 'common' && it.rarity !== 'uncommon') {
      popup(z, x, y - md.size - 30, it.rarity.toUpperCase() + '!', '#ffd166', 16, 1.8, gz + md.size * 2.6);
      shakeIt(z, 7);
    }
  }

  const q = st.active;
  if (!q || q.zoneId !== z.def.id) return;
  const counts =
    ((q.kind === 'kill' || q.kind === 'boss') && q.target === defId)
    || (q.kind === 'bounty' && q.target === defId && !!elite && elite === q.eliteName);
  if (!counts || q.have >= q.need) return;
  q.have = Math.min(q.need, q.have + 1);
  popup(z, x, y - md.size - 32, q.have + '/' + q.need, '#f0d67a', 15, 1.2, gz + md.size * 3);
  if (q.have >= q.need) pushLog(st, 'Objective complete. Report to the guild.', 'good');
}

function bossRarity(): 'rare' | 'epic' | 'legendary' {
  const r = Math.random();
  return r < 0.12 ? 'legendary' : r < 0.5 ? 'epic' : 'rare';
}

function eliteRarity(): 'uncommon' | 'rare' | 'epic' {
  const r = Math.random();
  return r < 0.1 ? 'epic' : r < 0.6 ? 'rare' : 'uncommon';
}

export function dropItem(z: Zone, x: number, y: number, item: Item, r: RNG): void {
  let dx = x + r.float(-16, 16), dy = y + r.float(-16, 16);
  let gz = standZ(z, dx, dy);
  if (gz < 0 || gz > 9000) { dx = z.px; dy = z.py; gz = z.groundZ; }
  z.drops.push({ uid: uid(), item, x: dx, y: dy, t: 0, vz: 110, z: 26, gz });
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

// --------------------------------------------------------- getting hurt

/** Every way a monster can land a blow on you funnels through here. */
export function hitPlayer(
  z: Zone, st: GameState, md: MonsterDef, d: D,
  ev: ZoneEvents, scale: number, ignoreJump = false,
): void {
  if (z.downed || z.over) return;
  const hz = heroZ(z);
  if (z.iframes > 0) {
    popup(z, z.px, z.py - 44, 'dodged', '#9fe0c0', 13, 0.8, hz + 50);
    if (grantXp(st, 'footwork', 12)) levelBurst(z, 'footwork');
    xpPopup(z, 'footwork', 12);
    return;
  }
  if (z.airborne && !md.ranged && !ignoreJump) {
    popup(z, z.px, z.py - 44, 'over it', '#9fe0c0', 13, 0.8, hz + 50);
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
    popup(z, z.px + 20, z.py - 50, '-' + Math.round(absorbed), '#7fa8e0', 13, 0.8, hz + 50);
  }
  if (dmg <= 0) return;
  st.hp -= dmg;
  z.hurtT = 0.26;
  z.castT = 0;
  shakeIt(z, 7);
  z.hitstop = Math.max(z.hitstop, 0.06);
  popup(z, z.px, z.py - 38, '-' + Math.round(dmg), '#ff6b6b', 16, 1.1, hz + 44);
  burst(z, z.px, z.py - 18, 10, '#c8352c', { speed: 150, size: 3, life: 0.4, up: 16, base: z.groundZ });
  if (grantXp(st, 'vigor', Math.round(dmg * 0.6))) levelBurst(z, 'vigor');
  if (st.hp <= 0) downOrDie(z, st, ev, md.name);
}

/** A thrown rock, a bolt, a feather: damage already rolled, armour still counts. */
export function shotHitMe(
  z: Zone, st: GameState, raw: number, color: string, ev: ZoneEvents, cause: string,
): void {
  if (z.downed || z.over) return;
  const d = derived(st);
  const hz = heroZ(z);
  if (z.iframes > 0) {
    popup(z, z.px, z.py - 44, 'dodged', '#9fe0c0', 13, 0.8, hz + 50);
    if (grantXp(st, 'footwork', 14)) levelBurst(z, 'footwork');
    return;
  }
  let dmg = Math.max(1, raw - d.armor * 0.55);
  if (z.shield > 0) {
    const abs = Math.min(z.shield, dmg);
    z.shield -= abs; dmg -= abs;
  }
  if (dmg <= 0) return;
  st.hp -= dmg;
  z.hurtT = 0.24;
  z.castT = 0;
  shakeIt(z, 5);
  popup(z, z.px, z.py - 38, '-' + Math.round(dmg), '#ff6b6b', 15, 1.1, hz + 44);
  burst(z, z.px, z.py, 8, color, { speed: 130, size: 3, life: 0.35, up: 10, base: z.groundZ });
  if (grantXp(st, 'vigor', Math.round(dmg * 0.6))) levelBurst(z, 'vigor');
  if (st.hp <= 0) downOrDie(z, st, ev, cause);
}

/** Guest: the host's monsters hit us. We still get to dodge it on our side. */
export function applyHurt(z: Zone, st: GameState, h: HurtMsg, ev: ZoneEvents): void {
  if (h.raw > 0) {
    shotHitMe(z, st, h.raw, '#ffb4a2', ev, h.cause);
    return;
  }
  const md = MONSTERS[h.defId] ?? MONSTERS.slime;
  hitPlayer(z, st, md, derived(st), ev, h.scale, h.ignoreJump);
}

/**
 * Alone, hitting zero is death. In a party you go down instead, and a friend
 * has half a minute to get you back on your feet.
 */
export function downOrDie(z: Zone, st: GameState, ev: ZoneEvents, cause: string): void {
  st.hp = 0;
  z.lastCause = cause;
  if (z.partySize > 1 && z.net) {
    if (z.downed) return;
    z.downed = true;
    z.bleedT = 30;
    z.castT = 0; z.spinT = 0; z.dashT = 0; z.swingT = 0;
    popup(z, z.px, z.py - 50, 'DOWN', '#ff6b6b', 22, 2, heroZ(z) + 60);
    shakeIt(z, 12);
    pushLog(st, 'You are down. Somebody has thirty seconds to reach you.', 'bad');
    return;
  }
  if (!z.over) {
    z.over = true;
    ev.onDeath(cause);
  }
}

export function reviveMe(z: Zone, st: GameState): void {
  if (!z.downed) return;
  const d = derived(st);
  z.downed = false;
  z.bleedT = 0;
  st.hp = Math.max(1, d.maxHp * 0.35);
  z.iframes = 2;
  popup(z, z.px, z.py - 50, 'BACK ON YOUR FEET', '#9fe0c0', 18, 1.8, heroZ(z) + 60);
  burst(z, z.px, z.py - 10, 30, '#9fe0c0', { speed: 150, size: 3, life: 0.8, up: 20, grav: 80, base: z.groundZ });
  pushLog(st, 'Someone pulled you back up.', 'good');
}

// ------------------------------------------------------------------ caches

export function nearestCache(z: Zone): Cache | null {
  let best: Cache | null = null, bd = 64;
  for (const c of z.caches) {
    if (c.found) continue;
    const dd = Math.hypot(c.x - z.px, c.y - z.py);
    if (dd < bd && Math.abs(c.gz - z.groundZ) < REACH_Z) { bd = dd; best = c; }
  }
  return best;
}

export function openCache(z: Zone, st: GameState, c: Cache): void {
  if (c.found) return;
  c.found = true;
  burst(z, c.x, c.y - 10, 26, '#ffe28a', { speed: 140, size: 3.2, life: 0.8, up: 16, grav: 90, base: c.gz });
  shakeIt(z, 3);
  const q = st.active;
  if (q && q.kind === 'recover' && q.zoneId === z.def.id) {
    q.have = Math.min(q.need, q.have + 1);
    popup(z, c.x, c.y - 30, 'found ' + q.have + '/' + q.need, '#f0d67a', 15, 1.6, c.gz + 50);
    if (q.have >= q.need) pushLog(st, 'Everything is found. Report to the guild.', 'good');
  }
  if (grantXp(st, 'footwork', 30)) levelBurst(z, 'footwork');
  const gold = 8 + Math.floor(Math.random() * 14);
  st.gold += gold;
  popup(z, c.x + 16, c.y - 12, '+' + gold + 'g', '#f5c542', 13, 1.1, c.gz + 30);
}
