import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { CalcModel } from '../../packages/model/src';

async function workspace(page: Page) { await page.goto('/'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function example(page: Page, id: string) { await page.getByRole('button', { name: '예제로 시작', exact: true }).click(); await page.getByLabel('예제 카테고리').selectOption(id === 'continuous-decay' ? 'continuous' : 'solver'); await page.locator(`[data-example-id="${id}"]`).click(); }
async function run(page: Page) { await page.locator('.run-button').click(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과'); }
function output(page: Page, label: string) { return page.locator('.output-card').filter({ hasText: label }); }
async function download(page: Page, name: string) { const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await event).path())!, 'utf8'); }
async function storedModel(page: Page): Promise<CalcModel | null> { return page.evaluate(() => new Promise((resolve, reject) => { const opening = indexedDB.open('calcweave-m0', 1); opening.onsuccess = () => { const db = opening.result, tx = db.transaction('models', 'readonly'), request = tx.objectStore('models').get('current'); request.onsuccess = () => resolve(request.result ?? null); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('Read failed')); }; opening.onerror = () => reject(new Error('Open failed')); })); }

test('M12 implicit settings execute actual stiff decay, reject bounded drafts, persist and return cleanly to RK', async ({ page }) => {
  await workspace(page); await example(page, 'stiff-implicit-decay'); await run(page);
  await expect(page.getByLabel('적분 방법', { exact: true })).toHaveValue('implicit-euler'); await expect(page.locator('.solver-run-details')).toContainText('암시적 Euler 실행 기록');
  expect(Number(await output(page, '감쇠 기록').locator('strong').innerText())).toBeGreaterThan(.006); expect(Number(await output(page, '감쇠 기록').locator('strong').innerText())).toBeLessThan(.008);
  await page.locator('.solver-newton summary').click(); const iterations = page.getByLabel('최대 수렴 반복', { exact: true }); await iterations.fill('33'); await iterations.blur(); await expect(iterations).toHaveAttribute('aria-invalid', 'true'); await page.locator('.run-button').click(); await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  await iterations.fill('32'); await iterations.blur(); await page.getByLabel('수렴 잔차 허용값', { exact: true }).fill('1e-10'); await page.getByLabel('수렴 잔차 허용값', { exact: true }).blur();
  await expect.poll(async () => (await storedModel(page))?.execution.solver?.newtonMaxIterations).toBe(32);
  await page.getByLabel('적분 방법', { exact: true }).selectOption('rk4'); await run(page); await expect(page.locator('.solver-run-details')).toContainText('RK4 실행 기록');
  const model = JSON.parse(await download(page, '모델 다운로드')); expect(model.execution.solver.method).toBe('rk4'); for (const key of ['newtonTolerance', 'newtonMaxIterations', 'jacobianStep']) expect(model.execution.solver).not.toHaveProperty(key);
  await page.getByLabel('적분 방법', { exact: true }).selectOption('implicit-euler'); await run(page);
});

test('M12 actual algebraic diagram converges to z3 and diagnoses a residual without a real root', async ({ page }) => {
  await workspace(page); await example(page, 'algebraic-square-root'); await run(page); expect(Number(await output(page, '수렴한 z').locator('strong').innerText())).toBeCloseTo(3, 7);
  await page.locator('.react-flow__node[data-id="residual"]').click(); await page.getByLabel('수식', { exact: true }).fill('x^2 + 1'); await page.getByLabel('수식', { exact: true }).blur(); await page.locator('.run-button').click();
  await expect(page.locator('.diagnostic-item').first()).toContainText(/M12_NEWTON_(CONVERGENCE|SINGULAR)/); await expect(page.locator('.diagnostic-item').first()).toContainText(/residual|pivot/);
});

test('M12 index1 Descriptor checks inconsistent initial state and executes explicit projection', async ({ page }) => {
  await workspace(page); await example(page, 'descriptor-index-one'); await run(page); expect(Number(await output(page, '합 x+z').locator('strong').innerText())).toBeCloseTo(2 - Math.exp(-1), 6);
  await page.locator('.react-flow__node[data-id="plant"]').click(); await page.getByLabel('전체 초기 상태', { exact: true }).fill('[0,0]'); await page.getByLabel('전체 초기 상태', { exact: true }).blur(); await page.locator('.run-button').click(); await expect(page.locator('.diagnostic-item')).toContainText('M12_DAE_INITIAL_INCONSISTENT');
  await page.getByLabel('대수 초기 일관성', { exact: true }).selectOption('project'); await run(page); expect(Number(await output(page, '합 x+z').locator('strong').innerText())).toBeCloseTo(2 - Math.exp(-1), 6);
  await output(page, '전체 상태').click(); expect(Number(await page.locator('.signal-result tbody tr').nth(1).locator('td').last().innerText())).toBeCloseTo(1, 10);
});

test('M12 variable time and variable transport delays retain distinct actual history semantics', async ({ page }) => {
  await workspace(page); await example(page, 'variable-delay-vs-transport'); await run(page);
  await expect(output(page, '시간 지연 출력').locator('strong')).toHaveText('0.75'); await expect(output(page, '운송 지연 출력').locator('strong')).toHaveText('0.5');
  await page.getByRole('tab', { name: '실험', exact: true }).click(); const record = JSON.parse(await download(page, '기록 JSON'));
  const values = record.result.samples.at(-1).values; expect(Object.keys(values).sort()).toEqual(['time-result', 'transport-result']); expect(values['time-result']).toBeCloseTo(.75, 12); expect(values['transport-result']).toBeCloseTo(.5, 12); expect(record.model.nodes.find((node: { id: string }) => node.id === 'transport').blockType).toBe('time.variable-transport-delay');
});

test('M12 state limits, backlash/rate bounds and weighted PID examples expose real results and events', async ({ page }) => {
  await workspace(page); await example(page, 'continuous-state-limits'); await run(page);
  await expect(output(page, '제한 적분 기록').locator('strong')).toHaveText('1'); await expect(output(page, '제한 위치 기록').locator('strong')).toHaveText('0.25'); await expect(output(page, '경계의 속도').locator('strong')).toHaveText('0'); await expect(output(page, '위치 경계 여부').locator('strong')).toHaveText('true');
  await page.locator('.solver-events summary').click(); await expect(page.locator('.solver-events')).toContainText('0에서1까지 적분'); await expect(page.locator('.solver-events')).toContainText('위치0.25에서 멈춤');
  await example(page, 'backlash-and-rate-bounds'); await run(page); await expect(output(page, '백래시 기록').locator('strong')).toHaveText('-0.5'); await expect(output(page, '동적 한도 기록')).toBeVisible();
  await example(page, 'pid-two-degree-weighting'); await run(page); await expect(output(page, '2DOF 출력').locator('strong')).toHaveText('1'); await expect(output(page, '일반 P 출력').locator('strong')).toHaveText('2');
});

test('M12 timed and triggered local A/B/C/D appear as actual matrices and open the referenced plant', async ({ page }) => {
  await workspace(page); await example(page, 'local-linearization-requests'); await run(page); await output(page, '시각 분석 행렬').click();
  await expect(page.locator('.bus-result')).toBeVisible(); for (const [index, expected] of [-2, 3, 4, 5].entries()) expect(Number(await page.locator('.bus-field').nth(index).locator('tbody tr td').last().innerText())).toBeCloseTo(expected, 8);
  await output(page, '상승 분석 행렬').click(); for (const [index, expected] of [-2, 3, 4, 5].entries()) expect(Number(await page.locator('.bus-field').nth(index).locator('tbody tr td').last().innerText())).toBeCloseTo(expected, 8);
  await page.locator('.react-flow__node[data-id="timed"]').click(); await expect(page.getByLabel('하위 도식 실행', { exact: true })).toHaveCount(0); await page.getByRole('button', { name: '연속 정의 열기', exact: true }).click(); await expect(page.locator('.react-flow__node[data-id="state"]')).toBeVisible(); await expect(page.locator('.canvas-topline strong')).toHaveText('1상태 연속 분석 대상');
  await page.getByRole('button', { name: '루트 모델', exact: true }).click();
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: /코드 다운로드/ }).click(); const code = await readFile((await (await event).path())!, 'utf8'); expect(code).toContain('analysis.linearization'); expect(code).toContain('linearPlant');
});

test('M12 gradient tool executes the bounded expression API, reports nonsmooth input and exports actual values', async ({ page }) => {
  await workspace(page); await page.getByRole('button', { name: '분석', exact: true }).click(); await expect(page.getByRole('dialog', { name: '수치 분석' })).toBeVisible();
  await page.getByRole('button', { name: '기울기 계산', exact: true }).click(); const gradient = page.getByRole('region', { name: '수식 기울기 결과' }); await expect(gradient).toBeVisible(); expect(Number(await gradient.locator('dl>div').nth(1).locator('dd').innerText())).toBeCloseTo(7, 8);
  const report = JSON.parse(await download(page, '분석 결과 JSON')); expect(report.kind).toBe('expression-gradient'); expect(report.result.derivative).toBeCloseTo(7, 8); expect(report.result.evaluations).toBe(5);
  const field = page.getByLabel('분석 수식', { exact: true }); await field.fill('abs(x)'); await field.blur(); await page.getByRole('button', { name: '기울기 계산', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('ANALYSIS_NONSMOOTH');
  await field.fill('window.alert(1)'); await field.blur(); await expect(field).toHaveAttribute('aria-invalid', 'true'); await expect(page.getByRole('button', { name: '기울기 계산', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); await expect(page.getByRole('button', { name: '분석', exact: true })).toBeFocused();
});

test('M12 model resolution runs two real solvers on one observation grid and leaves the saved source intact', async ({ page }) => {
  await workspace(page); await example(page, 'continuous-decay'); await expect.poll(async () => (await storedModel(page))?.modelId).toBe('continuous-decay'); const before = await storedModel(page);
  await page.getByRole('button', { name: '분석', exact: true }).click(); await page.getByRole('button', { name: '모델 해상도', exact: true }).click(); await page.getByRole('button', { name: '해상도 비교 실행', exact: true }).click(); await expect(page.getByRole('region', { name: '모델 해상도 비교 결과' })).toContainText('비교 완료');
  const report = JSON.parse(await download(page, '분석 결과 JSON')); expect(report.status).toBe('completed'); expect(report.samplesCompared).toBeGreaterThan(1); expect(report.maximumAbsoluteDifference).toBeGreaterThan(0); expect(report.runs.coarse.status).toBe('completed'); expect(report.runs.fine.status).toBe('completed'); expect(await storedModel(page)).toEqual(before);
  await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click(); await expect(page.locator('.result-status')).toContainText('아직 계산하지 않았습니다');
});

test('M12 analysis controls and actual summaries fit 320px at 200% text in both themes', async ({ page }, testInfo) => {
  await workspace(page);
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.app-shell').evaluate(shell => shell.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경`, exact: true }).click();
    await page.getByRole('button', { name: '분석', exact: true }).click(); await page.getByRole('button', { name: '기울기 계산', exact: true }).click(); await expect(page.getByRole('region', { name: '수식 기울기 결과' })).toBeVisible();
    for (const [width, scale] of [[1440, 1], [1024, 1], [390, 1], [320, 2]]) {
      await page.setViewportSize({ width, height: 1200 }); await page.addStyleTag({ content: `html { font-size:${16 * scale}px !important; }` });
      await expect.poll(() => page.evaluate(() => ({ document: document.documentElement.scrollWidth <= innerWidth + 1, controls: [...document.querySelectorAll('.analysis-dialog input,.analysis-dialog textarea,.analysis-dialog select')].every(element => { const b = element.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth + 1; }) }))).toEqual({ document: true, controls: true });
      if (width === 1440 || width === 320) await page.locator('.analysis-dialog').screenshot({ path: testInfo.outputPath(`analysis-${theme}-${width}-${scale}x.png`) });
    }
    await page.getByRole('button', { name: '수치 분석 닫기', exact: true }).click();
  }
});
