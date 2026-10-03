import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { M13_BLOCK_IDS } from '../packages/block-library/src/m13';
import { compileModel } from '../packages/compiler/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { getPythonDiagnostics } from '../packages/codegen-python/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type CalcModel, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { M13_INDEPENDENT_DEFINITION_FIXTURES, M13_INDEPENDENT_BOUNDARY_FIXTURES, M13_INDEPENDENT_FAILURE_FIXTURES, type M13IndependentFixture } from '../tests/m13-independent-fixtures';

assert.equal(process.argv.length, 2, 'Use no arguments');
const stage = ENGINE_VERSION.split('-').at(-1)!;
// Once source approvals bind the release proof, CI records fresh execution separately.
const evidenceName = stage === 'm13' && !existsSync('docs/evidence/m13-source-approvals.json') ? 'm13-verification' : `m13-regression-on-${stage}`;
const directory = resolve(`.test-generated/${evidenceName}`);
await mkdir(directory, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
const predecessor = JSON.parse(await readFile('docs/baselines/m12-registry.json', 'utf8')) as typeof blockRegistry;
assert.equal(predecessor.length, 304);
assert.equal(new Set(M13_BLOCK_IDS).size, 30);
assert(blockRegistry.length >= predecessor.length + M13_BLOCK_IDS.length);
for (const definition of predecessor) assert.deepEqual(blockRegistry.find(block => block.id === definition.id), definition, `${definition.id}: predecessor definition changed`);
assert.deepEqual([...new Set(M13_INDEPENDENT_DEFINITION_FIXTURES.flatMap(entry => entry.model.nodes.map(node => node.blockType)).filter(id => (M13_BLOCK_IDS as readonly string[]).includes(id)))].sort(), [...M13_BLOCK_IDS].sort(), 'Each M13 definition needs an executed raw numerical oracle');

const parityTolerance = 3e-12;
const strictModes = new Set<string>();
let ordinal = 0, checkedSamples = 0, strictPrograms = 0;
function compare(actual: unknown, expected: unknown, path: string, tolerance: number, exact = false): { absolute: number; scaled: number } {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path); assert(Number.isFinite(actual), `${path}: nonfinite number`);
    const absolute = Math.abs((actual as number) - expected), scaled = absolute / Math.max(1, Math.abs(expected));
    if (exact) assert(Object.is(actual, expected), `${path}: exact value differs`);
    else assert(scaled <= tolerance, `${path}: ${actual} vs ${expected}; scaled=${scaled}, tolerance=${tolerance}`);
    return { absolute, scaled };
  }
  const children: { absolute: number; scaled: number }[] = [];
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), `${path}: expected array`); assert.equal(actual.length, expected.length, `${path}: length`);
    expected.forEach((value, index) => children.push(compare(actual[index], value, `${path}[${index}]`, tolerance, exact)));
  } else if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), `${path}: expected object`);
    const e = expected as Record<string, unknown>, a = actual as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort(), `${path}: object fields`);
    for (const [key, value] of Object.entries(e)) children.push(compare(a[key], value, `${path}.${key}`, tolerance, exact || (e.kind === 'typed' && e.dtype !== 'float64' && e.dtype !== 'complex128')));
  } else assert.equal(actual, expected, `${path}: exact tag/string/boolean`);
  return { absolute: Math.max(0, ...children.map(item => item.absolute)), scaled: Math.max(0, ...children.map(item => item.scaled)) };
}
function stable(result: RunResult): Omit<RunResult, 'elapsedMs' | 'resources'> { const { elapsedMs: _elapsed, resources: _resources, ...contract } = result; return contract; }
function configured(entry: M13IndependentFixture, mode: CalcModel['execution']['mode']): CalcModel {
  const model = structuredClone(entry.model); model.execution.mode = mode;
  if (mode === 'static') model.execution.stopTime = model.execution.startTime;
  return model;
}
async function program(model: CalcModel) {
  const compiled = compileModel(model), manifest = await createExportManifest(compiled), source = exportTypeScript(compiled, manifest), prefix = String(ordinal++).padStart(4, '0');
  const tsPath = join(directory, `${prefix}.ts`), jsPath = join(directory, `${prefix}.mjs`); await writeFile(tsPath, source);
  const syntax = ts.createSourceFile(tsPath, source, ts.ScriptTarget.ES2022, true);
  assert(!syntax.statements.some(statement => ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)), 'Generated execution must have no imports');
  const individuallyStrictChecked = !strictModes.has(model.execution.mode);
  if (individuallyStrictChecked) {
    const checked = ts.createProgram([tsPath], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, lib: ['lib.es2022.d.ts'], types: [], noEmit: true });
    assert.deepEqual(ts.getPreEmitDiagnostics(checked).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `${model.modelId}: actual standalone strict errors`);
    strictPrograms += 1; strictModes.add(model.execution.mode);
  }
  const transpiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  assert.deepEqual((transpiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], `${model.modelId}: transpile errors`);
  await writeFile(jsPath, transpiled.outputText);
  const generated = await import(/* @vite-ignore */ pathToFileURL(jsPath).href); assert.equal(typeof generated.run, 'function'); assert.deepEqual(generated.getManifest(), manifest);
  return { compiled, manifest, generated, individuallyStrictChecked };
}
async function verify(entry: M13IndependentFixture, mode: CalcModel['execution']['mode']) {
  const model = configured(entry, mode), before = JSON.stringify(model), { compiled, manifest, generated, individuallyStrictChecked } = await program(model), result = await runModel(compiled);
  assert.equal(JSON.stringify(model), before, `${entry.name}: source mutation`); assert.equal(result.status, 'completed');
  assert.equal(manifest.targetVersion, 'typescript-m13-v1');
  const tolerance = entry.oracleTolerance;
  assert(Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= .05, `${entry.name}: bounded independently declared oracle tolerance`);
  assert.deepEqual(Object.keys(entry.expected).sort(), [...compiled.outputIds].sort(), `${entry.name}: complete output coverage`);
  const count = mode === 'static' ? 1 : entry.expectedStopReason ? entry.expectedStopReason.tick + 1 : Math.round((model.execution.stopTime - model.execution.startTime) / model.execution.step) + 1;
  assert.deepEqual(result.stopReason, entry.expectedStopReason);
  assert.deepEqual(result.samples.map(sample => sample.time), Array.from({length:count},(_,tick)=>model.execution.startTime+tick*model.execution.step), `${entry.name}: exact observation grid`);
  assert.equal(result.steps, count);
  let maximumAbsoluteError = 0, maximumScaledError = 0;
  for (const [id, series] of Object.entries(entry.expected)) {
    const expected = mode === 'static' ? [series[0]!] : series;
    assert.equal(count, expected.length, `${entry.name}/${id}: complete expected series`);
    result.samples.forEach((sample, index) => { const error = compare(sample.values[id], expected[index], `${entry.name}/${id}@${sample.time}`, tolerance); maximumAbsoluteError=Math.max(maximumAbsoluteError,error.absolute);maximumScaledError=Math.max(maximumScaledError,error.scaled); });
  }
  checkedSamples += count;
  if (entry.expectedFinalState !== undefined && mode !== 'static') compare(result.finalState, entry.expectedFinalState, `${entry.name}/full finalState oracle`, tolerance);
  if (entry.expectedStateMemory !== undefined && mode !== 'static') compare(result.stateMemory, entry.expectedStateMemory, `${entry.name}/full memory oracle`, tolerance);
  compare(generated.run(), stable(result), `${entry.name}/actual standalone full contract`, parityTolerance);
  const roundtrip = compileModel(parseModelJson(serializeModel(model))); assert.equal(roundtrip.semanticKey, compiled.semanticKey); compare(stable(await runModel(roundtrip)), stable(result), `${entry.name}/JSON full contract`, parityTolerance);
  const reversed = structuredClone(model); reversed.nodes.reverse(); reversed.edges.reverse(); const reordered = compileModel(reversed); assert.equal(reordered.semanticKey, compiled.semanticKey); compare(stable(await runModel(reordered)), stable(result), `${entry.name}/reversed full contract`, parityTolerance);
  const newNodes = compiled.nodes.filter(node => (M13_BLOCK_IDS as readonly string[]).includes(node.blockType));
  const pythonDiagnostics = getPythonDiagnostics(compiled);
  for (const node of newNodes) assert(pythonDiagnostics.some(diagnostic => diagnostic.nodeId === node.id), `${entry.name}/${node.id}: unsupported Python diagnostic`);
  return { id:entry.name, ...(entry.sourceIds?{sourceIds:entry.sourceIds}:{}), mode, blockIds:[...new Set(newNodes.map(node=>node.blockType))],
    parameters:Object.fromEntries(newNodes.map(node=>[node.id,{blockType:node.blockType,parameters:node.parameters,sampleTime:node.sampleTime}])), solver:compiled.model.execution.solver,
    samples:count, maximumAbsoluteError,maximumScaledError,oracleTolerance:tolerance,parityTolerance,independentLiteralOracle:entry.metadataOracleFromDeclaredRegistry !== true, metadataOracleFromDeclaredRegistry:entry.metadataOracleFromDeclaredRegistry === true,
    independentFullFinalStateOracle:entry.expectedFinalState!==undefined,independentFullStateMemoryOracle:entry.expectedStateMemory!==undefined,
    modelHash:manifest.modelHash,targetVersion:manifest.targetVersion,strictStandaloneTemplateModeVerified:true,strictProgramIndividuallyChecked:individuallyStrictChecked,importFreeStandalone:true,actualStandaloneTypeScript:true,
    fullSamplesFinalStateMemoryParity:true,exactManifest:true,jsonRoundtrip:true,insertionOrderIndependent:true,pythonUnsupportedNodeDiagnostics:true };
}
const fixtures = [];
for (const entry of [...M13_INDEPENDENT_DEFINITION_FIXTURES,...M13_INDEPENDENT_BOUNDARY_FIXTURES]) for (const mode of entry.declaredModes) fixtures.push(await verify(entry,mode));
const failures = [];
for (const entry of M13_INDEPENDENT_FAILURE_FIXTURES) {
  if(entry.phase==='compile') { assert.throws(()=>compileModel(entry.model),(error:unknown)=>error instanceof ModelError&&error.diagnostics[0]?.code===entry.code);failures.push({name:entry.name,phase:'compile',diagnosticCode:entry.code,actualTypeScriptExecuted:false});continue; }
  const {compiled,generated,individuallyStrictChecked}=await program(entry.model);
  let failed:ModelError|undefined;try{await runModel(compiled);}catch(error){assert(error instanceof ModelError);failed=error;}
  assert(failed);assert.equal(failed.diagnostics[0]?.code,entry.code);
  if(entry.expectedPartial) {assert(failed.partialResult);assert.equal(failed.partialResult.samples.length,entry.expectedPartial.samples);if(entry.expectedPartial.finalState)compare(failed.partialResult.finalState,entry.expectedPartial.finalState,entry.name+'/independent partial state',parityTolerance);if(entry.expectedPartial.stateMemory)compare(failed.partialResult.stateMemory,entry.expectedPartial.stateMemory,entry.name+'/independent partial memory',parityTolerance);}
  try{generated.run();assert.fail('Generated must fail');}catch(error){const actual=error as{diagnostics:unknown;partialResult:RunResult};assert.deepEqual(actual.diagnostics,failed.diagnostics);assert(actual.partialResult&&failed.partialResult);compare(stable(actual.partialResult),stable(failed.partialResult),entry.name+'/full failure partial parity',parityTolerance);}
  failures.push({name:entry.name,phase:'runtime',diagnosticCode:entry.code,actualTypeScriptExecuted:true,strictProgramIndividuallyChecked:individuallyStrictChecked,fullPartialParity:true});
}
const report={schemaVersion:1,engineVersion:ENGINE_VERSION,generatedAt:new Date().toISOString(),registryDefinitions:blockRegistry.length,addedDefinitions:30,predecessorDefinitionsUnchanged:304,fullSimulinkEquivalenceClaimed:false,
  counts:{rawFixtures:M13_INDEPENDENT_DEFINITION_FIXTURES.length+M13_INDEPENDENT_BOUNDARY_FIXTURES.length,definitionFixtures:M13_INDEPENDENT_DEFINITION_FIXTURES.length,boundaryFixtures:M13_INDEPENDENT_BOUNDARY_FIXTURES.length,failures:failures.length,modeExecutions:fixtures.length,actualTypeScript:ordinal,strictTypeScriptPrograms:strictPrograms,checkedSamples},parityTolerance,fixtures,failures};
await writeFile(join('docs/evidence',evidenceName+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
