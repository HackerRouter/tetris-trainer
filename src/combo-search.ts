import type { EngineSnapshot, Mino } from '@haelp/teto/engine';
import { analysisEngine, pcCapabilities, stableKey, type AnalysisRequest, type AnalysisResult } from './analysis';
import { applyContinuationPath, boardMask, type ContinuationRoute, type ContinuationStep } from './continuation-search';
import { reachablePlacements } from './reachable-placements';
import { sameCells } from './practice';
import { spawnSnapshot } from './engine';
import { pcBoardOrder } from './pc-board';

function channelOrder(rows: number[], width: number) {
  const heights = Array<number>(width).fill(0), holes = Array<number>(width).fill(0), cells = Array<number>(width).fill(0);
  for(let x=0;x<width;x++) for(let y=rows.length-1;y>=0;y--) {
    if(rows[y]&(1<<x)) { heights[x]=Math.max(heights[x],y+1); cells[x]++; }
    else if(heights[x]) holes[x]++;
  }
  let best=Infinity;
  for(const start of [0,3,6]) {
    const well=heights.slice(start,start+4), outside=heights.filter((_,x)=>x<start||x>=start+4);
    const outsideHoles=holes.reduce((sum,n,x)=>sum+(x<start||x>=start+4?n:0),0);
    const wellHoles=holes.slice(start,start+4).reduce((sum,n)=>sum+n,0), residue=cells.slice(start,start+4).reduce((sum,n)=>sum+n,0);
    let roughness=0;
    for(let x=1;x<width;x++) if((x<start||x>=start+4)&&(x-1<start||x-1>=start+4)) roughness+=Math.abs(heights[x]-heights[x-1]);
    const score=outsideHoles*80+wellHoles*12+roughness*3+well.reduce((sum,n)=>sum+n,0)*8+Math.abs(residue-3)*2+Math.max(...outside)-Math.min(...outside)*18;
    best=Math.min(best,score);
  }
  return best;
}

export function comboBoardKind(request: AnalysisRequest) {
  if (request.rules.board.width === 4) return 'Native four-column board';
  const rows = request.position.board;
  for (const x of [0,3,6]) if (rows.slice(0,4).every(row => row.every((tile,i) => (i >= x && i < x+4) || !!tile)) && rows.slice(0,4).filter(row=>row.slice(x,x+4).every(tile=>!tile)).length>=2) return `Ten-column ${x === 3 ? 'center' : x === 0 ? 'left' : 'right'} four-wide channel`;
  return 'Ordinary ten-column terrain';
}
export function verifyComboRoute(request: AnalysisRequest, route: ContinuationRoute) {
  const alternatives = route.steps.at(-1)?.unknownCurrent ? [...'ijlostz'] : [''];
  for (const alternative of alternatives) {
    const engine = analysisEngine(request); let locked: [number,number][] = [], started = false, setup = 0;
    engine.events.on('falling.lock.pre', () => { locked = engine.falling.absoluteBlocks; });
    for (const step of route.steps) {
      if (step.unknownCurrent && alternative) { if (step !== route.steps.at(-1) || !step.scene.holdFirst || !engine.held) return false; const snapshot = engine.snapshot({isUndoRedo:true}); snapshot.falling = spawnSnapshot(engine, alternative as Mino); engine.fromSnapshot(snapshot); }
      if (step.scene.holdFirst && !engine.press('hold')) return false;
      const outcome = applyContinuationPath(engine,step.scene.path);
      if (!sameCells(locked,step.scene.target) || outcome.mino !== step.piece || outcome.lines !== step.lines || outcome.spin !== step.spin || stableKey(boardMask(engine.board.state)) !== stableKey(boardMask(step.after.board))) return false;
      if (outcome.lines) started = true; else { if (started) return false; setup++; }
    }
    if (!started || setup > (request.goal.cleanup ?? Math.max(0, request.depth - 1)) || route.steps.length > request.depth || !route.combo || route.combo.clears !== route.steps.length - setup || route.combo.endCombo !== engine.stats.combo || Math.abs(route.combo.attack - (engine.stats.garbage.attack - request.position.stats.garbage.attack)) > .000001) return false;
  }
  return true;
}
export function searchCombo(request: AnalysisRequest, progress?: (result: AnalysisResult) => void): AnalysisResult {
  const start = performance.now(), deadline = start + request.budget.milliseconds, reasons = pcCapabilities(request).map(reason => reason.replaceAll('PC Lab','Combo Lab'));
  const objective = request.goal.objective ?? 'clears';
  const result: AnalysisResult = { sessionId:request.sessionId,revision:request.revision,fingerprint:request.fingerprint,solver:request.solver,status:reasons.length?'Unsupported':'Incomplete',routes:[],complete:false,reasons,checked:0,elapsedMs:0,verification:'engine-rules',timing:'frozen',queue:request.position.currentKnown?[request.position.falling.symbol,...request.position.next]:[],information:request.information,depth:request.depth,lines:0,combo:{objective,best:0,proven:false,board:comboBoardKind(request),immediateChoices:0,immediateComplete:false} };
  if (reasons.length) return result;
  const engine = analysisEngine(request), initial = engine.snapshot({isUndoRedo:true}), memo = new Map<string, ContinuationStep[]>(), moveCache = new Map<string, ReturnType<typeof reachablePlacements>>(), counts = new Map<string,number>();
  const setupLimit = request.goal.cleanup ?? Math.max(0, request.depth - 1);
  const longOpening = request.depth>20 && result.queue.length>20 && setupLimit>2 && request.rules.board.width===10 && request.position.stats.combo<0;
  const initialCells=initial.board.reduce((sum,row)=>sum+row.filter(Boolean).length,0);
  let limited = false, pruned = false, lastProgress = start, locked: [number,number][] = [];
  engine.events.on('falling.lock.pre', () => { locked = engine.falling.absoluteBlocks; });
  const stop = () => performance.now() >= deadline || result.checked >= request.budget.nodes;
  const keyFor = (snapshot: EngineSnapshot, drawn: number, depth: number, started: boolean, cleanup: number) => `${boardMask(snapshot.board)}|${snapshot.falling.symbol}|${snapshot.falling.location}|${snapshot.falling.rotation}|${snapshot.hold}|${snapshot.holdLocked}|${drawn}|${depth}|${started}|${cleanup}|${stableKey(snapshot.stats)}|${stableKey(snapshot.lastSpin)}`;
  const quality = (steps: ContinuationStep[], before: EngineSnapshot) => objective === 'attack' ? (steps.at(-1)?.after.stats.garbage.attack ?? before.stats.garbage.attack) - before.stats.garbage.attack : steps.filter(step => step.lines > 0).length;
  const compareSteps = (a: ContinuationStep[], b: ContinuationStep[], before: EngineSnapshot) => quality(b,before)-quality(a,before) || b.filter(s=>s.lines).length-a.filter(s=>s.lines).length || a.filter(s=>!s.lines).length-b.filter(s=>!s.lines).length;
  const better = (a: ContinuationStep[], b: ContinuationStep[], before: EngineSnapshot) => compareSteps(a,b,before)<0;
  const annotate = (steps: ContinuationStep[]): ContinuationRoute => {
    let drawn = 0, started = false, cleanup = setupLimit;
    const choices = steps.map((step,i) => { const count = counts.get(keyFor(step.scene.snapshot,drawn,request.depth-i,started,cleanup)) ?? 0; drawn += 1 + Number(step.scene.holdFirst && !step.scene.snapshot.hold); if (step.lines) started = true; else cleanup--; return count; });
    const last = steps.at(-1)!;
    const following = counts.get(keyFor(last.after,drawn,request.depth-steps.length,started,cleanup));
    const boundary = steps.length>=request.depth?'Placement horizon reached':drawn>result.queue.length||(drawn===result.queue.length&&(!last.after.hold||!request.rules.hold))?'Known queue exhausted':following?`${following} immediate continuations remain`:following===0&&!limited?'No legal clearing continuation at this endpoint':'Continuation beyond this preview is not established';
    return { id: steps.map(s=>`${s.scene.holdFirst?'h':''}${s.piece}:${s.scene.target.map(c=>c.join(',')).sort().join(';')}`).join('|'), steps:structuredClone(steps),spins:steps.filter(s=>s.spin!=='none'&&s.lines).length,lines:steps.reduce((sum,s)=>sum+s.lines,0),pc:last.pc,combo:{clears:steps.filter(s=>s.lines>0).length,setup:steps.filter(s=>!s.lines).length,attack:last.after.stats.garbage.attack-initial.stats.garbage.attack,endCombo:last.after.stats.combo,choices,boundary} };
  };
  const compare = (a: ContinuationRoute,b: ContinuationRoute) => compareSteps(a.steps,b.steps,initial) || a.steps.reduce((sum,s)=>sum+s.scene.path.cost,0)-b.steps.reduce((sum,s)=>sum+s.scene.path.cost,0);
  const emit = () => { result.elapsedMs=performance.now()-start; result.combo!.best=result.routes[0] ? objective==='attack'?result.routes[0].combo!.attack:result.routes[0].combo!.clears : 0; progress?.(structuredClone(result)); lastProgress=performance.now(); };
  const consider = (steps: ContinuationStep[]) => {
    if (!steps.some(s=>s.lines)) return;
    if(result.routes.length>=request.budget.candidates) {
      const last=result.routes.at(-1)!,rank=compareSteps(steps,last.steps,initial);
      if(rank>0||(rank===0&&steps.reduce((sum,s)=>sum+s.scene.path.cost,0)>=last.steps.reduce((sum,s)=>sum+s.scene.path.cost,0))) return;
    }
    const route = annotate(steps);
    if (result.routes.some(r=>r.id===route.id)) return;
    if (result.routes.length>=request.budget.candidates && compare(route,result.routes.at(-1)!)>=0) return;
    if (!verifyComboRoute(request,route)) { limited=true; return; }
    result.routes.push(route); result.routes.sort(compare); result.routes=result.routes.slice(0,request.budget.candidates); result.status='Solved';
    if (result.routes[0]===route || performance.now()-lastProgress>200) emit();
  };
  type Branch = {step:ContinuationStep;drawn:number;order:number;channel:number};
  const expand = (snapshot:EngineSnapshot,drawn:number,depth:number,started:boolean,cleanup:number):Branch[] => {
    if (stop()) { limited=true; return []; }
    if (!depth || drawn>result.queue.length || (drawn===result.queue.length && (!snapshot.hold || snapshot.holdLocked || !request.rules.hold))) return [];
    const key=keyFor(snapshot,drawn,depth,started,cleanup);
    const branches: Branch[]=[]; let complete=true;
    for(const holdFirst of [false,true]) {
      if(drawn===result.queue.length&&!holdFirst) continue;
      engine.fromSnapshot(snapshot); const emptyHold=!snapshot.hold;
      if(holdFirst&&(!request.rules.hold||snapshot.holdLocked||(emptyHold&&drawn+1>=result.queue.length)||!engine.press('hold'))) continue;
      const before=engine.snapshot({isUndoRedo:true}), moveKey=`${boardMask(before.board)}|${stableKey(before.falling)}`;
      const reached=moveCache.get(moveKey)??reachablePlacements(engine,before,snapshot.board.length,stop);
      if(reached.complete) { if(moveCache.size>=2048) moveCache.delete(moveCache.keys().next().value!); moveCache.set(moveKey,reached); } else { complete=false; limited=true; }
      for(const p of reached.placements) {
        if(stop()) {limited=true;complete=false;break;}
        result.checked++; engine.fromSnapshot(before); const outcome=applyContinuationPath(engine,p.path), after=engine.snapshot({isUndoRedo:true});
        if(!sameCells(locked,p.target)) {limited=true;complete=false;continue;}
        if(engine.toppedOut || (started&&!outcome.lines) || (!started&&!outcome.lines&&!cleanup)) continue;
        const step:ContinuationStep={scene:{id:`combo-${result.checked}`,snapshot,guideSnapshot:holdFirst?before:undefined,holdFirst,target:p.target,path:p.path},after,lines:outcome.lines,spin:outcome.spin,piece:outcome.mino,pc:!!outcome.lines&&!after.board.some(row=>row.some(Boolean)),unknownCurrent:drawn===result.queue.length};
        const rows=boardMask(after.board),order=pcBoardOrder(rows,request.rules.board.width);
        branches.push({step,drawn:drawn+1+Number(holdFirst&&emptyHold),order,channel:longOpening?channelOrder(rows,request.rules.board.width):order});
      }
    }
    const clearing=branches.filter(b=>b.step.lines>0); counts.set(key,clearing.length);
    if(depth===request.depth) {result.combo!.immediateChoices=clearing.length;result.combo!.immediateComplete=complete;}
    const candidates=clearing.length&&!(longOpening&&!started)?clearing:branches;
    candidates.sort((a,b)=>(objective==='attack'?b.step.after.stats.garbage.attack-a.step.after.stats.garbage.attack:0)||a.order-b.order);
    return candidates;
  };
  const visit = (snapshot:EngineSnapshot,drawn:number,depth:number,started:boolean,cleanup:number,prefix:ContinuationStep[],expanded?:Branch[]):ContinuationStep[] => {
    if (stop()) { limited=true; return []; }
    const key=keyFor(snapshot,drawn,depth,started,cleanup), cached=memo.get(key); if(cached) { consider([...prefix,...cached]); return cached; }
    const candidates=expanded??expand(snapshot,drawn,depth,started,cleanup);
    let best:ContinuationStep[]=[];
    for(const branch of candidates) {
      const next=[...prefix,branch.step]; consider(next);
      const rest=visit(branch.step.after,branch.drawn,depth-1,started||!!branch.step.lines,cleanup-Number(!branch.step.lines),next), path=[branch.step,...rest];
      if(path.some(s=>s.lines)&&(!best.length||better(path,best,snapshot))) best=path;
      if(stop()) {limited=true;break;}
    }
    if(!limited&&memo.size<5000) memo.set(key,best);
    return best;
  };
  const root = expand(initial,0,request.depth,false,setupLimit);
  if (setupLimit <= 2 || (!longOpening&&root.some(branch=>branch.step.lines))) visit(initial,0,request.depth,false,setupLimit,[],root);
  else {
    type Node = {snapshot:EngineSnapshot;drawn:number;started:boolean;cleanup:number;steps:ContinuationStep[];order:number;potential:number};
    const passes=longOpening?[{width:8,channel:false},{width:8,channel:true},{width:32,channel:true},{width:32,channel:false},{width:128,channel:true},{width:128,channel:false},{width:512,channel:true}]:[8,32,128,512].map(width=>({width,channel:false}));
    for (const {width,channel} of passes) {
      let beam:Node[]=[{snapshot:initial,drawn:0,started:false,cleanup:setupLimit,steps:[],order:0,potential:0}], passPruned=false;
      for(let ply=0;ply<request.depth&&beam.length&&!stop();ply++) {
        const next=new Map<string,Node>();
        for(const node of beam) {
          const branches=ply===0?root:expand(node.snapshot,node.drawn,request.depth-ply,node.started,node.cleanup);
          for(const branch of branches) {
            const steps=[...node.steps,branch.step],remaining=Math.max(0,Math.min(request.depth-steps.length,result.queue.length-branch.drawn+Number(request.rules.hold&&!!branch.step.after.hold)));
            const cells=initialCells+4*steps.length-request.rules.board.width*(branch.step.after.stats.lines-initial.stats.lines);
            const potential=steps.filter(step=>step.lines).length+Math.min(remaining,request.rules.board.width>4?Math.floor(cells/(request.rules.board.width-4)):remaining);
            const child:Node={snapshot:branch.step.after,drawn:branch.drawn,started:node.started||!!branch.step.lines,cleanup:node.cleanup-Number(!branch.step.lines),steps,order:channel?branch.channel:branch.order,potential};
            if(child.started) consider(child.steps);
            const key=keyFor(child.snapshot,child.drawn,request.depth-ply-1,child.started,child.cleanup), previous=next.get(key);
            if(!previous||better(child.steps,previous.steps,initial)) next.set(key,child);
          }
          if(stop()) {limited=true;break;}
        }
        beam=[];
        for(const started of [false,true]) {
          const candidates=[...next.values()].filter(node=>node.started===started);
          candidates.sort((a,b)=>(channel&&started?b.potential-a.potential:0)||compareSteps(a.steps,b.steps,initial)||a.order-b.order||a.steps.reduce((sum,s)=>sum+s.scene.path.cost,0)-b.steps.reduce((sum,s)=>sum+s.scene.path.cost,0));
          if(candidates.length>width) {passPruned=true;pruned=true;limited=true;}
          if(channel&&started) {
            const cohorts=new Map<number,Node>();
            for(const node of candidates) if(!cohorts.has(node.cleanup)) cohorts.set(node.cleanup,node);
            const retained=[...cohorts.values()].slice(0,width);
            for(const node of candidates) { if(retained.length>=width) break; if(!retained.includes(node)) retained.push(node); }
            beam.push(...retained);
          } else beam.push(...candidates.slice(0,width));
        }
      }
      if(stop()) {limited=true;break;}
      if(!passPruned) break;
    }
  }
  result.complete=!limited && objective==='clears'; result.combo!.proven=result.complete;
  result.status=result.routes.length?'Solved':limited?'Incomplete':'No solution within scope';
  result.reasons=[pruned?'Opening plans use a bounded search. Best found only; a longer or stronger continuation may exist.':limited?'Search budget reached. Best found only; a longer continuation may exist.':objective==='clears'?'Longest continuation proved within the known queue, placement horizon and setup scope.':'Best attack among enumerated movement paths. Spin-history alternatives are not exhaustive.'];
  if(pruned&&stop()) result.reasons.push('Search budget reached. Verified routes remain available.');
  if(objective==='attack') { result.combo!.proven=false; result.complete=false; if(!result.routes.length) result.status='Incomplete'; if(limited) result.reasons.push('Spin-history alternatives are not exhaustive.'); }
  result.reasons.push('Attack uses the active engine combo, B2B, spin and garbage rules. Time-varying multipliers are frozen at the analyzed frame; future timing is not predicted.');
  result.routes=result.routes.map(route=>annotate(route.steps)).sort(compare); emit(); return result;
}
