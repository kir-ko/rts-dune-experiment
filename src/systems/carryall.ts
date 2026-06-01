import type { GameState, Unit } from '../types/index.js';
import { UNIT_STATS } from '../constants/units.js';
import { findBuilding, buildingCenter } from '../state/gameState.js';
import { findNearestSpice } from './harvester.js';
import { findFreeSpot } from './pathfinding.js';

const SPEED = UNIT_STATS.carryall.speed;
const AUTO_CARRY_DIST = 6;      // tiles — min ground distance before worth airlifting
const IDLE_RECOVER_TIME = 2.5;  // seconds before re-enabling autoCarry after manual control

function flyTo(c: Unit, tx: number, ty: number, dt: number): boolean {
  const dx = tx - c.x, dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  c.dir = Math.atan2(dy, dx);
  const step = SPEED * dt;
  if (d < 0.3) { c.x = tx; c.y = ty; return true; }
  c.x += (dx / d) * step;
  c.y += (dy / d) * step;
  return false;
}

function dropCargo(c: Unit, state: GameState): void {
  if (!c.cargo) return;
  c.cargo.x = c.x; c.cargo.y = c.y;
  c.cargo.carried = false;
  c.cargo.path = null; // force pathfinder to recompute from drop position
  if (c.cargo.kind === 'harvester') {
    // If harvester still has spice, let it finish the deposit run
    if (c.cargo.spice > 0) {
      c.cargo.mode = 'toRefinery';
      c.cargo.target = null; // updateHarvester will set the correct refinery target
    } else {
      // Snap to spice tile centre so Math.floor lands on a spice tile and mining starts
      const tx = Math.floor(c.cargo.x), ty = Math.floor(c.cargo.y);
      const tile = state.map[ty]?.[tx];
      if (tile && tile.spice > 0) {
        c.cargo.x = tx + 0.5; c.cargo.y = ty + 0.5;
        c.cargo.mode = 'mining';
      } else {
        c.cargo.mode = 'idle';
      }
      c.cargo.target = null;
    }
  } else {
    c.cargo.target = null;
  }
  // Track last drop to suppress immediate re-pickup of the same unit
  c.lastDropId = c.cargo.id;
  c.dropCooldown = 3.0;
  c.cargo = null;
  // Set a clear depart target — fly off to refinery loiter spot so the carryall
  // doesn't sit on top of the dropped harvester (causes sprite flicker / re-pickup loop)
  const ref = findBuilding(c.faction, 'refinery', state);
  if (ref) {
    c.target = { x: ref.tx + ref.w + 1.5, y: ref.ty - 0.8 };
  } else {
    c.target = null;
  }
}

function pickUp(c: Unit, target: Unit, state: GameState): void {
  c.cargo = target;
  target.target = null;
  target.carried = true;
  target.x = c.x; target.y = c.y;
  c.carryTarget = null;

  // Smart default drop
  if (!c.target) {
    const ref = findBuilding(c.faction, 'refinery', state);
    if (target.spice >= 400 && ref) {
      const rc = buildingCenter(ref);
      c.target = { x: ref.tx + ref.w + 0.5, y: rc.y };
    } else {
      const respectFog = c.faction === state.faction;
      const sp = findNearestSpice(state, c.x, c.y, respectFog);
      if (sp) c.target = sp;
    }
  }
}

export function updateCarryall(c: Unit, dt: number, state: GameState): void {
  // Tick drop cooldown — auto-shuttle won't re-pick the just-dropped harvester
  if (c.dropCooldown > 0) c.dropCooldown -= dt;
  if (c.dropCooldown <= 0) c.lastDropId = null;

  // ── Carrying cargo ──────────────────────────────────────────
  if (c.cargo) {
    c.cargo.x = c.x; c.cargo.y = c.y;
    if (c.target) {
      const arrived = flyTo(c, c.target.x, c.target.y, dt);
      if (arrived) dropCargo(c, state);
    }
    return;
  }

  // ── Flying to pick up ───────────────────────────────────────
  if (c.carryTarget != null) {
    const target = state.units.find(u => u.id === c.carryTarget);
    if (target && !target.dead && target.kind === 'harvester' && !target.carried) {
      const arrived = flyTo(c, target.x, target.y, dt);
      if (arrived) pickUp(c, target, state);
    } else {
      c.carryTarget = null;
    }
    return;
  }

  // ── Manual fly-to ───────────────────────────────────────────
  if (c.target) {
    const arrived = flyTo(c, c.target.x, c.target.y, dt);
    if (arrived) {
      c.target = null;
      c.idleTimer = 0;
    }
    return;
  }

  // ── Idle timer — re-enable autoCarry after manual control ───
  if (!c.autoCarry) {
    c.idleTimer += dt;
    if (c.idleTimer >= IDLE_RECOVER_TIME) { c.autoCarry = true; c.idleTimer = 0; }
    return;
  }

  // ── AUTO-SHUTTLE ────────────────────────────────────────────

  // ── Transport newly spawned units that landed in blocked spots ──
  if (c.autoCarry && !c.cargo && c.carryTarget == null) {
    const stuck = state.units.find(u =>
      !u.dead && !u.carried && u.faction === c.faction &&
      u.waitingForTransport && u.kind !== 'carryall',
    );
    if (stuck) {
      const dest = findFreeSpot(state, stuck.x, stuck.y);
      if (dest) {
        c.carryTarget = stuck.id;
        c.target = dest;
        stuck.waitingForTransport = false;
        return;
      } else {
        stuck.waitingForTransport = false; // give up, let separation handle it
      }
    }
  }

  const ref = findBuilding(c.faction, 'refinery', state);
  let bestH: Unit | null = null;
  let bestScore = 0;

  for (const h of state.units) {
    if (h.dead || h.carried || h.docked || h.faction !== c.faction || h.kind !== 'harvester') continue;
    if (state.units.some(cc => cc.kind === 'carryall' && cc.cargo === h)) continue;
    // Don't re-pickup just-dropped harvester
    if (c.lastDropId === h.id && c.dropCooldown > 0) continue;

    let dest: { x: number; y: number } | null = null;
    let priority = false;
    // Only airlift to refinery if harvester is already heading back or almost full (≥480)
    if ((h.mode === 'toRefinery' || h.spice >= 480) && ref) {
      dest = { x: ref.tx + ref.w + 0.5, y: ref.ty + ref.h - 0.5 };
      // Player-commanded return → always airlift, regardless of distance
      if (h.commandedReturn) priority = true;
    } else if (h.spice < 50 && h.mode !== 'mining') {
      // Airlift to spice only when idle / searching — don't interrupt active mining.
      // Player carryall respects fog (only known spice); AI sees all.
      const respectFog = h.faction === state.faction;
      dest = findNearestSpice(state, h.x, h.y, respectFog);
    }
    if (!dest) continue;

    const groundDist = Math.hypot(dest.x - h.x, dest.y - h.y);
    if (!priority && groundDist < AUTO_CARRY_DIST) continue;
    // Player-commanded units jump the queue
    const score = priority ? groundDist + 1000 : groundDist;
    if (score > bestScore) { bestScore = score; bestH = h; }
  }

  if (bestH) {
    c.carryTarget = bestH.id;
    return;
  }

  // Idle drift near refinery
  if (ref) {
    const tx = ref.tx + ref.w + 1.5, ty = ref.ty - 0.8;
    flyTo(c, tx, ty, dt * 0.4);
  }
}
