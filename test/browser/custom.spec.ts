import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/settings';
import { TrainerGame } from '../../src/game';

const instant = { ...structuredClone(defaults), training: { ...defaults.training, countdownSeconds: 0 } };
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('tetrio-trainer-settings-v1')) localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
  }, instant);
});

test('custom rules start a seeded challenge, control previews, complete goals and round-trip through replay', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#mode-select').selectOption('custom');
  await expect(page.locator('#finesse-toggle')).not.toBeChecked();
  await page.locator('#custom-open').click();
  await page.locator('#custom-preset').selectOption('downstack');
  await expect(page.locator('#custom-initialGarbage')).toHaveValue('10');
  await expect(page.locator('#custom-lineGoal')).toHaveValue('0');
  await expect(page.locator('#custom-garbageRefill')).toHaveValue('10');
  await page.getByText('Garbage and solo pressure', { exact: true }).click();
  await page.locator('#custom-garbageRefill').fill('4');
  await page.locator('#custom-initialGarbage').fill('4');
  await page.locator('#custom-lineGoal').fill('0'); await page.locator('#custom-pieceGoal').fill('2');
  await page.locator('#custom-seed').fill('1234'); await page.locator('#custom-nextCount').fill('3');
  await page.locator('#custom-bag').selectOption('14-bag'); await page.locator('#custom-hold').uncheck();
  await page.screenshot({ path: 'test-results/custom-rules.png', fullPage: true });
  await page.locator('#custom-start').click();
  await expect(page.locator('#mode-label')).toHaveText('CUSTOM PRACTICE');
  await expect(page.locator('#hold-panel')).not.toBeVisible();
  await expect(page.locator('#next-preview')).toHaveAttribute('height', '270');
  await expect(page.locator('#mode-rules')).toContainText('Seed: 1234');
  await page.keyboard.press('c'); await expect(page.locator('#holds')).toHaveText('0');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.keyboard.press('Space'); await expect(page.locator('#overlay-value')).toHaveText('Session complete');
  const replay = await page.evaluate(() => JSON.parse(localStorage.getItem('tetrio-trainer-last-replay')!));
  expect(replay.mode).toBe('custom'); expect(replay.seed).toBe(1234); expect(replay.result.pieces).toBe(2);
  expect(replay.modeRules.bag).toBe('14-bag'); expect(replay.placements[0].snapshot.board.flat().filter(Boolean)).toHaveLength(36);
  await page.reload(); await expect(page.locator('#mode-select')).toHaveValue('custom');
  await page.locator('#custom-open').click(); await expect(page.locator('#custom-seed')).toHaveValue('1234');
  await expect(page.locator('#custom-bag')).toHaveValue('14-bag'); expect(errors).toEqual([]);
  await expect(page.locator('#custom-garbageRefill')).toHaveValue('4');
});

test('the page finesse switch applies live, clears a retry target and remembers separate mode preferences', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#faults')).toHaveText('1'); await expect(page.locator('#coach')).toBeVisible();
  await page.locator('#finesse-toggle').uncheck(); await expect(page.locator('#coach')).not.toBeVisible();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1'); await expect(page.locator('#faults')).toHaveText('1');
  await page.locator('#finesse-toggle').check();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1'); await expect(page.locator('#faults')).toHaveText('2');
  await page.locator('#finesse-toggle').uncheck();
  await page.locator('#mode-select').selectOption('custom'); await page.locator('#start').click();
  await expect(page.locator('#finesse-scope')).toContainText('Custom'); await expect(page.locator('#finesse-toggle')).not.toBeChecked();
  await page.locator('#finesse-toggle').check();
  await page.locator('#sprint').click(); await expect(page.locator('#finesse-toggle')).not.toBeChecked();
  await page.reload(); await expect(page.locator('#finesse-toggle')).not.toBeChecked();
  await page.locator('#mode-select').selectOption('custom'); await expect(page.locator('#finesse-toggle')).toBeChecked();
});

test('fault practice has its own live finesse switch while scene targets remain required', async ({ page }) => {
  const game = new TrainerGame(instant, 942562); game.start();
  for (const key of ['moveLeft', 'moveRight', 'hardDrop'] as const) { game.input.press(key); game.step(); game.input.release(key); }
  await page.goto('/');
  await page.locator('#replay-file').setInputFiles({ name: 'fault.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(game.export())) });
  await expect(page.locator('#finesse-scope')).toContainText('Fault practice');
  await page.locator('#finesse-toggle').uncheck();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space');
  await expect(page.locator('#coach-title')).toHaveText('Match the outlined target');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#overlay-value')).toHaveText('Practice complete');
  await expect(page.locator('#faults')).toHaveText('0');
  await page.locator('#sprint').click(); await expect(page.locator('#finesse-toggle')).toBeChecked();
});

test('zen supports board clearing and undo, and its rule editor fits mobile and validates input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.locator('#mode-select').selectOption('custom'); await page.locator('#start').click();
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.locator('#clear-field').click(); await expect(page.locator('#mode-rules')).toContainText('Boards cleared: 1');
  await page.keyboard.press('Control+z'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.keyboard.press('Control+z'); await expect(page.locator('#pieces')).toHaveText('0');
  await page.locator('#custom-open').click(); await expect(page.locator('#overlay-value')).toHaveText('Paused');
  await page.locator('#custom-gravity').fill('21'); await page.locator('#custom-start').click();
  await expect(page.locator('#custom-status')).toContainText('gravity must be');
  expect(await page.locator('#custom-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('#custom-cancel').click(); await expect(page.locator('#board-overlay')).not.toBeVisible();
  await page.locator('#finish-session').click(); await expect(page.locator('#overlay-value')).toHaveText('Session complete');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/custom-mobile.png', fullPage: true });
});

test('native assets decode locally, gameplay starts real audio sprites and mute prevents new sounds', async ({ page }) => {
  const { sprites } = JSON.parse(await readFile('public/tetrio/sound-pack.json', 'utf8'));
  await page.addInitScript(() => {
    const monitor = window as typeof window & { soundCalls: number[][] }; monitor.soundCalls = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      monitor.soundCalls.push([offset, duration ?? 0]); start.call(this, when, offset, duration);
    };
  });
  const requests: string[] = [], failures: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('requestfailed', request => failures.push(request.url()));
  await page.goto('/'); await expect(page.locator('#audio-status')).toContainText('ready');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px HUN') && document.fonts.check('16px Config'))).toBe(true);
  await expect(page.locator('#hold-panel')).toHaveClass(/native-frame/);
  await expect(page.locator('#next-panel')).toHaveClass(/native-frame/);
  await page.locator('#mode-select').selectOption('custom'); await page.locator('#start').click();
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('#inputs')).toHaveText('1');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  const calls = await page.evaluate(() => (window as typeof window & { soundCalls: number[][] }).soundCalls);
  expect(calls.some(([offset, duration]) => offset === sprites.harddrop.offset && duration === sprites.harddrop.duration)).toBe(true);
  expect(calls.some(([offset]) => offset === sprites.move.offset)).toBe(true);
  await page.locator('#pause').click(); await page.screenshot({ path: 'test-results/custom-desktop.png', fullPage: true });
  await page.locator('#settings-open').click(); await page.locator('#audio-enabled').uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  const count = await page.evaluate(() => (window as typeof window & { soundCalls: number[][] }).soundCalls.length);
  await page.locator('#pause').click(); await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('2');
  expect(await page.evaluate(() => (window as typeof window & { soundCalls: number[][] }).soundCalls.length)).toBe(count);
  expect(requests.filter(url => url.includes('/tetrio/')).length).toBeGreaterThan(7);
  expect(requests.every(url => url.startsWith('http://127.0.0.1:5179/'))).toBe(true);
  expect(failures).toEqual([]);
});
