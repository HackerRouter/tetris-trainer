import { test, expect } from '@playwright/test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { defaults } from '../../src/settings';

test('Ordinary Duo reaches 10, 20 and 35 bot revives in one continuous real Worker run', async ({ page }) => {
  test.skip(process.env.QP_REVIVE_RUN !== '1', 'Set QP_REVIVE_RUN=1 to run the continuous acceptance scenario.');
  test.setTimeout(1800000);
  const seed = Number(process.env.QP_RUN_SEED ?? 1234), output = process.env.QP_RUN_OUTPUT ?? 'TEMP/Q1-duo-revive-run-browser';
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  settings.quickplay.profile = { mods: ['duo'], allyMods: ['duo'] }; settings.quickplay.trigger = 'none'; settings.quickplay.tasks = []; settings.quickplay.bot.pps = 10;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.ts', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__qpGame = () => game;' }); });
  await page.addInitScript(({ settings, seed }) => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (array: any) => array instanceof Uint32Array && array.length === 1 ? (array[0] = seed - 1, array) : random(array);
  }, { settings, seed });
  await page.setViewportSize({ width: 2560, height: 1600 }); await page.goto('/#quickplay'); await page.click('#qp-form button[type="submit"]');
  await page.evaluate(() => {
    const game = (window as any).__qpGame(), step = game.step.bind(game);
    game.step = () => {
      if (game.qp.frame % 10 === 0) game.input.press('hardDrop');
      if (game.qp.frame % 10 === 1) game.input.release('hardDrop');
      step();
    };
  });
  writeFileSync(output + '.jsonl', JSON.stringify({ seed, settings, playerPps: 6, milestones: [10, 20, 35], timing: 'Real browser animation and asynchronous production Worker.' }) + '\n');
  let taskKey = '', revives = 0, previousLog = -600, reason = 'Time limit';
  for (let sample = 0; sample < 1500; sample++) {
    const state = await page.evaluate(() => {
      const qp = (window as any).__qpGame().qp, bot = qp.sides[1], player = qp.sides[0];
      return { seed: qp.seed, frame: qp.frame, over: qp.over, altitude: qp.climb.altitude, revives: bot.revives, playerDeaths: player.deaths, botDeaths: bot.deaths, pieces: bot.engine.stats.pieces, life: bot.life, task: bot.task, locks: bot.lockFrames, plan: bot.plan?.reason, worker: typeof qp.botPlanner === 'function', errors: qp.events.filter((event: any) => event.type === 'bot-error'), board: bot.engine.board.state.slice(0, 22).map((row: any[]) => row.map(tile => tile ? '#' : '.').join('')) };
    });
    const key = JSON.stringify([state.playerDeaths, state.task?.active, state.task?.prompts.map((prompt: any) => prompt.task)]);
    if (key !== taskKey || state.revives !== revives || state.frame - previousLog >= 600 || state.over || state.botDeaths) {
      const line = JSON.stringify({ type: state.revives !== revives ? 'revive' : key !== taskKey ? 'task' : 'progress', ...state, milestone: [10, 20, 35].includes(state.revives) });
      appendFileSync(output + '.jsonl', line + '\n'); console.log(line);
      writeFileSync(output + '-checkpoint.json', JSON.stringify(await page.evaluate(() => (window as any).__qpGame().qp.checkpoint(true))));
      if (key !== taskKey) writeFileSync(output + `-task-${state.frame}.json`, JSON.stringify(await page.evaluate(() => (window as any).__qpGame().qp.checkpoint())));
      taskKey = key; previousLog = state.frame;
    }
    revives = state.revives;
    expect(state.seed).toBe(seed); if (!state.over) expect(state.worker).toBe(true); expect(state.errors).toEqual([]);
    if (state.revives >= 35) { reason = '35 revives reached'; break; }
    if (state.botDeaths || state.over) { reason = 'Bot topout'; break; }
    if (state.frame >= 72000) break;
    await page.waitForTimeout(1000);
  }
  const result = { reason, revives, milestones: [10, 20, 35].map(target => ({ target, pass: revives >= target })), errors };
  appendFileSync(output + '.jsonl', JSON.stringify({ type: 'result', ...result }) + '\n'); console.log(JSON.stringify(result));
  await page.screenshot({ path: output + '.png', fullPage: true });
  expect(errors).toEqual([]); expect(revives, JSON.stringify(result)).toBeGreaterThanOrEqual(35);
});
