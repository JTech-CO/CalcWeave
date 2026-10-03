import { test, expect, type Page } from '@playwright/test';
import { EXAMPLES } from '../../apps/web/src/examples';
import { blockRegistry } from '../../packages/block-library/src';
import type { HistoryRecord } from '../../apps/web/src/run-history';

async function open(page: Page) {
  await page.goto('/'); await page.evaluate(() => { indexedDB.deleteDatabase('calcweave-m0'); localStorage.clear(); }); await page.reload();
  await expect(page.locator('.block-node')).toHaveCount(3);
}
async function history(page: Page): Promise<HistoryRecord[]> {
  return page.evaluate(() => new Promise<HistoryRecord[]>((resolve, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onsuccess = () => { const database = opening.result, transaction = database.transaction('models', 'readonly'), reading = transaction.objectStore('models').get('run-history-v1'); reading.onsuccess = () => resolve(reading.result ?? []); transaction.oncomplete = () => database.close(); transaction.onerror = () => reject(new Error('History read failed')); };
    opening.onerror = () => reject(new Error('History open failed'));
  }));
}
async function example(page: Page, id: string) {
  await page.getByRole('button', { name: '예제로 시작', exact: true }).click(); await page.getByLabel('예제 검색', { exact: true }).fill(id);
  await page.locator(`[data-example-id="${id}"]`).click(); await expect(page.getByLabel('모델 이름')).toHaveValue(EXAMPLES.find(entry => entry.id === id)!.title);
}
function near(actual: unknown, expected: unknown) {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(actual as number).toBeCloseTo(expected, 11); }
  else if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect(actual).toHaveLength(expected.length); expected.forEach((value, index) => near((actual as unknown[])[index], value)); }
  else expect(actual).toEqual(expected);
}
for (const id of ['filter-realizations', 'tapped-history', 'weighted-sample-counter', 'pid-setpoint-weights']) {
  test(`M9 ${id} persists independently expected raw Worker sample history`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await example(page, id);
    await page.getByRole('button', { name: '시뮬레이션 실행', exact: false }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
    await expect.poll(async () => (await history(page))[0]?.model.modelId).toBe(id);
    const record = (await history(page))[0]!; expect(record.result.status).toBe('completed');
    const model = EXAMPLES.find(entry => entry.id === id)!.model; expect(record.result.samples).toHaveLength(Math.round((model.execution.stopTime - model.execution.startTime) / model.execution.step) + 1);
    for (const [tick, sample] of record.result.samples.entries()) {
      if (id === 'filter-realizations') { near(sample.values.input, 1); near(sample.values.result, 2 - 1.5 * .5 ** tick); }
      if (id === 'tapped-history') { near(sample.values.input, tick); near(sample.values.result, [Math.max(tick - 3, 0), Math.max(tick - 2, 0), Math.max(tick - 1, 0)]); }
      if (id === 'weighted-sample-counter') { near(sample.values.count, tick < 1 ? 0 : Math.floor((tick - 1) / 3) % 3); near(sample.values.seconds, tick < 1 ? 0 : .6); }
      if (id === 'pid-setpoint-weights') near(sample.values.result, .5 + .2 * (tick + 1));
    }
    expect(record.result.stateMemory).toBeDefined();
    await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click();
    await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python'); await expect(page.getByRole('button', { name: 'Python 코드 다운로드', exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('typescript'); await expect(page.getByRole('button', { name: 'TypeScript 코드 다운로드', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
test('M9 filter structures, preset search and dynamic ports are usable at desktop and mobile widths', async ({ page }, testInfo) => {
  await open(page); await expect(page.locator('.library-item')).toHaveCount(blockRegistry.length); await example(page, 'filter-realizations');
  await page.locator('.model-node-list button').filter({ hasText: '이산 필터' }).click();
  for (const structure of ['df1', 'df1t', 'df2', 'df2t']) {
    await page.getByRole('combobox', { name: '실현 구조', exact: true }).selectOption(structure);
    await page.getByRole('button', { name: '시뮬레이션 실행', exact: false }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
    await expect.poll(async () => (await history(page))[0]?.model.nodes.find(node => node.id === 'filter')?.parameters.structure).toBe(structure);
    near((await history(page))[0]!.result.samples[0]!.values.result, .5);
  }
  await page.getByRole('combobox', { name: '초기화 사건', exact: true }).selectOption('rising');
  await page.getByRole('combobox', { name: '실행 제어', exact: true }).selectOption('port');
  await expect(page.getByRole('combobox', { name: 'reset 입력 연결', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'enable 입력 연결', exact: true })).toBeVisible();
  await expect(page.getByLabel('이산 필터 입력 reset', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('이산 필터 입력 enable', { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByRole('button', { name: '도식 맞추기', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('m9-mobile-filter.png') });
  await page.getByRole('button', { name: '빠른 추가', exact: true }).click(); await page.getByLabel('빠른 추가 검색').fill('Lead / Lag Response');
  await expect(page.getByRole('option')).toHaveCount(1); await page.keyboard.press('Enter'); await expect(page.locator('.block-node')).toHaveCount(5);
});
