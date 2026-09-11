import { Tetromino, legal, type Engine, type EngineSnapshot, type TetrominoSnapshot } from '@haelp/teto/engine';
import { finesseTable } from './finesse-data';

export type Cell = [number, number];
export type Move = 'moveLeft' | 'moveRight' | 'dasLeft' | 'dasRight' | 'rotateCW' | 'rotateCCW' | 'rotate180' | 'softDrop' | 'down';
export type FinesseResult = { cost: number; moves: Move[]; source: 'd-002' | 'extended'; drop: 'hard' | 'soft' | 'lock' };

const horizontalMoves: Move[] = ['moveLeft', 'moveRight', 'dasLeft', 'dasRight', 'rotateCW', 'rotateCCW', 'rotate180'];
const codes: Record<string, Move> = { l: 'moveLeft', r: 'moveRight', L: 'dasLeft', R: 'dasRight', C: 'rotateCW', c: 'rotateCCW', 1: 'rotate180' };
const countedInputs = new Set(['moveLeft', 'moveRight', 'rotateCW', 'rotateCCW', 'rotate180']);

export function countFinesseInputs(inputs: readonly string[]) { return inputs.filter(input => countedInputs.has(input)).length; }

function key(cells: Cell[]) { return cells.map(([x, y]) => `${x},${y}`).sort().join(';'); }
function placementKey(cells: Cell[]) {
  const bottom = Math.min(...cells.map(([, y]) => y));
  return key(cells.map(([x, y]) => [x, y - bottom]));
}

export function copyPiece(engine: Engine, state: TetrominoSnapshot) {
  const piece = new Tetromino({ symbol: state.symbol, boardWidth: engine.board.width, boardHeight: engine.board.height, initialRotation: state.rotation });
  Object.assign(piece, state, { location: [...state.location] });
  return piece;
}

function applyMove(engine: Engine, board: EngineSnapshot['board'], piece: Tetromino, move: Move) {
  if (move === 'down') {
    piece.y -= 1;
    return legal(piece.absoluteBlocks, board);
  }
  if (move.startsWith('rotate')) {
    return !!piece.rotate(board, engine.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false);
  }
  return piece[move as 'moveLeft' | 'moveRight' | 'dasLeft' | 'dasRight' | 'softDrop'](board);
}

function referencePath(engine: Engine, snapshot: EngineSnapshot, target: Cell[]): FinesseResult | null {
  const symbol = snapshot.falling.symbol.toLowerCase();
  const table = finesseTable[symbol];
  const initial = copyPiece(engine, snapshot.falling);
  const spawn = new Tetromino({ symbol: initial.symbol, boardWidth: engine.board.width, boardHeight: engine.board.height, initialRotation: 0 });
  if (!table || !['SRS', 'SRS+'].includes(engine.kickTableName) || engine.board.width !== 10 || initial.x !== spawn.x || initial.rotation !== 0) return null;
  const shape = placementKey(target);
  const candidates: string[] = [];
  for (const [position, row] of Object.entries(table)) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const sequence = row[rotation];
      if (sequence === null) continue;
      const cells = initial.absoluteAt({ x: Number(position) + (symbol === 'o' ? 1 : 0), rotation });
      if (placementKey(cells) === shape) candidates.push(sequence);
    }
  }
  for (const sequence of candidates.sort((a, b) => a.length - b.length)) {
    const piece = copyPiece(engine, snapshot.falling);
    const moves = [...sequence].map(code => codes[code]);
    if (!engine.misc.allowed.spin180 && moves.includes('rotate180')) continue;
    if (!legal(piece.absoluteBlocks, snapshot.board) || !moves.every(move => applyMove(engine, snapshot.board, piece, move))) continue;
    piece.softDrop(snapshot.board);
    if (key(piece.absoluteBlocks) === key(target)) return { cost: moves.length, moves, source: 'd-002', drop: 'hard' };
  }
  return null;
}

function search(engine: Engine, snapshot: EngineSnapshot, target: Cell[], allowSoftDrop: boolean): FinesseResult | null {
  const board = snapshot.board;
  const targetKey = key(target);
  const moves: Move[] = horizontalMoves.filter(move => move !== 'rotate180' || engine.misc.allowed.spin180);
  if (allowSoftDrop) {
    moves.push('softDrop');
    if (engine.handling.sdf !== 41) moves.push('down');
  }
  const buckets: { state: TetrominoSnapshot; moves: Move[] }[][] = [[{ state: snapshot.falling, moves: [] }]];
  const seen = new Set<string>();
  for (let cost = 0; cost < buckets.length; cost++) {
    for (let index = 0; index < buckets[cost].length; index++) {
      const node = buckets[cost][index];
      const piece = copyPiece(engine, node.state);
      const stateKey = `${piece.x},${piece.y},${piece.rotation},${piece.aox},${piece.aoy}`;
      if (seen.has(stateKey) || !legal(piece.absoluteBlocks, board)) continue;
      seen.add(stateKey);
      const dropped = copyPiece(engine, piece.snapshot());
      dropped.softDrop(board);
      if (key(dropped.absoluteBlocks) === targetKey) return { cost, moves: node.moves, source: 'extended', drop: allowSoftDrop ? 'soft' : 'hard' };
      for (const move of moves) {
        const nextCost = cost + (move === 'down' || move === 'softDrop' ? 0 : 1);
        const next = copyPiece(engine, piece.snapshot());
        if (applyMove(engine, board, next, move)) {
          buckets[nextCost] ??= [];
          buckets[nextCost].push({ state: next.snapshot(), moves: [...node.moves, move] });
        }
      }
    }
  }
  return null;
}

export function findFinesse(engine: Engine, snapshot: EngineSnapshot, target: Cell[]): FinesseResult | null {
  const result = referencePath(engine, snapshot, target) ?? search(engine, snapshot, target, false) ?? search(engine, snapshot, target, true);
  return result && !engine.misc.allowed.hardDrop ? { ...result, drop: 'lock' } : result;
}
