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

const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
const options = { mirror: false, loop: false, study: true, finesse: true };
const tap = (game: TrainerGame, key: GameAction, frames = 1) => { game.input.press(key); for (let i = 0; i < frames; i++) game.step(); game.input.release(key); game.step(); };
const tiles = (board: any[][]) => board.map(row => row.map(tile => tile?.mino ?? null));

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
