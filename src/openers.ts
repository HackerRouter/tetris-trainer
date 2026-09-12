import { decoder, Mino as FumenMino } from 'tetris-fumen';
import { legal, type Engine, type EngineSnapshot, type Mino } from '@haelp/teto/engine';
import catalog from './opener-catalog.json';
import library from './opener-library.json';
import verified from './opener-verified.json';
import { createEngine, spawnSnapshot } from './engine';
import { copyPiece, findFinesse, type Cell, type FinesseResult } from './finesse';
import { type PracticeScene, type PracticeSet } from './practice';
import { customRulesFromMode, analysisContext } from './analysis-context';
import { modeDefinitions, type ModeRules } from './modes';
import type { Settings } from './settings';

export type Opener = { id: string; name: string; note: string; source: string; fumen: string; sourceFumen?: string; local?: boolean; finish?: { piece: string; lines: number } };
export const openerCatalog: Opener[] = catalog;
export const openerLibrary: Opener[] = library;
export const allOpeners = [...openerCatalog, ...openerLibrary.filter(opener => !['db-171', 'db-444', 'db-458', 'db-205', 'db-234', 'db-111'].includes(opener.id))];
export const verifiedOpeners = new Set(verified);
export type OpenerSuggestion = { opener: Opener; route: OpenerRoute; mirror: boolean };
export type OpenerOptions = { mirror: boolean; loop: boolean; study: boolean; finesse: boolean; deal?: { seed: number; queue: Mino[] } };
export type OpenerRoute = { set: PracticeSet; finalBoard: EngineSnapshot['board']; results: { lines: number; spin: string; piece: string; attack: number }[]; rules: ModeRules };
const mirrorSymbol = (symbol: string) => ({ j: 'l', l: 'j', s: 'z', z: 's' })[symbol] ?? symbol;
const boardKey = (board: EngineSnapshot['board']) => JSON.stringify(board.map(row => row.map(tile => tile?.mino ?? null)));

export async function suggestOpeners(settings: Settings, rules: ModeRules, deal: NonNullable<OpenerOptions['deal']>, options: Omit<OpenerOptions, 'deal' | 'mirror'>, progress?: (checked: number) => void) {
  const candidates: OpenerSuggestion[] = [];
  if (rules.board.width !== 10 || rules.bag !== '7-bag') throw new Error('First-bag suggestions currently require a 10-column, 7-bag mode.');
  const seen = new Set<string>();
  const pool = allOpeners.filter(opener => verifiedOpeners.has(opener.id));
  for (let i = 0; i < pool.length; i++) {
    for (const mirror of [false, true]) {
      try {
        const route = compileOpener(pool[i], settings, rules, { ...options, mirror, deal });
        const key = boardKey(route.finalBoard);
        if (!seen.has(key)) { candidates.push({ opener: pool[i], route, mirror }); seen.add(key); }
        break;
      } catch {}
    }
    if (candidates.length >= 6) break;
    if (i % 12 === 0) { progress?.(i + 1); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  return candidates;
}

export function executePath(engine: Engine, path: FinesseResult) {
  for (const move of path.moves) {
    if (move === 'down' || move === 'softDrop') {
      if (move === 'down') engine.falling.y--; else engine.falling.softDrop(engine.board.state);
      engine.lastSpin = null;
    } else engine.press(move);
  }
  return engine.hardDrop();
}

export function compileOpener(opener: Opener, settings: Settings, mode: ModeRules, options: OpenerOptions): OpenerRoute {
  if (mode.board.width !== 10) throw new Error(`This Fumen uses 10 columns. The active mode has ${mode.board.width}; select a 10-column mode on Play first.`);
  if (!mode.advanced.hardDrop) throw new Error('These construction drills require hard drop. Enable it in the active mode first.');
  if (!opener.fumen) throw new Error('This catalog entry has source material only. Open its source to explore the construction.');
  if (opener.fumen.length > 50000) throw new Error('Fumen must be between 1 and 50,000 characters.');
  let pages;
  try { pages = decoder.decode(opener.fumen); } catch { throw new Error('Invalid Fumen code or URL.'); }
  if (!pages.length || pages.length > 64) throw new Error('Import 1–64 Fumen pages.');
  if (pages.some(page => page.flags.rise || page.flags.mirror)) throw new Error('Fumen pages with rise or mirror transitions are not supported. Use the Mirror switch for a whole route.');
  const custom = customRulesFromMode(mode);
  Object.assign(custom, { initialGarbage: 0, hold: false, infiniteHold: false, nextCount: 0, lineGoal: 0, pieceGoal: 0, timeLimit: 0, undo: false, finesse: options.finesse, topout: 'stop' });
  Object.assign(custom.advanced, { map: '', sequence: '', repeatSequence: false, garbageRefill: 0, garbageInterval: 0 });
  if (options.deal) { custom.hold = mode.hold; custom.nextCount = mode.nextCount; }
  if (options.study) { custom.gravity = 0; custom.infiniteLock = true; custom.advanced.gravityIncrease = 0; }
  const rules = modeDefinitions.custom.rules({ ...settings, custom }), engine = createEngine(settings, options.deal?.seed ?? 1, rules);
  if (options.deal) {
    if (options.deal.queue.length !== 7 || new Set(options.deal.queue).size !== 7 || options.deal.queue.some(piece => !'ijlostz'.includes(piece))) throw new Error('First-bag suggestions require one complete seven-piece bag.');
    const initial = engine.snapshot(); initial.falling = spawnSnapshot(engine, options.deal.queue[0]);
    initial.queue.value = [...options.deal.queue.slice(1), ...initial.queue.value.slice(6)]; initial._queue.value = [...initial.queue.value]; engine.fromSnapshot(initial);
  }
  const scenes: PracticeScene[] = [], results: OpenerRoute['results'] = [];
  const cellsFor = (cells: Cell[]) => cells.map(([x, y]) => [options.mirror ? 9 - x : x, y] as Cell);
  const symbolFor = (symbol: string) => (options.mirror ? mirrorSymbol(symbol.toLowerCase()) : symbol.toLowerCase()) as Mino;
  const makeScene = (symbol: Mino, target: Cell[]): PracticeScene | null => {
    if (target.some(([x, y]) => x < 0 || x >= rules.board.width || y < 0 || y >= rules.board.height) || !legal(target, engine.board.state)) return null;
    const occupied = new Set(target.map(cell => cell.join(',')));
    if (!target.some(([x, y]) => y === 0 || (!occupied.has(`${x},${y - 1}`) && engine.board.state[y - 1][x]))) return null;
    const beforeHold = engine.snapshot({ isUndoRedo: true });
    let holdFirst = false;
    if (options.deal && symbol !== engine.falling.symbol) {
      if (!rules.hold || (engine.held ?? engine.queue.slice(0, 1)[0]) !== symbol) return null;
      engine.press('hold'); holdFirst = true;
    }
    const snapshot = engine.snapshot({ isUndoRedo: true });
    if (!options.deal) { snapshot.falling = spawnSnapshot(engine, symbol); snapshot.lastSpin = null; snapshot.hold = null; snapshot.holdLocked = false; }
    const context = analysisContext(rules, settings, snapshot);
    const path = findFinesse(engine, context.snapshot, target);
    return path ? { id: `${opener.id}-${scenes.length + 1}`, snapshot: holdFirst ? beforeHold : snapshot, guideSnapshot: holdFirst ? snapshot : undefined, holdFirst, target, path } : null;
  };
  const place = (scene: PracticeScene) => {
    const snapshot = scene.guideSnapshot ?? scene.snapshot;
    engine.fromSnapshot(snapshot);
    const probe = copyPiece(engine, snapshot.falling);
    if (!legal(probe.absoluteBlocks, snapshot.board)) throw new Error('The opener starts above the available board space.');
    const result = executePath(engine, scene.path);
    results.push({ lines: result.lines, spin: result.spin, piece: result.mino, attack: result.garbage.reduce((sum, value) => sum + value, 0) });
    scenes.push(scene);
  };
  const operations = pages.filter(page => page.operation);
  if (operations.length) {
    if (options.deal) throw new Error('Random-bag suggestions currently use first-bag colored constructions.');
    if (operations.length !== pages.length || pages.some(page => !page.flags.lock)) throw new Error('Every page in a move sequence must contain a locked operation.');
    for (const page of pages) {
      const expected = engine.board.state.map(row => row.map(() => null)) as EngineSnapshot['board'];
      for (let y = -1; y < 23; y++) for (let x = 0; x < 10; x++) {
        const tile = page.field.at(x, y);
        if (tile === '_') continue;
        if (y < 0 || y >= rules.board.height) throw new Error('Fumen blocks exceed the active board height or use garbage below the floor.');
        expected[y][options.mirror ? 9 - x : x] = { mino: tile === 'X' ? 'gb' as Mino : symbolFor(tile), connections: 0 };
      }
      if (scenes.length && boardKey(expected) !== boardKey(engine.board.state)) throw new Error(`Page ${page.index + 1} edits the board between moves. Import a continuous construction sequence.`);
      engine.board.state = expected;
      const target = cellsFor(FumenMino.from(page.operation!).positions().map(({ x, y }) => [x, y]));
      const scene = makeScene(symbolFor(page.operation!.type), target);
      if (!scene) throw new Error(`Page ${page.index + 1} is unreachable with ${rules.advanced.kickSet}, this board or the current soft drop settings.`);
      place(scene);
    }
  } else {
    if (pages.length !== 1) throw new Error('For colored diagrams, import one construction at a time. Use operation pages for longer sequences.');
    const targets = new Map<Mino, Cell[]>();
    for (let y = -1; y < 23; y++) for (let x = 0; x < 10; x++) {
      const symbol = pages[0].field.at(x, y);
      if (symbol === '_') continue;
      if (symbol === 'X' || y < 0 || y >= rules.board.height) throw new Error('A colored construction must use tetromino colors within the board, without gray or garbage cells.');
      const piece = symbolFor(symbol); if (!targets.has(piece)) targets.set(piece, []);
      targets.get(piece)!.push(...cellsFor([[x, y]]));
    }
    if (!targets.size || [...targets.values()].some(cells => cells.length !== 4)) throw new Error('A colored construction must contain exactly four cells per used piece color. Use operation pages for repeated pieces.');
    const failed = new Set<string>();
    const search = (remaining: [Mino, Cell[]][]): boolean => {
      if (!remaining.length) return !opener.finish || results.some(result => result.piece === symbolFor(opener.finish!.piece) && result.lines >= opener.finish!.lines);
      const signature = `${boardKey(engine.board.state)}:${engine.falling.symbol}:${engine.held}:${engine.queue.slice(0, 7).join('')}:${remaining.map(([symbol]) => symbol).join('')}`;
      if (failed.has(signature)) return false;
      const before = engine.snapshot({ isUndoRedo: true });
      for (const [symbol, target] of remaining) {
        engine.fromSnapshot(before);
        const scene = makeScene(symbol, target); if (!scene) continue;
        const rows = engine.board.state.map((row, y) => row.every((tile, x) => tile || target.some(([tx, ty]) => tx === x && ty === y)) ? y : -1).filter(y => y >= 0);
        place(scene);
        if (search(remaining.filter(([other]) => other !== symbol).map(([piece, cells]) => [piece, cells.map(([x, y]) => [x, y - rows.filter(row => row < y).length] as Cell)]))) return true;
        scenes.pop(); results.pop(); engine.fromSnapshot(before);
      }
      failed.add(signature);
      return false;
    };
    if (!search([...targets].sort(([a], [b]) => Number(a === 't') - Number(b === 't')))) throw new Error(`No construction route was found with ${rules.advanced.kickSet} and the current handling. Try another rotation system or finite soft drop.`);
  }
  return { set: { name: `${opener.name}${options.mirror ? ' · Mirror' : ''}`, kind: 'opener', scenes, customRules: custom, allow180: rules.allow180, loop: options.loop, finesseEnabled: options.finesse, allowHold: !!options.deal && rules.hold }, rules, results, finalBoard: structuredClone(engine.board.state) };
}
