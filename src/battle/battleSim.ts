import * as THREE from 'three';
import type { BattleResult, BattleSetup, BattleUnitSpec } from '../sim/combat';
import type { ShipClass, WeaponDef, WeaponKind } from '../sim/ships';
import { enemyOf, type FactionId } from '../sim/types';

export type Order =
  | { type: 'idle' }
  | { type: 'move'; to: THREE.Vector3; speedCap?: number }
  | { type: 'attack'; target: BUnit }
  | { type: 'retreat' };

export type Formation = 'none' | 'wall' | 'wedge' | 'sphere';

/** A flight of up to four starfighters that fly and break together. */
export interface Squad { id: number; side: FactionId; cls: ShipClass; members: BUnit[] }

export interface BUnit {
  id: number;
  spec: BattleUnitSpec;
  side: FactionId;
  cls: ShipClass;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fwd: THREE.Vector3;
  hp: number; maxHp: number;
  shield: number; maxShield: number; shieldTimer: number;
  order: Order;
  weapons: { def: WeaponDef; cd: number }[];
  alive: boolean;
  escaped: boolean;
  radius: number;
  strafe: 'approach' | 'break';
  breakPoint: THREE.Vector3;
  breakTimer: number;
  wobble: number;
  squad: Squad | null;
  slot: number;
}

export interface Projectile {
  pos: THREE.Vector3; vel: THREE.Vector3; kind: WeaponKind; side: FactionId;
  dmg: number; ttl: number; target: BUnit; willHit: boolean; homing: boolean; speed: number;
}

export interface Explosion { pos: THREE.Vector3; age: number; life: number; size: number }
export interface HitFlash { pos: THREE.Vector3; age: number; shield: boolean; unit: BUnit }
export interface SfxEvent { type: 'fire' | 'hit' | 'explode' | 'jump'; kind?: WeaponKind; side: FactionId; pos: THREE.Vector3; size?: number; shield?: boolean }

const ARENA = 170;
const DAMAGE_SCALE = 0.5;
const sizeMult = (w: WeaponDef, t: ShipClass) => t.size === 'small' ? w.vsSmall : t.size === 'medium' ? (w.vsSmall + w.vsLarge) / 2 : w.vsLarge;
const UP = new THREE.Vector3(0, 1, 0);
/** Wingman offsets in the leader's frame (right, up, back). */
const WING_SLOTS = [[0, 0, 0], [-3.6, 0.8, -3.2], [3.6, -0.8, -3.2], [0, 1.6, -6.2]];

export class BattleSim {
  units: BUnit[] = [];
  squads: Squad[] = [];
  projectiles: Projectile[] = [];
  explosions: Explosion[] = [];
  flashes: HitFlash[] = [];
  sfx: SfxEvent[] = [];
  time = 0;
  over = false;
  result: BattleResult | null = null;
  retreating: Record<FactionId, boolean> = { empire: false, rebellion: false };
  retreatTimer: Record<FactionId, number> = { empire: 0, rebellion: 0 };
  /** Seconds of slow motion remaining (capital-ship kills). */
  slowMo = 0;
  private pendingBooms: { pos: THREE.Vector3; delay: number; size: number; side: FactionId }[] = [];
  private aiTimer = 0;
  private startStrength: Record<FactionId, number> = { empire: 0, rebellion: 0 };
  planetPos = new THREE.Vector3(0, -110, 540);

  constructor(public setup: BattleSetup, public playerSide: FactionId, public observer = false) {
    const rnd = () => Math.random();
    for (const side of ['empire', 'rebellion'] as FactionId[]) {
      const specs = setup.units.filter(u => u.faction === side);
      const isAttacker = side === setup.attacker;
      const dirZ = isAttacker ? 1 : -1;      // attacker faces +Z, defender faces -Z
      const baseZ = isAttacker ? -48 : 48;
      const larges = specs.filter(u => u.cls.size === 'large' && u.id >= 0);
      const mediums = specs.filter(u => u.cls.size === 'medium');
      const smalls = specs.filter(u => u.cls.size === 'small');
      const platforms = specs.filter(u => u.id < 0);
      const place = (list: BattleUnitSpec[], zOff: number, spacing: number, yJitter: number): BUnit[] => {
        const cols = Math.ceil(Math.sqrt(list.length));
        return list.map((u, i) => {
          const c = i % cols, r = Math.floor(i / cols);
          const x = (c - (cols - 1) / 2) * spacing;
          const z = baseZ - dirZ * (zOff + r * spacing * 0.8);
          const y = (rnd() - 0.5) * yJitter;
          return this.addUnit(u, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, dirZ));
        });
      };
      place(larges, 8, 14, 5);
      place(mediums, 0, 9, 5);
      // starfighters come in squadrons of up to four of the same class
      const byClass = new Map<string, BattleUnitSpec[]>();
      for (const u of smalls) byClass.set(u.cls.id, [...(byClass.get(u.cls.id) ?? []), u]);
      let sq = 0;
      for (const list of byClass.values()) {
        for (let i = 0; i < list.length; i += 4) {
          const chunk = list.slice(i, i + 4);
          const cx = ((sq % 4) - 1.5) * 12, cz = baseZ - dirZ * (-10 - Math.floor(sq / 4) * 8);
          const squad: Squad = { id: sq++, side, cls: chunk[0].cls, members: [] };
          chunk.forEach((u, k) => {
            const off = WING_SLOTS[k];
            const unit = this.addUnit(u, new THREE.Vector3(cx + off[0], off[1] + (rnd() - 0.5) * 2, cz - dirZ * off[2]), new THREE.Vector3(0, 0, dirZ));
            unit.squad = squad; unit.slot = k;
            squad.members.push(unit);
          });
          this.squads.push(squad);
        }
      }
      platforms.forEach((u, i) => this.addUnit(u, new THREE.Vector3((i - (platforms.length - 1) / 2) * 26, 3, 66), new THREE.Vector3(0, 0, -1)));
      this.startStrength[side] = this.sideStrength(side);
    }
  }

  private addUnit(spec: BattleUnitSpec, pos: THREE.Vector3, fwd: THREE.Vector3): BUnit {
    const cls = spec.cls;
    const u: BUnit = {
      id: spec.id, spec, side: spec.faction, cls,
      pos, vel: new THREE.Vector3(), fwd: fwd.clone(),
      hp: cls.hp * spec.hull, maxHp: cls.hp, shield: cls.shield, maxShield: cls.shield, shieldTimer: 0,
      order: { type: 'idle' },
      weapons: cls.weapons.map(def => ({ def, cd: Math.random() * def.cooldown })),
      alive: true, escaped: false,
      radius: 1.4 * cls.scale + 0.6,
      strafe: 'approach', breakPoint: new THREE.Vector3(), breakTimer: 0,
      wobble: Math.random() * Math.PI * 2,
      squad: null, slot: 0,
    };
    this.units.push(u);
    return u;
  }

  alive(side?: FactionId): BUnit[] { return this.units.filter(u => u.alive && !u.escaped && (!side || u.side === side)); }
  sideStrength(side: FactionId): number { return this.alive(side).reduce((s, u) => s + u.hp + u.shield, 0); }
  /** The unit that actually flies for `u`: itself, or its squadron leader. */
  leaderOf(u: BUnit): BUnit { return u.squad ? u.squad.members[0] : u; }
  isWingman(u: BUnit): boolean { return !!u.squad && u.squad.members[0] !== u; }
  /** Expand a set of units to whole squadrons. */
  expandSquads(units: Iterable<BUnit>): BUnit[] {
    const out = new Set<BUnit>();
    for (const u of units) { if (u.squad) for (const m of u.squad.members) { if (m.alive && !m.escaped) out.add(m); } else out.add(u); }
    return [...out];
  }

  // ------------------------------------------------------------ commands
  /** Movement agents for a selection: squadron leaders and independent ships. */
  private agents(units: BUnit[]): BUnit[] {
    const seen = new Set<BUnit>();
    for (const u of units) { if (!u.alive || u.cls.speed === 0) continue; seen.add(this.leaderOf(u)); }
    return [...seen];
  }

  cmdMove(units: BUnit[], to: THREE.Vector3, formation: Formation = 'none'): void {
    const agents = this.agents(units);
    if (!agents.length) return;
    const center = new THREE.Vector3();
    for (const u of agents) center.add(u.pos);
    center.divideScalar(agents.length);
    if (formation === 'none') {
      for (const u of agents) {
        const off = u.pos.clone().sub(center);
        off.clampLength(0, 20);
        u.order = { type: 'move', to: to.clone().add(off) };
      }
    } else {
      // formation frame: facing the direction of travel
      const dir = to.clone().sub(center).setY(0);
      if (dir.lengthSq() < 1) { dir.set(0, 0, 0); for (const u of agents) dir.add(u.fwd); dir.setY(0); }
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      const right = new THREE.Vector3().crossVectors(UP, dir).normalize();
      const sorted = agents.slice().sort((a, b) => rank(b) - rank(a)); // capitals first (centre)
      const slots = formationSlots(formation, sorted);
      const slowest = Math.min(...agents.map(u => u.cls.speed));
      sorted.forEach((u, i) => {
        const s = slots[i];
        const goal = to.clone().addScaledVector(right, s[0]).addScaledVector(UP, s[1]).addScaledVector(dir, s[2]);
        u.order = { type: 'move', to: goal, speedCap: Math.max(slowest * 1.15, u.cls.size === 'small' ? u.cls.speed * 0.45 : 0) };
      });
    }
    // wingmen take the same order type so the HUD reads consistently; only leaders steer
    for (const u of units) if (this.isWingman(u)) u.order = this.leaderOf(u).order;
  }
  cmdAttack(units: BUnit[], target: BUnit): void {
    for (const u of this.expandSquads(units)) if (u.alive) u.order = { type: 'attack', target };
  }
  cmdStop(units: BUnit[]): void { for (const u of this.expandSquads(units)) u.order = { type: 'idle' }; }
  cmdRetreat(side: FactionId): void {
    if (this.retreating[side]) return;
    this.retreating[side] = true;
    this.retreatTimer[side] = Math.max(6, 12 - this.setup.command[side] * 0.9); // seconds until hyperspace jump; a good admiral gets the fleet out faster
    for (const u of this.alive(side)) if (u.cls.speed > 0) u.order = { type: 'retreat' };
  }

  // ------------------------------------------------------------ step
  step(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.slowMo = Math.max(0, this.slowMo - dt);
    this.aiTimer -= dt;
    if (this.aiTimer <= 0) { this.aiTimer = 1.2; this.think(enemyOf(this.playerSide)); if (this.observer) this.think(this.playerSide); this.autoEngage(); }
    for (const sq of this.squads) this.promoteLeader(sq);
    for (const u of this.units) if (u.alive && !u.escaped) this.stepUnit(u, dt);
    this.stepProjectiles(dt);
    for (const b of this.pendingBooms) {
      b.delay -= dt;
      if (b.delay <= 0) { this.explosions.push({ pos: b.pos, age: 0, life: 0.7 + Math.random() * 0.5, size: b.size }); this.sfx.push({ type: 'explode', side: b.side, pos: b.pos, size: b.size }); }
    }
    this.pendingBooms = this.pendingBooms.filter(b => b.delay > 0);
    for (const e of this.explosions) e.age += dt;
    this.explosions = this.explosions.filter(e => e.age < e.life);
    for (const f of this.flashes) f.age += dt;
    this.flashes = this.flashes.filter(f => f.age < 0.25);
    for (const side of ['empire', 'rebellion'] as FactionId[]) {
      if (this.retreating[side]) {
        this.retreatTimer[side] -= dt;
        if (this.retreatTimer[side] <= 0) for (const u of this.alive(side)) if (u.cls.speed > 0) {
          u.escaped = true;
          this.explosions.push({ pos: u.pos.clone(), age: 0, life: 0.5, size: u.cls.scale * 2 });
          this.sfx.push({ type: 'jump', side, pos: u.pos.clone(), size: u.cls.scale });
        }
      }
    }
    this.checkEnd();
  }

  private promoteLeader(sq: Squad): void {
    const live = sq.members.filter(m => m.alive && !m.escaped);
    if (live.length === sq.members.length) return;
    const oldLeader = sq.members[0];
    sq.members = live;
    if (live.length && live[0] !== oldLeader) {
      // the new leader inherits the flight's orders and strafe state
      live[0].order = oldLeader.order;
      live[0].strafe = oldLeader.strafe; live[0].breakPoint.copy(oldLeader.breakPoint); live[0].breakTimer = oldLeader.breakTimer;
    }
    live.forEach((m, i) => { m.slot = i; });
  }

  private enemyCentroid(side: FactionId): THREE.Vector3 {
    const c = new THREE.Vector3();
    const e = this.alive(enemyOf(side));
    for (const u of e) c.add(u.pos);
    return e.length ? c.divideScalar(e.length) : c.set(0, 0, side === this.setup.attacker ? 80 : -80);
  }

  private stepUnit(u: BUnit, dt: number): void {
    const cls = u.cls;
    let goal: THREE.Vector3 | null = null;
    let faceTarget: BUnit | null = null;
    let hold = false;
    let speedCap = cls.speed;
    if (u.order.type === 'attack' && (!u.order.target.alive || u.order.target.escaped)) u.order = { type: 'idle' };

    if (this.isWingman(u)) {
      // ---- wingman: hold formation on the leader ----
      const L = this.leaderOf(u);
      const right = new THREE.Vector3().crossVectors(L.fwd, UP).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      const up = new THREE.Vector3().crossVectors(right, L.fwd).normalize();
      const s = WING_SLOTS[Math.min(u.slot, WING_SLOTS.length - 1)];
      goal = L.pos.clone().addScaledVector(right, s[0]).addScaledVector(up, s[1]).addScaledVector(L.fwd, s[2]).addScaledVector(L.vel, 0.25);
      const d = u.pos.distanceTo(goal);
      const leaderSpeed = L.vel.length();
      speedCap = Math.min(cls.speed, Math.max(cls.speed * 0.4, leaderSpeed + (d - 2) * 4));
      if (L.order.type === 'attack') faceTarget = L.order.target;
      if (L.order.type === 'retreat' && Math.hypot(u.pos.x, u.pos.z) > ARENA + 40) u.escaped = true;
    } else {
      switch (u.order.type) {
        case 'move':
          goal = u.order.to;
          if (u.order.speedCap) speedCap = Math.min(cls.speed, u.order.speedCap);
          if (u.pos.distanceTo(goal) < 2.5) { u.order = { type: 'idle' }; goal = null; }
          break;
        case 'retreat': {
          const away = u.pos.clone().sub(this.enemyCentroid(u.side)).setY(0);
          if (away.lengthSq() < 1) away.set(0, 0, u.side === this.setup.attacker ? -1 : 1);
          goal = u.pos.clone().addScaledVector(away.normalize(), 200);
          break;
        }
        case 'attack': {
          const t = u.order.target;
          faceTarget = t;
          const range = Math.max(...cls.weapons.map(w => w.range), 10);
          const d = u.pos.distanceTo(t.pos);
          if (cls.size === 'small') {
            // strafing runs: dive in, break off past the target, come around again
            if (u.strafe === 'approach') {
              goal = t.pos.clone().addScaledVector(t.vel, Math.min(1.5, d / Math.max(cls.speed, 1)));
              if (d < range * 0.45 + t.radius) {
                u.strafe = 'break'; u.breakTimer = 1.4 + Math.random() * 0.8;
                const lateral = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.8, Math.random() - 0.5).normalize();
                u.breakPoint.copy(u.pos).addScaledVector(u.fwd, range * 1.6).addScaledVector(lateral, range * 1.2);
              }
            } else {
              goal = u.breakPoint; u.breakTimer -= dt;
              if (u.breakTimer <= 0 || u.pos.distanceTo(u.breakPoint) < 4) u.strafe = 'approach';
            }
          } else {
            const standoff = range * 0.7;
            if (d > standoff) {
              const dir = t.pos.clone().sub(u.pos).normalize();
              goal = t.pos.clone().addScaledVector(dir, -standoff * 0.9);
            } else hold = true;
          }
          break;
        }
        case 'idle': hold = true; break;
      }
    }

    // ---- steering ----
    if (cls.speed > 0) {
      if (cls.size === 'small') {
        const want = goal ? goal.clone().sub(u.pos).normalize() : u.fwd.clone();
        if (!goal) { u.wobble += dt; want.x += Math.sin(u.wobble) * 0.3; want.normalize(); }
        turnToward(u.fwd, want, cls.turn * dt);
        const speed = goal ? speedCap : cls.speed * 0.45;
        u.vel.copy(u.fwd).multiplyScalar(speed);
      } else {
        const desired = new THREE.Vector3();
        if (goal && !hold) {
          const to = goal.clone().sub(u.pos);
          const d = to.length();
          const slow = Math.min(1, d / 12);
          desired.copy(to).normalize().multiplyScalar(speedCap * slow);
        }
        const dv = desired.sub(u.vel);
        dv.clampLength(0, cls.accel * dt);
        u.vel.add(dv);
        const want = faceTarget ? faceTarget.pos.clone().sub(u.pos).normalize() : (u.vel.length() > 0.5 ? u.vel.clone().normalize() : null);
        if (want) turnToward(u.fwd, want, cls.turn * dt);
      }
      u.pos.addScaledVector(u.vel, dt);
      if (u.order.type !== 'retreat') {
        const r = Math.hypot(u.pos.x, u.pos.z);
        if (r > ARENA) { u.pos.x *= ARENA / r; u.pos.z *= ARENA / r; }
        u.pos.y = Math.max(-60, Math.min(60, u.pos.y));
      } else if (Math.hypot(u.pos.x, u.pos.z) > ARENA + 40) {
        u.escaped = true;
      }
    } else if (faceTarget) {
      turnToward(u.fwd, faceTarget.pos.clone().sub(u.pos).normalize(), cls.turn * dt);
    }

    // ---- shields ----
    u.shieldTimer -= dt;
    if (u.shieldTimer <= 0 && u.shield < u.maxShield) u.shield = Math.min(u.maxShield, u.shield + u.maxShield * 0.03 * dt);

    // ---- weapons ----
    const primary = faceTarget ?? (u.order.type === 'attack' ? u.order.target : null);
    for (const w of u.weapons) {
      w.cd -= dt;
      if (w.cd > 0) continue;
      let t: BUnit | null = null;
      if (primary && primary.alive && !primary.escaped && u.pos.distanceTo(primary.pos) <= w.def.range && sizeMult(w.def, primary.cls) >= 0.2) t = primary;
      if (!t) t = this.bestTargetFor(u, w.def);
      if (!t) continue;
      w.cd = w.def.cooldown * (0.85 + Math.random() * 0.3);
      for (let i = 0; i < w.def.count; i++) this.fire(u, w.def, t);
    }
  }

  private bestTargetFor(u: BUnit, w: WeaponDef): BUnit | null {
    let best: BUnit | null = null, bestScore = 0;
    for (const t of this.units) {
      if (!t.alive || t.escaped || t.side === u.side) continue;
      const d = u.pos.distanceTo(t.pos);
      if (d > w.range) continue;
      const score = sizeMult(w, t.cls) / (1 + d / w.range);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return bestScore >= 0.12 ? best : null;
  }

  private fire(u: BUnit, w: WeaponDef, t: BUnit): void {
    const mult = sizeMult(w, t.cls);
    const rel = t.vel.clone().sub(u.vel).length();
    let hitChance = (t.cls.size === 'small' ? 0.35 : t.cls.size === 'medium' ? 0.7 : 0.9) * (1 + 0.025 * this.setup.command[u.side]);
    hitChance *= Math.max(0.35, 1 - rel / 90);
    if (t.cls.size === 'small' && t.strafe === 'break') hitChance *= 0.5; // hard to hit on the break-away
    if (w.kind === 'torpedo') hitChance = t.cls.size === 'small' ? 0.25 : 0.9;
    const willHit = Math.random() < hitChance;
    const origin = u.pos.clone().add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(u.radius * 0.8));
    const d = origin.distanceTo(t.pos);
    const aim = t.pos.clone().addScaledVector(t.vel, d / w.speed);
    if (!willHit) aim.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(t.radius * 4 + 3));
    const vel = aim.sub(origin).normalize().multiplyScalar(w.speed);
    this.projectiles.push({ pos: origin, vel, kind: w.kind, side: u.side, dmg: w.dmg * mult * DAMAGE_SCALE, ttl: (w.range * 1.6) / w.speed + 0.3, target: t, willHit, homing: w.kind === 'torpedo', speed: w.speed });
    this.sfx.push({ type: 'fire', kind: w.kind, side: u.side, pos: origin });
  }

  private stepProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      p.ttl -= dt;
      if (p.homing && p.target.alive && !p.target.escaped) {
        const want = p.target.pos.clone().sub(p.pos).normalize();
        turnToward(p.vel, want, 2.5 * dt, p.speed);
      }
      p.pos.addScaledVector(p.vel, dt);
      const t = p.target;
      if (p.willHit && t.alive && !t.escaped && p.pos.distanceTo(t.pos) < t.radius + p.speed * dt) {
        this.damage(t, p.dmg, p.kind, p.pos);
        p.ttl = -1;
      }
    }
    this.projectiles = this.projectiles.filter(p => p.ttl > 0);
  }

  private damage(t: BUnit, dmg: number, kind: WeaponKind, at: THREE.Vector3): void {
    t.shieldTimer = 4;
    let hullDmg = dmg;
    let shielded = false;
    if (t.shield > 0) {
      const sd = Math.min(t.shield, kind === 'ion' ? dmg * 2 : dmg);
      t.shield -= sd;
      hullDmg = Math.max(0, dmg - (kind === 'ion' ? sd / 2 : sd));
      if (kind === 'ion') hullDmg *= 0.3;
      shielded = true;
    }
    this.flashes.push({ pos: at.clone(), age: 0, shield: shielded, unit: t });
    this.sfx.push({ type: 'hit', side: t.side, pos: at.clone(), shield: shielded, size: t.cls.scale });
    t.hp -= hullDmg;
    if (t.hp <= 0) {
      t.alive = false;
      const big = t.cls.size === 'large';
      this.explosions.push({ pos: t.pos.clone(), age: 0, life: 0.8 + t.cls.scale * 0.25, size: t.cls.scale * 2.2 + 1 });
      this.sfx.push({ type: 'explode', side: t.side, pos: t.pos.clone(), size: t.cls.scale });
      if (big) {
        // capital ships die in stages
        for (let i = 0; i < 5; i++) {
          const off = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).multiplyScalar(t.cls.scale * 2.2);
          this.pendingBooms.push({ pos: t.pos.clone().add(off), delay: 0.15 + i * 0.18, size: t.cls.scale * (0.8 + Math.random()), side: t.side });
        }
        if (t.cls.shape === 'capital') this.slowMo = 1.6;
      }
    }
  }

  /** Idle units engage anything in reach so the player doesn't have to micro every ship. */
  private autoEngage(): void {
    for (const u of this.alive()) {
      if (u.order.type !== 'idle' || this.isWingman(u)) continue;
      const reach = Math.max(...u.cls.weapons.map(w => w.range), 0) * (u.cls.size === 'small' ? 3 : 1.6);
      if (reach === 0) continue;
      let best: BUnit | null = null, bestD = reach;
      for (const t of this.alive(enemyOf(u.side))) {
        const d = u.pos.distanceTo(t.pos);
        const pref = this.preference(u, t);
        if (d / pref < bestD) { bestD = d / pref; best = t; }
      }
      if (best) this.cmdAttack([u], best);
    }
  }

  private preference(u: BUnit, t: BUnit): number {
    const s = u.cls.shape, ts = t.cls.size;
    if (s === 'fighter' || s === 'interceptor') return ts === 'small' ? 1.6 : ts === 'medium' ? 1 : 0.7;
    if (s === 'bomber') return ts === 'large' ? 1.8 : ts === 'medium' ? 1 : 0.4;
    if (s === 'corvette') return ts === 'small' ? 1.7 : 0.9;
    if (s === 'transport') return 0.01;
    return ts === 'large' ? 1.6 : ts === 'medium' ? 1.1 : 0.5;
  }

  /** AI commander for one side. */
  think(side: FactionId): void {
    if (this.retreating[side]) return;
    const mine = this.alive(side);
    const theirs = this.alive(enemyOf(side));
    if (!mine.length || !theirs.length) return;
    const myStr = this.sideStrength(side), theirStr = this.sideStrength(enemyOf(side));
    const mobile = mine.some(u => u.cls.speed > 0);
    if (mobile && myStr < this.startStrength[side] * 0.25 && theirStr > myStr * 2 && this.time > 45) { this.cmdRetreat(side); return; }
    for (const u of mine) {
      if (this.isWingman(u)) continue;
      if (u.cls.shape === 'transport') {
        const c = this.enemyCentroid(side);
        const away = u.pos.clone().sub(c).setY(0).normalize();
        if (u.order.type !== 'move') u.order = { type: 'move', to: u.pos.clone().addScaledVector(away, 40) };
        continue;
      }
      if (u.order.type === 'attack' && Math.random() < 0.8) continue;
      let best: BUnit | null = null, bestScore = 0;
      for (const t of theirs) {
        const d = u.pos.distanceTo(t.pos);
        const score = this.preference(u, t) / (1 + d / 60) * (t.hp / t.maxHp < 0.3 ? 1.4 : 1);
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (best) this.cmdAttack([u], best);
    }
  }

  private checkEnd(): void {
    const e = this.alive('empire').length, r = this.alive('rebellion').length;
    if (e > 0 && r > 0) {
      // stalemate guard: after ten minutes the weaker side withdraws
      if (this.time > 600 && !this.retreating.empire && !this.retreating.rebellion) {
        this.cmdRetreat(this.sideStrength('empire') < this.sideStrength('rebellion') ? 'empire' : 'rebellion');
      }
      return;
    }
    const survivors = new Map<number, number>();
    for (const u of this.units) if (u.alive) survivors.set(u.id, Math.max(0.05, u.hp / u.maxHp));
    let winner: FactionId | null = null;
    const retreated: FactionId | null = this.retreating.empire ? 'empire' : this.retreating.rebellion ? 'rebellion' : null;
    if (retreated) winner = enemyOf(retreated);
    else if (e > 0 && r === 0) winner = 'empire';
    else if (r > 0 && e === 0) winner = 'rebellion';
    this.result = { winner, retreated, survivors };
    this.over = true;
  }
}

function rank(u: BUnit): number { return u.cls.size === 'large' ? 3 : u.cls.size === 'medium' ? 2 : 1; }

/** Slot offsets [right, up, forward] for a formation, in the order the agents are given (capitals first). */
export function formationSlots(f: Formation, agents: BUnit[]): [number, number, number][] {
  const n = agents.length;
  const out: [number, number, number][] = [];
  if (f === 'wall') {
    // a flat lattice facing the direction of travel, capitals at the centre
    const lattice = spiralLattice(n);
    for (let i = 0; i < n; i++) {
      const s = agents[i].cls.size === 'large' ? 15 : 10;
      out.push([lattice[i][0] * s, lattice[i][1] * s * 0.6, 0]);
    }
  } else if (f === 'wedge') {
    for (let i = 0; i < n; i++) {
      if (i === 0) { out.push([0, 0, 0]); continue; }
      const side = i % 2 ? 1 : -1, depth = Math.ceil(i / 2);
      out.push([side * depth * 11, (i % 3 - 1) * 2, -depth * 9]);
    }
  } else {
    // sphere: capitals in the middle, everything else on shells around them
    const larges = agents.filter(u => u.cls.size === 'large').length;
    const lattice = spiralLattice(larges);
    let k = 0;
    const others = n - larges;
    for (let i = 0; i < n; i++) {
      if (agents[i].cls.size === 'large') { out.push([lattice[k][0] * 14, 0, lattice[k][1] * 14]); k++; continue; }
      const j = i - larges;
      const radius = 22 + Math.floor(j / 12) * 10;
      const t = (j + 0.5) / Math.max(1, others);
      const y = 1 - 2 * t, r = Math.sqrt(Math.max(0, 1 - y * y)), a = j * 2.399963;
      out.push([Math.cos(a) * r * radius, y * radius * 0.6, Math.sin(a) * r * radius]);
    }
  }
  return out;
}

function spiralLattice(n: number): [number, number][] {
  const pts: [number, number][] = [[0, 0]];
  let x = 0, y = 0, dx = 1, dy = 0, len = 1;
  while (pts.length < n) {
    for (let side = 0; side < 2 && pts.length < n; side++) {
      for (let i = 0; i < len && pts.length < n; i++) { x += dx; y += dy; pts.push([x, y]); }
      [dx, dy] = [-dy, dx];
    }
    len++;
  }
  return pts;
}

/** Rotate `v` toward `want` by at most `maxAngle` radians, preserving length (or `len`). */
export function turnToward(v: THREE.Vector3, want: THREE.Vector3, maxAngle: number, len?: number): void {
  const L = len ?? v.length();
  if (L < 1e-6) { v.copy(want).multiplyScalar(len ?? 1); return; }
  const a = v.clone().normalize(), b = want.clone().normalize();
  const angle = a.angleTo(b);
  if (angle < 1e-4) { v.copy(b).multiplyScalar(L); return; }
  const t = Math.min(1, maxAngle / angle);
  const axis = new THREE.Vector3().crossVectors(a, b);
  if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
  axis.normalize();
  a.applyAxisAngle(axis, angle * t);
  v.copy(a).multiplyScalar(L);
}
