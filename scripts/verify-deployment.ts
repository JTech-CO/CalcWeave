import { releaseEvidencePrefix } from './social-metadata';
import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { isOfflineAssetUrl, type OfflineManifest } from './offline-build';
import { parseDeploymentBase } from './pages-base';
import { APP_VERSION } from '../packages/release/src';
import { ENGINE_VERSION } from '../packages/model/src';

// Read-only checks of the two approved destinations. No credentials/model data.
const url = new URL(process.argv[2] ?? 'https://jtech-co.github.io/CalcWeave/');
if (!((url.origin === 'https://jtech-co.github.io' && url.pathname === '/CalcWeave/') || (url.origin === 'https://calcweave.com' && url.pathname === '/')) || url.search || url.hash || url.username || url.password) throw new Error('Only the approved CalcWeave Pages or custom-domain address is accepted.');
const artifactDirectory = resolve(process.argv[3] ?? 'dist');
const artifactRelative = relative(resolve('.'), artifactDirectory);
assert(!artifactRelative.startsWith('..') && !isAbsolute(artifactRelative), 'Artifact directory must remain in this workspace.');
const localManifest = JSON.parse(await readFile(join(artifactDirectory, 'offline-manifest.json'), 'utf8')) as OfflineManifest;
const scope = parseDeploymentBase(localManifest.scope);
assert(scope === url.pathname && localManifest.schemaVersion === 1 && localManifest.assets.length <= 128, 'Published path must match the bounded local artifact scope.');
assert(localManifest.assets.every(asset => isOfflineAssetUrl(asset.url, scope) && /^[a-f0-9]{64}$/.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes >= 0), 'Invalid artifact allowlist.');
assert(localManifest.assets.reduce((sum, asset) => sum + asset.bytes, 0) <= 32 * 1024 * 1024, 'Artifact size limit.');
const { releaseId, ...meaning } = localManifest;
assert(createHash('sha256').update(JSON.stringify(meaning)).digest('hex') === releaseId, 'Artifact manifest digest.');
const shellExpected = localManifest.assets.find(asset => asset.url === `${scope}index.html`);
assert(shellExpected, 'Artifact must include its application shell.');
const localWorker = await readFile(join(artifactDirectory, 'sw.js'));
const workerExpected = { bytes: localWorker.byteLength, sha256: createHash('sha256').update(localWorker).digest('hex') };
const report = { generatedAt: new Date().toISOString(), url: url.href, appVersion: localManifest.appVersion, engineVersion: localManifest.engineVersion, scope, releaseId, artifactDirectory: artifactRelative.replaceAll('\\', '/'), dns: [] as { address: string; family: number }[], checks: {} as Record<string, boolean | string | null>, verifiedApplicationDeployment: false, verifiedPublicLaunch: false };
const required = ['dnsResolved', 'https200', 'httpRedirectsToHttps', 'calcWeaveHtml', 'directoryShellParity', 'privacy/', 'terms/', 'cookies/', 'notices/', 'offline-manifest.json', 'sw.js', 'serviceWorkerParity', 'currentRelease', 'releaseParity', 'staticAssetsParity', 'privatePathsAbsent'];
async function responseMatchesBytes(response: Response, expected: { bytes: number; sha256: string }): Promise<boolean> {
  if (response.status !== 200 || !response.body) return false;
  const reader = response.body.getReader(), digest = createHash('sha256'); let bytes = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > expected.bytes) { await reader.cancel(); return false; }
    digest.update(chunk.value);
  }
  return bytes === expected.bytes && digest.digest('hex') === expected.sha256;
}
async function boundedText(response: Response, maximum: number): Promise<string> {
  if (!response.body) throw new Error('Missing response body.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > maximum) { await reader.cancel(); throw new Error('Remote response limit.'); } chunks.push(chunk.value); }
  return Buffer.concat(chunks).toString('utf8');
}
try { report.dns = await lookup(url.hostname, { all: true }); report.checks.dnsResolved = report.dns.length > 0; }
catch (error) { report.checks.dnsResolved = false; report.checks.dnsError = error instanceof Error && 'code' in error ? String(error.code) : 'DNS_UNAVAILABLE'; }
if (report.checks.dnsResolved) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    report.checks.https200 = response.status === 200;
    report.checks.directoryShellParity = await responseMatchesBytes(response.clone(), shellExpected);
    const source = await boundedText(response, 512 * 1024);
    report.checks.calcWeaveHtml = source.includes('<title>CalcWeave') && source.includes('Content-Security-Policy') && source.includes(`${scope}assets/`) && !source.includes('jekyll');
    for (const header of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'strict-transport-security', 'referrer-policy', 'permissions-policy']) report.checks[header] = response.headers.get(header);
    report.checks.setCookiePresent = response.headers.has('set-cookie');
    const redirect = await fetch(new URL(url.href.replace('https:', 'http:')), { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const location = redirect.headers.get('location');
    report.checks.httpRedirectsToHttps = [301, 302, 307, 308].includes(redirect.status) && location !== null && new URL(location, url).href === url.href;
    for (const path of ['privacy/', 'terms/', 'cookies/', 'notices/', 'offline-manifest.json', 'sw.js']) {
      const resource = await fetch(new URL(path, url), { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      report.checks[path] = resource.status === 200;
      if (path === 'offline-manifest.json' && resource.ok) {
        const manifest = JSON.parse(await boundedText(resource, 128 * 1024)) as OfflineManifest;
        report.checks.currentRelease = manifest.appVersion === localManifest.appVersion && manifest.engineVersion === localManifest.engineVersion && manifest.scope === scope;
        report.checks.releaseParity = JSON.stringify(manifest) === JSON.stringify(localManifest);
      }
      if (path === 'sw.js') report.checks.serviceWorkerParity = await responseMatchesBytes(resource, workerExpected);
    }
    report.checks.staticAssetsParity = true;
    for (const asset of localManifest.assets) {
      const resource = await fetch(new URL(asset.url, url), { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!await responseMatchesBytes(resource, asset)) { report.checks.staticAssetsParity = false; break; }
    }
    report.checks.privatePathsAbsent = true;
    for (const path of ['.env', '.env.local', '.git/config', 'backup.sql']) {
      const response = await fetch(new URL(path, url), { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      report.checks[`private:${path}`] = response.status === 404;
      if (response.body) await response.body.cancel();
      if (response.status !== 404) report.checks.privatePathsAbsent = false;
    }
  } catch (error) { report.checks.remoteFetch = error instanceof Error ? error.name : 'HTTPS_FETCH_FAILED'; }
}
report.verifiedApplicationDeployment = required.every(check => report.checks[check] === true) && !report.checks.remoteFetch;
report.checks.actualNoviceStudy = 'Not verified: automation is not an observed F06 novice study.';
report.checks.customDomain = url.hostname === 'calcweave.com' ? 'Custom-domain ownership must be independently verified in repository settings.' : 'Project URL verified; calcweave.com ownership/DNS remains a separate gate.';
await mkdir('docs/evidence', { recursive: true });
const evidenceStage = releaseEvidencePrefix(APP_VERSION, ENGINE_VERSION);
await writeFile(`docs/evidence/${evidenceStage}-deployment-verification.json`, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
if (!report.verifiedApplicationDeployment) process.exitCode = 1;
