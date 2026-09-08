import * as THREE from 'three';
import { OrbitCamera } from '../core/orbitCamera';
import { Overlay } from '../core/overlay';
import { TouchGestures } from '../core/touchGestures';
import type { FactionId } from '../sim/types';
import { BattleSim, type BUnit, type Formation } from './battleSim';
import { BattleAudio } from './audio';
import { buildShipMesh, FACTION_COLOR, FACTION_CSS, makeStarfield, planetColor } from './shipMeshes';

const BOLT_COLOR: Record<string, Record<FactionId, THREE.Color>> = {
  laser: { empire: new THREE.Color(0x7dff6a), rebellion: new THREE.Color(0xff5a4a) },
  turbo: { empire: new THREE.Color(0xa8ff7a), rebellion: new THREE.Color(0xff7a5a) },
  ion: { empire: new THREE.Color(0x8fd8ff), rebellion: new THREE.Color(0x8fd8ff) },
  torpedo: { empire: new THREE.Color(0xffc060), rebellion: new THREE.Color(0xffc060) },
};
const TRAIL_LEN = 14;
export const FORMATION_LABEL: Record<Formation, string> = { none: 'Free', wall: 'Wall', wedge: 'Wedge', sphere: 'Sphere' };

interface Trail { line: THREE.Line; pos: Float32Array; col: Float32Array; count: number; last: THREE.Vector3 }

export class BattleView {
  scene = new THREE.Scene();
  cam: OrbitCamera;
  selected = new Set<BUnit>();
  hover: BUnit | null = null;
  formation: Formation = 'none';
  groups = new Map<number, Set<BUnit>>();
  audio = new BattleAudio();
  private meshes = new Map<number, THREE.Group>();
  private trails = new Map<number, Trail>();
  private bolts: THREE.LineSegments;
  private boltPos: Float32Array;
  private boltCol: Float32Array;
  private torps: THREE.Mesh[] = [];
  private booms: THREE.Mesh[] = [];
  private ripples: { mesh: THREE.Mesh; age: number; unit: BUnit | null }[] = [];
  private planet: THREE.Mesh;
  private drag: { button: number; sx: number; sy: number; x: number; y: number; moved: boolean; base?: THREE.Vector3; height: number; attackTarget?: BUnit | null } | null = null;
  private keys = new Set<string>();
  private lastClick = 0;
  private lastGroupKey = { n: -1, t: 0 };
  private gestures: TouchGestures;
  onSpeedKey: ((k: string) => void) | null = null;
  onSelectionChange: (() => void) | null = null;

  constructor(private renderer: THREE.WebGLRenderer, private overlay: Overlay, public sim: BattleSim, planetType: string) {
    this.cam = new OrbitCamera(overlay.width / overlay.height, { distance: 120, minDistance: 8, maxDistance: 500, yaw: 0.5, pitch: 0.55, fov: 55, near: 0.5, far: 4000 });
    this.gestures = new TouchGestures(overlay.canvas, this.cam, {
      tap: (x, y) => this.tap(x, y),
      longPress: (x, y) => this.longPress(x, y),
      move: (x, y) => { this.hover = this.pickUnit(x, y); },
    });
    this.scene.add(makeStarfield(2500, 1800));
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
    sun.position.set(-200, 300, -100);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6080ff, 0.6);
    fill.position.set(200, -100, 200);
    this.scene.add(fill);

    this.planet = new THREE.Mesh(new THREE.SphereGeometry(200, 48, 32), new THREE.MeshStandardMaterial({ color: planetColor(planetType), roughness: 0.9, metalness: 0 }));
    this.planet.position.copy(sim.planetPos);
    this.scene.add(this.planet);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(205, 48, 32), new THREE.MeshBasicMaterial({ color: 0x88bbff, transparent: true, opacity: 0.12, side: THREE.BackSide }));
    atmo.position.copy(sim.planetPos);
    this.scene.add(atmo);

    const grid = new THREE.GridHelper(300, 15, 0x1a2c3e, 0x111c28);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    for (const u of sim.units) {
      const m = buildShipMesh(u.cls, u.side);
      m.position.copy(u.pos);
      this.scene.add(m);
      this.meshes.set(u.id, m);
      if (u.cls.size === 'small') this.trails.set(u.id, this.makeTrail(u));
    }

    const MAX = 1500;
    this.boltPos = new Float32Array(MAX * 6);
    this.boltCol = new Float32Array(MAX * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.boltCol, 3));
    this.bolts = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.bolts.frustumCulled = false;
    this.scene.add(this.bolts);
    const torpGeo = new THREE.SphereGeometry(0.5, 8, 6);
    const torpMat = new THREE.MeshBasicMaterial({ color: 0xffc060 });
    for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(torpGeo, torpMat); m.visible = false; this.scene.add(m); this.torps.push(m); }
    const boomGeo = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; this.scene.add(m); this.booms.push(m);
    }
    const rippleGeo = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; this.scene.add(m); this.ripples.push({ mesh: m, age: 1, unit: null });
    }

    // start looking at the player's fleet, facing the enemy
    const mine = sim.alive(sim.playerSide);
    const c = new THREE.Vector3();
    for (const u of mine) c.add(u.pos);
    if (mine.length) c.divideScalar(mine.length);
    const theirs = sim.alive(sim.playerSide === 'empire' ? 'rebellion' : 'empire');
    const tc = new THREE.Vector3();
    for (const u of theirs) tc.add(u.pos);
    if (theirs.length) tc.divideScalar(theirs.length);
    const dir = tc.clone().sub(c).setY(0);
    this.cam.yaw = Math.atan2(-dir.x, -dir.z);
    this.cam.focusOn(c.clone().lerp(tc, 0.35), 115);
    this.cam.snap();
  }

  private makeTrail(u: BUnit): Trail {
    const pos = new Float32Array(TRAIL_LEN * 3);
    const col = new Float32Array(TRAIL_LEN * 3);
    const base = new THREE.Color(u.side === 'empire' ? 0x5fb8ff : 0xffa060);
    for (let i = 0; i < TRAIL_LEN; i++) {
      pos[i * 3] = u.pos.x; pos[i * 3 + 1] = u.pos.y; pos[i * 3 + 2] = u.pos.z;
      const f = 1 - i / TRAIL_LEN;
      col[i * 3] = base.r * f; col[i * 3 + 1] = base.g * f; col[i * 3 + 2] = base.b * f;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    this.scene.add(line);
    return { line, pos, col, count: 0, last: u.pos.clone() };
  }

  // ------------------------------------------------------------ selection helpers
  private setSelection(units: Iterable<BUnit>, add = false): void {
    if (!add) this.selected.clear();
    for (const u of this.sim.expandSquads(units)) this.selected.add(u);
    this.onSelectionChange?.();
  }
  selectUnits(units: BUnit[]): void { this.setSelection(units.filter(u => u.alive)); }
  setFormation(f: Formation): void { this.formation = f; this.onSelectionChange?.(); }
  toggleMute(): void { this.audio.setMuted(!this.audio.muted); }
  assignGroup(n: number): void { if (this.selected.size) this.groups.set(n, new Set(this.selected)); }
  recallGroup(n: number): void {
    const g = this.groups.get(n);
    if (!g) return;
    for (const u of g) if (!u.alive || u.escaped) g.delete(u);
    this.setSelection(g);
    const now = performance.now();
    if (this.lastGroupKey.n === n && now - this.lastGroupKey.t < 400) this.focusSelection();
    this.lastGroupKey = { n, t: now };
  }

  // ------------------------------------------------------------ input
  private pt(e: MouseEvent): { x: number; y: number } {
    const r = this.overlay.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: MouseEvent) => {
    if (this.gestures.active) return;
    e.preventDefault();
    this.audio.enable();
    const { x, y } = this.pt(e);
    if (e.button === 0 && e.altKey) { this.drag = { button: 1, sx: x, sy: y, x, y, moved: false, height: 0 }; return; }
    this.drag = { button: e.button, sx: x, sy: y, x, y, moved: false, height: 0 };
    if (e.button === 2 && this.selected.size) {
      const enemy = this.pickUnit(x, y, u => u.side !== this.sim.playerSide);
      if (enemy) { this.drag.attackTarget = enemy; return; }
      const base = this.planePoint(x, y);
      if (base) this.drag.base = base;
    }
  };
  private planePoint(x: number, y: number): THREE.Vector3 | null {
    const units = [...this.selected];
    const avgY = units.length ? units.reduce((s, u) => s + u.pos.y, 0) / units.length : 0;
    const ray = this.cam.ray(x, y, this.overlay.width, this.overlay.height);
    const hit = new THREE.Vector3();
    return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -avgY), hit) ? hit : null;
  }
  private onMove = (e: MouseEvent) => {
    if (this.gestures.active) return;
    const { x, y } = this.pt(e);
    this.hover = this.pickUnit(x, y);
    if (!this.drag) return;
    const dx = x - this.drag.x, dy = y - this.drag.y;
    this.drag.x = x; this.drag.y = y;
    if (Math.hypot(x - this.drag.sx, y - this.drag.sy) > 5) this.drag.moved = true;
    if (this.drag.button === 1) this.cam.rotate(dx, dy);
    else if (this.drag.button === 2 && this.drag.base) this.drag.height = (this.drag.sy - y) * this.cam.distance * 0.0022;
  };
  private onUp = (e: MouseEvent) => {
    if (this.gestures.active) return;
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const { x, y } = this.pt(e);
    if (d.button === 0) {
      if (d.moved) {
        const x0 = Math.min(d.sx, x), x1 = Math.max(d.sx, x), y0 = Math.min(d.sy, y), y1 = Math.max(d.sy, y);
        const inBox: BUnit[] = [];
        for (const u of this.sim.alive(this.sim.playerSide)) {
          const p = this.overlay.project(u.pos, this.cam.camera);
          if (p.visible && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) inBox.push(u);
        }
        this.setSelection(inBox, e.shiftKey);
      } else {
        const u = this.pickUnit(x, y, u => u.side === this.sim.playerSide);
        const now = performance.now();
        const dbl = now - this.lastClick < 350;
        this.lastClick = now;
        if (u && dbl) this.setSelection(this.sim.alive(this.sim.playerSide).filter(o => o.cls.id === u.cls.id), true);
        else if (u) {
          if (e.shiftKey) {
            const squad = this.sim.expandSquads([u]);
            if (this.selected.has(u)) { for (const m of squad) this.selected.delete(m); this.onSelectionChange?.(); }
            else this.setSelection(squad, true);
          } else this.setSelection([u]);
        } else if (!e.shiftKey) this.setSelection([]);
      }
    } else if (d.button === 2 && this.selected.size) {
      const units = [...this.selected].filter(u => u.alive);
      if (d.attackTarget) this.sim.cmdAttack(units, d.attackTarget);
      else if (d.base) this.sim.cmdMove(units, d.base.clone().add(new THREE.Vector3(0, d.height, 0)), this.formation);
    }
  };
  /** Touch: tap selects an own ship (twice for its class); tap an enemy to attack; tap space to deselect. */
  private tap(x: number, y: number): void {
    this.audio.enable();
    const mine = this.pickUnit(x, y, u => u.side === this.sim.playerSide);
    const enemy = this.pickUnit(x, y, u => u.side !== this.sim.playerSide);
    const now = performance.now();
    const dbl = now - this.lastClick < 400;
    this.lastClick = now;
    if (mine) {
      if (dbl) this.setSelection(this.sim.alive(this.sim.playerSide).filter(o => o.cls.id === mine.cls.id), true);
      else this.setSelection([mine]);
    } else if (enemy && this.selected.size) {
      this.sim.cmdAttack([...this.selected].filter(u => u.alive), enemy);
    } else this.setSelection([]);
  }
  /** Touch: hold on space to move the selection there (on its current plane), hold an enemy to attack. */
  private longPress(x: number, y: number): boolean {
    if (!this.selected.size) return false;
    const units = [...this.selected].filter(u => u.alive);
    const enemy = this.pickUnit(x, y, u => u.side !== this.sim.playerSide);
    if (enemy) { this.sim.cmdAttack(units, enemy); return true; }
    const hit = this.planePoint(x, y);
    if (!hit) return false;
    this.sim.cmdMove(units, hit, this.formation);
    return true;
  }

  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.cam.zoom(e.deltaY); };
  private onKey = (e: KeyboardEvent) => {
    if (e.type === 'keydown') {
      this.keys.add(e.code);
      this.audio.enable();
      if (e.code === 'KeyF') this.focusSelection();
      if (e.code === 'Escape') this.setSelection([]);
      if (e.code === 'KeyA' && e.ctrlKey) { e.preventDefault(); this.setSelection(this.sim.alive(this.sim.playerSide)); }
      if (e.code === 'KeyS' && this.selected.size && !e.ctrlKey && e.shiftKey) this.sim.cmdStop([...this.selected]);
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'KeyZ') this.setFormation('wall');
      if (e.code === 'KeyX') this.setFormation('wedge');
      if (e.code === 'KeyC') this.setFormation('sphere');
      if (e.code === 'KeyV') this.setFormation('none');
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) { e.preventDefault(); const n = Number(m[1]); if (e.ctrlKey) this.assignGroup(n); else this.recallGroup(n); }
      if (['Space', 'Minus', 'Equal', 'NumpadAdd', 'NumpadSubtract'].includes(e.code)) { e.preventDefault(); this.onSpeedKey?.(e.code); }
    } else this.keys.delete(e.code);
  };
  private onCtx = (e: Event) => e.preventDefault();

  attach(): void {
    const c = this.overlay.canvas;
    c.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    this.gestures.attach();
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }
  detach(): void {
    const c = this.overlay.canvas;
    c.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    this.gestures.detach();
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  focusSelection(): void {
    const list = this.selected.size ? [...this.selected] : this.sim.alive(this.sim.playerSide);
    if (!list.length) return;
    const c = new THREE.Vector3();
    for (const u of list) c.add(u.pos);
    c.divideScalar(list.length);
    this.cam.focusOn(c);
  }

  private screenRadius(u: BUnit): number {
    const dist = this.cam.camera.position.distanceTo(u.pos);
    const f = (this.overlay.height / 2) / (dist * Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov) / 2));
    return Math.max(6, u.radius * f);
  }

  private pickUnit(x: number, y: number, filter?: (u: BUnit) => boolean): BUnit | null {
    let best: BUnit | null = null, bestD = Infinity;
    for (const u of this.sim.alive()) {
      if (filter && !filter(u)) continue;
      const p = this.overlay.project(u.pos, this.cam.camera);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      const r = this.screenRadius(u) + 6;
      if (d < r && d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  // ------------------------------------------------------------ frame
  update(dt: number): void {
    const pan = 600 * dt;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.cam.pan(0, -pan);
    if (this.keys.has('KeyS') && !this.keys.has('ShiftLeft') && !this.keys.has('ShiftRight')) this.cam.pan(0, pan);
    if (this.keys.has('ArrowDown')) this.cam.pan(0, pan);
    if (this.keys.has('KeyA') && !this.keys.has('ControlLeft')) this.cam.pan(-pan, 0);
    if (this.keys.has('ArrowLeft')) this.cam.pan(-pan, 0);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.cam.pan(pan, 0);
    if (this.keys.has('KeyQ')) this.cam.rotate(-300 * dt, 0);
    if (this.keys.has('KeyE')) this.cam.rotate(300 * dt, 0);
    this.cam.update(dt);
    this.audio.setListener(this.cam.camera, this.cam.distance);

    // sound events
    for (const ev of this.sim.sfx) this.audio.play(ev);
    this.sim.sfx.length = 0;

    // meshes + trails
    const tmp = new THREE.Vector3();
    for (const u of this.sim.units) {
      const m = this.meshes.get(u.id)!;
      const tr = this.trails.get(u.id);
      if (!u.alive || u.escaped) { if (m.visible) { m.visible = false; if (tr) tr.line.visible = false; } continue; }
      m.position.copy(u.pos);
      tmp.copy(u.pos).add(u.fwd);
      m.lookAt(tmp);
      if (u.cls.size === 'small') m.rotateZ(Math.sin(u.wobble * 2 + u.id) * 0.1);
      if (tr) {
        if (tr.last.distanceToSquared(u.pos) > 0.16) {
          // shift history back one slot, newest at index 0
          tr.pos.copyWithin(3, 0, (TRAIL_LEN - 1) * 3);
          tr.pos[0] = u.pos.x; tr.pos[1] = u.pos.y; tr.pos[2] = u.pos.z;
          tr.last.copy(u.pos);
          (tr.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        }
        const speed = u.vel.length() / Math.max(1, u.cls.speed);
        (tr.line.material as THREE.LineBasicMaterial).opacity = 0.25 + 0.55 * speed;
      }
    }
    for (const u of this.selected) if (!u.alive || u.escaped) this.selected.delete(u);

    // bolts
    let n = 0, ti = 0;
    for (const p of this.sim.projectiles) {
      if (p.kind === 'torpedo') {
        if (ti < this.torps.length) { const m = this.torps[ti++]; m.visible = true; m.position.copy(p.pos); }
        continue;
      }
      if (n >= 1500) break;
      const len = p.kind === 'turbo' ? 3.2 : p.kind === 'ion' ? 2.6 : 2.0;
      const dir = p.vel.clone().normalize();
      const col = BOLT_COLOR[p.kind]?.[p.side] ?? BOLT_COLOR.laser[p.side];
      const i = n * 6;
      this.boltPos[i] = p.pos.x; this.boltPos[i + 1] = p.pos.y; this.boltPos[i + 2] = p.pos.z;
      this.boltPos[i + 3] = p.pos.x - dir.x * len; this.boltPos[i + 4] = p.pos.y - dir.y * len; this.boltPos[i + 5] = p.pos.z - dir.z * len;
      this.boltCol[i] = col.r; this.boltCol[i + 1] = col.g; this.boltCol[i + 2] = col.b;
      this.boltCol[i + 3] = col.r * 0.3; this.boltCol[i + 4] = col.g * 0.3; this.boltCol[i + 5] = col.b * 0.3;
      n++;
    }
    for (; ti < this.torps.length; ti++) this.torps[ti].visible = false;
    const g = this.bolts.geometry;
    g.setDrawRange(0, n * 2);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // explosions
    let bi = 0;
    for (const e of this.sim.explosions) {
      if (bi >= this.booms.length) break;
      const m = this.booms[bi++];
      const t = e.age / e.life;
      m.visible = true;
      m.position.copy(e.pos);
      m.scale.setScalar(e.size * (0.3 + t * 1.2));
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.9;
      mat.color.setHSL(0.08 - t * 0.06, 1, 0.6 - t * 0.2);
    }
    for (; bi < this.booms.length; bi++) this.booms[bi].visible = false;

    // shield ripples: a translucent bubble that flashes on shielded hits
    for (const f of this.sim.flashes) {
      if (f.age > 0 || !f.shield) continue;
      const r = this.ripples.find(x => x.age >= 0.3);
      if (!r) break;
      r.age = 0; r.unit = f.unit;
      (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(f.unit.side === 'empire' ? 0x7fd3ff : 0xffb070);
    }
    for (const r of this.ripples) {
      r.age += dt;
      if (r.age >= 0.3 || !r.unit || !r.unit.alive) { r.mesh.visible = false; continue; }
      r.mesh.visible = true;
      r.mesh.position.copy(r.unit.pos);
      r.mesh.scale.setScalar(r.unit.radius * (1.1 + r.age * 0.6));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - r.age / 0.3);
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.cam.camera);
  }

  drawOverlay(): void {
    const o = this.overlay, c = o.ctx, cam = this.cam.camera;
    o.begin();
    const targets = new Set<BUnit>();
    for (const u of this.selected) if (u.order.type === 'attack') targets.add(u.order.target);
    const labelled = new Set<number>(); // one label per squadron

    for (const u of this.sim.alive()) {
      const p = o.project(u.pos, cam);
      if (!p.visible) continue;
      const r = this.screenRadius(u);
      const mine = u.side === this.sim.playerSide;
      const col = FACTION_CSS[u.side];
      const sel = this.selected.has(u);
      const hov = this.hover === u || (this.hover?.squad != null && this.hover.squad === u.squad);
      if (sel) o.circle(p.x, p.y, r + 4, col, 1.5);
      else if (hov) o.circle(p.x, p.y, r + 4, mine ? col : '#ff6b6b', 1, [4, 3]);
      if (targets.has(u)) o.circle(p.x, p.y, r + 7, '#ff5050', 1.2, [3, 3]);
      const damaged = u.hp < u.maxHp - 0.5 || u.shield < u.maxShield - 0.5;
      if (sel || hov || (damaged && r > 5)) {
        const w = Math.max(18, Math.min(48, r * 2.2));
        const bx = p.x - w / 2, by = p.y - r - 12;
        if (u.maxShield > 0) o.bar(bx, by, w, 3, u.shield / u.maxShield, '#7fd3ff');
        o.bar(bx, by + 4, w, 3, u.hp / u.maxHp, u.hp / u.maxHp > 0.5 ? '#6fe39a' : u.hp / u.maxHp > 0.25 ? '#ffd27a' : '#ff6b6b');
      }
      const squadKey = u.squad ? u.squad.id * 2 + (u.side === 'empire' ? 0 : 1) : -1;
      const showLabel = (hov || (sel && this.selected.size <= 12)) && (squadKey < 0 || !labelled.has(squadKey));
      if (showLabel) {
        if (squadKey >= 0) labelled.add(squadKey);
        const text = u.squad ? `${u.cls.name} flight (${u.squad.members.length})` : u.cls.name;
        o.text(text, p.x, p.y + r + 10, { size: 10, color: mine ? '#dfe7ef' : '#ffb0a0' });
      } else if (!mine && r < 5) { c.fillStyle = col; c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    }

    // target / move lines
    c.setLineDash([2, 4]); c.lineWidth = 1;
    for (const u of this.selected) {
      if (this.sim.isWingman(u)) continue;
      if (u.order.type === 'attack') {
        const a = o.project(u.pos, cam), b = o.project(u.order.target.pos, cam);
        if (a.visible && b.visible) { c.strokeStyle = 'rgba(255,90,80,0.5)'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      } else if (u.order.type === 'move') {
        const a = o.project(u.pos, cam), b = o.project(u.order.to, cam);
        if (a.visible && b.visible) { c.strokeStyle = 'rgba(127,211,255,0.4)'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      }
    }
    c.setLineDash([]);

    // hull hit flashes (shield hits are 3D ripples)
    for (const f of this.sim.flashes) {
      if (f.shield) continue;
      const p = o.project(f.unit.pos, cam);
      if (!p.visible) continue;
      const a = 1 - f.age / 0.25;
      o.circle(p.x, p.y, this.screenRadius(f.unit) + 3, `rgba(255,160,80,${a * 0.8})`, 1.2);
    }

    // drag visuals
    const d = this.drag;
    if (d && d.button === 0 && d.moved) {
      c.strokeStyle = 'rgba(127,211,255,0.9)'; c.lineWidth = 1; c.setLineDash([4, 3]);
      c.strokeRect(Math.min(d.sx, d.x), Math.min(d.sy, d.y), Math.abs(d.x - d.sx), Math.abs(d.y - d.sy));
      c.setLineDash([]);
      c.fillStyle = 'rgba(127,211,255,0.08)';
      c.fillRect(Math.min(d.sx, d.x), Math.min(d.sy, d.y), Math.abs(d.x - d.sx), Math.abs(d.y - d.sy));
    }
    if (d && d.button === 2 && d.base) {
      const base = o.project(d.base, cam);
      const top = o.project(d.base.clone().add(new THREE.Vector3(0, d.height, 0)), cam);
      const ringPts: [number, number][] = [];
      for (let i = 0; i <= 24; i++) {
        const a = i / 24 * Math.PI * 2;
        const pp = o.project(d.base.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6)), cam);
        ringPts.push([pp.x, pp.y]);
      }
      c.strokeStyle = 'rgba(127,211,255,0.9)'; c.lineWidth = 1.2; c.beginPath();
      ringPts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
      c.stroke();
      c.setLineDash([3, 3]); c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(top.x, top.y); c.stroke(); c.setLineDash([]);
      o.circle(top.x, top.y, 4, '#7fd3ff', 1.5);
      if (Math.abs(d.height) > 0.5) o.text(`${d.height > 0 ? '+' : ''}${d.height.toFixed(0)}`, top.x + 14, top.y, { size: 11, align: 'left', color: '#7fd3ff' });
      const cen = new THREE.Vector3();
      for (const u of this.selected) cen.add(u.pos);
      cen.divideScalar(Math.max(1, this.selected.size));
      const cp = o.project(cen, cam);
      c.strokeStyle = 'rgba(127,211,255,0.35)'; c.setLineDash([2, 5]); c.beginPath(); c.moveTo(cp.x, cp.y); c.lineTo(top.x, top.y); c.stroke(); c.setLineDash([]);
      if (this.formation !== 'none') o.text(`${FORMATION_LABEL[this.formation]} formation`, top.x, top.y - 14, { size: 11, color: '#7fd3ff' });
    }

    // slow motion vignette
    if (this.sim.slowMo > 0) {
      const a = Math.min(1, this.sim.slowMo) * 0.35;
      const grad = c.createRadialGradient(o.width / 2, o.height / 2, o.height * 0.35, o.width / 2, o.height / 2, o.height * 0.9);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, `rgba(0,0,0,${a})`);
      c.fillStyle = grad; c.fillRect(0, 0, o.width, o.height);
    }

    for (const side of ['empire', 'rebellion'] as FactionId[]) {
      if (this.sim.retreating[side] && this.sim.retreatTimer[side] > 0) {
        o.text(`${side === 'empire' ? 'Imperial' : 'Rebel'} fleet jumping to hyperspace in ${Math.ceil(this.sim.retreatTimer[side])}s`, o.width / 2, 60, { size: 14, color: FACTION_CSS[side], bold: true });
      }
    }
  }

  resize(): void { this.cam.setAspect(this.overlay.width / this.overlay.height); }

  dispose(): void {
    this.audio.dispose();
    for (const tr of this.trails.values()) tr.line.geometry.dispose();
    this.meshes.clear();
    this.trails.clear();
  }
}

export { FACTION_COLOR };
