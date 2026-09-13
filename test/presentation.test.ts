import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine.ts';
import { defaults } from '../src/settings.ts';
import { copyPiece } from '../src/finesse.ts';
import { buildDemoFrames } from '../src/demo-frames.ts';
import { placementSteps } from '../src/guide.ts';
import { actionText, actionLabels } from '../src/action-text.ts';
import { modeDefinitions } from '../src/modes.ts';

test('soft-drop demonstration retains fractional kick coordinates before CW, CCW and 180 rotations', () => {
  for (const move of ['rotateCW', 'rotateCCW', 'rotate180'] as const) {
    const engine = createEngine(defaults, 1); engine.initiatePiece('t');
    const snapshot = engine.snapshot(), piece = copyPiece(engine, snapshot.falling);
    piece.softDrop(snapshot.board);
    const old = copyPiece(engine, piece.snapshot()); old.y = old.y;
    const rotation = move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2;
    assert.ok(piece.rotate(snapshot.board, engine.kickTableName, rotation, false)); piece.softDrop(snapshot.board);
    const path = { cost: 1, moves: ['softDrop', move] as ('softDrop' | typeof move)[], drop: 'soft' as const, source: 'extended' as const };
    const scene = { id: move, serial: 1, sceneNumber: 1, snapshot, target: piece.absoluteBlocks, path };
    const frames = buildDemoFrames(scene, engine, placementSteps(path, defaults));
    assert.deepEqual(copyPiece(engine, frames.at(-1)!.piece).absoluteBlocks, scene.target);
    const release = frames.find(frame => frame.label === 'Release soft drop')!;
    assert.notEqual(release.piece.location[1] % 1, 0);
    assert.equal(frames.find(frame => frame.label.startsWith('Rotate'))!.piece.rotation, rotation);
    assert.deepEqual(frames[0].piece, snapshot.falling);
    if (move !== 'rotate180') assert.equal(old.rotate(snapshot.board, engine.kickTableName, rotation, false), false);
  }
});

test('action text follows actual clear, spin, combo, B2B and geometric all clears', () => {
  const engine = createEngine(defaults, 1);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) if (x !== 4) engine.board.state[y][x] = { mino: 'i', connections: 0 };
  engine.initiatePiece('i'); engine.press('rotateCW'); engine.press('moveLeft');
  let result = engine.hardDrop(), text = actionText(engine, result);
  assert.equal(text.clear, 'QUAD'); assert.equal(text.pc, true); assert.equal(text.b2b, 0);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) if (x !== 4) engine.board.state[y][x] = { mino: 'i', connections: 0 };
  engine.initiatePiece('i'); engine.press('rotateCW'); engine.press('moveLeft'); result = engine.hardDrop(); text = actionText(engine, result);
  assert.equal(text.b2b, 1); assert.equal(text.combo, 1);
  const items = [{ action: text, age: 400 }, { action: text, age: 0 }];
  assert.deepEqual(actionLabels(items).map(line => line.text), ['QUAD ×2', 'BACK-TO-BACK ×1', '1 COMBO']);
  const spin = actionText(engine, { ...result, mino: 't', spin: 'normal', lines: 2 });
  assert.equal(spin.spin, 'T-spin'); assert.equal(spin.clear, 'DOUBLE');
  assert.equal(actionText(engine, { ...result, mino: 's', spin: 'mini', lines: 1 }).spin, 'MINI S-spin');
  assert.equal(actionLabels([{ action: text, age: 1800 }]).length, 0);
  const rules = modeDefinitions.sprint.rules(defaults); rules.advanced.allClear = false;
  const noPc = createEngine(defaults, 1, rules);
  assert.equal(actionText(noPc, result).pc, true);
});
