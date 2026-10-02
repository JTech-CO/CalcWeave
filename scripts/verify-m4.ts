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
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { importDataset } from '../packages/data/src';
import { compareRuns, runParameterSweep } from '../packages/experiments/src';
import { DATASET_LIMITS, ENGINE_VERSION, ModelError, parseModel, parseModelJson, serializeModel, type RunResult } from '../packages/model/src';
import { datasetRangeFailure, m4Oracles, m4SharedBudgetModel, m4SweepModel } from './m4-oracles';

function stable(result: RunResult): Omit<RunResult, 'elapsedMs'> { const { elapsedMs: _elapsed, ...rest } = result; return rest; }
function equal(actual: unknown, expected: unknown, tolerance: number, path: string): number {
  if (typeof actual === 'number' && typeof expected === 'number') {
    const error = Math.abs(actual - expected); assert(Number.isFinite(actual) && error <= tolerance, `${path}: ${actual} != ${expected}`); return error;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, path); return actual.reduce((maximum, value, index) => Math.max(maximum, equal(value, expected[index], tolerance, `${path}[${index}]`)), 0);
  }
  assert.deepEqual(actual, expected, path); return 0;
}
const preserveM4Fixtures = ENGINE_VERSION.endsWith('-m4');
const checkedModes = new Set<string>();
async function standalone(code: string, mode: string) {
  assert(!/\beval\s*\(|new\s+Function|\bimport\s/.test(code), 'Standalone code must be import-free without dynamic source evaluation');
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-m4-'));
  const sourcePath = join(directory, 'model.ts'), modulePath = join(directory, 'model.mjs');
  try {
    if (!checkedModes.has(mode)) {
      await writeFile(sourcePath, code);
      const program = ts.createProgram([sourcePath], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true });
      const diagnostics = ts.getPreEmitDiagnostics(program).filter((item) => item.category === ts.DiagnosticCategory.Error);
      assert.deepEqual(diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `Strict independent ${mode} ES2022 TypeScript`); checkedModes.add(mode);
    }
    await writeFile(modulePath, ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    // Only repository-owned fixed generator output is loaded. Model fields remain data.
    return await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  } finally {
    await unlink(sourcePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await unlink(modulePath).catch((error) => { if (error.code !== 'ENOENT') throw error; }); await rmdir(directory);
  }
}

await mkdir('fixtures/m4', { recursive: true }); await mkdir('docs/evidence', { recursive: true });
assert.equal(blockRegistry.length, preserveM4Fixtures ? 64 : 74);
const evidence = [];
for (const oracle of m4Oracles()) {
  const compiled = compileModel(oracle.model), result = await runModel(compiled); assert.equal(result.status, 'completed');
  const expectedSampleCount = compiled.model.execution.mode === 'static' ? 1 : Math.round((compiled.model.execution.stopTime - compiled.model.execution.startTime) / compiled.model.execution.step) + 1;
  assert.equal(result.samples.length, expectedSampleCount, `${oracle.id}: complete raw grid`);
  assert.deepEqual([...compiled.outputIds].sort(), Object.keys(oracle.expected).sort(), `${oracle.id}: all outputs have independent expectations`);
  let maximumAbsoluteError = 0;
  for (const [id, expected] of Object.entries(oracle.expected)) for (const [index, sample] of result.samples.entries()) {
    maximumAbsoluteError = Math.max(maximumAbsoluteError, equal(sample.values[id], expected(sample.time, index), oracle.tolerance, `${oracle.id}.${id}[${index}]`));
  }
  for (const [id, unit] of Object.entries(oracle.expectedUnits ?? {})) assert.equal(compiled.outputTypes[id]!.unit, unit);
  if (oracle.expectedFinalState) assert.deepEqual(result.finalState, oracle.expectedFinalState);
  if (oracle.flatReference) assert.deepEqual(stable(await runModel(compileModel(oracle.flatReference))), stable(result), `${oracle.id}: hand-built flat equations`);
  const reopened = compileModel(parseModelJson(serializeModel(compiled.model))); assert.equal(reopened.semanticKey, compiled.semanticKey);
  assert.deepEqual(stable(await runModel(reopened)), stable(result), `${oracle.id}: portable JSON parity`);
  const reorderedModel = parseModel(compiled.model); reorderedModel.nodes.reverse(); reorderedModel.edges.reverse(); reorderedModel.datasets?.reverse(); reorderedModel.subsystems?.reverse();
  reorderedModel.subsystems?.forEach((definition) => { definition.nodes.reverse(); definition.edges.reverse(); definition.inputs.reverse(); definition.outputs.reverse(); });
  const reordered = compileModel(reorderedModel); assert.equal(reordered.semanticKey, compiled.semanticKey);
  assert.deepEqual(stable(await runModel(reordered)), stable(result), `${oracle.id}: insertion order`);
  const manifest = await createExportManifest(compiled); assert.equal(manifest.modelHash, createHash('sha256').update(compiled.semanticKey).digest('hex')); assert.equal(manifest.targetVersion, 'typescript-m4-v1', `${oracle.id}: M4 capability manifest`);
  assert.deepEqual(await createExportManifest(reopened), manifest, `${oracle.id}: JSON reopen manifest/reference parity`);
  const referenced = new Set(compiled.nodes.filter((node) => node.blockType === 'source.dataset').map((node) => node.parameters.datasetId));
  assert.deepEqual(manifest.dataReferences.map((item) => item.id).sort(), [...referenced].sort());
  for (const reference of manifest.dataReferences) {
    const dataset = compiled.model.datasets!.find((item) => item.id === reference.id)!;
    assert.deepEqual(reference, { id: dataset.id, version: dataset.version, sourceHash: dataset.sourceHash, contentHash: dataset.contentHash, timeColumn: dataset.timeColumn, columns: dataset.columns });
  }
  assert.deepEqual(manifest.hierarchyReferences ?? [], compiled.hierarchy?.instances ?? []);
  for (const reference of manifest.hierarchyReferences ?? []) assert.equal(reference.definitionHash, subsystemDefinitionHash(compiled.model.subsystems!.find((item) => item.id === reference.definitionId)!), `${oracle.id}: definition content hash`);
  const exported = await standalone(exportTypeScript(compiled, manifest), compiled.model.execution.mode), exportedResult = exported.run();
  assert.deepEqual(exportedResult, stable(result), `${oracle.id}: actual standalone ESM parity`); assert.deepEqual(exported.getManifest(), manifest);
  const changedManifest = exported.getManifest(); changedManifest.execution.step = 10; if (changedManifest.dataReferences[0]) changedManifest.dataReferences[0].contentHash = '0'.repeat(64);
  if (changedManifest.hierarchyReferences?.[0]) changedManifest.hierarchyReferences[0].definitionHash = '0'.repeat(64);
  exportedResult.samples[0].values[Object.keys(exportedResult.samples[0].values)[0]!] = 999;
  assert.deepEqual(exported.run(), stable(result)); assert.deepEqual(exported.getManifest(), manifest);
  if (preserveM4Fixtures) await writeFile(`fixtures/m4/${oracle.id}.cw.json`, serializeModel(compiled.model) + '\n');
  if (preserveM4Fixtures) await writeFile(`fixtures/m4/${oracle.id}.expected.json`, JSON.stringify({ reference: oracle.reference, absoluteTolerance: oracle.tolerance, expectedUnits: oracle.expectedUnits, result: stable(result), manifest }, null, 2) + '\n');
  evidence.push({ id: oracle.id, reference: oracle.reference, nodes: compiled.nodes.length, samples: result.samples.length, maximumAbsoluteError, tolerance: oracle.tolerance,
    outputTypes: compiled.outputTypes, modelHash: manifest.modelHash, dataReferences: manifest.dataReferences, hierarchyReferences: manifest.hierarchyReferences,
    jsonRoundtrip: true, nodeOrderIndependent: true, independentTSParity: true, immutableResults: true, manifestParity: true, handBuiltFlatParity: !!oracle.flatReference });
}
const rangeModel = datasetRangeFailure(), rangeCompiled = compileModel(rangeModel);
let runtimeError: ModelError | undefined;
try { await runModel(rangeCompiled); } catch (error) { assert(error instanceof ModelError); runtimeError = error; }
assert(runtimeError?.diagnostics[0]?.code === 'DATASET_TIME_RANGE', 'Explicit outside:error must fail at the table boundary');
const rangeExported = await standalone(exportTypeScript(rangeCompiled), rangeCompiled.model.execution.mode);
let exportedError: { diagnostics: unknown; partialResult?: RunResult } | undefined;
try { rangeExported.run(); } catch (error) { exportedError = error as typeof exportedError; }
assert(exportedError); assert.deepEqual(exportedError.diagnostics, runtimeError.diagnostics);
assert.deepEqual(exportedError.partialResult && stable(exportedError.partialResult), runtimeError.partialResult && stable(runtimeError.partialResult));
if (preserveM4Fixtures) await writeFile('fixtures/m4/F04-failure-outside-error.cw.json', serializeModel(rangeModel) + '\n');
const failures: { id: string; kind: 'runtime' | 'import'; code: string; diagnosticVerified: true; diagnosticParity?: true; partialResultParity?: true; modelPreserved?: true; lastValidSamples?: number }[] = [{ id: 'F04-failure-outside-error', kind: 'runtime', code: 'DATASET_TIME_RANGE', diagnosticVerified: true, diagnosticParity: true, partialResultParity: true, lastValidSamples: runtimeError.partialResult?.samples.length ?? 0 }];
const importOptions = { id: 'data', name: 'validation', format: 'csv' as const, timeColumn: 'time', columns: [{ name: 'time', kind: 'number' as const, unit: 's' }, { name: 'value', kind: 'number' as const, unit: '1' }] };
const baseModel = m4Oracles()[0]!.model, snapshot = JSON.stringify(baseModel);
for (const [id, expectedCode, action] of [
  ['invalid-csv', 'INVALID_CSV', () => importDataset('time,value\n0,"open', importOptions)],
  ['text-bytes', 'DATASET_TOO_LARGE', () => importDataset('한'.repeat(Math.ceil(DATASET_LIMITS.maxBytes / 3)), importOptions)],
  ['nonfinite', 'NONFINITE_DATASET', () => importDataset('time,value\n0,1e999', importOptions)],
  ['duplicate-time', 'DUPLICATE_DATASET_TIME', () => importDataset('time,value\n0,1\n0,2', importOptions)],
  ['mutated-content', 'DATASET_HASH_MISMATCH', () => { const copy = structuredClone(baseModel); copy.datasets![0]!.rows[0]![1] = 100; parseModel(copy); }],
] as const) {
  let error: ModelError | undefined; try { action(); } catch (caught) { assert(caught instanceof ModelError); error = caught; }
  assert(error?.diagnostics.some((item) => item.code === expectedCode), `${id}: controlled data diagnostic`); assert.equal(JSON.stringify(baseModel), snapshot, `${id}: original model remains unchanged`);
  failures.push({ id, kind: 'import', code: expectedCode, diagnosticVerified: true, modelPreserved: true });
}
const datasetDigest = createHash('sha256').update(await readFile('dataset/Simulink_Basic_Blocks_R2024b.md')).digest('hex');
const sweepModel = m4SweepModel(), sweepSnapshot = JSON.stringify(sweepModel), sweepSpec = { nodeId: 'gain', parameter: 'gain', values: [1, 2, 3] };
const sweep = await runParameterSweep(sweepModel, sweepSpec); assert.equal(sweep.status, 'completed'); assert.equal(sweep.records.length, 3); assert.equal(JSON.stringify(sweepModel), sweepSnapshot);
const comparison = compareRuns(sweep.records); assert.equal(comparison.status, 'completed'); assert.equal(comparison.outputs.length, 1);
for (const [index, record] of sweep.records.entries()) {
  let maximumAbsoluteError = 0;
  for (const sample of record.result.samples) maximumAbsoluteError = Math.max(maximumAbsoluteError, equal(sample.values.result, record.value * (sample.time * sample.time + sample.time), 2e-9, `sweep k=${record.value}`));
  assert(record.result.resources!.operations > 0);
  const reopened = compileModel(parseModelJson(serializeModel(record.model))); assert.equal(record.modelHash, createHash('sha256').update(reopened.semanticKey).digest('hex'));
  assert.deepEqual(await createExportManifest(reopened), record.manifest);
  const exported = await standalone(exportTypeScript(reopened, record.manifest), 'continuous'); const { resources: _resources, ...numericalResult } = stable(record.result);
  assert.deepEqual(exported.run(), numericalResult, 'Sweep numerical export parity; optional operation accounting is a runner measurement');
  const expectedRmse = Math.abs(record.value - 1) * Math.sqrt(record.result.samples.reduce((sum, sample) => sum + (sample.time * sample.time + sample.time) ** 2, 0) / record.result.samples.length);
  const compared = comparison.outputs[0]!.values[index]!; equal(compared.finalValue, 2 * record.value, 2e-9, 'sweep final value'); equal(compared.delta, 2 * (record.value - 1), 2e-9, 'sweep final delta'); equal(compared.rmse, expectedRmse, 2e-9, 'sweep independent RMSE');
  if (preserveM4Fixtures) await writeFile(`fixtures/m4/F04-sweep-k${record.value}.cw.json`, serializeModel(record.model) + '\n');
  if (preserveM4Fixtures) await writeFile(`fixtures/m4/F04-sweep-k${record.value}.expected.json`, JSON.stringify({ reference: `x(t)=${record.value}*(t^2+t), independent samplewise exact integral.`, maximumAbsoluteError, result: stable(record.result), manifest: record.manifest }, null, 2) + '\n');
}
const repeatedSweep = await runParameterSweep(sweepModel, sweepSpec); assert.deepEqual(repeatedSweep.records.map((record) => record.modelHash), sweep.records.map((record) => record.modelHash));
const sharedBudget = m4SharedBudgetModel();
const recordLimited = await runParameterSweep(sharedBudget, sweepSpec, { maxRecordedValues: 4 }); assert.equal(recordLimited.status, 'failed'); assert.equal(recordLimited.records.length, 2); assert.equal(recordLimited.diagnostics![0]!.code, 'SWEEP_RECORD_BUDGET');
const operationLimited = await runParameterSweep(sharedBudget, sweepSpec, { maxOperations: 6 }); assert.equal(operationLimited.status, 'failed'); assert.equal(operationLimited.records.length, 2); assert.equal(operationLimited.diagnostics![0]!.code, 'SWEEP_OPERATION_BUDGET');
const controller = new AbortController(); const cancelled = await runParameterSweep(sharedBudget, sweepSpec, { signal: controller.signal, onProgress: () => controller.abort() }); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.records.length, 1);
const experiments = { reference: 'Dataset y=2t+1, Gain k in [1,2,3], zero-state integral x=k(t^2+t). Compare against k1 with samplewise analytic RMSE and final delta2*(k-1).', runs: sweep.records.map((record) => ({ value: record.value, samples: record.result.samples.length, modelHash: record.modelHash, operations: record.result.resources!.operations, dataReferences: record.manifest.dataReferences, independentTSParity: true })), comparison, repeatedHashes: true, originalModelPreserved: true,
  sharedRecordBudget: { limit: 4, completed: 2, status: recordLimited.status, code: recordLimited.diagnostics![0]!.code }, sharedOperationBudget: { limit: 6, completed: 2, status: operationLimited.status, code: operationLimited.diagnostics![0]!.code }, cancellation: { status: cancelled.status, preservedRuns: cancelled.records.length } };
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  registry: { total: blockRegistry.length, static: blockRegistry.filter((block) => block.supportedModes.includes('static')).length, continuous: blockRegistry.filter((block) => block.supportedModes.includes('continuous')).length }, datasetSha256: datasetDigest,
  methodology: 'Independent linear/previous piecewise formulas and exact integrals, explicit affine conversions and approved dimensions, named scalar bus expectations, and hand-built repeated-state flat equations. Every raw output sample is checked. Portable JSON, reversed graph/definition insertion order, all three strict ES2022-only import-free generator forms executed as actual ESM, SHA-256/data/hierarchy references, defensive copies, and controlled error diagnostics/partial results are compared.',
  strictIndependentTypecheck: checkedModes.size === 3, strictIndependentModes: [...checkedModes].sort(), fixtures: evidence, failures, importFailureAtomicity: true, experiments };
await writeFile(preserveM4Fixtures ? 'docs/evidence/m4-verification.json' : `docs/evidence/m4-regression-on-${ENGINE_VERSION.split('-').at(-1)}.json`, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ engineVersion: ENGINE_VERSION, fixtures: evidence.length, strictIndependentModes: report.strictIndependentModes, failures: failures.length, experimentRuns: experiments.runs.length, datasetSha256: datasetDigest }) + '\n');
