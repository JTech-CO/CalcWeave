import { expect, test, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import type { CalcModel } from '../../packages/model/src';
import type { FitResult, MultiSweepResult } from '../../packages/experiments/src/multivariable';
import { APP_VERSION } from '../../packages/release/src';

function affine(): CalcModel {
  return { schemaVersion: 1, modelId: 'm19-affine', name: '두 계수의 직선',
    execution: { mode: 'discrete', startTime: 0, stopTime: 4, step: 1 },
    nodes: [
      { id: 'clock', blockType: 'source.clock', blockVersion: 1, label: '시각', parameters: {}, unit: 's' },
      { id: 'a', blockType: 'math.gain', blockVersion: 1, label: '기울기', parameters: { gain: 1 } },
      { id: 'b', blockType: 'source.constant', blockVersion: 1, label: '절편', parameters: { value: 0 }, unit: 's' },
      { id: 'sum', blockType: 'math.sum', blockVersion: 1, label: '합', parameters: {} },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '직선 관측', parameters: {} },
    ],
    edges: [
      { id: 'clock-a', source: { nodeId: 'clock', portId: 'out' }, target: { nodeId: 'a', portId: 'in' } },
      { id: 'a-sum', source: { nodeId: 'a', portId: 'out' }, target: { nodeId: 'sum', portId: 'a' } },
      { id: 'b-sum', source: { nodeId: 'b', portId: 'out' }, target: { nodeId: 'sum', portId: 'b' } },
      { id: 'sum-scope', source: { nodeId: 'sum', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } },
    ], layout: { clock: { x: 20, y: 70 }, a: { x: 200, y: 70 }, b: { x: 200, y: 210 }, sum: { x: 380, y: 70 }, scope: { x: 560, y: 70 } },
  };
}
const csv = 'time,value\n' + [0, 1, 2, 3, 4].map(time => `${time},${2.5 * time - .75}`).join('\n');
async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('.research-badge')).toContainText(APP_VERSION);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  const model = affine();
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm19.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name);
  await page.getByRole('tab', { name: '실험', exact: true }).click();
}
async function modelDownload(page: Page): Promise<CalcModel> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '모델 다운로드', exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
}
async function reportDownload<T>(page: Page, label: string): Promise<T> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
}
async function configureFit(page: Page, text = csv) {
  const section = page.getByTestId('fit-section');
  await section.locator(':scope > summary').click();
  await section.getByLabel('피팅 블록 1', { exact: true }).selectOption('a');
  await section.getByLabel('피팅 하한 1', { exact: true }).fill('0');
  await section.getByLabel('피팅 상한 1', { exact: true }).fill('4');
  await section.getByLabel('피팅 초기값 1', { exact: true }).fill('1');
  await section.getByRole('button', { name: '피팅 파라미터 추가', exact: true }).click();
  await section.getByLabel('피팅 블록 2', { exact: true }).selectOption('b');
  await section.getByLabel('피팅 하한 2', { exact: true }).fill('-2');
  await section.getByLabel('피팅 상한 2', { exact: true }).fill('2');
  await section.getByLabel('피팅 초기값 2', { exact: true }).fill('0');
  await section.getByLabel('피팅 출력', { exact: true }).selectOption('scope');
  await section.getByLabel('피팅 최대 평가 횟수', { exact: true }).fill('48');
  await section.getByLabel('피팅 측정 CSV', { exact: true }).setInputFiles({ name: 'analytic.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await section.getByLabel('피팅 측정값 단위', { exact: true }).selectOption('s');
  await section.getByRole('button', { name: '측정 데이터 확인', exact: true }).click();
  return section;
}
async function finishFit(page: Page) {
  // A fit launches several Workers under a shared 30-second computation budget.
  test.setTimeout(60_000);
  const section = page.getByTestId('fit-section');
  await section.getByRole('button', { name: '파라미터 피팅 실행', exact: true }).click();
  await expect(section.getByRole('button', { name: '피팅 보고서 JSON', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(section.getByRole('button', { name: '파라미터 피팅 실행', exact: true })).toBeEnabled();
  return reportDownload<{ result: FitResult }>(page, '피팅 보고서 JSON');
}

test('M19 restores independent analytic affine coefficients through actual Workers without changing the model', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); const original = await modelDownload(page);
  await configureFit(page); const { result: report } = await finishFit(page);
  expect(report.status).toBe('completed'); expect(report.termination).toBe('converged');
  expect(report.best!.parameters.find(p => p.nodeId === 'a')!.value).toBeCloseTo(2.5, 6);
  expect(report.best!.parameters.find(p => p.nodeId === 'b')!.value).toBeCloseTo(-.75, 6);
  expect(report.best!.rmse).toBeLessThan(1e-7);
  for (const point of report.best!.residuals) {
    expect(point.measured).toBe(2.5 * point.time - .75);
    expect(point.predicted).toBe(report.best!.result.samples.find(sample => sample.time === point.time)!.values.scope);
    expect(point.residual).toBe(point.predicted - point.measured);
  }
  expect(await modelDownload(page)).toEqual(original);
  await page.getByRole('tab', { name: '도식', exact: true }).click();
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  const fit = page.getByTestId('fit-section'); await fit.locator(':scope > summary').click();
  const reloaded = await reportDownload<{ result: FitResult }>(page, '피팅 보고서 JSON');
  expect(reloaded.result).toEqual(report);
  await fit.getByRole('button', { name: '최적 후보 모델 적용', exact: true }).click();
  const applied = await modelDownload(page);
  expect(applied.nodes.find(node => node.id === 'a')!.parameters.gain).toBeCloseTo(2.5, 6);
  expect(applied.nodes.find(node => node.id === 'b')!.parameters.value).toBeCloseTo(-.75, 6);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  expect(await modelDownload(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test('M19 Cartesian two-axis grid returns each actual candidate and keeps root coefficients unchanged', async ({ page }) => {
  await open(page); const original = await modelDownload(page), grid = page.getByTestId('multi-sweep-section');
  await grid.locator(':scope > summary').click();
  await grid.getByLabel('다변수 블록 1', { exact: true }).selectOption('a');
  await grid.getByLabel('다변수 실행 값 1', { exact: true }).fill('1, 2');
  await grid.getByRole('button', { name: '다변수 파라미터 추가', exact: true }).click();
  await grid.getByLabel('다변수 블록 2', { exact: true }).selectOption('b');
  await grid.getByLabel('다변수 실행 값 2', { exact: true }).fill('-1, 1');
  await expect(grid.locator('.m19-combination-count')).toContainText('4 / 64');
  await grid.getByRole('button', { name: '다변수 실험 실행', exact: true }).click();
  await expect(grid.getByRole('table', { name: '다변수 조합별 결과' }).locator('tbody tr')).toHaveCount(4);
  await expect(grid.getByRole('button', { name: '다변수 실험 실행', exact: true })).toBeEnabled();
  const { result: report } = await reportDownload<{ result: MultiSweepResult }>(page, '다변수 보고서 JSON');
  expect(report.status).toBe('completed');
  expect(report.records.map(record => record.result.samples.at(-1)!.values.scope)).toEqual([3, 5, 7, 9]);
  expect(new Set(report.records.map(record => record.modelHash)).size).toBe(4);
  expect(await modelDownload(page)).toEqual(original);
  await grid.getByRole('button', { name: '조합 3 모델 적용', exact: true }).click();
  const chosen = await modelDownload(page);
  expect(chosen.nodes.find(node => node.id === 'a')!.parameters.gain).toBe(2);
  expect(chosen.nodes.find(node => node.id === 'b')!.parameters.value).toBe(-1);
});

test('M19 rejects off-grid measurements and mismatched units before producing a candidate', async ({ page }) => {
  await open(page); const original = await modelDownload(page);
  const fit = await configureFit(page, 'time,value\n0,0\n0.5,1\n1,2');
  await fit.getByRole('button', { name: '파라미터 피팅 실행', exact: true }).click();
  await expect(fit.getByRole('alert')).toContainText('격자');
  await expect(fit.getByRole('button', { name: '피팅 보고서 JSON', exact: true })).toHaveCount(0);
  expect(await modelDownload(page)).toEqual(original);
  await fit.getByLabel('피팅 측정 CSV', { exact: true }).setInputFiles({ name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await fit.getByLabel('피팅 측정값 단위', { exact: true }).selectOption('m');
  await fit.getByRole('button', { name: '파라미터 피팅 실행', exact: true }).click();
  await expect(fit.getByRole('alert')).toContainText('단위');
  expect(await modelDownload(page)).toEqual(original);
});

test('M19 keeps the completed report and disables apply after a different model is imported', async ({ page }) => {
  await open(page); await configureFit(page); const originalReport = await finishFit(page);
  const changed = affine(); changed.nodes.find(node => node.id === 'a')!.parameters.gain = 1.5;
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'changed.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  await page.getByTestId('fit-section').locator(':scope > summary').click();
  await expect(page.getByRole('button', { name: '최적 후보 모델 적용', exact: true })).toBeDisabled();
  expect(await reportDownload(page, '피팅 보고서 JSON')).toEqual(originalReport);
  const result = await modelDownload(page); expect(result.nodes.find(node => node.id === 'a')!.parameters.gain).toBe(1.5);
});

test('M19 malformed CSV is literal, bounded and cannot change the model or start fitting', async ({ page }) => {
  await open(page); const original = await modelDownload(page);
  const fit = await configureFit(page, 'time,value\n0,<img src=x onerror=alert(1)>\n1,2');
  await expect(fit.getByRole('alert')).toBeVisible();
  expect(await page.locator('.m19-experiments img').count()).toBe(0);
  await fit.getByRole('button', { name: '파라미터 피팅 실행', exact: true }).click();
  await expect(fit.getByRole('button', { name: '피팅 보고서 JSON', exact: true })).toHaveCount(0);
  expect(await modelDownload(page)).toEqual(original);
  await fit.getByLabel('피팅 측정 CSV', { exact: true }).setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(256 * 1024 + 1, 32) });
  await expect(fit.getByRole('alert')).toContainText('256 KiB');
  expect(await modelDownload(page)).toEqual(original);
});

test('M19 cancellation terminates the actual Worker and a reset prevents late candidates', async ({ page }) => {
  await page.addInitScript(() => {
    const native = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')!;
    const timers = new Map<Worker, Set<number>>();
    Object.defineProperty(Worker.prototype, 'onmessage', { configurable: native.configurable, enumerable: native.enumerable, get: native.get,
      set(handler) { native.set!.call(this, typeof handler !== 'function' ? handler : (event: MessageEvent) => {
        if (event.data.type !== 'result') { handler.call(this, event); return; }
        const pending = timers.get(this) ?? new Set<number>(); timers.set(this, pending);
        pending.add(window.setTimeout(() => handler.call(this, event), 8000));
      }); },
    });
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function() { for (const timer of timers.get(this) ?? []) clearTimeout(timer); timers.delete(this); return terminate.call(this); };
  });
  await open(page); const original = await modelDownload(page); const fit = await configureFit(page);
  await fit.getByRole('button', { name: '파라미터 피팅 실행', exact: true }).click();
  await expect(fit.getByRole('button', { name: '실험 취소', exact: true })).toBeVisible();
  await fit.getByRole('button', { name: '실험 취소', exact: true }).click();
  await expect(fit.getByRole('button', { name: '파라미터 피팅 실행', exact: true })).toBeEnabled();
  await expect(fit.getByRole('region', { name: '파라미터 피팅 결과' })).toContainText('취소');
  await expect(fit.getByRole('button', { name: '피팅 보고서 JSON', exact: true })).toHaveCount(0);
  expect(await modelDownload(page)).toEqual(original);
  await page.getByRole('button', { name: '실행 초기화', exact: true }).click();
  await expect(fit.getByRole('region', { name: '파라미터 피팅 결과' })).toHaveCount(0);
});

test('M19 controls, results and escaped labels fit narrow themes and enlarged text', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await configureFit(page); await finishFit(page);
  const fit = page.getByTestId('fit-section');
  await mkdir('.test-generated/m19-ui', { recursive: true });
  for (const [width, theme, scale] of [[1440, 'dark', 1], [390, 'light', 1], [320, 'dark', 2]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    const current = await page.locator('.app-shell').evaluate(el => el.classList.contains('light') ? 'light' : 'dark');
    if (current !== theme) await page.getByRole('button', { name: theme === 'light' ? '라이트 테마로 변경' : '다크 테마로 변경', exact: true }).click();
    await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; document.querySelectorAll<HTMLElement>('.m19-experiments, .m19-experiments input, .m19-experiments select, .m19-experiments button').forEach(el => { el.style.fontSize = `${16 * scale}px`; }); }, scale);
    await fit.getByRole('table', { name: '피팅 후보 파라미터' }).scrollIntoViewIfNeeded();
    const pageWidth = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll<HTMLElement>('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden'; }).slice(0, 20).map(el => ({ tag: el.tagName, className: el.className, text: (el.textContent ?? '').slice(0, 70), width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right, scroll: el.scrollWidth, client: el.clientWidth })) }));
    expect(pageWidth.scroll, JSON.stringify({ width, theme, scale, ...pageWidth })).toBeLessThanOrEqual(pageWidth.viewport + 1);
    const dimensions = await fit.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    await page.screenshot({ path: `.test-generated/m19-ui/fit-${width}-${theme}.png` });
  }
  expect(errors).toEqual([]);
});
