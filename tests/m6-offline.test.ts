import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRegisterOffline, registerOfflineSupport } from '../apps/web/src/offline';
import { createOfflineManifest, generateOfflineWorker, isOfflineAssetUrl, offlineCachePrefixForScope, OFFLINE_CACHE_PREFIX, writeOfflineRelease, type OfflineManifest } from '../scripts/offline-build';
import { getDeploymentBasePath, parseDeploymentBase } from '../scripts/pages-base';
import { calcWeaveSecurityPlugin, STATIC_CSP } from '../scripts/security-build';

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
function workerHarness(manifest: OfflineManifest, sources: Record<string, string>, storage = new MemoryCaches(), options: { registrationScope?: string; clientUrls?: string[]; responseUrl?: string } = {}) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>(), calls = { skipWaiting: 0, claims: 0, fetched: [] as string[], notified: [] as { url: string; message: unknown }[] };
  let bad: string | undefined, network = true;
  const scope = {
    location: { origin, pathname: manifest.scope + 'sw.js' }, registration: { scope: options.registrationScope ?? origin + manifest.scope }, addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => handlers.set(type, handler),
    skipWaiting: async () => { calls.skipWaiting += 1; },
    clients: { claim: async () => { calls.claims += 1; }, matchAll: async () => (options.clientUrls ?? []).map(url => ({ url, postMessage: (message: unknown) => calls.notified.push({ url, message }) })) },
  };
  // This evaluates only the repository's fixed SW generator, never model or user source.
  runInNewContext(generateOfflineWorker(manifest), { self: scope, crypto: webcrypto, caches: storage, URL, Request, Response, Uint8Array, Set, Map, console,
    fetch: async (input: string | Request) => {
      const url = address(input); calls.fetched.push(url);
      if (!network) throw new Error('Offline');
      const path = new URL(url).pathname, body = path === bad ? 'wrong digest' : sources[path.slice(manifest.scope.length)];
      const response = body === undefined ? new Response('Not found', { status: 404 }) : new Response(body);
      if (options.responseUrl) Object.defineProperty(response, 'url', { value: options.responseUrl });
      return response;
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
    async message(data: Record<string, unknown>, external = false, clientPath = manifest.scope): Promise<unknown[]> {
      const replies: unknown[] = [];
      await dispatch('message', { data, source: { type: 'window', id: 'isolated', url: (external ? 'https://outside.test' : origin) + clientPath }, ports: [{ postMessage: (value: unknown) => replies.push(value) }] });
      return replies;
    },
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('M6 final-byte offline releases', () => {
  it.each(['/', '/CalcWeave/'])('uses final written bytes and the %s scope after late bundler replacement', async basePath => {
    const directory = await mkdtemp(join(tmpdir(), 'calcweave-offline-final-')), assetDirectory = join(directory, 'assets');
    try {
      await mkdir(assetDirectory); await writeFile(join(directory, 'index.html'), '<html>final</html>');
      await writeFile(join(assetDirectory, 'main-final.js'), 'final worker URL replacement');
      const manifest = await writeOfflineRelease(directory, ['index.html', 'assets/main-final.js'], versions, basePath);
      expect(manifest.scope).toBe(basePath); expect(manifest.assets.map(asset => asset.url)).toEqual([basePath + 'assets/main-final.js', basePath + 'index.html']);
      const main = manifest.assets.find(asset => asset.url.endsWith('main-final.js'))!;
      expect(main.sha256).toBe(createHash('sha256').update('final worker URL replacement').digest('hex'));
      expect(main.sha256).not.toBe(createHash('sha256').update('earlier unresolved worker URL').digest('hex'));
      expect(JSON.parse(await readFile(join(directory, 'offline-manifest.json'), 'utf8'))).toEqual(manifest);
      expect(await readFile(join(directory, 'sw.js'), 'utf8')).toContain(manifest.releaseId);
    } finally {
      const absoluteDirectory = resolve(directory), temporaryRoot = resolve(tmpdir());
      if (dirname(absoluteDirectory) !== temporaryRoot || !basename(absoluteDirectory).startsWith('calcweave-offline-final-')) throw new Error('Unsafe offline test cleanup directory.');
      for (const name of ['index.html', 'assets/main-final.js', 'offline-manifest.json', 'sw.js']) {
        const target = resolve(directory, name), inside = relative(absoluteDirectory, target);
        if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unsafe offline test cleanup file.');
        await unlink(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      await rmdir(assetDirectory).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); await rmdir(directory);
    }
  });
  it('hashes every shell, CSS, Worker, lazy exporter and policy file independently and deterministically', () => {
    const source = files(), manifest = createOfflineManifest(source, versions);
    expect(manifest.assets).toHaveLength(6);
    for (const asset of manifest.assets) { expect(asset.sha256).toBe(createHash('sha256').update(source[asset.url.slice(1) as keyof typeof source]).digest('hex')); expect(asset.bytes).toBe(Buffer.byteLength(source[asset.url.slice(1) as keyof typeof source])); }
    expect(createOfflineManifest(Object.fromEntries(Object.entries(source).reverse()), versions)).toEqual(manifest);
    expect(createOfflineManifest(source, { engineVersion: versions.engineVersion, appVersion: versions.appVersion })).toEqual(manifest);
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
  it('enables production localhost or HTTPS root/project scope and keeps unsafe environments disabled', () => {
    const base = { production: true, secure: true, protocol: 'https:', hostname: 'calcweave.com', base: '/' };
    expect(canRegisterOffline(base)).toBe(true);
    expect(canRegisterOffline({ ...base, base: '/CalcWeave/' })).toBe(true);
    expect(canRegisterOffline({ ...base, protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
    // vsf-ignore: secure:false is a negative SW registration fixture, not a cookie setting.
    for (const change of [{ production: false }, { secure: false }, { base: '/CalcWeave/../' }, { base: '//external.test/' }, { protocol: 'http:', hostname: 'untrusted.test' }, { protocol: 'file:' }]) expect(canRegisterOffline({ ...base, ...change })).toBe(false);
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

describe('GitHub Pages project-scoped build and offline boundary', () => {
  it('accepts a bounded single project segment and shares the explicit build base with policy generation', () => {
    for (const base of ['/', '/CalcWeave/', '/Project_123-Example/', '/' + 'a'.repeat(64) + '/']) expect(parseDeploymentBase(base)).toBe(base);
    delete process.env.CALCWEAVE_BASE_PATH; expect(getDeploymentBasePath()).toBe('/');
    vi.stubEnv('CALCWEAVE_BASE_PATH', '/CalcWeave/'); expect(getDeploymentBasePath()).toBe('/CalcWeave/');
    const plugin = calcWeaveSecurityPlugin();
    const validate = plugin.configResolved as (config: { base: string }) => void;
    expect(() => validate({ base: '/CalcWeave/' })).not.toThrow();
    expect(() => validate({ base: '//outside.test/' })).toThrow('deployment base');
    const tags = (plugin.transformIndexHtml as { handler: () => { tag: string; attrs: Record<string, string> }[] }).handler();
    expect(tags.find(tag => tag.attrs['http-equiv'] === 'Content-Security-Policy')?.attrs.content).toBe(STATIC_CSP);
    expect(STATIC_CSP).toContain("worker-src 'self'"); expect(STATIC_CSP).not.toContain('frame-ancestors');
  });
  it.each(['', '/CalcWeave', '//outside.test/', 'https://outside.test/', '/Calc/Weave/', '/./', '/../', '/CalcWeave/?secret=1', '/CalcWeave/#fragment', '/Calc%2fWeave/', '/CalcWeave\\/', '/한글/', '/' + 'a'.repeat(65) + '/'])('rejects unsafe or ambiguous base %s before manifest creation', base => {
    expect(() => parseDeploymentBase(base)).toThrow('deployment base');
    expect(() => createOfflineManifest(files(), versions, base)).toThrow('deployment base');
  });
  it('binds every shell/asset URL and the release identity to the deployment base', () => {
    const source = files(), root = createOfflineManifest(source, versions), project = createOfflineManifest(source, versions, '/CalcWeave/');
    expect(project.scope).toBe('/CalcWeave/'); expect(project.releaseId).not.toBe(root.releaseId);
    expect(project.assets.map(asset => asset.url)).toEqual(root.assets.map(asset => '/CalcWeave' + asset.url));
    for (const asset of project.assets) expect(isOfflineAssetUrl(asset.url, project.scope)).toBe(true);
    for (const url of ['/index.html', '/assets/main-a.js', '/Other/assets/main-a.js', 'https://outside.test/CalcWeave/assets/main-a.js', '/CalcWeave/../assets/main-a.js', '/CalcWeave/assets/main-a.js?model=x', '/CalcWeave/assets/main-a.js#x', '/CalcWeave/%2e%2e/assets/main-a.js']) expect(isOfflineAssetUrl(url, project.scope)).toBe(false);
    for (const url of ['/index.html', '/Other/assets/main-a.js', 'https://outside.test/CalcWeave/assets/main-a.js']) expect(() => generateOfflineWorker({ ...project, assets: [{ ...project.assets[0]!, url }, ...project.assets.slice(1)] })).toThrow('manifest');
    expect(() => generateOfflineWorker({ ...project, releaseId: '0'.repeat(64) })).toThrow('hash mismatch');
  });
  it('actually installs and serves the project shell, policies and marker offline without handling root/foreign requests', async () => {
    const source = { ...files(), 'terms/index.html': 'Terms', 'cookies/index.html': 'Cookies', 'notices/index.html': 'Notices' };
    const base = '/CalcWeave/', manifest = createOfflineManifest(source, versions, base), sw = workerHarness(manifest, source);
    await sw.dispatch('install'); await sw.dispatch('activate'); sw.offline();
    expect(sw.calls.claims).toBe(1); expect(sw.calls.fetched).toEqual(manifest.assets.map(asset => origin + asset.url));
    const cache = await sw.storage.open(offlineCachePrefixForScope(base) + manifest.releaseId);
    expect([...cache.entries.keys()].every(url => url.startsWith(origin + base))).toBe(true);
    expect(await (await sw.request(base, { mode: 'navigate' }))!.text()).toBe(source['index.html']);
    for (const policy of ['terms', 'privacy', 'cookies', 'notices']) expect(await (await sw.request(base + policy + '/', { mode: 'navigate' }))!.text()).toBe(source[(policy + '/index.html') as keyof typeof source]);
    expect(await (await sw.request(base + 'assets/engine.worker-a.js'))!.text()).toBe('worker');
    expect(await (await sw.request(base + 'offline-manifest.json'))!.json()).toEqual(manifest);
    const installedCalls = sw.calls.fetched.length;
    for (const path of ['/', '/index.html', '/privacy/', '/offline-manifest.json', '/assets/main-a.js', '/Other/assets/main-a.js', '/CalcWeaveOther/assets/main-a.js', base + '../assets/main-a.js', base + '%2e%2e/assets/main-a.js', base + 'assets/main-a.js?model=private', base + 'assets/main-a.js#fragment']) expect(await sw.request(path, { mode: 'navigate' })).toBeUndefined();
    expect(await sw.request(base + 'assets/main-a.js', { external: true })).toBeUndefined();
    expect(sw.calls.fetched).toHaveLength(installedCalls);
    await expect(sw.request(base + 'assets/unlisted.js')).rejects.toThrow('Offline');
    expect(cache.entries.size).toBe(manifest.assets.length + 1);
  });
  it('keeps same-origin root/project caches separate and accepts activation only from project clients', async () => {
    const rootSource = { ...files(), 'assets/root-only.js': 'root-only' }, rootManifest = createOfflineManifest(rootSource, versions), root = workerHarness(rootManifest, rootSource); await root.dispatch('install');
    const source = files(), manifest = createOfflineManifest(source, versions, '/CalcWeave/'), project = workerHarness(manifest, source, root.storage); await project.dispatch('install'); project.offline();
    expect(await project.storage.keys()).toEqual([OFFLINE_CACHE_PREFIX + rootManifest.releaseId, offlineCachePrefixForScope(manifest.scope) + manifest.releaseId]);
    for (const path of ['/', '/Other/', '/CalcWeaveOther/', '/CalcWeave/../Other/']) {
      expect(await project.message({ type: 'GET_RELEASE' }, false, path)).toEqual([]);
      expect(await project.message({ type: 'ACTIVATE_RELEASE', releaseId: manifest.releaseId }, false, path)).toEqual([]);
    }
    expect(project.calls.skipWaiting).toBe(0);
    expect(await project.message({ type: 'GET_RELEASE' })).toEqual([{ type: 'OFFLINE_RELEASE', manifest }]);
    await project.message({ type: 'ACTIVATE_RELEASE', releaseId: manifest.releaseId }); expect(project.calls.skipWaiting).toBe(1);
    expect(await project.request('/assets/root-only.js')).toBeUndefined();
    await expect(project.request('/CalcWeave/assets/root-only.js')).rejects.toThrow('Offline');
  });
  it('rejects a worker registered outside its build scope before cache creation or claim', async () => {
    const manifest = createOfflineManifest(files(), versions, '/CalcWeave/'), sw = workerHarness(manifest, files(), undefined, { registrationScope: origin + '/' });
    await expect(sw.dispatch('install')).rejects.toThrow('scope mismatch'); expect(await sw.storage.keys()).toEqual([]);
    await expect(sw.dispatch('activate')).rejects.toThrow('scope mismatch'); expect(sw.calls.claims).toBe(0);
  });
  it('rejects off-origin response URLs and limits failed-install notifications to matching project clients', async () => {
    const base = '/CalcWeave/', manifest = createOfflineManifest(files(), versions, base);
    const sw = workerHarness(manifest, files(), undefined, { responseUrl: 'https://outside.test/CalcWeave/assets/main-a.js', clientUrls: [origin + base, origin + '/Other/', 'https://outside.test' + base] });
    await expect(sw.dispatch('install')).rejects.toThrow('response URL rejected'); expect(await sw.storage.keys()).toEqual([]);
    expect(sw.calls.notified.map(notification => notification.url)).toEqual([origin + base]);
  });
  it('refuses readiness for a project cache whose marker has a different deployment scope', async () => {
    const source = files(), project = createOfflineManifest(source, versions, '/CalcWeave/'), sw = workerHarness(project, source); await sw.dispatch('install');
    const cache = await sw.storage.open(offlineCachePrefixForScope(project.scope) + project.releaseId);
    await cache.put(origin + project.scope + 'offline-manifest.json', new Response(JSON.stringify(createOfflineManifest(source, versions))));
    expect(await sw.message({ type: 'GET_RELEASE' })).toEqual([{ type: 'OFFLINE_UNAVAILABLE' }]);
    expect((await sw.request(project.scope + 'offline-manifest.json'))!.status).toBe(503);
    await expect(sw.message({ type: 'ACTIVATE_RELEASE', releaseId: project.releaseId })).rejects.toThrow('Incomplete offline release'); expect(sw.calls.skipWaiting).toBe(0);
  });
  it('retains previous project lazy chunks while the active shell stays in the latest complete project release', async () => {
    const base = '/CalcWeave/', source = files(), manifest = createOfflineManifest(source, versions, base), first = workerHarness(manifest, source); await first.dispatch('install');
    const nextSource = { ...files(), 'index.html': 'new project shell', 'assets/export-b.js': 'new project exporter' }; delete (nextSource as Record<string, string>)['assets/export-a.js'];
    const nextManifest = createOfflineManifest(nextSource, { ...versions, appVersion: '0.6.1' }, base), next = workerHarness(nextManifest, nextSource, first.storage); await next.dispatch('install'); await next.dispatch('activate'); next.offline();
    expect(await (await next.request(base + 'assets/export-a.js'))!.text()).toBe('lazy exporter');
    expect(await (await next.request(base + 'assets/export-b.js'))!.text()).toBe('new project exporter');
    expect(await (await next.request(base, { mode: 'navigate' }))!.text()).toBe('new project shell');
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
