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
import { placementSounds } from './sound-events';
import type { Cell } from './finesse';
import type { PlacementEffect } from './renderer';

export type PlaybackFrame = { time: number; board: EngineSnapshot['board']; piece: TetrominoSnapshot | null; hold: string | null; holdLocked: boolean; next: string[]; pieces: number; lines: number; inputs: number; holds: number; perfects: number; target: Cell[] | null; effect: PlacementEffect | null; effectTime: number; label: string; sounds: string[] };
export type Playback = { name: string; engine: Engine; frames: PlaybackFrame[]; duration: number; rules: ModeRules; settings: Settings; trainingFaults: number; modeName: string };

export async function buildPlayback(track: ReplayTrack, settings: Settings, progress?: (text: string) => void): Promise<Playback> {
  const frames: PlaybackFrame[] = [];
  let boardKey = '', board: EngineSnapshot['board'] = [], lastEngine: Engine | null = null;
  let rules = modeDefinitions.sprint.rules(settings), displaySettings = settings, room: RoomRuntime | undefined;
  let inputs = 0, holds = 0, completed = 0, perfects = 0, target: Cell[] | null = null;
  let effect: PlacementEffect | null = null, effectTime = -1, sounds: string[] = [];
  let previous: { x: number; y: number; rotation: number } | null = null;
  const collect = (engine: Engine, label = '') => {
    if (!lastEngine) {
      let cells: Cell[] = [];
      engine.events.on('falling.lock.pre', () => { cells = engine.falling.absoluteBlocks; });
      engine.events.on('falling.new', ({ isHold }) => { if (isHold) { holds++; sounds.push('hold'); } });
      engine.events.on('falling.lock', result => {
        const hardDrop = result.keysPresses.includes('hardDrop');
        effect = { cells, piece: result.mino, hardDrop, lines: result.lines };
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
      if (piece.rotation !== previous.rotation) sounds.push('rotate');
      if (piece.y < previous.y && engine.input.keys.softDrop) sounds.push('softdrop');
    }
    previous = { x: piece.x, y: piece.y, rotation: piece.rotation };
    const state: PlaybackFrame = { time: engine.frame / 60, board, piece: engine.toppedOut || room?.waiting ? null : piece.snapshot(), hold: engine.held, holdLocked: engine.holdLocked, next: engine.queue.slice(0, rules.nextCount), pieces: track.kind === 'trainer' && track.data.practice ? completed : engine.stats.pieces, lines: engine.stats.lines, inputs, holds, perfects, target, effect, effectTime, label, sounds };
    if (frames.at(-1)?.time === state.time) { state.sounds = [...frames.at(-1)!.sounds, ...sounds]; frames[frames.length - 1] = state; }
    else frames.push(state);
    sounds = [];
  };
  if (track.kind === 'native') {
    let lastFrame = 0;
    const keys = track.data.events.filter((event: any) => event.type === 'keydown');
    let keyIndex = 0;
    await nativeScenes(track, settings, progress, (engine, mode, runtime) => {
      rules = mode; room = runtime;
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
    displaySettings = replay.settings;
    rules = { ...modeDefinitions[replay.modeRules.id].rules(replay.settings), ...replay.modeRules };
    const engine = createEngine(replay.settings, replay.seed, rules), practice = replay.mode === 'fault-practice';
    room = new RoomRuntime(engine, rules, practice, replay.seed);
    applyModeSetup(engine, rules, replay.seed); room.refill();
    engine.events.on('falling.lock', result => { room!.locked(result); room!.refill(); });
    let index = 0;
    collect(engine);
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
          if (event.type === 'practice-scene') { target = data.target ?? replay.placements.find(p => p.accepted && p.snapshot.falling.symbol === snapshot.falling.symbol)?.cells ?? null; label = `Scene ${data.index + 1}`; }
          if (event.type === 'clear-field') { sounds.push('boardappear'); label = 'Clear board'; }
        } else if (event.type === 'placement') {
          const placement = replay.placements[data.index];
          if (!placement?.accepted) throw new Error('Invalid effective placement marker.');
          if (placement.finesse && placement.finesseInputs <= placement.finesse.cost) perfects++;
        } else if (event.type === 'release-all') {
          engine.falling.irs = 0; engine.state &= ~1024;
          engine.input.lShift.held = engine.input.rShift.held = false;
          engine.input.lShift.arr = engine.input.rShift.arr = engine.input.lShift.das = engine.input.rShift.das = 0;
          for (const key of Object.keys(engine.input.keys) as (keyof typeof engine.input.keys)[]) engine.input.keys[key] = false;
        }
      }
      if (engine.frame === tape.frames) {
        if (replay.status === 'complete') { sounds.push('finish'); target = null; }
        if (replay.status === 'topout') sounds.push('failure');
        collect(engine, label); break;
      }
      if (label || !engine.frame) collect(engine, label);
      room.beforeTick(engine.frame); engine.tick(keys); collect(engine);
      if (engine.frame % 600 === 0) { progress?.(`Loading playback · ${Math.round(engine.frame / Math.max(1, tape.frames) * 100)}%`); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  }
  if (!lastEngine || !frames.length) throw new Error('This replay has no playable frames.');
  return { name: track.name, engine: lastEngine, frames, duration: frames.at(-1)!.time, rules, settings: displaySettings, trainingFaults: track.training?.result?.faults ?? track.data.result?.faults ?? 0, modeName: track.data.practice?.name ?? rules.name };
}
