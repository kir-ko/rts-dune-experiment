import type { Tile } from '../types/index.js';
import { MAP_W, MAP_H } from '../constants/map.js';

function rng(seed: number) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 1000) / 1000; };
}

function plateau(m: Tile[][], cx: number, cy: number, rad: number, rand: () => number): void {
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      if (Math.hypot(x - cx, y - cy) < rad - 0.3 - rand() * 0.7) {
        m[y]![x] = { type: 'rock', v: (x + y) % 3, spice: 0 };
      }
    }
  }
}

function spiceField(m: Tile[][], cx: number, cy: number, rad: number, heavy: boolean): void {
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const t = m[y]![x]!;
      if (t.type !== 'sand' && t.type !== 'dune') continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < rad) {
        const isHeavy = heavy && d < rad * 0.5;
        t.type = isHeavy ? 'spice2' : 'spice';
        t.spice = isHeavy ? 100 : 50;
      }
    }
  }
}

/**
 * Mirror a point through the map centre (point-symmetry around (MAP_W/2, MAP_H/2)).
 * The two Construction Yards are placed symmetric around this same centre, so a
 * spice patch and its mirror end up exactly the same distance from each base.
 *   Player yard centre: (8, 6) → mirror → (MAP_W-8, MAP_H-6) = AI yard centre.
 */
function mirror(x: number, y: number): [number, number] {
  return [MAP_W - x, MAP_H - y];
}

export function generateMap(): Tile[][] {
  const m: Tile[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < MAP_W; x++) {
      row.push({ type: 'sand', v: (x * 7 + y * 13 + x * y) & 3, spice: 0 });
    }
    m.push(row);
  }

  const r = rng(424242);

  // Dunes — density scaled with map area
  const duneCount = Math.floor((MAP_W * MAP_H) * 0.05);
  for (let i = 0; i < duneCount; i++) {
    const x = Math.floor(r() * MAP_W), y = Math.floor(r() * MAP_H);
    if (m[y]![x]!.type === 'sand') m[y]![x]!.type = 'dune';
  }

  // ── Base plateaus ───────────────────────────────────────────
  // Player base: (7, 5). AI base: (MAP_W-9, MAP_H-7). Both 2×2.
  // Plateau under each base, sized for buildings + a little buffer.
  plateau(m, 7,          6,          6, r);
  plateau(m, MAP_W - 8,  MAP_H - 7,  6, r);

  // ── Random outcrops, point-symmetric so neither side has more cover ──
  // Outcrop count scales with map area so large maps don't feel barren.
  const outcropPairs = Math.max(4, Math.round((MAP_W * MAP_H) / 800));
  for (let i = 0; i < outcropPairs; i++) {
    const cx = 14 + Math.floor(r() * (MAP_W / 2 - 18));
    const cy = 8  + Math.floor(r() * (MAP_H - 16));
    const rad = 1 + Math.floor(r() * 3);
    plateau(m, cx, cy, rad, r);
    const [mx, my] = mirror(cx, cy);
    plateau(m, mx, my, rad, r);
  }

  // ── Spice fields ─────────────────────────────────────────────
  // Positions are stored as fractions of map width / height so the layout
  // stays balanced across small / medium / large map sizes.
  type SpiceSpot = { xf: number; yf: number; rad: number; heavy: boolean };
  const playerSideSpice: SpiceSpot[] = [
    // Near-base patch — early-game economy
    { xf: 0.19, yf: 0.27, rad: 3, heavy: false },
    // Mid-distance heavy patch — main income mid-game
    { xf: 0.29, yf: 0.42, rad: 3, heavy: true  },
    // Forward / outer patch — encourages map control
    { xf: 0.17, yf: 0.62, rad: 3, heavy: false },
    // Far-side small patch — risky, far from base
    { xf: 0.38, yf: 0.19, rad: 2, heavy: false },
  ];
  for (const s of playerSideSpice) {
    const sx = Math.round(s.xf * MAP_W);
    const sy = Math.round(s.yf * MAP_H);
    spiceField(m, sx, sy, s.rad, s.heavy);
    const [mx, my] = mirror(sx, sy);
    spiceField(m, mx, my, s.rad, s.heavy);
  }

  // Central contested heavy deposit (large, equally far from both bases)
  spiceField(m, Math.floor(MAP_W / 2), Math.floor(MAP_H / 2), 5, true);

  return m;
}
