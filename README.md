# Voxel Defense

A 3D voxel-style tower defense game built with [Three.js](https://threejs.org/), with Minecraft-inspired menus.

## Running

The game is a fully static site (no build step, Three.js and the font are vendored). Serve the folder with any static web server and open `index.html`, for example:

```bash
npx serve .
# or
python -m http.server 8000
```

Opening `index.html` directly from disk (`file://`) will not work because the browser blocks loading `data/config.json`.

## Controls

| Input | Action |
| --- | --- |
| Left click tower | Build / upgrade a defense |
| Drag, WASD / arrows | Pan the camera |
| Mouse wheel | Zoom |
| Space | Start the next wave |
| 1 / 2 / 3 | Game speed |
| Esc | Close panel / pause menu |

## Tweaking gameplay

All gameplay numbers live in [`data/config.json`](data/config.json); edit and reload:

- `game` – starting credits, castle health, wave duration, default spawn window, first spawn delay, fire damage, credits per difficulty.
- `enemies` – hitpoints, speed, castle damage and attack interval per enemy type.
- `defenses` – cost, damage, fire interval, range, projectile speed/gravity, splash radius, and every upgrade's cost, max level and effect.
- `waves.list` – per-wave enemy counts, speed/health multipliers, survival bonus and `spawnWindowSeconds` (all of that wave's enemies spawn within this window; smaller = denser and harder); `waves.beyondList` controls how waves grow after the list ends.

The catapult placement cost was not specified in the design, so it defaults to 250 credits.

## Project layout

```
index.html          HTML shell + menus
css/style.css       Minecraft-style UI
data/config.json    Gameplay data
js/main.js          Boot (loads config)
js/game.js          Game state, waves, economy, camera, input
js/world.js         Terrain, path, trees, towers, castle
js/voxel.js         Face-culled voxel mesh builder
js/rig.js           Box-rig humanoids with two-bone IK
js/enemies.js       Soldiers, shielded soldiers, battering rams, bombers
js/defenses.js      Archers, ballista, catapult + upgrades
js/projectiles.js   Ballistic arrows / bolts / boulders
js/particles.js     Debris piles, fire, smoke, explosions, trails
js/audio.js         Synthesized sound effects
js/ui.js            HUD, tower panel, menus, pixel icons
vendor/three/       Three.js r170 (MIT)
fonts/              Pixelify Sans (OFL)
```
