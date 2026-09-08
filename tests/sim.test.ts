import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGalaxy } from '../src/sim/galaxyGen';
import { findPath, hopDistances } from '../src/sim/pathfinding';
import { step, orderMove, fleetsAt } from '../src/sim/sim';
import { gatherBattle, autoResolve, applyBattleResult } from '../src/sim/combat';

test('galaxy is connected and has both factions', () => {
  const s = generateGalaxy({ seed: 42, player: 'empire' });
  const d = hopDistances(s.lanes, 0);
  assert.equal(d.size, s.planets.length);
  assert.ok(s.planets.filter(p => p.owner === 'empire').length >= 8);
  assert.ok(s.planets.filter(p => p.owner === 'rebellion').length >= 4);
  assert.equal(s.planets[s.factions.rebellion.hq].owner, 'rebellion');
});

test('pathfinding finds a route between any planets', () => {
  const s = generateGalaxy({ seed: 7, player: 'rebellion' });
  const p = findPath(s.lanes, 0, s.planets.length - 1);
  assert.ok(p && p[0] === 0 && p[p.length - 1] === s.planets.length - 1);
});

test('fleets travel and the economy ticks', () => {
  const s = generateGalaxy({ seed: 3, player: 'empire' });
  s.factions.rebellion.isAI = false; s.factions.empire.isAI = false;
  const fleet = s.fleets.find(f => f.faction === 'empire')!;
  const dest = s.planets.find(p => p.owner === 'empire' && p.id !== fleet.at)!;
  assert.ok(orderMove(s, fleet, dest.id));
  const credits = s.factions.empire.credits;
  for (let i = 0; i < 400; i++) step(s, 1);
  assert.ok(s.factions.empire.credits > credits);
  assert.equal(fleet.at, dest.id);
});

test('auto-resolve produces a result and applies it', () => {
  const s = generateGalaxy({ seed: 11, player: 'empire' });
  const reb = s.fleets.find(f => f.faction === 'rebellion')!;
  const emp = s.fleets.find(f => f.faction === 'empire')!;
  reb.at = emp.at; // teleport into the same orbit
  const setup = gatherBattle(s, { planet: emp.at!, attacker: 'rebellion' });
  assert.ok(setup.units.length > 10);
  const r = autoResolve(setup);
  assert.ok(r.winner);
  applyBattleResult(s, setup, r);
  assert.ok(fleetsAt(s, emp.at!).length >= 1);
});
