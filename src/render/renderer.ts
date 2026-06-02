/**
 * PixiJS rendering layer.
 * Reads GameState, never writes to it.
 * syncScene() updates the PixiJS scene graph each frame.
 */
import {
  Application, Container, Graphics, Sprite, Text, BLEND_MODES,
} from 'pixi.js';
import type { GameState, BuildingKind, UnitKind } from '../types/index.js';
import { TILE, MAP_W, MAP_H, VIEW_W, VIEW_H } from '../constants/map.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { spriteCache, tileKey, unitKey, buildKey } from './sprites.js';
import { fogAt, isEntityVisible } from '../systems/fog.js';
import { isStealthVisible } from '../systems/combat.js';
import { buildingCenter } from '../state/gameState.js';
import { canPlaceAt } from '../systems/production.js';

export interface SceneLayers {
  app: Application;
  map: Container;
  buildings: Container;
  ground: Container;
  projectiles: Container;
  fx: Container;
  air: Container;
  fogLayer: Graphics;
  uiLayer: Container;
  placementPreview: Graphics;
  selectionBox: Graphics;
}

/**
 * On-screen display scale per unit kind. Sprites are authored ~24px (≈1 tile);
 * these multipliers enlarge them for readability and establish a clear size
 * hierarchy (infantry < trike < tank < heavy). Textures use NEAREST scaling
 * (see sprites.ts) so upscaling stays crisp pixel-art, not blurry.
 */
const SPRITE_SCALE: Record<UnitKind, number> = {
  infantry: 1.2,
  fremen: 1.2,
  sardaukar: 1.25,
  trike: 1.4,
  tank: 1.6,
  siegeTank: 1.75,
  launcher: 1.55,
  harvester: 1.5,
  special: 1.7,
  stealthTank: 1.5,
  carryall: 1.5,
  ornithopter: 1.45,
};
function spriteScale(kind: UnitKind): number {
  return SPRITE_SCALE[kind] ?? 1.3;
}

// Reused sprite pools — separate maps per layer to avoid cross-layer cleanup collisions
const groundUnitSprites = new Map<number, Container>();
const airUnitSprites = new Map<number, Container>();
const buildingSprites = new Map<number, Container>();
const wormSprites = new Map<number, Container>();
const mapTileSprites: Sprite[][] = [];

export function createScene(app: Application): SceneLayers {
  const mapC = new Container();
  const buildingsC = new Container();
  const groundC = new Container();
  const projC = new Container();
  const fxC = new Container();
  const airC = new Container();
  const fogGfx = new Graphics();
  const uiC = new Container();
  const placementGfx = new Graphics();
  const selBoxGfx = new Graphics();

  app.stage.addChild(mapC);
  app.stage.addChild(buildingsC);
  app.stage.addChild(groundC);
  app.stage.addChild(projC);
  app.stage.addChild(fxC);
  app.stage.addChild(airC);
  app.stage.addChild(fogGfx);
  // Screen-fixed atmospheric vignette — warm, darkened edges sell the harsh
  // desert sun. Sits above the world/fog but below interactive UI overlays.
  const vignette = makeVignette();
  app.stage.addChild(vignette);
  app.stage.addChild(uiC);
  app.stage.addChild(placementGfx);
  app.stage.addChild(selBoxGfx);

  return {
    app, map: mapC, buildings: buildingsC, ground: groundC,
    projectiles: projC, fx: fxC, air: airC,
    fogLayer: fogGfx, uiLayer: uiC,
    placementPreview: placementGfx,
    selectionBox: selBoxGfx,
  };
}

/**
 * Build a screen-sized vignette sprite via a Canvas2D radial gradient.
 * Transparent centre → warm-dark corners. Drawn once, never updated.
 */
function makeVignette(): Sprite {
  const c = document.createElement('canvas');
  c.width = VIEW_W;
  c.height = VIEW_H;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.34,
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.78,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.75, 'rgba(24,12,2,0.22)');
  grad.addColorStop(1, 'rgba(16,8,0,0.5)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const sp = Sprite.from(c);
  sp.eventMode = 'none';
  return sp;
}

// ── Full render pass ──────────────────────────────────────────
export function syncScene(
  state: GameState,
  layers: SceneLayers,
  placingKind: BuildingKind | null,
  mouseWorld: { x: number; y: number } | null,
): void {
  const { camX, camY } = state;

  renderMap(state, layers, camX, camY);
  renderBuildings(state, layers, camX, camY);
  renderGroundUnits(state, layers, camX, camY);
  renderWorms(state, layers, camX, camY);
  renderProjectiles(state, layers, camX, camY);
  renderEffects(state, layers, camX, camY);
  renderAirUnits(state, layers, camX, camY);
  renderFog(state, layers.fogLayer, camX, camY);
  renderPlacementPreview(state, layers.placementPreview, placingKind, mouseWorld, camX, camY);
}

// ── Map tiles ─────────────────────────────────────────────────
function renderMap(state: GameState, layers: SceneLayers, camX: number, camY: number): void {
  const { map: container } = layers;
  const x0 = Math.max(0, Math.floor(camX / TILE));
  const y0 = Math.max(0, Math.floor(camY / TILE));
  const x1 = Math.min(MAP_W, x0 + Math.ceil(VIEW_W / TILE) + 1);
  const y1 = Math.min(MAP_H, y0 + Math.ceil(VIEW_H / TILE) + 1);

  // Ensure tile sprite pool is sized
  while (mapTileSprites.length < MAP_H) mapTileSprites.push([]);

  let spriteIdx = 0;
  const allSprites = container.children as Sprite[];

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (fogAt(state, x, y) === 0) continue;
      const tile = state.map[y]![x]!;
      const key = tileKey(tile.type, tile.v);
      const tex = spriteCache.get(key);
      if (!tex) continue;

      let sp: Sprite;
      if (spriteIdx < allSprites.length) {
        sp = allSprites[spriteIdx]!;
        sp.texture = tex;
      } else {
        sp = new Sprite(tex);
        container.addChild(sp);
      }
      sp.x = x * TILE - camX;
      sp.y = y * TILE - camY;
      sp.visible = true;
      spriteIdx++;
    }
  }
  // Hide unused sprites
  for (let i = spriteIdx; i < allSprites.length; i++) {
    allSprites[i]!.visible = false;
  }
}

// ── Buildings ─────────────────────────────────────────────────
function renderBuildings(state: GameState, layers: SceneLayers, camX: number, camY: number): void {
  const container = layers.buildings;

  // Remove sprites for dead buildings
  for (const [id, cont] of buildingSprites) {
    if (!state.buildings.find(b => b.id === id && !b.dead)) {
      container.removeChild(cont);
      cont.destroy();
      buildingSprites.delete(id);
    }
  }

  for (const b of state.buildings) {
    if (b.dead) continue;

    // Fog check
    const c = buildingCenter(b);
    const visible = b.faction === state.faction || isEntityVisible(state, c.x, c.y, Math.max(b.w, b.h) / 2);
    if (!visible) {
      const existing = buildingSprites.get(b.id);
      if (existing) existing.visible = false;
      continue;
    }

    let cont = buildingSprites.get(b.id);
    if (!cont) {
      cont = new Container();
      const key = buildKey(b.faction, b.kind);
      const tex = spriteCache.get(key);
      if (tex) {
        const sp = new Sprite(tex);
        sp.name = 'body';
        cont.addChild(sp);
      }
      // Turret barrel (rotates) — anchored at the building centre
      const def = BUILD_DEFS[b.kind];
      if (def.weapon) {
        const barrelTex = spriteCache.get(`${key}_barrel`);
        if (barrelTex) {
          const barrel = new Sprite(barrelTex);
          barrel.name = 'barrel';
          barrel.anchor.set(0.5);
          barrel.x = b.w * TILE / 2;
          barrel.y = b.h * TILE / 2;
          cont.addChild(barrel);
        }
      }
      // HP bar
      const hpBar = new Graphics();
      hpBar.name = 'hpBar';
      cont.addChild(hpBar);
      // Selection ring
      const selRing = new Graphics();
      selRing.name = 'selRing';
      cont.addChild(selRing);
      container.addChild(cont);
      buildingSprites.set(b.id, cont);
    }

    cont.visible = true;

    // Rotate turret barrel toward target
    const barrel = cont.getChildByName('barrel') as Sprite | null;
    if (barrel) barrel.rotation = b.dir;

    cont.x = b.tx * TILE - camX;
    cont.y = b.ty * TILE - camY;
    const def = BUILD_DEFS[b.kind];
    const bw = b.w * TILE, bh = b.h * TILE;

    // Construction overlay (dim everything except HP bar / selection ring)
    const bodySprite = cont.getChildByName('body') as Sprite | null;
    if (bodySprite) bodySprite.alpha = b.constructing ? 0.6 : 1;
    if (barrel) barrel.alpha = b.constructing ? 0.6 : 1;

    // HP bar
    const hpBar = cont.getChildByName('hpBar') as Graphics;
    hpBar.clear();
    if (b.hp < b.maxHp) {
      const hpr = b.hp / b.maxHp;
      hpBar.beginFill(0x000000); hpBar.drawRect(0, -6, bw, 4); hpBar.endFill();
      const col = hpr > 0.5 ? 0x33aa33 : hpr > 0.25 ? 0xcccc88 : 0xcc3333;
      hpBar.beginFill(col); hpBar.drawRect(1, -5, (bw - 2) * hpr, 2); hpBar.endFill();
    }
    if (b.constructing) {
      const r = b.constructTime / b.constructNeed;
      hpBar.beginFill(0xff8c2a); hpBar.drawRect(2, bh - 5, (bw - 4) * r, 4); hpBar.endFill();
    }

    // Selection ring
    const selRing = cont.getChildByName('selRing') as Graphics;
    selRing.clear();
    if (state.selection.includes(b.id)) {
      selRing.lineStyle(2, 0xffc870);
      selRing.drawRect(-1, -1, bw + 2, bh + 2);
    }
  }
}

// ── Ground units ──────────────────────────────────────────────
function renderGroundUnits(state: GameState, layers: SceneLayers, camX: number, camY: number): void {
  syncUnitLayer(state, layers.ground, groundUnitSprites, camX, camY, false);
}
function renderAirUnits(state: GameState, layers: SceneLayers, camX: number, camY: number): void {
  syncUnitLayer(state, layers.air, airUnitSprites, camX, camY, true);
}

function syncUnitLayer(
  state: GameState,
  container: Container,
  spriteMap: Map<number, Container>,
  camX: number, camY: number,
  airOnly: boolean,
): void {
  // Remove sprites for dead / mismatched units
  for (const [id, cont] of spriteMap) {
    const u = state.units.find(u => u.id === id);
    const isAir = u?.kind === 'carryall' || u?.kind === 'ornithopter';
    if (!u || u.dead || u.carried || isAir !== airOnly) {
      container.removeChild(cont);
      cont.destroy({ children: true });
      spriteMap.delete(id);
    }
  }

  for (const u of state.units) {
    if (u.dead || u.carried) continue;
    const isAir = u.kind === 'carryall' || u.kind === 'ornithopter';
    if (isAir !== airOnly) continue;

    if (u.faction !== state.faction && !isEntityVisible(state, u.x, u.y, 0.5)) {
      const existing = spriteMap.get(u.id);
      if (existing) existing.visible = false;
      continue;
    }

    // Stealth: enemy stealth units invisible unless one of our units/buildings is within range
    if (u.faction !== state.faction && !isStealthVisible(state, u, state.faction)) {
      const existing = spriteMap.get(u.id);
      if (existing) existing.visible = false;
      continue;
    }

    let cont = spriteMap.get(u.id);
    if (!cont) {
      cont = new Container();
      const sc = spriteScale(u.kind);
      // Shadow (ellipse) — scales with the (now larger) unit body
      const shadow = new Graphics();
      shadow.name = 'shadow';
      shadow.beginFill(0x000000, isAir ? 0.45 : 0.35);
      if (isAir) shadow.drawEllipse(8 * sc, 8 * sc, 12 * sc, 6 * sc);
      else shadow.drawEllipse(0, 4 * sc, 8 * sc, 4 * sc);
      shadow.endFill();
      cont.addChild(shadow);

      const key = unitKey(u.faction, u.kind);
      const tex = spriteCache.get(key);
      if (tex) {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.scale.set(sc);
        sp.name = 'body';
        cont.addChild(sp);
      }
      // Tank-class units: separate rotating turret on top of body
      if (u.kind === 'tank' || u.kind === 'siegeTank') {
        const turretKey = u.kind === 'siegeTank'
          ? `unit_${u.faction}_siegeTank_turret`
          : `unit_${u.faction}_tank_turret`;
        const turretTex = spriteCache.get(turretKey);
        if (turretTex) {
          const tsp = new Sprite(turretTex);
          tsp.anchor.set(0.5);
          tsp.scale.set(sc);
          tsp.name = 'turret';
          cont.addChild(tsp);
        }
      }
      // HP/spice bar
      const bar = new Graphics(); bar.name = 'bar'; cont.addChild(bar);
      // Mining / depositing animation (harvesters only)
      if (u.kind === 'harvester') {
        const dust = new Graphics(); dust.name = 'dust'; cont.addChild(dust);
      }
      // Selection ring
      const ring = new Graphics(); ring.name = 'ring'; cont.addChild(ring);

      container.addChild(cont);
      spriteMap.set(u.id, cont);
    }

    cont.visible = true;
    cont.x = Math.round(u.x * TILE - camX);
    cont.y = Math.round(u.y * TILE - camY);

    const body = cont.getChildByName('body') as Sprite | null;
    // Sprites are drawn facing RIGHT (angle 0) — rotation = dir directly
    if (body) {
      body.rotation = u.dir;
      if (body.tint !== 0xffffff) body.tint = 0xffffff;
    }
    // Tank-class turret: rotates independently to track target (turretDir)
    if (u.kind === 'tank' || u.kind === 'siegeTank') {
      const turret = cont.getChildByName('turret') as Sprite | null;
      if (turret) {
        turret.rotation = u.turretDir;
        if (turret.tint !== 0xffffff) turret.tint = 0xffffff;
      }
    }

    const bar = cont.getChildByName('bar') as Graphics;
    bar.clear();
    const hpr = u.hp / u.maxHp;
    // Bar geometry follows the scaled sprite so it clears the (larger) body.
    const sc = spriteScale(u.kind);
    const texH = body ? body.texture.height : 24;
    const texW = body ? body.texture.width : 24;
    const halfH = (texH * sc) / 2;
    const bw = Math.max(14, Math.round(texW * sc * 0.7));
    const barTop = -halfH - 5;
    // Always show HP bar for all units
    bar.beginFill(0x000000, 0.7); bar.drawRect(-bw/2, barTop, bw, 3); bar.endFill();
    const hpCol = hpr > 0.6 ? 0x33aa33 : hpr > 0.3 ? 0xcccc88 : 0xcc3333;
    bar.beginFill(hpCol); bar.drawRect(-bw/2+1, barTop+1, Math.max(0, (bw-2)*hpr), 1); bar.endFill();

    // Harvester spice cargo bar
    if (u.kind === 'harvester') {
      const fill = u.spice / 500;
      const cy = halfH + 1;
      bar.beginFill(0x1a1208); bar.drawRect(-bw/2, cy, bw, 2); bar.endFill();
      bar.beginFill(0xff8c2a); bar.drawRect(-bw/2+1, cy+1, (bw-2)*fill, 1); bar.endFill();
    }

    // Mining dust animation
    const dust = cont.getChildByName('dust') as Graphics | null;
    if (dust) {
      dust.clear();
      if (u.mode === 'mining') {
        const t = performance.now() * 0.003;
        const r = 3 + Math.sin(t * 4) * 1.5;
        const alpha = 0.35 + Math.sin(t * 3) * 0.15;
        dust.beginFill(0xff8c2a, alpha);
        dust.drawCircle(7, 3, r);
        dust.drawCircle(-5, -2, r * 0.65);
        dust.endFill();
      }
      // Depositing: blinking yellow dot
      if (u.mode === 'depositing') {
        const blink = Math.sin(performance.now() * 0.008) > 0;
        if (blink) {
          dust.beginFill(0xffd860, 0.9);
          dust.drawCircle(0, -12, 3);
          dust.endFill();
        }
      }
    }

    const ring = cont.getChildByName('ring') as Graphics;
    ring.clear();
    if (state.selection.includes(u.id)) {
      ring.lineStyle(1.5, 0xffc870);
      // Stable radius from the texture (not rotated AABB) so it doesn't pulse.
      ring.drawCircle(0, 0, Math.max(texW, texH) * sc * 0.55);
    }
  }
}

// ── Sandworms ────────────────────────────────────────────────
function renderWorms(state: GameState, layers: SceneLayers, camX: number, camY: number): void {
  const container = layers.ground;

  // Drop sprites for despawned/dead worms
  for (const [id, cont] of wormSprites) {
    if (!state.worms.find(w => w.id === id && !w.dead)) {
      container.removeChild(cont);
      cont.destroy({ children: true });
      wormSprites.delete(id);
    }
  }

  for (const w of state.worms) {
    if (w.dead) continue;
    if (w.mode === 'underground' || w.mode === 'dive') continue; // hidden
    if (fogAt(state, Math.floor(w.x), Math.floor(w.y)) < 2) continue;

    let cont = wormSprites.get(w.id);
    if (!cont) {
      cont = new Container();
      const tex = spriteCache.get('worm_body');
      if (tex) {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.name = 'body';
        cont.addChild(sp);
      }
      // Soft shadow
      const shadow = new Graphics();
      shadow.beginFill(0x000000, 0.4);
      shadow.drawEllipse(0, 6, 18, 5);
      shadow.endFill();
      cont.addChildAt(shadow, 0);
      container.addChild(cont);
      wormSprites.set(w.id, cont);
    }

    cont.x = Math.round(w.x * TILE - camX);
    cont.y = Math.round(w.y * TILE - camY);
    const body = cont.getChildByName('body') as Sprite | null;
    if (body) body.rotation = w.dir;
  }
}

// ── Projectiles ───────────────────────────────────────────────
// Additive glow halo under each projectile makes tracers/rockets pop against
// the dark desert. Colour + radius vary by kind.
const PROJ_GLOW: Record<string, { col: number; r: number }> = {
  bullet:    { col: 0xffe060, r: 3 },
  shell:     { col: 0xffae40, r: 5 },
  rocket:    { col: 0xff8030, r: 5 },
  sonic:     { col: 0x88ccff, r: 7 },
  deathHand: { col: 0xff5050, r: 9 },
};
function renderProjectiles(state: GameState, layers: SceneLayers, camX: number, camY: number): void {
  const container = layers.projectiles;
  // Destroy all old, re-add — projectiles are short-lived
  container.removeChildren();

  for (const p of state.projectiles) {
    if (fogAt(state, Math.floor(p.x), Math.floor(p.y)) < 2) continue;
    const px = p.x * TILE - camX, py = p.y * TILE - camY;

    // Glow halo (additive)
    const glowDef = PROJ_GLOW[p.kind];
    if (glowDef) {
      const glow = new Graphics();
      glow.blendMode = BLEND_MODES.ADD;
      glow.beginFill(glowDef.col, 0.55);
      glow.drawCircle(0, 0, glowDef.r);
      glow.endFill();
      glow.beginFill(glowDef.col, 0.3);
      glow.drawCircle(0, 0, glowDef.r * 1.7);
      glow.endFill();
      glow.x = px; glow.y = py;
      container.addChild(glow);
    }

    const key = `proj_${p.kind}`;
    const tex = spriteCache.get(key);
    if (!tex) continue;
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    sp.x = px;
    sp.y = py;
    sp.rotation = p.dir;
    container.addChild(sp);
  }
}

// ── Explosion / particle effects ──────────────────────────────
function renderEffects(state: GameState, layers: SceneLayers, camX: number, camY: number): void {
  const container = layers.fx;
  container.removeChildren();

  for (const ef of state.fx) {
    if (fogAt(state, Math.floor(ef.x), Math.floor(ef.y)) < 2) continue;
    const r2 = ef.t / ef.life;           // 0 → 1 over lifetime
    const alpha = 1 - r2;
    const g = new Graphics();

    switch (ef.kind) {
      case 'expl': {
        // Layered fireball: deep-orange body, amber mid, white-hot core (additive).
        g.blendMode = BLEND_MODES.ADD;
        const rad = (5 + 20 * r2) * ef.scale;
        g.beginFill(0xff5418, alpha * 0.55);
        g.drawCircle(0, 0, rad);
        g.endFill();
        g.beginFill(0xffa830, alpha * 0.8);
        g.drawCircle(0, 0, rad * 0.62);
        g.endFill();
        g.beginFill(0xfff2c0, alpha * 0.95);
        g.drawCircle(0, 0, rad * 0.3);
        g.endFill();
        break;
      }
      case 'shock': {
        // Thin expanding ring — fades fast, gives the blast a snap.
        const rad = (3 + 34 * r2) * ef.scale;
        g.lineStyle(Math.max(1, 2.5 * (1 - r2)), 0xffe6b0, alpha * 0.7);
        g.drawCircle(0, 0, rad);
        break;
      }
      case 'spark': {
        // Bright ember with a short motion streak in its travel direction.
        g.blendMode = BLEND_MODES.ADD;
        const col = ef.col ?? 0xffd860;
        const s = 0.7 + (1 - r2) * 2 * ef.scale;
        if (ef.vx || ef.vy) {
          g.lineStyle(s * 0.9, col, alpha * 0.8);
          g.moveTo(0, 0);
          g.lineTo(-(ef.vx ?? 0) * 2.4, -(ef.vy ?? 0) * 2.4);
        }
        g.beginFill(col, alpha);
        g.drawCircle(0, 0, s);
        g.endFill();
        break;
      }
      case 'smoke': {
        // Expanding soft grey puff, normal blend so it darkens the scene.
        const rad = (4 + 12 * r2) * ef.scale;
        const a = (1 - r2) * 0.4;
        g.beginFill(0x2a2218, a);
        g.drawCircle(0, 0, rad);
        g.endFill();
        g.beginFill(0x4a3c2a, a * 0.7);
        g.drawCircle(-rad * 0.22, -rad * 0.22, rad * 0.62);
        g.endFill();
        break;
      }
      case 'dust': {
        // Pale sand kick-up — lighter and shorter-lived than smoke.
        const rad = (3 + 7 * r2) * ef.scale;
        const a = (1 - r2) * 0.38;
        g.beginFill(0xcaa868, a);
        g.drawCircle(0, 0, rad);
        g.endFill();
        g.beginFill(0xe4c890, a * 0.6);
        g.drawCircle(-rad * 0.2, -rad * 0.2, rad * 0.55);
        g.endFill();
        break;
      }
      case 'muzzle': {
        // Oriented flash: bright petal pointing along the firing direction.
        g.blendMode = BLEND_MODES.ADD;
        g.rotation = ef.rot ?? 0;
        const len = 9 * (1 - r2 * 0.5);
        g.beginFill(0xffe9a0, alpha);
        g.moveTo(0, -2.4);
        g.lineTo(len, 0);
        g.lineTo(0, 2.4);
        g.lineTo(-2, 0);
        g.closePath();
        g.endFill();
        g.beginFill(0xffffff, alpha * 0.9);
        g.drawCircle(0, 0, 2.4 * alpha + 0.6);
        g.endFill();
        break;
      }
      case 'wormtrail': {
        const rad = (4 + 8 * r2) * ef.scale;
        g.beginFill(0x9c7838, alpha * 0.7);
        g.drawCircle(0, 0, rad);
        g.endFill();
        g.beginFill(0x3a2a14, alpha * 0.4);
        g.drawCircle(0, 0, rad * 0.6);
        g.endFill();
        break;
      }
      case 'corpse': {
        // Crushed infantry — flattened body with a blood splat. Fades over `life`.
        const fadeAlpha = Math.min(1, 2 * (1 - r2));
        g.beginFill(0x6a1010, fadeAlpha * 0.85);
        g.drawEllipse(0, 0, 6 * ef.scale, 4 * ef.scale);
        g.endFill();
        g.beginFill(0x4a0808, fadeAlpha * 0.9);
        g.drawEllipse(-2, 1, 3, 2);
        g.drawEllipse(3, -1, 2, 2);
        g.endFill();
        const ftcol = ef.faction === 'atreides' ? 0x3a78d8
                    : ef.faction === 'harkonnen' ? 0xcc2424
                    : 0x2c9c44;
        g.beginFill(ftcol, fadeAlpha * 0.6);
        g.drawRect(-3, -2, 6, 4);
        g.endFill();
        g.beginFill(0x000000, fadeAlpha * 0.7);
        g.drawRect(-3, -2, 6, 1);
        g.endFill();
        break;
      }
      case 'bloom': {
        // Spice bloom: orange burst that fades to a ring.
        g.blendMode = BLEND_MODES.ADD;
        const rad = (12 + 28 * r2) * ef.scale;
        g.beginFill(0xff8c2a, alpha * 0.8);
        g.drawCircle(0, 0, rad);
        g.endFill();
        g.lineStyle(2, 0xffd860, alpha);
        g.drawCircle(0, 0, rad * 1.1);
        break;
      }
    }
    g.x = ef.x * TILE - camX;
    g.y = ef.y * TILE - camY;
    container.addChild(g);
  }
}

// ── Fog of war overlay ────────────────────────────────────────
function renderFog(state: GameState, fogGfx: Graphics, camX: number, camY: number): void {
  fogGfx.clear();
  const x0 = Math.max(0, Math.floor(camX / TILE));
  const y0 = Math.max(0, Math.floor(camY / TILE));
  const x1 = Math.min(MAP_W, x0 + Math.ceil(VIEW_W / TILE) + 1);
  const y1 = Math.min(MAP_H, y0 + Math.ceil(VIEW_H / TILE) + 1);

  fogGfx.beginFill(0x000000, 1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (fogAt(state, x, y) === 0) fogGfx.drawRect(x * TILE - camX, y * TILE - camY, TILE, TILE);
    }
  }
  fogGfx.endFill();

  fogGfx.beginFill(0x000000, 0.55);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (fogAt(state, x, y) === 1) fogGfx.drawRect(x * TILE - camX, y * TILE - camY, TILE, TILE);
    }
  }
  fogGfx.endFill();
}

// ── Building placement preview ────────────────────────────────
export function renderPlacementPreview(
  state: GameState,
  g: Graphics,
  kind: BuildingKind | null,
  mouseWorld: { x: number; y: number } | null,
  camX: number, camY: number,
): void {
  g.clear();
  if (!kind || !mouseWorld) return;
  const def = BUILD_DEFS[kind];
  const tx = Math.floor(mouseWorld.x - def.w / 2 + 0.5);
  const ty = Math.floor(mouseWorld.y - def.h / 2 + 0.5);
  const ok: boolean = canPlaceAt(state.faction, kind, tx, ty, state);
  g.lineStyle(2, ok ? 0x80ff80 : 0xff4040, 1);
  g.beginFill(ok ? 0x80ff80 : 0xff4040, 0.15);
  g.drawRect(tx * TILE - camX + 1, ty * TILE - camY + 1, def.w * TILE - 2, def.h * TILE - 2);
  g.endFill();
}

// ── Selection box (drag) ─────────────────────────────────────
export function renderSelectionBox(state: GameState, g: Graphics): void {
  g.clear();
  if (!state.selBox) return;
  const { x0, y0, x1, y1 } = state.selBox;
  g.lineStyle(1, 0xffc870);
  g.beginFill(0xffc870, 0.08);
  g.drawRect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(x1-x0), Math.abs(y1-y0));
  g.endFill();
}

// ── Pause overlay ────────────────────────────────────────────
export function renderPauseOverlay(app: Application, paused: boolean): void {
  const existing = app.stage.getChildByName('pauseOverlay');
  if (!paused) { if (existing) app.stage.removeChild(existing); return; }
  if (existing) return; // already shown

  const g = new Graphics();
  g.name = 'pauseOverlay';
  g.beginFill(0x000000, 0.5); g.drawRect(0, 0, VIEW_W, VIEW_H); g.endFill();
  const t = new Text('— PAUSED —', { fontFamily: 'Courier New', fontSize: 36, fill: 0xffc870, fontWeight: 'bold' });
  t.anchor.set(0.5); t.x = VIEW_W / 2; t.y = VIEW_H / 2;
  g.addChild(t);
  app.stage.addChild(g);
}
