import test from 'node:test';
import assert from 'node:assert/strict';
import { Field, encoder } from 'tetris-fumen';
import { defaults } from '../src/settings.ts';
import { modeDefinitions } from '../src/modes.ts';
import { createEngine, spawnSnapshot } from '../src/engine.ts';
import { analysisContext, withGeneratedPacks } from '../src/analysis-context.ts';
import { AnalysisSession, analysisRequest, pcCapabilities } from '../src/analysis.ts';
import { searchPc, verifyPcRoute, routeIdentity } from '../src/pc-search.ts';
import { findFinesse } from '../src/finesse.ts';
import { frozenContext, currentSceneContext, sceneFromFumen, changeSceneQueue, parsePcLibrary } from '../src/pc-scenes.ts';
import { TrainerGame } from '../src/game.ts';
import { applyContinuationPath } from '../src/continuation-search.ts';
import { replayTimeline } from '../src/timeline.ts';
import { exportNative } from '../src/native-export.ts';
import { pcBoardFeasible } from '../src/pc-board.ts';
import { reachablePlacements } from '../src/reachable-placements.ts';

export function pcFixture(rows = ['XXXXXXXX__', 'XXXXXXXX__'], queue = 'OITSLJZ', width = 10) {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.training.finesseEnabled = false;
  settings.custom.advanced.width = width; settings.custom.infiniteHold = false;
  const rules = width === 10 ? modeDefinitions.sprint.rules(settings) : modeDefinitions.custom.rules(settings), engine = createEngine(settings, 17, rules);
  const snapshot = engine.snapshot({ isUndoRedo: true }); snapshot.falling = spawnSnapshot(engine, queue[0].toLowerCase() as any);
  snapshot.queue.value = [...queue.slice(1).toLowerCase()] as any; snapshot._queue.value = [...snapshot.queue.value];
  rows.slice().reverse().forEach((row,y) => [...row].forEach((cell,x) => { if (cell !== '_') snapshot.board[y][x] = { mino: 'gb' as any, connections: 0 }; }));
  return analysisContext(rules, settings, snapshot);
}
const request = (context = pcFixture(), extra = {}) => analysisRequest(context, { sessionId: 'test', revision: 1, lines: 2, milliseconds: 5000, ...extra });

test('visible requests contain no bag, seed, backup queue or hidden sequence and ignore hidden future changes', () => {
  const first = pcFixture(), second = structuredClone(first), other = createEngine(first.settings, 222, first.rules).snapshot();
  second.snapshot.queue.bag = other.queue.bag; second.snapshot._queue = other._queue; second.snapshot.garbage.seed = 222;
  second.snapshot.queue.value.splice(5, 1, 'o'); second.settings.custom.seed = 222;
  assert.deepEqual(request(first), request(second));
  assert.equal(JSON.stringify(request(first)).includes('"_queue"'), false);
  assert.equal(JSON.stringify(request(first)).includes('"seed"'), false);
  assert.deepEqual(searchPc(request(first)).routes.map(route => route.id), searchPc(request(second)).routes.map(route => route.id));
  assert.notEqual(request(first, { information: 'seeded' }).fingerprint, request(second, { information: 'seeded' }).fingerprint);
  second.rules.allow180 = false; assert.notEqual(request(first).fingerprint, request(second).fingerprint);
  second.rules = first.rules; second.snapshot.falling.location[0]--; assert.notEqual(request(first).fingerprint, request(second).fingerprint);
});

test('known PC, mandatory Hold and sequential clears have honest proof states', () => {
  const solved = searchPc(request()); assert.equal(solved.status, 'Solved'); assert.ok(solved.routes.length); assert.ok(solved.routes.every(route => verifyPcRoute(request(), route)));
  const held = pcFixture(undefined, 'TILSZJO'); held.snapshot.hold = 'o';
  const heldRequest = request(held, { depth: 1 }); const result = searchPc(heldRequest);
  assert.equal(result.status, 'Solved'); assert.ok(result.routes.every(route => route.steps[0].scene.holdFirst && verifyPcRoute(heldRequest, route)));
  held.snapshot.holdLocked = true; assert.equal(searchPc(request(held, { depth: 1 })).status, 'No solution within scope');
  held.snapshot.holdLocked = false; held.rules.hold = false; assert.equal(searchPc(request(held, { depth: 1 })).status, 'No solution within scope');
  const sequential = pcFixture(['XXX__XXXXX', 'XXX__XXXXX', 'XXXXX__XXX', 'XXXXX__XXX'], 'OOI'); sequential.rules.hold = false;
  const no = searchPc(request(sequential, { lines: 4, depth: 2 })); assert.equal(no.status, 'Solved'); assert.equal(no.complete, true);
  assert.ok(no.routes.every(route => verifyPcRoute(request(sequential, { lines: 4, depth: 2 }), route)));
});

test('PC time limits increase without changing queue scope, and bounded searches state why they stopped', () => {
  const context = pcFixture();
  const normal = analysisRequest(context, { sessionId: 'budget', revision: 1 });
  assert.equal(normal.budget.milliseconds, 15000);
  assert.equal(request(context, { milliseconds: 120000 }).budget.milliseconds, 60000);
  assert.deepEqual(request(context, { milliseconds: 60000 }).position, request(context, { milliseconds: 1500 }).position);
  const result = searchPc(request(pcFixture([], 'OJILSTZTOLJ'), { information: 'seeded', lines: 0, milliseconds: 1 }));
  assert.equal(result.status, 'Incomplete'); assert.match(result.reasons.join(' '), /timed out|time slice/);
});

test('permanent horizontal splits reject bad areas while sequential line-clear cavities remain searchable', () => {
  assert.equal(pcBoardFeasible([0b00100,0b00101], 5, 2), false);
  const context = pcFixture(['XXX__XXXXX','XXX__XXXXX','XXXXX__XXX','XXXXX__XXX'], 'OOI');
  assert.equal(pcBoardFeasible(context.snapshot.board.map(row => row.reduce((bits,tile,x) => bits | (tile ? 1 << x : 0), 0)), 10, 4), true);
  const result = searchPc(request(context, { lines: 4, depth: 2 }));
  assert.equal(result.status, 'Solved'); assert.ok(result.routes.every(route => verifyPcRoute(request(context, { lines: 4, depth: 2 }), route)));
});

test('compact move enumeration preserves executable hard drops from fractional and integer active heights', () => {
  const context = pcFixture(['___XX_____','____XX____','____X_____','___XX_____','___X______'], 'J');
  context.settings.handling.sdf = 6;
  const engine = createEngine(context.settings, 1, context.rules);
  for (const y of [19,19.79]) {
    context.snapshot.falling.location[1] = y;
    const result = reachablePlacements(engine, context.snapshot, 10, () => false);
    assert.equal(result.complete, true); assert.ok(result.placements.length);
    for (const placement of result.placements) {
      engine.fromSnapshot(context.snapshot); let locked: number[][] = [];
      const capture = () => { locked = engine.falling.absoluteBlocks; }; engine.events.on('falling.lock.pre', capture);
      applyContinuationPath(engine, placement.path); engine.events.off('falling.lock.pre', capture);
      assert.deepEqual(locked.map(c => c.join(',')).sort(), placement.target.map(c => c.join(',')).sort());
    }
  }
});

test('automatic PC goals include odd and taller line counts and default to twenty placements', () => {
  for (const [rows, queue, lines] of [
    [['XXXXXX____'], 'I', 1],
    [['XXX__X____','XX__XX__XX','XXXXXX__XX'], 'SOI', 3],
    [Array(6).fill('XXXXXXXX__'), 'OOO', 6],
    [Array(8).fill('XXXXXXXX__'), 'OOOO', 8]
  ] as [string[], string, number][]) {
    const context = pcFixture(rows, queue); context.rules.hold = false;
    const req = analysisRequest(context, { sessionId: 'any-line', revision: 1, milliseconds: 5000 });
    assert.equal(req.depth, 20); assert.equal(req.goal.lines, 0); assert.deepEqual(pcCapabilities(req), []);
    const result = searchPc(req);
    assert.equal(result.status, 'Solved', `${lines}-line PC`);
    assert.ok(result.routes.some(route => route.lines === lines));
    assert.ok(result.routes.every(route => verifyPcRoute(req, route)));
  }
  const exhausted = request(pcFixture(), { depth: 0, lines: 0 });
  assert.equal(exhausted.depth, 0); assert.equal(searchPc(exhausted).status, 'No solution within scope');
});

test('pack scope ends at the latest visible pack and full queue planning is a separate opt-in', () => {
  const settings = structuredClone(defaults), rules = modeDefinitions.sprint.rules(settings), engine = createEngine(settings, 31, rules);
  const context = () => withGeneratedPacks(analysisContext(rules, settings, engine.snapshot({ isUndoRedo: true })));
  assert.equal(request(context(), { information: 'pack' }).position.next.length, 6);
  engine.press('hold'); engine.nextPiece();
  const current = context(), pack = request(current, { information: 'pack', depth: 10 });
  assert.equal(pack.position.next.length, 11); assert.equal(pack.position.hold, engine.held);
  const altered = structuredClone(current); altered.snapshot.queue.value[11] = altered.snapshot.queue.value[11] === 'i' ? 'o' : 'i';
  assert.equal(request(altered, { information: 'pack', depth: 10 }).fingerprint, pack.fingerprint);
  assert.equal(request(context(), { information: 'visible' }).position.next.length, rules.nextCount);
  const initial = withGeneratedPacks(analysisContext(rules, settings, createEngine(settings, 31, rules).snapshot({ isUndoRedo: true })));
  assert.equal(request(initial, { information: 'seeded', depth: 10 }).position.next.length, 10);
  assert.equal(searchPc(request(pcFixture(), { information: 'pack' })).status, 'Unsupported');
  const beforeHold = engine.snapshot({ isUndoRedo: true }); engine.press('hold'); engine.fromSnapshot(beforeHold);
  assert.equal(request(context(), { information: 'pack', depth: 10 }).fingerprint, pack.fingerprint);
});

test('a final known Hold can finish after the queue boundary without depending on the unknown piece', () => {
  const context = pcFixture(['XXXXXX____','XXXXXX____'], 'O'); context.snapshot.hold = 'o';
  const req = request(context, { depth: 2 }), result = searchPc(req);
  assert.equal(result.status, 'Solved'); assert.ok(result.routes.every(route => verifyPcRoute(req, route)));
  assert.ok(result.routes.every(route => route.steps.at(-1)!.unknownCurrent && route.steps.at(-1)!.scene.holdFirst));
});

test('reanalysis of supplied queues excludes refilled pieces while retaining a final known Hold', () => {
  const source = pcFixture(['XXXXXX____','XXXXXX____'], 'O'); source.snapshot.hold = 'o';
  const scene = { id: 'finite', name: 'Finite queue', source: 'Supplied queue', context: source, future: true, finiteQueue: true };
  const req = request(source, { depth: 2 }), route = searchPc(req).routes[0], engine = createEngine(source.settings, 1, source.rules);
  engine.fromSnapshot(source.snapshot); applyContinuationPath(engine, route.steps[0].scene.path);
  const context = currentSceneContext(scene, engine.snapshot({ isUndoRedo: true }));
  assert.equal(context.currentKnown, false); assert.equal(context.snapshot.queue.value.length, 0);
  const remaining = request(context, { lines: 0, depth: 1 }), result = searchPc(remaining);
  assert.equal(result.status, 'Solved'); assert.equal(result.queue.length, 0);
  assert.ok(result.routes.every(route => route.steps[0].unknownCurrent && route.steps[0].scene.holdFirst && verifyPcRoute(remaining, route)));
  const changed = structuredClone(context); changed.snapshot.falling.symbol = 't' as any;
  assert.equal(request(changed, { lines: 0, depth: 1 }).fingerprint, remaining.fingerprint);
  const noHold = structuredClone(context); noHold.snapshot.hold = null;
  assert.equal(searchPc(request(noHold, { lines: 0, depth: 1 })).status, 'No solution within scope');
  const regenerated = changeSceneQueue(scene, 41); assert.equal(regenerated.finiteQueue, false); assert.ok(regenerated.context.pack);
});

test('unreachable T cavity is rejected and a published soft-drop rotation remainder is executable', () => {
  const closed = pcFixture(['XXXX_XXXXX','XXX___XXXX'], 'TI'); closed.rules.allow180 = false; closed.rules.hold = false;
  assert.equal(searchPc(request(closed)).status, 'No solution within scope');
  const tuck = pcFixture(['XXX__X____','XX__XX__XX','XXXXXX__XX'], 'SOI'); tuck.rules.allow180 = false; tuck.rules.hold = false;
  const req = request(tuck, { lines: 3, depth: 3 }), result = searchPc(req);
  assert.equal(result.status, 'Solved'); assert.ok(result.routes.every(route => verifyPcRoute(req, route)));
  assert.ok(result.routes.every(route => route.steps.some(step => step.scene.path.drop === 'soft')));
  assert.ok(result.routes.some(route => route.steps.some(step => step.scene.path.moves.some((move, i, moves) => move.startsWith('rotate') && moves.slice(0, i).includes('softDrop')))));
});

test('worker cancellation rejects even a late matching response and mismatched revisions', () => {
  const original = globalThis.Worker, instances: any[] = [], updates: unknown[] = [];
  class WorkerStub {
    onmessage: ((event: any) => void) | null = null;
    terminated = false;
    constructor() { instances.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = WorkerStub as any;
  try {
    const session = new AnalysisSession(), req = request(), result = searchPc(req);
    session.run(req, value => updates.push(value), message => assert.fail(message));
    const old = instances[0]; session.cancel(); old.onmessage({ data: { result, done: true } });
    assert.equal(old.terminated, true); assert.equal(updates.length, 0);
    session.run({ ...req, revision: 2 }, value => updates.push(value), message => assert.fail(message));
    instances[1].onmessage({ data: { result, done: true } }); assert.equal(updates.length, 0);
    instances[1].onmessage({ data: { result: { ...result, revision: 2 }, done: true } }); assert.equal(updates.length, 1);
    instances[1].onmessage({ data: { result: { ...result, revision: 2 }, done: true } }); assert.equal(updates.length, 1);
  } finally { globalThis.Worker = original; }
});

test('candidate limits and timeouts are incomplete; different PC orders survive final-board deduplication', () => {
  const context = pcFixture(['XXXXXX____','XXXXXX____'], 'OOI'); context.rules.hold = false;
  const req = request(context), result = searchPc(req);
  assert.equal(result.status, 'Solved'); assert.ok(result.routes.length >= 2); assert.ok(result.routes.every(route => verifyPcRoute(req, route)));
  assert.ok(new Set(result.routes.map(route => routeIdentity(route).order)).size >= 2);
  const limited = searchPc(request(context, { candidates: 1 })); assert.equal(limited.complete, false); assert.equal(limited.status, 'Solved');
  const timed = searchPc(request(pcFixture([], 'IOTSZJLIOTSZJL'), { lines: 4, information: 'seeded', depth: 10, milliseconds: 1 })); assert.equal(timed.status, 'Incomplete'); assert.equal(timed.complete, false);
});

test('different piece allocations survive an identical empty final board and respect the existing finesse cost', () => {
  const context = pcFixture(Array(4).fill('XXXXXX____'), 'IIIIJ'); context.rules.hold = false;
  const req = request(context, { lines: 4, depth: 4 }), result = searchPc(req);
  assert.equal(result.status, 'Solved'); assert.ok(new Set(result.routes.map(route => routeIdentity(route).allocation)).size >= 2);
  const engine = createEngine(context.settings, 1, context.rules);
  for (const route of result.routes) {
    assert.ok(verifyPcRoute(req, route));
    for (const step of route.steps) assert.equal(step.scene.path.cost, findFinesse(engine, step.scene.guideSnapshot ?? step.scene.snapshot, step.scene.target)!.cost);
  }
  const landed = pcFixture(); landed.snapshot.falling.location = [8, 1];
  const actual = searchPc(request(landed)); assert.equal(actual.status, 'Solved'); assert.deepEqual(actual.routes[0].steps[0].scene.path.moves, []);
});

test('four-column regression and rule capability rejection keep dimensions explicit', () => {
  const context = pcFixture(['XX__','XX__'], 'OI', 4), req = request(context, { depth: 1 });
  assert.equal(searchPc(req).status, 'Solved'); assert.ok(searchPc(req).routes.every(route => verifyPcRoute(req, route)));
  for (const change of [(c: any) => c.rules.advanced.garbageRefill = 2, (c: any) => c.rules.advanced.bombs = true, (c: any) => c.rules.advanced.hardDrop = false, (c: any) => c.rules.advanced.kickSet = 'ARS', (c: any) => c.rules.infiniteHold = true]) {
    const copy = structuredClone(context); change(copy); assert.ok(pcCapabilities(request(copy)).length); assert.equal(searchPc(request(copy)).status, 'Unsupported');
  }
});

test('Fumen imports the selected pre-operation board with explicit queue and rejects malformed saves', () => {
  const field = Field.create('XXXXXXXX__XXXXXXXX__'), fumen = encoder.encode([{ field }]);
  const scene = sceneFromFumen(fumen, 1, 'OIJ', '-', pcFixture());
  assert.equal(searchPc(request(scene.context)).status, 'Solved');
  const frozen = frozenContext(scene.context); assert.equal(frozen.rules.gravity, 0); assert.equal(frozen.rules.infiniteLock, true);
  const changed = changeSceneQueue(scene, 'TOI'); assert.deepEqual(changed.context.snapshot.board, scene.context.snapshot.board); assert.equal(changed.context.snapshot.falling.symbol, 't');
  assert.equal(parsePcLibrary({ version: 1, scenes: [scene], records: [] }).scenes.length, 1);
  assert.throws(() => parsePcLibrary({ version: 1, scenes: [scene, scene], records: [] }), /Duplicate/);
  assert.throws(() => sceneFromFumen(fumen, 2, 'OI', '-', pcFixture()), /existing Fumen/);
  assert.throws(() => sceneFromFumen(fumen, 1, 'BAD', '-', pcFixture()), /pieces/);
  const invalid = structuredClone(scene); invalid.context.snapshot.falling.location = [NaN, 1];
  assert.throws(() => parsePcLibrary({ version: 1, scenes: [invalid], records: [] }), /position/);
  delete (invalid.context.snapshot as any).input;
  invalid.context.snapshot.falling.location = [4, 22];
  assert.throws(() => parsePcLibrary({ version: 1, scenes: [invalid], records: [] }), /snapshot/);
});

test('guided PC mistakes restore one piece and timer; strategic retries stay outside finesse and successful tape', async () => {
  const context = frozenContext(pcFixture(['XXXXXX____','XXXXXX____'], 'OOI')); context.settings.training.strictPractice = true;
  const game = new TrainerGame(context.settings, 1, undefined, 'custom'); game.start(); game.loadAnalysis(context.snapshot);
  const result = searchPc(request(context)), route = result.routes[0];
  game.setContinuation(route.steps[0].scene, true);
  game.input.press('hardDrop'); game.step(); game.input.release('hardDrop'); game.step();
  assert.equal(game.engine.stats.pieces, 0); assert.equal(game.elapsedMs, 0); assert.equal(game.targetMisses, 1); assert.equal(game.faults, 0);
  assert.equal(game.waitingForInput, true);
  game.setContinuation(null); game.analysisPolicy = 'any';
  game.input.press('hardDrop'); game.step(); game.input.release('hardDrop');
  assert.equal(game.analysisPending, true);
  const time = game.elapsedMs; game.step(); assert.equal(game.elapsedMs, time);
  assert.equal(game.retryAnalysisPlacement(), true); assert.equal(game.elapsedMs, 0); assert.equal(game.analysisMistakes, 1); assert.equal(game.faults, 0);
  assert.equal(game.engine.stats.pieces, 0); assert.equal(game.demonstration, null);
  assert.ok(replayTimeline(game.export()).events.every(event => event.type !== 'placement'));
  await assert.rejects(() => exportNative(game.export()), /scene changes/);
});
