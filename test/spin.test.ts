import test from 'node:test';
import assert from 'node:assert/strict';
import type { Mino } from '@haelp/teto/engine';
import { defaults } from '../src/settings';
import { modeDefinitions, roomPreset, roomPresetNames } from '../src/modes';
import { createEngine, spawnSnapshot } from '../src/engine';
import { analysisContext, customRulesFromMode } from '../src/analysis-context';
import { spinRequest, searchSpins, verifySpinRoute, spinEngine, enumerateSpinPlacements, applySpinPath, matchesSpin } from '../src/spin-search';
import { spinDrill, spinDrills, spinCluster } from '../src/spin-scenes';
import { frozenContext } from '../src/pc-scenes';
import { TrainerGame } from '../src/game';
import { sameCells } from '../src/practice';
import { buildDemoFrames } from '../src/demo-frames';
import { placementSteps } from '../src/guide';
import roomCatalog from '../src/room-presets.json';
import { randomSpinDrill } from '../src/spin-generator';
import { supportedSpinTerrain } from '../src/spin-terrain';
import { SpinTracker } from '../src/spin-tracker';
import { spinReplayScene, spinReplaySamples } from '../src/spin-replay';
import { buildPlayback } from '../src/playback';
import { readReplay } from '../src/replay';
import { applySpinPath as playSpin } from '../src/spin-movement';

function source() { const rules=modeDefinitions.sprint.rules(defaults),engine=createEngine(defaults,17,rules);return analysisContext(rules,defaults,engine.snapshot({isUndoRedo:true})); }
function setup(rows:string[],queue:string) { const context=source(),engine=createEngine(defaults,17,context.rules);context.rules.hold=false;context.snapshot.board=context.snapshot.board.map(row=>row.map(()=>null));for(const [y,row] of rows.entries())for(const [x,c] of [...row].entries())if(c==='X')context.snapshot.board[y][x]={mino:'gb' as Mino,connections:0};context.snapshot.falling=spawnSnapshot(engine,queue[0] as Mino);context.snapshot.hold=null;context.snapshot.queue.value=[...queue.slice(1)] as Mino[];context.snapshot._queue.value=[...context.snapshot.queue.value];return context; }

test('single-piece enumeration proves a T-spin Double using one T and preserves distinct rotation histories',()=>{
  const {scene}=spinDrill(source(),'tsd'),request=spinRequest(scene.context,{filters:{lines:2}}),result=searchSpins(request);
  assert.equal(result.status,'Solved');assert.equal(result.complete,true);assert.ok(result.routes.length>1);
  for(const route of result.routes){assert.equal(route.steps.length,1);assert.equal(route.terminalLines,2);assert.equal(route.evidence.spin,'normal');assert.ok(verifySpinRoute(request,route));}
  assert.ok(result.routes.some(route=>route.evidence.used180));assert.ok(result.routes.some(route=>!route.evidence.used180));
  assert.ok(result.elapsedMs<2500);
});

test('all authored spin/kick witnesses and mirrored T drills use the active engine and animated kick paths',()=>{
  for(const drill of spinDrills){const {scene,witness}=spinDrill(source(),drill.id);assert.ok(verifySpinRoute(spinRequest(scene.context,{filters:scene.filters}),witness));if(drill.piece!=='t'&&witness.evidence.spin!=='none')assert.equal(witness.evidence.spin,'mini');assert.ok(supportedSpinTerrain(scene.context.snapshot.board),drill.id);const engine=spinEngine(spinRequest(scene.context));const step=witness.steps[0].scene;const frames=buildDemoFrames({...step,serial:1,sceneNumber:1},engine,placementSteps(step.path,defaults));assert.ok(frames.at(-1)!.label.startsWith('Complete'));}
  for(const id of ['tsd','mini','180']){const {scene,witness}=spinDrill(source(),id,true);assert.ok(verifySpinRoute(spinRequest(scene.context,{filters:scene.filters}),witness));}
});

test('legal Hold starts from spawn, disabled/locked Hold is excluded, and unknown current cannot invent a piece',()=>{
  const {scene}=spinDrill(source(),'tsd'),context=scene.context,engine=createEngine(defaults,17,context.rules);
  context.snapshot.falling=spawnSnapshot(engine,'o' as Mino);context.snapshot.hold='t' as Mino;
  let request=spinRequest(context,{filters:{piece:'t',lines:2}}),result=searchSpins(request);assert.ok(result.routes.length);assert.ok(result.routes.every(route=>route.steps[0].scene.holdFirst));
  context.snapshot.holdLocked=true;assert.equal(searchSpins(spinRequest(context,{filters:{piece:'t'}})).routes.length,0);
  context.snapshot.holdLocked=false;context.rules.hold=false;assert.equal(searchSpins(spinRequest(context,{filters:{piece:'t'}})).routes.length,0);
  context.rules.hold=true;context.currentKnown=false;request=spinRequest(context,{filters:{piece:'t',lines:2}});result=searchSpins(request);assert.ok(result.routes.length);assert.ok(result.routes.every(route=>route.steps[0].unknownCurrent&&verifySpinRoute(request,route)));
});

test('geometric insertions do not claim scoring when spins are disabled and O has no fabricated corner bonus',()=>{
  const context=source();context.rules.advanced.spinBonuses='none';const {scene}=spinDrill(context,'tsd');
  assert.equal(searchSpins(spinRequest(scene.context)).routes.length,0);
  const request=spinRequest(scene.context,{filters:{kind:'geometric',lines:2}}),result=searchSpins(request);assert.ok(result.routes.length);assert.ok(result.routes.every(route=>route.evidence.spin==='none'&&verifySpinRoute(request,route)));
  const empty=source();empty.snapshot.falling=spawnSnapshot(createEngine(defaults,1,empty.rules),'o' as Mino);empty.rules.hold=false;assert.equal(searchSpins(spinRequest(empty)).routes.length,0);
});

test('the finite model keeps non-spin endpoints and scored endpoints separate and truncation never proves no solution',()=>{
  const {scene}=spinDrill(source(),'mini'),request=spinRequest(scene.context),engine=spinEngine(request);
  const reached=enumerateSpinPlacements(engine,engine.snapshot({isUndoRedo:true}));
  assert.equal(reached.complete,true);assert.ok(reached.placements.some(p=>p.evidence.spin==='none'));assert.ok(reached.placements.some(p=>p.evidence.spin==='mini'));
  const bounded=searchSpins(spinRequest(scene.context,{nodes:1}));assert.notEqual(bounded.status,'No solution within scope');assert.equal(bounded.complete,false);
  scene.context.rules.allow180=false;const result=searchSpins(spinRequest(scene.context,{filters:{rotation:'180'}}));assert.equal(result.routes.length,0);assert.equal(result.complete,true);
});

test('setup search builds an exact two-line spin within two and three placements without reading unknown Next',()=>{
  for(const [rows,queue] of [[['__XX_XXXXX','__X___XXXX','___X______'],'ot'],[['__XX_XXX__','__X___XX__','___X______'],'oot']] as const){const context=setup([...rows],queue);const request=spinRequest(context,{depth:queue.length,milliseconds:10000,filters:{piece:'t',lines:2}}),result=searchSpins(request);assert.ok(result.routes.length,result.reasons.join(' '));assert.ok(result.routes.some(route=>route.steps.length===queue.length));for(const route of result.routes)assert.ok(verifySpinRoute(request,route));context.snapshot.queue.value=[];context.snapshot._queue.value=[];assert.equal(searchSpins(spinRequest(context,{depth:queue.length,filters:{piece:'t',lines:2}})).routes.length,0);}
});

test('every room retains its archived kick and spin defaults through frozen Spin practice',()=>{
  for(const id of Object.keys(roomPresetNames)){const settings=structuredClone(defaults);settings.custom=roomPreset(id);const rules=modeDefinitions.custom.rules(settings),engine=createEngine(settings,1,rules),context=analysisContext(rules,settings,engine.snapshot({isUndoRedo:true})),frozen=rules.advanced.hardDrop?frozenContext(context,true):context,request=spinRequest(frozen);const raw=(roomCatalog.presets as Record<string,Record<string,unknown>>)[id];assert.equal(request.base.rules.advanced.kickSet,raw['options.kickset']);assert.equal(request.base.rules.advanced.spinBonuses,raw['options.spinbonuses']);assert.equal(spinEngine(request).kickTableName,raw['options.kickset']);if(!rules.advanced.hardDrop)assert.equal(searchSpins(request).status,'Unsupported');}
  assert.equal(source().rules.advanced.spinBonuses,'all-mini+');
});

test('guided spin retries one piece and time, teaches the verified spin path and accepts it without stricter finesse',()=>{
  const {scene,witness}=spinDrill(source(),'tsd'),settings=structuredClone(defaults);settings.training.countdownSeconds=0;settings.custom=customRulesFromMode(scene.context.rules);settings.custom.finesse=true;
  const game=new TrainerGame(settings,1,undefined,'custom');game.start();game.loadAnalysis(scene.context.snapshot);
  const step=witness.steps[0].scene;game.setContinuation({...step,spinGoal:{spin:'normal',lines:2}},true);
  game.input.press('hardDrop');game.step();game.input.release('hardDrop');assert.equal(game.engine.stats.pieces,0);assert.equal(game.elapsedMs,0);assert.equal(game.waitingForInput,true);assert.deepEqual(game.demonstration?.path,step.path);
  for(const move of step.path.moves){game.engine.press(move as 'rotateCW'|'softDrop');}
  game.engine.hardDrop();assert.equal(game.engine.stats.pieces,1);assert.equal(game.placements.at(-1)!.accepted,true);assert.equal(game.demonstration,null);
  assert.ok(sameCells(game.placements.at(-1)!.cells,step.target));
});

test('scene clustering separates mode, orientation and occupied terrain',()=>{const a=spinDrill(source(),'tsd').scene,b=structuredClone(a);assert.equal(spinCluster(a),spinCluster(b));b.context.rules.advanced.kickSet='SRS';assert.notEqual(spinCluster(a),spinCluster(b));b.context=structuredClone(a.context);b.context.snapshot.falling.rotation=1;assert.notEqual(spinCluster(a),spinCluster(b));});

test('randomized drills vary position, height and terrain and preserve every selected spin class',()=>{
  for(const {id} of spinDrills){const columns=new Set<number>(),boards=new Set<string>(),heights=new Set<number>();for(let seed=1;seed<=24;seed++){const {scene,witness}=randomSpinDrill(source(),id,seed);assert.ok(verifySpinRoute(spinRequest(scene.context,{filters:scene.filters}),witness));assert.ok(supportedSpinTerrain(scene.context.snapshot.board),id);columns.add(Math.min(...witness.steps[0].scene.target.map(([x])=>x)));heights.add(Math.min(...witness.steps[0].scene.target.map(([,y])=>y)));boards.add(JSON.stringify(scene.context.snapshot.board));}assert.ok(columns.size>=2,`${id}: ${columns.size} columns`);assert.ok(heights.size>=2,`${id}: ${heights.size} heights`);assert.ok(boards.size>=12,`${id}: ${boards.size} boards`);}
});

test('live spin evidence follows actual rotations and survives snapshot restoration without scoring geometry as a bonus',()=>{
  const context=source();context.rules.advanced.spinBonuses='none';const {scene,witness}=spinDrill(context,'tsd'),engine=spinEngine(spinRequest(scene.context)),tracker=new SpinTracker(engine);let proof:ReturnType<SpinTracker['evidence']>|undefined;
  engine.events.on('falling.lock.pre',()=>{proof=tracker.evidence();});applySpinPath(engine,witness.steps[0].scene.path);assert.ok(proof?.geometric);assert.equal(proof?.spin,'none');assert.equal(proof?.rotation?.to,witness.evidence.rotation?.to);
  engine.fromSnapshot(scene.context.snapshot);tracker.restore(null);engine.press('rotateCW');const snapshot=engine.snapshot({isUndoRedo:true}),trace=tracker.snapshot();engine.press('moveLeft');assert.equal(tracker.evidence().rotation,null);engine.fromSnapshot(snapshot);tracker.restore(trace);assert.equal(tracker.evidence().rotation?.to,1);
});

test('replay review extracts a verified missed spin with only recorded visible Next',async()=>{
  const {scene}=spinDrill(source(),'tsd'),settings=structuredClone(defaults);settings.training.countdownSeconds=0;settings.training.finesseEnabled=false;settings.custom=customRulesFromMode(scene.context.rules);settings.custom.finesse=false;
  const game=new TrainerGame(settings,1,undefined,'custom');game.start();game.loadAnalysis(scene.context.snapshot);game.input.press('hardDrop');game.step();game.input.release('hardDrop');game.step();
  const track=readReplay(game.export(),'Spin review test')[0],playback=await buildPlayback(track,settings),samples=spinReplaySamples(playback,track);assert.equal(samples.length,1);assert.equal(samples[0].kind,'missed');const result=searchSpins(spinRequest(samples[0].scene.context,{filters:{piece:'t',lines:2}}));assert.ok(result.routes.length);assert.equal(samples[0].scene.finiteQueue,true);assert.equal(samples[0].scene.context.generated,undefined);assert.ok(spinReplayScene(playback,playback.frames[0]).context.snapshot.queue.value.length<=playback.rules.nextCount);
});

test('every catalog variant is grounded and preserves all TTT rotation chapters and scored line classes',()=>{
  for(const drill of spinDrills)for(let variant=0;variant<(drill.variants?.length??1);variant++){
    const {scene,witness}=spinDrill(source(),drill.id,false,variant);assert.ok(supportedSpinTerrain(scene.context.snapshot.board),`${drill.id}/${variant}`);assert.ok(verifySpinRoute(spinRequest(scene.context,{filters:scene.filters}),witness),`${drill.id}/${variant}`);
  }
  for(const piece of ['i','j','l','s','z'])for(const lines of [0,1,2,3])assert.ok(spinDrills.some(drill=>drill.piece===piece&&drill.variants?.some(variant=>variant.lines===lines&&variant.spin==='mini')),`${piece}/${lines}`);
  assert.ok(spinDrills.every(drill=>drill.piece!=='o'));
  for(const section of [14,15,16,17])for(let lesson=1;lesson<=10;lesson++)assert.ok(spinDrills.some(drill=>drill.id.startsWith(`ttt-${section}-${lesson}-`)),`${section}-${lesson}`);
  for(const id of ['ttt-14-7-l','ttt-16-6-t','ttt-16-7-t','ttt-16-8-t','ttt-30-7-s','ttt-30-8-l','ttt-30-9-i'])assert.ok(spinDrills.some(drill=>drill.id===id),id);
});

test('minimum-input hints improve a generated witness and a shorter valid spin is accepted with finesse enabled',()=>{
  const {scene,witness}=randomSpinDrill(source(),'tsd',2),request=spinRequest(scene.context,{filters:scene.filters}),result=searchSpins(request),best=result.routes[0];
  assert.ok(result.complete);assert.equal(best.steps[0].scene.path.cost,4);assert.equal(witness.steps[0].scene.path.cost,5);assert.ok(verifySpinRoute(request,best));
  const settings=structuredClone(defaults);settings.training.countdownSeconds=0;settings.custom=customRulesFromMode(scene.context.rules);settings.custom.finesse=true;
  const game=new TrainerGame(settings,1,undefined,'custom');game.start();game.loadAnalysis(scene.context.snapshot);game.analysisPolicy='any';game.setContinuation({...witness.steps[0].scene,spinGoal:{spin:'normal',lines:2}},false);
  game.spinFinessePaths=result.routes.map(route=>{const step=route.steps[0];return {piece:step.piece,target:step.scene.target,spin:step.spin,lines:step.lines,hold:!!step.scene.holdFirst,path:step.scene.path};});
  playSpin(game.engine,best.steps[0].scene.path);assert.equal(game.engine.stats.pieces,1);assert.equal(game.placements.at(-1)!.accepted,true);assert.equal(game.faults,0);
  const basic=spinDrill(source(),'tsd'),minimum=searchSpins(spinRequest(basic.scene.context,{filters:basic.scene.filters}));assert.equal(minimum.routes[0].steps[0].scene.path.cost,2);
});

test('TTT lessons keep their translated slot and reject horizontal I floor flips and ordinary air rotations',()=>{
  assert.ok(!spinDrills.some(drill=>drill.id==='i-rotation-quad'));
  for(const id of ['ttt-16-4-i','ttt-17-4-i','ttt-30-9-i'])for(const seed of [1,2,7,17]){
    const {scene,witness}=randomSpinDrill(source(),id,seed),request=spinRequest(scene.context,{filters:scene.filters}),result=searchSpins(request);
    assert.ok(result.complete&&result.routes.length,`${id}/${seed}`);
    assert.ok(sameCells(scene.filters!.target!,witness.steps[0].scene.target));
    assert.ok(result.routes.every(route=>sameCells(route.steps[0].scene.target,witness.steps[0].scene.target)&&verifySpinRoute(request,route)));
  }
  const {scene}=randomSpinDrill(source(),'ttt-16-4-i',2),engine=spinEngine(spinRequest(scene.context)),tracker=new SpinTracker(engine);
  engine.softDrop();const before=engine.falling.absoluteBlocks;engine.press('rotate180');const proof=tracker.evidence();
  assert.ok(sameCells(before,engine.falling.absoluteBlocks));assert.equal(proof.rotation?.changed,false);assert.equal(proof.geometric,false);assert.equal(proof.usedKick,false);assert.equal(proof.spin,'none');
  assert.equal(matchesSpin(scene.filters!,proof,'i',0,false,engine.falling.absoluteBlocks),false);
  const replay=applySpinPath(spinEngine(spinRequest(scene.context)),{moves:['softDrop','rotate180'],cost:1,source:'extended',drop:'soft'});
  assert.equal(replay.evidence.geometric,false);assert.equal(replay.evidence.usedKick,false);
  const air=applySpinPath(spinEngine(spinRequest(scene.context)),{moves:['rotateCW'],cost:1,source:'extended',drop:'hard'});
  assert.equal(matchesSpin({...scene.filters!,kind:'rotation',target:undefined,lines:-1},air.evidence,'i',air.result.lines,false),false);
});

test('replay review distinguishes a blocked 180 kick from a successful rotation',async()=>{
  const {scene,witness}=spinDrill(source(),'j'),engine=spinEngine(spinRequest(scene.context));for(const move of witness.steps[0].scene.path.moves)engine.press(move as 'rotateCW');
  const settings=structuredClone(defaults);settings.training.countdownSeconds=0;settings.training.finesseEnabled=false;settings.custom=customRulesFromMode(scene.context.rules);settings.custom.finesse=false;
  const game=new TrainerGame(settings,1,undefined,'custom');game.start();game.loadAnalysis(engine.snapshot({isUndoRedo:true}));game.setJustThink(true,'input');game.input.press('rotate180');game.step();game.input.release('rotate180');game.step();
  const track=readReplay(game.export(),'Blocked rotation')[0],playback=await buildPlayback(track,settings),samples=spinReplaySamples(playback,track);assert.ok(samples.some(sample=>sample.kind==='kick'&&sample.actual==='Failed 180 rotation'));
});
