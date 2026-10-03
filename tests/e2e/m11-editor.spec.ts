import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { CalcModel } from '../../packages/model/src';
import { createExample } from '../../apps/web/src/examples';

async function workspace(page: Page) { await page.goto('/'); await expect(page.getByRole('button', { name: '계산하기', exact: false })).toBeVisible(); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function example(page: Page, id: string) { await page.getByRole('button', { name: '예제로 시작', exact: true }).click(); await page.getByLabel('예제 카테고리').selectOption('hierarchy'); await page.locator(`[data-example-id="${id}"]`).click(); }
async function run(page: Page) { await page.locator('.run-button').click(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과'); }
async function download(page: Page, name: string) { const next = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await next).path())!, 'utf8'); }
async function storedModel(page: Page): Promise<CalcModel | null> {
  return page.evaluate(() => new Promise((resolve, reject) => { const opening = indexedDB.open('calcweave-m0', 1); opening.onsuccess = () => { const db = opening.result, tx = db.transaction('models', 'readonly'), request = tx.objectStore('models').get('current'); request.onsuccess = () => resolve(request.result ?? null); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('Read failed')); }; opening.onerror = () => reject(new Error('Open failed')); }));
}
function output(page: Page, label: string) { return page.locator('.output-card').filter({ hasText: label }); }

test('M11 controlled instances open active definitions, save versions, reload, and retain exact source models', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await workspace(page); await example(page, 'controlled-variant');
  await page.locator('.react-flow__node[data-id="variant"]').click(); await page.getByLabel('선택 정의', { exact: true }).selectOption('second');
  await run(page); await expect(output(page, '선택 결과').locator('strong')).toHaveText('15');
  await page.locator('.react-flow__node[data-id="variant"]').dblclick();
  await expect(page.getByRole('navigation', { name: '도식 경로' })).toContainText('선택한 배율'); await expect(page.locator('.canvas-topline strong')).toHaveText('배율 5 정의');
  await page.locator('.react-flow__node[data-id="gain"]').click(); await page.getByLabel('배율', { exact: true }).fill('7'); await page.getByLabel('배율', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '루트 모델', exact: true }).click(); await run(page); await expect(output(page, '선택 결과').locator('strong')).toHaveText('21');
  const model = JSON.parse(await download(page, '모델 다운로드')) as CalcModel;
  expect(model.nodes.find(node => node.id === 'variant')!.parameters).toMatchObject({ active: 'second', version: 1, alternateVersion: 2 });
  expect(model.subsystems!.find(definition => definition.id === 'fivefold')!.nodes.find(node => node.id === 'gain')!.parameters.gain).toBe(7);
  await expect.poll(async () => (await storedModel(page))?.subsystems?.find(definition => definition.id === 'fivefold')?.version).toBe(2);
  await page.reload(); await page.locator('.react-flow__node[data-id="variant"]').click(); await expect(page.getByLabel('선택 정의', { exact: true })).toHaveValue('second');
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm11-variant.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) }); await run(page); await expect(output(page, '선택 결과').locator('strong')).toHaveText('21');
  expect(errors).toEqual([]);
});

test('M11 execution mode changes retain data connections and expose real control ports and settings', async ({ page }) => {
  await workspace(page); await example(page, 'controlled-variant'); await page.locator('.react-flow__node[data-id="variant"]').click();
  await page.getByLabel('하위 도식 실행', { exact: true }).selectOption('hierarchy.enabled');
  await expect(page.getByLabel('재활성 상태', { exact: true })).toHaveValue('hold'); await expect(page.getByLabel('비활성 출력', { exact: true })).toHaveValue('hold');
  await expect(page.getByLabel('in 입력 연결', { exact: true })).toHaveValue('value:out'); await page.getByLabel('enable 입력 연결', { exact: true }).selectOption('value:out');
  await expect(page.locator('.react-flow__node[data-id="variant"] .input-port')).toHaveCount(2);
  await run(page); await expect(output(page, '선택 결과').locator('strong')).toHaveText('6');
  await expect.poll(async () => (await storedModel(page))?.nodes.find(node => node.id === 'variant')?.blockType).toBe('hierarchy.enabled');
  const model = await storedModel(page);
  expect(model?.edges.filter(edge => edge.target.nodeId === 'variant')).toHaveLength(2);
});

test('M11 newly grouped diagrams edit boundary aliases and execute real ForEach partitions', async ({ page }) => {
  await workspace(page); const model = createExample('first-calculation'); model.name = '새 배열 하위 도식'; model.nodes.find(node => node.id === 'value')!.parameters.value = [2, 3]; model.execution = { mode: 'discrete', startTime: 0, stopTime: 1, step: 1 };
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm11-new-diagram.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await page.locator('.react-flow__node[data-id="gain"]').click(); await page.getByRole('button', { name: '하위 도식으로 묶기', exact: true }).click();
  await page.locator('.react-flow__node[data-id="subsystem"]').dblclick();
  await page.locator('.react-flow__node[data-id="inport1"]').click(); await page.getByLabel('경계 포트 ID', { exact: true }).fill('in'); await page.getByLabel('경계 포트 ID', { exact: true }).press('Enter');
  await page.locator('.react-flow__node[data-id="outport1"]').click(); await page.getByLabel('경계 포트 ID', { exact: true }).fill('out'); await page.getByLabel('경계 포트 ID', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '루트 모델', exact: true }).click(); await page.locator('.react-flow__node[data-id="subsystem"]').click(); await page.getByLabel('하위 도식 실행', { exact: true }).selectOption('hierarchy.for-each');
  await run(page); await expect(output(page, '값 표시').locator('strong')).toHaveText('2개 값');
  await expect(page.locator('.signal-result tbody tr').nth(0)).toContainText('6'); await expect(page.locator('.signal-result tbody tr').nth(1)).toContainText('9');
  await expect.poll(async () => { const saved = await storedModel(page); return { input: saved?.subsystems?.[0]?.inputs[0]?.id, output: saved?.subsystems?.[0]?.outputs[0]?.id, type: saved?.nodes.find(node => node.id === 'subsystem')?.blockType }; }).toEqual({ input: 'in', output: 'out', type: 'hierarchy.for-each' });
});

test('M11 independent state and enable hold/reset examples compute different actual state banks', async ({ page }) => {
  await workspace(page); await example(page, 'controlled-independent-states'); await run(page);
  await expect(output(page, '첫 상태').locator('strong')).toHaveText('6'); await expect(output(page, '둘째 상태').locator('strong')).toHaveText('18');
  await example(page, 'controlled-enable-state'); await run(page);
  await expect(output(page, '유지 기록').locator('strong')).toHaveText('4'); await expect(output(page, '초기화 기록').locator('strong')).toHaveText('2');
});

test('M11 for/while loops expose automatic boundaries, bounded drafts, and zero-call initial output', async ({ page }) => {
  await workspace(page); await example(page, 'controlled-for-iteration'); await run(page); await expect(output(page, '마지막 반복 결과').locator('strong')).toHaveText('6');
  await page.locator('.react-flow__node[data-id="loop"]').click(); await expect(page.locator('.react-flow__node[data-id="loop"] .input-port')).toHaveCount(0);
  const count = page.getByLabel('반복 횟수', { exact: true }); await count.fill('0'); await count.blur(); await run(page); await expect(output(page, '마지막 반복 결과').locator('strong')).toHaveText('0');
  await count.fill('65'); await count.blur(); await expect(count).toHaveAttribute('aria-invalid', 'true'); await page.locator('.run-button').click(); await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  await count.press('Escape'); await example(page, 'controlled-while-iteration'); await run(page); await expect(output(page, '마지막 반복 결과').locator('strong')).toHaveText('3');
  await page.locator('.react-flow__node[data-id="loop"]').dblclick(); await expect(page.locator('.react-flow__node[data-id="continue"]')).toBeVisible();
  await page.getByRole('button', { name: '루트 모델', exact: true }).click(); await expect(page.locator('.react-flow__node[data-id="loop"] .output-port')).toHaveCount(1);
});

test('M11 nested bus editor preserves exact typed leaves, rejects invalid drafts, and escapes payload text', async ({ page }) => {
  await workspace(page); await example(page, 'structured-nested-bus'); await run(page); await output(page, '원본 버스').click();
  await expect(page.locator('.bus-result').first()).toContainText('18446744073709551615'); await expect(page.locator('.bus-result').first()).toContainText('1.50390625 (코드 385)');
  await page.locator('.react-flow__node[data-id="status"]').click(); const field = page.getByLabel('신호 값 신호 JSON', { exact: true });
  await field.fill('{"kind":"bus","fields":[{"name":"ready","value":true},{"name":"ready","value":false}]}'); await field.blur(); await expect(field).toHaveAttribute('aria-invalid', 'true');
  await page.locator('.run-button').click(); await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  const value = { kind: 'bus', fields: [{ name: 'ready', value: false }, { name: 'text', value: { kind: 'typed', dtype: 'string', shape: [], data: ['<img src=x onerror=alert(1)>'] } }] };
  await field.fill(JSON.stringify(value)); await field.blur(); await run(page); await output(page, '원본 버스').click();
  await expect(page.locator('.bus-result').first()).toContainText('<img src=x onerror=alert(1)>'); await expect(page.locator('.bus-result img')).toHaveCount(0); await expect(output(page, '선택 필드').locator('strong')).toHaveText('false');
  await expect.poll(async () => (await storedModel(page))?.nodes.find(node => node.id === 'status')?.parameters.value).toEqual(value);
});

test('M11 message queue exposes previous-tick batches and exact payloads in history CSV and TS downloads', async ({ page }) => {
  await workspace(page); await example(page, 'structured-message-queue'); await run(page); await output(page, '받은 메시지').click();
  await expect(page.locator('.message-result')).toContainText('sensor'); await expect(page.locator('.message-result')).toContainText('18446744073709551615');
  const sample = page.getByLabel('구조화 샘플 번호', { exact: true }); await sample.fill('1'); await sample.blur(); await expect(page.locator('.message-result')).toContainText('이 샘플에 메시지가 없습니다.');
  await page.getByRole('button', { name: '다음 샘플', exact: true }).click(); await expect(page.locator('.message-metadata dd').nth(1)).toHaveText('0'); await expect(page.locator('.message-metadata dd').nth(2)).toHaveText('0 s');
  const next = page.waitForEvent('download'); await page.getByRole('button', { name: /코드 다운로드/ }).click(); const code = await readFile((await (await next).path())!, 'utf8'); expect(code).toContain('sensor'); expect(code).toContain('18446744073709551615');
  await page.getByRole('tab', { name: '실험', exact: true }).click(); const csv = await download(page, '결과 CSV'); expect(csv).toContain('18446744073709551615'); expect(csv).toContain('sensor');
  const record = JSON.parse(await download(page, '기록 JSON')); expect(record.result.samples[0].values.messages.items).toEqual([]); expect(record.result.samples[1].values.messages.items[0].payload.fields[0].value.data).toEqual(['18446744073709551615']);
});

test('M11 structured forms and result trees stay readable at 320px and 200% text in both themes', async ({ page }, testInfo) => {
  await workspace(page); await example(page, 'structured-nested-bus'); await page.locator('.react-flow__node[data-id="status"]').click(); await run(page); await output(page, '원본 버스').click();
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.app-shell').evaluate(shell => shell.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경`, exact: true }).click();
    for (const [width, scale] of [[1440, 1], [390, 1], [320, 2]]) {
      await page.setViewportSize({ width, height: 1200 }); await page.addStyleTag({ content: `html { font-size: ${16 * scale}px !important; }` });
      await expect.poll(() => page.evaluate(() => ({ document: document.documentElement.scrollWidth <= innerWidth + 1, controls: [...document.querySelectorAll('.structured-signal-field textarea')].every(element => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth + 1; }) }))).toEqual({ document: true, controls: true });
      await expect(page.locator('.structured-signal-field').first()).toBeVisible();
      if (width === 320) await page.locator('.structured-signal-field').first().screenshot({ path: testInfo.outputPath(`structured-field-${theme}-${width}-${scale}x.png`) });
    }
  }
});


test('M11 failing while child diagnostic opens and fits the actual error node before repair', async ({ page }, testInfo) => {
  await workspace(page);
  const model = createExample('controlled-while-iteration');
  const child = model.subsystems![0]!.nodes.find(node => node.id === 'bias')!;
  child.blockType = 'math.function'; child.label = '0 나누기 원인'; child.parameters = { operation: 'reciprocal' };
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm11-child-failure.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await page.locator('.run-button').click();
  const diagnostic = page.locator('.diagnostic-item').filter({ hasText: 'NUMERIC_DIVIDE_BY_ZERO' });
  await expect(diagnostic).toBeVisible(); await diagnostic.click();
  await expect(page.getByRole('navigation', { name: '도식 경로' })).toContainText('최대 네 번 반복');
  const node = page.locator('.react-flow__node[data-id="bias"]');
  await expect(node).toBeVisible(); await expect(node).toHaveClass(/selected/); await expect(node.locator('.block-node')).toHaveClass(/(?:^| )error(?: |$)/);
  await expect.poll(async () => {
    const bounds = await node.boundingBox(), canvas = await page.locator('.react-flow').boundingBox();
    return !!bounds && !!canvas && bounds.x >= canvas.x && bounds.y >= canvas.y && bounds.x + bounds.width <= canvas.x + canvas.width && bounds.y + bounds.height <= canvas.y + canvas.height;
  }).toBe(true);
  await page.locator('.canvas-area').screenshot({ path: testInfo.outputPath('child-diagnostic-location.png') });
  await expect(page.getByLabel('함수', { exact: true })).toHaveValue('reciprocal');
  await page.getByLabel('함수', { exact: true }).selectOption('square');
  await page.getByRole('button', { name: '루트 모델', exact: true }).click(); await run(page);
  await expect(output(page, '마지막 반복 결과').locator('strong')).toHaveText('4');
});
