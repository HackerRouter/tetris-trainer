import { garbageSegments, garbageWarning } from './qp-feedback';
import type { QpEvent, QpSide } from './qp-runtime';
import { reviveCatalog } from './revive-tasks';

export type QpViewState = { frame: number; events: QpEvent[]; sides: (Pick<QpSide, 'life' | 'task' | 'garbage' | 'feedback'> & { engine: { board: Pick<QpSide['engine']['board'], 'height' | 'state'> } })[] };
export class QpBoardView {
  readonly root = document.createElement('div');
  private key = '';
  constructor(private column: HTMLElement, readonly side: number) {
    this.root.className = 'qp-board-ui'; this.root.dataset.qp = ''; this.root.hidden = true;
    this.root.innerHTML = `<div class="qp-garbage-meter" role="img" aria-label="Incoming garbage"><div class="qp-garbage-segments"></div><span class="qp-garbage-total"></span></div><div class="qp-danger-icon" hidden aria-label="Incoming garbage can overflow this board">!</div><div class="qp-windup" hidden></div><div class="qp-board-flash"></div><div class="qp-active-prompt" hidden></div><ol class="qp-chains" hidden></ol><span class="qp-board-name">${side ? 'LOCAL TEAMMATE' : 'YOU'}</span>`;
    column.append(this.root);
  }
  update(qp: QpViewState | null) {
    const side = qp?.sides[this.side]; this.root.hidden = !side;
    this.column.classList.toggle('qp-board-down', !!side && side.life !== 'alive');
    this.column.classList.toggle('qp-board-panic', !!qp && !!side && side.life === 'alive' && garbageWarning(side.engine.board.state, side.engine.board.height, side.garbage, qp.frame).panic);
    if (!qp || !side) return;
    const segments = garbageSegments(side.garbage, qp.frame), total = segments.reduce((sum, packet) => sum + packet.amount, 0), waiting = side.garbage.pending.reduce((sum, packet) => sum + (packet.release > qp.frame ? packet.amount : 0), 0);
    const query = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
    const gauge = query('.qp-garbage-meter'); gauge.setAttribute('aria-label', `Incoming garbage: ${total} queued, ${side.garbage.entering.length} entering, ${waiting} in wind-up`);
    gauge.style.height = `${side.engine.board.height / (side.engine.board.height + 3) * 100}%`;
    query('.qp-board-flash').style.top = `${3 / (side.engine.board.height + 3) * 100}%`;
    const key = JSON.stringify(segments);
    if (key !== this.key) {
      this.key = key; let bottom = 0;
      query('.qp-garbage-segments').replaceChildren(...segments.map(packet => {
        const item = document.createElement('span'); item.className = `qp-garbage-segment qp-garbage-${packet.phase}`;
        item.style.bottom = `${Math.min(100, bottom / side.engine.board.height * 100)}%`;
        item.style.height = `${Math.max(0, Math.min(packet.amount, side.engine.board.height - bottom)) / side.engine.board.height * 100}%`; bottom += packet.amount;
        item.dataset.packet = String(packet.id); item.title = `${packet.amount} lines · ${packet.phase === 'spawn' ? 'Ready to enter' : packet.phase === 'danger' ? 'Activating soon' : 'Waiting'}`;
        return item;
      }));
    }
    query('.qp-garbage-total').textContent = total ? String(total) : '';
    query('.qp-danger-icon').hidden = !side.feedback.alert || side.life !== 'alive';
    const windup = query('.qp-windup'); windup.hidden = qp.frame - side.feedback.windupAt >= 60 || side.life !== 'alive';
    windup.textContent = `${'!'.repeat(side.feedback.windupPortions)} WIND-UP`;
    windup.dataset.portions = String(side.feedback.windupPortions);
    const task = side.task ?? qp.sides[1 - this.side]?.task, chains = query('.qp-chains'), prompt = query('.qp-active-prompt');
    chains.hidden = !task || side.life === 'alive'; prompt.hidden = !side.task || side.life !== 'alive';
    if (task) {
      const taskKey = JSON.stringify(task.prompts);
      if (chains.dataset.tasks !== taskKey) {
        chains.dataset.tasks = taskKey;
        const start = Math.max(0, Math.min(task.active - 1, task.prompts.length - 3));
        chains.replaceChildren(...task.prompts.slice(start, start + 3).map((entry, offset) => {
          const index = start + offset;
          const li = document.createElement('li'); li.className = entry.complete ? 'qp-chain-complete' : index === task.active ? 'qp-chain-active' : '';
          const label = document.createElement('strong'); label.textContent = reviveCatalog.find(definition => definition.id === entry.task)!.label;
          const count = document.createElement('span'); count.textContent = `${entry.count} / ${entry.target} · Task ${index + 1}/${task.prompts.length}`; li.append(label, count); return li;
        }));
      }
      const current = side.task?.prompts[side.task.active];
      prompt.textContent = current ? `${reviveCatalog.find(definition => definition.id === current.task)!.label} · ${current.count}/${current.target}` : '';
    }
    const recent = qp.events.slice(-100).filter(event => event.side === this.side && event.frame >= qp.frame - 24);
    const flash = recent.reverse().find(event => event.type === 'spin' || event.type === 'cancel' || event.type === 'revived' || event.type === 'garbage-row' || event.type === 'sound' && ['damage_small', 'damage_medium', 'damage_large', 'boardlock_fail'].includes((event.data as { name: string }).name));
    const effect = query('.qp-board-flash'); effect.hidden = !flash;
    if (flash) { effect.dataset.effect = flash.type === 'sound' ? (flash.data as { name: string }).name : flash.type; effect.style.opacity = String(Math.max(0, 1 - (qp.frame - flash.frame) / 24)); }
    gauge.classList.toggle('qp-meter-cancelled', recent.some(event => event.type === 'cancel'));
  }
}
