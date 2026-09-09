import { Engine, Tetromino, legal, type EngineSnapshot, type EngineInitializeParams, type Mino } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import { countFinesseInputs, findFinesse, type Cell } from './finesse';
import { sameCells, type PracticeScene, type PracticeSet } from './practice';
import { defaults, type Settings } from './settings';

type Raw = Record<string, any>;
export type ReplayTrack = { name: string; kind: 'trainer' | 'native'; data: Raw; date?: string; endStats?: Raw };
const object = (value: unknown): Raw => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const symbols = new Set(['i', 'o', 't', 's', 'z', 'j', 'l']);
const keys = new Set(['moveLeft', 'moveRight', 'rotateCW', 'rotateCCW', 'rotate180', 'softDrop', 'hardDrop', 'hold']);

export function readReplay(value: unknown, name: string): ReplayTrack[] {
  const root = object(value);
  if (root.version === 1 && ['40l-finesse', 'fault-practice'].includes(root.mode) && Array.isArray(root.placements)) return [{ name, kind: 'trainer', data: root }];
  const tracks: ReplayTrack[] = [];
  function visit(value: unknown, label: string, depth = 0) {
    if (depth > 8 || tracks.length > 500) throw new Error('Replay contains too many nested rounds.');
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${label} · Round ${index + 1}`, depth + 1)); return; }
    const node = object(value);
    if (Array.isArray(node.events)) {
      const full = node.events.find((event: Raw) => event.type === 'full');
      let end: Raw | undefined;
      for (let index = node.events.length - 1; index >= 0; index--) if (node.events[index].type === 'end') { end = node.events[index]; break; }
      const username = node.options?.username ?? full?.data?.options?.username;
      tracks.push({ name: username && !label.toLowerCase().includes(String(username).toLowerCase()) ? `${label} · ${username}` : label, kind: 'native', data: node, date: root.ts, endStats: node.results?.stats ?? (!root.ismulti ? root.endcontext : undefined) ?? end?.data?.export?.stats ?? end?.data?.stats });
    } else if (Array.isArray(node.replays)) {
      node.replays.forEach((replay: Raw, index: number) => visit(replay, `${label} · ${node.board?.[index]?.user?.username ?? `Player ${index + 1}`}`, depth + 1));
    } else if (Array.isArray(node.rounds)) {
      node.rounds.forEach((round: Raw[], index: number) => round.forEach(player => visit(player.replay, `Round ${index + 1} · ${player.username ?? player.id ?? 'Player'}`, depth + 1)));
    } else if (node.replay) visit(node.replay, label, depth + 1);
    else if (node.data) visit(node.data, label, depth + 1);
  }
  visit(root, root.user?.username ?? name);
  if (!tracks.length) throw new Error('No replay events found. Choose a trainer JSON, TETR.IO .ttr or .ttrm file.');
  return tracks;
}

function boardState(value: unknown): EngineSnapshot['board'] {
  if (!Array.isArray(value) || value.length < 20 || value.length > 40) throw new Error('Only 10 × 20 boards with up to 20 buffer rows are supported.');
  const board = value.map(row => {
    if (!Array.isArray(row) || row.length !== 10) throw new Error('Replay contains an unsupported board size.');
    return row.map(tile => {
      if (tile === null) return null;
      const mino = typeof tile === 'string' ? tile : object(tile).mino;
      if (!symbols.has(mino) && mino !== 'gb') throw new Error('Replay contains an unsupported board tile.');
      return { mino: mino as Mino, connections: Number.isInteger(object(tile).connections) ? object(tile).connections & 31 : 0 };
    });
  });
  while (board.length < 40) board.push(Array(10).fill(null));
  return board;
}

function targetCells(value: unknown): Cell[] {
  if (!Array.isArray(value) || value.length !== 4 || value.some(cell => !Array.isArray(cell) || cell.length !== 2 || !cell.every(Number.isInteger) || cell[0] < 0 || cell[0] > 9 || cell[1] < 0 || cell[1] > 39)) throw new Error('Replay contains an invalid target.');
  if (new Set(value.map(cell => cell.join(','))).size !== 4) throw new Error('Replay target has duplicate cells.');
  return value.map(cell => [...cell] as Cell);
}

function sanitizeSnapshot(value: unknown, settings: Settings): EngineSnapshot {
  const raw = object(value), falling = object(raw.falling);
  if (!symbols.has(falling.symbol) || !Number.isInteger(falling.rotation) || falling.rotation < 0 || falling.rotation > 3 || !Array.isArray(falling.location) || falling.location.length !== 2 || !falling.location.every(Number.isFinite) || !Number.isInteger(falling.location[0]) || falling.location[0] < -3 || falling.location[0] > 9 || falling.location[1] < 0 || falling.location[1] >= 40) throw new Error('Replay contains an invalid falling piece.');
  const engine = createEngine(settings, 1);
  const snapshot = engine.snapshot({ isUndoRedo: true });
  snapshot.board = boardState(raw.board);
  const piece = new Tetromino({ symbol: falling.symbol, initialRotation: falling.rotation, boardWidth: 10, boardHeight: 20 });
  piece.location = [...falling.location] as Cell;
  snapshot.falling = piece.snapshot();
  if (!legal(piece.absoluteBlocks, snapshot.board)) throw new Error('The replay scene starts with an overlapping piece.');
  snapshot.hold = symbols.has(raw.hold) ? raw.hold : null;
  snapshot.holdLocked = !!raw.holdLocked;
  const next = raw.queue?.value;
  if (!Array.isArray(next) || !next.length || next.length > 100 || next.some(piece => !symbols.has(piece))) throw new Error('Replay scene has an invalid next queue.');
  snapshot.queue.value = [...next]; snapshot._queue.value = [...next];
  return snapshot;
}

function sceneFrom(snapshotValue: unknown, targetValue: unknown, settings: Settings, id: string): PracticeScene {
  const snapshot = sanitizeSnapshot(snapshotValue, settings), target = targetCells(targetValue);
  const engine = createEngine(settings, 1);
  if (!legal(target, snapshot.board)) throw new Error('The replay target overlaps the saved board.');
  const path = findFinesse(engine, snapshot, target);
  if (!path) throw new Error('A fault scene cannot be reached with the current handling. Try a finite soft drop factor.');
  return { id, snapshot, target, path };
}

function trainerScenes(track: ReplayTrack, settings: Settings): PracticeSet {
  const replay = track.data;
  if (replay.placements.length > 20000) throw new Error('Replay contains too many placements.');
  const retries = (Array.isArray(replay.events) ? replay.events : []).filter((event: Raw) => event.type === 'retry');
  let retryIndex = 0;
  const scenes: PracticeScene[] = [];
  for (const placement of replay.placements) {
    if (placement.reason === 'target') continue;
    if (placement.accepted !== false && (!placement.snapshot || !Array.isArray(placement.inputs))) continue;
    let snapshot = placement.snapshot;
    if (!snapshot) {
      while (retryIndex < retries.length) {
        const retry = retries[retryIndex++].data;
        if (Array.isArray(retry?.target) && sameCells(targetCells(retry.target), targetCells(placement.cells))) { snapshot = retry.snapshot; break; }
      }
    }
    if (!snapshot) throw new Error('This older replay is missing a fault snapshot. Record a new game and try again.');
    const scene = sceneFrom(snapshot, placement.cells, settings, `trainer-${scenes.length + 1}`);
    if (placement.accepted === false || countFinesseInputs(placement.inputs) > scene.path.cost) scenes.push(scene);
  }
  return { name: track.name, scenes };
}

function nativeConfig(options: Raw, track: ReplayTrack): EngineInitializeParams {
  if ((options.boardwidth ?? 10) !== 10 || (options.boardheight ?? 20) !== 20) throw new Error('Native replay practice currently supports 10 × 20 boards.');
  if (!['SRS', 'SRS+'].includes(options.kickset ?? 'SRS+') || (options.bagtype ?? '7-bag') !== '7-bag') throw new Error('This replay uses an unsupported rotation or randomizer mode.');
  if (!Number.isInteger(options.seed) || options.seed < 1 || options.seed > 2147483646) throw new Error('Native replay is missing a valid random seed.');
  const config = structuredClone(createEngine(defaults, options.seed).initializer);
  const number = (key: string, fallback: number) => {
    const value = options[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000) throw new Error(`Invalid replay option: ${key}.`);
    return value;
  };
  config.kickTable = options.kickset ?? 'SRS+';
  config.queue.type = options.bagtype ?? '7-bag';
  config.gravity = { value: number('g', .02), increase: number('gincrease', 0), marginTime: number('gmargin', 0) };
  const handling = object(options.handling);
  for (const key of ['arr', 'das', 'dcd', 'sdf'] as const) if (handling[key] !== undefined) {
    if (typeof handling[key] !== 'number' || !Number.isFinite(handling[key]) || handling[key] < 0 || handling[key] > 100) throw new Error('Replay contains invalid handling.');
    config.handling[key] = handling[key];
  }
  for (const key of ['cancel', 'safelock', 'may20g'] as const) if (typeof handling[key] === 'boolean') config.handling[key] = handling[key];
  for (const key of ['irs', 'ihs'] as const) if (['tap', 'hold', 'off'].includes(handling[key])) config.handling[key] = handling[key];
  config.options = { ...config.options, comboTable: options.combotable ?? 'multiplier', garbageBlocking: options.garbageblocking ?? 'combo blocking', garbageTargetBonus: options.garbagetargetbonus ?? 'none', spinBonuses: options.spinbonuses ?? 'T-spins', clutch: options.clutch ?? true };
  config.garbage = {
    ...config.garbage, seed: options.seed,
    cap: { absolute: number('garbageabsolutecap', 0), value: number('garbagecap', 8), increase: number('garbagecapincrease', 0), max: number('garbagecapmax', 40), marginTime: number('garbagecapmargin', 0) },
    garbage: { speed: number('garbagespeed', 20), holeSize: number('garbageholesize', 1) },
    multiplier: { value: number('garbagemultiplier', 1), increase: number('garbageincrease', 0), marginTime: number('garbagemargin', 10800) },
    messiness: { change: number('messiness_change', 1), within: number('messiness_inner', 0), nosame: !!options.messiness_nosame, timeout: number('messiness_timeout', 0), center: !!options.messiness_center },
    specialBonus: !!options.garbagespecialbonus, openerPhase: number('openerphase', 0), rounding: options.roundmode === 'rng' ? 'rng' : 'down'
  };
  config.b2b = { chaining: !options.b2bcharging, charging: options.b2bcharging ? { at: number('b2bcharge_at', 4), base: number('b2bcharge_base', 3) } : false };
  config.pc = { b2b: number('allclear_b2b', 0), garbage: number('allclear_garbage', 0) };
  config.misc.infiniteHold = !!options.infinite_hold;
  config.misc.allowed.spin180 = options.allow180 !== false;
  config.misc.allowed.hardDrop = options.allow_harddrop !== false && options.allowharddrop !== false;
  config.misc.allowed.hold = options.display_hold !== false;
  config.misc.movement.lockResets = number('lockresets', 15);
  config.misc.movement.lockTime = number('locktime', 30);
  config.misc.stride = !!options.stride;
  if (track.date && Number.isFinite(Date.parse(track.date))) config.misc.date = new Date(track.date);
  const opponents = new Set<number>();
  for (const event of track.data.events) {
    const data = event.data?.data;
    if (Number.isInteger(data?.gameid)) opponents.add(data.gameid);
    if (Array.isArray(data?.targets)) for (const id of data.targets) if (Number.isInteger(id)) opponents.add(id);
  }
  if (opponents.size) config.multiplayer = { opponents: [...opponents], passthrough: ['zero', 'limited', 'consistent', 'full'].includes(options.passthrough) ? options.passthrough : 'zero' };
  return config;
}

async function nativeScenes(track: ReplayTrack, settings: Settings, progress?: (text: string) => void): Promise<PracticeSet> {
  const columns = new Map<number, number>(), interactionIds = new Map<string, number>();
  const events: Game.Replay.Frame[] = track.data.events.map((event: Raw) => {
    if (event.type !== 'ige') return event;
    let data = object(event.data);
    for (let depth = 0; depth < 4 && data.type === 'ige'; depth++) data = object(data.data);
    if (['interaction', 'interaction_confirm'].includes(data.type) && data.data?.type === 'garbage') {
      const garbage = object(data.data);
      if (!Number.isFinite(garbage.amt) || garbage.amt < 0 || garbage.amt > 10000) throw new Error('Replay contains invalid garbage data.');
      if (Number.isInteger(garbage.column) && garbage.iid === undefined) {
        if (garbage.column < 0 || garbage.column > 9) throw new Error('Replay garbage column is outside the board.');
        const key = `${data.sender}:${data.cid}`;
        if (!interactionIds.has(key)) interactionIds.set(key, interactionIds.size + 1);
        const id = interactionIds.get(key)!;
        columns.set(id, garbage.column);
        data = { type: data.type, data: { ...garbage, iid: id, gameid: 1, ackiid: 0, size: 1 } };
      }
    }
    return { ...event, data };
  });
  if (!events.length || events.length > 300000) throw new Error('Native replay has an invalid event count.');
  const initial = events.find(event => event.type === 'full') as (Game.Replay.Frame & { data: Raw }) | undefined;
  const options = { ...object(initial?.data?.options), ...object(track.data.options) };
  const config = nativeConfig(options, { ...track, data: { ...track.data, events } });
  const engine = new Engine(config);
  if (columns.size) {
    const tank = engine.garbageQueue.tank.bind(engine.garbageQueue);
    engine.garbageQueue.tank = (...args) => tank(...args).map(garbage => ({ ...garbage, column: columns.get(garbage.id) ?? garbage.column }));
  }
  if (initial?.data?.game?.board) engine.board.state = boardState([...initial.data.game.board].reverse());
  let previous = -1;
  for (const event of events) {
    if (!Number.isInteger(event.frame) || event.frame < previous || event.frame > 216000) throw new Error('Replay has unordered frames or exceeds one hour.');
    previous = event.frame;
    if (event.type === 'keydown' || event.type === 'keyup') {
      if (!keys.has(event.data.key)) throw new Error(`Unsupported native replay input: ${event.data.key}.`);
      if (!Number.isFinite(event.data.subframe) || event.data.subframe < 0 || event.data.subframe >= 1) throw new Error('Replay contains invalid subframe timing.');
    }
  }
  let snapshot = engine.snapshot({ isUndoRedo: true });
  let priorInputs: Game.Key[] = [], keyOffset = 0;
  let locking: { snapshot: EngineSnapshot; target: Cell[]; inputs: Game.Key[]; offset: number } | null = null;
  const scenes: PracticeScene[] = [];
  engine.events.on('falling.lock.pre', () => { locking = { snapshot, target: engine.falling.absoluteBlocks, inputs: priorInputs, offset: keyOffset }; });
  engine.events.on('falling.new', ({ isHold }) => { priorInputs = []; keyOffset = engine.resCache.keys.length; if (isHold) snapshot = engine.snapshot({ isUndoRedo: true }); });
  engine.events.on('falling.lock', result => {
    if (locking) {
      const inputs = [...locking.inputs, ...result.keysPresses.slice(locking.offset)];
      const path = findFinesse(engine, locking.snapshot, locking.target);
      if (path && countFinesseInputs(inputs) > path.cost) scenes.push(sceneFrom(locking.snapshot, locking.target, settings, `native-${engine.frame}-${scenes.length}`));
    }
    snapshot = engine.snapshot({ isUndoRedo: true });
    locking = null;
  });
  let index = 0;
  while (index < events.length) {
    const batch: Game.Replay.Frame[] = [];
    while (index < events.length && events[index].frame === engine.frame) batch.push(events[index++]);
    const end = batch.find(event => event.type === 'end');
    const result = engine.tick(batch.filter(event => event.type !== 'end'));
    priorInputs.push(...result.keys.slice(keyOffset)); keyOffset = 0;
    if (end) break;
    if (engine.toppedOut && events.at(-1)!.frame - engine.frame > 10) throw new Error(`Replay simulation diverged near frame ${engine.frame}. This game version or mode is not supported.`);
    if (engine.frame % 600 === 0) { progress?.(`Analyzing ${track.name} · ${Math.round(engine.frame / Math.max(1, events.at(-1)!.frame) * 100)}%`); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  const final = track.endStats;
  if (final && ((Number.isInteger(final.piecesplaced) && final.piecesplaced !== engine.stats.pieces) || (Number.isInteger(final.lines) && final.lines !== engine.stats.lines))) throw new Error('Replay simulation does not match its final statistics. No practice scenes were imported.');
  const ending = [...events].reverse().find(event => event.type === 'end');
  const finalBoard = ending?.data?.export?.game?.board;
  if (finalBoard) {
    const tiles = (board: EngineSnapshot['board']) => JSON.stringify(board.map(row => row.map(tile => tile?.mino ?? null)));
    if (tiles(boardState([...finalBoard].reverse())) !== tiles(engine.board.state)) throw new Error('Replay simulation does not match its final board. No practice scenes were imported.');
  }
  return { name: track.name, scenes };
}

export async function loadPractice(track: ReplayTrack, settings: Settings, progress?: (text: string) => void): Promise<PracticeSet> {
  const set = track.kind === 'trainer' ? trainerScenes(track, settings) : await nativeScenes(track, settings, progress);
  if (!set.scenes.length) throw new Error('No finesse faults found in this replay under the d-002 rules.');
  return set;
}
