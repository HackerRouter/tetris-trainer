import { searchOpenerContinuations, type OpenerContinuationRequest } from './opener-followups';

self.onmessage = (event: MessageEvent<OpenerContinuationRequest>) => {
  try { self.postMessage({ result: searchOpenerContinuations(event.data) }); }
  catch (error) { self.postMessage({ error: (error as Error).message }); }
};
