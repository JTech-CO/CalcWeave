import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test';
import config from '../playwright.config';
import { ENGINE_VERSION, canonicalSemantic } from '../packages/model/src';
import type { PythonExportManifest } from '../packages/codegen-python/src';
import { PYTHON_TARGET } from '../packages/codegen-python/src/capabilities';
import type { HistoryRecord } from '../apps/web/src/run-history';
import type { OfflineManifest } from './offline-build';
import { APP_VERSION } from '../packages/release/src';
import { blockRegistry } from '../packages/block-library/src';
const stage = String(APP_VERSION) === '0.8.1' ? 'pages' : ENGINE_VERSION.split('-').at(-1);

// This verifier never selects a user's profile, imports their storage, or sends mail.
// Run only after the approved public deployment has finished: npx tsx scripts/verify-public-pages.ts
const TARGET = 'https://jtech-co.github.io/CalcWeave/';
const BASE = '/CalcWeave/';
const TIMEOUT_MS = 60_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT_MS });
const EVIDENCE = resolve(`docs/evidence/${stage}-public-browser-verification.json`);
const SCREENSHOT = resolve(`docs/evidence/${stage}-public-desktop.png`);
const POLICY_PAGES = [
  { label: '이용약관', suffix: 'terms/', heading: '베타 이용 안내' },
  { label: '개인정보 처리방침', suffix: 'privacy/', heading: '개인정보' },
  { label: '쿠키·로컬 저장 안내', suffix: 'cookies/', heading: '쿠키' },
  { label: '오픈소스 고지', suffix: 'notices/', heading: '오픈소스 고지' },
] as const;
const ZIP_FILES = ['README.md', 'expected-output.json', 'manifest.json', 'model.cw.json', 'model.py', 'run-example.py'];
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const approved = (url: string) => { const value = new URL(url); return value.origin === new URL(TARGET).origin && value.pathname.startsWith(BASE) && !value.search && !value.hash; };
const localDownload = (url: string) => { const value = new URL(url); return value.protocol === 'blob:' && value.origin === new URL(TARGET).origin; };

async function diagramBounds(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('.canvas-area > .react-flow');
    const nodes = [...document.querySelectorAll('.react-flow__node')].map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    });
    if (!element || !nodes.length || nodes.some(node => node.width <= 0 || node.height <= 0)) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    const left = Math.min(...nodes.map(node => node.x)), top = Math.min(...nodes.map(node => node.y));
    const right = Math.max(...nodes.map(node => node.x + node.width)), bottom = Math.max(...nodes.map(node => node.y + node.height));
    return {
      canvas: { x, y, width, height }, nodes,
      contained: left >= x - 1 && top >= y - 1 && right <= x + width + 1 && bottom <= y + height + 1,
      centerError: { x: (left + right) / 2 - (x + width / 2), y: (top + bottom) / 2 - (y + height / 2) },
    };
  });
}

async function history(page: Page): Promise<HistoryRecord[]> {
  return page.evaluate(() => new Promise<HistoryRecord[]>((resolveRecords, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onerror = () => reject(new Error('Fresh-context history could not be opened.'));
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction('models', 'readonly');
      const reading = transaction.objectStore('models').get('run-history-v1');
      reading.onsuccess = () => resolveRecords(reading.result ?? []);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => { database.close(); reject(new Error('Fresh-context history could not be read.')); };
    };
  }));
}
async function calculate(page: Page, expectedCount: number): Promise<HistoryRecord> {
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.result-status.current')).toBeVisible();
  await expect.poll(async () => (await history(page)).length, { timeout: TIMEOUT_MS }).toBe(expectedCount);
  const record = (await history(page))[0]!;
  assert.equal(record.model.modelId, 'first-calculation');
  assert.equal(record.result.status, 'completed');
  assert.equal(record.engineVersion, ENGINE_VERSION);
  assert.equal(record.result.samples.length, 1);
  return record;
}

/** Read only six fixed, bounded ZIP-store entries. Never extract or execute downloaded code. */
function readArchive(bytes: Buffer): Record<string, string> {
  assert(bytes.length >= 22 && bytes.length <= 32 * 1024 * 1024, 'Bounded ZIP archive');
  const files: Record<string, string> = Object.create(null);
  const entries: { name: string; offset: number; size: number; crc: number }[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const crc32 = (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    return (crc ^ 0xffffffff) >>> 0;
  };
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    assert(entries.length < 6, 'Fixed archive entry limit');
    assert.equal(bytes.readUInt16LE(offset + 6), 0x0800, 'UTF-8, unencrypted ZIP without data descriptors');
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'ZIP store method');
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    assert.equal(bytes.readUInt32LE(offset + 22), size);
    assert.equal(bytes.readUInt16LE(offset + 28), 0);
    assert(size <= 16 * 1024 * 1024 && nameLength > 0 && nameLength <= 64);
    const start = offset + 30 + nameLength;
    assert(start + size <= bytes.length, 'Entry boundaries');
    const name = decoder.decode(bytes.subarray(offset + 30, start));
    assert(ZIP_FILES.includes(name) && !Object.hasOwn(files, name), 'Fixed unique filename whitelist');
    const data = bytes.subarray(start, start + size), crc = bytes.readUInt32LE(offset + 14);
    assert.equal(crc32(data), crc, 'Entry checksum');
    files[name] = decoder.decode(data); entries.push({ name, offset, size, crc }); offset = start + size;
  }
  assert.deepEqual(Object.keys(files).sort(), ZIP_FILES);
  const centralStart = offset;
  for (const entry of entries) {
    assert(offset + 46 <= bytes.length && bytes.readUInt32LE(offset) === 0x02014b50, 'Central directory header');
    assert.equal(bytes.readUInt16LE(offset + 8), 0x0800); assert.equal(bytes.readUInt16LE(offset + 10), 0);
    assert.equal(bytes.readUInt32LE(offset + 16), entry.crc);
    assert.equal(bytes.readUInt32LE(offset + 20), entry.size); assert.equal(bytes.readUInt32LE(offset + 24), entry.size);
    assert.equal(bytes.readUInt16LE(offset + 30), 0); assert.equal(bytes.readUInt16LE(offset + 32), 0);
    assert.equal(bytes.readUInt16LE(offset + 34), 0); assert.equal(bytes.readUInt32LE(offset + 42), entry.offset);
    const nameLength = bytes.readUInt16LE(offset + 28);
    assert(offset + 46 + nameLength <= bytes.length);
    assert.equal(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), entry.name);
    offset += 46 + nameLength;
  }
  assert.equal(bytes.length, offset + 22, 'No archive trailing content');
  assert.equal(bytes.readUInt32LE(offset), 0x06054b50);
  assert.equal(bytes.readUInt16LE(offset + 4), 0); assert.equal(bytes.readUInt16LE(offset + 6), 0);
  assert.equal(bytes.readUInt16LE(offset + 8), 6); assert.equal(bytes.readUInt16LE(offset + 10), 6);
  assert.equal(bytes.readUInt32LE(offset + 12), offset - centralStart);
  assert.equal(bytes.readUInt32LE(offset + 16), centralStart); assert.equal(bytes.readUInt16LE(offset + 20), 0);
  return files;
}

async function main() {
  // A URL argument can repeat the approved address, but cannot redirect the verifier.
  assert(process.argv.length <= 3 && (process.argv[2] === undefined || process.argv[2] === TARGET), `Only ${TARGET} is approved.`);
  const started = Date.now(), checks: { name: string; evidence: unknown }[] = [];
  const requests: { url: string; method: string; type: string }[] = [], violations: string[] = [], pageErrors: string[] = [], workers: string[] = [];
  let browser: Browser | undefined, page: Page | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false, verified = false, errorMessage: string | undefined;
  const check = (name: string, evidence: unknown = true) => checks.push({ name, evidence });
  const work = async () => {
    browser = await chromium.launch({ ...config.use?.launchOptions, headless: true, timeout: TIMEOUT_MS });
    if (timedOut) { await browser.close(); throw new Error('Public verification timed out during browser launch.'); }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow', acceptDownloads: true });
    context.setDefaultTimeout(TIMEOUT_MS); context.setDefaultNavigationTimeout(TIMEOUT_MS);
    context.on('page', item => { item.on('pageerror', error => pageErrors.push(error.message)); item.on('worker', worker => workers.push(worker.url())); });
    context.on('request', request => {
      const url = request.url(); requests.push({ url, method: request.method(), type: request.resourceType() });
      if ((!approved(url) && !localDownload(url)) || request.method() !== 'GET') violations.push(`${request.method()} ${url}`);
    });
    // Block accidental off-site/window requests as well as reporting their attempted URLs.
    // SW requests are separately observed above and its cache scope is checked below.
    await context.route('**/*', route => (approved(route.request().url()) || localDownload(route.request().url())) && route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'));
    page = await context.newPage();
    const response = await page.goto(TARGET);
    assert.equal(response?.status(), 200); await expect(page).toHaveURL(TARGET);
    await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
    assert.deepEqual(await history(page), [], 'New browser context has no user model history');
    await expect(page.locator('.block-library-header .count-badge')).toHaveText(String(blockRegistry.length));
    await expect(page.locator('.library-category[data-library-category="frequent"] .library-category-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.library-item')).toHaveCount(10);
    const moduleURL = await page.locator('script[type="module"]').getAttribute('src');
    assert(moduleURL?.startsWith(`${BASE}assets/`));
    await expect(page.locator('.research-badge')).toHaveText(`${APP_VERSION} 작업 공간`);
    await expect(page.locator('.library-footnote .small-square')).toHaveText(APP_VERSION);
    let initialDiagramFit: Awaited<ReturnType<typeof diagramBounds>> = null;
    await expect.poll(async () => {
      initialDiagramFit = await diagramBounds(page!);
      return initialDiagramFit !== null && initialDiagramFit.contained
        && Math.abs(initialDiagramFit.centerError.x) <= 2 && Math.abs(initialDiagramFit.centerError.y) <= 2;
    }, { timeout: 5_000, message: 'Fresh public diagram must fit and center in the measured canvas.' }).toBe(true);
    check('fresh public workspace and current registered blocks', { url: page.url(), moduleURL, isolatedContext: true, visibleAppVersion: APP_VERSION, initialDiagramFit });

    const initial = await calculate(page, 1);
    assert.equal(initial.result.samples[0]!.values.result, 6);
    assert(workers.some(url => approved(url) && new URL(url).pathname.startsWith(`${BASE}assets/engine.worker-`)), 'Actual browser calculation Worker loaded');
    check('real Worker baseline calculation', { raw: initial.result.samples, workerURLs: [...workers], modelId: initial.model.modelId });

    await page.getByRole('button', { name: '도움말', exact: true }).click();
    const support = page.getByRole('dialog', { name: 'CalcWeave 도움말', exact: true });
    await expect(support.locator('[data-help-start]')).toBeFocused();
    await support.getByRole('button', { name: '블록 찾기', exact: true }).click();
    await expect(support.locator('.support-block-list > button')).toHaveCount(blockRegistry.length);
    await support.getByRole('button', { name: '앱 정보', exact: true }).click();
    await support.getByText('버전 기술 정보', { exact: true }).click();
    await expect(support).toContainText(APP_VERSION); await expect(support).toContainText(ENGINE_VERSION);
    check('current product help and block catalog', { appVersion: APP_VERSION, engineVersion: ENGINE_VERSION, blockCount: blockRegistry.length });
    for (const policy of POLICY_PAGES) await expect(support.getByRole('link', { name: policy.label, exact: true })).toHaveAttribute('href', BASE + policy.suffix);
    await expect(support.getByRole('link', { name: '현재 웹 주소', exact: true })).toHaveAttribute('href', TARGET);
    await page.keyboard.press('Escape'); await expect(support).not.toBeVisible();

    const policyPage = await context.newPage(), policyEvidence = [];
    for (const policy of POLICY_PAGES) {
      const url = new URL(policy.suffix, TARGET).href;
      // APIRequestContext bypasses SW to prove these are real public static HTML pages.
      const direct = await context.request.get(url, { timeout: TIMEOUT_MS, maxRedirects: 0 });
      assert.equal(direct.status(), 200); assert.equal(direct.url(), url);
      assert.match(direct.headers()['content-type'] ?? '', /text\/html/i);
      const html = await direct.text(); assert(html.includes(policy.heading));
      assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]+">/);
      requests.push({ url, method: 'GET', type: 'direct-policy' }); await direct.dispose();
      const navigation = await policyPage.goto(url); assert.equal(navigation?.status(), 200);
      await expect(policyPage).toHaveURL(url); await expect(policyPage.getByRole('heading', { level: 1 })).toContainText(policy.heading);
      const links = await policyPage.getByRole('navigation', { name: '문서 탐색' }).getByRole('link').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
      assert.deepEqual(links, [BASE, ...POLICY_PAGES.map(item => BASE + item.suffix)]);
      policyEvidence.push({ url, status: 200, contentType: 'text/html', contentSecurityPolicyMeta: true, heading: await policyPage.getByRole('heading', { level: 1 }).innerText(), scopedNavigation: links });
    }
    await policyPage.close(); check('four actual public static policy pages', policyEvidence);

    await expect(page.getByLabel('오프라인 상태')).toContainText('오프라인 사용 준비됨');
    await expect.poll(() => page!.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), { timeout: TIMEOUT_MS }).toBe(new URL('sw.js', TARGET).href);
    const offline = await page.evaluate(async path => {
      const response = await fetch(path); if (!response.ok) throw new Error('Offline manifest HTTP failure.');
      return await response.json();
    }, BASE + 'offline-manifest.json') as OfflineManifest;
    assert.equal(offline.appVersion, APP_VERSION); assert.equal(offline.engineVersion, ENGINE_VERSION); assert.equal(offline.scope, BASE);
    assert.match(offline.releaseId, /^[a-f0-9]{64}$/); assert(offline.assets.every(asset => approved(new URL(asset.url, TARGET).href)));
    const cache = await page.evaluate(async () => {
      const scope = (await navigator.serviceWorker.getRegistration())?.scope;
      const names = await caches.keys(), urls: string[] = [];
      for (const name of names) urls.push(...(await (await caches.open(name)).keys()).map(request => request.url));
      return { scope, names, urls };
    });
    assert.equal(cache.scope, TARGET); assert(cache.urls.every(approved));
    assert.deepEqual(cache.urls.map(url => new URL(url).pathname).sort(), [...offline.assets.map(asset => asset.url), BASE + 'offline-manifest.json'].sort());
    check('offline release ready with exact project scope', { scope: cache.scope, releaseId: offline.releaseId, cachedFiles: cache.urls.length, cacheNames: cache.names });

    await context.setOffline(true); await page.reload(); await expect(page).toHaveURL(TARGET);
    await expect(page.getByLabel('오프라인 상태')).toContainText('오프라인 · 저장된 앱으로 작업 중');
    await page.locator('.model-node-list').getByRole('button', { name: '배율', exact: true }).click();
    await page.getByLabel('배율', { exact: true }).fill('5'); await page.getByLabel('배율', { exact: true }).press('Tab');
    const edited = await calculate(page, 2);
    assert.equal(edited.model.nodes.find(node => node.id === 'gain')!.parameters.gain, 5);
    assert.equal(edited.result.samples[0]!.values.result, 10);
    check('offline reload, editable gain 5, and real Worker result 10', { raw: edited.result.samples, modelHash: edited.semanticHash, gain: 5 });
    const offlinePolicy = await context.newPage(); await offlinePolicy.goto(new URL('privacy/', TARGET).href);
    await expect(offlinePolicy.getByRole('heading', { level: 1 })).toContainText('개인정보'); await offlinePolicy.close();
    check('offline policy navigation');

    await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click();
    await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python');
    await expect(page.getByRole('button', { name: 'Python 실행 묶음', exact: true })).toBeEnabled();
    const pending = page.waitForEvent('download', { timeout: TIMEOUT_MS });
    await page.getByRole('button', { name: 'Python 실행 묶음', exact: true }).click(); const download = await pending;
    assert.equal(download.suggestedFilename(), 'CalcWeave-python-execution.zip'); assert.equal(await download.failure(), null);
    const downloadPath = await download.path(); assert(downloadPath);
    const bytes = await readFile(downloadPath), files = readArchive(bytes);
    const model = JSON.parse(files['model.cw.json']!), manifest = JSON.parse(files['manifest.json']!) as PythonExportManifest;
    const { elapsedMs: _elapsedMs, ...expected } = edited.result;
    assert.deepEqual(model, edited.model); assert.deepEqual(JSON.parse(files['expected-output.json']!), expected);
    assert.equal(manifest.modelHash, edited.semanticHash); assert.equal(manifest.modelHash, hash(canonicalSemantic(model)));
    assert.equal(manifest.modelHashAlgorithm, 'SHA-256'); assert.equal(manifest.engineVersion, edited.engineVersion);
    assert.equal(manifest.targetVersion, PYTHON_TARGET.id); assert.equal(manifest.minimumVersion, '3.10');
    assert.equal(manifest.runtime, 'python-standard-library'); assert.deepEqual(manifest.execution, model.execution);
    assert.deepEqual(manifest.outputTypes, edited.outputTypes); assert.deepEqual(manifest.nodes, edited.manifest.nodes);
    const embedded = (key: string) => {
      const match = files['model.py']!.match(new RegExp(`^${key} = bytes\\.fromhex\\("([0-9a-f]+)"\\)$`, 'm')); assert(match, 'Inert embedded Python JSON');
      return Buffer.from(match[1]!, 'hex');
    };
    const dataBytes = embedded('_DATA_TEXT'), embeddedManifest = JSON.parse(embedded('_MANIFEST_TEXT').toString('utf8'));
    assert.deepEqual(embeddedManifest, manifest); assert.equal(hash(dataBytes), manifest.artifactDataHash);
    assert.equal(manifest.artifactDataHashAlgorithm, 'SHA-256'); assert(files['model.py']!.includes('def run('));
    const data = JSON.parse(dataBytes.toString('utf8'));
    assert.deepEqual(data.settings, model.execution); assert.deepEqual(data.outputs, edited.outputIds); assert.deepEqual(data.outputTypes, edited.outputTypes);
    assert.equal(data.nodes.find((node: { id: string }) => node.id === 'gain').parameters.gain, 5);
    assert.equal(data.nodes.find((node: { id: string }) => node.id === 'value').parameters.value, 2);
    check('offline Python ZIP agrees with model, manifest, embedded IR and complete raw expected output', { filename: download.suggestedFilename(), bytes: bytes.length, sha256: hash(bytes), files: Object.keys(files), modelHash: manifest.modelHash, artifactDataHash: manifest.artifactDataHash, raw: expected.samples, codeExecuted: false });
    await page.keyboard.press('Escape');
    assert.deepEqual(pageErrors, []); assert.deepEqual(violations, []);
    check('no page errors or requests outside the approved app', { pageErrors, observedRequests: requests.length });
    await mkdir(resolve('docs/evidence'), { recursive: true });
    await page.screenshot({ path: SCREENSHOT, fullPage: true, timeout: TIMEOUT_MS });
    verified = true;
  };
  try {
    await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Public Pages browser verification exceeded the explicit 60-second limit.')); }, TIMEOUT_MS); })]);
  } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
  finally {
    if (timer) clearTimeout(timer);
    if (browser) { try { await browser.close(); } catch (error) { verified = false; errorMessage ??= `Browser close failed: ${String(error)}`; } }
    await mkdir(resolve('docs/evidence'), { recursive: true });
    await writeFile(EVIDENCE, JSON.stringify({ schemaVersion: 1, checkedAt: new Date().toISOString(), targetURL: TARGET, status: verified ? 'passed' : 'failed', verified, timeoutMs: TIMEOUT_MS, elapsedMs: Date.now() - started, isolatedFreshContext: true, screenshot: verified ? `docs/evidence/${stage}-public-desktop.png` : null, checks, requests, workerURLs: workers, pageErrors, outsideAppRequests: violations, ...(errorMessage ? { error: errorMessage } : {}) }, null, 2) + '\n', 'utf8');
  }
  console.log(`Public Pages browser verification: ${verified ? 'PASS' : 'FAIL'} (${checks.length} checks). ${EVIDENCE}`);
  if (!verified) { console.error(errorMessage ?? 'Public verification failed.'); process.exitCode = 1; }
}

await main();
