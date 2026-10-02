import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { EXPANSION_BLOCK_IDS } from '../packages/block-library/src/expansion';
import { EXPANDED_TIME_SOURCE_IDS } from '../packages/block-library/src/time-sources';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type RunResult } from '../packages/model/src';
import { boundaryOracles, continuousOracles, decay } from './m3-oracles';

function stable(result: RunResult) { const { elapsedMs: _elapsed, ...rest } = result; return rest; }
function equal(actual: unknown, expected: unknown, tolerance: number, path: string): void {
  if (typeof actual === 'number' && typeof expected === 'number') { assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${path}: ${actual} != ${expected}`); return; }
  if (Array.isArray(actual) && Array.isArray(expected)) { assert.equal(actual.length, expected.length, path); actual.forEach((value, i) => equal(value, expected[i], tolerance, `${path}[${i}]`)); return; }
  assert.deepEqual(actual, expected, path);
}
let strictTypecheck = false;
async function standalone(code: string) {
  assert(!/\beval\s*\(|new\s+Function|\bimport\s/.test(code), 'Standalone code must be import-free and contain no dynamic evaluation');
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-m3-'));
  const sourcePath = join(directory, 'model.ts'), modulePath = join(directory, 'model.mjs');
  try {
    if (!strictTypecheck) {
      await writeFile(sourcePath, code);
      const program = ts.createProgram([sourcePath], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true });
      const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
      assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], 'Strict independent ES2022 TypeScript'); strictTypecheck = true;
    }
    await writeFile(modulePath, ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    // Only our fixed generator output is loaded; model text never becomes code.
    return await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  } finally {
    await unlink(sourcePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await unlink(modulePath).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(directory);
  }
}

await mkdir('fixtures/m3', { recursive: true }); await mkdir('docs/evidence', { recursive: true });
const m4Additions = new Set(['source.dataset', 'unit.convert', 'route.bus-create', 'route.bus-select', 'hierarchy.subsystem', 'annotation.note', 'annotation.model-info', 'math.matrix-multiply', 'matrix.transpose', 'matrix.determinant', 'matrix.inverse', 'matrix.solve', 'matrix.cholesky', 'matrix.lu', 'lookup.2d', 'lookup.prelookup', 'fixed.quantize']);
const catalogAdditions: readonly string[] = [...EXPANSION_BLOCK_IDS, ...EXPANDED_TIME_SOURCE_IDS];
const m3Baseline = blockRegistry.filter(block => !catalogAdditions.includes(block.id) && !m4Additions.has(block.id));
assert.equal(m3Baseline.length, 57); assert.equal(m3Baseline.filter(b => b.supportedModes.includes('static')).length, 26);
const evidence = [];
for (const oracle of [...continuousOracles(), ...boundaryOracles()]) {
  const compiled = compileModel(oracle.model), result = await runModel(compiled); assert.equal(result.status, 'completed');
  let maximumAbsoluteError = 0;
  for (const [id, expected] of Object.entries(oracle.expected)) for (const [i, sample] of result.samples.entries()) {
    const target = expected(sample.time, i); equal(sample.values[id], target, oracle.tolerance, `${oracle.id}.${id}[${i}]`);
    if (typeof target === 'number') maximumAbsoluteError = Math.max(maximumAbsoluteError, Math.abs(Number(sample.values[id]) - target));
  }
  if (oracle.rejectionRequired) assert(result.solverStatistics!.rejectedSteps > 0, 'Stiff decay must reject its initial trial');
  if (oracle.expectedEvents) {
    assert.equal(result.events!.reduce((count, event) => count + event.nodeIds.length, 0), oracle.expectedEvents.length);
    for (const event of oracle.expectedEvents) {
      const actual = result.events!.filter(item => item.kind === event.kind && item.nodeIds.includes(event.nodeId)).sort((a,b) => Math.abs(a.time-event.time)-Math.abs(b.time-event.time))[0]; assert(actual, `${oracle.id}: missing event`);
      equal(actual.time, event.time, 3e-8, `${oracle.id}: event time`);
    }
  }
  const reopened = compileModel(parseModelJson(serializeModel(compiled.model))); assert.equal(reopened.semanticKey, compiled.semanticKey);
  const reordered = compileModel({ ...compiled.model, nodes: [...compiled.model.nodes].reverse(), edges: [...compiled.model.edges].reverse() });
  assert.deepEqual(stable(await runModel(reordered)), stable(result), `${oracle.id}: insertion order`);
  const manifest = await createExportManifest(compiled); assert.equal(manifest.modelHash, createHash('sha256').update(compiled.semanticKey).digest('hex'));
  const exported = await standalone(exportTypeScript(compiled, manifest)); const exportedResult = exported.run();
  assert.deepEqual(exportedResult, stable(result), `${oracle.id}: standalone parity`); assert.deepEqual(exported.getManifest(), manifest);
  // Returned arrays and nested solver settings own their storage.
  const changedManifest = exported.getManifest(); changedManifest.execution.solver.atol = 1;
  const firstSample = exportedResult.samples[0]; if (firstSample) firstSample.values[Object.keys(firstSample.values)[0]!] = 999;
  assert.deepEqual(exported.run(), stable(result)); assert.deepEqual(exported.getManifest(), manifest);
  if (ENGINE_VERSION.endsWith('-m3')) {
    await writeFile(`fixtures/m3/${oracle.id}.cw.json`, serializeModel(compiled.model) + '\n');
    await writeFile(`fixtures/m3/${oracle.id}.expected.json`, JSON.stringify({ reference: oracle.reference, absoluteTolerance: oracle.tolerance, result: stable(result), manifest }, null, 2) + '\n');
  }
  evidence.push({ id: oracle.id, reference: oracle.reference, nodes: compiled.nodes.length, samples: result.samples.length, maximumAbsoluteError, tolerance: oracle.tolerance,
    solverStatistics: result.solverStatistics, events: result.events, modelHash: manifest.modelHash, elapsedMs: result.elapsedMs, jsonRoundtrip: true, nodeOrderIndependent: true, independentTSParity: true, immutableResults: true, manifestParity: true });
}
const convergence: { h: number; error: number }[] = [];
for (const h of [0.2, 0.1, 0.05, 0.025]) {
  const result = await runModel(compileModel(decay('rk4', h)));
  const error = Math.abs(Number(result.samples.at(-1)!.values.result) - Math.exp(-1)); convergence.push({ h, error });
}
const observedOrders = convergence.slice(1).map((item, i) => Math.log2(convergence[i]!.error / item.error));
assert(observedOrders.every(order => order > 3.9 && order < 4.3), 'RK4 must exhibit fourth-order global convergence');
// Independent 20-term Taylor rotation, rather than a copy of RK stage code.
let cos = 1, sin = 0;
for (let i = 0; i < 100; i++) {
  let ch = 1, sh = 0.01, ct = 1, st = 0.01;
  for (let k = 1; k < 20; k++) { ct *= -0.0001 / ((2 * k - 1) * (2 * k)); st *= -0.0001 / ((2 * k) * (2 * k + 1)); ch += ct; sh += st; }
  [cos, sin] = [cos * ch - sin * sh, sin * ch + cos * sh];
}
assert(Math.abs(cos - Math.cos(1)) < 1e-14 && Math.abs(sin - Math.sin(1)) < 1e-14);
const oscillator = continuousOracles().find(fixture => fixture.id === 'F03-second-order-oscillator')!;
const oscillatorFinal = (await runModel(compileModel(oscillator.model))).samples.at(-1)!.values;
equal(oscillatorFinal.position, cos, 2e-9, 'Independent Taylor solver position'); equal(oscillatorFinal.velocity, -sin, 2e-9, 'Independent Taylor solver velocity');
const independentSolverError = Math.max(Math.abs(Number(oscillatorFinal.position)-cos), Math.abs(Number(oscillatorFinal.velocity)+sin));
const failures = [];
for (const [id, overrides, expectedCode] of [
  ['evaluation', { maxEvaluations: 1 }, 'RUNTIME_EVALUATION_BUDGET'],
  ['steps', { maxSteps: 1 }, 'RUNTIME_INTERNAL_STEP_BUDGET'],
  ['reject', { maxRejects: 0 }, 'RUNTIME_REJECTION_BUDGET'],
  ['minimum', { minStep: 0.2, initialStep: 0.2, maxStep: 0.2 }, 'RUNTIME_MIN_STEP'],
] as const) {
  const model = decay('rk45', 0.2, 20); model.execution.solver = { ...model.execution.solver, ...overrides }; const compiled = compileModel(model);
  let runtimeError: ModelError | undefined; try { await runModel(compiled); } catch (error) { assert(error instanceof ModelError); runtimeError = error; }
  assert(runtimeError && runtimeError.diagnostics[0]!.code === expectedCode, `${id}: expected controlled failure`);
  assert(runtimeError.partialResult?.status === 'failed' && runtimeError.partialResult.samples.length >= 1);
  const exported = await standalone(exportTypeScript(compiled)); let exportError: { diagnostics: unknown; partialResult: RunResult } | undefined;
  try { exported.run(); } catch (error) { exportError = error as typeof exportError; }
  assert(exportError); assert.deepEqual(exportError.diagnostics, runtimeError.diagnostics); assert.deepEqual(stable(exportError.partialResult), stable(runtimeError.partialResult));
  failures.push({ id, code: expectedCode, lastValidSamples: runtimeError.partialResult.samples.length, diagnosticParity: true, partialResultParity: true });
}
const datasetDigest = createHash('sha256').update(await readFile('dataset/Simulink_Basic_Blocks_R2024b.md')).digest('hex');
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  registry: { total: blockRegistry.length, static: blockRegistry.filter(b => b.supportedModes.includes('static')).length, m3StaticBaseline: 26, m3RegistryBaseline: 57, continuous: blockRegistry.filter(b => b.supportedModes.includes('continuous')).length }, datasetSha256: datasetDigest,
  methodology: 'Independent analytical integrals, exponentials, oscillator/matrix-exponential and accepted-memory timelines. Every output sample compared to specified absolute tolerance; RK4 halving convergence; independent 20-term Taylor rotation reference. JSON roundtrip, reversed node/edge order, strict ES2022-only import-free TypeScript execution and SHA-256 manifest, failure diagnostics/partial-result parity. Timing is a single observation, not a performance guarantee.',
  strictIndependentTypecheck: strictTypecheck, fixtures: evidence, convergence: { samples: convergence, observedOrders }, independentTaylorOscillator: { cos, sin, maximumEngineAbsoluteError: independentSolverError, tolerance: 2e-9 }, failures };
await writeFile(ENGINE_VERSION.endsWith('-m3') ? 'docs/evidence/m3-verification.json' : `docs/evidence/m3-regression-on-${ENGINE_VERSION.split('-').at(-1)}.json`, JSON.stringify(report, null, 2) + '\n'); process.stdout.write(JSON.stringify(report, null, 2) + '\n');
