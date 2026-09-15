import { test, expect } from '@playwright/test';
import { defaults } from '../../src/settings';
import { TrainerGame } from '../../src/game';
import { spawnSnapshot } from '../../src/engine';

test('Revive page searches multiple timed routes, demonstrates a copy and records any legal completion without pausing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.ts', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__qpGame = () => game;' }); });
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } });
  await page.setViewportSize({ width: 2048, height: 1280 }); await page.goto('/#revive');
  await expect(page.locator('.page-nav a[href="#revive"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#qp-options')).toBeHidden(); await expect(page.locator('#revive-options')).toBeVisible();
  await page.click('#revive-form button[type="submit"]'); await expect(page.locator('#qp-task-title')).toHaveText('Your revive tasks', { timeout: 5000 });
  await expect(page.locator('#revive-depth')).toHaveCount(0); await expect(page.locator('#revive-information')).toHaveCount(0);
  await expect(page.locator('#revive-search-status')).toContainText('Completion route found');
  expect(await page.locator('.revive-route').count()).toBeGreaterThan(1); await expect(page.locator('#revive-steps')).toContainText('Release');
  await page.locator('#revive-options details').first().evaluate(node => (node as HTMLDetailsElement).open = true); await page.click('#revive-save');
  const originalSource = await page.locator('#revive-scope').textContent(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(450); await expect(page.locator('#revive-scope')).toHaveText(originalSource!);
  await expect(page.locator('#revive-coach-steps')).toContainText('20'); await expect(page.locator('#revive-next-step')).not.toContainText('Hard drop');
  await page.click('#revive-demo'); const before = await page.evaluate(() => { const g = (window as any).__qpGame(); return { frame: g.qp.frame, inputs: g.inputs }; });
  await page.waitForTimeout(250); expect(await page.evaluate(() => (window as any).__qpGame().qp.frame)).toBeGreaterThan(before.frame + 5);
  expect(await page.evaluate(() => (window as any).__qpGame().inputs)).toBe(before.inputs);
  await page.screenshot({ path: 'TEMP/Q1-revive-browser.png', fullPage: true });
  for (let i = 0; i < 20; i++) { await page.keyboard.press('ArrowUp', { delay: 20 }); await page.waitForTimeout(20); }
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[0].revives)).toBe(1);
  await expect(page.locator('#revive-detail')).toBeHidden(); await expect(page.locator('#revive-stats')).toContainText('1 completed');
  await page.click('#revive-open'); await expect(page.locator('#revive-status')).toHaveText('New run started from the saved situation.');
  expect(await page.evaluate(() => (window as any).__qpGame().qp.sides[0].task.prompts[0].count)).toBe(0);
  const labFrame = await page.evaluate(() => (window as any).__qpGame().qp.frame);
  await page.locator('a[href="#quickplay"]').click(); await expect(page.locator('#qp-options')).toBeVisible(); await expect(page.locator('#revive-options')).toBeHidden();
  await expect(page.locator('#qp-party')).toHaveValue('solo'); await page.waitForTimeout(200);
  await page.locator('a[href="#revive"]').click(); await expect(page.locator('#revive-options')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.frame)).toBeGreaterThan(labFrame + 5);
  await expect(page.locator('#pause')).toBeHidden(); await expect(page.locator('#think-toggle')).toBeHidden(); await expect(page.locator('#undo')).toBeHidden();
  await page.click('#revive-stop'); await expect(page.locator('#overlay-value')).toHaveText('Run stopped');
  expect(errors).toEqual([]);
});

test('Solo QP replay displays its garbage meter, native previews and altitude and opens a fresh Revive situation', async ({ page }) => {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  settings.quickplay.pressure = { mode: 'replay', strength: 1, burstiness: 0, tape: { version: 1, name: 'Burst', ruleRevision: 'tetrio-v19-20260714', frames: 500, mods: [], unknown: [], packets: [{ frame: 0, amount: 12, stage: 'after-receiver', source: 1, sourceAltitude: 0 }] } };
  const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start();
  for (let frame = 0; frame < 500; frame++) game.step();
  const replay = game.export(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.ts', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__qpGame = () => game;' }); });
  await page.setViewportSize({ width: 2048, height: 1280 }); await page.goto('/#replays');
  await page.setInputFiles('#player-file', { name: 'solo-qp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replay)) });
  await expect(page.locator('#player-status')).toHaveText('Ready.');
  await page.locator('#player-seek').evaluate((input: HTMLInputElement) => { input.value = '4'; input.dispatchEvent(new Event('input')); });
  await expect(page.locator('#player-qp-height')).toContainText('CLIMB SPEED');
  await expect(page.locator('#player-tetrion .qp-garbage-meter')).toHaveAttribute('aria-label', /queued/);
  await expect(page.locator('#player-tetrion .qp-garbage-segment')).not.toHaveCount(0);
  await expect(page.locator('#player-hold-panel')).toHaveClass(/native-frame/); await expect(page.locator('#player-qp-partner')).toBeHidden();
  const boxes = await page.evaluate(() => { const stats = document.querySelector('#player-clock')!.getBoundingClientRect(), meter = document.querySelector('#player-tetrion .qp-garbage-meter')!.getBoundingClientRect(); return { stats: stats.right, meter: meter.left }; });
  expect(boxes.stats).toBeLessThan(boxes.meter);
  await page.screenshot({ path: 'TEMP/Q1-solo-replay-browser.png', fullPage: true });
  await page.click('#player-revive'); await expect(page).toHaveURL(/#revive$/); await expect(page.locator('#revive-status')).toContainText('Recording situation loaded');
  expect(await page.evaluate(() => (window as any).__qpGame().qp.sides.length)).toBe(2);
  await expect(page.locator('#qp-task-title')).toHaveText('Your revive tasks', { timeout: 5000 });
  const loaded = await page.evaluate(() => (window as any).__qpGame().qp.sides[0].garbage);
  expect(loaded.pending.length).toBeGreaterThan(0); expect(errors).toEqual([]);
});


test('A player follows Hold O Double coaching with keyboard inputs and continues Rotate 20 without another search', async ({ page }) => {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  settings.quickplay.profile = { mods: ['duo'], allyMods: ['duo'] }; settings.quickplay.pressure.mode = 'none'; settings.quickplay.trigger = 'none'; settings.quickplay.tasks = ['f-odouble-1', 'f-rotate-20']; settings.quickplay.reviveNoGravity = true;
  const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start(); game.qp!.down(1);
  const snapshot = game.engine.snapshot(); snapshot.falling = spawnSnapshot(game.engine, 'i'); snapshot.hold = 'o'; snapshot.holdLocked = false;
  for (let y = 0; y < 2; y++) snapshot.board[y] = snapshot.board[y].map((_, x) => x < 2 ? null : { mino: 'gb' as any, connections: 0 });
  game.engine.fromSnapshot(snapshot);
  await page.route('**/src/main.ts', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__qpGame = () => game; window.__coach = () => pages.revive;' }); });
  await page.addInitScript(({ settings, checkpoint }) => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    localStorage.setItem('tetrio-trainer-revive-preferences-v1', JSON.stringify(settings.quickplay));
    localStorage.setItem('tetrio-trainer-revive-scenes-v1', JSON.stringify([{ id: 'hold-o', name: 'Hold O Double to Rotate 20', checkpoint }]));
    const NativeWorker = window.Worker; (window as any).__searches = 0;
    window.Worker = class extends NativeWorker { postMessage(data: any, options?: any) { if (data.budget) (window as any).__searches++; super.postMessage(data, options); } };
  }, { settings, checkpoint: game.qp!.checkpoint() });
  await page.setViewportSize({ width: 1536, height: 864 }); await page.goto('/#revive');
  await page.locator('#revive-options details').first().evaluate(node => (node as HTMLDetailsElement).open = true); await page.click('#revive-open');
  await expect(page.locator('#revive-no-gravity')).toBeChecked(); await expect(page.locator('#revive-search-status')).toContainText('Completion route found');
  await expect(page.locator('#revive-piece')).toHaveText('Hold first: I to O');
  const searches = await page.evaluate(() => (window as any).__searches);
  const operation = await page.evaluate(() => structuredClone((window as any).__coach().liveOperation));
  expect(operation.actions.some((action: any) => action.down && action.key === 'hold')).toBe(true);
  let at = 0;
  for (const action of operation.actions) {
    if (action.at > at) await page.waitForTimeout((action.at - at) * 1000 / 60 + 5);
    const code = settings.bindings[action.key as keyof typeof settings.bindings], key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    if (action.down) await page.keyboard.down(key); else await page.keyboard.up(key); at = action.at;
  }
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[0].task.active)).toBe(1);
  await expect(page.locator('#revive-search-status')).toContainText('Following the calculated route');
  expect(await page.evaluate(() => (window as any).__searches)).toBe(searches);
  await expect(page.locator('#revive-next-step')).toContainText('Rotate');
  for (const size of [{ width: 1536, height: 864 }, { width: 1280, height: 720 }, { width: 2048, height: 1280 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(100);
    const bounds = await page.locator('#revive-demo-board').evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(size.width); expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(size.height);
  }
  await page.screenshot({ path: 'TEMP/Q1-revive-continuation-browser.png', fullPage: true });
  for (let i = 0; i < 20; i++) { await page.keyboard.press('ArrowUp', { delay: 22 }); await page.waitForTimeout(20); }
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[0].revives)).toBe(1);
  expect(await page.evaluate(() => (window as any).__searches)).toBe(searches);
  await expect(page.locator('#revive-detail')).toBeHidden();
});


for (const scenario of [{ task: 'e-tspinsingle-1', scene: 'tss' }, { task: 'c-holddas-6', scene: null }]) test(`Keyboard coaching executes ${scenario.task} with gravity and cached steps`, async ({ page }) => {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  settings.quickplay.profile = { mods: ['duo'], allyMods: ['duo'] }; settings.quickplay.pressure.mode = 'none'; settings.quickplay.trigger = 'none'; settings.quickplay.tasks = [scenario.task];
  const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start(); game.qp!.down(1);
  if (scenario.scene) {
    for (const [y, row] of ['_XXX_XXXXX', 'XXX___XXXX', '__XX______'].entries()) game.engine.board.state[y] = [...row].map(tile => tile === 'X' ? { mino: 'gb', connections: 0 } : null);
    game.engine.initiatePiece('t');
  }
  await page.route('**/src/main.ts', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__qpGame = () => game; window.__coach = () => pages.revive;' }); });
  await page.addInitScript(({ settings, checkpoint }) => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    localStorage.setItem('tetrio-trainer-revive-preferences-v1', JSON.stringify(settings.quickplay));
    localStorage.setItem('tetrio-trainer-revive-scenes-v1', JSON.stringify([{ id: 'task', name: 'Keyboard scenario', checkpoint }]));
    const NativeWorker = window.Worker; (window as any).__searches = 0;
    window.Worker = class extends NativeWorker { postMessage(data: any, options?: any) { if (data.budget) (window as any).__searches++; super.postMessage(data, options); } };
  }, { settings, checkpoint: game.qp!.checkpoint() });
  await page.setViewportSize({ width: 2048, height: 1280 }); await page.goto('/#revive');
  await page.locator('#revive-options details').first().evaluate(node => (node as HTMLDetailsElement).open = true); await page.click('#revive-open');
  await expect(page.locator('#revive-search-status')).toContainText('Completion route found', { timeout: 7000 });
  const searches = await page.evaluate(() => (window as any).__searches), held = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const state = await page.evaluate(() => { const qp = (window as any).__qpGame().qp, coach = (window as any).__coach(); return { done: qp.sides[0].task?.finishedAt !== null || qp.sides[0].revives > 0, pieces: qp.sides[0].engine.stats.pieces, operation: structuredClone(coach.liveOperation) }; });
    if (state.done) break; expect(state.operation).toBeTruthy();
    let at = 0;
    for (const action of state.operation.actions) {
      if (action.at > at) await page.waitForTimeout((action.at - at) * 1000 / 60 + 5);
      const code = settings.bindings[action.key as keyof typeof settings.bindings], key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
      if (action.down) { await page.keyboard.down(key); held.add(key); } else { await page.keyboard.up(key); held.delete(key); } at = action.at;
    }
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => (window as any).__searches)).toBe(searches);
  }
  for (const key of held) await page.keyboard.up(key);
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[0].revives)).toBe(1);
  expect(await page.evaluate(() => (window as any).__searches)).toBe(searches);
});

for (const task of ['f-combo-3', 'e-combo-5', 'a-combo-7', 'd-combonohold-3']) test(`Revive Combo coaching completes ${task} through uninterrupted keyboard clears without replanning`, async ({ page }) => {
  test.setTimeout(120000);
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  settings.quickplay.profile = { mods: ['duo'], allyMods: ['duo'] }; settings.quickplay.pressure.mode = 'none'; settings.quickplay.trigger = 'none'; settings.quickplay.tasks = [task]; settings.quickplay.reviveNoGravity = task !== 'f-combo-3';
  const game = new TrainerGame(settings, 1234, undefined, 'zenith'); game.start(); game.qp!.down(1);
  await page.route('**/src/main.ts', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__qpGame = () => game; window.__coach = () => pages.revive;' }); });
  await page.addInitScript(({ settings, checkpoint }) => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    localStorage.setItem('tetrio-trainer-revive-preferences-v1', JSON.stringify(settings.quickplay));
    localStorage.setItem('tetrio-trainer-revive-scenes-v1', JSON.stringify([{ id: 'combo', name: 'Uninterrupted Combo', checkpoint }]));
    const NativeWorker = window.Worker; (window as any).__searches = 0;
    window.Worker = class extends NativeWorker { postMessage(data: any, options?: any) { if (data.budget) (window as any).__searches++; super.postMessage(data, options); } };
  }, { settings, checkpoint: game.qp!.checkpoint() });
  await page.setViewportSize({ width: 2560, height: 1600 }); await page.goto('/#revive');
  await page.locator('#revive-options details').first().evaluate(node => (node as HTMLDetailsElement).open = true); await page.click('#revive-open');
  await expect(page.locator('#revive-search-status')).toContainText('Completion route found', { timeout: 10000 });
  const searches = await page.evaluate(() => (window as any).__searches);
  let started = false, previousCombo = -1, clears = 0;
  for (let i = 0; i < 60; i++) {
    const before = await page.evaluate(() => { const side = (window as any).__qpGame().qp.sides[0]; return { done: side.task?.finishedAt !== null || side.revives > 0, lines: side.engine.stats.lines, pieces: side.engine.stats.pieces, operation: structuredClone((window as any).__coach().liveOperation) }; });
    if (before.done) break; expect(before.operation).toBeTruthy();
    let at = 0;
    for (const action of before.operation.actions) {
      if (action.at > at) await page.waitForTimeout((action.at - at) * 1000 / 60 + 5);
      const code = settings.bindings[action.key as keyof typeof settings.bindings], key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
      if (action.down) await page.keyboard.down(key); else await page.keyboard.up(key); at = action.at;
    }
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => { const side = (window as any).__qpGame().qp.sides[0]; return { lines: side.engine.stats.lines, pieces: side.engine.stats.pieces, combo: side.engine.stats.combo, resets: side.task?.resets ?? 0, searches: (window as any).__searches }; });
    expect(after.pieces).toBe(before.pieces + 1); expect(after.searches).toBe(searches); expect(after.resets).toBe(0);
    if (started) expect(after.lines).toBeGreaterThan(before.lines);
    if (after.lines > before.lines) { expect(after.combo).toBe(previousCombo + 1); previousCombo = after.combo; clears++; started = true; }
  }
  expect(clears).toBe(Number(task.split('-').at(-1)) + 1);
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[0].revives)).toBe(1);
  expect(await page.evaluate(() => (window as any).__searches)).toBe(searches);
});
