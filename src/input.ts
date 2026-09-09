import type { Game } from '@haelp/teto/types';
import type { GameAction } from './settings';

export class FrameInput {
  private held = new Set<GameAction>();
  private pending: { type: 'keydown' | 'keyup'; key: GameAction; subframe: number }[] = [];

  press(key: GameAction, subframe = 0): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    this.pending.push({ type: 'keydown', key, subframe });
    return true;
  }

  release(key: GameAction, subframe = 0) {
    if (this.held.delete(key)) this.pending.push({ type: 'keyup', key, subframe });
  }

  drain(frame: number): Game.Replay.Frame[] {
    return this.pending.splice(0).map(({ key, type, subframe }) => ({ frame, type, data: { key, subframe: Math.max(0, Math.min(0.9, Math.floor(subframe * 10) / 10)) } }));
  }

  reset() { this.held.clear(); this.pending = []; }
}
