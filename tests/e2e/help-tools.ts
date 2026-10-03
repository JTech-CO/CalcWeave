import { expect, type Page } from '@playwright/test';

export const helpTrigger = (page: Page) => page.getByRole('button', { name: '도움말', exact: true });
export const helpDialog = (page: Page) => page.getByRole('dialog', { name: 'CalcWeave 도움말', exact: true });

export async function openHelp(page: Page) {
  await helpTrigger(page).click();
  const dialog = helpDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-help-start]')).toBeFocused();
  return dialog;
}

export async function openBlockHelp(page: Page) {
  const dialog = await openHelp(page);
  await dialog.getByRole('button', { name: '블록 찾기', exact: true }).click();
  await expect(dialog.getByLabel('지원 블록 검색')).toBeVisible();
  return dialog;
}

export async function openAppInfo(page: Page) {
  const dialog = await openHelp(page);
  await dialog.getByRole('button', { name: '앱 정보', exact: true }).click();
  return dialog;
}

export async function openCompatibilityReference(page: Page, kind: 'matrix' | 'adapters') {
  const dialog = await openAppInfo(page);
  await dialog.locator('summary').filter({ hasText: /^호환성 참고$/ }).click();
  await dialog.getByRole('button', { name: kind === 'matrix' ? 'Simulink 참고 자료 비교' : '확장 기능 상세', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '앱 정보로 돌아가기', exact: true })).toBeVisible();
  return dialog;
}

export async function expandHelpDetail(page: Page, summary: string) {
  const item = helpDialog(page).getByText(summary, { exact: true });
  if (await item.locator('..').getAttribute('open') === null) await item.click();
}
