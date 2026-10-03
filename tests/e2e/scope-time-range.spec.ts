import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ENGINE_VERSION } from '../../packages/model/src';
import { APP_VERSION } from '../../packages/release/src';
import type { CalcModel } from '../../packages/model/src';
import type { HistoryRecord } from '../../apps/web/src/run-history';

const evidencePath = (name: string) => `docs/evidence/${String(APP_VERSION) === '0.8.1' ? 'pages' : ENGINE_VERSION.split('-').at(-1)}-${name}`;

function delayModel(): CalcModel {
  return {
    schemaVersion: 1, modelId: 'scope-delayed-clock', name: '3초 지연 응답',
    nodes: [
      { id: 'clock', blockType: 'source.clock', blockVersion: 1, label: '시계', parameters: {}, unit: 's' },
      { id: 'delay', blockType: 'discrete.delay', blockVersion: 1, label: '3초 지연', parameters: { steps: 6, initial: 0 }, unit: 's' },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '지연 응답', parameters: {} },
    ],
    edges: [
      { id: 'clock-delay', source: { nodeId: 'clock', portId: 'out' }, target: { nodeId: 'delay', portId: 'in' } },
      { id: 'delay-scope', source: { nodeId: 'delay', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } },
    ],
    execution: { mode: 'discrete', startTime: 0, stopTime: 2, step: 0.5 },
    layout: { clock: { x: 40, y: 140 }, delay: { x: 290, y: 140 }, scope: { x: 540, y: 140 } },
    dashboard: [{ id: 'response-widget', kind: 'scope', title: '지연 응답 Scope', nodeId: 'scope' }],
  };
}

async function openAndRun(page: Page) {
  await page.goto('/');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  const model = delayModel();
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'delay.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('.statusbar')).toContainText(`${model.name} 모델을 불러왔습니다.`);
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('5 샘플');
  await expect(page.locator('.output-card strong')).toHaveText('0');
  await expect.poll(async () => (await history(page))?.length).toBe(1);
}

async function stored<T>(page: Page, key: string): Promise<T> {
  return page.evaluate(async key => new Promise<T>((resolve, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction('models', 'readonly');
      const reading = transaction.objectStore('models').get(key);
      reading.onsuccess = () => resolve(reading.result as T);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(new Error('Read failed'));
    };
    opening.onerror = () => reject(new Error('Open failed'));
  }), key);
}
async function history(page: Page) { return stored<HistoryRecord[]>(page, 'run-history-v1'); }
function range(page: Page) { return page.getByRole('form', { name: 'Scope 시간 범위' }); }
async function apply(form: Locator, start: string, stop: string) {
  await form.getByLabel('Scope 시작 시간', { exact: true }).fill(start);
  await form.getByLabel('Scope 종료 시간', { exact: true }).fill(stop);
  await form.getByRole('button', { name: '범위 적용 후 실행', exact: true }).click();
}
async function modelDownload(page: Page): Promise<CalcModel> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '모델 다운로드', exact: true }).click();
  return JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as CalcModel;
}

test('Scope extends the actual delayed response and preserves the original history, model export and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openAndRun(page);
  const original = (await history(page))[0]!;
  await expect(page.locator('.result-plot')).toHaveAttribute('aria-label', /시작 0, 종료 2/);
  await apply(range(page), '0', '6');
  await expect(page.locator('.run-metadata')).toContainText('13 샘플');
  await expect(page.locator('.output-card strong')).toHaveText('3');
  await expect(page.locator('.result-plot')).toHaveAttribute('aria-label', /시작 0, 종료 6/);
  await expect(page.locator('.plot-x-labels span').last()).toHaveText('6 s');
  await expect.poll(async () => (await history(page))?.length).toBe(2);
  const records = await history(page), extended = records.find(record => record.model.execution.stopTime === 6)!;
  expect(records.find(record => record.id === original.id)).toEqual(original);
  expect(extended.result.samples.map(sample => sample.time)).toEqual(Array.from({ length: 13 }, (_, index) => index * 0.5));
  expect(extended.result.samples.map(sample => sample.values.scope)).toEqual([0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3]);
  expect(extended.semanticHash).not.toBe(original.semanticHash);
  const exported = await modelDownload(page);
  expect(exported.execution).toEqual({ mode: 'discrete', startTime: 0, stopTime: 6, step: 0.5 });
  await expect.poll(async () => (await stored<CalcModel>(page, 'current'))?.execution.stopTime).toBe(6);
  await page.locator('.plot-frame').scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidencePath('scope-time-range.png'), fullPage: true });
  await page.reload();
  await expect(page.getByLabel('종료 시간', { exact: true })).toHaveValue('6');
  await expect.poll(async () => (await history(page))?.length).toBe(2);
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('13 샘플');
  await expect(page.locator('.output-card strong')).toHaveText('3');
  await expect(range(page).getByLabel('Scope 종료 시간')).toHaveValue('6');
  expect(errors).toEqual([]);
});

for (const invalid of [
  { title: 'blank', start: '0', stop: '', message: '유한한 숫자' },
  { title: 'Infinity', start: '0', stop: 'Infinity', message: '유한한 숫자' },
  { title: 'reversed', start: '4', stop: '2', message: '시작 시간보다 크게' },
  { title: 'off-grid', start: '0', stop: '3.25', message: '정수 배수' },
  { title: 'tick budget', start: '0', stop: '5000.5', message: '10,000개 이하' },
]) {
  test(`Scope rejects ${invalid.title} atomically and keeps the model, result and history`, async ({ page }) => {
    await openAndRun(page);
    await expect.poll(async () => (await stored<CalcModel>(page, 'current'))?.modelId).toBe('scope-delayed-clock');
    const previousModel = await stored<CalcModel>(page, 'current'), previousHistory = await history(page);
    await apply(range(page), invalid.start, invalid.stop);
    await expect(range(page).getByRole('alert')).toContainText(invalid.message);
    await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
    await expect(page.locator('.run-metadata')).toContainText('5 샘플');
    await expect(page.locator('.result-plot')).toHaveAttribute('aria-label', /시작 0, 종료 2/);
    expect(await modelDownload(page)).toEqual(previousModel);
    expect(await stored<CalcModel>(page, 'current')).toEqual(previousModel);
    expect(await history(page)).toEqual(previousHistory);
    await expect(range(page).getByRole('button', { name: '범위 적용 후 실행' })).toBeEnabled();
  });
}

test('Dashboard Scope shares the root time range, runs from its new start and updates the diagram graph', async ({ page }) => {
  await openAndRun(page);
  await page.getByRole('tab', { name: '대시보드', exact: true }).click();
  await expect(page.locator('.dashboard-card .result-plot')).toHaveAttribute('aria-label', /시작 0, 종료 2/);
  await apply(range(page), '1', '5');
  await expect(page.locator('.dashboard-card .result-plot')).toHaveAttribute('aria-label', /시작 1, 종료 5/);
  await expect(page.locator('.dashboard-card .plot-x-labels')).toHaveText('1 s5 s');
  await expect(page.locator('.dashboard-grid')).not.toContainText('이전 실행 결과');
  await expect.poll(async () => (await history(page))?.length).toBe(2);
  const latest = (await history(page)).find(record => record.model.execution.startTime === 1)!;
  expect(latest.result.samples).toHaveLength(9);
  expect(latest.result.samples[0]).toEqual({ time: 1, values: { scope: 0 } });
  expect(latest.result.samples.at(-1)).toEqual({ time: 5, values: { scope: 2 } });
  await page.getByRole('tab', { name: '도식', exact: true }).click();
  await expect(range(page).getByLabel('Scope 시작 시간')).toHaveValue('1');
  await expect(range(page).getByLabel('Scope 종료 시간')).toHaveValue('5');
  await expect(page.getByLabel('시작 시간', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('종료 시간', { exact: true })).toHaveValue('5');
  await expect(page.locator('.result-plot')).toHaveAttribute('aria-label', /시작 1, 종료 5/);
  await expect(page.locator('.run-metadata')).toContainText('9 샘플');
});

for (const width of [320, 390]) for (const theme of ['dark', 'light'] as const) {
  test(`Scope controls and SVG axes stay readable without overflow at ${width}px in ${theme}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openAndRun(page);
    if (theme === 'light') await page.getByRole('button', { name: '라이트 테마로 변경' }).click();
    await page.setViewportSize({ width, height: 1000 });
    await apply(range(page), '0', '6');
    await expect(page.locator('.result-plot')).toHaveAttribute('aria-label', /종료 6/);
    for (const tab of ['도식', '대시보드']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(range(page)).toBeVisible();
      const metrics = await page.evaluate(() => {
        const shell = document.querySelector('.app-shell')!, form = document.querySelector('.scope-time-range')!;
        const plot = document.querySelector('.result-plot')!, path = plot.querySelector('path')!;
        const shellStyle = getComputedStyle(shell), fieldBounds = form.getBoundingClientRect();
        const colorProbe = document.createElement('span'); shell.append(colorProbe);
        colorProbe.style.color = 'var(--muted)'; const muted = getComputedStyle(colorProbe).color;
        colorProbe.style.color = 'var(--accent)'; const accent = getComputedStyle(colorProbe).color; colorProbe.remove();
        return {
          documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          formOverflow: form.scrollWidth > form.clientWidth + 1,
          inputFonts: [...form.querySelectorAll('input')].map(input => parseFloat(getComputedStyle(input).fontSize)),
          inputsWithinForm: [...form.querySelectorAll('input')].every(input => { const bounds = input.getBoundingClientRect(); return bounds.left >= fieldBounds.left - 1 && bounds.right <= fieldBounds.right + 1; }),
          axisColors: [...document.querySelectorAll('.plot-x-labels, .plot-y-labels')].map(axis => getComputedStyle(axis).color),
          muted, accent, stroke: getComputedStyle(path).stroke, background: shellStyle.getPropertyValue('--surface').trim(),
        };
      });
      expect(metrics.documentOverflow).toBe(false); expect(metrics.formOverflow).toBe(false);
      expect(metrics.inputsWithinForm).toBe(true); expect(metrics.inputFonts.every(font => font >= 14)).toBe(true);
      expect(metrics.axisColors.length).toBeGreaterThanOrEqual(2);
      expect(metrics.axisColors.every(color => color === metrics.muted)).toBe(true);
      expect(metrics.stroke).toBe(metrics.accent);
      await expect(page.locator('.plot-x-labels').last()).toHaveText('0 s6 s');
    }
    await page.locator('.dashboard-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidencePath(`scope-time-range-${width}-${theme}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
