import { searchCoverage } from './queue-coverage';
self.onmessage = event => {
  try { self.postMessage({ result: searchCoverage(event.data.request, event.data.options, result => self.postMessage({ result, done: false })), done: true }); }
  catch (error) { self.postMessage({ error: (error as Error).message }); }
};
