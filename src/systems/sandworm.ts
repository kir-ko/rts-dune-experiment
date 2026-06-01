import type { GameState, Worm, Unit, Tile } from '../types/index.js';
import { MAP_W, MAP_H } from '../constants/map.js';
import { genId } from '../state/gameState.js';

// Tuning
const MAX_WORMS = 2;
// Slower than slowest harvester variant (Harkonnen 1.08 t/s) so a player
// who reacts in time can always escape with their harvester.
const WORM_SPEED = 1.0;          // tiles/sec while travelling
const WORM_HUNT_RANGE = 18;      // initial victim search radius
const WORM_ATTACK_RANGE = 0.7;   // tile distance for kill
const WORM_TRAVEL_TIMEOUT = 30;  // give up if can't reach
const WORM_DIVE_TIME = 4;        // seconds before despawning after meal
const SPAWN_BASE_INTERVAL = 75;  // average seconds between spawns

function tileAt(state: GameState, tx: number, ty: number): Tile | null {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return null;
  return state.map[ty]![tx]!;
}

function isSand(state: GameState, x: number, y: number): boolean {
  const t = tileAt(state, Math.floor(x), Math.floor(y));
  if (!t) return false;
  return t.type !== 'rock';
}

function findVictim(state: GameState, w: Worm): Unit | null {
  let best: Unit | null = null;
  let bd = WORM_HUNT_RANGE;
  for (const u of state.units) {
    if (u.dead || u.carried || u.docked) continue;
    if (u.kind === 'carryall' || u.kind === 'ornithopter') continue; // air units immune
    // Worm hunts ONLY units on sand. Rock is a sanctuary — strategic refineries
    // built next to rock are intentionally safe.
    if (!isSand(state, u.x, u.y)) continue;
    const d = Math.hypot(u.x - w.x, u.y - w.y);
    // Strong preference for harvesters
    const weight = u.kind === 'harvester' ? 0.4 : 1;
    if (d * weight < bd) { bd = d * weight; best = u; }
  }
  return best;
}

function spawnWorm(state: GameState): void {
  // Pick a sand tile far from any base
  for (let tries = 0; tries < 30; tries++) {
    const tx = 4 + Math.floor(Math.random() * (MAP_W - 8));
    const ty = 4 + Math.floor(Math.random() * (MAP_H - 8));
    const t = tileAt(state, tx, ty);
    if (!t || t.type === 'rock') continue;
    // keep distance from buildings
    const tooClose = state.buildings.some(b => {
      if (b.dead) return false;
      return Math.hypot(b.tx + b.w / 2 - tx, b.ty + b.h / 2 - ty) < 8;
    });
    if (tooClose) continue;
    state.worms.push({
      id: genId(),
      x: tx + 0.5, y: ty + 0.5,
      mode: 'underground',
      target: null,
      victimId: null,
      timer: 2 + Math.random() * 3,
      dir: Math.random() * Math.PI * 2,
      dead: false,
    });
    return;
  }
}

function killVictim(state: GameState, w: Worm, victim: Unit): void {
  // Big rumble effect at the bite point
  state.fx.push({ x: w.x, y: w.y, scale: 1.2, t: 0, life: 0.7, kind: 'expl' });
  victim.hp = 0;
  victim.dead = true;
  // Drop the carryall cargo if eaten while being lifted
  const carrier = state.units.find(c => c.kind === 'carryall' && c.cargo === victim);
  if (carrier) carrier.cargo = null;
}

export function updateWorms(state: GameState, dt: number): void {
  // Spawn pacing — at most MAX_WORMS active
  state.wormTimer -= dt;
  if (state.wormTimer <= 0 && state.worms.filter(w => !w.dead).length < MAX_WORMS) {
    spawnWorm(state);
    state.wormTimer = SPAWN_BASE_INTERVAL + Math.random() * 30;
  }

  for (const w of state.worms) {
    if (w.dead) continue;

    if (w.mode === 'underground') {
      w.timer -= dt;
      if (w.timer <= 0) {
        const v = findVictim(state, w);
        if (v) {
          w.victimId = v.id;
          w.target = { x: v.x, y: v.y };
          w.mode = 'travel';
          w.timer = WORM_TRAVEL_TIMEOUT;
        } else {
          // No prey — sink away
          w.mode = 'dive';
          w.timer = 1;
        }
      }
      continue;
    }

    if (w.mode === 'travel') {
      w.timer -= dt;
      const v = state.units.find(u => u.id === w.victimId);
      // Lost target if dead, carried, docked, OR moved onto rock (worm can't follow there)
      if (!v || v.dead || v.carried || v.docked || !isSand(state, v.x, v.y)) {
        w.mode = 'dive'; w.timer = 1; continue;
      }
      w.target = { x: v.x, y: v.y };
      const dx = w.target.x - w.x, dy = w.target.y - w.y;
      const d = Math.hypot(dx, dy);
      w.dir = Math.atan2(dy, dx);

      if (d <= WORM_ATTACK_RANGE) {
        killVictim(state, w, v);
        w.mode = 'dive';
        w.timer = WORM_DIVE_TIME;
        continue;
      }

      const step = Math.min(WORM_SPEED * dt, d);
      const nx = w.x + (dx / d) * step;
      const ny = w.y + (dy / d) * step;
      // Worm cannot enter rock — if the direct path runs into rock, dive away.
      // Player can use rocky terrain as a sanctuary / worm-blocker.
      if (!isSand(state, nx, ny)) {
        w.mode = 'dive'; w.timer = 1;
        continue;
      }
      w.x = nx; w.y = ny;
      // Trail of dust while travelling
      if (Math.random() < 0.4) {
        state.fx.push({
          x: w.x - Math.cos(w.dir) * 0.4,
          y: w.y - Math.sin(w.dir) * 0.4,
          scale: 0.35, t: 0, life: 0.6, kind: 'wormtrail',
        });
      }
      if (w.timer <= 0) { w.mode = 'dive'; w.timer = 1; }
      continue;
    }

    if (w.mode === 'attack') {
      // unused — kept for completeness
      w.mode = 'dive'; w.timer = 1;
      continue;
    }

    if (w.mode === 'dive') {
      w.timer -= dt;
      if (w.timer <= 0) w.dead = true;
    }
  }

  state.worms = state.worms.filter(w => !w.dead);
}
