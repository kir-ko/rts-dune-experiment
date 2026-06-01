import type { GameState, AILevel } from '../types/index.js';
import type { BuildingKind } from '../types/index.js';
import { powerOf } from './power.js';
import { aiQueueUnit, aiPlaceBuilding, canProduceUnit, aiUpgradeBuilding } from './production.js';
import { activeBuildings, findBuilding } from '../state/gameState.js';
import { isPalaceReady, activatePalaceSuper } from './palace.js';
import { statsFor } from '../constants/units.js';

// AI difficulty knobs — applied as multipliers / caps. Medium is the baseline,
// matching the historical un-scaled tempo.
interface AIScale {
  /** Multiplier on buildTimer between decisions (larger = AI thinks slower). */
  buildTempo: number;
  /** Multiplier on attackTimer between waves (larger = rarer waves). */
  attackTempo: number;
  /** Multiplier on wave size. */
  waveSizeMul: number;
  /** Hard cap on standard Gun Turrets. */
  maxTurrets: number;
  /** Hard cap on Rocket Turrets after yardupg. */
  maxRTurrets: number;
  /** Bonus spice per real-world second (drip-fed to aiSpice). */
  spiceDrip: number;
}
const AI_SCALES: Record<AILevel, AIScale> = {
  easy:   { buildTempo: 1.6, attackTempo: 1.5, waveSizeMul: 0.6, maxTurrets: 2, maxRTurrets: 1, spiceDrip: 0   },
  medium: { buildTempo: 1.0, attackTempo: 1.0, waveSizeMul: 1.0, maxTurrets: 3, maxRTurrets: 2, spiceDrip: 0   },
  hard:   { buildTempo: 0.6, attackTempo: 0.7, waveSizeMul: 1.5, maxTurrets: 4, maxRTurrets: 3, spiceDrip: 2.5 },
};

export function updateAI(state: GameState, dt: number): void {
  const scale = AI_SCALES[state.aiLevel];

  // Hard-mode spice drip — small per-second bonus so the AI economy can keep
  // up with its faster build tempo. Easy/medium = 0.
  if (scale.spiceDrip > 0) state.aiSpice += scale.spiceDrip * dt;

  const b = state.aiBrain;
  const f = state.aiFaction;
  b.buildTimer -= dt;
  b.attackTimer -= dt;
  b.scoutTimer -= dt;

  // ── Threat detection: enemy units near AI base trigger emergency defence ──
  const aiYard = findBuilding(f, 'yard', state);
  let threatLevel = 0; // 0 = safe, 1 = nearby, 2 = imminent (units very close)
  if (aiYard) {
    const yx = aiYard.tx + aiYard.w / 2, yy = aiYard.ty + aiYard.h / 2;
    let near = 0, imminent = 0;
    for (const eu of state.units) {
      if (eu.dead || eu.faction === f || eu.carried || eu.kind === 'carryall') continue;
      const d = Math.hypot(eu.x - yx, eu.y - yy);
      if (d < 8)  imminent++;
      else if (d < 16) near++;
    }
    threatLevel = imminent > 0 ? 2 : near > 0 ? 1 : 0;
  }

  // ── Build / produce decisions ───────────────────────────────
  if (b.buildTimer <= 0) {
    // Emergency: tick faster when threat is near base. Scaled by AI level —
    // hard mode reacts ~40% faster than medium.
    const baseTempo = threatLevel === 2 ? 1.0 + Math.random() * 0.5
                    : threatLevel === 1 ? 2.0 + Math.random() * 1.0
                    : 3.0 + Math.random() * 2.0;
    b.buildTimer = baseTempo * scale.buildTempo;

    const pow = powerOf(f, state);
    const have = (k: BuildingKind) => activeBuildings(f, state).some(bb => bb.kind === k);
    const hasUpg = (k: 'yard' | 'heavy') =>
      state.buildings.some(bb => bb.faction === f && bb.kind === k && bb.upgraded && !bb.dead);

    // ── Emergency defence: under threat, prioritise turrets and infantry over tech ──
    if (threatLevel >= 1 && have('barracks')) {
      const turretCount = activeBuildings(f, state).filter(bb => bb.kind === 'turret').length;
      // Build extra Gun Turrets while attacked, up to 5 total
      if (turretCount < 5 && state.aiSpice > 250) {
        if (aiPlaceBuilding('turret', state)) return;
      }
      // Spam infantry from barracks (cheap fast defenders)
      if (canProduceUnit(f, 'infantry', state)) {
        aiQueueUnit('infantry', state);
        // Continue to tech/produce below — emergency is additive, not blocking
      }
    }

    // Need more power? Build a Wind Trap, but ONLY if none is already under
    // construction — otherwise the AI spam-queues wind traps and runs out of
    // spice before reaching the Refinery (which costs 400 and requires power).
    const windConstructing = state.buildings.some(
      bb => bb.faction === f && bb.kind === 'wind' && bb.constructing && !bb.dead,
    );
    if (pow.prod - pow.cons <= 2 && !windConstructing) {
      aiPlaceBuilding('wind', state);
      return;
    }

    // Tech ladder. Don't double-place a kind that's already under construction
    // (would burn spice and stall the next tier of the tech tree).
    const isConstructing = (k: BuildingKind) =>
      state.buildings.some(bb => bb.faction === f && bb.kind === k && bb.constructing && !bb.dead);
    const techLadder: BuildingKind[] = ['refinery', 'barracks', 'light', 'heavy', 'hitech'];
    for (const kind of techLadder) {
      if (have(kind) || isConstructing(kind)) continue;
      if (aiPlaceBuilding(kind, state)) return;
      break;
    }

    // Upgrades — try when flush
    if (have('heavy') && !hasUpg('heavy') && state.aiSpice > 900) {
      if (aiUpgradeBuilding('heavyupg', state)) return;
    }
    if (have('yard') && !hasUpg('yard') && state.aiSpice > 1000) {
      if (aiUpgradeBuilding('yardupg', state)) return;
    }

    // Standard defence layer — gun turrets after barracks, rocket turrets after yard upgrade.
    // Caps scale with AI level: easy = thinner, hard = thicker.
    const turretCount = activeBuildings(f, state).filter(bb => bb.kind === 'turret').length;
    if (have('barracks') && turretCount < scale.maxTurrets && state.aiSpice > 400) {
      if (aiPlaceBuilding('turret', state)) return;
    }
    if (!have('radar') && have('heavy') && state.aiSpice > 700) {
      if (aiPlaceBuilding('radar', state)) return;
    }
    const rturretCount = activeBuildings(f, state).filter(bb => bb.kind === 'rturret').length;
    if (hasUpg('yard') && rturretCount < scale.maxRTurrets && state.aiSpice > 700) {
      if (aiPlaceBuilding('rturret', state)) return;
    }

    // Duplicate refineries if flush
    if (state.aiSpice > 1000 && have('refinery')) {
      const refCount = activeBuildings(f, state).filter(bb => bb.kind === 'refinery').length;
      if (refCount < 2) { aiPlaceBuilding('refinery', state); return; }
    }

    // Palace — apex tech, gives faction superweapon. Build once we have hitech + yardupg.
    if (have('hitech') && hasUpg('yard') && !have('palace') && !isConstructing('palace')
        && state.aiSpice > 1100) {
      if (aiPlaceBuilding('palace', state)) return;
    }

    // Queue units. Under threat, weight bias toward cheap defenders (infantry/trike).
    const mix: Array<() => boolean> = [];
    if (canProduceUnit(f, 'infantry', state)) {
      // Multiple entries → higher pick chance. Under threat: 4×, normal: 1×.
      const reps = threatLevel === 2 ? 4 : threatLevel === 1 ? 2 : 1;
      for (let i = 0; i < reps; i++) mix.push(() => aiQueueUnit('infantry', state));
    }
    if (canProduceUnit(f, 'trike', state)) {
      const reps = threatLevel >= 1 ? 2 : 1;
      for (let i = 0; i < reps; i++) mix.push(() => aiQueueUnit('trike', state));
    }
    if (canProduceUnit(f, 'tank',     state)) mix.push(() => aiQueueUnit('tank',     state),
                                                       () => aiQueueUnit('tank',    state));
    if (canProduceUnit(f, 'launcher',    state)) mix.push(() => aiQueueUnit('launcher',    state));
    if (canProduceUnit(f, 'siegeTank',   state)) mix.push(() => aiQueueUnit('siegeTank',   state));
    if (canProduceUnit(f, 'stealthTank', state)) mix.push(() => aiQueueUnit('stealthTank', state),
                                                          () => aiQueueUnit('stealthTank', state));
    if (canProduceUnit(f, 'special',  state)) mix.push(() => aiQueueUnit('special',  state));
    // Palace-trained elites — appear when Palace is up
    if (canProduceUnit(f, 'sardaukar',   state)) mix.push(() => aiQueueUnit('sardaukar',   state),
                                                          () => aiQueueUnit('sardaukar',   state));
    if (canProduceUnit(f, 'ornithopter', state)) mix.push(() => aiQueueUnit('ornithopter', state));

    const harvCount = state.units.filter(u => !u.dead && u.faction === f && u.kind === 'harvester').length;
    if (harvCount < 2 && canProduceUnit(f, 'harvester', state)) aiQueueUnit('harvester', state);
    const carryCount = state.units.filter(u => !u.dead && u.faction === f && u.kind === 'carryall').length;
    if (carryCount < 1 && canProduceUnit(f, 'carryall', state)) aiQueueUnit('carryall', state);

    if (mix.length) {
      const pick = mix[Math.floor(Math.random() * mix.length)]!;
      pick();
    }
  }

  // ── Scout ──────────────────────────────────────────────────
  if (b.scoutTimer <= 0) {
    b.scoutTimer = 20 + Math.random() * 10;
    const scout = state.units.find(u => !u.dead && u.faction === f && u.kind === 'trike' && !u.attackTarget);
    if (scout) {
      scout.target = { x: 5 + Math.random() * 62, y: 5 + Math.random() * 30 };
    }
  }

  // ── Attack waves ────────────────────────────────────────────
  if (b.attackTimer <= 0) {
    const minutesPassed = Math.floor(state.time / 60);
    const waveSize = Math.max(2, Math.round((3 + minutesPassed * 2) * scale.waveSizeMul));
    b.attackTimer = (Math.max(20, 40 - minutesPassed * 3) + Math.random() * 8) * scale.attackTempo;

    const playerYard = findBuilding(state.faction, 'yard', state);
    if (!playerYard) return;

    // Don't filter out units with attackTarget — engaging units are still part of the wave;
    // we just don't reissue their orders mid-fight.
    const force = state.units.filter(u =>
      !u.dead && u.faction === f &&
      u.kind !== 'harvester' && u.kind !== 'carryall' && !u.docked,
    );

    const cx = playerYard.tx + playerYard.w / 2;
    const cy = playerYard.ty + playerYard.h / 2;
    for (let i = 0; i < Math.min(force.length, waveSize + 3); i++) {
      const u = force[i]!;
      // Only reissue march orders to idle units (no current attack target);
      // engaged units finish the fight and then resume the existing u.target.
      if (!u.attackTarget) {
        u.target = { x: cx + (Math.random() - 0.5) * 5, y: cy + (Math.random() - 0.5) * 5 };
      }
    }
  }

  // ── Palace super-ability ───────────────────────────────────
  // Use it as soon as it's ready — AI doesn't hoard charges.
  for (const bb of state.buildings) {
    if (bb.faction !== f || bb.kind !== 'palace') continue;
    if (!isPalaceReady(bb)) continue;
    if (f === 'harkonnen') {
      // Death Hand — aim at player Construction Yard (or yard centre).
      const playerYard = findBuilding(state.faction, 'yard', state);
      if (!playerYard) continue;
      activatePalaceSuper(bb, state, {
        x: playerYard.tx + playerYard.w / 2,
        y: playerYard.ty + playerYard.h / 2,
      });
    } else {
      // Atreides Fremen / Ordos Saboteur — no targeting required.
      activatePalaceSuper(bb, state, null);
    }
  }

  // ── Continuous threat response ─────────────────────────────
  // Every brain tick, idle AI combat units scan for nearby threats and engage.
  // Makes base defenders react to scouts/raiders instead of standing around.
  for (const u of state.units) {
    if (u.dead || u.faction !== f || u.docked) continue;
    if (u.kind === 'harvester' || u.kind === 'carryall') continue;
    if (u.attackTarget || u.target) continue;
    let nearest: number | null = null;
    let bd = 8; // detection radius for idle defenders
    // Don't target air units unless we have anti-air ourselves; otherwise the
    // defender locks onto an unreachable target and stops responding.
    const stats = statsFor(f, u.kind);
    const canAA = !!stats.antiAir;
    for (const e of state.units) {
      if (e.dead || e.faction === f || e.carried || e.docked || e.kind === 'carryall') continue;
      if (e.kind === 'ornithopter' && !canAA) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d < bd) { bd = d; nearest = e.id; }
    }
    if (nearest !== null) u.attackTarget = nearest;
  }
}
