import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRegisterOffline, registerOfflineSupport } from '../apps/web/src/offline';
import { createOfflineManifest, generateOfflineWorker, OFFLINE_CACHE_PREFIX, writeOfflineRelease, type OfflineManifest } from '../scripts/offline-build';

const origin = 'https://calcweave.test';
const versions = { appVersion: '0.6.0', engineVersion: '0.6.0-m6' };
const files = () => ({ 'index.html': '<html>CalcWeave</html>', 'assets/main-a.js': 'main', 'assets/engine.worker-a.js': 'worker', 'assets/export-a.js': 'lazy exporter', 'assets/style-a.css': 'body{}', 'privacy/index.html': '<html>Privacy</html>' });
const address = (input: string | Request): string => typeof input === 'string' ? input : input.url;
class MemoryCache {
  entries = new Map<string, Response>();
  async match(input: string | Request): Promise<Response | undefined> { return this.entries.get(address(input))?.clone(); }
  async put(input: string | Request, response: Response): Promise<void> { this.entries.set(address(input), response.clone()); }
}
class MemoryCaches {
  entries = new Map<string, MemoryCache>();
  async has(name: string): Promise<boolean> { return this.entries.has(name); }
  async open(name: string): Promise<MemoryCache> { let cache = this.entries.get(name); if (!cache) { cache = new MemoryCache(); this.entries.set(name, cache); } return cache; }
  async keys(): Promise<string[]> { return [...this.entries.keys()]; }
  async delete(name: string): Promise<boolean> { return this.entries.delete(name); }
}
function workerHarness(manifest: OfflineManifest, sources: Record<string, string>, storage = new MemoryCaches()) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>(), calls = { skipWaiting: 0, claims: 0, fetched: [] as string[] };
  let bad: string | undefined, network = true;
  const scope = {
    location: { origin }, addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => handlers.set(type, handler),
    skipWaiting: async () => { calls.skipWaiting += 1; },
    clients: { claim: async () => { calls.claims += 1; }, matchAll: async () => [] },
  };
  // This evaluates only the repository's fixed SW generator, never model or user source.
  runInNewContext(generateOfflineWorker(manifest), { self: scope, crypto: webcrypto, caches: storage, URL, Request, Response, Uint8Array, Set, Map, console,
    fetch: async (input: string | Request) => {
      const url = address(input); calls.fetched.push(url);
      if (!network) throw new Error('Offline');
      const path = new URL(url).pathname, body = path === bad ? 'wrong digest' : sources[path.slice(1)];
      return body === undefined ? new Response('Not found', { status: 404 }) : new Response(body);
    },
  });
  async function dispatch(type: string, event: Record<string, unknown> = {}): Promise<void> {
    const waiting: Promise<unknown>[] = [];
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => waiting.push(promise) });
    await Promise.all(waiting);
  }
  return { storage, calls, dispatch, corrupt: (path: string) => { bad = path; }, offline: () => { network = false; },
    async request(path: string, extra: { method?: string; mode?: string; range?: string; external?: boolean } = {}): Promise<Response | undefined> {
      let response: Promise<Response> | undefined;
      const headers = new Headers(); if (extra.range) headers.set('range', extra.range);
      handlers.get('fetch')!({ request: { url: (extra.external ? 'https://outside.test' : origin) + path, method: extra.method ?? 'GET', mode: extra.mode ?? 'cors', headers }, respondWith: (value: Promise<Response>) => { response = value; } });
      return response;
    },
    async message(data: Record<string, unknown>, external = false): Promise<unknown[]> {
      const replies: unknown[] = [];
      await dispatch('message', { data, source: { type: 'window', id: 'isolated', url: (external ? 'https://outside.test' : origin) + '/' }, ports: [{ postMessage: (value: unknown) => replies.push(value) }] });
      return replies;
    },
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('M6 final-byte offline releases', () => {
  it('uses final written bytes after late bundler replacement instead of an earlier chunk snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'calcweave-offline-final-')), assetDirectory = join(directory, 'assets');
    try {
      await mkdir(assetDirectory); await writeFile(join(directory, 'index.html'), '<html>final</html>');
      await writeFile(join(assetDirectory, 'main-final.js'), 'final worker URL replacement');
      const manifest = await writeOfflineRelease(directory, ['index.html', 'assets/main-final.js'], versions);
      const main = manifest.assets.find(asset => asset.url.endsWith('main-final.js'))!;
      expect(main.sha256).toBe(createHash('sha256').update('final worker URL replacement').digest('hex'));
      expect(main.sha256).not.toBe(createHash('sha256').update('earlier unresolved worker URL').digest('hex'));
      expect(JSON.parse(await readFile(join(directory, 'offline-manifest.json'), 'utf8'))).toEqual(manifest);
      expect(await readFile(join(directory, 'sw.js'), 'utf8')).toContain(manifest.releaseId);
    } finally {
      for (const name of ['index.html', 'assets/main-final.js', 'offline-manifest.json', 'sw.js']) await unlink(join(directory, name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      await rmdir(assetDirectory).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); await rmdir(directory);
    }
  });
  it('hashes every shell, CSS, Worker, lazy exporter and policy file independently and deterministically', () => {
    const source = files(), manifest = createOfflineManifest(source, versions);
    expect(manifest.assets).toHaveLength(6);
    for (const asset of manifest.assets) { expect(asset.sha256).toBe(createHash('sha256').update(source[asset.url.slice(1) as keyof typeof source]).digest('hex')); expect(asset.bytes).toBe(Buffer.byteLength(source[asset.url.slice(1) as keyof typeof source])); }
    expect(createOfflineManifest(Object.fromEntries(Object.entries(source).reverse()), versions)).toEqual(manifest);
    expect(createOfflineManifest({ ...source, 'assets/export-a.js': 'changed lazy exporter' }, versions).releaseId).not.toBe(manifest.releaseId);
    expect(createOfflineManifest(source, { ...versions, engineVersion: '0.6.1-m6' }).releaseId).not.toBe(manifest.releaseId);
  });
  it.each(['model.cw.json', 'user-data.csv', 'assets/a.js?model=secret', '../index.html', 'assets/../../a.js', 'https://external.test/a.js', 'other/index.html'])('rejects a nonstatic build entry %s', name => {
    expect(() => createOfflineManifest({ ...files(), [name]: 'private data' }, versions)).toThrow('Unsupported offline build asset');
  });
  it('requires a shell, bounded release assets and validated versions', () => {
    expect(() => createOfflineManifest({ 'assets/main.js': 'main' }, versions)).toThrow('missing');
    expect(() => createOfflineManifest(files(), { ...versions, appVersion: 'anything' })).toThrow('versions');
    expect(() => createOfflineManifest({ ...files(), ...Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`assets/a${i}.js`, 'x'])) }, versions)).toThrow('bounded');
  });
  it('enables production localhost or HTTPS root and keeps development/subpath/insecure hosts disabled', () => {
    const base = { production: true, secure: true, protocol: 'https:', hostname: 'calcweave.com', base: '/' };
    expect(canRegisterOffline(base)).toBe(true);
    expect(canRegisterOffline({ ...base, protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
    // vsf-ignore: secure:false is a negative SW registration fixture, not a cookie setting.
    for (const change of [{ production: false }, { secure: false }, { base: '/CalcWeave/' }, { protocol: 'http:', hostname: 'untrusted.test' }, { protocol: 'file:' }]) expect(canRegisterOffline({ ...base, ...change })).toBe(false);
  });
});

describe('M6 atomic verified SW installation and static request boundary', () => {
  it('installs a complete allowlist with a final marker and never activates a waiting update automatically', async () => {
    const source = files(), manifest = createOfflineManifest(source, versions), sw = workerHarness(manifest, source);
    await sw.dispatch('install'); expect(sw.calls.skipWaiting).toBe(0);
    const cache = await sw.storage.open(OFFLINE_CACHE_PREFIX + manifest.releaseId);
    expect(cache.entries.size).toBe(manifest.assets.length + 1);
    expect(await sw.message({ type: 'GET_RELEASE' })).toEqual([{ type: 'OFFLINE_RELEASE', manifest }]);
    await sw.message({ type: 'ACTIVATE_RELEASE', releaseId: 'wrong' }); await sw.message({ type: 'ACTIVATE_RELEASE', releaseId: manifest.releaseId }, true);
    expect(sw.calls.skipWaiting).toBe(0);
    expect(await sw.message({ type: 'ACTIVATE_RELEASE', releaseId: manifest.releaseId })).toEqual([{ type: 'OFFLINE_ACTIVATING', releaseId: manifest.releaseId }]); expect(sw.calls.skipWaiting).toBe(1);
    await sw.dispatch('activate'); expect(sw.calls.claims).toBe(1);
  });
  it('rejects altered/missing asset bytes, removes only the new incomplete release and keeps the prior release intact', async () => {
    const oldSource = files(), oldManifest = createOfflineManifest(oldSource, versions), oldSW = workerHarness(oldManifest, oldSource);
    await oldSW.dispatch('install'); const oldCache = await oldSW.storage.open(OFFLINE_CACHE_PREFIX + oldManifest.releaseId), snapshot = [...oldCache.entries.keys()];
    const source = { ...files(), 'assets/main-b.js': 'new release' }, manifest = createOfflineManifest(source, { ...versions, appVersion: '0.6.1' });
    const next = workerHarness(manifest, source, oldSW.storage); next.corrupt('/assets/export-a.js');
    await expect(next.dispatch('install')).rejects.toThrow('digest');
    expect(await next.storage.keys()).toEqual([OFFLINE_CACHE_PREFIX + oldManifest.releaseId]); expect([...oldCache.entries.keys()]).toEqual(snapshot);
    oldSW.offline(); expect(await (await oldSW.request('/', { mode: 'navigate' }))!.text()).toBe(oldSource['index.html']);
    // A repeated SW script using the same release cannot destroy an existing active cache.
    const same = workerHarness(oldManifest, oldSource, oldSW.storage); await same.dispatch('install'); expect(await same.storage.keys()).toHaveLength(1);
  });
  it('serves only exact static GET URLs and scoped shell/policy navigation while offline', async () => {
    const source = files(), manifest = createOfflineManifest(source, versions), sw = workerHarness(manifest, source); await sw.dispatch('install'); sw.offline();
    expect(await (await sw.request('/', { mode: 'navigate' }))!.text()).toBe(source['index.html']);
    expect(await (await sw.request('/privacy/', { mode: 'navigate' }))!.text()).toBe(source['privacy/index.html']);
    expect(await (await sw.request('/assets/engine.worker-a.js'))!.text()).toBe('worker');
    const installedCalls = sw.calls.fetched.length;
    for (const [path, extra] of [['/assets/main-a.js?model=secret', {}], ['/model.cw.json', {}], ['/assets/main-a.js', { method: 'POST' }], ['/assets/main-a.js', { external: true }], ['/assets/main-a.js', { range: 'bytes=0-10' }], ['/private/', { mode: 'navigate' }]] as const) expect(await sw.request(path, extra)).toBeUndefined();
    expect(sw.calls.fetched).toHaveLength(installedCalls);
    await expect(sw.request('/assets/unlisted.js')).rejects.toThrow('Offline');
    expect((await sw.storage.open(OFFLINE_CACHE_PREFIX + manifest.releaseId)).entries.size).toBe(manifest.assets.length + 1);
  });
  it('retains old tabs immutable lazy chunks after explicit activation of a newer complete release', async () => {
    const source = files(), manifest = createOfflineManifest(source, versions), first = workerHarness(manifest, source); await first.dispatch('install');
    const nextSource = { ...files(), 'index.html': 'new shell', 'assets/export-b.js': 'new exporter' }; delete (nextSource as Record<string, string>)['assets/export-a.js'];
    const nextManifest = createOfflineManifest(nextSource, { ...versions, appVersion: '0.6.1' }), next = workerHarness(nextManifest, nextSource, first.storage);
    await next.dispatch('install'); await next.dispatch('activate'); next.offline();
    expect(await next.storage.keys()).toHaveLength(2);
    expect(await (await next.request('/assets/export-a.js'))!.text()).toBe('lazy exporter');
    expect(await (await next.request('/assets/export-b.js'))!.text()).toBe('new exporter');
    expect(await (await next.request('/', { mode: 'navigate' }))!.text()).toBe('new shell');
  });
  it('reports unavailable rather than claiming readiness for corrupted/evicted cached bytes', async () => {
    const source = files(), manifest = createOfflineManifest(source, versions), sw = workerHarness(manifest, source); await sw.dispatch('install');
    const cache = await sw.storage.open(OFFLINE_CACHE_PREFIX + manifest.releaseId); await cache.put(origin + '/assets/main-a.js', new Response('tampered'));
    expect(await sw.message({ type: 'GET_RELEASE' })).toEqual([{ type: 'OFFLINE_UNAVAILABLE' }]);
    expect((await sw.request('/assets/main-a.js'))!.status).toBe(503);
    await expect(sw.message({ type: 'ACTIVATE_RELEASE', releaseId: manifest.releaseId })).rejects.toThrow('digest'); expect(sw.calls.skipWaiting).toBe(0);
  });
});

describe('M6 explicit saved update client policy', () => {
  it('awaits successful save before activation and leaves waiting release untouched when save rejects', async () => {
    vi.stubEnv('PROD', true); vi.stubEnv('BASE_URL', '/');
    const listeners = new Map<string, () => void>(), sent: string[] = [], reload = vi.fn();
    const release = { releaseId: 'a'.repeat(64), appVersion: '0.6.0', engineVersion: '0.6.0-m6' };
    const worker = { postMessage(data: { type: string }, ports: MessagePort[]) {
      sent.push(data.type); ports[0]!.postMessage(data.type === 'GET_RELEASE' ? { type: 'OFFLINE_RELEASE', manifest: release } : { type: 'OFFLINE_ACTIVATING' });
    } };
    const registration = { active: worker, waiting: worker, installing: null, update: vi.fn(async () => {}), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const serviceWorker = { register: vi.fn(async () => registration), addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: vi.fn() };
    vi.stubGlobal('navigator', { onLine: true, serviceWorker });
    vi.stubGlobal('window', { isSecureContext: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'calcweave.test', reload });
    const controller = await registerOfflineSupport(); expect(controller.getStatus()).toMatchObject({ phase: 'update-ready', offlineReady: true });
    await expect(controller.applyUpdate(async () => { throw new Error('Save failed'); })).rejects.toThrow('Save failed'); expect(sent).not.toContain('ACTIVATE_RELEASE');
    let saved = false;
    await controller.applyUpdate(async () => { await Promise.resolve(); saved = true; }); expect(saved).toBe(true); expect(sent.at(-1)).toBe('ACTIVATE_RELEASE');
    listeners.get('controllerchange')!(); expect(reload).toHaveBeenCalledTimes(1); controller.dispose();
  });
});
