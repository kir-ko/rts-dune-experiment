import type { GameState, Unit } from '../types/index.js';

// Tracked / heavy enough to crush foot units when running them over.
// Trikes (Atreides Trike / Harkonnen Quad / Ordos Raider) are all wheeled
// machines — they do NOT crush, even the Harkonnen Quad.
export function isCrusher(u: Unit): boolean {
  if (u.kind === 'tank' || u.kind === 'siegeTank') return true;
  if (u.kind === 'harvester') return true;
  if (u.kind === 'launcher' || u.kind === 'stealthTank') return true;
  // Atreides Sonic Tank, Harkonnen Devastator → tracked.
  // Ordos special is the Saboteur (foot kamikaze) — explicitly excluded.
  if (u.kind === 'special' && u.faction !== 'ordos') return true;
  return false;
}

// On-foot units that can be flattened.
export function isCrushable(u: Unit): boolean {
  if (u.kind === 'infantry' || u.kind === 'fremen' || u.kind === 'sardaukar') return true;
  // Ordos special = Saboteur — foot unit
  if (u.kind === 'special' && u.faction === 'ordos') return true;
  return false;
}

const CRUSH_RADIUS = 0.45;
/** Lifetime of a corpse FX before it fades away. */
const CORPSE_LIFE = 3.5;

/**
 * One pass per tick — for each crusher, kill any enemy crushable unit it is
 * sitting on top of. Spawns a corpse effect that lingers for ~3.5s and fades.
 *
 * Friendly units are NOT crushed (player would otherwise self-grief by walking
 * tanks through their own infantry).
 */
export function updateCrush(state: GameState): void {
  for (const c of state.units) {
    if (c.dead || c.carried || c.docked) continue;
    if (!isCrusher(c)) continue;

    for (const v of state.units) {
      if (v.dead || v.carried || v.docked) continue;
      if (v.id === c.id) continue;
      if (v.faction === c.faction) continue;
      if (!isCrushable(v)) continue;

      const d = Math.hypot(v.x - c.x, v.y - c.y);
      if (d < CRUSH_RADIUS) {
        v.dead = true;
        state.fx.push({
          x: v.x, y: v.y, scale: 1, t: 0, life: CORPSE_LIFE,
          kind: 'corpse', faction: v.faction,
        });
      }
    }
  }
}
