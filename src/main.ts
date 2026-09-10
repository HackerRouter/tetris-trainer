import './style.css';
import { TrainerGame } from './game';
import { drawGame } from './renderer';
import { SettingsPanel } from './settings-panel';
import { actions, bindingCodes, bindingLabel, downloadJson, loadSettings, storageKey, type Action } from './settings';
import { formatTime } from './time';
import { DemoPanel } from './demo';
import { loadPractice, readReplay, type ReplayTrack } from './replay';
import type { PracticeSet } from './practice';
import { placementSteps } from './guide';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const canvas = element<HTMLCanvasElement>('board');
const holdCanvas = element<HTMLCanvasElement>('hold-preview'), nextCanvas = element<HTMLCanvasElement>('next-preview');
const demo = new DemoPanel();
const loaded = loadSettings(localStorage);
let settings = loaded.settings;
let game = new TrainerGame(settings);
let accumulator = 0, last = performance.now(), resumeAfterSettings = false, saved = false;
const pressed = new Map<string, Action>();
const message = element('message');
let tracks: ReplayTrack[] = [], importing = false;
let lastReplay: unknown = null;
try { lastReplay = JSON.parse(localStorage.getItem('tetrio-trainer-last-replay') || 'null'); } catch {}

const panel = new SettingsPanel(next => {
  localStorage.setItem(storageKey, JSON.stringify(next));
  settings = next;
  message.textContent = 'Settings saved. Start a new game to apply them.';
  if (game.status === 'ready') game = new TrainerGame(settings);
}, () => {
  last = performance.now(); accumulator = 0;
  if (resumeAfterSettings) game.resume();
  resumeAfterSettings = false;
});

function openSettings() {
  if (panel.open) return;
  resumeAfterSettings = game.active;
  game.pause(); pressed.clear(); panel.show(settings);
}
element('settings-open').addEventListener('click', openSettings);
element('config-open').addEventListener('click', () => { openSettings(); panel.chooseFile(); });
document.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('file-drag');
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('file-drag'); });
document.addEventListener('dragend', () => document.body.classList.remove('file-drag'));
document.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault(); document.body.classList.remove('file-drag');
  if (importing) { message.textContent = 'Wait for replay analysis to finish before importing settings.'; return; }
  openSettings();
  if (event.dataTransfer.files.length !== 1) { panel.importError('Drop one settings file at a time.'); return; }
  void panel.importFile(event.dataTransfer.files[0]);
});

function saveReplay() {
  if (!game.startedAt) return;
  if (game.practice) return;
  lastReplay = game.export();
  try { localStorage.setItem('tetrio-trainer-last-replay', JSON.stringify(lastReplay)); }
  catch { message.textContent = 'Local replay storage is full. Use Download replay to save this session.'; }
}

function start(practice?: PracticeSet) {
  if (panel.open) return;
  saveReplay();
  game = new TrainerGame(settings, undefined, practice); game.start();
  accumulator = 0; last = performance.now(); pressed.clear(); saved = false;
  message.textContent = practice ? 'Match every outlined target with perfect finesse.' : 'Clear 40 lines. Fault retries also restore the timer.';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function pause() {
  if (game.active) { game.pause(); pressed.clear(); }
  else if (game.status === 'paused') game.resume();
  accumulator = 0; last = performance.now();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

element('start').addEventListener('click', () => start(game.practice?.set));
element('pause').addEventListener('click', pause);
element('sprint').addEventListener('click', () => start());
element('download').addEventListener('click', () => { if (game.startedAt) downloadJson(game.export(), `40l-training-${Date.now()}.json`); });
function undo() { if (game.undo()) { pressed.clear(); accumulator = 0; last = performance.now(); saved = false; message.textContent = 'Placement and timer restored.'; } }
element('undo').addEventListener('click', () => { undo(); element('undo').blur(); });

async function practiceTrack(track: ReplayTrack) {
  if (importing) return;
  importing = true;
  game.pause(); pressed.clear();
  element('practice-status').textContent = 'Analyzing replay…';
  try {
    const set = await loadPractice(track, settings, text => { element('practice-status').textContent = text; });
    element('practice-status').textContent = `${set.scenes.length} fault scenes loaded. ${settings.training.strictPractice ? 'A finesse fault restarts the entire set.' : 'Complete one scene at a time.'}`;
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
  if (panel.open || editable(event.target) || event.isComposing) return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && game.settings.training.undoEnabled) { event.preventDefault(); if (!event.repeat) undo(); return; }
  const action = (Object.keys(actions) as Action[]).find(key => bindingCodes(game.settings, key).includes(event.code));
  if (!action) return;
  event.preventDefault();
  if (event.repeat || pressed.has(event.code)) return;
  pressed.set(event.code, action);
  if (action === 'restart') { start(game.practice?.set); return; }
  if (action === 'pause') { pause(); return; }
  if (game.status === 'playing') game.input.press(action, accumulator / (1000 / 60));
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
  element('time').textContent = formatTime(game.elapsedMs);
  element('lines').textContent = String(engine.stats.lines);
  element<HTMLProgressElement>('progress').max = game.practice?.set.scenes.length ?? 40;
  element<HTMLProgressElement>('progress').value = game.practice?.index ?? engine.stats.lines;
  element('pieces').textContent = String(game.practice?.index ?? engine.stats.pieces);
  element('mode-label').textContent = game.practice ? 'FAULT PRACTICE' : '40 LINE SPRINT';
  element('sprint').hidden = !game.practice;
  element('practice-progress').textContent = game.practice ? `${game.practice.index} / ${game.practice.set.scenes.length}` : '';
  element('pps').textContent = game.elapsedMs ? (engine.stats.pieces * 1000 / game.elapsedMs).toFixed(2) : '0.00';
  element('inputs').textContent = String(game.inputs); element('holds').textContent = String(game.holds);
  element('faults').textContent = String(game.faults); element('perfects').textContent = String(game.perfects);
  element<HTMLButtonElement>('pause').disabled = !game.active && game.status !== 'paused';
  element('pause').textContent = game.status === 'paused' ? 'Resume' : 'Pause';
  element('start').textContent = game.startedAt ? 'Restart game' : 'Start game';
  element<HTMLButtonElement>('download').disabled = !game.startedAt;
  element<HTMLButtonElement>('undo').disabled = !game.canUndo;
  element<HTMLButtonElement>('practice-last').disabled = importing || !(lastReplay || (!game.practice && game.placements.length));
  element<HTMLButtonElement>('practice-import').disabled = importing;
  element<HTMLButtonElement>('practice-track').disabled = importing;
  const overlay = element('board-overlay');
  overlay.hidden = game.status === 'playing';
  overlay.classList.toggle('counting', game.status === 'countdown');
  element('overlay-label').textContent = game.status === 'countdown' ? 'GET READY' : game.status.toUpperCase();
  element('overlay-value').textContent = game.status === 'countdown' ? String(Math.ceil(game.countdownFrames / 60)) : game.status === 'ready' ? 'Start a game' : game.status === 'paused' ? 'Paused' : game.status === 'complete' ? (game.practice ? 'Practice complete' : '40 lines complete') : game.status === 'topout' ? 'Game over' : '';
  element('controls-summary').textContent = `Move: ${bindingLabel(game.settings, 'moveLeft')} / ${bindingLabel(game.settings, 'moveRight')} · Drop: ${bindingLabel(game.settings, 'hardDrop')} · Hold: ${bindingLabel(game.settings, 'hold')} · Pause: ${bindingLabel(game.settings, 'pause')}`;
  element('coach').hidden = !game.fault;
  if (game.fault) {
    const path = placementSteps(game.fault.path, game.settings).map(step => step.text);
    element('coach-title').textContent = game.fault.reason === 'target' ? 'Match the outlined target' : 'Try a shorter path';
    element('solution').textContent = `${game.fault.reason === 'target' ? 'That placement does not match the required target. ' : `${game.fault.actual} inputs used · ${game.fault.path.cost} needed. `}${path.join(' → ')}${game.fault.path.drop === 'soft' ? '. This target requires a tuck or spin after lowering the piece.' : ''}`;
  }
  element('target-policy').textContent = game.practice || !game.settings.training.allowDifferentTarget ? 'Place the current piece in the outlined target to continue. Hold is unavailable until then.' : 'The outline marks your last target. You can choose a different placement.';
  element('results').textContent = `Max combo: ${game.maxCombo} · Max B2B: ${game.maxB2B} · Target misses: ${game.targetMisses} · Unverified placements: ${game.unverified}${game.practice ? ` · Set restarts: ${game.practice.restarts}` : ''}. ${Object.entries(game.clears).map(([key, n]) => `${key}: ${n}`).join(' · ')}`;
  drawGame(canvas, holdCanvas, nextCanvas, game);
}

function animate(now: number) {
  if (game.active) {
    accumulator += Math.min(100, now - last);
    while (accumulator >= 1000 / 60 && game.active) { game.step(); accumulator -= 1000 / 60; }
  } else accumulator = 0;
  last = now;
  if (['complete', 'topout'].includes(game.status) && !saved) {
    saved = true; message.textContent = game.status === 'complete' ? (game.practice ? 'All fault scenes complete.' : '40 lines complete. Your replay has been saved.') : 'Game over. Your replay has been saved.'; saveReplay();
  }
  refresh(); demo.update(now, game); requestAnimationFrame(animate);
}

if (loaded.message) message.textContent = loaded.message;
requestAnimationFrame(animate);
