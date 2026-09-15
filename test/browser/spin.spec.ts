import { test, expect, type Page } from '@playwright/test';
import { encoder, Field } from 'tetris-fumen';
import { defaults, type Settings } from '../../src/settings';

async function prepare(page:Page,training:Partial<Settings['training']>={}) {
  await page.route('**/src/main.ts',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__spinGame = () => game; window.__spinLab = pages.spin;'});});
  await page.addInitScript(settings=>{
    localStorage.setItem('tetrio-trainer-settings-v1',JSON.stringify(settings));
    const Original=window.Worker;window.Worker=class extends Original{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(event.data.result?.solver==='spin-1.0.0'&&event.data.result.sessionId!=='spin-automatic')(window as any).spinResult=event.data.result;});}postMessage(message:any){if(message.solver==='spin-1.0.0'&&message.base.sessionId!=='spin-automatic'){(window as any).spinRequest=message;(window as any).spinRequests=((window as any).spinRequests??0)+1;}super.postMessage(message);}} as typeof Worker;
  },{...defaults,training:{...defaults.training,countdownSeconds:0,undoEnabled:true,finesseEnabled:false,...training}});
  await page.goto('/#spin');
}
async function drill(page:Page,id='tsd') {await page.locator('#spin-drills').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.selectOption('#spin-drill',id);await page.click('#spin-load-drill');await expect(page.locator('#spin-status')).toContainText('Solved');await expect(page.locator('#spin-cancel')).toBeHidden();}
async function play(page:Page,step:any) {
  if(step.scene.holdFirst)await page.keyboard.press('c');
  const keys:Record<string,string>={rotateCW:'ArrowUp',rotateCCW:'z',rotate180:'a',moveLeft:'ArrowLeft',moveRight:'ArrowRight',softDrop:'ArrowDown'};
  for(const move of step.scene.path.moves){if(move==='dasLeft'||move==='dasRight'){const key=move==='dasLeft'?'ArrowLeft':'ArrowRight';await page.keyboard.down(key);await page.waitForTimeout(160);await page.keyboard.up(key);}else{await page.keyboard.press(keys[move],{delay:35});await page.waitForTimeout(35);}}
  await page.keyboard.press('Space');await page.waitForTimeout(60);
}
async function fumen(page:Page,rows:string,queue:string,depth='1') {await page.locator('#spin-options').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.selectOption('#spin-depth',depth);await page.selectOption('#spin-piece','t');await page.selectOption('#spin-lines','2');await page.locator('#spin-fumen-options').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.fill('#spin-fumen',encoder.encode([{field:Field.create(rows)}]));await page.fill('#spin-fumen-queue',queue);await page.click('#spin-fumen-load');await expect(page.locator('#spin-status')).toContainText('Solved',{timeout:20000});await expect(page.locator('#spin-cancel')).toBeHidden();}

test('Spin has its own symmetric C page, displays a single two-line T-spin and clears stale guidance',async({page})=>{
  await page.setViewportSize({width:2560,height:1600});await prepare(page);await drill(page);
  await expect(page.getByRole('link',{name:'Spin',exact:true})).toHaveAttribute('aria-current','page');await expect(page.locator('#pc-lab')).toBeHidden();await expect(page.locator('#spin-guide-title')).toHaveText('T-spin Double');await expect(page.locator('#spin-step')).toContainText('Step 1 / 1');
  const geometry=await page.evaluate(()=>{const rect=(s:string)=>document.querySelector(s)!.getBoundingClientRect(),board=rect('#board');return {width:board.width,center:board.x+board.width/2,left:rect('.workspace-left').width,right:rect('.workspace-right').width,overflow:document.documentElement.scrollWidth>innerWidth};});expect(geometry).toEqual({width:520,center:1280,left:660,right:660,overflow:false});
  await page.screenshot({path:'TEMP/M3-spin-fullscreen.png',fullPage:true});
  await page.keyboard.press('ArrowLeft');await expect(page.locator('#demo-popup')).toBeVisible();await page.click('#spin-static');await expect(page.locator('#demo-popup')).toBeHidden();await expect(page.locator('#spin-preview')).toBeVisible();
  await page.click('#start');await expect(page.locator('#spin-guide')).toBeHidden();await expect(page.locator('#demo-popup')).toBeHidden();
  await page.getByRole('link',{name:'Combo',exact:true}).click();await expect(page.locator('#spin-lab')).toBeHidden();await expect(page.locator('#lab-title')).toHaveText('Combo Lab');
});

test('guided Spin restores the wrong piece and timer, accepts a TSD and removes the old coach',async({page})=>{
  await prepare(page);await drill(page);const route=await page.evaluate(()=>(window as any).spinResult.routes[0]);await page.click('#spin-practice');await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>(window as any).__spinGame().targetMisses)).toBe(1);await expect(page.locator('#pieces')).toHaveText('0');await expect(page.locator('#time')).toHaveText('0:00.000');await expect(page.locator('#demo-popup')).toBeVisible();
  await play(page,route.steps[0]);await expect(page.locator('#spin-outcome')).toContainText('Goal complete');await expect(page.locator('#lines')).toHaveText('2');await expect(page.locator('#demo-popup')).toBeHidden();await expect(page.locator('#spin-guide')).toBeHidden();await page.locator('.page-nav a[href="#statistics"]').click();await expect(page.locator('#spin-statistics')).toContainText('1 completed boards');
});

test('no-hint any-solution Spin accepts another verified TSD and keeps its answers hidden',async({page})=>{
  await prepare(page);await drill(page);await page.selectOption('#spin-policy','any');await page.selectOption('#spin-learning','none');await expect(page.locator('#spin-status')).toContainText('Solved');await expect(page.locator('#spin-cancel')).toBeHidden();const route=await page.evaluate(()=>(window as any).spinResult.routes.find((r:any)=>r.evidence.used180));await page.click('#spin-practice');await expect(page.locator('#spin-routes button')).toHaveCount(0);await expect(page.locator('#demo-popup')).toBeHidden();expect(await page.evaluate(()=>(window as any).__spinGame().target)).toBeNull();await play(page,route.steps[0]);await expect(page.locator('#spin-outcome')).toContainText('Goal complete');await expect(page.locator('#demo-popup')).toBeHidden();
});

test('Spin analyzes every new board while retaining the setup route and restoring Undo/Redo',async({page})=>{
  await prepare(page);await fumen(page,'___X________X___XXXX__XX_XXXXX','OT','2');const route=await page.evaluate(()=>(window as any).spinResult.routes.find((r:any)=>r.steps.length===2));expect(route).toBeTruthy();await page.evaluate(route=>{const lab=(window as any).__spinLab;lab.selected=route;lab.applyHint();},route);await page.click('#spin-practice');const requests=await page.evaluate(()=>(window as any).spinRequests);await play(page,route.steps[0]);await expect(page.locator('#spin-step')).toContainText('Step 2');await expect.poll(()=>page.evaluate(()=>(window as any).spinRequests)).toBeGreaterThan(requests);await page.keyboard.press('Control+z');await expect(page.locator('#spin-status')).toContainText('restored at step 1');await expect(page.locator('#time')).toHaveText('0:00.000');await page.keyboard.press('Control+y');await expect(page.locator('#spin-status')).toContainText('restored at step 2');await play(page,route.steps[1]);await expect(page.locator('#spin-outcome')).toContainText('Goal complete');
});

test('Spin shows Mini categories, persists scenes, and clears an in-flight search on page change',async({page})=>{
  await prepare(page);await drill(page,'i');await expect(page.locator('#spin-guide-title')).toContainText('Mini I-spin');await page.locator('#spin-scenes').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.fill('#spin-name','I kick practice');await page.click('#spin-save');await page.reload();await page.locator('#spin-scenes').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.click('#spin-open');await expect(page.locator('#spin-status')).toContainText('Solved');await page.locator('#spin-options').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.selectOption('#spin-depth','3');await page.getByRole('link',{name:'PC',exact:true}).click();await page.waitForTimeout(300);await expect(page.locator('#spin-guide')).toBeHidden();await expect(page.locator('#demo-popup')).toBeHidden();
});

test('opener defaults migrate a short hidden-queue preference and clearly distinguish one and two TSDs',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('tetrio-trainer-opening-options-v1',JSON.stringify({continuationDepth:4,seededLookahead:false,continuations:true})));await page.goto('/');await expect(page.locator('#continuation-depth')).toHaveCount(0);await expect(page.locator('#continuation-seeded')).toHaveCount(0);await expect(page.locator('#continuation-goal option[value="tsd"]')).toHaveText('T-spin Double (1 T, 2 lines)');await expect(page.locator('#continuation-goal option[value="two-tsd"]')).toHaveText('Two T-spin Doubles (2 T pieces)');
});

test('Spin automatically publishes candidates after every placement without a search button',async({page})=>{
  await prepare(page);await fumen(page,'___X________X___XXXX__XX_XXXXX','OT','2');
  await expect(page.locator('#spin-analyze')).toHaveCount(0);
  const route=await page.evaluate(()=>(window as any).spinResult.routes.find((r:any)=>r.steps.length===2));
  const first=await page.evaluate(()=>(window as any).spinRequests);await play(page,route.steps[0]);
  await expect.poll(()=>page.evaluate(()=>(window as any).spinRequests)).toBeGreaterThan(first);
  await expect(page.locator('#spin-cancel')).toBeHidden();await expect(page.locator('#spin-routes button').first()).toContainText('T-spin Double');
  expect(await page.evaluate(()=>(window as any).spinResult.routes.every((r:any)=>r.steps.length===1))).toBe(true);
  const second=await page.evaluate(()=>(window as any).spinRequests);await play(page,route.steps[1]);
  await expect.poll(()=>page.evaluate(()=>(window as any).spinRequests)).toBeGreaterThan(second);
});

test('Spin drills support multiple selections, randomized boards, retries and automatic advancement',async({page})=>{
  await prepare(page);await page.click('#spin-choose-drills');await expect(page.locator('#spin-drills-page')).toBeVisible();await page.click('#spin-drill-none');await page.check('input[name="spin-drill-type"][value="tsd"]');await page.check('input[name="spin-drill-type"][value="mini"]');await page.selectOption('#spin-drill-rounds','10');await page.getByRole('button',{name:'Start Spin drills',exact:true}).click();
  await expect(page.locator('#spin-cancel')).toBeHidden();await expect(page.locator('#spin-drill-progress')).toContainText('0 / 10');
  const first=await page.evaluate(()=>({scene:(window as any).__spinLab.scene,route:(window as any).__spinLab.selected}));
  await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>(window as any).__spinGame().analysisMistakes+(window as any).__spinGame().targetMisses)).toBe(1);await expect(page.locator('#pieces')).toHaveText('0');await expect(page.locator('#time')).toHaveText('0:00.000');
  expect(await page.evaluate(()=>JSON.stringify((window as any).__spinGame().engine.board.state))).toBe(JSON.stringify(first.scene.context.snapshot.board));
  await play(page,first.route.steps[0]);await expect(page.locator('#spin-drill-progress')).toContainText('1 / 10');
  const second=await page.evaluate(()=>({scene:(window as any).__spinLab.scene,route:(window as any).__spinLab.selected}));expect(second.scene.context.snapshot.board).not.toEqual(first.scene.context.snapshot.board);expect(second.route.evidence.spin).not.toBe(first.route.evidence.spin);
  await page.click('#spin-drill-new');expect(await page.evaluate(()=>JSON.stringify((window as any).__spinLab.scene.context.snapshot.board))).not.toBe(JSON.stringify(second.scene.context.snapshot.board));await expect(page.locator('#spin-drill-progress')).toContainText('1 / 10');
  await page.click('#spin-drill-end');await expect(page.locator('#spin-drill-progress')).toContainText('ended');await expect(page.locator('#demo-popup')).toBeHidden();
});

test('required 180 and kick evidence is recognized from real keyboard input with finesse enabled',async({page})=>{
  await prepare(page);await drill(page,'180');await page.locator('#finesse-toggle').check();await expect(page.locator('#spin-status')).toContainText('Solved');await expect(page.locator('#spin-cancel')).toBeHidden();const route=await page.evaluate(()=>(window as any).spinResult.routes[0]);await page.click('#spin-practice');await play(page,route.steps[0]);await expect(page.locator('#spin-outcome')).toContainText('Goal complete');
  const proof=await page.evaluate(()=>(window as any).__spinGame().placements.at(-1).spinEvidence);expect(proof.used180).toBe(true);expect(proof.rotation).toBeTruthy();await expect(page.locator('#faults')).toHaveText('0');
});

test('replay Spin review finds a missed TSD and opens the saved finite-queue lesson',async({page})=>{
  await prepare(page);await drill(page);await page.keyboard.press('Space');await expect(page.locator('#pieces')).toHaveText('1');await page.locator('.page-nav a[href="#replays"]').click();await page.click('#player-current');await expect(page.locator('#player-content')).toBeVisible();await page.click('#player-spin-scan');await expect(page.locator('#player-spin-status')).toContainText('Review complete',{timeout:15000});await expect(page.locator('#player-spin-lessons button')).toHaveCount(1);await expect(page.locator('#player-spin-lessons')).toContainText('Missed spin');await page.locator('#player-spin-lessons button').click();await expect(page.locator('#spin-lab')).toBeVisible();await expect(page.locator('#spin-status')).toContainText('Solved');expect(await page.evaluate(()=>(window as any).__spinLab.scene.finiteQueue)).toBe(true);
});

test('Spin restart replaces the board, seed and entire queue',async({page})=>{
  await prepare(page);await drill(page);const before=await page.evaluate(()=>({seed:(window as any).__spinGame().seed,board:(window as any).__spinGame().engine.board.state}));
  await page.keyboard.press('r');await expect.poll(()=>page.evaluate(()=>(window as any).__spinGame().seed)).not.toBe(before.seed);
  const after=await page.evaluate(()=>({board:(window as any).__spinGame().engine.board.state,next:(window as any).__spinGame().engine.queue.slice(0,14),scene:(window as any).__spinLab.scene}));
  expect(after.board.every((row:any[])=>row.every(tile=>!tile))).toBe(true);expect(after.next.length).toBeGreaterThanOrEqual(13);expect(after.scene?.finiteQueue).not.toBe(true);await expect(page.locator('#spin-lab')).toBeVisible();await expect(page.locator('#demo-popup')).toBeHidden();
});

test('drills use the input-only Just think clock and show the minimum-input solution',async({page})=>{
  await page.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=((array:any)=>{original(array);if(array.length===1)array[0]=2;return array;}) as typeof crypto.getRandomValues;});
  await prepare(page,{justThink:true,thinkStyle:'input',finesseEnabled:true});await page.click('#spin-choose-drills');await page.click('#spin-drill-none');await page.check('input[value="tsd"][name="spin-drill-type"]');await page.getByRole('button',{name:'Start Spin drills',exact:true}).click();await expect(page.locator('#spin-cancel')).toBeHidden();await expect(page.locator('#spin-step')).toContainText('4 inputs');
  const state=await page.evaluate(()=>({selected:(window as any).__spinLab.selected,routes:(window as any).spinResult.routes,style:(window as any).__spinGame().settings.training.thinkStyle}));expect(state.style).toBe('input');expect(state.selected.steps[0].scene.path.cost).toBe(Math.min(...state.routes.map((r:any)=>r.steps[0].scene.path.cost)));
  await page.waitForTimeout(250);await expect(page.locator('#time')).toHaveText('0:00.000');
  await page.keyboard.press('ArrowLeft',{delay:80});await page.waitForTimeout(60);const time=await page.locator('#time').textContent();expect(time).not.toBe('0:00.000');await page.waitForTimeout(250);await expect(page.locator('#time')).toHaveText(time!);
  await page.keyboard.press('Space');await expect(page.locator('#pieces')).toHaveText('0');await expect(page.locator('#time')).toHaveText('0:00.000');
  await play(page,state.selected.steps[0]);await expect(page.locator('#spin-drill-progress')).toContainText('1 / Endless');await expect(page.locator('#time')).toHaveText('0:00.000');await expect(page.locator('#faults')).toHaveText('0');
});

test('Spin drill checkboxes are arranged in six piece columns and the chooser uses the primary button color',async({page})=>{
  await page.setViewportSize({width:1920,height:1200});await prepare(page);await expect(page.locator('#spin-choose-drills')).not.toHaveClass(/secondary/);await expect(page.getByRole('button',{name:'Choose Spin drills',exact:true})).toBeVisible();await page.click('#spin-choose-drills');
  const columns=await page.locator('.spin-piece-column').evaluateAll(elements=>elements.map(el=>({piece:(el as HTMLElement).dataset.piece,x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,count:el.querySelectorAll('input[type="checkbox"]').length})));
  expect(columns.map(c=>c.piece)).toEqual(['i','j','l','s','t','z']);expect(new Set(columns.map(c=>Math.round(c.y))).size).toBe(1);expect(new Set(columns.map(c=>Math.round(c.x))).size).toBe(6);expect(columns.every(c=>c.count>0)).toBe(true);
  await page.fill('#spin-drill-filter','FIN');await expect(page.locator('input[value="ttt-16-7-t"]')).toBeVisible();await expect(page.locator('input[value="ttt-15-1-s"]')).toBeHidden();await page.fill('#spin-drill-filter','');await page.screenshot({path:'TEMP/M3-spin-columns.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'TEMP/M3-spin-columns-mobile.png',fullPage:true});
});

test('each piece and category heading has a select-all checkbox with partial selection state',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('tetrio-trainer-spin-drills-v1',JSON.stringify({ids:['o-rotation','tsd'],rounds:10})));
  await prepare(page);await page.click('#spin-choose-drills');await expect(page.locator('[data-piece="o"]')).toHaveCount(0);await expect(page.locator('input[value="o-rotation"]')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tetrio-trainer-spin-drills-v1')!).ids)).toEqual(['tsd']);
  const piece=page.getByRole('checkbox',{name:'Select all T drills',exact:true}),group=page.getByRole('checkbox',{name:'Select all T Spin classes',exact:true}),scope=page.locator('.spin-piece-column[data-piece="t"]');
  expect(await group.evaluate((input:HTMLInputElement)=>input.indeterminate)).toBe(true);await group.check();expect(await group.evaluate((input:HTMLInputElement)=>input.indeterminate)).toBe(false);await expect(group).toBeChecked();expect(await piece.evaluate((input:HTMLInputElement)=>input.indeterminate)).toBe(true);
  await piece.check();expect(await scope.locator('input[name="spin-drill-type"]').evaluateAll(inputs=>inputs.every(input=>(input as HTMLInputElement).checked))).toBe(true);
  await group.uncheck();expect(await piece.evaluate((input:HTMLInputElement)=>input.indeterminate)).toBe(true);await page.click('#spin-drill-none');await expect(piece).not.toBeChecked();expect(await piece.evaluate((input:HTMLInputElement)=>input.indeterminate)).toBe(false);
});

test('Perfect finesse retries surplus inputs and each drill computes once across moves, retries and toggle changes',async({page})=>{
  await page.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=((array:any)=>{original(array);if(array.length===1)array[0]=2;return array;}) as typeof crypto.getRandomValues;});
  await prepare(page,{justThink:true,thinkStyle:'input',finesseEnabled:true});await page.click('#spin-choose-drills');await page.click('#spin-drill-none');await page.check('input[value="tsd"][name="spin-drill-type"]');
  const before=await page.evaluate(()=>(window as any).spinRequests);await page.getByRole('button',{name:'Start Spin drills',exact:true}).click();await expect(page.locator('#spin-cancel')).toBeHidden();const state=await page.evaluate(()=>({route:(window as any).__spinLab.selected,requests:(window as any).spinRequests}));expect(state.requests).toBe(before+1);
  await page.keyboard.press('ArrowUp',{delay:35});await page.keyboard.press('z',{delay:35});await page.waitForTimeout(250);expect(await page.evaluate(()=>(window as any).spinRequests)).toBe(state.requests);
  await play(page,state.route.steps[0]);await expect(page.locator('#faults')).toHaveText('1');await expect(page.locator('#pieces')).toHaveText('0');await expect(page.locator('#time')).toHaveText('0:00.000');await expect(page.locator('#spin-drill-progress')).toContainText('0 / Endless');expect(await page.evaluate(()=>(window as any).spinRequests)).toBe(state.requests);
  await expect(page.locator('#demo-popup')).toBeVisible();await play(page,state.route.steps[0]);await expect(page.locator('#spin-drill-progress')).toContainText('1 / Endless');await expect(page.locator('#spin-cancel')).toBeHidden();expect(await page.evaluate(()=>(window as any).spinRequests)).toBe(state.requests+1);
  await page.uncheck('#finesse-toggle');await page.waitForTimeout(100);expect(await page.evaluate(()=>(window as any).spinRequests)).toBe(state.requests+1);const next=await page.evaluate(()=>(window as any).__spinLab.selected);
  await page.keyboard.press('ArrowUp',{delay:35});await page.keyboard.press('z',{delay:35});await play(page,next.steps[0]);await expect(page.locator('#spin-drill-progress')).toContainText('2 / Endless');await expect(page.locator('#finesse-toggle')).not.toBeChecked();
});

test('I rotation drills reject ordinary horizontal drops and floor flips while reusing the round calculation',async({page})=>{
  await page.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=((array:any)=>{original(array);if(array.length===1)array[0]=2;return array;}) as typeof crypto.getRandomValues;});
  await prepare(page);await page.click('#spin-choose-drills');await page.click('#spin-drill-none');await expect(page.locator('input[value="i-rotation-quad"]')).toHaveCount(0);await page.check('input[value="ttt-16-4-i"][name="spin-drill-type"]');await page.getByRole('button',{name:'Start Spin drills',exact:true}).click();await expect(page.locator('#spin-cancel')).toBeHidden();
  const start=await page.evaluate(()=>{const lab=(window as any).__spinLab;return {route:lab.selected,target:lab.scene.filters.target,routes:lab.drillResult.routes,requests:(window as any).spinRequests};});
  const cells=(target:number[][])=>target.map(cell=>cell.join(',')).sort().join(';');expect(start.routes.every((route:any)=>cells(route.steps[0].scene.target)===cells(start.target))).toBe(true);expect(new Set(start.route.steps[0].scene.target.map(([x]:number[])=>x)).size).toBe(1);
  await page.keyboard.press('Space');await expect.poll(()=>page.evaluate(()=>(window as any).__spinGame().analysisMistakes)).toBe(1);await expect(page.locator('#spin-drill-progress')).toContainText('0 / Endless');
  await play(page,{scene:{path:{moves:['softDrop','rotate180']}}});await expect.poll(()=>page.evaluate(()=>(window as any).__spinGame().analysisMistakes)).toBe(2);await expect(page.locator('#spin-drill-progress')).toContainText('0 / Endless');await expect(page.locator('#pieces')).toHaveText('0');await expect(page.locator('#time')).toHaveText('0:00.000');expect(await page.evaluate(()=>(window as any).spinRequests)).toBe(start.requests);
  await play(page,start.route.steps[0]);await expect(page.locator('#spin-drill-progress')).toContainText('1 / Endless');
});
