import type { CompiledModel } from '../../model/src';
import type { WasmBinaryPlan } from './binary';
import type { WasmExportManifest } from './index';

/** Fixed host source plus hexadecimal UTF-8 data; user IDs never become executable syntax. */
export function wasmRunner(compiled: CompiledModel, plan: WasmBinaryPlan, manifest: WasmExportManifest): string {
  const data = { manifest, outputIndices:plan.outputIndices, includeStateMemory:compiled.model.execution.mode==='discrete'&&compiled.nodes.some(node=>['source.clock','source.step','source.ramp'].includes(node.blockType)), nodes:compiled.nodes.map(node=>({id:node.id,blockType:node.blockType,parameters:node.parameters,inputs:Object.fromEntries(Object.entries(node.inputs).map(([port,endpoint])=>[port,plan.nodeIds.indexOf(endpoint.nodeId)]))})) };
  const hex = (bytes: Uint8Array) => Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return `// CalcWeave fixed WebAssembly Core1 host; no filesystem/network/imported host functions.
const fromHex = value => Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte,16));
const bytes = fromHex('${hex(plan.bytes)}');
const data = JSON.parse(new TextDecoder().decode(fromHex('${hex(new TextEncoder().encode(JSON.stringify(data)))}')));
const copy = value => JSON.parse(JSON.stringify(value));
export function getManifest() { return copy(data.manifest); }
export class ModelError extends Error { constructor(diagnostics,partialResult) { super(diagnostics[0]?.message ?? 'WASM execution failed'); this.name='ModelError'; this.diagnostics=diagnostics; this.partialResult=partialResult; } }
export async function run(options={}) {
  const manifest=data.manifest, settings=manifest.execution, samples=[];
  const clock=()=>typeof performance?.now === 'function' ? performance.now() : Date.now(), started=clock();
  const result=status=>({samples:samples.map(sample=>({time:sample.time,values:{...sample.values}})),finalState:{},...(data.includeStateMemory?{stateMemory:{}}:{}),status,elapsedMs:clock()-started,steps:samples.length});
  const fail=(code,message,nodeId,tick,time)=>{throw new ModelError([{code,message,...(nodeId===undefined?{}:{nodeId}),...(tick===undefined?{}:{tick,time})}],result('failed'));};
  if (!globalThis.crypto?.subtle) fail('WASM_HASH_UNAVAILABLE','WASM byte integrity requires host SHA-256.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if (hash!==manifest.artifactHash || bytes.length!==manifest.artifactBytes) fail('WASM_ARTIFACT_MISMATCH','Embedded module bytes do not match the manifest.');
  if (typeof globalThis.WebAssembly?.Module !== 'function') fail('WASM_HOST_UNAVAILABLE','This host has no WebAssembly Module/Instance runtime.');
  const module=new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length || JSON.stringify(WebAssembly.Module.exports(module))!==JSON.stringify([{name:'evaluate',kind:'function'}])) fail('WASM_ABI_MISMATCH','Fixed module ABI differs.');
  const evaluate=new WebAssembly.Instance(module,{}).exports.evaluate;
  if (typeof evaluate!=='function') fail('WASM_ABI_MISMATCH','Fixed evaluate export is missing.');
  const intervals=settings.mode==='static'?0:Math.round((settings.stopTime-settings.startTime)/settings.step), limits=manifest.resourceLimits;
  if (!Number.isSafeInteger(intervals)||intervals<0||intervals>limits.maxTickIntervals) fail('WASM_STEP_BUDGET','Tick budget exceeded.');
  if ((intervals+1)*(manifest.outputIds.length+1)>limits.maxRecordedElements || manifest.maximumOperations>limits.maxOperations) fail('WASM_OPERATION_BUDGET','Declared output/work budget exceeded.');
  let operations=0;
  for(let tick=0;tick<=intervals;tick++) {
    if(options.signal?.aborted) return result('cancelled');
    const time=settings.startTime+tick*settings.step, values=[];
    for(let index=0;index<data.nodes.length;index++) {
      const node=data.nodes[index], input=port=>values[node.inputs[port]];
      if(node.blockType==='math.multiply'&&node.parameters.operation==='divide'&&input('b')===0 || node.blockType==='math.function'&&node.parameters.operation==='reciprocal'&&input('in')===0) fail('NUMERIC_DIVIDE_BY_ZERO','Cannot divide by zero.',node.id,tick,time);
      if(node.blockType==='math.sqrt'&&input('in')<0) fail('NUMERIC_DOMAIN','Square root requires a nonnegative real.',node.id,tick,time);
      operations+=manifest.instructionCount;
      if(operations>limits.maxOperations) fail('WASM_OPERATION_BUDGET','Actual emitted instruction work exceeded.',node.id,tick,time);
      if(clock()-started>limits.maxActiveWallMs) fail('WASM_WALL_BUDGET','Active execution time exceeded.',node.id,tick,time);
      const value=evaluate(index,time);
      if(typeof value!=='number'||!Number.isFinite(value)) fail('NUMERIC_NONFINITE','Node output is not a finite real.',node.id,tick,time);
      values.push(value);
    }
    samples.push({time,values:Object.fromEntries(manifest.outputIds.map((id,index)=>[id,values[data.outputIndices[index]]]))});
    if(tick%64===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  return result('completed');
}
`;
}
