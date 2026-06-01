export const TILE = 24;           // pixels per tile
// MAP_W / MAP_H are MUTABLE — set at game start via setMapSize() so Skirmish
// can pick small / medium / large. ES module live bindings ensure every
// importer sees the current value on each read.
export let MAP_W = 96;            // tiles wide
export let MAP_H = 52;            // tiles tall
export const VIEW_W = 960;        // canvas width in pixels
export const VIEW_H = 600;        // canvas height in pixels
export const MINIMAP_W = 200;
export const MINIMAP_H = 120;

export type MapSize = 'small' | 'medium' | 'large';

export const MAP_SIZES: Record<MapSize, { w: number; h: number; label: string }> = {
  small:  { w:  64, h: 40, label: 'SMALL · 64×40'  },
  medium: { w:  96, h: 52, label: 'MEDIUM · 96×52' },
  large:  { w: 128, h: 72, label: 'LARGE · 128×72' },
};

export function setMapSize(size: MapSize): void {
  const m = MAP_SIZES[size];
  MAP_W = m.w;
  MAP_H = m.h;
}
