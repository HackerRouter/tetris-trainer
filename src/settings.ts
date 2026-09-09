export const actions = {
  moveLeft: 'Move left', moveRight: 'Move right', softDrop: 'Soft drop',
  hardDrop: 'Hard drop', rotateCW: 'Rotate clockwise', rotateCCW: 'Rotate counterclockwise',
  rotate180: 'Rotate 180°', hold: 'Hold', pause: 'Pause / resume', restart: 'Restart'
} as const;

export type Action = keyof typeof actions;
export type GameAction = Exclude<Action, 'pause' | 'restart'>;
export type Settings = {
  version: 1;
  handling: { arr: number; das: number; dcd: number; sdf: number; cancel: boolean; safelock: boolean; irs: 'off' | 'hold' | 'tap'; ihs: 'off' | 'hold' | 'tap' };
  bindings: Record<Action, string>;
  display: { grid: boolean; ghost: boolean; ghostOpacity: number };
};

export const storageKey = 'tetrio-trainer-settings-v1';
export const defaults: Settings = {
  version: 1,
  handling: { arr: 0, das: 6, dcd: 0, sdf: 41, cancel: false, safelock: false, irs: 'tap', ihs: 'tap' },
  bindings: { moveLeft: 'ArrowLeft', moveRight: 'ArrowRight', softDrop: 'ArrowDown', hardDrop: 'Space', rotateCW: 'ArrowUp', rotateCCW: 'KeyZ', rotate180: 'KeyA', hold: 'KeyC', pause: 'Escape', restart: 'KeyR' },
  display: { grid: true, ghost: true, ghostOpacity: 0.24 }
};

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function validCode(code: unknown): code is string {
  return typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Space|Enter|Escape|Tab|Backspace|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|CapsLock|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Insert|Delete|Home|End|PageUp|PageDown|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/.test(code);
}

export function validateSettings(value: unknown): Settings {
  const root = record(value), handling = record(root.handling), bindings = record(root.bindings), display = record(root.display);
  if (root.version !== 1) throw new Error('Unsupported settings version.');
  const result = structuredClone(defaults);
  for (const [key, min, max, step] of [['arr', 0, 20, 0.1], ['das', 0, 20, 0.1], ['dcd', 0, 20, 0.1], ['sdf', 1, 41, 1]] as const) {
    const n = handling[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || Math.abs(n / step - Math.round(n / step)) > 1e-7) throw new Error(`${key.toUpperCase()} must be ${min}–${max}, in steps of ${step}.`);
    result.handling[key] = n;
  }
  for (const key of ['cancel', 'safelock'] as const) {
    if (typeof handling[key] !== 'boolean') throw new Error(`Invalid ${key} setting.`);
    result.handling[key] = handling[key];
  }
  for (const key of ['irs', 'ihs'] as const) {
    if (!['off', 'hold', 'tap'].includes(String(handling[key]))) throw new Error(`Invalid ${key.toUpperCase()} setting.`);
    result.handling[key] = handling[key] as Settings['handling']['irs'];
  }
  const seen = new Map<string, Action>();
  for (const key of Object.keys(actions) as Action[]) {
    const code = bindings[key];
    if (!validCode(code)) throw new Error(`Choose a supported key for ${actions[key]}.`);
    if (seen.has(code)) throw new Error(`${keyLabel(code)} is already assigned to ${actions[seen.get(code)!]}.`);
    seen.set(code, key);
    result.bindings[key] = code;
  }
  for (const key of ['grid', 'ghost'] as const) {
    if (typeof display[key] !== 'boolean') throw new Error(`Invalid ${key} setting.`);
    result.display[key] = display[key];
  }
  const opacity = display.ghostOpacity;
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0.05 || opacity > 1) throw new Error('Ghost opacity must be between 5% and 100%.');
  result.display.ghostOpacity = opacity;
  return result;
}

export function loadSettings(storage: Pick<Storage, 'getItem'>): { settings: Settings; message: string } {
  try {
    const current = storage.getItem(storageKey);
    if (current) return { settings: validateSettings(JSON.parse(current)), message: '' };
    const legacyHandling = record(JSON.parse(storage.getItem('tetrio-trainer-settings') || '{}'));
    const legacyKeys = record(JSON.parse(storage.getItem('tetrio-trainer-keys') || '{}'));
    const migrated = structuredClone(defaults);
    for (const key of ['arr', 'das', 'dcd', 'sdf'] as const) if (key in legacyHandling) migrated.handling[key] = legacyHandling[key] as number;
    const names = { Left: 'moveLeft', Right: 'moveRight', SoftDrop: 'softDrop', HardDrop: 'hardDrop', RotateCW: 'rotateCW', RotateCCW: 'rotateCCW', Rotate180: 'rotate180', Hold: 'hold' } as const;
    for (const [old, action] of Object.entries(names)) if (old in legacyKeys) {
      const key = String(legacyKeys[old]);
      migrated.bindings[action] = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key;
    }
    return { settings: validateSettings(migrated), message: '' };
  } catch {
    return { settings: structuredClone(defaults), message: 'Saved settings could not be loaded. Defaults are in use.' };
  }
}

export function keyLabel(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '').replace('Left', 'Left').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
