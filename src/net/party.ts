import { GuestNet, HostNet, Msg, cleanCode } from './peer';
import type { GameState } from '../game/state';
import type { Appearance, ClassId } from '../game/types';
import type { GearLook } from '../render/draw';
import { MONSTERS } from '../game/content';
import {
  HurtMsg, Mob, NetFx, RemoteHero, Telegraph, Zone, ZoneEvents, ZoneInit, ZoneNet,
  applyFx, applyHurt, mobDeathFx, nodeDoneForMe, remoteHarvest, remoteHitMob, remoteKill,
  reviveMe, zoneInit,
} from '../game/zone';

/**
 * A party of friends, each playing their own hero from their own save.
 *
 * The host runs the monsters. Everyone runs their own hero: where they stand,
 * what they swing and whether they dodged. Guests tell the host what they hit;
 * the host tells guests what hit them and what died. Loot is rolled by each
 * player for themselves, so nobody ever argues about a drop.
 */

export interface Profile {
  id: string;
  name: string;
  classId: ClassId;
  appearance: Appearance;
  look: GearLook;
  rank: number;
  gen: number;
}

/** A hero as other players see it, sent many times a second. */
export interface HeroState {
  /** scene: town, hall, zone, death, creation */
  sc: string;
  /** zone instance, when in a zone */
  zk: string;
  x: number; y: number; gz: number; jz: number;
  /** facing, walk cycle */
  f: number; w: number;
  /** swing time left, swing length, harvesting */
  sw: number; sm: number; hv: number;
  /** hurt flash, iframes, shield, spinning, cast */
  hu: number; ifr: number; sh: number; sp: number; c: number;
  hp: number; mh: number;
  /** downed, seconds left to bleed */
  dn: number; bl: number;
}

export interface QuestNote { kind: string; zoneId: string; target: string; eliteName?: string }

export interface Member {
  id: string;
  profile: Profile;
  state: HeroState | null;
  seen: number;
  /** smoothed position for drawing */
  rx: number; ry: number; rz: number;
  quest: QuestNote | null;
}

export interface PartyHooks {
  st: () => GameState | null;
  zone: () => Zone | null;
  events: () => ZoneEvents;
  /** guest: the host set out, follow them */
  enterZone: (init: ZoneInit) => void;
  /** guest: the host's zone is gone */
  zoneEnded: (reason: string) => void;
  toast: (text: string) => void;
  changed: () => void;
}

const STATE_HZ = 15;
const SNAP_HZ = 15;
const TOWN_HZ = 8;

function newMember(p: Profile): Member {
  return { id: p.id, profile: p, state: null, seen: performance.now(), rx: 0, ry: 0, rz: 0, quest: null };
}

export class Party {
  readonly role: 'host' | 'guest';
  readonly code: string;
  selfId: string;
  hostId: string;
  members = new Map<string, Member>();
  closed = false;
  /** guest: the zone the host is in right now, if any */
  hostZone: ZoneInit | null = null;
  private host: HostNet | null;
  private guest: GuestNet | null;
  private hooks: PartyHooks;
  private profile: Profile;
  private profileSig = '';
  private stateT = 0;
  private snapT = 0;
  private quest: QuestNote | null = null;

  private constructor(
    role: 'host' | 'guest', code: string, selfId: string, hostId: string,
    hooks: PartyHooks, profile: Profile, host: HostNet | null, guest: GuestNet | null,
  ) {
    this.role = role;
    this.code = code;
    this.selfId = selfId;
    this.hostId = hostId;
    this.hooks = hooks;
    this.profile = { ...profile, id: selfId };
    this.profileSig = JSON.stringify(this.profile);
    this.host = host;
    this.guest = guest;
    if (host) {
      host.onMsg = (id, m) => this.onHostMsg(id, m);
      host.onLeave = (id) => this.dropMember(id);
      host.onTrouble = (t) => hooks.toast(t);
    }
    if (guest) {
      guest.onMsg = (m) => this.onGuestMsg(m);
      guest.onClose = () => {
        if (this.closed) return;
        this.closed = true;
        hooks.toast('Lost the connection to the party.');
        const z = hooks.zone();
        if (z && !z.auth) hooks.zoneEnded('The connection to the host was lost.');
        hooks.changed();
      };
    }
  }

  static async host(profile: Profile, hooks: PartyHooks): Promise<Party> {
    const net = await HostNet.open();
    return new Party('host', net.code, net.id, net.id, hooks, profile, net, null);
  }

  static async join(code: string, profile: Profile, hooks: PartyHooks): Promise<Party> {
    const net = await GuestNet.join(code);
    const p = new Party('guest', cleanCode(code), net.id, '', hooks, profile, null, net);
    net.send({ t: 'hello', profile: p.profile });
    return p;
  }

  get size(): number { return 1 + this.members.size; }

  memberList(): Member[] { return [...this.members.values()]; }

  leave(): void {
    if (this.closed) return;
    this.closed = true;
    this.guest?.send({ t: 'bye' });
    this.host?.close();
    this.guest?.close();
  }

  // ------------------------------------------------------------------ host

  private onHostMsg(id: string, m: Msg): void {
    const hooks = this.hooks;
    switch (m.t) {
      case 'hello': {
        const profile = { ...(m.profile as Profile), id };
        this.members.set(id, newMember(profile));
        this.host!.send(id, { t: 'welcome', you: id, hostId: this.selfId, code: this.code, members: this.profiles() });
        this.host!.broadcast({ t: 'member', profile }, id);
        hooks.toast(profile.name + ' joined the party');
        const z = hooks.zone();
        if (z && z.auth && z.net) this.host!.send(id, { t: 'zone', init: zoneInit(z) });
        hooks.changed();
        break;
      }
      case 'profile': {
        const mem = this.members.get(id);
        if (!mem) break;
        mem.profile = { ...(m.profile as Profile), id };
        this.host!.broadcast({ t: 'member', profile: mem.profile }, id);
        hooks.changed();
        break;
      }
      case 'st': {
        const mem = this.members.get(id);
        if (!mem) break;
        mem.state = m.s as HeroState;
        mem.seen = performance.now();
        break;
      }
      case 'quest': {
        const mem = this.members.get(id);
        if (mem) mem.quest = (m.q as QuestNote | null) ?? null;
        break;
      }
      case 'hit': {
        const z = hooks.zone(), st = hooks.st();
        if (!z || !st || z.key !== m.zk) break;
        remoteHitMob(z, st, m.uid as string, m.raw as number, !!m.crit,
          m.ang as number, m.knock as number, m.stun as number, m.slow as number);
        break;
      }
      case 'harvest': {
        const z = hooks.zone();
        if (z && z.key === m.zk) remoteHarvest(z, m.uid as string, m.bite as number, id);
        break;
      }
      case 'revive': {
        const target = m.target as string;
        if (target === this.selfId) {
          const z = hooks.zone(), st = hooks.st();
          if (z && st) reviveMe(z, st);
        } else {
          this.host!.send(target, { t: 'revive', target });
        }
        break;
      }
      case 'bye':
        this.host!.kick(id);
        break;
    }
  }

  private dropMember(id: string): void {
    const mem = this.members.get(id);
    if (!mem) return;
    this.members.delete(id);
    this.host?.broadcast({ t: 'gone', id });
    this.hooks.toast(mem.profile.name + ' left the party');
    this.hooks.changed();
  }

  private profiles(): Profile[] {
    return [this.profile, ...[...this.members.values()].map((mm) => mm.profile)];
  }

  /** Host: a zone just started, bring everyone along. */
  zoneStarted(z: Zone): void {
    if (this.role !== 'host') return;
    z.net = this.zoneNet(z);
    this.host!.broadcast({ t: 'zone', init: zoneInit(z) });
  }

  /** Host: the zone is over for everyone. */
  zoneEnded(z: Zone, reason: string): void {
    if (this.role !== 'host') return;
    this.host!.broadcast({ t: 'zoneEnd', zk: z.key, reason });
  }

  /** Bosses and bounties the rest of the party has contracts for in this zone. */
  wantsFor(zoneId: string): { bosses: string[]; elites: { defId: string; name: string }[] } {
    const bosses: string[] = [];
    const elites: { defId: string; name: string }[] = [];
    for (const mem of this.members.values()) {
      const q = mem.quest;
      if (!q || q.zoneId !== zoneId) continue;
      if (q.kind === 'boss') bosses.push(q.target);
      if (q.kind === 'bounty' && q.eliteName) elites.push({ defId: q.target, name: q.eliteName });
    }
    return { bosses, elites };
  }

  // ----------------------------------------------------------------- guest

  private onGuestMsg(m: Msg): void {
    const hooks = this.hooks;
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.you as string;
        this.hostId = m.hostId as string;
        this.profile.id = this.selfId;
        for (const p of m.members as Profile[]) {
          if (p.id !== this.selfId) this.members.set(p.id, newMember(p));
        }
        hooks.toast('Joined ' + (this.members.get(this.hostId)?.profile.name ?? 'the host') + '’s party');
        if (this.quest) this.guest!.send({ t: 'quest', q: this.quest });
        hooks.changed();
        break;
      }
      case 'member': {
        const p = m.profile as Profile;
        if (p.id === this.selfId) break;
        const mem = this.members.get(p.id);
        if (mem) mem.profile = p;
        else {
          this.members.set(p.id, newMember(p));
          hooks.toast(p.name + ' joined the party');
        }
        hooks.changed();
        break;
      }
      case 'gone': {
        const mem = this.members.get(m.id as string);
        if (!mem) break;
        this.members.delete(m.id as string);
        hooks.toast(mem.profile.name + ' left the party');
        hooks.changed();
        break;
      }
      case 'zone': {
        this.hostZone = m.init as ZoneInit;
        hooks.enterZone(this.hostZone);
        break;
      }
      case 'zoneEnd': {
        if (this.hostZone?.key === m.zk) this.hostZone = null;
        const z = hooks.zone();
        if (z && !z.auth && z.key === m.zk) hooks.zoneEnded(String(m.reason ?? 'The party left.'));
        break;
      }
      case 'snap':
        this.applySnap(m);
        break;
      case 'kill': {
        const z = hooks.zone(), st = hooks.st();
        if (!z || !st || z.key !== m.zk) break;
        remoteKill(z, st, m.uid as string, m.defId as string, m.x as number, m.y as number,
          m.gz as number, (m.elite as string) || null);
        break;
      }
      case 'hurt': {
        const z = hooks.zone(), st = hooks.st();
        if (z && st && z.key === m.zk) applyHurt(z, st, m.h as HurtMsg, hooks.events());
        break;
      }
      case 'node': {
        const z = hooks.zone(), st = hooks.st();
        if (z && st && z.key === m.zk) nodeDoneForMe(z, st, m.uid as string);
        break;
      }
      case 'revive': {
        if (m.target !== this.selfId) break;
        const z = hooks.zone(), st = hooks.st();
        if (z && st) reviveMe(z, st);
        break;
      }
      case 'toast':
        hooks.toast(String(m.text));
        break;
    }
  }

  private applySnap(m: Msg): void {
    const now = performance.now();
    for (const [id, s] of (m.heroes as [string, HeroState][]) ?? []) {
      if (id === this.selfId) continue;
      const mem = this.members.get(id);
      if (!mem) continue;
      mem.state = s;
      mem.seen = now;
    }
    const z = this.hooks.zone();
    if (!z || z.auth || !m.zk || z.key !== m.zk || !m.mobs) return;
    applyMobs(z, m.mobs as unknown[][]);
    z.netProj = ((m.proj as unknown[][]) ?? []).map((p) => ({
      x: p[0] as number, y: p[1] as number, z: p[2] as number, color: p[3] as string, size: p[4] as number,
    }));
    z.telegraphs = ((m.tel as unknown[][]) ?? []).map(decodeTelegraph);
    for (const fx of (m.fx as NetFx[]) ?? []) applyFx(z, fx);
    const gone = new Set((m.nodes as number[]) ?? []);
    z.nodes.forEach((n, i) => {
      if (gone.has(i)) { if (n.respawn <= 0) n.respawn = 30; }
      else if (n.respawn > 0) { n.respawn = 0; n.hp = n.maxHp; }
    });
  }

  /** Guest: keep the host told about our contract, so it can wake our boss too. */
  setQuest(q: QuestNote | null): void {
    const sig = JSON.stringify(q);
    if (sig === JSON.stringify(this.quest)) return;
    this.quest = q;
    this.guest?.send({ t: 'quest', q });
  }

  // ------------------------------------------------------------- everyone

  /** Ask for a downed friend to be put back on their feet. */
  revive(targetId: string): void {
    if (this.role === 'host') {
      if (targetId === this.selfId) return;
      this.host!.send(targetId, { t: 'revive', target: targetId });
    } else {
      this.guest!.send({ t: 'revive', target: targetId });
    }
  }

  setProfile(p: Profile): void {
    const next = { ...p, id: this.selfId };
    const sig = JSON.stringify(next);
    if (sig === this.profileSig) return;
    this.profileSig = sig;
    this.profile = next;
    if (this.role === 'host') this.host!.broadcast({ t: 'member', profile: next });
    else this.guest!.send({ t: 'profile', profile: next });
  }

  zoneNet(z: Zone): ZoneNet {
    const zk = z.key;
    return {
      role: this.role,
      selfId: this.selfId,
      hitMob: (uid, raw, crit, ang, knock, stun, slow) =>
        this.guest?.send({ t: 'hit', zk, uid, raw, crit, ang, knock, stun, slow }),
      harvest: (uid, bite) => this.guest?.send({ t: 'harvest', zk, uid, bite }),
      hurt: (id, h) => this.host?.send(id, { t: 'hurt', zk, h }),
      killed: (mob: Mob) => this.host?.broadcast({
        t: 'kill', zk, uid: mob.uid, defId: mob.defId,
        x: Math.round(mob.x), y: Math.round(mob.y), gz: mob.gz, elite: mob.elite ?? '',
      }),
      nodeDone: (uid, byId) => this.host?.send(byId, { t: 'node', zk, uid }),
    };
  }

  /** Once a frame: smooth friends' movement, keep the zone's idea of who is here current, talk. */
  tick(dt: number, mine: HeroState): void {
    if (this.closed) return;
    const now = performance.now();
    const k = Math.min(1, dt * 12);
    for (const mem of this.members.values()) {
      const s = mem.state;
      if (!s) continue;
      if (Math.hypot(s.x - mem.rx, s.y - mem.ry) > 220) { mem.rx = s.x; mem.ry = s.y; mem.rz = s.gz + s.jz; }
      else { mem.rx += (s.x - mem.rx) * k; mem.ry += (s.y - mem.ry) * k; mem.rz += (s.gz + s.jz - mem.rz) * k; }
    }
    const z = this.hooks.zone();
    if (z) {
      const here: RemoteHero[] = [];
      for (const mem of this.members.values()) {
        const s = mem.state;
        if (!s || s.sc !== 'zone' || s.zk !== z.key || now - mem.seen > 5000) continue;
        here.push({
          id: mem.id, name: mem.profile.name, x: mem.rx, y: mem.ry, gz: s.gz, jz: s.jz, facing: s.f,
          airborne: s.jz > 0.5, iframes: s.ifr, downed: !!s.dn, bleed: s.bl, hp: s.hp, maxHp: s.mh, seen: mem.seen,
        });
      }
      z.remotes = here;
      z.partySize = 1 + here.length;
    }

    if (this.role === 'guest') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.stateT = 1 / STATE_HZ;
        this.guest!.send({ t: 'st', s: mine });
      }
      return;
    }

    this.snapT -= dt;
    if (this.snapT > 0) return;
    const hosting = !!z && z.auth && !!z.net;
    this.snapT = 1 / (hosting ? SNAP_HZ : TOWN_HZ);
    const heroes: [string, HeroState][] = [[this.selfId, mine]];
    for (const mem of this.members.values()) if (mem.state) heroes.push([mem.id, mem.state]);
    const msg: Msg = { t: 'snap', heroes, zk: hosting ? z!.key : '' };
    if (hosting) {
      const zz = z!;
      const watching = [...this.members.values()].some((mm) => mm.state?.sc === 'zone' && mm.state.zk === zz.key);
      if (watching) {
        msg.mobs = encodeMobs(zz);
        msg.proj = zz.projectiles.filter((p) => p.hostile).slice(0, 40)
          .map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.z ?? 0), p.color, p.size]);
        msg.tel = zz.telegraphs.map(encodeTelegraph);
        msg.fx = zz.fxOut.splice(0);
        const gone: number[] = [];
        zz.nodes.forEach((n, i) => { if (n.respawn > 0) gone.push(i); });
        msg.nodes = gone;
      } else {
        zz.fxOut.length = 0;
      }
    }
    this.host!.broadcast(msg);
  }
}

// ------------------------------------------------------------------ encoding

const STATES = ['idle', 'chase', 'attack', 'dead'] as const;

function encodeMobs(z: Zone): unknown[][] {
  return z.mobs.map((m) => [
    m.uid, m.defId, Math.round(m.x), Math.round(m.y), Math.round(m.gz),
    Math.round(m.hp), m.maxHp, Math.round(m.facing * 100) / 100, STATES.indexOf(m.state),
    Math.round(m.windup * 100) / 100, m.hitFlash > 0 ? 1 : 0, m.stun > 0 ? 1 : 0,
    m.slowT > 0 ? 1 : 0, m.chargeT > 0 ? 1 : 0, m.elite ?? '', m.atkIdx,
  ]);
}

function blankMob(uid: string, defId: string, x: number, y: number, gz: number): Mob {
  return {
    uid, defId, x, y, hp: 1, maxHp: 1, cd: 0, windup: 0, state: 'idle', wanderT: 0, wx: x, wy: y,
    hitFlash: 0, facing: 0, dead: 0, aggroed: false, kbx: 0, kby: 0, stun: 0,
    lungeT: 0, lungeX: 0, lungeY: 0, atkIdx: -1, atkCds: [], chargeT: 0, chargeX: 0, chargeY: 0,
    slowT: 0, gz, elite: null, atkMul: 1, target: '', nx: x, ny: y, ngz: gz,
  };
}

function applyMobs(z: Zone, rows: unknown[][]): void {
  const byId = new Map(z.mobs.map((m) => [m.uid, m]));
  const seen = new Set<string>();
  for (const r of rows) {
    const uid = r[0] as string, defId = r[1] as string;
    const state = STATES[r[8] as number] ?? 'idle';
    seen.add(uid);
    let m = byId.get(uid);
    if (!m) {
      if (state === 'dead' || !MONSTERS[defId]) continue;
      m = blankMob(uid, defId, r[2] as number, r[3] as number, r[4] as number);
      z.mobs.push(m);
    }
    m.nx = r[2] as number;
    m.ny = r[3] as number;
    m.ngz = r[4] as number;
    m.hp = r[5] as number;
    m.maxHp = r[6] as number;
    m.facing = r[7] as number;
    if (state === 'dead') {
      if (m.state !== 'dead') {
        if (Math.hypot(m.x - z.px, m.y - z.py) < 900) mobDeathFx(z, m);
        else { m.state = 'dead'; m.dead = 0; }
      }
    } else {
      m.state = state;
    }
    m.windup = r[9] as number;
    if (r[10]) m.hitFlash = Math.max(m.hitFlash, 0.1);
    m.stun = r[11] ? 0.1 : 0;
    m.slowT = r[12] ? 0.3 : 0;
    m.chargeT = r[13] ? 0.1 : 0;
    m.elite = (r[14] as string) || null;
    m.atkIdx = r[15] as number;
  }
  for (const m of z.mobs) {
    if (!seen.has(m.uid) && m.state !== 'dead') { m.state = 'dead'; m.dead = 1.1; }
  }
}

function encodeTelegraph(t: Telegraph): unknown[] {
  return [t.kind, Math.round(t.x), Math.round(t.y), Math.round(t.r), Math.round(t.ang * 100) / 100,
    t.arc, Math.round(t.len), Math.round(t.wide), Math.round(t.t * 100) / 100, t.total, t.color, t.z ?? 0];
}

function decodeTelegraph(r: unknown[]): Telegraph {
  return {
    kind: r[0] as Telegraph['kind'], x: r[1] as number, y: r[2] as number, r: r[3] as number,
    ang: r[4] as number, arc: r[5] as number, len: r[6] as number, wide: r[7] as number,
    t: r[8] as number, total: r[9] as number, color: r[10] as string, z: r[11] as number,
  };
}
