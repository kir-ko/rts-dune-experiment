import type { GameState } from '../types/index.js';
import { statsFor } from '../constants/units.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { MAP_W, MAP_H } from '../constants/map.js';

function reveal(fog: Uint8Array[], cx: number, cy: number, r: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(MAP_W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(MAP_H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const row = fog[y]!;
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) row[x] = 2;
    }
  }
}

export function updateFog(state: GameState): void {
  const { fog, units, buildings, faction } = state;

  // Visible → explored
  for (let y = 0; y < MAP_H; y++) {
    const row = fog[y]!;
    for (let x = 0; x < MAP_W; x++) {
      if (row[x] === 2) row[x] = 1;
    }
  }

  // Re-mark visible from player units
  for (const u of units) {
    if (u.dead || u.carried || u.faction !== faction) continue;
    reveal(fog, u.x, u.y, statsFor(u.faction, u.kind).sight);
  }

  // Re-mark visible from player buildings
  for (const b of buildings) {
    if (b.dead || b.faction !== faction) continue;
    reveal(fog, b.tx + b.w / 2, b.ty + b.h / 2, BUILD_DEFS[b.kind].sight);
  }
}

export function fogAt(state: GameState, tx: number, ty: number): 0 | 1 | 2 {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 0;
  return (state.fog[ty]![tx] ?? 0) as 0 | 1 | 2;
}

export function isEntityVisible(state: GameState, cx: number, cy: number, r = 0): boolean {
  const pts: [number, number][] = [[cx, cy]];
  if (r > 0.5) {
    pts.push([cx - r, cy - r], [cx + r, cy - r], [cx - r, cy + r], [cx + r, cy + r]);
  }
  return pts.some(([x, y]) => fogAt(state, Math.floor(x), Math.floor(y)) === 2);
}
