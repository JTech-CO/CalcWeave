import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { M8_BLOCK_IDS, M8_BLOCK_PRESETS } from '../packages/block-library/src/m8';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { getPythonDiagnostics, PYTHON_M7_TARGET } from '../packages/codegen-python/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type CalcModel, type RunResult } from '../packages/model/src';
import { M8_FIXTURES, m8Expected, m8Model, type M8Fixture } from '../tests/m8-fixtures';

const stage = ENGINE_VERSION.split('-').at(-1)!;
const evidenceName = stage === 'm8' ? 'm8-verification' : `m8-regression-on-${stage}`;
const directory = resolve(`.test-generated/${evidenceName}`);
await mkdir(directory, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
assert.deepEqual([...new Set(M8_FIXTURES.map(entry => entry.id))].sort(), [...M8_BLOCK_IDS].sort(), 'Every M8 definition needs an independent raw oracle');
assert.equal(new Set(M8_BLOCK_IDS).size, M8_BLOCK_IDS.length);
assert(M8_BLOCK_IDS.every(id => blockRegistry.some(block => block.id === id)));
const tolerance = 3e-12, strictModes = new Set<string>();
const presetOnly = process.argv.includes('--presets-only');
assert(process.argv.slice(2).every(arg => arg === '--presets-only'), 'Use no arguments or --presets-only');
let ordinal = 0, checkedSamples = 0, maximumScaledError = 0;
function equal(actual: unknown, expected: unknown, path: string): number {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path); assert(Number.isFinite(actual), path);
    if (expected !== 0 && Math.abs(expected) < 2 ** -1022) assert(Object.is(actual, expected), `${path}: subnormal oracle must match exactly`);
    const error = Math.abs((actual as number) - expected); maximumScaledError = Math.max(maximumScaledError, error / Math.max(1, Math.abs(expected))); assert(error <= tolerance * Math.max(1, Math.abs(expected)), `${path}: ${actual} vs ${expected}`); return error;
  }
  if (Array.isArray(expected)) { assert(Array.isArray(actual), path); assert.equal(actual.length, expected.length, path); return expected.reduce((max, value, i) => Math.max(max, equal(actual[i], value, `${path}[${i}]`)), 0); }
  if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), path); assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    return Object.entries(expected).reduce((max, [key, value]) => Math.max(max, equal((actual as Record<string, unknown>)[key], value, `${path}.${key}`)), 0);
  }
  assert.equal(actual, expected, path); return 0;
}
function stable(result: RunResult) { const { elapsedMs: _elapsed, resources: _resources, ...contract } = result; return contract; }
async function program(model: CalcModel, strict: boolean) {
  const compiled = compileModel(model), manifest = await createExportManifest(compiled), source = exportTypeScript(compiled, manifest), prefix = String(ordinal++).padStart(4, '0');
  const tsPath = join(directory, `${prefix}.ts`), jsPath = join(directory, `${prefix}.mjs`); await writeFile(tsPath, source);
  if (strict) {
    const checked = ts.createProgram([tsPath], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, lib: ['lib.es2022.d.ts'], types: [], noEmit: true });
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
    strictModes.add(model.execution.mode);
  }
  await writeFile(jsPath, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const generated = await import(/* @vite-ignore */ pathToFileURL(jsPath).href); assert.deepEqual(generated.getManifest(), manifest);
  return { compiled, manifest, generated };
}
const fixtures: Record<string, unknown>[] = [];
for (const entry of presetOnly ? [] : M8_FIXTURES) {
  maximumScaledError = 0;
  const modes: Record<string, unknown> = {}; let maximumAbsoluteError = 0;
  for (const mode of ['static', 'discrete', 'continuous'] as const) {
    const model = m8Model(entry, mode), result = await runModel(compileModel(model)); assert.equal(result.status, 'completed');
    for (const sample of result.samples) { maximumAbsoluteError = Math.max(maximumAbsoluteError, equal(sample.values, m8Expected(entry), `${entry.name}/${mode}@${sample.time}`)); checkedSamples++; }
    assert.deepEqual(stable(await runModel(compileModel(parseModelJson(serializeModel(model))))), stable(result));
    const reversed = structuredClone(model); reversed.nodes.reverse(); reversed.edges.reverse(); assert.deepEqual(stable(await runModel(compileModel(reversed))), stable(result));
    const { generated, manifest, compiled } = await program(model, !strictModes.has(mode));
    equal(generated.run(), stable(result), `${entry.name}/${mode}/standalone TypeScript`); assert.equal(manifest.targetVersion, 'typescript-m8-v1');
    assert(getPythonDiagnostics(compiled, PYTHON_M7_TARGET).some(item => item.nodeId === 'operation'), 'M8 cards must identify unsupported Python nodes');
    modes[mode] = { samples: result.samples.length, modelHash: manifest.modelHash, targetVersion: manifest.targetVersion, actualStandaloneTypeScript: true, jsonRoundtrip: true, insertionOrderIndependent: true };
  }
  fixtures.push({ id: entry.name, blockIds: [entry.id], parameters: entry.parameters, maximumAbsoluteError, maximumScaledError, tolerance, exactSubnormalOracles: true, modes, independentOracle: true });
}
const presetEvidence: Record<string, unknown>[] = [];
const presetValues: Record<string, { input?: number[]; expected: unknown }> = {
  ground: { expected: 0 }, 'eulers-number': { expected: Math.E }, one: { expected: 1 },
  'compare-zero': { input: [-1, 0, 1], expected: [false, false, true] },
  increment: { input: [-1, 0, 3], expected: [0, 1, 4] }, decrement: { input: [-1, 0, 3], expected: [-2, -1, 2] },
  'decrement-to-zero': { input: [-1, 0, 3], expected: [0, 0, 2] }, 'square-root': { input: [1, 4, 16], expected: [1, 2, 4] },
};
for (const preset of M8_BLOCK_PRESETS) {
  const oracle = presetValues[preset.id]!; assert(oracle);
  for (const mode of ['static', 'discrete', 'continuous'] as const) {
    const entry = { name: `preset-${preset.id}`, id: preset.blockType, inputs: oracle.input ? { in: oracle.input } : {}, parameters: { ...preset.parameters }, expected: { out: oracle.expected } } as M8Fixture;
    const model = m8Model(entry, mode), { compiled, manifest, generated } = await program(model, !strictModes.has(mode)), result = await runModel(compiled);
    for (const sample of result.samples) { equal(sample.values, m8Expected(entry), `${entry.name}/${mode}`); checkedSamples++; }
    equal(generated.run(), stable(result), `${entry.name}/actual TypeScript`);
    presetEvidence.push({ id: preset.id, blockIds: [preset.blockType], parameters: preset.parameters, mode, samples: result.samples.length, modelHash: manifest.modelHash, targetVersion: manifest.targetVersion, actualStandaloneTypeScript: true, independentOracle: true });
  }
}
const failures: Record<string, unknown>[] = [];
const invalid: { id: string; change: (entry: M8Fixture) => void; code: string }[] = [
  { id: 'math.reciprocal-sqrt', change: entry => { entry.inputs.in = 0; }, code: 'NUMERIC_DIVIDE_BY_ZERO' },
  { id: 'nonlinear.dead-zone-dynamic', change: entry => { entry.inputs.lower = 5; entry.inputs.upper = 1; }, code: 'INVALID_DYNAMIC_BOUNDS' },
  { id: 'verify.assert', change: entry => { entry.inputs.in = false; }, code: 'VERIFY_VIOLATION' },
  { id: 'lookup.direct', change: entry => { entry.inputs.in = [99, 0, 0]; entry.parameters.outside = 'error'; }, code: 'NUMERIC_INDEX_RANGE' },
];
for (const test of presetOnly ? [] : invalid) {
  const entry = structuredClone(M8_FIXTURES.find(item => item.id === test.id)!); test.change(entry);
  const model = m8Model(entry), { compiled, generated } = await program(model, false);
  let failure: ModelError | undefined; try { await runModel(compiled); } catch (error) { assert(error instanceof ModelError); failure = error; }
  assert(failure, `${test.id} must fail`); assert.equal(failure.diagnostics[0]?.nodeId, 'operation'); assert.equal(failure.diagnostics[0]?.code, test.code);
  try { generated.run(); assert.fail('Generated failure must be diagnosed'); } catch (error) { assert.deepEqual((error as ModelError).diagnostics, failure.diagnostics); }
  failures.push({ id: test.id, diagnostics: failure.diagnostics, actualStandaloneFailureParity: true });
}
const report = { pythonDiagnosticTarget: PYTHON_M7_TARGET.id, generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, registryCount: blockRegistry.length, newDefinitions: M8_BLOCK_IDS.length, presets: M8_BLOCK_PRESETS.length, datasetSha256: createHash('sha256').update(await readFile('dataset/Simulink_Basic_Blocks_R2024b.md')).digest('hex'), strictTypeScriptModes: [...strictModes], checkedSamples, actualGeneratedPrograms: ordinal, fixtures, presetEvidence, failures, methodology: 'Literal independent scalar/vector/matrix/boolean outputs in every declared mode. Every raw sample, JSON roundtrip, reversed insertion order, manifests and executed standalone TypeScript compared. Strict import-free ES2022 compilation per mode; failure codes identify original nodes and match generated programs. No MathWorks execution or full-option equivalence claimed.', fullSimulinkEquivalenceClaimed: false };
await writeFile(`docs/evidence/${presetOnly ? 'm8-presets-verification' : evidenceName}.json`, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ fixtures: fixtures.length, failureFixtures: failures.length, checkedSamples, actualGeneratedPrograms: ordinal, newDefinitions: M8_BLOCK_IDS.length, registryCount: blockRegistry.length, strictTypeScriptModes: [...strictModes] }) + '\n');
