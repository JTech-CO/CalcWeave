import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { getBlockDefinition } from '../packages/block-library/src';
import { M8_BLOCK_IDS } from '../packages/block-library/src/m8';
import { ModelError, type IRNode, type SignalValue } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { evaluateM8Node } from '../packages/runtime/src/m8';
import { checkSignal, nodeOperationCost } from '../packages/runtime/src/kernels';
import { M8_FIXTURES, m8Expected, m8Model, type M8Fixture } from './m8-fixtures';

function near(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(Number.isFinite(actual)).toBe(true); expect(Math.abs(Number(actual) - expected) / Math.max(1, Math.abs(expected))).toBeLessThanOrEqual(3e-12); return; }
  if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect((actual as unknown[]).length).toBe(expected.length); expected.forEach((entry, index) => near((actual as unknown[])[index], entry)); return; }
  if (expected !== null && typeof expected === 'object') { expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort()); for (const [key, value] of Object.entries(expected)) near((actual as Record<string, unknown>)[key], value); return; }
  expect(actual).toBe(expected);
}
const fixture = (id: string): M8Fixture => structuredClone(M8_FIXTURES.find(entry => entry.id === id)!);
function rawNode(entry: M8Fixture): IRNode {
  const parameters = Object.fromEntries(Object.entries(getBlockDefinition(entry.id)!.parameters).map(([key, definition]) => [key, structuredClone(definition.default)]));
  const descriptor = (value: SignalValue) => ({ valueType: typeof (Array.isArray(value) ? Array.isArray(value[0]) ? value[0]![0] : value[0] : value) === 'boolean' ? 'boolean' as const : 'float64' as const, shape: !Array.isArray(value) ? [] : Array.isArray(value[0]) ? [value.length, value[0]!.length] : [value.length], unit: '1' });
  return { id: 'operation', blockType: entry.id as IRNode['blockType'], parameters: { ...parameters, ...entry.parameters }, inputs: Object.fromEntries(Object.keys(entry.inputs).map(port => [port, { nodeId: `input_${port}`, portId: 'out' }])), outputs: Object.fromEntries(Object.entries(entry.expected).map(([port, value]) => [port, descriptor(value)])), sampleTime: { period: 1, offset: 0 } };
}
describe('M8 stateless real/boolean kernels', () => {
  it('has independent literal fixtures for each declared M8 definition', () => {
    expect(new Set(M8_FIXTURES.map(entry => entry.id))).toEqual(new Set(M8_BLOCK_IDS));
  });
  it.each(M8_FIXTURES)('computes direct raw oracle and owns output arrays: $name', entry => {
    const before = JSON.stringify(entry.inputs), node = rawNode(entry);
    const result = evaluateM8Node(node, port => entry.inputs[port]!); near(result, entry.expected);
    for (const [port, value] of Object.entries(result!)) checkSignal(value, node.outputs[port]!, node.id);
    if (Array.isArray(result!.out)) { if (Array.isArray(result!.out[0])) (result!.out as number[][])[0]![0] = 999; else (result!.out as number[])[0] = 999; }
    expect(JSON.stringify(entry.inputs)).toBe(before);
  });
  it.each(M8_FIXTURES)('runs compiled model against independent raw oracle: $name', async entry => {
    const model = m8Model(entry), before = JSON.stringify(model), compiled = compileModel(model);
    near((await runModel(compiled)).samples[0]!.values, m8Expected(entry)); expect(JSON.stringify(model)).toBe(before);
    const operation = compiled.nodes.find(node => node.id === 'operation')!, byId = new Map(compiled.nodes.map(node => [node.id, node]));
    expect(nodeOperationCost(operation, byId)).toBeGreaterThanOrEqual(Object.values(operation.outputs).reduce((count, output) => count + output.shape.reduce((size, axis) => size * axis, 1), 0));
  });
  it.each(M8_FIXTURES)('keeps fixed outputs across discrete/continuous samples: $name', async entry => {
    for (const mode of ['discrete', 'continuous'] as const) { const result = await runModel(compileModel(m8Model(entry, mode))); expect(result.samples).toHaveLength(3); result.samples.forEach(sample => near(sample.values, m8Expected(entry))); }
  });
  it.each([
    ['math.reciprocal-sqrt', 'in', 0, 'NUMERIC_DIVIDE_BY_ZERO'], ['math.reciprocal-sqrt', 'in', -1, 'NUMERIC_DOMAIN'],
    ['route.multiport-switch', 'index', 9, 'NUMERIC_INDEX_RANGE'], ['lookup.direct', 'in', [2, 0, 0], 'NUMERIC_INDEX_RANGE'],
    ['lookup.dynamic', 'breakpoints', [0, 0, 2], 'INVALID_BREAKPOINTS'], ['lookup.dynamic', 'table', [0, 10], 'INVALID_DYNAMIC_LOOKUP'],
    ['nonlinear.dead-zone-dynamic', 'lower', 4, 'INVALID_DYNAMIC_BOUNDS'], ['verify.assert', 'in', [true, false], 'VERIFY_VIOLATION'],
    ['verify.bounds', 'in', [0, 2], 'VERIFY_VIOLATION'], ['lookup.interpolate-prelookup', 'fraction', 2, 'LOOKUP_OUT_OF_RANGE'],
  ] as const)('retains original node failure: %s/%s', (id, port, value, code) => {
    const entry = fixture(id); entry.inputs[port] = structuredClone(value) as SignalValue;
    expect(() => evaluateM8Node(rawNode(entry), key => entry.inputs[key]!)).toThrowError(expect.objectContaining({ diagnostics: [expect.objectContaining({ code, nodeId: 'operation' })] }));
  });
  it('reports tick/time and valid partial output when a dynamic assertion fails', async () => {
    const model = m8Model(fixture('verify.bounds'), 'discrete');
    model.nodes[0] = { id: 'input_in', blockType: 'source.ramp', blockVersion: 1, label: 'ramp', parameters: { startTime: 0, initial: 0, slope: 1 } };
    model.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: 1 };
    let failure: unknown; try { await runModel(compileModel(model)); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ModelError);
    expect((failure as ModelError).diagnostics).toContainEqual(expect.objectContaining({ code: 'VERIFY_VIOLATION', nodeId: 'operation', tick: 2, time: 2 }));
    expect((failure as ModelError).partialResult?.samples.map(sample => sample.time)).toEqual([0, 1]);
  });
  it('charges lookup validation and rejects work before exhausting a large replay', async () => {
    const entry = fixture('lookup.nd'); entry.parameters = { rank: 4, axis1: [0, 1, 2, 3], axis2: [0, 1, 2, 3], axis3: [0, 1, 2, 3], axis4: [0, 1, 2, 3], table: Array(256).fill(7) }; entry.inputs.in = [0, 0, 0, 0];
    const model = m8Model(entry, 'discrete'); model.execution = { mode: 'discrete', startTime: 0, stopTime: 10000, step: 1 };
    await expect(runModel(compileModel(model))).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_OPERATION_BUDGET' })] });
  });
  it('preserves explicit sample periods, offsets and held outputs', async () => {
    const entry = fixture('math.negate'), model = m8Model(entry, 'discrete');
    model.execution = { mode: 'discrete', startTime: 0, stopTime: 4, step: 1 };
    model.nodes[0] = { id: 'input_in', blockType: 'source.ramp', blockVersion: 1, label: 'ramp', parameters: { startTime: 0, initial: 2, slope: 1 } };
    model.nodes.forEach(node => { node.sampleTime = { period: 2, offset: 1 }; });
    const compiled = compileModel(model), result = await runModel(compiled);
    expect(result.samples.map(sample => sample.values.result_out)).toEqual([0, -3, -3, -5, -5]);
    expect(compiled.nodes.find(node => node.id === 'operation')!.sampleTime).toEqual({ period: 2, offset: 1 });
  });
  it('retains finite endpoints, opposite extreme knots and constant subnormals in interpolation', async () => {
    const extreme = fixture('lookup.nd'); extreme.parameters = { rank: 1, axis1: [-Number.MAX_VALUE, Number.MAX_VALUE], table: [-Number.MAX_VALUE, Number.MAX_VALUE] }; extreme.inputs.in = 0;
    expect((await runModel(compileModel(m8Model(extreme)))).samples[0]!.values.result_out).toBe(0);
    extreme.parameters = { rank: 1, axis1: [0, 1], table: [Number.MIN_VALUE, Number.MIN_VALUE], outside: 'extrapolate' }; extreme.inputs.in = Number.MAX_VALUE;
    expect((await runModel(compileModel(m8Model(extreme)))).samples[0]!.values.result_out).toBe(Number.MIN_VALUE);
  });
  it('rounds subnormal midpoint to even and never evaluates a zero-weight ND branch in any mode', async () => {
    const midpoint = M8_FIXTURES.find(entry => entry.name === 'subnormal-midpoint-rounds-to-even')!;
    const endpoint = M8_FIXTURES.find(entry => entry.name === 'upper-knot-does-not-evaluate-zero-weight-overflow-branch')!;
    for (const mode of ['static', 'discrete', 'continuous'] as const) {
      for (const [entry, expected] of [[midpoint, 2 * Number.MIN_VALUE], [endpoint, 1]] as const) {
        const result = await runModel(compileModel(m8Model(entry, mode)));
        result.samples.forEach(sample => expect(sample.values.result_out).toBe(expected));
      }
    }
  });
  it('computes 33/1024-element vector Gram without the 32-axis matrix limit', async () => {
    for (const size of [33, 1024]) {
      const entry = fixture('matrix.square'); entry.inputs.in = Array(size).fill(1);
      expect((await runModel(compileModel(m8Model(entry)))).samples[0]!.values.result_out).toEqual([[size]]);
    }
  });
  it('reports numeric overflow and dynamic fractional selector errors on the actual operation', async () => {
    const cases: [M8Fixture, string][] = [];
    const overflow = fixture('math.increment'); overflow.inputs.in = Number.MAX_VALUE; overflow.parameters = { delta: Number.MAX_VALUE, clamp: 'none' }; cases.push([overflow, 'NUMERIC_NONFINITE']);
    const selector = fixture('vector.select-dynamic'); selector.inputs.indices = .5; cases.push([selector, 'NUMERIC_INDEX_RANGE']);
    const divide = fixture('math.product-inputs'); divide.inputs.in2 = 0; cases.push([divide, 'NUMERIC_DIVIDE_BY_ZERO']);
    for (const [entry, code] of cases) await expect(runModel(compileModel(m8Model(entry)))).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code, nodeId: 'operation' })] });
  });
});
