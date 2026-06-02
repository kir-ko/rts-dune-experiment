/**
 * main.ts — entry point
 * Creates the PixiJS Application, wires all systems, starts the game loop.
 */
import { Application } from 'pixi.js';
import type { FactionId, BuildingKind, GameState } from './types/index.js';
import { VIEW_W, VIEW_H } from './constants/map.js';
import { initSprites } from './render/sprites.js';
import {
  createScene, syncScene,
  renderSelectionBox, renderPauseOverlay,
} from './render/renderer.js';
import { game, createGame, type SkirmishOptions, DEFAULT_SKIRMISH } from './state/gameState.js';
import { findPath } from './systems/pathfinding.js';
import { updateFog } from './systems/fog.js';
import { updateProduction } from './systems/production.js';
import { tickPalaces, activatePalaceSuper } from './systems/palace.js';
import { updateCrush, isCrusher, isCrushable } from './systems/crush.js';
import { initPalacePanel, updatePalacePanel } from './ui/palacePanel.js';
import { updateProjectiles, findNearestEnemy, fireProjectile, updateTurrets, damageEntity } from './systems/combat.js';
import { updateHarvester } from './systems/harvester.js';
import { updateCarryall } from './systems/carryall.js';
import { updateAI } from './systems/ai.js';
import { updateRepair } from './systems/repair.js';
import { updateWorms } from './systems/sandworm.js';
import { updateSpiceBlooms } from './systems/spiceBloom.js';
import { powerOf } from './systems/power.js';
import { statsFor } from './constants/units.js';
import { updateHud, updateProductionPanel } from './ui/hud.js';
import { initSidebar, rebuildSidebar, updateBuildButtons } from './ui/sidebar.js';
import { showToast } from './ui/toast.js';
import { initMinimap, renderMinimap } from './ui/minimap.js';
import { bindMouse, getMouseWorld } from './input/mouse.js';
import { bindKeyboard, keys } from './input/keyboard.js';
import { edgeScroll, clampCam } from './input/camera.js';

// ── PixiJS app ────────────────────────────────────────────────
const app = new Application<HTMLCanvasElement>({
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: 0x000000,
  resolution: 1,
  antialias: false,
});

document.getElementById('game-container')!.appendChild(app.view);

// ── Global UI state ───────────────────────────────────────────
let paused = false;
let placing: BuildingKind | null = null;
/** When set, next left-click on the world fires Death Hand from this palace. */
let palaceTargetingId: number | null = null;

function startPlacing(kind: BuildingKind): void {
  placing = kind;
  palaceTargetingId = null;
  rebuildSidebar(game!, placing);
  showToast(`Click near your base to place ${kind.toUpperCase()}`);
}
function cancelPlacing(): void {
  placing = null;
  if (game) rebuildSidebar(game, null);
}
function startPalaceTargeting(palaceId: number): void {
  // Cancel any building placement that may be in progress
  placing = null;
  palaceTargetingId = palaceId;
  if (game) rebuildSidebar(game, null);
}
function cancelPalaceTargeting(): void {
  palaceTargetingId = null;
}
/** Called by mouse.ts when player clicks the world while in palace targeting mode. */
export function fireDeathHandAt(wx: number, wy: number): void {
  if (palaceTargetingId == null || !game) return;
  const palace = game.buildings.find(b => b.id === palaceTargetingId);
  palaceTargetingId = null;
  if (!palace || palace.dead) return;
  if (activatePalaceSuper(palace, game, { x: wx, y: wy })) {
    showToast('DEATH HAND inbound!');
  }
}

// ── Sprites & scene ───────────────────────────────────────────
initSprites(app);
const layers = createScene(app);

// ── Sidebar ───────────────────────────────────────────────────
initSidebar(startPlacing, cancelPlacing);

// ── Palace control panel ──────────────────────────────────────
initPalacePanel(startPalaceTargeting, cancelPalaceTargeting);

// ── Minimap ───────────────────────────────────────────────────
initMinimap(() => game);

// ── Menu ──────────────────────────────────────────────────────
// Skirmish menu — pick faction + map size + AI level + worms toggle, then START.
const skirmish: SkirmishOptions = { ...DEFAULT_SKIRMISH };
let chosenFaction: FactionId | null = null;

function syncMenuSelection(): void {
  document.querySelectorAll<HTMLButtonElement>('#menu .fbtn').forEach(b => {
    b.classList.toggle('sel', b.dataset['faction'] === chosenFaction);
  });
  document.querySelectorAll<HTMLButtonElement>('#menu .opt[data-group="mapsize"]').forEach(b => {
    b.classList.toggle('sel', b.dataset['value'] === skirmish.mapSize);
  });
  document.querySelectorAll<HTMLButtonElement>('#menu .opt[data-group="ailevel"]').forEach(b => {
    b.classList.toggle('sel', b.dataset['value'] === skirmish.aiLevel);
  });
  document.querySelectorAll<HTMLButtonElement>('#menu .opt[data-group="worms"]').forEach(b => {
    b.classList.toggle('sel', (b.dataset['value'] === 'on') === skirmish.wormsEnabled);
  });
  (document.getElementById('start-btn') as HTMLButtonElement).disabled = chosenFaction === null;
}

document.querySelectorAll<HTMLButtonElement>('#menu .fbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    chosenFaction = btn.dataset['faction'] as FactionId;
    syncMenuSelection();
  });
});

document.querySelectorAll<HTMLButtonElement>('#menu .opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset['group'];
    const value = btn.dataset['value']!;
    if (group === 'mapsize')      skirmish.mapSize = value as SkirmishOptions['mapSize'];
    else if (group === 'ailevel') skirmish.aiLevel = value as SkirmishOptions['aiLevel'];
    else if (group === 'worms')   skirmish.wormsEnabled = value === 'on';
    syncMenuSelection();
  });
});

document.getElementById('start-btn')!.addEventListener('click', () => {
  if (!chosenFaction) return;
  document.getElementById('menu')!.classList.add('hidden');
  startGame(chosenFaction, skirmish);
});

syncMenuSelection();

document.getElementById('help-btn')!.addEventListener('click', () => {
  document.getElementById('helpmodal')!.classList.toggle('hidden');
});
document.getElementById('help-close')!.addEventListener('click', () => {
  document.getElementById('helpmodal')!.classList.add('hidden');
});

// END MATCH — manual surrender / unstuck switch when victory check can't trigger
document.getElementById('endmatch-btn')!.addEventListener('click', () => {
  if (!game || game.over) return;
  if (!confirm('End the match and return to menu?')) return;
  game.over = true;
  const screen = document.getElementById('endscreen') as HTMLElement;
  const msg = document.getElementById('endmsg') as HTMLElement;
  screen.classList.remove('win');
  screen.classList.add('lose');
  screen.style.display = 'flex';
  msg.textContent = 'MATCH ENDED';
});

// ── Input ─────────────────────────────────────────────────────
bindMouse(
  app.view,
  () => game,
  () => placing,
  cancelPlacing,
  cancelPlacing,   // after successful placement: reset placing mode
  () => palaceTargetingId,
  fireDeathHandAt,
  cancelPalaceTargeting,
);

bindKeyboard(
  () => game,
  () => paused,
  v => { paused = v; },
  () => placing,
  cancelPlacing,
);

// ── Start game ────────────────────────────────────────────────
function startGame(faction: FactionId, options: SkirmishOptions): void {
  const others: FactionId[] = (['atreides', 'harkonnen', 'ordos'] as FactionId[]).filter(f => f !== faction);
  const aiFaction = others[Math.floor(Math.random() * others.length)]!;
  createGame(faction, aiFaction, options);
  document.getElementById('faction')!.textContent = faction.toUpperCase();
  rebuildSidebar(game!, null);
  updateHud(game!);
  const wormsNote = options.wormsEnabled ? '' : ' · NO WORMS';
  showToast(`Mine spice. Build the chain. Crush the enemy Yard. [${options.aiLevel.toUpperCase()}${wormsNote}]`);
}

// ── Game loop ─────────────────────────────────────────────────
app.ticker.add((delta: number) => {
  if (!game) return;
  const dt = Math.min(delta / 60, 1 / 20);

  if (!paused) {
    edgeScroll(game, keys, dt);
    tick(dt);
  }

  clampCam(game);

  const mouseWorld = getMouseWorld(game);
  syncScene(game, layers, placing, mouseWorld);
  renderSelectionBox(game, layers.selectionBox);
  renderPauseOverlay(app, paused);

  if (!paused) {
    updateHud(game);
    updateProductionPanel(game);
    updateBuildButtons(game, placing);
    updatePalacePanel(game, palaceTargetingId);
    renderMinimap(game);
  }
});

// ── Tick: update all game systems ─────────────────────────────
function tick(dt: number): void {
  const state = game!;
  if (state.over) return;

  state.time += dt;

  updateFog(state);
  updateProduction(state, dt);
  tickPalaces(state, dt);
  updateAI(state, dt);
  updateProjectiles(state, dt);
  updateTurrets(state, dt);
  updateRepair(state, dt);
  if (state.wormsEnabled) updateWorms(state, dt);
  updateSpiceBlooms(state, dt);

  // Update effects timer
  for (const f of state.fx) f.t += dt;

  // Update units
  const powP = powerOf(state.faction, state);
  const powA = powerOf(state.aiFaction, state);

  for (const u of state.units) {
    if (u.dead || u.carried) continue;

    if (u.kind === 'carryall') {
      updateCarryall(u, dt, state);
      continue;
    }
    if (u.kind === 'harvester') {
      updateHarvester(u, dt, state, u.faction === state.faction ? powP.ratio : powA.ratio);
      continue;
    }

    // Combat unit
    const stats = statsFor(u.faction, u.kind);
    u.cooldown -= dt;

    // Find attack target
    let attTarget = u.attackTarget
      ? (state.units.find(x => x.id === u.attackTarget) ?? state.buildings.find(x => x.id === u.attackTarget) ?? null)
      : null;
    if (attTarget?.dead) { attTarget = null; u.attackTarget = null; }
    // Friendly-fire guard: if deviation flipped factions, drop the target
    if (attTarget && attTarget.faction === u.faction) { attTarget = null; u.attackTarget = null; }

    // Ordos Special (Saboteur) — kamikaze: runs at enemy building, self-destructs on contact.
    if (u.kind === 'special' && u.faction === 'ordos') {
      // Only buildings are valid targets; drop any unit-target the auto-aim might set.
      if (attTarget && !('tx' in attTarget)) { attTarget = null; u.attackTarget = null; }
      // Auto-find nearest enemy building when idle
      if (!attTarget && !u.holdFire) {
        let bd = 12; // detection range
        let bestB: import('./types/index.js').Building | null = null;
        for (const bb of state.buildings) {
          if (bb.dead || bb.faction === u.faction) continue;
          const cx = bb.tx + bb.w / 2, cy = bb.ty + bb.h / 2;
          const d = Math.hypot(cx - u.x, cy - u.y) - Math.max(bb.w, bb.h) / 2;
          if (d < bd) { bd = d; bestB = bb; }
        }
        if (bestB) { u.attackTarget = bestB.id; attTarget = bestB; }
      }
      if (attTarget && 'tx' in attTarget) {
        const tc = { x: attTarget.tx + attTarget.w / 2, y: attTarget.ty + attTarget.h / 2 };
        const d = Math.hypot(tc.x - u.x, tc.y - u.y) - Math.max(attTarget.w, attTarget.h) / 2;
        if (d < 0.6) {
          // Detonate — deal lethal damage so damageEntity triggers victory checks
          damageEntity(state, attTarget, attTarget.maxHp + 1, u);
          state.fx.push({ x: tc.x, y: tc.y, scale: 2.0, t: 0, life: 0.9, kind: 'expl' });
          u.dead = true;
        } else {
          // Run toward the building
          u.target = { x: tc.x, y: tc.y };
          moveUnit(u, dt, true);
        }
      } else if (u.target) {
        moveUnit(u, dt);
      }
      if (!u.target && u.holdFire) u.holdFire = false;
      continue;
    }

    // Tank-class units (tank, siegeTank) have a rotating turret independent of
    // the body. They fire on the move: body follows the move-order, turret
    // scans + tracks + fires at any enemy in range. Auto-target is allowed
    // even with holdFire so the turret has something to engage.
    const hasTurret = u.kind === 'tank' || u.kind === 'siegeTank';

    // Auto-target nearby enemies. Respects holdFire EXCEPT for tank-class
    // units (their turret can fire-on-the-move without disrupting the body).
    if (!attTarget && (!u.holdFire || hasTurret)) {
      const scanR = u.target ? stats.range * 1.1 : stats.range * 1.5;
      const e = findNearestEnemy(state, u, scanR);
      if (e) { u.attackTarget = e.id; attTarget = e; }
    }

    // True when the body is committed to a move-order and must not chase
    // (turret may still fire opportunistically).
    const isTankOnTheMove = hasTurret && u.holdFire && !!u.target;

    if (attTarget) {
      const tc = 'tx' in attTarget
        ? { x: attTarget.tx + attTarget.w / 2, y: attTarget.ty + attTarget.h / 2 }
        : attTarget;
      const dist = Math.hypot(tc.x - u.x, tc.y - u.y);

      if (isTankOnTheMove) {
        // Body always advances toward the original move-order; turret/firing
        // is handled below independently of body movement.
        moveUnit(u, dt);
        // Drop the attTarget reference if it slipped out of range, so the
        // next tick's auto-scan can pick a fresher in-range target.
        if (dist > stats.range) { u.attackTarget = null; attTarget = null; }
        else if (u.cooldown <= 0) {
          fireProjectile(state, u, attTarget, 0);
          u.cooldown = stats.cd;
        }
      } else if (dist <= stats.range) {
        // Stationary firing for non-turret units (or idle tanks without a
        // move-order). Tanks rotate just the turret; others rotate the body.
        if (!hasTurret) u.dir = Math.atan2(tc.y - u.y, tc.x - u.x);
        if (u.cooldown <= 0) {
          let scatter = 0;
          if (u.kind === 'launcher') {
            // 85% accuracy at max range (≥6.5), 20% at point-blank (<3)
            const acc = dist < 3 ? 0.20 : 0.20 + 0.65 * Math.min(1, (dist - 3) / 3.5);
            if (Math.random() > acc) scatter = (1 - acc) * 4;
          }
          fireProjectile(state, u, attTarget, scatter);
          u.cooldown = stats.cd;
        }
      } else {
        // Out of range, no move-order: chase
        u.target = { x: tc.x, y: tc.y };
        moveUnit(u, dt, true); // chase=true: skip A*, direct movement
      }
    } else if (u.target) {
      moveUnit(u, dt); // move order: use A*
    }

    // Clear holdFire once the move-order is consumed (unit reached destination)
    if (!u.target && u.holdFire) u.holdFire = false;

    // Turret aim: combat tank & siege tank track attTarget independently of body direction
    if (u.kind === 'tank' || u.kind === 'siegeTank') {
      let aim = u.dir;
      if (attTarget) {
        const tc2 = 'tx' in attTarget
          ? { x: attTarget.tx + attTarget.w / 2, y: attTarget.ty + attTarget.h / 2 }
          : attTarget;
        aim = Math.atan2(tc2.y - u.y, tc2.x - u.x);
      }
      // Smoothly rotate toward aim (shortest angular path)
      let diff = aim - u.turretDir;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const rotSpeed = 5; // rad/s
      const step = Math.max(-rotSpeed * dt, Math.min(rotSpeed * dt, diff));
      u.turretDir += step;
    }
  }

  // Crush pass: tracked vehicles run over enemy foot units. Must run BEFORE
  // separation, otherwise SEP keeps them apart and crush never triggers.
  updateCrush(state);

  // Unit-unit separation (prevent stacking)
  separateUnits(state);

  // Purge dead
  state.units = state.units.filter(u => !u.dead);
  state.buildings = state.buildings.filter(b => !b.dead);
  state.selection = state.selection.filter(id =>
    state.units.some(u => u.id === id) || state.buildings.some(b => b.id === id),
  );
}

// ── Unit separation ───────────────────────────────────────────
// Collision radii match the visual sprite scale (see renderer.ts SPRITE_SCALE).
// Separation threshold = radA + radB so large units don't clip into each other.
const UNIT_COL_RADIUS: Partial<Record<import('./types/index.js').UnitKind, number>> = {
  infantry: 0.40, fremen: 0.40, sardaukar: 0.42,
  trike: 0.48, stealthTank: 0.50,
  tank: 0.56, harvester: 0.54, launcher: 0.54,
  siegeTank: 0.60,
  special: 0.62,
};
function unitColRadius(kind: import('./types/index.js').UnitKind): number {
  return UNIT_COL_RADIUS[kind] ?? 0.44;
}

function separateUnits(state: GameState): void {
  const alive = state.units.filter(u => !u.dead && !u.carried && !u.docked && u.kind !== 'carryall');
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!, b = alive[j]!;
      // Skip separation between an enemy crusher and a crushable foot unit.
      // Otherwise separation keeps them at SEP distance and the crush check
      // (radius 0.45) can never trigger.
      if (a.faction !== b.faction) {
        const aCrushOnB = isCrusher(a) && isCrushable(b);
        const bCrushOnA = isCrusher(b) && isCrushable(a);
        if (aCrushOnB || bCrushOnA) continue;
      }
      const sep = unitColRadius(a.kind) + unitColRadius(b.kind);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= sep * sep) continue; // fast-path: already far enough
      if (d2 < 0.0001) {
        // Exactly on top: push apart on a fixed axis
        a.x -= 0.2; b.x += 0.2;
        continue;
      }
      const d = Math.sqrt(d2);
      const push = (sep - d) * 0.5;
      const nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
    }
  }
}

function moveUnit(u: import('./types/index.js').Unit, dt: number, chase = false): void {
  if (!u.target) return;
  const dx0 = u.target.x - u.x, dy0 = u.target.y - u.y;
  if (Math.hypot(dx0, dy0) < 0.15) {
    u.x = u.target.x; u.y = u.target.y;
    u.target = null; u.path = null;
    return;
  }

  // Flying combat units (Ornithopter): bypass A* — buildings don't block flight.
  // Carryall has its own update path so we don't need to special-case it here.
  const stats = statsFor(u.faction, u.kind);
  if (stats.fly) {
    u.dir = Math.atan2(dy0, dx0);
    const d = Math.hypot(dx0, dy0);
    const step = Math.min(stats.speed * dt, d);
    u.x += (dx0 / d) * step;
    u.y += (dy0 / d) * step;
    u.path = null;
    return;
  }

  // Throttle path recomputation
  if (u.pathRecomputeIn > 0) u.pathRecomputeIn -= dt;

  // ── A* path ─────────────────────────────────────────────────
  // Recompute path if: no path, last waypoint mismatches target, or chase target moved
  const lastWp = u.path?.[u.path.length - 1];
  const needRecompute =
    !u.path || u.path.length === 0 || !lastWp ||
    Math.hypot(lastWp.x - u.target.x, lastWp.y - u.target.y) > (chase ? 1.0 : 0.6);

  if (needRecompute && u.pathRecomputeIn <= 0) {
    u.path = game ? findPath(game, u.x, u.y, u.target.x, u.target.y) : [u.target];
    // Throttle: full recompute every 0.6s (chase) / 1.5s (move-order with stale path)
    u.pathRecomputeIn = chase ? 0.6 : 1.5;
  }

  if (u.path && u.path.length > 0) {
    const wp = u.path[0]!;
    const dx = wp.x - u.x, dy = wp.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) {
      u.path.shift();
      if (u.path.length === 0) { u.target = null; u.path = null; }
      return;
    }
    u.dir = Math.atan2(dy, dx);
    const sp = statsFor(u.faction, u.kind).speed;
    u.x += (dx / d) * Math.min(sp * dt, d);
    u.y += (dy / d) * Math.min(sp * dt, d);
  } else {
    directMove(u, dt);
  }
}

function directMove(
  u: import('./types/index.js').Unit,
  dt: number,
): void {
  if (!u.target) return;
  const dx = u.target.x - u.x, dy = u.target.y - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.15) { u.x = u.target.x; u.y = u.target.y; u.target = null; return; }
  u.dir = Math.atan2(dy, dx);
  const sp = statsFor(u.faction, u.kind).speed;
  const step = Math.min(sp * dt, d);
  u.x += (dx / d) * step;
  u.y += (dy / d) * step;

  // Building avoidance repulsion — skipped for Ordos Saboteur (kamikaze needs to ram into target)
  if (game && !(u.kind === 'special' && u.faction === 'ordos')) {
    for (const b of game.buildings) {
      if (b.dead) continue;
      const cx = Math.max(b.tx, Math.min(b.tx + b.w, u.x));
      const cy = Math.max(b.ty, Math.min(b.ty + b.h, u.y));
      const ex = u.x - cx, ey = u.y - cy;
      const dist = Math.hypot(ex, ey);
      const repulse = 1.1;
      if (dist < repulse) {
        if (dist < 0.01) { u.x = b.tx + b.w + repulse; }
        else {
          const push = (repulse - dist) * 4 * dt;
          u.x += (ex / dist) * push;
          u.y += (ey / dist) * push;
        }
      }
    }
  }
}
