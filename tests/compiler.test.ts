import { M8_BLOCK_IDS } from '../packages/block-library/src/m8';
import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockDefinition, getBlockPorts } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { ModelError, type CalcEdge, type CalcModel, type CalcNode } from '../packages/model/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (id: string, from: string, to: string, port = 'in'): CalcEdge => ({ id, source: { nodeId: from, portId: 'out' }, target: { nodeId: to, portId: port } });
const graph = (nodes: CalcNode[], edges: CalcEdge[], mode: CalcModel['execution']['mode'] = 'static'): CalcModel => ({
  schemaVersion: 1, modelId: 'compiler_test', name: 'Compiler test', nodes, edges,
  execution: { mode, startTime: 0, stopTime: 1, step: 0.1 }, layout: {},
});
const validChain = (): CalcModel => graph(
  [node('result', 'sink.display'), node('gain', 'math.gain', { gain: 3 }), node('input', 'source.constant', { value: 2 })],
  [edge('edge_2', 'gain', 'result'), edge('edge_1', 'input', 'gain')],
);

function diagnosticsFor(action: () => unknown): ModelError['diagnostics'] {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(ModelError);
    return (error as ModelError).diagnostics;
  }
  throw new Error('Expected model compilation to fail');
}
function expectCode(model: unknown, code: string): void {
  expect(diagnosticsFor(() => compileModel(model)).some((diagnostic) => diagnostic.code === code)).toBe(true);
}

describe('versioned block contracts', () => {
  it('exposes immutable M1/M2 contracts and extends scalar ODE execution with M3', () => {
    expect(blockRegistry).toHaveLength(144 + M8_BLOCK_IDS.length);
    expect(blockRegistry.filter((definition) => definition.state === 'continuous-state').every((definition) => definition.shape === 'scalar' && definition.valueType === 'float64')).toBe(true);
    expect(Object.isFrozen(blockRegistry)).toBe(true);
    expect(Object.isFrozen(blockRegistry[0]!.parameters)).toBe(true);
    expect(getBlockDefinition('constructor')).toBeUndefined();
    expect(getBlockDefinition('__proto__')).toBeUndefined();
  });

  it('normalizes defaults and rejects extra parameters, non-scalar values and unknown blocks', () => {
    const defaults = validChain();
    defaults.nodes.find((entry) => entry.id === 'gain')!.parameters = {};
    expect(compileModel(defaults).nodes.find((entry) => entry.id === 'gain')!.parameters).toEqual({ gain: 2 });
    const extra = validChain();
    extra.nodes[1]!.parameters.callback = 'doAnything';
    expectCode(extra, 'INVALID_PARAMETERS');
    const array = validChain();
    array.nodes[1]!.parameters.gain = [2, 3];
    expectCode(array, 'INVALID_PARAMETERS');
    const unknown = validChain();
    unknown.nodes[1]!.blockType = 'math.unimplemented';
    expectCode(unknown, 'UNKNOWN_BLOCK');
  });
});

describe('graph validation and snapshot', () => {
  it('orders dependencies deterministically and isolates immutable snapshots', () => {
    const original = validChain();
    const compiled = compileModel(original);
    expect(compiled.nodes.map((entry) => entry.id)).toEqual(['input', 'gain', 'result']);
    original.nodes.reverse();
    original.edges.reverse();
    expect(compileModel(original).semanticKey).toBe(compiled.semanticKey);
    original.nodes.find((entry) => entry.id === 'gain')!.parameters.gain = 99;
    expect(compiled.nodes[1]!.parameters.gain).toBe(3);
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.model.nodes[0]!.parameters)).toBe(true);
    expect(Object.isFrozen(compiled.nodes[1]!.inputs)).toBe(true);
    expect(compiled.outputIds).toEqual(['result']);
  });

  it('validates required ports, endpoints, supported port names, and single writers', () => {
    const missing = validChain();
    missing.edges.pop();
    expectCode(missing, 'REQUIRED_INPUT_MISSING');
    const endpoint = validChain();
    endpoint.edges[0]!.source.nodeId = 'absent';
    expectCode(endpoint, 'UNKNOWN_ENDPOINT');
    const output = validChain();
    output.edges[0]!.source.portId = 'other';
    expectCode(output, 'UNKNOWN_OUTPUT_PORT');
    const input = validChain();
    input.edges[0]!.target.portId = 'other';
    expectCode(input, 'UNKNOWN_INPUT_PORT');
    const writers = validChain();
    writers.edges.push(edge('extra', 'input', 'result'));
    expectCode(writers, 'MULTIPLE_INPUT_WRITERS');
  });

  it('allows one producer to drive both ports without inflating its indegree', () => {
    const model = graph([node('source', 'source.constant'), node('sum', 'math.sum'), node('result', 'sink.display')],
      [edge('a', 'source', 'sum', 'a'), edge('b', 'source', 'sum', 'b'), edge('output', 'sum', 'result')]);
    const compiled = compileModel(model);
    expect(compiled.nodes.map((entry) => entry.id)).toEqual(['source', 'sum', 'result']);
    expect(compiled.nodes[1]!.inputs).toEqual({ a: { nodeId: 'source', portId: 'out' }, b: { nodeId: 'source', portId: 'out' } });
  });

  it('reports the real direct-feedthrough cycle without blaming downstream displays', () => {
    const cyclic = graph([node('gain_a', 'math.gain'), node('gain_b', 'math.gain'), node('result', 'sink.display')],
      [edge('ab', 'gain_a', 'gain_b'), edge('ba', 'gain_b', 'gain_a'), edge('output', 'gain_a', 'result')]);
    const diagnostics = diagnosticsFor(() => compileModel(cyclic));
    expect(diagnostics.map((diagnostic) => diagnostic.nodeId).sort()).toEqual(['gain_a', 'gain_b']);
    expect(diagnostics[0]!.message).toContain('gain_a → gain_b → gain_a');
  });

  it('bounds cycle diagnostics at the maximum model size instead of amplifying error payloads', () => {
    const gains = Array.from({ length: 999 }, (_, index) => node(`node_${String(index).padStart(4, '0')}_${'x'.repeat(54)}`, 'math.gain'));
    const cyclic = graph([...gains, node('result', 'sink.display')], [
      ...gains.map((entry, index) => edge(`cycle_${index}`, entry.id, gains[(index + 1) % gains.length]!.id)),
      edge('output', gains[0]!.id, 'result'),
    ]);
    const diagnostics = diagnosticsFor(() => compileModel(cyclic));
    expect(diagnostics).toHaveLength(20);
    expect(diagnostics.every((entry) => entry.code === 'CYCLIC_DEPENDENCY' && entry.nodeId !== 'result')).toBe(true);
    expect(diagnostics[0]!.message).toContain('연결 생략');
    expect(JSON.stringify(diagnostics).length).toBeLessThan(30_000);
  });

  it('preserves delayed feedback inputs while breaking current-output dependencies', () => {
    const feedback = graph([node('delay', 'discrete.unit-delay'), node('gain', 'math.gain'), node('result', 'sink.display')],
      [edge('read', 'delay', 'gain'), edge('write', 'gain', 'delay'), edge('output', 'gain', 'result')], 'discrete');
    const compiled = compileModel(feedback);
    expect(compiled.nodes.map((entry) => entry.id)).toEqual(['delay', 'gain', 'result']);
    expect(compiled.nodes[0]!.inputs).toEqual({ in: { nodeId: 'gain', portId: 'out' } });
    expect(compiled.stateIds).toEqual(['delay']);
    feedback.execution.mode = 'static';
    expectCode(feedback, 'UNSUPPORTED_MODE');
    feedback.execution.mode = 'continuous';
    expect(compileModel(feedback).nodes.every((entry) => entry.executionDomain === 'discrete')).toBe(true);
  });

  it('allows integrator feedback only in continuous mode', () => {
    const ode = graph([node('state', 'continuous.integrator', { initial: 1 }), node('decay', 'math.gain', { gain: -1 }), node('result', 'sink.display')],
      [edge('read', 'state', 'decay'), edge('derivative', 'decay', 'state'), edge('output', 'state', 'result')], 'continuous');
    expect(compileModel(ode).stateIds).toEqual(['state']);
    ode.execution.mode = 'discrete';
    expectCode(ode, 'UNSUPPORTED_MODE');
  });

  it('requires an observable output before run or export', () => {
    expectCode(graph([node('source', 'source.constant')], []), 'OUTPUT_REQUIRED');
  });
});

describe('bounded deterministic time grid', () => {
  it('rejects reverse ranges, non-grid endpoints, too many intervals, and unrepresentable steps', () => {
    const reverse = validChain();
    reverse.execution.stopTime = -1;
    expectCode(reverse, 'INVALID_TIME_RANGE');
    const nonGrid = validChain();
    nonGrid.execution = { mode: 'discrete', startTime: 0, stopTime: 1, step: 0.3 };
    expectCode(nonGrid, 'INVALID_TIME_GRID');
    const tooLong = validChain();
    tooLong.execution = { mode: 'discrete', startTime: 0, stopTime: 10001, step: 1 };
    expectCode(tooLong, 'STEP_BUDGET_EXCEEDED');
    const tiny = validChain();
    tiny.execution = { mode: 'discrete', startTime: 1e9, stopTime: 1e9, step: 1e-9 };
    expectCode(tiny, 'UNRESOLVABLE_TIME_STEP');
  });

  it('accepts decimal-grid roundoff and exactly 10,000 intervals', () => {
    const decimals = validChain();
    decimals.execution = { mode: 'discrete', startTime: 0, stopTime: 0.3, step: 0.1 };
    expect(compileModel(decimals).outputIds).toEqual(['result']);
    decimals.execution = { mode: 'discrete', startTime: 0, stopTime: 10000, step: 1 };
    expect(compileModel(decimals).outputIds).toEqual(['result']);
  });

  it('preflights the aggregate result budget across display count and time grid', () => {
    const displays = Array.from({ length: 100 }, (_, index) => node(`display_${index}`, 'sink.display'));
    const model = graph([node('source', 'source.constant'), ...displays],
      displays.map((display, index) => edge(`edge_${index}`, 'source', display.id)), 'discrete');
    model.execution.stopTime = 10000;
    model.execution.step = 1;
    expectCode(model, 'RESULT_BUDGET_EXCEEDED');
  });
});

describe('M1 typed shape inference and dynamic ports', () => {
  it('preserves typed vector and matrix outputs with immutable descriptors', () => {
    const model = validChain(); model.nodes[2]!.parameters.value = [[1, 2], [3, 4]];
    const compiled = compileModel(model);
    expect(compiled.outputTypes.result).toEqual({ valueType: 'float64', shape: [2, 2], unit: '1' });
    expect(Object.isFrozen(compiled.outputTypes.result!.shape)).toBe(true);
    expect(Object.isFrozen(compiled.nodes[0]!.parameters.value)).toBe(true);
  });

  it('broadcasts only scalar operands and diagnoses nonmatching shapes at their port', () => {
    const pair = graph([node('a', 'source.constant', { value: [[1, 2], [3, 4]] }), node('b', 'source.constant', { value: 2 }), node('sum', 'math.sum'), node('result', 'sink.display')],
      [edge('a_sum', 'a', 'sum', 'a'), edge('b_sum', 'b', 'sum', 'b'), edge('output', 'sum', 'result')]);
    expect(compileModel(pair).outputTypes.result!.shape).toEqual([2, 2]);
    pair.nodes[1]!.parameters.value = [1, 2];
    const diagnostic = diagnosticsFor(() => compileModel(pair))[0]!;
    expect(diagnostic).toMatchObject({ code: 'SHAPE_MISMATCH', nodeId: 'sum', portId: 'b' });
    pair.nodes[1]!.parameters.value = true;
    expectCode(pair, 'TYPE_MISMATCH');
  });

  it('infers boolean comparison and logic without numeric coercion', () => {
    const model = graph([node('a', 'source.constant', { value: [1, 3] }), node('b', 'source.constant', { value: 2 }), node('compare', 'logic.compare'), node('result', 'sink.display')],
      [edge('a_compare', 'a', 'compare', 'a'), edge('b_compare', 'b', 'compare', 'b'), edge('output', 'compare', 'result')]);
    expect(compileModel(model).outputTypes.result).toEqual({ valueType: 'boolean', shape: [2], unit: '1' });
    model.nodes[0]!.parameters.value = [true, false]; model.nodes[1]!.parameters.value = false; model.nodes[2]!.blockType = 'logic.boolean';
    expect(compileModel(model).outputTypes.result!.shape).toEqual([2]);
    model.nodes[2]!.parameters.operation = 'not'; model.edges.splice(1, 1);
    expect(getBlockPorts(model.nodes[2]!)).toEqual({ inputs: ['a'], outputs: ['out'] });
    expect(compileModel(model).nodes.find((entry) => entry.id === 'compare')!.inputs).toEqual({ a: { nodeId: 'a', portId: 'out' } });
    model.nodes[0]!.parameters.value = 1;
    expectCode(model, 'TYPE_MISMATCH');
  });

  it('validates switch conditions and exact branch shapes', () => {
    const model = graph([node('a', 'source.constant', { value: [1, 2] }), node('b', 'source.constant', { value: [3, 4] }), node('condition', 'source.constant', { value: true }), node('switch', 'route.switch'), node('result', 'sink.display')],
      [edge('branch_a', 'a', 'switch', 'a'), edge('branch_b', 'b', 'switch', 'b'), edge('condition_switch', 'condition', 'switch', 'condition'), edge('output', 'switch', 'result')]);
    expect(compileModel(model).outputTypes.result!.shape).toEqual([2]);
    model.nodes[2]!.parameters.value = [true]; expectCode(model, 'SHAPE_MISMATCH');
    model.nodes[2]!.parameters.value = 1; expectCode(model, 'TYPE_MISMATCH');
    model.nodes[2]!.parameters.value = true; model.nodes[1]!.parameters.value = 3; expectCode(model, 'SHAPE_MISMATCH');
  });

  it('supports reduction ports and bounded Demux output endpoints', () => {
    const model = graph([node('input', 'source.constant', { value: [1, 2, 3] }), node('demux', 'route.demux', { count: 3 }), node('result', 'sink.display')], [edge('input_demux', 'input', 'demux'), { ...edge('output', 'demux', 'result'), source: { nodeId: 'demux', portId: 'out3' } }]);
    const compiled = compileModel(model);
    expect(compiled.nodes.find((entry) => entry.id === 'result')!.inputs.in).toEqual({ nodeId: 'demux', portId: 'out3' });
    expect(compiled.nodes.find((entry) => entry.id === 'demux')!.outputs).toEqual({ out1: { valueType: 'float64', shape: [], unit: '1' }, out2: { valueType: 'float64', shape: [], unit: '1' }, out3: { valueType: 'float64', shape: [], unit: '1' } });
    model.edges[1]!.source.portId = 'out4'; expectCode(model, 'UNKNOWN_OUTPUT_PORT');
    model.edges[1]!.source.portId = 'out3'; model.nodes[1]!.parameters.count = 2; expectCode(model, 'UNKNOWN_OUTPUT_PORT');
    model.edges[1]!.source.portId = 'out1'; expectCode(model, 'SHAPE_MISMATCH');
    model.nodes[1]!.blockType = 'math.minmax'; model.nodes[1]!.parameters = { strategy: 'reduce' }; model.edges[1]!.source.portId = 'out';
    expect(compileModel(model).outputTypes.result!.shape).toEqual([]);
    expect(getBlockPorts({ blockType: 'route.demux', parameters: { count: 1e9 } }).outputs).toEqual(['out1', 'out2']);
  });

  it('concatenates bounded vectors and reshapes with an exact row-major element count', () => {
    const model = graph([node('a', 'source.constant', { value: [1, 2, 3] }), node('b', 'source.constant', { value: [4, 5, 6] }), node('mux', 'route.mux'), node('reshape', 'matrix.reshape', { form: 'matrix', rows: 2, columns: 3 }), node('result', 'io.output')],
      [edge('a_mux', 'a', 'mux', 'a'), edge('b_mux', 'b', 'mux', 'b'), edge('mux_reshape', 'mux', 'reshape'), edge('output', 'reshape', 'result')]);
    expect(compileModel(model).outputTypes.result!.shape).toEqual([2, 3]);
    model.nodes[3]!.parameters.columns = 2; expectCode(model, 'SHAPE_MISMATCH');
    model.nodes[3]!.parameters.form = 'vector';
    expect(compileModel(model).outputTypes.result!.shape).toEqual([6]);
    model.nodes[0]!.parameters.value = Array(600).fill(1); model.nodes[1]!.parameters.value = Array(600).fill(1); expectCode(model, 'SIGNAL_SIZE_EXCEEDED');
  });

  it('parses and freezes a restricted expression while preserving shape', () => {
    const model = graph([node('input', 'source.constant', { value: [1, 2] }), node('expression', 'math.expression', { expression: 'sqrt(x^2) + 1' }), node('result', 'sink.display')], [edge('input_expr', 'input', 'expression'), edge('output', 'expression', 'result')]);
    const compiled = compileModel(model);
    expect(compiled.outputTypes.result!.shape).toEqual([2]);
    expect(compiled.nodes.find((entry) => entry.id === 'expression')!.expression?.type).toBe('binary');
    expect(Object.isFrozen(compiled.nodes.find((entry) => entry.id === 'expression')!.expression)).toBe(true);
    model.nodes[1]!.parameters.expression = 'x.constructor';
    expect(diagnosticsFor(() => compileModel(model))[0]!.nodeId).toBe('expression');
  });

  it('requires a recorded sink and validates terminators without exposing output ports', () => {
    const model = graph([node('input', 'source.constant', { value: true }), node('end', 'io.terminator')], [edge('input_end', 'input', 'end')]);
    expectCode(model, 'OUTPUT_REQUIRED');
    model.nodes.push(node('result', 'io.output')); model.edges.push(edge('input_result', 'input', 'result'));
    expect(compileModel(model).outputIds).toEqual(['result']);
    model.edges[1]!.source.nodeId = 'end'; expectCode(model, 'UNKNOWN_OUTPUT_PORT');
  });
});

describe('M1 unit compatibility and M3 continuous algebraic extensions', () => {
  it('propagates source units, rejects contradictory annotations and boolean units', () => {
    const model = validChain(); model.nodes[2]!.unit = 'm';
    expect(compileModel(model).outputTypes.result!.unit).toBe('m');
    model.nodes[0]!.unit = 's'; expectCode(model, 'UNIT_ANNOTATION_MISMATCH');
    delete model.nodes[0]!.unit; model.nodes[2]!.parameters.value = true; expectCode(model, 'UNIT_MISMATCH');
  });

  it('requires equal additive units and computes approved product dimensions', () => {
    const model = graph([node('a', 'source.constant', { value: 2 }), node('b', 'source.constant', { value: 3 }), node('operation', 'math.sum'), node('result', 'sink.display')], [edge('a_op', 'a', 'operation', 'a'), edge('b_op', 'b', 'operation', 'b'), edge('output', 'operation', 'result')]);
    model.nodes[0]!.unit = 'm'; model.nodes[1]!.unit = 'm';
    expect(compileModel(model).outputTypes.result!.unit).toBe('m');
    model.nodes[1]!.unit = 's'; expectCode(model, 'UNIT_MISMATCH');
    model.nodes[2]!.blockType = 'math.multiply'; model.nodes[1]!.unit = '1';
    expect(compileModel(model).outputTypes.result!.unit).toBe('m');
    model.nodes[1]!.unit = 'm'; expect(compileModel(model).outputTypes.result!.unit).toBe('m^2');
    model.nodes[2]!.parameters.operation = 'divide';
    expect(compileModel(model).outputTypes.result!.unit).toBe('1');
    model.nodes[1]!.unit = 's'; expect(compileModel(model).outputTypes.result!.unit).toBe('m/s');
  });

  it('rejects dimensioned transcendental operations and invalid parameter options', () => {
    const model = validChain(); model.nodes[1]!.blockType = 'math.function'; model.nodes[1]!.parameters = { operation: 'exp' }; model.nodes[2]!.unit = 'm'; expectCode(model, 'UNIT_MISMATCH');
    delete model.nodes[2]!.unit; model.nodes[1]!.blockType = 'math.function'; model.nodes[1]!.parameters.operation = 'eval'; expectCode(model, 'INVALID_PARAMETERS');
    model.nodes[1]!.blockType = 'nonlinear.saturation'; model.nodes[1]!.parameters = { lower: 2, upper: 1 }; expectCode(model, 'INVALID_PARAMETERS');
  });

  it('accepts typed continuous algebraic outputs while retaining explicit units and options', () => {
    const model = validChain(); model.execution.mode = 'continuous'; model.nodes[2]!.parameters.value = [1, 2]; expect(compileModel(model).outputTypes.result!.shape).toEqual([2]);
    model.nodes[2]!.parameters.value = 2; model.nodes[2]!.unit = 'm'; expect(compileModel(model).outputTypes.result!.unit).toBe('m');
    delete model.nodes[2]!.unit; model.nodes[1]!.blockType = 'math.abs'; model.nodes[1]!.parameters = {}; expect(compileModel(model).outputTypes.result!.unit).toBe('1');
    const sum = graph([node('input', 'source.constant'), node('sum', 'math.sum', { signs: '+-' }), node('result', 'sink.display')], [edge('a', 'input', 'sum', 'a'), edge('b', 'input', 'sum', 'b'), edge('output', 'sum', 'result')], 'continuous');
    expect(compileModel(sum).nodes.find((entry) => entry.id === 'sum')!.parameters.signs).toBe('+-');
  });

  it('bounds the sum of all live port elements before runtime allocation', () => {
    const gains = Array.from({ length: 98 }, (_, index) => node(`gain_${index}`, 'math.gain'));
    const model = graph([node('source', 'source.constant', { value: Array(1024).fill(1) }), ...gains, node('result', 'sink.display')], [edge('start', 'source', gains[0]!.id), ...gains.slice(1).map((entry, index) => edge(`link_${index}`, gains[index]!.id, entry.id)), edge('output', gains.at(-1)!.id, 'result')]);
    expectCode(model, 'INTERMEDIATE_BUDGET_EXCEEDED');
    model.nodes[0]!.parameters.value = Array(1000).fill(1);
    expect(compileModel(model).outputTypes.result!.shape).toEqual([1000]);
  });
});
