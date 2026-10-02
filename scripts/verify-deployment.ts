import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { OfflineManifest } from './offline-build';

// A local/read-only post-publication check. No credentials or model data are sent.
const url = new URL(process.argv[2] ?? 'https://calcweave.com/');
if (url.origin !== 'https://calcweave.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Deployment check only accepts https://calcweave.com/.');
const report: { generatedAt: string; url: string; dns?: { address: string; family: number }[]; checks: Record<string, boolean | string | null>; verifiedPublicLaunch: boolean } = { generatedAt: new Date().toISOString(), url: url.href, checks: {}, verifiedPublicLaunch: false };
const localManifest = JSON.parse(await readFile('dist/offline-manifest.json', 'utf8')) as OfflineManifest;
const localServiceWorker = await readFile('dist/sw.js');
const serviceWorkerExpected = { bytes: localServiceWorker.byteLength, sha256: createHash('sha256').update(localServiceWorker).digest('hex') };
const required = ['dnsResolved', 'https200', 'calcWeaveHtml', 'privacy/', 'terms/', 'cookies/', 'notices/', 'offline-manifest.json', 'sw.js', 'serviceWorkerParity', 'currentRelease', 'releaseParity', 'staticAssetsParity'];

async function responseMatchesBytes(response: Response, expected: { bytes: number; sha256: string }): Promise<boolean> {
  if (response.status !== 200 || !response.body) return false;
  const reader = response.body.getReader(), digest = createHash('sha256'); let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > expected.bytes) { await reader.cancel(); return false; }
    digest.update(chunk.value);
  }
  return bytes === expected.bytes && digest.digest('hex') === expected.sha256;
}
try { report.dns = await lookup(url.hostname, { all: true }); report.checks.dnsResolved = report.dns.length > 0; }
catch (error) { report.checks.dnsResolved = false; report.checks.dnsError = error instanceof Error && 'code' in error ? String(error.code) : 'DNS_UNAVAILABLE'; }
if (report.checks.dnsResolved) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    report.checks.https200 = response.status === 200;
    const source = await response.text();
    report.checks.calcWeaveHtml = source.includes('<title>CalcWeave') && source.includes('Content-Security-Policy');
    for (const header of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'strict-transport-security', 'referrer-policy', 'permissions-policy']) report.checks[header] = response.headers.get(header);
    report.checks.setCookiePresent = response.headers.has('set-cookie');
    for (const path of ['privacy/', 'terms/', 'cookies/', 'notices/', 'offline-manifest.json', 'sw.js']) {
      const resource = await fetch(new URL(path, url), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      report.checks[path] = resource.status === 200;
      if (path === 'offline-manifest.json' && resource.ok) { const manifest = await resource.json() as OfflineManifest; report.checks.currentRelease = manifest.appVersion === localManifest.appVersion && manifest.engineVersion === localManifest.engineVersion; report.checks.releaseParity = JSON.stringify(manifest) === JSON.stringify(localManifest); }
      if (path === 'sw.js') report.checks.serviceWorkerParity = await responseMatchesBytes(resource, serviceWorkerExpected);
    }
    report.checks.staticAssetsParity = true;
    for (const asset of localManifest.assets) {
      const resource = await fetch(new URL(asset.url, url), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!await responseMatchesBytes(resource, asset)) { report.checks.staticAssetsParity = false; break; }
    }
  } catch { report.checks.remoteFetch = 'HTTPS_FETCH_FAILED'; }
}
report.checks.domainOwnership = 'Requires verified GitHub Pages domain TXT and repository settings; DNS alone does not prove ownership.';
report.checks.actualNoviceStudy = 'Requires observed F06 study; automation is not a novice participant.';
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/m6-deployment-verification.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
if (required.some(check => report.checks[check] !== true) || report.checks.remoteFetch) process.exitCode = 1;
