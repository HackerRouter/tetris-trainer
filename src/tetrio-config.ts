import { actions, defaults, validCode, validateSettings, type Action, type Settings } from './settings';

type ObjectValue = Record<string, unknown>;
export type ConfigImport = { settings: Settings; applied: string[]; retained: string[]; warnings: string[] };
export type ConfigAdapter = { path: string; apply: (settings: Settings, value: unknown) => void };

const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const numeric = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
const boolean = (value: unknown): boolean => { if (typeof value !== 'boolean') throw new Error('Expected true or false.'); return value; };
const opacity = (value: unknown): number => { const n = numeric(value); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('Opacity must be between 0 and 1.'); return n; };

export const tetrioConfigAdapters: ConfigAdapter[] = [
  ...(['arr', 'das', 'dcd', 'sdf'] as const).map(key => ({ path: `handling.${key}`, apply: (settings: Settings, value: unknown) => { settings.handling[key] = numeric(value); } })),
  ...(['cancel', 'safelock', 'may20g'] as const).map(key => ({ path: `handling.${key}`, apply: (settings: Settings, value: unknown) => { settings.handling[key] = boolean(value); } })),
  ...(['irs', 'ihs'] as const).map(key => ({ path: `handling.${key}`, apply: (settings: Settings, value: unknown) => {
    if (value !== 'off' && value !== 'tap' && value !== 'hold') throw new Error('Expected off, tap or hold.');
    settings.handling[key] = value;
  } })),
  { path: 'video.gridopacity', apply: (settings, value) => { settings.display.gridOpacity = opacity(value); settings.display.grid = settings.display.gridOpacity > 0; } },
  { path: 'video.shadowopacity', apply: (settings, value) => { settings.display.ghostOpacity = opacity(value); settings.display.ghost = settings.display.ghostOpacity > 0; } },
  { path: 'video.boardopacity', apply: (settings, value) => { settings.display.boardOpacity = opacity(value); } },
  { path: 'video.colorshadow', apply: (settings, value) => { settings.display.coloredGhost = boolean(value); } },
  { path: 'video.holdlocked', apply: (settings, value) => { settings.display.dimLockedHold = boolean(value); } }
];

function at(root: ObjectValue, path: string): unknown {
  let value: unknown = root;
  for (const part of path.split('.')) {
    if (!object(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

export function readTetrioOption(settings: Settings, path: string): unknown | null {
  const value = at(settings.tetrioConfig ?? {}, path);
  return value === undefined ? null : structuredClone(value);
}

export function readTetrioSection(settings: Settings, section: string): ObjectValue | null {
  const value = readTetrioOption(settings, section);
  return object(value) ? value : null;
}

function paths(root: ObjectValue, prefix = '', depth = 0): string[] {
  if (depth > 12) throw new Error('Config nesting is too deep.');
  return Object.entries(root).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return object(value) && Object.keys(value).length ? paths(value, path, depth + 1) : [path];
  });
}

const namedCodes = ['Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'CapsLock', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'NumLock', 'ScrollLock', 'Pause', 'ContextMenu', 'IntlBackslash', 'IntlRo', 'IntlYen', ...['Left', 'Right', 'Up', 'Down'].map(s => `Arrow${s}`), ...['Shift', 'Control', 'Alt', 'Meta'].flatMap(s => [`${s}Left`, `${s}Right`]), ...['Add', 'Subtract', 'Multiply', 'Divide', 'Decimal', 'Enter', 'Equal', 'Comma', ...'0123456789'].map(s => `Numpad${s}`), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(s => `Key${s}`), ...'0123456789'.split('').map(s => `Digit${s}`), ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)];
const codeMap = new Map(namedCodes.map(code => [code.toUpperCase(), code]));
const nativeActions: Record<Action, string> = { ...Object.fromEntries(Object.keys(actions).map(key => [key, key])), pause: 'exit', restart: 'retry' } as Record<Action, string>;
const guideline: Record<Action, string[]> = {
  moveLeft: ['ArrowLeft', 'Numpad4'], moveRight: ['ArrowRight', 'Numpad6'], softDrop: ['ArrowDown', 'Numpad2'], hardDrop: ['Space', 'Numpad8'],
  rotateCCW: ['ControlLeft', 'ControlRight', 'KeyZ', 'Numpad3', 'Numpad7'], rotateCW: ['ArrowUp', 'KeyX', 'Numpad1', 'Numpad5', 'Numpad9'],
  rotate180: ['KeyA'], hold: ['ShiftLeft', 'ShiftRight', 'KeyC', 'Numpad0'], pause: ['Escape'], restart: ['KeyR']
};

function importControls(root: ObjectValue, settings: Settings, applied: string[], warnings: string[]) {
  if (!object(root.controls)) return;
  const controls = root.controls, style = controls.style ?? 'custom';
  if (style !== 'custom' && style !== 'guideline' && style !== 'wasd') {
    warnings.push(`Unknown control preset "${String(style)}". Current bindings were kept.`); return;
  }
  const custom = controls.custom;
  if (style === 'custom' && !object(custom)) throw new Error('Custom controls must contain a key map.');
  const preset = structuredClone(guideline);
  if (style === 'wasd') {
    preset.moveLeft = ['KeyA', 'Numpad4']; preset.moveRight = ['KeyD', 'Numpad6'];
    preset.softDrop = ['KeyW', 'Numpad8']; preset.hardDrop = ['KeyS', 'Numpad5'];
    preset.rotateCCW = ['ArrowLeft', 'Numpad7']; preset.rotateCW = ['ArrowRight', 'Numpad9'];
    preset.rotate180 = ['ArrowUp', 'Numpad2']; preset.hold = ['ShiftLeft', 'ShiftRight', 'NumpadEnter'];
  }
  for (const action of Object.keys(actions) as Action[]) {
    const source = `controls.custom.${nativeActions[action]}`;
    const list = style === 'custom' ? at(root, source) : preset[action];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 16 || !list.every(code => typeof code === 'string')) throw new Error(`Invalid key list: ${source}.`);
    const codes: string[] = [];
    let unsupported = false;
    for (const key of list) {
      if (!key) continue;
      const code = codeMap.get(key.toUpperCase());
      if (!code || !validCode(code)) { unsupported = true; warnings.push(`${nativeActions[action]}: "${key}" is retained but cannot be used as a keyboard binding.`); }
      else if (!codes.includes(code)) codes.push(code);
    }
    settings.bindings[action] = codes[0] ?? '';
    if (settings.extraBindings) delete settings.extraBindings[action];
    if (codes.length > 1) (settings.extraBindings ??= {})[action] = codes.slice(1);
    if (style === 'custom' && !unsupported) applied.push(source);
    if (!codes.length && list.some(Boolean)) warnings.push(`${actions[action]} has no usable keyboard binding. Choose a key in Settings.`);
  }
  applied.push('controls.style');
}

export function importTetrioConfig(value: unknown, base: Settings = defaults): ConfigImport {
  if (!object(value) || !['controls', 'handling', 'video', 'volume', 'gameoptions', 'electron', 'notifications'].some(key => object(value[key]))) throw new Error('This is not a TETR.IO config file.');
  const allPaths = paths(value);
  const settings = structuredClone(base), applied: string[] = [], warnings: string[] = [];
  for (const section of ['controls', 'handling', 'video', 'volume', 'gameoptions', 'electron', 'notifications']) {
    if (value[section] !== undefined && !object(value[section])) throw new Error(`Invalid ${section} section.`);
  }
  importControls(value, settings, applied, warnings);
  for (const adapter of tetrioConfigAdapters) {
    const field = at(value, adapter.path);
    if (field === undefined) continue;
    try { adapter.apply(settings, field); } catch (error) { throw new Error(`${adapter.path}: ${(error as Error).message}`); }
    applied.push(adapter.path);
  }
  settings.tetrioConfig = structuredClone(value);
  if (settings.training.undoEnabled && [settings.bindings.rotateCCW, ...(settings.extraBindings?.rotateCCW ?? [])].some(code => code.startsWith('Control')) && Object.values(settings.bindings).includes('KeyZ')) warnings.push('Ctrl + Z is reserved for undo while undo is enabled.');
  const retained = allPaths.filter(path => !applied.includes(path));
  return { settings: validateSettings(settings), applied, retained, warnings };
}

export function importSettingsFile(value: unknown, base: Settings): ConfigImport | { settings: Settings } {
  if (object(value) && Object.hasOwn(value, 'version')) return { settings: validateSettings(value) };
  return importTetrioConfig(value, base);
}
