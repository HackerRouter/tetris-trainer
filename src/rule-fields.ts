import { comboSystems, rotationSystems, spinSystems, type AdvancedRules } from './modes';

export const ruleNumbers = [
  ['width', 'Board width', 'Columns.', 4, 16, 1], ['height', 'Board height', 'Visible rows.', 10, 40, 1],
  ['gravityIncrease', 'Gravity increase', 'Added G per second after the margin.', 0, 20, .0001], ['gravityMargin', 'Gravity margin', 'Seconds before gravity starts increasing.', 0, 86400, 1],
  ['entryDelay', 'Entry delay (ARE)', 'Frames between pieces after a placement without a clear.', 0, 600, 1], ['lineClearDelay', 'Line clear ARE', 'Frames between pieces after a line clear. Replaces entry delay.', 0, 600, 1],
  ['arr', 'Room ARR', 'Frames between repeated moves. 0 = instant.', 0, 20, .1], ['das', 'Room DAS', 'Frames before horizontal repetition.', 0, 20, .1], ['sdf', 'Room SDF', 'Soft drop factor. 41 = instant.', 1, 41, 1],
  ['allClearGarbage', 'All clear attack', 'Attack for an all clear.', 0, 100, 1], ['allClearB2B', 'All clear B2B', 'B2B gain on all clear.', 0, 100, 1],
  ['garbageMultiplier', 'Attack multiplier', 'Multiplier before cancellation.', 0, 10, .1], ['garbageIncrease', 'Attack increase', 'Multiplier added each second after the margin.', 0, 10, .001], ['garbageMargin', 'Attack margin', 'Seconds before attack multiplier increases.', 0, 86400, 1],
  ['garbageSpeed', 'Garbage delay', 'Frames before incoming garbage can enter the board.', 0, 600, 1], ['garbageCap', 'Garbage cap', 'Maximum rows entering per placement.', 0, 100, 1], ['garbageCapIncrease', 'Cap increase', 'Additional rows per second after the cap margin.', 0, 10, .001], ['garbageCapMax', 'Maximum cap', 'Upper limit for the growing cap.', 0, 100, 1], ['garbageCapMargin', 'Cap margin', 'Seconds before the cap increases.', 0, 86400, 1], ['garbageAbsoluteCap', 'Absolute cap', '0 = disabled.', 0, 100, 1],
  ['garbageMessinessWithin', 'Packet messiness', 'Chance of a new hole within a garbage packet.', 0, 1, .05], ['openerPhase', 'Opener phase', 'Pieces subject to opener attack rules.', 0, 100, 1],
  ['garbageInterval', 'Incoming interval', 'Seconds between solo garbage packets. 0 = disabled.', 0, 3600, .1], ['garbageRows', 'Incoming rows', 'Rows per solo packet.', 1, 20, 1], ['garbageStart', 'First packet at', 'Seconds on the game timer. Rewinds with retry and undo.', 0, 86400, .1],
  ['garbageRefill', 'Garbage refill rows', 'Keep this many garbage rows by adding new rows after each placement. 0 = disabled. Separate from timed incoming packets.', 0, 38, 1]
] as const;
export const ruleChecks = [
  ['hardDrop', 'Allow hard drop'], ['shadow', 'Show ghost piece'], ['handlingOverride', 'Enforce room ARR, DAS and SDF'],
  ['clutch', 'Allow clutch after a line clear'], ['b2bChaining', 'B2B chaining'], ['b2bCharging', 'B2B charging'], ['allClear', 'All clear bonus'], ['bombs', 'Bomb garbage'], ['specialBonus', 'Special spin bonus'], ['repeatSequence', 'Repeat the authored sequence']
] as const;
export const ruleSelects = [
  ['kickSet', 'Rotation system', rotationSystems], ['spinBonuses', 'Spin bonuses', spinSystems], ['comboTable', 'Combo table', comboSystems], ['garbageBlocking', 'Garbage blocking', ['combo blocking', 'limited blocking', 'none']]
] as const;
const groups: [string, (keyof AdvancedRules)[]][] = [
  ['Board and rotation', ['width', 'height', 'kickSet', 'hardDrop', 'shadow', 'clutch']],
  ['Timing and room handling', ['gravityIncrease', 'gravityMargin', 'entryDelay', 'lineClearDelay', 'handlingOverride', 'arr', 'das', 'sdf']],
  ['Spin, combo and attack', ['spinBonuses', 'comboTable', 'b2bChaining', 'b2bCharging', 'allClear', 'allClearGarbage', 'allClearB2B', 'specialBonus', 'openerPhase', 'garbageMultiplier', 'garbageIncrease', 'garbageMargin']],
  ['Garbage and solo pressure', ['garbageRefill', 'bombs', 'garbageBlocking', 'garbageSpeed', 'garbageCap', 'garbageCapIncrease', 'garbageCapMax', 'garbageCapMargin', 'garbageAbsoluteCap', 'garbageMessinessWithin', 'garbageInterval', 'garbageRows', 'garbageStart']]
];

export function advancedForm() {
  const render = (key: keyof AdvancedRules) => {
    const number = ruleNumbers.find(row => row[0] === key);
    if (number) { const [, label, hint, min, max, step] = number; return `<label class="custom-number" for="custom-${key}"><span>${label}<small>${hint}</small></span><input id="custom-${key}" type="number" min="${min}" max="${max}" step="${step}" required></label>`; }
    const check = ruleChecks.find(row => row[0] === key);
    if (check) return `<label class="check-row"><input id="custom-${key}" type="checkbox">${check[1]}</label>`;
    const select = ruleSelects.find(row => row[0] === key)!;
    return `<label class="select-row" for="custom-${key}">${select[1]}<select id="custom-${key}">${select[2].map(value => `<option value="${value}">${value}</option>`).join('')}</select></label>`;
  };
  return `<div class="advanced-rules">${groups.map(([title, keys]) => `<details><summary>${title}</summary><section>${keys.map(render).join('')}</section></details>`).join('')}
    <details><summary>Authored map and queue</summary><section>
      <label for="custom-map">Starting map <small>Top row first. Each row must match board width. IJLOSTZ = colored blocks, . or _ = empty, # = garbage, * = bomb. Overrides starting garbage.</small><textarea id="custom-map" rows="6" spellcheck="false" maxlength="2000"></textarea></label>
      <label for="custom-sequence">Piece sequence <small>IJLOSTZ, with optional whitespace. Starts with the active piece. Without repetition, the seeded randomizer follows this sequence.</small><textarea id="custom-sequence" rows="3" spellcheck="false" maxlength="4000"></textarea></label>
      ${render('repeatSequence')}
    </section></details></div>`;
}
