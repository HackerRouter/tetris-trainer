import type { EngineSnapshot } from '@haelp/teto/engine';
import type { GarbageState, PendingPacket } from './qp-pressure';

export type GarbageSegment = { id: number; amount: number; phase: 'caution' | 'danger' | 'spawn' };
export function garbageSegments(state: GarbageState, frame: number): GarbageSegment[] {
  return state.pending.filter(packet => packet.release <= frame).map(packet => ({ id: packet.id, amount: packet.amount, phase: frame >= packet.ready ? 'spawn' : frame >= packet.hit + packet.delay ? 'danger' : 'caution' }));
}
export function garbageWarning(board: EngineSnapshot['board'], height: number, state: GarbageState, frame: number) {
  let peak = board.length;
  while (peak && !board[peak - 1].some(Boolean)) peak--;
  const ready = state.pending.reduce((sum, packet) => sum + (packet.ready <= frame ? packet.amount : 0), 0);
  const projected = peak + Math.min(8, ready);
  return { peak, ready, projected, panic: projected >= height - 2, alert: projected >= height + 1 && ready > 0, interval: Math.max(50, 100 - 15 * (projected - height + 2)) };
}
export function garbageSize(amount: number) { return amount < 3 ? 'small' : amount > 5 ? 'large' : 'medium'; }
export function packetCues(packet: PendingPacket, frame: number) {
  const result: string[] = [];
  if (packet.release === frame) result.push(`garbage_in_${garbageSize(packet.amount)}`);
  if (packet.hit === frame) result.push('impact');
  if (packet.ready === frame) result.push(`damage_${garbageSize(packet.amount)}`);
  return result;
}
