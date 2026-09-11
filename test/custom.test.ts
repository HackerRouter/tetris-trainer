import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tetromino } from '@haelp/teto/engine';
import { defaults, validateSettings, type GameAction } from '../src/settings.ts';
import { customDefaults, randomizers, validateCustomRules, type CustomRules } from '../src/modes.ts';
import { TrainerGame } from '../src/game.ts';
import { copyPiece, findFinesse } from '../src/finesse.ts';
import { loadPractice, readReplay } from '../src/replay.ts';
import { importTetrioConfig } from '../src/tetrio-config.ts';

function custom(rules: Partial<CustomRules> = {}) {
  const settings = structuredClone(defaults);
  settings.training.countdownSeconds = 0;
  settings.custom = { ...customDefaults, ...rules };
  const game = new TrainerGame(settings, 942562, undefined, 'custom');
  game.start(); return game;
}
function tap(game: TrainerGame, action: GameAction) { game.input.press(action); game.step(); game.input.release(action); }
function tick(game: TrainerGame, frames: number) { for (let i = 0; i < frames; i++) game.step(); }

test('old settings migrate audio and custom options, and invalid rule imports are rejected', () => {
  const old = { ...defaults, audio: undefined, custom: undefined };
  assert.deepEqual(validateSettings(old).custom, customDefaults);
  assert.deepEqual(validateSettings(old).audio, defaults.audio);
  for (const patch of [{ gravity: -1 }, { bag: 'unknown' }, { nextCount: 7 }, { nextCount: 1.2 }, { initialGarbage: 19 }, { seed: Infinity }, { topout: 'ignore' }, { hold: 'yes' }]) assert.throws(() => validateCustomRules({ ...customDefaults, ...patch }));
  assert.throws(() => validateSettings({ ...defaults, audio: { ...defaults.audio, volume: 1.1 } }));
  assert.deepEqual(importTetrioConfig({ volume: { disable: true, sfx: .6 } }).settings.audio, { enabled: false, volume: .6, ui: true });
});

test('custom defaults remain endless beyond forty lines and have no gravity or automatic locking', () => {
  const game = custom(), y = game.engine.falling.y;
  tick(game, 120); assert.equal(game.engine.falling.y, y);
  tap(game, 'softDrop'); tick(game, 180);
  assert.equal(game.engine.stats.pieces, 0);
  tap(game, 'hardDrop'); assert.equal(game.engine.stats.pieces, 1);
  game.engine.stats.lines = 40; game.step(); assert.equal(game.status, 'playing');
  assert.equal(game.rules.finesse, false); assert.equal(game.rules.undo, true);
  assert.equal(new TrainerGame(defaults, 1).rules.goals.lines, 40);
});

test('custom gravity and finite lock delay lock a piece without hard drop', () => {
  const game = custom({ gravity: 20, infiniteLock: false, lockDelay: 5 });
  tick(game, 4); assert.equal(game.engine.stats.pieces, 0);
  tick(game, 4); assert.ok(game.engine.stats.pieces >= 1);
});

test('each randomizer and garbage setup are deterministic without consuming the piece queue', () => {
  for (const bag of randomizers) {
    const a = custom({ bag, initialGarbage: 10 }), b = custom({ bag, initialGarbage: 10 });
    assert.deepEqual(a.engine.snapshot(), b.engine.snapshot());
    assert.deepEqual(a.engine.queue.snapshot(), custom({ bag }).engine.queue.snapshot());
    assert.equal(a.engine.board.state.flat().filter(Boolean).length, 90);
    for (const row of a.engine.board.state.slice(0, 10)) assert.equal(row.filter(cell => !cell).length, 1);
  }
  const straight = custom({ initialGarbage: 10, garbageMessiness: 0 }).engine.board.state.slice(0, 10).map(row => row.indexOf(null));
  assert.equal(new Set(straight).size, 1);
  const messy = custom({ initialGarbage: 10, garbageMessiness: 1 }).engine.board.state.slice(0, 10).map(row => row.indexOf(null));
  assert.ok(messy.slice(1).every((hole, i) => hole !== messy[i]));
  const settings = structuredClone(defaults); settings.custom.seed = 1234;
  assert.equal(new TrainerGame(settings, undefined, undefined, 'custom').seed, 1234);
  assert.equal(new TrainerGame(settings, 5678, undefined, 'custom').seed, 5678);
});

test('custom hold and 180 restrictions are enforced, with reachable finesse hints', () => {
  const blocked = custom({ hold: false, allow180: false });
  tap(blocked, 'hold'); tap(blocked, 'rotate180');
  assert.equal(blocked.holds, 0); assert.equal(blocked.engine.falling.rotation, 0);
  const limited = custom({ infiniteHold: false }); tap(limited, 'hold'); tap(limited, 'hold'); assert.equal(limited.holds, 1);
  const unlimited = custom(); tap(unlimited, 'hold'); tap(unlimited, 'hold'); assert.equal(unlimited.holds, 2);
  const snapshot = blocked.engine.snapshot();
  snapshot.falling = new Tetromino({ symbol: 't', boardWidth: 10, boardHeight: 20, initialRotation: 0 }).snapshot();
  const target = copyPiece(blocked.engine, snapshot.falling); target.rotation = 2; target.softDrop(snapshot.board);
  const path = findFinesse(blocked.engine, snapshot, target.absoluteBlocks)!;
  assert.equal(path.cost, 2); assert.equal(path.drop, 'hard'); assert.ok(!path.moves.includes('rotate180'));
});

test('custom line, piece and timer goals end independently and pause does not consume time', () => {
  const lines = custom({ lineGoal: 10 }); lines.engine.stats.lines = 10; lines.step(); assert.equal(lines.status, 'complete');
  const pieces = custom({ pieceGoal: 2 }); tap(pieces, 'hardDrop'); assert.equal(pieces.status, 'playing'); tap(pieces, 'hardDrop'); assert.equal(pieces.status, 'complete');
  const timed = custom({ timeLimit: 1 }); tick(timed, 30); timed.pause(); tick(timed, 120); assert.equal(timed.elapsedMs, 500);
  timed.resume(); tick(timed, 30); assert.equal(timed.status, 'complete'); assert.equal(timed.elapsedMs, 1000);
});

test('custom finesse faults rewind the timer, while disabled detection records analyzable mistakes', async () => {
  for (const finesse of [true, false]) {
    const game = custom({ finesse }); tick(game, 60);
    tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop');
    assert.equal(game.faults, finesse ? 1 : 0);
    assert.equal(game.engine.stats.pieces, finesse ? 0 : 1);
    if (finesse) assert.equal(game.elapsedMs, 0);
    const replay = game.export(); assert.equal(replay.mode, 'custom');
    assert.equal(replay.modeRules.id, 'custom');
    const practice = await loadPractice(readReplay(JSON.parse(JSON.stringify(replay)), 'Custom replay')[0], game.settings);
    assert.equal(practice.scenes.length, 1);
    const drill = new TrainerGame(game.settings, 1, practice); drill.start(); tap(drill, 'hardDrop'); assert.equal(drill.status, 'complete');
  }
});

test('manual clear preserves totals, hold and queue, can be undone, and finish saves an endless session', () => {
  const game = custom({ initialGarbage: 3 }); tap(game, 'hold'); tap(game, 'hardDrop'); tick(game, 30); game.pause();
  const before = game.engine.snapshot(), time = game.elapsedMs;
  assert.equal(game.clearField(), true); assert.equal(game.status, 'paused');
  assert.equal(game.engine.board.state.flat().filter(Boolean).length, 0);
  assert.equal(game.engine.stats.pieces, before.stats.pieces); assert.equal(game.elapsedMs, time);
  assert.equal(game.engine.held, before.hold); assert.deepEqual(game.engine.queue.snapshot(), before.queue);
  assert.equal(game.undo(), true); assert.deepEqual(game.engine.board.state, before.board); assert.deepEqual(game.engine.falling.snapshot(), before.falling);
  assert.equal(game.finish(), true); assert.equal(game.status, 'complete'); assert.equal(game.elapsedMs, time);
});

test('automatic top-out clearing allows another placement and stop mode ends on top out', () => {
  const zen = custom();
  for (let i = 0; i < 40 && !zen.boardResets; i++) tap(zen, 'hardDrop');
  assert.equal(zen.boardResets, 1); assert.equal(zen.status, 'playing'); assert.equal(zen.engine.toppedOut, false);
  const pieces = zen.engine.stats.pieces, beforeTime = zen.elapsedMs;
  tap(zen, 'hardDrop'); assert.equal(zen.engine.stats.pieces, pieces + 1); assert.ok(zen.elapsedMs > beforeTime);
  const stopped = custom({ topout: 'stop' });
  for (let i = 0; i < 40 && stopped.active; i++) tap(stopped, 'hardDrop');
  assert.equal(stopped.status, 'topout'); assert.equal(stopped.boardResets, 0);
  assert.equal(stopped.undo(), true); assert.equal(stopped.status, 'playing'); assert.equal(stopped.engine.toppedOut, false);
});

test('live finesse changes preserve the current input history and release a mandatory retry target', () => {
  const game = custom({ finesse: true }); game.settings.training.allowDifferentTarget = false;
  tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); assert.ok(game.fault);
  game.setFinesseEnabled(false); assert.equal(game.fault, null);
  tap(game, 'moveLeft'); tap(game, 'hardDrop'); assert.equal(game.engine.stats.pieces, 1);
  tap(game, 'moveLeft'); tap(game, 'moveRight'); game.setFinesseEnabled(true); tap(game, 'hardDrop');
  assert.equal(game.faults, 2); assert.equal(game.engine.stats.pieces, 1);
  assert.equal(game.events.filter(event => event.type === 'finesse-setting').length, 2);
});

test('replay practice preserves disabled 180-degree rotation when identifying faults', async () => {
  const game = custom({ allow180: false });
  tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop');
  const set = await loadPractice(readReplay(game.export(), 'Custom')[0], game.settings);
  assert.equal(set.allow180, false);
  const drill = new TrainerGame(game.settings, 1, set); assert.equal(drill.engine.misc.allowed.spin180, false);
});
