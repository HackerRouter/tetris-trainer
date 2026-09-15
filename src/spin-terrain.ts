import type { EngineSnapshot, Mino } from '@haelp/teto/engine';
import { copyPiece, type Move } from './finesse';
import { createEngine } from './engine';
import type { AnalysisContext } from './analysis-context';

type Board=EngineSnapshot['board'];
function groundedCells(board:Board) {
  const width=board[0].length,seen=new Set<number>(),pending:number[]=[];
  board[0].forEach((tile,x)=>{if(tile){seen.add(x);pending.push(x);}});
  for(let i=0;i<pending.length;i++){
    const cell=pending[i],x=cell%width,y=Math.floor(cell/width);
    for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])if(nx>=0&&nx<width&&ny>=0&&ny<board.length&&board[ny][nx]&&!seen.has(ny*width+nx)){seen.add(ny*width+nx);pending.push(ny*width+nx);}
  }
  return seen;
}
export function supportedSpinTerrain(board:Board){const grounded=groundedCells(board);return !board.some(row=>row.every(Boolean))&&board.reduce((count,row)=>count+row.filter(Boolean).length,0)===grounded.size;}
export function spinTerrainHeight(board:Board){return board.reduce((top,row,y)=>row.some(Boolean)?y+1:top,0);}

export function supportSpinTerrain(context:AnalysisContext,moves:Move[]) {
  const engine=createEngine(context.settings,1,context.rules);engine.fromSnapshot(context.snapshot);engine.misc.movement.infinite=true;
  const board=context.snapshot.board,width=board[0].length,height=Math.min(context.rules.board.height-2,spinTerrainHeight(board)),protectedCells=new Set<number>();
  if(spinTerrainHeight(board)>height)return false;
  const protect=()=>engine.falling.absoluteBlocks.forEach(([x,y])=>{if(y>=0&&y<board.length)protectedCells.add(y*width+x);});
  protect();
  for(const move of moves){
    const before=engine.falling.snapshot();
    if(!engine.press(move as 'softDrop'|'moveLeft'|'rotateCW'))return false;
    if(move==='softDrop'){const piece=copyPiece(engine,before);for(let y=before.location[1];y>=engine.falling.y;y--)piece.absoluteAt({y}).forEach(([x,y])=>{if(y>=0&&y<board.length)protectedCells.add(y*width+x);});}
    protect();
  }
  for(let pass=0;pass<board.length*width;pass++){
    const grounded=groundedCells(board),floating=board.flatMap((row,y)=>row.flatMap((tile,x)=>tile&&!grounded.has(y*width+x)?[y*width+x]:[]));
    if(!floating.length)return supportedSpinTerrain(board);
    const distances=new Map<number,number>(floating.map(cell=>[cell,0])),parent=new Map<number,number>(),pending=[...floating];let endpoint=-1;
    while(pending.length){
      pending.sort((a,b)=>distances.get(b)!-distances.get(a)!);const cell=pending.pop()!,x=cell%width,y=Math.floor(cell/width);
      if(grounded.has(cell)||y===0){endpoint=cell;break;}
      for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
        const key=ny*width+nx;if(nx<0||nx>=width||ny<0||ny>=height||protectedCells.has(key))continue;
        const cost=distances.get(cell)!+Number(!board[ny][nx]);if(cost>=(distances.get(key)??Infinity))continue;
        distances.set(key,cost);parent.set(key,cell);pending.push(key);
      }
    }
    if(endpoint<0)return false;
    for(let cell=endpoint;;cell=parent.get(cell)!){board[Math.floor(cell/width)][cell%width]={mino:'gb' as Mino,connections:0};if(!parent.has(cell))break;}
    if(board.some(row=>row.every(Boolean)))return false;
  }
  return false;
}
