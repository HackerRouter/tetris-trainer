import type { Engine, EngineSnapshot, TetrominoSnapshot } from '@haelp/teto/engine';
import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import { applyModeSetup, modeDefinitions, type ModeRules } from './modes';
import { nativeScenes, type ReplayTrack } from './replay';
import { RoomRuntime } from './room-runtime';
import { applyDasPrecharge } from './das-precharge';
import type { Settings } from './settings';
import type { TrainerReplay } from './history';

export type PlaybackFrame = { time: number; board: EngineSnapshot['board']; piece: TetrominoSnapshot; hold: string | null; next: string[]; pieces: number; lines: number; label: string };
export type Playback = { name: string; engine: Engine; frames: PlaybackFrame[]; duration: number; rules?: ModeRules };

export async function buildPlayback(track: ReplayTrack, settings: Settings, progress?: (text: string) => void): Promise<Playback> {
  const frames: PlaybackFrame[] = [];
  let boardKey = '', board: EngineSnapshot['board'] = [], lastEngine: Engine | null = null;
  const collect = (engine: Engine, label = '') => {
    lastEngine = engine;
    const key = JSON.stringify(engine.board.state);
    if (key !== boardKey) { boardKey = key; board = structuredClone(engine.board.state); }
    frames.push({ time: engine.frame / 60, board, piece: engine.falling.snapshot(), hold: engine.held, next: engine.queue.slice(0, 5), pieces: engine.stats.pieces, lines: engine.stats.lines, label });
  };
  let rules: ModeRules | undefined;
  if (track.kind === 'native') await nativeScenes(track, settings, progress, engine => collect(engine));
  else {
    const replay = track.data as TrainerReplay;
    if (!Array.isArray(replay.events) || replay.events.length > 500000) throw new Error('Invalid replay event list.');
    rules = modeDefinitions[replay.modeRules.id].rules(replay.settings);
    const engine = createEngine(replay.settings, replay.seed, rules), practice = replay.mode === 'fault-practice';
    const room = new RoomRuntime(engine, rules, practice, replay.seed);
    applyModeSetup(engine, rules, replay.seed); room.refill();
    const accepted = new Map(replay.placements.map(placement => [placement.frame, placement.accepted]));
    engine.events.on('falling.lock', result => { if (accepted.get(engine.frame) !== false) { room.locked(result); room.refill(); } });
    const events = replay.events, end = Math.max(events.at(-1)?.frame ?? 0, Math.round(replay.result.sessionTimeMs * 60 / 1000));
    if (!Number.isInteger(end) || end < 0 || end > 216000 || events.some((event, i) => !Number.isInteger(event.frame) || event.frame < 0 || event.frame > end || (i > 0 && event.frame < events[i - 1].frame))) throw new Error('Replay frames are unordered or exceed one hour.');
    let index = 0, timer = 0;
    collect(engine);
    while (engine.frame <= end) {
      const keys: Game.Replay.Frame[] = [];
      let label = '';
      while (index < events.length && events[index].frame === engine.frame) {
        const event = events[index++], data = event.data as Record<string, any>;
        if (event.type === 'keydown' || event.type === 'keyup') keys.push(event as Game.Replay.Frame);
        else if (event.type === 'das-precharge') applyDasPrecharge(engine, data.charge);
        else if (['retry', 'undo', 'clear-field', 'practice-scene'].includes(event.type) && data.snapshot) {
          engine.fromSnapshot(data.snapshot); timer = Math.round(data.timeMs * 60 / 1000);
          room.restore(data.room ?? room.state, timer, data.snapshot.frame);
          label = event.type.replaceAll('-', ' ');
        } else if (event.type === 'release-all') {
          engine.input.lShift.held = engine.input.rShift.held = false;
          engine.input.lShift.arr = engine.input.rShift.arr = engine.input.lShift.das = engine.input.rShift.das = 0;
          for (const key of Object.keys(engine.input.keys) as (keyof typeof engine.input.keys)[]) engine.input.keys[key] = false;
        }
      }
      if (label) collect(engine, label);
      if (engine.frame === end) break;
      room.beforeTick(timer++); engine.tick(keys); collect(engine);
      if (engine.frame % 600 === 0) { progress?.(`Loading playback · ${Math.round(engine.frame / Math.max(1, end) * 100)}%`); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    if (frames.at(-1)?.time !== engine.frame / 60) collect(engine, 'End');
  }
  if (!lastEngine || !frames.length) throw new Error('This replay has no playable frames.');
  return { name: track.name, engine: lastEngine, frames, duration: frames.at(-1)!.time, rules };
}
