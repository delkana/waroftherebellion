import * as THREE from 'three';

export interface HitRegion { x: number; y: number; r: number; kind: string; id: number; depth: number }
export interface Projected { x: number; y: number; visible: boolean; depth: number }

/** 2D canvas layered over the WebGL view for labels, icons, selection rings and pick regions. */
export class Overlay {
  ctx: CanvasRenderingContext2D;
  width = 1; height = 1; dpr = 1;
  hits: HitRegion[] = [];
  private tmp = new THREE.Vector3();

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    // ignore zero-size layouts (hidden tab, minimised window) so the camera never sees a NaN aspect
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w > 0 && h > 0) { this.width = w; this.height = h; }
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  begin(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.hits = [];
  }

  project(v: THREE.Vector3 | { x: number; y: number; z: number }, camera: THREE.Camera): Projected {
    this.tmp.set(v.x, v.y, v.z).project(camera);
    const visible = this.tmp.z > -1 && this.tmp.z < 1;
    return { x: (this.tmp.x + 1) / 2 * this.width, y: (1 - this.tmp.y) / 2 * this.height, visible, depth: this.tmp.z };
  }

  addHit(x: number, y: number, r: number, kind: string, id: number, depth = 0): void {
    this.hits.push({ x, y, r, kind, id, depth });
  }

  hitTest(x: number, y: number, kinds?: string[]): HitRegion | null {
    let best: HitRegion | null = null, bestD = Infinity;
    for (const h of this.hits) {
      if (kinds && !kinds.includes(h.kind)) continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r && (d - h.r * 0.001 < bestD)) { bestD = d; best = h; }
    }
    return best;
  }

  circle(x: number, y: number, r: number, stroke: string, width = 1.5, dash?: number[]): void {
    const c = this.ctx;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.lineWidth = width; c.strokeStyle = stroke;
    if (dash) c.setLineDash(dash);
    c.stroke();
    if (dash) c.setLineDash([]);
  }

  text(t: string, x: number, y: number, o: { color?: string; size?: number; align?: CanvasTextAlign; bold?: boolean; shadow?: boolean; baseline?: CanvasTextBaseline } = {}): void {
    const c = this.ctx;
    c.font = `${o.bold ? '600 ' : ''}${o.size ?? 12}px "Segoe UI", system-ui, sans-serif`;
    c.textAlign = o.align ?? 'center';
    c.textBaseline = o.baseline ?? 'middle';
    if (o.shadow !== false) { c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillText(t, x + 1, y + 1); }
    c.fillStyle = o.color ?? '#dfe7ef';
    c.fillText(t, x, y);
  }

  bar(x: number, y: number, w: number, h: number, frac: number, fg: string, bg = 'rgba(0,0,0,0.6)'): void {
    const c = this.ctx;
    c.fillStyle = bg; c.fillRect(x, y, w, h);
    c.fillStyle = fg; c.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  /** Small triangle icon pointing along angle (radians, screen space). */
  chevron(x: number, y: number, r: number, angle: number, fill: string, stroke = '#000'): void {
    const c = this.ctx;
    c.save(); c.translate(x, y); c.rotate(angle);
    c.beginPath(); c.moveTo(r, 0); c.lineTo(-r * 0.8, r * 0.7); c.lineTo(-r * 0.4, 0); c.lineTo(-r * 0.8, -r * 0.7); c.closePath();
    c.fillStyle = fill; c.fill(); c.lineWidth = 1; c.strokeStyle = stroke; c.stroke();
    c.restore();
  }
}
