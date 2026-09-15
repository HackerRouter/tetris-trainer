import type { TrainerGame } from './game';

export class QuickPlayClock {
  private runs = new WeakMap<TrainerGame, { last: number; due: number }>();
  start(game: TrainerGame, now: number) { if (game.qp) this.runs.set(game, { last: now, due: 0 }); }
  advance(game: TrainerGame, now: number, onStep?: () => void, budget = 600) {
    if (!game.qp || !game.active) { this.runs.delete(game); return 0; }
    let run = this.runs.get(game);
    if (!run) { this.start(game, now); run = this.runs.get(game)!; }
    run.due += Math.max(0, now - run.last) * 60 / 1000; run.last = now;
    let steps = 0;
    while (run.due >= 1 - 1e-8 && game.active && steps < budget) { game.step(); onStep?.(); run.due--; steps++; }
    return steps;
  }
}
