import test from 'node:test';
import assert from 'node:assert/strict';
import { decoder, encoder, Field } from 'tetris-fumen';
import { allOpeners, openerCatalog, verifiedOpeners, compileOpener, suggestOpeners } from '../src/openers.ts';
import { TrainerGame } from '../src/game.ts';
import { defaults, type GameAction } from '../src/settings.ts';
import { modeDefinitions } from '../src/modes.ts';
import { createEngine } from '../src/engine.ts';
import { analysisContext } from '../src/analysis-context.ts';
import { buildPlayback } from '../src/playback.ts';
import { readReplay } from '../src/replay.ts';
import { sameCells } from '../src/practice.ts';
import { buildDemoFrames } from '../src/demo-frames.ts';
import { placementSteps } from '../src/guide.ts';
import { copyPiece } from '../src/finesse.ts';
import { searchContinuations } from '../src/continuation-search.ts';

const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
const options = { mirror: false, loop: false, study: true, finesse: true };
const tap = (game: TrainerGame, key: GameAction, frames = 1) => { game.input.press(key); for (let i = 0; i < frames; i++) game.step(); game.input.release(key); game.step(); };
const tiles = (board: any[][]) => board.map(row => row.map(tile => tile?.mino ?? null));

test('opener undo and redo restore scene progress, finished state, board and timer across construction', async () => {
  const configured = structuredClone(settings); configured.training.undoEnabled = true; configured.training.justThink = true;
  const fumen = encoder.encode([{ field: Field.create(), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }, { operation: { type: 'O', x: 4, y: 2, rotation: 'spawn' } }]);
  const route = compileOpener({ id: 'history', name: 'History', fumen, source: '', note: '' }, configured, modeDefinitions.sprint.rules(configured), { ...options, continueAfter: true });
  const game = new TrainerGame(configured, 17, route.set); game.start();
  tap(game, 'hardDrop'); const firstTime = game.elapsedMs; tap(game, 'hardDrop'); const endTime = game.elapsedMs;
  assert.equal(game.practice!.finished, true); assert.ok(game.undo());
  assert.equal(game.practice!.index, 1); assert.equal(game.practice!.completed, 1); assert.equal(game.practice!.finished, false); assert.equal(game.elapsedMs, firstTime);
  assert.ok(game.undo()); assert.equal(game.practice!.index, 0); assert.equal(game.engine.board.state.flat().filter(Boolean).length, 0);
  assert.ok(game.redo()); assert.equal(game.practice!.index, 1); assert.ok(game.redo()); assert.equal(game.practice!.finished, true); assert.equal(game.elapsedMs, endTime);
  tap(game, 'hardDrop'); assert.ok(game.undo()); assert.equal(game.practice!.finished, true); assert.equal(game.engine.stats.pieces, 2);
  assert.ok(game.redo()); assert.equal(game.engine.stats.pieces, 3);
  const playback = await buildPlayback(readReplay(game.export(), 'Opener redo')[0], configured);
  assert.deepEqual(tiles(playback.engine.board.state), tiles(game.engine.board.state)); assert.equal(playback.duration, game.elapsedMs / 1000);
});

test('enforced continuation retries its required target for target and finesse faults, while advisory mode accepts alternatives', () => {
  const configured = structuredClone(settings); configured.training.justThink = true; configured.training.allowDifferentTarget = false;
  const fumen = encoder.encode([{ field: Field.create('XXXX__XX__XXXX__XX__'), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }]);
  const route = compileOpener({ id: 'required', name: 'Required', fumen, source: '', note: '' }, configured, modeDefinitions.sprint.rules(configured), { ...options, continueAfter: true });
  for (const inefficient of [false, true]) {
    const game = new TrainerGame(configured, 17, route.set); game.start(); tap(game, 'hardDrop');
    const result = searchContinuations({ context: analysisContext(game.rules, configured, game.engine.snapshot({ isUndoRedo: true })), goal: 'pc', seeded: true, depth: 4 });
    assert.ok(result.routes.length); const scene = result.routes[0].steps[0].scene;
    game.setContinuation(scene, true); const before = tiles(game.engine.board.state), time = game.elapsedMs;
    if (inefficient) { tap(game, 'moveLeft'); tap(game, 'moveRight'); }
    tap(game, 'hardDrop');
    assert.equal(game.placements.at(-1)!.accepted, false); assert.deepEqual(tiles(game.engine.board.state), before); assert.equal(game.elapsedMs, time);
    assert.deepEqual(game.target, scene.target); assert.deepEqual(game.demonstration!.target, scene.target); assert.notDeepEqual(game.target, game.placements.at(-1)!.cells);
    if (scene.holdFirst) tap(game, 'hold');
    for (const move of scene.path.moves) tap(game, move === 'dasLeft' ? 'moveLeft' : move === 'dasRight' ? 'moveRight' : move as GameAction, move.startsWith('das') ? 60 : 1);
    tap(game, 'hardDrop'); assert.equal(game.placements.at(-1)!.accepted, true); assert.equal(game.demonstration, null);
  }
  const game = new TrainerGame(configured, 17, route.set); game.start(); tap(game, 'hardDrop');
  const result = searchContinuations({ context: analysisContext(game.rules, configured, game.engine.snapshot({ isUndoRedo: true })), goal: 'pc', seeded: true, depth: 4 });
  game.setContinuation(result.routes[0].steps[0].scene, false); tap(game, 'hardDrop'); assert.equal(game.placements.at(-1)!.accepted, true);
});

test('opener faults retry only the current piece and demonstrate its required target even with strict fault practice enabled', () => {
  const fumen = encoder.encode([{ field: Field.create(), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }, { operation: { type: 'O', x: 4, y: 2, rotation: 'spawn' } }]);
  const strict = structuredClone(settings); strict.training.strictPractice = true; strict.training.justThink = true;
  const route = compileOpener({ id: 'retry', name: 'Local opener retry', fumen, source: '', note: '' }, strict, modeDefinitions.sprint.rules(strict), { ...options, continueAfter: true });
  for (const inefficient of [false, true]) {
    const game = new TrainerGame(strict, 17, route.set); game.start(); tap(game, 'hardDrop');
    assert.equal(game.practice!.index, 1);
    const before = structuredClone(game.engine.board.state), time = game.elapsedMs, target = game.practice!.set.scenes[1].target;
    if (inefficient) { tap(game, 'moveLeft'); tap(game, 'moveRight'); }
    tap(game, 'moveLeft'); tap(game, 'hardDrop');
    assert.equal(game.placements.at(-1)!.reason, inefficient ? 'finesse' : 'target');
    assert.equal(game.practice!.index, 1); assert.equal(game.practice!.completed, 1); assert.equal(game.practice!.restarts, 0);
    assert.deepEqual(game.engine.board.state, before); assert.equal(game.elapsedMs, time); assert.ok(game.waitingForInput);
    assert.ok(sameCells(game.target!, target)); assert.ok(sameCells(game.demonstration!.target, target));
    assert.ok(!sameCells(game.demonstration!.target, game.placements.at(-1)!.cells));
    const demo = game.demonstration!, frames = buildDemoFrames(demo, game.engine, placementSteps(demo.path, game.settings));
    assert.ok(sameCells(copyPiece(game.engine, frames.at(-1)!.piece).absoluteBlocks, target));
    tap(game, 'hardDrop'); assert.equal(game.practice!.finished, true); assert.equal(game.demonstration, null); assert.equal(game.engine.board.state.flat().filter(Boolean).length, 8);
    assert.equal(game.faults, inefficient ? 1 : 0);
  }
});

test('the catalog provides hundreds of searchable source-linked constructions and curated routes work on both sides', () => {
  assert.ok(allOpeners.length >= 479); assert.ok(allOpeners.filter(opener => verifiedOpeners.has(opener.id)).length > 400);
  for (const opener of openerCatalog) for (const mirror of [true, false]) {
    const route = compileOpener(opener, settings, modeDefinitions.sprint.rules(settings), { ...options, mirror });
    assert.ok(route.set.scenes.length >= 6); assert.match(opener.source, /^https?:\/\//);
    for (const scene of route.set.scenes) assert.equal(scene.target.length, 4);
    if (opener.id === 'tki') assert.ok(route.results.some(result => result.piece === 't' && result.spin === 'normal' && result.lines === 2));
  }
});

test('opener evaluation applies active all-piece spins, disabled spins, combo rules, dimensions and rotations', () => {
  const opener = allOpeners.find(opener => opener.id === 'db-27')!, rules = modeDefinitions.sprint.rules(settings);
  rules.advanced.spinBonuses = 'all-mini+'; rules.advanced.comboTable = 'classic guideline'; rules.allow180 = false; rules.board.height = 26; rules.advanced.height = 26;
  const all = compileOpener(opener, settings, rules, options);
  assert.ok(all.results.some(result => result.piece === 'z' && result.spin === 'mini'));
  assert.equal(all.rules.advanced.comboTable, 'classic guideline'); assert.equal(all.rules.board.height, 26); assert.equal(all.set.allow180, false);
  rules.advanced.spinBonuses = 'none';
  assert.ok(compileOpener(opener, settings, rules, options).results.every(result => result.spin === 'none'));
  rules.board.width = 4; rules.advanced.width = 4;
  assert.throws(() => compileOpener(opener, settings, rules, options), /10 columns/);
  const context = analysisContext(rules, settings, createEngine(settings, 1, rules).snapshot());
  context.rules.advanced.spinBonuses = 'all'; assert.equal(rules.advanced.spinBonuses, 'none');
  assert.throws(() => analysisContext(rules, settings, createEngine(settings, 1).snapshot()), /does not match/);
});

test('continuous Fumen operation imports reject field edits and malformed colored diagrams', () => {
  const fumen = encoder.encode([{ field: Field.create(), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }, { operation: { type: 'O', x: 4, y: 2, rotation: 'spawn' } }]);
  const opener = { id: 'test', name: 'Two O pieces', fumen, source: '', note: '' };
  const route = compileOpener(opener, settings, modeDefinitions.sprint.rules(settings), options);
  assert.equal(route.set.scenes.length, 2); assert.equal(route.finalBoard.flat().filter(Boolean).length, 8);
  const pages = decoder.decode(fumen); pages[1].field = Field.create();
  assert.throws(() => compileOpener({ ...opener, fumen: encoder.encode(pages) }, settings, route.rules, options), /edits the board/);
  assert.throws(() => compileOpener({ ...opener, fumen: encoder.encode([{ field: Field.create('OOOO______') }]) }, settings, route.rules, options), /No construction route/);
});

test('random-bag suggestions obey real Hold order and assisted construction survives a fault and clean replay', async () => {
  const rules = modeDefinitions.sprint.rules(settings), engine = createEngine(settings, 17, rules);
  const queue = [engine.falling.symbol, ...engine.queue.slice(0, 6)];
  const suggestions = await suggestOpeners(settings, rules, { seed: 17, queue }, options);
  assert.ok(suggestions.length >= 3); assert.ok(suggestions.every(suggestion => suggestion.route.set.scenes[0].snapshot.falling.symbol === queue[0]));
  assert.equal(suggestions.some(suggestion => suggestion.opener.id === 'tki'), false);
  for (const suggestion of suggestions.slice(0, 3)) {
    const game = new TrainerGame(settings, 17, suggestion.route.set); game.start();
    for (const [i, scene] of suggestion.route.set.scenes.entries()) {
      if (scene.holdFirst) tap(game, 'hold');
      if (i === 0) { tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop'); assert.equal(game.faults, 1); assert.equal(game.practice!.index, 0); }
      for (const move of scene.path.moves) {
        assert.notEqual(move, 'down');
        if (move === 'dasLeft' || move === 'dasRight') tap(game, move === 'dasLeft' ? 'moveLeft' : 'moveRight', 60);
        else tap(game, move as GameAction);
      }
      tap(game, 'hardDrop'); assert.equal(game.practice!.completed, i + 1);
    }
    assert.equal(game.status, 'complete'); assert.deepEqual(tiles(game.engine.board.state), tiles(suggestion.route.finalBoard));
    const playback = await buildPlayback(readReplay(game.export(), 'Opener')[0], settings);
    assert.equal(playback.duration, game.elapsedMs / 1000); assert.deepEqual(tiles(playback.engine.board.state), tiles(game.engine.board.state));
    assert.equal(playback.frames.at(-1)!.pieces, game.practice!.completed);
  }
});

test('structural variants preserve the complete occupied shape but vary piece assignments', () => {
  const rules = modeDefinitions.sprint.rules(settings), opener = openerCatalog.find(opener => opener.id === 'dt')!;
  const original = compileOpener(opener, settings, rules, options), variants = new Set<string>();
  const mask = (route: typeof original) => route.diagram.map(({ x, y }) => `${x},${y}`).sort();
  for (let seed = 1; seed <= 8; seed++) {
    const route = compileOpener(opener, settings, rules, { ...options, isomers: true, variantSeed: seed * 1738197 });
    assert.deepEqual(mask(route), mask(original));
    assert.deepEqual(route.diagram.map(tile => tile.symbol).sort(), original.diagram.map(tile => tile.symbol).sort());
    variants.add(JSON.stringify(route.diagram.sort((a, b) => a.y - b.y || a.x - b.x)));
  }
  assert.ok(variants.size > 1, 'Different seeds select genuinely different colored tilings');
  const tki = compileOpener(openerCatalog[0], settings, rules, options);
  assert.equal(tki.diagram.length, tki.set.scenes.length * 4);
  assert.equal(new Set(mask(tki)).size, tki.diagram.length);
});

test('completed opener practice keeps its field and queue for continued play and clean playback', async () => {
  const fumen = encoder.encode([{ field: Field.create(), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }, { operation: { type: 'O', x: 4, y: 2, rotation: 'spawn' } }]);
  const route = compileOpener({ id: 'continue', name: 'Continue', fumen, note: '', source: '' }, settings, modeDefinitions.sprint.rules(settings), { ...options, continueAfter: true, variantSeed: 17 });
  const game = new TrainerGame(settings, undefined, route.set); game.start();
  tap(game, 'hardDrop'); const next = game.engine.queue.slice(0, 1)[0]; tap(game, 'hardDrop');
  assert.equal(game.practice!.finished, true); assert.equal(game.status, 'playing'); assert.equal(game.target, null);
  assert.equal(game.engine.falling.symbol, next); assert.equal(game.engine.board.state.flat().filter(Boolean).length, 8);
  tap(game, 'hold'); assert.equal(game.holds, 1);
  tap(game, 'hardDrop'); assert.equal(game.engine.stats.pieces, 3); assert.equal(game.practice!.completed, 2);
  const playback = await buildPlayback(readReplay(game.export(), 'Continued opener')[0], settings);
  assert.deepEqual(tiles(playback.engine.board.state), tiles(game.engine.board.state));
  assert.equal(playback.frames.at(-1)!.pieces, 3); assert.equal(playback.frames.at(-1)!.target, null);
});
