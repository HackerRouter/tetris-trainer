type Rectangle = [number, number, number, number];
type Edges = [number, number, number, number];

const atlas = (url: string) => {
  if (typeof Image === 'undefined') return null;
  const image = new Image(); image.src = url; return image;
};
const board = atlas('/tetrio/ui/board.png'), queue = atlas('/tetrio/ui/queue.png');

function nineSlice(ctx: CanvasRenderingContext2D, image: HTMLImageElement, source: Rectangle, target: Rectangle, slices: Edges, scale: number) {
  const [sx, sy, sw, sh] = source, [dx, dy, dw, dh] = target, [left, top, right, bottom] = slices;
  const xs = [0, left, sw - right, sw], ys = [0, top, sh - bottom, sh];
  const tx = [0, left * scale, dw - right * scale, dw], ty = [0, top * scale, dh - bottom * scale, dh];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const width = xs[x + 1] - xs[x], height = ys[y + 1] - ys[y];
    if (width > 0 && height > 0 && tx[x + 1] > tx[x] && ty[y + 1] > ty[y]) ctx.drawImage(image, sx + xs[x], sy + ys[y], width, height, dx + tx[x], dy + ty[y], tx[x + 1] - tx[x], ty[y + 1] - ty[y]);
  }
}

export function drawNativeBorder(ctx: CanvasRenderingContext2D, top: number, width: number, height: number) {
  if (!board?.complete || !board.naturalWidth) return false;
  ctx.save(); ctx.beginPath();
  ctx.rect(0, top, 2, height); ctx.rect(width - 2, top, 2, height); ctx.rect(0, top + height - 2, width, 2);
  ctx.clip();
  nineSlice(ctx, board, [111, 2, 27, 18], [0, top, width, height], [9, 0, 9, 9], 2 / 9);
  ctx.restore();
  return true;
}

export function drawNativePreview(canvas: HTMLCanvasElement, kind: 'hold' | 'next') {
  if (!queue?.complete || !queue.naturalWidth) return;
  const panel = canvas.parentElement!, height = Math.round(panel.clientHeight * 2), width = Math.round(panel.clientWidth * 2);
  if (!height || !width) return;
  if (canvas.width === width && canvas.height === height && panel.classList.contains('native-frame')) return;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  nineSlice(ctx, queue, [2, kind === 'hold' ? 148 : 2, 474, 142], [0, 0, width, height], [180, 82, 50, 50], width / 474);
  panel.classList.add('native-frame');
}
