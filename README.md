# Heirloom

A top-down fantasy RPG roguelite where **the run is a life and the save is a bloodline**.
You die, an heir is rolled with random stats and a random face, the village ages around
you, and a slice of what you learned survives as instinct.

Working prototype. All art is canvas primitives — no sprites yet.

## Run it

```bash
npm install
npm run dev
```

`npm run check` typechecks. Save lives in `localStorage` under `heirloom.save.v2`;
`HEIRLOOM.wipe()` in the console starts over.

## Controls

| | |
|---|---|
| `WASD` | walk |
| mouse | aim |
| left click | attack |
| `Space` | dash (i-frames, costs stamina and a charge) |
| `E` | enter a building / leave a zone |
| `Tab` | kit — paper doll and pack |
| `C` | character — attributes and skills |
| `K` | techniques — the movement tree |
| `M` | gate, from anywhere in town |

## The loop, as built

1. **Town** — walk around a 3/4 top-down village.
2. **Guild** — a portrait-and-textbox conversation with the guildmaster, then the board:
   cull N boars, fell N trees, mine N ore, or a boss hunt. The shopkeeper and smith work the
   same way, and they remember your family — NPCs are regenerated each era as their own
   descendants, inheriting their parent's surname and most of their face.
3. **Gate** — pick a zone and travel.
4. **Zone** — real-time combat. The same swing chops trees and breaks rocks. Drops fall on
   the ground, magnetise toward you, and land in your pack if there is room.
5. **Back to town** — sell, enhance, work the homestead, turn the contract in.
6. **Die** — and generation +1 begins.

## Systems

**Kit: slots plus a pack.** Five paper-doll slots (weapon, off-hand, head, body, feet) that
you can *see* on the character — the sprite is drawn from what you are wearing, weapon in
hand and swinging through the arc. Everything else lives in a 7×6 Tetris grid: loot,
consumables, and trinkets, which work Backpack-Battles style from wherever they sit. Space
still costs you something, but your sword is no longer competing with six boar hides. Drag
onto a slot or double-click; `R` rotates while dragging. Extra rows are bought at the
smithy and die with you.

**Skills (Runescape/Valheim rule).** Nine skills — bladework, sorcery, hunting, slaying,
woodcutting, mining, haggling, vigor, footwork — level from *doing the thing*. No class
levels. Vigor levels by getting hit; footwork by covering ground and by dodging attacks on
i-frames.

Every skill does something you can feel, and the character sheet prints the per-level
effect in plain text. XP floats off you in the skill's colour as you earn it, a bar at the
bottom of the screen names the discipline you are currently training, and a level-up bursts
particles and shows the new number. Levelling Vigor raises your max health mid-fight and
you watch the bar grow.

**Movement and techniques (`K`).** Nine techniques on a small tree: extra dash charges,
longer i-frames, momentum, a dash that knocks enemies down, and finally Blink. They cost
**Memory**, earned by living a life worth remembering, and they are **bloodline knowledge** —
learned once, never lost. This is the meta-progression that is not a stat.

**Feel.** Hit stop on every impact, screen shake scaled to what caused it, knockback and
stun, squash on the struck enemy, particle bursts for hits, crits, kills, chops and dashes,
damage numbers that scale with the damage, a light beam over rare drops, a red pulse under
28% health, and a white flash on a kill.

**Death and inheritance.** On death you keep 25% of every skill's XP (rising with
generation), the heirloom chest at home, the homestead, 25% of your coin, a permanent
bloodline stat bonus earned by lifetime deeds, and the Memory your life was worth. You lose
the pack and everything you were wearing.

**The heir.** Stats are rolled on a bell curve, so most heirs are unremarkable and
occasionally one is a monster (or a wreck). Looks are rolled. One of 11 traits — Prodigy,
Ironblood, Mageborn, Merchant Blood, Sickly, Ill-Starred and so on — several deliberately
double-edged.

**The living village.** Prosperity 0–100 drives two presets, *thriving* and *struggling*,
which change stock quality, contract pay, prices, how many people are on the street, and
what the NPCs say to you. It drifts down when a hero is buried and up from completed
contracts and donations. Donations carry across generations.

**Homestead incremental.** Four plots (Herb Patch, Orchard, Ore Vein, Crystal Font). Click
to work them, or hire hands to produce while you are out adventuring — including while the
tab is closed, capped at 8 hours. Gem Dust from the Crystal Font is the enhancement
currency at the smithy (+12% per level).

## Layout

```
src/
  game/
    types.ts       shared shapes, skill effect text, equip slots
    rng.ts         seeded RNG, bell curves for heir rolls
    items.ts       item defs, tetromino shapes, rarity + affix generation
    backpack.ts    grid occupancy, placement, stacking
    bloodline.ts   heir rolls, traits, XP curve, village + NPC descent
    content.ts     monsters, zones, quest generation, shop pools
    techniques.ts  the movement tree and what a dash currently does
    state.ts       GameState, derived stats, equipment, save/load, death
    zone.ts        combat sim: mobs, nodes, drops, dash, hitstop, particles
    town.ts        village sim + render
  render/
    view.ts        top-down projection + camera (swap this to change perspective)
    draw.ts        entity drawing, the paper doll, and the VN portraits
    look.ts        maps equipped items to what the paper doll draws
  ui/
    grid.ts        the drag-and-drop pack grid and the paper-doll slots
    panels.ts      kit, character, techniques, guild, shop, smithy, homestead, gate
    dialogue.ts    the visual-novel conversation screen
    talk.ts        what each NPC says, given the state of the world
    hud.ts, dom.ts
  main.ts          scene machine, input, game loop
```

Perspective lives entirely in `render/view.ts` — it started isometric and became top-down
by rewriting that one file plus the depth sort. The renderer is deliberately kept behind
that seam so a WebGL sprite batcher can replace it later without touching game code.

## Platform note

This stays a web build. Canvas 2D handles a few hundred sprites a frame comfortably; past
that the swap is to a WebGL batcher, same TypeScript. For a desktop or Steam release the
same build wraps in **Tauri** (~8 MB installer, system webview) or Electron. Nothing on the
roadmap — 2D sprites, music, a bigger village — comes close to needing a different engine.

## Known rough edges

- Art is all canvas primitives. No sprites yet, but gear changes the character, so the
  paper-doll layering is in place for when sprites land.
- No collision with buildings, trees or rocks — you walk through everything.
- No sound at all. This is the biggest missing multiplier on how the hits feel.
- Monster AI is chase-and-swing with a telegraph ring. No packs, no ranged enemies.
- Boss contracts spawn the boss but there is no arena or fight structure.
- The classes differ by starting gear, stat weights and weapon style; no class abilities
  beyond the shared dash.
- Village presets are two colour/population states, not the bigger-or-smaller layouts
  originally described.

## Next up (rough order)

1. Sound — hits, footsteps, level-ups, a town theme and a field theme.
2. Collision, so terrain is something you move around rather than through.
3. Class abilities on a hotbar so warrior and wizard actually play differently.
4. Adjacency bonuses in the pack — the other half of the Backpack Battles idea.
5. Sprites, replacing primitives layer by layer behind the same paper-doll API.
6. Village layout that visibly grows or rots with prosperity.
7. More zones, elite spawns, a real boss fight.
