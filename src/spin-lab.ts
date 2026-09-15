import type { EngineSnapshot } from '@haelp/teto/engine';
import type { TrainerGame } from './game';
import { analysisContext, withGeneratedPacks, type AnalysisContext } from './analysis-context';
import { stableKey } from './analysis';
import { boardMask } from './continuation-search';
import { frozenContext, currentSceneContext, changeSceneQueue, sceneFromFumen, type PcScene } from './pc-scenes';
import { SpinSession } from './spin-session';
import { defaultSpinFilters, matchesSpin, spinRequest, spinCapabilities, type SpinFilters, type SpinRequest, type SpinResult, type SpinRoute } from './spin-search';
import { spinDrills, spinDrill, readSpinLibrary, spinStorageKey, spinCluster, type SpinScene, type SpinLibrary, type SpinRecord } from './spin-scenes';
import { drawBoard } from './renderer';
import { placementSteps } from './guide';
import { sameCells } from './practice';
import { randomSpinDrill } from './spin-generator';
import { spinLabel } from './spin-label';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
type Callbacks = { game: () => TrainerGame; start: (context: AnalysisContext) => TrainerGame; clearOpening: () => void };
type Preferences = { depth: number; seconds: number; filters: SpinFilters; policy: 'guided' | 'any' | 'advisory'; learning: 'none' | 'step' | 'full' };
type SavedRoute = { route: SpinRoute; training: boolean; used: number; scope: string };
type DrillSession = { ids:string[]; bag:string[]; rounds:number; completed:number; source:AnalysisContext };

export class SpinLab {
  private session = new SpinSession();
  private autoDue = 0;
  private automaticToken = 0;
  private drillSession: DrillSession | null = null;
  private drillHintPending = false;
  private drillResult: SpinResult | null = null;
  private visible = false;
  private game: TrainerGame | null = null;
  private scene: SpinScene | null = null;
  private analyzed: SpinScene | null = null;
  private resultScene: SpinScene | null = null;
  private result: SpinResult | null = null;
  private request: SpinRequest | null = null;
  private selected: SpinRoute | null = null;
  private routeHistory: SavedRoute[] = [];
  private step = 0;
  private preview = 0;
  private shown = 6;
  private revision = 0;
  private observedRevision = 0;
  private count = 0;
  private pose = '';
  private rules = '';
  private training = false;
  private used = 0;
  private record: SpinRecord | null = null;
  private baseline = 0;
  private library: SpinLibrary = { version:1,scenes:[],records:[] };
  private preferences: Preferences = { depth:1,seconds:5,filters:{...defaultSpinFilters},policy:'guided',learning:'step' };
  constructor(private callbacks: Callbacks) {
    const section = document.createElement('section'); section.id = 'spin-lab'; section.hidden = true;
    section.innerHTML = `<span class="eyebrow">ANALYSIS & TRAINING</span><h3>Spin Lab</h3><p class="muted">Find rotations into the current board with this piece or legal Hold. Practice under this mode's kick and spin rules.</p><p id="spin-live-status" role="status" class="muted">Automatic analysis runs after every placement.</p><button id="spin-choose-drills" class="wide">Choose Spin drills</button><p id="spin-drill-progress" role="status"></p><div id="spin-drill-actions" class="page-toolbar" hidden><button id="spin-drill-new" class="secondary small">New board</button><button id="spin-drill-end" class="secondary small">End drills</button></div><button id="spin-cancel" class="secondary small" hidden>Cancel search</button><p id="spin-status" role="status"></p><p id="spin-outcome" role="status"></p><p id="spin-scope" class="muted"></p><details id="spin-options"><summary>Goal, filters and search scope</summary><label class="select-row">Search horizon<select id="spin-depth"><option value="1">Current piece / legal Hold</option><option value="2">Up to 2 placements</option><option value="3">Up to 3 placements</option></select></label><label class="select-row">Piece<select id="spin-piece"><option value="any">Any available piece</option>${['i','j','l','s','t','z'].map(piece=>`<option value="${piece}">${piece.toUpperCase()}</option>`).join('')}</select></label><label class="select-row">Spin category<select id="spin-kind"><option value="scored">Any recognized spin</option><option value="normal">Full spin</option><option value="mini">Mini spin</option><option value="geometric">Geometric insertion</option><option value="rotation">Rotation technique</option></select></label><label class="select-row">Lines cleared by the spin<select id="spin-lines"><option value="-1">Any</option><option value="0">Zero · no clear</option><option value="1">Single · 1 line</option><option value="2">Double · 2 lines</option><option value="3">Triple · 3 lines</option><option value="4">Quad · 4 lines</option></select></label><label class="select-row">Final piece source<select id="spin-hold"><option value="either">Current or legal Hold</option><option value="current">Current piece</option><option value="hold">Hold</option></select></label><label class="select-row">Final rotation kick<select id="spin-kick"><option value="either">Any</option><option value="yes">With a kick</option><option value="no">Without a kick</option></select></label><label class="select-row">Rotation path<select id="spin-rotation"><option value="either">Any allowed rotation</option><option value="180">Includes 180</option><option value="90">No 180</option></select></label><label class="select-row">Soft drop<select id="spin-softDrop"><option value="either">Either</option><option value="yes">Includes soft drop</option><option value="no">No soft drop</option></select></label><label class="select-row">Search time<select id="spin-seconds"><option value="5">5 seconds</option><option value="15">15 seconds</option></select></label><p class="muted">Double means one piece clears two lines. Available classes depend on the piece and mode. Geometric insertion means a final rotation under an overhang or with a kick; it does not imply a scoring bonus. Setup search uses visible Next only. Movement is verified with frozen gravity and lock timing.</p></details><label class="select-row">Practice policy<select id="spin-policy"><option value="guided">Guided route</option><option value="any">Any valid solution</option><option value="advisory">Advisory</option></select></label><label class="select-row">Learning level<select id="spin-learning"><option value="none">No hints</option><option value="step">Step hints</option><option value="full">Full answer</option></select></label><button id="spin-practice" class="wide" disabled>Practice this board</button><button id="spin-hint" class="secondary small">Show next hint</button><div id="spin-routes" class="opener-catalog"></div><button id="spin-more" class="secondary small" hidden>Show more candidates</button><p id="spin-candidates-note" class="muted"></p><details id="spin-drills"><summary>Reference examples</summary><label class="select-row">Drill<select id="spin-drill">${spinDrills.map(drill=>`<option value="${drill.id}">${drill.name}</option>`).join('')}</select></label><label class="check-row"><input id="spin-mirror" type="checkbox">Mirror the drill</label><button id="spin-load-drill" class="secondary small">Load verified drill</button><p class="muted">Drills retain the active mode's rotation, kicks, 180 and spin rules. A drill is offered only when its witness passes those rules.</p></details><details id="spin-scenes"><summary>Scenes and repeated practice</summary><label class="select-row">Scene name<input id="spin-name" maxlength="100" value="Spin practice"></label><div class="page-toolbar"><button id="spin-save" class="secondary small">Save board</button><button id="spin-repeat" class="secondary small">Repeat board</button><button id="spin-seed" class="secondary small">New seed, keep board</button></div><label class="select-row">Current + Next<input id="spin-queue" placeholder="TIJLOSZ" maxlength="32"></label><button id="spin-apply-queue" class="secondary small">Use this queue</button><label class="select-row">Saved scenes<select id="spin-saved"></select></label><button id="spin-open" class="secondary small">Open saved scene</button><button id="spin-delete" class="secondary small">Delete selected scene</button></details><details id="spin-fumen-options"><summary>Import Fumen</summary><label>Fumen<textarea id="spin-fumen" rows="3" maxlength="50000"></textarea></label><label class="select-row">Page<input id="spin-fumen-page" type="number" value="1" min="1" max="64"></label><label class="select-row">Current + Next<input id="spin-fumen-queue" value="T" maxlength="32"></label><label class="select-row">Hold<input id="spin-fumen-hold" value="-" maxlength="1"></label><button id="spin-fumen-load" class="secondary small">Load Fumen board</button></details>`;
    document.querySelector('.workspace-left')!.prepend(section);
    const guide = document.createElement('section'); guide.id = 'spin-guide'; guide.hidden = true;
    guide.innerHTML = `<h3 id="spin-guide-title"></h3><p id="spin-step" class="muted"></p><canvas id="spin-preview" aria-label="Spin placement preview"></canvas><p id="spin-kick-detail" class="muted"></p><div class="page-toolbar"><button id="spin-prev" class="secondary small">Previous step</button><button id="spin-next" class="secondary small">Next step</button><button id="spin-animate" class="secondary small">Animate</button><button id="spin-static" class="secondary small">Static view</button></div><ol id="spin-inputs"></ol><details id="spin-full"><summary>Full route</summary><ol id="spin-plan"></ol></details>`;
    el('guidance-slot').append(guide);
    try { this.library = readSpinLibrary(localStorage); } catch (error) { this.status((error as Error).message); }
    try { const saved = JSON.parse(localStorage.getItem('tetrio-trainer-spin-preferences-v1') ?? 'null'); if (saved && [1,2,3].includes(saved.depth) && [5,15].includes(saved.seconds) && ['guided','any','advisory'].includes(saved.policy) && ['none','step','full'].includes(saved.learning)) this.preferences = {...saved,filters:{...defaultSpinFilters,...saved.filters}}; } catch {}
    if(this.preferences.filters.piece==='o'){this.preferences.filters.piece='any';this.savePreferences();}
    this.syncControls(); this.renderSaved();
    const on = (id:string, action:()=>void) => el(id).addEventListener('click',()=>{ try { action(); } catch(error) { this.status((error as Error).message); } el(id).blur(); });
    on('spin-choose-drills',()=>{location.hash='spin-drills';});
    on('spin-drill-new',()=>this.nextDrill()); on('spin-drill-end',()=>{this.drillSession=null;this.training=false;this.finishRecord();this.invalidate();el('spin-drill-actions').hidden=true;el('spin-drill-progress').textContent='Drill session ended.';});
on('spin-cancel',()=>{this.session.cancel();this.request=null;if(this.game)this.game.analysisPending=false;el('spin-cancel').hidden=true;this.status('Search canceled. Retained candidates are partial.');});
    on('spin-practice',()=>this.practice()); on('spin-hint',()=>{this.preferences.learning='step';this.syncControls();this.savePreferences();this.applyHint();this.renderRoutes();});
    on('spin-more',()=>{this.shown+=6;this.renderRoutes();});
    on('spin-prev',()=>{this.preview--;this.drawGuide();}); on('spin-next',()=>{this.preview++;this.drawGuide();});
    on('spin-animate',()=>this.animate()); on('spin-static',()=>{if(this.game)this.game.demonstration=null;});
    on('spin-load-drill',()=>{const drill=spinDrill(this.current().context,el<HTMLSelectElement>('spin-drill').value,el<HTMLInputElement>('spin-mirror').checked);this.preferences.depth=1;this.preferences.filters=drill.scene.filters!;this.syncControls();this.savePreferences();this.load(drill.scene);this.analyze();});
    on('spin-repeat',()=>this.restart()); on('spin-save',()=>this.saveScene({...this.current(),name:el<HTMLInputElement>('spin-name').value||'Spin practice'}));
    on('spin-seed',()=>{this.load({...changeSceneQueue(this.current(),crypto.getRandomValues(new Uint32Array(1))[0]%2147483646+1),name:'Spin board · new seed',filters:this.preferences.filters});this.analyze();});
    on('spin-apply-queue',()=>{this.load({...changeSceneQueue(this.current(),el<HTMLInputElement>('spin-queue').value),name:'Spin board · supplied queue',filters:this.preferences.filters});this.analyze();});
    on('spin-open',()=>{const scene=this.library.scenes.find(scene=>scene.id===el<HTMLSelectElement>('spin-saved').value);if(scene){this.load(scene);this.analyze();}});
    on('spin-delete',()=>{this.library.scenes=this.library.scenes.filter(scene=>scene.id!==el<HTMLSelectElement>('spin-saved').value);this.persist();this.renderSaved();});
    on('spin-fumen-load',()=>{this.load({...sceneFromFumen(el<HTMLTextAreaElement>('spin-fumen').value,Number(el<HTMLInputElement>('spin-fumen-page').value),el<HTMLInputElement>('spin-fumen-queue').value,el<HTMLInputElement>('spin-fumen-hold').value,this.current().context),filters:this.preferences.filters});this.analyze();});
    for (const key of Object.keys(defaultSpinFilters)) el(`spin-${key}`).addEventListener('change',()=>{this.readControls();this.training=false;this.finishRecord();this.invalidate();this.analyze();el(`spin-${key}`).blur();});
    for (const id of ['spin-depth','spin-seconds','spin-policy','spin-learning']) el(id).addEventListener('change',()=>{this.readControls();if(id==='spin-learning'){this.applyHint();this.renderRoutes();}else{this.training=false;this.finishRecord();this.invalidate();this.analyze();}el(id).blur();});
  }
  get active() { return this.visible; }
  private status(text:string) { el('spin-status').textContent=text; }
  private savePreferences() { const {target,...filters}=this.preferences.filters;localStorage.setItem('tetrio-trainer-spin-preferences-v1',JSON.stringify({...this.preferences,filters})); }
  private syncControls() { for(const key of Object.keys(defaultSpinFilters) as (keyof SpinFilters)[]) el<HTMLSelectElement>(`spin-${key}`).value=String(this.preferences.filters[key]);for(const key of ['depth','seconds','policy','learning'] as const)el<HTMLSelectElement>(`spin-${key}`).value=String(this.preferences[key]); }
  private readControls() { for(const key of Object.keys(defaultSpinFilters) as (keyof SpinFilters)[])(this.preferences.filters as Record<string,unknown>)[key]=key==='lines'?Number(el<HTMLSelectElement>(`spin-${key}`).value):el<HTMLSelectElement>(`spin-${key}`).value;this.preferences.depth=Number(el<HTMLSelectElement>('spin-depth').value);this.preferences.seconds=Number(el<HTMLSelectElement>('spin-seconds').value);this.preferences.policy=el<HTMLSelectElement>('spin-policy').value as Preferences['policy'];this.preferences.learning=el<HTMLSelectElement>('spin-learning').value as Preferences['learning'];this.savePreferences(); }
  private current(): SpinScene {
    const game=this.callbacks.game(), snapshot=game.engine.snapshot({isUndoRedo:true});
    const context=this.scene&&this.game===game?currentSceneContext(this.scene,snapshot,game.rules,game.settings):withGeneratedPacks(analysisContext(game.rules,game.settings,snapshot));
    return {id:crypto.randomUUID(),name:'Current Spin board',source:this.scene?.source??'Current game',context,future:!this.scene?.finiteQueue,finiteQueue:this.scene?.finiteQueue,filters:{...this.preferences.filters}};
  }
  private rulesKey(game:TrainerGame) { const {finesse,...rules}=game.rules;return stableKey({rules,handling:game.settings.handling}); }
  private poseKey(game:TrainerGame) { return stableKey({board:boardMask(game.engine.board.state),falling:game.engine.falling.snapshot(),hold:game.engine.held,locked:game.engine.holdLocked,next:game.engine.queue.slice(0,game.rules.nextCount),spin:game.engine.lastSpin}); }
  private observe() { if(!this.game)return;this.count=this.game.placements.length;this.observedRevision=this.game.revision;this.pose=this.poseKey(this.game);this.rules=this.rulesKey(this.game); }
  setVisible(visible:boolean) {
    if(this.visible===visible)return;this.visible=visible;el('spin-lab').hidden=!visible;el('play-page').classList.toggle('spin-active',visible);
    if(visible){this.callbacks.clearOpening();this.game=this.callbacks.game();this.game.setJustThink(true,this.game.settings.training.thinkStyle);this.scene=this.current();this.observe();if(!this.drillSession)this.scanCurrent();}
    else{this.finishRecord();this.training=false;this.drillSession=null;this.invalidate();el('spin-drill-actions').hidden=true;}
  }
  clear() { this.drillSession=null;this.drillHintPending=false;delete this.preferences.filters.target;this.finishRecord();this.training=false;this.invalidate();this.scene=null;this.game=null;el('spin-outcome').textContent=''; }
  private invalidate(history=true) {
    this.autoDue=0;this.automaticToken++;this.session.cancel();this.request=null;this.revision++;this.result=null;this.selected=null;if(history)this.routeHistory=[];
    if(this.game){this.game.analysisPending=false;this.game.analysisPolicy=null;this.game.spinFinessePaths=null;this.game.hideAnalysisTarget=false;this.game.setContinuation(null);this.game.demonstration=null;this.game.fault=null;}
    el('spin-guide').hidden=true;el('spin-cancel').hidden=true;el<HTMLButtonElement>('spin-practice').disabled=true;this.renderRoutes();
  }
  load(scene:SpinScene,keepDrills=false) {
    if(!keepDrills){this.drillSession=null;el('spin-drill-actions').hidden=true;el('spin-drill-progress').textContent='';}
    const reasons=spinCapabilities(spinRequest(scene.context));if(reasons.length)throw new Error(`Unsupported · ${reasons.join(' ')}`);
    this.finishRecord();this.training=false;this.invalidate();this.callbacks.clearOpening();el('spin-outcome').textContent='';
    this.scene=structuredClone(scene);if(scene.filters){this.preferences.filters={...scene.filters};this.syncControls();}
    this.game=this.callbacks.start(frozenContext(scene.context,true));this.game.rules.name='SPIN LAB';this.game.setJustThink(true,scene.context.settings.training.thinkStyle);this.used=0;this.observe();
    this.status(`${scene.name}. Automatic analysis starts on this board.`);
  }
  importScene(scene:PcScene) { location.hash='spin';this.setVisible(true);this.load(scene);this.analyze(); }
  restart() { if(!this.visible||!this.scene)return false;if(this.drillSession&&this.drillResult?.routes.length){this.analyzed=this.scene;this.selected=this.drillResult.routes[0];this.practice();}else{this.load(this.scene,true);this.analyze();}return true; }
  private analyze(validation=false,retain=false) {
    const game=this.game??this.callbacks.game();this.game=game;
    const previous=this.selected,previousStep=this.step;this.session.cancel();this.request=null;this.result=null;this.shown=6;if(!retain){this.selected=null;game.setContinuation(null);game.demonstration=null;el('spin-guide').hidden=true;}this.renderRoutes();
    const scene=this.current();this.resultScene=scene;if(!retain)this.analyzed=scene;
    const request=spinRequest(scene.context,{sessionId:scene.id,revision:++this.revision,depth:Math.max(0,this.preferences.depth-(this.training?this.used:0)),milliseconds:validation?3000:this.preferences.seconds*1000,filters:this.preferences.filters});
    this.request=request;const pose=this.poseKey(game);this.pose=pose;el('spin-cancel').hidden=false;if(this.drillSession)game.analysisPending=true;
    el('spin-scope').textContent=`${request.base.rules.advanced.kickSet} · ${request.base.rules.advanced.spinBonuses} · ${request.base.rules.board.width} columns · Up to ${request.base.depth} placements · Visible Next: ${request.base.position.next.join(' ').toUpperCase()||'none'} · Frozen timing`;
    this.status(validation?'Validating this placement…':'Searching for engine-verified spin paths…');
    this.session.run(request,(result,done)=>{
      if(this.request!==request||this.game!==game||this.poseKey(game)!==pose)return;
      this.result=result;el('spin-cancel').hidden=done;
      this.status(`${done?result.status:'Searching'} · ${result.routes.length} verified opportunities · ${result.complete?'Complete within the frozen model':'Partial / bounded results'}. ${result.reasons.join(' ')}${this.preferences.filters.piece!=='any'&&!result.pieces.includes(this.preferences.filters.piece)?' The selected piece is not currently available.':''}`);
      this.renderRoutes();el<HTMLButtonElement>('spin-practice').disabled=this.training||!result.routes.length;el('spin-live-status').textContent=this.training&&this.preferences.learning==='none'?'Automatic analysis complete. Answers hidden.':`${this.drillSession?'Round start':done?'Current board':'Searching'}: ${result.status} - ${result.routes.length} verified opportunities.`;
      if(!done)return;this.request=null;game.analysisPending=false;
      if(this.drillSession){this.drillResult=result;this.applyDrillFinesse();}
      if(validation&&!result.routes.length&&result.complete&&previous){game.retryAnalysisPlacement();this.used=Math.max(0,this.used-1);this.selected=previous;this.step=this.preview=previousStep;this.applyHint();this.observe();this.status('This placement lost the verified goal. Only this piece and its timer were restored.');return;}
      if(result.routes.length&&(!retain||this.drillHintPending)){this.drillHintPending=false;this.selected=result.routes[0];this.analyzed=scene;this.step=this.preview=0;this.applyHint();this.renderRoutes();}
    },message=>{if(this.request===request){this.request=null;game.analysisPending=false;el('spin-cancel').hidden=true;this.status(message);}});
  }
  private practice() {
    if(!this.selected||!this.analyzed)return;const route=this.selected,scene=this.analyzed,result=this.result;
    this.load(scene,true);this.training=true;this.used=0;this.selected=route;this.result=result;this.step=this.preview=0;this.game!.analysisPolicy=this.preferences.policy;
    this.baseline=this.game!.targetMisses+this.game!.analysisMistakes+this.game!.faults;
    this.record={scene:structuredClone(scene),date:new Date().toISOString(),solved:false,retries:0,hints:this.preferences.learning!=='none',timeMs:0};
    this.applyHint();this.observe();this.status('Practice started. A matching spin completes the goal; retries restore only the current piece and timer.');this.renderRoutes();if(this.drillSession&&this.drillResult){this.result=this.drillResult;this.applyDrillFinesse();this.renderRoutes();}else this.scanCurrent();
  }
  private applyDrillFinesse() { if(this.game)this.game.spinFinessePaths=this.drillResult?.routes.map(route=>{const step=route.steps[0];return {piece:step.piece,target:step.scene.target,spin:step.spin,lines:step.lines,hold:!!step.scene.holdFirst,path:step.scene.path};})??null; }
  private applyHint() {
    const game=this.game,step=this.selected?.steps[this.step];if(!game||!step)return;
    const terminal=this.step===this.selected!.steps.length-1;
    const scene={...step.scene,spinGoal:{spin:step.spin,lines:step.lines,...(terminal?{geometric:this.preferences.filters.kind==='geometric',hold:this.preferences.filters.hold==='either'?undefined:this.preferences.filters.hold==='hold',kick:this.preferences.filters.kick==='either'?undefined:this.preferences.filters.kick==='yes',used180:this.preferences.filters.rotation==='either'?undefined:this.preferences.filters.rotation==='180',softDrop:this.preferences.filters.softDrop==='either'?undefined:this.preferences.filters.softDrop==='yes'}:{})}};
    if(this.drillSession)this.applyDrillFinesse();game.setContinuation(scene,this.training&&this.preferences.policy==='guided');game.analysisPolicy=this.training?this.preferences.policy:null;
    game.hideAnalysisTarget=this.preferences.learning==='none'||this.drillHintPending;this.preview=this.step;
    this.routeHistory=[{route:this.selected!,training:this.training,used:this.used-this.step,scope:el('spin-scope').textContent??''},...this.routeHistory.filter(item=>item.route!==this.selected)].slice(0,20);
    if(game.hideAnalysisTarget){game.hintTarget=null;game.demonstration=null;el('spin-guide').hidden=true;}else{if(this.record)this.record.hints=true;this.drawGuide();this.animate();}
  }
  private animate() { const step=this.selected?.steps[this.preview];if(!step||!this.game||this.preferences.learning==='none'||this.game.fault)return;this.game.demonstration={...step.scene,snapshot:step.scene.guideSnapshot??step.scene.snapshot,kind:'guide',serial:Date.now(),sceneNumber:this.preview+1}; }
  private drawGuide() {
    const route=this.selected,game=this.game;if(!route||!game||this.preferences.learning==='none'){el('spin-guide').hidden=true;return;}
    const step=route.steps[this.preview],snapshot=step.scene.guideSnapshot??step.scene.snapshot;
    el('spin-guide').hidden=false;el('spin-guide-title').textContent=route.evidence.spin==='none'?(route.evidence.geometric?'Geometric insertion':'Rotation technique'):spinLabel(route.steps.at(-1)!.piece,route.evidence.spin,route.terminalLines);
    el('spin-step').textContent=`Step ${this.preview+1} / ${route.steps.length} · ${step.scene.path.cost} inputs · ${spinLabel(step.piece,step.spin,step.lines)}${step.scene.holdFirst?' · Hold first':''}`;
    const rotation=route.evidence.rotation;el('spin-kick-detail').textContent=rotation?`Final rotation: ${rotation.from*90}° → ${rotation.to*90}° ${rotation.direction} · Kick (${rotation.kick.join(', ')})${rotation.index===null?' · Basic rotation':` · Kick test ${rotation.index+1}`} · ${route.evidence.softDrop?'Soft drop':'No soft drop'}${route.evidence.used180?' · Includes 180':''}`:'Spin history carried from the captured active piece.';
    const canvas=el<HTMLCanvasElement>('spin-preview');canvas.style.setProperty('--board-columns',String(game.engine.board.width));canvas.width=game.engine.board.width*20;canvas.height=(game.engine.board.height+3)*20;drawBoard(canvas,game.engine,snapshot.board,snapshot.falling,step.scene.target,game.settings.display);
    el('spin-inputs').replaceChildren(...placementSteps(step.scene.path,game.settings).map(input=>{const li=document.createElement('li');li.textContent=input.text;return li;}));
    el<HTMLButtonElement>('spin-prev').disabled=this.preview===0;el<HTMLButtonElement>('spin-next').disabled=this.preferences.learning!=='full'||this.preview===route.steps.length-1;
    el('spin-full').hidden=this.preferences.learning!=='full';el('spin-plan').replaceChildren(...route.steps.map(step=>{const li=document.createElement('li');li.textContent=`${step.scene.holdFirst?'Hold → ':''}${spinLabel(step.piece,step.spin,step.lines)} · ${placementSteps(step.scene.path,game.settings).map(input=>input.text).join(' → ')}`;return li;}));
  }
  private renderRoutes() {
    const routes=this.result?.routes??[],hidden=this.preferences.learning==='none';
    el('spin-routes').replaceChildren(...(hidden?[]:routes.slice(0,this.shown)).map(route=>{
      const button=document.createElement('button');button.className='opener-card secondary';button.setAttribute('aria-pressed',String(route.id===this.selected?.id));
      const title=document.createElement('strong'),summary=document.createElement('small'),canvas=document.createElement('canvas');canvas.width=200;canvas.height=120;canvas.setAttribute('aria-hidden','true');
      title.textContent=route.evidence.spin==='none'?`${route.steps.at(-1)!.piece.toUpperCase()} ${route.evidence.geometric?'geometric insertion':'rotation technique'}`:spinLabel(route.steps.at(-1)!.piece,route.evidence.spin,route.terminalLines);
      summary.textContent=`${route.steps.length} placement${route.steps.length===1?'':'s'} · ${route.steps.at(-1)!.scene.holdFirst?'Hold':'Current'} · ${route.evidence.rotation?.direction??'Captured rotation'} · Kick (${route.evidence.rotation?.kick.join(', ')??'unknown'}) · ${route.steps.reduce((sum,step)=>sum+step.scene.path.cost,0)} inputs`;
      const ctx=canvas.getContext('2d')!,step=route.steps[0],height=Math.max(6,...step.scene.target.map(([,y])=>y+1),step.scene.snapshot.board.reduce((top,row,y)=>row.some(Boolean)?y+1:top,0)),size=Math.min(200/step.scene.snapshot.board[0].length,120/height),offset=(200-step.scene.snapshot.board[0].length*size)/2;
      ctx.fillStyle='#090e18';ctx.fillRect(0,0,200,120);step.scene.snapshot.board.slice(0,height).forEach((row,y)=>row.forEach((tile,x)=>{if(tile){ctx.fillStyle='#78869b';ctx.fillRect(offset+x*size+1,120-(y+1)*size+1,size-2,size-2);}}));ctx.fillStyle='#a9dcd0';step.scene.target.forEach(([x,y])=>ctx.fillRect(offset+x*size+1,120-(y+1)*size+1,size-2,size-2));
      button.append(canvas,title,summary);button.addEventListener('click',()=>{this.selected=route;this.analyzed=this.resultScene;this.step=this.preview=0;this.applyHint();this.renderRoutes();button.blur();});return button;
    }));
    el('spin-more').hidden=hidden||routes.length<=this.shown;el('spin-candidates-note').textContent=routes.length?`${routes.length} endpoint / path-history classes. ${hidden?'Answers hidden.':'Different kicks and rotation paths can share the same cells.'}`:'';
  }
  private matches(snapshot:EngineSnapshot,route:SpinRoute,index:number) {
    const step=route.steps[index];if(!step)return false;
    return [step.scene.snapshot,step.scene.guideSnapshot].some((expected,held)=>expected&&String(boardMask(snapshot.board))===String(boardMask(expected.board))&&(step.unknownCurrent&&!held||snapshot.falling.symbol===expected.falling.symbol)&&(step.unknownCurrent&&held||snapshot.hold===expected.hold)&&snapshot.holdLocked===expected.holdLocked&&expected.queue.value.slice(0,Math.max(0,(Math.min(this.game!.rules.nextCount,this.analyzed?.context.snapshot.queue.value.length??0))-index-Number(held&&!step.scene.snapshot.hold))).every((piece,i)=>piece===snapshot.queue.value[i]));
  }
  update() {
    if(!this.visible)return;const game=this.callbacks.game();
    if(this.autoDue&&performance.now()>=this.autoDue)this.scanCurrent();
    if(game!==this.game){this.clear();this.game=game;this.game.setJustThink(true,this.game.settings.training.thinkStyle);this.scene=this.current();this.observe();this.scanCurrent();return;}
    if(this.rules!==this.rulesKey(game)){this.finishRecord();this.training=false;this.invalidate();this.observe();this.scanCurrent();return;}
    if(this.observedRevision!==game.revision){
      const snapshot=game.engine.snapshot({isUndoRedo:true});let restored=false;
      for(const saved of this.routeHistory){const index=saved.route.steps.findIndex((step,i)=>this.matches(snapshot,saved.route,i)&&snapshot.stats.pieces===step.scene.snapshot.stats.pieces);if(index<0)continue;this.invalidate(false);this.selected=saved.route;this.training=saved.training;this.used=saved.used+index;this.step=this.preview=index;el('spin-scope').textContent=saved.scope;this.applyHint();this.status(`Board restored. Route restored at step ${index+1}.`);restored=true;break;}
      if(!restored){const had=this.routeHistory.length>0;this.training=false;this.finishRecord();this.invalidate(false);if(had)this.analyze();else this.status('Board restored. Old guidance cleared.');}this.observe();return;
    }
    if(game.placements.length!==this.count){
      const recent=game.placements.slice(this.count);this.count=game.placements.length;
      for(const placement of recent){
        if(!placement.accepted){if(this.record)this.record.retries++;if(this.preferences.learning==='none')game.demonstration=null;continue;}
        this.session.cancel();this.request=null;el('spin-cancel').hidden=true;
        const expected=this.selected?.steps[this.step],follows=!!expected&&placement.piece===expected.piece&&placement.result.spin===expected.spin&&placement.result.lines===expected.lines&&sameCells(placement.cells,expected.scene.target)&&String(boardMask(game.engine.board.state))===String(boardMask(expected.after.board));
        this.used++;
        const valid=matchesSpin(this.preferences.filters,placement.spinEvidence,placement.piece,placement.result.lines,placement.spinEvidence.hold,placement.cells);
        if(valid&&(!this.training||this.preferences.policy!=='guided'||follows&&this.step===this.selected!.steps.length-1)){
          if(this.record)this.record.solved=true;this.finishRecord();this.training=false;this.invalidate(false);el('spin-outcome').textContent=`Goal complete · ${spinLabel(placement.piece,placement.result.spin,placement.result.lines)}. Repeat or continue from this board.`;
          if(this.drillSession){this.drillSession.completed++;this.nextDrill();return;}delete this.preferences.filters.target;break;
        }
        if(follows&&this.selected&&++this.step<this.selected.steps.length){this.result=null;game.analysisPending=false;this.applyHint();this.renderRoutes();this.status(`Following the selected route · Step ${this.step+1}. Analyzing the new board.`);}
        else if(this.training&&this.used>=this.preferences.depth&&this.preferences.policy!=='advisory'){game.retryAnalysisPlacement();this.used--;this.applyHint();this.status('The spin goal was missed. Only this piece and its timer were restored.');}
        else this.analyze(this.training&&this.preferences.policy==='any');
      }
      this.observe();if(!this.request&&!this.drillSession)this.scanCurrent();return;
    }
    if(this.drillSession){this.pose=this.poseKey(game);return;}
    const pose=this.poseKey(game);if(pose!==this.pose){const following=!!this.selected&&this.matches(game.engine.snapshot({isUndoRedo:true}),this.selected,this.step);if(this.request){this.session.cancel();this.request=null;game.analysisPending=false;el('spin-cancel').hidden=true;this.status('Active piece changed. Updating automatic analysis.');}this.result=null;this.renderRoutes();if(!following){this.selected=null;game.setContinuation(null);game.demonstration=null;el('spin-guide').hidden=true;el<HTMLButtonElement>('spin-practice').disabled=true;}this.pose=pose;this.autoDue=performance.now()+150;}
  }
  private scanCurrent() {
    this.autoDue=0;this.automaticToken++;if(!this.game||!this.visible)return;
    const retain=!!this.selected&&this.matches(this.game.engine.snapshot({isUndoRedo:true}),this.selected,this.step);
    this.analyze(false,retain);
  }
  startDrills(ids:string[],rounds:number) {
    if(!ids.length||ids.some(id=>!spinDrills.some(drill=>drill.id===id)))throw new Error('Select valid Spin drills.');
    const source=this.current().context;for(const id of ids)spinDrill(source,id);
    this.drillSession={ids:[...ids],bag:[],rounds,completed:0,source};this.setVisible(true);this.nextDrill();
  }
  private nextDrill() {
    const session=this.drillSession;if(!session)return;
    if(session.rounds&&session.completed>=session.rounds){this.drillSession=null;el('spin-drill-actions').hidden=true;el('spin-drill-progress').textContent=`Session complete · ${session.completed} boards solved.`;return;}
    if(!session.bag.length){session.bag=[...session.ids];for(let i=session.bag.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[session.bag[i],session.bag[j]]=[session.bag[j],session.bag[i]];}}
    if(this.game){session.source.rules.finesse=this.game.rules.finesse;session.source.settings.training.thinkStyle=this.game.settings.training.thinkStyle;}
    const id=session.bag.pop()!,generated=randomSpinDrill(session.source,id,crypto.getRandomValues(new Uint32Array(1))[0]);
    this.drillResult=null;
    this.preferences.depth=1;this.preferences.filters=generated.scene.filters!;this.preferences.policy='any';this.drillHintPending=true;this.syncControls();
    this.load(generated.scene,true);this.analyzed=generated.scene;this.selected=generated.witness;this.result=null;this.practice();
    el('spin-drill-actions').hidden=false;el('spin-drill-progress').textContent=`${session.completed} / ${session.rounds||'Endless'} boards solved · ${spinDrills.find(drill=>drill.id===id)!.name}`;
    this.status('Randomized drill ready. Solve the selected spin to advance to the next verified board.');
  }
  private finishRecord() { if(!this.record||!this.game)return;this.record.retries=Math.max(this.record.retries,this.game.targetMisses+this.game.analysisMistakes+this.game.faults-this.baseline);this.record.timeMs=this.game.elapsedMs;this.library.records=[this.record,...this.library.records].slice(0,200);this.record=null;this.persist(); }
  saveScene(scene:SpinScene) { const cluster=scene.cluster??spinCluster(scene);this.library.scenes=[scene,...this.library.scenes.filter(item=>item.id!==scene.id&&(!scene.cluster||item.cluster!==cluster))].slice(0,100);this.persist();this.renderSaved();this.status('Spin board saved. Its queue and rules are retained.'); }
  private persist() { try{localStorage.setItem(spinStorageKey,JSON.stringify(this.library));}catch{this.status('Spin storage is full. Remove saved scenes to make room.');} }
  private renderSaved() { el<HTMLSelectElement>('spin-saved').replaceChildren(...this.library.scenes.map(scene=>new Option(scene.name,scene.id))); }
  renderStatistics(container:HTMLElement) { const records=this.library.records;container.replaceChildren();const heading=document.createElement('h3');heading.textContent='Spin practice';const summary=document.createElement('p');summary.textContent=`${records.filter(record=>record.solved).length} completed boards · ${records.filter(record=>record.solved&&!record.hints).length} without hints · ${records.reduce((sum,record)=>sum+record.retries,0)} retries`;container.append(heading,summary);for(const record of records.slice(0,10)){const button=document.createElement('button');button.className='secondary small';button.textContent=`Practice again: ${record.scene.name}`;button.addEventListener('click',()=>this.importScene(record.scene));container.append(button);} }
}
