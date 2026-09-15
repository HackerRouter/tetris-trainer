import type { Mino } from '@haelp/teto/engine';
import { analysisEngine, pcCapabilities, stableKey, type AnalysisRequest } from './analysis';
import { searchPc } from './pc-search';
import { boardMask, type ContinuationRoute, type ContinuationStep } from './continuation-search';
import { reachablePlacements } from './reachable-placements';
import { searchCombo } from './combo-search';

export type BagModel = { remaining: string; refill: string };
export type QueueCase = { queue: string; weight: number };
export type CoverageOptions = { model: BagModel; draws: number; samples: number; seed: number; milliseconds: number; target?: number };
export type CoverageBound = { lower: number; upper: number; interval?: [number, number] };
export type PolicyNode = { observation: string; action: string; mass: number; children: PolicyNode[] };
export type CoverageResult = {
  fingerprint: string; mode: 'enumerated' | 'sampled'; total: number; processed: number; solved: number; failed: number; unknown: number;
  bound: CoverageBound; first: { action: string; bound: CoverageBound }[]; policy: { lower: number; nodes: PolicyNode[] } | null;
  elapsedMs: number; reasons: string[];
};
export function queueCases(model: BagModel, draws: number, samples = 64, seed = 1, limit = 120) {
  if (!/^[ijlostz]{0,14}$/i.test(model.remaining) || !/^[ijlostz]{1,14}$/i.test(model.refill) || !Number.isInteger(draws) || draws < 0 || draws > 24) throw new Error('Supply a remaining bag and a refill bag using 1–14 tetrominoes; choose up to 24 unknown draws.');
  const refill = model.refill.toLowerCase(), start = model.remaining.toLowerCase(), cases: QueueCase[] = [];
  const enumerate = (queue: string, bag: string, weight: number): void => {
    if (cases.length > limit) return;
    if (queue.length === draws) { cases.push({ queue, weight }); return; }
    if (!bag.length) bag = refill;
    for (const piece of new Set(bag)) enumerate(queue + piece, bag.replace(piece, ''), weight * [...bag].filter(p => p === piece).length / bag.length);
  };
  enumerate('', start, 1);
  if (cases.length <= limit) return { mode: 'enumerated' as const, cases };
  let state = seed >>> 0;
  const random = () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  const count = Math.max(1, Math.min(256, Math.floor(samples)));
  return { mode: 'sampled' as const, cases: Array.from({ length: count }, () => {
    let queue = '', bag = start;
    while (queue.length < draws) { if (!bag.length) bag = refill; const i = Math.floor(random() * bag.length); queue += bag[i]; bag = bag.slice(0, i) + bag.slice(i + 1); }
    return { queue, weight: 1 / count };
  }) };
}
export function wilson(successes: number, count: number): [number, number] {
  if (!count) return [0, 1];
  const p = successes / count, z2 = 1.959963984540054 ** 2, center = p + z2 / (2 * count), radius = Math.sqrt(z2 * (p * (1 - p) / count + z2 / (4 * count * count))), scale = 1 + z2 / count;
  return [Math.max(0, (center - radius) / scale), Math.min(1, (center + radius) / scale)];
}
export const firstAction = (step: ContinuationStep) => `${step.scene.holdFirst ? 'Hold ' : ''}${step.piece.toUpperCase()} ${step.scene.target.map(([x,y]) => `${x},${y}`).sort().join(';')}`;
type Witness = { id: number; weight: number; queue: string; route: ContinuationRoute; index: number; drawn: number };
export function witnessPolicy(witnesses: Witness[], nextCount: number, stop: () => boolean = () => false): { lower: number; nodes: PolicyNode[] } {
  if (stop()) return { lower: 0, nodes: [] };
  const groups = new Map<string, Witness[]>();
  for (const witness of witnesses) {
    const step = witness.route.steps[witness.index];
    if (!step) continue;
    const snapshot = step.scene.snapshot;
    const observation = `${boardMask(snapshot.board)}|${snapshot.falling.symbol}|${snapshot.hold}|${snapshot.holdLocked}|${witness.queue.slice(witness.drawn + 1, witness.drawn + 1 + nextCount)}`;
    groups.set(observation, [...groups.get(observation) ?? [], witness]);
  }
  let lower = 0; const nodes: PolicyNode[] = [];
  for (const [observation, group] of groups) {
    let best: PolicyNode | null = null;
    for (const action of new Set(group.map(w => firstAction(w.route.steps[w.index])))) {
      if (stop()) break;
      const chosen = group.filter(w => firstAction(w.route.steps[w.index]) === action), finished = new Map<number, number>(), remaining: Witness[] = [];
      for (const w of chosen) {
        const step = w.route.steps[w.index];
        if (w.index === w.route.steps.length - 1) finished.set(w.id, w.weight);
        else remaining.push({ ...w, index: w.index + 1, drawn: w.drawn + 1 + Number(step.scene.holdFirst && !step.scene.snapshot.hold) });
      }
      const child = witnessPolicy(remaining.filter(w => !finished.has(w.id)), nextCount, stop);
      const mass = [...finished.values()].reduce((sum, weight) => sum + weight, 0) + child.lower;
      if (!best || mass > best.mass) best = { observation, action, mass, children: child.nodes };
    }
    if (best) { lower += best.mass; nodes.push(best); }
  }
  return { lower, nodes };
}
export function searchCoverage(request: AnalysisRequest, options: CoverageOptions, progress?: (result: CoverageResult) => void): CoverageResult {
  const started = performance.now(), deadline = started + Math.max(1, Math.min(60000, options.milliseconds)), distribution = queueCases(options.model, options.draws, options.samples, options.seed);
  const result: CoverageResult = { fingerprint: request.fingerprint, mode: distribution.mode, total: distribution.cases.length, processed: 0, solved: 0, failed: 0, unknown: distribution.cases.length, bound: { lower: 0, upper: 1 }, first: [], policy: null, elapsedMs: 0, reasons: pcCapabilities(request) };
  if (result.reasons.length || !request.position.currentKnown) { result.reasons.push('Coverage requires a known active piece and supported rules.'); return result; }
  const statuses = distribution.cases.map(() => 'unknown'), successes = new Map<string, Set<number>>(), witnesses: Witness[] = [];
  const actions = new Set<string>(), engine = analysisEngine(request), initial = engine.snapshot({ isUndoRedo: true });
  for (const holdFirst of [false, true]) {
    engine.fromSnapshot(initial);
    if (holdFirst && (!request.rules.hold || initial.holdLocked || (!initial.hold && !request.position.next.length) || !engine.press('hold'))) continue;
    const snapshot = engine.snapshot({ isUndoRedo: true });
    for (const p of reachablePlacements(engine, snapshot, request.rules.board.height, () => performance.now() >= deadline).placements) actions.add(firstAction({ piece: snapshot.falling.symbol, scene: { holdFirst, target: p.target } } as ContinuationStep));
  }
  const bounds = (good: Set<number>, bad: Set<number>): CoverageBound => {
    const lower = distribution.cases.reduce((sum, c, i) => sum + (good.has(i) ? c.weight : 0), 0), upper = Math.max(lower, 1 - distribution.cases.reduce((sum, c, i) => sum + (bad.has(i) ? c.weight : 0), 0));
    return { lower: Math.min(1, lower), upper: Math.min(1, upper), ...(distribution.mode === 'sampled' ? { interval: [wilson(good.size, result.total)[0], wilson(result.total - bad.size, result.total)[1]] as [number, number] } : {}) };
  };
  const refresh = () => {
    const good = new Set(statuses.flatMap((s,i) => s === 'solved' ? [i] : [])), bad = new Set(statuses.flatMap((s,i) => s === 'failed' ? [i] : []));
    result.solved = good.size; result.failed = bad.size; result.unknown = result.total - good.size - bad.size; result.bound = bounds(good, bad);
    result.first = [...actions].map(action => ({ action, bound: bounds(successes.get(action) ?? new Set(), bad) })).sort((a,b) => b.bound.lower - a.bound.lower || a.action.localeCompare(b.action));
    result.elapsedMs = performance.now() - started; progress?.(structuredClone(result));
  };
  for (let i = 0; i < distribution.cases.length; i++) {
    if (performance.now() >= deadline) break;
    const item = distribution.cases[i], test = structuredClone(request);
    test.position.next.push(...[...item.queue] as Mino[]);
    test.budget = { milliseconds: Math.max(1, Math.min(750, deadline - performance.now())), nodes: 50000, candidates: 8 };
    test.fingerprint = stableKey({ base: request.fingerprint, future: item.queue });
    const target = Math.max(1, Math.min(request.depth, Math.floor(options.target ?? 3)));
    if (test.goal.kind === 'combo') { test.goal.objective='clears'; test.goal.cleanup=0; test.depth=target; }
    const outcome = test.goal.kind === 'combo' ? searchCombo(test) : searchPc(test); result.processed++;
    const routes = outcome.routes.filter(route=>test.goal.kind === 'pc' || (route.combo?.clears ?? 0) >= target);
    if (routes.length) statuses[i] = 'solved'; else if (outcome.status === 'No solution within scope' || (outcome.combo?.proven && outcome.combo.best < target)) statuses[i] = 'failed';
    for (const route of routes) {
      const action = firstAction(route.steps[0]); actions.add(action);
      if (!successes.has(action)) successes.set(action, new Set()); successes.get(action)!.add(i);
      witnesses.push({ id: i, weight: item.weight, queue: [test.position.falling.symbol, ...test.position.next].join(''), route, index: 0, drawn: 0 });
    }
    refresh();
  }
  if (distribution.mode === 'enumerated' && request.rules.nextCount > 0) result.policy = witnessPolicy(witnesses, request.rules.nextCount, () => performance.now() >= deadline);
  result.reasons = ['Queue coverage allows later decisions to know the completed future. It is not a player win rate.', 'First-move bounds use verified witnesses; unsearched continuations remain unknown.', distribution.mode === 'sampled' ? 'Independent samples use the stated bag assumption. Intervals are 95% Wilson bounds enlarged for unresolved searches. No policy is fitted to these samples.' : 'The finite-Next tree is a realizable lower bound from verified routes, not a proof of an optimal policy.'];
  refresh(); return result;
}
