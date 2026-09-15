import type { Mino } from '@haelp/teto/engine';
import { createEngine, spawnSnapshot } from './engine';
import { analysisContext, type AnalysisContext } from './analysis-context';
import { frozenContext, validatePcScene, type PcScene } from './pc-scenes';
import { defaultSpinFilters, spinRequest, spinEngine, applySpinPath, verifySpinRoute, type SpinFilters, type SpinRoute } from './spin-search';
import type { Move } from './finesse';
import { stableKey } from './analysis';
import templates from './spin-templates.json';
import { supportSpinTerrain } from './spin-terrain';

export type SpinScene = PcScene & { filters?: SpinFilters; cluster?: string };
export type SpinRecord = { scene: SpinScene; date: string; solved: boolean; retries: number; hints: boolean; timeMs: number };
export type SpinLibrary = { version: 1; scenes: SpinScene[]; records: SpinRecord[] };
export const spinStorageKey = 'tetrio-trainer-spin-library-v1';
type SpinTemplate = { piece: string; rows: string[]; moves: Move[]; spin?: string; lines?: number };
export type SpinDrill = SpinTemplate & { id: string; name: string; group?: string; source?: string; variants?: SpinTemplate[] };
export const spinDrills: SpinDrill[] = [
  { id: 'zero', name: 'T-spin Zero - no clear', piece: 't', rows: ['_XXX_XXXXX','_XX___XXXX','___X______'], moves: ['rotateCW','softDrop','rotateCW'] },
  { id: 'tss', name: 'T-spin Single - 1 line', piece: 't', rows: ['_XXX_XXXXX','XXX___XXXX','___X______'], moves: ['rotateCW','softDrop','rotateCW'] },
  { id: 'tst', name: 'T-spin Triple - 3 lines', piece: 't', rows: ['XXXXX_XXXX','XXXXXX_XXX','XXXXX__XXX','XXXXXX_XXX','XXXX___XXX','__XX__XX_X','_________X','_________X','_________X'], moves: ['rotateCW','softDrop','rotateCCW','rotateCCW'] },
  { id: 'tsd', name: 'T-spin Double · 2 lines', piece: 't', rows: ['XXXX_XXXXX','XXX___XXXX','___X______'], moves: ['rotateCW','softDrop','rotateCW'] },
  { id: 'mini', name: 'Mini T-spin Single · wall kick', piece: 't', rows: ['XXX_XXXXXX',...Array(6).fill('XXX___XXXX')], moves: ['softDrop','rotateCW'] },
  { id: 'i', name: 'I insertion · wall kick', piece: 'i', rows: ['XXXXX_XXXX','XX____XXXX',...Array(5).fill('XXXXX_XXXX')], moves: ['rotateCW','softDrop','rotateCW'] },
  { id: 'j', name: 'J insertion · upward kick', piece: 'j', rows: ['XXXX_XXXXX','XXXX_XXXXX','XXXX__XXXX','XXX___XXXX',...Array(3).fill('XXXX__XXXX')], moves: ['rotateCW','softDrop','rotateCW'] },
  { id: 'l', name: 'L insertion · upward kick', piece: 'l', rows: ['XXXX__XXXX','XXXX__XXXX','XXX___XXXX','XXX___XXXX',...Array(3).fill('XXXX__XXXX')], moves: ['rotateCW','softDrop','rotateCW'] },
  { id: 's', name: 'S insertion · downward kick', piece: 's', rows: ['XXXX_XXXXX','XXX__XXXXX','XXX_XXXXXX','XXX__XXXXX',...Array(3).fill('XXX___XXXX')], moves: ['softDrop','rotateCCW'] },
  { id: 'z', name: 'Z insertion · downward kick', piece: 'z', rows: ['XXXX_XXXXX','XXXX__XXXX','XXXXX_XXXX','XXXX__XXXX',...Array(3).fill('XXX___XXXX')], moves: ['softDrop','rotateCW'] },
  { id: '180', name: 'T-spin Double · 180 rotation', piece: 't', rows: ['XXXX_XXXXX','XXX___XXXX','___X______'], moves: ['rotateCW','softDrop','rotateCCW','rotate180'] }
];
for(const entry of templates){const variants=entry.variants as SpinTemplate[],existing=spinDrills.find(drill=>drill.id===entry.id);if(existing){existing.variants=[{piece:existing.piece,rows:existing.rows,moves:existing.moves},...variants];existing.group=entry.group;existing.name=entry.name;}else spinDrills.push({...entry,...variants[0],variants});}

export function spinDrill(source: AnalysisContext, id: string, mirror = false, variant = 0): { scene: SpinScene; witness: SpinRoute } {
  const definition = spinDrills.find(drill => drill.id === id); if (!definition) throw new Error('Choose a Spin drill.');
  const drill = {...definition,...definition.variants?.[variant % definition.variants.length]};
  if (source.rules.board.width !== 10) throw new Error('These authored drills use ten columns. Analyze the current board or import a saved scene for this mode.');
  const context = frozenContext(source), engine = createEngine(context.settings,1,context.rules), snapshot = engine.snapshot({ isUndoRedo: true });
  context.rules.name = 'SPIN LAB';
  for (const [y,row] of drill.rows.entries()) for (const [x,tile] of [...row].entries()) if (tile === 'X') snapshot.board[y][mirror ? 9-x : x] = { mino: 'gb' as Mino, connections: 0 };
  const swapped: Record<string,string> = { i:'i',o:'o',t:'t',j:'l',l:'j',s:'z',z:'s' };
  snapshot.falling = spawnSnapshot(engine,(mirror ? swapped[drill.piece] : drill.piece) as Mino); snapshot.hold = null; snapshot.holdLocked = false;
  snapshot.queue.value = []; snapshot._queue.value = [];
  context.snapshot = snapshot; delete context.generated; delete context.pack; context.currentKnown = true;
  const filters: SpinFilters = { ...defaultSpinFilters, piece: snapshot.falling.symbol, kind: source.rules.advanced.spinBonuses === 'none' || !['t'].includes(drill.piece) && source.rules.advanced.spinBonuses.startsWith('T-spins') ? 'geometric' : 'scored', rotation: id === '180' ? '180' : 'either', hold: 'current' };
  const reversed: Partial<Record<Move,Move>> = { rotateCW:'rotateCCW',rotateCCW:'rotateCW',moveLeft:'moveRight',moveRight:'moveLeft',dasLeft:'dasRight',dasRight:'dasLeft' };
  const moves: Move[] = mirror ? [...(drill.piece === 'i' ? [] : ['moveRight' as const]), ...drill.moves.map(move => reversed[move] ?? move)] : drill.moves;
  if(!supportSpinTerrain(context,moves))throw new Error('This rotation has no supported terrain under the active rules.');
  const request = spinRequest(context, { filters }), verifier = spinEngine(request);
  let target: [number,number][] = []; verifier.events.on('falling.lock.pre',()=>{target=verifier.falling.absoluteBlocks;});
  const path = { moves, cost: moves.filter(move => move !== 'softDrop' && move !== 'down').length, source: 'extended' as const, drop: 'soft' as const };
  let outcome; try { outcome = applySpinPath(verifier,path); } catch { throw new Error('This drill witness is unavailable under the active kick/180 rules. Choose another drill or analyze the current board.'); }
  filters.lines = outcome.result.lines;
  filters.kind = outcome.result.spin !== 'none' ? outcome.result.spin as 'normal'|'mini' : outcome.evidence.geometric ? 'geometric' : 'rotation';
  if(id.startsWith('ttt-'))filters.target=target;
  request.filters = {...filters};
  const witness: SpinRoute = { id: `drill-${id}-${mirror}`, steps: [{ scene: { id: `drill-${id}`, snapshot, target, path }, after: verifier.snapshot({ isUndoRedo: true }), piece: snapshot.falling.symbol, lines: outcome.result.lines, spin: outcome.result.spin, pc: false }], evidence: outcome.evidence, terminalLines: outcome.result.lines, spins: Number(outcome.result.spin !== 'none'), lines: outcome.result.lines, pc: false };
  if (!verifySpinRoute(request,witness)) throw new Error('This drill has no verified witness under the active rules. Choose another drill or analyze this mode directly.');
  return { scene: { id: crypto.randomUUID(), name: `${drill.name}${mirror ? ' · Mirror' : ''}`, source: `${drill.source??'Locally constructed'}; engine-verified with ${context.rules.advanced.kickSet} / ${context.rules.advanced.spinBonuses}.`, context, future: false, finiteQueue: true, filters }, witness };
}

export function spinCluster(scene: PcScene) {
  const { rules, snapshot } = scene.context;
  return stableKey({ piece: snapshot.falling.symbol, rotation: snapshot.falling.rotation, position: snapshot.falling.location, board: snapshot.board.map(row=>row.map(Boolean)), rules, handling: scene.context.settings.handling });
}

export function readSpinLibrary(storage: Pick<Storage,'getItem'>): SpinLibrary {
  const raw = storage.getItem(spinStorageKey); if (!raw) return { version:1,scenes:[],records:[] };
  const value = JSON.parse(raw) as SpinLibrary;
  if (value.version !== 1 || !Array.isArray(value.scenes) || value.scenes.length > 100 || !Array.isArray(value.records) || value.records.length > 200) throw new Error('Invalid Spin library.');
  const validate = (scene: SpinScene) => { const checked = validatePcScene(scene) as SpinScene; if (checked.filters && stableKey({ ...defaultSpinFilters, ...checked.filters }) !== stableKey(checked.filters)) throw new Error('Invalid Spin scene filters.'); return checked; };
  return { version:1, scenes: value.scenes.map(validate), records: value.records.map(record => { if (typeof record.solved !== 'boolean' || typeof record.hints !== 'boolean' || typeof record.date !== 'string' || !Number.isFinite(record.retries) || record.retries < 0 || !Number.isFinite(record.timeMs) || record.timeMs < 0) throw new Error('Invalid Spin record.'); return {...record,scene:validate(record.scene)}; }) };
}

export function spinSceneContext(scene: SpinScene, snapshot = scene.context.snapshot) {
  return analysisContext(scene.context.rules,scene.context.settings,snapshot);
}
