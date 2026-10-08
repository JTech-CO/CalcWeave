import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import type { CalcModel } from '../../packages/model/src';
import type { ControlAnalysisReport, ControlAnalysisSpec } from '../../packages/analysis/src/control-system';
import type { ControlAnalysisSource } from '../../apps/web/src/control-analysis-sources';
import { createExample } from '../../apps/web/src/examples';
import { APP_VERSION } from '../../packages/release/src';

type Report = { source: ControlAnalysisSource; options: ControlAnalysisSpec; feedbackAssumption: string | null; result: Omit<ControlAnalysisReport, 'margins' | 'rootLocus'> & Partial<Pick<ControlAnalysisReport, 'margins' | 'rootLocus'>> };
function plant(A = [[-1]], B = [1], C = [2], D = 0): CalcModel {
  const model = createExample('continuous-step-response'), node = model.nodes.find(node => node.id === 'plant')!;
  model.modelId = 'm20-state-space'; model.name = '제어계 해석'; node.blockType = 'continuous.state-space';
  node.parameters = { A, B, C, D, initial: Array(A.length).fill(0) }; return model;
}
async function importModel(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm20.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name);
}
async function open(page: Page, model = plant()) {
  await page.goto('./'); await expect(page.locator('.research-badge')).toContainText(APP_VERSION);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await importModel(page, model);
}
async function panel(page: Page) {
  await page.getByRole('button', { name: '분석', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '수치 분석', exact: true });
  await dialog.locator('.control-analysis-section > summary').click();
  return page.getByTestId('control-system-panel');
}
async function download<T>(page: Page, label: string): Promise<T> {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click();
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'));
}
async function analyze(page: Page): Promise<Report> {
  await page.getByRole('button', { name: '제어계 분석 실행', exact: true }).click();
  await expect(page.getByRole('region', { name: '제어계 분석 결과', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '제어계 분석 실행', exact: true })).toBeEnabled();
  return download<Report>(page, '제어계 보고서 JSON');
}

test('M20 first-order Bode uses captured state-space matrices and leaves the actual model unchanged', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); const original = await download<CalcModel>(page, '모델 다운로드'); await panel(page);
  const report = await analyze(page), point = report.result.bode[100]!;
  expect(point.omega).toBeCloseTo(1, 12); expect(point.real).toBeCloseTo(1, 10); expect(point.imag).toBeCloseTo(-1, 10);
  expect(point.gainDb).toBeCloseTo(10 * Math.log10(2), 8); expect(point.phaseDegrees).toBeCloseTo(-45, 8);
  expect(report.result.poles).toEqual([{ real: -1, imag: 0 }]); expect(report.result.zeros).toEqual([]);
  expect(report.source.kind).toBe('state-space-block'); expect(report.source.system.B).toEqual([[1]]);
  expect(report.feedbackAssumption).toBeNull(); expect(report.result.margins).toBeUndefined(); expect(report.result.rootLocus).toBeUndefined();
  await expect(page.getByRole('img', { name: /^Bode 크기,/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Bode 위상,/ })).toBeVisible();
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click();
  expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original); expect(errors).toEqual([]);
});

test('M20 explicit negative-feedback assumption gives analytic phase margin and raw root-locus gain samples', async ({ page }) => {
  await open(page); const controls = await panel(page); await controls.getByLabel('단위 음의 피드백 가정', { exact: true }).check();
  await controls.getByLabel('근궤적 K 최댓값', { exact: true }).fill('4'); await controls.getByLabel('근궤적 K 표본 수', { exact: true }).fill('5');
  const report = await analyze(page);
  expect(report.feedbackAssumption).toBe('unity-negative-feedback-open-loop');
  expect(report.result.margins!.phaseMarginDegrees).toBeCloseTo(120, 6);
  expect(report.result.margins!.gainCrossovers[0]!.omega).toBeCloseTo(Math.sqrt(3), 6);
  expect(report.result.margins!.gainMargin).toBeNull();
  expect(report.result.rootLocus!.map(point => point.poles[0]!.real)).toEqual([-1, -3, -5, -7, -9]);
  expect(report.result.rootLocus!.every(point => point.status === 'completed')).toBe(true);
  await expect(controls).toContainText('범위 밖');
});

test('M20 second-order complex poles and resonance match the independent analytic system', async ({ page }) => {
  await open(page, plant([[0, 1], [-4, -.8]], [0, 4], [1, 0])); const controls = await panel(page);
  await controls.getByLabel('제어계 주파수 시작', { exact: true }).fill('.2'); await controls.getByLabel('제어계 주파수 종료', { exact: true }).fill('20'); await controls.getByLabel('제어계 주파수 표본 수', { exact: true }).fill('5');
  const report = await analyze(page), point = report.result.bode[2]!;
  expect(point.omega).toBeCloseTo(2, 10); expect(point.real).toBeCloseTo(0, 8); expect(point.imag).toBeCloseTo(-2.5, 8);
  expect(point.phaseDegrees).toBeCloseTo(-90, 8); expect(report.result.stability).toBe('stable');
  for (const pole of report.result.poles) { expect(pole.real).toBeCloseTo(-.4, 10); expect(Math.abs(pole.imag)).toBeCloseTo(Math.sqrt(3.84), 10); }
  await expect(page.getByRole('img', { name: '상태 극점과 전달 영점', exact: true })).toBeVisible();
});

test('M20 actual Worker linearization is confirmed by request memory and its original recorded matrices', async ({ page }) => {
  await open(page, createExample('local-linearization-requests')); const original = await download<CalcModel>(page, '모델 다운로드');
  await page.locator('.run-button').click(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  const controls = await panel(page); await controls.getByLabel('제어계 행렬 출처', { exact: true }).selectOption('recorded-timed-timed-result');
  await controls.getByLabel('제어계 주파수 시작', { exact: true }).fill('.2'); await controls.getByLabel('제어계 주파수 종료', { exact: true }).fill('20'); await controls.getByLabel('제어계 주파수 표본 수', { exact: true }).fill('5');
  const report = await analyze(page), point = report.result.bode[2]!;
  expect(report.source.kind).toBe('recorded-linearization'); expect(report.source.requestTime).toBe(1); expect(report.source.time).toBe(1); expect(report.source.runStatus).toBe('completed');
  expect(point.real).toBeCloseTo(8, 6); expect(point.imag).toBeCloseTo(-3, 6); expect(report.result.poles[0]!.real).toBeCloseTo(-2, 8); expect(report.result.zeros[0]!.real).toBeCloseTo(-4.4, 8);
  await expect(controls).toContainText('확인된 실행');
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click();
  expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
});

test('M20 invalid frequency inputs retain the captured report and cannot alter the model', async ({ page }) => {
  await open(page); const original = await download<CalcModel>(page, '모델 다운로드'), controls = await panel(page); const report = await analyze(page);
  await controls.getByLabel('제어계 주파수 시작', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await controls.getByRole('button', { name: '제어계 분석 실행', exact: true }).click(); await expect(controls.getByRole('alert')).toBeVisible();
  expect(await download<Report>(page, '제어계 보고서 JSON')).toEqual(report); expect(await controls.locator('img').count()).toBe(0);
  await controls.getByLabel('제어계 주파수 시작', { exact: true }).fill('.01'); await controls.getByLabel('제어계 주파수 표본 수', { exact: true }).fill('802');
  await controls.getByRole('button', { name: '제어계 분석 실행', exact: true }).click(); await expect(controls.getByRole('alert')).toContainText('801');
  expect(await download<Report>(page, '제어계 보고서 JSON')).toEqual(report);
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
});

test('M20 singular frequencies stay JSON-safe graph gaps with isolated finite markers', async ({ page }) => {
  await open(page, plant([[0, 1], [-1, 0]], [0, 1], [1, 0])); const controls = await panel(page);
  await controls.getByLabel('제어계 주파수 시작', { exact: true }).fill('.5'); await controls.getByLabel('제어계 주파수 종료', { exact: true }).fill('2'); await controls.getByLabel('제어계 주파수 표본 수', { exact: true }).fill('3');
  const report = await analyze(page);
  expect(report.result.bode[1]).toMatchObject({ omega: 1, status: 'singular', real: null, imag: null, gainDb: null, phaseDegrees: null });
  expect(report.result.stability).toBe('boundary'); expect(await controls.locator('.control-plot-point').count()).toBe(4);
  await expect(controls).toContainText('빈 구간');
});

test('M20 high-order unsupported systems remain explicit and cannot be silently reduced', async ({ page }) => {
  const A = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => i === j ? -1 : 0));
  await open(page, plant(A, Array(5).fill(1), Array(5).fill(1))); const controls = await panel(page);
  await expect(controls.getByRole('button', { name: '제어계 분석 실행', exact: true })).toBeDisabled();
  await expect(controls).toContainText('분석할 행렬이 없습니다'); await expect(controls.getByRole('region', { name: '제어계 분석 결과' })).toHaveCount(0);
});

test('M20 accepted analysis failures clear the previous successful snapshot', async ({ page }) => {
  const model = plant(), uncertain = structuredClone(model.nodes.find(node => node.id === 'plant')!);
  uncertain.id = 'uncertain'; uncertain.label = '반복 허수축 극점';
  uncertain.parameters = { A: [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 1], [0, 0, -1, 0]], B: [0, 1, 0, 0], C: [1, 0, 0, 0], D: 0, initial: [0, 0, 0, 0] };
  model.nodes.push(uncertain); model.edges.push({ id: 'step-uncertain', source: { nodeId: 'step', portId: 'out' }, target: { nodeId: 'uncertain', portId: 'in' } });
  await open(page, model); const controls = await panel(page); await analyze(page);
  await controls.getByLabel('제어계 행렬 출처', { exact: true }).selectOption('block-uncertain');
  await controls.getByRole('button', { name: '제어계 분석 실행', exact: true }).click();
  await expect(controls.getByRole('alert')).toBeVisible();
  await expect(controls.getByRole('region', { name: '제어계 분석 결과', exact: true })).toHaveCount(0);
  await expect(controls.getByRole('button', { name: '제어계 보고서 JSON', exact: true })).toHaveCount(0);
});

test('M20 chart controls, internal tables and escaped model labels fit narrow themes and 200-percent text', async ({ page }) => {
  const model = plant(); model.name = '<img src=x onerror=alert(1)>';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, model); const controls = await panel(page); await controls.getByLabel('단위 음의 피드백 가정', { exact: true }).check(); await analyze(page);
  expect(await controls.locator('img').count()).toBe(0); await mkdir('.test-generated/m20-ui', { recursive: true });
  for (const [width, theme, scale] of [[1440, 'dark', 1], [390, 'light', 1], [320, 'dark', 2], [320, 'light', 2]] as const) {
    await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click();
    await page.setViewportSize({ width, height: 1000 });
    const current = await page.locator('.app-shell').evaluate(element => element.classList.contains('light') ? 'light' : 'dark');
    if (current !== theme) await page.getByRole('button', { name: theme === 'light' ? '라이트 테마로 변경' : '다크 테마로 변경', exact: true }).click();
    await panel(page); await page.getByLabel('단위 음의 피드백 가정', { exact: true }).check(); await analyze(page);
    await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; document.querySelectorAll<HTMLElement>('.control-system-panel,.control-system-panel input,.control-system-panel select,.control-system-panel button').forEach(element => { element.style.fontSize = `${16 * scale}px`; }); }, scale);
    await controls.getByRole('region', { name: '제어계 분석 결과', exact: true }).scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, panel: document.querySelector('[data-testid=control-system-panel]')!.scrollWidth, client: document.querySelector('[data-testid=control-system-panel]')!.clientWidth }));
    expect(dimensions.page, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1); expect(dimensions.panel, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.client + 1);
    await page.screenshot({ path: `.test-generated/m20-ui/control-${width}-${theme}.png` });
  }
  expect(errors).toEqual([]);
});
