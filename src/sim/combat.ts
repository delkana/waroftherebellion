import { rng, log, factionName, fleetStrength, ownedPlanets, orderMove } from './sim';
import { shipClass, type ShipClass } from './ships';
import { enemyOf, type FactionId, type Fleet, type GameState, type PendingBattle } from './types';
import { findPath, pathLength } from './pathfinding';

/** One combatant in a battle, shared by auto-resolve and the tactical sim. */
export interface BattleUnitSpec {
  id: number;            // ship id, or negative for defense platforms
  cls: ShipClass;
  faction: FactionId;
  hull: number;          // 0..1
  fleetId: number | null;
}

export interface BattleSetup {
  planet: number;
  attacker: FactionId;
  defender: FactionId;
  units: BattleUnitSpec[];
  fleets: Fleet[];
}

export interface BattleResult {
  winner: FactionId | null;
  retreated: FactionId | null;
  /** surviving unit id -> hull fraction */
  survivors: Map<number, number>;
}

export function gatherBattle(s: GameState, pb: PendingBattle): BattleSetup {
  const planet = s.planets[pb.planet];
  const defender = enemyOf(pb.attacker);
  const fleets = s.fleets.filter(f => f.at === pb.planet && f.ships.length > 0);
  const units: BattleUnitSpec[] = [];
  for (const f of fleets) for (const sh of f.ships) units.push({ id: sh.id, cls: shipClass(sh.cls), faction: f.faction, hull: sh.hull, fleetId: f.id });
  if (planet.owner && planet.owner !== pb.attacker) {
    for (let i = 0; i < planet.defense; i++) units.push({ id: -(i + 1), cls: shipClass('platform'), faction: planet.owner, hull: 1, fleetId: null });
  }
  return { planet: pb.planet, attacker: pb.attacker, defender, units, fleets };
}

export function sideStrength(units: BattleUnitSpec[], f: FactionId): number {
  return units.filter(u => u.faction === f).reduce((sum, u) => sum + (u.cls.hp + u.cls.shield) * u.hull, 0);
}

/** Abstract resolution: rounds of fire until one side breaks. */
export function autoResolve(setup: BattleSetup): BattleResult {
  interface U { spec: BattleUnitSpec; hp: number; shield: number; alive: boolean }
  const units: U[] = setup.units.map(spec => ({ spec, hp: spec.cls.hp * spec.hull, shield: spec.cls.shield, alive: true }));
  const initial: Record<FactionId, number> = { empire: sideStrength(setup.units, 'empire'), rebellion: sideStrength(setup.units, 'rebellion') };
  const ROUND = 8; // seconds of fire per round
  let retreated: FactionId | null = null;
  for (let round = 0; round < 40; round++) {
    for (const f of ['empire', 'rebellion'] as FactionId[]) {
      const mine = units.filter(u => u.alive && u.spec.faction === f);
      const theirs = units.filter(u => u.alive && u.spec.faction !== f);
      if (!mine.length || !theirs.length) continue;
      for (const u of mine) {
        for (const w of u.spec.cls.weapons) {
          const t = theirs[Math.floor(rng.next() * theirs.length)];
          if (!t.alive) continue;
          const mult = t.spec.cls.size === 'small' ? w.vsSmall : t.spec.cls.size === 'medium' ? (w.vsSmall + w.vsLarge) / 2 : w.vsLarge;
          let dmg = w.dmg * w.count * (ROUND / w.cooldown) * mult * 0.55 * rng.range(0.7, 1.3);
          const sd = Math.min(t.shield, dmg); t.shield -= sd; dmg -= sd;
          t.hp -= dmg;
          if (t.hp <= 0) t.alive = false;
        }
      }
    }
    for (const f of ['empire', 'rebellion'] as FactionId[]) {
      const cur = units.filter(u => u.alive && u.spec.faction === f).reduce((s, u) => s + u.hp + u.shield, 0);
      const alive = units.some(u => u.alive && u.spec.faction === f);
      if (!alive) continue;
      const enemyAlive = units.some(u => u.alive && u.spec.faction !== f);
      if (!enemyAlive) continue;
      // a side breaks when it has lost 60% of its strength while the enemy remains stronger
      const enemyCur = units.filter(u => u.alive && u.spec.faction !== f).reduce((s, u) => s + u.hp + u.shield, 0);
      const mobile = units.some(u => u.alive && u.spec.faction === f && u.spec.fleetId !== null);
      if (mobile && cur < initial[f] * 0.4 && enemyCur > cur) { retreated = f; break; }
    }
    if (retreated) break;
    const eAlive = units.some(u => u.alive && u.spec.faction === 'empire');
    const rAlive = units.some(u => u.alive && u.spec.faction === 'rebellion');
    if (!eAlive || !rAlive) break;
  }
  const survivors = new Map<number, number>();
  for (const u of units) if (u.alive) survivors.set(u.spec.id, Math.max(0.05, u.hp / u.spec.cls.hp));
  const eAlive = units.some(u => u.alive && u.spec.faction === 'empire');
  const rAlive = units.some(u => u.alive && u.spec.faction === 'rebellion');
  let winner: FactionId | null = null;
  if (retreated) winner = enemyOf(retreated);
  else if (eAlive && !rAlive) winner = 'empire';
  else if (rAlive && !eAlive) winner = 'rebellion';
  else winner = sideStrength(setup.units.filter(u => survivors.has(u.id)), 'empire') >= sideStrength(setup.units.filter(u => survivors.has(u.id)), 'rebellion') ? 'empire' : 'rebellion';
  return { winner, retreated, survivors };
}

/** Write a battle result back into the galaxy state. */
export function applyBattleResult(s: GameState, setup: BattleSetup, result: BattleResult): void {
  const planet = s.planets[setup.planet];
  const lost: Record<FactionId, number> = { empire: 0, rebellion: 0 };
  for (const f of setup.fleets) {
    const before = f.ships.length;
    f.ships = f.ships.filter(sh => result.survivors.has(sh.id));
    for (const sh of f.ships) sh.hull = result.survivors.get(sh.id)!;
    lost[f.faction] += before - f.ships.length;
    if (f.ships.length === 0) f.troops = 0;
  }
  const platformsLost = setup.units.filter(u => u.id < 0 && !result.survivors.has(u.id)).length;
  if (platformsLost) planet.defense = Math.max(0, planet.defense - platformsLost);
  s.fleets = s.fleets.filter(f => f.ships.length > 0);

  if (result.retreated) {
    for (const f of s.fleets.filter(f => f.at === setup.planet && f.faction === result.retreated)) retreatFleet(s, f);
  }
  const w = result.winner;
  const text = w
    ? `Battle of ${planet.name}: ${factionName(w)} victory (Empire lost ${lost.empire}, Rebellion lost ${lost.rebellion})`
    : `Battle of ${planet.name}: inconclusive`;
  log(s, text, 'battle', 'all', setup.planet);
  s.pendingBattle = null;
  // A retreating side may leave leftover pending contest (e.g. enemy fleets remain vs platforms) — resolve again next tick if so.
  const factionsPresent = new Set(s.fleets.filter(f => f.at === setup.planet).map(f => f.faction));
  if (factionsPresent.size > 1) s.pendingBattle = { planet: setup.planet, attacker: setup.attacker };
  else if (planet.owner && planet.defense > 0 && factionsPresent.size === 1 && !factionsPresent.has(planet.owner)) s.pendingBattle = { planet: setup.planet, attacker: [...factionsPresent][0] };
}

export function retreatFleet(s: GameState, f: Fleet): void {
  if (f.at === null) return;
  const own = ownedPlanets(s, f.faction).filter(p => p.id !== f.at);
  let best: number | null = null, bestLen = Infinity;
  for (const p of own) {
    const path = findPath(s.lanes, f.at, p.id);
    if (path) { const l = pathLength(s.lanes, path); if (l < bestLen) { bestLen = l; best = p.id; } }
  }
  if (best === null) {
    // nowhere friendly: jump to any neighbour
    const lane = s.lanes.find(l => l.a === f.at || l.b === f.at);
    if (lane) best = lane.a === f.at ? lane.b : lane.a;
  }
  if (best !== null) orderMove(s, f, best);
}

export function strengthOfFleets(fleets: Fleet[]): number { return fleets.reduce((s, f) => s + fleetStrength(f), 0); }
