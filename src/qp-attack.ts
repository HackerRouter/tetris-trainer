import reference from './qp-reference.json' with { type: 'json' };
import type { QpMod } from './qp-rules';

export type QpClear = { lines: number; spin: 'none' | 'mini' | 'normal'; combo: number; b2b: number; perfectClear: boolean; surge: number };
export function qpAttack(clear: QpClear, mods: QpMod[], random: () => number) {
  const constants = reference.garbage, n = Math.min(4, clear.lines), mini = clear.spin === 'mini', spin = clear.spin !== 'none';
  const ordinary = [0, constants.SINGLE, constants.DOUBLE, constants.TRIPLE, constants.QUAD];
  const full = [constants.TSPIN, constants.TSPIN_SINGLE, constants.TSPIN_DOUBLE, constants.TSPIN_TRIPLE, constants.TSPIN_QUAD];
  const small = [constants.TSPIN_MINI, constants.TSPIN_MINI_SINGLE, constants.TSPIN_MINI_DOUBLE, constants.TSPIN_MINI_TRIPLE, constants.TSPIN_MINI_QUAD];
  let amount = (mini ? small : spin ? full : ordinary)[n];
  if (n === 1 && !spin && clear.combo === 0 && !mods.includes('expert') && !mods.some(mod => mod.endsWith('_reversed'))) amount++;
  if (n && clear.b2b > 0 && !clear.perfectClear) amount += constants.BACKTOBACK_BONUS;
  if (clear.combo > 0) {
    amount *= 1 + constants.COMBO_BONUS * clear.combo;
    if (clear.combo > 1) amount = Math.max(Math.log1p(constants.COMBO_MINIFIER * clear.combo * constants.COMBO_MINIFIER_LOG), amount);
  }
  const round = (value: number) => Math.floor(value) + Number(value % 1 > 0 && random() < value % 1);
  const multiplier = mods.some(mod => mod === 'duo' || mod === 'duo_reversed') ? .5 : 1;
  const result: number[] = [];
  if (clear.surge > 0) { const surge = Math.floor(clear.surge * multiplier), third = Math.round(surge / 3); result.push(third, third, surge - 2 * third); }
  result.push(round(amount * multiplier));
  if (clear.perfectClear && n) result.push(round(3 * multiplier));
  return result.filter(value => value > 0);
}
