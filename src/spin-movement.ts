import { legal, type Engine, type EngineSnapshot, type TetrominoSnapshot } from '@haelp/teto/engine';
import { copyPiece, type Cell, type FinesseResult, type Move } from './finesse';
import { sameCells } from './practice';
import { stableKey } from './analysis';

export type SpinRotation = { from: number; to: number; direction: 'CW' | 'CCW' | '180'; kick: [number, number]; index: number | null; changed: boolean };
export type SpinEvidence = { rotation: SpinRotation | null; geometric: boolean; used180: boolean; softDrop: boolean; usedKick: boolean; spin: string };
type Node = { falling: TetrominoSnapshot; spin: EngineSnapshot['lastSpin']; rotation: SpinRotation | null; parent: number; move: Move | null; cost: number; soft: boolean; half: boolean; kicked: boolean };
export type SpinPlacement = { target: Cell[]; path: FinesseResult; evidence: SpinEvidence };

export function rotationMove(engine: Engine, move: Move): SpinRotation | null | false {
  const before = engine.falling.snapshot(), piece = copyPiece(engine, before), cells=piece.absoluteBlocks;
  const kick = piece.rotate(engine.board.state, engine.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false);
  if (!kick || !engine.press(move as 'rotateCW' | 'rotateCCW' | 'rotate180')) return false;
  return { from: before.rotation, to: engine.falling.rotation, direction: move === 'rotateCW' ? 'CW' : move === 'rotateCCW' ? 'CCW' : '180', kick: typeof kick === 'object' ? [...kick.kick] : [0, 0], index: typeof kick === 'object' ? kick.index : null, changed:!sameCells(cells,engine.falling.absoluteBlocks) };
}

function movePiece(engine: Engine, move: Move) {
  if (move === 'down') {
    if (!legal(engine.falling.absoluteAt({ y: engine.falling.y - 1 }), engine.board.state)) return false;
    engine.falling.y--;
    if (engine.gameOptions.spinBonuses !== 'stupid') engine.lastSpin = null;
    return true;
  }
  return engine[move as 'moveLeft' | 'moveRight' | 'dasLeft' | 'dasRight' | 'softDrop']();
}

export function spinEvidence(engine: Engine, rotation: SpinRotation | null, softDrop: boolean, used180: boolean, usedKick: boolean): SpinEvidence {
  const grounded = !legal(engine.falling.absoluteAt({ y: engine.falling.y - 1 }), engine.board.state);
  const geometric = !!rotation?.changed && grounded && (rotation.kick.some(Boolean) || !legal(engine.falling.absoluteAt({ y: engine.falling.y + 1 }), engine.board.state));
  return { rotation, geometric, softDrop, used180, usedKick, spin: engine.lastSpin ?? 'none' };
}

export function applySpinPath(engine: Engine, path: FinesseResult) {
  let rotation: SpinRotation | null = null, soft = false, half = false, kicked = false;
  for (const move of path.moves) {
    if (move.startsWith('rotate')) {
      const next = rotationMove(engine, move); if (!next) throw new Error('Unreachable rotation.');
      rotation = next; half ||= move === 'rotate180'; kicked ||= next.changed && next.kick.some(Boolean);
    } else {
      if (!movePiece(engine, move)) throw new Error('Unreachable movement.');
      rotation = null; soft ||= move === 'down' || move === 'softDrop';
    }
  }
  const proof = spinEvidence(engine, rotation, soft, half, kicked);
  const result = engine.hardDrop(); proof.spin = result.spin;
  return { result, evidence: proof };
}

export function enumerateSpinPlacements(engine: Engine, snapshot: EngineSnapshot, stop: (states: number) => boolean = () => false, detailed = true) {
  engine.fromSnapshot(snapshot); engine.misc.movement.infinite = true;
  const board = engine.board.state, found = new Map<string, SpinPlacement>();
  if (!legal(engine.falling.absoluteBlocks, board)) return { placements: [], complete: true, states: 0 };
  const pending: Node[] = [{ falling: snapshot.falling, spin: snapshot.lastSpin, rotation: null, parent: -1, move: null, cost: 0, soft: false, half: false, kicked: false }];
  const key = (node: Node) => `${node.falling.location[0]},${Math.floor(node.falling.location[1])},${Number(node.falling.location[1] % 1 !== 0)},${node.falling.rotation},${node.falling.aox},${node.falling.aoy}|${node.spin}|${detailed ? stableKey(node.rotation) : ""}|${detailed ? `${Number(node.soft)}${Number(node.half)}${Number(node.kicked)}` : ""}`;
  const costs = new Map<string,number>([[key(pending[0]),0]]), buckets:number[][]=[[0]];
  const restore = (node: Node) => { Object.assign(engine.falling, node.falling, { location: [...node.falling.location] }); engine.lastSpin = node.spin; engine.state = 0; };
  const pathTo = (index: number): Move[] => { const path: Move[] = []; for (; pending[index].parent >= 0; index = pending[index].parent) path.push(pending[index].move!); return path.reverse(); };
  const moves: Move[] = ['moveLeft','moveRight','dasLeft','dasRight','rotateCW','rotateCCW', ...(engine.misc.allowed.spin180 ? ['rotate180' as const] : []), 'softDrop', ...(engine.handling.sdf === 41 ? [] : ['down' as const])];
  let complete = true, visited = 0;
  movement: for(let cost=0;cost<buckets.length;cost++) for(let cursor=0;cursor<(buckets[cost]?.length??0);cursor++) {
    const i=buckets[cost][cursor],node=pending[i];if(costs.get(key(node))!==node.cost)continue;
    if ((visited & 31) === 0 && stop(visited)) { complete = false; break movement; }
    visited++; restore(node);
    const proof = spinEvidence(engine, node.rotation, node.soft, node.half, node.kicked);
    const dropped = copyPiece(engine, node.falling); dropped.softDrop(board);
    const target = dropped.absoluteBlocks;
    if (!sameCells(target, engine.falling.absoluteBlocks)) { proof.geometric = false; if (engine.gameOptions.spinBonuses !== 'stupid') proof.spin = 'none'; }
    const identity = `${target.map(cell => cell.join(',')).sort().join(';')}|${detailed ? stableKey(proof) : proof.spin}`;
    const previous = found.get(identity);
    if (!previous || node.cost < previous.path.cost) found.set(identity, { target, evidence: proof, path: { moves: pathTo(i), cost: node.cost, source: 'extended', drop: node.soft ? 'soft' : 'hard' } });
    for (const move of moves) {
      restore(node); let rotation: SpinRotation | null = null;
      if (move.startsWith('rotate')) { const next = rotationMove(engine, move); if (!next) continue; rotation = next; }
      else if (!movePiece(engine, move)) continue;
      const soft = move === 'down' || move === 'softDrop';
      const next: Node = { falling: engine.falling.snapshot(), spin: engine.lastSpin, rotation, parent: i, move, cost: node.cost + Number(!soft), soft: node.soft || soft, half: node.half || move === 'rotate180', kicked: node.kicked || !!rotation?.changed && rotation.kick.some(Boolean) };
      const signature = key(next); if ((costs.get(signature)??Infinity)<=next.cost) continue;
      costs.set(signature,next.cost);buckets[next.cost]??=[];buckets[next.cost].push(pending.length);pending.push(next);
    }
  }
  engine.fromSnapshot(snapshot);
  return { placements: [...found.values()], complete, states: visited };
}

