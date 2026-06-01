import type { GameState } from '../types/index.js';
import { BUILD_DEFS, REPAIR_RATE, REPAIR_COST_PER_HP } from '../constants/buildings.js';
import { hasBuilding } from '../state/gameState.js';

/**
 * Slowly heal damaged buildings while their owner has a Construction Yard.
 * Repair costs spice from the owning side. Construction-phase buildings
 * heal via the production system; this only operates on completed buildings.
 */
export function updateRepair(state: GameState, dt: number): void {
  const playerHasYard = hasBuilding(state.faction, 'yard', state);
  const aiHasYard = hasBuilding(state.aiFaction, 'yard', state);

  for (const b of state.buildings) {
    if (b.dead || b.constructing) continue;
    if (b.hp >= b.maxHp) continue;

    const owned = b.faction === state.faction;
    if (owned && !playerHasYard) continue;
    if (!owned && !aiHasYard) continue;

    // Cap healing by available spice
    const def = BUILD_DEFS[b.kind];
    const heal = REPAIR_RATE * b.maxHp * dt;
    const cost = heal * REPAIR_COST_PER_HP * (def.cost / Math.max(def.hp, 1));

    if (owned) {
      if (state.spice < cost) continue;
      state.spice -= cost;
    } else {
      if (state.aiSpice < cost) continue;
      state.aiSpice -= cost;
    }

    b.hp = Math.min(b.maxHp, b.hp + heal);
  }
}
