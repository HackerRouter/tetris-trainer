import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/settings';

const settings = { ...defaults, handling: { ...defaults.handling, das: 20, dcd: 4 }, training: { ...defaults.training, countdownSeconds: .5 } };

async function replay(page: Page) {
  const pending = page.waitForEvent('download'); await page.locator('#download').click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
}

test('holding a direction during countdown precharges it and keeps one finesse input', async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), settings);
  await page.goto('/'); await page.locator('#start').click();
  await page.keyboard.down('ArrowLeft');
  await expect(page.locator('#time')).toHaveText('0:00.000');
  await expect(page.locator('#inputs')).toHaveText('0');
  await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('0');
  await expect(page.locator('#board-overlay')).not.toBeVisible();
  await expect(page.locator('#inputs')).toHaveText('1');
  await page.keyboard.up('ArrowLeft'); await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1'); await expect(page.locator('#faults')).toHaveText('0');
  const result = await replay(page);
  expect(Math.min(...result.placements[0].cells.map(([x]: number[]) => x))).toBe(0);
  expect(result.placements[0].inputs).toEqual(['moveLeft', 'hardDrop']);
  expect(result.events.filter((event: { type: string }) => event.type === 'das-precharge')).toHaveLength(1);
});

test('a direction already held before restart stays held across restart and alternate key releases', async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), { ...settings, extraBindings: { moveRight: ['KeyL'] } });
  await page.goto('/'); await page.locator('#start').click();
  await expect(page.locator('#board-overlay')).not.toBeVisible();
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('l');
  await page.keyboard.press('r'); await expect(page.locator('#overlay-value')).toHaveText('1');
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('#board-overlay')).not.toBeVisible();
  await expect(page.locator('#inputs')).toHaveText('1');
  await page.keyboard.up('l'); await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1');
  const result = await replay(page);
  expect(Math.max(...result.placements[0].cells.map(([x]: number[]) => x))).toBe(9);
  expect(result.placements[0].inputs).toEqual(['moveRight', 'hardDrop']);
  expect(result.result.faults).toBe(0);
});

test('releasing during countdown or opening settings clears the direction buffer', async ({ page }) => {
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), settings);
  await page.goto('/'); await page.locator('#start').click();
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(100); await page.keyboard.up('ArrowLeft');
  await expect(page.locator('#board-overlay')).not.toBeVisible();
  await expect(page.locator('#inputs')).toHaveText('0');
  await page.keyboard.press('r'); await page.keyboard.down('ArrowRight');
  await page.locator('#settings-open').click(); await page.keyboard.up('ArrowRight');
  await page.locator('#cancel-settings').click();
  await expect(page.locator('#board-overlay')).not.toBeVisible();
  await expect(page.locator('#inputs')).toHaveText('0');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  const result = await replay(page);
  expect(result.placements[0].inputs).toEqual(['hardDrop']);
  expect(result.events.filter((event: { type: string }) => event.type === 'das-precharge')).toHaveLength(0);
});
