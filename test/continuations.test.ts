import test from 'node:test';
import assert from 'node:assert/strict';
import { searchContinuations, applyContinuationPath, boardMask, type ContinuationRoute } from '../src/continuation-search.ts';
import { analysisContext } from '../src/analysis-context.ts';
import { createEngine } from '../src/engine.ts';
import { compileOpener, openerCatalog, executePath, suggestOpeners, allOpeners } from '../src/openers.ts';
import { defaults } from '../src/settings.ts';
import { modeDefinitions } from '../src/modes.ts';
import { TrainerGame } from '../src/game.ts';
import { prioritizeOpeners } from '../src/opener-shortlist.ts';

const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
const options = { mirror: false, loop: false, study: true, finesse: true, variantSeed: 17 };
function setup(id: string, seed = 17) {
  const route = compileOpener(openerCatalog.find(opener => opener.id === id)!, settings, modeDefinitions.sprint.rules(settings), { ...options, variantSeed: seed });
  const engine = createEngine(settings, seed, route.rules), last = route.set.scenes.at(-1)!;
  engine.fromSnapshot(last.guideSnapshot ?? last.snapshot); executePath(engine, last.path);
  if (id === 'pco') engine.held = 'i';
  return { engine, context: analysisContext(route.rules, settings, engine.snapshot({ isUndoRedo: true })) };
}
function verify(route: ContinuationRoute, context: ReturnType<typeof setup>['context']) {
  const engine = createEngine(settings, 17, context.rules); engine.fromSnapshot(context.snapshot);
  let spins = 0;
  for (const step of route.steps) {
    assert.deepEqual(boardMask(engine.board.state), boardMask(step.scene.snapshot.board));
    assert.equal(engine.held, step.scene.snapshot.hold); assert.equal(engine.falling.symbol, step.scene.snapshot.falling.symbol);
    if (step.scene.holdFirst) assert.equal(engine.press('hold'), true);
    const result = applyContinuationPath(engine, step.scene.path);
    assert.equal(result.mino, step.piece); assert.equal(result.lines, step.lines); assert.equal(result.spin, step.spin);
    assert.deepEqual(boardMask(engine.board.state), boardMask(step.after.board));
    if (result.mino === 't' && result.spin !== 'none' && result.lines > 0) spins++;
  }
  assert.equal(spins, route.spins);
  if (route.pc) assert.equal(engine.board.state.flat().some(Boolean), false);
}

test('shortlisting gives stable ordering and changes the actual random-opening candidate search', async () => {
  assert.deepEqual(prioritizeOpeners([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'a']).map(item => item.id), ['c', 'a', 'b']);
  const rules = modeDefinitions.sprint.rules(settings), engine = createEngine(settings, 17, rules), deal = { seed: 17, queue: [engine.falling.symbol, ...engine.queue.slice(0, 6)] };
  const source = await suggestOpeners(settings, rules, deal, options), chosen = source.at(-1)!;
  const next = await suggestOpeners(settings, rules, deal, { ...options, shortlist: [chosen.opener.id] });
  assert.equal(next[0].opener.id, chosen.opener.id);
  assert.equal(allOpeners.length, 479);
});

test('PC continuations include distinct solutions, use actual Hold/queue and execute through the engine', () => {
  const { context } = setup('pco'), original = JSON.stringify(context);
  const result = searchContinuations({ context, goal: 'pc', depth: 14, seeded: true, limit: 4 });
  assert.ok(result.routes.length >= 2); assert.equal(new Set(result.routes.map(route => route.id)).size, result.routes.length);
  for (const route of result.routes) { assert.equal(route.pc, true); verify(route, context); }
  assert.equal(JSON.stringify(context), original);
  const visible = structuredClone(context); visible.rules.nextCount = 0;
  const limited = searchContinuations({ context: visible, goal: 'pc', depth: 14, seeded: false });
  assert.equal(limited.queue.length, 1); assert.equal(limited.routes.length, 0); assert.match(limited.message, /does not prove/);
});

test('two-T-spin continuations admit different intermediate structures under the live spin table', () => {
  const { context } = setup('dt', 29);
  const result = searchContinuations({ context, goal: 'two-tspins', depth: 14, seeded: true, limit: 2, budgetMs: 10000 });
  assert.equal(result.routes.length, 2);
  for (const route of result.routes) { assert.ok(route.spins >= 2); verify(route, context); }
  assert.notDeepEqual(result.routes[0].steps.map(step => boardMask(step.after.board)), result.routes[1].steps.map(step => boardMask(step.after.board)));
  context.rules.advanced.spinBonuses = 'none';
  const disabled = searchContinuations({ context, goal: 'two-tspins', depth: 14, seeded: true });
  assert.equal(disabled.routes.length, 0); assert.match(disabled.message, /disabled in this mode/);
});

test('PC search adapts to board dimensions, rejects unsupported pressure and keeps its work bounded', () => {
  const custom = structuredClone(settings); custom.custom.advanced.width = 4; custom.custom.advanced.height = 26; custom.custom.hold = false;
  const rules = modeDefinitions.custom.rules(custom), engine = createEngine(custom, 17, rules);
  const snapshot = engine.snapshot({ isUndoRedo: true });
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) snapshot.board[y][x] = { mino: 'gb', connections: 0 };
  const context = analysisContext(rules, custom, snapshot);
  const result = searchContinuations({ context, goal: 'pc', depth: 1, seeded: false });
  assert.ok(result.routes.length); for (const route of result.routes) verify(route, context);
  context.rules.advanced.garbageRefill = 4;
  assert.match(searchContinuations({ context, goal: 'pc', depth: 14, seeded: true }).message, /generated garbage/);
  const bigger = setup('mko').context;
  const bounded = searchContinuations({ context: bigger, goal: 'two-tspins', depth: 14, seeded: true, budgetMs: 20 });
  assert.ok(bounded.elapsedMs < 1000); assert.equal(bounded.limited, true);
});

test('advisory continuation targets never enforce a placement or change finesse policy', () => {
  const game = new TrainerGame(settings, 17); game.start(); game.hintTarget = [[0, 0], [1, 0], [0, 1], [1, 1]];
  game.input.press('hardDrop'); game.step();
  assert.equal(game.engine.stats.pieces, 1); assert.equal(game.targetMisses, 0); assert.equal(game.faults, 0);
});
