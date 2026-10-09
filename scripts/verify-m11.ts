import assert from 'node:assert/strict';
import { registryWithoutApprovedObserverInputs } from './m16-support-source';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { M11_BLOCK_IDS } from '../packages/block-library/src/m11';
import { compileModel } from '../packages/compiler/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { getPythonDiagnostics, PYTHON_M7_TARGET } from '../packages/codegen-python/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type CalcModel, type RunResult, type TypedSignal } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { M11_INDEPENDENT_DEFINITION_FIXTURES, M11_INDEPENDENT_BOUNDARY_FIXTURES, M11_INDEPENDENT_FAILURE_FIXTURES, type M11IndependentFixture } from '../tests/m11-independent-fixtures';

assert.equal(process.argv.length, 2, 'Use no arguments');
const stage = ENGINE_VERSION.split('-').at(-1)!;
const evidenceName = stage === 'm11' ? 'm11-verification' : `m11-regression-on-${stage}`;
const directory = resolve(`.test-generated/${evidenceName}`);
await mkdir(directory, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
const predecessor = JSON.parse(await readFile('docs/baselines/m10-registry.json', 'utf8')) as typeof blockRegistry;
assert.equal(predecessor.length, 245);
assert.equal(new Set(M11_BLOCK_IDS).size, M11_BLOCK_IDS.length);
assert(blockRegistry.length >= predecessor.length + M11_BLOCK_IDS.length);
const historicalRegistry = registryWithoutApprovedObserverInputs(blockRegistry);
for (const definition of predecessor) assert.deepEqual(historicalRegistry.find(block => block.id === definition.id), definition, `${definition.id}: historical predecessor changed beyond two approved observer inputCount declarations`);
assert.deepEqual([...new Set(M11_INDEPENDENT_DEFINITION_FIXTURES.flatMap(entry => entry.model.nodes.map(node => node.blockType)).filter(id => (M11_BLOCK_IDS as readonly string[]).includes(id)))].sort(), [...M11_BLOCK_IDS].sort(), 'Each M11 definition needs a literal raw execution oracle');

const tolerance = 3e-12;
const strictModes = new Set<string>();
let ordinal = 0, checkedSamples = 0, strictPrograms = 0, exactTypedCells = 0, maximumScaledError = 0;
function compare(actual: unknown, expected: unknown, path: string, exactNumber = false): number {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path); assert(Number.isFinite(actual), `${path}: unexpected nonfinite number`);
    if (exactNumber || expected === 0 || Math.abs(expected) < 2 ** -1022) { assert(Object.is(actual, expected), `${path}: exact binary32/zero/subnormal value differs`); return 0; }
    const difference = Math.abs((actual as number) - expected), scaled = difference / Math.max(1, Math.abs(expected));
    maximumScaledError = Math.max(maximumScaledError, scaled); assert(scaled <= tolerance, `${path}: ${actual} vs ${expected}`); return difference;
  }
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), `${path}: expected array`); assert.equal(actual.length, expected.length, `${path}: array length`);
    return expected.reduce((maximum, value, index) => Math.max(maximum, compare(actual[index], value, `${path}[${index}]`, exactNumber)), 0);
  }
  if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), `${path}: expected object`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: object fields`);
    const expectedRecord = expected as Record<string, unknown>, actualRecord = actual as Record<string, unknown>;
    if (expectedRecord.kind === 'typed') {
      const typed = expected as TypedSignal;
      const { data: expectedData, ...expectedMetadata } = typed, { data: actualData, ...actualMetadata } = actualRecord;
      assert.deepEqual(actualMetadata, expectedMetadata, `${path}: exact typed dtype/shape/scaling/enum metadata`);
      assert(Array.isArray(actualData), `${path}: typed flat data`); assert.equal(actualData.length, expectedData.length, `${path}: typed cell count`);
      exactTypedCells += typed.dtype !== 'float64' && typed.dtype !== 'complex128' ? expectedData.length : expectedData.filter(cell => typeof cell === 'string').length;
      return expectedData.reduce<number>((maximum, cell, index) => Math.max(maximum, compare(actualData[index], cell, `${path}.data[${index}]`, typed.dtype !== 'float64' && typed.dtype !== 'complex128')), 0);
    }
    return Object.entries(expectedRecord).reduce((maximum, [key, value]) => Math.max(maximum, compare(actualRecord[key], value, `${path}.${key}`, exactNumber)), 0);
  }
  assert.equal(actual, expected, `${path}: exact tag/string/boolean differs`); return 0;
}
function stable(result: RunResult): Omit<RunResult, 'elapsedMs' | 'resources'> { const { elapsedMs: _elapsed, resources: _resources, ...contract } = result; return contract; }
function sampleTimes(model: CalcModel): number[] {
  const settings = model.execution, intervals = settings.mode === 'static' ? 0 : Math.round((settings.stopTime - settings.startTime) / settings.step);
  return Array.from({ length: intervals + 1 }, (_, tick) => settings.startTime + tick * settings.step);
}
async function program(model: CalcModel) {
  const compiled = compileModel(model), manifest = await createExportManifest(compiled), source = exportTypeScript(compiled, manifest), prefix = String(ordinal++).padStart(4, '0');
  const tsPath = join(directory, `${prefix}.ts`), jsPath = join(directory, `${prefix}.mjs`); await writeFile(tsPath, source);
  const syntax = ts.createSourceFile(tsPath, source, ts.ScriptTarget.ES2022, true);
  assert(!syntax.statements.some(statement => ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)), 'Generated execution must have no imports');
  const individuallyStrictChecked = !strictModes.has(model.execution.mode);
  if (individuallyStrictChecked) {
    const checked = ts.createProgram([tsPath], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, lib: ['lib.es2022.d.ts'], types: [], noEmit: true });
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `${model.modelId}: actual standalone strict TypeScript errors`);
    strictPrograms += 1; strictModes.add(model.execution.mode);
  }
  const transpiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  assert.deepEqual((transpiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `${model.modelId}: standalone syntax/transpile errors`);
  await writeFile(jsPath, transpiled.outputText);
  const generated = await import(/* @vite-ignore */ pathToFileURL(jsPath).href); assert.equal(typeof generated.run, 'function'); assert.deepEqual(generated.getManifest(), manifest);
  return { compiled, manifest, generated, individuallyStrictChecked };
}
async function verify(entry: M11IndependentFixture) {
  maximumScaledError = 0;
  const before = JSON.stringify(entry.model), { compiled, manifest, generated, individuallyStrictChecked } = await program(entry.model), result = await runModel(compiled);
  assert.equal(JSON.stringify(entry.model), before, `${entry.name}: source mutation`); assert.equal(result.status, 'completed'); assert.equal(manifest.targetVersion, 'typescript-m11-v1');
  assert.deepEqual(Object.keys(entry.expected).sort(), [...compiled.outputIds].sort(), `${entry.name}: complete oracle output coverage`);
  assert.deepEqual(result.samples.map(sample => sample.time), sampleTimes(entry.model), `${entry.name}: exact output time grid`);
  assert.equal(result.steps, result.samples.length, `${entry.name}: steps count`);
  let maximumAbsoluteError = 0;
  for (const [id, expectedSeries] of Object.entries(entry.expected)) {
    assert.equal(result.samples.length, expectedSeries.length, `${entry.name}/${id}: full oracle sample count`);
    result.samples.forEach((sample, index) => { maximumAbsoluteError = Math.max(maximumAbsoluteError, compare(sample.values[id], expectedSeries[index], `${entry.name}/${id}@${sample.time}`)); });
  }
  checkedSamples += result.samples.length;
  if (entry.expectedFinalState !== undefined) compare(result.finalState, entry.expectedFinalState, `${entry.name}/literal full finalState`);
  if (entry.expectedStateMemory !== undefined) compare(result.stateMemory, entry.expectedStateMemory, `${entry.name}/literal full stateMemory`);
  compare(generated.run(), stable(result), `${entry.name}/actual standalone TypeScript full contract`);
  const roundtrip = compileModel(parseModelJson(serializeModel(entry.model))); assert.equal(roundtrip.semanticKey, compiled.semanticKey); compare(stable(await runModel(roundtrip)), stable(result), `${entry.name}/JSON full contract`);
  const reversed = structuredClone(entry.model); reversed.nodes.reverse(); reversed.edges.reverse(); const reordered = compileModel(reversed); assert.equal(reordered.semanticKey, compiled.semanticKey); compare(stable(await runModel(reordered)), stable(result), `${entry.name}/reversed insertion full contract`);
  const newNodes = compiled.nodes.filter(node => (M11_BLOCK_IDS as readonly string[]).includes(node.blockType)); assert(newNodes.length > 0);
  const pythonDiagnostics = getPythonDiagnostics(compiled, PYTHON_M7_TARGET); for (const node of newNodes) assert(pythonDiagnostics.some(diagnostic => diagnostic.nodeId === node.id), `${entry.name}/${node.id}: unsupported Python original node diagnostic`);
  return { id: entry.name, ...(entry.presetId ? { presetId: entry.presetId } : {}), ...(entry.sourceIds ? { sourceIds: entry.sourceIds } : {}), mode: entry.model.execution.mode,
    blockIds: [...new Set(newNodes.map(node => node.blockType))], parameters: Object.fromEntries(newNodes.map(node => [node.id, { blockType: node.blockType, parameters: node.parameters, sampleTime: node.sampleTime }])),
    samples: result.samples.length, maximumAbsoluteError, maximumScaledError, float64Tolerance: tolerance, typedMetadataTagsAndStringsExact: true, float32BitTrueExact: true, exactZerosAndSubnormals: true,
    independentLiteralOracle: true, independentFullFinalStateOracle: entry.expectedFinalState !== undefined, independentFullStateMemoryOracle: entry.expectedStateMemory !== undefined,
    modelHash: manifest.modelHash, targetVersion: manifest.targetVersion, strictStandaloneTemplateModeVerified: true, strictProgramIndividuallyChecked: individuallyStrictChecked, importFreeStandalone: true, actualStandaloneTypeScript: true,
    fullSamplesFinalStateMemoryParity: true, exactManifest: true, jsonRoundtrip: true, insertionOrderIndependent: true, pythonUnsupportedNodeDiagnostics: true };
}

const fixtures = [];
for (const original of [...M11_INDEPENDENT_DEFINITION_FIXTURES, ...M11_INDEPENDENT_BOUNDARY_FIXTURES]) for (const mode of original.declaredModes) {
  const model = structuredClone(original.model); model.execution.mode = mode;
  if (mode === 'continuous') model.execution.solver = { method: 'rk4', discreteStep: model.execution.step, initialStep: model.execution.step, maxStep: model.execution.step };
  const expected = mode === 'static' ? Object.fromEntries(Object.entries(original.expected).map(([id,values])=>[id,[values[0]!]])) : original.expected;
  if (mode === 'static') model.execution.stopTime = model.execution.startTime;
  fixtures.push(await verify({ ...original, model, expected, ...(mode === 'static' ? {expectedFinalState:undefined,expectedStateMemory:undefined} : {}) }));
}
const sourceFixture = M11_INDEPENDENT_DEFINITION_FIXTURES.find(x=>x.model.nodes.some(n=>n.id==='Operation' && n.blockType==='source.signal'))!;
const staticModel = structuredClone(sourceFixture.model); staticModel.execution.mode='static'; staticModel.execution.stopTime=staticModel.execution.startTime;
fixtures.push(await verify({ ...sourceFixture, name:sourceFixture.name+'-static', model:staticModel, expected:Object.fromEntries(Object.entries(sourceFixture.expected).map(([key,values])=>[key,[values[0]!]])), expectedFinalState:undefined, expectedStateMemory:undefined }));

const failures = [];
for (const entry of M11_INDEPENDENT_FAILURE_FIXTURES) {
  if (entry.phase === 'compile') { assert.throws(()=>compileModel(entry.model),(error:unknown)=>error instanceof ModelError && error.diagnostics[0]?.code===entry.code); failures.push({ name:entry.name,phase:'compile',diagnosticCode:entry.code,actualTypeScriptExecuted:false }); continue; }
  const {compiled,generated,individuallyStrictChecked}=await program(entry.model);
  let failed:ModelError|undefined;try { await runModel(compiled); } catch(error) {assert(error instanceof ModelError);failed=error;}
  assert(failed);assert.equal(failed.diagnostics[0]?.code,entry.code);
  if(entry.expectedPartial) {assert(failed.partialResult);assert.equal(failed.partialResult.samples.length,entry.expectedPartial.samples);compare(failed.partialResult.finalState,entry.expectedPartial.finalState,entry.name+'/literal finalState');compare(failed.partialResult.stateMemory,entry.expectedPartial.stateMemory,entry.name+'/literal stateMemory');}
  try { generated.run(); assert.fail('Generated program must fail'); } catch(error) {const actual=error as {diagnostics:unknown;partialResult:RunResult};assert.deepEqual(actual.diagnostics,failed.diagnostics);assert(actual.partialResult);compare(stable(actual.partialResult),stable(failed.partialResult!),entry.name+'/full partial parity');}
  failures.push({name:entry.name,phase:'runtime',diagnosticCode:entry.code,actualTypeScriptExecuted:true,strictProgramIndividuallyChecked:individuallyStrictChecked,fullPartialParity:true});
}
const report = { pythonDiagnosticTarget: PYTHON_M7_TARGET.id, schemaVersion:1,engineVersion:ENGINE_VERSION,generatedAt:new Date().toISOString(),registryDefinitions:blockRegistry.length,addedDefinitions:M11_BLOCK_IDS.length,predecessorDefinitionsUnchanged:245,fullSimulinkEquivalenceClaimed:false,
 counts:{rawFixtures:M11_INDEPENDENT_DEFINITION_FIXTURES.length+M11_INDEPENDENT_BOUNDARY_FIXTURES.length,definitionFixtures:48,boundaryFixtures:M11_INDEPENDENT_BOUNDARY_FIXTURES.length,failures:failures.length,modeExecutions:fixtures.length,actualTypeScript:ordinal,strictTypeScriptPrograms:strictPrograms,checkedSamples,exactTypedCells}, tolerance,fixtures,failures };
await writeFile(join('docs/evidence',evidenceName+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
