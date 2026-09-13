import type { TrainerGame } from './game';
import type { Opener } from './openers';
import { openingOptions, saveOpeningOptions } from './opening-options';
import { analysisContext } from './analysis-context';
import { boardMask, continuationStateKey, type ContinuationGoal, type ContinuationResult, type ContinuationRoute } from './continuation-search';
import { createEngine } from './engine';
import { drawBoard } from './renderer';
import { drawMino, nativeColors } from './mino-assets';
import { clearedRows } from './board-effects';
import { placementSteps } from './guide';
import { bindingLabel } from './settings';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const labels: Record<ContinuationGoal, string> = { pc: 'Perfect clear', tspin: 'T-spin clear', tsd: 'T-spin double', 'two-tspins': 'Two T-spin clears', 'two-tsd': 'Two T-spin doubles' };

export class ContinuationPanel {
  private worker: Worker | null = null;
  private game: TrainerGame | null = null;
  private opener: Opener | null = null;
  private key = '';
  private optionsKey = '';
  private goal: ContinuationGoal = 'pc';
  private baseline = 0;
  private baselinePc = 0;
  private token = 0;
  private routes: ContinuationRoute[] = [];
  private selected: ContinuationRoute | null = null;
  private step = 0;
  private preview = 0;
  private available = false;
  constructor() {
    el('opener-continuations').innerHTML = `<h3>Continuation branches</h3><div id="continuation-options" hidden><details id="continuation-settings"><summary>Search options</summary><label class="select-row">Goal<select id="continuation-goal"><option value="auto">Published opener continuations</option><option value="pc">Perfect clear</option><option value="tspin">T-spin clear</option><option value="tsd">T-spin double</option><option value="two-tspins">Two T-spin clears</option><option value="two-tsd">Two T-spin doubles</option></select></label><label class="select-row">Search horizon<select id="continuation-depth"><option value="4">4 pieces</option><option value="7">7 pieces</option><option value="10">10 pieces</option><option value="14">14 pieces</option></select></label><label class="check-row"><input id="continuation-seeded" type="checkbox">Use seeded future pieces beyond Next</label><p class="muted">Off uses only current, Hold and visible Next. Plans use this mode's board and rotation/spin rules. They do not predict gravity or lock timing; Just think helps you follow the steps. Mini clears count for T-spin clears. Published opener continuations shows alternate milestones and automatically advances to the next stage. A PC setup still depends on the following queue.</p></details><button id="continuation-search" class="secondary small">Find routes from this board</button><button id="continuation-clear" class="secondary small" hidden>Hide placement hint</button><p id="continuation-status" role="status"></p><p id="continuation-scope" class="muted"></p><div id="continuation-routes" class="opener-catalog"></div><section id="continuation-guide" hidden><h4 id="continuation-route-name"></h4><a id="continuation-source" target="_blank" rel="noopener noreferrer" hidden>Published reference</a><p class="muted">Follow the target, or place differently to find another route.</p><canvas id="continuation-board" aria-label="Continuation step preview"></canvas><p id="continuation-step"></p><div class="page-toolbar"><button id="continuation-prev" class="secondary small">Previous step</button><button id="continuation-next" class="secondary small">Next step</button><button id="continuation-animate" class="secondary small">Animate this step</button></div><ol id="continuation-inputs"></ol><details id="continuation-full-route"><summary>Full route</summary><ol id="continuation-plan"></ol></details></section></div>`;
    el('guidance-slot').append(el('continuation-guide'));
    for (const id of ['continuation-enabled', 'continuation-goal', 'continuation-depth', 'continuation-seeded']) el(id).addEventListener('change', () => {
      saveOpeningOptions({ continuations: el<HTMLInputElement>('continuation-enabled').checked, continuationGoal: el<HTMLSelectElement>('continuation-goal').value as ReturnType<typeof openingOptions>['continuationGoal'], continuationDepth: Number(el<HTMLSelectElement>('continuation-depth').value), seededLookahead: el<HTMLInputElement>('continuation-seeded').checked });
      this.reset(); el(id).blur();
    });
    el('continuation-search').addEventListener('click', () => { this.reset(); el('continuation-search').blur(); });
    el('continuation-clear').addEventListener('click', () => { this.selected = null; if (this.game) this.game.hintTarget = null; el('continuation-guide').hidden = true; el('continuation-clear').hidden = true; this.renderRoutes(); el('continuation-clear').blur(); });
    el('continuation-prev').addEventListener('click', () => { this.preview--; this.drawGuide(); el('continuation-prev').blur(); });
    el('continuation-next').addEventListener('click', () => { this.preview++; this.drawGuide(); el('continuation-next').blur(); });
    el('continuation-animate').addEventListener('click', () => {
      if (!this.selected || !this.game) return;
      const scene = this.selected.steps[this.preview].scene;
      this.game.demonstration = { ...scene, snapshot: scene.guideSnapshot ?? scene.snapshot, serial: Date.now(), sceneNumber: this.preview + 1 };
      el('continuation-animate').blur();
    });
  }
  private count(game: TrainerGame) {
    if (this.goal === 'pc') return game.clears.pc ?? 0;
    return Object.entries(game.clears).reduce((sum, [name, count]) => sum + (/^(mini-)?tspin-[1-4]$/.test(name) && (!['tsd', 'two-tsd'].includes(this.goal) || name.endsWith('-2')) ? count : 0), 0);
  }
  private liveKey(game: TrainerGame) { return `${boardMask(game.engine.board.state).join(',')}|${game.engine.falling.symbol}|${game.engine.held ?? '-'}|${game.engine.holdLocked}|${game.engine.queue.slice(0, 14).join('')}`; }
  private cancel() { this.worker?.terminate(); this.worker = null; this.token++; }
  private reset() {
    this.cancel(); this.key = ''; this.optionsKey = ''; this.selected = null; this.routes = [];
    if (this.game) { this.game.hintTarget = null; this.baseline = this.count(this.game); }
    el('continuation-guide').hidden = true; el('continuation-clear').hidden = true; el('continuation-routes').replaceChildren();
  }
  clear() { this.reset(); this.game = null; this.available = false; el('opener-continuations').hidden = true; }
  suspend() { if (this.worker) { this.cancel(); this.key = ''; } }
  update(game: TrainerGame, opener: Opener | null, completed: boolean, visible: boolean) {
    el('opener-continuations').hidden = !visible;
    const options = openingOptions();
    el<HTMLInputElement>('continuation-enabled').checked = options.continuations; el('continuation-options').hidden = !options.continuations;
    el<HTMLSelectElement>('continuation-goal').value = options.continuationGoal; el<HTMLSelectElement>('continuation-depth').value = String(options.continuationDepth); el<HTMLInputElement>('continuation-seeded').checked = options.seededLookahead;
    const optionKey = `${options.continuationGoal}:${options.continuationDepth}:${options.seededLookahead}`;
    if (this.game !== game || this.opener?.id !== opener?.id || optionKey !== this.optionsKey) {
      this.reset(); this.game = game; this.opener = opener; this.optionsKey = optionKey;
      this.goal = options.continuationGoal === 'auto' ? /perfect|\bpc\b|sdpc/i.test(opener?.name ?? '') ? 'pc' : /dt cannon|albatross|double triple/i.test(opener?.name ?? '') ? 'two-tspins' : 'tspin' : options.continuationGoal;
      this.baseline = this.count(game); this.baselinePc = game.clears.pc ?? 0;
    }
    const available = visible && completed && options.continuations;
    if (available && !this.available) el<HTMLDetailsElement>('opener-candidates-group').open = false;
    this.available = available;
    el<HTMLButtonElement>('continuation-search').disabled = !this.available;
    if (!this.available) { if (this.worker || this.selected || this.key) this.reset(); el('continuation-status').textContent = 'Complete the opening with Keep board enabled to search its follow-ups.'; return; }
    if (['complete', 'topout'].includes(game.status)) { this.cancel(); game.hintTarget = null; el('continuation-status').textContent = 'This game has ended. Restart to train another opening.'; return; }
    const progress = Math.max(0, this.count(game) - this.baseline), needed = this.goal.startsWith('two-') ? 2 : 1;
    if ((options.continuationGoal === 'auto' && (game.clears.pc ?? 0) > this.baselinePc) || (options.continuationGoal !== 'auto' && progress >= needed)) {
      this.cancel(); game.hintTarget = null; el('continuation-clear').hidden = true;
      if (this.selected && this.step < this.selected.steps.length) { this.step = this.selected.steps.length; this.preview = this.step - 1; this.renderRoutes(); this.drawGuide(); }
      el('continuation-status').textContent = `${options.continuationGoal === 'auto' ? 'Perfect clear' : labels[this.goal]} complete. Find routes again to start another goal on this board.`; return;
    }
    const key = `${this.liveKey(game)}:${progress}:${game.rules.finesse}`;
    if (key === this.key) return;
    this.cancel(); this.key = key;
    if (this.selected) {
      const live = this.liveKey(game), index = this.selected.steps.findIndex(step => continuationStateKey(step.scene.snapshot) === live || (step.scene.guideSnapshot && continuationStateKey(step.scene.guideSnapshot) === live));
      if (index >= 0) { this.step = this.preview = index; game.hintTarget = this.selected.steps[index].scene.target; this.renderRoutes(); this.drawGuide(); return; }
      this.selected = null; game.hintTarget = null; el('continuation-guide').hidden = true; el('continuation-clear').hidden = true;
    }
    this.routes = []; this.renderRoutes();
    const token = this.token, requestGoal = needed - progress === 1 && this.goal.startsWith('two-') ? this.goal === 'two-tsd' ? 'tsd' : 'tspin' : this.goal;
    el('continuation-status').textContent = options.continuationGoal === 'auto' ? 'Checking published continuation branches against this board and queue...' : `Searching ${labels[this.goal].toLowerCase()} alternatives...`;
    el('continuation-scope').textContent = `${options.continuationGoal === 'auto' ? 'Published stages' : `${progress} / ${needed} goals`} · Up to ${options.continuationDepth} placements · ${options.seededLookahead ? 'Uses this seed’s future queue' : 'Visible queue only'}`;
    let worker: Worker;
    try { worker = new Worker(new URL('./continuation-worker.ts', import.meta.url), { type: 'module' }); }
    catch { el('continuation-status').textContent = 'This browser could not start the search worker. Gameplay is still available.'; return; }
    this.worker = worker;
    worker.onmessage = event => {
      if (token !== this.token || game !== this.game) return;
      worker.terminate(); this.worker = null;
      if (event.data.error) { el('continuation-status').textContent = event.data.error; return; }
      const result = event.data.result as ContinuationResult; this.routes = result.routes; this.renderRoutes();
      el('continuation-status').textContent = result.message;
      el('continuation-scope').textContent = `${options.continuationGoal === 'auto' ? 'Published stages' : `${labels[this.goal]} · ${progress} / ${needed}`} · ${result.queue.join(' ').toUpperCase()} · ${result.seeded ? 'Seeded future' : 'Visible queue'} · ${result.checked} placements checked in ${(result.elapsedMs / 1000).toFixed(1)}s`;
      if (this.routes.length) this.select(this.routes[0]);
    };
    worker.onerror = () => { if (token === this.token) { this.cancel(); el('continuation-status').textContent = 'The continuation worker could not run. Find routes again to retry.'; } };
    try { worker.postMessage({ context: analysisContext(game.rules, game.settings, game.engine.snapshot({ isUndoRedo: true })), goal: requestGoal, depth: options.continuationDepth, seeded: options.seededLookahead, opener: this.opener ?? undefined, auto: options.continuationGoal === 'auto' }); }
    catch (error) { this.cancel(); el('continuation-status').textContent = (error as Error).message; }
  }
  private select(route: ContinuationRoute) {
    if (!this.game) return;
    const live = this.liveKey(this.game), index = route.steps.findIndex(step => continuationStateKey(step.scene.snapshot) === live || (step.scene.guideSnapshot && continuationStateKey(step.scene.guideSnapshot) === live));
    if (index < 0) return;
    this.selected = route; this.step = this.preview = index; this.game.hintTarget = route.steps[index].scene.target;
    el('continuation-clear').hidden = false; this.renderRoutes(); this.drawGuide();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
  private renderRoutes() {
    el('continuation-routes').replaceChildren(...this.routes.map((route, i) => {
      const button = document.createElement('button'); button.className = 'opener-card secondary'; button.setAttribute('aria-pressed', String(this.selected?.id === route.id));
      if (this.game) { const key = this.liveKey(this.game); button.disabled = !route.steps.some(step => continuationStateKey(step.scene.snapshot) === key || (step.scene.guideSnapshot && continuationStateKey(step.scene.guideSnapshot) === key)); }
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 120; canvas.setAttribute('aria-hidden', 'true');
      const title = document.createElement('strong'); title.textContent = `${route.name ?? `Route ${i + 1}`} · ${route.steps.length} pieces`;
      const summary = document.createElement('small'); summary.textContent = `${route.lines} lines · ${route.spins} T-spin clears${route.pc ? ' · PC' : ''}`;
      const tiles: { x: number; y: number; symbol: string }[] = [], rowIds = route.steps[0].scene.snapshot.board.map((_, y) => y);
      let nextRow = rowIds.length;
      route.steps[0].scene.snapshot.board.forEach((row, y) => row.forEach((tile, x) => { if (tile) tiles.push({ x, y, symbol: 'gb' }); }));
      for (const step of route.steps) {
        for (const [x, y] of step.scene.target) tiles.push({ x, y: rowIds[y], symbol: step.piece });
        for (const row of clearedRows(step.scene.snapshot.board, step.scene.target).reverse()) { rowIds.splice(row, 1); rowIds.push(nextRow++); }
      }
      const ctx = canvas.getContext('2d')!, width = route.steps[0].scene.snapshot.board[0].length, size = Math.min(200 / width, 120 / Math.max(6, ...tiles.map(tile => tile.y + 1)));
      ctx.fillStyle = '#090e18'; ctx.fillRect(0, 0, 200, 120);
      for (const tile of tiles) { const x = (200 - width * size) / 2 + tile.x * size, y = 120 - (tile.y + 1) * size; if (!drawMino(ctx, tile.symbol, x, y, size)) { ctx.fillStyle = nativeColors[tile.symbol] ?? '#7f8a9d'; ctx.fillRect(x + 1, y + 1, size - 2, size - 2); } }
      button.append(canvas, title, summary); button.addEventListener('click', () => this.select(route)); return button;
    }));
  }
  private drawGuide() {
    if (!this.selected || !this.game) return;
    const route = this.selected, step = route.steps[this.preview], scene = step.scene, snapshot = scene.guideSnapshot ?? scene.snapshot;
    el('continuation-guide').hidden = false;
    const reference = el<HTMLAnchorElement>('continuation-source');
    reference.hidden = !route.source || !/^https?:\/\//.test(route.source);
    if (!reference.hidden) reference.href = route.source!;
    el('continuation-route-name').textContent = `${route.name ?? labels[this.goal]} · ${route.steps.length} planned placements`;
    el('continuation-step').textContent = `Preview ${this.preview + 1} / ${route.steps.length} · ${step.piece.toUpperCase()} · ${step.lines} lines${step.spin !== 'none' ? ` · ${step.spin} spin` : ''}${step.pc ? ' · Perfect clear' : ''}. ${this.step >= route.steps.length ? 'Route complete.' : `Live target: step ${this.step + 1}.`}`;
    el<HTMLButtonElement>('continuation-prev').disabled = this.preview === 0; el<HTMLButtonElement>('continuation-next').disabled = this.preview === route.steps.length - 1;
    const engine = createEngine(this.game.settings, 1, this.game.rules), canvas = el<HTMLCanvasElement>('continuation-board'); canvas.width = engine.board.width * 20; canvas.height = (engine.board.height + 3) * 20;
    drawBoard(canvas, engine, snapshot.board, snapshot.falling, scene.target, this.game.settings.display);
    const steps = placementSteps(scene.path, this.game.settings).map(step => step.text);
    if (scene.holdFirst) steps.unshift(`Use Hold (${bindingLabel(this.game.settings, 'hold')}) first if you have not swapped yet.`);
    el('continuation-inputs').replaceChildren(...steps.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    el('continuation-plan').replaceChildren(...route.steps.map((step, index) => { const li = document.createElement('li'); li.textContent = `${step.scene.holdFirst ? 'Hold → ' : ''}${step.piece.toUpperCase()}: ${step.lines} lines${step.spin !== 'none' ? `, ${step.spin} ${step.piece.toUpperCase()}-spin` : ''}${step.pc ? ', perfect clear' : ''}`; if (index === this.step) li.setAttribute('aria-current', 'step'); return li; }));
  }
}
