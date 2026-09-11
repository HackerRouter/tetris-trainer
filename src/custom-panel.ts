import { customDefaults, customPresets, exportPreset, importPreset, randomizers, roomPreset, roomPresetNames, roomPresetSource, validateCustomRules, type CustomRules } from './modes';
import { advancedForm, ruleChecks, ruleNumbers, ruleSelects } from './rule-fields';
import { downloadJson } from './settings';

const numericFields = [
  ['gravity', 'Gravity', 'Cells per frame. 0 = no gravity.', 0, 20, .01],
  ['lockDelay', 'Lock delay', 'Frames on the floor before auto-lock. 60 frames = 1 second.', 0, 600, 1],
  ['lockResets', 'Lock resets', 'Moves or rotations that reset the lock timer.', 0, 100, 1],
  ['nextCount', 'Next pieces', 'Number of visible previews.', 0, 6, 1],
  ['seed', 'Random seed', '0 = a new seed each session. Reuse a seed for the same opening.', 0, 2147483646, 1],
  ['initialGarbage', 'Starting garbage', 'Rows at the bottom. Leave at least two empty rows.', 0, 38, 1],
  ['garbageMessiness', 'Garbage messiness', '0 = one straight well. 1 = a different hole every row.', 0, 1, .05],
  ['lineGoal', 'Line goal', '0 = no line goal.', 0, 100000, 1],
  ['pieceGoal', 'Piece goal', 'Accepted placements. 0 = no piece goal.', 0, 100000, 1],
  ['timeLimit', 'Time limit', 'Seconds. 0 = no time limit. Uses the rollback-aware timer.', 0, 86400, 1]
] as const;
const booleanFields = [
  ['infiniteLock', 'Manual locking only'], ['hold', 'Allow hold'], ['infiniteHold', 'Unlimited hold'],
  ['allow180', 'Allow 180° rotation'], ['undo', 'Allow undo with Ctrl + Z']
] as const;

export class CustomPanel {
  private dialog = document.createElement('dialog');
  private form: HTMLFormElement;
  private status: HTMLElement;
  private finesse = false;
  private draft = structuredClone(customDefaults);

  constructor(private save: (rules: CustomRules) => void, private close: (saved: boolean) => void) {
    this.dialog.id = 'custom-dialog'; this.dialog.setAttribute('aria-labelledby', 'custom-title');
    const numbers = (keys: string[]) => numericFields.filter(([key]) => keys.includes(key)).map(([key, label, hint, min, max, step]) => `<label class="custom-number" for="custom-${key}"><span>${label}<small>${hint}</small></span><input id="custom-${key}" type="number" min="${min}" max="${max}" step="${step}" required></label>`).join('');
    this.dialog.innerHTML = `<form id="custom-form" novalidate>
      <header><div><span class="eyebrow">YOUR RULES, YOUR PACE</span><h2 id="custom-title">Custom mode</h2></div><button type="button" id="custom-cancel" class="secondary">Cancel</button></header>
      <p class="muted">Free play, a goal challenge, or solo practice with TETR.IO room rules. Bindings and countdown follow Settings; some presets enforce room handling.</p>
      <label class="select-row" for="custom-preset">Load a preset<select id="custom-preset"><option value="">Choose a preset…</option><optgroup label="Trainer presets">${Object.entries(customPresets).map(([key, value]) => `<option value="${key}">${value.name}</option>`).join('')}</optgroup><optgroup label="TETR.IO room presets · Solo">${Object.entries(roomPresetNames).map(([key, label]) => `<option value="room:${key}">${label}</option>`).join('')}</optgroup></select></label>
      <p id="custom-source" class="muted"></p>
      <div class="preset-files"><button type="button" id="custom-import" class="secondary">Import preset</button><button type="button" id="custom-export" class="secondary">Export preset</button><input id="custom-file" type="file" accept=".json,application/json" hidden></div>
      <div class="settings-columns"><section><h3>Movement and controls</h3>
      ${numbers(['gravity', 'lockDelay', 'lockResets'])}
      ${booleanFields.map(([key, label]) => `<label class="check-row"><input id="custom-${key}" type="checkbox">${label}</label>`).join('')}
      <p class="muted">Use the main page's Perfect finesse switch to enable automatic retries. A disabled 180° rotation is excluded from hints.</p>
      </section><section><h3>Queue and board</h3>
      <label class="select-row" for="custom-bag">Randomizer<select id="custom-bag">${randomizers.map(bag => `<option value="${bag}">${bag}</option>`).join('')}</select></label>
      ${numbers(['nextCount', 'seed', 'initialGarbage', 'garbageMessiness'])}
      <label class="select-row" for="custom-topout">On top out<select id="custom-topout"><option value="clear">Clear board and continue</option><option value="stop">End session</option></select></label>
      <h3>Session goals</h3><p class="muted">Leave all goals at 0 for endless play. Reaching any enabled goal ends the session.</p>
      ${numbers(['lineGoal', 'pieceGoal', 'timeLimit'])}</section></div>
      <h3>Advanced rules</h3>${advancedForm()}
      <p id="custom-status" class="muted" role="status"></p><footer><span class="muted">Single-player training · Changes start a new session</span><button type="submit" id="custom-start">Save and start</button></footer>
    </form>`;
    document.body.append(this.dialog);
    this.form = this.dialog.querySelector('form')!; this.status = this.dialog.querySelector('#custom-status')!;
    this.dialog.querySelector('#custom-cancel')!.addEventListener('click', () => this.finish(false));
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.finish(false); });
    this.field('preset').addEventListener('change', () => {
      const key = this.field('preset').value;
      const preset = key.startsWith('room:') ? { name: roomPresetNames[key.slice(5)], rules: roomPreset(key.slice(5)) } : customPresets[key];
      if (preset) { this.fill({ ...preset.rules, finesse: this.finesse }); this.status.textContent = `${preset.name} loaded. Adjust the rules, then start.`; }
    });
    this.field('import').addEventListener('click', () => this.field<HTMLInputElement>('file').click());
    this.field('export').addEventListener('click', () => {
      try { downloadJson(exportPreset(this.read()), `trainer-preset-${Date.now()}.json`); this.status.textContent = 'Preset exported.'; }
      catch (error) { this.status.textContent = (error as Error).message; }
    });
    this.field('file').addEventListener('change', async () => {
      const input = this.field<HTMLInputElement>('file'), file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > 1_000_000) throw new Error('Preset files must be smaller than 1 MB.');
        this.fill({ ...importPreset(JSON.parse(await file.text())), finesse: this.finesse });
        this.field('preset').value = ''; this.status.textContent = 'Preset imported. Review the rules, then save and start.';
      } catch (error) { this.status.textContent = `Import failed: ${(error as Error).message}`; }
      input.value = '';
    });
    this.form.addEventListener('input', () => { this.dependencies(); this.status.textContent = 'Changes apply when you save and start a new session.'; });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        this.save(this.read()); this.finish(true);
      } catch (error) { this.status.textContent = (error as Error).message; }
    });
  }

  get open() { return this.dialog.open; }
  show(rules: CustomRules) { this.fill(rules); this.field('preset').value = ''; this.status.textContent = ''; this.dialog.showModal(); }
  private field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement = HTMLInputElement>(key: string) { return this.form.querySelector<T>(`#custom-${key}`)!; }
  private read() {
    const rules: Record<string, unknown> = { ...this.draft, finesse: this.finesse }, advanced: Record<string, unknown> = { ...this.draft.advanced };
    for (const [key] of numericFields) rules[key] = this.field(key).value === '' ? NaN : Number(this.field(key).value);
    for (const [key] of booleanFields) rules[key] = this.field<HTMLInputElement>(key).checked;
    rules.bag = this.field('bag').value; rules.topout = this.field('topout').value;
    for (const [key] of ruleNumbers) advanced[key] = this.field(key).value === '' ? NaN : Number(this.field(key).value);
    for (const [key] of ruleChecks) advanced[key] = this.field<HTMLInputElement>(key).checked;
    for (const [key] of ruleSelects) advanced[key] = this.field(key).value;
    advanced.map = this.field('map').value; advanced.sequence = this.field('sequence').value;
    return validateCustomRules({ ...rules, advanced });
  }
  private fill(rules: CustomRules) {
    this.draft = structuredClone(rules);
    this.finesse = rules.finesse;
    for (const [key] of numericFields) this.field(key).value = String(rules[key]);
    for (const [key] of booleanFields) this.field<HTMLInputElement>(key).checked = rules[key];
    for (const [key] of ruleNumbers) this.field(key).value = String(rules.advanced[key]);
    for (const [key] of ruleChecks) this.field<HTMLInputElement>(key).checked = rules.advanced[key];
    for (const [key] of ruleSelects) this.field(key).value = rules.advanced[key];
    this.field('map').value = rules.advanced.map; this.field('sequence').value = rules.advanced.sequence;
    this.form.querySelector('#custom-source')!.textContent = rules.roomPreset ? `Based on ${roomPresetNames[rules.roomPreset]} from the supplied TETR.IO client (${roomPresetSource.capturedAt.slice(0, 10)}). Solo adaptation: no opponents, targeting, badges or match rounds. ${rules.roomPreset === 'bombs' ? 'BOMBS adds six starting rows and two incoming rows every five seconds for solo practice; adjust below.' : 'Incoming pressure is off until configured below.'}${rules.roomPreset === '100 battle royale' ? ' Battle Royale delayed garbage entry, attack caps and target bonuses are retained in preset exports but are not simulated.' : ''}` : 'Trainer presets use freely adjustable single-player rules.';
    this.field('bag').value = rules.bag; this.field('topout').value = rules.topout; this.dependencies();
  }
  private dependencies() {
    this.field('lockDelay').disabled = this.field('lockResets').disabled = this.field<HTMLInputElement>('infiniteLock').checked;
    this.field('infiniteHold').disabled = !this.field<HTMLInputElement>('hold').checked;
    for (const key of ['arr', 'das', 'sdf']) this.field(key).disabled = !this.field<HTMLInputElement>('handlingOverride').checked;
  }
  private finish(saved: boolean) { this.dialog.close(); this.close(saved); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }
}
