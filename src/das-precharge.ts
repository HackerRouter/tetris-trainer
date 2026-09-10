import type { Engine } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import type { Settings } from './settings';

export type DasCharge = Pick<Engine['input'], 'lShift' | 'rShift' | 'lastShift'>;

export class DasPrecharge {
  private state: DasCharge = this.empty();

  private empty(): DasCharge {
    return { lShift: { held: false, arr: 0, das: 0, dir: -1 }, rShift: { held: false, arr: 0, das: 0, dir: 1 }, lastShift: 0 };
  }

  tick(frames: Game.Replay.Frame[], handling: Settings['handling']) {
    let cursor = 0;
    const advance = (subframe: number) => {
      const end = Math.max(cursor, subframe), delta = end - cursor;
      for (const shift of [this.state.lShift, this.state.rShift]) {
        if (shift.held && shift.dir === this.state.lastShift) shift.das = Math.min(handling.das, shift.das + delta);
      }
      cursor = end;
    };
    for (const frame of frames) {
      if (frame.type !== 'keydown' && frame.type !== 'keyup') continue;
      const { key, subframe } = frame.data;
      if (key !== 'moveLeft' && key !== 'moveRight') continue;
      advance(subframe);
      const shift = key === 'moveLeft' ? this.state.lShift : this.state.rShift;
      const other = key === 'moveLeft' ? this.state.rShift : this.state.lShift;
      if (frame.type === 'keydown') {
        shift.held = true; shift.das = 0; shift.arr = handling.arr;
        this.state.lastShift = shift.dir;
      } else {
        shift.held = false; shift.das = 0;
        if (other.held) this.state.lastShift = other.dir;
        if (handling.cancel) { other.arr = handling.arr; other.das = 0; }
      }
    }
    advance(1);
  }

  take(): DasCharge | null {
    const state = this.state;
    this.reset();
    return state.lShift.held || state.rShift.held ? state : null;
  }

  reset() { this.state = this.empty(); }
}

export function applyDasPrecharge(engine: Engine, charge: DasCharge) {
  engine.input.lShift = { ...charge.lShift }; engine.input.rShift = { ...charge.rShift };
  engine.input.lastShift = charge.lastShift;
  const inputs: ('moveLeft' | 'moveRight')[] = [];
  if (charge.lShift.held) inputs.push('moveLeft');
  if (charge.rShift.held) inputs.push('moveRight');
  if (charge.lastShift === -1) inputs.reverse();
  engine.falling.keys += inputs.length;
  engine.input.firstInputTime = engine.frame;
  const shift = charge.lastShift === -1 ? charge.lShift : charge.rShift;
  if (shift.held) {
    const ready = shift.das >= engine.handling.das;
    if (ready && engine.handling.arr === 0) engine[shift.dir === -1 ? 'dasLeft' : 'dasRight']();
    else engine[shift.dir === -1 ? 'moveLeft' : 'moveRight']();
    if (ready) (shift.dir === -1 ? engine.input.lShift : engine.input.rShift).arr = 0;
  }
  return inputs;
}
