import { decoder } from 'tetris-fumen';
import { legal, type EngineSnapshot, type Mino } from '@haelp/teto/engine';
import { analysisContext, customRulesFromMode, withGeneratedPacks, frozenAttackRules, type AnalysisContext } from './analysis-context';
import { analysisEngine, analysisRequest, pcCapabilities } from './analysis';
import { createEngine, spawnSnapshot } from './engine';
import { copyPiece } from './finesse';
import { modeDefinitions, validateCustomRules } from './modes';
import { validateSettings } from './settings';

export type PcScene = { id: string; name: string; source: string; context: AnalysisContext; future: boolean; finiteQueue?: boolean; objective?: 'pc' | 'combo' | 'attack' };
export type PcRecord = { id: string; sceneId: string; date: string; attempts: number; solved: boolean; mistakes: number; faults: number; timeMs: number; learning: string; initialLearning?: string; thinkingMs?: number; structure?: string; objective?: string };
export type PcLibrary = { version: 1; scenes: PcScene[]; records: PcRecord[] };
export const pcStorageKey = 'tetrio-trainer-pc-library-v1';
export function currentSceneContext(scene: PcScene, snapshot: EngineSnapshot, rules = scene.context.rules, settings = scene.context.settings) {
  const context = analysisContext(rules, settings, snapshot);
  if (scene.finiteQueue) {
    const original = scene.context.snapshot;
    const drawn = snapshot.stats.pieces - original.stats.pieces + Number(!original.hold && !!snapshot.hold);
    const remaining = Number(scene.context.currentKnown !== false) + original.queue.value.length - drawn;
    context.currentKnown = remaining > 0;
    if (remaining < 0) { context.snapshot.hold = null; context.snapshot.holdLocked = true; }
    context.snapshot.queue.value = context.snapshot.queue.value.slice(0, Math.max(0, remaining - 1));
    context.snapshot._queue.value = [...context.snapshot.queue.value];
  } else if (scene.context.pack || scene.context.generated) withGeneratedPacks(context);
  return context;
}
export function frozenContext(context: AnalysisContext, combo = false): AnalysisContext {
  const next = structuredClone(context), custom = customRulesFromMode(next.rules);
  Object.assign(custom, { gravity: 0, infiniteLock: true, lineGoal: 0, pieceGoal: 0, timeLimit: 0, initialGarbage: 0, topout: 'stop', undo: true, roomPreset: '' });
  Object.assign(custom.advanced, { gravityIncrease: 0, entryDelay: 0, lineClearDelay: 0, map: '', sequence: '', repeatSequence: false });
  if (combo) custom.advanced = frozenAttackRules(custom.advanced, context.snapshot.frame);
  next.settings.custom = custom; next.rules = modeDefinitions.custom.rules(next.settings); next.rules.name = 'PERFECT CLEAR LAB';
  next.snapshot.glock = 0; next.snapshot.state = 0; next.snapshot.__meta.isUndoRedo = true;
  return next;
}
export function sceneFromFumen(code: string, pageNumber: number, queue: string, hold: string, source: AnalysisContext): PcScene {
  if (!code.trim() || code.length > 50000) throw new Error('Enter a Fumen code or URL, up to 50,000 characters.');
  if (source.rules.board.width !== 10) throw new Error('Fumen requires a ten-column board.');
  const pieces = queue.replace(/\s/g, '').toLowerCase();
  if (!/^[ijlostz]{1,32}$/.test(pieces) || !/^[-ijlostz]$/i.test(hold)) throw new Error('Enter 1–32 pieces starting with the current piece, and an optional Hold piece.');
  let pages; try { pages = decoder.decode(code); } catch { throw new Error('Invalid Fumen code or URL.'); }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length || pages.length > 64) throw new Error('Choose an existing Fumen page (1–64).');
  const page = pages[pageNumber - 1];
  if (page.flags.rise || page.flags.mirror) throw new Error('Fumen rise and mirror transitions are not supported.');
  const context = frozenContext(source), engine = createEngine(context.settings, 1, context.rules), snapshot = engine.snapshot({ isUndoRedo: true });
  delete context.pack;
  delete context.generated;
  delete context.currentKnown;
  for (let y = -1; y < 23; y++) for (let x = 0; x < 10; x++) {
    const tile = page.field.at(x, y); if (tile === '_') continue;
    if (y < 0 || y >= context.rules.board.height) throw new Error('Fumen cells are outside the active board.');
    snapshot.board[y][x] = { mino: (tile === 'X' ? 'gb' : tile.toLowerCase()) as Mino, connections: 0 };
  }
  snapshot.falling = spawnSnapshot(engine, pieces[0] as Mino); snapshot.hold = hold === '-' ? null : hold.toLowerCase() as Mino;
  snapshot.queue.value = [...pieces.slice(1)] as Mino[]; snapshot._queue.value = [...snapshot.queue.value];
  context.snapshot = snapshot;
  return { id: crypto.randomUUID(), name: `Fumen page ${pageNumber}`, source: `Fumen page ${pageNumber} before its operation; supplied queue`, context, future: pieces.length > 1, finiteQueue: true };
}
export function changeSceneQueue(scene: PcScene, sequence: string | number): PcScene {
  const context = structuredClone(scene.context), engine = createEngine(context.settings, typeof sequence === 'number' ? sequence : 1, context.rules);
  let next = engine.snapshot({ isUndoRedo: true });
  if (typeof sequence === 'string') {
    const pieces = sequence.replace(/\s/g, '').toLowerCase();
    if (!/^[ijlostz]{1,32}$/.test(pieces)) throw new Error('Enter 1–32 pieces starting with the current piece.');
    next.falling = spawnSnapshot(engine, pieces[0] as Mino); next.queue.value = [...pieces.slice(1)] as Mino[]; next._queue.value = [...next.queue.value];
  }
  const old = context.snapshot;
  Object.assign(next, { board: old.board, hold: old.hold, holdLocked: false, stats: old.stats });
  context.snapshot = next;
  delete context.currentKnown;
  delete context.pack;
  delete context.generated;
  if (typeof sequence === 'number') withGeneratedPacks(context);
  return { ...scene, id: crypto.randomUUID(), context, name: typeof sequence === 'number' ? `PC board · seed ${sequence}` : 'PC board · supplied queue', source: typeof sequence === 'number' ? `New seed ${sequence}; board and Hold retained` : 'Supplied queue; board and Hold retained', future: true, finiteQueue: typeof sequence === 'string' };
}
export function validatePcScene(value: unknown): PcScene {
  const scene = value as PcScene;
  if (!scene || typeof scene.id !== 'string' || !scene.id || scene.id.length > 100 || typeof scene.name !== 'string' || scene.name.length > 100 || typeof scene.source !== 'string' || scene.source.length > 1000 || typeof scene.future !== 'boolean' || !scene.context || JSON.stringify(scene).length > 200000) throw new Error('Invalid saved PC scene.');
  const { context } = scene, snapshot = context.snapshot;
  if ((scene.finiteQueue !== undefined && typeof scene.finiteQueue !== 'boolean') || (context.currentKnown !== undefined && typeof context.currentKnown !== 'boolean')) throw new Error('Invalid known-queue boundary.');
  if ((context.generated !== undefined && typeof context.generated !== 'boolean') || (scene.finiteQueue && context.generated)) throw new Error('Invalid generated-queue boundary.');
  if (scene.objective !== undefined && !['pc','combo','attack'].includes(scene.objective)) throw new Error('Invalid scene objective.');
  if (context.version !== 1 || !context.settings || !context.rules || !snapshot || !Array.isArray(snapshot.board) || !Array.isArray(snapshot.queue?.value)) throw new Error('Invalid PC board or queue.');
  validateCustomRules(customRulesFromMode(context.rules));
  validateSettings(context.settings);
  if (context.pack && (![7, 14].includes(context.pack.size) || context.rules.bag !== `${context.pack.size}-bag` || !Number.isInteger(context.pack.nextOffset) || context.pack.nextOffset < 0 || context.pack.nextOffset >= context.pack.size)) throw new Error('Invalid pack boundary.');
  if (snapshot.board.length !== context.rules.board.height + context.rules.board.buffer || snapshot.board.some(row => !Array.isArray(row) || row.length !== context.rules.board.width || row.some(tile => tile !== null && (!tile || !['i','j','l','o','s','t','z','gb','bomb'].includes(tile.mino))))) throw new Error('Invalid PC board cells.');
  if (!snapshot.falling || !['i','j','l','o','s','t','z'].includes(snapshot.falling.symbol) || snapshot.queue.value.length > 64 || snapshot.queue.value.some(mino => !['i','j','l','o','s','t','z'].includes(mino)) || (snapshot.hold !== null && !['i','j','l','o','s','t','z'].includes(snapshot.hold))) throw new Error('Invalid PC pieces.');
  if (!Array.isArray(snapshot.falling.location) || snapshot.falling.location.length !== 2 || snapshot.falling.location.some(n => !Number.isFinite(n)) || ![0,1,2,3].includes(snapshot.falling.rotation)) throw new Error('Invalid active-piece position.');
  const template = createEngine(context.settings, 1, context.rules).snapshot({ isUndoRedo: true });
  const shape = (expected: unknown, actual: unknown): void => {
    if (expected === undefined || expected === null) return;
    if (Array.isArray(expected)) { if (!Array.isArray(actual)) throw new Error('Invalid PC snapshot array.'); return; }
    if (typeof expected === 'object') {
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) throw new Error('Invalid PC snapshot state.');
      for (const [key, value] of Object.entries(expected)) shape(value, (actual as Record<string, unknown>)[key]);
    } else if (typeof actual !== typeof expected || (typeof actual === 'number' && !Number.isFinite(actual))) throw new Error('Invalid PC snapshot value.');
  };
  shape(template, snapshot);
  if (snapshot._queue.value.some(mino => !['i','j','l','o','s','t','z'].includes(mino))) throw new Error('Invalid PC backup queue.');
  const request = analysisRequest(context, { sessionId: scene.id, revision: 0 });
  const engine = analysisEngine(request);
  if (!legal(copyPiece(engine, snapshot.falling).absoluteBlocks, snapshot.board)) throw new Error('The active piece collides with the board.');
  return structuredClone(scene);
}
export function readPcLibrary(storage: Pick<Storage, 'getItem'>): PcLibrary {
  const raw = storage.getItem(pcStorageKey); if (!raw) return { version: 1, scenes: [], records: [] };
  return parsePcLibrary(JSON.parse(raw));
}
export function parsePcLibrary(value: unknown): PcLibrary {
  const library = value as PcLibrary;
  if (!library || library.version !== 1 || !Array.isArray(library.scenes) || library.scenes.length > 100 || !Array.isArray(library.records) || library.records.length > 1000) throw new Error('Invalid PC library backup.');
  const scenes = library.scenes.map(validatePcScene);
  if (new Set(scenes.map(scene => scene.id)).size !== scenes.length) throw new Error('Duplicate PC scene IDs.');
  for (const record of library.records) if (!record || typeof record.id !== 'string' || typeof record.sceneId !== 'string' || typeof record.date !== 'string' || typeof record.learning !== 'string' || typeof record.solved !== 'boolean' || [record.attempts, record.mistakes, record.faults, record.timeMs].some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid PC practice record.');
  for (const record of library.records) if ((record.thinkingMs !== undefined && (!Number.isFinite(record.thinkingMs) || record.thinkingMs < 0)) || [record.initialLearning, record.structure, record.objective].some(value => value !== undefined && (typeof value !== 'string' || value.length > 200))) throw new Error('Invalid extended practice record.');
  if (new Set(library.records.map(record => record.id)).size !== library.records.length) throw new Error('Duplicate PC record IDs.');
  return { version: 1, scenes, records: structuredClone(library.records) };
}
export function savePcLibrary(storage: Pick<Storage, 'setItem'>, library: PcLibrary) { storage.setItem(pcStorageKey, JSON.stringify(library)); }
export function pcSceneCapabilities(scene: PcScene) { return pcCapabilities(analysisRequest(scene.context, { sessionId: scene.id, revision: 0 })); }
