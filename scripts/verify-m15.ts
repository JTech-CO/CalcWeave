import assert from 'node:assert/strict';
import { registryWithoutApprovedObserverInputs } from './m16-support-source';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, serializeModel, parseModelJson, sha256, type CalcModel } from '../packages/model/src';
import { acceptModelPackage, createModelPackage, inspectModelPackage, PACKAGE_MIGRATION_BASELINES } from '../packages/model-package/src';
import { inspectModelImport, inspectNativeImport, createInteropArchive, inspectInteropArchive, matVariableDataset, originalNativeFile } from '../packages/interop/src';
import { runModel } from '../packages/runtime/src';
import { getReleaseCatalog } from '../packages/release/src';
import { PYTHON_TARGET, PYTHON_M7_TARGET } from '../packages/codegen-python/src/capabilities';
import { WASM_TARGET, C_CPP_TARGET } from '../packages/codegen-wasm/src/capabilities';
import { migrationFixture, signedLegacyPackage } from '../tests/m15-package-fixtures';
import { matFixture, mdlFixture, slxFixture } from '../tests/fixtures/m15-native';

const stage = ENGINE_VERSION.split('-').at(-1)!;
const frozen = existsSync('docs/evidence/m15-engineering-checks.json');
const output = stage === 'm15' && !frozen ? 'm15-verification' : `m15-regression-on-${stage}`;
const directory = resolve(`.test-generated/${output}`);
await mkdir(directory, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const pins = {
  'docs/baselines/m14-registry.json': '711fcb2062a90dcebdc4b2265f3a8660aadb3d8f2c4ede0de436a4f768ce0b40',
  'docs/evidence/m14-source-approvals.json': 'f7bf8f2a18377afd4d151b1b5bbea6e6eb72396e5c66b97c9a1a5b138c40448a',
  'docs/evidence/m14-verification.json': '6886130299827a0d52e99533c0b0cf0ea827e27b5bceb56ca687e18fa4954f65',
};
for (const [path, expected] of Object.entries(pins)) assert.equal(digest(await readFile(path)), expected, path);
const approval = await json('docs/evidence/m14-source-approvals.json');
for (const [path, expected] of Object.entries(approval.protectedArtifacts)) assert.equal(digest(await readFile(path)), expected, path);
const predecessor = await json('docs/baselines/m14-registry.json'); assert.equal(predecessor.length, 337);
const historicalRegistry = registryWithoutApprovedObserverInputs(blockRegistry);
for (const definition of predecessor) assert.deepEqual(historicalRegistry.find(item => item.id === definition.id), definition, `${definition.id}: historical canonical changed beyond two approved observer inputCount declarations`);
const catalog = getReleaseCatalog(); assert.equal(PYTHON_TARGET.blockIds.length, 69); assert.equal(PYTHON_M7_TARGET.blockIds.length, 51); assert(PYTHON_M7_TARGET.blockIds.every(id => PYTHON_TARGET.blockIds.includes(id))); assert.equal(WASM_TARGET.blockIds.length, 16); assert.equal(C_CPP_TARGET.available, false);
assert(catalog.blocks.every(item => item.exportTargets.includes('python') === PYTHON_TARGET.blockIds.includes(item.id) && item.exportTargets.includes('wasm') === WASM_TARGET.blockIds.includes(item.id)));

// Separate processes keep actual generated-program execution and its memory isolated per target.
const targetLogs: Record<string, { sha256: string; summary: string }> = {};
for (const target of ['python', 'wasm']) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', `scripts/verify-m15-${target}.ts`], { encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  const text = result.stdout + result.stderr;
  await writeFile(resolve(directory, `${target}.log`), text);
  assert.equal(result.status, 0, `${target}: ${text.slice(-2000)}`);
  targetLogs[target] = { sha256: digest(text), summary: result.stdout.trim().split(/\r?\n/).at(-1)! };
}
const targetPath = (target: string) => `docs/evidence/${stage === 'm15' && !frozen ? `m15-${target}-verification` : `m15-${target}-regression-on-${stage}`}.json`;
const python = await json(targetPath('python')), wasm = await json(targetPath('wasm'));
assert.equal(python.engineVersion, ENGINE_VERSION); assert.equal(python.actualPrograms, 142); assert.equal(python.checkedSamples, 256);
assert.equal(wasm.engineVersion, ENGINE_VERSION); assert.equal(wasm.counts.actualIncludingJsonReversePrograms, 128);
for (const report of [python.fileSha256, wasm.sourceArtifactHashes]) for (const [path, hash] of Object.entries(report)) assert.equal(digest(await readFile(path)), hash, `executed source ${path}`);

const interop: Record<string, unknown>[] = [];
for (const [format, bytes] of [['slx', slxFixture()], ['mdl', mdlFixture()]] as const) {
  const inspection = await inspectNativeImport(bytes, `analytic.${format}`);
  assert.equal(inspection.report.parse, 'passed'); assert.equal(inspection.report.execution, 'supported'); assert.equal(inspection.report.numericalEquivalence, 'unverified');
  const compiled = compileModel(inspection.model!), result = await runModel(compiled);
  // These independent fixtures contain only pure Constant/Gain/Scope nodes;
  // the selected import profile correctly compiles them as a static calculation.
  assert.equal(inspection.model!.execution.mode, 'static');
  assert.deepEqual(result.samples.map(sample => sample.time), [0]); assert.deepEqual(result.samples.map(sample => sample.values.Native3), [6]);
  const restored = compileModel(parseModelJson(serializeModel(inspection.model!))); assert.equal(restored.semanticKey, compiled.semanticKey);
  const pack = await createModelPackage(inspection.model!), accepted = await acceptModelPackage(pack.text, pack.fingerprint); assert.equal(compileModel(accepted).semanticKey, compiled.semanticKey);
  const archive = await createInteropArchive(inspection), unpacked = await inspectInteropArchive(archive);
  assert.deepEqual(originalNativeFile(unpacked.inspection), Uint8Array.from(bytes)); assert.deepEqual(unpacked.inspection.report, inspection.report); assert.equal(compileModel(unpacked.inspection.model!).semanticKey, compiled.semanticKey);
  interop.push({ format, sourceHash: inspection.sourceHash, samples: result.samples.length, analyticOracle: 'pure stateless graph: 2*3=6 at one static observation', actualNativeCalcWeaveExecuted: true, nativeFormatReferenceRuntimeExecuted: false, originalBytesRecovered: true, archiveReparsed: true, modelJsonAndSignedPackageSemanticParity: true, report: inspection.report });
}
const matBytes = matFixture('signals', [[0, 1, -3], [.5, 2, 0], [1, 3, 9]]), mat = await inspectNativeImport(matBytes, 'signals.mat'), dataset = matVariableDataset(mat, 'signals');
assert.deepEqual(dataset.rows, [[0, 1, -3], [.5, 2, 0], [1, 3, 9]]); assert.equal(dataset.provenance!.format, 'mat-v5');
const matArchive = await createInteropArchive(mat, 'signals'), recoveredMat = await inspectInteropArchive(matArchive); assert.deepEqual(originalNativeFile(recoveredMat.inspection), matBytes); assert.deepEqual(recoveredMat.dataset, dataset);
const playback: CalcModel = { schemaVersion: 1, modelId: 'm15_mat_playback', name: 'MAT 표 계산', nodes: [{ id: 'input', blockVersion: 1, blockType: 'source.dataset', label: 'Playback', parameters: { datasetId: dataset.id, column: 'signal1', interpolation: 'linear', outside: 'error' } }, { id: 'result', blockVersion: 1, blockType: 'sink.scope', label: 'Result', parameters: {} }], edges: [{ id: 'e', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }], layout: {}, datasets: [dataset], execution: { mode: 'discrete', startTime: 0, stopTime: 1, step: .5 } };
const matCompiled = compileModel(playback), nativeResult = await runModel(matCompiled); assert.deepEqual(nativeResult.samples.map(sample => sample.values.result), [1, 2, 3]);
const manifest = await createExportManifest(matCompiled), source = exportTypeScript(matCompiled, manifest), emitted = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true } }).outputText;
const file = resolve(directory, 'mat-playback.mjs'); await writeFile(file, emitted); const actual = await import(pathToFileURL(file).href); assert.deepEqual(actual.getManifest(), manifest); assert.deepEqual(actual.run().samples, nativeResult.samples);
const matSigned = await createModelPackage(playback); assert.deepEqual((await runModel(compileModel(await acceptModelPackage(matSigned.text, matSigned.fingerprint)))).samples, nativeResult.samples);
interop.push({ format: 'mat-v5', sourceHash: mat.sourceHash, originalBytesRecovered: true, archiveReparsed: true, actualNativeCalcWeaveExecuted: true, actualGeneratedTypeScriptExecuted: true, signedPackageParity: true, analyticOracle: 'column-major table playback [1,2,3] at [0,.5,1]', sourceHashAndProvenancePreserved: true, nativeFormatReferenceRuntimeExecuted: false });

const migration: Record<string, unknown>[] = [];
for (const baseline of PACKAGE_MIGRATION_BASELINES) {
  const signed = await signedLegacyPackage(migrationFixture(), baseline.engineVersion, baseline.stage), inspection = await inspectModelPackage(signed.text);
  assert.equal(inspection.migration!.originalRegistrySha256, baseline.registrySha256); assert.equal(inspection.migration!.optionCoercionPerformed, false);
  await assert.rejects(acceptModelPackage(signed.text, signed.fingerprint), error => !!error && typeof error === 'object' && 'diagnostics' in error && (error.diagnostics as { code: string }[]).some(item => item.code === 'PACKAGE_MIGRATION_REVIEW_REQUIRED'));
  const model = await acceptModelPackage(signed.text, signed.fingerprint, { reviewedMigration: true }); assert.deepEqual((await runModel(compileModel(model))).samples.map(sample => sample.values.result), [6]);
  migration.push({ ...inspection.migration, originalSignatureVerified: true, independentTrustRequired: true, explicitReviewRequired: true, analyticOracle: '2*3=6', originalPayloadRetainedSha256: digest(signed.text) });
}
const native = inspectModelImport(serializeModel(migrationFixture())); assert(native.parsed && native.executable && !native.converted); assert.equal(compileModel(native.model!).semanticKey, compileModel(migrationFixture()).semanticKey);
const sourcePaths = ['scripts/verify-m15.ts', 'packages/model-package/src/index.ts', 'packages/model-package/src/migrations.ts', 'packages/interop/src/native.ts', 'packages/interop/src/native-types.ts', 'packages/interop/src/native-model.ts', 'packages/interop/src/bounded-format.ts', 'packages/interop/src/mat-v5.ts', 'tests/fixtures/m15-native.ts', 'tests/m15-package-fixtures.ts'];
const report = { generatedAt: new Date().toISOString(), stage: 'M15', engineVersion: ENGINE_VERSION, registryDefinitions: blockRegistry.length, immutablePredecessorDefinitions: 337, protectedArtifacts: { ...approval.protectedArtifacts, ...pins }, sourceSubset: 367, missingSourceRows: 18, sourceApprovalsAdded: 0, fullSourceOptionsClosed: 0, python: { evidencePath: targetPath('python'), evidenceSha256: digest(await readFile(targetPath('python'))), actualPrograms: python.actualPrograms, checkedSamples: python.checkedSamples, supportedDefinitions: 69, originalDefinitionsRetained: 51 }, wasm: { evidencePath: targetPath('wasm'), evidenceSha256: digest(await readFile(targetPath('wasm'))), counts: wasm.counts, supportedDefinitions: 16 }, targetLogs, interop, migrations: migration, nativeSchema1: { parsed: true, converted: false, executable: true, currentSemanticParity: true, claimedSourceEngineKnown: false }, sourceArtifactHashes: Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await readFile(path))]))), limitations: { cCppGeneratorApproved: false, nativeMatlabReferenceExecuted: false, editedNativeModelExportSupported: false, fullSimulinkEquivalenceClaimed: false, publicDeploymentClaimed: false } };
await writeFile(`docs/evidence/${output}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pythonPrograms: python.actualPrograms, wasmPrograms: wasm.counts.actualIncludingJsonReversePrograms, interopProfiles: interop.length, legacyMigrationProfiles: migration.length, nativeJsonSemanticParity: true, immutableDefinitions: 337, sourceSubset: 367 }));
