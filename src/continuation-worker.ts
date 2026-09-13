import { searchContinuations, type ContinuationRequest } from './continuation-search';

self.onmessage = (event: MessageEvent<ContinuationRequest>) => {
  try { self.postMessage({ result: searchContinuations(event.data) }); }
  catch (error) { self.postMessage({ error: (error as Error).message }); }
};
