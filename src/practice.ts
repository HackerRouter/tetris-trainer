import type { EngineSnapshot } from '@haelp/teto/engine';
import type { Cell, FinesseResult } from './finesse';

export type PracticeScene = { id: string; snapshot: EngineSnapshot; target: Cell[]; path: FinesseResult };
export type PracticeSet = { name: string; scenes: PracticeScene[] };
export type Demonstration = PracticeScene & { serial: number; sceneNumber: number };

export function sameCells(a: Cell[], b: Cell[]) {
  const key = (cells: Cell[]) => cells.map(cell => cell.join(',')).sort().join(';');
  return key(a) === key(b);
}
