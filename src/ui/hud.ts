import { ZONES } from '../game/content';
import { GameState, derived } from '../game/state';
import { clear, el, fmt } from './dom';

export function drawHud(st: GameState, scene: 'town' | 'zone'): void {
  const host = document.getElementById('hud')!;
  clear(host);
  const d = derived(st);

  // ------------------------------------------------------------ top left
  const tl = el('div', { class: 'hud-tl' });
  const card = el('div', { class: 'namecard' });
  card.append(
    el('div', { class: 'row' },
      el('div', { class: 'nm' }, st.hero.name),
      el('div', { class: 'gen' }, 'gen ' + st.generation)),
    el('div', { class: 'row', style: 'margin-bottom:7px' },
      el('div', { class: 'cls' }, st.hero.classId + ' · ' + st.hero.trait.name),
      el('div', { class: 'cls' }, st.village.name)),
    bar('hp', st.hp, d.maxHp, Math.ceil(st.hp) + ' / ' + d.maxHp),
    el('div', { style: 'height:5px' }),
    bar('mp', st.mana, d.maxMana, Math.ceil(st.mana) + ' / ' + d.maxMana),
  );
  tl.append(card);
  host.append(tl);

  // ----------------------------------------------------------- top right
  const tr = el('div', { class: 'hud-tr' });
  tr.append(el('div', { class: 'coin' }, '◆ ' + fmt(st.gold) + 'g'));
  if (st.active) {
    const q = st.active;
    const done = q.have >= q.need;
    tr.append(el('div', { class: 'questcard' },
      el('div', { class: 't' }, q.title),
      el('div', { class: 's' }, ZONES[q.zoneId].name),
      el('div', { class: 'p' }, done ? 'Complete — report to the guild' : q.have + ' / ' + q.need + ' ' + q.targetName),
    ));
  }
  host.append(tr);

  // --------------------------------------------------------- bottom left
  const bl = el('div', { class: 'hud-bl' });
  const logbox = el('div', { class: 'logbox' });
  for (const l of st.log.slice(-7).reverse()) {
    logbox.append(el('div', { class: 'logline ' + l.kind }, l.t));
  }
  bl.append(logbox);
  host.append(bl);

  // -------------------------------------------------------- bottom right
  const br = el('div', { class: 'hud-br' });
  const hints = scene === 'town'
    ? [['WASD', 'walk'], ['E', 'enter'], ['Tab', 'pack'], ['C', 'character']]
    : [['WASD', 'walk'], ['Space / click', 'attack'], ['E', 'leave zone'], ['Tab', 'pack']];
  for (const [k, v] of hints) {
    br.append(el('div', { class: 'keyhint' }, el('b', {}, k), ' ' + v));
  }
  host.append(br);
}

function bar(kind: string, v: number, max: number, label: string): HTMLElement {
  const pct = Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100));
  return el('div', { class: 'bar ' + kind },
    el('i', { style: 'width:' + pct + '%' }),
    el('span', {}, label));
}
