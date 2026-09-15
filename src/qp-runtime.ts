import type { Engine, EngineSnapshot, LockRes, Mino, Tile } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import { modeDefinitions, type ModeRules } from './modes';
import type { GameAction, Settings } from './settings';
import { ZenithBag, qpEngineState, applyQpEngineState, type QpEngineState } from './qp-engine';
import { awardClimb, initialClimb, tickClimb, type QpMod } from './qp-rules';
import { acceptPressure, cancelGarbage, initialGarbage, initialPressure, pressurePackets, randomStep, ruleRandom, updateGarbage, type GarbageState, type PressureState } from './qp-pressure';
import { qpGarbageHole, qpMessiness } from './qp-garbage-pattern';
import { drawReviveTasks, drawSelectedReviveTasks, initialRevive, reviveAttack, reviveClock, reviveHold, reviveInput, revivePlacement, reviveRotate, type ReviveState } from './revive-tasks';
import { placementEvidence, botStateKey, pacedBotOperation, type BotStep, type BotPlan } from './qp-bot';
import { planQpBot, trialQpOperation } from './qp-search';
import { sameCells } from './practice';
import { qpAttack } from './qp-attack';
import { garbageSize, garbageWarning, packetCues } from './qp-feedback';
import { placementSounds } from './sound-events';
import { initialQpModState, qpClearRows, qpDuplicateClear, qpHealWounds, qpInsertVisualRow, qpInsertionRow, type QpModState } from './qp-mod-state';

export const playableQpMods: QpMod[] = ['duo', 'nohold', 'volatile', 'expert', 'gravity', 'messy', 'doublehole', 'invisible', 'allspin', 'gravity_reversed'];
export type QpSide = {
  engine: Engine; settings: Settings; rules: ModeRules; mods: QpMod[]; garbage: GarbageState; pressure: PressureState;
  life: 'alive' | 'down' | 'reviving'; downAt: number | null; reviveAt: number | null; task: ReviveState | null;
  revives: number; deaths: number; contribution: number; plan: BotPlan | null; nextPlan: number; heldPiece: boolean;
  moves: string[]; gravityBonus: number; lockedGravityUntil: number; locking: { falling: EngineSnapshot['falling']; cells: [number, number][]; held: boolean; moved: boolean; moves: string[]; hold: Mino | null } | null;
  clear: { lines: number; garbageCleared: number; stats: EngineSnapshot['stats']; perfectClear: boolean } | null; report: LockRes | null;
  modState: QpModState; practiceTopout: boolean; lockFrames: number[]; nextSteps: BotStep[];
  feedback: { alert: boolean; siren: number; windupAt: number; windupPortions: number };
};
export type QpEvent = { frame: number; side: number; type: string; data: unknown };
export type QpCheckpoint = {
  settings: Settings; seed: number; frame: number; over: boolean; stopped?: boolean; rng: number; nextTrigger: number; triggers: number;
  climb: ReturnType<typeof initialClimb>; scheduled: QpEvent[]; events: QpEvent[]; completed: QuickPlayRuntime['completed'];
  sides: { engine: QpEngineState; state: Omit<QpSide, 'engine' | 'settings' | 'rules' | 'mods'> }[];
};
export function copyQpSettings(settings: Settings) {
  const tape = settings.quickplay.pressure.tape;
  const copy = structuredClone({ ...settings, quickplay: { ...settings.quickplay, pressure: { ...settings.quickplay.pressure, tape: null } } }) as Settings;
  copy.quickplay.pressure.tape = tape;
  return copy;
}
export function copyQpCheckpoint(checkpoint: QpCheckpoint): QpCheckpoint {
  const { settings, ...state } = checkpoint;
  return { ...structuredClone(state), settings: copyQpSettings(settings) };
}
export class QuickPlayRuntime {
  readonly climb;
  readonly sides: QpSide[];
  events: QpEvent[] = [];
  frame = 0;
  over = false;
  stopped = false;
  rng: number;
  nextTrigger: number;
  triggers = 0;
  private scheduled: QpEvent[] = [];
  botPlanner: ((runtime: QuickPlayRuntime) => BotPlan | null) | null = null;
  completed: { frame: number; side: number; tasks: ReviveState }[] = [];

  constructor(readonly settings: Settings, readonly seed: number, engine: Engine) {
    for (const mod of [...settings.quickplay.profile.mods, ...settings.quickplay.profile.allyMods]) if (!playableQpMods.includes(mod)) throw new Error(`${mod} is still being adapted for local Quick Play.`);
    this.climb = initialClimb(settings.quickplay.profile.mods); this.rng = seed ^ 0x372f15;
    this.nextTrigger = Math.round(settings.quickplay.triggerSeconds * 60);
    this.sides = [this.makeSide(engine, settings, seed)];
    if (settings.quickplay.profile.mods.includes('duo')) {
      const ally = copyQpSettings(settings); ally.quickplay.profile = { mods: settings.quickplay.profile.allyMods, allyMods: settings.quickplay.profile.mods };
      const rules = modeDefinitions.zenith.rules(ally);
      this.sides.push(this.makeSide(createEngine(ally, seed ^ 0x4b21, rules), ally, seed ^ 0x4b21));
    }
    this.sides.forEach((side, index) => this.attach(side, index));
  }
  checkpoint(history = false): QpCheckpoint {
    return copyQpCheckpoint({ settings: this.settings, seed: this.seed, frame: this.frame, over: this.over, stopped: this.stopped, rng: this.rng, nextTrigger: this.nextTrigger, triggers: this.triggers, climb: this.climb, scheduled: this.scheduled, events: history ? this.events : [], completed: history ? this.completed : [], sides: this.sides.map(({ engine, settings, rules, mods, ...state }) => ({ engine: qpEngineState(engine), state })) });
  }
  static fromCheckpoint(checkpoint: QpCheckpoint) {
    const settings = copyQpSettings(checkpoint.settings), runtime = new QuickPlayRuntime(settings, checkpoint.seed, createEngine(settings, checkpoint.seed, modeDefinitions.zenith.rules(settings)));
    runtime.initializeScene(checkpoint);
    return runtime;
  }
  initializeScene(checkpoint: QpCheckpoint) {
    if (this.frame !== 0 || this.events.length) throw new Error('A scene can only initialize a new run.');
    if (this.seed !== checkpoint.seed || JSON.stringify(this.settings.quickplay.profile) !== JSON.stringify(checkpoint.settings.quickplay.profile) || this.sides.length !== checkpoint.sides.length) throw new Error('Scene seed and rules must match the new run.');
    const saved = copyQpCheckpoint(checkpoint), runtime = this;
    runtime.frame = saved.frame; runtime.over = saved.over; runtime.stopped = saved.stopped ?? false; runtime.rng = saved.rng; runtime.nextTrigger = saved.nextTrigger; runtime.triggers = saved.triggers;
    Object.assign(runtime.climb, saved.climb); runtime.scheduled = saved.scheduled; runtime.events = saved.events; runtime.completed = saved.completed;
    runtime.sides.forEach((side, index) => {
      Object.assign(side, saved.sides[index].state); applyQpEngineState(side.engine, saved.sides[index].engine); runtime.trackRotations(side, false);
    });
  }
  private makeSide(engine: Engine, settings: Settings, seed: number): QpSide {
    return { engine, settings, rules: modeDefinitions.zenith.rules(settings), mods: settings.quickplay.profile.mods, garbage: initialGarbage(seed), pressure: initialPressure(seed ^ 0x751afe),
      life: 'alive', downAt: null, reviveAt: null, task: null, revives: 0, deaths: 0, contribution: 0, plan: null, nextPlan: 0, heldPiece: false, moves: [], gravityBonus: 0, lockedGravityUntil: 240, locking: null, clear: null, report: null, modState: initialQpModState(engine.board.state), practiceTopout: false, lockFrames: [], nextSteps: [], feedback: { alert: false, siren: 0, windupAt: -1000, windupPortions: 0 } };
  }
  private attach(side: QpSide, index: number) {
    const engine = side.engine;
    (engine.queue.bag as ZenithBag).cancelStreak = () => side.garbage.cancelStreak;
    const clear = engine.board.clearBombsAndLines.bind(engine.board);
    engine.board.clearBombsAndLines = cells => {
      qpClearRows(side.modState, engine.board.state, cells, this.frame);
      const stats = structuredClone(engine.stats), result = clear(cells);
      side.clear = { ...result, stats, perfectClear: engine.board.perfectClear }; return result;
    };
    engine.events.on('falling.new', ({ isHold }) => {
      side.heldPiece = isHold; side.moves = [];
      if (isHold && index === 1) this.cue('hold', index);
      if (isHold && side.task) reviveHold(side.task);
      this.trackRotations(side);
    });
    this.trackRotations(side);
    engine.events.on('falling.lock.pre', () => {
      side.locking = { falling: engine.falling.snapshot(), cells: engine.falling.absoluteBlocks, held: side.heldPiece, moved: !!(engine.state & 8192), moves: [...side.moves], hold: engine.held };
      const clear = side.clear;
      if (!clear) return;
      const original = engine.stats.garbage.attack - clear.stats.garbage.attack;
      const surge = clear.lines && engine.stats.b2b < 0 && clear.stats.b2b + 1 > 4 ? clear.stats.b2b - 3 + (side.mods.includes('allspin_reversed') ? 3 : 0) : 0;
      const result: LockRes = { mino: engine.falling.symbol, lines: clear.lines, garbageCleared: clear.garbageCleared, spin: engine.lastSpin ?? 'none', stats: structuredClone(engine.stats), rawGarbage: [original], garbage: [original], surge, garbageAdded: false, topout: false, keysPresses: [], pieceTime: 0 };
      this.locked(side, index, result); side.report = result;
    });
    engine.events.on('falling.lock', result => {
      if (side.report) { result.rawGarbage = side.report.rawGarbage; result.garbage = side.report.garbage; result.stats.garbage = structuredClone(engine.stats.garbage); side.report = null; }
      if (index === 1) for (const name of placementSounds(engine, result, result.keysPresses.includes('hardDrop'))) this.cue(name, index);
      side.clear = null;
    });
  }
  private trackRotations(side: QpSide, initial = true) {
    const piece = side.engine.falling, descriptor = Object.getOwnPropertyDescriptor(piece, 'totalRotations');
    let rotations = piece.totalRotations, rotation = piece.rotation;
    const record = (count: number, delta: number) => {
      side.moves.push(delta === 2 ? 'rotate180' : delta === 1 ? 'rotateCW' : 'rotateCCW');
      if (side.engine.lastSpin && side.engine.lastSpin !== 'none') this.events.push({ frame: this.frame, side: this.sides.indexOf(side), type: 'spin', data: { piece: piece.symbol, spin: side.engine.lastSpin } });
      if (this.sides.indexOf(side) === 1) { this.cue('rotate', 1); if (side.engine.lastSpin && side.engine.lastSpin !== 'none') this.cue('spin', 1); }
      if (side.task) for (let i = 0; i < count; i++) reviveRotate(side.task, piece.symbol);
    };
    if (initial && rotations) record(rotations, rotation);
    Object.defineProperty(piece, 'totalRotations', { configurable: true, enumerable: true, get: () => rotations, set: value => {
      descriptor?.set?.call(piece, value);
      if (value > rotations) record(value - rotations, (piece.rotation - rotation + 4) % 4);
      rotations = value; rotation = piece.rotation;
    } });
  }
  private locked(side: QpSide, index: number, result: LockRes) {
    const engine = side.engine, locking = side.locking; side.locking = null;
    if (!locking || side.life !== 'alive') return;
    const wounds = qpDuplicateClear(side.modState, Math.min(4, result.lines), result.mino, result.spin, side.mods);
    for (let row = 0; row < wounds; row++) {
      const hole = Math.floor(ruleRandom(side.garbage) * engine.board.width), y = qpInsertionRow(engine.board.state, true);
      this.insertRow(side, [], false, true);
      engine.board.state[y] = Array.from({ length: engine.board.width }, (_, x) => ({ mino: (x === hole ? 'gb' : 'gbd') as Mino, connections: 15 }));
      side.modState.wounds.push({ y, hole, remaining: 5 + this.climb.floor });
    }
    if (wounds) { this.cue('wound', index); this.cue('garbagerise', index); side.plan = null; this.events.push({ frame: this.frame, side: index, type: 'wound', data: { rows: wounds } }); }
    side.garbage.stalePieces++;
    if (side.garbage.stalePieces === 75) side.garbage.cancelStreak += 5;
    if (result.garbageCleared) { side.garbage.cancelStreak = 0; side.garbage.lastTank = this.frame; side.garbage.stalePieces = 0; }
    if (result.lines >= 4 || result.lines && result.spin !== 'none' && result.mino === 'i') { side.garbage.cancelStreak = Math.max(0, side.garbage.cancelStreak - (result.lines >= 4 ? 3 : 2)); side.garbage.lastTank = this.frame; side.garbage.stalePieces = 0; }
    if (side.task) {
      const evidence = placementEvidence(engine, result, locking.falling, locking.cells, locking.moves, locking.held);
      evidence.moved = locking.moved; evidence.heldPiece = locking.hold;
      evidence.centerX = locking.falling.location[0] + (result.mino === 'o' ? 0 : 1);
      evidence.upperHalf = Math.floor(locking.falling.location[1]) > engine.board.height / 2 + 2;
      revivePlacement(side.task, evidence);
    }
    const original = result.rawGarbage.reduce((a, b) => a + b, 0), amounts = qpAttack({ ...result, combo: result.stats.combo, b2b: result.stats.b2b, perfectClear: side.clear!.perfectClear }, side.mods, () => ruleRandom(side.garbage));
    const previous = side.clear!.stats;
    if (!result.lines && previous.combo >= 3) this.cue('combobreak', index);
    if (result.lines && result.stats.b2b > previous.b2b && result.stats.b2b >= 4) {
      if (previous.b2b < 4) this.cue('b2bcharge_start', index);
      this.cue(`b2bcharge_${result.stats.b2b > 23 ? 4 : result.stats.b2b > 11 ? 3 : result.stats.b2b > 7 ? 2 : 1}`, index);
    } else if (result.lines && result.stats.b2b < previous.b2b && previous.b2b >= 4) this.cue(`b2bcharge_blast_${previous.b2b >= 23 ? 4 : previous.b2b >= 11 ? 3 : previous.b2b >= 7 ? 2 : 1}`, index);
    const previousSent = engine.stats.garbage.sent;
    let sent = 0, cancelled = 0;
    for (const amount of amounts) {
      if (!amount) continue;
      const pending = side.garbage.entering.length + side.garbage.pending.filter(packet => packet.release <= this.frame).reduce((sum, packet) => sum + packet.amount, 0);
      const impending = side.garbage.pending.some(packet => packet.release <= this.frame);
      if (impending) this.cue('offset', index);
      const cancelledAttack = cancelGarbage(side.garbage, amount, (side.mods.includes('volatile') ? 2 : 1) * (this.sides.length === 2 ? 2 : 1), this.frame, engine.stats.pieces + 1 <= 14 && pending >= previousSent + sent, () => {
        if (ruleRandom(side.garbage) < qpMessiness(Math.max(1, this.climb.floor), side.mods, this.climb.maxMessiness).change) { this.hole(side); side.garbage.changedHole = true; }
      });
      sent += cancelledAttack.sent; cancelled += cancelledAttack.cancelled;
      if (cancelledAttack.sent) { if (impending) this.cue('counter', index); this.cue(`garbage_out_${garbageSize(cancelledAttack.sent)}`, index); this.cue('impact', index, 20); }
      if (cancelledAttack.cancelled) this.award(side, cancelledAttack.cancelled * Number(!side.mods.includes('expert')), false);
      if (cancelledAttack.sent) this.award(side, cancelledAttack.sent, true);
      if (side.task) { reviveAttack(side.task, 'attack', amount); reviveAttack(side.task, 'cancel', cancelledAttack.cancelled); reviveAttack(side.task, 'send', cancelledAttack.sent); }
    }
    const attack = amounts.reduce((a, b) => a + b, 0);
    engine.stats.garbage.attack += attack - original; engine.stats.garbage.sent += sent - original;
    result.rawGarbage = amounts.filter(Boolean); result.garbage = sent ? [sent] : []; result.stats.garbage = structuredClone(engine.stats.garbage);
    if (cancelled) this.events.push({ frame: this.frame, side: index, type: 'cancel', data: { amount: cancelled } });
    if (result.lines && !side.mods.includes('expert')) this.award(side, Math.min(2, result.lines), false);
    if (!result.lines) this.stageGarbage(side);
    side.nextPlan = this.frame + 60 / (side.practiceTopout ? 6 : this.settings.quickplay.bot.pps);
    side.lockFrames = [...side.lockFrames.filter(frame => frame > this.frame - 180), this.frame];
    if (index === 1 && side.plan && !side.plan.actions.some(action => action.at === side.plan!.age && action.key === 'hardDrop' && action.down)) side.plan = null;
    this.events.push({ frame: this.frame, side: index, type: 'lock', data: { piece: result.mino, cells: locking.cells, lines: result.lines, spin: result.spin, attack, sent, cancelled } });
  }
  private award(side: QpSide, amount: number, sent: boolean) {
    const before = this.climb.totalBonus;
    awardClimb(this.climb, amount, this.settings.quickplay.profile.mods, sent);
    side.contribution += this.climb.totalBonus - before;
    if (this.climb.totalBonus - before >= 2) this.cue('speed_tick_whirl', 0);
  }
  private hole(side: QpSide) {
    return qpGarbageHole(side.engine.board.state, side.garbage, qpMessiness(Math.max(1, this.climb.floor), side.mods, this.climb.maxMessiness));
  }
  private stageGarbage(side: QpSide) {
    const state = side.garbage, frame = side.engine.frame, floor = Math.max(1, this.climb.floor), messy = side.mods.includes('messy');
    const pattern = qpMessiness(floor, side.mods, this.climb.maxMessiness);
    const inner = Math.max(0, pattern.inner - (messy || this.climb.graceStillMessy ? 0 : .015 * state.grace));
    const change = Math.max(0, pattern.change - (messy || this.climb.graceStillMessy ? 0 : .0375 * state.grace));
    let left = 8;
    for (const packet of state.pending) {
      if (packet.ready > frame) continue;
      while (packet.amount && left) {
        let hole = packet.hole ?? state.lastHole;
        if (packet.hole === undefined && (hole === null || ruleRandom(state) < inner) && !state.changedHole) { hole = this.hole(side); state.changedHole = true; }
        if (hole === null) hole = this.hole(side);
        state.entering.push({ hole, size: packet.size ?? 1, packet: packet.id }); packet.amount--; left--;
        if (side.mods.includes('expert')) this.enterGarbage(side, this.sides.indexOf(side), true);
        state.changedHole = false;
      }
      if (!packet.amount && ruleRandom(state) < change) { this.hole(side); state.changedHole = true; }
      if (!left) break;
    }
    state.pending = state.pending.filter(packet => packet.amount > 0);
    if (left < 8) {
      state.enterAt = Math.max(state.enterAt, frame + 5); this.cue('garbagerise', this.sides.indexOf(side));
    }
  }
  private insertRow(side: QpSide, holes: number[], permanent = false, abovePerma = false) {
    const engine = side.engine, board = engine.board;
    if (board.state.at(-1)!.some(Boolean)) { this.down(this.sides.indexOf(side), 'garbage'); return; }
    const row = Array.from({ length: board.width }, (_, x) => holes.includes(x) ? null : { mino: (permanent ? 'gbd' : 'gb') as Mino, connections: 15 });
    const index = permanent ? 0 : qpInsertionRow(board.state, abovePerma);
    board.state.splice(Math.max(0, index), 0, row); board.state.pop();
    qpInsertVisualRow(side.modState, Math.max(0, index), board.width, this.frame);
    if (engine.falling.absoluteBlocks.some(([x, y]) => board.occupied(x, y))) engine.falling.location[1]++;
    side.plan = null; side.nextPlan = this.frame;
  }
  private enterGarbage(side: QpSide, index: number, instant = false) {
    const state = side.garbage, frame = side.engine.frame;
    if (!state.entering.length || !instant && frame < state.enterAt || side.life !== 'alive' || side.engine.state & 128) return;
    const row = state.entering.shift()!, holes = Array.from({ length: row.size }, (_, x) => Math.min(side.engine.board.width - 1, row.hole + x));
    if (side.mods.includes('doublehole') && ruleRandom(state) < .5) { let extra = Math.floor(ruleRandom(state) * (side.engine.board.width - 1)); if (extra >= row.hole) extra++; holes.push(extra); }
    this.insertRow(side, holes); state.inserted++; state.enterAt = frame + 5; state.cancelStreak = Math.max(0, state.cancelStreak - 3); state.lastTank = frame; state.stalePieces = 0;
    if (side.task) reviveAttack(side.task, 'tank', 1);
    this.events.push({ frame: this.frame, side: index, type: 'garbage-row', data: { holes } });
  }
  stop() {
    if (this.over) return false;
    this.over = true; this.stopped = true;
    this.sides.forEach(side => { this.release(side); side.practiceTopout = false; });
    this.events.push({ frame: this.frame, side: 0, type: 'stop', data: null });
    return true;
  }
  requestRescue(index: number) {
    if (this.over || this.sides.length !== 2 || this.sides.some(side => side.life !== 'alive' || side.practiceTopout)) return false;
    if (index === 0) return this.down(0);
    const side = this.sides[1]; this.release(side); side.nextSteps = []; side.practiceTopout = true; side.nextPlan = this.frame;
    this.events.push({ frame: this.frame, side: 1, type: 'practice-topout', data: null });
    return true;
  }
  down(index: number, reason = 'practice') {
    const side = this.sides[index];
    if (!side || side.life !== 'alive' || this.over) return false;
    side.life = 'down'; side.practiceTopout = false; side.downAt = this.frame; side.deaths++; side.plan = null; side.engine.state |= 128;
    this.release(side); this.events.push({ frame: this.frame, side: index, type: 'down', data: { reason } });
    const ally = this.sides[1 - index];
    if (!ally || ally.life !== 'alive' || this.climb.noRevive) { this.over = true; return true; }
    side.garbage.pending = side.garbage.pending.filter(packet => packet.release > this.frame);
    side.modState.wounds = [];
    for (let y = side.engine.board.state.length - 1; y >= 0; y--) for (let x = 0; x < side.engine.board.width; x++) {
      if (side.engine.board.state[y][x]) side.engine.board.state[y][x] = { mino: (ruleRandom(side.garbage) < .5 ? 'gb' : 'gbd') as Mino, connections: 0 };
    }
    side.feedback.alert = false; side.feedback.siren = 0;
    const config = this.settings.quickplay, random = () => ruleRandom(ally.garbage);
    const tasks = config.tasks.length ? config.taskMode === 'random' ? drawSelectedReviveTasks(config.tasks, config.randomTaskCount, ally.mods, random) : config.tasks : drawReviveTasks(Math.max(1, this.climb.floor), this.climb.reviveLevel, ally.mods, random);
    if (!tasks.length) throw new Error('The selected task pool contains no tasks compatible with the rescuer mods.');
    ally.task = initialRevive(tasks, this.frame); ally.plan = null; ally.nextPlan = this.frame;
    this.climb.aloneSince = this.frame;
    return true;
  }
  private revive(index: number) {
    const side = this.sides[index], engine = side.engine;
    engine.board.state = engine.board.state.map(row => row.map(() => null)); engine.held = null; engine.holdLocked = false; engine.stats.combo = -1; engine.stats.b2b = -1;
    side.modState = { ...initialQpModState(engine.board.state), previousClear: side.modState.previousClear, duplicate: side.modState.duplicate };
    side.garbage.pending = side.garbage.pending.filter(packet => packet.release > this.frame);
    engine.queue.clear(); engine.queue.minLength = 6; engine.state = 0; engine.nextPiece();
    side.life = 'alive'; side.reviveAt = null; side.garbage.cancelStreak = 0; side.garbage.lastTank = this.frame; side.garbage.stalePieces = 0; side.lockedGravityUntil = this.frame + 360; engine.glock = 360;
    side.plan = null; side.nextPlan = this.frame; this.release(side);
    for (let row = 0; row < this.climb.permanentRows; row++) this.insertRow(side, [], true);
    this.climb.aloneSince = null;
    this.nextTrigger = this.frame + Math.round(this.settings.quickplay.triggerSeconds * 60);
    this.events.push({ frame: this.frame, side: index, type: 'revived', data: null });
  }
  release(side: QpSide) {
    const snapshot = side.engine.snapshot();
    snapshot.input.keys = Object.fromEntries(Object.keys(snapshot.input.keys).map(key => [key, false])) as typeof snapshot.input.keys;
    snapshot.input.lShift.held = false; snapshot.input.rShift.held = false;
    side.engine.input = snapshot.input;
    if (side.task) for (const key of [...side.task.held]) reviveInput(side.task, key, false);
    side.plan = null;
  }
  tick(frames: Game.Replay.Frame[], recordedBot?: Game.Replay.Frame[]) {
    const player = this.sides[0];
    if (this.over) return { pieces: 0, garbage: { sent: [], received: [] }, keys: [], lastLock: player.engine.resCache.lastLock } as ReturnType<Engine['tick']>;
    const tasksBefore = this.sides.map(side => side.task ? { active: side.task.active, counts: side.task.prompts.map(prompt => prompt.count), resets: side.task.resets } : null);
    this.sides.forEach(side => { if (side.task) side.task.frame = this.frame; });
    const result = this.tickSide(player, 0, player.life === 'alive' ? frames : []);
    const ally = this.sides[1];
    if (ally) {
      if (ally.plan && ally.plan.taskActive !== ally.task?.active) { ally.plan = null; ally.nextPlan = this.frame; }
      if (recordedBot === undefined && ally.life === 'alive' && !ally.plan && (!ally.practiceTopout || this.frame >= ally.nextPlan)) {
        ally.plan = ally.practiceTopout ? { actions: [{ at: 0, key: 'hardDrop', down: true }, { at: 1, key: 'hardDrop', down: false }], duration: 2, age: 0, cursor: 0, target: null, nodes: 0, knownPieces: 0, reason: 'Stack straight up for rescue practice.' } : this.cachedBotPlan() ?? (this.botPlanner ? this.botPlanner(this) : planQpBot(this));
        if (ally.plan?.followups) ally.nextSteps = ally.plan.followups;
        if (ally.plan && !ally.plan.duration) { ally.plan.duration = 30; ally.nextPlan = this.frame + 30; }
        if (ally.plan?.target) {
          const lockAt = ally.plan.actions.find(action => action.down && action.key === 'hardDrop')?.at ?? 0;
          ally.plan.age = Math.min(0, this.frame - Math.ceil(ally.nextPlan - lockAt));
        }
      }
      const plan = ally.plan, actions = ally.life === 'alive' && plan ? plan.actions.filter(action => action.at === plan.age) : [];
      const inputs = recordedBot ?? actions.map(action => ({ frame: ally.engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as Game.Replay.Frame[];
      if (inputs.length) this.events.push({ frame: this.frame, side: 1, type: 'inputs', data: inputs });
      this.tickSide(ally, 1, inputs);
      if (plan && ally.plan === plan && ++plan.age >= (plan.duration ?? (plan.actions.at(-1)?.at ?? 0) + 1)) ally.plan = null;
    }
    this.flushCues();
    const previousFloor = this.climb.floor, rank = Math.floor(this.climb.rank), altitude = this.climb.altitude, tick = tickClimb(this.climb, this.settings.quickplay.profile); this.frame++;
    const reversed = this.settings.quickplay.profile.mods[0]?.endsWith('_reversed'), floor = Math.max(1, this.climb.floor);
    const pitch = ['', 'c', 'b', 'a', 'fsharp', 'e', reversed ? 'g' : 'a', 'ahalfsharp', 'e', 'e', 'a'][floor];
    if (Math.floor(this.climb.rank) !== rank) this.cue(`zenith_${this.climb.rank > rank ? 'up' : 'down'}speed_${pitch}`, 0);
    if (tick.changed && floor > 1) { const note = ['', '', 'c', 'b', 'a', 'fsharp', 'e', reversed ? 'g' : 'a', 'ahalfsharp', 'e', 'e'][floor]; this.cue(`zenith_levelup_${note}`, 0); this.events.push({ frame: this.frame, side: 0, type: 'floor', data: { floor } }); }
    const subdivisions = Math.min(8, Math.floor(this.climb.bonus) + 1);
    if (Math.floor(this.climb.altitude * subdivisions) > Math.floor(altitude * subdivisions)) this.cue(`speed_tick_${1 + this.frame % 4}`, 0);
    if (tick.actions.length) { this.events.push({ frame: this.frame, side: 0, type: 'fatigue', data: tick.actions }); if (tick.actions.some(([action]) => action === 'shake')) this.cue('garbagerise', 0); }
    this.sides.forEach((side, index) => {
      if (tick.changed && side.mods.includes('gravity')) {
        const bump = previousFloor === 0 ? .48 : .3; side.gravityBonus += bump;
        side.engine.dynamic.gravity.base += bump; side.engine.dynamic.gravity.set(side.engine.dynamic.gravity.get() + bump);
        side.engine.misc.movement.lockTime = [0, 30, 29, 28, 27, 26, 24, 22, 20, 18, 16][this.climb.floor];
      }
      if (tick.changed && side.mods.includes('gravity_reversed')) {
        side.engine.dynamic.gravity.set(20); side.engine.misc.movement.lockTime = [0, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11][this.climb.floor];
      }
      for (const [action] of tick.actions) if (action === 'unclearable') this.insertRow(side, [], true);
      if (side.task) {
        const board = side.engine.board, top = board.state.slice(board.height - 3).some(row => row.some(Boolean)), rows = board.state.filter(row => row.some(tile => tile?.mino === 'gb')).length;
        reviveClock(side.task, this.frame, top, rows);
        const before = tasksBefore[index];
        if (before) {
          if (side.task.resets > before.resets) this.cue('boardlock_fail', index);
          if (side.task.prompts.some((prompt, i) => prompt.count > (before.counts[i] ?? 0))) this.cue('boardlock_clink', index);
          if (side.task.active > before.active) this.cue('boardlock_clear', index, 12);
        }
        if (side.task.finishedAt !== null && this.frame >= side.task.finishedAt + 12 && this.sides[1 - index]?.life === 'down') {
          this.completed.push({ frame: this.frame, side: index, tasks: structuredClone(side.task) }); side.revives++;
          const revived = this.sides[1 - index]; revived.life = 'reviving'; revived.reviveAt = this.frame + 12;
          this.cue('boardlock_revive', 1 - index);
          this.climb.reviveLevel += [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3][this.climb.floor]; side.task = null;
          this.events.push({ frame: this.frame, side: index, type: 'rescue', data: { level: this.climb.reviveLevel } });
        }
      }
      if (side.life === 'reviving' && this.frame >= side.reviveAt!) this.revive(index);
    });
    this.flushCues();
    if (this.settings.quickplay.trigger !== 'none' && ally && this.sides.every(side => side.life === 'alive' && !side.practiceTopout) && this.frame >= this.nextTrigger && (!this.triggers || this.settings.quickplay.repeat)) {
      const trigger = this.settings.quickplay.trigger, index = trigger === 'bot' ? 1 : trigger === 'player' ? 0 : this.triggers % 2 ? 0 : 1;
      this.triggers++; this.requestRescue(index);
    }
    return result;
  }
  private tickSide(side: QpSide, index: number, frames: Game.Replay.Frame[]) {
    const x = side.engine.falling.x, y = side.engine.falling.y, pieces = side.engine.stats.pieces;
    for (const input of frames) if ((input.type === 'keydown' || input.type === 'keyup') && side.task) reviveInput(side.task, input.data.key as GameAction, input.type === 'keydown');
    const result = this.tickEngine(side, index, frames);
    if (qpHealWounds(side.modState, side.engine)) { this.cue('wound_repel', index); side.plan = null; }
    if (index === 1 && side.engine.stats.pieces === pieces) { if (side.engine.falling.x !== x) this.cue('move', index); if (side.engine.falling.y < y && side.engine.input.keys.softDrop) this.cue('softdrop', index); }
    const packets = pressurePackets(side.pressure, this.settings.quickplay.pressure, this.frame, this.climb.altitude, side.mods);
    if (side.life === 'alive') this.enterGarbage(side, index);
    const starts = acceptPressure(side.garbage, packets, { frame: this.frame, altitude: this.climb.altitude, floor: Math.max(1, this.climb.floor), multiplier: this.climb.receiveMultiplier / (this.settings.quickplay.profile.mods.includes('volatile') ? 2 : 1) * (side.mods.includes('volatile') ? 2 : 1), ownBonus: side.contribution, allyBonus: this.sides[1 - index]?.contribution ?? 0, allyDown: !!this.sides[1 - index] && this.sides[1 - index].life !== 'alive', mods: side.mods, incapacitated: side.life !== 'alive' });
    if (side.life === 'alive') {
      for (const start of starts) this.scheduled.push({ frame: start.frame, side: index, type: 'windup', data: { portions: start.portions } });
      for (const packet of side.garbage.pending) for (const name of packetCues(packet, this.frame)) this.cue(name, index);
      if (packets.length) this.events.push({ frame: this.frame, side: index, type: 'pressure', data: packets });
      updateGarbage(side.garbage, this.frame, Math.max(1, this.climb.floor), side.mods);
      side.engine.stats.garbage.receive = side.garbage.received;
      const warning = garbageWarning(side.engine.board.state, side.engine.board.height, side.garbage, this.frame);
      if (warning.alert && !side.feedback.alert) this.cue('damage_alert', index);
      side.feedback.alert = warning.alert;
      if (warning.panic && ++side.feedback.siren >= warning.interval) { side.feedback.siren -= warning.interval; this.cue('warning', index); }
      if (!warning.panic) side.feedback.siren = 0;
      if (side.engine.toppedOut) this.down(index, 'blockout');
    }
    return result;
  }
  private cachedBotPlan(): BotPlan | null {
    const side = this.sides[1], next = side.nextSteps.shift(); if (!next) return null;
    if (next.expected === botStateKey(side.engine.snapshot(), side.task)) {
      const trial = trialQpOperation(this.checkpoint(), 1, pacedBotOperation({ ...next, target: next.target ?? undefined }, this.frame, side.nextPlan));
      if (trial && trial.progress >= (next.progress ?? -Infinity) && (!next.target || trial.target[0] && sameCells(next.target, trial.target[0]))) return { ...next, cursor: 0, age: 0, knownPieces: 0, nodes: 0, reason: `Continue calculated route. ${next.label}` };
    }
    side.nextSteps = []; return null;
  }
  private tickEngine(side: QpSide, index: number, frames: Game.Replay.Frame[]) {
    if (index !== 0 || !this.settings.quickplay.reviveNoGravity || !side.task && !this.sides[1]?.practiceTopout) return side.engine.tick(frames);
    const gravity = side.engine.dynamic.gravity, get = gravity.get, movement = side.engine.misc.movement;
    const infinite = movement.infinite, lockTime = movement.lockTime;
    gravity.get = () => 0; movement.infinite = true; movement.lockTime = Number.MAX_SAFE_INTEGER;
    try { return side.engine.tick(frames); }
    finally { gravity.get = get; movement.infinite = infinite; movement.lockTime = lockTime; }
  }
  private cue(name: string, side: number, delay = 0) {
    const event = { frame: this.frame + delay, side, type: 'sound', data: { name } };
    if (delay) this.scheduled.push(event); else this.events.push(event);
  }
  private flushCues() {
    for (const event of this.scheduled.filter(event => event.frame <= this.frame)) {
      if (event.type === 'windup') { const state = this.sides[event.side].feedback; state.windupAt = event.frame; state.windupPortions = (event.data as { portions: number }).portions; }
      this.events.push(event);
    }
    this.scheduled = this.scheduled.filter(event => event.frame > this.frame);
  }
}
