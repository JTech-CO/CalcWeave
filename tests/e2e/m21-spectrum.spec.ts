import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import type { CalcModel } from '../../packages/model/src';
import { ENGINE_VERSION } from '../../packages/model/src';
import { sha256 } from '../../packages/model/src/sha256';
import { compileModel } from '../../packages/compiler/src';
import type { SpectrumOptions, SpectrumReport } from '../../packages/analysis/src/spectrum';
import type { SpectrumSourceSnapshot } from '../../apps/web/src/spectrum-analysis-sources';
import { APP_VERSION } from '../../packages/release/src';
import type { HistoryRecord } from '../../apps/web/src/run-history';

type ExportedReport = { schemaVersion: number; kind: string; engineVersion: string; source: SpectrumSourceSnapshot; options: SpectrumOptions; result: SpectrumReport };
function sine(count = 64): CalcModel {
  return { schemaVersion: 1, modelId: 'm21-recorded-sine', name: '실행된 8 Hz 사인',
    execution: { mode: 'discrete', startTime: 0, stopTime: (count - 1) / count, step: 1 / count },
    nodes: [{ id: 'input', blockType: 'source.signal-generator', blockVersion: 1, label: '사인 신호', parameters: { waveform: 'sine', amplitude: 3, frequency: 8, frequencyUnit: 'Hz', phase: Math.PI / 4, bias: 4, seed: 1 } },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '실수 기록', parameters: {} }],
    edges: [{ id: 'input-scope', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }],
    layout: { input: { x: 40, y: 100 }, scope: { x: 350, y: 100 } } };
}
function typedNonFinite(): CalcModel {
  const model = sine(); model.modelId = 'm21-recorded-typed'; model.name = '유한 성분과 비유한 성분';
  model.nodes[0].blockType = 'source.typed'; model.nodes[0].parameters = { value: { kind: 'typed', dtype: 'float64', shape: [2], data: [1, 'NaN'] } }; return model;
}
async function open(page: Page) {
  await page.goto('./'); await expect(page.locator('.research-badge')).toContainText(APP_VERSION);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function importModel(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm21.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name);
}
async function record(page: Page, model = sine()) {
  await importModel(page, model); await page.locator('.run-button').click();
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  await expect(page.locator('.run-button')).toBeEnabled();
}
async function panel(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '분석', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '수치 분석', exact: true });
  await dialog.locator('.spectrum-analysis-section > summary').click(); return page.getByTestId('spectrum-panel');
}
async function download<T>(page: Page, label: string): Promise<T> {
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as T;
}
async function analyze(page: Page, controls: Locator): Promise<ExportedReport> {
  await controls.getByRole('button', { name: '스펙트럼 계산', exact: true }).click();
  await expect(controls.getByRole('region', { name: '스펙트럼 분석 결과', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: '스펙트럼 계산', exact: true })).toBeEnabled();
  return download<ExportedReport>(page, '스펙트럼 JSON');
}
async function rectangular(controls: Locator) { await controls.getByLabel('스펙트럼 창 함수', { exact: true }).selectOption('rectangular'); }
async function history(page: Page): Promise<HistoryRecord[]> {
  return page.evaluate(() => new Promise<HistoryRecord[]>((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onerror = () => reject(new Error('History open failed'));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('models', 'readonly'), read = tx.objectStore('models').get('run-history-v1');
      read.onsuccess = () => resolve(read.result ?? []); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('History read failed'));
    };
  }));
}

test('M21 no completed time recording explains the source requirement without launching a simulation', async ({ page }) => {
  await open(page); const controls = await panel(page);
  await expect(controls).toContainText('시간 시뮬레이션을 완료한 뒤');
  await expect(controls.getByRole('button', { name: '스펙트럼 계산', exact: true })).toBeDisabled();
  await expect(controls.getByLabel('스펙트럼 출력', { exact: true })).toHaveCount(0);
  await expect(controls.getByRole('region', { name: '스펙트럼 분석 결과', exact: true })).toHaveCount(0);
  await expect(page.locator('.result-status')).toContainText('아직 계산하지');
});

test('M21 actual Worker sine produces analytic FFT amplitude, PSD and raw complex bins without editing the model', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await record(page); const original = await download<CalcModel>(page, '모델 다운로드');
  await expect.poll(async () => (await history(page)).length).toBe(1);
  const recorded = (await history(page))[0]!, controls = await panel(page);
  await rectangular(controls); const report = await analyze(page, controls), bin = report.result.bins[8];
  expect(report).toMatchObject({ schemaVersion: 1, kind: 'recorded-signal-spectrum', engineVersion: ENGINE_VERSION, options: { window: 'rectangular', removeMean: true } });
  expect(report.source).toMatchObject({ outputId: 'scope', componentIndex: 0, startIndex: 0, count: 64, sampleCount: 64, runStatus: 'completed', modelId: original.modelId, modelName: original.name });
  expect(report.source.semanticHash).toBe(sha256(compileModel(original).semanticKey));
  // A checksum compares actual recorded bytes; analytic sine arithmetic may differ by an IEEE ulp.
  const input = { times: recorded.result.samples.map(sample => sample.time), values: recorded.result.samples.map(sample => sample.values.scope) };
  input.values.forEach((value, index) => expect(value).toBeCloseTo(3 * Math.sin(2 * Math.PI * 8 * index / 64 + Math.PI / 4) + 4, 10));
  expect(report.source.samplesSha256).toBe(sha256(JSON.stringify(input)));
  expect(report.result.sampleRate).toBe(64); expect(report.result.frequencyResolution).toBe(1); expect(report.result.nyquist).toBe(32); expect(report.result.bins).toHaveLength(33);
  expect(report.result.mean).toBeCloseTo(4, 12); expect(report.result.rms).toBeCloseTo(Math.sqrt(20.5), 12); expect(report.result.integratedPower).toBeCloseTo(4.5, 12);
  expect(report.result.peak!.frequency).toBeCloseTo(8, 12); expect(report.result.peak!.amplitude).toBeCloseTo(3, 12);
  expect(bin.frequency).toBe(8); expect(bin.real).toBeCloseTo(96 / Math.sqrt(2), 10); expect(bin.imag).toBeCloseTo(-96 / Math.sqrt(2), 10); expect(bin.phaseDegrees).toBeCloseTo(-45, 10); expect(bin.powerDensity).toBeCloseTo(4.5, 12);
  expect(report.result.bins[0].phaseDegrees).toBeNull();
  await expect(controls.getByRole('img', { name: '스펙트럼 진폭 그래프', exact: true })).toBeVisible(); await expect(controls.locator('.spectrum-bin')).toHaveCount(33);
  await controls.getByRole('button', { name: '전력 밀도', exact: true }).click(); await expect(controls.getByRole('img', { name: '스펙트럼 전력 밀도 그래프', exact: true })).toBeVisible();
  expect(await download<ExportedReport>(page, '스펙트럼 JSON')).toEqual(report);
  await controls.locator('.spectrum-details > summary').filter({ hasText: '원시 주파수 표' }).click();
  const table = controls.getByRole('table', { name: '스펙트럼 원시 주파수 응답', exact: true }); await expect(table.locator('tbody tr')).toHaveCount(33);
  await expect(table.locator('tbody tr').nth(8).locator('td').nth(1)).toHaveText('8'); await expect(table.locator('tbody tr').first().locator('td').last()).toHaveText('—');
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
  expect((await history(page))[0]!.result.samples).toEqual(recorded.result.samples); expect(errors).toEqual([]);
});

test('M21 invalid sample count and out-of-range start preserve the previous captured report', async ({ page }) => {
  await open(page); await record(page); const controls = await panel(page), report = await analyze(page, controls);
  await controls.getByLabel('스펙트럼 표본 수', { exact: true }).fill('12'); await controls.getByRole('button', { name: '스펙트럼 계산', exact: true }).click();
  await expect(controls.getByRole('alert')).toContainText('2의 거듭제곱'); expect(await download<ExportedReport>(page, '스펙트럼 JSON')).toEqual(report);
  await controls.getByLabel('스펙트럼 표본 수', { exact: true }).fill('64'); await controls.getByLabel('스펙트럼 시작 표본', { exact: true }).fill('1');
  await controls.getByRole('button', { name: '스펙트럼 계산', exact: true }).click(); await expect(controls.getByRole('alert')).toContainText('기록된 표본 수');
  expect(await download<ExportedReport>(page, '스펙트럼 JSON')).toEqual(report);
  await controls.getByLabel('스펙트럼 시작 표본', { exact: true }).fill('<img src=x onerror=alert(1)>'); await controls.getByRole('button', { name: '스펙트럼 계산', exact: true }).click();
  await expect(controls.getByRole('alert')).toContainText('정수'); expect(await controls.locator('img').count()).toBe(0); expect(await download<ExportedReport>(page, '스펙트럼 JSON')).toEqual(report);
});

test('M21 an accepted selection containing a nonfinite typed component clears the older successful report', async ({ page }) => {
  await open(page); await record(page, typedNonFinite()); const controls = await panel(page); await rectangular(controls);
  const report = await analyze(page, controls); expect(report.source).toMatchObject({ valueType: 'typed', shape: [2], componentIndex: 0 }); expect(report.result.mean).toBe(1);
  await controls.getByLabel('스펙트럼 성분', { exact: true }).selectOption('1'); await controls.getByRole('button', { name: '스펙트럼 계산', exact: true }).click();
  await expect(controls.getByRole('alert')).toContainText('비유한');
  await expect(controls.getByRole('region', { name: '스펙트럼 분석 결과', exact: true })).toHaveCount(0);
  await expect(controls.getByRole('button', { name: '스펙트럼 JSON', exact: true })).toHaveCount(0);
});

test('M21 previous execution stays tied to its original recording while new model and window drafts change', async ({ page }) => {
  await open(page); await record(page); const original = await download<CalcModel>(page, '모델 다운로드'), changed = structuredClone(original);
  changed.name = '현재 초안은 16 Hz'; changed.nodes[0].parameters.frequency = 16; changed.nodes[0].parameters.amplitude = 1;
  await importModel(page, changed); const controls = await panel(page); await rectangular(controls);
  await expect(controls).toContainText('이전 실행의 기록입니다'); await expect(controls).toContainText(original.name);
  const report = await analyze(page, controls); expect(report.source.modelName).toBe(original.name); expect(report.source.semanticHash).toBe(sha256(compileModel(original).semanticKey)); expect(report.result.peak!.frequency).toBe(8); expect(report.result.peak!.amplitude).toBeCloseTo(3, 12);
  await controls.getByLabel('스펙트럼 창 함수', { exact: true }).selectOption('hann'); await controls.getByLabel('스펙트럼 평균 제거', { exact: true }).uncheck();
  expect(await download<ExportedReport>(page, '스펙트럼 JSON')).toEqual(report);
  await expect(controls.getByRole('region', { name: '스펙트럼 분석 결과', exact: true })).toContainText('이전 실행의 기록입니다');
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(changed);
});

test('M21 selected segment and large raw table preserve exact recording times and 128-row pages', async ({ page }) => {
  await open(page); const model = sine(1024); model.nodes[0].parameters.frequency = 32; await record(page, model); const controls = await panel(page); await rectangular(controls);
  await controls.getByLabel('스펙트럼 시작 표본', { exact: true }).fill('128'); await controls.getByLabel('스펙트럼 표본 수', { exact: true }).fill('512');
  const selected = await analyze(page, controls); expect(selected.source).toMatchObject({ sampleCount: 1024, startIndex: 128, count: 512, startTime: 128 / 1024, endTime: 639 / 1024 });
  expect(selected.result.count).toBe(512); expect(selected.result.frequencyResolution).toBe(2); expect(selected.result.bins).toHaveLength(257); expect(selected.result.peak!.frequency).toBe(32);
  await controls.getByLabel('스펙트럼 시작 표본', { exact: true }).fill('0'); await controls.getByLabel('스펙트럼 표본 수', { exact: true }).fill('1024'); const full = await analyze(page, controls);
  expect(full.result.bins).toHaveLength(513); expect(full.source.samplesSha256).not.toBe(selected.source.samplesSha256);
  await controls.locator('.spectrum-details > summary').filter({ hasText: '원시 주파수 표' }).click(); const rows = controls.getByRole('table', { name: '스펙트럼 원시 주파수 응답', exact: true }).locator('tbody tr');
  await expect(rows).toHaveCount(128); await expect(rows.first().locator('td').first()).toHaveText('0');
  await controls.getByRole('button', { name: '스펙트럼 표 다음 페이지', exact: true }).click(); await expect(rows).toHaveCount(128); await expect(rows.first().locator('td').first()).toHaveText('128');
  for (let index = 0; index < 3; index++) await controls.getByRole('button', { name: '스펙트럼 표 다음 페이지', exact: true }).click();
  await expect(rows).toHaveCount(1); await expect(rows.first().locator('td').first()).toHaveText('512'); await expect(controls.getByRole('button', { name: '스펙트럼 표 다음 페이지', exact: true })).toBeDisabled();
  await controls.getByRole('button', { name: '스펙트럼 표 이전 페이지', exact: true }).click(); await expect(rows).toHaveCount(128); await expect(rows.first().locator('td').first()).toHaveText('384');
  expect(await download<ExportedReport>(page, '스펙트럼 JSON')).toEqual(full);
});

test('M21 charts, long escaped labels and internal raw tables fit mobile themes and 200-percent text', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const model = sine(); model.name = '<img src=x onerror=alert(1)> 긴 기록 이름으로 스펙트럼 출처 확인'; model.nodes[1].label = '길게 붙여진 출력 기록 이름의 스펙트럼';
  await open(page); await record(page, model); await mkdir('.test-generated/m21-ui', { recursive: true });
  for (const [width, theme, scale] of [[390, 'dark', 1], [390, 'light', 1], [320, 'dark', 2], [320, 'light', 2]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    const currentTheme = await page.locator('.app-shell').evaluate(element => element.classList.contains('light') ? 'light' : 'dark');
    if (currentTheme !== theme) await page.getByRole('button', { name: theme === 'light' ? '라이트 테마로 변경' : '다크 테마로 변경', exact: true }).click();
    const controls = await panel(page); await analyze(page, controls);
    await page.evaluate(scale => {
      const sizes = [...document.querySelectorAll<HTMLElement>('.spectrum-panel,.spectrum-panel *')].map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
      document.documentElement.style.fontSize = `${16 * scale}px`;
      for (const { element, size } of sizes) element.style.fontSize = `${size * scale}px`;
    }, scale);
    await controls.locator('.spectrum-details > summary').filter({ hasText: '원시 주파수 표' }).click(); await controls.getByRole('region', { name: '스펙트럼 분석 결과', exact: true }).scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid=spectrum-panel]')!, fields = [...panel.querySelectorAll<HTMLElement>('input,select,button')];
      return { viewport: innerWidth, page: document.documentElement.scrollWidth, panel: panel.scrollWidth, client: panel.clientWidth, minimumFieldFont: Math.min(...fields.map(element => Number.parseFloat(getComputedStyle(element).fontSize))) };
    });
    expect(dimensions.page, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1); expect(dimensions.panel, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.client + 1); expect(dimensions.minimumFieldFont).toBeGreaterThanOrEqual(16 * scale);
    expect(await controls.locator('img').count()).toBe(0); await page.screenshot({ path: `.test-generated/m21-ui/spectrum-${width}-${theme}-${scale}x.png` });
    await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  }
  expect(errors).toEqual([]);
});
