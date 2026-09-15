import type { EngineSnapshot, Mino } from '@haelp/teto/engine';
import { createEngine, spawnSnapshot } from './engine';
import { frozenAttackRules, type AnalysisContext } from './analysis-context';
import { defaults, type Settings } from './settings';
import type { ModeRules } from './modes';
import type { ContinuationRoute } from './continuation-search';

export const analysisVersion = 'pc-1.4.0';
export const maxAnalysisDepth = 20;
export const maxComboAnalysisDepth = 60;
export type InformationScope = 'visible' | 'pack' | 'seeded';
export type AnalysisStatus = 'Solved' | 'No solution within scope' | 'Incomplete' | 'Unsupported';
export type AnalysisPosition = Pick<EngineSnapshot, 'board' | 'falling' | 'hold' | 'holdLocked' | 'stats' | 'lastSpin' | 'lastWasClear' | 'frame'> & { currentKnown: boolean; next: EngineSnapshot['queue']['value']; pendingGarbage: boolean; unavailable: boolean };
export type AnalysisRequest = {
  version: 1; solver: string; sessionId: string; revision: number; fingerprint: string;
  rules: ModeRules; handling: Settings['handling']; position: AnalysisPosition;
  information: InformationScope; bag: { kind: string; remaining: null; pack?: { size: number; nextOffset: number } };
  goal: { kind: 'pc' | 'combo'; lines: number; objective?: 'clears' | 'attack'; cleanup?: number }; depth: number; budget: { milliseconds: number; nodes: number; candidates: number };
};
export type AnalysisResult = {
  sessionId: string; revision: number; fingerprint: string; solver: string; status: AnalysisStatus;
  routes: ContinuationRoute[]; complete: boolean; reasons: string[]; checked: number; elapsedMs: number;
  verification: 'engine-rules'; timing: 'frozen'; queue: string[]; information: InformationScope; depth: number; lines: number;
  combo?: { objective: 'clears' | 'attack'; best: number; proven: boolean; board: string; immediateChoices: number; immediateComplete: boolean };
};
export function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function analysisRequest(context: AnalysisContext, options: { sessionId: string; revision: number; information?: InformationScope; lines?: number; depth?: number; milliseconds?: number; nodes?: number; candidates?: number; kind?: 'pc' | 'combo'; objective?: 'clears' | 'attack'; cleanup?: number }): AnalysisRequest {
  const { snapshot } = context, rules = structuredClone(context.rules), information = options.information ?? (options.kind === 'combo' ? 'seeded' : 'visible');
  const limit = options.kind === 'combo' ? maxComboAnalysisDepth : maxAnalysisDepth;
  const depth = Math.max(0, Math.min(limit, Math.floor(options.depth ?? limit)));
  const bag: AnalysisRequest['bag'] = { kind: rules.advanced.sequence ? rules.advanced.repeatSequence ? 'repeating sequence' : 'authored sequence' : rules.bag, remaining: null };
  let known = information === 'seeded' ? depth : rules.nextCount;
  if (information === 'pack' && context.pack) {
    bag.pack = structuredClone(context.pack);
    const visible = Math.min(rules.nextCount, snapshot.queue.value.length);
    known = Math.ceil((context.pack.nextOffset + visible) / context.pack.size) * context.pack.size - context.pack.nextOffset;
  }
  rules.advanced.map = ''; rules.advanced.sequence = ''; rules.advanced.repeatSequence = false; rules.sourcePreset = '';
  const currentKnown = context.currentKnown !== false;
  const falling = currentKnown ? snapshot.falling : spawnSnapshot(createEngine(context.settings, 1, rules), 'i' as Mino);
  let next = snapshot.queue.value.slice(0, known);
  if (information === 'seeded' && context.generated && currentKnown && next.length < known) {
    const future = createEngine(context.settings, 1, context.rules); future.fromSnapshot(structuredClone(snapshot));
    while (future.queue.length < known) future.queue.repopulateOnce();
    next = future.queue.slice(0, known);
  }
  const position: AnalysisPosition = structuredClone({ board: snapshot.board, falling, currentKnown, hold: snapshot.hold, holdLocked: snapshot.holdLocked, stats: snapshot.stats, lastSpin: snapshot.lastSpin, lastWasClear: snapshot.lastWasClear, frame: options.kind === 'combo' ? snapshot.frame : 0, next: currentKnown ? next : [], pendingGarbage: snapshot.garbage.queue.length > 0, unavailable: snapshot.glock > 0 });
  const goal: AnalysisRequest['goal'] = { kind: options.kind ?? 'pc', lines: options.lines ?? 0, ...(options.kind === 'combo' ? { objective: options.objective ?? 'clears', cleanup: Math.max(0, Math.min(depth - 1, Math.floor(options.cleanup ?? depth - 1))) } : {}) };
  const body = { version: 1 as const, solver: analysisVersion, rules, handling: structuredClone(context.settings.handling), position, information, bag, goal, depth, budget: { milliseconds: Math.max(1, Math.min(60000, options.milliseconds ?? 15000)), nodes: Math.max(1, options.nodes ?? 1000000), candidates: Math.max(1, Math.min(64, options.candidates ?? 24)) } };
  return { ...body, sessionId: options.sessionId, revision: options.revision, fingerprint: stableKey(body) };
}
export function analysisEngine(request: AnalysisRequest) {
  const settings = { ...structuredClone(defaults), handling: structuredClone(request.handling) };
  const rules = structuredClone(request.rules); if (request.goal.kind === 'combo') rules.advanced = frozenAttackRules(rules.advanced, request.position.frame);
  const engine = createEngine(settings, 1, rules), snapshot = engine.snapshot({ isUndoRedo: true });
  const { next, currentKnown, pendingGarbage, unavailable, ...position } = structuredClone(request.position);
  Object.assign(snapshot, position);
  snapshot.queue.value = [...next]; snapshot._queue.value = [...next];
  engine.fromSnapshot(snapshot);
  return engine;
}
export function pcCapabilities(request: AnalysisRequest): string[] {
  const { rules, position } = request, reasons: string[] = [];
  if (request.version !== 1 || request.solver !== analysisVersion) reasons.push('This analysis version is not supported.');
  if (request.information === 'pack' && !request.bag.pack) reasons.push('Pack boundaries are unknown for this source. Use visible Next or an explicitly supplied queue.');
  if (![4, 10].includes(rules.board.width)) reasons.push('PC Lab currently validates four-column and ten-column boards.');
  if (!['SRS', 'SRS+'].includes(rules.advanced.kickSet) && !(rules.board.width === 4 && rules.advanced.kickSet === 'SRS-X')) reasons.push(`PC Lab has not validated ${rules.advanced.kickSet} on this board.`);
  if (!rules.advanced.hardDrop) reasons.push('PC Lab requires hard drop.');
  if (rules.hold && rules.infiniteHold) reasons.push('PC Lab currently requires limited Hold or disabled Hold.');
  if (rules.advanced.garbageInterval || rules.advanced.garbageRefill || position.pendingGarbage) reasons.push('Generated or pending garbage is not supported.');
  if (rules.advanced.bombs || position.board.some(row => row.some(tile => tile?.mino === 'bomb'))) reasons.push('Bombs are not supported.');
  if (position.board.length !== rules.board.height + rules.board.buffer || position.board.some(row => row.length !== rules.board.width)) reasons.push('Board dimensions do not match the active rules.');
  if (position.board.some(row => row.every(Boolean))) reasons.push('Clear completed rows before analyzing this board.');
  if (position.unavailable) reasons.push('Wait for a controllable active piece before analyzing.');
  if (!Number.isInteger(request.goal.lines) || request.goal.lines < 0) reasons.push('Invalid PC line target.');
  return reasons;
}
export class AnalysisSession {
  private worker: Worker | null = null;
  private generation = 0;
  cancel() { this.generation++; this.worker?.terminate(); this.worker = null; }
  run(request: AnalysisRequest, update: (result: AnalysisResult, done: boolean) => void, failure: (message: string) => void) {
    this.cancel(); const generation = this.generation;
    try {
      const worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), { type: 'module' }); this.worker = worker;
      worker.onmessage = event => {
        if (generation !== this.generation) return;
        const { result, done, error } = event.data;
        if (error) { this.cancel(); failure(error); return; }
        if (!result || result.sessionId !== request.sessionId || result.revision !== request.revision || result.fingerprint !== request.fingerprint || result.solver !== request.solver) return;
        if (done) { worker.terminate(); this.worker = null; this.generation++; }
        update(result, done);
      };
      worker.onerror = () => { if (generation === this.generation) { this.cancel(); failure('The analysis worker failed. Analyze again to retry.'); } };
      worker.postMessage(request);
    } catch { this.cancel(); failure('This browser could not start the analysis worker.'); }
  }
}
