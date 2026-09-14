import { ZONES } from '../game/content';
import { SKILL_COLOR, SKILL_NAMES } from '../game/types';
import { levelProgress } from '../game/bloodline';
import { GameState, derived, lastXp, trialReady } from '../game/state';
import { abilitiesFor } from '../game/abilities';
import { rankDef } from '../game/ranks';
import type { Zone } from '../game/zone';
import type { Party } from '../net/party';
import { veteran } from './story';
import { clear, el, fmt } from './dom';

export type HudScene = 'town' | 'zone' | 'hall';

/**
 * The HUD is built once and mutated in place. Rebuilding this much DOM every
 * frame was measurably worse than the game loop itself.
 */
class Hud {
  root = document.getElementById('hud')!;
  name = el('div', { class: 'nm' });
  gen = el('div', { class: 'gen' });
  cls = el('div', { class: 'cls' });
  place = el('div', { class: 'cls' });
  badge = el('span', { class: 'rankbadge' });
  hp = bar('hp'); mp = bar('mp'); st = bar('st'); merit = bar('merit');
  pips = el('div', { class: 'dashpips' });
  coin = el('div', { class: 'coin' });
  memory = el('div', { class: 'memorypill' });
  partyPill = el('div', { class: 'partypill' });
  quest = el('div', { class: 'questcard' });
  goal = el('div', { class: 'goalcard' });
  frames = el('div', { class: 'partyframes' });
  logbox = el('div', { class: 'logbox' });
  hints = el('div', { class: 'hud-br' });
  bar4 = el('div', { class: 'abilitybar' });
  slots: {
    root: HTMLElement; fill: HTMLElement; cdText: HTMLElement; id: string;
  }[] = [];
  slotSig = '';
  ping = el('div', { class: 'skillping' });
  pingName = el('span', {});
  pingLevel = el('b', {});
  pingFill = el('i', {});
  lastLogLen = -1;
  lastPingAt = -1;
  frameSig = '';
  built = false;
  slow = 0;

  build(): void {
    clear(this.root);
    const tl = el('div', { class: 'hud-tl' });
    tl.append(el('div', { class: 'namecard' },
      el('div', { class: 'row' }, el('span', { style: 'display:flex;align-items:center;min-width:0' }, this.badge, this.name), this.gen),
      el('div', { class: 'row', style: 'margin-bottom:7px' }, this.cls, this.place),
      this.hp.root,
      el('div', { style: 'height:5px' }),
      this.mp.root,
      el('div', { style: 'height:5px' }),
      this.st.root,
      this.pips,
      this.merit.root,
    ), this.frames);
    const tr = el('div', { class: 'hud-tr' });
    tr.append(this.coin, this.memory, this.partyPill, this.quest, this.goal);
    const bl = el('div', { class: 'hud-bl' });
    bl.append(this.logbox);

    this.ping.append(
      el('div', { class: 'r' }, this.pingName, this.pingLevel),
      el('div', { class: 'track' }, this.pingFill),
    );
    this.ping.style.opacity = '0';

    this.root.append(tl, tr, bl, this.hints, this.ping, this.bar4);
    this.built = true;
  }

  update(s: GameState, scene: HudScene, zone: Zone | null, party: Party | null): void {
    if (!this.built) this.build();
    const d = derived(s);
    const R = rankDef(s.rank);

    this.name.textContent = s.hero.name;
    this.gen.textContent = 'gen ' + s.generation;
    this.cls.textContent = s.hero.classId + ' · ' + s.hero.trait.name;
    this.place.textContent = s.village.name;
    this.badge.textContent = R.letter;
    this.badge.style.background = R.color;
    this.badge.title = R.plate + ' · ' + R.title;

    this.hp.set(s.hp, d.maxHp, Math.ceil(s.hp) + ' / ' + d.maxHp);
    this.mp.set(s.mana, d.maxMana, Math.ceil(s.mana) + ' / ' + d.maxMana);
    this.st.set(s.stamina, d.maxStamina, 'stamina');
    if (Number.isFinite(R.merit)) {
      this.merit.root.style.display = '';
      this.merit.set(s.merit, R.merit, trialReady(s) ? 'trial ready' : 'merit ' + s.merit + ' / ' + R.merit);
    } else {
      this.merit.root.style.display = 'none';
    }

    // dash charges
    const want = d.dash.charges;
    if (this.pips.childElementCount !== want) {
      clear(this.pips);
      for (let i = 0; i < want; i++) this.pips.append(el('div', { class: 'pip' }, el('i', {})));
    }
    const charges = zone ? zone.dashCharges : want;
    const partial = zone ? Math.min(1, zone.dashRecharge / d.dash.cooldown) : 1;
    Array.from(this.pips.children).forEach((pip, i) => {
      const full = i < charges;
      pip.classList.toggle('full', full);
      const fill = pip.firstElementChild as HTMLElement;
      fill.style.width = full ? '100%' : (i === charges ? partial * 100 + '%' : '0%');
    });

    this.coin.textContent = '◆ ' + fmt(s.gold) + 'g';
    if (s.memory > 0) {
      this.memory.style.display = '';
      this.memory.textContent = s.memory + ' memory · [K]';
    } else {
      this.memory.style.display = 'none';
    }
    const inParty = !!party && !party.closed;
    this.partyPill.textContent = inParty ? 'Party ' + party!.code + ' · ' + party!.size + ' · [P]' : 'Party · [P]';
    this.partyPill.style.opacity = inParty ? '1' : '0.7';

    if (s.active) {
      const q = s.active;
      const done = q.have >= q.need;
      this.quest.style.display = '';
      clear(this.quest);
      this.quest.append(
        el('div', { class: 't' }, q.title),
        el('div', { class: 's' }, ZONES[q.zoneId].name + ' · ' + rankDef(q.rank).letter + '-rank'),
        el('div', { class: 'p' }, done
          ? (q.trial ? 'Done — report to ' + veteran(s).name : 'Complete — report to the guild')
          : q.have + ' / ' + q.need + ' ' + q.targetName),
      );
    } else {
      this.quest.style.display = 'none';
    }

    // the next thing worth doing, so nobody is ever left wondering
    this.slow -= 1;
    if (this.slow <= 0) {
      this.slow = 20;
      const goal = nextGoal(s, scene);
      if (goal) {
        this.goal.style.display = '';
        clear(this.goal);
        this.goal.append(el('b', {}, 'Next'), goal);
      } else {
        this.goal.style.display = 'none';
      }
      this.updateFrames(party);
    }

    if (s.log.length !== this.lastLogLen) {
      this.lastLogLen = s.log.length;
      clear(this.logbox);
      for (const l of s.log.slice(-7).reverse()) {
        this.logbox.append(el('div', { class: 'logline ' + l.kind }, l.t));
      }
    }

    // ---- the skill you are currently training
    if (lastXp) {
      const age = (performance.now() - lastXp.at) / 1000;
      if (age < 3.2) {
        if (lastXp.at !== this.lastPingAt) {
          this.lastPingAt = lastXp.at;
          const p = levelProgress(s.hero.skills[lastXp.skill].xp);
          this.pingName.textContent = SKILL_NAMES[lastXp.skill];
          this.pingName.style.color = SKILL_COLOR[lastXp.skill];
          this.pingLevel.textContent = 'level ' + p.level;
          this.pingFill.style.background = SKILL_COLOR[lastXp.skill];
          this.pingFill.style.width = (p.need ? (p.into / p.need) * 100 : 0) + '%';
          this.pingFill.style.height = '100%';
          this.pingFill.style.display = 'block';
          if (lastXp.levelled) {
            this.ping.classList.remove('levelled');
            void this.ping.offsetWidth;
            this.ping.classList.add('levelled');
          }
        }
        this.ping.style.opacity = age > 2.4 ? String(1 - (age - 2.4) / 0.8) : '1';
      } else {
        this.ping.style.opacity = '0';
      }
    }

    // ---- QWER
    const abils = abilitiesFor(s.hero.classId);
    const barSig = scene + abils.map((a) => a.id).join();
    if (this.slotSig !== barSig) {
      this.slotSig = barSig;
      clear(this.bar4);
      this.slots = [];
      for (const a of abils) {
        const fill = el('i', { class: 'cdfill' });
        const cdText = el('span', { class: 'cdnum' });
        const root = el('div', { class: 'abil', style: '--c:' + a.color },
          el('b', { class: 'glyph' }, a.glyph),
          el('span', { class: 'kb' }, a.key.toUpperCase()),
          el('span', { class: 'nm' }, a.name),
          fill, cdText);
        root.title = a.name + ' — ' + a.desc;
        this.bar4.append(root);
        this.slots.push({ root, fill, cdText, id: a.id });
      }
    }
    this.bar4.style.display = scene === 'zone' ? 'flex' : 'none';
    if (scene === 'zone') {
      abils.forEach((a, i) => {
        const slot = this.slots[i];
        if (!slot) return;
        const cd = zone ? (zone.abilityCd[a.id] ?? 0) : 0;
        const have = a.resource === 'mana' ? s.mana : s.stamina;
        const poor = have < a.cost;
        slot.root.classList.toggle('cooling', cd > 0);
        slot.root.classList.toggle('poor', cd <= 0 && poor);
        slot.fill.style.height = (cd > 0 ? (cd / a.cd) * 100 : 0) + '%';
        slot.cdText.textContent = cd > 0 ? String(Math.ceil(cd)) : '';
      });
    }

    const hints = scene === 'zone'
      ? [['Click', 'attack'], ['Q E R F', 'skills'], ['Space', 'jump'], ['Shift', 'dash'], ['X', 'use · leave']]
      : scene === 'hall'
        ? [['WASD', 'walk'], ['E', 'talk · use'], ['Tab', 'kit'], ['P', 'party']]
        : [['WASD', 'walk'], ['E', 'enter · talk'], ['Tab', 'kit'], ['C', 'character'], ['P', 'party']];
    const sig = hints.map((h) => h[0] + h[1]).join();
    if (this.hints.dataset.sig !== sig) {
      this.hints.dataset.sig = sig;
      clear(this.hints);
      for (const [k, v] of hints) {
        this.hints.append(el('div', { class: 'keyhint' }, el('b', {}, k), ' ' + v));
      }
    }
  }

  private updateFrames(party: Party | null): void {
    if (!party || party.closed || party.members.size === 0) {
      if (this.frameSig) { clear(this.frames); this.frameSig = ''; }
      return;
    }
    const where: Record<string, string> = { town: 'town', hall: 'guild', zone: 'field', death: 'dead', creation: '…' };
    clear(this.frames);
    this.frameSig = 'on';
    for (const m of party.memberList()) {
      const s = m.state;
      const down = !!s?.dn;
      const R = rankDef(m.profile.rank);
      const badge = el('span', { class: 'rankbadge', style: 'background:' + R.color + ';min-width:16px;height:16px;font-size:10px' }, R.letter);
      const frame = el('div', { class: 'pframe' + (down ? ' down' : '') },
        el('div', { class: 'top' }, el('span', {}, badge, m.profile.name),
          el('span', { class: 'where' }, down ? 'DOWN ' + s!.bl + 's' : s ? where[s.sc] ?? s.sc : 'arriving')));
      const b = bar('hp');
      b.set(s?.hp ?? 1, s?.mh ?? 1, '');
      frame.append(b.root);
      this.frames.append(frame);
    }
  }
}

function nextGoal(s: GameState, scene: HudScene): string | null {
  const q = s.active;
  const vet = veteran(s).name;
  if (q && q.have >= q.need) return q.trial ? 'Tell ' + vet + ' at the guild that it is done.' : 'Turn the contract in at the guild.';
  if (q) return null;
  if (!s.story['life:met_clerk']) return scene === 'hall' ? 'Talk to the clerk at the counter.' : 'Visit the Adventurers Guild, west of the square.';
  if (trialReady(s)) return 'Your trial is ready. See ' + vet + ' by the guild fire.';
  if (s.rank >= 6) return 'Adamant. Every contract is yours to take.';
  return 'Take a contract from the guild board to earn merit (' + s.merit + ' / ' + rankDef(s.rank).merit + ').';
}

function bar(kind: string): { root: HTMLElement; set: (v: number, max: number, label: string) => void } {
  const fill = el('i', {});
  const text = el('span', {});
  const root = el('div', { class: 'bar ' + kind }, fill, text);
  return {
    root,
    set: (v, max, label) => {
      fill.style.width = Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100)) + '%';
      text.textContent = label;
    },
  };
}

const hud = new Hud();

export function drawHud(st: GameState, scene: HudScene, zone: Zone | null = null, party: Party | null = null): void {
  hud.update(st, scene, zone, party);
}

export function resetHud(): void {
  hud.built = false;
  hud.lastLogLen = -1;
  hud.frameSig = '';
  hud.hints.dataset.sig = '';
}
