import type { AnalysisContext } from './analysis-context';
import type { PcRecord } from './pc-scenes';

export function structureTag(context: AnalysisContext) {
  const rows = context.snapshot.board, height = rows.reduce((h,row,y) => row.some(Boolean) ? y + 1 : h, 0);
  let holes = 0;
  for (let x = 0; x < context.rules.board.width; x++) { let covered = false; for (let y = height - 1; y >= 0; y--) { if (rows[y][x]) covered = true; else if (covered) holes++; } }
  return `${context.rules.board.width} columns / ${height <= 4 ? 'low' : height <= 8 ? 'medium' : 'high'} stack / ${holes ? 'covered gaps' : 'open gaps'} / ${context.snapshot.hold ? 'Hold available' : 'empty Hold'}`;
}
export function practiceSummary(records: PcRecord[]) {
  const independent = records.filter(r => (r.initialLearning ?? r.learning) === 'none'), successes = records.filter(r => r.solved);
  return {
    attempts: records.length, successes: successes.length, independentAttempts: independent.length, independentSolved: independent.filter(r => r.solved && r.learning === 'none').length,
    hintUsed: records.filter(r => r.learning !== 'none').length, firstTry: successes.filter(r => r.mistakes === 0 && r.faults === 0).length,
    retries: records.reduce((sum,r) => sum + r.mistakes + r.faults, 0), thinkingMs: records.reduce((sum,r) => sum + (r.thinkingMs ?? 0), 0),
    weaknesses: [...new Set(records.map(r => r.structure).filter(Boolean))].map(structure => {
      const group = records.filter(r => r.structure === structure); return { structure, attempts: group.length, solved: group.filter(r => r.solved).length, mistakes: group.reduce((sum,r) => sum + r.mistakes, 0) };
    }).sort((a,b) => b.mistakes - a.mistakes || a.solved / a.attempts - b.solved / b.attempts)
  };
}
