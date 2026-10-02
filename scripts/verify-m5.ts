import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { subsystemDefinitionHash } from '../packages/compiler/src/hierarchy';
import { runModel } from '../packages/runtime/src';
import { nodeOperationCost } from '../packages/runtime/src/kernels';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, ModelError, parseModel, parseModelJson, serializeModel, type RunResult } from '../packages/model/src';
import { m5Oracles, m5FailureOracles, type M5Oracle } from './m5-oracles';

function stable(result: RunResult): Omit<RunResult, 'elapsedMs'> { const { elapsedMs: _elapsed, ...rest } = result; return rest; }
function equal(actual: unknown, expected: unknown, absolute: number, relative: number, path: string): { absolute: number; relative: number } {
  if (typeof actual === 'number' && typeof expected === 'number') {
    const error = Math.abs(actual - expected), relativeError = expected === 0 ? 0 : error / Math.abs(expected);
    assert(Number.isFinite(actual) && error <= absolute + relative * Math.abs(expected), `${path}: ${actual} != ${expected}, absolute error ${error}`);
    if (expected === 0) assert(!Object.is(actual, -0), `${path}: all computed zeros must be +0`);
    return { absolute: error, relative: relativeError };
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, path);
    return actual.reduce((maximum, value, index) => { const error = equal(value, expected[index], absolute, relative, `${path}[${index}]`); return { absolute: Math.max(maximum.absolute, error.absolute), relative: Math.max(maximum.relative, error.relative) }; }, { absolute: 0, relative: 0 });
  }
  assert.deepEqual(actual, expected, path); return { absolute: 0, relative: 0 };
}
// These small residual computations use direct index sums, independent of the production factorization and its helper APIs.
function product(a: number[][], b: number[][]): number[][] { return a.map((row) => b[0]!.map((_value, column) => row.reduce((sum, value, index) => sum + value * b[index]![column]!, 0))); }
function transpose(a: number[][]): number[][] { return a[0]!.map((_value, column) => a.map((row) => row[column]!)); }
function matrix(value: unknown, path: string): number[][] { assert(Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every((item) => typeof item === 'number')), path); return value as number[][]; }
function residuals(oracle: M5Oracle, result: RunResult): number {
  let maximum = 0;
  for (const residual of oracle.residuals ?? []) for (const sample of result.samples) {
    const outputs = residual.outputs.map((id) => matrix(sample.values[id], `${oracle.id}.${id}`));
    let actual: number[][], expected: number[][];
    if (residual.kind === 'inverse') { actual = product(residual.matrix, outputs[0]!); expected = residual.matrix.map((row, i) => row.map((_value, j) => +(i === j))); }
    else if (residual.kind === 'solve') { actual = product(residual.matrix, outputs[0]!); expected = residual.rhs!; }
    else if (residual.kind === 'cholesky') { actual = product(outputs[0]!, transpose(outputs[0]!)); expected = residual.matrix; }
    else { actual = product(outputs[0]!, outputs[1]!); expected = product(outputs[2]!, residual.matrix); }
    maximum = Math.max(maximum, equal(actual, expected, residual.tolerance, 0, `${oracle.id}.${residual.kind} residual`).absolute);
  }
  return maximum;
}
const checkedModes = new Set<string>();
async function standalone(code: string, mode: string) {
  assert(!/\beval\s*\(|new\s+Function|\bimport\s/.test(code), 'Standalone code must be import-free without dynamic source evaluation');
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-m5-')), sourcePath = join(directory, 'model.ts'), modulePath = join(directory, 'model.mjs');
  try {
    if (!checkedModes.has(mode)) {
      await writeFile(sourcePath, code);
      const program = ts.createProgram([sourcePath], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true });
      const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.category === ts.DiagnosticCategory.Error);
      assert.deepEqual(diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `Strict independent ${mode} ES2022 TypeScript`); checkedModes.add(mode);
    }
    await writeFile(modulePath, ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    // Only repository-owned fixed generator output is loaded. User model fields remain data.
    return await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  } finally {
    await unlink(sourcePath).catch((error) => { if (error.code !== 'ENOENT') throw error; }); await unlink(modulePath).catch((error) => { if (error.code !== 'ENOENT') throw error; }); await rmdir(directory);
  }
}
function mutateFirstValue(result: Pick<RunResult, 'samples'>): void {
  const values = result.samples[0]!.values, id = Object.keys(values)[0]!; const value = values[id];
  if (Array.isArray(value)) { if (Array.isArray(value[0])) (value as number[][])[0]![0] = 999; else (value as number[])[0] = 999; }
  else values[id] = 999;
}

const preserveM5Fixtures = ENGINE_VERSION.endsWith('-m5');
await mkdir('fixtures/m5', { recursive: true }); await mkdir('docs/evidence', { recursive: true });
assert.equal(blockRegistry.length, 74);
const evidence = [];
for (const oracle of m5Oracles()) {
  const originalSnapshot = JSON.stringify(oracle.model), compiled = compileModel(oracle.model), result = await runModel(compiled); assert.equal(result.status, 'completed');
  const expectedSampleCount = compiled.model.execution.mode === 'static' ? 1 : Math.round((compiled.model.execution.stopTime - compiled.model.execution.startTime) / compiled.model.execution.step) + 1;
  assert.equal(result.samples.length, expectedSampleCount, `${oracle.id}: complete raw grid`); assert.equal(JSON.stringify(oracle.model), originalSnapshot, `${oracle.id}: compile/run preserves source model`);
  result.samples.forEach((sample, index) => assert.equal(sample.time, compiled.model.execution.startTime + index * compiled.model.execution.step, `${oracle.id}: exact requested output timestamp[${index}]`));
  assert.deepEqual([...compiled.outputIds].sort(), Object.keys(oracle.expected).sort(), `${oracle.id}: all outputs have independent expectations`);
  let maximumAbsoluteError = 0, maximumRelativeError = 0;
  for (const [id, expected] of Object.entries(oracle.expected)) for (const [index, sample] of result.samples.entries()) {
    const error = equal(sample.values[id], expected(sample.time, index), oracle.tolerance, oracle.relativeTolerance ?? 0, `${oracle.id}.${id}[${index}]`);
    maximumAbsoluteError = Math.max(maximumAbsoluteError, error.absolute); maximumRelativeError = Math.max(maximumRelativeError, error.relative);
  }
  for (const [id, unit] of Object.entries(oracle.expectedUnits ?? {})) assert.equal(compiled.outputTypes[id]!.unit, unit);
  const maximumResidual = residuals(oracle, result), expectedResult = structuredClone(stable(result));
  const reopened = compileModel(parseModelJson(serializeModel(compiled.model))); assert.equal(reopened.semanticKey, compiled.semanticKey); assert.deepEqual(stable(await runModel(reopened)), expectedResult, `${oracle.id}: portable JSON parity`);
  const reorderedModel = parseModel(compiled.model); reorderedModel.nodes.reverse(); reorderedModel.edges.reverse(); reorderedModel.datasets?.reverse(); reorderedModel.subsystems?.reverse();
  reorderedModel.subsystems?.forEach((definition) => { definition.nodes.reverse(); definition.edges.reverse(); definition.inputs.reverse(); definition.outputs.reverse(); });
  const reordered = compileModel(reorderedModel); assert.equal(reordered.semanticKey, compiled.semanticKey); assert.deepEqual(stable(await runModel(reordered)), expectedResult, `${oracle.id}: insertion order parity`);
  const manifest = await createExportManifest(compiled); assert.equal(manifest.modelHash, createHash('sha256').update(compiled.semanticKey).digest('hex')); assert.equal(manifest.targetVersion, 'typescript-m5-v1'); assert.deepEqual(await createExportManifest(reopened), manifest);
  const referenced = new Set(compiled.nodes.filter((node) => node.blockType === 'source.dataset').map((node) => node.parameters.datasetId)); assert.deepEqual(manifest.dataReferences.map((item) => item.id).sort(), [...referenced].sort());
  for (const reference of manifest.dataReferences) { const dataset = compiled.model.datasets!.find((item) => item.id === reference.id)!; assert.deepEqual(reference, { id: dataset.id, version: dataset.version, sourceHash: dataset.sourceHash, contentHash: dataset.contentHash, timeColumn: dataset.timeColumn, columns: dataset.columns }); }
  assert.deepEqual(manifest.hierarchyReferences ?? [], compiled.hierarchy?.instances ?? []);
  for (const reference of manifest.hierarchyReferences ?? []) assert.equal(reference.definitionHash, subsystemDefinitionHash(compiled.model.subsystems!.find((item) => item.id === reference.definitionId)!));
  const exported = await standalone(exportTypeScript(compiled, manifest), compiled.model.execution.mode), exportedResult = exported.run();
  assert.deepEqual(exportedResult, expectedResult, `${oracle.id}: actual standalone ESM parity`); assert.deepEqual(exported.getManifest(), manifest);
  const changedManifest = exported.getManifest(); changedManifest.execution.step = 10; if (changedManifest.dataReferences[0]) changedManifest.dataReferences[0].contentHash = '0'.repeat(64); if (changedManifest.hierarchyReferences?.[0]) changedManifest.hierarchyReferences[0].definitionHash = '0'.repeat(64);
  mutateFirstValue(exportedResult); mutateFirstValue(result); assert.deepEqual(exported.run(), expectedResult); assert.deepEqual(exported.getManifest(), manifest); assert.deepEqual(stable(await runModel(compiled)), expectedResult);
  if (preserveM5Fixtures) await writeFile(`fixtures/m5/${oracle.id}.cw.json`, serializeModel(compiled.model) + '\n'); if (preserveM5Fixtures) await writeFile(`fixtures/m5/${oracle.id}.expected.json`, JSON.stringify({ reference: oracle.reference, absoluteTolerance: oracle.tolerance, relativeTolerance: oracle.relativeTolerance ?? 0, expectedUnits: oracle.expectedUnits, residuals: oracle.residuals, result: expectedResult, manifest }, null, 2) + '\n');
  evidence.push({ id: oracle.id, reference: oracle.reference, nodes: compiled.nodes.length, samples: result.samples.length, maximumAbsoluteError, maximumRelativeError, tolerance: oracle.tolerance, relativeTolerance: oracle.relativeTolerance ?? 0, maximumResidual, residualDefinitions: oracle.residuals ?? [], outputTypes: compiled.outputTypes, modelHash: manifest.modelHash, dataReferences: manifest.dataReferences, hierarchyReferences: manifest.hierarchyReferences,
    jsonRoundtrip: true, nodeOrderIndependent: true, independentTSParity: true, immutableResults: true, manifestParity: true, sourceModelPreserved: true });
}
const failures = [];
for (const oracle of m5FailureOracles()) {
  const compiled = compileModel(oracle.model); let runtimeError: ModelError | undefined;
  try { await runModel(compiled); } catch (error) { assert(error instanceof ModelError); runtimeError = error; }
  assert(runtimeError, `${oracle.id}: controlled failure`); assert.equal(runtimeError.diagnostics[0]?.code, oracle.expectedCode); assert.equal(runtimeError.diagnostics[0]?.nodeId, oracle.nodeId);
  if (oracle.minimumPartialSamples !== undefined) { assert(runtimeError.partialResult); assert.equal(runtimeError.partialResult.status, 'failed'); assert.equal(runtimeError.partialResult.samples.length, oracle.minimumPartialSamples); assert(runtimeError.diagnostics[0]!.time !== undefined); }
  for (const [output, expected] of Object.entries(oracle.expectedPartial ?? {})) for (const [index, sample] of runtimeError.partialResult!.samples.entries()) {
    assert.equal(sample.time, compiled.model.execution.startTime + index * compiled.model.execution.step); assert(sample.time < runtimeError.diagnostics[0]!.time!);
    equal(sample.values[output], expected(sample.time, index), 2e-11, 0, `${oracle.id}.${output}.partial[${index}]`);
  }
  const exported = await standalone(exportTypeScript(compiled), compiled.model.execution.mode); let exportedError: { diagnostics: unknown; partialResult?: RunResult } | undefined;
  try { exported.run(); } catch (error) { exportedError = error as typeof exportedError; }
  assert(exportedError); assert.deepEqual(exportedError.diagnostics, runtimeError.diagnostics, `${oracle.id}: code/node/time diagnostic parity`); assert.deepEqual(exportedError.partialResult && stable(exportedError.partialResult), runtimeError.partialResult && stable(runtimeError.partialResult), `${oracle.id}: complete partial result parity`);
  const reopened = compileModel(parseModelJson(serializeModel(compiled.model))); assert.equal(reopened.semanticKey, compiled.semanticKey);
  if (preserveM5Fixtures) await writeFile(`fixtures/m5/${oracle.id}.cw.json`, serializeModel(compiled.model) + '\n'); if (preserveM5Fixtures) await writeFile(`fixtures/m5/${oracle.id}.expected.json`, JSON.stringify({ expectedCode: oracle.expectedCode, nodeId: oracle.nodeId, diagnostics: runtimeError.diagnostics, partialResult: runtimeError.partialResult && stable(runtimeError.partialResult) }, null, 2) + '\n');
  failures.push({ id: oracle.id, kind: 'runtime', code: oracle.expectedCode, nodeId: oracle.nodeId, diagnosticVerified: true, diagnosticParity: true, partialResultParity: true, independentPartialValues: !!oracle.expectedPartial, lastValidSamples: runtimeError.partialResult?.samples.length ?? 0 });
}
const budgets = [];
for (const id of ['F05-rectangular-product', 'F05-quantize-32bit-saturate-fraction']) {
  const oracle = m5Oracles().find((item) => item.id === id)!, compiled = compileModel(oracle.model), byId = new Map(compiled.nodes.map((node) => [node.id, node])), costs = compiled.nodes.map((node) => ({ id: node.id, blockType: node.blockType, operations: nodeOperationCost(node, byId) })), total = costs.reduce((sum, item) => sum + item.operations, 0);
  const ordinary = await runModel(compiled), tracked = await runModel(compiled, { trackOperations: true }); assert.equal(ordinary.resources, undefined); assert.equal(tracked.resources!.operations, total); assert.deepEqual(tracked.samples, ordinary.samples);
  let limitedError: ModelError | undefined; try { await runModel(compiled, { maxOperations: total - 1, trackOperations: true }); } catch (error) { assert(error instanceof ModelError); limitedError = error; }
  assert.equal(limitedError?.diagnostics[0]?.code, 'RUNTIME_OPERATION_BUDGET');
  budgets.push({ id, weightedNodeCosts: costs, operationTotal: total, requestedLimit: total - 1, code: 'RUNTIME_OPERATION_BUDGET', trackedSamplesUnchanged: true, defaultExportNumericalParityVerified: true, lowLimitStandaloneParityClaimed: false });
}
{
  const oracle = m5Oracles().find((item) => item.id === 'F05-temporal-lookup-continuous')!, compiled = compileModel(oracle.model), tracked = await runModel(compiled, { trackOperations: true }), limit = Math.floor(tracked.resources!.operations / 2);
  let error: ModelError | undefined; try { await runModel(compiled, { maxOperations: limit, trackOperations: true }); } catch (caught) { assert(caught instanceof ModelError); error = caught; }
  assert.equal(error?.diagnostics[0]?.code, 'RUNTIME_OPERATION_BUDGET'); assert(error?.partialResult && error.partialResult.samples.length > 0 && error.partialResult.samples.length < tracked.samples.length); assert(error.partialResult.resources!.operations <= limit);
  budgets.push({ id: oracle.id, operationTotal: tracked.resources!.operations, requestedLimit: limit, code: 'RUNTIME_OPERATION_BUDGET', preservedSamples: error.partialResult.samples.length, lastTime: error.partialResult.samples.at(-1)!.time, reportedOperations: error.partialResult.resources!.operations, lowLimitStandaloneParityClaimed: false });
}
const datasetDigest = createHash('sha256').update(await readFile('dataset/Simulink_Basic_Blocks_R2024b.md')).digest('hex');
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length }, registry: { total: blockRegistry.length, static: blockRegistry.filter((block) => block.supportedModes.includes('static')).length, continuous: blockRegistry.filter((block) => block.supportedModes.includes('continuous')).length }, datasetSha256: datasetDigest,
  methodology: 'Hand rectangular dot products, cofactor determinant and solved inverse/RHS/factors; independent index-sum AX-B, A*inverse-I, LL^T-A and PA-LU residuals. Nonuniform global bilinear function, explicit nearest/previous knot tables and analytic time integrals. Exact rational rounding and modulo2^32 expected codes include large binary64 integers and subnormal directed rounding. Every raw output sample is checked. Portable JSON, graph insertion order, all three strict ES2022-only import-free generator forms executed as actual ESM, SHA-256/reference manifests, defensive copies, and failure code/node/time/partial result parity. Requested low operation limits are runner-only checks and are not claimed as optional-argument standalone parity.',
  strictIndependentTypecheck: checkedModes.size === 3, strictIndependentModes: [...checkedModes].sort(), fixtures: evidence, failures, weightedBudgets: budgets };
await writeFile(preserveM5Fixtures ? 'docs/evidence/m5-verification.json' : `docs/evidence/m5-regression-on-${ENGINE_VERSION.split('-').at(-1)}.json`, JSON.stringify(report, null, 2) + '\n'); process.stdout.write(JSON.stringify({ engineVersion: ENGINE_VERSION, fixtures: evidence.length, strictIndependentModes: report.strictIndependentModes, failures: failures.length, weightedBudgetChecks: budgets.length, datasetSha256: datasetDigest }) + '\n');
