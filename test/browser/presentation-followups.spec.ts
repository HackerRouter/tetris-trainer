import { test, expect, type Page } from '@playwright/test';
import { defaults } from '../../src/settings';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    localStorage.setItem('tetrio-trainer-opening-options-v1', JSON.stringify({ finesse: false, continuations: true, isomers: false }));
    const original = crypto.getRandomValues.bind(crypto); let calls = 0;
    Object.defineProperty(crypto, 'getRandomValues', { value: (view: any) => { if (view instanceof Uint32Array && view.length === 1 && calls++ < 2) { view[0] = 16; return view; } return original(view); } });
  }, { ...defaults, training: { ...defaults.training, countdownSeconds: 0, justThink: true } });
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__testCurrent = () => game; window.__replaceGame = value => game = value; window.__continuations = () => pages.opening.continuations;` });
  });
});

async function completeRoute(page: Page, opening: boolean) {
  return page.evaluate(opening => {
    const game = (window as any).__testCurrent();
    const scenes = opening ? game.practice.set.scenes : (window as any).__continuations().selected.steps.map((step: any) => step.scene);
    const tap = (action: string, frames = 1) => { game.input.press(action); for (let i = 0; i < frames; i++) game.step(); game.input.release(action); game.step(); };
    for (const scene of scenes) {
      if (scene.holdFirst) tap('hold');
      for (const move of scene.path.moves) {
        if (move === 'down') throw new Error('Unexpected finite soft drop fixture');
        if (move === 'dasLeft' || move === 'dasRight') tap(move === 'dasLeft' ? 'moveLeft' : 'moveRight', 25);
        else tap(move);
      }
      tap('hardDrop');
    }
    return { lines: game.engine.stats.lines, faults: game.faults, misses: game.targetMisses, pc: game.engine.board.perfectClear };
  }, opening);
}

test('MS2 automatically advances from a selected second-bag branch to a third-bag PC', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#openers'); await page.locator('#opener-search').fill('Mountainous Stacking 2');
  await page.locator('#opener-catalog .opener-card').click(); await page.locator('#opener-start').click();
  await expect(page.locator('#mode-label')).toHaveText('OPENER PRACTICE');
  expect((await completeRoute(page, true)).faults).toBe(0);
  await expect(page.locator('#continuation-routes')).toContainText('Setup B', { timeout: 20000 });
  await expect(page.locator('#continuation-goal option[value="pc"]')).toHaveCount(1);
  await page.locator('#continuation-routes button').filter({ hasText: 'Setup B' }).first().click();
  expect((await completeRoute(page, false)).lines).toBe(3);
  await expect(page.locator('#continuation-plan')).toContainText('perfect clear', { timeout: 20000 });
  await page.screenshot({ path: 'TEMP/ms2-pc-guidance.png', fullPage: true });
  const finish = await completeRoute(page, false); expect(finish).toEqual({ lines: 8, faults: 0, misses: 0, pc: true });
  await expect(page.locator('#continuation-status')).toContainText('Perfect clear complete');
  await expect(page.locator('#play-page .action-text-layer')).toHaveAttribute('aria-label', /ALL CLEAR/);
  await page.waitForTimeout(550); await page.screenshot({ path: 'TEMP/ms2-all-clear.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Stickspin is searchable, pinnable and has second-bag TSD instructions', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/#openers'); await page.locator('#opener-search').fill('Stickspin');
  await expect(page.locator('#opener-catalog .opener-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Shortlist: Stickspin', exact: true }).click();
  await page.locator('#opener-catalog .opener-card').click(); await page.locator('#opener-start').click();
  await expect(page.locator('#mode-label')).toHaveText('OPENER PRACTICE');
  expect((await completeRoute(page, true)).lines).toBe(1);
  await expect(page.locator('#continuation-route-name')).toContainText('Second Bag', { timeout: 15000 });
  await expect(page.locator('#continuation-plan')).toContainText('normal T-spin');
  await expect(page.locator('#continuation-source')).toHaveAttribute('href', 'https://harddrop.com/wiki/Stickspin');
  expect((await completeRoute(page, false)).lines).toBe(3);
  await expect(page.locator('#play-page .action-text-layer')).toHaveAttribute('aria-label', /T-spin.*DOUBLE.*BACK-TO-BACK/);
  await page.waitForTimeout(200); await page.screenshot({ path: 'TEMP/stickspin-tsd.png', fullPage: true });
});

test('correct-placement canvas shows the kicked rotation after soft drop and replays it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/finesse.ts'; const { copyPiece } = await import(path), game = (window as any).__testCurrent();
    game.engine.initiatePiece('t'); const snapshot = game.engine.snapshot(), piece = copyPiece(game.engine, snapshot.falling);
    piece.softDrop(snapshot.board); piece.rotate(snapshot.board, game.engine.kickTableName, 1, false); piece.softDrop(snapshot.board);
    game.demonstration = { id: 'kick', serial: 1, sceneNumber: 1, snapshot, target: piece.absoluteBlocks, path: { moves: ['softDrop', 'rotateCW'], cost: 1, source: 'extended', drop: 'soft' } };
  });
  await expect(page.locator('#demo-popup')).toBeVisible(); await page.clock.install(); await page.locator('#demo-replay').click();
  await page.clock.runFor(3450); await expect(page.locator('#demo-step')).toHaveText('Rotate CW');
  await page.screenshot({ path: 'TEMP/softdrop-kick-guide.png', fullPage: true });
  await page.clock.runFor(1500); await expect(page.locator('#demo-step')).toContainText('Complete');
  await page.locator('#demo-replay').click(); await expect(page.locator('#demo-step')).toHaveText('Start here');
});

test('all-clear text animates in live play and replay without extending the recorded timer', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const gamePath = '/src/game.ts', settingsPath = '/src/settings.ts';
    const { TrainerGame } = await import(gamePath), { defaults } = await import(settingsPath), settings = structuredClone(defaults);
    settings.training.countdownSeconds = 0; settings.custom.lineGoal = 2; settings.custom.finesse = false;
    settings.custom.advanced.map = '####..####\n####..####'; settings.custom.advanced.sequence = 'O';
    const game = new TrainerGame(settings, 1, undefined, 'custom'); game.start(); (window as any).__replaceGame(game);
  });
  await page.keyboard.press('Space');
  await expect(page.locator('#play-page .action-text-layer')).toHaveAttribute('aria-label', /DOUBLE.*ALL CLEAR/);
  const time = await page.locator('#time').textContent(); await page.waitForTimeout(400); expect(await page.locator('#time').textContent()).toBe(time);
  await page.getByRole('link', { name: 'Replays', exact: true }).click(); await page.locator('#player-current').click();
  await expect(page.locator('#player-status')).toHaveText('Ready.'); await page.locator('#player-play').click();
  await expect(page.locator('#player-tetrion .action-text-layer')).toHaveAttribute('aria-label', /ALL CLEAR/);
  const end = await page.locator('#player-time').textContent(); await page.waitForTimeout(450); expect(await page.locator('#player-time').textContent()).toBe(end);
  await page.screenshot({ path: 'TEMP/replay-all-clear.png', fullPage: true });
  await page.locator('#player-seek').fill('0'); await page.locator('#player-seek').dispatchEvent('input');
  await expect(page.locator('#player-tetrion .action-text-layer')).toHaveAttribute('aria-label', '');
});
