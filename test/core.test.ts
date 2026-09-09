import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, loadSettings, storageKey, validateSettings } from '../src/settings.ts';
import { createEngine } from '../src/engine.ts';
import { FrameInput } from '../src/input.ts';
import { TrainerGame } from '../src/game.ts';

const instantSettings = { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } };

test('settings migrate handling and keys together', () => {
  const data = new Map([
    ['tetrio-trainer-settings', JSON.stringify({ arr: 1.2, das: 9.4, dcd: 2, sdf: 13 })],
    ['tetrio-trainer-keys', JSON.stringify({ Left: 'j', Right: 'KeyL' })]
  ]);
  const { settings } = loadSettings({ getItem: key => data.get(key) ?? null });
  assert.equal(settings.handling.das, 9.4);
  assert.equal(settings.handling.sdf, 13);
  assert.equal(settings.bindings.moveLeft, 'KeyJ');
  assert.equal(settings.bindings.moveRight, 'KeyL');
  assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(settings))), settings);
});

test('corrupt persisted settings safely load defaults', () => {
  const loaded = loadSettings({ getItem: key => key === storageKey ? '{broken' : null });
  assert.deepEqual(loaded.settings, defaults);
  assert.ok(loaded.message);
});

test('reject invalid values, duplicate keys and incomplete imports', () => {
  for (const arr of [NaN, Infinity, -1, 21, 0.15]) {
    const settings = structuredClone(defaults); settings.handling.arr = arr;
    assert.throws(() => validateSettings(settings));
  }
  const duplicate = structuredClone(defaults); duplicate.bindings.hold = duplicate.bindings.hardDrop;
  assert.throws(() => validateSettings(duplicate), /already assigned/);
  assert.throws(() => validateSettings({ version: 1 }));
});

test('DAS delays repeated movement and ARR controls its interval', () => {
  const settings = structuredClone(defaults); settings.handling.das = 8; settings.handling.arr = 3;
  const engine = createEngine(settings, 12), input = new FrameInput();
  const tick = () => engine.tick(input.drain(engine.frame));
  const start = engine.falling.x;
  input.press('moveRight'); tick();
  assert.equal(engine.falling.x, start + 1);
  for (let i = 0; i < 5; i++) tick();
  assert.equal(engine.falling.x, start + 1);
  for (let i = 0; i < 6; i++) tick();
  assert.ok(engine.falling.x > start + 1);
  input.release('moveRight'); tick();
  const end = engine.falling.x;
  for (let i = 0; i < 20; i++) tick();
  assert.equal(engine.falling.x, end);
});

test('zero ARR moves to the wall after DAS, independently of browser repeats', () => {
  const settings = structuredClone(defaults); settings.handling.das = 2;
  const engine = createEngine(settings, 12), input = new FrameInput();
  assert.equal(input.press('moveRight'), true);
  assert.equal(input.press('moveRight'), false);
  for (let i = 0; i < 5; i++) engine.tick(input.drain(engine.frame));
  assert.equal(Math.max(...engine.falling.absoluteBlocks.map(([x]) => x)), 9);
  input.release('moveRight'); engine.tick(input.drain(engine.frame));
  assert.equal(engine.input.rShift.held, false);
});

test('SDF instant reaches the ghost landing and pause releases held keys', () => {
  const game = new TrainerGame(instantSettings, 12); game.start();
  game.input.press('softDrop'); game.step();
  assert.equal(Math.min(...game.engine.falling.absoluteBlocks.map(([, y]) => y)), 0);
  game.input.press('moveLeft'); game.step(); game.pause();
  assert.equal(game.engine.input.lShift.held, false);
  assert.equal(game.engine.input.keys.softDrop, false);
  const frame = game.engine.frame;
  game.step(); assert.equal(game.engine.frame, frame);
});

test('hard drop records the locked piece instead of the next piece', () => {
  const game = new TrainerGame(instantSettings, 12); game.start();
  const symbol = game.engine.falling.symbol;
  game.input.press('hardDrop'); game.step();
  assert.equal(game.placements[0].piece, symbol);
  assert.equal(game.placements[0].cells.length, 4);
  assert.equal(Math.min(...game.placements[0].cells.map(([, y]) => y)), 0);
  assert.equal(game.engine.stats.pieces, 1);
  assert.equal(game.faults, 0);
});

test('an inefficient placement restores the queue and allows another target', () => {
  const game = new TrainerGame(instantSettings, 12); game.start();
  const before = game.engine.snapshot();
  for (const key of ['moveLeft', 'moveRight', 'hardDrop'] as const) {
    game.input.press(key); game.step(); game.input.release(key); game.step();
  }
  assert.equal(game.faults, 1);
  assert.equal(game.engine.stats.pieces, 0);
  assert.deepEqual(game.engine.board.state, before.board);
  assert.deepEqual(game.engine.queue.snapshot(), before.queue);
  assert.equal(game.engine.falling.symbol, before.falling.symbol);
  assert.equal(game.fault?.path.cost, 0);
  game.input.press('moveLeft'); game.step(); game.input.release('moveLeft'); game.step();
  game.input.press('hardDrop'); game.step();
  assert.equal(game.engine.stats.pieces, 1);
  assert.equal(game.fault, null);
});
