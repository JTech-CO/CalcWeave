import type { CalcModel, CalcNode, ExecutionMode } from '../packages/model/src';
export interface M15WasmFixture { name: string; model: CalcModel; expected: Record<string, number[]>; modes: ExecutionMode[]; exact?: boolean }
export interface M15WasmFailure { name: string; model: CalcModel; phase: 'target'|'runtime'; code: string; nodeId?: string; samples?: number; expectedPartial?: Record<string,number[]> }
const node = (id: string,blockType: string,parameters: Record<string,unknown>={},unit?: string): CalcNode => ({id,blockType,blockVersion:1,label:id,parameters,...(unit?{unit}:{})});
function model(name: string,nodes: CalcNode[],connections: [string,string,string][],mode: ExecutionMode='static',stopTime=0): CalcModel {
  return {schemaVersion:1,modelId:name,name,nodes,edges:connections.map(([source,target,portId],index)=>({id:`e${index}`,source:{nodeId:source,portId:'out'},target:{nodeId:target,portId}})),layout:Object.fromEntries(nodes.map((item,index)=>[item.id,{x:index*100,y:0}])),execution:{mode,startTime:0,stopTime,step:.5}};
}
const unary = (name: string,type: string,value: number,p: Record<string,unknown>,expected: number): M15WasmFixture => ({name,model:model(name,[node('input','io.input',{value}),node('op',type,p),node('output','sink.display')],[['input','op','in'],['op','output','in']]),expected:{output:[expected]},modes:['static','discrete'],exact:true});
const pair = (name: string,type: string,a: number,b: number,p: Record<string,unknown>,expected: number): M15WasmFixture => ({name,model:model(name,[node('a','source.constant',{value:a}),node('b','io.input',{value:b}),node('op',type,p),node('output','io.output')],[['a','op','a'],['b','op','b'],['op','output','in']]),expected:{output:[expected]},modes:['static','discrete'],exact:true});
export const M15_WASM_INDEPENDENT_FIXTURES: M15WasmFixture[] = [
  unary('wasm-gain','math.gain',-3,{gain:2},-6),
  unary('wasm-abs','math.abs',-3,{},3),
  unary('wasm-sqrt','math.sqrt',9,{},3),
  unary('wasm-square','math.function',-3,{operation:'square'},9),
  unary('wasm-reciprocal','math.function',4,{operation:'reciprocal'},.25),
  unary('wasm-min-reduce','math.minmax',3,{operation:'min',strategy:'reduce'},3),
  unary('wasm-max-reduce','math.minmax',3,{operation:'max',strategy:'reduce'},3),
  ...(['++','+-','-+','--'] as const).map((signs,index)=>pair(`wasm-sum-${index}`,'math.sum',2,3,{signs},[5,-1,1,-5][index]!)),
  pair('wasm-multiply','math.multiply',2,3,{operation:'multiply'},6),
  pair('wasm-divide','math.multiply',7,2,{operation:'divide'},3.5),
  pair('wasm-min-pair','math.minmax',2,3,{operation:'min',strategy:'pairwise'},2),
  pair('wasm-max-pair','math.minmax',2,3,{operation:'max',strategy:'pairwise'},3),
  {name:'wasm-time-grid',model:model('wasm-time-grid',[node('clock','source.clock'),node('ramp','source.ramp',{startTime:.5,slope:2,initial:-1}),node('step','source.step',{stepTime:.5,before:2,after:5}),node('clockOut','sink.scope'),node('rampOut','sink.display'),node('stepOut','io.output'),node('unused','io.terminator')],[['clock','clockOut','in'],['ramp','rampOut','in'],['step','stepOut','in'],['step','unused','in']],'discrete',1),expected:{clockOut:[0,.5,1],rampOut:[-1,-1,0],stepOut:[2,5,5]},modes:['discrete'],exact:true},
  {name:'wasm-physical-units',model:model('wasm-physical-units',[node('a','source.constant',{value:3},'m'),node('b','source.constant',{value:2},'m'),node('op','math.sum',{signs:'+-'}),node('output','sink.display')],[['a','op','a'],['b','op','b'],['op','output','in']]),expected:{output:[1]},modes:['static','discrete'],exact:true},
  {name:'wasm-signed-zero',model:model('wasm-signed-zero',[node('input','io.input',{value:0}),node('negative','math.gain',{gain:-1}),node('absolute','math.abs'),node('squareRoot','math.sqrt'),node('negativeOut','sink.display'),node('absoluteOut','sink.scope'),node('sqrtOut','io.output')],[['input','negative','in'],['negative','absolute','in'],['negative','squareRoot','in'],['negative','negativeOut','in'],['absolute','absoluteOut','in'],['squareRoot','sqrtOut','in']]),expected:{negativeOut:[-0],absoluteOut:[0],sqrtOut:[-0]},modes:['static','discrete'],exact:true},
  {name:'wasm-shared-dag',model:model('wasm-shared-dag',[node('input','io.input',{value:3}),node('gain','math.gain',{gain:2}),node('sum','math.sum',{signs:'++'}),node('one','sink.display'),node('two','sink.scope')],[['input','gain','in'],['gain','sum','a'],['gain','sum','b'],['gain','one','in'],['sum','two','in']]),expected:{one:[6],two:[12]},modes:['static','discrete'],exact:true},
];
const failureModel = (name: string,blockType: string,value: unknown,parameters: Record<string,unknown>={}) => model(name,[node('input','io.input',{value}),node('op',blockType,parameters),node('output','sink.display')],[['input','op','in'],['op','output','in']]);
const overflow = model('wasm-overflow',[node('ramp','source.ramp',{startTime:0,slope:1,initial:0}),node('op','math.gain',{gain:Number.MAX_VALUE}),node('output','sink.display')],[['ramp','op','in'],['op','output','in']],'discrete',2);
const crossingDivide = model('wasm-crossing-divide',[node('one','source.constant',{value:1}),node('ramp','source.ramp',{startTime:0,slope:1,initial:-1}),node('op','math.multiply',{operation:'divide'}),node('output','sink.display')],[['one','op','a'],['ramp','op','b'],['op','output','in']],'discrete',1.5);
const chain = (count: number,stopTime: number) => {
  const nodes=[node('input','io.input',{value:1}),...Array.from({length:count},(_,index)=>node(`gain${index}`,'math.gain',{gain:1})),node('output','sink.display')];
  return model(`wasm-chain-${count}`,nodes,Array.from({length:count+1},(_,index)=>[index===0?'input':`gain${index-1}`,index===count?'output':`gain${index}`,'in'] as [string,string,string]),'discrete',stopTime);
};
const outputLimit = model('wasm-output-budget',[node('input','io.input',{value:1}),...Array.from({length:17},(_,index)=>node(`output${index}`,'sink.display'))],Array.from({length:17},(_,index)=>['input',`output${index}`,'in'] as [string,string,string]));
const rate = {...unary('wasm-rate','math.gain',1,{gain:2},2).model,execution:{mode:'discrete' as const,startTime:0,stopTime:0,step:.5}}; rate.nodes[1]!.sampleTime={period:2,offset:0};rate.nodes[2]!.sampleTime={period:2,offset:0};
const typed = model('wasm-typed',[node('input','source.typed',{value:{kind:'typed',dtype:'float64',shape:[],data:[1]}}),node('output','sink.display')],[['input','output','in']]);
const unusedOverflow = model('wasm-unused-branch',[node('visible','source.constant',{value:7}),node('step','source.step',{stepTime:.5,before:0,after:2}),node('op','math.gain',{gain:Number.MAX_VALUE}),node('discard','io.terminator'),node('output','sink.display')],[['visible','output','in'],['step','op','in'],['op','discard','in']],'discrete',1);
M15_WASM_INDEPENDENT_FIXTURES.push({name:'wasm-64-node-boundary',model:chain(62,0),expected:{output:[1]},modes:['static','discrete'],exact:true});
M15_WASM_INDEPENDENT_FIXTURES.push({name:'wasm-16-output-boundary',model:model('wasm-16-output-boundary',[node('input','io.input',{value:7}),...Array.from({length:16},(_,index)=>node(`output${index}`,'sink.display'))],Array.from({length:16},(_,index)=>['input',`output${index}`,'in'] as [string,string,string])),expected:Object.fromEntries(Array.from({length:16},(_,index)=>[`output${index}`,[7]])),modes:['static','discrete'],exact:true});
export const M15_WASM_FAILURE_FIXTURES: M15WasmFailure[] = [
  {name:'wasm-sqrt-domain',model:failureModel('wasm-sqrt-domain','math.sqrt',-1),phase:'runtime',code:'NUMERIC_DOMAIN',nodeId:'op',samples:0,expectedPartial:{output:[]}},
  {name:'wasm-reciprocal-zero',model:failureModel('wasm-reciprocal-zero','math.function',0,{operation:'reciprocal'}),phase:'runtime',code:'NUMERIC_DIVIDE_BY_ZERO',nodeId:'op',samples:0,expectedPartial:{output:[]}},
  {name:'wasm-overflow',model:overflow,phase:'runtime',code:'NUMERIC_NONFINITE',nodeId:'op',samples:3,expectedPartial:{output:[0,Number.MAX_VALUE*.5,Number.MAX_VALUE]}},
  {name:'wasm-crossing-divide',model:crossingDivide,phase:'runtime',code:'NUMERIC_DIVIDE_BY_ZERO',nodeId:'op',samples:2,expectedPartial:{output:[-1,-2]}},
  {name:'wasm-unused-branch',model:unusedOverflow,phase:'runtime',code:'NUMERIC_NONFINITE',nodeId:'op',samples:1,expectedPartial:{output:[7]}},
  {name:'wasm-unsupported-function',model:failureModel('wasm-unsupported-function','math.function',2,{operation:'exp'}),phase:'target',code:'WASM_UNSUPPORTED_OPTION',nodeId:'op'},
  {name:'wasm-vector',model:failureModel('wasm-vector','math.abs',[1,2]),phase:'target',code:'WASM_SCALAR_REQUIRED'},
  {name:'wasm-boolean',model:model('wasm-boolean',[node('input','io.input',{value:true}),node('output','sink.display')],[['input','output','in']]),phase:'target',code:'WASM_SCALAR_REQUIRED'},
  {name:'wasm-state',model:{...failureModel('wasm-state','discrete.unit-delay',1,{initial:0,reset:'none'}),execution:{mode:'discrete',startTime:0,stopTime:0,step:.5}},phase:'target',code:'WASM_STATE_UNSUPPORTED',nodeId:'op'},
  {name:'wasm-node-budget',model:chain(63,0),phase:'target',code:'WASM_NODE_BUDGET'},
  {name:'wasm-output-budget',model:outputLimit,phase:'target',code:'WASM_OUTPUT_BUDGET'},
  {name:'wasm-work-budget',model:chain(62,5000),phase:'target',code:'WASM_OPERATION_BUDGET'},
  {name:'wasm-rate',model:rate,phase:'target',code:'WASM_RATE_UNSUPPORTED',nodeId:'op'},
  {name:'wasm-typed',model:typed,phase:'target',code:'WASM_SCALAR_REQUIRED'},
  {name:'wasm-continuous',model:{...unary('wasm-continuous','math.abs',1,{},1).model,execution:{mode:'continuous',startTime:0,stopTime:1,step:.5}},phase:'target',code:'WASM_UNSUPPORTED_MODE'},
];
export function m15WasmMode(entry: M15WasmFixture,mode: ExecutionMode): CalcModel { const result=structuredClone(entry.model); result.execution.mode=mode; if(mode==='static') result.execution.stopTime=result.execution.startTime; return result; }
