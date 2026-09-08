import type { GameState, Lane, Planet } from './types';

const adjCache = new WeakMap<Lane[], { n: number; m: Map<number, { to: number; len: number }[]> }>();

export function adjacency(lanes: Lane[]): Map<number, { to: number; len: number }[]> {
  const cached = adjCache.get(lanes);
  if (cached && cached.n === lanes.length) return cached.m;
  const m = new Map<number, { to: number; len: number }[]>();
  for (const l of lanes) {
    if (!m.has(l.a)) m.set(l.a, []);
    if (!m.has(l.b)) m.set(l.b, []);
    m.get(l.a)!.push({ to: l.b, len: l.length });
    m.get(l.b)!.push({ to: l.a, len: l.length });
  }
  adjCache.set(lanes, { n: lanes.length, m });
  return m;
}

export function neighbors(s: GameState, planet: number): number[] {
  return (adjacency(s.lanes).get(planet) ?? []).map(n => n.to);
}

export function laneBetween(s: GameState, a: number, b: number): Lane | undefined {
  return s.lanes.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

/** Dijkstra shortest path. Returns planet ids from start to goal inclusive, or null. */
export function findPath(lanes: Lane[], start: number, goal: number): number[] | null {
  if (start === goal) return [start];
  const adj = adjacency(lanes);
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const open = new Set<number>([start]);
  dist.set(start, 0);
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const n of open) { const d = dist.get(n)!; if (d < best) { best = d; cur = n; } }
    open.delete(cur);
    if (cur === goal) break;
    for (const e of adj.get(cur) ?? []) {
      const nd = best + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, cur);
        open.add(e.to);
      }
    }
  }
  if (!dist.has(goal)) return null;
  const path = [goal];
  let c = goal;
  while (c !== start) { c = prev.get(c)!; path.push(c); }
  return path.reverse();
}

export function pathLength(lanes: Lane[], path: number[]): number {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const l = lanes.find(x => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    total += l ? l.length : 0;
  }
  return total;
}

/** Graph hops (BFS) from a planet to every other planet. */
export function hopDistances(lanes: Lane[], start: number): Map<number, number> {
  const adj = adjacency(lanes);
  const d = new Map<number, number>([[start, 0]]);
  const q = [start];
  while (q.length) {
    const c = q.shift()!;
    for (const e of adj.get(c) ?? []) {
      if (!d.has(e.to)) { d.set(e.to, d.get(c)! + 1); q.push(e.to); }
    }
  }
  return d;
}

export function distance(a: Planet, b: Planet): number {
  const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
