import type { FinesseResult, Move } from './finesse';
import { bindingLabel, type Action, type Settings } from './settings';

export type GuideStep = { move: Move | 'hardDrop' | 'waitLock'; count: number; text: string };

export function placementSteps(path: FinesseResult, settings: Settings): GuideStep[] {
  const steps: GuideStep[] = [];
  const key = (action: Action) => bindingLabel(settings, action);
  for (const move of [...path.moves, ...(path.drop === 'lock' ? ['softDrop', 'waitLock'] : ['hardDrop'])] as GuideStep['move'][]) {
    if (move === 'down' && steps.at(-1)?.move === 'down') { steps.at(-1)!.count++; continue; }
    steps.push({ move, count: 1, text: '' });
  }
  for (const step of steps) {
    const { move, count } = step;
    if (move === 'moveLeft' || move === 'moveRight') step.text = `Tap ${move === 'moveLeft' ? 'left' : 'right'} (${key(move)}) once, then release.`;
    else if (move === 'dasLeft' || move === 'dasRight') step.text = `Hold ${move === 'dasLeft' ? 'left' : 'right'} (${key(move === 'dasLeft' ? 'moveLeft' : 'moveRight')}) until blocked, then release.`;
    else if (move === 'down') step.text = `Soft drop (${key('softDrop')}) exactly ${count} row${count === 1 ? '' : 's'}, then release.`;
    else if (move === 'softDrop') step.text = `Soft drop (${key('softDrop')}) to the surface, then release.`;
    else if (move === 'hardDrop') step.text = `Hard drop (${key('hardDrop')}) to lock in the outlined target.`;
    else if (move === 'waitLock') step.text = 'Wait for the piece to lock automatically. Hard drop is disabled in this mode.';
    else step.text = `Rotate ${move === 'rotateCW' ? 'clockwise' : move === 'rotateCCW' ? 'counterclockwise' : '180°'} (${key(move)}) once, then release.`;
  }
  return steps;
}
