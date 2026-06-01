import type { GameState } from '../types/index.js';
import { BUILD_DEFS } from '../constants/buildings.js';
import { statsFor } from '../constants/units.js';
import { UNIT_NAMES } from '../constants/factions.js';
import { powerOf } from '../systems/power.js';

export function updateHud(state: GameState): void {
  el('spice').textContent = Math.floor(state.spice).toString();

  const pw = powerOf(state.faction, state);
  const pwEl = el('power');
  pwEl.textContent = `${pw.prod}/${pw.cons}`;
  pwEl.classList.toggle('pwarn', pw.prod < pw.cons);

  el('faction').textContent = state.faction.toUpperCase();

  const sel = state.selection;
  let info = '—';
  if (sel.length === 1) {
    const id = sel[0]!;
    const u = state.units.find(u => u.id === id);
    const b = state.buildings.find(b => b.id === id);
    if (u) info = (UNIT_NAMES[u.faction][u.kind]) ?? u.kind.toUpperCase();
    else if (b) info = BUILD_DEFS[b.kind].name;
  } else if (sel.length > 1) {
    info = `${sel.length} UNITS`;
  }
  el('selinfo').textContent = info;
}

export function updateProductionPanel(state: GameState): void {
  const container = el('prodq');
  let html = '';
  for (const b of state.buildings) {
    if (b.dead || b.constructing || b.faction !== state.faction) continue;
    if (!b.productionQueue.length) continue;
    const head = b.productionQueue[0]!;
    const need = statsFor(b.faction, head).buildTime;
    const r = Math.min(1, b.productionProgress / need);
    const name = UNIT_NAMES[state.faction][head] ?? head;
    html += `<div class="row act">${BUILD_DEFS[b.kind].name}: ${name} (${b.productionQueue.length})
      <div class="pbar"><i style="width:${(r * 100) | 0}%"></i></div></div>`;
  }
  if (!html) html = '<div class="row" style="color:#5c4a33">— idle —</div>';
  container.innerHTML = html;
}

function el(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
