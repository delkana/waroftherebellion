import { Rng } from '../core/rng';
import type { Character, FactionId, Fleet, GameState, Lane, Planet, PlanetType, Ship } from './types';
import { findPath, hopDistances, pathLength } from './pathfinding';

interface World { name: string; type: PlanetType; prod: number }
const W = (name: string, type: PlanetType, prod: number): World => ({ name, type, prod });

/** Core worlds: named from the capital outward, so the Imperial heartland reads right. */
const CORE: World[] = [
  W('Corellia', 'terran', 13), W('Kuat', 'terran', 14), W('Alderaan', 'terran', 12), W('Chandrila', 'terran', 11),
  W('Fondor', 'barren', 11), W('Brentaal', 'terran', 10), W('Eriadu', 'terran', 10), W('Rendili', 'barren', 10),
  W('Byss', 'terran', 9), W('Commenor', 'terran', 9), W('Duro', 'barren', 9), W('Anaxes', 'terran', 9),
  W('Kamino', 'ocean', 9), W('Cato Neimoidia', 'terran', 9), W('Carida', 'barren', 8), W('Mygeeto', 'ice', 8),
  W('Balmorra', 'barren', 9), W('Corulag', 'terran', 9),
];
/** Classic hidden-base worlds; the Rebel HQ takes one of these names. */
const REBEL_BASES: World[] = [W('Yavin', 'jungle', 7), W('Hoth', 'ice', 4), W('Dantooine', 'terran', 6)];
/** Outer worlds for the rim and the neutrals. */
const RIM: World[] = [
  W('Mon Cala', 'ocean', 12), W('Sullust', 'volcanic', 9), W('Bothawui', 'terran', 9), W('Naboo', 'terran', 10),
  W('Bespin', 'gas', 9), W('Kashyyyk', 'jungle', 8), W('Mandalore', 'desert', 8), W('Sluis Van', 'barren', 8),
  W('Taris', 'city', 8), W('Lothal', 'terran', 7), W('Nal Hutta', 'jungle', 7), W('Ord Mantell', 'terran', 7),
  W('Mustafar', 'volcanic', 7), W('Scarif', 'ocean', 7), W('Onderon', 'jungle', 7), W('Malastare', 'terran', 7),
  W('Ryloth', 'desert', 6), W('Kessel', 'barren', 6), W('Utapau', 'desert', 6), W('Rodia', 'jungle', 6),
  W('Bakura', 'terran', 6), W('Geonosis', 'desert', 6), W('Endor', 'jungle', 5), W('Felucia', 'jungle', 5),
  W('Dathomir', 'jungle', 5), W('Bestine', 'desert', 5), W('Tatooine', 'desert', 4), W('Jedha', 'desert', 4),
  W('Ilum', 'ice', 3), W('Dagobah', 'jungle', 2), W('Jakku', 'desert', 2), W('Polis Massa', 'barren', 3),
  W('Nar Shaddaa', 'city', 8), W('Kalist', 'barren', 4), W('Ando', 'ocean', 5), W('Dorin', 'gas', 5),
];

export interface GenOptions { seed: number; player: FactionId; planetCount?: number }

export function generateGalaxy(opts: GenOptions): GameState {
  const r = new Rng(opts.seed);
  const N = Math.min(opts.planetCount ?? 38, 1 + CORE.length + REBEL_BASES.length + RIM.length);

  // ---- positions: even scatter across a disc, denser toward the core ----
  const planets: Planet[] = [];
  const R = 112;
  let attempts = 0;
  while (planets.length < N && attempts < 20000) {
    attempts++;
    let pos;
    if (planets.length === 0) pos = { x: 0, y: 0, z: 0 };
    else {
      const rad = 16 + Math.pow(r.next(), 0.72) * (R - 16);
      const ang = r.next() * Math.PI * 2;
      pos = { x: rad * Math.cos(ang), y: r.range(-1, 1) * (2.5 + rad * 0.05), z: rad * Math.sin(ang) };
    }
    if (planets.some(p => dist3(p.pos, pos) < 17)) continue;
    planets.push({
      id: planets.length, name: `System ${planets.length}`, pos, type: 'barren', radius: r.range(1.1, 2.2),
      owner: null, loyalty: 0, production: 5,
      shipyard: 0, defense: 0, garrison: r.int(0, 2), queue: [], invasion: null, unrest: 0,
      intel: { empire: 0, rebellion: 0 },
    });
  }

  // ---- hyperlanes: short, non-crossing, no redundant links (a sparse planar web) ----
  const lanes: Lane[] = [];
  const deg = new Array<number>(planets.length).fill(0);
  const pairs: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < planets.length; i++) for (let j = i + 1; j < planets.length; j++) {
    const d = dist3(planets[i].pos, planets[j].pos);
    if (d < 60) pairs.push({ a: i, b: j, d });
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
  // connectivity (rare): stitch isolated islands to the nearest reached world
  for (let guard = 0; guard < 50; guard++) {
    const seen = hopDistances(lanes, 0);
    const missing = planets.filter(p => !seen.has(p.id));
    if (!missing.length) break;
    let best: [number, number, number] = [-1, -1, Infinity];
    for (const m of missing) for (const p of planets) {
      if (seen.has(p.id)) { const d = dist3(m.pos, p.pos); if (d < best[2]) best = [m.id, p.id, d]; }
    }
    lanes.push({ a: best[0], b: best[1], length: best[2] });
  }

  // ---- ownership ----
  const empireHq = 0;
  const hopsFromCapital = hopDistances(lanes, empireHq);
  const byHops = [...planets].sort((a, b) => (hopsFromCapital.get(a.id)! - hopsFromCapital.get(b.id)!) || (dist3(a.pos, planets[0].pos) - dist3(b.pos, planets[0].pos)));
  const empireCount = Math.round(N * 0.3);
  for (let i = 0; i < empireCount; i++) byHops[i].owner = 'empire';

  // Rebel region: the far rim, never within three jumps of the capital
  const maxHops = Math.max(...planets.map(p => hopsFromCapital.get(p.id) ?? 0));
  const farRim = planets.filter(p => p.owner === null && (hopsFromCapital.get(p.id) ?? 0) >= maxHops - 1)
    .sort((a, b) => dist3(b.pos, planets[0].pos) - dist3(a.pos, planets[0].pos));
  const rebelSeed = farRim[r.int(0, Math.min(2, farRim.length - 1))];
  const hopsFromRebel = hopDistances(lanes, rebelSeed.id);
  const rebelCandidates = planets.filter(p => p.owner === null && (hopsFromCapital.get(p.id) ?? 0) >= Math.min(4, maxHops - 2))
    .sort((a, b) => ((hopsFromRebel.get(a.id) ?? 99) - (hopsFromRebel.get(b.id) ?? 99)) || (dist3(a.pos, rebelSeed.pos) - dist3(b.pos, rebelSeed.pos)));
  const rebelCount = Math.round(N * 0.16);
  const rebelPlanets = rebelCandidates.slice(0, rebelCount);
  for (const p of rebelPlanets) p.owner = 'rebellion';
  const rebelHq = r.pick(rebelPlanets).id;

  // ---- names & types: core names spiral out from Coruscant, rim names everywhere else ----
  const core = r.shuffle([...CORE]);
  const rim = r.shuffle([...RIM]);
  const bases = r.shuffle([...REBEL_BASES]);
  const assign = (p: Planet, w: World) => { p.name = w.name; p.type = w.type; p.production = w.prod; };
  assign(planets[0], W('Coruscant', 'city', 16));
  assign(planets[rebelHq], bases.shift()!);
  for (const p of byHops) {
    if (p.id === 0 || p.id === rebelHq) continue;
    if (p.owner === 'empire' && core.length) assign(p, core.shift()!);
    else if (rim.length) assign(p, rim.shift()!);
    else if (bases.length) assign(p, bases.shift()!);
    else assign(p, core.shift() ?? W(`Outpost ${p.id}`, 'barren', 3));
  }

  for (const p of planets) {
    const hops = hopsFromCapital.get(p.id) ?? 6;
    if (p.owner === 'empire') { p.loyalty = r.int(-75, -35); p.garrison = r.int(1, 2); }
    else if (p.owner === 'rebellion') { p.loyalty = r.int(35, 75); p.garrison = r.int(1, 2); }
    else { p.loyalty = Math.round(r.range(-30, 30) + (hops - 3) * 8); p.garrison = r.int(0, 2); }
    p.loyalty = Math.max(-100, Math.min(100, p.loyalty));
    if (p.owner === null && r.chance(0.2)) p.shipyard = 1;
  }
  const cap = planets[empireHq];
  cap.shipyard = 3; cap.defense = 2; cap.garrison = 6; cap.loyalty = -85; cap.radius = 2.3;
  const rebHq = planets[rebelHq];
  rebHq.shipyard = 3; rebHq.defense = 1; rebHq.garrison = 4; rebHq.production = Math.max(rebHq.production, 9); rebHq.loyalty = 85;
  // secondary yards: Kuat is the Empire's great shipyard when it is in play
  const empOthers = planets.filter(p => p.owner === 'empire' && p.id !== empireHq).sort((a, b) => (b.name === 'Kuat' ? 100 : b.production) - (a.name === 'Kuat' ? 100 : a.production));
  if (empOthers[0]) empOthers[0].shipyard = 2;
  if (empOthers[1]) empOthers[1].shipyard = 1;
  if (empOthers[2]) empOthers[2].shipyard = 1;
  const rebOthers = rebelPlanets.filter(p => p.id !== rebelHq).sort((a, b) => (b.name === 'Mon Cala' ? 100 : b.production) - (a.name === 'Mon Cala' ? 100 : a.production));
  if (rebOthers[0]) rebOthers[0].shipyard = 2;
  if (rebOthers[1]) rebOthers[1].shipyard = 1;

  const state: GameState = {
    seed: opts.seed, hours: 0, speed: 0, player: opts.player,
    planets, lanes, fleets: [], characters: [],
    factions: {
      empire: { id: 'empire', name: 'Galactic Empire', credits: 900, hq: empireHq, knowsEnemyHq: false, isAI: opts.player !== 'empire' },
      rebellion: { id: 'rebellion', name: 'Rebel Alliance', credits: 700, hq: rebelHq, knowsEnemyHq: true, isAI: opts.player !== 'rebellion' },
    },
    log: [], nextId: 1000, pendingBattle: null, winner: null, aiTimer: 0,
    dayIncome: { empire: 0, rebellion: 0 },
  };

  // ---- starting fleets ----
  const mk = (cls: string, n: number): Ship[] => Array.from({ length: n }, () => ({ id: state.nextId++, cls, hull: 1 }));
  addFleet(state, 'empire', 'Death Squadron', empireHq, [...mk('victory', 2), ...mk('lancer', 2), ...mk('tie', 6), ...mk('tiebomber', 2), ...mk('acclamator', 1)], 4);
  if (empOthers[0]) addFleet(state, 'empire', 'Sector Patrol', empOthers[0].id, [...mk('lancer', 2), ...mk('tie', 4)], 0);
  addFleet(state, 'rebellion', 'Alliance Fleet', rebelHq, [...mk('nebulon', 1), ...mk('cr90', 2), ...mk('xwing', 6), ...mk('ywing', 3), ...mk('gr75', 1)], 3);
  if (rebOthers[0]) addFleet(state, 'rebellion', 'Rogue Group', rebOthers[0].id, [...mk('cr90', 1), ...mk('xwing', 4)], 0);

  // ---- characters ----
  const ch = (name: string, title: string, faction: FactionId, at: number, d: number, e: number, s: number, l: number): Character =>
    ({ id: state.nextId++, name, title, faction, at, mission: null, diplomacy: d, espionage: e, sabotage: s, leadership: l, captured: false });
  state.characters.push(
    ch('Palpatine', 'Emperor', 'empire', empireHq, 5, 3, 1, 3),
    ch('Darth Vader', 'Lord', 'empire', empireHq, 2, 3, 4, 5),
    ch('Tarkin', 'Grand Moff', 'empire', empireHq, 4, 3, 1, 4),
    ch('Piett', 'Admiral', 'empire', empireHq, 1, 2, 2, 4),
    ch('Ysanne Isard', 'Director', 'empire', empireHq, 2, 5, 4, 1),
    ch('Mon Mothma', 'Chancellor', 'rebellion', rebelHq, 5, 2, 1, 2),
    ch('Leia Organa', 'Princess', 'rebellion', rebelHq, 5, 3, 2, 3),
    ch('Luke Skywalker', 'Commander', 'rebellion', rebelHq, 3, 3, 4, 4),
    ch('Han Solo', 'Captain', 'rebellion', rebelHq, 2, 4, 5, 3),
    ch('Ackbar', 'Admiral', 'rebellion', rebelHq, 1, 2, 1, 5),
  );
  return state;
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
