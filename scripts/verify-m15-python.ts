import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { createPythonExportManifest, exportPython, getPythonDiagnostics, PYTHON_M7_TARGET, PYTHON_TARGET } from '../packages/codegen-python/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, ModelError, parseModelJson, serializeModel, type CalcModel } from '../packages/model/src';
import { M15_PYTHON_DEFINITION_FIXTURES, M15_PYTHON_BOUNDARY_FIXTURES, M15_PYTHON_FAILURE_FIXTURES } from '../tests/m15-python-fixtures';
import { m15Compare, m15Diagnostics, m15Execute, m15NativeOutcome, m15Portable, M15_PYTHON_VERSION, type M15PythonOutcome } from '../tests/m15-python-harness';

assert.equal(process.argv.length, 2, 'Use no arguments.');
assert.match(M15_PYTHON_VERSION, /^Python 3\.14\./, 'Actual isolated Python 3.14 is required.');
assert.equal(PYTHON_TARGET.blockIds.length, 69); assert.equal(PYTHON_M7_TARGET.blockIds.length, 51);
assert(PYTHON_M7_TARGET.blockIds.every(id=>PYTHON_TARGET.blockIds.includes(id)));
assert(blockRegistry.every(def=>def.exportTargets.includes('python')===PYTHON_M7_TARGET.blockIds.includes(def.id)));
const newlySupported = PYTHON_TARGET.blockIds.filter(id=>!PYTHON_M7_TARGET.blockIds.includes(id));
assert.equal(newlySupported.length, 18);
assert.deepEqual([...new Set(M15_PYTHON_DEFINITION_FIXTURES.flatMap(fixture=>fixture.model.nodes.map(node=>node.blockType)).filter(id=>newlySupported.includes(id)))].sort(), [...newlySupported].sort());
const directory=resolve('.test-generated/m15-python-parity'); await mkdir(directory,{recursive:true}); await mkdir('docs/evidence',{recursive:true});
const strictModes=new Set<string>(); let ordinal=0, samples=0;
const evidence:Record<string,unknown>[]=[], failures:Record<string,unknown>[]=[];
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');

async function generated(compiled:ReturnType<typeof compileModel>) {
  const prefix=String(ordinal++).padStart(4,'0'), pythonManifest=createPythonExportManifest(compiled), tsManifest=await createExportManifest(compiled);
  const pythonSource=exportPython(compiled,pythonManifest), source=exportTypeScript(compiled,tsManifest), tsPath=join(directory,`${prefix}.ts`), jsPath=join(directory,`${prefix}.mjs`), pyPath=join(directory,`${prefix}.py`);
  await writeFile(tsPath,source); await writeFile(pyPath,pythonSource); await writeFile(join(directory,`${prefix}.model.json`),serializeModel(compiled.model)); await writeFile(join(directory,`${prefix}.manifest.json`),JSON.stringify(pythonManifest,null,2)+'\n');
  assert.equal(pythonManifest.modelHash,tsManifest.modelHash); assert.deepEqual(pythonManifest.outputTypes,tsManifest.outputTypes); assert.deepEqual(pythonManifest.execution,tsManifest.execution);
  if(!strictModes.has(compiled.model.execution.mode)) {
    const program=ts.createProgram([tsPath],{strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,lib:['lib.es2022.d.ts'],types:[],noEmit:true});
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(item=>item.category===ts.DiagnosticCategory.Error).map(item=>ts.flattenDiagnosticMessageText(item.messageText,'\n')),[]); strictModes.add(compiled.model.execution.mode);
  }
  const transpiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}); await writeFile(jsPath,transpiled.outputText);
  const implementation=await import(/* @vite-ignore */pathToFileURL(jsPath).href); assert.deepEqual(implementation.getManifest(),tsManifest);
  let typescript:M15PythonOutcome;
  try { typescript={result:m15Portable(implementation.run())}; }
  catch(error) { const found=error as ModelError; assert(Array.isArray(found.diagnostics)); typescript={error:{name:'ModelError',diagnostics:found.diagnostics,...(found.partialResult?{partialResult:m15Portable(found.partialResult)}:{})}}; }
  const python=await m15Execute(compiled,{source:pythonSource}), native=await m15NativeOutcome(compiled);
  assert.deepEqual(python.manifest,pythonManifest);
  await writeFile(join(directory,`${prefix}.actual.json`),JSON.stringify({native,python,typescript},null,2)+'\n');
  return {native,python,typescript,artifact:{pythonPath:pyPath,pythonSha256:hash(pythonSource),typescriptPath:tsPath,typescriptSha256:hash(source),manifest:pythonManifest}};
}

for(const fixture of [...M15_PYTHON_DEFINITION_FIXTURES,...M15_PYTHON_BOUNDARY_FIXTURES]) for(const mode of ['static','discrete'] as const) {
  const model:CalcModel=structuredClone(fixture.model); model.modelId=`m15-python-${ordinal}-${mode}`; model.name=fixture.name;
  model.execution={mode,startTime:0,stopTime:mode==='static'?0:1,step:.5}; const compiled=compileModel(model), snapshot=JSON.stringify(compiled);
  assert.deepEqual(getPythonDiagnostics(compiled),[]); const result=await generated(compiled);
  assert(result.native.result&&result.python.result&&result.typescript.result,fixture.name);
  m15Compare(result.python.result,result.native.result,fixture.name); m15Compare(result.typescript.result,result.native.result,fixture.name);
  for(const sample of result.python.result.samples) m15Compare(sample.values,fixture.expected,fixture.name);
  samples+=result.python.result.samples.length;
  const roundtrip=compileModel(parseModelJson(serializeModel(model))), reversed=structuredClone(model); reversed.nodes.reverse(); reversed.edges.reverse();
  const roundtripResult=await m15NativeOutcome(roundtrip), reversedResult=await m15NativeOutcome(compileModel(reversed)); m15Compare(roundtripResult.result,result.native.result,'JSON');m15Compare(reversedResult.result,result.native.result,'ordering');
  assert.equal(JSON.stringify(compiled),snapshot);
  evidence.push({name:fixture.name,mode,sourceIds:fixture.sourceIds,samples:result.python.result.samples.length,independentLiteralOracle:true,fullNativePythonTypeScriptParity:true,jsonRoundtrip:true,nodeOrderIndependent:true,...result.artifact});
}
for(const fixture of M15_PYTHON_FAILURE_FIXTURES) {
  const compiled=compileModel(fixture.model);
  if(fixture.phase==='target') { const diagnostics=getPythonDiagnostics(compiled); assert(diagnostics.some(item=>item.code===fixture.code&&item.nodeId)); assert.throws(()=>exportPython(compiled),ModelError); failures.push({name:fixture.name,phase:fixture.phase,code:fixture.code,diagnostics}); continue; }
  const result=await generated(compiled); assert(result.native.error&&result.python.error&&result.typescript.error,fixture.name);
  assert(result.python.error.diagnostics.some(item=>item.code===fixture.code),fixture.name); assert.equal(result.python.error.partialResult?.samples.length,fixture.expectedSamples);
  assert.deepEqual(m15Diagnostics(result.python.error),m15Diagnostics(result.native.error)); assert.deepEqual(m15Diagnostics(result.typescript.error),m15Diagnostics(result.native.error));
  m15Compare(result.python.error.partialResult,result.native.error.partialResult); m15Compare(result.typescript.error.partialResult,result.native.error.partialResult);
  failures.push({name:fixture.name,phase:fixture.phase,code:fixture.code,partialSamples:fixture.expectedSamples,fullPartialStateParity:true,...result.artifact});
}
const files=['packages/codegen-python/src/capabilities.ts','packages/codegen-python/src/index.ts','packages/codegen-python/src/runtime.ts','packages/codegen-python/src/runtime-m15.ts','tests/m15-python-fixtures.ts','tests/m15-python-harness.ts','tests/m15-python.test.ts','scripts/verify-m15-python.ts'];
const hashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,hash(await readFile(file))])));
const report={schemaVersion:1,generatedAt:new Date().toISOString(),engineVersion:ENGINE_VERSION,python:M15_PYTHON_VERSION,target:PYTHON_TARGET,historicalTarget:PYTHON_M7_TARGET,registryDefinitions:blockRegistry.length,canonicalRegistrySha256:hash(JSON.stringify(blockRegistry)),definitionFixtures:M15_PYTHON_DEFINITION_FIXTURES.length,boundaryFixtures:M15_PYTHON_BOUNDARY_FIXTURES.length,newDefinitionIds:newlySupported,actualPrograms:ordinal,checkedSamples:samples,strictTypeScriptModes:[...strictModes],evidence,failures,fileSha256:hashes,selectedTypedScope:'scalar string/int8..64/uint8..64/float32/float64/boolean/enum/fixed and uint8 1-D<=256; no complex/structured/n-D/continuous',methodology:'Repository-owned generated code only, inert bounded hexadecimal JSON, actual Python -I -B processes, native + standalone TypeScript full samples/times/finalState/stateMemory, exact tags/integers/strings/boolean/zero sign, numeric tolerance 2e-12. Expected output literals are independent of production helpers. Historical target/registry preserved; no MATLAB/MathWorks equivalence claimed.',fullSimulinkEquivalenceClaimed:false};
const text=JSON.stringify(report,null,2)+'\n'; await writeFile(join(directory,'verification.json'),text);
const stage = ENGINE_VERSION.split('-')[1] ?? ENGINE_VERSION;
const evidencePath = stage === 'm15' && !existsSync('docs/evidence/m15-engineering-checks.json') ? 'docs/evidence/m15-python-verification.json' : `docs/evidence/m15-python-regression-on-${stage}.json`;
await writeFile(evidencePath,text);
console.log(JSON.stringify({programs:ordinal,checkedSamples:samples,definitionFixtures:report.definitionFixtures,boundaryFixtures:report.boundaryFixtures,failures:failures.length,python:M15_PYTHON_VERSION,strictModes:[...strictModes],evidenceSha256:hash(text)}));
