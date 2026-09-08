import { classesFor, classStrength, shipClass } from './ships';
import { enemyOf, type BuildItem, type FactionId, type Fleet, type GameState, type Planet } from './types';
import { hopDistances, findPath, pathLength } from './pathfinding';
import { buildOptions, buildCost, canInvade, enqueueBuild, factionName, fleetStrength, fleetTroopCap, fleetsAt, hasArmedEnemy, orderInvade, orderMerge, orderMission, orderMove, orderSplit, ownedPlanets, rng, transferTroops, alignment, assignCommander, captives, fleetCommander, isIdle, missionProblem, roster, ROSTER_CAP, charactersAt, missionChance, VICTORY_TARGETS } from './sim';

export function runAI(s: GameState, f: FactionId): void {
  const enemy = enemyOf(f);
  const fac = s.factions[f];
  const mine = ownedPlanets(s, f);
  if (!mine.length) return;

  // ---- consolidate fleets sitting together (anywhere, blockades included) ----
  for (const p of s.planets) {
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
  // when the navy is short of capital ships, everything else spends only above a savings floor for one
  const topYard = Math.max(0, ...mine.map(p => p.shipyard));
  const largeShort = counts.large / Math.max(1, counts.small + counts.medium + counts.large) < 0.22 && topYard >= 2;
  // save toward the cheapest capital hull the best yard can build, but never more than three days of income
  const largeCosts = classesFor(f).filter(c => c.size === 'large' && c.minShipyard <= topYard && !c.interdictor).map(c => c.cost);
  const savingsTarget = largeShort && largeCosts.length ? Math.min(Math.min(...largeCosts), 3 * s.dayIncome[f]) : 0;
  for (const p of owned) {
    if (p.queue.length >= 2) continue;
    const opts = buildOptions(s, p);
    const affordable = (it: BuildItem) => {
      // the savings floor applies only to buying other ships; troops, defenses and yards go ahead
      const floor = reserve + (it.kind === 'ship' && shipClass(it.cls!).size !== 'large' ? savingsTarget : 0);
      return fac.credits - buildCost(it, p) >= floor;
    };
    let choice: BuildItem | undefined;
    const neutralsNear = (() => { const h = hopDistances(s.lanes, p.id); return s.planets.filter(q => q.owner === null && (h.get(q.id) ?? 99) <= 3).length; })();
    // the Empire raises garrison troops wherever neutral worlds are within reach, to go and take them
    const wantsTroops = p.garrison < 2 || ((p.id === fac.hq || p.shipyard > 0) && p.garrison < 7 && troopsAboard < troopCap) || (f === 'empire' && neutralsNear > 0 && p.garrison < 4);
    if (p.garrison < (p.id === fac.hq ? 4 : 2)) choice = opts.find(o => o.kind === 'troop');
    else if (p.id === fac.hq && p.defense < 2 && fac.credits > 700) choice = opts.find(o => o.kind === 'defense');
    else if (p.shipyard === 0 && p.production >= 8 && fac.credits > 450 && rng.chance(0.5)) choice = opts.find(o => o.kind === 'shipyard');
    else if (wantsTroops && rng.chance(0.6)) choice = opts.find(o => o.kind === 'troop');
    else if (p.shipyard > 0 && myFleetShips.length < shipCap) {
      const ships = opts.filter(o => o.kind === 'ship');
      const total = counts.small + counts.medium + counts.large + 1;
      const want: Record<string, number> = { small: 0.5 - counts.small / total, medium: 0.25 - counts.medium / total, large: 0.25 - counts.large / total };
      const neutralsLeft = s.planets.filter(q => q.owner === null).length;
      const needTransport = counts.transport < (f === 'empire' ? 3 + Math.floor(neutralsLeft / 12) : 2 + Math.floor(mine.length / 6));
      // pick what the fleet composition needs, ignoring price; if it is out of reach, save up rather than
      // buying the cheapest thing available (that is how a navy ends up as nothing but TIE fighters)
      let best: BuildItem | undefined, bestScore = -Infinity;
      for (const it of ships) {
        const c = shipClass(it.cls!);
        let score = c.shape === 'transport' ? (needTransport ? 0.4 : -1) : want[c.size] + rng.range(0, 0.15);
        if (c.interdictor) score = myFleetShips.filter(sh => sh.cls === c.id).length < 2 && fac.credits > 900 ? 0.35 : -5;
        if (c.size === 'large' && p.shipyard >= 2) score += 0.1;
        if (score > bestScore) { bestScore = score; best = it; }
      }
      const fleetSize = counts.small + counts.medium + counts.large;
      // a yard whose best option is already over-supplied stays idle so the credits reach the big yards
      if (best && bestScore > 0.03) {
        if (affordable(best)) choice = best;
        else if (fleetSize < 8 || myFleetShips.length < 12) {
          // early on, keep the yards busy with the best affordable ship of a different size class
          const cheaper = ships.filter(it => affordable(it) && shipClass(it.cls!).size !== shipClass(best!.cls!).size && shipClass(it.cls!).shape !== 'transport')
            .sort((x, y) => shipClass(y.cls!).cost - shipClass(x.cls!).cost)[0];
          if (cheaper) choice = cheaper;
        }
        // otherwise: save for it
      }
      if (!choice && p.shipyard < 2 && fac.credits > 600 && rng.chance(0.3)) choice = opts.find(o => o.kind === 'shipyard');
    } else if (p.shipyard > 0 && p.shipyard < 3 && fac.credits > 900 && rng.chance(0.4)) choice = opts.find(o => o.kind === 'shipyard');
    else if (p.defense < 1 && p.shipyard >= 2 && fac.credits > 600 && rng.chance(0.3)) choice = opts.find(o => o.kind === 'defense');
    if (choice && affordable(choice)) enqueueBuild(s, p, choice);
  }

  // ---- fleet operations ----
  const hq = s.planets[fac.hq];
  const hopsFromHq = hopDistances(s.lanes, hq.id);
  const enemyFleets = s.fleets.filter(fl => fl.faction === enemy && fl.at !== null);
  const threatNearHome = enemyFleets.some(fl => (hopsFromHq.get(fl.at!) ?? 99) <= 2 && fl.ships.length > 0);
  const enemyStrengthAt = (pid: number) => fleetsAt(s, pid, enemy).reduce((sum, fl) => sum + fleetStrength(fl), 0);
  const platformStrength = classStrength(shipClass('platform'));

  const chooseTarget = (fl: Fleet, str: number): Planet | null => {
    const hops = hopDistances(s.lanes, fl.at!);
    let best: Planet | null = null, bestScore = 0;
    for (const p of s.planets) {
      if (p.owner === f || p.id === fl.at) continue;
      const h = hops.get(p.id) ?? 99;
      if (h > 7) continue;
      const risk = enemyStrengthAt(p.id) + p.defense * platformStrength + (p.owner === enemy ? 6 : 0);
      const needTroops = p.garrison + 1;
      const canTake = fl.troops >= needTroops;
      if (p.owner === null && !canTake) continue;
      if (str < risk * 1.25) continue;
      let value = p.production + p.shipyard * 6 + (p.owner === enemy ? 12 : f === 'empire' ? 8 : 4);
      if (p.owner === null && alignment(p, enemy) > 20) value += f === 'empire' ? 10 : 4; // secure it before it joins the other side
      if (p.owner === enemy && p.id === s.factions[enemy].hq && (f === 'rebellion' || fac.knowsEnemyHq)) value += 80;
      if (canTake && p.owner === enemy && fleetsAt(s, p.id, f).length && !hasArmedEnemy(s, p.id, f)) value += 12; // our blockade is waiting for troops
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
    if (here.owner === enemy && !hasArmedEnemy(s, here.id, f) && here.defense === 0 && !here.invasion) {
      // undefended enemy world but not enough troops: fetch some if we can carry them, otherwise hold the blockade
      if (fleetTroopCap(fl) > fl.troops) {
        const src = mine.filter(p => p.garrison > 2).sort((a, b) => b.garrison - a.garrison)[0];
        if (src && rng.chance(0.5)) { orderMove(s, fl, src.id); continue; }
      }
      continue;
    }

    // load troops when at home (leave a garrison of 2, or 4 at the capital)
    const keep = here.id === fac.hq ? 5 : 2;
    if (here.owner === f && here.garrison > keep && fl.troops < fleetTroopCap(fl)) transferTroops(s, fl, Math.min(here.garrison - keep, fleetTroopCap(fl) - fl.troops));

    const isHomeGuard = fl.at === hq.id;
    if (isHomeGuard) {
      // the home guard never leaves the capital; when it grows large it spins off a strike group instead
      if (!threatNearHome && str > 110 && fl.ships.length >= 8) {
        const ids = fl.ships.filter((_, i) => i % 2 === 0).map(sh => sh.id);
        const nf = orderSplit(s, fl, ids, Math.ceil(fl.troops / 2));
        if (nf) {
          nf.name = `${factionName(f)} Strike Group`;
          const t = chooseTarget(nf, fleetStrength(nf));
          if (t) orderMove(s, nf, t.id); else orderMerge(s, fl, nf);
        }
      }
      continue;
    }
    if (str < 25 && fl.troops === 0) continue; // small groups may still go and land troops

    const best = chooseTarget(fl, str);
    if (best) { orderMove(s, fl, best.id); continue; }

    // relieve blockaded worlds
    const blockaded = mine.find(p => hasArmedEnemy(s, p.id, f) && str > enemyStrengthAt(p.id) * 1.3);
    if (blockaded && !isHomeGuard) orderMove(s, fl, blockaded.id);
  }

  // ---- characters ----
  const idle = s.characters.filter(c => c.faction === f && isIdle(c));
  // best leader takes command of the strongest fleet sitting with them
  for (const c of idle.slice().sort((a, b) => b.leadership - a.leadership)) {
    if (c.leadership < 3) break;
    const here = fleetsAt(s, c.at, f).filter(fl => !fleetCommander(s, fl.id) && fleetStrength(fl) >= 40).sort((a, b) => fleetStrength(b) - fleetStrength(a))[0];
    if (here && assignCommander(s, c, here)) break;
  }
  const idle2 = s.characters.filter(c => c.faction === f && isIdle(c));
  // rescue captives, in teams of up to two
  for (const cap of captives(s, f)) {
    const rescuers = idle2.filter(c => Math.max(c.sabotage, c.espionage) >= 3 && !missionProblem(s, c, 'rescue', cap.at)).sort((a, b) => Math.max(b.sabotage, b.espionage) - Math.max(a.sabotage, a.espionage)).slice(0, 2);
    if (rescuers.length && rng.chance(0.5)) for (const r of rescuers) { orderMission(s, r, 'rescue', cap.at); idle2.splice(idle2.indexOf(r), 1); }
  }
  // the Empire hunts Mon Mothma; both sides snatch exposed leaders when the odds are decent
  {
    const agents = idle2.filter(c => Math.max(c.sabotage, c.espionage) >= 4).sort((a, b) => Math.max(b.sabotage, b.espionage) - Math.max(a.sabotage, a.espionage));
    if (agents.length && rng.chance(f === 'empire' ? 0.5 : 0.25)) {
      const hops = hopDistances(s.lanes, agents[0].at);
      const prize = s.planets.filter(p => (hops.get(p.id) ?? 99) <= 5 && !missionProblem(s, agents[0], 'abduct', p.id))
        .map(p => ({ p, score: (charactersAt(s, p.id, enemy).some(c => VICTORY_TARGETS[f].includes(c.name) || c.name === 'Mon Mothma') ? 5 : 1) * missionChance(s, agents.slice(0, 2), 'abduct', p.id) }))
        .sort((a, b) => b.score - a.score)[0];
      if (prize && prize.score >= 0.35) for (const a of agents.slice(0, 2)) { orderMission(s, a, 'abduct', prize.p.id); idle2.splice(idle2.indexOf(a), 1); }
    }
  }
  // recruit while the roster has room
  if (roster(s, f).length < ROSTER_CAP[f]) {
    const rec = idle2.filter(c => c.diplomacy >= 2).sort((a, b) => b.diplomacy - a.diplomacy)[0];
    if (rec && rng.chance(f === 'rebellion' ? 0.5 : 0.3)) {
      const t = s.planets.filter(p => !missionProblem(s, rec, 'recruit', p.id)).sort((a, b) => alignment(b, f) - alignment(a, f))[0];
      if (t) { orderMission(s, rec, 'recruit', t.id); idle2.splice(idle2.indexOf(rec), 1); }
    }
  }
  const keepHome = idle2.filter(c => c.at === hq.id).sort((a, b) => b.leadership - a.leadership)[0];
  for (const c of idle2) {
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
