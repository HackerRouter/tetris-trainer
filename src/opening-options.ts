import type { ContinuationGoal } from './continuation-search';
export type OpeningOptions = { mirror: boolean; study: boolean; finesse: boolean; continueAfter: boolean; isomers: boolean; recommend: boolean; continuations: boolean; followContinuation: boolean; seededLookahead: boolean; continuationGoal: ContinuationGoal | 'auto'; continuationDepth: number };
const key = 'tetrio-trainer-opening-options-v1';
export function openingOptions(): OpeningOptions {
  const defaults: OpeningOptions = { mirror: false, study: true, finesse: true, continueAfter: true, isomers: true, recommend: false, continuations: false, followContinuation: true, seededLookahead: true, continuationGoal: 'auto', continuationDepth: 14 };
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    for (const name of ['mirror', 'study', 'finesse', 'continueAfter', 'isomers', 'recommend', 'continuations', 'followContinuation', 'seededLookahead'] as const) if (typeof stored[name] === 'boolean') defaults[name] = stored[name];
    if (['auto', 'pc', 'tspin', 'tsd', 'two-tspins', 'two-tsd'].includes(stored.continuationGoal)) defaults.continuationGoal = stored.continuationGoal;
    if ([4, 7, 10, 14].includes(stored.continuationDepth)) defaults.continuationDepth = stored.continuationDepth;
  } catch {}
  return defaults;
}
export function saveOpeningOptions(next: Partial<OpeningOptions>) {
  const value = { ...openingOptions(), ...next };
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  return value;
}
