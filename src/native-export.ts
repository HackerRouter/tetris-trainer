import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import type { TrainerReplay } from './history';
import { applyModeSetup, modeDefinitions } from './modes';
import { nativeScenes, readReplay } from './replay';

const gameKeys = ['moveLeft', 'moveRight', 'softDrop', 'hardDrop', 'rotateCW', 'rotateCCW', 'rotate180', 'hold'] as const;

export async function exportNative(replay: TrainerReplay) {
  if (!replay.startedAt || !replay.placements.length) throw new Error('Place at least one piece before exporting a TETR.IO replay.');
  const rules = replay.modeRules, a = rules.advanced;
  if (replay.mode === 'fault-practice' || a.garbageRefill || a.garbageInterval || a.sequence || replay.events.some(event => event.type === 'clear-field')) throw new Error('This session uses scene changes, garbage refill, timed solo packets, an authored queue or board clearing. Export trainer JSON to preserve it; native export currently supports ordinary Sprint and Custom sessions with retries and undo.');
  if (replay.events.some(event => event.type === 'das-precharge')) throw new Error('This recording starts with charged countdown DAS. Export trainer JSON to preserve that input buffer; native export requires starting without a held movement key.');
  const engine = createEngine(replay.settings, replay.seed, rules);
  applyModeSetup(engine, rules, replay.seed);
  const options = {
    version: 19, seed: replay.seed, seed_random: false, anchorseed: true, username: 'LOCAL TRAINER', boardwidth: rules.board.width, boardheight: rules.board.height, boardbuffer: 20,
    bagtype: rules.bag, no_szo: false, kickset: a.kickSet, g: rules.gravity, gincrease: a.gravityIncrease, gmargin: a.gravityMargin * 60,
    handling: replay.settings.handling, allow180: rules.allow180, allow_harddrop: a.hardDrop, display_hold: rules.hold, display_shadow: a.shadow, nextcount: rules.nextCount,
    locktime: rules.infiniteLock ? 10000000 : rules.lockDelay, lockresets: rules.lockResets, infinite_movement: rules.infiniteLock, infinite_hold: rules.infiniteHold,
    are: a.entryDelay, lineclear_are: a.lineClearDelay, spinbonuses: a.spinBonuses, combotable: a.comboTable, clutch: a.clutch,
    b2bchaining: a.b2bChaining, b2bcharging: a.b2bCharging, allclears: a.allClear, allclear_garbage: a.allClearGarbage, allclear_b2b: a.allClearB2B, usebombs: a.bombs,
    garbagemultiplier: a.garbageMultiplier, garbageincrease: a.garbageIncrease, garbagemargin: a.garbageMargin * 60, garbagespeed: a.garbageSpeed,
    garbagecap: a.garbageCap, garbagecapincrease: a.garbageCapIncrease, garbagecapmax: a.garbageCapMax, garbagecapmargin: a.garbageCapMargin * 60, garbageabsolutecap: a.garbageAbsoluteCap,
    garbageblocking: a.garbageBlocking, messiness_change: rules.setup.messiness, messiness_inner: a.garbageMessinessWithin, openerphase: a.openerPhase,
    garbagespecialbonus: a.specialBonus, garbagetargetbonus: 'none', roundmode: 'down', countdown: false, can_retry: false, pro_retry: false, pro_alert: false, stride: false,
    objective: { type: rules.goals.lines ? 'lines' : 'none', count: rules.goals.lines }, objective_type: rules.goals.lines ? 'lines' : 'none', objective_count: rules.goals.lines,
    mission: 'LOCAL TRAINING REPLAY', minoskin: { z: 'tetrio', l: 'tetrio', o: 'tetrio', s: 'tetrio', i: 'tetrio', j: 'tetrio', t: 'tetrio', other: 'tetrio' }, ghostskin: 'tetrio', boardskin: 'generic'
  };
  let inputs: Game.Replay.Frame[] = [], offset = 0;
  const release = (frame: number) => gameKeys.forEach(key => inputs.push({ frame, type: 'keyup', data: { key, subframe: 0 } }));
  for (const event of replay.events) {
    if (event.type === 'retry' || event.type === 'undo') {
      const frame = Math.round((event.data as { timeMs: number }).timeMs * 60 / 1000);
      inputs = inputs.filter(input => input.frame < frame); offset = event.frame - frame; release(frame);
    } else if (event.type === 'keydown' || event.type === 'keyup') inputs.push({ ...structuredClone(event), frame: event.frame - offset } as Game.Replay.Frame);
    else if (event.type === 'release-all') release(event.frame - offset);
  }
  const end = inputs.reduce((end, input) => Math.max(end, input.frame + 1), Math.max(1, Math.round(replay.result.timeMs * 60 / 1000)));
  if (end > 216000 || inputs.some(input => input.frame < 0)) throw new Error('Native export supports up to one hour of ordered gameplay.');
  const stats = { seed: replay.seed, lines: 0, piecesplaced: 0, inputs: 0, holds: 0, score: 0, combo: 0, btb: 0, time: { start: 0, zero: true, locked: false, prev: 0, frameoffset: 0 }, clears: {}, garbage: { sent: 0, received: 0, attack: 0, cleared: 0 }, finesse: { combo: 0, faults: 0, perfectpieces: 0 } };
  const full = { successful: false, gameoverreason: null, replay: {}, source: {}, options, stats, targets: [], fire: 0, game: { board: [...engine.board.state].reverse().map(row => row.map(tile => tile?.mino ?? null)), bag: [engine.falling.symbol, ...engine.queue.slice(0, 13)], hold: { piece: null, locked: false }, g: rules.gravity, controlling: { ldas: 0, ldasiter: 0, lshift: false, rdas: 0, rdasiter: 0, rshift: false, lastshift: 0, softdrop: false }, handling: replay.settings.handling, playing: true }, killer: { name: null, type: 'sizzle' }, aggregatestats: { apm: 0, pps: 0, vsscore: 0 } };
  const file = { _id: `local-${crypto.randomUUID()}`, user: { _id: 'local', username: 'LOCAL TRAINER' }, ts: replay.startedAt, gametype: rules.id === 'sprint' ? '40l' : 'custom', verified: false, ismulti: false, data: { frames: end, events: [{ frame: 0, type: 'full', data: full }, { frame: 0, type: 'start', data: {} }, ...inputs, { frame: end, type: 'end', data: { reason: replay.status === 'complete' ? 'clear' : 'forfeit' } }] }, trainer: { source: 'Tetris Trainer', version: 1, note: 'Local, unverified replay. Retried and undone attempts are removed. Trainer JSON retains the complete training history.' } };
  let finalPieces = 0, finalLines = 0, finalBoard = '';
  await nativeScenes(readReplay(file, 'Export verification')[0], replay.settings, undefined, state => { finalPieces = state.stats.pieces; finalLines = state.stats.lines; finalBoard = JSON.stringify(state.board.state.map(row => row.map(tile => tile?.mino ?? null))); });
  if (finalPieces !== replay.result.pieces || finalLines !== replay.result.lines) throw new Error('Native replay verification did not reproduce this session. Export trainer JSON to keep the exact recording.');
  if (replay.finalSnapshot && finalBoard !== JSON.stringify(replay.finalSnapshot.board.map(row => row.map(tile => tile?.mino ?? null)))) throw new Error('Native replay verification did not reproduce the final board. Export trainer JSON to preserve this session.');
  return file;
}
