import { test, expect } from '@playwright/test';
import { encoder, Field } from 'tetris-fumen';
import { defaults } from '../../src/settings';

test.use({ viewport: { width: 2560, height: 1600 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    localStorage.setItem('tetrio-trainer-opening-options-v1', JSON.stringify({ finesse: true, continuations: false, continueAfter: true }));
  }, { ...defaults, training: { ...defaults.training, countdownSeconds: 0, justThink: true, strictPractice: true } });
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: `${await response.text()}\nwindow.__currentGame = () => game;` });
  });
});

test('2560 by 1600 uses a large board and readable sidebars with all core controls on screen', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click(); await expect(page.locator('#retry-status')).toBeVisible(); await page.evaluate(() => document.fonts.ready);
  const sizes = await page.evaluate(() => {
    const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, width: r.width, bottom: r.bottom }; };
    return { board: box('#board'), left: box('.workspace-left'), right: box('#current-guidance'), text: parseFloat(getComputedStyle(document.querySelector('#guide-empty p')!).fontSize), width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
  });
  expect(sizes.board.width).toBe(520); expect(sizes.left.width).toBe(660); expect(sizes.right.width).toBe(sizes.left.width); expect(sizes.text).toBeGreaterThanOrEqual(18);
  expect(sizes.left.x).toBe(80); expect(2560 - sizes.right.x - sizes.right.width).toBe(sizes.left.x); expect(sizes.board.x + sizes.board.width / 2).toBe(1280);
  expect(sizes.board.bottom).toBeLessThan(1500); expect(sizes.width).toBe(2560); expect(sizes.height).toBe(1600);
  await page.screenshot({ path: 'TEMP/fullscreen-sprint-final.png', fullPage: true });
});

test('opener guides autoplay, retry the correct target locally and close after success or restart', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fumen = encoder.encode([{ field: Field.create(), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }, { operation: { type: 'O', x: 4, y: 2, rotation: 'spawn' } }]);
  await page.goto('/#openers'); await page.getByText('Import your own Fumen', { exact: true }).click();
  await page.locator('#opener-import-name').fill('Two-step opener'); await page.locator('#opener-fumen').fill(fumen); await page.getByRole('button', { name: 'Validate and save Fumen' }).click();
  await page.locator('#opener-start').click(); await expect(page.locator('#demo-title')).toHaveText('Step 1 · Placement guide');
  await expect(page.locator('#demo-step')).not.toHaveText('Start here'); await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.keyboard.press('Space'); await expect(page.locator('#demo-title')).toHaveText('Step 2 · Placement guide');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'Space']) await page.keyboard.press(key);
  await expect(page.locator('#faults')).toHaveText('1'); await expect(page.locator('#practice-progress')).toHaveText('1 / 2'); await expect(page.locator('#demo-title')).toContainText('Correct placement');
  const retry = await page.evaluate(() => {
    const game = (window as any).__currentGame();
    return { index: game.practice.index, restarts: game.practice.restarts, board: game.engine.board.state.flat().filter(Boolean).length, expected: game.practice.set.scenes[1].target, target: game.demonstration.target, misplaced: game.placements.at(-1).cells };
  });
  expect(retry.index).toBe(1); expect(retry.restarts).toBe(0); expect(retry.board).toBe(4); expect(retry.target).toEqual(retry.expected); expect(retry.target).not.toEqual(retry.misplaced);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(1600);
  await page.screenshot({ path: 'TEMP/fullscreen-opener-retry.png', fullPage: true });
  await page.keyboard.press('Space'); await expect(page.locator('#practice-progress')).toContainText('Continue'); await expect(page.locator('#demo-popup')).toBeHidden();
  await page.keyboard.press('r'); await expect(page.locator('#demo-title')).toHaveText('Step 1 · Placement guide');
  await page.locator('#mode-select').selectOption('sprint'); await page.locator('#start').click();
  for (const key of ['ArrowLeft', 'ArrowRight', 'Space']) await page.keyboard.press(key);
  await expect(page.locator('#demo-popup')).toBeVisible(); await page.keyboard.press('r'); await expect(page.locator('#demo-popup')).toBeHidden();
  expect(errors).toEqual([]);
});

test('long action text uses natural glyph widths and fits outside the board without clipping', async ({ page }) => {
  await page.goto('/'); await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    const path = '/src/action-text.ts', { drawActionText } = await import(path), game = (window as any).__currentGame();
    const action = { frame: 0, clear: 'QUAD', spin: 'T-spin', b2b: 123, combo: 37, pc: false };
    game.actionEffects = Array.from({ length: 3 }, () => ({ ...action }));
    const canvas = document.querySelector<HTMLCanvasElement>('#play-page .action-text-layer')!, ctx = canvas.getContext('2d')!, original = ctx.fillText;
    const calls: { text: string; maxWidth?: number; left: number; right: number }[] = [];
    ctx.fillText = function (value, x, y, maxWidth) {
      const matrix = this.getTransform(), width = this.measureText(value).width * matrix.a, right = matrix.e + x * matrix.a;
      calls.push({ text: value, maxWidth, left: right - width, right }); original.call(this, value, x, y);
    };
    drawActionText(document.querySelector('#board'), game.engine, game.actionEffects.map((action: unknown) => ({ action, age: 350 })));
    ctx.fillText = original;
    return { calls, width: canvas.width, overlay: canvas.getBoundingClientRect().width, tetrion: document.querySelector('.tetrion')!.getBoundingClientRect().width };
  });
  expect(result.calls.map(call => call.text).join(' ').replace(/-\s+/g, '-')).toContain('BACK-TO-BACK ×123');
  expect(result.calls.every(call => call.maxWidth === undefined && call.left >= 0 && call.right <= result.width)).toBe(true);
  expect(result.overlay).toBeGreaterThanOrEqual(result.tetrion);
  await page.waitForTimeout(250); await page.screenshot({ path: 'TEMP/fullscreen-action-text.png', fullPage: true });
});
