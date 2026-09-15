import { decoder } from 'tetris-fumen';
import { legal, type EngineSnapshot } from '@haelp/teto/engine';
import profiles from './opener-followups.json';
import { createEngine } from './engine';
import { copyPiece, findFinesse, type Cell } from './finesse';
import { clearedRows } from './board-effects';
import { applyContinuationPath, continuationStateKey, spinContinuationPaths, continuationQueue, continuationGoalReached, maxContinuationDepth, searchContinuations, type ContinuationGoal, type ContinuationRequest, type ContinuationResult, type ContinuationRoute, type ContinuationStep } from './continuation-search';

export type FollowupOpener = { id: string; name: string; source: string; sourceFumen?: string; note?: string; finish?: { piece: string; lines: number } };
type Stage = { id: string; name: string; rows: string[]; goal: string; spinLines: number };
export type OpenerContinuationRequest = ContinuationRequest & { opener?: FollowupOpener; auto?: boolean };
const key = (cells: Cell[]) => cells.map(cell => cell.join(',')).sort().join(';');

export function automaticContinuationGoals(opener: FollowupOpener): ContinuationGoal[] {
  const description = `${opener.name} ${opener.note ?? ''}`;
  if (/\b(?:two|2)\s+(?:consecutive\s+)?(?:TSDs?\b|T[ -]?spin doubles?\b)|\bTSD\s*[x×]\s*2\b/i.test(description)) return ['two-tsd', 'tsd', 'tspin', 'pc'];
  if (/\bTSDs?\b|T[ -]?spin doubles?/i.test(description) || publishedStages(opener).some(stage => stage.spinLines === 2)) return /mountain|perfect|\bpc\b/i.test(opener.name) ? ['pc', 'tsd', 'tspin'] : ['tsd', 'tspin', 'pc'];
  if (/\b(?:two|2)\s+(?:consecutive\s+)?T[ -]?spins?\b/i.test(description)) return ['two-tspins', 'tspin', 'pc'];
  return /mountain|perfect|\bpc\b/i.test(opener.name) ? ['pc', 'tspin'] : ['tspin', 'pc'];
}

const doubles = (route: ContinuationRoute) => route.steps.filter(step => step.piece === 't' && step.spin === 'normal' && step.lines === 2).length;
export function rankDoubleContinuations(routes: ContinuationRoute[], required = 1) {
  return [...routes].sort((a, b) => Math.min(required, doubles(b)) - Math.min(required, doubles(a)) || a.steps.length - b.steps.length);
}

export function publishedStages(opener: FollowupOpener): Stage[] {
  const profile = profiles.find(profile => profile.id === opener.id || profile.name === opener.name);
  if (profile) return profile.stages;
  if (!opener.sourceFumen) return [];
  try {
    return decoder.decode(opener.sourceFumen).flatMap((page, index) => {
      if (page.operation || index === 0) return [];
      const rows = Array.from({ length: 23 }, (_, y) => Array.from({ length: 10 }, (_, x) => page.field.at(x, y)).join('').replaceAll('_', '.'));
      while (rows.at(-1) === '..........') rows.pop();
      const gray = rows.join('').includes('X'), colored = rows.join('').replace(/[.X]/g, '').length;
      if (!gray || !colored || colored > 56 || colored % 4) return [];
      const pc = rows.every(row => !row.includes('.'));
      return [{ id: `${opener.id}-reference-${index}`, name: `Reference continuation ${index}`, rows: rows.map(row => row.replace(/[IJLOSTZ]/g, '#')), goal: pc ? 'pc' : 'setup', spinLines: 0 }];
    });
  } catch { return []; }
}

export function searchOpenerContinuations(request: OpenerContinuationRequest): ContinuationResult {
  if (!request.opener) return searchContinuations(request);
  const started = performance.now(), budget = Math.max(20, Math.min(15000, request.budgetMs ?? 15000)), deadline = started + budget;
  const { context } = request, { rules, settings } = context;
  const depth = Math.max(1, Math.min(maxContinuationDepth, request.depth));
  const queue = continuationQueue(context, depth, request.seeded);
  const output: ContinuationResult = { routes: [], checked: 0, elapsedMs: 0, depth, queue, seeded: request.seeded, limited: false, message: '' };
  if (rules.board.width !== 10 || !rules.advanced.hardDrop || rules.advanced.garbageRefill || rules.advanced.garbageInterval || rules.advanced.bombs) return searchContinuations(request);
  const engine = createEngine(settings, 1, rules), initial = structuredClone(context.snapshot);
  initial.queue.value = queue.slice(1); initial._queue.value = queue.slice(1);
  let locked: Cell[] = []; engine.events.on('falling.lock.pre', () => { locked = engine.falling.absoluteBlocks; });
  const stages = publishedStages(request.opener), limit = Math.max(1, Math.min(6, request.limit ?? 4));
  const goals = request.auto ? automaticContinuationGoals(request.opener) : [request.goal];
  const preferDoubles = request.auto && ['tsd', 'two-tsd'].includes(goals[0]) && rules.advanced.spinBonuses !== 'none';
  const publishedDeadline = preferDoubles ? started + budget * .5 : deadline;
  const routes = new Set<string>();
  let matched = false;
  for (const stage of stages) for (const mirror of [false, true]) {
    if (performance.now() >= publishedDeadline || output.routes.length >= limit) break;
    const full: Cell[] = [], gray: Cell[] = [], special: Cell[] = [];
    stage.rows.forEach((row, y) => [...row].forEach((tile, x) => {
      const cell: Cell = [mirror ? 9 - x : x, y];
      if (tile !== '.') full.push(cell);
      if (tile === 'X') gray.push(cell);
      if (tile === 'T') special.push(cell);
    }));
    const occupied = new Set(initial.board.flatMap((row, y) => row.flatMap((tile, x) => tile ? [`${x},${y}`] : []))), mask = new Set(full.map(cell => cell.join(',')));
    if (!gray.every(cell => occupied.has(cell.join(','))) || [...occupied].some(cell => !mask.has(cell))) continue;
    const remaining = full.filter(cell => !occupied.has(cell.join(',')));
    if (!remaining.length || remaining.length % 4 || remaining.length / 4 > depth || remaining.length / 4 > queue.length) continue;
    if (stage.spinLines && rules.advanced.spinBonuses === 'none') continue;
    if (!request.auto && request.goal !== 'pc' && stage.goal === 'pc') continue;
    matched = true;
    const stageDeadline = Math.min(publishedDeadline, performance.now() + 1700), failed = new Set<string>();
    const solve = (snapshot: EngineSnapshot, cells: Cell[], forced: Cell[], steps: ContinuationStep[], drawn: number): boolean => {
      if (performance.now() >= stageDeadline) { output.limited = true; return false; }
      if (!cells.length) {
        const pc = !snapshot.board.some(row => row.some(Boolean));
        if (stage.goal === 'pc' && !pc) return false;
        if (stage.spinLines && !steps.some(step => step.piece === 't' && step.spin === 'normal' && step.lines === stage.spinLines)) return false;
        if (!request.auto && !continuationGoalReached(request.goal, steps, pc)) return false;
        const signature = steps.map(step => `${step.piece}:${key(step.scene.target)}`).join('|');
        if (!routes.has(signature)) {
          routes.add(signature);
          output.routes.push({ id: stage.id + '-' + output.routes.length, name: `${request.opener!.name} · ${stage.name}${mirror ? ' · Mirror' : ''}`, source: request.opener!.source, stageId: stage.id, steps, pc, spins: steps.filter(step => step.piece === 't' && step.spin !== 'none' && step.lines > 0).length, lines: steps.reduce((sum, step) => sum + step.lines, 0) });
        }
        return true;
      }
      if (drawn >= queue.length || steps.length >= depth) return false;
      const signature = `${continuationStateKey(snapshot)}:${key(cells)}`;
      if (failed.has(signature)) return false;
      const allowed = new Set(cells.map(cell => cell.join(','))), force = new Set(forced.map(cell => cell.join(','))), height = Math.max(...cells.map(([, y]) => y));
      for (const holdFirst of [false, true]) {
        engine.fromSnapshot(snapshot);
        if (holdFirst) {
          if (!rules.hold || snapshot.holdLocked || (!snapshot.hold && drawn + 1 >= queue.length)) continue;
          engine.hold();
        }
        const before = engine.snapshot({ isUndoRedo: true }), piece = copyPiece(engine, before.falling), candidates: Cell[][] = [], seen = new Set<string>();
        for (let rotation = 0; rotation < 4; rotation++) for (let y = 0; y <= height + 2; y++) for (let x = -3; x < 10; x++) {
          const target = piece.absoluteAt({ x, y, rotation }), targetKey = key(target);
          if (seen.has(targetKey) || !target.every(cell => allowed.has(cell.join(',')))) continue;
          if (forced.length && (piece.symbol === 't' ? targetKey !== key(forced) : target.some(cell => force.has(cell.join(','))))) continue;
          if (legal(target.map(([x, y]) => [x, y - 1]), before.board)) continue;
          seen.add(targetKey); candidates.push(target);
        }
        candidates.sort((a, b) => Math.max(...a.map(([, y]) => y)) - Math.max(...b.map(([, y]) => y)));
        let spinPaths: ReturnType<typeof spinContinuationPaths> | null = null;
        for (const target of candidates) {
          if (performance.now() >= stageDeadline) { output.limited = true; return false; }
          output.checked++; engine.fromSnapshot(before);
          let path = findFinesse(engine, before, target); if (!path) continue;
          const rows = clearedRows(before.board, target); let result = applyContinuationPath(engine, path);
          if (piece.symbol === 't' && stage.spinLines === rows.length && result.spin !== 'normal') {
            spinPaths ??= spinContinuationPaths(engine, before, stageDeadline);
            const alternate = spinPaths.get(key(target));
            if (alternate) { path = alternate; engine.fromSnapshot(before); result = applyContinuationPath(engine, path); }
          }
          if (engine.toppedOut || key(locked) !== key(target)) continue;
          if (forced.length && piece.symbol === 't' && (result.spin !== 'normal' || result.lines !== stage.spinLines)) continue;
          const after = engine.snapshot({ isUndoRedo: true }), used = new Set(target.map(cell => cell.join(',')));
          const shift = (list: Cell[]) => list.filter(cell => !used.has(cell.join(','))).map(([x, y]) => [x, y - rows.filter(row => row < y).length] as Cell);
          const step: ContinuationStep = { scene: { id: `published-${output.checked}`, snapshot, guideSnapshot: holdFirst ? before : undefined, holdFirst, target, path, spinGoal: result.spin !== 'none' ? { spin: result.spin, lines: result.lines } : undefined }, after, piece: result.mino, lines: result.lines, spin: result.spin, pc: !!result.lines && !after.board.some(row => row.some(Boolean)) };
          if (solve(after, shift(cells), shift(forced), [...steps, step], drawn + 1 + Number(holdFirst && !snapshot.hold))) return true;
        }
      }
      failed.add(signature); return false;
    };
    solve(initial, remaining, special.filter(cell => !occupied.has(cell.join(','))), [], 0);
  }
  if (preferDoubles) {
    for (const goal of goals.filter(goal => goal === 'tsd' || goal === 'two-tsd')) {
      const required = goal === 'two-tsd' ? 2 : 1;
      if (output.routes.some(route => doubles(route) >= required)) break;
      const remaining = deadline - performance.now(); if (remaining < 30) { output.limited = true; break; }
      const result = searchContinuations({ ...request, goal, budgetMs: remaining * (goal === 'two-tsd' ? .65 : .6), limit: 2 });
      output.routes.unshift(...result.routes.map(route => ({ ...route, id: `${goal}-${route.id}`, name: goal === 'two-tsd' ? 'Calculated two T-spin doubles' : 'Calculated T-spin double' })));
      output.checked += result.checked; output.limited ||= result.limited;
      if (result.routes.length) break;
    }
    output.routes = rankDoubleContinuations(output.routes, goals[0] === 'two-tsd' ? 2 : 1).slice(0, limit);
  }
  if (!output.routes.length && performance.now() < deadline) {
    const fallbackGoals = preferDoubles ? goals.filter(goal => !['two-tsd', 'tsd'].includes(goal)) : goals;
    for (const goal of fallbackGoals) {
      const remaining = deadline - performance.now(); if (remaining < 30) break;
      const fallback = searchContinuations({ ...request, goal, budgetMs: remaining / fallbackGoals.length, limit: 2 });
      output.routes.push(...fallback.routes.map(route => ({ ...route, id: `${goal}-${route.id}`, name: goal === 'pc' ? 'Calculated perfect clear' : 'Calculated T-spin continuation' })));
      output.checked += fallback.checked; output.limited ||= fallback.limited;
    }
  }
  output.elapsedMs = performance.now() - started;
  output.message = output.routes.length ? `${output.routes.length} playable continuation${output.routes.length === 1 ? '' : 's'}. Published stages continue searching after each milestone; PC depends on the following queue.` : `${matched ? 'No published branch could be completed with this queue within the search budget.' : 'No published stage matches this board and queue horizon.'} A published PC rate does not guarantee a PC for every queue or earlier placement. Full seeded lookahead is already enabled. Try another target goal or a different construction branch.`;
  return output;
}
