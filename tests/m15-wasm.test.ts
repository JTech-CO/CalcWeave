import { describe,it,expect } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { generateWasm,createWasmManifest,generateWasmRunner,getWasmDiagnostics,sha256Bytes } from '../packages/codegen-wasm/src';
import { M15_WASM_INDEPENDENT_FIXTURES,m15WasmMode,M15_WASM_FAILURE_FIXTURES } from './m15-wasm-independent-fixtures';
import { createHash } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runModel } from '../packages/runtime/src';
import { ModelError } from '../packages/model/src';
import { createSubsystemFromSelection } from '../packages/compiler/src/hierarchy';
describe('M15 actual bounded DAG WebAssembly target',()=>{
  for(const fixture of M15_WASM_INDEPENDENT_FIXTURES) for(const mode of fixture.modes) it(`${fixture.name}/${mode}`,async()=>{
    const compiled=compileModel(m15WasmMode(fixture,mode)), bytes=generateWasm(compiled),manifest=createWasmManifest(compiled,bytes);
    expect(WebAssembly.validate(bytes)).toBe(true); const module=new WebAssembly.Module(bytes);
    expect(WebAssembly.Module.imports(module)).toEqual([]); expect(WebAssembly.Module.exports(module)).toEqual([{name:'evaluate',kind:'function'}]);
    expect(sha256Bytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex')); expect(generateWasm(compiled)).toEqual(bytes);
    const directory=resolve('.test-generated/m15-wasm-unit');await mkdir(directory,{recursive:true});const path=resolve(directory,`${fixture.name}-${mode}.mjs`);await writeFile(path,generateWasmRunner(compiled,bytes,manifest));
    const generated=await import(pathToFileURL(path).href+'?'+Date.now()),actual=await generated.run(),native=await runModel(compiled);
    for(const [id,expected] of Object.entries(fixture.expected)) { const wanted=actual.samples.length===1?expected:expected.length===1?Array.from({length:actual.samples.length},()=>expected[0]):expected; expect(actual.samples.map((sample:{values:Record<string,number>})=>sample.values[id])).toEqual(wanted); }
    expect(actual.samples).toEqual(native.samples);expect(actual.finalState).toEqual(native.finalState);expect(actual.stateMemory).toEqual(native.stateMemory);expect(generated.getManifest()).toEqual(manifest);
    const copy=generateWasm(compiled);copy[0]=99;expect(generateWasm(compiled)[0]).toBe(0);expect(()=>createWasmManifest(compiled,copy)).toThrow(ModelError);
  });
  for(const fixture of M15_WASM_FAILURE_FIXTURES) it(fixture.name,async()=>{
    const compiled=compileModel(fixture.model);
    if(fixture.phase==='target') {expect(getWasmDiagnostics(compiled).some(diagnostic=>diagnostic.code===fixture.code)).toBe(true);expect(()=>generateWasm(compiled)).toThrow(ModelError);return;}
    const bytes=generateWasm(compiled),path=resolve('.test-generated/m15-wasm-unit',fixture.name+'.mjs');await mkdir(resolve('.test-generated/m15-wasm-unit'),{recursive:true});await writeFile(path,generateWasmRunner(compiled,bytes));
    const generated=await import(pathToFileURL(path).href+'?'+Date.now());let failure:any;try{await generated.run();}catch(error){failure=error;}expect(failure?.diagnostics[0].code).toBe(fixture.code);expect(failure.diagnostics[0].nodeId).toBe(fixture.nodeId);expect(failure.partialResult.samples.length).toBe(fixture.samples);
    let native:any;try{await runModel(compiled);}catch(error){native=error;}expect(failure.partialResult.samples).toEqual(native.partialResult.samples);expect(failure.diagnostics[0].tick).toBe(native.diagnostics[0].tick??0);expect(failure.diagnostics[0].time).toBe(native.diagnostics[0].time??compiled.model.execution.startTime);
  });
  it('rejects modified manifests, source snapshots and nested source locations',()=>{
    const compiled=compileModel(M15_WASM_INDEPENDENT_FIXTURES[0]!.model),bytes=generateWasm(compiled),manifest=createWasmManifest(compiled,bytes);
    const changed=structuredClone(manifest);changed.artifactHash='0'.repeat(64);expect(()=>generateWasmRunner(compiled,bytes,changed)).toThrow(ModelError);
    const forged=structuredClone(compiled);forged.nodes.find(node=>node.id==='op')!.parameters.gain=99;expect(()=>generateWasm(forged)).toThrow(ModelError);
    const nested=createSubsystemFromSelection(M15_WASM_INDEPENDENT_FIXTURES[0]!.model,['op'],'Nested DAG'),diagnostics=getWasmDiagnostics(compileModel(nested));
    expect(diagnostics.some(diagnostic=>diagnostic.code==='WASM_HIERARCHY_UNSUPPORTED'&&diagnostic.hierarchyPath?.length)).toBe(true);
  });
  it('reports real emitted work and returns independent manifests',()=>{
    const compiled=compileModel(M15_WASM_INDEPENDENT_FIXTURES[0]!.model),bytes=generateWasm(compiled),first=createWasmManifest(compiled,bytes),second=createWasmManifest(compiled,bytes);
    expect(first.maximumOperations).toBe(first.instructionCount*first.evaluationCallsPerTick);first.outputTypes.output!.unit='s';expect(second.outputTypes.output!.unit).toBe('1');
  });
  it('supports per-run abort without sharing prior samples or mutating compiler input',async()=>{
    const compiled=compileModel(M15_WASM_INDEPENDENT_FIXTURES[0]!.model),bytes=generateWasm(compiled),path=resolve('.test-generated/m15-wasm-unit/cancel-copy.mjs');await writeFile(path,generateWasmRunner(compiled,bytes));const runner=await import(pathToFileURL(path).href+'?'+Date.now());
    const controller=new AbortController();controller.abort();const cancelled=await runner.run({signal:controller.signal});expect(cancelled.status).toBe('cancelled');expect(cancelled.samples).toEqual([]);
    const first=await runner.run();first.samples[0].values.output=99;expect((await runner.run()).samples[0].values.output).toBe(-6);expect(compiled.nodes.find(node=>node.id==='op')!.parameters.gain).toBe(2);
  });
});
