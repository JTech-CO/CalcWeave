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

for (const fixture of [
  { id: 'nd-lookup', outputs: { result: 3.25 } },
  { id: 'matrix-inspection', outputs: { gram: [[16, 0], [0, 25]], indices: [1, 2, -1, -1], count: 2 } },
]) {
  test(`M8 ${fixture.id} records independently expected raw Worker outputs`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await example(page, fixture.id);
    await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
    await expect.poll(async () => (await history(page))[0]?.model.modelId).toBe(fixture.id);
    const record = (await history(page))[0]!; expect(record.result.status).toBe('completed'); expect(record.result.samples).toHaveLength(1);
    for (const [id, expected] of Object.entries(fixture.outputs)) near(record.result.samples[0]!.values[id], expected);
    await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click();
    await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python'); await expect(page.getByRole('button', { name: 'Python 코드 다운로드', exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('typescript'); await expect(page.getByRole('button', { name: 'TypeScript 코드 다운로드', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
test('M8 dynamic saturation clamps every recorded raw sample', async ({ page }) => {
  await open(page); await example(page, 'dynamic-limits'); await page.getByRole('button', { name: '시뮬레이션 실행', exact: false }).click();
  await expect(page.locator('.result-status.current')).toBeVisible(); await expect.poll(async () => (await history(page))[0]?.model.modelId).toBe('dynamic-limits');
  const record = (await history(page))[0]!; expect(record.result.samples).toHaveLength(41);
  for (const sample of record.result.samples) { const original = 3 * Math.sin(2 * Math.PI * sample.time); near(sample.values.original, original); near(sample.values.limited, Math.max(-1, Math.min(1, original))); }
});
test('M8 preset search, registry support and nD settings remain usable on a narrow screen', async ({ page }, testInfo) => {
  await open(page); await expect(page.locator('.library-item')).toHaveCount(blockRegistry.length);
  await page.getByRole('button', { name: '빠른 추가', exact: true }).click(); await page.getByLabel('빠른 추가 검색').fill('Euler');
  await expect(page.getByRole('option')).toHaveCount(1); await page.keyboard.press('Enter'); await expect(page.locator('.block-node')).toHaveCount(4);
  await example(page, 'nd-lookup'); await page.locator('.model-node-list button').filter({ hasText: '3차원 조회 표' }).click();
  await page.setViewportSize({ width: 390, height: 1000 }); await page.getByRole('button', { name: '도식 맞추기' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('m8-mobile-settings.png') });
});
