import * as THREE from 'three';

export interface OrbitOptions { distance: number; minDistance: number; maxDistance: number; yaw?: number; pitch?: number; fov?: number; near?: number; far?: number }

/** Orbit camera with smoothed target/distance, used by both the galaxy map and tactical battles. */
export class OrbitCamera {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  private goalTarget = new THREE.Vector3();
  yaw: number;
  pitch: number;
  distance: number;
  private goalDistance: number;
  minDistance: number;
  maxDistance: number;

  constructor(aspect: number, o: OrbitOptions) {
    this.camera = new THREE.PerspectiveCamera(o.fov ?? 50, aspect, o.near ?? 0.5, o.far ?? 5000);
    this.distance = this.goalDistance = o.distance;
    this.minDistance = o.minDistance; this.maxDistance = o.maxDistance;
    this.yaw = o.yaw ?? 0.6; this.pitch = o.pitch ?? 0.9;
    this.update(1);
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.08, Math.min(1.52, this.pitch + dy * 0.006));
  }

  /** Pan the target along the horizontal (XZ) plane in screen-relative directions. */
  pan(dx: number, dy: number): void {
    const k = this.distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.goalTarget.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
  }

  /** Multiply the goal distance (pinch zoom): factor < 1 zooms in. */
  zoomBy(factor: number): void {
    this.setGoalDistance(this.goalDistance * factor);
  }
  setGoalDistance(d: number): void {
    this.goalDistance = Math.max(this.minDistance, Math.min(this.maxDistance, d));
  }
  get goalDist(): number { return this.goalDistance; }
  setOrbit(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = Math.max(0.08, Math.min(1.52, pitch));
  }

  zoom(delta: number): void {
    this.goalDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.goalDistance * Math.exp(delta * 0.0012)));
  }

  focusOn(p: THREE.Vector3, distance?: number): void {
    this.goalTarget.copy(p);
    if (distance !== undefined) this.goalDistance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
  }

  snap(): void { this.target.copy(this.goalTarget); this.distance = this.goalDistance; }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goalTarget, k);
    this.distance += (this.goalDistance - this.distance) * k;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * sp,
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
  }

  setAspect(a: number): void { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** Ray from screen point (in CSS px) into the world. */
  ray(x: number, y: number, w: number, h: number): THREE.Ray {
    const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }
}
