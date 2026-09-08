import { classesFor, classStrength, shipClass } from './ships';
import { enemyOf, type BuildItem, type FactionId, type Fleet, type GameState, type Planet } from './types';
import { hopDistances, findPath, pathLength } from './pathfinding';
import { buildOptions, buildCost, canInvade, enqueueBuild, factionName, fleetStrength, fleetTroopCap, fleetsAt, hasArmedEnemy, orderInvade, orderMerge, orderMission, orderMove, orderSplit, ownedPlanets, rng, transferTroops, alignment } from './sim';

export function runAI(s: GameState, f: FactionId): void {
  const enemy = enemyOf(f);
  const fac = s.factions[f];
  const mine = ownedPlanets(s, f);
  if (!mine.length) return;

  // ---- consolidate fleets sitting together ----
  for (const p of mine) {
    const here = fleetsAt(s, p.id, f);
    if (here.length > 1) {
      here.sort((a, b) => fleetStrength(b) - fleetStrength(a));
      for (let i = 1; i < here.length; i++) orderMerge(s, here[0], here[i]);
    }
  }

  // ---- production ----
  const owned = mine.slice().sort((a, b) => b.shipyard - a.shipyard || b.production - a.production);
  const myFleets = s.fleets.filter(fl => fl.faction === f);
  const myFleetShips = myFleets.flatMap(fl => fl.ships);
  const counts = { small: 0, medium: 0, large: 0, transport: 0 };
  for (const sh of myFleetShips) {
    const c = shipClass(sh.cls);
    if (c.shape === 'transport') counts.transport++; else counts[c.size]++;
  }
  const shipCap = (30 + 3 * mine.length) * (fac.credits > 1500 ? 1.5 : 1);
  const troopsAboard = myFleets.reduce((n, fl) => n + fl.troops, 0);
  const troopCap = myFleets.reduce((n, fl) => n + fleetTroopCap(fl), 0);
  const reserve = 80;
  for (const p of owned) {
    if (p.queue.length >= 2) continue;
    const opts = buildOptions(s, p);
    const affordable = (it: BuildItem) => fac.credits - buildCost(it, p) >= reserve;
    let choice: BuildItem | undefined;
    const wantsTroops = p.garrison < 2 || ((p.id === fac.hq || p.shipyard > 0) && p.garrison < 7 && troopsAboard < troopCap);
    if (p.garrison < (p.id === fac.hq ? 4 : 2)) choice = opts.find(o => o.kind === 'troop');
    else if (p.id === fac.hq && p.defense < 2 && fac.credits > 700) choice = opts.find(o => o.kind === 'defense');
    else if (p.shipyard === 0 && p.production >= 8 && fac.credits > 450 && rng.chance(0.5)) choice = opts.find(o => o.kind === 'shipyard');
    else if (wantsTroops && rng.chance(0.6)) choice = opts.find(o => o.kind === 'troop');
    else if (p.shipyard > 0 && myFleetShips.length < shipCap) {
      const ships = opts.filter(o => o.kind === 'ship');
      const total = counts.small + counts.medium + counts.large + 1;
      const want: Record<string, number> = { small: 0.5 - counts.small / total, medium: 0.25 - counts.medium / total, large: 0.25 - counts.large / total };
      const needTransport = counts.transport < 2 + Math.floor(mine.length / 6);
      let best: BuildItem | undefined, bestScore = -Infinity;
      for (const it of ships) {
        const c = shipClass(it.cls!);
        let score = c.shape === 'transport' ? (needTransport ? 0.4 : -1) : want[c.size] + rng.range(0, 0.15);
        if (c.size === 'large' && p.shipyard >= 2) score += 0.1;
        if (!affordable(it)) score -= 5;
        if (score > bestScore) { bestScore = score; best = it; }
      }
      if (best && bestScore > -1) choice = best;
      if (!choice && p.shipyard < 2 && fac.credits > 600 && rng.chance(0.3)) choice = opts.find(o => o.kind === 'shipyard');
    } else if (p.shipyard > 0 && p.shipyard < 3 && fac.credits > 900 && rng.chance(0.4)) choice = opts.find(o => o.kind === 'shipyard');
    else if (p.defense < 1 && p.shipyard >= 2 && fac.credits > 600 && rng.chance(0.3)) choice = opts.find(o => o.kind === 'defense');
    if (choice && affordable(choice)) enqueueBuild(s, p, choice);
  }

  // ---- fleet operations ----
  const hq = s.planets[fac.hq];
  const hopsFromHq = hopDistances(s.lanes, hq.id);
  const enemyFleets = s.fleets.filter(fl => fl.faction === enemy && fl.at !== null);
  const threatNearHome = enemyFleets.some(fl => (hopsFromHq.get(fl.at!) ?? 99) <= 2 && fleetStrength(fl) > 20);
  const enemyStrengthAt = (pid: number) => fleetsAt(s, pid, enemy).reduce((sum, fl) => sum + fleetStrength(fl), 0);
  const platformStrength = classStrength(shipClass('platform'));

  const chooseTarget = (fl: Fleet, str: number): Planet | null => {
    const hops = hopDistances(s.lanes, fl.at!);
    let best: Planet | null = null, bestScore = 0;
    for (const p of s.planets) {
      if (p.owner === f) continue;
      const h = hops.get(p.id) ?? 99;
      if (h > 7) continue;
      const risk = enemyStrengthAt(p.id) + p.defense * platformStrength + (p.owner === enemy ? 6 : 0);
      const needTroops = p.garrison + 1;
      const canTake = fl.troops >= needTroops;
      if (p.owner === null && !canTake) continue;
      if (str < risk * 1.25) continue;
      let value = p.production + p.shipyard * 6 + (p.owner === enemy ? 12 : 4);
      if (p.owner === enemy && p.id === s.factions[enemy].hq && (f === 'rebellion' || fac.knowsEnemyHq)) value += 80;
      if (!canTake) value *= 0.45; // just a raid / blockade
      const score = value / (1 + h * 0.6) * rng.range(0.8, 1.2);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return bestScore > 2.5 ? best : null;
  };

  for (const fl of s.fleets.filter(x => x.faction === f && x.at !== null)) {
    const here = s.planets[fl.at!];
    const str = fleetStrength(fl);

    // invade if we can
    if (here.owner !== f && canInvade(s, fl).ok && fl.troops > here.garrison * 1.3 + 0.5) { orderInvade(s, fl); continue; }
    if (here.owner !== f && canInvade(s, fl).ok) {
      // not enough troops: fetch some if we have room, otherwise keep the blockade
      if (fleetTroopCap(fl) > fl.troops) {
        const src = mine.filter(p => p.garrison > 2).sort((a, b) => b.garrison - a.garrison)[0];
        if (src && rng.chance(0.5)) { orderMove(s, fl, src.id); continue; }
      }
      continue;
    }

    // load troops when at home (leave a garrison of 2, or 4 at the capital)
    const keep = here.id === fac.hq ? 4 : 2;
    if (here.owner === f && here.garrison > keep && fl.troops < fleetTroopCap(fl)) transferTroops(s, fl, Math.min(here.garrison - keep, fleetTroopCap(fl) - fl.troops));

    const isHomeGuard = fl.at === hq.id;
    if (isHomeGuard) {
      if (threatNearHome) continue;
      // a bloated home fleet spins off a strike group
      if (str > 110 && fl.ships.length >= 8) {
        const ids = fl.ships.filter((_, i) => i % 2 === 0).map(sh => sh.id);
        const nf = orderSplit(s, fl, ids, Math.ceil(fl.troops / 2));
        if (nf) {
          nf.name = `${factionName(f)} Strike Group`;
          const t = chooseTarget(nf, fleetStrength(nf));
          if (t) orderMove(s, nf, t.id); else orderMerge(s, fl, nf);
        }
        continue;
      }
      if (str < 70) continue;
    }
    if (str < 25) continue;

    const best = chooseTarget(fl, str);
    if (best) { orderMove(s, fl, best.id); continue; }

    // relieve blockaded worlds
    const blockaded = mine.find(p => hasArmedEnemy(s, p.id, f) && str > enemyStrengthAt(p.id) * 1.3);
    if (blockaded && !isHomeGuard) orderMove(s, fl, blockaded.id);
  }

  // ---- characters ----
  const idle = s.characters.filter(c => c.faction === f && !c.captured && !c.mission);
  const keepHome = idle.filter(c => c.at === hq.id).sort((a, b) => b.leadership - a.leadership)[0];
  for (const c of idle) {
    if (c === keepHome) continue;
    const hops = hopDistances(s.lanes, c.at);
    const nearPlanets = s.planets.filter(p => (hops.get(p.id) ?? 99) <= 4);
    // Empire hunts the rebel base
    if (f === 'empire' && !fac.knowsEnemyHq && c.espionage >= 3) {
      const t = nearPlanets.filter(p => p.owner === 'rebellion' && p.intel.empire <= 0).sort((a, b) => hops.get(a.id)! - hops.get(b.id)!)[0];
      if (t) { orderMission(s, c, 'espionage', t.id); continue; }
    }
    if (c.diplomacy >= 3) {
      const t = nearPlanets.filter(p => p.owner === null).sort((a, b) => alignment(b, f) - alignment(a, f))[0];
      if (t) { orderMission(s, c, 'diplomacy', t.id); continue; }
      const t2 = nearPlanets.filter(p => p.owner === enemy && alignment(p, enemy) < 0 && p.garrison <= 1).sort((a, b) => alignment(a, enemy) - alignment(b, enemy))[0];
      if (t2 && rng.chance(0.5)) { orderMission(s, c, 'incite', t2.id); continue; }
    }
    if (c.sabotage >= 4) {
      const t = nearPlanets.filter(p => p.owner === enemy && (p.shipyard >= 2 || p.queue.length > 0 || p.defense > 0)).sort((a, b) => hops.get(a.id)! - hops.get(b.id)!)[0];
      if (t && rng.chance(0.6)) { orderMission(s, c, 'sabotage', t.id); continue; }
    }
    if (c.espionage >= 3 && rng.chance(0.3)) {
      const t = nearPlanets.filter(p => p.owner === enemy && p.intel[f] <= 0)[0];
      if (t) orderMission(s, c, 'espionage', t.id);
    }
  }
}

/** Used by UI hints: estimated hours for a fleet to reach a planet. */
export function travelHours(s: GameState, fl: Fleet, dest: number): number | null {
  const origin = fl.at ?? fl.travel!.to;
  const path = findPath(s.lanes, origin, dest);
  if (!path) return null;
  const speed = fl.ships.reduce((m, sh) => Math.min(m, shipClass(sh.cls).hyperSpeed), 99) || 3;
  return pathLength(s.lanes, path) / speed;
}

export const AI_FACTION_CLASSES = classesFor;
