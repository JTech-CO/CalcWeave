import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function workspace(page: Page) {
  await page.goto('./');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function matrix(page: Page) {
  await page.getByRole('button', { name: '지원·릴리스', exact: true }).click();
  await expect(page.getByLabel('지원 블록 검색')).toBeFocused();
  await page.getByRole('button', { name: '원자료 대응표', exact: true }).click();
  return page.getByRole('dialog', { name: '지원·릴리스', exact: true });
}
async function selectSource(page: Page, id: string) {
  await page.locator(`.source-support-list>button[data-source-id="${id}"]`).click();
  return page.getByRole('region', { name: '원자료 선택 항목 상세' });
}
async function report(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '전체 대응표 JSON 다운로드', exact: true }).click();
  return JSON.parse((await readFile((await (await pending).path())!)).toString('utf8'));
}
async function savedModel(page: Page): Promise<unknown> {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const opening = indexedDB.open('calcweave-m0', 1);
    opening.onsuccess = () => { const database = opening.result, transaction = database.transaction('models', 'readonly'), reading = transaction.objectStore('models').get('current'); reading.onsuccess = () => resolve(reading.result); transaction.oncomplete = () => database.close(); transaction.onerror = () => reject(new Error('Model read failed')); };
    opening.onerror = () => reject(new Error('Model database unavailable'));
  }));
}

test('M16 keeps all 385 source identities and distinguishes the three Display mappings from 337 registered blocks', async ({ page }) => {
  await workspace(page); const dialog = await matrix(page);
  await expect(dialog).toContainText('337개 블록');
  await expect(page.locator('.source-support-list>button')).toHaveCount(385);
  await page.getByLabel('원자료 검색').fill('Display');
  const identities = await page.locator('.source-support-list>button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-source-id')));
  expect(identities).toEqual(expect.arrayContaining(['03-005', '03-024', '16-001']));
  const dashboard = await selectSource(page, '03-005'); await expect(dashboard).toContainText('dashboard.readout'); await expect(dashboard).toContainText('model-widget');
  await dashboard.locator('[data-canonical-support-id="dashboard.readout"] summary').click(); await expect(dashboard).toContainText('기본값 지정 없음'); await expect(dashboard).toContainText('nodeId');
  await expect(dashboard.locator('[data-support-target="python"]')).toHaveAttribute('data-support-target-status', 'ui-only');
  const custom = await selectSource(page, '03-024'); await expect(custom).toContainText('dashboard.indicator'); await expect(custom).toContainText('custom');
  const sink = await selectSource(page, '16-001'); await expect(sink).toContainText('sink.display'); await expect(sink).toContainText('전체 동등성 미검증');
});

test('M16 displays the approved preset configuration without treating its shared canonical implementation as full native support', async ({ page }) => {
  await workspace(page); await matrix(page); await page.getByLabel('원자료 검색').fill('06-001');
  await expect(page.locator('.source-support-list>button')).toHaveCount(1);
  const detail = await selectSource(page, '06-001');
  await expect(detail).toContainText('Bit Clear'); await expect(detail).toContainText('logic.bit-mask');
  await expect(detail).toContainText('clear'); await expect(detail).toContainText('operation');
  await expect(detail).toContainText('자료형'); await expect(detail).toContainText('설정');
  await expect(detail).toContainText('전체 동등성 미검증'); await expect(detail).toContainText('unverified');
});

test('M16 separates an unavailable MATLAB adapter from the executable independent C Caller alternative', async ({ page }) => {
  await workspace(page); await matrix(page); await page.getByLabel('원자료 검색').fill('19-009');
  const native = await selectSource(page, '19-009'); await expect(native).toContainText('MATLAB System');
  await expect(native).toContainText('외부 조건'); await expect(native).toContainText('미지원');
  await expect(native.getByRole('button', { name: /실행|추가|업로드/ })).toHaveCount(0);
  await page.getByLabel('원자료 검색').fill('19-001'); const independent = await selectSource(page, '19-001');
  await expect(independent).toContainText('adapter.wasm-affine'); await expect(independent).toContainText('독립 대체');
  await expect(independent).toContainText('native'); await expect(independent).toContainText('전체 동등성 미검증');
});

test('M16 Python filtering retains current approved string capabilities and their selected configuration limits', async ({ page }) => {
  await workspace(page); await matrix(page);
  await page.getByLabel('원자료 코드 타깃').selectOption('python');
  await page.getByLabel('원자료 검색').fill('18-006'); await expect(page.locator('.source-support-list>button')).toHaveCount(1);
  const detail = await selectSource(page, '18-006'); await expect(detail).toContainText('source.string-constant');
  await expect(detail).toContainText('Python'); await expect(detail).toContainText('선택 구성');
  await expect(detail).toContainText('string'); await expect(detail).toContainText('static');
  await expect(detail).toContainText('실제 모델');
  await page.getByLabel('원자료 코드 타깃').selectOption('wasm'); await expect(page.locator('.source-support-list>button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '원자료 선택 항목 상세' })).toHaveCount(0);
});

test('M16 report downloads all source rows even after filtering and never upgrades source inventory or full equivalence claims', async ({ page }) => {
  await workspace(page); await matrix(page); await page.getByLabel('원자료 검색').fill('06-001');
  const downloaded = await report(page);
  expect(downloaded.fullSimulinkEquivalenceClaimed).toBe(false);
  expect(downloaded.numericalReferenceRuntimeExecuted).toBe(false);
  expect(downloaded.exhaustiveSourceOptionInventoryVerified).toBe(false);
  expect(downloaded.counts.registryDefinitions).toBe(337);
  expect(downloaded.canonicalContracts.filter((contract: { kind: string }) => contract.kind === 'registry-block')).toHaveLength(337);
  expect(downloaded.rows).toHaveLength(385);
  expect(new Set(downloaded.rows.map((row: { id: string }) => row.id)).size).toBe(385);
  expect(downloaded.rows.every((row: { fullEquivalence: boolean; sourceInventory: { status: string } }) => row.fullEquivalence === false && row.sourceInventory.status === 'unverified')).toBe(true);
  expect(downloaded.rows.find((row: { id: string }) => row.id === '03-005').implementations).not.toEqual(downloaded.rows.find((row: { id: string }) => row.id === '16-001').implementations);
});

test('M16 category, implementation and status filters agree with the downloaded source decisions and clear stale details', async ({ page }) => {
  await workspace(page); await matrix(page); const downloaded = await report(page);
  await page.getByLabel('원자료 분류').selectOption('19');
  await page.getByLabel('원자료 구현 유형').selectOption('conditional-adapter');
  await page.getByLabel('원자료 지원 상태').selectOption('unsupported');
  const expected = downloaded.rows.filter((row: { id: string; section: number; decision: { classification: string; status: string } }) => row.section === 19 && row.decision.classification === 'conditional-adapter' && row.decision.status === 'unsupported').map((row: { id: string }) => row.id);
  expect(expected.length).toBeGreaterThan(0);
  await expect(page.locator('.source-support-list>button')).toHaveCount(expected.length);
  expect(await page.locator('.source-support-list>button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-source-id')))).toEqual(expected);
  await page.getByLabel('원자료 코드 타깃').selectOption('c-cpp'); await expect(page.locator('.source-support-list>button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '원자료 선택 항목 상세' })).toHaveCount(0);
});

test('M16 malicious search stays inert and support keyboard commands preserve the current diagram', async ({ page, baseURL }) => {
  const dialogs: string[] = [], errors: string[] = [], outsideRequests: string[] = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) outsideRequests.push(request.url()); });
  await workspace(page); const before = await page.locator('.canvas-topline strong').textContent(), beforeModel = await savedModel(page); await matrix(page);
  await page.getByLabel('원자료 검색').fill('Display');
  const first = page.locator('.source-support-list>button').first(), second = page.locator('.source-support-list>button').nth(1);
  await first.focus(); await page.keyboard.press('ArrowDown'); await expect(second).toBeFocused(); await expect(second).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Home'); await expect(first).toBeFocused(); await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab'); await expect(page.getByRole('region', { name: '원자료 선택 항목 상세' }).getByRole('link').first()).toBeFocused();
  const query = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  await page.getByLabel('원자료 검색').fill(query); await expect(page.getByLabel('원자료 검색')).toHaveValue(query);
  await expect(page.locator('.source-support-list>button')).toHaveCount(0); await expect(page.locator('.source-support-matrix img,.source-support-matrix script')).toHaveCount(0);
  await page.keyboard.press('Control+K'); await page.keyboard.press('Delete'); await page.keyboard.press('Space');
  await expect(page.locator('.canvas-topline strong')).toHaveText(before!);
  expect(await savedModel(page)).toEqual(beforeModel);
  await page.getByRole('button', { name: '지원·릴리스 닫기', exact: true }).focus(); await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '지원·릴리스', exact: true })).toBeFocused();
  expect(dialogs).toEqual([]); expect(errors).toEqual([]); expect(outsideRequests).toEqual([]);
});

test('M16 source filters and detailed support evidence remain readable in both themes at 320px and 200 percent text', async ({ page }, testInfo) => {
  test.setTimeout(60_000); await workspace(page);
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.app-shell').evaluate(shell => shell.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경`, exact: true }).click();
    const dialog = await matrix(page); await page.getByLabel('원자료 검색').fill('19-001'); await selectSource(page, '19-001');
    for (const [width, scale] of [[1440, 1], [1024, 1], [390, 1], [320, 2]]) {
      await page.setViewportSize({ width, height: 1200 }); await page.addStyleTag({ content: `html { font-size:${16 * scale}px !important; }` });
      await expect.poll(() => dialog.evaluate((node, width) => Math.abs(node.getBoundingClientRect().width - (width > 600 ? Math.min(1040, width - 32) : width - 16)) <= 2, width)).toBe(true);
      await expect.poll(() => page.evaluate(() => ({ document: document.documentElement.scrollWidth <= innerWidth + 1, controls: [...document.querySelectorAll('.source-support-matrix button,.source-support-matrix input,.source-support-matrix select')].filter(node => node.getBoundingClientRect().width > 1).every(node => { const bounds = node.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth + 1; }) }))).toEqual({ document: true, controls: true });
      await page.locator('#source-matrix-title').scrollIntoViewIfNeeded(); await dialog.screenshot({ path: testInfo.outputPath(`support-matrix-overview-${theme}-${width}-${scale}x.png`) });
      const detail = page.getByRole('region', { name: '원자료 선택 항목 상세' }); await detail.getByRole('heading', { name: '19-001 · C Caller', exact: true }).scrollIntoViewIfNeeded(); await expect(detail).toBeVisible();
      await dialog.screenshot({ path: testInfo.outputPath(`support-matrix-${theme}-${width}-${scale}x.png`) });
    }
    await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '지원·릴리스', exact: true })).toBeFocused();
  }
});
