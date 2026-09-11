import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaults, type GameAction } from '../src/settings.ts';
import { TrainerGame } from '../src/game.ts';
import { drillCatalog, makeDrillSet, defaultDrillFilter } from '../src/drills.ts';
import { analyzeSession, faultGroups, focusedDrills } from '../src/history.ts';
import { buildPlayback } from '../src/playback.ts';
import { readReplay } from '../src/replay.ts';
import { exportNative } from '../src/native-export.ts';

const tick = (game: TrainerGame, frames: number) => { for (let i = 0; i < frames; i++) game.step(); };
const tap = (game: TrainerGame, key: GameAction) => { game.input.press(key); game.step(); game.input.release(key); };
function play() { const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; const game = new TrainerGame(settings, 17); game.start(); return game; }

test('Just think defaults to off and piece style freezes each new piece until fresh input', () => {
  const game = play(); assert.equal(game.settings.training.justThink, false); assert.equal(game.settings.training.thinkStyle, 'piece');
  game.setJustThink(true, 'piece'); const before = game.engine.snapshot(); tick(game, 120);
  assert.equal(game.elapsedMs, 0); assert.deepEqual(game.engine.snapshot(), before);
  tap(game, 'moveLeft'); tick(game, 60); assert.ok(game.elapsedMs > 1000);
  tap(game, 'hardDrop'); const time = game.elapsedMs; assert.equal(game.thinking, true);
  tick(game, 120); assert.equal(game.elapsedMs, time);
  game.setJustThink(false, 'piece'); tick(game, 60); assert.equal(game.elapsedMs, time + 1000);
});

test('input-style thinking advances during held keys, freezes after release, and preserves retry waiting', () => {
  const game = play(); game.setJustThink(true, 'input'); tick(game, 120); assert.equal(game.elapsedMs, 0);
  game.input.press('moveLeft'); tick(game, 60); assert.equal(game.elapsedMs, 1000);
  game.input.release('moveLeft'); game.step(); const time = game.elapsedMs; tick(game, 120); assert.equal(game.elapsedMs, time);
  tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); assert.equal(game.faults, 1);
  assert.equal(game.waitingForInput, true); tick(game, 120); assert.equal(game.elapsedMs, 0);
});

test('pure drills cover all empty-board placements, filter targets and continue without building a stack', () => {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  const catalog = drillCatalog(settings); assert.equal(catalog.length, 162);
  const set = makeDrillSet(settings, { ...defaultDrillFilter, pieces: ['o'], columns: [4], rotations: [0], rounds: 0 });
  assert.equal(set.scenes.length, 1); const game = new TrainerGame(settings, 1, set); game.start();
  for (let i = 0; i < 5; i++) { tap(game, 'hardDrop'); assert.equal(game.engine.board.state.flat().filter(Boolean).length, 0); }
  assert.equal(game.practice!.completed, 5); assert.equal(game.status, 'playing'); assert.equal(game.finish(), true);
  assert.throws(() => makeDrillSet(settings, { ...defaultDrillFilter, pieces: [] }));
});

test('statistics count repeated and unchecked faults, rank patterns, and create targeted empty-board drills', async () => {
  const game = play();
  for (let i = 0; i < 2; i++) { tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); }
  game.setFinesseEnabled(false); tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop');
  const record = await analyzeSession(game.export()); assert.equal(record.faults.length, 3); assert.equal(record.attempts, 3); assert.equal(record.extra, 6);
  const groups = faultGroups([record]); assert.equal(groups.length, 1); assert.equal(groups[0].count, 3);
  const set = focusedDrills(groups, game.settings, false); assert.equal(set.scenes.length, 1); assert.equal(set.loop, true);
  assert.equal(set.scenes[0].snapshot.board.flat().filter(Boolean).length, 0);
});

test('trainer playback reconstructs faults, rollback and final accepted board', async () => {
  const game = play(); tick(game, 10); tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); tap(game, 'hardDrop');
  const replay = await buildPlayback(readReplay(game.export(), 'Test')[0], game.settings);
  assert.ok(replay.frames.some(frame => frame.label === 'retry')); assert.equal(replay.engine.stats.pieces, game.engine.stats.pieces);
  assert.deepEqual(replay.engine.board.state, game.engine.board.state);
});

test('native playback accepts a real TETR.IO recording independently of its fault count', async () => {
  const value = JSON.parse(await readFile('test/fixtures/viewtris-40l.ttr', 'utf8'));
  const playback = await buildPlayback(readReplay(value, 'Native')[0], defaults);
  assert.equal(playback.engine.stats.pieces, 102); assert.equal(playback.engine.stats.lines, 40); assert.ok(playback.frames.length > 3000);
});

test('TETR.IO export removes failed branches and round-trips the successful board', async () => {
  const game = play(); tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); tap(game, 'hardDrop');
  const native = await exportNative(game.export()); assert.equal(native.verified, false);
  const playback = await buildPlayback(readReplay(native, 'Export')[0], game.settings);
  assert.equal(playback.engine.stats.pieces, 1);
  const tiles = (board: typeof game.engine.board.state) => board.map(row => row.map(tile => tile?.mino ?? null));
  assert.deepEqual(tiles(playback.engine.board.state), tiles(game.engine.board.state));
});
