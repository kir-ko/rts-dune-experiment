import type { FactionId } from '../types/index.js';

export interface FactionDef {
  name: string;
  /** hex color numbers for PixiJS */
  primary: number;
  secondary: number;
  accent: number;
  /** CSS hex for DOM elements */
  primaryCSS: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  atreides: {
    name: 'ATREIDES',
    primary:    0x3a78d8,
    secondary:  0x1a4a9a,
    accent:     0x88bcff,
    primaryCSS: '#3a78d8',
  },
  harkonnen: {
    name: 'HARKONNEN',
    primary:    0xcc2424,
    secondary:  0x7a1010,
    accent:     0xff7060,
    primaryCSS: '#cc2424',
  },
  ordos: {
    name: 'ORDOS',
    primary:    0x2c9c44,
    secondary:  0x1a5a26,
    accent:     0x80e090,
    primaryCSS: '#2c9c44',
  },
};

export const UNIT_NAMES: Record<FactionId, Record<string, string>> = {
  atreides:  { infantry:'TROOPER',  trike:'TRIKE',  tank:'COMBAT TANK', special:'SONIC TANK',  harvester:'HARVESTER', carryall:'CARRYALL', launcher:'MISSILE TANK', siegeTank:'SIEGE TANK', fremen:'FREMEN', ornithopter:'ORNITHOPTER' },
  harkonnen: { infantry:'TROOPER',  trike:'QUAD',   tank:'COMBAT TANK', special:'DEVASTATOR',  harvester:'HARVESTER', carryall:'CARRYALL', launcher:'ROCKET TANK',  siegeTank:'SIEGE TANK', sardaukar:'SARDAUKAR' },
  ordos:     { infantry:'TROOPER',  trike:'RAIDER', tank:'COMBAT TANK', special:'SABOTEUR',    harvester:'HARVESTER', carryall:'CARRYALL', launcher:'MRL',          stealthTank:'STEALTH TANK' },
};

// ── Faction perks: passive global modifiers ──────────────────────────────────
// These tilt the gameplay feel of each faction. Multipliers are applied on top
// of base unit/building stats. See statsFor() in constants/units.ts and the
// makeBuilding/power/refinery hooks.
export interface FactionPerks {
  /** Multiplier for building max HP (applied at construction). */
  buildingHpMul: number;
  /** Multiplier for Carryall HP specifically (in addition to unitHpMul). */
  carryallHpMul: number;
  /** Multiplier for unit max HP (applies to all units of this faction). */
  unitHpMul: number;
  /** Multiplier for unit damage. */
  unitDmgMul: number;
  /** Multiplier for unit speed. */
  unitSpeedMul: number;
  /** Multiplier for unit production cost. */
  unitCostMul: number;
  /** Multiplier for unit attack range. */
  unitRangeMul: number;
  /** Multiplier for unit sight (fog reveal). */
  unitSightMul: number;
  /** Power output of each Wind Trap (default 8). */
  windTrapPower: number;
  /** Multiplier for refinery storage cap. */
  refineryCapMul: number;
  /** Spice generated passively per second by EACH active refinery. */
  refineryPassiveSpice: number;
}

export const FACTION_PERKS: Record<FactionId, FactionPerks> = {
  // Atreides — discipline & precision: longer range, better sight, sturdier carryalls.
  atreides: {
    buildingHpMul:        1.0,
    carryallHpMul:        1.5,
    unitHpMul:            1.0,
    unitDmgMul:           1.0,
    unitSpeedMul:         1.0,
    unitCostMul:          1.0,
    unitRangeMul:         1.1,
    unitSightMul:         1.1,
    windTrapPower:        8,
    refineryCapMul:       1.0,
    refineryPassiveSpice: 0,
  },
  // Harkonnen — brute force & industry: tougher buildings, harder hits, slower.
  harkonnen: {
    buildingHpMul:        1.2,
    carryallHpMul:        1.0,
    unitHpMul:            1.0,
    unitDmgMul:           1.15,
    unitSpeedMul:         0.9,
    unitCostMul:          1.0,
    unitRangeMul:         1.0,
    unitSightMul:         1.0,
    windTrapPower:        10,
    refineryCapMul:       1.5,
    refineryPassiveSpice: 0,
  },
  // Ordos — cunning & economy: cheaper, faster, fragile.
  // Passive spice income removed — combined with unitCostMul 0.9 it created
  // a runaway snowball that other factions couldn't match.
  ordos: {
    buildingHpMul:        1.0,
    carryallHpMul:        1.0,
    unitHpMul:            0.95,
    unitDmgMul:           1.0,
    unitSpeedMul:         1.05,
    unitCostMul:          0.9,
    unitRangeMul:         1.0,
    unitSightMul:         1.0,
    windTrapPower:        12,
    refineryCapMul:       1.0,
    refineryPassiveSpice: 0,
  },
};
