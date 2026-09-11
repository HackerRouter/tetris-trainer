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
import { CustomPanel } from './custom-panel';
import { type ModeId } from './modes';
import { SoundPlayer } from './audio';
import { drawNativePreview } from './ui-assets';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const canvas = element<HTMLCanvasElement>('board');
const holdCanvas = element<HTMLCanvasElement>('hold-preview'), nextCanvas = element<HTMLCanvasElement>('next-preview');
const demo = new DemoPanel();
const loaded = loadSettings(localStorage);
let settings = loaded.settings;
let selectedMode: ModeId = localStorage.getItem('tetrio-trainer-mode') === 'custom' ? 'custom' : 'sprint';
let modePending = false;
let game = new TrainerGame(settings, undefined, undefined, selectedMode);
const sound = new SoundPlayer(settings.audio);
let accumulator = 0, last = performance.now(), resumeAfterSettings = false, saved = false;
const pressed = new Map<string, Action>();
const message = element('message');
let tracks: ReplayTrack[] = [], importing = false;
let lastReplay: unknown = null;
try { lastReplay = JSON.parse(localStorage.getItem('tetrio-trainer-last-replay') || 'null'); } catch {}

const panel = new SettingsPanel(next => {
  localStorage.setItem(storageKey, JSON.stringify(next));
  settings = next;
  sound.configure(settings.audio);
  message.textContent = 'Settings saved. Start a new game to apply them.';
  if (game.status === 'ready') game = new TrainerGame(settings, undefined, undefined, selectedMode);
}, () => {
  sound.configure(settings.audio);
  last = performance.now(); accumulator = 0;
  if (resumeAfterSettings) game.resume();
  resumeAfterSettings = false;
});

let resumeAfterCustom = false;
const customPanel = new CustomPanel(rules => {
  settings = { ...settings, custom: rules };
  localStorage.setItem(storageKey, JSON.stringify(settings));
  selectMode('custom');
}, saved => {
  accumulator = 0; last = performance.now();
  if (saved) start(); else if (resumeAfterCustom) game.resume();
  resumeAfterCustom = false;
});

function selectMode(mode: ModeId) {
  modePending = !!game.practice || mode !== game.rules.id;
  selectedMode = mode;
  element<HTMLSelectElement>('mode-select').value = mode;
  localStorage.setItem('tetrio-trainer-mode', mode);
  if (game.status === 'ready') game = new TrainerGame(settings, undefined, undefined, mode);
}
element<HTMLSelectElement>('mode-select').value = selectedMode;
element('mode-select').addEventListener('change', () => {
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
  const enabled = element<HTMLInputElement>('finesse-toggle').checked;
  game.setFinesseEnabled(enabled); pressed.clear();
  if (game.practice) settings.training.practiceFinesseEnabled = enabled;
  else if (game.rules.id === 'custom') settings.custom.finesse = enabled;
  else settings.training.finesseEnabled = enabled;
  localStorage.setItem(storageKey, JSON.stringify(settings));
  message.textContent = enabled ? 'Perfect finesse enabled for this mode. Faults restore the placement and timer.' : `Finesse retries disabled for this mode.${game.practice ? ' Match each scene target to advance.' : ' Placements are accepted without a finesse check.'}`;
  element('finesse-toggle').blur();
});
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
document.addEventListener('keydown', () => sound.unlock(), { capture: true });
document.addEventListener('click', event => {
  if ((event.target as HTMLElement)?.closest('button:not(:disabled)') && !(event.target as HTMLElement).closest('#audio-preview')) sound.play('menuclick', true);
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
  if (panel.open || customPanel.open) return;
  const heldCodes = [...pressed.keys()];
  saveReplay();
  game = new TrainerGame(settings, undefined, practice, selectedMode); game.start(); sound.sync(game);
  modePending = false;
  accumulator = 0; last = performance.now(); pressed.clear(); saved = false;
  for (const code of heldCodes) {
    const action = (['moveLeft', 'moveRight'] as const).find(action => bindingCodes(game.settings, action).includes(code));
    if (action) { pressed.set(code, action); game.input.press(action); }
  }
  message.textContent = practice ? 'Match every outlined target with perfect finesse.' : game.rules.id === 'custom' ? 'Custom session started. Use Clear board to reset the field, or Finish session to save a result.' : 'Clear 40 lines. Fault retries also restore the timer.';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function pause() {
  const before = game.status;
  if (game.active) { game.pause(); pressed.clear(); }
  else if (game.status === 'paused') game.resume();
  if (game.status !== before) sound.play('menuclick', true);
  accumulator = 0; last = performance.now();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

element('start').addEventListener('click', () => start(modePending ? undefined : game.practice?.set));
element('pause').addEventListener('click', pause);
element('sprint').addEventListener('click', () => { selectMode('sprint'); start(); });
element('download').addEventListener('click', () => { if (game.startedAt) downloadJson(game.export(), `${game.rules.id}-training-${Date.now()}.json`); });
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
  if (panel.open || customPanel.open || editable(event.target) || event.isComposing) return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && game.rules.undo) { event.preventDefault(); if (!event.repeat) undo(); return; }
  const action = (Object.keys(actions) as Action[]).find(key => bindingCodes(game.settings, key).includes(event.code));
  if (!action) return;
  event.preventDefault();
  if (event.repeat || pressed.has(event.code)) return;
  pressed.set(event.code, action);
  if (action === 'restart') { start(modePending ? undefined : game.practice?.set); return; }
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
  tetrion.style.gridTemplateColumns = `minmax(0,5fr) minmax(0,${engine.board.width}fr) minmax(0,5fr)`;
  tetrion.style.maxWidth = `${(engine.board.width + 10) * 31}px`;
  const goals = game.rules.goals, custom = game.rules.id === 'custom' && !game.practice;
  element<HTMLInputElement>('finesse-toggle').checked = game.rules.finesse;
  element('finesse-scope').textContent = `${game.practice ? 'Fault practice' : custom ? 'Custom' : '40L Sprint'} · Applies immediately`;
  element('finesse-help').textContent = game.rules.finesse ? 'Finesse faults undo the placement and timer. Saved separately for this mode.' : `Finesse checks and automatic finesse retries are off.${game.practice ? ' Scene targets are still required.' : ''}`;
  sound.sync(game);
  element('audio-status').textContent = sound.status;
  element('custom-open').hidden = selectedMode !== 'custom';
  element('custom-tools').hidden = !custom;
  element<HTMLButtonElement>('clear-field').disabled = !game.canEditField;
  element<HTMLButtonElement>('finish-session').disabled = !game.canEditField;
  element<HTMLImageElement>('mode-icon').src = `/tetrio/ui/${selectedMode === 'custom' ? 'zen' : 'sprint'}.svg`;
  element('line-goal').textContent = goals.lines ? `/ ${goals.lines}` : '';
  element('time').textContent = formatTime(game.elapsedMs);
  const waitingForInput = game.status === 'playing' && game.waitingForInput;
  element('retry-status').hidden = !waitingForInput;
  element('time').classList.toggle('waiting-for-input', waitingForInput);
  element('lines').textContent = String(engine.stats.lines);
  const progress = element<HTMLProgressElement>('progress');
  const ratios = [goals.lines ? engine.stats.lines / goals.lines : 0, goals.pieces ? engine.stats.pieces / goals.pieces : 0, goals.seconds ? game.elapsedMs / (goals.seconds * 1000) : 0];
  progress.hidden = !game.practice && !Object.values(goals).some(Boolean);
  progress.max = game.practice?.set.scenes.length ?? (custom ? 1 : 40);
  progress.value = game.practice?.index ?? (custom ? Math.max(...ratios) : engine.stats.lines);
  element('pieces').textContent = String(game.practice?.index ?? engine.stats.pieces);
  element('mode-label').textContent = game.practice ? 'FAULT PRACTICE' : game.rules.name;
  element('mode-rules').hidden = !custom;
  element('mode-rules').textContent = `${engine.board.width} × ${engine.board.height} · ${engine.kickTableName} · ${game.rules.bag} · ${Number(engine.dynamic.gravity.get().toFixed(4))} G · ${game.rules.infiniteLock ? 'Manual lock' : `${game.rules.lockDelay}f lock delay`} · ${game.rules.finesse ? 'Perfect finesse' : 'Finesse off'}. ${[goals.lines ? `${goals.lines} lines` : '', goals.pieces ? `${goals.pieces} pieces` : '', goals.seconds ? formatTime(goals.seconds * 1000) : ''].filter(Boolean).join(' / ') || 'Endless session'}. Seed: ${game.seed}. Boards cleared: ${game.boardResets}. Attack: ${engine.stats.garbage.attack}. Sent: ${engine.stats.garbage.sent}. Pending garbage: ${engine.garbageQueue.size}. Garbage cleared: ${engine.stats.garbage.cleared}.${game.rules.advanced.garbageRefill ? ` Refill: ${game.rules.advanced.garbageRefill} rows.` : ""}${game.rules.advanced.handlingOverride ? ` Room handling: ARR ${engine.handling.arr}, DAS ${engine.handling.das}, SDF ${engine.handling.sdf}.` : ''}${game.rules.advanced.sequence ? ` Authored queue${game.rules.advanced.repeatSequence ? ' (repeating)' : ''}.` : ''}`;
  element('sprint').hidden = !game.practice && !custom;
  element('practice-progress').textContent = game.practice ? `${game.practice.index} / ${game.practice.set.scenes.length}` : '';
  element('pps').textContent = game.elapsedMs ? (engine.stats.pieces * 1000 / game.elapsedMs).toFixed(2) : '0.00';
  element('inputs').textContent = String(game.inputs); element('holds').textContent = String(game.holds);
  element('faults').textContent = String(game.faults); element('perfects').textContent = String(game.perfects);
  element<HTMLButtonElement>('pause').disabled = !game.active && game.status !== 'paused';
  element('pause').textContent = game.status === 'paused' ? 'Resume' : 'Pause';
  element('start').textContent = modePending ? 'Start selected mode' : game.startedAt ? 'Restart game' : 'Start game';
  element<HTMLButtonElement>('download').disabled = !game.startedAt;
  element<HTMLButtonElement>('undo').disabled = !game.canUndo;
  element<HTMLButtonElement>('practice-last').disabled = importing || !(lastReplay || (!game.practice && game.placements.length));
  element<HTMLButtonElement>('practice-import').disabled = importing;
  element<HTMLButtonElement>('practice-track').disabled = importing;
  const overlay = element('board-overlay');
  overlay.hidden = game.status === 'playing';
  overlay.classList.toggle('counting', game.status === 'countdown');
  element('overlay-label').textContent = game.status === 'countdown' ? 'GET READY' : game.status.toUpperCase();
  element('overlay-value').textContent = game.status === 'countdown' ? String(Math.ceil(game.countdownFrames / 60)) : game.status === 'ready' ? 'Start a game' : game.status === 'paused' ? 'Paused' : game.status === 'complete' ? (game.practice ? 'Practice complete' : custom ? 'Session complete' : '40 lines complete') : game.status === 'topout' ? 'Game over' : '';
  element('controls-summary').textContent = `Move: ${bindingLabel(game.settings, 'moveLeft')} / ${bindingLabel(game.settings, 'moveRight')} · ${game.rules.advanced.hardDrop ? `Hard drop: ${bindingLabel(game.settings, 'hardDrop')}` : `Soft drop: ${bindingLabel(game.settings, 'softDrop')} (automatic lock)`}${game.rules.hold ? ` · Hold: ${bindingLabel(game.settings, 'hold')}` : ''} · Pause: ${bindingLabel(game.settings, 'pause')}`;
  element('coach').hidden = !game.fault;
  if (game.fault) {
    const path = placementSteps(game.fault.path, game.settings).map(step => step.text);
    element('coach-title').textContent = game.fault.reason === 'target' ? 'Match the outlined target' : 'Try a shorter path';
    element('solution').textContent = `${game.fault.reason === 'target' ? 'That placement does not match the required target. ' : `${game.fault.actual} inputs used · ${game.fault.path.cost} needed. `}${path.join(' → ')}${game.fault.path.drop === 'soft' ? '. This target requires a tuck or spin after lowering the piece.' : ''}`;
  }
  element('target-policy').textContent = game.practice || !game.settings.training.allowDifferentTarget ? 'Place the current piece in the outlined target to continue. Hold is unavailable until then.' : 'The outline marks your last target. You can choose a different placement.';
  element('results').textContent = `Max combo: ${game.maxCombo} · Max B2B: ${game.maxB2B} · Target misses: ${game.targetMisses} · Unverified placements: ${game.unverified}${game.practice ? ` · Set restarts: ${game.practice.restarts}` : ''}. ${Object.entries(game.clears).map(([key, n]) => `${key}: ${n}`).join(' · ')}`;
  element('hold-panel').hidden = !game.rules.hold;
  element('next-panel').hidden = game.rules.nextCount === 0;
  const nextHeight = Math.max(1, game.rules.nextCount) * 90;
  if (nextCanvas.height !== nextHeight) nextCanvas.height = nextHeight;
  drawGame(canvas, holdCanvas, nextCanvas, game);
  drawNativePreview(element<HTMLCanvasElement>('hold-frame'), 'hold');
  drawNativePreview(element<HTMLCanvasElement>('next-frame'), 'next');
}

function animate(now: number) {
  if (game.active) {
    accumulator += Math.min(100, now - last);
    while (accumulator >= 1000 / 60 && game.active) { game.step(); sound.sync(game); accumulator -= 1000 / 60; }
  } else accumulator = 0;
  last = now;
  if (['complete', 'topout'].includes(game.status) && !saved) {
    saved = true; message.textContent = game.status === 'complete' ? (game.practice ? 'All fault scenes complete.' : game.rules.id === 'custom' ? 'Session complete. Your replay has been saved.' : '40 lines complete. Your replay has been saved.') : 'Game over. Your replay has been saved.'; saveReplay();
  }
  refresh(); demo.update(now, game); requestAnimationFrame(animate);
}

if (loaded.message) message.textContent = loaded.message;
requestAnimationFrame(animate);
