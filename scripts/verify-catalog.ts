import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { EXPANSION_BLOCK_IDS } from '../packages/block-library/src/expansion';
import { EXPANDED_TIME_SOURCE_IDS } from '../packages/block-library/src/time-sources';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { getPythonDiagnostics } from '../packages/codegen-python/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type CalcModel, type RunResult, type SignalValue } from '../packages/model/src';
import { EXPANSION_FIXTURES, expansionModel, type ExpansionFixture } from '../tests/block-expansion-fixtures';
import { TIME_SOURCE_FIXTURES, timeSourceModel } from '../tests/time-source-fixtures';

const directory = resolve('.test-generated/catalog-parity');
await mkdir(directory, { recursive: true });
await mkdir('docs/evidence', { recursive: true });
assert.equal(blockRegistry.length, 144);
assert.equal(new Set(blockRegistry.map(block => block.id)).size, 144);
assert.deepEqual([...EXPANSION_FIXTURES.map(fixture => fixture.id)].sort(), [...EXPANSION_BLOCK_IDS].sort());
assert.deepEqual(TIME_SOURCE_FIXTURES.map(fixture => fixture.blockId).sort(), [...EXPANDED_TIME_SOURCE_IDS].sort());
const strictModes = new Set<string>();
let ordinal = 0, checkedSamples = 0;
const tolerance = 2e-12;

function compare(actual: unknown, expected: unknown, path: string): number {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path); assert(Number.isFinite(actual), path);
    const error = Math.abs((actual as number) - expected);
    assert(error <= tolerance * Math.max(1, Math.abs(expected)), `${path}: ${actual} vs ${expected}`);
    return error;
  }
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), path); assert.equal(actual.length, expected.length, path);
    return expected.reduce((maximum, value, index) => Math.max(maximum, compare(actual[index], value, `${path}[${index}]`)), 0);
  }
  if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), path);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    return Object.entries(expected).reduce((maximum, [key, value]) => Math.max(maximum, compare((actual as Record<string, unknown>)[key], value, `${path}.${key}`)), 0);
  }
  assert.equal(actual, expected, path); return 0;
}
function stable(result: RunResult) { const { elapsedMs: _elapsed, ...contract } = result; return contract; }
async function actualTargets(model: CalcModel, expected: (time: number) => SignalValue, strict = false, pythonRejected = true) {
  const compiled = compileModel(model), result = await runModel(compiled);
  assert.equal(result.status, 'completed');
  let maximumAbsoluteError = 0;
  for (const sample of result.samples) { maximumAbsoluteError = Math.max(maximumAbsoluteError, compare(sample.values.result, expected(sample.time), `${model.name}@${sample.time}`)); checkedSamples++; }
  const roundtrip = compileModel(parseModelJson(serializeModel(model)));
  assert.deepEqual(stable(await runModel(roundtrip)), stable(result));
  const metadata = await createExportManifest(compiled), source = exportTypeScript(compiled, metadata);
  const prefix = String(ordinal++).padStart(4, '0'), tsFile = join(directory, `${prefix}.ts`), moduleFile = join(directory, `${prefix}.mjs`);
  await writeFile(tsFile, source);
  if (strict || !strictModes.has(model.execution.mode)) {
    const program = ts.createProgram([tsFile], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, lib: ['lib.es2022.d.ts'], types: [], noEmit: true });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
    strictModes.add(model.execution.mode);
  }
  await writeFile(moduleFile, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const generated = await import(/* @vite-ignore */ pathToFileURL(moduleFile).href);
  assert.deepEqual(generated.getManifest(), metadata);
  compare(generated.run(), stable(result), `${model.name}/actual TypeScript`);
  if (pythonRejected) assert(getPythonDiagnostics(compiled).some(item => item.nodeId), `${model.name}: new cards must report Python unsupported`);
  return { maximumAbsoluteError, samples: result.samples.length, modelHash: metadata.modelHash, targetVersion: metadata.targetVersion };
}

const fixtures: Record<string, unknown>[] = [];
for (const fixture of EXPANSION_FIXTURES) {
  const modes: Record<string, unknown> = {}; let maximumAbsoluteError = 0;
  for (const mode of ['static', 'discrete', 'continuous'] as const) {
    const result = await actualTargets(expansionModel(fixture, mode), () => fixture.expected);
    maximumAbsoluteError = Math.max(maximumAbsoluteError, result.maximumAbsoluteError); modes[mode] = result;
  }
  fixtures.push({ id: fixture.id, blockIds: [fixture.id], maximumAbsoluteError, tolerance, staticVerified: true, discreteVerified: true, continuousVerified: true, independentTSParity: true, jsonRoundtrip: true, modes });
}
for (const fixture of TIME_SOURCE_FIXTURES) {
  assert.throws(() => compileModel(timeSourceModel(fixture, 'static')), ModelError);
  const modes: Record<string, unknown> = {}; let maximumAbsoluteError = 0;
  for (const mode of ['discrete', 'continuous'] as const) {
    const result = await actualTargets(timeSourceModel(fixture, mode), fixture.expected, true);
    maximumAbsoluteError = Math.max(maximumAbsoluteError, result.maximumAbsoluteError); modes[mode] = result;
  }
  fixtures.push({ id: fixture.id, blockIds: [fixture.blockId], reference: fixture.reference, maximumAbsoluteError, tolerance, staticVerified: false, unsupportedStaticVerified: true, discreteVerified: true, continuousVerified: true, independentTSParity: true, jsonRoundtrip: true, modes });
}
// Existing divide is a previously untracked source row, not a new implementation.
const divide = expansionModel({ id: 'math.hypot', inputs: { a: [8, 12], b: [2, 3] }, parameters: {}, expected: [4, 4] });
const operation = divide.nodes.find(node => node.id === 'operation')!;
assert(operation); operation.blockType = 'math.multiply'; operation.parameters = { operation: 'divide' };
let divideError = 0;
for (const mode of ['static', 'discrete', 'continuous'] as const) {
  divide.execution.mode = mode;
  const result = await actualTargets(divide, () => [4, 4], false, false); divideError = Math.max(divideError, result.maximumAbsoluteError);
}
fixtures.push({ id: 'CAT-existing-divide', blockIds: ['math.multiply'], maximumAbsoluteError: divideError, tolerance, staticVerified: true, discreteVerified: true, continuousVerified: true, independentTSParity: true, jsonRoundtrip: true });

const failures: { id: string; diagnosticVerified: boolean; diagnostics: unknown }[] = [];
const cases: { fixture: ExpansionFixture; code: string }[] = [
  { fixture: { id: 'math.log1p', inputs: { in: -1 }, parameters: {}, expected: 0 }, code: 'NUMERIC_DOMAIN' },
  { fixture: { id: 'math.acosh', inputs: { in: 0 }, parameters: {}, expected: 0 }, code: 'NUMERIC_DOMAIN' },
  { fixture: { id: 'math.atanh', inputs: { in: 1 }, parameters: {}, expected: 0 }, code: 'NUMERIC_DOMAIN' },
  { fixture: { id: 'vector.normalize', inputs: { in: [0, 0] }, parameters: {}, expected: [0, 0] }, code: 'NUMERIC_DOMAIN' },
  { fixture: { id: 'math.remainder', inputs: { a: 1, b: 0 }, parameters: {}, expected: 0 }, code: 'NUMERIC_DIVIDE_BY_ZERO' },
];
for (const entry of cases) {
  const compiled = compileModel(expansionModel(entry.fixture));
  let failure: ModelError | undefined;
  try { await runModel(compiled); } catch (error) { assert(error instanceof ModelError); failure = error; }
  assert(failure); assert.equal(failure.diagnostics[0]?.code, entry.code); assert.equal(failure.diagnostics[0]?.nodeId, 'operation');
  const file = join(directory, `failure-${ordinal++}.mjs`);
  await writeFile(file, ts.transpileModule(exportTypeScript(compiled), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const generated = await import(/* @vite-ignore */ pathToFileURL(file).href);
  try { generated.run(); assert.fail('Generated failure was not diagnosed'); } catch (error) { assert.deepEqual((error as ModelError).diagnostics, failure.diagnostics); }
  failures.push({ id: entry.fixture.id, diagnosticVerified: true, diagnostics: failure.diagnostics });
}
const datasetBytes = await readFile('dataset/Simulink_Basic_Blocks_R2024b.md');
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, registryCount: blockRegistry.length, newMathCards: 64, newTimeCards: 6, datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'), strictTypeScriptModes: [...strictModes], checkedSamples, actualGeneratedPrograms: ordinal, fixtures, failures, methodology: 'Every raw scalar/vector/matrix/boolean sample compared with independent analytic/hand fixtures in every supported mode. Actual standalone TypeScript ESM and manifests compared with JS; strict ES2022-only compilation per mode and all time sources. JSON roundtrip and original-node domain diagnostics verified. Floating tolerance is 2e-12 scaled by max(1,abs(expected)); shape/boolean/key sets are exact. Source-row approval checks use absolute error within 2e-12 for these fixtures. New cards are explicitly unavailable in Python. Existing M1-M7 contracts have separate regression evidence.', publicDeploymentClaimed: false };
await writeFile('docs/evidence/catalog-verification.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ fixtures: fixtures.length, failureFixtures: failures.length, checkedSamples, actualGeneratedPrograms: ordinal, registryCards: blockRegistry.length, strictTypeScriptModes: [...strictModes] }) + '\n');
