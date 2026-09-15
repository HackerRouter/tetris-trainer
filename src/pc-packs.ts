import { decoder } from 'tetris-fumen';
import type { Mino } from '@haelp/teto/engine';
import catalog from './opener-catalog.json';
import { createEngine } from './engine';
import { withGeneratedPacks, type AnalysisContext } from './analysis-context';
import { frozenContext, type PcScene } from './pc-scenes';

export function pcoScene(source: AnalysisContext, mirror = false, variant = 0, seed = 1): PcScene {
  if (source.rules.board.width !== 10) throw new Error('The PCO pack requires a ten-column board.');
  const context = frozenContext(source), opener = catalog.find(item => item.id === 'pco')!, field = decoder.decode(opener.fumen)[0].field;
  context.rules.bag = '7-bag'; context.settings.custom.bag = '7-bag'; context.rules.hold = true; context.settings.custom.hold = true;
  const engine = createEngine(context.settings, seed, context.rules), snapshot = engine.snapshot({ isUndoRedo: true });
  const symbol = (piece: string) => (mirror ? ({ j: 'l', l: 'j', s: 'z', z: 's' } as Record<string,string>)[piece] ?? piece : piece) as Mino;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) {
    const piece = field.at(x,y).toLowerCase(); if (piece !== '_') snapshot.board[y][mirror ? 9-x : x] = { mino: symbol(piece), connections: 0 };
  }
  snapshot.hold = 'i' as Mino;
  if (variant === 1) {
    for (let y = 0; y < 4; y++) snapshot.board[y][mirror ? 3 : 6] = { mino: 'i' as Mino, connections: 0 };
    snapshot.hold = null;
  }
  context.snapshot = snapshot; context.currentKnown = true; withGeneratedPacks(context);
  return { id: crypto.randomUUID(), name: `PCO ${variant ? 'I placed' : 'I held'}${mirror ? ' mirrored' : ''}`, source: `PCO shell from ${opener.source}; fresh second bag, seed ${seed}. Alternative allocations are found by the PC solver.`, context, future: true, finiteQueue: false };
}
