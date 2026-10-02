import { importDataset } from '../packages/data/src';
import { hierarchyNodeId } from '../packages/compiler/src/hierarchy';
import type { CalcModel, CalcNode, ExecutionMode, SignalValue, SubsystemDefinition } from '../packages/model/src';

export interface M4Oracle {
  id: string;
  model: CalcModel;
  reference: string;
  tolerance: number;
  expected: Record<string, (time: number, index: number) => SignalValue>;
  expectedUnits?: Record<string, string>;
  expectedFinalState?: Record<string, SignalValue>;
  flatReference?: CalcModel;
}
export function m4Graph(id: string, mode: ExecutionMode = 'discrete', stop = 1, step = 0.1): CalcModel {
  return { schemaVersion: 1, modelId: id, name: id, nodes: [], edges: [], layout: {}, execution: { mode, startTime: 0, stopTime: stop, step,
    ...(mode === 'continuous' ? { solver: { method: 'rk4', initialStep: 0.08, minStep: 1e-10, maxStep: 0.08, discreteStep: 0.1 } } : {}) } };
}
export function m4Node(model: CalcModel, id: string, blockType: string, parameters: Record<string, unknown> = {}, unit?: string, period?: number, offset = 0): void {
  model.nodes.push({ id, blockType, blockVersion: 1, label: id, parameters, ...(unit ? { unit } : {}), ...(period ? { sampleTime: { period, offset } } : {}) });
}
export function m4Wire(model: CalcModel, source: string, target: string, targetPort = 'in', sourcePort = 'out'): void {
  model.edges.push({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });
}
function scope(model: CalcModel, source: string, id = 'result', period?: number, offset = 0): void {
  m4Node(model, id, 'sink.scope', {}, undefined, period, offset); m4Wire(model, source, id);
}
function playback(model: CalcModel, text: string, options: { timeUnit?: string; valueUnit?: string; kind?: 'number' | 'boolean'; interpolation?: 'linear' | 'previous'; outside?: 'hold' | 'zero' | 'error'; period?: number } = {}): void {
  model.datasets = [importDataset(text, { id: 'data', name: '독립 계산 기준 자료', format: 'csv', timeColumn: 'time', columns: [{ name: 'time', kind: 'number', unit: options.timeUnit ?? 's' }, { name: 'value', kind: options.kind ?? 'number', unit: options.valueUnit ?? '1' }] })];
  m4Node(model, 'input', 'source.dataset', { datasetId: 'data', column: 'value', interpolation: options.interpolation ?? 'linear', outside: options.outside ?? 'hold' }, undefined, options.period);
}
export function datasetRangeFailure(): CalcModel {
  const model = m4Graph('F04-failure-outside-error', 'continuous'); model.execution.startTime = 0.2;
  playback(model, 'time,value\n0.2,2\n0.8,8', { outside: 'error' }); scope(model, 'input'); return model;
}
export function m4SweepModel(): CalcModel {
  const model = m4Graph('F04-sweep-linear-integral', 'continuous'); playback(model, 'time,value\n0,1\n1,3');
  m4Node(model, 'gain', 'math.gain', { gain: 1 }); m4Node(model, 'integral', 'continuous.integrator');
  m4Wire(model, 'input', 'gain'); m4Wire(model, 'gain', 'integral'); scope(model, 'integral'); return model;
}
export function m4SharedBudgetModel(): CalcModel {
  const model = m4Graph('F04-sweep-shared-budget', 'static'); m4Node(model, 'input', 'source.constant', { value: 2 }); m4Node(model, 'gain', 'math.gain', { gain: 1 });
  m4Wire(model, 'input', 'gain'); scope(model, 'gain'); return model;
}
export function m4Oracles(): M4Oracle[] {
  const fixtures: M4Oracle[] = [];
  const add = (model: CalcModel, reference: string, expected: M4Oracle['expected'], extra: Partial<M4Oracle> = {}): void => { fixtures.push({ id: model.modelId, model, reference, expected, tolerance: 1e-11, ...extra }); };
  {
    const model = m4Graph('F04-static-playback-notes', 'static'); playback(model, 'time,value\n0,3\n1,7'); scope(model, 'input');
    m4Node(model, 'note', 'annotation.note', { text: '<script>ordinary escaped text</script>' }); m4Node(model, 'info', 'annotation.model-info');
    add(model, 'Static playback reads its start-time table value 3. DocBlock/ModelInfo have no numerical output and cannot change execution semantics.', { result: () => 3 });
  }
  {
    const model = m4Graph('F04-linear-playback'); playback(model, 'time,value\n0,1\n1,3'); scope(model, 'input');
    add(model, 'Linear table through (0,1),(1,3): y(t)=2t+1 at every raw output sample.', { result: (t) => 2 * t + 1 });
  }
  {
    const model = m4Graph('F04-linear-stage-integral', 'continuous'); playback(model, 'time,value\n0,1\n1,3'); m4Node(model, 'integral', 'continuous.integrator'); m4Wire(model, 'input', 'integral'); scope(model, 'integral');
    add(model, 'Integral of y(t)=2t+1 gives x(t)=t^2+t; actual RK stage times must read the interpolated dataset.', { result: (t) => t * t + t });
  }
  {
    const model = m4Graph('F04-previous-off-grid-integral', 'continuous'); playback(model, 'time,value\n0,1\n0.37,3\n1,3', { interpolation: 'previous' }); m4Node(model, 'integral', 'continuous.integrator'); m4Wire(model, 'input', 'integral'); scope(model, 'integral');
    add(model, 'Previous table jumps from 1 to 3 at t=.37; x(t)=t+2*max(0,t-.37), solved at the off-grid knot with a one-sided RHS.', { result: (t) => t + 2 * Math.max(0, t - 0.37) }, { tolerance: 2e-9 });
  }
  {
    const model = m4Graph('F04-outside-hold', 'continuous'); playback(model, 'time,value\n0.2,2\n0.8,8'); scope(model, 'input', 'signal'); m4Node(model, 'integral', 'continuous.integrator'); m4Wire(model, 'input', 'integral'); scope(model, 'integral');
    add(model, 'Hold outside [.2,.8]: y=2 before,10t inside,8 afterward. Exact accumulated area is 2t;5t^2+.2;3.4+8(t-.8).', {
      signal: (t) => t < 0.2 ? 2 : t > 0.8 ? 8 : 10 * t,
      result: (t) => t <= 0.2 ? 2 * t : t <= 0.8 ? 5 * t * t + 0.2 : 3.4 + 8 * (t - 0.8),
    }, { tolerance: 2e-9 });
  }
  {
    const model = m4Graph('F04-outside-zero', 'continuous'); playback(model, 'time,value\n0.25,2.5\n0.75,7.5', { outside: 'zero' }); scope(model, 'input', 'signal'); m4Node(model, 'integral', 'continuous.integrator'); m4Wire(model, 'input', 'integral'); scope(model, 'integral');
    add(model, 'Zero outside [.25,.75]: y=10t inside and 0 outside. Integral x=0 before .25,5(t^2-.25^2) inside,2.5 after .75.', {
      signal: (t) => t < 0.25 || t > 0.75 ? 0 : 10 * t,
      result: (t) => t <= 0.25 ? 0 : t <= 0.75 ? 5 * (t * t - 0.25 ** 2) : 2.5,
    }, { tolerance: 2e-9 });
  }
  {
    const model = m4Graph('F04-outside-zero-delayed-jump', 'continuous', 1.1, 0.05); playback(model, 'time,value\n0.25,2.5\n0.75,7.5', { outside: 'zero' });
    m4Node(model, 'delay', 'time.transport-delay', { delay: 0.2 }); m4Wire(model, 'input', 'delay'); scope(model, 'input', 'raw'); scope(model, 'delay', 'delayed');
    m4Node(model, 'integral', 'continuous.integrator'); m4Wire(model, 'delay', 'integral'); scope(model, 'integral');
    add(model, 'Raw table retains lastpoint y(.75)=7.5 but stores a right-limit0 afterward. TransportDelay .2 reproduces jumps at .45/.95: delayed=10(t-.2) on [.45,.95),0 outside, accumulated area2.5 after .95.', {
      raw: (t) => t < 0.25 || t > 0.75 ? 0 : 10 * t,
      delayed: (t) => t < 0.45 - 1e-12 || t >= 0.95 - 1e-12 ? 0 : 10 * (t - 0.2),
      result: (t) => t <= 0.45 ? 0 : t <= 0.95 ? 5 * ((t - 0.2) ** 2 - 0.25 ** 2) : 2.5,
    }, { tolerance: 2e-9 });
  }
  for (const mode of ['discrete', 'continuous'] as const) {
    const model = m4Graph(`F04-boolean-previous-${mode}`, mode, 0.6); playback(model, 'time,value\n0,false\n0.15,true\n0.35,false\n0.55,true', { kind: 'boolean', interpolation: 'previous', period: 2 }); scope(model, 'input', 'result', 2);
    add(model, 'Boolean previous playback is published only on P2 base ticks (.2s): [false,false,true,true,false,false,true]. No interpolation/coercion.', { result: (_t, index) => [false, false, true, true, false, false, true][index]! });
  }
  {
    const model = m4Graph('F04-millisecond-time'); playback(model, 'time,value\n0,1\n1000,3', { timeUnit: 'ms' }); scope(model, 'input');
    add(model, '1000ms is normalized to one second, yielding y=2t+1 while preserving ms table provenance.', { result: (t) => 2 * t + 1 });
  }
  {
    const model = m4Graph('F04-centimeter-conversion', 'static'); m4Node(model, 'input', 'source.constant', { value: [125, 250] }, 'cm'); m4Node(model, 'convert', 'unit.convert', { from: 'cm', to: 'm' }); m4Wire(model, 'input', 'convert'); scope(model, 'convert');
    add(model, 'Explicit scale .01 turns [125,250]cm into [1.25,2.5]m without changing shape.', { result: () => [1.25, 2.5] }, { expectedUnits: { result: 'm' } });
  }
  {
    const model = m4Graph('F04-celsius-kelvin', 'static'); m4Node(model, 'input', 'source.constant', { value: [0, 100, -40] }, 'C'); m4Node(model, 'convert', 'unit.convert', { from: 'C', to: 'K' }); m4Wire(model, 'input', 'convert'); scope(model, 'convert');
    add(model, 'Affine temperature conversion K=C+273.15 gives [273.15,373.15,233.15]; temperature dimensions are retained.', { result: () => [273.15, 373.15, 233.15] }, { expectedUnits: { result: 'K' } });
  }
  {
    const model = m4Graph('F04-area-dimension', 'static'); m4Node(model, 'width', 'source.constant', { value: 2 }, 'm'); m4Node(model, 'height', 'source.constant', { value: 3 }, 'm'); m4Node(model, 'area', 'math.multiply'); m4Wire(model, 'width', 'area', 'a'); m4Wire(model, 'height', 'area', 'b'); scope(model, 'area');
    add(model, '2m * 3m = 6m^2; approved dimension algebra retains both the value and area dimension.', { result: () => 6 }, { expectedUnits: { result: 'm^2' } });
  }
  {
    const model = m4Graph('F04-power-dimension', 'static'); m4Node(model, 'force', 'source.constant', { value: 2 }, 'N'); m4Node(model, 'distance', 'source.constant', { value: 3 }, 'm'); m4Node(model, 'time', 'source.constant', { value: 2 }, 's'); m4Node(model, 'work', 'math.multiply'); m4Node(model, 'power', 'math.multiply', { operation: 'divide' }); m4Wire(model, 'force', 'work', 'a'); m4Wire(model, 'distance', 'work', 'b'); m4Wire(model, 'work', 'power', 'a'); m4Wire(model, 'time', 'power', 'b'); scope(model, 'power');
    add(model, '(2N*3m)/2s = 3W; composed approved dimensions N*m=J and J/s=W.', { result: () => 3 }, { expectedUnits: { result: 'W' } });
  }
  {
    const model = m4Graph('F04-named-numeric-bus', 'static'); m4Node(model, 'a', 'source.constant', { value: 3 }, 'm'); m4Node(model, 'b', 'source.constant', { value: 7 }, 'm'); m4Node(model, 'bus', 'route.bus-create', { first: 'firstValue', second: 'secondValue' }); m4Node(model, 'select', 'route.bus-select', { field: 'secondValue' }); m4Wire(model, 'a', 'bus', 'a'); m4Wire(model, 'b', 'bus', 'b'); m4Wire(model, 'bus', 'select'); scope(model, 'bus', 'bus-view'); scope(model, 'select');
    add(model, 'Named homogeneous scalar bus stores [3,7]m with firstValue/secondValue; selecting secondValue returns 7m.', { 'bus-view': () => [3, 7], result: () => 7 }, { expectedUnits: { 'bus-view': 'm', result: 'm' } });
  }
  {
    const model = m4Graph('F04-named-boolean-bus', 'static'); m4Node(model, 'a', 'source.constant', { value: false }); m4Node(model, 'b', 'source.constant', { value: true }); m4Node(model, 'bus', 'route.bus-create', { first: 'enabled', second: 'ready' }); m4Node(model, 'select', 'route.bus-select', { field: 'ready' }); m4Wire(model, 'a', 'bus', 'a'); m4Wire(model, 'b', 'bus', 'b'); m4Wire(model, 'bus', 'select'); scope(model, 'select');
    add(model, 'Named boolean bus preserves booleans [false,true]; the ready field produces true.', { result: () => true });
  }
  {
    const model = m4Graph('F04-repeated-state-subsystems', 'discrete', 0.4);
    const local = m4Graph('local'); m4Node(local, 'input', 'io.input', { value: -999 }); m4Node(local, 'delay', 'discrete.unit-delay', { initial: 0 }, undefined, 2, 1); m4Node(local, 'output', 'io.output'); m4Wire(local, 'input', 'delay'); m4Wire(local, 'delay', 'output');
    const definition: SubsystemDefinition = { id: 'delayDef', version: 1, name: '같은 지연 정의', nodes: local.nodes, edges: local.edges, layout: {}, inputs: [{ id: 'in', nodeId: 'input' }], outputs: [{ id: 'out', nodeId: 'output' }] };
    model.subsystems = [definition];
    for (const [id, value] of [['first', 2], ['second', 5]] as const) { m4Node(model, `${id}-input`, 'source.constant', { value }); m4Node(model, id, 'hierarchy.subsystem', { definitionId: definition.id, version: 1 }); m4Wire(model, `${id}-input`, id); scope(model, id, `${id}-view`, 2, 1); }
    const flat = m4Graph('F04-repeated-state-flat', 'discrete', 0.4);
    for (const [id, value] of [['first', 2], ['second', 5]] as const) { m4Node(flat, `${id}-input`, 'source.constant', { value }); m4Node(flat, hierarchyNodeId([id], 'delay'), 'discrete.unit-delay', { initial: 0 }, undefined, 2, 1); m4Wire(flat, `${id}-input`, hierarchyNodeId([id], 'delay')); scope(flat, hierarchyNodeId([id], 'delay'), `${id}-view`, 2, 1); }
    add(model, 'Two instances of the same P2/O1 UnitDelay definition have independent states. Samples first=[0,0,0,2,2], second=[0,0,0,5,5]; hand-built flat equations are the reference.', { 'first-view': (_t, index) => [0, 0, 0, 2, 2][index]!, 'second-view': (_t, index) => [0, 0, 0, 5, 5][index]! }, { flatReference: flat, expectedFinalState: { [hierarchyNodeId(['first'], 'delay')]: 2, [hierarchyNodeId(['second'], 'delay')]: 5 } });
  }
  {
    const model = m4Graph('F04-dataset-inside-subsystem', 'continuous'); playback(model, 'time,value\n0,1\n1,3'); model.nodes = [];
    const local = m4Graph('local'); m4Node(local, 'data', 'source.dataset', { datasetId: 'data', column: 'value', interpolation: 'linear', outside: 'hold' }); m4Node(local, 'gain', 'math.gain', { gain: 2 }); m4Node(local, 'output', 'io.output'); m4Wire(local, 'data', 'gain'); m4Wire(local, 'gain', 'output');
    model.subsystems = [{ id: 'playbackDef', version: 1, name: '데이터 처리', nodes: local.nodes, edges: local.edges, layout: {}, inputs: [], outputs: [{ id: 'out', nodeId: 'output' }] }];
    m4Node(model, 'box', 'hierarchy.subsystem', { definitionId: 'playbackDef', version: 1 }); scope(model, 'box');
    add(model, 'Dataset references survive subsystem expansion. Internal gain2 applies y(t)=2*(2t+1)=4t+2; both data and hierarchy manifest references are retained.', { result: (t) => 4 * t + 2 });
  }
  return fixtures;
}
