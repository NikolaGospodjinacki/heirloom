# Heirloom

An HD-2D fantasy roguelite where **the run is a life and the save is a bloodline**.
You die, an heir is rolled with random stats and a random face, the village ages around
you, and a slice of what you learned survives as instinct.

Eighty-three years ago the Hero, Edric Harrow, a lantern-carrier from the village of
Ashford, ended the Ashen Sovereign's Long Night. The Hero is long dead. The elf who
travelled with him is still sitting in Ashford's Adventurers Guild, watching your family
walk in and out of the door one generation at a time. You start on a copper plate.

Working prototype. Painted 2D characters and props stand in a small 3D diorama under a
tilted camera with tilt-shift, bloom and real shadows. No imported art yet: every sprite is
drawn in code, and every building is a box with its facade painted on in code.

**Play it:** https://nikolagospodjinacki.github.io/heirloom/ — and the original top-down
build, kept playable, at https://nikolagospodjinacki.github.io/heirloom/2d/.

## Playing together

Press **P** in game.

- **Host a party** gives you a five-letter code and an invite link. Send the link.
- **Join** with a code, or just open the invite link. Someone without a save makes a
  character first and joins as soon as they have picked a class.

Everyone plays their own hero from their own save. When the host sets out from the gate,
the whole party follows into the same zone; guests cannot pick the destination. Each
friend makes the monsters about half again as tough. Bosses and bounties from anyone's
contract spawn for the whole party. Loot is rolled for each player separately, kills in
range count for everyone, and if you hit zero health you go **down** instead of dying: a
friend has thirty seconds to hold **X** beside you and pull you back up. The host leaving
the zone (or dying) brings everyone home.

How it works: one player hosts under a room code on PeerJS's free public matchmaking
server and everyone connects straight to them over WebRTC. There is no game server, so the
whole thing still lives on GitHub Pages. The host runs the monsters; each player runs their
own hero and tells the host what they hit. A host who tabs away keeps the party running
from a background worker.

Direct connections work on the same Wi-Fi and on most home networks. A strict office or VPN
firewall can block them; a phone hotspot almost always gets through.

## Run it

```bash
npm install
npm run dev
```

`npm run check` typechecks. Saves live in `localStorage` under `heirloom.save.v2`; add
`?slot=name` to the URL for a separate save on the same machine (handy for testing a party
in two tabs). `HEIRLOOM.wipe()` in the console starts that slot over.

## Controls

| | |
|---|---|
| `WASD` | walk (up the screen is north) |
| mouse | aim, wherever the cursor meets the ground |
| left click | attack |
| mouse wheel | zoom |
| `Q` `E` `R` `F` | the four skills (also `1` `2` `3` `4`) |
| `Space` | jump |
| `Shift` / right click | dash |
| `E` | talk, enter, use (in town and in the guild) |
| `X` | in a zone: leave on the bridge, search a lost cache, hold to revive a friend |
| `Tab` / `C` / `K` | kit, character, techniques |
| `P` | party |
| `M` | the gate, from anywhere in town |

## The world

- **Ashford.** A walled town with a moat and one bridge. The Hero's statue stands in the
  square. The road south past the bridge is the way out.
- **The Adventurers Guild** is a room you walk into: the clerk at the counter hands out
  plates and work, Garran Holt by the fire runs promotion trials, Sylwen sits by the window
  and remembers every one of your ancestors, and a local party drinks in the corner.
  The walls hold the quest board, the Registry of Plates, your family's trophies and the
  Wall of Names.
- **Adventurer ranks**, F to S: copper, iron, bronze, silver, gold, mithril, adamant.
  Contracts earn merit; enough merit gets you a trial; beating the trial boss gets you the
  next plate. Each plate adds damage and health, opens a new zone, and shows on your hero
  as a chest plate, then a scarf, then a cape. Heirs start partway up the ladder, based on
  the best plate the family ever wore.
- **The story** comes out a piece at a time with each promotion: the Hollowing that swells
  beasts and wakes the dead, the Hero's squire who became the Hollow King, and the last
  Herald of the Sovereign, who was never found.

| Plate | Zone | Trial boss |
|---|---|---|
| F copper | Kestrel Meadow | Old Tusker |
| E iron | Thornwood | The Grovewarden |
| D bronze | Mireholt Fen | Fangmaw |
| C silver | The Sunken Barrows | The Hollow King |
| B gold | Greyspine Peak | Stormtalon |
| A mithril | The Ashen Field | Vessarine, Herald of Ash |

The Quarry Golem roams Greyspine Peak on contract once you are gold.

**The quest board** always has two contracts at your plate, an easy one, one a plate above
you, and usually a bounty. Contract types: culls, gathering, recovering lost belongings
hidden in the zone, bounties on named elites, and boss hunts for zones you have already
cleared.

## Terrain

Zones are Minecraft-style heightmaps. Every tile is a column: step up one level by walking,
two by jumping, three with the High Vault technique, and anything taller is a wall. You can
walk off any edge. Ravines are real holes you fall into. A river runs along the south of
every zone with a bridge out, cliffs and treelines close in the other sides, and the land
carries on past the map into hills, woods or peaks, so there are no invisible walls.
Greyspine Peak is one big stepped mountain from grass to rock to snow, with a path that
never needs a jump and plenty of shortcuts that do. Monsters climb one step at a time, so
high ground is a real tactic, and a see-through silhouette shows your hero behind anything
tall.

## Systems

**Kit: slots plus a pack.** Six paper-doll slots (weapon, off-hand, head, body, feet, tool)
you can see on the character, and a Tetris grid for everything else. Trinkets work from
wherever they sit.

**Skills (Runescape/Valheim rule).** Nine skills level from doing the thing: bladework,
sorcery, hunting, slaying, woodcutting, mining, haggling, vigor, footwork. The character
sheet prints what each level does.

**Skills on the bar.** Four abilities per class on Q E R F. Warriors pay stamina, wizards
pay mana.

**Movement techniques.** Dashes, the vault, pounce, blink and more, bought with Memory
earned by living a life worth remembering, and kept by the bloodline forever.

**Bosses** each have a named move set with floor telegraphs: arcs, charges, slams, cones,
volleys and summons.

**Death and inheritance.** You keep a share of every skill, the heirloom chest, the
homestead, some coin, Memory and the family's renown. The pack and everything worn is
buried with you, and your name goes on the Wall of Names.

**The living village.** Prosperity moves the village between thriving and struggling,
which changes stock, prices, pay and how many people are out. Shopkeepers, the clerk and
the veteran are replaced by their descendants over the generations. Sylwen is not.

**Homestead incremental.** Four plots worked by hand or by hired hands, including while
the tab is closed.

## How the HD-2D renderer works

The simulation never learned about 3D: sim `(x, y, z)` becomes world `(x, z, y)` at 1/20
scale. The old top-down draw code paints every hero, monster, NPC and prop into small
canvases that become upright cards leaned toward the camera, casting shadows in the shape
of the drawing. Buildings are boxes with painted facades; terrain is merged column tops,
walls and turf lips over one painted ground texture with a world-space grain; the look is
mostly post-processing (tilt-shift, bloom, a grade per place, vignette).

## Layout

```
src/
  game/
    terrain.ts     heightmap generation: columns, ravines, rivers, borders, the mountain
    zone.ts        building a zone, the frame loop, movement, jumping, co-op zone init
    zonecore.ts    zone shapes, effects helpers, the network seam (ZoneNet)
    combat.ts      attacks, abilities, damage, kills and rewards, going down, caches
    mobs.ts        monster and boss brains, targeting across every hero in the zone
    content.ts     monsters, zones, contracts and trials
    ranks.ts       adventurer plates and what they give you
    hall.ts        the inside of the guild
    town.ts        the village: layout, walls, people, walking
    state.ts       save, derived stats, quests and promotion, death and heirs
    ...            items, backpack, bloodline, techniques, abilities
  net/
    peer.ts        PeerJS host and guest connections, room codes
    party.ts       the party protocol: snapshots, hits, kills, hurts, revives
  render/          the 2D drawing code the standees are painted with
  render3/
    terrainMesh.ts the stepped terrain mesh, outlands and ground painting
    zoneView.ts    a zone: terrain, standees, effects, the bridge out
    townView.ts    the village
    hallView.ts    the guild interior
    remotes.ts     your friends' heroes
    ...            camera, sprites, post-processing, overlay labels
  ui/
    story.ts       the world, and everyone in the guild who talks about it
    panels.ts      kit, board, gate, registry, trophies, names, party, shop, smithy
    hud.ts, dialogue.ts, talk.ts, grid.ts, dom.ts
  main.ts          scenes, input, the party glue, the loop
2d/                the original top-down build, untouched
```

## Hosting

Pushed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`, as two
pages out of one Vite build. No backend: parties meet through PeerJS's public server and
then talk directly.

## Known rough edges

- All art is placeholder drawn in code. Real sprites are the biggest upgrade left.
- No sound.
- No collision against trees or rocks in zones.
- Parties connect peer to peer with no relay, so very strict networks can stop a friend
  joining. A TURN relay would fix that and needs an account with a TURN provider.
- If the host's tab closes, the party ends; there is no host migration.

## Next up

1. Real sprites for heroes, monsters and townsfolk.
2. Sound: hits, footsteps, promotions, a town theme and a field theme.
3. A relay fallback for parties behind strict firewalls.
4. Collision in the field.
5. Village layouts that visibly grow or rot with prosperity.
