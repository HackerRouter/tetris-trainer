import { test, expect, chromium, type Page } from '@playwright/test';
import { defaults } from '../../src/settings';
import { reviveCatalog } from '../../src/revive-tasks';

async function prepare(page: Page) {
  await page.route('**/src/main.ts', async route => { const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__qpGame = () => game;' }); });
  await page.addInitScript(settings => { if (!localStorage.getItem('tetrio-trainer-settings-v1')) localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)); }, { ...defaults, training: { ...defaults.training, countdownSeconds: 0, finesseEnabled: true, undoEnabled: true } });
  await page.goto('/#quickplay');
}

test('All-Spin, Invisible and Freefall use their rules while player data stays below Hold', async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1280 }); await prepare(page);
  await page.selectOption('#qp-pressure', 'none');
  await page.locator('#qp-player-mods').evaluate(el => (el.closest('details') as HTMLDetailsElement).open = true);
  for (const mod of ['allspin', 'invisible']) await page.locator(`#qp-player-mods input[value="${mod}"]`).check();
  await page.click('#qp-form button[type="submit"]');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const game = (window as any).__qpGame(), engine = game.engine;
      engine.board.state[0] = Array.from({ length: 10 }, (_, x) => x >= 3 && x <= 6 ? null : { mino: 'j', connections: 0 }); engine.initiatePiece('i');
    });
    await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText(String(i + 1));
  }
  expect(await page.evaluate(() => (window as any).__qpGame().qp.sides[0].modState.wounds.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__qpGame().qp.events.some((event: any) => event.type === 'sound' && event.data.name === 'wound'))).toBe(true);
  await page.screenshot({ path: 'TEMP/Q1-allspin-invisible-browser.png', fullPage: true });
  for (const mod of ['allspin', 'invisible']) await page.locator(`#qp-player-mods input[value="${mod}"]`).uncheck();
  await page.locator('#qp-player-mods input[value="gravity_reversed"]').check(); await page.click('#qp-form button[type="submit"]');
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().engine.dynamic.gravity.get())).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#pause')).toBeHidden();
  const positions = await page.evaluate(() => {
    const stats = document.querySelector('.board-stats')!.getBoundingClientRect(), board = document.querySelector('#board')!.getBoundingClientRect();
    return { gap: board.x - stats.right, bottom: board.bottom - stats.bottom };
  });
  expect(positions.gap).toBeGreaterThan(0); expect(Math.abs(positions.bottom)).toBeLessThan(2);
});

test('Chrome keeps QP boards, data, native previews and revive cards separate at windowed and fullscreen sizes', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ baseURL: 'http://127.0.0.1:5179', viewport: { width: 2048, height: 1060 }, deviceScaleFactor: 1.25 });
    await prepare(page); await page.selectOption('#qp-party', 'duo'); await page.selectOption('#qp-pressure', 'none'); await page.click('#qp-form button[type="submit"]');
    await page.evaluate(() => { const qp = (window as any).__qpGame().qp; qp.settings.quickplay.tasks = ['f-rotate-20', 'f-rotate-20', 'f-rotate-20']; });
    for (const [width, height] of [[2048, 1060], [2048, 1280], [2560, 1342], [2560, 1600], [1536, 864], [1280, 800]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(120);
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        return { player: box('#board'), bot: box('#qp-bot-board'), stats: box('.board-stats'), time: box('#time'), meter: box('.qp-garbage-meter'), hold: box('#qp-bot-hold-panel'), next: box('#next-panel'), left: box('.workspace-left'), right: box('#qp-guide'), pageWidth: document.documentElement.scrollWidth };
      });
      expect(boxes.player.width, `${width} x ${height}`).toBeGreaterThan(width >= 2000 ? 300 : 190);
      expect(Math.abs(boxes.player.width - boxes.bot.width)).toBeLessThan(2); expect(Math.abs(boxes.left.width - boxes.right.width)).toBeLessThan(2);
      expect(boxes.stats.right).toBeLessThan(boxes.meter.x); expect(boxes.time.right).toBeLessThan(boxes.meter.x); expect(boxes.time.bottom).toBeLessThanOrEqual(boxes.player.bottom + 1);
      expect(Math.abs(boxes.hold.x - boxes.next.x)).toBeLessThan(2); expect(boxes.hold.y).toBeGreaterThan(boxes.next.bottom); expect(boxes.hold.right).toBeLessThan(boxes.bot.x);
      expect(boxes.player.bottom).toBeLessThan(height - 55); expect(boxes.pageWidth).toBeLessThanOrEqual(width);
      await expect(page.locator('#qp-bot-next-frame').locator('..')).toHaveClass(/native-frame/); await expect(page.locator('#qp-bot-hold-panel')).toHaveClass(/native-frame/);
      await expect(page.locator('#message')).toBeHidden(); await expect(page.locator('#controls-summary')).toBeHidden();
      if (width === 2048) await page.screenshot({ path: `TEMP/Q1-chrome-${width}-${height}.png`, fullPage: true });
    }
    await page.locator('#qp-player-mods').evaluate(el => (el.closest('details') as HTMLDetailsElement).open = true);
    await page.locator('#qp-player-mods').locator('input[value="nohold"]').check(); await page.locator('#qp-ally-mods').locator('input[value="nohold"]').check(); await page.click('#qp-form button[type="submit"]');
    await expect(page.locator('#hold-panel')).toBeHidden(); await expect(page.locator('#qp-bot-hold-panel')).toBeHidden();
    const noHold = await page.evaluate(() => ({ stats: document.querySelector('.board-stats')!.getBoundingClientRect().bottom, board: document.querySelector('#board')!.getBoundingClientRect().bottom, nextHeight: document.querySelector('#qp-bot-next')!.getBoundingClientRect().height }));
    expect(Math.abs(noHold.stats - noHold.board)).toBeLessThan(2); expect(noHold.nextHeight).toBeGreaterThan(50);
    await page.locator('.page-nav a[href="#play"]').click(); await expect(page.locator('#message')).toBeHidden(); await expect(page.locator('#controls-summary')).toBeHidden();
  } finally { await browser.close(); }
});

test('Quick Play has a dedicated symmetric page and never retries or rewinds a placement', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 2560, height: 1600 }); await prepare(page);
  await expect(page.locator('.page-nav a[href="#quickplay"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#qp-options')).toBeVisible(); await expect(page.locator('#current-guidance')).toBeHidden();
  await expect(page.locator('#finesse-toggle')).toBeHidden(); await expect(page.locator('#undo')).toBeHidden(); await expect(page.locator('#redo')).toBeHidden();
  const sizes = await page.evaluate(() => ['.workspace-left', '#board', '#qp-guide'].map(selector => document.querySelector(selector)!.getBoundingClientRect().width));
  expect(Math.abs(sizes[0] - sizes[2])).toBeLessThan(2); expect(sizes[1]).toBeGreaterThan(400);
  await page.selectOption('#qp-pressure', 'none'); await page.click('#qp-form button[type="submit"]');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+y');
  await expect(page.locator('#pieces')).toHaveText('1'); await expect(page.locator('#demo-popup')).toBeHidden();
  await expect(page.locator('#pause')).toBeHidden(); await expect(page.locator('#think-toggle')).toBeHidden();
  const time = await page.locator('#time').textContent(); await page.keyboard.press('Escape'); await page.waitForTimeout(120); await expect(page.locator('#time')).not.toHaveText(time!);
  await page.screenshot({ path: 'TEMP/Q1-solo-browser.png', fullPage: true });
  await page.locator('.page-nav a[href="#play"]').click(); await expect(page.locator('#finesse-toggle')).toBeVisible(); await expect(page.locator('#undo')).toBeVisible();
  const backgroundFrame = await page.evaluate(() => (window as any).__qpGame().engine.frame); await page.waitForTimeout(250);
  await page.locator('.page-nav a[href="#quickplay"]').click(); await expect(page.locator('#pieces')).toHaveText('1');
  expect(await page.evaluate(() => (window as any).__qpGame().status)).toBe('playing');
  expect(await page.evaluate(() => (window as any).__qpGame().qp.frame)).toBeGreaterThan(backgroundFrame + 10);
  expect(errors).toEqual([]);
});

test('Duo runs a legal-input bot, both rescue directions and a repeated revive run', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 2560, height: 1600 }); await prepare(page);
  await page.selectOption('#qp-party', 'duo'); await page.selectOption('#qp-pressure', 'none'); await page.selectOption('#qp-task', 'f-rotate-20');
  await page.click('#qp-form button[type="submit"]');
  await expect(page.locator('#qp-partner')).toBeVisible();
  const boxes = await page.evaluate(() => ['.workspace-left', '#board', '#qp-bot-board', '#qp-guide'].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, width: r.width }; }));
  expect(Math.abs(boxes[0].width - boxes[3].width)).toBeLessThan(2); expect(boxes[1].width).toBeGreaterThan(400); expect(boxes[2].width).toBeGreaterThan(400); expect(boxes[1].x).toBeLessThan(boxes[2].x);
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[1].engine.stats.pieces)).toBeGreaterThan(0);
  await page.click('#qp-down-player'); await expect(page.locator('#qp-task-title')).toHaveText('Teammate revive tasks');
  await expect(page.locator('#board').locator('..').locator('.qp-chains')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[1].revives)).toBe(1);
  await expect(page.locator('#qp-down-bot')).toBeEnabled(); await page.click('#qp-down-bot');
  await expect(page.locator('#qp-task-title')).toHaveText('Your revive tasks', { timeout: 15000 });
  for (let i = 0; i < 20; i++) { await page.keyboard.press('ArrowUp', { delay: 20 }); await page.waitForTimeout(20); }
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[0].revives)).toBe(1);
  await expect(page.locator('#qp-down-player')).toBeEnabled(); await page.click('#qp-down-player');
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[1].revives)).toBe(2);
  await page.screenshot({ path: 'TEMP/Q1-duo-browser.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('QP garbage meter, actual audio output and focus changes follow the live simulation', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });
  await page.addInitScript(() => {
    (window as any).__sounds = []; const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) { (window as any).__sounds.push(offset); start.call(this, when, offset, duration); };
  });
  await prepare(page); await expect(page.locator('#audio-status')).toContainText('ready');
  const replay = { replay: { frames: 1000, options: { zenith: true, version: 19 }, events: [{ frame: 0, type: 'ige', data: { type: 'interaction', data: { type: 'garbage', amt: 12, zthalt: 0, gameid: 3, size: 1 } } }] } };
  await page.setInputFiles('#qp-file', { name: 'burst.ttr', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replay)) });
  await page.click('#qp-form button[type="submit"]'); await expect(page.locator('.qp-windup').first()).toContainText('!!! WIND-UP');
  await expect(page.locator('.qp-garbage-caution').first()).toBeVisible();
  await expect(page.locator('.qp-garbage-meter').first()).toHaveAttribute('aria-label', /queued/);
  const frame = await page.evaluate(() => { const frame = (window as any).__qpGame().qp.frame; window.dispatchEvent(new Event('blur')); return frame; });
  await page.waitForTimeout(200); expect(await page.evaluate(() => (window as any).__qpGame().qp.frame)).toBeGreaterThan(frame + 5);
  await page.click('#tools-open'); const menuFrame = await page.evaluate(() => (window as any).__qpGame().qp.frame);
  await page.waitForTimeout(200); expect(await page.evaluate(() => (window as any).__qpGame().qp.frame)).toBeGreaterThan(menuFrame + 5); await page.click('#tools-close');
  const sprites = await page.evaluate(async () => (await (await fetch('/tetrio/sound-pack.json')).json()).sprites);
  await expect.poll(() => page.evaluate(() => (window as any).__sounds)).toContain(sprites.garbagewindup_3.offset);
  await expect.poll(() => page.evaluate(() => (window as any).__sounds)).toContain(sprites.garbage_in_medium.offset);
  await page.screenshot({ path: 'TEMP/Q1-garbage-meter-browser.png', fullPage: true });
});

test('pressure import identifies native Zenith input events and persists Quick Play settings', async ({ page }) => {
  await prepare(page);
  const replay = { replay: { frames: 300, options: { zenith: true, version: 19, zenith_mods: [] }, events: [{ frame: 0, type: 'ige', data: { type: 'interaction', data: { type: 'garbage', amt: 4, zthalt: 0, gameid: 3, size: 1 } } }] } };
  await page.setInputFiles('#qp-file', { name: 'pressure.ttr', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replay)) });
  await expect(page.locator('#qp-tape')).toContainText('1 incoming packets'); await expect(page.locator('#qp-pressure')).toHaveValue('replay');
  await page.fill('#qp-strength', '.5'); await page.click('#qp-form button[type="submit"]');
  await expect(page.locator('#qp-live')).toContainText('Pending 2');
  await page.reload(); await expect(page.locator('#qp-pressure')).toHaveValue('replay'); await expect(page.locator('#qp-strength')).toHaveValue('0.5');
});

test('Duo worker prioritizes an O Double rescue and leaves the live animation responsive', async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1060 }); await prepare(page);
  await page.selectOption('#qp-party', 'duo'); await page.selectOption('#qp-pressure', 'none'); await page.selectOption('#qp-task', reviveCatalog.find(task => task.predicate === 'odouble')!.id);
  await page.click('#qp-form button[type="submit"]');
  await page.evaluate(async () => {
    const qp = (window as any).__qpGame().qp, side = qp.sides[1], snapshot = side.engine.snapshot();
    const { spawnSnapshot } = await import('/src/engine.ts');
    snapshot.falling = spawnSnapshot(side.engine, 'i'); snapshot.hold = 'o'; snapshot.holdLocked = false;
    for (let y = 0; y < 2; y++) snapshot.board[y] = snapshot.board[y].map((_: unknown, x: number) => x < 2 ? null : { mino: 'gb', connections: 0 });
    side.engine.fromSnapshot(snapshot); qp.down(0);
    (window as any).__qpFrames = []; let last = performance.now();
    const sample = (now: number) => { (window as any).__qpFrames.push(now - last); last = now; if ((window as any).__qpFrames.length < 120) requestAnimationFrame(sample); }; requestAnimationFrame(sample);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[1].revives), { timeout: 15000 }).toBe(1);
  const result = await page.evaluate(() => { const qp = (window as any).__qpGame().qp; return { completed: qp.completed[0].tasks.prompts, inputs: qp.events.filter((event: any) => event.type === 'inputs').flatMap((event: any) => event.data), errors: qp.events.filter((event: any) => event.type === 'bot-error'), worker: typeof qp.botPlanner === 'function' }; });
  expect(result.worker).toBe(true); expect(result.errors).toEqual([]); expect(result.completed[0].complete).toBe(true); expect(result.inputs.some((event: any) => event.data.key === 'hold')).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__qpFrames.length)).toBeGreaterThan(60);
  const timings = await page.evaluate(() => (window as any).__qpFrames.slice(5).sort((a: number, b: number) => a - b));
  expect(timings[Math.floor(timings.length * .95)]).toBeLessThan(60);
});


test('QP random pool, straight-up six PPS rescue preparation and Stop work through the visible UI', async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1280 }); await prepare(page);
  await page.selectOption('#qp-party', 'duo'); await page.selectOption('#qp-pressure', 'none'); await page.selectOption('#qp-task-mode', 'random');
  for (const id of ['f-rotate-20', 'e-spin-1']) await page.locator(`#qp-task-pool input[value="${id}"]`).check();
  await page.fill('#qp-task-count', '1'); await page.click('#qp-form button[type="submit"]'); await page.click('#qp-down-bot');
  await expect(page.locator('#qp-life')).toContainText('stacking straight up');
  await expect(page.locator('#qp-bot-state')).toContainText('6 PPS');
  await expect.poll(() => page.evaluate(() => (window as any).__qpGame().qp.sides[1].life), { timeout: 5000 }).toBe('down');
  const evidence = await page.evaluate(() => {
    const qp = (window as any).__qpGame().qp, begin = qp.events.find((event: any) => event.type === 'practice-topout').frame;
    return { task: qp.sides[0].task.prompts[0].task, keys: qp.events.filter((event: any) => event.type === 'inputs' && event.frame >= begin).flatMap((event: any) => event.data.map((input: any) => input.data.key)), locks: qp.events.filter((event: any) => event.type === 'lock' && event.side === 1 && event.frame >= begin).map((event: any) => event.frame) };
  });
  expect(['f-rotate-20', 'e-spin-1']).toContain(evidence.task); expect(evidence.keys.every((key: string) => key === 'hardDrop')).toBe(true);
  expect(evidence.locks.length).toBeGreaterThan(5); expect(evidence.locks[2] - evidence.locks[1]).toBe(10);
  await page.click('#qp-stop'); await expect(page.locator('#overlay-value')).toHaveText('Run stopped');
  const frame = await page.evaluate(() => (window as any).__qpGame().qp.frame); await page.waitForTimeout(250); expect(await page.evaluate(() => (window as any).__qpGame().qp.frame)).toBe(frame);
  await page.reload(); await expect(page.locator('#qp-task-mode')).toHaveValue('random'); await expect(page.locator('#qp-task-pool input:checked')).toHaveCount(2);
});
