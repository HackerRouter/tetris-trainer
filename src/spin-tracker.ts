import type { Engine } from '@haelp/teto/engine';
import { copyPiece } from './finesse';
import { spinEvidence, type SpinEvidence, type SpinRotation } from './spin-movement';
import { sameCells } from './practice';

export type SpinTrace = { rotation:SpinRotation|null; pose:string; half:boolean; soft:boolean; kicked:boolean; hold:boolean; geometric:boolean };
export class SpinTracker {
  private trace:SpinTrace={rotation:null,pose:'',half:false,soft:false,kicked:false,hold:false,geometric:false};
  constructor(private engine:Engine, private onRotate?: (spin: string) => void) {
    const restore=engine.fromSnapshot.bind(engine);
    engine.fromSnapshot=(snapshot)=>{const result=restore(snapshot);this.attach();return result;};
    const tick=engine.tick.bind(engine);
    engine.tick=(frames)=>{if(engine.input.keys.softDrop||frames.some(frame=>frame.type==='keydown'&&frame.data.key==='softDrop'))this.trace.soft=true;return tick(frames);};
    const softDrop=engine.softDrop.bind(engine);
    engine.softDrop=()=>{const result=softDrop();if(result)this.trace.soft=true;return result;};
    engine.events.on('falling.new',({isHold})=>{this.restore(null);this.trace.hold=isHold;this.attach(true);});
    this.attach();
  }
  private attach(initial = false){
    const piece=this.engine.falling,prototype=Object.getPrototypeOf(piece),x=Object.getOwnPropertyDescriptor(prototype,'x')!;
    if (initial && piece.totalRotations) this.onRotate?.(this.engine.lastSpin ?? 'none');
    let before=piece.snapshot(),rotations=piece.totalRotations;
    Object.defineProperty(piece,'x',{configurable:true,get:()=>x.get!.call(piece),set:value=>{before=piece.snapshot();if(value!==piece.x){this.trace.rotation=null;this.trace.pose='';}x.set!.call(piece,value);}});
    Object.defineProperty(piece,'totalRotations',{configurable:true,enumerable:true,get:()=>rotations,set:value=>{
      if(value>rotations){
        this.onRotate?.(this.engine.lastSpin ?? 'none');
        const delta=((piece.rotation-before.rotation+4)%4) as 0|1|2|3,probe=copyPiece(this.engine,before),cells=probe.absoluteBlocks,kick=probe.rotate(this.engine.board.state,this.engine.kickTableName,delta,false);
        const rotation:SpinRotation={from:before.rotation,to:piece.rotation,direction:delta===2?'180':delta===1?'CW':'CCW',kick:typeof kick==='object'?[...kick.kick]:[0,0],index:typeof kick==='object'?kick.index:null,changed:!sameCells(cells,piece.absoluteBlocks)};
        this.trace.rotation=rotation;this.trace.pose=this.pose();this.trace.half||=delta===2;this.trace.kicked||=rotation.changed&&rotation.kick.some(Boolean);this.trace.geometric=spinEvidence(this.engine,rotation,this.trace.soft,this.trace.half,this.trace.kicked).geometric;
      }
      rotations=value;
    }});
  }
  private pose(){const piece=this.engine.falling;return `${piece.symbol}|${piece.x}|${Math.floor(piece.y)}|${piece.rotation}`;}
  snapshot(){return structuredClone(this.trace);}
  restore(trace:SpinTrace|null){this.trace=trace?structuredClone(trace):{rotation:null,pose:'',half:false,soft:false,kicked:false,hold:false,geometric:false};}
  evidence():SpinEvidence & {hold:boolean}{const same=this.trace.pose===this.pose();return {rotation:same?this.trace.rotation:null,geometric:same&&this.trace.geometric,used180:this.trace.half,softDrop:this.trace.soft,usedKick:this.trace.kicked,spin:this.engine.lastSpin??'none',hold:this.trace.hold};}
}
