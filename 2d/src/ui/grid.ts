import type { EquipSlot, Item } from '../game/types';
import { SLOT_NAMES } from '../game/types';
import { RARITY_COLOR } from '../game/types';
import { ITEM_DEFS, displayName, itemMods, itemValue, rotatedShape } from '../game/items';
import { Grid, canPlace, place, remove } from '../game/backpack';
import { el, clear, hideTip, showTip } from './dom';

export const CELL = 42;
export const GAP = 3;

function px(cells: number): number { return cells * CELL + (cells - 1) * GAP; }

export interface GridViewOpts {
  grid: Grid;
  /** false for shop windows etc. */
  editable?: boolean;
  onChange?: () => void;
  onClickItem?: (it: Item, ev: MouseEvent) => void;
  label?: string;
}

const mounted = new Set<GridView>();
const slots = new Set<SlotView>();

export class GridView {
  host: HTMLDivElement;
  itemsHost: HTMLDivElement;
  ghost: HTMLDivElement;
  opts: GridViewOpts;

  constructor(opts: GridViewOpts) {
    this.opts = opts;
    const g = opts.grid;
    this.host = el('div', {
      class: 'grid-host',
      style: 'width:' + (px(g.w) + 12) + 'px;height:' + (px(g.h) + 12) + 'px',
    });
    const cells = el('div', {
      class: 'grid-cells',
      style: 'grid-template-columns:repeat(' + g.w + ',' + CELL + 'px);gap:' + GAP + 'px',
    });
    for (let i = 0; i < g.w * g.h; i++) {
      cells.append(el('div', { class: 'cell', style: 'width:' + CELL + 'px;height:' + CELL + 'px' }));
    }
    this.itemsHost = el('div', { class: 'grid-items' });
    this.ghost = el('div', { class: 'ghost', style: 'display:none' });
    this.host.append(cells, this.itemsHost, this.ghost);
    mounted.add(this);
    this.render();
  }

  destroy(): void { mounted.delete(this); }

  render(): void {
    clear(this.itemsHost);
    for (const it of this.opts.grid.items) {
      this.itemsHost.append(this.makeItemEl(it));
    }
  }

  makeItemEl(it: Item, forDrag = false): HTMLDivElement {
    const def = ITEM_DEFS[it.defId];
    const cells = rotatedShape(def.shape, it.rot);
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) + 1;
    const node = el('div', {
      class: 'gitem',
      style: [
        'left:' + (forDrag ? 0 : it.gx * (CELL + GAP)) + 'px',
        'top:' + (forDrag ? 0 : it.gy * (CELL + GAP)) + 'px',
        'width:' + px(w) + 'px', 'height:' + px(h) + 'px',
        'background:transparent', 'border:none',
      ].join(';'),
    });
    for (const [cx, cy] of cells) {
      node.append(el('div', {
        style: [
          'position:absolute',
          'left:' + cx * (CELL + GAP) + 'px', 'top:' + cy * (CELL + GAP) + 'px',
          'width:' + CELL + 'px', 'height:' + CELL + 'px',
          'background:' + def.color,
          'border:1.5px solid ' + RARITY_COLOR[it.rarity],
          'border-radius:5px',
          it.rarity !== 'common' ? 'box-shadow:0 0 8px ' + RARITY_COLOR[it.rarity] + '55' : '',
        ].join(';'),
      }));
    }
    const lbl = el('div', {
      class: 'lbl',
      style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center',
    }, shortName(it.name));
    node.append(lbl);
    if (it.count > 1) node.append(el('div', { class: 'cnt' }, String(it.count)));
    if (it.plus > 0) node.append(el('div', { class: 'pl' }, '+' + it.plus));

    if (!forDrag) {
      node.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (this.opts.editable === false) {
          this.opts.onClickItem?.(it, e as unknown as MouseEvent);
          return;
        }
        startDrag(this, it, e);
      });
      node.addEventListener('click', (e) => {
        if (this.opts.editable === false) return;
        this.opts.onClickItem?.(it, e);
      });
      node.addEventListener('mouseenter', (e) => showTip(itemTooltip(it), e.clientX, e.clientY));
      node.addEventListener('mousemove', (e) => showTip(itemTooltip(it), e.clientX, e.clientY));
      node.addEventListener('mouseleave', hideTip);
    }
    return node;
  }

  cellAt(clientX: number, clientY: number): [number, number] | null {
    const r = this.itemsHost.getBoundingClientRect();
    const gx = Math.floor((clientX - r.left) / (CELL + GAP));
    const gy = Math.floor((clientY - r.top) / (CELL + GAP));
    if (clientX < r.left - 30 || clientY < r.top - 30) return null;
    if (clientX > r.right + 30 || clientY > r.bottom + 30) return null;
    return [gx, gy];
  }

  contains(clientX: number, clientY: number): boolean {
    const r = this.host.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }
}

/**
 * A single paper-doll slot. It behaves like a one-item grid for drag purposes:
 * you can drop gear onto it, and drag gear back off it.
 */
export interface SlotViewOpts {
  slot: EquipSlot;
  get: () => Item | null;
  /** return false to reject the change, for example when the pack is full */
  set: (it: Item | null) => boolean;
  accepts: (it: Item) => boolean;
  onChange?: () => void;
}

export class SlotView {
  host: HTMLDivElement;
  opts: SlotViewOpts;

  constructor(opts: SlotViewOpts) {
    this.opts = opts;
    this.host = el('div', { class: 'slot', 'data-slot': opts.slot });
    slots.add(this);
    this.render();
  }

  destroy(): void { slots.delete(this); }

  render(): void {
    clear(this.host);
    const it = this.opts.get();
    this.host.classList.toggle('filled', !!it);
    if (!it) {
      this.host.append(el('div', { class: 'slot-empty' }, SLOT_NAMES[this.opts.slot]));
      return;
    }
    const def = ITEM_DEFS[it.defId];
    const shine = it.rarity === 'common'
      ? ''
      : ';box-shadow:0 0 12px ' + RARITY_COLOR[it.rarity] + '66';
    const chip = el('div', {
      class: 'slot-item',
      style: 'background:' + def.color + ';border-color:' + RARITY_COLOR[it.rarity] + shine,
    }, el('span', {}, shortName(it.name)));
    if (it.plus > 0) chip.append(el('div', { class: 'pl' }, '+' + it.plus));
    chip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      startSlotDrag(this, it, e);
    });
    chip.addEventListener('mouseenter', (e) => showTip(itemTooltip(it), e.clientX, e.clientY));
    chip.addEventListener('mousemove', (e) => showTip(itemTooltip(it), e.clientX, e.clientY));
    chip.addEventListener('mouseleave', hideTip);
    this.host.append(chip);
  }

  contains(x: number, y: number): boolean {
    const r = this.host.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
}

export function shortName(n: string): string {
  const parts = n.split(' ');
  if (parts.length <= 2) return n;
  return parts.slice(-2).join(' ');
}

// --------------------------------------------------------------- tooltips

const MOD_LABEL: Record<string, string> = {
  atk: 'Attack', spellPower: 'Spell Power', armor: 'Armour', hp: 'Health',
  speed: 'Move Speed', critChance: 'Crit', attackSpeed: 'Attack Speed', range: 'Reach',
};

export function itemTooltip(it: Item): HTMLElement {
  const def = ITEM_DEFS[it.defId];
  const box = el('div');
  const n = el('div', { class: 'n', style: 'color:' + RARITY_COLOR[it.rarity] }, displayName(it));
  const k = el('div', { class: 'k' }, it.rarity + ' · ' + def.kind);
  box.append(n, k);
  const m = itemMods(it);
  for (const [key, v] of Object.entries(m)) {
    if (key === 'stats' || v === undefined || v === 0) continue;
    const num = v as number;
    let s: string;
    if (key === 'critChance') s = '+' + Math.round(num * 100) + '%';
    else if (key === 'attackSpeed') s = (num >= 1 ? '' : '') + num.toFixed(2) + 'x';
    else s = (num > 0 ? '+' : '') + num;
    box.append(el('div', { class: 'm' }, (MOD_LABEL[key] ?? key) + ' ' + s));
  }
  if (m.stats) {
    for (const [key, v] of Object.entries(m.stats)) {
      if (!v) continue;
      box.append(el('div', { class: 'm' }, (v > 0 ? '+' : '') + v + ' ' + key.toUpperCase()));
    }
  }
  if (def.desc) box.append(el('div', { class: 'd' }, def.desc));
  box.append(el('div', { class: 'v' }, itemValue(it) + 'g' + (it.count > 1 ? '  (x' + it.count + ')' : '')));
  const cells = rotatedShape(def.shape, it.rot).length;
  box.append(el('div', { class: 'd' }, cells + ' cell' + (cells > 1 ? 's' : '') + ' · R to rotate while dragging'));
  return box;
}

// ------------------------------------------------------------------- drag

interface DragSession {
  from: GridView | null;
  fromSlot: SlotView | null;
  item: Item;
  el: HTMLDivElement;
  ox: number;
  oy: number;
  rot: 0 | 1 | 2 | 3;
  grabCell: [number, number];
}
let drag: DragSession | null = null;

/** Anything registered here can also receive a dropped item (sell bin, forge slot...). */
export interface DropZone {
  test: (x: number, y: number) => boolean;
  accept: (it: Item, from: GridView) => boolean;
  hi?: HTMLElement;
}
export const dropZones: DropZone[] = [];

function startDrag(view: GridView, it: Item, e: PointerEvent): void {
  hideTip();
  e.preventDefault();
  const layer = document.getElementById('drag-layer')!;
  const clone = view.makeItemEl(it, true);
  clone.classList.add('gitem');
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ox = e.clientX - r.left;
  const oy = e.clientY - r.top;
  clone.style.position = 'fixed';
  clone.style.left = (e.clientX - ox) + 'px';
  clone.style.top = (e.clientY - oy) + 'px';
  clone.style.pointerEvents = 'none';
  layer.append(clone);

  const grabCell: [number, number] = [
    Math.floor(ox / (CELL + GAP)), Math.floor(oy / (CELL + GAP)),
  ];
  drag = { from: view, fromSlot: null, item: it, el: clone, ox, oy, rot: it.rot, grabCell };

  // hide the original while it is in the air
  for (const c of Array.from(view.itemsHost.children)) {
    (c as HTMLElement).style.opacity = '1';
  }
  const origIdx = view.opts.grid.items.indexOf(it);
  if (origIdx >= 0) (view.itemsHost.children[origIdx] as HTMLElement)?.classList.add('dragging');

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
}

function startSlotDrag(view: SlotView, it: Item, e: PointerEvent): void {
  hideTip();
  e.preventDefault();
  const layer = document.getElementById('drag-layer')!;
  const clone = makeFloatingItem({ ...it, rot: 0 });
  clone.style.left = (e.clientX - CELL / 2) + 'px';
  clone.style.top = (e.clientY - CELL / 2) + 'px';
  layer.append(clone);
  drag = {
    from: null, fromSlot: view, item: it, el: clone,
    ox: CELL / 2, oy: CELL / 2, rot: 0, grabCell: [0, 0],
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
}

/** A detached copy of an item for the cursor to carry around. */
function makeFloatingItem(it: Item): HTMLDivElement {
  const def = ITEM_DEFS[it.defId];
  const cells = rotatedShape(def.shape, it.rot);
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const node = el('div', {
    class: 'gitem',
    style: 'position:fixed;pointer-events:none;background:transparent;border:none;width:'
      + px(w) + 'px;height:' + px(h) + 'px',
  });
  for (const [cx, cy] of cells) {
    node.append(el('div', {
      style: [
        'position:absolute',
        'left:' + cx * (CELL + GAP) + 'px', 'top:' + cy * (CELL + GAP) + 'px',
        'width:' + CELL + 'px', 'height:' + CELL + 'px',
        'background:' + def.color,
        'border:1.5px solid ' + RARITY_COLOR[it.rarity],
        'border-radius:5px',
      ].join(';'),
    }));
  }
  node.append(el('div', {
    class: 'lbl',
    style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center',
  }, shortName(it.name)));
  return node;
}

function onKey(e: KeyboardEvent): void {
  if (!drag) return;
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    drag.rot = ((drag.rot + 1) & 3) as 0 | 1 | 2 | 3;
    const nel = makeFloatingItem({ ...drag.item, rot: drag.rot });
    drag.el.replaceWith(nel);
    drag.el = nel;
    drag.ox = CELL / 2; drag.oy = CELL / 2;
    drag.grabCell = [0, 0];
    onMove({ clientX: lastX, clientY: lastY } as PointerEvent);
  }
}

let lastX = 0, lastY = 0;

function onMove(e: PointerEvent): void {
  if (!drag) return;
  lastX = e.clientX; lastY = e.clientY;
  drag.el.style.left = (e.clientX - drag.ox) + 'px';
  drag.el.style.top = (e.clientY - drag.oy) + 'px';

  for (const v of mounted) v.ghost.style.display = 'none';
  for (const z of dropZones) z.hi?.classList.remove('hot');
  for (const sv of slots) sv.host.classList.remove('hot', 'nope');

  for (const sv of slots) {
    if (!sv.contains(e.clientX, e.clientY)) continue;
    sv.host.classList.add(sv.opts.accepts(drag.item) ? 'hot' : 'nope');
    return;
  }

  const target = [...mounted].find((v) => v.opts.editable !== false && v.contains(e.clientX, e.clientY));
  if (target) {
    const c = target.cellAt(e.clientX, e.clientY);
    if (c) {
      const gx = c[0] - drag.grabCell[0], gy = c[1] - drag.grabCell[1];
      const cells = rotatedShape(ITEM_DEFS[drag.item.defId].shape, drag.rot);
      const w = Math.max(...cells.map((x) => x[0])) + 1;
      const h = Math.max(...cells.map((x) => x[1])) + 1;
      const probe = { ...drag.item, rot: drag.rot };
      const ok = drag.from && target.opts.grid === drag.from.opts.grid
        ? canPlace(target.opts.grid, probe, gx, gy, drag.rot)
        : canPlaceForeign(target.opts.grid, probe, gx, gy, drag.rot);
      const g = target.ghost;
      g.style.display = 'block';
      g.className = 'ghost ' + (ok ? 'ok' : 'bad');
      g.style.left = (gx * (CELL + GAP)) + 'px';
      g.style.top = (gy * (CELL + GAP)) + 'px';
      g.style.width = px(w) + 'px';
      g.style.height = px(h) + 'px';
    }
    return;
  }
  for (const z of dropZones) {
    if (z.test(e.clientX, e.clientY)) z.hi?.classList.add('hot');
  }
}

function canPlaceForeign(g: Grid, it: Item, gx: number, gy: number, rot: number): boolean {
  // the item is not in this grid yet, so nothing to ignore
  return canPlace(g, it, gx, gy, rot);
}

function onUp(e: PointerEvent): void {
  if (!drag) return;
  const d = drag;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('keydown', onKey);
  d.el.remove();
  for (const v of mounted) v.ghost.style.display = 'none';
  for (const z of dropZones) z.hi?.classList.remove('hot');
  for (const sv of slots) sv.host.classList.remove('hot', 'nope');
  drag = null;

  // dropped onto a paper-doll slot
  for (const sv of slots) {
    if (!sv.contains(e.clientX, e.clientY)) continue;
    if (sv.opts.accepts(d.item)) sv.opts.set(d.item);
    redrawAll();
    sv.opts.onChange?.();
    return;
  }

  const target = [...mounted].find((v) => v.opts.editable !== false && v.contains(e.clientX, e.clientY));
  if (target) {
    const c = target.cellAt(e.clientX, e.clientY);
    if (c) {
      const gx = c[0] - d.grabCell[0], gy = c[1] - d.grabCell[1];
      if (d.fromSlot) {
        const probe = { ...d.item, rot: d.rot };
        if (canPlace(target.opts.grid, probe, gx, gy, d.rot)) {
          d.fromSlot.opts.set(null);
          place(target.opts.grid, d.item, gx, gy, d.rot);
        }
      } else if (d.from && target.opts.grid === d.from.opts.grid) {
        const old = { gx: d.item.gx, gy: d.item.gy, rot: d.item.rot };
        remove(target.opts.grid, d.item.uid);
        if (!place(target.opts.grid, d.item, gx, gy, d.rot)) {
          place(target.opts.grid, d.item, old.gx, old.gy, old.rot);
        }
      } else {
        const probe = { ...d.item, rot: d.rot };
        if (canPlace(target.opts.grid, probe, gx, gy, d.rot)) {
          if (d.from) remove(d.from.opts.grid, d.item.uid);
          place(target.opts.grid, d.item, gx, gy, d.rot);
        }
      }
    }
    redrawAll();
    target.opts.onChange?.();
    if (d.from) d.from.opts.onChange?.();
    return;
  }

  if (d.from) {
    for (const z of dropZones) {
      if (z.test(e.clientX, e.clientY)) {
        if (z.accept(d.item, d.from)) {
          redrawAll();
          d.from.opts.onChange?.();
          return;
        }
      }
    }
  }
  redrawAll();
}

function redrawAll(): void {
  for (const v of mounted) v.render();
  for (const sv of slots) sv.render();
}

export function cancelDrag(): void {
  if (!drag) return;
  drag.el.remove();
  redrawAll();
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('keydown', onKey);
  drag = null;
}
