/**
 * Before / After readability stand.
 *
 * LEFT  = "БЫЛО" — current sprites at current 24px scale, live free-rotation.
 * RIGHT = "СТАЛО" — v2 prototype: bigger, higher-contrast, baked 16-dir frames.
 *
 * Both panels share an identical 24px tile grid and a mock HUD/sidebar so unit
 * scale can be judged against tiles AND UI. Vehicles rotate slowly so the
 * difference between live free-rotation (shimmer) and baked frames (crisp) is
 * visible. Nothing here touches the live game.
 */
import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { initSprites, spriteCache, unitKey, buildKey, tileKey } from './render/sprites.js';
import { buildV2, frameForAngle, V2Set } from './render/spritesV2.js';
import { TILE } from './constants/map.js';
import type { FactionId } from './types/index.js';

const FACTION: FactionId = 'atreides';

// ── Layout constants ──────────────────────────────────────────────
const W = 1320, H = 760;
const HUD_H = 40;          // mock top bar
const SIDE_W = 240;        // mock sidebar
const FIELD_X = 0, FIELD_Y = HUD_H;
const FIELD_W = W - SIDE_W; // battlefield area width
const FIELD_H = H - HUD_H;
const PANEL_W = FIELD_W / 2;

const UI = {
  bg: 0x0a0a0a, panel: 0x150e06, bar: 0x1a1208, border: 0x5c4a33,
  lbl: 0x8a6a3a, val: 0xffc870, body: 0xd4a857, hi: 0xffc870,
};

const font = (size: number, fill: number, weight: 'normal' | 'bold' = 'normal') =>
  new TextStyle({ fontFamily: 'Courier New', fontSize: size, fill, fontWeight: weight, letterSpacing: 1 });

async function main(): Promise<void> {
  const app = new Application({ width: W, height: H, background: UI.bg, antialias: false, resolution: 1 });
  document.getElementById('root')!.appendChild(app.view as HTMLCanvasElement);
  // Dev hook: pan the stage to inspect a region, e.g. __app.stage.x = -600.
  (window as unknown as { __app: Application }).__app = app;

  initSprites(app);            // BEFORE textures into spriteCache
  const v2 = buildV2(app, FACTION); // AFTER textures

  drawMockHud(app);
  drawMockSidebar(app);

  // Two battlefield panels
  const beforeRot = makePanel(app, FIELD_X, FIELD_Y, 'БЫЛО — сейчас (24px, свободный поворот)', false, v2);
  const afterRot  = makePanel(app, FIELD_X + PANEL_W, FIELD_Y, 'СТАЛО — v2 (крупнее · контраст · 16 запечённых направлений)', true, v2);

  // Slow rotation driver
  let angle = 0;
  app.ticker.add(() => {
    angle += app.ticker.deltaMS / 1000 * 0.45; // ~0.45 rad/s — неспешно
    beforeRot(angle);
    afterRot(angle);
  });
}

// ── Mock HUD strip (scale reference) ──────────────────────────────
function drawMockHud(app: Application): void {
  const g = new Graphics();
  g.beginFill(UI.bar); g.drawRect(0, 0, W, HUD_H); g.endFill();
  g.lineStyle(2, UI.border); g.moveTo(0, HUD_H); g.lineTo(W, HUD_H);
  app.stage.addChild(g);
  const items: Array<[string, string]> = [
    ['SPICE ', '1000'], ['  POWER ', '32/24'], ['  FACTION ', 'ATREIDES'], ['  SEL ', '—'],
  ];
  let x = 16;
  for (const [l, v] of items) {
    const lt = new Text(l, font(14, UI.lbl, 'bold')); lt.x = x; lt.y = 12; app.stage.addChild(lt); x += lt.width;
    const vt = new Text(v, font(14, UI.val, 'bold'));  vt.x = x; vt.y = 12; app.stage.addChild(vt); x += vt.width;
  }
  const tag = new Text('масштаб UI ←→ тайлов ←→ юнитов', font(11, UI.lbl)); tag.anchor.set(1, 0.5);
  tag.x = W - 12; tag.y = HUD_H / 2; app.stage.addChild(tag);
}

// ── Mock sidebar (scale reference) ────────────────────────────────
function drawMockSidebar(app: Application): void {
  const x0 = W - SIDE_W;
  const g = new Graphics();
  g.beginFill(UI.panel); g.drawRect(x0, HUD_H, SIDE_W, H - HUD_H); g.endFill();
  g.lineStyle(2, UI.border); g.moveTo(x0, HUD_H); g.lineTo(x0, H);
  app.stage.addChild(g);
  const tab = new Text('BUILD', font(13, UI.hi, 'bold')); tab.x = x0 + 14; tab.y = HUD_H + 10; app.stage.addChild(tab);
  const items = ['WIND TRAP 300', 'REFINERY 400', 'BARRACKS 300', 'LIGHT FAC. 400', 'HEAVY FAC. 600'];
  items.forEach((t, i) => {
    const by = HUD_H + 36 + i * 40;
    const b = new Graphics();
    b.lineStyle(1, UI.border); b.beginFill(UI.bar); b.drawRect(x0 + 10, by, SIDE_W - 20, 32); b.endFill();
    app.stage.addChild(b);
    const nm = new Text(t, font(12, UI.val, 'bold')); nm.x = x0 + 18; nm.y = by + 9; app.stage.addChild(nm);
  });
}

// ── A battlefield panel: tiled ground + grid + CY + 3 units ───────
function makePanel(
  app: Application, px: number, py: number, title: string, after: boolean, v2: V2Set,
): (angle: number) => void {
  const cols = Math.floor(PANEL_W / TILE);
  const rows = Math.floor(FIELD_H / TILE);

  const root = new Container(); root.x = px; root.y = py; app.stage.addChild(root);

  // ground tiles (sand, rock patch under the yard)
  const tiles = new Container(); root.addChild(tiles);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const onRock = tx >= 3 && tx <= 9 && ty >= 1 && ty <= 6;
      const key = onRock ? tileKey('rock', (tx + ty) % 3) : tileKey('sand', (tx * 3 + ty) % 4);
      const tex = spriteCache.get(key); if (!tex) continue;
      const sp = new Sprite(tex); sp.x = tx * TILE; sp.y = ty * TILE; tiles.addChild(sp);
    }
  }
  // AFTER: knock terrain value/contrast down so units pop (a real lever).
  if (after) {
    const dim = new Graphics();
    dim.beginFill(0x1a1206, 0.30); dim.drawRect(0, 0, cols * TILE, rows * TILE); dim.endFill();
    root.addChild(dim);
  }
  // tile grid overlay
  const grid = new Graphics(); grid.lineStyle(1, 0x000000, 0.16);
  for (let x = 0; x <= cols; x++) { grid.moveTo(x * TILE, 0); grid.lineTo(x * TILE, rows * TILE); }
  for (let y = 0; y <= rows; y++) { grid.moveTo(0, y * TILE); grid.lineTo(cols * TILE, y * TILE); }
  root.addChild(grid);

  // panel separator + title
  const sep = new Graphics(); sep.lineStyle(2, UI.border); sep.moveTo(PANEL_W, 0); sep.lineTo(PANEL_W, FIELD_H);
  root.addChild(sep);
  const t = new Text(title, font(13, after ? UI.hi : UI.body, 'bold')); t.x = 12; t.y = 8; root.addChild(t);

  // ── Construction Yard (footprint 2×2 = 48px, on the rock) ──
  const yardTx = 5, yardTy = 2;
  if (after) {
    const sp = new Sprite(v2.yard); sp.x = yardTx * TILE; sp.y = yardTy * TILE; root.addChild(sp);
  } else {
    const tex = spriteCache.get(buildKey(FACTION, 'yard'));
    if (tex) { const sp = new Sprite(tex); sp.x = yardTx * TILE; sp.y = yardTy * TILE; root.addChild(sp); }
  }
  label(root, 'CONSTRUCTION YARD · 48px', yardTx * TILE + 24, (yardTy + 2) * TILE + 4);

  // ── Three units in a row ──
  const baseY = 11 * TILE;
  const slots: Array<{ kind: 'infantry' | 'trike' | 'tank'; tx: number; before: number; after: number }> = [
    { kind: 'infantry', tx: 4,  before: 24, after: 24 },
    { kind: 'trike',    tx: 9,  before: 24, after: 34 },
    { kind: 'tank',     tx: 14, before: 24, after: 44 },
  ];

  const rotators: Array<(angle: number) => void> = [];
  // Magnified band (3× nearest) so pixel detail / rotation quality is judgeable.
  const MAG = 3;
  const magY = 18 * TILE;
  label(root, '↓ увеличено 3× — чёткость и детали ↓', PANEL_W / 2, magY - 5 * TILE);

  for (let si = 0; si < slots.length; si++) {
    const s = slots[si]!;
    const cx = s.tx * TILE, cy = baseY;
    const cont = new Container(); cont.x = cx; cont.y = cy; root.addChild(cont);
    // magnified clone position — evenly spread across the panel
    const magX = (si + 0.5) * (PANEL_W / slots.length);
    const magC = new Container(); magC.x = magX; magC.y = magY; root.addChild(magC);

    if (after) {
      const frames = v2[s.kind === 'tank' ? 'tank' : s.kind];
      // Fixed contact shadow — drawn UNDER the body, never rotated (stays put).
      const shRx = s.kind === 'infantry' ? 7 : s.kind === 'trike' ? 15 : 20;
      addShadow(cont, shRx, 11, 1);
      addShadow(magC, shRx, 11, MAG);
      const body = new Sprite(frames[0]!); body.anchor.set(0.5); cont.addChild(body);
      const mBody = new Sprite(frames[0]!); mBody.anchor.set(0.5); mBody.scale.set(MAG); magC.addChild(mBody);
      let turret: Sprite | null = null, mTurret: Sprite | null = null;
      if (s.kind === 'tank') {
        turret = new Sprite(v2.tankTurret[0]!); turret.anchor.set(0.5); cont.addChild(turret);
        mTurret = new Sprite(v2.tankTurret[0]!); mTurret.anchor.set(0.5); mTurret.scale.set(MAG); magC.addChild(mTurret);
      }
      rotators.push((a) => {
        const f = frameForAngle(frames, a); body.texture = f; mBody.texture = f;
        if (turret && mTurret) { const tf = frameForAngle(v2.tankTurret, a); turret.texture = tf; mTurret.texture = tf; }
      });
      label(root, `${s.kind.toUpperCase()} · ${s.after}px · крупнее+чётко`, cx, cy + 30);
    } else {
      const tex = spriteCache.get(unitKey(FACTION, s.kind));
      const body = new Sprite(tex); body.anchor.set(0.5); cont.addChild(body);
      const mBody = new Sprite(tex); mBody.anchor.set(0.5); mBody.scale.set(MAG); magC.addChild(mBody);
      let turret: Sprite | null = null, mTurret: Sprite | null = null;
      if (s.kind === 'tank') {
        const tt = spriteCache.get(`unit_${FACTION}_tank_turret`);
        if (tt) {
          turret = new Sprite(tt); turret.anchor.set(0.5); cont.addChild(turret);
          mTurret = new Sprite(tt); mTurret.anchor.set(0.5); mTurret.scale.set(MAG); magC.addChild(mTurret);
        }
      }
      rotators.push((a) => {
        body.rotation = a; mBody.rotation = a;
        if (turret && mTurret) { turret.rotation = a; mTurret.rotation = a; }
      });
      label(root, `${s.kind.toUpperCase()} · ${s.before}px`, cx, cy + 24);
    }
  }

  // legend on the AFTER panel
  if (after) {
    const lg = new Text(
      '+ суперсэмплинг 2× → даунсэмпл\n+ тёмный контур · контактная тень\n+ террейн притушен (фигура/фон)\n16 направлений: снап вместо вращения',
      font(11, UI.body),
    );
    lg.x = 12; lg.y = FIELD_H - 90; root.addChild(lg);
  }

  return (angle: number) => { for (const r of rotators) r(angle); };
}

/** Fixed contact shadow ellipse (does not rotate with the body). */
function addShadow(c: Container, rx: number, cy: number, mag: number): void {
  const g = new Graphics();
  g.beginFill(0x000000, 0.4);
  g.drawEllipse(0, cy * mag, rx * mag, rx * 0.42 * mag);
  g.endFill();
  c.addChild(g);
}

function label(root: Container, text: string, cx: number, y: number): void {
  const t = new Text(text, font(10, 0xcdb98a)); t.anchor.set(0.5, 0); t.x = cx; t.y = y; root.addChild(t);
}

main();
