import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createExample } from '../../apps/web/src/examples';
import { createSubsystemFromSelection } from '../../packages/compiler/src/hierarchy';
import type { CalcModel } from '../../packages/model/src';

async function open(page: Page) { await page.goto('/'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function importModel(page: Page, model: CalcModel) { await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm4.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) }); await expect(page.locator('.statusbar')).toContainText(`${model.name} 모델을 불러왔습니다.`); }
async function tab(page: Page, name: string) { await page.getByRole('tab', { name, exact: true }).click(); }
async function saved(page: Page, key: string) { return page.evaluate(async key => new Promise<unknown>((resolve, reject) => { const request = indexedDB.open('calcweave-m0', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction('models', 'readonly'), get = tx.objectStore('models').get(key); get.onsuccess = () => resolve(get.result); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('Read failed')); }; request.onerror = () => reject(new Error('Open failed')); }), key); }
async function downloadJson(page: Page, button: string) { const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: button, exact: true }).click(); const item = await downloading; return JSON.parse(await readFile((await item.path())!, 'utf8')) as Record<string, unknown>; }

test('M4 CSV preview commits atomically, binds playback and preserves raw results and history across reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  const model = createExample('first-calculation'); model.nodes = [{ id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '재생 결과', parameters: {} }]; model.edges = []; model.layout = { scope: { x: 420, y: 120 } }; model.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: 0.5 };
  await importModel(page, model); await tab(page, '데이터');
  await page.getByLabel('데이터 파일', { exact: true }).setInputFiles({ name: 'triangle.csv', mimeType: 'text/csv', buffer: Buffer.from('time,value,note\n0,0, Hello \n1,2, WORLD \n2,0, Done ') });
  await page.getByLabel('time 단위').selectOption('s'); await page.getByLabel('문자열 소문자 변환').check();
  await page.getByRole('button', { name: '정리 결과 미리보기' }).click(); await expect(page.getByRole('table', { name: 'triangle 미리보기' })).toContainText('hello');
  await expect(page.locator('.dataset-card')).toHaveCount(0); await page.getByRole('button', { name: '이 데이터 보관' }).click(); await expect(page.locator('.dataset-card')).toHaveCount(1);
  await page.getByRole('button', { name: '도식에 재생 블록 추가' }).click(); await expect(page.getByRole('tab', { name: '도식', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('연결할 입력 선택').selectOption('scope:in'); await page.getByRole('button', { name: '출력 연결하기' }).click();
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await expect(page.locator('.run-metadata')).toContainText('5 샘플');
  await tab(page, '실험'); await expect(page.locator('.history-card')).toHaveCount(1);
  const record = await downloadJson(page, '기록 JSON'); expect((record.result as { samples: { values: { scope: number } }[] }).samples.map(sample => sample.values.scope)).toEqual([0, 1, 2, 1, 0]);
  expect((record.manifest as { dataReferences: unknown[] }).dataReferences).toHaveLength(1);
  await expect.poll(async () => (await saved(page, 'run-history-v1') as unknown[])?.length).toBe(1);
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await page.reload(); await tab(page, '실험'); await expect(page.locator('.history-card')).toHaveCount(1);
  await tab(page, '데이터'); await expect(page.locator('.dataset-card')).toContainText('triangle'); await page.getByRole('button', { name: '데이터 삭제' }).click(); await expect(page.locator('.dataset-card')).toHaveCount(1); await expect(page.locator('.statusbar')).toContainText('참조하는 데이터'); expect(errors).toEqual([]);
});

test('M4 JSON cleaning rejects invalid time data until explicit sort and duplicate rules and refreshes a dataset version', async ({ page }) => {
  await open(page); await tab(page, '데이터');
  await page.getByLabel('데이터 파일', { exact: true }).setInputFiles({ name: 'rows.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ time: 1, value: 4, flag: true }, { time: 0, value: 2, flag: false }, { time: 1, value: 5, flag: false }])) });
  await page.getByRole('button', { name: '정리 결과 미리보기' }).click(); await expect(page.locator('.tool-error')).toBeVisible(); await expect(page.locator('.dataset-card')).toHaveCount(0);
  await page.getByLabel('시간순 정렬').check(); await page.getByLabel('중복 시각').selectOption('keep-last'); await page.getByRole('button', { name: '정리 결과 미리보기' }).click(); await page.getByRole('button', { name: '이 데이터 보관' }).click();
  const first = await downloadJson(page, 'JSON 다운로드'); expect(first.rows).toEqual([[0, 2, false], [1, 5, false]]);
  await page.getByLabel('데이터 파일', { exact: true }).setInputFiles({ name: 'rows.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ time: 0, value: 7, flag: true }, { time: 1, value: 8, flag: false }])) });
  await page.getByLabel('데이터 보관 방식').selectOption(first.id as string); await page.getByRole('button', { name: '정리 결과 미리보기' }).click(); await page.getByRole('button', { name: '이 데이터 보관' }).click();
  await expect(page.locator('.dataset-card')).toHaveCount(1); const second = await downloadJson(page, 'JSON 다운로드'); expect(second.id).toBe(first.id); expect(second.version).toBe(2); expect(second.sourceHash).not.toBe(first.sourceHash);
});

test('M4 subsystem breadcrumb editing advances semantic versions, preserves root exports and supports explicit refresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  const root = createSubsystemFromSelection(createExample('first-calculation'), ['gain'], '배율 모듈'), instance = root.nodes.find(node => node.blockType === 'hierarchy.subsystem')!;
  await importModel(page, root); await page.locator(`.react-flow__node[data-id="${instance.id}"]`).dblclick(); await expect(page.getByRole('navigation', { name: '도식 경로' })).toContainText('배율 모듈');
  await page.locator('.model-node-list').getByRole('button', { name: '배율', exact: true }).click(); await page.getByLabel('배율', { exact: true }).fill('4'); await page.getByLabel('배율', { exact: true }).press('Enter');
  const exported = await downloadJson(page, '모델 다운로드'); expect((exported.nodes as { blockType: string }[]).some(node => node.blockType === 'hierarchy.subsystem')).toBe(true); expect((exported.subsystems as { version: number }[])[0].version).toBe(2);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.output-card strong')).toHaveText('8');
  await page.getByRole('button', { name: '루트 모델', exact: true }).click(); await expect(page.locator('.model-node-list')).toContainText('배율 모듈');
  await page.locator('.model-node-list').getByRole('button', { name: '배율 모듈', exact: true }).click(); await page.getByRole('button', { name: '전체 인스턴스 버전 갱신' }).click();
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)' }).click(); await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.output-card strong')).toHaveText('6'); expect(errors).toEqual([]);
});

test('M4 selected blocks become a subsystem without changing the calculation', async ({ page }) => {
  await open(page); await page.locator('.model-node-list').getByRole('button', { name: '배율', exact: true }).click(); await page.getByRole('button', { name: '하위 도식으로 묶기' }).click();
  await expect(page.locator('.block-name').filter({ hasText: '서브시스템' })).toHaveCount(1); await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.output-card strong')).toHaveText('6');
});

test('M4 dashboard inputs apply next run and notes remain literal text without invalidating results', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await importModel(page, createExample('data-playback'));
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await expect(page.locator('.run-metadata')).toContainText('21 샘플');
  await tab(page, '대시보드'); await page.getByLabel('입력 배율 슬라이더').fill('2'); await expect(page.locator('.dashboard-grid')).toContainText('이전 실행 결과');
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await expect(page.locator('.dashboard-grid')).not.toContainText('이전 실행 결과');
  await tab(page, '노트'); await page.getByLabel('모델 노트').fill('<img src=x onerror=alert(1)>'); await tab(page, '도식'); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await page.reload(); await tab(page, '노트'); await expect(page.getByLabel('모델 노트')).toHaveValue('<img src=x onerror=alert(1)>'); expect(errors).toEqual([]);
});

test('M4 parameter sweeps execute through Workers, share budgets and compare immutable snapshots', async ({ page }) => {
  await open(page); await tab(page, '실험'); await page.getByLabel('스윕 블록').selectOption('gain'); await page.getByLabel('스윕 값').fill('1, 2, 3'); await page.getByRole('button', { name: '파라미터 스윕 실행' }).click();
  await expect(page.locator('.history-card')).toHaveCount(3); await expect(page.locator('.workspace-tools')).toContainText('3 / 3 실행 완료');
  const cards = page.locator('.history-card'); await cards.nth(0).getByRole('checkbox').check(); await cards.nth(1).getByRole('checkbox').check(); await expect(page.getByRole('table', { name: '실행 수치 비교' })).toContainText('-2');
  const downloading = page.waitForEvent('download'); await cards.nth(0).getByRole('button', { name: '기록 JSON', exact: true }).click();
  const record = JSON.parse(await readFile((await (await downloading).path())!, 'utf8')) as { result: { samples: { values: { result: number } }[]; resources?: { operations: number } }; model: CalcModel };
  expect(record.result.samples[0].values.result).toBe(6); expect(record.result.resources!.operations).toBeGreaterThan(0); expect(record.model.nodes.find(node => node.id === 'gain')!.parameters.gain).toBe(3);
});

test('M4 unreadable execution history remains untouched while new model executions continue', async ({ page }) => {
  await page.addInitScript(() => { const opening = indexedDB.open('calcweave-m0', 1); opening.onupgradeneeded = () => opening.result.createObjectStore('models'); opening.onsuccess = () => { const db = opening.result, tx = db.transaction('models', 'readwrite'); tx.objectStore('models').put({ futureVersion: 99, important: 'preserve' }, 'run-history-v1'); tx.oncomplete = () => db.close(); }; });
  await open(page); await tab(page, '실험'); await expect(page.locator('.tool-error')).toContainText('원본');
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.history-card')).toHaveCount(1); expect(await saved(page, 'run-history-v1')).toEqual({ futureVersion: 99, important: 'preserve' });
  const recovery = await downloadJson(page, '기록 원본 다운로드'); expect(recovery.important).toBe('preserve');
});

test('M4 unit conversion, named bus, and dashboard widgets retain readable layout at tablet width', async ({ page }) => {
  await open(page); await importModel(page, createExample('units-and-bus')); await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.output-card strong')).toHaveText('1');
  await tab(page, '대시보드'); await page.getByLabel('위젯 종류').selectOption('gauge'); await page.getByLabel('위젯 제목').fill('측정 길이'); await page.getByRole('button', { name: '위젯 추가', exact: true }).click(); await expect(page.getByRole('meter', { name: '측정 길이 게이지' })).toHaveAttribute('value', '1');
  await page.setViewportSize({ width: 1024, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await expect(page.locator('.dashboard-card')).toBeVisible();
});

test('M4 boolean Toggle and numeric Display bindings apply on the next execution and Scope remains live', async ({ page }) => {
  await open(page);
  const model = createExample('first-calculation'); model.nodes[0]!.parameters.value = false; model.nodes = [model.nodes[0]!, model.nodes[2]!]; model.layout = { value: { x: 40, y: 140 }, result: { x: 350, y: 140 } }; model.edges = [{ id: 'boolean-result', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }];
  await importModel(page, model); await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.output-card strong')).toHaveText('false');
  await tab(page, '대시보드'); await page.getByLabel('위젯 종류').selectOption('toggle'); await page.getByLabel('위젯 제목').fill('Enable'); await page.getByRole('button', { name: '위젯 추가', exact: true }).click();
  await page.getByLabel('위젯 종류').selectOption('display'); await expect(page.getByRole('button', { name: '위젯 추가', exact: true })).toBeDisabled();
  await page.getByLabel('Enable 토글').check(); await expect(page.locator('.dashboard-card').filter({ hasText: 'Enable' })).toContainText('true');
  await page.getByRole('button', { name: '계산하기' }).click(); await tab(page, '도식'); await expect(page.locator('.output-card strong')).toHaveText('true');
  await tab(page, '도식'); await importModel(page, createExample('data-playback')); await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await expect(page.locator('.run-metadata')).toContainText('21 샘플'); await tab(page, '대시보드'); await expect(page.locator('.dashboard-card .plot-frame')).toBeVisible(); await page.getByLabel('위젯 종류').selectOption('display'); await page.getByLabel('위젯 제목').fill('Current numeric'); await page.getByRole('button', { name: '위젯 추가', exact: true }).click(); await expect(page.locator('.dashboard-card').filter({ hasText: 'Current numeric' })).toContainText('0');
});

test('M4 omitted default parameters normalize before immutable history hashing', async ({ page }) => {
  await open(page); const model = createExample('first-calculation'); model.nodes[1]!.parameters = {}; await importModel(page, model);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.output-card strong')).toHaveText('4'); await tab(page, '실험'); await expect(page.locator('.history-card')).toHaveCount(1);
  const record = await downloadJson(page, '기록 JSON'); expect((record.model as CalcModel).nodes.find(node => node.id === 'gain')!.parameters.gain).toBe(2);
  await expect.poll(async () => (await saved(page, 'run-history-v1') as unknown[])?.length).toBe(1); await page.reload(); await tab(page, '실험'); await expect(page.locator('.history-card')).toHaveCount(1); await expect(page.locator('.tool-error')).toHaveCount(0);
});

test('M4 sliders initialize around large and negative values and reject unsupported readout types before adding widgets', async ({ page }) => {
  await open(page); const model = createExample('first-calculation'); model.nodes[0]!.parameters.value = 12500; model.nodes[1]!.parameters.gain = -1; await importModel(page, model);
  await tab(page, '대시보드'); await page.getByLabel('위젯 종류').selectOption('slider'); await page.getByLabel('위젯 블록').selectOption('value'); await page.getByLabel('위젯 제목').fill('Large'); await page.getByRole('button', { name: '위젯 추가', exact: true }).click(); await expect(page.getByLabel('Large 슬라이더')).toHaveAttribute('max', '12500');
  await page.getByLabel('위젯 블록').selectOption('gain'); await page.getByLabel('위젯 제목').fill('Negative'); await page.getByRole('button', { name: '위젯 추가', exact: true }).click(); await expect(page.getByLabel('Negative 슬라이더')).toHaveAttribute('min', '-1');
  await page.getByRole('button', { name: '계산하기' }).click(); await tab(page, '도식'); await expect(page.locator('.output-card strong')).toHaveText('-12,500');
  const vector = createExample('first-calculation'); vector.nodes[0]!.parameters.value = [1, 2]; await importModel(page, vector); await tab(page, '대시보드'); await page.getByLabel('위젯 종류').selectOption('gauge'); await expect(page.getByRole('button', { name: '위젯 추가', exact: true })).toBeDisabled(); await expect(page.locator('.dashboard-card')).toHaveCount(0);
});

test('M4 grouping a dashboard-bound root block preserves the model and explains the binding', async ({ page }) => {
  await open(page); await importModel(page, createExample('data-playback'));
  await page.locator('.model-node-list').getByRole('button', { name: '입력 배율', exact: true }).click(); await page.getByRole('button', { name: '하위 도식으로 묶기' }).click(); await expect(page.locator('.statusbar')).toContainText('위젯 연결을 먼저 삭제');
  await expect(page.locator('.react-flow__node[data-id="gain"]')).toHaveCount(1); await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await expect(page.locator('.run-metadata')).toContainText('21 샘플');
});

test('M4 internal result sinks retain snapshot names in results and CSV while raw IDs stay namespaced', async ({ page }) => {
  await open(page); const model = createSubsystemFromSelection(createExample('first-calculation'), ['value', 'gain', 'result'], '계산 모듈'); await importModel(page, model);
  await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.output-card strong')).toHaveText('6'); await expect(page.locator('.output-card')).toContainText('계산 모듈 / 값 표시'); await expect(page.locator('.output-card')).not.toContainText('hf_');
  await tab(page, '실험'); await expect(page.locator('.history-card')).toHaveCount(1);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '결과 CSV' }).click(); const csv = await readFile((await (await downloading).path())!, 'utf8'); expect(csv).toContain('계산 모듈 / 값 표시'); expect(csv).not.toContain('hf_');
  const record = await downloadJson(page, '기록 JSON'); expect(Object.keys((record.result as { samples: { values: Record<string, number> }[] }).samples[0].values)[0]).toMatch(/^hf_/);
});
