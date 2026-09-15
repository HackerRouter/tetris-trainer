import { Tetromino, type Mino, type Rotation } from '@haelp/teto/engine';
import type { QpSide } from './qp-runtime';
import constructionPatterns from './revive-patterns.json' with { type: 'json' };

const patterns = (['i', 'o', 't', 's', 'z', 'j', 'l'] as Mino[]).flatMap(piece => ([0, 1, 2, 3] as Rotation[]).map(rotation => {
  const mino = new Tetromino({ symbol: piece, initialRotation: rotation, boardWidth: 10, boardHeight: 20 });
  const cells = mino.blocks.map(([x, y]) => [x, -y]), minX = Math.min(...cells.map(([x]) => x)), minY = Math.min(...cells.map(([, y]) => y));
  const normalized = cells.map(([x, y]) => [x - minX, y - minY]);
  return { piece, rotation, cells: normalized, width: Math.max(...normalized.map(([x]) => x)) + 1, height: Math.max(...normalized.map(([, y]) => y)) + 1 };
}));
export function reviveSlotPreparation(side: QpSide) {
  const predicate = side.task?.prompts[side.task.active]?.predicate ?? '';
  const templates: Record<string, string[][]> = {
    tspinsingle: [['_XXX_XXXXX', 'XXX___XXXX', '___X______']],
    ljspin: [['XXXX_XXXXX', 'XXXX_XXXXX', 'XXXX__XXXX', 'XXX___XXXX', 'XXXX__XXXX', 'XXXX__XXXX', 'XXXX__XXXX']],
    ispinclear: [['....X_....', 'XX____XXXX', '....X_....']]
  };
  const goals = templates[predicate] ?? (['spinclear', 'combospin'].includes(predicate) ? undefined : constructionPatterns[predicate as keyof typeof constructionPatterns]?.map(pattern => pattern.rows)); if (!goals?.length || side.engine.board.width !== 10) return 0;
  const board = side.engine.board.state; let best = -Infinity;
  for (const goal of goals) for (const mirror of [false, true]) {
    let filled = 0, blocked = 0;
    for (let y = 0; y < goal.length; y++) for (let x = 0; x < 10; x++) {
      if (!board[y][mirror ? 9 - x : x]) continue;
      if (goal[y][x] === 'X') filled++; else if (goal[y][x] === '_') blocked++;
    }
    best = Math.max(best, filled * 18 - blocked * 55);
  }
  return best;
}
export function reviveShapePreparation(side: QpSide) {
  const predicate = side.task?.prompts[side.task.active]?.predicate ?? '';
  const rules: Record<string, [string, number, boolean]> = {
    double: ['osztlj', 2, false], triple: ['lj', 3, false], szdouble: ['sz', 2, false], ljtriple: ['lj', 3, false],
    iflat: ['i', 1, false], iclearspam: ['i', 1, false], singleconsecutive: ['iosztlj', 1, false], szsingle: ['sz', 1, false],
    doublespiece: [side.task?.lastDoublePiece ?? 'osztlj', 2, false],
    szspin: ['sz', 1, true], ljspin: ['lj', 1, true], ispinclear: ['i', 1, true], ispindouble: ['i', 2, true],
    szspintriple: ['sz', 3, true], ljspintriple: ['lj', 3, true], ljgarbage: ['lj', 1, true], szgarbage: ['sz', 1, true],
    szljspin: ['szlj', 0, true], noclearspin: ['itszlj', 0, true],
    szspinconsecutive: ['sz', 2, true], ljspinconsecutive: ['lj', 2, true],
    spinbuckets: [['i', 't', 's', 'z', 'j', 'l'].filter(piece => !side.task?.spinPieces.includes(piece)).join(''), 1, true]
  };
  const goal = rules[predicate]; if (!goal) return 0;
  const [pieces, lines, spin] = goal, board = side.engine.board.state, width = side.engine.board.width;
  const garbage = predicate === 'ljgarbage' || predicate === 'szgarbage';
  const anyClear = garbage || ['ispinclear', 'szspin', 'ljspin', 'spinbuckets'].includes(predicate);
  const heights = board.map(row => row.filter(Boolean).length), peak = heights.reduce((top, value, y) => value ? y + 1 : top, 0);
  const occupied = (x: number, y: number) => x < 0 || x >= width || y < 0 || !!board[y]?.[x];
  let best = 0;
  for (const pattern of patterns) {
    if (!pieces.includes(pattern.piece) || pattern.height < lines || ['iflat', 'iclearspam'].includes(predicate) && pattern.height !== 1) continue;
    for (let y = 0; y <= Math.min(peak, side.engine.board.height - pattern.height - 1); y++) for (let x = 0; x <= width - pattern.width; x++) {
      if (predicate === 'iclearspam' && x !== Math.floor(width / 2) - 2) continue;
      if (pattern.cells.some(([dx, dy]) => occupied(x + dx, y + dy))) continue;
      if (!pattern.cells.some(([dx, dy]) => occupied(x + dx, y + dy - 1))) continue;
      const scoringRows = Array.from({ length: pattern.height }, (_, dy) => y + dy).filter(row => !garbage || board[row].some(tile => tile?.mino === 'gb'));
      if (!scoringRows.length) continue;
      const fills = scoringRows.map(row => heights[row]).sort((a, b) => b - a).slice(0, lines);
      const clears = Array.from({ length: pattern.height }, (_, dy) => heights[y + dy] + pattern.cells.filter(cell => cell[1] === dy).length === width).filter(Boolean).length;
      if (clears > lines && !anyClear || board.slice(y, y + pattern.height).some(row => row.some(tile => String(tile?.mino) === 'gbd'))) continue;
      let value = fills.reduce((sum, fill) => sum + fill, 0) * 14 - y * 5;
      if (spin) {
        const blocked = [[0, 1], [-1, 0], [1, 0]].filter(([sx, sy]) => pattern.cells.some(([dx, dy]) => occupied(x + dx + sx, y + dy + sy))).length;
        value += blocked * 25 + (blocked === 3 ? 110 : 0);
        if (!blocked) value *= .2;
      }
      best = Math.max(best, value);
    }
  }
  return best;
}
