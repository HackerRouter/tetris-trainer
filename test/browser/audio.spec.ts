import { test, expect } from '@playwright/test';
import { defaults } from '../../src/settings';
import { readFile } from 'node:fs/promises';

test('soft drop locks with floor audio, and keyboard or button pauses use one click without voices', async ({ page }) => {
  const { sprites } = JSON.parse(await readFile('public/tetrio/sound-pack.json', 'utf8'));
  const settings = structuredClone(defaults); settings.training.countdownSeconds = 0;
  settings.custom.gravity = .02; settings.custom.infiniteLock = false; settings.custom.lockDelay = 8; settings.handling.sdf = 41;
  await page.addInitScript(settings => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    const monitor = window as typeof window & { soundCalls: number[] }; monitor.soundCalls = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      monitor.soundCalls.push(offset); start.call(this, when, offset, duration);
    };
  }, settings);
  const calls = () => page.evaluate(() => (window as typeof window & { soundCalls: number[] }).soundCalls);
  const reset = () => page.evaluate(() => { (window as typeof window & { soundCalls: number[] }).soundCalls = []; });
  await page.goto('/'); await expect(page.locator('#audio-status')).toContainText('ready');
  await page.locator('#mode-select').selectOption('custom'); await page.locator('#start').click();
  await reset(); await page.keyboard.down('ArrowDown');
  await expect(page.locator('#pieces')).toHaveText('1');
  await page.keyboard.up('ArrowDown');
  expect(await calls()).toContain(sprites.softdrop.offset); expect(await calls()).toContain(sprites.floor.offset);
  expect(await calls()).not.toContain(sprites.boardlock.offset); expect(await calls()).not.toContain(sprites.harddrop.offset);
  for (const control of ['keyboard', 'button']) {
    await reset();
    if (control === 'keyboard') await page.keyboard.press('Escape'); else await page.locator('#pause').click();
    await expect(page.locator('#overlay-value')).toHaveText('Paused');
    await page.waitForTimeout(50); expect(await calls()).toEqual([sprites.menuclick.offset]);
    await reset();
    if (control === 'keyboard') await page.keyboard.press('Escape'); else await page.locator('#pause').click();
    await expect(page.locator('#pause')).toHaveText('Pause');
    await page.waitForTimeout(50); expect(await calls()).toEqual([sprites.menuclick.offset]);
  }
  await reset(); await page.keyboard.press('Space'); await expect(page.locator('#pieces')).toHaveText('2');
  expect(await calls()).toContain(sprites.harddrop.offset); expect(await calls()).toContain(sprites.floor.offset);
});

test('audio survives media-request interception and produces a signal after the volume control', async ({ page }) => {
  await page.addInitScript(settings => {
    localStorage.setItem('tetrio-trainer-settings-v1', JSON.stringify(settings));
    const monitor = window as typeof window & { audioPeak: number }; monitor.audioPeak = 0;
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this), analyser = this.createAnalyser();
      analyser.fftSize = 2048; gain.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        for (const value of samples) monitor.audioPeak = Math.max(monitor.audioPeak, Math.abs(value));
      }, 5);
      return gain;
    };
  }, { ...defaults, audio: { ...defaults.audio, ui: false } });
  const intercepted: string[] = [], audioResponses: string[] = [], downloads: string[] = [];
  await page.route('**/*', route => {
    const request = route.request();
    if (/\.(ogg|opus|mp3|wav|aac|m4a)(?:\?|$)/i.test(request.url()) || request.resourceType() === 'media') {
      intercepted.push(request.url()); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('response', response => { if (/^audio\//i.test(response.headers()['content-type'] ?? '')) audioResponses.push(response.url()); });
  page.on('download', download => downloads.push(download.suggestedFilename()));
  const response = page.waitForResponse('**/tetrio/sound-pack.json');
  await page.goto('/');
  const pack = await response;
  expect(pack.headers()['content-type']).toContain('application/json');
  expect((await pack.json()).encoding).toBe('base64');
  await expect(page.locator('#audio-status')).toContainText('ready');
  await page.locator('#settings-open').click();
  expect(await page.evaluate(() => (window as typeof window & { audioPeak: number }).audioPeak)).toBe(0);
  await page.locator('#audio-preview').click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { audioPeak: number }).audioPeak)).toBeGreaterThan(.02);
  await page.locator('#audio-enabled').uncheck();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.evaluate(() => { (window as typeof window & { audioPeak: number }).audioPeak = 0; });
  await page.waitForTimeout(100);
  await page.evaluate(() => { (window as typeof window & { audioPeak: number }).audioPeak = 0; });
  await page.locator('#start').click(); await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as typeof window & { audioPeak: number }).audioPeak)).toBe(0);
  await page.reload(); await expect(page.locator('#audio-status')).toContainText('ready');
  expect(intercepted).toEqual([]); expect(audioResponses).toEqual([]); expect(downloads).toEqual([]);
  expect(await page.locator('audio,video').count()).toBe(0);
});

test('an invalid sound pack reports a loading error without falling back to an intercepted audio URL', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.route('**/tetrio/sound-pack.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1 }) }));
  await page.goto('/');
  await expect(page.locator('#audio-status')).toContainText('Invalid sound pack');
  expect(requests.some(url => /\.(ogg|opus|mp3|wav)(?:\?|$)/i.test(url))).toBe(false);
  await page.locator('#start').click(); await expect(page.locator('#overlay-value')).toHaveText('3');
});
