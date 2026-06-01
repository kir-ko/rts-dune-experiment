import type { UnitKind, ProjectileKind, FactionId } from '../types/index.js';
import { FACTION_PERKS } from './factions.js';

export interface UnitDef {
  hp: number;
  dmg: number;
  range: number;
  /** tiles per second */
  speed: number;
  cost: number;
  splash: number;
  /** tile radius for fog reveal */
  sight: number;
  projectile: ProjectileKind | null;
  /** seconds between shots */
  cd: number;
  /** seconds to produce */
  buildTime: number;
  fly: boolean;
  /** 0–1 hit probability at maximum range; most units = 1.0 */
  accuracy: number;
  /** Can target flying units (carryall, ornithopter). Default false. */
  antiAir?: boolean;
  /** Tile distance enemies must be within to see this unit (stealth). 0 = always visible. */
  stealthRange?: number;
}

// Base stats for all units. The 'special' row is overridden per faction
// via SPECIAL_STATS — see statsFor() below.
export const UNIT_STATS: Record<UnitKind, UnitDef> = {
  infantry:  { hp:70,  dmg:7,  range:2.5, speed:1.6, cost:50,  splash:0,   sight:5, projectile:'bullet', cd:0.85, buildTime:4,  fly:false, accuracy:1 },
  trike:     { hp:100, dmg:12, range:3.5, speed:3.6, cost:140, splash:0,   sight:7, projectile:'bullet', cd:0.55, buildTime:6,  fly:false, accuracy:1 },
  tank:      { hp:260, dmg:34, range:4.5, speed:1.8, cost:280, splash:0.5, sight:6, projectile:'shell',  cd:1.5,  buildTime:10, fly:false, accuracy:1 },
  // 'special' = generic placeholder; real stats come from SPECIAL_STATS[faction]
  special:   { hp:340, dmg:60, range:5.5, speed:1.4, cost:600, splash:1.4, sight:6, projectile:'sonic',  cd:2.2,  buildTime:14, fly:false, accuracy:1 },
  harvester: { hp:320, dmg:0,  range:0,   speed:1.2, cost:300, splash:0,   sight:4, projectile:null,     cd:0,    buildTime:8,  fly:false, accuracy:1 },
  carryall:  { hp:160, dmg:0,  range:0,   speed:5.5, cost:500, splash:0,   sight:8, projectile:null,     cd:0,    buildTime:10, fly:true,  accuracy:1 },
  launcher:    { hp:180, dmg:55, range:6.5, speed:1.2, cost:550, splash:0.8, sight:6, projectile:'rocket', cd:2.0, buildTime:14, fly:false, accuracy:0.85, antiAir:true },
  // Ordos — Stealth Tank: invisible until within 3 tiles, mini-rockets, anti-air.
  stealthTank: { hp:130, dmg:32, range:5.0, speed:2.4, cost:380, splash:0.3, sight:6, projectile:'rocket', cd:1.6, buildTime:12, fly:false, accuracy:1, antiAir:true, stealthRange:3 },
  // Atreides + Harkonnen — Siege Tank: heavy long-range artillery with twin barrels.
  siegeTank:   { hp:380, dmg:50, range:5.5, speed:1.0, cost:500, splash:0.7, sight:6, projectile:'shell',  cd:2.4, buildTime:16, fly:false, accuracy:1 },
  // Atreides — Fremen: elite desert warrior, summoned by Palace (cannot be built normally).
  // Faster, tougher, stronger than infantry. Partial stealth (2 tiles).
  fremen:      { hp:100, dmg:14, range:3.0, speed:2.0, cost:0,   splash:0,   sight:7, projectile:'bullet', cd:0.7, buildTime:0,  fly:false, accuracy:1, stealthRange:2 },
  // Sardaukar — Imperial elite shock troopers. Trainable from Palace by any faction.
  // Tougher and harder-hitting than basic infantry; still on foot (crushable).
  sardaukar:   { hp:140, dmg:18, range:3.5, speed:1.8, cost:200, splash:0,   sight:6, projectile:'bullet', cd:0.6, buildTime:8,  fly:false, accuracy:1 },
  // Ornithopter — light strike aircraft. Trainable from Palace. Fast, anti-air,
  // splash rockets. Glass cannon — high DPS but moderate HP for an air unit.
  ornithopter: { hp:170, dmg:50, range:5.0, speed:5.0, cost:500, splash:1.0, sight:9, projectile:'rocket', cd:1.4, buildTime:12, fly:true,  accuracy:1, antiAir:true },
};

/**
 * Faction restrictions for unit production. Returns true if the faction can
 * train this unit kind. Used by sidebar UI and `findProducer`.
 */
export function canFactionProduce(faction: FactionId, kind: UnitKind): boolean {
  // Fremen is only summoned by Atreides Palace — never producible from a factory.
  if (kind === 'fremen') return false;
  if (kind === 'stealthTank') return faction === 'ordos';
  if (kind === 'siegeTank') return faction === 'atreides' || faction === 'harkonnen';
  // ── Palace-trained faction-exclusive units ──
  // Sardaukar — Imperial elite shock troops, aligned with House Harkonnen.
  if (kind === 'sardaukar')   return faction === 'harkonnen';
  // Ornithopter — Atreides aircraft tradition (House Atreides emphasised air power).
  // Ordos's Palace alternative is the Stealth Tank (Hi-Tech, faction-exclusive).
  if (kind === 'ornithopter') return faction === 'atreides';
  return true;
}

// Faction-specific specials — each fraction's hero unit plays differently.
// Atreides Sonic Tank — wide-area sonic blast.
// Harkonnen Devastator — slow, high-HP, heavy splash damage.
// Ordos Saboteur — elite kamikaze: stealth, sprint to target building, self-destruct on contact.
export const SPECIAL_STATS: Record<FactionId, UnitDef> = {
  atreides:  { hp:340, dmg:60, range:5.5, speed:1.4, cost:600, splash:1.4, sight:6, projectile:'sonic',  cd:2.2, buildTime:14, fly:false, accuracy:1 },
  harkonnen: { hp:520, dmg:90, range:5.0, speed:1.0, cost:750, splash:1.8, sight:6, projectile:'shell',  cd:2.6, buildTime:18, fly:false, accuracy:1 },
  ordos:     { hp:80,  dmg:0,  range:0,   speed:2.8, cost:350, splash:0,   sight:5, projectile:null,     cd:0,   buildTime:10, fly:false, accuracy:1, stealthRange:2 },
};

// Faction-specific Trike variants — meaningful tactical asymmetry on the cheapest vehicle.
// IMPORTANT: Light Factory tier must remain skirmisher/scout. Heavy Factory (Tank/Launcher)
// is the mid-game power spike. Don't let mass-Quad / mass-Raider out-DPS a Tank army.
//
// Atreides "Trike"  — balanced baseline skirmisher.
// Harkonnen "Quad"  — heavier harasser, slower, costs significantly more.
// Ordos "Raider"    — fragile pure scout/kiter, sight + range advantage, weak DPS.
export const TRIKE_STATS: Record<FactionId, UnitDef> = {
  atreides:  { hp:90,  dmg:11, range:3.5, speed:3.4, cost:170, splash:0, sight:7,  projectile:'bullet', cd:0.65, buildTime:7,  fly:false, accuracy:1 },
  harkonnen: { hp:125, dmg:15, range:3.5, speed:2.4, cost:240, splash:0, sight:6,  projectile:'bullet', cd:0.80, buildTime:10, fly:false, accuracy:1 },
  ordos:     { hp:65,  dmg:8,  range:3.8, speed:4.6, cost:150, splash:0, sight:10, projectile:'bullet', cd:0.60, buildTime:6,  fly:false, accuracy:1 },
};

/**
 * Returns stats for a unit kind, applying faction overrides where defined and
 * faction-wide perks (HP / DMG / speed / cost / range / sight multipliers).
 *
 * Layer order:
 *  1. Base from UNIT_STATS / SPECIAL_STATS / TRIKE_STATS.
 *  2. Faction perks (multipliers from FACTION_PERKS) applied on top.
 */
export function statsFor(faction: FactionId, kind: UnitKind): UnitDef {
  const base = kind === 'special' ? SPECIAL_STATS[faction]
              : kind === 'trike'   ? TRIKE_STATS[faction]
              :                      UNIT_STATS[kind];
  const p = FACTION_PERKS[faction];

  // Carryall gets its own HP multiplier (Atreides bonus); other units use unitHpMul.
  const hpMul = kind === 'carryall' ? p.carryallHpMul : p.unitHpMul;

  return {
    ...base,
    hp:     Math.round(base.hp     * hpMul),
    dmg:    Math.round(base.dmg    * p.unitDmgMul),
    speed:  base.speed             * p.unitSpeedMul,
    cost:   Math.round(base.cost   * p.unitCostMul),
    range:  base.range             * p.unitRangeMul,
    sight:  Math.round(base.sight  * p.unitSightMul),
  };
}

