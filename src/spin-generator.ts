import type { Mino } from '@haelp/teto/engine';
import type { AnalysisContext } from './analysis-context';
import { supportSpinTerrain } from './spin-terrain';
import { spinDrill, spinDrills } from './spin-scenes';
import { spinRequest, spinEngine, applySpinPath, verifySpinRoute, type SpinRoute } from './spin-search';
import type { Move } from './finesse';
import { sameCells } from './practice';

export function randomSpinDrill(source: AnalysisContext, id: string, seed: number) {
  let state = seed >>> 0;
  const random = (max: number) => { state = (Math.imul(state,1664525)+1013904223)>>>0; return Math.floor(state/4294967296*max); };
  for(let warmup=0;warmup<8;warmup++)random(2);
  const definition=spinDrills.find(drill=>drill.id===id);
  const base = spinDrill(source,id,false,random(definition?.variants?.length??1));
  const translator=spinEngine(spinRequest(base.scene.context)),translated:Move[]=[];
  for(const move of base.witness.steps[0].scene.path.moves){const before=translator.falling.x;translator.press(move as 'moveLeft');if(move==='dasLeft'||move==='dasRight')translated.push(...Array(Math.abs(translator.falling.x-before)).fill(move==='dasLeft'?'moveLeft':'moveRight'));else translated.push(move);}
  for (let attempt=0;attempt<96;attempt++) {
    const scene=structuredClone(base.scene),snapshot=scene.context.snapshot,width=source.rules.board.width;
    const height=base.scene.context.snapshot.board.reduce((top,row,y)=>row.some(Boolean)?y+1:top,0),dx=random(7)-3,dy=random(Math.max(1,Math.min(5,source.rules.board.height-height)));
    const original=base.scene.context.snapshot.board;
    snapshot.board=snapshot.board.map(row=>row.map(()=>null));
    const target=base.witness.steps[0].scene.target.map(([x,y])=>[x+dx,y+dy] as [number,number]);
    if(target.some(([x])=>x<0||x>=width))continue;
    const left=Math.min(...target.map(([x])=>x)),right=Math.max(...target.map(([x])=>x));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)snapshot.board[y+dy][x]=x-dx<0||x-dx>=width?{mino:'gb' as Mino,connections:0}:structuredClone(original[y][x-dx]);
    for(let y=height;y<height+3&&y+dy<snapshot.board.length;y++)for(let x=0;x<width;x++)if(x-dx<0||x-dx>=width)snapshot.board[y+dy][x]={mino:'gb' as Mino,connections:0};
    for(let y=0;y<height;y++){
      const clear=original[y].every((tile,x)=>tile||base.witness.steps[0].scene.target.some(([tx,ty])=>tx===x&&ty===y));
      if(!clear&&snapshot.board[y+dy].every((tile,x)=>tile||target.some(([tx,ty])=>tx===x&&ty===y+dy))){const gaps=Array.from({length:width},(_,x)=>x).filter(x=>x<left||x>right);if(gaps.length)snapshot.board[y+dy][gaps[random(gaps.length)]]=null;}
    }
    for(let y=0;y<dy;y++){
      const gaps=Array.from({length:width},(_,x)=>x).filter(x=>x<left||x>right),gap=gaps[random(gaps.length)];
      for(let x=0;x<width;x++)if(x!==gap)snapshot.board[y][x]={mino:'gb' as Mino,connections:0};
    }
    for(let x=0;x<width;x++){
      if(x>=left-1&&x<=right+1)continue;
      const top=dy+height+random(4)-2;
      for(let y=dy+height-1;y<top;y++)if(y>=0)snapshot.board[y][x]=random(5)?{mino:'gb' as Mino,connections:0}:null;
    }
    if(snapshot.board.some(row=>row.every(Boolean)))continue;
    const moves:Move[]=[...Array(Math.abs(dx)).fill(dx<0?'moveLeft':'moveRight'),...translated];
    const path={...base.witness.steps[0].scene.path,moves,cost:moves.filter(move=>move!=='softDrop'&&move!=='down').length};
    if(!supportSpinTerrain(scene.context,moves))continue;
    if(scene.filters?.target)scene.filters.target=target;
    const request=spinRequest(scene.context,{filters:scene.filters}),engine=spinEngine(request);
    let cells:[number,number][]=[];engine.events.on('falling.lock.pre',()=>{cells=engine.falling.absoluteBlocks;});
    try {
      const {result,evidence}=applySpinPath(engine,path);
      if(result.lines!==base.witness.terminalLines||result.spin!==base.witness.evidence.spin||!sameCells(cells,target))continue;
      const witness:SpinRoute={...base.witness,id:`random-${id}-${seed}-${attempt}`,steps:[{...base.witness.steps[0],scene:{id:scene.id,snapshot,target:cells,path},after:engine.snapshot({isUndoRedo:true}),lines:result.lines,spin:result.spin,pc:engine.board.perfectClear}],evidence,pc:engine.board.perfectClear};
      if(!verifySpinRoute(request,witness))continue;
      scene.name=`${base.scene.name} · random board ${seed}`;
      scene.source=`Generated terrain, slot position and stack height; seed ${seed}; verified with ${source.rules.advanced.kickSet} / ${source.rules.advanced.spinBonuses}.`;
      scene.filters={...scene.filters!,lines:result.lines};
      return {scene,witness};
    } catch {}
  }
  throw new Error('No randomized witness passed the active rules. Try another drill or mode.');
}
