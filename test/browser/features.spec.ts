import { test, expect } from '@playwright/test';
import { defaults } from '../../src/settings';
import { TrainerGame } from '../../src/game';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } });
});

test('Just think offers both styles on the page and freezes each new piece by default', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#think-toggle')).not.toBeChecked(); await expect(page.locator('#think-style')).toHaveValue('piece');
  await page.locator('#think-toggle').check(); await page.locator('#start').click();
  await page.screenshot({ path: 'test-results/think-native-materials.png', fullPage: true });
  await page.waitForTimeout(200); await expect(page.locator('#time')).toHaveText('0:00.000');
  await expect(page.locator('#retry-status')).toContainText('Just think');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  const paused = await page.locator('#time').textContent(); await page.waitForTimeout(200); await expect(page.locator('#time')).toHaveText(paused!);
  await page.locator('#think-style').selectOption('input');
  const before = await page.locator('#time').textContent(); await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(100); await page.keyboard.up('ArrowLeft');
  await expect(page.locator('#time')).not.toHaveText(before!); await page.waitForTimeout(50);
  const after = await page.locator('#time').textContent(); await page.waitForTimeout(150); await expect(page.locator('#time')).toHaveText(after!);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tetrio-trainer-settings-v1')!)); expect(stored.training.justThink).toBe(true); expect(stored.training.thinkStyle).toBe('input');
});

test('standalone filtered drills reset the board, keep counting and can be ended', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#drills'); await expect(page.locator('#drills-page')).toBeVisible();
  await page.screenshot({ path: 'test-results/pure-drills.png', fullPage: true });
  for (const name of ['pieces', 'columns', 'rotations']) {
    const keep = name === 'pieces' ? 'o' : name === 'columns' ? '4' : '0';
    for (const input of await page.locator(`#drill-form input[name="${name}"]`).all()) if (await input.getAttribute('value') !== keep) await input.uncheck();
  }
  await page.getByRole('button', { name: 'Start finesse drills', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('PURE FINESSE DRILLS');
  for (let i = 1; i <= 3; i++) { await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText(String(i)); }
  await expect(page.locator('#practice-progress')).toHaveText('3 completed · Endless');
  await page.locator('#finish-session').click(); await expect(page.locator('#overlay-value')).toHaveText('Practice complete');
  await page.getByRole('link', { name: 'Statistics', exact: true }).click(); await expect(page.locator('#session-rows tr')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('history ranks repeated faults, launches focused practice, and saved replays seek and play', async ({ page }) => {
  await page.addInitScript(() => { const key = 'tetrio-trainer-settings-v1', settings = JSON.parse(localStorage.getItem(key)!); settings.training.practiceFinesseEnabled = false; localStorage.setItem(key, JSON.stringify(settings)); });
  await page.goto('/'); await page.locator('#start').click();
  for (let i = 0; i < 2; i++) {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Space']) { await page.keyboard.press(key); await page.waitForTimeout(25); }
  }
  await page.getByRole('link', { name: 'Statistics', exact: true }).click();
  await expect(page.locator('#fault-rows input')).toHaveCount(1); await expect(page.locator('#fault-rows tr td').nth(3)).toHaveText('2');
  await page.screenshot({ path: 'test-results/fault-statistics.png', fullPage: true });
  await page.locator('#fault-top').click(); await expect(page.locator('#fault-selection')).toHaveText('1 selected');
  await page.locator('#train-faults').click(); await expect(page.locator('#mode-label')).toHaveText('FOCUSED FAULT DRILLS');
  await expect(page.locator('#finesse-toggle')).toBeChecked();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#faults')).toHaveText('1'); await expect(page.locator('#pieces')).toHaveText('0');
  await expect(page.locator('#time')).toHaveText('0:00.000'); await expect(page.locator('#demo-popup')).toBeVisible();
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.getByRole('link', { name: 'Statistics', exact: true }).click(); await expect(page.locator('#session-rows tr')).toHaveCount(2);
  await page.locator('#session-rows').getByRole('button', { name: 'Watch', exact: true }).last().click();
  await expect(page.locator('#player-status')).toHaveText('Ready.'); await expect(page.locator('#player-content')).toBeVisible();
  await page.screenshot({ path: 'test-results/replay-player.png', fullPage: true });
  await page.locator('#player-play').click(); await expect(page.locator('#player-time')).not.toHaveText(/^0:00.000 \/ /);
  await page.locator('#player-seek').fill('0'); await expect(page.locator('#player-time')).toHaveText(/^0:00.000 \/ /);
  await page.locator('#player-forward').click(); await expect(page.locator('#player-time')).toHaveText(/^0:00.017 \/ /);
});

test('native replay export downloads a real event envelope after verification', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click(); await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  const pending = page.waitForEvent('download'); await page.locator('#download-native').click(); const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.ttr$/); await expect(page.locator('#message')).toContainText('verified locally');
});

test('left-clicking a manually paused board resumes without placing a piece', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click(); await page.locator('#pause').click();
  await expect(page.locator('#overlay-value')).toHaveText('Paused'); const time = await page.locator('#time').textContent();
  await page.locator('#board').click({ button: 'right' }); await expect(page.locator('#overlay-value')).toHaveText('Paused');
  await expect(page.locator('#time')).toHaveText(time!);
  await page.locator('#board').click(); await expect(page.locator('#board-overlay')).toBeHidden();
  await expect(page.locator('#time')).not.toHaveText(time!); await expect(page.locator('#pieces')).toHaveText('0');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#retry-status')).toBeVisible();
  await page.locator('#pause').click(); await page.locator('#board').click();
  await expect(page.locator('#retry-status')).toBeVisible(); await expect(page.locator('#time')).toHaveText('0:00.000');
});

test('history imports are atomic and repeated imports keep one session per ID', async ({ page }) => {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  const game = new TrainerGame(settings, 17); game.start(); game.input.press('hardDrop'); game.step();
  const replay = game.export();
  await page.goto('/#statistics');
  const upload = (replays: unknown[]) => page.locator('#history-file').setInputFiles({ name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'tetrio-trainer-history', version: 1, replays })) });
  await upload([replay, { ...replay, startedAt: null }]); await expect(page.locator('#statistics-status')).toHaveText('Invalid session recording.');
  await page.locator('#stats-refresh').click(); await expect(page.locator('#session-rows tr')).toHaveCount(0);
  await upload([replay]); await expect(page.locator('#session-rows tr')).toHaveCount(1);
  await upload([replay]); await expect(page.locator('#statistics-status')).toContainText('without duplication'); await expect(page.locator('#session-rows tr')).toHaveCount(1);
  const backup = page.waitForEvent('download'); await page.locator('#history-export').click(); expect((await backup).suggestedFilename()).toMatch(/trainer-history-/);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#session-rows').getByRole('button', { name: 'Delete', exact: true }).click(); await expect(page.locator('#session-rows tr')).toHaveCount(0);
});
