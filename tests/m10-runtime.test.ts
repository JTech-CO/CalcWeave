import { describe, expect, it } from 'vitest';
import { ModelError, type BlockType, type IRNode, type SignalDescriptor, type SignalValue, type TypedCell, type TypedDataType, type TypedSignal } from '../packages/model/src/types';
import { cloneTypedSignal, typedDescriptor } from '../packages/model/src/typed';
import { getBlockDefinition } from '../packages/block-library/src';
import { M10_BLOCK_IDS } from '../packages/block-library/src/m10';
import { evaluateM10Node, m10CommitState, m10IndependentOutput, m10InitialMemory, m10InitialOutput, m10OperationCost, m10ReadState } from '../packages/runtime/src/m10';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';

const type = (dtype: TypedDataType['dtype']): TypedDataType => ({ dtype });
const ftype = (wordLength = 8, fractionLength = 2, signed = true): TypedDataType => ({ dtype: 'fixed', fixed: { wordLength, fractionLength, signed } });
const signal = (type: TypedDataType, data: TypedCell[], shape: number[] = []): TypedSignal => ({ kind: 'typed', ...type, shape, data });
const s = (dtype: TypedDataType['dtype'], data: TypedCell[], shape: number[] = []): TypedSignal => signal(type(dtype), data, shape);
function node(blockType: string, parameters: Record<string, unknown> = {}, outputs: Record<string, SignalDescriptor> = {}): IRNode {
  const definition = getBlockDefinition(blockType)!;
  return { id: 'Test', blockType: blockType as BlockType, parameters: { ...Object.fromEntries(Object.entries(definition?.parameters ?? {}).map(([key, parameter]) => [key, structuredClone(parameter.default)])), ...parameters }, inputs: {}, outputs, sampleTime: { period: 1, offset: 0 } };
}
function execute(blockType: string, inputs: Record<string, SignalValue> = {}, parameters: Record<string, unknown> = {}, output?: TypedSignal): Record<string, SignalValue> {
  return evaluateM10Node(node(blockType, parameters, output ? { out: typedDescriptor(output) } : {}), port => { if (!(port in inputs)) throw new Error(`Input ${port} was unexpectedly read`); return inputs[port]!; })!;
}
function failure(action: () => unknown, code: string): void { try { action(); } catch (error) { expect(error).toBeInstanceOf(ModelError); const diagnostics = (error as ModelError).diagnostics; expect(diagnostics.some(item => item.code === code)).toBe(true); expect(diagnostics.every(item => item.nodeId === 'Test')).toBe(true); return; } throw new Error(`Expected ${code}`); }

describe('M10 selected runtime contracts', () => {
  it('source.typed copies exact 64bit codes and source.enum copies registered labels', () => {
    const value = s('uint64', ['18446744073709551615']), result = execute('source.typed', {}, { value }); expect(result.out).toEqual(value); (result.out as TypedSignal).data[0] = '0'; expect(value.data).toEqual(['18446744073709551615']);
    const enumeration = signal({ dtype: 'enum', enum: { name: 'Mode', labels: ['Off', 'On'] } }, ['On']); expect(execute('source.enum', {}, { value: enumeration }).out).toEqual(enumeration);
  });
  it('signal.cast preserves width and maps all six public rounding choices', () => {
    const expected = { 'nearest-even': '-2', floor: '-2', ceil: '-1', 'toward-zero': '-1', nearest: '-1', away: '-2' };
    for (const [rounding, code] of Object.entries(expected)) expect((execute('signal.cast', { in: -1.5 }, { target: type('int8'), rounding }).out as TypedSignal).data).toEqual([code]);
    expect(execute('signal.cast', { in: s('int8', ['1']) }, { source: 'propagated', target: type('uint8'), propagatedTarget: type('int64') }).out).toEqual(s('int64', ['1']));
  });
  it('signal.cast-inherited uses metadata without reading reference values', () => { const output = signal(ftype(16, 4), ['0']); expect(execute('signal.cast-inherited', { in: 0.5 }, {}, output).out).toEqual(signal(ftype(16, 4), ['8'])); });
  it('signal.to-legacy enforces exact 64bit/fixed representation and finite values', () => { expect(execute('signal.to-legacy', { in: s('float32', [Math.fround(0.1)]) }).out).toBe(Math.fround(0.1)); failure(() => execute('signal.to-legacy', { in: s('uint64', ['9007199254740993']) }), 'TYPED_LEGACY_PRECISION_LOSS'); failure(() => execute('signal.to-legacy', { in: s('float64', ['NaN']) }), 'TYPED_NONFINITE_CAST'); });
  it.each(['signal.type-duplicate', 'signal.type-propagation', 'signal.unit-system'])('%s is a compiler constraint with no runtime outputs or value reads', blockType => expect(execute(blockType)).toEqual({}));
  it('signal.scaling-strip outputs stored codes using the smallest built-in width', () => { expect(execute('signal.scaling-strip', { in: signal(ftype(9, 7), ['64']) }).out).toEqual(s('int16', ['64'])); });
  it('signal.representation distinguishes local virtual alias from defensive copies', () => { const input = s('uint64', ['9007199254740993']); expect(execute('signal.representation', { in: input }, { representation: 'virtual' }).out).toBe(input); for (const representation of ['copy', 'nonvirtual']) { const output = execute('signal.representation', { in: input }, { representation }).out; expect(output).toEqual(input); expect(output).not.toBe(input); } expect(execute('signal.representation', { in: [[1, 2]] }).out).toEqual([[1, 2]]); });
  it('signal.specification checks exact numeric ranges without clipping or lossy float coercion', () => {
    expect(execute('signal.specification', { in: s('int64', ['9007199254740992']) }, { range: 'finite', lower: 0, upper: 9007199254740992 }).out).toEqual(s('int64', ['9007199254740992']));
    failure(() => execute('signal.specification', { in: s('int64', ['9007199254740993']) }, { range: 'finite', lower: 0, upper: 9007199254740992 }), 'SIGNAL_RANGE'); failure(() => execute('signal.specification', { in: [1, 2] }, { range: 'finite', lower: 0, upper: 1 }), 'SIGNAL_RANGE'); failure(() => execute('signal.specification', { in: s('float64', ['Infinity']) }, { range: 'finite' }), 'TYPED_NONFINITE_CAST');
  });
  it('signal.width counts actual cells rather than complex components or code bytes', () => { expect(execute('signal.width', { in: s('complex128', [{ re: 1, im: 2 }, { re: 3, im: 4 }], [2]) }).out).toBe(2); expect(execute('signal.width', { in: s('uint64', ['1', '2', '3'], [3]) }).out).toBe(3); expect(execute('signal.width', { in: [[1, 2], [3, 4]] }).out).toBe(4); });
  it('signal.bus-to-vector copies homogeneous legacy vector values', () => { const input = [1, 2]; const result = execute('signal.bus-to-vector', { in: input }).out; expect(result).toEqual(input); expect(result).not.toBe(input); });
  it('logic.bit-mask sets and clears exact sign/high bits in 64bit two’s complement', () => {
    expect(execute('logic.bit-mask', { in: s('int64', ['0']) }, { bits: [63], operation: 'set' }).out).toEqual(s('int64', ['-9223372036854775808'])); expect(execute('logic.bit-mask', { in: s('int64', ['-1']) }, { bits: [63], operation: 'clear' }).out).toEqual(s('int64', ['9223372036854775807'])); expect(execute('logic.bit-mask', { in: s('uint64', ['9007199254740993']) }, { bits: [53], operation: 'clear' }).out).toEqual(s('uint64', ['1']));
  });
  it('logic.extract-bits preserves unsigned extraction from signed values', () => { expect(execute('logic.extract-bits', { in: s('int64', ['-9223372036854775808']) }, { low: 63, high: 63 }, s('uint8', ['0'])).out).toEqual(s('uint8', ['1'])); expect(execute('logic.extract-bits', { in: s('int16', ['-1']) }, { low: 4, high: 11 }, s('uint8', ['0'])).out).toEqual(s('uint8', ['255'])); });
  it('logic.float-extract-bits uses canonical tagged quiet NaN and exact signed zero bits', () => {
    expect(execute('logic.float-extract-bits', { in: s('float64', ['NaN']) }, { part: 'all' }, s('uint64', ['0'])).out).toEqual(s('uint64', ['9221120237041090560']));
    expect(execute('logic.float-extract-bits', { in: s('float64', ['-0']) }, { part: 'all' }, s('uint64', ['0'])).out).toEqual(s('uint64', ['9223372036854775808']));
    expect(execute('logic.float-extract-bits', { in: s('float32', ['NaN']) }, { part: 'fraction' }, s('uint32', ['0'])).out).toEqual(s('uint32', ['4194304'])); expect(execute('logic.float-extract-bits', { in: s('float32', [1]) }, { part: 'exponent' }, s('uint8', ['0'])).out).toEqual(s('uint8', ['127']));
    expect(execute('logic.float-extract-bits', { in: s('float64', ['-Infinity']) }, { part: 'sign' }, s('uint8', ['0'])).out).toEqual(s('uint8', ['1']));
  });
  it.each(['msb-first', 'lsb-first'])('logic.integer-to-bits and bits-to-integer preserve both orders %s', order => {
    const positive = execute('logic.integer-to-bits', { in: s('uint64', ['9223372036854775809']) }, { width: 64, order }).out as TypedSignal; expect(positive.data[0]).toBe(true); expect(positive.data[63]).toBe(true); expect(positive.data.filter(Boolean)).toHaveLength(2); expect(execute('logic.bits-to-integer', { in: positive }, { target: type('uint64'), order }).out).toEqual(s('uint64', ['9223372036854775809']));
    expect(execute('logic.bits-to-integer', { in: s('boolean', Array(8).fill(true), [8]) }, { target: type('int16'), order }).out).toEqual(s('int16', ['-1']));
  });
  it('logic.integer-to-bits refuses values outside the requested signed/unsigned width', () => { failure(() => execute('logic.integer-to-bits', { in: s('int8', ['127']) }, { width: 7 }), 'TYPED_BIT_RANGE'); failure(() => execute('logic.integer-to-bits', { in: s('uint8', ['128']) }, { width: 7 }), 'TYPED_BIT_RANGE'); expect((execute('logic.integer-to-bits', { in: s('int8', ['-1']) }, { width: 1 }).out as TypedSignal).data).toEqual([true]); });
  it('logic.shift-arithmetic extends sign, checks left overflow and separates binary-point scale shift', () => {
    expect(execute('logic.shift-arithmetic', { in: s('int64', ['-3']) }, { shift: 1 }).out).toEqual(s('int64', ['-2'])); expect(execute('logic.shift-arithmetic', { in: s('uint8', ['128']) }, { shift: -1, overflow: 'wrap' }).out).toEqual(s('uint8', ['0'])); failure(() => execute('logic.shift-arithmetic', { in: s('int8', ['127']) }, { shift: -1, overflow: 'error' }), 'TYPED_OVERFLOW');
    expect(execute('logic.shift-arithmetic', { in: signal(ftype(8, 2), ['3']) }, { shift: 1, mode: 'binary-point' }, signal(ftype(8, 3), ['0'])).out).toEqual(signal(ftype(8, 3), ['3']));
  });
  it('logic.bitwise-typed applies exact 64bit not/xor with scalar broadcast', () => { expect(execute('logic.bitwise-typed', { a: s('int64', ['0']) }, { operation: 'not' }).out).toEqual(s('int64', ['-1'])); expect(execute('logic.bitwise-typed', { a: s('uint64', ['9007199254740993']), b: s('uint64', ['1', '9007199254740992'], [2]) }, { operation: 'xor' }).out).toEqual(s('uint64', ['9007199254740992', '1'], [2])); });
  it('fixed.integer-increment changes stored code by one and applies explicit overflow', () => { expect(execute('fixed.integer-increment', { in: signal(ftype(), ['3']) }, { delta: 1 }).out).toEqual(signal(ftype(), ['4'])); expect(execute('fixed.integer-increment', { in: signal(ftype(8, 2, false), ['255']) }, { delta: 1, overflow: 'wrap' }).out).toEqual(signal(ftype(8, 2, false), ['0'])); });
  it.each(['sin', 'cos'])('fixed.trigonometric matches the independent W4/N3 octant code table for %s', operation => {
    const phase = s('float64', [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], [8]); const expected = operation === 'sin' ? ['0', '3', '4', '3', '0', '-3', '-4', '-3'] : ['4', '3', '0', '-3', '-4', '-3', '0', '3'];
    expect(execute('fixed.trigonometric', { in: phase }, { wordLength: 4, points: 3, operation }, signal(ftype(4, 2), Array(8).fill('0'), [8])).out).toEqual(signal(ftype(4, 2), expected, [8]));
  });
  it('fixed.trigonometric is the selected interpolated LUT rather than direct sin quantization', () => {
    const output = signal(ftype(4, 2), ['0']); expect(execute('fixed.trigonometric', { in: 0.125 }, { wordLength: 4, points: 2 }, output).out).toEqual(signal(ftype(4, 2), ['2']));
    for (const [phase, code] of [[0.0625, '2'], [0.5625, '-2'], [0.1875, '4']] as const) expect((execute('fixed.trigonometric', { in: phase }, { wordLength: 4, points: 3 }, output).out as TypedSignal).data).toEqual([code]);
    expect((execute('fixed.trigonometric', { in: s('uint64', ['18446744073709551615']) }, { wordLength: 4, points: 3 }, output).out as TypedSignal).data).toEqual(['0']);
  });
  it('complex.from-parts/to-parts preserve scalar broadcast, signed zero and owned components', () => { const output = execute('complex.from-parts', { real: -1, imag: s('float64', [0, '-0'], [2]) }).out as TypedSignal; expect(output).toEqual(s('complex128', [{ re: -1, im: 0 }, { re: -1, im: '-0' }], [2])); expect(execute('complex.to-parts', { in: output })).toEqual({ real: s('float64', [-1, -1], [2]), imag: s('float64', [0, '-0'], [2]) }); });
  it('complex.from-polar/to-polar preserve principal angle and reject negative magnitudes', () => { const complex = execute('complex.from-polar', { magnitude: 2, angle: 0 }).out; expect(complex).toEqual(s('complex128', [{ re: 2, im: 0 }])); expect(execute('complex.to-polar', { in: s('complex128', [{ re: -1, im: '-0' }]) })).toEqual({ magnitude: s('float64', [1]), angle: s('float64', [-Math.PI]) }); failure(() => execute('complex.from-polar', { magnitude: -1, angle: 0 }), 'TYPED_COMPLEX_MAGNITUDE'); });
  it('complex.hermitian/is-hermitian conjugate square matrices and check diagonal phase', () => { const input = s('complex128', [{ re: 1, im: 0 }, { re: 2, im: 3 }, { re: 2, im: -3 }, { re: 4, im: 0 }], [2, 2]); expect(execute('complex.is-hermitian', { in: input }).out).toEqual(s('boolean', [true])); expect((execute('complex.hermitian', { in: input }).out as TypedSignal).data).toEqual([{ re: 1, im: '-0' }, { re: 2, im: 3 }, { re: 2, im: -3 }, { re: 4, im: '-0' }]); });
  it('complex.dot conjugates the first vector and exposes the independent unconjugated choice', () => {
    const a = s('complex128', [{ re: 1, im: 2 }, { re: 3, im: -4 }], [2]), b = s('complex128', [{ re: 5, im: -1 }, { re: -2, im: 6 }], [2]);
    expect(execute('complex.dot', { a, b }).out).toEqual(s('complex128', [{ re: -27, im: -1 }])); expect(execute('complex.dot', { a, b }, { conjugateFirst: 'no' }).out).toEqual(s('complex128', [{ re: 25, im: 35 }]));
  });
  it('typed.math applies exact fixed/integer stages and actual binary32 rounding', () => { expect(execute('typed.math', { a: s('uint64', ['9007199254740993']), b: s('uint64', ['1']) }).out).toEqual(s('uint64', ['9007199254740994'])); expect(execute('typed.math', { a: s('float32', [16777216]), b: s('float32', [1]) }).out).toEqual(s('float32', [16777216])); });
  it('tensor reshape/permute/squeeze retain exact row-major cell order and dtype', () => { const input = s('int64', ['1', '2', '3', '4'], [2, 2]); expect(execute('tensor.reshape', { in: input }, { dimensions: [1, 2, 2, 1] }).out).toEqual(s('int64', ['1', '2', '3', '4'], [1, 2, 2, 1])); expect(execute('tensor.permute', { in: input }, { order: [1, 0] }).out).toEqual(s('int64', ['1', '3', '2', '4'], [2, 2])); expect(execute('tensor.squeeze', { in: s('int64', ['1', '2'], [1, 2, 1]) }).out).toEqual(s('int64', ['1', '2'], [2])); });
  it('returns undefined for legacy nodes and uses bounded mathematical rather than byte-multiplied costs', () => { expect(evaluateM10Node(node('math.gain'), () => 1)).toBeUndefined(); for (const id of M10_BLOCK_IDS) expect(m10OperationCost(node(id), 21, 21)).toBeGreaterThan(0); expect(m10OperationCost(node('typed.math'), 21, 21)).toBeLessThan(3_000); expect(m10OperationCost(node('math.gain'), 1, 1)).toBeUndefined(); });
});

describe('M10 fixed-point state-space read, staged rounding and atomic memory', () => {
  function stateSpace(overrides: Record<string, unknown> = {}): IRNode { const t = ftype(8, 2); return node('fixed.state-space', { A: signal(t, ['2'], [1, 1]), B: signal(t, ['4'], [1, 1]), C: signal(t, ['4'], [1, 1]), D: signal(t, ['0'], [1, 1]), initial: signal(t, ['0'], [1]), ...overrides }, { out: typedDescriptor(signal(t, ['0'], [1])) }); }
  it('reads state before commit and never reads input when D is exactly zero', () => {
    const definition = stateSpace(), initial = m10InitialMemory(definition); expect(m10IndependentOutput(definition)).toBe(true); expect(m10ReadState(definition, initial, () => { throw new Error('D0 read accessed input'); }).out.data).toEqual(['0']);
    const next = m10CommitState(definition, initial, () => signal(ftype(), ['4'], [1])); expect(next.value.data).toEqual(['4']); expect(initial.value.data).toEqual(['0']);
    expect(m10ReadState(definition, next, () => { throw new Error('D0 read accessed input'); }).out.data).toEqual(['4']); const later = m10CommitState(definition, next, () => signal(ftype(), ['4'], [1])); expect(later.value.data).toEqual(['6']); expect(next.value.data).toEqual(['4']);
  });
  it('evaluates nonzero D current input and applies rounding to each product before accumulation', () => {
    const definition = stateSpace({ D: signal(ftype(), ['2'], [1, 1]), initial: signal(ftype(), ['3'], [1]) }); expect(m10IndependentOutput(definition)).toBe(false); expect(m10ReadState(definition, m10InitialMemory(definition), () => signal(ftype(), ['3'], [1])).out.data).toEqual(['5']);
    expect(m10InitialOutput(definition, m10InitialMemory(definition)).out.data).toEqual(['3']);
    const t = ftype(), complex = node('fixed.state-space', { A: signal(t, ['2', '2', '0', '0'], [2, 2]), B: signal(t, ['0', '0'], [2, 1]), C: signal(t, ['4', '0'], [1, 2]), D: signal(t, ['0'], [1, 1]), initial: signal(t, ['1', '1'], [2]) });
    // each product 0.5 stored-code rounds to even zero; rounding their combined exact sum would be one.
    expect(m10CommitState(complex, m10InitialMemory(complex), () => signal(t, ['0'], [1])).value.data).toEqual(['0', '0']);
  });
  it('does not publish partial state after later row overflow', () => {
    const t = ftype(8, 0), definition = node('fixed.state-space', { A: signal(t, ['1', '0', '0', '2'], [2, 2]), B: signal(t, ['0', '0'], [2, 1]), C: signal(t, ['1', '0'], [1, 2]), D: signal(t, ['0'], [1, 1]), initial: signal(t, ['1', '100'], [2]), overflow: 'error' }); const memory = m10InitialMemory(definition), before = cloneTypedSignal(memory.value);
    expect(() => m10CommitState(definition, memory, () => signal(t, ['0'], [1]))).toThrow(ModelError); expect(memory.value).toEqual(before);
  });
  it('keeps independent runs and committed state storage separate', () => { const definition = stateSpace(), first = m10InitialMemory(definition), second = m10InitialMemory(definition); first.value.data[0] = '4'; expect(second.value.data).toEqual(['0']); const output = m10ReadState(definition, first, () => { throw new Error('unexpected input'); }); output.out.data[0] = '0'; expect(first.value.data).toEqual(['4']); });
});

describe('M10 integrated compiled execution', () => {
  it('runs a static exact64 pipeline and rejects typed legacy consumption with original node', async () => {
    const model = { schemaVersion: 1, modelId: 'M10Static', name: 'Exact64', nodes: [
      { id: 'A', blockType: 'source.typed', blockVersion: 1, label: 'A', parameters: { value: s('uint64', ['9007199254740993']) } },
      { id: 'B', blockType: 'source.typed', blockVersion: 1, label: 'B', parameters: { value: s('uint64', ['1']) } },
      { id: 'Math', blockType: 'typed.math', blockVersion: 1, label: 'Math', parameters: {} },
      { id: 'Output', blockType: 'sink.display', blockVersion: 1, label: 'Output', parameters: {} },
    ], edges: [{ id: 'E1', source: { nodeId: 'A', portId: 'out' }, target: { nodeId: 'Math', portId: 'a' } }, { id: 'E2', source: { nodeId: 'B', portId: 'out' }, target: { nodeId: 'Math', portId: 'b' } }, { id: 'E3', source: { nodeId: 'Math', portId: 'out' }, target: { nodeId: 'Output', portId: 'in' } }], execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 }, layout: {} };
    const result = await runModel(compileModel(model)); expect(result.samples[0]!.values.Output).toEqual(s('uint64', ['9007199254740994']));
    const bad = structuredClone(model); bad.nodes[2]!.blockType = 'math.sum'; expect(() => compileModel(bad)).toThrow(ModelError);
  });
  it.each(['discrete', 'continuous'])('runs the selected fixed state-space on the due grid in %s mode', async mode => {
    const definition = node('fixed.state-space', { A: signal(ftype(), ['2'], [1, 1]), B: signal(ftype(), ['4'], [1, 1]), C: signal(ftype(), ['4'], [1, 1]), D: signal(ftype(), ['0'], [1, 1]), initial: signal(ftype(), ['0'], [1]) });
    const model = { schemaVersion: 1, modelId: 'M10State', name: 'Fixed State', nodes: [
      { id: 'Input', blockType: 'source.typed', blockVersion: 1, label: 'Input', parameters: { value: signal(ftype(), ['4'], [1]) } },
      { id: 'State', blockType: 'fixed.state-space', blockVersion: 1, label: 'State', parameters: definition.parameters },
      { id: 'Output', blockType: 'sink.display', blockVersion: 1, label: 'Output', parameters: {} },
    ], edges: [{ id: 'E1', source: { nodeId: 'Input', portId: 'out' }, target: { nodeId: 'State', portId: 'in' } }, { id: 'E2', source: { nodeId: 'State', portId: 'out' }, target: { nodeId: 'Output', portId: 'in' } }], execution: { mode, startTime: 0, stopTime: 0.3, step: 0.1 }, layout: {} };
    const compiled = compileModel(model), result = await runModel(compiled); expect(result.samples.map(sample => (sample.values.Output as TypedSignal).data)).toEqual([['0'], ['4'], ['6'], ['7']]); expect(result.stateMemory!.State).toMatchObject({ value: signal(ftype(), ['7'], [1]) });
    expect(await runModel(compiled)).toMatchObject({ samples: result.samples, finalState: result.finalState, stateMemory: result.stateMemory });
  });
});
