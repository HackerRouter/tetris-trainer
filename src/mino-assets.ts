const images = new Map<string, HTMLImageElement>();
const ghosts = new Map<string, HTMLCanvasElement>();
export const nativeColors: Record<string, string> = Object.fromEntries(Object.entries({ z: 13521497, l: 13533522, o: 13550930, s: 8441426, i: 5426860, j: 6705870, t: 12800718, d: 4605510, gb: 6181727, gbd: 2359335 }).map(([name, color]) => [name, `#${color.toString(16).padStart(6, '0')}`]));
function asset(name: string) {
  if (typeof Image === 'undefined') return null;
  if (!images.has(name)) { const image = new Image(); image.src = `/tetrio/ui/${name}.png`; images.set(name, image); }
  const image = images.get(name)!;
  return image.complete && image.naturalWidth ? image : null;
}
export function drawMino(ctx: CanvasRenderingContext2D, symbol: string, x: number, y: number, size: number) {
  const image = asset('minos'), index = ['z', 'l', 'o', 's', 'i', 'j', 't', 'd', 'gb', 'gbd'].indexOf(symbol);
  if (!image || index < 0) return false;
  ctx.drawImage(image, 2 + index % 5 * 96, 2 + Math.floor(index / 5) * 96, 92, 92, x, y, size, size);
  return true;
}
export function drawGhost(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, size: number) {
  const image = asset('ghost'); if (!image) return false;
  if (!ghosts.has(color)) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 92;
    const paint = canvas.getContext('2d')!; paint.drawImage(image, 2, 2, 92, 92, 0, 0, 92, 92);
    paint.globalCompositeOperation = 'source-in'; paint.fillStyle = color; paint.fillRect(0, 0, 92, 92); ghosts.set(color, canvas);
  }
  ctx.drawImage(ghosts.get(color)!, x, y, size, size); return true;
}
