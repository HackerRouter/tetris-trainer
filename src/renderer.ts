import type { Engine, EngineSnapshot, TetrominoSnapshot } from '@haelp/teto/engine';
import { copyPiece, type Cell } from './finesse';
import type { TrainerGame } from './game';
import type { Settings } from './settings';
import { drawNativeBorder } from './ui-assets';
import { drawMino, drawGhost, nativeColors } from './mino-assets';
import type { ModeRules } from './modes';

const colors = nativeColors;

export function drawBoard(canvas: HTMLCanvasElement, engine: Engine, board: EngineSnapshot['board'], piece: TetrominoSnapshot | null, target: Cell[] | null, options: Pick<Settings['display'], 'grid' | 'ghost' | 'ghostOpacity'> & Partial<Settings['display']>, buffer = 3) {
  const ctx = canvas.getContext('2d')!;
  const width = engine.board.width, height = engine.board.height;
  const size = canvas.width / width, top = size * buffer, bottom = top + size * height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = options.boardOpacity ?? 1;
  ctx.fillStyle = '#0b101b'; ctx.fillRect(0, top, canvas.width, size * height);
  ctx.globalAlpha = 1;
  const drawCell = (x: number, y: number, color: string, outline = false, symbol = '') => {
    if (y < 0 || y >= height + buffer) return;
    const px = x * size, py = top + (height - 1 - y) * size;
    if (outline) { if (!drawGhost(ctx, color, px, py, size)) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(px + 2, py + 2, size - 4, size - 4); } }
    else if (!drawMino(ctx, symbol, px, py, size)) { ctx.fillStyle = color; ctx.fillRect(px + 1, py + 1, size - 2, size - 2); ctx.fillStyle = '#ffffff24'; ctx.fillRect(px + 2, py + 2, size - 4, Math.max(1, size / 10)); }
  };
  if (options.grid) {
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = options.gridOpacity ?? .09; ctx.lineWidth = 1;
    for (let x = 1; x < width; x++) { ctx.beginPath(); ctx.moveTo(x * size, top); ctx.lineTo(x * size, bottom); ctx.stroke(); }
    for (let y = 1; y < height; y++) { ctx.beginPath(); ctx.moveTo(0, top + y * size); ctx.lineTo(canvas.width, top + y * size); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  for (let y = 0; y < Math.min(board.length, height + buffer); y++) for (let x = 0; x < width; x++) {
    const tile = board[y][x];
    if (tile) {
      const symbol = (typeof tile === 'string' ? tile : tile.mino).toLowerCase();
      drawCell(x, y, colors[symbol] || '#8a92a3', false, symbol);
      if (symbol === 'bomb') {
        const px = (x + .5) * size, py = top + (height - y - .5) * size;
        ctx.fillStyle = '#202533'; ctx.beginPath(); ctx.arc(px, py, size * .28, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, size * .05); ctx.stroke();
        ctx.fillStyle = '#ff9988'; ctx.fillRect(px + size * .1, py - size * .37, size * .12, size * .12);
      }
    }
  }
  const targetCells = new Set(target?.map(([x, y]) => `${x},${y}`));
  const ghostCells = new Set<string>();
  let ghostColor = '#b3b3b3';
  if (piece) {
    if (options.ghost && options.ghostOpacity > 0) {
      const ghost = copyPiece(engine, piece); ghost.softDrop(board);
      ghostColor = options.coloredGhost === false ? '#b3b3b3' : colors[ghost.symbol.toLowerCase()];
      ctx.globalAlpha = options.ghostOpacity;
      for (const [x, y] of ghost.absoluteBlocks) {
        const key = `${x},${y}`; ghostCells.add(key);
        if (!targetCells.has(key)) drawCell(x, y, ghostColor, true);
      }
      ctx.globalAlpha = 1;
    }
    for (const [x, y] of copyPiece(engine, piece).absoluteBlocks) drawCell(x, y, colors[piece.symbol.toLowerCase()], false, piece.symbol.toLowerCase());
  }
  const overlapColor = `#${ghostColor.slice(1).match(/../g)!.map(channel => Math.round(parseInt(channel, 16) * .65).toString(16).padStart(2, '0')).join('')}`;
  if (target) for (const [x, y] of target) {
    const overlap = ghostCells.has(`${x},${y}`);
    ctx.globalAlpha = overlap ? options.ghostOpacity : 1;
    drawCell(x, y, overlap ? overlapColor : '#9b9b9b', true);
  }
  ctx.globalAlpha = 1;
  if (!drawNativeBorder(ctx, top, canvas.width, size * height)) {
    ctx.strokeStyle = '#b3c3da'; ctx.lineWidth = 2;
    ctx.strokeRect(1, top + 1, canvas.width - 2, size * height - 2);
  }
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
      if (!drawMino(ctx, piece.toLowerCase(), left + x * size, top + y * size, size)) { ctx.fillStyle = colors[piece.toLowerCase()]; ctx.fillRect(left + x * size + 1, top + y * size + 1, size - 2, size - 2); }
    }
  });
  ctx.globalAlpha = 1;
}

const effects = new WeakMap<TrainerGame, { placements: number; since: number }>();

export type PlacementEffect = { cells: Cell[]; piece: string; hardDrop: boolean; lines: number };
type Scene = { board: EngineSnapshot['board']; piece: TetrominoSnapshot | null; target: Cell[] | null; hold: string | null; holdLocked: boolean; next: string[]; effect: PlacementEffect | null };

export function drawScene(canvas: HTMLCanvasElement, hold: HTMLCanvasElement, next: HTMLCanvasElement, engine: Engine, rules: ModeRules, display: Settings['display'], scene: Scene, age: number) {
  if (canvas.width !== engine.board.width * 30 || canvas.height !== (engine.board.height + 3) * 30) {
    canvas.width = engine.board.width * 30; canvas.height = (engine.board.height + 3) * 30;
  }
  drawBoard(canvas, engine, scene.board, scene.piece, scene.target, { ...display, ghost: display.ghost && rules.advanced.shadow });
  drawPreviews(hold, engine, [scene.hold], display.dimLockedHold && scene.holdLocked && !rules.infiniteHold);
  drawPreviews(next, engine, scene.next);
  drawPlacementEffect(canvas, engine, scene.effect, age);
}

function drawPlacementEffect(canvas: HTMLCanvasElement, engine: Engine, placement: PlacementEffect | null, age: number) {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (placement && age >= 0 && age < 240 && !reduced) {
    const ctx = canvas.getContext('2d')!, strength = Math.max(0, 1 - age / 240) * .5, size = canvas.width / engine.board.width;
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = strength * .5;
    for (const [x, y] of placement.cells) {
      const px = x * size, py = (engine.board.height + 2 - y) * size;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(px, py, size, size);
      if (placement.hardDrop) { const beam = ctx.createLinearGradient(0, py - size * 5, 0, py); beam.addColorStop(0, 'transparent'); beam.addColorStop(1, colors[placement.piece] ?? '#ffffff'); ctx.fillStyle = beam; ctx.fillRect(px + size * .3, py - size * 5, size * .4, size * 5); }
    }
    if (placement.lines) { ctx.globalAlpha = strength * .12; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, size * 3, canvas.width, size * engine.board.height); }
    ctx.restore();
  }
}

export function drawGame(canvas: HTMLCanvasElement, hold: HTMLCanvasElement, next: HTMLCanvasElement, game: TrainerGame) {
  const engine = game.engine, now = performance.now(), previous = effects.get(game);
  if (!previous || previous.placements !== game.placements.length) effects.set(game, { placements: game.placements.length, since: now });
  const placement = game.placements.at(-1);
  drawScene(canvas, hold, next, engine, game.rules, game.settings.display, {
    board: engine.board.state, piece: game.status === 'topout' || game.room.waiting ? null : engine.falling.snapshot(), target: game.target,
    hold: engine.held, holdLocked: engine.holdLocked, next: engine.queue.slice(0, game.rules.nextCount),
    effect: placement?.accepted ? { cells: placement.cells, piece: placement.piece, hardDrop: placement.inputs.includes('hardDrop'), lines: placement.result.lines } : null
  }, now - effects.get(game)!.since);
}
