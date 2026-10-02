import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { EXAMPLES, EXAMPLE_CATEGORIES } from '../../apps/web/src/examples';
import type { HistoryRecord } from '../../apps/web/src/run-history';

async function open(page: Page) { await page.goto('/'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function picker(page: Page) { await page.getByRole('button', { name: '예제로 시작', exact: true }).click(); await expect(page.getByLabel('예제 검색', { exact: true })).toBeFocused(); return page.getByRole('region', { name: '예제 찾기', exact: true }); }
async function history(page: Page): Promise<HistoryRecord[]> {
  return page.evaluate(() => new Promise<HistoryRecord[]>((resolve, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onsuccess = () => { const database = opening.result, transaction = database.transaction('models', 'readonly'), reading = transaction.objectStore('models').get('run-history-v1'); reading.onsuccess = () => resolve(reading.result ?? []); transaction.oncomplete = () => database.close(); transaction.onerror = () => reject(new Error('History read failed')); };
    opening.onerror = () => reject(new Error('History open failed'));
  }));
}
function expectNumeric(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(actual as number).toBeCloseTo(expected, 12); }
  else if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect(actual).toHaveLength(expected.length); expected.forEach((value, index) => expectNumeric((actual as unknown[])[index], value)); }
  else expect(actual).toEqual(expected);
}
async function downloadedArchive(page: Page, label: string): Promise<Record<string, string>> {
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click();
  const bytes = await readFile((await (await downloading).path())!), files: Record<string, string> = {}; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extraLength;
    files[name] = bytes.subarray(start, start + length).toString('utf8'); offset = start + length;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50); return files;
}

test('Example catalog groups every original model, filters categories and searches descriptions or block names', async ({ page }) => {
  await open(page); const catalog = await picker(page);
  await expect(catalog.locator('[data-example-id]')).toHaveCount(EXAMPLES.length);
  for (const category of EXAMPLE_CATEGORIES) {
    await expect(catalog.getByRole('heading', { name: new RegExp(category.label) })).toBeVisible();
    await page.getByRole('combobox', { name: '예제 카테고리', exact: true }).selectOption(category.id);
    await expect(catalog.locator('[data-example-id]')).toHaveCount(EXAMPLES.filter(example => example.category === category.id).length);
    await page.getByRole('combobox', { name: '예제 카테고리', exact: true }).selectOption('');
  }
  await page.getByLabel('예제 검색', { exact: true }).fill('fir'); await expect(catalog.locator('[data-example-id]')).toHaveCount(1);
  await expect(catalog.getByRole('button', { name: /FIR impulse 응답/ })).toBeVisible();
  await page.getByLabel('예제 검색', { exact: true }).fill('source.chirp'); await expect(catalog.locator('[data-example-id]')).toHaveCount(1); await expect(catalog.getByRole('button', { name: /주파수 스윕 관찰/ })).toBeVisible();
  await page.getByLabel('예제 검색', { exact: true }).fill('대시보드'); await expect(catalog.getByRole('button', { name: /데이터를 재생하고 조절하기/ })).toBeVisible();
  await page.getByLabel('예제 검색', { exact: true }).fill('찾을 수 없는 예제'); await expect(catalog.locator('[data-example-id]')).toHaveCount(0);
  await catalog.getByRole('button', { name: '검색 초기화', exact: true }).click(); await expect(catalog.locator('[data-example-id]')).toHaveCount(EXAMPLES.length);
});

test('Example selection remains compatible with the original popup buttons and keyboard search', async ({ page }) => {
  await open(page); const trigger = page.getByRole('button', { name: '예제로 시작', exact: true });
  await trigger.focus(); await page.keyboard.press('Space'); await expect(page.locator('.examples-menu')).toBeVisible();
  await page.locator('.examples-menu').getByRole('button', { name: /시간에 따른 감쇠/ }).click(); await expect(page.getByLabel('모델 이름')).toHaveValue('시간에 따른 감쇠');
  await trigger.click(); await page.getByLabel('예제 검색', { exact: true }).fill('FIR'); await page.keyboard.press('Enter'); await expect(page.getByLabel('모델 이름')).toHaveValue('FIR impulse 응답');
  await expect(trigger).toBeFocused(); await trigger.click(); await page.keyboard.press('Escape'); await expect(page.locator('.examples-menu')).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('Quick insert and example triggers show names without shortcut or text caret decorations', async ({ page }) => {
  await open(page); const quick = page.getByRole('button', { name: '빠른 추가', exact: true }), examples = page.getByRole('button', { name: '예제로 시작', exact: true });
  await expect(quick).toHaveText('빠른 추가'); await expect(quick).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K'); await expect(examples).toHaveText('예제로 시작');
  await page.keyboard.press('Control+k'); await expect(page.getByRole('combobox', { name: '빠른 추가 검색' })).toBeFocused(); await page.keyboard.press('Escape');
});

test('Example picker stays within both theme viewports and does not edit behind its search', async ({ page }, testInfo) => {
  await open(page); const original = await page.getByLabel('모델 이름').inputValue();
  for (const theme of ['dark', 'light'] as const) {
    if (await page.locator('.app-shell').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경`, exact: true }).click();
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 }); const catalog = await picker(page);
      const geometry = await catalog.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }; });
      expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth); expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight); expect(geometry.documentWidth).toBe(geometry.viewportWidth); expect(geometry.scrollWidth).toBe(geometry.clientWidth);
      if (width === 1440 || width === 320) await page.screenshot({ path: testInfo.outputPath(`catalog-${theme}-${width}.png`) });
      await page.getByLabel('예제 검색', { exact: true }).fill('FIR'); await page.keyboard.press('Control+Enter'); await expect(page.getByLabel('모델 이름')).toHaveValue(original); await expect(catalog.locator('[data-example-id]')).toHaveCount(1);
      await page.getByLabel('예제 검색', { exact: true }).fill('<script>'); await expect(catalog.locator('[data-example-id]')).toHaveCount(0); await page.keyboard.press('Control+Enter'); await expect(page.locator('.result-status.current')).toHaveCount(0); await expect(page.getByLabel('모델 이름')).toHaveValue(original);
      await page.keyboard.press('Escape');
    }
  }
});

for (const fixture of [
  { id: 'vector-statistics', expected: { 'sum-result': 6, 'mean-result': 2, 'variance-result': 2 / 3 } },
  { id: 'matrix-diagonal-selection', expected: { 'diagonal-result': [1, 5, 9], 'select-result': [[2, 3], [8, 9]], 'trace-result': 15 } },
  { id: 'dead-zone-quantizer-sinc', expected: { 'dead-zone-result': [-1, 0, 0, 0, 1], 'quantizer-result': [-2, -1, 0, 1, 2], 'sinc-result': [0, 2 / Math.PI, 1, 2 / Math.PI, 0] } },
]) {
  test(`Expanded ${fixture.id} example produces real raw Worker results after catalog selection`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); const catalog = await picker(page);
    await page.getByLabel('예제 검색', { exact: true }).fill(fixture.id); await catalog.locator(`[data-example-id="${fixture.id}"]`).click();
    await expect(page.getByLabel('모델 이름')).toHaveValue(EXAMPLES.find(example => example.id === fixture.id)!.title);
    await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
    await expect.poll(async () => (await history(page))[0]?.model.modelId).toBe(fixture.id);
    const record = (await history(page))[0]!; expect(record.result.status).toBe('completed'); expect(record.result.samples).toHaveLength(1);
    for (const [outputId, expected] of Object.entries(fixture.expected)) expectNumeric(record.result.samples[0].values[outputId], expected);
    expect(errors).toEqual([]);
    if (fixture.id === 'vector-statistics') {
      await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click(); await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python');
      await expect(page.locator('.export-diagnostics')).toContainText('sum'); await expect(page.getByRole('button', { name: 'Python 코드 다운로드', exact: true })).toBeDisabled();
      await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('typescript'); await expect(page.getByRole('button', { name: 'TypeScript 코드 다운로드', exact: true })).toBeEnabled();
      const dialogArchive = await downloadedArchive(page, 'TypeScript 실행 묶음'); await page.keyboard.press('Escape');
      const headerArchive = await downloadedArchive(page, '실행 묶음');
      for (const files of [dialogArchive, headerArchive]) {
        expect(Object.keys(files).sort()).toEqual(['README.md', 'expected-output.json', 'manifest.json', 'model.cw.json', 'model.ts', 'run-example.ts']);
        expect(JSON.parse(files['manifest.json']).targetVersion).toBe('typescript-catalog-v1'); expect(files['README.md']).toContain('144개 블록'); expect(files['README.md']).toContain('승인된 M4'); expect(files['README.md']).toContain('승인된 M5');
        expect(files['model.ts']).toContain('reduce.sum'); expect(JSON.parse(files['expected-output.json']).samples).toEqual(record.result.samples);
      }
    }
  });
}

for (const id of ['chirp-sweep', 'signal-curves']) {
  test(`Expanded ${id} source example records its sampled mathematical signal through the Worker`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); const catalog = await picker(page);
    await page.getByRole('combobox', { name: '예제 카테고리', exact: true }).selectOption('signals'); await catalog.locator(`[data-example-id="${id}"]`).click();
    await expect(page.getByLabel('모델 이름')).toHaveValue(EXAMPLES.find(example => example.id === id)!.title);
    await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
    await expect.poll(async () => (await history(page))[0]?.model.modelId).toBe(id);
    const record = (await history(page))[0]!; expect(record.result.status).toBe('completed'); expect(record.result.samples).toHaveLength(61);
    record.result.samples.forEach((sample, index) => {
      const time = index * 0.05; expect(sample.time).toBeCloseTo(time, 12);
      if (id === 'chirp-sweep') { const cycles = time <= 2 ? 0.5 * time + 0.25 * time ** 2 : 2 + 1.5 * (time - 2); expectNumeric(sample.values.result, Math.sin(2 * Math.PI * cycles)); }
      else { expectNumeric(sample.values['gaussian-result'], Math.exp(-0.5 * ((time - 1) / 0.25) ** 2)); expectNumeric(sample.values['damped-result'], Math.exp(-0.5 * time) * Math.sin(2 * Math.PI * time)); expectNumeric(sample.values['logistic-result'], 1 / (1 + Math.exp(-4 * (time - 1)))); }
    }); expect(errors).toEqual([]);
  });
}
