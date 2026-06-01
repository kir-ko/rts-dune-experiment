/**
 * A* pathfinding on the tile grid, navigating around buildings.
 * findPath() is called once per unit when a new move order is issued.
 */
import type { GameState } from '../types/index.js';
import { MAP_W, MAP_H } from '../constants/map.js';

// ── Blocked grid (buildings only) ────────────────────────────
// Cached per-call — rebuilt from scratch each time (fast enough: ~20 buildings × 4 tiles)
function buildBlockedGrid(state: GameState): Uint8Array {
  const grid = new Uint8Array(MAP_W * MAP_H);
  for (const b of state.buildings) {
    if (b.dead) continue;
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const tx = b.tx + dx, ty = b.ty + dy;
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) {
          grid[ty * MAP_W + tx] = 1;
        }
      }
    }
  }
  return grid;
}

// ── Minimal binary min-heap ───────────────────────────────────
class MinHeap {
  private data: [number, number][] = [];
  push(f: number, node: number): void {
    this.data.push([f, node]);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p]![0] <= this.data[i]![0]) break;
      [this.data[p], this.data[i]] = [this.data[i]!, this.data[p]!];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    if (!this.data.length) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length) {
      this.data[0] = last;
      let i = 0;
      for (;;) {
        let s = i;
        const l = 2 * i + 1, r = 2 * i + 2, n = this.data.length;
        if (l < n && this.data[l]![0] < this.data[s]![0]) s = l;
        if (r < n && this.data[r]![0] < this.data[s]![0]) s = r;
        if (s === i) break;
        [this.data[i], this.data[s]] = [this.data[s]!, this.data[i]!];
        i = s;
      }
    }
    return top;
  }
  get size(): number { return this.data.length; }
}

// 8-directional deltas with costs
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

/**
 * Find a tile path from (sx,sy) to (gx,gy) avoiding buildings.
 * Returns waypoints as tile-centre coordinates; last element is exact (gx,gy).
 * Falls back to [{x:gx,y:gy}] (direct move) if no path found within MAX_NODES.
 */
export function findPath(
  state: GameState,
  sx: number, sy: number,
  gx: number, gy: number,
): { x: number; y: number }[] {
  const isx = Math.floor(sx), isy = Math.floor(sy);
  let igx = Math.floor(gx), igy = Math.floor(gy);

  const blocked = buildBlockedGrid(state);

  // If goal tile is blocked, nudge to nearest free neighbour
  if (blocked[igy * MAP_W + igx]) {
    let found = false;
    outer: for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = igx + dx, ny = igy + dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && !blocked[ny * MAP_W + nx]) {
            igx = nx; igy = ny; found = true; break outer;
          }
        }
      }
    }
    if (!found) return [{ x: gx, y: gy }];
  }

  if (isx === igx && isy === igy) return [{ x: gx, y: gy }];

  const INF = 1e9;
  const g = new Float32Array(MAP_W * MAP_H).fill(INF);
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
  const startIdx = isy * MAP_W + isx;
  const goalIdx  = igy * MAP_W + igx;

  g[startIdx] = 0;
  const open = new MinHeap();
  open.push(Math.hypot(isx - igx, isy - igy), startIdx);

  const MAX_NODES = 4000;
  let explored = 0;

  while (open.size > 0 && explored < MAX_NODES) {
    const item = open.pop()!;
    const cur = item[1];
    explored++;

    if (cur === goalIdx) {
      // Reconstruct path (skip start tile)
      const path: { x: number; y: number }[] = [];
      let node = cur;
      while (node !== startIdx) {
        const nx = node % MAP_W, ny = Math.floor(node / MAP_W);
        path.push({ x: nx + 0.5, y: ny + 0.5 });
        const p = prev[node];
        if (p === undefined || p < 0) break;
        node = p;
      }
      path.reverse();
      if (path.length > 0) path[path.length - 1] = { x: gx, y: gy };
      return path;
    }

    const cx = cur % MAP_W, cy = Math.floor(cur / MAP_W);

    for (const [ddx, ddy, cost] of DIRS) {
      const nx = cx + ddx, ny = cy + ddy;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      const nIdx = ny * MAP_W + nx;
      if (blocked[nIdx]) continue;
      // Prevent cutting corners through diagonal building gaps
      if (ddx !== 0 && ddy !== 0) {
        if (blocked[cy * MAP_W + nx] || blocked[ny * MAP_W + cx]) continue;
      }
      const ng = g[cur]! + cost;
      if (ng < g[nIdx]!) {
        g[nIdx] = ng;
        prev[nIdx] = cur;
        open.push(ng + Math.hypot(nx - igx, ny - igy), nIdx);
      }
    }
  }

  // No path found within budget — direct move fallback
  return [{ x: gx, y: gy }];
}

/**
 * Find nearest tile not occupied by any building, searching outward from (x,y).
 * Returns tile-centre coords, or null if nothing found within radius 8.
 */
export function findFreeSpot(
  state: GameState,
  x: number, y: number,
): { x: number; y: number } | null {
  const blocked = buildBlockedGrid(state);
  const cx = Math.floor(x), cy = Math.floor(y);
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
        if (blocked[ny * MAP_W + nx]) continue;
        const density = state.units.filter(u =>
          !u.dead && !u.carried &&
          Math.floor(u.x) === nx && Math.floor(u.y) === ny,
        ).length;
        if (density < 2) return { x: nx + 0.5, y: ny + 0.5 };
      }
    }
  }
  return null;
}
