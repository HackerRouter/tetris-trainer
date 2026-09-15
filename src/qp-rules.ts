import reference from './qp-reference.json' with { type: 'json' };

export const qpRevision = reference.revision;
export type QpMod = keyof typeof reference.mods;
export const floorBoundaries = [0, 50, 150, 300, 450, 650, 850, 1100, 1350, 1650, Infinity];
export const floorNames = ['Hall of Beginnings', 'The Hotel', 'The Casino', 'The Arena', 'The Museum', 'Abandoned Offices', 'The Laboratory', 'The Core', 'Corruption', 'Platform of the Gods'];
export function floorLevel(altitude: number) { return Math.max(1, floorBoundaries.filter(value => altitude >= value).length); }
export function floorGate(altitude: number) { return Math.max(0, Math.min(1, (floorBoundaries.find(value => altitude < value)! - altitude) / 5 - .2)); }
export type QpProfile = { mods: QpMod[]; allyMods: QpMod[] };
export function validateQpProfile(profile: QpProfile) {
  for (const mods of [profile.mods, profile.allyMods]) {
    if (!Array.isArray(mods) || mods.some(mod => !Object.hasOwn(reference.mods, mod)) || new Set(mods).size !== mods.length) throw new Error('Unknown or duplicate Zenith mod.');
    if (mods.some(mod => mod.endsWith('_reversed')) && mods.length !== 1) throw new Error('A reversed mod must be selected alone.');
  }
  const duo = profile.mods.includes('duo'), reversed = profile.mods.includes('duo_reversed');
  if (duo !== profile.allyMods.includes('duo') || reversed !== profile.allyMods.includes('duo_reversed')) throw new Error('Both partners must use the same Duo card.');
  if (!duo && !reversed && profile.allyMods.length) throw new Error('A Solo profile cannot contain teammate mods.');
  return structuredClone(profile);
}
export type ClimbState = {
  frame: number; altitude: number; rank: number; peakRank: number; points: number; lockedUntil: number; promotionFatigue: number;
  lastPromoted: boolean; bonus: number; totalBonus: number; allyBonus: number; floor: number; lastFloorChange: number;
  aloneSince: number | null; maxRank: number; reviveLevel: number; noRevive: boolean; permanentRows: number;
  receiveMultiplier: number; maxMessiness: boolean; graceStillMessy: boolean;
};
export function initialClimb(mods: QpMod[] = []): ClimbState {
  return { frame: 0, altitude: 0, rank: 1, peakRank: 1, points: 0, lockedUntil: -1, promotionFatigue: 0, lastPromoted: false,
    bonus: 0, totalBonus: 0, allyBonus: 0, floor: 0, lastFloorChange: 0, aloneSince: null, maxRank: 99999, reviveLevel: 0, noRevive: false,
    permanentRows: 0, receiveMultiplier: mods.includes('volatile_reversed') ? 3 : mods.includes('volatile') ? 2 : 1, maxMessiness: false, graceStillMessy: false };
}
export function speedModifier(state: ClimbState, mods: QpMod[]) {
  return mods.includes('duo_reversed') && state.aloneSince !== null ? Math.max(0, 1 - (state.frame - state.aloneSince) / 60) : 1;
}
export function awardBonus(state: ClimbState, amount: number, mods: QpMod[], ally = false) {
  const bonus = amount * speedModifier(state, mods);
  state.bonus += bonus;
  if (ally) state.allyBonus += bonus; else state.totalBonus += bonus;
  return bonus;
}
export function awardClimb(state: ClimbState, amount: number, mods: QpMod[], sent = true, points = true) {
  let bonus = .25 * Math.floor(state.rank) * amount * Number(sent);
  const distance = floorBoundaries.find(value => state.altitude < value)! - state.altitude - bonus - state.bonus;
  if (distance >= 0 && distance <= 2) bonus += 3;
  awardBonus(state, bonus, mods);
  if (points) state.points += amount + .05;
}
export function tickClimb(state: ClimbState, profile: QpProfile) {
  const { mods, allyMods } = profile, reversed = mods[0];
  const frame = ++state.frame;
  let rank = Math.floor(state.rank);
  if (frame >= state.lockedUntil) {
    const decay = reversed === 'duo_reversed' ? 5 : mods.includes('duo') ? 3 + Number(mods.includes('expert')) + Number(allyMods.includes('expert')) : mods.includes('expert') || reversed === 'expert_reversed' ? 5 : 3;
    state.points -= decay * (rank * rank + rank) / 3600;
  }
  const threshold = 4 * rank;
  if (rank >= state.maxRank) state.points = Math.min(state.points, threshold - .05);
  if (state.points < 0) {
    if (rank <= 1) state.points = 0;
    else { state.points += 4 * (rank - 1); rank--; state.lastPromoted = false; }
  } else if (state.points >= threshold) {
    state.points -= threshold; state.lastPromoted = true;
    state.lockedUntil = frame + Math.max(60, 60 * (5 - state.promotionFatigue));
    state.promotionFatigue++; rank++;
  }
  if (state.lastPromoted && state.points >= 2 * (rank - 1)) state.promotionFatigue = 0;
  state.rank = rank + state.points / (4 * rank);
  state.peakRank = Math.max(state.peakRank, state.rank);
  const floor = floorLevel(state.altitude);
  if (reversed === 'expert_reversed') state.altitude = Math.max(floorBoundaries[floor - 1], state.altitude - .05 * (floor * floor + floor + 10) / 60);
  else state.altitude += .25 * rank / 60 * floorGate(state.altitude) * speedModifier(state, mods);
  if (state.bonus > 0) {
    const consumed = state.bonus <= .05 ? state.bonus : Math.min(10, state.bonus * .1);
    state.altitude += consumed; state.bonus -= consumed;
  }
  const changed = floor !== state.floor;
  if (changed) state.lastFloorChange = frame;
  state.floor = floor;
  if (reversed === 'expert_reversed' && frame - state.lastFloorChange > 3600) state.receiveMultiplier += .005 / 60;
  const fatigue = reference.fatigue[reversed === 'expert_reversed' || reversed === 'duo_reversed' ? reversed : 'normal'] as [number, [string, unknown][]][];
  const actions = fatigue.find(([at]) => at === frame)?.[1] ?? [];
  for (const [action, value] of actions) {
    if (action === 'unclearable') state.permanentRows++;
    if (action === 'receivemultiplier') state.receiveMultiplier += Number(value) * (mods.includes('volatile') ? 2 : reversed === 'volatile_reversed' ? 3 : 1);
    if (action === 'revivelevel') state.reviveLevel += Number(value);
    if (action === 'maxrank') state.maxRank = Number(value);
    if (action === 'norevive') state.noRevive = true;
    if (action === 'maxmessy') state.maxMessiness = true;
    if (action === 'gracestillmessy') state.graceStillMessy = true;
  }
  return { changed, actions };
}
export function garbagePhase(floor: number, mods: QpMod[]) {
  if (mods.includes('expert') || mods[0] === 'expert_reversed') return 66 - 6 * floor;
  if (mods[0]?.endsWith('_reversed')) return ['messy_reversed', 'volatile_reversed', 'doublehole_reversed'].includes(mods[0]) ? 75 : [75, 75, 75, 75, 75, 75, 75, 60, 45, 30, 15][floor];
  return 165 - 15 * floor;
}
export type ReceiveContext = { altitude: number; sourceAltitude: number; floor: number; cancelStreak: number; windupUntil: number; frame: number; grace: number; multiplier: number; ownBonus: number; allyBonus: number; allyDown: boolean; mods: QpMod[] };
export function receiveAmount(amount: number, context: ReceiveContext, random: () => number) {
  const c = context, volatile = c.mods.includes('volatile') || c.mods[0] === 'volatile_reversed', allspin = c.mods.includes('allspin') || c.mods[0] === 'allspin_reversed';
  const source = Math.max(Math.min(3500, c.sourceAltitude), Math.min(2000, c.altitude - 1000));
  let value = amount;
  if (source < c.altitude) value *= 1 + .004 * (c.altitude - source) ** 2 / (c.altitude + source);
  if (c.allyDown) value *= 1.5;
  let cap = [4, 4, 5, 6, 7, 8, 9, 10, Infinity, Infinity, Infinity][c.floor];
  if (c.windupUntil >= c.frame) cap = Math.min(6, cap);
  if (volatile) cap *= 2;
  value = Math.max(value, Math.min(value + (volatile && !allspin ? .0003 : !volatile && allspin ? .002 : .001) * c.cancelStreak ** 2, cap));
  if (c.mods.some(mod => mod === 'duo' || mod === 'duo_reversed') && c.ownBonus + c.allyBonus) {
    const share = c.ownBonus / (c.ownBonus + c.allyBonus);
    if (share <= .2) value *= share + .55;
  }
  if (c.grace > 8) value *= 1 - .05 * (c.grace - 8);
  value *= c.multiplier;
  const whole = Math.floor(value);
  return whole + Number(value !== whole && random() < value - whole);
}
export function splitWindup(amount: number, altitude: number, volatile: boolean, frame: number, previousUntil: number) {
  if (amount < (volatile ? 16 : 8)) return { portions: [{ amount, release: frame }], until: previousUntil, discarded: 0, windup: false };
  let capacity = 16 + (altitude >= 4000 ? Math.floor((altitude - 3500) / 500) : 0);
  if (volatile) capacity *= 2;
  const base = Math.floor(capacity / 4), remainder = capacity % 4, start = Math.max(frame, previousUntil);
  const portions: { amount: number; release: number }[] = [];
  let left = amount;
  for (let index = 0; index < 4 && left > 0; index++) {
    const count = Math.min(left, base + Number(index >= 4 - remainder));
    portions.push({ amount: count, release: start + 60 + 30 * index }); left -= count;
  }
  return { portions, until: start + 120 + 30 * portions.length, discarded: left, windup: true };
}
