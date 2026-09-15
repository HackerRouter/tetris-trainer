import { searchSpins, type SpinRequest } from './spin-search';

self.onmessage = (event: MessageEvent<SpinRequest>) => {
  try { self.postMessage({ result: searchSpins(event.data, result => self.postMessage({ result, done: false })), done: true }); }
  catch (error) { self.postMessage({ error: (error as Error).message }); }
};
