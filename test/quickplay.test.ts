import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { reviveGuidanceIdentity, validateReviveGuidance, ReviveContinuation, reviveSearchDepth } from '../src/revive-guidance.ts';
import { ReviveDemo } from '../src/revive-demo.ts';
import { qpAttack } from '../src/qp-attack.ts';
import { defaults, type GameAction } from '../src/settings.ts';
import { TrainerGame } from '../src/game.ts';
import { ZenithBag } from '../src/qp-engine.ts';
import { initialClimb, tickClimb, splitWindup, receiveAmount, validateQpProfile } from '../src/qp-rules.ts';
import { initialGarbage, acceptPressure, cancelGarbage, extractQpPressure, initialPressure, pressurePackets } from '../src/qp-pressure.ts';
import { initialRevive, reviveRotate, reviveCatalog, drawSelectedReviveTasks } from '../src/revive-tasks.ts';
import { analyzeSession } from '../src/history.ts';
import { exportNative } from '../src/native-export.ts';
import { QuickPlayClock } from '../src/qp-clock.ts';
import { garbageSegments, garbageWarning, packetCues } from '../src/qp-feedback.ts';
import { qpSounds } from '../src/qp-sound.ts';
import { placementSounds } from '../src/sound-events.ts';
import { spinDrill } from '../src/spin-scenes.ts';
import { analysisContext } from '../src/analysis-context.ts';
import { applySpinPath } from '../src/spin-movement.ts';
import { QuickPlayRuntime } from '../src/qp-runtime.ts';
import { searchRevive, trialQpOperation, planQpBot, immediateQpBot, recoverQpBot, qpBotNeedsRecovery } from '../src/qp-search.ts';
import { spawnSnapshot } from '../src/engine.ts';
import { RevivePracticeTracker, type ReviveAttempt } from '../src/revive-practice.ts';
import { buildPlayback, qpPlaybackScene } from '../src/playback.ts';
import { readReplay } from '../src/replay.ts';
import { initialQpModState, qpDuplicateClear, qpHealWounds, qpTileOpacity, qpVisual } from '../src/qp-mod-state.ts';

test('Bot forecasting preserves both local pressure generators while player coaching reports unknown attacks', () => {
  const qp = create(true).qp!; qp.down(0); qp.settings.quickplay.pressure.mode = 'generated';
  for (const side of qp.sides) side.pressure.next = qp.frame + 2;
  const before = qp.checkpoint(), budget = { nodes: 3000, depth: 1, beam: 2, milliseconds: 1000, information: 'seeded' as const, solutions: 1 };
  const bot = searchRevive(before, 1, { ...budget, localPressure: true }), route = bot.routes[0];
  assert.equal(bot.status, 'Found'); assert.equal(route.targets.length, 0);
  const actual = trialQpOperation(before, 1, route.operations[0])!;
  for (const [index, side] of route.state.sides.entries()) {
    assert.ok(side.state.pressure.generated > before.sides[index].state.pressure.generated);
    assert.deepEqual(side.state.pressure, actual.state.sides[index].state.pressure);
    assert.deepEqual(side.state.garbage, actual.state.sides[index].state.garbage);
  }
  const coach = searchRevive(before, 1, budget);
  assert.ok(coach.limits.some(limit => limit.includes('Unannounced')));
  assert.equal(coach.routes[0].state.sides[1].state.pressure.generated, before.sides[1].state.pressure.generated);
  assert.deepEqual(qp.checkpoint(), before);
});

test('Imminent garbage triggers a bounded legal recovery without breaking the placement deadline or idle task', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-quad-pressure.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1];
  side.lockFrames = [qp.frame]; assert.equal(qpBotNeedsRecovery(qp), false);
  side.lockFrames = [qp.frame - 6];
  side.garbage.entering.push(...Array.from({ length: 20 }, () => ({ hole: 4, size: 1, packet: 1000 })));
  assert.equal(qpBotNeedsRecovery(qp), true);
  side.task = initialRevive(['f-rotate-20']); side.task.prompts[0].predicate = 'idle';
  assert.equal(qpBotNeedsRecovery(qp), false);
  const live = QuickPlayRuntime.fromCheckpoint(saved), before = live.checkpoint(), plan = recoverQpBot(live);
  assert.ok(plan?.target); assert.ok(plan.nodes <= 1000);
  const trial = trialQpOperation(before, 1, { actions: plan.actions, duration: plan.duration!, label: plan.reason });
  assert.ok(trial); assert.equal(trial.state.sides[1].engine.snapshot.stats.pieces, before.sides[1].engine.snapshot.stats.pieces + 1);
  assert.deepEqual(live.checkpoint(), before);
});

test('Upper-half Quad keeps its required construction space while still recovering before overflow', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-quad-pressure.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1];
  side.garbage.pending = []; side.lockFrames = [qp.frame - 40];
  const height = side.engine.board.state.reduce((peak, row, y) => row.some(Boolean) ? y + 1 : peak, 0);
  side.garbage.entering = Array.from({ length: 16 - height }, () => ({ hole: 6, size: 1, packet: 1000 }));
  assert.equal(qpBotNeedsRecovery(qp), false);
  side.garbage.entering.push(...Array.from({ length: 4 }, () => ({ hole: 6, size: 1, packet: 1000 })));
  assert.equal(qpBotNeedsRecovery(qp), true);
});

for (const fixture of ['tsd-current', 'tsd-hold', 'tst-current', 'sz-garbage', 'lj-garbage']) test(`Bot immediately takes the legal ${fixture} task opportunity`, () => {
  const saved = JSON.parse(readFileSync(new URL(`./fixtures/qp-duo-${fixture}.json`, import.meta.url), 'utf8'));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], before = side.task!.prompts[0].count;
  const plan = immediateQpBot(qp); assert.ok(plan?.target);
  const result = trialQpOperation(qp.checkpoint(), 1, { actions: plan.actions, duration: plan.duration!, label: plan.reason });
  assert.ok(result); assert.equal(result.state.sides[1].engine.snapshot.stats.pieces, side.engine.stats.pieces + 1);
  assert.ok(result.state.sides[1].state.task!.prompts[0].count > before);
  if (fixture.startsWith('tsd')) assert.equal(result.state.sides[1].engine.snapshot.stats.lines - side.engine.stats.lines, 2);
  if (fixture.startsWith('tst')) assert.equal(result.state.sides[1].engine.snapshot.stats.lines - side.engine.stats.lines, 3);
  if (fixture.endsWith('garbage')) {
    for (const row of side.engine.board.state) for (const tile of row) if (tile) tile.mino = 'j';
    assert.equal(immediateQpBot(qp), null);
  }
});

for (const fixture of ['sz-singles', 'sz-singles-progress']) test(`Bot completes ${fixture} without resetting the consecutive S/Z clear count`, () => {
  const saved = JSON.parse(readFileSync(new URL(`./fixtures/qp-duo-${fixture}.json`, import.meta.url), 'utf8'));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives, pieces = side.engine.stats.pieces;
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.revives === initial && qp.frame < saved.frame + 300 && side.engine.stats.pieces < pieces + 30) qp.tick([]);
  assert.equal(side.revives, initial + 1); assert.equal(side.life, 'alive'); assert.equal(qp.completed.at(-1)!.tasks.resets, saved.sides[1].state.task.resets);
  if (fixture.endsWith('progress')) assert.equal(side.engine.stats.pieces, pieces + 1);
});

for (const fixture of ['tst-empty', 'tst-terrain', 'ccw-rotate-tsd']) test(`Duo completes the full ${fixture} rescue with a recoverable board`, () => {
  const saved = JSON.parse(readFileSync(new URL(`./fixtures/qp-duo-${fixture}.json`, import.meta.url), 'utf8'));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives, pieces = side.engine.stats.pieces;
  let firstHeight: number | null = null;
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.life === 'alive' && side.revives === initial && qp.frame < saved.frame + 600 && side.engine.stats.pieces < pieces + 35) {
    const active = side.task?.active; qp.tick([]);
    if (fixture === 'ccw-rotate-tsd' && active === 0 && side.task?.active !== 0) firstHeight = side.engine.board.state.reduce((height, row, y) => row.some(Boolean) ? y + 1 : height, 0);
  }
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1); assert.ok(qp.completed.at(-1)!.tasks.prompts.every(prompt => prompt.complete));
  assert.equal(qp.completed.at(-1)!.tasks.resets, 0);
  assert.ok(qp.events.some(event => event.type === 'lock' && event.side === 1 && (event.data as { piece: string }).piece === 't' && (event.data as { spin: string }).spin === 'normal' && (event.data as { lines: number }).lines === (fixture.startsWith('tst') ? 3 : 2)));
  assert.ok(side.engine.board.state.reduce((height, row, y) => row.some(Boolean) ? y + 1 : height, 0) < 13);
  if (fixture === 'ccw-rotate-tsd') { assert.notEqual(firstHeight, null); assert.ok(firstHeight! < 9); }
});

test('The S/Z/L/J objective immediately recognizes a legal J Spin as progress', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-lj-garbage.json', import.meta.url), 'utf8'));
  const qp = QuickPlayRuntime.fromCheckpoint(saved); qp.sides[1].task = initialRevive(['d-szljspin-2'], qp.frame);
  const plan = immediateQpBot(qp); assert.ok(plan?.target);
  const result = trialQpOperation(qp.checkpoint(), 1, { actions: plan.actions, duration: plan.duration!, label: plan.reason });
  assert.equal(result?.state.sides[1].state.task?.prompts[0].count, 1);
});

for (const fixture of ['sz-spin-empty', 'sz-spin-high', 'szlj-spin-high', 'sz-garbage-terrain', 'lj-garbage-terrain']) test(`Duo constructs and executes the full ${fixture} rescue instead of speculative stacking`, () => {
  const saved = JSON.parse(readFileSync(new URL(`./fixtures/qp-duo-${fixture}.json`, import.meta.url), 'utf8'));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives, pieces = side.engine.stats.pieces;
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.life === 'alive' && side.revives === initial && qp.frame < saved.frame + 600 && side.engine.stats.pieces < pieces + 35) qp.tick([]);
  if (side.revives !== initial + 1) writeFileSync(`TEMP/Q1-${fixture}-logic-failure.json`, JSON.stringify(qp.checkpoint(true)));
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1); assert.ok(qp.completed.at(-1)!.tasks.prompts.every(prompt => prompt.complete));
  assert.equal(qp.completed.at(-1)!.tasks.resets, 0);
  const wanted = fixture.startsWith('szlj-') ? ['s', 'z', 'l', 'j'] : fixture.startsWith('sz-') ? ['s', 'z'] : ['l', 'j'];
  assert.ok(qp.events.some(event => event.type === 'lock' && event.side === 1 && wanted.includes((event.data as { piece: string }).piece) && (event.data as { spin: string }).spin !== 'none' && (fixture.startsWith('szlj-') || (event.data as { lines: number }).lines > 0)));
  assert.ok(side.engine.board.state.reduce((height, row, y) => row.some(Boolean) ? y + 1 : height, 0) < 13);
  if (fixture.includes('garbage')) assert.ok(side.garbage.inserted > saved.sides[1].state.garbage.inserted);
});

test('Duo completes both S/Z Doubles and the following fourteen no-clear placements from the v5 failure', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-sz-double-chain.json', import.meta.url), 'utf8'));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives;
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.life === 'alive' && side.revives === initial && qp.frame < saved.frame + 600) qp.tick([]);
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1); assert.ok(qp.completed.at(-1)!.tasks.prompts.every(prompt => prompt.complete));
  assert.equal(qp.completed.at(-1)!.tasks.resets, 0);
  assert.ok(qp.events.filter(event => event.side === 1 && event.type === 'lock' && ['s', 'z'].includes((event.data as { piece: string }).piece) && (event.data as { lines: number }).lines === 2).length >= 2);
  const revivedAt = qp.frame; qp.botPlanner = () => planQpBot(qp, 1, 45);
  while (!qp.over && side.life === 'alive' && qp.frame < revivedAt + 180) qp.tick([]);
  assert.equal(side.life, 'alive'); assert.equal(qp.frame, revivedAt + 180);
  assert.ok(side.engine.board.state.reduce((height, row, y) => row.some(Boolean) ? y + 1 : height, 0) < 13);
});

test('Top-three-row rescue leaves a stack that survives pressure and can be lowered afterwards', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-top-three.json', import.meta.url), 'utf8'));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives;
  let revivedAt: number | null = null; side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, side.task ? 600 : 45);
  while (!qp.over && side.life === 'alive' && qp.frame < (revivedAt === null ? saved.frame + 900 : revivedAt + 900)) {
    qp.tick([]); if (side.revives > initial && revivedAt === null) revivedAt = qp.frame;
  }
  assert.notEqual(revivedAt, null); assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1); assert.ok(qp.frame >= revivedAt! + 900);
  assert.ok(side.engine.board.state.reduce((height, row, y) => row.some(Boolean) ? y + 1 : height, 0) < 13);
});

for (const fixture of ['terrain', 'high', 'double']) test(`Duo constructs an I-Spin from ${fixture} terrain instead of endlessly raising its stack`, () => {
  const saved = JSON.parse(readFileSync(new URL(`./fixtures/qp-duo-ispi-${fixture}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives, pieces = side.engine.stats.pieces;
  qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.revives === initial && side.engine.stats.pieces < pieces + 30 && qp.frame < saved.frame + 300) qp.tick([]);
  if (side.revives !== initial + 1) writeFileSync(`TEMP/Q1-ispi-${fixture}-logic-failure.json`, JSON.stringify(qp.checkpoint(true)));
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1);
  assert.ok(qp.events.some(event => event.side === 1 && event.type === 'lock' && (event.data as { piece: string }).piece === 'i' && (event.data as { lines: number }).lines > 0 && (event.data as { spin: string }).spin !== 'none'));
  if (fixture === 'double') assert.ok(qp.events.some(event => event.side === 1 && event.type === 'lock' && (event.data as { piece: string }).piece === 'i' && (event.data as { lines: number }).lines === 2 && (event.data as { spin: string }).spin !== 'none'));
  assert.equal(qp.completed.at(-1)!.tasks.resets, 0);
});

test('Duo completes a Quad at 2-plus Combo and the following no-Hold Combo from its real failure', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-quad-combo.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives;
  let quadCombo = false; side.engine.events.on('falling.lock', result => { if (result.lines === 4 && result.stats.combo >= 2) quadCombo = true; });
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.revives === initial && qp.frame < saved.frame + 900) qp.tick([]);
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1); assert.equal(quadCombo, true);
  assert.ok(qp.completed.at(-1)!.tasks.prompts.every(prompt => prompt.complete));
});

test('Duo constructs S/Z Spin Triple from the continuous-run failure and completes the following Hold task', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-sz-triple.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives, start = qp.frame;
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 1000);
  while (!qp.over && side.revives === initial && qp.frame < start + 600) qp.tick([]);
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1);
  assert.ok(qp.events.some(event => event.side === 1 && event.type === 'lock' && ['s', 'z'].includes((event.data as { piece: string }).piece) && (event.data as { lines: number }).lines === 3 && (event.data as { spin: string }).spin !== 'none'));
  const tasks = qp.completed.at(-1)!.tasks;
  assert.ok(tasks.prompts.every(prompt => prompt.complete)); assert.equal(tasks.resets, 0);
});

test('Duo builds an upper-half Quad from its real Worker failure and completes the following flat I clears', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-upper-quad.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives, start = qp.frame;
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.revives === initial && qp.frame < start + 900) qp.tick([]);
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1);
  assert.ok(qp.events.some(event => event.side === 1 && event.type === 'lock' && (event.data as { lines: number }).lines === 4 && Math.min(...(event.data as { cells: [number, number][] }).cells.map(cell => cell[1])) > 10));
  assert.ok(qp.completed.at(-1)!.tasks.prompts.every(prompt => prompt.complete));
});

test('Duo prepares an O Single instead of repeatedly building O Doubles', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1]; qp.settings.quickplay.tasks = ['f-osingle-1']; qp.settings.quickplay.bot.pps = 10;
  qp.down(0); qp.botPlanner = () => planQpBot(qp, 1, 600);
  for (let frame = 0; frame < 2400 && !qp.over && !side.revives && side.engine.stats.pieces < 40; frame++) qp.tick([]);
  assert.equal(side.revives, 1);
  assert.ok(qp.events.some(event => event.side === 1 && event.type === 'lock' && (event.data as { piece: string }).piece === 'o' && (event.data as { lines: number }).lines === 1));
});

test('Duo finishes the real Worker T-Spin Single failure with a bounded translated construction', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/qp-duo-tss.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const qp = QuickPlayRuntime.fromCheckpoint(saved), side = qp.sides[1], initial = side.revives, pieces = side.engine.stats.pieces, start = qp.frame;
  side.plan = null; side.nextSteps = []; qp.botPlanner = () => planQpBot(qp, 1, 600);
  while (!qp.over && side.revives === initial && qp.frame < start + 600) qp.tick([]);
  assert.equal(side.life, 'alive'); assert.equal(side.revives, initial + 1); assert.ok(side.engine.stats.pieces - pieces <= 12);
  assert.ok(qp.events.some(event => event.side === 1 && event.type === 'lock' && (event.data as { lines: number }).lines === 1 && (event.data as { piece: string }).piece === 't' && (event.data as { spin: string }).spin === 'normal'));
});

test('All-Spin wounds distinguish clear size, spin kind and piece, heal after varied clears and survive checkpoints', () => {
  const settings = structuredClone(defaults); settings.quickplay.profile.mods = ['allspin']; settings.quickplay.pressure.mode = 'none'; settings.training.countdownSeconds = 0;
  const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start(); tick(game, 1);
  const side = game.qp!.sides[0], engine = side.engine;
  const single = () => {
    const y = side.modState.wounds.length;
    engine.board.state[y] = Array.from({ length: 10 }, (_, x) => x >= 3 && x <= 6 ? null : { mino: 'j' as const, connections: 0 });
    engine.initiatePiece('i'); tap(game, 'hardDrop');
  };
  single(); assert.equal(side.modState.wounds.length, 0); single();
  assert.equal(side.modState.wounds.length, 1); assert.equal(side.modState.wounds[0].remaining, 6);
  assert.equal(engine.board.state[0].filter(tile => tile?.mino === 'gbd').length, 9);
  assert.equal(engine.board.perfectClear, true);
  const clone = QuickPlayRuntime.fromCheckpoint(game.qp!.checkpoint()); assert.deepEqual(clone.sides[0].modState, side.modState);
  for (let n = 0; n < 6; n++) assert.equal(qpDuplicateClear(side.modState, n % 2 ? 1 : 2, 'j', 'none', side.mods), 0);
  assert.equal(qpHealWounds(side.modState, engine), 1); assert.equal(engine.board.state[0].filter(Boolean).length, 9); assert.equal(engine.board.state[0].filter(tile => tile?.mino === 'gbd').length, 0);
  const state = initialQpModState(engine.board.state);
  assert.equal(qpDuplicateClear(state, 0, 't', 'mini', ['allspin']), 0);
  assert.equal(qpDuplicateClear(state, 0, 't', 'mini', ['allspin']), 1);
  assert.equal(qpDuplicateClear(state, 0, 'j', 'normal', ['allspin']), 0);
  assert.equal(qpDuplicateClear(state, 0, 'j', 'normal', ['allspin']), 1);
  assert.ok(game.qp!.events.flatMap(qpSounds).includes('wound'));
});

test('Invisible preserves garbage visibility, recent placements and the native replay visibility floor', () => {
  const game = create(), side = game.qp!.sides[0]; side.mods = ['invisible'];
  const visual = qpVisual(side, 120);
  assert.equal(qpTileOpacity(visual, 't', 0, 0), 0); assert.equal(qpTileOpacity(visual, 'gb', 0, 0), .7);
  side.modState.born[0][0] = 117; assert.equal(qpTileOpacity(visual, 't', 0, 0), .7);
  visual.frame = 140; visual.replay = true; assert.equal(qpTileOpacity(visual, 't', 0, 0), .4);
  visual.playing = false; assert.equal(qpTileOpacity(visual, 't', 0, 0), 1);
});

test('Freefall uses dynamic 20G and floor lock delays while timing plans remain executable', () => {
  const settings = structuredClone(defaults); settings.quickplay.profile.mods = ['gravity_reversed']; settings.quickplay.pressure.mode = 'none'; settings.training.countdownSeconds = 0;
  const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start(); tick(game, 1);
  assert.equal(game.engine.dynamic.gravity.get(), 20); assert.equal(game.engine.misc.movement.lockTime, 24);
  game.qp!.climb.altitude = 1651; tick(game, 1); assert.equal(game.engine.misc.movement.lockTime, 11);
  game.engine.glock = 0; tick(game, 1); assert.ok(game.engine.falling.location[1] < 5);
  const result = searchRevive(game.qp!.checkpoint(), 0, { nodes: 4000, depth: 1, beam: 3, milliseconds: 500, information: 'seeded' });
  assert.ok(result.routes.length); assert.ok(result.routes.every(route => route.state.sides[0].engine.snapshot.stats.pieces > game.engine.stats.pieces));
});

test('Expert tanks its accepted garbage batch on the lock frame while ordinary QP enters rows every five frames', () => {
  for (const expert of [false, true]) {
    const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.quickplay.pressure.mode = 'none'; settings.quickplay.profile.mods = expert ? ['expert'] : [];
    const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start(); const side = game.qp!.sides[0];
    acceptPressure(side.garbage, [{ frame: 0, amount: 4, stage: 'after-receiver', source: 1, sourceAltitude: 0 }], { frame: 0, altitude: 0, floor: 1, multiplier: 1, ownBonus: 0, allyBonus: 0, allyDown: false, mods: side.mods });
    side.garbage.pending[0].ready = 0; game.input.press('hardDrop'); game.step();
    assert.equal(side.garbage.inserted, expert ? 4 : 0);
    game.input.release('hardDrop'); tick(game, 5); assert.equal(side.garbage.inserted, expert ? 4 : 1);
    const frames = game.qp!.events.filter(event => event.type === 'garbage-row').map(event => event.frame);
    if (expert) assert.deepEqual(frames, [0, 0, 0, 0]); else assert.deepEqual(frames, [4]);
  }
});

test('Solo QP trainer playback preserves climb, wind-up, cancellation, garbage, input timing and scene state', async () => {
  const game = create(), qp = game.qp!;
  game.settings.quickplay.pressure = { mode: 'replay', strength: 1, burstiness: 0, tape: { version: 1, name: 'Reference burst', ruleRevision: 'tetrio-v19-20260714', frames: 600, mods: [], unknown: [], packets: [{ frame: 0, amount: 12, stage: 'after-receiver', source: 1, sourceAltitude: 0 }] } };
  const snapshots = new Map<number, ReturnType<typeof qp.checkpoint>>();
  for (let frame = 0; frame < 520; frame++) {
    if ([40, 180, 410].includes(frame)) game.input.press('hardDrop');
    if ([41, 181, 411].includes(frame)) game.input.release('hardDrop');
    game.step(); if ([73, 423, 520].includes(qp.frame)) snapshots.set(qp.frame, qp.checkpoint());
  }
  const replay = game.export(), playback = await buildPlayback(readReplay(replay, 'Solo QP')[0], game.settings);
  assert.equal(playback.duration, qp.frame / 60); assert.deepEqual(playback.engine.board.state, game.engine.board.state);
  const final = playback.frames.at(-1)!; assert.equal(final.qp!.altitude, qp.climb.altitude); assert.equal(final.qp!.rank, qp.climb.rank);
  assert.deepEqual(final.qp!.view.sides[0].garbage, qp.sides[0].garbage);
  assert.ok(playback.frames.some(frame => frame.sounds.includes('garbagewindup_3')));
  assert.ok(playback.frames.some(frame => frame.sounds.includes('garbagerise')));
  for (const [frame, expected] of snapshots) {
    const scene = qpPlaybackScene(playback, frame / 60);
    assert.deepEqual(scene.sides, expected.sides); assert.deepEqual(scene.climb, expected.climb);
  }
});

test('Revive queue boundaries count empty Hold and permit rotations without consuming Next', () => {
  const game = create(true), qp = game.qp!; qp.down(1);
  const boundary = { remaining: 1, unknown: false };
  assert.equal(trialQpOperation(qp.checkpoint(), 0, { actions: [{ at: 0, key: 'hold', down: true }, { at: 1, key: 'hold', down: false }, { at: 2, key: 'hardDrop', down: true }], duration: 4, label: 'Hold and drop' }, undefined, boundary), null);
  assert.equal(boundary.unknown, true);
  const noQueue = { remaining: 0, unknown: false };
  const rotation = trialQpOperation(qp.checkpoint(), 0, { actions: [{ at: 0, key: 'rotateCW', down: true }, { at: 1, key: 'rotateCW', down: false }], duration: 2, label: 'Rotate' }, undefined, noQueue);
  assert.ok(rotation); assert.equal(rotation.consumed, 0); assert.equal(noQueue.unknown, false);
  const single = trialQpOperation(qp.checkpoint(), 0, { actions: [{ at: 0, key: 'hardDrop', down: true }], duration: 2, label: 'Drop' }, undefined, { remaining: 1, unknown: false });
  assert.ok(single); assert.equal(single.consumed, 1);
});

test('Saved Revive situations initialize fresh games and cannot rewind a running game', () => {
  const original = create(true); original.qp!.down(1); tick(original, 40); tap(original, 'rotateCW');
  const scene = original.qp!.checkpoint(), fresh = new TrainerGame(original.settings, original.seed, undefined, 'zenith');
  fresh.initializeReviveScene(scene); assert.deepEqual(fresh.qp!.checkpoint(), scene); assert.equal(fresh.elapsedMs, original.elapsedMs);
  fresh.start(); assert.throws(() => fresh.initializeReviveScene(scene), /before starting/);
  assert.throws(() => original.qp!.initializeScene(scene), /new run/);
  fresh.analysisPending = true; tick(fresh, 10); assert.equal(fresh.qp!.frame, scene.frame + 10);
  assert.equal(fresh.canUndo, false); assert.equal(fresh.canRedo, false);
});

test('Revive statistics retain completed, interrupted and topout attempts exactly once', () => {
  const attempts: ReviveAttempt[] = [], tracker = new RevivePracticeTracker(attempt => attempts.push(attempt));
  const first = create(true); first.qp!.down(1); tracker.update(first.qp);
  for (let i = 0; i < 20; i++) { tap(first, 'rotateCW'); tracker.update(first.qp); }
  tick(first, 30); tracker.update(first.qp); assert.equal(attempts[0].result, 'completed');
  first.qp!.down(1); tracker.update(first.qp); tick(first, 10);
  const second = create(true); tracker.update(second.qp); assert.equal(attempts[1].result, 'interrupted'); assert.ok(attempts[1].frames > 0);
  second.qp!.down(1); tracker.update(second.qp); second.qp!.down(0); tracker.update(second.qp);
  for (let i = 0; i < 10; i++) tracker.update(second.qp);
  assert.deepEqual(attempts.map(attempt => attempt.result), ['completed', 'interrupted', 'topout']);
});

test('QP internal search copies preserve dynamic physics, both sides, task timing and garbage without changing the live run', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1];
  qp.down(0); side.engine.dynamic.gravity.base = .8; side.engine.dynamic.gravity.set(.9); side.engine.misc.movement.lockTime = 16;
  side.garbage.entering = [{ hole: 2, size: 1, packet: 99 }]; side.garbage.enterAt = 30;
  for (let frame = 0; frame < 12; frame++) qp.tick([], frame === 0 ? [{ frame: side.engine.frame, type: 'keydown', data: { key: 'moveLeft', subframe: 0 } }] : []);
  const checkpoint = qp.checkpoint(true), clone = QuickPlayRuntime.fromCheckpoint(checkpoint);
  assert.deepEqual(clone.checkpoint(true), checkpoint);
  for (let frame = 0; frame < 100; frame++) { qp.tick([], []); clone.tick([], []); }
  assert.deepEqual(clone.checkpoint(true), qp.checkpoint(true));
  const before = qp.checkpoint(true); searchRevive(qp.checkpoint(), 1, { nodes: 64, depth: 6, beam: 4, milliseconds: 1000, information: 'seeded' });
  assert.deepEqual(qp.checkpoint(true), before);
});

test('Revive search finds legal Hold O Double and links the following rotation task', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1], double = reviveCatalog.find(task => task.predicate === 'odouble')!.id;
  qp.settings.quickplay.tasks = [double, 'f-rotate-20']; qp.down(0);
  const snapshot = side.engine.snapshot(); snapshot.falling = spawnSnapshot(side.engine, 'i'); snapshot.hold = 'o'; snapshot.holdLocked = false;
  for (let y = 0; y < 2; y++) snapshot.board[y] = snapshot.board[y].map((_, x) => x < 2 ? null : { mino: 'gb' as any, connections: 0 });
  side.engine.fromSnapshot(snapshot);
  const result = searchRevive(qp.checkpoint(), 1, { nodes: 30000, depth: 3, beam: 6, milliseconds: 10000, information: 'seeded' });
  assert.equal(result.status, 'Found'); assert.ok(result.routes.some(route => route.complete));
  const best = result.routes.find(route => route.complete)!;
  assert.ok(best.operations[0].actions.some(action => action.key === 'hold' && action.down));
  assert.ok(best.state.sides[1].state.task?.prompts.every(prompt => prompt.complete));
  let state = qp.checkpoint();
  for (const operation of best.operations) { const trial = trialQpOperation(state, 1, operation); assert.ok(trial); state = trial.state; }
  assert.deepEqual(state.sides, best.state.sides);
});

test('Timed trials reject a static route that locks early at 20G, and budget exhaustion never claims impossibility', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1]; qp.down(0);
  side.engine.glock = 0; side.engine.dynamic.gravity.base = 20; side.engine.dynamic.gravity.set(20); side.engine.misc.movement.lockTime = 1;
  const trial = trialQpOperation(qp.checkpoint(), 1, { actions: [{ at: 60, key: 'hardDrop', down: true }], duration: 62, label: 'Late hard drop' });
  assert.equal(trial, null);
  const result = searchRevive(qp.checkpoint(), 1, { nodes: 32, depth: 4, beam: 4, milliseconds: 1000, information: 'seeded' });
  assert.ok(result.nodes <= 32); assert.notEqual(result.status as string, 'ProvedImpossible');
});

function create(duo = false) {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.training.undoEnabled = true;
  settings.quickplay.pressure.mode = 'none';
  if (duo) settings.quickplay.profile = { mods: ['duo'], allyMods: ['duo'] };
  settings.quickplay.tasks = ['f-rotate-20'];
  const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start(); return game;
}
function tick(game: TrainerGame, frames: number) { for (let i = 0; i < frames; i++) game.step(); }
function tap(game: TrainerGame, action: GameAction) { game.input.press(action); game.step(); game.input.release(action); game.step(); }

test('Quick Play rejects every rollback path and does not create finesse statistics', async () => {
  const game = create();
  game.setFinesseEnabled(true); tap(game, 'moveLeft'); tap(game, 'moveRight'); tap(game, 'hardDrop');
  const snapshot = game.engine.snapshot(), elapsed = game.elapsedMs;
  assert.equal(game.rules.finesse, false); assert.equal(game.canUndo, false); assert.equal(game.undo(), false); assert.equal(game.redo(), false); assert.equal(game.retryAnalysisPlacement(), false);
  assert.deepEqual(game.engine.snapshot(), snapshot); assert.equal(game.elapsedMs, elapsed); assert.equal(game.placements.length, 1); assert.equal(game.fault, null); assert.equal(game.demonstration, null);
  assert.equal(game.placements[0].accepted, true); assert.equal(game.placements[0].finesse, null);
  assert.equal(game.export().mode, 'zenith'); assert.equal((await analyzeSession(game.export())).verified, 0);
  await assert.rejects(exportNative(game.export()), /Native Zenith \/ Duo export has not been validated/);
});

test('Zenith queue adds cancellation sickness pieces and a single I5, retaining random state', () => {
  const bag = new ZenithBag(1234, false); let streak = 0; bag.cancelStreak = () => streak;
  assert.equal(new Set(bag.next()).size, 7);
  streak = 60; const first = bag.next(); assert.equal(first.length, 14); assert.equal(first[0], 'i5');
  const snapshot = bag.snapshot(), expected = bag.next(); assert.equal(expected.length, 13); assert.ok(!expected.includes('i5' as any));
  bag.fromSnapshot(snapshot); assert.deepEqual(bag.next(), expected);
  const volatile = new ZenithBag(1234, true); volatile.cancelStreak = () => 40;
  assert.equal(volatile.next().length, 9);
});

test('wind-up splits capped packets and cancellation cannot spend unreleased portions', () => {
  assert.deepEqual(splitWindup(19, 0, false, 100, 0), { portions: [{ amount: 4, release: 160 }, { amount: 4, release: 190 }, { amount: 4, release: 220 }, { amount: 4, release: 250 }], until: 340, discarded: 3, windup: true });
  const state = initialGarbage(1);
  const context = { frame: 0, altitude: 0, floor: 1, multiplier: 1, ownBonus: 0, allyBonus: 0, allyDown: false, mods: [] };
  acceptPressure(state, [{ frame: 0, amount: 4, stage: 'after-receiver', source: 1, sourceAltitude: 0 }, { frame: 0, amount: 4, stage: 'after-receiver', source: 1, sourceAltitude: 0 }], context);
  assert.equal(state.pending.length, 2);
  assert.deepEqual(cancelGarbage(state, 8, 1, 59, false), { sent: 8, cancelled: 0 });
  assert.deepEqual(cancelGarbage(state, 8, 1, 60, false), { sent: 4, cancelled: 4 });
});

test('receiver modifiers run once according to the recorded packet stage', () => {
  const context = { frame: 0, altitude: 0, floor: 1, multiplier: 2, ownBonus: 0, allyBonus: 0, allyDown: false, mods: ['volatile'] as const };
  const state = initialGarbage(5);
  acceptPressure(state, [{ frame: 0, amount: 4, stage: 'before-receiver', source: 1, sourceAltitude: 0 }, { frame: 0, amount: 4, stage: 'after-receiver', source: 2, sourceAltitude: 0 }], { ...context, mods: [...context.mods] });
  assert.deepEqual(state.pending.map(packet => packet.amount), [8, 4]);
  assert.equal(receiveAmount(4, { ...context, mods: [...context.mods], sourceAltitude: 0, cancelStreak: 0, windupUntil: -1, grace: 0 }, () => 0), 8);
});

test('generated pressure depends on elapsed time and burst state at the same height', () => {
  const settings = { mode: 'generated' as const, strength: 1, burstiness: 1, tape: null };
  const early = initialPressure(12), late = initialPressure(12);
  pressurePackets(early, settings, 600, 100, []); pressurePackets(late, settings, 36000, 100, []);
  assert.ok(early.burstLeft > 0); assert.ok(late.burstLeft > 0);
  early.burstLeft = late.burstLeft = 1;
  pressurePackets(early, settings, early.next, 100, []); pressurePackets(late, settings, late.next, 100, []);
  assert.notEqual(early.next - 600, late.next - 36000);
});

test('Duo bot operates an independent board through recorded legal inputs and rescues the player', () => {
  const game = create(true), qp = game.qp!;
  tick(game, 180); assert.ok(qp.sides[1].engine.stats.pieces > 0); assert.equal(game.engine.stats.pieces, 0);
  assert.ok(qp.events.some(event => event.side === 1 && event.type === 'inputs'));
  assert.ok(qp.down(0)); tick(game, 100);
  assert.equal(qp.sides[0].life, 'alive'); assert.equal(qp.sides[1].revives, 1); assert.equal(qp.completed.length, 1);
  assert.equal(qp.sides[0].engine.frame, qp.sides[1].engine.frame); assert.equal(game.status, 'playing');
});

test('player rescues bot repeatedly while pause and Just think cannot freeze QP', () => {
  const game = create(true), qp = game.qp!;
  for (let run = 0; run < 2; run++) {
    assert.ok(qp.down(1));
    game.pause(); game.setJustThink(true, 'piece'); const frame = qp.frame; tick(game, 60);
    assert.equal(qp.frame, frame + 60); assert.equal(game.status, 'playing'); assert.equal(game.settings.training.justThink, false); assert.equal(game.thinkingPaused, false);
    for (let i = 0; i < 20; i++) tap(game, 'rotateCW');
    tick(game, 30); assert.equal(qp.sides[1].life, 'alive');
  }
  assert.equal(qp.sides[0].revives, 2); assert.equal(qp.completed.length, 2);
});

test('QP clock retains all elapsed time across hidden tabs and bounded catch-up passes', () => {
  const game = create(), clock = new QuickPlayClock(); clock.start(game, 1000);
  assert.equal(clock.advance(game, 2000, undefined, 30), 30);
  assert.equal(clock.advance(game, 2000), 30);
  game.pause(); assert.equal(clock.advance(game, 4000), 120);
  assert.equal(game.qp!.frame, 180); assert.equal(game.elapsedMs, 3000);
});

test('garbage meter exposes packet phases, wind-up release and cancellation rather than raw pressure', () => {
  const state = initialGarbage(1), context = { frame: 0, altitude: 0, floor: 1, multiplier: 1, ownBonus: 0, allyBonus: 0, allyDown: false, mods: [] };
  acceptPressure(state, [{ frame: 0, amount: 12, stage: 'after-receiver', source: 1, sourceAltitude: 0 }], context);
  assert.deepEqual(garbageSegments(state, 59), []);
  assert.deepEqual(garbageSegments(state, 60), [{ id: 1, amount: 4, phase: 'caution' }]);
  assert.equal(garbageSegments(state, 230)[0].phase, 'danger');
  assert.equal(garbageSegments(state, 380)[0].phase, 'spawn');
  const cues = state.pending[0]; assert.deepEqual(packetCues(cues, 60), ['garbage_in_medium']); assert.deepEqual(packetCues(cues, 80), ['impact']); assert.deepEqual(packetCues(cues, 380), ['damage_medium']);
  state.entering.push({ hole: 3, size: 1, packet: 9 });
  assert.deepEqual(cancelGarbage(state, 3, 1, 60, false), { sent: 0, cancelled: 3 });
  assert.equal(state.entering.length, 0); assert.equal(garbageSegments(state, 60)[0].amount, 2);
  const game = create(); game.engine.board.state[16][0] = { mino: 'gb', connections: 0 };
  assert.equal(garbageWarning(game.engine.board.state, 20, state, 379).alert, false);
  cancelGarbage(state, 2, 1, 60, false);
  assert.equal(garbageSegments(state, 60).length, 0);
});

test('QP audio triggers resolve to local sprites and native size thresholds', () => {
  const sprites = JSON.parse(readFileSync('public/tetrio/sound-pack.json', 'utf8')).sprites, game = create(true), qp = game.qp!;
  const side = qp.sides[0]; side.engine.board.state[16][0] = { mino: 'gb', connections: 0 };
  acceptPressure(side.garbage, [{ frame: 0, amount: 6, stage: 'after-receiver', source: 1, sourceAltitude: 0 }], { frame: 0, altitude: 0, floor: 1, multiplier: 1, ownBonus: 0, allyBonus: 0, allyDown: false, mods: ['duo'] });
  tick(game, 322);
  assert.equal(side.feedback.alert, true);
  const sounds = qp.events.flatMap(qpSounds);
  for (const name of ['garbage_in_large', 'damage_large', 'impact', 'damage_alert']) assert.ok(sounds.includes(name), name);
  for (const name of sounds) assert.ok(sprites[name], name);
  const result = { spin: 'mini', lines: 0 } as any;
  assert.ok(placementSounds(game.engine, result, false).includes('spinend'));
  assert.ok(sprites.spin); assert.ok(sprites.boardlock_revive); assert.ok(sprites.garbagewindup_4);
});

test('legal full and mini spin routes emit rotation and locking sounds even for zero lines', () => {
  for (const [id, spin, lines] of [['tsd', 'normal', 2], ['mini', 'mini', 1], ['zero', 'normal', 0]] as const) {
    const game = create(), fixture = spinDrill(analysisContext(game.rules, game.settings, game.engine.snapshot()), id);
    game.engine.fromSnapshot(fixture.scene.context.snapshot);
    applySpinPath(game.engine, fixture.witness.steps[0].scene.path);
    const placement = game.placements.at(-1)!;
    assert.equal(placement.result.spin, spin); assert.equal(placement.result.lines, lines);
    assert.ok(game.events.some(event => event.type === 'rotation-sound' && (event.data as { spin: string }).spin === spin));
    assert.ok(placement.sounds.includes('spinend'));
    assert.equal(placement.sounds.includes('clearspin'), lines > 0);
  }
});

test('task catalog includes ordinary O objectives and chained tasks cannot complete in the same frame', () => {
  assert.equal(reviveCatalog.length, 79); assert.ok(reviveCatalog.some(task => task.predicate === 'oclear'));
  const state = initialRevive(['f-rotate-20', 'f-rotate-20']);
  for (let i = 0; i < 40; i++) reviveRotate(state, 'o');
  assert.equal(state.active, 1); assert.equal(state.prompts[1].count, 0);
  state.frame++; for (let i = 0; i < 20; i++) reviveRotate(state, 'o');
  assert.equal(state.active, 2); assert.equal(state.finishedAt, 1);
});

test('fatigue follows simulation frames, normal and reversed loadouts cannot be mixed', () => {
  const climb = initialClimb(); climb.frame = 28799; tickClimb(climb, { mods: [], allyMods: [] }); assert.equal(climb.permanentRows, 1);
  assert.throws(() => validateQpProfile({ mods: ['volatile_reversed', 'nohold'], allyMods: [] }));
  assert.throws(() => validateQpProfile({ mods: ['duo'], allyMods: [] }));
});


test('Bot retains Spin input paths and prioritizes available clear objectives', () => {
  for (const [scene, predicate, spin] of [['tsd', 'tspindouble', 'normal'], ['mini', 'tspinminiclear', 'mini'], ['zero', 'spin', 'normal'], ['i', 'ispinclear', 'mini']]) {
    const game = create(true), qp = game.qp!, side = qp.sides[1];
    qp.settings.quickplay.tasks = [reviveCatalog.find(task => task.predicate === predicate)!.id]; qp.down(0);
    const fixture = spinDrill(analysisContext(side.rules, game.settings, side.engine.snapshot()), scene);
    side.engine.fromSnapshot(fixture.scene.context.snapshot);
    const plan = planQpBot(qp, 1, 10000); assert.ok(plan.actions.some(action => action.key === 'softDrop'));
    const before = side.task!.prompts[0].count;
    for (let age = 0; age < plan.duration!; age++) qp.tick([], plan.actions.filter(action => action.at === age).map(action => ({ frame: side.engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as any);
    assert.ok(side.task!.prompts[0].count > before, `${scene} must advance the actual task`);
    const lock = qp.events.find(event => event.type === 'lock' && event.side === 1)!;
    assert.equal((lock.data as any).spin, spin); assert.ok(qp.events.some(event => event.type === 'inputs' && event.side === 1));
  }
  const game = create(true), qp = game.qp!, side = qp.sides[1];
  qp.settings.quickplay.tasks = [reviveCatalog.find(task => task.predicate === 'lines')!.id]; qp.down(0);
  side.engine.board.state[0] = Array.from({ length: 10 }, (_, x) => x >= 3 && x <= 6 ? null : { mino: 'j', connections: 0 }); side.engine.initiatePiece('i');
  const plan = planQpBot(qp, 1, 10000), result = trialQpOperation(qp.checkpoint(), 1, { actions: plan.actions, duration: plan.duration!, label: plan.reason });
  assert.ok(result); assert.ok(result.state.sides[1].state.task!.prompts[0].count > 0);
});

test('Bot builds and completes ordinary and no-Hold combos from an empty board through legal inputs', () => {
  for (const predicate of ['combo', 'combonohold']) {
    const game = create(true), qp = game.qp!, side = qp.sides[1]; qp.settings.quickplay.tasks = [reviveCatalog.find(task => task.predicate === predicate)!.id]; qp.down(0);
    for (let frame = 0; frame < 1800 && !qp.over && !side.revives; frame++) game.step();
    assert.equal(side.revives, 1, predicate); assert.equal(qp.completed[0].tasks.prompts[0].complete, true);
    assert.ok(qp.events.filter(event => event.type === 'inputs' && event.side === 1).length > 10);
  }
});

for (const task of ['a-combo-7', 'a-colorclear-1']) test(`An exhausted ${task} planning budget still returns a legal preparation placement instead of an empty wait`, () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1]; qp.settings.quickplay.tasks = [task]; qp.settings.quickplay.bot.nodes = 32; qp.down(0);
  const plan = planQpBot(qp, 1, 1);
  assert.ok(plan.actions.some(action => action.down && action.key === 'hardDrop')); assert.ok(plan.target); assert.ok(plan.nodes <= 32);
  const trial = trialQpOperation(qp.checkpoint(), 1, { actions: plan.actions, duration: plan.duration!, label: plan.reason }); assert.ok(trial); assert.equal(trial.state.sides[1].engine.snapshot.stats.pieces, side.engine.stats.pieces + 1);
  assert.equal(trial.state.sides[1].state.task!.resets, 0);
});

test('Revive Combo coaching preserves an active chain and never offers an unverified short chain as a completion route', () => {
  for (const task of ['f-combo-3', 'd-combonohold-3']) {
    const game = create(true), qp = game.qp!, side = qp.sides[0]; qp.settings.quickplay.tasks = [task]; qp.settings.quickplay.reviveNoGravity = true; qp.down(1);
    const source = qp.checkpoint(), result = searchRevive(source, 0, { nodes: 100000, depth: reviveSearchDepth, beam: 8, milliseconds: 4000, information: 'seeded', objective: 'effort' });
    assert.equal(result.status, 'Found', task); const guide = new ReviveContinuation(source, result.routes[0].operations);
    for (const operation of result.routes[0].operations) {
      for (let age = 0; age < operation.duration; age++) qp.tick(operation.actions.filter(action => action.at === age).map(action => ({ frame: side.engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as any, []);
      assert.equal(guide.advance(qp.checkpoint()), true);
      if (side.task!.prompts[0].count === 1) break;
    }
    assert.equal(side.engine.stats.combo, 1); assert.equal(side.task!.resets, 0);
    const continued = searchRevive(qp.checkpoint(), 0, { nodes: 100000, depth: reviveSearchDepth, beam: 8, milliseconds: 3000, information: 'seeded', objective: 'effort' });
    assert.equal(continued.status, 'Found', task);
    let state = qp.checkpoint();
    for (const operation of continued.routes[0].operations) {
      if (task === 'd-combonohold-3') assert.ok(!operation.actions.some(action => action.down && action.key === 'hold'));
      const trial = trialQpOperation(state, 0, operation); assert.ok(trial); assert.ok(trial.state.sides[0].engine.snapshot.stats.lines > state.sides[0].engine.snapshot.stats.lines); state = trial.state;
    }
    assert.equal(state.sides[0].state.task!.active, 1); assert.equal(state.sides[0].state.task!.resets, 0);
    const impossible = qp.checkpoint(); impossible.sides[0].engine.snapshot.board.forEach(row => row.fill(null));
    const bounded = searchRevive(impossible, 0, { nodes: 100000, depth: reviveSearchDepth, beam: 8, milliseconds: 1000, information: 'seeded' });
    assert.equal(bounded.routes.length, 0); assert.equal(bounded.status, 'BudgetExhausted');
  }
});

test('A complete Revive Combo route includes the next input-only task and rejects stale targets after garbage rises', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[0]; qp.settings.quickplay.tasks = ['f-combo-3', 'f-rotate-20']; qp.settings.quickplay.reviveNoGravity = true; qp.down(1);
  const source = qp.checkpoint(), result = searchRevive(source, 0, { nodes: 100000, depth: reviveSearchDepth, beam: 8, milliseconds: 4000, information: 'seeded', objective: 'effort' });
  assert.equal(result.status, 'Found'); const route = result.routes[0], guide = new ReviveContinuation(source, route.operations);
  assert.ok(!route.operations.at(-1)!.target); assert.ok(route.operations.at(-1)!.actions.filter(action => action.down && action.key.startsWith('rotate')).length >= 20);
  const changed = QuickPlayRuntime.fromCheckpoint(source); changed.sides[0].garbage.entering.push({ hole: 4, size: 1, packet: 1 }); changed.sides[0].garbage.enterAt = changed.frame; changed.tick([], []);
  assert.notEqual(reviveGuidanceIdentity(qp), reviveGuidanceIdentity(changed));
  assert.equal(validateReviveGuidance(changed.checkpoint(), source, route.operations[0], 1000), null);
  for (const operation of route.operations) {
    for (let age = 0; age < operation.duration; age++) qp.tick(operation.actions.filter(action => action.at === age).map(action => ({ frame: side.engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as any, []);
    assert.ok(guide.advance(qp.checkpoint()));
  }
  assert.equal(side.task!.active, 2); assert.equal(side.task!.resets, 0);
});

test('Rescue practice stacks the bot straight up until a natural KO and Stop ends both boards permanently', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1];
  assert.equal(qp.requestRescue(1), true); assert.equal(side.life, 'alive'); assert.equal(qp.sides[0].task, null);
  for (let i = 0; i < 1200 && side.life === 'alive'; i++) game.step();
  assert.equal(side.life, 'down'); assert.ok(side.engine.stats.pieces > 5);
  const inputs = qp.events.filter(event => event.type === 'inputs').flatMap(event => event.data as any[]);
  assert.ok(inputs.length > 10); assert.ok(inputs.every(input => input.data.key === 'hardDrop'));
  assert.equal((qp.events.find(event => event.type === 'down')!.data as any).reason, 'blockout');
  assert.ok(qp.sides[0].task); assert.equal(game.stopQuickPlay(), true);
  const snapshot = qp.checkpoint(true), time = game.elapsedMs; tick(game, 100); qp.tick([], []); game.resume(); game.start();
  assert.equal(game.active, false); assert.equal(qp.stopped, true); assert.deepEqual(qp.checkpoint(true), snapshot); assert.equal(game.elapsedMs, time);
  assert.equal(game.stopQuickPlay(), false); assert.equal(game.undo(), false);
});

test('Random selected task pools preserve native variants, exclude incompatible cards and use checkpointed randomness', () => {
  const selected = ['f-combo-3', 'e-combo-5', 'e-spin-1', 'f-rotate-20'];
  const game = create(true), qp = game.qp!; qp.settings.quickplay.tasks = selected; qp.settings.quickplay.taskMode = 'random'; qp.settings.quickplay.randomTaskCount = 3;
  const saved = qp.checkpoint(), copy = QuickPlayRuntime.fromCheckpoint(saved); qp.down(1); copy.down(1);
  assert.deepEqual(qp.sides[0].task, copy.sides[0].task); assert.deepEqual(qp.sides[0].garbage, copy.sides[0].garbage);
  const prompts = qp.sides[0].task!.prompts; assert.equal(prompts.length, 3); assert.equal(new Set(prompts.map(prompt => prompt.predicate)).size, 3);
  assert.ok(prompts.every(prompt => selected.includes(prompt.task) && reviveCatalog.find(task => task.id === prompt.task)!.target === prompt.target));
  const hold = reviveCatalog.find(task => task.excludes.includes('nohold'))!;
  assert.deepEqual(drawSelectedReviveTasks([hold.id, 'f-rotate-20'], 3, ['nohold'], () => .5), ['f-rotate-20']);
});

test('Duo attack is halved before RNG rounding and the survivor receiver adds fifty percent once', () => {
  const quad = { lines: 4, spin: 'none' as const, combo: 0, b2b: -1, perfectClear: false, surge: 0 };
  assert.deepEqual(qpAttack(quad, [], () => 0), [4]); assert.deepEqual(qpAttack(quad, ['duo'], () => 0), [2]);
  assert.deepEqual(qpAttack({ ...quad, lines: 1 }, ['duo'], () => .1), [1]); assert.deepEqual(qpAttack({ ...quad, lines: 1 }, ['duo'], () => .9), []);
  assert.deepEqual(qpAttack({ ...quad, perfectClear: true }, ['duo'], () => .1), [2, 2]);
  const context = { frame: 100, altitude: 0, sourceAltitude: 0, floor: 1, multiplier: 1, ownBonus: 0, allyBonus: 0, allyDown: true, mods: ['duo'] as any, cancelStreak: 0, windupUntil: 0, grace: 0 };
  assert.equal(receiveAmount(4, context, () => .5), 6); assert.equal(receiveAmount(4, { ...context, allyDown: false }, () => .5), 4);
});

test('KO and revival clear the pending pressure bar and do not replay attacks received while down', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1];
  qp.settings.quickplay.pressure = { mode: 'replay', strength: 1, burstiness: 0, tape: { version: 1, name: 'While down', ruleRevision: 'tetrio-v19-20260714', frames: 600, mods: [], unknown: [], packets: [{ frame: 10, amount: 4, stage: 'after-receiver', source: 1, sourceAltitude: 0 }] } };
  acceptPressure(side.garbage, [{ frame: 0, amount: 4, stage: 'after-receiver', source: 1, sourceAltitude: 0 }], { frame: 0, altitude: 0, floor: 1, multiplier: 1, ownBonus: 0, allyBonus: 0, allyDown: false, mods: ['duo'] });
  qp.down(1); assert.deepEqual(garbageSegments(side.garbage, qp.frame), []);
  tick(game, 20); assert.equal(side.pressure.cursor, 1); assert.equal(side.garbage.pending.length, 0);
  for (let i = 0; i < 20; i++) tap(game, 'rotateCW'); tick(game, 30);
  assert.equal(side.life, 'alive'); assert.equal(side.garbage.pending.length, 0); assert.equal(side.pressure.cursor, 1);
});


test('Revive coaching keeps a reachable placement while the piece moves and uses zero placements for rotation tasks', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[0]; qp.down(1);
  const rotation = searchRevive(qp.checkpoint(), 0, { nodes: 10000, milliseconds: 1000, depth: 8, beam: 8, information: 'seeded', objective: 'effort' });
  assert.equal(rotation.status, 'Found'); assert.equal(rotation.routes[0].targets.length, 0);
  assert.ok(rotation.routes[0].operations.every(operation => !operation.actions.some(action => action.key === 'hardDrop')));
  side.task = initialRevive([reviveCatalog.find(task => task.predicate === 'lines')!.id]);
  side.engine.board.state[0] = Array.from({ length: 10 }, (_, x) => x >= 3 && x <= 6 ? null : { mino: 'j', connections: 0 }); side.engine.initiatePiece('i');
  const source = qp.checkpoint(), identity = reviveGuidanceIdentity(qp);
  const result = searchRevive(source, 0, { nodes: 1000, milliseconds: 1000, depth: 1, beam: 8, information: 'seeded', objective: 'effort' });
  const operation = result.routes[0].operations[0]; assert.ok(operation.target);
  tap(game, 'moveRight'); assert.equal(reviveGuidanceIdentity(qp), identity);
  const updated = validateReviveGuidance(qp.checkpoint(), source, operation, 1000); assert.ok(updated); assert.deepEqual(updated.target, operation.target);
  assert.ok(updated.actions.some(action => action.key === 'moveLeft' && action.down));
  side.garbage.entering = [{ hole: 3, size: 1, packet: 1 }]; side.garbage.enterAt = qp.frame; tick(game, 1);
  assert.notEqual(reviveGuidanceIdentity(qp), identity);
});

test('Bot constructs a T-Spin Double from an empty board before executing its rescue', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1]; qp.settings.quickplay.tasks = ['e-tspindouble-1']; qp.down(0);
  for (let frame = 0; frame < 1800 && !qp.over && !side.revives; frame++) game.step();
  assert.equal(side.revives, 1); assert.ok(side.engine.stats.pieces > 1);
  assert.ok(qp.events.some(event => event.type === 'lock' && event.side === 1 && (event.data as any).spin === 'normal' && (event.data as any).lines === 2));
});


test('Revive coach consumes a held-piece placement and continues the cached input-only task', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[0];
  qp.settings.quickplay.tasks = ['f-odouble-1', 'f-rotate-20']; qp.settings.quickplay.reviveNoGravity = true; qp.down(1);
  const snapshot = side.engine.snapshot(); snapshot.falling = spawnSnapshot(side.engine, 'i'); snapshot.hold = 'o'; snapshot.holdLocked = false;
  for (let y = 0; y < 2; y++) snapshot.board[y] = snapshot.board[y].map((_, x) => x < 2 ? null : { mino: 'gb' as any, connections: 0 });
  side.engine.fromSnapshot(snapshot);
  const source = qp.checkpoint(), result = searchRevive(source, 0, { nodes: 100000, depth: 8, beam: 8, milliseconds: 10000, information: 'seeded', objective: 'effort' });
  assert.equal(result.status, 'Found'); const route = result.routes[0], guide = new ReviveContinuation(source, route.operations);
  assert.ok(route.operations[0].actions.some(action => action.down && action.key === 'hold'));
  const demo = new ReviveDemo(source, route.operations[0]); assert.equal(demo.frame.piece?.symbol, 'i');
  for (let i = 0; i < 200 && !demo.completed; i++) demo.advance();
  assert.equal(demo.completed, true); assert.equal(demo.frame.piece?.symbol, 'o'); assert.notEqual(demo.runtime.sides[0].engine.falling.symbol, 'o');
  const frozen = structuredClone(demo.frame); demo.advance(); assert.deepEqual(demo.frame, frozen);
  for (const operation of route.operations) {
    for (let age = 0; age < operation.duration; age++) qp.tick(operation.actions.filter(action => action.at === age).map(action => ({ frame: side.engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as any, []);
    assert.equal(guide.advance(qp.checkpoint()), true);
    if (guide.index === 1) { assert.equal(guide.operation.target, undefined); assert.equal(guide.operation.actions.filter(action => action.key === 'rotateCW' && action.down || action.key === 'rotateCCW' && action.down || action.key === 'rotate180' && action.down).length, 20); }
  }
  assert.equal(side.task!.active, 2); assert.equal(guide.index, route.operations.length);
});

test('Revive no gravity prevents automatic falling and locking while drops, garbage and task time still run', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[0]; qp.settings.quickplay.reviveNoGravity = true; qp.down(1);
  side.engine.glock = 0; const y = side.engine.falling.y; for (let i = 0; i < 360; i++) qp.tick([], []);
  assert.equal(side.engine.falling.y, y); assert.equal(side.engine.stats.pieces, 0); assert.equal(qp.frame, 360);
  qp.tick([{ frame: side.engine.frame, type: 'keydown', data: { key: 'softDrop', subframe: 0 } }], []);
  assert.ok(side.engine.falling.y < y); for (let i = 0; i < 120; i++) qp.tick([], []); assert.equal(side.engine.stats.pieces, 0);
  qp.tick([{ frame: side.engine.frame, type: 'keyup', data: { key: 'softDrop', subframe: 0 } }, { frame: side.engine.frame, type: 'keydown', data: { key: 'hardDrop', subframe: 0 } }], []);
  assert.equal(side.engine.stats.pieces, 1);
  side.garbage.entering = [{ hole: 3, size: 1, packet: 1 }]; side.garbage.enterAt = qp.frame; qp.tick([], []);
  assert.ok(side.engine.board.state[0].some(tile => tile?.mino === 'gb'));
  const copy = QuickPlayRuntime.fromCheckpoint(qp.checkpoint()); assert.equal(copy.settings.quickplay.reviveNoGravity, true);
  for (let i = 0; i < 60; i++) { qp.tick([], []); copy.tick([], []); } assert.deepEqual(copy.checkpoint(), qp.checkpoint());
  const before = side.engine.falling.y; qp.settings.quickplay.reviveNoGravity = false; for (let i = 0; i < 60; i++) qp.tick([], []); assert.ok(side.engine.falling.y < before);
});


test('Color Clear reuses PC proposals but executes and validates the complete QP input route', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[0]; qp.settings.quickplay.tasks = ['a-colorclear-1']; qp.settings.quickplay.reviveNoGravity = true; qp.down(1);
  const source = qp.checkpoint(), result = searchRevive(source, 0, { nodes: 100000, depth: 20, beam: 8, milliseconds: 5000, information: 'seeded', objective: 'effort' });
  assert.equal(result.status, 'Found'); assert.ok(result.routes[0].operations.length > 1);
  const guide = new ReviveContinuation(source, result.routes[0].operations);
  for (const operation of result.routes[0].operations) {
    for (let age = 0; age < operation.duration; age++) qp.tick(operation.actions.filter(action => action.at === age).map(action => ({ frame: side.engine.frame, type: action.down ? 'keydown' : 'keyup', data: { key: action.key, subframe: 0 } })) as any, []);
    assert.equal(guide.advance(qp.checkpoint()), true);
  }
  assert.equal(side.task!.prompts[0].complete, true); assert.ok(side.engine.board.state.every(row => row.every(tile => tile === null)));
  const changed = QuickPlayRuntime.fromCheckpoint(source); changed.sides[0].garbage.entering = [{ hole: 3, size: 1, packet: 1 }]; changed.sides[0].garbage.enterAt = changed.frame;
  const trial = trialQpOperation(changed.checkpoint(), 0, result.routes[0].operations[0]);
  assert.ok(!trial || JSON.stringify(trial.target[0]) !== JSON.stringify(result.routes[0].operations[0].target));
});


test('A gravity lock discards the old bot piece plan before it can control the next piece', () => {
  const game = create(true), qp = game.qp!, side = qp.sides[1];
  side.engine.glock = 0; side.engine.dynamic.gravity.base = 20; side.engine.dynamic.gravity.set(20); side.engine.misc.movement.lockTime = 1;
  side.plan = { actions: [{ at: 80, key: 'moveLeft', down: true }, { at: 81, key: 'hardDrop', down: true }], duration: 83, cursor: 0, age: 0, target: null, knownPieces: 1, nodes: 0, reason: 'Future input test' };
  for (let i = 0; i < 10 && side.engine.stats.pieces === 0; i++) qp.tick([], []);
  assert.equal(side.engine.stats.pieces, 1); assert.equal(side.plan, null);
});
