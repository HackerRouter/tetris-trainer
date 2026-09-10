import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaults, validateSettings, type GameAction, type Settings } from '../src/settings.ts';
import { TrainerGame } from '../src/game.ts';
import { formatTime } from '../src/time.ts';
import { readReplay, loadPractice } from '../src/replay.ts';
import { sameCells } from '../src/practice.ts';

const instant = (training: Partial<Settings['training']> = {}) => ({ ...structuredClone(defaults), training: { ...defaults.training, countdownSeconds: 0, ...training } });
const tick = (game: TrainerGame, frames: number) => { for (let i = 0; i < frames; i++) game.step(); };
function tap(game: TrainerGame, key: GameAction) { game.input.press(key); game.step(); game.input.release(key); }
function mistake(game: TrainerGame) { tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); }
function makeReplay() {
  const game = new TrainerGame(instant(), 942562); game.start();
  mistake(game); tap(game, 'hardDrop');
  mistake(game);
  return game.export();
}

test('training defaults migrate without losing existing settings and validate imports', () => {
  const old: Partial<Settings> = structuredClone(defaults); delete old.training;
  old.handling!.das = 9.2;
  const settings = validateSettings(old);
  assert.equal(settings.handling.das, 9.2);
  assert.deepEqual(settings.training, { countdownSeconds: 3, finesseEnabled: true, allowDifferentTarget: true, undoEnabled: false, infiniteHold: false, strictPractice: false });
  for (const countdownSeconds of [-1, 10.1, NaN, Infinity, .15]) assert.throws(() => validateSettings(instant({ countdownSeconds })));
  assert.equal(validateSettings(instant({ countdownSeconds: .5 })).training.countdownSeconds, .5);
});

test('countdown lasts exactly three seconds and does not advance the game or buffer hard drop', () => {
  const game = new TrainerGame(defaults, 942562); game.start();
  const snapshot = game.engine.snapshot();
  assert.equal(game.status, 'countdown'); assert.equal(game.countdownFrames, 180);
  game.input.press('hardDrop'); tick(game, 60);
  assert.equal(game.countdownFrames, 120); assert.equal(game.elapsedMs, 0);
  game.pause(); tick(game, 180); assert.equal(game.countdownFrames, 120);
  game.resume(); tick(game, 119); assert.equal(game.status, 'countdown');
  game.step(); assert.equal(game.status, 'playing');
  assert.equal(game.engine.frame, 0); assert.equal(game.inputs, 0);
  assert.deepEqual(game.engine.snapshot(), snapshot);
  game.step(); assert.equal(game.engine.stats.pieces, 0);
  assert.equal(game.elapsedMs, 1000 / 60);
});

test('countdown precharges DAS and instant ARR reaches either wall on the first playing frame', () => {
  for (const direction of ['moveLeft', 'moveRight'] as const) {
    const game = new TrainerGame({ ...instant({ countdownSeconds: .5 }), handling: { ...defaults.handling, dcd: 4 } }, 942562); game.start();
    const before = game.engine.snapshot();
    game.input.press(direction); tick(game, 30);
    assert.equal(game.status, 'playing'); assert.equal(game.elapsedMs, 0); assert.equal(game.inputs, 0);
    assert.deepEqual(game.engine.snapshot(), before);
    game.step();
    const columns = game.engine.falling.absoluteBlocks.map(([x]) => x);
    assert.equal(direction === 'moveLeft' ? Math.min(...columns) : Math.max(...columns), direction === 'moveLeft' ? 0 : 9);
    assert.equal(game.inputs, 1);
    assert.equal(game.elapsedMs, 1000 / 60);
    game.input.release(direction); tap(game, 'hardDrop');
    assert.equal(game.faults, 0); assert.equal(game.perfects, 1);
    assert.deepEqual(game.placements[0].inputs, [direction, 'hardDrop']);
    assert.equal(game.events.filter(event => event.type === 'das-precharge').length, 1);
  }
});

test('precharged finite ARR repeats at ARR cadence and an immediate hard drop uses the buffered destination', () => {
  const game = new TrainerGame({ ...instant({ countdownSeconds: .5 }), handling: { ...defaults.handling, das: 12, arr: 2 } }, 942562); game.start();
  const x = game.engine.falling.x;
  game.input.press('moveRight'); tick(game, 30);
  game.step(); assert.equal(game.engine.falling.x, x + 1);
  game.step(); assert.equal(game.engine.falling.x, x + 2);
  game.step(); assert.equal(game.engine.falling.x, x + 2);
  game.step(); assert.equal(game.engine.falling.x, x + 3);
  const instantGame = new TrainerGame(instant({ countdownSeconds: .5 }), 942562); instantGame.start();
  instantGame.input.press('moveLeft'); tick(instantGame, 30);
  instantGame.input.press('hardDrop'); instantGame.step();
  assert.equal(Math.min(...instantGame.placements[0].cells.map(([x]) => x)), 0);
  assert.equal(instantGame.faults, 0);
  assert.deepEqual(instantGame.placements[0].inputs, ['moveLeft', 'hardDrop']);
});

test('late holds retain only elapsed DAS charge and a release before start cancels the buffer', () => {
  const game = new TrainerGame(instant({ countdownSeconds: .5 }), 942562); game.start();
  const x = game.engine.falling.x;
  tick(game, 28); game.input.press('moveRight'); tick(game, 2);
  game.step(); assert.equal(game.engine.falling.x, x + 1);
  tick(game, 2); assert.equal(game.engine.falling.x, x + 1);
  game.step(); assert.equal(Math.max(...game.engine.falling.absoluteBlocks.map(([x]) => x)), 9);
  const released = new TrainerGame(instant({ countdownSeconds: .5 }), 942562); released.start();
  released.input.press('moveLeft'); tick(released, 20); released.input.release('moveLeft'); tick(released, 10);
  released.step(); assert.equal(released.engine.falling.x, x); assert.equal(released.inputs, 0);
});

test('countdown direction switching respects DAS cancellation and pause clears all charge', () => {
  for (const cancel of [false, true]) {
    const game = new TrainerGame({ ...instant({ countdownSeconds: .5 }), handling: { ...defaults.handling, cancel } }, 942562); game.start();
    game.input.press('moveLeft'); tick(game, 25); game.input.press('moveRight'); tick(game, 4);
    game.input.release('moveRight'); game.step(); game.step();
    const columns = game.engine.falling.absoluteBlocks.map(([x]) => x);
    assert.equal(Math.min(...columns), cancel ? 2 : 0);
  }
  const game = new TrainerGame(instant({ countdownSeconds: .5 }), 942562); game.start();
  const x = game.engine.falling.x;
  game.input.press('moveLeft'); tick(game, 20); game.pause(); tick(game, 50); game.resume(); tick(game, 10); game.step();
  assert.equal(game.engine.falling.x, x); assert.equal(game.inputs, 0);
  assert.equal(game.engine.input.lShift.held, false);
});

test('faults restore the current piece timer checkpoint while replay events remain ordered', () => {
  const game = new TrainerGame(instant(), 942562); game.start();
  tick(game, 60); mistake(game);
  assert.equal(game.elapsedMs, 0);
  tick(game, 60); tap(game, 'hardDrop');
  const checkpoint = game.elapsedMs;
  tick(game, 120); mistake(game);
  assert.equal(game.elapsedMs, checkpoint);
  assert.equal(game.engine.stats.pieces, 1);
  assert.ok(game.export().result.sessionTimeMs > game.elapsedMs);
  const retry = game.events.filter(event => event.type === 'retry').at(-1)!;
  assert.equal((retry.data as { timeMs: number }).timeMs, checkpoint);
  assert.ok(game.events.every((event, i) => !i || event.frame >= game.events[i - 1].frame));
});

test('disabling alternative targets rejects another destination until the outline is matched', () => {
  const game = new TrainerGame(instant({ allowDifferentTarget: false }), 942562); game.start();
  mistake(game);
  const target = structuredClone(game.fault!.target);
  tap(game, 'moveLeft'); tap(game, 'hardDrop');
  assert.equal(game.engine.stats.pieces, 0);
  assert.equal(game.fault?.reason, 'target'); assert.equal(game.targetMisses, 1);
  assert.ok(sameCells(game.fault!.target, target)); assert.equal(game.elapsedMs, 0);
  const piece = game.engine.falling.symbol;
  tap(game, 'hold'); assert.equal(game.engine.falling.symbol, piece);
  tap(game, 'hardDrop'); assert.equal(game.engine.stats.pieces, 1);
  assert.equal(game.fault, null);
});

test('finesse detection can be disabled and the resulting replay can still be analyzed later', async () => {
  const game = new TrainerGame(instant({ finesseEnabled: false }), 942562); game.start();
  mistake(game);
  assert.equal(game.engine.stats.pieces, 1); assert.equal(game.faults, 0);
  assert.equal(game.unverified, 0); assert.equal(game.perfects, 0);
  const set = await loadPractice(readReplay(game.export(), 'unchecked')[0], instant());
  assert.equal(set.scenes.length, 1);
});

test('undo restores board, bag, hold, statistics and timer and is disabled by default', () => {
  const disabled = new TrainerGame(instant(), 942562); disabled.start(); tap(disabled, 'hardDrop');
  assert.equal(disabled.undo(), false);
  const game = new TrainerGame(instant({ undoEnabled: true }), 942562); game.start();
  tick(game, 60); tap(game, 'hardDrop');
  const first = game.engine.snapshot(), time = game.elapsedMs;
  tick(game, 60); tap(game, 'hardDrop');
  assert.equal(game.engine.stats.pieces, 2);
  assert.equal(game.undo(), true);
  assert.equal(game.engine.stats.pieces, 1); assert.equal(game.perfects, 1);
  assert.equal(game.elapsedMs, time);
  assert.deepEqual(game.engine.board.state, first.board);
  assert.deepEqual(game.engine.queue.snapshot(), first.queue);
  assert.equal(game.engine.held, first.hold);
  assert.equal(game.undo(), true); assert.equal(game.elapsedMs, 0);
  assert.equal(game.undo(), false);
});

test('unlimited hold allows repeated swaps only when enabled', () => {
  for (const infiniteHold of [false, true]) {
    const game = new TrainerGame(instant({ infiniteHold }), 942562); game.start();
    const first = game.engine.falling.symbol;
    tap(game, 'hold'); tap(game, 'hold');
    assert.equal(game.holds, infiniteHold ? 2 : 1);
    assert.equal(game.engine.falling.symbol === first, infiniteHold);
  }
});

test('practice imports fault scenes, enforces targets, resets the whole set and prepares a demonstration', async () => {
  const set = await loadPractice(readReplay(makeReplay(), 'two faults')[0], instant());
  assert.equal(set.scenes.length, 2);
  const game = new TrainerGame(instant({ strictPractice: true, finesseEnabled: false, undoEnabled: true, infiniteHold: true }), 1, set); game.start();
  const initial = game.engine.falling.symbol;
  tap(game, 'hold'); assert.equal(game.engine.falling.symbol, initial);
  tap(game, 'hardDrop'); assert.equal(game.practice?.index, 1);
  assert.equal(game.canUndo, false);
  const failedTarget = game.target!;
  tick(game, 40); mistake(game);
  assert.equal(game.practice?.index, 0); assert.equal(game.practice?.restarts, 1);
  assert.equal(game.perfects, 0); assert.equal(game.elapsedMs, 0);
  assert.ok(game.demonstration); assert.ok(sameCells(game.demonstration!.target, failedTarget));
  assert.equal(game.demonstration!.path.cost, 0);
  tap(game, 'hardDrop'); tap(game, 'hardDrop');
  assert.equal(game.status, 'complete'); assert.equal(game.practice?.index, 2);
});

test('ordinary practice retries the current scene and supports older trainer replay snapshots', async () => {
  const replay: any = makeReplay();
  for (const placement of replay.placements) delete placement.snapshot;
  const set = await loadPractice(readReplay(replay, 'legacy')[0], instant());
  const game = new TrainerGame(instant(), 1, set); game.start();
  tap(game, 'hardDrop'); mistake(game);
  assert.equal(game.practice?.index, 1); assert.equal(game.practice?.restarts, 0);
  assert.ok(game.demonstration);
});

test('real native solo and multiplayer replay files yield practice scenes', async () => {
  const solo = readReplay(JSON.parse(await readFile('test/fixtures/viewtris-40l.ttr', 'utf8')), 'solo');
  assert.equal(solo.length, 1);
  assert.equal((await loadPractice(solo[0], instant())).scenes.length, 21);
  const multi = readReplay(JSON.parse(await readFile('test/fixtures/viewtris-match.ttrm', 'utf8')), 'match');
  assert.equal(multi.length, 16);
  assert.equal((await loadPractice(multi[0], instant())).scenes.length, 6);
  assert.equal((await loadPractice(multi[1], instant())).scenes.length, 24);
  const expected = [10, 23, 17, 34, 11, 20, 77, 177, 22, 60, 29, 84, 11, 21];
  for (let index = 2; index < multi.length; index++) assert.equal((await loadPractice(multi[index], instant())).scenes.length, expected[index - 2]);
  const wrapped = readReplay({ replay: { rounds: [[{ username: 'Player', replay: solo[0].data }]] } }, 'modern envelope');
  assert.equal((await loadPractice(wrapped[0], instant())).scenes.length, 21);
});

test('invalid or incompatible replays report errors instead of importing incorrect scenes', async () => {
  assert.throws(() => readReplay({}, 'bad'));
  const replay = makeReplay();
  replay.placements[0].cells[0][0] = 50;
  await assert.rejects(loadPractice(readReplay(replay, 'bad target')[0], instant()), /invalid target/);
  const raw = JSON.parse(await readFile('test/fixtures/viewtris-40l.ttr', 'utf8'));
  raw.endcontext.lines = 500;
  await assert.rejects(loadPractice(readReplay(raw, 'desync')[0], instant()), /final statistics/);
  const empty = new TrainerGame(instant(), 1); empty.start();
  await assert.rejects(loadPractice(readReplay(empty.export(), 'empty')[0], instant()), /No finesse faults/);
});

test('time uses minutes, padded seconds and milliseconds', () => {
  assert.equal(formatTime(0), '0:00.000');
  assert.equal(formatTime(1250), '0:01.250');
  assert.equal(formatTime(75533), '1:15.533');
  assert.equal(formatTime(600000), '10:00.000');
});
