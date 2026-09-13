import { clickFileTool, openSection } from './workspace-controls';
import { test, expect, type Page } from '@playwright/test';
import { encoder, Field } from 'tetris-fumen';
import { defaults } from '../../src/settings';
import { readFile } from 'node:fs/promises';

const fumen = encoder.encode([{ field: Field.create(), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }, { operation: { type: 'O', x: 4, y: 2, rotation: 'spawn' } }]);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => { if (!localStorage.getItem('tetrio-trainer-settings-v1')) localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)); }, { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } });
});
async function recording(page: Page) {
  const pending = page.waitForEvent('download'); await clickFileTool(page, '#download');
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
}
async function importOpener(page: Page) {
  await page.goto('/#openers'); await page.getByText('Import your own Fumen', { exact: true }).click();
  await page.locator('#opener-import-name').fill('Two O pieces'); await page.locator('#opener-fumen').fill(fumen);
  await page.getByRole('button', { name: 'Validate and save Fumen' }).click();
  await expect(page.locator('#opener-import-status')).toHaveText('Validated and saved locally.');
}

test('catalog search, import, mirroring and narrow layouts remain usable', async ({ page }) => {
  await page.goto('/#openers'); await expect(page.locator('#opener-count')).toContainText('479 constructions');
  await page.locator('#opener-search').fill('TKI'); await expect(page.locator('#opener-catalog .opener-card')).not.toHaveCount(0);
  await openSection(page, '#opener-training-options'); await page.locator('#opener-mirror').check(); await expect(page.locator('#opener-start')).toBeEnabled();
  await page.locator('#opener-search').fill('nonexistentzzzzz'); await expect(page.locator('#opener-empty')).toBeVisible();
  await importOpener(page); await expect(page.locator('#opener-name')).toHaveText('Two O pieces');
  await page.locator('#opener-fumen').fill('invalid'); await page.getByRole('button', { name: 'Validate and save Fumen' }).click();
  await expect(page.locator('#opener-import-status')).toContainText('Invalid Fumen');
  await page.reload(); await page.locator('#opener-search').fill('Two O pieces'); await expect(page.locator('#opener-catalog .opener-card')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('random opening keeps candidate diagrams to the left and remembers toggles across seeds and reloads', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#openers'); await page.locator('#opener-deal').click();
  await expect(page.locator('#opener-reference-status')).toContainText('Press R', { timeout: 30000 });
  await expect(page.locator('#opener-reference-cards .opener-card')).not.toHaveCount(0);
  await expect(page.locator('#opener-keep-board')).toBeChecked();
  const board = (await page.locator('#board').boundingBox())!, cards = (await page.locator('#opener-reference-cards').boundingBox())!;
  expect(cards.x + cards.width).toBeLessThan(board.x);
  await page.locator('#finesse-toggle').uncheck(); await page.locator('#think-toggle').check();
  const first = await recording(page); await page.keyboard.press('r');
  await expect.poll(async () => page.locator('#opener-reference-status').textContent(), { timeout: 30000 }).not.toContain(String(first.seed));
  await expect(page.locator('#opener-reference-status')).toContainText('Press R', { timeout: 30000 });
  await expect(page.locator('#finesse-toggle')).not.toBeChecked(); await expect(page.locator('#think-toggle')).toBeChecked();
  const second = await recording(page); expect(second.seed).not.toBe(first.seed); expect(second.finalSnapshot.board.flat().filter(Boolean)).toHaveLength(0);
  await page.locator('#opener-reference-cards .opener-card').first().click(); await expect(page.locator('#mode-label')).toHaveText('OPENER PRACTICE');
  await expect(page.locator('#finesse-toggle')).not.toBeChecked(); await expect(page.locator('#think-toggle')).toBeChecked();
  await page.screenshot({ path: 'test-results/random-opener-training.png', fullPage: true });
  await page.reload(); await page.getByRole('link', { name: 'Openers', exact: true }).click(); await page.locator('#opener-deal').click();
  await expect(page.locator('#opener-reference-status')).toContainText('Press R', { timeout: 30000 });
  await expect(page.locator('#finesse-toggle')).not.toBeChecked(); await expect(page.locator('#think-toggle')).toBeChecked();
  expect(errors).toEqual([]);
});

test('single opener continues on its field by default, supports immediate repeat and gives R a new seed', async ({ page }) => {
  await importOpener(page); await page.locator('#opener-start').click();
  await expect(page.locator('#mode-label')).toHaveText('OPENER PRACTICE');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.keyboard.press('Space'); await expect(page.locator('#practice-progress')).toContainText('Continue');
  const completed = await recording(page); expect(completed.status).toBe('playing'); expect(completed.finalSnapshot.board.flat().filter(Boolean)).toHaveLength(8);
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('3');
  await page.keyboard.press('r'); await expect(page.locator('#pieces')).toHaveText('0');
  const restarted = await recording(page); expect(restarted.seed).not.toBe(completed.seed);
  await page.locator('#opener-keep-board').uncheck();
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('0');
  const repeated = await recording(page); expect(repeated.seed).not.toBe(restarted.seed); expect(repeated.finalSnapshot.board.flat().filter(Boolean)).toHaveLength(0);
});

test('ordinary modes can recommend an opening while unsupported dimensions show a clear message', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/'); await page.locator('#opener-recommend-toggle').check();
  await expect(page.locator('#opener-reference-status')).toContainText('candidate openers for this seed', { timeout: 30000 });
  await expect(page.locator('#mode-label')).toHaveText('40 LINE SPRINT');
  await page.locator('#mode-select').selectOption('custom'); await page.locator('#custom-open').click();
  await page.locator('#custom-preset').selectOption('room:4wide');
  await page.locator('#custom-start').click();
  await expect(page.locator('#opener-reference-status')).toContainText('10-column');
  await expect(page.locator('#opener-reference-cards .opener-card')).toHaveCount(0);
});
