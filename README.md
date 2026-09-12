# Heirloom

A top-down fantasy RPG roguelite where **the run is a life and the save is a bloodline**.
You die, an heir is rolled with random stats and a random face, the village ages around
you, and a slice of what you learned survives as instinct.

Working prototype. Everything is placeholder art (canvas primitives, no sprites yet).

## Run it

```bash
npm install
npm run dev
```

`npm run check` typechecks. Save lives in `localStorage` under `heirloom.save.v1`;
`HEIRLOOM.wipe()` in the console starts over.

## The loop, as built

1. **Town** — walk around a 3/4 top-down village. `E` at a building to enter it.
2. **Guild** — take a contract: cull N boars, fell N trees, mine N ore, or a boss hunt.
3. **Gate** — pick a zone and travel.
4. **Zone** — real-time combat. WASD moves, the cursor aims, space or click swings.
   The same swing chops trees and breaks rocks. Drops fall on the ground and get
   vacuumed into your pack if there is room.
5. **Back to town** — `E` on the road-home pad. Sell at the store, enhance at the smithy,
   click the homestead for resources, turn the contract in.
6. **Die** — and generation +1 begins.

## Systems

**Pack (Backpack Battles rule).** One grid, 7x6 to start. Gear only gives stats **while it
is in the bag**, so carrying loot home costs you power on the way. Items are Tetris shapes;
drag to arrange, `R` rotates while dragging. Buy extra rows at the smithy — the bigger pack
dies with you.

**Skills (Runescape/Valheim rule).** Eight skills — bladework, sorcery, hunting, slaying,
woodcutting, mining, haggling, vigor — level from *doing the thing*. No XP bar, no class
levels. Vigor levels by getting hit.

**Death and inheritance.** On death you keep:
- 25% of every skill's XP (rising with generation), as the heir's starting instinct
- everything in the heirloom chest at home
- the homestead: plots, hired hands, stored resources
- 25% of your coin
- a permanent bloodline stat bonus earned by lifetime deeds

You lose the pack and everything in it.

**The heir.** Stats are rolled on a bell curve, so most heirs are unremarkable and
occasionally one is a monster (or a wreck). Looks are rolled. One of 11 traits — Prodigy,
Ironblood, Mageborn, Merchant Blood, Sickly, Ill-Starred and so on — some of which are
double-edged on purpose.

**The living village.** Prosperity 0–100 drives two presets, *thriving* and *struggling*,
which change stock quality, contract pay, prices, and how many people are on the street.
It drifts down when a hero is buried and up from completed contracts and donations.
Donations carry across generations — this is the long incremental lever. NPCs are
regenerated with new names each era: the shopkeeper is the old shopkeeper's descendant.

**Homestead incremental.** Four plots (Herb Patch, Orchard, Ore Vein, Crystal Font).
Click to work them, or hire hands to produce while you are out adventuring — including
while the tab is closed, capped at 8 hours. Gem Dust from the Crystal Font is the
enhancement currency at the smithy (+12% per level).

## Layout

```
src/
  game/
    types.ts       shared shapes
    rng.ts         seeded RNG, bell curves for heir rolls
    items.ts       item defs, tetromino shapes, rarity + affix generation
    backpack.ts    grid occupancy, placement, stacking
    bloodline.ts   heir rolls, traits, XP curve, village generation
    content.ts     monsters, zones, quest generation, shop pools
    state.ts       GameState, derived stats, save/load, death & inheritance
    zone.ts        combat sim: mobs, nodes, drops, projectiles
    town.ts        village sim + render
  render/
    view.ts        top-down projection + camera (swap this to change perspective)
    draw.ts        all entity drawing
  ui/
    grid.ts        the drag-and-drop pack grid
    panels.ts      guild, shop, smithy, homestead, character, gate
    hud.ts, dom.ts
  main.ts          scene machine, input, game loop
```

Perspective lives entirely in `render/view.ts` — it started isometric and became top-down
by rewriting that one file plus the depth sort.

## Known rough edges

- Art is all primitives. No sprites, no animation beyond a walk bob.
- No collision with buildings, trees or rocks — you walk through everything.
- No sound.
- Monster AI is chase-and-swing with a telegraph ring. No packs, no ranged enemies.
- Boss contracts spawn the boss but there is no arena or fight structure.
- The two classes differ only by starting gear and stat weights; no abilities yet.
- Village presets are two, not the "bigger or smaller village" layouts described.

## Next up (rough order)

1. Collision + a reason to path around things.
2. Abilities/hotbar so warrior and wizard actually play differently.
3. Adjacency bonuses in the pack (the other half of the Backpack Battles idea).
4. Sprites.
5. Village layout that visibly grows or rots with prosperity.
6. More zones, elite spawns, a real boss fight.
