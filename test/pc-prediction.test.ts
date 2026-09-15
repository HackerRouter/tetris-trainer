import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/settings';
import { modeDefinitions } from '../src/modes';
import { createEngine, spawnSnapshot } from '../src/engine';
import { analysisContext, withGeneratedPacks } from '../src/analysis-context';
import { analysisRequest, maxAnalysisDepth } from '../src/analysis';
import { queueCases, wilson, searchCoverage } from '../src/queue-coverage';
import { pcoScene } from '../src/pc-packs';
import { searchPc, verifyPcRoute } from '../src/pc-search';
import { practiceSummary } from '../src/pc-progress';
import { currentSceneContext, validatePcScene } from '../src/pc-scenes';
import { applyContinuationPath } from '../src/continuation-search';

const source = () => { const rules = modeDefinitions.sprint.rules(defaults), engine = createEngine(defaults, 42, rules); return withGeneratedPacks(analysisContext(rules, defaults, engine.snapshot({ isUndoRedo: true }))); };
test('bag enumeration weights repeated pieces, refills at boundaries, and samples independently of game seeds', () => {
  const exact = queueCases({ remaining: 'iio', refill: 't' }, 2);
  assert.equal(exact.mode, 'enumerated'); assert.deepEqual(exact.cases, [{ queue: 'ii', weight: 1/3 }, { queue: 'io', weight: 1/3 }, { queue: 'oi', weight: 1/3 }]);
  assert.deepEqual(queueCases({ remaining: 'i', refill: 'o' }, 3).cases, [{ queue: 'ioo', weight: 1 }]);
  const a = queueCases({ remaining: 'ijlostz', refill: 'ijlostz' }, 8, 128, 17), b = queueCases({ remaining: 'ijlostz', refill: 'ijlostz' }, 8, 128, 17);
  assert.equal(a.mode, 'sampled'); assert.deepEqual(a,b); assert.equal(a.cases.length,128); assert.ok(a.cases.every(c => new Set(c.queue.slice(0,7)).size === 7));
  const interval = wilson(20,100); assert.ok(Math.abs(interval[0] - 0.13337) < .0001); assert.ok(Math.abs(interval[1] - .28883) < .0001); assert.deepEqual(wilson(0,0),[0,1]);
});
test('coverage separates known failure from timeout and preserves finite-Next policy bounds', () => {
  const context = source(); context.rules.hold = false; context.snapshot.falling = spawnSnapshot(createEngine(defaults,1,context.rules), 'o' as any); context.snapshot.queue.value = [];
  for (let y=0;y<2;y++) for(let x=0;x<8;x++) context.snapshot.board[y][x] = { mino: 'gb' as any, connections: 0 };
  const request = analysisRequest(context,{sessionId:'coverage',revision:0,depth:1});
  const options = { model: { remaining:'ij',refill:'ijlostz' }, draws:1,samples:64,seed:1,milliseconds:3000 };
  const result = searchCoverage(request,options);
  assert.equal(result.mode,'enumerated'); assert.equal(result.solved,2); assert.deepEqual(result.bound,{lower:1,upper:1}); assert.equal(result.policy?.lower,1); assert.ok(result.first.some(item=>item.bound.lower===1));
  context.snapshot.board[0][7] = null;
  const impossible = searchCoverage(analysisRequest(context,{sessionId:'coverage',revision:1,depth:1}),options);
  assert.equal(impossible.failed,2); assert.equal(impossible.bound.upper,0);
  const limited = searchCoverage(analysisRequest(source(),{sessionId:'coverage',revision:1}),{...options,milliseconds:1});
  assert.ok(limited.unknown>0); assert.equal(limited.bound.upper,1);
});
test('full planning extends actual generated queue to twenty while visible, pack and supplied sources stay bounded', () => {
  const context = source(), original = structuredClone(context), engine = createEngine(defaults,1,context.rules); engine.fromSnapshot(context.snapshot);
  while(engine.queue.length < maxAnalysisDepth) engine.queue.repopulateOnce();
  const full = analysisRequest(context,{sessionId:'depth',revision:0,information:'seeded'});
  assert.equal(full.depth,20); assert.deepEqual(full.position.next,engine.queue.slice(0,20)); assert.deepEqual(context,original);
  assert.equal(analysisRequest(context,{sessionId:'depth',revision:0}).position.next.length,5);
  delete context.generated; context.snapshot.queue.value = ['o'] as any;
  assert.equal(analysisRequest(context,{sessionId:'depth',revision:0,information:'seeded'}).position.next.length,1);
});
test('PCO pack has mirrored and held/placed variants with verified completions', () => {
  for(const mirror of [false,true]) for(const variant of [0,1]) {
    const scene = pcoScene(source(),mirror,variant,42); validatePcScene(scene);
    assert.equal(scene.context.snapshot.board.flat().filter(Boolean).length,variant?28:24);
    const request = analysisRequest(scene.context,{sessionId:'pco',revision:0,information:'seeded',depth:4,milliseconds:3000,candidates:1});
    const result = searchPc(request); assert.equal(result.status,'Solved',scene.name); assert.ok(verifyPcRoute(request,result.routes[0]));
  }
});
test('twenty-piece search verifies deeper sequential clears and exhausted final Hold cannot become known again', () => {
  const context = source(); context.rules.hold=false; context.snapshot.falling=spawnSnapshot(createEngine(defaults,1,context.rules),'i' as any); context.snapshot.queue.value = [...'i'.repeat(11)] as any;
  for(let y=0;y<16;y++) for(let x=0;x<7;x++) context.snapshot.board[y][x]={mino:'gb' as any,connections:0};
  const request = analysisRequest(context,{sessionId:'deep',revision:0,information:'seeded',depth:12,milliseconds:5000,candidates:1});
  const result = searchPc(request); assert.equal(result.status,'Solved'); assert.equal(result.routes[0].steps.length,12); assert.ok(verifyPcRoute(request,result.routes[0]));
  const scene = pcoScene(source()); scene.finiteQueue=true; delete scene.context.generated; delete scene.context.pack; scene.context.snapshot.queue.value=[];
  const after = structuredClone(scene.context.snapshot); after.stats.pieces += 2; after.hold='z' as any;
  const bounded=currentSceneContext(scene,after); assert.equal(bounded.currentKnown,false); assert.equal(bounded.snapshot.hold,null);
});
test('practice statistics use unhinted starts, later hint use and separate decision/finesse counts', () => {
  const base={id:'a',sceneId:'x',date:'now',attempts:3,solved:true,mistakes:0,faults:0,timeMs:30,learning:'none',initialLearning:'none',thinkingMs:100,structure:'covered gaps'};
  const stats=practiceSummary([base,{...base,id:'b',learning:'step',mistakes:1},{...base,id:'c',solved:false,faults:1}]);
  assert.equal(stats.independentSolved,1); assert.equal(stats.independentAttempts,3); assert.equal(stats.hintUsed,1); assert.equal(stats.firstTry,1); assert.equal(stats.retries,2); assert.equal(stats.thinkingMs,300);
});
