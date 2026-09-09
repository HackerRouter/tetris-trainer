import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/settings';

test('d-002 rotation counting, hard-drop coaching and retry work through real key bindings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(settings => localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)), { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } });
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'getRandomValues', { value: (array: Uint32Array) => { array[0] = 942561; return array; } });
  });
  await page.goto('/'); await page.locator('#start').click();
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(25);
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(25);
  await page.keyboard.press('Space');
  await expect(page.locator('#faults')).toHaveText('1');
  await expect(page.locator('#pieces')).toHaveText('0');
  await expect(page.locator('#solution')).toHaveText('2 inputs used · 1 needed. Rotate 180° → Hard drop');
  await expect(page.locator('#solution')).not.toContainText('Soft drop');
  await page.screenshot({ path: 'test-results/finesse.png' });
  await page.keyboard.press('a'); await page.waitForTimeout(25);
  await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1');
  await expect(page.locator('#perfects')).toHaveText('1');
  await expect(page.locator('#coach')).not.toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
  const download = await downloadPromise;
  const replay = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(replay.finesseRules.name).toBe('d-002');
  expect(replay.finesseRules.rotation180Cost).toBe(1);
  expect(replay.finesseRules.preferHardDrop).toBe(true);
  expect(replay.placements.map((placement: { finesseInputs: number }) => placement.finesseInputs)).toEqual([2, 1]);
  expect(replay.placements[1].inputs).toEqual(['rotate180', 'hardDrop']);
  expect(errors).toEqual([]);
});
