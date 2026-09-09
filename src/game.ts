import type { Engine, EngineSnapshot, LockRes } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import { FrameInput } from './input';
import { countFinesseInputs, findFinesse, type Cell, type FinesseResult } from './finesse';
import { finesseRules } from './finesse-data';
import { defaults, type Settings } from './settings';

export class TrainerGame {
  engine: Engine;
  settings: Settings;
  input = new FrameInput();
  status: 'ready' | 'playing' | 'paused' | 'complete' | 'topout' = 'ready';
  seed: number;
  startedAt: string | null = null;
  inputs = 0;
  holds = 0;
  faults = 0;
  perfects = 0;
  unverified = 0;
  fault: { target: Cell[]; path: FinesseResult; actual: number } | null = null;
  events: { frame: number; type: string; data: unknown }[] = [];
  placements: { frame: number; piece: string; cells: Cell[]; rotation: number; result: LockRes; board: unknown; hold: unknown; next: string[]; accepted: boolean; finesse: FinesseResult | null; finesseInputs: number; inputs: Game.Key[] }[] = [];
  clears: Record<string, number> = {};
  maxCombo = 0;
  maxB2B = 0;
  private startSnapshot: EngineSnapshot;
  private pieceInputs: Game.Key[] = [];
  private frameKeyOffset = 0;
  private locking: { target: Cell[]; rotation: number; inputs: Game.Key[]; keyOffset: number; snapshot: EngineSnapshot } | null = null;
  private rollback: EngineSnapshot | null = null;

  constructor(settings: Settings = defaults, seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1) {
    this.settings = structuredClone(settings);
    this.seed = seed;
    this.engine = createEngine(this.settings, seed);
    this.startSnapshot = this.engine.snapshot({ isUndoRedo: true });
    this.engine.events.on('falling.lock.pre', () => {
      this.locking = { target: this.engine.falling.absoluteBlocks, rotation: this.engine.falling.rotation, inputs: this.pieceInputs, keyOffset: this.frameKeyOffset, snapshot: this.startSnapshot };
    });
    this.engine.events.on('falling.new', ({ isHold }) => {
      this.pieceInputs = [];
      this.frameKeyOffset = this.engine.resCache.keys.length;
      if (isHold) { this.holds++; this.startSnapshot = this.engine.snapshot({ isUndoRedo: true }); }
    });
    this.engine.events.on('falling.lock', res => this.locked(res));
  }

  start() { this.status = 'playing'; this.startedAt = new Date().toISOString(); }
  get elapsedMs() { return this.engine.frame * 1000 / 60; }

  step() {
    if (this.status !== 'playing') return;
    const frames = this.input.drain(this.engine.frame);
    this.inputs += frames.filter(frame => frame.type === 'keydown').length;
    this.events.push(...frames.map(frame => ({ frame: frame.frame, type: frame.type, data: frame.data })));
    const result = this.engine.tick(frames);
    this.pieceInputs.push(...result.keys.slice(this.frameKeyOffset));
    this.frameKeyOffset = 0;
    if (this.rollback) {
      this.engine.fromSnapshot(this.rollback);
      this.pieceInputs = [];
      this.engine.resCache.keys = [];
      this.releaseAll();
      this.events.push({ frame: this.engine.frame, type: 'retry', data: { target: this.fault?.target, snapshot: this.rollback } });
      this.rollback = null;
      this.startSnapshot = this.engine.snapshot({ isUndoRedo: true });
    }
    if (this.engine.stats.lines >= 40) this.status = 'complete';
    else if (this.engine.toppedOut) this.status = 'topout';
  }

  private locked(result: LockRes) {
    const locking = this.locking;
    this.locking = null;
    if (this.rollback) return;
    if (!locking) return;
    const inputs = [...locking.inputs, ...result.keysPresses.slice(locking.keyOffset)];
    const actual = countFinesseInputs(inputs);
    const finesse = findFinesse(this.engine, locking.snapshot, locking.target);
    const accepted = finesse === null || actual <= finesse.cost;
    this.placements.push({ frame: this.engine.frame, piece: result.mino, cells: locking.target, rotation: locking.rotation, result: structuredClone(result), board: structuredClone(locking.snapshot.board), hold: locking.snapshot.hold, next: locking.snapshot.queue.value.slice(0, 5), accepted, finesse, finesseInputs: actual, inputs });
    if (!accepted && finesse) {
      this.faults++;
      this.fault = { target: locking.target, path: finesse, actual };
      this.rollback = locking.snapshot;
    } else {
      if (finesse) this.perfects++; else this.unverified++;
      this.fault = null;
      const name = result.spin !== 'none' ? `${result.spin === 'mini' ? 'mini-' : ''}tspin-${result.lines}` : ['none', 'single', 'double', 'triple', 'quad'][result.lines] || `clear-${result.lines}`;
      this.clears[name] = (this.clears[name] || 0) + 1;
      if (this.engine.board.perfectClear && result.lines) this.clears.pc = (this.clears.pc || 0) + 1;
      this.maxCombo = Math.max(this.maxCombo, this.engine.stats.combo);
      this.maxB2B = Math.max(this.maxB2B, this.engine.stats.b2b);
      this.startSnapshot = this.engine.snapshot({ isUndoRedo: true });
    }
  }

  pause() { if (this.status === 'playing') { this.status = 'paused'; this.releaseAll(); this.events.push({ frame: this.engine.frame, type: 'pause', data: {} }); } }
  resume() { if (this.status === 'paused') this.status = 'playing'; }

  releaseAll() {
    this.input.reset();
    const input = this.engine.input;
    input.lShift.held = input.rShift.held = false;
    input.lShift.das = input.rShift.das = input.lShift.arr = input.rShift.arr = 0;
    for (const key of Object.keys(input.keys) as (keyof typeof input.keys)[]) input.keys[key] = false;
    this.events.push({ frame: this.engine.frame, type: 'release-all', data: {} });
  }

  export() {
    return { version: 1, mode: '40l-finesse', seed: this.seed, startedAt: this.startedAt, savedAt: new Date().toISOString(), settings: this.settings, engineVersion: '4.2.7', finesseRules, status: this.status, events: this.events, placements: this.placements, result: { timeMs: this.elapsedMs, inputs: this.inputs, holds: this.holds, faults: this.faults, perfects: this.perfects, unverified: this.unverified, clears: this.clears, maxCombo: this.maxCombo, maxB2B: this.maxB2B, ...this.engine.stats } };
  }
}
