export function formatTime(milliseconds: number) {
  const total = Math.max(0, Math.round(milliseconds));
  return `${Math.floor(total / 60000)}:${String(Math.floor(total / 1000) % 60).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}
