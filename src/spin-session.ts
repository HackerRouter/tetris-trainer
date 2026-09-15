import type { SpinRequest, SpinResult } from './spin-search';

export class SpinSession {
  private worker: Worker | null = null;
  private generation = 0;
  cancel() { this.generation++; this.worker?.terminate(); this.worker = null; }
  run(request: SpinRequest, update: (result: SpinResult, done: boolean) => void, failure: (message: string) => void) {
    this.cancel(); const generation = this.generation;
    try {
      const worker = new Worker(new URL('./spin-worker.ts', import.meta.url), { type: 'module' }); this.worker = worker;
      worker.onmessage = event => {
        if (generation !== this.generation) return;
        const { result, done, error } = event.data;
        if (error) { this.cancel(); failure(error); return; }
        if (!result || result.solver !== request.solver || result.sessionId !== request.base.sessionId || result.revision !== request.base.revision || result.fingerprint !== request.fingerprint) return;
        if (done) { worker.terminate(); this.worker = null; }
        update(result, done);
      };
      worker.onerror = () => { if (generation === this.generation) { this.cancel(); failure('Spin analysis failed. Analyze again to retry.'); } };
      worker.postMessage(request);
    } catch { this.cancel(); failure('This browser could not start Spin analysis.'); }
  }
}
