import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockPorts, isDirectFeedthrough } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { canonicalSemantic, MODEL_LIMITS, ModelError, normalizeSolverSettings, parseModel, parseModelJson, serializeModel, SOLVER_LIMITS, type CalcEdge, type CalcModel, type CalcNode } from '../packages/model/src';
import { M1_ENGINE_FIXTURES } from './m1-engine-fixtures';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, parameters, blockVersion: 1, label: id });
const edge = (source: string, target: string, port = 'in', sourcePort = 'out'): CalcEdge => ({ id: `${source}-${target}-${port}-${sourcePort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: port } });
const graph = (nodes: CalcNode[], edges: CalcEdge[]): CalcModel => ({ schemaVersion: 1, modelId: 'm3_compiler', name: 'M3 compiler', nodes, edges, execution: { mode: 'continuous', startTime: 0, stopTime: 2, step: 0.1 }, layout: {} });
const unary = (type: string, parameters: Record<string, unknown> = {}): CalcModel => graph([node('input', 'source.constant'), node('state', type, parameters), node('result', 'sink.scope')], [edge('input', 'state'), edge('state', 'result')]);
const diagnostics = (model: unknown): ModelError['diagnostics'] => {
  try { compileModel(model); } catch (error) { expect(error).toBeInstanceOf(ModelError); return (error as ModelError).diagnostics; }
  throw new Error('Expected compiler failure');
};
const expectCode = (model: unknown, code: string, nodeId?: string, portId?: string): void => {
  expect(diagnostics(model).some((diagnostic) => diagnostic.code === code && (!nodeId || diagnostic.nodeId === nodeId) && (!portId || diagnostic.portId === portId))).toBe(true);
};

describe('M3 solver contracts', () => {
  it('normalizes missing and partial settings, independently of presentation and insertion order', () => {
    const model = unary('continuous.integrator');
    const defaults = normalizeSolverSettings(model.execution);
    expect(defaults).toEqual({ method: 'rk4', initialStep: 0.1, minStep: 1e-8, maxStep: 0.1, atol: 1e-8, rtol: 1e-6, maxSteps: 100000, maxRejects: 10000, maxEvaluations: 1000000, eventTolerance: 1e-8, maxEvents: 10000, discreteStep: 0.1 });
    const original = compileModel(model);
    expect(original.model.execution.solver).toEqual(defaults);
    expect(model.execution.solver).toBeUndefined();
    const changed = structuredClone(model); changed.execution.solver = { method: 'rk4' }; changed.name = 'Presentation change'; changed.nodes.reverse(); changed.edges.reverse();
    expect(compileModel(changed).semanticKey).toBe(original.semanticKey);
    expect(canonicalSemantic(changed)).toBe(canonicalSemantic(model));
    changed.execution.solver.method = 'rk45'; expect(compileModel(changed).semanticKey).not.toBe(original.semanticKey);
    expect(Object.isFrozen(original.model.execution.solver)).toBe(true);
  });

  it.each([
    { method: 'eval' }, { minStep: 0 }, { initialStep: Number.POSITIVE_INFINITY }, { maxStep: -1 },
    { minStep: 0.2 }, { maxStep: 0.01 }, { atol: 0 }, { rtol: 2 }, { eventTolerance: 0 },
    { maxSteps: 0 }, { maxSteps: SOLVER_LIMITS.maxSteps + 1 }, { maxRejects: -1 },
    { maxEvaluations: 0 }, { maxEvents: 0 }, { discreteStep: 1e-12 }, { unexpected: true },
  ])('rejects invalid untrusted solver settings %j', (solver) => {
    const model = unary('continuous.integrator'); (model.execution as unknown as Record<string, unknown>).solver = solver;
    expect(() => parseModel(model)).toThrow(ModelError);
  });

  it('allows immediate rejection limits but keeps other caps positive, and fails closed outside continuous mode', () => {
    const model = unary('math.gain'); model.execution.solver = { method: 'rk45', maxRejects: 0 };
    expect(compileModel(model).model.execution.solver!.maxRejects).toBe(0);
    model.execution.mode = 'discrete'; expectCode(model, 'UNSUPPORTED_SOLVER');
    delete model.execution.solver; expect(compileModel(model).model.execution.solver).toBeUndefined();
    model.execution.mode = 'static'; model.execution.solver = {}; expectCode(model, 'UNSUPPORTED_SOLVER');
  });

  it('round-trips solver controls and events without admitting accessor input or changed schema', () => {
    const model = unary('continuous.integrator'); model.execution.solver = { method: 'rk45', atol: 1e-10, rtol: 1e-9 };
    const snapshot = compileModel(model).model;
    expect(parseModelJson(serializeModel(snapshot))).toEqual(snapshot);
    const unsafe = structuredClone(model); Object.defineProperty(unsafe.execution.solver!, 'method', { enumerable: true, get: () => { throw new Error('must never invoke'); } });
    expect(() => parseModel(unsafe)).toThrow(/접근자/);
  });
  it('keeps Clock units in seconds unless a continuous model explicitly normalizes to one second', () => {
    const model = graph([node('clock', 'source.clock'), node('result', 'sink.scope')], [edge('clock', 'result')]);
    expect(compileModel(model).outputTypes.result!.unit).toBe('s');
    model.nodes[0]!.unit = '1'; expect(compileModel(model).outputTypes.result!.unit).toBe('1');
    model.nodes[0]!.unit = 'm'; expectCode(model, 'UNIT_ANNOTATION_MISMATCH');
    model.nodes[0]!.unit = '1'; model.execution.mode = 'discrete'; expectCode(model, 'UNIT_ANNOTATION_MISMATCH');
    model.execution.mode = 'continuous'; model.nodes[0]!.blockType = 'source.digital-clock'; expect(compileModel(model).outputTypes.result!.unit).toBe('1');
  });
});

describe('M3 continuous dynamics, scalar inputs and realizations', () => {
  const newTypes = ['continuous.second-order-integrator', 'continuous.state-space', 'continuous.transfer-function', 'continuous.zero-pole', 'continuous.pid', 'continuous.derivative', 'time.memory', 'time.zero-order-hold', 'time.first-order-hold', 'time.transport-delay', 'logic.hit-crossing', 'nonlinear.relay'];
  it.each(newTypes)('preseeds output contract and captures dynamic state for %s', (type) => {
    const compiled = compileModel(unary(type));
    expect(compiled.stateIds).toEqual(['state']);
    expect(compiled.outputTypes.result).toEqual({ valueType: type === 'logic.hit-crossing' ? 'boolean' : 'float64', shape: [], unit: '1' });
    expect(compiled.nodes.find((entry) => entry.id === 'state')!.executionDomain).toBe(type === 'time.zero-order-hold' ? 'discrete' : 'continuous');
  });

  it('exposes position and velocity as separate second-order ports and counts all states', () => {
    const model = unary('continuous.second-order-integrator'); model.nodes.push(node('velocity', 'sink.scope')); model.edges.push(edge('state', 'velocity', 'in', 'velocity'));
    const compiled = compileModel(model);
    expect(compiled.nodes.find((entry) => entry.id === 'state')!.outputs).toEqual({ out: { valueType: 'float64', shape: [], unit: '1' }, velocity: { valueType: 'float64', shape: [], unit: '1' } });
    expect(compiled.outputIds).toEqual(['result', 'velocity']);
    expect(compiled.stateElements).toBeGreaterThanOrEqual(2);
  });

  it.each(['continuous.integrator', ...newTypes])('rejects array, boolean and dimensioned inputs for %s', (type) => {
    const model = unary(type); model.nodes[0]!.parameters.value = [1, 2]; expectCode(model, 'SHAPE_MISMATCH', 'state', 'in');
    model.nodes[0]!.parameters.value = true; expectCode(model, 'TYPE_MISMATCH', 'state', 'in');
    model.nodes[0]!.parameters.value = 1; model.nodes[0]!.unit = 'm'; expectCode(model, 'UNIT_MISMATCH', 'state', 'in');
  });

  it.each(newTypes)('keeps %s out of static and pure discrete execution', (type) => {
    const model = unary(type); model.execution.mode = 'static'; expectCode(model, 'UNSUPPORTED_MODE');
    model.execution.mode = 'discrete'; expectCode(model, 'UNSUPPORTED_MODE');
  });

  it('validates SISO dimensions, finite polynomial realizations and zero-order empty initial vectors', () => {
    const ss = unary('continuous.state-space', { A: [[-1, 0], [0, -2]], B: [1, 1], C: [1, 1], initial: [0, 0] }); expect(compileModel(ss).stateIds).toEqual(['state']);
    ss.nodes[1]!.parameters.B = [1]; expectCode(ss, 'INVALID_PARAMETERS', 'state');
    const tf = unary('continuous.transfer-function', { numerator: [1, 2, 3], denominator: [1, 2], initial: [0] }); expectCode(tf, 'INVALID_PARAMETERS');
    tf.nodes[1]!.parameters = { numerator: [1], denominator: [0, 1], initial: [0] }; expectCode(tf, 'INVALID_PARAMETERS');
    tf.nodes[1]!.parameters = { numerator: [1], denominator: [1e-308, 1e308], initial: [0] }; expectCode(tf, 'INVALID_PARAMETERS');
    tf.nodes[1]!.parameters = { numerator: [2], denominator: [1], initial: [] }; expect(compileModel(tf).stateIds).toEqual(['state']);
    tf.nodes[1]!.parameters.initial = [0]; expectCode(tf, 'INVALID_PARAMETERS');
    const zp = unary('continuous.zero-pole', { zeros: [], poles: [], gain: 2, initial: [] }); expect(compileModel(zp).stateIds).toEqual(['state']);
    zp.nodes[1]!.parameters.zeros = [1]; expectCode(zp, 'INVALID_PARAMETERS');
    zp.nodes[1]!.parameters = { zeros: [], poles: [1e308, 1e308], initial: [0, 0] }; expectCode(zp, 'INVALID_PARAMETERS');
  });

  it.each([
    ['continuous.state-space', {}, 'D', 1],
    ['continuous.transfer-function', { numerator: [1], denominator: [1, 1] }, 'numerator', [1, 1]],
    ['continuous.zero-pole', { zeros: [], poles: [-1] }, 'zeros', [0]],
    ['continuous.pid', { kp: 0, kd: 0 }, 'kp', 1],
  ] as const)('breaks state feedback only when %s has no direct feedthrough', (type, parameters, key, direct) => {
    const model = graph([node('state', type, { ...parameters }), node('feedback', 'math.gain'), node('result', 'sink.scope')], [edge('state', 'feedback'), edge('feedback', 'state'), edge('state', 'result')]);
    const compiled = compileModel(model); expect(compiled.stateIds).toEqual(['state']); expect(isDirectFeedthrough(compiled.nodes.find((entry) => entry.id === 'state')!)).toBe(false);
    model.nodes[0]!.parameters[key] = direct; expectCode(model, 'CYCLIC_DEPENDENCY');
  });

  it('rejects reversed Relay thresholds, zero delay and filter overflow', () => {
    expectCode(unary('nonlinear.relay', { onThreshold: 0, offThreshold: 1 }), 'INVALID_PARAMETERS');
    expectCode(unary('time.transport-delay', { delay: 0 }), 'INVALID_PARAMETERS');
    expectCode(unary('continuous.pid', { kd: 1e308, filterN: 1e308 }), 'INVALID_PARAMETERS');
  });
});

describe('M3 mixed domains and event boundaries', () => {
  it('preserves every M1 typed static fixture in a continuous algebraic section', () => {
    for (const fixture of M1_ENGINE_FIXTURES) {
      const model = structuredClone(fixture.model); model.execution.mode = 'continuous';
      expect(compileModel(model).outputIds).toEqual(Object.keys(fixture.expected).sort());
    }
  });

  it('requires explicit continuous-to-discrete sampling and inherits sampled sink rates', () => {
    const model = graph([node('input', 'source.ramp'), node('delay', 'discrete.unit-delay'), node('result', 'sink.scope')], [edge('input', 'delay'), edge('delay', 'result')]);
    expectCode(model, 'HYBRID_BOUNDARY_REQUIRED', 'delay', 'in');
    model.nodes.push(node('hold', 'time.zero-order-hold')); model.nodes[3]!.sampleTime = { period: 2, offset: 1 }; model.nodes[1]!.sampleTime = { period: 2, offset: 1 };
    model.edges[0] = edge('input', 'hold'); model.edges.push(edge('hold', 'delay'));
    const compiled = compileModel(model);
    expect(compiled.nodes.find((entry) => entry.id === 'hold')!.executionDomain).toBe('discrete');
    expect(compiled.nodes.find((entry) => entry.id === 'result')!.sampleTime).toEqual({ period: 2, offset: 1 });
    expect(compiled.nodes.find((entry) => entry.id === 'result')!.executionDomain).toBe('discrete');
    model.nodes[1]!.sampleTime = { period: 1, offset: 0 }; expectCode(model, 'SAMPLE_TIME_MISMATCH', 'delay');
  });

  it('allows discrete held input to an ODE and requires Rate Transition across discrete rates', () => {
    const model = graph([node('input', 'source.pulse'), node('ode', 'continuous.integrator'), node('result', 'sink.scope')], [edge('input', 'ode'), edge('ode', 'result')]);
    expect(compileModel(model).nodes.find((entry) => entry.id === 'ode')!.executionDomain).toBe('continuous');
    model.nodes[1]!.blockType = 'discrete.unit-delay'; model.nodes[1]!.sampleTime = { period: 2, offset: 0 }; expectCode(model, 'SAMPLE_TIME_MISMATCH');
    model.nodes[1]!.blockType = 'time.rate-transition'; expect(compileModel(model).nodes.find((entry) => entry.id === 'result')!.sampleTime.period).toBe(2);
  });

  it('keeps continuous sources at solver time and handles off-grid Step changes', () => {
    const model = unary('continuous.integrator'); model.nodes[0]!.blockType = 'source.step'; model.nodes[0]!.parameters = { stepTime: 0.037 };
    expect(compileModel(model).nodes.find((entry) => entry.id === 'input')!.executionDomain).toBe('continuous');
    model.nodes[0]!.sampleTime = { period: 2, offset: 0 }; expectCode(model, 'UNSUPPORTED_SAMPLE_TIME', 'input');
    delete model.nodes[0]!.sampleTime; model.nodes[0]!.blockType = 'source.clock'; model.nodes[0]!.parameters = {}; expectCode(model, 'UNIT_MISMATCH', 'state');
  });

  it('adds rising reset input only when enabled and accepts causal boolean control domains', () => {
    const model = unary('continuous.integrator'); expect(getBlockPorts(model.nodes[1]!)).toEqual({ inputs: ['in'], outputs: ['out'] });
    model.nodes[1]!.parameters.reset = 'rising'; expect(getBlockPorts(model.nodes[1]!).inputs).toEqual(['in', 'reset']); expectCode(model, 'REQUIRED_INPUT_MISSING');
    model.nodes.push(node('control', 'logic.hit-crossing')); model.edges.push(edge('input', 'control'), edge('control', 'state', 'reset'));
    expect(compileModel(model).nodes.find((entry) => entry.id === 'state')!.inputs.reset).toEqual({ nodeId: 'control', portId: 'out' });
    model.nodes[3]!.blockType = 'source.constant'; model.nodes[3]!.parameters = { value: true }; model.edges = model.edges.filter((entry) => entry.target.nodeId !== 'control'); expect(compileModel(model).stateIds).toEqual(['state']);
    model.nodes[3]!.parameters.value = [true]; expectCode(model, 'SHAPE_MISMATCH', 'state', 'reset');
  });

  it('rejects arbitrary continuous comparisons as a reset event source', () => {
    const model = unary('continuous.integrator', { reset: 'rising' }); model.nodes.push(node('time', 'source.ramp'), node('control', 'logic.compare'));
    model.edges.push(edge('time', 'control', 'a'), edge('input', 'control', 'b'), edge('control', 'state', 'reset'));
    expectCode(model, 'UNSUPPORTED_RESET_EVENT', 'state', 'reset');
    model.nodes[3]!.blockType = 'source.digital-clock'; model.nodes[3]!.unit = 's'; model.nodes[0]!.unit = 's'; expectCode(model, 'UNIT_MISMATCH', 'state', 'in');
  });

  it('bounds discrete scheduler ticks and combined state memory before execution', () => {
    const model = unary('discrete.delay'); model.execution.solver = { discreteStep: 1e-9 }; expectCode(model, 'DISCRETE_STEP_BUDGET_EXCEEDED');
    const delays = Array.from({ length: 99 }, (_, index) => node(`delay_${index}`, 'discrete.delay', { steps: 1024, initial: 0 }));
    const large = graph([node('input', 'source.constant'), ...delays, node('result', 'sink.scope')], [edge('input', delays[0]!.id), ...delays.slice(1).map((entry, index) => edge(delays[index]!.id, entry.id)), edge(delays.at(-1)!.id, 'result')]);
    expectCode(large, 'STATE_BUDGET_EXCEEDED');
    expect(MODEL_LIMITS.maxStateElements).toBe(100000); expect(blockRegistry).toHaveLength(74);
  });
  it.each([
    ['math.round', {}], ['lookup.interpolated', { interpolation: 'previous' }],
    ['math.expression', { expression: 'floor(x)' }],
  ] as const)('rejects unregistered %s jumps in ODE derivatives but permits raw sampled sinks', (type, parameters) => {
    const model = graph([node('input', 'source.ramp'), node('operation', type, { ...parameters }), node('state', 'continuous.integrator'), node('result', 'sink.scope')], [edge('input', 'operation'), edge('operation', 'state'), edge('state', 'result')]);
    expectCode(model, 'UNREGISTERED_DISCONTINUITY', 'operation');
    model.nodes.splice(2, 1); model.edges = [edge('input', 'operation'), edge('operation', 'result')]; expect(compileModel(model).outputIds).toEqual(['result']);
    model.nodes[0]!.blockType = 'source.constant'; model.nodes[0]!.parameters = { value: 0.5 }; model.nodes.push(node('state', 'continuous.integrator')); model.edges = [edge('input', 'operation'), edge('operation', 'state'), edge('state', 'result')]; expect(compileModel(model).stateIds).toEqual(['state']);
  });
  it('requires a registered event or held control for a continuous Switch driving an ODE', () => {
    const model = graph([node('input', 'source.ramp'), node('zero', 'source.constant', { value: 0 }), node('condition', 'logic.compare'), node('switch', 'route.switch'), node('state', 'continuous.integrator'), node('result', 'sink.scope')], [edge('input', 'condition', 'a'), edge('zero', 'condition', 'b'), edge('input', 'switch', 'a'), edge('zero', 'switch', 'b'), edge('condition', 'switch', 'condition'), edge('switch', 'state'), edge('state', 'result')]);
    expectCode(model, 'UNREGISTERED_DISCONTINUITY', 'switch');
    model.nodes[2]!.blockType = 'logic.hit-crossing'; model.edges = model.edges.filter((entry) => entry.target.nodeId !== 'condition').concat(edge('input', 'condition')); expect(compileModel(model).stateIds).toEqual(['condition', 'state']);
  });
  it.each(['time.zero-order-hold', 'time.first-order-hold'])('rejects a same-time %s capture loop before runtime', (type) => {
    const model = graph([node('hold', type, { initial: 1 }), node('gain', 'math.gain'), node('result', 'sink.scope')], [edge('hold', 'gain'), edge('gain', 'hold'), edge('hold', 'result')]);
    expectCode(model, 'CYCLIC_CAPTURE_DEPENDENCY', 'hold');
    const errors = diagnostics(model); expect(errors[0]!.message).toContain('이산 tick 0'); expect(errors.map((entry) => entry.nodeId).sort()).toEqual(['gain', 'hold']);
  });
  it('allows alternating-offset holds and checks only actual due ticks inside the run', () => {
    const model = graph([node('first', 'time.zero-order-hold', { initial: 1 }), node('second', 'time.first-order-hold', { initial: 2 }), node('result', 'sink.scope')], [edge('first', 'second'), edge('second', 'first'), edge('first', 'result')]);
    model.nodes[0]!.sampleTime = { period: 2, offset: 0 }; model.nodes[1]!.sampleTime = { period: 2, offset: 1 };
    expect(compileModel(model).stateIds).toEqual(['first', 'second']);
    model.nodes[1]!.sampleTime.offset = 0; expectCode(model, 'CYCLIC_CAPTURE_DEPENDENCY');
    model.nodes[0]!.sampleTime = { period: 3, offset: 2 }; model.nodes[1]!.sampleTime = { period: 3, offset: 2 }; model.execution.stopTime = 0.1;
    expect(compileModel(model).stateIds).toEqual(['first', 'second']);
    model.execution.stopTime = 0.2; expectCode(model, 'CYCLIC_CAPTURE_DEPENDENCY');
  });
  it.each([
    ['discrete.unit-delay', {}], ['time.rate-transition', {}], ['time.memory', {}],
    ['continuous.state-space', { D: 0 }], ['continuous.transfer-function', { numerator: [1], denominator: [1, 1] }],
    ['continuous.pid', { kp: 0, kd: 0 }], ['discrete.fir', { coefficients: [0, 1] }], ['discrete.state-space', { D: 0 }],
  ] as const)('preserves causal capture feedback through %s when current output has no feedthrough', (type, parameters) => {
    const model = graph([node('hold', 'time.zero-order-hold', { initial: 1 }), node('state', type, { ...parameters }), node('result', 'sink.scope')], [edge('hold', 'state'), edge('state', 'hold'), edge('hold', 'result')]);
    expect(compileModel(model).stateIds).toEqual(['hold', 'state']);
  });
  it.each([
    ['continuous.state-space', { D: 1 }], ['continuous.transfer-function', { numerator: [1, 1], denominator: [1, 1] }],
    ['continuous.pid', { kp: 1, kd: 0 }], ['discrete.fir', { coefficients: [1, 1] }], ['discrete.state-space', { D: 1 }],
  ] as const)('retains %s actual feedthrough when checking capture loops', (type, parameters) => {
    const model = graph([node('hold', 'time.zero-order-hold', { initial: 1 }), node('state', type, { ...parameters }), node('result', 'sink.scope')], [edge('hold', 'state'), edge('state', 'hold'), edge('hold', 'result')]);
    expectCode(model, 'CYCLIC_CAPTURE_DEPENDENCY');
  });
  it('uses deterministic capture diagnostics under insertion order changes', () => {
    const model = graph([node('hold', 'time.zero-order-hold'), node('gain', 'math.gain'), node('result', 'sink.scope')], [edge('hold', 'gain'), edge('gain', 'hold'), edge('hold', 'result')]);
    const original = diagnostics(model); model.nodes.reverse(); model.edges.reverse(); expect(diagnostics(model)).toEqual(original);
  });
});
