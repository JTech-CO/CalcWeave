import type { CalcEdge, CalcModel, CalcNode, SignalValue } from '../packages/model/src';

export function m2Node(id: string, blockType: string, parameters: Record<string, unknown> = {}, period = 1, offset = 0, unit?: string): CalcNode {
  return { id, blockType, blockVersion: 1, label: id, parameters, sampleTime: { period, offset }, ...(unit ? { unit } : {}) };
}
export function m2Edge(source: string, target: string, port = 'in'): CalcEdge {
  return { id: source + '-' + target + '-' + port, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } };
}
export function m2Model(nodes: CalcNode[], edges: CalcEdge[], stopTime = 5, step = 1, startTime = 0): CalcModel {
  return { schemaVersion: 1, modelId: 'm2-engine-fixture', name: 'M2 engine fixture', nodes, edges, execution: { mode: 'discrete', startTime, stopTime, step }, layout: {} };
}
export function m2Unary(blockType: string, parameters: Record<string, unknown>, input: SignalValue = 1, stopTime = 5, step = 1): CalcModel {
  return m2Model([m2Node('input', 'source.constant', { value: input }), m2Node('operation', blockType, parameters), m2Node('result', 'sink.display')], [m2Edge('input', 'operation'), m2Edge('operation', 'result')], stopTime, step);
}
function source(blockType: string, parameters: Record<string, unknown> = {}, stopTime = 5, step = 1, startTime = 0): CalcModel {
  return m2Model([m2Node('source', blockType, parameters), m2Node('result', 'sink.scope')], [m2Edge('source', 'result')], stopTime, step, startTime);
}
type Fixture = { name: string; model: CalcModel; expected: SignalValue[] };
export const M2_ENGINE_FIXTURES: Fixture[] = [
  { name: 'absolute-time Step', model: source('source.step', { stepTime: 2, before: -1, after: 3 }), expected: [-1,-1,3,3,3,3] },
  { name: 'absolute-time Ramp', model: source('source.ramp', { startTime: 2, slope: 3, initial: 1 }), expected: [1,1,1,4,7,10] },
  { name: 'Sine Wave uses Hz and absolute time', model: source('source.sine-wave', { amplitude: 2, frequency: .25, phase: 0, bias: 1 }, 1, .25), expected: [1,1+2*Math.sin(Math.PI/8),1+Math.SQRT2,1+2*Math.sin(3*Math.PI/8),3] },
  { name: 'Pulse uses base ticks including phase', model: source('source.pulse', { amplitude: 2, period: 4, width: 2, phase: 1 }), expected: [0,2,2,0,0,2] },
  { name: 'Clock returns the simulation time', model: source('source.clock', {}, 1, .25), expected: [0,.25,.5,.75,1] },
  { name: 'Digital Clock initial hold and period/offset', model: m2Model([m2Node('source','source.digital-clock',{},2,1),m2Node('result','sink.scope',{},2,1)], [m2Edge('source','result')]), expected: [0,1,1,3,3,5] },
  { name: 'Repeating Sequence linear interpolation and exact wrap', model: source('source.repeating-sequence',{times:[0,1,2],values:[0,2,0],interpolation:'linear'}, 3,.5), expected: [0,1,2,1,0,1,2] },
  { name: 'Repeating Sequence previous interpolation', model: source('source.repeating-sequence',{times:[0,1,2],values:[0,2,0],interpolation:'previous'}, 3,.5), expected: [0,0,2,2,0,0,2] },
  { name: 'Repeating Sequence negative absolute time', model: source('source.repeating-sequence',{times:[0,1,2],values:[0,2,0]}, 1,.5,-1), expected: [2,1,0,1,2] },
  { name: 'Unit Delay vector state', model: m2Unary('discrete.unit-delay',{initial:[0,0]},[3,4],2),expected:[[0,0],[3,4],[3,4]] },
  { name: 'Unit Delay boolean matrix state', model: m2Unary('discrete.unit-delay',{initial:[[false,true]]},[[true,false]],2),expected:[[[false,true]],[[true,false]],[[true,false]]] },
  { name: 'Fixed Delay FIFO', model: m2Unary('discrete.delay',{steps:2,initial:0},3,3),expected:[0,0,3,3] },
  { name: 'Forward Euler vector independent channels', model: m2Unary('discrete.integrator',{initial:[0,1],gain:2},[1,2],1,.25),expected:[[0,1],[.5,2],[1,3],[1.5,4],[2,5]] },
  { name: 'Difference first and subsequent due samples', model:m2Unary('discrete.difference',{initial:2},5,2),expected:[3,0,0] },
  { name: 'Derivative divides by sample seconds', model:m2Unary('discrete.derivative',{initial:1},5,1,.5),expected:[8,0,0] },
  { name:'FIR impulse response', model:m2Model([m2Node('input','source.pulse',{period:10,width:1}),m2Node('operation','discrete.fir',{coefficients:[.25,.5,.25]}),m2Node('result','sink.scope')],[m2Edge('input','operation'),m2Edge('operation','result')]), expected:[.25,.5,.25,0,0,0] },
  { name:'FIR matrix independent channels', model:m2Unary('discrete.fir',{coefficients:[1,2],initial:[[0,0],[0,0]]},[[1,2],[3,4]],2), expected:[[[1,2],[3,4]],[[3,6],[9,12]],[[3,6],[9,12]]] },
  { name:'Transfer function z inverse impulse',model:m2Model([m2Node('input','source.pulse',{period:10,width:1}),m2Node('operation','discrete.transfer-function',{numerator:[1],denominator:[1,-.5]}),m2Node('result','sink.scope')],[m2Edge('input','operation'),m2Edge('operation','result')]),expected:[1,.5,.25,.125,.0625,.03125] },
  { name:'Strictly proper transfer reads old history',model:m2Unary('discrete.transfer-function',{numerator:[0,1],denominator:[1,-.5]},1,3),expected:[0,1,1.5,1.75] },
  { name:'State Space initial state then commit',model:m2Unary('discrete.state-space',{A:[[.5]],B:[1],C:[1],D:0,initial:[0]},1,3),expected:[0,1,1.5,1.75] },
  { name:'State Space D direct feedthrough',model:m2Unary('discrete.state-space',{A:[[.5]],B:[1],C:[2],D:3,initial:[1]},1,2),expected:[5,6,6.5] },
  { name:'Rising boolean edge',model:m2Unary('logic.edge-detect',{mode:'rising',initial:false},true,2),expected:[true,false,false] },
  { name:'Falling boolean edge',model:m2Unary('logic.edge-detect',{mode:'falling',initial:true},false,2),expected:[true,false,false] },
  { name:'Either boolean edge',model:m2Unary('logic.edge-detect',{mode:'either',initial:false},true,2),expected:[true,false,false] },
  { name:'Lookup linear array and clipped boundaries',model:m2Unary('lookup.interpolated',{breakpoints:[0,1,2],values:[0,10,0]},[-1,.5,1,1.5,3],0),expected:[[0,5,10,5,0]] },
  { name:'Lookup previous interpolation exact knot',model:m2Unary('lookup.interpolated',{breakpoints:[0,1,2],values:[0,10,0],interpolation:'previous'},[.5,1,1.5,2],0),expected:[[0,10,10,0]] },
  { name:'timeless Constant publication respects its explicit rate',model:m2Model([m2Node('source','source.constant',{value:3},5,2),m2Node('boundary','time.rate-transition',{initial:-1}),m2Node('result','sink.scope')],[m2Edge('source','boundary'),m2Edge('boundary','result')]),expected:[-1,-1,-1,3,3,3] },
];

export function rateTransitionFixture(producerPeriod: number, consumerPeriod: number, producerOffset = 0, consumerOffset = 0): CalcModel {
  return m2Model([
    m2Node('source','source.digital-clock',{},producerPeriod,producerOffset),
    m2Node('boundary','time.rate-transition',{initial:-1},consumerPeriod,consumerOffset,'s'),
    m2Node('result','sink.scope',{},consumerPeriod,consumerOffset),
  ],[m2Edge('source','boundary'),m2Edge('boundary','result')],10);
}

export function seededFixture(distribution: 'uniform'|'normal', seed = 1, period = 1, offset = 0): CalcModel {
  return m2Model([m2Node('source','source.random',{distribution,seed},period,offset),m2Node('result','sink.scope',{},period,offset)],[m2Edge('source','result')]);
}

export function unsignedFixture(operation: string, a: number, b = 0, width = 8, shift = 1): CalcModel {
  const unary = ['not','shift-left','shift-right'].includes(operation);
  return m2Model([m2Node('a','source.constant',{value:a}),...(unary?[]:[m2Node('b','source.constant',{value:b})]),m2Node('operation','logic.bitwise',{operation,width,shift}),m2Node('result','sink.scope')],
    [m2Edge('a','operation','a'),...(unary?[]:[m2Edge('b','operation','b')]),m2Edge('operation','result')],0);
}
