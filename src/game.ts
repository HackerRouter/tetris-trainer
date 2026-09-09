import type { Engine, EngineSnapshot, LockRes } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import { FrameInput } from './input';
import { countFinesseInputs, findFinesse, type Cell, type FinesseResult } from './finesse';
import { finesseRules } from './finesse-data';
import { sameCells, type Demonstration, type PracticeSet } from './practice';
import { defaults, type Settings } from './settings';

type Checkpoint = { snapshot: EngineSnapshot; timerFrames: number; perfects: number; holds: number; clears: Record<string, number>; maxCombo: number; maxB2B: number };
type Placement = { frame: number; timeMs: number; piece: string; cells: Cell[]; rotation: number; result: LockRes; snapshot: EngineSnapshot; board: unknown; hold: unknown; next: string[]; accepted: boolean; reason: 'finesse' | 'target' | null; finesse: FinesseResult | null; finesseInputs: number; inputs: Game.Key[] };

export class TrainerGame {
  engine: Engine;
  settings: Settings;
  input = new FrameInput();
  status: 'ready' | 'countdown' | 'playing' | 'paused' | 'complete' | 'topout' = 'ready';
  seed: number;
  startedAt: string | null = null;
  inputs = 0;
  holds = 0;
  faults = 0;
  targetMisses = 0;
  perfects = 0;
  unverified = 0;
  countdownFrames = 0;
  fault: { target: Cell[]; path: FinesseResult; actual: number; reason: 'finesse' | 'target' } | null = null;
  events: { frame: number; type: string; data: unknown }[] = [];
  placements: Placement[] = [];
  clears: Record<string, number> = {};
  maxCombo = 0;
  maxB2B = 0;
  practice: { set: PracticeSet; index: number; restarts: number } | null = null;
  demonstration: Demonstration | null = null;
  private timerFrames = 0;
  private checkpoint: Checkpoint;
  private undoStack: Checkpoint[] = [];
  private resumeStatus: 'playing' | 'countdown' = 'playing';
  private pieceInputs: Game.Key[] = [];
  private frameKeyOffset = 0;
  private locking: { target: Cell[]; rotation: number; inputs: Game.Key[]; keyOffset: number; checkpoint: Checkpoint } | null = null;
  private rollback: Checkpoint | null = null;
  private nextScene: number | null = null;

  constructor(settings: Settings = defaults, seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1, practice?: PracticeSet) {
    this.settings = structuredClone(settings);
    this.seed = seed;
    this.engine = createEngine(this.settings, seed);
    this.checkpoint = this.capture();
    this.engine.events.on('falling.lock.pre', () => {
      this.locking = { target: this.engine.falling.absoluteBlocks, rotation: this.engine.falling.rotation, inputs: this.pieceInputs, keyOffset: this.frameKeyOffset, checkpoint: this.checkpoint };
    });
    this.engine.events.on('falling.new', ({ isHold }) => {
      this.pieceInputs = [];
      this.frameKeyOffset = this.engine.resCache.keys.length;
      if (isHold) { this.holds++; this.checkpoint = this.capture(); }
    });
    this.engine.events.on('falling.lock', res => this.locked(res));
    if (practice) {
      if (!practice.scenes.length) throw new Error('This replay has no finesse faults to practice.');
      this.practice = { set: structuredClone(practice), index: 0, restarts: 0 };
      this.loadScene(0);
    }
  }

  start() {
    if (this.status !== 'ready') return;
    this.startedAt = new Date().toISOString();
    this.countdownFrames = Math.round(this.settings.training.countdownSeconds * 60);
    this.status = this.countdownFrames > 0 ? 'countdown' : 'playing';
    this.events.push({ frame: this.engine.frame, type: 'start', data: { countdownSeconds: this.settings.training.countdownSeconds } });
  }

  get elapsedMs() { return this.timerFrames * 1000 / 60; }
  get active() { return this.status === 'playing' || this.status === 'countdown'; }
  get target() { return this.practice?.set.scenes[this.practice.index]?.target ?? this.fault?.target ?? null; }
  get canUndo() { return this.settings.training.undoEnabled && !this.practice && this.undoStack.length > 0 && !['ready', 'countdown'].includes(this.status); }

  private capture(): Checkpoint {
    return { snapshot: this.engine.snapshot({ isUndoRedo: true }), timerFrames: this.timerFrames, perfects: this.perfects, holds: this.holds, clears: { ...this.clears }, maxCombo: this.maxCombo, maxB2B: this.maxB2B };
  }

  private restore(checkpoint: Checkpoint) {
    this.engine.fromSnapshot(checkpoint.snapshot);
    this.timerFrames = checkpoint.timerFrames;
    this.perfects = checkpoint.perfects;
    this.holds = checkpoint.holds;
    this.clears = { ...checkpoint.clears };
    this.maxCombo = checkpoint.maxCombo;
    this.maxB2B = checkpoint.maxB2B;
    this.pieceInputs = [];
    this.frameKeyOffset = 0;
    this.engine.resCache.keys = [];
    this.engine.resCache.lastLock = this.engine.frame;
    this.locking = null;
    this.releaseAll();
    this.checkpoint = this.capture();
  }

  private loadScene(index: number) {
    const practice = this.practice!;
    practice.index = index;
    const snapshot = structuredClone(practice.set.scenes[index].snapshot);
    snapshot.__meta.isUndoRedo = true;
    this.restore({ ...this.capture(), snapshot });
    this.fault = null;
    this.undoStack = [];
    this.events.push({ frame: this.engine.frame, type: 'practice-scene', data: { index, timeMs: this.elapsedMs, snapshot } });
  }

  step() {
    if (this.status === 'countdown') {
      this.input.reset();
      if (--this.countdownFrames <= 0) { this.countdownFrames = 0; this.status = 'playing'; }
      return;
    }
    if (this.status !== 'playing') return;
    const holdBlocked = !!this.practice || (!!this.fault && !this.settings.training.allowDifferentTarget);
    const frames = this.input.drain(this.engine.frame).filter(frame => !holdBlocked || !('key' in frame.data && frame.data.key === 'hold'));
    this.inputs += frames.filter(frame => frame.type === 'keydown').length;
    this.events.push(...frames.map(frame => ({ frame: frame.frame, type: frame.type, data: frame.data })));
    this.timerFrames++;
    const result = this.engine.tick(frames);
    this.pieceInputs.push(...result.keys.slice(this.frameKeyOffset));
    this.frameKeyOffset = 0;
    if (this.rollback) {
      const checkpoint = this.rollback;
      this.rollback = null;
      const fromTimeMs = this.elapsedMs;
      this.restore(checkpoint);
      this.events.push({ frame: this.engine.frame, type: 'retry', data: { target: this.fault?.target, snapshot: checkpoint.snapshot, fromTimeMs, timeMs: this.elapsedMs } });
    }
    if (this.nextScene !== null) {
      const index = this.nextScene; this.nextScene = null;
      if (index >= this.practice!.set.scenes.length) { this.practice!.index = index; this.status = 'complete'; this.releaseAll(); }
      else this.loadScene(index);
    }
    if (!this.practice && this.engine.stats.lines >= 40) this.status = 'complete';
    else if (this.engine.toppedOut) this.status = 'topout';
  }

  private locked(result: LockRes) {
    const locking = this.locking; this.locking = null;
    if (this.rollback || this.nextScene !== null || !locking) return;
    const snapshot = locking.checkpoint.snapshot;
    const inputs = [...locking.inputs, ...result.keysPresses.slice(locking.keyOffset)];
    const actual = countFinesseInputs(inputs);
    const enabled = this.settings.training.finesseEnabled || !!this.practice;
    const finesse = enabled ? findFinesse(this.engine, snapshot, locking.target) : null;
    const inefficient = !!finesse && actual > finesse.cost;
    const requiredTarget = this.practice?.set.scenes[this.practice.index]?.target ?? (!this.settings.training.allowDifferentTarget ? this.fault?.target : null);
    const wrongTarget = !!requiredTarget && !sameCells(requiredTarget, locking.target);
    const reason = inefficient ? 'finesse' : wrongTarget ? 'target' : null;
    this.placements.push({ frame: this.engine.frame, timeMs: this.elapsedMs, piece: result.mino, cells: locking.target, rotation: locking.rotation, result: structuredClone(result), snapshot: structuredClone(snapshot), board: structuredClone(snapshot.board), hold: snapshot.hold, next: snapshot.queue.value.slice(0, 5), accepted: reason === null, reason, finesse, finesseInputs: actual, inputs });
    if (reason) {
      const target = requiredTarget ?? locking.target;
      const path = sameCells(target, locking.target) ? finesse : findFinesse(this.engine, snapshot, target);
      if (reason === 'finesse') this.faults++; else this.targetMisses++;
      if (path) this.fault = { target, path, actual, reason };
      this.rollback = locking.checkpoint;
      if (this.practice && reason === 'finesse' && finesse) {
        this.demonstration = { id: `fault-${this.faults}`, serial: this.faults, sceneNumber: this.practice.index + 1, snapshot: structuredClone(snapshot), target: locking.target, path: finesse };
        if (this.settings.training.strictPractice) {
          this.practice.restarts++;
          this.rollback = { ...locking.checkpoint, timerFrames: 0, perfects: 0, holds: 0, clears: {}, maxCombo: 0, maxB2B: 0 };
          this.nextScene = 0;
        }
      }
    } else {
      this.undoStack.push(locking.checkpoint);
      if (enabled) { if (finesse) this.perfects++; else this.unverified++; }
      this.fault = null;
      const name = result.spin !== 'none' ? `${result.spin === 'mini' ? 'mini-' : ''}tspin-${result.lines}` : ['none', 'single', 'double', 'triple', 'quad'][result.lines] || `clear-${result.lines}`;
      this.clears[name] = (this.clears[name] || 0) + 1;
      if (this.engine.board.perfectClear && result.lines) this.clears.pc = (this.clears.pc || 0) + 1;
      this.maxCombo = Math.max(this.maxCombo, this.engine.stats.combo);
      this.maxB2B = Math.max(this.maxB2B, this.engine.stats.b2b);
      this.checkpoint = this.capture();
      if (this.practice) this.nextScene = this.practice.index + 1;
    }
  }

  undo() {
    if (!this.canUndo) return false;
    this.restore(this.undoStack.pop()!);
    this.rollback = null; this.fault = null;
    if (this.status !== 'paused') this.status = 'playing';
    this.events.push({ frame: this.engine.frame, type: 'undo', data: { snapshot: this.checkpoint.snapshot, timeMs: this.elapsedMs } });
    return true;
  }

  pause() {
    if (!this.active) return;
    this.resumeStatus = this.status as 'playing' | 'countdown';
    this.status = 'paused'; this.releaseAll();
    this.events.push({ frame: this.engine.frame, type: 'pause', data: { phase: this.resumeStatus } });
  }
  resume() { if (this.status === 'paused') this.status = this.resumeStatus; }

  releaseAll() {
    this.input.reset();
    const input = this.engine.input;
    input.lShift.held = input.rShift.held = false;
    input.lShift.das = input.rShift.das = input.lShift.arr = input.rShift.arr = 0;
    for (const key of Object.keys(input.keys) as (keyof typeof input.keys)[]) input.keys[key] = false;
    this.events.push({ frame: this.engine.frame, type: 'release-all', data: {} });
  }

  export() {
    return { version: 1, mode: this.practice ? 'fault-practice' : '40l-finesse', seed: this.seed, startedAt: this.startedAt, savedAt: new Date().toISOString(), settings: this.settings, engineVersion: '4.2.7', finesseRules, status: this.status, events: this.events, placements: this.placements, practice: this.practice ? { name: this.practice.set.name, completed: this.practice.index, total: this.practice.set.scenes.length, restarts: this.practice.restarts } : null, result: { timeMs: this.elapsedMs, sessionTimeMs: this.engine.frame * 1000 / 60, inputs: this.inputs, holds: this.holds, faults: this.faults, targetMisses: this.targetMisses, perfects: this.perfects, unverified: this.unverified, clears: this.clears, maxCombo: this.maxCombo, maxB2B: this.maxB2B, ...this.engine.stats } };
  }
}
