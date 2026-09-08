import { neighbors } from './pathfinding';
import type { FactionId, Fleet, GameState, Planet } from './types';

/** Does `viewer` have a physical presence at the planet? */
export function hasPresence(s: GameState, viewer: FactionId, planetId: number): boolean {
  if (s.observer) return true;
  const p = s.planets[planetId];
  if (p.owner === viewer) return true;
  if (s.fleets.some(f => f.faction === viewer && f.at === planetId)) return true;
  if (s.characters.some(c => c.faction === viewer && !c.captured && !c.dead && c.at === planetId && (!c.mission || c.mission.phase === 'work') && !(c.assignment?.kind === 'fleet' && !s.fleets.some(f => f.id === (c.assignment as { fleetId: number }).fleetId && f.at === planetId)))) return true;
  return false;
}

/** Sensor coverage: presence, intel, or adjacent to an owned planet. */
export function inSensorRange(s: GameState, viewer: FactionId, planetId: number): boolean {
  if (hasPresence(s, viewer, planetId)) return true;
  const p = s.planets[planetId];
  if (p.intel[viewer] > 0) return true;
  return neighbors(s, planetId).some(n => s.planets[n].owner === viewer);
}

export function canSeeDetails(s: GameState, viewer: FactionId, p: Planet): boolean {
  return hasPresence(s, viewer, p.id) || p.intel[viewer] > 0;
}

export function canSeeFleet(s: GameState, viewer: FactionId, f: Fleet): boolean {
  if (s.observer) return true;
  if (f.faction === viewer) return true;
  if (f.at !== null) return inSensorRange(s, viewer, f.at);
  if (f.travel) return hasPresence(s, viewer, f.travel.from) || hasPresence(s, viewer, f.travel.to)
    || s.planets[f.travel.from].owner === viewer || s.planets[f.travel.to].owner === viewer;
  return false;
}

export function knowsHq(s: GameState, viewer: FactionId, planetId: number): boolean {
  if (s.observer) return s.factions.empire.hq === planetId || s.factions.rebellion.hq === planetId;
  if (s.factions.empire.hq === planetId) return true; // the Imperial capital is public knowledge
  if (s.factions.rebellion.hq === planetId) return viewer === 'rebellion' || s.factions.empire.knowsEnemyHq;
  return false;
}
