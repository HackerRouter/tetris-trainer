import type { BagType, Engine, EngineInitializeParams } from '@haelp/teto/engine';
import type { Settings } from './settings';
import roomCatalog from './room-presets.json' with { type: 'json' };

export const rotationSystems = ['SRS+', 'SRS', 'SRS-X', 'NRS', 'ARS', 'ASC', 'TETRA-X', 'none'] as const;
export const spinSystems = ['none', 'T-spins', 'T-spins+', 'all', 'all+', 'all-mini', 'all-mini+', 'handheld', 'stupid'] as const;
export const comboSystems = ['none', 'multiplier', 'classic guideline', 'modern guideline'] as const;
export type AdvancedRules = {
  width: number; height: number; kickSet: typeof rotationSystems[number]; hardDrop: boolean; shadow: boolean;
  gravityIncrease: number; gravityMargin: number; entryDelay: number; lineClearDelay: number;
  handlingOverride: boolean; arr: number; das: number; sdf: number;
  spinBonuses: typeof spinSystems[number]; comboTable: typeof comboSystems[number]; clutch: boolean;
  b2bChaining: boolean; b2bCharging: boolean; allClear: boolean; allClearGarbage: number; allClearB2B: number;
  bombs: boolean; garbageMultiplier: number; garbageIncrease: number; garbageMargin: number;
  garbageSpeed: number; garbageCap: number; garbageCapIncrease: number; garbageCapMax: number; garbageCapMargin: number;
  garbageAbsoluteCap: number; garbageBlocking: 'combo blocking' | 'limited blocking' | 'none'; garbageMessinessWithin: number;
  openerPhase: number; specialBonus: boolean; garbageInterval: number; garbageRows: number; garbageStart: number;
  garbageRefill: number; map: string; sequence: string; repeatSequence: boolean;
};
export const advancedDefaults: AdvancedRules = {
  width: 10, height: 20, kickSet: 'SRS+', hardDrop: true, shadow: true,
  gravityIncrease: 0, gravityMargin: 0, entryDelay: 0, lineClearDelay: 0,
  handlingOverride: false, arr: 2, das: 10, sdf: 6,
  spinBonuses: 'T-spins', comboTable: 'multiplier', clutch: true, b2bChaining: true, b2bCharging: false,
  allClear: false, allClearGarbage: 10, allClearB2B: 0, bombs: false,
  garbageMultiplier: 1, garbageIncrease: 0, garbageMargin: 180, garbageSpeed: 20,
  garbageCap: 8, garbageCapIncrease: 0, garbageCapMax: 40, garbageCapMargin: 0, garbageAbsoluteCap: 0,
  garbageBlocking: 'combo blocking', garbageMessinessWithin: 0, openerPhase: 0, specialBonus: false,
  garbageInterval: 0, garbageRows: 1, garbageStart: 5, garbageRefill: 0, map: '', sequence: '', repeatSequence: false
};

export function validateAdvancedRules(value: unknown): AdvancedRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid advanced rules.');
  const input = { ...advancedDefaults, ...value }, result = structuredClone(advancedDefaults);
  for (const [key, min, max, integer] of [
    ['width', 4, 16, true], ['height', 10, 40, true], ['gravityIncrease', 0, 20, false], ['gravityMargin', 0, 86400, false],
    ['entryDelay', 0, 600, true], ['lineClearDelay', 0, 600, true], ['arr', 0, 20, false], ['das', 0, 20, false], ['sdf', 1, 41, true],
    ['allClearGarbage', 0, 100, false], ['allClearB2B', 0, 100, true], ['garbageMultiplier', 0, 10, false], ['garbageIncrease', 0, 10, false],
    ['garbageMargin', 0, 86400, false], ['garbageSpeed', 0, 600, false], ['garbageCap', 0, 100, false], ['garbageCapIncrease', 0, 10, false],
    ['garbageCapMax', 0, 100, false], ['garbageCapMargin', 0, 86400, false], ['garbageAbsoluteCap', 0, 100, true],
    ['garbageMessinessWithin', 0, 1, false], ['openerPhase', 0, 100, true],
    ['garbageInterval', 0, 3600, false], ['garbageRows', 1, 20, true], ['garbageStart', 0, 86400, false], ['garbageRefill', 0, 38, true]
  ] as const) {
    const n = input[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${key} must be ${min}–${max}${integer ? ', as a whole number' : ''}.`);
    result[key] = n;
  }
  for (const key of ['hardDrop', 'shadow', 'handlingOverride', 'clutch', 'b2bChaining', 'b2bCharging', 'allClear', 'bombs', 'specialBonus', 'repeatSequence'] as const) {
    if (typeof input[key] !== 'boolean') throw new Error(`Invalid ${key} option.`);
    result[key] = input[key];
  }
  if (!rotationSystems.includes(input.kickSet) || !spinSystems.includes(input.spinBonuses) || !comboSystems.includes(input.comboTable) || !['combo blocking', 'limited blocking', 'none'].includes(input.garbageBlocking)) throw new Error('Unsupported rotation, spin, combo or garbage rule.');
  result.kickSet = input.kickSet; result.spinBonuses = input.spinBonuses; result.comboTable = input.comboTable; result.garbageBlocking = input.garbageBlocking;
  if (typeof input.sequence !== 'string' || input.sequence.length > 4000 || !/^[IJLOSTZ\s]*$/i.test(input.sequence)) throw new Error('Sequence must contain only I, J, L, O, S, T and Z (up to 4,000 characters).');
  result.sequence = input.sequence.replace(/\s/g, '').toLowerCase();
  if (typeof input.map !== 'string' || input.map.length > 2000) throw new Error('Board map is too large.');
  result.map = input.map.trim().replace(/\r/g, '').toLowerCase();
  if (result.map) {
    const rows = result.map.split('\n');
    if (rows.length > result.height - 2 || rows.some(row => row.length !== result.width || !/^[ijlostz._#*]+$/.test(row))) throw new Error(`Map rows must be ${result.width} cells wide, at most ${result.height - 2} rows high, using IJLOSTZ, . or _, # and *.`);
  }
  if (result.garbageRefill > result.height - 2) throw new Error('Garbage refill must leave at least two empty rows.');
  return result;
}

export const randomizers = ['7-bag', '14-bag', 'classic', 'pairs', 'total mayhem', '7+1-bag', '7+2-bag', '7+x-bag'] as const;
export type ModeId = 'sprint' | 'custom';
export type CustomRules = {
  gravity: number; lockDelay: number; lockResets: number; infiniteLock: boolean;
  bag: BagType; seed: number; lineGoal: number; pieceGoal: number; timeLimit: number;
  hold: boolean; infiniteHold: boolean; allow180: boolean; nextCount: number;
  initialGarbage: number; garbageMessiness: number; topout: 'stop' | 'clear';
  finesse: boolean; undo: boolean;
  advanced: AdvancedRules; roomPreset: string;
};
export const customDefaults: CustomRules = {
  gravity: 0, lockDelay: 30, lockResets: 15, infiniteLock: true,
  bag: '7-bag', seed: 0, lineGoal: 0, pieceGoal: 0, timeLimit: 0,
  hold: true, infiniteHold: true, allow180: true, nextCount: 5,
  initialGarbage: 0, garbageMessiness: 1, topout: 'clear', finesse: false, undo: true,
  advanced: structuredClone(advancedDefaults), roomPreset: ''
};
export type ModeRules = {
  id: ModeId; name: string;
  board: EngineInitializeParams['board']; bag: BagType;
  gravity: number; lockDelay: number; lockResets: number; infiniteLock: boolean;
  goals: { lines: number; pieces: number; seconds: number };
  hold: boolean; infiniteHold: boolean; allow180: boolean; nextCount: number;
  setup: { kind: 'empty' | 'garbage' | 'map'; rows: number; messiness: number };
  topout: 'stop' | 'clear'; finesse: boolean; undo: boolean;
  advanced: AdvancedRules; sourcePreset: string;
};
export type ModeDefinition = { name: string; rules: (settings: Settings) => ModeRules };

export function validateCustomRules(value: unknown): CustomRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid custom mode settings.');
  const input = value as Record<string, unknown>, result = structuredClone(customDefaults);
  for (const [key, min, max, integer] of [
    ['gravity', 0, 20, false], ['lockDelay', 0, 600, false], ['lockResets', 0, 100, true],
    ['seed', 0, 2147483646, true], ['lineGoal', 0, 100000, true], ['pieceGoal', 0, 100000, true], ['timeLimit', 0, 86400, false],
    ['nextCount', 0, 6, true], ['initialGarbage', 0, 38, true], ['garbageMessiness', 0, 1, false]
  ] as const) {
    const n = input[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${key} must be ${min}–${max}${integer ? ', as a whole number' : ''}.`);
    result[key] = n;
  }
  for (const key of ['infiniteLock', 'hold', 'infiniteHold', 'allow180', 'finesse', 'undo'] as const) {
    if (typeof input[key] !== 'boolean') throw new Error(`Invalid custom ${key} option.`);
    result[key] = input[key];
  }
  if (!randomizers.includes(input.bag as BagType)) throw new Error('Unsupported custom randomizer.');
  result.bag = input.bag as BagType;
  if (input.topout !== 'stop' && input.topout !== 'clear') throw new Error('Choose a top-out behavior.');
  result.topout = input.topout;
  result.advanced = validateAdvancedRules(input.advanced ?? advancedDefaults);
  if (input.roomPreset !== undefined && (typeof input.roomPreset !== 'string' || (input.roomPreset !== '' && !Object.hasOwn(roomCatalog.presets, input.roomPreset)))) throw new Error('Unknown source room preset.');
  result.roomPreset = typeof input.roomPreset === 'string' ? input.roomPreset : '';
  if (!result.advanced.hardDrop && result.infiniteLock) throw new Error('Manual locking requires hard drop. Enable hard drop or allow automatic locking.');
  if (result.initialGarbage > result.advanced.height - 2) throw new Error('Starting garbage must leave at least two empty rows.');
  return result;
}

export const modeDefinitions: Record<ModeId, ModeDefinition> = {
  sprint: { name: '40L Sprint', rules: settings => ({
    id: 'sprint', name: '40 LINE SPRINT', board: { width: 10, height: 20, buffer: 20 }, bag: '7-bag',
    gravity: .02, lockDelay: 30, lockResets: 15, infiniteLock: false,
    goals: { lines: 40, pieces: 0, seconds: 0 }, hold: true, infiniteHold: settings.training.infiniteHold, allow180: true, nextCount: 5,
    setup: { kind: 'empty', rows: 0, messiness: 1 }, topout: 'stop', finesse: settings.training.finesseEnabled, undo: settings.training.undoEnabled,
    advanced: structuredClone(advancedDefaults), sourcePreset: ''
  }) },
  custom: { name: 'Custom', rules: settings => {
    const config = validateCustomRules(settings.custom);
    return {
      id: 'custom', name: config.roomPreset ? `${roomPresetNames[config.roomPreset]} · SOLO` : 'CUSTOM PRACTICE', board: { width: config.advanced.width, height: config.advanced.height, buffer: 20 }, bag: config.bag,
      gravity: config.gravity, lockDelay: config.lockDelay, lockResets: config.lockResets, infiniteLock: config.infiniteLock,
      goals: { lines: config.lineGoal, pieces: config.pieceGoal, seconds: config.timeLimit },
      hold: config.hold, infiniteHold: config.infiniteHold, allow180: config.allow180, nextCount: config.nextCount,
      setup: { kind: config.advanced.map ? 'map' : config.initialGarbage ? 'garbage' : 'empty', rows: config.initialGarbage, messiness: config.garbageMessiness },
      topout: config.topout, finesse: config.finesse, undo: config.undo, advanced: config.advanced, sourcePreset: config.roomPreset
    };
  } }
};

export const customPresets: Record<string, { name: string; rules: CustomRules }> = {
  zen: { name: 'Zen / free play', rules: structuredClone(customDefaults) },
  sprint: { name: '40-line challenge', rules: { ...customDefaults, gravity: .02, infiniteLock: false, infiniteHold: false, topout: 'stop', lineGoal: 40 } },
  downstack: { name: 'Garbage clear / endless downstack', rules: { ...customDefaults, initialGarbage: 10, infiniteHold: false, advanced: { ...advancedDefaults, garbageRefill: 10 } } },
  timed: { name: 'Two-minute session', rules: { ...customDefaults, gravity: .02, infiniteLock: false, timeLimit: 120 } }
};

export const roomPresetNames: Record<string, string> = { default: 'DEFAULT', 'tetra league': 'TETRA LEAGUE', 'tetra league (season 1)': 'TETRA LEAGUE (SEASON 1)', 'enforced delays': 'ENFORCED DELAYS', '4wide': '4-WIDE', '100 battle royale': '100 BATTLE ROYALE', classic: 'CLASSIC', arcade: 'ARCADE', bombs: 'BOMBS', quickplay: 'LEGACY QUICK PLAY' };
export const roomPresetSource = { url: roomCatalog.url, capturedAt: roomCatalog.capturedAt, sha256: roomCatalog.sha256 };

export function roomPreset(id: string): CustomRules {
  const raw = (roomCatalog.presets as Record<string, Record<string, string>>)[id];
  if (!raw) throw new Error('Unknown room preset.');
  const rules = structuredClone(customDefaults), a = rules.advanced;
  const number = (key: string, fallback: number) => raw[`options.${key}`] === undefined ? fallback : Number(raw[`options.${key}`]);
  const flag = (key: string, fallback: boolean) => number(key, Number(fallback)) !== 0;
  rules.roomPreset = id; rules.infiniteLock = false; rules.infiniteHold = false; rules.topout = 'stop';
  rules.bag = raw['options.bagtype'] as BagType; rules.gravity = number('g', .02); rules.lockDelay = number('locktime', 30);
  rules.allow180 = flag('allow180', true); rules.hold = flag('display_hold', true); rules.nextCount = number('nextcount', 5);
  rules.garbageMessiness = number('messiness_change', 1);
  a.width = number('boardwidth', 10); a.height = number('boardheight', 20); a.kickSet = raw['options.kickset'] as AdvancedRules['kickSet'];
  a.hardDrop = flag('allow_harddrop', true); a.shadow = flag('display_shadow', true);
  a.gravityIncrease = number('gincrease', 0); a.gravityMargin = number('gmargin', 0) / 60;
  a.entryDelay = number('are', 0); a.lineClearDelay = number('lineclear_are', 0);
  a.handlingOverride = flag('room_handling', false); a.arr = number('room_handling_arr', 2); a.das = number('room_handling_das', 10); a.sdf = number('room_handling_sdf', 6);
  a.spinBonuses = raw['options.spinbonuses'] as AdvancedRules['spinBonuses']; a.comboTable = raw['options.combotable'] as AdvancedRules['comboTable'];
  a.clutch = flag('clutch', true); a.b2bChaining = flag('b2bchaining', false); a.b2bCharging = flag('b2bcharging', false);
  a.allClear = flag('allclears', false); a.allClearGarbage = number('allclear_garbage', 10); a.allClearB2B = number('allclear_b2b', 0);
  a.bombs = flag('usebombs', false); a.garbageMultiplier = number('garbagemultiplier', 1); a.garbageIncrease = number('garbageincrease', 0); a.garbageMargin = number('garbagemargin', 0) / 60;
  a.garbageSpeed = number('garbagespeed', 20); a.garbageCap = number('garbagecap', 8); a.garbageCapIncrease = number('garbagecapincrease', 0); a.garbageCapMax = number('garbagecapmax', 40); a.garbageCapMargin = number('garbagecapmargin', 0) / 60;
  a.garbageAbsoluteCap = number('garbageabsolutecap', 0); a.garbageBlocking = raw['options.garbageblocking'] as AdvancedRules['garbageBlocking'];
  a.garbageMessinessWithin = number('messiness_inner', 0); a.openerPhase = number('openerphase', 0); a.specialBonus = flag('garbagespecialbonus', false);
  if (a.bombs) { rules.initialGarbage = 6; a.garbageInterval = 5; a.garbageRows = 2; }
  return validateCustomRules(rules);
}

export function exportPreset(rules: CustomRules) { return { format: 'tetrio-trainer-preset', version: 1, rules: validateCustomRules(rules), source: rules.roomPreset ? { ...roomPresetSource, native: (roomCatalog.presets as Record<string, unknown>)[rules.roomPreset] } : null }; }
export function importPreset(value: unknown) {
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'tetrio-trainer-preset' || !('version' in value) || value.version !== 1 || !('rules' in value)) throw new Error('Choose a version 1 trainer preset JSON file.');
  return validateCustomRules(value.rules);
}

export function applyModeSetup(engine: Engine, rules: ModeRules, seed: number) {
  if (rules.setup.kind === 'map') {
    rules.advanced.map.split('\n').reverse().forEach((row, y) => [...row].forEach((cell, x) => {
      engine.board.state[y][x] = cell === '.' || cell === '_' ? null : { mino: (cell === '#' ? 'gb' : cell === '*' ? 'bomb' : cell) as typeof engine.falling.symbol, connections: 0 };
    }));
    return;
  }
  if (rules.setup.kind !== 'garbage') return;
  let state = seed;
  const random = () => { state = state * 16807 % 2147483647; return (state - 1) / 2147483646; };
  let hole = Math.floor(random() * engine.board.width);
  for (let y = 0; y < rules.setup.rows; y++) {
    if (y && random() < rules.setup.messiness) hole = (hole + 1 + Math.floor(random() * (engine.board.width - 1))) % engine.board.width;
    for (let x = 0; x < engine.board.width; x++) engine.board.state[y][x] = x === hole && !rules.advanced.bombs ? null : { mino: (x === hole ? 'bomb' : 'gb') as typeof engine.falling.symbol, connections: 0 };
  }
}

export function reachedGoal(rules: ModeRules, stats: { lines: number; pieces: number }, elapsedMs: number) {
  return (rules.goals.lines > 0 && stats.lines >= rules.goals.lines) || (rules.goals.pieces > 0 && stats.pieces >= rules.goals.pieces) || (rules.goals.seconds > 0 && elapsedMs >= rules.goals.seconds * 1000);
}
