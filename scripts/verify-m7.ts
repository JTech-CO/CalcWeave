import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type CalcModel, type SignalValue } from '../packages/model/src';
import { exportTypeScript, createExportManifest } from '../packages/codegen-ts/src';
import { PYTHON_TARGET, getPythonDiagnostics, createPythonExportManifest, exportPython } from '../packages/codegen-python/src';
import { createModelPackage, inspectModelPackage, acceptModelPackage } from '../packages/model-package/src';
import { inspectModelImport } from '../packages/interop/src';
import { M1_ENGINE_FIXTURES, M1_FAILURE_FIXTURES } from '../tests/m1-engine-fixtures';
import { M2_ENGINE_FIXTURES, m2Node, m2Model, m2Edge } from '../tests/m2-engine-fixtures';
import { m4Oracles, datasetRangeFailure } from './m4-oracles';
import { m5Oracles } from './m5-oracles';
import { decay } from './m3-oracles';

const directory = resolve('.test-generated/m7-target-parity');
await mkdir(directory, { recursive: true }); await mkdir('fixtures/m7', { recursive: true }); await mkdir('docs/evidence', { recursive: true });
const python = process.env.CALCWEAVE_PYTHON_PATH ?? 'python';
const pythonVersion = spawnSync(python, ['--version'], { encoding: 'utf8', windowsHide: true });
assert.equal(pythonVersion.status, 0, 'Python is required for actual target validation; no simulated fallback.');
const strictModes = new Set<string>(); let ordinal = 0;
type TargetResult = { samples: { time: number; values: Record<string, SignalValue> }[]; finalState: unknown; stateMemory?: unknown; status: string; steps: number };
type Outcome = { result?: TargetResult; error?: { diagnostics: { code: string; nodeId?: string; tick?: number; time?: number }[]; partialResult?: TargetResult }; manifest: Record<string, unknown> };

function compare(actual: unknown, expected: unknown, path: string, tolerance = 2e-12): number {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path); assert(Number.isFinite(actual), path);
    const error = Math.abs((actual as number) - expected);
    assert(error <= tolerance * Math.max(1, Math.abs(expected)), `${path}: ${actual} vs ${expected}`);
    return error;
  }
  if (Array.isArray(expected)) { assert(Array.isArray(actual), path); assert.equal(actual.length, expected.length, path); return expected.reduce((maximum, value, index) => Math.max(maximum, compare(actual[index], value, `${path}[${index}]`, tolerance)), 0); }
  if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), path);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    return Object.entries(expected).reduce((maximum, [key, value]) => Math.max(maximum, compare((actual as Record<string, unknown>)[key], value, `${path}.${key}`, tolerance)), 0);
  }
  assert.equal(actual, expected, path); return 0;
}
function contract(result: TargetResult): TargetResult { return { samples: result.samples, finalState: result.finalState, ...(result.stateMemory === undefined ? {} : { stateMemory: result.stateMemory }), status: result.status, steps: result.steps }; }
function diagnostics(error: Outcome['error']) { return error?.diagnostics.map(item => ({ code: item.code, ...(item.nodeId === undefined ? {} : { nodeId: item.nodeId }), ...(item.tick === undefined ? {} : { tick: item.tick }), ...(item.time === undefined ? {} : { time: item.time }) })); }
async function targets(model: CalcModel): Promise<{ compiled: ReturnType<typeof compileModel>; js: Outcome; typescript: Outcome; python: Outcome }> {
  const compiled = compileModel(model), metadata = await createExportManifest(compiled), pythonManifest = createPythonExportManifest(compiled);
  assert.deepEqual(getPythonDiagnostics(compiled), []);
  assert.equal(pythonManifest.modelHash, metadata.modelHash);
  assert.deepEqual(pythonManifest.outputTypes, metadata.outputTypes);
  assert.deepEqual(pythonManifest.execution, metadata.execution);
  const prefix = String(ordinal++).padStart(4, '0'), source = exportTypeScript(compiled, metadata), tsFile = join(directory, `${prefix}.ts`), jsFile = join(directory, `${prefix}.mjs`), pyFile = join(directory, `${prefix}.py`);
  await writeFile(tsFile, source); await writeFile(pyFile, exportPython(compiled, pythonManifest));
  if (!strictModes.has(model.execution.mode)) {
    const program = ts.createProgram([tsFile], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, lib: ['lib.es2022.d.ts'], types: [], noEmit: true });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
    strictModes.add(model.execution.mode);
  }
  await writeFile(jsFile, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const generated = await import(/* @vite-ignore */ pathToFileURL(jsFile).href);
  let js: Outcome, typescript: Outcome;
  try { js = { manifest: metadata as unknown as Record<string, unknown>, result: await runModel(compiled) }; }
  catch (error) { assert(error instanceof ModelError); js = { manifest: metadata as unknown as Record<string, unknown>, error: { diagnostics: error.diagnostics, ...(error.partialResult ? { partialResult: error.partialResult } : {}) } }; }
  try { typescript = { manifest: generated.getManifest(), result: generated.run() }; }
  catch (error) { const failure = error as NonNullable<Outcome['error']>; assert(Array.isArray(failure.diagnostics)); typescript = { manifest: generated.getManifest(), error: failure }; }
  const processResult = spawnSync(python, ['-I', '-B', pyFile], { encoding: 'utf8', windowsHide: true, timeout: 35_000, maxBuffer: 16 * 1024 * 1024 });
  assert(!processResult.error, String(processResult.error)); assert([0, 1].includes(processResult.status ?? -1), processResult.stderr);
  const pythonOutcome = JSON.parse(processResult.stdout) as Outcome;
  assert.equal(processResult.status, pythonOutcome.error ? 1 : 0); compare(pythonOutcome.manifest, pythonManifest, 'manifest', 0);
  assert.equal(pythonOutcome.error === undefined, js.error === undefined, model.name);
  if (js.result) { assert.deepEqual(typescript.result!.samples.map(sample => sample.time), js.result.samples.map(sample => sample.time)); assert.deepEqual(pythonOutcome.result!.samples.map(sample => sample.time), js.result.samples.map(sample => sample.time)); compare(contract(typescript.result!), contract(js.result), 'TS result'); compare(contract(pythonOutcome.result!), contract(js.result), 'Python result'); }
  else { assert.deepEqual(diagnostics(typescript.error), diagnostics(js.error)); assert.deepEqual(diagnostics(pythonOutcome.error), diagnostics(js.error)); if (js.error?.partialResult) { compare(contract(typescript.error!.partialResult!), contract(js.error.partialResult), 'TS partial'); compare(contract(pythonOutcome.error!.partialResult!), contract(js.error.partialResult), 'Python partial'); } }
  return { compiled, js, typescript, python: pythonOutcome };
}

const evidence: Record<string, unknown>[] = [];
for (const fixture of M1_ENGINE_FIXTURES) {
  const result = await targets(fixture.model); assert(result.python.result);
  const maximumAbsoluteError = compare(result.python.result.samples[0]!.values, fixture.expected, fixture.name);
  evidence.push({ group: 'M1 independent typed/math oracle', name: fixture.name, mode: fixture.model.execution.mode, samples: 1, maximumAbsoluteError, modelHash: result.python.manifest.modelHash });
}
for (const fixture of M2_ENGINE_FIXTURES) {
  const result = await targets(fixture.model); assert(result.python.result);
  const maximumAbsoluteError = compare(result.python.result.samples.map(sample => sample.values.result), fixture.expected, fixture.name);
  evidence.push({ group: 'M2 independent time/state oracle', name: fixture.name, mode: fixture.model.execution.mode, samples: result.python.result.samples.length, maximumAbsoluteError, modelHash: result.python.manifest.modelHash });
}
const m4Rejected: { id: string; diagnostics: unknown }[] = [];
for (const oracle of m4Oracles()) {
  const compiled = compileModel(oracle.model), rejection = getPythonDiagnostics(compiled);
  if (rejection.length) { m4Rejected.push({ id: oracle.id, diagnostics: rejection }); continue; }
  const result = await targets(oracle.model); assert(result.python.result);
  let maximumAbsoluteError = 0;
  for (const [index, sample] of result.python.result.samples.entries()) for (const [output, expected] of Object.entries(oracle.expected)) maximumAbsoluteError = Math.max(maximumAbsoluteError, compare(sample.values[output], expected(sample.time, index), `${oracle.id}/${output}/${index}`, oracle.tolerance));
  if (oracle.expectedFinalState) compare(result.python.result.finalState, oracle.expectedFinalState, oracle.id, oracle.tolerance);
  evidence.push({ group: 'M4 independent data/unit/bus/hierarchy oracle', name: oracle.id, reference: oracle.reference, mode: oracle.model.execution.mode, samples: result.python.result.samples.length, maximumAbsoluteError, tolerance: oracle.tolerance, modelHash: result.python.manifest.modelHash });
}
const failures: Record<string, unknown>[] = [];
for (const failure of M1_FAILURE_FIXTURES) {
  const result = await targets(failure.fixture.model); assert(result.python.error);
  assert.equal(result.python.error.diagnostics[0]?.code, failure.code);
  failures.push({ name: failure.fixture.name, diagnostics: diagnostics(result.python.error), partialSamples: result.python.error.partialResult?.samples.length ?? 0 });
}
const delayedFailure = m2Model([m2Node('ramp', 'source.ramp', { startTime: 0, slope: 1, initial: 0 }), m2Node('delay', 'discrete.unit-delay', { initial: 0 }), m2Node('formula', 'math.expression', { expression: '1/(2-x)' }), m2Node('result', 'sink.scope')], [m2Edge('ramp', 'delay'), m2Edge('delay', 'formula'), m2Edge('formula', 'result')], 5);
const dataFailure = datasetRangeFailure(); dataFailure.execution = { mode: 'discrete', startTime: 0.2, stopTime: 1, step: 0.1 };
for (const model of [delayedFailure, dataFailure]) {
  const result = await targets(model); assert(result.python.error); assert((result.python.error.partialResult?.samples.length ?? 0) > 0);
  failures.push({ name: model.name, diagnostics: diagnostics(result.python.error), partialSamples: result.python.error.partialResult!.samples.length, finalState: result.python.error.partialResult!.finalState });
}
const rejections = [decay('rk4'), ...m5Oracles().map(oracle => oracle.model)];
for (const model of rejections) { const compiled = compileModel(model), reasons = getPythonDiagnostics(compiled); assert(reasons.length > 0); assert(reasons.some(reason => reason.nodeId)); assert.throws(() => exportPython(compiled), ModelError); }

const portable = parseModelJson(serializeModel(M2_ENGINE_FIXTURES[0]!.model));
const signed = await createModelPackage(portable), inspected = await inspectModelPackage(signed.text);
assert(inspected.executable); assert.equal(inspected.fingerprint, signed.fingerprint);
assert.deepEqual(await acceptModelPackage(signed.text, signed.fingerprint), portable);
await assert.rejects(acceptModelPackage(signed.text, '0'.repeat(64)), ModelError);
const tampered = JSON.parse(signed.text); tampered.model.name = 'changed'; await assert.rejects(inspectModelPackage(JSON.stringify(tampered)), ModelError);
const permission = JSON.parse(signed.text); permission.permissions.push('network'); await assert.rejects(inspectModelPackage(JSON.stringify(permission)), ModelError);
const native = inspectModelImport(serializeModel(portable)); assert(native.parsed && native.executable && native.model && !native.converted);
const foreign = inspectModelImport('{"format":"simulink","blocks":[]}'); assert(foreign.parsed && !foreign.converted && !foreign.executable && !foreign.model);

await writeFile('fixtures/m7/F07-python-step.cw.json', serializeModel(portable) + '\n');
await writeFile('fixtures/m7/F07-python-step.expected.json', JSON.stringify({ reference: 'Step at absolute time 2: [-1,-1,3,3,3,3]', values: M2_ENGINE_FIXTURES[0]!.expected, targetVersion: PYTHON_TARGET.id }, null, 2) + '\n');
const datasetBytes = await readFile('dataset/Simulink_Basic_Blocks_R2024b.md');
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, python: pythonVersion.stdout.trim() || pythonVersion.stderr.trim(), target: PYTHON_TARGET, strictTypeScriptModes: [...strictModes], evidence, failures, rejectedTargets: rejections.length, m4Unsupported: m4Rejected, packageChecks: ['signature and hash', 'independently trusted fingerprint', 'wrong trust rejected', 'tamper rejected', 'additional permission rejected'], importChecks: { native: { parsed: native.parsed, converted: native.converted, executable: native.executable }, foreign: { parsed: foreign.parsed, converted: foreign.converted, executable: foreign.executable } }, datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'), methodology: 'Actual isolated Python processes, actual strict ES2022-only generated TypeScript ESM and shared JS runtime. Typed/static/time-state/data-unit-bus-hierarchy hand oracles verify every sample; diagnostics and completed partial-state contracts compared. Cross-target floating arithmetic uses 2e-12 relative-scaled tolerance except each M4 independent oracle tolerance; boolean/string/shape/key sets exact. Actual browser downloads have separate E2E evidence. Python wall deadlines are not asserted to occur at identical host times.', publicDeploymentClaimed: false };
await writeFile(`docs/evidence/${ENGINE_VERSION.endsWith('-m7') ? 'm7-verification' : `m7-regression-on-${ENGINE_VERSION.split('-').at(-1)}`}.json`, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ fixtures: evidence.length, failures: failures.length, rejectedTargets: rejections.length, python: report.python, packageChecks: report.packageChecks.length, importChecks: report.importChecks }) + '\n');
