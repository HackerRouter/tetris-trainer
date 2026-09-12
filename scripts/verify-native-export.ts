import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { TrainerGame } from '../src/game.ts';
import { defaults, type GameAction } from '../src/settings.ts';
import { exportNative } from '../src/native-export.ts';

const archive = process.argv[2] ?? 'D:/CODE_PROJECT/TETRIO_OFFLINE/offline-data/archive';
const clientId = '7bf3f1ef242a69502cfd60d444e0a2a33d80b42b13eae7f79ba8e3f58c87ce2d';
const client = await readFile(join(archive, 'bodies', `${clientId}.bin`), 'utf8');
assert.ok(client.includes('class S extends k{') && client.includes('loadReplay:k,'), 'This check requires the archived 2026-07-14 client.');
const instrumented = client.replace('class S extends k{', 'window.__nativeTest={ReplayFile:B,Replay:L,Game:v};class S extends k{').replace('loadReplay:k,', 'loadReplay:(window.__nativeLoad=k),');
const tick = (game: TrainerGame, frames = 1) => { for (let i = 0; i < frames; i++) game.step(); };
const tap = (game: TrainerGame, key: GameAction) => { game.input.press(key); tick(game); game.input.release(key); tick(game); };
const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.training.undoEnabled = true;
const sprint = new TrainerGame(settings, 17); sprint.start();
tap(sprint, 'hardDrop'); tap(sprint, 'hold'); tap(sprint, 'moveLeft'); tap(sprint, 'hardDrop');
const retry = new TrainerGame(settings, 29); retry.start();
tap(retry, 'moveLeft'); tap(retry, 'moveRight'); tap(retry, 'hardDrop'); tap(retry, 'hardDrop');
tap(retry, 'hardDrop'); assert.equal(retry.undo(), true); tap(retry, 'moveRight'); tap(retry, 'hardDrop');
const customSettings = structuredClone(settings); customSettings.custom.gravity = 0; customSettings.custom.advanced.width = 4; customSettings.custom.advanced.height = 26; customSettings.custom.advanced.map = '##..\n##..';
const custom = new TrainerGame(customSettings, 17, undefined, 'custom'); custom.start(); tap(custom, 'moveRight'); tap(custom, 'hardDrop'); assert.equal(custom.engine.stats.lines, 2); tap(custom, 'hardDrop');
const cases = [['sprint-hold', sprint], ['retry-undo', retry], ['custom-map', custom]] as const;
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.route('**/*', async route => {
  const id = createHash('sha256').update(route.request().url()).digest('hex');
  try {
    const meta = JSON.parse(await readFile(join(archive, 'metadata', `${id}.json`), 'utf8'));
    const body = id === clientId ? Buffer.from(instrumented) : await readFile(join(archive, 'bodies', `${id}.bin`));
    await route.fulfill({ status: meta.status, headers: meta.headers, body });
  } catch { await route.fulfill({ status: 503, body: '' }); }
});
try {
  const page = await context.newPage();
  await page.goto('https://tetr.io/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__nativeLoad && !!(window as any).__nativeTest);
  await mkdir('TEMP', { recursive: true });
  const results: unknown[] = [];
  for (const [name, game] of cases) {
    const file = await exportNative(structuredClone(game.export()));
    const result = await page.evaluate(file => {
      const scope = window as any, { ReplayFile, Replay, Game } = scope.__nativeTest;
      const loaded = ReplayFile.Update(file);
      scope.__nativeLoad(loaded, { back: 'home' });
      const game = new Game('replay', { replay: new Replay(loaded.replay) });
      game.setGame(loaded.replay.options); game.setHeadless(true); game.startGame(); game.doAllFrames();
      return { stats: JSON.parse(JSON.stringify(game.state.stats)), board: JSON.parse(JSON.stringify(game.state.board)), results: document.getElementById('results_stats_overview')!.textContent };
    }, file);
    assert.ok(result.results?.includes('PIECES'), `${name}: result page loaded`);
    assert.equal(result.stats.piecesplaced, game.engine.stats.pieces, `${name}: piece count`);
    assert.equal(result.stats.lines, game.engine.stats.lines, `${name}: line count`);
    assert.deepEqual(result.board, [...game.engine.board.state].reverse().map(row => row.map(tile => tile?.mino ?? null)), `${name}: final board`);
    await writeFile(`TEMP/native-${name}.ttr`, JSON.stringify(file));
    results.push({ name, pieces: result.stats.piecesplaced, lines: result.stats.lines, boardMatches: true, loaderPassed: true });
    console.log(`PASS ${name}: native loader, ${result.stats.piecesplaced} pieces, ${result.stats.lines} lines and final board`);
  }
  await writeFile('TEMP/native-client-verification.json', JSON.stringify({ clientId, checkedAt: new Date().toISOString(), results }, null, 2));
} finally { await browser.close(); }
