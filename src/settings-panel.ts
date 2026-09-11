import { actions, bindingCodes, bindingLabel, defaults, downloadJson, keyLabel, validCode, validateSettings, type Action, type Settings } from './settings';
import { importSettingsFile, importTetrioConfig, type ConfigImport } from './tetrio-config';

export class SettingsPanel {
  private dialog = document.querySelector<HTMLDialogElement>('#settings-dialog')!;
  private form = document.querySelector<HTMLFormElement>('#settings-form')!;
  private status = document.querySelector<HTMLElement>('#settings-status')!;
  private draft = structuredClone(defaults);
  private capturing: Action | null = null;

  constructor(private save: (settings: Settings) => void, private close: () => void) {
    const sdf = this.field<HTMLSelectElement>('sdf');
    sdf.replaceChildren(...Array.from({ length: 41 }, (_, i) => new Option(i === 40 ? 'Instant' : `${i + 1}×`, String(i + 1))));
    const bindings = document.querySelector('#bindings')!;
    for (const action of Object.keys(actions) as Action[]) {
      const row = document.createElement('div'); row.className = 'binding-row';
      const label = document.createElement('label'); label.htmlFor = `bind-${action}`; label.textContent = actions[action];
      const button = document.createElement('button'); button.type = 'button'; button.id = `bind-${action}`; button.className = 'key-button';
      button.addEventListener('click', () => { this.capturing = action; this.drawBindings(); this.setStatus('Press a key. Escape cancels; use the Bind Escape button to assign Escape.'); });
      row.append(label, button); bindings.append(row);
    }
    document.addEventListener('keydown', event => {
      if (!this.dialog.open || !this.capturing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') { this.capturing = null; this.drawBindings(); this.setStatus('Key capture cancelled.'); return; }
      this.capture(event.code);
    }, true);
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.finish(); });
    document.querySelector('#cancel-settings')!.addEventListener('click', () => this.finish());
    document.querySelector('#bind-escape')!.addEventListener('click', () => { if (this.capturing) this.capture('Escape'); else this.setStatus('Select an action first.'); });
    document.querySelector('#clear-binding')!.addEventListener('click', () => {
      if (!this.capturing) { this.setStatus('Select an action first.'); return; }
      this.draft.bindings[this.capturing] = '';
      if (this.draft.extraBindings) delete this.draft.extraBindings[this.capturing];
      this.capturing = null; this.drawBindings(); this.setStatus('Binding cleared. Save to apply.');
    });
    document.querySelector('#reset-settings')!.addEventListener('click', () => { this.fill(defaults); this.setStatus('Defaults loaded. Save to apply.'); });
    this.form.addEventListener('input', () => { this.updateUnits(); this.setStatus('Unsaved changes. Save to apply to the next game.'); });
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      try { this.save(this.read()); this.finish(); } catch (error) { this.setStatus(String((error as Error).message), true); }
    });
    document.querySelector('#export-settings')!.addEventListener('click', () => {
      try { downloadJson(this.read(), 'trainer-settings.json'); } catch (error) { this.setStatus((error as Error).message, true); }
    });
    const file = document.querySelector<HTMLInputElement>('#settings-file')!;
    document.querySelector('#import-settings')!.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const selected = file.files?.[0]; if (selected) await this.importFile(selected);
      file.value = '';
    });
  }

  get open() { return this.dialog.open; }
  show(settings: Settings) { this.fill(settings); this.setStatus('Saved changes apply to the next game.'); this.dialog.showModal(); }
  chooseFile() { document.querySelector<HTMLInputElement>('#settings-file')!.click(); }
  async importFile(file: File) {
    try {
      if (!/\.(ttc|json)$/i.test(file.name)) throw new Error('Choose a TETR.IO .ttc or trainer settings .json file.');
      if (file.size > 1_000_000) throw new Error('Settings files must be smaller than 1 MB.');
      const result = importSettingsFile(JSON.parse((await file.text()).replace(/^\uFEFF/, '')), this.read());
      if (!this.dialog.open) return;
      this.fill(result.settings);
      if ('applied' in result) {
        this.showReport(result);
        this.setStatus(`TETR.IO config imported: ${result.applied.length} options mapped; ${result.retained.length} retained only. Save to apply to the next game.${result.warnings.length ? ' Review the import details below.' : ''}`);
      } else this.setStatus('Settings imported. Save to apply.');
    } catch (error) { if (this.dialog.open) this.setStatus(`Import failed: ${(error as Error).message}`, true); }
  }
  importError(message: string) { this.setStatus(`Import failed: ${message}`, true); }
  private finish() { this.capturing = null; this.dialog.close(); this.close(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }
  private setStatus(text: string, error = false) { this.status.textContent = text; this.status.className = error ? 'error' : ''; }
  private field<T extends HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLOutputElement = HTMLInputElement>(id: string) { return this.form.querySelector<T>(`#${id}`)!; }

  private capture(code: string) {
    if (!this.capturing) return;
    if (!validCode(code)) { this.setStatus('This key is not supported. Choose a letter, arrow, number, modifier or navigation key.', true); return; }
    const conflict = (Object.keys(actions) as Action[]).find(action => action !== this.capturing && bindingCodes(this.draft, action).includes(code));
    if (conflict) { this.setStatus(`${keyLabel(code)} is assigned to ${actions[conflict]}. Choose another key.`, true); return; }
    this.draft.bindings[this.capturing] = code;
    if (this.draft.extraBindings) delete this.draft.extraBindings[this.capturing];
    this.capturing = null; this.drawBindings(); this.setStatus('Key assigned. Save to apply.');
  }

  private drawBindings() {
    for (const action of Object.keys(actions) as Action[]) {
      const button = this.field<HTMLButtonElement>(`bind-${action}`);
      button.textContent = this.capturing === action ? 'Press a key…' : bindingLabel(this.draft, action);
      button.classList.toggle('capturing', this.capturing === action);
    }
  }

  private fill(settings: Settings) {
    this.draft = structuredClone(settings); this.capturing = null;
    for (const key of ['arr', 'das', 'dcd', 'sdf', 'irs', 'ihs'] as const) this.field(key).value = String(settings.handling[key]);
    for (const key of ['cancel', 'safelock', 'may20g'] as const) this.field<HTMLInputElement>(key).checked = settings.handling[key];
    for (const key of ['grid', 'ghost', 'coloredGhost', 'dimLockedHold'] as const) this.field<HTMLInputElement>(key).checked = settings.display[key];
    for (const key of ['ghostOpacity', 'gridOpacity', 'boardOpacity'] as const) this.field(key).value = String(settings.display[key] * 100);
    this.field('countdownSeconds').value = String(settings.training.countdownSeconds);
    this.field('audio-volume').value = String(settings.audio.volume * 100);
    this.field<HTMLInputElement>('audio-enabled').checked = settings.audio.enabled;
    this.field<HTMLInputElement>('audio-ui').checked = settings.audio.ui;
    for (const key of ['allowDifferentTarget', 'undoEnabled', 'infiniteHold', 'strictPractice'] as const) this.field<HTMLInputElement>(key).checked = settings.training[key];
    this.drawBindings(); this.updateUnits();
    document.querySelector<HTMLElement>('#config-report')!.hidden = true;
    if (settings.tetrioConfig) {
      try { this.showReport(importTetrioConfig(settings.tetrioConfig, settings)); } catch {}
    }
  }

  private showReport(report: ConfigImport) {
    document.querySelector<HTMLElement>('#config-report')!.hidden = false;
    document.querySelector('#config-applied')!.textContent = report.applied.join(', ') || 'No settings mapped.';
    document.querySelector('#config-retained')!.textContent = report.retained.join(', ') || 'None.';
    document.querySelector('#config-warnings')!.textContent = report.warnings.join(' ');
  }

  private updateUnits() {
    for (const key of ['arr', 'das', 'dcd']) {
      const value = Number(this.field(key).value);
      this.field<HTMLOutputElement>(`${key}-unit`).textContent = key === 'arr' && value === 0 ? 'Instant' : `${(value * 1000 / 60).toFixed(1)} ms`;
    }
    document.querySelector('#opacity-unit')!.textContent = `${this.field('ghostOpacity').value}%`;
    document.querySelector('#audio-volume-unit')!.textContent = `${this.field('audio-volume').value}%`;
    for (const key of ['gridOpacity', 'boardOpacity']) document.querySelector(`#${key}-unit`)!.textContent = `${this.field(key).value}%`;
  }

  private read(): Settings {
    const result = structuredClone(this.draft);
    result.audio = { enabled: this.field<HTMLInputElement>('audio-enabled').checked, volume: Number(this.field('audio-volume').value) / 100, ui: this.field<HTMLInputElement>('audio-ui').checked };
    for (const key of ['arr', 'das', 'dcd', 'sdf'] as const) {
      const value = this.field(key).value;
      result.handling[key] = value === '' ? NaN : Number(value);
    }
    for (const key of ['irs', 'ihs'] as const) result.handling[key] = this.field(key).value as Settings['handling']['irs'];
    for (const key of ['cancel', 'safelock', 'may20g'] as const) result.handling[key] = this.field<HTMLInputElement>(key).checked;
    for (const key of ['grid', 'ghost', 'coloredGhost', 'dimLockedHold'] as const) result.display[key] = this.field<HTMLInputElement>(key).checked;
    for (const key of ['ghostOpacity', 'gridOpacity', 'boardOpacity'] as const) result.display[key] = Number(this.field(key).value) / 100;
    result.training.countdownSeconds = this.field('countdownSeconds').value === '' ? NaN : Number(this.field('countdownSeconds').value);
    for (const key of ['allowDifferentTarget', 'undoEnabled', 'infiniteHold', 'strictPractice'] as const) result.training[key] = this.field<HTMLInputElement>(key).checked;
    return validateSettings(result);
  }
}
