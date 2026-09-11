import { createEngine } from './engine';
import { countFinesseInputs, findFinesse } from './finesse';
import { drillCatalog, drillRules, placementShape } from './drills';
import { customDefaults, modeDefinitions, validateCustomRules } from './modes';
import type { PracticeSet } from './practice';
import type { TrainerGame } from './game';
import type { Settings } from './settings';

export type TrainerReplay = ReturnType<TrainerGame['export']>;
export type FaultEntry = { key: string; label: string; piece: string; shape: string; extra: number; optimal: number; actual: number; placement: number };
export type SessionRecord = { id: string; date: string; mode: string; status: string; attempts: number; accepted: number; verified: number; perfect: number; extra: number; faults: FaultEntry[]; replay: TrainerReplay };
export type FaultGroup = { key: string; label: string; count: number; extra: number; session: SessionRecord; fault: FaultEntry };

export async function analyzeSession(replay: TrainerReplay): Promise<SessionRecord> {
  if (!replay.startedAt || !Array.isArray(replay.placements) || replay.placements.length > 20000) throw new Error('Invalid session recording.');
  const custom = replay.modeRules.id === 'custom' ? validateCustomRules(replay.settings.custom) : undefined;
  const rules = modeDefinitions[custom ? 'custom' : 'sprint'].rules({ ...replay.settings, custom: custom ?? customDefaults });
  const engine = createEngine(replay.settings, replay.seed, rules), faults: FaultEntry[] = [];
  let verified = 0, perfect = 0, extra = 0;
  for (let i = 0; i < replay.placements.length; i++) {
    const p = replay.placements[i];
    if (p.reason === 'target') continue;
    const path = p.finesse ?? findFinesse(engine, p.snapshot, p.cells);
    if (!path) continue;
    verified++;
    const actual = countFinesseInputs(p.inputs), excess = Math.max(0, actual - path.cost);
    if (!excess) perfect++;
    else {
      extra += excess;
      const shape = placementShape(p.cells), column = Math.min(...p.cells.map(cell => cell[0])) + 1;
      faults.push({ key: `${rules.board.width}:${rules.board.height}:${rules.advanced.kickSet}:${p.piece}:${shape}`, label: `${p.piece.toUpperCase()} · column ${column} · rotation ${p.rotation * 90}°`, piece: p.piece, shape, extra: excess, optimal: path.cost, actual, placement: i });
    }
    if (i && i % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { id: `${replay.startedAt}:${replay.seed}:${replay.mode}`, date: replay.startedAt, mode: replay.mode, status: replay.status, attempts: replay.placements.length, accepted: replay.placements.filter(p => p.accepted).length, verified, perfect, extra, faults, replay };
}

export function faultGroups(sessions: SessionRecord[]): FaultGroup[] {
  const groups = new Map<string, FaultGroup>();
  for (const session of sessions) for (const fault of session.faults) {
    const group = groups.get(fault.key);
    if (group) { group.count++; group.extra += fault.extra; }
    else groups.set(fault.key, { key: fault.key, label: fault.label, count: 1, extra: fault.extra, session, fault });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.extra - a.extra || a.label.localeCompare(b.label));
}

export function focusedDrills(groups: FaultGroup[], settings: Settings, originalBoards: boolean): PracticeSet {
  if (!groups.length) throw new Error('Select at least one fault to practice.');
  const replay = groups[0].session.replay;
  const signature = (r: TrainerReplay) => `${r.modeRules.board.width}:${r.modeRules.board.height}:${r.modeRules.advanced.kickSet}`;
  if (groups.some(group => signature(group.session.replay) !== signature(replay))) throw new Error('Select faults with the same board size and rotation system for one practice set.');
  const customRules = drillRules(replay.modeRules.id === 'custom' ? replay.settings.custom : customDefaults);
  const scenes = groups.map(group => {
    const placement = group.session.replay.placements[group.fault.placement];
    if (originalBoards) {
      const rules = modeDefinitions.custom.rules({ ...settings, custom: customRules }), engine = createEngine(settings, 1, rules);
      const path = findFinesse(engine, placement.snapshot, placement.cells);
      if (!path) throw new Error('A selected scene is unreachable with these handling settings.');
      return { id: group.key, snapshot: structuredClone(placement.snapshot), target: structuredClone(placement.cells), path };
    }
    const catalog = drillCatalog(settings, { pieces: [group.fault.piece], columns: Array.from({ length: customRules.advanced.width }, (_, i) => i), rotations: [0, 1, 2, 3], rounds: 0 }, customRules);
    const scene = catalog.find(scene => placementShape(scene.target) === group.fault.shape);
    if (!scene) throw new Error('This fault needs its original stack. Enable "Use original boards" to practice it.');
    return scene;
  });
  return { name: 'Selected finesse faults', kind: 'focused', scenes, customRules, loop: true };
}

export class HistoryStore {
  private db: Promise<IDBDatabase> | null = null;
  private saving: Promise<unknown> = Promise.resolve();
  private removed = new Set<string>();
  private open() {
    return this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('tetrio-trainer-history', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.db = null; reject(new Error('Session storage is unavailable. Download a replay to keep your data.')); };
      request.onblocked = () => reject(new Error('Close older trainer tabs and retry opening statistics.'));
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', mode), request = action(tx.objectStore('sessions'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('History could not be saved. Export a backup and free browser storage.'));
    });
  }
  save(replay: TrainerReplay) {
    const task = this.saving.then(async () => {
      if (!replay.startedAt || !replay.placements.length) return;
      const record = await analyzeSession(replay);
      if (this.removed.has(record.id)) return;
      await this.transaction('readwrite', store => store.put(record));
      return record;
    });
    this.saving = task.catch(() => {});
    return task;
  }
  async all() { await this.saving; return (await this.transaction<SessionRecord[]>('readonly', store => store.getAll())).sort((a, b) => b.date.localeCompare(a.date)); }
  async remove(id: string) { await this.saving; this.removed.add(id); await this.transaction('readwrite', store => store.delete(id)); }
  async import(replays: TrainerReplay[]) {
    const records: SessionRecord[] = [];
    for (const replay of replays) records.push(await analyzeSession(replay));
    await this.saving;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite'), store = tx.objectStore('sessions');
      for (const record of records) store.put(record);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('History import failed. No sessions were changed.'));
    });
    for (const record of records) this.removed.delete(record.id);
  }
}
