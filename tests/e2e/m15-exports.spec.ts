import { openSignedPackage } from './workspace-tools';
import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { migrationFixture, signedLegacyPackage } from '../m15-package-fixtures';
import { createExample } from '../../apps/web/src/examples';
import type { CalcModel } from '../../packages/model/src';

async function workspace(page: Page, model?: CalcModel) {
  await page.goto('./'); await expect(page.locator('.save-indicator')).toContainText('브라우저에 저장됨');
  if (model) { await page.getByLabel('CalcWeave 모델 파일 선택').setInputFiles({ name: 'm15.cw.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) }); await expect(page.getByLabel('모델 이름')).toHaveValue(model.name); }
}
async function download(page: Page, name: string) { const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const file = await pending; return readFile((await file.path())!); }
function zip(bytes: Buffer) {
  const files: Record<string, Buffer> = {}; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28), start = offset + 30 + length + extra;
    files[bytes.subarray(offset + 30, offset + 30 + length).toString('utf8')] = bytes.subarray(start, start + size); offset = start + size;
  }
  return files;
}

test('M15 downloaded WASM binary and self-contained runner execute in the real browser and bind exact manifest bytes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await workspace(page, migrationFixture()); await page.locator('.run-button').click(); await expect(page.locator('.result-status.current')).toBeVisible();
  await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click(); await page.getByLabel('코드 타깃', { exact: true }).selectOption('wasm');
  await expect(page.getByRole('button', { name: 'WASM 모듈 다운로드', exact: true })).toBeEnabled();
  const module = await download(page, 'WASM 모듈 다운로드'), files = zip(await download(page, 'WASM 실행 묶음'));
  expect(Object.keys(files).sort()).toEqual(['README.md', 'expected-output.json', 'manifest.json', 'model.cw.json', 'model.wasm', 'runner.mjs']); expect(files['model.wasm']).toEqual(module);
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
  expect(manifest.targetVersion).toBe('wasm-m15-v1'); expect(manifest.artifactHash).toBe(createHash('sha256').update(module).digest('hex'));
  const direct = await page.evaluate(({ bytes, index }) => {
    const compiled = new WebAssembly.Module(Uint8Array.from(bytes)), instance = new WebAssembly.Instance(compiled);
    return { imports: WebAssembly.Module.imports(compiled), exports: WebAssembly.Module.exports(compiled), result: (instance.exports.evaluate as (index: number, time: number) => number)(index, 0) };
  }, { bytes: [...module], index: manifest.nodeIds.indexOf('result') });
  expect(direct).toEqual({ imports: [], exports: [{ name: 'evaluate', kind: 'function' }], result: 6 });
  // Serve only this compiler-owned downloaded artifact at a controlled same-origin proof URL.
  await page.route('**/m15-runner-proof.mjs', route => route.fulfill({ contentType: 'application/javascript', body: files['runner.mjs'] }));
  const executed = await page.evaluate(async () => { const source = await import(new URL('m15-runner-proof.mjs', location.href).href); return { result: await source.run(), manifest: source.getManifest() }; });
  expect(executed.manifest).toEqual(manifest); expect(executed.result.samples).toEqual(JSON.parse(files['expected-output.json'].toString('utf8')).samples); expect(errors).toEqual([]);
});

test('M15 target restrictions name incompatible nodes and keep C/C++ unavailable', async ({ page }) => {
  await workspace(page, createExample('continuous-decay')); await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click();
  await page.getByLabel('코드 타깃', { exact: true }).selectOption('wasm'); await expect(page.locator('.export-diagnostics')).toContainText('WASM_UNSUPPORTED_MODE'); await expect(page.getByRole('button', { name: 'WASM 모듈 다운로드', exact: true })).toBeDisabled();
  await page.getByLabel('코드 타깃', { exact: true }).selectOption('c-cpp'); await expect(page.locator('.export-diagnostics')).toContainText('NATIVE_TOOLCHAIN_UNAVAILABLE'); await expect(page.locator('.dialog-actions .primary')).toBeDisabled();
});

test('M15 downloaded Python string program executes the exact typed result in an isolated real interpreter', async ({ page }, info) => {
  const model = migrationFixture(); model.name = 'Python 문자열 실 실행'; model.nodes = [{ id: 'input', blockVersion: 1, blockType: 'source.typed', label: 'Input', parameters: { value: { kind: 'typed', dtype: 'float64', shape: [], data: [2.5] } } }, { id: 'gain', blockVersion: 1, blockType: 'string.to-string', label: 'String', parameters: {} }, { id: 'result', blockVersion: 1, blockType: 'sink.display', label: 'Result', parameters: {} }];
  await workspace(page, model); await page.getByRole('button', { name: '코드 타깃 선택', exact: true }).click(); await page.getByLabel('코드 타깃', { exact: true }).selectOption('python'); await expect(page.getByRole('button', { name: 'Python 코드 다운로드', exact: true })).toBeEnabled();
  const bytes = await download(page, 'Python 코드 다운로드'), path = info.outputPath('model.py'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
  const executed = spawnSync(process.env.CALCWEAVE_PYTHON_PATH ?? 'python', ['-I', '-B', path], { windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
  expect(executed.status, executed.stderr).toBe(0);
  const result = JSON.parse(executed.stdout); expect(result.result.samples[0].values.result).toEqual({ kind: 'typed', dtype: 'string', shape: [], data: ['2.5'] });
  const archive = zip(await download(page, 'Python 실행 묶음')); expect(JSON.parse(archive['manifest.json'].toString('utf8')).targetVersion).toBe('python-m15-v1');
});

test('M15 legacy package requires independent fingerprint and migration review, preserves original bytes, and imports undoably', async ({ page }) => {
  await workspace(page); const before = await page.getByLabel('모델 이름').inputValue(), legacy = await signedLegacyPackage(migrationFixture(), '0.14.0-m13', 'M13');
  await openSignedPackage(page); await page.getByRole('button', { name: '공유 파일 확인', exact: true }).click();
  await page.getByLabel('공유 모델 패키지 파일 선택').setInputFiles({ name: 'old.cwpackage.json', mimeType: 'application/json', buffer: Buffer.from(legacy.text) });
  await expect(page.getByLabel('이전 엔진 변환 보고서', { exact: true })).toContainText('0.14.0-m13'); await expect(page.getByLabel('모델 이름')).toHaveValue(before);
  const apply = page.getByRole('button', { name: '지문 확인 후 모델 가져오기', exact: true }); await expect(apply).toBeDisabled();
  await page.getByLabel('신뢰할 수 있는 공개 키 지문').fill(legacy.fingerprint); await expect(apply).toBeDisabled();
  expect((await download(page, '원본 서명 패키지 보관')).toString('utf8')).toBe(legacy.text);
  const report = JSON.parse((await download(page, '변환 보고서 다운로드')).toString('utf8')); expect(report.migration.numericalParityWithOriginalEngineVerified).toBe(false); expect(report.migration.signatureAppliesTo).toBe('original-payload');
  await page.getByLabel('이전 엔진 변환 보고서 확인').check(); await expect(apply).toBeEnabled(); await apply.click(); await expect(page.getByLabel('모델 이름')).toHaveValue(migrationFixture().name);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect(page.getByLabel('모델 이름')).toHaveValue(before);
});
