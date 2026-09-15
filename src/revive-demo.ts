import type { EngineSnapshot, TetrominoSnapshot } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { QuickPlayRuntime, type QpCheckpoint } from './qp-runtime';
import { qpVisual, type QpVisual } from './qp-mod-state';
import type { QpOperation } from './qp-search';

export type ReviveDemoFrame = { board: EngineSnapshot['board']; piece: TetrominoSnapshot | null; visual: QpVisual; target: QpOperation['target'] };
export class ReviveDemo {
  readonly runtime: QuickPlayRuntime;
  age = 0;
  completed = false;
  frame: ReviveDemoFrame;
  private lock: TetrominoSnapshot | null = null;
  constructor(source: QpCheckpoint, readonly operation: QpOperation) {
    this.runtime = QuickPlayRuntime.fromCheckpoint(source); this.runtime.settings.quickplay.trigger = 'none';
    if (this.runtime.settings.quickplay.pressure.mode === 'generated') this.runtime.settings.quickplay.pressure.mode = 'none';
    this.runtime.sides.forEach(side => { side.plan = null; });
    const side = this.runtime.sides[0];
    side.engine.events.on('falling.lock.pre', () => { this.lock = side.engine.falling.snapshot(); });
    this.frame = { board: structuredClone(side.engine.board.state), piece: side.engine.falling.snapshot(), visual: structuredClone(qpVisual(side, source.frame, true)), target: operation.target };
  }
  advance() {
    if (this.completed) return;
    const side = this.runtime.sides[0], board = structuredClone(side.engine.board.state), visual = structuredClone(qpVisual(side, this.runtime.frame, true));
    const inputs = this.operation.actions.filter(action => action.at === this.age).map(action => ({ frame: this.runtime.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as Game.Replay.Frame[];
    this.runtime.tick(inputs, []); this.age++;
    this.frame = this.lock ? { board, piece: this.lock, visual, target: this.operation.target } : { board: structuredClone(side.engine.board.state), piece: side.engine.falling.snapshot(), visual: structuredClone(qpVisual(side, this.runtime.frame, true)), target: this.operation.target };
    this.completed = !!this.lock || this.age >= this.operation.duration || this.runtime.over;
  }
}
