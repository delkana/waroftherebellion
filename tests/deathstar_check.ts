// Headless check of the Death Star catch-up event, both branches. Run: node --import tsx tests/deathstar_check.ts
import { generateGalaxy } from '../src/sim/galaxyGen';
import { step, orderMission, missionChance, missionProblem } from '../src/sim/sim';
import { gatherBattle, autoResolve, applyBattleResult } from '../src/sim/combat';
import type { GameState } from '../src/sim/types';

const run = (s: GameState, hours: number) => {
  for (let h = 0; h < hours; h++) {
    step(s, 1);
    if (s.pendingBattle) { const st = gatherBattle(s, s.pendingBattle); applyBattleResult(s, st, autoResolve(st)); }
    if (s.winner) break;
  }
};

{
  const s = generateGalaxy({ seed: 4, player: 'rebellion' }); s.factions.empire.isAI = false; s.factions.rebellion.isAI = false;
  for (const p of s.planets) if (!p.owner && p.name !== 'Alderaan') p.owner = 'empire';
  s.hours = 24 * 19.9; run(s, 6);
  const ds = s.deathStar!;
  console.log('EMPIRE AHEAD -> death star:', ds ? `at ${s.planets[ds.at].name}, alderaan=${ds.alderaan}` : 'none');
  const by = (n: string) => s.characters.find(c => c.name === n)!;
  const trio = ['Luke Skywalker', 'Leia Organa', 'Han Solo'].map(by);
  console.log('odds solo Luke', missionChance(s, [trio[0]], 'deathstar', ds.at).toFixed(2), 'trio', missionChance(s, trio, 'deathstar', ds.at).toFixed(2), '| Ackbar allowed?', missionProblem(s, by('Ackbar'), 'deathstar', ds.at));
  const tat = s.planets.find(p => p.name === 'Tatooine')!; const l0 = tat.loyalty;
  for (const c of trio) orderMission(s, c, 'deathstar', ds.at);
  run(s, 300);
  console.log('after trench run:', s.log.filter(l => /trench|Death Star/.test(l.text)).slice(-3).map(l => l.text).join(' | '));
  console.log('Tatooine loyalty', l0.toFixed(0), '->', tat.loyalty.toFixed(0), '| destroyed:', ds.destroyed);
}
{
  const s = generateGalaxy({ seed: 4, player: 'empire' }); s.factions.empire.isAI = false; s.factions.rebellion.isAI = false;
  for (const p of s.planets) if (!p.owner) p.owner = 'rebellion';
  const ald = s.planets.find(p => p.name === 'Alderaan')!; const nab = s.planets.find(p => p.name === 'Naboo')!; const n0 = nab.loyalty;
  const kuat = s.planets.find(p => p.name === 'Kuat')!; const k0 = kuat.loyalty;
  s.hours = 24 * 19.9; run(s, 6);
  console.log('REBELS AHEAD ->', s.log.filter(l => /Alderaan|Death Star/.test(l.text)).map(l => l.text).join(' | '));
  console.log('Alderaan destroyed:', ald.destroyed, 'production', ald.production, '| Naboo (rebel-owned) loyalty', n0.toFixed(0), '->', nab.loyalty.toFixed(0), '| Kuat (imperial)', k0.toFixed(0), '->', kuat.loyalty.toFixed(0));
  // it then marches on the base
  run(s, 24 * 12);
  console.log('after 12 days:', s.log.filter(l => /Death Star/.test(l.text)).slice(-2).map(l => l.text).join(' | '));
}

// --- AI vs AI: does the event fire on its own, and what happens?
for (const seed of [1, 2, 3]) {
  const s = generateGalaxy({ seed, player: 'empire' }); s.factions.empire.isAI = true; s.factions.rebellion.isAI = true;
  run(s, 24 * 200);
  const lines = s.log.filter(l => /Death Star|trench|Alderaan/i.test(l.text)).map(l => `d${Math.floor(l.time / 24)} ${l.text.slice(0, 90)}`);
  console.log(`AI seed ${seed}: day ${Math.floor(s.hours / 24)} winner=${s.winner} E${s.planets.filter(p => p.owner === 'empire').length}/R${s.planets.filter(p => p.owner === 'rebellion').length}`);
  console.log('  ' + (lines.join(' || ') || '(no Death Star events)'));
}
