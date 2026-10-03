import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockDefinition, getBlockPorts, getDirectFeedthroughPorts } from '../packages/block-library/src';
import { M9_BLOCK_IDS, M9_BLOCK_PRESETS } from '../packages/block-library/src/m9';
import { compileModel } from '../packages/compiler/src';
import { ModelError, m9StateElementCount, parseModel, type CalcModel, type IRNode, type SignalValue } from '../packages/model/src';
import { M9_FIXTURES, m9Edge, m9Model, m9Node } from './m9-fixtures';

function graph(type: string, parameters: Record<string, unknown> = {}, inputs: Record<string, SignalValue> = {}, mode: CalcModel['execution']['mode'] = 'discrete'): CalcModel {
  return { schemaVersion: 1, modelId: 'm9-compiler-oracle', name: 'M9 compiler oracle', nodes: [
    ...Object.entries(inputs).map(([port, value]) => m9Node(`source_${port}`, 'source.constant', { value })),
    m9Node('operation', type, parameters), m9Node('result', 'sink.scope'),
  ], edges: [...Object.keys(inputs).map(port => m9Edge(`source_${port}`, 'operation', port)), m9Edge('operation', 'result')], layout: {}, execution: { mode, startTime: 0, stopTime: .2, step: .1 } };
}
function codes(model: CalcModel): string[] {
  try { compileModel(model); } catch (error) { expect(error).toBeInstanceOf(ModelError); return (error as ModelError).diagnostics.map(diagnostic => diagnostic.code); }
  throw new Error('Expected compile failure');
}
const setUnit = (model: CalcModel, id: string, unit: string): CalcModel => { model.nodes.find(node => node.id === id)!.unit = unit; return model; };

const contractGraphs: [string, Record<string, unknown>, Record<string, SignalValue>, number[], 'float64' | 'boolean'][] = [
  ['discrete.filter', { initial: [0, 0] }, { in: [1, 2] }, [2], 'float64'],
  ['discrete.filter-time-varying', { order: 1 }, { in: 1, numerator: [1, 0], denominator: [-.5] }, [], 'float64'],
  ['discrete.pid', {}, { in: 1 }, [], 'float64'], ['discrete.pid-2dof', {}, { reference: 1, measurement: 0 }, [], 'float64'],
  ['discrete.zero-pole', {}, { in: 1 }, [], 'float64'],
  ['discrete.delay-configured', { initial: [[true, false]] }, { in: [[false, true]] }, [1, 2], 'boolean'],
  ['discrete.tapped-delay', { taps: 3, initial: false }, { in: true }, [3], 'boolean'],
  ['discrete.propagation-delay', {}, { in: 1, delay: .2 }, [], 'float64'],
  ['discrete.integrator-configured', { initial: [[0, 0]] }, { in: [[1, 2]] }, [1, 2], 'float64'],
  ['discrete.state-space-mimo', { A: [[1, 0], [0, 1]], B: [[1, 0], [0, 1]], C: [[1, 0]], D: [[0, 0]], initial: [0, 0] }, { in: [1, 2] }, [1], 'float64'],
  ['discrete.difference-configured', { initial: [0, 0] }, { in: [1, 2] }, [2], 'float64'],
  ['logic.numeric-edge', { initial: [false, true], mode: 'change' }, { in: [true, false] }, [2], 'boolean'],
  ['math.running-minmax', { initial: [0, 0] }, { in: [1, 2] }, [2], 'float64'],
  ['time.weighted-math', {}, {}, [], 'float64'], ['time.decrement-to-zero', {}, { in: [1, 2] }, [2], 'float64'],
  ['signal.initial-condition', { initial: [[false, true]] }, { in: [[true, false]] }, [1, 2], 'boolean'],
  ['source.band-limited-noise', { noisePower: [.1, .2] }, {}, [2], 'float64'], ['source.counter', {}, {}, [], 'float64'],
  ['source.pwm', {}, { duty: .5 }, [], 'float64'], ['source.variable-pulse', {}, { duty: .5, period: 1 }, [], 'float64'],
  ['source.signal-generator', {}, {}, [], 'float64'], ['source.sine-configured', { amplitude: [1, 2] }, {}, [2], 'float64'],
  ['source.sequence-configured', {}, {}, [], 'float64'], ['source.random-configured', { mean: [[1, 2]], variance: .5 }, {}, [1, 2], 'float64'],
  ['verify.gradient', { initial: [0, 0] }, { in: [0, 0] }, [], 'boolean'], ['verify.resolution', {}, { in: [1, 2] }, [], 'boolean'],
];
function contractModel(entry: typeof contractGraphs[number], mode: CalcModel['execution']['mode'] = 'discrete'): CalcModel {
  const model = graph(entry[0], entry[1], entry[2], mode);
  if (entry[0] === 'discrete.propagation-delay') setUnit(model, 'source_delay', 's');
  if (entry[0] === 'source.variable-pulse') setUnit(model, 'source_period', 's');
  if (entry[0] === 'time.decrement-to-zero') setUnit(model, 'source_in', 's');
  return model;
}

describe('M9 state, rate, shape and closed compiler boundaries', () => {
  it('preserves all185 preceding definitions and separates26 new definitions from15 presets', () => {
    const baseline = JSON.parse(readFileSync(new URL('../docs/baselines/m8-registry.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
    expect(baseline).toHaveLength(185);
    for (const definition of baseline) expect(getBlockDefinition(String(definition.id))).toEqual(definition);
    const baselineIds = new Set(baseline.map(definition => definition.id));
    expect(M9_BLOCK_IDS).toHaveLength(26); expect(blockRegistry.filter(definition => baselineIds.has(definition.id) || (M9_BLOCK_IDS as readonly string[]).includes(definition.id))).toHaveLength(211); expect(M9_BLOCK_PRESETS).toHaveLength(15);
    expect(new Set(contractGraphs.map(([id]) => id))).toEqual(new Set(M9_BLOCK_IDS));
    expect(new Set(blockRegistry.map(definition => definition.id)).size).toBe(blockRegistry.length);
  });
  it.each(contractGraphs)('checks every declaredmode and typed output %s', (id, parameters, inputs, shape, valueType) => {
    const entry: typeof contractGraphs[number] = [id, parameters, inputs, shape, valueType];
    for (const mode of getBlockDefinition(id)!.supportedModes) {
      const model = contractModel(entry, mode), before = JSON.stringify(model), compiled = compileModel(model);
      expect(compiled.outputTypes.result!.shape).toEqual(shape); expect(compiled.outputTypes.result!.valueType).toBe(valueType);
      expect(JSON.stringify(model)).toBe(before); expect(getBlockDefinition(id)!.exportTargets).toEqual(['typescript']);
      expect(compileModel(JSON.parse(JSON.stringify(compiled.model))).semanticKey).toBe(compiled.semanticKey);
    }
    const model = contractModel(entry, 'static'); expect(codes(model)).toContain('UNSUPPORTED_MODE');
  });
  it.each(M9_FIXTURES)('compiles independent numerical fixture $name without mutation', entry => { const before = JSON.stringify(entry.model); compileModel(entry.model); expect(JSON.stringify(entry.model)).toBe(before); });
  it('preserves predecessor dependency ports and handles current control separately', () => {
    expect(getDirectFeedthroughPorts({ blockType: 'discrete.unit-delay', parameters: { reset: 'level' } })).toEqual([]);
    expect(getDirectFeedthroughPorts({ blockType: 'discrete.delay-configured', parameters: { mode: 'variable', allowZero: 'no', reset: 'rising', enable: 'port' } })).toEqual(['delay', 'reset', 'enable']);
    expect(getDirectFeedthroughPorts({ blockType: 'discrete.delay-configured', parameters: { mode: 'variable', allowZero: 'yes', reset: 'none' } })).toEqual(['delay', 'in']);
    expect(getDirectFeedthroughPorts({ blockType: 'discrete.filter', parameters: { numerator: [1], denominator: [1, -.5], representation: 'transfer' } })).toEqual([]);
    expect(getDirectFeedthroughPorts({ blockType: 'discrete.filter', parameters: { numerator: [1], denominator: [1, -.5], representation: 'filter' } })).toEqual(['in']);
    expect(getDirectFeedthroughPorts({ blockType: 'discrete.propagation-delay', parameters: {} })).toEqual(['delay']);
    expect(getBlockPorts({ blockType: 'time.weighted-math', parameters: { operation: 'TsOnly' } }).inputs).toEqual([]);
    expect(getBlockPorts({ blockType: 'time.weighted-math', parameters: {} }).inputs).toEqual([]);
    expect(getDirectFeedthroughPorts({ blockType: 'discrete.zero-pole', parameters: {} })).toEqual([]);
  });
  it.each(M9_BLOCK_IDS)('uses registry defaults for raw schema1 ports without changing parameters: %s', blockType => {
    const raw = { blockType, parameters: {} }, defaults = Object.fromEntries(Object.entries(getBlockDefinition(blockType)!.parameters).map(([key, parameter]) => [key, parameter.default]));
    expect(getBlockPorts(raw)).toEqual(getBlockPorts({ blockType, parameters: defaults }));
    expect(getDirectFeedthroughPorts(raw)).toEqual(getDirectFeedthroughPorts({ blockType, parameters: defaults }));
    expect(raw.parameters).toEqual({});
  });
  it('orders reset producers before current-output states and rejects immediate-reset cycles', () => {
    const model = graph('discrete.delay-configured', { reset: 'level-hold' }, { in: 1 });
    model.nodes.push(m9Node('resetProducer', 'logic.compare-constant')); model.edges.push(m9Edge('source_in', 'resetProducer'), m9Edge('resetProducer', 'operation', 'reset'));
    const ir = compileModel(model); expect(ir.nodes.findIndex(node => node.id === 'resetProducer')).toBeLessThan(ir.nodes.findIndex(node => node.id === 'operation'));
    model.edges.find(edge => edge.target.nodeId === 'resetProducer')!.source.nodeId = 'operation'; expect(codes(model)).toContain('CYCLIC_DEPENDENCY');
  });
  it('permits delayed feedback and rejects a variable zero-delay cycle', () => {
    const model = graph('discrete.delay-configured', { mode: 'variable', allowZero: 'no' }, { delay: 1 });
    model.nodes.push(m9Node('adder', 'math.bias', { bias: 1 })); model.edges.push(m9Edge('operation', 'adder'), m9Edge('adder', 'operation'));
    expect(() => compileModel(model)).not.toThrow(); model.nodes.find(node => node.id === 'operation')!.parameters.allowZero = 'yes'; expect(codes(model)).toContain('CYCLIC_DEPENDENCY');
  });
  it('orders propagation controls while retaining historical data feedback', () => {
    const model = graph('discrete.propagation-delay', {}, { delay: .2 }); setUnit(model, 'source_delay', 's');
    model.nodes.push(m9Node('feedback', 'math.bias', { bias: 1 })); model.edges.push(m9Edge('operation', 'feedback'), m9Edge('feedback', 'operation'));
    const compiled = compileModel(model); expect(compiled.nodes.findIndex(node => node.id === 'source_delay')).toBeLessThan(compiled.nodes.findIndex(node => node.id === 'operation'));
    model.edges.find(edge => edge.target.portId === 'delay')!.source.nodeId = 'feedback'; expect(codes(model)).toContain('CYCLIC_DEPENDENCY');
  });
  it.each([
    ['discrete.filter', { denominator: [0, 1] }], ['discrete.filter', { stateInitial: [1, 2] }],
    ['discrete.filter', { numerator: [1, 2, 3], representation: 'transfer' }],
    ['discrete.zero-pole', { zeros: [1, 2], poles: [1] }], ['discrete.zero-pole', { poles: [Number.MAX_VALUE, Number.MAX_VALUE] }],
    ['discrete.pid', { limit: 'clamp', lower: 1, upper: 0 }], ['discrete.integrator-configured', { limit: 'clamp', lower: 1, upper: 0 }],
    ['source.counter', { mode: 'free', bits: 2, initial: 4 }], ['source.counter', { bits: 54 }],
    ['source.random-configured', { variance: -1 }], ['source.random-configured', { distribution: 'uniform', min: 2, max: 1 }],
    ['source.band-limited-noise', { noisePower: -1 }], ['time.weighted-math', { operation: 'inverse', weight: 0 }],
    ['source.pwm', { period: .01 }], ['verify.resolution', { resolution: 1, tolerance: 2 }],
    ['discrete.delay-configured', { steps: 0, allowZero: 'no' }], ['discrete.delay-configured', { steps: 10, maxDelay: 2 }],
  ] as const)('rejects invalid bounded combinations %s %j', (id, parameters) => {
    const entry = contractGraphs.find(([type]) => type === id)!; const model = contractModel(entry); Object.assign(model.nodes.find(node => node.id === 'operation')!.parameters, parameters); expect(codes(model).length).toBeGreaterThan(0);
  });
  it('rejects dynamic coefficient width, wrong initial dtype and unsupported MIMO shape', () => {
    expect(codes(graph('discrete.filter-time-varying', { order: 2 }, { in: 1, numerator: [1, 0], denominator: [0] }))).toContain('SHAPE_MISMATCH');
    expect(codes(graph('discrete.filter', { initial: false }, { in: false }))).toContain('TYPE_MISMATCH');
    expect(codes(graph('discrete.state-space-mimo', { B: [[1, 2]], D: [[0, 0]] }, { in: 1 }))).toContain('SHAPE_MISMATCH');
    expect(codes(graph('logic.numeric-edge', { initial: false, mode: 'increase' }, { in: true }))).toContain('TYPE_MISMATCH');
  });
  it('validates time and control units and derives weighted output units', () => {
    expect(codes(graph('source.variable-pulse', {}, { duty: .5, period: 1 }))).toContain('UNIT_MISMATCH');
    const add = graph('time.weighted-math', { operation: 'add' }, { in: 1 }); expect(codes(add)).toContain('UNIT_MISMATCH'); setUnit(add, 'source_in', 's'); expect(compileModel(add).outputTypes.result!.unit).toBe('s');
    expect(compileModel(graph('time.weighted-math', { operation: 'inverse' })).outputTypes.result!.unit).toBe('Hz');
    const multiply = graph('time.weighted-math', { operation: 'multiply' }, { in: 1 }); expect(compileModel(multiply).outputTypes.result!.unit).toBe('s');
    const derivative = graph('discrete.difference-configured', { operation: 'derivative' }, { in: 1 }); expect(compileModel(derivative).outputTypes.result!.unit).toBe('Hz');
    const control = graph('discrete.filter', { enable: 'port' }, { in: 1, enable: [true] }); expect(codes(control)).toContain('CONTROL_SIGNAL');
  });
  it('bounds persistent filter channels and propagation reservations before execution', () => {
    const filter = graph('discrete.filter', { numerator: Array(33).fill(1), denominator: [1, ...Array(32).fill(0)], structure: 'df1', initial: Array(1024).fill(0) }, { in: Array(1024).fill(1) });
    const compiled = compileModel(filter), node = compiled.nodes.find(node => node.id === 'operation')!;
    expect(m9StateElementCount(node)).toBeGreaterThanOrEqual(64 * 1024);
    const queue = graph('discrete.propagation-delay', { capacity: 10000, initial: Array(10).fill(0) }, { in: Array(10).fill(1), delay: .2 }); setUnit(queue, 'source_delay', 's'); expect(codes(queue)).toContain('STATE_BUDGET_EXCEEDED');
    const reserved = contractModel(contractGraphs.find(([id]) => id === 'discrete.propagation-delay')!); reserved.nodes.find(node => node.id === 'operation')!.parameters.capacity = 7;
    expect(m9StateElementCount(compileModel(reserved).nodes.find(node => node.id === 'operation')!)).toBe(27); // previous output/control + 7(value,arrival,tick) + held value/lifecycle
    const fake: IRNode = { id: 'legacy', blockType: 'discrete.unit-delay', parameters: { initial: 0 }, inputs: {}, outputs: { out: { valueType: 'float64', shape: [], unit: '1' } }, sampleTime: { period: 1, offset: 0 } }; expect(m9StateElementCount(fake)).toBeUndefined();
  });
  it('requires explicit hybrid capture and explicit discrete rate transitions', () => {
    const hybrid = graph('discrete.filter', {}, {}, 'continuous'); hybrid.nodes.push(m9Node('clock', 'source.ramp')); hybrid.edges.push(m9Edge('clock', 'operation')); expect(codes(hybrid)).toContain('HYBRID_BOUNDARY_REQUIRED');
    const mismatch = m9Model('discrete.filter', {}, { in: [1, 2, 3] }, { period: 2 }); mismatch.nodes.find(node => node.id === 'result')!.sampleTime = { period: 1, offset: 0 }; expect(codes(mismatch)).toContain('SAMPLE_TIME_MISMATCH');
  });
  it('keeps unknown schema1 blocks and parameters for repair', () => {
    const model = graph('future.filter', { vendorValue: [1, 2, 3] }, { in: 1 }); const parsed = parseModel(JSON.parse(JSON.stringify(model))); expect(parsed.nodes.find(node => node.id === 'operation')!.parameters).toEqual({ vendorValue: [1, 2, 3] }); expect(codes(parsed)).toContain('UNKNOWN_BLOCK');
  });
});
