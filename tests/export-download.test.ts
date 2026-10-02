import { describe, expect, it } from 'vitest';
import { createExportArchive, exportArchiveReadme, EXPORT_ARCHIVE_LIMITS } from '../apps/web/src/export-download';

function records(archive: Uint8Array): { names: string[]; text: string[]; crc: number[] } {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength), decoder = new TextDecoder();
  const result = { names: [] as string[], text: [] as string[], crc: [] as number[] };
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0);
    const size = view.getUint32(offset + 18, true), nameSize = view.getUint16(offset + 26, true);
    result.names.push(decoder.decode(archive.slice(offset + 30, offset + 30 + nameSize)));
    result.text.push(decoder.decode(archive.slice(offset + 30 + nameSize, offset + 30 + nameSize + size)));
    result.crc.push(view.getUint32(offset + 14, true));
    offset += 30 + nameSize + size;
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50);
  expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(archive.length - 14, true)).toBe(result.names.length);
  return result;
}

describe('Fixed-name offline export ZIP', () => {
  it('keeps UTF-8 payloads, deterministic bytes and standard CRC32 local headers', () => {
    const files = { 'model.ts': '123456789', 'README.md': '안전한 로컬 실행', 'manifest.json': '{"version":1}' };
    const archive = createExportArchive(files), parsed = records(archive);
    expect(parsed.names).toEqual(Object.keys(files)); expect(parsed.text).toEqual(Object.values(files));
    expect(parsed.crc[0]).toBe(0xcbf43926);
    expect(createExportArchive(files)).toEqual(archive);
  });
  it('rejects unknown paths, empty file sets and bounded oversized content', () => {
    expect(() => createExportArchive({ '../model.ts': '' })).toThrow();
    expect(() => createExportArchive({ 'script.js': '' })).toThrow();
    expect(() => createExportArchive({})).toThrow();
    expect(() => createExportArchive({ 'model.ts': 'x'.repeat(EXPORT_ARCHIVE_LIMITS.maxFileBytes + 1) })).toThrow(/16 MiB/);
    expect(() => createExportArchive({ 'model.ts': '가'.repeat(Math.floor(EXPORT_ARCHIVE_LIMITS.maxFileBytes / 3) + 1) })).toThrow(/16 MiB/);
  });
  it('states when a current completed snapshot was not available', () => {
    expect(exportArchiveReadme(false)).toContain('expected-output.json을 포함하지 않았습니다');
    expect(exportArchiveReadme(true)).toContain('현재 모델의 완료 결과');
  });
  it('documents embedded M4 data and hierarchy provenance without changing legacy archive descriptions', () => {
    const readme = exportArchiveReadme(true, 'continuous', true);
    expect(readme).toContain('승인된 M4'); expect(readme).toContain('dataReferences'); expect(readme).toContain('hierarchyReferences'); expect(readme).toContain('외부 파일이나 URL을 읽지 않습니다');
    expect(exportArchiveReadme(true, 'continuous')).toContain('승인된 M3 부분집합');
  });
  it('describes the solver snapshot and hybrid boundaries for continuous execution archives', () => {
    const readme = exportArchiveReadme(true, 'continuous');
    expect(readme).toContain('manifest의 RK4·RK45 설정');
    expect(readme).toContain('출력 격자는 solver 내부 간격과 별개');
    expect(readme).toContain('승인된 M3 부분집합');
    expect(readme).toContain('solver 통계와 이벤트 기록');
    expect(readme).toContain('reset → tick → observe');
    expect(readme).toContain('stateTime은 finalState가 확정된 시각');
    expect(readme).toContain('raw 출력의 마지막 샘플 시각과 다를 수 있습니다');
    expect(readme).toContain('현재 모델의 완료 결과');
  });
});
