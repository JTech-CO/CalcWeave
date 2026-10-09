import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOfflineManifest, generateOfflineWorker } from '../scripts/offline-build';
import { approvedPublicURL, checkPublishedArtifact, readPublishedArtifact } from '../scripts/published-release';
import { readSourceCommit, sourceCommitFromEnvironment } from '../scripts/release-provenance';
import { APP_VERSION } from '../packages/release/src';
import { ENGINE_VERSION } from '../packages/model/src';

const commit = 'a'.repeat(40), url = 'https://jtech-co.github.io/CalcWeave/';
const html = `<html><head><meta name="calcweave-source-commit" content="${commit}"></head><body></body></html>`;

describe('Trusted build identity', () => {
  it('allows portable local builds and binds CI to its exact checkout', () => {
    expect(sourceCommitFromEnvironment({})).toBeUndefined();
    expect(sourceCommitFromEnvironment({ CALCWEAVE_SOURCE_COMMIT: commit })).toBe(commit);
    expect(sourceCommitFromEnvironment({ GITHUB_ACTIONS: 'true', GITHUB_SHA: commit })).toBe(commit);
    expect(() => sourceCommitFromEnvironment({ GITHUB_ACTIONS: 'true' })).toThrow();
    expect(() => sourceCommitFromEnvironment({ GITHUB_ACTIONS: 'true', GITHUB_SHA: commit, CALCWEAVE_SOURCE_COMMIT: 'b'.repeat(40) })).toThrow();
  });
  it.each(['', '../main', '<script>', 'A'.repeat(40), 'a'.repeat(39), commit + '\n'])('rejects unsafe identity %s', value => {
    expect(() => sourceCommitFromEnvironment({ CALCWEAVE_SOURCE_COMMIT: value })).toThrow();
  });
  it('requires a single valid identity in the HTML head', () => {
    expect(readSourceCommit(html, true)).toBe(commit);
    expect(readSourceCommit('<head></head>')).toBeUndefined();
    expect(() => readSourceCommit('<head></head>', true)).toThrow();
    expect(() => readSourceCommit(html.replace('</head>', `<meta name="calcweave-source-commit" content="${commit}"></head>`), true)).toThrow();
    expect(() => readSourceCommit(html.replace(commit, 'invalid'), true)).toThrow();
  });
});

describe('Exact public artifact verification', () => {
  it.each(['http://jtech-co.github.io/CalcWeave/', 'https://external.test/CalcWeave/', 'https://jtech-co.github.io/other/', url + '?a=1', url + '#hash', 'https://user@jtech-co.github.io/CalcWeave/'])('rejects unapproved network destination %s', value => {
    expect(() => approvedPublicURL(value)).toThrow();
  });
  it('compares shell aliases, manifest, SW and every immutable asset; rejects stale and oversized responses', async () => {
    await mkdir('.test-generated', { recursive: true });
    const directory = await mkdtemp(join('.test-generated', 'published-test-'));
    try {
      await mkdir(join(directory, 'assets'));
      const files = { 'index.html': html, 'assets/app.js': 'console.log("release")' };
      const manifest = createOfflineManifest(files, { appVersion: APP_VERSION, engineVersion: ENGINE_VERSION }, '/CalcWeave/');
      for (const [name, source] of Object.entries(files)) await writeFile(join(directory, name), source);
      await writeFile(join(directory, 'offline-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      await writeFile(join(directory, 'sw.js'), generateOfflineWorker(manifest));
      const artifact = await readPublishedArtifact(url, directory, commit), requests: URL[] = [];
      const fake: typeof fetch = async (input, init) => {
        const requested = new URL(String(input)); requests.push(requested);
        expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error'); expect(init?.cache).toBe('no-store');
        expect(requested.origin).toBe('https://jtech-co.github.io'); expect(requested.searchParams.get('calcweave-release')).toBe(commit);
        const name = requested.pathname.slice('/CalcWeave/'.length) || 'index.html';
        return new Response(Uint8Array.from(artifact.files.get(name)!), { status: 200 });
      };
      expect(await checkPublishedArtifact(artifact, fake)).toEqual({ passed: true, checkedFiles: 5 });
      expect(requests.map(item => item.pathname)).toContain('/CalcWeave/');
      const stale: typeof fetch = async () => new Response('previous release', { status: 200 });
      expect((await checkPublishedArtifact(artifact, stale)).passed).toBe(false);
      const oversized: typeof fetch = async () => new Response('x'.repeat(128 * 1024 + 1), { status: 200 });
      expect((await checkPublishedArtifact(artifact, oversized)).passed).toBe(false);
      const offline: typeof fetch = async () => { throw new Error('network'); };
      expect((await checkPublishedArtifact(artifact, offline)).passed).toBe(false);
      expect((await checkPublishedArtifact(artifact, fake, Date.now() - 1)).mismatch).toBe('verification-deadline');
      await expect(readPublishedArtifact(url, directory, 'b'.repeat(40))).rejects.toThrow('source commit');
      await writeFile(join(directory, 'assets/app.js'), 'changed');
      await expect(readPublishedArtifact(url, directory, commit)).rejects.toThrow('bytes differ');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
