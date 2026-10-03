import type { CalcEdge, CalcModel, CalcNode, ExecutionMode, SignalValue, StateValue, TypedCell, TypedDataType, TypedSignal } from '../packages/model/src/types';

/** Literal expectations authored independently of production math/runtime helpers. */
export interface M10IndependentFixture {
  name: string;
  model: CalcModel;
  expected: Record<string, SignalValue[]>;
  expectedFinalState?: Record<string, SignalValue>;
  expectedStateMemory?: Record<string, StateValue>;
  presetId?: string;
  sourceIds?: string[];
  declaredModes: ExecutionMode[];
}
export const m10IndependentNode = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
export const m10IndependentEdge = (source: string, target: string, port = 'in', output = 'out'): CalcEdge => ({ id: `${source}-${output}-${target}-${port}`, source: { nodeId: source, portId: output }, target: { nodeId: target, portId: port } });
export const m10IndependentTyped = (dtype: TypedDataType['dtype'], data: TypedCell[], shape: number[] = [], metadata: Partial<TypedDataType> = {}): TypedSignal => ({ kind: 'typed', dtype, shape, data, ...metadata });
export const m10IndependentFixed = (data: string[], shape: number[] = [], wordLength = 8, fractionLength = 2, signed = true): TypedSignal => m10IndependentTyped('fixed', data, shape, { fixed: { signed, wordLength, fractionLength } });
const t = m10IndependentTyped, f = m10IndependentFixed, node = m10IndependentNode, edge = m10IndependentEdge;
const allModes: ExecutionMode[] = ['static', 'discrete', 'continuous'];
export function m10IndependentGraph(type: string, parameters: Record<string, unknown>, inputs: Record<string, SignalValue>, outputs: Record<string, SignalValue>, options: { mode?: ExecutionMode; steps?: number } = {}): CalcModel {
  const nodes = Object.entries(inputs).map(([port, value]) => node(`source_${port}`, value !== null && typeof value === 'object' && !Array.isArray(value) ? 'source.typed' : 'source.constant', { value }));
  const edges = Object.keys(inputs).map(port => edge(`source_${port}`, 'operation', port));
  nodes.push(node('operation', type, parameters));
  for (const port of Object.keys(outputs)) { nodes.push(node(`result_${port}`, 'sink.scope')); edges.push(edge('operation', `result_${port}`, 'in', port)); }
  if (!Object.keys(outputs).length) { nodes.push(node('fallback', 'source.constant', { value: 7 }), node('result_out', 'sink.scope')); edges.push(edge('fallback', 'result_out')); }
  return { schemaVersion: 1, modelId: 'm10-independent-oracle', name: 'M10 independent literal oracle', nodes, edges, layout: {}, execution: { mode: options.mode ?? 'static', startTime: 0, stopTime: (options.steps ?? 1) - 1, step: 1 } };
}
function fixture(name: string, type: string, parameters: Record<string, unknown>, inputs: Record<string, SignalValue>, outputs: Record<string, SignalValue>): M10IndependentFixture {
  return { name, model: m10IndependentGraph(type, parameters, inputs, outputs), expected: Object.fromEntries(Object.entries(Object.keys(outputs).length ? outputs : { out: 7 }).map(([port, value]) => [`result_${port}`, [value]])), declaredModes: [...allModes] };
}
function bus(name: string, representation?: string): M10IndependentFixture {
  const operation = representation === undefined ? 'signal.bus-to-vector' : 'signal.representation';
  return { name, model: { schemaVersion: 1, modelId: 'm10-independent-bus', name, nodes: [node('first', 'source.constant', { value: -3 }), node('second', 'source.constant', { value: 9 }), node('bus', 'route.bus-create'), node('operation', operation, representation === undefined ? {} : { representation }), node('result_out', 'sink.scope')], edges: [edge('first', 'bus', 'a'), edge('second', 'bus', 'b'), edge('bus', 'operation'), edge('operation', 'result_out')], layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 } }, expected: { result_out: [[-3, 9]] }, declaredModes: [...allModes] };
}
function propagation(): M10IndependentFixture {
  return { name: 'm10-independent-propagation-backconstraint', model: { schemaVersion: 1, modelId: 'm10-independent-backconstraint', name: 'M10 actual upstream cast constraint', nodes: [node('input', 'source.constant', { value: 513 }), node('ref1', 'source.typed', { value: t('uint16', ['0']) }), node('ref2', 'source.typed', { value: t('uint32', ['0']) }), node('cast', 'signal.cast', { source: 'propagated' }), node('operation', 'signal.type-propagation', { rule: 'widest-integer' }), node('result_out', 'sink.scope')], edges: [edge('input', 'cast'), edge('ref1', 'operation', 'ref1'), edge('ref2', 'operation', 'ref2'), edge('cast', 'operation', 'prop'), edge('cast', 'result_out')], layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 } }, expected: { result_out: [t('uint32', ['513'])] }, declaredModes: [...allModes] };
}
const enumType = { enum: { name: 'Machine', labels: ['idle', 'active'] } };
const phase = t('float64', [0, .125, .25, .375, .5, .625, .75, .875], [8]);
const dotA = t('complex128', [{ re: 1, im: 1 }, { re: 2, im: -3 }], [2]);
const dotB = t('complex128', [{ re: 4, im: 2 }, { re: -1, im: 5 }], [2]);
const rank8 = [1, 2, 1, 2, 1, 1, 1, 1];
const stateParameters = { A: f(['2'], [1, 1]), B: f(['4'], [1, 1]), C: f(['4'], [1, 1]), D: f(['1'], [1, 1]), initial: f(['1'], [1]), rounding: 'nearest-even', overflow: 'error' };
const state: M10IndependentFixture = { name: 'm10-independent-fixed-state-staged-rounding', model: m10IndependentGraph('fixed.state-space', stateParameters, { in: f(['4'], [1]) }, { out: f(['0'], [1]) }, { mode: 'discrete', steps: 4 }), expected: { result_out: [f(['2'], [1]), f(['5'], [1]), f(['7'], [1]), f(['8'], [1])] }, expectedFinalState: { operation: f(['8'], [1]) }, expectedStateMemory: { operation: { value: f(['7'], [1]) } }, declaredModes: ['discrete', 'continuous'] };

/** One meaningful literal pipeline for each of the34 newly declared definitions. */
export const M10_INDEPENDENT_DEFINITION_FIXTURES: M10IndependentFixture[] = [
  fixture('m10-independent-uint64-exact-source', 'source.typed', { value: t('uint64', ['18446744073709551615']) }, {}, { out: t('uint64', ['18446744073709551615']) }),
  fixture('m10-independent-enum-constant', 'source.enum', { value: t('enum', ['active'], [], enumType) }, {}, { out: t('enum', ['active'], [], enumType) }),
  fixture('m10-independent-conversion-signed-ties', 'signal.cast', { target: { dtype: 'int16' }, rounding: 'nearest-even' }, { in: t('float64', [-2.5, -1.5, 1.5, 2.5], [4]) }, { out: t('int16', ['-2', '-2', '2', '2'], [4]) }),
  fixture('m10-independent-inherited-stored-integer', 'signal.cast-inherited', { mode: 'stored-integer' }, { reference: f(['0'], [], 16, 5), in: t('float32', [5]) }, { out: f(['5'], [], 16, 5) }),
  fixture('m10-independent-lossless-legacy-fixed', 'signal.to-legacy', {}, { in: f(['17', '-9'], [2], 9, 4) }, { out: [1.0625, -.5625] }),
  fixture('m10-independent-duplicate-metadata', 'signal.type-duplicate', {}, { a: f(['1'], [], 9, 4), b: f(['3', '4'], [2], 9, 4) }, {}),
  propagation(),
  fixture('m10-independent-strip-si-not-floatbits', 'signal.scaling-strip', {}, { in: f(['17', '-9'], [2], 9, 4) }, { out: t('int16', ['17', '-9'], [2]) }),
  fixture('m10-independent-copy-above-53', 'signal.representation', { representation: 'copy' }, { in: t('uint64', ['9007199254740993']) }, { out: t('uint64', ['9007199254740993']) }),
  fixture('m10-independent-specification-rank8', 'signal.specification', { type: { dtype: 'int64' }, checkShape: 'yes', dimensions: rank8, range: 'finite', lower: 0, upper: 100 }, { in: t('int64', ['11', '12', '21', '22'], rank8) }, { out: t('int64', ['11', '12', '21', '22'], rank8) }),
  fixture('m10-independent-width-complex-elements', 'signal.width', {}, { in: t('complex128', [{ re: 1, im: 2 }, { re: 3, im: 4 }, { re: 5, im: 6 }], [1, 1, 3]) }, { out: 3 }),
  bus('m10-independent-bus-vector-order'),
  fixture('m10-independent-unit-allowlist-constraint', 'signal.unit-system', { allowedUnits: '["1"]' }, {}, {}),
  fixture('m10-independent-bit-set-sign64', 'logic.bit-mask', { operation: 'set', bits: [63, 0] }, { in: t('int64', ['0']) }, { out: t('int64', ['-9223372036854775807']) }),
  fixture('m10-independent-extract-signed-highbits', 'logic.extract-bits', { low: 12, high: 15 }, { in: t('int16', ['-32768']) }, { out: t('uint8', ['8']) }),
  fixture('m10-independent-ieee64-bit-patterns', 'logic.float-extract-bits', { part: 'all' }, { in: t('float64', [1, '-0', 'Infinity', '-Infinity', 'NaN'], [5]) }, { out: t('uint64', ['4607182418800017408', '9223372036854775808', '9218868437227405312', '18442240474082181120', '9221120237041090560'], [5]) }),
  fixture('m10-independent-integer-to-bits-signed', 'logic.integer-to-bits', { width: 4, order: 'msb-first' }, { in: t('int8', ['-6']) }, { out: t('boolean', [true, false, true, false], [4]) }),
  fixture('m10-independent-bits-to-signed-integer', 'logic.bits-to-integer', { target: { dtype: 'int8' }, order: 'msb-first' }, { in: t('boolean', [true, true, false, true], [4]) }, { out: t('int8', ['-3']) }),
  fixture('m10-independent-arithmetic-shift-negative64', 'logic.shift-arithmetic', { shift: 2 }, { in: t('int64', ['-9']) }, { out: t('int64', ['-3']) }),
  fixture('m10-independent-bitwise64-xor', 'logic.bitwise-typed', { operation: 'xor' }, { a: t('uint64', ['18446744073709551615']), b: t('uint64', ['9223372036854775808']) }, { out: t('uint64', ['9223372036854775807']) }),
  fixture('m10-independent-stored-increment-wrap', 'fixed.integer-increment', { delta: 1, overflow: 'wrap' }, { in: f(['255'], [], 8, 2, false) }, { out: f(['0'], [], 8, 2, false) }),
  fixture('m10-independent-fixed-sine-coarse-lut', 'fixed.trigonometric', { operation: 'sin', wordLength: 4, points: 2, rounding: 'nearest-even' }, { in: phase }, { out: f(['0', '2', '4', '2', '0', '-2', '-4', '-2'], [8], 4, 2) }),
  state,
  fixture('m10-independent-complex-parts-broadcast', 'complex.from-parts', {}, { real: -2, imag: t('float64', [0, '-0', 3], [3]) }, { out: t('complex128', [{ re: -2, im: 0 }, { re: -2, im: '-0' }, { re: -2, im: 3 }], [3]) }),
  fixture('m10-independent-complex-parts-separation', 'complex.to-parts', {}, { in: t('complex128', [{ re: '-0', im: 2 }, { re: 3, im: '-0' }], [2]) }, { real: t('float64', ['-0', 3], [2]), imag: t('float64', [2, '-0'], [2]) }),
  fixture('m10-independent-complex-polar-zero-angle', 'complex.from-polar', {}, { magnitude: t('float64', [2, 3], [2]), angle: 0 }, { out: t('complex128', [{ re: 2, im: 0 }, { re: 3, im: 0 }], [2]) }),
  fixture('m10-independent-complex-polar-signed-branch', 'complex.to-polar', {}, { in: t('complex128', [{ re: -1, im: 0 }, { re: -1, im: '-0' }, { re: 3, im: 4 }], [3]) }, { magnitude: t('float64', [1, 1, 5], [3]), angle: t('float64', [3.141592653589793, -3.141592653589793, .9272952180016122], [3]) }),
  fixture('m10-independent-hermitian-rectangular', 'complex.hermitian', {}, { in: t('complex128', [{ re: 1, im: 1 }, { re: 2, im: 0 }, { re: 3, im: -2 }, { re: 4, im: 3 }, { re: 5, im: -4 }, { re: 6, im: 0 }], [2, 3]) }, { out: t('complex128', [{ re: 1, im: -1 }, { re: 4, im: -3 }, { re: 2, im: '-0' }, { re: 5, im: 4 }, { re: 3, im: 2 }, { re: 6, im: '-0' }], [3, 2]) }),
  fixture('m10-independent-is-hermitian', 'complex.is-hermitian', { tolerance: 0 }, { in: t('complex128', [{ re: 2, im: 0 }, { re: 1, im: 2 }, { re: 1, im: -2 }, { re: 5, im: 0 }], [2, 2]) }, { out: t('boolean', [true]) }),
  fixture('m10-independent-complex-dot-conjugates-first', 'complex.dot', { conjugateFirst: 'yes' }, { a: dotA, b: dotB }, { out: t('complex128', [{ re: -11, im: 5 }]) }),
  fixture('m10-independent-u64-arithmetic-exact', 'typed.math', { operation: 'add' }, { a: t('uint64', ['9007199254740993']), b: t('uint64', ['2']) }, { out: t('uint64', ['9007199254740995']) }),
  fixture('m10-independent-rank8-reshape', 'tensor.reshape', { dimensions: rank8 }, { in: t('int64', ['9007199254740993', '2', '3', '4'], [4]) }, { out: t('int64', ['9007199254740993', '2', '3', '4'], rank8) }),
  fixture('m10-independent-rank8-permute', 'tensor.permute', { order: [0, 3, 2, 1, 4, 5, 6, 7] }, { in: t('int64', ['11', '12', '21', '22'], rank8) }, { out: t('int64', ['11', '21', '12', '22'], rank8) }),
  fixture('m10-independent-rank8-squeeze', 'tensor.squeeze', {}, { in: t('int64', ['11', '12', '21', '22'], rank8) }, { out: t('int64', ['11', '12', '21', '22'], [2, 2]) }),
];

const roundingExpected: Record<string, string[]> = { 'nearest-even': ['-2', '-2', '2', '2'], floor: ['-3', '-2', '1', '2'], ceil: ['-2', '-1', '2', '3'], 'toward-zero': ['-2', '-1', '1', '2'], nearest: ['-2', '-1', '2', '3'], away: ['-3', '-2', '2', '3'] };
const float32Stages: M10IndependentFixture = { name: 'm10-independent-float32-two-operation-rounding', model: { schemaVersion: 1, modelId: 'm10-independent-float32-stages', name: 'M10 binary32 staged rounding', nodes: [node('large', 'source.typed', { value: t('float32', [16777216]) }), node('one', 'source.typed', { value: t('float32', [1]) }), node('add', 'typed.math', { operation: 'add' }), node('operation', 'typed.math', { operation: 'subtract' }), node('result_out', 'sink.scope')], edges: [edge('large', 'add', 'a'), edge('one', 'add', 'b'), edge('add', 'operation', 'a'), edge('large', 'operation', 'b'), edge('operation', 'result_out')], layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 } }, expected: { result_out: [t('float32', [0])] }, declaredModes: [...allModes] };
export const M10_INDEPENDENT_BOUNDARY_FIXTURES: M10IndependentFixture[] = [
  ...Object.entries(roundingExpected).filter(([rounding]) => rounding !== 'nearest-even').map(([rounding, expected]) => fixture(`m10-independent-cast-${rounding}-negative-ties`, 'signal.cast', { target: { dtype: 'int16' }, rounding }, { in: t('float64', [-2.5, -1.5, 1.5, 2.5], [4]) }, { out: t('int16', expected, [4]) })),
  fixture('m10-independent-conversion-stored-not-ieee', 'signal.cast', { target: { dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 5 } }, mode: 'stored-integer' }, { in: t('float32', [5]) }, { out: f(['5'], [], 16, 5) }),
  fixture('m10-independent-conversion-real-world-scaling', 'signal.cast', { target: { dtype: 'fixed', fixed: { signed: true, wordLength: 16, fractionLength: 5 } }, mode: 'real-world' }, { in: t('float32', [5]) }, { out: f(['160'], [], 16, 5) }),
  fixture('m10-independent-ieee32-bit-patterns', 'logic.float-extract-bits', { part: 'all' }, { in: t('float32', [1, '-0', 'Infinity', '-Infinity', 'NaN'], [5]) }, { out: t('uint32', ['1065353216', '2147483648', '2139095040', '4286578688', '2143289344'], [5]) }),
  fixture('m10-independent-ieee64-sign', 'logic.float-extract-bits', { part: 'sign' }, { in: t('float64', ['-0', 0, -1, 1], [4]) }, { out: t('uint8', ['1', '0', '1', '0'], [4]) }),
  fixture('m10-independent-ieee64-exponent', 'logic.float-extract-bits', { part: 'exponent' }, { in: t('float64', [1, 2, .5, 'Infinity'], [4]) }, { out: t('uint16', ['1023', '1024', '1022', '2047'], [4]) }),
  fixture('m10-independent-ieee64-fraction', 'logic.float-extract-bits', { part: 'fraction' }, { in: t('float64', [1, 1.5, 1.25], [3]) }, { out: t('uint64', ['0', '2251799813685248', '1125899906842624'], [3]) }),
  fixture('m10-independent-f32-tie-down', 'signal.cast', { target: { dtype: 'float32' } }, { in: t('float64', [1.0000000596046448, 1.0000001788139343, '-0'], [3]) }, { out: t('float32', [1, 1.000000238418579, '-0'], [3]) }),
  fixture('m10-independent-int64-minimum-roundtrip', 'signal.cast', { target: { dtype: 'int64' } }, { in: t('int64', ['-9223372036854775808']) }, { out: t('int64', ['-9223372036854775808']) }),
  fixture('m10-independent-binary-point-source-positive-right', 'logic.shift-arithmetic', { shift: 1, mode: 'binary-point' }, { in: f(['7'], [], 8, 3) }, { out: f(['7'], [], 8, 2) }),
  fixture('m10-independent-fixed-cosine-n2', 'fixed.trigonometric', { operation: 'cos', wordLength: 4, points: 2 }, { in: phase }, { out: f(['4', '2', '0', '-2', '-4', '-2', '0', '2'], [8], 4, 2) }),
  fixture('m10-independent-fixed-sine-n3', 'fixed.trigonometric', { operation: 'sin', wordLength: 4, points: 3 }, { in: phase }, { out: f(['0', '3', '4', '3', '0', '-3', '-4', '-3'], [8], 4, 2) }),
  fixture('m10-independent-fixed-cosine-n3', 'fixed.trigonometric', { operation: 'cos', wordLength: 4, points: 3 }, { in: phase }, { out: f(['4', '3', '0', '-3', '-4', '-3', '0', '3'], [8], 4, 2) }),
  fixture('m10-independent-fixed-lut-ties-even', 'fixed.trigonometric', { operation: 'sin', wordLength: 4, points: 3 }, { in: t('float64', [.0625, .1875, .5625, .6875], [4]) }, { out: f(['2', '4', '-2', '-4'], [4], 4, 2) }),
  fixture('m10-independent-fixed-lut-periodic-rational', 'fixed.trigonometric', { operation: 'sin', wordLength: 4, points: 3 }, { in: t('float64', [-.125, 1.125, -.25, 1.25], [4]) }, { out: f(['-3', '3', '-4', '4'], [4], 4, 2) }),
  fixture('m10-independent-complex-dot-no-conjugate', 'complex.dot', { conjugateFirst: 'no' }, { a: dotA, b: dotB }, { out: t('complex128', [{ re: 15, im: 19 }]) }),
  fixture('m10-independent-hermitian-imaginary-diagonal-false', 'complex.is-hermitian', {}, { in: t('complex128', [{ re: 2, im: 1 }, { re: 1, im: 2 }, { re: 1, im: -2 }, { re: 5, im: 0 }], [2, 2]) }, { out: t('boolean', [false]) }),
  fixture('m10-independent-fixed-product-rounds-before-output', 'typed.math', { operation: 'multiply', rounding: 'nearest-even' }, { a: f(['3']), b: f(['2']) }, { out: f(['2']) }),
  fixture('m10-independent-float64-stage-control', 'typed.math', { operation: 'add' }, { a: t('float64', [16777216]), b: t('float64', [1]) }, { out: t('float64', [16777217]) }),
  float32Stages,
  fixture('m10-independent-rank8-all-singleton-squeeze', 'tensor.squeeze', {}, { in: t('uint64', ['9007199254740993'], [1, 1, 1, 1, 1, 1, 1, 1]) }, { out: t('uint64', ['9007199254740993']) }),
];

/** Exactly configured preset values, authored as raw literal contracts. */
export const M10_INDEPENDENT_PRESET_FIXTURES: M10IndependentFixture[] = [
  { ...fixture('m10-independent-preset-inf', 'source.typed', { value: t('float64', ['Infinity']) }, {}, { out: t('float64', ['Infinity']) }), presetId: 'm10-positive-infinity', sourceIds: ['21-002'] },
  { ...fixture('m10-independent-preset-nan', 'source.typed', { value: t('float64', ['NaN']) }, {}, { out: t('float64', ['NaN']) }), presetId: 'm10-nan', sourceIds: ['21-003'] },
  { ...fixture('m10-independent-preset-negative-inf', 'source.typed', { value: t('float64', ['-Infinity']) }, {}, { out: t('float64', ['-Infinity']) }), presetId: 'm10-negative-infinity', sourceIds: ['21-004'] },
  { ...fixture('m10-independent-preset-bit-clear', 'logic.bit-mask', { operation: 'clear' }, { in: t('uint8', ['13']) }, { out: t('uint8', ['12']) }), presetId: 'm10-bit-clear', sourceIds: ['06-001'] },
  { ...fixture('m10-independent-preset-bit-set', 'logic.bit-mask', { operation: 'set' }, { in: t('uint8', ['12']) }, { out: t('uint8', ['13']) }), presetId: 'm10-bit-set', sourceIds: ['06-002'] },
  { ...fixture('m10-independent-preset-si-decrement', 'fixed.integer-increment', { delta: -1, overflow: 'wrap' }, { in: f(['-128'], [], 8, 3) }, { out: f(['127'], [], 8, 3) }), presetId: 'm10-code-decrement', sourceIds: ['20-005'] },
  { ...fixture('m10-independent-preset-si-increment', 'fixed.integer-increment', { delta: 1, overflow: 'wrap' }, { in: f(['127'], [], 8, 3) }, { out: f(['-128'], [], 8, 3) }), presetId: 'm10-code-increment', sourceIds: ['20-009'] },
  { ...fixture('m10-independent-preset-copy', 'signal.representation', { representation: 'copy' }, { in: t('uint64', ['18446744073709551615']) }, { out: t('uint64', ['18446744073709551615']) }), presetId: 'm10-signal-copy', sourceIds: ['21-011'] },
  { ...bus('m10-independent-preset-virtual-bus', 'virtual'), presetId: 'm10-virtual-bus', sourceIds: ['21-012'] },
  { ...bus('m10-independent-preset-nonvirtual-bus', 'nonvirtual'), presetId: 'm10-nonvirtual-bus', sourceIds: ['21-013'] },
];
export const M10_INDEPENDENT_FIXTURES = [...M10_INDEPENDENT_DEFINITION_FIXTURES, ...M10_INDEPENDENT_BOUNDARY_FIXTURES];
export function m10IndependentMode(entry: M10IndependentFixture, mode: ExecutionMode): M10IndependentFixture {
  if (!entry.declaredModes.includes(mode)) throw new Error(`${entry.name}/${mode} is not declared`);
  const changed = structuredClone(entry); changed.name = `${entry.name}-${mode}`; changed.model.execution.mode = mode;
  if (entry.model.execution.mode === 'static' && mode !== 'static') { changed.model.execution.stopTime = 2; changed.expected = Object.fromEntries(Object.entries(entry.expected).map(([id, samples]) => [id, [structuredClone(samples[0]!), structuredClone(samples[0]!), structuredClone(samples[0]!)]])); }
  if (mode === 'continuous') changed.model.execution.solver = { method: 'rk4', discreteStep: 1, initialStep: .25, maxStep: .25 };
  return changed;
}

export const M10_INDEPENDENT_FAILURE_FIXTURES: { name: string; model: CalcModel; diagnosticCode: string; nodeId: string; expectedPartial?: { samples: number; finalState: Record<string, SignalValue>; stateMemory: Record<string, StateValue> } }[] = [
  { name: 'm10-independent-legacy-inexact-uint64', model: m10IndependentGraph('signal.to-legacy', {}, { in: t('uint64', ['9007199254740993']) }, { out: 0 }), diagnosticCode: 'TYPED_LEGACY_PRECISION_LOSS', nodeId: 'operation' },
  { name: 'm10-independent-cast-uint64-overflow', model: m10IndependentGraph('signal.cast', { target: { dtype: 'uint8' }, overflow: 'error' }, { in: t('uint64', ['18446744073709551615']) }, { out: t('uint8', ['0']) }), diagnosticCode: 'TYPED_OVERFLOW', nodeId: 'operation' },
  { name: 'm10-independent-fixed-state-atomic-row-failure', model: m10IndependentGraph('fixed.state-space', { A: f(['1', '0', '0', '2'], [2, 2], 8, 0), B: f(['0', '0'], [2, 1], 8, 0), C: f(['1', '0'], [1, 2], 8, 0), D: f(['0'], [1, 1], 8, 0), initial: f(['1', '100'], [2], 8, 0), overflow: 'error' }, { in: f(['0'], [1], 8, 0) }, { out: f(['1'], [1], 8, 0) }, { mode: 'discrete', steps: 3 }), diagnosticCode: 'TYPED_OVERFLOW', nodeId: 'operation', expectedPartial: { samples: 1, finalState: { operation: f(['1'], [1], 8, 0) }, stateMemory: { operation: { value: f(['1', '100'], [2], 8, 0) } } } },
];
