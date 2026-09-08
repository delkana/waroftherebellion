# War of the Rebellion

A real-time galactic strategy game in the spirit of *Star Wars: Rebellion*, with a
3D hyperlane galaxy map (Empire at War style) and Homeworld-style tactical space battles.
Browser-based: Vite + TypeScript + Three.js, no backend.

## Run

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # unit tests (galaxy gen, pathfinding, sim tick, auto-resolve)
npm run soak       # headless AI-vs-AI 200-day balance run, three seeds
npm run build      # typecheck + production bundle in dist/
```

## The game

- **Two factions.** The Galactic Empire holds the Core Worlds and Coruscant. The Rebel Alliance holds a handful of rim worlds and a **hidden headquarters**.
  The Empire wins by capturing the HQ (it must first find it with espionage); the Rebellion wins
  by taking Coruscant.
- **Real time with speed control.** 1 real second = 1 game hour at 1x. Pause, 1x/2x/4x/8x.
  The game pauses automatically when a battle starts.
- **Hyperlanes.** A sparse, non-crossing web of lanes; fleets travel only along them on shortest paths. Arriving at a system
  with enemy warships or enemy-owned defense platforms triggers a battle.
- **Planets** have loyalty (-100 Empire ... +100 Rebellion) that drives income, uprisings, and
  whether neutral worlds join a side. Owned worlds build ships, troop regiments, shipyard
  upgrades (levels 1-3 gate ship classes) and orbital defense platforms.
- **Leaders** run missions: Diplomacy, Espionage (reveals a system; Imperial agents can locate
  the Rebel base), Sabotage, Incite Uprising. Failed missions on enemy worlds risk capture.
- **Invasion.** Clear the orbit, then land regiments from a fleet with transport capacity.
- **Fog of war.** Enemy fleets are visible only near your worlds, fleets and agents, or via intel.
- **Battles** can be auto-resolved or fought in the tactical view: fully 3D, starfighters fly in
  flights of four that make strafing runs together, capital ships hold at stand-off range, shields
  recharge, ion weapons strip shields, torpedoes home on large hulls. Capital ships die in stages
  with a moment of slow motion. Procedural sound (no assets) for weapons, hits, explosions and
  hyperspace jumps. Retreating fleets jump out after 12 seconds.
- **AI** opponent builds a balanced fleet, hunts your base, launches invasions, and runs its own
  leaders' missions.
- **Save / Load** via the top bar (localStorage).

## Controls

Galaxy map
- Left click: select planet or fleet. Double-click a planet to zoom in.
- Right click on a planet with your fleet selected: send the fleet there (route preview on hover).
- Right-drag: orbit camera. Middle-drag or left-drag on empty space: pan. Wheel: zoom.
- WASD / arrows: pan. Q/E: rotate. F: focus selection. H: jump to your HQ.
- Space: pause. 1-4: speed. Esc: cancel / deselect.
- Touch: one-finger drag pans, pinch zooms, two-finger drag orbits (twist rotates), tap selects,
  long-press a planet to send the selected fleet there.

Tactical battle
- Left click / drag: select own ships (Shift adds, double-click selects a class, Ctrl+A all).
- Right click on an enemy: attack. Right click on space: move on the selection's plane.
  Hold the right button and drag up/down to set the altitude of the move point.
- Middle-drag or Alt+left-drag: orbit. Wheel: zoom. WASD pan, Q/E rotate, F focus.
- Ctrl+1..9 assigns a control group, 1..9 recalls it (twice to focus the camera on it).
- Z / X / C / V: Wall, Wedge, Sphere or Free formation for subsequent move orders. Formations move
  at the speed of the slowest ship.
- Space: pause. - / =: slower / faster. M: sound on/off. Shift+S: stop. Retreat button: withdraw.
- Touch: same camera gestures as the map. Tap a ship to select it (tap again for its class),
  tap an enemy to attack, hold on empty space to move the selection there, hold an enemy to attack.

## Layout

```
src/sim/       pure simulation (no rendering): types, galaxy generation, pathfinding,
               real-time tick & orders, auto-resolve combat, fog of war, AI
src/galaxy/    3D galaxy map view (Three.js + 2D overlay for labels/icons/picking)
src/battle/    tactical battle sim, ship meshes, battle view & controls
src/ui/        DOM HUD (menu, top bar, side panel, log, battle HUD)
src/core/      orbit camera, overlay canvas helper, seeded RNG
tests/         node:test unit tests and the headless soak script
```

Debug hooks in the browser console: `wotr.state()`, `wotr.forceBattle()`, `wotr.tick(seconds)`.
