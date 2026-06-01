import type { GameState, Building, FactionId } from '../types/index.js';
import { findFreeSpot } from './pathfinding.js';
import { findBuilding, makeUnit, buildingCenter } from '../state/gameState.js';
import { MAP_W, MAP_H } from '../constants/map.js';

// ── Tuning ────────────────────────────────────────────────────
/** Cooldown after a Palace super-ability is used (seconds). */
export const PALACE_COOLDOWN = 240;
/** Number of Fremen warriors spawned by Atreides Palace. */
export const FREMEN_SQUAD_SIZE = 5;
/** Death Hand splash radius in tiles (Harkonnen). */
export const DEATH_HAND_SPLASH = 5;
/** Death Hand damage (huge — designed to wipe a building or cluster). */
export const DEATH_HAND_DMG = 320;

// ── Tick: count down all palace cooldowns ─────────────────────
export function tickPalaces(state: GameState, dt: number): void {
  for (const b of state.buildings) {
    if (b.dead || b.kind !== 'palace') continue;
    if (b.constructing) continue;
    if (b.superCooldown > 0) {
      b.superCooldown = Math.max(0, b.superCooldown - dt);
    }
  }
}

// ── Public: is this palace's super-ability ready? ─────────────
export function isPalaceReady(b: Building): boolean {
  return b.kind === 'palace' && !b.dead && !b.constructing && b.superCooldown <= 0;
}

// ── Public: activate super-ability ────────────────────────────
/**
 * Trigger the faction-specific super-ability for `palace`.
 * For Harkonnen, an explicit target tile is required (Death Hand strike).
 * Returns true on success.
 */
export function activatePalaceSuper(
  palace: Building, state: GameState,
  target: { x: number; y: number } | null = null,
): boolean {
  if (!isPalaceReady(palace)) return false;
  const f = palace.faction;

  if (f === 'atreides') {
    spawnFremenSquad(palace, state);
  } else if (f === 'harkonnen') {
    if (!target) return false;
    launchDeathHand(palace, state, target);
  } else if (f === 'ordos') {
    spawnFreeSaboteur(palace, state);
  }

  palace.superCooldown = PALACE_COOLDOWN;
  return true;
}

// ── Atreides: Fremen squad ────────────────────────────────────
function spawnFremenSquad(palace: Building, state: GameState): void {
  // Spawn at map edge nearest to the enemy base, then march toward enemy yard.
  const enemyFaction: FactionId = palace.faction === state.faction
    ? state.aiFaction : state.faction;
  const enemyYard = findBuilding(enemyFaction, 'yard', state);
  const targetX = enemyYard ? enemyYard.tx + enemyYard.w / 2 : MAP_W / 2;
  const targetY = enemyYard ? enemyYard.ty + enemyYard.h / 2 : MAP_H / 2;

  // Pick spawn edge: closest map border to enemy base
  const distLeft   = targetX;
  const distRight  = MAP_W - targetX;
  const distTop    = targetY;
  const distBottom = MAP_H - targetY;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  let spawnX = targetX, spawnY = targetY;
  if (minDist === distLeft)        { spawnX = 1;          spawnY = targetY; }
  else if (minDist === distRight)  { spawnX = MAP_W - 2;  spawnY = targetY; }
  else if (minDist === distTop)    { spawnX = targetX;    spawnY = 1; }
  else                              { spawnX = targetX;    spawnY = MAP_H - 2; }

  for (let i = 0; i < FREMEN_SQUAD_SIZE; i++) {
    const angle = (i / FREMEN_SQUAD_SIZE) * Math.PI * 2;
    const sx = spawnX + Math.cos(angle) * 0.8;
    const sy = spawnY + Math.sin(angle) * 0.8;
    const spot = findFreeSpot(state, sx, sy);
    if (!spot) continue;
    const u = makeUnit(palace.faction, 'fremen', spot.x, spot.y, palace.ai);
    // Target the enemy yard automatically
    u.target = { x: targetX, y: targetY };
    u.holdFire = false;
    state.units.push(u);
  }
}

// ── Ordos: free Saboteur spawn ────────────────────────────────
function spawnFreeSaboteur(palace: Building, state: GameState): void {
  const c = buildingCenter(palace);
  const spot = findFreeSpot(state, c.x, c.y + palace.h);
  if (!spot) return;
  // 'special' for Ordos = Saboteur (kamikaze, stealth)
  const u = makeUnit(palace.faction, 'special', spot.x, spot.y, palace.ai);
  // Steer toward the enemy CY so the saboteur walks across the map and the
  // existing auto-target logic in the main loop will lock onto buildings on the way.
  const enemyFaction: FactionId = palace.faction === state.faction
    ? state.aiFaction : state.faction;
  const enemyYard = findBuilding(enemyFaction, 'yard', state);
  if (enemyYard) {
    u.target = {
      x: enemyYard.tx + enemyYard.w / 2,
      y: enemyYard.ty + enemyYard.h / 2,
    };
    u.holdFire = false;
  }
  state.units.push(u);
}

// ── Harkonnen: Death Hand long-range strike ───────────────────
function launchDeathHand(palace: Building, state: GameState,
                         target: { x: number; y: number }): void {
  const c = buildingCenter(palace);
  // Scatter ±1.5 tiles for canonical Death Hand inaccuracy
  const tx = target.x + (Math.random() - 0.5) * 3;
  const ty = target.y + (Math.random() - 0.5) * 3;
  state.projectiles.push({
    x: c.x, y: c.y,
    tx, ty,
    dir: Math.atan2(ty - c.y, tx - c.x),
    targetId: -1,
    sourceId: palace.id,
    sourceFaction: palace.faction,
    dmg: DEATH_HAND_DMG,
    splash: DEATH_HAND_SPLASH,
    kind: 'deathHand',
    speed: 4, // slow, dramatic
    dead: false,
  });
}
