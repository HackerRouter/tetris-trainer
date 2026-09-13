import type { Engine, LockRes } from '@haelp/teto/engine';

export type ActionText = { frame: number; clear: string; spin: string; b2b: number; combo: number; pc: boolean };
export type TimedActionText = { action: ActionText; age: number };
const clearNames = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD', 'PENTA', 'HEXA', 'HEPTA', 'OCTA', 'ENNEA', 'DECA', 'HENDECA', 'DODECA', 'TRIADECA', 'TESSARADECA', 'PENTEDECA', 'HEXADECA', 'HEPTADECA', 'OCTADECA', 'ENNEADECA', 'EICOSA'];

export function actionText(engine: Engine, result: LockRes): ActionText {
  return { frame: engine.frame + 1, clear: clearNames[result.lines] ?? `${result.lines} LINES`, spin: result.spin === 'none' ? '' : `${result.spin === 'mini' ? 'MINI ' : ''}${result.mino.toUpperCase()}-spin`, b2b: result.lines ? Math.max(0, result.stats.b2b) : 0, combo: result.lines ? Math.max(0, result.stats.combo) : 0, pc: !!result.lines && engine.board.perfectClear };
}

export function actionLabels(items: TimedActionText[]) {
  const active = items.filter(item => item.age >= 0 && item.age < 1800 && (item.action.clear || item.action.spin));
  const latest = active.at(-1);
  if (!latest) return [];
  const { action, age } = latest;
  const repeat = (field: 'clear' | 'spin') => {
    let count = 0;
    for (let i = active.length - 1; i >= 0; i--) { if (active[i].action[field] !== action[field]) break; count++; }
    return `${action[field]}${count > 1 ? ` ×${count}` : ''}`;
  };
  return [
    { text: action.spin ? repeat('spin') : '', color: '#e9b8ff', size: 22, y: 0 },
    { text: action.clear ? repeat('clear') : '', color: '#ffffff', size: 30, y: 29 },
    { text: action.b2b ? `BACK-TO-BACK ×${action.b2b}` : '', color: '#ffd864', size: 15, y: 58 },
    { text: action.combo ? `${action.combo} COMBO` : '', color: '#ffffff', size: 25, y: 91 }
  ].filter(line => line.text).map(line => ({ ...line, age }));
}

const overlays = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export function drawActionText(board: HTMLCanvasElement, engine: Engine, items: TimedActionText[]) {
  const holder = board.closest<HTMLElement>('.tetrion');
  if (!holder) return;
  let canvas = overlays.get(board);
  if (!canvas) {
    canvas = document.createElement('canvas'); canvas.className = 'action-text-layer'; canvas.setAttribute('role', 'img');
    holder.append(canvas); overlays.set(board, canvas);
  }
  const w = holder.clientWidth, h = holder.clientHeight, pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * pixelRatio) || canvas.height !== Math.round(h * pixelRatio)) { canvas.width = Math.round(w * pixelRatio); canvas.height = Math.round(h * pixelRatio); }
  const ctx = canvas.getContext('2d')!; ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); ctx.clearRect(0, 0, w, h);
  const bounds = board.getBoundingClientRect(), parent = holder.getBoundingClientRect(), size = bounds.width / engine.board.width;
  const left = bounds.left - parent.left, top = bounds.top - parent.top + size * 3, height = size * engine.board.height;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches, labels = actionLabels(items);
  const pc = [...items].reverse().find(item => item.action.pc && item.age >= 0 && item.age < 5000);
  canvas.setAttribute('aria-label', [...labels.map(line => line.text), ...(pc ? ['ALL CLEAR'] : [])].join(' · ') || '');
  const text = (value: string, x: number, y: number, fontSize: number, color: string, maxWidth: number) => {
    ctx.font = `700 ${fontSize}px Config, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fontSize / 10); ctx.strokeStyle = '#0b101bdd'; ctx.strokeText(value, x, y, maxWidth); ctx.fillStyle = color; ctx.fillText(value, x, y, maxWidth);
  };
  const scale = Math.min(1, size / 30), area = Math.max(1, left - 8);
  for (const label of labels) {
    const t = label.age / 1800, entrance = Math.min(1, label.age / 130), exit = Math.min(1, (1800 - label.age) / 450);
    ctx.save(); ctx.globalAlpha = reduced ? 1 : entrance * exit;
    ctx.translate(area / 2 + (reduced ? 0 : (1 - entrance) * -12 * scale), top + height * .25 + label.y * scale);
    const pulse = reduced ? 1 : 1 + Math.sin(Math.min(1, t * 6) * Math.PI) * .08; ctx.scale(pulse, pulse);
    text(label.text, 0, 0, label.size * scale, label.color, area * .94); ctx.restore();
  }
  if (!pc) return;
  const t = pc.age / 5000, entrance = Math.min(1, t / .1), exit = Math.min(1, (1 - t) / .2);
  const pulse = reduced ? 1 : t < .1 ? .5 + entrance * .7 : t < .15 ? 1.2 - (t - .1) : 1.175 - (t - .15) * .22;
  ctx.save(); ctx.beginPath(); ctx.rect(left + 2, top, bounds.width - 4, height); ctx.clip();
  ctx.translate(left + bounds.width / 2, top + height / 2); ctx.rotate(reduced ? 0 : (1 - entrance) * -.085); ctx.scale(pulse, pulse);
  const fontSize = Math.min(60 * scale, bounds.width * .24), color = t < .1 ? '#ffffff' : t < .15 ? '#ffb3a0' : t < .8 ? '#ffe5a5' : '#ffffff';
  if (!reduced) {
    ctx.save(); const echo = 1 + t * 1.5; ctx.scale(echo, echo); ctx.globalAlpha = Math.max(0, .22 * (1 - t)) * entrance;
    text('ALL', 0, -fontSize * .43, fontSize, '#b49b66', bounds.width * .78); text('CLEAR', 0, fontSize * .43, fontSize, '#b49b66', bounds.width * .78); ctx.restore();
  }
  ctx.globalAlpha = reduced ? 1 : entrance * exit * .95;
  text('ALL', 0, -fontSize * .43, fontSize, color, bounds.width * .78); text('CLEAR', 0, fontSize * .43, fontSize, color, bounds.width * .78); ctx.restore();
}
