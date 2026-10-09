import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { ENGINE_VERSION, type CalcModel } from '../../packages/model/src';
import { compileModel } from '../../packages/compiler/src';
import { sha256 } from '../../packages/model/src/sha256';
import { APP_VERSION } from '../../packages/release/src';
import { createExample } from '../../apps/web/src/examples';
import type { ControlAnalysisReport, ControlAnalysisSpec } from '../../packages/analysis/src/control-system';

type Report = {
  schemaVersion: number; kind: string; engineVersion: string;
  source: { kind: string; modelName: string; nodeId: string; semanticHash: string; system: { A: number[][]; B: number[][]; C: number[][]; D: number[][]; domain: string; sampleTime: number }; sampleTime: { period: number; offset: number; baseStep: number } };
  options: ControlAnalysisSpec; feedbackAssumption: string | null;
  result: Omit<ControlAnalysisReport, 'stateSpace' | 'margins' | 'rootLocus'> & {
    domain: string; sampleTime: number; nyquistOmega: number; stabilityCriterion: string;
    margins?: ControlAnalysisReport['margins']; rootLocus?: ControlAnalysisReport['rootLocus'];
  };
};
const sampleTime = .2, nyquist = Math.PI / sampleTime;
function plant(A = [[.5]], B = [1], C = [1], D = 0): CalcModel {
  return { schemaVersion: 1, modelId: 'm22-discrete-state-space', name: '이산 SISO 해석',
    execution: { mode: 'discrete', startTime: 0, stopTime: .65, step: .05 },
    nodes: [
      { id: 'input', blockType: 'source.constant', blockVersion: 1, label: '입력 1', parameters: { value: 1 } },
      { id: 'plant', blockType: 'discrete.state-space', blockVersion: 1, label: '이산 상태 공간', sampleTime: { period: 4, offset: 1 }, parameters: { A, B, C, D, initial: Array(A.length).fill(0) } },
      { id: 'result', blockType: 'sink.scope', blockVersion: 1, label: '상태 기록', sampleTime: { period: 4, offset: 1 }, parameters: {} },
    ],
    edges: [{ id: 'input-plant', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'plant', portId: 'in' } },
      { id: 'plant-result', source: { nodeId: 'plant', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }],
    layout: { input: { x: 40, y: 140 }, plant: { x: 290, y: 140 }, result: { x: 540, y: 140 } } };
}
async function importModel(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm22.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name);
}
async function open(page: Page, model = plant()) {
  await page.goto('./'); await expect(page.locator('.research-badge')).toContainText(APP_VERSION);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await importModel(page, model);
}
async function panel(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByRole('dialog', { name: '수치 분석', exact: true }).locator('.discrete-control-analysis-section > summary').click();
  return page.getByTestId('discrete-control-system-panel');
}
async function download<T>(page: Page, label: string): Promise<T> {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click();
  return JSON.parse(await readFile((await (await event).path())!, 'utf8')) as T;
}
async function frequencies(controls: Locator, minimum = .1, maximum = nyquist, points = 5) {
  await controls.getByLabel('이산 제어계 주파수 시작', { exact: true }).fill(String(minimum));
  await controls.getByLabel('이산 제어계 주파수 종료', { exact: true }).fill(String(maximum));
  await controls.getByLabel('이산 제어계 주파수 표본 수', { exact: true }).fill(String(points));
}
async function analyze(page: Page, controls: Locator): Promise<Report> {
  await controls.getByRole('button', { name: '이산 제어계 분석 실행', exact: true }).click();
  await expect(controls.getByRole('region', { name: '이산 제어계 분석 결과', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: '이산 제어계 분석 실행', exact: true })).toBeEnabled();
  return download<Report>(page, '이산 제어계 보고서 JSON');
}
async function feedback(controls: Locator, maximum = 2, points = 5) {
  await controls.getByLabel('이산 단위 음의 피드백 가정', { exact: true }).check();
  await controls.getByLabel('이산 근궤적 K 최댓값', { exact: true }).fill(String(maximum));
  await controls.getByLabel('이산 근궤적 K 표본 수', { exact: true }).fill(String(points));
}

test('M22 captured first-order z response includes the exact Nyquist endpoint without running or modifying the model', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const model = plant(); await open(page, model); const original = await download<CalcModel>(page, '모델 다운로드'), controls = await panel(page);
  await frequencies(controls); const report = await analyze(page, controls);
  expect(report).toMatchObject({ schemaVersion: 1, kind: 'discrete-siso-control-analysis', engineVersion: ENGINE_VERSION, feedbackAssumption: null,
    source: { kind: 'discrete-state-space-block', nodeId: 'plant', semanticHash: sha256(compileModel(original).semanticKey), sampleTime: { period: 4, offset: 1, baseStep: .05 }, system: { domain: 'discrete', sampleTime } },
    result: { domain: 'discrete', sampleTime, stabilityCriterion: 'unit-circle', stability: 'stable', poles: [{ real: .5, imag: 0 }], zeros: [] } });
  expect(report.result.nyquistOmega).toBeCloseTo(nyquist, 12);
  expect(report.result.margins).toBeUndefined(); expect(report.result.rootLocus).toBeUndefined();
  for (const point of report.result.bode) {
    const theta = point.omega * sampleTime, denominator = 1.25 - Math.cos(theta), real = (Math.cos(theta) - .5) / denominator, imag = -Math.sin(theta) / denominator;
    expect(point.status).toBe('finite'); expect(point.real).toBeCloseTo(real, 10); expect(point.imag).toBeCloseTo(imag, 10);
    expect(point.gainDb).toBeCloseTo(-10 * Math.log10(denominator), 8);
  }
  const endpoint = report.result.bode.at(-1)!; expect(endpoint.omega).toBeCloseTo(nyquist, 12); expect(endpoint.real).toBeCloseTo(-2 / 3, 10); expect(endpoint.imag).toBeCloseTo(0, 10);
  await expect(controls.getByRole('img', { name: /^이산 Bode 크기,/ })).toBeVisible();
  await expect(controls.getByRole('img', { name: /^이산 Bode 위상,/ })).toBeVisible();
  await expect(controls.getByRole('img', { name: '이산 상태 극점과 전달 영점', exact: true })).toBeVisible();
  await expect(controls.locator('.control-unit-circle')).toHaveCount(1);
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('아직 계산하지'); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original); expect(errors).toEqual([]);
});

test('M22 explicit unity negative feedback matches analytic crossover and sampled closed-loop poles', async ({ page }) => {
  await open(page); const controls = await panel(page); await frequencies(controls, .1, nyquist, 201); await feedback(controls);
  const report = await analyze(page, controls), margins = report.result.margins!;
  expect(report.feedbackAssumption).toBe('unity-negative-feedback-open-loop'); expect(margins.gainCrossovers).toHaveLength(1);
  expect(margins.gainCrossovers[0]!.omega).toBeCloseTo(Math.acos(.25) / sampleTime, 6);
  expect(margins.phaseMarginDegrees).toBeCloseTo(180 - Math.acos(-.25) * 180 / Math.PI, 6);
  expect(report.result.rootLocus!.map(point => point.gain)).toEqual([0, .5, 1, 1.5, 2]);
  expect(report.result.rootLocus!.map(point => point.poles[0]!.real)).toEqual([.5, 0, -.5, -1, -1.5]);
  expect(report.result.rootLocus!.every(point => point.status === 'completed')).toBe(true);
  await expect(controls).toContainText('단위 음의 피드백'); await expect(controls).toContainText('단위원');
});

test('M22 direct-feedthrough response and feedback characteristic keep the current-input D term', async ({ page }) => {
  await open(page, plant([[.5]], [1], [1], 2)); const controls = await panel(page); await frequencies(controls); await feedback(controls, 2, 3);
  const report = await analyze(page, controls), endpoint = report.result.bode.at(-1)!;
  expect(endpoint.real).toBeCloseTo(4 / 3, 10); expect(endpoint.imag).toBeCloseTo(0, 10); expect(report.source.system.D).toEqual([[2]]);
  for (const point of report.result.rootLocus!) expect(point.poles[0]!.real).toBeCloseTo(.5 - point.gain / (1 + 2 * point.gain), 10);
});

test('M22 an ill-posed direct-feedthrough feedback gain is explicit and never exported as an ordinary finite pole', async ({ page }) => {
  await open(page, plant([[.5]], [1], [1], -1)); const controls = await panel(page); await frequencies(controls); await feedback(controls, 2, 3);
  const report = await analyze(page, controls), point = report.result.rootLocus!.find(point => point.gain === 1)!;
  expect(point.status).toBe('ill-posed'); expect(point.poles).toEqual([]); expect(point.diagnostics.length).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toMatch(/NaN|Infinity/);
});

for (const [pole, stability] of [[1, 'boundary'], [1.2, 'unstable']] as const) test(`M22 pole ${pole} uses the unit-circle ${stability} criterion rather than the continuous real-part criterion`, async ({ page }) => {
  await open(page, plant([[pole]])); const controls = await panel(page); await frequencies(controls); const report = await analyze(page, controls);
  expect(report.result.poles).toEqual([{ real: pole, imag: 0 }]); expect(report.result.stability).toBe(stability); expect(report.result.stabilityCriterion).toBe('unit-circle');
});

test('M22 a pole at negative one makes the Nyquist endpoint a JSON-safe graph gap', async ({ page }) => {
  await open(page, plant([[-1]])); const controls = await panel(page); await frequencies(controls, .1, nyquist, 3); const report = await analyze(page, controls);
  expect(report.result.stability).toBe('boundary'); expect(report.result.bode.at(-1)).toMatchObject({ status: 'singular', real: null, imag: null, gainDb: null, phaseDegrees: null });
  await expect(controls).toContainText('빈 구간'); expect(JSON.stringify(report)).not.toMatch(/NaN|Infinity/);
});

test('M22 out-of-Nyquist and malformed drafts preserve the last captured report without injecting markup', async ({ page }) => {
  await open(page); const original = await download<CalcModel>(page, '모델 다운로드'), controls = await panel(page); await frequencies(controls); const report = await analyze(page, controls);
  await controls.getByLabel('이산 제어계 주파수 종료', { exact: true }).fill(String(nyquist + .01));
  await controls.getByRole('button', { name: '이산 제어계 분석 실행', exact: true }).click(); await expect(controls.getByRole('alert')).toBeVisible();
  expect(await download<Report>(page, '이산 제어계 보고서 JSON')).toEqual(report);
  await frequencies(controls, .1, nyquist, 802); await controls.getByRole('button', { name: '이산 제어계 분석 실행', exact: true }).click(); await expect(controls.getByRole('alert')).toContainText('801');
  expect(await download<Report>(page, '이산 제어계 보고서 JSON')).toEqual(report);
  await frequencies(controls); await controls.getByLabel('이산 제어계 주파수 시작', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await controls.getByRole('button', { name: '이산 제어계 분석 실행', exact: true }).click(); await expect(controls.getByRole('alert')).toBeVisible();
  expect(await download<Report>(page, '이산 제어계 보고서 JSON')).toEqual(report); expect(await controls.locator('img').count()).toBe(0);
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); expect(await download<CalcModel>(page, '모델 다운로드')).toEqual(original);
});

test('M22 option drafts never rewrite a captured report and a new source clears the old result', async ({ page }) => {
  const model = plant(), second = structuredClone(model.nodes[1]!); second.id = 'second'; second.label = '두 번째 이산 상태'; second.parameters.A = [[-.25]];
  model.nodes.push(second); model.edges.push({ id: 'input-second', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'second', portId: 'in' } }); model.layout.second = { x: 290, y: 360 };
  await open(page, model); const controls = await panel(page); await frequencies(controls); const report = await analyze(page, controls);
  await frequencies(controls, .2, 10, 7); await feedback(controls, 1, 3);
  expect(await download<Report>(page, '이산 제어계 보고서 JSON')).toEqual(report);
  await controls.getByLabel('이산 제어계 행렬 출처', { exact: true }).selectOption('discrete-block:second');
  await expect(controls.getByRole('region', { name: '이산 제어계 분석 결과', exact: true })).toHaveCount(0);
  await expect(controls.getByRole('button', { name: '이산 제어계 보고서 JSON', exact: true })).toHaveCount(0);
  await expect(controls.getByLabel('이산 제어계 주파수 표본 수', { exact: true })).toHaveValue('201');
  await frequencies(controls, .2, 10, 7); const next = await analyze(page, controls); expect(next.source.nodeId).toBe('second'); expect(next.result.poles[0]!.real).toBe(-.25); expect(next.options.frequencyPoints).toBe(7);
  expect(report.source.nodeId).toBe('plant'); expect(report.result.poles[0]!.real).toBe(.5); expect(report.result.margins).toBeUndefined();
});

test('M22 accepted uncertain pole calculations cannot retain an unrelated successful result', async ({ page }) => {
  const model = plant(), uncertain = structuredClone(model.nodes[1]!); uncertain.id = 'uncertain'; uncertain.label = '반복 단위원 극점';
  uncertain.parameters = { A: [[0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 1], [0, 0, -1, 0]], B: [0, 1, 0, 0], C: [1, 0, 0, 0], D: 0, initial: [0, 0, 0, 0] };
  model.nodes.push(uncertain); model.edges.push({ id: 'input-uncertain', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'uncertain', portId: 'in' } }); model.layout.uncertain = { x: 290, y: 360 };
  await open(page, model); const controls = await panel(page); await frequencies(controls); await analyze(page, controls);
  await controls.getByLabel('이산 제어계 행렬 출처', { exact: true }).selectOption('discrete-block:uncertain');
  await controls.getByRole('button', { name: '이산 제어계 분석 실행', exact: true }).click(); await expect(controls.getByRole('alert')).toBeVisible();
  await expect(controls.getByRole('region', { name: '이산 제어계 분석 결과', exact: true })).toHaveCount(0);
  await expect(controls.getByRole('button', { name: '이산 제어계 보고서 JSON', exact: true })).toHaveCount(0);
});

test('M22 unsupported continuous, reset and five-state configurations expose a reason and cannot be silently converted', async ({ page }) => {
  const reset = plant(); reset.nodes[1]!.parameters.reset = 'level'; reset.nodes.push({ id: 'reset', blockType: 'source.constant', blockVersion: 1, label: '초기화 없음', parameters: { value: false } });
  reset.edges.push({ id: 'reset-plant', source: { nodeId: 'reset', portId: 'out' }, target: { nodeId: 'plant', portId: 'reset' } }); reset.layout.reset = { x: 40, y: 350 };
  const A = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => row === column ? .5 : 0));
  for (const model of [createExample('continuous-step-response'), reset, plant(A, Array(5).fill(1), Array(5).fill(1))]) {
    await open(page, model); const controls = await panel(page);
    await expect(controls.getByRole('button', { name: '이산 제어계 분석 실행', exact: true })).toBeDisabled();
    await expect(controls).toContainText('분석할 이산 행렬이 없습니다'); await expect(controls.locator('.control-diagnostic')).not.toHaveCount(0);
    await expect(controls.getByRole('region', { name: '이산 제어계 분석 결과', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click();
  }
});

test('M22 charts, raw tables and escaped long labels fit dark and light mobile themes at 200-percent text', async ({ page }) => {
  test.setTimeout(90_000);
  const model = plant(); model.name = '<img src=x onerror=alert(1)> 긴 이산 제어계 모델 이름'; model.nodes[1]!.label = '단위원을 기준으로 검증하는 아주 긴 이산 상태 공간 이름';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, model); await mkdir('.test-generated/m22-ui', { recursive: true });
  for (const [width, theme, scale] of [[390, 'dark', 1], [390, 'light', 1], [320, 'dark', 2], [320, 'light', 2]] as const) {
    await page.setViewportSize({ width, height: 1000 }); const current = await page.locator('.app-shell').evaluate(element => element.classList.contains('light') ? 'light' : 'dark');
    if (current !== theme) await page.getByRole('button', { name: theme === 'light' ? '라이트 테마로 변경' : '다크 테마로 변경', exact: true }).click();
    const controls = await panel(page); await frequencies(controls); await feedback(controls); await analyze(page, controls);
    await page.evaluate(scale => {
      const panel = document.querySelector<HTMLElement>('[data-testid=discrete-control-system-panel]')!;
      const sizes = [panel, ...panel.querySelectorAll<HTMLElement>('*')].map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
      document.documentElement.style.fontSize = `${16 * scale}px`; for (const { element, size } of sizes) element.style.fontSize = `${size * scale}px`;
    }, scale);
    await controls.locator('.control-details > summary').filter({ hasText: '원시 주파수 표' }).click();
    await controls.getByRole('region', { name: '이산 제어계 분석 결과', exact: true }).scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid=discrete-control-system-panel]')!, fields = [...panel.querySelectorAll<HTMLElement>('input,select,button')];
      return { viewport: innerWidth, page: document.documentElement.scrollWidth, panel: panel.scrollWidth, client: panel.clientWidth, minimumFieldFont: Math.min(...fields.map(element => Number.parseFloat(getComputedStyle(element).fontSize))) };
    });
    expect(dimensions.page, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1); expect(dimensions.panel, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.client + 1);
    expect(dimensions.minimumFieldFont).toBeGreaterThanOrEqual(16 * scale); expect(await controls.locator('img').count()).toBe(0);
    await page.screenshot({ path: `.test-generated/m22-ui/discrete-control-${width}-${theme}-${scale}x.png` });
    await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  }
  expect(errors).toEqual([]);
});
