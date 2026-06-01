import type { GameState, Unit } from '../types/index.js';
import { MAP_W, MAP_H } from '../constants/map.js';
import { findBuilding, buildingCenter } from '../state/gameState.js';
import { FACTION_PERKS } from '../constants/factions.js';
import { statsFor } from '../constants/units.js';
import { findPath, findFreeSpot } from './pathfinding.js';

/**
 * Find nearest spice tile.
 * If `restrictToFog` is true, only spice tiles that have been explored (fog ≥ 1) qualify.
 * AI ignores fog (sees the whole map); player respects it.
 */
export function findNearestSpice(
  state: GameState, x: number, y: number,
  restrictToFog = false,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const s = state.map[ty]![tx]!.spice;
      if (s <= 0) continue;
      if (restrictToFog && (state.fog[ty]?.[tx] ?? 0) < 1) continue;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
    }
  }
  return best;
}

/** Has any visible/explored spice on the map for this faction? */
export function hasKnownSpice(state: GameState, forPlayer: boolean): boolean {
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (state.map[ty]![tx]!.spice <= 0) continue;
      if (!forPlayer || (state.fog[ty]?.[tx] ?? 0) >= 1) return true;
    }
  }
  return false;
}

/** Move harvester along an A* path. Returns true on arrival. */
function moveTo(unit: Unit, dt: number, state: GameState): boolean {
  if (!unit.target) return false;
  const dx0 = unit.target.x - unit.x, dy0 = unit.target.y - unit.y;
  if (Math.hypot(dx0, dy0) < 0.15) {
    unit.x = unit.target.x; unit.y = unit.target.y;
    unit.target = null; unit.path = null;
    return true;
  }

  if (unit.pathRecomputeIn > 0) unit.pathRecomputeIn -= dt;

  const lastWp = unit.path?.[unit.path.length - 1];
  const needRecompute =
    !unit.path || unit.path.length === 0 || !lastWp ||
    Math.hypot(lastWp.x - unit.target.x, lastWp.y - unit.target.y) > 0.6;
  if (needRecompute && unit.pathRecomputeIn <= 0) {
    unit.path = findPath(state, unit.x, unit.y, unit.target.x, unit.target.y);
    unit.pathRecomputeIn = 1.5;
  }

  if (unit.path && unit.path.length > 0) {
    const wp = unit.path[0]!;
    const dx = wp.x - unit.x, dy = wp.y - unit.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) {
      unit.path.shift();
      if (unit.path.length === 0) { unit.target = null; unit.path = null; return true; }
      return false;
    }
    unit.dir = Math.atan2(dy, dx);
    const speed = statsFor(unit.faction, unit.kind).speed;
    const step = Math.min(speed * dt, d);
    unit.x += (dx / d) * step;
    unit.y += (dy / d) * step;
  }
  return false;
}

/**
 * Direct-chase movement for the harvester — used when chasing a moving enemy
 * unit (set via `attackTarget`). Bypasses A* (which only recomputes every 1.5s
 * and would leave the harvester stalled at a stale path's end while the target
 * keeps moving). Returns true if reached.
 */
function chaseStep(unit: Unit, dt: number): boolean {
  if (!unit.target) return false;
  const dx = unit.target.x - unit.x, dy = unit.target.y - unit.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.4) return true;
  unit.dir = Math.atan2(dy, dx);
  const speed = statsFor(unit.faction, unit.kind).speed;
  const step = Math.min(speed * dt, d);
  unit.x += (dx / d) * step;
  unit.y += (dy / d) * step;
  return false;
}

export function updateHarvester(unit: Unit, dt: number, state: GameState, powerRatio: number): void {
  const ref = findBuilding(unit.faction, 'refinery', state);
  if (!ref) return;
  // Dock approach point: just outside the right edge of the refinery, at the bottom row
  const refDest = { x: ref.tx + ref.w - 0.5, y: ref.ty + ref.h - 0.5 };

  if (unit.mode === 'moving') {
    // ── Chase a specific enemy unit (player ПКМ on enemy unit, or harvester
    // self-defence after being hit by crushable infantry). Update target each
    // tick to the chased unit's current position and use direct movement.
    if (unit.attackTarget != null) {
      const t = state.units.find(u => u.id === unit.attackTarget);
      if (!t || t.dead || t.carried || t.docked || t.faction === unit.faction) {
        // Target gone — drop the chase, fall through to normal moving (will
        // auto-find spice or stay parked).
        unit.attackTarget = null;
      } else {
        unit.target = { x: t.x, y: t.y };
        unit.path = null; // never use A* path while chasing
        chaseStep(unit, dt);
        // Crush check happens in updateCrush; if we're on top of them, they die.
        return;
      }
    }

    const reached = moveTo(unit, dt, state);
    const tx = Math.floor(unit.x), ty = Math.floor(unit.y);
    // While in transit: if we drive across a spice tile, start mining immediately.
    if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && (state.map[ty]![tx]!.spice > 0)) {
      unit.mode = 'mining'; return;
    }
    if (reached) {
      // Arrived at the player's destination. Branch on the terrain we landed on:
      //   - on spice         → 'mining' (handled above next tick by the spice check)
      //   - on rock          → STAY PUT (player parked us, e.g. sheltering from a worm).
      //                        Auto-mining is suppressed until a new order.
      //   - on sand (no spice) → auto-pick the nearest known spice patch and drive there.
      const txi = Math.floor(unit.x), tyi = Math.floor(unit.y);
      const tile = (txi >= 0 && tyi >= 0 && txi < MAP_W && tyi < MAP_H)
        ? state.map[tyi]?.[txi] : null;
      const onRock = tile?.type === 'rock';

      // Chase ended — clear attackTarget regardless of next decision.
      unit.attackTarget = null;

      if (onRock) {
        // Player explicitly parked on rock — sit still, do not auto-search for spice.
        unit.mode = 'idle';
        unit.target = null;
        unit.path = null;
        unit.parkedOnRock = true;
        return;
      }

      const respectFog = unit.faction === state.faction;
      const sp = findNearestSpice(state, unit.x, unit.y, respectFog);
      if (sp) {
        unit.target = sp;
        unit.mode = 'toSpice';
        unit.path = null;
      } else if (unit.spice > 0) {
        // No spice known but we have a partial load — bring it home
        unit.mode = 'toRefinery';
        unit.target = { ...refDest };
        unit.path = null;
      } else {
        unit.mode = 'idle';
      }
    }
    return;
  }

  // Player respects fog of war — only mines what it has seen.
  // AI sees everything (no fog applied to AI).
  const respectFog = unit.faction === state.faction;

  if (unit.mode === 'idle') {
    if (unit.spice >= 500) {
      // Full but somehow stuck idle — go deposit
      unit.mode = 'toRefinery'; unit.target = { ...refDest };
      unit.parkedOnRock = false;
      return;
    }
    // Parked-on-rock means the player explicitly drove us to rock terrain
    // (e.g. to shelter from a worm). Do nothing until a new order arrives.
    if (unit.parkedOnRock) return;

    const sp = findNearestSpice(state, unit.x, unit.y, respectFog);
    if (sp) {
      unit.target = sp; unit.mode = 'toSpice';
    } else if (unit.spice > 0) {
      // No known spice but we have a partial load — bring it back to refinery
      unit.mode = 'toRefinery'; unit.target = { ...refDest };
    }
    // else: idle with empty load and no known spice → wait (player needs to scout)
    return;
  }

  if (unit.mode === 'toSpice') {
    const reached = moveTo(unit, dt, state);
    const tx = Math.floor(unit.x), ty = Math.floor(unit.y);
    if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && (state.map[ty]![tx]!.spice > 0)) {
      unit.mode = 'mining';
    } else if (reached) {
      unit.mode = 'idle';
    }
    return;
  }

  if (unit.mode === 'mining') {
    const tx = Math.floor(unit.x), ty = Math.floor(unit.y);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || (state.map[ty]![tx]!.spice <= 0)) {
      // Tile depleted. Priority: keep mining as long as there's open spice on the map.
      // Only return to refinery when fully loaded OR no more known spice anywhere.
      if (unit.spice >= 500) {
        unit.mode = 'toRefinery'; unit.target = { ...refDest };
      } else {
        const sp = findNearestSpice(state, unit.x, unit.y, respectFog);
        if (sp) {
          unit.target = sp; unit.mode = 'toSpice';
        } else if (unit.spice > 0) {
          // No visible spice anywhere — bring what we have
          unit.mode = 'toRefinery'; unit.target = { ...refDest };
        } else {
          unit.mode = 'idle';
        }
      }
      return;
    }
    const tile = state.map[ty]![tx]!;
    const rate = 35 * dt * (0.5 + 0.5 * powerRatio);
    const got = Math.min(rate, tile.spice, 500 - unit.spice);
    unit.spice += got;
    tile.spice -= got;
    if (tile.spice <= 0) { tile.type = 'sand'; tile.v = (tx + ty) & 3; tile.spice = 0; }
    if (unit.spice >= 500) { unit.mode = 'toRefinery'; unit.target = { ...refDest }; }
    return;
  }

  if (unit.mode === 'toRefinery') {
    if (!unit.target) unit.target = { ...refDest };
    // Check arrival at dock (proximity, since path may stop short)
    const dist = Math.hypot(refDest.x - unit.x, refDest.y - unit.y);
    if (dist < 1.0) {
      // Dock! Teleport inside refinery footprint, hide harvester
      unit.x = ref.tx + ref.w - 0.5;
      unit.y = ref.ty + ref.h - 0.5;
      unit.docked = true;
      unit.mode = 'depositing';
      unit.depositTimer = 2.5;
      unit.target = null; unit.path = null;
      return;
    }
    moveTo(unit, dt, state);
    return;
  }

  if (unit.mode === 'depositing') {
    unit.depositTimer -= dt;
    if (unit.depositTimer <= 0) {
      // Faction storage cap is the global cap × the faction's refineryCapMul perk.
      // AI base cap is also boosted ×1.5 to keep autoplay viable on large maps.
      const playerCap = state.cap        * FACTION_PERKS[state.faction].refineryCapMul;
      const aiCap     = state.cap * 1.5  * FACTION_PERKS[state.aiFaction].refineryCapMul;
      if (unit.faction === state.faction) {
        state.spice = Math.min(playerCap, state.spice + Math.floor(unit.spice));
      } else {
        state.aiSpice = Math.min(aiCap, state.aiSpice + Math.floor(unit.spice));
      }
      unit.spice = 0;
      unit.depositTimer = 0;
      // Emerge from dock: find a free spot near refinery
      const exit = findFreeSpot(state, ref.tx + ref.w + 0.5, ref.ty + ref.h - 0.5);
      if (exit) { unit.x = exit.x; unit.y = exit.y; }
      unit.docked = false;
      unit.mode = 'idle';
      // Drop player command once delivered — auto-mining resumes
      unit.commandedReturn = false;
    }
  }
}
