import { expect, test, type Page } from '@playwright/test';
import { expandLocalReset, expandStorageTroubleshooting, openWorkspaceBackup } from './workspace-tools';
import { readFile } from 'node:fs/promises';
import { createExample } from '../../apps/web/src/examples';
import { createSubsystemFromSelection } from '../../packages/compiler/src/hierarchy';
import type { CalcModel } from '../../packages/model/src';

async function open(page: Page) { await page.goto('./'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function importModel(page: Page, model: CalcModel) { await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'recovery.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) }); await expect(page.getByLabel('모델 이름')).toHaveValue(model.name); await expect.poll(async () => (await stored(page)).current).toEqual(model); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function manage(page: Page) { await openWorkspaceBackup(page); await expect(page.getByRole('dialog', { name: '백업·복구', exact: true })).toBeVisible(); }
async function download(page: Page, label: string): Promise<Buffer> { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click(); return readFile((await (await pending).path())!); }
async function stored(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onsuccess = () => { const database = request.result, transaction = database.transaction('models', 'readonly'), store = transaction.objectStore('models'), result: Record<string, unknown> = {};
      const keys = store.getAllKeys(); keys.onsuccess = () => keys.result.forEach((key) => { const value = store.get(key); value.onsuccess = () => { result[String(key)] = value.result; }; });
      transaction.oncomplete = () => { database.close(); resolve(result); }; transaction.onerror = () => reject(new Error('Read failed')); };
    request.onerror = () => reject(new Error('Open failed'));
  }));
}
async function run(page: Page, count: number) { await page.getByRole('button', { name: '시뮬레이션 실행', exact: false }).click(); await expect(page.locator('.run-metadata')).toContainText(`${count} 샘플`); await expect.poll(async () => ((await stored(page))['run-history-v1'] as unknown[] | undefined)?.length).toBe(1); }

test('M6 real workspace backup retains datasets, repeated source definitions, dashboard, literal notes and complete raw history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message)); await open(page);
  const base = createExample('data-playback'); base.dashboard = []; const model = createSubsystemFromSelection(base, ['gain'], '재생 배율 도식'); model.dashboard = [{ id: 'readout', kind: 'display', title: '재생 결과', nodeId: 'result' }]; model.notes = '<img src=x onerror=alert(1)> literal scientific notes';
  await importModel(page, model); await run(page, 21); const before = await stored(page); await manage(page); const bytes = await download(page, '작업 공간 백업 다운로드'), backup = JSON.parse(bytes.toString('utf8'));
  expect(backup.model.datasets).toEqual(model.datasets); expect(backup.model.subsystems).toEqual(model.subsystems); expect(backup.model.dashboard).toEqual(model.dashboard); expect(backup.model.notes).toBe(model.notes); expect(backup.history).toEqual(before['run-history-v1']);
  expect(backup.history[0].result.samples).toHaveLength(21); expect(backup.history[0].manifest.dataReferences).toHaveLength(1); expect(backup.history[0].manifest.hierarchyReferences).toHaveLength(1);
  await page.keyboard.press('Escape'); await importModel(page, createExample('first-calculation')); await manage(page); await page.getByLabel('작업 공간 백업 파일 선택').setInputFiles({ name: 'full.cwbackup.json', mimeType: 'application/json', buffer: bytes }); await expect(page.getByLabel('백업 복구 미리보기')).toContainText('1개 데이터 · 1개 하위 도식');
  await page.getByRole('button', { name: '검증한 백업으로 복구 후 다시 열기' }).click(); await expect(page.getByLabel('모델 이름')).toHaveValue(model.name); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  const restored = await stored(page); expect(restored.current).toEqual(backup.model); expect(restored['run-history-v1']).toEqual(backup.history); expect((restored['previous-valid'] as { model: CalcModel }).model.modelId).toBe('first-calculation');
  await page.getByRole('tab', { name: '노트', exact: true }).click(); await expect(page.getByLabel('모델 노트')).toHaveValue(model.notes); expect(await page.locator('img[src="x"]').count()).toBe(0); expect(errors).toEqual([]);
});

test('M6 real IndexedDB abort during the history write rolls back the model, checkpoint, history and revision together', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
      if ((window as unknown as Record<string, unknown>).failWorkspaceHistoryWrite && key === 'run-history-v1') throw new DOMException('Simulated storage quota', 'QuotaExceededError');
      return original.call(this, value, key!);
    };
  });
  await open(page); await importModel(page, createExample('data-playback')); await run(page, 21); await manage(page); const bytes = await download(page, '작업 공간 백업 다운로드'); await page.keyboard.press('Escape'); await importModel(page, createExample('lookup-2d-nonuniform')); const before = await stored(page); await manage(page);
  await page.getByLabel('작업 공간 백업 파일 선택').setInputFiles({ name: 'full.cwbackup.json', mimeType: 'application/json', buffer: bytes }); await expect(page.getByLabel('백업 복구 미리보기')).toBeVisible(); await page.evaluate(() => { (window as unknown as Record<string, unknown>).failWorkspaceHistoryWrite = true; });
  await page.getByRole('button', { name: '검증한 백업으로 복구 후 다시 열기' }).click(); await expect(page.locator('.local-management-error')).toContainText('브라우저 저장 공간'); expect(await stored(page)).toEqual(before); await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('lookup-2d-nonuniform').name); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('calcweave.local-operations-v1')!).at(-1).code)).toBe('STORAGE_QUOTA_EXCEEDED');
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).failWorkspaceHistoryWrite = false; }); await page.getByRole('button', { name: '검증한 백업으로 복구 후 다시 열기' }).click(); await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('data-playback').name); expect((await stored(page))['run-history-v1']).toEqual(JSON.parse(bytes.toString('utf8')).history);
});

test('M6 opening an unchanged second tab creates no false conflict; later edits cannot overwrite another tab', async ({ page, context }) => {
  await open(page); const baseline = await stored(page), other = await context.newPage(); await open(other); expect((await stored(other))['workspace-revision-v1']).toBe(baseline['workspace-revision-v1']); await expect(page.locator('.save-recovery-banner')).toHaveCount(0);
  const changed = createExample('data-playback'); await importModel(page, changed); await expect(other.locator('.save-recovery-banner')).toContainText('다른 탭');
  await other.getByLabel('모델 이름').fill('현재 탭의 보관할 작업'); await other.getByLabel('모델 이름').press('Enter'); await manage(other); const backup = JSON.parse((await download(other, '작업 공간 백업 다운로드')).toString('utf8')); expect(backup.model.name).toBe('현재 탭의 보관할 작업');
  expect((await stored(page)).current).toEqual(changed); await other.keyboard.press('Escape'); await other.getByRole('button', { name: '최신 저장본 불러오기' }).click(); await expect(other.getByLabel('모델 이름')).toHaveValue(changed.name); await expect(other.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await expect(other.locator('.save-recovery-banner')).toHaveCount(0); await other.close();
});

test('M6 reset clears every IndexedDB key, diagnostics, backup metadata and both preference stores before startup creates a new workspace', async ({ page }) => {
  await open(page); await importModel(page, createExample('data-playback')); await run(page, 21);
  await page.evaluate(() => new Promise<void>((resolve, reject) => { const request = indexedDB.open('calcweave-m0', 1); request.onsuccess = () => { const database = request.result, transaction = database.transaction('models', 'readwrite'); for (const key of ['recovery', 'run-history-recovery-v1', 'unknown-future-meta']) transaction.objectStore('models').put({ raw: 'preserved until explicit deletion' }, key); transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => reject(new Error('Write failed')); }; }));
  await page.evaluate(() => { localStorage.setItem('calcweave.local-operations-v1', '[]'); localStorage.setItem('calcweave.backup-status-v1', '{}'); localStorage.setItem('unrelated-preference', 'retain'); sessionStorage.setItem('calcweave.editor-state', 'remove'); sessionStorage.setItem('unrelated-session', 'retain'); });
  await page.addInitScript(() => {
    const localKeys = Array.from({ length: localStorage.length }, (_value, index) => localStorage.key(index)).filter((key) => key?.startsWith('calcweave.'));
    const sessionKeys = Array.from({ length: sessionStorage.length }, (_value, index) => sessionStorage.key(index)).filter((key) => key?.startsWith('calcweave.'));
    (window as unknown as Record<string, unknown>).beforeAppResetState = new Promise((resolve, reject) => { const request = indexedDB.open('calcweave-m0', 1); request.onsuccess = () => { const database = request.result, transaction = database.transaction('models', 'readonly'), keys = transaction.objectStore('models').getAllKeys(); keys.onsuccess = () => resolve({ databaseKeys: keys.result, localKeys, sessionKeys }); transaction.oncomplete = () => database.close(); transaction.onerror = () => reject(new Error('Read failed')); }; });
  });
  await manage(page); await expandLocalReset(page); await page.getByRole('button', { name: '로컬 데이터 삭제 확인', exact: true }).click(); await expect(page.getByRole('button', { name: '영구 삭제 후 다시 열기' })).toBeDisabled(); await page.getByLabel('백업을 확인했으며 로컬 데이터를 삭제합니다.').check();
  await page.getByRole('button', { name: '영구 삭제 후 다시 열기' }).click(); await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('first-calculation').name); expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).beforeAppResetState)).toEqual({ databaseKeys: [], localKeys: [], sessionKeys: [] });
  expect(await page.evaluate(() => ({ local: localStorage.getItem('unrelated-preference'), session: sessionStorage.getItem('unrelated-session') }))).toEqual({ local: 'retain', session: 'retain' }); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); expect((await stored(page))['run-history-v1']).toBeUndefined();
});

test('M6 metadata getter-independent diagnostics export discards hostile extra fields from damaged local log storage', async ({ page }) => {
  await open(page); await page.evaluate(() => localStorage.setItem('calcweave.local-operations-v1', JSON.stringify([{ code: 'STORAGE_READ_FAILED', context: 'storage', at: new Date().toISOString(), engineVersion: '0.6.0-m6', stack: 'private-model-label', value: 999888777 }, { code: 'MODEL_IMPORT_FAILED', context: 'validation', at: new Date().toISOString(), engineVersion: '0.6.0-m6' }, { code: 'STORAGE_READ_FAILED', context: 'storage', at: new Date().toISOString(), engineVersion: '0.6.0-private-model-label' }])));
  await manage(page); await expandStorageTroubleshooting(page); const diagnostics = JSON.parse((await download(page, '로컬 진단 다운로드')).toString('utf8')); expect(diagnostics.records).toHaveLength(1); expect(Object.keys(diagnostics.records[0]).sort()).toEqual(['at', 'code', 'context', 'engineVersion']); expect(JSON.stringify(diagnostics)).not.toContain('private-model-label'); expect(JSON.stringify(diagnostics)).not.toContain('999888777');
  await page.getByRole('button', { name: '진단 기록 지우기', exact: true }).click(); expect(await page.evaluate(() => localStorage.getItem('calcweave.local-operations-v1'))).toBeNull();
});

test('M6 a stale-tab reset confirmation cannot erase a newer model or its preferences', async ({ page, context }) => {
  await open(page); const other = await context.newPage(); await open(other); await manage(other); await expandLocalReset(other); await other.getByRole('button', { name: '로컬 데이터 삭제 확인', exact: true }).click(); await other.getByLabel('백업을 확인했으며 로컬 데이터를 삭제합니다.').check();
  const newer = createExample('data-playback'); await importModel(page, newer); const before = await stored(page); await page.evaluate(() => localStorage.setItem('calcweave.protected-setting', 'retain'));
  await other.getByRole('button', { name: '영구 삭제 후 다시 열기' }).click(); await expect(other.locator('.local-management-error')).toContainText('다른 탭'); expect(await stored(page)).toEqual(before); expect(await page.evaluate(() => localStorage.getItem('calcweave.protected-setting'))).toBe('retain'); await other.close();
});
