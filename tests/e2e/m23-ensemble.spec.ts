import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { ENGINE_VERSION, type CalcModel } from '../../packages/model/src';
import { compileModel } from '../../packages/compiler/src';
import { sha256 } from '../../packages/model/src/sha256';
import { APP_VERSION } from '../../packages/release/src';
import type { EnsembleResult } from '../../packages/experiments/src/uncertainty';

type Report = { schemaVersion: number; kind: string; engineVersion: string; result: EnsembleResult };
// Independently calculated LCG states for seed 1, converted with the specified open-interval convention.
const uniforms = [1015568748.5, 1586005467.5, 2165703038.5, 3027450565.5, 217083232.5, 1587069247.5, 3327581586.5, 2388811721.5, 70837908.5, 2745540835.5, 1075679462.5, 1814098701.5].map(state => state / 4294967296);

function affine(): CalcModel {
  return { schemaVersion: 1, modelId: 'm23-affine', name: '불확실한 두 계수의 직선',
    execution: { mode: 'discrete', startTime: 0, stopTime: 4, step: 1 },
    nodes: [
      { id: 'clock', blockType: 'source.clock', blockVersion: 1, label: '시각', parameters: {}, unit: 's' },
      { id: 'a', blockType: 'math.gain', blockVersion: 1, label: '기울기', parameters: { gain: 1 } },
      { id: 'b', blockType: 'source.constant', blockVersion: 1, label: '절편', parameters: { value: 0 }, unit: 's' },
      { id: 'sum', blockType: 'math.sum', blockVersion: 1, label: '합', parameters: {} },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '직선 관측', parameters: {} },
    ], edges: [
      { id: 'clock-a', source: { nodeId: 'clock', portId: 'out' }, target: { nodeId: 'a', portId: 'in' } },
      { id: 'a-sum', source: { nodeId: 'a', portId: 'out' }, target: { nodeId: 'sum', portId: 'a' } },
      { id: 'b-sum', source: { nodeId: 'b', portId: 'out' }, target: { nodeId: 'sum', portId: 'b' } },
      { id: 'sum-scope', source: { nodeId: 'sum', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } },
    ], layout: { clock: { x: 20, y: 70 }, a: { x: 200, y: 70 }, b: { x: 200, y: 210 }, sum: { x: 380, y: 70 }, scope: { x: 560, y: 70 } },
  };
}
function squareRoot(): CalcModel {
  return { schemaVersion: 1, modelId: 'm23-square-root', name: '실패한 표본을 포함하는 제곱근',
    execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 },
    nodes: [
      { id: 'input', blockType: 'source.constant', blockVersion: 1, label: '불확실한 입력', parameters: { value: 1 } },
      { id: 'sqrt', blockType: 'math.sqrt', blockVersion: 1, label: '제곱근', parameters: {} },
      { id: 'scope', blockType: 'sink.display', blockVersion: 1, label: '값', parameters: {} },
    ], edges: [
      { id: 'input-sqrt', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'sqrt', portId: 'in' } },
      { id: 'sqrt-scope', source: { nodeId: 'sqrt', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } },
    ], layout: { input: { x: 30, y: 90 }, sqrt: { x: 230, y: 90 }, scope: { x: 430, y: 90 } },
  };
}
async function importModel(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm23.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name);
}
async function open(page: Page, model = affine()): Promise<Locator> {
  await page.goto('./'); await expect(page.locator('.research-badge')).toContainText(APP_VERSION);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await importModel(page, model);
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  const section = page.getByTestId('ensemble-section'); await section.locator(':scope > summary').click(); return section;
}
async function download<T>(page: Page, label: string): Promise<T> {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click();
  return JSON.parse(await readFile((await (await event).path())!, 'utf8')) as T;
}
async function parameter(section: Locator, index: number, node: string, lower: number, upper: number, mode?: number) {
  await section.getByLabel(`앙상블 블록 ${index}`, { exact: true }).selectOption(node);
  await section.getByLabel(`앙상블 분포 ${index}`, { exact: true }).selectOption(mode === undefined ? 'uniform' : 'triangular');
  await section.getByLabel(`앙상블 하한 ${index}`, { exact: true }).fill(String(lower));
  await section.getByLabel(`앙상블 상한 ${index}`, { exact: true }).fill(String(upper));
  if (mode !== undefined) await section.getByLabel(`앙상블 최빈값 ${index}`, { exact: true }).fill(String(mode));
}
async function configure(section: Locator, count = 4, seed = 1) {
  await parameter(section, 1, 'a', 0, 4);
  await section.getByRole('button', { name: '앙상블 파라미터 추가', exact: true }).click(); await parameter(section, 2, 'b', -2, 2);
  await section.getByLabel('앙상블 출력', { exact: true }).selectOption('scope');
  await section.getByLabel('앙상블 표본 수', { exact: true }).fill(String(count));
  await section.getByLabel('앙상블 seed', { exact: true }).fill(String(seed));
}
async function finish(page: Page, section: Locator): Promise<Report> {
  test.setTimeout(60_000);
  await section.getByRole('button', { name: '앙상블 실행', exact: true }).click();
  await expect(section.getByRole('region', { name: '불확실성 앙상블 결과', exact: true })).toBeVisible({ timeout: 35_000 });
  await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeEnabled({ timeout: 35_000 });
  await openDetails(section, /^모든 표본 ·/);
  return download<Report>(page, '앙상블 보고서 JSON');
}
async function openDetails(section: Locator, pattern: RegExp) {
  const summary = section.locator('summary').filter({ hasText: pattern });
  if (!await summary.evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await summary.click();
}
function oracle(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const q = (probability: number) => { const position = probability * (sorted.length - 1), lower = Math.floor(position), weight = position - lower; return sorted[lower]! * (1 - weight) + sorted[Math.min(lower + 1, sorted.length - 1)]! * weight; };
  return { mean, standardDeviation: values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : null, minimum: sorted[0]!, maximum: sorted.at(-1)!, q05: q(.05), median: q(.5), q95: q(.95) };
}

test('M23 actual Worker uniform ensemble reproduces independent affine samples and point statistics without editing the model', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const section = await open(page); const original = await download<CalcModel>(page, '모델 다운로드'); await configure(section);
  const { result: report, ...wrapper } = await finish(page, section);
  expect(wrapper).toEqual({ schemaVersion: 1, kind: 'uncertainty-ensemble', engineVersion: ENGINE_VERSION });
  expect(report.baseModel).toEqual(compileModel(original).model); expect(report.baseSemanticHash).toBe(sha256(compileModel(original).semanticKey));
  expect(report.counts).toEqual({ requested: 4, attempted: 4, completed: 4, failed: 0, cancelled: 0, notStarted: 0 });
  expect(report.prng).toEqual({ algorithm: 'lcg32-1664525-1013904223', drawOrder: 'sample-then-parameter', uniform: '(state+0.5)/2^32' });
  expect(report.spec).toMatchObject({ seed: 1, sampleCount: 4, outputId: 'scope', unit: 's' });
  expect(report.statistics).toMatchObject({ status: 'completed', unit: 's', standardDeviationConvention: 'sample-n-minus-one', quantileConvention: 'linear-n-minus-one', recordIds: ['sample1', 'sample2', 'sample3', 'sample4'] });
  const coefficients = Array.from({ length: 4 }, (_, index) => ({ a: 4 * uniforms[index * 2]!, b: -2 + 4 * uniforms[index * 2 + 1]! }));
  for (const [index, record] of report.records.entries()) {
    expect(record.status).toBe('completed'); expect(record.parameters[0]!.value).toBeCloseTo(coefficients[index]!.a, 12); expect(record.parameters[1]!.value).toBeCloseTo(coefficients[index]!.b, 12);
    expect(record.run!.modelHash).toBe(sha256(compileModel(record.run!.model).semanticKey)); expect(record.run!.result.resources!.operations).toBeGreaterThan(0);
    for (const sample of record.run!.result.samples) expect(sample.values.scope).toBeCloseTo(coefficients[index]!.a * sample.time + coefficients[index]!.b, 11);
  }
  expect(report.statistics.points).toHaveLength(5);
  for (const point of report.statistics.points) {
    expect(point.count).toBe(4); const expected = oracle(coefficients.map(coefficient => coefficient.a * point.time + coefficient.b));
    for (const field of ['mean', 'standardDeviation', 'minimum', 'maximum', 'q05', 'median', 'q95'] as const) expect(point[field]).toBeCloseTo(expected[field]!, 10);
  }
  expect(report.resources.operations).toBe(report.records.reduce((sum, record) => sum + record.run!.result.resources!.operations, 0));
  expect(report.resources.recordedValues).toBe(40); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original); expect(errors).toEqual([]);
});

test('M23 repeating the captured seed reproduces raw samples and statistics while a different seed changes the plan', async ({ page }) => {
  const section = await open(page); await configure(section);
  const first = (await finish(page, section)).result, repeated = (await finish(page, section)).result;
  expect(repeated.records.map(record => record.parameters)).toEqual(first.records.map(record => record.parameters));
  expect(repeated.records.map(record => record.run!.result.samples)).toEqual(first.records.map(record => record.run!.result.samples)); expect(repeated.statistics).toEqual(first.statistics);
  await section.getByLabel('앙상블 seed', { exact: true }).fill('2'); const changed = (await finish(page, section)).result;
  expect(changed.records.map(record => record.parameters)).not.toEqual(first.records.map(record => record.parameters)); expect(changed.statistics.points).not.toEqual(first.statistics.points);
});

test('M23 three-parameter uniform and triangular draws preserve their specified bounds and the analytic transformed output', async ({ page }) => {
  const model = affine(); model.nodes.push({ id: 'c', blockType: 'math.gain', blockVersion: 1, label: '세 번째 계수', parameters: { gain: 1 } });
  model.edges = model.edges.filter(edge => edge.id !== 'sum-scope'); model.edges.push({ id: 'sum-c', source: { nodeId: 'sum', portId: 'out' }, target: { nodeId: 'c', portId: 'in' } }, { id: 'c-scope', source: { nodeId: 'c', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }); model.layout.c = { x: 470, y: 70 };
  const section = await open(page, model); await configure(section); await parameter(section, 2, 'b', -2, 2, 0);
  await section.getByRole('button', { name: '앙상블 파라미터 추가', exact: true }).click(); await parameter(section, 3, 'c', .5, 2, 1);
  const { result: report } = await finish(page, section);
  const triangular = (u: number, lower: number, mode: number, upper: number) => u < (mode - lower) / (upper - lower) ? lower + Math.sqrt(u * (upper - lower) * (mode - lower)) : upper - Math.sqrt((1 - u) * (upper - lower) * (upper - mode));
  for (const [index, record] of report.records.entries()) {
    const a = 4 * uniforms[index * 3]!, b = triangular(uniforms[index * 3 + 1]!, -2, 0, 2), c = triangular(uniforms[index * 3 + 2]!, .5, 1, 2);
    expect(record.parameters.map(item => item.value)).toEqual([a, b, c]);
    expect(b).toBeGreaterThanOrEqual(-2); expect(b).toBeLessThanOrEqual(2); expect(c).toBeGreaterThanOrEqual(.5); expect(c).toBeLessThanOrEqual(2);
    for (const point of record.run!.result.samples) expect(point.values.scope).toBeCloseTo((a * point.time + b) * c, 10);
  }
  expect(report.spec.parameters[1]!.distribution).toEqual({ kind: 'triangular', lower: -2, upper: 2, mode: 0 });
});

test('M23 failed negative square-root samples stay visible, consume the shared budget and never enter the completed-only statistics', async ({ page }) => {
  const section = await open(page, squareRoot()); await parameter(section, 1, 'input', -1, 1);
  await section.getByLabel('앙상블 seed', { exact: true }).fill('1'); await section.getByLabel('앙상블 표본 수', { exact: true }).fill('4'); await section.getByLabel('앙상블 출력', { exact: true }).selectOption('scope');
  const { result: report } = await finish(page, section);
  expect(report.status).toBe('failed'); expect(report.statistics.status).toBe('completed');
  expect(report.counts).toEqual({ requested: 4, attempted: 4, completed: 2, failed: 2, cancelled: 0, notStarted: 0 }); expect(report.records.map(record => record.status)).toEqual(['failed', 'failed', 'completed', 'completed']);
  for (const failed of report.records.slice(0, 2)) { expect(failed.run!.result.status).toBe('failed'); expect(failed.run!.result.samples).toEqual([]); expect(failed.run!.result.resources!.operations).toBeGreaterThan(0); expect(failed.diagnostics.length).toBeGreaterThan(0); }
  expect(report.statistics.recordIds).toEqual(['sample3', 'sample4']); const expected = oracle([Math.sqrt(2 * uniforms[2]! - 1), Math.sqrt(2 * uniforms[3]! - 1)]);
  for (const field of ['mean', 'standardDeviation', 'minimum', 'maximum', 'q05', 'median', 'q95'] as const) expect(report.statistics.points[0]![field]).toBeCloseTo(expected[field]!, 12);
  expect(report.resources.operations).toBe(report.records.reduce((sum, record) => sum + record.run!.result.resources!.operations, 0)); expect(report.resources.recordedValues).toBe(4);
  await expect(section.getByRole('table', { name: '앙상블 표본별 결과', exact: true }).locator('tbody tr')).toHaveCount(4);
  await expect(section.getByRole('button', { name: '앙상블 표본 1 모델 적용', exact: true })).toBeDisabled(); await expect(section.getByRole('button', { name: '앙상블 표본 3 모델 적용', exact: true })).toBeEnabled();
  await section.getByLabel('앙상블 표본 수', { exact: true }).fill('3'); const single = (await finish(page, section)).result;
  expect(single.counts.completed).toBe(1); expect(single.statistics.points[0]).toMatchObject({ count: 1, standardDeviation: null }); expect(single.statistics.points[0]!.mean).toBeCloseTo(Math.sqrt(2 * uniforms[2]! - 1), 12);
});

test('M23 report export retains its captured inputs after edits and invalid seed, sample counts and distributions cannot replace it', async ({ page }) => {
  const section = await open(page); await configure(section); const original = await finish(page, section);
  await section.getByLabel('앙상블 seed', { exact: true }).fill('2'); await parameter(section, 1, 'a', -5, 7, 1);
  expect(await download<Report>(page, '앙상블 보고서 JSON')).toEqual(original);
  for (const invalidSeed of ['1.5', '-1', '4294967296', '<img src=x onerror=alert(1)>']) {
    await section.getByLabel('앙상블 seed', { exact: true }).fill(invalidSeed); await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeDisabled();
    expect(await download<Report>(page, '앙상블 보고서 JSON')).toEqual(original);
  }
  await section.getByLabel('앙상블 seed', { exact: true }).fill('1');
  for (const count of ['1', '65', '2.5', '']) { await section.getByLabel('앙상블 표본 수', { exact: true }).fill(count); await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeDisabled(); }
  await section.getByLabel('앙상블 표본 수', { exact: true }).fill('4'); await parameter(section, 1, 'a', 4, 1);
  await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeDisabled();
  await parameter(section, 1, 'a', 0, 4, 9); await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeDisabled();
  await parameter(section, 1, 'a', 0, 4); await section.getByLabel('앙상블 출력 단위', { exact: true }).fill('m'); await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeDisabled();
  expect(await download<Report>(page, '앙상블 보고서 JSON')).toEqual(original); expect(await section.locator('img').count()).toBe(0);
});

test('M23 model changes require an explicit completed sample apply, support undo and disable stale candidates', async ({ page }) => {
  const section = await open(page); const original = await download<CalcModel>(page, '모델 다운로드'); await configure(section); const report = await finish(page, section);
  expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
  await section.getByRole('button', { name: '앙상블 표본 1 모델 적용', exact: true }).click();
  const applied = await download<CalcModel>(page, '모델 다운로드');
  for (const sampled of report.result.records[0]!.parameters) expect(applied.nodes.find(node => node.id === sampled.nodeId)!.parameters[sampled.parameter]).toBe(sampled.value);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
  const changed = affine(); changed.nodes.find(node => node.id === 'a')!.parameters.gain = 1.5; await importModel(page, changed);
  await page.getByRole('tab', { name: '실험', exact: true }).click(); const current = page.getByTestId('ensemble-section'); await current.locator(':scope > summary').click();
  await openDetails(current, /^모든 표본 ·/);
  await expect(current.getByRole('button', { name: '앙상블 표본 1 모델 적용', exact: true })).toBeDisabled(); expect(await download<Report>(page, '앙상블 보고서 JSON')).toEqual(report);
  expect((await download<CalcModel>(page, '모델 다운로드')).nodes.find(node => node.id === 'a')!.parameters.gain).toBe(1.5);
});

test('M23 boolean, vector and explicit typed outputs cannot be silently aggregated as real scalar outputs', async ({ page }) => {
  for (const value of [true, [1, 2], { kind: 'typed', dtype: 'float64', shape: [], data: [1] }]) {
    const model: CalcModel = { schemaVersion: 1, modelId: 'm23-unsupported', name: '집계할 수 없는 출력', execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 },
      nodes: [{ id: 'a', blockType: 'source.constant', blockVersion: 1, label: '지원 숫자 계수', parameters: { value: 1 } },
        { id: 'unsupported', blockType: typeof value === 'object' && !Array.isArray(value) ? 'source.typed' : 'source.constant', blockVersion: 1, label: '비지원 출력 입력', parameters: { value } },
        { id: 'scope', blockType: 'sink.display', blockVersion: 1, label: '비지원 출력', parameters: {} }],
      edges: [{ id: 'unsupported-scope', source: { nodeId: 'unsupported', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }], layout: { a: { x: 20, y: 200 }, unsupported: { x: 20, y: 70 }, scope: { x: 280, y: 70 } } };
    const section = await open(page, model);
    await expect(section.getByLabel('앙상블 출력', { exact: true }).locator('option[value="scope"]')).toHaveCount(0);
    await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeDisabled(); await expect(section.getByRole('region', { name: '불확실성 앙상블 결과', exact: true })).toHaveCount(0);
  }
});

test('M23 cancellation preserves completed work, reports cancelled and unstarted samples, and ignores a queued late actual Worker result', async ({ page }) => {
  await page.addInitScript(() => {
    const native = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')!;
    Reflect.set(window, 'm23ActualResults', 0); Reflect.set(window, 'm23LateDeliveries', 0);
    Object.defineProperty(Worker.prototype, 'onmessage', { configurable: native.configurable, enumerable: native.enumerable, get: native.get,
      set(handler) { native.set!.call(this, typeof handler !== 'function' ? handler : (event: MessageEvent) => {
        if (event.data.type !== 'result') { handler.call(this, event); return; }
        const count = Reflect.get(window, 'm23ActualResults') + 1; Reflect.set(window, 'm23ActualResults', count);
        if (count === 1) { handler.call(this, event); return; }
        // Keep one queued handler after termination to exercise the request/sequence guard with an actual completed result.
        window.setTimeout(() => { Reflect.set(window, 'm23LateDeliveries', Reflect.get(window, 'm23LateDeliveries') + 1); handler.call(this, event); }, 1200);
      }); },
    });
  });
  const model = affine(); model.execution.stopTime = 3000;
  const section = await open(page, model); const original = await download<CalcModel>(page, '모델 다운로드'); await configure(section, 64);
  await section.getByRole('button', { name: '앙상블 실행', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'm23ActualResults')), { timeout: 15_000 }).toBe(2);
  await section.getByRole('button', { name: '앙상블 취소', exact: true }).click();
  await expect(section.getByRole('button', { name: '앙상블 실행', exact: true })).toBeEnabled();
  const captured = await download<Report>(page, '앙상블 보고서 JSON'); expect(captured.result.status).toBe('cancelled');
  expect(captured.result.counts).toEqual({ requested: 64, attempted: 2, completed: 1, failed: 0, cancelled: 1, notStarted: 62 });
  expect(captured.result.records[0]!.status).toBe('completed'); expect(captured.result.records[1]!.status).toBe('cancelled'); expect(captured.result.records.slice(2).every(record => record.status === 'not-started')).toBe(true);
  // Cancellation stops additional numerical work; the first completed raw run remains available in the report.
  expect(captured.result.statistics).toMatchObject({ status: 'unavailable', recordIds: [], points: [] }); expect(captured.result.records[0]!.run!.result.samples).toHaveLength(3001);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'm23LateDeliveries'))).toBe(1);
  expect(await download<Report>(page, '앙상블 보고서 JSON')).toEqual(captured); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
  await page.getByRole('button', { name: '실행 초기화', exact: true }).click(); await expect(section.getByRole('region', { name: '불확실성 앙상블 결과', exact: true })).toHaveCount(0);
});

test('M23 long escaped labels, paged results and all panel text fit narrow themes at 200 percent text size', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const model = affine(); model.nodes.find(node => node.id === 'a')!.label = '<img src=x onerror=alert(1)> 긴 파라미터 이름 '.repeat(3).slice(0, 100);
  model.execution.stopTime = 140;
  const section = await open(page, model); await configure(section, 24); const report = await finish(page, section);
  expect(report.result.records).toHaveLength(24); await expect(section.locator('img')).toHaveCount(0);
  await openDetails(section, /^원시 통계 표 ·/); const statistics = section.getByRole('table', { name: '앙상블 원시 통계', exact: true });
  await expect(statistics.locator('tbody tr')).toHaveCount(128); await expect(statistics.locator('tbody tr').first().locator('td').first()).toHaveText('0');
  await section.getByRole('button', { name: '앙상블 통계 표 다음 페이지', exact: true }).click(); await expect(statistics.locator('tbody tr')).toHaveCount(13);
  await expect(statistics.locator('tbody tr').first().locator('td').first()).toHaveText('128'); await expect(statistics.locator('tbody tr').last().locator('td').first()).toHaveText('140');
  await expect(section.getByRole('button', { name: '앙상블 통계 표 다음 페이지', exact: true })).toBeDisabled(); await section.getByRole('button', { name: '앙상블 통계 표 이전 페이지', exact: true }).click();
  await expect(statistics.locator('tbody tr')).toHaveCount(128);
  await mkdir('.test-generated/m23-ui', { recursive: true });
  for (const [width, theme, scale] of [[1440, 'dark', 1], [390, 'light', 1], [320, 'dark', 2]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    const current = await page.locator('.app-shell').evaluate(el => el.classList.contains('light') ? 'light' : 'dark');
    if (current !== theme) await page.getByRole('button', { name: theme === 'light' ? '라이트 테마로 변경' : '다크 테마로 변경', exact: true }).click();
    if (scale === 2) await section.evaluate(el => {
      const elements = [el as HTMLElement, ...el.querySelectorAll<HTMLElement>('*')], originals = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize));
      document.documentElement.style.fontSize = '32px'; elements.forEach((element, index) => { element.style.fontSize = `${originals[index]! * 2}px`; });
    });
    await section.getByRole('table', { name: '앙상블 표본별 결과', exact: true }).scrollIntoViewIfNeeded();
    const dimensions = await section.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth })); expect(dimensions.scroll, JSON.stringify({ width, theme, scale, ...dimensions })).toBeLessThanOrEqual(dimensions.client + 1);
    const pageWidth = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth })); expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.viewport + 1);
    await page.screenshot({ path: `.test-generated/m23-ui/ensemble-${width}-${theme}.png` });
  }
  expect(errors).toEqual([]);
});

test('M23 live dashboard edits are rejected during an ensemble and actual Worker samples keep the captured model provenance', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const NativeWorker = Worker; let pause = true;
    class ObservedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.addEventListener('message', event => {
          if (pause && event.data.type === 'progress') {
            pause = false; const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '일시정지');
            if (!button) throw new Error('Actual ensemble pause control is missing'); button.click();
          }
        });
      }
    }
    Reflect.set(window, 'Worker', ObservedWorker);
  });
  const model: CalcModel = { schemaVersion: 1, modelId: 'm23-live-dashboard', name: '앙상블의 대시보드 입력 경계', execution: { mode: 'discrete', startTime: 0, stopTime: 2000, step: 1 },
    nodes: [{ id: 'control', blockType: 'dashboard.control', blockVersion: 1, label: '실시간', parameters: { kind: 'edit', initial: 1, min: 0, max: 10, events: '[]' } },
      { id: 'a', blockType: 'math.gain', blockVersion: 1, label: '불확실한 배율', parameters: { gain: 1 } },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '관측', parameters: {} }],
    edges: [{ id: 'control-a', source: { nodeId: 'control', portId: 'out' }, target: { nodeId: 'a', portId: 'in' } }], layout: {} };
  let previous = 'a';
  for (let index = 0; index < 100; index += 1) {
    const id = `cost-${index}`; model.nodes.push({ id, blockType: 'math.gain', blockVersion: 1, label: '고정 배율', parameters: { gain: 1 } });
    model.edges.push({ id: `cost-wire-${index}`, source: { nodeId: previous, portId: 'out' }, target: { nodeId: id, portId: 'in' } }); previous = id;
  }
  model.edges.push({ id: 'to-scope', source: { nodeId: previous, portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } });
  const section = await open(page, model); const original = await download<CalcModel>(page, '모델 다운로드'); await parameter(section, 1, 'a', 0, 4);
  await section.getByLabel('앙상블 seed', { exact: true }).fill('1'); await section.getByLabel('앙상블 표본 수', { exact: true }).fill('2'); await section.getByLabel('앙상블 출력', { exact: true }).selectOption('scope');
  await section.getByRole('button', { name: '앙상블 실행', exact: true }).click(); await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: '대시보드', exact: true }).click(); const value = page.getByLabel('실시간 값', { exact: true }); await value.fill('3'); await value.blur();
  await expect(page.locator('.m13-dashboard').getByRole('alert')).toContainText('전달하지 못했습니다');
  await page.getByRole('button', { name: '재개', exact: true }).click(); await page.getByRole('tab', { name: '실험', exact: true }).click();
  const current = page.getByTestId('ensemble-section'); await current.locator(':scope > summary').click();
  await expect(current.getByRole('button', { name: '앙상블 실행', exact: true })).toBeEnabled({ timeout: 30_000 }); const { result: report } = await download<Report>(page, '앙상블 보고서 JSON');
  expect(report.status).toBe('completed'); expect(report.counts.completed).toBe(2);
  for (const record of report.records) {
    const gain = record.parameters[0]!.value; expect(record.run!.modelHash).toBe(sha256(compileModel(record.run!.model).semanticKey));
    expect(record.run!.model.nodes.find(node => node.id === 'control')!.parameters.events).toBe('[]');
    expect(record.run!.result.samples.every(sample => sample.values.scope === gain && sample.values.control === 1)).toBe(true);
  }
  expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
});

test('M23 a mismatched semantic hash on an actual Worker result stops the plan without admitting fabricated provenance', async ({ page }) => {
  await page.addInitScript(() => {
    const native = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')!;
    Object.defineProperty(Worker.prototype, 'onmessage', { configurable: native.configurable, enumerable: native.enumerable, get: native.get,
      set(handler) { native.set!.call(this, typeof handler !== 'function' ? handler : (event: MessageEvent) => {
        if (event.data.type !== 'result') { handler.call(this, event); return; }
        handler.call(this, new MessageEvent('message', { data: { ...event.data, semanticHash: '0'.repeat(64) } }));
      }); },
    });
  });
  const section = await open(page); const original = await download<CalcModel>(page, '모델 다운로드'); await configure(section); const { result: report } = await finish(page, section);
  expect(report.status).toBe('failed'); expect(report.counts).toEqual({ requested: 4, attempted: 1, completed: 0, failed: 1, cancelled: 0, notStarted: 3 });
  expect(report.records[0]!.run).toBeUndefined(); expect(report.records[0]!.diagnostics[0]!.code).toBe('ENSEMBLE_WORKER_PROVENANCE');
  expect(report.records.slice(1).every(record => record.status === 'not-started')).toBe(true); expect(report.statistics).toMatchObject({ status: 'unavailable', recordIds: [], points: [] });
  expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
});
