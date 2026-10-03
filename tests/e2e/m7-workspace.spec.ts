import { openSignedPackage, workspaceMenuTrigger } from './workspace-tools';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createExample } from '../../apps/web/src/examples';
import { createModelPackage } from '../../packages/model-package/src';
import type { CalcModel } from '../../packages/model/src';
import { PYTHON_TARGET } from '../../packages/codegen-python/src/capabilities';

async function open(page: Page) { await page.goto('./'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨'); }
async function importModel(page: Page, model: CalcModel | unknown) { await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm7.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) }); }
function zipTexts(bytes: Buffer): Record<string, string> {
  let offset = 0; const files: Record<string, string> = {};
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8'), start = offset + 30 + nameSize + extra;
    files[name] = bytes.subarray(start, start + size).toString('utf8'); offset = start + size;
  }
  return files;
}
async function bytesFromDownload(page: Page, button: string) { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: button, exact: true }).click(); const file = await pending; return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) }; }

test('M7 target dialog creates standalone Python code and a six-file archive with the current raw result', async ({ page }, testInfo) => {
  await open(page); await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
  const trigger = page.getByRole('button', { name: '코드 타깃 선택', exact: true }); await trigger.click();
  await expect(page.getByRole('combobox', { name: '코드 타깃', exact: true })).toBeFocused(); await expect(page.locator('.app-header')).toHaveAttribute('aria-hidden', 'true');
  await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python'); await expect(page.getByRole('button', { name: 'Python 코드 다운로드', exact: true })).toBeEnabled();
  const code = await bytesFromDownload(page, 'Python 코드 다운로드'); expect(code.name).toBe('model.py');
  expect(code.bytes.toString('utf8')).toContain('def run('); expect(code.bytes.toString('utf8')).toContain('get_manifest'); expect(code.bytes.toString('utf8')).not.toMatch(/\beval\(|\bexec\(|\burllib\b|https?:\/\//);
  const archive = await bytesFromDownload(page, 'Python 실행 묶음'); expect(archive.name).toBe('CalcWeave-python-execution.zip');
  const files = zipTexts(archive.bytes); expect(Object.keys(files).sort()).toEqual(['README.md', 'expected-output.json', 'manifest.json', 'model.cw.json', 'model.py', 'run-example.py']);
  const manifest = JSON.parse(files['manifest.json']); expect(manifest.targetVersion).toBe(PYTHON_TARGET.id); expect(manifest.minimumVersion).toBe('3.10');
  expect(files['README.md']).toContain('표준 라이브러리'); expect(files['run-example.py']).toContain('from model import run, get_manifest');
  const expected = JSON.parse(files['expected-output.json']); expect(expected.status).toBe('completed');
  const pythonFile = testInfo.outputPath('downloaded-model.py'); await mkdir(dirname(pythonFile), { recursive: true }); await writeFile(pythonFile, files['model.py'], 'utf8');
  const executed = spawnSync(process.env.CALCWEAVE_PYTHON_PATH ?? 'python', ['-I', '-B', pythonFile], { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
  expect(executed.error).toBeUndefined(); expect(executed.status, executed.stderr).toBe(0);
  const standalone = JSON.parse(executed.stdout); expect(standalone.manifest).toEqual(manifest); expect(standalone.result).toEqual(expected);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});

test('M7 Python validation explains continuous and advanced unsupported blocks and prevents downloads', async ({ page }) => {
  await open(page); await importModel(page, createExample('continuous-decay')); await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('continuous-decay').name);
  await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click(); await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python');
  await expect(page.locator('.export-diagnostics')).toContainText('PYTHON'); await expect(page.getByRole('button', { name: 'Python 코드 다운로드', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await importModel(page, createExample('matrix-solve-lu')); await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('matrix-solve-lu').name);
  await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click(); await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python');
  await expect(page.locator('.export-diagnostics')).toContainText('lu'); await expect(page.getByRole('button', { name: 'Python 실행 묶음', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('typescript'); await expect(page.getByRole('button', { name: 'TypeScript 코드 다운로드', exact: true })).toBeEnabled();
});

test('M7 stale result is omitted from Python archive after a model parameter changes', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '계산하기' }).click(); await expect(page.locator('.result-status.current')).toBeVisible();
  const changed = createExample('first-calculation'); changed.nodes.find(node => node.blockType === 'source.constant')!.parameters.value = 7;
  await importModel(page, changed); await expect(page.locator('.result-status.current')).toHaveCount(0);
  await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click(); await page.getByRole('combobox', { name: '코드 타깃', exact: true }).selectOption('python'); await expect(page.getByRole('button', { name: 'Python 실행 묶음', exact: true })).toBeEnabled();
  const files = zipTexts((await bytesFromDownload(page, 'Python 실행 묶음')).bytes); expect(files['expected-output.json']).toBeUndefined(); expect(Object.keys(files)).toHaveLength(5); expect(files['README.md']).toContain('완료 결과가 없어');
});

test('Advanced signed files require deliberate workspace navigation and Escape restores the workspace trigger', async ({ page }) => {
  await open(page);
  const trigger = workspaceMenuTrigger(page);
  await expect(page.getByRole('button', { name: '모델 패키지 공유', exact: true })).toBeHidden();
  await trigger.focus(); await page.keyboard.press('Enter');
  const advanced = page.getByText('고급 파일', { exact: true });
  await expect(advanced).toBeVisible();
  await expect(page.getByRole('button', { name: '모델 패키지 공유', exact: true })).toBeHidden();
  await advanced.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '모델 패키지 공유', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '모델 패키지 공유', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '서명된 패키지 생성', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await trigger.evaluate(element => element.parentElement instanceof HTMLDetailsElement && element.parentElement.open)).toBe(false);
});

test('M7 package creation uses an ephemeral signature without adding a private key to browser storage', async ({ page }) => {
  await open(page); await openSignedPackage(page); await page.getByRole('button', { name: '서명된 패키지 생성', exact: true }).click();
  const first = await page.getByTestId('created-package-fingerprint').innerText(); expect(first).toMatch(/^[0-9a-f]{64}$/);
  const file = await bytesFromDownload(page, '공유 패키지 다운로드'); expect(file.name).toBe('CalcWeave-model.cwpackage.json');
  expect(file.bytes.toString('utf8')).not.toMatch(/privateKey|BEGIN PRIVATE KEY|"d"\s*:/);
  await page.getByRole('button', { name: '서명된 패키지 생성', exact: true }).click(); await expect(page.getByTestId('created-package-fingerprint')).not.toHaveText(first);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })); expect(storage).not.toMatch(/privateKey|BEGIN PRIVATE KEY/);
  await page.keyboard.press('Escape'); await expect(workspaceMenuTrigger(page)).toBeFocused();
});

test('M7 signed package inspection preserves the model until an independently trusted fingerprint matches and import is undoable', async ({ page }) => {
  await open(page); const before = createExample('first-calculation'), next = createExample('discrete-feedback');
  const created = await createModelPackage(next);
  await openSignedPackage(page); await page.getByRole('button', { name: '공유 파일 확인', exact: true }).click();
  await page.getByLabel('공유 모델 패키지 파일 선택').setInputFiles({ name: 'checked.cwpackage.json', mimeType: 'application/json', buffer: Buffer.from(created.text) });
  await expect(page.getByTestId('inspected-package-fingerprint')).toHaveText(created.fingerprint);
  const accept = page.getByRole('button', { name: '지문 확인 후 모델 가져오기', exact: true }); await expect(accept).toBeDisabled(); await expect(page.getByLabel('모델 이름')).toHaveValue(before.name);
  await page.getByLabel('신뢰할 수 있는 공개 키 지문').fill('0'.repeat(64)); await expect(accept).toBeDisabled();
  await page.getByLabel('신뢰할 수 있는 공개 키 지문').fill(created.fingerprint); await expect(accept).toBeEnabled(); await accept.click();
  await expect(page.getByLabel('모델 이름')).toHaveValue(next.name); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect(page.getByLabel('모델 이름')).toHaveValue(before.name);
});

test('M7 tampered package is rejected without exposing an import button or replacing the current model', async ({ page }) => {
  await open(page); const created = await createModelPackage(createExample('discrete-feedback'));
  const altered = JSON.parse(created.text); const changeName = (value: unknown): boolean => { if (!value || typeof value !== 'object') return false; if ('modelId' in value && 'name' in value) { (value as { name: string }).name = 'tampered'; return true; } return Object.values(value).some(changeName); }; expect(changeName(altered)).toBe(true);
  await openSignedPackage(page); await page.getByRole('button', { name: '공유 파일 확인', exact: true }).click();
  await page.getByLabel('공유 모델 패키지 파일 선택').setInputFiles({ name: 'tampered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(altered)) });
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByTestId('inspected-package-fingerprint')).toHaveCount(0); await expect(page.getByRole('button', { name: '지문 확인 후 모델 가져오기', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('first-calculation').name);
});

test('M7 native import separates parsed, conversion and execution states and retains editable invalid models', async ({ page }) => {
  await open(page); const model = createExample('first-calculation'); model.name = '연결을 수정할 모델'; model.edges = [];
  await importModel(page, model); await expect(page.getByLabel('모델 이름')).toHaveValue(model.name);
  await page.getByRole('button', { name: '가져오기 보고서', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '모델 가져오기 보고서' });
  await expect(dialog).toContainText('원본 형식 · 변환 없음'); await expect(dialog).toContainText('편집할 수 있습니다.'); await expect(dialog.locator('.export-diagnostics')).toBeVisible();
  const report = JSON.parse((await bytesFromDownload(page, '보고서 다운로드')).bytes.toString('utf8')); expect(report.parsed).toBe(true); expect(report.converted).toBe(false); expect(report.executable).toBe(false);
  await page.keyboard.press('Escape'); await importModel(page, { format: 'Simulink', blocks: [] }); await expect(page.getByLabel('모델 이름')).toHaveValue(model.name);
  await page.getByRole('button', { name: '가져오기 보고서', exact: true }).click(); await expect(dialog).toContainText('지원하는 외부 변환기가 없습니다.'); await expect(dialog).toContainText('원래 모델을 유지합니다.');
});

test('M7 file dialogs keep execution and editing shortcuts inside their modal boundary', async ({ page }) => {
  await open(page); await page.locator('.model-node-list').getByRole('button', { name: '배율', exact: true }).click();
  const nodesBefore = await page.locator('.react-flow__node').count();
  for (const trigger of ['코드 타깃 선택', '모델 패키지 공유']) {
    if (trigger === '모델 패키지 공유') await openSignedPackage(page);
    else await page.getByRole('button', { name: trigger, exact: true }).click();
    await page.getByRole('dialog').getByRole('button').first().focus(); await page.keyboard.press('Control+Enter'); await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
    await expect(page.locator('.result-status.current')).toHaveCount(0); expect(await page.locator('.react-flow__node').count()).toBe(nodesBefore); await expect(page.getByLabel('모델 이름')).toHaveValue(createExample('first-calculation').name);
    await page.keyboard.press('Escape');
  }
  await importModel(page, createExample('first-calculation')); await page.getByRole('button', { name: '가져오기 보고서', exact: true }).click(); await page.getByRole('button', { name: '보고서 다운로드', exact: true }).focus();
  await page.keyboard.press('Control+Enter'); await page.keyboard.press('Delete'); await expect(page.locator('.result-status.current')).toHaveCount(0); expect(await page.locator('.react-flow__node').count()).toBe(nodesBefore);
});

test('M7 a delayed native file read cannot replace a newer file selection or an opened model', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const state = window as unknown as { slowFileStarted: boolean; finishSlowFile: () => void };
    const original = File.prototype.text; const gate = new Promise<void>(resolve => { state.finishSlowFile = resolve; });
    File.prototype.text = async function () { const value = await original.call(this); if (this.name === 'slow-native.cw.json') { state.slowFileStarted = true; await gate; } return value; };
  });
  const slow = createExample('discrete-feedback');
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'slow-native.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(slow)) });
  await page.waitForFunction(() => (window as unknown as { slowFileStarted?: boolean }).slowFileStarted);
  const latest = createExample('vector-shape'); await importModel(page, latest); await expect(page.getByLabel('모델 이름')).toHaveValue(latest.name);
  await page.evaluate(() => (window as unknown as { finishSlowFile: () => void }).finishSlowFile());
  await page.getByRole('button', { name: '가져오기 보고서', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('현재 엔진에서 실행할 수 있습니다.'); await page.keyboard.press('Escape');
  await expect(page.getByLabel('모델 이름')).toHaveValue(latest.name);
  await page.evaluate(() => {
    const state = window as unknown as { slowEditStarted: boolean; finishSlowEdit: () => void };
    const original = File.prototype.text, gate = new Promise<void>(resolve => { state.finishSlowEdit = resolve; });
    File.prototype.text = async function () { const value = await original.call(this); if (this.name === 'slow-edit.cw.json') { state.slowEditStarted = true; await gate; } return value; };
  });
  await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'slow-edit.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(slow)) });
  await page.waitForFunction(() => (window as unknown as { slowEditStarted?: boolean }).slowEditStarted); await page.getByRole('button', { name: '새 모델', exact: true }).click();
  await page.evaluate(() => (window as unknown as { finishSlowEdit: () => void }).finishSlowEdit());
  await expect(page.locator('.statusbar')).toContainText('파일을 읽는 동안 모델이 바뀌어 가져오기를 적용하지 않았습니다.'); await expect(page.getByLabel('모델 이름')).toHaveValue('새 계산 모델');
});

test('M7 closing a signed package acceptance prevents the delayed verification from committing a model', async ({ page }) => {
  await open(page); const created = await createModelPackage(createExample('discrete-feedback'));
  await openSignedPackage(page); await page.getByRole('button', { name: '공유 파일 확인', exact: true }).click();
  await page.getByLabel('공유 모델 패키지 파일 선택').setInputFiles({ name: 'checked.cwpackage.json', mimeType: 'application/json', buffer: Buffer.from(created.text) });
  await expect(page.getByTestId('inspected-package-fingerprint')).toHaveText(created.fingerprint); await page.getByLabel('신뢰할 수 있는 공개 키 지문').fill(created.fingerprint);
  await page.evaluate(() => {
    const state = window as unknown as { packageVerifyStarted: boolean; packageVerifyFinished: boolean; finishPackageVerify: () => void };
    const original = crypto.subtle.verify.bind(crypto.subtle), gate = new Promise<void>(resolve => { state.finishPackageVerify = resolve; });
    Object.defineProperty(crypto.subtle, 'verify', { value: async (...args: Parameters<SubtleCrypto['verify']>) => { state.packageVerifyStarted = true; await gate; const result = await original(...args); state.packageVerifyFinished = true; return result; } });
  });
  await page.getByRole('button', { name: '지문 확인 후 모델 가져오기', exact: true }).click(); await page.waitForFunction(() => (window as unknown as { packageVerifyStarted?: boolean }).packageVerifyStarted);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByRole('button', { name: '새 모델', exact: true }).click(); await expect(page.getByLabel('모델 이름')).toHaveValue('새 계산 모델');
  await page.evaluate(() => (window as unknown as { finishPackageVerify: () => void }).finishPackageVerify()); await page.waitForFunction(() => (window as unknown as { packageVerifyFinished?: boolean }).packageVerifyFinished);
  await expect(page.getByLabel('모델 이름')).toHaveValue('새 계산 모델');
});
