# Heirloom

A first-person fantasy RPG roguelite where **the run is a life and the save is a bloodline**.
You die, an heir is rolled with random stats and a random face, the village ages around
you, and a slice of what you learned survives as instinct.

Working prototype. Low-poly three.js, no imported art yet — every mesh is built from boxes,
cones and spheres in code.

**Two builds ship from this repo.** `/` is the first-person 3D game. `/2d/` is the original
top-down version, preserved, still playable, with its own save. There is a link between them
in the bottom corner of each.

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
| `WASD` | walk, relative to where you are looking |
| mouse | look (click once to capture the pointer) |
| left click | attack |
| `Q` `E` `R` `F` | the four skills (also `1` `2` `3` `4`) |
| `Space` | jump (airborne clears anything swinging at knee height) |
| `Shift` / right click | dash (i-frames, costs stamina and a charge) |
| `E` | enter a building, in town |
| `X` | leave a zone, standing on the road-home pad |
| `Tab` | kit — paper doll and pack |
| `C` | character — attributes and skills |
| `K` | techniques — the movement tree |
| `M` | gate, from anywhere in town |

## The loop, as built

1. **Town** — walk around a 3/4 top-down village.
2. **Guild** — a portrait-and-textbox conversation with the guildmaster, then the board:
   cull N boars, fell N trees, mine N ore, or a boss hunt. The shopkeeper, smith and
   innkeeper work the same way, and they remember your family — NPCs are regenerated each
   era as their own descendants, inheriting their parent's surname and most of their face.
   Everyone else in town — kids, elders, stallholders, the gate watch, the cat — has a
   couple of lines and a face of their own.
3. **Gate** — pick a zone and travel.
4. **Zone** — real-time combat. The same swing chops trees and breaks rocks. Drops fall on
   the ground, magnetise toward you, and land in your pack if there is room.
5. **Back to town** — sell, enhance, work the homestead, turn the contract in.
6. **Die** — and generation +1 begins.

## How the 3D conversion works

The renderer was replaced; the game was not. Everything in `game/` — the combat simulation,
boss move lists, terrain elevation, drops, XP, inheritance, the village — is unchanged, and
so is every DOM panel. The simulation always described the world as an x/y ground plane plus
a height, so the bridge to three.js is one mapping: sim `(x, y, z)` becomes world
`(x, z, y)` at 1/20 scale. Nothing under `game/` knows that 3D exists.

Both builds in this repo therefore run the *same* simulation, drawn two different ways,
which is most of why keeping the top-down version costs nearly nothing.

What genuinely changed by going first person:

- **You aim with your face.** Things flank you unseen. Floor telegraphs still read, but only
  the ones in front of you.
- **Melee is harder to sell** than a top-down arc. There is a weapon in view that swings and
  a crosshair that brightens off cooldown, but this needs more work than the 2D version did.
- **Verticality got much better.** Jumping onto a ledge is legible now in a way the top-down
  build never managed.
- **You cannot see your own gear.** The paper doll moved to your hands — the weapon and
  shield you equipped are the ones held in front of the camera — and the kit screen still
  shows the whole character.

## The town

The starting village is the cosy part, and it is built like one: a **city gate** with a
stone wall, a raised portcullis and two guards who will talk to you; a **cobbled square**
with a well, market stalls and flower beds; a **shop street** of connected timber-framed
townhouses (bakery, general store, apothecary, smithy, tailor) with lit windows and smoking
chimneys; **the Gilded Sow**, where a bed restores everything and the innkeep trades
rumours; the **Adventurers Guild** with a fenced **training yard** of practice dummies and
weapon racks; and your **homestead** with its garden rows and laundry line.

It is lit for late afternoon: lantern glow pools on the cobbles, motes drift through the
air, banners sway, and a golden-hour wash sits over the whole thing. Buildings and walls
are solid — you walk around them, sliding along instead of sticking.

A thriving village has more stalls, more people, greener trees and flowers in the hedges. A
struggling one is emptier and greyer, and everybody says so.

## Skills on the bar

Four abilities, class-specific, on **Q E R F** (W is a foot, so the second slot moved to F;
`1`-`4` work too). Warriors pay **stamina**, so every skill competes with a dash. Wizards
pay **mana**, so every skill competes with attacking.

| | Warrior | Wizard |
|---|---|---|
| Q | **Cleave** — 160% in a wide arc, shoves everything back | **Frost Lance** — pierces a line for 150% and halves their speed |
| F | **Shield Bash** — shoulder forward, stun a second and a half | **Arcane Nova** — detonate where you stand, throw everything off |
| E | **Rally** — heal a fifth, +35% damage for six seconds | **Mana Font** — 45% mana back and a shield worth a quarter of your health |
| R | **Whirlwind** — spin for 1.5s hitting everything, four times, while walking | **Meteor** — a rock lands where the cursor is, for 320% |

## Terrain and the climb

Zones have real elevation. Ledges have to be **jumped onto** — a short hop will not clear the
lip — and you can walk off them and fall. **Ravines** are walls until you are airborne, and
landing in one hurts. **Cinder Ridge** is five stepped tiers climbing north with something
asleep at the top, snow-capped peaks parallaxing behind it.

## Bosses

Five, each with a named move set, floor telegraphs and a health bar across the top:

- **Fangmaw** — maul, pounce, and a howl that brings wolves
- **The Grovewarden** — swipe, a charge across the clearing, and a stomp
- **The Quarry Golem** — slam, a three-boulder volley, and a backhand
- **The Hollow King** — reap, grasping dark, and a call for the court
- **Emberwyrm** — ember breath in a cone, wing buffet, tail sweep behind, cinder spit

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

**Tools have their own slot.** Chopping and mining are driven by whatever is in the **tool**
slot, never by your weapon — so a wizard with a pickaxe mines exactly as well as a warrior
with one, without holstering the staff. Walking up to a tree turns your attack into a
harvest swing automatically. Bare hands work, barely.

**Movement and techniques (`K`).** Twelve techniques on a small tree: the vault, extra dash
charges, longer i-frames, momentum, a dash that knocks enemies down, a pounce that hits
harder out of the air, and finally Blink. They cost **Memory**, earned by living a life
worth remembering, and they are **bloodline knowledge** — learned once, never lost. This is
the meta-progression that is not a stat.

Dashes are burst mobility, not flight: 26 stamina each, a hard gap between them, and
stamina stops regenerating for a moment afterwards. Chaining three is a decision, not a
default.

**Casting has a cost.** A bolt roots you to a shuffle for a quarter of a second while a
ring fills under your feet, drains a real bite of a small mana pool, and travels slowly
enough to miss. Staves reach about 170px, not across the field. And half the bestiary now
shoots back — slingers, spitters and hexers keep their distance and punish standing still,
while wolves telegraph a leap that closes the gap.

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
    view.ts        the old top-down projection, still used by the 2D build
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

- Every mesh is code-built primitives. No models, no textures beyond a generated ground map.
- No collision against trees or rocks in the field. Town buildings and walls are solid.
- Melee feedback in first person is the weakest part: it wants a camera kick on impact and
  a sound before it really lands.
- No sound at all. This is the biggest missing multiplier on how the hits feel.
- Ordinary monster AI is chase, shoot, or leap. Bosses pick from a move list. No packs yet.
- No co-op. See below.
- Boss contracts spawn the boss but there is no arena or fight structure.
- The classes differ by starting gear, stat weights and weapon style; no class abilities
  beyond the shared dash.
- Village presets are two colour/population states, not the bigger-or-smaller layouts
  originally described.

## Hosting

Pushed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`, as two
pages out of one Vite build: `/` for the 3D game (677 KB, 189 KB gzipped, mostly three.js)
and `/2d/` for the original (178 KB, 61 KB gzipped). No backend; the two saves use separate
`localStorage` keys so the builds never tread on each other.

## On co-op

Not built, and not something to bolt on quickly. The honest shape of it:

- **Static hosting cannot do it.** Real-time co-op needs either a relay server or WebRTC
  peer-to-peer with a signalling broker.
- **The design is single-player at the root.** Death rolls an heir and ages the village.
  Two players sharing one village needs an answer for whose bloodline it is, what happens
  when one dies, and whether the pack is shared. That is a design question before it is a
  networking one.
- **The cheap version that would actually work:** host-authoritative WebRTC, one player
  hosts and shares a room code, the host simulates all monsters and the guest sends inputs
  and gets snapshots. Two-player only, drop-in for a single zone run, town stays solo.
  That is a focused project, not an afternoon.

## Next up (rough order)

1. Sound — hits, footsteps, level-ups, a town theme and a field theme. First person needs it
   more than top-down did: it is most of what tells you something is behind you.
2. Co-op over WebRTC, if the hosted build gets people playing.
2. Collision in the field too — town is solid, zones are not yet.
3. Class abilities on a hotbar so warrior and wizard actually play differently.
4. Adjacency bonuses in the pack — the other half of the Backpack Battles idea.
5. Sprites, replacing primitives layer by layer behind the same paper-doll API.
6. Village layout that visibly grows or rots with prosperity.
7. More zones, elite spawns, a real boss fight.
