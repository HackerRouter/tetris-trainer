import { decoder, Mino } from 'tetris-fumen';
import { compileOpener, openerCatalog, allOpeners, verifiedOpeners, suggestOpeners, type Opener, type OpenerRoute, type OpenerSuggestion } from './openers';
import { createEngine } from './engine';
import { drawBoard } from './renderer';
import { drawMino, nativeColors } from './mino-assets';
import { placementSteps } from './guide';
import { customRulesFromMode } from './analysis-context';
import type { CustomRules } from './modes';
import type { Mino as Piece } from '@haelp/teto/engine';
import type { Settings } from './settings';
import type { ModeRules } from './modes';
import type { PracticeSet } from './practice';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const storageKey = 'tetrio-trainer-openers-v1';
type Callbacks = { freeBuild: (seed: number, rules: CustomRules, suggestions: OpenerSuggestion[]) => void; settings: () => Settings; rules: () => ModeRules; practice: (set: PracticeSet) => void };

export class OpenersPage {
  private local: Opener[] = [];
  private selected: Opener = openerCatalog[0];
  private route: OpenerRoute | null = null;
  private index = 0;
  private catalogPage = 0;
  private dealToken = 0;
  private suggestions: OpenerSuggestion[] = [];
  private deal: { seed: number; queue: Piece[] } | null = null;
  constructor(private callbacks: Callbacks) {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(value) && value.length <= 100) this.local = value.filter(item => item && typeof item.fumen === 'string' && item.fumen.length <= 50000 && typeof item.name === 'string').map(item => ({ id: String(item.id), name: item.name.slice(0, 80), fumen: item.fumen, note: 'Imported Fumen construction.', source: '', local: true })); } catch {}
    el('openers-page').innerHTML = `<h2 id="openers-title">Openers</h2><p class="muted">Learn a fixed construction step by step. Built-in diagrams come from the open Opener Database. Each target is checked with the active mode's rotation, spin and board rules. This is construction practice; randomized bag coverage and later-bag solutions are not included.</p><section class="opener-deal"><h3>Random opening lab</h3><p class="muted">Deal a real seven-bag opening and find up to six constructions that fit its order with normal Hold. Candidates are alternatives, not a strength ranking. Their diagrams stay beside the board during free building; click one to restart this deal with assisted targets.</p><div class="page-toolbar"><button id="opener-deal">Deal a random opening</button><button id="opener-free" class="secondary" disabled>Free build this deal</button></div><p id="opener-deal-queue"></p><p id="opener-deal-status" role="status"></p><div id="opener-candidates" class="opener-catalog"></div></section><label class="select-row" for="opener-search">Find a construction<input id="opener-search" type="search" placeholder="TKI, PC, DT…"></label><div class="page-toolbar"><label class="check-row"><input id="opener-ready" type="checkbox">Only validated constructions</label><span id="opener-count"></span></div><div id="opener-catalog" class="opener-catalog"></div><div class="page-toolbar"><button id="catalog-prev" class="secondary">Previous page</button><button id="catalog-next" class="secondary">Next page</button></div><p id="opener-empty" class="muted" hidden>No matching constructions. Try another name or import a Fumen below.</p><section class="opener-workbench" aria-labelledby="opener-name"><div><h3 id="opener-name"></h3><p id="opener-note" class="muted"></p><a id="opener-source" target="_blank" rel="noopener noreferrer">Source diagram</a><p id="opener-rules" class="muted"></p><div class="page-toolbar"><label class="check-row"><input id="opener-mirror" type="checkbox">Mirror</label><label class="check-row"><input id="opener-loop" type="checkbox" checked>Repeat route</label><label class="check-row"><input id="opener-study" type="checkbox" checked>Study: 0G / manual lock</label><label class="check-row"><input id="opener-finesse" type="checkbox" checked>Perfect finesse</label></div><p class="muted">Fixed piece order; Hold, garbage packets and board reset are disabled. Turn off Study to retain the active mode's gravity and lock timing. Wrong targets retry. In Settings, “clear all scenes in one attempt” also applies here.</p><button id="opener-start">Practice this opener</button><button id="opener-delete" class="secondary" hidden>Remove imported opener</button><p id="opener-status" role="status"></p><ol id="opener-route" class="opener-route"></ol></div><div class="opener-preview"><canvas id="opener-board" width="240" height="552" aria-label="Selected opener step"></canvas><p id="opener-step" role="status"></p><div class="page-toolbar"><button id="opener-prev" class="secondary" aria-label="Previous opener step">Previous</button><button id="opener-next" class="secondary" aria-label="Next opener step">Next</button></div><ol id="opener-guide"></ol></div></section><details><summary>Import your own Fumen</summary><form id="opener-import"><label for="opener-import-name">Construction name</label><input id="opener-import-name" maxlength="80" required placeholder="My opener"><label for="opener-fumen">Fumen code or URL</label><textarea id="opener-fumen" rows="4" maxlength="50000" required placeholder="v115@..."></textarea><p class="muted">Supports one colored field with one of each used tetromino, or up to 64 continuous operation pages. Repeated pieces require operation pages. The route is validated before it is saved in this browser.</p><button type="submit">Validate and save Fumen</button><p id="opener-import-status" role="status"></p></form></details><p class="muted">You can switch modes on Play before returning here. Imported constructions stay in this browser; keep the original Fumen as your backup.</p>`;
    el('opener-search').addEventListener('input', () => { this.catalogPage = 0; this.catalog(); });
    el('opener-ready').addEventListener('change', () => { this.catalogPage = 0; this.catalog(); });
    el('catalog-prev').addEventListener('click', () => { this.catalogPage--; this.catalog(); });
    el('catalog-next').addEventListener('click', () => { this.catalogPage++; this.catalog(); });
    el('opener-deal').addEventListener('click', () => void this.newDeal());
    el('opener-free').addEventListener('click', () => {
      if (!this.deal) return;
      const custom = customRulesFromMode(this.callbacks.rules());
      Object.assign(custom, { initialGarbage: 0, infiniteHold: false, lineGoal: 0, pieceGoal: 0, timeLimit: 0, finesse: this.options().finesse, seed: this.deal.seed });
      Object.assign(custom.advanced, { map: '', sequence: '', garbageRefill: 0, garbageInterval: 0 });
      if (this.options().study) { custom.gravity = 0; custom.infiniteLock = true; custom.advanced.gravityIncrease = 0; }
      this.callbacks.freeBuild(this.deal.seed, custom, this.suggestions);
    });
    for (const id of ['opener-mirror', 'opener-loop', 'opener-study', 'opener-finesse']) el(id).addEventListener('change', () => this.refresh());
    el('opener-prev').addEventListener('click', () => { this.index--; this.preview(); });
    el('opener-next').addEventListener('click', () => { this.index++; this.preview(); });
    el('opener-start').addEventListener('click', () => { if (this.route) this.callbacks.practice(this.route.set); });
    el('opener-delete').addEventListener('click', () => {
      try { const next = this.local.filter(opener => opener.id !== this.selected.id); localStorage.setItem(storageKey, JSON.stringify(next)); this.local = next; this.selected = openerCatalog[0]; this.refresh(); }
      catch { el('opener-status').textContent = 'Browser storage is unavailable. The saved list was not changed.'; }
    });
    el('opener-import').addEventListener('submit', event => {
      event.preventDefault();
      try {
        if (this.local.length >= 100) throw new Error('Remove an imported opener before adding more than 100.');
        const name = el<HTMLInputElement>('opener-import-name').value.trim(), fumen = el<HTMLTextAreaElement>('opener-fumen').value.trim();
        if (!name) throw new Error('Enter a construction name.');
        const opener: Opener = { id: crypto.randomUUID(), name, fumen, note: 'Imported Fumen construction.', source: '', local: true };
        compileOpener(opener, this.callbacks.settings(), this.callbacks.rules(), this.options());
        const next = [...this.local, opener]; localStorage.setItem(storageKey, JSON.stringify(next)); this.local = next; this.selected = opener;
        el<HTMLInputElement>('opener-search').value = ''; this.refresh(); el('opener-import-status').textContent = 'Validated and saved locally.';
      } catch (error) { el('opener-import-status').textContent = (error as Error).message; }
    });
    this.catalog();
  }
  private options() { return { mirror: el<HTMLInputElement>('opener-mirror').checked, loop: el<HTMLInputElement>('opener-loop').checked, study: el<HTMLInputElement>('opener-study').checked, finesse: el<HTMLInputElement>('opener-finesse').checked }; }
  private async newDeal() {
    const token = ++this.dealToken;
    el<HTMLButtonElement>('opener-free').disabled = true; this.suggestions = []; el('opener-candidates').replaceChildren();
    try {
      const rules = this.callbacks.rules(), settings = this.callbacks.settings();
      if (rules.board.width !== 10 || rules.bag !== '7-bag') throw new Error('Select a 10-column, 7-bag mode on Play before using the opening lab.');
      if (!rules.advanced.hardDrop) throw new Error('Enable hard drop in the active mode first.');
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1;
      const engine = createEngine(settings, seed, { ...rules, advanced: { ...rules.advanced, sequence: '' } });
      this.deal = { seed, queue: [engine.falling.symbol, ...engine.queue.slice(0, 6)] };
      el('opener-deal-queue').textContent = `Seed ${seed} · Current / next: ${this.deal.queue.join(' → ').toUpperCase()}`;
      el('opener-deal-status').textContent = 'Checking constructions against this queue and Hold…';
      const suggestions = await suggestOpeners(settings, rules, this.deal, this.options(), checked => {
        if (token !== this.dealToken) throw new Error('Search canceled.');
        el('opener-deal-status').textContent = `Checked ${checked} constructions…`;
      });
      if (token !== this.dealToken) return;
      this.suggestions = suggestions;
      el('opener-candidates').replaceChildren(...suggestions.map(suggestion => suggestionCard(suggestion, () => this.callbacks.practice(suggestion.route.set))));
      el('opener-deal-status').textContent = suggestions.length ? `${suggestions.length} reachable alternatives. Click a diagram for assisted practice, or free build with these references.` : 'No supported candidate was found. You can still free build this deal or deal another bag.';
      el<HTMLButtonElement>('opener-free').disabled = false;
    } catch (error) { if (token === this.dealToken) el('opener-deal-status').textContent = (error as Error).message; }
  }
  private catalog() {
    const search = el<HTMLInputElement>('opener-search').value.toLowerCase();
    const items = [...allOpeners, ...this.local].filter(opener => (!el<HTMLInputElement>('opener-ready').checked || verifiedOpeners.has(opener.id) || opener.local) && `${opener.name} ${opener.note}`.toLowerCase().includes(search));
    el('opener-empty').hidden = !!items.length;
    el('opener-count').textContent = `${items.length} constructions ? Page ${this.catalogPage + 1} / ${Math.max(1, Math.ceil(items.length / 24))}`;
    el<HTMLButtonElement>('catalog-prev').disabled = !this.catalogPage; el<HTMLButtonElement>('catalog-next').disabled = (this.catalogPage + 1) * 24 >= items.length;
    el('opener-catalog').replaceChildren(...items.slice(this.catalogPage * 24, (this.catalogPage + 1) * 24).map(opener => {
      const button = document.createElement('button'); button.className = 'opener-card secondary'; button.setAttribute('aria-pressed', String(opener.id === this.selected.id));
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 120; canvas.setAttribute('aria-hidden', 'true');
      const title = document.createElement('strong'); title.textContent = opener.name;
      const tag = document.createElement('small'); tag.textContent = opener.local ? 'Imported' : verifiedOpeners.has(opener.id) ? 'Validated in standard rules' : 'Reference / needs adaptation';
      button.append(canvas, title, tag); button.addEventListener('click', () => { this.selected = opener; this.refresh(); });
      try {
        const page = decoder.decode(opener.fumen)[0], tiles: { x: number; y: number; symbol: string }[] = [];
        for (let y = 0; y < 23; y++) for (let x = 0; x < 10; x++) if (page.field.at(x, y) !== '_') tiles.push({ x, y, symbol: page.field.at(x, y).toLowerCase() });
        if (page.operation) for (const { x, y } of Mino.from(page.operation).positions()) tiles.push({ x, y, symbol: page.operation.type.toLowerCase() });
        const ctx = canvas.getContext('2d')!, size = Math.min(20, 120 / Math.max(6, ...tiles.map(tile => tile.y + 1)));
        ctx.fillStyle = '#090e18'; ctx.fillRect(0, 0, 200, 120);
        for (const tile of tiles) { const x = (200 - size * 10) / 2 + tile.x * size, y = 120 - (tile.y + 1) * size; if (!drawMino(ctx, tile.symbol, x, y, size)) { ctx.fillStyle = nativeColors[tile.symbol] ?? '#7f8a9d'; ctx.fillRect(x + 1, y + 1, size - 2, size - 2); } }
      } catch {}
      return button;
    }));
  }
  refresh() {
    this.catalog(); this.index = 0; this.route = null;
    const rules = this.callbacks.rules();
    el('opener-name').textContent = this.selected.name; el('opener-note').textContent = this.selected.note;
    const link = el<HTMLAnchorElement>('opener-source'); link.hidden = !this.selected.source; link.href = this.selected.source || '#';
    el('opener-delete').hidden = !this.selected.local;
    el('opener-rules').textContent = `${rules.name} · ${rules.board.width} × ${rules.board.height} · ${rules.advanced.kickSet} · Spins: ${rules.advanced.spinBonuses} · Combo: ${rules.advanced.comboTable} · 180° ${rules.allow180 ? 'on' : 'off'}`;
    try {
      this.route = compileOpener(this.selected, this.callbacks.settings(), rules, this.options());
      el('opener-status').textContent = `${this.route.set.scenes.length} reachable steps. ${this.options().study ? 'Study timing enabled.' : 'Active mode timing retained.'}`;
      el('opener-route').replaceChildren(...this.route.set.scenes.map((scene, i) => {
        const li = document.createElement('li'), button = document.createElement('button'), result = this.route!.results[i]; button.className = 'secondary small';
        button.textContent = `${(scene.guideSnapshot ?? scene.snapshot).falling.symbol.toUpperCase()} · ${result.lines} lines${result.spin !== 'none' ? ` · ${result.spin} ${result.piece.toUpperCase()}-spin` : ''}`;
        button.addEventListener('click', () => { this.index = i; this.preview(); }); li.append(button); return li;
      }));
    } catch (error) { el('opener-status').textContent = (error as Error).message; el('opener-route').replaceChildren(); }
    el<HTMLButtonElement>('opener-start').disabled = !this.route; this.preview();
  }
  private preview() {
    el<HTMLButtonElement>('opener-prev').disabled = !this.route || this.index <= 0;
    el<HTMLButtonElement>('opener-next').disabled = !this.route || this.index >= this.route.set.scenes.length - 1;
    const canvas = el<HTMLCanvasElement>('opener-board'); canvas.hidden = !this.route;
    if (!this.route) { el('opener-step').textContent = 'Choose a compatible mode to preview this construction.'; el('opener-guide').replaceChildren(); return; }
    const scene = this.route.set.scenes[this.index], engine = createEngine(this.callbacks.settings(), 1, this.route.rules);
    canvas.height = (engine.board.height + 3) * 24;
    drawBoard(canvas, engine, scene.snapshot.board, (scene.guideSnapshot ?? scene.snapshot).falling, scene.target, this.callbacks.settings().display);
    el('opener-step').textContent = `Step ${this.index + 1} / ${this.route.set.scenes.length} · ${(scene.guideSnapshot ?? scene.snapshot).falling.symbol.toUpperCase()}`;
    el('opener-guide').replaceChildren(...placementSteps(scene.path, this.callbacks.settings()).map(step => { const li = document.createElement('li'); li.textContent = step.text; return li; }));
    el('opener-route').querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-current', i === this.index ? 'step' : 'false'));
  }
}

export function suggestionCard(suggestion: OpenerSuggestion, action: () => void) {
  const button = document.createElement('button'); button.className = 'opener-card secondary';
  const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 120; canvas.setAttribute('aria-hidden', 'true');
  const title = document.createElement('strong'); title.textContent = `${suggestion.opener.name}${suggestion.mirror ? ' · Mirror' : ''}`;
  const small = document.createElement('small'); small.textContent = 'Click for assisted construction';
  const field = decoder.decode(suggestion.opener.fumen)[0].field, ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#090e18'; ctx.fillRect(0, 0, 200, 120);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) {
    let symbol = field.at(x, y).toLowerCase(); if (symbol === '_') continue;
    if (suggestion.mirror) symbol = ({ j: 'l', l: 'j', s: 'z', z: 's' })[symbol] ?? symbol;
    const px = (suggestion.mirror ? 9 - x : x) * 20, py = 100 - y * 20;
    if (!drawMino(ctx, symbol, px, py, 20)) { ctx.fillStyle = nativeColors[symbol] ?? '#7f8a9d'; ctx.fillRect(px + 1, py + 1, 18, 18); }
  }
  button.append(canvas, title, small); button.addEventListener('click', action); return button;
}
