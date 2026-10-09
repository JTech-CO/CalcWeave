import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunSample, SignalDescriptor, SignalValue, TypedSignal } from '../packages/model/src';
import { nearestScopeSamples, prepareScopeObservation } from '../packages/analysis/src/scope-observation';
import { inputComponentChoices, prepareInputOverlay, projectInputObservations } from '../apps/web/src/multi-input-observation';
import { ResultPlot } from '../apps/web/src/components/ResultPlot';

const scalar = (unit = '1'): SignalDescriptor => ({ valueType: 'float64', shape: [], unit });
const port = (index: number) => index === 0 ? 'in' : `in${index + 1}`;
const bundleDescriptor = (...descriptors: SignalDescriptor[]): SignalDescriptor => ({ valueType: 'bus', shape: [], unit: '1', bus: { fields: descriptors.map((descriptor, index) => ({ name: port(index), descriptor })) } });
const samples = (...rows: SignalValue[][]): RunSample[] => rows.map((values, time) => ({ time, values: { scope: { kind: 'bus', fields: values.map((value, index) => ({ name: port(index), value })) } } }));

describe('Multi-input sink graphs preserve independent raw channels', () => {
  it('projects input order and distinct physical units without modifying records', () => {
    const source = samples([1, 10], [-0, 20], [3, 30]);
    const before = structuredClone(source);
    const result = projectInputObservations(source, 'scope', bundleDescriptor(scalar('V'), scalar('A')), 'completed');
    expect(result.diagnostics).toEqual([]);
    expect(result.channels.map(channel => channel.label)).toEqual(['입력 1 · in', '입력 2 · in2']);
    expect(result.channels.map(channel => channel.descriptor?.unit)).toEqual(['V', 'A']);
    expect(result.channels[0]!.samples.map(sample => sample.values.input)).toEqual([1, -0, 3]);
    expect(source).toEqual(before);
    result.channels[0]!.samples[0]!.values.input = 99;
    expect((source[0]!.values.scope as { fields: { value: SignalValue }[] }).fields[0]!.value).toBe(1);
  });

  it('uses a shared numerical axis with explicit mixed units and raw signed-zero cursor', () => {
    const projected = projectInputObservations(samples([1, 10], [-0, 20], [3, 30]), 'scope', bundleDescriptor(scalar('V'), scalar('A')));
    const report = prepareInputOverlay(projected.channels, []);
    expect(report.status).toBe('ready');
    expect(report.curves).toHaveLength(2);
    expect(report.yDomain).toEqual({ minimum: -0, maximum: 30 });
    expect(report.unit).toBe('각 곡선 단위 참조');
    expect(report.curves.map(curve => curve.label)).toEqual(['입력 1 · in · V', '입력 2 · in2 · A']);
    expect(report.diagnostics.join(' ')).toContain('단위가 다른 입력');
    expect(nearestScopeSamples(report, 1).map(reading => reading.exact)).toEqual(['-0', '20']);
  });

  it('supports all sixteen inputs without changing the three-run historical comparison cap', () => {
    const projected = projectInputObservations(samples(Array.from({ length: 16 }, (_, index) => index)), 'scope', bundleDescriptor(...Array.from({ length: 16 }, () => scalar())));
    const report = prepareInputOverlay(projected.channels, []);
    expect(report.status).toBe('ready');
    expect(report.curves).toHaveLength(16);
    expect(report.curves.at(-1)?.label).toBe('입력 16 · in16 · 단위 없음');
    expect(prepareScopeObservation(projected.channels, 'input').status).toBe('invalid');
  });

  it('selects vector and matrix components independently rather than flattening every input to the same index', () => {
    const declared = bundleDescriptor({ ...scalar('m'), shape: [2] }, { ...scalar('V'), shape: [2, 2] });
    const projected = projectInputObservations(samples([[1, 2], [[10, 20], [30, 40]]], [[3, 4], [[50, 60], [70, 80]]]), 'scope', declared);
    const report = prepareInputOverlay(projected.channels, [1, 2]);
    expect(report.curves.map(curve => curve.points.map(point => point.value))).toEqual([[2, 4], [30, 70]]);
    expect(report.curves.map(curve => curve.label)).toEqual(['입력 1 · in [2] · m', '입력 2 · in2 [2, 1] · V']);
    expect(inputComponentChoices(declared.bus!.fields[1]!.descriptor).map(choice => choice.label)).toEqual(['[1, 1]', '[1, 2]', '[2, 1]', '[2, 2]']);
  });

  it('retains exact int64 and fixed codes while graph values remain marked float64 approximations', () => {
    const integer: TypedSignal = { kind: 'typed', dtype: 'int64', shape: [], data: ['9007199254740993'] };
    const fixed: TypedSignal = { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 32, fractionLength: 3 }, shape: [], data: ['7'] };
    const declared = bundleDescriptor({ valueType: 'typed', unit: '1', shape: [], typed: { dtype: 'int64' } }, { valueType: 'typed', unit: '1', shape: [], typed: { dtype: 'fixed', fixed: fixed.fixed } });
    const projection = projectInputObservations(samples([integer, fixed]), 'scope', declared);
    expect(projection.diagnostics).toEqual([]);
    const report = prepareInputOverlay(projection.channels, []);
    expect(report.curves.map(curve => curve.approximate)).toEqual([true, true]);
    expect(nearestScopeSamples(report, 0).map(reading => reading.exact)).toEqual(['9007199254740993', '7 × 2^(-3) (저장 코드 7)']);
    expect(report.curves[1]!.points[0]!.value).toBe(.875);
  });

  it('keeps unsupported boolean and nested structured inputs explicit while plotting the numeric input', () => {
    const nested: SignalValue = { kind: 'bus', fields: [{ name: 'field', value: 5 }] };
    const declared = bundleDescriptor(scalar(), { valueType: 'boolean', shape: [], unit: '1' }, { valueType: 'bus', shape: [], unit: '1', bus: { fields: [{ name: 'field', descriptor: scalar() }] } });
    const projected = projectInputObservations(samples([1, true, nested], [2, false, nested]), 'scope', declared);
    const report = prepareInputOverlay(projected.channels, []);
    expect(report.curves).toHaveLength(1);
    expect(report.diagnostics.join(' ')).toContain('입력 2');
    expect(report.diagnostics.join(' ')).toContain('입력 3');
    expect(projected.channels[2]!.samples[0]!.values.input).toEqual(nested);
  });

  it('projects nonfinite typed floats as gaps and retains the exact IEEE tags', () => {
    const typed: SignalDescriptor = { valueType: 'typed', shape: [], unit: '1', typed: { dtype: 'float64' } };
    const projected = projectInputObservations(samples([{ kind: 'typed', dtype: 'float64', shape: [], data: ['NaN'] }, 1], [{ kind: 'typed', dtype: 'float64', shape: [], data: ['Infinity'] }, 2]), 'scope', bundleDescriptor(typed, scalar()));
    const report = prepareInputOverlay(projected.channels, []);
    expect(report.curves[0]!.points.map(point => point.value)).toEqual([null, null]);
    expect(nearestScopeSamples(report, 0).map(reading => reading.exact)).toEqual(['NaN', '1']);
    expect(report.yDomain).toEqual({ minimum: 1, maximum: 2 });
  });

  it('applies the same exact raw time window to independently projected inputs', () => {
    const projected = projectInputObservations(samples([0, 100], [1, 101], [2, 102], [3, 103], [4, 104]), 'scope', bundleDescriptor(scalar(), scalar()));
    const report = prepareInputOverlay(projected.channels, [], { start: 1.1, end: 3.9 });
    expect(report.domain).toEqual({ start: 0, end: 4 });
    expect(report.window).toEqual({ start: 1.1, end: 3.9 });
    expect(report.curves.map(curve => curve.visiblePoints.map(point => point.time))).toEqual([[2, 3], [2, 3]]);
    expect(report.yDomain).toEqual({ minimum: 2, maximum: 103 });
    expect(projected.channels[0]!.samples).toHaveLength(5);
  });

  it('marks cancelled and failed partial curves without claiming completed observations', () => {
    for (const status of ['cancelled', 'failed'] as const) {
      const projected = projectInputObservations(samples([1, 2]), 'scope', bundleDescriptor(scalar(), scalar()), status);
      expect(prepareInputOverlay(projected.channels, []).curves.map(curve => curve.status)).toEqual([status, status]);
    }
  });

  it('rejects a changed bus input order or count rather than swapping curve identities', () => {
    const source = samples([1, 2]);
    const bus = source[0]!.values.scope as { fields: { name: string; value: SignalValue }[] };
    bus.fields.reverse();
    expect(projectInputObservations(source, 'scope', bundleDescriptor(scalar(), scalar())).channels).toEqual([]);
    expect(projectInputObservations(samples([1]), 'scope', bundleDescriptor(scalar(), scalar())).channels).toEqual([]);
  });

  it('rejects sparse or excessive sample arrays before projection', () => {
    const sparse = Array(2) as RunSample[];
    expect(projectInputObservations(sparse, 'scope', bundleDescriptor(scalar(), scalar())).channels).toEqual([]);
    expect(projectInputObservations(Array(10002) as RunSample[], 'scope', bundleDescriptor(scalar(), scalar())).channels).toEqual([]);
  });

  it('enforces one aggregate resource budget across sixteen channels', () => {
    const row = [Array(512).fill(1), Array(512).fill(2)];
    const source = Array.from({ length: 975 }, () => row);
    const result = projectInputObservations(samples(...source), 'scope', bundleDescriptor({ ...scalar(), shape: [512] }, { ...scalar(), shape: [512] }));
    expect(result.channels).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('1,000,000');
  });

  it('never executes imported accessors in descriptors, times, values, or structured fields', () => {
    let calls = 0;
    const getter = () => { calls++; return 1; };
    const declared = bundleDescriptor(scalar(), scalar());
    const getterDescriptor = Object.defineProperty({ ...declared }, 'bus', { enumerable: true, get: getter });
    const getterTime = Object.defineProperty(samples([1, 2])[0]!, 'time', { enumerable: true, get: getter });
    const getterValues = Object.defineProperty(samples([1, 2])[0]!, 'values', { enumerable: true, get: getter });
    const getterField = samples([1, 2]);
    Object.defineProperty((getterField[0]!.values.scope as { fields: object[] }).fields[0]!, 'value', { enumerable: true, get: getter });
    for (const [input, descriptor] of [[samples([1, 2]), getterDescriptor], [[getterTime], declared], [[getterValues], declared], [getterField, declared]] as const) expect(projectInputObservations(input as RunSample[], 'scope', descriptor).channels).toEqual([]);
    expect(calls).toBe(0);
  });

  it('renders two raw curves, explicit controls and independent vector selectors', () => {
    const html = renderToStaticMarkup(createElement(ResultPlot, { samples: samples([[1, 2], 10], [[3, 4], 20]), outputId: 'scope', label: 'Scope', descriptor: bundleDescriptor({ ...scalar('V'), shape: [2] }, scalar('A')), multiInput: true }));
    expect(html).toContain('aria-label="Scope 다중 입력 그래프"');
    expect(html).toContain('그래프 중첩'); expect(html).toContain('그래프 각각 보기');
    expect(html).toContain('aria-label="입력 1 · in 그래프 성분"');
    expect(html.match(/data-sample-count="2"/g)).toHaveLength(2);
    expect(html).toContain('각 곡선 단위 참조');
  });

  it('keeps one-input scalar graphs and arbitrary legacy bus handling unchanged', () => {
    const html = renderToStaticMarkup(createElement(ResultPlot, { samples: [{ time: 0, values: { scope: 6 } }], outputId: 'scope', label: 'Display', descriptor: scalar() }));
    expect(html).toContain('data-testid="scope-observation"');
    expect(html).not.toContain('multi-input-plot');
    const busHtml = renderToStaticMarkup(createElement(ResultPlot, { samples: samples([1, 2]), outputId: 'scope', label: 'Legacy bus', descriptor: bundleDescriptor(scalar(), scalar()) }));
    expect(busHtml).toContain('버스'); expect(busHtml).not.toContain('그래프 중첩');
  });
});
