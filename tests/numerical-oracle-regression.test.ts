import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { subsystemDefinitionHash } from '../packages/compiler/src/hierarchy';
import { createExportManifest, exportTypeScript, type ExportManifest } from '../packages/codegen-ts/src';
import { compareRuns, runParameterSweep } from '../packages/experiments/src';
import { ModelError, parseModel, parseModelJson, serializeModel, type CalcModel, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { boundaryOracles, continuousOracles, decay, type ContinuousOracle } from '../scripts/m3-oracles';
import { datasetRangeFailure, m4Oracles, m4SweepModel, type M4Oracle } from '../scripts/m4-oracles';
import { m5FailureOracles, m5Oracles, type M5Oracle } from '../scripts/m5-oracles';

type IndependentResult = Omit<RunResult, 'elapsedMs'>;
type NumericalOracle = M5Oracle & Pick<M4Oracle, 'expectedFinalState' | 'flatReference'>
  & Pick<ContinuousOracle, 'expectedEvents' | 'rejectionRequired'>;
const stable = (result: RunResult | IndependentResult): IndependentResult => {
  const { elapsedMs: _elapsed, ...rest } = result as RunResult; return rest;
};
function close(actual: unknown, expected: unknown, absolute: number, relative = 0, positiveZero = false): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert(Number.isFinite(actual) && Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
    if (positiveZero && expected === 0) assert(!Object.is(actual, -0), 'Computed zeros must be +0');
  } else if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => close(value, expected[index], absolute, relative, positiveZero));
  } else assert.deepEqual(actual, expected);
}

// Compile one actual export for each capability family/mode, using only ES2022.
const checkedForms = new Set<string>();
async function standalone(code: string, form: string): Promise<{ run(): IndependentResult; getManifest(): ExportManifest }> {
  assert(!/\beval\s*\(|new\s+Function|\bimport\s/.test(code), 'Fixed generator output must be import-free without dynamic evaluation');
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-oracle-'));
  const source = join(directory, 'model.ts'), module = join(directory, 'model.mjs');
  try {
    if (!checkedForms.has(form)) {
      await writeFile(source, code);
      const program = ts.createProgram([source], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true });
      assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `Strict standalone ${form}`);
      checkedForms.add(form);
    }
    await writeFile(module, ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    // Only repository-owned generator output is executed; model fields stay data.
    return await import(/* @vite-ignore */ pathToFileURL(module).href);
  } finally {
    await unlink(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await unlink(module).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
}

// Direct index sums remain independent of production matrix factorization.
const product = (a: number[][], b: number[][]): number[][] => a.map(row => b[0]!.map((_value, column) => row.reduce((sum, value, index) => sum + value * b[index]![column]!, 0)));
const transpose = (a: number[][]): number[][] => a[0]!.map((_value, column) => a.map(row => row[column]!));
function matrix(value: unknown): number[][] {
  assert(Array.isArray(value) && value.every(row => Array.isArray(row) && row.every(item => typeof item === 'number')));
  return value as number[][];
}
function checkResiduals(oracle: NumericalOracle, result: RunResult): void {
  for (const residual of oracle.residuals ?? []) for (const sample of result.samples) {
    const outputs = residual.outputs.map(id => matrix(sample.values[id]));
    if (residual.kind === 'inverse') close(product(residual.matrix, outputs[0]!), residual.matrix.map((row, i) => row.map((_value, j) => +(i === j))), residual.tolerance);
    else if (residual.kind === 'solve') close(product(residual.matrix, outputs[0]!), residual.rhs!, residual.tolerance);
    else if (residual.kind === 'cholesky') close(product(outputs[0]!, transpose(outputs[0]!)), residual.matrix, residual.tolerance);
    else close(product(outputs[0]!, outputs[1]!), product(outputs[2]!, residual.matrix), residual.tolerance);
  }
}
function mutateFirstValue(result: Pick<RunResult, 'samples'>): void {
  const values = result.samples[0]!.values, id = Object.keys(values)[0]!, value = values[id];
  if (Array.isArray(value)) {
    if (Array.isArray(value[0])) (value as number[][])[0]![0] = 999;
    else (value as number[])[0] = 999;
  } else values[id] = 999;
}

const cases: { family: 'm3' | 'm4' | 'm5'; oracle: NumericalOracle }[] = [
  ...[...continuousOracles(), ...boundaryOracles()].map(oracle => ({ family: 'm3' as const, oracle })),
  ...m4Oracles().map(oracle => ({ family: 'm4' as const, oracle })),
  ...m5Oracles().map(oracle => ({ family: 'm5' as const, oracle })),
];
describe('Independent numerical oracles and portable execution', () => {
  it.each(cases)('$oracle.id preserves analytic values, JSON, graph order and standalone output', async ({ family, oracle }) => {
    const original = JSON.stringify(oracle.model), compiled = compileModel(oracle.model), result = await runModel(compiled);
    assert.equal(result.status, 'completed'); assert.equal(JSON.stringify(oracle.model), original);
    if (family !== 'm3') {
      const execution = compiled.model.execution;
      assert.equal(result.samples.length, execution.mode === 'static' ? 1 : Math.round((execution.stopTime - execution.startTime) / execution.step) + 1);
      assert.deepEqual([...compiled.outputIds].sort(), Object.keys(oracle.expected).sort());
      result.samples.forEach((sample, index) => assert.equal(sample.time, execution.startTime + index * execution.step));
    }
    for (const [id, expected] of Object.entries(oracle.expected)) for (const [index, sample] of result.samples.entries()) close(sample.values[id], expected(sample.time, index), oracle.tolerance, oracle.relativeTolerance, family === 'm5');
    for (const [id, unit] of Object.entries(oracle.expectedUnits ?? {})) assert.equal(compiled.outputTypes[id]!.unit, unit);
    if (oracle.expectedFinalState) assert.deepEqual(result.finalState, oracle.expectedFinalState);
    if (oracle.flatReference) assert.deepEqual(stable(await runModel(compileModel(oracle.flatReference))), stable(result));
    if (oracle.rejectionRequired) assert(result.solverStatistics!.rejectedSteps > 0);
    if (oracle.expectedEvents) {
      assert.equal(result.events!.reduce((count, event) => count + event.nodeIds.length, 0), oracle.expectedEvents.length);
      for (const expected of oracle.expectedEvents) {
        const event = result.events!.filter(item => item.kind === expected.kind && item.nodeIds.includes(expected.nodeId)).sort((a, b) => Math.abs(a.time - expected.time) - Math.abs(b.time - expected.time))[0];
        assert(event); close(event.time, expected.time, 3e-8);
      }
    }
    checkResiduals(oracle, result);
    const expected = structuredClone(stable(result)), reopened = compileModel(parseModelJson(serializeModel(compiled.model)));
    assert.equal(reopened.semanticKey, compiled.semanticKey); assert.deepEqual(stable(await runModel(reopened)), expected);
    const reorderedModel = parseModel(compiled.model); reorderedModel.nodes.reverse(); reorderedModel.edges.reverse(); reorderedModel.datasets?.reverse(); reorderedModel.subsystems?.reverse();
    reorderedModel.subsystems?.forEach(definition => { definition.nodes.reverse(); definition.edges.reverse(); definition.inputs.reverse(); definition.outputs.reverse(); });
    const reordered = compileModel(reorderedModel); assert.equal(reordered.semanticKey, compiled.semanticKey); assert.deepEqual(stable(await runModel(reordered)), expected);
    const manifest = await createExportManifest(compiled);
    assert.equal(manifest.modelHash, createHash('sha256').update(compiled.semanticKey).digest('hex'));
    assert.equal(manifest.targetVersion, `typescript-${family}-v1`); assert.deepEqual(await createExportManifest(reopened), manifest);
    const referenced = new Set(compiled.nodes.filter(node => node.blockType === 'source.dataset').map(node => node.parameters.datasetId));
    assert.deepEqual(manifest.dataReferences.map(item => item.id).sort(), [...referenced].sort());
    for (const reference of manifest.dataReferences) {
      const dataset = compiled.model.datasets!.find(item => item.id === reference.id)!;
      assert.deepEqual(reference, { id: dataset.id, version: dataset.version, sourceHash: dataset.sourceHash, contentHash: dataset.contentHash, timeColumn: dataset.timeColumn, columns: dataset.columns });
    }
    assert.deepEqual(manifest.hierarchyReferences ?? [], compiled.hierarchy?.instances ?? []);
    for (const reference of manifest.hierarchyReferences ?? []) assert.equal(reference.definitionHash, subsystemDefinitionHash(compiled.model.subsystems!.find(item => item.id === reference.definitionId)!));
    const exported = await standalone(exportTypeScript(compiled, manifest), `${family}/${compiled.model.execution.mode}`), exportedResult = exported.run();
    assert.deepEqual(exportedResult, expected); assert.deepEqual(exported.getManifest(), manifest);
    const changed = exported.getManifest(); changed.execution.step = 10;
    if (changed.execution.solver) changed.execution.solver.atol = 1;
    if (changed.dataReferences[0]) changed.dataReferences[0].contentHash = '0'.repeat(64);
    if (changed.hierarchyReferences?.[0]) changed.hierarchyReferences[0].definitionHash = '0'.repeat(64);
    mutateFirstValue(exportedResult); mutateFirstValue(result);
    assert.deepEqual(exported.run(), expected); assert.deepEqual(exported.getManifest(), manifest); assert.deepEqual(stable(await runModel(compiled)), expected);
  });
  it('strictly checks each exercised family and all three data/matrix execution modes', () => {
    assert.deepEqual([...checkedForms].sort(), ['m3/continuous', 'm4/continuous', 'm4/discrete', 'm4/static', 'm5/continuous', 'm5/discrete', 'm5/static']);
  });
  it('exhibits fourth-order RK4 global convergence under successive step halving', async () => {
    const errors: number[] = [];
    for (const h of [0.2, 0.1, 0.05, 0.025]) errors.push(Math.abs(Number((await runModel(compileModel(decay('rk4', h)))).samples.at(-1)!.values.result) - Math.exp(-1)));
    const orders = errors.slice(1).map((error, index) => Math.log2(errors[index]! / error));
    assert(orders.every(order => order > 3.9 && order < 4.3));
  });
  it('matches an independent 20-term Taylor rotation oscillator', async () => {
    let cos = 1, sin = 0;
    for (let i = 0; i < 100; i++) {
      let ch = 1, sh = 0.01, ct = 1, st = 0.01;
      for (let k = 1; k < 20; k++) { ct *= -0.0001 / ((2 * k - 1) * (2 * k)); st *= -0.0001 / ((2 * k) * (2 * k + 1)); ch += ct; sh += st; }
      [cos, sin] = [cos * ch - sin * sh, sin * ch + cos * sh];
    }
    close(cos, Math.cos(1), 1e-14); close(sin, Math.sin(1), 1e-14);
    const final = (await runModel(compileModel(continuousOracles().find(oracle => oracle.id === 'F03-second-order-oscillator')!.model))).samples.at(-1)!.values;
    close(final.position, cos, 2e-9); close(final.velocity, -sin, 2e-9);
  });
});

async function failure(operation: () => unknown): Promise<{ diagnostics: ModelError['diagnostics']; partialResult?: RunResult }> {
  try { await operation(); } catch (error) {
    assert(error && typeof error === 'object' && 'diagnostics' in error);
    return error as ModelError;
  }
  throw new Error('Expected controlled numerical failure');
}
async function failureParity(model: CalcModel, expectedCode: string): Promise<ModelError> {
  const compiled = compileModel(model), actual = await failure(() => runModel(compiled));
  assert(actual instanceof ModelError); assert.equal(actual.diagnostics[0]!.code, expectedCode);
  const exported = await standalone(exportTypeScript(compiled), `failure/${compiled.model.execution.mode}`);
  const generated = await failure(() => exported.run());
  assert.deepEqual(generated.diagnostics, actual.diagnostics);
  assert.deepEqual(generated.partialResult && stable(generated.partialResult), actual.partialResult && stable(actual.partialResult));
  return actual;
}
describe('Independent numerical failure and experiment contracts', () => {
  it.each([
    { id: 'evaluations', overrides: { maxEvaluations: 1 }, code: 'RUNTIME_EVALUATION_BUDGET' },
    { id: 'steps', overrides: { maxSteps: 1 }, code: 'RUNTIME_INTERNAL_STEP_BUDGET' },
    { id: 'rejects', overrides: { maxRejects: 0 }, code: 'RUNTIME_REJECTION_BUDGET' },
    { id: 'minimum', overrides: { minStep: 0.2, initialStep: 0.2, maxStep: 0.2 }, code: 'RUNTIME_MIN_STEP' },
  ])('$id solver failure retains the exact standalone partial result', async ({ overrides, code }) => {
    const model = decay('rk45', 0.2, 20); model.execution.solver = { ...model.execution.solver, ...overrides };
    const error = await failureParity(model, code); assert.equal(error.partialResult!.status, 'failed'); assert(error.partialResult!.samples.length >= 1);
  });
  it('matches dataset outside:error diagnostics and completed partial samples', async () => {
    await failureParity(datasetRangeFailure(), 'DATASET_TIME_RANGE');
  });
  it.each(m5FailureOracles())('$id preserves independent partial values and standalone diagnostics', async oracle => {
    const error = await failureParity(oracle.model, oracle.expectedCode); assert.equal(error.diagnostics[0]!.nodeId, oracle.nodeId);
    if (oracle.minimumPartialSamples !== undefined) {
      assert.equal(error.partialResult!.status, 'failed'); assert.equal(error.partialResult!.samples.length, oracle.minimumPartialSamples);
      assert(error.diagnostics[0]!.time !== undefined);
    }
    for (const [id, expected] of Object.entries(oracle.expectedPartial ?? {})) for (const [index, sample] of error.partialResult!.samples.entries()) {
      assert.equal(sample.time, oracle.model.execution.startTime + index * oracle.model.execution.step); assert(sample.time < error.diagnostics[0]!.time!);
      close(sample.values[id], expected(sample.time, index), 2e-11);
    }
    assert.equal(compileModel(parseModelJson(serializeModel(oracle.model))).semanticKey, compileModel(oracle.model).semanticKey);
  });
  it('preserves valid continuous samples when a weighted operation budget expires', async () => {
    const compiled = compileModel(m5Oracles().find(oracle => oracle.id === 'F05-temporal-lookup-continuous')!.model);
    const complete = await runModel(compiled, { trackOperations: true }), limit = Math.floor(complete.resources!.operations / 2);
    const error = await failure(() => runModel(compiled, { maxOperations: limit, trackOperations: true }));
    assert.equal(error.diagnostics[0]!.code, 'RUNTIME_OPERATION_BUDGET'); assert(error.partialResult);
    assert(error.partialResult.samples.length > 0 && error.partialResult.samples.length < complete.samples.length); assert(error.partialResult.resources!.operations <= limit);
  });
  it('compares data-driven integral sweeps with analytic RMSE and real standalone exports', async () => {
    const model = m4SweepModel(), original = JSON.stringify(model), spec = { nodeId: 'gain', parameter: 'gain', values: [1, 2, 3] };
    const sweep = await runParameterSweep(model, spec), comparison = compareRuns(sweep.records);
    assert.equal(sweep.status, 'completed'); assert.equal(sweep.records.length, 3); assert.equal(JSON.stringify(model), original);
    assert.equal(comparison.status, 'completed'); assert.equal(comparison.outputs.length, 1);
    for (const [index, record] of sweep.records.entries()) {
      for (const sample of record.result.samples) close(sample.values.result, record.value * (sample.time * sample.time + sample.time), 2e-9);
      assert(record.result.resources!.operations > 0);
      const compiled = compileModel(parseModelJson(serializeModel(record.model)));
      assert.equal(record.modelHash, createHash('sha256').update(compiled.semanticKey).digest('hex')); assert.deepEqual(await createExportManifest(compiled), record.manifest);
      const exported = await standalone(exportTypeScript(compiled, record.manifest), 'm4/continuous');
      const { resources: _resources, ...numerical } = stable(record.result); assert.deepEqual(exported.run(), numerical);
      const rmse = Math.abs(record.value - 1) * Math.sqrt(record.result.samples.reduce((sum, sample) => sum + (sample.time * sample.time + sample.time) ** 2, 0) / record.result.samples.length);
      const actual = comparison.outputs[0]!.values[index]!;
      close(actual.finalValue, 2 * record.value, 2e-9); close(actual.delta, 2 * (record.value - 1), 2e-9); close(actual.rmse, rmse, 2e-9);
    }
    const repeated = await runParameterSweep(model, spec); assert.deepEqual(repeated.records.map(record => record.modelHash), sweep.records.map(record => record.modelHash));
  });
});
