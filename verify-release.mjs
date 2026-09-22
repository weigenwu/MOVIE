import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

globalThis.location = { hostname: 'rawcdn.githack.com' };
globalThis.indexedDB = { open() { throw new Error('Shared hosting must not open saved directory handles'); } };
const source = await readFile(new URL('./save-location.js', import.meta.url), 'utf8');
const settings = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(settings.sharedHosting, true);
assert.equal(await settings.folderSetting('get'), undefined);
await assert.rejects(settings.folderSetting('set', { kind: 'directory' }));
assert.equal(await settings.folderSetting('set', null), undefined);
const bytes = Buffer.concat(await Promise.all([1, 2].map(n => readFile(new URL(`./vendor/core-${n}.wasm`, import.meta.url)))));
assert.equal(await WebAssembly.validate(bytes), true);
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
assert(app.includes('core-${n}.wasm'));
assert(!app.includes('core-${n}.bin'));
console.log('Release checks passed. Engine SHA256:', createHash('sha256').update(bytes).digest('hex'));
