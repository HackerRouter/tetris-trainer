import type { Game } from '@haelp/teto/types';
import { createEngine } from './engine';
import type { TrainerReplay } from './history';
import { applyModeSetup } from './modes';
import { nativeScenes, readReplay } from './replay';
import { replayTimeline } from './timeline';

const gameKeys = ['moveLeft', 'moveRight', 'softDrop', 'hardDrop', 'rotateCW', 'rotateCCW', 'rotate180', 'hold'] as const;

export async function exportNative(replay: TrainerReplay) {
  if (!replay.startedAt || !replay.placements.length) throw new Error('Place at least one piece before exporting a TETR.IO replay.');
  const rules = replay.modeRules, a = rules.advanced, tape = replayTimeline(replay);
  if (replay.mode === 'fault-practice' || a.garbageRefill || a.garbageInterval || a.sequence || replay.events.some(event => event.type === 'clear-field')) throw new Error('This session uses scene changes, garbage refill, timed solo packets, an authored queue or board clearing. Export trainer JSON to preserve it; native export currently supports ordinary Sprint and Custom sessions with retries and undo.');
  if (replay.events.some(event => event.type === 'das-precharge')) throw new Error('This recording starts with charged countdown DAS. Export trainer JSON to preserve that input buffer; native export requires starting without a held movement key.');
  const engine = createEngine(replay.settings, replay.seed, rules);
  applyModeSetup(engine, rules, replay.seed);
  if (engine.board.state.some(row => row.some(tile => tile?.mino === 'bomb'))) throw new Error('Native export cannot preserve an initial bomb map yet. Export trainer JSON for this session.');
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
    objective_type: rules.goals.lines ? 'lines' : 'none', objective_count: rules.goals.lines, objective_result: 'time',
    slot_counter1: 'stopwatch', slot_counter2: 'lines', slot_counter3: 'pieces', slot_counter4: 'keys', slot_counter5: 'finesse', slot_bar2: rules.goals.lines ? 'progress' : 'none',
    mission: 'LOCAL TRAINING REPLAY', minoskin: { z: 'tetrio', l: 'tetrio', o: 'tetrio', s: 'tetrio', i: 'tetrio', j: 'tetrio', t: 'tetrio', other: 'tetrio', ghost: 'tetrio' }, boardskin: 'generic',
    map: [...engine.board.state].reverse().map(row => row.map(tile => !tile ? '_' : tile.mino === 'gb' ? '#' : tile.mino === 'bomb' ? '*' : tile.mino).join('')).join('') + '?'
  };
  const inputs: Game.Replay.Frame[] = [];
  const release = (frame: number) => gameKeys.forEach(key => inputs.push({ frame, type: 'keyup', data: { key, subframe: 0 } }));
  for (const event of tape.events) {
    if (event.frame >= tape.frames) continue;
    if (event.type === 'keydown' || event.type === 'keyup') inputs.push(structuredClone(event) as Game.Replay.Frame);
    else if (event.type === 'release-all') release(event.frame);
  }
  const end = tape.frames;
  if (end > 216000 || inputs.some(input => input.frame < 0)) throw new Error('Native export supports up to one hour of ordered gameplay.');
  const result = replay.result, clears: Record<string, number> = {};
  const clearNames: Record<string, string> = { single: 'singles', double: 'doubles', triple: 'triples', quad: 'quads', pc: 'allclear', 'tspin-1': 'tspinsingles', 'tspin-2': 'tspindoubles', 'tspin-3': 'tspintriples', 'tspin-4': 'tspinquads', 'mini-tspin-1': 'minitspinsingles', 'mini-tspin-2': 'minitspindoubles', 'mini-tspin-3': 'minitspintriples', 'mini-tspin-4': 'minitspinquads' };
  for (const name of [...Object.values(clearNames), 'realtspins', 'minitspins']) clears[name] = 0;
  for (const [key, count] of Object.entries(result.clears)) { if (clearNames[key]) clears[clearNames[key]] = count; if (key.startsWith('mini-tspin-')) clears.minitspins += count; else if (key.startsWith('tspin-')) clears.realtspins += count; }
  const finaltime = result.timeMs, seconds = Math.max(1 / 60, finaltime / 1000), gameoverreason = replay.status === 'complete' ? 'clear' : replay.status === 'topout' ? 'topout' : 'forfeit';
  const stats = { seed: replay.seed, finaltime, lines: result.lines, level_lines: result.lines, level_lines_needed: 1, level: 1, piecesplaced: result.pieces, inputs: inputs.filter(event => event.type === 'keydown').length, holds: result.holds, score: 0, combo: result.combo + 1, topcombo: result.maxCombo + 1, btb: result.b2b + 1, topbtb: result.maxB2B + 1, tspins: clears.realtspins + clears.minitspins, kills: 0, time: { start: 0, zero: true, locked: true, prev: finaltime, frameoffset: 0 }, clears, garbage: { ...result.garbage }, finesse: { combo: result.perfects, faults: 0, perfectpieces: result.perfects } };
  const aggregatestats = { apm: result.garbage.sent / seconds * 60, pps: result.pieces / seconds, vsscore: (result.garbage.attack + result.garbage.cleared) / seconds * 100 };
  const file = { version: 1, id: null, users: [{ id: 'local', username: 'LOCAL TRAINER', avatar_revision: 0, banner_revision: 0, flags: 0, country: null }], ts: replay.startedAt, gamemode: rules.id === 'sprint' ? '40l' : 'custom', verified: false, replay: { frames: end, options, results: { stats, aggregatestats, gameoverreason }, events: [{ frame: 0, type: 'start', data: {} }, ...inputs, { frame: end, type: 'end', data: { reason: gameoverreason } }] }, trainer: { source: 'Tetris Trainer', version: 1, training: { mode: replay.mode, modeRules: replay.modeRules, settings: replay.settings, result: replay.result, placements: replay.placements.filter(placement => placement.reason === 'finesse' || (placement.finesse && placement.finesseInputs > placement.finesse.cost)) }, note: 'Local, unverified replay. Retried and undone attempts are removed. Trainer JSON retains the complete training history.' } };
  let finalPieces = 0, finalLines = 0, finalBoard = '';
  await nativeScenes(readReplay(file, 'Export verification')[0], replay.settings, undefined, state => { finalPieces = state.stats.pieces; finalLines = state.stats.lines; finalBoard = JSON.stringify(state.board.state.map(row => row.map(tile => tile?.mino ?? null))); });
  if (finalPieces !== replay.result.pieces || finalLines !== replay.result.lines) throw new Error('Native replay verification did not reproduce this session. Export trainer JSON to keep the exact recording.');
  if (replay.finalSnapshot && finalBoard !== JSON.stringify(replay.finalSnapshot.board.map(row => row.map(tile => tile?.mino ?? null)))) throw new Error('Native replay verification did not reproduce the final board. Export trainer JSON to preserve this session.');
  return file;
}
