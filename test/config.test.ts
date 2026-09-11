import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindingCodes, defaults, validateSettings } from '../src/settings.ts';
import { importSettingsFile, importTetrioConfig, readTetrioOption, readTetrioSection } from '../src/tetrio-config.ts';
import { createEngine } from '../src/engine.ts';
import { placementSteps } from '../src/guide.ts';

const example = JSON.parse(await readFile('test/fixtures/example-config.ttc', 'utf8'));

test('the supplied TTC maps handling, physical keys and supported video settings without changing training', () => {
  const base = structuredClone(defaults); base.training.undoEnabled = true;
  const result = importTetrioConfig(example, base), { settings } = result;
  assert.deepEqual(settings.handling, example.handling);
  assert.deepEqual(settings.bindings, { moveLeft: 'ArrowLeft', moveRight: 'ArrowRight', softDrop: 'ArrowDown', hardDrop: 'ArrowUp', rotateCW: 'KeyX', rotateCCW: 'KeyZ', rotate180: 'KeyC', hold: 'Space', pause: 'Escape', restart: 'KeyR' });
  assert.equal(settings.display.gridOpacity, .5); assert.equal(settings.display.ghostOpacity, .8);
  assert.equal(settings.display.boardOpacity, .85); assert.equal(settings.display.coloredGhost, true);
  assert.deepEqual(settings.training, base.training);
  assert.deepEqual(settings.audio, { enabled: true, volume: .3, ui: true });
  assert.equal(result.applied.length, 27);
  assert.ok(result.retained.includes('gameoptions.pro_40l'));
  assert.ok(result.retained.includes('video.graphics'));
  assert.deepEqual(base.tetrioConfig, undefined);
});

test('retained native options survive saving and export and have isolated extension readers', () => {
  const native = { ...structuredClone(example), future: { option: [1, 2, 3] } };
  const settings = importTetrioConfig(native).settings;
  const restored = importSettingsFile(JSON.parse(JSON.stringify(settings)), defaults).settings;
  assert.deepEqual(restored, settings);
  assert.deepEqual(restored.tetrioConfig, native);
  const volume = readTetrioSection(restored, 'volume')!; volume.music = 1;
  assert.equal(readTetrioOption(restored, 'volume.music'), 0);
  assert.deepEqual(readTetrioOption(restored, 'future.option'), [1, 2, 3]);
  assert.equal(readTetrioSection(restored, 'missing'), null);
  assert.equal(readTetrioOption(restored, '__proto__.toString'), null);
});

test('multiple native keys, empty slots and unbound actions are normalized without truncation', () => {
  const native = structuredClone(example);
  native.controls.custom.hardDrop = ['ARROWUP', '', 'NUMPAD8', 'arrowup'];
  native.controls.custom.rotate180 = [];
  const settings = importTetrioConfig(native).settings;
  assert.deepEqual(bindingCodes(settings, 'hardDrop'), ['ArrowUp', 'Numpad8']);
  assert.equal(settings.bindings.rotate180, '');
  assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(settings))), settings);
  native.controls.custom.hold = ['NUMPAD8'];
  assert.throws(() => importTetrioConfig(native), /already assigned/);
  native.controls.custom.hold = ['GAMEPAD0'];
  const unsupported = importTetrioConfig(native);
  assert.equal(unsupported.settings.bindings.hold, '');
  assert.ok(unsupported.warnings.length > 0);
  assert.ok(unsupported.retained.includes('controls.custom.hold'));
});

test('official guideline and WASD presets do not use inactive custom bindings', () => {
  for (const style of ['guideline', 'wasd']) {
    const settings = importTetrioConfig({ controls: { style, custom: {} } }).settings;
    assert.equal(settings.bindings.moveLeft, style === 'guideline' ? 'ArrowLeft' : 'KeyA');
    assert.equal(settings.bindings.hardDrop, style === 'guideline' ? 'Space' : 'KeyS');
    assert.ok(bindingCodes(settings, 'hold').includes('ShiftRight'));
    assert.deepEqual(validateSettings(settings), settings);
  }
  const unknown = importTetrioConfig({ controls: { style: 'future-preset' } });
  assert.deepEqual(unknown.settings.bindings, defaults.bindings);
  assert.ok(unknown.retained.includes('controls.style'));
  assert.ok(unknown.warnings.length);
});

test('older settings migrate new fields and invalid native values cannot partially replace settings', () => {
  const old: any = structuredClone(defaults);
  delete old.handling.may20g;
  for (const key of ['gridOpacity', 'boardOpacity', 'coloredGhost', 'dimLockedHold']) delete old.display[key];
  assert.deepEqual(validateSettings(old), defaults);
  for (const value of [{}, { handling: [] }, { handling: { arr: -1 } }, { video: { shadowopacity: 'NaN' } }, { handling: { may20g: 'false' } }, { controls: { style: 'custom', custom: { hold: 12 } } }]) assert.throws(() => importTetrioConfig(value));
  const settings = importTetrioConfig({ handling: { may20g: false }, video: { shadowopacity: '0', gridopacity: 0, colorshadow: false, holdlocked: false } }).settings;
  assert.equal(createEngine(settings, 1).handling.may20g, false);
  assert.equal(settings.display.ghost, false); assert.equal(settings.display.grid, false);
  assert.equal(settings.display.coloredGhost, false); assert.equal(settings.display.dimLockedHold, false);
  assert.equal(defaults.handling.may20g, true);
});

test('complete guidance lists every move with current bindings, releases, grouped descents and final hard drop', () => {
  const settings = importTetrioConfig(example).settings;
  const steps = placementSteps({ cost: 3, moves: ['dasLeft', 'rotateCW', 'down', 'down', 'moveRight', 'softDrop'], source: 'extended', drop: 'soft' }, settings);
  assert.deepEqual(steps.map(step => step.move), ['dasLeft', 'rotateCW', 'down', 'moveRight', 'softDrop', 'hardDrop']);
  assert.match(steps[0].text, /Hold left \(Left\) until blocked, then release/);
  assert.match(steps[1].text, /clockwise \(X\)/);
  assert.match(steps[2].text, /exactly 2 rows, then release/);
  assert.match(steps.at(-1)!.text, /Hard drop \(Up\)/);
  assert.equal(placementSteps({ cost: 0, moves: [], source: 'd-002', drop: 'hard' }, settings).length, 1);
});
