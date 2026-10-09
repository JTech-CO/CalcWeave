import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { APP_VERSION } from '../packages/release/src';
import { ENGINE_VERSION } from '../packages/model/src';
import { isOfflineAssetUrl, type OfflineManifest } from './offline-build';
import { readSourceCommit } from './release-provenance';

const MAX_RELEASE_BYTES = 32 * 1024 * 1024;
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const within = (root: string, path: string) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel); };

export function approvedPublicURL(value: string): URL {
  const url = new URL(value);
  assert(((url.origin === 'https://jtech-co.github.io' && url.pathname === '/CalcWeave/')
    || (url.origin === 'https://calcweave.com' && url.pathname === '/'))
    && !url.search && !url.hash && !url.username && !url.password, 'Unapproved public release URL');
  return url;
}

export interface PublishedArtifact {
  url: URL; commit: string; manifest: OfflineManifest;
  files: ReadonlyMap<string, Buffer>;
}

/** Read the uploaded artifact itself; rebuilding it on another OS is not evidence. */
export async function readPublishedArtifact(urlValue: string, directory: string, commit: string): Promise<PublishedArtifact> {
  const url = approvedPublicURL(urlValue);
  assert(/^[a-f0-9]{40}$/.test(commit), 'Invalid expected source commit');
  const root = await realpath(resolve('.')), artifact = await realpath(resolve(directory));
  assert(within(root, artifact) && artifact !== root, 'Artifact must be a directory inside the workspace');
  const read = async (name: string, maximum: number) => {
    const path = await realpath(join(artifact, name));
    assert(within(artifact, path) && path !== artifact, 'Artifact file escapes its directory');
    const info = await stat(path); assert(info.isFile() && info.size <= maximum, 'Artifact file exceeds its byte limit');
    return readFile(path);
  };
  const manifestBytes = await read('offline-manifest.json', 128 * 1024);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as OfflineManifest;
  assert(manifest.schemaVersion === 1 && manifest.appVersion === APP_VERSION && manifest.engineVersion === ENGINE_VERSION && manifest.scope === url.pathname, 'Artifact does not identify the current application and deployment path');
  assert(Array.isArray(manifest.assets) && manifest.assets.length > 0 && manifest.assets.length <= 128, 'Invalid artifact asset count');
  assert(manifest.assets.every(asset => asset && isOfflineAssetUrl(asset.url, manifest.scope) && /^[a-f0-9]{64}$/.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes >= 0 && asset.bytes <= MAX_RELEASE_BYTES), 'Invalid artifact asset');
  assert(new Set(manifest.assets.map(asset => asset.url)).size === manifest.assets.length && manifest.assets.some(asset => asset.url === manifest.scope + 'index.html'), 'Duplicate assets or missing shell');
  assert(manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0) <= MAX_RELEASE_BYTES, 'Artifact exceeds release byte limit');
  const { releaseId, ...meaning } = manifest;
  assert(/^[a-f0-9]{64}$/.test(releaseId) && hash(JSON.stringify(meaning)) === releaseId, 'Artifact manifest identity mismatch');
  const files = new Map<string, Buffer>([['offline-manifest.json', manifestBytes], ['sw.js', await read('sw.js', 128 * 1024)]]);
  for (const asset of manifest.assets) {
    const name = asset.url.slice(manifest.scope.length), bytes = await read(name, asset.bytes);
    assert(bytes.length === asset.bytes && hash(bytes) === asset.sha256, 'Artifact bytes differ from its manifest'); files.set(name, bytes);
  }
  assert(readSourceCommit(files.get('index.html')!.toString('utf8'), true) === commit, 'Artifact source commit differs from the verified checkout');
  return { url, commit, manifest, files };
}

async function matchesResponse(response: Response, expected: Buffer): Promise<boolean> {
  if (response.status !== 200 || response.redirected || !response.body) { if (response.body) await response.body.cancel(); return false; }
  const reader = response.body.getReader(), digest = createHash('sha256'); let bytes = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > expected.length) { await reader.cancel(); return false; } digest.update(chunk.value); }
    return bytes === expected.length && digest.digest('hex') === hash(expected);
  } finally { reader.releaseLock(); }
}

export interface PublishedCheck { passed: boolean; checkedFiles: number; mismatch?: string }

/** All network destinations derive from the fixed approved origin and allowlist. */
export async function checkPublishedArtifact(artifact: PublishedArtifact, fetcher: typeof fetch = fetch, deadline = Date.now() + 60_000): Promise<PublishedCheck> {
  let checkedFiles = 0;
  const resources = new Map(artifact.files); resources.set('', artifact.files.get('index.html')!);
  for (const [name, bytes] of resources) {
    if (Date.now() >= deadline) return { passed: false, checkedFiles, mismatch: 'verification-deadline' };
    const url = new URL(name, artifact.url);
    url.searchParams.set('calcweave-release', artifact.commit);
    try {
      const response = await fetcher(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))) });
      if (!await matchesResponse(response, bytes)) return { passed: false, checkedFiles, mismatch: name || '/' };
    } catch { return { passed: false, checkedFiles, mismatch: name || '/' }; }
    checkedFiles++;
  }
  return { passed: true, checkedFiles };
}
