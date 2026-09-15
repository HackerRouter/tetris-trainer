import reference from './qp-reference.json' with { type: 'json' };
import type { GameAction } from './settings';

export const reviveCatalog = reference.tasks;
export type ReviveDefinition = typeof reviveCatalog[number];
export type RevivePrompt = { task: string; predicate: string; target: number; count: number; complete: boolean; activatedAt: number; stunnedAt: number };
export type ReviveState = {
  prompts: RevivePrompt[]; frame: number; active: number; finishedAt: number | null; resets: number;
  held: GameAction[]; lastPiece: number; lastCancel: number; topSince: number | null; cleanSince: number | null;
  quadColumns: number[]; spinPieces: string[]; lastDoublePiece: string | null;
};
export type RevivePlacement = {
  piece: string; lines: number; spin: 'none' | 'mini' | 'normal'; combo: number; b2b: number;
  rotation: number; centerX: number; quadColumn: number; upperHalf: boolean; moved: boolean; usedCW: boolean; used180: boolean;
  heldPiece: string | null; holdUsed: boolean; garbageCleared: number; colorClear: boolean;
};
export function initialRevive(tasks: string[], frame = 0): ReviveState {
  if (!tasks.length || tasks.length > 100) throw new Error('Select between 1 and 100 revive tasks.');
  return { prompts: tasks.map(task => {
    const definition = reviveCatalog.find(item => item.id === task);
    if (!definition) throw new Error(`Unknown revive task: ${task}`);
    return { task, predicate: definition.predicate, target: definition.target, count: 0, complete: false, activatedAt: frame, stunnedAt: -1 };
  }), frame, active: 0, finishedAt: null, resets: 0, held: [], lastPiece: frame, lastCancel: frame, topSince: null, cleanSince: null, quadColumns: [], spinPieces: [], lastDoublePiece: null };
}
export function drawReviveTasks(floor: number, level: number, mods: string[], random: () => number) {
  const deck = { ...reference.decks[Math.min(reference.decks.length - 1, Math.max(1, floor + level))] } as Record<string, number | string[]>;
  const pool = reviveCatalog.filter(task => Number(deck[task.tier]) > 0 && !task.excludes.some(mod => mods.includes(mod)));
  for (let index = pool.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [pool[index], pool[other]] = [pool[other], pool[index]]; }
  const chosen: ReviveDefinition[] = [], ids = new Set<string>();
  for (const task of pool) if (Number(deck[task.tier]) > 0 && !ids.has(task.predicate)) {
    deck[task.tier] = Number(deck[task.tier]) - 1; chosen.push(task); ids.add(task.predicate);
  }
  if (Array.isArray(deck.order)) return deck.order.map(tier => chosen.splice(chosen.findIndex(task => task.tier === tier), 1)[0].id);
  return chosen.map(task => task.id);
}
export function drawSelectedReviveTasks(selected: string[], count: number, mods: string[], random: () => number) {
  const pool = reviveCatalog.filter(task => selected.includes(task.id) && !task.excludes.some(mod => mods.includes(mod)));
  for (let index = pool.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [pool[index], pool[other]] = [pool[other], pool[index]]; }
  const predicates = new Set<string>();
  return pool.filter(task => { if (predicates.has(task.predicate)) return false; predicates.add(task.predicate); return true; }).slice(0, count).map(task => task.id);
}
export function progressRevive(state: ReviveState, predicate: string, value = 1, operation: 'increment' | 'bump' | 'reset' = 'increment') {
  const active = state.prompts[state.active];
  if (!active || active.predicate !== predicate || active.complete || active.stunnedAt === state.frame) return false;
  const count = Math.min(active.target, operation === 'increment' ? active.count + value : operation === 'bump' ? Math.max(active.count, value) : value);
  if (count === active.count) return false;
  if (count < active.count) state.resets++;
  active.count = count;
  if (count === active.target) {
    active.complete = true; state.active++;
    const next = state.prompts[state.active];
    if (next) { next.activatedAt = state.frame; next.stunnedAt = state.frame; state.quadColumns = []; state.spinPieces = []; }
    else state.finishedAt = state.frame;
  }
  return true;
}
export function reviveInput(state: ReviveState, key: GameAction, down: boolean) {
  if (down) { if (!state.held.includes(key)) state.held.push(key); }
  else state.held = state.held.filter(item => item !== key);
  if (key === 'moveLeft' || key === 'moveRight') progressRevive(state, 'holddas', 0, 'reset');
  if (key === 'softDrop' && !down) progressRevive(state, 'softdrop', 0, 'reset');
}
export function reviveHold(state: ReviveState) {
  progressRevive(state, 'hold'); progressRevive(state, 'holdconsecutive');
  for (const id of ['singlesonly', 'nohold', 'combonohold']) progressRevive(state, id, 0, 'reset');
}
export function reviveRotate(state: ReviveState, piece: string) {
  progressRevive(state, 'rotate');
  if (piece === 't') progressRevive(state, 'tnorotate', 0, 'reset');
}
export function reviveClock(state: ReviveState, frame: number, top3: boolean, garbageRows: number) {
  state.frame = frame;
  if (frame % 15) return;
  if (top3 !== (state.topSince !== null)) { state.topSince = top3 ? frame : null; if (!top3) progressRevive(state, 'top3rows', 0, 'reset'); }
  const clean = garbageRows === 0;
  if (clean !== (state.cleanSince !== null)) { state.cleanSince = clean ? frame : null; if (!clean) progressRevive(state, 'nogarbage', 0, 'reset'); }
  const active = state.prompts[state.active];
  if (!active) return;
  for (const [id, since] of [['top3rows', state.topSince], ['nogarbage', state.cleanSince], ['idle', state.lastPiece], ['nocancel', state.lastCancel]] as const) {
    if (since !== null) progressRevive(state, id, Math.floor((frame - Math.max(active.activatedAt, since)) / 60), 'bump');
  }
}
export function revivePlacement(state: ReviveState, placement: RevivePlacement) {
  const p = placement, n = p.lines, piece = p.piece, spin = p.spin !== 'none', full = p.spin === 'normal', mini = p.spin === 'mini', c = spin;
  const inc = (id: string, amount = 1) => progressRevive(state, id, amount);
  const reset = (id: string, value = 0) => progressRevive(state, id, value, 'reset');
  const consecutive = (id: string, condition: boolean) => condition ? inc(id) : reset(id);
  inc('pieces'); inc('nohold'); consecutive('spam', !p.moved);
  if (state.held.includes('softDrop')) inc('softdrop');
  consecutive('norotateclockwise', !p.usedCW && !p.used180);
  consecutive('placeoconsecutive', piece === 'o');
  if (state.held.some(key => key === 'moveLeft' || key === 'moveRight') && p.moved) inc('holddas');
  if (piece === 't') consecutive('tnorotate', p.rotation === 0);
  state.lastPiece = state.frame; reset('idle');
  if (piece === 'o' && p.centerX === 0) inc('columnopiece');
  if (p.garbageCleared && spin && ['l', 'j'].includes(piece)) inc('ljgarbage', p.garbageCleared);
  if (p.garbageCleared && spin && ['s', 'z'].includes(piece)) inc('szgarbage', p.garbageCleared);
  inc('garbageclear', p.garbageCleared);
  if (n) {
    progressRevive(state, 'combo', p.combo, 'bump');
    if (p.combo > 0) inc('combonohold');
    if (n === 2) { if (state.lastDoublePiece === piece) inc('doublespiece'); else reset('doublespiece', 1); state.lastDoublePiece = piece; }
    inc('lines', n); if (piece === 'o') inc('oclear', n); if (p.heldPiece === 'i') inc('iholdlines', n); reset('noclear');
    if (n === 1) consecutive('singlenocombo', p.combo === 0);
    if (piece === 't' || piece === 'i') reset('linesnoti'); else inc('linesnoti', n);
    if (c && ['s', 'z'].includes(piece)) inc('szspin');
    if (c && ['l', 'j'].includes(piece)) inc('ljspin');
    if (c && !state.spinPieces.includes(piece)) { state.spinPieces.push(piece); inc('spinbuckets'); }
    consecutive('singlesonly', n === 1);
  } else { reset('combo'); inc('noclear'); reset('combonohold'); reset('combospin'); }
  if (n && p.b2b > 0) progressRevive(state, 'b2b', p.b2b, 'bump'); else if (n && p.b2b < 0) reset('b2b');
  for (const [id, condition] of [
    ['szspinconsecutive', n === 2 && c && ['s', 'z'].includes(piece)], ['ljspinconsecutive', n === 2 && c && ['l', 'j'].includes(piece)],
    ['ospinconsecutive', n === 2 && c && piece === 'o'], ['odoubleconsecutive', n === 2 && piece === 'o'],
    ['quadconsecutive', n === 4], ['singleconsecutive', n === 1], ['quadcombo', n === 4 && p.combo >= 2], ['szsingle', n === 1 && ['s', 'z'].includes(piece)]
  ] as const) consecutive(id, condition);
  if (n && c) inc('combospin');
  if (c && ['s', 'z', 'l', 'j'].includes(piece)) inc('szljspin');
  if (!p.holdUsed) reset('holdconsecutive');
  if (mini && piece === 't') { inc('tspinmini'); if (n) inc('tspinminiclear'); }
  if (n && c && piece === 'i') inc('ispinclear');
  if (n && c) inc('spinclear'); else if (!n) reset('spinclear');
  if (c) inc('spin');
  if (!n && c) inc('noclearspin');
  if (n === 1) {
    if (full && piece === 't') inc('tspinsingle');
    if (piece === 'i' && p.rotation % 2 === 0) inc('iflat');
    if (piece === 'i' && !p.moved) inc('iclearspam');
    if (piece === 'o') inc('osingle');
  }
  if (n === 2) {
    if (piece === 't' && mini) inc('tspindoublemini');
    if (piece === 't' && full) {
      inc('tspindouble'); if ([0, 9].includes(p.centerX)) inc('tspindtcolumn');
      if (p.rotation === 0) inc('tspindoubleup'); if (p.combo >= 2) inc('tspincombo');
    }
    inc('double'); if (piece === 'o') inc('odouble');
    if (['s', 'z'].includes(piece)) { inc(`${piece}double`); inc('szdouble'); }
    if (c && piece === 'i') inc('ispindouble');
    if (piece === 'o' && !p.moved) inc('oclearspam');
  }
  if (n === 3) {
    if (full && piece === 't') { inc('tspintriple'); if ([0, 9].includes(p.centerX)) inc('tspindtcolumn'); }
    inc('triple'); if (['l', 'j'].includes(piece)) { inc(`${piece}triple`); inc('ljtriple'); if (c) inc('ljspintriple'); }
    if (c && ['s', 'z'].includes(piece)) inc('szspintriple');
  }
  if (n === 4) {
    inc('quad');
    if (!state.quadColumns.includes(p.quadColumn)) { state.quadColumns.push(p.quadColumn); inc('quadbuckets'); }
    if (p.upperHalf) inc('upperhalfquad');
  }
  if (p.colorClear) inc('colorclear');
}
export function reviveAttack(state: ReviveState, kind: 'attack' | 'send' | 'cancel' | 'tank', amount: number) {
  progressRevive(state, kind, amount);
  if (kind === 'cancel' && amount > 0) { progressRevive(state, 'nocancel', 0, 'reset'); state.lastCancel = state.frame; }
}
