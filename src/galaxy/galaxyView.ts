import * as THREE from 'three';
import { OrbitCamera } from '../core/orbitCamera';
import { Overlay } from '../core/overlay';
import { TouchGestures } from '../core/touchGestures';
import { FACTION_CSS, makeStarfield, planetColor } from '../battle/shipMeshes';
import { fleetStrength, charactersAt, isBlockaded } from '../sim/sim';
import type { Fleet, GameState } from '../sim/types';
import { canSeeDetails, canSeeFleet, knowsHq } from '../sim/visibility';

export interface GalaxySelection { kind: 'planet' | 'fleet'; id: number }
export interface GalaxyCallbacks {
  onClickPlanet(id: number, e: MouseEvent): void;
  onClickFleet(id: number, e: MouseEvent): void;
  onClickEmpty(): void;
  onRightClickPlanet(id: number): void;
  onDoubleClickPlanet(id: number): void;
}

const FACTION_HEX = { empire: 0x4fa3ff, rebellion: 0xff8c42 };

export class GalaxyView {
  scene = new THREE.Scene();
  cam: OrbitCamera;
  selection: GalaxySelection | null = null;
  hoverPlanet: number | null = null;
  hoverFleet: number | null = null;
  /** Route preview (planet ids) drawn in yellow, e.g. while hovering a destination. */
  preview: number[] | null = null;
  targetMode = false;
  private planetMeshes: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private routeLine: THREE.Line;
  private previewLine: THREE.Line;
  private drag: { button: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null = null;
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0 };
  private lastClickTime = 0;
  private lastClickPlanet = -1;
  private gestures: TouchGestures;
  private t = 0;
  private dynamic = new THREE.Group();

  constructor(private renderer: THREE.WebGLRenderer, private overlay: Overlay, public state: GameState, private cb: GalaxyCallbacks) {
    this.cam = new OrbitCamera(overlay.width / overlay.height, { distance: 230, minDistance: 25, maxDistance: 600, yaw: 0.4, pitch: 0.95, fov: 50, near: 1, far: 5000 });
    this.gestures = new TouchGestures(overlay.canvas, this.cam, {
      tap: (x, y) => this.tap(x, y),
      longPress: (x, y) => this.longPress(x, y),
      move: (x, y) => { this.mouse.x = x; this.mouse.y = y; },
    });
    this.scene.add(makeStarfield(3000, 2000));
    this.scene.add(new THREE.AmbientLight(0x9aa8c0, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(100, 200, 50);
    this.scene.add(sun);
    // galactic plane reference
    const gridPts: number[] = [];
    for (const r of [30, 60, 90, 120]) for (let i = 0; i < 96; i++) {
      const a0 = i / 96 * Math.PI * 2, a1 = (i + 1) / 96 * Math.PI * 2;
      gridPts.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
    }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; gridPts.push(0, 0, 0, Math.cos(a) * 120, 0, Math.sin(a) * 120); }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    this.scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x16283a, transparent: true, opacity: 0.8 })));

    this.routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.9 }));
    this.previewLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.9 }));
    this.scene.add(this.routeLine, this.previewLine, this.dynamic);
    this.buildStatic();
  }

  setState(s: GameState): void { this.state = s; this.buildStatic(); this.selection = null; this.preview = null; }

  private buildStatic(): void {
    this.dynamic.clear();
    this.planetMeshes = []; this.rings = [];
    const s = this.state;
    const dropPts: number[] = [];
    for (const p of s.planets) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 20, 14), new THREE.MeshStandardMaterial({ color: planetColor(p.type), roughness: 0.85, metalness: 0.05 }));
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      m.userData.id = p.id;
      this.dynamic.add(m);
      this.planetMeshes.push(m);
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius * 1.6, p.radius * 1.9, 32), new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
      ring.position.copy(m.position);
      ring.rotation.x = -Math.PI / 2;
      this.dynamic.add(ring);
      this.rings.push(ring);
      dropPts.push(p.pos.x, p.pos.y, p.pos.z, p.pos.x, 0, p.pos.z);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dropPts, 3));
    this.dynamic.add(new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: 0x2a3d52, transparent: true, opacity: 0.55 })));
    const lanePts: number[] = [];
    for (const l of s.lanes) { const a = s.planets[l.a].pos, b = s.planets[l.b].pos; lanePts.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lanePts, 3));
    this.dynamic.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3a5068, transparent: true, opacity: 0.75 })));
    const hq = s.planets[s.factions[s.player].hq];
    this.cam.focusOn(new THREE.Vector3(hq.pos.x * 0.6, 0, hq.pos.z * 0.6), 280);
    this.cam.snap();
  }

  fleetWorldPos(f: Fleet): THREE.Vector3 {
    const s = this.state;
    if (f.at !== null) { const p = s.planets[f.at].pos; return new THREE.Vector3(p.x, p.y, p.z); }
    const a = s.planets[f.travel!.from].pos, b = s.planets[f.travel!.to].pos;
    return new THREE.Vector3(a.x, a.y, a.z).lerp(new THREE.Vector3(b.x, b.y, b.z), f.travel!.progress);
  }

  focusPlanet(id: number, distance?: number): void {
    const p = this.state.planets[id].pos;
    this.cam.focusOn(new THREE.Vector3(p.x, p.y, p.z), distance);
  }
  focusFleet(id: number): void {
    const f = this.state.fleets.find(x => x.id === id);
    if (f) this.cam.focusOn(this.fleetWorldPos(f));
  }

  // ------------------------------------------------------------ input
  private onDown = (e: MouseEvent) => {
    if (this.gestures.active) return;
    e.preventDefault();
    const { x, y } = this.pt(e);
    this.drag = { button: e.button, sx: x, sy: y, x, y, moved: false };
  };

  private tap(x: number, y: number): void {
    const fleetHit = this.overlay.hitTest(x, y, ['fleet']);
    const planetHit = this.overlay.hitTest(x, y, ['planet']);
    const fake = { shiftKey: false } as MouseEvent;
    if (fleetHit && !this.targetMode) this.cb.onClickFleet(fleetHit.id, fake);
    else if (planetHit) {
      const now = performance.now();
      if (now - this.lastClickTime < 350 && this.lastClickPlanet === planetHit.id) this.cb.onDoubleClickPlanet(planetHit.id);
      else this.cb.onClickPlanet(planetHit.id, fake);
      this.lastClickTime = now; this.lastClickPlanet = planetHit.id;
    } else this.cb.onClickEmpty();
  }
  /** Long-press on a planet = right-click (send the selected fleet there). */
  private longPress(x: number, y: number): boolean {
    const hit = this.overlay.hitTest(x, y, ['planet']);
    if (!hit) return false;
    this.cb.onRightClickPlanet(hit.id);
    return true;
  }

  private onMove = (e: MouseEvent) => {
    if (this.gestures.active) return;
    const { x, y } = this.pt(e);
    this.mouse.x = x; this.mouse.y = y;
    if (!this.drag) return;
    const dx = x - this.drag.x, dy = y - this.drag.y;
    this.drag.x = x; this.drag.y = y;
    if (Math.hypot(x - this.drag.sx, y - this.drag.sy) > 5) this.drag.moved = true;
    if (this.drag.moved) {
      if (this.drag.button === 2 || (this.drag.button === 0 && e.altKey)) this.cam.rotate(dx, dy);
      else if (this.drag.button === 1 || this.drag.button === 0) this.cam.pan(dx, dy);
    }
  };
  private onUp = (e: MouseEvent) => {
    if (this.gestures.active) return;
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved) return;
    const { x, y } = this.pt(e);
    const fleetHit = this.overlay.hitTest(x, y, ['fleet']);
    const planetHit = this.overlay.hitTest(x, y, ['planet']);
    if (d.button === 0) {
      if (fleetHit && !this.targetMode) this.cb.onClickFleet(fleetHit.id, e);
      else if (planetHit) {
        const now = performance.now();
        if (now - this.lastClickTime < 350 && this.lastClickPlanet === planetHit.id) this.cb.onDoubleClickPlanet(planetHit.id);
        else this.cb.onClickPlanet(planetHit.id, e);
        this.lastClickTime = now; this.lastClickPlanet = planetHit.id;
      } else this.cb.onClickEmpty();
    } else if (d.button === 2 && planetHit) this.cb.onRightClickPlanet(planetHit.id);
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.cam.zoom(e.deltaY); };
  private onKey = (e: KeyboardEvent) => { if (e.type === 'keydown') this.keys.add(e.code); else this.keys.delete(e.code); };
  private onCtx = (e: Event) => e.preventDefault();

  /** Mouse position relative to the overlay canvas (works even when the event target is a HUD element). */
  private pt(e: MouseEvent): { x: number; y: number } {
    const r = this.overlay.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

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
    this.keys.clear();
  }

  resize(): void { this.cam.setAspect(this.overlay.width / this.overlay.height); }

  // ------------------------------------------------------------ frame
  update(dt: number): void {
    this.t += dt;
    const pan = 700 * dt;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.cam.pan(0, -pan);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.cam.pan(0, pan);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.cam.pan(-pan, 0);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.cam.pan(pan, 0);
    if (this.keys.has('KeyQ')) this.cam.rotate(-300 * dt, 0);
    if (this.keys.has('KeyE')) this.cam.rotate(300 * dt, 0);
    this.cam.update(dt);

    const s = this.state;
    for (const p of s.planets) {
      const ring = this.rings[p.id];
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.setHex(p.destroyed ? 0x5a2a2a : p.owner ? FACTION_HEX[p.owner] : 0x555555);
      mat.opacity = p.destroyed ? 0.5 : p.owner ? 0.85 : 0.35;
      const pm = this.planetMeshes[p.id].material as THREE.MeshStandardMaterial;
      if (p.destroyed && pm.color.getHex() !== 0x3a2626) { pm.color.setHex(0x3a2626); pm.emissive.setHex(0x3a1010); }
    }
    // route line for a selected fleet
    const selFleet = this.selection?.kind === 'fleet' ? s.fleets.find(f => f.id === this.selection!.id) : null;
    if (selFleet && selFleet.travel) {
      const pts = [this.fleetWorldPos(selFleet)];
      for (const id of [selFleet.travel.to, ...selFleet.travel.path]) pts.push(new THREE.Vector3(s.planets[id].pos.x, s.planets[id].pos.y, s.planets[id].pos.z));
      this.routeLine.geometry.setFromPoints(pts);
      this.routeLine.visible = true;
    } else this.routeLine.visible = false;
    if (this.preview && this.preview.length > 1) {
      const pts = this.preview.map(id => new THREE.Vector3(s.planets[id].pos.x, s.planets[id].pos.y, s.planets[id].pos.z));
      this.previewLine.geometry.setFromPoints(pts);
      this.previewLine.computeLineDistances();
      this.previewLine.visible = true;
    } else this.previewLine.visible = false;

    // hover from last frame's hit regions
    const fh = this.overlay.hitTest(this.mouse.x, this.mouse.y, ['fleet']);
    const ph = this.overlay.hitTest(this.mouse.x, this.mouse.y, ['planet']);
    this.hoverFleet = fh && !this.targetMode ? fh.id : null;
    this.hoverPlanet = ph ? ph.id : null;
  }

  render(): void { this.renderer.render(this.scene, this.cam.camera); }

  private screenRadius(worldR: number, pos: THREE.Vector3 | { x: number; y: number; z: number }): number {
    const dist = this.cam.camera.position.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
    const f = (this.overlay.height / 2) / (dist * Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov) / 2));
    return worldR * f;
  }

  drawOverlay(): void {
    const o = this.overlay, c = o.ctx, cam = this.cam.camera, s = this.state, me = s.player;
    o.begin();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);

    // --- planets (labels decluttered: important ones first, overlapping ones skipped) ---
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const priority = (p: typeof s.planets[number]) => {
      const sel = this.selection?.kind === 'planet' && this.selection.id === p.id;
      if (sel || this.hoverPlanet === p.id) return 1000;
      return (knowsHq(s, me, p.id) ? 300 : 0) + (p.owner === me ? 100 : p.owner ? 50 : 0) + p.production;
    };
    for (const p of [...s.planets].sort((a, b) => priority(b) - priority(a))) {
      const pr = o.project(p.pos, cam);
      if (!pr.visible) continue;
      const r = this.screenRadius(p.radius, p.pos);
      o.addHit(pr.x, pr.y, Math.max(r + 4, 14), 'planet', p.id, pr.depth);
      const ownerCol = p.owner ? FACTION_CSS[p.owner] : '#9aa3ad';
      const selected = this.selection?.kind === 'planet' && this.selection.id === p.id;
      const hovered = this.hoverPlanet === p.id;
      if (selected) o.circle(pr.x, pr.y, r + 6 + pulse * 2, '#ffffff', 1.5);
      else if (hovered) o.circle(pr.x, pr.y, r + 6, this.targetMode ? '#ffd27a' : '#ffffff', 1, [4, 3]);
      if (isBlockaded(s, p) && canSeeFleet(s, me, s.fleets.find(f => f.at === p.id && f.faction !== p.owner)!)) o.circle(pr.x, pr.y, r + 10, '#ff5050', 1, [2, 3]);
      const hq = knowsHq(s, me, p.id);
      let label = p.name;
      if (hq) label = (p.id === s.factions.empire.hq ? '★ ' : '◆ ') + label;
      const fontSize = selected || hovered ? 13 : 11.5;
      const lw = label.length * fontSize * 0.56 + 6, lh = fontSize + 4;
      const rect = { x0: pr.x - lw / 2, y0: pr.y + r + 11 - lh / 2, x1: pr.x + lw / 2, y1: pr.y + r + 11 + lh / 2 };
      const clash = placed.some(q => rect.x0 < q.x1 && rect.x1 > q.x0 && rect.y0 < q.y1 && rect.y1 > q.y0);
      if (!clash) { placed.push(rect); o.text(label, pr.x, pr.y + r + 11, { size: fontSize, color: ownerCol, bold: selected || hq }); }
      // small status glyphs
      const details = canSeeDetails(s, me, p);
      let gy = pr.y + r + 24;
      if (p.owner === me && p.queue.length) {
        const it = p.queue[0];
        o.bar(pr.x - 18, gy - 3, 36, 3, it.progress / it.total, '#7fd3ff');
        gy += 6;
      }
      if (p.invasion) { o.text('⚔ invasion', pr.x, gy, { size: 10, color: '#ffd27a' }); gy += 12; }
      if (p.unrest > 48 && details) { o.text('unrest', pr.x, gy, { size: 10, color: '#ff8c8c' }); gy += 12; }
      const chars = charactersAt(s, p.id).filter(ch => ch.faction === me || details);
      if (chars.length) {
        chars.forEach((ch, i) => {
          const cx = pr.x - (chars.length - 1) * 5 + i * 10;
          c.fillStyle = FACTION_CSS[ch.faction]; c.beginPath(); c.arc(cx, gy, 3, 0, Math.PI * 2); c.fill();
          c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
        });
      }
    }

    // --- the Death Star ---
    if (s.deathStar && !s.deathStar.destroyed) {
      const p = s.planets[s.deathStar.at];
      const pr = o.project(p.pos, cam);
      if (pr.visible) {
        const r = this.screenRadius(p.radius, p.pos);
        const x = pr.x - r - 16, y = pr.y - 10;
        c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fillStyle = '#8d949c'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#e8eef4'; c.stroke();
        c.beginPath(); c.arc(x - 3, y - 3, 3, 0, Math.PI * 2); c.fillStyle = '#4a5059'; c.fill();
        c.beginPath(); c.moveTo(x - 9, y + 1); c.lineTo(x + 9, y + 1); c.strokeStyle = '#4a5059'; c.lineWidth = 1; c.stroke();
        o.text('Death Star', x, y + 17, { size: 10, color: '#ff8080', bold: true });
      }
    }

    // --- fleets ---
    const perPlanet = new Map<number, { own: number; enemy: number }>();
    for (const f of s.fleets) {
      if (!canSeeFleet(s, me, f)) continue;
      const pos = this.fleetWorldPos(f);
      const pr = o.project(pos, cam);
      if (!pr.visible) continue;
      const mine = f.faction === me;
      const col = FACTION_CSS[f.faction];
      let x = pr.x, y = pr.y, angle = -Math.PI / 2;
      if (f.at !== null) {
        const r = this.screenRadius(s.planets[f.at].radius, pos);
        const slot = perPlanet.get(f.at) ?? { own: 0, enemy: 0 };
        const i = mine ? slot.own++ : slot.enemy++;
        perPlanet.set(f.at, slot);
        x = pr.x + (mine ? 1 : -1) * (r + 14);
        y = pr.y - 6 - i * 15;
      } else {
        const to = o.project(s.planets[f.travel!.to].pos, cam);
        angle = Math.atan2(to.y - pr.y, to.x - pr.x);
      }
      const selected = this.selection?.kind === 'fleet' && this.selection.id === f.id;
      const hovered = this.hoverFleet === f.id;
      o.chevron(x, y, 7, angle, col, selected ? '#fff' : '#000');
      if (selected) o.circle(x, y, 11, '#ffffff', 1.5);
      else if (hovered) o.circle(x, y, 11, '#ffffff', 1, [3, 3]);
      const n = f.ships.length;
      o.text(String(n), x + (mine || f.at === null ? 11 : -11), y, { size: 10, align: mine || f.at === null ? 'left' : 'right', color: col });
      o.addHit(x, y, 11, 'fleet', f.id, pr.depth);
    }

    // --- tooltip ---
    if (this.hoverFleet !== null) {
      const f = s.fleets.find(x => x.id === this.hoverFleet);
      if (f) this.tooltip(`${f.name} — ${f.ships.length} ships, strength ${fleetStrength(f).toFixed(0)}${f.troops ? `, ${f.troops} regiments` : ''}`);
    } else if (this.hoverPlanet !== null) {
      const p = s.planets[this.hoverPlanet];
      const owner = p.owner ? (p.owner === 'empire' ? 'Empire' : 'Rebellion') : 'Neutral';
      this.tooltip(`${p.name} — ${owner} · ${p.type} · production ${p.production}/day${p.shipyard ? ` · shipyard ${p.shipyard}` : ''}`);
    }
  }

  private tooltip(text: string): void {
    const o = this.overlay, c = o.ctx;
    c.font = '12px "Segoe UI", system-ui, sans-serif';
    const w = c.measureText(text).width + 16;
    let x = this.mouse.x + 14, y = this.mouse.y + 18;
    if (x + w > o.width) x = o.width - w - 4;
    c.fillStyle = 'rgba(8,14,22,0.9)'; c.fillRect(x, y, w, 22);
    c.strokeStyle = 'rgba(120,160,200,0.35)'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, 21);
    o.text(text, x + 8, y + 11, { size: 12, align: 'left', shadow: false });
  }
}
