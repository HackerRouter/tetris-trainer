import type { QpEvent } from './qp-runtime';

export function qpSounds(event: QpEvent): string[] {
  if (event.type === 'sound') return [(event.data as { name: string }).name];
  if (event.type === 'windup') return [`garbagewindup_${(event.data as { portions: number }).portions}`];
  if (event.type === 'down') return ['losestock', 'boardlock'];
  return [];
}
