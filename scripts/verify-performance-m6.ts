import assert from 'node:assert/strict';
import { cpus, platform, release, totalmem } from 'node:os';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect, type Page } from '@playwright/test';
import config from '../playwright.config';
const verificationOrigin = process.env.CALCWEAVE_VERIFY_ORIGIN ?? 'http://127.0.0.1:4173';
if (!/^http:\/\/127\.0\.0\.1:(?:4173|4175)$/.test(verificationOrigin)) throw new Error('Only dedicated local verification origins are allowed');
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { ENGINE_VERSION, type CalcModel } from '../packages/model/src';

function chain(count: number, timed = false): CalcModel {
  const nodes: CalcModel['nodes'] = [{ id: 'value', blockVersion: 1, blockType: 'source.constant', label: '입력', parameters: { value: 1 } }], edges: CalcModel['edges'] = [], layout: CalcModel['layout'] = {};
  let previous = 'value';
  for (let index = 0; index < count - 2; index++) {
    const id = `gain-${index}`; nodes.push({ id, blockVersion: 1, blockType: 'math.gain', label: '배율', parameters: { gain: timed ? 1 : 1.0001 } });
    edges.push({ id: `edge-${index}`, source: { nodeId: previous, portId: 'out' }, target: { nodeId: id, portId: 'in' } }); previous = id;
  }
  nodes.push({ id: 'result', blockVersion: 1, blockType: 'sink.display', label: '결과', parameters: {} });
  edges.push({ id: 'edge-result', source: { nodeId: previous, portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
  nodes.forEach((node, index) => { layout[node.id] = { x: index % 10 * 190, y: Math.floor(index / 10) * 120 }; });
  return { schemaVersion: 1, modelId: `perf-${count}${timed ? '-timed' : ''}`, name: `${count} 블럭 성능 측정`, nodes, edges, layout, execution: timed ? { mode: 'discrete', startTime: 0, stopTime: 10_000, step: 1 } : { mode: 'static', startTime: 0, stopTime: 0, step: 1 } };
}
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { repetitions: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)]!, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1]!, valuesMs: values };
}
const nodeBenchmarks = [];
for (const count of [100, 1000]) {
  const model = chain(count), reference = Math.pow(1.0001, count - 2), values: number[] = [];
  for (let iteration = 0; iteration < 25; iteration++) {
    const started = performance.now(), result = await runModel(compileModel(model)), duration = performance.now() - started;
    assert(Math.abs(Number(result.samples[0]!.values.result) - reference) <= reference * 1e-12);
    if (iteration >= 5) values.push(duration);
  }
  nodeBenchmarks.push({ nodes: count, compileAndRun: stats(values), referenceVerified: true });
}
const browser = await chromium.launch(config.use?.launchOptions);
const errors: string[] = [], cold: number[] = [], warm: number[] = [];
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '계산하기' })).toBeVisible();
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function imported(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'perf.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름')).toHaveValue(model.name);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function latestHistory(page: Page): Promise<{ id: string; model: CalcModel; result: { samples: { values: Record<string, unknown> }[] } } | undefined> {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1); request.onerror = () => reject(new Error('IDB unavailable'));
    request.onsuccess = () => { const db = request.result, tx = db.transaction('models'), read = tx.objectStore('models').get('run-history-v1'); read.onsuccess = () => resolve(read.result?.[0]); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('IDB read failed')); };
  }));
}
async function checkRawOutput(page: Page, priorId: string | undefined, count: number): Promise<void> {
  await expect.poll(async () => (await latestHistory(page))?.id).not.toBe(priorId);
  const record = await latestHistory(page), reference = Math.pow(1.0001, count - 2);
  assert.equal(record?.model.modelId, `perf-${count}`);
  assert(Math.abs(Number(record?.result.samples[0]?.values.result) - reference) <= reference * 1e-12, `raw ${count} node result agrees with analytic chain`);
}
let endurance, browserGraphs, cancellation;
try {
  for (let iteration = 0; iteration < 5; iteration++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let start = performance.now(); await page.goto(verificationOrigin + '/'); await ready(page); cold.push(performance.now() - start);
    // Same context retains HTTP cache and local workspace; SW readiness has its own actual offline tests.
    start = performance.now(); await page.reload(); await ready(page); warm.push(performance.now() - start);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    const longTasks: number[] = []; Reflect.set(window, 'm6LongTasks', longTasks);
    try { new PerformanceObserver(entries => { for (const entry of entries.getEntries()) { longTasks.push(entry.duration); if (longTasks.length > 500) longTasks.shift(); } }).observe({ type: 'longtask', buffered: true }); } catch { /* Unsupported is reported, not required by the app. */ }
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(verificationOrigin + '/'); await ready(page);
  const graphResults = [];
  for (const count of [100, 1000]) {
    await imported(page, chain(count)); const values: number[] = [];
    for (let iteration = 0; iteration < 8; iteration++) {
      const priorId = (await latestHistory(page))?.id;
      const start = performance.now(); await page.getByRole('button', { name: '계산하기' }).click();
      await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
      await expect(page.locator('.output-card strong')).toHaveCount(1);
      await expect(page.locator('.run-button')).toBeVisible();
      values.push(performance.now() - start);
      await checkRawOutput(page, priorId, count);
    }
    graphResults.push({ nodes: count, uiRunToResult: stats(values), referenceVerified: true });
  }
  browserGraphs = graphResults;
  await imported(page, chain(100));
  const session = await context.newCDPSession(page); await session.send('Performance.enable');
  async function heap(): Promise<number> { await session.send('HeapProfiler.collectGarbage'); const metrics = await session.send('Performance.getMetrics'); return metrics.metrics.find(item => item.name === 'JSHeapUsedSize')!.value; }
  const beforeHeap = await heap(), runs: number[] = [];
  for (let iteration = 0; iteration < 30; iteration++) {
    const priorId = (await latestHistory(page))?.id;
    const start = performance.now(); await page.getByRole('button', { name: '계산하기' }).click();
    await expect(page.locator('.run-button')).toBeVisible(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
    runs.push(performance.now() - start); await checkRawOutput(page, priorId, 100);
  }
  await expect.poll(() => page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1); request.onerror = () => reject(new Error('IDB unavailable'));
    request.onsuccess = () => { const db = request.result, tx = db.transaction('models'), read = tx.objectStore('models').get('run-history-v1'); read.onsuccess = () => resolve(Array.isArray(read.result) ? read.result.length : 0); tx.oncomplete = () => db.close(); };
  }))).toBe(5);
  const afterHeap = await heap(), longTasks = await page.evaluate(() => Reflect.get(window, 'm6LongTasks') as number[]);
  endurance = { runs: stats(runs), historyRecords: 5, jsHeapBeforeBytes: beforeHeap, jsHeapAfterBytes: afterHeap, retainedGrowthBytes: afterHeap - beforeHeap, longTasksMs: longTasks, notes: 'Chromium CDP forced GC JS heap only; not whole process memory and not a multi-hour endurance study.' };
  await imported(page, chain(1000, true)); const cancelValues: number[] = [];
  for (let iteration = 0; iteration < 5; iteration++) {
    await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
    const cancel = page.getByRole('button', { name: '계산 취소', exact: true }); await expect(cancel).toBeVisible();
    const start = performance.now(); await cancel.click(); await expect(page.locator('.run-button')).toBeVisible(); cancelValues.push(performance.now() - start);
    await expect(page.locator('footer')).toContainText('취소');
  }
  cancellation = stats(cancelValues); await context.close();
} finally { await browser.close(); }
const coldLoad = stats(cold), warmLoad = stats(warm), manifest = JSON.parse(await readFile('dist/offline-manifest.json', 'utf8')) as { releaseId: string };
const budgets = { coldLoad: coldLoad.p95Ms <= 3000, warmLoad: warmLoad.p95Ms <= 2000, node1000: nodeBenchmarks[1]!.compileAndRun.p95Ms <= 1000, cancellation: cancellation!.p95Ms <= 1000, retainedHeap: endurance!.retainedGrowthBytes <= 32 * 1024 * 1024, pageErrors: errors.length === 0 };
await mkdir('docs/evidence', { recursive: true });
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, releaseId: manifest.releaseId, environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), browser: browser.version(), viewport: { width: 1440, height: 1000 }, origin: verificationOrigin }, coldLoad, warmLoad, nodeBenchmarks, browserGraphs, cancellation, endurance, errors, budgets, actualNoviceStudyClaimed: false, publicNetworkPerformanceClaimed: false };
await writeFile(`docs/evidence/${ENGINE_VERSION.split('-').at(-1)}-performance.json`, JSON.stringify(report, null, 2) + '\n');
assert(Object.values(budgets).every(Boolean), JSON.stringify(budgets)); process.stdout.write(JSON.stringify({ budgets, coldP95: coldLoad.p95Ms, warmP95: warmLoad.p95Ms, node1000P95: nodeBenchmarks[1]!.compileAndRun.p95Ms, cancelP95: cancellation!.p95Ms, retainedGrowthBytes: endurance!.retainedGrowthBytes }) + '\n');
