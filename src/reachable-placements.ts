import { legal, type Engine, type EngineSnapshot } from '@haelp/teto/engine';
import { copyPiece, type Cell, type Move, type FinesseResult } from './finesse';

export function reachablePlacements(engine: Engine, snapshot: EngineSnapshot, height: number, stop: (processed: number) => boolean, maxStates = Infinity) {
  const found = new Map<string, { target: Cell[]; path: FinesseResult }>();
  const moves: Move[] = ['moveLeft', 'moveRight', 'dasLeft', 'dasRight', 'rotateCW', 'rotateCCW'];
  if (engine.misc.allowed.spin180) moves.push('rotate180');
  const lower: Move[] = engine.handling.sdf === 41 ? ['softDrop'] : ['softDrop', 'down'];
  const piece = copyPiece(engine, snapshot.falling);
  if (!legal(piece.absoluteBlocks, snapshot.board)) return { placements: [], complete: true, states: 0, processed: 0 };
  const pending: { x: number; y: number; rotation: number; parent: number; move: Move | null; cost: number; soft: boolean }[] = [{ x: piece.x, y: piece.location[1], rotation: piece.rotation, parent: -1, move: null, cost: 0, soft: false }];
  const stateKey = () => `${piece.x},${piece.y},${Number(piece.location[1] !== piece.y)},${piece.rotation}`;
  const seen = new Set<string>([stateKey()]);
  const pathTo = (index: number) => {
    const moves: Move[] = [];
    while (pending[index].parent >= 0) { moves.push(pending[index].move!); index = pending[index].parent; }
    return moves.reverse();
  };
  let complete = true, processed = 0;
  for (let i = 0; i < pending.length; i++) {
    if (i >= maxStates || (i & 31) === 0 && stop(i)) { complete = false; break; }
    processed++;
    const node = pending[i];
    piece.x = node.x; piece.location[1] = node.y; piece.rotation = node.rotation;
    for (;;) {
      let next = Math.round(1e6 * (piece.location[1] - 1)) / 1e6, previous = piece.location[1] - 1;
      if (next % 1 === 0) next -= 1e-6;
      if (previous % 1 === 0) previous += 2e-6;
      if (!legal(piece.absoluteAt({ y: next }), snapshot.board) || !legal(piece.absoluteAt({ y: previous }), snapshot.board)) break;
      piece.location[1] = next;
    }
    const target = piece.absoluteBlocks, targetKey = target.map(cell => cell.join(',')).sort().join(';');
    if (target.every(([, y]) => y >= 0 && y < height)) {
      const previous = found.get(targetKey);
      if (!previous || Number(node.soft) < Number(previous.path.drop === 'soft') || (node.soft === (previous.path.drop === 'soft') && node.cost < previous.path.cost)) {
        const path: FinesseResult = { cost: node.cost, moves: pathTo(i), source: 'extended', drop: node.soft ? 'soft' : 'hard' };
        found.set(targetKey, { target, path });
      }
    }
    for (const move of [...moves, ...lower]) {
      piece.x = node.x; piece.location[1] = node.y; piece.rotation = node.rotation;
      const valid = move === 'down' ? (piece.y--, legal(piece.absoluteBlocks, snapshot.board)) : move.startsWith('rotate') ? piece.rotate(snapshot.board, engine.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false) : piece[move as 'moveLeft' | 'moveRight' | 'dasLeft' | 'dasRight' | 'softDrop'](snapshot.board);
      if (!valid) continue;
      const key = stateKey();
      if (!seen.has(key)) {
        seen.add(key);
        pending.push({ x: piece.x, y: piece.location[1], rotation: piece.rotation, parent: i, move, cost: node.cost + Number(!lower.includes(move)), soft: node.soft || lower.includes(move) });
      }
    }
  }
  return { placements: [...found.values()].sort((a, b) => Number(a.path.drop === 'soft') - Number(b.path.drop === 'soft') || a.path.cost - b.path.cost), complete, states: seen.size, processed };
}
