import { test, expect, type Page } from '@playwright/test';
import { encoder, Field } from 'tetris-fumen';
import { defaults } from '../../src/settings';
import { TrainerGame } from '../../src/game';
import { analysisContext } from '../../src/analysis-context';
import { comboScene } from '../../src/combo-scenes';
import { changeSceneQueue } from '../../src/pc-scenes';

async function prepare(page: Page, seed?: number) {
  await page.route('**/src/main.ts', async route => {
    const response = await route.fetch(); let body = await response.text();
    if (seed !== undefined) body = body.replace('new TrainerGame(settings, undefined, undefined, selectedMode)', `new TrainerGame(settings, ${seed}, undefined, selectedMode)`);
    await route.fulfill({ response, body: body + '\nwindow.__currentGame = () => game;' });
  });
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0; settings.training.finesseEnabled = false; settings.training.undoEnabled = true;
  await page.addInitScript(settings => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => { if (event.data.result?.solver) (window as any).pcResult = event.data.result; });
      }
      postMessage(message: any) { if (message.solver) { (window as any).pcRequest = message; (window as any).pcRequests = ((window as any).pcRequests ?? 0) + 1; } super.postMessage(message); }
    } as typeof Worker;
  }, settings);
  await page.goto('/#pc');
  await page.locator('#pc-options').evaluate((element: HTMLDetailsElement) => element.open = true);
}
async function load(page: Page, rows = 'XXXXXX____XXXXXX____', queue = 'OO') {
  await page.locator('#pc-fumen-options').evaluate((element: HTMLDetailsElement) => element.open = true);
  await page.fill('#pc-fumen', encoder.encode([{ field: Field.create(rows) }]));
  await page.fill('#pc-fumen-queue', queue); await page.click('#pc-fumen-load');
  await expect(page.locator('#pc-status')).toContainText('Solved');
  await expect(page.locator('#pc-cancel')).toBeHidden();
}
async function playMoves(page: Page, moves: string[]) {
  const keys: Record<string,string> = { moveLeft: 'ArrowLeft', moveRight: 'ArrowRight', rotateCW: 'ArrowUp', rotateCCW: 'z', rotate180: 'a', softDrop: 'ArrowDown', hold: 'c' };
  for (const move of moves) {
    if (move === 'dasLeft' || move === 'dasRight') { const key = move === 'dasLeft' ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await page.waitForTimeout(160); await page.keyboard.up(key); }
    else { await page.keyboard.press(keys[move], { delay: 25 }); await page.waitForTimeout(25); }
  }
  await page.keyboard.press('Space'); await page.waitForTimeout(80);
}

test('PC Lab preserves the symmetric fullscreen board, previews routes and closes stale guides on restart', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 }); await prepare(page); await load(page);
  await expect(page.locator('#pc-routes button')).toHaveCount(2);
  await page.selectOption('#pc-learning', 'full');
  await expect(page.locator('#pc-plan li')).toHaveCount(2);
  const metrics = await page.evaluate(() => {
    const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const board = rect('#board'), left = rect('.workspace-left'), right = rect('.workspace-right');
    return { width: board.width, center: board.x + board.width / 2, left: left.width, right: right.width, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(metrics.width).toBe(520); expect(metrics.center).toBe(1280); expect(metrics.left).toBe(metrics.right); expect(metrics.overflow).toBe(false);
  await page.screenshot({ path: 'TEMP/m0-m1a-lab-fullscreen.png', fullPage: true });
  await page.click('#pc-practice'); await expect(page.locator('#demo-popup')).toBeVisible();
  await page.click('#start'); await expect(page.locator('#demo-popup')).toBeHidden(); await expect(page.locator('#pc-guide')).toBeHidden(); await expect(page.locator('#pc-routes button')).toHaveCount(0);
  await page.waitForTimeout(500); await expect(page.locator('#pc-guide')).toBeHidden();
});

test('guided PC restores a wrong piece and its time, then completes without keeping the old coach', async ({ page }) => {
  await prepare(page); await load(page);
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  await page.click('#pc-practice');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__currentGame().targetMisses)).toBe(1);
  await expect(page.locator('#pieces')).toHaveText('0'); await expect(page.locator('#time')).toHaveText('0:00.000');
  await expect(page.locator('#demo-popup')).toBeVisible();
  for (const step of route.steps) { if (step.scene.holdFirst) await page.keyboard.press('c'); await playMoves(page, step.scene.path.moves); }
  await expect(page.locator('#pc-status')).toContainText('Perfect clear complete'); await expect(page.locator('#demo-popup')).toBeHidden(); await expect(page.locator('#pc-guide')).toBeHidden();
  await page.goto('/#statistics'); await expect(page.locator('#pc-statistics')).toContainText('1 completed boards'); await expect(page.locator('#pc-statistics button').first()).toBeVisible();
});

test('PC searches and completes an eight-line board without a line-count control', async ({ page }) => {
  await prepare(page); await load(page, 'XXXXXXXX__'.repeat(8), 'OOOO');
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  expect(route.lines).toBe(8); expect(route.steps).toHaveLength(4);
  await expect(page.locator('#pc-scope')).toContainText('Any-line PC');
  await expect(page.locator('#pc-guide-title')).toContainText('8-line PC');
  await page.click('#pc-practice');
  for (const step of route.steps) await playMoves(page, step.scene.path.moves);
  await expect(page.locator('#pc-status')).toContainText('Perfect clear complete');
});

test('Any valid solution accepts the alternate order and no-hint mode reveals no candidate or target', async ({ page }) => {
  await prepare(page); await load(page);
  await page.selectOption('#pc-policy', 'any'); await page.selectOption('#pc-learning', 'none');
  await page.click('#pc-analyze'); await expect(page.locator('#pc-status')).toContainText('Solved'); await expect(page.locator('#pc-cancel')).toBeHidden();
  const route = await page.evaluate(() => (window as any).pcResult.routes.at(-1));
  await expect(page.locator('#pc-routes button')).toHaveCount(0);
  await page.click('#pc-practice'); await expect(page.locator('#demo-popup')).toBeHidden();
  for (const step of route.steps) { await playMoves(page, step.scene.path.moves); await expect(page.locator('#pc-cancel')).toBeHidden(); }
  await expect(page.locator('#pc-status')).toContainText('Perfect clear complete'); await expect(page.locator('#coach')).toBeHidden();
});

test('replay frame import uses the selected board and only its visible Next', async ({ page }) => {
  await prepare(page); await load(page, 'XXXXXXXX__XXXXXXXX__', 'OIJLSTZ');
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]); await page.click('#pc-practice');
  await playMoves(page, route.steps[0].scene.path.moves); await expect(page.locator('#pc-status')).toContainText('Perfect clear complete');
  await page.goto('/#replays'); await page.click('#player-current'); await expect(page.locator('#player-status')).toHaveText('Ready.');
  await page.click('#player-analyze'); await expect(page.locator('#pc-source')).toContainText('Replay frame 0');
  await expect(page.locator('#pc-information option[value=seeded]')).toHaveAttribute('disabled', '');
  const request = await page.evaluate(() => (window as any).pcRequest);
  expect(request.information).toBe('visible'); expect(request.position.next.length).toBeLessThanOrEqual(5);
});

test('PC defaults to the latest visible pack and full queue planning stays opt-in', async ({ page }) => {
  await prepare(page);
  await expect(page.getByRole('link', { name: 'PC', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#pc-information')).toHaveValue('pack');
  await expect(page.locator('#pc-time')).toHaveValue('15');
  await expect(page.locator('#pc-lines, #pc-depth')).toHaveCount(0);
  await page.click('#pc-analyze'); await expect.poll(() => page.evaluate(() => (window as any).pcRequest?.information)).toBe('pack');
  await expect(page.locator('#pc-scope')).toContainText('Latest visible pack');
  await page.selectOption('#pc-information', 'seeded'); await page.click('#pc-analyze');
  await expect.poll(() => page.evaluate(() => (window as any).pcRequest?.information)).toBe('seeded');
  await expect(page.locator('#pc-scope')).toContainText('Full queue planning');
  expect(await page.evaluate(() => (window as any).pcRequest.budget.milliseconds)).toBe(15000);
  await page.selectOption('#pc-time', '60'); await page.click('#pc-analyze');
  await expect.poll(() => page.evaluate(() => (window as any).pcRequest?.budget.milliseconds)).toBe(60000);
  expect(await page.evaluate(() => [(window as any).pcRequest.depth, (window as any).pcRequest.goal.lines])).toEqual([20, 0]);
  await page.selectOption('#pc-information', 'pack'); await page.click('#pc-analyze');
  await expect.poll(() => page.evaluate(() => (window as any).pcRequest?.information)).toBe('pack');
  await page.click('#start'); await expect(page.locator('#pc-routes button')).toHaveCount(0); await expect(page.locator('#pc-guide')).toBeHidden();
});

test('full queue planning finds an empty-board PC and a partial verified answer can start practice immediately', async ({ page }) => {
  await prepare(page);
  await page.selectOption('#pc-information', 'seeded');
  await page.locator('#pc-fumen-options').evaluate((element: HTMLDetailsElement) => element.open = true);
  await page.fill('#pc-fumen', encoder.encode([{ field: Field.create() }]));
  await page.fill('#pc-fumen-queue', 'OJILSTZTOLJ'); await page.click('#pc-fumen-load');
  await expect(page.locator('#pc-practice')).toBeEnabled({ timeout: 16000 });
  const result = await page.evaluate(() => (window as any).pcResult);
  expect(result.routes.length).toBeGreaterThan(0); expect(result.routes[0].steps).toHaveLength(10);
  await page.click('#pc-practice'); await expect(page.locator('#pc-status')).toContainText('Follow the selected route');
  await expect(page.locator('#pc-cancel')).toBeHidden(); await expect(page.locator('#pc-guide')).toBeVisible();
  await page.click('#start'); await expect(page.locator('#pc-guide')).toBeHidden();
});

test('scaled desktop keeps aligned controls and draws Hold and Next minos at board-cell size', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width: 1672, height: 850 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (['hold-preview','next-preview'].includes(this.canvas.id) && args.length === 9) {
        const matrix = this.getTransform(), size = args[7] * matrix.a * this.canvas.getBoundingClientRect().width / this.canvas.width;
        ((window as any).previewSizes ??= {})[this.canvas.id] = size;
      }
      return (original as any).apply(this, args);
    };
  });
  await prepare(page); await load(page); await page.click('#pc-practice');
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).previewSizes ?? {}).length)).toBe(2);
  const metrics = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect(), board = rect('#board');
    return { board: board.width, center: board.x + board.width / 2, left: rect('.workspace-left').width, right: rect('.workspace-right').width, minos: (window as any).previewSizes, controls: ['#pause','#undo','#redo'].map(selector => ({ top: rect(selector).top, height: rect(selector).height })), statSize: parseFloat(getComputedStyle(document.querySelector('#pieces')!).fontSize), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(metrics.board).toBeGreaterThan(250); expect(metrics.center).toBeCloseTo(836, 1); expect(metrics.left).toBeCloseTo(metrics.right, 1);
  for (const size of Object.values(metrics.minos) as number[]) expect(size).toBeCloseTo(metrics.board / 10, 1);
  expect(metrics.controls[0]).toEqual(metrics.controls[1]); expect(metrics.controls[1]).toEqual(metrics.controls[2]); expect(metrics.statSize).toBeGreaterThanOrEqual(36); expect(metrics.overflow).toBe(false);
  await page.screenshot({ path: 'TEMP/m0-m1a-scaled-desktop.png', fullPage: true });
  await context.close();
});

test('Any valid solution retries only a proven dead end and advisory permits the same placement', async ({ page }) => {
  await prepare(page); await load(page); await page.selectOption('#pc-policy', 'any'); await page.selectOption('#pc-learning', 'none');
  await page.click('#pc-analyze'); await expect(page.locator('#pc-status')).toContainText('Solved'); await expect(page.locator('#pc-cancel')).toBeHidden(); await page.click('#pc-practice');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__currentGame().analysisMistakes)).toBe(1);
  await expect(page.locator('#pieces')).toHaveText('0'); await expect(page.locator('#time')).toHaveText('0:00.000'); await expect(page.locator('#demo-popup')).toBeHidden(); await expect(page.locator('#coach')).toBeHidden();
  await page.selectOption('#pc-policy', 'advisory'); await page.click('#pc-analyze'); await expect(page.locator('#pc-status')).toContainText('Solved'); await expect(page.locator('#pc-cancel')).toBeHidden(); await page.click('#pc-practice');
  await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('1'); await expect(page.locator('#pc-cancel')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__currentGame().analysisMistakes)).toBe(0);
});


test('coverage requires explicit assumptions for imported queues and clears on a board change', async ({ page }) => {
  await prepare(page); await load(page, 'XXXXXXXX__XXXXXXXX__', 'O');
  await page.locator('#pc-coverage').evaluate((e: HTMLDetailsElement) => e.open = true);
  await page.click('#coverage-run'); await expect(page.locator('#coverage-status')).toContainText('no known future pack boundary');
  await page.selectOption('#coverage-model','custom'); await page.fill('#coverage-remaining','IJ'); await page.fill('#coverage-draws','1');
  await page.click('#coverage-run'); await expect(page.locator('#coverage-status')).toContainText('Finished');
  await expect(page.locator('#coverage-result')).toContainText('100.0%'); await expect(page.locator('#coverage-result')).toContainText('Finite-Next policy lower bound');
  await page.click('#start'); await expect(page.locator('#coverage-result')).toBeEmpty();
});

test('continuous PC retains the real finite queue and Hold and waits for input', async ({ page }) => {
  await prepare(page); await load(page, 'XXXXXXXX__XXXXXXXX__', 'OIIIIIIIIIII');
  await page.check('#pc-chain');
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  await page.click('#pc-practice'); await playMoves(page, route.steps[0].scene.path.moves);
  await expect.poll(() => page.evaluate(() => (window as any).pcRequest.position.board.flat().filter(Boolean).length)).toBe(0);
  await expect(page.locator('#pc-name')).toHaveValue('Continuous PC');
  const current = await page.evaluate(() => ({ request:(window as any).pcRequest, waiting:(window as any).__currentGame().waitingForInput, records:JSON.parse(localStorage.getItem('tetrio-trainer-pc-library-v1')!).records }));
  expect(current.request.position.falling.symbol).toBe('i'); expect(current.request.position.next.every((p:string)=>p==='i')).toBe(true); expect(current.waiting).toBe(true); expect(current.records[0].solved).toBe(true);
});

test('PCO variants load through the scene controls without changing the symmetric layout', async ({ page }) => {
  await prepare(page); await page.locator('#pc-scenes').evaluate((e: HTMLDetailsElement)=>e.open=true);
  await page.selectOption('#pc-pack','3'); await page.click('#pc-pack-load');
  await expect(page.locator('#pc-name')).toHaveValue('PCO I placed mirrored'); await expect(page.locator('#pc-source')).toContainText('fresh second bag');
  expect(await page.evaluate(() => (window as any).__currentGame().engine.board.state.flat().filter(Boolean).length)).toBe(28);
});


test('Combo goal shows exact clear and combo counts and completes guided practice', async ({ page }) => {
  await page.setViewportSize({width:2560,height:1600}); await prepare(page); await load(page, 'XXXXXXXX__'.repeat(4), 'OO');
  await page.getByRole('link', { name: 'Combo', exact: true }).click(); await page.click('#pc-analyze');
  await expect(page.locator('#pc-cancel')).toBeHidden(); await expect(page.locator('#pc-scope')).toContainText('Proven best within scope: 2 consecutive clears');
  await expect(page.locator('#pc-guide-title')).toContainText('2 consecutive clears / Combo 1');
  await expect(page.locator('#mode-select option:checked')).toHaveText('Combo Lab');
  const layout=await page.evaluate(()=>{const r=(s:string)=>document.querySelector(s)!.getBoundingClientRect(); return {left:r('.workspace-left').width,right:r('.workspace-right').width,width:r('#board').width,center:r('#board').x+r('#board').width/2,overflow:document.documentElement.scrollWidth>innerWidth};});
  expect(layout.left).toBe(layout.right); expect(layout.width).toBe(520); expect(layout.center).toBe(1280); expect(layout.overflow).toBe(false);
  await page.screenshot({path:'TEMP/m2-combo-fullscreen.png',fullPage:true});
  const route=await page.evaluate(()=>(window as any).pcResult.routes[0]); await page.click('#pc-practice');
  for(const step of route.steps) await playMoves(page,step.scene.path.moves);
  await expect(page.locator('#pc-status')).toContainText('Combo route complete'); await expect(page.locator('#pc-guide')).toBeHidden();
});

test('Any combo continuation restores an avoidable break and saves the original board', async ({ page }) => {
  await prepare(page); await load(page,'XXXXXXXX__'.repeat(4),'OO');
  await page.getByRole('link', { name: 'Combo', exact: true }).click(); await page.selectOption('#pc-policy','any'); await page.click('#pc-analyze');
  await expect(page.locator('#pc-cancel')).toBeHidden(); await page.click('#pc-practice'); await page.keyboard.press('Space');
  await expect(page.locator('#combo-feedback')).toContainText('Only this piece and its timer were restored');
  await expect(page.locator('#pieces')).toHaveText('0'); await expect(page.locator('#time')).toHaveText('0:00.000');
  expect(await page.evaluate(()=>(window as any).__currentGame().faults)).toBe(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tetrio-trainer-pc-library-v1')!).scenes.some((s:any)=>s.source.includes('Avoidable combo break')))).toBe(true);
});

test('Combo terrain selects actual native dimensions and attack stays explicitly bounded', async ({ page }) => {
  await prepare(page); await page.getByRole('link', { name: 'Combo', exact: true }).click();
  await page.locator('#pc-scenes').evaluate((e:HTMLDetailsElement)=>e.open=true); await page.click('#combo-load');
  await expect(page.locator('#pc-scope')).toContainText('Native four-column board');
  expect(await page.evaluate(()=>(window as any).__currentGame().engine.board.width)).toBe(4);
  await page.selectOption('#lab-objective','attack'); await page.click('#pc-analyze');
  await expect(page.locator('#pc-scope')).toContainText('Best found');
  await page.selectOption('#lab-objective','combo');
  await expect(page.locator('#pc-guide')).toBeHidden();
});

for (const goal of ['pc', 'combo', 'attack'] as const) for (const policy of ['hints', 'advisory', 'any'] as const) {
  test(`${goal} keeps the full route after each matching placement with ${policy}`, async ({ page }) => {
    await prepare(page); await load(page, 'XXXXXXXX__'.repeat(6), 'OOO');
    if (goal !== 'pc') await page.getByRole('link', { name: 'Combo', exact: true }).click();
    if (goal === 'attack') await page.selectOption('#lab-objective', 'attack');
    if (policy !== 'hints') await page.selectOption('#pc-policy', policy);
    await page.click('#pc-analyze'); await expect(page.locator('#pc-cancel')).toBeHidden();
    const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
    expect(route.steps).toHaveLength(3);
    if (policy !== 'hints') await page.click('#pc-practice');
    else await page.click('#board');
    const searches = await page.evaluate(() => (window as any).pcRequests);
    for (let i = 0; i < route.steps.length; i++) {
      const step = route.steps[i];
      if (step.scene.holdFirst) await page.keyboard.press('c');
      await playMoves(page, step.scene.path.moves);
      await expect(page.locator('#pieces')).toHaveText(String(i + 1));
      if (i + 1 < route.steps.length) {
        await expect(page.locator('#pc-status')).toContainText('No new search needed');
        await expect(page.locator('#pc-step')).toContainText(`Preview ${i + 2} / 3`);
        await expect(page.locator('#pc-guide')).toBeVisible();
        expect(await page.evaluate(() => (window as any).__currentGame().target)).toEqual(route.steps[i + 1].scene.target);
      }
      expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
      await expect(page.locator('#pc-cancel')).toBeHidden();
    }
    await expect(page.locator('#pc-status')).toContainText(goal === 'pc' ? 'Perfect clear complete' : 'Combo route complete');
    await expect(page.locator('#pc-guide')).toBeHidden();
  });
}

test('PC and Combo have distinct navigation, goals and stale-guide lifecycles', async ({ page }) => {
  await prepare(page); await load(page);
  await expect(page.locator('#lab-objective')).toBeHidden();
  await page.getByRole('link', { name: 'Combo', exact: true }).click();
  await expect(page).toHaveURL(/#combo$/);
  await expect(page.getByRole('link', { name: 'Combo', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#lab-objective option')).toHaveCount(2);
  await expect(page.locator('#pc-guide')).toBeHidden();
  await page.selectOption('#lab-objective', 'attack'); await page.click('#pc-analyze');
  await expect(page.locator('#pc-guide')).toBeVisible();
  await page.getByRole('link', { name: 'PC', exact: true }).click();
  await expect(page.getByRole('link', { name: 'PC', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#lab-objective')).toHaveValue('pc');
  await expect(page.locator('#pc-guide')).toBeHidden();
  await page.getByRole('link', { name: 'Combo', exact: true }).click();
  await expect(page.locator('#lab-objective')).toHaveValue('attack');
  await page.reload(); await expect(page.locator('#lab-title')).toHaveText('Combo Lab');
});

test('advisory PC restores its legal Hold plan and checkpoint timer on undo', async ({ page }) => {
  await prepare(page);
  await page.locator('#pc-fumen-options').evaluate((element: HTMLDetailsElement) => element.open = true);
  await page.fill('#pc-fumen', encoder.encode([{ field: Field.create('XXXXXXXX__'.repeat(4)) }]));
  await page.fill('#pc-fumen-queue', 'IOO'); await page.click('#pc-fumen-load');
  await expect(page.locator('#pc-cancel')).toBeHidden();
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  expect(route.steps[0].scene.holdFirst).toBe(true);
  const searches = await page.evaluate(() => (window as any).pcRequests);
  await page.evaluate(() => {
    const game = (window as any).__currentGame();
    game.engine.events.on('falling.new', ({ isHold }: { isHold: boolean }) => { if (isHold) (window as any).holdCheckpointTime = game.elapsedMs; });
  });
  await page.keyboard.press('c'); await expect(page.locator('#pc-guide')).toBeVisible();
  await expect(page.locator('#demo-board')).toBeVisible();
  await playMoves(page, route.steps[0].scene.path.moves);
  await expect(page.locator('#pc-step')).toContainText('Preview 2 / 2');
  expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
  const checkpointTime = await page.evaluate(() => (window as any).holdCheckpointTime);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#pc-guide')).toBeVisible();
  await expect(page.locator('#demo-popup')).toBeVisible();
  await expect(page.locator('#pc-step')).toContainText('Preview 1 / 2');
  await expect(page.locator('#pc-status')).toContainText('Selected route restored');
  expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
  expect(await page.evaluate(() => (window as any).__currentGame().elapsedMs)).toBe(checkpointTime);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).__currentGame().elapsedMs)).toBe(checkpointTime);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#pc-step')).toContainText('Preview 2 / 2');
  await expect(page.locator('#pc-status')).toContainText('Selected route restored');
  expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
});

for (const objective of ['pc','combo','attack']) for (const practice of [false,true]) test(`${objective} ${practice?'advisory practice':'hints'} restores the previous route after a wrong placement and undo`, async ({ page }) => {
  await prepare(page);
  if (objective!=='pc') { await page.getByRole('link',{name:'Combo',exact:true}).click(); await page.selectOption('#lab-objective',objective); }
  if (practice) await page.selectOption('#pc-policy','advisory');
  await load(page,'XXXXXXXX__'.repeat(6),'OOO');
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  if (practice) await page.click('#pc-practice');
  await playMoves(page,route.steps[0].scene.path.moves); await expect(page.locator('#pc-step')).toContainText('Preview 2 / 3');
  const checkpointTime = await page.evaluate(() => (window as any).__currentGame().elapsedMs);
  await playMoves(page,['dasLeft']);
  expect(await page.evaluate(() => (window as any).__currentGame().placements.at(-1).accepted)).toBe(true);
  const searches = await page.evaluate(() => (window as any).pcRequests);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#pc-step')).toContainText('Preview 2 / 3'); await expect(page.locator('#demo-board')).toBeVisible();
  await expect(page.locator('#pc-status')).toContainText('Selected route restored');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
  expect(await page.evaluate(() => (window as any).__currentGame().elapsedMs)).toBe(checkpointTime);
  for (const step of route.steps.slice(1)) await playMoves(page,step.scene.path.moves);
  await expect(page.locator('#pc-status')).toContainText(objective==='pc'?'Perfect clear complete':'Combo route complete');
  expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
});

for (const policy of ['guided','any']) test(`Combo undo restores ${policy} practice without counting the undone clear twice`, async ({ page }) => {
  await prepare(page); await page.getByRole('link',{name:'Combo',exact:true}).click(); await page.selectOption('#pc-policy',policy);
  await load(page,'XXXXXXXX__'.repeat(6),'OOO');
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  await page.click('#pc-practice'); const searches = await page.evaluate(() => (window as any).pcRequests);
  await playMoves(page,route.steps[0].scene.path.moves); await page.keyboard.press('Control+z');
  await expect(page.locator('#pc-step')).toContainText('Preview 1 / 3');
  expect(await page.evaluate(() => (window as any).__currentGame().analysisPolicy)).toBe(policy);
  for (let i=0;i<route.steps.length;i++) {
    await playMoves(page,route.steps[i].scene.path.moves);
    if (i<route.steps.length-1) await expect(page.locator('#pc-step')).toContainText(`Preview ${i+2} / 3`);
  }
  await expect(page.locator('#pc-status')).toContainText('Combo route complete');
  expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
});

test('undo automatically analyzes an earlier board when the saved route starts later', async ({ page }) => {
  await prepare(page); await load(page,'XXXXXXXX__'.repeat(6),'OOO');
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  await playMoves(page,route.steps[0].scene.path.moves); await page.click('#pc-analyze'); await expect(page.locator('#pc-cancel')).toBeHidden();
  const searches = await page.evaluate(() => (window as any).pcRequests);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).pcRequests)).toBe(searches+1);
  await expect(page.locator('#pc-status')).toContainText('Solved'); await expect(page.locator('#pc-cancel')).toBeHidden();
  await expect(page.locator('#pc-step')).toContainText('Preview 1 / 3');
});

test('undo restores any-solution practice while keeping its no-hint preference', async ({ page }) => {
  await prepare(page); await page.selectOption('#pc-policy','any'); await page.selectOption('#pc-learning','none');
  await load(page,'XXXXXXXX__'.repeat(4),'OO'); const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  await page.click('#pc-practice'); await playMoves(page,route.steps[0].scene.path.moves);
  const searches = await page.evaluate(() => (window as any).pcRequests); await page.keyboard.press('Control+z');
  await expect(page.locator('#pc-status')).toContainText('Selected route restored');
  await expect(page.locator('#pc-guide')).toBeHidden(); await expect(page.locator('#demo-popup')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__currentGame().hideAnalysisTarget)).toBe(true);
  expect(await page.evaluate(() => (window as any).__currentGame().analysisPolicy)).toBe('any');
  expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
});

for (const setup of [true, false]) test(`Combo keeps a ${setup ? 'setup placement' : 'final known Hold'} in its existing route`, async ({ page }) => {
  await prepare(page); await page.getByRole('link', { name: 'Combo', exact: true }).click();
  await page.locator('#pc-fumen-options').evaluate((element: HTMLDetailsElement) => element.open = true);
  await page.fill('#pc-fumen', encoder.encode([{ field: Field.create(setup ? '____XXXXXX'.repeat(2) : 'XXXXXXXX__'.repeat(4)) }]));
  await page.fill('#pc-fumen-queue', setup ? 'OO' : 'O'); await page.selectOption('#pc-fumen-hold', setup ? '-' : 'O');
  await page.click('#pc-fumen-load'); await expect(page.locator('#pc-cancel')).toBeHidden();
  await expect(page.locator('#pc-information')).toBeHidden();
  expect(await page.evaluate(() => [(window as any).pcRequest.information,(window as any).pcRequest.position.next.length])).toEqual(['seeded',setup?1:0]);
  const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
  expect(route.steps).toHaveLength(2);
  if (setup) expect(route.steps[0].lines).toBe(0); else expect(route.steps[1].unknownCurrent).toBe(true);
  const searches = await page.evaluate(() => (window as any).pcRequests);
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i].scene.holdFirst) await page.keyboard.press('c');
    await playMoves(page, route.steps[i].scene.path.moves);
    if (!i) { await expect(page.locator('#pc-step')).toContainText('Preview 2 / 2'); await expect(page.locator('#pc-status')).toContainText('No new search needed'); }
    expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
  }
  await expect(page.locator('#pc-status')).toContainText('Combo route complete');
});

for (const columns of [4, 10]) for (const viewport of [{ width: 1200, height: 1000 }, { width: 2560, height: 1600 }]) {
  test(`${columns}-column Combo previews keep their scale after movement and placement at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await prepare(page);
    await page.getByRole('link', { name: 'Combo', exact: true }).click();
    if (columns === 4) {
      const game = new TrainerGame(defaults, 17);
      const scene = changeSceneQueue(comboScene(analysisContext(game.rules, game.settings, game.engine.snapshot({ isUndoRedo: true })), 'native', 0, 17), 'OOO');
      scene.context.snapshot.board.forEach((row, y) => row.fill(null).forEach((_, x) => { if (y < 6 && x < 2) row[x] = { mino: 'gb' as any, connections: 0 }; }));
      scene.objective = 'combo';
      await page.locator('#pc-scenes').evaluate((element: HTMLDetailsElement) => element.open = true);
      await page.locator('#pc-file').setInputFiles({ name: 'narrow-combo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, scenes: [scene], records: [] })) });
      await page.selectOption('#pc-saved', scene.id); await page.click('#pc-load');
      await expect(page.locator('#pc-status')).toContainText('Solved');
    } else await load(page, 'XXXXXXXX__'.repeat(6), 'OOO');
    await expect(page.locator('#pc-cancel')).toBeHidden();
    const route = await page.evaluate(() => (window as any).pcResult.routes[0]);
    await page.click('#pc-practice'); await expect(page.locator('#demo-board')).toBeVisible();
    const metrics = () => page.evaluate(() => {
      const canvas = [...document.querySelectorAll<HTMLCanvasElement>('#demo-board, #pc-preview')].find(element => element.checkVisibility())!;
      const rect = canvas.getBoundingClientRect(), fit = getComputedStyle(canvas).objectFit;
      const scale = fit === 'contain' ? Math.min(rect.width / canvas.width, rect.height / canvas.height) : rect.width / canvas.width;
      const board = document.querySelector('#board')!.getBoundingClientRect();
      return { id: canvas.id, width: rect.width, height: rect.height, cell: canvas.width / (window as any).__currentGame().engine.board.width * scale, boardWidth: board.width, boardCenter: board.x + board.width / 2, zoom: visualViewport!.scale };
    });
    const initial = await metrics();
    await playMoves(page, route.steps[0].scene.path.moves);
    await expect(page.locator('#pc-step')).toContainText('Preview 2 / 3');
    await expect(page.locator('#demo-board')).toBeVisible();
    const placed = await metrics();
    const serial = await page.evaluate(() => (window as any).__currentGame().demonstration.serial);
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) {
      await page.keyboard.press(key, { delay: 25 });
      await expect(page.locator('#demo-board')).toBeVisible(); await expect(page.locator('#pc-preview')).toBeHidden();
      expect(await page.evaluate(() => (window as any).__currentGame().demonstration.serial)).toBe(serial);
    }
    await page.click('#pc-static');
    await expect(page.locator('#demo-popup')).toBeHidden(); await expect(page.locator('#pc-preview')).toBeVisible();
    await page.keyboard.press('ArrowUp', { delay: 25 }); await expect(page.locator('#pc-preview')).toBeVisible();
    const moved = await metrics();
    await testInfo.attach('preview-metrics', { body: JSON.stringify({ initial, placed, moved }, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: `TEMP/combo-preview-${columns}-${viewport.width}.png`, fullPage: true });
    expect(placed.cell).toBeCloseTo(initial.cell, 1);
    expect(moved.height).toBeCloseTo(initial.height, 1); expect(moved.cell).toBeCloseTo(initial.cell, 1);
    expect(moved.width).toBeCloseTo(initial.width, 1); expect(moved.zoom).toBe(initial.zoom);
    expect(moved.boardWidth).toBe(initial.boardWidth); expect(moved.boardCenter).toBe(initial.boardCenter);
    await page.click('#pc-animate'); await expect(page.locator('#demo-board')).toBeVisible();
    await page.click('#demo-close'); await expect(page.locator('#pc-preview')).toBeVisible();
    expect((await metrics()).cell).toBeCloseTo(initial.cell, 1);
  });
}

for (const objective of ['combo','attack']) for (const information of ['pack','visible']) test(`fresh Sprint ${objective} always plans a full sequence regardless of PC ${information} access`, async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await prepare(page,17); await page.selectOption('#pc-information',information); await page.getByRole('link', { name: 'Combo', exact: true }).click();
  await expect(page.locator('#pc-information')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__currentGame().seed)).toBe(17);
  expect(await page.evaluate(() => (window as any).__currentGame().engine.board.state.flat().some(Boolean))).toBe(false);
  await page.selectOption('#lab-objective', objective); await page.selectOption('#pc-time', information==='pack'?'15':'5');
  await page.click('#pc-analyze'); await expect(page.locator('#pc-cancel')).toBeHidden({ timeout:25000 });
  await expect(page.locator('#pc-status')).toContainText('Solved'); await expect(page.locator('#pc-scope')).toContainText('Best found');
  const result = await page.evaluate(() => (window as any).pcResult), route = result.routes[0];
  expect(route.combo.setup).toBeGreaterThan(2); expect(result.complete).toBe(false);
  expect(await page.evaluate(() => [(window as any).pcRequest.depth,(window as any).pcRequest.information,(window as any).pcRequest.position.next.length])).toEqual([60,'seeded',60]);
  expect(route.steps.length).toBeLessThanOrEqual(60);
  if(information==='pack')expect(route.steps.length).toBeGreaterThan(20);
  if(objective==='combo'&&information==='pack') expect(route.combo.clears).toBeGreaterThanOrEqual(10);
  await testInfo.attach('opening-result', { body: JSON.stringify({ objective, information, elapsedMs:result.elapsedMs, checked:result.checked, route:route.combo, steps:route.steps.map((step:any)=>({piece:step.piece,lines:step.lines,hold:step.scene.holdFirst})) }), contentType:'application/json' });
  await page.click('#pc-practice'); const searches = await page.evaluate(() => (window as any).pcRequests);
  await page.screenshot({ path:`TEMP/combo-opening-${objective}-${information}.png`,fullPage:true });
  for (let i=0;i<route.steps.length;i++) {
    if (!i) await page.click('#pc-static');
    if (route.steps[i].scene.holdFirst) await page.keyboard.press('c');
    await playMoves(page,route.steps[i].scene.path.moves);
    expect(await page.evaluate(() => (window as any).__currentGame().placements.at(-1)?.accepted)).toBe(true);
    expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
    if (i<route.steps.length-1) {
      await expect(page.locator('#pc-step')).toContainText(`Preview ${i+2} / ${route.steps.length}`);
      await expect(page.locator('#demo-board')).toBeVisible();
    }
    if (i===21) {
      await page.keyboard.press('Control+z');
      await expect(page.locator('#pc-step')).toContainText(`Preview ${i+1} / ${route.steps.length}`);
      await expect(page.locator('#pc-status')).toContainText('Selected route restored');
      await expect(page.locator('#demo-board')).toBeVisible();
      expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
      await page.keyboard.press('Control+Shift+z');
      await expect(page.locator('#pc-step')).toContainText(`Preview ${i+2} / ${route.steps.length}`);
      await expect(page.locator('#pc-status')).toContainText('Selected route restored');
      expect(await page.evaluate(() => (window as any).pcRequests)).toBe(searches);
    }
  }
  await expect(page.locator('#pc-status')).toContainText('Combo route complete'); await expect(page.locator('#demo-popup')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__currentGame().faults)).toBe(0);
  await page.getByRole('link',{name:'PC',exact:true}).click();
  await expect(page.locator('#pc-information')).toBeVisible();
  await expect(page.locator('#pc-information')).toHaveValue(information);
});
