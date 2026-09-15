import type { TrainerGame } from './game';
import { analysisContext, withGeneratedPacks, type AnalysisContext } from './analysis-context';
import { AnalysisSession, analysisRequest, maxAnalysisDepth, maxComboAnalysisDepth, stableKey, type AnalysisResult, type AnalysisRequest } from './analysis';
import { boardMask, type ContinuationRoute } from './continuation-search';
import { routeCost, routeIdentity } from './pc-search';
import { frozenContext, currentSceneContext, sceneFromFumen, changeSceneQueue, readPcLibrary, savePcLibrary, parsePcLibrary, pcSceneCapabilities, type PcScene, type PcLibrary, type PcRecord } from './pc-scenes';
import { drawBoard } from './renderer';
import { placementSteps } from './guide';
import { downloadJson } from './settings';
import { CoveragePanel } from './coverage-panel';
import { pcoScene } from './pc-packs';
import { comboScene } from './combo-scenes';
import { practiceSummary, structureTag } from './pc-progress';
import { sameCells } from './practice';
import type { EngineSnapshot } from '@haelp/teto/engine';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
type Callbacks = { game: () => TrainerGame; start: (context: AnalysisContext) => TrainerGame; clearOpening: () => void };
type Preferences = { seconds: number; depth: number; information: 'visible' | 'pack' | 'seeded'; policy: 'advisory' | 'guided' | 'any'; learning: 'none' | 'step' | 'full' };
type RouteCheckpoint = { route: ContinuationRoute; queueLength: number; training: boolean; goal: number; clearBaseline: number; scope: string };
const preferenceKey = 'tetrio-trainer-pc-preferences-v1';

export class PcLab {
  private session = new AnalysisSession();
  private coverage: CoveragePanel;
  private recordStart = { attempts: 0, mistakes: 0, faults: 0, timeMs: 0 };
  private thinkingTick = performance.now();
  private exposedScenes = new Set<string>();
  private trainingGoal = 0;
  private clearBaseline = 0;
  private routeHistory: RouteCheckpoint[] = [];
  private selectionPinned = false;
  private scene: PcScene | null = null;
  private game: TrainerGame | null = null;
  private result: AnalysisResult | null = null;
  private selected: ContinuationRoute | null = null;
  private liveStep = 0;
  private routeQueueLength = 0;
  private pageKind: 'pc' | 'combo' | null = null;
  private comboObjective: 'combo' | 'attack' = 'combo';
  private preview = 0;
  private shown = 4;
  private revision = 0;
  private key = '';
  private pose = '';
  private request: AnalysisRequest | null = null;
  private busy = false;
  private training = false;
  private visible = false;
  private count = 0;
  
  private observedRevision = 0;
  private observedRules = '';
  private record: PcRecord | null = null;
  private library: PcLibrary = { version: 1, scenes: [], records: [] };
  private preferences: Preferences = { seconds: 15, depth: maxAnalysisDepth, information: 'pack', policy: 'guided', learning: 'step' };
  constructor(private callbacks: Callbacks) {
    const section = document.createElement('section'); section.id = 'pc-lab'; section.hidden = true;
    section.innerHTML = `<span class="eyebrow">ANALYSIS & TRAINING</span><h3 id="lab-title">Perfect Clear Lab</h3><label class="select-row">Training goal<select id="lab-objective"><option value="pc">Perfect Clear</option><option value="combo">Combo: consecutive clears</option><option value="attack">Combo: attack</option></select></label><p id="lab-description" class="muted">Find a perfect clear with the current piece, legal Hold and known Next. Practice with frozen gravity and locking.</p><button id="pc-analyze" class="wide">Analyze current board</button><button id="pc-cancel" class="secondary small" hidden>Cancel search</button><p id="pc-status" role="status"></p><p id="pc-scope" class="muted"></p><p id="combo-feedback" class="muted"></p><details id="pc-options"><summary>Goal and search scope</summary><label class="select-row">Queue access<select id="pc-information"><option value="pack" selected>Read the latest pack shown in Next</option><option value="seeded">Allow full queue planning</option><option value="visible">Visible Next only</option></select></label><label class="select-row">Search time limit<select id="pc-time"><option value="5">5 seconds</option><option value="15" selected>15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option></select></label><p class="muted">Verified answers appear as they are found. You can start practicing or cancel before the search ends. Placement validation pauses play for at most 3 seconds; an unfinished search never counts as a mistake.</p><p id="lab-goal-note" class="muted">Any-line perfect clear. Up to 20 placements. Shorter routes are searched first.</p><p id="lab-queue-note" class="muted">Pack scope reveals the complete order of the latest bag already shown in Next, plus older unplaced pieces and Hold. Full queue planning is optional; it permits all future pieces needed for up to 20 PC placements or 60 Combo placements. Replay frames and supplied queues have unknown pack boundaries and stop at their last supplied piece. A final known Hold may still finish the board. This is a known-queue search, not a probability estimate. Routes use frozen timing; real gravity and input timing are not verified.</p></details><div class="pc-learning"><label class="select-row">Practice policy<select id="pc-policy"><option value="advisory">Advisory</option><option value="guided" selected>Guided route</option><option value="any">Any valid solution</option></select></label><label class="select-row">Learning level<select id="pc-learning"><option value="none">No hints</option><option value="step" selected>Step hints</option><option value="full">Full answer</option></select></label></div><div id="pc-chain-options"><label class="select-row">Continuous PC practice<input id="pc-chain" type="checkbox"></label><p class="muted">After each PC, continue from the actual remaining Hold and queue.</p></div><button id="pc-practice" class="wide" disabled>Practice this board</button><button id="pc-hint" class="secondary small">Show next hint</button><div id="pc-routes" class="opener-catalog"></div><button id="pc-more" class="secondary small" hidden>Show more candidates</button><p id="pc-candidate-note" class="muted"></p><details id="pc-scenes"><summary>Scenes and repeated practice</summary><div id="combo-pack-options" hidden><label class="select-row">Combo terrain<select id="combo-geometry"><option value="native">Native four columns</option><option value="center">Ten columns: center 4-wide</option><option value="left">Ten columns: left 4-wide</option><option value="right">Ten columns: right 4-wide</option><option value="terrain">Ordinary ten-column terrain</option></select></label><label class="select-row">Bottom residue<select id="combo-residue"><option value="0">Three flat cells</option><option value="1">Three cells, left step</option><option value="2">Three cells, right step</option></select></label><button id="combo-load" class="secondary small">Load combo board</button></div><div id="pc-pack-options"><label class="select-row">PCO pack<select id="pc-pack"><option value="0">I held</option><option value="1">I held, mirrored</option><option value="2">I placed</option><option value="3">I placed, mirrored</option></select></label><button id="pc-pack-load" class="secondary small">Load PCO board</button></div><label class="select-row">Scene name<input id="pc-name" maxlength="100" value="PC practice"></label><div class="page-toolbar"><button id="pc-save" class="secondary small">Save board</button><button id="pc-repeat" class="secondary small">Repeat board</button><button id="pc-seed" class="secondary small">New seed, keep board</button><button id="pc-continue" class="secondary small">Keep board and continue</button></div><label class="select-row">Current + Next<input id="pc-queue" placeholder="IJLOSTZ" maxlength="40"></label><button id="pc-requeue" class="secondary small">Apply queue, keep board</button><label class="select-row">Saved scenes<select id="pc-saved"></select></label><button id="pc-load" class="secondary small">Load saved scene</button><div class="page-toolbar"><button id="pc-export" class="secondary small">Export PC library</button><button id="pc-import" class="secondary small">Import PC library</button><input id="pc-file" type="file" accept=".json" hidden></div></details><details id="pc-fumen-options"><summary>Import a Fumen board</summary><label for="pc-fumen">Fumen code or URL</label><textarea id="pc-fumen" rows="3" maxlength="50000"></textarea><label class="select-row">Page<input id="pc-page" type="number" min="1" max="64" value="1"></label><label class="select-row">Current + Next<input id="pc-fumen-queue" placeholder="IJLOSTZ" maxlength="40"></label><label class="select-row">Hold<select id="pc-fumen-hold">${['-','I','J','L','O','S','T','Z'].map(piece => `<option>${piece}</option>`).join('')}</select></label><button id="pc-fumen-load" class="secondary wide">Load Fumen board</button><p class="muted">Imports the selected page before its operation. Supply the queue and Hold explicitly; Fumen does not preserve full game rules or bag state.</p></details><p id="pc-source" class="muted"></p>`;
    document.querySelector('.workspace-left')!.prepend(section);
    const guide = document.createElement('section'); guide.id = 'pc-guide'; guide.hidden = true;
    guide.innerHTML = `<h4 id="pc-guide-title"></h4><p id="pc-step" class="muted"></p><div class="page-toolbar"><button id="pc-prev" class="secondary small">Previous step</button><button id="pc-next" class="secondary small">Next step</button><button id="pc-animate" class="secondary small">Animate step</button></div><canvas id="pc-preview" aria-label="PC route preview"></canvas><details id="pc-full"><summary>Full route</summary><ol id="pc-plan"></ol></details>`;
    el('guidance-slot').append(guide);
    this.coverage = new CoveragePanel(section, () => { this.captureCurrent(); const game = this.game!; return analysisRequest(currentSceneContext(this.scene!, game.engine.snapshot({ isUndoRedo: true }), game.rules, game.settings), { sessionId: this.scene!.id, revision: this.revision, information: this.information, kind: this.objective === 'pc' ? 'pc' : 'combo', depth: this.placementDepth, milliseconds: this.preferences.seconds * 1000 }); });
    try { this.library = readPcLibrary(localStorage); } catch (error) { this.status((error as Error).message); }
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null');
      if (saved && ['visible','pack','seeded'].includes(saved.information) && ['advisory','guided','any'].includes(saved.policy) && ['none','step','full'].includes(saved.learning)) this.preferences = { ...saved, depth: maxAnalysisDepth, seconds: [5,15,30,60].includes(saved.seconds) ? saved.seconds : 15 };
    } catch {}
    el<HTMLSelectElement>('pc-time').value = String(this.preferences.seconds); el<HTMLSelectElement>('pc-information').value = this.preferences.information; el<HTMLSelectElement>('pc-policy').value = this.preferences.policy; el<HTMLSelectElement>('pc-learning').value = this.preferences.learning;
    for (const id of ['pc-time','pc-information','pc-policy','pc-learning']) el(id).addEventListener('change', () => {
      this.preferences = { seconds: Number(el<HTMLSelectElement>('pc-time').value), depth: maxAnalysisDepth, information: this.objective === 'pc' ? el<HTMLSelectElement>('pc-information').value as Preferences['information'] : this.preferences.information, policy: el<HTMLSelectElement>('pc-policy').value as Preferences['policy'], learning: el<HTMLSelectElement>('pc-learning').value as Preferences['learning'] };
      this.syncQueueOption();
      localStorage.setItem(preferenceKey, JSON.stringify(this.preferences));
      if (id === 'pc-learning') { if (this.record && this.preferences.learning !== 'none') this.record.learning = this.preferences.learning; this.applyHint(); this.renderRoutes(); }
      else { this.training = false; this.invalidate(); this.status('Options changed. Analyze the current board again.'); }
      el(id).blur();
    });
    const on = (id: string, action: () => void) => el(id).addEventListener('click', () => { try { action(); } catch (error) { this.status((error as Error).message); } el(id).blur(); });
    el('lab-objective').addEventListener('change', () => this.selectObjective(el<HTMLSelectElement>('lab-objective').value));
    on('combo-load', () => { const game = this.callbacks.game(); this.load(comboScene(analysisContext(game.rules, game.settings, game.engine.snapshot({isUndoRedo:true})), el<HTMLSelectElement>('combo-geometry').value as Parameters<typeof comboScene>[1], Number(el<HTMLSelectElement>('combo-residue').value), crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1)); this.analyze(); });
    on('pc-pack-load', () => { const variant = Number(el<HTMLSelectElement>('pc-pack').value); const game = this.callbacks.game(); this.load(pcoScene(analysisContext(game.rules, game.settings, game.engine.snapshot({ isUndoRedo: true })), variant % 2 === 1, Math.floor(variant / 2), crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1)); this.analyze(); });
    on('pc-analyze', () => { this.captureCurrent(); this.analyze(); });
    on('pc-cancel', () => { this.invalidate(); this.status('Incomplete · Search canceled.'); });
    on('pc-practice', () => this.practice()); on('pc-repeat', () => { if (this.scene) { this.load(this.scene); this.analyze(); } });
    on('pc-hint', () => { if (this.selected) { this.preferences.learning = 'step'; localStorage.setItem(preferenceKey, JSON.stringify(this.preferences)); el<HTMLSelectElement>('pc-learning').value = 'step'; if (this.record) this.record.learning = 'step'; this.applyHint(); this.renderRoutes(); } else this.analyze(); });
    on('pc-more', () => { this.shown += 8; this.renderRoutes(); });
    on('pc-prev', () => { this.preview--; this.drawGuide(); }); on('pc-next', () => { this.preview++; this.drawGuide(); }); on('pc-animate', () => this.animate());
    on('pc-static', () => { if (this.game?.demonstration?.kind === 'guide') this.game.demonstration = null; });
    on('pc-save', () => { this.saveScene(this.currentScene(el<HTMLInputElement>('pc-name').value.trim() || 'PC practice')); this.status('Board saved to the PC library.'); });
    on('pc-seed', () => { if (!this.scene) this.captureCurrent(); this.load(changeSceneQueue(this.scene!, crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1)); this.analyze(); });
    on('pc-requeue', () => { if (!this.scene) this.captureCurrent(); this.load(changeSceneQueue(this.scene!, el<HTMLInputElement>('pc-queue').value)); this.analyze(); });
    on('pc-continue', () => { this.training = false; this.invalidate(); this.captureCurrent(); this.analyze(); });
    on('pc-load', () => { const scene = this.library.scenes.find(item => item.id === el<HTMLSelectElement>('pc-saved').value); if (scene) { this.load(scene); this.analyze(); } });
    on('pc-fumen-load', () => { const game = this.callbacks.game(); this.load(sceneFromFumen(el<HTMLTextAreaElement>('pc-fumen').value, Number(el<HTMLInputElement>('pc-page').value), el<HTMLInputElement>('pc-fumen-queue').value, el<HTMLSelectElement>('pc-fumen-hold').value, analysisContext(game.rules, game.settings, game.engine.snapshot({ isUndoRedo: true })))); this.analyze(); });
    on('pc-export', () => downloadJson(this.library, `pc-library-${Date.now()}.json`)); on('pc-import', () => el<HTMLInputElement>('pc-file').click());
    el('pc-file').addEventListener('change', async () => {
      const input = el<HTMLInputElement>('pc-file'), file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 10000000) throw new Error('PC libraries must be smaller than 10 MB.');
        const imported = parsePcLibrary(JSON.parse(await file.text()));
        const merged = parsePcLibrary({ version: 1, scenes: [...new Map([...this.library.scenes, ...imported.scenes].map(scene => [scene.id, scene])).values()], records: [...new Map([...this.library.records, ...imported.records].map(record => [record.id, record])).values()] });
        savePcLibrary(localStorage, merged); this.library = merged; this.renderSaved(); this.status('PC library imported without duplicate IDs.');
      } catch (error) { this.status((error as Error).message); } finally { input.value = ''; }
    });
    this.renderSaved();
  }
  get active() { return this.visible; }
  private get objective() { return el<HTMLSelectElement>('lab-objective').value as 'pc' | 'combo' | 'attack'; }
  private get placementDepth() { return this.objective === 'pc' ? maxAnalysisDepth : maxComboAnalysisDepth; }
  private get information() { return this.objective === 'pc' ? this.preferences.information : 'seeded' as const; }
  setPage(page: 'pc' | 'combo') {
    if (this.pageKind === page) return;
    this.selectObjective(page === 'pc' ? 'pc' : this.comboObjective);
    if (this.visible) this.captureCurrent();
  }
  selectObjective(value: string) {
    if (!['pc','combo','attack'].includes(value)) return;
    this.flushRecord(); this.training = false; this.invalidate();
    this.pageKind = value === 'pc' ? 'pc' : 'combo';
    if (value === 'combo' || value === 'attack') this.comboObjective = value;
    const select = el<HTMLSelectElement>('lab-objective');
    select.replaceChildren(...(value === 'pc' ? [new Option('Perfect Clear', 'pc')] : [new Option('Consecutive clears', 'combo'), new Option('Attack', 'attack')]));
    select.value = value; select.closest('label')!.hidden = value === 'pc';
    if (this.visible && location.hash !== `#${this.pageKind}`) location.hash = this.pageKind;
    if (this.game?.analysisScene) { this.game.rules.name = value === 'pc' ? 'PERFECT CLEAR LAB' : 'COMBO LAB'; this.observedRules = this.rulesKey(this.game); }
    el('lab-title').textContent = value === 'pc' ? 'Perfect Clear Lab' : 'Combo Lab';
    el('lab-description').textContent = value === 'pc' ? 'Find a perfect clear with the current piece, legal Hold and known Next. Practice with frozen gravity and locking.' : 'Extend consecutive clears with the known queue and legal Hold. Compare verified paths, then practice with frozen gravity and locking.';
    el('lab-goal-note').textContent = value === 'pc' ? 'Any-line perfect clear. Up to 20 placements. Shorter routes are searched first.' : 'Full queue planning. Up to 60 placements, including setup and the clearing run. Long opening plans may defer the first clear to build a longer combo; once the run starts, every placement must clear. Attack maximizes damage and may choose fewer clears. Results are best found within the search limit; spin-history alternatives are not exhaustive.';
    el('pc-information').closest('label')!.hidden = value !== 'pc';
    el('lab-queue-note').textContent = value === 'pc' ? 'Pack scope reveals the complete latest bag shown in Next, plus older unplaced pieces and Hold. Full queue planning is optional and permits up to 20 placements. Supplied and replay queues stop at their last known piece. A final known Hold may still finish the board. Routes use frozen timing; real gravity and input timing are not verified.' : 'Combo always reads the full sequence needed for up to 60 placements and legal Hold. Supplied and replay queues stop at their last known piece. Routes use frozen timing; real gravity and input timing are not verified.';
    el('pc-chain-options').hidden = value !== 'pc'; el('pc-pack-options').hidden = value !== 'pc'; el('combo-pack-options').hidden = value === 'pc'; this.coverage.setCombo(value !== 'pc');
    el('combo-feedback').textContent = ''; this.status('Goal changed. Analyze the current board again.'); el('lab-objective').blur();
  }
  private status(message: string) { el('pc-status').textContent = message; }
  private currentScene(name = 'Current board'): PcScene {
    const game = this.callbacks.game();
    const previous = this.game === game ? this.scene : null;
    const context = previous ? currentSceneContext(previous, game.engine.snapshot({ isUndoRedo: true }), game.rules, game.settings) : analysisContext(game.rules, game.settings, game.engine.snapshot({ isUndoRedo: true }));
    if (!previous && !game.analysisScene) withGeneratedPacks(context);
    return { id: crypto.randomUUID(), name, source: previous?.source ?? 'Current game', future: previous?.future ?? true, finiteQueue: previous?.finiteQueue, objective: this.objective, context };
  }
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible; el('pc-lab').hidden = !visible; el('play-page').classList.toggle('pc-active', visible);
    if (visible) { this.callbacks.clearOpening(); this.captureCurrent(); this.status(this.objective === 'pc' ? 'Analyze this board for a perfect clear of any line count.' : 'Analyze this board for combo continuations.'); }
    else { this.flushRecord(); this.training = false; this.invalidate(); }
  }
  load(scene: PcScene) {
    const reasons = pcSceneCapabilities(scene); if (reasons.length) throw new Error(`Unsupported · ${reasons.join(' ')}`);
    if (scene.objective && scene.objective !== this.objective) this.selectObjective(scene.objective);
    this.flushRecord(); this.training = false; this.invalidate(); this.callbacks.clearOpening();
    this.scene = { ...structuredClone(scene), objective: this.objective }; this.game = this.callbacks.start(frozenContext(scene.context, this.objective !== 'pc'));
    this.game.rules.name = this.objective === 'pc' ? 'PERFECT CLEAR LAB' : 'COMBO LAB';
    this.count = this.game.placements.length; this.observedRevision = this.game.revision;
    this.observedRules = this.rulesKey(this.game);
    this.key = this.stateKey(this.game); this.pose = this.poseKey(this.game);
    el('pc-source').textContent = scene.source; el<HTMLInputElement>('pc-name').value = scene.name;
    this.syncQueueOption();
  }
  importScene(scene: PcScene) { location.hash = scene.objective && scene.objective !== 'pc' ? 'combo' : 'pc'; this.setPage(location.hash === '#combo' ? 'combo' : 'pc'); this.setVisible(true); this.load(scene); this.analyze(); }
  private captureCurrent() {
    this.flushRecord(); this.training = false; this.invalidate(); this.scene = this.currentScene(); this.game = this.callbacks.game();
    this.scene.source = this.game.practice?.set.kind === 'opener' ? `Verified opener follow-up: ${this.game.practice.set.name}` : this.scene.source;
    this.game.pause();
    this.count = this.game.placements.length; this.observedRevision = this.game.revision;
    this.observedRules = this.rulesKey(this.game);
    this.key = this.stateKey(this.game); this.pose = this.poseKey(this.game); el('pc-source').textContent = this.scene.source;
    this.syncQueueOption();
  }
  private syncQueueOption() {
    if (this.objective !== 'pc') return;
    const select = el<HTMLSelectElement>('pc-information');
    select.querySelector<HTMLOptionElement>('option[value=pack]')!.disabled = !this.scene?.context.pack;
    select.querySelector<HTMLOptionElement>('option[value=seeded]')!.disabled = !this.scene?.future;
    if ((this.preferences.information === 'pack' && !this.scene?.context.pack) || (this.preferences.information === 'seeded' && !this.scene?.future)) this.preferences.information = 'visible';
    select.value = this.preferences.information;
  }

  restart() { if (!this.visible || !this.scene) return false; this.load(this.scene); this.status('Board restored. Analyze again to begin a fresh attempt.'); return true; }
  clear() { this.flushRecord(); this.training = false; this.invalidate(); this.scene = null; this.game = null; }
  suspend() { this.invalidate(); }
  private invalidate(clearHistory = true) {
    if (clearHistory) this.routeHistory = [];
    this.coverage.cancel(); this.session.cancel(); this.revision++; this.busy = false; this.request = null; this.result = null; this.selected = null;
    if (this.game) { this.game.analysisPending = false; this.game.analysisPolicy = null; this.game.hideAnalysisTarget = false; this.game.setContinuation(null); this.game.fault = null; this.game.demonstration = null; }
    el('pc-guide').hidden = true; el('pc-static').hidden = true; el('pc-cancel').hidden = true; el<HTMLButtonElement>('pc-practice').disabled = true; this.renderRoutes();
  }
  private rulesKey(game: TrainerGame) { return stableKey({ rules: game.rules, handling: game.settings.handling }); }
  private stateKey(game: TrainerGame) { return `${this.rulesKey(game)}|${game.revision}|${boardMask(game.engine.board.state)}|${game.engine.falling.symbol}|${game.engine.held}|${game.engine.holdLocked}|${game.engine.queue.slice(0, this.information === 'visible' ? game.rules.nextCount : this.placementDepth)}`; }
  private poseKey(game: TrainerGame) { return stableKey(game.engine.falling.snapshot()); }
  private analyze(validation = false) {
    this.coverage.cancel();
    const game = this.game ?? this.callbacks.game(); this.game = game;
    this.session.cancel(); this.revision++; this.selected = null; this.selectionPinned = false; this.result = null; this.shown = 4; this.renderRoutes();
    game.setContinuation(null); if (game.demonstration?.kind === 'guide') game.demonstration = null; el('pc-guide').hidden = true;
    const context = this.scene ? currentSceneContext(this.scene, game.engine.snapshot({ isUndoRedo: true }), game.rules, game.settings) : analysisContext(game.rules, game.settings, game.engine.snapshot({ isUndoRedo: true }));
    const request = analysisRequest(context, { sessionId: this.scene?.id ?? 'live', revision: this.revision, information: this.information, kind: this.objective === 'pc' ? 'pc' : 'combo', objective: this.objective === 'attack' ? 'attack' : 'clears', cleanup: this.training && game.engine.stats.combo >= 0 ? 0 : undefined, milliseconds: validation ? Math.min(3000, this.preferences.seconds * 1000) : this.preferences.seconds * 1000, depth: Math.max(0, this.placementDepth - (this.training && this.scene ? Math.max(0, game.engine.stats.pieces - this.scene.context.snapshot.stats.pieces) : 0)) });
    this.routeQueueLength = Number(request.position.currentKnown) + request.position.next.length;
    this.request = request; this.busy = true; this.key = this.stateKey(game); this.pose = this.poseKey(game); el('pc-cancel').hidden = false;
    this.status(validation ? 'Validating this placement…' : `Searching for verified ${this.objective === 'pc' ? 'PC' : 'Combo'} routes…`); this.scope(request);
    this.session.run(request, (result, done) => {
      if (this.game !== game || request !== this.request || this.key !== this.stateKey(game) || this.pose !== this.poseKey(game)) return;
      this.result = result; this.busy = !done; el('pc-cancel').hidden = done;
      this.status(`${done ? result.status : 'Searching'} · ${result.routes.length} verified candidates${result.complete ? ' · Search complete within scope.' : ' · Candidate set may be incomplete.'} ${result.reasons.join(' ')}`);
      this.scope(request, result); this.renderRoutes(); el<HTMLButtonElement>('pc-practice').disabled = !result.routes.length && this.preferences.policy === 'guided';
      if (!done) {
        if (!validation && (!this.selected || (this.objective !== 'pc' && !this.selectionPinned && !this.training)) && result.routes.length) { this.selected = result.routes[0]; this.liveStep = this.preview = 0; this.applyHint(); this.renderRoutes(); }
        return;
      }
      if (validation) {
        game.analysisPending = false;
        if (this.objective === 'pc' && result.status === 'No solution within scope') {
          this.saveFailure(game); game.retryAnalysisPlacement(); this.observedRevision = game.revision; this.key = this.stateKey(game); this.pose = this.poseKey(game);
          this.status('No PC within the selected scope. Only this placement and its timer were restored.'); this.analyze(); return;
        }
        if (this.objective !== 'pc' && this.training && result.combo?.proven && result.combo.best < Math.max(0, this.trainingGoal - this.comboProgress(game))) { this.saveFailure(game); game.retryAnalysisPlacement(); this.observedRevision = game.revision; this.flushRecord(false); el('combo-feedback').textContent = 'This placement lost a verified continuation to the training target. Only this piece and its timer were restored.'; this.analyze(); return; }
        if (result.status === 'Incomplete') this.status('Incomplete · This placement is unproven. Continue freely or choose a verified route; no mistake was recorded.');
      }
      if (result.routes.length && (!this.selected || (this.objective !== 'pc' && !this.selectionPinned && !this.training))) { this.selected = result.routes[0]; this.liveStep = this.preview = 0; this.applyHint(); this.renderRoutes(); }
      if (this.training) game.analysisPolicy = this.preferences.policy;
    }, message => { this.busy = false; game.analysisPending = false; el('pc-cancel').hidden = true; this.status(message); });
  }
  private scope(request: AnalysisRequest, result?: AnalysisResult) {
    const board = request.position.board, height = board.reduce((top, row, y) => row.some(Boolean) ? y + 1 : top, 0);
    el('pc-scope').textContent = `${request.information === 'seeded' ? 'Full queue planning' : request.information === 'pack' ? 'Latest visible pack + carryover' : 'Visible queue'} · ${request.position.currentKnown ? [request.position.falling.symbol, ...request.position.next].join(' ').toUpperCase() : 'Known queue exhausted; Hold only'} · Hold ${request.position.hold?.toUpperCase() ?? 'empty'}${request.position.holdLocked ? ' (locked)' : ''} · Any-line PC · Height ${height} · Up to ${request.depth} placements · Time limit ${request.budget.milliseconds / 1000} s${result ? ` · ${result.checked} placements checked in ${result.elapsedMs.toFixed(0)} ms` : ''} · Frozen timing`;
    if (request.goal.kind === 'combo') {
      el('pc-scope').textContent = el('pc-scope').textContent!.replace('Any-line PC', request.goal.objective === 'attack' ? 'Combo attack objective' : 'Consecutive clear objective');
      const known=Number(request.position.currentKnown)+request.position.next.length+Number(request.rules.hold&&!!request.position.hold);
      const placements=Math.min(request.depth,known),cells=board.reduce((sum,row)=>sum+row.filter(Boolean).length,0),bound=Math.min(placements,Math.floor((cells+4*placements)/request.rules.board.width));
      el('pc-scope').textContent += ` · ${known} known pieces including Hold · Cell-count ceiling: ${bound} clearing placements, before reachability and queue order`;
      if(request.information!=='seeded'&&known<request.depth&&this.scene?.future) el('pc-scope').textContent += '. Allow full queue planning to search a longer run.';
      if (result?.combo) el('pc-scope').textContent += ` · ${result.combo.board} · ${result.combo.proven ? 'Proven best within scope' : 'Best found'}: ${result.combo.best} ${result.combo.objective === 'attack' ? 'attack' : 'consecutive clears'} · ${result.combo.immediateChoices} immediate clearing choices${result.combo.immediateComplete ? '' : ' found so far'}`;
    }
  }
  private clearCount(game: TrainerGame) { return Object.entries(game.clears).reduce((sum,[kind,count])=>sum+(kind!=='none'&&kind!=='pc'&&!kind.endsWith('-0')?count:0),0); }
  private comboProgress(game: TrainerGame) {
    return this.objective === 'attack' ? game.engine.stats.garbage.attack - (this.scene?.context.snapshot.stats.garbage.attack ?? 0) : this.clearCount(game) - this.clearBaseline;
  }
  private handleComboPlacement(game: TrainerGame, placement: TrainerGame['placements'][number], followsRoute: boolean) {
    if (!placement.result.lines && !followsRoute) {
      const context = this.scene ? currentSceneContext(this.scene,placement.snapshot,game.rules,game.settings) : analysisContext(game.rules,game.settings,placement.snapshot);
      const request = analysisRequest(context,{sessionId:this.scene?.id??'combo-break',revision:++this.revision,information:this.information,kind:'combo',objective:'clears',cleanup:0,depth:1,milliseconds:3000,candidates:8});
      this.busy=true; this.key=this.stateKey(game); this.pose=this.poseKey(game); this.request=request; game.analysisPending=true;
      this.coverage.cancel(); game.setContinuation(null); game.demonstration=null; el('pc-guide').hidden=true; el('pc-cancel').hidden=false;
      this.status('Checking the board before this combo break...');
      this.session.run(request,(result,done)=>{
        if(!done||this.game!==game||this.request!==request||this.key!==this.stateKey(game)||this.pose!==this.poseKey(game))return;
        this.busy=false;game.analysisPending=false;el('pc-cancel').hidden=true;
        if(result.combo?.immediateChoices) {
          this.saveFailure(game);
          if(this.training&&this.preferences.policy==='any') {game.retryAnalysisPlacement();this.observedRevision=game.revision;} else if(this.training) game.analysisMistakes++; this.flushRecord(false);
          el('combo-feedback').textContent=this.training&&this.preferences.policy==='any'?'Avoidable break: a verified clearing move existed. Only this piece and its timer were restored.':'Avoidable break: a verified clearing move existed. The previous board was saved as a drill.';
        } else el('combo-feedback').textContent=result.combo?.immediateComplete?'No legal immediate clear existed with the available current piece and Hold. No decision mistake recorded.':'Break unresolved: the check was incomplete. No decision mistake recorded.';
        this.analyze();
      },message=>{game.analysisPending=false;this.busy=false;el('pc-cancel').hidden=true;this.status(message);});
      return true;
    }
    if(this.training&&this.record&&placement.result.lines>0&&this.comboProgress(game)>=this.trainingGoal&&(!followsRoute||this.liveStep+1>=this.selected!.steps.length)) {
      this.record.solved=true;this.flushRecord();this.training=false;this.invalidate(false);this.status('Combo route complete. Continue from this board or repeat the drill.');return true;
    }
    return false;
  }
  private practice() {
    if (!this.scene) this.captureCurrent();
    const selected = this.selected;
    if (this.preferences.policy === 'guided' && !selected) throw new Error('Select a verified route before guided practice.');
    this.saveScene(this.scene!); const scene = this.scene!; this.load(scene);
    this.trainingGoal = selected?.combo ? this.objective === 'attack' ? selected.combo.attack : selected.combo.clears : 1;
    this.training = true; this.game!.analysisPolicy = this.preferences.policy;
    this.game!.hideAnalysisTarget = this.preferences.learning === 'none';
    this.beginRecord(scene);
    this.selected = selected; this.liveStep = this.preview = 0;
    if (selected) this.applyHint(); else if (this.preferences.learning !== 'none') this.analyze();
    this.status(`${this.objective !== 'pc' ? `Combo target: ${this.trainingGoal} ${this.objective === 'attack' ? 'attack' : 'consecutive clears'}. ` : ''}${this.preferences.policy === 'guided' ? 'Follow the selected route. Mistakes retry one piece.' : this.preferences.policy === 'any' ? this.objective === 'pc' ? 'Any verified PC continuation is accepted. Proven dead ends retry one piece.' : 'Any continuation is accepted; proven avoidable breaks retry one piece.' : 'Place freely; advice updates after each lock.'} Gravity and locking are frozen.`);
  }
  private beginRecord(scene: PcScene) {
    const game = this.game!;
    this.clearBaseline = this.clearCount(game);
    this.recordStart = { attempts: game.placements.length, mistakes: game.analysisMistakes + game.targetMisses, faults: game.faults, timeMs: game.elapsedMs };
    const learning = this.exposedScenes.has(this.exposureKey(scene)) && this.preferences.learning === 'none' ? 'previous answer' : this.preferences.learning;
    this.record = { id: crypto.randomUUID(), sceneId: scene.id, date: new Date().toISOString(), attempts: 0, solved: false, mistakes: 0, faults: 0, timeMs: 0, learning, initialLearning: learning, thinkingMs: 0, structure: structureTag(scene.context), objective: this.objective };
    this.thinkingTick = performance.now();
  }
  private applyHint() {
    if (!this.game) return;
    this.game.hideAnalysisTarget = this.preferences.learning === 'none';
    if (!this.selected) return;
    const step = this.selected.steps[this.liveStep]; if (!step) return;
    this.routeHistory = [{ route: this.selected, queueLength: this.routeQueueLength, training: this.training, goal: this.trainingGoal, clearBaseline: this.clearBaseline, scope: el('pc-scope').textContent ?? '' }, ...this.routeHistory.filter(item=>item.route!==this.selected)].slice(0,20);
    if (this.training && this.preferences.policy === 'guided') this.game.setContinuation(step.scene, true);
    else if (this.preferences.learning !== 'none') this.game.setContinuation(step.scene, false);
    if (this.preferences.learning === 'none') {
      this.game.hintTarget = null; this.game.hideAnalysisTarget = true; this.game.demonstration = null; el('pc-guide').hidden = true;
    } else { if (this.scene) this.exposedScenes.add(this.exposureKey(this.scene)); this.game.hideAnalysisTarget = false; this.preview = this.liveStep; this.drawGuide(); this.animate(); }
  }
  private exposureKey(scene: PcScene) { const snapshot=scene.context.snapshot; return `${this.objective}|${boardMask(snapshot.board)}|${snapshot.falling.symbol}|${snapshot.hold}|${snapshot.queue.value}`; }
  private animate() {
    if (!this.selected || !this.game || this.game.fault || this.preferences.learning === 'none') return;
    const scene = this.selected.steps[this.preview].scene;
    this.game.demonstration = { ...scene, snapshot: scene.guideSnapshot ?? scene.snapshot, kind: 'guide', serial: Date.now(), sceneNumber: this.preview + 1 };
  }
  private drawGuide() {
    if (!this.selected || !this.game || this.preferences.learning === 'none') { el('pc-guide').hidden = true; return; }
    const step = this.selected.steps[this.preview], snapshot = step.scene.guideSnapshot ?? step.scene.snapshot;
    el('pc-guide').hidden = false; el('pc-guide-title').textContent = this.selected.combo ? `${this.selected.combo.clears} consecutive clears / Combo ${this.selected.combo.endCombo} / ${this.selected.combo.attack} attack` : `${this.selected.steps.length} placements · ${this.selected.lines}-line PC`;
    el('pc-step').textContent = `${this.selected.combo ? `${this.selected.combo.choices[this.preview]} immediate clearing choices / ${this.selected.combo.boundary}. ` : ''}Preview ${this.preview + 1} / ${this.selected.steps.length} · ${step.piece.toUpperCase()} · ${step.lines} lines${step.scene.holdFirst ? ' · Hold first' : ''}${this.training ? ` · Live step ${this.liveStep + 1}` : ''}`;
    el<HTMLButtonElement>('pc-prev').disabled = this.preview === 0; el<HTMLButtonElement>('pc-next').disabled = this.preview >= this.selected.steps.length - 1 || this.preferences.learning !== 'full';
    const canvas = el<HTMLCanvasElement>('pc-preview'); canvas.width = this.game.engine.board.width * 20; canvas.height = (this.game.engine.board.height + 3) * 20;
    drawBoard(canvas, this.game.engine, snapshot.board, snapshot.falling, step.scene.target, this.game.settings.display);
    el('pc-full').hidden = this.preferences.learning !== 'full'; el<HTMLDetailsElement>('pc-full').open = this.preferences.learning === 'full';
    el('pc-plan').replaceChildren(...this.selected.steps.map((step, i) => { const li = document.createElement('li'); li.textContent = `${i + 1}. ${step.scene.holdFirst ? 'Hold → ' : ''}${step.piece.toUpperCase()} · ${placementSteps(step.scene.path, this.game!.settings).map(input => input.text).join(' → ')}`; return li; }));
  }
  private renderRoutes() {
    const routes = this.result?.routes ?? [], hidden = this.preferences.learning === 'none';
    el('pc-routes').replaceChildren(...(hidden ? [] : routes.slice(0, this.shown)).map((route, index) => {
      const button = document.createElement('button'); button.className = 'opener-card secondary'; button.setAttribute('aria-pressed', String(this.selected?.id === route.id));
      const title = document.createElement('strong'), summary = document.createElement('small'), cost = routeCost(route);
      title.textContent = `Candidate ${index + 1} · ${cost[0]} pieces`;
      const allocation = routeIdentity(route).allocation, earlier = routes.slice(0, index);
      summary.textContent = `${cost[1]} soft-drop placements · ${cost[2]} Holds · ${cost[3]} inputs · ${earlier.some(other => routeIdentity(other).allocation === allocation) ? 'Order / intermediate variant' : 'Distinct piece allocation'}`;
      if (route.combo) { title.textContent = `Candidate ${index + 1}: ${route.combo.clears} consecutive clears`; summary.textContent = `${route.combo.attack} attack / Combo ${route.combo.endCombo} / ${route.combo.setup} setup placements / ${cost[3]} inputs`; }
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 120; canvas.setAttribute('aria-hidden', 'true');
      const context = canvas.getContext('2d')!, step = route.steps[0], width = step.scene.snapshot.board[0].length;
      const height = Math.max(6, step.scene.snapshot.board.reduce((top, row, y) => row.some(Boolean) ? y + 1 : top, 0), ...step.scene.target.map(([, y]) => y + 1));
      const size = Math.min(200 / width, 120 / height), offset = (200 - width * size) / 2;
      context.fillStyle = '#0b101b'; context.fillRect(0,0,200,120);
      step.scene.snapshot.board.slice(0,height).forEach((row,y) => row.forEach((tile,x) => { if (tile) { context.fillStyle = '#78869b'; context.fillRect(offset+x*size+1,120-(y+1)*size+1,size-2,size-2); } }));
      context.fillStyle = '#a9dcd0'; step.scene.target.forEach(([x,y]) => context.fillRect(offset+x*size+1,120-(y+1)*size+1,size-2,size-2));
      button.append(canvas,title,summary); button.addEventListener('click', () => { this.selected = route; this.selectionPinned = true; this.liveStep = this.preview = 0; this.applyHint(); this.renderRoutes(); button.blur(); }); return button;
    }));
    el('pc-more').hidden = hidden || routes.length <= this.shown;
    el('pc-candidate-note').textContent = routes.length ? `${routes.length} retained candidates; this is not the total number of solutions. ${hidden ? 'Answers are hidden.' : this.objective === 'pc' ? 'Shorter routes appear first, with different allocations before order variants; costs compare retained routes only.' : 'Ranked by the selected combo objective. Candidate counts are not exhaustive.'}` : '';
  }
  private matchesRoutePosition(snapshot: EngineSnapshot, index: number, route = this.selected, queueLength = this.routeQueueLength) {
    const step = route?.steps[index]; if (!step) return false;
    const drawn = route!.steps.slice(0, index).reduce((sum, item) => sum + 1 + Number(item.scene.holdFirst && !item.scene.snapshot.hold), 0);
    return [step.scene.snapshot, step.scene.guideSnapshot].some((expected, held) => {
      if (!expected) return false;
      const known = queueLength - drawn - Number(held && !step.scene.snapshot.hold);
      return String(boardMask(snapshot.board)) === String(boardMask(expected.board))
        && (step.unknownCurrent && !held || snapshot.falling.symbol === expected.falling.symbol)
        && (step.unknownCurrent && held || snapshot.hold === expected.hold)
        && snapshot.holdLocked === expected.holdLocked
        && expected.queue.value.slice(0, Math.min(Math.max(0, known - 1), snapshot.queue.value.length)).every((piece, i) => piece === snapshot.queue.value[i]);
    });
  }
  private restoreRoute(game: TrainerGame) {
    const snapshot = game.engine.snapshot({ isUndoRedo: true });
    for (const saved of this.routeHistory) {
      const index = saved.route.steps.findIndex((step,i)=>this.matchesRoutePosition(snapshot,i,saved.route,saved.queueLength) && stableKey(snapshot.stats)===stableKey(step.scene.snapshot.stats));
      if (index<0) continue;
      this.invalidate(false); this.training = saved.training; this.trainingGoal = saved.goal;
      if (this.training && !this.record && this.scene) this.beginRecord(this.scene);
      this.clearBaseline = saved.clearBaseline; this.selected = saved.route; this.routeQueueLength = saved.queueLength; this.liveStep = this.preview = index;
      this.selectionPinned = true; game.analysisPolicy = this.training ? this.preferences.policy : null;
      el('pc-scope').textContent = saved.scope; el('combo-feedback').textContent = ''; el<HTMLButtonElement>('pc-practice').disabled = false;
      this.applyHint(); this.status(`Board restored. Selected route restored at step ${index+1} / ${saved.route.steps.length}. No new search needed.`); return true;
    }
    return false;
  }
  private followsRoute(game: TrainerGame, placements: TrainerGame['placements']) {
    if (!this.selected || !placements.length) return false;
    const steps = this.selected.steps.slice(this.liveStep, this.liveStep + placements.length);
    if (steps.length !== placements.length || !steps.every((step, i) => {
      const placement = placements[i];
      return placement.piece === step.piece && placement.result.lines === step.lines && sameCells(placement.cells, step.scene.target)
        && String(boardMask(placement.snapshot.board)) === String(boardMask(step.scene.snapshot.board))
        && (this.objective === 'pc' || placement.result.spin === step.spin);
    })) return false;
    const after = steps.at(-1)!.after, snapshot = game.engine.snapshot({ isUndoRedo: true }), next = this.liveStep + steps.length;
    return String(boardMask(snapshot.board)) === String(boardMask(after.board))
      && (this.objective === 'pc' || snapshot.stats.combo === after.stats.combo && snapshot.stats.b2b === after.stats.b2b && Math.abs(snapshot.stats.garbage.attack - after.stats.garbage.attack) < 0.000001)
      && (next === this.selected.steps.length || this.matchesRoutePosition(snapshot, next));
  }
  update() {
    const tick = performance.now(), delta = Math.min(250, tick - this.thinkingTick); this.thinkingTick = tick;
    el('pc-static').hidden = !(this.visible && this.selected && this.game?.demonstration?.kind === 'guide');
    if (!this.visible) return;
    if (this.record && !document.hidden && !this.game?.analysisPending && this.game?.status === 'playing' && this.game.awaitingDecision) this.record.thinkingMs = (this.record.thinkingMs ?? 0) + delta;
    const game = this.callbacks.game();
    if (this.game !== game) { this.captureCurrent(); this.status('Session changed. Analyze this board again.'); return; }
    if (this.observedRules !== this.rulesKey(game)) { this.observedRules = this.rulesKey(game); this.training = false; this.flushRecord(); this.invalidate(); this.status('Rules changed. Analyze this board again.'); return; }
    if (game.revision !== this.observedRevision) {
      this.observedRevision = game.revision; this.count = game.placements.length;
      if (!this.restoreRoute(game)) {
        const hadRoute = this.routeHistory.length>0; this.training = false; this.flushRecord(); this.invalidate(false);
        if (hadRoute) this.analyze(); else this.status('Board restored. Previous routes and animations cleared.');
      }
      this.key = this.stateKey(game); this.pose = this.poseKey(game); return;
    }
    if (game.placements.length !== this.count) {
      const recent = game.placements.slice(this.count); this.count = game.placements.length;
      for (const placement of recent) if (!placement.accepted) {
        this.saveFailure(game);
        if (this.preferences.learning === 'none') game.demonstration = null;
      }
      this.flushRecord(false);
      if (recent.some(placement => placement.accepted)) {
        this.session.cancel(); this.busy = false; this.request = null; el('pc-cancel').hidden = true;
        const accepted = recent.filter(placement => placement.accepted), follows = this.followsRoute(game, accepted);
        if (this.objective !== 'pc' && this.handleComboPlacement(game, accepted.at(-1)!, follows)) return;
        if (this.objective === 'pc' && recent.some(placement => placement.accepted && placement.result.lines > 0) && !game.engine.board.state.some(row => row.some(Boolean))) {
          const chain = this.training && el<HTMLInputElement>('pc-chain').checked;
          if (this.record) this.record.solved = true; this.flushRecord();
          if (chain) {
            const next = this.currentScene('Continuous PC');
            if (next.context.currentKnown === false && !next.context.snapshot.hold) { this.training = false; this.invalidate(); this.status('Perfect clear complete. The supplied queue is exhausted; provide more pieces to continue.'); return; }
            this.load(next); this.saveScene(next); this.training = true; this.game!.analysisPolicy = this.preferences.policy; this.beginRecord(next); this.analyze();
            return;
          }
          this.training = false; this.invalidate(false); this.status('Perfect clear complete. Repeat the board, deal a new seed, or keep playing.'); return;
        }
        if (follows && this.selected) {
          this.liveStep += accepted.length; this.result = null; this.renderRoutes(); game.analysisPending = false;
          if (this.liveStep < this.selected.steps.length) {
            this.preview = this.liveStep; this.applyHint();
            this.status(`Following the selected route · Step ${this.liveStep + 1} / ${this.selected.steps.length}. No new search needed.`);
          } else { this.training = false; this.invalidate(false); this.status('Combo route complete. Continue from this board or repeat the drill.'); }
        } else this.analyze(game.analysisPending);
      }
      this.key = this.stateKey(game); this.pose = this.poseKey(game); return;
    }
    const key = this.stateKey(game), pose = this.poseKey(game);
    if (key !== this.key || pose !== this.pose) {
      this.coverage.cancel();
      const hadRoute = this.busy || !!this.selected || !!this.result;
      const following = this.matchesRoutePosition(game.engine.snapshot({ isUndoRedo: true }), this.liveStep);
      if (this.busy) { this.session.cancel(); this.busy = false; this.request = null; el('pc-cancel').hidden = true; }
      this.result = null; this.renderRoutes();
      if (following) this.status(`Following the selected route · Step ${this.liveStep + 1} / ${this.selected!.steps.length}. No new search needed.`);
      else if (!this.training) { this.selected = null; game.setContinuation(null); el('pc-guide').hidden = true; el<HTMLButtonElement>('pc-practice').disabled = this.preferences.policy === 'guided'; if (hadRoute) this.status('Position changed. Analyze again for a current path.'); }
      if (!following && game.demonstration?.kind === 'guide') game.demonstration = null;
      this.key = key; this.pose = pose;
    }
  }
  private saveFailure(game: TrainerGame) {
    const placement = game.placements.at(-1); if (!placement) return;
    const scene = this.currentScene(this.objective === 'pc' ? 'PC mistake board' : 'Combo break board'); scene.context = this.scene ? currentSceneContext(this.scene, placement.snapshot, game.rules, game.settings) : analysisContext(game.rules, game.settings, placement.snapshot); scene.source = this.objective === 'pc' ? 'PC practice mistake; board before the attempted placement' : placement.reason === 'finesse' ? 'Combo input mistake: the finesse path was inefficient' : placement.reason === 'target' ? 'Combo guided-route deviation: target placement differed' : 'Avoidable combo break: a verified continuation existed';
    try { this.saveScene(scene); } catch (error) { this.status((error as Error).message); }
  }
  private saveScene(scene: PcScene) {
    const scenes = [...this.library.scenes.filter(item => item.id !== scene.id), structuredClone(scene)].slice(-100);
    const next = { ...this.library, scenes }; savePcLibrary(localStorage, next); this.library = next; this.renderSaved();
  }
  private flushRecord(end = true) {
    if (!this.record || !this.game) return;
    Object.assign(this.record, { attempts: Math.max(0, this.game.placements.length - this.recordStart.attempts), mistakes: Math.max(0, this.game.analysisMistakes + this.game.targetMisses - this.recordStart.mistakes), faults: Math.max(0, this.game.faults - this.recordStart.faults), timeMs: Math.max(0, this.game.elapsedMs - this.recordStart.timeMs) });
    this.library.records = [...this.library.records.filter(record => record.id !== this.record!.id), structuredClone(this.record)].slice(-1000);
    try { savePcLibrary(localStorage, this.library); } catch (error) { this.status((error as Error).message); }
    if (end) this.record = null;
  }
  private renderSaved() { el<HTMLSelectElement>('pc-saved').replaceChildren(...this.library.scenes.map(scene => new Option(scene.name, scene.id))); }
  renderStatistics(container: HTMLElement) {
    try { this.library = readPcLibrary(localStorage); } catch (error) { container.textContent = (error as Error).message; return; }
    container.replaceChildren(); const title = document.createElement('h3'); title.textContent = 'Perfect Clear and Combo practice'; container.append(title);
    const summary = document.createElement('p'); summary.className = 'muted'; summary.textContent = `${this.library.records.length} attempts · ${this.library.records.filter(record => record.solved).length} completed boards · ${this.library.records.reduce((sum, record) => sum + record.mistakes, 0)} placement mistakes. PC decisions and finesse faults are recorded separately.`; container.append(summary);
    const stats = practiceSummary(this.library.records), details = document.createElement('p'); details.className = 'muted';
    details.textContent = `Independent solves ${stats.independentSolved}/${stats.independentAttempts} unhinted starts; hints used ${stats.hintUsed}/${stats.attempts}; first-try solves ${stats.firstTry}/${stats.attempts}; retries ${stats.retries}; thinking time ${(stats.thinkingMs / 1000).toFixed(1)} s. Thinking time measures visible, unpaused time before the first input after spawn or Hold, excluding placement validation. Previously viewed answers count as hint use.`; container.append(details);
    for (const weak of stats.weaknesses) { const line = document.createElement('p'); line.className = 'muted'; line.textContent = `${weak.structure}: ${weak.solved}/${weak.attempts} solved, ${weak.mistakes} decision mistakes`; container.append(line); }
    for (const scene of this.library.scenes) {
      const row = document.createElement('div'); row.className = 'page-toolbar'; const name = document.createElement('span'); name.textContent = scene.name;
      const button = document.createElement('button'); button.className = 'secondary small'; button.textContent = 'Practice PC board'; button.addEventListener('click', () => { try { this.importScene(scene); } catch (error) { this.status((error as Error).message); } });
      row.append(name, button); container.append(row);
    }
  }
}
