import type { EngineSnapshot } from '@haelp/teto/engine';
import type { Cell } from './finesse';

export function clearedRows(board: EngineSnapshot['board'], cells: Cell[]) {
  const occupied = new Set(cells.map(([x, y]) => `${x},${y}`));
  return board.flatMap((row, y) => row.every((tile, x) => tile || occupied.has(`${x},${y}`)) ? [y] : []);
}
