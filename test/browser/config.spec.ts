import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/settings';
import { TrainerGame } from '../../src/game';

const fixture = 'test/fixtures/example-config.ttc';
const instant = { ...defaults, training: { ...defaults.training, countdownSeconds: 0 } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => { if (!localStorage.getItem('tetrio-trainer-settings-v1')) localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)); }, instant);
});

async function drop(page: Page, text: string, name = 'config.ttc') {
  const transfer = await page.evaluateHandle(({ text, name }) => {
    const data = new DataTransfer(); data.items.add(new File([text], name, { type: 'application/json' })); return data;
  }, { text, name });
  await page.locator('body').dispatchEvent('dragover', { dataTransfer: transfer });
  await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}

test('the supplied TTC imports from the main file picker, persists and drives actual keys', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser'); await page.locator('#config-open').click();
  await (await chooser).setFiles(fixture);
  await expect(page.locator('#settings-status')).toContainText('TETR.IO config imported');
  await expect(page.locator('#arr')).toHaveValue('0'); await expect(page.locator('#das')).toHaveValue('5');
  await expect(page.locator('#dcd')).toHaveValue('2'); await expect(page.locator('#sdf')).toHaveValue('41');
  await expect(page.locator('#may20g')).toBeChecked(); await expect(page.locator('#safelock')).toBeChecked();
  await expect(page.locator('#bind-hardDrop')).toHaveText('Up'); await expect(page.locator('#bind-hold')).toHaveText('Space');
  await expect(page.locator('#ghostOpacity')).toHaveValue('80'); await expect(page.locator('#gridOpacity')).toHaveValue('50');
  await page.locator('#config-report summary').click();
  await expect(page.locator('#config-retained')).toContainText('volume.music');
  await expect(page.locator('#config-retained')).toContainText('video.graphics');
  await page.screenshot({ path: 'test-results/config-import.png', fullPage: true });
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.reload(); await page.locator('#start').click();
  await page.keyboard.press('ArrowUp'); await expect(page.locator('#pieces')).toHaveText('1');
  await page.keyboard.press('Space'); await expect(page.locator('#holds')).toHaveText('1');
  await page.keyboard.press('Escape');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
  const replay = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  expect(replay.settings.tetrioConfig).toEqual(JSON.parse(await readFile(fixture, 'utf8')));
  expect(replay.placements[0].inputs).toEqual(['hardDrop']);
  expect(errors).toEqual([]);
});

test('page drops pause gameplay, invalid files keep the draft, and cancel leaves saved settings intact', async ({ page }) => {
  await page.goto('/'); await page.locator('#start').click();
  await drop(page, await readFile(fixture, 'utf8'));
  await expect(page.locator('#settings-status')).toContainText('TETR.IO config imported');
  const time = await page.locator('#time').textContent();
  await page.waitForTimeout(120); await expect(page.locator('#time')).toHaveText(time!);
  await drop(page, '{broken');
  await expect(page.locator('#settings-status')).toContainText('Import failed');
  await expect(page.locator('#das')).toHaveValue('5');
  await expect(page.locator('body')).not.toHaveClass(/file-drag/);
  await page.locator('#cancel-settings').click();
  await page.locator('#settings-open').click(); await expect(page.locator('#das')).toHaveValue('6');
  await page.locator('#cancel-settings').click();
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1');
});

test('alternate movement keys stay held until the last physical key is released', async ({ page }) => {
  await page.goto('/');
  const native = JSON.parse(await readFile(fixture, 'utf8'));
  native.controls.custom.moveLeft = ['ARROWLEFT', 'KEYJ']; native.controls.custom.rotate180 = [];
  await drop(page, JSON.stringify(native));
  await expect(page.locator('#bind-moveLeft')).toHaveText('Left / J');
  await expect(page.locator('#bind-rotate180')).toHaveText('Unbound');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.locator('#start').click();
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('j'); await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(250); await page.keyboard.up('j'); await page.keyboard.press('ArrowUp');
  await expect(page.locator('#pieces')).toHaveText('1');
  const pending = page.waitForEvent('download'); await page.locator('#download').click();
  const replay = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(Math.min(...replay.placements[0].cells.map((cell: number[]) => cell[0]))).toBe(0);
  expect(replay.placements[0].inputs).toEqual(['moveLeft', 'hardDrop']);
});

test('the demonstration shows the full key-aware route before, during and after playback', async ({ page }) => {
  const game = new TrainerGame(instant, 942562); game.start();
  for (const key of ['moveRight', 'moveLeft', 'moveLeft', 'hardDrop'] as const) { game.input.press(key); game.step(); game.input.release(key); }
  await page.goto('/'); await drop(page, await readFile(fixture, 'utf8'));
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.locator('#replay-file').setInputFiles({ name: 'fault.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(game.export())) });
  await expect(page.locator('#practice-progress')).toHaveText('0 / 1');
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowUp']) { await page.keyboard.press(key); await page.waitForTimeout(25); }
  await expect(page.locator('#demo-popup')).toBeVisible();
  await expect(page.locator('#demo-steps li')).toHaveText(['Tap left (Left) once, then release.', 'Hard drop (Up) to lock in the outlined target.']);
  await expect(page.locator('#demo-summary')).toContainText('1 finesse input · 2 steps');
  await page.clock.install(); await page.locator('#demo-replay').click(); await page.clock.runFor(1200);
  await expect(page.locator('#demo-steps [aria-current="step"]')).toHaveText('Tap left (Left) once, then release.');
  await page.clock.runFor(1400);
  await expect(page.locator('#demo-step')).toContainText('Complete');
  await expect(page.locator('#demo-steps li')).toHaveCount(2);
  await page.clock.runFor(1900); await expect(page.locator('#demo-step')).toHaveText('Start here');
  await page.locator('#demo-replay').click(); await expect(page.locator('#demo-step')).toHaveText('Start here');
  await page.screenshot({ path: 'test-results/complete-guide.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#demo-popup').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/complete-guide-mobile.png', fullPage: true });
});

test('target outlines are gray and intersecting ghost outlines use a darker ghost color', async ({ page }) => {
  await page.goto('/');
  const pixels = await page.evaluate(async () => {
    const rendererPath = '/src/renderer.ts', enginePath = '/src/engine.ts', settingsPath = '/src/settings.ts', finessePath = '/src/finesse.ts';
    const { drawBoard } = await import(rendererPath), { createEngine } = await import(enginePath), { defaults } = await import(settingsPath), { copyPiece } = await import(finessePath);
    const engine = createEngine(defaults, 942562), canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 690;
    const piece = engine.falling.snapshot(), ghost = copyPiece(engine, piece); ghost.softDrop(engine.board.state);
    const cells = ghost.absoluteBlocks, [x, y] = cells[0];
    const pixel = (column: number, row: number) => [...canvas.getContext('2d')!.getImageData(column * 30 + 2, 90 + (19 - row) * 30 + 10, 1, 1).data];
    const options = { ...defaults.display, grid: false, ghostOpacity: .8 };
    drawBoard(canvas, engine, engine.board.state, piece, null, options); const shadow = pixel(x, y);
    drawBoard(canvas, engine, engine.board.state, piece, [cells[0], [0, 0]], options);
    const overlap = pixel(x, y), separateGhost = pixel(...cells[1]), target = pixel(0, 0);
    drawBoard(canvas, engine, engine.board.state, piece, [cells[0]], { ...options, ghost: false }); const noGhost = pixel(x, y);
    return { shadow, overlap, separateGhost, target, noGhost };
  });
  expect(pixels.target).toEqual([155, 155, 155, 255]); expect(pixels.noGhost).toEqual(pixels.target);
  expect(pixels.separateGhost).toEqual(pixels.shadow);
  for (let i = 0; i < 3; i++) expect(pixels.overlap[i]).toBeLessThan(pixels.shadow[i]);
  expect(pixels.overlap[0]).toBeGreaterThan(pixels.overlap[1]);
  expect(pixels.overlap[2]).toBeGreaterThan(pixels.overlap[0]);
});
