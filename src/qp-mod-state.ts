import type { Engine, EngineSnapshot, Mino } from '@haelp/teto/engine';
import type { QpMod } from './qp-rules';

export type QpModState = {
  previousClear: { lines: number; piece: string; spin: string } | null;
  duplicate: boolean;
  wounds: { y: number; hole: number; remaining: number }[];
  born: number[][];
};
export type QpVisual = { frame: number; invisible: boolean; playing: boolean; replay?: boolean; state: QpModState };
export function qpVisual(side: { mods: QpMod[]; modState: QpModState; life: string }, frame: number, replay = false): QpVisual {
  return { frame, invisible: side.mods.includes('invisible'), playing: side.life === 'alive', replay, state: side.modState };
}
export function initialQpModState(board: EngineSnapshot['board']): QpModState {
  return { previousClear: null, duplicate: false, wounds: [], born: board.map(row => row.map(() => 0)) };
}
export function qpClearRows(state: QpModState, board: EngineSnapshot['board'], cells: [number, number][], frame: number) {
  for (const [x, y] of cells) if (state.born[y]) state.born[y][x] = frame;
  const rows = board.flatMap((row, y) => row.every(Boolean) && !row.some(tile => String(tile?.mino) === 'gbd') ? [y] : []);
  for (const wound of state.wounds) wound.y -= rows.filter(y => y < wound.y).length;
  for (const y of rows.reverse()) state.born.splice(y, 1);
  while (state.born.length < board.length) state.born.push(Array(board[0].length).fill(frame));
}
export function qpInsertVisualRow(state: QpModState, y: number, width: number, frame: number) {
  state.born.splice(y, 0, Array(width).fill(frame)); state.born.pop();
  for (const wound of state.wounds) if (wound.y >= y) wound.y++;
}
export function qpInsertionRow(board: EngineSnapshot['board'], abovePerma = false) {
  for (let y = board.length - 1; y >= 0; y--) if (abovePerma ? board[y].every(tile => String(tile?.mino) === 'gbd') : board[y].some(tile => String(tile?.mino) === 'gbd')) return y + 1;
  return 0;
}
export function qpDuplicateClear(state: QpModState, lines: number, piece: string, spin: string, mods: QpMod[]) {
  if (!mods.some(mod => mod === 'allspin' || mod === 'allspin_reversed') || !lines && spin === 'none') return 0;
  const previous = state.previousClear, reversed = mods.includes('allspin_reversed');
  state.duplicate = !!previous && (reversed ? previous.spin === 'none' && spin === 'none' || previous.lines === lines && previous.spin !== 'none' && spin !== 'none' : previous.lines === lines && (previous.spin === 'none' && spin === 'none' || previous.spin === spin && previous.piece === piece));
  state.previousClear = { lines, piece, spin };
  if (lines && !state.duplicate) for (const wound of state.wounds) wound.remaining--;
  return state.duplicate ? reversed ? 20 : 1 : 0;
}
export function qpHealWounds(state: QpModState, engine: Engine) {
  const healed = state.wounds.filter(wound => wound.remaining <= 0);
  for (const wound of healed) engine.board.state[wound.y] = engine.board.state[wound.y].map(tile => String(tile?.mino) === 'gb' ? null : { mino: 'gb' as Mino, connections: 15 });
  state.wounds = state.wounds.filter(wound => wound.remaining > 0);
  return healed.length;
}
export function qpTileOpacity(visual: QpVisual, symbol: string, x: number, y: number) {
  if (!visual.invisible || !visual.playing) return 1;
  const phase = visual.frame / 60 % 5, pulse = phase < .15 ? phase / .15 : 1 - Math.min(1, Math.max(0, phase - .35));
  let opacity = Math.min(1, pulse + Math.max(0, 1 - (visual.frame - (visual.state.born[y]?.[x] ?? 0)) / 10));
  if (visual.replay) opacity = .4 + .6 * opacity;
  return symbol === 'gb' || symbol === 'gbd' ? .7 + .3 * opacity : opacity;
}
