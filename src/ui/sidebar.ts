import type { GameState, BuildingKind, UnitKind } from '../types/index.js';
import { BUILD_DEFS, BUILD_ORDER } from '../constants/buildings.js';
import { statsFor, canFactionProduce } from '../constants/units.js';
import { UNIT_NAMES } from '../constants/factions.js';
import { canBuild, canProduceUnit, queueUnit, findProducer, upgradeBuilding } from '../systems/production.js';

type PlacingCallback = (kind: BuildingKind) => void;
type CancelCallback = () => void;

let onStartPlacing: PlacingCallback = () => {};
let onCancelPlacing: CancelCallback = () => {};
let currentPlacing: BuildingKind | null = null;

export function initSidebar(onPlace: PlacingCallback, onCancel: CancelCallback): void {
  onStartPlacing = onPlace;
  onCancelPlacing = onCancel;

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = (tab as HTMLElement).dataset['tab'];
      const buildPanel = document.getElementById('tab-build')!;
      const unitPanel = document.getElementById('tab-units')!;
      buildPanel.classList.toggle('hidden', which !== 'build');
      unitPanel.classList.toggle('hidden', which !== 'units');
    });
  });
}

export function rebuildSidebar(state: GameState, placing: BuildingKind | null): void {
  currentPlacing = placing;
  buildBuildTab(state, placing);
  buildUnitsTab(state);
}

function buildBuildTab(state: GameState, placing: BuildingKind | null): void {
  const container = document.getElementById('tab-build')!;
  container.innerHTML = '';

  for (const kind of BUILD_ORDER) {
    const def = BUILD_DEFS[kind];

    // ── Upgrade button (no placement) ───────────────────────────
    if (def.upgradeOf) {
      const alreadyDone = state.buildings.some(
        b => b.faction === state.faction && b.kind === def.upgradeOf && b.upgraded && !b.dead,
      );
      const prereqOk = canBuild(state.faction, kind, state);
      const affordable = state.spice >= def.cost;

      const btn = document.createElement('button');
      btn.className = 'bbtn';
      btn.disabled = alreadyDone || !prereqOk || !affordable;
      btn.dataset['kind'] = kind;
      btn.dataset['upgrade'] = '1';
      btn.innerHTML = `
        <span class="nm">${alreadyDone ? '✓ ' : '↑ '}${def.name}</span>
        <span class="meta">${alreadyDone ? 'UPGRADED' : `${def.cost} spice`}</span>
        <span class="meta" style="opacity:0.8">${def.desc}</span>
      `;
      btn.addEventListener('click', () => {
        if (upgradeBuilding(kind, state)) rebuildSidebar(state, null);
      });
      container.appendChild(btn);
      continue;
    }

    // ── Normal placement button ──────────────────────────────────
    const affordable = state.spice >= def.cost;
    const techOk = canBuild(state.faction, kind, state);
    const isPlacing = placing === kind;

    const btn = document.createElement('button');
    btn.className = `bbtn${isPlacing ? ' placing' : ''}`;
    btn.disabled = (!techOk || !affordable) && !isPlacing;
    btn.dataset['kind'] = kind;
    const powerLabel = def.power >= 0 ? `+${def.power}` : `${def.power}`;
    btn.innerHTML = `
      <span class="nm">${def.name}</span>
      <span class="meta">${def.cost} spice &middot; PWR ${powerLabel}</span>
      <span class="meta" style="opacity:0.8">${def.desc}</span>
    `;
    btn.addEventListener('click', () => {
      if (currentPlacing === kind) {
        onCancelPlacing();
      } else if (canBuild(state.faction, kind, state) && state.spice >= def.cost) {
        onStartPlacing(kind);
      }
    });
    container.appendChild(btn);
  }
}

function buildUnitsTab(state: GameState): void {
  const container = document.getElementById('tab-units')!;
  container.innerHTML = '';

  const unitKinds: UnitKind[] = [
    'infantry', 'trike', 'tank', 'launcher', 'siegeTank', 'special',
    'harvester', 'carryall', 'stealthTank',
    // Palace-trained elite units (only show when Palace exists — production
    // gating is handled by canProduceUnit / findProducer).
    'sardaukar', 'ornithopter',
  ];
  for (const kind of unitKinds) {
    // Hide buttons for units this faction can't produce at all
    if (!canFactionProduce(state.faction, kind)) continue;
    const stats = statsFor(state.faction, kind);
    const name = UNIT_NAMES[state.faction][kind] ?? kind.toUpperCase();
    const canProduce = canProduceUnit(state.faction, kind, state);
    const affordable = state.spice >= stats.cost;
    const producer = findProducer(state.faction, kind, state);
    const queueLen = producer?.productionQueue.length ?? 0;

    const btn = document.createElement('button');
    btn.className = 'bbtn';
    btn.disabled = !canProduce || !affordable || queueLen >= 5;
    btn.dataset['kind'] = kind;
    btn.innerHTML = `
      <span class="nm">${name}</span>
      <span class="meta">${stats.cost} spice &middot; HP ${stats.hp} &middot; Q:${queueLen}/5</span>
    `;
    btn.addEventListener('click', () => queueUnit(kind, state));
    container.appendChild(btn);
  }
}

export function updateBuildButtons(state: GameState, placing: BuildingKind | null): void {
  // Lightweight update — just toggle disabled/placing states
  document.querySelectorAll<HTMLButtonElement>('#tab-build .bbtn').forEach(btn => {
    const kind = btn.dataset['kind'] as BuildingKind;
    if (btn.dataset['upgrade']) {
      const alreadyDone = state.buildings.some(
        b => b.faction === state.faction && b.kind === BUILD_DEFS[kind].upgradeOf && b.upgraded && !b.dead,
      );
      btn.disabled = alreadyDone || !canBuild(state.faction, kind, state) || !(state.spice >= BUILD_DEFS[kind].cost);
      return;
    }
    const def = BUILD_DEFS[kind];
    const techOk = canBuild(state.faction, kind, state);
    const affordable = state.spice >= def.cost;
    const isPlacing = placing === kind;
    btn.disabled = (!techOk || !affordable) && !isPlacing;
    btn.classList.toggle('placing', isPlacing);
  });
  document.querySelectorAll<HTMLButtonElement>('#tab-units .bbtn').forEach(btn => {
    const kind = btn.dataset['kind'] as UnitKind;
    const stats = statsFor(state.faction, kind);
    const canProduce = canProduceUnit(state.faction, kind, state);
    const affordable = state.spice >= stats.cost;
    const producer = findProducer(state.faction, kind, state);
    const queueLen = producer?.productionQueue.length ?? 0;
    btn.disabled = !canProduce || !affordable || queueLen >= 5;
    const meta = btn.querySelector('.meta');
    if (meta) meta.textContent = `${stats.cost} spice · HP ${stats.hp} · Q:${queueLen}/5`;
  });
}
