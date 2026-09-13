import { test, expect, type Page } from '@playwright/test';
import { encoder, Field } from 'tetris-fumen';
import { defaults } from '../../src/settings';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem('tetrio-trainer-settings-v1')) localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    const original = crypto.getRandomValues.bind(crypto); let next = 0;
    Object.defineProperty(crypto, 'getRandomValues', { value: (view: any) => { if (view instanceof Uint32Array && view.length === 1 && next < 4) { view[0] = [16, 16, 28, 79][next++]; return view; } return original(view); } });
  }, { ...defaults, training: { ...defaults.training, countdownSeconds: 0, justThink: true } });
  await page.route('**/src/main.ts*', async route => { const response = await route.fetch(); await route.fulfill({ response, body: `${await response.text()}\nwindow.__testCurrent = () => game;` }); });
});

async function followupFixture(page: Page) {
  const fumen = encoder.encode([{ field: Field.create('XXXX__XX__XXXX__XX__'), operation: { type: 'O', x: 4, y: 0, rotation: 'spawn' } }]);
  await page.goto('/#openers'); await page.getByText('Import your own Fumen', { exact: true }).click();
  await page.locator('#opener-import-name').fill('PC Followup Test'); await page.locator('#opener-fumen').fill(fumen); await page.getByRole('button', { name: 'Validate and save Fumen' }).click();
  await expect(page.locator('#opener-import-status')).toHaveText('Validated and saved locally.');
  await page.locator('#opener-followups').check(); await page.locator('#opener-start').click();
  await expect(page.locator('#mode-label')).toHaveText('OPENER PRACTICE'); await page.locator('#continuation-depth').selectOption('4');
  await page.keyboard.press('Space'); await expect(page.locator('#practice-progress')).toContainText('Continue');
  await expect(page.locator('#continuation-status')).toContainText('playable continuation', { timeout: 15000 });
  await expect(page.locator('#continuation-routes button').first()).toBeVisible();
}

test('shortlisted openers are pinned in the catalog and in random candidates and persist across reloads', async ({ page }) => {
  await page.goto('/#openers'); await page.locator('#opener-search').fill('Albatross');
  await page.getByRole('button', { name: 'Shortlist: Albatross Special', exact: true }).click();
  await page.locator('#opener-search').fill(''); await expect(page.locator('#opener-catalog .opener-card strong').first()).toHaveText('Albatross Special');
  await page.reload(); await expect(page.locator('#opener-catalog .opener-card strong').first()).toHaveText('Albatross Special');
  await page.locator('#opener-deal').click(); await expect(page.locator('#opener-reference-status')).toContainText('Press R', { timeout: 15000 });
  await expect(page.locator('#opener-reference-cards .opener-card strong').first()).toContainText('Albatross Special');
  await page.getByRole('button', { name: 'Remove from shortlist: Albatross Special', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tetrio-trainer-opener-shortlist-v1')!))).toEqual([]);
});

test('continuation worker provides a live PC hint, full instructions and a route that can be completed', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await followupFixture(page);
  await expect(page.locator('#continuation-enabled')).toBeChecked(); await expect(page.locator('#continuation-seeded')).toBeChecked();
  await expect(page.locator('#continuation-inputs')).toContainText('Hard drop'); await expect(page.locator('#continuation-plan')).toContainText('perfect clear');
  expect(await page.evaluate(() => (window as any).__testCurrent().hintTarget.length)).toBe(4);
  await page.screenshot({ path: 'test-results/opener-pc-continuation.png', fullPage: true });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(150); await page.keyboard.up('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#continuation-status')).toContainText('Perfect clear complete'); await expect(page.locator('#lines')).toHaveText('2');
  expect(await page.evaluate(() => (window as any).__testCurrent().hintTarget)).toBeNull(); expect(errors).toEqual([]);
});

test('different placements are accepted, stale routes are discarded and continuation preferences survive a new seed', async ({ page }) => {
  await followupFixture(page);
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('2'); await expect(page.locator('#faults')).toHaveText('0');
  await expect(page.locator('#continuation-status')).toContainText('No published stage', { timeout: 15000 });
  expect(await page.evaluate(() => (window as any).__testCurrent().hintTarget)).toBeNull(); await expect(page.locator('#continuation-routes button')).toHaveCount(0);
  await page.locator('#continuation-seeded').uncheck(); await expect(page.locator('#continuation-scope')).toContainText('Visible queue', { timeout: 15000 });
  await page.keyboard.press('r'); await expect(page.locator('#pieces')).toHaveText('0');
  await expect(page.locator('#continuation-enabled')).toBeChecked(); await expect(page.locator('#continuation-seeded')).not.toBeChecked();
  await expect(page.locator('#continuation-status')).toContainText('Complete the opening'); await page.locator('#continuation-enabled').uncheck(); await expect(page.locator('#continuation-options')).toBeHidden();
  await page.getByRole('link', { name: 'Openers', exact: true }).click(); await expect(page.locator('#opener-followups')).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
