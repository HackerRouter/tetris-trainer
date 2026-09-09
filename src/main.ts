import './style.css';
import { TrainerGame } from './game';
import { drawGame } from './renderer';
import { SettingsPanel } from './settings-panel';
import { actions, downloadJson, keyLabel, loadSettings, storageKey, type Action } from './settings';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const canvas = element<HTMLCanvasElement>('board');
const loaded = loadSettings(localStorage);
let settings = loaded.settings;
let game = new TrainerGame(settings);
let accumulator = 0, last = performance.now(), resumeAfterSettings = false, saved = false;
const pressed = new Map<string, Action>();
const message = element('message');

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

element('settings-open').addEventListener('click', () => {
  resumeAfterSettings = game.status === 'playing';
  game.pause(); pressed.clear(); panel.show(settings);
});

function saveReplay() {
  if (!game.startedAt) return;
  try { localStorage.setItem('tetrio-trainer-last-replay', JSON.stringify(game.export())); }
  catch { message.textContent = 'Local replay storage is full. Use Download replay to save this session.'; }
}

function start() {
  if (panel.open) return;
  saveReplay();
  game = new TrainerGame(settings); game.start();
  accumulator = 0; last = performance.now(); pressed.clear(); saved = false;
  message.textContent = 'Clear 40 lines. Inefficient placements return to spawn.';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function pause() {
  if (game.status === 'playing') { game.pause(); pressed.clear(); }
  else if (game.status === 'paused') game.resume();
  accumulator = 0; last = performance.now();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

element('start').addEventListener('click', start);
element('pause').addEventListener('click', pause);
element('download').addEventListener('click', () => { if (game.startedAt) downloadJson(game.export(), `40l-training-${Date.now()}.json`); });

function editable(target: EventTarget | null) {
  return target instanceof HTMLElement && (!!target.closest('button,input,select,textarea,[contenteditable="true"],dialog') || target.tagName === 'SUMMARY');
}

document.addEventListener('keydown', event => {
  if (panel.open || editable(event.target) || event.isComposing) return;
  const action = (Object.keys(actions) as Action[]).find(key => game.settings.bindings[key] === event.code);
  if (!action) return;
  event.preventDefault();
  if (event.repeat || pressed.has(event.code)) return;
  pressed.set(event.code, action);
  if (action === 'restart') { start(); return; }
  if (action === 'pause') { pause(); return; }
  if (game.status === 'playing') game.input.press(action, accumulator / (1000 / 60));
});
document.addEventListener('keyup', event => {
  const action = pressed.get(event.code); pressed.delete(event.code);
  if (action && action !== 'restart' && action !== 'pause') game.input.release(action, accumulator / (1000 / 60));
});
const autoPause = () => { game.pause(); pressed.clear(); accumulator = 0; };
addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
addEventListener('pagehide', saveReplay);

function refresh() {
  const engine = game.engine;
  element('time').textContent = (game.elapsedMs / 1000).toFixed(3);
  element('lines').textContent = String(engine.stats.lines);
  element<HTMLProgressElement>('progress').value = engine.stats.lines;
  element('pieces').textContent = String(engine.stats.pieces);
  element('pps').textContent = game.elapsedMs ? (engine.stats.pieces * 1000 / game.elapsedMs).toFixed(2) : '0.00';
  element('inputs').textContent = String(game.inputs); element('holds').textContent = String(game.holds);
  element('faults').textContent = String(game.faults); element('perfects').textContent = String(game.perfects);
  element<HTMLButtonElement>('pause').disabled = !['playing', 'paused'].includes(game.status);
  element('pause').textContent = game.status === 'paused' ? 'Resume' : 'Pause';
  element('start').textContent = game.startedAt ? 'Restart game' : 'Start game';
  element<HTMLButtonElement>('download').disabled = !game.startedAt;
  element('controls-summary').textContent = `Move: ${keyLabel(game.settings.bindings.moveLeft)} / ${keyLabel(game.settings.bindings.moveRight)} · Drop: ${keyLabel(game.settings.bindings.hardDrop)} · Hold: ${keyLabel(game.settings.bindings.hold)} · Pause: ${keyLabel(game.settings.bindings.pause)}`;
  element('coach').hidden = !game.fault;
  if (game.fault) {
    const names = { moveLeft: 'Tap left', moveRight: 'Tap right', dasLeft: 'Hold left until blocked, then release', dasRight: 'Hold right until blocked, then release', rotateCW: 'Rotate CW', rotateCCW: 'Rotate CCW', rotate180: 'Rotate 180°', softDrop: 'Soft drop to the surface, then release', down: 'Soft drop one row' };
    const path: string[] = [];
    let down = 0;
    const flush = () => { if (down) path.push(`Soft drop ${down} row${down === 1 ? '' : 's'}`); down = 0; };
    for (const move of game.fault.path.moves) { if (move === 'down') down++; else { flush(); path.push(names[move]); } }
    flush(); path.push('Hard drop');
    element('solution').textContent = `${game.fault.actual} inputs used · ${game.fault.path.cost} needed. ${path.join(' → ')}${game.fault.path.drop === 'soft' ? '. This target requires a tuck or spin after lowering the piece.' : ''}`;
  }
  element('results').textContent = `Max combo: ${game.maxCombo} · Max B2B: ${game.maxB2B} · Unverified placements: ${game.unverified}. ${Object.entries(game.clears).map(([key, n]) => `${key}: ${n}`).join(' · ')}`;
  drawGame(canvas, game);
}

function animate(now: number) {
  if (game.status === 'playing') {
    accumulator += Math.min(100, now - last);
    while (accumulator >= 1000 / 60 && game.status === 'playing') { game.step(); accumulator -= 1000 / 60; }
  } else accumulator = 0;
  last = now;
  if (['complete', 'topout'].includes(game.status) && !saved) {
    saved = true; message.textContent = game.status === 'complete' ? '40 lines complete. Your replay has been saved.' : 'Game over. Your replay has been saved.'; saveReplay();
  }
  refresh(); requestAnimationFrame(animate);
}

if (loaded.message) message.textContent = loaded.message;
requestAnimationFrame(animate);
