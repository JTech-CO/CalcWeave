import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createExample } from '../../apps/web/src/examples';
import type { CalcModel } from '../../packages/model/src';

const panel = (page: Page) => page.getByTestId('equation-learning-panel');
async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('.research-badge')).toContainText('0.18.0');
  await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  await page.getByRole('button', { name: '수식·학습', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: '도식을 수식으로 읽기' })).toBeVisible();
}
async function importModel(page: Page, model: CalcModel) {
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm17.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.getByLabel('모델 이름', { exact: true })).toHaveValue(model.name);
  await page.getByRole('button', { name: '수식·학습', exact: true }).click();
}
async function lesson(page: Page, title: string) {
  await panel(page).getByRole('button', { name: new RegExp(`^${title}`) }).click();
  return panel(page).getByRole('region', { name: `${title} 학습`, exact: true });
}

test('A formula term selects its actual block and editing updates the mathematical relation', async ({ page }) => {
  await open(page);
  const gain = panel(page).getByTestId('equation-local-gain');
  await expect(gain.locator('.equation-formula')).toHaveText('y2 = 3 × y1');
  await gain.locator('button').filter({ hasText: /^3$/ }).click();
  await expect(page.locator('.react-flow__node[data-id="gain"]')).toHaveClass(/selected/);
  const field = page.getByLabel('배율', { exact: true });
  await expect(field).toHaveValue('3');
  await field.fill('-4'); await field.press('Enter');
  await expect(gain.locator('.equation-formula')).toHaveText('y2 = (-4) × y1');
  await expect(panel(page).getByTestId('equation-summary-result').locator('.equation-formula')).toHaveText('y3 = (-4) × 2');
  await panel(page).locator('.equation-variable-legend summary').click();
  await expect(panel(page).locator('.equation-variable-legend')).toContainText('배율');
});

for (const [title, expected] of [
  ['배율과 곱셈', '6'],
  ['이전 값과 반복 계산', '1.9'],
  ['변화율과 연속 감쇠', '0.006737947'],
] as const) {
  test(`${title} guided activity compares a real Worker run with independent mathematical values`, async ({ page }) => {
    await open(page);
    const activity = await lesson(page, title);
    await activity.getByLabel('학습 예상', { exact: true }).fill('예상한 변화 방향');
    await expect(activity.locator('.equation-assessment')).not.toHaveClass(/is-verified/);
    await activity.getByRole('button', { name: '현재 도식 실행', exact: true }).click();
    await expect(activity.locator('.equation-assessment')).toHaveClass(/is-verified/);
    await expect(page.getByRole('button', { name: '수식·학습', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(activity.getByRole('table', { name: '학습 예상값 비교' })).toContainText(expected);
    await activity.getByRole('button', { name: '배율 설정', exact: true }).click();
    await expect(page.getByLabel('배율', { exact: true })).toBeVisible();
    if (title !== '배율과 곱셈') {
      await activity.getByRole('button', { name: '초기값 설정', exact: true }).click();
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    }
    await activity.getByLabel('학습 관찰 설명', { exact: true }).fill('관찰한 값과 수식의 관계');
  });
}

test('Learning retains the prediction through edits, rejects stale/invalid results, and leaves inputs as text', async ({ page }) => {
  await open(page);
  const activity = await lesson(page, '배율과 곱셈');
  const prediction = '<img src=x onerror="alert(1)"> 결과 예상';
  await activity.getByLabel('학습 예상', { exact: true }).fill(prediction);
  await activity.getByRole('button', { name: '현재 도식 실행', exact: true }).click();
  await expect(activity.locator('.equation-assessment')).toHaveClass(/is-verified/);
  await activity.getByRole('button', { name: '배율 설정', exact: true }).click();
  const field = page.getByLabel('배율', { exact: true });
  await field.fill('4'); await field.press('Enter');
  await expect(activity.getByLabel('학습 예상', { exact: true })).toHaveValue(prediction);
  await expect(activity.locator('.equation-assessment')).not.toHaveClass(/is-verified/);
  await expect(activity.locator('.equation-assessment')).toContainText('다시 실행');
  await activity.getByRole('button', { name: '현재 도식 실행', exact: true }).click();
  await expect(activity.locator('.equation-assessment')).toHaveClass(/is-verified/);
  await expect(activity.getByRole('table', { name: '학습 예상값 비교' })).toContainText('8');
  await activity.getByLabel('학습 관찰 설명', { exact: true }).fill('배율 4와 입력 2의 곱은 8입니다.');
  await page.getByRole('button', { name: '계산 결과', exact: true }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('.output-card strong')).toHaveText('8');
  await page.getByRole('button', { name: '수식·학습', exact: true }).click();
  await expect(activity.getByLabel('학습 예상', { exact: true })).toHaveValue(prediction);
  await expect(activity.getByLabel('학습 관찰 설명', { exact: true })).toHaveValue('배율 4와 입력 2의 곱은 8입니다.');
  await field.fill('invalid');
  await expect(activity.getByRole('button', { name: '현재 도식 실행', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('region', { name: '현재 도식의 수식', exact: true })).toContainText('입력값 수정 중');
  await expect(panel(page).locator('.equation-rows')).toHaveCount(0);
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(panel(page).locator('img,script')).toHaveCount(0);
  await field.fill('5'); await field.press('Enter');
  await expect(panel(page).getByTestId('equation-local-gain')).toContainText('5');
  await activity.getByRole('button', { name: '학습 닫기', exact: true }).click();
  await expect(panel(page).getByRole('region', { name: '수식 학습 예제', exact: true })).toBeVisible();
  const reopened = await lesson(page, '배율과 곱셈');
  await expect(reopened.getByLabel('학습 예상', { exact: true })).toHaveValue('');
  await expect(reopened.getByLabel('학습 관찰 설명', { exact: true })).toHaveValue('');
});

test('Unsupported arrays and disconnected inputs get explanations without fabricated scalar math', async ({ page }) => {
  await open(page);
  const model = createExample('first-calculation');
  model.name = '벡터 수식 경계'; model.nodes.find(node => node.id === 'value')!.parameters.value = [2, 3];
  await importModel(page, model);
  await expect(panel(page).getByRole('list', { name: '수식 표시 안내' })).toContainText('스칼라');
  await expect(panel(page).locator('.equation-formula')).toHaveCount(0);
  model.name = '연결 확인'; model.nodes.find(node => node.id === 'value')!.parameters.value = 2;
  model.edges = model.edges.filter(edge => edge.target.nodeId !== 'gain');
  await importModel(page, model);
  await expect(panel(page)).toContainText('도식의 연결과 설정을 확인하면');
  await expect(panel(page).locator('.equation-formula')).toHaveCount(0);
});

test('The formula pane scrolls inside the workbench and supports keyboard, light theme and enlarged text', async ({ page }) => {
  await open(page);
  const activity = await lesson(page, '변화율과 연속 감쇠');
  await activity.getByRole('button', { name: '현재 도식 실행', exact: true }).click();
  await expect(activity.locator('.equation-assessment')).toHaveClass(/is-verified/);
  await activity.getByRole('button', { name: '학습 닫기', exact: true }).click();
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.getByRole('button', { name: '도식 맞추기', exact: true }).click();
  const bounds = await panel(page).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { bottom: rect.bottom, height: rect.height, scrollHeight: element.scrollHeight, overflow: getComputedStyle(element).overflowY, windowHeight: innerHeight };
  });
  expect(bounds.overflow).toBe('auto'); expect(bounds.bottom).toBeLessThanOrEqual(bounds.windowHeight);
  expect(bounds.scrollHeight).toBeGreaterThan(bounds.height);
  const term = panel(page).getByTestId('equation-local-gain').locator('button').filter({ hasText: /^\(-1\)$/ });
  await term.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('배율', { exact: true })).toHaveValue('-1');
  await mkdir('.test-generated/m17-ui', { recursive: true });
  await page.screenshot({ path: '.test-generated/m17-ui/equations-dark.png' });
  await page.getByRole('button', { name: '라이트 테마로 변경', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/light/);
  await page.screenshot({ path: '.test-generated/m17-ui/equations-light.png' });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  await expect(panel(page).getByRole('region', { name: '수식 학습 예제', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.test-generated/m17-ui/equations-compact.png' });
});
