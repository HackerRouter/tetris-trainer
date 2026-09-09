import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legal, type Engine, type EngineSnapshot, type Mino } from '@haelp/teto/engine';
import { createEngine } from '../src/engine.ts';
import { TrainerGame } from '../src/game.ts';

const instantSettings = { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } };
import { copyPiece, countFinesseInputs, findFinesse, type Cell, type FinesseResult } from '../src/finesse.ts';
import { finesseTable } from '../src/finesse-data.ts';
import { defaults, type GameAction } from '../src/settings.ts';

const cellKey = (cells: Cell[]) => cells.map(cell => cell.join(',')).sort().join(';');
const bottomKey = (cells: Cell[]) => {
  const bottom = Math.min(...cells.map(([, y]) => y));
  return cellKey(cells.map(([x, y]) => [x, y - bottom]));
};

function scenario(symbol: Mino) {
  const engine = createEngine(defaults, 12);
  engine.initiatePiece(symbol);
  return { engine, snapshot: engine.snapshot() };
}

function landing(engine: Engine, snapshot: EngineSnapshot, x: number, rotation: number) {
  const piece = copyPiece(engine, snapshot.falling);
  piece.x = x;
  piece.rotation = rotation;
  assert.ok(legal(piece.absoluteBlocks, snapshot.board));
  piece.softDrop(snapshot.board);
  return piece.absoluteBlocks;
}

function execute(engine: Engine, snapshot: EngineSnapshot, result: FinesseResult) {
  const piece = copyPiece(engine, snapshot.falling);
  for (const move of result.moves) {
    if (move === 'rotateCW' || move === 'rotateCCW' || move === 'rotate180') {
      assert.ok(piece.rotate(snapshot.board, engine.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false));
    } else if (move === 'down') {
      piece.y -= 1;
    } else {
      assert.ok(piece[move](snapshot.board));
    }
    assert.ok(legal(piece.absoluteBlocks, snapshot.board));
  }
  piece.softDrop(snapshot.board);
  return piece.absoluteBlocks;
}

function tap(game: TrainerGame, key: GameAction) {
  game.input.press(key); game.step(); game.input.release(key); game.step();
}

function seedFor(symbol: Mino) {
  const seeds: Record<string, number> = { z: 104730, j: 314188, o: 523646, i: 628375, s: 733104, l: 837833, t: 942562 };
  return seeds[symbol];
}

test('every upstream table entry preserves its input budget and has an executable hard-drop hint', () => {
  let checked = 0;
  for (const [symbol, positions] of Object.entries(finesseTable)) {
    const { engine, snapshot } = scenario(symbol as Mino);
    for (const [position, rotations] of Object.entries(positions)) {
      rotations.forEach((code, rotation) => {
        if (code === null) return;
        const target = landing(engine, snapshot, Number(position) + (symbol === 'o' ? 1 : 0), rotation);
        const result = findFinesse(engine, snapshot, target);
        assert.ok(result, `${symbol} ${position} ${rotation}`);
        assert.equal(result.cost, code.length, `${symbol} ${position} ${rotation}`);
        assert.equal(result.drop, 'hard');
        assert.equal(cellKey(execute(engine, snapshot, result)), cellKey(target));
        checked++;
      });
    }
  }
  assert.ok(checked > 170);
});

test('all 162 distinct empty-board placements have complete budgets, including upstream omissions', () => {
  const normal = [1, 2, 1, 0, 1, 2, 2, 1];
  const asymmetric = [normal, [2, 2, 3, 2, 1, 2, 3, 3, 2], [2, 3, 2, 1, 2, 3, 3, 2], [2, 3, 2, 1, 2, 3, 3, 2, 2]];
  const budgets: Record<string, number[][]> = {
    o: [[1, 2, 2, 1, 0, 1, 2, 2, 1]],
    t: asymmetric, j: asymmetric, l: asymmetric,
    s: [normal, [2, 2, 2, 1, 1, 2, 3, 2, 2]],
    z: [normal, [2, 2, 2, 1, 1, 2, 3, 2, 2]],
    i: [[1, 2, 1, 0, 1, 2, 1], [2, 2, 2, 2, 1, 1, 2, 2, 2, 2]]
  };
  let checked = 0;
  for (const [symbol, rotations] of Object.entries(budgets)) {
    const { engine, snapshot } = scenario(symbol as Mino);
    rotations.forEach((columns, rotation) => {
      const piece = copyPiece(engine, snapshot.falling);
      piece.rotation = rotation;
      const offset = Math.min(...piece.blocks.map(([x]) => x));
      columns.forEach((cost, column) => {
        const target = landing(engine, snapshot, column - offset, rotation);
        const result = findFinesse(engine, snapshot, target);
        assert.ok(result, `${symbol} ${rotation} column ${column}`);
        assert.equal(result.cost, cost, `${symbol} ${rotation} column ${column}`);
        assert.equal(result.drop, 'hard');
        assert.equal(cellKey(execute(engine, snapshot, result)), cellKey(target));
        checked++;
      });
    });
  }
  assert.equal(checked, 162);
});

test('180-degree rotation counts once, while two quarter-turns trigger retry', () => {
  const game = new TrainerGame(instantSettings, seedFor('t')); game.start();
  tap(game, 'rotateCW'); tap(game, 'rotateCW'); tap(game, 'hardDrop');
  assert.equal(game.faults, 1);
  assert.equal(game.fault?.actual, 2);
  assert.deepEqual(game.fault?.path.moves, ['rotate180']);
  assert.equal(game.fault?.path.cost, 1);
  tap(game, 'rotate180'); tap(game, 'hardDrop');
  assert.equal(game.engine.stats.pieces, 1);
  assert.equal(game.perfects, 1);
  assert.equal(game.placements[1].finesseInputs, 1);
  assert.deepEqual(game.placements[1].inputs, ['rotate180', 'hardDrop']);
});

test('equivalent shapes do not excuse unnecessary rotations', () => {
  for (const symbol of ['o', 'i', 's', 'z'] as const) {
    const game = new TrainerGame(instantSettings, seedFor(symbol)); game.start();
    tap(game, 'rotate180'); tap(game, 'hardDrop');
    assert.equal(game.fault?.actual, 1, symbol);
    assert.equal(game.fault?.path.cost, 0, symbol);
  }
});

test('equal-cost alternative sequences are accepted', () => {
  const game = new TrainerGame(instantSettings, seedFor('t')); game.start();
  tap(game, 'rotateCW'); tap(game, 'moveLeft'); tap(game, 'hardDrop');
  assert.equal(game.faults, 0);
  assert.equal(game.placements[0].finesseInputs, 2);
  assert.deepEqual(game.placements[0].finesse?.moves, ['moveLeft', 'rotateCW']);
});

test('DAS repeats count once and soft drop, hard drop, hold are not finesse inputs', () => {
  assert.equal(countFinesseInputs(['moveLeft', 'rotate180', 'softDrop', 'hold', 'hardDrop']), 2);
  const game = new TrainerGame(instantSettings, seedFor('o')); game.start();
  game.input.press('moveLeft');
  for (let frame = 0; frame < 20; frame++) game.step();
  game.input.release('moveLeft'); game.step();
  tap(game, 'softDrop'); tap(game, 'hardDrop');
  assert.equal(game.placements[0].finesseInputs, 1);
  assert.equal(game.faults, 0);
});

test('extra inputs into a wall are still counted', () => {
  const game = new TrainerGame(instantSettings, seedFor('o')); game.start();
  game.input.press('moveLeft');
  for (let frame = 0; frame < 20; frame++) game.step();
  game.input.release('moveLeft'); game.step();
  tap(game, 'moveLeft'); tap(game, 'hardDrop');
  assert.equal(game.fault?.actual, 2);
  assert.equal(game.fault?.path.cost, 1);
});

test('piece input accounting handles hold and multiple locks within a frame', () => {
  const game = new TrainerGame(instantSettings, seedFor('t')); game.start();
  tap(game, 'moveLeft');
  for (const key of ['moveRight', 'hold', 'hardDrop', 'moveLeft', 'hardDrop'] as const) {
    game.input.press(key); game.input.release(key);
  }
  game.step();
  assert.equal(game.placements.length, 2);
  assert.deepEqual(game.placements[0].inputs, ['hardDrop']);
  assert.deepEqual(game.placements[1].inputs, ['moveLeft', 'hardDrop']);
  assert.equal(game.placements[0].finesseInputs, 0);
  assert.equal(game.placements[1].finesseInputs, 1);
  assert.equal(game.faults, 0);
});

test('a rejected placement discards subsequent locks from the same frame', () => {
  const game = new TrainerGame(instantSettings, seedFor('t')); game.start();
  const before = game.engine.snapshot();
  for (const key of ['rotateCW', 'rotateCW', 'hardDrop', 'moveLeft', 'hardDrop'] as const) {
    game.input.press(key); game.input.release(key);
  }
  game.step();
  assert.equal(game.faults, 1);
  assert.equal(game.perfects, 0);
  assert.equal(game.placements.length, 1);
  assert.equal(game.engine.stats.pieces, 0);
  assert.deepEqual(game.engine.board.state, before.board);
  assert.deepEqual(game.engine.queue.snapshot(), before.queue);
  assert.deepEqual(game.fault?.path.moves, ['rotate180']);
  tap(game, 'rotate180'); tap(game, 'hardDrop');
  assert.equal(game.engine.stats.pieces, 1);
  assert.equal(game.perfects, 1);
  assert.equal(game.placements[1].finesseInputs, 1);
});

test('hold resets the piece count across frames and invalid hold does not reset it', () => {
  const game = new TrainerGame(instantSettings, seedFor('t')); game.start();
  tap(game, 'rotate180'); tap(game, 'hold');
  tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hold'); tap(game, 'hardDrop');
  assert.equal(game.placements[0].finesseInputs, 2);
  assert.equal(game.faults, 1);
  assert.equal(game.engine.holdLocked, true);
  tap(game, 'hardDrop');
  assert.equal(game.placements[1].finesseInputs, 0);
  assert.equal(game.engine.stats.pieces, 1);
});

test('direct hard drop wins even when soft drop can use the stack to save an input', () => {
  const { engine } = scenario('o');
  engine.board.state[0][8] = 'i'; engine.board.state[1][8] = 'i';
  const snapshot = engine.snapshot();
  const target = landing(engine, snapshot, 6, 0);
  const shortcut = copyPiece(engine, snapshot.falling);
  shortcut.softDrop(snapshot.board); shortcut.dasRight(snapshot.board);
  assert.equal(cellKey(shortcut.absoluteBlocks), cellKey(target));
  const result = findFinesse(engine, snapshot, target)!;
  assert.equal(result.cost, 2);
  assert.deepEqual(result.moves, ['moveRight', 'moveRight']);
  assert.equal(result.drop, 'hard');
  assert.equal(cellKey(execute(engine, snapshot, result)), cellKey(target));
});

test('soft drop is used only when a ceiling obstructs the target', () => {
  const { engine } = scenario('o');
  for (let y = 0; y < 6; y++) engine.board.state[y][9] = 'i';
  engine.board.state[3][7] = 'i'; engine.board.state[3][8] = 'i';
  const snapshot = engine.snapshot();
  const target: Cell[] = [[7, 0], [8, 0], [7, 1], [8, 1]];
  const result = findFinesse(engine, snapshot, target)!;
  assert.ok(result);
  assert.equal(result.drop, 'soft');
  assert.ok(result.moves.includes('softDrop'));
  assert.ok(!result.moves.includes('down'));
  assert.equal(cellKey(execute(engine, snapshot, result)), cellKey(target));
});

test('initial rotation is evaluated from the actual piece state', () => {
  const { engine } = scenario('t');
  engine.falling.rotate(engine.board.state, engine.kickTableName, 2, false);
  const snapshot = engine.snapshot();
  const target = landing(engine, snapshot, engine.falling.x, 2);
  const result = findFinesse(engine, snapshot, target)!;
  assert.equal(result.cost, 0);
  assert.deepEqual(result.moves, []);
});

test('upstream I-piece hint mistakes are repaired without changing the budget', () => {
  const { engine, snapshot } = scenario('i');
  const target = landing(engine, snapshot, 5, 1);
  const result = findFinesse(engine, snapshot, target)!;
  assert.equal(result.cost, 2);
  assert.deepEqual(result.moves, ['dasRight', 'rotateCCW']);
  assert.equal(bottomKey(execute(engine, snapshot, result)), bottomKey(target));
});
