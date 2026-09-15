import { openingOptions, saveOpeningOptions } from './opening-options';
import { prioritizeOpeners, shortlistCard, shortlistEvent } from './opener-shortlist';
import { decoder, Mino } from 'tetris-fumen';
import { compileOpener, openerCatalog, allOpeners, verifiedOpeners, type Opener, type OpenerRoute, type OpenerSuggestion } from './openers';
import { createEngine } from './engine';
import { drawBoard } from './renderer';
import { drawMino, nativeColors, minoAssetsEvent } from './mino-assets';
import { placementSteps } from './guide';
import type { Settings } from './settings';
import type { ModeRules } from './modes';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const storageKey = 'tetrio-trainer-openers-v1';
export function localOpeners(): Opener[] {
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(value) && value.length <= 100) return value.filter(item => item && typeof item.fumen === 'string' && item.fumen.length <= 50000 && typeof item.name === 'string').map(item => ({ id: String(item.id), name: item.name.slice(0, 80), fumen: item.fumen, note: 'Imported Fumen construction.', source: '', local: true })); } catch {}
  return [];
}
type Callbacks = { random: () => void; single: (opener: Opener) => void; settings: () => Settings; rules: () => ModeRules };

export class OpenersPage {
  private local: Opener[] = [];
  private selected: Opener = openerCatalog[0];
  private route: OpenerRoute | null = null;
  private index = 0;
  private catalogPage = 0;
  constructor(private callbacks: Callbacks) {
    this.local = localOpeners();
    el('openers-page').innerHTML = `<div class="page-title"><div><span class="eyebrow">OPENING TRAINING</span><h2 id="openers-title">Openers</h2></div><button id="opener-deal">Start random opening training</button></div><div class="opener-library-workspace"><aside class="workspace-panel catalog-panel" aria-label="Opener catalog"><h3>Find a construction</h3><label for="opener-search" class="visually-hidden">Find a construction</label><input id="opener-search" type="search" placeholder="TKI, PC, DT…"><label class="check-row"><input id="opener-ready" type="checkbox">Only validated constructions</label><p id="opener-count" class="muted"></p><div id="opener-catalog" class="opener-catalog"></div><div class="page-toolbar"><button id="catalog-prev" class="secondary small">Previous page</button><button id="catalog-next" class="secondary small">Next page</button></div><p id="opener-empty" class="muted" hidden>No matching constructions. Try another name or import a Fumen.</p><details><summary>Import your own Fumen</summary><form id="opener-import"><label for="opener-import-name">Construction name</label><input id="opener-import-name" maxlength="80" required placeholder="My opener"><label for="opener-fumen">Fumen code or URL</label><textarea id="opener-fumen" rows="4" maxlength="50000" required placeholder="v115@..."></textarea><p class="muted">One colored field or up to 64 continuous operation pages. Repeated pieces require operation pages. Validated before saving locally.</p><button type="submit">Validate and save Fumen</button><p id="opener-import-status" role="status"></p></form></details><details><summary>About the catalog</summary><p class="muted">${allOpeners.length} constructions from the open Opener Database and published references. Use the star to shortlist a construction. Shortlisted openers appear first here and in random opening searches. Targets use the active mode's board, rotation and spin rules; exhaustive queue coverage is not claimed.</p></details><p id="opener-deal-queue" class="muted"></p><p id="opener-deal-status" role="status"></p><div id="opener-candidates" class="opener-catalog"></div></aside><section class="opener-preview" aria-label="Construction preview"><h3 id="opener-name"></h3><canvas id="opener-board" width="240" height="552" aria-label="Selected opener step"></canvas><p id="opener-step" role="status"></p><div class="page-toolbar"><button id="opener-prev" class="secondary" aria-label="Previous opener step">Previous</button><button id="opener-next" class="secondary" aria-label="Next opener step">Next</button></div><button id="opener-start">Practice this opener</button><p id="opener-status" role="status"></p></section><aside class="workspace-panel opener-instructions" aria-label="Opener placement guidance"><span class="eyebrow">CURRENT PLACEMENT</span><h3>Build the next step</h3><ol id="opener-guide"></ol><details id="opener-full-route"><summary>Full construction</summary><ol id="opener-route" class="opener-route"></ol></details><label class="check-row"><input id="opener-continue" type="checkbox" checked>Keep board after construction</label><label class="check-row"><input id="opener-finesse" type="checkbox" checked>Perfect finesse</label><label class="check-row"><input id="opener-followups" type="checkbox">Continuation placement hints</label><details id="opener-training-options"><summary>Training options</summary><label class="check-row"><input id="opener-mirror" type="checkbox">Mirror</label><label class="check-row"><input id="opener-study" type="checkbox" checked>Study: 0G / manual lock</label><label class="check-row"><input id="opener-isomers" type="checkbox" checked>Equivalent structural variants</label><p class="muted">Each restart finds a new compatible seed and construction variant, using normal Hold. Turn off Study to keep mode timing. Wrong targets and finesse faults retry only the current piece. Completed opening steps stay on the board.</p></details><details id="opener-reference-details"><summary>Reference and mode rules</summary><p id="opener-note" class="muted"></p><a id="opener-source" target="_blank" rel="noopener noreferrer">Source diagram</a><p id="opener-rules" class="muted"></p></details><button id="opener-delete" class="secondary" hidden>Remove imported opener</button></aside></div>`;
    el('opener-search').addEventListener('input', () => { this.catalogPage = 0; this.catalog(); });
    el('opener-ready').addEventListener('change', () => { this.catalogPage = 0; this.catalog(); });
    window.addEventListener(shortlistEvent, () => { this.catalogPage = 0; this.catalog(); });
    el('catalog-prev').addEventListener('click', () => { this.catalogPage--; this.catalog(); });
    el('catalog-next').addEventListener('click', () => { this.catalogPage++; this.catalog(); });
    el('opener-deal').addEventListener('click', () => this.callbacks.random());
    const fields = { mirror: 'opener-mirror', continueAfter: 'opener-continue', study: 'opener-study', finesse: 'opener-finesse', isomers: 'opener-isomers', continuations: 'opener-followups' } as const;
    for (const [key, id] of Object.entries(fields)) {
      el<HTMLInputElement>(id).checked = openingOptions()[key as keyof typeof fields];
      el(id).addEventListener('change', () => { saveOpeningOptions({ [key]: el<HTMLInputElement>(id).checked }); this.refresh(); });
    }
    el('opener-prev').addEventListener('click', () => { this.index--; this.preview(); });
    el('opener-next').addEventListener('click', () => { this.index++; this.preview(); });
    el('opener-start').addEventListener('click', () => { if (this.route) this.callbacks.single(this.selected); });
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
    window.addEventListener(minoAssetsEvent, () => { this.catalog(); this.preview(); });
    this.catalog();
  }
  private options() { return { ...openingOptions(), loop: false }; }
  private catalog() {
    const search = el<HTMLInputElement>('opener-search').value.toLowerCase();
    const items = prioritizeOpeners([...allOpeners, ...this.local]).filter(opener => (!el<HTMLInputElement>('opener-ready').checked || verifiedOpeners.has(opener.id) || opener.local) && `${opener.name} ${opener.note}`.toLowerCase().includes(search));
    el('opener-empty').hidden = !!items.length;
    el('opener-count').textContent = `${items.length} constructions | Page ${this.catalogPage + 1} / ${Math.max(1, Math.ceil(items.length / 24))}`;
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
      return shortlistCard(button, opener.id, opener.name);
    }));
  }
  refresh() {
    for (const [key, id] of Object.entries({ mirror: 'opener-mirror', continueAfter: 'opener-continue', study: 'opener-study', finesse: 'opener-finesse', isomers: 'opener-isomers', continuations: 'opener-followups' })) el<HTMLInputElement>(id).checked = Boolean(openingOptions()[key as keyof ReturnType<typeof openingOptions>]);
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
  const tiles = suggestion.route.diagram, ctx = canvas.getContext('2d')!;
  const size = Math.min(20, 120 / Math.max(6, ...tiles.map(tile => tile.y + 1)));
  ctx.fillStyle = '#090e18'; ctx.fillRect(0, 0, 200, 120);
  for (const { x, y, symbol } of tiles) {
    const px = (200 - 10 * size) / 2 + x * size, py = 120 - (y + 1) * size;
    if (!drawMino(ctx, symbol, px, py, size)) { ctx.fillStyle = nativeColors[symbol] ?? '#7f8a9d'; ctx.fillRect(px + 1, py + 1, size - 2, size - 2); }
  }
  button.append(canvas, title, small); button.addEventListener('click', action); return button;
}
