import { actionText, type ActionText } from './action-text';
import { clearedRows } from './board-effects';
import type { Engine, EngineSnapshot, TetrominoSnapshot } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import { applyModeSetup, modeDefinitions, type ModeRules } from './modes';
import { nativeScenes, type ReplayTrack } from './replay';
import { RoomRuntime } from './room-runtime';
import { applyDasPrecharge } from './das-precharge';
import type { Settings } from './settings';
import type { TrainerReplay } from './history';
import { replayTimeline } from './timeline';
import { QuickPlayRuntime, type QpCheckpoint } from './qp-runtime';
import type { QpViewState } from './qp-board-view';
import type { ReviveState } from './revive-tasks';
import { qpSounds } from './qp-sound';
import { validateSettings } from './settings';
import { placementSounds } from './sound-events';
import { SpinTracker } from './spin-tracker';
import type { Cell } from './finesse';
import type { PlacementEffect } from './renderer';
import { qpVisual, type QpVisual } from './qp-mod-state';

export type QpPlaybackFrame = { visual: QpVisual; view: QpViewState; altitude: number; rank: number; floor: number; life: string; pending: number; revives: number; task: ReviveState | null; partner: { visual: QpVisual; board: EngineSnapshot['board']; piece: TetrominoSnapshot | null; life: string; task: ReviveState | null; revives: number; hold: string | null; holdLocked: boolean; next: string[] } | null };
export type PlaybackFrame = { qp?: QpPlaybackFrame; analysis: Pick<EngineSnapshot, 'stats' | 'lastSpin' | 'lastWasClear'> & { pendingGarbage: boolean; unavailable: boolean }; actionEffects: ActionText[]; time: number; board: EngineSnapshot['board']; piece: TetrominoSnapshot | null; hold: string | null; holdLocked: boolean; next: string[]; pieces: number; lines: number; inputs: number; holds: number; perfects: number; target: Cell[] | null; effect: PlacementEffect | null; effectTime: number; label: string; sounds: string[] };
export type Playback = { name: string; engine: Engine; frames: PlaybackFrame[]; duration: number; rules: ModeRules; settings: Settings; trainingFaults: number; modeName: string; qpScenes?: QpCheckpoint[]; qpRecording?: TrainerReplay };

export async function buildPlayback(track: ReplayTrack, settings: Settings, progress?: (text: string) => void): Promise<Playback> {
  const frames: PlaybackFrame[] = [];
  let qp: QuickPlayRuntime | undefined, qpEvents = 0;
  const qpScenes: QpCheckpoint[] = [];
  let savedPieces = -1, viewKey = '', viewSides: QpViewState['sides'] = [];
  let partnerBoard: EngineSnapshot['board'] = [], partnerKey = '';
  let boardKey = '', board: EngineSnapshot['board'] = [], lastEngine: Engine | null = null;
  let rules = modeDefinitions.sprint.rules(settings), displaySettings = settings, room: RoomRuntime | undefined;
  let inputs = 0, holds = 0, completed = 0, perfects = 0, target: Cell[] | null = null;
  let effect: PlacementEffect | null = null, effectTime = -1, sounds: string[] = [];
  let actionEffects: ActionText[] = [];
  let previous: { x: number; y: number; rotation: number } | null = null;
  const collect = (engine: Engine, label = '') => {
    if (!lastEngine) {
      new SpinTracker(engine, spin => { sounds.push('rotate'); if (spin !== 'none') sounds.push('spin'); });
      let cells: Cell[] = [], rows: number[] = [];
      engine.events.on('falling.lock.pre', () => { cells = engine.falling.absoluteBlocks; rows = clearedRows(engine.board.state, cells); });
      engine.events.on('falling.new', ({ isHold }) => { if (isHold) { holds++; sounds.push('hold'); } });
      engine.events.on('falling.lock', result => {
        actionEffects = [...actionEffects.filter(item => item.frame >= engine.frame - 300), actionText(engine, result)].slice(-64);
        const hardDrop = result.keysPresses.includes('hardDrop');
        effect = { rows, cells, piece: result.mino, hardDrop, lines: result.lines };
        effectTime = (engine.frame + 1) / 60;
        sounds.push(...placementSounds(engine, result, hardDrop)); completed++;
      });
    }
    lastEngine = engine;
    const key = JSON.stringify(engine.board.state);
    if (key !== boardKey) { boardKey = key; board = structuredClone(engine.board.state); }
    const piece = engine.falling;
    if (previous && !sounds.includes('floor') && !sounds.includes('hold') && !label) {
      if (piece.x !== previous.x) sounds.push('move');
      if (piece.y < previous.y && engine.input.keys.softDrop) sounds.push('softdrop');
    }
    previous = { x: piece.x, y: piece.y, rotation: piece.rotation };
    let qpFrame: QpPlaybackFrame | undefined;
    if (qp) {
      const side = qp.sides[0], ally = qp.sides[1];
      if (ally) { const key = JSON.stringify(ally.engine.board.state); if (key !== partnerKey) { partnerKey = key; partnerBoard = structuredClone(ally.engine.board.state); } }
      const sides = qp.sides.map(partner => ({ engine: { board: { height: partner.engine.board.height, state: partner.engine.board.state } }, life: partner.life, task: partner.task, garbage: partner.garbage, feedback: partner.feedback })), signature = JSON.stringify(sides);
      if (viewKey !== signature) { viewKey = signature; viewSides = structuredClone(sides); }
      qpFrame = { visual: structuredClone(qpVisual(side, qp.frame, true)), view: { frame: qp.frame, sides: viewSides, events: qp.events.filter(event => event.frame >= qp!.frame - 24) }, altitude: qp.climb.altitude, rank: qp.climb.rank, floor: Math.max(1, qp.climb.floor), life: side.life, pending: side.garbage.entering.length + side.garbage.pending.reduce((sum, packet) => sum + packet.amount, 0), revives: side.revives, task: structuredClone(side.task), partner: ally ? { visual: structuredClone(qpVisual(ally, qp.frame, true)), board: partnerBoard, piece: ally.life === 'alive' ? ally.engine.falling.snapshot() : null, life: ally.life, task: structuredClone(ally.task), revives: ally.revives, hold: ally.engine.held, holdLocked: ally.engine.holdLocked, next: ally.engine.queue.slice(0, ally.rules.nextCount) } : null };
      if (savedPieces !== engine.stats.pieces || qp.frame % 300 === 0) { qpScenes.push(qp.checkpoint()); savedPieces = engine.stats.pieces; }
      for (const event of qp.events.slice(qpEvents)) sounds.push(...qpSounds(event)); qpEvents = qp.events.length;
    }
    const state: PlaybackFrame = { qp: qpFrame, analysis: { stats: structuredClone(engine.stats), lastSpin: engine.lastSpin, lastWasClear: engine.lastWasClear, pendingGarbage: engine.garbageQueue.size > 0 || !!qpFrame?.pending, unavailable: engine.glock > 0 || !!room?.waiting }, actionEffects, time: engine.frame / 60, board, piece: engine.toppedOut || room?.waiting || qp && qp.sides[0].life !== 'alive' ? null : piece.snapshot(), hold: engine.held, holdLocked: engine.holdLocked, next: engine.queue.slice(0, rules.nextCount), pieces: track.kind === 'trainer' && track.data.practice ? completed : engine.stats.pieces, lines: engine.stats.lines, inputs, holds, perfects, target, effect, effectTime, label, sounds };
    if (frames.at(-1)?.time === state.time) { state.sounds = [...frames.at(-1)!.sounds, ...sounds]; frames[frames.length - 1] = state; }
    else frames.push(state);
    sounds = [];
  };
  if (track.kind === 'native') {
    let lastFrame = 0;
    const keys = track.data.events.filter((event: any) => event.type === 'keydown');
    let keyIndex = 0;
    await nativeScenes(track, settings, progress, (engine, mode, runtime, count) => {
      rules = mode; room = runtime; perfects = count; displaySettings = { ...settings, handling: { ...engine.handling } };
      while (keyIndex < keys.length && keys[keyIndex].frame < engine.frame) { inputs++; keyIndex++; }
      lastFrame = engine.frame; collect(engine);
    });
    const duration = Number(track.endStats?.finaltime) / 1000;
    if (Number.isFinite(duration) && duration >= 0 && duration <= (lastFrame + 2) / 60 && duration >= (lastFrame - 2) / 60) frames.at(-1)!.time = duration;
    const reason = track.data.events.at(-1)?.data?.reason;
    if (reason === 'clear') frames.at(-1)!.sounds.push('finish');
    if (reason === 'topout') frames.at(-1)!.sounds.push('failure');
  } else {
    const replay = track.data as TrainerReplay;
    if (!Array.isArray(replay.events) || !Array.isArray(replay.placements)) throw new Error('Invalid replay event list.');
    const tape = replayTimeline(replay);
    if (replay.mode === 'zenith') {
      replay.settings = validateSettings(replay.settings);
      if (!replay.quickplay || replay.quickplay.revision !== 'tetrio-v19-20260714' || !Array.isArray(replay.quickplay.events)) throw new Error('This Quick Play recording has an unsupported rule revision or missing runtime events.');
    }
    displaySettings = replay.settings;
    rules = { ...modeDefinitions[replay.modeRules.id].rules(replay.settings), ...replay.modeRules };
    const engine = createEngine(replay.settings, replay.seed, rules), practice = replay.mode === 'fault-practice';
    room = new RoomRuntime(engine, rules, practice, replay.seed);
    applyModeSetup(engine, rules, replay.seed); room.refill();
    let index = 0, qpIndex = 0;
    if (replay.mode === 'zenith') {
      qp = new QuickPlayRuntime(replay.settings, replay.seed, engine);
      const scene = replay.events.find(event => event.type === 'qp-scene');
      if (scene) qp.initializeScene(scene.data as QpCheckpoint);
    }
    collect(engine);
    engine.events.on('falling.lock', result => { room!.locked(result); room!.refill(); });
    while (engine.frame <= tape.frames) {
      const keys: Game.Replay.Frame[] = [];
      let label = '';
      while (index < tape.events.length && tape.events[index].frame === engine.frame) {
        const event = tape.events[index++], data = event.data;
        if (event.type === 'keydown' || event.type === 'keyup') { keys.push(event as Game.Replay.Frame); if (event.type === 'keydown') inputs++; }
        else if (event.type === 'das-precharge') { inputs += applyDasPrecharge(engine, data.charge).length; }
        else if (['checkpoint', 'clear-field', 'practice-scene'].includes(event.type) && data.snapshot) {
          const snapshot = structuredClone(data.snapshot); snapshot.__meta.isUndoRedo = true;
          engine.fromSnapshot(snapshot); room.restore(data.room ?? room.state, engine.frame, snapshot.frame);
          previous = null;
          if (event.type === 'clear-field' || event.type === 'practice-scene') actionEffects = [];
          if (event.type === 'practice-scene') { target = data.target ?? replay.placements.find(p => p.accepted && p.snapshot.falling.symbol === snapshot.falling.symbol)?.cells ?? null; label = `Scene ${data.index + 1}`; }
          if (event.type === 'clear-field') { sounds.push('boardappear'); label = 'Clear board'; }
        } else if (event.type === 'practice-complete') { room.setPractice(false); target = null; label = 'Construction complete'; }
        else if (event.type === 'placement') {
          const placement = replay.placements[data.index];
          if (!placement?.accepted) throw new Error('Invalid effective placement marker.');
          if (placement.finesse && placement.finesseInputs <= placement.finesse.cost) perfects++;
        } else if (event.type === 'release-all') {
          if (qp) qp.release(qp.sides[0]);
          engine.falling.irs = 0; engine.state &= ~1024;
          engine.input.lShift.held = engine.input.rShift.held = false;
          engine.input.lShift.arr = engine.input.rShift.arr = engine.input.lShift.das = engine.input.rShift.das = 0;
          for (const key of Object.keys(engine.input.keys) as (keyof typeof engine.input.keys)[]) engine.input.keys[key] = false;
        }
      }
      if (engine.frame === tape.frames) {
        if (replay.status === 'complete') { if (qp) qp.stop(); else sounds.push('finish'); target = null; }
        if (replay.status === 'topout') sounds.push('failure');
        collect(engine, label); break;
      }
      if (label || !engine.frame) collect(engine, label);
      if (!qp) room.beforeTick(engine.frame);
      if (qp) {
        const bot: Game.Replay.Frame[] = [];
        while (qpIndex < replay.quickplay!.events.length && replay.quickplay!.events[qpIndex].frame <= qp.frame) {
          const event = replay.quickplay!.events[qpIndex++];
          if (event.type === 'inputs' && event.side === 1 && Array.isArray(event.data)) bot.push(...event.data as Game.Replay.Frame[]);
          if (event.type === 'practice-topout') qp.requestRescue(event.side);
          if (event.type === 'coaching-gravity') qp.settings.quickplay.reviveNoGravity = (event.data as { disabled: boolean }).disabled;
          if (event.type === 'down' && (event.data as { reason?: string })?.reason === 'practice') qp.down(event.side, 'recorded');
        }
        const before = qp.frame; qp.tick(keys, bot);
        if (qp.frame === before) throw new Error(`Quick Play replay diverged at frame ${before}.`);
      } else engine.tick(keys);
      collect(engine);
      if (engine.frame % 600 === 0) { progress?.(`Loading playback · ${Math.round(engine.frame / Math.max(1, tape.frames) * 100)}%`); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  }
  if (!lastEngine || !frames.length) throw new Error('This replay has no playable frames.');
  return { name: track.name, engine: lastEngine, frames, duration: frames.at(-1)!.time, rules, settings: displaySettings, trainingFaults: track.training?.result?.faults ?? track.data.result?.faults ?? 0, modeName: track.data.practice?.name ?? rules.name, qpScenes: qp ? qpScenes : undefined, qpRecording: qp && track.kind === 'trainer' ? track.data as TrainerReplay : undefined };
}

export function qpPlaybackScene(playback: Playback, time: number) {
  const frame = Math.floor(time * 60 + 1e-6), checkpoint = playback.qpScenes?.slice().reverse().find(scene => scene.frame <= frame), recording = playback.qpRecording;
  if (!checkpoint || !recording) throw new Error('This recording has no supported Quick Play scene state.');
  const runtime = QuickPlayRuntime.fromCheckpoint(checkpoint), events = recording.events, qpEvents = recording.quickplay!.events;
  let index = events.findIndex(event => event.frame >= runtime.frame), qIndex = qpEvents.findIndex(event => event.frame >= runtime.frame);
  if (index < 0) index = events.length; if (qIndex < 0) qIndex = qpEvents.length;
  while (runtime.frame < frame && !runtime.over) {
    const keys: Game.Replay.Frame[] = [], bot: Game.Replay.Frame[] = [];
    while (index < events.length && events[index].frame <= runtime.frame) {
      const event = events[index++];
      if (event.type === 'keydown' || event.type === 'keyup') keys.push(event as Game.Replay.Frame);
      if (event.type === 'release-all') runtime.release(runtime.sides[0]);
      if (event.type === 'das-precharge') applyDasPrecharge(runtime.sides[0].engine, (event.data as { charge: Parameters<typeof applyDasPrecharge>[1] }).charge);
    }
    while (qIndex < qpEvents.length && qpEvents[qIndex].frame <= runtime.frame) {
      const event = qpEvents[qIndex++];
      if (event.type === 'practice-topout') runtime.requestRescue(event.side);
      if (event.type === 'coaching-gravity') runtime.settings.quickplay.reviveNoGravity = (event.data as { disabled: boolean }).disabled;
      if (event.type === 'down' && (event.data as { reason?: string })?.reason === 'practice') runtime.down(event.side, 'recorded');
      if (event.type === 'inputs' && event.side === 1) bot.push(...event.data as Game.Replay.Frame[]);
    }
    runtime.tick(keys, bot);
  }
  return runtime.checkpoint();
}
