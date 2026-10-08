import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { sha256 } from '../packages/model/src/sha256';
import type { CalcModel, SignalValue } from '../packages/model/src';
import type { ControlAnalysisRun } from '../apps/web/src/control-analysis-sources';
import { readSpectrumSelection, spectrumAnalysisSources } from '../apps/web/src/spectrum-analysis-sources';

function model(value: SignalValue = 2): CalcModel {
  return { schemaVersion: 1, modelId: 'm21-raw', name: '스펙트럼 원시 기록',
    execution: { mode: 'discrete', startTime: 0, stopTime: 31 / 32, step: 1 / 32 },
    nodes: [{ id: 'input', blockType: typeof value === 'object' && !Array.isArray(value) ? 'source.typed' : 'source.constant', blockVersion: 1, label: '기록 입력', parameters: { value } },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '기록 출력', parameters: {} }],
    edges: [{ id: 'record', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }], layout: {} };
}
async function recorded(value: SignalValue = 2): Promise<ControlAnalysisRun> {
  const compiled = compileModel(model(value));
  return { model: compiled.model, result: await runModel(compiled), semanticHash: sha256(compiled.semanticKey) };
}
describe('M21 completed raw spectrum sources', () => {
  it('offers actual completed records with their recorded model, unit and shape', async () => {
    const run = await recorded(), original = structuredClone(run);
    const available = spectrumAnalysisSources(run);
    expect(available.issues).toEqual([]);
    expect(available.sources).toHaveLength(1);
    expect(available.sources[0]).toMatchObject({ outputId: 'scope', sampleCount: 32, unit: '1', runStatus: 'completed', modelName: model().name, semanticHash: run.semanticHash, components: [{ index: 0, label: '값' }] });
    expect(run).toEqual(original);
  });
  it('copies the exact chosen segment and records a hash of its time and values', async () => {
    const run = await recorded(), captured = readSpectrumSelection(run, 'scope', 0, 8, 16);
    expect(captured.input.times).toEqual(Array.from({ length: 16 }, (_, i) => (i + 8) / 32));
    expect(captured.input.values).toEqual(Array(16).fill(2));
    expect(captured.source).toMatchObject({ startIndex: 8, count: 16, startTime: .25, endTime: 23 / 32, componentIndex: 0 });
    expect(captured.source.samplesSha256).toBe(sha256(JSON.stringify(captured.input)));
    captured.input.values[0] = 99; captured.source.components[0]!.label = 'changed';
    expect(run.result.samples[8]!.values.scope).toBe(2);
    expect(spectrumAnalysisSources(run).sources[0]!.components[0]!.label).toBe('값');
  });
  it.each([{ value: [2, 4] }, { value: [[2, 4], [6, 8]] }])('projects a selected legacy component in row-major order: $value', async ({ value }) => {
    const run = await recorded(value as SignalValue), source = spectrumAnalysisSources(run).sources[0]!;
    expect(source.components[1]!.label).toBe(Array.isArray(value[0]) ? '[1, 2]' : '[2]');
    expect(readSpectrumSelection(run, 'scope', 1, 0, 8).input.values).toEqual(Array(8).fill(4));
  });
  it.each(['float32', 'float64'] as const)('decodes explicit typed %s without changing the wire recording', async dtype => {
    const value = { kind: 'typed' as const, dtype, shape: [2], data: [1.25, -2.5] };
    const run = await recorded(value);
    expect(readSpectrumSelection(run, 'scope', 1, 0, 8).input.values).toEqual(Array(8).fill(-2.5));
    expect(run.result.samples[0]!.values.scope).toEqual(value);
  });
  it.each(['int64', 'uint64', 'boolean', 'complex128', 'string'] as const)('does not silently cast typed %s', async dtype => {
    const data = dtype === 'boolean' ? [true] : dtype === 'complex128' ? [{ re: 1, im: 2 }] : dtype === 'string' ? ['text'] : ['1'];
    const run = await recorded({ kind: 'typed', dtype, shape: [], data } as SignalValue);
    expect(spectrumAnalysisSources(run).sources).toEqual([]);
    expect(spectrumAnalysisSources(run).issues.join()).toContain('자동 변환');
  });
  it('explains missing time records without executing a new model', () => {
    expect(spectrumAnalysisSources(null).issues.join()).toContain('시간 시뮬레이션');
  });
  it.each(['failed', 'cancelled'] as const)('rejects %s even when the raw values look complete', async status => {
    const run = await recorded(); run.result.status = status;
    expect(spectrumAnalysisSources(run).sources).toEqual([]);
    expect(spectrumAnalysisSources(run).issues.join()).toContain('완료된 실행');
  });
  it('does not present static records as time series', async () => {
    const input = model(); input.execution = { mode: 'static', startTime: 0, stopTime: 0, step: 1 };
    const compiled = compileModel(input), run = { model: compiled.model, result: await runModel(compiled), semanticHash: sha256(compiled.semanticKey) };
    expect(spectrumAnalysisSources(run).sources).toEqual([]);
  });
  it('rejects a false model fingerprint', async () => {
    const run = await recorded(); run.semanticHash = '0'.repeat(64);
    expect(spectrumAnalysisSources(run).issues.join()).toContain('계산 지문');
  });
  it('rejects declared sample-count mismatches and a shortened completed trace', async () => {
    const run = await recorded(); run.result.steps--;
    expect(spectrumAnalysisSources(run).sources).toEqual([]);
    run.result.samples.pop();
    expect(spectrumAnalysisSources(run).issues.join()).toContain('시간 격자');
  });
  it('rejects a raw observation shifted off the recorded model grid', async () => {
    const run = await recorded(); run.result.samples[9]!.time += .001;
    expect(spectrumAnalysisSources(run).issues.join()).toContain('관측 격자');
  });
  it('rejects changing output shape inside a recording', async () => {
    const run = await recorded([1, 2]); run.result.samples[9]!.values.scope = [1];
    expect(spectrumAnalysisSources(run).sources).toEqual([]);
  });
  it('rejects a selected nonfinite value rather than interpolating the gap', async () => {
    const run = await recorded(); run.result.samples[9]!.values.scope = NaN;
    expect(() => readSpectrumSelection(run, 'scope', 0, 0, 16)).toThrow(/비유한/);
    expect(readSpectrumSelection(run, 'scope', 0, 16, 16).input.values).toHaveLength(16);
  });
  it.each([[0, 0, 7], [0, 0, 12], [0, 0, 16384], [2, 0, 8], [0, 30, 8], [0, -1, 8], [0, .5, 8], [0, 0, NaN]])('rejects invalid explicit selection %j', async (component, start, count) => {
    const run = await recorded(); expect(() => readSpectrumSelection(run, 'scope', component, start, count)).toThrow();
  });
  it('never executes getters in the run, sample, or output', async () => {
    for (const target of ['run', 'sample', 'value'] as const) {
      const run = await recorded(); let calls = 0;
      const holder = target === 'run' ? run : target === 'sample' ? run.result.samples[0]! : run.result.samples[0]!.values;
      Object.defineProperty(holder, target === 'run' ? 'result' : target === 'sample' ? 'time' : 'scope', { enumerable: true, get() { calls++; throw new Error('getter'); } });
      expect(spectrumAnalysisSources(run).sources).toEqual([]); expect(calls).toBe(0);
    }
  });
  it('rejects sparse sample arrays and dangerous data keys', async () => {
    const run = await recorded(); delete run.result.samples[0];
    expect(spectrumAnalysisSources(run).sources).toEqual([]);
    const other = await recorded(); Object.defineProperty(other, '__proto__', { enumerable: true, value: {} });
    expect(spectrumAnalysisSources(other).sources).toEqual([]);
  });
});
