import type { GameState, Unit, Building, FactionId, UnitKind, BuildingKind, AILevel } from '../types/index.js';
import { statsFor } from '../constants/units.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { FACTION_PERKS } from '../constants/factions.js';
import { MAP_W, MAP_H, setMapSize, type MapSize } from '../constants/map.js';
import { generateMap } from '../map/generator.js';

export interface SkirmishOptions {
  mapSize: MapSize;
  aiLevel: AILevel;
  wormsEnabled: boolean;
}

export const DEFAULT_SKIRMISH: SkirmishOptions = {
  mapSize: 'medium',
  aiLevel: 'medium',
  wormsEnabled: true,
};

// Starting spice per AI level. Player gets a fixed amount; AI start is scaled.
const AI_START_SPICE: Record<AILevel, number> = {
  easy:   500,
  medium: 800,
  hard:   1200,
};

// ── Singleton game state ─────────────────────────────────────
// Only mutated by systems/, read by render/
export let game: GameState | null = null;

let nextId = 1;
export function resetIds(): void { nextId = 1; }
export function genId(): number { return nextId++; }

// ── Factories ────────────────────────────────────────────────
export function makeUnit(faction: FactionId, kind: UnitKind, x: number, y: number, ai: boolean): Unit {
  const stats = statsFor(faction, kind);
  return {
    id: genId(), faction, kind, x, y,
    hp: stats.hp, maxHp: stats.hp,
    dir: ai ? Math.PI : 0,
    target: null,
    attackTarget: null,
    cooldown: 0,
    spice: 0, mode: kind === 'harvester' ? 'idle' : null,
    cargo: null, carryTarget: null,
    autoCarry: kind === 'carryall',
    idleTimer: 0,
    lastDropId: null,
    dropCooldown: 0,
    carried: false,
    depositTimer: 0,
    path: null,
    pathRecomputeIn: 0,
    waitingForTransport: false,
    docked: false,
    commandedReturn: false,
    parkedOnRock: false,
    holdFire: false,
    turretDir: ai ? Math.PI : 0,
    ai, dead: false,
  };
}

export function makeBuilding(
  faction: FactionId, kind: BuildingKind,
  tx: number, ty: number,
  ai: boolean, instant: boolean,
): Building {
  const def = BUILD_DEFS[kind];
  // Apply faction's building HP perk (Harkonnen +20%)
  const maxHp = Math.round(def.hp * FACTION_PERKS[faction].buildingHpMul);
  return {
    id: genId(), faction, kind, tx, ty,
    w: def.w, h: def.h,
    hp: instant ? maxHp : maxHp * 0.3,
    maxHp,
    constructing: !instant,
    constructTime: 0,
    constructNeed: 5,
    productionQueue: [],
    productionProgress: 0,
    cooldown: 0,
    attackTarget: null,
    dir: ai ? Math.PI : 0,
    upgraded: false,
    // Palace: first super-ability ready after 5 minutes from construction (300s).
    // For non-palace buildings field is unused.
    superCooldown: kind === 'palace' ? 300 : 0,
    ai, dead: false,
  };
}

// ── Initialise a new game ─────────────────────────────────────
export function createGame(
  faction: FactionId,
  aiFaction: FactionId,
  options: SkirmishOptions = DEFAULT_SKIRMISH,
): GameState {
  // Apply map dimensions BEFORE allocating fog / generating map.
  setMapSize(options.mapSize);

  resetIds();
  const fog: Uint8Array[] = [];
  for (let y = 0; y < MAP_H; y++) fog.push(new Uint8Array(MAP_W));

  const state: GameState = {
    faction, aiFaction,
    map: generateMap(),
    fog,
    units: [], buildings: [], projectiles: [], fx: [], worms: [],
    spice: 800, aiSpice: AI_START_SPICE[options.aiLevel],
    cap: 2000,
    selection: [], selBox: null,
    camX: 0, camY: 0,
    over: false,
    time: 0,
    // First sandworm appears at 5 minutes — gives both sides time to set up
    // economy without a worm eating the lone starting harvester.
    wormTimer: 300,
    bloomTimer: 35,
    wormsEnabled: options.wormsEnabled,
    aiLevel: options.aiLevel,
    aiBrain: { buildTimer: 1, attackTimer: 90, scoutTimer: 30 },
  };

  // ── Player base — only Construction Yard. Player must build everything from scratch. ──
  const px = 7, py = 5;
  state.buildings.push(makeBuilding(faction, 'yard', px, py, false, true));

  // ── AI base — same: only Construction Yard. Equal start. ──
  const ex = MAP_W - 9, ey = MAP_H - 7;
  state.buildings.push(makeBuilding(aiFaction, 'yard', ex, ey, true, true));

  // Centre the camera on the player's Construction Yard at game start so the
  // player sees their base, not the empty top-left corner of a large map.
  // Placed here (after the yard exists) so its world coords are known.
  state.camX = (px + 1) * 24 - 480;  // TILE=24, VIEW_W/2=480
  state.camY = (py + 1) * 24 - 300;  // VIEW_H/2=300

  game = state;
  return state;
}

// ── Convenience queries (pure, no mutation) ──────────────────
export function entityById(id: number, state: GameState): Unit | Building | null {
  return state.units.find(u => u.id === id)
    ?? state.buildings.find(b => b.id === id)
    ?? null;
}

export function activeBuildings(faction: FactionId, state: GameState): Building[] {
  return state.buildings.filter(b => !b.dead && !b.constructing && b.faction === faction);
}

export function findBuilding(faction: FactionId, kind: BuildingKind, state: GameState): Building | undefined {
  return activeBuildings(faction, state).find(b => b.kind === kind);
}

export function hasBuilding(faction: FactionId, kind: BuildingKind, state: GameState): boolean {
  if (kind === 'yardupg')
    return activeBuildings(faction, state).some(b => b.kind === 'yard' && b.upgraded);
  if (kind === 'heavyupg')
    return activeBuildings(faction, state).some(b => b.kind === 'heavy' && b.upgraded);
  return activeBuildings(faction, state).some(b => b.kind === kind);
}

export function buildingCenter(b: Building): { x: number; y: number } {
  return { x: b.tx + b.w / 2, y: b.ty + b.h / 2 };
}
