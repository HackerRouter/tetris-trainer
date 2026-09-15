import type { EngineSnapshot } from '@haelp/teto/engine';
import { createEngine } from './engine';
import { applyQpEngineState, qpEngineState } from './qp-engine';
import { QuickPlayRuntime, type QpCheckpoint } from './qp-runtime';
import { boardScore, inputPlan, placementEvidence } from './qp-bot';
import { reachablePlacements } from './reachable-placements';
import { applySpinPath, enumerateSpinPlacements, type SpinPlacement } from './spin-movement';
import { reviveHold, revivePlacement } from './revive-tasks';
import type { QpOperation, ReviveBudget } from './qp-search';
import patterns from './revive-patterns.json' with { type: 'json' };

type ConstructionGoal = { piece: string; rows: string[]; fillRows?: number[]; lift?: boolean; spin?: boolean };
const ordinary = {
  szdouble: [{ piece: 's', rows: ['XXXX__XXXX', 'XXXXX__XXX'], fillRows: [0, 1], lift: true, spin: false }],
  ispinclear: [{ piece: 'i', rows: ['....X_....', 'XX____XXXX', '....X_....'], fillRows: [1], lift: true }],
  iflat: [{ piece: 'i', rows: ['XXX____XXX'], fillRows: [0], lift: true, spin: false }],
  tspinsingle: [{ piece: 't', rows: ['...X_X....', 'XXX___XXXX', '...X__....'], fillRows: [1], lift: true }],
  tspindouble: [{ piece: 't', rows: ['XXX_XXXXXX', 'XX___XXXXX', '_XX____XXX', '__X_____XX'] }],
  ljspin: [{ piece: 'l', rows: ['XX_XXXXXXX', '..___.....', '..X._X....'], fillRows: [0], lift: true }, { piece: 'l', rows: ['XXXXXX_XXX', '.....X___.', '..._____X.'], fillRows: [0], lift: true }, { piece: 'j', rows: ['...._.....', '.....X....', '....__....', 'XXX___XXXX', '...X__....'], fillRows: [3], lift: true }, { piece: 'j', rows: ['XXXX_XXXXX', 'XXXX_XXXXX', 'XXXX__XXXX', 'XXX___XXXX', 'XXXX__XXXX', 'XXXX__XXXX', 'XXXX__XXXX'] }]
};
export function hasReviveConstruction(predicate: string) { return ['upperhalfquad', 'szgarbage', 'ljgarbage'].includes(predicate) || predicate in ordinary || predicate in patterns && !['spinclear', 'combospin'].includes(predicate); }
function regionFits(board: EngineSnapshot['board'], rows: string[]) {
  const seen = new Set<number>();
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < 10; x++) {
    if (rows[y][x] !== 'X' || board[y][x] || seen.has(y * 10 + x)) continue;
    const pending = [[x, y]]; seen.add(y * 10 + x); let size = 0, open = false;
    for (const [x, y] of pending) {
      size++;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy, key = ny * 10 + nx;
        if (nx < 0 || nx >= 10 || ny < 0 || board[ny]?.[nx] || rows[ny]?.[nx] === '_') continue;
        if (ny >= rows.length || rows[ny][nx] === '.') { open = true; continue; }
        if (!seen.has(key)) { seen.add(key); pending.push([nx, ny]); }
      }
    }
    if (!open && size % 4) return false;
  }
  return true;
}
export function reviveConstructionProposals(checkpoint: QpCheckpoint, sideIndex: number, budget: ReviveBudget) {
  const runtime = QuickPlayRuntime.fromCheckpoint(checkpoint), side = runtime.sides[sideIndex], task = side.task!, predicate = task.prompts[task.active].predicate;
  let goals: ConstructionGoal[] | undefined = ordinary[predicate as keyof typeof ordinary] ?? patterns[predicate as keyof typeof patterns];
  const garbage = predicate === 'szgarbage' || predicate === 'ljgarbage';
  if (garbage) goals = predicate === 'szgarbage' ? patterns.szspin : ordinary.ljspin;
  if (predicate === 'upperhalfquad') {
    const board = side.engine.board.state;
    goals = Array.from({ length: side.engine.board.width }, (_, x) => {
      let bottom = board.length; while (bottom && !board[bottom - 1][x]) bottom--;
      return { bottom, rows: Array.from({ length: bottom + 4 }, (_, y) => y < bottom ? '.'.repeat(10) : Array.from({ length: 10 }, (_, col) => col === x ? '_' : 'X').join('')), piece: 'i' };
    }).filter(goal => goal.bottom > side.engine.board.height / 2 && goal.bottom + 4 <= side.engine.board.height).sort((a, b) => {
      const missing = (goal: typeof a) => goal.rows.reduce((sum, row, y) => sum + [...row].filter((cell, x) => cell === 'X' && !board[y][x]).length, 0);
      return missing(a) - missing(b) || a.bottom - b.bottom;
    });
  }
  const routes: QpOperation[][] = []; let nodes = 0;
  if (!goals?.length || side.engine.board.width !== 10 || budget.information !== 'seeded') return { routes, nodes, limits: [] as string[] };
  while (side.engine.queue.length < budget.depth + 1) side.engine.queue.repopulateOnce();
  const engine = createEngine(side.settings, checkpoint.seed, side.rules); applyQpEngineState(engine, qpEngineState(side.engine));
  const initial = engine.snapshot(); initial.frame = 0;
  const fourCells = [initial.falling.symbol, initial.hold, ...initial.queue.value].every(piece => !piece || piece.length === 1);
  const deadline = performance.now() + budget.milliseconds, stop = () => nodes >= budget.nodes || performance.now() >= deadline;
  const lock: { value?: { falling: EngineSnapshot['falling']; cells: [number, number][] } } = {};
  engine.events.on('falling.lock.pre', () => { lock.value = { falling: engine.falling.snapshot(), cells: engine.falling.absoluteBlocks }; });
  const operation = (moves: Parameters<typeof inputPlan>[0], hold: boolean, target: [number, number][]): QpOperation => {
    const actions = inputPlan(moves, engine, hold, budget.fastInputs);
    return { actions, duration: actions.at(-1)!.at + 1, target, label: `${hold ? 'Hold, then ' : ''}${moves.join(', ')}${moves.length ? ', ' : ''}Hard drop` };
  };
  let variants = goals.flatMap(goal => {
    const offsets = predicate !== 'upperhalfquad' && (predicate === 'szdouble' || goal.rows.some(row => row.includes('.'))) ? [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7] : [0];
    const fills = goal.fillRows ?? [0, 1, 2], peak = initial.board.reduce((top, row, y) => row.some(Boolean) ? y + 1 : top, 0);
    const bases = Array.from({ length: goal.lift ? Math.max(1, Math.min(peak, side.engine.board.height - goal.rows.length - 1) + 1) : 1 }, (_, y) => y);
    return offsets.filter(offset => goal.rows.every((row, y) => [...row].every((cell, x) => (fills.includes(y) ? cell !== '_' : cell !== 'X') || x + offset >= 0 && x + offset < 10))).flatMap(offset => bases.map(base => ({ ...goal, fillRows: fills.map(y => y + base), rows: [...Array(base).fill('.'.repeat(10)), ...goal.rows.map((row, y) => Array.from({ length: 10 }, (_, x) => row[x - offset] ?? (fills.includes(y) ? 'X' : '.')).join(''))] })));
  }).flatMap(goal => (predicate === 'upperhalfquad' ? [false] : [false, true]).map(mirror => ({ ...goal, rows: goal.rows.map(row => mirror ? [...row].reverse().join('') : row), piece: mirror ? ({ j: 'l', l: 'j', s: 'z', z: 's' } as Record<string, string>)[goal.piece] ?? goal.piece : goal.piece })));
  if (garbage) variants = variants.filter(goal => goal.fillRows.some(y => initial.board[y]?.some(tile => tile?.mino === 'gb')));
  if (goals.some(goal => goal.lift)) {
    const cost = (goal: ConstructionGoal) => goal.rows.reduce((sum, row, y) => sum + [...row].filter((cell, x) => cell === 'X' && !initial.board[y][x]).length * 4, 0) + goal.rows.length;
    variants = variants.filter(goal => goal.rows.every((row, y) => [...row].every((cell, x) => cell !== '_' || !initial.board[y][x])) && (!fourCells || regionFits(initial.board, goal.rows))).sort((a, b) => cost(a) - cost(b));
  }
  for (const goal of variants) {
    if (stop()) break;
    const rows = goal.rows, wanted = goal.piece;
    const allowed = (board: EngineSnapshot['board']) => rows.every((row, y) => [...row].every((cell, x) => cell !== '_' || !board[y][x]));
    if (!allowed(initial.board)) continue;
    const missing = (board: EngineSnapshot['board']) => rows.reduce((sum, row, y) => sum + [...row].filter((cell, x) => cell === 'X' && !board[y][x]).length, 0);
    if (rows.some(row => row.includes('.'))) {
      if (fourCells && !regionFits(initial.board, rows)) continue;
      type Node = { snapshot: EngineSnapshot; path: QpOperation[]; score: number };
      let beam: Node[] = [{ snapshot: initial, path: [], score: 0 }];
      for (let depth = 0; depth < budget.depth && beam.length && !stop(); depth++) {
        const children: Node[] = [];
        for (const node of beam) for (const hold of [false, true]) {
          if (stop() || hold && (!side.rules.hold || node.snapshot.holdLocked)) continue;
          engine.fromSnapshot(node.snapshot); if (hold && !engine.press('hold')) continue;
          const snapshot = engine.snapshot();
          if (!missing(snapshot.board) && snapshot.falling.symbol === wanted) {
            const reached = predicate === 'upperhalfquad' || goal.spin === false ? reachablePlacements(engine, snapshot, side.engine.board.height, count => count >= 1600 || stop()) : enumerateSpinPlacements(engine, snapshot, count => count >= 1600 || stop(), false); nodes += 'processed' in reached ? reached.processed : reached.states;
            for (const placement of reached.placements.filter(placement => !('evidence' in placement) || (placement as SpinPlacement).evidence.spin !== 'none')) {
              if (stop()) break;
              engine.fromSnapshot(snapshot); const next = structuredClone(task); if (hold) reviveHold(next);
              const result = applySpinPath(engine, placement.path).result, locked = lock.value; if (!locked) continue;
              const evidence = placementEvidence(engine, result, locked.falling, locked.cells, placement.path.moves, hold);
              evidence.centerX = locked.falling.location[0] + 1; revivePlacement(next, evidence);
              if (next.active > task.active || next.prompts[task.active].count > task.prompts[task.active].count) {
                routes.push([...node.path, operation(placement.path.moves, hold, placement.target)]);
                return { routes, nodes, limits: [] as string[] };
              }
            }
          }
          engine.fromSnapshot(snapshot);
          const reached = reachablePlacements(engine, snapshot, Math.min(side.rules.board.height, rows.length + 3), stop);
          for (const placement of reached.placements) {
            if (stop()) break; nodes++;
            engine.fromSnapshot(snapshot); const result = applySpinPath(engine, placement.path).result;
            if (result.topout || result.lines && (!garbage || !goal.fillRows.some(y => engine.board.state[y]?.some(tile => tile?.mino === 'gb'))) || !allowed(engine.board.state) || fourCells && !regionFits(engine.board.state, rows)) continue;
            const after = engine.snapshot();
            children.push({ snapshot: after, path: [...node.path, operation(placement.path.moves, hold, placement.target)], score: -missing(after.board) * 30 + boardScore(after.board) + Number(after.hold === wanted) * 10 });
          }
        }
        children.sort((a, b) => b.score - a.score); const unique = new Set<string>();
        beam = children.filter(node => {
          const key = JSON.stringify([node.snapshot.board, node.snapshot.falling.symbol, node.snapshot.hold, node.snapshot.queue]);
          if (unique.has(key)) return false; unique.add(key); return true;
        }).slice(0, 8);
      }
      continue;
    }
    const seen = new Set<string>(), minimum = Math.ceil(missing(initial.board) / 4), maximum = Math.min(budget.depth - 1, minimum + 6);
    let depth = minimum;
    const visit = (snapshot: EngineSnapshot, path: QpOperation[]): boolean => {
      if (stop()) return false; nodes++;
      const absent = missing(snapshot.board), key = JSON.stringify([snapshot.board.map(row => row.map(Boolean)), snapshot.falling.symbol, snapshot.hold, snapshot.holdLocked, snapshot.queue.value, depth - path.length]);
      if (seen.has(key)) return false; seen.add(key);
      if (absent === 0) {
        for (const hold of [false, true]) {
          if (stop() || hold && (!side.rules.hold || snapshot.holdLocked)) continue;
          engine.fromSnapshot(snapshot); if (hold && !engine.press('hold')) continue;
          if (engine.falling.symbol !== wanted) continue;
          const start = engine.snapshot(), found = goal.spin === false ? reachablePlacements(engine, start, side.engine.board.height, count => count >= 1600 || stop()) : enumerateSpinPlacements(engine, start, count => count >= 1600 || stop(), false); nodes += 'processed' in found ? found.processed : found.states;
          for (const placement of found.placements.filter(placement => !('evidence' in placement) || (placement as SpinPlacement).evidence.spin !== 'none')) {
            if (stop()) break;
            engine.fromSnapshot(start); const next = structuredClone(task); if (hold) reviveHold(next);
            const result = applySpinPath(engine, placement.path).result;
            const locked = lock.value; if (!locked) continue;
            const evidence = placementEvidence(engine, result, locked.falling, locked.cells, placement.path.moves, hold);
            evidence.centerX = locked.falling.location[0] + 1; revivePlacement(next, evidence);
            if (next.active > task.active || next.prompts[task.active].count > task.prompts[task.active].count) { routes.push([...path, operation(placement.path.moves, hold, placement.target)]); return true; }
          }
        }
      }
      if (path.length >= depth || absent > (depth - path.length) * 4) return false;
      const choices: { snapshot: EngineSnapshot; operation: QpOperation; score: number }[] = [];
      for (const hold of [false, true]) {
        if (stop() || hold && (!side.rules.hold || snapshot.holdLocked)) continue;
        engine.fromSnapshot(snapshot); if (hold && !engine.press('hold')) continue;
        const start = engine.snapshot(), reached = reachablePlacements(engine, start, Math.min(side.rules.board.height, rows.length + 3), stop);
        for (const placement of reached.placements) {
          if (stop()) break; nodes++;
          engine.fromSnapshot(start); const result = applySpinPath(engine, placement.path).result;
          if (result.topout || result.lines && (!garbage || !goal.fillRows.some(y => engine.board.state[y]?.some(tile => tile?.mino === 'gb'))) || !allowed(engine.board.state)) continue;
          const after = engine.snapshot(), left = missing(after.board), height = after.board.reduce((peak, row, y) => row.some(Boolean) ? y + 1 : peak, 0);
          choices.push({ snapshot: after, operation: operation(placement.path.moves, hold, placement.target), score: (absent - left) * 10 + Number(after.hold === wanted) * 8 - height });
        }
      }
      choices.sort((a, b) => b.score - a.score);
      for (const choice of choices) if (visit(choice.snapshot, [...path, choice.operation])) return true;
      return false;
    };
    let found = false;
    for (; depth <= maximum && !stop(); depth++) { if (visit(initial, [])) { found = true; break; } }
    if (found) break;
  }
  return { routes, nodes, limits: [] as string[] };
}
