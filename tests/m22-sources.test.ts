import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { sha256 } from '../packages/model/src/sha256';
import type { CalcModel } from '../packages/model/src';
import { createExample } from '../apps/web/src/examples';
import { discreteControlAnalysisSources } from '../apps/web/src/discrete-control-analysis-sources';
import { analyzeDiscreteSiso } from '../packages/analysis/src/discrete-control-system';

function configured(order = 1): CalcModel {
  return { schemaVersion: 1, modelId: 'm22-config', name: '이산 분석 출처',
    execution: { mode: 'discrete', startTime: 0, stopTime: .4, step: .05 },
    nodes: [{ id: 'input', blockType: 'source.constant', blockVersion: 1, label: '입력', parameters: { value: 0 } },
      { id: 'plant', blockType: 'discrete.state-space', blockVersion: 1, label: '이산계', parameters: {
        A: Array.from({ length: order }, (_, i) => Array.from({ length: order }, (_, j) => i === j ? .5 / (i + 1) : 0)), B: Array(order).fill(1), C: Array(order).fill(1), D: 0, initial: Array(order).fill(0) } },
      { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '출력', parameters: {} }],
    edges: [{ id: 'in-plant', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'plant', portId: 'in' } }, { id: 'plant-out', source: { nodeId: 'plant', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }], layout: {} };
}
describe('M22 configured discrete sources and physical sample time', () => {
  it('normalizes defaults, copies matrices and hashes the actual compiled model without editing it', () => {
    const model = configured(2), before = structuredClone(model), { sources, issues } = discreteControlAnalysisSources(model), source = sources[0]!;
    expect(issues).toEqual([]); expect(sources).toHaveLength(1); expect(source.kind).toBe('discrete-state-space-block');
    expect(source.sampleTime).toEqual({ period: 1, offset: 0, baseStep: .05 });
    expect(source.system).toEqual({ domain: 'discrete', sampleTime: .05, A: [[.5, 0], [0, .25]], B: [[1], [1]], C: [[1, 1]], D: [[0]] });
    expect(source.semanticHash).toBe(sha256(compileModel(model).semanticKey)); expect(model).toEqual(before);
    source.system.A[0][0] = 99; source.sampleTime.period = 999; expect(model).toEqual(before);
  });
  it('uses period times baseStep and preserves offset as a time origin, not an added delay', () => {
    const model = configured(); model.nodes[1].sampleTime = { period: 4, offset: 1 }; model.nodes[2].sampleTime = { period: 4, offset: 1 };
    const source = discreteControlAnalysisSources(model).sources[0]!;
    expect(source.system.sampleTime).toBe(.2); expect(source.sampleTime).toEqual({ period: 4, offset: 1, baseStep: .05 });
    const response = analyzeDiscreteSiso(source.system, { frequencyMin: 1, frequencyMax: Math.PI / .2, frequencyPoints: 2, rootLocusGains: [] });
    expect(response.nyquistOmega).toBe(5 * Math.PI); expect(response.bode.at(-1)!.real).toBeCloseTo(-2 / 3, 12);
    model.nodes[1].sampleTime.offset = 0; model.nodes[2].sampleTime.offset = 0;
    expect(discreteControlAnalysisSources(model).sources[0]!.system).toEqual(source.system);
  });
  for (const D of [0, 2]) it(`matches the actual discrete machine impulse publication with D=${D}`, async () => {
    const model = configured(); model.execution.stopTime = .2;
    model.nodes[0].blockType = 'source.repeating-sequence'; model.nodes[0].parameters = { times: [0, .05, .25], values: [1, 0, 0], interpolation: 'previous' };
    model.nodes[1].parameters.D = D;
    const compiled = compileModel(model), run = await runModel(compiled);
    expect(run.samples.map(sample => sample.values.scope)).toEqual([D, 1, .5, .25, .125]);
    expect(discreteControlAnalysisSources(model).sources[0]!.system.D).toEqual([[D]]);
  });
  it('ignores initial-state transients and explicitly retains that assumption', () => {
    const model = configured(); model.nodes[1].parameters.initial = [12];
    const source = discreteControlAnalysisSources(model).sources[0]!;
    expect(source.assumptions.join(' ')).toContain('영 초기상태'); expect(source.system.A).toEqual([[.5]]);
  });
  for (const order of [1, 2, 3, 4]) it(`supports ${order} states without altering the configured order`, () => {
    expect(discreteControlAnalysisSources(configured(order)).sources[0]!.system.A).toHaveLength(order);
  });
  for (const order of [5, 16]) it(`rejects ${order} executable states without truncation`, () => {
    const result = discreteControlAnalysisSources(configured(order)); expect(result.sources).toEqual([]); expect(result.issues.length).toBeGreaterThan(0);
  });
  it('rejects level reset even when its input currently happens to be zero', () => {
    const model = configured(); model.nodes[1].parameters.reset = 'level';
    model.nodes.push({ id: 'reset-signal', blockType: 'source.constant', blockVersion: 1, label: '꺼진 리셋', parameters: { value: false } });
    model.edges.push({ id: 'reset', source: { nodeId: 'reset-signal', portId: 'out' }, target: { nodeId: 'plant', portId: 'reset' } });
    const result = discreteControlAnalysisSources(model); expect(result.sources).toEqual([]); expect(result.issues.join(' ')).toContain('리셋');
  });
  for (const example of ['first-calculation', 'continuous-step-response', 'continuous-crossing-reset']) it(`does not reinterpret ${example} as a pure discrete source`, () => {
    const result = discreteControlAnalysisSources(createExample(example)); expect(result.sources).toEqual([]); expect(result.issues.length).toBeGreaterThan(0);
  });
  it('does not advertise unsupported MIMO or infer transfer functions from other blocks', () => {
    const model = configured(); model.nodes[1].blockType = 'discrete.transfer-function'; model.nodes[1].parameters = { numerator: [1], denominator: [1, -.5], initial: 0 };
    expect(discreteControlAnalysisSources(model).sources).toEqual([]);
  });
  it('keeps current configurations independently of simulation provenance', () => {
    const model = configured(); expect(discreteControlAnalysisSources(model).sources[0]!.label).toContain('현재 이산 설정');
    expect(discreteControlAnalysisSources(model).sources[0]).not.toHaveProperty('runStatus');
  });
  it('accepts a local same-rate source next to a rate transition without claiming the surrounding diagram response', () => {
    const model = configured(); model.nodes[1].sampleTime = { period: 2, offset: 0 };
    model.nodes.splice(2, 0, { id: 'rate', blockType: 'time.rate-transition', blockVersion: 1, label: '속도 경계', parameters: { initial: 0 } });
    model.edges[1].target = { nodeId: 'rate', portId: 'in' }; model.edges.push({ id: 'rate-out', source: { nodeId: 'rate', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } });
    const source = discreteControlAnalysisSources(model).sources[0]!; expect(source.system.sampleTime).toBe(.1); expect(source.assumptions.join(' ')).toContain('다중 rate');
  });
  it('rejects rates with no usable bounded frequency interval', () => {
    const model = configured(); model.execution = { mode: 'discrete', startTime: 0, stopTime: 1e7, step: 1e7 };
    const result = discreteControlAnalysisSources(model); expect(result.sources).toEqual([]); expect(result.issues.join(' ')).toContain('Nyquist');
  });
  it('rejects accessors and user hooks before compilation without invoking them', () => {
    let calls = 0; const model = configured(); Object.defineProperty(model.nodes[1].parameters, 'A', { enumerable: true, get() { calls++; return [[.5]]; } });
    expect(discreteControlAnalysisSources(model).sources).toEqual([]); expect(calls).toBe(0);
    const another = configured(); Object.defineProperty(another, 'execution', { enumerable: true, get() { calls++; return null; } });
    expect(discreteControlAnalysisSources(another).sources).toEqual([]); expect(calls).toBe(0);
  });
  for (const rate of [{ period: 0, offset: 0 }, { period: 10001, offset: 0 }, { period: 2, offset: 2 }]) it(`rejects invalid sample rate ${JSON.stringify(rate)}`, () => {
    const model = configured(); model.nodes[1].sampleTime = rate; expect(discreteControlAnalysisSources(model).sources).toEqual([]);
  });
  it('bounds source and issue display without unbounded UI output', () => {
    const model = configured(); model.nodes = [model.nodes[0], model.nodes[2]]; model.edges = [];
    for (let i = 0; i < 75; i++) {
      const node = structuredClone(configured().nodes[1]); node.id = `plant-${i}`; model.nodes.push(node);
      model.edges.push({ id: `in-${i}`, source: { nodeId: 'input', portId: 'out' }, target: { nodeId: node.id, portId: 'in' } });
    }
    model.edges.push({ id: 'scope-in', source: { nodeId: 'plant-0', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } });
    const result = discreteControlAnalysisSources(model); expect(result.sources).toHaveLength(64); expect(result.issues).toHaveLength(1);
    model.nodes.filter(node => node.blockType === 'discrete.state-space').forEach(node => { node.parameters = configured(5).nodes[1].parameters; });
    expect(discreteControlAnalysisSources(model).issues).toHaveLength(8);
  });
});
