import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { HistoryRecord } from '../../apps/web/src/run-history';
import type { OfflineManifest } from '../../scripts/offline-build';
import { openAppInfo } from './help-tools';

test.use({ serviceWorkers: 'allow' });
const BASE = '/CalcWeave/';
async function open(page: Page) { await page.goto('./'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function ready(page: Page) {
  await expect(page.getByLabel('오프라인 상태')).toContainText('오프라인 사용 준비됨');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : '')).toBe(`${BASE}sw.js`);
}
async function history(page: Page): Promise<HistoryRecord[]> {
  return page.evaluate(() => new Promise<HistoryRecord[]>((resolve, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onsuccess = () => { const database = opening.result, transaction = database.transaction('models', 'readonly'), reading = transaction.objectStore('models').get('run-history-v1'); reading.onsuccess = () => resolve(reading.result ?? []); transaction.oncomplete = () => database.close(); transaction.onerror = () => reject(new Error('History read failed')); };
    opening.onerror = () => reject(new Error('History open failed'));
  }));
}
async function calculate(page: Page, count: number) {
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
  await expect.poll(async () => (await history(page)).length).toBe(count); return (await history(page))[0]!;
}
async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const item = await pending;
  return { name: item.suggestedFilename(), bytes: await readFile((await item.path())!) };
}
function unzip(bytes: Buffer): Record<string, string> {
  const files: Record<string, string> = {}; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extraLength;
    files[name] = bytes.subarray(start, start + length).toString('utf8'); offset = start + length;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50); return files;
}

test('Pages project path boots scoped assets and the real calculation Worker', async ({ page }, testInfo) => {
  const errors: string[] = [], resources: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (url.protocol === 'http:' && url.hostname === '127.0.0.1') resources.push(url.pathname); });
  await open(page); await expect(page).toHaveURL(/\/CalcWeave\/$/);
  const record = await calculate(page, 1); expect(record.result.samples[0].values.result).toBe(6); await ready(page);
  const shell = await page.locator('script[type="module"]').getAttribute('src'); expect(shell).toMatch(/^\/CalcWeave\/assets\/.*\.js$/);
  expect(resources.some(path => path.startsWith(`${BASE}assets/engine.worker-`))).toBe(true); expect(resources.every(path => path.startsWith(BASE))).toBe(true); expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('pages-desktop.png') });
});

test('Pages support links open all scoped policy pages and their navigation returns to the app', async ({ page }, testInfo) => {
  await open(page); await openAppInfo(page);
  for (const [name, suffix] of [['개인정보 처리방침', 'privacy/'], ['이용약관', 'terms/'], ['쿠키·로컬 저장 안내', 'cookies/'], ['오픈소스 고지', 'notices/']] as const) await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', BASE + suffix);
  await expect(page.getByRole('link', { name: '현재 웹 주소', exact: true })).toHaveAttribute('href', 'https://jtech-co.github.io/CalcWeave/');
  const popupPending = page.waitForEvent('popup'); await page.getByRole('link', { name: '개인정보 처리방침', exact: true }).click(); const policy = await popupPending;
  await expect(policy).toHaveURL(/\/CalcWeave\/privacy\/$/);
  for (const suffix of ['privacy/', 'terms/', 'cookies/', 'notices/']) {
    await policy.goto(new URL(suffix, new URL(BASE, page.url())).href); await expect(policy.getByRole('heading', { level: 1 })).toBeVisible();
    const links = await policy.getByRole('navigation', { name: '문서 탐색' }).getByRole('link').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
    expect(links).toEqual([BASE, `${BASE}terms/`, `${BASE}privacy/`, `${BASE}cookies/`, `${BASE}notices/`]);
  }
  await policy.screenshot({ path: testInfo.outputPath('pages-policy.png') }); await policy.getByRole('link', { name: 'CalcWeave 작업 공간', exact: true }).click();
  await expect(policy).toHaveURL(/\/CalcWeave\/$/); await expect(policy.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await policy.close();
});

test('Pages scoped release caches only app files and remains editable and executable after offline reload', async ({ page, context }) => {
  await open(page); await ready(page); const manifest = await page.evaluate(async path => await (await fetch(path)).json(), `${BASE}offline-manifest.json`) as OfflineManifest;
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.scope); expect(new URL(scope).pathname).toBe(BASE);
  expect(manifest.assets.every(asset => asset.url.startsWith(BASE))).toBe(true);
  const cached = await page.evaluate(async () => { const names = await caches.keys(), urls: string[] = []; for (const name of names) urls.push(...(await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)); return urls; });
  expect(cached.sort()).toEqual([...manifest.assets.map(asset => asset.url), `${BASE}offline-manifest.json`].sort());
  expect((await calculate(page, 1)).result.samples[0].values.result).toBe(6);
  await context.setOffline(true); await page.reload(); await expect(page.getByLabel('오프라인 상태')).toContainText('오프라인 · 저장된 앱으로 작업 중');
  await page.locator('.model-node-list').getByRole('button', { name: '배율', exact: true }).click(); await page.getByLabel('배율', { exact: true }).fill('5'); await page.getByLabel('배율', { exact: true }).press('Tab');
  expect((await calculate(page, 2)).result.samples[0].values.result).toBe(10);
  expect(await page.evaluate(async () => { try { await fetch('/outside-app-private.json'); return true; } catch { return false; } })).toBe(false);
  const policy = await context.newPage(); await policy.goto(new URL(`${BASE}privacy/`, page.url()).href);
  await expect(policy.getByRole('heading', { level: 1 })).toContainText('개인정보');
  await expect(policy.getByRole('link', { name: 'CalcWeave 작업 공간', exact: true })).toHaveAttribute('href', BASE); await policy.close();
});

test('Pages offline reload can load the Python target and download a complete local execution archive', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await ready(page); await context.setOffline(true); await page.reload();
  await expect(page.getByLabel('오프라인 상태')).toContainText('오프라인 · 저장된 앱으로 작업 중'); const record = await calculate(page, 1);
  const native = await download(page, '모델 다운로드'); expect(JSON.parse(native.bytes.toString('utf8')).modelId).toBe('first-calculation');
  await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click(); await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python');
  await expect(page.getByRole('button', { name: 'Python 실행 묶음', exact: true })).toBeEnabled(); const archive = await download(page, 'Python 실행 묶음'); expect(archive.name).toBe('CalcWeave-python-execution.zip');
  const files = unzip(archive.bytes); expect(Object.keys(files).sort()).toEqual(['README.md', 'expected-output.json', 'manifest.json', 'model.cw.json', 'model.py', 'run-example.py']);
  expect(files['model.py']).toContain('def run('); expect(JSON.parse(files['expected-output.json']).samples).toEqual(record.result.samples); expect(JSON.parse(files['manifest.json']).minimumVersion).toBe('3.10'); expect(errors).toEqual([]);
});
