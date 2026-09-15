import type { QuickPlayRuntime } from './qp-runtime';
import type { BotPlan } from './qp-bot';
import { trialQpOperation } from './qp-search';

class QpBotController {
  private worker: Worker | null = null;
  private pending: string | null = null;
  private ready: { key: string; plan?: BotPlan; error?: string } | null = null;
  private rejectedAt = -1000;
  constructor(readonly runtime: QuickPlayRuntime) { runtime.botPlanner = () => this.poll(); }
  private key() {
    const side = this.runtime.sides[1], engine = side.engine, task = side.task;
    return JSON.stringify([engine.board.state, engine.falling.symbol, engine.falling.rotation, engine.held, engine.holdLocked, engine.stats.pieces, task?.prompts.map(prompt => prompt.task), task?.active, task?.prompts.map(prompt => prompt.count), task?.resets, side.life, side.practiceTopout]);
  }
  private poll(): BotPlan | null {
    const key = this.key();
    if (this.pending && key !== this.pending) { this.worker?.terminate(); this.worker = null; this.pending = null; this.ready = null; }
    if (this.ready) {
      const ready = this.ready; this.ready = null; this.pending = null;
      if (ready.key === key && ready.plan?.duration) {
        const plan = ready.plan, trial = trialQpOperation(this.runtime.checkpoint(), 1, { actions: plan.actions, duration: plan.duration!, label: plan.reason });
        if (trial) return plan;
      }
      if (ready.error) this.runtime.events.push({ frame: this.runtime.frame, side: 1, type: 'bot-error', data: { message: ready.error } });
      this.rejectedAt = this.runtime.frame;
    }
    if (!this.pending && this.runtime.frame - this.rejectedAt >= 6) {
      if (!this.worker) {
        this.worker = new Worker(new URL('./qp-bot-worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => { this.ready = event.data; };
        this.worker.onerror = event => { this.ready = { key: this.pending ?? '', error: event.message }; this.worker?.terminate(); this.worker = null; };
      }
      this.pending = key;
      this.worker.postMessage({ key, checkpoint: this.runtime.checkpoint() });
    }
    return null;
  }
  dispose() { this.worker?.terminate(); this.runtime.botPlanner = null; }
}
export class QpBotPool {
  private controllers = new Map<QuickPlayRuntime, QpBotController>();
  update(runtimes: (QuickPlayRuntime | null | undefined)[]) {
    const active = runtimes.filter((runtime): runtime is QuickPlayRuntime => !!runtime && !runtime.over && runtime.sides.length === 2);
    for (const [runtime, controller] of this.controllers) if (!active.includes(runtime)) { controller.dispose(); this.controllers.delete(runtime); }
    for (const runtime of active) if (!this.controllers.has(runtime)) this.controllers.set(runtime, new QpBotController(runtime));
  }
}
