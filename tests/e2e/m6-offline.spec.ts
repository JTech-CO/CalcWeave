import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { createExample } from '../../apps/web/src/examples';
import type { CalcModel } from '../../packages/model/src';
import { ENGINE_VERSION } from '../../packages/model/src';
import { APP_VERSION } from '../../packages/release/src';
import { createOfflineManifest, generateOfflineWorker, OFFLINE_CACHE_PREFIX, type OfflineManifest } from '../../scripts/offline-build';

test.use({ serviceWorkers: 'allow' });

async function waitForControlled(page: Page) {
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}
async function currentModel(page: Page): Promise<CalcModel> {
  return page.evaluate(() => new Promise<CalcModel>((resolve, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onsuccess = () => { const db = opening.result, tx = db.transaction('models', 'readonly'), read = tx.objectStore('models').get('current'); read.onsuccess = () => resolve(read.result as CalcModel); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('Read failed')); };
    opening.onerror = () => reject(new Error('Open failed'));
  }));
}
function unzip(bytes: Buffer): Record<string, string> {
  const files: Record<string, string> = {}; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8'), start = offset + 30 + nameSize + extra;
    files[name] = bytes.subarray(start, start + size).toString('utf8'); offset = start + size;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50); return files;
}

test('M6 first complete online install reopens the original IndexedDB model, runs its Worker and lazily exports TS ZIP offline', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await waitForControlled(page);
  const manifest = await page.evaluate(async () => await (await fetch('/offline-manifest.json')).json()) as OfflineManifest;
  expect(manifest.appVersion).toBe(APP_VERSION); expect(manifest.engineVersion).toBe(ENGINE_VERSION);
  expect(manifest.assets.some(asset => asset.url.includes('engine.worker') && asset.url.endsWith('.js'))).toBe(true);
  expect(manifest.assets.filter(asset => asset.url.endsWith('.js')).length).toBeGreaterThanOrEqual(3);
  const cached = await page.evaluate(async cacheName => (await (await caches.open(cacheName)).keys()).map(request => new URL(request.url).pathname), OFFLINE_CACHE_PREFIX + manifest.releaseId);
  expect(cached.sort()).toEqual([...manifest.assets.map(asset => asset.url), '/offline-manifest.json'].sort());
  const model = createExample('matrix-solve-lu'); model.name = '오프라인 원본 선형 방정식';
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'offline.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('.statusbar')).toContainText(`${model.name} 모델을 불러왔습니다.`);
  await expect.poll(async () => (await currentModel(page)).name).toBe(model.name);
  const stored = await currentModel(page);
  // Neither Worker execution nor the lazy export action has been requested online.
  await context.setOffline(true); await page.reload(); await expect(page.locator('.model-node-list')).toContainText('행 피벗 LU');
  expect(await currentModel(page)).toEqual(stored);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '실행 묶음', exact: true }).click();
  const archive = unzip(await readFile((await (await downloading).path())!));
  expect(JSON.parse(archive['model.cw.json']!).name).toBe(model.name);
  expect(JSON.parse(archive['manifest.json']!).engineVersion).toBe(ENGINE_VERSION);
  const outputs = JSON.parse(archive['expected-output.json']!).samples[0].values;
  expect(outputs.solution[0][0]).toBeCloseTo(1, 12); expect(outputs.solution[1][0]).toBeCloseTo(2, 12);
  expect(archive['model.ts']).toContain('matrix.lu'); expect(errors).toEqual([]);
  const cacheURLs = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat());
  expect(cacheURLs.every(url => url === '/offline-manifest.json' || manifest.assets.some(asset => asset.url === url))).toBe(true);
  await context.setOffline(false);
});

async function testReleaseServer() {
  const initial = { 'index.html': '<!doctype html><title>old release</title><div id="version">old</div><script src="/assets/main-old.js"></script>', 'assets/main-old.js': 'globalThis.loadedRelease="old";', 'assets/lazy-old.js': 'globalThis.lazyRelease="old";', 'assets/engine.worker-old.js': 'self.onmessage=()=>self.postMessage("old");', 'assets/style-old.css': 'body{color:black}' };
  const updated = { 'index.html': '<!doctype html><title>new release</title><div id="version">new</div><script src="/assets/main-new.js"></script>', 'assets/main-new.js': 'globalThis.loadedRelease="new";', 'assets/lazy-new.js': 'globalThis.lazyRelease="new";', 'assets/engine.worker-new.js': 'self.onmessage=()=>self.postMessage("new");', 'assets/style-new.css': 'body{color:gray}' };
  const oldManifest = createOfflineManifest(initial, { appVersion: '0.6.0', engineVersion: '0.6.0-m6' }), nextManifest = createOfflineManifest(updated, { appVersion: '0.6.1', engineVersion: '0.6.1-m6' });
  let newer = false, broken = false;
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname, source = newer ? updated : initial, manifest = newer ? nextManifest : oldManifest;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Service-Worker-Allowed', '/');
    if (path === '/sw.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(generateOfflineWorker(manifest)); return; }
    if (path === '/offline-manifest.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(manifest)); return; }
    if (broken && newer && path === '/assets/lazy-new.js') { response.statusCode = 503; response.end('Incomplete release'); return; }
    const body = (source as Record<string, string>)[path === '/' ? 'index.html' : path.slice(1)];
    if (body === undefined) { response.statusCode = 404; response.end('Not found'); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); response.end(body);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No isolated port.');
  return { url: `http://127.0.0.1:${address.port}`, oldManifest, nextManifest, update: (failed = false) => { newer = true; broken = failed; }, close: () => new Promise<void>((resolve, reject) => (server as Server).close(error => error ? reject(error) : resolve())) };
}
async function registerFixture(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }); }); await waitForControlled(page);
}

test('M6 a real waiting release preserves old tabs and static chunks until explicit activation and only then switches the reloaded shell', async ({ browser }) => {
  const server = await testReleaseServer(), context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const oldTab = await context.newPage(); await oldTab.goto(server.url); await registerFixture(oldTab);
    server.update(); await oldTab.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => oldTab.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting?.state)).toBe('installed');
    expect(await oldTab.locator('#version').textContent()).toBe('old');
    const approvalTab = await context.newPage(); await approvalTab.goto(server.url); expect(await approvalTab.locator('#version').textContent()).toBe('old');
    await approvalTab.evaluate(async releaseId => {
      const waiting = (await navigator.serviceWorker.getRegistration())!.waiting!;
      await new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; waiting.postMessage({ type: 'ACTIVATE_RELEASE', releaseId }, [channel.port2]); });
    }, server.nextManifest.releaseId);
    await expect.poll(() => approvalTab.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting === null)).toBe(true);
    expect(await oldTab.locator('#version').textContent()).toBe('old');
    await expect.poll(() => oldTab.evaluate(() => new Promise<string>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data.manifest.releaseId); }; navigator.serviceWorker.controller!.postMessage({ type: 'GET_RELEASE' }, [channel.port2]); }))).toBe(server.nextManifest.releaseId);
    await context.setOffline(true);
    expect(await oldTab.evaluate(async () => await (await fetch('/assets/lazy-old.js')).text())).toContain('lazyRelease="old"');
    expect(await oldTab.evaluate(() => new Promise<string>((resolve, reject) => { const worker = new Worker('/assets/engine.worker-old.js'); worker.onmessage = event => { worker.terminate(); resolve(event.data); }; worker.onerror = reject; worker.postMessage('run'); }))).toBe('old');
    await approvalTab.reload(); await expect(approvalTab.locator('#version')).toHaveText('new');
    expect(await approvalTab.evaluate(() => new Promise<string>((resolve, reject) => { const worker = new Worker('/assets/engine.worker-new.js'); worker.onmessage = event => { worker.terminate(); resolve(event.data); }; worker.onerror = reject; worker.postMessage('run'); }))).toBe('new');
    const cacheNames = await approvalTab.evaluate(() => caches.keys()); expect(cacheNames).toContain(OFFLINE_CACHE_PREFIX + server.oldManifest.releaseId); expect(cacheNames).toContain(OFFLINE_CACHE_PREFIX + server.nextManifest.releaseId);
  } finally { await context.close(); await server.close(); }
});

test('M6 an incomplete real update is rejected while the previous installed shell and Worker stay usable offline', async ({ browser }) => {
  const server = await testReleaseServer(), context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage(); await page.goto(server.url); await registerFixture(page);
    server.update(true);
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => { const registration = (await navigator.serviceWorker.getRegistration())!; return registration.installing === null && registration.waiting === null; })).toBe(true);
    expect(await page.evaluate(() => caches.keys())).toEqual([OFFLINE_CACHE_PREFIX + server.oldManifest.releaseId]);
    await context.setOffline(true); await page.reload(); await expect(page.locator('#version')).toHaveText('old');
    const output = await page.evaluate(() => new Promise<string>((resolve, reject) => { const worker = new Worker('/assets/engine.worker-old.js'); worker.onmessage = event => { worker.terminate(); resolve(event.data); }; worker.onerror = reject; worker.postMessage('run'); }));
    expect(output).toBe('old');
  } finally { await context.close(); await server.close(); }
});

async function applicationReleaseServer() {
  const buildDirectory = resolve(process.env.CALCWEAVE_TEST_BUILD_DIR ?? 'dist');
  const manifest = JSON.parse(await readFile(join(buildDirectory, 'offline-manifest.json'), 'utf8')) as OfflineManifest;
  if (manifest.scope !== '/' || manifest.appVersion !== APP_VERSION) throw new Error('The update browser regression requires the current root-path application build.');
  const initial: Record<string, Buffer> = {};
  for (const asset of manifest.assets) initial[asset.url.slice(1)] = await readFile(join(buildDirectory, asset.url.slice(1)));
  const html = initial['index.html']!.toString('utf8'), entry = html.match(/<script\b[^>]*\bsrc="(\/assets\/[^"?]+\.js)"/);
  if (!entry) throw new Error('Missing current application entry module.');
  const oldEntry = entry[1]!.slice(1), newEntry = oldEntry.replace(/\.js$/, '-update-test.js');
  const version = APP_VERSION.split('.').map(Number); version[2]! += 1; const nextVersion = version.join('.');
  const source = initial[oldEntry]!.toString('utf8');
  if (!source.includes(APP_VERSION)) throw new Error('The application version must be embedded in its entry module.');
  // Only this repository-owned compiled app is transformed into a second fixture
  // release. It exercises the real UI/controller instead of a mocked update banner.
  const updated = { ...initial, 'index.html': Buffer.from(html.replace(entry[1]!, '/' + newEntry)), [newEntry]: Buffer.from(source.replaceAll(APP_VERSION, nextVersion)) };
  delete updated[oldEntry];
  const nextManifest = createOfflineManifest(updated, { appVersion: nextVersion, engineVersion: ENGINE_VERSION });
  let newer = false;
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Service-Worker-Allowed', '/');
    if (path === '/sw.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(generateOfflineWorker(newer ? nextManifest : manifest)); return; }
    if (path === '/offline-manifest.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(newer ? nextManifest : manifest)); return; }
    const name = path === '/' ? 'index.html' : path.slice(1), body = (newer ? updated : initial)[name] ?? initial[name];
    if (body === undefined) { response.statusCode = 404; response.end('Not found'); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); response.end(body);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No isolated update browser port.');
  return { url: `http://127.0.0.1:${address.port}`, nextVersion, nextManifest, update: () => { newer = true; }, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('A deployed update names its version and another tab activation leaves a saved reload available without losing the edited model', async ({ browser }) => {
  test.setTimeout(90_000);
  const server = await applicationReleaseServer(), context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const oldTab = await context.newPage(); await oldTab.goto(server.url); await waitForControlled(oldTab);
    await expect(oldTab.locator('.offline-banner')).toContainText('오프라인 사용 준비됨');
    const approvalTab = await context.newPage(); await approvalTab.goto(server.url); await waitForControlled(approvalTab);
    await expect(approvalTab.locator('.save-indicator')).toContainText('브라우저에 저장됨');
    server.update(); await oldTab.getByRole('button', { name: '업데이트 확인', exact: true }).click();
    await expect(oldTab.locator('.offline-banner')).toContainText(`새 릴리스 ${server.nextVersion}가 준비되었습니다.`);
    await expect(approvalTab.getByRole('button', { name: '저장 후 업데이트 적용', exact: true })).toBeVisible();
    await approvalTab.getByRole('button', { name: '저장 후 업데이트 적용', exact: true }).click();
    await expect(approvalTab.locator('.research-badge')).toContainText(server.nextVersion);
    await expect(oldTab.locator('.research-badge')).toContainText(APP_VERSION);
    await expect(oldTab.locator('.offline-banner')).toContainText(`${server.nextVersion} 적용을 위해 새로고침이 필요합니다.`);
    await oldTab.getByLabel('모델 이름', { exact: true }).fill('새 릴리스로 이어갈 작업'); await oldTab.getByLabel('모델 이름', { exact: true }).press('Enter');
    await oldTab.locator('.model-node-list').getByRole('button', { name: '배율', exact: true }).click();
    await oldTab.getByLabel('배율', { exact: true }).fill('5'); await oldTab.getByLabel('배율', { exact: true }).press('Enter');
    await expect(oldTab.locator('.save-indicator')).toContainText('브라우저에 저장됨'); const stored = await currentModel(oldTab);
    await oldTab.getByRole('button', { name: '저장 후 새로고침', exact: true }).click();
    await expect(oldTab.locator('.research-badge')).toContainText(server.nextVersion);
    expect(await currentModel(oldTab)).toEqual(stored); await expect(oldTab.getByLabel('모델 이름')).toHaveValue(stored.name);
    await oldTab.getByRole('button', { name: /^계산하기(?:\s|$)/ }).click(); await expect(oldTab.locator('.result-status')).toContainText('현재 모델의 결과');
    await expect(oldTab.locator('.react-flow__node[data-id="result"] .block-value')).toHaveText('10');
    await expect(oldTab.getByRole('button', { name: '저장 후 새로고침', exact: true })).toHaveCount(0);
  } finally { await context.close(); await server.close(); }
});
