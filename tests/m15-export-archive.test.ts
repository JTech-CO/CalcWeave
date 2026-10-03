import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import { createExportArchive, EXPORT_ARCHIVE_LIMITS } from '../apps/web/src/export-download';
import { compileModel } from '../packages/compiler/src';
import { generateWasm } from '../packages/codegen-wasm/src';
import { migrationFixture } from './m15-package-fixtures';

describe('M15 WASM binary archive boundary', () => {
  it('stores exact executable bytes with independently checked CRC and without text encoding', () => {
    const source = generateWasm(compileModel(migrationFixture())), original = Uint8Array.from(source);
    const archive = createExportArchive({ 'model.wasm': source, 'runner.mjs': 'export const abi = 1;' });
    source.fill(255);
    const view = new DataView(archive.buffer), size = view.getUint32(18, true), names = view.getUint16(26, true), body = archive.slice(30 + names, 30 + names + size);
    expect(body).toEqual(original); expect(view.getUint32(14, true)).toBe(crc32(body));
    const module = new WebAssembly.Module(body);
    expect(WebAssembly.Module.imports(module)).toEqual([]); expect(WebAssembly.Module.exports(module)).toEqual([{ name: 'evaluate', kind: 'function' }]);
  });
  it('rejects binary content under code/model filenames and oversized binary before copying', () => {
    expect(() => createExportArchive({ 'model.py': new Uint8Array([1]) })).toThrow();
    expect(() => createExportArchive({ 'runner.mjs': new Uint8Array([1]) })).toThrow();
    expect(() => createExportArchive({ '../model.wasm': new Uint8Array([1]) })).toThrow();
    expect(() => createExportArchive({ 'model.wasm': new Uint8Array(EXPORT_ARCHIVE_LIMITS.maxFileBytes + 1) })).toThrow(/16 MiB/);
  });
});
