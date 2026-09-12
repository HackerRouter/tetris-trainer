import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainerGame } from '../src/game.ts';
import { defaults, type GameAction } from '../src/settings.ts';
import { readReplay, loadPractice } from '../src/replay.ts';
import { buildPlayback } from '../src/playback.ts';
import { exportNative } from '../src/native-export.ts';
import { analyzeSession } from '../src/history.ts';

const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.training.undoEnabled = true;
const tap = (game: TrainerGame, key: GameAction) => { game.input.press(key); game.step(); game.input.release(key); game.step(); };
const tiles = (board: any[][]) => board.map(row => row.map(tile => tile?.mino ?? null));

test('same-frame Hold keeps only the Hold when the subsequent placement is retried', async () => {
  const game = new TrainerGame(settings, 17); game.start();
  for (const key of ['hold', 'moveLeft', 'moveRight', 'hardDrop'] as const) game.input.press(key);
  game.step(); assert.equal(game.faults, 1); tap(game, 'hardDrop');
  const recording = game.export();
  assert.deepEqual(recording.events.filter(event => event.type === 'keydown').map(event => event.data.key), ['hold', 'hardDrop']);
  assert.equal(recording.events.some(event => ['undo', 'retry'].includes(event.type)), false);
  const playback = await buildPlayback(readReplay(recording, 'Hold retry')[0], settings);
  assert.equal(playback.duration, game.elapsedMs / 1000); assert.deepEqual(tiles(playback.engine.board.state), tiles(game.engine.board.state));
  assert.equal((await analyzeSession(recording)).faults.length, 1);
  const native = await exportNative(recording);
  assert.equal((await loadPractice(readReplay(native, 'With retained faults')[0], settings)).scenes.length, 1);
  assert.equal(native.replay.frames, recording.timeline.frames);
  assert.equal(native.replay.options.slot_counter4, 'keys'); assert.equal(native.replay.options.slot_counter5, 'finesse');
});

test('multiple undo branches and their sounds disappear while training attempts remain', async () => {
  const game = new TrainerGame(settings, 29); game.start();
  tap(game, 'hardDrop'); tap(game, 'hardDrop'); tap(game, 'hardDrop');
  assert.equal(game.undo(), true); assert.equal(game.undo(), true);
  tap(game, 'moveRight'); tap(game, 'hardDrop');
  const replay = game.export(), playback = await buildPlayback(readReplay(replay, 'Undo')[0], settings);
  assert.equal(replay.placements.length, 4); assert.equal(playback.frames.at(-1)!.pieces, 2);
  assert.equal(playback.frames.flatMap(frame => frame.sounds).filter(sound => sound === 'floor').length, 2);
  assert.equal(playback.frames.some(frame => frame.label.includes('undo')), false);
  assert.deepEqual(tiles(playback.engine.board.state), tiles(game.engine.board.state));
  assert.equal(playback.duration, game.elapsedMs / 1000);
});

test('automatic locks end exactly at the completed frame and replay without a tail', async () => {
  const custom = structuredClone(settings); custom.custom.gravity = 20; custom.custom.infiniteLock = false; custom.custom.lockDelay = 1; custom.custom.pieceGoal = 1;
  const game = new TrainerGame(custom, 17, undefined, 'custom'); game.start();
  for (let i = 0; i < 50 && game.status !== 'complete'; i++) game.step();
  assert.equal(game.status, 'complete');
  const recording = game.export(), playback = await buildPlayback(readReplay(recording, 'Automatic')[0], settings);
  assert.equal(playback.duration, game.elapsedMs / 1000); assert.equal(playback.engine.stats.pieces, 1);
  assert.ok(recording.events.every(event => event.frame <= recording.timeline.frames));
  assert.equal(playback.frames.flatMap(frame => frame.sounds).includes('harddrop'), false);
  assert.equal(playback.frames.flatMap(frame => frame.sounds).filter(sound => sound === 'finish').length, 1);
});
