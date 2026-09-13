import type { Item } from '../game/types';
import { RARITY_COLOR, EQUIP_SLOTS } from '../game/types';
import { ITEM_DEFS } from '../game/items';
import type { GearLook, GearPiece } from './draw';
import { NO_GEAR } from './draw';

function piece(it: Item | null): GearPiece | null {
  if (!it) return null;
  const d = ITEM_DEFS[it.defId];
  if (!d.visual) return null;
  return {
    vis: d.visual,
    color: d.tint ?? d.color,
    glow: it.rarity === 'common' || it.rarity === 'uncommon' ? null : RARITY_COLOR[it.rarity],
  };
}

/** Turn the five equipped slots into something the paper doll can draw. */
export function gearLook(equipped: Record<string, Item | null>): GearLook {
  const out: GearLook = { ...NO_GEAR };
  for (const s of EQUIP_SLOTS) out[s] = piece(equipped[s] ?? null);
  return out;
}

/** What the hand actually swings: the weapon, or the tool when harvesting. */
export function swingPiece(look: GearLook, harvesting: boolean): GearLook {
  if (!harvesting || !look.tool) return look;
  return { ...look, weapon: look.tool };
}
