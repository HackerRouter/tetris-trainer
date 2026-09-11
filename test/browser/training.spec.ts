import { test, expect } from '@playwright/test';
import { defaults, type Settings } from '../../src/settings';
import { TrainerGame } from '../../src/game';

const instant = (training: Partial<Settings['training']> = {}) => ({ ...structuredClone(defaults), training: { ...defaults.training, countdownSeconds: 0, ...training } });
function twoFaults() {
  const game = new TrainerGame(instant(), 942562); game.start();
  for (const key of ['moveLeft', 'moveRight', 'hardDrop', 'hardDrop', 'moveLeft', 'moveRight', 'hardDrop'] as const) {
    game.input.press(key); game.step(); game.input.release(key);
  }
  return game.export();
}

test('TETR.IO module positions, default countdown, pause and timer formatting', async ({ page }) => {
  await page.goto('/');
  const board = await page.locator('#board').boundingBox(), hold = await page.locator('#hold-panel').boundingBox(), next = await page.locator('#next-panel').boundingBox();
  expect(hold!.x + hold!.width).toBeLessThanOrEqual(board!.x + 2);
  expect(next!.x).toBeGreaterThanOrEqual(board!.x + board!.width);
  expect(Math.abs(hold!.y - (board!.y + board!.width * .3))).toBeLessThan(3);
  expect(Math.abs(hold!.y - next!.y)).toBeLessThan(3);
  await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.locator('#start').click();
  await expect(page.locator('#overlay-value')).toHaveText('3');
  await page.keyboard.press('Space'); await page.waitForTimeout(100);
  await expect(page.locator('#inputs')).toHaveText('0');
  await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.locator('#settings-open').click();
  await expect(page.locator('#countdownSeconds')).toHaveValue('3');
  await expect(page.locator('#allowDifferentTarget')).toBeChecked();
  await expect(page.locator('#undoEnabled')).not.toBeChecked();
  await page.waitForTimeout(200); await page.locator('#cancel-settings').click();
  await expect(page.locator('#board-overlay')).not.toBeVisible({ timeout: 4000 });
  await page.keyboard.press('c'); await expect(page.locator('#holds')).toHaveText('1'); await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/tetrion-layout.png', fullPage: true });
  await page.keyboard.press('r');
  await expect(page.locator('#overlay-value')).toHaveText('3');
  await expect(page.locator('#time')).toHaveText('0:00.000');
});

test('training switches and fractional countdown persist through settings import and export', async ({ page }) => {
  await page.goto('/'); await page.locator('#finesse-toggle').uncheck(); await page.locator('#settings-open').click();
  await page.locator('#countdownSeconds').fill('.5');
  await page.locator('#allowDifferentTarget').uncheck();
  await page.locator('#undoEnabled').check(); await page.locator('#infiniteHold').check(); await page.locator('#strictPractice').check();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.reload(); await expect(page.locator('#finesse-toggle')).not.toBeChecked(); await page.locator('#settings-open').click();
  await expect(page.locator('#countdownSeconds')).toHaveValue('0.5');
  await expect(page.locator('#strictPractice')).toBeChecked();
  await expect(page.locator('#infiniteHold')).toBeChecked();
  await page.locator('#cancel-settings').click(); await page.locator('#start').click();
  await expect(page.locator('#overlay-value')).toHaveText('1');
  await expect(page.locator('#board-overlay')).not.toBeVisible();
  await page.keyboard.press('c'); await page.waitForTimeout(25); await page.keyboard.press('c');
  await expect(page.locator('#holds')).toHaveText('2');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1'); await expect(page.locator('#faults')).toHaveText('0');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#pieces')).toHaveText('0');
});

test('fault timer rewinds and a locked target rejects a different placement', async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), instant({ allowDifferentTarget: false }));
  await page.goto('/'); await page.locator('#start').click();
  await page.waitForTimeout(1100);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#faults')).toHaveText('1');
  await expect(page.locator('#time')).toHaveText(/^0:00\./);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space');
  await expect(page.locator('#coach-title')).toHaveText('Match the outlined target');
  await expect(page.locator('#pieces')).toHaveText('0');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
});

test('retry and undo wait for a fresh game key while guide playback, releases and settings leave timing paused', async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), instant({ undoEnabled: true }));
  await page.goto('/'); await page.locator('#start').click();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.down('Space');
  await expect(page.locator('#faults')).toHaveText('1'); await expect(page.locator('#retry-status')).toBeVisible();
  await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.waitForTimeout(300); await page.keyboard.up('Space'); await page.keyboard.press('q');
  await expect(page.locator('#demo-step')).toContainText('Complete'); await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.locator('#demo-replay').click(); await expect(page.locator('#demo-step')).toHaveText('Start here');
  await expect(page.locator('#demo-step')).toContainText('Complete'); await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.locator('#settings-open').click(); await page.locator('#cancel-settings').click();
  await expect(page.locator('#retry-status')).toBeVisible(); await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('#retry-status')).not.toBeVisible();
  await expect(page.locator('#inputs')).toHaveText('4'); await expect(page.locator('#time')).not.toHaveText('0:00.000');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.keyboard.press('Control+z'); await expect(page.locator('#retry-status')).toBeVisible();
  await page.waitForTimeout(300); await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await expect(page.locator('#retry-status')).not.toBeVisible();
});

test('strict fault practice restarts the set, animates once, replays on click and returns to 40L', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), instant({ strictPractice: true }));
  await page.goto('/');
  await page.locator('#replay-file').setInputFiles({ name: 'faults.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(twoFaults())) });
  await expect(page.locator('#mode-label')).toHaveText('FAULT PRACTICE');
  await expect(page.locator('#practice-progress')).toHaveText('0 / 2');
  await page.keyboard.press('Space'); await expect(page.locator('#practice-progress')).toHaveText('1 / 2');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#practice-progress')).toHaveText('0 / 2');
  await expect(page.locator('#demo-popup')).toBeVisible();
  await expect(page.locator('#demo-step')).toContainText('Complete', { timeout: 3000 });
  await page.waitForTimeout(700); await expect(page.locator('#demo-step')).toContainText('Complete');
  await expect(page.locator('#time')).toHaveText('0:00.000'); await expect(page.locator('#retry-status')).toBeVisible();
  await page.locator('#demo-replay').click(); await expect(page.locator('#demo-step')).toHaveText('Start here');
  await page.screenshot({ path: 'test-results/fault-practice.png', fullPage: true });
  await page.keyboard.press('Space'); await expect(page.locator('#practice-progress')).toHaveText('1 / 2');
  await page.keyboard.press('Space'); await expect(page.locator('#overlay-value')).toHaveText('Practice complete');
  await page.locator('#sprint').click(); await expect(page.locator('#mode-label')).toHaveText('40 LINE SPRINT');
  await expect(page.locator('#demo-popup')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('native solo and multiplayer import, player selection and bad-file recovery', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), instant());
  await page.goto('/');
  await page.locator('#replay-file').setInputFiles('test/fixtures/viewtris-40l.ttr');
  await expect(page.locator('#practice-progress')).toHaveText('0 / 21');
  await page.locator('#replay-file').setInputFiles('test/fixtures/viewtris-match.ttrm');
  await expect(page.locator('#replay-selection')).toBeVisible();
  await expect(page.locator('#replay-track option')).toHaveCount(16);
  await page.locator('#replay-track').selectOption('1'); await page.locator('#practice-track').click();
  await expect(page.locator('#practice-progress')).toHaveText('0 / 24');
  await page.locator('#replay-file').setInputFiles({ name: 'invalid.ttr', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#practice-status')).toContainText('Import failed');
  await expect(page.locator('#practice-progress')).toHaveText('0 / 24');
  expect(errors).toEqual([]);
});

test('last completed game can start a fault practice set and mobile layout stays inside the viewport', async ({ page }) => {
  await page.addInitScript(({ settings, replay }) => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    localStorage.setItem('tetrio-trainer-last-replay', JSON.stringify(replay));
  }, { settings: instant(), replay: { ...twoFaults(), status: 'complete' } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#practice-last').click();
  await expect(page.locator('#practice-progress')).toHaveText('0 / 2');
  await page.locator('#settings-open').click();
  expect(await page.locator('#settings-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
