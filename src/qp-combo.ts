import { analysisContext } from './analysis-context';
import { analysisRequest } from './analysis';
import { searchCombo } from './combo-search';
import { inputPlan } from './qp-bot';
import { QuickPlayRuntime, type QpCheckpoint } from './qp-runtime';
import type { ReviveBudget, QpOperation } from './qp-search';

export function qpComboProposals(checkpoint: QpCheckpoint, sideIndex: number, budget: ReviveBudget) {
  const runtime = QuickPlayRuntime.fromCheckpoint(checkpoint), side = runtime.sides[sideIndex], engine = side.engine;
  const prompt = side.task!.prompts[side.task!.active], noHold = prompt.predicate === 'combonohold';
  const carry = prompt.predicate === 'szsingle' ? prompt.count > 0 : engine.stats.combo >= 0;
  if (engine.board.state.some(row => row.some(tile => String(tile?.mino) === 'gbd'))) return { routes: [], nodes: 0, limits: ['The Combo proposal adapter does not model permanent rows.'] };
  const known = budget.information === 'seeded' ? budget.depth + 1 : side.rules.nextCount;
  while (engine.queue.length < known) engine.queue.repopulateOnce();
  const snapshot = engine.snapshot(); snapshot.glock = 0; snapshot.garbage.queue = [];
  const request = analysisRequest(analysisContext(side.rules, side.settings, snapshot), { sessionId: 'revive-combo', revision: runtime.frame, kind: 'combo', information: budget.information, depth: budget.depth, milliseconds: Math.max(1, budget.milliseconds * .75), nodes: Math.floor(budget.nodes * .85), candidates: Math.max(3, budget.solutions ?? 3), cleanup: carry ? 0 : budget.depth - 1 });
  request.position.next = engine.queue.slice(0, known); request.position.unavailable = false;
  const result = searchCombo(request, undefined, { combo: prompt.predicate === 'quadcombo' ? 2 : prompt.target, noHold, progress: prompt.count, preserve: true, terminalLines: prompt.predicate === 'quadcombo' ? 4 : undefined, clear: prompt.predicate === 'szsingle' ? { pieces: 'sz', lines: 1 } : undefined });
  const routes = result.routes.map(route => route.steps.map(step => {
    const actions = inputPlan(step.scene.path.moves, engine, step.scene.holdFirst, budget.fastInputs);
    return { actions, duration: actions.at(-1)!.at + 1, target: step.scene.target, label: `${step.lines ? 'Continue Combo' : 'Prepare Combo'}: ${step.scene.holdFirst ? 'Hold, then ' : ''}${step.scene.path.moves.join(', ')}${step.scene.path.moves.length ? ', ' : ''}Hard drop` } satisfies QpOperation;
  }));
  return { routes, nodes: result.checked, limits: result.reasons };
}
