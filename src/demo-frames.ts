import type { Engine, TetrominoSnapshot } from '@haelp/teto/engine';
import { copyPiece } from './finesse';
import type { GuideStep } from './guide';
import { sameCells, type Demonstration } from './practice';

export type DemoFrame = { piece: TetrominoSnapshot; label: string; duration: number; step: number };

export function buildDemoFrames(scene: Demonstration, engine: Engine, steps: GuideStep[]): DemoFrame[] {
  const board = scene.snapshot.board, piece = copyPiece(engine, scene.snapshot.falling);
  const frames: DemoFrame[] = [{ piece: piece.snapshot(), label: 'Start here', duration: 1100, step: -1 }];
  let step = 0;
  const add = (label: string, duration = 700) => frames.push({ piece: piece.snapshot(), label, duration, step });
  for (const instruction of steps) {
    const { move } = instruction;
    if (move === 'hardDrop') { add('Hard drop', 600); piece.softDrop(board); }
    else if (move === 'waitLock') add('Wait for automatic lock', Math.max(700, Math.min(2000, engine.misc.movement.lockTime * 1000 / 60)));
    else if (move === 'dasLeft' || move === 'dasRight') {
      const direction = move === 'dasLeft' ? 'moveLeft' : 'moveRight';
      while (piece[direction](board)) add(move === 'dasLeft' ? 'Hold left, then release' : 'Hold right, then release', 150);
    } else if (move === 'softDrop') {
      const dropped = copyPiece(engine, piece.snapshot()); dropped.softDrop(board);
      while (piece.y > dropped.y) { piece.location[1] -= 1; add('Soft drop, then release', 80); }
      piece.location = [...dropped.location];
      add('Release soft drop', 500);
    } else if (move === 'down') {
      for (let row = 0; row < instruction.count; row++) { piece.y -= 1; add('Soft drop one row', 220); }
      add('Release soft drop', 500);
    } else if (move === 'rotateCW' || move === 'rotateCCW' || move === 'rotate180') {
      if (!piece.rotate(board, engine.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false)) throw new Error('This rotation cannot reach the shown target with the current rules.');
      add(move === 'rotateCW' ? 'Rotate CW' : move === 'rotateCCW' ? 'Rotate CCW' : 'Rotate 180°', 950);
    } else { piece[move](board); add(move === 'moveLeft' ? 'Tap left' : 'Tap right'); }
    step++;
  }
  if (!sameCells(piece.absoluteBlocks, scene.target)) throw new Error('This guide no longer matches its target. Generate a new placement hint.');
  add('Complete · Replaying shortly', 1800);
  return frames;
}
