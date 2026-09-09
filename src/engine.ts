import { Engine, type EngineInitializeParams } from '@haelp/teto/engine';
import type { Settings } from './settings';

export function createEngine(settings: Settings, seed: number): Engine {
  const config: EngineInitializeParams = {
    board: { width: 10, height: 20, buffer: 20 },
    queue: { minLength: 14, seed, type: '7-bag' },
    kickTable: 'SRS+',
    handling: { ...settings.handling, may20g: true },
    gravity: { value: 0.02, increase: 0, marginTime: 0 },
    options: { spinBonuses: 'T-spins', comboTable: 'multiplier', garbageTargetBonus: 'none', clutch: true, garbageBlocking: 'combo blocking', stock: 0 },
    garbage: {
      boardWidth: 10, seed, bombs: false, garbage: { speed: 20, holeSize: 1 },
      cap: { value: 8, increase: 0, max: 40, marginTime: 0, absolute: 0 },
      messiness: { change: 1, nosame: false, timeout: 0, within: 0, center: false },
      multiplier: { value: 1, increase: 0, marginTime: 0 },
      specialBonus: false, openerPhase: 0, rounding: 'down'
    },
    b2b: { chaining: true, charging: false }, pc: false,
    misc: { allowed: { hardDrop: true, spin180: true, hold: true, retry: false, undo: false }, infiniteHold: false, movement: { infinite: false, lockResets: 15, lockTime: 30, may20G: true }, stride: false }
  };
  return new Engine(config);
}
