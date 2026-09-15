import { type EngineSnapshot, type Mino } from '@haelp/teto/engine';
import { analysisEngine, analysisRequest, stableKey, type AnalysisRequest, type AnalysisStatus } from './analysis';
import type { AnalysisContext } from './analysis-context';
import { type Cell } from './finesse';
import { enumerateSpinPlacements, applySpinPath, type SpinEvidence } from './spin-movement';
export { enumerateSpinPlacements, applySpinPath } from './spin-movement';
export type { SpinEvidence, SpinRotation } from './spin-movement';
import { boardMask, type ContinuationRoute, type ContinuationStep } from './continuation-search';
import { sameCells } from './practice';
import { spawnSnapshot } from './engine';
import { rotationSystems } from './modes';

export const spinVersion = 'spin-1.0.0';
export type SpinFilters = { piece: string; kind: 'scored' | 'normal' | 'mini' | 'geometric' | 'rotation'; lines: number; hold: 'either' | 'current' | 'hold'; kick: 'either' | 'yes' | 'no'; rotation: 'either' | '180' | '90'; softDrop: 'either' | 'yes' | 'no'; target?: Cell[] };
export const defaultSpinFilters: SpinFilters = { piece: 'any', kind: 'scored', lines: -1, hold: 'either', kick: 'either', rotation: 'either', softDrop: 'either' };
export type SpinRoute = ContinuationRoute & { evidence: SpinEvidence; terminalLines: number };
export type SpinRequest = { solver: string; base: AnalysisRequest; filters: SpinFilters; fingerprint: string };
export type SpinResult = { solver: string; sessionId: string; revision: number; fingerprint: string; status: AnalysisStatus; routes: SpinRoute[]; complete: boolean; checked: number; elapsedMs: number; reasons: string[]; depth: number; queue: string[]; pieces: string[] };
export function spinRequest(context: AnalysisContext, options: { sessionId?: string; revision?: number; depth?: number; milliseconds?: number; nodes?: number; candidates?: number; filters?: Partial<SpinFilters> } = {}): SpinRequest {
  const base = analysisRequest(context, { sessionId: options.sessionId ?? 'spin', revision: options.revision ?? 0, information: 'visible', depth: Math.max(0, Math.min(3, options.depth ?? 1)), milliseconds: options.milliseconds ?? 5000, nodes: options.nodes ?? 250000, candidates: options.candidates ?? 64 });
  const filters = { ...defaultSpinFilters, ...options.filters };
  return { solver: spinVersion, base, filters, fingerprint: stableKey({ solver: spinVersion, base: base.fingerprint, filters }) };
}

export function spinCapabilities(request: SpinRequest): string[] {
  const { rules, position } = request.base, reasons: string[] = [];
  if (request.solver !== spinVersion) reasons.push('Unsupported Spin analysis version.');
  if (!rotationSystems.includes(rules.advanced.kickSet)) reasons.push(`Spin Lab does not support ${rules.advanced.kickSet}.`);
  if (!rules.advanced.hardDrop) reasons.push('Spin Lab requires hard drop.');
  if (rules.hold && rules.infiniteHold) reasons.push('Spin Lab requires limited or disabled Hold.');
  if (rules.advanced.garbageInterval || rules.advanced.garbageRefill || position.pendingGarbage) reasons.push('Generated or pending garbage is not supported.');
  if (rules.advanced.bombs || position.board.some(row => row.some(tile => tile?.mino === 'bomb'))) reasons.push('Bombs are not supported.');
  if (position.board.length !== rules.board.height + rules.board.buffer || position.board.some(row => row.length !== rules.board.width)) reasons.push('Board dimensions do not match the rules.');
  if (position.board.some(row => row.every(Boolean))) reasons.push('Clear completed rows before analysis.');
  if (position.unavailable) reasons.push('Wait for a controllable active piece.');
  if (!['any','i','j','l','o','s','t','z'].includes(request.filters.piece) || !['scored','normal','mini','geometric','rotation'].includes(request.filters.kind) || !Number.isInteger(request.filters.lines) || request.filters.lines < -1 || request.filters.lines > 4 || !['either','current','hold'].includes(request.filters.hold) || !['either','yes','no'].includes(request.filters.kick) || !['either','180','90'].includes(request.filters.rotation) || !['either','yes','no'].includes(request.filters.softDrop)) reasons.push('Invalid Spin filters.');
  const target=request.filters.target;
  if(target!==undefined&&(!Array.isArray(target)||target.length!==4||target.some(cell=>!Array.isArray(cell)||cell.length!==2||!cell.every(Number.isInteger)||cell[0]<0||cell[0]>=rules.board.width||cell[1]<0||cell[1]>=position.board.length)||new Set(target.map(cell=>String(cell))).size!==4))reasons.push('Invalid rotation lesson target.');
  return reasons;
}

export function spinEngine(request: SpinRequest) {
  const engine = analysisEngine(request.base);
  engine.misc.movement.infinite = true;
  engine.dynamic.gravity.set(0);
  return engine;
}

export function matchesSpin(filters: SpinFilters, proof: SpinEvidence, piece: string, lines: number, hold: boolean, target?: Cell[]) {
  return piece !== 'o' && (filters.piece === 'any' || filters.piece === piece)
    && (filters.kind === 'rotation' ? proof.usedKick && proof.softDrop : filters.kind === 'geometric' ? proof.geometric : filters.kind === 'scored' ? proof.spin !== 'none' : proof.spin === filters.kind)
    && (!filters.target || !!target && sameCells(filters.target,target))
    && (filters.lines < 0 || filters.lines === lines)
    && (filters.hold === 'either' || (filters.hold === 'hold') === hold)
    && (filters.kick === 'either' || (filters.kick === 'yes') === !!proof.rotation?.kick.some(Boolean))
    && (filters.rotation === 'either' || (filters.rotation === '180') === proof.used180)
    && (filters.softDrop === 'either' || (filters.softDrop === 'yes') === proof.softDrop);
}

export function verifySpinRoute(request: SpinRequest, route: SpinRoute): boolean {
  const alternatives = route.steps.at(-1)?.unknownCurrent ? ['i','j','l','o','s','t','z'] as const : [null];
  for (const alternative of alternatives) {
    const engine = spinEngine(request); let locked: Cell[] = [];
    engine.events.on('falling.lock.pre', () => { locked = engine.falling.absoluteBlocks; });
    for (const [index, step] of route.steps.entries()) {
      if (step.unknownCurrent && alternative) { if (index !== route.steps.length - 1 || !step.scene.holdFirst || !engine.held) return false; const snapshot = engine.snapshot({ isUndoRedo: true }); snapshot.falling = spawnSnapshot(engine, alternative as Mino); engine.fromSnapshot(snapshot); }
      if (step.scene.holdFirst && !engine.press('hold')) return false;
      let replay; try { replay = applySpinPath(engine, step.scene.path); } catch { return false; }
      if (!sameCells(locked, step.scene.target) || replay.result.mino !== step.piece || replay.result.spin !== step.spin || replay.result.lines !== step.lines || String(boardMask(engine.board.state)) !== String(boardMask(step.after.board))) return false;
      if (index === route.steps.length - 1 && (!matchesSpin(request.filters, replay.evidence, step.piece, step.lines, !!step.scene.holdFirst,locked) || stableKey(replay.evidence) !== stableKey(route.evidence))) return false;
    }
  }
  return route.steps.length > 0 && route.steps.length <= request.base.depth;
}

export function searchSpins(request: SpinRequest, progress?: (result: SpinResult) => void): SpinResult {
  const started = performance.now(), { base, filters } = request, reasons = spinCapabilities(request);
  const result: SpinResult = { solver: request.solver, sessionId: base.sessionId, revision: base.revision, fingerprint: request.fingerprint, status: reasons.length ? 'Unsupported' : 'Incomplete', routes: [], complete: false, checked: 0, elapsedMs: 0, reasons, depth: base.depth, queue: base.position.currentKnown ? [base.position.falling.symbol, ...base.position.next] : [], pieces: [] };
  if (reasons.length) return result;
  const engine = spinEngine(request), initial = engine.snapshot({ isUndoRedo: true }), deadline = started + base.budget.milliseconds;
  const limits = new Set<string>(), cache = new Map<string, ReturnType<typeof enumerateSpinPlacements>>(), ids = new Set<string>();
  let lastProgress = started;
  const stop = () => { if (performance.now() >= deadline) limits.add('Time budget reached.'); if (result.checked >= base.budget.nodes) limits.add('State budget reached.'); return limits.size > 0; };
  const emit = () => { result.elapsedMs = performance.now() - started; result.status = result.routes.length ? 'Solved' : 'Incomplete'; progress?.(structuredClone(result)); lastProgress = performance.now(); };
  type SearchNode = { snapshot: EngineSnapshot; steps: ContinuationStep[]; drawn: number };
  let layer: SearchNode[] = [{ snapshot: initial, steps: [], drawn: 0 }], trimmed = false;
  for (let depth = 0; depth < base.depth && layer.length && !stop(); depth++) {
    const nextLayer: SearchNode[] = [], nextKeys = new Set<string>();
    for (const node of layer) {
      if (stop()) break;
      for (const holdFirst of [false, true]) {
        const { snapshot, drawn } = node, unknown = drawn >= result.queue.length, empty = !snapshot.hold;
        if (unknown && (!holdFirst || drawn > result.queue.length)) continue;
        engine.fromSnapshot(snapshot);
        if (holdFirst && (!base.rules.hold || snapshot.holdLocked || empty && drawn + 1 >= result.queue.length || !engine.press('hold'))) continue;
        if (engine.toppedOut) continue;
        const before = engine.snapshot({ isUndoRedo: true });
        if (depth === 0 && !result.pieces.includes(before.falling.symbol)) result.pieces.push(before.falling.symbol);
        const cacheKey = `${boardMask(before.board)}|${stableKey(before.falling)}|${before.lastSpin}`;
        const reached = cache.get(cacheKey) ?? enumerateSpinPlacements(engine, before, states => { if (result.checked + states >= base.budget.nodes) limits.add('State budget reached.'); return stop(); });
        if (!cache.has(cacheKey)) result.checked += reached.states;
        if (reached.complete && cache.size < 128) cache.set(cacheKey, reached);
        if (!reached.complete) limits.add('Movement enumeration was interrupted.');
        const setupKeys = new Set<string>();
        const placements = reached.placements.sort((a,b) => a.path.cost - b.path.cost);
        for (const placement of placements) {
          const spinPossible = (!filters.target || sameCells(filters.target,placement.target)) && (filters.kind === 'rotation' ? placement.evidence.usedKick && placement.evidence.softDrop : filters.kind === 'geometric' ? placement.evidence.geometric : placement.evidence.spin !== 'none');
          const setupKey = placement.target.map(cell => cell.join(',')).sort().join(';');
          const setup = depth + 1 < base.depth && !unknown && !setupKeys.has(setupKey);
          if (!spinPossible && !setup) continue;
          engine.fromSnapshot(before);
          let replay; try { replay = applySpinPath(engine, placement.path); } catch { limits.add('An unverified path was discarded.'); continue; }
          const after = engine.snapshot({ isUndoRedo: true }), outcome = replay.result;
          const step: ContinuationStep = { scene: { id: `spin-step-${depth}-${ids.size}`, snapshot, guideSnapshot: holdFirst ? before : undefined, holdFirst, target: placement.target, path: placement.path }, after, lines: outcome.lines, spin: outcome.spin, piece: outcome.mino, pc: outcome.lines > 0 && engine.board.perfectClear, unknownCurrent: unknown };
          if (matchesSpin(filters, replay.evidence, step.piece, step.lines, holdFirst,placement.target)) {
            const steps = [...node.steps, step], id = `${steps.map(item => `${item.piece}:${item.scene.holdFirst}:${item.scene.target.map(cell => cell.join(',')).sort().join(';')}`).join('|')}|${stableKey(replay.evidence)}`;
            if (!ids.has(id)) {
              const route: SpinRoute = { id, steps: structuredClone(steps), evidence: replay.evidence, terminalLines: step.lines, spins: steps.filter(item => item.spin !== 'none').length, lines: steps.reduce((sum,item) => sum + item.lines, 0), pc: step.pc };
              if (verifySpinRoute(request, route)) { ids.add(id); result.routes.push(route); }
              else limits.add('An unverified route was discarded.');
            }
          }
          if (setup && !engine.toppedOut) {
            setupKeys.add(setupKey);
            const key = `${boardMask(after.board)}|${after.falling.symbol}|${after.hold}|${after.holdLocked}|${drawn + 1 + Number(holdFirst && empty)}`;
            if (!nextKeys.has(key)) { nextKeys.add(key); nextLayer.push({ snapshot: after, steps: [...node.steps, step], drawn: drawn + 1 + Number(holdFirst && empty) }); }
          }
          if (result.routes.length >= base.budget.candidates && base.depth > 1) { trimmed = true; break; }
        }
        if (performance.now() - lastProgress > 200) emit();
        if (result.routes.length >= base.budget.candidates && base.depth > 1) break;
      }
      if (result.routes.length >= base.budget.candidates && base.depth > 1) break;
    }
    if (result.routes.length >= base.budget.candidates && base.depth > 1) break;
    if (nextLayer.length > 160) trimmed = true;
    layer = nextLayer.sort((a,b) => setupScore(a.snapshot) - setupScore(b.snapshot)).slice(0,160);
  }
  if (trimmed) limits.add('Setup or candidate budget reached; other routes may exist.');
  if (base.depth > 1) limits.add('Setup search merges equivalent boards and is bounded; it does not enumerate all setup histories.');
  result.complete = !limits.size;
  result.status = result.routes.length ? 'Solved' : result.complete ? 'No solution within scope' : 'Incomplete';
  result.reasons = limits.size ? [...limits] : ['All reachable endpoint and spin-history classes in the frozen movement model were checked.'];
  if (base.rules.advanced.spinBonuses === 'none') result.reasons.push('Spin scoring is disabled. Geometric insertion practice is available.');
  result.routes.sort((a,b) => a.steps.length - b.steps.length || b.terminalLines - a.terminalLines || a.steps.reduce((sum,step) => sum + step.scene.path.cost,0) - b.steps.reduce((sum,step) => sum + step.scene.path.cost,0));
  result.elapsedMs = performance.now() - started;
  return result;
}

function setupScore(snapshot: EngineSnapshot) {
  const rows = snapshot.board; let height = 0, holes = 0, wells = 0;
  for (let x = 0; x < rows[0].length; x++) { let covered = false; for (let y = rows.length - 1; y >= 0; y--) { if (rows[y][x]) { covered = true; height = Math.max(height, y + 1); } else if (covered) holes++; } }
  for (let y = 0; y < height; y++) for (let x = 1; x < rows[0].length - 1; x++) if (!rows[y][x] && rows[y][x-1] && rows[y][x+1]) wells++;
  return height * 2 + holes * 3 - wells * 5;
}
