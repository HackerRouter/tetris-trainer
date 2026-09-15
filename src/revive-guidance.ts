import { QuickPlayRuntime, type QpCheckpoint } from './qp-runtime';
import { qpOperations, trialQpOperation, type QpOperation } from './qp-search';
import { sameCells } from './practice';

export const reviveSearchDepth = 60;
export function reviveGuidanceIdentity(runtime: QuickPlayRuntime) {
  const side = runtime.sides[0], engine = side.engine, task = side.task;
  return JSON.stringify([engine.board.state, engine.falling.symbol, engine.stats.pieces, engine.held, engine.holdLocked, task?.active, task?.prompts.map(prompt => prompt.task), task?.resets, side.life, runtime.over, side.garbage.pending, side.garbage.entering, engine.misc.movement.lockTime, runtime.settings.quickplay.reviveNoGravity]);
}
const boardKey = (checkpoint: QpCheckpoint) => JSON.stringify(checkpoint.sides[0].engine.snapshot.board.map(row => row.map(tile => tile?.mino ?? null)));
export function reviveOutcomeMatches(expected: QpCheckpoint, actual: QpCheckpoint) {
  const left = expected.sides[0], right = actual.sides[0], a = left.engine.snapshot, b = right.engine.snapshot;
  if (actual.over || right.state.life !== 'alive' || boardKey(expected) !== boardKey(actual)) return false;
  if (a.stats.pieces !== b.stats.pieces || a.falling.symbol !== b.falling.symbol || a.hold !== b.hold || a.holdLocked !== b.holdLocked || JSON.stringify(a.queue) !== JSON.stringify(b.queue)) return false;
  const task = left.state.task, live = right.state.task;
  if (!task) return !live;
  if (!live || task.prompts.length !== live.prompts.length || task.prompts.some((prompt, i) => prompt.task !== live.prompts[i].task)) return false;
  if (task.active !== live.active || live.resets > task.resets || task.prompts.some((prompt, i) => live.prompts[i].count < prompt.count)) return false;
  return a.stats.combo === b.stats.combo && a.stats.b2b === b.stats.b2b && JSON.stringify(task.spinPieces) === JSON.stringify(live.spinPieces) && JSON.stringify(task.quadColumns) === JSON.stringify(live.quadColumns);
}
export class ReviveContinuation {
  index = 0;
  source: QpCheckpoint;
  expected: QpCheckpoint | null = null;
  constructor(source: QpCheckpoint, readonly operations: QpOperation[]) { this.source = source; this.prepare(); }
  get operation() { return this.operations[this.index]; }
  private prepare() { this.expected = this.operation ? trialQpOperation(this.source, 0, this.operation)?.state ?? null : null; }
  advance(checkpoint: QpCheckpoint) {
    if (!this.expected || !reviveOutcomeMatches(this.expected, checkpoint)) return false;
    const before = this.source.sides[0], after = this.expected.sides[0];
    if (before.engine.snapshot.stats.pieces === after.engine.snapshot.stats.pieces && JSON.stringify(before.state.task?.prompts.map(prompt => prompt.count)) === JSON.stringify(after.state.task?.prompts.map(prompt => prompt.count)) && before.engine.snapshot.hold === after.engine.snapshot.hold) return false;
    this.source = this.expected; this.index++; this.prepare(); return true;
  }
  holding(checkpoint: QpCheckpoint) {
    const original = this.source.sides[0].engine.snapshot, live = checkpoint.sides[0].engine.snapshot;
    return !!this.operation?.actions.some(action => action.key === 'hold' && action.down) && live.stats.pieces === original.stats.pieces && live.hold === original.falling.symbol && live.falling.symbol === (original.hold ?? original.queue.value[0]) && boardKey(this.source) === boardKey(checkpoint);
  }
}
export type ReviveValidation = { status: 'Reachable' | 'BudgetExhausted' | 'Unavailable' | 'Unsupported'; operation: QpOperation | null };
export function validateReviveGuidanceResult(checkpoint: QpCheckpoint, source: QpCheckpoint, operation: QpOperation, milliseconds = 180): ReviveValidation {
  const reference = trialQpOperation(source, 0, operation);
  if (!reference) return { status: 'Unsupported', operation: null };
  const runtime = QuickPlayRuntime.fromCheckpoint(checkpoint), side = runtime.sides[0], target = reference.target[0];
  const work = { nodes: 0, frames: 0, limit: 6000, deadline: performance.now() + milliseconds, expired() { return this.nodes >= this.limit || performance.now() >= this.deadline; } };
  const matches = (candidate: QpOperation) => {
    const trial = trialQpOperation(checkpoint, 0, candidate, work);
    if (!trial || trial.progress < reference.progress || trial.target.length !== reference.target.length || target && !sameCells(target, trial.target[0])) return null;
    return { ...candidate, target: trial.target[0] };
  };
  const unchanged = side.engine.holdLocked && operation.actions.some(action => action.key === 'hold' && action.down) ? null : matches(operation);
  if (unchanged && target) return { status: 'Reachable', operation: unchanged };
  const candidates = qpOperations(side, work).filter(candidate => target ? candidate.target && sameCells(candidate.target, target) : !candidate.target);
  candidates.sort((a, b) => a.actions.filter(action => action.down).length - b.actions.filter(action => action.down).length || a.duration - b.duration);
  for (const candidate of candidates) { if (work.expired()) break; const valid = matches(candidate); if (valid) return { status: 'Reachable', operation: valid }; }
  return { status: unchanged ? 'Reachable' : work.expired() ? 'BudgetExhausted' : 'Unavailable', operation: unchanged };
}
export function validateReviveGuidance(checkpoint: QpCheckpoint, source: QpCheckpoint, operation: QpOperation, milliseconds = 180) {
  return validateReviveGuidanceResult(checkpoint, source, operation, milliseconds).operation;
}
