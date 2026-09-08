import { Rng } from '../core/rng';
import { classesFor, classStrength, COURIER_SPEED, DEFENSE_COST, DEFENSE_HOURS, MAX_DEFENSE, SHIPYARD_COST, SHIPYARD_HOURS, shipClass, TROOP_COST, TROOP_HOURS } from './ships';
import { enemyOf, FACTIONS, HOURS_PER_DAY, dayOf, type BuildItem, type Character, type FactionId, type Fleet, type GameState, type LogEntry, type MissionType, type Planet } from './types';
import { findPath, laneBetween, pathLength, hopDistances } from './pathfinding';
import { runAI } from './ai';
import { canSeeDetails } from './visibility';

export const rng = new Rng(12345);

export function log(s: GameState, text: string, kind: LogEntry['kind'] = 'info', faction: FactionId | 'all' = 'all', planet?: number): void {
  s.log.push({ time: s.hours, text, kind, faction, planet });
  if (s.log.length > 600) s.log.splice(0, s.log.length - 600);
}

// ---------------------------------------------------------------- queries
export function planet(s: GameState, id: number): Planet { return s.planets[id]; }
export function fleetsAt(s: GameState, planetId: number, faction?: FactionId): Fleet[] {
  return s.fleets.filter(f => f.at === planetId && (!faction || f.faction === faction));
}
export function fleetStrength(f: Fleet): number {
  return f.ships.reduce((sum, sh) => sum + classStrength(shipClass(sh.cls)) * (0.4 + 0.6 * sh.hull), 0);
}
export function fleetHyperSpeed(f: Fleet): number {
  return f.ships.reduce((m, sh) => Math.min(m, shipClass(sh.cls).hyperSpeed), 99) || 3;
}
export function fleetTroopCap(f: Fleet): number {
  return f.ships.reduce((sum, sh) => sum + shipClass(sh.cls).troopCap, 0);
}
export function hasArmedEnemy(s: GameState, planetId: number, faction: FactionId): boolean {
  return s.fleets.some(f => f.at === planetId && f.faction !== faction && f.ships.length > 0);
}
/** True if planet is hostile ground for `faction` to arrive at: enemy warships or enemy-owned defenses. */
export function isContested(s: GameState, planetId: number, faction: FactionId): boolean {
  const p = s.planets[planetId];
  if (hasArmedEnemy(s, planetId, faction)) return true;
  return p.owner !== null && p.owner !== faction && p.defense > 0;
}
export function isBlockaded(s: GameState, p: Planet): boolean {
  return p.owner !== null && hasArmedEnemy(s, p.id, p.owner);
}
/** Alignment of a planet toward a faction, -100..100 */
export function alignment(p: Planet, f: FactionId): number { return f === 'rebellion' ? p.loyalty : -p.loyalty; }
export function incomeMultiplier(p: Planet): number {
  if (!p.owner) return 0;
  return 0.4 + 0.6 * ((alignment(p, p.owner) + 100) / 200);
}
export function planetIncomePerDay(s: GameState, p: Planet): number {
  if (!p.owner || isBlockaded(s, p)) return 0;
  return p.production * incomeMultiplier(p);
}
export function factionIncome(s: GameState, f: FactionId): number {
  return s.planets.filter(p => p.owner === f).reduce((sum, p) => sum + planetIncomePerDay(s, p), 0);
}
export function ownedPlanets(s: GameState, f: FactionId): Planet[] { return s.planets.filter(p => p.owner === f); }
export function charactersAt(s: GameState, planetId: number, faction?: FactionId): Character[] {
  return s.characters.filter(c => c.at === planetId && !c.captured && !c.dead && !c.mission && (!faction || c.faction === faction) && charIsPresent(s, c));
}
/** A commander aboard a fleet in hyperspace is nowhere in particular. */
export function charIsPresent(s: GameState, c: Character): boolean {
  if (c.assignment?.kind !== 'fleet') return true;
  const f = s.fleets.find(x => x.id === (c.assignment as { fleetId: number }).fleetId);
  return !!f && f.at !== null;
}
export function fleetCommander(s: GameState, fleetId: number): Character | undefined {
  return s.characters.find(c => c.assignment?.kind === 'fleet' && c.assignment.fleetId === fleetId && !c.captured && !c.dead);
}
export function governorOf(s: GameState, planetId: number): Character | undefined {
  return s.characters.find(c => c.assignment?.kind === 'governor' && c.at === planetId && !c.captured && !c.dead);
}
export function roster(s: GameState, f: FactionId): Character[] { return s.characters.filter(c => c.faction === f && !c.dead); }
export const ROSTER_CAP: Record<FactionId, number> = { empire: 11, rebellion: 18 };
export function isIdle(c: Character): boolean { return !c.captured && !c.dead && !c.mission && !c.assignment; }
export function shiftLoyalty(p: Planet, toward: FactionId, amount: number): void {
  p.loyalty += toward === 'rebellion' ? amount : -amount;
  p.loyalty = Math.max(-100, Math.min(100, p.loyalty));
}

// ---------------------------------------------------------------- orders
export function orderMove(s: GameState, fleet: Fleet, dest: number): boolean {
  const origin = fleet.at ?? fleet.travel!.to;
  if (origin === dest && fleet.at !== null) return false;
  const path = findPath(s.lanes, origin, dest);
  if (!path) return false;
  if (fleet.at !== null) {
    if (path.length < 2) return false;
    fleet.travel = { from: path[0], to: path[1], progress: 0, path: path.slice(2) };
    fleet.at = null;
  } else {
    // already in flight: keep current leg, replace the rest of the route
    fleet.travel!.path = path.slice(1);
  }
  return true;
}

export function orderStop(s: GameState, fleet: Fleet): void {
  if (fleet.travel) fleet.travel.path = [];
}

export function canInvade(s: GameState, fleet: Fleet): { ok: boolean; reason: string } {
  if (fleet.at === null) return { ok: false, reason: 'In transit' };
  const p = s.planets[fleet.at];
  if (p.destroyed) return { ok: false, reason: 'Nothing left to take' };
  if (p.owner === fleet.faction) return { ok: false, reason: 'Friendly planet' };
  if (fleet.troops <= 0) return { ok: false, reason: 'No troops aboard' };
  if (hasArmedEnemy(s, p.id, fleet.faction)) return { ok: false, reason: 'Enemy fleet in orbit' };
  if (p.defense > 0) return { ok: false, reason: 'Orbital defenses active' };
  if (p.invasion) return { ok: false, reason: 'Invasion in progress' };
  return { ok: true, reason: '' };
}

export function orderInvade(s: GameState, fleet: Fleet, troops?: number): boolean {
  const c = canInvade(s, fleet);
  if (!c.ok) return false;
  const n = Math.min(fleet.troops, troops ?? fleet.troops);
  const p = s.planets[fleet.at!];
  fleet.troops -= n;
  p.invasion = { attacker: fleet.faction, troops: n, hoursLeft: 10, total: 10 };
  log(s, `${factionName(fleet.faction)} troops land on ${p.name}`, 'battle', 'all', p.id);
  return true;
}

export function orderMerge(s: GameState, into: Fleet, from: Fleet): boolean {
  if (into.id === from.id || into.faction !== from.faction || into.at === null || into.at !== from.at) return false;
  into.ships.push(...from.ships);
  into.troops += from.troops;
  for (const c of s.characters) if (c.assignment?.kind === 'fleet' && c.assignment.fleetId === from.id) c.assignment = fleetCommander(s, into.id) ? null : { kind: 'fleet', fleetId: into.id };
  s.fleets = s.fleets.filter(f => f.id !== from.id);
  return true;
}

export function orderSplit(s: GameState, fleet: Fleet, shipIds: number[], troops: number): Fleet | null {
  if (fleet.at === null || shipIds.length === 0 || shipIds.length === fleet.ships.length) return null;
  const moving = fleet.ships.filter(sh => shipIds.includes(sh.id));
  fleet.ships = fleet.ships.filter(sh => !shipIds.includes(sh.id));
  const nf: Fleet = { id: s.nextId++, faction: fleet.faction, name: `${fleet.name} Detachment`, ships: moving, troops: 0, at: fleet.at, travel: null };
  const cap = fleetTroopCap(nf);
  const t = Math.min(troops, fleet.troops, cap);
  nf.troops = t; fleet.troops -= t;
  s.fleets.push(nf);
  return nf;
}

export function transferTroops(s: GameState, fleet: Fleet, amount: number): boolean {
  // positive: load from planet garrison, negative: unload to garrison
  if (fleet.at === null) return false;
  const p = s.planets[fleet.at];
  if (p.owner !== fleet.faction) return false;
  if (amount > 0) {
    const n = Math.min(amount, p.garrison, fleetTroopCap(fleet) - fleet.troops);
    if (n <= 0) return false;
    p.garrison -= n; fleet.troops += n;
  } else {
    const n = Math.min(-amount, fleet.troops);
    if (n <= 0) return false;
    p.garrison += n; fleet.troops -= n;
  }
  return true;
}

export const MISSION_HOURS: Record<MissionType, number> = { diplomacy: 36, espionage: 24, sabotage: 30, incite: 36, recruit: 48, rescue: 24, abduct: 24, deathstar: 12 };
/** Missions several leaders can run together against one target; each extra member raises the odds. */
export const TEAM_MISSIONS: MissionType[] = ['rescue', 'abduct', 'deathstar'];
/** The only pilots who can fly the trench run. */
export const TRENCH_RUN_PILOTS = ['Luke Skywalker', 'Leia Organa', 'Han Solo'];
export const MISSION_LABEL: Record<MissionType, string> = { diplomacy: 'Diplomacy', espionage: 'Espionage', sabotage: 'Sabotage', incite: 'Incite Uprising', recruit: 'Recruit', rescue: 'Rescue', abduct: 'Abduct', deathstar: 'Trench Run' };
export const MISSION_DESC: Record<MissionType, string> = {
  diplomacy: 'Raise the planet\'s loyalty to your cause. Neutral planets join you at high loyalty.',
  espionage: 'Reveal enemy fleets, garrisons and production. The Empire may locate the hidden Rebel base.',
  sabotage: 'Destroy construction progress, defense platforms or shipyards; damage ships in orbit.',
  incite: 'Stir unrest on an enemy world. Low-garrison planets with hostile populations revolt.',
  recruit: 'Find a new leader on one of your worlds or a sympathetic neutral. The Rebellion finds them more easily.',
  rescue: 'Break a captured leader out of an enemy world. Risky; sabotage and espionage help. Send several leaders at the same world to raise the odds.',
  abduct: 'Seize an enemy leader known to be on a world and bring them to one of your worlds. Send several leaders at the same world to raise the odds.',
  deathstar: 'Fly the trench run and destroy the Death Star. Only Luke, Leia and Han can attempt it; send all three for the best odds. Success turns the galaxy against the Empire.',
};

/** Why a mission cannot target a planet, or null if it can. */
export function missionProblem(s: GameState, ch: Character, type: MissionType, target: number): string | null {
  const p = s.planets[target];
  switch (type) {
    case 'recruit':
      if (p.destroyed) return 'There is no one left there';
      if (roster(s, ch.faction).length >= ROSTER_CAP[ch.faction]) return 'Roster is full';
      if (p.owner !== ch.faction && !(p.owner === null && alignment(p, ch.faction) > 0)) return 'Needs one of your worlds or a sympathetic neutral';
      return null;
    case 'rescue':
      if (!s.characters.some(c => c.faction === ch.faction && c.captured && !c.dead && c.at === target)) return 'No captured leader is held there';
      return null;
    case 'abduct': {
      if (!canSeeDetails(s, ch.faction, p)) return 'You have no intelligence on who is there';
      if (!charactersAt(s, target, enemyOf(ch.faction)).length) return 'No enemy leader is known to be there';
      return null;
    }
    case 'deathstar': {
      if (ch.faction !== 'rebellion' || !TRENCH_RUN_PILOTS.includes(ch.name)) return 'Only Luke, Leia or Han can fly the trench run';
      if (!s.deathStar || s.deathStar.destroyed) return 'There is no Death Star to attack';
      if (s.deathStar.at !== target) return `The Death Star is at ${s.planets[s.deathStar.at].name}`;
      if (s.deathStar.vulnerableAt !== undefined && s.hours < s.deathStar.vulnerableAt) return `The Alliance has no plans for the station yet (${Math.ceil((s.deathStar.vulnerableAt - s.hours) / 24)} days)`;
      return null;
    }
    case 'incite': case 'sabotage':
      if (p.owner === ch.faction) return 'That is your own world';
      return null;
    default: return null;
  }
}

const REBEL_RECRUITS: [string, string, number, number, number, number][] = [
  ['Wedge Antilles', 'Commander', 1, 2, 3, 4], ['Crix Madine', 'General', 2, 3, 4, 4], ['Jan Dodonna', 'General', 2, 2, 1, 4],
  ['Garm Bel Iblis', 'Senator', 4, 2, 2, 3], ['Carlist Rieekan', 'General', 2, 2, 2, 4], ['Lando Calrissian', 'Baron', 4, 3, 3, 2],
  ['Chewbacca', 'Warrior', 1, 2, 4, 3], ['Hera Syndulla', 'Captain', 2, 3, 2, 4], ['Kanan Jarrus', 'Knight', 3, 3, 3, 3],
  ['Sabine Wren', 'Specialist', 1, 3, 5, 2], ['Cassian Andor', 'Captain', 2, 5, 4, 2], ['Jyn Erso', 'Sergeant', 1, 3, 4, 2],
  ['Saw Gerrera', 'Partisan', 1, 2, 5, 3], ['Bail Organa', 'Senator', 5, 2, 1, 2], ['Nien Nunb', 'Pilot', 1, 3, 2, 2],
  ['Wes Janson', 'Lieutenant', 1, 2, 2, 3], ['Biggs Darklighter', 'Lieutenant', 1, 2, 2, 3], ['Kyle Katarn', 'Agent', 1, 4, 5, 2],
  ['Winter Celchu', 'Agent', 3, 5, 2, 1], ['Bren Derlin', 'Major', 1, 2, 2, 3], ['Ezra Bridger', 'Padawan', 2, 4, 3, 2],
  ['Zeb Orrelios', 'Captain', 1, 1, 4, 3], ['Cham Syndulla', 'General', 3, 2, 3, 4], ['Borsk Fey\'lya', 'Councillor', 4, 4, 1, 1],
];
const IMPERIAL_RECRUITS: [string, string, number, number, number, number][] = [
  ['Thrawn', 'Grand Admiral', 3, 4, 1, 5], ['Veers', 'General', 1, 2, 2, 5], ['Ozzel', 'Admiral', 1, 1, 1, 3],
  ['Jerjerrod', 'Moff', 3, 2, 1, 3], ['Motti', 'Admiral', 2, 1, 1, 3], ['Needa', 'Captain', 1, 2, 1, 3],
  ['Daala', 'Admiral', 1, 2, 2, 4], ['Pellaeon', 'Captain', 2, 2, 1, 4], ['Krennic', 'Director', 2, 4, 3, 2],
  ['Kallus', 'Agent', 1, 5, 3, 2], ['Pryce', 'Governor', 3, 3, 1, 2], ['Yularen', 'Colonel', 2, 5, 2, 3],
  ['Mara Jade', 'Emperor\'s Hand', 2, 5, 5, 2], ['Boba Fett', 'Bounty Hunter', 1, 4, 5, 2], ['Zsinj', 'Warlord', 1, 2, 2, 4],
];

/** Members of a team mission currently working the same target. */
export function missionTeam(s: GameState, c: Character): Character[] {
  const m = c.mission;
  if (!m || !TEAM_MISSIONS.includes(m.type)) return [c];
  return s.characters.filter(x => x.faction === c.faction && !x.captured && !x.dead && x.mission && x.mission.type === m.type && x.mission.target === m.target && x.mission.phase === 'work');
}

/** Success odds of a mission (0..1), for the UI and for resolution. `team` are the leaders working it together. */
export function missionChance(s: GameState, team: Character[], type: MissionType, target: number): number {
  const p = s.planets[target];
  const lead = team[0];
  const enemy = enemyOf(lead.faction);
  const hostile = p.owner === enemy;
  const skillOf = (c: Character) => type === 'diplomacy' || type === 'incite' || type === 'recruit' ? c.diplomacy : type === 'espionage' ? c.espionage : type === 'rescue' || type === 'abduct' ? Math.max(c.sabotage, c.espionage) : c.sabotage;
  const skill = Math.max(...team.map(skillOf));
  let chance = 0.3 + skill * 0.11;
  if (hostile) chance -= p.garrison * 0.04;
  chance -= charactersAt(s, p.id, enemy).length * 0.1;
  const gov = governorOf(s, p.id);
  if (gov && gov.faction === enemy) chance -= 0.06 * gov.espionage;
  if (type === 'recruit') chance = 0.2 + skill * 0.08 + (lead.faction === 'rebellion' ? 0.15 : 0) + Math.max(0, alignment(p, lead.faction)) / 250;
  if (type === 'rescue') chance = 0.15 + skill * 0.09 - (hostile ? p.garrison * 0.05 : 0) - (gov && gov.faction === enemy ? 0.05 * gov.espionage : 0);
  if (type === 'abduct') chance = 0.12 + skill * 0.09 - (hostile ? p.garrison * 0.05 : 0) - charactersAt(s, p.id, enemy).length * 0.05 - (gov && gov.faction === enemy ? 0.05 * gov.espionage : 0);
  if (type === 'deathstar') chance = 0.4 + Math.max(...team.map(c => Math.max(c.sabotage, c.leadership))) * 0.08 + (team.some(c => c.name === 'Luke Skywalker') ? 0.12 : 0);
  if (TEAM_MISSIONS.includes(type)) chance += Math.min(0.3, (type === 'deathstar' ? 0.12 : 0.1) * (team.length - 1));
  return Math.max(0.05, Math.min(0.95, chance));
}

// ---------------------------------------------------------------- assignments
export function assignGovernor(s: GameState, ch: Character): boolean {
  if (!isIdle(ch) || s.planets[ch.at].owner !== ch.faction) return false;
  if (governorOf(s, ch.at)) return false;
  ch.assignment = { kind: 'governor' };
  return true;
}
export function assignCommander(s: GameState, ch: Character, fleet: Fleet): boolean {
  if (!isIdle(ch) || fleet.faction !== ch.faction || fleet.at !== ch.at) return false;
  if (fleetCommander(s, fleet.id)) return false;
  ch.assignment = { kind: 'fleet', fleetId: fleet.id };
  return true;
}
export function relieve(s: GameState, ch: Character): void {
  if (ch.assignment?.kind === 'fleet') {
    const id = ch.assignment.fleetId;
    const f = s.fleets.find(x => x.id === id);
    if (f && f.at !== null) ch.at = f.at;
  }
  ch.assignment = null;
}
/** Leadership of the commander aboard any of these fleets (0 if none). */
export function commandBonus(s: GameState, fleets: Fleet[]): number {
  return fleets.reduce((m, f) => Math.max(m, fleetCommander(s, f.id)?.leadership ?? 0), 0);
}

export function orderMission(s: GameState, ch: Character, type: MissionType, target: number): boolean {
  if (!isIdle(ch)) return false;
  if (missionProblem(s, ch, type, target)) return false;
  const path = findPath(s.lanes, ch.at, target);
  if (!path) return false;
  const travel = pathLength(s.lanes, path) / COURIER_SPEED;
  ch.mission = { type, target, phase: travel > 0 ? 'travel' : 'work', hoursLeft: travel > 0 ? travel : MISSION_HOURS[type], total: MISSION_HOURS[type] };
  return true;
}

export function recallCharacter(s: GameState, ch: Character): void {
  if (ch.mission && ch.mission.phase === 'travel') ch.mission = null;
}
export function captives(s: GameState, f: FactionId): Character[] { return s.characters.filter(c => c.faction === f && c.captured && !c.dead); }

// ---------------------------------------------------------------- building
export function buildOptions(s: GameState, p: Planet): BuildItem[] {
  const out: BuildItem[] = [];
  if (!p.owner) return out;
  for (const c of classesFor(p.owner)) {
    if (p.shipyard >= c.minShipyard) out.push({ kind: 'ship', cls: c.id, progress: 0, total: c.buildHours, label: c.name });
  }
  out.push({ kind: 'troop', progress: 0, total: TROOP_HOURS, label: 'Troop Regiment' });
  if (p.shipyard < 3 && !p.queue.some(q => q.kind === 'shipyard')) out.push({ kind: 'shipyard', progress: 0, total: SHIPYARD_HOURS, label: `Shipyard Lv${p.shipyard + 1}` });
  if (p.defense + p.queue.filter(q => q.kind === 'defense').length < MAX_DEFENSE) out.push({ kind: 'defense', progress: 0, total: DEFENSE_HOURS, label: 'Defense Platform' });
  return out;
}

export function buildCost(item: BuildItem, p: Planet): number {
  switch (item.kind) {
    case 'ship': return shipClass(item.cls!).cost;
    case 'troop': return TROOP_COST;
    case 'shipyard': return SHIPYARD_COST[Math.min(3, p.shipyard + 1 + p.queue.filter(q => q.kind === 'shipyard').length)] ?? 800;
    case 'defense': return DEFENSE_COST;
  }
}

export function enqueueBuild(s: GameState, p: Planet, item: BuildItem): boolean {
  if (!p.owner) return false;
  const fac = s.factions[p.owner];
  const cost = buildCost(item, p);
  if (fac.credits < cost) return false;
  if (p.queue.length >= 6) return false;
  fac.credits -= cost;
  p.queue.push({ ...item, progress: 0 });
  return true;
}

export function cancelBuild(s: GameState, p: Planet, idx: number): void {
  const item = p.queue[idx];
  if (!item || !p.owner) return;
  s.factions[p.owner].credits += Math.round(buildCost(item, p) * 0.75);
  p.queue.splice(idx, 1);
}

// ---------------------------------------------------------------- tick
const MAX_SUBSTEP = 0.25;

export function step(s: GameState, dtHours: number): void {
  if (s.winner || s.pendingBattle) return;
  let left = dtHours;
  while (left > 0 && !s.pendingBattle && !s.winner) {
    const dt = Math.min(MAX_SUBSTEP, left);
    left -= dt;
    substep(s, dt);
  }
}

function substep(s: GameState, dt: number): void {
  s.hours += dt;
  for (const f of FACTIONS) s.dayIncome[f] = factionIncome(s, f);

  // Mon Mothma's voice: while she is alive and free, every world not under Imperial rule drifts toward the Alliance
  const mothma = s.characters.find(c => c.name === 'Mon Mothma' && !c.dead && !c.captured);
  // economy + production + loyalty
  for (const p of s.planets) {
    if (mothma && p.owner !== 'empire') shiftLoyalty(p, 'rebellion', dt / HOURS_PER_DAY);
    for (const f of FACTIONS) if (p.intel[f] > 0) p.intel[f] = Math.max(0, p.intel[f] - dt);
    if (p.owner) {
      const blockaded = isBlockaded(s, p);
      if (blockaded !== !!p.blockaded) {
        p.blockaded = blockaded;
        log(s, blockaded ? `${p.name} is under blockade: production and construction halted` : `The blockade of ${p.name} is lifted`, p.owner === s.player ? (blockaded ? 'bad' : 'good') : 'info', 'all', p.id);
      }
      if (!blockaded) {
        s.factions[p.owner].credits += planetIncomePerDay(s, p) * dt / HOURS_PER_DAY;
        const item = p.queue[0];
        if (item) {
          item.progress += dt * (item.kind === 'ship' ? 0.8 + 0.2 * p.shipyard : 1);
          if (item.progress >= item.total) { p.queue.shift(); completeBuild(s, p, item); }
        }
      }
      // loyalty drift toward owner, faster with garrison
      const gov = governorOf(s, p.id);
      shiftLoyalty(p, p.owner, dt / HOURS_PER_DAY * (0.6 + 0.2 * Math.min(p.garrison, 4) + (gov ? 0.4 * gov.diplomacy : 0)));
      const a = alignment(p, p.owner);
      if (a < -50) {
        p.unrest += dt * (1 + (-a - 50) / 25);
        if (p.unrest >= 96 && p.garrison <= 1) uprising(s, p);
      } else p.unrest = Math.max(0, p.unrest - dt * 2);
    } else {
      // neutrals slowly regress to indifference, and join a side at strong loyalty
      p.loyalty *= Math.pow(0.995, dt);
      if (p.destroyed) { /* rubble joins no one */ }
      else if (p.loyalty >= 75) joinFaction(s, p, 'rebellion');
      else if (p.loyalty <= -75) joinFaction(s, p, 'empire');
    }
    if (p.invasion) {
      p.invasion.hoursLeft -= dt;
      if (p.invasion.hoursLeft <= 0) resolveInvasion(s, p);
    }
  }

  // fleets
  for (const f of s.fleets) {
    if (!f.travel) continue;
    const lane = laneBetween(s, f.travel.from, f.travel.to);
    const len = lane ? lane.length : 20;
    f.travel.progress += fleetHyperSpeed(f) * dt / len;
    if (f.travel.progress >= 1) {
      const arrived = f.travel.to;
      f.at = arrived;
      const remaining = f.travel.path;
      f.travel = null;
      if (isContested(s, arrived, f.faction)) {
        s.pendingBattle = { planet: arrived, attacker: f.faction };
        s.speed = 0;
        log(s, `${f.name} engages at ${s.planets[arrived].name}`, 'battle', 'all', arrived);
        return;
      }
      if (remaining.length) {
        f.travel = { from: arrived, to: remaining[0], progress: 0, path: remaining.slice(1) };
        f.at = null;
      } else {
        const p = s.planets[arrived];
        if (f.faction === s.player) log(s, `${f.name} arrived at ${p.name}`, 'info', f.faction, arrived);
      }
    }
  }
  s.fleets = s.fleets.filter(f => f.ships.length > 0);

  // characters: commanders ride their fleets, captives are interrogated, missions progress
  for (const c of s.characters) {
    if (c.dead) continue;
    if (c.assignment?.kind === 'fleet') {
      const f = s.fleets.find(x => x.id === (c.assignment as { fleetId: number }).fleetId);
      if (!f) c.assignment = null;
      else if (f.at !== null) c.at = f.at;
    }
    if (c.captured) { tickCaptivity(s, c, dt); continue; }
    if (!c.mission) continue;
    c.mission.hoursLeft -= dt;
    if (c.mission.hoursLeft > 0) continue;
    if (c.mission.phase === 'travel') {
      c.at = c.mission.target;
      c.mission.phase = 'work';
      c.mission.hoursLeft = c.mission.total;
    } else {
      resolveMission(s, c);
    }
  }

  if (Math.floor(s.hours / HOURS_PER_DAY) !== Math.floor((s.hours - dt) / HOURS_PER_DAY)) dailyEvents(s);
  stepDeathStar(s, dt);
  // AI
  s.aiTimer += dt;
  if (s.aiTimer >= 6) {
    s.aiTimer = 0;
    for (const f of FACTIONS) if (s.factions[f].isAI) runAI(s, f);
  }
  checkVictory(s);
}

function completeBuild(s: GameState, p: Planet, item: BuildItem): void {
  const owner = p.owner!;
  switch (item.kind) {
    case 'ship': {
      let fleet = s.fleets.find(f => f.at === p.id && f.faction === owner && f.name === `${p.name} Reserve`);
      if (!fleet) { fleet = { id: s.nextId++, faction: owner, name: `${p.name} Reserve`, ships: [], troops: 0, at: p.id, travel: null }; s.fleets.push(fleet); }
      fleet.ships.push({ id: s.nextId++, cls: item.cls!, hull: 1 });
      if (owner === s.player) log(s, `${item.label} completed at ${p.name}`, 'good', owner, p.id);
      break;
    }
    case 'troop': p.garrison += 1; if (owner === s.player) log(s, `Regiment trained at ${p.name}`, 'good', owner, p.id); break;
    case 'shipyard': p.shipyard = Math.min(3, p.shipyard + 1); if (owner === s.player) log(s, `Shipyard upgraded at ${p.name}`, 'good', owner, p.id); break;
    case 'defense': p.defense = Math.min(MAX_DEFENSE, p.defense + 1); if (owner === s.player) log(s, `Defense platform online at ${p.name}`, 'good', owner, p.id); break;
  }
}

function joinFaction(s: GameState, p: Planet, f: FactionId): void {
  p.owner = f; p.unrest = 0; p.garrison = Math.max(p.garrison, 1);
  log(s, `${p.name} has joined the ${factionName(f)}`, f === s.player ? 'good' : 'bad', 'all', p.id);
}

function uprising(s: GameState, p: Planet): void {
  const from = p.owner!;
  const to = enemyOf(from);
  p.owner = to; p.unrest = 0; p.garrison = 1; p.queue = []; p.defense = 0;
  log(s, `Uprising on ${p.name}! The planet defects to the ${factionName(to)}`, to === s.player ? 'good' : 'bad', 'all', p.id);
}

function resolveInvasion(s: GameState, p: Planet): void {
  const inv = p.invasion!;
  p.invasion = null;
  const leaders = s.characters.filter(c => c.faction === inv.attacker && c.at === p.id && !c.captured && !c.dead && !c.mission && charIsPresent(s, c));
  const leadBonus = leaders.reduce((m, c) => Math.max(m, c.leadership), 0) * 0.06;
  const att = inv.troops * (1 + leadBonus) * rng.range(0.85, 1.15);
  const def = p.garrison * 1.3 * rng.range(0.85, 1.15) + (p.owner ? (alignment(p, p.owner) + 100) / 200 * 0.5 : 0);
  if (att > def) {
    const prev = p.owner;
    p.owner = inv.attacker;
    p.garrison = Math.max(1, Math.round(inv.troops * (1 - 0.7 * def / att)));
    p.queue = []; p.unrest = 0;
    shiftLoyalty(p, inv.attacker, -12);
    for (const c of s.characters.filter(c => prev && c.faction === prev && c.at === p.id && !c.captured && !c.mission)) {
      if (rng.chance(0.5)) { captureCharacter(s, c, p.id); log(s, `${c.title} ${c.name} was captured on ${p.name}`, c.faction === s.player ? 'bad' : 'good', 'all', p.id); }
      else evacuate(s, c);
    }
    log(s, `${factionName(inv.attacker)} forces have taken ${p.name}`, inv.attacker === s.player ? 'good' : 'bad', 'all', p.id);
  } else {
    p.garrison = Math.max(0, Math.round(p.garrison * (1 - 0.6 * att / def)));
    log(s, `Invasion of ${p.name} repelled`, inv.attacker === s.player ? 'bad' : 'good', 'all', p.id);
  }
  checkVictory(s);
}

function evacuate(s: GameState, c: Character): void {
  const own = ownedPlanets(s, c.faction);
  if (!own.length) return;
  let best = own[0], bestLen = Infinity;
  for (const p of own) {
    const path = findPath(s.lanes, c.at, p.id);
    if (path) { const l = pathLength(s.lanes, path); if (l < bestLen) { bestLen = l; best = p; } }
  }
  c.at = best.id;
}

function resolveMission(s: GameState, c: Character): void {
  const m = c.mission!;
  c.mission = null;
  const p = s.planets[m.target];
  const enemy = enemyOf(c.faction);
  const hostile = p.owner === enemy;
  const skill = m.type === 'diplomacy' || m.type === 'incite' || m.type === 'recruit' ? c.diplomacy : m.type === 'espionage' ? c.espionage : m.type === 'rescue' || m.type === 'abduct' ? Math.max(c.sabotage, c.espionage) : c.sabotage;
  // team missions resolve together: everyone on site shares the roll and the consequences
  c.mission = m;
  const team = missionTeam(s, c);
  c.mission = null;
  const chance = missionChance(s, team, m.type, m.target);
  const success = rng.chance(chance);
  const who = team.length > 1 ? team.map(x => `${x.title} ${x.name}`).join(' and ') : `${c.title} ${c.name}`;
  const mine = c.faction === s.player;
  for (const x of team) x.mission = null;
  if (success) {
    switch (m.type) {
      case 'diplomacy': {
        shiftLoyalty(p, c.faction, 12 + skill * 3);
        log(s, `${who}: diplomacy on ${p.name} succeeded (loyalty ${p.loyalty > 0 ? '+' : ''}${Math.round(p.loyalty)})`, mine ? 'good' : 'info', c.faction, p.id);
        break;
      }
      case 'espionage': {
        p.intel[c.faction] = 120;
        if (c.faction === 'empire' && p.owner === 'rebellion') {
          if (p.id === s.factions.rebellion.hq) { s.factions.empire.knowsEnemyHq = true; log(s, `${who} has located the Rebel headquarters on ${p.name}!`, mine ? 'good' : 'bad', 'all', p.id); }
          else log(s, `${who}: espionage on ${p.name} — no Rebel HQ here`, 'info', c.faction, p.id);
        } else log(s, `${who}: espionage on ${p.name} succeeded`, mine ? 'good' : 'info', c.faction, p.id);
        break;
      }
      case 'sabotage': {
        let what = '';
        const enemyFleets = fleetsAt(s, p.id, enemy);
        if (p.queue.length && p.owner === enemy) { const it = p.queue.shift()!; what = `destroyed ${it.label} under construction`; }
        else if (p.defense > 0 && p.owner === enemy) { p.defense--; what = 'destroyed a defense platform'; }
        else if (enemyFleets.length) { for (const f of enemyFleets) for (const sh of f.ships) sh.hull = Math.max(0.1, sh.hull - 0.2); what = 'damaged ships in orbit'; }
        else if (p.shipyard > 0 && p.owner === enemy) { p.shipyard--; what = 'damaged the shipyard'; }
        else what = 'found nothing worth destroying';
        log(s, `${who}: sabotage on ${p.name} ${what}`, mine ? 'good' : 'bad', 'all', p.id);
        break;
      }
      case 'recruit': {
        const pool = c.faction === 'rebellion' ? REBEL_RECRUITS : IMPERIAL_RECRUITS;
        const taken = new Set(s.characters.map(x => x.name));
        const avail = pool.filter(x => !taken.has(x[0]));
        if (!avail.length || roster(s, c.faction).length >= ROSTER_CAP[c.faction]) { log(s, `${who}: found no one worth recruiting on ${p.name}`, 'info', c.faction, p.id); break; }
        const [name, title, d, e, sb, l] = rng.pick(avail);
        s.characters.push({ id: s.nextId++, name, title, faction: c.faction, at: p.id, mission: null, diplomacy: d, espionage: e, sabotage: sb, leadership: l, captured: false, minor: true, assignment: null });
        log(s, `${who} recruited ${title} ${name} on ${p.name}`, mine ? 'good' : 'info', 'all', p.id);
        break;
      }
      case 'rescue': {
        const captive = s.characters.find(x => x.faction === c.faction && x.captured && !x.dead && x.at === p.id);
        if (captive) {
          captive.captured = false; captive.captivity = 0;
          log(s, `${who} rescued ${captive.title} ${captive.name} from ${p.name}!`, mine ? 'good' : 'bad', 'all', p.id);
          evacuate(s, captive);
          for (const x of team) evacuate(s, x);
        }
        break;
      }
      case 'deathstar': {
        // the heroes chase the station wherever it has jumped to
        const ds = s.deathStar;
        if (ds && !ds.destroyed) {
          const where = s.planets[ds.at];
          ds.destroyed = true;
          for (const q of s.planets) if (!q.destroyed) shiftLoyalty(q, 'rebellion', q.owner === 'empire' ? 15 : 30);
          log(s, `${who} destroyed the Death Star above ${where.name}! Worlds across the galaxy turn against the Empire.`, mine ? 'good' : 'bad', 'all', where.id);
          for (const x of team) { x.at = where.id; evacuate(s, x); }
        } else log(s, `${who}: the Death Star was already gone`, 'info', c.faction, p.id);
        break;
      }
      case 'abduct': {
        const targets = charactersAt(s, p.id, enemy);
        const victim = targets.length ? rng.pick(targets) : null;
        if (victim) {
          captureCharacter(s, victim, p.id);
          const home = nearestOwned(s, c.faction, p.id);
          if (home !== null) victim.at = home;
          log(s, `${who} abducted ${victim.title} ${victim.name} from ${p.name}!`, mine ? 'good' : 'bad', 'all', p.id);
          for (const x of team) evacuate(s, x);
        } else log(s, `${who}: no enemy leader was found on ${p.name}`, 'info', c.faction, p.id);
        break;
      }
      case 'incite': {
        shiftLoyalty(p, c.faction, 10 + skill * 2);
        p.unrest += 48;
        if (p.owner === enemy && alignment(p, enemy) < -50 && p.garrison <= 1) uprising(s, p);
        else log(s, `${who}: unrest is spreading on ${p.name}`, mine ? 'good' : 'bad', 'all', p.id);
        break;
      }
    }
  } else {
    const captureChance = hostile ? (m.type === 'diplomacy' ? 0.1 : m.type === 'rescue' || m.type === 'abduct' ? 0.35 : 0.3) : (m.type === 'recruit' ? 0 : m.type === 'abduct' ? 0.15 : 0.03);
    let anyCaptured = false;
    if (m.type === 'deathstar') {
      const dsAt = s.deathStar && !s.deathStar.destroyed ? s.deathStar.at : p.id;
      for (const x of team) x.at = dsAt;
      for (const x of team) {
        if (rng.chance(0.1)) { anyCaptured = true; captureCharacter(s, x, dsAt); log(s, `${x.title} ${x.name} was captured after the failed trench run`, mine ? 'bad' : 'good', 'all', dsAt); }
        else evacuate(s, x);
      }
      if (!anyCaptured) log(s, `${who}: the trench run failed; the Death Star holds above ${s.planets[dsAt].name}`, mine ? 'bad' : 'info', 'all', dsAt);
      return;
    }
    for (const x of team) {
      if (rng.chance(captureChance)) {
        anyCaptured = true;
        captureCharacter(s, x, p.id);
        log(s, `${x.title} ${x.name} was captured on ${p.name}!`, mine ? 'bad' : 'good', 'all', p.id);
      }
    }
    if (!anyCaptured) {
      if (m.type === 'diplomacy') shiftLoyalty(p, c.faction, 3);
      log(s, `${who}: ${MISSION_LABEL[m.type].toLowerCase()} on ${p.name} failed`, mine ? 'bad' : 'info', c.faction, p.id);
    }
  }
}

/** Captives are interrogated by whoever holds the world; they can also slip away. */
function tickCaptivity(s: GameState, c: Character, dt: number): void {
  const p = s.planets[c.at];
  const captor = p.owner;
  if (captor === c.faction) { // the world changed hands: freed
    c.captured = false; c.captivity = 0;
    log(s, `${c.title} ${c.name} was freed when ${p.name} was liberated`, c.faction === s.player ? 'good' : 'bad', 'all', p.id);
    return;
  }
  const before = Math.floor((c.captivity ?? 0) / 24);
  c.captivity = (c.captivity ?? 0) + dt;
  if (Math.floor(c.captivity / 24) === before) return; // one roll per day in custody
  const mine = c.faction === s.player;
  if (rng.chance(0.02 + 0.015 * c.sabotage)) {
    c.captured = false; c.captivity = 0;
    log(s, `${c.title} ${c.name} escaped from custody on ${p.name}!`, mine ? 'good' : 'bad', 'all', p.id);
    evacuate(s, c);
    return;
  }
  if (!captor) return;
  if (rng.chance(0.1)) {
    if (c.faction === 'rebellion' && !s.factions.empire.knowsEnemyHq) {
      s.factions.empire.knowsEnemyHq = true;
      log(s, `Under interrogation, ${c.title} ${c.name} revealed the location of the Rebel base: ${s.planets[s.factions.rebellion.hq].name}!`, s.player === 'empire' ? 'good' : 'bad', 'all', p.id);
    } else {
      for (const q of s.planets) if (q.owner === c.faction) q.intel[captor] = Math.max(q.intel[captor], 72);
      log(s, `${c.title} ${c.name} talked: ${factionName(captor)} intelligence now covers ${factionName(c.faction)} worlds for three days`, captor === s.player ? 'good' : 'bad', 'all', p.id);
    }
  }
}

export function nearestOwned(s: GameState, f: FactionId, from: number): number | null {
  let best: number | null = null, bestLen = Infinity;
  for (const p of ownedPlanets(s, f)) {
    const path = findPath(s.lanes, from, p.id);
    if (path) { const l = pathLength(s.lanes, path); if (l < bestLen) { bestLen = l; best = p.id; } }
  }
  return best;
}

export function captureCharacter(s: GameState, c: Character, planetId: number): void {
  c.captured = true; c.captivity = 0; c.assignment = null; c.mission = null; c.at = planetId;
}

// ---------------------------------------------------------------- the Death Star (catch-up event)
function momentum(s: GameState): { worlds: Record<FactionId, number>; strength: Record<FactionId, number> } {
  const worlds = { empire: ownedPlanets(s, 'empire').length, rebellion: ownedPlanets(s, 'rebellion').length };
  const strength = { empire: 0, rebellion: 0 };
  for (const f of s.fleets) strength[f.faction] += fleetStrength(f);
  return { worlds, strength };
}

/** Once a day: if one side is running away with the war, the Death Star enters play. */
function dailyEvents(s: GameState): void {
  if (s.events?.deathStar || dayOf(s.hours) < 20) return;
  const m = momentum(s);
  // momentum: territorial lead weighted by fleet lead; 1.6x the worlds at fleet parity, or 1.3x with double the fleet, both count
  const score = (f: FactionId, e: FactionId) => (m.worlds[f] / (m.worlds[e] + 1)) * Math.sqrt(m.strength[f] / (m.strength[e] + 1));
  const empireAhead = score('empire', 'rebellion') >= 1.75 && m.worlds.empire >= m.worlds.rebellion * 1.3;
  const rebelsAhead = score('rebellion', 'empire') >= 1.75 && m.worlds.rebellion >= m.worlds.empire * 1.3;
  if (!empireAhead && !rebelsAhead) return;
  s.events = { ...(s.events ?? {}), deathStar: true };
  const rebHq = s.factions.rebellion.hq;
  const alderaan = s.planets.find(p => p.name === 'Alderaan');
  if (rebelsAhead && alderaan && !alderaan.destroyed) {
    // the Rebellion is winning: the Empire makes an example of Alderaan
    s.deathStar = { at: alderaan.id, destroyed: false, hoursSinceMove: 0, kills: [], alderaan: true, vulnerableAt: s.hours + 8 * HOURS_PER_DAY };
    destroyWorld(s, alderaan, 'empire');
    for (const q of s.planets) if (!q.destroyed && q.owner !== 'rebellion') shiftLoyalty(q, 'empire', 35);
    log(s, `The Death Star has destroyed Alderaan. Terror grips the galaxy: worlds fall in line behind the Empire.`, s.player === 'empire' ? 'good' : 'bad', 'all', alderaan.id);
  } else {
    // the Empire is winning: the battle station is completed and sets out for the Rebel base
    const hops = hopDistances(s.lanes, rebHq);
    const start = ownedPlanets(s, 'empire').sort((a, b) => Math.abs((hops.get(a.id) ?? 9) - 4) - Math.abs((hops.get(b.id) ?? 9) - 4) || b.production - a.production)[0];
    if (!start) return;
    s.deathStar = { at: start.id, destroyed: false, hoursSinceMove: 0, kills: [], alderaan: false };
    log(s, `The Death Star is operational above ${start.name} and is moving on the Rebel base. Only its destruction can stop it.`, s.player === 'empire' ? 'good' : 'bad', 'all', start.id);
  }
  log(s, s.deathStar.alderaan ? `Rebel agents are racing the stolen plans to the Alliance; in eight days Luke, Leia and Han can attempt the Trench Run.` : `Luke, Leia and Han can attempt the Trench Run against the Death Star (any of them, together for better odds).`, 'info', 'rebellion', s.deathStar.at);
}

function destroyWorld(s: GameState, p: Planet, by: FactionId): void {
  p.destroyed = true; p.production = 0; p.owner = null; p.garrison = 0; p.defense = 0; p.shipyard = 0; p.queue = []; p.invasion = null; p.loyalty = 0;
  for (const c of s.characters) if (c.at === p.id && !c.dead) { if (c.captured) { c.dead = true; } else if (!c.mission) evacuate(s, c); }
  s.deathStar?.kills.push(p.id);
  void by;
}

/** The Death Star creeps one jump toward the Rebel base every four days, spreading fear; reaching it is the end of that world. */
function stepDeathStar(s: GameState, dt: number): void {
  const ds = s.deathStar;
  if (!ds || ds.destroyed) return;
  // fear: non-Imperial worlds drift toward the Empire while it lives
  for (const p of s.planets) if (!p.destroyed && p.owner !== 'empire') shiftLoyalty(p, 'empire', dt / HOURS_PER_DAY);
  ds.hoursSinceMove += dt;
  if (ds.hoursSinceMove < 6 * HOURS_PER_DAY) return;
  ds.hoursSinceMove = 0;
  const target = s.factions.rebellion.hq;
  if (s.planets[target].owner !== 'rebellion') return; // nothing to hunt
  const path = findPath(s.lanes, ds.at, target);
  if (!path || path.length < 2) return;
  ds.at = path[1];
  const here = s.planets[ds.at];
  if (ds.at === target) {
    destroyWorld(s, here, 'empire');
    for (const q of s.planets) if (!q.destroyed && q.owner !== 'rebellion') shiftLoyalty(q, 'empire', 15);
    log(s, `The Death Star has destroyed ${here.name}, the Rebel base. The Alliance scatters.`, s.player === 'empire' ? 'good' : 'bad', 'all', here.id);
  } else {
    log(s, `The Death Star has jumped to ${here.name}`, 'info', 'all', here.id);
  }
}

export function factionName(f: FactionId): string { return f === 'empire' ? 'Empire' : 'Rebellion'; }

/** The leaders each side must kill or capture, on top of taking the enemy capital. */
export const VICTORY_TARGETS: Record<FactionId, string[]> = { empire: ['Luke Skywalker', 'Leia Organa'], rebellion: ['Palpatine', 'Darth Vader'] };
/** Dead, or captured (anywhere). */
export function leaderNeutralised(s: GameState, name: string): boolean {
  const c = s.characters.find(x => x.name === name);
  return !c || !!c.dead || c.captured;
}
export function capitalHeld(s: GameState, by: FactionId): boolean {
  return s.planets[s.factions[enemyOf(by)].hq].owner === by;
}

export function checkVictory(s: GameState): void {
  if (s.winner) return;
  // a side that loses its capital regroups on its strongest remaining world
  for (const f of FACTIONS) {
    const hq = s.planets[s.factions[f].hq];
    if (hq.owner === f) { s.factions[f].relocated = false; continue; }
    const remaining = ownedPlanets(s, f).sort((a, b) => (b.shipyard * 10 + b.production) - (a.shipyard * 10 + a.production));
    if (remaining.length && remaining[0].id !== hq.id && !s.factions[f].relocated) {
      s.factions[f].hq = remaining[0].id;
      s.factions[f].relocated = true;
      if (f === 'rebellion') s.factions.empire.knowsEnemyHq = false;
      log(s, f === 'rebellion' ? `The Alliance has fled ${hq.name} and re-established its headquarters on ${remaining[0].name}` : `With ${hq.name} lost, the Imperial court regroups on ${remaining[0].name}`, 'battle', 'all', remaining[0].id);
    }
  }
  const empHq = s.planets[s.factions.empire.hq];
  const rebHq = s.planets[s.factions.rebellion.hq];
  for (const f of FACTIONS) {
    const targets = VICTORY_TARGETS[f];
    if (capitalHeld(s, f) && targets.every(n => leaderNeutralised(s, n))) {
      s.winner = f;
      log(s, f === 'rebellion'
        ? `${empHq.name} is in Alliance hands and the Emperor and Vader are no more. The Rebellion is victorious!`
        : `The Rebel base on ${rebHq.name} is taken and Skywalker and Organa are in Imperial hands. The Empire is victorious!`, 'battle');
      return;
    }
  }
  for (const f of FACTIONS) {
    if (!s.planets.some(p => p.owner === f) && !s.fleets.some(fl => fl.faction === f)) { s.winner = enemyOf(f); log(s, `The ${factionName(f)} has been eliminated.`, 'battle'); }
  }
}
