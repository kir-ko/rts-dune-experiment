import type { GameState, Building } from '../types/index.js';
import { activatePalaceSuper, isPalaceReady, PALACE_COOLDOWN } from '../systems/palace.js';
import { showToast } from './toast.js';

type StartTargetingCb = (palaceId: number) => void;
type CancelTargetingCb = () => void;

let onStartTargeting: StartTargetingCb = () => {};
let onCancelTargeting: CancelTargetingCb = () => {};

// Currently rendered palace id — null when panel is hidden. Used to detect
// when we need to rebuild DOM (selection changed) vs just refresh text.
let mountedPalaceId: number | null = null;

export function initPalacePanel(
  startTargeting: StartTargetingCb,
  cancelTargeting: CancelTargetingCb,
): void {
  onStartTargeting = startTargeting;
  onCancelTargeting = cancelTargeting;
}

/**
 * Refresh the Palace control panel based on current selection. Hidden when
 * the player has no palace selected. The DOM is built ONCE per palace selection
 * to keep the activation button stable across the click event lifecycle —
 * rebuilding via innerHTML every frame would destroy the button between
 * mousedown and mouseup, swallowing the click.
 */
export function updatePalacePanel(
  state: GameState,
  targetingPalaceId: number | null,
): void {
  const panel = document.getElementById('palace-panel');
  if (!panel) return;

  const palace = getSelectedPlayerPalace(state);
  if (!palace) {
    if (mountedPalaceId !== null) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      mountedPalaceId = null;
    }
    return;
  }

  // Rebuild structure only when the selected palace changes
  if (mountedPalaceId !== palace.id) {
    const { title, desc } = abilityInfo(palace);
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="ptitle">${title}</div>
      <div class="pdesc">${desc}</div>
      <div class="pbar"><i id="palace-bar" style="width:0%"></i></div>
      <button id="palace-activate"></button>
    `;
    mountedPalaceId = palace.id;

    const btn = document.getElementById('palace-activate') as HTMLButtonElement | null;
    if (btn) {
      btn.addEventListener('click', () => handleClick(state, targetingPalaceIdFromCallbacks));
    }
  }

  // Refresh dynamic state every frame (cheap text/class updates, no DOM rebuild)
  const ready = isPalaceReady(palace);
  const cd = palace.superCooldown;
  const ratio = ready ? 1 : 1 - cd / PALACE_COOLDOWN;
  const isTargeting = targetingPalaceId === palace.id;
  const { btnLabel, targetMode } = abilityInfo(palace);

  // Stash latest state for click handler (avoid stale closures)
  latestState = state;
  latestPalace = palace;
  latestTargetingId = targetingPalaceId;
  latestTargetMode = targetMode;

  const bar = document.getElementById('palace-bar') as HTMLElement | null;
  if (bar) bar.style.width = `${(ratio * 100) | 0}%`;

  const btn = document.getElementById('palace-activate') as HTMLButtonElement | null;
  if (btn) {
    if (isTargeting) {
      btn.textContent = 'CANCEL TARGETING';
      btn.classList.add('targeting');
      btn.disabled = false;
    } else if (ready) {
      btn.textContent = btnLabel;
      btn.classList.remove('targeting');
      btn.disabled = false;
    } else {
      btn.textContent = `READY IN ${Math.ceil(cd)}s`;
      btn.classList.remove('targeting');
      btn.disabled = true;
    }
  }
}

// ── Click handler — uses module-level "latest" refs to avoid stale closure ──
let latestState: GameState | null = null;
let latestPalace: Building | null = null;
let latestTargetingId: number | null = null;
let latestTargetMode = false;

const targetingPalaceIdFromCallbacks = () => latestTargetingId;

function handleClick(_state: GameState, _getTarget: () => number | null): void {
  const state = latestState, palace = latestPalace;
  if (!state || !palace || palace.dead) return;

  const isTargeting = latestTargetingId === palace.id;
  if (isTargeting) {
    onCancelTargeting();
    return;
  }
  if (!isPalaceReady(palace)) return;

  if (latestTargetMode) {
    onStartTargeting(palace.id);
    showToast('DEATH HAND ARMED — click target on map');
  } else {
    const ok = activatePalaceSuper(palace, state, null);
    if (ok) showToast(palace.faction === 'atreides'
      ? 'Fremen reinforcements deployed!'
      : 'Saboteur dispatched!');
  }
}

// ── Utility ──────────────────────────────────────────────────
function getSelectedPlayerPalace(state: GameState): Building | null {
  if (state.selection.length !== 1) return null;
  const id = state.selection[0]!;
  const b = state.buildings.find(b => b.id === id);
  if (!b || b.dead) return null;
  if (b.kind !== 'palace') return null;
  if (b.faction !== state.faction) return null;
  if (b.constructing) return null;
  return b;
}

function abilityInfo(palace: Building): {
  title: string; desc: string; btnLabel: string; targetMode: boolean;
} {
  switch (palace.faction) {
    case 'atreides':
      return {
        title: 'PALACE — FREMEN',
        desc: 'Summon a Fremen squad on the map edge nearest to the enemy.',
        btnLabel: 'CALL FREMEN',
        targetMode: false,
      };
    case 'harkonnen':
      return {
        title: 'PALACE — DEATH HAND',
        desc: 'Long-range nuclear strike. Click to choose target.',
        btnLabel: 'LAUNCH DEATH HAND',
        targetMode: true,
      };
    case 'ordos':
      return {
        title: 'PALACE — SABOTEUR',
        desc: 'Spawn a free Saboteur near the Palace.',
        btnLabel: 'DEPLOY SABOTEUR',
        targetMode: false,
      };
  }
}
