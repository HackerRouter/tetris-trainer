import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../../src/settings';
import { TrainerGame } from '../../src/game';

const suppliedPath = 'TEMP/DATA/sprint-training-1789183748709.json';
const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;

test('standalone conversion preserves the supplied 40L result and the player has no trailing retry time', async ({ page }) => {
  const source = JSON.parse(await readFile(suppliedPath, 'utf8'));
  await page.goto('/');
  const pending = page.waitForEvent('download'); await page.locator('#convert-replay-file').setInputFiles(suppliedPath);
  const download = await pending, file = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(download.suggestedFilename()).toMatch(/\.ttr$/); expect(file.replay.results.stats.lines).toBe(40); expect(file.replay.results.stats.piecesplaced).toBe(101);
  expect(file.replay.frames).toBe(1715); expect(file.replay.options.slot_counter5).toBe('finesse'); expect(file.trainer.training.result.faults).toBe(source.result.faults);
  await expect(page.locator('#conversion-status')).toContainText('Converted and verified');
  await page.getByRole('link', { name: 'Replays', exact: true }).click();
  for (const data of [source, file]) {
    await page.locator('#player-file').setInputFiles({ name: data === source ? 'sprint.json' : 'sprint.ttr', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await expect(page.locator('#player-status')).toHaveText('Ready.');
    expect(Number(await page.locator('#player-seek').getAttribute('max'))).toBeCloseTo(28.583333333333332, 6);
    await page.locator('#player-seek').focus(); await page.locator('#player-seek').press('End');
    await expect(page.locator('#player-time')).toHaveText('0:28.583 / 0:28.583'); await expect(page.locator('#player-pieces')).toHaveText('101'); await expect(page.locator('#player-lines')).toHaveText('40');
    await expect(page.locator('#player-hold-panel')).toBeVisible(); await expect(page.locator('#player-next-panel')).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/replay-native-40l.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a newly completed 40L session downloads through the actual export button', async ({ page }) => {
  const source = JSON.parse(await readFile(suppliedPath, 'utf8'));
  await page.route('**/src/main.ts', async route => {
    const response = await route.fetch(), body = await response.text();
    await route.fulfill({ response, body: `${body}\nwindow.__testSession = (settings, seed) => { game = new TrainerGame(settings, seed); game.start(); return game; };` });
  });
  await page.goto('/');
  const result = await page.evaluate(source => {
    const settings = structuredClone(source.settings); settings.training.countdownSeconds = 0; settings.training.justThink = false; settings.training.finesseEnabled = false;
    const game = (window as any).__testSession(settings, source.seed);
    let index = 0;
    for (let frame = 0; frame < source.timeline.frames; frame++) {
      while (index < source.events.length && source.events[index].frame === frame) {
        const event = source.events[index++];
        if (event.type === 'keydown') game.input.press(event.data.key, event.data.subframe);
        else if (event.type === 'keyup') game.input.release(event.data.key, event.data.subframe);
        else if (event.type === 'release-all') game.releaseAll();
      }
      game.step();
    }
    return { status: game.status, pieces: game.engine.stats.pieces, lines: game.engine.stats.lines, time: game.elapsedMs };
  }, source);
  expect(result.status).toBe('complete'); expect(result.lines).toBe(40); expect(result.pieces).toBe(101);
  await expect(page.locator('#overlay-value')).toHaveText('40 lines complete');
  const pending = page.waitForEvent('download'); await page.locator('#download-native').click();
  const file = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(file.replay.results.stats.finaltime).toBe(result.time); expect(file.replay.results.stats.lines).toBe(40);
  await expect(page.locator('#export-status')).toContainText('exported and verified');
});

test('replay audio plays accepted placements while seeking and muting remain silent', async ({ page }) => {
  const game = new TrainerGame(settings, 17); game.start(); for (let i = 0; i < 12; i++) game.step(); game.input.press('hardDrop'); game.step(); game.input.release('hardDrop'); for (let i = 0; i < 12; i++) game.step();
  const { sprites } = JSON.parse(await readFile('public/tetrio/sound-pack.json', 'utf8'));
  await page.addInitScript(settings => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings)); (window as any).soundCalls = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) { (window as any).soundCalls.push(offset); start.call(this, when, offset, duration); };
  }, { ...settings, audio: { ...settings.audio, ui: false } });
  await page.goto('/#replays'); await expect(page.locator('#audio-status')).toContainText('ready');
  await page.locator('#player-file').setInputFiles({ name: 'audio.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(game.export())) });
  await expect(page.locator('#player-status')).toHaveText('Ready.');
  await page.locator('#player-play').click(); await expect(page.locator('#player-pieces')).toHaveText('1');
  expect(await page.evaluate(() => (window as any).soundCalls)).toContain(sprites.harddrop.offset);
  await page.locator('#player-audio').uncheck(); await page.evaluate(() => { (window as any).soundCalls = []; });
  await page.locator('#player-seek').fill('0'); await page.locator('#player-play').click(); await expect(page.locator('#player-pieces')).toHaveText('1');
  expect(await page.evaluate(() => (window as any).soundCalls)).toEqual([]);
  await page.locator('#player-audio').check(); await page.locator('#player-seek').fill('0'); await page.locator('#player-forward').click();
  expect(await page.evaluate(() => (window as any).soundCalls)).toEqual([]);
});

test('line-clear glare changes only the rows being cleared', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/renderer.ts', enginePath = '/src/engine.ts', settingsPath = '/src/settings.ts', modesPath = '/src/modes.ts';
    const { drawScene } = await import(rendererPath), { createEngine } = await import(enginePath), { defaults } = await import(settingsPath), { modeDefinitions } = await import(modesPath);
    const rules = modeDefinitions.sprint.rules(defaults), engine = createEngine(defaults, 17, rules);
    const canvas = document.createElement('canvas'), hold = document.createElement('canvas'), next = document.createElement('canvas');
    const scene = { board: engine.board.state, piece: null, target: null, hold: null, holdLocked: false, next: [], effect: null };
    drawScene(canvas, hold, next, engine, rules, defaults.display, scene, 0);
    const before = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    drawScene(canvas, hold, next, engine, rules, defaults.display, { ...scene, effect: { rows: [0], cells: [], piece: 'i', hardDrop: false, lines: 1 } }, 0);
    const after = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let outside = 0, inside = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) { if (i < canvas.width * (canvas.height - 30) * 4) outside++; else inside++; }
    return { outside, inside };
  });
  expect(result.outside).toBe(0); expect(result.inside).toBeGreaterThan(0);
});
