import type { TrainerGame } from './game';
import type { Settings } from './settings';
import { validateQpSettings, type QpSettings } from './qp-config';
import { extractQpPressure } from './qp-pressure';
import { floorBoundaries, floorNames, type QpMod } from './qp-rules';
import { playableQpMods } from './qp-runtime';
import { reviveCatalog } from './revive-tasks';
import { drawScene } from './renderer';
import { drawNativePreview } from './ui-assets';
import { QpBoardView } from './qp-board-view';
import { qpVisual } from './qp-mod-state';
import reference from './qp-reference.json' with { type: 'json' };

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
type Callbacks = { game: () => TrainerGame; settings: () => Settings; enter: (active: boolean) => void; start: (settings: QpSettings) => void };
export class QuickPlayPage {
  active = false;
  private draft: QpSettings;
  private taskKey = '';
  private boards: QpBoardView[];
  constructor(private callbacks: Callbacks) {
    this.draft = validateQpSettings(callbacks.settings().quickplay);
    const options = document.createElement('section'); options.id = 'qp-options'; options.hidden = true;
    options.innerHTML = `<span class="eyebrow">LOCAL ZENITH TRAINING</span><h2>Quick Play</h2><p class="muted">Solo climbing and local Duo revive practice.</p><form id="qp-form" novalidate><label class="select-row">Session<select id="qp-party"><option value="solo">Solo</option><option value="duo">Duo with bot</option></select></label><label class="select-row">Pressure<select id="qp-pressure"><option value="generated">Generated lobby pressure</option><option value="none">No pressure</option><option value="replay">Recorded pressure</option></select></label><label class="number-row"><span>Pressure strength</span><input id="qp-strength" type="number" min="0" max="5" step=".1"></label><label class="number-row"><span>Burst frequency</span><input id="qp-bursts" type="number" min="0" max="1" step=".1"></label><button id="qp-import" class="secondary wide" type="button">Import Zenith pressure (.ttr)</button><input id="qp-file" type="file" accept=".ttr,.json" hidden><p id="qp-tape" class="muted"></p><details><summary>Mods</summary><p class="muted">Normal cards can be combined. A reversed card occupies the whole loadout. Cards still being adapted are unavailable.</p><fieldset id="qp-player-mods"><legend>Your mods</legend></fieldset><fieldset id="qp-ally-mods"><legend>Teammate mods</legend></fieldset></details><details id="qp-duo-options" open><summary>Duo and revive practice</summary><label class="select-row">Practice trigger<select id="qp-trigger"><option value="none">Natural topouts only</option><option value="bot">Player rescues bot</option><option value="player">Bot rescues player</option><option value="alternate">Alternate rescuer</option></select></label><label class="number-row"><span>Time between triggers</span><input id="qp-interval" type="number" min="1" max="600" step="1"><span>seconds</span></label><label class="check-row"><input id="qp-repeat" type="checkbox">Repeat after each revival</label><label class="select-row">Task selection<select id="qp-task-mode"><option value="sequence">Fixed task / floor deck</option><option value="random">Random from selected tasks</option></select></label><div id="qp-random-tasks" hidden><label class="number-row"><span>Tasks per rescue (up to)</span><input id="qp-task-count" type="number" min="1" max="3" value="3"></label><fieldset id="qp-task-pool" class="qp-task-pool"><legend>Choose task variants</legend></fieldset><p class="muted">Each rescue draws a fresh selection, without repeating the same objective. Numbers and pieces follow the selected native variants.</p></div><label id="qp-fixed-task" class="select-row">Task sequence<select id="qp-task"><option value="">Draw the floor's task deck</option></select></label><label class="number-row"><span>Bot placement speed</span><input id="qp-pps" type="number" min=".1" max="10" step=".1"><span>PPS</span></label><label class="number-row"><span>Bot search budget</span><input id="qp-nodes" type="number" min="32" max="100000" step="1"></label><p class="muted">Bot can read both boards, full generated queues, tasks and local pressure state. It prioritizes revive tasks and checks legal timed inputs. PPS is the target number of locked pieces per second. Ordinary moves use compact legal inputs; task planning and timed inputs may limit the measured rate.</p></details><button type="submit" class="wide">Apply and start</button><button id="qp-stop" type="button" class="secondary wide">Stop</button><p id="qp-config-status" role="status" class="muted"></p></form><details><summary>Rule version and coverage</summary><p class="muted">Reference: TETR.IO v19, July 14, 2026. Pressure generation approximates opponents; recorded pressure replays incoming interactions before receiver modifiers. Dynamic play and task coverage are being validated.</p><p class="muted">Solo recordings use trainer JSON. Native Solo QP export is under validation. Duo replay export is outside the training scope.</p><p class="muted">Snowball Board / Permafrost Board and PENTR.IO / A Fool's Errand remain under version-specific research.</p></details>`;
    document.querySelector('.workspace-left')!.prepend(options);
    const guide = document.createElement('aside'); guide.id = 'qp-guide'; guide.className = 'workspace-right workspace-panel'; guide.hidden = true;
    guide.innerHTML = `<span class="eyebrow">ZENITH</span><h2 id="qp-floor">Hall of Beginnings</h2><div class="qp-metrics"><div><strong id="qp-altitude" aria-label="Altitude">0.00 m</strong></div><div><span>CLIMB SPEED</span><strong id="qp-speed">1.00</strong></div></div><progress id="qp-floor-progress" max="1" value="0"></progress><p id="qp-live" class="muted"></p><p id="qp-life" role="status"></p><section id="qp-teammate"><h3>Teammate</h3><canvas id="qp-bot-board" width="160" height="368" aria-label="Local teammate board"></canvas><p id="qp-bot-state" class="muted"></p><div class="page-toolbar"><button id="qp-down-bot" class="secondary">Practice saving bot</button><button id="qp-down-player" class="secondary">Practice being saved</button></div></section><section id="qp-tasks"><h3 id="qp-task-title">Revive tasks</h3><ol id="qp-task-list"></ol></section><p id="qp-run-stats" class="muted"></p>`;
    el('play-page').append(guide);
    el('qp-bot-board').remove();
    const tetrion = document.querySelector<HTMLElement>('#play-page .tetrion')!, stage = document.createElement('div'); stage.id = 'qp-stage';
    tetrion.replaceWith(stage); stage.append(tetrion);
    const teammate = document.createElement('div'); teammate.id = 'qp-partner'; teammate.hidden = true;
    teammate.innerHTML = `<div class="board-column"><canvas id="qp-bot-board" width="300" height="690" aria-label="Local teammate board"></canvas></div><div class="qp-partner-next"><section class="preview-panel next-panel" aria-label="Teammate next queue"><canvas id="qp-bot-next-frame" class="preview-frame" aria-hidden="true"></canvas><h2>NEXT</h2><canvas id="qp-bot-next" width="120" height="450" aria-label="Teammate next pieces"></canvas></section></div>`;
    stage.append(teammate);
    const allyHold = document.createElement('section'); allyHold.id = 'qp-bot-hold-panel'; allyHold.className = 'preview-panel hold-panel'; allyHold.hidden = true; allyHold.setAttribute('aria-label', 'Teammate Hold');
    allyHold.innerHTML = '<canvas id="qp-bot-hold-frame" class="preview-frame" aria-hidden="true"></canvas><h2>HOLD</h2><canvas id="qp-bot-hold" width="120" height="90" aria-label="Teammate held piece"></canvas>';
    tetrion.querySelector('.right-column')!.append(allyHold);
    this.boards = [new QpBoardView(tetrion.querySelector('.board-column')!, 0), new QpBoardView(teammate.querySelector('.board-column')!, 1)];
    const altitude = document.createElement('div'); altitude.id = 'qp-shared-height'; altitude.hidden = true; stage.after(altitude);
    const banner = document.createElement('div'); banner.id = 'qp-banner'; banner.hidden = true; banner.setAttribute('role', 'status'); stage.before(banner);
    const title = document.createElement('strong'); title.id = 'qp-toolbar-title'; title.textContent = 'QUICK PLAY'; title.hidden = true; document.querySelector('.game-toolbar')!.prepend(title);
    el('qp-stop').className = 'secondary'; document.querySelector('.game-toolbar')!.append(el('qp-stop'));
    for (const id of ['qp-player-mods', 'qp-ally-mods']) {
      for (const [key, name] of Object.entries(reference.mods)) {
        if (key === 'duo') continue;
        const label = document.createElement('label'); label.className = 'check-row';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = key; input.disabled = !playableQpMods.includes(key as QpMod);
        label.append(input, document.createTextNode(`${name}${input.disabled ? ' · pending' : ''}`)); el(id).append(label);
      }
    }
    for (const task of reviveCatalog) el<HTMLSelectElement>('qp-task').add(new Option(`${task.tier} · ${task.label}`, task.id));
    for (const task of reviveCatalog) {
      const label = document.createElement('label'), input = document.createElement('input'); label.className = 'check-row'; input.type = 'checkbox'; input.value = task.id;
      label.append(input, document.createTextNode(`${task.tier} - ${task.label}`)); el('qp-task-pool').append(label);
    }
    this.fill();
    el('qp-party').addEventListener('change', () => this.party());
    el('qp-import').addEventListener('click', () => el<HTMLInputElement>('qp-file').click());
    el('qp-file').addEventListener('change', async () => {
      const input = el<HTMLInputElement>('qp-file'), file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 20_000_000) throw new Error('Choose a replay smaller than 20 MB.');
        this.draft.pressure.tape = extractQpPressure(JSON.parse(await file.text()), file.name);
        el<HTMLSelectElement>('qp-pressure').value = 'replay'; this.tape();
      } catch (error) { el('qp-config-status').textContent = (error as Error).message; } finally { input.value = ''; }
    });
    el('qp-form').addEventListener('submit', event => {
      event.preventDefault();
      try { this.read(); callbacks.start(this.draft); document.querySelector('.workspace-left')!.scrollTop = 0; el('qp-config-status').textContent = 'Session started.'; }
      catch (error) { el('qp-config-status').textContent = (error as Error).message; }
    });
    el('qp-task-mode').addEventListener('change', () => this.taskSelection());
    el('qp-stop').addEventListener('click', () => { callbacks.game().stopQuickPlay(); el('qp-stop').blur(); });
    for (const [id, side] of [['qp-down-bot', 1], ['qp-down-player', 0]] as const) el(id).addEventListener('click', () => { if (callbacks.game().status === 'playing') callbacks.game().qp?.requestRescue(side); el(id).blur(); });
  }
  coachingGravity(enabled: boolean) { this.draft.reviveNoGravity = enabled; }
  private fill() {
    const d = this.draft;
    el<HTMLSelectElement>('qp-party').value = d.profile.mods.includes('duo') ? 'duo' : 'solo';
    el<HTMLSelectElement>('qp-pressure').value = d.pressure.mode;
    for (const [id, value] of [['qp-strength', d.pressure.strength], ['qp-bursts', d.pressure.burstiness], ['qp-interval', d.triggerSeconds], ['qp-pps', d.bot.pps], ['qp-nodes', d.bot.nodes]] as const) el<HTMLInputElement>(id).value = String(value);
    el<HTMLSelectElement>('qp-trigger').value = d.trigger; el<HTMLInputElement>('qp-repeat').checked = d.repeat; el<HTMLSelectElement>('qp-task').value = d.tasks[0] ?? '';
    for (const [id, mods] of [['qp-player-mods', d.profile.mods], ['qp-ally-mods', d.profile.allyMods]] as const) el(id).querySelectorAll<HTMLInputElement>('input').forEach(input => { input.checked = mods.includes(input.value as QpMod); });
    el<HTMLSelectElement>('qp-task-mode').value = d.taskMode; el<HTMLInputElement>('qp-task-count').value = String(d.randomTaskCount);
    el('qp-task-pool').querySelectorAll<HTMLInputElement>('input').forEach(input => { input.checked = d.tasks.includes(input.value); });
    this.taskSelection(); this.party(); this.tape();
  }
  private taskSelection() {
    const random = el<HTMLSelectElement>('qp-task-mode').value === 'random';
    el('qp-random-tasks').hidden = !random; el('qp-fixed-task').hidden = random;
  }
  private party() { const duo = el<HTMLSelectElement>('qp-party').value === 'duo'; el('qp-duo-options').hidden = !duo; el('qp-ally-mods').hidden = !duo; }
  private tape() { const tape = this.draft.pressure.tape; el('qp-tape').textContent = tape ? `${tape.name} · ${tape.packets.length} incoming packets · ${(tape.frames / 3600).toFixed(1)} min` : 'No recorded pressure loaded.'; }
  private read() {
    const duo = el<HTMLSelectElement>('qp-party').value === 'duo', mods = (id: string) => Array.from(el(id).querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.value as QpMod);
    const d = this.draft;
    d.profile = { mods: [...(duo ? ['duo' as const] : []), ...mods('qp-player-mods')], allyMods: duo ? ['duo', ...mods('qp-ally-mods')] : [] };
    d.pressure.mode = el<HTMLSelectElement>('qp-pressure').value as QpSettings['pressure']['mode'];
    d.pressure.strength = Number(el<HTMLInputElement>('qp-strength').value); d.pressure.burstiness = Number(el<HTMLInputElement>('qp-bursts').value);
    d.trigger = duo ? el<HTMLSelectElement>('qp-trigger').value as QpSettings['trigger'] : 'none'; d.triggerSeconds = Number(el<HTMLInputElement>('qp-interval').value); d.repeat = el<HTMLInputElement>('qp-repeat').checked;
    d.bot.pps = Number(el<HTMLInputElement>('qp-pps').value); d.bot.nodes = Number(el<HTMLInputElement>('qp-nodes').value);
    d.taskMode = el<HTMLSelectElement>('qp-task-mode').value as QpSettings['taskMode']; d.randomTaskCount = Number(el<HTMLInputElement>('qp-task-count').value);
    d.tasks = d.taskMode === 'random' ? Array.from(el('qp-task-pool').querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.value) : el<HTMLSelectElement>('qp-task').value ? [el<HTMLSelectElement>('qp-task').value] : [];
    if (duo && d.taskMode === 'random' && !d.tasks.length) throw new Error('Select at least one task variant for the random pool.');
    this.draft = validateQpSettings(d);
  }
  setVisible(active: boolean) {
    this.callbacks.enter(active);
    el('qp-toolbar-title').textContent = location.hash === '#revive' ? 'REVIVE PRACTICE' : 'QUICK PLAY';
    if (this.active === active) return;
    this.active = active;
    el('play-page').classList.toggle('qp-active', active);
    if (!active) { el('play-page').classList.remove('qp-duo'); el('qp-partner').hidden = true; el('qp-bot-hold-panel').hidden = true; el('qp-shared-height').hidden = true; el('qp-banner').hidden = true; this.boards.forEach(board => board.update(null)); }
    for (const id of ['qp-options', 'qp-guide', 'qp-toolbar-title']) el(id).hidden = !active;
    if (active) { this.draft = structuredClone(this.callbacks.settings().quickplay); this.fill(); }
  }
  private layout() {
    const qp = this.callbacks.game().qp; if (!qp) return;
    const root = el('play-page'), play = root.querySelector<HTMLElement>('.play-area')!, width = root.clientWidth, narrow = innerWidth <= 1100;
    const columns = qp.sides[0].engine.board.width + 9 + (qp.sides[1] ? qp.sides[1].engine.board.width + 4 : 0), rows = Math.max(...qp.sides.map(side => side.engine.board.height)) + 3;
    const gap = qp.sides.length === 2 ? 24 : 0, rail = narrow ? 0 : Math.min(260, Math.max(190, width * .1));
    const cell = Math.max(8, Math.min(64, (width - rail * 2 - (narrow ? 0 : 32) - gap) / columns, (innerHeight - Math.max(0, play.getBoundingClientRect().top) - 100) / rows));
    root.style.setProperty('--qp-cell', `${cell}px`); root.style.setProperty('--qp-stage-width', `${columns * cell + gap}px`);
    root.style.setProperty('--qp-rail', `${Math.max(0, (width - columns * cell - gap - 32) / 2)}px`);
    el('qp-stage').style.gridTemplateColumns = qp.sides[1] ? `${(qp.sides[0].engine.board.width + 9) * cell}px ${(qp.sides[1].engine.board.width + 4) * cell}px` : '';
    el('qp-partner').style.gridTemplateColumns = `${qp.sides[1]?.engine.board.width ?? 10}fr 4fr`;
  }
  update() {
    if (!this.active) return;
    const game = this.callbacks.game(), qp = game.qp; if (!qp) return;
    el<HTMLButtonElement>('qp-stop').disabled = !game.active;
    const climb = qp.climb, floor = Math.max(1, climb.floor), side = qp.sides[0], ally = qp.sides[1];
    el('play-page').classList.toggle('qp-duo', !!ally); el('qp-partner').hidden = !ally; el('qp-bot-hold-panel').hidden = !ally?.rules.hold; this.layout();
    this.boards.forEach(board => board.update(qp));
    const height = el('qp-shared-height'); height.hidden = false; height.innerHTML = `<strong aria-label="${ally ? 'Shared altitude' : 'Altitude'}">${climb.altitude.toFixed(1)}<small> m</small></strong><span>CLIMB SPEED ${climb.rank.toFixed(2)}</span>`;
    const announcement = qp.events.slice(-200).reverse().find(event => ['fatigue', 'floor'].includes(event.type) && qp.frame - event.frame < 240), banner = el('qp-banner');
    banner.hidden = !announcement; banner.classList.toggle('qp-floor-banner', announcement?.type === 'floor');
    if (announcement) {
      if (announcement.type === 'floor') banner.textContent = `FLOOR ${floor} · ${floorNames[floor - 1].toUpperCase()}`;
      else { const actions = announcement.data as [string, unknown][], waterfall = actions.find(([action]) => action === 'waterfall')?.[1] as { msg?: string | string[] } | undefined; const text = Array.isArray(waterfall?.msg) ? waterfall.msg[0] : waterfall?.msg; banner.textContent = text?.replace(/<[^>]*>/g, '').replace(/%s|%a|%p1|%p2/g, 'PLAYER') ?? `FATIGUE · ${climb.permanentRows} PERMANENT LINES`; }
    }
    el('qp-floor').textContent = `${floor} · ${floorNames[floor - 1]}`;
    el('qp-altitude').textContent = `${climb.altitude.toFixed(2)} m`; el('qp-speed').textContent = climb.rank.toFixed(2);
    el<HTMLProgressElement>('qp-floor-progress').value = floor === 10 ? 1 : (climb.altitude - floorBoundaries[floor - 1]) / (floorBoundaries[floor] - floorBoundaries[floor - 1]);
    const garbage = side.garbage, pending = garbage.pending.reduce((sum, packet) => sum + packet.amount, 0) + garbage.entering.length;
    el('qp-live').textContent = `Attack ${side.engine.stats.garbage.attack} · Sent ${side.engine.stats.garbage.sent} · Cancelled ${garbage.cancelled} · Pending ${pending} · Wind-up ${Math.max(0, (garbage.windupUntil - qp.frame) / 60).toFixed(1)} s`;
    el('qp-life').textContent = qp.stopped ? 'Run stopped.' : qp.over ? 'Game over.' : ally?.practiceTopout ? 'Your teammate is stacking straight up for rescue practice.' : side.life === 'alive' ? ally && ally.life !== 'alive' ? 'Complete your tasks to revive your teammate.' : 'Climbing' : side.life === 'reviving' ? 'Reviving…' : 'Your teammate is working on your rescue.';
    el('qp-teammate').hidden = !ally;
    if (ally) {
      drawScene(el<HTMLCanvasElement>('qp-bot-board'), el<HTMLCanvasElement>('qp-bot-hold'), el<HTMLCanvasElement>('qp-bot-next'), ally.engine, ally.rules, game.settings.display, { board: ally.engine.board.state, piece: ally.life === 'alive' ? ally.engine.falling.snapshot() : null, target: null, hold: ally.engine.held, holdLocked: ally.engine.holdLocked, next: ally.engine.queue.slice(0, ally.rules.nextCount), effect: null, visual: qpVisual(ally, qp.frame) }, 0);
      drawNativePreview(el<HTMLCanvasElement>('qp-bot-next-frame'), 'next'); drawNativePreview(el<HTMLCanvasElement>('qp-bot-hold-frame'), 'hold');
      el('qp-bot-state').textContent = `${ally.life.toUpperCase()} · ${ally.engine.stats.pieces} pieces · ${ally.engine.stats.garbage.sent} sent · ${(ally.lockFrames.filter(frame => frame > qp.frame - 180).length * 60 / Math.max(1, Math.min(180, qp.frame))).toFixed(1)} PPS actual / ${ally.practiceTopout ? 6 : qp.settings.quickplay.bot.pps} target`;
      for (const [id, target] of [['qp-down-bot', ally], ['qp-down-player', side]] as const) el<HTMLButtonElement>(id).disabled = game.status !== 'playing' || target.life !== 'alive' || qp.sides.some(partner => partner.life !== 'alive' || partner.practiceTopout);
    }
    const task = side.task ?? ally?.task, key = JSON.stringify(task?.prompts);
    el('qp-tasks').hidden = !task;
    if (task && key !== this.taskKey) {
      this.taskKey = key; el('qp-task-title').textContent = side.task ? 'Your revive tasks' : 'Teammate revive tasks';
      el('qp-task-list').replaceChildren(...task.prompts.map((prompt, index) => { const li = document.createElement('li'); li.textContent = `${reviveCatalog.find(definition => definition.id === prompt.task)!.label} · ${prompt.count}/${prompt.target}`; li.className = prompt.complete ? 'qp-task-complete' : index === task.active ? 'qp-task-active' : ''; return li; }));
    }
    el('qp-run-stats').textContent = `Rescues: you ${side.revives}${ally ? ` / bot ${ally.revives}` : ''} · Revive level ${climb.reviveLevel} · Fatigue rows ${climb.permanentRows}${climb.noRevive ? ' · Revival disabled by fatigue' : ''}`;
  }
}
