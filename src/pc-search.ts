import type { EngineSnapshot, Mino } from '@haelp/teto/engine';
import { analysisEngine, pcCapabilities, type AnalysisRequest, type AnalysisResult } from './analysis';
import { applyContinuationPath, boardMask, type ContinuationRoute, type ContinuationStep } from './continuation-search';
import { reachablePlacements } from './reachable-placements';
import { sameCells } from './practice';
import { clearedRows } from './board-effects';
import { findFinesse } from './finesse';
import { spawnSnapshot } from './engine';
import { pcBoardFeasible, pcBoardAfter, pcBoardOrder } from './pc-board';

export function routeIdentity(route: ContinuationRoute) {
  const rows = route.steps[0].scene.snapshot.board.map((_, y) => y);
  let next = rows.length;
  const placements = route.steps.map(step => {
    const cells = step.scene.target.map(([x, y]) => `${x},${rows[y]}`).sort().join(';');
    for (const row of clearedRows(step.scene.snapshot.board, step.scene.target).reverse()) { rows.splice(row, 1); rows.push(next++); }
    return `${step.piece}:${cells}`;
  });
  return { allocation: [...placements].sort().join('|'), order: placements.join('|'), structure: route.steps.map(step => boardMask(step.after.board).join(',')).join('|') };
}
export function routeCost(route: ContinuationRoute) {
  return [route.steps.length, route.steps.filter(step => step.scene.path.drop === 'soft').length, route.steps.filter(step => step.scene.holdFirst).length, route.steps.reduce((sum, step) => sum + step.scene.path.cost, 0)];
}
export function rankRoutes(routes: ContinuationRoute[]) {
  const sorted = [...routes].sort((a, b) => { const ac = routeCost(a), bc = routeCost(b); for (let i = 0; i < ac.length; i++) if (ac[i] !== bc[i]) return ac[i] - bc[i]; return a.id.localeCompare(b.id); });
  return [...new Set(sorted.map(route => route.steps.length))].flatMap(length => {
    const allocations = new Set<string>(), primary: ContinuationRoute[] = [], alternatives: ContinuationRoute[] = [];
    for (const route of sorted.filter(route => route.steps.length === length)) { const key = routeIdentity(route).allocation; if (allocations.has(key)) alternatives.push(route); else { allocations.add(key); primary.push(route); } }
    return [...primary, ...alternatives];
  });
}
export function verifyPcRoute(request: AnalysisRequest, route: ContinuationRoute) {
  const alternatives = route.steps.at(-1)?.unknownCurrent ? ['i','j','l','o','s','t','z'] as const : [null];
  for (const alternative of alternatives) {
    const engine = analysisEngine(request); let locked: [number, number][] = [], lines = 0;
    engine.events.on('falling.lock.pre', () => { locked = engine.falling.absoluteBlocks; });
    for (const step of route.steps) {
      if (step.unknownCurrent && alternative) {
        if (step !== route.steps.at(-1) || !step.scene.holdFirst || !engine.held) return false;
        const snapshot = engine.snapshot({ isUndoRedo: true }); snapshot.falling = spawnSnapshot(engine, alternative as Mino); engine.fromSnapshot(snapshot);
      }
      if (step.scene.holdFirst && !engine.press('hold')) return false;
      const result = applyContinuationPath(engine, step.scene.path); lines += result.lines;
      if (!sameCells(locked, step.scene.target) || result.mino !== step.piece || result.lines !== step.lines || result.spin !== step.spin || JSON.stringify(boardMask(engine.board.state)) !== JSON.stringify(boardMask(step.after.board))) return false;
    }
    if ((request.goal.lines ? lines !== request.goal.lines : lines <= 0) || route.steps.length > request.depth || engine.board.state.some(row => row.some(Boolean))) return false;
  }
  return true;
}
function refineRoute(request: AnalysisRequest, route: ContinuationRoute) {
  const engine = analysisEngine(request);
  for (const step of route.steps) {
    const snapshot = engine.snapshot({ isUndoRedo: true });
    if (step.scene.holdFirst && !engine.press('hold')) return false;
    const before = engine.snapshot({ isUndoRedo: true }), path = findFinesse(engine, before, step.scene.target);
    if (!path) return false;
    const outcome = applyContinuationPath(engine, path);
    step.scene = { ...step.scene, snapshot, guideSnapshot: step.scene.holdFirst ? before : undefined, path };
    step.after = engine.snapshot({ isUndoRedo: true }); step.lines = outcome.lines; step.spin = outcome.spin;
  }
  route.spins = route.steps.filter(step => step.piece === 't' && step.spin !== 'none' && step.lines).length;
  return verifyPcRoute(request, route);
}
export function searchPc(request: AnalysisRequest, progress?: (result: AnalysisResult) => void): AnalysisResult {
  const started = performance.now(), reasons = pcCapabilities(request);
  const result: AnalysisResult = { sessionId: request.sessionId, revision: request.revision, fingerprint: request.fingerprint, solver: request.solver, status: reasons.length ? 'Unsupported' : 'Incomplete', routes: [], complete: false, reasons, checked: 0, elapsedMs: 0, verification: 'engine-rules', timing: 'frozen', queue: request.position.currentKnown ? [request.position.falling.symbol, ...request.position.next] : [], information: request.information, depth: request.depth, lines: request.goal.lines };
  if (reasons.length) return result;
  const engine = analysisEngine(request), initial = engine.snapshot({ isUndoRedo: true });
  const blocks = initial.board.flat().filter(Boolean).length;
  const targets = request.goal.lines ? [request.goal.lines] : Array.from({ length: request.depth }, (_, i) => (blocks + (i + 1) * 4) / request.rules.board.width).filter(Number.isInteger);
  let required = 0, goalLines = 0;
  const deadline = started + request.budget.milliseconds, failed = new Set<string>(), identities = new Set<string>();
  const placements = new Map<string, ReturnType<typeof reachablePlacements>>(), limits = new Set<string>();
  let limited = false, incomplete = false, targetDeadline = deadline, lastProgress = started, locked: [number, number][] = [];
  engine.events.on('falling.lock.pre', () => { locked = engine.falling.absoluteBlocks; });
  const stop = () => {
    if (performance.now() >= targetDeadline) { limits.add(targetDeadline < deadline ? 'goal-time' : 'time'); return true; }
    if (result.checked >= request.budget.nodes) { limits.add('nodes'); return true; }
    if (result.routes.length >= request.budget.candidates) { limits.add('candidates'); return true; }
    return false;
  };
  const emit = () => { result.elapsedMs = performance.now() - started; result.routes = rankRoutes(result.routes); if (result.routes.length) result.status = 'Solved'; progress?.(structuredClone(result)); lastProgress = performance.now(); };
  const visit = (snapshot: EngineSnapshot, steps: ContinuationStep[], drawn: number, lines: number): boolean => {
    if (stop()) { limited = true; return false; }
    if (steps.length >= required || drawn > result.queue.length || (drawn === result.queue.length && (!snapshot.hold || required - steps.length !== 1))) return false;
    const height = goalLines - lines;
    const rows = boardMask(snapshot.board);
    if (!pcBoardFeasible(rows, request.rules.board.width, height)) return false;
    const key = `${required - steps.length}:${rows}:${snapshot.falling.symbol}:${snapshot.falling.location}:${snapshot.falling.rotation}:${snapshot.hold}:${snapshot.holdLocked}:${drawn}`;
    if (failed.has(key)) return false;
    let found = false;
    const branches: (ReturnType<typeof reachablePlacements>['placements'][number] & { before: EngineSnapshot; holdFirst: boolean; emptyHold: boolean; order: number })[] = [];
    for (const holdFirst of [false, true]) {
      if (drawn === result.queue.length && !holdFirst) continue;
      engine.fromSnapshot(snapshot); const emptyHold = !snapshot.hold;
      if (holdFirst && (!request.rules.hold || snapshot.holdLocked || (emptyHold && drawn + 1 >= result.queue.length) || !engine.press('hold'))) continue;
      const before = engine.snapshot({ isUndoRedo: true });
      const falling = before.falling, placementKey = `${height}:${rows}:${falling.symbol}:${falling.location}:${falling.rotation}:${falling.aox}:${falling.aoy}`;
      const reached = placements.get(placementKey) ?? reachablePlacements(engine, before, height, stop);
      if (reached.complete) {
        if (placements.size >= 2048) placements.delete(placements.keys().next().value!);
        placements.set(placementKey, reached);
      }
      if (!reached.complete) limited = true;
      for (const placement of reached.placements) {
        const after = pcBoardAfter(rows, placement.target, request.rules.board.width, height);
        if (pcBoardFeasible(after.rows, request.rules.board.width, height - after.lines)) branches.push({ ...placement, before, holdFirst, emptyHold, order: pcBoardOrder(after.rows, request.rules.board.width) });
      }
    }
    branches.sort((a, b) => a.order - b.order || Number(a.holdFirst) - Number(b.holdFirst));
    for (const { target, path, before, holdFirst, emptyHold } of branches) {
        if (stop()) { limited = true; break; }
        result.checked++; engine.fromSnapshot(before);
        const outcome = applyContinuationPath(engine, path), after = engine.snapshot({ isUndoRedo: true });
        if (!sameCells(locked, target)) { limited = true; limits.add('verification'); continue; }
        const pc = outcome.lines > 0 && !after.board.some(row => row.some(Boolean));
        const step: ContinuationStep = { scene: { id: `pc-step-${steps.length}-${result.checked}`, snapshot, guideSnapshot: holdFirst ? before : undefined, holdFirst, target, path }, after, lines: outcome.lines, spin: outcome.spin, piece: outcome.mino, pc, unknownCurrent: drawn === result.queue.length };
        const nextSteps = [...steps, step];
        if (pc && lines + outcome.lines === goalLines && nextSteps.length === required) {
          const route: ContinuationRoute = { id: '', steps: structuredClone(nextSteps), spins: nextSteps.filter(item => item.piece === 't' && item.spin !== 'none' && item.lines).length, lines: lines + outcome.lines, pc: true };
          route.id = routeIdentity(route).order;
          if (!identities.has(route.id)) {
            if (refineRoute(request, route)) { identities.add(route.id); result.routes.push(route); emit(); }
            else { limited = true; limits.add('verification'); }
          }
          found = true;
        } else if (!pc && !engine.toppedOut) found = visit(after, nextSteps, drawn + 1 + Number(holdFirst && emptyHold), lines + outcome.lines) || found;
        if (performance.now() - lastProgress > 200) emit();
    }
    if (!found && !limited && failed.size < 100000) failed.add(key);
    return found;
  };
  for (goalLines of targets) {
    limited = false;
    targetDeadline = goalLines === targets.at(-1) ? deadline : performance.now() + Math.min(500, Math.max(0, deadline - performance.now()) / 4);
    required = (goalLines * request.rules.board.width - blocks) / 4;
    if (Number.isInteger(required) && required > 0 && required <= request.depth && required <= result.queue.length + Number(!!initial.hold && request.rules.hold)) visit(initial, [], 0, 0);
    incomplete ||= limited;
    if (performance.now() >= deadline || result.checked >= request.budget.nodes || result.routes.length >= request.budget.candidates) { stop(); incomplete = true; break; }
  }
  result.complete = !incomplete;
  result.status = result.routes.length ? 'Solved' : incomplete ? 'Incomplete' : 'No solution within scope';
  const descriptions: Record<string, string> = {
    time: `Search timed out at ${(request.budget.milliseconds / 1000).toFixed(1)} seconds. Other routes may exist.`,
    'goal-time': 'A shorter goal reached its time slice; larger PC goals were also searched.',
    nodes: 'The placement budget was reached. Other routes may exist.',
    candidates: 'The retained-candidate limit was reached. Other routes may exist.',
    verification: 'An unverified candidate was discarded; search completeness is not established.'
  };
  result.reasons = incomplete ? [...limits].map(limit => descriptions[limit]) : ['Exhausted the placement horizon using known pieces and legal Hold.'];
  result.routes = rankRoutes(result.routes); result.elapsedMs = performance.now() - started;
  return result;
}
