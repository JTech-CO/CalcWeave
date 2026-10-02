import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createExample } from '../../apps/web/src/examples';
import { getBlockDefinition } from '../../packages/block-library/src';
import type { CalcModel, SignalValue } from '../../packages/model/src';
import type { HistoryRecord } from '../../apps/web/src/run-history';

async function open(page: Page) { await page.goto('/'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function importModel(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm5.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('.statusbar')).toContainText(`${model.name} 모델을 불러왔습니다.`);
}
async function stored<T>(page: Page, key: string): Promise<T> {
  return page.evaluate(async key => new Promise<T>((resolve, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction('models', 'readonly'), reading = tx.objectStore('models').get(key);
      reading.onsuccess = () => resolve(reading.result as T); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('Read failed'));
    }; opening.onerror = () => reject(new Error('Open failed'));
  }), key);
}
async function history(page: Page) { return stored<HistoryRecord[]>(page, 'run-history-v1'); }
async function run(page: Page, expectedHistory: number) {
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  await expect.poll(async () => (await history(page))?.length).toBe(expectedHistory);
  return (await history(page))[0]!;
}
async function node(page: Page, model: CalcModel, id: string) {
  await page.getByRole('button', { name: '루트 모델', exact: true }).click();
  await page.locator('.model-node-list').getByRole('button', { name: model.nodes.find(item => item.id === id)!.label, exact: true }).click();
}
function parameterLabel(model: CalcModel, nodeId: string, key: string) { return getBlockDefinition(model.nodes.find(item => item.id === nodeId)!.blockType)!.parameters[key]!.label; }
async function editJson(page: Page, model: CalcModel, nodeId: string, key: string, value: unknown) {
  await node(page, model, nodeId); const field = page.getByLabel(parameterLabel(model, nodeId, key), { exact: true });
  await field.fill(JSON.stringify(value)); await field.press('Tab');
}
async function download(page: Page, label: string) {
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click(); return readFile((await (await downloading).path())!);
}
function unzipStored(bytes: Buffer) {
  const files: Record<string, string> = {}; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extraLength;
    files[name] = bytes.subarray(start, start + length).toString('utf8'); offset = start + length;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50); return files;
}
function expectNumeric(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(actual as number).toBeCloseTo(expected, 12); }
  else if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect(actual).toHaveLength(expected.length); expected.forEach((value, index) => expectNumeric((actual as unknown[])[index], value)); }
  else expect(actual).toEqual(expected);
}

test('M5 matrix solve and pivot LU expose all raw matrix ports, persist across reload and export the matching ZIP snapshot', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  const model = createExample('matrix-solve-lu'); await importModel(page, model); const record = await run(page, 1);
  expect(record.result.samples[0]!.values).toMatchObject({ lower: [[1, 0], [0, 1]], upper: [[1, 3], [0, 2]], permutation: [[0, 1], [1, 0]] });
  expectNumeric(record.result.samples[0]!.values.solution, [[1], [2]]);
  await expect(page.locator('.react-flow__node[data-id="lu"] .output-port .react-flow__handle')).toHaveCount(3);
  await page.locator('.output-card').filter({ hasText: '행 순서 P' }).click(); await expect(page.locator('.signal-result tbody tr')).toHaveCount(4);
  await expect(page.locator('.signal-result tbody tr').nth(1)).toContainText('1');
  await node(page, model, 'lu'); await expect(page.getByLabel('출력 포트')).toHaveValue('lower');
  await page.getByLabel('출력 포트').selectOption('permutation'); await expect(page.locator('.inspector-content')).toContainText('P A = L U');
  const files = unzipStored(await download(page, '실행 묶음'));
  expect(JSON.parse(files['manifest.json']!).targetVersion).toBe('typescript-m5-v1');
  expect(JSON.parse(files['expected-output.json']!).samples[0].values).toEqual(record.result.samples[0]!.values);
  expect(files['README.md']).toContain('승인된 M5'); expect(files['README.md']).toContain('최대 32-bit');
  expect(files['model.ts']).toContain('matrix.lu');
  await expect.poll(async () => (await stored<CalcModel>(page, 'current'))?.modelId).toBe(model.modelId);
  await page.reload(); await expect(page.locator('.model-node-list')).toContainText('행 피벗 LU');
  const restored = await run(page, 2); expect(restored.result.samples[0]!.values).toEqual(record.result.samples[0]!.values);
  expect(restored.semanticHash).toBe(record.semanticHash); expect(errors).toEqual([]);
});

for (const fixture of [
  { blockType: 'math.matrix-multiply', a: [[1, 2, 3], [4, 5, 6]], b: [[7, 8], [9, 10], [11, 12]], expected: [[58, 64], [139, 154]] },
  { blockType: 'matrix.transpose', a: [[1, 2, 3], [4, 5, 6]], expected: [[1, 4], [2, 5], [3, 6]] },
  { blockType: 'matrix.determinant', a: [[0, 2], [1, 3]], expected: -2 },
  { blockType: 'matrix.inverse', a: [[0, 2], [1, 3]], expected: [[-1.5, 1], [0.5, 0]] },
  { blockType: 'matrix.cholesky', a: [[4, 2], [2, 5]], expected: [[2, 0], [1, 2]] },
] satisfies { blockType: string; a: number[][]; b?: number[][]; expected: SignalValue }[]) {
  test(`M5 ${fixture.blockType} calculates the real matrix result through the Worker`, async ({ page }) => {
    await open(page); const model = createExample('first-calculation'); model.name = fixture.blockType; model.modelId = 'matrix-operation';
    model.nodes = [{ id: 'a', blockType: 'source.constant', blockVersion: 1, label: '행렬 A', parameters: { value: fixture.a } }, { id: 'operation', blockType: fixture.blockType, blockVersion: 1, label: '행렬 계산', parameters: {} }, { id: 'result', blockType: 'sink.display', blockVersion: 1, label: '행렬 결과', parameters: {} }];
    model.edges = [{ id: 'a-operation', source: { nodeId: 'a', portId: 'out' }, target: { nodeId: 'operation', portId: fixture.b ? 'a' : 'in' } }, { id: 'operation-result', source: { nodeId: 'operation', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }];
    model.layout = { a: { x: 30, y: 30 }, operation: { x: 280, y: 100 }, result: { x: 560, y: 100 } };
    if (fixture.b) { model.nodes.push({ id: 'b', blockType: 'source.constant', blockVersion: 1, label: '행렬 B', parameters: { value: fixture.b } }); model.edges.push({ id: 'b-operation', source: { nodeId: 'b', portId: 'out' }, target: { nodeId: 'operation', portId: 'b' } }); model.layout.b = { x: 30, y: 230 }; }
    await importModel(page, model); const record = await run(page, 1); expectNumeric(record.result.samples[0]!.values.result, fixture.expected);
    if (Array.isArray(fixture.expected)) await expect(page.locator('.signal-result tbody tr')).toHaveCount((fixture.expected as number[][]).flat().length);
    else await expect(page.locator('.output-card strong')).toHaveText('-2');
    await expect(page.locator('.react-flow__node[data-id="operation"] .block-symbol')).toHaveCount(0);
  });
}

test('M5 solve supports multiple right-hand columns and keeps their unit while safe matrix drafts remain repairable', async ({ page }) => {
  await open(page); const model = createExample('matrix-solve-lu'); await importModel(page, model); await run(page, 1);
  await node(page, model, 'vector-b'); const valueLabel = parameterLabel(model, 'vector-b', 'value');
  await page.getByLabel(`${valueLabel} 유형`, { exact: true }).selectOption('matrix');
  await page.getByLabel(valueLabel, { exact: true }).fill('[[4,0],[7,1]]'); await page.getByLabel(valueLabel, { exact: true }).press('Tab');
  await page.getByLabel('단위', { exact: true }).selectOption('m');
  const record = await run(page, 2); expectNumeric(record.result.samples[0]!.values.solution, [[1, 1], [2, 0]]); expect(record.outputTypes.solution!.unit).toBe('m');
  await page.locator('.output-card').filter({ hasText: '해 x' }).click(); await expect(page.locator('.signal-result tbody tr')).toHaveCount(4);
  const exported = JSON.parse((await download(page, '모델 다운로드')).toString('utf8')) as CalcModel;
  expect(exported.nodes.find(item => item.id === 'vector-b')!.parameters.value).toEqual([[4, 0], [7, 1]]);
  const historyBefore = await history(page);
  await editJson(page, model, 'matrix-a', 'value', [[1, 2], [3]]);
  await expect(page.locator('.field-message').filter({ hasText: /배열|길이|shape|signal|신호/ })).not.toHaveCount(0);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  expect(await history(page)).toEqual(historyBefore);
  await editJson(page, model, 'matrix-a', 'value', [[0, 2], [1, 3]]); await run(page, 3);
});

test('M5 nonuniform bilinear lookup and Prelookup retain explicit table axes and all output ports', async ({ page }) => {
  await open(page); const model = createExample('lookup-2d-nonuniform'); await importModel(page, model); const initial = await run(page, 1);
  expect(initial.result.samples[0]!.values).toEqual({ 'table-result': 2, 'interval-result': 0, 'fraction-result': 0.5 });
  await node(page, model, 'prelookup'); await expect(page.getByLabel('출력 포트')).toHaveValue('index'); await page.getByLabel('출력 포트').selectOption('fraction');
  await expect(page.locator('.react-flow__node[data-id="prelookup"] .output-port .react-flow__handle')).toHaveCount(2);
  await editJson(page, model, 'row', 'value', 1.2); await editJson(page, model, 'column', 'value', 2.4); const linear = await run(page, 2);
  expect(linear.result.samples[0]!.values['table-result']).toBeCloseTo(2.88, 12);
  await node(page, model, 'table'); const interpolation = page.getByLabel(parameterLabel(model, 'table', 'interpolation'), { exact: true });
  await interpolation.selectOption('nearest'); const nearest = await run(page, 3); expect(nearest.result.samples[0]!.values['table-result']).toBe(2);
  await interpolation.selectOption('previous'); const previous = await run(page, 4); expect(previous.result.samples[0]!.values['table-result']).toBe(0);
  await interpolation.selectOption('linear'); await editJson(page, model, 'row', 'value', -1); await editJson(page, model, 'column', 'value', 2);
  await node(page, model, 'table'); await page.getByLabel(parameterLabel(model, 'table', 'extrapolation'), { exact: true }).selectOption('linear');
  const extrapolated = await run(page, 5); expectNumeric(extrapolated.result.samples[0]!.values['table-result'], -2);
  expect((await history(page)).find(record => record.id === initial.id)).toEqual(initial);
});

test('M5 table column mismatch and unsorted breakpoints produce original-node diagnostics without replacing past results', async ({ page }) => {
  await open(page); const model = createExample('lookup-2d-nonuniform'); await importModel(page, model); const original = await run(page, 1);
  await editJson(page, model, 'table', 'table', [[0, 0], [0, 2], [0, 5]]);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('2D 표'); await expect(page.locator('.diagnostic-item')).not.toHaveCount(0);
  expect(await history(page)).toEqual([original]);
  await editJson(page, model, 'table', 'table', [[0, 0, 0], [0, 2, 8], [0, 5, 20]]);
  await editJson(page, model, 'table', 'rowBreakpoints', [0, 0, 5]);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.diagnostic-item')).toContainText('2D 표');
  expect(await history(page)).toEqual([original]);
  await editJson(page, model, 'table', 'rowBreakpoints', [0, 2, 5]); const repaired = await run(page, 2); expect(repaired.result.samples[0]!.values['table-result']).toBe(2);
});

test('M5 singular matrix errors identify the failed operation and preserve its valid historical snapshot', async ({ page }) => {
  await open(page); const model = createExample('matrix-solve-lu'); await importModel(page, model); const original = await run(page, 1);
  await editJson(page, model, 'matrix-a', 'value', [[1, 2], [2, 4]]);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.diagnostic-item')).not.toHaveCount(0);
  await expect(page.locator('.diagnostic-item')).toContainText(/행 피벗 LU|선형 시스템 풀이/);
  await expect(page.locator('.diagnostic-item')).toContainText(/MATRIX_|NUMERIC_/);
  await expect.poll(async () => (await history(page))?.length).toBe(2);
  const failed = (await history(page))[0]!; expect(failed.result.status).toBe('failed'); expect(failed.result.samples).toEqual([]);
  expect((await history(page)).find(record => record.id === original.id)).toEqual(original);
  await editJson(page, model, 'matrix-a', 'value', [[0, 2], [1, 3]]); const repaired = await run(page, 3); expectNumeric(repaired.result.samples[0]!.values.solution, [[1], [2]]);
});

test('M5 incompatible matrix dimensions identify the original solve node and remain editable without losing history', async ({ page }) => {
  await open(page); const model = createExample('matrix-solve-lu'); await importModel(page, model); const original = await run(page, 1);
  await editJson(page, model, 'vector-b', 'value', [[4], [7], [9]]);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.diagnostic-item')).toContainText('RHS_DIMENSION');
  await expect(page.locator('.diagnostic-item')).toContainText('선형 시스템 풀이'); expect(await history(page)).toEqual([original]);
  await editJson(page, model, 'vector-b', 'value', [[4], [7]]); await editJson(page, model, 'matrix-a', 'value', [[0, 2, 1], [1, 3, 4]]);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.diagnostic-item').first()).toContainText(/SQUARE_REQUIRED|MATRIX_SHAPE/);
  expect(await history(page)).toEqual([original]);
  await editJson(page, model, 'matrix-a', 'value', [[0, 2], [1, 3]]); const repaired = await run(page, 2); expectNumeric(repaired.result.samples[0]!.values.solution, [[1], [2]]);
});

test('M5 quantizer exposes exact stored integers separately from decoded values and documents its rounding range', async ({ page }) => {
  await open(page); const model = createExample('quantizer-rounding-overflow'); await importModel(page, model); const record = await run(page, 1);
  expect(record.result.samples[0]!.values).toEqual({ 'decoded-saturate': [-2, -0.5, 0.5, 1.75], 'stored-saturate': [-8, -2, 2, 7], 'decoded-wrap': [1.75, -0.5, 0.5, -1.75], 'stored-wrap': [7, -2, 2, -7] });
  await node(page, model, 'saturate'); await expect(page.locator('.inspector-content')).toContainText('저장 정수 -8 ~ 7');
  await page.getByLabel('출력 포트').selectOption('stored'); await expect(page.locator('.react-flow__node[data-id="saturate"] .output-port .react-flow__handle')).toHaveCount(2);
  await page.locator('.output-card').filter({ hasText: 'Saturate stored' }).click(); await expect(page.locator('.signal-result tbody tr')).toHaveCount(4);
  const roundingLabel = parameterLabel(model, 'saturate', 'rounding'); await page.getByLabel(roundingLabel, { exact: true }).selectOption('floor');
  const floored = await run(page, 2); expect(floored.result.samples[0]!.values['stored-saturate']).toEqual([-8, -2, 1, 7]);
  await page.getByLabel(roundingLabel, { exact: true }).selectOption('ceil'); const ceiled = await run(page, 3); expect(ceiled.result.samples[0]!.values['stored-saturate']).toEqual([-8, -1, 2, 7]);
  await page.getByLabel(roundingLabel, { exact: true }).selectOption('toward-zero'); const truncated = await run(page, 4); expect(truncated.result.samples[0]!.values['stored-saturate']).toEqual([-8, -1, 1, 7]);
  expect((await history(page)).find(item => item.id === record.id)).toEqual(record);
});

test('M5 unsigned 32-bit quantization keeps boundary integers exact in raw results and its saved model', async ({ page }) => {
  await open(page); const model = createExample('quantizer-rounding-overflow'); model.nodes.find(item => item.id === 'values')!.parameters.value = [4294967295, 4294967296, -1];
  for (const id of ['saturate', 'wrap']) model.nodes.find(item => item.id === id)!.parameters = { wordLength: 32, fractionLength: 0, signedness: 'unsigned', rounding: 'nearest-even', overflow: id };
  await importModel(page, model); const record = await run(page, 1);
  expect(record.result.samples[0]!.values['stored-saturate']).toEqual([4294967295, 4294967295, 0]);
  expect(record.result.samples[0]!.values['stored-wrap']).toEqual([4294967295, 0, 4294967295]);
  expect(record.result.samples[0]!.values['decoded-wrap']).toEqual([4294967295, 0, 4294967295]);
  await expect.poll(async () => (await stored<CalcModel>(page, 'current'))?.nodes.find(item => item.id === 'wrap')?.parameters.wordLength).toBe(32);
  await page.reload(); const restored = await run(page, 2); expect(restored.result.samples[0]!.values).toEqual(record.result.samples[0]!.values);
});

test('M5 explicit quantizer overflow error remains repairable without adding a successful history record', async ({ page }) => {
  await open(page); const model = createExample('quantizer-rounding-overflow'); await importModel(page, model); const original = await run(page, 1);
  await node(page, model, 'saturate'); const overflow = page.getByLabel(parameterLabel(model, 'saturate', 'overflow'), { exact: true }); await overflow.selectOption('error');
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.diagnostic-item')).toContainText('범위 안에 제한');
  await expect(page.locator('.diagnostic-item')).toContainText(/QUANT|FIXED|OVERFLOW/);
  await expect.poll(async () => (await history(page))?.length).toBe(2); expect((await history(page))[0]!.result.status).toBe('failed');
  expect((await history(page)).find(record => record.id === original.id)).toEqual(original);
  await overflow.selectOption('saturate'); const repaired = await run(page, 3); expect(repaired.result.samples[0]!.values['stored-saturate']).toEqual([-8, -2, 2, 7]);
});
