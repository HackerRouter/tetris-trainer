import { QuickPlayRuntime, type QpCheckpoint } from './qp-runtime';
import { planQpBot } from './qp-search';

self.onmessage = (event: MessageEvent<{ key: string; checkpoint: QpCheckpoint }>) => {
  try {
    const runtime = QuickPlayRuntime.fromCheckpoint(event.data.checkpoint);
    self.postMessage({ key: event.data.key, plan: planQpBot(runtime, 1, runtime.sides[1].task ? 600 : Math.min(180, 450 / runtime.settings.quickplay.bot.pps)) });
  } catch (error) { self.postMessage({ key: event.data.key, error: (error as Error).message }); }
};
