import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/settings';
import { modeDefinitions } from '../src/modes';
import { createEngine, spawnSnapshot } from '../src/engine';
import { analysisContext, frozenAttackRules, withGeneratedPacks } from '../src/analysis-context';
import { TrainerGame } from '../src/game';
import { analysisRequest, maxComboAnalysisDepth } from '../src/analysis';
import { searchCombo, verifyComboRoute, comboBoardKind } from '../src/combo-search';
import { comboScene } from '../src/combo-scenes';
import { validatePcScene, frozenContext } from '../src/pc-scenes';
import { searchCoverage } from '../src/queue-coverage';

function fixture(rows:string[],queue:string,width=10) {
  const settings=structuredClone(defaults); settings.custom.advanced.width=width;settings.custom.gravity=0;settings.custom.infiniteLock=true;settings.custom.hold=false;settings.custom.infiniteHold=false;
  const rules=modeDefinitions.custom.rules(settings),engine=createEngine(settings,1,rules),snapshot=engine.snapshot({isUndoRedo:true});
  snapshot.falling=spawnSnapshot(engine,queue[0].toLowerCase() as any);snapshot.queue.value=[...queue.slice(1).toLowerCase()] as any;snapshot._queue.value=[...snapshot.queue.value];
  rows.slice().reverse().forEach((row,y)=>[...row].forEach((cell,x)=>{if(cell!=='_')snapshot.board[y][x]={mino:'gb' as any,connections:0};}));
  return analysisContext(rules,settings,snapshot);
}
const req=(context=fixture(['XXXXXXXX__','XXXXXXXX__','XXXXXXXX__','XXXXXXXX__'],'OO'),extra={})=>analysisRequest(context,{sessionId:'combo',revision:0,kind:'combo',depth:6,milliseconds:3000,information:'seeded',...extra});

test('Combo defaults to sixty full-queue placements while PC and supplied queues retain their bounds',()=>{
  const game=new TrainerGame(structuredClone(defaults),17);
  const context=withGeneratedPacks(analysisContext(game.rules,game.settings,game.engine.snapshot({isUndoRedo:true})));
  const combo=analysisRequest(context,{sessionId:'combo',revision:0,kind:'combo'});
  assert.equal(combo.depth,maxComboAnalysisDepth);assert.equal(combo.depth,60);assert.equal(combo.information,'seeded');assert.equal(combo.position.next.length,60);
  const pc=analysisRequest(context,{sessionId:'pc',revision:0,information:'seeded'});assert.equal(pc.depth,20);assert.equal(pc.position.next.length,20);
  const finite=analysisRequest(fixture([],'OOOI'),{sessionId:'finite',revision:0,kind:'combo'});
  assert.equal(finite.position.next.length,3);assert.equal(finite.information,'seeded');assert.equal(finite.depth,60);
});

test('long empty-Sprint Combo plans exceed twenty placements and replay every clearing step',()=>{
  const game=new TrainerGame(structuredClone(defaults),17);
  const context=withGeneratedPacks(analysisContext(game.rules,game.settings,game.engine.snapshot({isUndoRedo:true})));
  const request=analysisRequest(context,{sessionId:'long-combo',revision:0,kind:'combo',milliseconds:15000});
  const result=searchCombo(request),route=result.routes[0];
  assert.equal(result.status,'Solved');assert.equal(result.complete,false);assert.ok(route.steps.length>20);assert.ok(route.combo!.clears>=8);
  assert.ok(result.routes.every(route=>verifyComboRoute(request,route)&&route.steps.length<=60&&route.steps.slice(route.combo!.setup).every(step=>step.lines>0)));
});

for(const objective of ['clears','attack'] as const) for(const information of ['pack','seeded'] as const) test(`empty Sprint plans setup and ${objective} within ${information} access`,()=>{
  const game=new TrainerGame(structuredClone(defaults),17);
  const context=withGeneratedPacks(analysisContext(game.rules,game.settings,game.engine.snapshot({isUndoRedo:true})));
  const request=req(context,{objective,information,depth:20,milliseconds:1500});
  const messages:number[]=[];
  const result=searchCombo(request,progress=>{if(progress.routes.length)messages.push(progress.elapsedMs);});
  assert.equal(request.goal.cleanup,19);assert.equal(result.status,'Solved');assert.equal(result.complete,false);assert.equal(result.combo?.proven,false);
  assert.ok(messages.length>0);assert.ok(result.routes[0].combo!.setup>2);assert.ok(result.routes[0].combo!.clears>=1);
  assert.equal(result.queue.length,information==='pack'?7:21);
  assert.ok(result.routes.every(route=>verifyComboRoute(request,route)&&route.steps.length<=20&&route.steps.slice(route.combo!.setup).every(step=>step.lines>0)));
  if(objective==='attack')assert.match(result.reasons.join(' '),/Spin-history/);
});

test('opening setup respects finite queues, explicit scope and incomplete budgets',()=>{
  const context=fixture([],'OOOI');
  const restricted=req(context,{depth:4,cleanup:2});assert.equal(searchCombo(restricted).status,'No solution within scope');
  const request=req(context,{depth:4}),result=searchCombo(request);
  assert.equal(result.status,'Solved');assert.equal(result.routes[0].combo?.setup,3);assert.ok(result.routes.every(route=>verifyComboRoute(request,route)));
  assert.equal(searchCombo(req(fixture([],'OO'),{depth:20})).routes.length,0);
  const stopped=searchCombo(req(context,{depth:20,nodes:1}));assert.equal(stopped.status,'Incomplete');assert.equal(stopped.complete,false);
  assert.equal(req(context,{depth:0}).goal.cleanup,0);
});
test('combo maximizes consecutive clears, keeps REN offset and engine attack separate',()=>{
  const request=req(),result=searchCombo(request);assert.equal(result.status,'Solved');assert.equal(result.combo?.best,2);assert.equal(result.complete,true);
  assert.equal(result.routes[0].combo?.clears,2);assert.equal(result.routes[0].combo?.endCombo,1);assert.ok(result.routes.every(route=>verifyComboRoute(request,route)));
  const context=fixture(['XXXXXXXX__','XXXXXXXX__'],'O');context.snapshot.stats.combo=4;
  assert.equal(searchCombo(req(context)).routes[0].combo?.endCombo,5);
  const attack=searchCombo(req(undefined,{objective:'attack'}));assert.equal(attack.complete,false);assert.equal(attack.combo?.proven,false);assert.ok(attack.routes[0].combo!.attack>0);assert.match(attack.reasons.join(' '),/Spin-history/);
});
test('Hold legality, unknown final Hold, cleanup and honest timeouts are preserved',()=>{
  const context=fixture(['XXXXXXXX__','XXXXXXXX__'],'I');context.rules.hold=true;context.snapshot.hold='o' as any;
  const hold=searchCombo(req(context,{depth:1}));assert.equal(hold.status,'Solved');assert.equal(hold.routes[0].steps[0].scene.holdFirst,true);
  context.snapshot.holdLocked=true;assert.equal(searchCombo(req(context,{depth:1,cleanup:0})).status,'No solution within scope');
  const cleanup=req(fixture(['____XXXXXX','____XXXXXX'],'OO'),{depth:2});const restarted=searchCombo(cleanup);
  assert.equal(restarted.status,'Solved');assert.equal(restarted.routes[0].combo?.setup,1);assert.equal(restarted.routes[0].combo?.clears,1);assert.ok(verifyComboRoute(cleanup,restarted.routes[0]));
  const limited=searchCombo(req(fixture([], 'OTILJSZI'),{milliseconds:1}));assert.equal(limited.complete,false);assert.equal(limited.status,'Incomplete');
});
test('native four columns, center/side channels and ordinary terrain remain distinct',()=>{
  const source=fixture([],'I');
  for(const geometry of ['native','center','left','right','terrain'] as const) for(const residue of [0,1,2]) {
    const scene=comboScene(source,geometry,residue,42);validatePcScene(scene);
    assert.equal(scene.context.rules.board.width,geometry==='native'?4:10);
    assert.match(comboBoardKind(req(scene.context)),geometry==='native'?/Native/:geometry==='terrain'?/Ordinary/:/channel/);
    if(geometry==='native')assert.equal(scene.context.rules.advanced.kickSet,'SRS-X');
  }
});
test('four-column longest sequence is proved with compact states and every candidate replays',()=>{
  const request=req(fixture([],'IIIII',4),{depth:5,cleanup:0});const result=searchCombo(request);
  assert.equal(result.status,'Solved');assert.equal(result.combo?.best,5);assert.equal(result.routes[0].combo?.endCombo,4);assert.equal(result.complete,true);assert.ok(result.routes.every(route=>verifyComboRoute(request,route)));
});
test('combo coverage reuses the unknown-bag model for a stated consecutive-clear target',()=>{
  const context=fixture(['XXXXXXXX__','XXXXXXXX__','XXXXXXXX__','XXXXXXXX__'],'O');
  const result=searchCoverage(req(context),{model:{remaining:'io',refill:'ijlostz'},draws:1,samples:64,seed:1,milliseconds:3000,target:2});
  assert.equal(result.total,2);assert.equal(result.solved,1);assert.equal(result.failed,1);assert.deepEqual(result.bound,{lower:.5,upper:.5});assert.equal(result.policy?.lower,.5);
});
test('frozen combo attack uses the analyzed frame multiplier, and final known Hold is independent of the hidden replacement',()=>{
  const context=fixture(['XXXXXXXX__','XXXXXXXX__'],'O');context.snapshot.frame=600;context.rules.advanced.garbageMargin=0;context.rules.advanced.garbageIncrease=.1;
  const fixed=frozenAttackRules(context.rules.advanced,600);assert.equal(fixed.garbageMultiplier,2);assert.equal(fixed.garbageIncrease,0);
  const frozen=frozenContext(context,true);assert.equal(frozen.rules.advanced.garbageMultiplier,2);
  const result=searchCombo(req(context,{objective:'attack'}));assert.equal(result.status,'Solved');assert.ok(result.routes.every(route=>verifyComboRoute(req(context,{objective:'attack'}),route)));
  context.rules.hold=true;context.snapshot.hold='o' as any;
  for(let y=2;y<4;y++)for(let x=0;x<8;x++)context.snapshot.board[y][x]={mino:'gb' as any,connections:0};
  const request=req(context,{depth:2}), held=searchCombo(request);assert.equal(held.combo?.best,2);assert.ok(held.routes.some(r=>r.steps.at(-1)?.unknownCurrent));assert.ok(held.routes.every(route=>verifyComboRoute(request,route)));
});
