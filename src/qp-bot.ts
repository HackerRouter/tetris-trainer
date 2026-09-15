import type { Engine, EngineSnapshot, LockRes } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import type { GameAction } from './settings';
import type { Move } from './finesse';
import type { RevivePlacement } from './revive-tasks';

export type BotAction = { at: number; key: GameAction; down: boolean };
export type BotPlan = { actions: BotAction[]; cursor: number; age: number; target: [number, number][] | null; knownPieces: number; nodes: number; reason: string; duration?: number; taskActive?: number };
export function inputPlan(moves: Move[], engine: Engine, hold = false): BotAction[] {
  const actions: BotAction[] = []; let at = 0;
  const press = (key: GameAction, duration = 1) => { actions.push({ at, key, down: true }, { at: at + duration, key, down: false }); at += duration + 1; };
  if (hold) press('hold');
  for (const move of moves) {
    if (move === 'dasLeft' || move === 'dasRight') press(move === 'dasLeft' ? 'moveLeft' : 'moveRight', Math.ceil(engine.handling.das + engine.handling.arr * engine.board.width) + 2);
    else if (move === 'softDrop' || move === 'down') press('softDrop', engine.handling.sdf === 41 ? 1 : Math.ceil(engine.board.height / Math.max(.02, engine.dynamic.gravity.get() * engine.handling.sdf)));
    else press(move as GameAction);
  }
  press('hardDrop');
  return actions;
}
export function executeBotFrame(engine: Engine, actions: BotAction[], age: number) {
  return engine.tick(actions.filter(action => action.at === age).map(action => ({ frame: engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as Game.Replay.Frame[]);
}
export function boardScore(board: EngineSnapshot['board']) {
  const width = board[0].length, heights = Array(width).fill(0) as number[];
  let holes = 0, covered = 0;
  for (let x = 0; x < width; x++) {
    for (let y = board.length - 1; y >= 0; y--) {
      if (board[y][x]) { if (!heights[x]) heights[x] = y + 1; }
      else if (heights[x]) { holes++; covered += heights[x] - y; }
    }
  }
  const peak = Math.max(...heights), roughness = heights.slice(1).reduce((sum, height, index) => sum + Math.abs(height - heights[index]), 0);
  return -holes * 22 - covered * 2 - heights.reduce((a, b) => a + b, 0) * .6 - roughness * 1.8 - peak ** 2 * .4;
}
export function placementEvidence(engine: Engine, result: LockRes, falling: EngineSnapshot['falling'], target: [number, number][], moves: string[], holdUsed: boolean): RevivePlacement {
  return { piece: result.mino, lines: result.lines, spin: result.spin, combo: result.stats.combo, b2b: result.stats.b2b, rotation: falling.rotation,
    centerX: Math.min(...target.map(cell => cell[0])) + (result.mino === 't' ? 1 : 0), quadColumn: target[0][0], upperHalf: Math.min(...target.map(cell => cell[1])) > engine.board.height / 2,
    moved: moves.some(move => /move|das|rotate/.test(move)), usedCW: moves.includes('rotateCW'), used180: moves.includes('rotate180'), heldPiece: engine.held, holdUsed, garbageCleared: result.garbageCleared,
    colorClear: engine.board.state.every(row => row.every(tile => !tile || tile.mino === 'gb' || String(tile.mino) === 'gbd')) };
}
