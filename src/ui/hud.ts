import { ZONES } from '../game/content';
import { SKILL_COLOR, SKILL_NAMES } from '../game/types';
import { levelProgress } from '../game/bloodline';
import { GameState, derived, lastXp } from '../game/state';
import { abilitiesFor } from '../game/abilities';
import type { Zone } from '../game/zone';
import { clear, el, fmt } from './dom';

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
  hp = bar('hp'); mp = bar('mp'); st = bar('st');
  pips = el('div', { class: 'dashpips' });
  coin = el('div', { class: 'coin' });
  memory = el('div', { class: 'memorypill' });
  quest = el('div', { class: 'questcard' });
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
  built = false;

  build(): void {
    clear(this.root);
    const tl = el('div', { class: 'hud-tl' });
    tl.append(el('div', { class: 'namecard' },
      el('div', { class: 'row' }, this.name, this.gen),
      el('div', { class: 'row', style: 'margin-bottom:7px' }, this.cls, this.place),
      this.hp.root,
      el('div', { style: 'height:5px' }),
      this.mp.root,
      el('div', { style: 'height:5px' }),
      this.st.root,
      this.pips,
    ));
    const tr = el('div', { class: 'hud-tr' });
    tr.append(this.coin, this.memory, this.quest);
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

  update(s: GameState, scene: 'town' | 'zone', zone: Zone | null): void {
    if (!this.built) this.build();
    const d = derived(s);

    this.name.textContent = s.hero.name;
    this.gen.textContent = 'gen ' + s.generation;
    this.cls.textContent = s.hero.classId + ' · ' + s.hero.trait.name;
    this.place.textContent = s.village.name;

    this.hp.set(s.hp, d.maxHp, Math.ceil(s.hp) + ' / ' + d.maxHp);
    this.mp.set(s.mana, d.maxMana, Math.ceil(s.mana) + ' / ' + d.maxMana);
    this.st.set(s.stamina, d.maxStamina, 'stamina');

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

    if (s.active) {
      const q = s.active;
      const done = q.have >= q.need;
      this.quest.style.display = '';
      clear(this.quest);
      this.quest.append(
        el('div', { class: 't' }, q.title),
        el('div', { class: 's' }, ZONES[q.zoneId].name),
        el('div', { class: 'p' }, done
          ? 'Complete — report to the guild'
          : q.have + ' / ' + q.need + ' ' + q.targetName),
      );
    } else {
      this.quest.style.display = 'none';
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
      this.bar4.style.display = scene === 'zone' ? 'flex' : 'none';
      for (const a of abils) {
        const fill = el('i', { class: 'cdfill' });
        const cdText = el('span', { class: 'cdnum' });
        const root = el('div', { class: 'abil', style: '--c:' + a.color },
          el('b', { class: 'glyph' }, a.glyph),
          el('span', { class: 'kb' }, a.key.toUpperCase()),
          el('span', { class: 'nm' }, a.name),
          fill, cdText);
        root.title = a.name + ' \u2014 ' + a.desc;
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

    const hints = scene === 'town'
      ? [['WASD', 'walk'], ['E', 'enter'], ['Tab', 'kit'], ['C', 'character'], ['K', 'techniques']]
      : [['Click', 'attack'], ['Q E R F', 'skills'], ['Space', 'jump'], ['Shift', 'dash'], ['X', 'leave']];
    const sig = hints.map((h) => h[0]).join();
    if (this.hints.dataset.sig !== sig) {
      this.hints.dataset.sig = sig;
      clear(this.hints);
      for (const [k, v] of hints) {
        this.hints.append(el('div', { class: 'keyhint' }, el('b', {}, k), ' ' + v));
      }
    }
  }
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

export function drawHud(st: GameState, scene: 'town' | 'zone', zone: Zone | null = null): void {
  hud.update(st, scene, zone);
}

export function resetHud(): void {
  hud.built = false;
  hud.lastLogLen = -1;
  hud.hints.dataset.sig = '';
}
