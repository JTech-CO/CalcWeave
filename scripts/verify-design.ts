import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import config from '../playwright.config';
import { createExample } from '../apps/web/src/examples';
const m7 = process.argv.includes('--m7');
const m6 = m7 || process.argv.includes('--m6');
const m5 = m6 || process.argv.includes('--m5');
const m4 = m5 || process.argv.includes('--m4');
const screenshotPrefix = m7 ? 'm7-sane' : m6 ? 'm6-sane' : m5 ? 'm5-sane' : m4 ? 'm4-sane' : 'sane';

// Inspect the built local preview in a separate browser context, preserving the user's tab.
const browser = await chromium.launch(config.use?.launchOptions);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
const evidence: Record<string, unknown>[] = [];
await mkdir('docs/evidence', { recursive: true });

function luminance(hex: string) {
  const raw = hex.replace('#', '');
  const expanded = raw.length === 3 ? raw.split('').map(char => char + char).join('') : raw;
  const rgb = [0, 2, 4].map(offset => parseInt(expanded.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function inspect(name: string, expectedOrientation: 'side' | 'stack') {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell')!;
    const style = getComputedStyle(shell);
    const fonts: Record<string, number> = {};
    for (const selector of ['.app-shell', '.button', '.run-button', '.library-copy strong', '.library-copy small', '.field-label', '.field input', '.field textarea', '.signal-metadata', '.signal-result td', '.quick-search input', '.workspace-dialog h2', '.result-status', '.block-name', '.block-value', '.plot-y-labels', '.plot-x-labels', '.solver-settings input', '.solver-settings select', '.solver-statistics dt', '.solver-statistics dd', '.solver-events summary', '.statusbar']) {
      const element = document.querySelector(selector);
      if (element) fonts[selector] = parseFloat(getComputedStyle(element).fontSize);
    }
    const bounds = Object.fromEntries(['.app-header', '.toolbar', '.workspace', '.canvas-column', '.workbench-layout', '.canvas-area', '.results-panel', '.library-panel', '.inspector-panel'].flatMap(selector => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return [[selector, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth }]];
    }));
    const canvasRect = document.querySelector('.canvas-area')!.getBoundingClientRect();
    const resultsRect = document.querySelector('.results-panel')!.getBoundingClientRect();
    const workbenchRect = document.querySelector('.workbench-layout')!.getBoundingClientRect();
    const orientation = canvasRect.right <= resultsRect.left + 2 ? 'side'
      : canvasRect.bottom <= resultsRect.top + 2 ? 'stack' : 'overlap';
    const panelsContained = [canvasRect, resultsRect].every(rect => rect.left >= workbenchRect.left - 2
      && rect.right <= workbenchRect.right + 2 && rect.top >= workbenchRect.top - 2 && rect.bottom <= workbenchRect.bottom + 2);
    const panelsAligned = orientation === 'side'
      ? Math.abs(canvasRect.top - resultsRect.top) <= 2 && Math.abs(canvasRect.height - resultsRect.height) <= 2
      : Math.abs(canvasRect.left - resultsRect.left) <= 2 && Math.abs(canvasRect.width - resultsRect.width) <= 2;
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    const transform = viewport ? new DOMMatrix(getComputedStyle(viewport).transform).a : 1;
    const block = document.querySelector<HTMLElement>('.block-node');
    const blockContentOverflows = [...document.querySelectorAll<HTMLElement>('.block-name, .block-value')]
      .filter(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map(element => element.textContent);
    return {
      theme: shell.classList.contains('dark') ? 'dark' : 'light',
      viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
      tokens: Object.fromEntries(['canvas', 'surface', 'text', 'muted', 'accent', 'strong-line'].map(name => [name, style.getPropertyValue(`--${name}`).trim()])),
      fonts, bounds, workbench: { orientation, panelsContained, panelsAligned, canvasWidth: canvasRect.width, resultsWidth: resultsRect.width }, blockContentOverflows, graphZoom: transform,
      effectiveBlockNamePx: (fonts['.block-name'] ?? 0) * transform,
      blockStripe: block ? getComputedStyle(block, '::before').content : null,
    };
  });
  const contrastRatios = Object.fromEntries(['text', 'muted', 'accent'].map(role =>
    [role, Math.min(contrast(metrics.tokens[role], metrics.tokens.surface), contrast(metrics.tokens[role], metrics.tokens.canvas))]));
  evidence.push({ name, ...metrics, expectedOrientation, contrastRatios });
  await page.screenshot({ path: `docs/evidence/${screenshotPrefix}-${name}.png`, fullPage: true });
  if (metrics.documentWidth > metrics.viewportWidth + 1) throw new Error(`${name}: page-wide horizontal overflow`);
  if (metrics.workbench.orientation !== expectedOrientation) throw new Error(`${name}: expected ${expectedOrientation} workbench, received ${metrics.workbench.orientation}`);
  if (!metrics.workbench.panelsContained || !metrics.workbench.panelsAligned) throw new Error(`${name}: canvas and results are misaligned or exceed their workbench`);
  if (expectedOrientation === 'side' && (metrics.workbench.canvasWidth < 300 || metrics.workbench.resultsWidth < 280)) throw new Error(`${name}: side panels are too narrow to read`);
  for (const [selector, size] of Object.entries(metrics.fonts)) {
    if (selector === '.statusbar') continue; // Secondary process metadata is allowed at 12px.
    if (size < 14) throw new Error(`${name}: unreadable ${selector} at ${size}px`);
  }
  if (metrics.blockStripe !== 'none' && metrics.blockStripe !== 'normal') throw new Error(`${name}: block marking stripe remains`);
  if (metrics.effectiveBlockNamePx < 15.9) throw new Error(`${name}: block name shrunk below 16px at automatic fit`);
  if (metrics.blockContentOverflows.length) throw new Error(`${name}: clipped block text ${metrics.blockContentOverflows.join(', ')}`);
  for (const [role, ratio] of Object.entries(contrastRatios)) {
    if (ratio < 4.5) throw new Error(`${name}: ${role} text contrast ${ratio} is below 4.5:1`);
  }
}

async function inspectTools(name: string) {
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.workspace-tools')!;
    const fonts = Object.fromEntries(['.workspace-tabs button', '.tool-page-heading h2', '.tool-page-heading p', '.tool-section h3', '.tool-table td', '.workspace-tools .button', '.workspace-tools .field input', '.workspace-tools .field select', '.workspace-tools .field textarea', '.dashboard-card h3', '.dashboard-card .field-help', '.hash-details dd', '.comparison-value', '.history-card p'].flatMap(selector => {
      const item = document.querySelector<HTMLElement>(selector);
      return item && item.getBoundingClientRect().width > 0 ? [[selector, parseFloat(getComputedStyle(item).fontSize)]] : [];
    }));
    const rect = panel.getBoundingClientRect();
    const clipped = [...panel.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter(item => !item.closest('.visually-hidden') && item.getBoundingClientRect().width > 0 && item.scrollWidth > item.clientWidth + 3 && item.tagName !== 'TEXTAREA').map(item => item.getAttribute('aria-label') ?? item.textContent);
    return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, fonts, bounds: { left: rect.left, right: rect.right, width: rect.width }, clipped, bodyFont: parseFloat(getComputedStyle(panel).fontSize) };
  });
  evidence.push({ name, ...metrics }); await page.screenshot({ path: `docs/evidence/${screenshotPrefix}-${name}.png`, fullPage: true });
  if (metrics.documentWidth > metrics.viewportWidth + 1 || metrics.bounds.left < -1 || metrics.bounds.right > metrics.viewportWidth + 1) throw new Error(`${name}: page-wide horizontal overflow`);
  if (metrics.bodyFont < 16) throw new Error(`${name}: body typography below 16px`);
  for (const [selector, size] of Object.entries(metrics.fonts)) if (size < 14) throw new Error(`${name}: unreadable ${selector} at ${size}px`);
  if (metrics.clipped.length) throw new Error(`${name}: clipped controls ${metrics.clipped.join(', ')}`);
}

async function inspectDialog(name: string) {
  const metrics = await page.getByRole('dialog').evaluate(dialog => {
    const rect = dialog.getBoundingClientRect();
    const fonts = [...dialog.querySelectorAll<HTMLElement>('h2,h3,h4,p,dt,dd,a,label,button,input,select,summary')].filter(element => element.getClientRects().length > 0 && !element.closest('.visually-hidden')).map(element => ({ tag: element.tagName, size: parseFloat(getComputedStyle(element).fontSize) }));
    const clipped = [...dialog.querySelectorAll<HTMLElement>('button')].filter(element => element.getClientRects().length > 0 && element.scrollWidth > element.clientWidth + 3).map(element => element.textContent);
    return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, dialogWidth: dialog.clientWidth, dialogScrollWidth: dialog.scrollWidth, bounds: { left: rect.left, right: rect.right }, fonts, clipped, modal: dialog.getAttribute('aria-modal'), isolated: document.querySelector<HTMLElement>('.app-header')?.inert ?? false };
  });
  evidence.push({ name, ...metrics }); await page.screenshot({ path: `docs/evidence/${screenshotPrefix}-${name}.png`, fullPage: true });
  if (metrics.documentWidth > metrics.viewportWidth + 1 || metrics.bounds.left < -1 || metrics.bounds.right > metrics.viewportWidth + 1 || metrics.dialogScrollWidth > metrics.dialogWidth + 2) throw new Error(`${name}: dialog horizontal overflow`);
  if (metrics.fonts.some(font => font.size < 14) || metrics.clipped.length) throw new Error(`${name}: unreadable dialog text or clipped controls`);
  if (metrics.modal !== 'true' || !metrics.isolated) throw new Error(`${name}: modal background is not isolated`);
}

try {
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('.save-indicator').filter({ hasText: '브라우저에 저장됨' }).waitFor();
  await page.getByRole('button', { name: '계산하기' }).click();
  await page.locator('.output-card strong').filter({ hasText: '6' }).waitFor();
  await inspect('dark-editor', 'side');
  const session = await context.newCDPSession(page);
  await session.send('DOM.enable'); await session.send('CSS.enable');
  const domDocument = await session.send('DOM.getDocument');
  const korean = await session.send('DOM.querySelector', { nodeId: domDocument.root.nodeId, selector: '.panel-heading h2' });
  const platformFonts = await session.send('CSS.getPlatformFontsForNode', { nodeId: korean.nodeId });
  evidence.push({ name: 'actual-korean-font', fonts: platformFonts.fonts });
  await page.getByRole('button', { name: '라이트 테마로 변경' }).click();
  await inspect('light-editor', 'side');
  await page.getByRole('button', { name: '다크 테마로 변경' }).click();
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: /시간에 따른 감쇠/ }).click();
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await page.locator('.plot-frame').waitFor();
  await inspect('continuous-result', 'side');
  for (const [name, width, height, orientation] of [['wide-editor', 1920, 1080, 'side'], ['tablet-editor', 1024, 900, 'side'], ['horizontal-tablet-editor', 900, 900, 'side'], ['mobile-editor', 390, 844, 'stack'], ['narrow-editor', 320, 800, 'stack'], ['zoom-equivalent', 720, 450, 'stack']] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: '도식 맞추기' }).click();
    await inspect(name, orientation);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('text-200-percent', 'stack');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: /벡터와 2D 배열/ }).click();
  await page.getByRole('button', { name: '계산하기' }).click();
  await page.locator('.signal-result').waitFor();
  await page.locator('.react-flow__node[data-id="vector"]').click();
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m1-vector-result', 'side');
  await page.getByRole('button', { name: /빠른 추가/ }).click();
  await page.getByRole('combobox', { name: '빠른 추가 검색' }).fill('trigonometric');
  await inspect('m1-quick-insert', 'side');
  await page.getByRole('option', { name: /Trigonometric/ }).click();
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m1-long-block-name', 'side');
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: /FIR impulse 응답/ }).click();
  await page.getByRole('button', { name: /시뮬레이션 실행/ }).click();
  await page.locator('.result-status.current').waitFor();
  await page.locator('.react-flow__node[data-id="filter"]').click();
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m2-fir-result', 'side');
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: /1·2·5배 샘플시간/ }).click();
  await page.getByRole('button', { name: /시뮬레이션 실행/ }).click();
  await page.locator('.result-status.current').waitFor();
  await page.locator('.react-flow__node[data-id="rate-two"]').click();
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m2-multirate-result', 'side');
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: /RK45 감쇠와 오차 제어/ }).click();
  await page.getByRole('button', { name: /시뮬레이션 실행/ }).click();
  await page.locator('.result-status.current').waitFor();
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m3-rk45-result', 'side');
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: /교차 reset과 같은 이산 tick/ }).click();
  await page.getByRole('button', { name: /시뮬레이션 실행/ }).click();
  await page.locator('.result-status.current').waitFor();
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m3-crossing-reset', 'side');
  await page.getByRole('button', { name: '예제로 시작' }).click();
  await page.locator('.examples-menu').getByRole('button', { name: /2차 적분의 진동/ }).click();
  await page.getByRole('button', { name: /시뮬레이션 실행/ }).click();
  await page.locator('.result-status.current').waitFor();
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m3-oscillator-long-name', 'side');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '도식 맞추기' }).click();
  await inspect('m3-mobile-settings', 'stack');
  if (m4) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm4-preview.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createExample('data-playback'))) });
    await page.getByRole('button', { name: '시뮬레이션 실행' }).click(); await page.locator('.result-status.current').waitFor();
    for (const theme of ['dark', 'light'] as const) {
      if (await page.locator('.app-shell').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경` }).click();
      for (const width of [1440, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [tab, label] of [['data', '데이터'], ['experiments', '실험'], ['dashboard', '대시보드'], ['notes', '노트']] as const) {
          await page.getByRole('tab', { name: label, exact: true }).click(); await inspectTools(`${theme}-${width}-${tab}`);
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('tab', { name: '도식', exact: true }).click();
    await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'hierarchy.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createExample('hierarchy-edit'))) });
    const instance = createExample('hierarchy-edit').nodes.find(node => node.blockType === 'hierarchy.subsystem')!;
    await page.locator(`.react-flow__node[data-id="${instance.id}"]`).waitFor();
    await page.getByRole('button', { name: '도식 맞추기' }).click();
    await page.locator(`.react-flow__node[data-id="${instance.id}"]`).dblclick(); await page.getByRole('navigation', { name: '도식 경로' }).getByRole('button', { name: '배율 모듈' }).waitFor();
    for (const theme of ['dark', 'light'] as const) {
      if (await page.locator('.app-shell').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경` }).click();
      for (const width of [1440, 1024, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); await page.getByRole('button', { name: '도식 맞추기' }).click(); await inspect(`${theme}-${width}-hierarchy`, width < 900 ? 'stack' : 'side'); }
    }
  }
  if (m5) {
    await page.getByRole('tab', { name: '도식', exact: true }).click();
    for (const [exampleId, inspectedNode, inspectedOutput] of [['matrix-solve-lu', 'lu', '행 순서 P'], ['lookup-2d-nonuniform', 'table', '보간 결과'], ['quantizer-rounding-overflow', 'saturate', 'Saturate stored']] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const model = createExample(exampleId);
      await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: `${exampleId}.cw.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
      await page.getByRole('button', { name: '계산하기' }).click(); await page.locator('.result-status.current').waitFor();
      await page.locator('.model-node-list').getByRole('button', { name: model.nodes.find(node => node.id === inspectedNode)!.label, exact: true }).click();
      await page.locator('.output-card').filter({ hasText: inspectedOutput }).click();
      for (const theme of ['dark', 'light'] as const) {
        if (await page.locator('.app-shell').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경` }).click();
        for (const width of [1440, 1024, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 }); await page.getByRole('button', { name: '도식 맞추기' }).click();
          if (exampleId === 'lookup-2d-nonuniform') {
            const table = page.locator('.result-table');
            if (await table.getAttribute('open') === null) await table.locator('summary').click();
            await table.scrollIntoViewIfNeeded();
          } else await page.locator('.signal-result').scrollIntoViewIfNeeded();
          await inspect(`${theme}-${width}-${exampleId}`, width < 900 ? 'stack' : 'side');
        }
      }
    }
  }
  if (m6) {
    for (const theme of ['dark', 'light'] as const) {
      if (await page.locator('.app-shell').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경` }).click();
      for (const width of [1440, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByRole('button', { name: '지원·릴리스', exact: true }).click();
        for (const [label, suffix] of [['지원 블록', 'catalog'], ['사용 방법', 'keyboard'], ['범위와 상한', 'limits'], ['정책·로컬 저장', 'policy']] as const) { await page.getByRole('button', { name: label, exact: true }).click(); await inspectDialog(`${theme}-${width}-support-${suffix}`); }
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '로컬 데이터 관리', exact: true }).click();
        for (const [label, suffix] of [['백업·복구', 'backup'], ['저장 상태', 'storage'], ['로컬 진단', 'diagnostics'], ['데이터 삭제', 'reset']] as const) { await page.getByRole('button', { name: label, exact: true }).click(); if (suffix === 'reset') await page.getByRole('button', { name: '로컬 데이터 삭제 확인', exact: true }).click(); await inspectDialog(`${theme}-${width}-management-${suffix}`); }
        await page.keyboard.press('Escape');
      }
    }
  }
  if (m7) {
    const model = createExample('first-calculation');
    await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm7-editor.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
    for (const theme of ['dark', 'light'] as const) {
      if (await page.locator('.app-shell').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: `${theme === 'dark' ? '다크' : '라이트'} 테마로 변경` }).click();
      for (const width of [1440, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click();
        for (const target of ['typescript', 'python']) { await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption(target); await page.getByRole('button', { name: target === 'python' ? 'Python 코드 다운로드' : 'TypeScript 코드 다운로드', exact: true }).waitFor(); await inspectDialog(`${theme}-${width}-code-${target}`); }
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '모델 패키지 공유', exact: true }).click();
        await page.getByRole('button', { name: '서명된 패키지 생성', exact: true }).click();
        await page.getByTestId('created-package-fingerprint').waitFor();
        await inspectDialog(`${theme}-${width}-package-export`);
        const packageDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '공유 패키지 다운로드', exact: true }).click();
        const packageBytes = await readFile((await (await packageDownload).path())!);
        await page.getByRole('button', { name: '공유 파일 확인', exact: true }).click();
        await page.getByLabel('공유 모델 패키지 파일 선택').setInputFiles({ name: 'm7-preview.cwpackage.json', mimeType: 'application/json', buffer: packageBytes });
        await page.getByTestId('inspected-package-fingerprint').waitFor();
        await inspectDialog(`${theme}-${width}-package-import`);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '가져오기 보고서', exact: true }).click();
        await inspectDialog(`${theme}-${width}-import-report`);
        await page.keyboard.press('Escape');
      }
    }
  }
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  const report = { generatedAt: new Date().toISOString(), browser: browser.version(),
    scope: 'SANE typography, compact blocks, neutral themes, local overflow, actual Korean font and measured canvas/results placement. Desktop 1440/1920 and horizontal tablet 1024/900 require full-height side panels; 390/320 and the 720x450 browser-zoom-equivalent viewport require stacking. Root 200% tests text enlargement separately with stacked panels. M1 measures typed arrays and Quick Insert; M2 FIR/multirate; M3 RK45 settings/statistics, crossing/reset events, long oscillator names and mobile solver settings.' + (m4 ? ' M4 adds dark/light data, experiments, dashboard, notes and hierarchy at 1440/1024/390/320.' : '') + (m5 ? ' M5 adds pivot LU matrix tables and multi-output ports, nonuniform 2D table axis editors, and quantizer rounding/overflow controls with exact stored result tables, in both themes at 1440/1024/390/320.' : ''),
    pageErrors, observations: evidence };
  if (m6) report.scope += ' M6 adds release metadata, keyboard guidance, local policy links, backup/restore, damaged slot recovery, sanitized diagnostics and two-step local reset dialogs in both themes at 1440/1024/390/320, with native modal semantics and isolated backgrounds.';
  if (m7) report.scope += ' M7 adds TypeScript/Python target validation, ephemeral signed model package creation, independently trusted fingerprint import, and native import reports in both themes at 1440/1024/390/320.';
  await writeFile(`docs/evidence/${m7 ? 'm7-design-verification' : m6 ? 'm6-design-verification' : m5 ? 'm5-design-verification' : m4 ? 'm4-design-verification' : 'sane-design-verification'}.json`, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally { await context.close(); await browser.close(); }
