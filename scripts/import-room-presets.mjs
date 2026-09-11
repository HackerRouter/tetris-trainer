import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const archive = resolve(process.argv[2] ?? '../TETRIO_OFFLINE/offline-data/archive');
const names = ['default', 'tetra league', 'tetra league (season 1)', 'enforced delays', '4wide', '100 battle royale', 'classic', 'arcade', 'bombs', 'quickplay'];
const entries = await Promise.all((await readdir(join(archive, 'metadata'))).filter(file => file.endsWith('.json')).map(async file => ({ ...JSON.parse(await readFile(join(archive, 'metadata', file), 'utf8')), id: file.slice(0, -5) })));
let source = null;
for (const entry of entries.filter(entry => new URL(entry.url).hostname === 'tetr.io' && entry.size > 1_000_000 && new URL(entry.url).pathname.endsWith('.js')).sort((a, b) => b.savedAt.localeCompare(a.savedAt))) {
  const bytes = await readFile(join(archive, 'bodies', `${entry.id}.bin`));
  const text = bytes.toString('utf8'), presets = {};
  for (const match of text.matchAll(/(?:"([^"]+)"|(\w+)):"(options\.presets=[^"]+)"/g)) {
    const id = match[1] ?? match[2];
    if (names.includes(id)) presets[id] = Object.fromEntries(match[3].split(';').map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
  }
  if (names.every(name => presets[name])) { source = { version: 1, url: entry.url, capturedAt: entry.savedAt, sha256: createHash('sha256').update(bytes).digest('hex'), presets: Object.fromEntries(names.map(name => [name, presets[name]])) }; break; }
}
if (!source) throw new Error('No complete room preset catalog found in the offline archive.');
await writeFile('src/room-presets.json', JSON.stringify(source, null, 2) + '\n');
console.log(`Imported ${names.length} room presets from ${source.capturedAt}.`);
