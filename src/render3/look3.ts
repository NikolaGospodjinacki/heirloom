import type { Item, Silhouette } from '../game/types';
import { EQUIP_SLOTS, RARITY_COLOR } from '../game/types';
import { ITEM_DEFS } from '../game/items';

export interface GearPiece { vis: Silhouette; color: string; glow: string | null }
export interface GearLook {
  weapon: GearPiece | null;
  offhand: GearPiece | null;
  head: GearPiece | null;
  body: GearPiece | null;
  feet: GearPiece | null;
  tool: GearPiece | null;
}

export const NO_GEAR: GearLook = {
  weapon: null, offhand: null, head: null, body: null, feet: null, tool: null,
};

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

export function gearLook3(equipped: Record<string, Item | null>): GearLook {
  const out: GearLook = { ...NO_GEAR };
  for (const s of EQUIP_SLOTS) out[s] = piece(equipped[s] ?? null);
  return out;
}

/** What the hand shows while chopping: the tool, not the sword. */
export function handLook(look: GearLook, harvesting: boolean): GearLook {
  if (!harvesting || !look.tool) return look;
  return { ...look, weapon: look.tool };
}
