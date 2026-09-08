export type FactionId = 'empire' | 'rebellion';
export const FACTIONS: FactionId[] = ['empire', 'rebellion'];
export function enemyOf(f: FactionId): FactionId { return f === 'empire' ? 'rebellion' : 'empire'; }

export interface Vec3 { x: number; y: number; z: number }

export type PlanetType = 'terran' | 'ocean' | 'desert' | 'ice' | 'volcanic' | 'gas' | 'barren' | 'jungle' | 'city';

export type BuildKind = 'ship' | 'troop' | 'shipyard' | 'defense';
export interface BuildItem {
  kind: BuildKind;
  cls?: string;       // ship class id when kind === 'ship'
  progress: number;   // hours completed
  total: number;      // hours required
  label: string;
}

export interface Invasion {
  attacker: FactionId;
  troops: number;
  hoursLeft: number;
  total: number;
}

export interface Planet {
  id: number;
  name: string;
  pos: Vec3;
  type: PlanetType;
  radius: number;
  owner: FactionId | null;
  /** -100 = fully loyal to the Empire, +100 = fully loyal to the Rebellion. */
  loyalty: number;
  production: number;  // base credits per day
  shipyard: number;    // 0..3
  defense: number;     // orbital defense platforms 0..2
  garrison: number;    // troop regiments
  queue: BuildItem[];
  invasion: Invasion | null;
  unrest: number;      // hours of accumulated unrest toward uprising
  /** Hours of intel remaining per faction (reveals details to that faction). */
  intel: Record<FactionId, number>;
}

export interface Lane { a: number; b: number; length: number }

export interface Ship { id: number; cls: string; hull: number /* 0..1 */ }

export interface Travel {
  from: number;
  to: number;
  progress: number;   // 0..1 along current lane
  path: number[];     // remaining planet ids after `to`
}

export interface Fleet {
  id: number;
  faction: FactionId;
  name: string;
  ships: Ship[];
  troops: number;
  at: number | null;       // planet id when in orbit
  travel: Travel | null;
}

export type MissionType = 'diplomacy' | 'espionage' | 'sabotage' | 'incite' | 'recruit' | 'rescue' | 'abduct';
export interface Mission {
  type: MissionType;
  target: number;
  phase: 'travel' | 'work';
  hoursLeft: number;
  total: number;
}

export interface Character {
  id: number;
  name: string;
  title: string;
  faction: FactionId;
  at: number;
  mission: Mission | null;
  diplomacy: number;
  espionage: number;
  sabotage: number;
  leadership: number;
  captured: boolean;
  /** Hours spent in captivity (drives interrogation and escape rolls). */
  captivity?: number;
  /** Headline characters cannot die; recruited ones can. */
  minor?: boolean;
  dead?: boolean;
  /** Standing duty instead of missions: commanding a fleet, or governing the world they are on. */
  assignment?: { kind: 'fleet'; fleetId: number } | { kind: 'governor' } | null;
}

export interface Faction {
  id: FactionId;
  name: string;
  credits: number;
  hq: number;            // capital (Empire) or hidden HQ (Rebellion)
  knowsEnemyHq: boolean;
  isAI: boolean;
}

export interface LogEntry { time: number; text: string; faction: FactionId | 'all'; planet?: number; kind: 'info' | 'good' | 'bad' | 'battle' }

export interface PendingBattle { planet: number; attacker: FactionId }

export interface GameState {
  seed: number;
  hours: number;
  speed: number;
  player: FactionId;
  planets: Planet[];
  lanes: Lane[];
  fleets: Fleet[];
  characters: Character[];
  factions: Record<FactionId, Faction>;
  log: LogEntry[];
  nextId: number;
  pendingBattle: PendingBattle | null;
  winner: FactionId | null;
  aiTimer: number;
  dayIncome: Record<FactionId, number>;
  /** Observer mode: both sides are AI, the map is fully visible, the viewer gives no orders. */
  observer?: boolean;
  /** Observer mode: resolve battles automatically instead of prompting. */
  autoBattles?: boolean;
}

export const HOURS_PER_DAY = 24;
export function dayOf(hours: number): number { return Math.floor(hours / HOURS_PER_DAY) + 1; }
export function hourOfDay(hours: number): number { return Math.floor(hours % HOURS_PER_DAY); }
export function fmtTime(hours: number): string {
  return `Day ${dayOf(hours)}  ${String(hourOfDay(hours)).padStart(2, '0')}:00`;
}
