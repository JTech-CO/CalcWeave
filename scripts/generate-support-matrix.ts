import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createSupportMatrix, digest, SUPPORT_PATH, SUPPORT_MD_PATH, supportMarkdown } from './m16-support-source';
const args = process.argv.slice(2); assert(args.length === 1 && ['--write','--check'].includes(args[0]!), 'Use --write or --check');
const matrix = await createSupportMatrix(); const json = JSON.stringify(matrix, null, 2) + '\n', md = supportMarkdown(matrix);
assert(Buffer.byteLength(json, 'utf8') <= 8 * 1024 * 1024, 'Support JSON exceeds8MiB');
if (args[0] === '--write') { await writeFile(SUPPORT_PATH, json); await writeFile(SUPPORT_MD_PATH, md); }
else { assert.equal(await readFile(SUPPORT_PATH, 'utf8'), json, 'Support JSON is stale'); assert.equal(await readFile(SUPPORT_MD_PATH, 'utf8'), md, 'Support Markdown is stale'); }
process.stdout.write(JSON.stringify({ mode: args[0], counts: matrix.counts, jsonBytes: Buffer.byteLength(json), jsonSha256: digest(json) }) + '\n');
