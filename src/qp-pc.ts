import { analysisContext } from './analysis-context';
import { analysisRequest } from './analysis';
import { searchPc } from './pc-search';
import { inputPlan } from './qp-bot';
import { QuickPlayRuntime, type QpCheckpoint } from './qp-runtime';
import type { ReviveBudget, QpOperation } from './qp-search';

export function qpPcProposals(checkpoint: QpCheckpoint, sideIndex: number, budget: ReviveBudget) {
  const runtime = QuickPlayRuntime.fromCheckpoint(checkpoint), side = runtime.sides[sideIndex], engine = side.engine;
  if (engine.board.state.some(row => row.some(tile => String(tile?.mino) === 'gbd'))) return { routes: [], nodes: 0, limits: ['The PC proposal adapter does not model permanent rows.'] };
  const known = budget.information === 'seeded' ? budget.depth + 1 : side.rules.nextCount;
  while (engine.queue.length < known) engine.queue.repopulateOnce();
  const snapshot = engine.snapshot(); snapshot.glock = 0; snapshot.garbage.queue = [];
  const request = analysisRequest(analysisContext(side.rules, side.settings, snapshot), { sessionId: 'revive', revision: runtime.frame, information: budget.information, depth: budget.depth, milliseconds: Math.max(1, budget.milliseconds * .85), nodes: budget.nodes, candidates: budget.solutions ?? 3 });
  request.position.next = engine.queue.slice(0, known); request.position.unavailable = false;
  const result = searchPc(request);
  const routes = result.routes.map(route => route.steps.map(step => {
    const actions = inputPlan(step.scene.path.moves, engine, step.scene.holdFirst, budget.fastInputs);
    return { actions, duration: actions.at(-1)!.at + 1, target: step.scene.target, label: `${step.scene.holdFirst ? 'Hold, then ' : ''}${step.scene.path.moves.join(', ')}${step.scene.path.moves.length ? ', ' : ''}Hard drop` } satisfies QpOperation;
  }));
  return { routes, nodes: result.checked, limits: result.reasons };
}
