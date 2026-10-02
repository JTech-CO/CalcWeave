import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getReleaseCatalog } from '../packages/release/src';
import { OFFLINE_ASSET_PATH, type OfflineManifest } from './offline-build';

const catalog = getReleaseCatalog(), checks: string[] = [];
function check(condition: unknown, message: string): void { assert(condition, message); checks.push(message); }
check(catalog.version === '0.6.0' && catalog.engineVersion === '0.6.0-m6', 'app/engine release versions');
check(catalog.blocks.length === 74 && new Set(catalog.blocks.map(block => block.id)).size === 74, 'single registry 74 unique executable definitions');
const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
check(packageJson.version === catalog.version, 'package/release catalog version agreement');
const manifest = JSON.parse(await readFile('dist/offline-manifest.json', 'utf8')) as OfflineManifest;
check(manifest.schemaVersion === 1 && manifest.scope === '/' && manifest.appVersion === catalog.version && manifest.engineVersion === catalog.engineVersion, 'offline release version and root scope agreement');
const { releaseId, ...meaning } = manifest;
check(createHash('sha256').update(JSON.stringify(meaning)).digest('hex') === releaseId, 'releaseId binds complete static asset manifest');
check(manifest.assets.length <= 128 && new Set(manifest.assets.map(asset => asset.url)).size === manifest.assets.length, 'bounded unique offline allowlist');
for (const asset of manifest.assets) {
  check(OFFLINE_ASSET_PATH.test(asset.url) && !asset.url.includes('..') && /^[a-f0-9]{64}$/.test(asset.sha256), `safe static asset ${asset.url}`);
  const bytes = await readFile(join('dist', asset.url.slice(1)));
  check(bytes.byteLength === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256, `final built bytes match ${asset.url}`);
}
check(manifest.assets.reduce((total, asset) => total + asset.bytes, 0) <= 32 * 1024 * 1024, 'offline shell size limit');
const html = await readFile('dist/index.html', 'utf8');
const decodedHtml = html.replaceAll('&#39;', "'").replaceAll('&apos;', "'");
check(decodedHtml.includes('http-equiv="Content-Security-Policy"') && decodedHtml.includes("script-src 'self'") && decodedHtml.includes("object-src 'none'") && !decodedHtml.includes('unsafe-eval'), 'production CSP meta blocks dynamic/inline script evaluation');
check(html.indexOf('Content-Security-Policy') < html.indexOf('<script') && !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'CSP precedes external-only application scripts');
check(html.includes('name="referrer" content="no-referrer"'), 'production referrer policy');
for (const policy of ['terms', 'privacy', 'cookies', 'notices']) {
  const path = `/${policy}/index.html`, source = await readFile(`dist${path}`, 'utf8');
  check(manifest.assets.some(asset => asset.url === path) && source.includes('Content-Security-Policy') && source.includes('lang="ko"'), `offline accessible protected policy ${policy}`);
  if (policy !== 'notices') check(source.includes('JTech-Co') && source.includes('jtech-bryan@proton.me'), `operator/contact in ${policy}`);
}
async function files(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
const builtFiles = await files('dist');
check(!builtFiles.some(path => path.endsWith('.map') || /(?:^|[\\/])\.env/.test(path)), 'no source maps or environment files distributed');
for (const file of builtFiles.filter(path => /\.(js|css)$/.test(path) && !path.endsWith('sw.js'))) check(manifest.assets.some(asset => asset.url === '/' + relative('dist', file).replaceAll('\\', '/')), 'all code/Worker/lazy chunks are in static release');
const secretPattern = /(?:\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for (const path of builtFiles.filter(path => /\.(js|html|json)$/.test(path))) check(!secretPattern.test(await readFile(path, 'utf8')), `no recognized secret material in ${relative('dist', path)}`);
const workflow = await readFile('.github/workflows/pages.yml', 'utf8');
check(!workflow.includes('pull_request_target') && /workflow_dispatch:/.test(workflow) && !/^\s+push:/m.test(workflow), 'publication is explicitly dispatched');
const approvedActions = new Set([
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b',
  'actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b',
  'actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e',
]);
const actualActions = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map(match => match[1]!);
check(actualActions.length === approvedActions.size && actualActions.every(action => approvedActions.has(action)), 'only official Actions at the independently verified commit allowlist');
check(workflow.includes("process.env.CALCWEAVE_PAGES_BASE !== ''") && workflow.includes("process.env.CALCWEAVE_PAGES_ORIGIN !== 'https://calcweave.com'"), 'workflow rejects repository subpath and unconfigured custom domain');
await mkdir('docs/evidence', { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), appVersion: catalog.version, engineVersion: catalog.engineVersion, releaseId, checks, files: manifest.assets, totalStaticBytes: manifest.assets.reduce((total, asset) => total + asset.bytes, 0), publicDeploymentClaimed: false };
await writeFile('docs/evidence/m6-release-verification.json', JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify({ checks: checks.length, staticFiles: manifest.assets.length, totalStaticBytes: evidence.totalStaticBytes, releaseId }) + '\n');
