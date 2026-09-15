export function spinLabel(piece: string, spin: string, lines: number) {
  const clear = ['Zero', 'Single', 'Double', 'Triple', 'Quad'][lines] ?? `${lines}-line`;
  return spin === 'none' ? `${piece.toUpperCase()} · ${lines} lines` : `${spin === 'mini' ? 'Mini ' : ''}${piece.toUpperCase()}-spin ${clear}`;
}
