import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { createExample } from '../../apps/web/src/examples';
import { createHash } from 'node:crypto';
import { compileModel } from '../../packages/compiler/src';
import { BLOCK_REGISTRY } from '../../packages/block-library/src';
import { ENGINE_VERSION } from '../../packages/model/src';
import type { CalcModel } from '../../packages/model/src';

async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '계산하기' })).toBeVisible();
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function importModel(page: Page, model: CalcModel | unknown) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'test.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
}
async function selectExample(page: Page, title: string) {
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: new RegExp(title) }).click();
}
async function stored(page: Page, key = 'current'): Promise<unknown> {
  return page.evaluate(async (key) => new Promise((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('models', 'readonly');
      const read = transaction.objectStore('models').get(key);
      read.onsuccess = () => resolve(read.result ?? null);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(new Error('Read failed'));
    };
    request.onerror = () => reject(new Error('Open failed'));
  }), key);
}

function cancellationModel(): CalcModel {
  const model = createExample('first-calculation');
  model.modelId = 'large-cancellation'; model.layout = {};
  const nodes: CalcModel['nodes'] = [model.nodes[0]], edges: CalcModel['edges'] = [];
  let previous = 'value';
  for (let index = 0; index < 998; index++) {
    const id = `gain-${index}`;
    nodes.push({ id, blockType: 'math.gain', blockVersion: 1, label: '배율', parameters: { gain: 1 } });
    edges.push({ id: `edge-${index}`, source: { nodeId: previous, portId: 'out' }, target: { nodeId: id, portId: 'in' } });
    previous = id;
  }
  nodes.push(model.nodes[2]);
  edges.push({ id: 'edge-result', source: { nodeId: previous, portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
  model.nodes = nodes; model.edges = edges;
  model.execution = { mode: 'discrete', startTime: 0, stopTime: 10000, step: 1 };
  return model;
}

async function expectWorkbench(page: Page, orientation: 'side' | 'stack') {
  await expect.poll(async () => {
    const canvas = await page.locator('.canvas-area').boundingBox();
    const results = await page.locator('.results-panel').boundingBox();
    const workbench = await page.locator('.workbench-layout').boundingBox();
    if (!canvas || !results || !workbench) return false;
    const contained = canvas.x >= workbench.x - 2 && results.x + results.width <= workbench.x + workbench.width + 2;
    if (orientation === 'side') return contained && canvas.x + canvas.width <= results.x + 2
      && Math.abs(canvas.y - results.y) <= 2 && Math.abs(canvas.height - results.height) <= 2
      && canvas.width >= 300 && results.width >= 280;
    return contained && canvas.y + canvas.height <= results.y + 2
      && Math.abs(canvas.x - results.x) <= 2 && Math.abs(canvas.width - results.width) <= 2;
  }, { message: `The canvas and results must form a readable ${orientation} workbench` }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function canvasViewport(page: Page) {
  return page.locator('.react-flow__viewport').evaluate(element => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: transform.e, y: transform.f, zoom: transform.a };
  });
}

async function expectDiagramInsideCanvas(page: Page) {
  await expect.poll(async () => {
    const canvas = await page.locator('.canvas-area > .react-flow').boundingBox();
    const nodes = await page.locator('.react-flow__node').evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    if (!canvas || !nodes.length || nodes.some(node => node.width <= 0 || node.height <= 0)) return false;
    const left = Math.min(...nodes.map(node => node.x)), top = Math.min(...nodes.map(node => node.y));
    const right = Math.max(...nodes.map(node => node.x + node.width)), bottom = Math.max(...nodes.map(node => node.y + node.height));
    return left >= canvas.x - 1 && top >= canvas.y - 1
      && right <= canvas.x + canvas.width + 1 && bottom <= canvas.y + canvas.height + 1
      && Math.abs((left + right) / 2 - (canvas.x + canvas.width / 2)) <= 2
      && Math.abs((top + bottom) / 2 - (canvas.y + canvas.height / 2)) <= 2;
  }, { message: 'All measured diagram nodes must be visible and centered within the actual canvas' }).toBe(true);
}

for (const width of [1440, 1920]) {
  test(`First load and delayed saved-model restoration fit the actual ${width}px canvas without resetting later user navigation`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await openWorkspace(page);
    await expectDiagramInsideCanvas(page);

    const model = createExample('continuous-decay');
    // A compact diagram fits the readable 0.8 minimum zoom even at 1440px.
    // Its far-away coordinates make fitting the initial default diagram insufficient.
    model.layout = { state: { x: 4240, y: -2480 }, gain: { x: 4420, y: -2360 }, result: { x: 4600, y: -2480 } };
    await importModel(page, model);
    await expect(page.getByLabel('모델 이름')).toHaveValue('시간에 따른 감쇠');
    await expect.poll(() => stored(page)).toEqual(model);

    await page.addInitScript(() => {
      const get = IDBObjectStore.prototype.get;
      const complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
      let held = false;
      IDBObjectStore.prototype.get = function(key) {
        const request = get.call(this, key);
        if (held || this.name !== 'models' || key !== 'current' || this.transaction.mode !== 'readonly') return request;
        held = true;
        const transaction = this.transaction;
        Object.defineProperty(transaction, 'oncomplete', {
          configurable: true,
          get() { return complete.get!.call(transaction); },
          set(handler) {
            if (typeof handler !== 'function') { complete.set!.call(transaction, handler); return; }
            complete.set!.call(transaction, (event: Event) => {
              // Preserve request-success-before-transaction-complete ordering while
              // holding the complete atomic model/revision read until the canvas mounts.
              Reflect.set(window, 'releaseSavedModelRead', () => handler.call(transaction, event));
            });
          },
        });
        return request;
      };
    });
    await page.reload();
    await expect(page.locator('.react-flow__node[data-id="value"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseSavedModelRead'))).toBe('function');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => Reflect.get(window, 'releaseSavedModelRead')());
    await expect(page.getByRole('status')).toContainText('저장한 모델을 불러왔습니다');
    await expect(page.getByLabel('모델 이름')).toHaveValue('시간에 따른 감쇠');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expectDiagramInsideCanvas(page);
    expect((await canvasViewport(page)).zoom).toBeGreaterThanOrEqual(0.8 - 0.00001);
    expect(await stored(page)).toEqual(model);

    await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
    await expect(page.locator('.output-card strong')).toHaveText('0.006737949');
    await expectDiagramInsideCanvas(page);
    if (width === 1920) await page.screenshot({ path: 'docs/evidence/initial-canvas-fit.png', fullPage: true });

    const fitted = await canvasViewport(page);
    await page.getByRole('button', { name: '캔버스 축소', exact: true }).click();
    await expect.poll(async () => (await canvasViewport(page)).zoom).toBeLessThan(fitted.zoom - 0.01);
    const beforePan = await canvasViewport(page);
    const canvas = (await page.locator('.canvas-area > .react-flow').boundingBox())!;
    await page.mouse.move(canvas.x + 30, canvas.y + 85);
    await page.mouse.down({ button: 'middle' }); await page.mouse.move(canvas.x + 95, canvas.y + 135, { steps: 5 }); await page.mouse.up({ button: 'middle' });
    await expect.poll(async () => Math.abs((await canvasViewport(page)).x - beforePan.x)).toBeGreaterThan(40);
    const userViewport = await canvasViewport(page);
    await page.locator('.model-node-list').getByRole('button', { name: '변화율', exact: true }).click();
    await page.getByLabel('배율', { exact: true }).fill('-2'); await page.getByLabel('배율', { exact: true }).press('Enter');
    await expect.poll(async () => (await stored(page) as CalcModel).nodes.find(node => node.id === 'gain')?.parameters.gain).toBe(-2);
    await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
    await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
    expect(Number(await page.locator('.output-card strong').textContent())).toBeCloseTo(Math.exp(-10), 7);
    const afterRun = await canvasViewport(page);
    expect(afterRun.x).toBeCloseTo(userViewport.x, 5); expect(afterRun.y).toBeCloseTo(userViewport.y, 5);
    expect(afterRun.zoom).toBeCloseTo(userViewport.zoom, 5);
    expect((await stored(page) as CalcModel).layout).toEqual(model.layout);
    expect(errors).toEqual([]);
  });
}

test('Canvas middle dragging pans while left dragging draws a blue marquee without moving diagram blocks', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openWorkspace(page);
  await expectDiagramInsideCanvas(page);
  const original = await stored(page) as CalcModel;
  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') await page.getByRole('button', { name: '라이트 테마로 변경' }).click();
    await expect(page.locator('.app-shell')).toHaveClass(new RegExp(`\\b${theme}\\b`));
    const beforeSelection = await canvasViewport(page);
    const value = (await page.locator('.react-flow__node[data-id="value"]').boundingBox())!;
    const gain = (await page.locator('.react-flow__node[data-id="gain"]').boundingBox())!;
    await page.mouse.move(value.x - 12, value.y - 16);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(gain.x + gain.width + 12, gain.y + gain.height + 16, { steps: 8 });
    const marquee = page.locator('.react-flow__selection');
    await expect(marquee).toBeVisible();
    const rectangle = (await marquee.boundingBox())!;
    expect(rectangle.width).toBeGreaterThan(gain.x + gain.width - value.x);
    expect(rectangle.height).toBeGreaterThan(value.height);
    const colors = await marquee.evaluate(element => {
      const style = getComputedStyle(element);
      const sample = (color: string) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      return { background: sample(style.backgroundColor), border: sample(style.borderTopColor) };
    });
    for (const color of [colors.background, colors.border]) {
      expect(color[2]).toBeGreaterThan(color[0] + 40);
      expect(color[2]).toBeGreaterThan(color[1]);
      expect(color[3]).toBeGreaterThan(0);
    }
    await page.screenshot({ path: `docs/evidence/canvas-selection-${theme}.png`, fullPage: true });
    await page.mouse.up({ button: 'left' });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    expect(await page.locator('.react-flow__node.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')).sort())).toEqual(['gain', 'value']);
    expect(await canvasViewport(page)).toEqual(beforeSelection);
    expect((await stored(page) as CalcModel).layout).toEqual(original.layout);

    // A wheel-button drag over a selected node must pan rather than drag that node or the selection.
    const beforePan = await canvasViewport(page);
    const selectedGain = (await page.locator('.react-flow__node[data-id="gain"]').boundingBox())!;
    const x = selectedGain.x + selectedGain.width / 2, y = selectedGain.y + selectedGain.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(x + 72, y + 48, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(async () => (await canvasViewport(page)).x - beforePan.x).toBeGreaterThan(60);
    const afterPan = await canvasViewport(page);
    expect(afterPan.y - beforePan.y).toBeCloseTo(48, 4);
    expect(afterPan.zoom).toBeCloseTo(beforePan.zoom, 5);
    expect((await stored(page) as CalcModel).layout).toEqual(original.layout);
    await page.getByRole('button', { name: '도식 맞추기', exact: true }).click();
    await expectDiagramInsideCanvas(page);
  }
  expect(errors).toEqual([]);
});

test('Space fits only the focused canvas and leaves field, button, modal, IME and repeated-key behavior intact', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openWorkspace(page);
  await expectDiagramInsideCanvas(page);
  const fitted = await canvasViewport(page);
  const pan = async () => {
    const canvas = (await page.locator('.canvas-area > .react-flow').boundingBox())!;
    const before = await canvasViewport(page);
    await page.mouse.move(canvas.x + 30, canvas.y + 85);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(canvas.x + 120, canvas.y + 145, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(async () => (await canvasViewport(page)).x - before.x).toBeGreaterThan(75);
  };
  await pan();
  await page.keyboard.press('Space');
  await expectDiagramInsideCanvas(page);
  expect(await canvasViewport(page)).toEqual(fitted);

  await pan();
  const selectedNode = page.locator('.react-flow__node[data-id="value"]');
  await selectedNode.click();
  await selectedNode.focus();
  const selectedIds = await page.locator('.react-flow__node.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')));
  await page.keyboard.press('Space');
  await expectDiagramInsideCanvas(page);
  expect(await canvasViewport(page)).toEqual(fitted);
  expect(await page.locator('.react-flow__node.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')))).toEqual(selectedIds);
  for (const target of [selectedNode, page.locator('.react-flow__edge[data-id="value-gain"]')]) {
    await target.focus();
    const description = await target.evaluate(element => (element.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' '));
    expect(description).toMatch(/Enter.*선택/);
    expect(description).toMatch(/Space.*도식.*맞/);
    expect(description).toMatch(/Delete.*삭제/);
  }

  await pan();
  const offsetViewport = await canvasViewport(page);
  const name = page.getByLabel('모델 이름');
  const originalName = await name.inputValue();
  await name.focus(); await name.press('End'); await name.press('Space');
  await expect(name).toHaveValue(`${originalName} `);
  expect(await canvasViewport(page)).toEqual(offsetViewport);
  await name.press('Escape');

  const examples = page.getByRole('button', { name: '예제로 시작' });
  await examples.focus(); await page.keyboard.press('Space');
  await expect(page.locator('.examples-menu')).toBeVisible();
  expect(await canvasViewport(page)).toEqual(offsetViewport);
  await page.keyboard.press('Escape');

  const zoomOut = page.getByRole('button', { name: '캔버스 축소', exact: true });
  await zoomOut.focus(); await page.keyboard.press('Space');
  await expect.poll(async () => (await canvasViewport(page)).zoom).toBeLessThan(offsetViewport.zoom - 0.01);
  const zoomedViewport = await canvasViewport(page);
  await page.getByRole('button', { name: '빠른 추가', exact: false }).click();
  const search = page.getByRole('combobox', { name: '빠른 추가 검색' });
  await search.fill('Gain'); await search.press('End'); await search.press('Space');
  await expect(search).toHaveValue('Gain ');
  expect(await canvasViewport(page)).toEqual(zoomedViewport);
  await page.keyboard.press('Escape');

  await page.getByLabel('도식 캔버스', { exact: true }).focus();
  const ignoredKeys = await page.locator('.react-flow__pane').evaluate(element => [
    { repeat: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
  ].map(options => {
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }));
  // Suppress repeated Space scrolling without fitting again; IME/modifier events stay native.
  expect(ignoredKeys).toEqual([true, false, false, false, false, false, false]);
  expect(await canvasViewport(page)).toEqual(zoomedViewport);
  await page.keyboard.press('Space');
  await expectDiagramInsideCanvas(page);
  expect(await canvasViewport(page)).toEqual(fitted);
  expect(errors).toEqual([]);
});

test('Worker calculation, semantic staleness, undo and local restoration', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('6');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  await page.locator('.model-node-list').getByRole('button', { name: '배율' }).click();
  await page.getByLabel('배율', { exact: true }).fill('4');
  await page.getByLabel('배율', { exact: true }).press('Enter');
  await expect(page.locator('.result-status')).toContainText('다시 계산 필요');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('8');
  await page.getByLabel('블록 이름', { exact: true }).fill('나의 배율');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('저장한 모델을 불러왔습니다');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('8');
  expect(errors).toEqual([]);
});

test('Discrete recurrence and RK4 decay run in the real Worker', async ({ page }) => {
  await openWorkspace(page);
  await selectExample(page, '이전 값을 기억하기');
  await page.getByLabel('종료 시간', { exact: true }).fill('5');
  await page.getByLabel('종료 시간', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('4.0951');
  await expect(page.locator('.run-metadata')).toContainText('6 샘플');
  await selectExample(page, '시간에 따른 감쇠');
  await expect(page.getByRole('button', { name: /코드 다운로드/ })).toBeEnabled();
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('0.006737949');
  await expect(page.locator('.run-metadata')).toContainText('101 샘플');
});

test('Import defaults are normalized and labels remain text under CSP', async ({ page }) => {
  await openWorkspace(page);
  const model = createExample('first-calculation');
  model.nodes.forEach(node => { node.parameters = {}; });
  model.nodes[0].label = '<img src=x onerror="window.calcweaveXss=1">';
  await importModel(page, model);
  await expect(page.locator('.model-node-list')).toContainText('<img src=x onerror=');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('2');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  expect(await page.evaluate(() => Reflect.get(window, 'calcweaveXss'))).toBeUndefined();
  await page.locator('.react-flow__node[data-id="gain"]').click();
  await expect(page.getByLabel('배율', { exact: true })).toHaveValue('2');
});

test('Invalid imports do not replace the model and pure cycles identify their node', async ({ page }) => {
  await openWorkspace(page);
  await importModel(page, { schemaVersion: 999 });
  await expect(page.locator('.diagnostic-item')).not.toHaveCount(0);
  await expect(page.getByLabel('모델 이름')).toHaveValue('첫 배율 계산');
  const cycle = createExample('first-calculation');
  cycle.nodes = cycle.nodes.filter(node => node.id !== 'value');
  delete cycle.layout.value;
  cycle.edges = [{ id: 'self', source: { nodeId: 'gain', portId: 'out' }, target: { nodeId: 'gain', portId: 'in' } }, cycle.edges[1]];
  await importModel(page, cycle);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('CYCLIC_DEPENDENCY');
  await page.locator('.diagnostic-item').click();
  await expect(page.getByLabel('블록 이름', { exact: true })).toHaveValue('배율');
});

test('Unreadable saved originals survive reload and deliberate save recovery', async ({ page }) => {
  await openWorkspace(page);
  const original = { schemaVersion: 999, name: 'future original', opaque: [1, 2, 3] };
  await page.evaluate(async (original) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('models', 'readwrite');
      transaction.objectStore('models').put(original, 'current');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(new Error('Write failed'));
    };
  }), original);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('자동 저장을 중지');
  // More than the autosave debounce: opening an unreadable original cannot overwrite it.
  await expect.poll(async () => stored(page)).toEqual(original);
  await page.getByLabel('모델 이름').fill('복구 후 계산');
  await page.getByLabel('모델 이름').press('Tab');
  await page.waitForTimeout(650);
  expect(await stored(page)).toEqual(original);
  await page.getByRole('button', { name: '현재 모델 저장 다시 시작' }).click();
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  expect(await stored(page, 'recovery')).toEqual(original);
  await page.getByRole('button', { name: '저장 복구본 확인' }).click();
  await expect(page.getByRole('dialog', { name: '저장 복구본' })).toContainText('읽지 못한 원본');
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '원본 복구본 다운로드' }).click();
  expect(JSON.parse(await readFile((await (await originalDownload).path())!, 'utf8'))).toEqual(original);
  expect(await stored(page, 'recovery')).toEqual(original);
  await page.getByRole('button', { name: '복구본 닫기' }).click();
  await page.getByLabel('모델 이름').fill('복구 후 두 번째 수정');
  await page.getByLabel('모델 이름').press('Tab');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  expect(await stored(page, 'recovery')).toEqual(original);
});

test('Keyboard-accessible connection editing, undo and unique block IDs', async ({ page }) => {
  await openWorkspace(page);
  await page.locator('.model-node-list').getByRole('button', { name: '값 표시' }).click();
  await page.getByRole('button', { name: '연결 해제' }).click();
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('REQUIRED_INPUT_MISSING');
  await page.getByLabel('in 입력 연결', { exact: true }).selectOption('value:out');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('2');
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.result-status')).toContainText('다시 계산 필요');
  await page.locator('.library-item').filter({ hasText: 'Constant' }).click();
  await page.getByRole('button', { name: '블록 삭제' }).click();
  await page.locator('.library-item').filter({ hasText: 'Constant' }).click();
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  const saved = await stored(page) as CalcModel;
  expect(new Set(saved.nodes.map(node => node.id)).size).toBe(saved.nodes.length);
});

test('Model and standalone TypeScript downloads reflect the current snapshot', async ({ page }) => {
  await openWorkspace(page);
  const modelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '모델 다운로드' }).click();
  const modelFile = await modelDownload;
  const model = JSON.parse(await readFile((await modelFile.path())!, 'utf8')) as CalcModel;
  expect(model.nodes.length).toBe(3);
  const codeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /코드 다운로드/ }).click();
  const codeFile = await codeDownload;
  expect(codeFile.suggestedFilename()).toBe('model.ts');
  const code = await readFile((await codeFile.path())!, 'utf8');
  expect(code).toContain('export function run');
  expect(code).not.toMatch(/eval\(|new Function|https?:\/\//);
});

test('M2 learning examples expose original array samples, FIR response, rates, seeded repeatability and state space', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page);
  await expect(page.locator('.count-badge')).toHaveText(String(BLOCK_REGISTRY.length));
  await selectExample(page, '배열 상태와 reset');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('9 샘플');
  const sample = page.getByLabel('배열 샘플 번호', { exact: true });
  for (const [number, expected] of [[1, ['0', '0']], [2, ['1', '2']], [4, ['2.71', '5.42']], [5, ['0', '0']]] as const) {
    await sample.fill(String(number)); await sample.press('Enter');
    await expect(page.locator('.signal-result tbody td:last-child')).toHaveText([...expected]);
  }
  await selectExample(page, 'FIR impulse 응답');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('0');
  await page.getByText('수치 표 보기', { exact: false }).click();
  await expect(page.locator('.result-table tbody tr').first()).toContainText('0.25');
  await expect(page.locator('.result-table tbody tr').nth(1)).toContainText('0.5');
  await expect(page.locator('.result-table tbody tr').nth(2)).toContainText('0.25');
  await selectExample(page, '1·2·5배 샘플시간');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card').filter({ hasText: '2배 기록' }).locator('strong')).toHaveText('9');
  await expect(page.locator('.output-card').filter({ hasText: '5배 기록' }).locator('strong')).toHaveText('9');
  await expect(page.locator('.output-card').filter({ hasText: '1배 재수신 기록' }).locator('strong')).toHaveText('7');
  await selectExample(page, '같은 seed의 파형');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('41 샘플');
  const value = await page.locator('.output-card').filter({ hasText: '난수 기록' }).locator('strong').textContent();
  await page.getByRole('button', { name: '실행 초기화', exact: true }).click();
  await expect(page.locator('.output-card')).toHaveCount(0);
  await expect(page.getByLabel('모델 이름')).toHaveValue('같은 seed의 파형');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card').filter({ hasText: '난수 기록' }).locator('strong')).toHaveText(value!);
  await selectExample(page, 'Lookup과 비트 계산');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card').filter({ hasText: '비트 결과' }).locator('strong')).toHaveText('10');
  await page.locator('.output-card').filter({ hasText: '보간 결과' }).click();
  await expect(page.locator('.signal-result tbody td:last-child')).toHaveText(['0', '2.5', '7.5', '10']);
  await selectExample(page, '이산 상태공간');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('1.9375');
  expect(errors).toEqual([]);
});

test('M2 sample-time editing diagnoses rate mismatch and rejects non-integer drafts before execution', async ({ page }) => {
  await openWorkspace(page); await selectExample(page, '1·2·5배 샘플시간');
  await page.locator('.model-node-list').getByRole('button', { name: '2배 수신', exact: true }).click();
  await expect(page.getByLabel('샘플 주기 배수', { exact: true })).toHaveValue('2');
  await expect(page.locator('.sample-time-section')).toContainText('동시에 실행해도 이전 발행값');
  await page.getByLabel('샘플 주기 배수', { exact: true }).fill('2.5');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  await page.getByLabel('샘플 주기 배수', { exact: true }).fill('3'); await page.getByLabel('샘플 주기 배수', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('SAMPLE_TIME_MISMATCH');
  await page.locator('.diagnostic-item').click();
  await expect(page.getByLabel('블록 이름', { exact: true })).toHaveValue('2배 기록');
  await page.getByLabel('샘플 주기 배수', { exact: true }).fill('3'); await page.getByLabel('샘플 주기 배수', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  const bad = createExample('fir-impulse');
  bad.nodes[1].sampleTime = { period: 1.5, offset: 0 };
  await importModel(page, bad);
  await expect(page.locator('.diagnostic-item')).toContainText('INVALID_MODEL');
  await expect(page.getByLabel('모델 이름')).toHaveValue('1·2·5배 샘플시간');
});

test('M2 pause preserves the Worker snapshot, resume yields stale results after edits, and reset releases paused work', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    let pauseNext = true;
    Reflect.set(window, 'pauseNextWorker', () => { pauseNext = true; });
    class ObservedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          // Click the real UI control at the first yielded progress event. This makes
          // the pause boundary deterministic without synthesizing messages/results.
          if (pauseNext && event.data.type === 'progress') {
            pauseNext = false;
            const button = [...document.querySelectorAll('button')].find(control => control.textContent?.trim() === '일시정지');
            if (!button) throw new Error('The active discrete run must expose its pause control.');
            button.click();
          }
        });
      }
    }
    Reflect.set(window, 'Worker', ObservedWorker);
  });
  await openWorkspace(page);
  const model = createExample('first-calculation');
  model.modelId = 'pause-snapshot'; model.name = '일시정지 snapshot';
  model.nodes[0].parameters.value = [1, 2, 3, 4, 5, 6, 7, 8];
  const nodes: CalcModel['nodes'] = [model.nodes[0]], edges: CalcModel['edges'] = [];
  let previous = 'value';
  for (let index = 0; index < 100; index++) {
    const id = `gain-${index}`;
    nodes.push({ id, blockType: 'math.gain', blockVersion: 1, label: '배율', parameters: { gain: 1 } });
    edges.push({ id: `edge-${index}`, source: { nodeId: previous, portId: 'out' }, target: { nodeId: id, portId: 'in' } }); previous = id;
  }
  nodes.push(model.nodes[2]); edges.push({ id: 'edge-result', source: { nodeId: previous, portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
  model.nodes = nodes; model.edges = edges; model.layout = {}; model.execution = { mode: 'discrete', startTime: 0, stopTime: 2000, step: 1 };
  await importModel(page, model);
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await expect(page.locator('.run-brand')).toHaveAttribute('data-activity', 'paused');
  await expect(page.locator('.run-brand')).toHaveAttribute('data-animating', 'false');
  await page.locator('.model-node-list').getByRole('button', { name: '값', exact: true }).click();
  await page.getByLabel('값 유형', { exact: true }).selectOption('number');
  await page.getByLabel('값', { exact: true }).fill('2'); await page.getByLabel('값', { exact: true }).press('Enter');
  await page.getByLabel('실행 방식', { exact: true }).selectOption('static');
  await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '재개', exact: true }).click();
  await expect(page.locator('.run-metadata')).toContainText('2,001 샘플', { timeout: 30_000 });
  await expect(page.locator('.result-status')).toContainText('다시 계산 필요');
  await expect(page.locator('.signal-result tbody td:last-child')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8']);
  await page.getByLabel('실행 방식', { exact: true }).selectOption('discrete');
  await page.evaluate(() => Reflect.get(window, 'pauseNextWorker')());
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '실행 초기화', exact: true }).click();
  await expect(page.getByRole('button', { name: '시뮬레이션 실행' })).toBeVisible();
  await expect(page.locator('.run-brand')).toHaveAttribute('data-activity', 'ready');
  await expect(page.locator('.output-card')).toHaveCount(0);
  await expect(page.getByLabel('모델 이름')).toHaveValue('일시정지 snapshot');
  await page.getByLabel('종료 시간', { exact: true }).fill('2'); await page.getByLabel('종료 시간', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('2');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
});

function zipTexts(bytes: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    result[name] = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size).toString('utf8');
    offset += 30 + nameLength + size;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50); return result;
}

test('M2 runtime diagnostics identify the original block and exact failing tick/time', async ({ page }) => {
  await openWorkspace(page);
  const model = createExample('first-calculation');
  model.nodes[0].blockType = 'source.ramp'; model.nodes[0].parameters = { startTime: 0, slope: -1, initial: 1 };
  model.nodes[1].blockType = 'math.function'; model.nodes[1].parameters = { operation: 'reciprocal' };
  model.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: 1 };
  await importModel(page, model); await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('DIVIDE_BY_ZERO');
  await expect(page.locator('.diagnostic-time')).toHaveText('tick 1 · t = 1 s');
  await page.locator('.diagnostic-item').click();
  await expect(page.getByLabel('블록 이름', { exact: true })).toHaveValue('배율');
  await expect(page.locator('.react-flow__node[data-id="gain"] .block-node')).toHaveClass(/error/);
});

test('M2 editors match negative-time, minimum-step and finite-number contracts while runtime diagnoses overflow', async ({ page }) => {
  await openWorkspace(page);
  const model = createExample('first-calculation');
  model.nodes = [{ id: 'clock', blockType: 'source.clock', blockVersion: 1, label: '시간', parameters: {} }, { id: 'result', blockType: 'sink.scope', blockVersion: 1, label: '시간 기록', parameters: {} }];
  model.edges = [{ id: 'clock-result', source: { nodeId: 'clock', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }];
  model.layout = { clock: { x: 40, y: 140 }, result: { x: 340, y: 140 } };
  model.execution = { mode: 'discrete', startTime: -1, stopTime: 1, step: 0.25 };
  await importModel(page, model);
  await expect(page.getByLabel('시작 시간', { exact: true })).toHaveValue('-1');
  await expect(page.getByLabel('시간 간격', { exact: true })).toHaveValue('0.25');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('9 샘플');
  await expect(page.locator('.output-card strong')).toHaveText('1');
  await page.locator('.result-table summary').click();
  await expect(page.locator('.result-table tbody tr').first().locator('td').first()).toHaveAttribute('title', '-1');
  await page.getByLabel('시작 시간', { exact: true }).fill('-0.75'); await page.getByLabel('시작 시간', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('8 샘플');

  model.execution = { mode: 'discrete', startTime: 0, stopTime: 3e-9, step: 1e-9 };
  await importModel(page, model);
  await expect(page.getByLabel('시간 간격', { exact: true })).toHaveValue('1e-9');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('4 샘플');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  const finalTime = page.locator('.result-table tbody tr').last().locator('td').first();
  expect(Number(await finalTime.getAttribute('title'))).toBeCloseTo(3e-9, 17);
  await page.getByLabel('종료 시간', { exact: true }).fill('4e-9'); await page.getByLabel('종료 시간', { exact: true }).press('Enter');
  await page.getByLabel('시간 간격', { exact: true }).fill('1e-9'); await page.getByLabel('시간 간격', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('5 샘플');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');

  model.nodes[0].blockType = 'source.ramp'; model.nodes[0].parameters = { startTime: 0, slope: 1e308, initial: 0 };
  model.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: 1 };
  await importModel(page, model);
  await page.locator('.model-node-list').getByRole('button', { name: '시간', exact: true }).click();
  await expect(page.getByLabel('기울기', { exact: true })).toHaveValue('1e+308');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('NUMERIC_NONFINITE');
  await expect(page.locator('.diagnostic-item')).not.toContainText('INVALID_NUMBER_DRAFT');
  await expect(page.locator('.diagnostic-time')).toHaveText('tick 2 · t = 2 s');
});

test('M2 execution archive includes current manifest and raw expected fixture, omitting stale results', async ({ page }) => {
  await openWorkspace(page); await selectExample(page, '같은 seed의 파형');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('41 샘플');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '실행 묶음', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toBe('CalcWeave-execution.zip');
  const files = zipTexts(await readFile((await file.path())!));
  expect(Object.keys(files).sort()).toEqual(['README.md', 'expected-output.json', 'manifest.json', 'model.cw.json', 'model.ts', 'run-example.ts']);
  const model = JSON.parse(files['model.cw.json']) as CalcModel;
  const manifest = JSON.parse(files['manifest.json']);
  expect(manifest.engineVersion).toBe(ENGINE_VERSION); expect(manifest.targetVersion).toBe('typescript-m2-v1');
  expect(manifest.modelHash).toBe(createHash('sha256').update(compileModel(model).semanticKey).digest('hex'));
  expect(manifest.dataReferences).toEqual([]); expect(manifest.rateTransitionPolicy).toBe('read-before-write');
  expect(files['model.ts']).toContain('getManifest'); expect(files['model.ts']).not.toMatch(/eval\(|new Function|https?:\/\//);
  const expected = JSON.parse(files['expected-output.json']); expect(expected.samples).toHaveLength(41); expect(expected.status).toBe('completed');
  await page.locator('.model-node-list').getByRole('button', { name: 'seed 난수', exact: true }).click();
  await page.getByLabel('시드', { exact: true }).fill('43'); await page.getByLabel('시드', { exact: true }).press('Enter');
  await expect(page.locator('.result-status')).toContainText('다시 계산 필요');
  const staleDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '실행 묶음', exact: true }).click();
  const stale = zipTexts(await readFile((await (await staleDownload).path())!));
  expect(Object.keys(stale)).toHaveLength(5); expect(stale['expected-output.json']).toBeUndefined();
  expect(stale['README.md']).toContain('expected-output.json을 포함하지 않았습니다');
});

test('M3 evaluates changing time sources at RK stages and separates output from internal solver steps', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page);
  const model = createExample('first-calculation');
  model.nodes[0].blockType = 'source.ramp'; model.nodes[0].parameters = { startTime: 0, slope: 1, initial: 0 };
  model.nodes[1].blockType = 'continuous.integrator'; model.nodes[1].parameters = { initial: 0 };
  model.execution = { mode: 'continuous', startTime: 0, stopTime: 2, step: 1, solver: { method: 'rk4', initialStep: 1, maxStep: 1 } };
  await importModel(page, model);
  await expect(page.getByLabel('시간 간격', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('초기 내부 간격', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('연속 solver 설정')).toContainText('출력 격자');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('2');
  await expect(page.locator('.run-metadata')).toContainText('3 샘플');
  await expect(page.getByLabel('solver 실행 기록')).toContainText('RK4');
  await page.locator('.result-table summary').click();
  await expect(page.locator('.result-table tbody tr').nth(1).locator('td').last()).toHaveAttribute('title', '0.5');
  await page.getByLabel('적분 방법', { exact: true }).selectOption('rk45');
  await page.getByLabel('절대 오차 허용값', { exact: true }).fill('1e-10'); await page.getByLabel('절대 오차 허용값', { exact: true }).press('Enter');
  await page.getByLabel('상대 오차 허용값', { exact: true }).fill('1e-10'); await page.getByLabel('상대 오차 허용값', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.getByLabel('solver 실행 기록')).toContainText('RK45');
  expect(Number(await page.locator('.output-card strong').innerText())).toBeCloseTo(2, 8);
  await expect(page.locator('.run-metadata')).toContainText('3 샘플');
  model.nodes[0].blockType = 'source.clock'; model.nodes[0].parameters = {}; model.nodes[0].unit = '1'; model.execution.stopTime = 3;
  await importModel(page, model);
  await page.locator('.model-node-list').getByRole('button', { name: '값', exact: true }).click();
  await expect(page.getByLabel('단위', { exact: true })).toHaveValue('1');
  await expect(page.locator('.inspector-content')).toContainText('ODE 입력으로 시간을 사용할 때 1');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('4 샘플');
  await expect(page.locator('.output-card strong')).toHaveText('4.5');
  expect(errors).toEqual([]);
});

test('M3 solver settings and empty root vectors remain repairable under invalid drafts', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page); await selectExample(page, 'RK45 감쇠와 오차 제어');
  await page.getByLabel('최대 내부 간격', { exact: true }).fill('0.01'); await page.getByLabel('최대 내부 간격', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('INVALID_SOLVER');
  await expect(page.getByLabel('최대 내부 간격', { exact: true })).toHaveValue('0.01');
  await page.getByLabel('최대 내부 간격', { exact: true }).fill('0.5'); await page.getByLabel('최대 내부 간격', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  expect(Number(await page.locator('.output-card strong').innerText())).toBeCloseTo(Math.exp(-5), 8);

  const model = createExample('continuous-step-response');
  model.nodes[0].blockType = 'source.constant'; model.nodes[0].parameters = { value: 1 };
  model.nodes[1].blockType = 'continuous.zero-pole'; model.nodes[1].parameters = { zeros: [], poles: [-1], gain: 1, initial: [0] };
  model.execution.stopTime = 1;
  await importModel(page, model);
  await page.locator('.model-node-list').getByRole('button', { name: '1차 시스템', exact: true }).click();
  await expect(page.getByLabel('실수 영점', { exact: true })).toHaveValue('[]');
  await page.getByLabel('실수 영점', { exact: true }).fill('[true]'); await page.getByLabel('실수 영점', { exact: true }).press('Tab');
  await expect(page.getByLabel('실수 영점', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  await page.getByLabel('실수 영점', { exact: true }).fill('[]'); await page.getByLabel('실수 영점', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  expect(Number(await page.locator('.output-card strong').innerText())).toBeCloseTo(1 - Math.exp(-1), 5);
  expect(errors).toEqual([]);
});

test('M3 oscillator, filtered PID, Memory and hold examples run through the real Worker', async ({ page }) => {
  await openWorkspace(page);
  for (const [title, samples] of [['2차 적분의 진동', '64'], ['연속 전달 함수의 계단 응답', '51'], ['필터 PID 피드백', '81'], ['Memory와 Unit Delay', '21'], ['사인파의 샘플과 hold', '41']] as const) {
    await selectExample(page, title);
    await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
    await expect(page.locator('.run-metadata')).toContainText(`${samples} 샘플`);
    await expect(page.getByLabel('solver 실행 기록')).toBeVisible();
    const values = await page.locator('.output-card strong').allTextContents();
    expect(values.length).toBeGreaterThan(0); expect(values.every(value => Number.isFinite(Number(value)))).toBe(true);
    if (title === '2차 적분의 진동') { expect(Number(values[0])).toBeCloseTo(Math.cos(6.3), 5); expect(Number(values[1])).toBeCloseTo(-Math.sin(6.3), 5); }
  }
});

test('M3 crossing and reset events retain exact event times alongside simultaneous discrete observations', async ({ page }) => {
  await openWorkspace(page); await selectExample(page, '교차 reset과 같은 이산 tick');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('9 샘플');
  await page.locator('.solver-events summary').click();
  await expect(page.locator('.solver-events')).toContainText('교차');
  await expect(page.locator('.solver-events')).toContainText('초기값 reset');
  const eventRows = await page.locator('.solver-events li span').allTextContents();
  expect(eventRows.some(value => /t = 1(?:\.0+)? s/.test(value))).toBe(true);
  await page.locator('.model-node-list').getByRole('button', { name: '이산 관측', exact: true }).click();
  await expect(page.locator('.sample-time-section')).toContainText('주기 0.5 s');
  await expect(page.getByLabel('샘플 주기 배수', { exact: true })).toHaveValue('1');
});

test('M3 controlled solver failure shows the last valid record and omits failed ZIP fixtures', async ({ page }) => {
  await openWorkspace(page); await selectExample(page, 'RK45 실행 상한 확인');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-brand')).toHaveAttribute('data-activity', 'failed');
  await expect(page.locator('.diagnostic-item')).toContainText(/RUNTIME_(MIN_STEP|REJECTION_BUDGET|INTERNAL_STEP_BUDGET|EVALUATION_BUDGET)/);
  await expect(page.locator('.diagnostic-time')).toContainText('t =');
  await page.getByRole('button', { name: '계산 결과', exact: true }).click();
  await expect(page.locator('.partial-result-note')).toContainText('마지막 유효 기록');
  await expect(page.locator('.output-card strong')).toHaveText('1');
  await expect(page.getByLabel('solver 실행 기록')).toContainText('RK45');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '실행 묶음', exact: true }).click();
  const files = zipTexts(await readFile((await (await download).path())!));
  expect(files['expected-output.json']).toBeUndefined(); expect(files['README.md']).toContain('승인된 M3 부분집합');
  await page.locator('.model-node-list').getByRole('button', { name: '빠른 변화율', exact: true }).click();
  await page.getByLabel('배율', { exact: true }).fill('-1'); await page.getByLabel('배율', { exact: true }).press('Enter');
  await page.getByLabel('최소 내부 간격', { exact: true }).fill('1e-8'); await page.getByLabel('최소 내부 간격', { exact: true }).press('Enter');
  await page.getByLabel('절대 오차 허용값', { exact: true }).fill('1e-8'); await page.getByLabel('절대 오차 허용값', { exact: true }).press('Enter');
  await page.getByLabel('상대 오차 허용값', { exact: true }).fill('1e-6'); await page.getByLabel('상대 오차 허용값', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('11 샘플');
  expect(Number(await page.locator('.output-card strong').innerText())).toBeCloseTo(Math.exp(-1), 5);
  await expect(page.locator('.partial-result-note')).toHaveCount(0);
});

test('M3 continuous ZIP snapshots include solver settings, statistics, events and a matching model hash', async ({ page }) => {
  await openWorkspace(page); await selectExample(page, 'RK45 감쇠와 오차 제어');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('51 샘플');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '실행 묶음', exact: true }).click();
  const files = zipTexts(await readFile((await (await download).path())!));
  const snapshot = JSON.parse(files['model.cw.json']) as CalcModel, manifest = JSON.parse(files['manifest.json']);
  expect(manifest.targetVersion).toBe('typescript-m3-v1'); expect(manifest.engineVersion).toBe(ENGINE_VERSION);
  expect(manifest.execution.solver.method).toBe('rk45'); expect(manifest.execution.solver.atol).toBe(1e-10);
  expect(manifest.modelHash).toBe(createHash('sha256').update(compileModel(snapshot).semanticKey).digest('hex'));
  const expected = JSON.parse(files['expected-output.json']);
  expect(expected.status).toBe('completed'); expect(expected.samples).toHaveLength(51); expect(expected.solverStatistics.method).toBe('rk45'); expect(expected.events).toEqual([]);
  expect(files['model.ts']).toContain('getManifest'); expect(files['model.ts']).not.toMatch(/eval\(|new Function|https?:\/\//);
  expect(files['README.md']).toContain('출력 격자는 solver 내부 간격과 별개');
});

test('M3 real continuous Worker pause resumes its solver snapshot after editor mode changes and supports reset', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    let pauseNext = true;
    Reflect.set(window, 'pauseNextContinuousWorker', () => { pauseNext = true; });
    class ObservedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (pauseNext && event.data.type === 'progress') {
            pauseNext = false;
            const button = [...document.querySelectorAll('button')].find(control => control.textContent?.trim() === '일시정지');
            if (!button) throw new Error('The active continuous run must expose its pause control.');
            button.click();
          }
        });
      }
    }
    Reflect.set(window, 'Worker', ObservedWorker);
  });
  await openWorkspace(page);
  const model = createExample('continuous-decay');
  model.name = '연속 snapshot';
  model.execution = { mode: 'continuous', startTime: 0, stopTime: 0.2, step: 0.01, solver: { method: 'rk4', initialStep: 0.00001, minStep: 1e-8, maxStep: 0.00001, maxSteps: 50000 } };
  await importModel(page, model);
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await expect(page.locator('.run-brand')).toHaveAttribute('data-activity', 'paused');
  await expect(page.locator('.run-brand')).toHaveAttribute('data-animating', 'false');
  await page.locator('.model-node-list').getByRole('button', { name: '변화율', exact: true }).click();
  await page.getByLabel('배율', { exact: true }).fill('-2'); await page.getByLabel('배율', { exact: true }).press('Enter');
  await page.getByLabel('실행 방식', { exact: true }).selectOption('static');
  await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '재개', exact: true }).click();
  await expect(page.locator('.run-metadata')).toContainText('21 샘플');
  expect(Number(await page.locator('.output-card strong').innerText())).toBeCloseTo(Math.exp(-0.2), 7);
  await expect(page.locator('.result-status')).toContainText('다시 계산 필요');
  await importModel(page, model);
  await page.evaluate(() => Reflect.get(window, 'pauseNextContinuousWorker')());
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '실행 초기화', exact: true }).click();
  await expect(page.locator('.run-brand')).toHaveAttribute('data-activity', 'ready');
  await expect(page.locator('.output-card')).toHaveCount(0);
  await expect(page.getByLabel('모델 이름')).toHaveValue('연속 snapshot');
  await page.getByLabel('초기 내부 간격', { exact: true }).fill('0.01'); await page.getByLabel('초기 내부 간격', { exact: true }).press('Enter');
  await page.getByLabel('최대 내부 간격', { exact: true }).fill('0.01'); await page.getByLabel('최대 내부 간격', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.run-metadata')).toContainText('21 샘플');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
});

test('Cancellation returns control and an older run cannot overwrite a new result', async ({ page }) => {
  await page.addInitScript(() => {
    const evidence = { requestedAt: 0, terminatedAt: 0 };
    Reflect.set(window, 'cancelEvidence', evidence);
    const postMessage = Worker.prototype.postMessage;
    const terminate = Worker.prototype.terminate;
    Worker.prototype.postMessage = function(message, options) {
      if (message.type === 'cancel') evidence.requestedAt = performance.now();
      return postMessage.call(this, message, options as StructuredSerializeOptions);
    };
    Worker.prototype.terminate = function() {
      if (evidence.requestedAt) evidence.terminatedAt = performance.now();
      return terminate.call(this);
    };
  });
  await openWorkspace(page);
  const model = cancellationModel();
  await importModel(page, model);
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await page.getByRole('button', { name: '계산 취소', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('계산을 취소했습니다');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'cancelEvidence').terminatedAt)).toBeGreaterThan(0);
  const cancellation = await page.evaluate(() => {
    const evidence = Reflect.get(window, 'cancelEvidence');
    return { ...evidence, latencyMs: evidence.terminatedAt - evidence.requestedAt };
  });
  expect(cancellation.latencyMs).toBeLessThan(1000);
  await writeFile('docs/evidence/m0-browser-cancellation.json', JSON.stringify({
    generatedAt: new Date().toISOString(), browser: page.context().browser()?.version(),
    fixture: { nodes: 1000, intervals: 10000, mode: 'discrete', outputs: 1 },
    metric: 'Real Worker cancel postMessage to termination; single run, not a percentile or universal guarantee.',
    ...cancellation,
  }, null, 2) + '\n');
  await selectExample(page, '첫 배율 계산');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('6');
  await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
});

test('Invalid numeric drafts cannot silently run the previous value', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('6');
  await page.locator('.model-node-list').getByRole('button', { name: '배율' }).click();
  await page.getByLabel('배율', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.diagnostic-item')).toContainText('INVALID_NUMBER_DRAFT');
  await expect(page.getByLabel('배율', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('배율', { exact: true }).fill('5');
  await page.getByLabel('배율', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('10');
});

test('Local preview delivers the declared security headers', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-security-policy']).toContain("worker-src 'self'");
  expect(response.headers()['content-security-policy']).not.toContain("script-src 'self' 'unsafe");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('DENY');
});

test('Korean aliases are searchable without adding new engine blocks', async ({ page }) => {
  await openWorkspace(page);
  const search = page.getByLabel('한국어 또는 영어로 블록 검색');
  await search.fill('더하기');
  await expect(page.locator('.library-item')).toHaveCount(1);
  await expect(page.locator('.library-item')).toContainText('Sum');
  await search.fill('값');
  await expect(page.locator('.library-item').filter({ hasText: 'Constant' })).toBeVisible();
  await search.fill('없는_블럭_이름');
  await expect(page.locator('.search-empty')).toBeVisible();
  await page.getByRole('button', { name: '전체 블록 보기' }).click();
  await expect(page.locator('.library-item')).toHaveCount(BLOCK_REGISTRY.length);
});

test('Default dark theme and the chosen theme survive reload', async ({ page }) => {
  await openWorkspace(page);
  await expect(page.locator('.app-shell')).toHaveClass(/dark/);
  await page.getByRole('button', { name: '라이트 테마로 변경' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/light/);
  await page.getByRole('button', { name: '다크 테마로 변경' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/dark/);
});

test('Compact blocks retain their values and the full result table is reachable', async ({ page }) => {
  await openWorkspace(page);
  const gain = page.locator('.react-flow__node[data-id="gain"]');
  await expect(gain.locator('.block-name')).toHaveText('Gain');
  await expect(gain.locator('.block-value')).toHaveText('3');
  await expect(gain.locator('.block-symbol, .block-type, .block-top')).toHaveCount(0);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.react-flow__node[data-id="result"] .block-value')).toHaveText('6');
  await selectExample(page, '시간에 따른 감쇠');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('0.006737949');
  await page.locator('.result-table summary').click();
  await expect(page.locator('.result-table tbody tr')).toHaveCount(100);
  await expect(page.getByRole('button', { name: '이전 100개' })).toBeDisabled();
  await page.getByRole('button', { name: '다음 100개' }).click();
  await expect(page.locator('.result-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.result-table tbody tr')).toContainText('101');
  await expect(page.locator('.result-table tbody td').first()).toHaveText('5');
  await expect(page.getByRole('button', { name: '다음 100개' })).toBeDisabled();
  await page.getByRole('button', { name: '이전 100개' }).click();
  await expect(page.locator('.result-table tbody tr')).toHaveCount(100);
});

test('Desktop and horizontal tablet keep full-height results beside the canvas; narrow screens stack them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('6');
  await expectWorkbench(page, 'side');
  for (const width of [1024, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expectWorkbench(page, 'side');
    const workbench = (await page.locator('.workbench-layout').boundingBox())!;
    const inspector = (await page.locator('.inspector-panel').boundingBox())!;
    expect(inspector.y).toBeGreaterThanOrEqual(workbench.y + workbench.height - 2);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectWorkbench(page, 'stack');
  await expect(page.locator('.output-card strong')).toHaveText('6');
  await expect(page.getByRole('button', { name: '계산하기' })).toBeVisible();
});

test('A real fast calculation decorates the logo briefly while reporting completed activity, then stops', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openWorkspace(page);
  const brand = page.locator('.brand.run-brand');
  await expect(brand).toHaveAttribute('data-activity', 'ready');
  await expect(brand).not.toHaveClass(/is-pulsing/);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('6');
  await expect(brand).toHaveAttribute('data-activity', 'completed');
  await expect(brand).toHaveAttribute('aria-label', 'CalcWeave');
  await expect(brand).toHaveClass(/is-pulsing/);
  expect(await brand.locator('.brand-mark i').first().evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await expect(brand).not.toHaveClass(/is-pulsing/, { timeout: 4000 });
  await expect(brand).toHaveAttribute('data-animating', 'false');
  await expect(brand).toHaveAttribute('data-activity', 'completed');

  const incomplete = createExample('first-calculation'); incomplete.edges = [];
  await importModel(page, incomplete);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.diagnostic-item')).not.toHaveCount(0);
  await expect(brand).toHaveAttribute('data-activity', 'failed');
  await expect(brand).not.toHaveClass(/is-pulsing/);
});

test('Logo activity continues while a real Worker response is delayed and cancellation removes the decoration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const events: Record<string, unknown>[] = [];
    Reflect.set(window, 'logoCancellationEvidence', events);
    const nativeOnMessage = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')!;
    const delayedResults = new Map<Worker, Set<number>>();
    Object.defineProperty(Worker.prototype, 'onmessage', {
      configurable: nativeOnMessage.configurable,
      enumerable: nativeOnMessage.enumerable,
      get: nativeOnMessage.get,
      set(handler) {
        if (typeof handler !== 'function') { nativeOnMessage.set!.call(this, handler); return; }
        nativeOnMessage.set!.call(this, (event: MessageEvent) => {
          if (event.data.type !== 'result') { handler.call(this, event); return; }
          // Keep the actual result pending during traced UI actions, which can outlast the engine.
          // Progress and the result both come from the real Worker; only transport latency is simulated.
          events.push({ type: 'real-worker-result', time: performance.now() });
          const timers = delayedResults.get(this) ?? new Set<number>();
          delayedResults.set(this, timers);
          const timer = window.setTimeout(() => { timers.delete(timer); handler.call(this, event); }, 10_000);
          timers.add(timer);
        });
      },
    });
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function() {
      for (const timer of delayedResults.get(this) ?? []) window.clearTimeout(timer);
      delayedResults.delete(this);
      return terminate.call(this);
    };
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, options) {
      events.push({ type: 'worker-message', messageType: message.type, time: performance.now() });
      if (message.type === 'run') {
        // Delay delivery, then execute the real engine; no fake result or activity state.
        setTimeout(() => postMessage.call(this, message, options as StructuredSerializeOptions), 2000);
        return;
      }
      return postMessage.call(this, message, options as StructuredSerializeOptions);
    };
  });
  await openWorkspace(page);
  await importModel(page, cancellationModel());
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.locator('.result-empty')).toContainText(/샘플 · t =/, { timeout: 10_000 });
  const brand = page.locator('.brand.run-brand');
  await expect(brand).toHaveAttribute('data-activity', 'running');
  await expect(brand).toHaveClass(/is-pulsing/);
  await expect(brand).toHaveAttribute('aria-label', 'CalcWeave · 계산 중');
  await page.getByRole('button', { name: '계산 취소', exact: true }).click();
  await expect(brand).toHaveAttribute('data-activity', 'cancelled', { timeout: 2000 });
  await expect(brand).not.toHaveClass(/is-pulsing/, { timeout: 2000 });
  await expect(brand).toHaveAttribute('data-animating', 'false');
  const events = await page.evaluate(() => Reflect.get(window, 'logoCancellationEvidence')) as { type: string; messageType?: string }[];
  expect(events.some(event => event.type === 'worker-message' && event.messageType === 'cancel')).toBe(true);
});

test('Reduced motion preserves run status while disabling the logo CSS animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorkspace(page);
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('6');
  const brand = page.locator('.brand.run-brand');
  await expect(brand).toHaveAttribute('data-activity', 'completed');
  const animationNames = await brand.locator('.brand-mark i, .brand-wordmark, .brand-wordmark>span').evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
  expect(animationNames.length).toBeGreaterThan(0);
  expect(animationNames.every(name => name === 'none')).toBe(true);
  expect(await brand.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(false);
});

test('M1 learning examples retain typed values, full matrix elements, formulas and units', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page);
  await selectExample(page, '구매 예산 계산');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('35,000');
  await selectExample(page, '벡터와 2D 배열');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card').filter({ hasText: '2D 결과' }).locator('strong')).toHaveText('2 × 2');
  await expect(page.locator('.output-card').filter({ hasText: '최솟값 결과' }).locator('strong')).toHaveText('-6');
  await expect(page.locator('.result-type').first()).toContainText('float64 · 2D [2 × 2]');
  await expect(page.locator('.signal-result tbody tr')).toHaveCount(4);
  await expect(page.locator('.signal-result tbody td:last-child')).toHaveText(['3', '-6', '9', '12']);
  await selectExample(page, '한 줄 수식 계산');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('4');
  await selectExample(page, '단위와 배율 확인');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('3.5');
  await expect(page.locator('.result-type')).toContainText('float64 · 스칼라 · m');
  expect(errors).toEqual([]);
});

test('Quick Insert presets create canonical blocks and boolean results without intercepting field shortcuts', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: '새 모델', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).fill('True');
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).press('Enter');
  await expect(page.getByRole('dialog', { name: '블록 빠르게 추가' })).not.toBeVisible();
  await expect(page.getByLabel('값', { exact: true })).toHaveValue('true');
  const sourceId = (await page.locator('.react-flow__node').getAttribute('data-id'))!;
  await page.getByRole('button', { name: '빠른 추가', exact: false }).click();
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).fill('sink.display');
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).press('Enter');
  await page.getByLabel('in 입력 연결', { exact: true }).selectOption(`${sourceId}:out`);
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('true');
  await expect(page.locator('.result-type')).toContainText('boolean · 스칼라');
  await page.getByRole('button', { name: '빠른 추가', exact: false }).click();
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).fill('Subtract');
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).press('Enter');
  await expect(page.getByLabel('입력 부호', { exact: true })).toHaveValue('+-');
  await expect(page.locator('.react-flow__node.selected .block-value')).toHaveCount(0);
  await page.getByRole('button', { name: '빠른 추가', exact: false }).click();
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).fill('Pi');
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).press('Enter');
  const number = page.getByLabel('값', { exact: true });
  await expect(number).toHaveValue(String(Math.PI));
  await number.focus(); await number.press('Control+a');
  expect(await number.evaluate(element => (element as HTMLInputElement).selectionEnd! - (element as HTMLInputElement).selectionStart!)).toBe(String(Math.PI).length);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
});

test('Multiple selection copies internal edges, creates unique IDs and deletes as one undo command', async ({ page }) => {
  await openWorkspace(page);
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 90 } });
  await page.keyboard.press('Control+a');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(3);
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
  const ids = await page.locator('.react-flow__node').evaluateAll(elements => elements.map(element => element.getAttribute('data-id')));
  expect(new Set(ids).size).toBe(6);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: '다시 실행 (Ctrl+Shift+Z)', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  // The duplicated model is offset by 48px. Choose the exposed corner of each original.
  await page.locator('.react-flow__node[data-id="value"]').click({ position: { x: 20, y: 20 } });
  await page.locator('.react-flow__node[data-id="gain"]').click({ position: { x: 20, y: 20 }, modifiers: ['Shift'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
});

test('Dynamic Demux ports preserve producer output IDs and parameter edits remove obsolete edges reversibly', async ({ page }) => {
  await openWorkspace(page);
  const model = createExample('first-calculation');
  model.nodes = [
    { id: 'vector', blockType: 'source.constant', blockVersion: 1, label: '벡터 입력', parameters: { value: [10, 20] } },
    { id: 'split', blockType: 'route.demux', blockVersion: 1, label: '벡터 분리', parameters: { count: 2 } },
    { id: 'first', blockType: 'sink.display', blockVersion: 1, label: '첫 출력', parameters: {} },
    { id: 'second', blockType: 'sink.display', blockVersion: 1, label: '둘째 출력', parameters: {} },
  ];
  model.edges = [
    { id: 'vector-split', source: { nodeId: 'vector', portId: 'out' }, target: { nodeId: 'split', portId: 'in' } },
    { id: 'split-first', source: { nodeId: 'split', portId: 'out1' }, target: { nodeId: 'first', portId: 'in' } },
    { id: 'split-second', source: { nodeId: 'split', portId: 'out2' }, target: { nodeId: 'second', portId: 'in' } },
  ];
  model.layout = { vector: { x: 20, y: 100 }, split: { x: 260, y: 100 }, first: { x: 500, y: 20 }, second: { x: 500, y: 240 } };
  await importModel(page, model);
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText(['10', '20']);
  await page.locator('.model-node-list').getByRole('button', { name: '둘째 출력' }).click();
  await expect(page.getByLabel('in 입력 연결', { exact: true })).toHaveValue('split:out2');
  await page.locator('.react-flow__node[data-id="split"]').click();
  await page.getByLabel('출력 개수', { exact: true }).fill('1'); await page.getByLabel('출력 개수', { exact: true }).press('Enter');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.locator('.react-flow__node[data-id="split"] .output-port .react-flow__handle')).toHaveCount(1);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(page.getByLabel('출력 개수', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText(['10', '20']);
});

test('Unsupported source values remain repairable and cannot crash the inspector', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openWorkspace(page);
  for (const value of [null, { unexpected: 1 }]) {
    const model = createExample('first-calculation'); model.nodes[0].parameters.value = value;
    await importModel(page, model);
    await expect(page.locator('.react-flow__node[data-id="value"] .block-value')).toHaveText('—');
    await page.locator('.model-node-list').getByRole('button', { name: '값', exact: true }).click();
    await expect(page.getByLabel('값', { exact: true })).toHaveValue(JSON.stringify(value));
    await page.getByRole('button', { name: '계산하기', exact: false }).click();
    await expect(page.locator('.diagnostic-item')).not.toHaveCount(0);
    await page.getByLabel('값', { exact: true }).fill('5'); await page.getByLabel('값', { exact: true }).press('Enter');
    await page.getByRole('button', { name: '계산하기', exact: false }).click();
    await expect(page.locator('.output-card strong')).toHaveText('15');
  }
  expect(errors).toEqual([]);
});

test('Array and expression drafts reject invalid shapes and code-like input while remaining editable', async ({ page }) => {
  await openWorkspace(page);
  await selectExample(page, '벡터와 2D 배열');
  await page.locator('.model-node-list').getByRole('button', { name: '벡터', exact: true }).click();
  await page.getByLabel('값 유형', { exact: true }).selectOption('matrix');
  await page.getByLabel('값', { exact: true }).fill('[[1,2],[3]]'); await page.getByLabel('값', { exact: true }).press('Tab');
  await expect(page.getByLabel('값', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.brand')).toHaveAttribute('data-activity', 'failed');
  await page.getByLabel('값', { exact: true }).fill('[[1,2],[3,4]]'); await page.getByLabel('값', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card').filter({ hasText: '최솟값 결과' }).locator('strong')).toHaveText('3');
  await selectExample(page, '한 줄 수식 계산');
  await page.locator('.model-node-list').getByRole('button', { name: '수식', exact: true }).click();
  await page.getByLabel('수식', { exact: true }).fill('globalThis.alert(1)'); await page.getByLabel('수식', { exact: true }).press('Tab');
  await expect(page.getByLabel('수식', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.field-message')).toContainText('허용');
  await page.getByLabel('수식', { exact: true }).fill('x^2'); await page.getByLabel('수식', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('9');
});

test('A previous valid save can be inspected, restored and undone without deleting its file backup', async ({ page }) => {
  await openWorkspace(page);
  await page.locator('.model-node-list').getByRole('button', { name: '값', exact: true }).click();
  await page.getByLabel('값', { exact: true }).fill('4'); await page.getByLabel('값', { exact: true }).press('Enter');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  await page.getByRole('button', { name: '저장 복구본 확인' }).click();
  const dialog = page.getByRole('dialog', { name: '저장 복구본' });
  await expect(dialog).toContainText('이전 유효 저장본');
  await dialog.getByRole('button', { name: '복구본 다운로드', exact: true }).focus();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+z'); await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  await expect(page.locator('.react-flow__node[data-id="value"] .block-value')).toHaveText('4');
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: '복구본 다운로드', exact: true }).click();
  const checkpoint = JSON.parse(await readFile((await (await download).path())!, 'utf8')) as CalcModel;
  expect(checkpoint.nodes.find(node => node.id === 'value')?.parameters.value).toBe(2);
  await dialog.getByRole('button', { name: '이전 저장본 복원' }).click();
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('6');
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await page.getByRole('button', { name: '계산하기', exact: false }).click();
  await expect(page.locator('.output-card strong')).toHaveText('12');
});

test('Typed shape and unit diagnostics identify the exact block and input and can be repaired', async ({ page }) => {
  await openWorkspace(page);
  await selectExample(page, '벡터와 2D 배열');
  await page.locator('.model-node-list').getByRole('button', { name: '2D 배열', exact: true }).click();
  await page.getByLabel('행 수', { exact: true }).fill('3'); await page.getByLabel('행 수', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '계산하기' }).click();
  const shape = page.locator('.diagnostic-item').filter({ hasText: 'SHAPE_MISMATCH' });
  await expect(shape).toContainText('in 입력');
  await shape.click(); await expect(page.getByLabel('블록 이름', { exact: true })).toHaveValue('2D 배열');
  await page.getByLabel('행 수', { exact: true }).fill('2'); await page.getByLabel('행 수', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card').filter({ hasText: '2D 결과' }).locator('strong')).toHaveText('2 × 2');
  await selectExample(page, '단위와 배율 확인');
  await page.locator('.model-node-list').getByRole('button', { name: '추가 길이', exact: true }).click();
  await page.getByLabel('단위', { exact: true }).selectOption('s');
  await page.getByRole('button', { name: '계산하기' }).click();
  const unit = page.locator('.diagnostic-item').filter({ hasText: 'UNIT_MISMATCH' });
  await expect(unit).toContainText('b 입력');
  await unit.click(); await expect(page.getByLabel('블록 이름', { exact: true })).toHaveValue('길이 합계');
  await expect(page.locator('.react-flow__node[data-id="sum"] .block-node')).toHaveClass(/error/);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await page.getByRole('button', { name: '계산하기' }).click();
  await expect(page.locator('.output-card strong')).toHaveText('3.5');
});
