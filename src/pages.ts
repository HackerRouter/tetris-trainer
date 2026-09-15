import { OpeningTraining } from './opening-training';
import type { TrainerGame } from './game';
import { OpenersPage } from './openers-page';
import { defaultDrillFilter, makeDrillSet, type DrillFilter } from './drills';
import { faultGroups, focusedDrills, HistoryStore, type FaultGroup, type SessionRecord, type TrainerReplay } from './history';
import { buildPlayback, qpPlaybackScene, type Playback } from './playback';
import { drawScene } from './renderer';
import { drawNativePreview } from './ui-assets';
import type { CustomRules, ModeRules } from './modes';
import { readReplay, type ReplayTrack } from './replay';
import { downloadJson, type Settings } from './settings';
import { formatTime } from './time';
import type { PracticeSet } from './practice';
import { PcLab } from './pc-lab';
import { SpinLab } from './spin-lab';
import { QuickPlayPage } from './qp-page';
import { RevivePage } from './revive-page';
import { QpReplayView } from './qp-replay-view';
import type { QpCheckpoint } from './qp-runtime';
import type { QpSettings } from './qp-config';
import { SpinDrillsPage } from './spin-drills-page';
import { SpinReplayPanel } from './spin-replay';
import { analysisContext, type AnalysisContext } from './analysis-context';
import { createEngine } from './engine';
import type { Mino } from '@haelp/teto/engine';

type Callbacks = { quickplay: (active: boolean) => void; startQuickplay: (settings: QpSettings) => void; startRevive: (settings: QpSettings, scene?: QpCheckpoint) => TrainerGame; game: () => TrainerGame; analysis: (context: AnalysisContext) => TrainerGame; freeBuild: (seed: number, rules: CustomRules) => void; sound: (name: string) => void; rules: () => ModeRules; settings: () => Settings; current: () => TrainerReplay | null; pause: () => void; save: () => Promise<unknown>; practice: (set: PracticeSet) => void };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const cell = (text: string | number) => { const td = document.createElement('td'); td.textContent = String(text); return td; };

export class Pages {
  readonly opening: OpeningTraining;
  readonly lab: PcLab;
  readonly spin: SpinLab;
  readonly quickplay: QuickPlayPage;
  readonly revive: RevivePage;
  private openersPage: OpenersPage;
  private sessions: SessionRecord[] = [];
  private groups: FaultGroup[] = [];
  private selected = new Set<string>();
  private tracks: ReplayTrack[] = [];
  private playback: Playback | null = null;
  private spinReplay: SpinReplayPanel;
  private qpReplay: QpReplayView;
  private playing = false;
  private position = 0;
  private last = 0;
  private loading = 0;
  constructor(private history: HistoryStore, private callbacks: Callbacks) {
    this.drills(); this.statistics(); this.replays();
    this.qpReplay = new QpReplayView();
    this.quickplay = new QuickPlayPage({ game: callbacks.game, settings: callbacks.settings, enter: callbacks.quickplay, start: callbacks.startQuickplay });
    this.revive = new RevivePage({ game: callbacks.game, start: callbacks.startRevive });
    this.opening = new OpeningTraining(callbacks);
    this.lab = new PcLab({ game: callbacks.game, start: callbacks.analysis, clearOpening: () => this.opening.clear() });
    this.spin = new SpinLab({ game: callbacks.game, start: callbacks.analysis, clearOpening: () => this.opening.clear() });
    new SpinDrillsPage((ids,rounds)=>this.spin.startDrills(ids,rounds));
    this.spinReplay = new SpinReplayPanel({ state: () => ({ playback: this.playback, track: this.tracks[Number(el<HTMLSelectElement>('player-track').value)], position: this.position }), open: scene => { this.playing = false; this.spin.importScene(scene); }, save: scene => this.spin.saveScene(scene) });
    const pcStatistics = document.createElement('section'); pcStatistics.id = 'pc-statistics'; el('statistics-page').append(pcStatistics);
    const spinStatistics = document.createElement('section'); spinStatistics.id = 'spin-statistics'; el('statistics-page').append(spinStatistics);
    this.openersPage = new OpenersPage({ settings: callbacks.settings, rules: callbacks.rules, random: () => this.opening.startRandom(), single: opener => this.opening.startSingle(opener) });
    window.addEventListener('hashchange', () => this.route());
    document.addEventListener('drop', event => {
      if (this.page !== 'replays' || !event.dataTransfer?.files.length) return;
      if (event.dataTransfer.files.length === 1 && event.dataTransfer.files[0].name.toLowerCase().endsWith('.ttc')) return;
      event.preventDefault(); document.body.classList.remove('file-drag');
      if (event.dataTransfer.files.length !== 1) this.replayStatus('Drop one replay at a time.');
      else void this.loadFile(event.dataTransfer.files[0]);
    });
    this.route();
  }
  get page() { const page = location.hash.slice(1); return ['drills', 'spin-drills', 'openers', 'statistics', 'replays'].includes(page) ? page : 'play'; }
  private route() {
    this.quickplay.setVisible(['#quickplay', '#revive'].includes(location.hash));
    this.revive.setVisible(location.hash === '#revive');
    const hint = document.querySelector('.config-hint');
    if (hint) hint.textContent = this.page === 'replays' ? 'Drop a trainer JSON or TETR.IO replay here. TTC files still open the config importer.' : 'Drop a TETR.IO .ttc config anywhere on this page to import your settings.';
    for (const name of ['play', 'drills', 'spin-drills', 'openers', 'statistics', 'replays']) el(`${name}-page`).hidden = name !== this.page;
    if (['#analysis', '#pc', '#combo'].includes(location.hash)) this.lab.setPage(location.hash === '#combo' ? 'combo' : 'pc');
    this.lab.setVisible(['#analysis', '#pc', '#combo'].includes(location.hash));
    this.spin.setVisible(location.hash === '#spin');
    document.querySelectorAll<HTMLAnchorElement>('.page-nav a').forEach(link => {
      if (link.hash === (this.revive.active ? '#revive' : this.quickplay.active ? '#quickplay' : this.spin.active || this.page === 'spin-drills' ? '#spin' : this.lab.active ? location.hash === '#combo' ? '#combo' : '#pc' : `#${this.page}`)) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    if (this.page !== 'play') { this.opening.suspend(); this.callbacks.pause(); void this.callbacks.save().catch(error => this.notice(error.message)); }
    if (this.page === 'openers') this.openersPage.refresh();
    if (this.page === 'statistics') { void this.refreshHistory(); this.lab.renderStatistics(el('pc-statistics')); this.spin.renderStatistics(el('spin-statistics')); }
    if (this.page !== 'replays') this.playing = false;
  }
  private notice(message: string) { el('statistics-status').textContent = message; }
  private drills() {
    el('drills-page').innerHTML = `<h2 id="drills-title">Pure finesse drills</h2><p class="muted">An empty board and one outlined target at a time, following d-002. Choose what to practice. Perfect finesse controls retries; the target is always required.</p><form id="drill-form"><div class="drill-filters">${[['pieces', 'Pieces', defaultDrillFilter.pieces], ['columns', 'Leftmost column', defaultDrillFilter.columns], ['rotations', 'Target rotations', defaultDrillFilter.rotations]].map(([key, title, values]) => `<fieldset><legend>${title}</legend><div class="chip-options">${(values as (string | number)[]).map(value => `<label><input type="checkbox" name="${key}" value="${value}" checked><span>${key === 'pieces' ? String(value).toUpperCase() : key === 'columns' ? Number(value) + 1 : `${Number(value) * 90}°`}</span></label>`).join('')}</div></fieldset>`).join('')}</div><label class="select-row">Session length<select id="drill-rounds"><option value="0">Endless</option><option value="20">20 placements</option><option value="50">50 placements</option><option value="100">100 placements</option></select></label><p class="muted">Columns refer to the leftmost occupied cell. Symmetric placements are merged. Every selected target appears before the shuffled list repeats. End an endless drill with Finish session.</p><button type="submit">Start finesse drills</button><p id="drill-status" role="status"></p></form>`;
    let saved: DrillFilter = structuredClone(defaultDrillFilter);
    try {
      const candidate = { ...saved, ...JSON.parse(localStorage.getItem('tetrio-trainer-drill-filter') || '{}') };
      if (['pieces', 'columns', 'rotations'].every(key => Array.isArray(candidate[key]))) saved = candidate;
    } catch {}
    for (const name of ['pieces', 'columns', 'rotations'] as const) el('drill-form').querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach(input => { input.checked = (saved[name] as (string | number)[]).includes(name === 'pieces' ? input.value : Number(input.value)); });
    el<HTMLSelectElement>('drill-rounds').value = String(saved.rounds);
    el('drill-form').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const data = new FormData(el<HTMLFormElement>('drill-form'));
        const filter = { pieces: data.getAll('pieces').map(String), columns: data.getAll('columns').map(Number), rotations: data.getAll('rotations').map(Number), rounds: Number(el<HTMLSelectElement>('drill-rounds').value) };
        const set = makeDrillSet(this.callbacks.settings(), filter);
        localStorage.setItem('tetrio-trainer-drill-filter', JSON.stringify(filter)); this.beginPractice(set);
      } catch (error) { el('drill-status').textContent = (error as Error).message; }
    });
  }
  private beginPractice(set: PracticeSet) { this.lab.clear(); this.opening.clear(); el('opener-references').hidden = true; location.hash = 'play'; this.callbacks.practice(set); }
  private statistics() {
    el('statistics-page').innerHTML = `<h2 id="statistics-title">Finesse statistics</h2><p class="muted">History is stored only in this browser. Sessions include unfinished games; use the filters to compare like sessions. Every inefficient attempt counts, including retries and mistakes recorded with checking off.</p><div class="page-toolbar"><label>Mode<select id="stats-mode"><option value="">All modes</option><option value="40l-finesse">40L Sprint</option><option value="custom">Custom</option><option value="fault-practice">Drills / fault practice</option></select></label><label>Status<select id="stats-state"><option value="">All sessions</option><option value="complete">Completed</option><option value="topout">Top outs</option></select></label><button id="stats-refresh" class="secondary">Refresh</button><button id="history-export" class="secondary">Export history backup</button><button id="history-import" class="secondary">Import history backup</button><input id="history-file" type="file" accept=".json" hidden></div><p id="statistics-status" role="status"></p><div id="history-summary" class="summary-cards"></div><h3>Most frequent faults</h3><p class="muted">Grouped by piece, target column / shape and rotation system. Repeated retries remain separate attempts. Empty-board drills train placement habits; enable original boards for stack-dependent tucks and spins.</p><div class="page-toolbar"><button id="fault-top" class="secondary">Select top 5</button><button id="fault-none" class="secondary">Clear selection</button><label class="check-row"><input id="fault-original" type="checkbox">Use original boards</label><button id="train-faults" disabled>Practice selected faults</button><span id="fault-selection" role="status">0 selected</span></div><div class="table-scroll"><table><thead><tr><th>Select</th><th>Rank</th><th>Placement</th><th>Faults</th><th>Extra inputs</th><th>Frequency</th></tr></thead><tbody id="fault-rows"></tbody></table></div><h3>Sessions</h3><div class="table-scroll"><table><thead><tr><th>Date / mode</th><th>Status</th><th>Attempts</th><th>Faults</th><th>Perfect %</th><th>Time</th><th>Actions</th></tr></thead><tbody id="session-rows"></tbody></table></div><p class="muted">Perfect % uses verified attempts. Unknown paths and target-only mistakes are excluded. Backups contain full recordings; keep one before clearing browser data.</p>`;
    el('stats-refresh').addEventListener('click', () => void this.refreshHistory());
    for (const id of ['stats-mode', 'stats-state']) el(id).addEventListener('change', () => this.renderHistory());
    el('fault-top').addEventListener('click', () => { this.selected = new Set(this.groups.slice(0, 5).map(group => group.key)); this.renderHistory(); });
    el('fault-none').addEventListener('click', () => { this.selected.clear(); this.renderHistory(); });
    el('train-faults').addEventListener('click', () => {
      try { this.beginPractice(focusedDrills(this.groups.filter(group => this.selected.has(group.key)), this.callbacks.settings(), el<HTMLInputElement>('fault-original').checked)); }
      catch (error) { this.notice((error as Error).message); }
    });
    el('history-export').addEventListener('click', () => downloadJson({ format: 'tetrio-trainer-history', version: 1, replays: this.sessions.map(session => session.replay) }, `trainer-history-${Date.now()}.json`));
    el('history-import').addEventListener('click', () => el<HTMLInputElement>('history-file').click());
    el('history-file').addEventListener('change', async () => {
      const input = el<HTMLInputElement>('history-file'), file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 100_000_000) throw new Error('History backups must be smaller than 100 MB.');
        const backup = JSON.parse(await file.text());
        if (backup.format !== 'tetrio-trainer-history' || backup.version !== 1 || !Array.isArray(backup.replays) || backup.replays.length > 2000) throw new Error('Choose a version 1 trainer history backup.');
        for (const replay of backup.replays) if (readReplay(replay, 'Backup')[0].kind !== 'trainer') throw new Error('Backup contains an unsupported recording.');
        await this.history.import(backup.replays);
        await this.refreshHistory(); this.notice(`${backup.replays.length} sessions imported. Existing session IDs were updated without duplication.`);
      } catch (error) { this.notice((error as Error).message); } finally { input.value = ''; }
    });
  }
  private async refreshHistory() {
    try { this.notice('Loading local history…'); await this.callbacks.save(); this.sessions = await this.history.all(); this.renderHistory(); this.notice(this.sessions.length ? '' : 'No sessions yet. Place a piece, then return here.'); }
    catch (error) { this.notice((error as Error).message); }
  }
  private renderHistory() {
    const mode = el<HTMLSelectElement>('stats-mode').value, state = el<HTMLSelectElement>('stats-state').value;
    const sessions = this.sessions.filter(session => (!mode || session.mode === mode) && (!state || session.status === state));
    this.groups = faultGroups(sessions);
    this.selected = new Set([...this.selected].filter(key => this.groups.some(group => group.key === key)));
    const sum = (key: 'verified' | 'perfect' | 'extra') => sessions.reduce((sum, session) => sum + session[key], 0);
    const faults = sessions.reduce((sum, session) => sum + session.faults.length, 0);
    el('history-summary').replaceChildren(...[['Sessions', sessions.length], ['Faults / session', (faults / Math.max(1, sessions.length)).toFixed(2)], ['Perfect attempts', `${(100 * sum('perfect') / Math.max(1, sum('verified'))).toFixed(1)}%`], ['Extra inputs / session', (sum('extra') / Math.max(1, sessions.length)).toFixed(2)]].map(([label, value]) => { const div = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = String(value); div.append(String(label), strong); return div; }));
    el('fault-rows').replaceChildren(...this.groups.map((group, i) => {
      const row = document.createElement('tr'), select = cell(''), input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.selected.has(group.key); input.setAttribute('aria-label', `Select ${group.label}`);
      input.addEventListener('change', () => { if (input.checked) this.selected.add(group.key); else this.selected.delete(group.key); this.selection(); }); select.append(input);
      const frequency = cell(`${(100 * group.count / Math.max(1, faults)).toFixed(1)}%`), bar = document.createElement('progress'); bar.max = Math.max(1, this.groups[0].count); bar.value = group.count; bar.setAttribute('aria-label', `${group.count} faults`); frequency.append(bar);
      row.append(select, cell(i + 1), cell(group.label), cell(group.count), cell(group.extra), frequency); return row;
    }));
    if (!this.groups.length) { const row = document.createElement('tr'), td = cell('No finesse faults in these sessions.'); td.colSpan = 6; row.append(td); el('fault-rows').append(row); }
    el('session-rows').replaceChildren(...sessions.map(session => {
      const row = document.createElement('tr'), actions = cell('');
      const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.className = 'secondary small'; b.textContent = label; b.addEventListener('click', action); actions.append(b); };
      button('Watch', () => { location.hash = 'replays'; void this.loadTracks(readReplay(session.replay, session.date)); });
      button('JSON', () => downloadJson(session.replay, `trainer-${session.date.replaceAll(':', '-')}.json`));
      button('Delete', () => { if (window.confirm('Delete this saved session? Export a history backup first if you want to keep it.')) void this.history.remove(session.id).then(() => { this.sessions = this.sessions.filter(item => item.id !== session.id); this.renderHistory(); }); });
      row.append(cell(`${new Date(session.date).toLocaleString()} · ${session.replay.practice?.kind ?? session.mode}`), cell(session.status), cell(session.attempts), cell(session.faults.length), cell(`${(100 * session.perfect / Math.max(1, session.verified)).toFixed(1)}%`), cell(formatTime(session.replay.result.timeMs)), actions); return row;
    }));
    this.selection();
  }
  private selection() { el<HTMLButtonElement>('train-faults').disabled = !this.selected.size; el('fault-selection').textContent = `${this.selected.size} selected`; }
  private replays() {
    el('replays-page').innerHTML = `<div class="page-title"><div><span class="eyebrow">RECORDINGS</span><h2 id="replays-title">Replay player</h2></div><p class="muted">Drop a trainer JSON, TETR.IO .ttr or .ttrm recording here.</p></div><div class="replay-workspace"><aside class="workspace-panel replay-library" aria-label="Replay selection"><h3>Choose a recording</h3><button id="player-import" class="wide">Open replay</button><button id="player-current" class="secondary wide">Watch current / last session</button><input id="player-file" type="file" accept=".json,.ttr,.ttrm" hidden><label class="select-row">Player / round<select id="player-track" disabled></select></label><p id="player-status" role="status" class="muted"></p><p id="player-title" class="muted"></p><p class="muted">Playback uses recorded time. Thinking and manual pauses add no waiting time.</p><a href="#statistics">Watch a saved session</a></aside><div id="player-content" class="replay-layout" hidden><section class="replay-board-area"><div id="player-tetrion"></div><div class="playback-transport"><div class="page-toolbar"><button id="player-play">Play</button><button id="player-back" class="secondary" aria-label="Previous frame">−1 frame</button><button id="player-forward" class="secondary" aria-label="Next frame">+1 frame</button><label>Speed<select id="player-speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div><label for="player-seek" class="visually-hidden">Position</label><input id="player-seek" type="range" min="0" max="0" step="any" value="0"><p id="player-time"></p></div></section><aside class="workspace-panel player-controls" aria-label="Replay details"><span class="eyebrow">RECORDED SESSION</span><h3 id="player-mode"></h3><div class="stats"><div>Inputs<strong id="player-inputs">0</strong></div><div>Holds<strong id="player-holds">0</strong></div><div>Training faults<strong id="player-faults">0</strong></div><div>Perfect placements<strong id="player-perfects">0</strong></div></div><p id="player-event" role="status" class="muted"></p><label class="check-row"><input id="player-audio" type="checkbox" checked>Replay sound effects</label><details><summary>Recording details</summary><p id="player-info"></p><p class="muted">Seek using the slider, or inspect one frame at a time. Training fault totals include removed attempts.</p></details></aside></div><div id="player-empty" class="workspace-panel"><h3>Your recording appears here</h3><p class="muted">Choose a file on the left, or watch the current session.</p></div></div>`;
    const tetrion = document.querySelector('#play-page .tetrion')!.cloneNode(true) as HTMLElement;
    tetrion.querySelectorAll<HTMLElement>('[id]').forEach(node => { node.id = node.id === 'time' ? 'player-clock' : `player-${node.id}`; });
    tetrion.querySelector('#player-board-overlay')!.remove();
    el('player-tetrion').append(tetrion);
    const analyze = document.createElement('button'); analyze.id = 'player-analyze'; analyze.className = 'secondary wide'; analyze.textContent = 'Analyze this frame for PC';
    el('player-info').parentElement!.before(analyze);
    const revive = document.createElement('button'); revive.id = 'player-revive'; revive.className = 'secondary wide'; revive.textContent = 'Practice Revive from this frame'; revive.hidden = true; analyze.before(revive);
    revive.onclick = () => {
      if (!this.playback) return;
      try { this.playing = false; this.revive.fromRecording(qpPlaybackScene(this.playback, this.position), `${this.playback.name} · ${(this.position).toFixed(2)} s`); }
      catch (error) { this.replayStatus((error as Error).message); }
    };
    analyze.addEventListener('click', () => {
      const playback = this.playback; if (!playback) return;
      try {
        this.playing = false;
        let index = 0;
        while (index + 1 < playback.frames.length && playback.frames[index + 1].time <= this.position) index++;
        const frame = playback.frames[index];
        if (!frame.piece || frame.analysis.unavailable) throw new Error('Choose a frame with a controllable active piece.');
        const engine = createEngine(playback.settings, 1, playback.rules), snapshot = engine.snapshot({ isUndoRedo: true });
        Object.assign(snapshot, { board: structuredClone(frame.board), falling: structuredClone(frame.piece), hold: frame.hold as Mino | null, holdLocked: frame.holdLocked, stats: structuredClone(frame.analysis.stats), lastSpin: frame.analysis.lastSpin, lastWasClear: frame.analysis.lastWasClear });
        snapshot.queue.value = [...frame.next] as Mino[]; snapshot._queue.value = [...snapshot.queue.value];
        if (frame.analysis.pendingGarbage) throw new Error('This replay frame has pending garbage. Stable boards only.');
        this.lab.importScene({ id: crypto.randomUUID(), name: `${playback.name} · frame ${Math.round(frame.time * 60)}`, source: `Replay frame ${Math.round(frame.time * 60)} (${frame.time.toFixed(3)} s); visible Next; bag remainder unknown`, context: analysisContext(playback.rules, playback.settings, snapshot), future: false, finiteQueue: true });
      } catch (error) { this.replayStatus((error as Error).message); }
    });
    el('player-import').addEventListener('click', () => el<HTMLInputElement>('player-file').click());
    el('player-file').addEventListener('change', () => { const file = el<HTMLInputElement>('player-file').files?.[0]; if (file) void this.loadFile(file); el<HTMLInputElement>('player-file').value = ''; });
    el('player-current').addEventListener('click', () => {
      try { const replay = this.callbacks.current() ?? JSON.parse(localStorage.getItem('tetrio-trainer-last-replay') || 'null'); if (!replay) throw new Error('No recording yet. Play a session or open a replay file.'); void this.loadTracks(readReplay(replay, 'Your session')); }
      catch (error) { this.replayStatus((error as Error).message); }
    });
    el('player-track').addEventListener('change', () => void this.openTrack(this.tracks[Number(el<HTMLSelectElement>('player-track').value)]));
    el('player-play').addEventListener('click', () => { if (!this.playback) return; this.effectTail = null; if (this.position >= this.playback.duration) this.position = 0; this.playing = !this.playing; this.last = performance.now(); });
    el('player-seek').addEventListener('input', () => { this.playing = false; this.effectTail = null; const value = Number(el<HTMLInputElement>('player-seek').value), end = this.playback?.duration ?? 0; this.position = Math.abs(value - end) < 1e-7 ? end : value; this.drawPlayback(); });
    for (const [id, direction] of [['player-back', -1], ['player-forward', 1]] as const) el(id).addEventListener('click', () => { this.playing = false; this.effectTail = null; this.position = Math.max(0, Math.min(this.playback?.duration ?? 0, this.position + direction / 60)); this.drawPlayback(); });
  }
  private replayStatus(message: string) { el('player-status').textContent = message; }
  private async loadFile(file: File) {
    try { if (file.size > 20_000_000) throw new Error('Replay files must be smaller than 20 MB.'); await this.loadTracks(readReplay(JSON.parse(await file.text()), file.name)); }
    catch (error) { this.replayStatus((error as Error).message); }
  }
  private async loadTracks(tracks: ReplayTrack[]) { this.tracks = tracks; el<HTMLSelectElement>('player-track').replaceChildren(...tracks.map((track, i) => new Option(track.name, String(i)))); el<HTMLSelectElement>('player-track').disabled = tracks.length < 2; await this.openTrack(tracks[0]); }
  private async openTrack(track: ReplayTrack) {
    const token = ++this.loading; this.playing = false; this.replayStatus('Preparing replay…');
    try {
      const playback = await buildPlayback(track, this.callbacks.settings(), text => { if (token !== this.loading) throw new Error('Playback loading canceled.'); this.replayStatus(text); });
      if (token !== this.loading) return;
      this.playback = playback; this.position = 0; this.effectTail = null;
      el('player-revive').hidden = !playback.qpScenes?.length;
      el('player-analyze').hidden = playback.rules.id === 'zenith';
      el('player-spin').hidden = playback.rules.id === 'zenith';
      el('player-mode').textContent = playback.modeName;
      el('player-hold-panel').hidden = !playback.rules.hold; el('player-next-panel').hidden = !playback.rules.nextCount;
      el<HTMLCanvasElement>('player-next-preview').height = Math.max(1, playback.rules.nextCount) * 90;
      el('player-line-goal').textContent = playback.rules.goals.lines ? `/ ${playback.rules.goals.lines}` : '';
      el('player-faults').textContent = String(playback.trainingFaults);
      el('player-faults').parentElement!.title = 'All original training faults remain in Statistics. Removed attempts are not replayed.';
      const tetrion = el('player-tetrion').firstElementChild as HTMLElement;
      tetrion.style.gridTemplateColumns = `minmax(0,5fr) minmax(0,${playback.engine.board.width}fr) minmax(0,5fr)`;
      tetrion.style.setProperty('--tetrion-columns', String(playback.engine.board.width + 10)); tetrion.style.setProperty('--board-rows', String(playback.engine.board.height + 3));
      el('player-content').hidden = false; el('player-empty').hidden = true; el('player-title').textContent = track.name;
      el<HTMLInputElement>('player-seek').max = String(playback.duration);
      const canvas = el<HTMLCanvasElement>('player-board'); canvas.width = playback.engine.board.width * 30; canvas.height = (playback.engine.board.height + 3) * 30;
      this.replayStatus('Ready.'); this.drawPlayback();
    } catch (error) { if (token === this.loading) this.replayStatus((error as Error).message); }
  }
  update(now: number) {
    this.revive.update(now);
    this.spinReplay.update(this.playback, this.page === 'replays');
    if (this.page === 'play') { if (this.quickplay.active) this.quickplay.update(); else if (this.spin.active) this.spin.update(); else if (this.lab.active) this.lab.update(); else this.opening.update(this.callbacks.game()); }
    if (this.page !== 'replays' || !this.playback) return;
    const before = this.position;
    if (this.playing) { this.position = Math.min(this.playback.duration, this.position + Math.min(200, now - this.last) / 1000 * Number(el<HTMLSelectElement>('player-speed').value)); if (this.position >= this.playback.duration) { this.playing = false; this.effectTail = now; } }
    if (el<HTMLInputElement>('player-audio').checked && this.position > before) {
      const names = new Set<string>();
      const frames = this.playback.frames;
      let lo = 0, hi = frames.length;
      while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (frames[mid].time <= before) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < frames.length && frames[i].time <= this.position; i++) for (const name of frames[i].sounds) names.add(name);
      for (const name of names) this.callbacks.sound(name);
    }
    this.last = now; this.drawPlayback();
  }
  private effectTail: number | null = null;
  private drawPlayback() {
    const replay = this.playback; if (!replay) return;
    let lo = 0, hi = replay.frames.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (replay.frames[mid].time <= this.position) lo = mid; else hi = mid - 1; }
    const frame = replay.frames[lo];
    this.qpReplay.update(replay, frame);
    const visualTime = this.position + (this.effectTail === null ? 0 : Math.max(0, performance.now() - this.effectTail) / 1000);
    drawScene(el<HTMLCanvasElement>('player-board'), el<HTMLCanvasElement>('player-hold-preview'), el<HTMLCanvasElement>('player-next-preview'), replay.engine, replay.rules, replay.settings.display, { ...frame, visual: frame.qp?.visual, actions: frame.actionEffects.map(action => ({ action, age: (visualTime - action.frame / 60) * 1000 })) }, (visualTime - frame.effectTime) * 1000);
    drawNativePreview(el<HTMLCanvasElement>('player-hold-frame'), 'hold'); drawNativePreview(el<HTMLCanvasElement>('player-next-frame'), 'next');
    el('player-clock').textContent = formatTime(this.position * 1000);
    el('player-pieces').textContent = String(frame.pieces); el('player-lines').textContent = String(frame.lines);
    el('player-pps').textContent = this.position ? (frame.pieces / this.position).toFixed(2) : '0.00';
    el('player-inputs').textContent = String(frame.inputs); el('player-holds').textContent = String(frame.holds); el('player-perfects').textContent = String(frame.perfects);
    el('player-play').textContent = this.playing ? 'Pause' : 'Play'; el<HTMLInputElement>('player-seek').value = String(this.position);
    el('player-time').textContent = `${formatTime(this.position * 1000)} / ${formatTime(replay.duration * 1000)}`;
    el('player-info').textContent = `Pieces: ${frame.pieces} · Lines: ${frame.lines} · Hold: ${frame.hold?.toUpperCase() ?? '—'} · Next: ${frame.next.join(' ').toUpperCase()}`;
    el('player-event').textContent = frame.label;
  }
}
