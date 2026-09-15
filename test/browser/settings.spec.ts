import { clickFileTool } from './workspace-controls';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/settings';

const instantSettings = { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } };

test('opacity sliders use whole percentages and displayed numeric values support direct editing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 2560, height: 1600 });
  await page.addInitScript(settings => {
    if (sessionStorage.getItem('opacity-fixture')) return;
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)); sessionStorage.setItem('opacity-fixture', '1');
  }, { ...instantSettings, display: { ...defaults.display, ghostOpacity: .652802893309223 } });
  await page.goto('/'); await page.click('#settings-open');
  await expect(page.locator('#opacity-unit')).toHaveText('65%');
  for (const [id, output] of [['ghostOpacity', 'opacity-unit'], ['gridOpacity', 'gridOpacity-unit'], ['boardOpacity', 'boardOpacity-unit']]) {
    const slider = page.locator(`#${id}`);
    await slider.scrollIntoViewIfNeeded(); const rect = (await slider.boundingBox())!;
    await page.mouse.move(rect.x + rect.width * .24, rect.y + rect.height / 2); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .6528, rect.y + rect.height / 2, { steps: 7 }); await page.mouse.up();
    const value = Number(await slider.inputValue()); expect(Number.isInteger(value)).toBe(true);
    await expect(page.locator(`#${output}`)).toHaveText(`${value}%`);
    await slider.press('ArrowRight'); await expect(slider).toHaveValue(String(value + 1));
    await page.click(`#${output}`); const editor = page.locator('.setting-value-editor');
    await editor.fill('37.4'); await editor.press('Enter');
    await expect(slider).toHaveValue('37'); await expect(page.locator(`#${output}`)).toHaveText('37%');
    await expect(page.locator('#settings-dialog')).toBeVisible();
  }
  await page.click('#audio-volume-unit'); await page.locator('.setting-value-editor').fill('48');
  await page.locator('.setting-value-editor').press('Tab'); await expect(page.locator('#audio-volume-unit')).toHaveText('48%');
  await page.click('#bind-moveLeft'); await page.click('#das-unit'); await page.locator('.setting-value-editor').fill('125'); await page.locator('.setting-value-editor').press('Enter');
  await expect(page.locator('#das')).toHaveValue('7.5'); await expect(page.locator('#das-unit')).toHaveText('125.0 ms');
  await expect(page.locator('#bind-moveLeft')).toHaveText('Left');
  await page.click('#arr-unit'); await page.locator('.setting-value-editor').fill('25'); await page.locator('.setting-value-editor').press('Escape');
  await expect(page.locator('#arr')).toHaveValue('0'); await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.click('#opacity-unit'); await page.locator('.setting-value-editor').fill('101'); await page.locator('.setting-value-editor').press('Enter');
  await expect(page.locator('.setting-value-editor')).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.locator('.setting-value-editor').fill(''); await page.locator('.setting-value-editor').press('Enter');
  await expect(page.locator('.setting-value-editor')).toBeVisible(); await page.locator('.setting-value-editor').press('Escape');
  await page.screenshot({ path: 'TEMP/settings-integer-values.png' });
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.reload(); await page.click('#settings-open');
  await expect(page.locator('#opacity-unit')).toHaveText('37%'); await expect(page.locator('#gridOpacity-unit')).toHaveText('37%');
  await expect(page.locator('#boardOpacity-unit')).toHaveText('37%'); await expect(page.locator('#audio-volume-unit')).toHaveText('48%');
  await expect(page.locator('#das')).toHaveValue('7.5'); expect(errors).toEqual([]);
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => { if (!localStorage.getItem('tetrio-trainer-settings-v1')) localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)); }, instantSettings);
});

test('settings persist, validate key conflicts, and control actual inputs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#settings-open').click();
  await page.locator('#arr').fill('1.5');
  await page.locator('#das').fill('8.2');
  await page.locator('#dcd').fill('2.1');
  await page.locator('#sdf').selectOption('13');
  await page.locator('#cancel').check();
  await page.locator('#safelock').check();
  await page.locator('#irs').selectOption('hold');
  await page.locator('#ihs').selectOption('off');
  await page.locator('#grid').uncheck();
  await page.locator('#bind-moveLeft').click();
  await page.keyboard.press('j');
  await expect(page.locator('#bind-moveLeft')).toHaveText('J');
  await page.locator('#bind-moveRight').click();
  await page.keyboard.press('j');
  await expect(page.locator('#settings-status')).toContainText('assigned');
  await page.keyboard.press('l');
  await page.locator('#bind-hardDrop').click();
  await page.keyboard.press('Enter');
  await page.locator('#arr').fill('21');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('#settings-status')).toHaveClass('error');
  await page.locator('#arr').fill('1.5');
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await page.reload();
  await page.locator('#settings-open').click();
  await expect(page.locator('#arr')).toHaveValue('1.5');
  await expect(page.locator('#das')).toHaveValue('8.2');
  await expect(page.locator('#sdf')).toHaveValue('13');
  await expect(page.locator('#cancel')).toBeChecked();
  await expect(page.locator('#irs')).toHaveValue('hold');
  await expect(page.locator('#bind-moveLeft')).toHaveText('J');
  await expect(page.locator('#bind-hardDrop')).toHaveText('Enter');
  await page.locator('#cancel-settings').click();
  await page.locator('#start').click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  await expect(page.locator('#inputs')).toHaveText('0');
  await page.keyboard.down('j'); await page.waitForTimeout(25); await page.keyboard.up('j');
  await expect(page.locator('#inputs')).toHaveText('1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pieces')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('settings pause gameplay, capture cannot move pieces, and cancel discards edits', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click();
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(40);
  await page.locator('#settings-open').click();
  await page.keyboard.up('ArrowRight');
  const time = await page.locator('#time').textContent();
  const inputs = await page.locator('#inputs').textContent();
  await page.locator('#bind-moveLeft').click(); await page.keyboard.press('j');
  await page.locator('#arr').fill('4'); await page.waitForTimeout(100);
  await expect(page.locator('#time')).toHaveText(time!);
  await expect(page.locator('#inputs')).toHaveText(inputs!);
  await page.locator('#cancel-settings').click();
  await expect(page.locator('#pause')).toHaveText('Pause');
  await page.locator('#settings-open').click();
  await expect(page.locator('#arr')).toHaveValue('0');
  await expect(page.locator('#bind-moveLeft')).toHaveText('Left');
  await page.locator('#cancel-settings').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toHaveText('Resume');
});

test('import, export, defaults, and malformed files', async ({ page }) => {
  await page.goto('/'); await page.locator('#settings-open').click();
  const imported = structuredClone(defaults); imported.handling.das = 12; imported.bindings.hold = 'ShiftRight';
  await page.locator('#settings-file').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('#das')).toHaveValue('12');
  await expect(page.locator('#bind-hold')).toHaveText('Shift Right');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-settings').click();
  const download = await downloadPromise;
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(data).toEqual(imported);
  await page.locator('#settings-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#settings-status')).toContainText('Import failed');
  await expect(page.locator('#das')).toHaveValue('12');
  await page.locator('#reset-settings').click();
  await expect(page.locator('#das')).toHaveValue('6');
  await expect(page.locator('#bind-hold')).toHaveText('C');
});

test('fault returns the actual shape to spawn and permits a new target', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#start').click();
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(25);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(25);
  await page.keyboard.press('Space');
  await expect(page.locator('#faults')).toHaveText('1');
  await expect(page.locator('#pieces')).toHaveText('0');
  await expect(page.locator('#coach')).toBeVisible();
  await expect(page.locator('#solution')).toContainText('0 needed');
  await page.screenshot({ path: 'test-results/game.png' });
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(25); await page.keyboard.press('Space');
  await expect(page.locator('#pieces')).toHaveText('1');
  await expect(page.locator('#coach')).not.toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await clickFileTool(page, '#download');
  const download = await downloadPromise;
  const replay = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(replay.placements.length).toBe(2);
  expect(replay.result.faults).toBe(1);
  expect(replay.settings).toEqual(instantSettings);
  expect(errors).toEqual([]);
});

test('saved bindings take effect at restart, not partway through a game', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click();
  await page.locator('#settings-open').click();
  await page.locator('#bind-hardDrop').click(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.keyboard.press('Enter'); await page.waitForTimeout(30);
  await expect(page.locator('#inputs')).toHaveText('0');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.locator('#start').click();
  await page.keyboard.press('Space'); await page.waitForTimeout(30);
  await expect(page.locator('#inputs')).toHaveText('0');
  await page.keyboard.press('Enter'); await expect(page.locator('#pieces')).toHaveText('1');
});

test('malformed stored data does not crash startup and settings fit small screens', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tetrio-trainer-settings-v1', '{broken'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('Defaults');
  await page.locator('#settings-open').click();
  await expect(page.locator('#das')).toHaveValue('6');
  expect(await page.locator('#settings-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
});
