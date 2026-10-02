import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { EXPANSION_BLOCK_IDS } from '../packages/block-library/src/expansion';
import { compileModel } from '../packages/compiler/src';
import { exportTypeScript } from '../packages/codegen-ts/src';
import { getPythonDiagnostics } from '../packages/codegen-python/src';
import { ModelError, type CalcModel, type RunResult } from '../packages/model/src';
import { nodeOperationCost } from '../packages/runtime/src/kernels';
import { runModel } from '../packages/runtime/src';
import { EXPANSION_FIXTURES, expansionModel, type ExpansionFixture } from './block-expansion-fixtures';

function near(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(Number.isFinite(actual)).toBe(true); expect(Math.abs((actual as number) - expected) / Math.max(1, Math.abs(expected))).toBeLessThanOrEqual(3e-12); return; }
  if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect((actual as unknown[]).length).toBe(expected.length); expected.forEach((entry, index) => near((actual as unknown[])[index], entry)); return; }
  if (expected !== null && typeof expected === 'object') { expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort()); for (const [key, value] of Object.entries(expected)) near((actual as Record<string, unknown>)[key], value); return; }
  expect(actual).toBe(expected);
}
const fixture = (id: ExpansionFixture['id']): ExpansionFixture => structuredClone(EXPANSION_FIXTURES.find(entry => entry.id === id)!);
function checkCode(model: CalcModel, code: string): void {
  try { compileModel(model); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some(entry => entry.code === code)).toBe(true); return; }
  throw new Error(`Expected ${code}`);
}
async function standalone(model: CalcModel): Promise<{ run: () => Omit<RunResult, 'elapsedMs'>; getManifest: () => { targetVersion: string } }> {
  const code = exportTypeScript(compileModel(model));
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

describe('64 distinct mathematical and array block expansion contracts', () => {
  it('contains one hand oracle per new operation and preserves the Python 51-block allowlist', () => {
    expect(EXPANSION_BLOCK_IDS).toHaveLength(64);
    expect(EXPANSION_FIXTURES.map(entry => entry.id).sort()).toEqual([...EXPANSION_BLOCK_IDS].sort());
    expect(new Set(blockRegistry.map(entry => entry.id)).size).toBe(blockRegistry.length);
    for (const id of EXPANSION_BLOCK_IDS) {
      expect(Object.isFrozen(getBlockDefinition(id))).toBe(true);
      expect(getBlockDefinition(id)!.exportTargets).toEqual(['typescript']);
      expect(getPythonDiagnostics(compileModel(expansionModel(fixture(id))))).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED_BLOCK', nodeId: 'operation' }));
    }
  });

  it.each(EXPANSION_FIXTURES)('computes independent analytic oracle: $id', async entry => {
    const source = expansionModel(entry), original = JSON.stringify(source), result = await runModel(compileModel(source));
    near(result.samples[0]!.values.result, entry.expected); expect(JSON.stringify(source)).toBe(original);
  });

  it.each(EXPANSION_FIXTURES)('exports actual standalone TypeScript parity: $id', async entry => {
    const source = expansionModel(entry), portable = await standalone(source), result = portable.run();
    near(result.samples[0]!.values.result, entry.expected);
    expect(portable.getManifest().targetVersion).toBe('typescript-catalog-v1');
    near(portable.run(), result);
  });

  it('strictly typechecks the import-free template including every new kernel branch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'calcweave-expansion-ts-'));
    try {
      const file = join(directory, 'model.ts'), code = exportTypeScript(compileModel(expansionModel(fixture('vector.convolve'))));
      await writeFile(file, code);
      const program = ts.createProgram([file], { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, skipLibCheck: true, types: [] });
      expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(['vector.cross', 'reduce.mean', 'matrix.symmetrize', 'source.linspace'] as const)('preserves time grids and array signals in discrete and continuous: %s', async id => {
    for (const mode of ['discrete', 'continuous'] as const) {
      const entry = fixture(id), model = expansionModel(entry, mode), runtime = await runModel(compileModel(model));
      const portable = (await standalone(model)).run();
      const { elapsedMs: _elapsed, ...reference } = runtime;
      near(portable, reference); expect(runtime.samples).toHaveLength(3);
      runtime.samples.forEach(sample => near(sample.values.result, entry.expected));
    }
  });

  it('keeps integer quantizer inputs unchanged and distinguishes exact half ties and near ties', async () => {
    const entry = fixture('nonlinear.quantizer'); entry.parameters.step = 1; entry.inputs.in = [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, .49999999999999994, -.49999999999999994, .5, -.5];
    const expected = [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 0, -0, 1, -1];
    near((await runModel(compileModel(expansionModel(entry)))).samples[0]!.values.result, expected);
    near((await standalone(expansionModel(entry))).run().samples[0]!.values.result, expected);
  });

  it('preserves computed negative zero through atan2 while native JSON source zeros remain normalized', async () => {
    const entry = fixture('math.atan2'); entry.inputs = { a: -.5, b: -1 };
    const model = expansionModel(entry);
    model.nodes.push({ id: 'round', blockType: 'math.round', blockVersion: 1, label: 'round', parameters: { operation: 'round' } });
    model.edges.find(edge => edge.id === 'to_a')!.source = { nodeId: 'round', portId: 'out' };
    model.edges.push({ id: 'round_input', source: { nodeId: 'input_a', portId: 'out' }, target: { nodeId: 'round', portId: 'in' } });
    near((await runModel(compileModel(model))).samples[0]!.values.result, -Math.PI);
    near((await standalone(model)).run().samples[0]!.values.result, -Math.PI);
    const native = fixture('math.atan2'); native.inputs = { a: -0, b: -1 };
    near((await runModel(compileModel(expansionModel(native)))).samples[0]!.values.result, Math.PI);
    near((await standalone(expansionModel(native))).run().samples[0]!.values.result, Math.PI);
  });

  it('avoids unnecessary overflow in scale-stable mean, std, RMS, normalization, and linspace', async () => {
    const cases: [ExpansionFixture['id'], unknown, unknown][] = [
      ['reduce.mean', [Number.MAX_VALUE, Number.MAX_VALUE], Number.MAX_VALUE],
      ['reduce.std', [Number.MAX_VALUE, -Number.MAX_VALUE], Number.MAX_VALUE],
      ['reduce.rms', [Number.MAX_VALUE, Number.MAX_VALUE], Number.MAX_VALUE],
      ['vector.normalize', [1e308, 1e308], [Math.SQRT1_2, Math.SQRT1_2]],
      ['reduce.variance', [1e16, 1e16 + 2], 1],
      ['reduce.std', [1e16, 1e16 + 2], 1],
    ];
    for (const [id, input, expected] of cases) { const entry = fixture(id); entry.inputs.in = input as ExpansionFixture['inputs'][string]; near((await runModel(compileModel(expansionModel(entry)))).samples[0]!.values.result, expected); near((await standalone(expansionModel(entry))).run().samples[0]!.values.result, expected); }
    const spaced = fixture('source.linspace'); spaced.parameters = { start: -Number.MAX_VALUE, stop: Number.MAX_VALUE, count: 3 };
    near((await runModel(compileModel(expansionModel(spaced)))).samples[0]!.values.result, [-Number.MAX_VALUE, 0, Number.MAX_VALUE]);
  });

  it('uses physical unit algebra without scalar-broadcasting vector/matrix structural operations', () => {
    const dot = expansionModel(fixture('vector.dot')); dot.nodes.filter(node => node.id.startsWith('input')).forEach(node => node.unit = 'm');
    expect(compileModel(dot).outputTypes.result!.unit).toBe('m^2');
    const variance = expansionModel(fixture('reduce.variance')); variance.nodes[0]!.unit = 'm'; expect(compileModel(variance).outputTypes.result!.unit).toBe('m^2');
    variance.nodes[0]!.unit = 's'; checkCode(variance, 'UNIT_OPERATION_UNSUPPORTED');
    const dimensionless = expansionModel(fixture('math.log1p')); dimensionless.nodes[0]!.unit = 'm'; checkCode(dimensionless, 'UNIT_MISMATCH');
    const wrongDot = fixture('vector.dot'); wrongDot.inputs.b = 2; checkCode(expansionModel(wrongDot), 'SHAPE_MISMATCH');
    const wrongCross = fixture('vector.cross'); wrongCross.inputs.a = [1, 2]; wrongCross.inputs.b = [3, 4]; checkCode(expansionModel(wrongCross), 'SHAPE_MISMATCH');
  });

  it('preserves constant subnormal values in means, median, symmetric averages and linspace', async () => {
    for (const id of ['reduce.mean', 'reduce.median'] as const) {
      const entry = fixture(id); entry.inputs.in = [Number.MIN_VALUE, Number.MIN_VALUE];
      expect((await runModel(compileModel(expansionModel(entry)))).samples[0]!.values.result).toBe(Number.MIN_VALUE);
      expect((await standalone(expansionModel(entry))).run().samples[0]!.values.result).toBe(Number.MIN_VALUE);
    }
    const symmetric = fixture('matrix.symmetrize'); symmetric.inputs.in = [[Number.MIN_VALUE]];
    expect((await runModel(compileModel(expansionModel(symmetric)))).samples[0]!.values.result).toEqual([[Number.MIN_VALUE]]);
    expect((await standalone(expansionModel(symmetric))).run().samples[0]!.values.result).toEqual([[Number.MIN_VALUE]]);
    const mean = fixture('reduce.mean'); mean.inputs.in = [Number.MIN_VALUE, 0];
    expect((await runModel(compileModel(expansionModel(mean)))).samples[0]!.values.result).toBe(0);
    const spaced = fixture('source.linspace'); spaced.parameters = { start: Number.MIN_VALUE, stop: Number.MIN_VALUE, count: 3 };
    expect((await runModel(compileModel(expansionModel(spaced)))).samples[0]!.values.result).toEqual(Array(3).fill(Number.MIN_VALUE));
  });

  it('preserves boolean matrix/selection types and removes stale bus field names on rearrangement', async () => {
    const diagonal = fixture('matrix.diag-create'); diagonal.inputs.in = [true, false];
    const compiled = compileModel(expansionModel(diagonal)); expect(compiled.outputTypes.result!.valueType).toBe('boolean');
    near((await runModel(compiled)).samples[0]!.values.result, [[true, false], [false, false]]);
    const reverse = expansionModel(fixture('vector.reverse')); reverse.nodes[0]!.parameters.value = [1, 2];
    reverse.nodes.unshift({ id: 'a', blockType: 'source.constant', blockVersion: 1, label: 'a', parameters: { value: 1 } }, { id: 'b', blockType: 'source.constant', blockVersion: 1, label: 'b', parameters: { value: 2 } });
    reverse.nodes[2] = { id: 'input_in', blockType: 'route.bus-create', blockVersion: 1, label: 'bus', parameters: { first: 'first', second: 'second' } };
    reverse.edges.push({ id: 'bus_a', source: { nodeId: 'a', portId: 'out' }, target: { nodeId: 'input_in', portId: 'a' } }, { id: 'bus_b', source: { nodeId: 'b', portId: 'out' }, target: { nodeId: 'input_in', portId: 'b' } });
    expect(compileModel(reverse).outputTypes.result!.fields).toBeUndefined();
  });

  it('rejects invalid ranges, fractional/out-of-bounds indices, mismatched shapes and oversized outputs', () => {
    const index = fixture('vector.select'); for (const indices of [[-1], [3], [.5]]) { index.parameters.indices = indices; checkCode(expansionModel(index), 'INVALID_INDEX'); }
    const slice = fixture('vector.slice'); slice.parameters.count = 4; checkCode(expansionModel(slice), 'INVALID_INDEX');
    const dead = fixture('nonlinear.dead-zone'); dead.parameters.lower = 2; dead.parameters.upper = 1; checkCode(expansionModel(dead), 'INVALID_PARAMETERS');
    const trace = fixture('matrix.trace'); trace.inputs.in = [[1, 2, 3], [4, 5, 6]]; checkCode(expansionModel(trace), 'MATRIX_SQUARE_REQUIRED');
    const repeat = fixture('vector.repeat'); repeat.inputs.in = Array(1024).fill(1); repeat.parameters.count = 2; checkCode(expansionModel(repeat), 'SIGNAL_SIZE_EXCEEDED');
    const diagonal = fixture('matrix.diag-create'); diagonal.inputs.in = Array(33).fill(1); checkCode(expansionModel(diagonal), 'MATRIX_SHAPE');
    const convolution = fixture('vector.convolve'); convolution.inputs.a = Array(1024).fill(1); convolution.inputs.b = [1, 1]; checkCode(expansionModel(convolution), 'SIGNAL_SIZE_EXCEEDED');
    const quantizer = fixture('nonlinear.quantizer'); quantizer.parameters.step = 0; checkCode(expansionModel(quantizer), 'INVALID_PARAMETERS');
  });

  it.each([
    ['math.log1p', -1, 'NUMERIC_DOMAIN'], ['math.log2', 0, 'NUMERIC_DOMAIN'], ['math.acosh', 0, 'NUMERIC_DOMAIN'],
    ['math.atanh', 1, 'NUMERIC_DOMAIN'], ['math.exp2', 1024, 'NUMERIC_NONFINITE'], ['vector.normalize', [0, 0], 'NUMERIC_DOMAIN'],
  ] as const)('retains runtime failure locations and standalone parity: %s', async (id, input, code) => {
    const entry = fixture(id); entry.inputs.in = input as ExpansionFixture['inputs'][string]; const model = expansionModel(entry), portable = await standalone(model);
    await expect(runModel(compileModel(model))).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code, nodeId: 'operation' })] });
    expect(() => portable.run()).toThrowError(expect.objectContaining({ diagnostics: [expect.objectContaining({ code, nodeId: 'operation' })] }));
  });

  it('charges full convolution work and rejects large repeated work before running it', async () => {
    const entry = fixture('vector.convolve'); entry.inputs = { a: Array(256).fill(1), b: Array(256).fill(1) };
    const model = expansionModel(entry, 'discrete'); model.execution = { mode: 'discrete', startTime: 0, stopTime: 1000, step: 1 };
    const compiled = compileModel(model), byId = new Map(compiled.nodes.map(node => [node.id, node]));
    expect(nodeOperationCost(byId.get('operation')!, byId)).toBeGreaterThanOrEqual(4 * 256 * 256);
    await expect(runModel(compiled)).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_OPERATION_BUDGET' })] });
    const portable = await standalone(model); expect(() => portable.run()).toThrowError(expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_OPERATION_BUDGET' })] }));
  });

  it('rejects untracked changing quantizer jumps before a scalar ODE while allowing ordinary observed arrays', () => {
    const model = expansionModel(fixture('nonlinear.quantizer'), 'continuous'); model.nodes[0] = { id: 'input_in', blockType: 'source.ramp', blockVersion: 1, label: 'ramp', parameters: { startTime: 0, initial: 0, slope: 1 } };
    model.nodes.push({ id: 'state', blockType: 'continuous.integrator', blockVersion: 1, label: 'state', parameters: { initial: 0 } });
    model.edges.find(edge => edge.id === 'to_result')!.target = { nodeId: 'state', portId: 'in' };
    model.edges.push({ id: 'state_result', source: { nodeId: 'state', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
    checkCode(model, 'UNREGISTERED_DISCONTINUITY');
  });
});
