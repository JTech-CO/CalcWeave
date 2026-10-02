import { describe, expect, it } from 'vitest';
import { blockRegistry } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { nodeOperationCost } from '../packages/runtime/src/kernels';
import { createExportManifest } from '../packages/codegen-ts/src';
import { ModelError, parseModelJson, serializeModel, type CalcModel } from '../packages/model/src';
import { m5Graph, m5Node, m5Scope, m5Wire, m5Oracles, m5FailureOracles, m5LookupParameters } from '../scripts/m5-oracles';

function unary(type: string, value: unknown, parameters: Record<string, unknown> = {}, unit?: string): CalcModel {
  const model = m5Graph('m5integration'); m5Node(model, 'input', 'source.constant', { value }, unit); m5Node(model, 'operation', type, parameters); m5Wire(model, 'input', 'operation'); m5Scope(model, 'operation', 'result', type === 'matrix.lu' ? 'lower' : type === 'lookup.prelookup' ? 'fraction' : 'out'); return model;
}
function binary(type: string, a: unknown, b: unknown, aUnit?: string, bUnit?: string): CalcModel {
  const model = m5Graph('m5integration'); m5Node(model, 'a', 'source.constant', { value: a }, aUnit); m5Node(model, 'b', 'source.constant', { value: b }, bUnit); m5Node(model, 'operation', type); m5Wire(model, 'a', 'operation', 'a'); m5Wire(model, 'b', 'operation', 'b'); m5Scope(model, 'operation'); return model;
}
function lookup(extra: Record<string, unknown> = {}, row: unknown = 0.5, column: unknown = 3): CalcModel {
  const model = m5Graph('m5integration'); m5Node(model, 'row', 'source.constant', { value: row }); m5Node(model, 'column', 'source.constant', { value: column }); m5Node(model, 'operation', 'lookup.2d', { ...m5LookupParameters, ...extra }); m5Wire(model, 'row', 'operation', 'row'); m5Wire(model, 'column', 'operation', 'column'); m5Scope(model, 'operation'); return model;
}
function diagnostic(model: CalcModel): { code: string; nodeId?: string } {
  try { compileModel(model); } catch (error) { expect(error).toBeInstanceOf(ModelError); return (error as ModelError).diagnostics[0]!; }
  throw new Error('Expected a controlled compiler diagnostic');
}
const fixture = (id: string) => m5Oracles().find((item) => item.id === id)!;
function numericClose(actual: unknown, expected: unknown, tolerance: number, relative = 0): void {
  if (typeof actual === 'number' && typeof expected === 'number') { expect(Number.isFinite(actual)).toBe(true); expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance + relative * Math.abs(expected)); return; }
  if (Array.isArray(actual) && Array.isArray(expected)) { expect(actual).toHaveLength(expected.length); actual.forEach((value, index) => numericClose(value, expected[index], tolerance, relative)); return; }
  expect(actual).toEqual(expected);
}

describe('M5 compiler shape, unit and parameter boundaries', () => {
  it('registers ten algebraic blocks with explicit multi-output ports in all execution modes', () => {
    const ids = ['math.matrix-multiply', 'matrix.transpose', 'matrix.determinant', 'matrix.inverse', 'matrix.solve', 'matrix.cholesky', 'matrix.lu', 'lookup.2d', 'lookup.prelookup', 'fixed.quantize'];
    for (const id of ids) expect(blockRegistry.find((block) => block.id === id)!.supportedModes).toEqual(['static', 'discrete', 'continuous']);
    expect(blockRegistry.find((block) => block.id === 'matrix.lu')!.outputs).toEqual(['lower', 'upper', 'permutation']);
    expect(blockRegistry.find((block) => block.id === 'lookup.prelookup')!.outputs).toEqual(['index', 'fraction']); expect(blockRegistry.find((block) => block.id === 'fixed.quantize')!.outputs).toEqual(['out', 'stored']);
  });
  it('infers rectangular product dimensions and approved unit products without broadcasting', async () => {
    const compiled = compileModel(fixture('F05-rectangular-product').model); expect(compiled.outputTypes.result).toEqual({ valueType: 'float64', shape: [2, 2], unit: 'm^2' }); expect((await runModel(compiled)).samples[0]!.values.result).toEqual([[58, 64], [139, 154]]);
    expect(diagnostic(binary('math.matrix-multiply', [[1, 2, 3]], [[1], [2]]))).toMatchObject({ code: 'MATRIX_INNER_DIMENSION', nodeId: 'operation' });
    expect(diagnostic(binary('math.matrix-multiply', [1, 2], [[1], [2]]))).toMatchObject({ code: 'MATRIX_SHAPE', nodeId: 'operation' });
    expect(diagnostic(binary('math.matrix-multiply', 2, [[1], [2]]))).toMatchObject({ code: 'MATRIX_SHAPE', nodeId: 'operation' });
  });
  it.each(['matrix.determinant', 'matrix.inverse', 'matrix.cholesky', 'matrix.lu'])('%s rejects non-square or dimensioned inputs before running', type => {
    expect(diagnostic(unary(type, [[1, 2, 3], [4, 5, 6]]))).toMatchObject({ code: 'MATRIX_SQUARE_REQUIRED', nodeId: 'operation' });
    expect(diagnostic(unary(type, [[1, 0], [0, 1]], {}, 'm'))).toMatchObject({ code: 'UNIT_MISMATCH', nodeId: 'operation' });
  });
  it('preserves numeric2D and transpose unit while rejecting boolean matrices and excessive axes', () => {
    expect(compileModel(unary('matrix.transpose', [[1, 2, 3], [4, 5, 6]], {}, 'cm')).outputTypes.result).toEqual({ valueType: 'float64', shape: [3, 2], unit: 'cm' });
    expect(diagnostic(unary('matrix.transpose', [[true, false]]))).toMatchObject({ code: 'TYPE_MISMATCH', nodeId: 'operation' });
    expect(diagnostic(unary('matrix.transpose', [Array.from({ length: 33 }, () => 1)]))).toMatchObject({ code: 'MATRIX_SHAPE', nodeId: 'operation' });
  });
  it('solves multi-RHS2D with B unit and rejects mismatched rows or dimensioned A', () => {
    expect(compileModel(fixture('F05-solve-multiple-rhs').model).outputTypes.result).toEqual({ valueType: 'float64', shape: [2, 2], unit: 'm' });
    expect(diagnostic(binary('matrix.solve', [[1, 0], [0, 1]], [[1], [2], [3]]))).toMatchObject({ code: 'MATRIX_RHS_DIMENSION', nodeId: 'operation' });
    expect(diagnostic(binary('matrix.solve', [[1, 0], [0, 1]], [[1], [2]], 'm'))).toMatchObject({ code: 'UNIT_MISMATCH', nodeId: 'operation' });
  });
  it.each([
    [{ rowBreakpoints: [0, 0, 1] }, 'INVALID_BREAKPOINTS'], [{ columnBreakpoints: [0, -1, 2] }, 'INVALID_BREAKPOINTS'],
    [{ table: [[1, 2], [3, 4], [5, 6]] }, 'LOOKUP_TABLE_SHAPE'], [{ interpolation: 'nearest', extrapolation: 'linear' }, 'INVALID_LOOKUP_2D'],
    [{ interpolation: 'spline' }, 'INVALID_PARAMETERS'], [{ unwanted: true }, 'INVALID_PARAMETERS'],
  ] as const)('rejects malformed lookup parameters %j', (parameters, code) => { expect(diagnostic(lookup(parameters))).toMatchObject({ code, nodeId: 'operation' }); });
  it('requires dimensionless scalar lookup inputs and independent scalar index/fraction outputs', () => {
    expect(diagnostic(lookup({}, [0.5], 3))).toMatchObject({ code: 'SHAPE_MISMATCH', nodeId: 'operation' });
    const model = lookup(); model.nodes.find((node) => node.id === 'row')!.unit = 'm'; expect(diagnostic(model)).toMatchObject({ code: 'UNIT_MISMATCH', nodeId: 'operation' });
    const compiled = compileModel(unary('lookup.prelookup', 1, { breakpoints: [-2, 1, 5] })); const operation = compiled.nodes.find((node) => node.id === 'operation')!;
    expect(operation.outputs).toEqual({ index: { valueType: 'float64', shape: [], unit: '1' }, fraction: { valueType: 'float64', shape: [], unit: '1' } });
  });
  it.each([{ wordLength: 0 }, { wordLength: 33 }, { wordLength: 1.5 }, { fractionLength: -1 }, { fractionLength: 33 }, { signedness: 'automatic' }, { rounding: 'nearest' }, { overflow: 'silent' }, { custom: 1 }])('rejects quantizer parameters %j and preserves the original model', parameters => {
    const model = unary('fixed.quantize', 1, parameters), snapshot = JSON.stringify(model); expect(diagnostic(model)).toMatchObject({ code: 'INVALID_PARAMETERS', nodeId: 'operation' }); expect(JSON.stringify(model)).toBe(snapshot);
  });
  it('keeps quantized2D shape/unit and stored codes dimensionless, without a new signal type', () => {
    const model = fixture('F05-quantize-nearest-even').model, compiled = compileModel(model); expect(compiled.outputTypes.result).toEqual({ valueType: 'float64', shape: [2, 4], unit: 'm' }); expect(compiled.outputTypes.stored).toEqual({ valueType: 'float64', shape: [2, 4], unit: '1' });
    expect(diagnostic(unary('fixed.quantize', true))).toMatchObject({ code: 'TYPE_MISMATCH', nodeId: 'operation' });
  });
});

describe('M5 numerical integration, failure and resource contracts', () => {
  it.each(['F05-inverse-pivot', 'F05-solve-multiple-rhs', 'F05-cholesky', 'F05-lu-pivot-permutation', 'F05-scaled-inverse-small', 'F05-scaled-inverse-large', 'F05-bilinear-nonuniform', 'F05-prelookup-knots-extrapolation', 'F05-quantize-32bit-unsigned-wrap', 'F05-quantize-subnormal-directed'])('executes independent expectations and JSON parity for %s', async id => {
    const oracle = fixture(id), compiled = compileModel(oracle.model), result = await runModel(compiled);
    for (const sample of result.samples) for (const [output, expected] of Object.entries(oracle.expected)) numericClose(sample.values[output], expected(sample.time, 0), oracle.tolerance, oracle.relativeTolerance);
    const reopened = compileModel(parseModelJson(serializeModel(compiled.model))); expect(reopened.semanticKey).toBe(compiled.semanticKey); const { elapsedMs: _a, ...stable } = result, { elapsedMs: _b, ...roundtrip } = await runModel(reopened); expect(roundtrip).toEqual(stable);
    expect((await createExportManifest(compiled)).targetVersion).toBe('typescript-m5-v1');
  });
  it.each(['discrete', 'continuous'] as const)('runs lookup/prelookup at every %s sample with an analytic continuous integral', async mode => {
    const oracle = fixture(`F05-temporal-lookup-${mode}`), result = await runModel(compileModel(oracle.model)); expect(result.samples).toHaveLength(9);
    for (const [index, sample] of result.samples.entries()) for (const [output, expected] of Object.entries(oracle.expected)) numericClose(sample.values[output], expected(sample.time, index), oracle.tolerance);
  });
  it('publishes a typed3x2 matrix through discrete memory using read-before-write', async () => {
    const oracle = fixture('F05-discrete-matrix-memory'), result = await runModel(compileModel(oracle.model)); expect(result.samples).toHaveLength(5);
    for (const [index, sample] of result.samples.entries()) expect(sample.values.result).toEqual(oracle.expected.result!(sample.time, index)); expect(result.finalState.delay).toEqual([[1, 4], [2, 5], [3, 6]]);
  });
  it.each(m5FailureOracles().map((oracle) => [oracle.id, oracle] as const))('%s reports code/node and only completed partial samples', async (_id, oracle) => {
    const compiled = compileModel(oracle.model); let error: ModelError | undefined; try { await runModel(compiled); } catch (caught) { expect(caught).toBeInstanceOf(ModelError); error = caught as ModelError; }
    expect(error?.diagnostics[0]).toMatchObject({ code: oracle.expectedCode, nodeId: oracle.nodeId }); expect(error?.partialResult?.status).toBe('failed');
    if (oracle.minimumPartialSamples !== undefined) { expect(error!.partialResult!.samples.length).toBe(oracle.minimumPartialSamples); expect(error!.partialResult!.samples.at(-1)!.time).toBeLessThan(error!.diagnostics[0]!.time!); }
    for (const [output, expected] of Object.entries(oracle.expectedPartial ?? {})) for (const [index, sample] of error!.partialResult!.samples.entries()) numericClose(sample.values[output], expected(sample.time, index), 2e-11);
  });
  it.each(['F05-rectangular-product', 'F05-quantize-32bit-saturate-fraction'])('charges weighted work in %s and rejects a smaller preflight budget', async id => {
    const compiled = compileModel(fixture(id).model), byId = new Map(compiled.nodes.map((node) => [node.id, node])), total = compiled.nodes.reduce((sum, node) => sum + nodeOperationCost(node, byId), 0), ordinary = await runModel(compiled), tracked = await runModel(compiled, { trackOperations: true });
    expect(total).toBeGreaterThan(compiled.nodes.length); expect(ordinary.resources).toBeUndefined(); expect(tracked.resources!.operations).toBe(total); expect(tracked.samples).toEqual(ordinary.samples);
    await expect(runModel(compiled, { maxOperations: total - 1, trackOperations: true })).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_OPERATION_BUDGET' }] });
  });
});
