// Headless AI-vs-AI soak: both factions run by the AI, battles auto-resolved.
import { generateGalaxy } from '../src/sim/galaxyGen';
import { step } from '../src/sim/sim';
import { gatherBattle, autoResolve, applyBattleResult } from '../src/sim/combat';

for (const seed of [1, 2, 3]) {
  const s = generateGalaxy({ seed, player: 'empire' });
  s.factions.empire.isAI = true; s.factions.rebellion.isAI = true;
  let battles = 0, invasions = 0;
  const seen = new Set<string>();
  while (s.hours < 24 * 200 && !s.winner) {
    step(s, 1);
    if (s.pendingBattle) { const setup = gatherBattle(s, s.pendingBattle); applyBattleResult(s, setup, autoResolve(setup)); battles++; s.speed = 1; }
    for (const e of s.log) if (e.text.includes('troops land') && !seen.has(e.time + e.text)) { seen.add(e.time + e.text); invasions++; }
  }
  const own = (f: string) => s.planets.filter(p => p.owner === f).length;
  const ships = (f: string) => s.fleets.filter(fl => fl.faction === f).reduce((n, fl) => n + fl.ships.length, 0);
  console.log(`seed ${seed}: day ${Math.floor(s.hours / 24)} winner=${s.winner} battles=${battles} invasions=${invasions} planets E${own('empire')}/R${own('rebellion')} ships E${ships('empire')}/R${ships('rebellion')} credits E${s.factions.empire.credits.toFixed(0)}/R${s.factions.rebellion.credits.toFixed(0)} hqKnown=${s.factions.empire.knowsEnemyHq}`);
  console.log('  ' + s.log.filter(l => l.kind === 'battle').slice(-4).map(l => l.text).join('\n  '));
}
