import { Rng } from '../core/rng';
import { classesFor, classStrength, COURIER_SPEED, DEFENSE_COST, DEFENSE_HOURS, MAX_DEFENSE, SHIPYARD_COST, SHIPYARD_HOURS, shipClass, TROOP_COST, TROOP_HOURS } from './ships';
import { enemyOf, FACTIONS, HOURS_PER_DAY, type BuildItem, type Character, type FactionId, type Fleet, type GameState, type LogEntry, type MissionType, type Planet } from './types';
import { findPath, laneBetween, pathLength } from './pathfinding';
import { runAI } from './ai';

export const rng = new Rng(12345);

export function log(s: GameState, text: string, kind: LogEntry['kind'] = 'info', faction: FactionId | 'all' = 'all', planet?: number): void {
  s.log.push({ time: s.hours, text, kind, faction, planet });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
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

export const MISSION_HOURS: Record<MissionType, number> = { diplomacy: 36, espionage: 24, sabotage: 30, incite: 36, recruit: 48, rescue: 24 };
export const MISSION_LABEL: Record<MissionType, string> = { diplomacy: 'Diplomacy', espionage: 'Espionage', sabotage: 'Sabotage', incite: 'Incite Uprising', recruit: 'Recruit', rescue: 'Rescue' };
export const MISSION_DESC: Record<MissionType, string> = {
  diplomacy: 'Raise the planet\'s loyalty to your cause. Neutral planets join you at high loyalty.',
  espionage: 'Reveal enemy fleets, garrisons and production. The Empire may locate the hidden Rebel base.',
  sabotage: 'Destroy construction progress, defense platforms or shipyards; damage ships in orbit.',
  incite: 'Stir unrest on an enemy world. Low-garrison planets with hostile populations revolt.',
  recruit: 'Find a new leader on one of your worlds or a sympathetic neutral. The Rebellion finds them more easily.',
  rescue: 'Break a captured leader out of an enemy world. Risky; sabotage and espionage help.',
};

/** Why a mission cannot target a planet, or null if it can. */
export function missionProblem(s: GameState, ch: Character, type: MissionType, target: number): string | null {
  const p = s.planets[target];
  switch (type) {
    case 'recruit':
      if (roster(s, ch.faction).length >= ROSTER_CAP[ch.faction]) return 'Roster is full';
      if (p.owner !== ch.faction && !(p.owner === null && alignment(p, ch.faction) > 0)) return 'Needs one of your worlds or a sympathetic neutral';
      return null;
    case 'rescue':
      if (!s.characters.some(c => c.faction === ch.faction && c.captured && !c.dead && c.at === target)) return 'No captured leader is held there';
      return null;
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
      if (p.loyalty >= 75) joinFaction(s, p, 'rebellion');
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
  const skill = m.type === 'diplomacy' || m.type === 'incite' || m.type === 'recruit' ? c.diplomacy : m.type === 'espionage' ? c.espionage : m.type === 'rescue' ? Math.max(c.sabotage, c.espionage) : c.sabotage;
  let chance = 0.3 + skill * 0.11;
  if (hostile) chance -= p.garrison * 0.04;
  chance -= charactersAt(s, p.id, enemy).length * 0.1;
  const gov = governorOf(s, p.id);
  if (gov && gov.faction === enemy) chance -= 0.06 * gov.espionage;
  if (m.type === 'recruit') chance = 0.2 + skill * 0.08 + (c.faction === 'rebellion' ? 0.15 : 0) + Math.max(0, alignment(p, c.faction)) / 250;
  if (m.type === 'rescue') chance = 0.15 + skill * 0.09 - (hostile ? p.garrison * 0.05 : 0) - (gov && gov.faction === enemy ? 0.05 * gov.espionage : 0);
  chance = Math.max(0.1, Math.min(0.95, chance));
  const success = rng.chance(chance);
  const who = `${c.title} ${c.name}`;
  const mine = c.faction === s.player;
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
          evacuate(s, c);
        }
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
    const captureChance = hostile ? (m.type === 'diplomacy' ? 0.1 : m.type === 'rescue' ? 0.4 : 0.3) : (m.type === 'recruit' ? 0 : 0.03);
    if (rng.chance(captureChance)) {
      c.captured = true; c.captivity = 0; c.assignment = null;
      log(s, `${who} was captured on ${p.name}!`, mine ? 'bad' : 'good', 'all', p.id);
    } else {
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

export function captureCharacter(s: GameState, c: Character, planetId: number): void {
  c.captured = true; c.captivity = 0; c.assignment = null; c.mission = null; c.at = planetId;
}

export function factionName(f: FactionId): string { return f === 'empire' ? 'Empire' : 'Rebellion'; }

export function checkVictory(s: GameState): void {
  if (s.winner) return;
  const empHq = s.planets[s.factions.empire.hq];
  const rebHq = s.planets[s.factions.rebellion.hq];
  if (empHq.owner === 'rebellion') { s.winner = 'rebellion'; log(s, `${empHq.name} has fallen. The Rebellion is victorious!`, 'battle'); return; }
  if (rebHq.owner === 'empire') { s.winner = 'empire'; log(s, `The Rebel headquarters on ${rebHq.name} has been captured. The Empire is victorious!`, 'battle'); return; }
  for (const f of FACTIONS) {
    if (!s.planets.some(p => p.owner === f) && !s.fleets.some(fl => fl.faction === f)) { s.winner = enemyOf(f); log(s, `The ${factionName(f)} has been eliminated.`, 'battle'); }
  }
}
