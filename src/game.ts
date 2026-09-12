import { type Engine, type EngineSnapshot, type LockRes } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { createEngine, spawnSnapshot } from './engine';
import { FrameInput } from './input';
import { countFinesseInputs, findFinesse, type Cell, type FinesseResult } from './finesse';
import { finesseRules } from './finesse-data';
import { sameCells, type Demonstration, type PracticeSet } from './practice';
import { defaults, type Settings } from './settings';
import { applyDasPrecharge, DasPrecharge, type DasCharge } from './das-precharge';
import { applyModeSetup, exportPreset, modeDefinitions, reachedGoal, type ModeId, type ModeRules } from './modes';
import { RoomRuntime, type RoomState } from './room-runtime';
import { replayTimeline } from './timeline';

type Checkpoint = { snapshot: EngineSnapshot; room: RoomState; timerFrames: number; perfects: number; holds: number; clears: Record<string, number>; maxCombo: number; maxB2B: number; eventCount: number; placementCount: number };
type Placement = { frame: number; endFrame: number; timeMs: number; piece: string; cells: Cell[]; rotation: number; result: LockRes; snapshot: EngineSnapshot; room: RoomState; board: unknown; hold: unknown; next: string[]; accepted: boolean; reason: 'finesse' | 'target' | null; finesse: FinesseResult | null; finesseInputs: number; inputs: Game.Key[] };

export class TrainerGame {
  engine: Engine;
  settings: Settings;
  rules: ModeRules;
  room: RoomRuntime;
  boardResets = 0;
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
  waitingForInput = false;
  thinking = false;
  fault: { target: Cell[]; path: FinesseResult; actual: number; reason: 'finesse' | 'target' } | null = null;
  events: { frame: number; type: string; data: unknown }[] = [];
  placements: Placement[] = [];
  clears: Record<string, number> = {};
  maxCombo = 0;
  maxB2B = 0;
  practice: { set: PracticeSet; index: number; restarts: number; completed: number } | null = null;
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
  private precharge = new DasPrecharge();
  private bufferedCharge: DasCharge | null = null;
  private stepping: { frame: number; start: number; events: Game.Replay.Frame[]; consumed: number } | null = null;

  constructor(settings: Settings = defaults, seed?: number, practice?: PracticeSet, mode: ModeId = 'sprint') {
    this.settings = structuredClone(settings);
    if (practice?.customRules) this.settings.custom = structuredClone(practice.customRules);
    this.rules = modeDefinitions[practice ? practice.customRules ? 'custom' : 'sprint' : mode].rules(this.settings);
    if (practice) { this.rules.finesse = practice.finesseEnabled ?? this.settings.training.practiceFinesseEnabled; this.settings.training.practiceFinesseEnabled = this.rules.finesse; this.rules.allow180 = practice.allow180 ?? this.rules.allow180; }
    this.seed = seed ?? (mode === 'custom' && !practice && settings.custom.seed ? settings.custom.seed : crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1);
    this.engine = createEngine(this.settings, this.seed, this.rules);
    this.settings.handling = { ...this.engine.handling };
    this.room = new RoomRuntime(this.engine, this.rules, !!practice, this.seed);
    applyModeSetup(this.engine, this.rules, this.seed);
    this.room.refill();
    this.checkpoint = this.capture();
    this.engine.events.on('falling.lock.pre', () => {
      this.locking = { target: this.engine.falling.absoluteBlocks, rotation: this.engine.falling.rotation, inputs: this.pieceInputs, keyOffset: this.frameKeyOffset, checkpoint: this.checkpoint };
    });
    this.engine.events.on('falling.new', ({ isHold }) => {
      if (!this.room.waking || isHold) this.pieceInputs = [];
      this.frameKeyOffset = this.engine.resCache.keys.length;
      if (isHold) { this.holds++; this.checkpoint = this.capture(); }
    });
    this.engine.events.on('falling.lock', res => this.locked(res));
    if (practice) {
      if (!practice.scenes.length) throw new Error('This replay has no finesse faults to practice.');
      this.practice = { set: structuredClone(practice), index: 0, restarts: 0, completed: 0 };
      this.loadScene(0);
    }
  }

  start() {
    if (this.status !== 'ready') return;
    this.startedAt = new Date().toISOString();
    this.countdownFrames = Math.round(this.settings.training.countdownSeconds * 60);
    this.status = this.countdownFrames > 0 ? 'countdown' : 'playing';
    this.thinking = this.settings.training.justThink && this.settings.training.thinkStyle === 'piece';
    this.events.push({ frame: this.engine.frame, type: 'start', data: { countdownSeconds: this.settings.training.countdownSeconds } });
  }

  get elapsedMs() { return this.timerFrames * 1000 / 60; }
  get active() { return this.status === 'playing' || this.status === 'countdown'; }
  get thinkingPaused() { return this.settings.training.justThink && (this.settings.training.thinkStyle === 'piece' ? this.thinking : !this.input.activeKeys.length); }
  get target() { return this.practice?.set.scenes[this.practice.index]?.target ?? this.fault?.target ?? null; }
  get canUndo() { return this.rules.undo && !this.practice && this.undoStack.length > 0 && !['ready', 'countdown'].includes(this.status); }
  get canEditField() { return this.rules.id === 'custom' && !this.practice && ['playing', 'paused'].includes(this.status); }

  private capture(): Checkpoint {
    let eventCount = this.events.length;
    if (this.stepping && this.engine.frame === this.stepping.frame) {
      let keys = this.stepping.consumed + this.engine.resCache.keys.length;
      eventCount = this.stepping.start;
      for (const event of this.stepping.events) {
        if (keys <= 0) break;
        eventCount++;
        if (event.type === 'keydown') keys--;
      }
    }
    return { snapshot: this.engine.snapshot({ isUndoRedo: true }), room: structuredClone(this.room.state), timerFrames: this.timerFrames, perfects: this.perfects, holds: this.holds, clears: { ...this.clears }, maxCombo: this.maxCombo, maxB2B: this.maxB2B, eventCount, placementCount: this.placements.length };
  }

  private restore(checkpoint: Checkpoint) {
    this.engine.fromSnapshot(checkpoint.snapshot);
    this.timerFrames = checkpoint.timerFrames;
    this.room.restore(checkpoint.room, this.timerFrames, checkpoint.snapshot.frame);
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
    this.checkpoint = { ...this.capture(), eventCount: checkpoint.eventCount, placementCount: checkpoint.placementCount };
  }

  private loadScene(index: number) {
    const practice = this.practice!;
    practice.index = index;
    const snapshot = structuredClone(practice.set.scenes[index].snapshot);
    snapshot.__meta.isUndoRedo = true;
    this.restore({ ...this.capture(), snapshot });
    this.fault = null;
    this.undoStack = [];
    this.events.push({ frame: this.engine.frame, type: 'practice-scene', data: { index, timeMs: this.elapsedMs, snapshot, target: practice.set.scenes[index].target } });
  }

  step() {
    if (this.status === 'countdown') {
      this.precharge.tick(this.input.drain(this.engine.frame), this.settings.handling);
      if (--this.countdownFrames <= 0) {
        this.countdownFrames = 0; this.status = 'playing'; this.bufferedCharge = this.precharge.take();
      }
      return;
    }
    if (this.status !== 'playing') return;
    const holdBlocked = !this.rules.hold || (!!this.practice && !this.practice.set.allowHold) || (!!this.fault && !this.settings.training.allowDifferentTarget);
    const frames = this.input.drain(this.engine.frame).filter(frame => !holdBlocked || !('key' in frame.data && frame.data.key === 'hold'));
    if (this.waitingForInput || this.thinking) {
      const trigger = frames.find(frame => frame.type === 'keydown' && (frame.data.key !== 'hardDrop' || this.rules.advanced.hardDrop) && (frame.data.key !== 'rotate180' || this.rules.allow180));
      if (!trigger || trigger.type !== 'keydown') return;
      this.waitingForInput = false;
      this.thinking = false;
      this.events.push({ frame: this.engine.frame, type: 'input-resume', data: { key: trigger.data.key, timeMs: this.elapsedMs } });
    }
    if (this.settings.training.justThink && this.settings.training.thinkStyle === 'input' && !frames.length && !this.input.activeKeys.some(key => (key !== 'hold' || !holdBlocked) && (key !== 'rotate180' || this.rules.allow180) && (key !== 'hardDrop' || this.rules.advanced.hardDrop))) return;
    const received = this.room.beforeTick(this.timerFrames);
    if (received) this.events.push({ frame: this.engine.frame, type: 'solo-garbage', data: { amount: received, timeMs: this.elapsedMs } });
    if (this.bufferedCharge) {
      const charge = this.bufferedCharge; this.bufferedCharge = null;
      const inputs = applyDasPrecharge(this.engine, charge);
      this.pieceInputs.push(...inputs); this.inputs += inputs.length;
      this.events.push({ frame: this.engine.frame, type: 'das-precharge', data: { charge: structuredClone(charge), inputs } });
    }
    this.inputs += frames.filter(frame => frame.type === 'keydown').length;
    this.stepping = { frame: this.engine.frame, start: this.events.length, events: frames, consumed: 0 };
    this.events.push(...frames.map(frame => ({ frame: frame.frame, type: frame.type, data: frame.data })));
    this.timerFrames++;
    const result = this.engine.tick(frames);
    this.stepping = null;
    this.pieceInputs.push(...result.keys.slice(this.frameKeyOffset));
    this.frameKeyOffset = 0;
    if (this.thinking) this.releaseAll();
    if (this.rollback) {
      const checkpoint = this.rollback;
      this.rollback = null;
      const fromTimeMs = this.elapsedMs;
      this.restore(checkpoint);
      this.waitingForInput = true;
      this.events.push({ frame: this.engine.frame, type: 'retry', data: { target: this.fault?.target, snapshot: this.checkpoint.snapshot, room: this.checkpoint.room, fromTimeMs, timeMs: this.elapsedMs, eventCount: this.checkpoint.eventCount, placementCount: this.checkpoint.placementCount, waitingForInput: true } });
    }
    if (this.nextScene !== null) {
      const index = this.nextScene; this.nextScene = null;
      if (index >= this.practice!.set.scenes.length) { this.practice!.index = index; this.status = 'complete'; this.releaseAll(); }
      else this.loadScene(index);
    }
    if (!this.practice && reachedGoal(this.rules, this.engine.stats, this.elapsedMs)) { this.status = 'complete'; this.releaseAll(); }
    else if (this.engine.toppedOut) {
      if (!this.practice && this.rules.topout === 'clear') this.clearField(false);
      else { this.status = 'topout'; this.releaseAll(); }
    }
  }

  private locked(result: LockRes) {
    if (this.stepping) this.stepping.consumed += result.keysPresses.length;
    const locking = this.locking; this.locking = null;
    if (this.rollback || this.nextScene !== null || !locking) return;
    const snapshot = locking.checkpoint.snapshot;
    const inputs = [...locking.inputs, ...result.keysPresses.slice(locking.keyOffset)];
    const actual = countFinesseInputs(inputs);
    const enabled = this.rules.finesse;
    const finesse = enabled ? findFinesse(this.engine, snapshot, locking.target) : null;
    const inefficient = !!finesse && actual > finesse.cost;
    const requiredTarget = this.practice?.set.scenes[this.practice.index]?.target ?? (!this.settings.training.allowDifferentTarget ? this.fault?.target : null);
    const wrongTarget = !!requiredTarget && !sameCells(requiredTarget, locking.target);
    const reason = inefficient ? 'finesse' : wrongTarget ? 'target' : null;
    this.placements.push({ frame: this.engine.frame, endFrame: this.stepping ? this.stepping.frame + 1 : this.engine.frame, timeMs: this.elapsedMs, piece: result.mino, cells: locking.target, rotation: locking.rotation, result: structuredClone(result), snapshot: structuredClone(snapshot), room: structuredClone(locking.checkpoint.room), board: structuredClone(snapshot.board), hold: snapshot.hold, next: snapshot.queue.value.slice(0, this.rules.nextCount), accepted: reason === null, reason, finesse, finesseInputs: actual, inputs });
    if (reason) {
      const target = requiredTarget ?? locking.target;
      const path = sameCells(target, locking.target) ? finesse : findFinesse(this.engine, snapshot, target);
      if (reason === 'finesse') this.faults++; else this.targetMisses++;
      if (path) this.fault = { target, path, actual, reason };
      this.rollback = locking.checkpoint;
      if (reason === 'finesse' && finesse) {
        this.demonstration = { id: `fault-${this.faults}`, serial: this.faults, sceneNumber: this.practice ? this.practice.index + 1 : this.engine.stats.pieces, snapshot: structuredClone(snapshot), target: locking.target, path: finesse };
        if (this.practice && this.settings.training.strictPractice) {
          this.practice.restarts++; this.practice.completed = 0;
          this.rollback = { ...locking.checkpoint, timerFrames: 0, perfects: 0, holds: 0, clears: {}, maxCombo: 0, maxB2B: 0 };
          this.nextScene = 0;
        }
      }
    } else {
      this.undoStack.push(locking.checkpoint);
      if (enabled) { if (finesse) this.perfects++; else this.unverified++; }
      this.fault = null;
      const name = result.spin !== 'none' ? `${result.spin === 'mini' ? 'mini-' : ''}${result.mino}spin-${result.lines}` : ['none', 'single', 'double', 'triple', 'quad'][result.lines] || `clear-${result.lines}`;
      this.clears[name] = (this.clears[name] || 0) + 1;
      if (this.engine.board.perfectClear && result.lines) this.clears.pc = (this.clears.pc || 0) + 1;
      this.maxCombo = Math.max(this.maxCombo, this.engine.stats.combo);
      this.maxB2B = Math.max(this.maxB2B, this.engine.stats.b2b);
      this.room.locked(result);
      const refilled = this.room.refill();
      if (refilled) this.events.push({ frame: this.engine.frame, type: 'garbage-refill', data: { amount: refilled, timeMs: this.elapsedMs, room: structuredClone(this.room.state) } });
      this.checkpoint = this.capture();
      if (this.practice) {
        this.practice.completed++;
        this.nextScene = this.practice.set.loop ? (this.practice.index + 1) % this.practice.set.scenes.length : this.practice.index + 1;
      }
      this.thinking = this.settings.training.justThink && this.settings.training.thinkStyle === 'piece';
    }
  }

  undo() {
    if (!this.canUndo) return false;
    this.restore(this.undoStack.pop()!);
    this.waitingForInput = true;
    this.rollback = null; this.fault = null;
    if (this.status !== 'paused') this.status = 'playing';
    this.events.push({ frame: this.engine.frame, type: 'undo', data: { snapshot: this.checkpoint.snapshot, room: this.checkpoint.room, timeMs: this.elapsedMs, eventCount: this.checkpoint.eventCount, placementCount: this.checkpoint.placementCount, waitingForInput: true } });
    return true;
  }

  setFinesseEnabled(enabled: boolean) {
    this.rules.finesse = enabled;
    if (this.practice) { this.settings.training.practiceFinesseEnabled = enabled; this.practice.set.finesseEnabled = enabled; }
    else if (this.rules.id === 'custom') this.settings.custom.finesse = enabled;
    else this.settings.training.finesseEnabled = enabled;
    if (!enabled) { this.fault = null; this.demonstration = null; }
    this.releaseAll();
    this.events.push({ frame: this.engine.frame, type: 'finesse-setting', data: { enabled, timeMs: this.elapsedMs } });
  }

  setJustThink(enabled: boolean, style: 'piece' | 'input') {
    this.settings.training.justThink = enabled; this.settings.training.thinkStyle = style;
    this.thinking = enabled && style === 'piece';
    this.releaseAll();
    this.events.push({ frame: this.engine.frame, type: 'just-think', data: { enabled, style, timeMs: this.elapsedMs } });
  }

  clearField(manual = true) {
    if (!this.canEditField) return false;
    if (manual) this.undoStack.push(this.capture());
    const snapshot = this.engine.snapshot({ isUndoRedo: true });
    snapshot.board = snapshot.board.map(row => row.map(() => null));
    snapshot.falling = spawnSnapshot(this.engine, snapshot.falling.symbol);
    snapshot.holdLocked = false;
    snapshot.state = 0;
    snapshot.glock = 0;
    snapshot.lastSpin = null;
    snapshot.lastWasClear = false;
    snapshot.stats.combo = -1;
    snapshot.stats.b2b = -1;
    this.restore({ ...this.capture(), snapshot, room: { ...this.room.state, delay: 0, wake: false } });
    this.room.refill();
    this.checkpoint = this.capture();
    this.fault = null; this.rollback = null; this.boardResets++;
    this.events.push({ frame: this.engine.frame, type: 'clear-field', data: { manual, snapshot: this.checkpoint.snapshot, room: this.checkpoint.room, timeMs: this.elapsedMs } });
    return true;
  }

  finish() {
    if (!this.canEditField && !(this.practice && ['playing', 'paused'].includes(this.status))) return false;
    this.status = 'complete'; this.releaseAll();
    this.events.push({ frame: this.engine.frame, type: 'finish', data: { timeMs: this.elapsedMs } });
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
    this.precharge.reset(); this.bufferedCharge = null;
    const input = this.engine.input;
    this.engine.falling.irs = 0;
    this.engine.state &= ~1024;
    input.lShift.held = input.rShift.held = false;
    input.lShift.das = input.rShift.das = input.lShift.arr = input.rShift.arr = 0;
    for (const key of Object.keys(input.keys) as (keyof typeof input.keys)[]) input.keys[key] = false;
    this.events.push({ frame: this.engine.frame, type: 'release-all', data: {} });
  }

  export() {
    const timeline = replayTimeline({ events: this.events, placements: this.placements, result: { sessionTimeMs: this.engine.frame * 1000 / 60 } });
    return { version: 1, mode: this.practice ? 'fault-practice' : this.rules.id === 'custom' ? 'custom' : '40l-finesse', modeRules: this.rules, presetSource: this.rules.sourcePreset ? exportPreset(this.settings.custom).source : null, runtime: { room: structuredClone(this.room.state), timerFrames: this.timerFrames, waitingForInput: this.waitingForInput, thinking: this.thinking, justThink: this.settings.training.justThink, thinkStyle: this.settings.training.thinkStyle }, finalSnapshot: this.engine.snapshot({ isUndoRedo: true }), seed: this.seed, startedAt: this.startedAt, savedAt: new Date().toISOString(), settings: this.settings, engineVersion: '4.2.7', finesseRules, status: this.status, timeline: { version: 1, frames: timeline.frames }, events: timeline.events, placements: this.placements, practice: this.practice ? { name: this.practice.set.name, completed: this.practice.completed, kind: this.practice.set.kind, loop: this.practice.set.loop, total: this.practice.set.scenes.length, restarts: this.practice.restarts } : null, result: { timeMs: this.elapsedMs, sessionTimeMs: this.engine.frame * 1000 / 60, inputs: this.inputs, holds: this.holds, faults: this.faults, targetMisses: this.targetMisses, perfects: this.perfects, unverified: this.unverified, clears: this.clears, maxCombo: this.maxCombo, maxB2B: this.maxB2B, boardResets: this.boardResets, ...this.engine.stats } };
  }
}
