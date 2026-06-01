/**
 * Minimap rendered to a standalone HTML <canvas> element via Canvas2D.
 * Lives in the sidebar — does not overlap the game viewport.
 */
import type { GameState } from '../types/index.js';
import { MAP_W, MAP_H, TILE, VIEW_W, VIEW_H } from '../constants/map.js';
import { FACTIONS } from '../constants/factions.js';
import { fogAt, isEntityVisible } from '../systems/fog.js';
import { buildingCenter, hasBuilding } from '../state/gameState.js';
import { jumpCamTo } from '../input/camera.js';

let cvs: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

export function initMinimap(getState: () => GameState | null): void {
  cvs = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  if (!cvs) return;
  ctx = cvs.getContext('2d');

  cvs.addEventListener('click', (e: MouseEvent) => {
    const state = getState();
    if (!state || !cvs) return;
    const rect = cvs.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / cvs.clientWidth;
    const fy = (e.clientY - rect.top) / cvs.clientHeight;
    jumpCamTo(state, fx * MAP_W, fy * MAP_H);
  });
}

export function renderMinimap(state: GameState): void {
  if (!ctx || !cvs) return;
  const W = cvs.width, H = cvs.height;
  const sx = W / MAP_W, sy = H / MAP_H;

  // Check radar availability
  const radarActive = hasBuilding(state.faction, 'radar', state);

  // Background
  ctx.fillStyle = '#0a0804';
  ctx.fillRect(0, 0, W, H);

  // Radar sweep overlay (subtle green tint when active)
  if (radarActive) {
    const t = (performance.now() * 0.001) % (Math.PI * 2);
    const alpha = 0.04 + Math.sin(t * 2) * 0.02;
    ctx.fillStyle = `rgba(0, 255, 80, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Terrain tiles
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const fog = fogAt(state, x, y);
      if (fog === 0) {
        // With radar: unexplored areas show as dark grey instead of black
        ctx.fillStyle = radarActive ? '#1a1410' : '#000000';
        ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
        continue;
      }
      const t = state.map[y]![x]!;
      if (t.type === 'rock') ctx.fillStyle = '#5c4a33';
      else if (t.type === 'spice' || t.type === 'spice2') ctx.fillStyle = t.type === 'spice2' ? '#ff6420' : '#ff8c2a';
      else if (t.type === 'dune') ctx.fillStyle = '#b8873a';
      else ctx.fillStyle = '#c89848';
      ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      if (fog === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
  }

  // Buildings
  for (const b of state.buildings) {
    if (b.dead) continue;
    const bc = buildingCenter(b);
    const visible = b.faction === state.faction
      || isEntityVisible(state, bc.x, bc.y, 1)
      || (radarActive && b.faction !== state.faction); // radar reveals enemy buildings
    if (!visible) continue;
    ctx.globalAlpha = (radarActive && b.faction !== state.faction && !isEntityVisible(state, bc.x, bc.y, 1)) ? 0.55 : 1;
    ctx.fillStyle = FACTIONS[b.faction].primaryCSS;
    ctx.fillRect(b.tx * sx, b.ty * sy, b.w * sx + 0.5, b.h * sy + 0.5);
    ctx.globalAlpha = 1;
  }

  // Units — 2×2 dots
  for (const u of state.units) {
    if (u.dead || u.carried) continue;
    const visible = u.faction === state.faction
      || isEntityVisible(state, u.x, u.y, 0.5)
      || radarActive; // radar reveals all enemy units on minimap
    if (!visible) continue;
    // Enemy units on radar: pulsing red dot
    const isRadarOnly = radarActive && u.faction !== state.faction && !isEntityVisible(state, u.x, u.y, 0.5);
    if (isRadarOnly) {
      const pulse = 0.5 + Math.sin(performance.now() * 0.005) * 0.3;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ff4040';
      ctx.fillRect(u.x * sx - 1.5, u.y * sy - 1.5, 3, 3);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#' + FACTIONS[u.faction].accent.toString(16).padStart(6, '0');
      ctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2.5, 2.5);
    }
  }

  // Sandworms (only in sweep modes — underground worms are hidden)
  for (const w of state.worms) {
    if (w.dead || w.mode === 'underground' || w.mode === 'dive') continue;
    const blink = Math.sin(performance.now() * 0.01) > 0;
    ctx.fillStyle = blink ? '#dca050' : '#9c7838';
    ctx.fillRect(w.x * sx - 1.5, w.y * sy - 1.5, 3, 3);
  }

  // Viewport rectangle
  const { camX, camY } = state;
  ctx.strokeStyle = '#ffc870';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    (camX / TILE) * sx,
    (camY / TILE) * sy,
    (VIEW_W / TILE) * sx,
    (VIEW_H / TILE) * sy,
  );

  // Radar indicator label
  if (radarActive) {
    const pulse = Math.sin(performance.now() * 0.004) > 0;
    if (pulse) {
      ctx.fillStyle = 'rgba(0,255,80,0.7)';
      ctx.font = '8px Courier New';
      ctx.fillText('● RADAR ACTIVE', 3, H - 3);
    }
  }
}
