import { ReviveDemo } from './revive-demo';
import type { TrainerGame } from './game';
import type { QpSettings } from './qp-config';
import { validateQpSettings } from './qp-config';
import { QuickPlayRuntime, copyQpCheckpoint, copyQpSettings, type QpCheckpoint } from './qp-runtime';
import { createEngine } from './engine';
import { modeDefinitions } from './modes';
import { trialQpOperation, routeEffort, type QpOperation, type ReviveRoute, type ReviveSearch } from './qp-search';
import { extractQpPressure } from './qp-pressure';
import { reviveCatalog } from './revive-tasks';
import { drawBoard } from './renderer';
import { qpVisual } from './qp-mod-state';
import { reviveGuidanceIdentity, reviveSearchDepth, ReviveContinuation } from './revive-guidance';
import { bindingLabel } from './settings';
import { loadRevivePreferences, readReviveRecords, revivePreferencesKey, reviveRecordsKey, RevivePracticeTracker, type ReviveAttempt } from './revive-practice';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
type Callbacks = { game: () => TrainerGame; start: (config: QpSettings, scene?: QpCheckpoint) => TrainerGame; coachingGravity?: (enabled: boolean) => void };
type Scene = { id: string; name: string; checkpoint: QpCheckpoint };
const scenesKey = 'tetrio-trainer-revive-scenes-v1';
const taskLabel = (id: string) => reviveCatalog.find(task => task.id === id)?.label ?? id;

export class RevivePage {
  active = false;
  private config = loadRevivePreferences(localStorage);
  private records = readReviveRecords(localStorage);
  private tracker = new RevivePracticeTracker(attempt => this.record(attempt));
  private scenes: Scene[] = [];
  private runtime: QuickPlayRuntime | null = null;
  private observed = '';
  private worker: Worker | null = null;
  private source: QpCheckpoint | null = null;
  private result: ReviveSearch | null = null;
  private selected: ReviveRoute | null = null;
  private continuation: ReviveContinuation | null = null;
  private progressPose = '';
  private routeNumber = 1;
  private demo: { view: ReviveDemo; due: number; last: number; ended: number | null } | null = null;
  private hintDue = 0;
  private pose = '';
  private validating: Worker | null = null;
  private liveOperation: QpOperation | null = null;
  private coachSource: QpCheckpoint | null = null;
  private trackedGame: TrainerGame | null = null;
  private hintGame: TrainerGame | null = null;
  constructor(private callbacks: Callbacks) {
    try { const scenes = JSON.parse(localStorage.getItem(scenesKey) || '[]'); if (Array.isArray(scenes)) this.scenes = scenes.filter(scene => typeof scene.id === 'string' && typeof scene.name === 'string' && scene.checkpoint?.sides?.length === 2).slice(-10); } catch {}
    const section = document.createElement('section'); section.id = 'revive-options'; section.hidden = true;
    section.innerHTML = `<span class="eyebrow">DUO PRACTICE</span><h2>Revive</h2><form id="revive-form"><label class="select-row">Task family<select id="revive-family"><option value="all">All tasks</option><option value="input">Inputs and time</option><option value="spin">Spins</option><option value="o">O piece</option><option value="clear">Clears and attacks</option></select></label><label class="select-row">Difficulty<select id="revive-tier"><option value="all">All tiers</option></select></label><label class="select-row">Add a task<select id="revive-task"></select></label><div class="page-toolbar"><button id="revive-add" class="secondary" type="button">Add task</button><button id="revive-group" class="secondary" type="button">Add filtered group</button></div><label class="select-row">Task selection<select id="revive-task-mode"><option value="sequence">Play selected tasks in order</option><option value="random">Random from selected tasks</option></select></label><label class="number-row" id="revive-count-row" hidden><span>Tasks per rescue (up to)</span><input id="revive-task-count" type="number" min="1" max="3" value="3"></label><ol id="revive-sequence"></ol><button id="revive-clear" class="secondary small" type="button">Clear sequence</button><label class="select-row">Pressure<select id="revive-pressure"><option value="none">No pressure</option><option value="generated">Generated pressure</option><option value="replay">Recorded pressure</option></select></label><label class="number-row"><span>Strength</span><input id="revive-strength" type="number" min="0" max="5" step=".1"></label><button id="revive-import" class="secondary wide" type="button">Import Zenith pressure</button><input id="revive-file" type="file" accept=".ttr,.json" hidden><p id="revive-tape" class="muted"></p><label class="check-row"><input id="revive-repeat" type="checkbox">Continuous revive run</label><button type="submit" class="wide">Start new practice</button><button id="revive-stop" type="button" class="secondary wide">Stop</button></form><details><summary>Saved situations</summary><label class="select-row">Situation<select id="revive-scene"></select></label><button id="revive-save" class="secondary wide">Save current situation</button><button id="revive-open" class="secondary wide">Start new run from situation</button><p class="muted">Saved situations retain both boards, task progress, held inputs, garbage, time and random state.</p></details><details><summary>Practice statistics</summary><p id="revive-stats"></p><label class="select-row">Unfinished tasks<select id="revive-failure"></select></label><button id="revive-train-failure" class="secondary wide">Select this task</button></details><p id="revive-status" role="status"></p>`;
    document.querySelector('.workspace-left')!.prepend(section);
    el('revive-stop').className = 'secondary'; document.querySelector('.game-toolbar')!.append(el('revive-stop'));
    const guide = document.createElement('section'); guide.id = 'revive-guide'; guide.hidden = true;
    guide.innerHTML = `<span class="eyebrow">CURRENT REVIVE TASK</span><h3>Placement coach</h3><label class="check-row"><input id="revive-no-gravity" type="checkbox">No gravity for revive coaching</label><p id="revive-search-status" role="status">Start a rescue for automatic guidance.</p><button id="revive-search" class="secondary wide">Recalculate routes</button><button id="revive-cancel" class="secondary wide" hidden>Cancel search</button><section id="revive-detail" hidden><h4 id="revive-route-title"></h4><p id="revive-piece" class="muted"></p><p id="revive-next-step"></p><canvas id="revive-demo-board" width="200" height="460" aria-label="Revive operation demonstration"></canvas><ol id="revive-coach-steps"></ol><label class="check-row"><input id="revive-shadow" type="checkbox" checked>Show next placement shadow</label><div class="page-toolbar"><button id="revive-demo" class="secondary">Animate this step</button><button id="revive-demo-stop" class="secondary">Stop demo</button></div><p id="revive-demo-step" role="status"></p><details><summary>Complete input timeline</summary><ol id="revive-steps"></ol></details></section><details><summary>Other candidate routes</summary><div id="revive-routes"></div></details><details><summary>Search details</summary><p id="revive-scope" class="muted"></p></details>`;
    el('qp-guide').prepend(guide);
    for (const tier of [...new Set(reviveCatalog.map(task => task.tier))]) el<HTMLSelectElement>('revive-tier').add(new Option(`Tier ${tier}`, tier));
    const on = (id: string, action: () => void) => el(id).addEventListener('click', () => { try { action(); } catch (error) { this.status((error as Error).message); } el(id).blur(); });
    for (const id of ['revive-family', 'revive-tier']) el(id).addEventListener('change', () => this.tasks());
    on('revive-add', () => { const id = el<HTMLSelectElement>('revive-task').value; if (id && this.config.tasks.length < 100) this.config.tasks.push(id); this.sequence(); });
    on('revive-group', () => { this.config.tasks.push(...Array.from(el<HTMLSelectElement>('revive-task').options).map(option => option.value).slice(0, 100 - this.config.tasks.length)); this.sequence(); });
    on('revive-clear', () => { this.config.tasks = []; this.sequence(); });
    on('revive-import', () => el<HTMLInputElement>('revive-file').click());
    el('revive-file').addEventListener('change', async () => {
      const input = el<HTMLInputElement>('revive-file'), file = input.files?.[0]; if (!file) return;
      try { if (file.size > 20_000_000) throw new Error('Choose a recording below 20 MB.'); this.config.pressure.tape = extractQpPressure(JSON.parse(await file.text()), file.name); el<HTMLSelectElement>('revive-pressure').value = 'replay'; this.tape(); }
      catch (error) { this.status((error as Error).message); } finally { input.value = ''; }
    });
    el('revive-form').addEventListener('submit', event => { event.preventDefault(); try { this.start(); } catch (error) { this.status((error as Error).message); } });
    on('revive-stop', () => { this.callbacks.game().stopQuickPlay(); this.clear(); this.status('Practice stopped. Start a new run to continue.'); });
    on('revive-search', () => this.search()); on('revive-cancel', () => { this.clear(); el('revive-search-status').textContent = 'Search canceled. No conclusion about solvability.'; });
    on('revive-demo', () => this.demonstrate()); on('revive-demo-stop', () => { this.demo = null; el('revive-demo-step').textContent = 'Demo stopped.'; });
    on('revive-save', () => this.saveScene()); on('revive-open', () => this.openScene());
    on('revive-train-failure', () => { const task = el<HTMLSelectElement>('revive-failure').value; if (task) { this.config.tasks = [task]; this.sequence(); } });
    el<HTMLSelectElement>('revive-task-mode').value = this.config.taskMode; el<HTMLInputElement>('revive-task-count').value = String(this.config.randomTaskCount);
    const selection = () => { el('revive-count-row').hidden = el<HTMLSelectElement>('revive-task-mode').value !== 'random'; };
    el('revive-task-mode').addEventListener('change', selection); selection();
    el<HTMLInputElement>('revive-no-gravity').checked = this.config.reviveNoGravity;
    el('revive-no-gravity').addEventListener('change', () => {
      const enabled = el<HTMLInputElement>('revive-no-gravity').checked, game = this.callbacks.game();
      if (this.active) { this.config.reviveNoGravity = enabled; this.persist(); }
      this.callbacks.coachingGravity?.(enabled);
      if (game.qp) { game.qp.settings.quickplay.reviveNoGravity = enabled; game.qp.events.push({ frame: game.qp.frame, side: 0, type: 'coaching-gravity', data: { disabled: enabled } }); }
    });
    this.tasks(); this.sequence(); this.saved(); this.statistics();
    el<HTMLSelectElement>('revive-pressure').value = this.config.pressure.mode; el<HTMLInputElement>('revive-strength').value = String(this.config.pressure.strength); el<HTMLInputElement>('revive-repeat').checked = this.config.repeat; this.tape();
  }
  private status(message: string) { el('revive-status').textContent = message; }
  private persist() { localStorage.setItem(revivePreferencesKey, JSON.stringify(this.config)); }
  private tasks() {
    const family = el<HTMLSelectElement>('revive-family').value, tier = el<HTMLSelectElement>('revive-tier').value, select = el<HTMLSelectElement>('revive-task'); select.replaceChildren();
    for (const task of reviveCatalog) {
      const input = /^(rotate|hold|nohold|softdrop|holddas|idle|top3rows|nogarbage|nocancel|norotateclockwise|spam)/.test(task.predicate), spin = /spin|mini/.test(task.predicate), square = /^(o|columnopiece|placeoconsecutive)/.test(task.predicate);
      if ((tier === 'all' || tier === task.tier) && (family === 'all' || family === 'input' && input || family === 'spin' && spin || family === 'o' && square || family === 'clear' && !input && !spin && !square)) select.add(new Option(`${task.tier} · ${task.label}`, task.id));
    }
  }
  private sequence() {
    el('revive-sequence').replaceChildren();
    this.config.tasks.forEach((id, index) => {
      const li = document.createElement('li'), text = document.createElement('span'), remove = document.createElement('button'); text.textContent = taskLabel(id); remove.type = 'button'; remove.className = 'secondary small'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove task ${index + 1}`);
      remove.onclick = () => { this.config.tasks.splice(index, 1); this.sequence(); }; li.append(text, remove); el('revive-sequence').append(li);
    });
  }
  private tape() { el('revive-tape').textContent = this.config.pressure.tape ? `${this.config.pressure.tape.name} · ${this.config.pressure.tape.packets.length} incoming interactions` : ''; }
  private start() {
    if (!this.config.tasks.length) throw new Error('Add at least one task.');
    this.config.pressure.mode = el<HTMLSelectElement>('revive-pressure').value as QpSettings['pressure']['mode']; this.config.pressure.strength = Number(el<HTMLInputElement>('revive-strength').value);
    this.config.taskMode = el<HTMLSelectElement>('revive-task-mode').value as QpSettings['taskMode']; this.config.randomTaskCount = Number(el<HTMLInputElement>('revive-task-count').value);
    this.config.reviveNoGravity = el<HTMLInputElement>('revive-no-gravity').checked;
    this.config.repeat = el<HTMLInputElement>('revive-repeat').checked; this.config.trigger = 'bot'; this.config.triggerSeconds = 1;
    this.config = validateQpSettings(this.config); this.persist(); this.clear();
    const game = this.callbacks.start(this.config); game.qp!.requestRescue(1); game.qp!.triggers = 1;
    this.status('Practice started. Every legal completion counts.');
  }
  setVisible(active: boolean) {
    if (this.active === active) return; this.active = active;
    el('play-page').classList.toggle('revive-active', active); el('revive-options').hidden = !active; el('revive-guide').hidden = !active;
    if (!active) this.clear(); else el('qp-toolbar-title').textContent = 'REVIVE PRACTICE';
  }
  private identity() {
    const runtime = this.callbacks.game().qp;
    return runtime ? reviveGuidanceIdentity(runtime) : '';
  }
  private clear() {
    this.worker?.terminate(); this.worker = null; this.validating?.terminate(); this.validating = null; this.liveOperation = null; this.coachSource = null; this.pose = ''; this.result = null; this.selected = null; this.continuation = null; this.progressPose = ''; this.source = null; this.demo = null;
    if (this.hintGame) this.hintGame.hintTarget = null;
    this.hintGame = null; el('revive-routes').replaceChildren(); el('revive-detail').hidden = true; el('revive-cancel').hidden = true; el('revive-scope').textContent = '';
  }
  private search() {
    this.clear(); const qp = this.callbacks.game().qp;
    if (!qp?.sides[0].task || qp.over || qp.sides[0].life !== 'alive') { el('revive-search-status').textContent = 'No active rescue task on your board.'; return; }
    this.source = qp.checkpoint(); this.observed = this.identity(); this.runtime = qp;
    const worker = new Worker(new URL('./revive-worker.ts', import.meta.url), { type: 'module' }); this.worker = worker;
    worker.onmessage = event => {
      worker.terminate(); if (this.worker !== worker) return; this.worker = null; el('revive-cancel').hidden = true;
      if (event.data.error) { el('revive-search-status').textContent = `Search error: ${event.data.error}`; return; }
      if (this.identity() !== this.observed) { this.search(); return; }
      this.result = event.data.result; this.render();
    };
    this.worker.onerror = event => { this.clear(); el('revive-search-status').textContent = `Search error: ${event.message}`; };
    this.worker.postMessage({ checkpoint: this.source, budget: { nodes: 100000, depth: reviveSearchDepth, beam: 8, milliseconds: 3000, information: 'seeded', objective: 'effort' } });
    el('revive-search-status').textContent = 'Searching legal inputs and simulation time…'; el('revive-cancel').hidden = false;
  }
  private render() {
    const result = this.result!, names: Record<ReviveSearch['status'], string> = { Found: 'Completion route found', BudgetExhausted: 'Budget exhausted', UnknownFuture: 'Unknown future queue', Unsupported: 'Rule or state unsupported', NoTask: 'No active task' };
    el('revive-search-status').textContent = `${names[result.status]} · ${result.nodes.toLocaleString()} nodes · ${result.depth} operations deep`;
    el('revive-scope').textContent = [`Snapshot at ${(this.source!.frame / 60).toFixed(2)} s.`, ...result.limits, 'Routes are checked with gravity, lock timing and queued garbage. An unfinished search does not prove no solution.', 'Full generated queue; maximum depth of twenty operations. The selected completion has the fewest inputs, then placements, among routes found in this budget.'].join(' ');
    const source = QuickPlayRuntime.fromCheckpoint(this.source!), side = source.sides[0];
    result.routes.forEach((route, index) => {
      const button = document.createElement('button'); button.className = 'secondary revive-route'; button.type = 'button';
      const canvas = document.createElement('canvas'); canvas.width = side.engine.board.width * 12; canvas.height = (side.engine.board.height + 3) * 12; canvas.setAttribute('aria-label', `Candidate ${index + 1} first placement`);
      drawBoard(canvas, side.engine, side.engine.board.state, side.engine.falling.snapshot(), route.operations[0]?.target ?? null, side.settings.display, 3, qpVisual(side, source.frame, true));
      const label = document.createElement('span'); const effort = routeEffort(route);
      label.textContent = `Route ${index + 1} · ${route.complete ? 'Completes chain' : 'Partial route'} · ${effort.inputs} inputs / ${effort.placements} placements`; if (route.operations[0]?.target) button.append(canvas); button.append(label); button.onclick = () => this.select(route, index); el('revive-routes').append(button);
    });
    if (result.routes.length) this.select(result.routes[0], 0);
  }
  private select(route: ReviveRoute, index: number) {
    this.continuation = new ReviveContinuation(this.source!, route.operations); this.routeNumber = index + 1;
    this.selected = route; this.liveOperation = route.operations[0] ?? null; this.coachSource = this.source; this.demo = null; el('revive-detail').hidden = false; el('revive-route-title').textContent = `Route ${index + 1}${route.complete ? ' · completes chain' : ' · partial progress'}`;
    this.coachSteps(); el('revive-steps').replaceChildren();
    let offset = 0;
    for (const operation of route.operations) {
      const li = document.createElement('li'), title = document.createElement('strong'), timeline = document.createElement('ol'); title.textContent = `${operation.label} · ${(operation.duration / 60).toFixed(2)} s`;
      for (const action of operation.actions) { const step = document.createElement('li'); step.textContent = `${((offset + action.at) / 60).toFixed(2)} s: ${action.down ? 'Press' : 'Release'} ${bindingLabel(this.callbacks.game().settings, action.key)} (${action.key})`; timeline.append(step); }
      const end = document.createElement('li'); end.textContent = `${((offset + operation.duration) / 60).toFixed(2)} s: operation ends; keys without a release remain held.`; timeline.append(end); li.append(title, timeline); el('revive-steps').append(li); offset += operation.duration;
    }
    const qp = QuickPlayRuntime.fromCheckpoint(this.source!), side = qp.sides[0], canvas = el<HTMLCanvasElement>('revive-demo-board'); canvas.width = side.engine.board.width * 20; canvas.height = (side.engine.board.height + 3) * 20;
    drawBoard(canvas, side.engine, side.engine.board.state, side.engine.falling.snapshot(), route.operations[0]?.target ?? null, side.settings.display, 3, qpVisual(side, qp.frame, true)); this.hintDue = 0; this.demonstrate();
  }
  private continueRoute(qp: QuickPlayRuntime) {
    const continuation = this.continuation; if (!continuation || !continuation.advance(qp.checkpoint())) return false;
    this.validating?.terminate(); this.validating = null; this.pose = ''; this.hintDue = 0;
    this.source = continuation.source; this.coachSource = qp.checkpoint(); this.liveOperation = continuation.operation ?? null;
    this.observed = this.identity(); this.coachSteps();
    el('revive-routes').replaceChildren();
    Array.from(el('revive-steps').children).forEach((element, index) => { (element as HTMLElement).hidden = index < continuation.index; });
    el('revive-route-title').textContent = `Route ${this.routeNumber} / Step ${continuation.index + 1} of ${continuation.operations.length}`;
    if (continuation.operation) { this.demonstrate(); el('revive-search-status').textContent = 'Following the calculated route.'; }
    else { this.demo = null; this.callbacks.game().hintTarget = null; if (qp.sides[0].task?.finishedAt === null) this.search(); }
    return true;
  }
  private coachSteps() {
    const operation = this.liveOperation; el('revive-next-step').textContent = operation?.label ?? 'No operation';
    el('revive-coach-steps').replaceChildren();
    if (!operation) return;
    const state = this.coachSource?.sides[0].engine.snapshot, hold = operation.actions.some(action => action.key === 'hold' && action.down);
    el('revive-piece').textContent = state ? hold ? `Hold first: ${state.falling.symbol.toUpperCase()} to ${(state.hold ?? state.queue.value[0]).toUpperCase()}` : `Current piece: ${state.falling.symbol.toUpperCase()}` : '';
    const groups: { label: string; count: number }[] = [];
    for (const [index, action] of operation.actions.entries()) {
      if (!action.down) continue;
      const release = operation.actions.slice(index + 1).find(next => next.key === action.key && !next.down);
      const key = bindingLabel(this.callbacks.game().settings, action.key);
      const label = !release ? `Keep ${key} held across placements` : action.key === 'softDrop' ? `Hold ${key} until the piece lands, then release` : release.at - action.at > 1 ? `Hold ${key} for ${((release.at - action.at) / 60).toFixed(2)} s` : `Press ${key}`;
      const last = groups.at(-1); if (last?.label === label) last.count++; else groups.push({ label, count: 1 });
    }
    for (const group of groups) { const li = document.createElement('li'); li.textContent = `${group.label}${group.count > 1 ? ` x ${group.count}` : ''}`; el('revive-coach-steps').append(li); }
    if (!groups.length) { const li = document.createElement('li'); li.textContent = `Wait ${(operation.duration / 60).toFixed(2)} seconds while the condition holds.`; el('revive-coach-steps').append(li); }
    el('revive-shadow').closest('label')!.hidden = !operation.target;
  }
  private demonstrate() {
    if (!this.coachSource || !this.selected || !this.liveOperation) return;
    this.demo = { view: new ReviveDemo(this.coachSource, this.liveOperation), due: 0, last: performance.now(), ended: null };
  }
  private saveScene() {
    const qp = this.callbacks.game().qp; if (!qp || qp.over || !qp.sides[0].task || qp.sides[0].life !== 'alive') throw new Error('Save a live rescue situation.');
    const checkpoint = qp.checkpoint(); this.scenes.push({ id: crypto.randomUUID(), name: `${taskLabel(qp.sides[0].task.prompts[qp.sides[0].task.active]?.task ?? '')} · ${(qp.frame / 60).toFixed(1)} s`, checkpoint }); this.scenes = this.scenes.slice(-10);
    localStorage.setItem(scenesKey, JSON.stringify(this.scenes)); this.saved(); this.status('Situation saved in this browser.');
  }
  private saved() { const select = el<HTMLSelectElement>('revive-scene'); select.replaceChildren(); this.scenes.forEach(scene => select.add(new Option(scene.name, scene.id))); }
  private openScene() {
    const scene = this.scenes.find(scene => scene.id === el<HTMLSelectElement>('revive-scene').value); if (!scene) return;
    this.clear(); this.callbacks.start(scene.checkpoint.settings.quickplay, scene.checkpoint); this.status('New run started from the saved situation.');
  }
  fromRecording(source: QpCheckpoint, name: string) {
    if (source.over || source.sides[0].state.life !== 'alive') throw new Error('Choose a replay frame with a living player.');
    if (!this.config.tasks.length) throw new Error('Add a Revive task before opening a recording situation.');
    let scene = copyQpCheckpoint(source);
    if (source.sides.length === 1) {
      const settings = copyQpSettings(source.settings);
      settings.quickplay.profile = { mods: ['duo', ...source.settings.quickplay.profile.mods], allyMods: ['duo'] };
      settings.quickplay = validateQpSettings(settings.quickplay);
      const runtime = new QuickPlayRuntime(settings, source.seed, createEngine(settings, source.seed, modeDefinitions.zenith.rules(settings)));
      scene = runtime.checkpoint(); scene.frame = source.frame; scene.climb = structuredClone(source.climb); scene.rng = source.rng; scene.sides[0] = copyQpCheckpoint(source).sides[0];
      scene.sides[1].engine.snapshot.frame = source.frame;
    }
    scene.settings.quickplay.tasks = [...this.config.tasks]; scene.settings.quickplay.taskMode = this.config.taskMode; scene.settings.quickplay.randomTaskCount = this.config.randomTaskCount; scene.settings.quickplay.trigger = 'bot'; scene.settings.quickplay.repeat = this.config.repeat;
    scene.settings.quickplay.triggerSeconds = 1; scene.nextTrigger = scene.frame + 60;
    const practice = QuickPlayRuntime.fromCheckpoint(scene);
    if (practice.sides[1].life === 'alive') practice.requestRescue(1);
    if (!practice.sides[0].task && !practice.sides[1].practiceTopout) throw new Error('This recording situation cannot start a rescue.');
    const prepared = practice.checkpoint();
    this.scenes.push({ id: crypto.randomUUID(), name, checkpoint: prepared }); this.scenes = this.scenes.slice(-10); localStorage.setItem(scenesKey, JSON.stringify(this.scenes)); this.saved();
    const launch = () => { this.clear(); this.callbacks.start(prepared.settings.quickplay, prepared); this.status('Recording situation loaded into a new Duo practice run. Incoming pressure follows the selected recording; opponents are not reconstructed.'); };
    if (location.hash === '#revive') launch();
    else { window.addEventListener('hashchange', () => { if (location.hash === '#revive') launch(); }, { once: true }); location.hash = 'revive'; }
  }
  private record(attempt: ReviveAttempt) { this.records.push(attempt); this.records = this.records.slice(-2000); try { localStorage.setItem(reviveRecordsKey, JSON.stringify(this.records)); } catch { this.status('Browser storage is full; this attempt is kept for the current page only.'); } this.statistics(); }
  private statistics() {
    const completed = this.records.filter(record => record.result === 'completed').length, topout = this.records.filter(record => record.result === 'topout').length;
    el('revive-stats').textContent = `${completed} completed · ${topout} topouts · ${this.records.length - completed - topout} interrupted · ${this.records.reduce((sum, record) => sum + record.resets, 0)} progress resets`;
    const failures = new Map<string, number>(); for (const record of this.records) if (record.result !== 'completed') failures.set(record.task, (failures.get(record.task) ?? 0) + 1);
    const select = el<HTMLSelectElement>('revive-failure'), selected = select.value; select.replaceChildren(); for (const [task, count] of [...failures].sort((a, b) => b[1] - a[1])) select.add(new Option(`${count} · ${taskLabel(task)}`, task)); if (failures.has(selected)) select.value = selected;
  }
  update(now: number) {
    if (this.active || location.hash === '#quickplay') this.trackedGame = this.callbacks.game();
    this.tracker.update(this.trackedGame?.qp ?? null);
    const game = this.callbacks.game(), qp = game.qp;
    const coaching = this.active || location.hash === '#quickplay' && !!qp?.sides[0].task;
    el('revive-guide').hidden = !coaching;
    if (!coaching) { if (this.source || this.worker) this.clear(); return; }
    el<HTMLButtonElement>('revive-stop').disabled = !game.active;
    const identity = this.identity();
    const progressPose = qp ? JSON.stringify([qp.sides[0].engine.stats.pieces, qp.sides[0].task?.active, qp.sides[0].task?.prompts.map(prompt => prompt.count), qp.sides[0].engine.held]) : '';
    if (qp === this.runtime && progressPose !== this.progressPose) { this.progressPose = progressPose; this.continueRoute(qp!); }
    const holding = qp === this.runtime && qp && identity !== this.observed && this.continuation?.holding(qp.checkpoint());
    if (holding) { this.observed = identity; this.pose = ''; this.hintDue = 0; }
    if (qp !== this.runtime || identity !== this.observed) {
      this.clear(); this.runtime = qp; this.observed = identity; el<HTMLInputElement>('revive-no-gravity').checked = qp?.settings.quickplay.reviveNoGravity ?? this.config.reviveNoGravity;
      if (qp && !qp.over && qp.sides[0].life === 'alive' && qp.sides[0].task?.finishedAt === null) this.search();
      else el('revive-search-status').textContent = qp?.over ? 'Run ended.' : 'Waiting for a rescue task.';
    }
    el<HTMLButtonElement>('revive-search').disabled = !qp?.sides[0].task || !!qp?.over || qp?.sides[0].life !== 'alive';
    if (this.selected && this.source && qp && !qp.over) {
      game.hintTarget = el<HTMLInputElement>('revive-shadow').checked ? this.liveOperation?.target ?? null : null; this.hintGame = game;
      const piece = qp.sides[0].engine.falling, pose = JSON.stringify([piece.x, Math.floor(piece.y), piece.rotation, qp.sides[0].task?.prompts.map(prompt => prompt.count), Math.floor(qp.frame / 30)]);
      if (!this.validating && now >= this.hintDue && pose !== this.pose) {
        this.hintDue = now + 200; this.pose = pose;
        const checkpoint = qp.checkpoint(), worker = new Worker(new URL('./revive-worker.ts', import.meta.url), { type: 'module' }); this.validating = worker;
        worker.onmessage = event => {
          worker.terminate(); if (this.validating !== worker) return; this.validating = null;
          if (this.identity() !== this.observed || !this.selected) return;
          if (!event.data.operation) {
            if (event.data.status === 'BudgetExhausted') { this.pose = ''; el('revive-search-status').textContent = 'Target validation reached its budget. Retrying the retained route.'; return; }
            this.search(); return;
          }
          this.liveOperation = event.data.operation; this.coachSource = checkpoint; this.coachSteps();
        };
        worker.onerror = () => { worker.terminate(); if (this.validating === worker) this.validating = null; };
        worker.postMessage({ checkpoint, validation: { source: this.source, operation: this.continuation?.operation ?? this.selected.operations[0] } });
      }
    }
    const canvas = el<HTMLCanvasElement>('revive-demo-board'), rail = el('qp-guide').getBoundingClientRect();
    const maxHeight = Math.max(120, Math.min(rail.height * .45, window.innerHeight - rail.top - 230));
    canvas.style.height = `${maxHeight}px`; canvas.style.width = `${Math.min(el('revive-detail').clientWidth, maxHeight * canvas.width / canvas.height)}px`;
    const demo = this.demo;
    if (demo) {
      demo.due += Math.max(0, now - demo.last) * .012; demo.last = now;
      for (let count = 0; demo.due >= 1 && count < 60 && !demo.view.completed; count++, demo.due--) demo.view.advance();
      const view = demo.view, side = view.runtime.sides[0], frame = view.frame;
      drawBoard(canvas, side.engine, frame.board, frame.piece, frame.target ?? null, { ...side.settings.display, ghost: !!frame.target && side.settings.display.ghost }, 3, frame.visual);
      el('revive-demo-step').textContent = view.completed ? view.operation.target ? 'This step is complete. The placed piece stays visible.' : 'Input step complete. No placement is required.' : view.operation.label;
      if (view.completed) { demo.ended ??= now; if (now - demo.ended > 1000) this.demonstrate(); }
    }

  }
}
