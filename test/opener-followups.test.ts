import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allOpeners, compileOpener, executePath } from '../src/openers.ts';
import { defaults } from '../src/settings.ts';
import { modeDefinitions } from '../src/modes.ts';
import { createEngine } from '../src/engine.ts';
import { analysisContext } from '../src/analysis-context.ts';
import { searchOpenerContinuations, publishedStages, automaticContinuationGoals, rankDoubleContinuations } from '../src/opener-followups.ts';
import { applyContinuationPath, type ContinuationRoute } from '../src/continuation-search.ts';
import { sameCells } from '../src/practice.ts';
import { buildDemoFrames } from '../src/demo-frames.ts';
import { placementSteps } from '../src/guide.ts';

test('explicit double support prioritizes two full TSDs, then one, ahead of other published possibilities', () => {
  assert.deepEqual(automaticContinuationGoals(allOpeners.find(opener => opener.id === 'stickspin')!), ['two-tsd', 'tsd', 'tspin', 'pc']);
  assert.deepEqual(automaticContinuationGoals({ id: 'local', name: 'Custom', source: '', note: 'Supports two T-spin doubles.' }), ['two-tsd', 'tsd', 'tspin', 'pc']);
  assert.deepEqual(automaticContinuationGoals(allOpeners.find(opener => opener.id === 'db-377')!), ['two-tsd', 'tsd', 'tspin', 'pc']);
  assert.deepEqual(automaticContinuationGoals({ id: 'local-pc', name: 'Perfect Clear', source: '' }), ['pc', 'tspin']);
  const routes = [
    { id: 'pc', steps: [{ piece: 'o', spin: 'none', lines: 2 }] },
    { id: 'one', steps: [{ piece: 't', spin: 'normal', lines: 2 }] },
    { id: 'mini', steps: [{ piece: 't', spin: 'mini', lines: 2 }] },
    { id: 'two', steps: [{ piece: 't', spin: 'normal', lines: 2 }, { piece: 't', spin: 'normal', lines: 2 }] }
  ] as ContinuationRoute[];
  assert.deepEqual(rankDoubleContinuations(routes).map(route => route.id), ['two', 'one', 'pc', 'mini']);
});

function setup(id: string, seed: number, mirror = false) {
  const opener = allOpeners.find(opener => opener.id === id)!;
  const rules = modeDefinitions.sprint.rules(defaults), deal = createEngine(defaults, seed, rules);
  const route = compileOpener(opener, defaults, rules, { mirror, loop: false, study: true, finesse: false, isomers: true, variantSeed: seed, deal: { seed, queue: [deal.falling.symbol, ...deal.queue.slice(0, 6)] } });
  const scene = route.set.scenes.at(-1)!, engine = createEngine(defaults, seed, route.rules);
  engine.fromSnapshot(scene.guideSnapshot ?? scene.snapshot); executePath(engine, scene.path);
  return { opener, engine, route };
}

function verify(route: ContinuationRoute, state: ReturnType<typeof setup>) {
  const { engine } = state;
  for (const step of route.steps) {
    if (step.scene.holdFirst) engine.hold();
    assert.equal(engine.falling.symbol, step.piece);
    let cells: [number, number][] = [];
    const capture = () => { cells = engine.falling.absoluteBlocks; };
    engine.events.on('falling.lock.pre', capture);
    const result = applyContinuationPath(engine, step.scene.path);
    assert.ok(sameCells(cells, step.scene.target));
    engine.events.off('falling.lock.pre', capture);
    assert.equal(result.lines, step.lines); assert.equal(result.spin, step.spin);
    assert.deepEqual(engine.board.state, step.after.board);
    const scene = { ...step.scene, snapshot: step.scene.guideSnapshot ?? step.scene.snapshot, serial: 1, sceneNumber: 1 };
    const frames = buildDemoFrames(scene, engine, placementSteps(scene.path, defaults));
    assert.ok(frames.at(-1)!.label.startsWith('Complete'));
  }
}

test('Mountainous Stacking 2 has alternate second-bag milestones and continues through the third-bag PC', () => {
  const state = setup('db-377', 17);
  assert.equal(state.route.set.scenes.length, 6); assert.equal(state.engine.held, 'l');
  assert.ok(publishedStages(state.opener).length > 10);
  const search = () => searchOpenerContinuations({ context: analysisContext(state.route.rules, defaults, state.engine.snapshot({ isUndoRedo: true })), opener: state.opener, auto: true, goal: 'pc', depth: 14, seeded: true, budgetMs: 15000 });
  const second = search(); assert.ok(second.routes.length >= 2, second.message);
  const choice = second.routes.find(route => route.name!.endsWith('Setup B'))!; assert.ok(choice);
  assert.equal(choice.pc, false); assert.equal(choice.steps.length, 8); assert.ok(choice.steps.some(step => step.spin !== 'none' && step.lines === 3));
  verify(choice, state);
  const third = search(); assert.ok(third.routes.some(route => route.pc), third.message);
  verify(third.routes.find(route => route.pc)!, state);
  assert.equal(state.engine.board.perfectClear, true); assert.equal(state.engine.stats.lines, 8);
});

test('Stickspin trains the first-bag TSS, second-bag TSD, alternate third-bag TSTs and further continuations', () => {
  const state = setup('stickspin', 17);
  assert.ok(state.route.results.some(result => result.lines === 1 && result.spin !== 'none'));
  const search = () => searchOpenerContinuations({ context: analysisContext(state.route.rules, defaults, state.engine.snapshot({ isUndoRedo: true })), opener: state.opener, auto: true, goal: 'tspin', depth: 14, seeded: true, budgetMs: 15000 });
  const second = search(); assert.ok(second.routes.length); verify(second.routes[0], state);
  assert.ok(second.routes[0].steps.some(step => step.spin !== 'none' && step.lines === 2));
  const third = search(); assert.ok(third.routes.length >= 2);
  const triple = third.routes.find(route => route.steps.some(step => step.spin !== 'none' && step.lines === 3))!;
  assert.ok(triple); verify(triple, state);
  assert.ok(search().routes.length);
});

test('published routes respect visible Next, board changes, supported spins and imported reference pages', () => {
  const state = setup('db-377', 1);
  const context = analysisContext(state.route.rules, defaults, state.engine.snapshot({ isUndoRedo: true })); context.rules.nextCount = 0;
  const limited = searchOpenerContinuations({ context, opener: state.opener, auto: true, goal: 'pc', depth: 14, seeded: false, budgetMs: 30 });
  assert.equal(limited.routes.length, 0); assert.equal(limited.queue.length, 1);
  assert.ok(publishedStages(allOpeners.find(opener => opener.id === 'dt')!).length > 0);
});
