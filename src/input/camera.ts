import type { GameState } from '../types/index.js';
import { MAP_W, MAP_H, TILE, VIEW_W, VIEW_H } from '../constants/map.js';

const CAMERA_SPEED = 700; // pixels per second

export function clampCam(state: GameState): void {
  const maxX = MAP_W * TILE - VIEW_W;
  const maxY = MAP_H * TILE - VIEW_H;
  state.camX = Math.max(0, Math.min(state.camX, maxX));
  state.camY = Math.max(0, Math.min(state.camY, maxY));
}

export function edgeScroll(state: GameState, keys: Set<string>, dt: number): void {
  const sp = CAMERA_SPEED * dt;
  if (keys.has('arrowleft') || keys.has('a'))  state.camX -= sp;
  if (keys.has('arrowright') || keys.has('d')) state.camX += sp;
  if (keys.has('arrowup') || keys.has('w'))    state.camY -= sp;
  if (keys.has('arrowdown') || keys.has('s'))  state.camY += sp;
  clampCam(state);
}

export function jumpCamTo(state: GameState, worldX: number, worldY: number): void {
  state.camX = worldX * TILE - VIEW_W / 2;
  state.camY = worldY * TILE - VIEW_H / 2;
  clampCam(state);
}

export function minimapClick(
  state: GameState,
  screenX: number, screenY: number,
  mmX: number, mmY: number, mmW: number, mmH: number,
): boolean {
  if (screenX < mmX || screenX > mmX + mmW || screenY < mmY || screenY > mmY + mmH) return false;
  const tx = (screenX - mmX) / (mmW / MAP_W);
  const ty = (screenY - mmY) / (mmH / MAP_H);
  jumpCamTo(state, tx, ty);
  return true;
}
