import test from 'node:test';
import assert from 'node:assert/strict';
import { openingOptions, saveOpeningOptions } from '../src/opening-options';
import { continuationGoalReached, continuationQueue, continuationMatches, maxContinuationDepth, type ContinuationStep } from '../src/continuation-search';
import { spinLabel } from '../src/spin-label';
import { createEngine } from '../src/engine';
import { defaults } from '../src/settings';
import { modeDefinitions } from '../src/modes';
import { analysisContext, withGeneratedPacks } from '../src/analysis-context';

test('opener lookahead is fixed at maximum with full sequence regardless of saved preferences', () => {
  let raw = JSON.stringify({ continuationDepth: 4, seededLookahead: false, finesse: false, continuations: true });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } } });
  try {
    assert.equal(openingOptions().continuationDepth, maxContinuationDepth); assert.equal(openingOptions().seededLookahead, true);
    assert.equal(openingOptions().finesse, false); assert.equal(openingOptions().continuations, true);
    saveOpeningOptions({ continuationDepth: 7, seededLookahead: false });
    assert.equal(openingOptions().continuationDepth, maxContinuationDepth); assert.equal(openingOptions().seededLookahead, true);
    raw = '{}'; assert.equal(openingOptions().continuationDepth, maxContinuationDepth); assert.equal(openingOptions().seededLookahead, true);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('TSD validation requires one normal two-line clear and does not confuse two singles or a mini', () => {
  const step = (spin: string, lines: number) => ({ piece: 't', spin, lines }) as ContinuationStep;
  assert.equal(continuationGoalReached('tsd', [step('normal',2)], false), true);
  assert.equal(continuationGoalReached('two-tsd', [step('normal',2)], false), false);
  assert.equal(continuationGoalReached('tsd', [step('normal',1),step('normal',1)], false), false);
  assert.equal(continuationGoalReached('tsd', [step('mini',2)], false), false);
  assert.equal(continuationGoalReached('two-tsd', [step('normal',2),step('normal',2)], false), true);
  assert.equal(spinLabel('t','normal',2),'T-spin Double');
  assert.equal(spinLabel('t','mini',2),'Mini T-spin Double');
  assert.equal(spinLabel('i','normal',4),'I-spin Quad');
});

test('full opener lookahead extends an actual seed but preserves finite supplied queues', () => {
  const rules = modeDefinitions.sprint.rules(defaults), engine = createEngine(defaults,17,rules);
  const context = withGeneratedPacks(analysisContext(rules,defaults,engine.snapshot({ isUndoRedo: true })));
  assert.equal(continuationQueue(context,30,true).length,31);
  assert.equal(continuationQueue(context,30,false).length,rules.nextCount+1);
  delete context.generated; context.snapshot.queue.value = ['t'];
  assert.deepEqual(continuationQueue(context,14,true),[context.snapshot.falling.symbol,'t']);
});
