import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, type GameAction } from '../src/settings.ts';
import { TrainerGame } from '../src/game.ts';
import { customDefaults, customPresets, exportPreset, importPreset, roomPreset, roomPresetNames, validateCustomRules, type CustomRules } from '../src/modes.ts';
import { copyPiece, findFinesse } from '../src/finesse.ts';
import { placementSteps } from '../src/guide.ts';
import { loadPractice, readReplay } from '../src/replay.ts';
import catalog from '../src/room-presets.json' with { type: 'json' };

function play(rules = structuredClone(customDefaults), seed = 1) {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.custom = rules;
  const game = new TrainerGame(settings, seed, undefined, 'custom'); game.start(); return game;
}
function tick(game: TrainerGame, frames: number) { for (let i = 0; i < frames; i++) game.step(); }
function tap(game: TrainerGame, key: GameAction) { game.input.press(key); game.step(); game.input.release(key); }
function advance(game: TrainerGame) { while (game.room.waiting && game.active) game.step(); }

function cheeseRules(messiness = 0) {
  const rules = structuredClone(customPresets.downstack.rules);
  rules.initialGarbage = 0; rules.garbageMessiness = messiness;
  Object.assign(rules.advanced, { garbageRefill: 4, map: Array(4).fill('#####.####').join('\n'), sequence: 'i', repeatSequence: true });
  return rules;
}

test('garbage clear keeps replenishing garbage beyond forty lines without receiving cancelable attacks', () => {
  const game = play(cheeseRules());
  for (let i = 0; i < 12; i++) {
    tap(game, 'rotateCW'); tap(game, 'hardDrop');
    assert.equal(game.engine.stats.garbage.cleared, (i + 1) * 4);
    assert.equal(game.engine.board.state.filter(row => row.some(cell => cell?.mino === 'gb')).length, 4);
    assert.equal(game.status, 'playing');
  }
  assert.equal(game.engine.stats.garbage.receive, 0); assert.equal(game.engine.garbageQueue.size, 0);
  assert.equal(game.room.state.refilled, 48);
  assert.equal(game.finish(), true);
});

test('garbage refill randomness, rows and timer rewind on faults and undo, and practice preserves the recorded scene', async () => {
  const rules = cheeseRules(1); rules.finesse = true;
  const game = play(rules, 17), board = structuredClone(game.engine.board.state), room = structuredClone(game.room.state);
  tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'rotateCW'); tap(game, 'hardDrop');
  assert.equal(game.faults, 1); assert.equal(game.waitingForInput, true);
  tick(game, 180); assert.equal(game.elapsedMs, 0);
  assert.deepEqual(game.engine.board.state, board); assert.deepEqual(game.room.state, room);
  const set = await loadPractice(readReplay(game.export(), 'Cheese')[0], game.settings);
  const practice = new TrainerGame(game.settings, 17, set); practice.start();
  assert.deepEqual(practice.engine.board.state, board);
  tap(practice, 'rotateCW'); tap(practice, 'hardDrop');
  assert.equal(practice.status, 'complete'); assert.equal(practice.room.state.refilled, 0);
  tap(game, 'rotateCW'); tap(game, 'hardDrop');
  const filled = structuredClone(game.engine.board.state), after = structuredClone(game.room.state);
  assert.equal(game.undo(), true); tick(game, 120);
  assert.deepEqual(game.engine.board.state, board); assert.deepEqual(game.room.state, room);
  tap(game, 'rotateCW'); tap(game, 'hardDrop');
  assert.deepEqual(game.engine.board.state, filled); assert.deepEqual(game.room.state, after);
});

test('refill can be disabled, respects board dimensions and resumes after clearing the field', () => {
  const rules = cheeseRules(); rules.advanced.garbageRefill = 0;
  const fixed = play(rules); tap(fixed, 'rotateCW'); tap(fixed, 'hardDrop');
  assert.equal(fixed.engine.board.state.flat().filter(Boolean).length, 0);
  const endless = play(cheeseRules()); endless.clearField();
  assert.equal(endless.engine.board.state.filter(row => row.some(Boolean)).length, 4);
  assert.throws(() => validateCustomRules({ ...rules, advanced: { ...rules.advanced, height: 10, garbageRefill: 9 } }));
  assert.deepEqual(importPreset(exportPreset(cheeseRules())), cheeseRules());
});

test('all ten archived room presets initialize their native dimensions, movement, attack and handling rules', () => {
  assert.equal(Object.keys(roomPresetNames).length, 10);
  for (const id of Object.keys(roomPresetNames)) {
    const rules = roomPreset(id), game = play(rules), config = game.engine.initializer;
    const raw = (catalog.presets as Record<string, Record<string, string>>)[id];
    assert.equal(config.board.width, Number(raw['options.boardwidth']));
    assert.equal(config.board.height, Number(raw['options.boardheight']));
    assert.equal(config.kickTable, raw['options.kickset']);
    assert.equal(config.queue.type, raw['options.bagtype']);
    assert.equal(config.options.spinBonuses, raw['options.spinbonuses']);
    assert.equal(config.gravity.increase, Number(raw['options.gincrease']));
    assert.equal(config.gravity.marginTime, Number(raw['options.gmargin']));
    assert.equal(config.garbage.bombs, raw['options.usebombs'] === '1');
    assert.equal(config.misc.allowed.hardDrop, raw['options.allow_harddrop'] === '1');
    assert.equal(config.misc.allowed.hold, raw['options.display_hold'] === '1');
    assert.equal(config.b2b.chaining, raw['options.b2bchaining'] === '1');
    assert.equal(config.handling.das, rules.advanced.handlingOverride ? Number(raw['options.room_handling_das']) : defaults.handling.das);
    assert.equal(config.pc && config.pc.garbage, raw['options.allclears'] === '1' ? Number(raw['options.allclear_garbage']) : false);
  }
});

test('4-WIDE uses a four-column empty board, native SRS-X kicks and narrow-board finesse', async () => {
  const rules = roomPreset('4wide'); rules.finesse = true;
  const game = play(rules), before = game.engine.snapshot();
  assert.equal(game.engine.board.state.flat().filter(Boolean).length, 0);
  assert.equal(game.engine.board.width, 4); assert.equal(game.engine.board.height, 26);
  tap(game, 'rotateCW'); tap(game, 'rotateCCW'); tap(game, 'hardDrop');
  assert.equal(game.faults, 1); assert.equal(game.engine.stats.pieces, 0); assert.equal(game.elapsedMs, 0);
  assert.ok(game.demonstration); assert.equal(game.fault!.path.source, 'extended');
  assert.deepEqual(game.engine.queue.snapshot(), before.queue);
  const practice = await loadPractice(readReplay(game.export(), '4-wide')[0], game.settings);
  const drill = new TrainerGame(game.settings, 2, practice); drill.start();
  assert.equal(drill.engine.board.width, 4); assert.equal(drill.engine.board.height, 26); assert.equal(drill.engine.kickTableName, 'SRS-X');
  tap(drill, 'hardDrop'); assert.equal(drill.status, 'complete');
  tap(game, 'hardDrop'); assert.equal(game.engine.stats.pieces, 1);
  assert.equal(game.undo(), true); assert.deepEqual(game.engine.board.state, before.board);
});

test('classic disables hard drop, hold and 180, locks automatically and gives an automatic-lock guide', () => {
  const rules = roomPreset('classic'); rules.finesse = true;
  const game = play(rules), snapshot = game.engine.snapshot(), rotation = game.engine.falling.rotation;
  tap(game, 'hardDrop'); tap(game, 'hold'); tap(game, 'rotate180');
  assert.equal(game.engine.stats.pieces, 0); assert.equal(game.holds, 0); assert.equal(game.engine.falling.rotation, rotation);
  tap(game, 'moveLeft'); tap(game, 'moveRight'); game.input.press('softDrop');
  for (let i = 0; i < 500 && !game.faults; i++) game.step();
  assert.equal(game.faults, 1); assert.equal(game.elapsedMs, 0);
  assert.equal(game.fault!.path.drop, 'lock');
  const steps = placementSteps(game.fault!.path, game.settings);
  assert.equal(steps.at(-1)!.move, 'waitLock'); assert.ok(!steps.some(step => step.move === 'hardDrop'));
  assert.deepEqual(game.engine.queue.snapshot(), snapshot.queue);
  tap(game, 'hardDrop'); tap(game, 'hold'); tap(game, 'rotate180'); tick(game, 120);
  assert.equal(game.waitingForInput, true); assert.equal(game.elapsedMs, 0);
  game.input.press('softDrop');
  for (let i = 0; i < 500 && !game.engine.stats.pieces; i++) game.step();
  assert.equal(game.engine.stats.pieces, 1); assert.equal(game.room.state.delay, 12);
});

test('entry delays freeze spawning and hard drop while charging DAS and buffering IRS', () => {
  const rules = roomPreset('enforced delays'); rules.advanced.entryDelay = 20;
  const game = play(rules); tap(game, 'hardDrop');
  const spawn = game.engine.falling.snapshot();
  game.input.press('moveRight'); game.input.press('rotateCW'); game.input.release('rotateCW'); game.input.press('hardDrop');
  tick(game, 20);
  assert.equal(game.engine.stats.pieces, 1); assert.equal(game.engine.falling.x, spawn.location[0]);
  assert.equal(game.engine.falling.y, Math.floor(spawn.location[1]));
  assert.equal(game.engine.input.rShift.das, 9); assert.equal(game.room.waiting, true);
  game.step();
  assert.equal(game.room.waiting, false); assert.equal(game.engine.falling.rotation, (spawn.rotation + 1) % 4);
  assert.ok(game.engine.falling.x > spawn.location[0]);
  game.input.release('moveRight'); game.input.release('hardDrop');
  tap(game, 'hardDrop'); assert.equal(game.engine.stats.pieces, 2);
});

test('line-clear ARE replaces regular ARE and undo restores the previous delay and timer', () => {
  const rules = roomPreset('enforced delays');
  rules.advanced.width = 4; rules.advanced.sequence = 'ii'; rules.undo = true;
  const game = play(rules); tap(game, 'hardDrop');
  assert.equal(game.engine.stats.lines, 1); assert.equal(game.room.state.delay, 35);
  tick(game, 35); assert.equal(game.engine.stats.pieces, 1); game.step();
  tap(game, 'hardDrop'); assert.equal(game.engine.stats.lines, 2);
  assert.equal(game.undo(), true); assert.equal(game.engine.stats.lines, 1);
  assert.equal(game.elapsedMs, 1000 / 60); assert.equal(game.room.state.delay, 35);
  tick(game, 120); assert.equal(game.room.state.delay, 35); assert.equal(game.elapsedMs, 1000 / 60);
  tap(game, 'softDrop'); assert.equal(game.room.state.delay, 34); assert.equal(game.waitingForInput, false);
});

test('progression, incoming garbage schedule, timers and randomness rewind on finesse failure', () => {
  const rules = structuredClone(customDefaults); rules.finesse = true;
  Object.assign(rules.advanced, { gravityIncrease: .2, gravityMargin: 1, garbageInterval: 1, garbageStart: 1, garbageRows: 2, garbageSpeed: 0 });
  const game = play(rules); tick(game, 125);
  assert.ok(game.engine.dynamic.gravity.get() > .2); assert.equal(game.engine.garbageQueue.size, 4);
  tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop');
  assert.equal(game.faults, 1); assert.equal(game.elapsedMs, 0); assert.equal(game.engine.garbageQueue.size, 0);
  assert.equal(game.engine.dynamic.gravity.get(), 0); assert.equal(game.engine.stats.garbage.receive, 0);
  tick(game, 180); assert.equal(game.engine.garbageQueue.size, 0); assert.equal(game.engine.dynamic.gravity.get(), 0);
  tap(game, 'softDrop'); tick(game, 60); assert.equal(game.engine.garbageQueue.size, 2);
  game.setFinesseEnabled(false); tap(game, 'hardDrop');
  const board = structuredClone(game.engine.board.state), garbage = game.engine.garbageQueue.snapshot();
  assert.equal(game.undo(), true); tap(game, 'softDrop'); tick(game, 60); tap(game, 'hardDrop');
  assert.deepEqual(game.engine.board.state, board);
  assert.equal(game.engine.garbageQueue.snapshot().rng, garbage.rng);
});

test('BOMBS creates bomb rows and placing directly above a bomb detonates them', () => {
  const rules = roomPreset('bombs'); rules.advanced.sequence = 'o'; rules.advanced.garbageInterval = 0;
  rules.advanced.map = '....*#####'; rules.initialGarbage = 0;
  const game = play(rules);
  assert.equal(game.engine.board.state[0][4]?.mino, 'bomb');
  tap(game, 'hardDrop');
  assert.equal(game.engine.board.state.flat().filter(cell => cell?.mino === 'bomb').length, 0);
  assert.ok(game.engine.stats.lines > 0);
});

test('authored maps validate dimensions and sequences repeat through hold, queue refills and undo', () => {
  const rules = structuredClone(customDefaults); rules.advanced.sequence = 'ijlotzs'; rules.advanced.repeatSequence = true;
  rules.advanced.map = '###....###';
  const game = play(rules);
  assert.equal(game.engine.board.state[0].filter(Boolean).length, 6);
  const pieces: string[] = [];
  for (let i = 0; i < 60; i++) {
    pieces.push(game.engine.falling.symbol);
    tap(game, 'hardDrop'); game.clearField();
  }
  assert.equal(pieces.join(''), rules.advanced.sequence.repeat(9).slice(0, 60));
  const before = game.engine.snapshot(); tap(game, 'hold'); tap(game, 'hardDrop');
  assert.equal(game.undo(), true);
  assert.equal(game.engine.falling.symbol, before.queue.value[0]);
  const afterHold = game.engine.snapshot(); tap(game, 'hardDrop'); game.undo();
  assert.deepEqual(game.engine.queue.snapshot(), afterHold.queue);
  const finite = structuredClone(customDefaults); finite.advanced.sequence = 'tt';
  const seeded = play(), prefix = play(finite);
  assert.equal(prefix.engine.falling.symbol, 't');
  tap(prefix, 'hardDrop'); assert.equal(prefix.engine.falling.symbol, 't');
  tap(prefix, 'hardDrop'); assert.equal(prefix.engine.falling.symbol, seeded.engine.falling.symbol);
});

test('versioned preset export retains source rules and rejects malformed maps, options and sequences', () => {
  for (const id of Object.keys(roomPresetNames)) {
    const preset = exportPreset(roomPreset(id));
    assert.deepEqual(importPreset(JSON.parse(JSON.stringify(preset))), roomPreset(id));
    assert.deepEqual(preset.source!.native, (catalog.presets as Record<string, unknown>)[id]);
  }
  assert.throws(() => importPreset({ format: 'tetrio-trainer-preset', version: 2 }));
  for (const advanced of [{ width: 3 }, { height: 41 }, { map: '###' }, { map: '..........\n.........?' }, { sequence: 'tetris' }, { kickSet: 'unknown' }, { garbageInterval: -1 }, { repeatSequence: 1 }]) {
    assert.throws(() => validateCustomRules({ ...customDefaults, advanced }));
  }
  assert.throws(() => validateCustomRules({ ...customDefaults, advanced: { hardDrop: false } }));
});

test('finesse demonstrations are created in Sprint and custom presets, and disappear when disabled', () => {
  for (const mode of ['sprint', 'custom'] as const) {
    const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.custom.finesse = true;
    const game = new TrainerGame(settings, 1, undefined, mode); game.start();
    tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop');
    assert.ok(game.demonstration); assert.equal(game.demonstration.sceneNumber, 1);
    game.setFinesseEnabled(false); assert.equal(game.demonstration, null);
    tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); assert.equal(game.demonstration, null);
  }
});

test('alternate board widths reject out-of-bounds replay targets and preserve executable kick-aware hints', async () => {
  const rules = roomPreset('arcade'); rules.advanced.width = 16; rules.advanced.height = 40; rules.finesse = true;
  const game = play(rules); tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop');
  assert.equal(game.faults, 1);
  const scene = game.demonstration!, piece = copyPiece(game.engine, scene.snapshot.falling);
  const path = findFinesse(game.engine, scene.snapshot, scene.target)!;
  for (const move of path.moves) {
    if (move.startsWith('rotate')) piece.rotate(scene.snapshot.board, 'ARS', move === 'rotateCW' ? 1 : 3, false);
    else if (move !== 'down') piece[move as 'moveLeft'](scene.snapshot.board);
  }
  piece.softDrop(scene.snapshot.board); assert.deepEqual(piece.absoluteBlocks, scene.target);
  const set = await loadPractice(readReplay(game.export(), 'Wide')[0], game.settings); assert.equal(set.customRules!.advanced.width, 16);
  const bad = game.export(); bad.placements[0].cells[0][0] = 16;
  await assert.rejects(() => loadPractice(readReplay(bad, 'Invalid')[0], game.settings), /invalid target/);
});
