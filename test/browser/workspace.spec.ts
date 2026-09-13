import { test, expect } from '@playwright/test';
import { defaults } from '../../src/settings';
import { TrainerGame } from '../../src/game';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), { ...defaults, training: { ...defaults.training, countdownSeconds: 0, justThink: true } });
});

test('the shared workspace keeps controls above the board and file tools pause and resume safely', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#start').click();
  const board = (await page.locator('#board').boundingBox())!, left = (await page.locator('.workspace-left').boundingBox())!, right = (await page.locator('#current-guidance').boundingBox())!, toggle = (await page.locator('#think-toggle').boundingBox())!;
  expect(left.x + left.width).toBeLessThan(board.x); expect(right.x).toBeGreaterThan(board.x + board.width); expect(toggle.y + toggle.height).toBeLessThan(board.y);
  await page.locator('#tools-open').click();
  await expect(page.locator('#tools-dialog')).toBeVisible(); await expect(page.locator('#overlay-value')).toHaveText('Paused');
  await expect(page.locator('#download-native')).toBeVisible(); await expect(page.locator('#config-open')).toBeVisible();
  await page.keyboard.press('r'); await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('0');
  await page.keyboard.press('Escape'); await expect(page.locator('#tools-dialog')).toBeHidden(); await expect(page.locator('#board-overlay')).toBeHidden();
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.locator('#pause').click(); await page.locator('#tools-open').click(); await page.locator('#tools-close').click();
  await expect(page.locator('#overlay-value')).toHaveText('Paused'); expect(errors).toEqual([]);
});

test('drill guidance advances on successful placement and restores the current step after animation', async ({ page }) => {
  await page.goto('/#drills');
  for (const input of await page.locator('#drill-form input[type="checkbox"]').all()) {
    const name = await input.getAttribute('name'), value = await input.getAttribute('value');
    await input.setChecked((name === 'pieces' && value === 'o') || (name === 'columns' && value === '4') || (name === 'rotations' && value === '0'));
  }
  await page.locator('#drill-rounds').selectOption('20'); await page.getByRole('button', { name: 'Start finesse drills', exact: true }).click();
  await expect(page.locator('#practice-guide')).toBeVisible(); await expect(page.locator('#practice-guide-title')).toHaveText('Step 1 / 20 · O');
  await expect(page.locator('#mode-select')).toHaveValue('active-session'); await expect(page.locator('#practice-guide-steps')).toContainText('Hard drop');
  await page.locator('#practice-guide-animate').click(); await expect(page.locator('#demo-popup')).toBeVisible(); await expect(page.locator('#practice-guide')).toBeHidden();
  await page.keyboard.press('Space'); await expect(page.locator('#practice-guide-title')).toHaveText('Step 2 / 20 · O');
  await expect(page.locator('#practice-guide')).toBeVisible(); await expect(page.locator('#demo-popup')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('replays preserve the center board with file selection on the left and session details on the right', async ({ page }) => {
  const game = new TrainerGame({ ...defaults, training: { ...defaults.training, countdownSeconds: 0 } }, 17); game.start(); game.input.press('hardDrop'); game.step(); game.input.release('hardDrop'); game.step();
  await page.goto('/#replays');
  await page.locator('#player-file').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(game.export())) });
  await expect(page.locator('#player-status')).toHaveText('Ready.');
  const board = (await page.locator('#player-board').boundingBox())!, left = (await page.locator('.replay-library').boundingBox())!, right = (await page.locator('.player-controls').boundingBox())!;
  expect(left.x + left.width).toBeLessThan(board.x); expect(right.x).toBeGreaterThan(board.x + board.width);
  await page.locator('#player-play').click(); await expect(page.locator('#player-pieces')).toHaveText('1');
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
