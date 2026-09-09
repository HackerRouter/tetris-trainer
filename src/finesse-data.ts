type Row = [string | null, string | null, string | null, string | null];
type Table = Record<number, Row>;

const o: Table = {
  '-1': ['L', 'L', 'L', 'L'],
  0: ['Lr', 'Lr', 'Lr', 'Lr'],
  1: ['ll', 'll', 'll', 'll'],
  2: ['l', 'l', 'l', 'l'],
  3: ['', '', '', ''],
  4: ['r', 'r', 'r', 'r'],
  5: ['rr', 'rr', 'rr', 'rr'],
  6: ['Rl', 'Rl', 'Rl', 'Rl'],
  7: ['R', 'R', 'R', 'R']
};

const t: Table = {
  '-1': [null, 'CL', null, null],
  0: ['L', 'LC', '1L', 'Lc'],
  1: ['ll', 'llC', '1ll', 'llc'],
  2: ['l', 'lC', '1l', 'lc'],
  3: ['', 'C', '1', 'c'],
  4: ['r', 'rC', '1r', 'rc'],
  5: ['rr', 'rrC', '1rr', 'rrc'],
  6: ['Rl', 'RlC', '1Rl', 'Rlc'],
  7: ['R', 'RC', '1R', 'Rc'],
  8: [null, null, null, 'cR']
};

const s: Table = {
  0: ['L', 'LC', null, 'Lc'],
  2: ['l', null, null, 'lc'],
  3: ['', 'C', null, 'c'],
  4: ['r', 'rC', null, null],
  5: ['rr', 'rrC', null, null],
  7: ['R', 'RC', null, 'Rc']
};

const i: Table = {
  '-1': [null, null, null, 'cL'],
  0: ['L', null, null, 'Lc'],
  1: ['ll', 'LC', null, 'Lc'],
  2: ['l', null, null, 'lc'],
  3: ['', 'C', null, 'c'],
  4: ['r', 'rC', null, null],
  5: ['rr', 'rC', null, null],
  6: ['R', 'RC', null, 'RC'],
  7: [null, 'CR', null, null]
};

export const finesseTable: Record<string, Table> = { o, t, j: t, l: t, s, z: s, i };
export const finesseRules = {
  name: 'd-002',
  revision: 'e223b32a26195333ffdc7dd7ab0221b9b2103375',
  source: 'https://github.com/d-002/finesse/blob/e223b32a26195333ffdc7dd7ab0221b9b2103375/script.js',
  rotation180Cost: 1,
  preferHardDrop: true
};
