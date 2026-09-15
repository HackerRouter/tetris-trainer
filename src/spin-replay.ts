import type { Mino } from '@haelp/teto/engine';
import { analysisContext } from './analysis-context';
import { createEngine } from './engine';
import { copyPiece } from './finesse';
import type { Playback, PlaybackFrame } from './playback';
import type { ReplayTrack } from './replay';
import { SpinSession } from './spin-session';
import { spinRequest } from './spin-search';
import { spinCluster, type SpinScene } from './spin-scenes';
import { spinLabel } from './spin-label';

export function spinReplayScene(playback:Playback,frame:PlaybackFrame):SpinScene {
  if(!frame.piece||frame.analysis.unavailable||frame.analysis.pendingGarbage)throw new Error('Choose a controllable replay frame without pending garbage.');
  const engine=createEngine(playback.settings,1,playback.rules),snapshot=engine.snapshot({isUndoRedo:true});
  Object.assign(snapshot,{board:structuredClone(frame.board),falling:structuredClone(frame.piece),hold:frame.hold as Mino|null,holdLocked:frame.holdLocked,stats:structuredClone(frame.analysis.stats),lastSpin:frame.analysis.lastSpin,lastWasClear:frame.analysis.lastWasClear,frame:Math.round(frame.time*60)});
  snapshot.queue.value=[...frame.next] as Mino[];snapshot._queue.value=[...snapshot.queue.value];
  return {id:crypto.randomUUID(),name:`${playback.name.slice(0,60)} · frame ${Math.round(frame.time*60)}`,source:`Replay frame ${Math.round(frame.time*60)} (${frame.time.toFixed(3)} s); visible Next only; frozen movement review`,context:analysisContext(playback.rules,playback.settings,snapshot),future:false,finiteQueue:true};
}

export type SpinReplaySample = {scene:SpinScene;kind:'missed'|'kick';actual:string;frame:number};
export function spinReplaySamples(playback:Playback,track:ReplayTrack,start=0,limit=32):SpinReplaySample[] {
  const samples:SpinReplaySample[]=[],frames=playback.frames;
  let before:PlaybackFrame|null=null;
  for(const frame of frames){
    if(frame.time<start)continue;
    if(before&&frame.analysis.stats.pieces>before.analysis.stats.pieces){
      const actual=frame.actionEffects.at(-1)?.spin??'';
      if(!actual&&before.piece&&!before.analysis.unavailable&&!before.analysis.pendingGarbage){try{samples.push({scene:spinReplayScene(playback,before),kind:'missed',actual:'No scored spin',frame:Math.round(before.time*60)});}catch{}}
      before=null;if(samples.length>=limit)break;
    }
    if(!before&&frame.piece&&!frame.analysis.unavailable)before=frame;
  }
  const inputs=(track.kind==='native'?track.data.events:track.data.events??[]).filter((event:any)=>event.type==='keydown'&&['rotateCW','rotateCCW','rotate180'].includes(event.data?.key)&&event.frame/60>=start);
  for(const input of inputs){
    if(samples.length>=limit+16)break;
    if(input.data.key==='rotate180'&&!playback.rules.allow180)continue;
    const index=frames.findIndex(frame=>frame.time>input.frame/60),after=frames[index],before=frames[index-1];
    if(!after||!before?.piece||!after.piece||before.piece.symbol!==after.piece.symbol||before.piece.totalRotations!==after.piece.totalRotations||before.analysis.stats.pieces!==after.analysis.stats.pieces)continue;
    if(inputs.filter((event:any)=>event.frame===input.frame).length!==1)continue;
    try{
      const scene=spinReplayScene(playback,before),engine=createEngine(playback.settings,1,playback.rules),piece=copyPiece(engine,before.piece);
      if(piece.rotate(before.board,engine.kickTableName,input.data.key==='rotateCW'?1:input.data.key==='rotateCCW'?3:2,false))continue;
      samples.push({scene,kind:'kick',actual:`Failed ${input.data.key==='rotateCW'?'CW':input.data.key==='rotateCCW'?'CCW':'180'} rotation`,frame:input.frame});
    }catch{}
  }
  return samples;
}

export class SpinReplayPanel {
  private session=new SpinSession();
  private generation=0;
  private playback:Playback|null=null;
  constructor(private callbacks:{state:()=>{playback:Playback|null;track:ReplayTrack|undefined;position:number};open:(scene:SpinScene)=>void;save:(scene:SpinScene)=>void}) {
    const section=document.createElement('section');section.id='player-spin';section.innerHTML='<h3>Spin review</h3><button id="player-spin-frame" class="secondary wide">Analyze this frame for spins</button><button id="player-spin-scan" class="secondary wide">Find missed spins and failed kicks</button><button id="player-spin-cancel" class="secondary small" hidden>Cancel review</button><p id="player-spin-status" role="status" class="muted"></p><div id="player-spin-lessons"></div>';
    document.getElementById('player-info')!.parentElement!.before(section);
    document.getElementById('player-spin-frame')!.addEventListener('click',()=>{const state=this.callbacks.state();if(!state.playback)return;try{let index=0;while(index+1<state.playback.frames.length&&state.playback.frames[index+1].time<=state.position)index++;const frame=state.playback.frames[index];this.callbacks.open(spinReplayScene(state.playback,frame));}catch(error){this.status((error as Error).message);}});
    document.getElementById('player-spin-scan')!.addEventListener('click',()=>this.scan());document.getElementById('player-spin-cancel')!.addEventListener('click',()=>{this.cancel();this.status('Review canceled. Existing lessons are verified; the scan is partial.');});
  }
  private status(text:string){document.getElementById('player-spin-status')!.textContent=text;}
  cancel(){this.session.cancel();this.generation++;document.getElementById('player-spin-cancel')!.hidden=true;}
  update(playback:Playback|null,visible:boolean){if(this.playback!==playback){this.cancel();this.playback=playback;document.getElementById('player-spin-lessons')!.replaceChildren();this.status('Review uses visible Next and frozen movement. Results are training alternatives, not real-time execution proofs.');}if(!visible)this.cancel();}
  private scan(){
    const state=this.callbacks.state();if(!state.playback||!state.track)return;this.cancel();const generation=this.generation,samples=spinReplaySamples(state.playback,state.track,state.position),groups=new Map<string,{count:number;button:HTMLButtonElement;scene:SpinScene}>();
    document.getElementById('player-spin-lessons')!.replaceChildren();document.getElementById('player-spin-cancel')!.hidden=false;let index=0,unknown=0;
    const next=()=>{
      if(generation!==this.generation)return;
      if(index>=samples.length){document.getElementById('player-spin-cancel')!.hidden=true;this.status(`Review complete for ${samples.length} sampled positions from the selected time · ${groups.size} verified lesson groups · ${unknown} unresolved. At most 32 missed-spin positions and 16 failed-rotation positions per scan.`);return;}
      const sample=samples[index++],request=spinRequest(sample.scene.context,{sessionId:sample.scene.id,revision:index,milliseconds:750,nodes:40000});this.status(`Reviewing ${index} / ${samples.length} · ${groups.size} verified groups`);
      this.session.run(request,(result,done)=>{
        if(!done||generation!==this.generation)return;
        const route=result.routes.find(route=>route.terminalLines>0&&(sample.kind!=='kick'||route.evidence.usedKick));
        if(route){
          const label=spinLabel(route.steps.at(-1)!.piece,route.evidence.spin,route.terminalLines),scene:SpinScene={...sample.scene,name:`${sample.kind==='kick'?'Failed kick':'Missed spin'} · ${label}`,source:`${sample.scene.source}. ${sample.actual}; an engine-verified ${label} alternative exists.`,cluster:spinCluster(sample.scene)},key=`${sample.kind}|${scene.cluster}`,existing=groups.get(key);
          if(existing){existing.count++;existing.button.textContent=`${existing.scene.name} · ${existing.count} occurrences`;}
          else{const button=document.createElement('button');button.className='secondary wide';button.textContent=`${scene.name} · 1 occurrence`;button.addEventListener('click',()=>this.callbacks.open(scene));groups.set(key,{count:1,button,scene});document.getElementById('player-spin-lessons')!.append(button);this.callbacks.save(scene);}
        }else if(!result.complete)unknown++;
        next();
      },()=>{unknown++;next();});
    };next();
  }
}
