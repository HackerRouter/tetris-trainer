import { Bag, Engine, Tetromino, type Mino, type EngineInitializeParams } from '@haelp/teto/engine';
import type { Settings } from './settings';
import { modeDefinitions, type ModeRules } from './modes';

export function createEngine(settings: Settings, seed: number, rules: ModeRules = modeDefinitions.sprint.rules(settings)): Engine {
  const a = rules.advanced;
  const config: EngineInitializeParams = {
    board: rules.board,
    queue: { minLength: 14, seed, type: rules.bag },
    kickTable: a.kickSet,
    handling: { ...settings.handling, ...(a.handlingOverride ? { arr: a.arr, das: a.das, sdf: a.sdf } : {}) },
    gravity: { value: rules.gravity, increase: a.gravityIncrease, marginTime: a.gravityMargin * 60 },
    options: { spinBonuses: a.spinBonuses, comboTable: a.comboTable, garbageTargetBonus: 'none', clutch: a.clutch, garbageBlocking: a.garbageBlocking, stock: 0 },
    garbage: {
      boardWidth: rules.board.width, seed, bombs: a.bombs, garbage: { speed: a.garbageSpeed, holeSize: 1 },
      cap: { value: a.garbageCap, increase: a.garbageCapIncrease, max: a.garbageCapMax, marginTime: a.garbageCapMargin * 60, absolute: a.garbageAbsoluteCap },
      messiness: { change: rules.setup.messiness, nosame: false, timeout: 0, within: a.garbageMessinessWithin, center: false },
      multiplier: { value: a.garbageMultiplier, increase: a.garbageIncrease, marginTime: a.garbageMargin * 60 },
      specialBonus: a.specialBonus, openerPhase: a.openerPhase, rounding: 'down'
    },
    b2b: { chaining: a.b2bChaining, charging: a.b2bCharging ? { at: 4, base: 3 } : false }, pc: a.allClear ? { garbage: a.allClearGarbage, b2b: a.allClearB2B } : false,
    misc: { allowed: { hardDrop: a.hardDrop, spin180: rules.allow180, hold: rules.hold, retry: false, undo: false }, infiniteHold: rules.infiniteHold, movement: { infinite: rules.infiniteLock, lockResets: rules.lockResets, lockTime: rules.infiniteLock ? Number.MAX_SAFE_INTEGER : rules.lockDelay, may20G: true }, stride: false }
  };
  const engine = new Engine(config);
  if (a.sequence) {
    const sequence = [...a.sequence] as Mino[];
    if (a.repeatSequence) {
      engine.queue.bag = new RepeatingBag(seed, sequence);
      engine.queue.clear(); engine.queue.minLength = 14;
      engine.initiatePiece(engine.queue.shift()!);
    } else {
      const snapshot = engine.snapshot();
      snapshot.queue.value = [...sequence.slice(1), engine.falling.symbol, ...snapshot.queue.value];
      snapshot._queue.value = [...snapshot.queue.value];
      snapshot.falling = spawnSnapshot(engine, sequence[0]);
      engine.fromSnapshot(snapshot);
    }
  }
  return engine;
}

class RepeatingBag extends Bag {
  constructor(seed: number, private sequence: Mino[]) { super(seed); }
  next() { return [this.sequence[this.id++ % this.sequence.length]]; }
}

export function spawnSnapshot(engine: Engine, symbol: Mino) {
  return new Tetromino({ symbol, boardWidth: engine.board.width, boardHeight: engine.board.height, initialRotation: engine.kickTable.spawn_rotation[symbol as keyof typeof engine.kickTable.spawn_rotation] ?? 0 }).snapshot();
}

export function syncProgression(engine: Engine, frames: number) {
  for (const tracker of Object.values(engine.dynamic)) {
    tracker.frame = frames;
    tracker.set(tracker.base + Math.max(0, frames - tracker.margin) * tracker.increase / 60);
  }
}
