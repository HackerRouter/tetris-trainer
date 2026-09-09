import { copyPiece } from './finesse';
import type { TrainerGame } from './game';

const colors: Record<string, string> = { i: '#49cfe5', o: '#eacf66', t: '#ae85e8', s: '#71cf98', z: '#e77888', j: '#759fea', l: '#eeac6c', gb: '#777e91' };

export function drawGame(canvas: HTMLCanvasElement, game: TrainerGame) {
  const ctx = canvas.getContext('2d')!;
  const engine = game.engine;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(0, 70);
  ctx.fillStyle = '#0b101b'; ctx.fillRect(16, 20, 300, 600);
  const drawCell = (x: number, y: number, color: string, outline = false) => {
    if (y < 0 || y >= 23) return;
    const px = 16 + x * 30, py = 20 + (19 - y) * 30;
    if (outline) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(px + 3, py + 3, 24, 24); }
    else { ctx.fillStyle = color; ctx.fillRect(px + 1, py + 1, 28, 28); ctx.fillStyle = '#ffffff24'; ctx.fillRect(px + 2, py + 2, 26, 3); }
  };
  if (game.settings.display.grid) {
    ctx.strokeStyle = '#ffffff0d'; ctx.lineWidth = 1;
    for (let x = 0; x <= 10; x++) { ctx.beginPath(); ctx.moveTo(16 + x * 30, 20); ctx.lineTo(16 + x * 30, 620); ctx.stroke(); }
    for (let y = 0; y <= 20; y++) { ctx.beginPath(); ctx.moveTo(16, 20 + y * 30); ctx.lineTo(316, 20 + y * 30); ctx.stroke(); }
  }
  for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) {
    const tile = engine.board.state[y][x];
    if (tile) drawCell(x, y, colors[String(tile).toLowerCase()] || '#8a92a3');
  }
  if (game.status !== 'topout') {
    if (game.settings.display.ghost) {
      const ghost = copyPiece(engine, engine.falling.snapshot()); ghost.softDrop(engine.board.state);
      ctx.globalAlpha = game.settings.display.ghostOpacity;
      for (const [x, y] of ghost.absoluteBlocks) drawCell(x, y, colors[ghost.symbol.toLowerCase()], true);
      ctx.globalAlpha = 1;
    }
    for (const [x, y] of engine.falling.absoluteBlocks) drawCell(x, y, colors[engine.falling.symbol.toLowerCase()]);
  }
  if (game.fault) for (const [x, y] of game.fault.target) drawCell(x, y, '#ffce79', true);
  const preview = (piece: string | null, y: number) => {
    if (!piece) return;
    const data = engine.getPreview(piece as typeof engine.falling.symbol);
    for (const [x, cy] of data.data) { ctx.fillStyle = colors[piece.toLowerCase()]; ctx.fillRect(355 + x * 22, y + cy * 22, 20, 20); }
  };
  ctx.fillStyle = '#8795ae'; ctx.font = '12px system-ui'; ctx.fillText('HOLD', 354, 39); ctx.fillText('NEXT', 354, 149);
  preview(engine.held, 60); engine.queue.slice(0, 5).forEach((piece, i) => preview(piece, 168 + i * 78));
  if (['paused', 'ready', 'complete', 'topout'].includes(game.status)) {
    ctx.fillStyle = '#0b101bcc'; ctx.fillRect(16, 230, 300, 130);
    ctx.fillStyle = '#e8edf8'; ctx.textAlign = 'center'; ctx.font = '600 25px system-ui';
    ctx.fillText({ ready: 'Ready when you are', paused: 'Paused', complete: '40 lines complete', topout: 'Game over', playing: '' }[game.status], 166, 289);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}
