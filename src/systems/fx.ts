/**
 * fx.ts — particle / effect spawners.
 * Pure helpers that push Effect entries onto state.fx. The renderer
 * (render/renderer.ts:renderEffects) reads them and draws each kind.
 * Effects drift via optional vx/vy and fade over `life` (see main.ts tick).
 */
import type { GameState } from '../types/index.js';

const TAU = Math.PI * 2;

/**
 * Full explosion: shockwave ring + fireball core + flying embers + rising smoke.
 * `scale` roughly equals the blast radius in tiles.
 */
export function spawnExplosion(state: GameState, x: number, y: number, scale: number): void {
  const s = Math.max(0.4, scale);

  // Expanding shockwave ring (fast, thin)
  state.fx.push({ x, y, scale: s, t: 0, life: 0.4, kind: 'shock' });

  // Fireball core
  state.fx.push({ x, y, scale: s, t: 0, life: 0.45 + s * 0.05, kind: 'expl' });

  // Flying embers / debris sparks
  const embers = Math.min(14, 4 + Math.round(s * 3));
  for (let i = 0; i < embers; i++) {
    const a = Math.random() * TAU;
    const v = (1.6 + Math.random() * 3) * Math.min(2.2, s);
    state.fx.push({
      x, y,
      scale: 0.5 + Math.random() * 0.6,
      t: 0, life: 0.35 + Math.random() * 0.4,
      kind: 'spark',
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      col: Math.random() < 0.45 ? 0xffe070 : 0xff7424,
    });
  }

  // Rising smoke puffs that linger after the flash
  const puffs = Math.min(6, 2 + Math.round(s * 1.4));
  for (let i = 0; i < puffs; i++) {
    state.fx.push({
      x: x + (Math.random() - 0.5) * s * 0.7,
      y: y + (Math.random() - 0.5) * s * 0.7,
      scale: s * (0.45 + Math.random() * 0.5),
      t: 0, life: 0.7 + Math.random() * 0.7,
      kind: 'smoke',
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.35 - Math.random() * 0.4,
    });
  }
}

/** Light bullet/shell impact — a small flash and a few sparks. */
export function spawnImpact(state: GameState, x: number, y: number): void {
  state.fx.push({ x, y, scale: 0.5, t: 0, life: 0.16, kind: 'expl' });
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = 1 + Math.random() * 2.2;
    state.fx.push({
      x, y, scale: 0.4 + Math.random() * 0.3,
      t: 0, life: 0.2 + Math.random() * 0.18,
      kind: 'spark',
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      col: 0xffe080,
    });
  }
}

/** Oriented muzzle flash at a gun barrel tip (`dir` = firing direction). */
export function spawnMuzzle(state: GameState, x: number, y: number, dir: number): void {
  state.fx.push({ x, y, scale: 1, t: 0, life: 0.09, kind: 'muzzle', rot: dir });
}

/** Sand plume kicked up behind a moving tracked/wheeled vehicle. */
export function spawnDust(state: GameState, x: number, y: number): void {
  state.fx.push({
    x: x + (Math.random() - 0.5) * 0.3,
    y: y + (Math.random() - 0.5) * 0.3,
    scale: 0.5 + Math.random() * 0.4,
    t: 0, life: 0.45 + Math.random() * 0.35,
    kind: 'dust',
    vx: (Math.random() - 0.5) * 0.25,
    vy: -0.12 - Math.random() * 0.18,
  });
}
