import { Rng } from '../core/rng';
import type { Character, FactionId, Fleet, GameState, Lane, Planet, Ship } from './types';
import { findPath, hopDistances, pathLength } from './pathfinding';
import { CANON_WORLDS } from './canonWorlds';

export interface GenOptions { seed: number; player: FactionId; observer?: boolean }

const MAP_RADIUS = 118;   // game units from the map centre to the farthest world
const MIN_SPACING = 11;    // worlds that share a grid square get nudged apart to at least this

/**
 * Builds the galaxy from the canon layout in canonWorlds.ts. The map itself is fixed;
 * the seed only affects which Rebel stronghold hides the headquarters, the small
 * loyalty and garrison variance, and the AI's dice.
 */
export function generateGalaxy(opts: GenOptions): GameState {
  const r = new Rng(opts.seed);

  // ---- positions: canon coordinates, centred and scaled, with a little vertical scatter ----
  const cx = CANON_WORLDS.reduce((s, w) => s + w.x, 0) / CANON_WORLDS.length;
  const cy = CANON_WORLDS.reduce((s, w) => s + w.y, 0) / CANON_WORLDS.length;
  const far = Math.max(...CANON_WORLDS.map(w => Math.hypot(w.x - cx, w.y - cy)));
  const scale = MAP_RADIUS / far;
  const planets: Planet[] = CANON_WORLDS.map((w, i) => ({
    id: i, name: w.name,
    pos: { x: (w.x - cx) * scale, y: hashNoise(w.name) * 5, z: -(w.y - cy) * scale }, // galactic north = -z
    type: w.type, radius: w.type === 'city' ? 2.1 : 1.2 + (w.production / 16) * 0.9,
    owner: w.owner, loyalty: 0, production: w.production,
    shipyard: w.shipyard, defense: w.defense, garrison: w.garrison,
    queue: [], invasion: null, unrest: 0, intel: { empire: 0, rebellion: 0 },
  }));
  relax(planets);

  // ---- hyperlanes: short, non-crossing, no redundant links (a sparse planar web) ----
  const lanes: Lane[] = [];
  const deg = new Array<number>(planets.length).fill(0);
  const pairs: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < planets.length; i++) for (let j = i + 1; j < planets.length; j++) {
    const d = dist3(planets[i].pos, planets[j].pos);
    if (d < 70) pairs.push({ a: i, b: j, d });
  }
  pairs.sort((x, y) => x.d - y.d);
  const crosses = (a: number, b: number) => lanes.some(l => {
    if (l.a === a || l.a === b || l.b === a || l.b === b) return false;
    return segmentsCross(planets[a].pos, planets[b].pos, planets[l.a].pos, planets[l.b].pos);
  });
  for (const { a, b, d } of pairs) {
    if (deg[a] >= 4 || deg[b] >= 4) continue;
    if (crosses(a, b)) continue;
    const existing = findPath(lanes, a, b);
    if (existing && pathLength(lanes, existing) < d * 1.45) continue;
    lanes.push({ a, b, length: d });
    deg[a]++; deg[b]++;
  }
  for (let guard = 0; guard < 80; guard++) {
    const seen = hopDistances(lanes, 0);
    const missing = planets.filter(p => !seen.has(p.id));
    if (!missing.length) break;
    let best: [number, number, number] = [-1, -1, Infinity];
    for (const m of missing) for (const p of planets) {
      if (seen.has(p.id)) { const d = dist3(m.pos, p.pos); if (d < best[2]) best = [m.id, p.id, d]; }
    }
    lanes.push({ a: best[0], b: best[1], length: best[2] });
  }

  // ---- loyalty from canon sympathies, HQs ----
  for (const p of planets) {
    const w = CANON_WORLDS[p.id];
    p.loyalty = Math.max(-100, Math.min(100, Math.round(w.lean * 70 + r.range(-12, 12))));
    if (p.owner === 'empire') p.loyalty = Math.min(p.loyalty, -35);
    if (p.owner === 'rebellion') p.loyalty = Math.max(p.loyalty, 35);
  }
  const empireHq = planets.findIndex(p => p.name === 'Coruscant');
  // the hidden base: any one of the Alliance's starting worlds, chosen at random
  const hqPool = ['Yavin', 'Dantooine', 'Toprawa', 'Mon Calamari', 'Sullust'];
  const hqName = r.pick(hqPool);
  const rebelHq = planets.findIndex(p => p.name === hqName);
  const cap = planets[empireHq];
  cap.loyalty = -90;
  const rebHq = planets[rebelHq];
  rebHq.shipyard = Math.max(rebHq.shipyard, 2); rebHq.defense = Math.max(rebHq.defense, 1); rebHq.garrison = Math.max(rebHq.garrison, 4); rebHq.loyalty = 90;

  const state: GameState = {
    seed: opts.seed, hours: 0, speed: 0, player: opts.player,
    planets, lanes, fleets: [], characters: [],
    factions: {
      empire: { id: 'empire', name: 'Galactic Empire', credits: 1000, hq: empireHq, knowsEnemyHq: false, isAI: !!opts.observer || opts.player !== 'empire' },
      rebellion: { id: 'rebellion', name: 'Rebel Alliance', credits: 800, hq: rebelHq, knowsEnemyHq: true, isAI: !!opts.observer || opts.player !== 'rebellion' },
    },
    log: [], nextId: 1000, pendingBattle: null, winner: null, aiTimer: 0,
    dayIncome: { empire: 0, rebellion: 0 },
    observer: !!opts.observer, autoBattles: !!opts.observer,
  };

  // ---- starting fleets ----
  const byName = (n: string) => planets.find(p => p.name === n)!.id;
  const mk = (cls: string, n: number): Ship[] => Array.from({ length: n }, () => ({ id: state.nextId++, cls, hull: 1 }));
  addFleet(state, 'empire', 'Death Squadron', empireHq, [...mk('victory', 2), ...mk('lancer', 2), ...mk('tie', 8), ...mk('tiebomber', 2), ...mk('acclamator', 1)], 4);
  addFleet(state, 'empire', 'Kuat Sector Fleet', byName('Kuat'), [...mk('victory', 1), ...mk('lancer', 2), ...mk('tie', 4)], 0);
  addFleet(state, 'empire', 'Rim Patrol', byName('Eriadu'), [...mk('lancer', 1), ...mk('tie', 4)], 0);
  addFleet(state, 'rebellion', 'Alliance Fleet', rebelHq, [...mk('nebulon', 1), ...mk('cr90', 2), ...mk('xwing', 8), ...mk('ywing', 4), ...mk('gr75', 1)], 3);
  addFleet(state, 'rebellion', 'Home One Group', byName('Mon Calamari'), [...mk('mc80', 1), ...mk('cr90', 1), ...mk('xwing', 4)], 2);
  addFleet(state, 'rebellion', 'Rogue Group', byName('Sullust'), [...mk('cr90', 1), ...mk('xwing', 4)], 0);

  // ---- characters ----
  const ch = (name: string, title: string, faction: FactionId, at: number, d: number, e: number, s: number, l: number): Character =>
    ({ id: state.nextId++, name, title, faction, at, mission: null, diplomacy: d, espionage: e, sabotage: s, leadership: l, captured: false });
  state.characters.push(
    ch('Palpatine', 'Emperor', 'empire', empireHq, 5, 4, 2, 4),
    ch('Darth Vader', 'Lord', 'empire', empireHq, 3, 4, 5, 5),
    ch('Tarkin', 'Grand Moff', 'empire', byName('Eriadu'), 5, 3, 2, 5),
    ch('Piett', 'Admiral', 'empire', byName('Kuat'), 2, 3, 2, 5),
    ch('Ysanne Isard', 'Director', 'empire', empireHq, 3, 5, 5, 2),
    ch('Mon Mothma', 'Chancellor', 'rebellion', rebelHq, 5, 3, 1, 3),
    ch('Leia Organa', 'Princess', 'rebellion', rebelHq, 5, 4, 3, 4),
    ch('Luke Skywalker', 'Commander', 'rebellion', rebelHq, 3, 4, 5, 5),
    ch('Han Solo', 'Captain', 'rebellion', rebelHq, 3, 5, 5, 4),
    ch('Ackbar', 'Admiral', 'rebellion', byName('Mon Calamari'), 3, 2, 2, 5),
  );
  return state;
}

/** Push worlds that share a grid square apart until none are closer than MIN_SPACING (in the map plane). */
function relax(planets: Planet[]): void {
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < planets.length; i++) for (let j = i + 1; j < planets.length; j++) {
      const a = planets[i].pos, b = planets[j].pos;
      let dx = b.x - a.x, dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= MIN_SPACING) continue;
      if (d < 1e-3) { dx = Math.cos(i * 2.4 + j); dz = Math.sin(i * 2.4 + j); d = 1; }
      const push = (MIN_SPACING - d) / 2 + 0.05;
      a.x -= dx / d * push; a.z -= dz / d * push;
      b.x += dx / d * push; b.z += dz / d * push;
      moved = true;
    }
    if (!moved) break;
  }
}

/** Deterministic -1..1 noise from a string, so the vertical scatter is stable across games. */
function hashNoise(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 2000) / 1000 - 1;
}

export function addFleet(s: GameState, faction: FactionId, name: string, at: number, ships: Ship[], troops: number): Fleet {
  const f: Fleet = { id: s.nextId++, faction, name, ships, troops, at, travel: null };
  s.fleets.push(f);
  return f;
}

export function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 2D (XZ) segment intersection test for lane layout. */
function segmentsCross(p1: { x: number; z: number }, p2: { x: number; z: number }, p3: { x: number; z: number }, p4: { x: number; z: number }): boolean {
  const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}
