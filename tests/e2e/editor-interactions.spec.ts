import { expect, test, type Page, type Locator } from '@playwright/test';
import { createExample } from '../../apps/web/src/examples';
import type { CalcModel } from '../../packages/model/src';
import { compileModel } from '../../packages/compiler/src';
import { createSubsystemFromSelection } from '../../packages/compiler/src/hierarchy';
import { BLOCK_DRAG_MIME } from '../../apps/web/src/block-library-drag';

async function open(page: Page, model = createExample('first-calculation')) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '계산하기' })).toBeVisible();
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'editor.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름')).toHaveValue(model.name); await expect(page.locator('.react-flow__node')).toHaveCount(model.nodes.length);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function model(page: Page): Promise<CalcModel> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onsuccess = () => { const db = request.result, tx = db.transaction('models', 'readonly'), read = tx.objectStore('models').get('current'); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('read')); };
    request.onerror = () => reject(new Error('open'));
  }));
}
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const handle = (page: Page, id: string, port: string) => node(page, id).locator(`.react-flow__handle[data-handleid="${port}"]`);
async function wire(page: Page, source: Locator, target: Locator, body = false) {
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width * (body ? 0.6 : 0.5), to.y + to.height / 2, { steps: 12 }); await page.mouse.up();
}
async function arrange(page: Page) {
  await page.locator('.canvas-area > .react-flow').focus(); await page.keyboard.down('Space'); await page.keyboard.press('z'); await page.keyboard.up('Space');
}
function tangled(): CalcModel {
  const result = createExample('first-calculation'); result.layout = { value: { x: 480, y: 320 }, gain: { x: -160, y: 160 }, result: { x: 192, y: -112 } }; return result;
}

test('Display grows by spare handle, occupied input and body drop; undo preserves every original connection', async ({ page }) => {
  await open(page); const original = await model(page);
  await expect(handle(page, 'result', 'in2')).toBeVisible();
  await wire(page, handle(page, 'value', 'out'), handle(page, 'result', 'in2'));
  await expect.poll(async () => (await model(page)).nodes.find(n => n.id === 'result')!.parameters.inputCount).toBe(2);
  expect((await model(page)).edges.slice(0, 2)).toEqual(original.edges); await expect(handle(page, 'result', 'in3')).toBeVisible();
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  await expect(node(page, 'result').locator('.block-value')).toContainText('6 · 2');
  await expect(page.getByRole('region', { name: '값 표시 다중 입력 그래프' })).toBeVisible();
  await wire(page, handle(page, 'value', 'out'), handle(page, 'result', 'in'));
  await expect.poll(async () => (await model(page)).nodes.find(n => n.id === 'result')!.parameters.inputCount).toBe(3);
  await wire(page, handle(page, 'gain', 'out'), node(page, 'result').locator('.block-node'), true);
  await expect.poll(async () => (await model(page)).nodes.find(n => n.id === 'result')!.parameters.inputCount).toBe(4);
  expect((await model(page)).edges).toHaveLength(5);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect.poll(async () => (await model(page)).edges.length).toBe(4);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect.poll(() => model(page)).toEqual(original);
});

test('Explicit observer input count is bounded, required and shrinking removes only deleted ports with one undo', async ({ page }) => {
  await open(page); await node(page, 'result').click();
  await page.getByLabel('입력 개수', { exact: true }).fill('3'); await page.getByLabel('입력 개수', { exact: true }).press('Enter');
  await expect(handle(page, 'result', 'in3')).toBeVisible(); await expect(handle(page, 'result', 'in4')).toHaveCount(0);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.diagnostics-content')).toContainText('in2');
  await wire(page, handle(page, 'value', 'out'), handle(page, 'result', 'in2'));
  await wire(page, handle(page, 'gain', 'out'), handle(page, 'result', 'in3'));
  await expect.poll(async () => (await model(page)).edges.length).toBe(4); const before = await model(page);
  await node(page, 'result').click(); await page.getByLabel('입력 개수', { exact: true }).fill('17'); await page.getByLabel('입력 개수', { exact: true }).press('Enter');
  expect((await model(page)).nodes.find(n => n.id === 'result')!.parameters.inputCount).toBe(3);
  await page.getByLabel('입력 개수', { exact: true }).fill('1'); await page.getByLabel('입력 개수', { exact: true }).press('Enter');
  await expect.poll(async () => (await model(page)).edges.length).toBe(2);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect.poll(() => model(page)).toEqual(before);
});

test('Scope overlays independent signals and separate plots while retaining execution data across reload', async ({ page }) => {
  const input = createExample('first-calculation'); input.execution = { mode: 'discrete', startTime: 0, stopTime: 1, step: 0.025 };
  input.nodes[0] = { id: 'value', blockType: 'source.signal-generator', blockVersion: 1, label: '사인', unit: 'm', parameters: { waveform: 'sine', amplitude: 1, frequency: 2, frequencyUnit: 'Hz', phase: 0, bias: 0, seed: 1 } };
  input.nodes[2].blockType = 'sink.scope'; input.nodes[2].label = '비교'; input.nodes[2].parameters = { inputCount: 2 };
  input.edges.push({ id: 'second', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'result', portId: 'in2' } });
  await open(page, input); await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  const graph = page.getByRole('region', { name: '비교 다중 입력 그래프', exact: true }); await expect(graph).toBeVisible();
  await expect(graph.locator('path[data-sample-count]')).toHaveCount(2); await expect(graph).toContainText('입력 1 · in'); await expect(graph).toContainText('입력 2 · in2');
  const before = await model(page); await graph.getByRole('button', { name: '그래프 각각 보기', exact: true }).click();
  await expect(graph.locator('.multi-input-channel')).toHaveCount(2); await expect(graph.locator('path[data-sample-count]')).toHaveCount(2);
  await graph.getByRole('button', { name: '그래프 중첩', exact: true }).click(); await expect(graph.locator('.multi-input-channel')).toHaveCount(0); expect(await model(page)).toEqual(before);
  await graph.locator('.scope-interactive-plot').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.test-generated/editor-multi-input.png', fullPage: true });
  await page.reload(); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  expect(await model(page)).toEqual(before); await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await expect(graph.locator('path[data-sample-count]')).toHaveCount(2);
});

test('Native library drag honors zoom and pan, adds once at snapped pointer position, and click insertion still works', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '캔버스 축소', exact: true }).click();
  const canvas = page.locator('.canvas-area > .react-flow'), bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + 35); await page.mouse.down({ button: 'middle' }); await page.mouse.move(bounds.x + 78, bounds.y + 66, { steps: 6 }); await page.mouse.up({ button: 'middle' });
  const transform = await page.locator('.react-flow__viewport').evaluate(el => { const t = new DOMMatrixReadOnly(getComputedStyle(el).transform); return { x: t.e, y: t.f, zoom: t.a }; });
  const destination = { x: bounds.x + bounds.width * .42, y: bounds.y + bounds.height * .8 };
  const item = page.locator('.library-item[data-block-id="math.gain"]').first(); const from = (await item.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down(); await page.mouse.move(from.x + from.width + 12, from.y + from.height / 2, { steps: 8 }); await page.mouse.move(destination.x, destination.y, { steps: 14 }); await page.mouse.up();
  await expect(page.locator('.react-flow__node')).toHaveCount(4); await expect.poll(async () => (await model(page)).nodes.length).toBe(4);
  const added = (await model(page)).nodes.at(-1)!; expect(added.blockType).toBe('math.gain');
  expect((await model(page)).layout[added.id]).toEqual({ x: Math.round((destination.x - bounds.x - transform.x) / transform.zoom / 16) * 16, y: Math.round((destination.y - bounds.y - transform.y) / transform.zoom / 16) * 16 });
  await item.click(); await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect(page.locator('.react-flow__node')).toHaveCount(3);
});

test('Unregistered drag data and a drop outside the canvas leave the model intact', async ({ page }) => {
  await open(page); const original = await model(page);
  await page.locator('.canvas-area > .react-flow').evaluate((el, mime) => { const transfer = new DataTransfer(); transfer.setData(mime, '<img src=x onerror=alert(1)>'); el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 500, clientY: 500 })); }, BLOCK_DRAG_MIME);
  const item = page.locator('.library-item[data-block-id="math.gain"]').first(); await item.dragTo(page.locator('.results-panel'));
  expect(await model(page)).toEqual(original); await expect(page.locator('.react-flow__node')).toHaveCount(3);
});

test('Hold Space then Z arranges layout only, keeps results current and one undo restores all positions', async ({ page }) => {
  await open(page, tangled()); await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  const before = await model(page), key = compileModel(before).semanticKey;
  await arrange(page); await expect.poll(async () => JSON.stringify((await model(page)).layout)).not.toBe(JSON.stringify(before.layout));
  const after = await model(page); expect(compileModel(after).semanticKey).toBe(key); expect({ ...after, layout: before.layout }).toEqual(before);
  expect(after.layout.value.x).toBeLessThan(after.layout.gain.x); expect(after.layout.gain.x).toBeLessThan(after.layout.result.x);
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과'); await expect(page.getByRole('button', { name: /자동 정렬/ })).toHaveCount(0);
  await arrange(page); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); expect(await model(page)).toEqual(after);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect.poll(() => model(page)).toEqual(before);
});

test('Space release then Z and Z alone do not arrange; input focus, modifier and focus loss cancel the chord', async ({ page }) => {
  await open(page, tangled()); const before = await model(page), canvas = page.locator('.canvas-area > .react-flow');
  await canvas.focus(); await page.keyboard.press('Space'); await page.keyboard.press('z'); expect(await model(page)).toEqual(before);
  await page.keyboard.press('z'); expect(await model(page)).toEqual(before);
  await page.getByLabel('모델 이름').focus(); await page.keyboard.down('Space'); await page.keyboard.press('z'); await page.keyboard.up('Space'); await page.keyboard.press('Escape'); expect(await model(page)).toEqual(before);
  await canvas.focus(); await page.keyboard.down('Space'); await page.keyboard.press('Shift+z'); await page.keyboard.up('Space'); expect(await model(page)).toEqual(before);
  await canvas.focus(); await page.keyboard.down('Space'); await page.getByLabel('모델 이름').focus(); await canvas.focus(); await page.keyboard.press('z'); await page.keyboard.up('Space'); expect(await model(page)).toEqual(before);
});

test('A full 16-input observer cannot grow or overwrite its previous inputs', async ({ page }) => {
  const input = createExample('first-calculation'); input.nodes[2].parameters.inputCount = 16;
  input.edges.push(...Array.from({ length: 15 }, (_, index) => ({ id: `multi-${index}`, source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'result', portId: `in${index + 2}` } })));
  await open(page, input); await expect(handle(page, 'result', 'in16')).toBeVisible(); await expect(handle(page, 'result', 'in17')).toHaveCount(0);
  await wire(page, handle(page, 'value', 'out'), node(page, 'result').locator('.block-node'), true);
  await expect(page.getByRole('status')).toContainText('최대 16개'); expect(await model(page)).toEqual(input);
});

test('Drag insertion and Space+Z affect only the open subsystem and undo restores its definition', async ({ page }) => {
  const input = createSubsystemFromSelection(tangled(), ['value', 'gain']); await open(page, input);
  const instance = input.nodes.find(n => n.blockType === 'hierarchy.subsystem')!;
  await node(page, instance.id).dblclick(); await expect(node(page, 'gain')).toBeVisible(); const before = await model(page);
  await arrange(page); await expect.poll(async () => JSON.stringify((await model(page)).subsystems)).not.toBe(JSON.stringify(before.subsystems));
  const arranged = await model(page); expect(arranged.layout).toEqual(before.layout); expect(arranged.nodes).toEqual(before.nodes); expect(arranged.edges).toEqual(before.edges); expect(compileModel(arranged).semanticKey).toBe(compileModel(before).semanticKey);
  const canvas = page.locator('.canvas-area > .react-flow'), bounds = (await canvas.boundingBox())!;
  const item = page.locator('.library-item[data-block-id="math.gain"]').first();
  await item.dragTo(canvas, { targetPosition: { x: bounds.width * .5, y: bounds.height * .8 } });
  await expect.poll(async () => (await model(page)).subsystems![0].nodes.length).toBe(before.subsystems![0].nodes.length + 1);
  const added = await model(page); expect(added.layout).toEqual(before.layout); expect(added.edges).toEqual(before.edges);
  expect(added.nodes.map(n => n.id === instance.id ? { ...n, parameters: { ...n.parameters, version: instance.parameters.version } } : n)).toEqual(before.nodes);
  expect(added.nodes.find(n => n.id === instance.id)!.parameters.version).toBe(Number(instance.parameters.version) + 1);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect.poll(() => model(page)).toEqual(arranged);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect.poll(() => model(page)).toEqual(before);
});
