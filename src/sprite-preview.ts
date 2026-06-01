import { Application, Container, Sprite, Graphics, Text, TextStyle } from 'pixi.js';
import { initSprites, spriteCache, unitKey } from './render/sprites.js';
import type { FactionId, UnitKind } from './types/index.js';

const factions: FactionId[] = ['atreides', 'harkonnen', 'ordos'];
const factionLabels: Record<FactionId, string> = {
  atreides: 'ATREIDES',
  harkonnen: 'HARKONNEN',
  ordos: 'ORDOS',
};
const units: { kind: UnitKind; turret?: string; label: string }[] = [
  { kind: 'harvester',                                   label: 'HARVESTER (28×24)' },
  { kind: 'carryall',                                    label: 'CARRYALL (32×28)' },
  { kind: 'siegeTank',  turret: 'siegeTank_turret',      label: 'SIEGE TANK (32×32) + ROTATING TURRET' },
];
const ANGLES = 8;
const CELL = 96;        // bigger cells so 32×32 sprites read well
const COLS = ANGLES;
const SCALE = 2;        // 2× upscale of sprite within cell

// Layout: per unit → (header) + 3 faction rows of 8 cells each.
// We compute total height upfront.
const HEADER_H = 28;
const FACTION_H = 18;
const ROW_H = CELL + 16;
const PAD = 24;

function totalHeight(): number {
  let h = PAD;
  for (let i = 0; i < units.length; i++) {
    h += HEADER_H + (FACTION_H + ROW_H) * factions.length + 16;
  }
  return h + PAD;
}

const W = PAD * 2 + COLS * (CELL + 8);
const H = totalHeight();

async function main(): Promise<void> {
  const app = new Application({
    width: W, height: H,
    background: 0x1a1208,
    resolution: 1,
    antialias: false,
  });
  document.getElementById('root')!.appendChild(app.view as HTMLCanvasElement);

  // Generate all sprite textures (re-uses the same Application)
  initSprites(app);

  const headerStyle = new TextStyle({
    fontFamily: 'Courier New', fontSize: 14, fontWeight: 'bold',
    fill: 0xffc870, letterSpacing: 2,
  });
  const factionStyle = new TextStyle({
    fontFamily: 'Courier New', fontSize: 11, fontWeight: 'bold',
    fill: 0xd4a857, letterSpacing: 1,
  });
  const angleStyle = new TextStyle({
    fontFamily: 'Courier New', fontSize: 9,
    fill: 0x8a6a3a,
  });

  let y = PAD;
  for (const u of units) {
    // Unit header
    const h = new Text(u.label, headerStyle);
    h.x = PAD; h.y = y;
    app.stage.addChild(h);
    y += HEADER_H;

    for (const faction of factions) {
      const fl = new Text(factionLabels[faction], factionStyle);
      fl.x = PAD; fl.y = y;
      app.stage.addChild(fl);
      y += FACTION_H;

      for (let i = 0; i < ANGLES; i++) {
        const angle = (i / ANGLES) * Math.PI * 2;
        const cellX = PAD + i * (CELL + 8);
        const cellY = y;

        // Cell background
        const bg = new Graphics();
        bg.beginFill(0x2a1f12);
        bg.lineStyle(1, 0x5c4a33);
        bg.drawRect(cellX, cellY, CELL, CELL);
        bg.endFill();
        app.stage.addChild(bg);

        // Sprite container at cell centre
        const cont = new Container();
        cont.x = cellX + CELL / 2;
        cont.y = cellY + CELL / 2;
        app.stage.addChild(cont);

        const tex = spriteCache.get(unitKey(faction, u.kind));
        if (tex) {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5);
          sp.rotation = angle;
          sp.scale.set(SCALE);
          cont.addChild(sp);
        }
        if (u.turret) {
          const tt = spriteCache.get(`unit_${faction}_${u.turret}`);
          if (tt) {
            const ts = new Sprite(tt);
            ts.anchor.set(0.5);
            ts.rotation = angle;
            ts.scale.set(SCALE);
            cont.addChild(ts);
          }
        }

        // Angle label below cell
        const lbl = new Text(`${i * 45}°`, angleStyle);
        lbl.anchor.set(0.5, 0);
        lbl.x = cellX + CELL / 2;
        lbl.y = cellY + CELL + 2;
        app.stage.addChild(lbl);
      }
      y += ROW_H;
    }
    y += 16;
  }

  app.renderer.render(app.stage);
}

main();
