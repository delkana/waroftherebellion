// Headless tactical battle runner: forces the AI's fleet onto the player's HQ and simulates the fight.
import { generateGalaxy } from '../src/sim/galaxyGen';
import { gatherBattle } from '../src/sim/combat';
import { BattleSim } from '../src/battle/battleSim';

for (const seed of [1, 2, 3, 4, 5, 6]) {
  const s = generateGalaxy({ seed, player: seed % 2 ? 'rebellion' : 'empire' });
  const enemy = s.fleets.find(f => f.faction !== s.player)!;
  enemy.at = s.factions[s.player].hq; enemy.travel = null;
  const setup = gatherBattle(s, { planet: enemy.at, attacker: enemy.faction });
  const sim = new BattleSim(setup, s.player);
  while (!sim.over && sim.time < 900) sim.step(1 / 30);
  const lost = (f: string) => sim.units.filter(u => u.side === f && !u.alive).length;
  console.log(`seed ${seed} (${s.player}): ${sim.time.toFixed(0)}s winner=${sim.result?.winner} retreated=${sim.result?.retreated} lost E${lost('empire')}/R${lost('rebellion')} of ${setup.units.filter(u => u.faction === 'empire').length}/${setup.units.filter(u => u.faction === 'rebellion').length}`);
}
