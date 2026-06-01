import type { FactionId, GameState, PowerStats } from '../types/index.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { FACTION_PERKS } from '../constants/factions.js';

export function powerOf(faction: FactionId, state: GameState): PowerStats {
  let prod = 0, cons = 0;
  // Wind Trap output is faction-specific (Atreides 8 / Harkonnen 10 / Ordos 12)
  const windOutput = FACTION_PERKS[faction].windTrapPower;
  for (const b of state.buildings) {
    if (b.dead || b.constructing || b.faction !== faction) continue;
    const p = BUILD_DEFS[b.kind].power;
    if (b.kind === 'wind') {
      prod += windOutput;
    } else if (p > 0) {
      prod += p;
    } else {
      cons += -p;
    }
  }
  const ratio = cons === 0 ? 1 : Math.min(1, prod / cons);
  return { prod, cons, ratio };
}
