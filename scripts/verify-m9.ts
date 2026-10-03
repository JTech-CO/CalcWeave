import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { M9_BLOCK_IDS, M9_BLOCK_PRESETS } from '../packages/block-library/src/m9';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { getPythonDiagnostics } from '../packages/codegen-python/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type CalcModel, type RunResult, type SignalValue, type StateValue } from '../packages/model/src';
import { M9_FIXTURES, M9_FAILURE_FIXTURES, M9_PRESET_FIXTURES } from '../tests/m9-fixtures';

const stage = ENGINE_VERSION.split('-').at(-1)!;
const evidenceName = stage === 'm9' ? 'm9-verification' : `m9-regression-on-${stage}`;
const directory = resolve(`.test-generated/${evidenceName}`);
await mkdir(directory, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
assert.equal(process.argv.length, 2, 'Use no arguments');
assert.equal(new Set(M9_BLOCK_IDS).size, M9_BLOCK_IDS.length);
const predecessor = JSON.parse(await readFile('docs/baselines/m8-registry.json', 'utf8')) as typeof blockRegistry;
assert.equal(predecessor.length, 185);
assert.equal(blockRegistry.length, predecessor.length + M9_BLOCK_IDS.length);
for (const definition of predecessor) assert.deepEqual(blockRegistry.find(block => block.id === definition.id), definition, `${definition.id}: predecessor contract changed`);
assert.deepEqual([...new Set(M9_FIXTURES.flatMap(entry => entry.model.nodes.map(node => node.blockType)).filter(id => (M9_BLOCK_IDS as readonly string[]).includes(id)))].sort(), [...M9_BLOCK_IDS].sort(), 'Every M9 definition needs an independent raw oracle');
assert.deepEqual([...new Set(M9_PRESET_FIXTURES.map(entry => entry.presetId))].sort(), M9_BLOCK_PRESETS.map(entry => entry.id).sort(), 'Every M9 preset needs an independent raw oracle');
const tolerance = 3e-12, strictModes = new Set<string>();
let ordinal = 0, checkedSamples = 0, maximumScaledError = 0;
function equal(actual: unknown, expected: unknown, path: string): number {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path); assert(Number.isFinite(actual), path);
    if (expected !== 0 && Math.abs(expected) < 2 ** -1022) assert(Object.is(actual, expected), `${path}: exact subnormal oracle`);
    const error = Math.abs((actual as number) - expected), scale = error / Math.max(1, Math.abs(expected));
    maximumScaledError = Math.max(maximumScaledError, scale); assert(scale <= tolerance, `${path}: ${actual} vs ${expected}`); return error;
  }
  if (Array.isArray(expected)) { assert(Array.isArray(actual), path); assert.equal(actual.length, expected.length, path); return expected.reduce((max, value, i) => Math.max(max, equal(actual[i], value, `${path}[${i}]`)), 0); }
  if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), path); assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    return Object.entries(expected).reduce((max, [key, value]) => Math.max(max, equal((actual as Record<string, unknown>)[key], value, `${path}.${key}`)), 0);
  }
  assert.equal(actual, expected, path); return 0;
}
function stable(result: RunResult) { const { elapsedMs: _elapsed, resources: _resources, ...contract } = result; return contract; }
function selectedMemory(actual: unknown, expected: unknown, path: string): unknown {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), path);
    return Object.fromEntries(Object.entries(expected).map(([key, value]) => {
      assert(Object.hasOwn(actual, key), `${path}.${key}: missing memory field`);
      return [key, selectedMemory((actual as Record<string, unknown>)[key], value, `${path}.${key}`)];
    }));
  }
  return actual;
}
async function program(model: CalcModel) {
  const compiled = compileModel(model), manifest = await createExportManifest(compiled), source = exportTypeScript(compiled, manifest), prefix = String(ordinal++).padStart(4, '0');
  const tsPath = join(directory, `${prefix}.ts`), jsPath = join(directory, `${prefix}.mjs`); await writeFile(tsPath, source);
  if (!strictModes.has(model.execution.mode)) {
    const checked = ts.createProgram([tsPath], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, lib: ['lib.es2022.d.ts'], types: [], noEmit: true });
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
    strictModes.add(model.execution.mode);
  }
  await writeFile(jsPath, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const generated = await import(/* @vite-ignore */ pathToFileURL(jsPath).href); assert.deepEqual(generated.getManifest(), manifest);
  return { compiled, manifest, generated };
}
type Oracle = { name: string; model: CalcModel; expected: Record<string, SignalValue[]>; expectedMemory?: Record<string, StateValue>; presetId?: string };
async function verify(entry: Oracle) {
  maximumScaledError = 0;
  const { compiled, manifest, generated } = await program(entry.model), result = await runModel(compiled);
  assert.equal(result.status, 'completed'); assert.equal(manifest.targetVersion, 'typescript-m9-v1');
  assert.deepEqual(Object.keys(entry.expected).sort(), [...compiled.outputIds].sort(), `${entry.name}: oracle output coverage`);
  let maximumAbsoluteError = 0;
  for (const [id, series] of Object.entries(entry.expected)) {
    assert.equal(result.samples.length, series.length, `${entry.name}/${id}: oracle sample count`);
    result.samples.forEach((sample, i) => { maximumAbsoluteError = Math.max(maximumAbsoluteError, equal(sample.values[id], series[i], `${entry.name}/${id}@${sample.time}`)); });
  }
  checkedSamples += result.samples.length;
  if (entry.expectedMemory !== undefined) equal(selectedMemory(result.stateMemory, entry.expectedMemory, entry.name), entry.expectedMemory, `${entry.name}/independent selected final memory`);
  equal(generated.run(), stable(result), `${entry.name}/actual standalone TypeScript`);
  assert.deepEqual(stable(await runModel(compileModel(parseModelJson(serializeModel(entry.model))))), stable(result));
  const reversed = structuredClone(entry.model); reversed.nodes.reverse(); reversed.edges.reverse(); assert.deepEqual(stable(await runModel(compileModel(reversed))), stable(result));
  const newNodes = compiled.nodes.filter(node => (M9_BLOCK_IDS as readonly string[]).includes(node.blockType));
  const pythonDiagnostics = getPythonDiagnostics(compiled); assert(newNodes.length > 0);
  for (const node of newNodes) assert(pythonDiagnostics.some(item => item.nodeId === node.id), `${entry.name}/${node.id}: unsupported Python node must be identified`);
  const parameters = Object.fromEntries(newNodes.map(node => [node.id, { blockType: node.blockType, parameters: node.parameters, sampleTime: node.sampleTime }]));
  return { id: entry.name, ...(entry.presetId ? { presetId: entry.presetId } : {}), mode: entry.model.execution.mode, blockIds: [...new Set(newNodes.map(node => node.blockType))], parameters, samples: result.samples.length, maximumAbsoluteError, maximumScaledError, tolerance, exactSubnormalOracles: true, independentOracle: true, independentMemoryOracle: entry.expectedMemory !== undefined, modelHash: manifest.modelHash, targetVersion: manifest.targetVersion, actualStandaloneTypeScript: true, finalStateAndMemoryParity: true, jsonRoundtrip: true, insertionOrderIndependent: true, pythonUnsupportedNodeDiagnostics: true };
}
const fixtures = []; for (const entry of M9_FIXTURES) fixtures.push(await verify(entry));
const presetEvidence = []; for (const entry of M9_PRESET_FIXTURES) presetEvidence.push(await verify(entry));
const failures = [];
for (const entry of M9_FAILURE_FIXTURES) {
  const { compiled, manifest, generated } = await program(entry.model); let failure: ModelError | undefined;
  try { await runModel(compiled); } catch (error) { assert(error instanceof ModelError); failure = error; }
  assert(failure, `${entry.name}: expected runtime failure`); assert.equal(failure.diagnostics[0]?.code, entry.code);
  if (entry.nodeId !== undefined) assert.equal(failure.diagnostics[0]?.nodeId, entry.nodeId);
  if (entry.tick !== undefined) assert.equal(failure.diagnostics[0]?.tick, entry.tick);
  if (entry.time !== undefined) assert.equal(failure.diagnostics[0]?.time, entry.time);
  try { generated.run(); assert.fail('Standalone program must fail'); } catch (error) {
    const actual = error as ModelError; assert.deepEqual(actual.diagnostics, failure.diagnostics);
    if (failure.partialResult) { assert(actual.partialResult); equal(actual.partialResult, stable(failure.partialResult), `${entry.name}/partial state rollback parity`); }
  }
  failures.push({ id: entry.name, modelHash: manifest.modelHash, diagnostics: failure.diagnostics, ...(failure.partialResult ? { partialSamples: failure.partialResult.samples.length } : {}), actualStandaloneFailureParity: true, partialStateAndMemoryParity: !!failure.partialResult });
}
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, registryCount: blockRegistry.length, predecessorDefinitions: predecessor.length, newDefinitions: M9_BLOCK_IDS.length, presets: M9_BLOCK_PRESETS.length, datasetSha256: createHash('sha256').update(await readFile('dataset/Simulink_Basic_Blocks_R2024b.md')).digest('hex'), strictTypeScriptModes: [...strictModes], checkedSamples, actualGeneratedPrograms: ordinal, fixtures, presetEvidence, failures, methodology: 'Independent raw sample-series oracles and selected literal final-memory oracles. JSON roundtrip, reversed insertion order, actual standalone TypeScript, exact manifest and full finalState/stateMemory parity. Failure diagnostics and partial-state rollback compared with generated programs. All 185 predecessor definition objects preserved. Python remains its approved subset; M9 nodes explicitly rejected. No MathWorks seed sequence or full-option equivalence claimed.', fullSimulinkEquivalenceClaimed: false };
await writeFile(`docs/evidence/${evidenceName}.json`, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ fixtures: fixtures.length, presetFixtures: presetEvidence.length, failureFixtures: failures.length, checkedSamples, actualGeneratedPrograms: ordinal, newDefinitions: M9_BLOCK_IDS.length, registryCount: blockRegistry.length, strictTypeScriptModes: [...strictModes] }) + '\n');
