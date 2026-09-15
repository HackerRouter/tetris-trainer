import { validateQpProfile, type QpProfile } from './qp-rules';
import type { PressureSettings } from './qp-pressure';
import { reviveCatalog } from './revive-tasks';

export type QpSettings = {
  profile: QpProfile; pressure: PressureSettings; bot: { pps: number; nodes: number; information: 'visible' | 'seeded' };
  trigger: 'none' | 'bot' | 'player' | 'alternate'; triggerSeconds: number; repeat: boolean; tasks: string[]; taskMode: 'sequence' | 'random'; randomTaskCount: number; reviveNoGravity: boolean;
};
export const qpDefaults: QpSettings = {
  profile: { mods: [], allyMods: [] }, pressure: { mode: 'generated', strength: 1, burstiness: .4, tape: null },
  bot: { pps: 1.5, nodes: 12000, information: 'seeded' }, trigger: 'none', triggerSeconds: 12, repeat: true, tasks: [], taskMode: 'sequence', randomTaskCount: 3, reviveNoGravity: false
};
export function validateQpSettings(value: QpSettings) {
  const settings = structuredClone(value);
  settings.taskMode ??= 'sequence'; settings.randomTaskCount ??= 3;
  settings.reviveNoGravity = settings.reviveNoGravity === true;
  settings.profile = validateQpProfile(settings.profile);
  for (const [label, n, min, max] of [['Bot speed', settings.bot?.pps, .1, 10], ['Search nodes', settings.bot?.nodes, 32, 100000], ['Pressure strength', settings.pressure?.strength, 0, 5], ['Burstiness', settings.pressure?.burstiness, 0, 1], ['Practice interval', settings.triggerSeconds, 1, 600]] as const) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  if (!['visible', 'seeded'].includes(settings.bot.information) || !['none', 'generated', 'replay'].includes(settings.pressure.mode) || !['none', 'bot', 'player', 'alternate'].includes(settings.trigger)) throw new Error('Invalid Zenith training option.');
  settings.bot.information = 'seeded';
  settings.bot.nodes = Math.floor(settings.bot.nodes);
  if (!Array.isArray(settings.tasks) || settings.tasks.length > 100 || settings.tasks.some(id => !reviveCatalog.some(task => task.id === id))) throw new Error('Invalid revive task sequence.');
  if (!['sequence', 'random'].includes(settings.taskMode) || !Number.isInteger(settings.randomTaskCount) || settings.randomTaskCount < 1 || settings.randomTaskCount > 3) throw new Error('Choose between one and three random tasks.');
  if (settings.taskMode === 'random' && settings.tasks.length) for (const mods of [settings.profile.mods, settings.profile.allyMods].filter(mods => mods.includes('duo'))) {
    if (!reviveCatalog.some(task => settings.tasks.includes(task.id) && !task.excludes.some(mod => mods.some(active => active === mod)))) throw new Error('The task pool must include a compatible task for each rescuer loadout.');
  }
  if (settings.pressure.mode === 'replay' && !settings.pressure.tape) throw new Error('Import recorded pressure first.');
  return settings;
}
