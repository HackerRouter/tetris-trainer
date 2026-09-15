import type { AnalysisRequest } from './analysis';
import type { CoverageBound, CoverageResult, PolicyNode } from './queue-coverage';

const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const boundText = (b: CoverageBound) => `${percent(b.lower)}–${percent(b.upper)}${b.interval ? ` · 95% interval ${percent(b.interval[0])}–${percent(b.interval[1])}` : ''}`;
export class CoveragePanel {
  private worker: Worker | null = null;
  private generation = 0;
  private details = document.createElement('details');
  constructor(container: HTMLElement, private request: () => AnalysisRequest) {
    this.details.id = 'pc-coverage';
    this.details.innerHTML = `<summary>Unknown queue coverage</summary><p class="muted">Extend the selected known queue with a bag model. No hidden game seed is read. Bounds retain unresolved searches as unknown.</p><label class="select-row">Future bag model<select id="coverage-model"><option value="boundary">Known pack boundary</option><option value="seven">Assume fresh 7-bag</option><option value="fourteen">Assume fresh 14-bag</option><option value="custom">Supply remaining bag</option></select></label><label class="select-row">Remaining bag<input id="coverage-remaining" value="IJLOSTZ" maxlength="14"></label><label class="select-row">Refill bag<input id="coverage-refill" value="IJLOSTZ" maxlength="14"></label><label class="select-row">Unknown draws<input id="coverage-draws" type="number" min="0" max="24" value="4"></label><label class="select-row">Samples for large spaces<select id="coverage-samples"><option>32</option><option selected>64</option><option>128</option></select></label><button id="coverage-run" class="secondary small">Calculate coverage</button><button id="coverage-stop" class="secondary small" hidden>Cancel coverage</button><p id="coverage-status" role="status"></p><div id="coverage-result"></div>`;
    container.append(this.details);
    this.get('coverage-run').addEventListener('click', () => { try { this.run(); } catch (error) { this.get('coverage-status').textContent = (error as Error).message; } });
    this.get('coverage-stop').addEventListener('click', () => this.cancel());
    this.details.querySelectorAll('input,select').forEach(control => control.addEventListener('change', () => this.cancel()));
  }
  private get<T extends HTMLElement = HTMLElement>(id: string) { return this.details.querySelector<T>(`#${id}`)!; }
  setCombo(enabled: boolean) {
    let row=this.details.querySelector<HTMLElement>('#coverage-combo-options');
    if(!row) { row=document.createElement('label'); row.id='coverage-combo-options'; row.className='select-row'; row.innerHTML='Consecutive clear target<input id="coverage-target" type="number" min="1" max="20" value="3">'; this.get('coverage-run').before(row); row.addEventListener('change',()=>this.cancel()); }
    row.hidden=!enabled;
  }
  cancel() {
    this.generation++; this.worker?.terminate(); this.worker = null; this.get('coverage-stop').hidden = true;
    this.get('coverage-status').textContent = ''; this.get('coverage-result').replaceChildren();
  }
  private run() {
    this.cancel(); const request = this.request(), generation = this.generation, model = this.get<HTMLSelectElement>('coverage-model').value;
    if (request.information === 'seeded') throw new Error('Select pack or visible queue access to study unknown future pieces. Full queue planning already reveals the requested future.');
    let refill = 'ijlostz', remaining = refill;
    if (model === 'boundary') {
      if (request.information !== 'pack' || !request.bag.pack || (request.bag.pack.nextOffset + request.position.next.length) % request.bag.pack.size !== 0) throw new Error('This source has no known future pack boundary. Choose an explicit bag assumption.');
      refill = remaining = 'ijlostz'.repeat(request.bag.pack.size / 7);
    } else if (model === 'fourteen') refill = remaining = 'ijlostzijlostz';
    else if (model === 'custom') { remaining = this.get<HTMLInputElement>('coverage-remaining').value; refill = this.get<HTMLInputElement>('coverage-refill').value; }
    this.get('coverage-status').textContent = `Calculating with ${model === 'boundary' ? 'the known pack boundary' : 'an explicit bag assumption'}…`;
    const worker = new Worker(new URL('./coverage-worker.ts', import.meta.url), { type: 'module' }); this.worker = worker; this.get('coverage-stop').hidden = false;
    worker.onmessage = event => {
      if (generation !== this.generation) return;
      if (event.data.error) { this.cancel(); this.get('coverage-status').textContent = event.data.error; return; }
      const result = event.data.result as CoverageResult; if (result.fingerprint !== request.fingerprint) return;
      this.render(result, !!event.data.done);
      if (event.data.done) { worker.terminate(); this.worker = null; this.get('coverage-stop').hidden = true; this.generation++; }
    };
    worker.onerror = () => { if (generation === this.generation) { this.cancel(); this.get('coverage-status').textContent = 'Coverage worker failed. Try again.'; } };
    worker.postMessage({ request, options: { model: { remaining, refill }, draws: Number(this.get<HTMLInputElement>('coverage-draws').value), samples: Number(this.get<HTMLSelectElement>('coverage-samples').value), seed: 20260914, milliseconds: request.budget.milliseconds, target: Number(this.details.querySelector<HTMLInputElement>('#coverage-target')?.value ?? 3) } });
  }
  private render(result: CoverageResult, done: boolean) {
    this.get('coverage-status').textContent = `${done ? 'Finished' : 'Calculating'} · ${result.mode} · ${result.processed}/${result.total} queues · ${result.solved} solved · ${result.failed} impossible · ${result.unknown} unresolved`;
    const container = this.get('coverage-result'); container.replaceChildren();
    const line = (text: string) => { const p = document.createElement('p'); p.className = 'muted'; p.textContent = text; container.append(p); };
    line(`Clairvoyant queue coverage: ${boundText(result.bound)}`);
    for (const reason of result.reasons) line(reason);
    const first = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = `${result.first.length} first-move comparisons`; first.append(summary);
    for (const item of result.first) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = `${item.action}: ${boundText(item.bound)}`; first.append(p); }
    container.append(first);
    if (result.policy) {
      line(`Finite-Next policy lower bound: ${percent(result.policy.lower)}. Only verified route witnesses are used; other policies may do better.`);
      const tree = document.createElement('details'), title = document.createElement('summary'); title.textContent = 'Verified decision tree'; tree.append(title);
      let count = 0;
      const draw = (nodes: PolicyNode[], parent: HTMLElement) => { for (const node of nodes) { if (++count > 250) return; const branch = document.createElement('details'), label = document.createElement('summary'), observation = document.createElement('p'); label.textContent = `${node.action} · ${percent(node.mass)} total mass`; observation.className = 'muted'; observation.textContent = `Observed board / current / Hold / Next: ${node.observation}`; branch.append(label, observation); parent.append(branch); draw(node.children, branch); } };
      draw(result.policy.nodes, tree); container.append(tree); if (count > 250) line('Tree display limited to 250 nodes.');
    }
  }
}
