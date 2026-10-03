import { DATASET_LIMITS, ModelError, sha256, type Dataset, type DatasetCell } from '../../model/src';
import { importDataset, inspectDatasetInput, type DatasetImportOptions } from './index';
import { importBoundedWorkbook, rejectSpreadsheetFormulas, type BoundedWorkbook } from './bounded-xlsx';
export interface LocalDataSource { text: string; format: 'csv' | 'json'; filename: string; sourceFormat: 'csv' | 'json' | 'xlsx' | 'editor'; sourceHash: string; sheet?: string }
function fail(message: string): never { throw new ModelError([{ code: 'DATASET_FILE', message }]); }
function csvCell(value: DatasetCell | null): string { const text = value === null ? '' : String(value); return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }
export function workbookSheetSource(workbook: BoundedWorkbook, sheet: string, filename: string): LocalDataSource {
  const selected = workbook.sheets.find(value => value.name === sheet); if (!selected) fail('읽을 시트를 선택하세요.');
  const text = [selected.columnNames, ...selected.rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  inspectDatasetInput(text, 'csv');
  return { text, format: 'csv', filename: filename.slice(0, 100), sourceFormat: 'xlsx', sourceHash: workbook.sourceHash, sheet };
}
/** Local files only: bounded content inspection before any preview/import. */
export async function inspectLocalDataFile(bytes: Uint8Array, filename: string): Promise<{ source?: LocalDataSource; workbook?: BoundedWorkbook }> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > DATASET_LIMITS.maxBytes) fail('데이터 파일은 2 MiB 이하여야 합니다.');
  if (filename.toLowerCase().endsWith('.xlsx')) return { workbook: await importBoundedWorkbook(bytes) };
  if (!/\.(csv|json)$/i.test(filename)) fail('CSV·JSON·값만 저장된 XLSX 파일을 선택하세요.');
  // Keep a UTF-8 BOM in the raw source so its SHA-256 matches the original bytes.
  // Existing CSV/JSON parsers remove that marker only when reading table contents.
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail('CSV·JSON 파일은 UTF-8로 저장하세요.'); }
  const format = filename.toLowerCase().endsWith('.json') ? 'json' : 'csv';
  // inspectDatasetInput bounds every row; check the complete table through import's parser via each raw cell.
  const inspected = inspectDatasetInput(text, format);
  const rows = rawCells(text, format); rejectSpreadsheetFormulas([inspected.columnNames, ...rows]);
  return { source: { text, format, filename: filename.slice(0, 100), sourceFormat: format, sourceHash: sha256(text) } };
}
function rawCells(text: string, format: 'csv' | 'json'): (DatasetCell | null)[][] {
  if (format === 'json') { const data: unknown = JSON.parse(text.replace(/^\uFEFF/, '')); if (!Array.isArray(data)) fail('JSON 데이터 표를 확인하세요.'); return data.map(row => Array.isArray(row) ? row : Object.values(row)) as (DatasetCell | null)[][]; }
  const rows: string[][] = [], row: string[] = []; let value = '', quoted = false;
  for (let index = 0; index < text.length; index++) { const character = text[index]!;
    if (character === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && character === ',') { row.push(value); value = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) { row.push(value); value = ''; rows.push(row.splice(0)); if (character === '\r' && text[index + 1] === '\n') index++; }
    else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); } return rows;
}
/** Existing normalization remains authoritative; raw file hash is preserved separately from transformed data hash. */
export function importLocalDataSource(source: LocalDataSource, options: Omit<DatasetImportOptions, 'format'>): Dataset {
  const dataset = importDataset(source.text, { ...options, format: source.format });
  const transforms = [options.missing && options.missing !== 'reject' ? `missing:${options.missing}` : '', options.sortTime ? 'sort-time' : '', options.duplicateTimes && options.duplicateTimes !== 'reject' ? `duplicates:${options.duplicateTimes}` : '', options.trimStrings ? 'trim-strings' : '', options.lowercaseStrings ? 'lowercase-strings' : ''].filter(Boolean);
  return { ...dataset, sourceHash: source.sourceHash, provenance: { format: source.sourceFormat, filename: source.filename, ...(source.sheet ? { sheet: source.sheet } : {}), sourceHash: source.sourceHash, transforms } } as Dataset;
}
export interface EditedScenario { name: string; points: { time: number; value: number }[] }
export function scenarioSource(scenario: EditedScenario): LocalDataSource {
  if (scenario && typeof scenario === 'object') { const descriptors = Object.getOwnPropertyDescriptors(scenario); if (Object.getPrototypeOf(scenario) !== Object.prototype || Object.values(descriptors).some(property => !('value' in property)) || Object.keys(descriptors).some(key => !['name', 'points'].includes(key))) fail('시나리오는 이름과 점 목록의 일반 JSON 객체여야 합니다.'); }
  if (!scenario || typeof scenario.name !== 'string' || !scenario.name.trim() || scenario.name.length > 100 || !Array.isArray(scenario.points) || scenario.points.length < 2 || scenario.points.length > 1000) fail('시나리오 이름과 2~1,000개 점을 입력하세요.');
  const array = Object.getOwnPropertyDescriptors(scenario.points); if (Object.getPrototypeOf(scenario.points) !== Array.prototype || Reflect.ownKeys(array).length !== scenario.points.length + 1 || Object.values(array).some(property => !('value' in property))) fail('점 목록에는 빈 칸이나 접근자를 사용할 수 없습니다.');
  let previous = -Infinity;
  const rows = scenario.points.map(point => { if (point && typeof point === 'object') { const descriptors = Object.getOwnPropertyDescriptors(point); if (Object.getPrototypeOf(point) !== Object.prototype || Object.keys(descriptors).length !== 2 || !descriptors.time || !descriptors.value || Object.values(descriptors).some(property => !('value' in property))) fail('각 점에는 time과 value 숫자만 사용하세요.'); } if (!point || !Number.isFinite(point.time) || Math.abs(point.time) > 1e9 || point.time <= previous || !Number.isFinite(point.value)) fail('시각은 중복 없이 증가해야 하며 시간과 값은 유한한 숫자여야 합니다.'); previous = point.time; return `${point.time},${point.value}`; });
  const text = `time,value\r\n${rows.join('\r\n')}\r\n`;
  return { text, format: 'csv', sourceFormat: 'editor', filename: scenario.name, sourceHash: sha256(text) };
}
