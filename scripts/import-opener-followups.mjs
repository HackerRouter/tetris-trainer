import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { encoder, Field } from 'tetris-fumen';

await mkdir('TEMP', { recursive: true });
const sources = [];
async function wiki(title) {
  const url = `https://harddrop.com/w/index.php?title=${title}&action=raw`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${title}: ${response.status}`);
  const text = await response.text();
  await writeFile(`TEMP/${title}.wiki`, text);
  sources.push({ url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(text).digest('hex') });
  return text;
}
function diagrams(text) {
  return [...text.matchAll(/\{\{pfstart[^}]*\}\}([\s\S]*?)\{\{pfend\}\}/g)].map((match, index) => ({
    index, before: text.slice(0, match.index),
    rows: [...match[1].matchAll(/\{\{pfrow\|([^}]+)\}\}/g)].map(row => row[1].split('|').map(cell => cell.trim())).reverse()
  }));
}
const stickspin = await wiki('Stickspin'), mountainous = await wiki('Mountainous_Stacking');
const ms2 = mountainous.slice(mountainous.indexOf('== Mountainous Stacking 2 =='), mountainous.indexOf('== Mountainous Stacking 3 =='));
const profiles = [
  { id: 'stickspin', name: 'Stickspin', source: 'https://harddrop.com/wiki/Stickspin', text: stickspin },
  { id: 'db-377', name: 'Mountainous Stacking 2', source: 'https://harddrop.com/wiki/Mountainous_Stacking#Mountainous_Stacking_2', text: ms2 }
].map(({ text, ...profile }) => {
  const stages = [];
  for (const diagram of diagrams(text)) {
    if (!diagram.rows.length || diagram.rows.some(row => row.length !== 10)) continue;
    const cells = diagram.rows.flat(), spins = cells.filter(cell => cell === 'P').length;
    const full = diagram.rows.every(row => row.every(Boolean));
    if (!cells.includes('G') || !(spins === 4 || full)) continue;
    const heading = [...diagram.before.matchAll(/(?:^=+\s*(.*?)\s*=+\s*$|^\*\s*(.+)$)/gm)].at(-1);
    const name = (heading ? heading[1] ?? heading[2] : 'Continuation').replace(/\s*\(.*/, '').replace(/:.*$/, '').replaceAll("'''", '').replaceAll('[[', '').replaceAll(']]', '');
    const rows = diagram.rows.map(row => row.map(cell => cell === 'G' ? 'X' : cell === 'P' ? 'T' : cell ? '#' : '.').join(''));
    if (stages.some(stage => stage.rows.join('/') === rows.join('/'))) continue;
    stages.push({ id: `${profile.id}-stage-${diagram.index}`, name, rows, goal: full ? 'pc' : 'tspin', spinLines: spins === 4 ? diagram.rows.filter(row => row.every(Boolean)).length : 0 });
  }
  if (!stages.length) throw new Error(`No diagrams parsed for ${profile.name}`);
  return { ...profile, stages };
});
const first = diagrams(stickspin)[2].rows;
const fumen = encoder.encode([{ field: Field.create([...first].reverse().map(row => row.map(cell => cell === 'P' ? 'T' : cell || '_').join('')).join('')) }]);
const catalog = JSON.parse(await readFile('src/opener-catalog.json', 'utf8'));
if (!catalog.some(opener => opener.id === 'stickspin')) catalog.push({ id: 'stickspin', name: 'Stickspin', note: 'T-spin single opening. Published second-bag TSD and third-bag TST branches are available with continuation hints.', source: 'https://harddrop.com/wiki/Stickspin', fumen, finish: { piece: 't', lines: 1 } });
await writeFile('src/opener-catalog.json', JSON.stringify(catalog, null, 2) + '\n');
await writeFile('src/opener-followups.json', JSON.stringify(profiles, null, 2) + '\n');
await writeFile('TEMP/opener-followup-sources.json', JSON.stringify(sources, null, 2) + '\n');
console.log(profiles.map(profile => `${profile.name}: ${profile.stages.length} reference stages`).join('\n'));
