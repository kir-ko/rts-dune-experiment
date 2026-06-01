import type { GameState, Unit, Building, Projectile, FactionId } from '../types/index.js';
import { statsFor } from '../constants/units.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { buildingCenter } from '../state/gameState.js';
import { isCrushable } from './crush.js';

function spawnExplosion(state: GameState, x: number, y: number, scale: number): void {
  state.fx.push({ x, y, scale, t: 0, life: 0.6, kind: 'expl' });
}

export function damageEntity(
  state: GameState, ent: Unit | Building, dmg: number,
  attacker?: Unit | Building,
): void {
  ent.hp -= dmg;
  // Retaliation: a unit (not building) without a current target locks onto its attacker.
  // Only when attacker is a Unit (skipping turret retaliation cascades for now).
  if (!('tx' in ent) && ent.hp > 0 && attacker && !('tx' in attacker)) {
    const u = ent as Unit;
    // holdFire = player issued an explicit move order. Don't hijack the unit
    // to chase whoever shoots it — otherwise tracked vehicles told to drive
    // through enemy infantry stop mid-path to retaliate, requiring the player
    // to re-issue the move order on every hit. They'll just plow through and
    // crush the attackers (or take the damage if non-crushable).
    if (!u.attackTarget && !u.holdFire
        && u.kind !== 'harvester' && u.kind !== 'carryall' && !u.docked) {
      u.attackTarget = attacker.id;
    }
    // ── Harvester self-defence: if attacked by a crushable foot unit (infantry,
    // fremen, saboteur), the harvester drives over to flatten the attacker, then
    // resumes mining via the 'moving' arrival logic. Uses attackTarget so the
    // chase keeps following the (moving) attacker each tick, not a stale snapshot.
    if (u.kind === 'harvester' && !u.docked && !u.carried
        && attacker.faction !== u.faction && isCrushable(attacker as Unit)) {
      const a = attacker as Unit;
      u.attackTarget = a.id;
      u.target = { x: a.x, y: a.y };
      u.mode = 'moving';
      u.path = null;
      u.commandedReturn = false;
      u.parkedOnRock = false;
    }
  }
  if (ent.hp > 0) return;

  ent.dead = true;

  // Check win/loss condition — Construction Yard destroyed
  if ('tx' in ent && ent.kind === 'yard') {
    if (ent.faction === state.aiFaction) triggerVictory(state, true);
    else triggerVictory(state, false);
    const c = buildingCenter(ent);
    spawnExplosion(state, c.x, c.y, Math.max(ent.w, ent.h) * 0.7);
  } else if ('tx' in ent) {
    const c = buildingCenter(ent);
    spawnExplosion(state, c.x, c.y, 1.5);
  } else {
    spawnExplosion(state, (ent as Unit).x, (ent as Unit).y, 1);
  }
}

function triggerVictory(state: GameState, win: boolean): void {
  state.over = true;
  const screen = document.getElementById('endscreen') as HTMLElement;
  const msg = document.getElementById('endmsg') as HTMLElement;
  screen.classList.add(win ? 'win' : 'lose');
  screen.style.display = 'flex';
  msg.textContent = win ? 'VICTORY' : 'DEFEAT';
}

// ── Fire from a Unit ─────────────────────────────────────────
export function fireProjectile(
  state: GameState, from: Unit, to: Unit | Building,
  scatter = 0,
): void {
  const stats = statsFor(from.faction, from.kind);
  if (!stats.projectile) return;
  const tc = 'tx' in to ? buildingCenter(to) : { x: to.x, y: to.y };
  const tx = tc.x + (scatter > 0 ? (Math.random() - 0.5) * 2 * scatter : 0);
  const ty = tc.y + (scatter > 0 ? (Math.random() - 0.5) * 2 * scatter : 0);
  state.projectiles.push({
    x: from.x, y: from.y,
    tx, ty,
    dir: Math.atan2(ty - from.y, tx - from.x),
    targetId: to.id,
    sourceId: from.id,
    sourceFaction: from.faction,
    dmg: stats.dmg,
    splash: stats.splash,
    kind: stats.projectile,
    speed: stats.projectile === 'rocket' ? 10 : 14,
    dead: false,
  });
}

// ── Fire from a Building (turret) ─────────────────────────────
export function fireBuildingProjectile(state: GameState, from: Building, to: Unit | Building): void {
  const def = BUILD_DEFS[from.kind];
  const w = def.weapon;
  if (!w) return;
  const c = buildingCenter(from);
  const tc = 'tx' in to ? buildingCenter(to) : { x: to.x, y: to.y };
  state.projectiles.push({
    x: c.x, y: c.y,
    tx: tc.x, ty: tc.y,
    dir: Math.atan2(tc.y - c.y, tc.x - c.x),
    targetId: to.id,
    sourceId: from.id,
    sourceFaction: from.faction,
    dmg: w.dmg,
    splash: w.splash,
    kind: w.projectile,
    speed: w.projectile === 'rocket' ? 10 : 16,
    dead: false,
  });
}


export function updateProjectiles(state: GameState, dt: number): void {
  const { projectiles, units, buildings } = state;

  for (const p of projectiles) {
    if (p.dead) continue;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = p.speed * dt;

    if (d < step) {
      p.dead = true;

      const attacker = units.find(u => u.id === p.sourceId) ?? buildings.find(b => b.id === p.sourceId);
      if (p.splash > 0) {
        // Area damage
        for (const u of units) {
          if (u.dead || u.faction === p.sourceFaction || u.carried || u.docked) continue;
          if (u.kind === 'carryall' || u.kind === 'ornithopter') continue; // ground splash doesn't reach air
          const dd = Math.hypot(u.x - p.tx, u.y - p.ty);
          if (dd < p.splash) damageEntity(state, u, p.dmg * (1 - dd / (p.splash + 0.5)), attacker);
        }
        for (const b of buildings) {
          if (b.dead || b.faction === p.sourceFaction) continue;
          const c = buildingCenter(b);
          const dd = Math.hypot(c.x - p.tx, c.y - p.ty) - Math.max(b.w, b.h) / 2;
          if (dd < p.splash) damageEntity(state, b, p.dmg * 0.7, attacker);
        }
        spawnExplosion(state, p.tx, p.ty, p.splash * 0.6);
      } else {
        const target = units.find(u => u.id === p.targetId) ?? buildings.find(b => b.id === p.targetId);
        if (target && !target.dead) damageEntity(state, target, p.dmg, attacker);
        spawnExplosion(state, p.tx, p.ty, 0.4);
      }
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
  }

  state.projectiles = projectiles.filter(p => !p.dead);
  state.fx = state.fx.filter(f => f.t < f.life);
}

/**
 * Stealth visibility — returns true if `target` is observable to `viewerFaction`.
 * Stealth units (with stealthRange > 0) are invisible unless an observer of the
 * viewer faction is within stealthRange tiles.
 */
export function isStealthVisible(state: GameState, target: Unit, viewerFaction: FactionId): boolean {
  const tStats = statsFor(target.faction, target.kind);
  const sR = tStats.stealthRange ?? 0;
  if (sR <= 0) return true;
  if (target.faction === viewerFaction) return true;
  for (const fu of state.units) {
    if (fu.dead || fu.faction !== viewerFaction || fu.carried || fu.docked) continue;
    if (Math.hypot(fu.x - target.x, fu.y - target.y) <= sR) return true;
  }
  for (const fb of state.buildings) {
    if (fb.dead || fb.faction !== viewerFaction) continue;
    const c = buildingCenter(fb);
    const d = Math.hypot(c.x - target.x, c.y - target.y) - Math.max(fb.w, fb.h) / 2;
    if (d <= sR) return true;
  }
  return false;
}

// ── Find nearest enemy of a Unit ─────────────────────────────
export function findNearestEnemy(state: GameState, unit: Unit, maxR?: number): Unit | Building | null {
  const stats = statsFor(unit.faction, unit.kind);
  const r = maxR ?? stats.range;
  const canAA = !!stats.antiAir;
  let best: Unit | Building | null = null;
  let bd = r;

  for (const u of state.units) {
    if (u.dead || u.faction === unit.faction || u.carried || u.docked) continue;
    // Skip flying targets unless we have anti-air capability
    const stat = statsFor(u.faction, u.kind);
    if (stat.fly && !canAA) continue;
    if (!stat.fly && u.kind === 'carryall') continue; // safety (currently same as fly check)
    // Stealth — can't auto-target invisible enemies
    if (!isStealthVisible(state, u, unit.faction)) continue;
    const d = Math.hypot(u.x - unit.x, u.y - unit.y);
    if (d < bd) { bd = d; best = u; }
  }
  for (const b of state.buildings) {
    if (b.dead || b.faction === unit.faction) continue;
    const c = buildingCenter(b);
    const d = Math.hypot(c.x - unit.x, c.y - unit.y) - Math.max(b.w, b.h) / 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// ── Find nearest enemy of a Building (for turrets) ───────────
export function findNearestEnemyForBuilding(
  state: GameState, b: Building, maxR: number,
): Unit | Building | null {
  const c = buildingCenter(b);
  let best: Unit | Building | null = null;
  let bd = maxR;
  for (const u of state.units) {
    if (u.dead || u.faction === b.faction || u.carried || u.docked) continue;
    // Ground turrets can't shoot up — air units (carryall, ornithopter) pass over.
    if (u.kind === 'carryall' || u.kind === 'ornithopter') continue;
    // Turrets respect stealth — invisible units pass through unmolested
    if (!isStealthVisible(state, u, b.faction)) continue;
    const d = Math.hypot(u.x - c.x, u.y - c.y);
    if (d < bd) { bd = d; best = u; }
  }
  for (const eb of state.buildings) {
    if (eb.dead || eb.faction === b.faction || eb.id === b.id) continue;
    const ec = buildingCenter(eb);
    const d = Math.hypot(ec.x - c.x, ec.y - c.y) - Math.max(eb.w, eb.h) / 2;
    if (d < bd) { bd = d; best = eb; }
  }
  return best;
}

// ── Tick all turret buildings ────────────────────────────────
export function updateTurrets(state: GameState, dt: number): void {
  for (const b of state.buildings) {
    if (b.dead || b.constructing) continue;
    const def = BUILD_DEFS[b.kind];
    const w = def.weapon;
    if (!w) continue;

    b.cooldown -= dt;

    let target = b.attackTarget
      ? (state.units.find(u => u.id === b.attackTarget && !u.dead && u.faction !== b.faction)
        ?? state.buildings.find(bb => bb.id === b.attackTarget && !bb.dead && bb.faction !== b.faction)
        ?? null)
      : null;

    // Validate range / acquire new target
    const c = buildingCenter(b);
    const inRange = (e: Unit | Building): boolean => {
      const tc = 'tx' in e ? buildingCenter(e) : { x: e.x, y: e.y };
      return Math.hypot(tc.x - c.x, tc.y - c.y) <= w.range + 0.5;
    };
    if (target && !inRange(target)) target = null;
    if (!target) {
      target = findNearestEnemyForBuilding(state, b, w.range);
      b.attackTarget = target ? target.id : null;
    }

    if (!target) continue;

    const tc = 'tx' in target ? buildingCenter(target) : { x: target.x, y: target.y };
    b.dir = Math.atan2(tc.y - c.y, tc.x - c.x);

    if (b.cooldown <= 0) {
      fireBuildingProjectile(state, b, target);
      b.cooldown = w.cd;
    }
  }
}
