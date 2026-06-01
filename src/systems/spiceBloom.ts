import type { GameState } from '../types/index.js';
import { MAP_W, MAP_H } from '../constants/map.js';

const BLOOM_INTERVAL = 28;       // base seconds between blooms
const BLOOM_RADIUS = 2;          // tiles
const BLOOM_SPICE = 60;          // per fresh tile
const BLOOM_HEAVY_SPICE = 110;   // for the centre tile

export function updateSpiceBlooms(state: GameState, dt: number): void {
  state.bloomTimer -= dt;
  if (state.bloomTimer > 0) return;
  state.bloomTimer = BLOOM_INTERVAL + Math.random() * 12;

  for (let tries = 0; tries < 24; tries++) {
    const cx = 6 + Math.floor(Math.random() * (MAP_W - 12));
    const cy = 6 + Math.floor(Math.random() * (MAP_H - 12));
    const t = state.map[cy]?.[cx];
    if (!t) continue;
    // Only on plain sand/dune
    if (t.type !== 'sand' && t.type !== 'dune') continue;
    // Keep clear of bases
    const tooClose = state.buildings.some(b => {
      if (b.dead) return false;
      return Math.hypot(b.tx + b.w / 2 - cx, b.ty + b.h / 2 - cy) < 7;
    });
    if (tooClose) continue;

    paintBloom(state, cx, cy);
    state.fx.push({ x: cx + 0.5, y: cy + 0.5, scale: 1.5, t: 0, life: 0.8, kind: 'bloom' });
    return;
  }
}

function paintBloom(state: GameState, cx: number, cy: number): void {
  for (let dy = -BLOOM_RADIUS; dy <= BLOOM_RADIUS; dy++) {
    for (let dx = -BLOOM_RADIUS; dx <= BLOOM_RADIUS; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const tile = state.map[y]![x]!;
      if (tile.type === 'rock') continue;
      const d = Math.hypot(dx, dy);
      if (d > BLOOM_RADIUS) continue;
      const heavy = d < 0.6;
      tile.type = heavy ? 'spice2' : 'spice';
      tile.spice = Math.max(tile.spice, heavy ? BLOOM_HEAVY_SPICE : BLOOM_SPICE);
    }
  }
}
