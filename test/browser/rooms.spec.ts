import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/settings';
import { exportPreset, roomPreset, roomPresetNames } from '../../src/modes';

test.beforeEach(async ({ page }) => {
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  await page.addInitScript(value => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(value)), settings);
});

test('all archived room presets populate the editor and Classic enforces its visible controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#mode-select').selectOption('custom'); await page.locator('#custom-open').click();
  for (const id of Object.keys(roomPresetNames)) {
    const rules = roomPreset(id);
    await page.locator('#custom-preset').selectOption(`room:${id}`);
    await expect(page.locator('#custom-width')).toHaveValue(String(rules.advanced.width));
    await expect(page.locator('#custom-kickSet')).toHaveValue(rules.advanced.kickSet);
    await expect(page.locator('#custom-bag')).toHaveValue(rules.bag);
    await expect(page.locator('#custom-source')).toContainText('2026-07-18');
  }
  await page.locator('#custom-preset').selectOption('room:classic'); await page.locator('#custom-start').click();
  await expect(page.locator('#mode-label')).toHaveText('CLASSIC · SOLO');
  await expect(page.locator('#hold-panel')).not.toBeVisible();
  await expect(page.locator('#next-preview')).toHaveAttribute('height', '90');
  await expect(page.locator('#mode-rules')).toContainText('ARR 5, DAS 16, SDF 6');
  await expect(page.locator('#controls-summary')).toContainText('automatic lock');
  await page.keyboard.press('Space'); await page.keyboard.press('c');
  await expect(page.locator('#pieces')).toHaveText('0'); await expect(page.locator('#holds')).toHaveText('0');
  await page.locator('#pause').click(); await page.screenshot({ path: 'test-results/room-classic.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('4-WIDE renders at the right aspect ratio with a complete replayable finesse popup and imports its fault scenes', async ({ page }) => {
  await page.goto('/'); await page.locator('#mode-select').selectOption('custom'); await page.locator('#custom-open').click();
  await page.locator('#custom-preset').selectOption('room:4wide'); await page.locator('#custom-seed').fill('1'); await page.locator('#custom-start').click();
  await page.locator('#finesse-toggle').check();
  await expect(page.locator('#board')).toHaveAttribute('width', '120'); await expect(page.locator('#board')).toHaveAttribute('height', '870');
  const board = await page.locator('#board').boundingBox(), hold = await page.locator('#hold-panel').boundingBox();
  expect(Math.abs(board!.height / board!.width - 29 / 4)).toBeLessThan(.01);
  expect(Math.abs(hold!.y - (board!.y + board!.width * 3 / 4))).toBeLessThan(3);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('z'); await page.keyboard.press('Space');
  await expect(page.locator('#faults')).toHaveText('1'); await expect(page.locator('#demo-popup')).toBeVisible();
  await expect(page.locator('#demo-title')).toHaveText('Piece 1 · Correct placement');
  await expect(page.locator('#demo-steps li').last()).toContainText('Hard drop');
  await expect(page.locator('#demo-board')).toHaveAttribute('width', '72'); await expect(page.locator('#demo-board')).toHaveAttribute('height', '522');
  await expect(page.locator('#demo-step')).toContainText('Complete');
  await page.locator('#demo-replay').click(); await expect(page.locator('#demo-step')).toHaveText('Start here');
  await page.locator('#pause').click(); await page.screenshot({ path: 'test-results/room-4wide-finesse.png', fullPage: true });
  await page.locator('#practice-last').click(); await expect(page.locator('#practice-status')).toContainText('1 fault scenes loaded');
  await expect(page.locator('#board')).toHaveAttribute('width', '120');
  await page.keyboard.press('Space'); await expect(page.locator('#overlay-value')).toHaveText('Practice complete');
});

test('Sprint finesse popup opens on every fault and disabling finesse dismisses it', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click();
  for (let fault = 1; fault <= 2; fault++) {
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
    await expect(page.locator('#faults')).toHaveText(String(fault)); await expect(page.locator('#demo-popup')).toBeVisible();
    if (fault === 1) { await page.locator('#demo-close').click(); await expect(page.locator('#demo-popup')).not.toBeVisible(); }
  }
  await page.locator('#finesse-toggle').uncheck(); await expect(page.locator('#demo-popup')).not.toBeVisible();
});

test('authored maps and queues round-trip through preset files, validate before saving and fit mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.locator('#mode-select').selectOption('custom'); await page.locator('#custom-open').click();
  const rules = roomPreset('bombs'); rules.advanced.width = 4; rules.advanced.height = 26; rules.initialGarbage = 0;
  rules.advanced.map = '*###'; rules.advanced.sequence = 'ijlo'; rules.advanced.repeatSequence = true;
  const upload = (value: unknown) => page.locator('#custom-file').setInputFiles({ name: 'preset.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await upload(exportPreset(rules)); await expect(page.locator('#custom-status')).toContainText('Preset imported');
  await page.getByText('Authored map and queue', { exact: true }).click();
  await expect(page.locator('#custom-map')).toHaveValue('*###'); await expect(page.locator('#custom-sequence')).toHaveValue('ijlo');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#custom-export').click(); const download = await downloadPromise;
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(data.rules.advanced.sequence).toBe('ijlo'); expect(data.source.native['options.usebombs']).toBe('1');
  await upload({ ...exportPreset(rules), version: 99 }); await expect(page.locator('#custom-status')).toContainText('Import failed');
  await expect(page.locator('#custom-map')).toHaveValue('*###');
  await page.locator('#custom-map').fill('###'); await page.locator('#custom-start').click(); await expect(page.locator('#custom-status')).toContainText('4 cells wide');
  await page.locator('#custom-map').fill('*###');
  expect(await page.locator('#custom-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/room-preset-mobile.png', fullPage: true });
  await page.locator('#custom-start').click(); await expect(page.locator('#board')).toHaveAttribute('width', '120');
  await expect(page.locator('#mode-rules')).toContainText('Authored queue (repeating)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
