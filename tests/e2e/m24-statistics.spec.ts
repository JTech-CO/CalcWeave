import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ENGINE_VERSION, type CalcModel } from '../../packages/model/src';
import { compileModel } from '../../packages/compiler/src';
import { sha256 } from '../../packages/model/src/sha256';
import { APP_VERSION } from '../../packages/release/src';
import type { HistoryRecord } from '../../apps/web/src/run-history';
import type { TimeSeriesSourceSnapshot } from '../../apps/web/src/time-series-analysis-sources';
import type { CorrelationInput, CorrelationOptions, CorrelationReport, TimeSeriesInput, TimeStatisticsReport } from '../../packages/analysis/src/time-series-statistics';

type StatisticsExport = { schemaVersion: number; kind: string; engineVersion: string; previousRun: boolean; source: TimeSeriesSourceSnapshot; input: TimeSeriesInput; inputFloat64Bits: { times: string[]; values: string[] }; samplesHashEncoding: string; options: { weighting: string }; result: TimeStatisticsReport };
type CorrelationExport = { schemaVersion: number; kind: string; engineVersion: string; previousRun: boolean; xSource: TimeSeriesSourceSnapshot; ySource: TimeSeriesSourceSnapshot; input: CorrelationInput; options: CorrelationOptions; result: CorrelationReport };
function signal(count = 64): CalcModel {
  return { schemaVersion: 1, modelId: 'm24-recorded-delay', name: '구간 통계와 3표본 지연',
    execution: { mode: 'discrete', startTime: 0, stopTime: (count - 1) / count, step: 1 / count },
    nodes: [
      { id: 'input', blockType: 'source.signal-generator', blockVersion: 1, label: '5 Hz 사인', parameters: { waveform: 'sine', amplitude: 3, frequency: 5, frequencyUnit: 'Hz', phase: Math.PI / 7, bias: 4, seed: 1 } },
      { id: 'delay', blockType: 'discrete.delay', blockVersion: 1, label: '3표본 지연', parameters: { steps: 3, initial: 0 } },
      { id: 'scope-x', blockType: 'sink.scope', blockVersion: 1, label: '원래 신호 X', parameters: {} },
      { id: 'scope-y', blockType: 'sink.scope', blockVersion: 1, label: '지연된 신호 Y', parameters: {} },
    ],
    edges: [
      { id: 'input-x', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'scope-x', portId: 'in' } },
      { id: 'input-delay', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'delay', portId: 'in' } },
      { id: 'delay-y', source: { nodeId: 'delay', portId: 'out' }, target: { nodeId: 'scope-y', portId: 'in' } },
    ], layout: { input: { x: 40, y: 80 }, delay: { x: 300, y: 200 }, 'scope-x': { x: 580, y: 80 }, 'scope-y': { x: 580, y: 200 } } };
}
function constant(count = 4): CalcModel { const model = signal(count); model.nodes[0].blockType = 'source.constant'; model.nodes[0].parameters = { value: 7 }; return model; }
function typedNonFinite(): CalcModel { const model = signal(); model.nodes.splice(1, 1); model.edges = [model.edges[0]]; model.nodes.splice(2, 1); model.layout = { input: { x: 40, y: 80 }, 'scope-x': { x: 350, y: 80 } }; model.nodes[0].blockType = 'source.typed'; model.nodes[0].parameters = { value: { kind: 'typed', dtype: 'float64', shape: [2], data: [1, 'NaN'] } }; return model; }
async function open(page: Page) { await page.goto('./'); await expect(page.locator('.research-badge')).toContainText(APP_VERSION); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function importModel(page: Page, model: CalcModel) { await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm24.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) }); await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name); }
async function record(page: Page, model = signal()) { await importModel(page, model); await page.locator('.run-button').click(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과'); await expect(page.locator('.run-button')).toBeEnabled(); }
async function panel(page: Page): Promise<Locator> { await page.getByRole('button', { name: '분석', exact: true }).click(); await page.getByRole('dialog', { name: '수치 분석', exact: true }).locator('.time-series-analysis-section > summary').click(); return page.getByTestId('time-series-statistics-panel'); }
async function download<T>(page: Page, label: string): Promise<T> { const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click(); return JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as T; }
async function analyze<T>(page: Page, controls: Locator, correlation = false): Promise<T> { const button = controls.getByRole('button', { name: correlation ? '신호 상관 계산' : '구간 통계 계산', exact: true }); await button.click(); await expect(controls.getByRole('region', { name: '시계열 분석 결과', exact: true })).toBeVisible(); await expect(button).toBeEnabled(); return download<T>(page, '시계열 분석 JSON'); }
async function history(page: Page): Promise<HistoryRecord[]> { return page.evaluate(() => new Promise<HistoryRecord[]>((resolve, reject) => { const request = indexedDB.open('calcweave-m0', 1); request.onerror = () => reject(new Error('History open failed')); request.onsuccess = () => { const db = request.result, tx = db.transaction('models', 'readonly'), read = tx.objectStore('models').get('run-history-v1'); read.onsuccess = () => resolve(read.result ?? []); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('History read failed')); }; })); }
async function correlation(controls: Locator, y = 'scope-y', maxLag = 8, minOverlap = 16) { await controls.getByRole('button', { name: '신호 상관', exact: true }).click(); await controls.getByLabel('상관 Y 출력', { exact: true }).selectOption(y); await controls.getByLabel('상관 최대 지연', { exact: true }).fill(String(maxLag)); await controls.getByLabel('상관 최소 겹침', { exact: true }).fill(String(minOverlap)); }

test('M24 no completed time recording disables analysis without running the model', async ({ page }) => {
  await open(page); const controls = await panel(page); await expect(controls).toContainText('시간 시뮬레이션을 완료한 뒤'); await expect(controls.getByRole('button', { name: '구간 통계 계산', exact: true })).toBeDisabled(); await expect(controls.getByLabel('통계 X 출력', { exact: true })).toHaveCount(0); await expect(page.locator('.result-status')).toContainText('아직 계산하지');
});

test('M24 actual Worker recording yields analytic population and sample statistics and arbitrary selected counts', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await record(page); const original = await download<CalcModel>(page, '모델 다운로드'); await expect.poll(async () => (await history(page)).length).toBe(1); const recorded = (await history(page))[0], controls = await panel(page);
  await controls.getByLabel('통계 X 출력', { exact: true }).selectOption('scope-x'); const full = await analyze<StatisticsExport>(page, controls);
  expect(full).toMatchObject({ schemaVersion: 1, kind: 'recorded-time-series-statistics', engineVersion: ENGINE_VERSION, previousRun: false, options: { weighting: 'equal-samples' }, source: { outputId: 'scope-x', count: 64, startIndex: 0, sampleCount: 64 } }); expect(full.source.semanticHash).toBe(sha256(compileModel(original).semanticKey)); expect(full.source.samplesSha256).toBe(sha256(JSON.stringify(full.input)));
  expect(full.input.times).toEqual(recorded.result.samples.map(sample => sample.time)); expect(full.input.values).toEqual(recorded.result.samples.map(sample => sample.values['scope-x'])); expect(full.result.mean).toBeCloseTo(4, 12); expect(full.result.variancePopulation).toBeCloseTo(4.5, 12); expect(full.result.varianceSample).toBeCloseTo(4.5 * 64 / 63, 12); expect(full.result.rms).toBeCloseTo(Math.sqrt(20.5), 12); expect(full.result).toMatchObject({ count: 64, populationDivisor: 64, sampleDivisor: 63, weighting: 'equal-samples' }); await expect(controls).toContainText('시간 가중 평균');
  await controls.getByLabel('통계 시작 표본', { exact: true }).fill('7'); await controls.getByLabel('통계 표본 수', { exact: true }).fill('13'); const selected = await analyze<StatisticsExport>(page, controls), values = full.input.values.slice(7, 20), mean = values.reduce((a, b) => a + b, 0) / 13, squares = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  expect(selected.input.values).toEqual(values); expect(selected.input.times).toEqual(full.input.times.slice(7, 20)); expect(selected.source).toMatchObject({ startIndex: 7, count: 13, startTime: 7 / 64, endTime: 19 / 64 }); expect(selected.result.mean).toBeCloseTo(mean, 12); expect(selected.result.variancePopulation).toBeCloseTo(squares / 13, 12); expect(selected.result.varianceSample).toBeCloseTo(squares / 12, 12); expect(selected.result.min).toBe(Math.min(...values)); expect(selected.result.max).toBe(Math.max(...values));
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original); expect((await history(page))[0].result.samples).toEqual(recorded.result.samples); expect(errors).toEqual([]);
});

test('M24 actual delayed Worker signal preserves positive lag, per-overlap Pearson normalization and snapshot settings', async ({ page }) => {
  await open(page); await record(page); const controls = await panel(page); await controls.getByLabel('통계 X 출력', { exact: true }).selectOption('scope-x'); await correlation(controls); const report = await analyze<CorrelationExport>(page, controls, true);
  expect(report).toMatchObject({ kind: 'recorded-signal-correlation', engineVersion: ENGINE_VERSION, options: { maxLag: 8, minOverlap: 16, removeMean: true }, result: { demeaning: 'per-overlap', normalization: 'overlap-energy', lagConvention: 'positive-y-follows-x' } }); expect(report.result.peak).toMatchObject({ lag: 3, lagSeconds: 3 / 64, overlapCount: 61 }); expect(report.result.peak!.coefficient).toBeCloseTo(1, 14); expect(report.result.rows).toHaveLength(17);
  const row = report.result.rows.find(row => row.lag === 3)!, x = report.input.x.slice(0, 61), y = report.input.y.slice(3), mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length, numerator = x.reduce((a, b, i) => a + (b - mx) * (y[i] - my), 0), ex = x.reduce((a, b) => a + (b - mx) ** 2, 0), ey = y.reduce((a, b) => a + (b - my) ** 2, 0);
  expect(y).toEqual(x); expect(row).toMatchObject({ xStartIndex: 0, xEndIndex: 60, yStartIndex: 3, yEndIndex: 63, xStartTime: 0, yStartTime: 3 / 64, overlapCount: 61, reason: null }); expect(row.xMean).toBeCloseTo(mx, 12); expect(row.yMean).toBeCloseTo(my, 12); expect(row.numerator).toBeCloseTo(numerator, 10); expect(row.xEnergy).toBeCloseTo(ex, 10); expect(row.yEnergy).toBeCloseTo(ey, 10); expect(row.denominator).toBeCloseTo(Math.sqrt(ex * ey), 10); expect(row.coefficient).toBeCloseTo(numerator / Math.sqrt(ex * ey), 14); expect(report.xSource.samplesSha256).toBe(sha256(JSON.stringify({ times: report.input.times, values: report.input.x }))); expect(report.ySource.samplesSha256).toBe(sha256(JSON.stringify({ times: report.input.times, values: report.input.y })));
  await controls.locator('.time-series-details > summary').filter({ hasText: '지연별 원시 상관 표' }).click(); await expect(controls.getByRole('table', { name: '지연별 원시 상관', exact: true }).locator('tbody tr')).toHaveCount(17); await expect(controls.getByRole('img', { name: '신호 상관 그래프', exact: true })).toBeVisible(); await controls.getByLabel('상관 평균 제거', { exact: true }).uncheck(); await controls.getByLabel('상관 최대 지연', { exact: true }).fill('4'); expect(await download<CorrelationExport>(page, '시계열 분석 JSON')).toEqual(report);
});

test('M24 malformed draft preserves captured report and valid nonfinite selection clears it', async ({ page }) => {
  await open(page); await record(page, typedNonFinite()); const controls = await panel(page), report = await analyze<StatisticsExport>(page, controls); expect(report.source).toMatchObject({ valueType: 'typed', shape: [2], componentIndex: 0 }); expect(report.result.mean).toBe(1);
  for (const value of ['1', '9000', '<img src=x onerror=alert(1)>']) { await controls.getByLabel('통계 표본 수', { exact: true }).fill(value); await controls.getByRole('button', { name: '구간 통계 계산', exact: true }).click(); await expect(controls.getByRole('alert')).toBeVisible(); expect(await download<StatisticsExport>(page, '시계열 분석 JSON')).toEqual(report); }
  expect(await controls.locator('img').count()).toBe(0); await controls.getByLabel('통계 표본 수', { exact: true }).fill('64'); await controls.getByLabel('통계 X 성분', { exact: true }).selectOption('1'); await controls.getByRole('button', { name: '구간 통계 계산', exact: true }).click(); await expect(controls.getByRole('alert')).toContainText('비유한'); await expect(controls.getByRole('region', { name: '시계열 분석 결과', exact: true })).toHaveCount(0); await expect(controls.getByRole('button', { name: '시계열 분석 JSON', exact: true })).toHaveCount(0);
});

test('M24 constant energy and insufficient overlap are null while raw cosine remains defined', async ({ page }) => {
  await open(page); await record(page, constant()); const controls = await panel(page); await controls.getByLabel('통계 X 출력', { exact: true }).selectOption('scope-x'); const stats = await analyze<StatisticsExport>(page, controls); expect(stats.result).toMatchObject({ mean: 7, variancePopulation: 0, varianceSample: 0, rms: 7 }); await correlation(controls, 'scope-x', 3, 3); const report = await analyze<CorrelationExport>(page, controls, true); expect(report.result.peak).toBeNull(); expect(report.result.rows.map(row => row.reason)).toEqual(['insufficient-overlap', 'insufficient-overlap', 'zero-energy', 'zero-energy', 'zero-energy', 'insufficient-overlap', 'insufficient-overlap']); expect(report.result.rows.every(row => row.coefficient === null)).toBe(true); expect(await controls.locator('.time-series-point').count()).toBe(0); await controls.locator('.time-series-details > summary').filter({ hasText: '지연별 원시 상관 표' }).click(); await expect(controls.getByRole('table', { name: '지연별 원시 상관', exact: true })).toContainText('겹침 부족'); await expect(controls).toContainText('영 에너지'); await controls.getByLabel('상관 평균 제거', { exact: true }).uncheck(); const raw = await analyze<CorrelationExport>(page, controls, true); expect(raw.result.demeaning).toBe('none'); expect(raw.result.rows[3].coefficient).toBeCloseTo(1, 14); expect(raw.result.peak!.lag).toBe(0);
});

test('M24 typed negative zero survives JSON through explicit IEEE bits and distinct sample hash', async ({ page }) => {
  const model = typedNonFinite(); model.name = '음의 영 IEEE 기록'; model.nodes[0].parameters.value = { kind: 'typed', dtype: 'float64', shape: [], data: ['-0'] };
  await open(page); await record(page, model); const controls = await panel(page), report = await analyze<StatisticsExport>(page, controls);
  expect(report.samplesHashEncoding).toBe('json-finite-numbers-negative-zero-token-v1'); expect(report.inputFloat64Bits.values).toEqual(Array(64).fill('8000000000000000')); expect(report.inputFloat64Bits.times[0]).toBe('0000000000000000');
  expect(report.source.samplesSha256).toBe(sha256(JSON.stringify({ times: report.input.times, values: Array(64).fill('-0') })));
  const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, BigInt('0x' + report.inputFloat64Bits.values[0]), false); expect(Object.is(view.getFloat64(0, false), -0)).toBe(true);
});

test('M24 previous recording stays tied to its original model after a new draft is imported', async ({ page }) => {
  await open(page); await record(page); const original = await download<CalcModel>(page, '모델 다운로드'), changed = structuredClone(original); changed.name = '현재 초안은 다른 진폭'; changed.nodes[0].parameters.amplitude = 10; await importModel(page, changed); const controls = await panel(page); await expect(controls).toContainText('이전 실행의 기록입니다'); await controls.getByLabel('통계 X 출력', { exact: true }).selectOption('scope-x'); const report = await analyze<StatisticsExport>(page, controls); expect(report.previousRun).toBe(true); expect(report.source.modelName).toBe(original.name); expect(report.source.semanticHash).toBe(sha256(compileModel(original).semanticKey)); expect(report.result.variancePopulation).toBeCloseTo(4.5, 12); await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(changed);
});

test.describe('M24 delayed analysis import', () => {
  test.use({ serviceWorkers: 'block' });
  test('M24 closing a pending panel ignores the late core import and does not create a new run', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    await page.route('**/time-series-statistics-*.js', async route => { requested(); await held; await route.continue(); });
    await open(page); await record(page); const controls = await panel(page);
    const response = page.waitForResponse(response => /\/time-series-statistics-[^/]+\.js$/.test(response.url()));
    await controls.getByRole('button', { name: '구간 통계 계산', exact: true }).click(); await started;
    await expect(controls.getByLabel('통계 표본 수', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); release(); await response;
    const reopened = await panel(page); await expect(reopened.getByRole('region', { name: '시계열 분석 결과', exact: true })).toHaveCount(0);
    const report = await analyze<StatisticsExport>(page, reopened); expect(report.result.count).toBe(64); expect((await history(page)).length).toBe(1);
  });
});

test('M24 full lag table paginates 128 rows, display sampling preserves raw JSON and aggregate work rejects excess', async ({ page }) => {
  await open(page); await record(page, signal(1024)); const controls = await panel(page); await controls.getByLabel('통계 X 출력', { exact: true }).selectOption('scope-x'); await correlation(controls, 'scope-y', 256, 512); const full = await analyze<CorrelationExport>(page, controls, true); expect(full.result.rows).toHaveLength(513); expect(full.result.work).toBeLessThanOrEqual(20_000_000); const graph = controls.getByRole('img', { name: '신호 상관 그래프', exact: true }); await expect(graph).toHaveAttribute('data-display-count', '512');
  await controls.locator('.time-series-details > summary').filter({ hasText: '지연별 원시 상관 표' }).click(); const rows = controls.getByRole('table', { name: '지연별 원시 상관', exact: true }).locator('tbody tr'); await expect(rows).toHaveCount(128); await expect(rows.first().locator('td').first()).toHaveText('-256'); for (let i = 0; i < 4; i++) await controls.getByRole('button', { name: '상관 표 다음 페이지', exact: true }).click(); await expect(rows).toHaveCount(1); await expect(rows.first().locator('td').first()).toHaveText('256'); await expect(controls.getByRole('button', { name: '상관 표 다음 페이지', exact: true })).toBeDisabled(); expect(await download<CorrelationExport>(page, '시계열 분석 JSON')).toEqual(full);
  await controls.getByLabel('상관 최대 지연', { exact: true }).fill('512'); await controls.getByRole('button', { name: '신호 상관 계산', exact: true }).click(); await expect(controls.getByRole('alert')).toContainText('계산 상한'); await expect(controls.getByRole('region', { name: '시계열 분석 결과', exact: true })).toHaveCount(0);
});

test('M24 mobile themes and 200-percent text keep controls readable, HTML escaped and raw table internally scrolling', async ({ page }) => {
  test.setTimeout(90_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const model = signal(); model.name = '<img src=x onerror=alert(1)> 긴 구간 통계 출처 이름'; model.nodes[2].label = '길게 붙인 원래 기록 출력 이름'; await open(page); await record(page, model); await mkdir('.test-generated/m24-ui', { recursive: true }); const observations: object[] = [];
  for (const [width, theme, scale] of [[390, 'dark', 1], [390, 'light', 1], [320, 'dark', 2], [320, 'light', 2]] as const) {
    await page.setViewportSize({ width, height: 1000 }); const currentTheme = await page.locator('.app-shell').evaluate(element => element.classList.contains('light') ? 'light' : 'dark'); if (currentTheme !== theme) await page.getByRole('button', { name: theme === 'light' ? '라이트 테마로 변경' : '다크 테마로 변경', exact: true }).click(); const controls = await panel(page); await controls.getByLabel('통계 X 출력', { exact: true }).selectOption('scope-x'); await correlation(controls); await analyze<CorrelationExport>(page, controls, true);
    await page.evaluate(scale => { const sizes = [...document.querySelectorAll<HTMLElement>('.time-series-panel,.time-series-panel *')].map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) })); document.documentElement.style.fontSize = `${16 * scale}px`; for (const { element, size } of sizes) element.style.fontSize = `${size * scale}px`; }, scale);
    await controls.locator('.time-series-details > summary').filter({ hasText: '지연별 원시 상관 표' }).click(); await controls.getByRole('region', { name: '시계열 분석 결과', exact: true }).scrollIntoViewIfNeeded(); const dimensions = await page.evaluate(() => { const panel = document.querySelector<HTMLElement>('[data-testid=time-series-statistics-panel]')!, fields = [...panel.querySelectorAll<HTMLElement>('input,select,button')], table = panel.querySelector<HTMLElement>('.time-series-table-scroll')!; return { viewport: innerWidth, page: document.documentElement.scrollWidth, panel: panel.scrollWidth, client: panel.clientWidth, minimumFieldFont: Math.min(...fields.map(element => Number.parseFloat(getComputedStyle(element).fontSize))), table: table.scrollWidth, tableClient: table.clientWidth }; });
    const minimumParagraphFont = await controls.locator('p').evaluateAll(elements => Math.min(...elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize))));
    expect(dimensions.page, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1); expect(dimensions.panel, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.client + 1); expect(dimensions.minimumFieldFont).toBeGreaterThanOrEqual(16 * scale); expect(minimumParagraphFont).toBeGreaterThanOrEqual(16 * scale); expect(dimensions.table).toBeGreaterThan(dimensions.tableClient); expect(await controls.locator('img').count()).toBe(0); observations.push({ width, theme, scale, ...dimensions, minimumParagraphFont }); await page.screenshot({ path: `.test-generated/m24-ui/statistics-${width}-${theme}-${scale}x.png` }); await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  }
  expect(errors).toEqual([]); await writeFile('.test-generated/m24-ui/observations.json', JSON.stringify({ appVersion: APP_VERSION, observations, pageErrors: errors }, null, 2) + '\n');
});
