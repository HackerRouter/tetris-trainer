import { legal, type EngineSnapshot, type Engine } from '@haelp/teto/engine';
import { createEngine } from './engine';
import { copyPiece, findFinesse, type Cell, type FinesseResult } from './finesse';
import type { AnalysisContext } from './analysis-context';
import type { PracticeScene } from './practice';

export type ContinuationGoal = 'pc' | 'tspin' | 'tsd' | 'two-tspins' | 'two-tsd';
export type ContinuationStep = { scene: PracticeScene; after: EngineSnapshot; lines: number; spin: string; piece: string; pc: boolean; unknownCurrent?: boolean };
export type ContinuationRoute = { id: string; name?: string; source?: string; stageId?: string; steps: ContinuationStep[]; spins: number; lines: number; pc: boolean; combo?: { clears: number; setup: number; attack: number; endCombo: number; choices: number[]; boundary: string } };
export type ContinuationRequest = { context: AnalysisContext; goal: ContinuationGoal; depth: number; seeded: boolean; budgetMs?: number; limit?: number };
export type ContinuationResult = { routes: ContinuationRoute[]; checked: number; elapsedMs: number; depth: number; queue: string[]; seeded: boolean; limited: boolean; message: string };
type Node = { snapshot: EngineSnapshot; steps: ContinuationStep[]; drawn: number; spins: number; lines: number; score: number };
const cellKey = (cells: Cell[]) => cells.map(cell => cell.join(',')).sort().join(';');
export const boardMask = (board: EngineSnapshot['board']) => board.map(row => row.reduce((mask, tile, x) => tile ? mask | (1 << x) : mask, 0));
const top = (rows: number[]) => { for (let y = rows.length - 1; y >= 0; y--) if (rows[y]) return y + 1; return 0; };

export function continuationStateKey(snapshot: EngineSnapshot, depth = 14) {
  return `${boardMask(snapshot.board).join(',')}|${snapshot.falling.symbol}|${snapshot.hold ?? '-'}|${snapshot.holdLocked}|${snapshot.queue.value.slice(0, depth).join('')}`;
}

export function applyContinuationPath(engine: Engine, path: FinesseResult) {
  for (const move of path.moves) {
    if (move === 'down' || move === 'softDrop') {
      if (move === 'down') engine.falling.y--; else engine.falling.softDrop(engine.board.state);
      if (engine.gameOptions.spinBonuses !== 'stupid') engine.lastSpin = null;
    } else engine.press(move);
  }
  return engine.hardDrop();
}

function boardScore(rows: number[], width: number) {
  const height = top(rows), heights = Array(width).fill(0);
  let holes = 0, roughness = 0, slots = 0;
  const occupied = (x: number, y: number) => x < 0 || x >= width || y < 0 || !!((rows[y] ?? 0) & (1 << x));
  for (let x = 0; x < width; x++) {
    for (let y = height - 1; y >= 0; y--) if (occupied(x, y)) { heights[x] = y + 1; break; }
    for (let y = 0; y < heights[x]; y++) if (!occupied(x, y)) holes++;
    if (x) roughness += Math.abs(heights[x] - heights[x - 1]);
  }
  for (let x = 1; x < width - 1; x++) for (let y = 0; y < height; y++) {
    if (occupied(x, y)) continue;
    const corners = Number(occupied(x - 1, y - 1)) + Number(occupied(x + 1, y - 1)) + Number(occupied(x - 1, y + 1)) + Number(occupied(x + 1, y + 1));
    if (corners < 3) continue;
    const arms = [[-1, 0], [0, 1], [1, 0], [0, -1]].map(([dx, dy]) => !occupied(x + dx, y + dy));
    if (arms.filter(Boolean).length >= 3) slots += 1 + Number((rows[y] | (7 << (x - 1))) === (1 << width) - 1);
  }
  return slots * 95 - holes * 20 - height * 5 - heights.reduce((a, b) => a + b, 0) - roughness * 1.8;
}

function fillable(rows: number[], width: number, height: number) {
  if (top(rows) > height) return false;
  const empty = new Set<number>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!(rows[y] & (1 << x))) empty.add(y * width + x);
  while (empty.size) {
    const todo = [empty.values().next().value!]; empty.delete(todo[0]); let size = 0;
    while (todo.length) {
      const cell = todo.pop()!, x = cell % width, y = Math.floor(cell / width); size++;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (nx >= 0 && nx < width && ny >= 0 && ny < height && empty.delete(ny * width + nx)) todo.push(ny * width + nx);
    }
    if (size % 4) return false;
  }
  return true;
}

export function searchContinuations(request: ContinuationRequest): ContinuationResult {
  const started = performance.now(), budget = Math.max(20, Math.min(15000, request.budgetMs ?? 5000)), deadline = started + budget;
  const { context, goal } = request, { rules, settings } = context;
  const depth = Math.max(1, Math.min(14, Math.floor(request.depth))), limit = Math.max(1, Math.min(6, request.limit ?? 4));
  const known = Math.min(context.snapshot.queue.value.length, request.seeded ? depth : rules.nextCount);
  const queue = [context.snapshot.falling.symbol, ...context.snapshot.queue.value.slice(0, known)];
  const output: ContinuationResult = { routes: [], checked: 0, elapsedMs: 0, depth, queue, seeded: request.seeded, limited: false, message: '' };
  const reject = (message: string) => ({ ...output, message, elapsedMs: performance.now() - started });
  if (!rules.advanced.hardDrop) return reject('Continuation plans currently require hard drop.');
  if (goal !== 'pc' && rules.advanced.spinBonuses === 'none') return reject('T-spin scoring is disabled in this mode. Select Perfect clear or enable spins in Custom rules.');
  if (rules.advanced.garbageRefill || rules.advanced.garbageInterval || context.snapshot.board.some(row => row.some(tile => tile?.mino === 'bomb'))) return reject('Continuation search currently supports stable boards without generated garbage or bombs.');
  if (context.snapshot.board.length !== rules.board.height + rules.board.buffer || context.snapshot.board.some(row => row.length !== rules.board.width)) return reject('The analysis board does not match the current mode.');
  const engine = createEngine(settings, 1, rules), width = rules.board.width;
  let lockedTarget: Cell[] = [];
  engine.events.on('falling.lock.pre', () => { lockedTarget = engine.falling.absoluteBlocks; });
  const initial = structuredClone(context.snapshot); initial.__meta.isUndoRedo = true;
  const root: Node = { snapshot: initial, steps: [], drawn: 0, spins: 0, lines: 0, score: 0 };
  const routeKeys = new Set<string>();
  const timedOut = () => performance.now() >= deadline || output.checked >= 35000;
  const goalSpins = goal === 'tspin' || goal === 'tsd' ? 1 : 2;
  const keep = (node: Node, pc: boolean) => {
    const key = node.steps.map(step => `${step.piece}:${cellKey(step.scene.target)}`).join('|');
    if (routeKeys.has(key)) return;
    routeKeys.add(key); output.routes.push({ id: key, steps: node.steps, spins: node.spins, lines: node.lines, pc });
  };
  const expand = (node: Node, maxHeight = rules.board.height, pcRemaining?: number): Node[] => {
    const nextNodes: Node[] = [];
    if (node.drawn >= queue.length) return nextNodes;
    for (const holdFirst of [false, true]) {
      if (timedOut()) { output.limited = true; break; }
      engine.fromSnapshot(node.snapshot);
      const emptyHold = !engine.held;
      if (holdFirst) {
        if (!rules.hold || engine.holdLocked || (emptyHold && node.drawn + 1 >= queue.length) || !engine.press('hold')) continue;
      }
      const snapshot = engine.snapshot({ isUndoRedo: true }), piece = copyPiece(engine, snapshot.falling), rows = boardMask(snapshot.board);
      if (!legal(piece.absoluteBlocks, snapshot.board)) continue;
      const candidates: { target: Cell[]; rank: number }[] = [], seen = new Set<string>();
      for (let rotation = 0; rotation < 4; rotation++) for (let x = -3; x < width; x++) for (let y = -2; y <= Math.min(maxHeight, top(rows) + 3) + 2; y++) {
        const target = piece.absoluteAt({ x, y, rotation });
        if (target.some(([tx, ty]) => tx < 0 || tx >= width || ty < 0 || ty >= maxHeight) || !legal(target, snapshot.board)) continue;
        const targetSet = new Set(target.map(cell => cell.join(',')));
        if (!target.some(([tx, ty]) => ty === 0 || (!targetSet.has(`${tx},${ty - 1}`) && snapshot.board[ty - 1][tx]))) continue;
        const key = cellKey(target); if (seen.has(key)) continue; seen.add(key);
        const after = [...rows]; for (const [tx, ty] of target) after[ty] |= 1 << tx;
        const lines = after.filter(row => row === (1 << width) - 1).length;
        const remaining = after.filter(row => row !== (1 << width) - 1);
        if (pcRemaining !== undefined && !fillable(remaining, width, maxHeight - lines)) continue;
        candidates.push({ target, rank: boardScore(remaining, width) + lines * (piece.symbol === 't' ? 100 : 12) });
      }
      candidates.sort((a, b) => b.rank - a.rank);
      for (const { target } of candidates) {
        if (timedOut()) { output.limited = true; break; }
        output.checked++; engine.fromSnapshot(snapshot);
        const path = findFinesse(engine, snapshot, target); if (!path) continue;
        const result = applyContinuationPath(engine, path);
        if (engine.toppedOut || cellKey(lockedTarget) !== cellKey(target)) continue;
        const after = engine.snapshot({ isUndoRedo: true });
        const pc = result.lines > 0 && !after.board.some(row => row.some(Boolean));
        const scoredSpin = result.mino === 't' && result.spin !== 'none' && (goal === 'two-tsd' || goal === 'tsd' ? result.spin === 'normal' && result.lines === 2 : result.lines >= 1);
        const scene: PracticeScene = { id: `continuation-${output.checked}`, snapshot: holdFirst ? node.snapshot : snapshot, guideSnapshot: holdFirst ? snapshot : undefined, holdFirst, target, path };
        const step: ContinuationStep = { scene, after, lines: result.lines, spin: result.spin, piece: result.mino, pc };
        const child: Node = { snapshot: after, steps: [...node.steps, step], drawn: node.drawn + 1 + Number(holdFirst && emptyHold), spins: node.spins + Number(scoredSpin), lines: node.lines + result.lines, score: 0 };
        child.score = child.spins * 3000 + child.steps.reduce((sum, item) => sum + (item.piece === 't' && item.spin !== 'none' ? item.lines * 200 + (item.spin === 'normal' ? 60 : 0) : 0), 0) + boardScore(boardMask(after.board), width) + child.lines * 10 - child.steps.reduce((sum, item) => sum + item.scene.path.cost, 0) * .2;
        nextNodes.push(child);
      }
    }
    return nextNodes.sort((a, b) => b.score - a.score);
  };
  if (goal === 'pc') {
    const blocks = initial.board.flat().filter(Boolean).length;
    const visit = (node: Node, remaining: number, height: number, failed: Set<string>): boolean => {
      if (timedOut() || output.routes.length >= limit) { output.limited = true; return false; }
      const signature = `${remaining}:${continuationStateKey(node.snapshot)}`;
      if (failed.has(signature)) return false;
      let found = false;
      for (const child of expand(node, height, remaining)) {
        const last = child.steps.at(-1)!;
        if (last.pc) { keep(child, true); found = true; }
        else if (remaining > 1) found = visit(child, remaining - 1, height - last.lines, failed) || found;
        if (output.routes.length >= limit || timedOut()) break;
      }
      if (!found && !timedOut()) failed.add(signature);
      return found;
    };
    for (let pieces = 1; pieces <= Math.min(depth, queue.length); pieces++) {
      if ((blocks + 4 * pieces) % width) continue;
      const height = (blocks + 4 * pieces) / width;
      if (height > rules.board.height || !fillable(boardMask(initial.board), width, height)) continue;
      visit(root, pieces, height, new Set());
      if (output.routes.length >= limit || timedOut()) break;
    }
  } else {
    let frontier = [root];
    for (let level = 0; level < depth && frontier.length && !timedOut(); level++) {
      const next: Node[] = [], seen = new Map<string, number>();
      for (const node of frontier) {
        for (const child of expand(node)) {
          if (child.spins >= goalSpins) keep(child, child.steps.at(-1)!.pc); else next.push(child);
          if (output.routes.length >= limit) break;
        }
        if (output.routes.length >= limit || timedOut()) break;
      }
      if (output.routes.length >= limit) break;
      next.sort((a, b) => b.score - a.score);
      frontier = [];
      for (const node of next) {
        const key = `${node.spins}:${continuationStateKey(node.snapshot)}`, count = seen.get(key) ?? 0;
        if (count >= 2) continue;
        seen.set(key, count + 1); frontier.push(node);
        if (frontier.length >= 24) { output.limited = true; break; }
      }
    }
  }
  output.elapsedMs = performance.now() - started; output.limited ||= timedOut() || output.routes.length >= limit;
  output.message = output.routes.length ? `${output.routes.length} valid continuation${output.routes.length === 1 ? '' : 's'} found. Other routes may also exist.` : 'No route found within this queue horizon and search budget. This does not prove the goal is impossible.';
  return output;
}
