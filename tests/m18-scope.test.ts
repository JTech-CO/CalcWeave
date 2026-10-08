import { describe, expect, it } from 'vitest';
import { nearestScopeSamples, normalizeScopeCoordinate, prepareScopeObservation, type ScopeObservationRun } from '../packages/analysis/src/scope-observation';
import { compileModel } from '../packages/compiler/src';
import type { RunSample, SignalDescriptor, SignalValue, TypedSignal } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { createExample } from '../apps/web/src/examples';

const sample = (time: number, value: SignalValue): RunSample => ({ time, values: { output: value } });
const run = (values: SignalValue[], extras: Partial<ScopeObservationRun> = {}): ScopeObservationRun => ({ id: 'run-1', label: '실행 1', samples: values.map((value, time) => sample(time, value)), ...extras });
const descriptor = (shape: number[] = [], unit = '1'): SignalDescriptor => ({ valueType: 'float64', shape, unit });
const typed = (dtype: TypedSignal['dtype'], data: TypedSignal['data'], shape: number[] = [], fixed?: TypedSignal['fixed']): TypedSignal => ({ kind: 'typed', dtype, shape, data, ...(fixed ? { fixed } : {}) });

describe('M18 raw Scope observation', () => {
  it('copies selected raw scalar observations without mutating input samples or declarations', () => {
    const input = run([0, -0, 2.5], { descriptor: descriptor([], 'V') });
    const before = structuredClone(input);
    const report = prepareScopeObservation([input], 'output');
    expect(report.status).toBe('ready');
    expect(report.unit).toBe('V');
    expect(report.domain).toEqual({ start: 0, end: 2 });
    expect(report.yDomain).toEqual({ minimum: -0, maximum: 2.5 });
    expect(report.components).toEqual([{ index: 0, label: '값' }]);
    expect(report.curves[0]!.points.map(point => point.exact)).toEqual(['0', '-0', '2.5']);
    expect(report.curves[0]!.approximate).toBe(false);
    expect(input).toEqual(before);
    report.curves[0]!.points[0]!.value = 99;
    expect(input.samples[0]!.values.output).toBe(0);
  });

  it('chooses vector components explicitly and labels them with one-based indices', () => {
    const report = prepareScopeObservation([run([[1, 10, 100], [2, 20, 200]], { descriptor: descriptor([3]) })], 'output', 1);
    expect(report.shape).toEqual([3]);
    expect(report.components.map(component => component.label)).toEqual(['[1]', '[2]', '[3]']);
    expect(report.curves[0]!.points.map(point => point.value)).toEqual([10, 20]);
  });

  it('chooses a matrix cell in explicit row-major order without silently flattening to component zero', () => {
    const report = prepareScopeObservation([run([[[1, 2, 3], [4, 5, 6]], [[7, 8, 9], [10, 11, 12]]])], 'output', 4);
    expect(report.shape).toEqual([2, 3]);
    expect(report.components[4]).toEqual({ index: 4, label: '[2, 2]' });
    expect(report.curves[0]!.points.map(point => point.value)).toEqual([5, 11]);
  });

  it('overlays at most three compatible runs with one common physical value axis', () => {
    const report = prepareScopeObservation([run([0, 10]), run([-5, 20], { id: 'run-2', label: '실행 2' }), run([100, 50], { id: 'run-3', label: '실행 3' })], 'output');
    expect(report.status).toBe('ready');
    expect(report.curves).toHaveLength(3);
    expect(report.yDomain).toEqual({ minimum: -5, maximum: 100 });
    expect(normalizeScopeCoordinate(report.curves[0]!.points[1]!.value!, -5, 100)).toBeCloseTo(1 / 7);
  });

  it.each([
    ['shape', run([[1, 2], [3, 4]], { id: 'other' })],
    ['unit', run([1, 2], { id: 'other', descriptor: descriptor([], 'm') })],
    ['type', run([typed('float64', [1]), typed('float64', [2])], { id: 'other' })],
  ])('blocks an entire misleading overlay with incompatible %s', (_name, other) => {
    const report = prepareScopeObservation([run([1, 2]), other], 'output');
    expect(report.status).toBe('incompatible');
    expect(report.curves).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
  });

  it('blocks shape and dtype changes inside a run rather than presenting a truncated compatible curve', () => {
    expect(prepareScopeObservation([run([1, [2]])], 'output').status).toBe('incompatible');
    expect(prepareScopeObservation([run([typed('float64', [1]), typed('float32', [2])])], 'output').status).toBe('incompatible');
    expect(prepareScopeObservation([run([1], { descriptor: descriptor([1]) })], 'output').status).toBe('incompatible');
  });

  it('keeps the chosen time window separate from the original observation domain and samples', () => {
    const input = run([0, 1, 2, 3, 4, 5]);
    const before = structuredClone(input);
    const report = prepareScopeObservation([input], 'output', 0, { start: 1.1, end: 3.9 });
    expect(report.domain).toEqual({ start: 0, end: 5 });
    expect(report.window).toEqual({ start: 1.1, end: 3.9 });
    expect(report.curves[0]!.points).toHaveLength(6);
    expect(report.curves[0]!.visiblePoints.map(point => point.time)).toEqual([2, 3]);
    expect(report.yDomain).toEqual({ minimum: 2, maximum: 3 });
    expect(input).toEqual(before);
  });

  it('does not decimate away a narrow raw peak among 10,001 samples', () => {
    const values = Array.from({ length: 10_001 }, (_, index) => index === 5_237 ? 12345 : 0);
    const report = prepareScopeObservation([run(values)], 'output');
    expect(report.status).toBe('ready');
    expect(report.curves[0]!.visiblePoints).toHaveLength(10_001);
    expect(report.curves[0]!.visiblePoints[5_237]!.value).toBe(12345);
    expect(report.yDomain.maximum).toBe(12345);
  });

  it('selects each run’s own nearest actual sample and retains the target time separately', () => {
    const report = prepareScopeObservation([
      run([10, 20, 30]),
      run([100, 200], { id: 'run-2', samples: [sample(0.1, 100), sample(1.9, 200)] }),
    ], 'output');
    const cursor = nearestScopeSamples(report, 1.2);
    expect(cursor.map(item => [item.targetTime, item.sampleTime, item.value])).toEqual([[1.2, 1, 20], [1.2, 1.9, 200]]);
    expect(cursor.map(item => item.sampleIndex)).toEqual([1, 1]);
  });

  it('chooses the earlier raw sample on a tie and never returns an interpolated value', () => {
    const report = prepareScopeObservation([run([0, 100], { samples: [sample(0, 0), sample(2, 100)] })], 'output');
    expect(nearestScopeSamples(report, 1)[0]).toMatchObject({ targetTime: 1, sampleTime: 0, sampleIndex: 0, value: 0 });
    expect(nearestScopeSamples(report, 2)[0]!.value).toBe(100);
    expect(nearestScopeSamples(report, -100)[0]!.sampleTime).toBe(0);
    expect(nearestScopeSamples(report, 100)[0]!.sampleTime).toBe(2);
  });

  it('restricts the cursor to raw observations in the chosen time window', () => {
    const report = prepareScopeObservation([run([0, 1, 2, 3, 4])], 'output', 0, { start: 1, end: 3 });
    expect(nearestScopeSamples(report, 0)[0]!.sampleTime).toBe(1);
    expect(nearestScopeSamples(report, 4)[0]!.sampleTime).toBe(3);
    const emptyInterval = prepareScopeObservation([run([0, 1, 2])], 'output', 0, { start: 0.2, end: 0.8 });
    expect(emptyInterval.status).toBe('ready');
    expect(emptyInterval.curves[0]!.visiblePoints).toEqual([]);
    expect(nearestScopeSamples(emptyInterval, 0.5)).toEqual([]);
    expect(emptyInterval.diagnostics).toHaveLength(1);
  });

  it('uses finite extreme time values without overflowing cursor distances', () => {
    const report = prepareScopeObservation([run([1, 2], { samples: [sample(-1e308, 1), sample(1e308, 2)] })], 'output');
    expect(nearestScopeSamples(report, 0)[0]!.sampleTime).toBe(-1e308);
    expect(nearestScopeSamples(report, 9e307)[0]!.sampleTime).toBe(1e308);
    const adjacent = prepareScopeObservation([run([1, 2], { samples: [sample(9.999999999999998e307, 1), sample(1e308, 2)] })], 'output');
    expect(nearestScopeSamples(adjacent, 1e308)[0]!.sampleTime).toBe(1e308);
  });

  it('normalizes ±1e308, the largest float, constant zero and subnormal axes safely', () => {
    expect(normalizeScopeCoordinate(-1e308, -1e308, 1e308)).toBe(0);
    expect(normalizeScopeCoordinate(0, -1e308, 1e308)).toBe(0.5);
    expect(normalizeScopeCoordinate(1e308, -1e308, 1e308)).toBe(1);
    expect(normalizeScopeCoordinate(0, -Number.MAX_VALUE, Number.MAX_VALUE)).toBe(0.5);
    expect(normalizeScopeCoordinate(0, 0, 0)).toBe(0.5);
    expect(normalizeScopeCoordinate(7, 7, 7)).toBe(0.5);
    expect(normalizeScopeCoordinate(Number.MIN_VALUE, 0, Number.MIN_VALUE)).toBe(1);
    expect(normalizeScopeCoordinate(NaN, 0, 1)).toBe(0.5);
  });

  it('keeps nonfinite samples as explicit gaps with their original exact tags', () => {
    const report = prepareScopeObservation([run([1, NaN, Infinity, -Infinity, 2])], 'output');
    expect(report.status).toBe('ready');
    expect(report.curves[0]!.points.map(point => point.value)).toEqual([1, null, null, null, 2]);
    expect(report.curves[0]!.points.map(point => point.exact)).toEqual(['1', 'NaN', 'Infinity', '-Infinity', '2']);
    expect(report.yDomain).toEqual({ minimum: 1, maximum: 2 });
    expect(nearestScopeSamples(report, 1)[0]).toMatchObject({ value: null, exact: 'NaN' });
  });

  it('retains int64 exact decimal codes beside an explicitly approximate numeric curve', () => {
    const report = prepareScopeObservation([run([typed('int64', ['9007199254740993']), typed('int64', ['9007199254740995'])])], 'output');
    expect(report.status).toBe('ready');
    expect(report.curves[0]!.approximate).toBe(true);
    expect(nearestScopeSamples(report, 0)[0]).toMatchObject({ exact: '9007199254740993', value: 9007199254740992, approximate: true });
  });

  it('keeps fixed-point raw code and fractional scale beside the approximate physical value', () => {
    const report = prepareScopeObservation([run([typed('fixed', ['7', '-3'], [2], { signed: true, wordLength: 16, fractionLength: 2 })])], 'output', 1);
    expect(report.curves[0]!.approximate).toBe(true);
    expect(nearestScopeSamples(report, 0)[0]).toMatchObject({ value: -0.75, exact: '-3 × 2^(-2) (저장 코드 -3)' });
  });

  it('keeps signed zero and IEEE gaps in typed float curves', () => {
    const report = prepareScopeObservation([run([typed('float64', ['-0']), typed('float64', ['NaN']), typed('float64', ['Infinity']), typed('float64', [1])])], 'output');
    expect(report.curves[0]!.approximate).toBe(true);
    expect(Object.is(report.curves[0]!.points[0]!.value, -0)).toBe(true);
    expect(report.curves[0]!.points.map(point => point.exact)).toEqual(['-0', 'NaN', 'Infinity', '1']);
    expect(report.curves[0]!.points.map(point => point.value)).toEqual([-0, null, null, 1]);
  });

  it('blocks fixed scales and signed types that would otherwise give a misleading comparison', () => {
    const a = run([typed('fixed', ['4'], [], { signed: true, wordLength: 16, fractionLength: 2 })]);
    const b = run([typed('fixed', ['4'], [], { signed: true, wordLength: 16, fractionLength: 3 })], { id: 'other' });
    expect(prepareScopeObservation([a, b], 'output').status).toBe('incompatible');
    expect(prepareScopeObservation([run([typed('int8', ['1'])]), run([typed('uint8', ['1'])], { id: 'other' })], 'output').status).toBe('incompatible');
  });

  it.each([
    true,
    [true, false],
    typed('boolean', [true]),
    typed('complex128', [{ re: 1, im: 0 }]),
    typed('string', ['1']),
    { kind: 'bus', fields: [{ name: 'a', value: 1 }] },
    { kind: 'messages', items: [] },
    typed('float64', [1, 2, 3, 4], [2, 2]),
  ] as SignalValue[])('explicitly excludes non-real or unsupported signal shapes %#', value => {
    const report = prepareScopeObservation([run([value])], 'output');
    expect(report.status).toBe('unsupported');
    expect(report.curves).toEqual([]);
  });

  it('preserves partial cancellation and failure status for actual recorded samples', () => {
    const report = prepareScopeObservation([run([1, 2], { status: 'cancelled' }), run([3], { id: 'failed', status: 'failed' })], 'output');
    expect(report.status).toBe('ready');
    expect(report.curves.map(curve => curve.status)).toEqual(['cancelled', 'failed']);
    expect(nearestScopeSamples(report, 0).map(item => item.status)).toEqual(['cancelled', 'failed']);
  });

  it('handles a static single sample and empty cancelled execution without claiming invented samples', () => {
    const report = prepareScopeObservation([run([42])], 'output');
    expect(report.domain).toEqual({ start: 0, end: 0 });
    expect(report.yDomain).toEqual({ minimum: 42, maximum: 42 });
    expect(nearestScopeSamples(report, 100)[0]!.value).toBe(42);
    const empty = prepareScopeObservation([run([], { status: 'cancelled', descriptor: descriptor([2], 'V') })], 'output');
    expect(empty.status).toBe('empty');
    expect(empty.shape).toEqual([2]);
    expect(empty.curves[0]!.status).toBe('cancelled');
    expect(nearestScopeSamples(empty, 0)).toEqual([]);
  });

  it('rejects too many runs, duplicate ids, excessive sample counts and element bounds', () => {
    expect(prepareScopeObservation([], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([1]), run([2])], 'output').status).toBe('invalid');
    expect(prepareScopeObservation(Array.from({ length: 4 }, (_, index) => run([1], { id: String(index) })), 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run(Array(10_002).fill(0))], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([Array(1_025).fill(0)])], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([Array.from({ length: 33 }, () => Array(32).fill(0))])], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([1])], 'output', 1).status).toBe('invalid');
  });

  it('bounds all inspected signal cells and timestamps across the three overlay runs together', () => {
    const value = Array<number>(1_024).fill(0);
    const sources = (count: number): ScopeObservationRun[] => Array.from({ length: 3 }, (_, index) => run(Array<SignalValue>(count).fill(value), { id: `run-${index}` }));
    // 3 × 325 × (1 timestamp + 1,024 cells) = 999,375; one extra row per run exceeds the shared budget.
    expect(prepareScopeObservation(sources(325), 'output', 1_023).status).toBe('ready');
    const over = prepareScopeObservation(sources(326), 'output', 1_023);
    expect(over.status).toBe('invalid');
    expect(over.curves).toEqual([]);
    expect(over.diagnostics[0]).toContain('1,000,000');
  });

  it.each([[NaN, 1], [0, Infinity], [1, 1], [2, 1]])('rejects nonfinite or non-increasing raw times %j', (a, b) => {
    expect(prepareScopeObservation([run([1, 2], { samples: [sample(a, 1), sample(b, 2)] })], 'output').status).toBe('invalid');
  });

  it('rejects malformed windows, missing output values and mixed or ragged arrays', () => {
    expect(prepareScopeObservation([run([0, 1])], 'output', 0, { start: 1, end: 0 }).status).toBe('invalid');
    expect(prepareScopeObservation([run([0, 1])], 'output', 0, { start: 2, end: 3 }).status).toBe('invalid');
    expect(prepareScopeObservation([run([0, 1])], 'output', 0, { start: NaN, end: 3 }).status).toBe('invalid');
    expect(prepareScopeObservation([run([0], { samples: [{ time: 0, values: {} }] })], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([[[1, 2], [3]]])], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([[true, 2] as SignalValue])], 'output').status).toBe('invalid');
  });

  it('never invokes imported getters, sparse arrays, inherited outputs or accessor time values', () => {
    let reads = 0;
    const getterRun = { id: 'run', label: '실행', get samples() { reads++; return []; } };
    expect(prepareScopeObservation([getterRun], 'output').status).toBe('invalid');
    const getterTime = { get time() { reads++; return 0; }, values: { output: 1 } };
    expect(prepareScopeObservation([run([], { samples: [getterTime] })], 'output').status).toBe('invalid');
    const getterValue = { time: 0, values: { get output() { reads++; return 1; } } };
    expect(prepareScopeObservation([run([], { samples: [getterValue] })], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([], { samples: new Array<RunSample>(1) })], 'output').status).toBe('invalid');
    const inherited = Object.create({ output: 1 }) as Record<string, SignalValue>;
    expect(prepareScopeObservation([run([], { samples: [{ time: 0, values: inherited }] })], 'output').status).toBe('invalid');
    expect(reads).toBe(0);
  });

  it('retains markup as inert plain labels and enforces bounded metadata', () => {
    const name = '<img src=x onerror=alert(1)>';
    expect(prepareScopeObservation([run([1], { label: name })], 'output').curves[0]!.label).toBe(name);
    expect(prepareScopeObservation([run([1], { label: 'x'.repeat(161) })], 'output').status).toBe('invalid');
    expect(prepareScopeObservation([run([1])], 'x'.repeat(161)).status).toBe('invalid');
    expect(nearestScopeSamples(prepareScopeObservation([run([1])], 'output'), NaN)).toEqual([]);
  });

  it('matches raw Unit Delay Worker-compatible runtime observations and partial-window selection', async () => {
    const model = createExample('discrete-feedback');
    model.execution.stopTime = 5;
    const actual = await runModel(compileModel(model));
    const input = { id: 'runtime', label: '실제 실행', samples: actual.samples, status: actual.status, descriptor: compileModel(model).outputTypes.result! };
    const report = prepareScopeObservation([input], 'result', 0, { start: 1, end: 4 });
    expect(report.status).toBe('ready');
    expect(report.curves[0]!.visiblePoints.map(point => point.value)).toEqual([1, 1.9, 2.71, 3.439]);
    expect(nearestScopeSamples(report, 2.4)[0]).toMatchObject({ sampleTime: 2, value: 1.9 });
    expect(actual.samples).toHaveLength(6);
    expect(model.execution.stopTime).toBe(5);
  });
});
