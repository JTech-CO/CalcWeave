import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { sha256 } from '../packages/model/src/sha256';
import { createExample } from '../apps/web/src/examples';
import { controlAnalysisSources, type ControlAnalysisRun } from '../apps/web/src/control-analysis-sources';
import type { CalcModel } from '../packages/model/src';

function configured(order = 1): CalcModel {
  const model = createExample('continuous-step-response');
  const plant = model.nodes.find(node => node.blockType === 'continuous.transfer-function')!;
  plant.blockType = 'continuous.state-space';
  plant.parameters = { A: Array.from({ length: order }, (_, i) => Array.from({ length: order }, (_, j) => i === j ? -i - 1 : 0)), B: Array(order).fill(1), C: Array(order).fill(1), D: 0, initial: Array(order).fill(0) };
  return model;
}
async function recorded(): Promise<ControlAnalysisRun> {
  const compiled = compileModel(createExample('local-linearization-requests'));
  return { model: structuredClone(compiled.model), result: await runModel(compiled), semanticHash: sha256(compiled.semanticKey) };
}

describe('M20 confirmed mathematical analysis sources', () => {
  it('converts an actual normalized continuous SISO block to copied matrix form without executing or editing it', () => {
    const model = configured(2), original = structuredClone(model);
    const source = controlAnalysisSources(model).sources[0]!;
    expect(source.kind).toBe('state-space-block'); expect(source.system).toMatchObject({ A: [[-1, 0], [0, -2]], B: [[1], [1]], C: [[1, 1]], D: [[0]] });
    expect(source.semanticHash).toBe(sha256(compileModel(model).semanticKey)); expect(model).toEqual(original);
    source.system.A[0]![0] = 99; expect(model).toEqual(original);
  });
  it('rejects root blocks larger than the supported analysis order without shrinking them', () => {
    const sources = controlAnalysisSources(configured(5)); expect(sources.sources).toEqual([]); expect(sources.issues.length).toBeGreaterThan(0);
  });
  it('does not reinterpret discrete or descriptor blocks as continuous configuration sources', () => {
    expect(controlAnalysisSources(createExample('discrete-state-space')).sources).toEqual([]);
    expect(controlAnalysisSources(createExample('descriptor-index-one')).sources).toEqual([]);
  });
  it('connects actual timed and triggered Worker-compatible M12 output buses to their immutable source and request times', async () => {
    const run = await recorded(), before = structuredClone(run);
    const { sources, issues } = controlAnalysisSources(createExample('first-calculation'), run);
    expect(issues).toEqual([]); expect(sources).toHaveLength(2);
    for (const source of sources) {
      expect(source.kind).toBe('recorded-linearization'); expect(source.time).toBe(1); expect(source.runStatus).toBe('completed'); expect(source.semanticHash).toBe(run.semanticHash);
      expect(source.system.A[0]![0]).toBeCloseTo(-2, 8); expect(source.system.B[0]![0]).toBeCloseTo(3, 8); expect(source.system.C[0]![0]).toBeCloseTo(4, 8); expect(source.system.D[0]![0]).toBeCloseTo(5, 8);
    }
    expect(sources.find(source => source.nodeId === 'timed')!.requestTime).toBe(1);
    expect(sources.find(source => source.nodeId === 'triggered')!.requestTime).toBeCloseTo(.5, 8); expect(run).toEqual(before);
  });
  it('rejects a recorded model hash mismatch while keeping independent current configuration sources', async () => {
    const run = await recorded(); run.semanticHash = '0'.repeat(64);
    const result = controlAnalysisSources(configured(), run); expect(result.sources).toHaveLength(1); expect(result.issues.join(' ')).toContain('지문');
  });
  it('requires confirmed request memory and never promotes initial all-zero bus placeholders', async () => {
    const run = await recorded(); delete run.result.stateMemory;
    const result = controlAnalysisSources(createExample('first-calculation'), run); expect(result.sources).toEqual([]); expect(result.issues.join(' ')).toContain('완료');
    const second = await recorded(); delete (second.result.stateMemory!.timed as Record<string, unknown>).analysisHit; delete (second.result.stateMemory!.triggered as Record<string, unknown>).analysisHit;
    expect(controlAnalysisSources(createExample('first-calculation'), second).sources).toEqual([]);
  });
  it('requires the confirmed matrix to equal the last raw recorded matrix', async () => {
    const run = await recorded();
    const value = run.result.samples.at(-1)!.values['timed-result'] as { kind: 'bus'; fields: { name: string; value: number[][] }[] }; value.fields[0]!.value[0]![0] = -99;
    const result = controlAnalysisSources(createExample('first-calculation'), run); expect(result.sources.map(source => source.nodeId)).toEqual(['triggered']); expect(result.issues.join(' ')).toContain('다릅니다');
  });
  it('omits a request later than the latest recorded sample rather than assigning it an earlier time', async () => {
    const run = await recorded(); run.result.samples = run.result.samples.slice(0, 3); run.result.steps = 3; run.result.status = 'cancelled';
    expect(controlAnalysisSources(createExample('first-calculation'), run).sources).toEqual([]);
  });
  it('keeps a confirmed partial execution visibly cancelled', async () => {
    const run = await recorded(); run.result.status = 'cancelled';
    const sources = controlAnalysisSources(createExample('first-calculation'), run).sources; expect(sources).toHaveLength(2); expect(sources.every(source => source.runStatus === 'cancelled')).toBe(true);
  });
  it('accepts genuinely confirmed zero matrices instead of confusing them with an unexecuted placeholder', async () => {
    const run = await recorded(), bus = { kind: 'bus', fields: ['A', 'B', 'C', 'D'].map(name => ({ name, value: [[0]] })) };
    (run.result.stateMemory!.timed as Record<string, unknown>).analysisOutput = structuredClone(bus);
    run.result.samples.at(-1)!.values['timed-result'] = structuredClone(bus) as typeof run.result.samples[number]['values'][string];
    expect(controlAnalysisSources(createExample('first-calculation'), run).sources.find(source => source.nodeId === 'timed')!.system.A).toEqual([[0]]);
  });
  it('does not infer an unrelated bus or routed output as a direct linearization request', async () => {
    const run = await recorded(); run.model.edges = run.model.edges.filter(edge => edge.source.nodeId !== 'timed');
    // The remaining snapshot must compile; remove its now-unconnected sink.
    run.model.nodes = run.model.nodes.filter(node => node.id !== 'timed-result'); delete run.model.layout['timed-result'];
    run.semanticHash = sha256(compileModel(run.model).semanticKey);
    expect(controlAnalysisSources(createExample('first-calculation'), run).sources.map(source => source.nodeId)).toEqual(['triggered']);
  });
  it('rejects run and matrix accessors without invoking them', async () => {
    let calls = 0; const run = await recorded(); Object.defineProperty(run, 'result', { enumerable: true, get: () => { calls++; return null; } });
    expect(controlAnalysisSources(configured(), run).issues.length).toBeGreaterThan(0); expect(calls).toBe(0);
    const second = await recorded(); Object.defineProperty(second.result.stateMemory!.timed as object, 'analysisOutput', { enumerable: true, get: () => { calls++; return null; } });
    expect(controlAnalysisSources(createExample('first-calculation'), second).sources.map(source => source.nodeId)).toEqual(['triggered']); expect(calls).toBe(0);
  });
  it('rejects sparse and accessor-bearing samples without evaluating callbacks or coercion', async () => {
    let calls = 0; const run = await recorded(); Object.defineProperty(run.result.samples, '0', { enumerable: true, get: () => { calls++; return run.result.samples.at(-1); } });
    expect(controlAnalysisSources(configured(), run).sources).toHaveLength(1); expect(calls).toBe(0);
    const second = await recorded(); second.result.status = { toString() { calls++; return 'completed'; } } as unknown as typeof second.result.status;
    expect(controlAnalysisSources(configured(), second).issues.length).toBeGreaterThan(0); expect(calls).toBe(0);
  });
  it('rejects off-grid raw observations and oversized sample arrays before extraction', async () => {
    const run = await recorded(); run.result.samples.at(-1)!.time += .01;
    expect(controlAnalysisSources(configured(), run).issues.join(' ')).toContain('격자');
    const second = await recorded(); second.result.samples = Array(10002).fill(second.result.samples[0]!); second.result.steps = 10002;
    expect(controlAnalysisSources(configured(), second).issues.length).toBeGreaterThan(0);
  });
  it('rejects on-grid copied samples beyond the recorded execution stop time', async () => {
    const run = await recorded(), last = structuredClone(run.result.samples.at(-1)!);
    last.time = run.model.execution.stopTime + run.model.execution.step;
    run.result.samples.push(last); run.result.steps = run.result.samples.length;
    const result = controlAnalysisSources(configured(), run);
    expect(result.sources).toHaveLength(1); expect(result.sources[0]!.kind).toBe('state-space-block');
    expect(result.issues.join(' ')).toContain('시간 범위');
  });
});
