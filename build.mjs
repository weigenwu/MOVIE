import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('dist/vendor', { recursive: true });
await cp('src', 'dist', { recursive: true });
for (const name of ['ffmpeg.js', '814.ffmpeg.js']) await cp(`node_modules/@ffmpeg/ffmpeg/dist/umd/${name}`, `dist/vendor/${name}`);
await cp('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js', 'dist/vendor/ffmpeg-core.js');
// Keep each hosted asset below 25 MiB; the browser joins the two engine parts.
const wasm = await readFile('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
const middle = Math.ceil(wasm.length / 2);
await writeFile('dist/vendor/core-1.bin', wasm.subarray(0, middle));
await writeFile('dist/vendor/core-2.bin', wasm.subarray(middle));
const worker = await readFile('src/sw.js', 'utf8');
const files = JSON.parse(worker.match(/const FILES = (\[.*?\]);/)[1].replaceAll("'", '"'));
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(`dist/${file}`)).digest('hex');
await writeFile('dist/sw.js', worker.replace('const EXPECTED = {};', `const EXPECTED = ${JSON.stringify(hashes)};`));
console.log('Built video editor in dist/');
