import type { GameState, FactionId, UnitKind, BuildingKind, Building } from '../types/index.js';
import { statsFor, canFactionProduce } from '../constants/units.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { FACTION_PERKS } from '../constants/factions.js';
import { makeUnit, makeBuilding, activeBuildings, hasBuilding } from '../state/gameState.js';
import { powerOf } from './power.js';
import { MAP_W, MAP_H } from '../constants/map.js';

// ── Tech tree queries ─────────────────────────────────────────
export function unitProducerKind(kind: UnitKind): BuildingKind | null {
  for (const [bk, def] of Object.entries(BUILD_DEFS) as [BuildingKind, typeof BUILD_DEFS[BuildingKind]][]) {
    if (def.produces.includes(kind)) return bk;
  }
  return null;
}

export function findProducer(faction: FactionId, kind: UnitKind, state: GameState) {
  // Faction restriction: Saboteur/Stealth Tank are Ordos-only, Siege Tank is Atr/Hark only.
  if (!canFactionProduce(faction, kind)) return null;
  const need = unitProducerKind(kind);
  if (!need) return null;
  const list = activeBuildings(faction, state).filter(b => b.kind === need);
  // Upgraded-factory restrictions
  const requiresUpgrade = kind === 'launcher' || kind === 'siegeTank';
  const filtered = requiresUpgrade ? list.filter(b => b.upgraded) : list;
  filtered.sort((a, b) => a.productionQueue.length - b.productionQueue.length);
  return filtered[0] ?? null;
}

export function canProduceUnit(faction: FactionId, kind: UnitKind, state: GameState): boolean {
  return !!findProducer(faction, kind, state);
}

export function canBuild(faction: FactionId, kind: BuildingKind, state: GameState): boolean {
  return BUILD_DEFS[kind].prereq.every(p => hasBuilding(faction, p, state));
}

// ── Enqueue unit (player) ─────────────────────────────────────
export function queueUnit(kind: UnitKind, state: GameState): boolean {
  const stats = statsFor(state.faction, kind);
  if (state.spice < stats.cost) return false;
  const prod = findProducer(state.faction, kind, state);
  if (!prod || prod.productionQueue.length >= 5) return false;
  state.spice -= stats.cost;
  prod.productionQueue.push(kind);
  return true;
}

export function aiQueueUnit(kind: UnitKind, state: GameState): boolean {
  const stats = statsFor(state.aiFaction, kind);
  if (state.aiSpice < stats.cost) return false;
  const prod = findProducer(state.aiFaction, kind, state);
  if (!prod || prod.productionQueue.length >= 4) return false;
  state.aiSpice -= stats.cost;
  prod.productionQueue.push(kind);
  return true;
}

/**
 * Find the best spawn tile adjacent to a building.
 * Scans tiles in rings starting from the right side (exit), then other sides.
 * Returns tile-centre coords, or null if nothing free within radius 5.
 */
function findSpawnPoint(b: Building, state: GameState): { x: number; y: number } | null {
  for (let r = 1; r <= 5; r++) {
    // Prioritise right side (production exit), then cycle: top, bottom, left
    const candidates: [number, number][] = [];
    for (let dy = -r; dy <= b.h - 1 + r; dy++) candidates.push([b.tx + b.w - 1 + r, b.ty + dy]);
    for (let dx = b.w - 2 + r; dx >= -r; dx--)  candidates.push([b.tx + dx, b.ty - r]);
    for (let dx = -r; dx <= b.w - 1 + r; dx++)   candidates.push([b.tx + dx, b.ty + b.h - 1 + r]);
    for (let dy = b.h - 2 + r; dy >= -r + 1; dy--) candidates.push([b.tx - r, b.ty + dy]);

    for (const [tx, ty] of candidates) {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
      const insideBuilding = state.buildings.some(
        ob => !ob.dead && tx >= ob.tx && tx < ob.tx + ob.w && ty >= ob.ty && ty < ob.ty + ob.h,
      );
      if (insideBuilding) continue;
      const crowded = state.units.filter(
        u => !u.dead && !u.carried && Math.floor(u.x) === tx && Math.floor(u.y) === ty,
      ).length >= 2;
      if (crowded) continue;
      return { x: tx + 0.5, y: ty + 0.5 };
    }
  }
  return null;
}

// ── Building placement ────────────────────────────────────────
export function canPlaceAt(
  faction: FactionId, kind: BuildingKind,
  tx: number, ty: number,
  state: GameState,
): boolean {
  const def = BUILD_DEFS[kind];
  if (tx < 0 || ty < 0 || tx + def.w > MAP_W || ty + def.h > MAP_H) return false;

  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const t = state.map[ty + dy]![tx + dx]!;
      if (t.type === 'spice' || t.type === 'spice2') return false;
      for (const b of state.buildings) {
        if (b.dead) continue;
        if (tx + dx >= b.tx && tx + dx < b.tx + b.w && ty + dy >= b.ty && ty + dy < b.ty + b.h) return false;
      }
    }
  }

  // Must be within 6 tiles of a friendly building
  const close = activeBuildings(faction, state).some(b => {
    const cx = b.tx + b.w / 2, cy = b.ty + b.h / 2;
    const tcx = tx + def.w / 2, tcy = ty + def.h / 2;
    return Math.hypot(cx - tcx, cy - tcy) <= 6;
  });
  if (!close) return false;

  // Must be explored by player
  if (faction === state.faction) {
    const cy = Math.min(MAP_H - 1, ty + Math.floor(def.h / 2));
    const cx = Math.min(MAP_W - 1, tx + Math.floor(def.w / 2));
    if ((state.fog[cy]![cx] ?? 0) < 1) return false;
  }

  return true;
}

export function placeBuilding(kind: BuildingKind, tx: number, ty: number, state: GameState): boolean {
  if (!canBuild(state.faction, kind, state)) return false;
  if (!canPlaceAt(state.faction, kind, tx, ty, state)) return false;
  if (state.spice < BUILD_DEFS[kind].cost) return false;
  state.spice -= BUILD_DEFS[kind].cost;
  state.buildings.push(makeBuilding(state.faction, kind, tx, ty, false, false));
  return true;
}

export function aiPlaceBuilding(kind: BuildingKind, state: GameState): boolean {
  if (state.aiSpice < BUILD_DEFS[kind].cost) return false;
  if (!canBuild(state.aiFaction, kind, state)) return false;
  const yard = activeBuildings(state.aiFaction, state).find(b => b.kind === 'yard');
  if (!yard) return false;
  for (let rr = 2; rr < 10; rr++) {
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        if (Math.abs(dx) !== rr && Math.abs(dy) !== rr) continue;
        const ttx = yard.tx + dx, tty = yard.ty + dy;
        if (canPlaceAt(state.aiFaction, kind, ttx, tty, state)) {
          state.aiSpice -= BUILD_DEFS[kind].cost;
          state.buildings.push(makeBuilding(state.aiFaction, kind, ttx, tty, true, false));
          return true;
        }
      }
    }
  }
  return false;
}

/** Player upgrades a building (e.g. heavyupg, yardupg). */
export function upgradeBuilding(kind: BuildingKind, state: GameState): boolean {
  const def = BUILD_DEFS[kind];
  if (!def.upgradeOf) return false;
  if (state.spice < def.cost) return false;
  if (!canBuild(state.faction, kind, state)) return false;
  const target = state.buildings.find(
    b => b.faction === state.faction && b.kind === def.upgradeOf && !b.dead && !b.constructing,
  );
  if (!target || target.upgraded) return false;
  state.spice -= def.cost;
  target.upgraded = true;
  return true;
}

/** AI upgrades a building. */
export function aiUpgradeBuilding(kind: BuildingKind, state: GameState): boolean {
  const def = BUILD_DEFS[kind];
  if (!def.upgradeOf) return false;
  if (state.aiSpice < def.cost) return false;
  const target = state.buildings.find(
    b => b.faction === state.aiFaction && b.kind === def.upgradeOf && !b.dead && !b.constructing,
  );
  if (!target || target.upgraded) return false;
  state.aiSpice -= def.cost;
  target.upgraded = true;
  return true;
}

// ── Tick: advance production queues for all buildings ─────────
export function updateProduction(state: GameState, dt: number): void {
  const powP = powerOf(state.faction, state);
  const powA = powerOf(state.aiFaction, state);

  // Passive refinery income (Ordos perk: +N spice/sec per active refinery)
  // Power ratio scales it down so a power-starved Ordos doesn't print free spice.
  const tickPassive = (faction: FactionId, ratio: number): void => {
    const perk = FACTION_PERKS[faction].refineryPassiveSpice;
    if (perk <= 0) return;
    const refCount = activeBuildings(faction, state).filter(b => b.kind === 'refinery').length;
    if (refCount === 0) return;
    const gain = perk * refCount * dt * (ratio < 1 ? 0.5 + 0.5 * ratio : 1);
    if (faction === state.faction) {
      const cap = state.cap * FACTION_PERKS[faction].refineryCapMul;
      state.spice = Math.min(cap, state.spice + gain);
    } else {
      const cap = state.cap * 1.5 * FACTION_PERKS[faction].refineryCapMul;
      state.aiSpice = Math.min(cap, state.aiSpice + gain);
    }
  };
  tickPassive(state.faction,   powP.ratio);
  tickPassive(state.aiFaction, powA.ratio);

  for (const b of state.buildings) {
    if (b.dead) continue;

    // Construction phase
    if (b.constructing) {
      b.constructTime += dt;
      const r = b.constructTime / b.constructNeed;
      b.hp = Math.min(b.maxHp, b.maxHp * 0.3 + b.maxHp * 0.7 * r);
      if (b.constructTime >= b.constructNeed) {
        b.constructing = false;
        b.hp = b.maxHp;
        // Each completed refinery spawns a harvester at its door
        if (b.kind === 'refinery') {
          const sp = findSpawnPoint(b, state);
          const newUnit = makeUnit(b.faction, 'harvester', sp ? sp.x : b.tx + b.w + 0.5, sp ? sp.y : b.ty + b.h - 0.5, b.ai);
          if (!sp) newUnit.waitingForTransport = true;
          state.units.push(newUnit);
        }
      }
      continue;
    }

    if (!b.productionQueue.length) continue;

    const kind = b.productionQueue[0]!;
    const pow = b.faction === state.faction ? powP : powA;
    const speed = pow.ratio < 1 ? 0.3 + 0.7 * pow.ratio : 1;
    b.productionProgress += dt * speed;

    if (b.productionProgress >= statsFor(b.faction, kind).buildTime) {
      b.productionQueue.shift();
      b.productionProgress = 0;
      const sp = findSpawnPoint(b, state);
      const newUnit = makeUnit(b.faction, kind, sp ? sp.x : b.tx + b.w + 0.5, sp ? sp.y : b.ty + b.h - 0.5, b.ai);
      if (!sp) newUnit.waitingForTransport = true;
      state.units.push(newUnit);
    }
  }
}
