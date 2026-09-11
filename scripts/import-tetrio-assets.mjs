import { readFile, readdir, mkdir, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const archive = resolve(process.argv[2] ?? '../TETRIO_OFFLINE/offline-data/archive');
const destination = resolve('public/tetrio');
const files = await readdir(join(archive, 'metadata'));
const metadata = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => ({ ...JSON.parse(await readFile(join(archive, 'metadata', file), 'utf8')), id: file.slice(0, -5) })));
const selected = [
  ['/res/font/hun2.ttf', 'fonts/hun.ttf'], ['/res/font/cr.ttf', 'fonts/config.ttf'], ['/res/font/cb.ttf', 'fonts/config-bold.ttf'], ['/res/font/pfwex.woff', 'fonts/profont.woff'],
  ['/res/skins/board/generic/board.png', 'ui/board.png'], ['/res/skins/board/generic/queue.png', 'ui/queue.png'],
  ['/res/header-overlay.png', 'ui/header-overlay.png'], ['/res/footer.png', 'ui/footer.png'],
  ['/res/40l.svg', 'ui/sprint.svg'], ['/res/zen.svg', 'ui/zen.svg'], ['/res/customsolo.svg', 'ui/custom.svg'],
  ['/res/icon/revert.svg', 'ui/revert.svg'], ['/res/icon/close.svg', 'ui/close.svg'],
  ['/res/skins/minos/tetrio.2x.png', 'ui/minos.png'], ['/res/skins/ghost/tetrio.2x.png', 'ui/ghost.png'], ['/res/particles/spark.png', 'ui/spark.png']
];
const sources = [];
async function asset(path) {
  const entry = metadata.filter(entry => { const url = new URL(entry.url); return url.hostname === 'tetr.io' && url.pathname === path; }).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  if (!entry) throw new Error(`Asset missing from the offline archive: ${path}`);
  const body = await readFile(join(archive, 'bodies', `${entry.id}.bin`));
  if (body.length !== entry.size) throw new Error(`Incomplete cached asset: ${path}`);
  sources.push({ path, url: entry.url, savedAt: entry.savedAt, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
  return body;
}
async function save(path, body) {
  const output = join(destination, path);
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, body);
}
for (const [path, target] of selected) await save(target, await asset(path));
const rsd = await asset('/sfx/tetrio.opus.rsd');
if (rsd.subarray(0, 4).toString() !== 'tRSD' || rsd.readUInt32LE(4) !== 1 || rsd.readUInt32LE(8) !== 0) throw new Error('Unsupported RSD header.');
let cursor = 12, previous = null;
const atlas = {};
while (true) {
  const offset = rsd.readFloatLE(cursor), length = rsd.readUInt32LE(cursor + 4); cursor += 8;
  if (!Number.isFinite(offset) || length > 200 || cursor + length > rsd.length) throw new Error('Invalid RSD sound entry.');
  const name = rsd.subarray(cursor, cursor + length).toString('ascii'); cursor += length;
  if (previous) {
    if (offset <= previous.offset) throw new Error('RSD offsets must increase.');
    atlas[previous.name] = { offset: previous.offset, duration: offset - previous.offset };
  }
  if (length === 0) break;
  previous = { name, offset };
}
const length = rsd.readUInt32LE(cursor); cursor += 4;
if (cursor + length !== rsd.length || rsd.subarray(cursor, cursor + 4).toString() !== 'OggS') throw new Error('Invalid RSD audio payload.');
const names = ['boardappear', 'boardlock', 'move', 'rotate', 'floor', 'harddrop', 'softdrop', 'hold', 'clearline', 'clearquad', 'clearspin', 'clearbtb', 'allclear', 'combobreak', ...Array.from({ length: 16 }, (_, i) => `combo_${i + 1}`), 'countdown1', 'countdown2', 'countdown3', 'countdown4', 'countdown5', 'go', 'failure', 'finish', 'menuback', 'menuclick', 'menuconfirm', 'menuhover', 'menutap', 'pause_continue', 'pause_exit', 'pause_retry', 'pause_start', 'undo', 'finessefault'];
const working = await mkdtemp(join(tmpdir(), 'trainer-audio-'));
const input = join(working, 'source.ogg');
const output = join(working, 'sounds.ogg');
await writeFile(input, rsd.subarray(cursor));
const compact = {};
let samples = 0;
const filters = [`[0:a]aresample=48000,asplit=${names.length}${names.map((_, i) => `[s${i}]`).join('')}`];
names.forEach((name, i) => {
  const sound = atlas[name];
  if (!sound) throw new Error(`Required sound missing: ${name}`);
  const start = Math.round(sound.offset * 48000), end = Math.round((sound.offset + Math.min(sound.duration, name === 'finessefault' ? .22 : Infinity)) * 48000);
  filters.push(`[s${i}]atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS${name === 'finessefault' ? ',afade=t=out:st=0.18:d=0.04' : ''}[a${i}]`);
  compact[name] = { offset: samples / 48000, duration: (end - start) / 48000 };
  samples += end - start;
});
filters.push(`${names.map((_, i) => `[a${i}]`).join('')}concat=n=${names.length}:v=0:a=1[out]`);
try {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'libopus', '-b:a', '128k', output], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Audio extraction failed: ${result.error?.message ?? result.stderr}`);
  await save('sound-pack.json', JSON.stringify({ version: 1, encoding: 'base64', sprites: compact, data: (await readFile(output)).toString('base64') }));
  for (const obsolete of ['sounds.ogg', 'sounds.json']) {
    try { await unlink(join(destination, obsolete)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
} finally {
  await unlink(input);
  await unlink(output).catch(() => {});
  await rmdir(working);
}
await save('sources.json', JSON.stringify({ extractedAt: new Date().toISOString(), sources }, null, 2));
console.log(JSON.stringify({ assets: sources.length, sounds: names.length, duration: samples / 48000 }, null, 2));
