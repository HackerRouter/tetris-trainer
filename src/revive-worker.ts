import { searchRevive, type ReviveBudget } from './qp-search';
import type { QpCheckpoint } from './qp-runtime';
import { validateReviveGuidance } from './revive-guidance';
import type { QpOperation } from './qp-search';

self.onmessage = (event: MessageEvent<{ checkpoint: QpCheckpoint; budget: ReviveBudget; validation?: { source: QpCheckpoint; operation: QpOperation } }>) => {
  try { self.postMessage(event.data.validation ? { operation: validateReviveGuidance(event.data.checkpoint, event.data.validation.source, event.data.validation.operation) } : { result: searchRevive(event.data.checkpoint, 0, event.data.budget) }); }
  catch (error) { self.postMessage({ error: (error as Error).message }); }
};
