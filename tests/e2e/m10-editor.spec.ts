import { expectStandaloneSource } from './standalone-source';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { CalcModel, TypedSignal } from '../../packages/model/src';

async function openWorkspace(page: Page) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '계산하기', exact: false })).toBeVisible();
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function example(page: Page, id: string) {
  await page.getByRole('button', { name: '예제로 시작', exact: true }).click();
  await page.getByLabel('예제 카테고리').selectOption('typed');
  await page.locator(`[data-example-id="${id}"]`).click();
}
async function storedModel(page: Page): Promise<CalcModel | null> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onsuccess = () => { const database = request.result, transaction = database.transaction('models', 'readonly'), read = transaction.objectStore('models').get('current'); read.onsuccess = () => resolve(read.result ?? null); transaction.oncomplete = () => database.close(); transaction.onerror = () => reject(new Error('Read failed')); };
    request.onerror = () => reject(new Error('Open failed'));
  }));
}
async function importModel(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'typed-test.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('.canvas-topline strong')).toHaveText(model.name);
}
async function calculate(page: Page) { await page.getByRole('button', { name: '계산하기', exact: false }).click(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과'); }
function directTyped(value: TypedSignal): CalcModel {
  return { schemaVersion: 1, modelId: 'm10-browser-typed', name: '자료형 브라우저 확인', execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, nodes: [{ id: 'value', blockType: 'source.typed', blockVersion: 1, label: '자료형 입력', parameters: { value } }, { id: 'result', blockType: 'sink.display', blockVersion: 1, label: '자료형 결과', parameters: {} }], edges: [{ id: 'value-result', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }], layout: { value: { x: 40, y: 140 }, result: { x: 400, y: 140 } } };
}

test('M10 typed integer fields preserve 64-bit edits, block invalid drafts, save/import, and download CSV/TS', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page); await example(page, 'typed-integer64');
  await page.locator('.react-flow__node[data-id="integer"]').click();
  await expect(page.getByLabel('자료형 값 자료형')).toHaveValue('uint64');
  await expect(page.getByLabel('자료형 값 값', { exact: true })).toHaveValue('18446744073709551615');
  await page.getByLabel('자료형 값 자료형').selectOption('int64');
  const value = page.getByLabel('자료형 값 값', { exact: true });
  await value.fill('9223372036854775807'); await value.blur();
  await expect.poll(async () => (await storedModel(page))?.nodes.find(node => node.id === 'integer')?.parameters.value).toEqual({ kind: 'typed', dtype: 'int64', shape: [], data: ['9223372036854775807'] });
  await calculate(page);
  await expect(page.locator('.output-card').filter({ hasText: '원래 정수' }).locator('strong')).toHaveText('9223372036854775807');
  await value.fill('9223372036854775808'); await value.blur();
  await expect(value).toHaveAttribute('aria-invalid', 'true'); await page.getByRole('button', { name: '계산하기', exact: false }).click(); await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  expect((await storedModel(page))?.nodes.find(node => node.id === 'integer')?.parameters.value).toEqual({ kind: 'typed', dtype: 'int64', shape: [], data: ['9223372036854775807'] });
  await value.fill('9223372036854775807'); await value.blur();
  const modelDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '모델 다운로드', exact: true }).click();
  const snapshot = JSON.parse(await readFile((await (await modelDownload).path())!, 'utf8')) as CalcModel;
  expect((snapshot.nodes.find(node => node.id === 'integer')!.parameters.value as TypedSignal).data).toEqual(['9223372036854775807']);
  await page.reload(); await expect(page.locator('.canvas-topline strong')).toHaveText(snapshot.name);
  await importModel(page, snapshot); await calculate(page);
  const codeDownload = page.waitForEvent('download'); await page.getByRole('button', { name: /코드 다운로드/ }).click();
  const code = await readFile((await (await codeDownload).path())!, 'utf8'); expect(code).toContain('9223372036854775807'); expect(code).toContain('export function run'); expectStandaloneSource(code);
  await page.getByRole('tab', { name: '실험', exact: true }).click();
  const csvDownload = page.waitForEvent('download'); await page.locator('.history-card').first().getByRole('button', { name: '결과 CSV', exact: true }).click();
  const csv = await readFile((await (await csvDownload).path())!, 'utf8'); expect(csv).toContain('int64:9223372036854775807'); expect(csv).toContain('int64:9223372036854775806'); expect(csv).toContain('shape=[]'); expect(errors).toEqual([]);
});

test('M10 data-type parameters edit fixed metadata and keep invalid metadata uncommitted', async ({ page }) => {
  await openWorkspace(page); await example(page, 'typed-ieee-cast'); await page.locator('.react-flow__node[data-id="cast"]').click();
  await expect(page.getByLabel('출력 자료형 자료형')).toHaveValue('float32');
  await page.getByLabel('출력 자료형 자료형').selectOption('fixed');
  const bits = page.getByLabel('출력 자료형 비트 폭'), fraction = page.getByLabel('출력 자료형 소수 비트 수');
  await bits.fill('8'); await bits.blur(); await fraction.fill('2'); await fraction.blur();
  await calculate(page); await expect(page.locator('.output-card').filter({ hasText: 'float32 결과' }).locator('strong')).toHaveText('0 (코드 0)');
  await expect(page.locator('.output-card').filter({ hasText: 'float32 결과' }).locator('.result-type')).toContainText('fixed · signed 8비트 · 소수 2비트');
  await bits.fill('65'); await bits.blur(); await page.getByRole('button', { name: '계산하기', exact: false }).click(); await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  await expect.poll(async () => (await storedModel(page))?.nodes.find(node => node.id === 'cast')?.parameters.target).toEqual({ dtype: 'fixed', fixed: { signed: true, wordLength: 8, fractionLength: 2 } });
  await bits.fill('8'); await bits.blur(); await expect(page.getByRole('button', { name: '계산하기', exact: false })).toBeEnabled();
});

test('M10 n-D result tables expose true row-major coordinates and 100-element pages', async ({ page }) => {
  await openWorkspace(page); await example(page, 'typed-tensor-permute'); await calculate(page);
  await expect(page.locator('.output-card strong')).toHaveText('2 × 2 × 2 · 8개 값');
  await expect(page.locator('.typed-result caption')).toContainText('3D [2 × 2 × 2]');
  await expect(page.locator('.typed-result tbody td:last-child')).toHaveText(['1', '3', '5', '7', '2', '4', '6', '8']);
  await expect(page.locator('.typed-result tbody tr').last().locator('td').first()).toHaveText('[1, 1, 1]');
  const value: TypedSignal = { kind: 'typed', dtype: 'uint64', shape: Array(8).fill(2), data: Array.from({ length: 256 }, (_, index) => String(index)) };
  value.data[255] = '18446744073709551615';
  await importModel(page, directTyped(value)); await calculate(page);
  await expect(page.locator('.typed-result tbody tr')).toHaveCount(100); await expect(page.locator('.typed-result caption')).toContainText('8D [2 × 2 × 2 × 2 × 2 × 2 × 2 × 2]');
  await page.locator('.typed-result').getByRole('button', { name: '다음 100개', exact: true }).click(); await expect(page.locator('.typed-result tbody tr')).toHaveCount(100);
  await page.locator('.typed-result').getByRole('button', { name: '다음 100개', exact: true }).click(); await expect(page.locator('.typed-result tbody tr')).toHaveCount(56);
  await expect(page.locator('.typed-result tbody tr').last().locator('td').first()).toHaveText('[1, 1, 1, 1, 1, 1, 1, 1]');
  await expect(page.locator('.typed-result tbody td:last-child').last()).toHaveText('18446744073709551615');
});

test('M10 complex scalar editors preserve signed zero and complex matrices display independent components', async ({ page }) => {
  await openWorkspace(page); await importModel(page, directTyped({ kind: 'typed', dtype: 'complex128', shape: [], data: [{ re: 3, im: '-0' }] }));
  await page.locator('.react-flow__node[data-id="value"]').click(); await expect(page.getByLabel('자료형 값 허수')).toHaveValue('-0');
  await calculate(page); await expect(page.locator('.output-card strong')).toHaveText('3 − 0i');
  await page.getByLabel('자료형 값 실수').fill('2'); await page.getByLabel('자료형 값 실수').blur(); await page.getByLabel('자료형 값 허수').fill('3'); await page.getByLabel('자료형 값 허수').blur();
  await calculate(page); await expect(page.locator('.output-card strong')).toHaveText('2 + 3i');
  await example(page, 'typed-complex-hermitian'); await calculate(page);
  await page.locator('.output-card').filter({ hasText: '켤레 전치 결과' }).click();
  await expect(page.locator('.typed-result tbody tr')).toHaveCount(4); await expect(page.locator('.typed-result thead th')).toHaveText(['인덱스', '좌표', '실수', '허수']);
  await expect(page.locator('.typed-result tbody tr').nth(1).locator('td')).toHaveText(['[0, 1]', '2', '3']);
});

test('M10 categorized string and enum examples escape markup and validate enum membership', async ({ page }) => {
  await openWorkspace(page); await page.getByRole('button', { name: '예제로 시작', exact: true }).click(); await page.getByLabel('예제 카테고리').selectOption('typed');
  await expect(page.locator('[data-example-id]')).toHaveCount(6); await page.locator('[data-example-id="typed-string-enum"]').click();
  await page.locator('.react-flow__node[data-id="mode"]').click();
  await expect(page.getByLabel('열거 값 열거 이름')).toHaveValue('Mode');
  await page.getByLabel('열거 값 값', { exact: true }).fill('Unknown'); await page.getByLabel('열거 값 값', { exact: true }).blur();
  await page.getByRole('button', { name: '계산하기', exact: false }).click(); await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  await page.getByLabel('열거 값 값', { exact: true }).fill('Off'); await page.getByLabel('열거 값 값', { exact: true }).blur(); await calculate(page);
  await expect(page.locator('.output-card').filter({ hasText: '열거 결과' }).locator('strong')).toHaveText('Off');
  await page.locator('.react-flow__node[data-id="text"]').click();
  await page.getByLabel('자료형 값 전체 값').fill('["<img src=x onerror=alert(1)>","=1+1","한글"]'); await page.getByLabel('자료형 값 전체 값').blur(); await calculate(page);
  await page.locator('.output-card').filter({ hasText: '문자열 결과' }).click();
  await expect(page.locator('.typed-result tbody td:last-child').first()).toHaveText('<img src=x onerror=alert(1)>'); await expect(page.locator('.typed-result img')).toHaveCount(0);
});

test('M10 typed controls and exact results stay contained at narrow widths and 200% text', async ({ page }, testInfo) => {
  await openWorkspace(page); await example(page, 'typed-fixed-overflow'); await page.locator('.react-flow__node[data-id="value"]').click(); await calculate(page);
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.app-shell').evaluate(shell => shell.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경`, exact: true }).click();
    for (const [width, scale] of [[1440, 1], [1440, 2], [390, 1], [320, 2]]) {
      await page.setViewportSize({ width, height: 1000 }); await page.addStyleTag({ content: `html { font-size: ${16 * scale}px !important; }` });
      await expect.poll(() => page.evaluate(() => ({ document: document.documentElement.scrollWidth <= innerWidth + 1, controls: [...document.querySelectorAll('.typed-field input,.typed-field select,.typed-field textarea')].every(element => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth + 1; }) }))).toEqual({ document: true, controls: true });
      await expect(page.locator('.typed-field')).toBeVisible();
      if (width === 1440 && scale === 1) {
        // A taller capture exposes the full inspector field; the 1000px viewport is checked above.
        await page.setViewportSize({ width, height: 1600 });
        await page.locator('.typed-field').screenshot({ path: testInfo.outputPath(`typed-field-${theme}-${width}-${scale}x.png`) });
        await page.setViewportSize({ width, height: 1000 });
      } else if (width === 320) await page.locator('.typed-field').screenshot({ path: testInfo.outputPath(`typed-field-${theme}-${width}-${scale}x.png`) });
    }
  }
});

test('M10 typed finite curves visualize fixed state-space and uint64 while keeping exact records', async ({ page }) => {
  await openWorkspace(page);
  const fixed = (shape: number[], data: string[]): TypedSignal => ({ kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 8 }, shape, data });
  const model = directTyped(fixed([1], ['256']));
  model.name = '고정소수점 상태 공간 곡선'; model.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: 1 };
  model.nodes.push({ id: 'state', blockType: 'fixed.state-space', blockVersion: 1, label: '고정 상태 공간', parameters: { A: fixed([1, 1], ['128']), B: fixed([1, 1], ['256']), C: fixed([1, 1], ['256']), D: fixed([1, 1], ['0']), initial: fixed([1], ['0']) } });
  model.nodes.find(node => node.id === 'result')!.blockType = 'sink.scope';
  model.edges = [{ id: 'value-state', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'state', portId: 'in' } }, { id: 'state-result', source: { nodeId: 'state', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }];
  model.layout.state = { x: 300, y: 140 }; model.layout.result = { x: 590, y: 140 };
  await importModel(page, model); await page.getByRole('button', { name: '시뮬레이션 실행', exact: false }).click();
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  // State-space outputs are rank-one vectors. Select a scalar output through an explicit reshape.
  await expect(page.locator('.plot-empty')).toContainText('배열은 아래 결과표');
  const reshape = { id: 'scalar', blockType: 'tensor.reshape' as const, blockVersion: 1 as const, label: '스칼라 형상', parameters: { dimensions: [] } };
  model.nodes.push(reshape); model.layout.scalar = { x: 500, y: 140 }; model.layout.result = { x: 750, y: 140 };
  model.edges[1] = { id: 'state-scalar', source: { nodeId: 'state', portId: 'out' }, target: { nodeId: 'scalar', portId: 'in' } };
  model.edges.push({ id: 'scalar-result', source: { nodeId: 'scalar', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
  await importModel(page, model); await page.getByRole('button', { name: '시뮬레이션 실행', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('1.5 (코드 384)'); await expect(page.locator('.result-plot')).toBeVisible(); await expect(page.locator('.typed-plot-note')).toContainText('float64 시각화');
  await page.locator('.result-table summary').click(); await expect(page.locator('.result-table tbody td:last-child')).toHaveText(['0 (코드 0)', '1 (코드 256)', '1.5 (코드 384)']);
  const integerModel = directTyped({ kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] }); integerModel.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: 1 }; integerModel.nodes[1]!.blockType = 'sink.scope';
  await importModel(page, integerModel); await page.getByRole('button', { name: '시뮬레이션 실행', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('18446744073709551615'); await expect(page.locator('.result-plot')).toBeVisible();
  await page.locator('.result-table summary').click(); await expect(page.locator('.result-table tbody td:last-child')).toHaveText(Array(3).fill('18446744073709551615'));
  await page.getByLabel('Scope 종료 시간').fill('4'); await page.getByRole('button', { name: '범위 적용 후 실행', exact: true }).click();
  await expect(page.locator('.run-metadata strong')).toHaveText('5 샘플'); await expect(page.locator('.result-plot')).toHaveAttribute('aria-label', /종료 4,/);
  await expect(page.locator('.result-table tbody td:last-child')).toHaveText(Array(5).fill('18446744073709551615'));
});
