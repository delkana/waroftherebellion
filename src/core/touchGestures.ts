import type { OrbitCamera } from './orbitCamera';

export interface TouchCallbacks {
  /** Quick touch without movement. */
  tap(x: number, y: number): void;
  /** Finger held still for ~0.55 s. Return true to consume the touch (no tap on release). */
  longPress(x: number, y: number): boolean;
  /** Finger position updates (for hover-style feedback). */
  move?(x: number, y: number): void;
}

interface Pinch {
  dist: number; angle: number; mx: number; my: number;   // low-pass filtered current state
  zooming: boolean; distRef: number; camDistRef: number;
  orbiting: boolean; mxRef: number; myRef: number;
  twisting: boolean; angleRef: number;
  yaw0: number; pitch0: number;
}

/**
 * Touch camera controls shared by the galaxy map and tactical battles:
 * one finger drags to pan, two fingers pinch to zoom, drag to orbit and twist to rotate.
 * Gestures are measured against references captured when each sub-gesture engages
 * (absolute, not accumulated deltas) so finger noise cannot build up into jitter.
 */
export class TouchGestures {
  /** True while a touch is in progress (and briefly after), so synthetic mouse events can be ignored. */
  active = false;
  private touches = new Map<number, { x: number; y: number }>();
  private touch: { sx: number; sy: number; moved: boolean; timer: number } | null = null;
  private pinch: Pinch | null = null;

  constructor(private canvas: HTMLCanvasElement, private cam: OrbitCamera, private cb: TouchCallbacks) {}

  private pt(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    this.active = true;
    const p = this.pt(e);
    this.touches.set(e.pointerId, p);
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events have no active pointer */ }
    if (this.touches.size === 1) {
      this.cb.move?.(p.x, p.y);
      if (this.touch) window.clearTimeout(this.touch.timer);
      const timer = window.setTimeout(() => {
        if (!this.touch || this.touch.moved || this.touches.size !== 1) return;
        if (this.cb.longPress(this.touch.sx, this.touch.sy)) this.touch = null;
      }, 550);
      this.touch = { sx: p.x, sy: p.y, moved: false, timer };
      this.pinch = null;
    } else if (this.touches.size === 2) {
      if (this.touch) { window.clearTimeout(this.touch.timer); this.touch = null; }
      const s0 = this.pinchState();
      this.pinch = {
        ...s0,
        zooming: false, distRef: s0.dist, camDistRef: this.cam.goalDist,
        orbiting: false, mxRef: s0.mx, myRef: s0.my,
        twisting: false, angleRef: s0.angle,
        yaw0: this.cam.yaw, pitch0: this.cam.pitch,
      };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
    const p = this.pt(e);
    const prev = this.touches.get(e.pointerId)!;
    this.touches.set(e.pointerId, p);
    if (this.touches.size === 1 && this.touch) {
      if (!this.touch.moved && Math.hypot(p.x - this.touch.sx, p.y - this.touch.sy) > 8) { this.touch.moved = true; window.clearTimeout(this.touch.timer); }
      if (this.touch.moved) this.cam.pan(p.x - prev.x, p.y - prev.y);
      this.cb.move?.(p.x, p.y);
    } else if (this.touches.size === 2 && this.pinch) {
      this.updatePinch();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
    this.touches.delete(e.pointerId);
    if (this.touches.size === 1) { this.pinch = null; this.touch = null; }
    if (this.touches.size === 0) {
      const t = this.touch;
      this.touch = null; this.pinch = null;
      if (t) {
        window.clearTimeout(t.timer);
        if (!t.moved) this.cb.tap(t.sx, t.sy); // a fired long-press has already cleared `touch`
      }
      // let the synthetic mouse events that follow a touch drop through as no-ops
      window.setTimeout(() => { this.active = this.touches.size > 0; }, 400);
    }
  };

  private pinchState() {
    const [a, b] = [...this.touches.values()];
    return { dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private updatePinch(): void {
    const g = this.pinch!;
    const raw = this.pinchState();
    // light low-pass on the measured state: pointer events arrive per finger, alternating
    const k = 0.6;
    g.dist += (raw.dist - g.dist) * k;
    g.mx += (raw.mx - g.mx) * k;
    g.my += (raw.my - g.my) * k;
    let da = raw.angle - g.angle;
    if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
    g.angle += da * k;

    // pinch zoom engages after the finger spread changes noticeably; from then on it is absolute
    if (!g.zooming && Math.abs(g.dist - g.distRef) > 14) { g.zooming = true; g.distRef = g.dist; g.camDistRef = this.cam.goalDist; }
    if (g.zooming) this.cam.setGoalDistance(g.camDistRef * g.distRef / g.dist);

    // two-finger drag orbits once the midpoint has clearly moved
    if (!g.orbiting && Math.hypot(g.mx - g.mxRef, g.my - g.myRef) > 16) { g.orbiting = true; g.mxRef = g.mx; g.myRef = g.my; }
    // twist rotates once the angle has clearly changed
    let twist = g.angle - g.angleRef;
    if (twist > Math.PI) twist -= Math.PI * 2; else if (twist < -Math.PI) twist += Math.PI * 2;
    // the angle between two fingers is unreliable when they are nearly touching
    if (g.dist < 40) { twist = 0; g.angleRef = g.angle; }
    if (!g.twisting && Math.abs(twist) > 0.15) { g.twisting = true; g.angleRef = g.angle; twist = 0; }

    const orbitYaw = g.orbiting ? -(g.mx - g.mxRef) * 0.005 : 0;
    const orbitPitch = g.orbiting ? (g.my - g.myRef) * 0.005 : 0;
    const twistYaw = g.twisting ? twist : 0;
    if (g.orbiting || g.twisting) this.cam.setOrbit(g.yaw0 + orbitYaw + twistYaw, g.pitch0 + orbitPitch);
  }

  attach(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
  }

  detach(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    if (this.touch) window.clearTimeout(this.touch.timer);
    this.touches.clear(); this.touch = null; this.pinch = null; this.active = false;
  }
}
