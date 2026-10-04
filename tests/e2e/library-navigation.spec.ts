import { expect, test, type Locator, type Page } from '@playwright/test';
import { BLOCK_REGISTRY } from '../../packages/block-library/src';

const FREQUENT = ['source.constant', 'io.input', 'math.gain', 'math.sum', 'math.multiply', 'sink.display', 'sink.scope', 'continuous.integrator', 'discrete.unit-delay', 'route.switch'];
const PHOTO_BLOCKS = ['nonlinear.friction', 'nonlinear.dead-zone-dynamic', 'nonlinear.saturation-dynamic', 'nonlinear.wrap-to-zero', 'math.signed-sqrt'];
const library = (page: Page) => page.getByRole('complementary', { name: '블록 라이브러리', exact: true });
const section = (page: Page, key: string) => library(page).locator(`.library-category[data-library-category="${key}"]`);
const query = (page: Page) => page.getByLabel('한국어 또는 영어로 블록 검색', { exact: true });

async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  await expect(library(page).locator('.block-library-header .count-badge')).toHaveText(String(BLOCK_REGISTRY.length));
}
async function ids(items: Locator): Promise<string[]> {
  return items.evaluateAll(elements => elements.map(element => element.getAttribute('data-block-id')!));
}
async function expandAll(page: Page) {
  const toggles = library(page).locator('.library-category:not([data-library-category="frequent"]) .library-category-toggle');
  for (let index = 0; index < await toggles.count(); index++) {
    const toggle = toggles.nth(index);
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }
}
function searchIds(value: string) {
  const search = value.trim().toLocaleLowerCase();
  return BLOCK_REGISTRY.filter(block => `${block.label} ${block.englishName} ${block.description} ${block.id} ${block.aliases?.join(' ') ?? ''}`.toLocaleLowerCase().includes(search)).map(block => block.id).sort();
}
async function headerGeometry(page: Page) {
  return library(page).evaluate(panel => {
    const coordinates = (selector: string) => {
      const element = panel.querySelector(selector)!;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return { heading: coordinates('.panel-heading'), count: coordinates('.block-library-header .count-badge'), search: coordinates('.search-field') };
  });
}

test('Library initially opens only frequently used blocks and keyboard toggles preserve the current grouping', async ({ page }) => {
  await open(page);
  const frequent = section(page, 'frequent');
  const frequentToggle = frequent.locator('.library-category-toggle');
  await expect(frequentToggle).toHaveAttribute('aria-expanded', 'true');
  expect(await ids(library(page).locator('.library-item'))).toEqual(FREQUENT);
  const remaining = library(page).locator('.library-category:not([data-library-category="frequent"]) .library-category-toggle');
  for (let index = 0; index < await remaining.count(); index++) await expect(remaining.nth(index)).toHaveAttribute('aria-expanded', 'false');
  expect(await library(page).locator('.library-category').evaluateAll(elements => elements.map(element => element.getAttribute('data-library-category')).filter(key => key !== 'frequent').sort())).toEqual([...new Set(BLOCK_REGISTRY.map(block => block.category))].sort());

  const calculation = section(page, BLOCK_REGISTRY.find(block => block.id === 'math.gain')!.category);
  const toggle = calculation.locator('.library-category-toggle');
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const controlled = await toggle.getAttribute('aria-controls');
  expect(controlled).toBeTruthy(); await expect(page.locator(`[id="${controlled}"]`)).toBeVisible();
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`[id="${controlled}"]`)).toBeHidden();
  await expect(page.locator(`[id="${controlled}"] .library-item`)).toHaveCount(0);
  await toggle.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '블록 라이브러리 접기', exact: true }).click();
  await expect(library(page)).toHaveCount(0);
  await page.getByRole('button', { name: '블록 라이브러리 열기', exact: true }).click();
  await expect(section(page, BLOCK_REGISTRY.find(block => block.id === 'math.gain')!.category).locator('.library-category-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  expect(await ids(library(page).locator('.library-item'))).toEqual(FREQUENT);
});

test('Library searches open matching categories once and clearing restores the previous grouping without rendering input as HTML', async ({ page }) => {
  await open(page);
  const categoryName = BLOCK_REGISTRY.find(block => block.id === 'math.gain')!.category;
  await section(page, categoryName).locator('.library-category-toggle').click();
  await section(page, 'frequent').locator('.library-category-toggle').click();
  const previouslyOpen = await library(page).locator('.library-category-toggle[aria-expanded="true"]').evaluateAll(elements => elements.map(element => element.closest('.library-category')!.getAttribute('data-library-category')));
  await query(page).fill('더하기');
  await expect(library(page).locator('.library-item small')).toHaveText(['Sum', 'Bias']);
  await expect(section(page, 'frequent')).toHaveCount(0);
  expect((await ids(library(page).locator('.library-item'))).sort()).toEqual(searchIds('더하기'));
  await library(page).locator('.library-category-toggle').first().click();
  await expect(library(page).locator('.library-item')).toHaveCount(0);
  await query(page).fill('dynamic');
  expect((await ids(library(page).locator('.library-item'))).sort()).toEqual(searchIds('dynamic'));
  const matched = await library(page).locator('.library-category-toggle').count();
  for (let index = 0; index < matched; index++) await expect(library(page).locator('.library-category-toggle').nth(index)).toHaveAttribute('aria-expanded', 'true');
  await query(page).fill('');
  expect(await library(page).locator('.library-category-toggle[aria-expanded="true"]').evaluateAll(elements => elements.map(element => element.closest('.library-category')!.getAttribute('data-library-category')))).toEqual(previouslyOpen);
  await query(page).fill('<img src=x onerror="window.libraryInjected=true">');
  await expect(library(page).locator('.search-empty')).toBeVisible();
  await expect(library(page).locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'libraryInjected'))).toBeUndefined();
  await query(page).fill('x'.repeat(130));
  await expect(query(page)).toHaveValue('x'.repeat(100));
  await expect(query(page)).toHaveAttribute('maxlength', '100');
  await library(page).getByRole('button', { name: '전체 블록 보기', exact: true }).click();
  await expect(query(page)).toHaveValue('');
  expect(await library(page).locator('.library-category-toggle[aria-expanded="true"]').evaluateAll(elements => elements.map(element => element.closest('.library-category')!.getAttribute('data-library-category')))).toEqual(previouslyOpen);
});

test('Every registry block appears once in its category with a visible bounded symbol, including the five reported blank icons', async ({ page }) => {
  await open(page); await section(page, 'frequent').locator('.library-category-toggle').click(); await expandAll(page);
  const items = library(page).locator('.library-item');
  expect((await ids(items)).sort()).toEqual(BLOCK_REGISTRY.map(block => block.id).sort());
  await expect(items).toHaveCount(BLOCK_REGISTRY.length);
  for (const categoryName of new Set(BLOCK_REGISTRY.map(block => block.category))) {
    const expected = BLOCK_REGISTRY.filter(block => block.category === categoryName).length;
    await expect(section(page, categoryName).locator('.library-category-count')).toHaveText(String(expected));
    await expect(section(page, categoryName).locator('.library-item')).toHaveCount(expected);
  }
  const metrics = await items.evaluateAll(elements => elements.map(element => {
    const symbol = element.querySelector<HTMLElement>('.library-symbol')!;
    const range = document.createRange(); range.selectNodeContents(symbol);
    const text = range.getBoundingClientRect(), box = symbol.getBoundingClientRect(), style = getComputedStyle(symbol);
    return { id: element.getAttribute('data-block-id'), text: symbol.textContent?.trim(), glyphWidth: text.width, glyphHeight: text.height, width: box.width, height: box.height, overflow: text.left < box.left - 1 || text.right > box.right + 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1, display: style.display, visibility: style.visibility, opacity: style.opacity };
  }));
  expect(metrics.filter(metric => !metric.text || metric.glyphWidth < 1 || metric.glyphHeight < 1 || metric.width < 24 || metric.height < 24 || metric.overflow || metric.display === 'none' || metric.visibility === 'hidden' || metric.opacity === '0')).toEqual([]);
  for (const id of PHOTO_BLOCKS) {
    const metric = metrics.find(metric => metric.id === id);
    expect(metric, `Previously blank icon ${id}`).toBeDefined();
    expect(metric!.text!.length).toBeGreaterThan(0);
    expect(metric!.glyphWidth).toBeGreaterThan(1);
  }
  expect(PHOTO_BLOCKS.map(id => metrics.find(metric => metric.id === id)!.text)).toEqual(['μ', 'DZ↕', '↔↕', '→0', '±√']);
});

test('Library title, total count and search remain fixed when the category list reaches its end', async ({ page }) => {
  await open(page); await expandAll(page);
  const before = await headerGeometry(page);
  const panelScrollTop = await library(page).evaluate(element => element.scrollTop);
  const scrolling = library(page).locator('.library-list');
  await scrolling.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => scrolling.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  expect(await headerGeometry(page)).toEqual(before);
  expect(await library(page).evaluate(element => element.scrollTop)).toBe(panelScrollTop);
  await expect(library(page).getByRole('heading', { name: /블록 라이브러리/ })).toBeVisible();
  await expect(library(page).locator('.block-library-header .count-badge')).toBeVisible();
  await query(page).click(); await expect(query(page)).toBeFocused();
  expect(await headerGeometry(page)).toEqual(before);
});

test('Adding the reported friction block from the library and quick insert uses the same readable symbol', async ({ page }) => {
  await open(page);
  await query(page).fill('nonlinear.friction');
  const item = library(page).locator('.library-item[data-block-id="nonlinear.friction"]');
  const symbol = await item.locator('.library-symbol').innerText();
  expect(symbol.trim()).not.toBe('');
  await item.click(); await expect(page.locator('.block-node')).toHaveCount(4);
  await expect(page.locator('.selected-block-summary .large-block-symbol')).toHaveText(symbol);
  await page.getByRole('button', { name: '빠른 추가', exact: true }).click();
  await page.getByRole('combobox', { name: '빠른 추가 검색', exact: true }).fill('nonlinear.friction');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option').locator('.library-symbol')).toHaveText(symbol);
  await page.keyboard.press('Enter'); await expect(page.locator('.block-node')).toHaveCount(5);
  await expect(page.locator('.selected-block-summary .large-block-symbol')).toHaveText(symbol);
});

test('Library keeps readable controls and a fixed heading across narrow screens, themes and enlarged text', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await expandAll(page);
  for (const theme of ['dark', 'light'] as const) {
    if (await page.locator('.app-shell').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경` }).click();
    for (const condition of [{ width: 1440, enlarged: false }, { width: 1024, enlarged: false }, { width: 390, enlarged: false }, { width: 320, enlarged: false }, { width: 1440, enlarged: true }]) {
      await page.setViewportSize({ width: condition.width, height: 1000 });
      await page.evaluate(enlarged => { document.documentElement.style.fontSize = enlarged ? '200%' : ''; }, condition.enlarged);
      await library(page).locator('.block-library-header').scrollIntoViewIfNeeded();
      const scrolling = library(page).locator('.library-list');
      await scrolling.evaluate(element => { element.scrollTop = 0; });
      const before = await headerGeometry(page);
      const metrics = await library(page).evaluate(panel => {
        const rectangle = panel.getBoundingClientRect();
        const controls = [...panel.querySelectorAll<HTMLElement>('.block-library-header h2,.block-library-header input,.library-category-toggle,.library-copy strong,.library-copy small')].filter(element => element.getClientRects().length > 0);
        return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, panelWidth: rectangle.width, panelScrollWidth: panel.scrollWidth, left: rectangle.left, right: rectangle.right, smallestFont: Math.min(...controls.map(element => parseFloat(getComputedStyle(element).fontSize))), clippedControls: controls.filter(element => element.tagName !== 'INPUT' && element.scrollWidth > element.clientWidth + 2).map(element => element.textContent) };
      });
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelWidth + 2);
      expect(metrics.left).toBeGreaterThanOrEqual(-1); expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(metrics.smallestFont).toBeGreaterThanOrEqual(14); expect(metrics.clippedControls).toEqual([]);
      await scrolling.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect.poll(() => scrolling.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
      expect(await headerGeometry(page)).toEqual(before);
      await expect(query(page)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`library-navigation-${theme}-${condition.width}${condition.enlarged ? '-text200' : ''}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});
