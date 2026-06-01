import type { BuildingKind, UnitKind, ProjectileKind } from '../types/index.js';

export interface BuildingDef {
  w: number;
  h: number;
  cost: number;
  hp: number;
  /** positive = power generated, negative = consumed */
  power: number;
  /** tile radius for fog reveal */
  sight: number;
  name: string;
  desc: string;
  produces: UnitKind[];
  prereq: BuildingKind[];
  /** combat (turrets only) — null for non-combat buildings */
  weapon: TurretWeapon | null;
  /** if set, this is an upgrade token for the named building kind */
  upgradeOf: BuildingKind | null;
}

export interface TurretWeapon {
  range: number;
  dmg: number;
  /** seconds between shots */
  cd: number;
  splash: number;
  projectile: ProjectileKind;
}

export const BUILD_DEFS: Record<BuildingKind, BuildingDef> = {
  yard: {
    w:2, h:2, cost:0,    hp:1500, power:-1, sight:6,
    name:'CONSTRUCTION YARD',
    desc:'Core of the base. Lose it and you lose. Repairs nearby buildings.',
    produces:[], prereq:[], weapon:null, upgradeOf:null,
  },
  wind: {
    w:1, h:2, cost:300,  hp:400,  power:+8, sight:3,
    name:'WIND TRAP',
    desc:'Generates +8 power.',
    produces:[], prereq:['yard'], weapon:null, upgradeOf:null,
  },
  refinery: {
    w:3, h:2, cost:400,  hp:1500, power:-3, sight:4,
    name:'REFINERY',
    desc:'Converts spice. Harvester delivers here.',
    produces:[], prereq:['wind'], weapon:null, upgradeOf:null,
  },
  barracks: {
    w:2, h:2, cost:300,  hp:600,  power:-2, sight:3,
    name:'BARRACKS',
    desc:'Trains infantry.',
    produces:['infantry'], prereq:['refinery'], weapon:null, upgradeOf:null,
  },
  turret: {
    w:1, h:1, cost:250,  hp:450,  power:-2, sight:5,
    name:'GUN TURRET',
    desc:'Anti-personnel cannon. Cheap perimeter defence. Requires Barracks.',
    produces:[], prereq:['barracks'],
    weapon:{ range:4.5, dmg:18, cd:0.85, splash:0, projectile:'bullet' }, upgradeOf:null,
  },
  radar: {
    w:2, h:2, cost:500,  hp:500,  power:-4, sight:8,
    name:'RADAR OUTPOST',
    desc:'Reveals enemy positions on minimap. Extended sight. Unlocks Rocket Turret.',
    produces:[], prereq:['barracks'], weapon:null, upgradeOf:null,
  },
  rturret: {
    w:1, h:1, cost:400,  hp:550,  power:-3, sight:6,
    name:'ROCKET TURRET',
    desc:'Long-range rockets vs. vehicles. Requires Yard upgrade.',
    produces:[], prereq:['yardupg'],
    weapon:{ range:6.5, dmg:30, cd:1.5, splash:0.6, projectile:'rocket' }, upgradeOf:null,
  },
  light: {
    w:2, h:2, cost:400,  hp:800,  power:-3, sight:3,
    name:'LIGHT FACTORY',
    desc:'Builds Trikes.',
    produces:['trike'], prereq:['refinery'], weapon:null, upgradeOf:null,
  },
  heavy: {
    w:3, h:2, cost:600,  hp:1000, power:-4, sight:3,
    name:'HEAVY FACTORY',
    desc:'Builds Tanks, Harvesters and Launchers. Upgrade for Launcher / Siege Tank.',
    // siegeTank requires upgraded heavy + Atr/Hark faction (see findProducer).
    produces:['tank','harvester','launcher','siegeTank'], prereq:['light'], weapon:null, upgradeOf:null,
  },
  hitech: {
    w:2, h:2, cost:600,  hp:800,  power:-5, sight:4,
    name:'HI-TECH',
    desc:'Builds special units, Carryalls. Ordos: also Stealth Tank.',
    // Stealth Tank is Ordos-only — see canFactionProduce in units.ts.
    produces:['special','carryall','stealthTank'], prereq:['heavy'], weapon:null, upgradeOf:null,
  },
  palace: {
    w:3, h:3, cost:999, hp:2000, power:-6, sight:5,
    name:'PALACE',
    desc:'Trains Sardaukar + Ornithopter. Faction superweapon: Fremen / Death Hand / Saboteur.',
    produces:['sardaukar','ornithopter'], prereq:['hitech','yardupg'], weapon:null, upgradeOf:null,
  },
  heavyupg: {
    w:0, h:0, cost:500, hp:0, power:0, sight:0,
    name:'UPGRADE HEAVY FAC.',
    desc:'Unlocks Rocket Launcher. Advanced weapons.',
    produces:[], prereq:['heavy'], weapon:null, upgradeOf:'heavy',
  },
  yardupg: {
    w:0, h:0, cost:600, hp:0, power:0, sight:0,
    name:'UPGRADE CONST. YARD',
    desc:'Unlocks Rocket Turret construction.',
    produces:[], prereq:['yard'], weapon:null, upgradeOf:'yard',
  },
};

export const BUILD_ORDER: BuildingKind[] = [
  'wind','refinery','barracks','radar','turret','rturret',
  'yardupg','light','heavy','heavyupg','hitech','palace',
];

// Auto-repair tuning.
// Each second a damaged building repairs at REPAIR_RATE * maxHp,
// charging the owner REPAIR_COST_PER_HP * hp restored.
export const REPAIR_RATE = 0.025;          // 2.5% maxHp / sec
export const REPAIR_COST_PER_HP = 0.55;    // ~55% of build cost to fully repair
