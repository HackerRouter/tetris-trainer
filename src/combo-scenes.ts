import type { Mino } from '@haelp/teto/engine';
import { createEngine } from './engine';
import { analysisContext, withGeneratedPacks, type AnalysisContext } from './analysis-context';
import { modeDefinitions, roomPreset } from './modes';
import { frozenContext, type PcScene } from './pc-scenes';

export function comboScene(source: AnalysisContext, geometry: 'native' | 'center' | 'left' | 'right' | 'terrain', residue = 0, seed = 1): PcScene {
  const settings = structuredClone(source.settings);
  settings.custom = geometry === 'native' ? roomPreset('4wide') : structuredClone(settings.custom);
  if (geometry !== 'native') { settings.custom.advanced.width=10; settings.custom.advanced.height=20; settings.custom.advanced.kickSet='SRS+'; settings.custom.bag='7-bag'; settings.custom.hold=true; settings.custom.infiniteHold=false; settings.custom.advanced.hardDrop=true; settings.custom.advanced.bombs=false; settings.custom.advanced.garbageInterval=0; settings.custom.advanced.garbageRefill=0; settings.custom.advanced.map=''; settings.custom.advanced.sequence=''; settings.custom.roomPreset=''; }
  const rules=modeDefinitions.custom.rules(settings), context=frozenContext(analysisContext(rules,settings,createEngine(settings,seed,rules).snapshot({isUndoRedo:true})),true);
  const engine=createEngine(context.settings,seed,context.rules), snapshot=engine.snapshot({isUndoRedo:true}), width=context.rules.board.width;
  const put=(x:number,y:number)=>{snapshot.board[y][x]={mino:'gb' as Mino,connections:0};};
  if(geometry==='terrain') {
    for(let y=0;y<8;y++) for(let x=0;x<10;x++) if(x!== (y<4?9:0)) put(x,y);
  } else {
    const offset=geometry==='native'||geometry==='left'?0:geometry==='center'?3:6;
    if(width===10) for(let y=0;y<10;y++) for(let x=0;x<10;x++) if(x<offset||x>=offset+4) put(x,y);
    const cells=residue===0?[[0,0],[1,0],[2,0]]:residue===1?[[0,0],[1,0],[0,1]]:[[1,0],[2,0],[2,1]];
    for(const [x,y] of cells) put(offset+x,y);
  }
  context.snapshot=snapshot; context.rules.name='COMBO LAB'; withGeneratedPacks(context);
  return {id:crypto.randomUUID(),name:`${geometry==='native'?'Native 4-column':geometry==='terrain'?'Ordinary terrain':`${geometry[0].toUpperCase()+geometry.slice(1)} 4-wide`} · residue ${residue+1}`,source:geometry==='native'?'Native 4-WIDE rules with an authored training residue; no ten-column walls.':'Authored ten-column training geometry. Channel walls clear with full ten-column lines; this is not the native 4-WIDE room preset.',context,future:true,finiteQueue:false};
}
