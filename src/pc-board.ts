import type { Cell } from './finesse';

export function pcBoardFeasible(rows: number[], width: number, height: number) {
  if (rows.some((row, y) => y >= height && row)) return false;
  let leftEmpty = 0;
  for (let x = 0; x < width - 1; x++) {
    let separated = true;
    const pair = 3 << x;
    for (let y = 0; y < height; y++) {
      const row = rows[y] ?? 0;
      leftEmpty += Number(!(row & (1 << x)));
      if (!(row & pair)) separated = false;
    }
    if (separated && leftEmpty % 4) return false;
  }
  return true;
}

export function pcBoardAfter(rows: number[], target: Cell[], width: number, height: number) {
  const placed = Array.from({ length: height }, (_, y) => rows[y] ?? 0), full = (1 << width) - 1;
  for (const [x, y] of target) placed[y] |= 1 << x;
  const remaining = placed.filter(row => row !== full);
  return { rows: remaining, lines: height - remaining.length };
}

export function pcBoardOrder(rows: number[], width: number) {
  let holes = 0, transitions = 0, heightSum = 0;
  for (let x = 0; x < width; x++) {
    let top = false;
    for (let y = rows.length - 1; y >= 0; y--) {
      const occupied = !!(rows[y] & (1 << x));
      if (occupied && !top) { heightSum += y + 1; top = true; }
      if (!occupied && top) holes++;
      if (x && occupied !== !!(rows[y] & (1 << (x - 1)))) transitions++;
    }
  }
  return holes * 8 + transitions * 4 + heightSum * .5;
}
