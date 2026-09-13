import { decoder } from 'tetris-fumen';
import type { TrainerGame } from './game';
import { createEngine } from './engine';
import { compileOpener, suggestOpeners, type Opener, type OpenerSuggestion } from './openers';
import { openingOptions, saveOpeningOptions } from './opening-options';
import { customRulesFromMode } from './analysis-context';
import { suggestionCard, localOpeners } from './openers-page';
import { shortlistedOpeners, prioritizeOpeners, shortlistCard, shortlistEvent } from './opener-shortlist';
import { ContinuationPanel } from './continuation-panel';
import type { CustomRules, ModeRules } from './modes';
import type { Settings } from './settings';
import type { PracticeSet } from './practice';

type Callbacks = { settings: () => Settings; rules: () => ModeRules; game: () => TrainerGame; pause: () => void; freeBuild: (seed: number, rules: CustomRules) => void; practice: (set: PracticeSet) => void };
type Session = { kind: 'single' | 'random'; source: ModeRules; opener?: Opener; seed: number };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const occupancy = (board: any[][]) => JSON.stringify(board.map(row => row.map(Boolean)));

export class OpeningTraining {
  private continuations = new ContinuationPanel();
  private session: Session | null = null;
  private choices: OpenerSuggestion[] = [];
  private selected: OpenerSuggestion | null = null;
  private token = 0;
  private busy = false;
  private observed: TrainerGame | null = null;
  private placements = -1;
  private built = false;
  constructor(private callbacks: Callbacks) {
    window.addEventListener(shortlistEvent, () => this.render());
    el<HTMLInputElement>('opener-keep-board').checked = openingOptions().continueAfter;
    el<HTMLInputElement>('opener-recommend-toggle').checked = openingOptions().recommend;
    el('opener-keep-board').addEventListener('change', () => {
      const value = el<HTMLInputElement>('opener-keep-board').checked;
      saveOpeningOptions({ continueAfter: value });
      const game = callbacks.game(); if (game.practice?.set.kind === 'opener') game.practice.set.continueAfter = value;
      el('opener-keep-board').blur();
    });
    el('opener-recommend-toggle').addEventListener('change', () => {
      saveOpeningOptions({ recommend: el<HTMLInputElement>('opener-recommend-toggle').checked });
      this.observed = null;
      if (!openingOptions().recommend && !this.session) el('opener-references').hidden = true;
      el('opener-recommend-toggle').blur();
    });
  }
  get active() { return !!this.session; }
  suspend() { this.continuations.suspend(); }
  clear() { this.continuations.clear(); this.session = null; this.token++; this.busy = false; this.selected = null; this.choices = []; el('opener-references').hidden = true; }
  finesse(enabled: boolean) {
    if (!this.session) return;
    saveOpeningOptions({ finesse: enabled });
    for (const choice of this.choices) { choice.route.set.finesseEnabled = enabled; if (choice.route.set.customRules) choice.route.set.customRules.finesse = enabled; }
  }
  startRandom() { this.session = { kind: 'random', source: structuredClone(this.callbacks.rules()), seed: 0 }; void this.restart(); }
  startSingle(opener: Opener) { this.session = { kind: 'single', source: structuredClone(this.callbacks.rules()), opener, seed: 0 }; void this.restart(); }
  restart(): boolean {
    if (!this.session) return false;
    void this.prepare(this.session.kind === 'single' ? this.session.opener : undefined);
    return true;
  }
  private freeRules(source: ModeRules, seed: number) {
    const options = openingOptions(), custom = customRulesFromMode(source);
    Object.assign(custom, { initialGarbage: 0, infiniteHold: false, lineGoal: 0, pieceGoal: 0, timeLimit: 0, finesse: options.finesse, seed });
    Object.assign(custom.advanced, { map: '', sequence: '', repeatSequence: false, garbageRefill: 0, garbageInterval: 0 });
    if (options.study) { custom.gravity = 0; custom.infiniteLock = true; custom.advanced.gravityIncrease = 0; }
    return custom;
  }
  private async prepare(opener?: Opener) {
    const session = this.session; if (!session) return;
    const token = ++this.token; this.busy = true; this.built = false;
    this.callbacks.pause(); location.hash = 'play';
    el('opener-references').hidden = false; el('opener-session-options').hidden = false; el<HTMLInputElement>('opener-keep-board').checked = openingOptions().continueAfter;
    el('opener-reference-status').textContent = opener ? 'Finding a new seed and construction variant…' : 'Dealing the next seed and checking candidates…';
    el('opener-reference-cards').replaceChildren();
    try {
      const rules = session.source, settings = this.callbacks.settings(), options = { ...openingOptions(), loop: false, shortlist: shortlistedOpeners(), extraOpeners: localOpeners() };
      if (rules.board.width !== 10 || rules.bag !== '7-bag') throw new Error('Opening training requires a 10-column, 7-bag mode. Other board sizes remain available on Play.');
      const randomSeed = () => { let seed: number; do { seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646 + 1; } while (seed === session.seed); return seed; };
      let seed = randomSeed();
      let choices: OpenerSuggestion[] = [];
      if (opener && decoder.decode(opener.fumen).some(page => page.operation)) {
        choices = [{ opener, route: compileOpener(opener, settings, rules, { ...options, variantSeed: seed }), mirror: options.mirror }];
      } else if (opener) {
        const deadline = performance.now() + 12000;
        for (let attempt = 0; attempt < 256; attempt++) {
          if (attempt) seed = randomSeed();
          const engine = createEngine(settings, seed, { ...rules, advanced: { ...rules.advanced, sequence: '' } });
          const deal = { seed, queue: [engine.falling.symbol, ...engine.queue.slice(0, 6)] };
          try {
            let route = compileOpener(opener, settings, rules, { ...options, isomers: attempt < 6 && options.isomers, variantSeed: seed, deal });
            if (attempt >= 6 && options.isomers) route = compileOpener(opener, settings, rules, { ...options, variantSeed: seed, deal });
            choices = [{ opener, route, mirror: options.mirror }]; break;
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 0)); if (token !== this.token) return;
          if (performance.now() >= deadline) break;
        }
        if (!choices.length) throw new Error('No compatible seeded construction was found under these rules. Choose another opener or rotation system.');
      } else {
        const engine = createEngine(settings, seed, { ...rules, advanced: { ...rules.advanced, sequence: '' } });
        choices = await suggestOpeners(settings, rules, { seed, queue: [engine.falling.symbol, ...engine.queue.slice(0, 6)] }, { ...options, variantSeed: seed }, () => { if (token !== this.token) throw new Error('Search canceled.'); });
      }
      if (token !== this.token) return;
      session.seed = seed; this.choices = choices; this.selected = null;
      if (opener) this.select(choices[0]); else this.callbacks.freeBuild(seed, this.freeRules(rules, seed));
      el('opener-references').hidden = false; el('opener-session-options').hidden = false;
      this.observed = this.callbacks.game(); this.placements = -1; this.render();
      el('opener-reference-status').textContent = `${seed} · ${opener ? 'Seeded construction' : `${choices.length} candidate openers`} · Press R for the next seed.`;
    } catch (error) { if (token === this.token) el('opener-reference-status').textContent = (error as Error).message; }
    finally { if (token === this.token) this.busy = false; }
  }
  private select(choice: OpenerSuggestion) {
    this.selected = choice; this.built = false;
    const set = structuredClone(choice.route.set), options = openingOptions();
    set.continueAfter = options.continueAfter; set.loop = false; set.finesseEnabled = options.finesse;
    this.callbacks.practice(set);
    el('opener-references').hidden = false; el('opener-session-options').hidden = false;
    this.observed = this.callbacks.game(); this.placements = -1;
    el('opener-reference-status').textContent = `${choice.opener.name} · Seed ${set.seed} · Match each target. R deals another seed.`;
    this.render();
  }
  private render() {
    const choices = prioritizeOpeners(this.choices.map(choice => ({ ...choice, id: choice.opener.id })));
    el('opener-reference-cards').replaceChildren(...choices.map(choice => {
      const button = suggestionCard(choice, () => {
        if (!this.session) this.session = { kind: 'single', source: structuredClone(this.callbacks.rules()), opener: choice.opener, seed: choice.route.set.seed ?? 0 };
        this.select(choice);
      });
      button.setAttribute('aria-pressed', String(this.selected?.opener.id === choice.opener.id)); return shortlistCard(button, choice.opener.id, choice.opener.name);
    }));
    el('opener-reference-title').textContent = this.session?.kind === 'single' ? 'Opener construction' : 'Candidate openers';
  }
  update(game: TrainerGame) {
    this.continuations.update(game, this.selected?.opener ?? null, this.built && !this.busy, !!this.session || openingOptions().recommend);
    if (this.busy) return;
    if (game !== this.observed) {
      this.observed = game; this.placements = -1; this.built = false;
      if (!this.session && openingOptions().recommend) void this.advise(game);
    }
    if (!this.session && !openingOptions().recommend) return;
    if (game.placements.length === this.placements) return;
    this.placements = game.placements.length;
    if (game.practice?.set.kind === 'opener' && game.practice.finished) {
      if (!this.built) {
        this.built = true;
        el('opener-reference-status').textContent = 'Construction complete. Continue on this board, or press R for a new seed.';
        if (!game.practice.set.continueAfter && this.session && this.selected) void this.prepare(this.selected.opener);
      }
      return;
    }
    if (game.practice || this.built || game.engine.stats.pieces > 7) return;
    const built = this.choices.find(choice => game.engine.stats.pieces === choice.route.set.scenes.length && game.engine.stats.lines === choice.route.results.reduce((sum, result) => sum + result.lines, 0) && occupancy(game.engine.board.state) === occupancy(choice.route.finalBoard));
    if (built) {
      this.built = true; this.selected = built;
      el('opener-reference-status').textContent = `${built.opener.name} complete. Board retained; continue playing or press R for the next seed.`;
      if (this.session && !openingOptions().continueAfter) void this.prepare(built.opener);
    }
  }
  private async advise(game: TrainerGame) {
    const token = ++this.token;
    el('opener-references').hidden = false; el('opener-session-options').hidden = true;
    this.choices = []; this.selected = null; this.render();
    if (game.engine.stats.pieces || game.engine.board.state.some(row => row.some(Boolean))) { el('opener-reference-status').textContent = 'Opener recommendations start from an empty opening. Restart to analyze a new seed.'; return; }
    el('opener-reference-status').textContent = 'Checking this mode and its opening queue…';
    try {
      const choices = await suggestOpeners(game.settings, game.rules, { seed: game.seed, queue: [game.engine.falling.symbol, ...game.engine.queue.slice(0, 6)] }, { ...openingOptions(), loop: false, shortlist: shortlistedOpeners(), extraOpeners: localOpeners() }, () => { if (token !== this.token) throw new Error('Search canceled.'); });
      if (token !== this.token || game !== this.callbacks.game()) return;
      this.choices = choices; this.selected = null; this.render();
      el('opener-reference-status').textContent = `${choices.length} candidate openers for this seed. Click a diagram to start assisted practice.`;
    } catch (error) { if (token === this.token) el('opener-reference-status').textContent = (error as Error).message; }
  }
}
