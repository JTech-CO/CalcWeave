import { expect, test, type Page } from '@playwright/test';
import { BLOCK_REGISTRY } from '../../packages/block-library/src';
import { getReleaseCatalog } from '../../packages/release/src';
import { expandHelpDetail, helpDialog, helpTrigger, openAppInfo, openBlockHelp, openCompatibilityReference, openHelp } from './help-tools';

const PAGES = ['사용 안내', '블록 찾기', '파일·코드', '앱 정보'] as const;
async function workspace(page: Page) {
  await page.goto('./');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
}
async function stored(page: Page, key: string): Promise<unknown> {
  return page.evaluate(key => new Promise((resolve, reject) => {
    const request = indexedDB.open('calcweave-m0', 1);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('models', 'readonly'), reading = transaction.objectStore('models').get(key);
      reading.onsuccess = () => resolve(reading.result);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => reject(new Error('Isolated workspace read failed'));
    };
    request.onerror = () => reject(new Error('Isolated workspace unavailable'));
  }), key);
}

test('Product help starts with everyday use and keeps implementation evidence out of the first screen', async ({ page }) => {
  await workspace(page); const dialog = await openHelp(page);
  await expect(dialog.locator('.dialog-navigation > button')).toHaveText([...PAGES]);
  await expect(dialog.getByRole('button', { name: '사용 안내', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toContainText('설치 없이 웹 브라우저');
  const visible = await dialog.innerText();
  for (const technical of ['SHA-256', 'maxNodes', '0.17.0-m16', 'R2024b', '원자료 대응표', 'fixture', 'inventory']) expect(visible).not.toContain(technical);
  await expect(dialog.locator('.source-support-matrix,.adapter-catalog,.source-support-boundary')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Simulink 참고 자료 비교', exact: true })).toBeHidden();
  await expect(dialog.getByRole('button', { name: '확장 기능 상세', exact: true })).toBeHidden();
});

test('Product block help searches the real registry by name and parameters and preserves mode filtering', async ({ page }) => {
  await workspace(page); const dialog = await openBlockHelp(page), search = dialog.getByLabel('지원 블록 검색');
  await expect(dialog.locator('.support-block-list > button')).toHaveCount(BLOCK_REGISTRY.length);
  await search.fill('wordLength');
  await expect(dialog.locator('.support-block-list > button')).toHaveCount(BLOCK_REGISTRY.filter(block => Object.hasOwn(block.parameters, 'wordLength')).length);
  await search.fill('Gain');
  await expect(dialog.locator('.support-block-list > button').filter({ hasText: 'Gain' }).first()).toBeVisible();
  await search.fill(''); await dialog.getByLabel('지원 실행 방식').selectOption('continuous');
  await expect(dialog.locator('.support-block-list > button')).toHaveCount(BLOCK_REGISTRY.filter(block => block.supportedModes.includes('continuous')).length);
  await search.fill('<img src=x onerror=alert(1)>');
  await expect(dialog.locator('.support-block-list > button')).toHaveCount(0);
  await expect(dialog.locator('.support-block-list img,.support-block-list script')).toHaveCount(0);
});

test('Compatibility references stay optional and retain the complete source report behind app information', async ({ page }) => {
  await workspace(page); let dialog = await openAppInfo(page);
  await expect(dialog.getByRole('button', { name: 'Simulink 참고 자료 비교', exact: true })).toBeHidden();
  await expect(dialog.getByRole('button', { name: '확장 기능 상세', exact: true })).toBeHidden();
  await expect(dialog.getByRole('button', { name: '백업·복구 열기', exact: true })).toBeVisible();
  await expect(dialog).toContainText(getReleaseCatalog().version);
  await expect(dialog).toContainText('독립적인 웹 계산 도구'); await expect(dialog).toContainText('MATLAB 설치가 필요하지 않습니다');
  await page.keyboard.press('Escape');
  dialog = await openCompatibilityReference(page, 'matrix');
  await expect(dialog.locator('.source-support-list > button')).toHaveCount(385);
  await expect(dialog.locator('.source-support-summary')).toContainText('등록 계산 블록 337개');
  await expect(dialog).toContainText('전체 동등 승인 0행');
  await dialog.getByRole('button', { name: '앱 정보로 돌아가기', exact: true }).click();
  await expect(dialog.locator('[data-help-about]')).toBeFocused();
  await expect(dialog.locator('.source-support-matrix')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '앱 정보', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); await expect(helpTrigger(page)).toBeFocused();
});

test('Product help traps focus and prevents editing or simulation shortcuts from changing the canvas', async ({ page }) => {
  await workspace(page);
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('.canvas-area > .react-flow')?.getBoundingClientRect(), nodes = [...document.querySelectorAll('.react-flow__node')];
    return !!canvas && nodes.length > 0 && nodes.every(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1; });
  })).toBe(true);
  const before = await stored(page, 'current'), history = await stored(page, 'run-history-v1');
  const transform = await page.locator('.react-flow__viewport').getAttribute('style');
  const trigger = helpTrigger(page); await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = helpDialog(page); await expect(dialog.locator('[data-help-start]')).toBeFocused();
  await expect(page.locator('.app-header')).toHaveAttribute('aria-hidden', 'true');
  await dialog.getByRole('button', { name: '도움말 닫기', exact: true }).focus();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeFocused();
  await dialog.focus();
  for (const key of ['Control+K', 'Control+A', 'Delete', 'Space', 'Control+Enter', 'Control+D']) await page.keyboard.press(key);
  await expect(page.locator('[aria-label="빠른 추가 검색"]')).toHaveCount(0);
  expect(await stored(page, 'current')).toEqual(before); expect(await stored(page, 'run-history-v1')).toEqual(history);
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', transform!);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await expect(page.locator('.app-header')).not.toHaveAttribute('aria-hidden', 'true');
});

test('All product help pages stay readable in both themes from desktop to 320px with 200 percent text', async ({ page }, testInfo) => {
  test.setTimeout(90_000); await workspace(page);
  for (const theme of ['dark', 'light'] as const) {
    if (await page.locator('.app-shell').evaluate(shell => shell.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경`, exact: true }).click();
    const dialog = await openHelp(page);
    for (const [width, scale] of [[1440, 1], [390, 1], [320, 2]]) {
      await page.setViewportSize({ width, height: 1200 });
      await page.addStyleTag({ content: `html { font-size:${16 * scale}px !important; }` });
      for (const name of PAGES) {
        await dialog.locator('.dialog-navigation').getByRole('button', { name, exact: true }).click();
        await expect.poll(() => dialog.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          return {
            document: document.documentElement.scrollWidth <= innerWidth + 1,
            dialog: bounds.left >= 0 && bounds.right <= innerWidth + 1,
            controls: [...node.querySelectorAll('button,input,select,a,summary')].filter(item => item.getBoundingClientRect().width > 0).every(item => {
              const rect = item.getBoundingClientRect();
              return rect.left >= bounds.left && rect.right <= bounds.right + 1 && parseFloat(getComputedStyle(item).fontSize) >= 13.5;
            }),
          };
        })).toEqual({ document: true, dialog: true, controls: true });
        await dialog.screenshot({ path: testInfo.outputPath(`help-${theme}-${width}-${scale}x-${PAGES.indexOf(name)}.png`) });
      }
      if (width === 320 && scale === 2) {
        await expandHelpDetail(page, '계산·데이터 세부 범위');
        expect(await dialog.evaluate(node => { node.scrollTop = 120; return node.scrollTop; })).toBeGreaterThan(0);
        // Locator.click would scroll the navigation into view first and hide the regression.
        await dialog.locator('.dialog-navigation').getByRole('button', { name: '파일·코드', exact: true }).dispatchEvent('click');
        await expect.poll(() => dialog.evaluate(node => node.scrollTop)).toBe(0);
        await expect.poll(() => dialog.locator('#help-files-title').evaluate(title => {
          const bounds = title.getBoundingClientRect(), modal = title.closest('dialog')!.getBoundingClientRect();
          return bounds.top >= modal.top && bounds.bottom <= modal.bottom && bounds.left >= modal.left && bounds.right <= modal.right;
        })).toBe(true);
        await dialog.screenshot({ path: testInfo.outputPath(`help-${theme}-320-2x-file-tab-scroll-reset.png`) });
      }
    }
    await page.keyboard.press('Escape'); await expect(helpTrigger(page)).toBeFocused();
  }
});
