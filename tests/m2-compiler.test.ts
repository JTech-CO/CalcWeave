import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockPorts, isDirectFeedthrough } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { canonicalSemantic, discreteMemoryElementCount, ModelError, parseModel, serializeModel, type CalcEdge, type CalcModel, type CalcNode, type SignalValue } from '../packages/model/src';
import { M1_ENGINE_FIXTURES } from './m1-engine-fixtures';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, parameters, blockVersion: 1, label: id });
const edge = (source: string, target: string, port = 'in'): CalcEdge => ({ id: `${source}-${target}-${port}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } });
function graph(nodes: CalcNode[], edges: CalcEdge[]): CalcModel {
  return { schemaVersion: 1, modelId: 'm2_compiler', name: 'M2 compiler fixture', nodes, edges, execution: { mode: 'discrete', startTime: 0, stopTime: 10, step: 1 }, layout: {} };
}
function unary(type: string, value: SignalValue = 1, parameters: Record<string, unknown> = {}): CalcModel {
  return graph([node('input', 'source.constant', { value }), node('operation', type, parameters), node('result', 'sink.scope')], [edge('input', 'operation'), edge('operation', 'result')]);
}
function diagnostics(model: unknown): ModelError['diagnostics'] {
  try { compileModel(model); } catch (error) { expect(error).toBeInstanceOf(ModelError); return (error as ModelError).diagnostics; }
  throw new Error('Expected compilation failure');
}
const expectCode = (model: unknown, code: string, nodeId?: string): void => {
  expect(diagnostics(model).some((entry) => entry.code === code && (nodeId === undefined || entry.nodeId === nodeId))).toBe(true);
};

describe('M2 discrete typed contracts', () => {
  it('extends every M1 static fixture to discrete and preserves it inside M3 hybrid sections', () => {
    for (const fixture of M1_ENGINE_FIXTURES) {
      const model = structuredClone(fixture.model); model.execution.mode = 'discrete';
      expect([...compileModel(model).outputIds].sort()).toEqual(Object.keys(fixture.expected).sort());
    }
    expect(blockRegistry.filter((entry) => entry.supportedModes.includes('static')).every((entry) => entry.supportedModes.includes('discrete'))).toBe(true);
    const model = unary('discrete.delay'); model.execution.mode = 'continuous'; expect(compileModel(model).nodes.find((entry) => entry.id === 'operation')!.executionDomain).toBe('discrete');
  });

  it.each(['source.step', 'source.ramp', 'source.sine-wave', 'source.pulse', 'source.clock', 'source.digital-clock', 'source.random', 'source.repeating-sequence'])('declares finite scalar time source %s', (type) => {
    const model = graph([node('source', type), node('result', 'sink.scope')], [edge('source', 'result')]);
    const compiled = compileModel(model);
    expect(compiled.outputTypes.result).toEqual({ valueType: 'float64', shape: [], unit: type.includes('clock') ? 's' : '1' });
    expect(compiled.stateIds).toEqual(type === 'source.random' ? ['source'] : []);
  });

  it.each(['discrete.unit-delay', 'discrete.delay', 'discrete.integrator', 'discrete.difference', 'discrete.derivative', 'discrete.fir', 'time.rate-transition'])('infers matrix initial contracts for %s and rejects implicit state broadcasting', (type) => {
    const model = unary(type, [[1, 2]], { initial: [[0, 0]] });
    expect(compileModel(model).outputTypes.result!.shape).toEqual([1, 2]);
    model.nodes[1]!.parameters.initial = 0; expectCode(model, 'SHAPE_MISMATCH', 'operation');
  });

  it('allows typed boolean delay/RT and rejects numeric state or boolean unit coercion', () => {
    const model = unary('discrete.unit-delay', [true, false], { initial: [false, false] });
    expect(compileModel(model).outputTypes.result!.valueType).toBe('boolean');
    model.nodes[1]!.unit = 'm'; expectCode(model, 'UNIT_MISMATCH');
    delete model.nodes[1]!.unit; model.nodes[1]!.blockType = 'discrete.fir'; expectCode(model, 'TYPE_MISMATCH');
    model.nodes[1]!.blockType = 'time.rate-transition'; expect(compileModel(model).outputTypes.result!.shape).toEqual([2]);
  });

  it('requires explicit matching initial units and dimensionless integration/derivation/SISO', () => {
    const model = unary('discrete.difference'); model.nodes[0]!.unit = 'm'; expectCode(model, 'UNIT_MISMATCH');
    model.nodes[1]!.unit = 'm'; expect(compileModel(model).outputTypes.result!.unit).toBe('m');
    model.nodes[1]!.blockType = 'discrete.integrator'; expectCode(model, 'UNIT_MISMATCH');
    model.nodes[1]!.blockType = 'discrete.state-space'; model.nodes[1]!.parameters = {}; expectCode(model, 'UNIT_MISMATCH');
    delete model.nodes[0]!.unit; delete model.nodes[1]!.unit; expect(compileModel(model).outputTypes.result!.shape).toEqual([]);
  });

  it('records Scope and validates typed Lookup output units', () => {
    const model = unary('lookup.interpolated', [[0, 0.5, 1]]); model.nodes[1]!.unit = 'm';
    expect(compileModel(model).outputTypes.result).toEqual({ valueType: 'float64', shape: [1, 3], unit: 'm' });
    model.execution.mode = 'static'; expect(compileModel(model).outputIds).toEqual(['result']);
    model.nodes[0]!.unit = 'm'; expectCode(model, 'UNIT_MISMATCH');
  });
});

describe('M2 rates and immutable meaning', () => {
  it('normalizes omitted rates and round-trips explicit rates in semantic meaning', () => {
    const original = unary('discrete.delay'); const compiled = compileModel(original);
    expect(compiled.nodes.every((entry) => entry.sampleTime.period === 1 && entry.sampleTime.offset === 0)).toBe(true);
    expect(compiled.model.nodes.every((entry) => entry.sampleTime?.period === 1)).toBe(true);
    expect(original.nodes.every((entry) => entry.sampleTime === undefined)).toBe(true);
    const changed = structuredClone(original);
    changed.nodes.forEach((entry) => { entry.sampleTime = { period: 1, offset: 0 }; });
    expect(canonicalSemantic(changed)).toBe(canonicalSemantic(original));
    changed.nodes[1]!.sampleTime = { period: 2, offset: 1 }; changed.nodes[2]!.sampleTime = { period: 2, offset: 1 };
    expect(canonicalSemantic(changed)).not.toBe(canonicalSemantic(original));
    expect(parseModel(JSON.parse(serializeModel(changed)))).toEqual(changed);
    expect(Object.isFrozen(compileModel(changed).nodes[0]!.sampleTime)).toBe(true);
  });

  it.each([{ period: 0, offset: 0 }, { period: 1.5, offset: 0 }, { period: 2, offset: 2 }, { period: 2, offset: -1 }, { period: 10001, offset: 0 }, { period: 2, offset: 0.5 }])('rejects invalid rate %j at its node', (rate) => {
    const model = unary('discrete.delay'); model.nodes[1]!.sampleTime = rate; expectCode(model, 'INVALID_MODEL', 'operation');
  });

  it('requires explicit transitions across period/offset changes while exempting timeless sources', () => {
    const model = graph([node('source', 'source.ramp'), node('operation', 'math.gain'), node('result', 'sink.scope')], [edge('source', 'operation'), edge('operation', 'result')]);
    model.nodes[1]!.sampleTime = { period: 2, offset: 0 }; model.nodes[2]!.sampleTime = { period: 2, offset: 0 };
    expectCode(model, 'SAMPLE_TIME_MISMATCH', 'operation');
    model.nodes[1]!.blockType = 'time.rate-transition'; expect(compileModel(model).outputTypes.result!.unit).toBe('1');
    model.nodes[2]!.sampleTime.offset = 1; expectCode(model, 'SAMPLE_TIME_MISMATCH', 'result');
    model.nodes[2]!.sampleTime.offset = 0; model.nodes[0]!.blockType = 'source.constant'; model.nodes[1]!.blockType = 'math.gain'; expect(compileModel(model).outputIds).toEqual(['result']);
  });

  it('rejects nondefault static and Clock rates and allows explicit M3 discrete algebraic rates', () => {
    const model = unary('math.gain'); model.nodes[1]!.sampleTime = { period: 2, offset: 0 }; model.execution.mode = 'static'; expectCode(model, 'UNSUPPORTED_SAMPLE_TIME');
    model.execution.mode = 'continuous'; model.nodes[2]!.blockType = 'sink.display'; expect(compileModel(model).nodes.find((entry) => entry.id === 'operation')!.executionDomain).toBe('discrete');
    model.execution.mode = 'discrete'; model.nodes[1]!.blockType = 'source.clock'; model.edges.shift(); expectCode(model, 'UNSUPPORTED_SAMPLE_TIME');
  });

  it('aligns in-range Step changes to base grid and the declared source due', () => {
    const model = graph([node('source', 'source.step', { stepTime: 0.25 }), node('result', 'sink.scope')], [edge('source', 'result')]);
    expectCode(model, 'SOURCE_TIME_GRID', 'source');
    model.nodes[0]!.parameters.stepTime = 1; model.nodes.forEach((entry) => { entry.sampleTime = { period: 2, offset: 0 }; }); expectCode(model, 'SOURCE_TIME_GRID');
    model.nodes[0]!.parameters.stepTime = 2; expect(compileModel(model).outputIds).toEqual(['result']);
    model.nodes[0]!.parameters.stepTime = -0.25; expect(compileModel(model).outputIds).toEqual(['result']);
  });
});

describe('M2 state dependencies, parameters and memory preflight', () => {
  it('uses coefficient-dependent feedthrough to accept strict-proper state feedback and reject algebraic loops', () => {
    for (const [type, parameters, key, feedthrough] of [
      ['discrete.fir', { coefficients: [0, 1] }, 'coefficients', [1, 1]],
      ['discrete.transfer-function', { numerator: [0, 1] }, 'numerator', [1, 1]],
      ['discrete.state-space', { D: 0 }, 'D', 1],
    ] as const) {
      const model = graph([node('state', type, { ...parameters }), node('gain', 'math.gain'), node('result', 'sink.scope')], [edge('state', 'gain'), edge('gain', 'state'), edge('state', 'result')]);
      expect(isDirectFeedthrough(model.nodes[0]!)).toBe(false);
      expect(compileModel(model).nodes.map((entry) => entry.id)).toEqual(['state', 'gain', 'result']);
      model.nodes[0]!.parameters[key] = feedthrough; expectCode(model, 'CYCLIC_DEPENDENCY');
    }
  });

  it('requires boolean scalar reset and keeps next-commit reset edges outside output dependencies', () => {
    const model = unary('discrete.unit-delay', 1, { reset: 'level' });
    expect(getBlockPorts(model.nodes[1]!).inputs).toEqual(['in', 'reset']); expectCode(model, 'REQUIRED_INPUT_MISSING');
    model.nodes.push(node('reset', 'source.constant', { value: true })); model.edges.push(edge('reset', 'operation', 'reset'));
    expect(compileModel(model).outputIds).toEqual(['result']);
    model.nodes[3]!.parameters.value = 1; expectCode(model, 'TYPE_MISMATCH');
    model.nodes[3]!.parameters.value = [false]; expectCode(model, 'SHAPE_MISMATCH');
    model.nodes[3]!.parameters.value = true; model.nodes[1]!.parameters.reset = 'none'; expectCode(model, 'UNKNOWN_INPUT_PORT');
    const selfReset = graph([node('state', 'discrete.unit-delay', { initial: false, reset: 'level' }), node('source', 'source.constant', { value: false }), node('result', 'sink.scope')], [edge('source', 'state'), edge('state', 'state', 'reset'), edge('state', 'result')]);
    expect(compileModel(selfReset).stateIds).toEqual(['state']);
  });

  it.each([
    ['source.pulse', { period: 3, width: 4 }], ['source.pulse', { period: 3, phase: 3 }],
    ['source.random', { min: 1, max: 1 }], ['source.random', { seed: 0x1_0000_0000 }], ['source.random', { variance: -1 }],
    ['source.repeating-sequence', { times: [1, 2] }], ['source.repeating-sequence', { times: [0, 1, 1], values: [0, 1, 2] }],
    ['source.repeating-sequence', { values: [true, false] }], ['lookup.interpolated', { breakpoints: [0, 1, 0] }],
    ['lookup.interpolated', { values: [1, 2, 3] }], ['discrete.delay', { steps: 1025 }],
    ['discrete.fir', { coefficients: Array(129).fill(1) }], ['discrete.fir', { coefficients: [[1, 2]] }],
    ['discrete.transfer-function', { denominator: [0, 1] }], ['discrete.transfer-function', { numerator: [1, 2, 3] }],
    ['discrete.transfer-function', { denominator: Array(33).fill(1) }], ['discrete.state-space', { A: [[1, 0]], B: [1, 1] }],
    ['discrete.state-space', { initial: Array(17).fill(0) }], ['logic.bitwise', { width: 33 }], ['logic.bitwise', { shift: 32 }],
  ] as [string, Record<string, unknown>][])('rejects bounded malformed combination %s %j', (type, parameters) => {
    const definition = blockRegistry.find((entry) => entry.id === type)!;
    const model = definition.inputs.length === 0 ? graph([node('operation', type, parameters), node('result', 'sink.scope')], [edge('operation', 'result')]) : unary(type, 1, parameters);
    expectCode(model, 'INVALID_PARAMETERS', 'operation');
  });

  it('requires scalar unsigned bitwise contracts and boolean scalar edge detection', () => {
    const model = graph([node('a', 'source.constant', { value: 1 }), node('b', 'source.constant', { value: 2 }), node('operation', 'logic.bitwise'), node('result', 'sink.scope')], [edge('a', 'operation', 'a'), edge('b', 'operation', 'b'), edge('operation', 'result')]);
    expect(compileModel(model).outputTypes.result!.shape).toEqual([]);
    model.nodes[0]!.parameters.value = [1]; expectCode(model, 'SHAPE_MISMATCH');
    model.nodes[0]!.parameters.value = 1; model.nodes[2]!.parameters.operation = 'shift-right'; model.edges.splice(1, 1);
    expect(getBlockPorts(model.nodes[2]!)).toEqual({ inputs: ['a'], outputs: ['out'] }); expect(compileModel(model).outputIds).toEqual(['result']);
    const detector = unary('logic.edge-detect', false); expect(compileModel(detector).outputTypes.result!.valueType).toBe('boolean');
    detector.nodes[1]!.parameters.initial = [false]; expectCode(detector, 'SHAPE_MISMATCH');
    detector.nodes[1]!.parameters.initial = 0; expectCode(detector, 'TYPE_MISMATCH');
  });

  it('budgets persistent delay/FIR/held outputs before allocating any state', () => {
    const model = unary('discrete.delay', Array(1024).fill(1), { initial: Array(1024).fill(0), steps: 95 });
    expectCode(model, 'STATE_BUDGET_EXCEEDED');
    model.nodes[1]!.parameters.steps = 94;
    const compiled = compileModel(model); expect(compiled.stateElements).toBe(97 * 1024);
    expect(discreteMemoryElementCount(compiled.nodes)).toBe(compiled.stateElements);
    model.nodes[1]!.blockType = 'discrete.fir'; model.nodes[1]!.parameters = { coefficients: Array(128).fill(1), initial: Array(1024).fill(0) };
    expectCode(model, 'STATE_BUDGET_EXCEEDED');
  });
});
