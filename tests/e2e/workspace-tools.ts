import type { Page } from '@playwright/test';

export const workspaceMenuTrigger = (page: Page) => page.locator('summary[aria-label="작업 공간"]');

async function expandDetails(page: Page, label: string): Promise<void> {
  const summary = page.getByText(label, { exact: true });
  if (!await summary.evaluate(element => element.closest('details')?.open === true)) await summary.click();
}

async function openWorkspaceMenu(page: Page): Promise<void> {
  const trigger = workspaceMenuTrigger(page);
  if (!await trigger.evaluate(element => element.parentElement instanceof HTMLDetailsElement && element.parentElement.open)) await trigger.click();
}

export async function openWorkspaceBackup(page: Page): Promise<void> {
  await openWorkspaceMenu(page);
  await page.getByRole('button', { name: '백업·복구', exact: true }).click();
  await page.getByRole('dialog', { name: '백업·복구', exact: true }).waitFor({ state: 'visible' });
}

export async function openSignedPackage(page: Page): Promise<void> {
  await openWorkspaceMenu(page);
  await expandDetails(page, '고급 파일');
  await page.getByRole('button', { name: '모델 패키지 공유', exact: true }).click();
  await page.getByRole('dialog', { name: '모델 패키지 공유', exact: true }).waitFor({ state: 'visible' });
}

export async function expandStorageTroubleshooting(page: Page): Promise<void> {
  await expandDetails(page, '저장 문제 해결');
}

export async function expandLocalReset(page: Page): Promise<void> {
  await expandDetails(page, '이 브라우저의 저장 데이터 삭제');
}
