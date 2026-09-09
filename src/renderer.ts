import type { Engine, EngineSnapshot, TetrominoSnapshot } from '@haelp/teto/engine';
import { copyPiece, type Cell } from './finesse';
import type { TrainerGame } from './game';

const colors: Record<string, string> = { i: '#49cfe5', o: '#eacf66', t: '#ae85e8', s: '#71cf98', z: '#e77888', j: '#759fea', l: '#eeac6c', gb: '#777e91' };

export function drawBoard(canvas: HTMLCanvasElement, engine: Engine, board: EngineSnapshot['board'], piece: TetrominoSnapshot | null, target: Cell[] | null, options: { grid: boolean; ghost: boolean; ghostOpacity: number }, buffer = 3) {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width / 10, top = size * buffer, bottom = top + size * 20;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b101b'; ctx.fillRect(0, top, canvas.width, size * 20);
  const drawCell = (x: number, y: number, color: string, outline = false) => {
    if (y < 0 || y >= 20 + buffer) return;
    const px = x * size, py = top + (19 - y) * size;
    if (outline) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(px + 2, py + 2, size - 4, size - 4); }
    else { ctx.fillStyle = color; ctx.fillRect(px + 1, py + 1, size - 2, size - 2); ctx.fillStyle = '#ffffff24'; ctx.fillRect(px + 2, py + 2, size - 4, Math.max(1, size / 10)); }
  };
  if (options.grid) {
    ctx.strokeStyle = '#ffffff18'; ctx.lineWidth = 1;
    for (let x = 1; x < 10; x++) { ctx.beginPath(); ctx.moveTo(x * size, top); ctx.lineTo(x * size, bottom); ctx.stroke(); }
    for (let y = 1; y < 20; y++) { ctx.beginPath(); ctx.moveTo(0, top + y * size); ctx.lineTo(canvas.width, top + y * size); ctx.stroke(); }
  }
  for (let y = 0; y < Math.min(board.length, 20 + buffer); y++) for (let x = 0; x < 10; x++) {
    const tile = board[y][x];
    if (tile) drawCell(x, y, colors[(typeof tile === 'string' ? tile : tile.mino).toLowerCase()] || '#8a92a3');
  }
  if (piece) {
    if (options.ghost) {
      const ghost = copyPiece(engine, piece); ghost.softDrop(board);
      ctx.globalAlpha = options.ghostOpacity;
      for (const [x, y] of ghost.absoluteBlocks) drawCell(x, y, colors[ghost.symbol.toLowerCase()], true);
      ctx.globalAlpha = 1;
    }
    for (const [x, y] of copyPiece(engine, piece).absoluteBlocks) drawCell(x, y, colors[piece.symbol.toLowerCase()]);
  }
  if (target) for (const [x, y] of target) drawCell(x, y, '#9b9b9b', true);
  ctx.strokeStyle = '#b3c3da'; ctx.lineWidth = 2;
  ctx.strokeRect(1, top + 1, canvas.width - 2, size * 20 - 2);
}

function drawPreviews(canvas: HTMLCanvasElement, engine: Engine, pieces: (string | null)[], dim = false) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = dim ? 0.4 : 1;
  const size = 30, slot = canvas.height / pieces.length;
  pieces.forEach((piece, index) => {
    if (!piece) return;
    const data = engine.getPreview(piece as typeof engine.falling.symbol);
    const left = (canvas.width - data.w * size) / 2, top = index * slot + (slot - data.h * size) / 2;
    for (const [x, y] of data.data) {
      ctx.fillStyle = colors[piece.toLowerCase()]; ctx.fillRect(left + x * size + 1, top + y * size + 1, size - 2, size - 2);
    }
  });
  ctx.globalAlpha = 1;
}

export function drawGame(canvas: HTMLCanvasElement, hold: HTMLCanvasElement, next: HTMLCanvasElement, game: TrainerGame) {
  const engine = game.engine;
  drawBoard(canvas, engine, engine.board.state, game.status === 'topout' ? null : engine.falling.snapshot(), game.target, game.settings.display);
  drawPreviews(hold, engine, [engine.held], engine.holdLocked && !game.settings.training.infiniteHold);
  drawPreviews(next, engine, engine.queue.slice(0, 5));
}
