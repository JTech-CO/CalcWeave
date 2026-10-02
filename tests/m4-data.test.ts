import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DATASET_LIMITS, ModelError, canonicalSemantic, conversionCoefficients, datasetContentHash,
  divideUnits, multiplyUnits, parseModel, parseModelJson, reciprocalUnit, serializeModel,
  sha256, sqrtUnit, squareUnit, validateDataset, type CalcModel, type Dataset, type RunResult,
} from '../packages/model/src';
import { datasetSeries, exportDatasetCsv, exportResultCsv, importDataset, inspectDatasetInput, safeCsvCell, type DatasetImportOptions } from '../packages/data/src';

const options: DatasetImportOptions = { id: 'measurements', name: '측정 자료', format: 'csv', timeColumn: 'time', columns: [{ name: 'time', kind: 'number', unit: 's' }, { name: 'value', kind: 'number', unit: 'm' }] };
const csv = 'time,value\r\n0,2\r\n1,4\r\n';
function model(): CalcModel { return { schemaVersion: 1, modelId: 'test', name: '모델', nodes: [{ id: 'input', blockType: 'source.constant', blockVersion: 1, label: '입력', parameters: { value: 1 } }], edges: [], execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, layout: { input: { x: 0, y: 0 } } }; }
function code(action: () => unknown, expected: string): void {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some((item) => item.code === expected)).toBe(true); return; }
  throw new Error(`Expected ${expected}`);
}
function refreshed(dataset: Dataset): Dataset { dataset.contentHash = datasetContentHash(dataset); return dataset; }

describe('M4 bounded local dataset import', () => {
  it('retains separate source and normalized hashes with defensive typed rows', () => {
    const dataset = importDataset(csv, options);
    expect(dataset.rows).toEqual([[0, 2], [1, 4]]);
    expect(dataset.sourceHash).toBe(createHash('sha256').update(csv).digest('hex'));
    expect(dataset.contentHash).toBe(datasetContentHash(dataset));
    const copy = validateDataset(dataset); dataset.rows[0]![1] = 99;
    expect(copy.rows[0]![1]).toBe(2);
    const another = importDataset(csv.replaceAll('\r\n', '\n'), { ...options, name: '다른 이름', version: 2 });
    expect(another.contentHash).toBe(copy.contentHash);
    expect(another.sourceHash).not.toBe(copy.sourceHash);
  });
  it('parses BOM, CRLF, quoted comma/newline/escaped quote and typed boolean', () => {
    const dataset = importDataset('\ufefftime,text,flag\r\n0,"a,b",true\r\n1,"line\r\n""two""",FALSE\r\n', { ...options, columns: [{ name: 'time', kind: 'number', unit: 's' }, { name: 'text', kind: 'string', unit: '1' }, { name: 'flag', kind: 'boolean', unit: '1' }] });
    expect(dataset.rows).toEqual([[0, 'a,b', true], [1, 'line\r\n"two"', false]]);
  });
  it('accepts row-record JSON, explicit reordered columns and exponent decimals', () => {
    const dataset = importDataset('[{"value":"2.5e1","time":0},{"time":1,"value":-2}]', { ...options, format: 'json', columns: [...options.columns].reverse() });
    expect(dataset.rows).toEqual([[25, 0], [-2, 1]]);
    expect(datasetSeries(dataset, 'value')).toEqual({ times: [0, 1], values: [25, -2], kind: 'number', unit: 'm' });
  });
  it('previews only five rows after validating the entire table structure', () => {
    const text = 'time,value\n' + Array.from({ length: 8 }, (_, i) => `${i},${i}`).join('\n');
    expect(inspectDatasetInput(text, 'csv')).toEqual({ columnNames: ['time', 'value'], sampleRows: [["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]], rowCount: 8 });
    code(() => inspectDatasetInput(text + '\n9,3,4', 'csv'), 'INVALID_DATASET_ROW');
  });
  it('cleans string whitespace/case only when explicitly selected', () => {
    const textOptions: DatasetImportOptions = { ...options, columns: [options.columns[0]!, { name: 'value', kind: 'string', unit: '1' }] };
    expect(importDataset('time,value\n0, HELLO ', textOptions).rows[0]![1]).toBe(' HELLO ');
    expect(importDataset('time,value\n0, HELLO ', { ...textOptions, trimStrings: true, lowercaseStrings: true }).rows[0]![1]).toBe('hello');
    code(() => datasetSeries(importDataset('time,value\n0,hi', textOptions), 'value'), 'DATASET_STRING_SIGNAL_UNSUPPORTED');
  });
  it('requires explicit missing handling and limits zero replacement to non-time numeric columns', () => {
    code(() => importDataset('time,value\n0,\n1,4', options), 'MISSING_DATASET_CELL');
    expect(importDataset('time,value\n0,\n1,4', { ...options, missing: 'zero' }).rows).toEqual([[0, 0], [1, 4]]);
    expect(importDataset('[{"time":0},{"time":1,"value":4}]', { ...options, format: 'json', missing: 'drop-row' }).rows).toEqual([[1, 4]]);
    code(() => importDataset('time,value\n,2\n1,4', { ...options, missing: 'zero' }), 'MISSING_DATASET_CELL');
    code(() => importDataset('time,value\n0,\n1,true', { ...options, missing: 'zero', columns: [options.columns[0]!, { name: 'value', kind: 'boolean', unit: '1' }] }), 'MISSING_DATASET_CELL');
  });
  it('does not sort or remove duplicate times by default', () => {
    code(() => importDataset('time,value\n1,4\n0,2', options), 'INVALID_DATASET_TIME');
    expect(importDataset('time,value\n1,4\n0,2', { ...options, sortTime: true }).rows).toEqual([[0, 2], [1, 4]]);
    code(() => importDataset('time,value\n0,2\n0,3', options), 'DUPLICATE_DATASET_TIME');
    expect(importDataset('time,value\n0,2\n0,3\n1,4', { ...options, duplicateTimes: 'keep-first' }).rows).toEqual([[0, 2], [1, 4]]);
    expect(importDataset('time,value\n0,2\n0,3\n1,4', { ...options, duplicateTimes: 'keep-last' }).rows).toEqual([[0, 3], [1, 4]]);
  });
  it('normalizes ms/min time coordinates to seconds while preserving original table metadata', () => {
    for (const [unit, factor] of [['ms', 0.001], ['min', 60]] as const) {
      const dataset = importDataset('time,value\n0,2\n10,4', { ...options, columns: [{ ...options.columns[0]!, unit }, options.columns[1]!] });
      expect(datasetSeries(dataset, 'value').times).toEqual([0, 10 * factor]);
      expect(dataset.rows[1]![0]).toBe(10);
    }
  });
  it.each(['Infinity', 'NaN', '1e999', '0x10', '12px', 'true'])('rejects invalid numeric value %s without guessing', (value) => {
    expect(() => importDataset(`time,value\n0,${value}`, options)).toThrow(ModelError);
  });
  it.each(['time,value\n0,"open', 'time,value\n0,a"b', 'time,value\n0,"2"x', 'time,time\n0,2', 'time,__proto__\n0,2'])('rejects malformed or unsafe CSV %s', (value) => {
    expect(() => importDataset(value, options)).toThrow(ModelError);
  });
  it.each(['[{"time":0,"value":{"nested":2}}]', '[{"time":0,"value":1},{"time":1,"value":2,"extra":4}]', '[{"time":0,"__proto__":2}]'])('rejects nested/unmapped/unsafe JSON %s', (value) => {
    expect(() => importDataset(value, { ...options, format: 'json' })).toThrow(ModelError);
  });
  it('enforces text bytes, row/column/cell limits and cell text length', () => {
    code(() => inspectDatasetInput('한'.repeat(Math.ceil(DATASET_LIMITS.maxBytes / 3)), 'csv'), 'DATASET_TOO_LARGE');
    code(() => inspectDatasetInput('time,value\n' + Array.from({ length: 4001 }, (_, i) => `${i},2`).join('\n'), 'csv'), 'DATASET_RESOURCE_LIMIT');
    code(() => inspectDatasetInput(Array.from({ length: 17 }, (_, i) => `c${i}`).join(',') + '\n' + Array(17).fill('1').join(','), 'csv'), 'DATASET_RESOURCE_LIMIT');
    code(() => inspectDatasetInput(Array.from({ length: 6 }, (_, i) => `c${i}`).join(',') + '\n' + Array.from({ length: 3400 }, () => '0,1,2,3,4,5').join('\n'), 'csv'), 'DATASET_RESOURCE_LIMIT');
    code(() => inspectDatasetInput('time,value\n0,' + 'x'.repeat(1001), 'csv'), 'INVALID_DATASET_CELL');
  });
  it('checks integrity on model object/JSON import and never invokes dataset accessors', () => {
    const dataset = importDataset(csv, options), input = { ...model(), datasets: [dataset] };
    expect(parseModelJson(serializeModel(input)).datasets).toEqual([dataset]);
    dataset.rows[0]![1] = 9;
    code(() => parseModel(input), 'DATASET_HASH_MISMATCH');
    const unsafe = importDataset(csv, options); let invoked = false;
    Object.defineProperty(unsafe, 'rows', { enumerable: true, get() { invoked = true; throw new Error('accessor'); } });
    code(() => validateDataset(unsafe), 'UNSAFE_FIELD'); expect(invoked).toBe(false);
  });
  it('rejects non-finite cells, time-unit mistakes and false hash types', () => {
    const dataset = importDataset(csv, options); dataset.rows[0]![1] = Infinity;
    code(() => validateDataset(dataset), 'NONFINITE_DATASET');
    const wrongUnit = importDataset(csv, options); wrongUnit.columns[0]!.unit = 'm';
    code(() => validateDataset(refreshed(wrongUnit)), 'INVALID_DATASET_TIME');
    const badHash = importDataset(csv, options); (badHash as unknown as Record<string, unknown>).sourceHash = Array(64).fill('a');
    code(() => validateDataset(badHash), 'INVALID_DATASET_HASH');
  });
  it('validates cleanup option types and rejects mapping accessors before invoking them', () => {
    code(() => importDataset(csv, { ...options, sortTime: 'false' } as unknown as DatasetImportOptions), 'INVALID_DATASET_OPTIONS');
    let invoked = false;
    const unsafe = { ...options, columns: options.columns.map((column) => ({ ...column })) };
    Object.defineProperty(unsafe.columns[0]!, 'kind', { enumerable: true, get() { invoked = true; return 'number'; } });
    code(() => importDataset(csv, unsafe), 'INVALID_DATASET_OPTIONS'); expect(invoked).toBe(false);
  });
});

describe('M4 semantic extensions and bounded dashboard metadata', () => {
  it('includes dataset content/revision while excluding names/dashboard/notes/layout', () => {
    const input = { ...model(), datasets: [importDataset(csv, options)] };
    const before = canonicalSemantic(input);
    input.datasets[0]!.name = '새 이름'; input.name = '제목'; input.layout.input!.x = 50; input.notes = '설명'; input.dashboard = [{ id: 'view', kind: 'display', title: '값', nodeId: 'input' }];
    expect(canonicalSemantic(input)).toBe(before);
    input.datasets[0]!.version++; expect(canonicalSemantic(input)).not.toBe(before);
  });
  it('includes subsystem graphs/versions but excludes definition presentation and insertion order', () => {
    const input: CalcModel = { ...model(), subsystems: [{ id: 'helper', version: 1, name: '내부', nodes: [...model().nodes], edges: [], layout: { input: { x: 0, y: 0 } }, inputs: [{ id: 'in', nodeId: 'input' }], outputs: [] }] };
    const before = canonicalSemantic(input);
    input.subsystems![0]!.name = '이름'; input.subsystems![0]!.nodes[0]!.label = '변경'; input.subsystems![0]!.layout.input!.x = 100;
    expect(canonicalSemantic(input)).toBe(before);
    input.subsystems![0]!.version++; expect(canonicalSemantic(input)).not.toBe(before);
  });
  it('rejects duplicate data IDs, unknown dashboard targets and invalid ranges', () => {
    const dataset = importDataset(csv, options);
    code(() => parseModel({ ...model(), datasets: [dataset, dataset] }), 'DUPLICATE_DATASET_ID');
    code(() => parseModel({ ...model(), dashboard: [{ id: 'bad', kind: 'display', title: '', nodeId: 'missing' }] }), 'UNKNOWN_DASHBOARD_NODE');
    code(() => parseModel({ ...model(), dashboard: [{ id: 'bad', kind: 'slider', title: '', nodeId: 'input', parameter: 'value', min: 1, max: 0 }] }), 'INVALID_DASHBOARD_RANGE');
    code(() => parseModel({ ...model(), notes: 'x'.repeat(2001) }), 'INVALID_MODEL');
  });
  it('round-trips all optional M4 fields while retaining schema version one', () => {
    const input: CalcModel = { ...model(), datasets: [importDataset(csv, options)], subsystems: [], notes: '기억할 설정', dashboard: [{ id: 'slider', kind: 'slider', title: '입력', nodeId: 'input', parameter: 'value', min: 0, max: 10, step: 0.1 }] };
    expect(parseModelJson(serializeModel(input))).toEqual(input);
  });
  it('excludes annotation nodes from root and definition execution semantics', () => {
    const input: CalcModel = { ...model(), subsystems: [{ id: 'helper', version: 1, name: '내부', nodes: [...model().nodes], edges: [], layout: {}, inputs: [], outputs: [] }] };
    const before = canonicalSemantic(input);
    input.nodes.push({ id: 'note', blockType: 'annotation.note', blockVersion: 1, label: '메모', parameters: { text: '<script>ordinary text</script>' } });
    input.subsystems![0]!.nodes.push({ id: 'info', blockType: 'annotation.model-info', blockVersion: 1, label: '', parameters: {} });
    expect(canonicalSemantic(input)).toBe(before);
    input.nodes.at(-1)!.parameters.text = '변경'; expect(canonicalSemantic(input)).toBe(before);
  });
});

describe('M4 explicit approved unit algebra', () => {
  it('converts compatible dimensions with scale/offset and retains temperature/angle dimensions', () => {
    expect(conversionCoefficients('cm', 'm')).toEqual({ scale: 0.01, offset: 0 });
    expect(conversionCoefficients('mV', 'V')).toEqual({ scale: 0.001, offset: 0 });
    expect(conversionCoefficients('C', 'K')).toEqual({ scale: 1, offset: 273.15 });
    expect(conversionCoefficients('K', 'C')).toEqual({ scale: 1, offset: -273.15 });
    expect(conversionCoefficients('deg', 'rad').scale * 180).toBeCloseTo(Math.PI, 15);
    code(() => conversionCoefficients('m', 's'), 'UNIT_MISMATCH');
    code(() => conversionCoefficients('rad', '1'), 'UNIT_MISMATCH');
    code(() => conversionCoefficients('constructor', 'm'), 'UNSUPPORTED_UNIT');
  });
  it('computes approved dimensions without dropping scale or offset', () => {
    expect(squareUnit('m')).toBe('m^2'); expect(sqrtUnit('m^2')).toBe('m');
    expect(divideUnits('m', 's')).toBe('m/s'); expect(divideUnits('m/s', 's')).toBe('m/s^2');
    expect(multiplyUnits('N', 'm')).toBe('J'); expect(divideUnits('J', 's')).toBe('W');
    expect(reciprocalUnit('s')).toBe('Hz'); expect(reciprocalUnit('Hz')).toBe('s');
    expect(divideUnits('cm', 'cm')).toBe('1');
    code(() => squareUnit('cm'), 'UNIT_OPERATION_UNSUPPORTED');
    code(() => multiplyUnits('C', '1'), 'UNIT_OPERATION_UNSUPPORTED');
    code(() => sqrtUnit('s'), 'UNIT_OPERATION_UNSUPPORTED');
  });
});

describe('M4 safe CSV and portable SHA-256', () => {
  it.each(['', 'abc', '한글🙂', '\ud800'])('hashes UTF8 consistently with Node for %s', (text) => {
    expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
  });
  it('escapes quoted data and neutralizes string formula prefixes without changing negative numbers', () => {
    expect(safeCsvCell('a,"b"')).toBe('"a,""b"""');
    for (const text of ['=HYPERLINK("x")', '+cmd', '-1+2', '@SUM(A1)', '  =1', '\tformula']) expect(safeCsvCell(text).startsWith("'") || safeCsvCell(text).startsWith('"\'')).toBe(true);
    expect(safeCsvCell(-2)).toBe('-2');
    const dataset = importDataset('time,value\n0,"=1+1"', { ...options, columns: [options.columns[0]!, { name: 'value', kind: 'string', unit: '1' }] });
    expect(exportDatasetCsv(dataset)).toContain("'=1+1");
  });
  it('exports all samples with deterministic row-major signal columns and safe labels', () => {
    const result: RunResult = { samples: [{ time: 0, values: { z: false, a: [[1, 2], [3, 4]] } }, { time: 1, values: { z: true, a: [[5, 6], [7, 8]] } }], finalState: {}, status: 'completed', elapsedMs: 0, steps: 1 };
    expect(exportResultCsv(result, { z: '=value' })).toBe("time (s),a[0],a[1],a[2],a[3],'=value\r\n0,1,2,3,4,false\r\n1,5,6,7,8,true\r\n");
    result.samples[1]!.values.a = [1]; code(() => exportResultCsv(result), 'INVALID_RESULT_CSV');
  });
});
