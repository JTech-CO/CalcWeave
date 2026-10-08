import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import type { CalcModel, SignalValue } from '../../packages/model/src';
import { APP_VERSION } from '../../packages/release/src';
import type { HistoryRecord } from '../../apps/web/src/run-history';

function vectorClock(gain = 2, step = 1): CalcModel {
  return {
    schemaVersion: 1, modelId: 'm18-vector-clock', name: `시각과 ${gain}배 시각`,
    execution: { mode: 'discrete', startTime: 0, stopTime: 4, step },
    nodes: [
      { id: 'clock', blockType: 'source.clock', blockVersion: 1, label: '시각', parameters: {}, unit: 's' },
      { id: 'gain', blockType: 'math.gain', blockVersion: 1, label: '시간 배율', parameters: { gain } },
      { id: 'mux', blockType: 'route.mux', blockVersion: 1, label: '두 시각', parameters: {} },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '벡터 관측', parameters: {} },
      { id: 'scalar', blockType: 'sink.scope', blockVersion: 1, label: '시각 관측', parameters: {} },
    ],
    edges: [
      { id: 'clock-gain', source: { nodeId: 'clock', portId: 'out' }, target: { nodeId: 'gain', portId: 'in' } },
      { id: 'clock-mux', source: { nodeId: 'clock', portId: 'out' }, target: { nodeId: 'mux', portId: 'a' } },
      { id: 'gain-mux', source: { nodeId: 'gain', portId: 'out' }, target: { nodeId: 'mux', portId: 'b' } },
      { id: 'mux-scope', source: { nodeId: 'mux', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } },
      { id: 'clock-scalar', source: { nodeId: 'clock', portId: 'out' }, target: { nodeId: 'scalar', portId: 'in' } },
    ],
    layout: { clock: { x: 40, y: 100 }, gain: { x: 240, y: 200 }, mux: { x: 430, y: 100 }, scope: { x: 650, y: 100 }, scalar: { x: 430, y: 320 } },
  };
}
function direct(value: SignalValue, unit = '1'): CalcModel {
  return {
    schemaVersion: 1, modelId: 'm18-direct', name: '원본 값 관측',
    execution: { mode: 'discrete', startTime: 0, stopTime: 4, step: 1 },
    nodes: [
      { id: 'value', blockType: typeof value === 'object' && !Array.isArray(value) ? 'source.typed' : 'source.constant', blockVersion: 1, label: '원본 입력', parameters: { value }, unit },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '원본 관측', parameters: {} },
    ],
    edges: [{ id: 'value-scope', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }],
    layout: { value: { x: 40, y: 100 }, scope: { x: 350, y: 100 } },
  };
}
const observation = (page: Page) => page.getByTestId('scope-observation');
const rawTable = (scope: Locator) => scope.getByRole('table', { name: '커서의 원시 기록' });
async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('.research-badge')).toContainText(APP_VERSION);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function importAndRun(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm18.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name);
  await page.getByRole('button', { name: model.execution.mode === 'static' ? '계산하기' : '시뮬레이션 실행', exact: false }).click();
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
}
async function cursor(scope: Locator, time: string) {
  await expand(scope);
  await scope.getByLabel('커서 시각', { exact: true }).fill(time);
  await scope.getByLabel('커서 시각', { exact: true }).press('Enter');
  await expect(rawTable(scope)).toBeVisible();
}
async function expand(scope: Locator) {
  const summary = scope.locator('.scope-view-controls > summary');
  if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
}
async function history(page: Page): Promise<HistoryRecord[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onsuccess = () => { const db = request.result, tx = db.transaction('models', 'readonly'), read = tx.objectStore('models').get('run-history-v1'); read.onsuccess = () => resolve(read.result ?? []); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('History read failed')); };
    request.onerror = () => reject(new Error('History open failed'));
  }));
}
async function modelDownload(page: Page): Promise<CalcModel> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '모델 다운로드', exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as CalcModel;
}

test('M18 vector cursor reads real Worker samples and keyboard cursor stays inside the graph', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await importAndRun(page, vectorClock());
  await page.locator('.output-card').filter({ hasText: '벡터 관측' }).click();
  const scope = observation(page);
  await expect(scope.getByLabel('그래프 성분')).toHaveValue('0');
  await scope.getByLabel('그래프 성분').selectOption('1');
  await cursor(scope, '1.5');
  await expect(rawTable(scope).locator('tbody td').nth(0)).toHaveText('1');
  await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('2');
  await expect(scope.locator('.scope-cursor-readings')).toContainText('커서 1.5 s');
  await expect.poll(async () => (await history(page)).length).toBe(1);
  expect((await history(page))[0].result.samples[1].values.scope).toEqual([1, 2]);
  const svg = scope.locator('svg');
  await svg.press('End'); await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('8');
  await svg.press('ArrowLeft'); await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('6');
  const transform = await page.locator('.react-flow__viewport').getAttribute('style');
  await svg.press('Space');
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', transform!);
  await svg.press('Home'); await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('M18 viewing window and blue drag zoom preserve the complete model and raw history', async ({ page }) => {
  await open(page); await importAndRun(page, vectorClock());
  await page.locator('.output-card').filter({ hasText: '벡터 관측' }).click();
  const scope = observation(page), originalModel = await modelDownload(page);
  await expect.poll(async () => (await history(page)).length).toBe(1);
  const originalHistory = await history(page);
  await expand(scope); await scope.getByLabel('보기 시작 시간').fill('1'); await scope.getByLabel('보기 종료 시간').fill('3');
  await scope.getByRole('button', { name: '보기 구간 적용' }).click();
  await expect(scope.locator('svg')).toHaveAttribute('aria-label', /시작 1, 종료 3/);
  await expect(scope.locator('path[data-sample-count]')).toHaveAttribute('data-sample-count', '3');
  expect(await modelDownload(page)).toEqual(originalModel); expect(await history(page)).toEqual(originalHistory);
  await scope.getByLabel('보기 시작 시간').fill('3'); await scope.getByLabel('보기 종료 시간').fill('1');
  await scope.getByRole('button', { name: '보기 구간 적용' }).click();
  await expect(scope.getByRole('alert')).toBeVisible(); await expect(scope.locator('svg')).toHaveAttribute('aria-label', /시작 1, 종료 3/);
  await scope.getByRole('button', { name: '전체 구간' }).click();
  await scope.locator('svg').scrollIntoViewIfNeeded();
  const bounds = (await scope.locator('svg').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .5); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .5, { steps: 5 });
  await expect(scope.locator('.scope-selection')).toBeVisible(); await page.mouse.up();
  await expect(scope.locator('.scope-selection')).toHaveCount(0);
  await expect(scope.locator('path[data-sample-count]')).toHaveAttribute('data-sample-count', '3');
  await scope.getByRole('button', { name: '전체 구간' }).click();
  await expect(scope.locator('path[data-sample-count]')).toHaveAttribute('data-sample-count', '5');
  expect(await modelDownload(page)).toEqual(originalModel); expect(await history(page)).toEqual(originalHistory);
});

test('M18 overlays selected runs on common axes and keeps each original sample time', async ({ page }) => {
  await open(page); await importAndRun(page, vectorClock(2)); await importAndRun(page, vectorClock(3, .5));
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(2);
  await page.locator('.history-card').nth(0).getByRole('checkbox').check(); await page.locator('.history-card').nth(1).getByRole('checkbox').check();
  const scope = page.locator('.experiment-scope').getByTestId('scope-observation');
  await page.getByLabel('비교 그래프 출력', { exact: true }).selectOption('scope');
  await scope.getByLabel('그래프 성분').selectOption('1');
  await expect(scope.locator('path[data-sample-count]')).toHaveCount(2);
  await expect(scope.locator('.plot-y-labels')).toHaveText('120');
  await cursor(scope, '1.25');
  const rows = rawTable(scope).locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('td').first()).toHaveText('1'); await expect(rows.nth(0).locator('.scope-exact-value')).toHaveText('3');
  await expect(rows.nth(1).locator('td').first()).toHaveText('1'); await expect(rows.nth(1).locator('.scope-exact-value')).toHaveText('2');
  await cursor(scope, '1.6');
  await expect(rows.nth(0).locator('td').first()).toHaveText('1.5'); await expect(rows.nth(0).locator('.scope-exact-value')).toHaveText('4.5');
  await expect(rows.nth(1).locator('td').first()).toHaveText('2'); await expect(rows.nth(1).locator('.scope-exact-value')).toHaveText('4');
  await page.getByLabel('비교 그래프 출력', { exact: true }).selectOption('scalar');
  await expect(scope.getByLabel('그래프 성분')).toHaveCount(0);
  await cursor(scope, '1.6'); await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText(['1.5', '2']);
  await expect(page.getByRole('table', { name: '실행 수치 비교' })).toHaveCount(0);
});

test('M18 exact uint64 vector values survive approximate plotting and same-grid shape replacement', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await importAndRun(page, direct({ kind: 'typed', dtype: 'uint64', shape: [2], data: ['9007199254740993', '18446744073709551615'] }));
  const scope = observation(page); await scope.getByLabel('그래프 성분').selectOption('1'); await cursor(scope, '2');
  await expect(scope.locator('.typed-plot-note')).toContainText('float64 시각화');
  await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('18446744073709551615');
  await expect.poll(async () => (await history(page)).length).toBe(1);
  expect(((await history(page))[0].result.samples[2].values.scope as { data: string[] }).data[1]).toBe('18446744073709551615');
  await importAndRun(page, direct(7));
  await expect(scope.locator('svg')).toBeVisible(); await expect(scope.getByLabel('그래프 성분')).toHaveCount(0);
  await cursor(scope, '2'); await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('7');
  expect(errors).toEqual([]);
});

test('M18 keyboard cursor uses a recorded curve when the first selected run has no samples in view', async ({ page }) => {
  await open(page);
  const later = direct(9); later.execution = { mode: 'discrete', startTime: 3, stopTime: 5, step: 1 };
  const earlier = direct(2); earlier.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: 1 };
  await importAndRun(page, later); await importAndRun(page, earlier);
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  await page.locator('.history-card').nth(0).getByRole('checkbox').check(); await page.locator('.history-card').nth(1).getByRole('checkbox').check();
  const scope = page.locator('.experiment-scope').getByTestId('scope-observation'); await expand(scope);
  await scope.getByLabel('보기 시작 시간').fill('3'); await scope.getByLabel('보기 종료 시간').fill('5'); await scope.getByRole('button', { name: '보기 구간 적용' }).click();
  await scope.locator('svg').press('Home'); await expect(rawTable(scope).locator('tbody tr')).toHaveCount(1);
  await expect(rawTable(scope).locator('tbody td').first()).toHaveText('3'); await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('9');
  await scope.locator('svg').press('ArrowRight'); await expect(rawTable(scope).locator('tbody td').first()).toHaveText('4');
});

test('M18 incompatible units explain why records cannot be overlaid and deleted selections release slots', async ({ page }) => {
  await open(page); await importAndRun(page, direct([1, 2], 'm')); await importAndRun(page, direct([3, 4], 's'));
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  await page.locator('.history-card').nth(0).getByRole('checkbox').check(); await page.locator('.history-card').nth(1).getByRole('checkbox').check();
  await expect(page.locator('.experiment-scope')).toContainText('단위');
  const scope = page.locator('.experiment-scope').getByTestId('scope-observation');
  await expect(scope.locator('svg')).toHaveCount(0);
  await page.locator('.history-card').nth(0).getByRole('button', { name: '기록 삭제', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);
  await expect(scope.locator('svg')).toBeVisible();
  await page.getByRole('tab', { name: '도식', exact: true }).click(); await importAndRun(page, direct([5, 6], 'm'));
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  await page.locator('.history-card').nth(0).getByRole('checkbox').check(); await page.locator('.history-card').nth(1).getByRole('checkbox').check();
  await expect(page.locator('.experiment-scope .tag')).toHaveText('2 / 3');
});

test('M18 one-sample vector graphs reset their view and user labels remain escaped text', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  const model = direct([3, 8]); model.execution = { mode: 'static', startTime: 0, stopTime: 0, step: .1 }; model.nodes[1].label = '<img src=x onerror=alert(1)>';
  await importAndRun(page, model); const scope = observation(page);
  await scope.getByLabel('그래프 성분').selectOption('1'); await scope.locator('svg').press('Home');
  await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('8');
  await expand(scope); await scope.getByRole('button', { name: '보기 구간 적용' }).click();
  await expect(scope.locator('svg')).toBeVisible(); await scope.getByRole('button', { name: '전체 구간' }).click();
  await expect(scope.locator('.scope-legend')).toContainText('<img src=x onerror=alert(1)>');
  await expect(scope.locator('img')).toHaveCount(0); expect(errors).toEqual([]);
});

test('M18 recorded dashboard Scope retains cursor and window through theme and model label edits', async ({ page }) => {
  await open(page);
  const model = direct([3, 8]);
  model.nodes.push({ id: 'record', blockType: 'sink.record', blockVersion: 1, label: '보관한 시계열', parameters: {} });
  model.edges.push({ id: 'value-record', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'record', portId: 'in' } });
  model.layout.record = { x: 350, y: 300 };
  await importAndRun(page, model); await page.getByRole('tab', { name: '대시보드', exact: true }).click();
  const scope = page.locator('.dashboard-card').filter({ hasText: '보관한 시계열' }).getByTestId('scope-observation');
  await scope.getByLabel('그래프 성분').selectOption('1'); await expand(scope);
  await scope.getByLabel('보기 시작 시간').fill('1'); await scope.getByLabel('보기 종료 시간').fill('3'); await scope.getByRole('button', { name: '보기 구간 적용' }).click();
  await cursor(scope, '2'); await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('8');
  await page.getByRole('button', { name: '라이트 테마로 변경', exact: true }).click();
  await page.getByLabel('모델 이름', { exact: true }).fill('이름만 바꾼 기록');
  await expect(scope.getByLabel('그래프 성분')).toHaveValue('1');
  await expect(scope.locator('svg')).toHaveAttribute('aria-label', /시작 1, 종료 3/);
  await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('8');
});

test('M18 observation controls fit narrow themes and enlarged text without page overflow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await importAndRun(page, vectorClock());
  await page.locator('.output-card').filter({ hasText: '벡터 관측' }).click(); const scope = observation(page); await cursor(scope, '2');
  await mkdir('.test-generated/m18-ui', { recursive: true });
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: '라이트 테마로 변경', exact: true }).click();
    for (const [width, scale] of [[1440, 1], [390, 1], [320, 2]]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.addStyleTag({ content: `html { font-size: ${16 * scale}px !important; }` });
      await scope.scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const metrics = await scope.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return { client: element.clientWidth, scroll: element.scrollWidth, overflow: [...element.querySelectorAll('*')].filter(child => { const box = child.getBoundingClientRect(); return box.right > bounds.right + 1 || box.left < bounds.left - 1; }).slice(0, 12).map(child => ({ tag: child.tagName, classes: child.className.toString(), width: child.getBoundingClientRect().width, margin: getComputedStyle(child).margin })) };
      });
      expect(metrics.scroll <= metrics.client + 1, JSON.stringify(metrics)).toBe(true);
      expect(await scope.locator('input[type=text]').evaluateAll(elements => elements.every(element => parseFloat(getComputedStyle(element).fontSize) >= 14))).toBe(true);
      await expect(rawTable(scope).locator('.scope-exact-value')).toHaveText('2');
      if (width === 1440 || width === 320) await page.screenshot({ path: `.test-generated/m18-ui/scope-${width}-${theme}.png`, fullPage: false });
    }
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.addStyleTag({ content: 'html { font-size: 16px !important; }' });
  }
  expect(errors).toEqual([]);
});
