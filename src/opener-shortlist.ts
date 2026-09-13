const key = 'tetrio-trainer-opener-shortlist-v1';
export const shortlistEvent = 'opener-shortlist-change';

export function shortlistedOpeners(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(value)) return [...new Set(value.filter(id => typeof id === 'string' && id.length <= 100))].slice(0, 1000);
  } catch {}
  return [];
}

export function toggleShortlist(id: string) {
  const current = shortlistedOpeners(), next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
  localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new Event(shortlistEvent));
}

export function prioritizeOpeners<T extends { id: string }>(items: T[], ids = shortlistedOpeners()): T[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

export function shortlistCard(card: HTMLButtonElement, id: string, name: string) {
  const entry = document.createElement('div'); entry.className = 'opener-entry';
  const star = document.createElement('button'), selected = shortlistedOpeners().includes(id);
  star.type = 'button'; star.className = 'shortlist-star secondary'; star.textContent = selected ? '★' : '☆';
  star.setAttribute('aria-label', `${selected ? 'Remove from shortlist' : 'Shortlist'}: ${name}`); star.setAttribute('aria-pressed', String(selected));
  star.title = selected ? 'Remove from shortlist' : 'Shortlist and pin this opener';
  star.addEventListener('click', () => {
    try { toggleShortlist(id); }
    catch { star.title = 'Browser storage is unavailable. The shortlist was not changed.'; }
    star.blur();
  });
  entry.append(card, star); return entry;
}
