/**
 * V2 sprite generation — READABILITY PROTOTYPE for the before/after compare stand.
 *
 * Goal: demonstrate the engine-level readability levers from the StarCraft-1 method
 * WITHOUT touching the live game renderer:
 *   1. Higher source resolution (SS×) → downscale = real shading headroom, crisp.
 *   2. BAKED directional frames (no runtime free-rotation → no shimmer/mush).
 *   3. Strong value contrast: dark contour + lit top edge + grounded contact shadow.
 *   4. Larger on-screen size + a clear size hierarchy (infantry < trike < tank).
 *
 * Everything is authored in a single 96×96 "source space" at true relative size,
 * then baked down to small display textures. The live `sprites.ts` is untouched.
 */
import {
  Application, Graphics, RenderTexture, Sprite, SCALE_MODES, Texture,
} from 'pixi.js';
import type { FactionId } from '../types/index.js';

// Source canvas is square so rotation pivots cleanly at the centre.
const SRC = 96;
const CX = SRC / 2;
// Baked display size (the texture the grid actually shows). 2× supersample.
const DISP = 48;
// Directions baked per rotating unit. 32 = 11.25° steps (StarCraft-1 density).
// NOTE: this prototype still rotates ONE source frame, so the top-left rim light
// rotates with the body — only TRUE per-direction art (3D pre-render or hand-drawn
// per facing) keeps the sun fixed. The contact shadow is now drawn separately at
// draw-time (see compare-preview) so at least the shadow stays put.
export const N_DIR = 32;

export interface V2Set {
  infantry: Texture[];
  trike: Texture[];
  tank: Texture[];
  tankTurret: Texture[];
  yard: Texture; // static building, footprint-locked
}

const factionColors: Record<FactionId, { p: number; s: number; lt: number }> = {
  atreides:  { p: 0x3a78d8, s: 0x1a3a72, lt: 0x8fc0ff },
  harkonnen: { p: 0xcc2424, s: 0x6a1010, lt: 0xff6a6a },
  ordos:     { p: 0x2c9c44, s: 0x123a1c, lt: 0x6fe089 },
};

// Near-black contour — gives every silhouette a hard edge against pale sand.
const EDGE = 0x07060a;
const STEEL = 0x6c6c74;
const STEEL_D = 0x2a2a30;
const STEEL_L = 0xb6b6c0;

let _app: Application;

function px(g: Graphics, x: number, y: number, w: number, h: number, c: number, a = 1): void {
  g.beginFill(c, a); g.drawRect(x, y, w, h); g.endFill();
}

/** Filled rounded-ish plate with dark contour + top rim light. */
function plate(g: Graphics, x: number, y: number, w: number, h: number,
               base: number, lt: number): void {
  px(g, x - 1, y - 1, w + 2, h + 2, EDGE);     // contour
  px(g, x, y, w, h, base);                       // body
  px(g, x, y, w, 2, lt);                         // top rim light
  px(g, x, y + h - 2, w, 2, 0x000000, 0.35);     // bottom shade
}

// ── Source drawings (face RIGHT, centred at CX) ───────────────────
// No contact shadow here — it must NOT rotate with the body, so it is drawn
// separately at draw-time (fixed under the unit). Same reason mirroring is
// banned: shadow placement + proportions must be preserved per direction.

function drawInfantry(g: Graphics, c: { p: number; s: number; lt: number }): void {
  // legs
  px(g, CX - 6, 52, 5, 14, EDGE); px(g, CX - 5, 52, 3, 12, 0x3a2e1c);
  px(g, CX + 1, 52, 5, 14, EDGE); px(g, CX + 2, 52, 3, 12, 0x3a2e1c);
  // torso (faction)
  plate(g, CX - 9, 34, 18, 22, c.p, c.lt);
  px(g, CX - 7, 42, 14, 3, c.s);                 // chest sash band
  // shoulders
  px(g, CX - 13, 34, 5, 9, EDGE); px(g, CX - 12, 35, 3, 7, c.s);
  px(g, CX + 8, 34, 5, 9, EDGE);  px(g, CX + 9, 35, 3, 7, c.s);
  // helmet
  px(g, CX - 8, 18, 16, 16, EDGE);
  px(g, CX - 6, 20, 12, 12, 0x5a4a32);
  px(g, CX - 6, 20, 12, 3, 0x7a6a48);            // helmet rim light
  px(g, CX - 3, 26, 6, 5, 0xf0c898);             // face
  // rifle to the right
  px(g, CX + 6, 38, 22, 5, EDGE);
  px(g, CX + 8, 39, 18, 2, STEEL);
  px(g, CX + 26, 38, 4, 5, STEEL_L);             // muzzle
}

function drawTrike(g: Graphics, c: { p: number; s: number; lt: number }): void {
  // three fat wheels
  for (const [wx, wy] of [[CX - 22, 30], [CX - 22, 50], [CX + 24, 40]] as const) {
    px(g, wx - 1, wy - 1, 14, 14, EDGE);
    px(g, wx, wy, 12, 12, 0x1c1c20);
    px(g, wx + 3, wy + 3, 6, 6, 0x46464e);       // hub
  }
  // chassis frame
  plate(g, CX - 20, 34, 40, 16, c.p, c.lt);
  px(g, CX - 16, 38, 32, 3, c.s);
  // open cockpit / rider
  px(g, CX - 6, 36, 12, 12, EDGE);
  px(g, CX - 4, 38, 8, 8, 0x2a2a30);
  px(g, CX - 2, 39, 4, 4, 0xf0c898);             // rider head
  // forward machine-gun
  px(g, CX + 16, 38, 22, 5, EDGE);
  px(g, CX + 18, 39, 18, 3, STEEL);
  px(g, CX + 36, 38, 3, 5, STEEL_L);
}

function drawTankBody(g: Graphics, c: { p: number; s: number; lt: number }): void {
  // tracks (top + bottom flanks)
  for (const ty of [24, 58]) {
    px(g, CX - 32, ty, 64, 14, EDGE);
    px(g, CX - 30, ty + 1, 60, 12, 0x141418);
    for (let i = 0; i < 10; i++) px(g, CX - 28 + i * 6, ty + 1, 2, 12, 0x3a3a42); // cleats
    px(g, CX - 30, ty + 1, 60, 2, 0x4a4a52);     // top sheen
  }
  // hull
  plate(g, CX - 28, 36, 56, 26, c.p, c.lt);
  px(g, CX - 24, 40, 48, 3, c.s);
  // front glacis plate (right)
  px(g, CX + 26, 38, 4, 22, EDGE);
  px(g, CX + 24, 40, 3, 18, c.lt);
  // turret socket (so detached turret reads as seated)
  px(g, CX - 12, 42, 24, 14, 0x111114);
}

function drawTankTurret(g: Graphics, c: { p: number; s: number; lt: number }): void {
  // Turret centred on CX so it pivots in place.
  px(g, CX - 16, CX - 16, 32, 32, EDGE);
  px(g, CX - 14, CX - 14, 28, 28, c.p);
  px(g, CX - 14, CX - 14, 28, 3, c.lt);          // top rim light
  px(g, CX - 14, CX + 10, 28, 4, 0x000000, 0.35);
  px(g, CX - 6, CX - 6, 12, 12, c.s);            // commander hatch
  px(g, CX - 3, CX - 3, 6, 6, 0x46464e);
  // gun barrel to the right
  px(g, CX + 12, CX - 5, 34, 10, EDGE);
  px(g, CX + 14, CX - 3, 30, 6, STEEL);
  px(g, CX + 14, CX - 3, 30, 2, STEEL_L);        // barrel sheen
  px(g, CX + 42, CX - 4, 5, 8, STEEL_D);         // muzzle brake
}

/** Construction Yard, drawn at 2× then baked to a footprint-locked 48px texture. */
function drawYard(g: Graphics, c: { p: number; s: number; lt: number }): void {
  const S = SRC; // fill the whole 96 source → bakes to 48 (2 tiles)
  // base slab / contour
  px(g, 2, 2, S - 4, S - 4, EDGE);
  // roof
  const roofH = 60;
  px(g, 6, 6, S - 12, roofH, 0x6a4a2a);
  px(g, 6, 6, S - 12, 4, 0x9a7038);              // north rim light
  px(g, 6, 6, 4, roofH, 0x8a6232);               // west rim light
  px(g, 6, roofH + 2, S - 12, 4, 0x000000);      // eave shadow
  // corner bastions
  for (const [bx, by] of [[10, 10], [S - 26, 10], [10, roofH - 18], [S - 26, roofH - 18]] as const) {
    px(g, bx, by, 16, 16, EDGE);
    px(g, bx + 2, by + 2, 12, 12, c.s);
    px(g, bx + 5, by + 5, 6, 6, 0xffc870);
  }
  // central crane mast
  px(g, CX - 2, 18, 4, 34, EDGE);
  px(g, CX - 2, 18, 2, 34, 0xb0b0b8);
  px(g, CX - 12, 16, 24, 5, EDGE);
  px(g, CX - 12, 16, 24, 2, 0xb0b0b8);
  // front wall (south)
  px(g, 6, roofH + 6, S - 12, S - roofH - 12, 0x4a3a24);
  px(g, 6, roofH + 6, S - 12, 3, 0x6a5436);
  // bay door
  px(g, CX - 18, roofH + 10, 36, S - roofH - 18, 0x0a0604);
  px(g, CX - 16, roofH + 12, 32, S - roofH - 22, 0x161016);
  for (let i = 0; i < 5; i++) px(g, CX - 16, roofH + 14 + i * 4, 32, 1, 0x000000);
  // faction banner
  px(g, CX - 5, roofH + 2, 10, 6, c.p);
  px(g, CX - 5, roofH + 2, 10, 2, c.lt);
}

// ── Texture build + directional baking ────────────────────────────

function srcTexture(draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  g.beginFill(0, 0); g.drawRect(0, 0, SRC, SRC); g.endFill(); // transparent backing
  draw(g);
  const tex = _app.renderer.generateTexture(g, { scaleMode: SCALE_MODES.NEAREST, resolution: 1 });
  g.destroy();
  return tex;
}

/** Bake N rotated frames of a source texture, downscaled to DISP (2× supersample). */
function bakeDirections(src: Texture): Texture[] {
  const frames: Texture[] = [];
  const scale = DISP / SRC;
  for (let i = 0; i < N_DIR; i++) {
    const ang = (i / N_DIR) * Math.PI * 2;
    const rt = RenderTexture.create({ width: DISP, height: DISP });
    rt.baseTexture.scaleMode = SCALE_MODES.NEAREST;
    const sp = new Sprite(src);
    sp.anchor.set(0.5);
    sp.scale.set(scale);
    sp.rotation = ang;
    sp.position.set(DISP / 2, DISP / 2);
    _app.renderer.render(sp, { renderTexture: rt });
    sp.destroy();
    frames.push(rt);
  }
  src.destroy();
  return frames;
}

/** One static downscaled frame (buildings — no rotation). */
function bakeStatic(src: Texture): Texture {
  const scale = DISP / SRC;
  const rt = RenderTexture.create({ width: DISP, height: DISP });
  rt.baseTexture.scaleMode = SCALE_MODES.NEAREST;
  const sp = new Sprite(src);
  sp.scale.set(scale);
  _app.renderer.render(sp, { renderTexture: rt });
  sp.destroy(); src.destroy();
  return rt;
}

export function buildV2(app: Application, faction: FactionId): V2Set {
  _app = app;
  const c = factionColors[faction];
  return {
    infantry:   bakeDirections(srcTexture(g => drawInfantry(g, c))),
    trike:      bakeDirections(srcTexture(g => drawTrike(g, c))),
    tank:       bakeDirections(srcTexture(g => drawTankBody(g, c))),
    tankTurret: bakeDirections(srcTexture(g => drawTankTurret(g, c))),
    yard:       bakeStatic(srcTexture(g => drawYard(g, c))),
  };
}

/** Pick the baked frame nearest to a continuous angle (radians). */
export function frameForAngle(frames: Texture[], angle: number): Texture {
  const n = frames.length;
  const idx = ((Math.round(angle / (Math.PI * 2) * n) % n) + n) % n;
  return frames[idx]!;
}
