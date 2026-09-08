import { generateGalaxy } from '../src/sim/galaxyGen';
import { gatherBattle } from '../src/sim/combat';
import { BattleSim } from '../src/battle/battleSim';
for (const seed of [1, 2]) {
  const s = generateGalaxy({ seed, player: seed % 2 ? 'rebellion' : 'empire' });
  const enemy = s.fleets.find(f => f.faction !== s.player)!;
  enemy.at = s.factions[s.player].hq; enemy.travel = null;
  const setup = gatherBattle(s, { planet: enemy.at, attacker: enemy.faction });
  const sim = new BattleSim(setup, s.player);
  const dead = new Set<number>(); const log: string[] = [];
  while (!sim.over && sim.time < 900) {
    sim.step(1 / 30);
    for (const u of sim.units) if (!u.alive && !dead.has(u.id)) { dead.add(u.id); log.push(`${sim.time.toFixed(0)}s ${u.side[0]}:${u.cls.id}`); }
  }
  console.log(`seed ${seed} player=${s.player} attacker=${setup.attacker}: ${sim.time.toFixed(0)}s`);
  console.log('  ' + log.join('  '));
}
