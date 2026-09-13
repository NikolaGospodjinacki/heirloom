import type { Appearance, VillageNPC } from '../game/types';
import { drawPortrait } from '../render/draw';
import { clear, el } from './dom';

export interface Choice {
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

export interface DialogueSpec {
  name: string;
  role: string;
  appearance: Appearance;
  lines: string[];
  choices: Choice[];
  /** background tint behind the portrait */
  tint?: string;
}

let active: { destroy: () => void } | null = null;

export function dialogueOpen(): boolean { return active !== null; }
export function closeDialogue(): void {
  active?.destroy();
  active = null;
}

export function openDialogue(spec: DialogueSpec): void {
  closeDialogue();
  const overlay = document.getElementById('overlay')!;
  clear(overlay);

  const root = el('div', { class: 'vn' });
  const stage = el('div', { class: 'vn-stage' });

  // portrait
  const pWrap = el('div', { class: 'vn-portrait' });
  const cv = document.createElement('canvas');
  const PW = 300, PH = 340;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = PW * dpr; cv.height = PH * dpr;
  cv.style.width = PW + 'px'; cv.style.height = PH + 'px';
  pWrap.append(cv);
  stage.append(pWrap);

  const box = el('div', { class: 'vn-box' });
  const nameTag = el('div', { class: 'vn-name' }, spec.name);
  const roleTag = el('div', { class: 'vn-role' }, spec.role);
  const textEl = el('div', { class: 'vn-text' });
  const choicesEl = el('div', { class: 'vn-choices' });
  const moreEl = el('div', { class: 'vn-more' }, 'space to continue');
  box.append(nameTag, roleTag, textEl, choicesEl, moreEl);

  root.append(stage, box);
  overlay.append(root);

  // ------------------------------------------------------------ typewriter
  let lineIdx = 0;
  let charIdx = 0;
  let typing = true;
  let acc = 0;

  function renderLine(): void {
    const full = spec.lines[lineIdx] ?? '';
    const shown = full.slice(0, charIdx);
    clear(textEl);
    textEl.append(document.createTextNode(shown));
    if (typing) textEl.append(el('span', { class: 'caret' }, '▌'));
  }

  function showChoices(): void {
    clear(choicesEl);
    moreEl.textContent = '';
    spec.choices.forEach((c, i) => {
      const b = el('button', { class: 'vn-choice' },
        el('span', { class: 'k' }, String(i + 1)),
        c.label,
        c.hint ? el('span', { class: 'muted' }, '   ' + c.hint) : null);
      if (c.disabled) { (b as HTMLButtonElement).disabled = true; b.style.opacity = '0.45'; }
      else b.addEventListener('click', (e) => { e.stopPropagation(); c.run(); });
      choicesEl.append(b);
    });
  }

  function advance(): void {
    if (typing) {
      charIdx = (spec.lines[lineIdx] ?? '').length;
      typing = false;
      renderLine();
      if (lineIdx >= spec.lines.length - 1) showChoices();
      else moreEl.textContent = 'space to continue';
      return;
    }
    if (lineIdx < spec.lines.length - 1) {
      lineIdx++; charIdx = 0; typing = true;
      renderLine();
      return;
    }
    showChoices();
  }

  // ---------------------------------------------------------------- events
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); return; }
    if (e.key === 'Escape') {
      const leave = spec.choices[spec.choices.length - 1];
      if (leave) leave.run();
      return;
    }
    const n = parseInt(e.key, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= spec.choices.length && choicesEl.childElementCount > 0) {
      const c = spec.choices[n - 1];
      if (!c.disabled) c.run();
    }
  };
  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.vn-choice')) return;
    advance();
  };
  window.addEventListener('keydown', onKey, true);
  root.addEventListener('click', onClick);

  // ------------------------------------------------------------------ loop
  let raf = 0;
  let last = performance.now();
  const t0 = performance.now();
  const pctx = cv.getContext('2d')!;

  function frame(now: number): void {
    const dt = (now - last) / 1000;
    last = now;

    if (typing) {
      acc += dt;
      const cps = 55;
      while (acc > 1 / cps) {
        acc -= 1 / cps;
        charIdx++;
        if (charIdx >= (spec.lines[lineIdx] ?? '').length) {
          charIdx = (spec.lines[lineIdx] ?? '').length;
          typing = false;
          if (lineIdx >= spec.lines.length - 1) showChoices();
          break;
        }
      }
      renderLine();
    }

    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.clearRect(0, 0, PW, PH);
    const g = pctx.createRadialGradient(PW / 2, PH * 0.55, 10, PW / 2, PH * 0.55, PW * 0.7);
    g.addColorStop(0, (spec.tint ?? '#6a5a44') + 'aa');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    pctx.fillStyle = g;
    pctx.fillRect(0, 0, PW, PH);
    drawPortrait(pctx, PW / 2, PH * 0.55, 2.5, spec.appearance, (now - t0) / 1000);

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  renderLine();

  active = {
    destroy: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
    },
  };
}

export function npcRoleLabel(role: VillageNPC['role']): string {
  return role === 'shopkeeper' ? 'General Store'
    : role === 'guildmaster' ? 'Adventurers Guild'
      : 'Smithy';
}
