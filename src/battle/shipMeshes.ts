import * as THREE from 'three';
import type { ShipClass } from '../sim/ships';
import type { FactionId } from '../sim/types';

export const FACTION_COLOR: Record<FactionId, number> = { empire: 0x4fa3ff, rebellion: 0xff8c42 };
export const FACTION_CSS: Record<FactionId, string> = { empire: '#4fa3ff', rebellion: '#ff8c42' };

const matCache = new Map<string, THREE.Material>();
function mat(color: number, o: { emissive?: number; metal?: number; rough?: number; emissiveIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}-${o.emissive ?? 0}-${o.metal ?? 0.6}-${o.rough ?? 0.5}-${o.emissiveIntensity ?? 1}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: o.metal ?? 0.6, roughness: o.rough ?? 0.5, emissive: o.emissive ?? 0, emissiveIntensity: o.emissiveIntensity ?? 1 });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function cyl(rt: number, rb: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(geo(`cyl${rt},${rb},${len},${seg}`, () => new THREE.CylinderGeometry(rt, rb, len, seg).rotateX(Math.PI / 2)), m);
  mesh.position.set(x, y, z);
  return mesh;
}
/** Flat wedge with the nose at +Z. */
function wedge(w: number, h: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo(`wedge${w},${h},${len}`, () => {
    const g = new THREE.ConeGeometry(1, 1, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(w, h, len);
    return g;
  }), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Builds a low-poly ship. Nose points along +Z so Object3D.lookAt() aims it.
 * Meshes are roughly 1 unit long before `cls.scale` is applied.
 */
export function buildShipMesh(cls: ShipClass, faction: FactionId): THREE.Group {
  const g = new THREE.Group();
  const emp = faction === 'empire';
  const hull = emp ? mat(0x9aa3ad, { metal: 0.7, rough: 0.45 }) : mat(0xd9cbb0, { metal: 0.4, rough: 0.6 });
  const dark = emp ? mat(0x4a5560) : mat(0x6b5a48);
  const accent = mat(FACTION_COLOR[faction], { emissive: FACTION_COLOR[faction], emissiveIntensity: 0.8 });
  const engine = mat(emp ? 0x7fd3ff : 0xffb070, { emissive: emp ? 0x3fa0ff : 0xff7a2a, emissiveIntensity: 2, metal: 0, rough: 1 });

  switch (cls.shape) {
    case 'fighter': {
      if (emp) {
        g.add(cyl(0.22, 0.22, 0.6, dark, 0, 0, 0, 8));
        g.add(box(0.05, 0.9, 0.7, hull, 0.45, 0, 0));
        g.add(box(0.05, 0.9, 0.7, hull, -0.45, 0, 0));
        g.add(box(0.5, 0.05, 0.05, dark, 0, 0, 0));
        g.add(box(0.15, 0.15, 0.06, engine, 0, 0, -0.32));
      } else {
        g.add(cyl(0.12, 0.2, 1.1, hull, 0, 0, 0.05, 8));
        for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const w = box(0.6, 0.04, 0.35, hull, sx * 0.4, sy * 0.12, -0.2);
          w.rotation.z = sy * sx * 0.25;
          g.add(w);
          g.add(box(0.06, 0.06, 0.1, engine, sx * 0.62, sy * 0.2, -0.38));
        }
        g.add(box(0.3, 0.05, 0.15, accent, 0, 0.11, 0.2));
      }
      break;
    }
    case 'interceptor': {
      if (emp) {
        g.add(cyl(0.22, 0.22, 0.6, dark, 0, 0, 0, 8));
        for (const sx of [1, -1]) {
          g.add(box(0.05, 0.5, 0.9, hull, sx * 0.45, 0, 0));
          const fin1 = box(0.05, 0.45, 0.4, hull, sx * 0.45, 0.4, 0.15); fin1.rotation.x = -0.5; g.add(fin1);
          const fin2 = box(0.05, 0.45, 0.4, hull, sx * 0.45, -0.4, 0.15); fin2.rotation.x = 0.5; g.add(fin2);
        }
        g.add(box(0.5, 0.05, 0.05, dark, 0, 0, 0));
        g.add(box(0.15, 0.15, 0.06, engine, 0, 0, -0.32));
      } else {
        g.add(wedge(0.5, 0.14, 1.1, hull, 0, 0, 0.1));
        g.add(box(0.7, 0.05, 0.35, hull, 0, 0, -0.35));
        g.add(box(0.1, 0.1, 0.08, engine, 0.22, 0, -0.55));
        g.add(box(0.1, 0.1, 0.08, engine, -0.22, 0, -0.55));
        g.add(box(0.25, 0.05, 0.3, accent, 0, 0.08, 0.1));
      }
      break;
    }
    case 'bomber': {
      if (emp) {
        g.add(cyl(0.2, 0.2, 0.7, dark, 0.22, 0, 0, 8));
        g.add(box(0.36, 0.3, 0.9, dark, -0.22, 0, 0));
        g.add(box(0.05, 0.9, 0.8, hull, 0.55, 0, 0));
        g.add(box(0.05, 0.9, 0.8, hull, -0.55, 0, 0));
        g.add(box(0.15, 0.15, 0.06, engine, 0.22, 0, -0.37));
        g.add(box(0.15, 0.15, 0.06, engine, -0.22, 0, -0.47));
        break;
      }
      g.add(cyl(0.18, 0.24, 1.2, hull, 0, 0, 0, 8));
      g.add(cyl(0.12, 0.12, 0.8, dark, 0.4, 0, -0.25, 8));
      g.add(cyl(0.12, 0.12, 0.8, dark, -0.4, 0, -0.25, 8));
      g.add(box(0.7, 0.05, 0.3, hull, 0, 0, -0.2));
      g.add(box(0.1, 0.1, 0.06, engine, 0.4, 0, -0.68));
      g.add(box(0.1, 0.1, 0.06, engine, -0.4, 0, -0.68));
      g.add(box(0.2, 0.06, 0.3, accent, 0, 0.2, 0.1));
      break;
    }
    case 'corvette': {
      if (emp) {
        g.add(wedge(0.5, 0.25, 1.6, hull, 0, 0, 0));
        g.add(box(0.3, 0.2, 0.4, dark, 0, 0.15, -0.4));
        g.add(box(0.12, 0.12, 0.08, engine, 0.15, 0, -0.82));
        g.add(box(0.12, 0.12, 0.08, engine, -0.15, 0, -0.82));
      } else {
        g.add(cyl(0.18, 0.28, 1.6, hull, 0, 0, 0, 10));
        g.add(box(0.7, 0.12, 0.5, hull, 0, 0, -0.35));
        g.add(box(0.2, 0.3, 0.3, dark, 0, 0.2, -0.3));
        g.add(box(0.14, 0.14, 0.08, engine, 0.3, 0, -0.62));
        g.add(box(0.14, 0.14, 0.08, engine, -0.3, 0, -0.62));
        g.add(box(0.45, 0.05, 0.12, accent, 0, 0.16, 0.3));
      }
      break;
    }
    case 'frigate': {
      if (emp) {
        g.add(wedge(0.7, 0.22, 2.2, hull, 0, 0, 0));
        g.add(box(0.5, 0.18, 1.0, hull, 0, 0.16, -0.5));
        g.add(box(0.3, 0.25, 0.3, dark, 0, 0.36, -0.7));
        if (cls.interdictor) {
          // four gravity-well projector domes
          const domeMat = mat(0x6a7480, { emissive: 0x3060a0, emissiveIntensity: 0.6, metal: 0.5, rough: 0.5 });
          for (const [x, z] of [[0.28, 0.1], [-0.28, 0.1], [0.28, -0.6], [-0.28, -0.6]]) {
            const d = new THREE.Mesh(geo('dome', () => new THREE.SphereGeometry(0.16, 12, 8)), domeMat);
            d.position.set(x, 0.22, z);
            g.add(d);
          }
        }
        for (const x of [-0.2, 0, 0.2]) g.add(box(0.12, 0.12, 0.1, engine, x, 0, -1.12));
        g.add(box(0.08, 0.08, 0.3, dark, 0.25, 0.1, 0.2));
        g.add(box(0.08, 0.08, 0.3, dark, -0.25, 0.1, 0.2));
      } else {
        g.add(cyl(0.22, 0.32, 2.2, hull, 0, 0, 0, 12));
        g.add(cyl(0.18, 0.18, 1.2, dark, 0.45, -0.05, -0.3, 8));
        g.add(cyl(0.18, 0.18, 1.2, dark, -0.45, -0.05, -0.3, 8));
        g.add(box(0.9, 0.08, 0.6, hull, 0, 0, -0.3));
        g.add(box(0.3, 0.3, 0.5, hull, 0, 0.3, -0.5));
        g.add(box(0.16, 0.16, 0.08, engine, 0.45, -0.05, -0.92));
        g.add(box(0.16, 0.16, 0.08, engine, -0.45, -0.05, -0.92));
        g.add(box(0.14, 0.14, 0.08, engine, 0, 0, -1.12));
        g.add(box(0.5, 0.05, 0.1, accent, 0, 0.28, 0.4));
      }
      break;
    }
    case 'capital': {
      if (emp) {
        g.add(wedge(1.0, 0.28, 2.6, hull, 0, 0, 0));
        g.add(wedge(0.7, 0.2, 1.6, hull, 0, 0.2, -0.5));
        g.add(box(0.45, 0.3, 0.5, dark, 0, 0.45, -0.85));
        g.add(box(0.15, 0.25, 0.15, dark, 0.22, 0.7, -0.9));
        g.add(box(0.15, 0.25, 0.15, dark, -0.22, 0.7, -0.9));
        for (const x of [-0.35, -0.12, 0.12, 0.35]) g.add(box(0.16, 0.16, 0.1, engine, x, 0.02, -1.32));
        for (const [x, z] of [[0.35, 0.1], [-0.35, 0.1], [0.25, 0.6], [-0.25, 0.6]]) g.add(box(0.1, 0.1, 0.2, dark, x, 0.16, z));
      } else {
        g.add(cyl(0.3, 0.5, 2.6, hull, 0, 0, 0, 14));
        g.add(cyl(0.55, 0.45, 0.7, hull, 0, 0, -0.9, 14));
        g.add(cyl(0.2, 0.2, 1.4, dark, 0.7, 0, -0.2, 8));
        g.add(cyl(0.2, 0.2, 1.4, dark, -0.7, 0, -0.2, 8));
        g.add(box(1.4, 0.1, 0.5, hull, 0, 0, -0.3));
        g.add(box(0.4, 0.4, 0.5, hull, 0, 0.5, -0.6));
        for (const x of [-0.7, -0.25, 0, 0.25, 0.7]) g.add(box(0.16, 0.16, 0.1, engine, x, 0, x === 0 || Math.abs(x) === 0.25 ? -1.3 : -0.92));
        g.add(box(0.7, 0.06, 0.12, accent, 0, 0.5, 0.3));
        for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.2, 0.9], [-0.2, 0.9]]) g.add(box(0.1, 0.1, 0.2, dark, x, 0.3, z));
      }
      break;
    }
    case 'transport': {
      g.add(box(0.5, 0.4, 1.4, hull, 0, 0, 0));
      g.add(box(0.3, 0.3, 0.4, dark, 0, 0.1, 0.8));
      g.add(cyl(0.2, 0.2, 1.0, dark, 0.4, 0, -0.2, 8));
      g.add(cyl(0.2, 0.2, 1.0, dark, -0.4, 0, -0.2, 8));
      g.add(box(0.14, 0.14, 0.08, engine, 0.4, 0, -0.72));
      g.add(box(0.14, 0.14, 0.08, engine, -0.4, 0, -0.72));
      g.add(box(0.5, 0.05, 0.3, accent, 0, 0.21, 0));
      break;
    }
    case 'platform': {
      g.add(new THREE.Mesh(geo('octa', () => new THREE.OctahedronGeometry(0.6, 0)), hull));
      const ring = new THREE.Mesh(geo('ring', () => new THREE.TorusGeometry(0.9, 0.07, 6, 24)), dark);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      for (const a of [0, 1, 2, 3]) {
        const t = box(0.15, 0.15, 0.4, dark, Math.cos(a * Math.PI / 2) * 0.9, 0, Math.sin(a * Math.PI / 2) * 0.9);
        g.add(t);
      }
      g.add(box(0.2, 0.2, 0.2, accent, 0, 0.55, 0));
      g.add(box(0.2, 0.2, 0.2, accent, 0, -0.55, 0));
      break;
    }
  }
  g.scale.setScalar(cls.scale * 1.6);
  return g;
}

export function makeStarfield(count: number, radius: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(t) * radius; pos[i * 3 + 1] = u * radius; pos[i * 3 + 2] = r * Math.sin(t) * radius;
    const b = 0.5 + Math.random() * 0.5;
    const tint = Math.random();
    col[i * 3] = b * (tint < 0.3 ? 0.8 : 1); col[i * 3 + 1] = b * 0.95; col[i * 3 + 2] = b * (tint > 0.7 ? 0.85 : 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
}

const PLANET_COLORS: Record<string, number> = { terran: 0x3f8f5a, ocean: 0x2f6fc0, desert: 0xc9a25a, ice: 0xcfe3f0, volcanic: 0xb0432a, gas: 0xb9905e, barren: 0x7d7a74, jungle: 0x2f7a3f, city: 0xc8b478 };
export function planetColor(type: string): number { return PLANET_COLORS[type] ?? 0x888888; }
