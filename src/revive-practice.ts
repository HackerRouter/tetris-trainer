import type { QpSettings } from './qp-config';
import { qpDefaults, validateQpSettings } from './qp-config';
import type { QuickPlayRuntime } from './qp-runtime';
import { reviveCatalog, type ReviveState } from './revive-tasks';

export const revivePreferencesKey = 'tetrio-trainer-revive-preferences-v1';
export const reviveRecordsKey = 'tetrio-trainer-revive-records-v1';
export type ReviveAttempt = { task: string; result: 'completed' | 'topout' | 'interrupted'; frames: number; resets: number; date: string };
export function reviveDefaults(): QpSettings {
  return { ...structuredClone(qpDefaults), profile: { mods: ['duo'], allyMods: ['duo'] }, pressure: { ...qpDefaults.pressure, mode: 'none' }, tasks: ['f-rotate-20'], trigger: 'bot', triggerSeconds: 1, repeat: false };
}
export function loadRevivePreferences(storage: Pick<Storage, 'getItem'>) {
  try { const config = validateQpSettings(JSON.parse(storage.getItem(revivePreferencesKey) || 'null')); if (config.profile.mods.includes('duo')) return config; } catch {}
  return reviveDefaults();
}
export function readReviveRecords(storage: Pick<Storage, 'getItem'>): ReviveAttempt[] {
  try {
    const records = JSON.parse(storage.getItem(reviveRecordsKey) || '[]');
    if (Array.isArray(records)) return records.filter(record => reviveCatalog.some(task => task.id === record?.task) && ['completed', 'topout', 'interrupted'].includes(record.result) && Number.isFinite(record.frames) && Number.isFinite(record.resets) && typeof record.date === 'string').slice(-2000);
  } catch {}
  return [];
}
export class RevivePracticeTracker {
  private runtime: QuickPlayRuntime | null = null;
  private task: ReviveState | null = null;
  private active = 0;
  private resets = 0;
  constructor(private record: (attempt: ReviveAttempt) => void) {}
  private finish(result: ReviveAttempt['result'], frame: number) {
    const prompt = this.task?.prompts[this.active]; if (!prompt) return;
    this.record({ task: prompt.task, result, frames: Math.max(0, frame - prompt.activatedAt), resets: Math.max(0, this.task!.resets - this.resets), date: new Date().toISOString() });
    this.resets = this.task!.resets; this.active++;
  }
  update(runtime: QuickPlayRuntime | null) {
    if (this.runtime !== runtime) {
      if (this.runtime && this.task) {
        while (this.active < this.task.active) this.finish('completed', this.task.frame);
        if (this.active < this.task.prompts.length) this.finish('interrupted', this.runtime.frame);
      }
      this.runtime = runtime; this.task = null;
    }
    if (!runtime) return;
    const side = runtime.sides[0];
    if (this.task) {
      while (this.active < this.task.active) this.finish('completed', this.task.frame);
      if (runtime.over || side.life !== 'alive') { if (this.active < this.task.prompts.length) this.finish(runtime.stopped ? 'interrupted' : 'topout', runtime.frame); this.task = null; return; }
    }
    if (!runtime.over && side.life === 'alive' && side.task !== this.task) { this.task = side.task; this.active = side.task?.active ?? 0; this.resets = side.task?.resets ?? 0; }
  }
}
