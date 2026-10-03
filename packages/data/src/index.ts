import {
  DATASET_LIMITS, ModelError, conversionCoefficients, datasetContentHash, isDatasetColumnName,
  sha256, validateDataset, validateSignal, validateTypedSignal, type Dataset, type DatasetCell, type DatasetColumn, type RunResult, type SignalValue, type TypedDataType, type TypedSignal,
} from '../../model/src';

export interface DatasetImportOptions {
  id: string;
  name: string;
  version?: number;
  format: 'csv' | 'json';
  timeColumn: string;
  columns: DatasetColumn[];
  missing?: 'reject' | 'drop-row' | 'zero';
  trimStrings?: boolean;
  lowercaseStrings?: boolean;
  sortTime?: boolean;
  duplicateTimes?: 'reject' | 'keep-first' | 'keep-last';
}
interface RawTable { columnNames: string[]; rows: (DatasetCell | null)[][] }
function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
function plainProperties(value: unknown, allowed: readonly string[]): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_DATASET_OPTIONS', '가져오기 설정은 일반 객체여야 합니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable) fail('INVALID_DATASET_OPTIONS', '가져오기 설정에 알 수 없는 필드나 접근자가 있습니다.');
  }
  return descriptors;
}
function validateOptions(options: DatasetImportOptions): void {
  const descriptors = plainProperties(options, ['id', 'name', 'version', 'format', 'timeColumn', 'columns', 'missing', 'trimStrings', 'lowercaseStrings', 'sortTime', 'duplicateTimes']);
  if (!descriptors.id || !descriptors.name || !descriptors.format || !descriptors.timeColumn || !descriptors.columns) fail('INVALID_DATASET_OPTIONS', '데이터 ID/이름/형식/시간 열/열 대응을 지정하세요.');
  for (const key of ['trimStrings', 'lowercaseStrings', 'sortTime']) if (descriptors[key] && typeof descriptors[key]!.value !== 'boolean') fail('INVALID_DATASET_OPTIONS', '정리/정렬 옵션은 명시적인 boolean이어야 합니다.');
  if (typeof options.id !== 'string' || typeof options.name !== 'string' || typeof options.timeColumn !== 'string') fail('INVALID_DATASET_OPTIONS', '데이터 ID/이름/시간 열은 문자열이어야 합니다.');
  if (!Array.isArray(options.columns) || Object.getPrototypeOf(options.columns) !== Array.prototype || options.columns.length < 1 || options.columns.length > DATASET_LIMITS.maxColumns) fail('INVALID_DATASET_MAPPING', '열 대응은 1~16개의 열 배열이어야 합니다.');
  const columns = Object.getOwnPropertyDescriptors(options.columns);
  if (Reflect.ownKeys(columns).length !== options.columns.length + 1) fail('INVALID_DATASET_OPTIONS', '열 대응 배열에는 빈 칸이나 추가 속성을 사용할 수 없습니다.');
  for (let index = 0; index < options.columns.length; index++) {
    const property = columns[String(index)];
    if (!property || !('value' in property) || !property.enumerable) fail('INVALID_DATASET_OPTIONS', '열 대응 배열에 접근자나 빈 칸이 있습니다.');
    const column = property.value as DatasetColumn, fields = plainProperties(column, ['name', 'kind', 'unit']);
    if (!fields.name || !fields.kind || !fields.unit || typeof column.name !== 'string' || !['number', 'boolean', 'string'].includes(column.kind) || typeof column.unit !== 'string') fail('INVALID_DATASET_MAPPING', '열마다 명시적인 name/kind/unit 대응이 필요합니다.');
  }
}
function boundedText(text: string): void {
  if (typeof text !== 'string') fail('INVALID_DATASET_TEXT', '데이터 파일은 텍스트여야 합니다.');
  if (text.length > DATASET_LIMITS.maxBytes || new TextEncoder().encode(text).byteLength > DATASET_LIMITS.maxBytes) fail('DATASET_TOO_LARGE', '데이터 파일은 2 MiB 이하여야 합니다.');
}
function validateHeaders(names: string[]): void {
  if (names.length < 1 || names.length > DATASET_LIMITS.maxColumns) fail('DATASET_RESOURCE_LIMIT', '데이터 열은 1~16개여야 합니다.');
  if (names.some((name) => !isDatasetColumnName(name)) || new Set(names).size !== names.length) fail('INVALID_DATASET_COLUMN', '열 이름이 잘못되었거나 중복되었습니다.');
}
/** RFC 4180 parser: quotes are grammar, never expressions; resource checks run while scanning. */
function csvTable(text: string): RawTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [], field = '', state: 'plain' | 'quoted' | 'closed' = 'plain', cells = 0;
  const finishField = (): void => {
    if (++cells > DATASET_LIMITS.maxCells + DATASET_LIMITS.maxColumns) fail('DATASET_RESOURCE_LIMIT', '데이터는 20,000셀 이하여야 합니다.');
    row.push(field); field = ''; state = 'plain';
    if (row.length > DATASET_LIMITS.maxColumns) fail('DATASET_RESOURCE_LIMIT', '데이터 열은 16개 이하여야 합니다.');
  };
  const finishRow = (): void => {
    finishField(); rows.push(row); row = [];
    if (rows.length > DATASET_LIMITS.maxRows + 1) fail('DATASET_RESOURCE_LIMIT', '데이터는 4,000행 이하여야 합니다.');
  };
  for (let index = 0; index < input.length; index++) {
    const character = input[index]!;
    if (state === 'quoted') {
      if (character === '"') {
        if (input[index + 1] === '"') { field += '"'; index++; }
        else state = 'closed';
      } else field += character;
    } else if (character === ',') finishField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index++;
      finishRow();
    } else if (state === 'closed') fail('INVALID_CSV', '닫힌 따옴표 다음에는 쉼표 또는 줄바꿈이 필요합니다.');
    else if (character === '"') {
      if (field.length) fail('INVALID_CSV', '따옴표는 필드의 첫 문자여야 합니다.');
      state = 'quoted';
    } else field += character;
    if (field.length > DATASET_LIMITS.maxStringLength) fail('INVALID_DATASET_CELL', '한 데이터 셀은 1,000자 이하여야 합니다.');
  }
  if (state === 'quoted') fail('INVALID_CSV', 'CSV 따옴표가 닫히지 않았습니다.');
  if (input.length && (field.length || row.length || state === 'closed' || !/[\r\n]$/.test(input))) finishRow();
  const names = rows.shift() ?? [];
  validateHeaders(names);
  if (!rows.length) fail('INVALID_DATASET_ROW', '데이터 행이 하나 이상 필요합니다.');
  if (rows.some((item) => item.length !== names.length)) fail('INVALID_DATASET_ROW', 'CSV 행의 열 수가 헤더와 다릅니다.');
  return { columnNames: names, rows };
}
function jsonTable(text: string): RawTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // A row-record table has at most two container levels; reject allocation-heavy nesting before parse.
  let depth = 0, quoted = false, escaped = false;
  for (const character of input) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { if (++depth > 2) fail('INVALID_DATASET_JSON', 'JSON 데이터는 단순 행 객체 배열이어야 합니다.'); }
    else if (character === '}' || character === ']') depth--;
  }
  let value: unknown;
  try { value = JSON.parse(input); } catch { fail('INVALID_DATASET_JSON', 'JSON 데이터 형식을 확인하세요.'); }
  if (!Array.isArray(value) || value.length < 1 || value.length > DATASET_LIMITS.maxRows || !value[0] || typeof value[0] !== 'object' || Array.isArray(value[0])) fail('INVALID_DATASET_JSON', 'JSON 데이터는 1~4,000개의 행 객체 배열이어야 합니다.');
  const names: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('INVALID_DATASET_ROW', '각 JSON 행은 객체여야 합니다.');
    for (const key of Object.keys(item)) if (!names.includes(key)) names.push(key);
    validateHeaders(names);
  }
  if (value.length * names.length > DATASET_LIMITS.maxCells) fail('DATASET_RESOURCE_LIMIT', '데이터는 20,000셀 이하여야 합니다.');
  const rows = value.map((item): (DatasetCell | null)[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('INVALID_DATASET_ROW', '각 JSON 행은 객체여야 합니다.');
    return names.map((name) => {
      const cell = Object.hasOwn(item, name) ? (item as Record<string, unknown>)[name] : null;
      if (cell === null) return null;
      if ((typeof cell !== 'number' && typeof cell !== 'boolean' && typeof cell !== 'string') || (typeof cell === 'number' && !Number.isFinite(cell)) || (typeof cell === 'string' && cell.length > DATASET_LIMITS.maxStringLength)) fail('INVALID_DATASET_CELL', 'JSON 셀은 유한한 number, boolean, string 또는 결측 null이어야 합니다.');
      return cell as DatasetCell;
    });
  });
  return { columnNames: names, rows };
}
function parseTable(text: string, format: 'csv' | 'json'): RawTable {
  boundedText(text);
  if (format !== 'csv' && format !== 'json') fail('INVALID_DATASET_FORMAT', 'csv/json 형식만 지원합니다.');
  return format === 'csv' ? csvTable(text) : jsonTable(text);
}
export function inspectDatasetInput(text: string, format: 'csv' | 'json'): { columnNames: string[]; sampleRows: (DatasetCell | null)[][]; rowCount: number } {
  const table = parseTable(text, format);
  return { columnNames: table.columnNames, sampleRows: table.rows.slice(0, 5), rowCount: table.rows.length };
}
const numericText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function convertedCell(value: DatasetCell | null, column: DatasetColumn, options: DatasetImportOptions): DatasetCell | null {
  const missing = value === null || typeof value === 'string' && value.trim() === '';
  if (missing) {
    if (options.missing === 'drop-row') return null;
    if (options.missing === 'zero' && column.kind === 'number' && column.name !== options.timeColumn) return 0;
    fail('MISSING_DATASET_CELL', '결측 값은 거부됩니다. 행 제외 또는 숫자 열의 0 대체를 명시적으로 선택하세요. 시간 결측은 0으로 대체할 수 없습니다.');
  }
  if (column.kind === 'number') {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string' || !numericText.test(value.trim())) fail('INVALID_DATASET_NUMBER', `${column.name}에는 유한한 숫자가 필요합니다.`);
    const number = Number(value.trim());
    if (!Number.isFinite(number)) fail('NONFINITE_DATASET', '숫자가 유한한 float64 범위를 벗어났습니다.');
    return number;
  }
  if (column.kind === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string' || !/^(true|false)$/i.test(value.trim())) fail('INVALID_DATASET_BOOLEAN', `${column.name}에는 true/false가 필요합니다.`);
    return value.trim().toLowerCase() === 'true';
  }
  if (typeof value !== 'string') fail('INVALID_DATASET_STRING', `${column.name}에는 문자열이 필요합니다. 형식을 자동 변환하지 않습니다.`);
  let string = options.trimStrings ? value.trim() : value;
  if (options.lowercaseStrings) string = string.toLowerCase();
  return string;
}
/** Local-only import. Every cleanup, ordering, and duplicate policy is explicit. */
export function importDataset(text: string, options: DatasetImportOptions): Dataset {
  validateOptions(options);
  const table = parseTable(text, options.format);
  if (!Array.isArray(options.columns) || options.columns.length !== table.columnNames.length || new Set(options.columns.map((column) => column.name)).size !== table.columnNames.length || options.columns.some((column) => !table.columnNames.includes(column.name))) fail('INVALID_DATASET_MAPPING', '모든 파일 열을 중복 없이 형식/단위에 대응해야 합니다.');
  if (options.missing !== undefined && !['reject', 'drop-row', 'zero'].includes(options.missing) || options.duplicateTimes !== undefined && !['reject', 'keep-first', 'keep-last'].includes(options.duplicateTimes)) fail('INVALID_DATASET_POLICY', '결측/중복 처리 옵션을 확인하세요.');
  const indices = options.columns.map((column) => table.columnNames.indexOf(column.name));
  let rows: DatasetCell[][] = [];
  for (const raw of table.rows) {
    const row: DatasetCell[] = [];
    let dropped = false;
    for (let index = 0; index < options.columns.length; index++) {
      const cell = convertedCell(raw[indices[index]!] ?? null, options.columns[index]!, options);
      if (cell === null) { dropped = true; break; }
      row.push(cell);
    }
    if (!dropped) rows.push(row);
  }
  const timeIndex = options.columns.findIndex((column) => column.name === options.timeColumn);
  if (timeIndex < 0 || options.columns[timeIndex]!.kind !== 'number') fail('INVALID_DATASET_TIME', 'number 시간 열을 명시적으로 지정하세요.');
  if (options.sortTime) rows.sort((a, b) => (a[timeIndex] as number) - (b[timeIndex] as number));
  const byTime = new Map<number, number>(), deduplicated: DatasetCell[][] = [];
  for (const row of rows) {
    const time = row[timeIndex] as number, previous = byTime.get(time);
    if (previous !== undefined) {
      if (!options.duplicateTimes || options.duplicateTimes === 'reject') fail('DUPLICATE_DATASET_TIME', '같은 시간의 행이 있습니다. 중복 처리 정책을 선택하세요.');
      if (options.duplicateTimes === 'keep-last') deduplicated[previous] = row;
    } else { byTime.set(time, deduplicated.length); deduplicated.push(row); }
  }
  rows = deduplicated;
  const dataset: Dataset = { id: options.id, name: options.name, version: options.version ?? 1, sourceHash: sha256(text), contentHash: '', timeColumn: options.timeColumn, columns: options.columns.map(({ name, kind, unit }) => ({ name, kind, unit })), rows };
  dataset.contentHash = datasetContentHash(dataset);
  return validateDataset(dataset);
}
export function datasetSeries(input: Dataset, columnName: string): { times: number[]; values: (number | boolean)[]; kind: 'number' | 'boolean'; unit: string } {
  const dataset = validateDataset(input), index = dataset.columns.findIndex((column) => column.name === columnName);
  if (index < 0) fail('UNKNOWN_DATASET_COLUMN', '선택한 데이터 열이 없습니다.');
  const column = dataset.columns[index]!;
  if (column.kind === 'string') fail('DATASET_STRING_SIGNAL_UNSUPPORTED', '문자열 열은 정리에 사용할 수 있지만 계산 신호로 재생할 수 없습니다.');
  const timeIndex = dataset.columns.findIndex((item) => item.name === dataset.timeColumn), timeUnit = dataset.columns[timeIndex]!.unit;
  const scale = timeUnit === '1' ? 1 : conversionCoefficients(timeUnit, 's').scale;
  return { times: dataset.rows.map((row) => (row[timeIndex] as number) * scale), values: dataset.rows.map((row) => row[index] as number | boolean), kind: column.kind, unit: column.unit };
}
/** Protect spreadsheet consumers from formula injection, then apply RFC 4180 escaping. */
export function safeCsvCell(value: DatasetCell): string {
  let text = String(value);
  if (typeof value === 'string' && (/^[\t\r\n]/.test(text) || /^[\s]*[=+\-@]/.test(text))) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function exportDatasetCsv(input: Dataset): string {
  const dataset = validateDataset(input);
  return [dataset.columns.map((column) => safeCsvCell(column.name)).join(','), ...dataset.rows.map((row) => row.map(safeCsvCell).join(','))].join('\r\n') + '\r\n';
}
function flattenSignal(value: SignalValue): (number | boolean)[] {
  if (typeof value === 'number' || typeof value === 'boolean') return [value];
  if (!Array.isArray(value)) fail('INVALID_RESULT_CSV', '기존 신호와 자료형 신호를 같은 열에 혼합할 수 없습니다.');
  return value.flat() as (number | boolean)[];
}
/** Export every sample; vectors/matrices use stable row-major indexed columns. */
export function exportResultCsv(result: RunResult, labels: Record<string, string> = {}): string {
  if (!result.samples.length) return 'time (s)\r\n';
  if (Object.values(result.samples[0]!.values).some(value => typeof value === 'object' && !Array.isArray(value))) return exportTypedResultCsv(result, labels);
  const ids = Object.keys(result.samples[0]!.values).sort(), widths = ids.map((id) => flattenSignal(result.samples[0]!.values[id]!).length);
  const headers = ['time (s)', ...ids.flatMap((id, index) => Array.from({ length: widths[index]! }, (_, cell) => widths[index] === 1 ? labels[id] ?? id : `${labels[id] ?? id}[${cell}]`))];
  const lines = [headers.map(safeCsvCell).join(',')];
  if (result.samples.length * (1 + widths.reduce((sum, value) => sum + value, 0)) > 1_000_000) fail('RESULT_RESOURCE_LIMIT', '결과 CSV는 1,000,000개 값 이하여야 합니다.');
  for (const sample of result.samples) {
    if (!Number.isFinite(sample.time) || Object.keys(sample.values).length !== ids.length) fail('INVALID_RESULT_CSV', '결과의 시간과 출력 열을 확인하세요.');
    const cells: DatasetCell[] = [sample.time];
    ids.forEach((id, index) => {
      if (!Object.hasOwn(sample.values, id)) fail('INVALID_RESULT_CSV', '결과 출력 열이 샘플마다 다릅니다.');
      const values = flattenSignal(sample.values[id]!);
      if (values.length !== widths[index] || values.some((value) => typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value)))) fail('INVALID_RESULT_CSV', '결과 신호는 모든 샘플에서 같은 크기의 유한한 신호여야 합니다.');
      cells.push(...values);
    });
    lines.push(cells.map(safeCsvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

interface ResultColumn { id: string; typed?: TypedSignal; shape: number[]; valueType: string; width: number }
function typedMetadata(type: TypedDataType): string {
  return type.dtype === 'fixed' ? `fixed; signed=${type.fixed!.signed}; WL=${type.fixed!.wordLength}; FL=${type.fixed!.fractionLength}` : type.dtype === 'enum' ? `enum; name=${type.enum!.name}; labels=${JSON.stringify(type.enum!.labels)}` : type.dtype;
}
function resultColumn(id: string, value: SignalValue): ResultColumn {
  if (typeof value === 'object' && !Array.isArray(value)) {
    const typed = validateTypedSignal(value);
    return { id, typed, shape: typed.shape, valueType: typed.dtype, width: typed.data.length * (typed.dtype === 'complex128' ? 2 : 1) };
  }
  const descriptor = validateSignal(value);
  return { id, shape: descriptor.shape, valueType: descriptor.valueType, width: flattenSignal(value).length };
}
/** Typed cells are explicit text (dtype:payload), preserving codes and preventing spreadsheet coercion. */
function* typedCsvValues(value: TypedSignal): Generator<string> {
  for (const cell of value.data) {
    if (value.dtype === 'complex128' && typeof cell === 'object') { yield `float64:${cell.re}`; yield `float64:${cell.im}`; }
    else yield `${value.dtype}:${String(cell)}`;
  }
}
/** Presentation CSV with exact typed payloads; model JSON is the supported restoration format. */
function exportTypedResultCsv(result: RunResult, labels: Record<string, string>): string {
  const ids = Object.keys(result.samples[0]!.values).sort();
  if (ids.length > 1_000 || result.samples.length > 1_000_000) fail('RESULT_RESOURCE_LIMIT', '결과 CSV의 출력 열과 샘플 수 상한을 초과했습니다.');
  const columns = ids.map(id => resultColumn(id, result.samples[0]!.values[id]!));
  if (result.samples.length * (1 + columns.reduce((sum, column) => sum + column.width, 0)) > 1_000_000) fail('RESULT_RESOURCE_LIMIT', '결과 CSV는 1,000,000개 값 이하여야 합니다.');
  const encoder = new TextEncoder(), headers: string[] = ['time (s)'];
  let headerBytes = 12;
  const addHeader = (text: string): void => {
    headerBytes += encoder.encode(safeCsvCell(text)).byteLength + 1;
    if (headerBytes > 64 * 1_024 * 1_024) fail('RESULT_RESOURCE_LIMIT', '결과 CSV는 64 MiB 이하여야 합니다.');
    headers.push(text);
  };
  for (const column of columns) {
    const name = labels[column.id] ?? column.id;
    if (typeof name !== 'string' || name.length > 1_000) fail('INVALID_RESULT_CSV', '결과 열 이름은 1,000자 이하여야 합니다.');
    if (!column.typed) for (let index = 0; index < column.width; index++) addHeader(column.width === 1 ? name : `${name}[${index}]`);
    else {
      const metadata = `${typedMetadata(column.typed)}; shape=${JSON.stringify(column.shape)}`;
      for (let index = 0; index < column.typed.data.length; index++) {
        const indexed = column.shape.length ? `${name}[${index}]` : name;
        if (column.typed.dtype === 'complex128') { addHeader(`${indexed}.re [${metadata}]`); addHeader(`${indexed}.im [${metadata}]`); }
        else addHeader(`${indexed} [${metadata}]`);
      }
    }
  }
  const lines: string[] = [];
  let bytes = 0;
  const addLine = (values: Iterable<DatasetCell>): void => {
    const parts: string[] = [];
    for (const value of values) {
      const part = safeCsvCell(value);
      bytes += encoder.encode(part).byteLength + (parts.length ? 1 : 0);
      if (bytes > 64 * 1_024 * 1_024 - 2) fail('RESULT_RESOURCE_LIMIT', '결과 CSV는 64 MiB 이하여야 합니다.');
      parts.push(part);
    }
    bytes += 2; lines.push(parts.join(',') + '\r\n');
  };
  addLine(headers);
  for (const sample of result.samples) {
    if (!Number.isFinite(sample.time) || Object.keys(sample.values).length !== ids.length) fail('INVALID_RESULT_CSV', '결과의 시간과 출력 열을 확인하세요.');
    function* sampleCells(): Generator<DatasetCell> {
      yield sample.time;
      for (const column of columns) {
        if (!Object.hasOwn(sample.values, column.id)) fail('INVALID_RESULT_CSV', '결과 출력 열이 샘플마다 다릅니다.');
        const current = resultColumn(column.id, sample.values[column.id]!);
        if (current.valueType !== column.valueType || JSON.stringify(current.shape) !== JSON.stringify(column.shape) || !!current.typed !== !!column.typed || current.typed && typedMetadata(current.typed) !== typedMetadata(column.typed!)) fail('INVALID_RESULT_CSV', '결과 신호의 자료형·형상·스케일·열거 선언은 샘플마다 같아야 합니다.');
        if (current.typed) yield* typedCsvValues(current.typed); else yield* flattenSignal(sample.values[column.id]!);
      }
    }
    addLine(sampleCells());
  }
  return lines.join('');
}
