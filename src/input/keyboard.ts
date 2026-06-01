import type { GameState } from '../types/index.js';
import { queueUnit } from '../systems/production.js';
import { jumpCamTo } from './camera.js';

export const keys = new Set<string>();

export function bindKeyboard(
  getState: () => GameState | null,
  getPaused: () => boolean,
  setPaused: (v: boolean) => void,
  getPlacing: () => string | null,
  cancelPlacing: () => void,
): void {
  window.addEventListener('keydown', e => {
    keys.add(e.key.toLowerCase());
    const state = getState();
    if (!state || state.over) return;

    switch (e.code) {
      case 'Space': setPaused(!getPaused()); e.preventDefault(); break;
      case 'Escape':
        state.selection = [];
        cancelPlacing();
        document.getElementById('helpmodal')?.classList.add('hidden');
        break;
      case 'Digit1': queueUnit('infantry',  state); break;
      case 'Digit2': queueUnit('trike',     state); break;
      case 'Digit3': queueUnit('tank',      state); break;
      case 'Digit4': queueUnit('special',   state); break;
      case 'Digit5': queueUnit('harvester', state); break;
      case 'KeyC': selectFirstOf(state, 'carryall');  break;
      case 'KeyH': selectFirstOf(state, 'harvester'); break;
    }
  });

  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
}

function selectFirstOf(state: GameState, kind: string): void {
  const u = state.units.find(u => !u.dead && u.faction === state.faction && u.kind === kind && !u.carried);
  if (!u) return;
  state.selection = [u.id];
  jumpCamTo(state, u.x, u.y);
}
