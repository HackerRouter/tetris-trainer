import './style.css';
import './workspace.css';
import './qp.css';
import { TrainerGame } from './game';
import { QuickPlayClock } from './qp-clock';
import { QpBotPool } from './qp-bot-controller';
import { loadRevivePreferences } from './revive-practice';
import type { QpCheckpoint } from './qp-runtime';
import './revive.css';
import { drawGame } from './renderer';
import { SettingsPanel } from './settings-panel';
import { actions, bindingCodes, bindingLabel, downloadJson, loadSettings, storageKey, type Action } from './settings';
import { formatTime } from './time';
import { DemoPanel } from './demo';
import { PracticeGuide } from './practice-guide';
import { loadPractice, readReplay, type ReplayTrack } from './replay';
import type { PracticeSet } from './practice';
import { placementSteps } from './guide';
import { CustomPanel } from './custom-panel';
import { modeDefinitions, type CustomRules, type ModeId } from './modes';
import { SoundPlayer } from './audio';
import { drawNativePreview } from './ui-assets';
import { HistoryStore } from './history';
import { Pages } from './pages';
import { exportNative } from './native-export';
import { customRulesFromMode } from './analysis-context';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const canvas = element<HTMLCanvasElement>('board');
const holdCanvas = element<HTMLCanvasElement>('hold-preview'), nextCanvas = element<HTMLCanvasElement>('next-preview');
const demo = new DemoPanel();
const practiceGuide = new PracticeGuide();
const loaded = loadSettings(localStorage);
let settings = loaded.settings;
let selectedMode: ModeId = localStorage.getItem('tetrio-trainer-mode') === 'custom' ? 'custom' : 'sprint';
let modePending = false;
let game = new TrainerGame(settings, undefined, undefined, selectedMode);
let analysisRules = game.rules;
let qpSession: TrainerGame | null = null;
let reviveSession: TrainerGame | null = null;
let qpRoute: string | null = null;
let previousSession: TrainerGame | null = null;
const qpClock = new QuickPlayClock();
const qpBots = new QpBotPool();
function quickplayPage(active: boolean) {
  const destination = active ? location.hash : null;
  if (destination === qpRoute) return;
  game.pause(); saveReplay(); pressed.clear(); accumulator = 0;
  if (qpRoute === '#quickplay') qpSession = game;
  if (qpRoute === '#revive') reviveSession = game;
  if (active) {
    if (!qpRoute) previousSession = game;
    game = destination === '#revive' ? reviveSession ?? new TrainerGame({ ...settings, quickplay: loadRevivePreferences(localStorage) }, undefined, undefined, 'zenith') : qpSession ?? new TrainerGame(settings, undefined, undefined, 'zenith');
  } else if (previousSession) { game = previousSession; previousSession = null; }
  qpRoute = destination;
  game.fault = null; game.demonstration = null;
}

let freeSession: { seed: number; rules: CustomRules } | undefined;
const sound = new SoundPlayer(settings.audio);
const history = new HistoryStore();
let lastHistorySave = 0, historyPlacements = 0;
let accumulator = 0, last = performance.now(), resumeAfterSettings = false, saved = false;
const pressed = new Map<string, Action>();
const message = element('message');
let tracks: ReplayTrack[] = [], importing = false;
let lastReplay: unknown = null;
try { lastReplay = JSON.parse(localStorage.getItem('tetrio-trainer-last-replay') || 'null'); } catch {}
const toolsDialog = element<HTMLDialogElement>('tools-dialog');
let resumeAfterTools: TrainerGame | null = null;
let statusBeforeTools: TrainerGame['status'] | null = null;

function finishTools() {
  const previous = resumeAfterTools; resumeAfterTools = null; statusBeforeTools = null;
  if (previous === game && pages.page === 'play' && !panel.open && !customPanel.open) game.resume();
  accumulator = 0; last = performance.now();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
function closeTools() { toolsDialog.close(); finishTools(); }
element('tools-open').addEventListener('click', () => {
  resumeAfterTools = game.active ? game : null;
  statusBeforeTools = game.status;
  game.pause(); pressed.clear(); toolsDialog.showModal();
});
element('tools-close').addEventListener('click', closeTools);
toolsDialog.addEventListener('close', finishTools);
window.addEventListener('hashchange', () => { if (toolsDialog.open) closeTools(); });

const panel = new SettingsPanel(next => {
  localStorage.setItem(storageKey, JSON.stringify(next));
  settings = next;
  if (game.settings.training.thinkStyle !== next.training.thinkStyle) game.setJustThink(game.settings.training.justThink, next.training.thinkStyle);
  if (game.practice?.set.kind === 'opener' || game.rules.id === 'sprint') { game.rules.undo = next.training.undoEnabled; game.settings.training.undoEnabled = next.training.undoEnabled; }
  sound.configure(settings.audio);
  message.textContent = 'Settings saved. Start a new game to apply them.';
  if (game.status === 'ready') game = new TrainerGame(settings, game.seed, undefined, game.rules.id === 'zenith' ? 'zenith' : selectedMode);
}, () => {
  sound.configure(settings.audio);
  last = performance.now(); accumulator = 0;
  if (resumeAfterSettings) game.resume();
  resumeAfterSettings = false;
});

let resumeAfterCustom = false;
const customPanel = new CustomPanel(rules => {
  pages.opening.clear();
  settings = { ...settings, custom: rules };
  localStorage.setItem(storageKey, JSON.stringify(settings));
  selectMode('custom');
}, saved => {
  accumulator = 0; last = performance.now();
  if (saved) start(); else if (resumeAfterCustom) game.resume();
  resumeAfterCustom = false;
});

function selectMode(mode: ModeId) {
  modePending = !!game.practice || !!freeSession || mode !== game.rules.id;
  selectedMode = mode;
  element<HTMLSelectElement>('mode-select').value = mode;
  localStorage.setItem('tetrio-trainer-mode', mode);
  if (game.status === 'ready') game = new TrainerGame(settings, undefined, undefined, mode);
}
element<HTMLSelectElement>('mode-select').value = selectedMode;
element('mode-select').addEventListener('change', () => {
  pages.lab.clear(); pages.spin.clear();
  pages.opening.clear();
  selectMode(element<HTMLSelectElement>('mode-select').value as ModeId);
  message.textContent = selectedMode === 'custom' ? 'Adjust Custom rules, then start a session.' : 'Start a new 40-line sprint.';
  element('mode-select').blur();
});
element('custom-open').addEventListener('click', () => {
  if (panel.open || customPanel.open) return;
  resumeAfterCustom = game.active; game.pause(); pressed.clear(); customPanel.show(settings.custom);
});
element('clear-field').addEventListener('click', () => {
  if (game.clearField()) { pressed.clear(); message.textContent = 'Board cleared. Queue and session totals kept.'; }
  element('clear-field').blur();
});
element('finish-session').addEventListener('click', () => { game.finish(); pressed.clear(); element('finish-session').blur(); });
element('finesse-toggle').addEventListener('change', () => {
  if (game.qp) return;
  const enabled = element<HTMLInputElement>('finesse-toggle').checked;
  game.setFinesseEnabled(enabled); pages.opening.finesse(enabled); if (freeSession) freeSession.rules.finesse = enabled; pressed.clear();
  if (!pages.opening.active) {
    if (game.practice) settings.training.practiceFinesseEnabled = enabled;
    else if (game.rules.id === 'custom') settings.custom.finesse = enabled;
    else settings.training.finesseEnabled = enabled;
  }
  localStorage.setItem(storageKey, JSON.stringify(settings));
  message.textContent = enabled ? 'Perfect finesse enabled for this mode. Faults restore the placement and timer.' : `Finesse retries disabled for this mode.${game.practice ? ' Match each scene target to advance.' : ' Placements are accepted without a finesse check.'}`;
  element('finesse-toggle').blur();
});
element<HTMLInputElement>('think-toggle').checked = settings.training.justThink;
function changeThinking() {
  if (game.qp) return;
  const enabled = element<HTMLInputElement>('think-toggle').checked, style = settings.training.thinkStyle;
  game.setJustThink(enabled, style); pressed.clear(); accumulator = 0;
  settings.training.justThink = enabled; settings.training.thinkStyle = style;
  localStorage.setItem(storageKey, JSON.stringify(settings));
  element('think-help').textContent = style === 'piece' ? 'Each piece waits for a fresh game input, then runs normally until placed.' : 'The board and timer advance on game input and while a game key is held. Release all keys to think.';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
element('think-toggle').addEventListener('change', changeThinking);
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
document.addEventListener('keydown', () => sound.unlock(), { capture: true });
document.addEventListener('click', event => {
  if ((event.target as HTMLElement)?.closest('button:not(:disabled)') && !(event.target as HTMLElement).closest('#audio-preview, #pause')) sound.play('menuclick', true);
});
element('audio-preview').addEventListener('click', () => {
  sound.configure({ enabled: element<HTMLInputElement>('audio-enabled').checked, volume: Number(element<HTMLInputElement>('audio-volume').value) / 100, ui: true });
  sound.play('clearquad');
});

function openSettings() {
  if (panel.open || customPanel.open) return;
  resumeAfterSettings = game.active;
  game.pause(); pressed.clear(); panel.show(settings);
}
element('settings-open').addEventListener('click', openSettings);
element('config-open').addEventListener('click', () => { closeTools(); openSettings(); panel.chooseFile(); });
document.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('file-drag');
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('file-drag'); });
document.addEventListener('dragend', () => document.body.classList.remove('file-drag'));
document.addEventListener('drop', event => {
  if (location.hash === '#replays' && !event.dataTransfer?.files[0]?.name.toLowerCase().endsWith('.ttc')) return;
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault(); document.body.classList.remove('file-drag');
  if (importing) { message.textContent = 'Wait for replay analysis to finish before importing settings.'; return; }
  if (toolsDialog.open) closeTools();
  openSettings();
  if (event.dataTransfer.files.length !== 1) { panel.importError('Drop one settings file at a time.'); return; }
  void panel.importFile(event.dataTransfer.files[0]);
});

function saveReplay() {
  if (!game.startedAt) return;
  void saveHistory();
  if (game.practice) return;
  lastReplay = game.export();
  try { localStorage.setItem('tetrio-trainer-last-replay', JSON.stringify(lastReplay)); }
  catch { message.textContent = 'Local replay storage is full. Use Download replay to save this session.'; }
}

async function saveHistory() {
  if (!game.startedAt || !game.placements.length) return;
  try { await history.save(structuredClone(game.export())); }
  catch (error) { message.textContent = (error as Error).message; }
}

function start(practice?: PracticeSet, session?: { seed: number; rules: CustomRules }, sourceSettings = location.hash === '#revive' ? { ...settings, quickplay: loadRevivePreferences(localStorage) } : settings, reviveScene?: QpCheckpoint) {
  if (panel.open || customPanel.open) return;
  const heldCodes = [...pressed.keys()];
  saveReplay();
  if (practice || modePending) freeSession = undefined;
  if (session) freeSession = session;
  if (modePending) element('opener-references').hidden = true;
  const qp = ['#quickplay', '#revive'].includes(location.hash) && !practice;
  game = new TrainerGame(!qp && freeSession ? { ...sourceSettings, custom: freeSession.rules } : sourceSettings, qp ? reviveScene?.seed : freeSession?.seed, practice, qp ? 'zenith' : freeSession ? 'custom' : selectedMode);
  if (reviveScene) game.initializeReviveScene(reviveScene);
  if (qp) { if (location.hash === '#revive') reviveSession = game; else qpSession = game; }
  if (freeSession && !qp) game.rules.name = 'OPENER FREE BUILD';
  if (!practice) analysisRules = game.rules;
  game.start(); qpClock.start(game, performance.now()); sound.sync(game);
  modePending = false;
  accumulator = 0; last = performance.now(); pressed.clear(); saved = false;
  historyPlacements = 0;
  for (const code of heldCodes) {
    const action = (['moveLeft', 'moveRight'] as const).find(action => bindingCodes(game.settings, action).includes(code));
    if (action) { pressed.set(code, action); game.input.press(action); }
  }
  message.textContent = qp ? 'Climb, cancel incoming attacks and complete revive tasks. All accepted inputs advance the run.' : practice ? `Match every outlined target${game.rules.finesse ? ' with perfect finesse' : ''}.` : game.rules.id === 'custom' ? 'Custom session started. Use Clear board to reset the field, or Finish session to save a result.' : 'Clear 40 lines. Fault retries also restore the timer.';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function pause() {
  if (game.qp) return;
  const before = game.status;
  if (game.active) { game.pause(); pressed.clear(); }
  else if (game.status === 'paused') game.resume();
  if (game.status !== before) sound.play('menuclick', true);
  accumulator = 0; last = performance.now();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function beginCurrentGame() {
  if (game.status !== 'ready' || panel.open || customPanel.open || importing) return;
  modePending = false;
  game.start(); qpClock.start(game, performance.now()); sound.sync(game); analysisRules = game.rules;
  accumulator = 0; last = performance.now(); saved = false; historyPlacements = 0;
  for (const action of pressed.values()) if (action === 'moveLeft' || action === 'moveRight') game.input.press(action);
  message.textContent = 'Game started with the current seed and queue.';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
function restartGame() { if (game.qp) { if (game.status === 'ready') beginCurrentGame(); else start(); return; } if (game.status === 'ready') { beginCurrentGame(); return; } if (pages.spin.active) { pages.spin.clear(); pages.lab.clear(); pages.opening.clear(); freeSession=undefined; start(); return; } if (!modePending && pages.lab.restart()) return; if (!modePending && pages.opening.restart()) return; pages.lab.clear(); pages.spin.clear(); pages.opening.clear(); start(modePending ? undefined : game.practice?.set); }
element('start').addEventListener('click', restartGame);
element('pause').addEventListener('click', pause);
canvas.addEventListener('click', event => {
  if (event.button !== 0 || panel.open || customPanel.open || importing) return;
  if (game.status === 'ready') beginCurrentGame(); else if (game.status === 'paused') pause();
});
element('sprint').addEventListener('click', () => { pages.opening.clear(); selectMode('sprint'); start(); });
function currentRecording() {
  const recording = game.export();
  if (resumeAfterTools === game && statusBeforeTools && recording.status === 'paused') recording.status = statusBeforeTools;
  return recording;
}
element('download').addEventListener('click', () => { if (game.startedAt) downloadJson(currentRecording(), `${game.rules.id}-training-${Date.now()}.json`); element('download').blur(); });
let exporting = false;
element('download-native').addEventListener('click', async () => {
  if (exporting) return;
  exporting = true; const button = element<HTMLButtonElement>('download-native'); button.disabled = true;
  element('export-status').textContent = 'Verifying the effective recording...';
  try { const replay = await exportNative(structuredClone(currentRecording())); downloadJson(replay, `trainer-${Date.now()}.ttr`); element('export-status').textContent = message.textContent = 'TETR.IO replay exported and verified locally. Retried and undone attempts were removed; JSON keeps the full training history.'; }
  catch (error) { element('export-status').textContent = message.textContent = (error as Error).message; }
  finally { exporting = false; button.disabled = false; button.blur(); }
});
element('convert-replay').addEventListener('click', () => element<HTMLInputElement>('convert-replay-file').click());
element('convert-replay-file').addEventListener('change', async () => {
  const input = element<HTMLInputElement>('convert-replay-file'), file = input.files?.[0]; if (!file) return;
  input.value = ''; const button = element<HTMLButtonElement>('convert-replay'); button.disabled = true;
  element('conversion-status').textContent = 'Reading and verifying replay...';
  try {
    if (file.size > 20000000) throw new Error('Replay files must be smaller than 20 MB.');
    const track = readReplay(JSON.parse(await file.text()), file.name)[0];
    if (track.kind !== 'trainer') throw new Error('This is already a native recording. Choose a trainer JSON for conversion.');
    const native = await exportNative(track.data as ReturnType<TrainerGame['export']>);
    downloadJson(native, `${file.name.replace(/\.json$/i, '')}.ttr`);
    element('conversion-status').textContent = 'Converted and verified. The original recording was not changed.';
  } catch (error) { element('conversion-status').textContent = (error as Error).message; }
  finally { button.disabled = false; }
});

function undo() { if (game.undo()) { pressed.clear(); accumulator = 0; last = performance.now(); saved = false; message.textContent = 'Placement and timer restored.'; } }
element('undo').addEventListener('click', () => { undo(); element('undo').blur(); });
function redo() { if (game.redo()) { pressed.clear(); accumulator = 0; last = performance.now(); saved = false; message.textContent = 'Placement and timer redone.'; } }
element('redo').addEventListener('click', () => { redo(); element('redo').blur(); });

async function practiceTrack(track: ReplayTrack) {
  if (importing) return;
  importing = true;
  game.pause(); pressed.clear();
  element('practice-status').textContent = 'Analyzing replay…';
  try {
    const set = await loadPractice(track, settings, text => { element('practice-status').textContent = text; });
    element('practice-status').textContent = `${set.scenes.length} fault scenes loaded. ${settings.training.strictPractice ? 'A finesse fault restarts the entire set.' : 'Complete one scene at a time.'}`;
    pages.opening.clear();
    start(set);
  } catch (error) { element('practice-status').textContent = (error as Error).message; }
  finally { importing = false; }
}
element('practice-last').addEventListener('click', () => {
  const source = game.startedAt && !game.practice && game.placements.length ? game.export() : lastReplay;
  if (!source) return;
  try { void practiceTrack(readReplay(source, 'Last game')[0]); } catch (error) { element('practice-status').textContent = (error as Error).message; }
});
element('practice-import').addEventListener('click', () => element<HTMLInputElement>('replay-file').click());
element('practice-track').addEventListener('click', () => { const track = tracks[Number(element<HTMLSelectElement>('replay-track').value)]; if (track) void practiceTrack(track); });
element('replay-file').addEventListener('change', async () => {
  const input = element<HTMLInputElement>('replay-file'), file = input.files?.[0];
  if (!file) return;
  element<HTMLDetailsElement>('fault-practice-tools').open = true;
  try {
    if (file.size > 20_000_000) throw new Error('Replay files must be smaller than 20 MB.');
    tracks = readReplay(JSON.parse(await file.text()), file.name);
    const select = element<HTMLSelectElement>('replay-track');
    select.replaceChildren(...tracks.map((track, i) => new Option(track.name, String(i))));
    element('replay-selection').hidden = tracks.length === 1;
    if (tracks.length === 1) await practiceTrack(tracks[0]);
    else { game.pause(); element('practice-status').textContent = `${tracks.length} player / round recordings found. Select one to practice.`; }
  } catch (error) { element('practice-status').textContent = `Import failed: ${(error as Error).message}`; }
  input.value = '';
});

function editable(target: EventTarget | null) {
  return target instanceof HTMLElement && (!!target.closest('button,input,select,textarea,[contenteditable="true"],dialog') || target.tagName === 'SUMMARY');
}

document.addEventListener('keydown', event => {
  if (pages.page !== 'play') return;
  if (panel.open || customPanel.open || toolsDialog.open || editable(event.target) || event.isComposing) return;
  if ((event.ctrlKey || event.metaKey) && ['KeyZ', 'KeyY'].includes(event.code)) { event.preventDefault(); if (game.qp) return; if (!event.repeat) { if (event.code === 'KeyY' || event.shiftKey) redo(); else undo(); } return; }
  const action = (Object.keys(actions) as Action[]).find(key => bindingCodes(game.settings, key).includes(event.code));
  if (!action) return;
  event.preventDefault();
  if (event.repeat || pressed.has(event.code)) return;
  pressed.set(event.code, action);
  if (action === 'restart') { restartGame(); return; }
  if (action === 'pause') { pause(); return; }
  if (game.status === 'playing' || (game.status === 'countdown' && (action === 'moveLeft' || action === 'moveRight'))) game.input.press(action, accumulator / (1000 / 60));
});
document.addEventListener('keyup', event => {
  const action = pressed.get(event.code); pressed.delete(event.code);
  if (action && action !== 'restart' && action !== 'pause' && ![...pressed.values()].includes(action)) game.input.release(action, accumulator / (1000 / 60));
});
const autoPause = () => { game.pause(); pressed.clear(); accumulator = 0; };
addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
addEventListener('pagehide', saveReplay);

function refresh() {
  const engine = game.engine;
  const tetrion = document.querySelector<HTMLElement>('.tetrion')!;
  const previewColumns = game.qp ? 4 : 5;
  tetrion.style.gridTemplateColumns = `minmax(0,${game.qp ? 5 : previewColumns}fr) minmax(0,${engine.board.width}fr) minmax(0,${previewColumns}fr)`;
  tetrion.style.setProperty('--tetrion-columns', String(engine.board.width + 2 * previewColumns + Number(!!game.qp)));
  tetrion.style.setProperty('--board-rows', String(engine.board.height + 3));
  const goals = game.rules.goals, custom = game.rules.id === 'custom' && !game.practice;
  element<HTMLInputElement>('finesse-toggle').checked = game.rules.finesse;
  element<HTMLInputElement>('think-toggle').checked = game.settings.training.justThink;
  element('think-help').textContent = game.settings.training.thinkStyle === 'piece' ? 'Each piece waits for a fresh game input, then runs normally until placed.' : 'The board and timer advance on game input and while a game key is held. Release all keys to think.';
  element('finesse-scope').textContent = `${pages.opening.active ? 'Openers' : game.practice ? 'Fault practice' : custom ? 'Custom' : '40L Sprint'} · Applies immediately`;
  element('finesse-help').textContent = game.rules.finesse ? 'Finesse faults undo the placement and timer. Saved separately for this mode.' : `Finesse checks and automatic finesse retries are off.${game.practice ? ' Scene targets are still required.' : ''}`;
  sound.sync(game);
  element('audio-status').textContent = sound.status;
  element('custom-open').hidden = selectedMode !== 'custom';
  element('custom-tools').hidden = !custom && !game.practice;
  element<HTMLButtonElement>('clear-field').disabled = !game.canEditField;
  element<HTMLButtonElement>('finish-session').disabled = !game.canEditField && !(game.practice && ['playing', 'paused'].includes(game.status));
  element<HTMLImageElement>('mode-icon').src = `/tetrio/ui/${selectedMode === 'custom' ? 'zen' : 'sprint'}.svg`;
  element('line-goal').textContent = goals.lines ? `/ ${goals.lines}` : '';
  element('time').textContent = formatTime(game.elapsedMs);
  const waitingForInput = game.status === 'playing' && (game.waitingForInput || game.thinkingPaused);
  element('retry-status').hidden = !waitingForInput;
  element('retry-status').textContent = game.waitingForInput ? 'Timer paused. Press a game key to continue.' : 'Just think · Board and timer paused. Use a game key to continue.';
  element('time').classList.toggle('waiting-for-input', waitingForInput);
  element('lines').textContent = String(engine.stats.lines);
  const progress = element<HTMLProgressElement>('progress');
  const ratios = [goals.lines ? engine.stats.lines / goals.lines : 0, goals.pieces ? engine.stats.pieces / goals.pieces : 0, goals.seconds ? game.elapsedMs / (goals.seconds * 1000) : 0];
  progress.hidden = game.practice?.set.loop === true || (!game.practice && !Object.values(goals).some(Boolean));
  progress.max = game.practice?.set.scenes.length ?? (custom ? 1 : 40);
  progress.value = game.practice?.index ?? (custom ? Math.max(...ratios) : engine.stats.lines);
  element('pieces').textContent = String((game.practice && !game.practice.finished ? game.practice.completed : engine.stats.pieces));
  element('mode-label').textContent = game.practice ? game.practice.set.kind === 'opener' ? 'OPENER PRACTICE' : game.practice.set.kind === 'pure' ? 'PURE FINESSE DRILLS' : game.practice.set.kind === 'focused' ? 'FOCUSED FAULT DRILLS' : 'FAULT PRACTICE' : game.rules.name;
  const modeSelect = element<HTMLSelectElement>('mode-select');
  let activeMode = modeSelect.querySelector<HTMLOptionElement>('option[value="active-session"]');
  if (!activeMode) { activeMode = new Option('', 'active-session'); activeMode.disabled = true; modeSelect.add(activeMode); }
  activeMode.hidden = modePending || (!game.practice && !freeSession);
  if (!activeMode.hidden) { activeMode.textContent = game.analysisScene ? game.rules.name === 'SPIN LAB' ? 'Spin Lab' : game.rules.name === 'COMBO LAB' ? 'Combo Lab' : 'Perfect Clear Lab' : game.practice ? game.practice.set.kind === 'opener' ? 'Opener practice' : 'Finesse drills' : 'Random opening'; modeSelect.value = 'active-session'; }
  element('opener-hold-hint').hidden = !(game.practice?.set.scenes[game.practice.index]?.holdFirst && game.engine.falling.symbol !== game.practice.set.scenes[game.practice.index].guideSnapshot?.falling.symbol);
  element('mode-rules').hidden = !custom;
  element('mode-rules').textContent = `${engine.board.width} × ${engine.board.height} · ${engine.kickTableName} · ${game.rules.bag} · ${Number(engine.dynamic.gravity.get().toFixed(4))} G · ${game.rules.infiniteLock ? 'Manual lock' : `${game.rules.lockDelay}f lock delay`} · ${game.rules.finesse ? 'Perfect finesse' : 'Finesse off'}. ${[goals.lines ? `${goals.lines} lines` : '', goals.pieces ? `${goals.pieces} pieces` : '', goals.seconds ? formatTime(goals.seconds * 1000) : ''].filter(Boolean).join(' / ') || 'Endless session'}. Seed: ${game.seed}. Boards cleared: ${game.boardResets}. Attack: ${engine.stats.garbage.attack}. Sent: ${engine.stats.garbage.sent}. Pending garbage: ${engine.garbageQueue.size}. Garbage cleared: ${engine.stats.garbage.cleared}.${game.rules.advanced.garbageRefill ? ` Refill: ${game.rules.advanced.garbageRefill} rows.` : ""}${game.rules.advanced.handlingOverride ? ` Room handling: ARR ${engine.handling.arr}, DAS ${engine.handling.das}, SDF ${engine.handling.sdf}.` : ''}${game.rules.advanced.sequence ? ` Authored queue${game.rules.advanced.repeatSequence ? ' (repeating)' : ''}.` : ''}`;
  element('sprint').hidden = !game.practice && !custom;
  element('practice-progress').textContent = game.practice ? game.practice.finished && game.practice.set.continueAfter ? 'Construction complete | Continue playing' : game.practice.set.loop ? `${game.practice.completed} completed · Endless` : `${game.practice.index} / ${game.practice.set.scenes.length}` : '';
  element('pps').textContent = game.elapsedMs ? (engine.stats.pieces * 1000 / game.elapsedMs).toFixed(2) : '0.00';
  element('inputs').textContent = String(game.inputs); element('holds').textContent = String(game.holds);
  element('faults').textContent = String(game.faults); element('perfects').textContent = String(game.perfects);
  element<HTMLButtonElement>('pause').disabled = !game.active && game.status !== 'paused';
  element('pause').textContent = game.status === 'paused' ? 'Resume' : 'Pause';
  element('start').textContent = modePending ? 'Start selected mode' : game.startedAt ? 'Restart game' : 'Start game';
  element<HTMLButtonElement>('download').disabled = !game.startedAt || (game.qp?.sides.length ?? 0) > 1;
  element<HTMLButtonElement>('download-native').disabled = exporting || !!game.qp;
  element<HTMLButtonElement>('undo').disabled = !game.canUndo;
  element<HTMLButtonElement>('redo').disabled = !game.canRedo;
  element<HTMLButtonElement>('practice-last').disabled = importing || !(lastReplay || (!game.practice && game.placements.length));
  element<HTMLButtonElement>('practice-import').disabled = importing;
  element<HTMLButtonElement>('practice-track').disabled = importing;
  const overlay = element('board-overlay');
  overlay.hidden = game.status === 'playing';
  overlay.classList.toggle('counting', game.status === 'countdown');
  canvas.style.cursor = game.status === 'paused' || game.status === 'ready' ? 'pointer' : '';
  canvas.title = game.status === 'paused' ? 'Click to resume' : game.status === 'ready' ? 'Click to start with the current seed' : '';
  element('overlay-label').textContent = game.status === 'countdown' ? 'GET READY' : game.status.toUpperCase();
  element('overlay-value').textContent = game.status === 'countdown' ? String(Math.ceil(game.countdownFrames / 60)) : game.status === 'ready' ? 'Start a game' : game.status === 'paused' ? 'Paused' : game.status === 'complete' ? (game.qp ? 'Run stopped' : game.practice ? 'Practice complete' : custom ? 'Session complete' : '40 lines complete') : game.status === 'topout' ? 'Game over' : '';
  if (game.qp && game.status === 'playing' && game.qp.sides[0].life !== 'alive') { element('overlay-label').textContent = 'DUO'; element('overlay-value').textContent = game.qp.sides[0].life === 'reviving' ? 'Reviving?' : 'Awaiting rescue'; }
  element('controls-summary').textContent = `Move: ${bindingLabel(game.settings, 'moveLeft')} / ${bindingLabel(game.settings, 'moveRight')} · ${game.rules.advanced.hardDrop ? `Hard drop: ${bindingLabel(game.settings, 'hardDrop')}` : `Soft drop: ${bindingLabel(game.settings, 'softDrop')} (automatic lock)`}${game.rules.hold ? ` · Hold: ${bindingLabel(game.settings, 'hold')}` : ''}${game.qp ? ' · Live session · No pause or rewind' : ` · Pause: ${bindingLabel(game.settings, 'pause')}`}`;
  element('coach').hidden = !game.fault || game.hideAnalysisTarget;
  if (game.fault) {
    const path = placementSteps(game.fault.path, game.settings).map(step => step.text);
    element('coach-title').textContent = game.fault.reason === 'target' ? 'Match the outlined target' : 'Try a shorter path';
    element('solution').textContent = `${game.fault.reason === 'target' ? 'That placement does not match the required target. ' : `${game.fault.actual} inputs used · ${game.fault.path.cost} needed. `}${path.join(' → ')}${game.fault.path.drop === 'soft' ? '. This target requires a tuck or spin after lowering the piece.' : ''}`;
  }
  element('target-policy').textContent = game.continuation?.enforced ? 'Match the selected continuation target. Use Hold when its guide requests it.' : game.practice && !game.practice.finished ? `Place the required piece in the outlined target to continue.${game.practice.set.allowHold ? ' Use Hold when the guide requests it.' : ' Hold is unavailable until then.'}` : !game.settings.training.allowDifferentTarget ? 'Place the current piece in the outlined target to continue. Hold is unavailable until then.' : 'The outline marks your last target. You can choose a different placement.';
  element('results').textContent = `Max combo: ${game.maxCombo} · Max B2B: ${game.maxB2B} · Target misses: ${game.targetMisses} · Unverified placements: ${game.unverified}${game.practice ? ` · Set restarts: ${game.practice.restarts}` : ''}. ${Object.entries(game.clears).map(([key, n]) => `${key}: ${n}`).join(' · ')}`;
  element('hold-panel').hidden = !game.rules.hold;
  element('next-panel').hidden = game.rules.nextCount === 0;
  drawGame(canvas, holdCanvas, nextCanvas, game);
  drawNativePreview(element<HTMLCanvasElement>('hold-frame'), 'hold');
  drawNativePreview(element<HTMLCanvasElement>('next-frame'), 'next');
}

function animate(now: number) {
  advanceQuickplay(now);
  if (game.active && !game.qp) {
    accumulator += Math.min(100, now - last);
    while (accumulator >= 1000 / 60 && game.active) { game.step(); sound.sync(game); accumulator -= 1000 / 60; }
  } else accumulator = 0;
  last = now;
  if (['complete', 'topout'].includes(game.status) && !saved) {
    saved = true; message.textContent = game.status === 'complete' ? (game.qp ? 'Run stopped' : game.practice ? 'All fault scenes complete.' : game.rules.id === 'custom' ? 'Session complete. Your replay has been saved.' : '40 lines complete. Your replay has been saved.') : 'Game over. Your replay has been saved.'; saveReplay();
  }
  if (game.placements.length !== historyPlacements && now - lastHistorySave > 5000) {
    historyPlacements = game.placements.length; lastHistorySave = now; void saveHistory();
  }
  refresh(); demo.update(now, game); if (pages.lab.active || pages.spin.active || pages.quickplay.active) element('practice-guide').hidden = true; else practiceGuide.update(game); pages.update(now); requestAnimationFrame(animate);
}

function advanceQuickplay(now: number) {
  qpBots.update([game.qp, qpSession?.qp, reviveSession?.qp]);
  if (game.qp) qpClock.advance(game, now, document.hidden ? undefined : () => sound.sync(game));
  if (qpSession && qpSession !== game) qpClock.advance(qpSession, now);
  if (reviveSession && reviveSession !== game) qpClock.advance(reviveSession, now);
}
setInterval(() => { if (document.hidden) advanceQuickplay(performance.now()); }, 100);

const pages = new Pages(history, { quickplay: quickplayPage, startQuickplay: config => { settings.quickplay = structuredClone(config); localStorage.setItem(storageKey, JSON.stringify(settings)); start(); }, startRevive: (config, scene) => { start(undefined, undefined, scene ? scene.settings : { ...settings, quickplay: config }, scene); return game; }, game: () => game, analysis: context => { start(undefined, { seed: 1, rules: customRulesFromMode(context.rules) }, context.settings); game.rules.name = 'PERFECT CLEAR LAB'; game.loadAnalysis(context.snapshot); game.setJustThink(true, 'piece'); return game; }, freeBuild: (seed, rules) => { selectedMode = 'custom'; element<HTMLSelectElement>('mode-select').value = 'custom'; start(undefined, { seed, rules }); }, sound: name => sound.play(name), rules: () => modePending ? modeDefinitions[selectedMode].rules(settings) : analysisRules, settings: () => settings, current: () => game.startedAt ? game.export() : null, pause: () => { game.pause(); pressed.clear(); accumulator = 0; }, save: saveHistory, practice: set => start(set) });
window.addEventListener('pagehide', () => { saveReplay(); });
if (loaded.message) message.textContent = loaded.message;
requestAnimationFrame(animate);
