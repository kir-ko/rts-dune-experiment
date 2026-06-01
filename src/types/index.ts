// ============================================================
// Core game types — all entities are plain interfaces, no classes
// ============================================================

export type FactionId = 'atreides' | 'harkonnen' | 'ordos';
export type UnitKind = 'infantry' | 'trike' | 'tank' | 'special' | 'harvester' | 'carryall' | 'launcher'
                     | 'stealthTank' | 'siegeTank' | 'fremen' | 'sardaukar' | 'ornithopter';
export type BuildingKind =
  | 'yard' | 'wind' | 'refinery' | 'barracks' | 'radar'
  | 'light' | 'heavy' | 'hitech' | 'palace'
  | 'turret' | 'rturret'
  | 'heavyupg' | 'yardupg';
export type TileType = 'sand' | 'dune' | 'rock' | 'spice' | 'spice2';
export type HarvesterMode = 'idle' | 'moving' | 'toSpice' | 'mining' | 'toRefinery' | 'depositing';
export type ProjectileKind = 'bullet' | 'shell' | 'sonic' | 'rocket' | 'deathHand';
export type FogState = 0 | 1 | 2; // 0=unexplored | 1=explored | 2=visible
export type WormMode = 'travel' | 'attack' | 'dive' | 'underground';
export type AILevel = 'easy' | 'medium' | 'hard';

// ── Tile ────────────────────────────────────────────────────
export interface Tile {
  type: TileType;
  /** variant index 0-3 for visual diversity */
  v: number;
  /** remaining spice (0 when depleted) */
  spice: number;
}

// ── Unit ────────────────────────────────────────────────────
export interface Unit {
  id: number;
  faction: FactionId;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** angle in radians (0 = right) */
  dir: number;
  /** move-to target in tile coords */
  target: { x: number; y: number } | null;
  /** id of the entity to attack */
  attackTarget: number | null;
  /** seconds until next shot */
  cooldown: number;
  /** harvester: spice load (0-500) */
  spice: number;
  /** harvester FSM state */
  mode: HarvesterMode | null;
  /** carryall: unit currently being carried */
  cargo: Unit | null;
  /** carryall: id of unit to pick up */
  carryTarget: number | null;
  /** carryall: enable auto-shuttle logic */
  autoCarry: boolean;
  /** idle ticks for re-enabling autoCarry after manual control */
  idleTimer: number;
  /** carryall: id of last-dropped unit (suppresses immediate re-pickup) */
  lastDropId: number | null;
  /** carryall: seconds remaining of post-drop pickup lockout */
  dropCooldown: number;
  /** true while being transported by a carryall */
  carried: boolean;
  /** harvester: seconds remaining in the deposit animation at refinery */
  depositTimer: number;
  /** A* path: remaining waypoints to follow for current move order */
  path: { x: number; y: number }[] | null;
  /** seconds until next allowed A* recompute (chase mode throttling) */
  pathRecomputeIn: number;
  /** set true when spawned into a blocked spot — carryall will transport */
  waitingForTransport: boolean;
  /** harvester: docked inside refinery (sprite hidden, no collisions) */
  docked: boolean;
  /** harvester: player explicitly commanded return to refinery — overrides auto-mining decisions */
  commandedReturn: boolean;
  /** harvester: player parked it on a rock tile — suppresses auto-search for spice while idle */
  parkedOnRock: boolean;
  /** combat unit: player issued a move command — suppresses auto-targeting until target is reached */
  holdFire: boolean;
  /** combat unit: turret angle, rotates independently of body direction (tank-class units) */
  turretDir: number;
  ai: boolean;
  dead: boolean;
}

// ── Building ────────────────────────────────────────────────
export interface Building {
  id: number;
  faction: FactionId;
  kind: BuildingKind;
  /** top-left tile X */
  tx: number;
  /** top-left tile Y */
  ty: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  /** being built: hp grows from 30% to 100% */
  constructing: boolean;
  constructTime: number;
  constructNeed: number;
  productionQueue: UnitKind[];
  productionProgress: number;
  /** turret cooldown (seconds until next shot) */
  cooldown: number;
  /** turret attack target id */
  attackTarget: number | null;
  /** turret barrel facing in radians */
  dir: number;
  upgraded: boolean;
  /** palace: seconds remaining until super-ability is ready (0 = ready) */
  superCooldown: number;
  ai: boolean;
  dead: boolean;
}

// ── Sandworm ───────────────────────────────────────────────
export interface Worm {
  id: number;
  x: number;
  y: number;
  mode: WormMode;
  target: { x: number; y: number } | null;
  /** id of victim while attacking */
  victimId: number | null;
  /** seconds remaining in current mode */
  timer: number;
  dir: number;
  dead: boolean;
}

// ── Projectile ──────────────────────────────────────────────
export interface Projectile {
  x: number;
  y: number;
  /** target tile coords */
  tx: number;
  ty: number;
  /** direction in radians (atan2 toward target at spawn time) */
  dir: number;
  targetId: number;
  /** id of the attacker (Unit or Building) — used for retaliation */
  sourceId: number;
  sourceFaction: FactionId;
  dmg: number;
  splash: number;
  kind: ProjectileKind;
  speed: number;
  dead: boolean;
}

// ── Effect ──────────────────────────────────────────────────
export interface Effect {
  x: number;
  y: number;
  scale: number;
  t: number;
  life: number;
  kind: 'expl' | 'wormtrail' | 'bloom' | 'corpse';
  /** corpse only: faction colour for the body */
  faction?: FactionId;
}

// ── Power ───────────────────────────────────────────────────
export interface PowerStats {
  prod: number;
  cons: number;
  /** min(1, prod/cons) — 1.0 = full power, <1 = brown-out */
  ratio: number;
}

// ── AI Brain ────────────────────────────────────────────────
export interface AIBrain {
  buildTimer: number;
  attackTimer: number;
  scoutTimer: number;
}

// ── Game State ───────────────────────────────────────────────
export interface GameState {
  faction: FactionId;
  aiFaction: FactionId;
  map: Tile[][];
  /** 2-D fog array [y][x], FogState */
  fog: Uint8Array[];
  units: Unit[];
  buildings: Building[];
  projectiles: Projectile[];
  fx: Effect[];
  worms: Worm[];
  spice: number;
  aiSpice: number;
  cap: number;
  selection: number[];
  selBox: { x0: number; y0: number; x1: number; y1: number } | null;
  camX: number;
  camY: number;
  over: boolean;
  /** elapsed seconds since game started */
  time: number;
  /** seconds until next worm spawn */
  wormTimer: number;
  /** seconds until next spice bloom */
  bloomTimer: number;
  /** Skirmish: if false, sandworms never spawn. */
  wormsEnabled: boolean;
  /** Skirmish: AI difficulty — scales build/attack tempo, wave sizes, start spice. */
  aiLevel: AILevel;
  aiBrain: AIBrain;
}
