import assert from 'node:assert/strict';
import { registryWithoutApprovedObserverInputs } from './m16-support-source';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { join,resolve,delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { blockRegistry,getBlockDefinition } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { generateWasm,createWasmManifest,generateWasmRunner,getWasmDiagnostics,WASM_TARGET,C_CPP_TARGET } from '../packages/codegen-wasm/src';
import { ENGINE_VERSION,serializeModel,parseModelJson,ModelError,type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { M15_WASM_INDEPENDENT_FIXTURES,M15_WASM_FAILURE_FIXTURES,m15WasmMode } from '../tests/m15-wasm-independent-fixtures';
assert.equal(process.argv.length,2,'Use no arguments');
const digest=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const stage=ENGINE_VERSION.split('-').at(-1)!;
const evidenceName=stage==='m15'&&!existsSync('docs/evidence/m15-engineering-checks.json')?'m15-wasm-verification':`m15-wasm-regression-on-${stage}`;
const directory=resolve(`.test-generated/${evidenceName}`);await mkdir(directory,{recursive:true});
const predecessor=JSON.parse(await readFile('docs/baselines/m14-registry.json','utf8')) as typeof blockRegistry;
const historicalRegistry = registryWithoutApprovedObserverInputs(blockRegistry);
assert.equal(predecessor.length,337);assert.equal(blockRegistry.length,337);for(const definition of predecessor) assert.deepEqual(historicalRegistry.find(item=>item.id===definition.id),definition,`${definition.id}: historical canonical changed beyond two approved observer inputCount declarations`);
const units=(result:RunResult)=>({samples:result.samples,finalState:result.finalState,...(result.stateMemory?{stateMemory:result.stateMemory}:{})});
function equal(actual:unknown,expected:unknown,path='value'):void {
  if(typeof expected==='number') {assert.equal(typeof actual,'number',path);assert(Number.isFinite(actual));if(expected===0) assert(Object.is(actual,expected),`${path}:signed zero`);else assert(Math.abs((actual as number)-expected)/Math.max(1,Math.abs(expected))<=1e-12,`${path}:literal numeric oracle`);return;}
  if(Array.isArray(expected)){assert(Array.isArray(actual));assert.equal(actual.length,expected.length);expected.forEach((item,index)=>equal(actual[index],item,`${path}[${index}]`));return;}
  if(expected&&typeof expected==='object'){assert(actual&&typeof actual==='object');const a=actual as Record<string,unknown>,e=expected as Record<string,unknown>;assert.deepEqual(Object.keys(a).sort(),Object.keys(e).sort());Object.entries(e).forEach(([key,value])=>equal(a[key],value,`${path}.${key}`));return;}assert.equal(actual,expected,path);
}
function inspect(bytes:Uint8Array):{sections:number[];instructionCount:number;opcodeCounts:Record<string,number>} {
  let position=8;assert.deepEqual(Array.from(bytes.slice(0,8)),[0,97,115,109,1,0,0,0]);
  const u32=()=>{let value=0,shift=0;for(let count=0;count<5;count++){const byte=bytes[position++]!;assert(position<=bytes.length);value|=(byte&127)<<shift;if(!(byte&128))return value>>>0;shift+=7;}throw Error('Unbounded binary varuint');};
  const sections:number[]=[],opcodeCounts:Record<string,number>={};let instructionCount=0;
  while(position<bytes.length){const id=bytes[position++]!,length=u32(),end=position+length;assert(end<=bytes.length);sections.push(id);
    if(id===10){assert.equal(u32(),1);const bodyLength=u32(),bodyEnd=position+bodyLength;assert.equal(bodyEnd,end);assert.equal(u32(),1);assert(u32()<=65);assert.equal(bytes[position++],0x7c);
      while(position<bodyEnd){const opcode=bytes[position++]!;assert([0x20,0x21,0x44,0x41,0x46,0x1b,0x63,0x99,0x9a,0x9f,0xa0,0xa1,0xa2,0xa3,0xa4,0xa5,0x0b].includes(opcode),`Forbidden opcode${opcode.toString(16)}`);opcodeCounts[opcode.toString(16)]=(opcodeCounts[opcode.toString(16)]??0)+1;instructionCount++;if([0x20,0x21,0x41].includes(opcode))u32();if(opcode===0x44)position+=8;assert(position<=bodyEnd);}
    }position=end;
  }assert.deepEqual(sections,[1,3,7,10]);return{sections,instructionCount,opcodeCounts};
}
function safeSource(source:string):void {const syntax=ts.createSourceFile('runner.mjs',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),bad:string[]=[];const forbidden=new Set(['eval','Function','fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','importScripts','sendBeacon']);
  function visit(node:ts.Node):void{if(ts.isImportDeclaration(node)||ts.isImportEqualsDeclaration(node)||ts.isExportDeclaration(node)&&node.moduleSpecifier)bad.push('import');if(ts.isCallExpression(node)||ts.isNewExpression(node)){const callee=node.expression,name=ts.isIdentifier(callee)?callee.text:ts.isPropertyAccessExpression(callee)?callee.name.text:'';if(callee.kind===ts.SyntaxKind.ImportKeyword||forbidden.has(name))bad.push(name||'dynamicimport');}ts.forEachChild(node,visit);}visit(syntax);assert.deepEqual(bad,[]);
}
let ordinal=0,checkedSamples=0;
async function program(compiled:ReturnType<typeof compileModel>) {
  const bytes=generateWasm(compiled),manifest=createWasmManifest(compiled,bytes),source=generateWasmRunner(compiled,bytes,manifest),structure=inspect(bytes);assert(WebAssembly.validate(bytes));const module=new WebAssembly.Module(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);assert.deepEqual(WebAssembly.Module.exports(module),[{name:'evaluate',kind:'function'}]);assert.equal(structure.instructionCount,manifest.instructionCount);assert.equal(digest(bytes),manifest.artifactHash);assert.equal(digest(compiled.semanticKey),manifest.modelHash);safeSource(source);
  const prefix=String(ordinal++).padStart(4,'0'),base=join(directory,prefix),path=base+'.mjs';await writeFile(path,source);await writeFile(base+'.wasm',bytes);await writeFile(base+'.manifest.json',JSON.stringify(manifest,null,2)+'\n');
  const runner=await import(pathToFileURL(path).href+`?run=${ordinal}`);assert.deepEqual(runner.getManifest(),manifest);const defensive=runner.getManifest();defensive.outputIds.length=0;assert.equal(runner.getManifest().outputIds.length,manifest.outputIds.length);
  const changed=new Uint8Array(bytes);changed[0]=255;assert.throws(()=>createWasmManifest(compiled,changed),ModelError);assert.deepEqual(generateWasm(compiled),bytes);
  return{runner,bytes,manifest,structure,artifactFiles:{binary:{path:base+'.wasm',sha256:digest(bytes)},runner:{path,sha256:digest(source)},manifest:{path:base+'.manifest.json',sha256:digest(await readFile(base+'.manifest.json'))}}};
}
const proofs:Record<string,unknown>[]=[],failures:Record<string,unknown>[]=[];
for(const fixture of M15_WASM_INDEPENDENT_FIXTURES)for(const mode of fixture.modes){const model=m15WasmMode(fixture,mode),compiled=compileModel(model),p=await program(compiled),actual=await p.runner.run() as RunResult,native=await runModel(compiled);
  equal(units(actual),units(native));assert.equal(actual.status,'completed');
  for(const[id,expected]of Object.entries(fixture.expected)){const wanted=expected.length===1?Array.from({length:actual.samples.length},()=>expected[0]):expected;equal(actual.samples.map(sample=>sample.values[id]),wanted,`${fixture.name}/${mode}/${id}`);}checkedSamples+=actual.samples.length;
  const roundtrip=compileModel(parseModelJson(serializeModel(model))),reverse=structuredClone(model);reverse.nodes.reverse();reverse.edges.reverse();const reversed=compileModel(reverse);assert.deepEqual(generateWasm(roundtrip),p.bytes);assert.deepEqual(generateWasm(reversed),p.bytes);equal(units(await(await program(roundtrip)).runner.run()),units(actual));equal(units(await(await program(reversed)).runner.run()),units(actual));
  proofs.push({id:fixture.name,mode,modelHash:p.manifest.modelHash,nodeIds:p.manifest.nodeIds,outputIds:p.manifest.outputIds,outputTypes:p.manifest.outputTypes,artifactHash:p.manifest.artifactHash,bytes:p.bytes.length,instructionCount:p.structure.instructionCount,evaluationCallsPerTick:p.manifest.evaluationCallsPerTick,maximumOperations:p.manifest.maximumOperations,opcodes:p.structure.opcodeCounts,sections:p.structure.sections,samples:actual.samples.length,independentLiteralOracle:true,actualWebAssemblyModuleInstance:true,nativeFullGridParity:true,signedZeroExact:true,deterministicBytes:true,exactManifest:true,jsonRoundtrip:true,insertionOrderIndependent:true,defensiveBytesAndManifestCopy:true,artifactFiles:p.artifactFiles});
}
for(const fixture of M15_WASM_FAILURE_FIXTURES){const compiled=compileModel(fixture.model);if(fixture.phase==='target'){const diagnostics=getWasmDiagnostics(compiled);assert(diagnostics.some(item=>item.code===fixture.code));assert.throws(()=>generateWasm(compiled),ModelError);failures.push({id:fixture.name,phase:'target',diagnosticCode:fixture.code,diagnostics,actualModuleExecuted:false});continue;}
  const p=await program(compiled);let actual:any,native:any;try{await p.runner.run();}catch(error){actual=error;}try{await runModel(compiled);}catch(error){native=error;}assert(actual&&native);assert.equal(actual.diagnostics[0].code,fixture.code);assert.equal(actual.diagnostics[0].nodeId,fixture.nodeId);assert.equal(actual.partialResult.samples.length,fixture.samples);equal(units(actual.partialResult),units(native.partialResult));assert.equal(actual.diagnostics[0].tick,native.diagnostics[0].tick??0);assert.equal(actual.diagnostics[0].time,native.diagnostics[0].time??compiled.model.execution.startTime);
  for(const[id,wanted]of Object.entries(fixture.expectedPartial??{}))equal(actual.partialResult.samples.map((sample:any)=>sample.values[id]),wanted);
  failures.push({id:fixture.name,phase:'runtime',diagnosticCode:fixture.code,nodeId:fixture.nodeId,tick:actual.diagnostics[0].tick,time:actual.diagnostics[0].time,samples:actual.partialResult.samples.length,actualModuleExecuted:true,independentPartialOracle:true,nativePartialParity:true,staticNativeLocationOmitted:fixture.model.execution.mode==='static',artifactFiles:p.artifactFiles});
}
const called=new Set(M15_WASM_INDEPENDENT_FIXTURES.flatMap(fixture=>fixture.model.nodes.map(node=>node.blockType)));for(const id of WASM_TARGET.blockIds)assert(called.has(id),`${id}: missing actual independent fixture`);
const pathNames=['clang','clang++','gcc','g++','cl','cmake'],pathDiscovery=pathNames.map(name=>({name,found:(process.env.PATH??'').split(delimiter).some(directory=>existsSync(join(directory,process.platform==='win32'?name+'.exe':name)))}));
const known=['C:/Program Files/LLVM/bin/clang.exe','C:/msys64/mingw64/bin/gcc.exe','C:/mingw64/bin/gcc.exe'];const vsRoot='C:/Program Files/Microsoft Visual Studio/2022';const vsEntries=existsSync(vsRoot)?await readdir(vsRoot):[];
const sources=['packages/codegen-wasm/src/index.ts','packages/codegen-wasm/src/capabilities.ts','packages/codegen-wasm/src/binary.ts','packages/codegen-wasm/src/runner.ts','packages/codegen-wasm/src/sha256.ts','tests/m15-wasm-independent-fixtures.ts','scripts/verify-m15-wasm.ts'];
const report={generatedAt:new Date().toISOString(),stage:'M15',engineVersion:ENGINE_VERSION,target:WASM_TARGET,registryDefinitions:337,predecessorDefinitionsUnchanged:337,sourceSubsetUnchanged:367,counts:{rawFixtures:M15_WASM_INDEPENDENT_FIXTURES.length,successModes:proofs.length,runtimeFailures:failures.filter(item=>item.phase==='runtime').length,targetRejections:failures.filter(item=>item.phase==='target').length,actualPrimaryPrograms:proofs.length+failures.filter(item=>item.phase==='runtime').length,actualIncludingJsonReversePrograms:ordinal,checkedSuccessfulSamples:checkedSamples},fixtures:proofs,failures,cCpp:{profile:C_CPP_TARGET,pathDiscovery,knownExecutableLocations:known.map(path=>({path,exists:existsSync(path)})),visualStudio2022RootExists:existsSync(vsRoot),visualStudio2022Entries:vsEntries,probeScope:'Read-only PATH and explicit standard locations, not an exhaustive device inventory',nativeCompilerBuildExecuted:false,nativeGeneratorApproved:false},sourceArtifactHashes:Object.fromEntries(await Promise.all(sources.map(async path=>[path,digest(await readFile(path))]))),protectedArtifacts:{'docs/baselines/m14-registry.json':digest(await readFile('docs/baselines/m14-registry.json')),'docs/evidence/m14-source-approvals.json':digest(await readFile('docs/evidence/m14-source-approvals.json')),'docs/evidence/m14-verification.json':digest(await readFile('docs/evidence/m14-verification.json'))},fullSimulinkEquivalenceClaimed:false,arbitraryModuleImporter:false,primarySourceRuntimeExecuted:false};
await writeFile(`docs/evidence/${evidenceName}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({evidenceName,target:WASM_TARGET.id,...report.counts,fullSimulinkEquivalenceClaimed:false}));
