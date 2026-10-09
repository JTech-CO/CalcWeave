import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { ModelError, type CalcModel, type SignalValue } from '../packages/model/src';
import { sha256 } from '../packages/model/src/sha256';
import type { ControlAnalysisRun } from '../apps/web/src/control-analysis-sources';
import { defaultTimeSeriesDraft, readCorrelationSelection, readTimeSeriesSelection, timeSeriesAnalysisSources, timeSeriesDraftSelection, TIME_SERIES_SOURCE_LIMITS } from '../apps/web/src/time-series-analysis-sources';

function constantModel(value: SignalValue = 2, count = 32): CalcModel {
  return { schemaVersion: 1, modelId: 'm24-observed', name: '시계열 원시 기록',
    execution: { mode: 'discrete', startTime: 0, stopTime: (count - 1) / 32, step: 1 / 32 },
    nodes: [{ id: 'input', blockType: typeof value === 'object' && !Array.isArray(value) ? 'source.typed' : 'source.constant', blockVersion: 1, label: '기록 입력', parameters: { value } },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '기록 출력', parameters: {} }],
    edges: [{ id: 'record', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }], layout: {} };
}
async function execute(model = constantModel()): Promise<ControlAnalysisRun> {
  const compiled = compileModel(model);
  return { model: structuredClone(compiled.model), result: await runModel(compiled), semanticHash: sha256(compiled.semanticKey) };
}
async function waveRecord(yUnit = '1'): Promise<ControlAnalysisRun> {
  const model = constantModel();
  model.nodes[0] = { id: 'input', blockType: 'source.sine-wave', blockVersion: 1, label: '사인 입력', unit: '1', parameters: { amplitude: 2, frequency: 3, phase: .25, bias: 3 } };
  model.nodes.push({ id: 'other', blockType: 'source.constant', blockVersion: 1, label: '두 번째 입력', unit: yUnit, parameters: { value: -7 } },
    { id: 'y', blockType: 'sink.scope', blockVersion: 1, label: '두 번째 출력', parameters: {} });
  model.edges.push({ id: 'other-y', source: { nodeId: 'other', portId: 'out' }, target: { nodeId: 'y', portId: 'in' } });
  return execute(model);
}
function expectCode(action: () => unknown, code: string): void {
  try { action(); throw new Error('Expected a validation error'); } catch (error) {
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).diagnostics[0]?.code).toBe(code);
  }
}

describe('M24 completed raw time-series sources and immutable selections', () => {
  it('offers actual completed records and their full SHA-256, labels, units, shape and components', async () => {
    const run = await execute(), original = structuredClone(run), available = timeSeriesAnalysisSources(run);
    expect(available.issues).toEqual([]); expect(available.sources).toHaveLength(1);
    expect(available.sources[0]).toMatchObject({ outputId: 'scope', sampleCount: 32, unit: '1', runStatus: 'completed', modelName: constantModel().name,
      semanticHash: sha256(compileModel(run.model).semanticKey), shape: [], components: [{ index: 0, label: '값' }] });
    expect(run).toEqual(original); expect(available.sources[0]!.semanticHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('captures actual stored waveform samples, including a non-power-of-two segment, without recomputation', async () => {
    const run = await waveRecord(), original = structuredClone(run), capture = readTimeSeriesSelection(run, 'scope', 0, 7, 13);
    const observed = run.result.samples.slice(7, 20);
    expect(capture.input.times).toEqual(observed.map(sample => sample.time));
    expect(capture.input.values).toEqual(observed.map(sample => sample.values.scope));
    expect(capture.input.values[3]).toBe(3 + 2 * Math.sin(2 * Math.PI * 3 * observed[3]!.time + .25));
    expect(capture.source).toMatchObject({ startIndex: 7, count: 13, startTime: 7 / 32, endTime: 19 / 32, componentIndex: 0, semanticHash: run.semanticHash });
    expect(capture.source.samplesSha256).toBe(sha256(JSON.stringify(capture.input))); expect(run).toEqual(original);
    for (const value of [capture.input, capture.input.times, capture.input.values, capture.source, capture.source.components, capture.source.components[0], capture.source.shape]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => { capture.input.values[0] = 99; }).toThrow(TypeError);
    expect(() => { capture.source.components[0]!.label = 'edited'; }).toThrow(TypeError);
    run.result.samples[7]!.values.scope = 77;
    expect(capture.input.values[0]).toBe(original.result.samples[7]!.values.scope);
  });
  it.each([2, 3, 7, 12, 31, 32])('accepts any explicit integer sample count %s', async count => {
    const run = await execute(); expect(readTimeSeriesSelection(run, 'scope', 0, 32 - count, count).input.values).toHaveLength(count);
  });
  it.each([{ value: [2, 4], label: '[2]' }, { value: [[2, 4], [6, 8]], label: '[1, 2]' }])('projects row-major legacy real components $value', async ({ value, label }) => {
    const run = await execute(constantModel(value as SignalValue));
    const selected = readTimeSeriesSelection(run, 'scope', 1, 5, 9);
    expect(selected.input.values).toEqual(Array(9).fill(4)); expect(selected.source.componentLabel).toBe(label);
    const pair = readCorrelationSelection(run, 'scope', 0, 'scope', 1, 5, 9);
    expect(pair.input).toEqual({ times: selected.input.times, x: Array(9).fill(2), y: Array(9).fill(4) });
  });
  it.each(['float32', 'float64'] as const)('decodes typed %s real components without changing the wire recording', async dtype => {
    const value = { kind: 'typed' as const, dtype, shape: [2], data: [1.25, -2.5] }, run = await execute(constantModel(value));
    const selected = readTimeSeriesSelection(run, 'scope', 1, 0, 7);
    expect(selected.input.values).toEqual(Array(7).fill(-2.5)); expect(run.result.samples[0]!.values.scope).toEqual(value);
    expect(selected.source).toMatchObject({ valueType: 'typed', shape: [2] });
  });
  it('preserves typed negative zero as a real IEEE value', async () => {
    const run = await execute(constantModel({ kind: 'typed', dtype: 'float64', shape: [], data: ['-0'] }));
    const negative = readTimeSeriesSelection(run, 'scope', 0, 0, 2);
    expect(Object.is(negative.input.values[0], -0)).toBe(true);
    expect(negative.source.samplesSha256).toBe(sha256(JSON.stringify({ times: [0, 1 / 32], values: ['-0', '-0'] })));
    // Same model/run provenance but a changed raw IEEE sign must change the selected-sample checksum.
    const changed = structuredClone(run);
    changed.result.samples[0].values.scope = { kind: 'typed', dtype: 'float64', shape: [], data: [0] };
    const positive = readTimeSeriesSelection(changed, 'scope', 0, 0, 2);
    expect(Object.is(positive.input.values[0], 0)).toBe(true);
    expect(positive.source.samplesSha256).not.toBe(negative.source.samplesSha256);
  });
  it.each(['int64', 'uint64', 'boolean', 'complex128', 'string'] as const)('never silently casts typed %s', async dtype => {
    const data = dtype === 'boolean' ? [true] : dtype === 'complex128' ? [{ re: 1, im: 2 }] : dtype === 'string' ? ['text'] : ['1'];
    const run = await execute(constantModel({ kind: 'typed', dtype, shape: [], data } as SignalValue));
    expect(timeSeriesAnalysisSources(run).sources).toEqual([]); expect(timeSeriesAnalysisSources(run).issues.join()).toContain('자동 변환');
    expectCode(() => readTimeSeriesSelection(run, 'scope', 0, 0, 2), 'TIME_SERIES_SOURCE');
  });
  it('rejects rank-two typed signals while legacy real matrices remain available', async () => {
    const run = await execute(constantModel({ kind: 'typed', dtype: 'float64', shape: [1, 2], data: [1, 2] }));
    expect(timeSeriesAnalysisSources(run).sources).toEqual([]);
  });
  it('explains unavailable recordings without executing a new model', () => {
    expect(timeSeriesAnalysisSources(null)).toEqual({ sources: [], issues: ['시간 시뮬레이션을 완료한 뒤 기록의 시계열을 분석하세요.'] });
  });
  it.each(['failed', 'cancelled'] as const)('rejects %s records even if all samples look complete', async status => {
    const run = await execute(); run.result.status = status;
    expect(timeSeriesAnalysisSources(run).sources).toEqual([]); expect(timeSeriesAnalysisSources(run).issues.join()).toContain('완료된 실행');
  });
  it('rejects static records and one-sample time records', async () => {
    const model = constantModel(); model.execution = { mode: 'static', startTime: 0, stopTime: 0, step: 1 };
    expect(timeSeriesAnalysisSources(await execute(model)).sources).toEqual([]);
    expect(timeSeriesAnalysisSources(await execute(constantModel(2, 1))).sources).toEqual([]);
  });
  it('rejects either a forged full fingerprint or an edited recorded model', async () => {
    const forged = await execute(); forged.semanticHash = '0'.repeat(64);
    expect(timeSeriesAnalysisSources(forged).issues.join()).toContain('계산 지문');
    const edited = await execute(); edited.model.nodes[0]!.parameters.value = 4;
    expect(timeSeriesAnalysisSources(edited).issues.join()).toContain('계산 지문');
  });
  it('requires the exact completed count and full recorded-model observation grid', async () => {
    const wrongCount = await execute(); wrongCount.result.steps--;
    expect(timeSeriesAnalysisSources(wrongCount).sources).toEqual([]);
    const shortened = await execute(); shortened.result.samples.pop(); shortened.result.steps--;
    expect(timeSeriesAnalysisSources(shortened).issues.join()).toContain('시간 격자');
    const shifted = await execute(); shifted.result.samples[9]!.time += .001;
    expect(timeSeriesAnalysisSources(shifted).issues.join()).toContain('관측 격자');
    expectCode(() => readCorrelationSelection(shifted, 'scope', 0, 'scope', 0, 0, 16), 'TIME_SERIES_SOURCE');
  });
  it('checks every recorded sample shape, not just the chosen short interval', async () => {
    const run = await execute(constantModel([1, 2])); run.result.samples[25]!.values.scope = [1];
    expect(timeSeriesAnalysisSources(run).sources).toEqual([]);
    expectCode(() => readTimeSeriesSelection(run, 'scope', 0, 0, 2), 'TIME_SERIES_SOURCE');
  });
  it.each([NaN, Infinity, -Infinity])('rejects selected nonfinite %s without deleting or interpolating samples', async value => {
    const run = await execute(); run.result.samples[9]!.values.scope = value;
    expect(() => readTimeSeriesSelection(run, 'scope', 0, 0, 13)).toThrow(/비유한/);
    expect(readTimeSeriesSelection(run, 'scope', 0, 16, 13).input.values).toEqual(Array(13).fill(2));
  });
  it.each(['NaN', 'Infinity', '-Infinity'] as const)('rejects a selected typed IEEE %s gap', async tag => {
    const run = await execute(constantModel({ kind: 'typed', dtype: 'float64', shape: [], data: [tag] }));
    expect(() => readTimeSeriesSelection(run, 'scope', 0, 0, 2)).toThrow(/비유한/);
  });
  it.each([[0, 0, 1], [0, 0, 8193], [2, 0, 2], [0, 31, 2], [0, -1, 2], [0, .5, 2], [0, 0, NaN], [0, Infinity, 2]])('rejects invalid explicit selection %j', async (component, start, count) => {
    const run = await execute(); expectCode(() => readTimeSeriesSelection(run, 'scope', component, start, count), 'TIME_SERIES_SOURCE');
  });
  it('captures both actual output series and their separate provenance on exactly shared raw timestamps', async () => {
    const run = await waveRecord(), pair = readCorrelationSelection(run, 'scope', 0, 'y', 0, 7, 13);
    expect(pair.input.times).toEqual(run.result.samples.slice(7, 20).map(sample => sample.time));
    expect(pair.input.x).toEqual(run.result.samples.slice(7, 20).map(sample => sample.values.scope));
    expect(pair.input.y).toEqual(Array(13).fill(-7));
    expect(pair.xSource.samplesSha256).toBe(sha256(JSON.stringify({ times: pair.input.times, values: pair.input.x })));
    expect(pair.ySource.samplesSha256).toBe(sha256(JSON.stringify({ times: pair.input.times, values: pair.input.y })));
    expect(pair.xSource.semanticHash).toBe(run.semanticHash); expect(pair.ySource.semanticHash).toBe(run.semanticHash);
    for (const value of [pair.input, pair.input.times, pair.input.x, pair.input.y]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => pair.input.y.push(10)).toThrow(TypeError);
  });
  it('rejects mismatched units rather than silently converting them', async () => {
    const run = await waveRecord('V');
    expect(timeSeriesAnalysisSources(run).sources.map(source => source.unit)).toEqual(['1', 'V']);
    expect(() => readCorrelationSelection(run, 'scope', 0, 'y', 0, 0, 13)).toThrow(/같은 단위/);
  });
  it('bounds the combined projections, including two components from the same full recording', async () => {
    const run = await execute(constantModel(Array(512).fill(2), 1300));
    expect(readTimeSeriesSelection(run, 'scope', 0, 0, 2).input.values).toEqual([2, 2]);
    expect(() => readCorrelationSelection(run, 'scope', 0, 'scope', 1, 0, 2)).toThrow(/1,000,000/);
    expect(readCorrelationSelection(run, 'scope', 0, 'scope', 0, 0, 2).input.x).toEqual([2, 2]);
    expect(TIME_SERIES_SOURCE_LIMITS).toEqual({ sources: 16, recordedElements: 1_000_000 }); expect(Object.isFrozen(TIME_SERIES_SOURCE_LIMITS)).toBe(true);
  });
  it('offers at most sixteen actual outputs with a bounded diagnostic', async () => {
    const model = constantModel(2, 2);
    for (let index = 0; index < 16; index++) {
      const id = `view-${index}`;
      model.nodes.push({ id, blockType: 'sink.scope', blockVersion: 1, label: id, parameters: {} });
      model.edges.push({ id: `record-${index}`, source: { nodeId: 'input', portId: 'out' }, target: { nodeId: id, portId: 'in' } });
    }
    const run = await execute(model), available = timeSeriesAnalysisSources(run);
    expect(available.sources).toHaveLength(16); expect(available.issues.join()).toContain('최대 16');
    const excluded = Object.keys(run.result.samples[0]!.values).find(id => !available.sources.some(source => source.outputId === id))!;
    expect(excluded).toBeDefined(); expectCode(() => readTimeSeriesSelection(run, excluded, 0, 0, 2), 'TIME_SERIES_SOURCE');
  });
  it.each(['run', 'result', 'sample', 'values', 'legacy-array', 'typed-data'] as const)('rejects %s getters without executing them', async target => {
    const run = await execute(constantModel(target === 'legacy-array' ? [1, 2] : target === 'typed-data' ? { kind: 'typed', dtype: 'float64', shape: [2], data: [1, 2] } : 2));
    let calls = 0;
    const holder = target === 'run' ? run : target === 'result' ? run.result : target === 'sample' ? run.result.samples[0]! : target === 'values' ? run.result.samples[0]!.values
      : target === 'legacy-array' ? run.result.samples[0]!.values.scope as number[] : (run.result.samples[0]!.values.scope as { data: unknown[] }).data;
    const key = target === 'run' ? 'result' : target === 'result' ? 'samples' : target === 'sample' ? 'time' : target === 'values' ? 'scope' : '0';
    Object.defineProperty(holder, key, { enumerable: true, get() { calls++; throw new Error('getter'); } });
    expect(timeSeriesAnalysisSources(run).sources).toEqual([]); expect(calls).toBe(0);
  });
  it.each(['sample-sparse', 'sample-extra', 'sample-prototype', 'value-extra', 'signal-sparse', 'signal-extra', 'signal-prototype', 'dangerous-key'] as const)('rejects malformed %s records', async kind => {
    const run = await execute(constantModel([1, 2]));
    if (kind === 'sample-sparse') delete run.result.samples[0];
    if (kind === 'sample-extra') Object.defineProperty(run.result.samples, 'extra', { enumerable: true, value: 0 });
    if (kind === 'sample-prototype') Object.setPrototypeOf(run.result.samples[0]!, { time: 0 });
    if (kind === 'value-extra') run.result.samples[0]!.values.extra = 1;
    if (kind === 'signal-sparse') delete (run.result.samples[0]!.values.scope as number[])[0];
    if (kind === 'signal-extra') Object.defineProperty(run.result.samples[0]!.values.scope, 'extra', { enumerable: true, value: 0 });
    if (kind === 'signal-prototype') Object.setPrototypeOf(run.result.samples[0]!.values.scope, null);
    if (kind === 'dangerous-key') Object.defineProperty(run, '__proto__', { enumerable: true, value: {} });
    expect(timeSeriesAnalysisSources(run).sources).toEqual([]);
  });
});

describe('M24 bounded time-series text drafts', () => {
  const draft = { startIndex: '0', count: '13', maxLag: '6', minOverlap: '7' };
  it('defaults to an explicit bounded interval, lag and overlap', () => {
    expect(defaultTimeSeriesDraft(32)).toEqual({ startIndex: '0', count: '32', maxLag: '31', minOverlap: '16' });
    expect(defaultTimeSeriesDraft(10001)).toEqual({ startIndex: '0', count: '1024', maxLag: '32', minOverlap: '512' });
    expect(defaultTimeSeriesDraft(2)).toEqual({ startIndex: '0', count: '2', maxLag: '1', minOverlap: '2' });
    expect(defaultTimeSeriesDraft(0)).toEqual({ startIndex: '0', count: '0', maxLag: '0', minOverlap: '0' });
  });
  it('accepts integers with trimmed whitespace and non-power-of-two sample counts', () => {
    expect(timeSeriesDraftSelection(draft, 32)).toEqual({ startIndex: 0, count: 13, maxLag: 6, minOverlap: 7 });
    expect(timeSeriesDraftSelection({ startIndex: ' 19 ', count: '13', maxLag: ' 12 ', minOverlap: '2' }, 32)).toEqual({ startIndex: 19, count: 13, maxLag: 12, minOverlap: 2 });
    expect(timeSeriesDraftSelection({ startIndex: '0', count: '8192', maxLag: '512', minOverlap: '8192' }, 10001)).toEqual({ startIndex: 0, count: 8192, maxLag: 512, minOverlap: 8192 });
  });
  for (const field of ['startIndex', 'count', 'maxLag', 'minOverlap'] as const) {
    it.each(['', '-1', '.5', '1.0', '0x10', '1e1', '01', '+1', 'Infinity', 'NaN', '1x', 'alert(1)', '9007199254740992', '1'.repeat(101)])(`rejects invalid ${field} text %s`, value => {
      expectCode(() => timeSeriesDraftSelection({ ...draft, [field]: value }, 32), 'TIME_SERIES_DRAFT');
    });
  }
  it.each([{ startIndex: '20' }, { count: '1' }, { count: '8193' }, { maxLag: '13' }, { maxLag: '513' }, { minOverlap: '1' }, { minOverlap: '14' }])('rejects out-of-range draft %j', patch => {
    expectCode(() => timeSeriesDraftSelection({ ...draft, ...patch }, 32), 'TIME_SERIES_DRAFT');
  });
  it.each([0, 1, -1, 1.5, Infinity, NaN, 10002])('rejects invalid recorded count %s', count => {
    expectCode(() => timeSeriesDraftSelection(draft, count), 'TIME_SERIES_DRAFT');
  });
  it('rejects draft accessors, unexpected keys and prototypes without invoking hooks', () => {
    let calls = 0; const accessor = { ...draft };
    Object.defineProperty(accessor, 'count', { enumerable: true, get() { calls++; return '13'; } });
    expectCode(() => timeSeriesDraftSelection(accessor, 32), 'TIME_SERIES_DRAFT'); expect(calls).toBe(0);
    expectCode(() => timeSeriesDraftSelection({ ...draft, extra: 'x' } as typeof draft, 32), 'TIME_SERIES_DRAFT');
    expectCode(() => timeSeriesDraftSelection(Object.create(draft) as typeof draft, 32), 'TIME_SERIES_DRAFT');
  });
});
