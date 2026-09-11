import { legal, type Mino } from '@haelp/teto/engine';
import { createEngine, spawnSnapshot } from './engine';
import { copyPiece, findFinesse, type Cell } from './finesse';
import { customDefaults, modeDefinitions, type CustomRules } from './modes';
import { sameCells, type PracticeScene, type PracticeSet } from './practice';
import type { Settings } from './settings';

export type DrillFilter = { pieces: string[]; columns: number[]; rotations: number[]; rounds: number };
export const defaultDrillFilter: DrillFilter = { pieces: ['i', 'j', 'l', 'o', 's', 't', 'z'], columns: Array.from({ length: 10 }, (_, i) => i), rotations: [0, 1, 2, 3], rounds: 0 };

export function drillRules(base = customDefaults): CustomRules {
  const rules = structuredClone(base);
  Object.assign(rules, { gravity: 0, infiniteLock: true, hold: false, infiniteHold: false, nextCount: 0, lineGoal: 0, pieceGoal: 0, timeLimit: 0, initialGarbage: 0, roomPreset: '', finesse: true });
  Object.assign(rules.advanced, { garbageRefill: 0, garbageInterval: 0, gravityIncrease: 0, hardDrop: true, entryDelay: 0, lineClearDelay: 0, map: '', sequence: '', repeatSequence: false });
  return rules;
}

export function placementShape(cells: Cell[]) {
  const bottom = Math.min(...cells.map(cell => cell[1]));
  return cells.map(([x, y]) => `${x},${y - bottom}`).sort().join(';');
}

export function drillCatalog(settings: Settings, filter = defaultDrillFilter, customRules = drillRules()): PracticeScene[] {
  if (!filter.pieces.length || !filter.columns.length || !filter.rotations.length) throw new Error('Select at least one piece, column and rotation.');
  const rules = modeDefinitions.custom.rules({ ...settings, custom: customRules }), engine = createEngine(settings, 1, rules), scenes: PracticeScene[] = [];
  for (const symbol of filter.pieces) {
    if (!'ijlostz'.includes(symbol) || symbol.length !== 1) throw new Error('Unknown drill piece.');
    const snapshot = engine.snapshot({ isUndoRedo: true }); snapshot.falling = spawnSnapshot(engine, symbol as Mino);
    for (const rotation of filter.rotations) for (let x = -3; x < engine.board.width; x++) {
      const piece = copyPiece(engine, snapshot.falling); piece.rotation = rotation; piece.x = x;
      if (!legal(piece.absoluteBlocks, snapshot.board)) continue;
      piece.softDrop(snapshot.board);
      const target = piece.absoluteBlocks;
      if (!filter.columns.includes(Math.min(...target.map(cell => cell[0]))) || scenes.some(scene => scene.snapshot.falling.symbol === symbol && sameCells(scene.target, target))) continue;
      const path = findFinesse(engine, snapshot, target);
      if (path) scenes.push({ id: `${symbol}:${placementShape(target)}`, snapshot: structuredClone(snapshot), target, path });
    }
  }
  if (!scenes.length) throw new Error('No placements match these filters. Choose more columns or rotations.');
  return scenes;
}

export function makeDrillSet(settings: Settings, filter = defaultDrillFilter): PracticeSet {
  const customRules = drillRules(), pool = drillCatalog(settings, filter, customRules), scenes: PracticeScene[] = [];
  if (!Number.isInteger(filter.rounds) || filter.rounds < 0 || filter.rounds > 1000) throw new Error('Choose 0–1,000 placements; 0 means endless.');
  const total = filter.rounds || pool.length;
  let deck: PracticeScene[] = [];
  while (scenes.length < total) {
    if (!deck.length) {
      deck = [...pool];
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    scenes.push(structuredClone(deck.pop()!));
  }
  return { name: 'Pure finesse drills', kind: 'pure', scenes, customRules, loop: !filter.rounds };
}
