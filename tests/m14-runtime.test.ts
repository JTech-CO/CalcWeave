import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { BUILTIN_ADAPTER_PROFILES, ModelError, type CalcModel, type IRNode, type MessageSignal, type RunResult, type SignalValue } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { createDiscreteMachine } from '../packages/runtime/src/discrete-machine';
import { m14InitialMemory, m14Read, type M14Memory } from '../packages/runtime/src/m14';
import { inspectM14Wasm, invokeM14Wasm, M14_WASM_BYTES } from '../packages/runtime/src/m14-wasm';
import { M14_INDEPENDENT_BOUNDARY_FIXTURES, M14_INDEPENDENT_DEFINITION_FIXTURES, M14_INDEPENDENT_FAILURE_FIXTURES } from './m14-independent-fixtures';

afterEach(() => vi.unstubAllGlobals());
const success = [...M14_INDEPENDENT_DEFINITION_FIXTURES,...M14_INDEPENDENT_BOUNDARY_FIXTURES];
const baseModel = (id: string): CalcModel => structuredClone(M14_INDEPENDENT_DEFINITION_FIXTURES.find(entry=>entry.model.nodes.some(node=>node.blockType===id))!.model);
const adapter = (type: string): IRNode => structuredClone(compileModel(baseModel(type)).nodes.find(node=>node.blockType===type)!);
const diagnostics = (operation: () => unknown): string => { try { operation(); throw new Error('Expected diagnostic'); } catch(error) { if (!(error instanceof ModelError)) throw error; return error.diagnostics[0]!.code; } };
const batch = (start: number, count: number, producerPrefix = 'P'): MessageSignal => ({ kind:'messages',items:Array.from({length:count},(_,index)=>({producer:`${producerPrefix}${start+index}`,sequence:0,time:0,priority:0,payload:1})) });

describe('M14 independent actual numerical, FIFO and lifecycle models',()=>{
  for (const entry of success) for (const mode of entry.declaredModes) it(`${entry.name}/${mode}`,async()=>{
    const model=structuredClone(entry.model); model.execution.mode=mode; if(mode==='static')model.execution.stopTime=model.execution.startTime;
    const result=await runModel(compileModel(model));
    for(const[id,expected]of Object.entries(entry.expected))expect(result.samples.map(sample=>sample.values[id])).toEqual(mode==='static'?expected.slice(0,1):expected);
    if(entry.expectedFinalState)expect(result.finalState).toEqual(entry.expectedFinalState);
    if(entry.expectedStateMemory)expect(result.stateMemory).toEqual(entry.expectedStateMemory);
    if(entry.expectedAdapterLifecycle)expect(result.adapterLifecycle).toEqual(entry.expectedAdapterLifecycle);
    if(entry.expectedStopReason)expect(result.stopReason).toEqual(entry.expectedStopReason);
    expect(result.status).toBe('completed');
  });
  for(const entry of M14_INDEPENDENT_FAILURE_FIXTURES)it(entry.name,async()=>{
    let error:ModelError|undefined;
    try{const compiled=compileModel(entry.model); if(entry.phase==='runtime')await runModel(compiled);}catch(caught){if(!(caught instanceof ModelError))throw caught;error=caught;}
    expect(error?.diagnostics.map(row=>row.code)).toContain(entry.code);
    if(entry.expectedPartial){const partial=error!.partialResult as RunResult;expect(partial.status).toBe('failed');expect(partial.samples).toHaveLength(entry.expectedPartial.samples);if(entry.expectedPartial.finalState)expect(partial.finalState).toEqual(entry.expectedPartial.finalState);if(entry.expectedPartial.stateMemory)expect(partial.stateMemory).toEqual(entry.expectedPartial.stateMemory);if(entry.expectedPartial.adapterLifecycle)expect(partial.adapterLifecycle).toEqual(entry.expectedPartial.adapterLifecycle);}
  });
});

describe('M14 fixed WASM artifact, ABI and real calls',()=>{
  it('independently hashes pinned bytes and inspects every denied resource/instruction capability',()=>{
    for(const profile of BUILTIN_ADAPTER_PROFILES.filter(profile=>profile.artifact)){
      const bytes=M14_WASM_BYTES[profile.id]!,inspection=inspectM14Wasm(bytes,profile.id),module=new WebAssembly.Module(Uint8Array.from(bytes));
      expect(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')).toBe(profile.artifact!.sha256);expect(bytes).toHaveLength(profile.artifact!.byteLength);
      expect(inspection).toMatchObject({sections:[1,3,7,10],imports:0,memories:0,tables:0,globals:0,start:false,loops:false,calls:false});
      expect(WebAssembly.Module.imports(module)).toEqual([]);expect(WebAssembly.Module.exports(module)).toEqual(profile.artifact!.exports.map(value=>({name:value.name,kind:'function'})));
      expect(inspection.instructionCount).toBe(profile.id.includes('affine')?6:14);expect(Object.isFrozen(bytes)).toBe(true);
    }
  });
  it('rejects every single-byte tamper before any host compilation',()=>{
    for(const[id,bytes]of Object.entries(M14_WASM_BYTES))for(let index=0;index<bytes.length;index++){const changed=[...bytes];changed[index]=changed[index]!^1;expect(diagnostics(()=>inspectM14Wasm(changed,id))).toBe('M14_ADAPTER_ABI');}
  });
  it('preserves f64 arithmetic order and raw IEEE negative zero in the actual fixed modules',()=>{
    const affine=adapter('adapter.wasm-affine'),accum=adapter('adapter.wasm-accumulator');
    expect(invokeM14Wasm(affine,'affine',[2,3,-1])).toBe(5);expect(Object.is(invokeM14Wasm(affine,'affine',[-0,1,-0]),-0)).toBe(true);
    for(const name of ['initialize','read','reset','terminate'])expect(Object.is(invokeM14Wasm(accum,name,[-0]),-0)).toBe(true);
    expect(invokeM14Wasm(accum,'accumulate',[1,2,3])).toBe(7);expect(diagnostics(()=>invokeM14Wasm(affine,'affine',[Number.MAX_VALUE,2,0]))).toBe('M14_ADAPTER_NONFINITE');
  });
  it('refuses bad identity, wrong arity and arbitrary export names without numeric fallback',()=>{
    const node=adapter('adapter.wasm-affine');node.parameters.adapterIdentity={...(node.parameters.adapterIdentity as object),sha256:'0'.repeat(64)};
    expect(diagnostics(()=>invokeM14Wasm(node,'affine',[2,3,-1]))).toBe('M14_ADAPTER_ABI');expect(diagnostics(()=>invokeM14Wasm(adapter('adapter.wasm-affine'),'affine',[2]))).toBe('M14_ADAPTER_ABI');expect(diagnostics(()=>invokeM14Wasm(adapter('adapter.wasm-affine'),'eval',[2]))).toBe('M14_ADAPTER_ABI');
  });
  it('reports a missing WASM host and rejects wrong host exports',()=>{
    vi.stubGlobal('WebAssembly',undefined);expect(diagnostics(()=>invokeM14Wasm(adapter('adapter.wasm-affine'),'affine',[2,3,-1]))).toBe('M14_ADAPTER_UNAVAILABLE');
    vi.stubGlobal('WebAssembly',{Module:class{},Instance:class{exports={affine:3};}});expect(diagnostics(()=>invokeM14Wasm(adapter('adapter.wasm-affine'),'affine',[2,3,-1]))).toBe('M14_ADAPTER_ABI');
  });
  it('reports a trap instead of falling back to native arithmetic',()=>{
    vi.stubGlobal('WebAssembly',{Module:class{},Instance:class{exports={affine:()=>{throw new Error('private host details');}};}});expect(diagnostics(()=>invokeM14Wasm(adapter('adapter.wasm-affine'),'affine',[2,3,-1]))).toBe('M14_ADAPTER_TRAP');
  });
  it('executes actual lifecycle functions on one pure instance and terminates idempotently without changing snapshots',()=>{
    const real=globalThis.WebAssembly,calls:Record<string,number>={},instances:number[]=[];
    vi.stubGlobal('WebAssembly',{Module:real.Module,Instance:class{exports:Record<string,unknown>;constructor(module:WebAssembly.Module){instances.push(1);const original=new real.Instance(module).exports;this.exports=Object.fromEntries(Object.entries(original).map(([name,fn])=>[name,(...args:number[])=>{calls[name]=(calls[name]??0)+1;return(fn as(...args:number[])=>number)(...args);} ]));}}});
    const compiled=compileModel(baseModel('adapter.wasm-accumulator')),charged:number[]=[],machine=createDiscreteMachine(compiled.nodes,compiled.stateIds,.5,0,(_node,work)=>{if(work)charged.push(work);});
    const first=machine.evaluate(0,0);machine.transition(first,0);machine.evaluate(1,.5);const before=machine.stateMemory(),rows=machine.finalize('completed');rows[0]!.reason='failed';
    expect(instances).toHaveLength(1);expect(calls).toEqual({initialize:1,read:3,accumulate:1,terminate:1});expect(charged[0]).toBeGreaterThan(121*3);expect(machine.finalize('failed')[0]!.reason).toBe('completed');expect(machine.stateMemory()).toEqual(before);expect(diagnostics(()=>machine.evaluate(2,1))).toBe('M14_LIFECYCLE_CLOSED');
  });
  it('terminates a previously initialized instance when later construction fails',()=>{
    const real=globalThis.WebAssembly;let constructed=0,terminated=0;
    vi.stubGlobal('WebAssembly',{Module:real.Module,Instance:class{exports:Record<string,unknown>;constructor(module:WebAssembly.Module){if(++constructed===2)throw new Error('blocked');const original=new real.Instance(module).exports;this.exports={...original,terminate:(x:number)=>{terminated++;return(original.terminate as(x:number)=>number)(x);}};}}});
    const model=baseModel('adapter.wasm-accumulator');model.nodes.push({...model.nodes.find(node=>node.id==='Block')!,id:'Other',label:'Other'});model.edges.push({id:'Other-input',source:{nodeId:'Input',portId:'out'},target:{nodeId:'Other',portId:'in'}},{id:'Other-reset',source:{nodeId:'Reset',portId:'out'},target:{nodeId:'Other',portId:'reset'}});const compiled=compileModel(model);
    expect(diagnostics(()=>createDiscreteMachine(compiled.nodes,compiled.stateIds,.5,0,()=>{}))).toBe('M14_ADAPTER_UNAVAILABLE');expect(terminated).toBe(1);
  });
  it('cleans up cancellation after exactly the last accepted observation',async()=>{
    const controller=new AbortController(),result=await runModel(compileModel(baseModel('adapter.wasm-accumulator')),{signal:controller.signal,onProgress:()=>controller.abort()});
    expect(result.status).toBe('cancelled');expect(result.samples).toHaveLength(1);expect(result.finalState).toEqual({Block:1});expect(result.adapterLifecycle).toEqual([{nodeId:'Block',profileId:'calcweave.wasm-accumulator-f64-v1',initialized:true,terminated:true,reason:'cancelled'}]);
  });
  it('keeps pure function bindings free of numerical state when a tick checkpoint restores',()=>{
    const compiled=compileModel(baseModel('adapter.wasm-accumulator')),machine=createDiscreteMachine(compiled.nodes,compiled.stateIds,.5,0,()=>{}),first=machine.evaluate(0,0),saved=machine.checkpoint();
    machine.transition(first,0);expect(machine.evaluate(1,.5).get('Block')!.out).toBe(5);machine.restore(saved);machine.transition(first,0);expect(machine.evaluate(1,.5).get('Block')!.out).toBe(5);
  });
});

describe('M14 bounded message deadline and producer journal',()=>{
  it('suppresses stale held identities but never lets priority bypass FIFO order',()=>{
    const node=adapter('adapter.entity-transport');let state=m14InitialMemory(node);const input:MessageSignal={kind:'messages',items:[{producer:'Sender',sequence:7,time:-99,priority:100,payload:3},{producer:'Other',sequence:0,time:8,priority:-100,payload:4}]};
    const read=(tick:number,value:MessageSignal=input,delay=0)=>m14Read(node,state,port=>port==='in'?value:delay,tick,tick*.5);
    state=read(0).publicationMemory;const released=read(1);expect((released.outputs.out as MessageSignal).items.map(item=>item.payload)).toEqual([3,4]);state=released.publicationMemory;
    expect((read(2,{kind:'messages',items:[{...input.items[0]!,sequence:6}]}).outputs.out as MessageSignal).items).toEqual([]);expect(state.m14Arrival).toBe(2);
  });
  it('bounds producer high-water journal at128 with no eviction that could replay a held batch',()=>{
    const node=adapter('adapter.entity-transport');node.parameters.overflow='drop-newest';let state=m14InitialMemory(node);
    for(const start of [0,64])state=m14Read(node,state,port=>port==='in'?batch(start,64):100, start/64,start/64).publicationMemory;
    expect(state.m14Seen).toHaveLength(128);const before=structuredClone(state);expect(diagnostics(()=>m14Read(node,state,port=>port==='in'?batch(128,1):100,2,2))).toBe('M14_ENTITY_PRODUCER_BUDGET');expect(state).toEqual(before);
  });
  it('checks finite physical deadline, negative duration and counter overflow before publication',()=>{
    const node=adapter('adapter.entity-transport'),state=m14InitialMemory(node);
    expect(diagnostics(()=>m14Read(node,state,port=>port==='in'?batch(0,1):-1,0,0))).toBe('M14_ENTITY_DELAY');expect(diagnostics(()=>m14Read(node,state,port=>port==='in'?batch(0,1):Number.MAX_VALUE,0,Number.MAX_VALUE))).toBe('M14_ENTITY_DEADLINE');
    const bad:M14Memory={...state,m14Arrival:Number.MAX_SAFE_INTEGER};expect(diagnostics(()=>m14Read(node,bad,port=>port==='in'?batch(0,1):0,0,0))).toBe('M14_STATE_COUNTER');expect(state).toEqual({m14Queue:[],m14Seen:[],m14Arrival:0});
  });
  it('uses arrival physical time and actual due grid, preserving embedded metadata time',()=>{
    const node=adapter('adapter.entity-transport'),initial=m14InitialMemory(node),value:MessageSignal={kind:'messages',items:[{producer:'Time',sequence:0,time:-10,priority:9,payload:5}]};
    const accepted=m14Read(node,initial,port=>port==='in'?value:.75,0,2),early=m14Read(node,accepted.publicationMemory,port=>port==='in'?value:.75,1,2.5),due=m14Read(node,early.publicationMemory,port=>port==='in'?value:.75,2,3);
    expect(early.outputs.out).toEqual({kind:'messages',items:[]});expect(due.outputs.out).toEqual(value);expect(accepted.publicationMemory.m14Queue![0]!.deadline).toBe(2.75);
  });
  it('does not enqueue twice on a repeated same-tick machine evaluation and owns its snapshots',()=>{
    const compiled=compileModel(baseModel('adapter.entity-transport')),machine=createDiscreteMachine(compiled.nodes,compiled.stateIds,.5,0,()=>{}),first=machine.evaluate(0,0);machine.evaluate(0,0,first);
    const memory=machine.stateMemory()!;expect((memory.Block as M14Memory).m14Arrival).toBe(2);(memory.Block as M14Memory).m14Queue![0]!.payload=999;expect((machine.stateMemory()!.Block as M14Memory).m14Queue![0]!.payload).toBe(10);
  });
});
