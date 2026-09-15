import { searchPc } from './pc-search';
import { searchCombo } from './combo-search';
import type { AnalysisRequest } from './analysis';

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  try { self.postMessage({ result: (event.data.goal.kind === 'combo' ? searchCombo : searchPc)(event.data, result => self.postMessage({ result, done: false })), done: true }); }
  catch (error) { self.postMessage({ error: (error as Error).message }); }
};
