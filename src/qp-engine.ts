import { Bag, type Engine, type EngineSnapshot, type Mino } from '@haelp/teto/engine';
import type { QpMod } from './qp-rules';

export type QpEngineState = { snapshot: EngineSnapshot; dynamic: Record<keyof Engine['dynamic'], { base: number; increase: number; margin: number; frame: number; value: number }>; movement: Engine['misc']['movement'] };
export function qpEngineState(engine: Engine): QpEngineState {
  return { snapshot: engine.snapshot(), movement: structuredClone(engine.misc.movement), dynamic: Object.fromEntries(Object.entries(engine.dynamic).map(([key, tracker]) => [key, { base: tracker.base, increase: tracker.increase, margin: tracker.margin, frame: tracker.frame, value: tracker.get() }])) as QpEngineState['dynamic'] };
}
export function applyQpEngineState(engine: Engine, state: QpEngineState) {
  const snapshot = structuredClone(state.snapshot), frame = snapshot.frame;
  snapshot.frame = 0; engine.fromSnapshot(snapshot); engine.frame = frame;
  engine.misc.movement = structuredClone(state.movement);
  for (const key of Object.keys(state.dynamic) as (keyof Engine['dynamic'])[]) {
    const value = state.dynamic[key], tracker = engine.dynamic[key];
    tracker.base = value.base; tracker.increase = value.increase; tracker.margin = value.margin; tracker.frame = value.frame; tracker.set(value.value);
  }
}

export class ZenithBag extends Bag {
  cancelStreak = () => 0;
  constructor(seed: number, readonly volatile: boolean) { super(seed); }
  next() {
    const pieces = this.rng.shuffleArray(['z', 'l', 'o', 's', 'i', 'j', 't'] as Mino[]), extras: Mino[] = [];
    const streak = this.cancelStreak(), scale = this.volatile ? 2 : 1;
    const choose = (a: string, b: string) => (this.rng.nextFloat() < .5 ? a : b) as Mino;
    if (streak >= 20 * scale) extras.push('o' as Mino);
    if (streak >= 30 * scale) extras.push(choose('l', 'j'));
    if (streak >= 40 * scale) extras.push(choose('s', 'z'));
    if (streak >= 50 * scale) extras.push(choose('l', 'j'), choose('t', 'i'));
    if (streak >= 60 * scale) extras.push(choose('s', 'z'));
    if (extras.length) pieces.push(...this.rng.shuffleArray(extras));
    if (streak >= 40 && this.lastGenerated === null) { pieces.unshift('i5' as Mino); this.lastGenerated = this.id; }
    this.id++;
    return pieces;
  }
}

export function configureZenithEngine(engine: Engine, seed: number, mods: QpMod[]) {
  engine.queue.bag = new ZenithBag(seed, mods.some(mod => mod === 'volatile' || mod === 'volatile_reversed'));
  engine.queue.clear(); engine.queue.minLength = 6;
  engine.initiatePiece(engine.queue.shift()!);
  const snapshot = engine.snapshot(); snapshot._queue = structuredClone(snapshot.queue); engine.fromSnapshot(snapshot);
  engine.glock = 240;
  if (engine.b2b.charging) engine.b2b.charging.base = mods.includes('allspin_reversed') ? 3 : 0;
  const clearLines = engine.board.clearLines.bind(engine.board);
  engine.board.clearLines = () => {
    const permanent = engine.board.state.filter(row => row.some(tile => String(tile?.mino) === 'gbd'));
    const saved = permanent.map(row => row[0]);
    permanent.forEach(row => { row[0] = null; });
    const result = clearLines();
    permanent.forEach((row, index) => { row[0] = saved[index]; });
    return result;
  };
  Object.defineProperty(engine.board, 'perfectClear', { get: () => engine.board.state.every(row => row.every(tile => tile === null || String(tile.mino) === 'gbd') || row.every(tile => ['gb', 'gbd'].includes(String(tile?.mino)))) });
}
