import type { Engine, EngineSnapshot } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import type { GameAction } from './settings';
import { createEngine } from './engine';
import { copyPiece, type Move } from './finesse';
import { applySpinPath, enumerateSpinPlacements } from './spin-movement';
import { qpEngineState, applyQpEngineState } from './qp-engine';
import { boardScore, inputPlan, placementEvidence, type BotAction, type BotPlan } from './qp-bot';
import { QuickPlayRuntime, copyQpCheckpoint, type QpCheckpoint, type QpSide } from './qp-runtime';
import { reviveHold, revivePlacement, type ReviveState } from './revive-tasks';

export type QpOperation = { actions: BotAction[]; duration: number; label: string; target?: [number, number][] };
export type ReviveRoute = { operations: QpOperation[]; targets: [number, number][][]; state: QpCheckpoint; score: number; complete: boolean; progress: number; consumed: number };
export type ReviveSearch = { status: 'Found' | 'BudgetExhausted' | 'UnknownFuture' | 'Unsupported' | 'NoTask'; routes: ReviveRoute[]; nodes: number; frames: number; depth: number; elapsedMs: number; limits: string[]; information: 'visible' | 'seeded' };
export type ReviveBudget = { nodes: number; depth: number; beam: number; milliseconds: number; information: 'visible' | 'seeded'; solutions?: number; objective?: 'effort' | 'survival' };
type Work = { nodes: number; frames: number; limit: number; deadline: number; expired: () => boolean };
type QueueBoundary = { remaining: number; unknown: boolean };

function heldInputs(engine: Engine): GameAction[] {
  return [...Object.entries(engine.input.keys).filter(([, held]) => held).map(([key]) => key as GameAction), ...engine.input.lShift.held ? ['moveLeft' as const] : [], ...engine.input.rShift.held ? ['moveRight' as const] : []];
}
function normalize(operation: QpOperation, engine: Engine, keep: GameAction[] = []) {
  const held = heldInputs(engine), release = held.filter(key => !keep.includes(key));
  const actions: BotAction[] = release.map(key => ({ at: 0, key, down: false }));
  actions.push(...keep.filter(key => !held.includes(key)).map(key => ({ at: 0, key, down: true })));
  actions.push(...operation.actions.filter(action => !keep.includes(action.key)).map(action => ({ ...action, at: action.at + 1 })));
  return { ...operation, actions, duration: operation.duration + 1 };
}
function operation(moves: Move[], engine: Engine, hold: boolean, label: string): QpOperation {
  const actions = inputPlan(moves, engine, hold);
  return { actions, duration: actions.at(-1)!.at + 1, label };
}
export function qpOperations(side: QpSide, work: Work) {
  const engine = side.engine, predicate = side.task?.prompts[side.task.active]?.predicate;
  const proposals: QpOperation[] = [], placements: { operation: QpOperation; score: number }[] = [], state = qpEngineState(engine), probe = createEngine(side.settings, 1, side.rules);
  const lock: { value?: { falling: EngineSnapshot['falling']; cells: [number, number][]; held: EngineSnapshot['hold'] } } = {};
  probe.events.on('falling.lock.pre', () => { lock.value = { falling: probe.falling.snapshot(), cells: probe.falling.absoluteBlocks, held: probe.held }; });
  const add = (candidate: QpOperation, keep: GameAction[] = []) => proposals.push(normalize(candidate, engine, keep));
  const tap = (key: GameAction) => ({ actions: [{ at: 0, key, down: true }, { at: 1, key, down: false }], duration: 2, label: key });
  if (predicate === 'rotate') {
    const prompt = side.task!.prompts[side.task!.active], count = prompt.target - prompt.count;
    for (const key of ['rotateCW', 'rotateCCW', ...side.rules.allow180 ? ['rotate180'] : []] as GameAction[]) {
      add({ actions: Array.from({ length: count }, (_, i) => [{ at: i * 2, key, down: true }, { at: i * 2 + 1, key, down: false }]).flat(), duration: count * 2, label: `Rotate ${count} times` });
    }
  }
  if (predicate === 'hold' && side.rules.hold && !engine.holdLocked) add(tap('hold'));
  if (['top3rows', 'nogarbage', 'nocancel', 'idle'].includes(predicate ?? '')) {
    const prompt = side.task!.prompts[side.task!.active];
    add({ actions: [], duration: Math.min(900, (prompt.target - prompt.count) * 60 + 15), label: 'Wait while the condition remains true' }, heldInputs(engine));
  }
  if (predicate === 'holddas') {
    const current = heldInputs(engine).filter(key => key === 'moveLeft' || key === 'moveRight');
    for (const key of current.length ? current : ['moveLeft', 'moveRight'] as GameAction[]) for (const rotate of [[], ['rotateCW'], ['rotateCCW'], ...side.rules.allow180 ? [['rotate180']] : []] as Move[][]) {
      const candidate = operation(rotate, engine, false, `Keep ${key === 'moveLeft' ? 'Left' : 'Right'} held through placement`), delay = Math.ceil(engine.handling.das + engine.handling.arr * engine.board.width) + 2;
      candidate.actions = candidate.actions.map(action => ({ ...action, at: action.at + delay })); candidate.duration += delay;
      add(candidate, [key]);
    }
  }
  for (const hold of [false, true]) {
    if (hold && (!side.rules.hold || engine.holdLocked)) continue;
    applyQpEngineState(probe, state);
    if (hold) probe.hold();
    const branch = probe.snapshot(), paths: Move[][] = [[]];
    for (const rotation of [[], ['rotateCCW'], ['rotateCW'], ...side.rules.allow180 ? [['rotate180']] : [['rotateCCW', 'rotateCCW']]] as Move[][]) {
      if (predicate === 'norotateclockwise' && rotation.some(move => move === 'rotateCW' || move === 'rotate180')) continue;
      const piece = copyPiece(probe, branch.falling);
      for (const move of rotation) piece.rotate(branch.board, probe.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false);
      const minimum = Math.min(...piece.blocks.map(([x]) => x)), maximum = Math.max(...piece.blocks.map(([x]) => x));
      for (let x = -minimum; x < probe.board.width - maximum; x++) {
        const dx = x - piece.x, move: Move = dx < 0 ? 'moveLeft' : 'moveRight';
        const shift: Move[] = x === -minimum && dx < -1 ? ['dasLeft'] : x === probe.board.width - maximum - 1 && dx > 1 ? ['dasRight'] : Array(Math.abs(dx)).fill(move);
        paths.push([...rotation, ...shift]);
      }
    }
    if ((/spin|ljgarbage|szgarbage/.test(predicate ?? '') || side.mods.some(mod => mod === 'allspin' || mod === 'allspin_reversed')) && !work.expired()) {
      const cap = Math.min(1600, Math.max(0, Math.floor((work.limit - work.nodes) / 5)));
      const reached = enumerateSpinPlacements(probe, branch, states => states >= cap || performance.now() > work.deadline, false);
      work.nodes += reached.states; paths.push(...reached.placements.filter(placement => placement.evidence.spin !== 'none').map(placement => placement.path.moves));
    }
    for (const moves of paths) {
      if (work.expired()) break;
      if (predicate === 'norotateclockwise' && moves.some(move => move === 'rotateCW' || move === 'rotate180')) continue;
      if (['spam', 'iclearspam', 'oclearspam'].includes(predicate ?? '') && moves.length) continue;
      const candidate = operation(moves, engine, hold, `${hold ? 'Hold, then ' : ''}${moves.length ? moves.join(', ') + ', ' : ''}Hard drop`);
      probe.fromSnapshot(branch);
      try {
        const task = side.task ? structuredClone(side.task) : null;
        if (task && hold) reviveHold(task);
        const { result } = applySpinPath(probe, { moves, cost: moves.length, source: 'extended', drop: 'hard' });
        work.nodes++;
        const locked = lock.value;
        if (result.topout || !locked) continue;
        candidate.target = locked.cells;
        if (task) {
          const evidence = placementEvidence(probe, result, locked.falling, locked.cells, moves, hold);
          evidence.heldPiece = locked.held;
          evidence.centerX = locked.falling.location[0] + (result.mino === 'o' ? 0 : 1);
          revivePlacement(task, evidence);
        }
        const score = taskProgress(task) + boardScore(probe.board.state) + taskPreparation({ ...side, engine: probe, task }) + (task ? 0 : result.lines * 7 + result.rawGarbage.reduce((a, b) => a + b, 0) * 2) - candidate.duration * .02;
        placements.push({ operation: normalize(candidate, engine, predicate === 'softdrop' ? ['softDrop'] : []), score });
      } catch (error) { if (!(error instanceof Error) || !error.message.startsWith('Unreachable')) throw error; }
    }
  }
  placements.sort((a, b) => b.score - a.score);
  proposals.push(...placements.map(placement => placement.operation));
  return [...new Map(proposals.map(candidate => [JSON.stringify([candidate.actions, candidate.duration]), candidate])).values()];
}
export function taskProgress(task: ReviveState | null) {
  return task ? task.active * 10000 + (task.prompts[task.active]?.count ?? 0) / (task.prompts[task.active]?.target ?? 1) * 8000 - task.resets * 100 : 0;
}
export function routeEffort(route: ReviveRoute) {
  return { inputs: route.operations.reduce((sum, operation) => sum + operation.actions.filter(action => action.down).length, 0), placements: route.targets.length, frames: route.operations.reduce((sum, operation) => sum + operation.duration, 0) };
}
export function compareReviveRoutes(a: ReviveRoute, b: ReviveRoute, effort = false) {
  const complete = Number(b.complete) - Number(a.complete);
  if (complete || !effort) return complete || b.score - a.score;
  if (!a.complete) return b.score - a.score;
  const left = routeEffort(a), right = routeEffort(b);
  return (a.complete ? 0 : b.progress - a.progress) || left.inputs - right.inputs || left.placements - right.placements || left.frames - right.frames || b.score - a.score;
}
function taskPreparation(side: QpSide) {
  const predicate = side.task?.prompts[side.task.active]?.predicate ?? '', board = side.engine.board.state, width = side.engine.board.width;
  let score = 0;
  if (predicate === 'iholdlines') score += side.engine.held === 'i' ? 160 : 0;
  const square = /odouble|oclear|placeoconsecutive|columnopiece|osingle/.test(predicate), quad = /quad|b2b/.test(predicate);
  if (square || quad) {
    const size = square ? 2 : 1, rows = square ? 2 : 4, desired = square ? 'o' : 'i';
    if (side.engine.held === desired) score += 25;
    let best = -Infinity;
    for (let x = 0; x <= width - size; x++) {
      const heights = Array.from({ length: size }, (_, i) => { let y = board.length - 1; while (y >= 0 && !board[y][x + i]) y--; return y + 1; });
      const bottom = Math.max(...heights); if (bottom + rows >= side.engine.board.height) continue;
      let filled = 0, blocked = 0;
      for (let y = bottom; y < bottom + rows; y++) for (let col = 0; col < width; col++) {
        if (col < x || col >= x + size) filled += Number(!!board[y][col]); else blocked += Number(!!board[y][col]);
      }
      best = Math.max(best, filled * 13 - bottom * 5 - blocked * 60 - (Math.max(...heights) - Math.min(...heights)) * 12);
    }
    score += Number.isFinite(best) ? best : 0;
  }
  if (/^combo(?:nohold)?$/.test(predicate)) {
    const prompt = side.task!.prompts[side.task!.active], rows = Math.min(10, prompt.target + 2);
    let reservoir = 0;
    for (const size of [3, 4]) for (const x of [0, width - size]) {
      let filled = 0, inside = 0;
      for (let y = 0; y < rows; y++) for (let col = 0; col < width; col++) {
        if (!board[y][col]) continue;
        if (col < x || col >= x + size) filled++; else inside++;
      }
      reservoir = Math.max(reservoir, filled * 8 - Math.max(0, inside - 3) * 9 + Math.min(3, inside) * 2);
    }
    score += reservoir;
  }
  if (/tspin|^spinclear$|^combospin$/.test(predicate)) {
    const needed = /triple/.test(predicate) ? 3 : /double/.test(predicate) ? 2 : 1;
    const shapes = [[[-1, 0], [0, 0], [1, 0], [0, 1]], [[0, -1], [0, 0], [0, 1], [1, 0]], [[-1, 0], [0, 0], [1, 0], [0, -1]], [[0, -1], [0, 0], [0, 1], [-1, 0]]];
    const occupied = (x: number, y: number) => x < 0 || x >= width || y < 0 || !!board[y]?.[x];
    const peak = board.reduce((top, row, y) => row.some(Boolean) ? y + 1 : top, 0);
    let slot = 0;
    for (let y = 1; y <= Math.min(side.engine.board.height - 3, peak + 1); y++) for (let x = 0; x < width; x++) {
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([dx, dy]) => occupied(x + dx, y + dy)).length;
      if (corners < 2) continue;
      for (const [rotation, shape] of shapes.entries()) {
        if (needed === 2 && !/up|mini/.test(predicate) && rotation !== 2) continue;
        if (needed === 2 && occupied(x, y + 1)) continue;
        if (shape.some(([dx, dy]) => occupied(x + dx, y + dy))) continue;
        const rows = [...new Set(shape.map(([, dy]) => y + dy))];
        const fills = rows.map(row => board[row].some(tile => String(tile?.mino) === 'gbd') ? 0 : board[row].filter(Boolean).length).sort((a, b) => b - a).slice(0, needed);
        if (fills.length < needed) continue;
        slot = Math.max(slot, fills.reduce((sum, fill) => sum + fill, 0) * 20 + (corners >= 3 ? 150 : 0) - y * 5);
      }
    }
    score += slot;
  }
  if (predicate === 'top3rows') {
    const top = board.reduce((peak, row, y) => row.some(Boolean) ? y + 1 : peak, 0);
    score += Math.min(top, side.engine.board.height - 2) * 28;
  }
  return score;
}
export function trialQpOperation(checkpoint: QpCheckpoint, sideIndex: number, candidate: QpOperation, work?: Work, boundary?: QueueBoundary) {
  const runtime = QuickPlayRuntime.fromCheckpoint(checkpoint), side = runtime.sides[sideIndex], initial = side.engine.stats.pieces;
  const originalTask = side.task, start = runtime.frame;
  let consumed = 0;
  const shift = side.engine.queue.shift.bind(side.engine.queue), unknown = Symbol();
  side.engine.queue.shift = () => {
    if (boundary && consumed >= boundary.remaining) { boundary.unknown = true; throw unknown; }
    consumed++; return shift();
  };
  runtime.sides.forEach(partner => { partner.plan = null; });
  try {
  for (let age = 0; age < candidate.duration; age++) {
    if (work?.expired()) return null;
    const inputs = candidate.actions.filter(action => action.at === age).map(action => ({ frame: side.engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as Game.Replay.Frame[];
    runtime.tick(sideIndex === 0 ? inputs : [], sideIndex === 1 ? inputs : []);
    if (work) { work.nodes++; work.frames++; }
    if (runtime.over || side.life !== 'alive') return null;
    if (side.engine.stats.pieces > initial && age < candidate.duration - 2) return null;
  }
  } catch (error) { if (error === unknown) return null; throw error; }
  const task = side.task ?? runtime.completed.find(entry => entry.side === sideIndex && entry.frame >= start)?.tasks ?? originalTask;
  const target = runtime.events.filter(event => event.type === 'lock' && event.side === sideIndex).map(event => (event.data as { cells: [number, number][] }).cells);
  const progress = taskProgress(task), complete = !!task && task.active === task.prompts.length;
  const score = progress + boardScore(side.engine.board.state) + taskPreparation(side) + (task ? 0 : side.engine.stats.lines * 7 + side.engine.stats.garbage.attack * 2) - (runtime.frame - checkpoint.frame) * .02;
  return { state: runtime.checkpoint(), target, progress, complete, score, consumed };
}
export function searchRevive(checkpoint: QpCheckpoint, sideIndex: number, budget: ReviveBudget): ReviveSearch {
  const start = performance.now(), saved = copyQpCheckpoint(checkpoint), initialTask = saved.sides[sideIndex]?.state.task;
  const result: ReviveSearch = { status: 'BudgetExhausted', routes: [], nodes: 0, frames: 0, depth: 0, elapsedMs: 0, limits: [], information: budget.information };
  if (!saved.sides[sideIndex] || saved.over || saved.sides[sideIndex].state.life !== 'alive') return { ...result, status: 'Unsupported', limits: ['The rescuer is not alive.'] };
  saved.settings.quickplay.trigger = 'none';
  if (saved.settings.quickplay.pressure.mode === 'generated') { saved.settings.quickplay.pressure.mode = 'none'; result.limits.push('Unannounced opponent attacks are unknown; queued garbage is simulated.'); }
  const work: Work = { nodes: 0, frames: 0, limit: budget.nodes, deadline: start + budget.milliseconds, expired() { return this.nodes >= this.limit || performance.now() >= this.deadline; } };
  const visible = Math.min(saved.sides[sideIndex].engine.snapshot.queue.value.length, QuickPlayRuntime.fromCheckpoint(saved).sides[sideIndex].rules.nextCount);
  let beam: ReviveRoute[] = [{ operations: [], targets: [], state: saved, score: -Infinity, complete: false, progress: taskProgress(initialTask), consumed: 0 }];
  const roots = new Map<string, ReviveRoute>();
  for (let depth = 0; depth < budget.depth && !work.expired(); depth++) {
    const children: ReviveRoute[] = [];
    for (const parent of beam) {
      if (parent.complete || work.expired()) continue;
      const runtime = QuickPlayRuntime.fromCheckpoint(parent.state), side = runtime.sides[sideIndex];
      for (const candidate of qpOperations(side, work).slice(0, depth === 0 ? 48 : 24)) {
        if (work.expired()) break;
        const boundary = budget.information === 'visible' ? { remaining: visible - parent.consumed, unknown: false } : undefined;
        const trial = trialQpOperation(parent.state, sideIndex, candidate, work, boundary);
        if (boundary?.unknown) { result.status = 'UnknownFuture'; if (!result.limits.includes('The visible Next queue has ended.')) result.limits.push('The visible Next queue has ended.'); }
        if (!trial) continue;
        const route: ReviveRoute = { operations: [...parent.operations, { ...candidate, target: trial.target[0] }], targets: [...parent.targets, ...trial.target], state: trial.state, score: trial.score, complete: trial.complete, progress: trial.progress, consumed: parent.consumed + trial.consumed };
        const root = JSON.stringify(route.operations[0].actions), previous = roots.get(root);
        if (!previous || compareReviveRoutes(route, previous, budget.objective === 'effort') < 0) roots.set(root, route);
        children.push(route);
        if (children.filter(child => child.complete).length >= (budget.solutions ?? 3)) break;
      }
    }
    result.depth = depth + 1;
    children.sort((a, b) => Number(b.complete) - Number(a.complete) || b.score - a.score);
    beam = children.slice(0, budget.beam);
    if (!children.length || [...roots.values()].filter(route => route.complete).length >= (budget.solutions ?? 3)) break;
  }
  result.routes = [...roots.values()].sort((a, b) => compareReviveRoutes(a, b, budget.objective === 'effort')).slice(0, 5);
  if (result.routes.some(route => route.complete)) result.status = 'Found';
  else if (!initialTask) result.status = 'NoTask';
  if (work.nodes >= work.limit) result.limits.push('Node budget reached.');
  if (performance.now() >= work.deadline) result.limits.push('Time budget reached.');
  if (result.depth >= budget.depth) result.limits.push('Planning depth reached.');
  result.nodes = work.nodes; result.frames = work.frames; result.elapsedMs = performance.now() - start;
  return result;
}
export function planQpBot(runtime: QuickPlayRuntime, sideIndex = 1, milliseconds = 1000): BotPlan {
  const side = runtime.sides[sideIndex], task = side.task, cap = runtime.settings.quickplay.bot.nodes;
  if (task?.finishedAt !== null && task?.finishedAt !== undefined) return { actions: [], duration: 6, cursor: 0, age: 0, target: null, nodes: 0, knownPieces: 0, taskActive: task.active, reason: 'Revive tasks complete.' };
  const result = searchRevive(runtime.checkpoint(), sideIndex, { nodes: cap, depth: task ? 8 : 2, beam: task ? 3 : 4, milliseconds, information: 'seeded', solutions: 1 });
  const best = result.routes[0], operation = best?.operations[0];
  return { actions: operation?.actions ?? [], duration: operation?.duration ?? 0, cursor: 0, age: 0, target: best?.targets[0] ?? null, nodes: result.nodes, knownPieces: best?.consumed ?? 0, taskActive: task?.active, reason: `${task ? 'Revive priority' : 'Stacking'} · full generated queue · ${result.depth}-step search · ${result.status}. ${operation?.label ?? 'No safe input plan found in this budget.'}` };
}
