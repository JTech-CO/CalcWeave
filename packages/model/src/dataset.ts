import { ModelError, type Dataset, type DatasetCell } from './types';
import { UNITS } from './signal';
import { sha256 } from './sha256';
import { conversionCoefficients } from './units';

export const DATASET_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxRows: 4_000, maxColumns: 16, maxCells: 20_000, maxDatasets: 8, maxStringLength: 1_000 });
const reserved = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
export function isDatasetColumnName(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value) && !reserved.has(value) && value.trim() === value;
}
/** Normalized table semantics; provenance/name/revision stay outside the content hash. */
export function datasetContentHash(dataset: Pick<Dataset, 'timeColumn' | 'columns' | 'rows'>): string {
  return sha256(JSON.stringify({ timeColumn: dataset.timeColumn, columns: dataset.columns.map(({ name, kind, unit }) => ({ name, kind, unit })), rows: dataset.rows }));
}
/** Reject accessors/prototypes before touching an imported in-memory dataset. */
function inspectDataset(input: unknown): void {
  const stack: { value: unknown; depth: number; leave?: boolean }[] = [{ value: input, depth: 0 }];
  const active = new WeakSet<object>();
  let visited = 0, bytes = 0;
  const encoder = new TextEncoder();
  while (stack.length) {
    const { value, depth, leave } = stack.pop()!;
    if (leave) { active.delete(value as object); continue; }
    if (++visited > DATASET_LIMITS.maxCells + DATASET_LIMITS.maxRows + 240 || depth > 7) fail('DATASET_RESOURCE_LIMIT', '데이터의 크기나 중첩 깊이가 상한을 초과했습니다.');
    if (typeof value === 'string') { bytes += encoder.encode(JSON.stringify(value)).byteLength; }
    else if (typeof value === 'number') { if (!Number.isFinite(value)) fail('NONFINITE_DATASET', '데이터 숫자는 유한해야 합니다.'); bytes += 24; }
    else if (typeof value === 'boolean' || value === null) bytes += 5;
    else if (typeof value === 'object') {
      if (active.has(value)) fail('INVALID_DATASET', '데이터에는 순환 객체를 사용할 수 없습니다.');
      const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
      if ((array && prototype !== Array.prototype) || (!array && prototype !== Object.prototype && prototype !== null)) fail('UNSAFE_FIELD', '데이터에는 일반 JSON 객체와 배열만 사용할 수 있습니다.');
      const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
      if (keys.length > DATASET_LIMITS.maxRows + 1 || (array && keys.length !== value.length + 1)) fail('DATASET_RESOURCE_LIMIT', '데이터 배열 크기나 구조를 확인하세요.');
      active.add(value); stack.push({ value, depth, leave: true }); bytes += 2;
      for (const key of keys) {
        if (typeof key !== 'string' || reserved.has(key)) fail('UNSAFE_FIELD', '데이터에 안전하지 않은 필드가 있습니다.');
        if (array && key === 'length') continue;
        if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail('INVALID_DATASET', '데이터 배열에는 빈 칸이나 추가 속성을 사용할 수 없습니다.');
        const property = descriptors[key]!;
        if (!('value' in property) || !property.enumerable) fail('UNSAFE_FIELD', '데이터에는 접근자나 숨김 속성을 사용할 수 없습니다.');
        bytes += encoder.encode(JSON.stringify(key)).byteLength + 2;
        stack.push({ value: property.value, depth: depth + 1 });
      }
    } else fail('INVALID_DATASET', '데이터는 JSON 값이어야 합니다.');
    if (bytes > DATASET_LIMITS.maxBytes) fail('DATASET_TOO_LARGE', '정규화한 데이터는 2 MiB 이하여야 합니다.');
  }
}
/** Complete synchronous validation and content integrity check at every model import. */
export function validateDataset(input: unknown): Dataset {
  inspectDataset(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_DATASET', '데이터 객체가 필요합니다.');
  const dataset = input as Dataset;
  const fields = ['id', 'name', 'version', 'sourceHash', 'contentHash', 'timeColumn', 'columns', 'rows'];
  if (Object.keys(input).some(key => !fields.includes(key) && key !== 'provenance') || fields.some((key) => !Object.hasOwn(input, key))) fail('INVALID_DATASET', '데이터 필드가 누락되었거나 알 수 없는 필드가 있습니다.');
  if (Object.hasOwn(input, 'provenance')) {
    const provenance = dataset.provenance;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance) || Object.keys(provenance).some(key => !['format', 'filename', 'sheet', 'sourceHash', 'transforms'].includes(key)) || !['csv', 'json', 'xlsx', 'editor', 'mat-v5'].includes(provenance.format) || provenance.sourceHash !== dataset.sourceHash || !Array.isArray(provenance.transforms) || provenance.transforms.length > 8 || provenance.transforms.some(value => typeof value !== 'string' || value.length > 100)) fail('INVALID_DATASET_PROVENANCE', '데이터 출처와 정리 기록을 확인하세요.');
    if (provenance.filename !== undefined && (typeof provenance.filename !== 'string' || provenance.filename.length > 100) || provenance.sheet !== undefined && (typeof provenance.sheet !== 'string' || provenance.sheet.length > 80)) fail('INVALID_DATASET_PROVENANCE', '파일명과 시트 이름의 길이를 확인하세요.');
  }
  if (typeof dataset.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(dataset.id) || reserved.has(dataset.id)) fail('INVALID_DATASET', '데이터 ID를 확인하세요.');
  if (typeof dataset.name !== 'string' || dataset.name.length < 1 || dataset.name.length > 120 || !Number.isSafeInteger(dataset.version) || dataset.version < 1 || dataset.version > 1_000_000) fail('INVALID_DATASET', '데이터 이름과 버전을 확인하세요.');
  if (typeof dataset.sourceHash !== 'string' || typeof dataset.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(dataset.sourceHash) || !/^[a-f0-9]{64}$/.test(dataset.contentHash)) fail('INVALID_DATASET_HASH', '데이터 해시는 소문자 SHA-256이어야 합니다.');
  if (!Array.isArray(dataset.columns) || dataset.columns.length < 1 || dataset.columns.length > DATASET_LIMITS.maxColumns) fail('DATASET_RESOURCE_LIMIT', '데이터 열은 1~16개여야 합니다.');
  const names = new Set<string>();
  for (const column of dataset.columns) {
    if (!column || typeof column !== 'object' || Array.isArray(column) || Object.keys(column).length !== 3 || !Object.hasOwn(column, 'name') || !Object.hasOwn(column, 'kind') || !Object.hasOwn(column, 'unit')) fail('INVALID_DATASET', '데이터 열에는 name/kind/unit가 필요합니다.');
    if (!isDatasetColumnName(column.name) || names.has(column.name)) fail('INVALID_DATASET_COLUMN', '데이터 열 이름이 잘못되었거나 중복되었습니다.');
    names.add(column.name);
    if (!['number', 'boolean', 'string'].includes(column.kind) || !(UNITS as readonly string[]).includes(column.unit) || (column.kind !== 'number' && column.unit !== '1')) fail('INVALID_DATASET_COLUMN', '열 형식과 단위를 확인하세요. boolean/string은 단위 1만 사용합니다.');
  }
  const timeIndex = dataset.columns.findIndex((column) => column.name === dataset.timeColumn);
  if (timeIndex < 0 || dataset.columns[timeIndex]!.kind !== 'number' || !['1', 's', 'ms', 'min'].includes(dataset.columns[timeIndex]!.unit)) fail('INVALID_DATASET_TIME', '시간 열은 number이며 단위 1/s/ms/min이어야 합니다.');
  if (!Array.isArray(dataset.rows) || dataset.rows.length < 1 || dataset.rows.length > DATASET_LIMITS.maxRows || dataset.rows.length * dataset.columns.length > DATASET_LIMITS.maxCells) fail('DATASET_RESOURCE_LIMIT', '데이터는 1~4,000행, 20,000셀 이하여야 합니다.');
  const timeScale = dataset.columns[timeIndex]!.unit === '1' ? 1 : conversionCoefficients(dataset.columns[timeIndex]!.unit, 's').scale;
  let previous = -Infinity;
  for (const row of dataset.rows) {
    if (!Array.isArray(row) || row.length !== dataset.columns.length) fail('INVALID_DATASET_ROW', '데이터 행의 열 수가 다릅니다.');
    for (let index = 0; index < row.length; index++) {
      const value = row[index]!, kind = dataset.columns[index]!.kind;
      if (typeof value !== kind || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > DATASET_LIMITS.maxStringLength)) fail('INVALID_DATASET_CELL', '데이터 셀 형식 또는 문자열 길이를 확인하세요.');
    }
    const time = (row[timeIndex] as number) * timeScale;
    if (!Number.isFinite(time) || Math.abs(time) > 1_000_000_000 || time <= previous) fail('INVALID_DATASET_TIME', '시간은 초로 환산한 -1e9~1e9 범위에서 중복 없이 증가해야 합니다.');
    previous = time;
  }
  if (datasetContentHash(dataset) !== dataset.contentHash) fail('DATASET_HASH_MISMATCH', '데이터 내용이 저장된 SHA-256과 다릅니다. 다시 가져오세요.');
  return JSON.parse(JSON.stringify(dataset)) as Dataset;
}
