import type { Engine, EngineSnapshot } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import type { GameAction } from './settings';
import { createEngine } from './engine';
import { copyPiece, type Move } from './finesse';
import { applySpinPath, enumerateSpinPlacements } from './spin-movement';
import { reachablePlacements } from './reachable-placements';
import { qpEngineState, applyQpEngineState } from './qp-engine';
import { boardScore, inputPlan, placementEvidence, pacedBotOperation, botStateKey, type BotStep, type BotAction, type BotPlan } from './qp-bot';
import { QuickPlayRuntime, copyQpCheckpoint, type QpCheckpoint, type QpSide } from './qp-runtime';
import { reviveHold, revivePlacement, type ReviveState } from './revive-tasks';
import { reviveShapePreparation, reviveSlotPreparation } from './revive-evaluation';
import { qpPcProposals } from './qp-pc';
import { qpComboProposals } from './qp-combo';
import { hasReviveConstruction, reviveConstructionProposals } from './revive-construction';

export type QpOperation = { actions: BotAction[]; duration: number; label: string; target?: [number, number][] };
export type ReviveRoute = { operations: QpOperation[]; targets: [number, number][][]; state: QpCheckpoint; score: number; complete: boolean; progress: number; consumed: number };
export type ReviveSearch = { status: 'Found' | 'BudgetExhausted' | 'UnknownFuture' | 'Unsupported' | 'NoTask'; routes: ReviveRoute[]; nodes: number; frames: number; depth: number; elapsedMs: number; limits: string[]; information: 'visible' | 'seeded' };
export type ReviveBudget = { nodes: number; depth: number; beam: number; milliseconds: number; information: 'visible' | 'seeded'; solutions?: number; objective?: 'effort' | 'survival'; fastInputs?: boolean; allowPreparation?: boolean; localPressure?: boolean };
type Work = { nodes: number; frames: number; limit: number; deadline: number; expired: () => boolean };
type QueueBoundary = { remaining: number; unknown: boolean };

export function verticallyShiftedQpTarget(expected: [number, number][], actual: [number, number][]) {
  if (!expected.length || expected.length !== actual.length) return false;
  const shift = Math.min(...actual.map(cell => cell[1])) - Math.min(...expected.map(cell => cell[1]));
  return expected.every(([x, y]) => actual.some(([ax, ay]) => x === ax && y + shift === ay));
}

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
function operation(moves: Move[], engine: Engine, hold: boolean, label: string, fast = false): QpOperation {
  const actions = inputPlan(moves, engine, hold, fast);
  return { actions, duration: actions.at(-1)!.at + 1, label };
}
export function qpOperations(side: QpSide, work: Work, fast = false, immediate = false) {
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
  if (['szgarbage', 'ljgarbage'].includes(predicate ?? '') && !engine.board.state.some(row => row.some(tile => tile?.mino === 'gb'))) {
    const ready = side.garbage.entering.length ? engine.frame + 5 : Math.min(...side.garbage.pending.map(packet => packet.ready));
    if (ready > engine.frame && Number.isFinite(ready)) add({ actions: [], duration: Math.min(60, ready - engine.frame), label: 'Keep incoming garbage available for the required Spin clear' }, heldInputs(engine));
  }
  if (['top3rows', 'nogarbage', 'nocancel', 'idle'].includes(predicate ?? '')) {
    const prompt = side.task!.prompts[side.task!.active];
    const condition = predicate === 'top3rows' ? engine.board.state.slice(engine.board.height - 3).some(row => row.some(Boolean)) : predicate === 'nogarbage' ? !engine.board.state.some(row => row.some(tile => tile?.mino === 'gb')) : true;
    if (condition) {
      const duration = Math.min(900, (prompt.target - prompt.count) * 60 + 15);
      for (const frames of predicate === 'top3rows' ? [...new Set([15, 30, 60, duration])] : [duration]) {
        add({ actions: [], duration: frames, label: 'Wait while the condition remains true' }, heldInputs(engine));
        if (predicate === 'top3rows') for (const key of ['moveLeft', 'moveRight'] as GameAction[]) {
          const release = Math.min(frames - 1, Math.ceil(engine.handling.das + engine.handling.arr * engine.board.width) + 2);
          add({ actions: [{ at: 0, key, down: true }, { at: release, key, down: false }], duration: frames, label: 'Move into open space while the stack timer runs' });
        }
      }
    }
  }
  if (predicate === 'holddas') {
    const current = heldInputs(engine).filter(key => key === 'moveLeft' || key === 'moveRight');
    for (const key of current.length ? current : ['moveLeft', 'moveRight'] as GameAction[]) for (const rotate of [[], ['rotateCW'], ['rotateCCW'], ...side.rules.allow180 ? [['rotate180']] : []] as Move[][]) {
      const candidate = operation(rotate, engine, false, `Keep ${key === 'moveLeft' ? 'Left' : 'Right'} held through placement`), delay = Math.ceil(engine.handling.das + engine.handling.arr * engine.board.width) + 2;
      candidate.actions = candidate.actions.map(action => ({ ...action, at: action.at + delay })); candidate.duration += delay;
      add(candidate, [key]);
    }
  }
  if (immediate && proposals.length) return proposals;
  for (const hold of [false, true]) {
    if (hold && (!side.rules.hold || engine.holdLocked)) continue;
    applyQpEngineState(probe, state);
    if (hold) probe.hold();
    const branch = probe.snapshot(), paths: Move[][] = [[]];
    for (const rotation of [[], ['rotateCCW'], ['rotateCW'], ...side.rules.allow180 && predicate !== 'norotateclockwise' ? [['rotate180']] : [['rotateCCW', 'rotateCCW']]] as Move[][]) {
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
    const wanted = predicate === 'szljspin' ? 'szlj' : /^tspin/.test(predicate ?? '') ? 't' : /^ispin/.test(predicate ?? '') ? 'i' : /^lj/.test(predicate ?? '') ? 'lj' : /^sz/.test(predicate ?? '') ? 'sz' : 'itszlj';
    const spin = /spin|ljgarbage|szgarbage/.test(predicate ?? '') && wanted.includes(probe.falling.symbol) || side.mods.some(mod => mod === 'allspin' || mod === 'allspin_reversed');
    if (spin && immediate) {
      const turns: Move[] = ['rotateCW', 'rotateCCW', ...side.rules.allow180 ? ['rotate180' as const] : []];
      const prefixes: Move[][] = [[], ...turns.map(turn => [turn]), ...paths];
      const suffixes: Move[][] = [...turns.map(turn => [turn]), ['rotateCW', 'rotateCW'], ['rotateCCW', 'rotateCCW']];
      paths.unshift(...prefixes.flatMap(prefix => suffixes.map(suffix => [...prefix, 'softDrop' as const, ...suffix])));
    }
    if (spin && !immediate && !work.expired()) {
      const cap = Math.min(1600, Math.max(0, Math.floor((work.limit - work.nodes) / 5)));
      const reached = enumerateSpinPlacements(probe, branch, states => states >= cap || performance.now() > work.deadline, false);
      work.nodes += reached.states; paths.push(...reached.placements.filter(placement => placement.evidence.spin !== 'none').map(placement => placement.path.moves));
    }
    const covered = branch.board.some((row, y) => row.some((tile, x) => !tile && !!branch.board[y + 1]?.[x]));
    if (covered && !immediate && !work.expired()) {
      const cap = Math.min(768, Math.max(0, Math.floor((work.limit - work.nodes) / 10)));
      const reached = reachablePlacements(probe, branch, probe.board.height + 4, count => count >= cap || performance.now() >= work.deadline, cap);
      work.nodes += reached.processed; paths.push(...reached.placements.filter(placement => placement.path.drop === 'soft').map(placement => placement.path.moves));
    }
    for (const moves of paths) {
      if (work.expired()) break;
      if (predicate === 'norotateclockwise' && moves.some(move => move === 'rotateCW' || move === 'rotate180')) continue;
      const candidate = operation(moves, engine, hold, `${hold ? 'Hold, then ' : ''}${moves.length ? moves.join(', ') + ', ' : ''}Hard drop`, fast);
      applyQpEngineState(probe, { ...state, snapshot: branch });
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
        if (immediate) {
          if (taskProgress(task) > taskProgress(side.task)) placements.push({ operation: normalize(candidate, engine, predicate === 'softdrop' ? ['softDrop'] : []), score: taskProgress(task) + taskBoardScore({ ...side, engine: probe, task }) + result.lines * 7 - candidate.duration * .02 });
          if (spin && placements.length >= 3) return placements.sort((a, b) => b.score - a.score).map(placement => placement.operation);
          continue;
        }
        const after = { ...side, engine: probe, task };
        const score = taskProgress(task) + taskBoardScore(after) + taskPreparation(after) + (task ? 0 : result.lines * 7 + result.rawGarbage.reduce((a, b) => a + b, 0) * 2) - candidate.duration * .02;
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
function taskBoardScore(side: QpSide) {
  const board = side.engine.board.state, predicate = side.task?.prompts[side.task.active]?.predicate;
  const height = board.reduce((peak, row, y) => row.some(Boolean) ? y + 1 : peak, 0);
  const incoming = side.garbage.entering.length + side.garbage.pending.filter(packet => packet.ready <= side.engine.frame + 45).reduce((sum, packet) => sum + packet.amount, 0);
  const elevated = ['top3rows', 'upperhalfquad', 'noclear', 'combo', 'combonohold', 'quadconsecutive', 'quadcombo'].includes(predicate ?? '');
  return boardScore(board) - (predicate ? Math.max(0, height + incoming - (predicate === 'upperhalfquad' ? 16 : elevated ? 22 : 10)) ** 2 * 18 : 0);
}
function taskPreparation(side: QpSide) {
  const predicate = side.task?.prompts[side.task.active]?.predicate ?? '', board = side.engine.board.state, width = side.engine.board.width;
  if (['tspintriple', 'ispindouble', 'szdouble', 'szspin', 'ljspin', 'szljspin'].includes(predicate)) return 0;
  let score = reviveShapePreparation(side) + reviveSlotPreparation(side);
  if (predicate === 'szgarbage' || predicate === 'ljgarbage') {
    const garbage = board.filter(row => row.some(tile => tile?.mino === 'gb')).length;
    score = garbage ? 200 : Math.min(4, side.garbage.entering.length + side.garbage.pending.reduce((sum, packet) => sum + packet.amount, 0)) * 40;
  }
  if (predicate === 'iholdlines') score += side.engine.held === 'i' ? 160 : 0;
  if (['placeoconsecutive', 'odoubleconsecutive', 'quadconsecutive'].includes(predicate)) {
    const wanted = predicate === 'quadconsecutive' ? 'i' : 'o';
    score += side.engine.held === wanted ? 300 : 0;
    const prompt = side.task!.prompts[side.task!.active];
    if (prompt.count && side.engine.held !== wanted && side.engine.falling.symbol !== wanted) score -= prompt.count / prompt.target * 8000;
  }
  const square = /odouble|oclear|placeoconsecutive|columnopiece|osingle/.test(predicate), quad = /quad|b2b/.test(predicate);
  if (square || quad) {
    const size = square ? 2 : 1, rows = square ? predicate === 'osingle' ? 1 : predicate === 'odoubleconsecutive' && !side.task!.prompts[side.task!.active].count ? 4 : 2 : predicate === 'quadconsecutive' && !side.task!.prompts[side.task!.active].count ? 8 : 4, desired = square ? 'o' : 'i';
    if (side.engine.held === desired) score += 25;
    const surface = Array.from({ length: width }, (_, x) => { let y = board.length - 1; while (y >= 0 && !board[y][x]) y--; return y + 1; });
    const raised = predicate === 'upperhalfquad', minimum = Math.floor(side.engine.board.height / 2) + 1;
    if (raised) score += surface.reduce((sum, height) => sum + Math.min(minimum, height) * 8, 0) + Math.min(minimum, Math.min(...surface)) * 100;
    let best = -Infinity;
    for (let x = 0; x <= width - size; x++) {
      if (predicate === 'oclearspam' && x !== Math.floor(width / 2) - 1) continue;
      if (predicate === 'quadbuckets' && side.task!.quadColumns.includes(x)) continue;
      const heights = Array.from({ length: size }, (_, i) => { let y = board.length - 1; while (y >= 0 && !board[y][x + i]) y--; return y + 1; });
      const bottom = Math.max(...heights); if (bottom + rows >= side.engine.board.height) continue;
      let filled = 0, blocked = 0;
      for (let y = bottom; y < bottom + rows; y++) for (let col = 0; col < width; col++) {
        if (col < x || col >= x + size) filled += Number(!!board[y][col]); else blocked += Number(!!board[y][col]);
      }
      const support = raised ? surface.reduce((sum, height, col) => sum + (col === x ? 0 : Math.max(0, bottom - height)), 0) : 0;
      best = Math.max(best, filled * (raised && bottom < minimum ? 2 : 13) + (raised ? Math.min(bottom, minimum) * 15 - support * 10 : 0) - bottom * 5 - blocked * 60 - (Math.max(...heights) - Math.min(...heights)) * 12);
    }
    score += Number.isFinite(best) ? best : 0;
  }
  if (/^combo(?:nohold)?$|^singleconsecutive$|^quadcombo$|^szsingle$/.test(predicate)) {
    const prompt = side.task!.prompts[side.task!.active], rows = Math.min(10, predicate === 'quadcombo' ? 10 : prompt.target + 2);
    const readyRows = board.filter(row => row.filter(Boolean).length >= width - 4).length;
    if (prompt.count && readyRows < prompt.target - prompt.count) score -= prompt.count / prompt.target * 8000;
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
        if (/mini/.test(predicate)) {
          const front = rotation === 0 ? [[-1, 1], [1, 1]] : rotation === 1 ? [[1, -1], [1, 1]] : rotation === 2 ? [[-1, -1], [1, -1]] : [[-1, -1], [-1, 1]];
          if (front.every(([dx, dy]) => occupied(x + dx, y + dy))) continue;
        }
        if (needed === 2 && !/up|mini/.test(predicate) && rotation !== 2) continue;
        if (needed === 2 && occupied(x, y + 1)) continue;
        if (shape.some(([dx, dy]) => occupied(x + dx, y + dy))) continue;
        const rows = [...new Set(shape.map(([, dy]) => y + dy))];
        const clears = rows.filter(row => board[row].filter(Boolean).length + shape.filter(([, dy]) => y + dy === row).length === width).length;
        if (/tspinsingle|tspindouble|tspintriple/.test(predicate) && clears > needed) continue;
        const fills = rows.map(row => board[row].some(tile => String(tile?.mino) === 'gbd') ? 0 : board[row].filter(Boolean).length).sort((a, b) => b - a).slice(0, needed);
        if (fills.length < needed) continue;
        slot = Math.max(slot, fills.reduce((sum, fill) => sum + fill, 0) * 20 + (corners >= 3 ? 150 : 0) - y * 5);
      }
    }
    score += slot;
  }
  if (predicate === 'top3rows') {
    const surface = Array.from({ length: width }, (_, x) => board.reduce((height, row, y) => row[x] ? y + 1 : height, 0));
    const top = Math.max(...surface), target = side.engine.board.height - 2;
    const banks = [0, width - 4].map(well => {
      const wall = surface.filter((_, x) => x < well || x >= well + 4), channel = surface.slice(well, well + 4);
      const low = Math.min(...wall), fill = wall.reduce((sum, height) => sum + Math.min(target, height), 0);
      return Math.min(target, low) * 55 + fill * 3 - channel.reduce((sum, height) => sum + height, 0) * 5 - Math.max(0, top - low - 3) ** 2 * 25;
    });
    score += Math.min(top, target) * 8 + Math.max(...banks);
  }
  return score;
}
export function trialQpOperation(checkpoint: QpCheckpoint, sideIndex: number, candidate: QpOperation, work?: Work, boundary?: QueueBoundary) {
  if (work?.expired()) return null;
  if (work) work.nodes++;
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
    if (work) work.frames++;
    if (runtime.over || side.life !== 'alive') return null;
    if (side.engine.stats.pieces > initial && age < candidate.duration - 2) return null;
  }
  } catch (error) { if (error === unknown) return null; throw error; }
  const task = side.task ?? runtime.completed.find(entry => entry.side === sideIndex && entry.frame >= start)?.tasks ?? originalTask;
  const target = runtime.events.filter(event => event.type === 'lock' && event.side === sideIndex).map(event => (event.data as { cells: [number, number][] }).cells);
  const progress = taskProgress(task), complete = !!task && task.active === task.prompts.length;
  const score = progress + taskBoardScore(side) + taskPreparation(side) + (task ? 0 : side.engine.stats.lines * 7 + side.engine.stats.garbage.attack * 2) - (runtime.frame - checkpoint.frame) * .02;
  return { state: runtime.checkpoint(), target, progress, complete, score, consumed };
}
export function searchRevive(checkpoint: QpCheckpoint, sideIndex: number, budget: ReviveBudget): ReviveSearch {
  const start = performance.now(), saved = copyQpCheckpoint(checkpoint), initialTask = saved.sides[sideIndex]?.state.task;
  const result: ReviveSearch = { status: 'BudgetExhausted', routes: [], nodes: 0, frames: 0, depth: 0, elapsedMs: 0, limits: [], information: budget.information };
  if (!saved.sides[sideIndex] || saved.over || saved.sides[sideIndex].state.life !== 'alive') return { ...result, status: 'Unsupported', limits: ['The rescuer is not alive.'] };
  saved.settings.quickplay.trigger = 'none';
  if (saved.settings.quickplay.pressure.mode === 'generated' && !budget.localPressure) { saved.settings.quickplay.pressure.mode = 'none'; result.limits.push('Unannounced opponent attacks are unknown; queued garbage is simulated.'); }
  const work: Work = { nodes: 0, frames: 0, limit: budget.nodes, deadline: start + budget.milliseconds, expired() { return this.nodes >= this.limit || performance.now() >= this.deadline; } };
  const predicate = initialTask?.prompts[initialTask.active]?.predicate ?? '';
  const combo = predicate === 'combo' || predicate === 'combonohold' || predicate === 'quadcombo' || predicate === 'szsingle';
  if (combo || predicate === 'colorclear' || hasReviveConstruction(predicate)) {
    const construction = ['tspinsingle', 'tspindouble', 'tspintriple', 'szdouble', 'szspin', 'ljspin', 'szljspin', 'szgarbage', 'ljgarbage', 'szspintriple', 'ljspintriple', 'upperhalfquad', 'iflat', 'ispinclear', 'ispindouble'].includes(predicate);
    const proposed = combo ? qpComboProposals(saved, sideIndex, budget) : predicate === 'colorclear' ? qpPcProposals(saved, sideIndex, budget) : reviveConstructionProposals(saved, sideIndex, { ...budget, milliseconds: budget.milliseconds * (construction ? .75 : .4), nodes: Math.floor(budget.nodes * (construction ? .85 : .4)) }); work.nodes += proposed.nodes;
    result.limits.push(...proposed.limits, 'Geometry proposes candidates; each input sequence is rechecked with live QP physics.');
    const preparation: ReviveRoute[] = [];
    for (const candidates of proposed.routes) {
      let state = saved, consumed = 0, valid = true; const targets: [number, number][][] = [], operations: QpOperation[] = [];
      let setup: ReviveRoute | null = null;
      for (const candidate of candidates) {
        const trial = trialQpOperation(state, sideIndex, budget.fastInputs ? pacedBotOperation(candidate, state.frame, state.sides[sideIndex].state.nextPlan) : candidate, work);
        if (!trial || !trial.target[0] || !(budget.localPressure ? verticallyShiftedQpTarget(candidate.target ?? [], trial.target[0]) : JSON.stringify([...trial.target[0]].sort()) === JSON.stringify([...(candidate.target ?? [])].sort()))) { valid = false; break; }
        state = trial.state; consumed += trial.consumed; targets.push(...trial.target); operations.push({ ...candidate, target: trial.target[0] });
        if (combo && budget.allowPreparation && (predicate === 'szsingle' ? initialTask!.prompts[initialTask!.active].count === 0 : saved.sides[sideIndex].engine.snapshot.stats.combo < 0) && state.sides[sideIndex].engine.snapshot.stats.lines === saved.sides[sideIndex].engine.snapshot.stats.lines && state.sides[sideIndex].state.task!.resets <= initialTask!.resets) setup = { operations: [...operations], targets: [...targets], state, consumed, progress: trial.progress, score: trial.score, complete: false };
        if (state.sides[sideIndex].state.task!.active > initialTask!.active) break;
      }
      const task = state.sides[sideIndex].state.task;
      if (valid && taskProgress(task) > taskProgress(initialTask) && (!combo || task!.active > initialTask!.active && task!.resets <= initialTask!.resets)) result.routes.push({ operations, targets, state, consumed, score: taskProgress(task), progress: taskProgress(task), complete: !!task && task.active === task.prompts.length });
      else if (setup) preparation.push(setup);
    }
    if (!result.routes.length && preparation.length) result.routes.push(...preparation);
    result.routes.sort((a, b) => compareReviveRoutes(a, b, budget.objective === 'effort'));
    for (const route of result.routes) {
      if (route.complete || work.expired() || route.operations.length >= budget.depth || combo && route.state.sides[sideIndex].state.task!.active === initialTask!.active) continue;
      const remaining = Math.max(1, (work.deadline - performance.now()) / result.routes.length);
      const tail = searchRevive(route.state, sideIndex, { ...budget, nodes: Math.max(1, work.limit - work.nodes), milliseconds: remaining, depth: budget.depth - route.operations.length });
      work.nodes += tail.nodes; work.frames += tail.frames;
      const next = tail.routes[0]; if (!next) continue;
      route.operations.push(...next.operations); route.targets.push(...next.targets); route.state = next.state; route.consumed += next.consumed; route.complete = next.complete; route.progress = next.progress; route.score = next.score;
    }
    result.routes.sort((a, b) => compareReviveRoutes(a, b, budget.objective === 'effort'));
    result.status = result.routes.some(route => route.complete) ? 'Found' : 'BudgetExhausted';
    result.nodes = work.nodes; result.frames = work.frames; result.elapsedMs = performance.now() - start; result.depth = Math.max(0, ...result.routes.map(route => route.operations.length));
    if (result.routes.length || predicate === 'colorclear' || combo && !budget.allowPreparation) {
      if (combo && !result.routes.length) result.limits.push('No complete uninterrupted Combo route was verified within this budget.');
      return result;
    }
  }
  const visible = Math.min(saved.sides[sideIndex].engine.snapshot.queue.value.length, QuickPlayRuntime.fromCheckpoint(saved).sides[sideIndex].rules.nextCount);
  let beam: ReviveRoute[] = [{ operations: [], targets: [], state: saved, score: -Infinity, complete: false, progress: taskProgress(initialTask), consumed: 0 }];
  const roots = new Map<string, ReviveRoute>();
  for (let depth = 0; depth < budget.depth && !work.expired(); depth++) {
    const children: ReviveRoute[] = [];
    for (const parent of beam) {
      if (parent.complete || work.expired()) continue;
      const runtime = QuickPlayRuntime.fromCheckpoint(parent.state), side = runtime.sides[sideIndex];
      for (const candidate of qpOperations(side, work, budget.fastInputs).slice(0, depth === 0 ? 48 : 24)) {
        if (work.expired()) break;
        const boundary = budget.information === 'visible' ? { remaining: visible - parent.consumed, unknown: false } : undefined;
        const timed = budget.fastInputs ? pacedBotOperation(candidate, parent.state.frame, side.nextPlan) : candidate;
        const trial = trialQpOperation(parent.state, sideIndex, timed, work, boundary);
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
function fallbackQpBot(runtime: QuickPlayRuntime, sideIndex: number, nodes: number): BotPlan {
  const side = runtime.sides[sideIndex], state = runtime.checkpoint();
  let best: { operation: QpOperation; score: number; progress: number; consumed: number } | null = null, checked = 0;
  for (const hold of [false, true]) for (const rotation of [[], ['rotateCW'], ['rotateCCW'], side.rules.allow180 ? ['rotate180'] : ['rotateCW', 'rotateCW']] as Move[][]) for (const shift of [[], ['dasLeft'], ['dasRight']] as Move[][]) {
    if (checked >= nodes || hold && (!side.rules.hold || side.engine.holdLocked)) continue;
    const candidate = operation([...rotation, ...shift], side.engine, hold, 'Prepare the task or clear space while a longer route remains unverified', true);
    const trial = trialQpOperation(state, sideIndex, pacedBotOperation(candidate, state.frame, side.nextPlan)); checked++;
    if (trial?.target[0] && (!best || trial.score > best.score)) best = { operation: { ...candidate, target: trial.target[0] }, score: trial.score, progress: trial.progress, consumed: trial.consumed };
  }
  return { actions: best?.operation.actions ?? [], duration: best?.operation.duration ?? 30, cursor: 0, age: 0, target: best?.operation.target ?? null, nodes: checked, knownPieces: best?.consumed ?? 0, taskActive: side.task?.active, progress: best?.progress ?? taskProgress(side.task), reason: best ? `Budget fallback. ${best.operation.label}.` : 'No executable recovery placement found in this budget.' };
}
export function recoverQpBot(runtime: QuickPlayRuntime, sideIndex = 1): BotPlan | null {
  const side = runtime.sides[sideIndex], state = runtime.checkpoint(), start = performance.now();
  const work: Work = { nodes: 0, frames: 0, limit: Math.min(1000, runtime.settings.quickplay.bot.nodes), deadline: start + 12, expired() { return this.nodes >= this.limit || performance.now() >= this.deadline; } };
  const candidates = qpOperations({ ...side, task: null }, work, true).slice(0, 4); work.deadline = start + 30;
  let best: { candidate: QpOperation; trial: NonNullable<ReturnType<typeof trialQpOperation>>; score: number } | null = null;
  for (const candidate of candidates) {
    const trial = trialQpOperation(state, sideIndex, pacedBotOperation(candidate, state.frame, side.nextPlan), work);
    if (!trial?.target[0]) continue;
    const after = trial.state.sides[sideIndex].engine.snapshot, score = trial.progress * .01 + boardScore(after.board) + (after.stats.lines - side.engine.stats.lines) * 14;
    if (!best || score > best.score) best = { candidate, trial, score };
  }
  return best ? { actions: best.candidate.actions, duration: best.candidate.duration, target: best.trial.target[0], age: 0, cursor: 0, nodes: work.nodes, taskActive: side.task?.active, progress: best.trial.progress, knownPieces: best.trial.consumed, reason: 'Recover space while the task search is pending.' } : null;
}
export function immediateQpBot(runtime: QuickPlayRuntime, sideIndex = 1): BotPlan | null {
  const side = runtime.sides[sideIndex], task = side.task, prompt = task?.prompts[task.active];
  if (!task || !prompt || side.life !== 'alive') return null;
  const start = performance.now(), state = runtime.checkpoint();
  const work: Work = { nodes: 0, frames: 0, limit: Math.min(2500, runtime.settings.quickplay.bot.nodes), deadline: start + 20, expired() { return this.nodes >= this.limit || performance.now() >= this.deadline; } };
  const candidates = qpOperations(side, work, true, true).slice(0, 5); work.deadline = start + 35;
  const chained = /consecutive|^szsingle$|^combo|^quadcombo$|^spinclear$/.test(prompt.predicate);
  for (const candidate of candidates) {
    const trial = trialQpOperation(state, sideIndex, pacedBotOperation(candidate, state.frame, side.nextPlan), work);
    if (!trial || trial.progress <= taskProgress(task) || chained && trial.state.sides[sideIndex].state.task?.active === task.active) continue;
    return { actions: candidate.actions, duration: candidate.duration, target: trial.target[0] ?? null, age: 0, cursor: 0, nodes: work.nodes, taskActive: task.active, progress: trial.progress, knownPieces: trial.consumed, reason: `Immediate task progress. ${candidate.label}` };
  }
  return null;
}
export function qpBotNeedsRecovery(runtime: QuickPlayRuntime, sideIndex = 1) {
  const side = runtime.sides[sideIndex], height = side.engine.board.state.reduce((peak, row, y) => row.some(Boolean) ? y + 1 : peak, 0);
  const incoming = side.garbage.entering.length + side.garbage.pending.filter(packet => packet.ready <= runtime.frame + 45).reduce((sum, packet) => sum + packet.amount, 0);
  const predicate = side.task?.prompts[side.task.active]?.predicate;
  return predicate !== 'idle' && height + incoming >= side.engine.board.height - (['top3rows', 'upperhalfquad'].includes(predicate ?? '') ? 0 : 4) && runtime.frame - (side.lockFrames.at(-1) ?? 0) >= Math.max(6, Math.ceil(60 / runtime.settings.quickplay.bot.pps));
}
export function planQpBot(runtime: QuickPlayRuntime, sideIndex = 1, milliseconds = 1000): BotPlan {
  const side = runtime.sides[sideIndex], task = side.task, cap = runtime.settings.quickplay.bot.nodes;
  if (task?.finishedAt !== null && task?.finishedAt !== undefined) return recoverQpBot(runtime, sideIndex) ?? { actions: [], duration: 6, cursor: 0, age: 0, target: null, nodes: 0, knownPieces: 0, taskActive: task.active, reason: 'Revive tasks complete.' };
  if (task && milliseconds >= 100) { const immediate = immediateQpBot(runtime, sideIndex); if (immediate) return immediate; }
  const combo = /^(?:combo(?:nohold)?|quadcombo|szsingle)$/.test(task?.prompts[task.active]?.predicate ?? ''), reserve = task ? Math.min(24, Math.floor(cap / 2)) : 0;
  if (task && cap <= 64) return fallbackQpBot(runtime, sideIndex, cap);
  const result = searchRevive(runtime.checkpoint(), sideIndex, { nodes: cap - reserve, depth: task ? combo ? 60 : 20 : 2, beam: task ? 3 : 4, milliseconds: Math.max(1, milliseconds - (task ? 15 : 0)), information: 'seeded', solutions: 1, fastInputs: true, allowPreparation: true, localPressure: true });
  const best = result.routes[0], operation = best?.operations[0];
  if (!operation && task) { const fallback = fallbackQpBot(runtime, sideIndex, reserve); fallback.nodes += result.nodes; return fallback; }
  const followups: BotStep[] = []; let state = runtime.checkpoint(), progress = 0;
  state.settings.quickplay.trigger = 'none';
  for (const [index, step] of (best?.operations ?? []).entries()) {
    const source = state.sides[sideIndex];
    if (index) followups.push({ ...step, target: step.target ?? null, taskActive: source.state.task?.active, expected: botStateKey(source.engine.snapshot, source.state.task) });
    const trial = trialQpOperation(state, sideIndex, pacedBotOperation(step, state.frame, source.state.nextPlan));
    if (!trial) break;
    if (index) followups.at(-1)!.progress = trial.progress; else progress = trial.progress;
    state = trial.state;
  }
  return { actions: operation?.actions ?? [], duration: operation?.duration ?? 0, cursor: 0, age: 0, target: operation?.target ?? null, nodes: result.nodes, knownPieces: best?.consumed ?? 0, taskActive: task?.active, followups, progress, reason: `${task ? 'Revive priority' : 'Stacking'} · full generated queue · ${result.depth}-step search · ${result.status}. ${operation?.label ?? 'No safe input plan found in this budget.'}` };
}
