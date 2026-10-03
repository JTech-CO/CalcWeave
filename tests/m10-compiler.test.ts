import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockDefinition, getBlockPorts, getDirectFeedthroughPorts } from '../packages/block-library/src';
import { M10_BLOCK_IDS, M10_BLOCK_PRESETS } from '../packages/block-library/src/m10';
import { compileModel } from '../packages/compiler/src';
import { ModelError, parseModel, type CalcEdge, type CalcModel, type CalcNode, type SignalValue, type TypedDataType, type TypedSignal } from '../packages/model/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string, port = 'in', output = 'out'): CalcEdge => ({ id: `${source}-${output}-${target}-${port}`, source: { nodeId: source, portId: output }, target: { nodeId: target, portId: port } });
const signal = (dtype: TypedDataType['dtype'], data: TypedSignal['data'], shape: number[] = [], metadata: Partial<TypedDataType> = {}): TypedSignal => ({ kind: 'typed', dtype, shape, data, ...metadata });
const fixed = (data: string[], shape: number[] = [], wordLength = 16, fractionLength = 8): TypedSignal => signal('fixed', data, shape, { fixed: { signed: true, wordLength, fractionLength } });
const int = signal('int8', ['1']);
const cmatrix = signal('complex128', [{ re: 1, im: 0 }, { re: 2, im: -1 }, { re: 2, im: 1 }, { re: 3, im: 0 }], [2, 2]);
function graph(type: string, parameters: Record<string, unknown> = {}, inputs: Record<string, SignalValue> = {}, mode: CalcModel['execution']['mode'] = 'static'): CalcModel {
  const operation = node('operation', type, parameters), ports = getBlockPorts(operation);
  const nodes = Object.entries(inputs).map(([port, value]) => node(`source_${port}`, typeof value === 'object' && value !== null && !Array.isArray(value) ? 'source.typed' : 'source.constant', { value }));
  const edges = Object.keys(inputs).map(port => edge(`source_${port}`, 'operation', port));
  if (ports.outputs.length) edges.push(edge('operation', 'result', 'in', ports.outputs[0]!));
  else { nodes.push(node('fallback', 'source.constant', { value: 0 })); edges.push(edge('fallback', 'result')); }
  return { schemaVersion: 1, modelId: 'm10-compiler', name: 'M10 compiler', nodes: [...nodes, operation, node('result', 'sink.scope')], edges, layout: {}, execution: { mode, startTime: 0, stopTime: .2, step: .1 } };
}
const codes = (model: CalcModel): string[] => { try { compileModel(model); } catch (error) { expect(error).toBeInstanceOf(ModelError); return (error as ModelError).diagnostics.map(diagnostic => diagnostic.code); } throw new Error('Expected compilation failure'); };
const setUnit = (model: CalcModel, id: string, unit: string): CalcModel => { model.nodes.find(node => node.id === id)!.unit = unit; return model; };
const operation = (model: CalcModel): CalcNode => model.nodes.find(node => node.id === 'operation')!;

function propagation(rule = 'reference-1', refs: [TypedSignal, TypedSignal] = [signal('int16', ['1']), signal('int32', ['1'])]): CalcModel {
  return { schemaVersion: 1, modelId: 'm10-backprop', name: 'M10 inverse type constraint', nodes: [
    node('source', 'source.constant', { value: 1 }), node('ref1', 'source.typed', { value: refs[0] }), node('ref2', 'source.typed', { value: refs[1] }),
    node('cast', 'signal.cast', { source: 'propagated' }), node('operation', 'signal.type-propagation', { rule }), node('result', 'sink.scope'),
  ], edges: [edge('source', 'cast'), edge('ref1', 'operation', 'ref1'), edge('ref2', 'operation', 'ref2'), edge('cast', 'operation', 'prop'), edge('cast', 'result')], layout: {}, execution: { mode: 'static', startTime: 0, stopTime: .2, step: .1 } };
}
function bus(type: string, parameters: Record<string, unknown> = {}): CalcModel {
  return { schemaVersion: 1, modelId: 'm10-bus', name: 'M10 named bus', nodes: [node('a', 'source.constant', { value: 1 }), node('b', 'source.constant', { value: 2 }), node('bus', 'route.bus-create'), node('operation', type, parameters), node('result', 'sink.scope')], edges: [edge('a', 'bus', 'a'), edge('b', 'bus', 'b'), edge('bus', 'operation'), edge('operation', 'result')], layout: {}, execution: { mode: 'static', startTime: 0, stopTime: .2, step: .1 } };
}

const contracts: { id: string; model: CalcModel; dtype: string; shape: number[] }[] = [
  { id: 'source.typed', model: graph('source.typed'), dtype: 'int8', shape: [] },
  { id: 'source.enum', model: graph('source.enum'), dtype: 'enum', shape: [] },
  { id: 'signal.cast', model: graph('signal.cast', {}, { in: 1 }), dtype: 'int8', shape: [] },
  { id: 'signal.cast-inherited', model: graph('signal.cast-inherited', {}, { in: [1, 2], reference: signal('float32', [0]) }), dtype: 'float32', shape: [2] },
  { id: 'signal.to-legacy', model: graph('signal.to-legacy', {}, { in: int }), dtype: 'float64', shape: [] },
  { id: 'signal.type-duplicate', model: graph('signal.type-duplicate', {}, { a: int, b: signal('int8', ['2'], [1]) }), dtype: 'float64', shape: [] },
  { id: 'signal.type-propagation', model: propagation(), dtype: 'int16', shape: [] },
  { id: 'signal.scaling-strip', model: graph('signal.scaling-strip', {}, { in: fixed(['1'], [], 13) }), dtype: 'int16', shape: [] },
  { id: 'signal.representation', model: graph('signal.representation', {}, { in: int }), dtype: 'int8', shape: [] },
  { id: 'signal.specification', model: graph('signal.specification', {}, { in: signal('float64', [1]) }), dtype: 'float64', shape: [] },
  { id: 'signal.width', model: graph('signal.width', {}, { in: cmatrix }), dtype: 'float64', shape: [] },
  { id: 'signal.bus-to-vector', model: bus('signal.bus-to-vector'), dtype: 'float64', shape: [2] },
  { id: 'signal.unit-system', model: graph('signal.unit-system', { allowedUnits: '["1"]' }), dtype: 'float64', shape: [] },
  { id: 'logic.bit-mask', model: graph('logic.bit-mask', {}, { in: int }), dtype: 'int8', shape: [] },
  { id: 'logic.extract-bits', model: graph('logic.extract-bits', {}, { in: signal('int16', ['1']) }), dtype: 'uint8', shape: [] },
  { id: 'logic.float-extract-bits', model: graph('logic.float-extract-bits', {}, { in: signal('float64', [1]) }), dtype: 'uint64', shape: [] },
  { id: 'logic.integer-to-bits', model: graph('logic.integer-to-bits', {}, { in: int }), dtype: 'boolean', shape: [8] },
  { id: 'logic.bits-to-integer', model: graph('logic.bits-to-integer', {}, { in: signal('boolean', [true, false, true], [3]) }), dtype: 'uint8', shape: [] },
  { id: 'logic.shift-arithmetic', model: graph('logic.shift-arithmetic', {}, { in: int }), dtype: 'int8', shape: [] },
  { id: 'logic.bitwise-typed', model: graph('logic.bitwise-typed', {}, { a: int, b: int }), dtype: 'int8', shape: [] },
  { id: 'fixed.integer-increment', model: graph('fixed.integer-increment', {}, { in: fixed(['1']) }), dtype: 'fixed', shape: [] },
  { id: 'fixed.trigonometric', model: graph('fixed.trigonometric', {}, { in: .25 }), dtype: 'fixed', shape: [] },
  { id: 'fixed.state-space', model: graph('fixed.state-space', {}, { in: fixed(['256'], [1]) }, 'discrete'), dtype: 'fixed', shape: [1] },
  { id: 'complex.from-parts', model: graph('complex.from-parts', {}, { real: [1, 2], imag: 3 }), dtype: 'complex128', shape: [2] },
  { id: 'complex.to-parts', model: graph('complex.to-parts', {}, { in: cmatrix }), dtype: 'float64', shape: [2, 2] },
  { id: 'complex.from-polar', model: graph('complex.from-polar', {}, { magnitude: 1, angle: [0, 1] }), dtype: 'complex128', shape: [2] },
  { id: 'complex.to-polar', model: graph('complex.to-polar', {}, { in: cmatrix }), dtype: 'float64', shape: [2, 2] },
  { id: 'complex.hermitian', model: graph('complex.hermitian', {}, { in: cmatrix }), dtype: 'complex128', shape: [2, 2] },
  { id: 'complex.is-hermitian', model: graph('complex.is-hermitian', {}, { in: cmatrix }), dtype: 'boolean', shape: [] },
  { id: 'complex.dot', model: graph('complex.dot', {}, { a: signal('complex128', [{ re: 1, im: 2 }], [1]), b: signal('complex128', [{ re: 3, im: 4 }], [1]) }), dtype: 'complex128', shape: [] },
  { id: 'typed.math', model: graph('typed.math', {}, { a: int, b: int }), dtype: 'int8', shape: [] },
  { id: 'tensor.reshape', model: graph('tensor.reshape', {}, { in: signal('int64', ['1', '2', '3', '4'], [4]) }), dtype: 'int64', shape: [2, 2] },
  { id: 'tensor.permute', model: graph('tensor.permute', {}, { in: signal('float32', [1, 2, 3, 4, 5, 6], [2, 3]) }), dtype: 'float32', shape: [3, 2] },
  { id: 'tensor.squeeze', model: graph('tensor.squeeze', {}, { in: signal('uint64', ['1', '2', '3', '4'], [1, 2, 1, 2]) }), dtype: 'uint64', shape: [2, 2] },
];

describe('M10 exact dtype, shape, constraint and boundary compiler', () => {
  it('keeps preceding definitions and distinguishes34 operations from10 presets', () => {
    const baseline = JSON.parse(readFileSync(new URL('../docs/baselines/m8-registry.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
    for (const definition of baseline) expect(getBlockDefinition(String(definition.id))).toEqual(definition);
    expect(M10_BLOCK_IDS).toHaveLength(34); expect(M10_BLOCK_PRESETS).toHaveLength(10);
    expect(blockRegistry.filter(definition => M10_BLOCK_IDS.includes(definition.id as typeof M10_BLOCK_IDS[number]))).toHaveLength(34);
    expect(new Set(contracts.map(contract => contract.id))).toEqual(new Set(M10_BLOCK_IDS));
    expect(new Set(blockRegistry.map(definition => definition.id)).size).toBe(blockRegistry.length);
  });
  it.each(contracts)('infers $id in every declared execution mode without mutation', entry => {
    for (const mode of getBlockDefinition(entry.id)!.supportedModes) {
      const model = structuredClone(entry.model); model.execution.mode = mode;
      const before = JSON.stringify(model), compiled = compileModel(model), descriptor = compiled.outputTypes.result!;
      expect(descriptor.typed?.dtype ?? descriptor.valueType).toBe(entry.dtype); expect(descriptor.shape).toEqual(entry.shape);
      expect(JSON.stringify(model)).toBe(before); expect(compileModel(JSON.parse(JSON.stringify(compiled.model))).semanticKey).toBe(compiled.semanticKey);
      expect(getBlockDefinition(entry.id)!.exportTargets).toEqual(['typescript']);
    }
  });
  it.each(['float64', 'float32', 'boolean', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'complex128', 'fixed', 'string', 'enum'] as const)('preserves explicit output datatype %s', dtype => {
    const metadata = dtype === 'fixed' ? { fixed: { signed: false, wordLength: 64, fractionLength: -64 } } : dtype === 'enum' ? { enum: { name: 'Mode', labels: ['A', 'B'] } } : {};
    const data = dtype === 'fixed' || /int/.test(dtype) ? ['1'] : dtype === 'boolean' ? [true] : dtype === 'complex128' ? [{ re: '-0' as const, im: 1 }] : dtype === 'string' || dtype === 'enum' ? ['A'] : [1];
    const compiled = compileModel(graph('source.typed', { value: signal(dtype, data, [], metadata) })); expect(compiled.outputTypes.result!.typed).toEqual({ dtype, ...metadata });
  });
  it.each(M10_BLOCK_PRESETS)('separates preset $id from independently registered operation', preset => {
    expect(getBlockDefinition(preset.blockType)).toBeDefined(); expect(getBlockDefinition(preset.id)).toBeUndefined();
  });
  it('uses signed integer and fixed metadata in constraints instead of a shared typed tag', () => {
    expect(codes(graph('signal.type-duplicate', {}, { a: signal('int8', ['1']), b: signal('uint8', ['1']) }))).toContain('TYPE_CONSTRAINT_MISMATCH');
    expect(codes(graph('signal.type-duplicate', {}, { a: fixed(['1'], [], 8, 4), b: fixed(['1'], [], 8, 3) }))).toContain('TYPE_CONSTRAINT_MISMATCH');
    expect(codes(graph('typed.math', {}, { a: fixed(['1'], [], 8, 4), b: fixed(['1'], [], 8, 3) }))).toContain('TYPE_MISMATCH');
    expect(codes(graph('logic.bitwise-typed', {}, { a: int, b: signal('int16', ['1']) }))).toContain('TYPE_MISMATCH');
    expect(codes(graph('signal.type-duplicate', {}, { a: signal('enum', ['A'], [], { enum: { name: 'Mode', labels: ['A'] } }), b: signal('enum', ['A'], [], { enum: { name: 'Other', labels: ['A'] } }) }))).toContain('TYPE_CONSTRAINT_MISMATCH');
  });
  it('changes the cast output through a genuine backwards constraint without overwriting the portable model', () => {
    const model = propagation('widest-integer'), compiled = compileModel(model), cast = compiled.nodes.find(node => node.id === 'cast')!;
    expect(cast.parameters.propagatedTarget).toEqual({ dtype: 'int32' }); expect(compiled.outputTypes.result!.typed).toEqual({ dtype: 'int32' });
    expect(compiled.model.nodes.find(node => node.id === 'cast')!.parameters).not.toHaveProperty('propagatedTarget');
    expect(compiled.model.nodes.find(node => node.id === 'operation')!.parameters).toEqual({ rule: 'widest-integer' });
  });
  it('rejects unresolved, incompatible, conflicting and unsupported propagation paths', () => {
    expect(codes(graph('signal.cast', { source: 'propagated' }, { in: 1 }))).toContain('TYPE_PROPAGATION_UNRESOLVED');
    expect(codes(propagation('widest-integer', [signal('int8', ['1']), signal('uint8', ['1'])]))).toContain('TYPE_PROPAGATION_RULE');
    const wrongTarget = propagation(); wrongTarget.nodes.find(node => node.id === 'cast')!.parameters.source = 'explicit'; expect(codes(wrongTarget)).toContain('TYPE_PROPAGATION_TARGET');
    const conflict = propagation(); conflict.nodes.push(node('second', 'signal.type-propagation')); conflict.edges.push(edge('ref2', 'second', 'ref1'), edge('ref2', 'second', 'ref2'), edge('cast', 'second', 'prop')); expect(codes(conflict)).toContain('TYPE_PROPAGATION_CONFLICT');
    const unsupported = propagation(); unsupported.nodes.push(node('arithmetic', 'typed.math')); unsupported.edges.push(edge('ref1', 'arithmetic', 'a'), edge('ref1', 'arithmetic', 'b')); unsupported.edges.find(link => link.target.nodeId === 'operation' && link.target.portId === 'ref1')!.source.nodeId = 'arithmetic'; expect(codes(unsupported)).toContain('TYPE_PROPAGATION_REFERENCE');
  });
  it.each(['math.gain', 'matrix.squeeze', 'matrix.reshape', 'route.mux', 'route.manual-switch', 'discrete.unit-delay'])('blocks implicit typed values at preceding block %s', id => {
    const inputs: Record<string, SignalValue> = id === 'route.mux' || id === 'route.manual-switch' ? { a: int, b: int } : { in: int };
    const model = graph(id, id === 'matrix.reshape' ? { rows: 1, columns: 1 } : {}, inputs, id === 'discrete.unit-delay' ? 'discrete' : 'static');
    expect(codes(model)).toContain('TYPE_MISMATCH');
  });
  it('allows finite legacy math only through an explicit typed-to-legacy boundary', () => {
    const model = graph('signal.to-legacy', {}, { in: signal('int64', ['12']) }); model.nodes.push(node('gain', 'math.gain', { gain: 2 })); model.edges.find(link => link.target.nodeId === 'result')!.source.nodeId = 'gain'; model.edges.push(edge('operation', 'gain'));
    expect(compileModel(model).outputTypes.result).toEqual({ valueType: 'float64', shape: [], unit: '1' });
  });
  it.each(['complex128', 'string', 'enum'] as const)('diagnoses an unsupported legacy cast from %s', dtype => {
    const value = dtype === 'complex128' ? signal(dtype, [{ re: 1, im: 2 }]) : dtype === 'string' ? signal(dtype, ['a']) : signal(dtype, ['a'], [], { enum: { name: 'Mode', labels: ['a'] } });
    expect(codes(graph('signal.to-legacy', {}, { in: value }))).toContain('TYPE_MISMATCH');
  });
  it('validates full n-D rank, shape product, permutation and explicit boundary', () => {
    const source = signal('uint64', ['1', '2'], [1, 1, 1, 1, 1, 1, 1, 2]);
    expect(compileModel(graph('tensor.permute', { order: [7, 6, 5, 4, 3, 2, 1, 0] }, { in: source })).outputTypes.result!.shape).toEqual([2, 1, 1, 1, 1, 1, 1, 1]);
    expect(codes(graph('tensor.permute', { order: [0, 0] }, { in: cmatrix }))).toContain('TYPED_AXIS');
    expect(codes(graph('tensor.reshape', { dimensions: [3, 2] }, { in: cmatrix }))).toContain('SHAPE_MISMATCH');
    expect(codes(graph('tensor.reshape', { dimensions: [32, 33] }, { in: cmatrix }))).toContain('TYPED_SHAPE');
    expect(codes(graph('signal.to-legacy', {}, { in: source }))).toContain('TYPE_MISMATCH');
  });
  it('uses actual shape elements for1024-cell typed shapes and weighted storage for aggregate budgets', () => {
    const large = signal('int64', Array.from({ length: 1024 }, (_, index) => String(index)), [1024]);
    expect(compileModel(graph('tensor.reshape', { dimensions: [32, 32] }, { in: large })).outputTypes.result!.shape).toEqual([32, 32]);
    const strings = signal('string', Array(1024).fill('a'), [1024]); expect(codes(graph('tensor.squeeze', {}, { in: strings }))).toContain('INTERMEDIATE_BUDGET_EXCEEDED');
  });
  it('retains all complex port types, physical units, and exact matrix restrictions', () => {
    const parts = setUnit(setUnit(graph('complex.from-parts', {}, { real: 1, imag: 2 }), 'source_real', 'm'), 'source_imag', 'm');
    expect(compileModel(parts).outputTypes.result!.unit).toBe('m');
    expect(codes(setUnit(graph('complex.from-parts', {}, { real: 1, imag: 2 }), 'source_real', 'm'))).toContain('UNIT_MISMATCH');
    expect(codes(setUnit(graph('complex.from-polar', {}, { magnitude: 1, angle: 1 }), 'source_angle', 's'))).toContain('UNIT_MISMATCH');
    const polar = compileModel(graph('complex.to-polar', {}, { in: cmatrix })); expect(polar.nodes.find(node => node.id === 'operation')!.outputs.angle!.unit).toBe('rad');
    expect(codes(graph('complex.hermitian', {}, { in: signal('complex128', [{ re: 1, im: 2 }]) }))).toContain('MATRIX_SHAPE');
    expect(codes(graph('complex.is-hermitian', {}, { in: signal('complex128', [{ re: 1, im: 0 }, { re: 2, im: 0 }], [1, 2]) }))).toContain('MATRIX_SHAPE');
    expect(codes(graph('complex.dot', {}, { a: cmatrix, b: cmatrix }))).toContain('SHAPE_MISMATCH');
    expect(codes(graph('complex.dot', {}, { a: int, b: int }))).toContain('TYPE_MISMATCH');
  });
  it('enforces bit widths and routes unary bitwise ports without an unused input', () => {
    expect(getBlockPorts(node('n', 'logic.bitwise-typed', { operation: 'not' }))).toEqual({ inputs: ['a'], outputs: ['out'] });
    expect(codes(graph('logic.bit-mask', { bits: [8] }, { in: int }))).toContain('TYPED_BIT_RANGE');
    expect(codes(graph('logic.bit-mask', { bits: [1, 1] }, { in: int }))).toContain('TYPED_BIT_RANGE');
    expect(codes(graph('logic.extract-bits', { low: 4, high: 3 }, { in: int }))).toContain('TYPED_BIT_RANGE');
    expect(codes(graph('logic.integer-to-bits', { width: 9 }, { in: int }))).toContain('TYPED_BIT_RANGE');
    expect(codes(graph('logic.bits-to-integer', { target: { dtype: 'float64' } }, { in: [true] }))).toContain('TYPE_MISMATCH');
    expect(codes(graph('logic.float-extract-bits', {}, { in: signal('int64', ['1']) }))).toContain('TYPE_MISMATCH');
    expect(codes(graph('logic.shift-arithmetic', { shift: 8 }, { in: int }))).toContain('TYPED_BIT_RANGE');
  });
  it('changes binary-point scaling without silently switching to real-value division', () => {
    const compiled = compileModel(graph('logic.shift-arithmetic', { shift: 3, mode: 'binary-point' }, { in: fixed(['3'], [], 8, 4) }));
    expect(compiled.outputTypes.result!.typed!.fixed).toEqual({ signed: true, wordLength: 8, fractionLength: 1 });
    expect(codes(graph('logic.shift-arithmetic', { shift: 1, mode: 'binary-point' }, { in: fixed(['1'], [], 8, -64) }))).toContain('TYPED_FIXED_RANGE');
  });
  it('requires an explicit held boundary for continuous quantization and preserves smooth float64 paths', () => {
    const changing = graph('signal.cast', { target: { dtype: 'int8' } }, { in: 0 }, 'continuous');
    const source = changing.nodes.find(node => node.id === 'source_in')!; source.blockType = 'source.ramp'; source.parameters = {};
    expect(codes(changing)).toContain('TYPED_CONTINUOUS_BOUNDARY_REQUIRED');
    changing.nodes.push(node('hold', 'time.zero-order-hold')); changing.edges.find(link => link.target.nodeId === 'operation')!.source.nodeId = 'hold'; changing.edges.push(edge('source_in', 'hold'));
    const held = compileModel(changing); expect(held.nodes.find(node => node.id === 'operation')!.executionDomain).toBe('discrete');
    const lut = graph('fixed.trigonometric', {}, { in: 0 }, 'continuous'); lut.nodes.find(node => node.id === 'source_in')!.blockType = 'source.ramp'; lut.nodes.find(node => node.id === 'source_in')!.parameters = {};
    expect(codes(lut)).toContain('TYPED_CONTINUOUS_BOUNDARY_REQUIRED');
    const smooth = graph('signal.cast', { target: { dtype: 'float64' } }, { in: 0 }, 'continuous'); smooth.nodes.find(node => node.id === 'source_in')!.blockType = 'source.ramp'; smooth.nodes.find(node => node.id === 'source_in')!.parameters = {};
    smooth.nodes.push(node('boundary', 'signal.to-legacy'), node('integrator', 'continuous.integrator')); smooth.edges.find(link => link.target.nodeId === 'result')!.source.nodeId = 'integrator'; smooth.edges.push(edge('operation', 'boundary'), edge('boundary', 'integrator'));
    expect(compileModel(smooth).outputTypes.result!.valueType).toBe('float64');
    const fixedState = compileModel(contracts.find(contract => contract.id === 'fixed.state-space')!.model); expect(fixedState.stateIds).toEqual(['operation']);
    const hybrid = structuredClone(contracts.find(contract => contract.id === 'fixed.state-space')!.model); hybrid.execution.mode = 'continuous'; expect(compileModel(hybrid).nodes.find(node => node.id === 'operation')!.executionDomain).toBe('discrete');
  });
  it('validates fixed state-space coefficient axes, scale and read-before-write dependencies', () => {
    const valid = graph('fixed.state-space', {}, { in: fixed(['1'], [1]) }, 'discrete'), compiled = compileModel(valid), state = compiled.nodes.find(node => node.id === 'operation')!;
    expect(getDirectFeedthroughPorts(state)).toEqual([]);
    operation(valid).parameters.D = fixed(['1'], [1, 1]); expect(getDirectFeedthroughPorts(compileModel(valid).nodes.find(node => node.id === 'operation')!)).toEqual(['in']);
    const badScale = graph('fixed.state-space', { A: fixed(['1'], [1, 1], 16, 7) }, { in: fixed(['1'], [1]) }, 'discrete'); expect(codes(badScale)).toContain('TYPE_MISMATCH');
    expect(codes(graph('fixed.state-space', {}, { in: fixed(['1']) }, 'discrete'))).toContain('TYPED_STATE_SPACE_SHAPE');
    expect(codes(graph('fixed.state-space', {}, { in: fixed(['1'], [1]) }))).toContain('UNSUPPORTED_MODE');
    expect(codes(graph('fixed.trigonometric', { wordLength: 2, points: 3 }, { in: 0 }))).toContain('INVALID_PARAMETERS');
    expect(compileModel(graph('fixed.trigonometric', { wordLength: 2, points: 2 }, { in: 0 })).outputTypes.result!.typed!.fixed).toEqual({ signed: true, wordLength: 2, fractionLength: 0 });
  });
  it('preserves and changes named-bus representation while rejecting fabricated virtual tensors', () => {
    for (const representation of ['copy', 'virtual', 'nonvirtual'] as const) {
      const compiled = compileModel(bus('signal.representation', { representation })); expect(compiled.outputTypes.result!.representation).toBe(representation); expect(compiled.outputTypes.result!.fields).toEqual(['a', 'b']);
    }
    expect(codes(graph('signal.representation', { representation: 'virtual' }, { in: int }))).toContain('BUS_REPRESENTATION');
    expect(codes(graph('signal.bus-to-vector', {}, { in: [1, 2] }))).toContain('BUS_REPRESENTATION');
  });
  it('checks the project unit scope against actual inferred units and rejects conflicting configurations', () => {
    const model = graph('signal.unit-system', { allowedUnits: '["1"]' }); setUnit(model, 'fallback', 'm'); expect(codes(model)).toContain('UNIT_SYSTEM_SCOPE');
    operation(model).parameters.allowedUnits = '["1","m"]'; expect(compileModel(model).outputTypes.result!.unit).toBe('m');
    expect(compiledUnitAllowlist(model)).toEqual(['1', 'm']); expect(compileModel(model).model.nodes.find(node => node.id === 'operation')!.parameters).not.toHaveProperty('unitAllowlist');
    model.nodes.push(node('other', 'signal.unit-system')); expect(codes(model)).toContain('UNIT_SYSTEM_CONFLICT');
    expect(codes(graph('signal.unit-system', { allowedUnits: '["1","not-a-unit"]' }))).toContain('INVALID_UNIT_SYSTEM');
    expect(codes(graph('signal.unit-system', { allowedUnits: '["m"]' }))).toContain('INVALID_UNIT_SYSTEM');
  });
  it('round-trips unknown tagged dtype data for inspection but rejects executing it at its original source', () => {
    const model = graph('source.typed', { value: { kind: 'typed', dtype: 'future128', shape: [], data: ['123'] } });
    expect(parseModel(JSON.parse(JSON.stringify(model))).nodes.find(node => node.id === 'operation')!.parameters.value).toEqual(operation(model).parameters.value);
    expect(codes(model)).toContain('INVALID_PARAMETERS');
    try { compileModel(model); } catch (error) { expect((error as ModelError).diagnostics[0]!.nodeId).toBe('operation'); }
  });
});
function compiledUnitAllowlist(model: CalcModel): unknown { return compileModel(model).nodes.find(node => node.id === 'operation')!.parameters.unitAllowlist; }
