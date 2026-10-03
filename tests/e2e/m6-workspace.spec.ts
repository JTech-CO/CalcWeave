import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createExample } from '../../apps/web/src/examples';
import { BLOCK_REGISTRY } from '../../packages/block-library/src';
import { getReleaseCatalog } from '../../packages/release/src';

async function open(page: Page) { await page.goto('/'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function importExample(page: Page, id: Parameters<typeof createExample>[0]) {
  const model = createExample(id);
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm6.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('.statusbar')).toContainText(`${model.name} 모델을 불러왔습니다.`);
  await expect.poll(async () => (await stored(page, 'current') as { modelId?: string } | undefined)?.modelId).toBe(model.modelId);
  return model;
}
async function download(page: Page, label: string) { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click(); return readFile((await (await pending).path())!); }
async function stored(page: Page, key: string): Promise<unknown> { return page.evaluate(async key => new Promise((resolve, reject) => { const opening = indexedDB.open('calcweave-m0', 1); opening.onsuccess = () => { const db = opening.result, tx = db.transaction('models', 'readonly'), reading = tx.objectStore('models').get(key); reading.onsuccess = () => resolve(reading.result); tx.oncomplete = () => db.close(); tx.onerror = () => reject(new Error('Read failed')); }; opening.onerror = () => reject(new Error('Open failed')); }), key); }
async function manage(page: Page) { await page.getByRole('button', { name: '로컬 데이터 관리', exact: true }).click(); await expect(page.getByRole('dialog', { name: '로컬 데이터 관리' })).toBeVisible(); }

test('M6 support reads all registry metadata, searches parameters and filters actual execution modes', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '지원·릴리스', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '지원·릴리스' }); await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(getReleaseCatalog().engineVersion);
  await expect(page.locator('.support-block-list > button')).toHaveCount(BLOCK_REGISTRY.length);
  await page.getByLabel('지원 블록 검색').fill('wordLength'); await expect(page.locator('.support-block-list > button')).toHaveCount(BLOCK_REGISTRY.filter(block => Object.hasOwn(block.parameters, 'wordLength')).length);
  await page.locator('.support-block-list > button').filter({ hasText: 'Quantize' }).click(); await expect(page.locator('.support-block-detail')).toContainText('stored'); await expect(page.locator('.support-block-detail')).toContainText('nearest-even');
  await page.getByLabel('지원 블록 검색').fill(''); await page.getByLabel('지원 실행 방식').selectOption('static');
  await expect(page.locator('.support-block-list > button')).toHaveCount(BLOCK_REGISTRY.filter(block => block.supportedModes.includes('static')).length);
  await page.getByRole('button', { name: '범위와 상한', exact: true }).click(); await expect(dialog).toContainText('복소수'); await expect(dialog).toContainText('클라우드'); await expect(dialog).toContainText('maxNodes');
});

test('M6 native dialogs trap Tab, isolate background commands and restore the trigger after Escape', async ({ page }) => {
  await open(page); const trigger = page.getByRole('button', { name: '지원·릴리스', exact: true }); await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('지원 블록 검색')).toBeFocused(); await expect(page.locator('.app-header')).toHaveAttribute('aria-hidden', 'true');
  await page.getByRole('button', { name: '지원·릴리스 닫기' }).focus(); await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true })).toBeFocused();
  const before = await stored(page, 'current'); await page.keyboard.press('Control+K'); await page.keyboard.press('Delete'); expect(await stored(page, 'current')).toEqual(before);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await expect(page.locator('.app-header')).not.toHaveAttribute('aria-hidden', 'true');
  const quick = page.getByRole('button', { name: '빠른 추가', exact: false }); await quick.focus(); await page.keyboard.press('Enter'); await expect(page.getByLabel('빠른 추가 검색')).toBeFocused(); await page.keyboard.press('Escape'); await expect(quick).toBeFocused();
});

test('M6 keyboard journey selects a canvas block, edits its value and executes without a mouse', async ({ page }) => {
  await open(page); const model = await importExample(page, 'first-calculation');
  const gain = model.nodes.find(node => node.blockType === 'math.gain')!;
  await page.locator(`.react-flow__node[data-id="${gain.id}"]`).focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('블록 이름', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); const field = page.getByLabel('배율', { exact: true }); await expect(field).toBeFocused();
  await field.fill('5'); await page.keyboard.press('Control+Enter'); await expect(page.locator('.result-status')).toContainText('현재 모델의 결과');
  await expect.poll(async () => (await stored(page, 'run-history-v1') as unknown[] | undefined)?.length).toBe(1);
  const results = await stored(page, 'run-history-v1') as { result: { samples: { values: Record<string, unknown> }[] } }[];
  const resultId = model.nodes.find(node => node.blockType === 'sink.display')!.id;
  expect(results[0]!.result.samples[0]!.values[resultId]).toBe(10);
  await page.getByRole('link', { name: '계산 결과로 바로 이동' }).focus(); await page.keyboard.press('Enter'); await expect(page.locator('#calculation-results')).toBeFocused();
});

test('M6 complete backup previews atomically, restores the exact model and history and remains usable after reload', async ({ page }) => {
  await open(page); const model = await importExample(page, 'matrix-solve-lu'); await page.getByRole('button', { name: '계산하기' }).click();
  await expect.poll(async () => (await stored(page, 'run-history-v1') as unknown[] | undefined)?.length).toBe(1);
  const history = await stored(page, 'run-history-v1'); await manage(page);
  const backupBytes = await download(page, '작업 공간 백업 다운로드'); const backup = JSON.parse(backupBytes.toString('utf8'));
  expect(backup.format).toBe('calcweave-workspace'); expect(backup.version).toBe(1); expect(backup.model.modelId).toBe(model.modelId); expect(backup.history).toEqual(history); expect(backup.manifest.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  await page.keyboard.press('Escape'); await importExample(page, 'lookup-2d-nonuniform'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); await manage(page);
  await page.getByLabel('작업 공간 백업 파일 선택').setInputFiles({ name: 'workspace.cwbackup.json', mimeType: 'application/json', buffer: backupBytes });
  await expect(page.getByLabel('백업 복구 미리보기')).toContainText('행렬 풀이와 피벗 LU'); await expect(page.getByLabel('백업 복구 미리보기')).toContainText('1개로 전체 교체');
  expect((await stored(page, 'current') as { modelId: string }).modelId).not.toBe(model.modelId);
  await page.getByRole('button', { name: '검증한 백업으로 복구 후 다시 열기', exact: true }).click();
  await expect(page.getByLabel('모델 이름')).toHaveValue(model.name); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  expect(await stored(page, 'run-history-v1')).toEqual(history); await page.reload(); await expect(page.getByLabel('모델 이름')).toHaveValue(model.name);
});

test('M6 corrupted and unsupported backup drafts never change saved model or execution records', async ({ page }) => {
  await open(page); await importExample(page, 'quantizer-rounding-overflow'); await page.getByRole('button', { name: '계산하기' }).click();
  await expect.poll(async () => (await stored(page, 'run-history-v1') as unknown[] | undefined)?.length).toBe(1); await manage(page);
  const backup = JSON.parse((await download(page, '작업 공간 백업 다운로드')).toString('utf8')); const beforeModel = await stored(page, 'current'), beforeHistory = await stored(page, 'run-history-v1');
  for (const invalid of [{ ...backup, model: { ...backup.model, name: 'hash-tamper' } }, { ...backup, version: 999 }, { format: 'other-app' }]) {
    await page.getByLabel('작업 공간 백업 파일 선택').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.locator('.local-management-error')).toBeVisible(); await expect(page.getByLabel('백업 복구 미리보기')).toHaveCount(0);
    expect(await stored(page, 'current')).toEqual(beforeModel); expect(await stored(page, 'run-history-v1')).toEqual(beforeHistory);
  }
});

test('M6 damaged slots remain downloadable while closed-field diagnostics exclude model text and values', async ({ page }) => {
  const secret = 'SENSITIVE-MODEL-TEXT-991'; // vsf-ignore: synthetic diagnostic-redaction fixture, not a credential.
  await open(page); await page.evaluate(async secret => new Promise<void>((resolve, reject) => { const request = indexedDB.open('calcweave-m0', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction('models', 'readwrite'); tx.objectStore('models').put({ schemaVersion: 999, secret, values: [87654321] }, 'current'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(new Error('Write failed')); }; }), secret);
  await page.reload(); await expect(page.locator('.save-recovery-banner')).toBeVisible(); await manage(page); await page.getByRole('button', { name: '저장 상태', exact: true }).click();
  const original = await download(page, '현재 모델 원본 다운로드'); expect(original.toString('utf8')).toContain(secret);
  await page.getByRole('button', { name: '로컬 진단', exact: true }).click(); const diagnostics = JSON.parse((await download(page, '로컬 진단 다운로드')).toString('utf8'));
  expect(diagnostics.format).toBe('calcweave-local-diagnostics'); expect(JSON.stringify(diagnostics)).not.toContain(secret); expect(JSON.stringify(diagnostics)).not.toContain('87654321');
  for (const entry of diagnostics.records) expect(Object.keys(entry).sort()).toEqual(['at', 'code', 'context', 'engineVersion']);
  expect(await stored(page, 'current')).toEqual(JSON.parse(original.toString('utf8')));
});

test('M6 local reset requires an explicit second step and preserves unrelated browser preferences', async ({ page }) => {
  await open(page); const model = await importExample(page, 'lookup-2d-nonuniform'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  await page.evaluate(() => { localStorage.setItem('unrelated-setting', 'preserve'); localStorage.setItem('calcweave.theme', 'light'); }); await manage(page); await page.getByRole('button', { name: '데이터 삭제', exact: true }).click();
  await page.getByRole('button', { name: '로컬 데이터 삭제 확인', exact: true }).click(); await expect(page.getByRole('button', { name: '영구 삭제 후 다시 열기' })).toBeDisabled();
  expect((await stored(page, 'current') as { modelId: string }).modelId).toBe(model.modelId);
  await page.getByLabel('백업을 확인했으며 로컬 데이터를 삭제합니다.').check(); await page.getByRole('button', { name: '영구 삭제 후 다시 열기' }).click();
  await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('first-calculation').name); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  expect(await page.evaluate(() => localStorage.getItem('unrelated-setting'))).toBe('preserve'); expect(await stored(page, 'run-history-v1')).toBeUndefined(); await expect(page.locator('.app-shell')).toHaveClass(/dark/);
});

for (const width of [320, 390]) for (const theme of ['dark', 'light'] as const) {
  test(`M6 support and local management fit ${width}px in ${theme} with readable native controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await open(page); if (theme === 'light') await page.getByRole('button', { name: '라이트 테마로 변경' }).click();
    await page.getByRole('button', { name: '지원·릴리스', exact: true }).click();
    for (const current of ['support', 'management'] as const) {
      if (current === 'management') { await page.keyboard.press('Escape'); await manage(page); }
      const metrics = await page.getByRole('dialog').evaluate(dialog => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, bounds: dialog.getBoundingClientRect().toJSON(), controls: [...dialog.querySelectorAll('button,input,select,textarea')].filter(item => item.getBoundingClientRect().width > 0).map(item => ({ font: parseFloat(getComputedStyle(item).fontSize), width: item.getBoundingClientRect().width, overflow: item.scrollWidth > item.clientWidth + 2 && !['INPUT', 'SELECT', 'TEXTAREA'].includes(item.tagName) })) }));
      expect(metrics.document).toBeLessThanOrEqual(width); expect(metrics.bounds.left).toBeGreaterThanOrEqual(0); expect(metrics.bounds.right).toBeLessThanOrEqual(width); for (const control of metrics.controls) { expect(control.font).toBeGreaterThanOrEqual(14); expect(control.overflow).toBe(false); }
    }
  });
}

test('M6 policies use local static routes and identify the actual operator without remote form submissions', async ({ page, context }) => {
  await open(page); await page.getByRole('button', { name: '지원·릴리스', exact: true }).click(); await page.getByRole('button', { name: '정책·로컬 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('JTech-Co'); await expect(page.getByRole('dialog')).toContainText('jtech-bryan@proton.me');
  for (const [label, path] of [['개인정보 처리방침', '/privacy/'], ['이용약관', '/terms/'], ['쿠키·로컬 저장 안내', '/cookies/'], ['릴리스·오픈소스 고지', '/notices/']] as const) {
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', path);
    const policy = await context.newPage(); await policy.goto(path); await expect(policy.locator('h1')).toBeVisible(); expect(new URL(policy.url()).origin).toBe('http://127.0.0.1:4173'); await policy.close();
  }
});
