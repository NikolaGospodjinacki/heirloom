import type { Item } from './types';
import { ITEM_DEFS, itemCells, rotatedShape } from './items';

export interface Grid {
  w: number;
  h: number;
  items: Item[];
}

export function makeGrid(w: number, h: number): Grid {
  return { w, h, items: [] };
}

/** occupancy map -> item uid or null */
export function occupancy(g: Grid, ignoreUid?: string): (string | null)[][] {
  const map: (string | null)[][] = Array.from({ length: g.h }, () => Array(g.w).fill(null));
  for (const it of g.items) {
    if (it.uid === ignoreUid) continue;
    for (const [cx, cy] of itemCells(it)) {
      const x = it.gx + cx, y = it.gy + cy;
      if (y >= 0 && y < g.h && x >= 0 && x < g.w) map[y][x] = it.uid;
    }
  }
  return map;
}

export function canPlace(g: Grid, it: Item, gx: number, gy: number, rot: number): boolean {
  const cells = rotatedShape(ITEM_DEFS[it.defId].shape, rot);
  const map = occupancy(g, it.uid);
  for (const [cx, cy] of cells) {
    const x = gx + cx, y = gy + cy;
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    if (map[y][x]) return false;
  }
  return true;
}

export function place(g: Grid, it: Item, gx: number, gy: number, rot: 0 | 1 | 2 | 3): boolean {
  if (!canPlace(g, it, gx, gy, rot)) return false;
  it.gx = gx; it.gy = gy; it.rot = rot;
  if (!g.items.includes(it)) g.items.push(it);
  return true;
}

export function remove(g: Grid, uid: string): Item | null {
  const i = g.items.findIndex((x) => x.uid === uid);
  if (i < 0) return null;
  return g.items.splice(i, 1)[0];
}

export function itemAt(g: Grid, gx: number, gy: number): Item | null {
  for (const it of g.items) {
    for (const [cx, cy] of itemCells(it)) {
      if (it.gx + cx === gx && it.gy + cy === gy) return it;
    }
  }
  return null;
}

/** First free spot scanning row-major, trying each rotation. Returns false if the bag is full. */
export function autoPlace(g: Grid, it: Item): boolean {
  // stack first if possible
  const d = ITEM_DEFS[it.defId];
  if (d.stackable) {
    const existing = g.items.find((x) => x.defId === it.defId && x.plus === it.plus);
    if (existing) { existing.count += it.count; return true; }
  }
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      for (const rot of [0, 1, 2, 3] as const) {
        if (canPlace(g, it, x, y, rot)) { place(g, it, x, y, rot); return true; }
      }
    }
  }
  return false;
}

export function usedCells(g: Grid): number {
  let n = 0;
  for (const it of g.items) n += itemCells(it).length;
  return n;
}

export function countOf(g: Grid, defId: string): number {
  return g.items.filter((i) => i.defId === defId).reduce((a, b) => a + b.count, 0);
}

export function consumeOf(g: Grid, defId: string, n: number): boolean {
  if (countOf(g, defId) < n) return false;
  let left = n;
  for (let i = g.items.length - 1; i >= 0 && left > 0; i--) {
    const it = g.items[i];
    if (it.defId !== defId) continue;
    const take = Math.min(it.count, left);
    it.count -= take; left -= take;
    if (it.count <= 0) g.items.splice(i, 1);
  }
  return true;
}
