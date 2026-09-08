import type { FactionId } from './types';

export type ShipSize = 'small' | 'medium' | 'large';
export type WeaponKind = 'laser' | 'turbo' | 'ion' | 'torpedo';
export type ShipShape = 'fighter' | 'interceptor' | 'bomber' | 'corvette' | 'frigate' | 'capital' | 'transport' | 'platform';

export interface WeaponDef {
  kind: WeaponKind;
  dmg: number;
  range: number;
  cooldown: number;   // seconds
  speed: number;      // projectile speed
  vsSmall: number;    // damage multiplier vs small ships
  vsLarge: number;    // damage multiplier vs large ships
  count: number;      // number of mounts
}

export interface ShipClass {
  id: string;
  name: string;
  faction: FactionId | 'any';
  size: ShipSize;
  shape: ShipShape;
  hp: number;
  shield: number;
  speed: number;      // tactical max speed (units/s)
  accel: number;
  turn: number;       // radians/s
  weapons: WeaponDef[];
  cost: number;
  buildHours: number;
  minShipyard: number;
  hyperSpeed: number; // galaxy units per hour
  troopCap: number;
  scale: number;      // visual scale
  role: string;
  /** Gravity-well generator: enemies cannot jump to hyperspace while one is alive in the battle. */
  interdictor?: boolean;
}

const laser = (o: Partial<WeaponDef> = {}): WeaponDef => ({ kind: 'laser', dmg: 5, range: 14, cooldown: 0.35, speed: 90, vsSmall: 1, vsLarge: 0.35, count: 1, ...o });
const flak = (o: Partial<WeaponDef> = {}): WeaponDef => ({ kind: 'laser', dmg: 5, range: 20, cooldown: 0.3, speed: 100, vsSmall: 1.3, vsLarge: 0.3, count: 2, ...o });
const turbo = (o: Partial<WeaponDef> = {}): WeaponDef => ({ kind: 'turbo', dmg: 28, range: 30, cooldown: 1.6, speed: 70, vsSmall: 0.2, vsLarge: 1, count: 2, ...o });
const ion = (o: Partial<WeaponDef> = {}): WeaponDef => ({ kind: 'ion', dmg: 40, range: 34, cooldown: 3, speed: 60, vsSmall: 0.15, vsLarge: 1.2, count: 1, ...o });
const torpedo = (o: Partial<WeaponDef> = {}): WeaponDef => ({ kind: 'torpedo', dmg: 70, range: 18, cooldown: 6, speed: 40, vsSmall: 0.1, vsLarge: 1.6, count: 1, ...o });

export const SHIP_CLASSES: Record<string, ShipClass> = {
  // ---- Galactic Empire ----
  tie: { id: 'tie', name: 'TIE Fighter', faction: 'empire', size: 'small', shape: 'fighter', hp: 140, shield: 0, speed: 34, accel: 40, turn: 3.0, weapons: [laser({ dmg: 4, cooldown: 0.25, count: 2 })], cost: 35, buildHours: 4, minShipyard: 1, hyperSpeed: 3.5, troopCap: 0, scale: 0.6, role: 'Cheap swarm fighter' },
  tieint: { id: 'tieint', name: 'TIE Interceptor', faction: 'empire', size: 'small', shape: 'interceptor', hp: 150, shield: 0, speed: 40, accel: 48, turn: 3.6, weapons: [laser({ dmg: 4, cooldown: 0.2, count: 4, range: 13 })], cost: 55, buildHours: 6, minShipyard: 2, hyperSpeed: 3.5, troopCap: 0, scale: 0.6, role: 'Fast anti-fighter' },
  tiebomber: { id: 'tiebomber', name: 'TIE Bomber', faction: 'empire', size: 'small', shape: 'bomber', hp: 260, shield: 0, speed: 22, accel: 22, turn: 1.8, weapons: [torpedo({ dmg: 60 }), laser({ dmg: 3 })], cost: 70, buildHours: 7, minShipyard: 1, hyperSpeed: 3, troopCap: 0, scale: 0.75, role: 'Anti-capital bomber' },
  lancer: { id: 'lancer', name: 'Lancer Frigate', faction: 'empire', size: 'medium', shape: 'corvette', hp: 380, shield: 180, speed: 15, accel: 10, turn: 1.1, weapons: [flak({ count: 3 })], cost: 130, buildHours: 14, minShipyard: 1, hyperSpeed: 3, troopCap: 0, scale: 1.4, role: 'Anti-starfighter escort' },
  victory: { id: 'victory', name: 'Victory Star Destroyer', faction: 'empire', size: 'large', shape: 'frigate', hp: 1150, shield: 570, speed: 9, accel: 5, turn: 0.65, weapons: [turbo(), laser({ count: 2 }), torpedo({ range: 26 })], cost: 340, buildHours: 32, minShipyard: 2, hyperSpeed: 2.4, troopCap: 3, scale: 2.5, role: 'Line warship' },
  isd: { id: 'isd', name: 'Imperial Star Destroyer', faction: 'empire', size: 'large', shape: 'capital', hp: 3200, shield: 1500, speed: 6, accel: 3, turn: 0.4, weapons: [turbo({ count: 4, dmg: 36, range: 40 }), laser({ count: 3 }), ion()], cost: 950, buildHours: 72, minShipyard: 3, hyperSpeed: 1.8, troopCap: 6, scale: 4.4, role: 'Capital ship' },
  interdictor: { id: 'interdictor', name: 'Interdictor Cruiser', faction: 'empire', size: 'large', shape: 'frigate', hp: 950, shield: 520, speed: 8, accel: 4, turn: 0.6, weapons: [flak({ count: 2 }), laser({ count: 2 })], cost: 520, buildHours: 40, minShipyard: 2, hyperSpeed: 2.4, troopCap: 0, scale: 2.6, role: 'Gravity well: enemies cannot jump out while it lives', interdictor: true },
  acclamator: { id: 'acclamator', name: 'Acclamator Assault Ship', faction: 'empire', size: 'medium', shape: 'transport', hp: 450, shield: 160, speed: 9, accel: 5, turn: 0.8, weapons: [laser({ count: 2 })], cost: 120, buildHours: 12, minShipyard: 1, hyperSpeed: 1.8, troopCap: 6, scale: 1.7, role: 'Troop transport' },
  // ---- Rebel Alliance ----
  xwing: { id: 'xwing', name: 'X-wing', faction: 'rebellion', size: 'small', shape: 'fighter', hp: 190, shield: 70, speed: 30, accel: 32, turn: 2.6, weapons: [laser({ dmg: 5, cooldown: 0.3, count: 2 }), torpedo({ dmg: 40, cooldown: 12, range: 16 })], cost: 55, buildHours: 6, minShipyard: 1, hyperSpeed: 3.5, troopCap: 0, scale: 0.65, role: 'Multi-role fighter' },
  awing: { id: 'awing', name: 'A-wing', faction: 'rebellion', size: 'small', shape: 'interceptor', hp: 150, shield: 60, speed: 40, accel: 46, turn: 3.4, weapons: [laser({ dmg: 4, cooldown: 0.22, count: 2, range: 13 })], cost: 60, buildHours: 6, minShipyard: 2, hyperSpeed: 3.5, troopCap: 0, scale: 0.6, role: 'Fast interceptor' },
  ywing: { id: 'ywing', name: 'Y-wing', faction: 'rebellion', size: 'small', shape: 'bomber', hp: 250, shield: 110, speed: 20, accel: 20, turn: 1.8, weapons: [torpedo(), laser({ dmg: 3 }), ion({ dmg: 12, cooldown: 2, range: 14 })], cost: 80, buildHours: 8, minShipyard: 1, hyperSpeed: 3, troopCap: 0, scale: 0.75, role: 'Anti-capital bomber' },
  cr90: { id: 'cr90', name: 'Corellian Corvette', faction: 'rebellion', size: 'medium', shape: 'corvette', hp: 400, shield: 230, speed: 16, accel: 9, turn: 1.1, weapons: [flak({ count: 3, dmg: 5 })], cost: 140, buildHours: 14, minShipyard: 1, hyperSpeed: 3, troopCap: 1, scale: 1.5, role: 'Blockade runner' },
  nebulon: { id: 'nebulon', name: 'Nebulon-B Frigate', faction: 'rebellion', size: 'large', shape: 'frigate', hp: 1080, shield: 650, speed: 9, accel: 5, turn: 0.65, weapons: [turbo(), laser({ count: 2 }), ion({ dmg: 30 })], cost: 340, buildHours: 32, minShipyard: 2, hyperSpeed: 2.4, troopCap: 2, scale: 2.5, role: 'Escort frigate' },
  mc80: { id: 'mc80', name: 'Mon Calamari Cruiser', faction: 'rebellion', size: 'large', shape: 'capital', hp: 2500, shield: 1900, speed: 6, accel: 3, turn: 0.4, weapons: [turbo({ count: 3, dmg: 34, range: 38 }), laser({ count: 3 }), ion({ count: 2 })], cost: 900, buildHours: 70, minShipyard: 3, hyperSpeed: 1.8, troopCap: 5, scale: 4.2, role: 'Capital ship' },
  gr75: { id: 'gr75', name: 'GR-75 Transport', faction: 'rebellion', size: 'medium', shape: 'transport', hp: 350, shield: 120, speed: 9, accel: 5, turn: 0.8, weapons: [], cost: 90, buildHours: 10, minShipyard: 1, hyperSpeed: 1.8, troopCap: 5, scale: 1.6, role: 'Troop transport' },
  // ---- Static ----
  platform: { id: 'platform', name: 'Golan Defense Platform', faction: 'any', size: 'large', shape: 'platform', hp: 1400, shield: 900, speed: 0, accel: 0, turn: 0.5, weapons: [turbo({ count: 2, range: 36 }), flak({ count: 2 })], cost: 250, buildHours: 36, minShipyard: 0, hyperSpeed: 0, troopCap: 0, scale: 2.6, role: 'Orbital defense' },
};

export function shipClass(id: string): ShipClass {
  const c = SHIP_CLASSES[id];
  if (!c) throw new Error(`Unknown ship class ${id}`);
  return c;
}

export function classesFor(f: FactionId): ShipClass[] {
  return Object.values(SHIP_CLASSES).filter(c => c.faction === f);
}

/** Rough combat rating used by the AI and auto-resolve. */
export function classStrength(c: ShipClass): number {
  const dps = c.weapons.reduce((s, w) => s + (w.dmg * w.count) / w.cooldown * (0.5 * w.vsSmall + 0.5 * w.vsLarge), 0);
  return Math.sqrt((c.hp + c.shield) * Math.max(dps, 1)) / 10;
}

export const TROOP_COST = 60;
export const TROOP_HOURS = 10;
export const SHIPYARD_COST = [0, 200, 400, 800];
export const SHIPYARD_HOURS = 48;
export const DEFENSE_COST = 250;
export const DEFENSE_HOURS = 36;
export const MAX_DEFENSE = 2;
export const COURIER_SPEED = 6; // character travel speed, galaxy units/hour
