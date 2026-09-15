import type { QuickPlayRuntime } from './qp-runtime';
import { pacedBotOperation, type BotPlan } from './qp-bot';
import { immediateQpBot, recoverQpBot, qpBotNeedsRecovery, trialQpOperation, verticallyShiftedQpTarget } from './qp-search';

class QpBotController {
  private worker: Worker | null = null;
  private pending: string | null = null;
  private pendingIdentity: string | null = null;
  private ready: { key: string; plan?: BotPlan; error?: string } | null = null;
  private rejectedAt = -1000;
  private recoveryAt = -1000;
  private immediateKey: string | null = null;
  constructor(readonly runtime: QuickPlayRuntime) { runtime.botPlanner = () => this.poll(); }
  private key() {
    const side = this.runtime.sides[1], engine = side.engine, task = side.task;
    return JSON.stringify([engine.board.state, engine.falling.symbol, engine.falling.rotation, engine.held, engine.holdLocked, engine.stats.pieces, task?.prompts.map(prompt => prompt.task), task?.active, task?.prompts.map(prompt => prompt.count), task?.resets, side.life, side.practiceTopout]);
  }
  private identity() {
    const side = this.runtime.sides[1], engine = side.engine, task = side.task;
    return JSON.stringify([engine.falling.symbol, engine.falling.rotation, engine.held, engine.holdLocked, engine.stats.pieces, task?.prompts.map(prompt => prompt.task), task?.active, task?.prompts.map(prompt => prompt.count), task?.resets, side.life, side.practiceTopout]);
  }
  private poll(): BotPlan | null {
    const key = this.key(), identity = this.identity();
    if (this.pending && identity !== this.pendingIdentity) { this.worker?.terminate(); this.worker = null; this.pending = null; this.pendingIdentity = null; this.ready = null; }
    if (this.immediateKey !== key) {
      this.immediateKey = key;
      const immediate = immediateQpBot(this.runtime);
      if (immediate) return immediate;
    }
    if (this.ready) {
      const ready = this.ready, pending = this.pending; this.ready = null; this.pending = null; this.pendingIdentity = null;
      if (ready.key === pending && ready.plan?.duration) {
        const plan = ready.plan, trial = trialQpOperation(this.runtime.checkpoint(), 1, pacedBotOperation({ actions: plan.actions, duration: plan.duration!, label: plan.reason }, this.runtime.frame, this.runtime.sides[1].nextPlan));
        if (trial && trial.progress >= (plan.progress ?? -Infinity) && (!plan.target || trial.target[0] && verticallyShiftedQpTarget(plan.target, trial.target[0]))) return { ...plan, target: plan.target ? trial.target[0] : null };
      }
      if (ready.error) this.runtime.events.push({ frame: this.runtime.frame, side: 1, type: 'bot-error', data: { message: ready.error } });
      this.rejectedAt = this.runtime.frame;
    }
    if (this.runtime.frame - this.recoveryAt >= 6 && qpBotNeedsRecovery(this.runtime)) {
      this.recoveryAt = this.runtime.frame;
      const start = performance.now(), plan = recoverQpBot(this.runtime);
      if (plan?.target) {
        this.runtime.events.push({ frame: this.runtime.frame, side: 1, type: 'bot-recovery', data: { nodes: plan.nodes, milliseconds: performance.now() - start } });
        return plan;
      }
    }
    if (!this.pending && this.runtime.frame - this.rejectedAt >= 6) {
      if (!this.worker) {
        this.worker = new Worker(new URL('./qp-bot-worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => { this.ready = event.data; };
        this.worker.onerror = event => { this.ready = { key: this.pending ?? '', error: event.message }; this.worker?.terminate(); this.worker = null; };
      }
      this.pending = key; this.pendingIdentity = identity;
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
