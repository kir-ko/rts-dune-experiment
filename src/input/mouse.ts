import type { GameState, Unit, Building } from '../types/index.js';
import { TILE } from '../constants/map.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { isEntityVisible } from '../systems/fog.js';
import { isStealthVisible } from '../systems/combat.js';
import { buildingCenter } from '../state/gameState.js';
import { placeBuilding } from '../systems/production.js';
import type { BuildingKind } from '../types/index.js';

interface MouseState {
  screenX: number;
  screenY: number;
  dragStart: { x: number; y: number } | null;
}

const mouse: MouseState = { screenX: 0, screenY: 0, dragStart: null };

export function getMouseWorld(state: GameState): { x: number; y: number } {
  return {
    x: (mouse.screenX + state.camX) / TILE,
    y: (mouse.screenY + state.camY) / TILE,
  };
}

// ── Bind canvas mouse events ──────────────────────────────────
export function bindMouse(
  canvas: HTMLElement,
  getState: () => GameState | null,
  getPlacing: () => BuildingKind | null,
  cancelPlacing: () => void,
  onPlaced: () => void,
  getPalaceTargetingId: () => number | null = () => null,
  onPalaceTarget: (wx: number, wy: number) => void = () => {},
  cancelPalaceTargeting: () => void = () => {},
): void {
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousemove', (ev: Event) => {
    const e = ev as MouseEvent;
    const rect = canvas.getBoundingClientRect();
    const scaleX = (canvas as HTMLCanvasElement).width / rect.width;
    const scaleY = (canvas as HTMLCanvasElement).height / rect.height;
    mouse.screenX = (e.clientX - rect.left) * scaleX;
    mouse.screenY = (e.clientY - rect.top) * scaleY;
    const state = getState();
    if (state && mouse.dragStart) {
      state.selBox = { x0: mouse.dragStart.x, y0: mouse.dragStart.y, x1: mouse.screenX, y1: mouse.screenY };
    }
  });

  canvas.addEventListener('mousedown', (ev: Event) => {
    const e = ev as MouseEvent;
    const state = getState();
    if (!state || state.over) return;

    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * ((canvas as HTMLCanvasElement).width / rect.width);
    const sy = (e.clientY - rect.top) * ((canvas as HTMLCanvasElement).height / rect.height);

    if (e.button === 0) {
      // Palace Death Hand targeting: next click selects target on map
      if (getPalaceTargetingId() != null) {
        const wx = (sx + state.camX) / TILE, wy = (sy + state.camY) / TILE;
        onPalaceTarget(wx, wy);
        return;
      }

      const placing = getPlacing();
      if (placing) {
        const wx = (sx + state.camX) / TILE, wy = (sy + state.camY) / TILE;
        const def = BUILD_DEFS[placing];
        const tx = Math.floor(wx - def.w / 2 + 0.5), ty = Math.floor(wy - def.h / 2 + 0.5);
        const placed = placeBuilding(placing, tx, ty, state);
        if (placed) onPlaced(); // cancel placing mode on success; stay on failure
        return; // always consume the click while in placing mode
      }

      mouse.dragStart = { x: sx, y: sy };
      state.selBox = { x0: sx, y0: sy, x1: sx, y1: sy };
    }

    if (e.button === 2) {
      if (getPalaceTargetingId() != null) { cancelPalaceTargeting(); return; }
      if (getPlacing()) { cancelPlacing(); return; }
      const wx = (sx + state.camX) / TILE, wy = (sy + state.camY) / TILE;
      issueOrder(state, wx, wy);
    }
  });

  canvas.addEventListener('mouseup', (ev: Event) => {
    const e = ev as MouseEvent;
    if (e.button !== 0) return;
    const state = getState();
    if (!state || !mouse.dragStart) return;

    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * ((canvas as HTMLCanvasElement).width / rect.width);
    const sy = (e.clientY - rect.top) * ((canvas as HTMLCanvasElement).height / rect.height);
    const dist = Math.hypot(sx - mouse.dragStart.x, sy - mouse.dragStart.y);

    if (dist < 5) {
      const wx = (sx + state.camX) / TILE, wy = (sy + state.camY) / TILE;
      const hit = pickEntity(state, wx, wy);
      if (hit) {
        state.selection = e.shiftKey ? [...state.selection, hit.id] : [hit.id];
      } else if (!e.shiftKey) {
        state.selection = [];
      }
    } else {
      // Box select — player ground units only
      const x0 = Math.min(mouse.dragStart.x, sx) + state.camX;
      const y0 = Math.min(mouse.dragStart.y, sy) + state.camY;
      const x1 = Math.max(mouse.dragStart.x, sx) + state.camX;
      const y1 = Math.max(mouse.dragStart.y, sy) + state.camY;
      state.selection = state.units
        .filter(u => !u.dead && !u.carried && u.faction === state.faction
          && u.x * TILE >= x0 && u.x * TILE <= x1
          && u.y * TILE >= y0 && u.y * TILE <= y1)
        .map(u => u.id);
    }

    mouse.dragStart = null;
    state.selBox = null;
  });
}

// ── Entity picking ────────────────────────────────────────────
function pickEntity(state: GameState, wx: number, wy: number): Unit | Building | null {
  let best: Unit | null = null;
  let bd = 0.7;
  for (const u of state.units) {
    if (u.dead || u.carried) continue;
    if (u.faction !== state.faction && !isEntityVisible(state, u.x, u.y, 0.5)) continue;
    // Stealth — invisible enemies can't be clicked
    if (u.faction !== state.faction && !isStealthVisible(state, u, state.faction)) continue;
    const d = Math.hypot(u.x - wx, u.y - wy);
    if (d < bd) { bd = d; best = u; }
  }
  if (best) return best;
  for (const b of state.buildings) {
    if (b.dead) continue;
    if (b.faction !== state.faction && !isEntityVisible(state, buildingCenter(b).x, buildingCenter(b).y, 1)) continue;
    if (wx >= b.tx && wx <= b.tx + b.w && wy >= b.ty && wy <= b.ty + b.h) return b;
  }
  return null;
}

// ── Formation offset for multi-unit move orders ───────────────
function formationOffset(i: number): { x: number; y: number } {
  if (i === 0) return { x: 0, y: 0 };
  const ring = Math.ceil(i / 6);
  const slot = (i - 1) % 6;
  const ang = (slot / 6) * Math.PI * 2;
  return { x: Math.cos(ang) * ring * 1.4, y: Math.sin(ang) * ring * 1.4 };
}

// ── Order dispatch ────────────────────────────────────────────
function issueOrder(state: GameState, wx: number, wy: number): void {
  if (!state.selection.length) return;
  const tgt = pickEntity(state, wx, wy);
  const isEnemy = tgt && tgt.faction !== state.faction && !tgt.dead;

  // Formation index for combat units moving to empty ground
  let moverIdx = 0;

  for (const id of state.selection) {
    const u = state.units.find(u => u.id === id);
    if (!u || u.dead || u.faction !== state.faction) continue;

    if (u.kind === 'carryall') {
      u.autoCarry = false;
      u.idleTimer = 0;

      // Click on a friendly harvester (and we're not already carrying) → pickup target.
      // Clear target to wipe any stale auto-set loiter destination. Player can issue
      // a follow-up destination click; that preserves carryTarget so the two-step
      // "pick up X, deliver to Y" works correctly.
      if (!u.cargo && tgt && !('tx' in tgt) && tgt.kind === 'harvester' && !tgt.carried) {
        u.carryTarget = tgt.id;
        u.target = null;
        continue;
      }

      // Click on a friendly refinery → snap delivery target to dock approach point.
      // Don't touch `u.carryTarget` — preserve any pending pickup.
      if (tgt && 'tx' in tgt && tgt.kind === 'refinery' && tgt.faction === u.faction) {
        u.target = { x: tgt.tx + tgt.w + 0.5, y: tgt.ty + tgt.h - 0.5 };
        continue;
      }

      // Click on a spice tile → snap to tile centre so dropCargo lands on the patch.
      const tx = Math.floor(wx), ty = Math.floor(wy);
      const tile = state.map[ty]?.[tx];
      if (tile && tile.spice > 0) {
        u.target = { x: tx + 0.5, y: ty + 0.5 };
        continue;
      }

      // Plain point click → set delivery / fly-to destination.
      // Preserve `u.carryTarget` so an earlier pickup order is still honoured.
      u.target = { x: wx, y: wy };
      continue;
    }

    // Ordos Saboteur: ПКМ по вражескому зданию → kamikaze. Игнорирует юнитов как цели.
    if (u.kind === 'special' && u.faction === 'ordos') {
      if (tgt && 'tx' in tgt && tgt.faction !== u.faction && !tgt.dead) {
        u.attackTarget = tgt.id; u.target = null;
        u.holdFire = false; u.path = null;
        continue;
      }
      // Click on a unit / friendly building / point → just move there
      u.target = { x: wx, y: wy };
      u.attackTarget = null;
      u.holdFire = true;
      u.path = null;
      continue;
    }

    if (u.kind === 'harvester') {
      // Any new player order clears the "parked on rock" flag.
      u.parkedOnRock = false;
      // Click on own refinery → force return-and-deposit (even partial load).
      // commandedReturn flag tells the harvester FSM and carryall this is player intent.
      if (tgt && 'tx' in tgt && tgt.kind === 'refinery' && tgt.faction === u.faction) {
        u.target = { x: tgt.tx + tgt.w - 0.5, y: tgt.ty + tgt.h - 0.5 };
        u.mode = 'toRefinery'; u.path = null;
        u.commandedReturn = true;
        u.attackTarget = null;
        continue;
      }
      // Click on an enemy unit → chase mode (continuously follow). Used to
      // ram crushable infantry; for non-crushable units it just drives at them.
      if (tgt && !('tx' in tgt) && tgt.faction !== u.faction && !tgt.dead) {
        u.attackTarget = tgt.id;
        u.target = { x: tgt.x, y: tgt.y };
        u.mode = 'moving';
        u.path = null;
        u.commandedReturn = false;
        continue;
      }
      u.target = { x: wx, y: wy }; u.mode = 'moving';
      u.commandedReturn = false;
      u.attackTarget = null;
      u.path = null;
      continue;
    }

    if (isEnemy) {
      // Player-issued attack — fires immediately, accepts auto-engagement
      u.attackTarget = tgt.id; u.target = null;
      u.holdFire = false;
      u.path = null;
    } else {
      const off = formationOffset(moverIdx++);
      u.target = { x: wx + off.x, y: wy + off.y };
      u.attackTarget = null;
      u.path = null;
      // Player-issued move — unit ignores enemies and goes to point.
      // Auto-targeting is suppressed until target is reached.
      u.holdFire = true;
    }
  }
}
