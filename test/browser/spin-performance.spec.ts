import {test,expect} from '@playwright/test';
import {defaults} from '../../src/settings';
import {encoder,Field} from 'tetris-fumen';
import {writeFileSync} from 'node:fs';

test('Spin keeps four-column boards centered and setup search leaves animation frames responsive',async({page})=>{
  await page.route('**/src/main.ts',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__spinGame = () => game;'});});
  await page.addInitScript(settings=>localStorage.setItem('tetrio-trainer-settings-v1',JSON.stringify(settings)),{...defaults,training:{...defaults.training,countdownSeconds:0,finesseEnabled:false}});
  await page.setViewportSize({width:1920,height:1200});await page.goto('/#combo');await page.locator('#pc-scenes').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.click('#combo-load');await page.getByRole('link',{name:'Spin',exact:true}).click();
  await expect(page.locator('#spin-scope')).toContainText('4 columns');const geometry=await page.evaluate(()=>{const board=document.querySelector('#board')!.getBoundingClientRect(),left=document.querySelector('.workspace-left')!.getBoundingClientRect(),right=document.querySelector('.workspace-right')!.getBoundingClientRect();return{columns:(window as any).__spinGame().engine.board.width,center:board.x+board.width/2,left:left.width,right:right.width,overflow:document.documentElement.scrollWidth>innerWidth};});
  expect(geometry.columns).toBe(4);expect(geometry.center).toBeCloseTo(960,1);expect(geometry.left).toBeCloseTo(geometry.right,1);expect(geometry.overflow).toBe(false);await page.screenshot({path:'TEMP/M3-spin-four-columns.png',fullPage:true});
  await page.keyboard.press('r');await page.locator('#spin-options').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.selectOption('#spin-depth','3');await page.selectOption('#spin-piece','t');await page.selectOption('#spin-lines','2');await page.locator('#spin-fumen-options').evaluate((el:HTMLDetailsElement)=>el.open=true);await page.fill('#spin-fumen',encoder.encode([{field:Field.create(['___X______','__X___XX__','__XX_XXX__'].join(''))}]));await page.fill('#spin-fumen-queue','OOT');
  await page.evaluate(()=>{(window as any).spinGaps=[];(window as any).spinProbe=true;let previous=performance.now();const tick=(time:number)=>{if(!(window as any).spinProbe)return;(window as any).spinGaps.push(time-previous);previous=time;requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await page.click('#spin-fumen-load');await expect(page.locator('#spin-cancel')).toBeHidden({timeout:20000});const gaps=await page.evaluate(()=>{(window as any).spinProbe=false;return (window as any).spinGaps as number[];});
  expect(gaps.length).toBeGreaterThan(3);const sorted=gaps.slice(2).sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1];expect(p95).toBeLessThan(100);writeFileSync('TEMP/M3-browser-responsiveness.json',JSON.stringify({geometry,frames:sorted.length,p95,max:Math.max(...sorted)},null,2));
});
