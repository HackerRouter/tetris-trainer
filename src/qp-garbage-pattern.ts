import type { EngineSnapshot } from '@haelp/teto/engine';
import type { QpMod } from './qp-rules';
import { ruleRandom, type GarbageState } from './qp-pressure';

export function qpMessiness(floor: number, mods: QpMod[], maximum = false) {
  const expert = mods.includes('expert') || mods.includes('expert_reversed'), messy = mods.includes('messy') || mods.includes('messy_reversed');
  const inner = maximum ? 1 : (expert ? .05 : .03) * floor + (messy ? mods.includes('messy_reversed') ? 1 : .25 : 0) + (mods.includes('allspin_reversed') ? .3 : 0);
  return { inner, change: maximum ? 1 : 2.5 * inner, favor: (expert ? 0 : 33) - 3 * floor - (messy ? 25 : 0), center: inner <= .15 && floor <= 5 };
}
export function qpGarbageHole(board: EngineSnapshot['board'], state: GarbageState, pattern: ReturnType<typeof qpMessiness>) {
  const width = board[0].length, random = () => ruleRandom(state), edge = pattern.center ? Math.round(width / 5) : 0;
  if (!pattern.favor) {
    let column = edge + Math.floor(random() * (width - Number(state.lastHole !== null) - 2 * edge));
    if (state.lastHole !== null && column >= state.lastHole) column++;
    return state.lastHole = column;
  }
  let bottomHole = -1;
  for (const row of board) if (row.some(tile => tile === null)) { if (row.some(tile => tile?.mino === 'gb')) bottomHole = row.indexOf(null); break; }
  const columns = Array.from({ length: width }, (_, x) => {
    let height = board.length; while (height > 0 && board[height - 1][x] === null) height--;
    return { x, cost: (height ? height + (bottomHole < 0 ? 0 : 5 * Math.abs(x - bottomHole)) : 0) + .1 * random(), weight: 0 };
  }).sort((a, b) => a.cost - b.cost);
  let total = 0;
  columns.forEach((column, rank) => {
    total += column.x === state.lastHole || column.x < edge || column.x >= width - edge ? 0 : Math.max(0, 10 + pattern.favor + rank * ((20 - 2 * (10 + pattern.favor)) / 9));
    column.weight = total;
  });
  const pick = random() * total;
  return state.lastHole = columns.find(column => column.weight !== 0 && pick <= column.weight)?.x ?? 0;
}
