/**
 * Procedural pixel-art sprite generation using PixiJS Graphics → RenderTexture.
 * All sprites are pre-rendered at startup and cached.
 * To add a new sprite: add a function, call it in generateSprites(), export the key.
 */
import { Application, Graphics, RenderTexture, Texture } from 'pixi.js';
import type { FactionId, BuildingKind, UnitKind } from '../types/index.js';
import { TILE } from '../constants/map.js';

// ── Colour constants (hex) ────────────────────────────────────
const C = {
  sand:    [0xd4a857, 0xcc9c48, 0xc69440, 0xbc8a3a] as const,
  dune:    0xa87830,
  rock:    [0x5c4a33, 0x4a3a26, 0x3e3020] as const,
  spice:   0xff8c2a,
  spice2:  0xff6420,
  dark:    0x1a1208,
  pad:     0x5c4a33,
  lightPad:0x7a6244,
  skin:    0xf0c898,
  grey:    0x888888,
  yellow:  0xffc870,
  blue:    0x88aacc,
};

export type SpriteKey = string;
export const spriteCache = new Map<SpriteKey, Texture>();

let _app: Application;

export function initSprites(app: Application): void {
  _app = app;
  generateTiles();
  generateUnitSprites();
  generateBuildingSprites();
  generateProjectileSprites();
}

// ── Helpers ──────────────────────────────────────────────────
function pxRect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.beginFill(color); g.drawRect(x, y, w, h); g.endFill();
}
function storeAs(key: string, g: Graphics): Texture {
  const tex = _app.renderer.generateTexture(g, { resolution: 1 });
  spriteCache.set(key, tex);
  g.destroy();
  return tex;
}
function rng(seed: number) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 1000) / 1000; };
}

// ── Tiles ─────────────────────────────────────────────────────
function generateTiles(): void {
  // Sand variants
  for (let v = 0; v < 4; v++) {
    const g = new Graphics();
    pxRect(g, 0, 0, TILE, TILE, C.sand[v]!);
    const r = rng((v + 1) * 1337);
    for (let i = 0; i < 8; i++) {
      pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 1, 1,
        v % 2 ? C.sand[(v + 1) % 4]! : C.sand[(v + 2) % 4]!);
    }
    storeAs(`tile_sand${v}`, g);
  }

  // Dune
  {
    const g = new Graphics();
    pxRect(g, 0, 0, TILE, TILE, C.sand[1]);
    for (let i = 0; i < TILE; i++) {
      const y = Math.floor(8 + Math.sin(i * 0.6) * 3);
      pxRect(g, i, y, 1, 2, C.dune);
      pxRect(g, i, y - 1, 1, 1, 0xbc9040);
    }
    storeAs('tile_dune', g);
  }

  // Rock variants
  for (let v = 0; v < 3; v++) {
    const g = new Graphics();
    pxRect(g, 0, 0, TILE, TILE, C.rock[v]!);
    const r = rng((v + 7) * 9301);
    for (let i = 0; i < 14; i++) pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 2, 1, 0x2e2014);
    for (let i = 0; i < 6; i++)  pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 1, 1, 0x7a6244);
    storeAs(`tile_rock${v}`, g);
  }

  // Spice variants — clearly orange-tinted to stand out on sand
  {
    // spice0: scattered deposits
    const g = new Graphics();
    pxRect(g, 0, 0, TILE, TILE, 0xc8903c); // warm orange-sand base
    const r = rng(1 * 8419);
    for (let i = 0; i < 28; i++) pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 2, 1, C.spice);
    for (let i = 0; i < 14; i++) pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 1, 1, 0xffb060);
    storeAs('tile_spice0', g);
  }
  {
    // spice1: dense spice field — deep orange
    const g = new Graphics();
    pxRect(g, 0, 0, TILE, TILE, 0xd0721a); // rich orange base
    const r = rng(2 * 8419);
    for (let i = 0; i < 42; i++) pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 2, 2, C.spice2);
    for (let i = 0; i < 20; i++) pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 1, 1, 0xffe060);
    for (let i = 0; i < 10; i++) pxRect(g, Math.floor(r() * TILE), Math.floor(r() * TILE), 2, 1, 0xff4000);
    storeAs('tile_spice1', g);
  }
}

// ── Units ─────────────────────────────────────────────────────
// All units face RIGHT (angle=0) and are rotated at draw-time
const factions: FactionId[] = ['atreides', 'harkonnen', 'ordos'];
const factionColors: Record<FactionId, { p: number; s: number; light: number }> = {
  atreides:  { p: 0x3a78d8, s: 0x1a4a9a, light: 0x6aa0e0 },
  harkonnen: { p: 0xcc2424, s: 0x7a1010, light: 0xff5454 },
  ordos:     { p: 0x2c9c44, s: 0x1a5a26, light: 0x5ac670 },
};

// ── 3/4 top-down perspective helpers ─────────────────────────
// All units use a 24×24 transparent canvas (matches TILE size). Light source
// is from the top-left, so each surface gets a 1px highlight on its top edge
// and a 1px shadow on its bottom-right edge.

/** Create a unit graphics canvas of given size with transparent backing. */
function unitG(size = 24): Graphics {
  const g = new Graphics();
  g.beginFill(0, 0); g.drawRect(0, 0, size, size); g.endFill();
  return g;
}

/** Solid block with depth: dark border, mid base, light top edge. */
function depth(g: Graphics, x: number, y: number, w: number, h: number,
               base: number, top: number, bot: number = C.dark): void {
  pxRect(g, x, y, w, h, base);
  if (h > 1) pxRect(g, x, y, w, 1, top);            // top highlight
  if (h > 1) pxRect(g, x, y + h - 1, w, 1, bot);    // bottom shadow
}

/** Tank tread strip: dark band with periodic lighter tread plates.
 * Used along the long axis (horizontal here, since vehicles face right). */
function treads(g: Graphics, x: number, y: number, w: number, h: number): void {
  pxRect(g, x, y, w, h, 0x0e0a06);
  // tread plates every 3 px
  const segs = Math.floor(w / 3);
  for (let i = 0; i < segs; i++) {
    pxRect(g, x + 1 + i * 3, y, 1, h, 0x4a4030);
  }
  // top edge slight highlight
  pxRect(g, x, y, w, 1, 0x2a1f12);
}

/** Tiny barrel/gun pointing RIGHT, with tip glow. */
function barrel(g: Graphics, x: number, y: number, len: number, w: number = 2): void {
  pxRect(g, x, y, len, w, C.dark);
  pxRect(g, x, y, len - 1, 1, 0x666666);          // top edge sheen
  pxRect(g, x + len - 1, y, 1, w, 0xcccccc);      // muzzle tip
}

function generateUnitSprites(): void {
  for (const f of factions) {
    const { p, s, light: lt } = factionColors[f];

    // ── Infantry (24×24) — top-down foot soldier ────────────────
    // Helmet/head visible from above, shoulders, small frame, rifle pointing right.
    {
      const g = unitG(24);
      // Drop shadow (renderer adds another, but a sprite-level shadow grounds it)
      pxRect(g, 9, 16, 6, 1, 0x000000);
      // Body / torso — slightly tapered, 3-tone shading
      pxRect(g, 10, 9, 4, 7, C.dark);
      pxRect(g, 10, 9, 4, 6, p);
      pxRect(g, 10, 9, 4, 1, lt);
      // Faction sash across chest
      pxRect(g, 10, 12, 4, 1, s);
      // Shoulders (slightly wider than torso)
      pxRect(g, 9, 9, 1, 3, C.dark);
      pxRect(g, 14, 9, 1, 3, C.dark);
      // Helmet (round-ish dome from above)
      pxRect(g, 10, 6, 4, 3, C.dark);
      pxRect(g, 10, 6, 4, 1, 0x4a4030);
      pxRect(g, 11, 7, 2, 2, C.skin);
      // Rifle pointing right
      barrel(g, 14, 11, 4, 1);
      storeAs(`unit_${f}_infantry`, g);
    }

    // ── Trike (24×24) — light wheeled scout ────────────────────
    // 3 wheels, open frame, exposed rider, machine gun forward.
    {
      const g = unitG(24);
      // Drop shadow
      pxRect(g, 5, 19, 14, 1, 0x000000);
      // Wheels (rear left, rear right, front-centre) — slightly raised
      pxRect(g, 5, 7, 3, 3, C.dark);   pxRect(g, 5, 7, 3, 1, 0x444444);  // rear left
      pxRect(g, 5, 14, 3, 3, C.dark);  pxRect(g, 5, 14, 3, 1, 0x444444); // rear right
      pxRect(g, 18, 10, 3, 4, C.dark); pxRect(g, 18, 10, 3, 1, 0x444444); // front
      // Frame / chassis
      pxRect(g, 8, 9, 10, 6, C.dark);
      depth(g, 9, 10, 8, 4, s, lt, p);
      // Rider seat / cockpit
      pxRect(g, 11, 11, 3, 2, p);
      pxRect(g, 12, 11, 1, 1, C.skin);
      // Forward MG
      barrel(g, 17, 11, 5, 2);
      storeAs(`unit_${f}_trike`, g);
    }

    // ── Tank body (24×24) — tracked, tracks on top/bottom, hatch ─
    // Body faces RIGHT. "Top" of screen = vehicle's left flank, "bottom" = right flank.
    {
      const g = unitG(24);
      // Drop shadow
      pxRect(g, 3, 20, 18, 1, 0x000000);
      // Tracks on both flanks (visual top + bottom edges)
      treads(g, 3, 4, 18, 3);   // top track
      treads(g, 3, 17, 18, 3);  // bottom track
      // Chassis (hull) between tracks
      pxRect(g, 4, 7, 16, 10, C.dark);
      depth(g, 5, 8, 14, 8, s, lt, p);
      // Centre hatch where the turret will sit (gives a "socket" look)
      pxRect(g, 9, 10, 6, 4, 0x1a1208);
      pxRect(g, 10, 11, 4, 2, 0x2a1f12);
      // Front armour plate (right edge, slight slope)
      pxRect(g, 19, 8, 1, 8, lt);
      // Faction badge (left, on hull)
      pxRect(g, 6, 11, 2, 2, p);
      storeAs(`unit_${f}_tank`, g);
    }

    // ── Tank turret (24×24, transparent canvas) ────────────────
    // Anchor (0.5) → pivot (12, 12). Housing centred, barrel right.
    {
      const g = unitG(24);
      // Turret base shadow (slightly larger than housing, soft halo)
      pxRect(g, 6, 7, 11, 11, 0x000000);
      // Turret housing
      pxRect(g, 7, 8, 9, 9, C.dark);
      depth(g, 8, 9, 7, 7, s, lt, p);
      // Hatch detail
      pxRect(g, 10, 11, 3, 3, 0x2a1f12);
      pxRect(g, 11, 12, 1, 1, 0x666666);
      // Mantle (front of turret, where barrel attaches)
      pxRect(g, 16, 10, 1, 5, C.dark);
      // Barrel — extends right
      barrel(g, 17, 11, 6, 3);
      storeAs(`unit_${f}_tank_turret`, g);
    }

    // ── Special (24×24) — faction-unique unit ──────────────────
    {
      const g = unitG(24);
      if (f === 'ordos') {
        // Ordos = Saboteur — hooded kamikaze with TNT backpack
        pxRect(g, 9, 17, 6, 1, 0x000000);                // shadow
        // Hooded body
        pxRect(g, 10, 8, 4, 9, C.dark);
        pxRect(g, 10, 9, 4, 7, 0x404040);                // dark cloak
        pxRect(g, 10, 9, 4, 1, 0x666666);                // hood top highlight
        pxRect(g, 11, 11, 2, 1, p);                      // faction sash
        // Hood opening / face
        pxRect(g, 11, 10, 2, 1, C.skin);
        // Explosive backpack (left/back)
        pxRect(g, 7, 11, 3, 4, 0x6a1010);
        pxRect(g, 8, 12, 2, 2, 0xff5020);
        pxRect(g, 8, 13, 2, 1, 0xffd860);                // detonator wire glow
        // Detonator hand (right)
        pxRect(g, 14, 12, 2, 1, C.dark);
        pxRect(g, 16, 12, 1, 1, 0xff5020);
      } else {
        // Atreides Sonic Tank / Harkonnen Devastator — heavy tracked weapon platform
        // Drop shadow
        pxRect(g, 3, 20, 18, 1, 0x000000);
        // Tracks
        treads(g, 3, 4, 18, 3);
        treads(g, 3, 17, 18, 3);
        // Heavy hull (wider, more armoured than tank)
        pxRect(g, 3, 7, 18, 10, C.dark);
        depth(g, 4, 8, 16, 8, s, lt, p);
        // Faction-specific weapon mount on top
        if (f === 'atreides') {
          // Sonic emitter — circular dish at front
          pxRect(g, 13, 9, 6, 6, 0x1a4a9a);
          pxRect(g, 14, 10, 4, 4, 0x88aacc);
          pxRect(g, 15, 11, 2, 2, 0xffffff);             // emitter core
          // Bracing struts
          pxRect(g, 13, 9, 1, 6, C.dark);
          pxRect(g, 18, 9, 1, 6, C.dark);
        } else {
          // Devastator — twin barrels, heavier armour plates, smokestacks
          pxRect(g, 5, 9, 14, 6, 0x6a1010);              // dark hull plate
          pxRect(g, 6, 10, 12, 4, p);
          // Twin cannons forward
          barrel(g, 19, 9, 4, 2);
          barrel(g, 19, 13, 4, 2);
          // Smokestacks (rear)
          pxRect(g, 4, 8, 2, 2, C.dark);
          pxRect(g, 4, 14, 2, 2, C.dark);
          pxRect(g, 4, 7, 2, 1, 0x666666);
          pxRect(g, 4, 16, 2, 1, 0x666666);
        }
      }
      storeAs(`unit_${f}_special`, g);
    }

    // ── Harvester (28×24) — large industrial mining truck ──────
    // Cab front-right, conveyor + storage bin, tracks both flanks.
    {
      const g = unitG(28);
      // Adjust canvas to match
      g.clear();
      g.beginFill(0, 0); g.drawRect(0, 0, 28, 24); g.endFill();
      // Drop shadow
      pxRect(g, 3, 20, 22, 1, 0x000000);
      // Tracks
      treads(g, 3, 4, 22, 3);
      treads(g, 3, 17, 22, 3);
      // Main hull / storage bin
      pxRect(g, 3, 7, 18, 10, C.dark);
      depth(g, 4, 8, 16, 8, 0x8a6a3a, 0xb89060, 0x665030);
      // Spice indicator strips on side
      pxRect(g, 5, 11, 14, 1, C.spice);
      pxRect(g, 5, 13, 14, 1, 0xffd860);
      // Faction badge
      pxRect(g, 7, 9, 2, 2, p);
      // Cab on front-right (slightly shorter, with windows)
      pxRect(g, 21, 7, 4, 10, C.dark);
      depth(g, 21, 8, 4, 8, s, lt, p);
      pxRect(g, 22, 9, 2, 1, 0x88aacc);            // windshield
      pxRect(g, 22, 13, 2, 1, 0x88aacc);
      // Conveyor / scoop at front (right edge)
      pxRect(g, 25, 9, 3, 2, C.dark);
      pxRect(g, 25, 13, 3, 2, C.dark);
      pxRect(g, 25, 11, 3, 2, C.spice);
      storeAs(`unit_${f}_harvester`, g);
    }

    // ── Carryall (32×28) — heavy lift orniRotor, sees the underside-cradle ─
    {
      const g = unitG(32);
      g.clear();
      g.beginFill(0, 0); g.drawRect(0, 0, 32, 28); g.endFill();
      // Soft drop shadow (offset down for "flying high" look)
      pxRect(g, 8, 24, 16, 2, 0x000000);
      // Long fuselage (running left-right since vehicle faces right)
      pxRect(g, 8, 11, 16, 8, C.dark);
      depth(g, 9, 12, 14, 6, s, lt, p);
      // Cockpit / windshield on front
      pxRect(g, 21, 13, 2, 4, 0x88aacc);
      // Underside cargo cradle (where harvester clamps in)
      pxRect(g, 12, 18, 8, 1, C.dark);
      pxRect(g, 13, 19, 6, 1, 0x666666);
      // Stub wings / rotor arms — left side
      pxRect(g, 2, 13, 6, 1, C.dark);
      pxRect(g, 2, 16, 6, 1, C.dark);
      pxRect(g, 3, 14, 4, 2, p);
      // Right side rotor arms
      pxRect(g, 24, 13, 6, 1, C.dark);
      pxRect(g, 24, 16, 6, 1, C.dark);
      pxRect(g, 25, 14, 4, 2, p);
      // Rotor blur (motion lines across)
      pxRect(g, 2, 8, 28, 1, 0x444444);
      pxRect(g, 2, 22, 28, 1, 0x444444);
      // Tail
      pxRect(g, 6, 14, 2, 2, C.dark);
      storeAs(`unit_${f}_carryall`, g);
    }

    // ── Launcher / Missile Tank / MRL (24×24) ──────────────────
    {
      const g = unitG(24);
      // Drop shadow
      pxRect(g, 3, 20, 18, 1, 0x000000);
      // Tracks
      treads(g, 3, 4, 18, 3);
      treads(g, 3, 17, 18, 3);
      // Hull
      pxRect(g, 3, 7, 18, 10, C.dark);
      depth(g, 4, 8, 16, 8, s, lt, p);
      // Rocket rack (elevated launcher box)
      pxRect(g, 5, 8, 9, 7, 0x2a1f12);
      // Tubes (3 vertical tubes, ends pointing right)
      pxRect(g, 6, 9, 7, 1, 0x666666);
      pxRect(g, 6, 11, 7, 1, 0x666666);
      pxRect(g, 6, 13, 7, 1, 0x666666);
      // Rocket tips (yellow nosecones inside tubes)
      pxRect(g, 12, 9, 1, 1, C.yellow);
      pxRect(g, 12, 11, 1, 1, C.yellow);
      pxRect(g, 12, 13, 1, 1, C.yellow);
      // Aiming radar / sensor on top-front
      pxRect(g, 16, 9, 2, 1, 0xaaddff);
      pxRect(g, 16, 10, 1, 2, C.dark);
      // Faction emblem
      pxRect(g, 7, 15, 2, 1, p);
      storeAs(`unit_${f}_launcher`, g);
    }

    // ── Stealth Tank (24×24) — sleek dark hull, missile pods ───
    {
      const g = unitG(24);
      pxRect(g, 4, 20, 16, 1, 0x000000);
      // Slim tracks (stealth tank is lighter)
      treads(g, 4, 5, 16, 2);
      treads(g, 4, 17, 16, 2);
      // Sleek angular hull
      pxRect(g, 4, 7, 16, 10, 0x1a1a1a);
      pxRect(g, 5, 8, 14, 8, 0x2a2a2a);
      pxRect(g, 5, 8, 14, 1, 0x4a4a4a);             // top highlight
      // Front armour wedge
      pxRect(g, 18, 9, 2, 6, 0x3a3a3a);
      pxRect(g, 19, 10, 1, 4, 0x666666);
      // Twin missile pods at rear-left
      pxRect(g, 5, 9, 3, 2, C.dark);
      pxRect(g, 5, 13, 3, 2, C.dark);
      pxRect(g, 6, 10, 2, 1, 0x666666);
      pxRect(g, 6, 14, 2, 1, 0x666666);
      // Faction accent stripe (subtle on stealth)
      pxRect(g, 11, 11, 4, 1, p);
      // Sensor antenna front-top
      pxRect(g, 16, 7, 1, 2, 0xaaaaaa);
      pxRect(g, 15, 7, 3, 1, C.yellow);
      storeAs(`unit_${f}_stealthTank`, g);
    }

    // ── Siege Tank body (32×32) — heavy artillery, no turret ───
    {
      const g = unitG(32);
      g.clear();
      g.beginFill(0, 0); g.drawRect(0, 0, 32, 32); g.endFill();
      // Drop shadow
      pxRect(g, 4, 28, 24, 1, 0x000000);
      // Heavy tracks
      treads(g, 4, 5, 24, 4);
      treads(g, 4, 23, 24, 4);
      // Massive chassis
      pxRect(g, 4, 9, 24, 14, C.dark);
      depth(g, 5, 10, 22, 12, s, lt, p);
      // Centre hatch (turret socket)
      pxRect(g, 12, 14, 8, 4, 0x1a1208);
      pxRect(g, 13, 15, 6, 2, 0x2a1f12);
      // Front armour plates (right edge)
      pxRect(g, 27, 11, 1, 10, lt);
      pxRect(g, 26, 10, 1, 12, C.dark);
      // Side bolts/rivets
      pxRect(g, 5, 12, 1, 1, 0x888888);
      pxRect(g, 5, 19, 1, 1, 0x888888);
      pxRect(g, 26, 12, 1, 1, 0x888888);
      pxRect(g, 26, 19, 1, 1, 0x888888);
      // Faction badge
      pxRect(g, 8, 14, 3, 3, p);
      pxRect(g, 8, 14, 3, 1, lt);
      storeAs(`unit_${f}_siegeTank`, g);
    }

    // ── Siege Tank turret (32×32) — twin barrels ──────────────
    {
      const g = unitG(32);
      g.clear();
      g.beginFill(0, 0); g.drawRect(0, 0, 32, 32); g.endFill();
      // Halo shadow
      pxRect(g, 8, 9, 14, 14, 0x000000);
      // Turret housing centred on (16, 16)
      pxRect(g, 9, 10, 12, 12, C.dark);
      depth(g, 10, 11, 10, 10, s, lt, p);
      // Hatch
      pxRect(g, 14, 14, 4, 4, 0x2a1f12);
      pxRect(g, 15, 15, 2, 2, 0x666666);
      // Mantle
      pxRect(g, 21, 13, 1, 7, C.dark);
      // Twin barrels — separated vertically
      barrel(g, 22, 12, 9, 3);
      barrel(g, 22, 17, 9, 3);
      storeAs(`unit_${f}_siegeTank_turret`, g);
    }

    // ── Fremen (24×24) — Atreides desert warrior ───────────────
    {
      const g = unitG(24);
      // Shadow
      pxRect(g, 9, 17, 6, 1, 0x000000);
      // Sand-coloured robe (broader silhouette than infantry)
      pxRect(g, 9, 9, 6, 8, C.dark);
      pxRect(g, 10, 10, 4, 6, 0xc0a060);
      pxRect(g, 10, 10, 4, 1, 0xddc080);              // top highlight
      // Robe sash with faction colour
      pxRect(g, 10, 13, 4, 1, p);
      // Hood (covers head, leaving face slit)
      pxRect(g, 10, 6, 4, 4, C.dark);
      pxRect(g, 10, 6, 4, 1, 0x4a4030);
      pxRect(g, 11, 8, 2, 1, C.skin);                 // face shadow
      // Fremen blue-on-blue eyes
      pxRect(g, 11, 7, 1, 1, 0x44aaff);
      pxRect(g, 12, 7, 1, 1, 0x44aaff);
      // Maula pistol pointing right
      barrel(g, 14, 12, 5, 2);
      // Crysknife on hip (left)
      pxRect(g, 8, 13, 1, 2, 0xddddee);
      storeAs(`unit_${f}_fremen`, g);
    }

    // ── Sardaukar (24×24) — Imperial elite shock trooper ───────
    {
      const g = unitG(24);
      // Drop shadow
      pxRect(g, 8, 17, 8, 1, 0x000000);
      // Heavy armour torso
      pxRect(g, 8, 9, 8, 8, 0x101010);
      pxRect(g, 9, 10, 6, 6, 0x303030);
      pxRect(g, 9, 10, 6, 1, 0x555555);               // top edge sheen
      // Pauldrons (broad shoulders)
      pxRect(g, 7, 9, 1, 4, C.dark);
      pxRect(g, 16, 9, 1, 4, C.dark);
      pxRect(g, 7, 9, 1, 1, 0x4a4a4a);
      pxRect(g, 16, 9, 1, 1, 0x4a4a4a);
      // Helmet — full-face Imperial style
      pxRect(g, 9, 6, 6, 4, 0x101010);
      pxRect(g, 9, 6, 6, 1, 0x444444);
      pxRect(g, 10, 8, 4, 1, 0xcc2424);               // crimson visor
      // Imperial crimson chest emblem
      pxRect(g, 11, 12, 2, 2, 0xcc2424);
      pxRect(g, 11, 12, 2, 1, 0xff5454);
      // Small faction shoulder badge
      pxRect(g, 8, 10, 1, 1, p);
      // Rifle (heavier than infantry)
      barrel(g, 15, 12, 6, 2);
      storeAs(`unit_${f}_sardaukar`, g);
    }

    // ── Ornithopter (28×24) — Atreides strike aircraft ─────────
    {
      const g = unitG(28);
      g.clear();
      g.beginFill(0, 0); g.drawRect(0, 0, 28, 24); g.endFill();
      // Drop shadow (offset further down — flying high)
      pxRect(g, 8, 21, 12, 1, 0x000000);
      // Fuselage (slim, pointed nose right)
      pxRect(g, 6, 10, 16, 4, C.dark);
      depth(g, 7, 11, 14, 2, s, lt, p);
      // Cockpit canopy (front)
      pxRect(g, 18, 10, 3, 4, 0x88aacc);
      pxRect(g, 18, 10, 3, 1, 0xddeeff);
      // Pointed nose
      pxRect(g, 22, 11, 1, 2, C.yellow);
      // Wings — swept back, faction-tinted
      pxRect(g, 8, 5, 8, 5, C.dark);
      depth(g, 9, 6, 6, 3, p, lt, s);
      pxRect(g, 8, 14, 8, 5, C.dark);
      depth(g, 9, 15, 6, 3, p, lt, s);
      // Rocket pods (under wings)
      pxRect(g, 10, 4, 2, 1, C.dark);
      pxRect(g, 13, 4, 2, 1, C.dark);
      pxRect(g, 10, 19, 2, 1, C.dark);
      pxRect(g, 13, 19, 2, 1, C.dark);
      // Tail fins (rear)
      pxRect(g, 3, 8, 3, 2, C.dark);
      pxRect(g, 3, 14, 3, 2, C.dark);
      pxRect(g, 4, 9, 2, 1, p);
      pxRect(g, 4, 14, 2, 1, p);
      // Rotor blur (motion lines across the body)
      pxRect(g, 4, 8, 22, 1, 0x666666);
      pxRect(g, 4, 16, 22, 1, 0x666666);
      // Engine exhaust glow (back)
      pxRect(g, 2, 11, 1, 2, 0xff8030);
      storeAs(`unit_${f}_ornithopter`, g);
    }
  }
}

// ── Buildings ─────────────────────────────────────────────────
function pad(g: Graphics, w: number, h: number): void {
  pxRect(g, 0, 0, w, h, C.dark);
  pxRect(g, 2, 2, w - 4, h - 4, C.pad);
  for (let y = 4; y < h - 4; y += 4) for (let x = 4; x < w - 4; x += 4) pxRect(g, x, y, 2, 2, C.lightPad);
}
function emblem(g: Graphics, x: number, y: number, p: number): void {
  pxRect(g, x, y, 6, 6, 0x0a0a0a); pxRect(g, x+1, y+1, 4, 4, 0xffffff); pxRect(g, x+2, y+2, 2, 2, p);
}

/** Add 3/4 perspective lighting to a building: north/west get a 1px highlight,
 *  south/east get a 1px deep shadow. Call AFTER the main fill so the lines
 *  paint over the wall edges. */
function bldDepth(g: Graphics, w: number, h: number): void {
  // North edge (top of screen) — sun-side highlight
  pxRect(g, 1, 1, w - 2, 1, 0x6a4a2a);
  // West edge — sun-side highlight
  pxRect(g, 1, 1, 1, h - 2, 0x6a4a2a);
  // South edge — deep shadow
  pxRect(g, 1, h - 2, w - 2, 1, 0x000000);
  // East edge — deep shadow
  pxRect(g, w - 2, 1, 1, h - 2, 0x000000);
}

/**
 * 3/4 top-down RTS shell. Builds the canonical "roof on top, front wall on
 * bottom" silhouette and returns the inset roof rect for caller to add detail
 * inside.
 *
 *   ┌──────────┐  ←─ roof (lighter, viewed from above)
 *   │   ROOF   │
 *   │          │
 *   ├──────────┤  ←─ ridge / cap shadow
 *   │  FRONT   │  ←─ south wall, sun-lit but darker than roof
 *   └──────────┘  ←─ ground shadow (S edge)
 *
 * Front wall takes ~1/3 of the building height; the bottom-right corner is
 * pre-darkened to suggest the east wall.
 */
function bld34Shell(
  g: Graphics, w: number, h: number,
  roofBase: number, roofTop: number,
  wallBase: number, wallTop: number,
): { rx: number; ry: number; rw: number; rh: number; wallY: number; wallH: number } {
  // pad() has already filled the canvas with C.dark — that becomes the rim shadow.
  const wallH = Math.max(8, Math.floor(h / 3));
  const roofH = h - 4 - wallH;
  const rx = 2, ry = 2;

  // Roof body
  pxRect(g, rx, ry, w - 4, roofH, roofBase);
  pxRect(g, rx, ry, w - 4, 1, roofTop);                  // north highlight
  pxRect(g, rx, ry, 1, roofH, roofTop);                  // west highlight on roof
  // Roof inner panel (slightly inset, gives "sunken" roof feel)
  pxRect(g, rx + 2, ry + 2, w - 8, roofH - 4, roofTop);

  // Eave shadow (sharp dark line where roof meets wall)
  const wallY = ry + roofH;
  pxRect(g, rx, wallY, w - 4, 1, 0x000000);

  // Front wall (south face)
  pxRect(g, rx, wallY + 1, w - 4, wallH - 1, wallBase);
  pxRect(g, rx, wallY + 1, w - 4, 1, wallTop);          // top of wall, lit
  pxRect(g, rx, wallY + 1, 1, wallH - 1, wallTop);      // west corner, lit
  // East-wall sliver (darker since it's in shadow at 45°)
  pxRect(g, w - 3, ry, 1, h - 4, 0x000000);
  pxRect(g, w - 4, ry + 1, 1, h - 6, 0x1a1208);

  // Ground shadow (south edge, slightly extending)
  pxRect(g, rx + 1, h - 2, w - 6, 1, 0x000000);

  return { rx, ry, rw: w - 4, rh: roofH, wallY, wallH };
}

function generateBuildingSprites(): void {
  for (const f of factions) {
    const { p, s } = factionColors[f];

    // ── Construction Yard (2×2, 48×48) ─────────────────────────
    // Roof: fortified rooftop with corner bastions and central crane.
    // Front wall: vehicle bay door (south).
    {
      const [w, h] = [TILE * 2, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x6a4a2a, 0x8a6a3a, s, p);

      // ── Roof details ──
      // Corner bastions (4 little turret blocks on the roof)
      const bs = 6;
      const bastions: Array<[number, number]> = [
        [r.rx + 2, r.ry + 2],
        [r.rx + r.rw - bs - 2, r.ry + 2],
        [r.rx + 2, r.ry + r.rh - bs - 2],
        [r.rx + r.rw - bs - 2, r.ry + r.rh - bs - 2],
      ];
      for (const [bx, by] of bastions) {
        pxRect(g, bx, by, bs, bs, C.dark);
        pxRect(g, bx + 1, by + 1, bs - 2, bs - 2, s);
        pxRect(g, bx + 2, by + 2, bs - 4, bs - 4, C.yellow);
      }
      // Central crane mast (sits on the roof)
      const cx = w / 2, cy = r.ry + r.rh / 2;
      pxRect(g, cx - 1, cy - 6, 2, 12, C.dark);
      pxRect(g, cx - 4, cy - 7, 9, 2, C.dark);
      pxRect(g, cx - 1, cy - 6, 1, 12, 0x888888);
      pxRect(g, cx - 4, cy - 7, 1, 2, 0xaaaaaa);
      // Antenna with blinking light
      pxRect(g, cx + 4, r.ry + 2, 1, 4, 0xaaaaaa);
      pxRect(g, cx + 4, r.ry + 1, 1, 1, 0xff4444);

      // ── Front wall (south face) ──
      // Bay door (large, dark recess)
      const dW = 14, dH = r.wallH - 2;
      pxRect(g, w / 2 - dW / 2, r.wallY + 1, dW, dH, 0x0a0604);
      pxRect(g, w / 2 - dW / 2 + 1, r.wallY + 2, dW - 2, dH - 2, 0x1a1208);
      // Door frame (lighter rim)
      pxRect(g, w / 2 - dW / 2, r.wallY + 1, dW, 1, 0x4a4030);
      pxRect(g, w / 2 - dW / 2, r.wallY + 1, 1, dH, 0x4a4030);
      pxRect(g, w / 2 + dW / 2 - 1, r.wallY + 1, 1, dH, 0x000000);
      // Faction banner above door
      pxRect(g, w / 2 - 2, r.wallY - 3, 4, 3, p);
      pxRect(g, w / 2 - 2, r.wallY - 3, 4, 1, 0x000000);

      storeAs(`build_${f}_yard`, g);
    }

    // ── Wind Trap (1×2, 24×48) — narrow tower with roof rotor ──
    {
      const [w, h] = [TILE, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x4a4030, 0x6a5040, s, p);

      // ── Roof: rotor housing in cross shape, viewed from above ──
      const cx = w / 2, cy = r.ry + r.rh / 2;
      // Hub
      pxRect(g, cx - 2, cy - 2, 4, 4, C.dark);
      pxRect(g, cx - 1, cy - 1, 2, 2, 0xddeeff);
      // Four rotor blades (cross)
      pxRect(g, cx - 1, r.ry + 2, 2, r.rh / 2 - 3, 0xaaaaaa);     // top blade
      pxRect(g, cx - 1, cy + 2, 2, r.rh / 2 - 3, 0xaaaaaa);       // bottom blade
      pxRect(g, r.rx + 2, cy - 1, w / 2 - 4, 2, 0xaaaaaa);        // left blade
      pxRect(g, cx + 2, cy - 1, w / 2 - 4, 2, 0xaaaaaa);          // right blade
      // Tip caps
      pxRect(g, cx - 1, r.ry + 1, 2, 1, C.yellow);
      pxRect(g, cx - 1, r.ry + r.rh - 2, 2, 1, C.yellow);

      // ── Front wall: vent grille pattern ──
      // 3 horizontal ventilation slats
      for (let i = 0; i < 3; i++) {
        const vy = r.wallY + 2 + i * 3;
        pxRect(g, r.rx + 3, vy, w - 10, 1, 0x000000);
        pxRect(g, r.rx + 3, vy + 1, w - 10, 1, 0x4a4030);
      }
      // Power-output indicator lights
      pxRect(g, r.rx + 1, r.wallY + r.wallH - 2, 1, 1, 0x44ff44);
      pxRect(g, w - 3, r.wallY + r.wallH - 2, 1, 1, 0x44ff44);

      storeAs(`build_${f}_wind`, g);
    }

    // ── Refinery (3×2, 72×48) ──────────────────────────────────
    // Roof: 2 cylindrical silos + processing tower viewed from above.
    // Front: pipes + dock entrance on east tile.
    {
      const [w, h] = [TILE * 3, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x5a4528, 0x8a6a3a, s, p);

      // ── Roof: silos + tower ──
      // Two storage silos (round-ish, top-down)
      const silo1cx = r.rx + 12, silo1cy = r.ry + r.rh / 2;
      const silo2cx = r.rx + 30, silo2cy = silo1cy;
      for (const [scx, scy] of [[silo1cx, silo1cy], [silo2cx, silo2cy]] as [number, number][]) {
        pxRect(g, scx - 6, scy - 6, 12, 12, C.dark);          // silo edge shadow
        pxRect(g, scx - 5, scy - 5, 10, 10, 0x6a4a2a);        // silo body
        pxRect(g, scx - 4, scy - 4, 8, 8, 0x8a6a3a);          // top circle
        pxRect(g, scx - 5, scy - 5, 10, 1, 0xa88040);         // sun-lit top edge
        pxRect(g, scx - 2, scy - 2, 4, 4, p);                 // hatch with faction tint
        pxRect(g, scx - 1, scy - 1, 2, 2, C.dark);            // hatch hole
      }
      // Spice processing tower (on east-roof side of left tiles)
      pxRect(g, r.rx + 40, r.ry + 4, 8, r.rh - 8, C.dark);
      pxRect(g, r.rx + 41, r.ry + 5, 6, r.rh - 10, 0x444444);
      pxRect(g, r.rx + 41, r.ry + 5, 6, 1, 0x666666);
      pxRect(g, r.rx + 43, r.ry + 7, 2, 2, C.spice);          // visible spice glow
      pxRect(g, r.rx + 43, r.ry + 7, 2, 1, 0xffd860);

      // ── Front wall on left + middle tiles, dock on right tile ──
      // Override the right portion (third tile) of the wall — it's the dock opening
      const dockX = 2 * TILE + 2;
      const dockW = TILE - 4;
      // Erase wall in dock area, replace with dark cavity
      pxRect(g, dockX, r.wallY - 8, dockW, r.wallH + 9, 0x000000);  // upper inset
      pxRect(g, dockX + 1, r.wallY - 6, dockW - 2, r.wallH + 7, 0x0a0604);
      pxRect(g, dockX + 2, r.wallY - 4, dockW - 4, r.wallH + 5, 0x1a1208);
      // Dock door frame (lintel + jambs)
      pxRect(g, dockX, r.wallY - 8, dockW, 1, 0x4a4030);
      pxRect(g, dockX, r.wallY - 8, 1, r.wallH + 9, 0x4a4030);
      // Spice tank indicators on the dock wall
      pxRect(g, w - 6, r.wallY - 6, 1, r.wallH + 5, C.spice);
      pxRect(g, w - 4, r.wallY - 6, 1, r.wallH + 5, 0xffd860);
      // Conveyor outlets on left tile front
      pxRect(g, r.rx + 4, r.wallY + 4, 6, 4, 0x8a6a3a);
      pxRect(g, r.rx + 4, r.wallY + 4, 6, 1, 0xc69440);
      pxRect(g, r.rx + 4, r.wallY + 7, 6, 1, 0x000000);
      // Faction emblem on left tile wall
      emblem(g, r.rx + 14, r.wallY + 3, p);

      storeAs(`build_${f}_refinery`, g);
    }

    // ── Barracks (2×2, 48×48) ──────────────────────────────────
    // Roof: helipad markings + skylight.
    // Front: large entrance with two windows.
    {
      const [w, h] = [TILE * 2, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x6a4a2a, 0x8a6a3a, s, p);

      // ── Roof ──
      // Helipad / drill yard cross
      const cx = w / 2, cy = r.ry + r.rh / 2;
      pxRect(g, cx - 6, cy - 1, 12, 2, C.yellow);
      pxRect(g, cx - 1, cy - 6, 2, 12, C.yellow);
      pxRect(g, cx - 2, cy - 2, 4, 4, p);
      // Skylights (small bright squares)
      pxRect(g, r.rx + 3, r.ry + 3, 3, 3, 0x88aacc);
      pxRect(g, r.rx + r.rw - 6, r.ry + 3, 3, 3, 0x88aacc);
      // Vent stacks
      pxRect(g, r.rx + 4, r.ry + r.rh - 5, 2, 2, C.dark);
      pxRect(g, r.rx + r.rw - 6, r.ry + r.rh - 5, 2, 2, C.dark);

      // ── Front wall ──
      // Central door
      pxRect(g, w / 2 - 3, r.wallY + 2, 6, r.wallH - 3, 0x0a0604);
      pxRect(g, w / 2 - 3, r.wallY + 2, 6, 1, 0x4a4030);
      pxRect(g, w / 2 - 1, r.wallY + r.wallH - 4, 2, 1, p);   // doorknob/banner
      // Side windows (bright when garrisoned)
      pxRect(g, r.rx + 3, r.wallY + 4, 4, 3, 0x88aacc);
      pxRect(g, r.rx + 3, r.wallY + 4, 4, 1, 0xddeeff);
      pxRect(g, r.rx + r.rw - 7, r.wallY + 4, 4, 3, 0x88aacc);
      pxRect(g, r.rx + r.rw - 7, r.wallY + 4, 4, 1, 0xddeeff);

      storeAs(`build_${f}_barracks`, g);
    }

    // ── Light Factory (2×2, 48×48) ──────────────────────────────
    // Roof: corrugated industrial roof with smoke vent.
    // Front: garage door (vehicles drive out south).
    {
      const [w, h] = [TILE * 2, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x4a3a26, 0x6a5040, s, p);

      // ── Roof: corrugated stripes ──
      for (let i = 0; i < 6; i++) {
        const ry2 = r.ry + 4 + i * 4;
        pxRect(g, r.rx + 2, ry2, r.rw - 4, 1, 0x000000);
        pxRect(g, r.rx + 2, ry2 + 1, r.rw - 4, 2, 0x6a5040);
        pxRect(g, r.rx + 2, ry2 + 1, r.rw - 4, 1, 0x8a6a4a);
      }
      // Smoke vent on roof (cylindrical from above)
      pxRect(g, r.rx + r.rw - 9, r.ry + 3, 5, 5, C.dark);
      pxRect(g, r.rx + r.rw - 8, r.ry + 4, 3, 3, 0x444444);
      pxRect(g, r.rx + r.rw - 7, r.ry + 5, 1, 1, 0xff8030);    // glow
      // Status light beacon (north-west)
      pxRect(g, r.rx + 3, r.ry + 3, 2, 2, C.yellow);
      pxRect(g, r.rx + 3, r.ry + 3, 2, 1, 0xffffff);

      // ── Front wall: garage door (large, occupies most of front) ──
      const dW = r.rw - 8, dH = r.wallH - 2;
      const dx = r.rx + (r.rw - dW) / 2;
      pxRect(g, dx, r.wallY + 1, dW, dH, 0x0a0604);
      pxRect(g, dx + 1, r.wallY + 2, dW - 2, dH - 2, 0x1a1208);
      // Garage door horizontal slats
      for (let i = 0; i < 3; i++) {
        pxRect(g, dx + 1, r.wallY + 2 + i * 3, dW - 2, 1, 0x000000);
      }
      // Door frame
      pxRect(g, dx, r.wallY + 1, dW, 1, 0x4a4030);
      pxRect(g, dx, r.wallY + 1, 1, dH, 0x4a4030);
      pxRect(g, dx + dW - 1, r.wallY + 1, 1, dH, 0x000000);
      // Faction emblem strip above door
      pxRect(g, w / 2 - 3, r.wallY - 2, 6, 1, p);

      storeAs(`build_${f}_light`, g);
    }

    // ── Heavy Factory (3×2, 72×48) ──────────────────────────────
    // Roof: industrial corrugated with twin smokestacks.
    // Front: massive vehicle bay door.
    {
      const [w, h] = [TILE * 3, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x3a2e1c, 0x5a4530, s, p);

      // ── Roof: corrugated stripes spanning full width ──
      for (let i = 0; i < 7; i++) {
        const ry2 = r.ry + 3 + i * 3;
        pxRect(g, r.rx + 2, ry2, r.rw - 4, 1, 0x000000);
        pxRect(g, r.rx + 2, ry2 + 1, r.rw - 4, 1, 0x5a4530);
      }
      // Twin smokestacks on roof (left-rear)
      const stack1 = r.rx + 8, stack2 = r.rx + 16;
      for (const sx of [stack1, stack2]) {
        pxRect(g, sx, r.ry + 3, 5, 5, C.dark);
        pxRect(g, sx + 1, r.ry + 4, 3, 3, 0x444444);
        pxRect(g, sx + 1, r.ry + 4, 3, 1, 0x666666);
        pxRect(g, sx + 2, r.ry + 5, 1, 1, 0xff8030);            // glow
      }
      // Crane rail across roof
      pxRect(g, r.rx + 24, r.ry + r.rh / 2 - 1, r.rw - 28, 2, C.grey);
      pxRect(g, r.rx + 24, r.ry + r.rh / 2 - 1, r.rw - 28, 1, 0xaaaaaa);
      pxRect(g, r.rx + r.rw - 8, r.ry + r.rh / 2 - 2, 4, 4, C.yellow);
      // Status lights along the back
      pxRect(g, r.rx + 6,  r.ry + r.rh - 4, 2, 1, C.yellow);
      pxRect(g, r.rx + 26, r.ry + r.rh - 4, 2, 1, C.yellow);
      pxRect(g, r.rx + 50, r.ry + r.rh - 4, 2, 1, C.yellow);

      // ── Front wall: gigantic vehicle bay door ──
      const dW = r.rw - 12, dH = r.wallH - 2;
      const dx = r.rx + (r.rw - dW) / 2;
      pxRect(g, dx, r.wallY + 1, dW, dH, 0x0a0604);
      pxRect(g, dx + 1, r.wallY + 2, dW - 2, dH - 2, 0x1a1208);
      // Garage slats (more of them, bigger door)
      for (let i = 0; i < 4; i++) {
        pxRect(g, dx + 1, r.wallY + 2 + i * 3, dW - 2, 1, 0x000000);
      }
      // Heavy steel door frame
      pxRect(g, dx, r.wallY + 1, dW, 1, 0x4a4030);
      pxRect(g, dx, r.wallY + 1, 1, dH, 0x4a4030);
      pxRect(g, dx + dW - 1, r.wallY + 1, 1, dH, 0x000000);
      // Faction badge above bay
      pxRect(g, w / 2 - 4, r.wallY - 3, 8, 2, p);
      pxRect(g, w / 2 - 4, r.wallY - 3, 8, 1, 0x000000);

      storeAs(`build_${f}_heavy`, g);
    }

    // ── Hi-Tech (2×2, 48×48) ────────────────────────────────────
    // Roof: glass dome (advanced research lab).
    // Front: high-tech portal with glow.
    {
      const [w, h] = [TILE * 2, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x3a3a4a, 0x5a5a6a, s, p);

      // ── Roof: hex dome viewed from above ──
      const cx = w / 2, cy = r.ry + r.rh / 2;
      const dr = 11;
      // Dome base shadow (octagonal)
      for (let dy = -dr; dy <= dr; dy++) {
        const wHalf = Math.floor(Math.sqrt(Math.max(0, dr * dr - dy * dy)));
        if (wHalf <= 0) continue;
        pxRect(g, cx - wHalf, cy + dy, wHalf * 2, 1, dy < -3 ? 0x88aacc : (dy < 3 ? p : s));
      }
      // Dome rim
      for (let dy = -dr; dy <= dr; dy++) {
        const wHalf = Math.floor(Math.sqrt(Math.max(0, dr * dr - dy * dy)));
        if (wHalf <= 0) continue;
        pxRect(g, cx - wHalf, cy + dy, 1, 1, C.dark);
        pxRect(g, cx + wHalf - 1, cy + dy, 1, 1, C.dark);
      }
      // Dome highlight (top-left, sun reflection)
      pxRect(g, cx - 5, cy - 7, 4, 2, 0xddeeff);
      pxRect(g, cx - 4, cy - 8, 2, 1, 0xffffff);
      // Antenna spire on top
      pxRect(g, cx - 1, r.ry + 1, 2, 4, 0xaaaaaa);
      pxRect(g, cx - 1, r.ry + 1, 2, 1, 0xff4444);

      // ── Front wall: high-tech portal ──
      pxRect(g, w / 2 - 4, r.wallY + 1, 8, r.wallH - 2, 0x000000);
      pxRect(g, w / 2 - 3, r.wallY + 2, 6, r.wallH - 4, 0x88aacc);
      pxRect(g, w / 2 - 2, r.wallY + 3, 4, r.wallH - 6, 0xddeeff);
      pxRect(g, w / 2 - 1, r.wallY + 4, 2, r.wallH - 8, 0xffffff);   // glow core
      // Status lights flanking portal
      pxRect(g, r.rx + 3, r.wallY + 3, 1, 1, 0x44ff44);
      pxRect(g, r.rx + r.rw - 4, r.wallY + 3, 1, 1, 0x44ff44);

      storeAs(`build_${f}_hitech`, g);
    }

    // ── Palace (3×3, 72×72) — fortified citadel ─────────────────
    // Roof: castle with corner bastions, central tower.
    // Front: imperial gate.
    {
      const [w, h] = [TILE * 3, TILE * 3];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x6a4a2a, 0x8a6a3a, s, p);

      // ── Roof: castle with corner bastions ──
      const bs = 10;
      const corners: Array<[number, number]> = [
        [r.rx + 2, r.ry + 2],
        [r.rx + r.rw - bs - 2, r.ry + 2],
        [r.rx + 2, r.ry + r.rh - bs - 2],
        [r.rx + r.rw - bs - 2, r.ry + r.rh - bs - 2],
      ];
      for (const [bx, by] of corners) {
        pxRect(g, bx, by, bs, bs, C.dark);
        pxRect(g, bx + 1, by + 1, bs - 2, bs - 2, s);
        pxRect(g, bx + 2, by + 2, bs - 4, bs - 4, p);
        pxRect(g, bx + 3, by + 3, bs - 6, bs - 6, C.yellow);
        // Top highlight
        pxRect(g, bx + 1, by + 1, bs - 2, 1, 0xa88040);
      }
      // Central tower
      const tcx = w / 2, tcy = r.ry + r.rh / 2;
      pxRect(g, tcx - 7, tcy - 7, 14, 14, C.dark);
      pxRect(g, tcx - 6, tcy - 6, 12, 12, s);
      pxRect(g, tcx - 5, tcy - 5, 10, 10, p);
      pxRect(g, tcx - 4, tcy - 4, 8, 8, C.dark);
      pxRect(g, tcx - 3, tcy - 3, 6, 6, p);
      pxRect(g, tcx - 6, tcy - 6, 12, 1, 0xa88040);             // top highlight
      // Crown spire (golden)
      pxRect(g, tcx - 1, tcy - 1, 2, 2, C.yellow);
      pxRect(g, tcx - 2, tcy - 2, 1, 1, C.yellow);
      pxRect(g, tcx + 1, tcy - 2, 1, 1, C.yellow);
      // Connecting walls roof — ornamental crenellations between corners
      for (let i = 0; i < 4; i++) {
        pxRect(g, r.rx + 14 + i * 5, r.ry + 4, 2, 2, p);
        pxRect(g, r.rx + 14 + i * 5, r.ry + r.rh - 6, 2, 2, p);
        pxRect(g, r.rx + 4, r.ry + 14 + i * 5, 2, 2, p);
        pxRect(g, r.rx + r.rw - 6, r.ry + 14 + i * 5, 2, 2, p);
      }

      // ── Front wall: imperial gate ──
      const gW = 16, gH = r.wallH - 2;
      const gx = w / 2 - gW / 2;
      pxRect(g, gx, r.wallY + 1, gW, gH, 0x0a0604);
      pxRect(g, gx + 1, r.wallY + 2, gW - 2, gH - 2, 0x1a1208);
      pxRect(g, gx + 2, r.wallY + 3, gW - 4, gH - 4, 0x2a1f12);
      // Gate frame (lighter rim, suggests stone arch)
      pxRect(g, gx, r.wallY + 1, gW, 1, 0x6a4a2a);
      pxRect(g, gx, r.wallY + 1, 1, gH, 0x6a4a2a);
      pxRect(g, gx + gW - 1, r.wallY + 1, 1, gH, 0x000000);
      // Faction banners flanking the gate
      pxRect(g, gx - 4, r.wallY - 4, 2, gH + 4, p);
      pxRect(g, gx + gW + 2, r.wallY - 4, 2, gH + 4, p);
      pxRect(g, gx - 4, r.wallY - 4, 2, 1, 0x000000);
      pxRect(g, gx + gW + 2, r.wallY - 4, 2, 1, 0x000000);
      // Imperial emblem above gate
      emblem(g, w / 2 - 3, r.wallY - 9, C.yellow);

      storeAs(`build_${f}_palace`, g);
    }

    // ── Radar Outpost (2×2, 48×48) ──────────────────────────────
    // Roof: dish antenna (large, dominant).
    // Front: control room with windows.
    {
      const [w, h] = [TILE * 2, TILE * 2];
      const g = new Graphics(); pad(g, w, h);
      const r = bld34Shell(g, w, h, 0x4a4030, 0x6a5040, s, p);

      // ── Roof: parabolic dish viewed from above (oval) ──
      const dcx = w / 2, dcy = r.ry + r.rh / 2 + 1;
      const dishR = 11;
      // Dish basin (concentric ovals — looking from above we see inside)
      for (let i = dishR; i > 0; i--) {
        const wHalf = i, hHalf = Math.max(2, Math.floor(i * 0.7));
        const shade = i > dishR - 2 ? C.dark
                    : i > dishR - 4 ? s
                    : i > dishR - 7 ? p
                    : 0xaaddff;
        for (let dy = -hHalf; dy <= hHalf; dy++) {
          const xw = Math.floor(wHalf * Math.sqrt(1 - (dy * dy) / (hHalf * hHalf + 0.001)));
          if (xw > 0) pxRect(g, dcx - xw, dcy + dy, xw * 2, 1, shade);
        }
      }
      // Dish receiver (focal point — small black dot in centre)
      pxRect(g, dcx - 1, dcy - 1, 2, 2, C.dark);
      pxRect(g, dcx, dcy, 1, 1, 0x44ff44);
      // Support struts (visible from above, going from dish edge to centre)
      pxRect(g, dcx - dishR + 1, dcy, 3, 1, C.dark);
      pxRect(g, dcx + dishR - 3, dcy, 3, 1, C.dark);
      // Sweep indicator (one bright line — "current radar beam")
      pxRect(g, dcx, dcy - 1, dishR - 2, 1, 0x44cc88);

      // ── Front wall: control room with bank of windows ──
      // 3 windows
      for (let i = 0; i < 3; i++) {
        const wx = r.rx + 4 + i * 12;
        pxRect(g, wx, r.wallY + 3, 6, 4, 0x88aacc);
        pxRect(g, wx, r.wallY + 3, 6, 1, 0xddeeff);
        pxRect(g, wx + 2, r.wallY + 3, 1, 4, 0x44aacc);  // window mullion
      }
      // Status indicators
      pxRect(g, r.rx + 3, r.wallY + r.wallH - 3, 1, 1, 0x44ff44);
      pxRect(g, r.rx + r.rw - 4, r.wallY + r.wallH - 3, 1, 1, 0x44cc88);

      storeAs(`build_${f}_radar`, g);
    }

    // ── Gun Turret base (1×1, 24×24) — bunker pillbox ──────────
    // Single tile, more "top-down" since it's small and squat.
    // Has visible south face strip suggesting low height.
    {
      const w = TILE, h = TILE;
      const g = new Graphics();
      // Outer ground footprint (octagonal feel via dark corners)
      pxRect(g, 0, 0, w, h, 0x000000);
      pxRect(g, 2, 2, w-4, h-4, C.dark);
      // Concrete pad (top view)
      pxRect(g, 3, 3, w-6, h-6, 0x4a4030);
      pxRect(g, 4, 4, w-8, h-8, 0x6a5040);
      pxRect(g, 4, 4, w-8, 1, 0x8a6a4a);                 // north highlight
      pxRect(g, 4, 4, 1, h-8, 0x8a6a4a);                 // west highlight
      pxRect(g, 4, h-5, w-8, 1, 0x000000);               // south shadow
      pxRect(g, w-5, 4, 1, h-8, 0x000000);               // east shadow
      // Faction-tinted inner ring (where the turret socket sits)
      pxRect(g, 6, 6, w-12, h-12, s);
      pxRect(g, 7, 7, w-14, h-14, p);
      // Corner sandbags / studs
      pxRect(g, 3, 3, 2, 2, 0x222222);
      pxRect(g, w-5, 3, 2, 2, 0x222222);
      pxRect(g, 3, h-5, 2, 2, 0x222222);
      pxRect(g, w-5, h-5, 2, 2, 0x222222);
      // Faction emblem (south face suggesting a banner)
      pxRect(g, w/2-1, h-4, 2, 2, p);
      storeAs(`build_${f}_turret`, g);
    }

    // ── Gun Turret barrel (TILE×TILE, transparent) ─────────────
    // Rotates over the base. Pivot at (TILE/2, TILE/2). Points RIGHT.
    {
      const g = new Graphics();
      g.beginFill(0, 0); g.drawRect(0, 0, TILE, TILE); g.endFill();
      const cx = TILE / 2, cy = TILE / 2;
      // Halo shadow under the housing
      pxRect(g, cx - 5, cy - 5, 10, 10, 0x000000);
      // Square housing centred (turret box)
      pxRect(g, cx - 4, cy - 4, 8, 8, C.dark);
      pxRect(g, cx - 3, cy - 3, 6, 6, s);
      pxRect(g, cx - 3, cy - 3, 6, 1, 0xa88040);            // top highlight
      pxRect(g, cx - 2, cy - 2, 4, 4, p);
      pxRect(g, cx - 1, cy - 1, 2, 2, C.dark);              // hatch hole
      // Mantle (armour where barrel meets housing)
      pxRect(g, cx + 4, cy - 2, 1, 4, C.dark);
      // Barrel pointing right with proper depth
      pxRect(g, cx + 5, cy - 2, 7, 4, C.dark);
      pxRect(g, cx + 5, cy - 1, 6, 2, 0x888888);             // barrel body
      pxRect(g, cx + 5, cy - 1, 6, 1, 0xaaaaaa);             // top sheen
      pxRect(g, cx + 11, cy - 2, 1, 4, 0x444444);            // muzzle ring
      pxRect(g, cx + 12, cy - 1, 1, 2, 0xffffff);            // muzzle tip
      storeAs(`build_${f}_turret_barrel`, g);
    }

    // ── Rocket Turret base (1×1, 24×24) — heavier pillbox ──────
    {
      const w = TILE, h = TILE;
      const g = new Graphics();
      pxRect(g, 0, 0, w, h, 0x000000);
      pxRect(g, 1, 1, w-2, h-2, C.dark);
      // Reinforced concrete pad — slightly darker than gun turret
      pxRect(g, 2, 2, w-4, h-4, 0x3a2e1c);
      pxRect(g, 3, 3, w-6, h-6, 0x5a4530);
      pxRect(g, 3, 3, w-6, 1, 0x6a5040);                  // N highlight
      pxRect(g, 3, 3, 1, h-6, 0x6a5040);                  // W highlight
      pxRect(g, 3, h-4, w-6, 1, 0x000000);                // S shadow
      pxRect(g, w-4, 3, 1, h-6, 0x000000);                // E shadow
      // Heavy armoured bands (cross pattern)
      pxRect(g, 1, h/2-1, w-2, 2, 0x202020);
      pxRect(g, w/2-1, 1, 2, h-2, 0x202020);
      // Inner mount socket
      pxRect(g, 7, 7, w-14, h-14, s);
      pxRect(g, 8, 8, w-16, h-16, p);
      // Corner caution markers (yellow/black warning stripes)
      pxRect(g, 3, 3, 3, 2, C.yellow);
      pxRect(g, 4, 4, 1, 1, 0x000000);
      pxRect(g, w-6, h-5, 3, 2, C.yellow);
      pxRect(g, w-5, h-4, 1, 1, 0x000000);
      // Faction banner south
      pxRect(g, w/2-2, h-4, 4, 2, p);
      pxRect(g, w/2-2, h-4, 4, 1, 0x000000);
      storeAs(`build_${f}_rturret`, g);
    }

    // ── Rocket Turret launcher rack (TILE×TILE, transparent) ───
    {
      const g = new Graphics();
      g.beginFill(0, 0); g.drawRect(0, 0, TILE, TILE); g.endFill();
      const cx = TILE / 2, cy = TILE / 2;
      // Halo shadow
      pxRect(g, cx - 6, cy - 5, 12, 11, 0x000000);
      // Launcher box centred
      pxRect(g, cx - 5, cy - 4, 10, 8, C.dark);
      pxRect(g, cx - 4, cy - 3, 8, 6, s);
      pxRect(g, cx - 4, cy - 3, 8, 1, 0xa88040);            // top highlight
      pxRect(g, cx - 3, cy - 2, 6, 4, p);
      // Twin rocket tubes — separated vertically, pointing right
      // Upper tube
      pxRect(g, cx + 4, cy - 3, 7, 2, C.dark);
      pxRect(g, cx + 4, cy - 3, 6, 1, 0x888888);
      pxRect(g, cx + 4, cy - 2, 6, 1, 0x4a4a4a);
      pxRect(g, cx + 9, cy - 3, 1, 2, C.yellow);            // rocket nosecone
      // Lower tube
      pxRect(g, cx + 4, cy + 1, 7, 2, C.dark);
      pxRect(g, cx + 4, cy + 1, 6, 1, 0x888888);
      pxRect(g, cx + 4, cy + 2, 6, 1, 0x4a4a4a);
      pxRect(g, cx + 9, cy + 1, 1, 2, C.yellow);
      storeAs(`build_${f}_rturret_barrel`, g);
    }
  }

  // ── Sandworm (independent of faction) ────────────────────────
  {
    const g = new Graphics();
    // 5 humped segments of dark earth tone
    const seg = [0x6b4818, 0x7a5320, 0x6b4818, 0x553a14, 0x442e10];
    for (let i = 0; i < 5; i++) {
      const x = 2 + i * 5;
      pxRect(g, x, 6, 5, 6, seg[i]!);
      pxRect(g, x + 1, 5, 3, 1, seg[i]!);
      pxRect(g, x + 1, 12, 3, 1, seg[(i + 2) % 5]!);
    }
    // mouth at the head
    pxRect(g, 26, 7, 3, 4, 0x1a0a04);
    pxRect(g, 26, 8, 1, 1, 0xff5020);
    pxRect(g, 26, 10, 1, 1, 0xff5020);
    storeAs('worm_body', g);
  }
}

// ── Projectiles ────────────────────────────────────────────────
function generateProjectileSprites(): void {
  // bullet — horizontal tracer, pointing RIGHT; 8×4 canvas for stable anchor
  { const g = new Graphics(); g.beginFill(0,0); g.drawRect(0,0,8,4); g.endFill(); pxRect(g, 1, 1, 5, 2, 0xffe080); storeAs('proj_bullet', g); }
  { const g = new Graphics(); pxRect(g, 1, 1, 4, 4, 0xff8030); pxRect(g, 2, 2, 2, 2, 0xffd870); storeAs('proj_shell', g); }
  {
    const g = new Graphics();
    g.beginFill(0x8cc8ff, 0.7); g.drawRect(0, 3, 10, 4); g.drawRect(3, 0, 4, 10); g.endFill();
    g.beginFill(0xffffff); g.drawRect(3, 3, 4, 4); g.endFill();
    storeAs('proj_sonic', g);
  }
  // rocket — long body with flame trail, pointing RIGHT (angle 0)
  // Transparent 16×6 canvas → anchor(0.5) sits exactly at (8,3) = visual body centre
  {
    const g = new Graphics();
    g.beginFill(0, 0); g.drawRect(0, 0, 16, 6); g.endFill(); // anchor fixer
    pxRect(g, 3, 2, 8, 2, 0x888888);   // main body x=3..11
    pxRect(g, 10, 2, 2, 2, 0xffd870);  // yellow nosecone → right end
    pxRect(g, 1, 2, 2, 2, 0xff6020);   // orange flame ← left of body
    pxRect(g, 0, 3, 1, 1, 0xff8c2a);   // flame trail, further left
    storeAs('proj_rocket', g);
  }
  // deathHand — Harkonnen ICBM, larger menacing body with fins, pointing RIGHT
  {
    const g = new Graphics();
    g.beginFill(0, 0); g.drawRect(0, 0, 24, 10); g.endFill(); // anchor fixer
    // Main body
    pxRect(g, 4, 3, 14, 4, 0x444444);
    pxRect(g, 4, 4, 14, 2, 0x666666);
    // Warhead nosecone
    pxRect(g, 17, 3, 3, 4, 0xcc2424);   // red warhead tip
    pxRect(g, 20, 4, 1, 2, 0xff5050);
    // Tail fins
    pxRect(g, 3, 1, 3, 2, 0x222222);    // top fin
    pxRect(g, 3, 7, 3, 2, 0x222222);    // bottom fin
    // Exhaust flame
    pxRect(g, 1, 3, 3, 4, 0xff6020);
    pxRect(g, 0, 4, 1, 2, 0xffd870);
    storeAs('proj_deathHand', g);
  }
}

// ── Tile key helper ───────────────────────────────────────────
export function tileKey(type: string, v = 0): string {
  if (type === 'dune') return 'tile_dune';
  if (type === 'spice') return 'tile_spice0';
  if (type === 'spice2') return 'tile_spice1';
  if (type === 'rock') return `tile_rock${v % 3}`;
  return `tile_sand${v % 4}`;
}

export function unitKey(faction: FactionId, kind: UnitKind): string {
  return `unit_${faction}_${kind}`;
}

export function buildKey(faction: FactionId, kind: BuildingKind): string {
  return `build_${faction}_${kind}`;
}
