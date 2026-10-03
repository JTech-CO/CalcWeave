import type { CalcEdge, CalcModel, CalcNode, ExecutionMode, SignalValue, StateValue, SubsystemDefinition } from '../packages/model/src/types';
// Independent literal lifecycle oracles. Expected values do not call runtime/model helpers.
export const M11_LITERAL_ORACLES = {
  enabledHold: [1, 1, 1, 2, 3],
  enabledReset: [1, 1, 1, 1, 2],
  triggeredRising: [1, 1, 1, 2, 2],
  triggeredEither: [1, 1, 2, 3, 4],
  resetBeforeCall: [1, 2, 1, 2, 3],
  sameTimeCalls: [3, 6, 9],
  forCarry: [6, 12],
  forReset: [3, 3],
  whileFinite: [3, 3],
  foreach: [[1, 10], [2, 20], [3, 30]],
  pixel: [[[1, 10], [100, 1000]], [[2, 20], [200, 2000]]],
  initialize: [1, 1, 1, 1],
  reinitialize: [1, 1, 1, 1, 1],
  resetFunction: [1, 1, 1, 2, 2],
  terminate: [0, 0, 0, 1],
  callRate: [2, 2, 4, 4, 6],
} as const;

export interface M11IndependentFixture { name: string; model: CalcModel; expected: Record<string, SignalValue[]>; declaredModes: ExecutionMode[]; expectedFinalState?: Record<string, SignalValue>; expectedStateMemory?: Record<string, StateValue>; presetId?: string; sourceIds?: string[] }
const fn = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const fe = (source: string, target: string, port = 'in', output = 'out'): CalcEdge => ({ id: `${source}-${output}-${target}-${port}`, source: { nodeId: source, portId: output }, target: { nodeId: target, portId: port } });
const exact: SignalValue = { kind: 'typed', dtype: 'uint64', shape: [], data: ['9007199254740993'] };
const structuredBus: SignalValue = { kind: 'bus', fields: [{ name: 'exact', value: exact }, { name: 'flag', value: true }] };
const fm = (payload: SignalValue, producer = 'Producer', sequence = 0, time = 0, priority = 0): SignalValue => ({ kind: 'messages', items: [{ producer, sequence, time, priority, payload }] });
function fg(name: string, nodes: CalcNode[], edges: CalcEdge[], subsystems?: SubsystemDefinition[], steps = 3): CalcModel { return { schemaVersion: 1, modelId: name, name, nodes, edges, layout: {}, ...(subsystems ? { subsystems } : {}), execution: { mode: 'discrete', startTime: 0, stopTime: steps - 1, step: 1 } }; }
function definition(id = 'Child', kind = 'accumulator', iteration = false): SubsystemDefinition {
  const nodes = [fn('Input', 'io.structured-input', { value: 0 }), fn('Output', 'io.structured-output')], edges: CalcEdge[] = [];
  if (kind === 'accumulator' || kind === 'while') { nodes.push(fn('Delay', 'discrete.unit-delay', { initial: 0 }), fn('Sum', 'math.sum')); edges.push(fe('Input', 'Sum', 'a'), fe('Delay', 'Sum', 'b'), fe('Sum', 'Delay'), fe('Sum', 'Output')); }
  else { nodes.push(fn('Compute', kind === 'neighborhood' ? 'reduce.sum' : 'math.gain', { ...(kind === 'neighborhood' ? {} : { gain: kind === 'inactive' ? 10 : 2 }) })); edges.push(fe('Input', 'Compute'), fe('Compute', 'Output')); }
  const outputs = [{ id: 'out', nodeId: 'Output' }];
  if (kind === 'while') { nodes.push(fn('Continue', 'hierarchy.if', { comparison: 'lt', threshold: 3 }), fn('ContinueOutput', 'io.structured-output')); edges.push(fe('Sum', 'Continue'), fe('Continue', 'ContinueOutput', 'in', 'then')); outputs.push({ id: 'continue', nodeId: 'ContinueOutput' }); }
  return { id, version: 1, name: id, nodes, edges, layout: {}, inputs: [{ id: iteration ? 'iteration' : 'in', nodeId: 'Input' }], outputs };
}
function operationFixture(type: string, inputs: Record<string, SignalValue>, outputs: Record<string, SignalValue[]>, parameters: Record<string, unknown> = {}): M11IndependentFixture {
  const name = `m11-independent-${type.replaceAll('.', '-')}`, nodes = Object.entries(inputs).map(([port, value]) => fn(`Source_${port}`, 'source.signal', { value })), edges = Object.keys(inputs).map(port => fe(`Source_${port}`, 'Operation', port));
  nodes.push(fn('Operation', type, parameters));
  const terminal = type === 'sink.sequence-viewer' || type === 'io.structured-output';
  if (!terminal) for (const port of Object.keys(outputs)) { nodes.push(fn(`Result_${port}`, 'sink.scope')); edges.push(fe('Operation', `Result_${port}`, 'in', port)); }
  const pure = ['source.signal', 'functions.typed', 'hierarchy.if', 'hierarchy.switch-case', 'route.structured-bus', 'route.structured-select', 'route.structured-assign', 'events.message-merge', 'events.function-call-split', 'sink.sequence-viewer', 'io.structured-input', 'io.structured-output'].includes(type);
  return { name, model: fg(name, nodes, edges), expected: Object.fromEntries(Object.entries(outputs).map(([port, values]) => [terminal ? 'Operation' : `Result_${port}`, values])), declaredModes: pure ? ['static', 'discrete', 'continuous'] : ['discrete', 'continuous'] };
}
const repeated = (value: SignalValue): SignalValue[] => [value, value, value];
function scopeFixture(type: string): M11IndependentFixture {
  const name = `m11-independent-${type.replaceAll('.', '-')}`, forLoop = type === 'hierarchy.for-iterator', whileLoop = type === 'hierarchy.while-iterator', array = ['hierarchy.for-each', 'hierarchy.array-processing', 'hierarchy.pixel-processing', 'hierarchy.neighborhood-processing'].includes(type);
  const child = definition('Child', whileLoop ? 'while' : type === 'hierarchy.neighborhood-processing' ? 'neighborhood' : array && type === 'hierarchy.array-processing' ? 'double' : 'accumulator', forLoop);
  const parameters: Record<string, unknown> = { definitionId: 'Child', ...(forLoop ? { count: 3 } : {}), ...(whileLoop ? { maxIterations: 4 } : {}) }, nodes = [fn('Operation', type, parameters), fn('Result_out', 'sink.scope')], edges = [fe('Operation', 'Result_out')], subsystems = [child];
  if (type === 'hierarchy.variant') { parameters.alternateDefinitionId = 'Inactive'; subsystems.push(definition('Inactive', 'inactive')); }
  if (!forLoop) { const value = type === 'hierarchy.for-each' ? [1, 10] : type === 'hierarchy.array-processing' ? [[1, 2], [3, 4]] : type === 'hierarchy.pixel-processing' ? [[1, 10], [100, 1000]] : type === 'hierarchy.neighborhood-processing' ? [[1, 2], [3, 4]] : 1; nodes.unshift(fn('Source_in', 'source.signal', { value })); edges.push(fe('Source_in', 'Operation')); }
  const controls: Record<string, SignalValue> = type === 'hierarchy.enabled' ? { enable: 1 } : type === 'hierarchy.triggered' ? { trigger: true } : type === 'hierarchy.enabled-triggered' ? { enable: 1, trigger: true } : type === 'hierarchy.resettable' ? { reset: false } : type === 'hierarchy.action' ? { action: true } : type === 'hierarchy.function-call' ? { call: 2 } : whileLoop ? { condition: true } : ['functions.reinitialize', 'functions.reset'].includes(type) ? { reset: true } : {};
  for (const [port, value] of Object.entries(controls)) { nodes.unshift(fn(`Source_${port}`, 'source.signal', { value })); edges.push(fe(`Source_${port}`, 'Operation', port)); }
  const expected: SignalValue[] = type === 'hierarchy.function-call' ? [2, 4, 6] : forLoop ? [3, 6, 9] : whileLoop ? [3, 4, 5] : ['hierarchy.triggered', 'hierarchy.enabled-triggered', 'functions.initialize', 'functions.reinitialize', 'functions.reset'].includes(type) ? [1, 1, 1] : type === 'functions.terminate' ? [0, 0, 1] : type === 'hierarchy.for-each' ? [[1, 10], [2, 20], [3, 30]] : type === 'hierarchy.array-processing' ? repeated([[2, 4], [6, 8]]) : type === 'hierarchy.pixel-processing' ? [[[1, 10], [100, 1000]], [[2, 20], [200, 2000]], [[3, 30], [300, 3000]]] : type === 'hierarchy.neighborhood-processing' ? repeated([[18, 21], [24, 27]]) : [1, 2, 3];
  return { name, model: fg(name, nodes, edges, subsystems), expected: { Result_out: expected }, declaredModes: ['discrete', 'continuous'] };
}
function namedFixture(type: string): M11IndependentFixture {
  const name = `m11-independent-${type.replaceAll('.', '-')}`, nodes: CalcNode[] = [], edges: CalcEdge[] = [], expected = repeated(7);
  if (type === 'functions.element') { nodes.push(fn('Operation', type, { definitionId: 'Child', name: 'Accumulate' }), fn('Caller', 'functions.call', { definitionId: 'Child' }), fn('Source', 'source.constant', { value: 1 }), fn('Result', 'sink.scope')); edges.push(fe('Source', 'Caller'), fe('Caller', 'Result')); return { name, model: fg(name, nodes, edges, [definition()]), expected: { Result: [1, 2, 3] }, declaredModes: ['discrete', 'continuous'] }; }
  if (type.startsWith('route.data-store-')) { nodes.push(fn('Memory', 'route.data-store-memory', { name: 'Data', initial: 2 }), fn('Source', 'source.constant', { value: 7 }), fn('Write', 'route.data-store-write', { name: 'Data', order: 0 }), fn('Read', 'route.data-store-read', { name: 'Data', order: 1 }), fn('Result', 'sink.scope')); edges.push(fe('Source', 'Write'), fe('Read', 'Result')); }
  else if (type === 'state.reader' || type === 'state.writer') { nodes.push(fn('Delay', 'discrete.unit-delay', { initial: 2 }), fn('Source', 'source.constant', { value: 1 }), fn('Written', 'source.constant', { value: 7 }), fn('Write', 'state.writer', { target: 'Delay', order: 0 }), fn('Read', 'state.reader', { target: 'Delay', order: 1 }), fn('Result', 'sink.scope')); edges.push(fe('Source', 'Delay'), fe('Written', 'Write'), fe('Read', 'Result')); }
  else if (type === 'state.parameter-writer') { nodes.push(fn('Target', 'source.constant', { value: 1 }), fn('Source', 'source.constant', { value: 7 }), fn('Operation', type, { target: 'Target', parameter: 'value' }), fn('Result', 'sink.scope')); edges.push(fe('Source', 'Operation'), fe('Target', 'Result')); }
  else { nodes.push(fn('Source', 'source.constant', { value: 7 }), fn('Goto', 'route.goto', { name: 'Tag', scope: 'scoped' }), fn('Visibility', 'route.tag-visibility', { name: 'Tag' }), fn('From', 'route.from', { name: 'Tag', scope: 'scoped' }), fn('Result', 'sink.scope')); edges.push(fe('Source', 'Goto'), fe('From', 'Result')); }
  return { name, model: fg(name, nodes, edges), expected: { Result: expected }, declaredModes: ['route.goto', 'route.from', 'route.tag-visibility'].includes(type) ? ['static', 'discrete', 'continuous'] : ['discrete', 'continuous'] };
}
function mergeFixture(): M11IndependentFixture {
  const name = 'm11-independent-route-merge', nodes = [fn('Input', 'source.constant', { value: 1 }), fn('True', 'source.constant', { value: true }), fn('False', 'source.constant', { value: false }), fn('A', 'hierarchy.action', { definitionId: 'Child' }), fn('B', 'hierarchy.action', { definitionId: 'Child' }), fn('Merge', 'route.merge'), fn('Result', 'sink.scope')], edges = [fe('Input', 'A'), fe('Input', 'B'), fe('True', 'A', 'action'), fe('False', 'B', 'action'), fe('A', 'Merge', 'in1'), fe('B', 'Merge', 'in2'), fe('Merge', 'Result')];
  return { name, model: fg(name, nodes, edges, [definition()]), expected: { Result: [1, 2, 3] }, declaredModes: ['discrete', 'continuous'] };
}
/** At least one actual compile/run/export pipeline for every new M11 definition. */
export const M11_INDEPENDENT_DEFINITION_FIXTURES: M11IndependentFixture[] = [
  ...['hierarchy.atomic', 'hierarchy.enabled', 'hierarchy.triggered', 'hierarchy.enabled-triggered', 'hierarchy.resettable', 'hierarchy.action', 'hierarchy.function-call', 'hierarchy.for-iterator', 'hierarchy.while-iterator', 'hierarchy.for-each', 'hierarchy.variant', 'hierarchy.array-processing', 'hierarchy.neighborhood-processing', 'hierarchy.pixel-processing', 'functions.call', 'functions.initialize', 'functions.reinitialize', 'functions.reset', 'functions.terminate'].map(scopeFixture),
  operationFixture('source.signal', {}, { out: repeated(exact) }, { value: exact }),
  namedFixture('functions.element'), operationFixture('functions.typed', { in: 3 }, { out: repeated(10) }, { expression: 'x*x+1' }),
  operationFixture('hierarchy.if', { in: 3 }, { then: repeated(true), else: repeated(false) }, { threshold: 2 }),
  operationFixture('hierarchy.switch-case', { in: 2 }, { case1: repeated(false), case2: repeated(true), default: repeated(false) }, { cases: [1, 2] }),
  operationFixture('route.structured-bus', { in1: exact, in2: true }, { out: repeated(structuredBus) }, { fields: '["exact","flag"]', count: 2 }),
  operationFixture('route.structured-select', { in: structuredBus }, { out: repeated(exact) }, { field: 'exact' }),
  operationFixture('route.structured-assign', { in: structuredBus, value: false }, { out: repeated({ kind: 'bus', fields: [{ name: 'exact', value: exact }, { name: 'flag', value: false }] }) }, { field: 'flag' }),
  operationFixture('events.send', { payload: exact, send: true }, { out: [fm(exact, 'Producer', 0, 0), fm(exact, 'Producer', 1, 1), fm(exact, 'Producer', 2, 2)] }, { producer: 'Producer' }),
  operationFixture('events.queue', { in: fm(7), receive: true }, { out: [{ kind: 'messages', items: [] }, fm(7), { kind: 'messages', items: [] }], size: [0, 1, 0] }),
  operationFixture('events.receive', { in: fm(7) }, { out: repeated(7), valid: [true, false, false] }),
  operationFixture('events.message-merge', { in1: fm(1, 'A', 0, 0, 2), in2: fm(2, 'B', 0, 0, -1) }, { out: repeated({ kind: 'messages', items: [...(fm(2, 'B', 0, 0, -1) as { items: unknown[] }).items, ...(fm(1, 'A', 0, 0, 2) as { items: unknown[] }).items] } as SignalValue) }),
  operationFixture('events.function-call-generator', {}, { out: repeated(2) }, { count: 2 }),
  operationFixture('events.function-call-split', { in: 2 }, { out1: repeated(2), out2: repeated(2) }),
  operationFixture('events.feedback-latch', { in: 7 }, { out: [0, 7, 7] }),
  operationFixture('events.hit-scheduler', {}, { out: [2, 0, 2] }, { count: 2, times: [0, 2] }), mergeFixture(),
  ...['route.goto', 'route.from', 'route.tag-visibility', 'route.data-store-memory', 'route.data-store-read', 'route.data-store-write', 'state.reader', 'state.writer', 'state.parameter-writer'].map(namedFixture),
  operationFixture('sink.sequence-viewer', { in: fm(7) }, { out: repeated(fm(7)) }),
  operationFixture('io.structured-input', {}, { out: repeated(structuredBus) }, { value: structuredBus }),
  operationFixture('io.structured-output', { in: structuredBus }, { out: repeated(structuredBus) }),
];

const literalMemory: Record<string, Record<string, StateValue>> = {
  'm11-independent-events-send': { Operation: { sequence: 3 } },
  'm11-independent-events-queue': { Operation: { messageQueue: [], seen: [{ producer: 'Producer', sequence: 0 }], nextArrival: 1 } },
  'm11-independent-events-receive': { Operation: { value: 7, seen: [{ producer: 'Producer', sequence: 0 }] } },
  'm11-independent-events-feedback-latch': { Operation: { value: 7 } },
  'm11-independent-events-hit-scheduler': { Operation: { initialized: false, lastHitTime: 2 } },
  'm11-independent-route-data-store-memory': { Memory: { value: 7 } },
  'm11-independent-route-data-store-read': { Memory: { value: 7 } },
  'm11-independent-route-data-store-write': { Memory: { value: 7 } },
};
for (const fixture of M11_INDEPENDENT_DEFINITION_FIXTURES) if (literalMemory[fixture.name]) fixture.expectedStateMemory = literalMemory[fixture.name];
function dynamicScope(type: string, policy: Record<string, unknown>, expected: SignalValue[], triggerPort = 'enable'): M11IndependentFixture {
  const fixture = scopeFixture(type); fixture.name += `-${Object.entries(policy).map(([key, value]) => `${key}-${String(value)}`).join('-') || 'selected'}`; fixture.model.modelId = fixture.name; fixture.model.name = fixture.name; fixture.model.execution.stopTime = 5;
  const control = fixture.model.nodes.find(item => item.id === `Source_${triggerPort}`)!;
  const pulseParameters = { amplitude: 1, period: 4, width: 2, phase: 0 };
  if (triggerPort === 'action' || triggerPort === 'reset') { control.blockType = 'hierarchy.if'; control.parameters = { threshold: 0, comparison: 'gt' }; fixture.model.nodes.unshift(fn('Pulse', 'source.pulse', pulseParameters)); fixture.model.edges.push(fe('Pulse', control.id)); for (const edge of fixture.model.edges) if (edge.source.nodeId === control.id) edge.source.portId = 'then'; }
  else { control.blockType = 'source.pulse'; control.parameters = pulseParameters; }
  Object.assign(fixture.model.nodes.find(item => item.id === 'Operation')!.parameters, policy); fixture.expected = { Result_out: expected };
  return fixture;
}
const variantExcluded = scopeFixture('hierarchy.variant'); variantExcluded.name = 'm11-independent-variant-invalid-inactive-excluded'; variantExcluded.model.modelId = variantExcluded.name;
variantExcluded.model.nodes.find(item => item.id === 'Source_in')!.parameters.value = -1;
const inactive = variantExcluded.model.subsystems!.find(item => item.id === 'Inactive')!; inactive.nodes.find(item => item.id === 'Compute')!.blockType = 'math.function'; inactive.nodes.find(item => item.id === 'Compute')!.parameters = { operation: 'log' };
variantExcluded.expected = { Result_out: [-1, -2, -3] };
const forReset = scopeFixture('hierarchy.for-iterator'); forReset.name += '-reset'; forReset.model.nodes.find(item => item.id === 'Operation')!.parameters.statePerIteration = 'reset'; forReset.expected = { Result_out: [2, 2, 2] };
const whileZero = scopeFixture('hierarchy.while-iterator'); whileZero.name += '-zero'; whileZero.model.nodes.find(item => item.id === 'Source_condition')!.parameters.value = false; whileZero.expected = { Result_out: [0, 0, 0] };
/** State boundary oracles supplement per-definition pipelines without deriving expected values. */
export const M11_INDEPENDENT_BOUNDARY_FIXTURES: M11IndependentFixture[] = [
  dynamicScope('hierarchy.enabled', { stateOnEnable: 'hold' }, [1, 2, 2, 2, 3, 4]),
  dynamicScope('hierarchy.enabled', { stateOnEnable: 'reset' }, [1, 2, 2, 2, 1, 2]),
  dynamicScope('hierarchy.enabled', { disabledOutput: 'reset' }, [1, 2, 0, 0, 3, 4]),
  dynamicScope('hierarchy.triggered', { trigger: 'rising' }, [1, 1, 1, 1, 2, 2], 'trigger'),
  dynamicScope('hierarchy.triggered', { trigger: 'either' }, [1, 1, 2, 2, 3, 3], 'trigger'),
  dynamicScope('hierarchy.action', { stateOnEnable: 'reset' }, [1, 2, 2, 2, 1, 2], 'action'),
  dynamicScope('hierarchy.resettable', { resetMode: 'rising' }, [1, 2, 3, 4, 1, 2], 'reset'),
  dynamicScope('hierarchy.resettable', { resetMode: 'level' }, [1, 1, 2, 3, 1, 1], 'reset'),
  forReset, whileZero, variantExcluded,
  { name: 'm11-independent-functions-element-static-declaration', model: fg('m11-independent-functions-element-static-declaration', [fn('Element', 'functions.element', { definitionId: 'Child', name: 'Accumulate' }), fn('Source', 'source.constant', { value: 7 }), fn('Result', 'sink.scope')], [fe('Source', 'Result')], [definition()], 1), expected: { Result: [7] }, declaredModes: ['static'] },
];
export interface M11IndependentFailureFixture { name: string; model: CalcModel; code: string; phase: 'compile' | 'runtime'; expectedPartial?: { samples: number; finalState: Record<string, SignalValue>; stateMemory: Record<string, StateValue> } }
const limit = scopeFixture('hierarchy.while-iterator'); limit.model.nodes.find(item => item.id === 'Operation')!.parameters.maxIterations = 2;
const overflowQueue = operationFixture('events.queue', { in: fm(7), receive: false }, { out: [{ kind: 'messages', items: [] }] }, { capacity: 1 });
overflowQueue.model.nodes.find(item => item.id === 'Source_in')!.parameters.value = { kind: 'messages', items: [...(fm(7, 'A') as { items: unknown[] }).items, ...(fm(8, 'B') as { items: unknown[] }).items] };
const mergeConflict = mergeFixture(); mergeConflict.model.nodes.find(item => item.id === 'False')!.parameters.value = true;
const parentCycle = scopeFixture('hierarchy.atomic'); parentCycle.model.nodes.push(fn('Feedback', 'math.gain', { gain: 1 })); parentCycle.model.edges = parentCycle.model.edges.filter(edge => edge.target.nodeId !== 'Operation'); parentCycle.model.edges.push(fe('Operation', 'Feedback'), fe('Feedback', 'Operation'));
parentCycle.model.subsystems![0]!.nodes = [fn('Input', 'io.structured-input', { value: 0 }), fn('Delay', 'discrete.unit-delay', { initial: 0 }), fn('Output', 'io.structured-output')];
parentCycle.model.subsystems![0]!.edges = [fe('Input', 'Delay'), fe('Delay', 'Output')];
export const M11_INDEPENDENT_FAILURE_FIXTURES: M11IndependentFailureFixture[] = [
  { name: 'm11-independent-while-limit-atomic', model: limit.model, code: 'M11_ITERATION_LIMIT', phase: 'runtime', expectedPartial: { samples: 0, finalState: { Operation: 0 }, stateMemory: { Operation: { outputs: { out: 0 }, banks: [], previousTrigger: 0, wasEnabled: false } } } },
  { name: 'm11-independent-queue-overflow-atomic', model: overflowQueue.model, code: 'M11_QUEUE_OVERFLOW', phase: 'runtime', expectedPartial: { samples: 1, finalState: { Operation: { kind: 'messages', items: [] } }, stateMemory: { Operation: { messageQueue: [], seen: [], nextArrival: 0 } } } },
  { name: 'm11-independent-merge-publication-conflict', model: mergeConflict.model, code: 'M11_MERGE_CONFLICT', phase: 'runtime', expectedPartial: { samples: 0, finalState: { A: 0, B: 0, Merge: 0 }, stateMemory: { A: { outputs: { out: 0 }, banks: [], previousTrigger: 0, wasEnabled: false }, B: { outputs: { out: 0 }, banks: [], previousTrigger: 0, wasEnabled: false }, Merge: { value: 0 } } } },
  { name: 'm11-independent-parent-opaque-feedback-unsupported', model: parentCycle.model, code: 'CYCLIC_DEPENDENCY', phase: 'compile' },
];
