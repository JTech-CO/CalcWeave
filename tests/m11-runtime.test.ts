import { describe, expect, it } from 'vitest';
import { ModelError, type BlockType, type IRNode, type MessageSignal, type SignalDescriptor, type SignalValue } from '../packages/model/src/types';
import { describeAnySignal } from '../packages/model/src/structured';
import { getBlockDefinition } from '../packages/block-library/src';
import { createDiscreteMachine } from '../packages/runtime/src/discrete-machine';
import { evaluateM11Node, m11Commit, m11InitialMemory, m11Read, type M11Frame, type M11Memory, type M11ScopeProgram } from '../packages/runtime/src/m11';
import { M11_LITERAL_ORACLES as literal } from './m11-independent-fixtures';
import { M11_INDEPENDENT_DEFINITION_FIXTURES, M11_INDEPENDENT_BOUNDARY_FIXTURES, M11_INDEPENDENT_FAILURE_FIXTURES } from './m11-independent-fixtures';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';

const real: SignalDescriptor = { valueType: 'float64', shape: [], unit: '' };
const bool: SignalDescriptor = { valueType: 'boolean', shape: [], unit: '' };
function node(blockType: string, parameters: Record<string, unknown> = {}, outputs: Record<string, SignalDescriptor> = { out: real }, inputs: IRNode['inputs'] = {}, id = 'Test'): IRNode {
  const defaults = Object.fromEntries(Object.entries(getBlockDefinition(blockType)?.parameters ?? {}).map(([key, parameter]) => [key, structuredClone(parameter.default)]));
  return { id, blockType: blockType as BlockType, parameters: { ...defaults, ...parameters }, outputs, inputs, sampleTime: { period: 1, offset: 0 } };
}
function program(extra?: { iteration?: boolean; continuing?: boolean; gain?: number; inputShape?: number[] }): M11ScopeProgram {
  const source = node('source.signal', { value: 0 }, { out: { ...real, shape: extra?.inputShape ?? [] } }, {}, 'Input');
  const delay = node('discrete.unit-delay', { initial: 0 }, { out: real }, { in: { nodeId: 'Sum', portId: 'out' } }, 'Delay');
  const sum = node('math.sum', { inputs: 2, signs: '++' }, { out: real }, { a: { nodeId: 'Input', portId: 'out' }, b: { nodeId: 'Delay', portId: 'out' } }, 'Sum');
  const nodes = [source, delay, sum], inputBindings = [{ port: 'in', nodeId: 'Input' }], outputBindings = [{ port: 'out', source: { nodeId: 'Sum', portId: 'out' } }];
  if (extra?.iteration) inputBindings[0]!.port = 'iteration';
  if (extra?.continuing) { nodes.push(node('hierarchy.if', { threshold: 3, comparison: 'lt' }, { then: bool, else: bool }, { in: { nodeId: 'Sum', portId: 'out' } }, 'Condition')); outputBindings.push({ port: 'continue', source: { nodeId: 'Condition', portId: 'then' } }); }
  if (extra?.gain !== undefined) { nodes.splice(1); nodes.push(node('math.gain', { gain: extra.gain }, { out: { ...real, shape: extra.inputShape ?? [] } }, { in: { nodeId: 'Input', portId: 'out' } }, 'Gain')); outputBindings[0]!.source = { nodeId: 'Gain', portId: 'out' }; }
  return { kind: 'm11-child', definitionId: 'Child', version: 1, definitionHash: 'literal', depth: 1, nodes, stateIds: extra?.gain === undefined ? ['Delay'] : [], outputIds: [], outputTypes: {}, stateElements: 1, execution: { mode: 'discrete', startTime: 0, stopTime: 4, step: 1 }, inputBindings, outputBindings, directFeedthroughPorts: inputBindings.map(binding => binding.port) };
}
function scope(blockType: string, p: Record<string, unknown> = {}, child = program(), out = real): IRNode { return node(blockType, { scopeProgram: child, initialOutputs: { out: 0 }, ...p }, { out }); }
function read(node: IRNode, state: M11Memory, inputs: Record<string, SignalValue>, tick = 0, time = tick, frame?: M11Frame) { return m11Read(node, state, port => { if (!Object.hasOwn(inputs, port)) throw new Error(`Unexpected input ${port}`); return inputs[port]!; }, tick, time, 1, () => {}, frame); }
function runScope(node: IRNode, inputs: Record<string, SignalValue>[]): { values: SignalValue[]; state: M11Memory } { let state = m11InitialMemory(node); const values: SignalValue[] = []; inputs.forEach((ports, tick) => { const result = read(node, state, ports, tick); state = result.publicationMemory ?? state; values.push(result.outputs.out!); }); return { values, state }; }
function failure(action: () => unknown, code: string): void { try { action(); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some(d => d.code === code)).toBe(true); return; } throw new Error(`Expected ${code}`); }
const message = (sequence: number, payload: SignalValue, priority = 0, producer = 'Producer'): MessageSignal => ({ kind: 'messages', items: [{ producer, sequence, time: 0, priority, payload }] });
const empty: MessageSignal = { kind: 'messages', items: [] };

describe('M11 actual independent model pipelines', () => {
  for (const fixture of [...M11_INDEPENDENT_DEFINITION_FIXTURES, ...M11_INDEPENDENT_BOUNDARY_FIXTURES]) it(fixture.name, async () => {
    const compiled = compileModel(fixture.model), first = await runModel(compiled);
    for (const [id, expected] of Object.entries(fixture.expected)) expect(first.samples.map(sample => sample.values[id])).toEqual(expected);
    if (fixture.expectedStateMemory) expect(first.stateMemory).toEqual(fixture.expectedStateMemory);
    const repeated = await runModel(compiled); expect(repeated.samples).toEqual(first.samples); expect(repeated.stateMemory).toEqual(first.stateMemory);
  });
  for (const fixture of M11_INDEPENDENT_FAILURE_FIXTURES) it(fixture.name, async () => {
    if (fixture.phase === 'compile') failure(() => compileModel(fixture.model), fixture.code);
    else { try { await runModel(compileModel(fixture.model)); throw new Error('Expected failed model'); } catch (error) { expect(error).toBeInstanceOf(ModelError); const failure = error as ModelError; expect(failure.diagnostics.some(item => item.code === fixture.code)).toBe(true); if (fixture.expectedPartial) { expect(failure.partialResult?.samples).toHaveLength(fixture.expectedPartial.samples); expect(failure.partialResult?.finalState).toEqual(fixture.expectedPartial.finalState); expect(failure.partialResult?.stateMemory).toEqual(fixture.expectedPartial.stateMemory); } } }
  });
});

describe('M11 independent controlled-scope lifecycle oracles', () => {
  it.each(['hold', 'reset'] as const)('enabled %s is positive-only and reactivation does not reset every active call', policy => {
    const n = scope('hierarchy.enabled', { stateOnEnable: policy }), result = runScope(n, [1, 0, -1, 1, 1].map(enable => ({ in: 1, enable })));
    expect(result.values).toEqual(policy === 'hold' ? literal.enabledHold : literal.enabledReset);
    expect(result.state.banks?.[0]?.calls).toBe(policy === 'hold' ? 3 : 2);
  });
  it('disabled output reset is independent of held child state', () => expect(runScope(scope('hierarchy.enabled', { disabledOutput: 'reset', stateOnEnable: 'hold' }), [1, 0, 1].map(enable => ({ in: 1, enable }))).values).toEqual([1, 0, 2]));
  it.each(['rising', 'either'] as const)('trigger %s does not execute on a held level', trigger => expect(runScope(scope('hierarchy.triggered', { trigger }), [1, 1, 0, 1, 0].map(value => ({ in: 1, trigger: value }))).values).toEqual(trigger === 'rising' ? literal.triggeredRising : literal.triggeredEither));
  it('enabled-triggered observes disabled edges instead of replaying them on enable', () => expect(runScope(scope('hierarchy.enabled-triggered'), [{ in: 1, enable: 0, trigger: 1 }, { in: 1, enable: 1, trigger: 1 }, { in: 1, enable: 1, trigger: 0 }, { in: 1, enable: 1, trigger: 1 }]).values).toEqual([0, 0, 0, 1]));
  it('reset rising clears child state before the current call', () => expect(runScope(scope('hierarchy.resettable'), [0, 0, 1, 1, 0].map(reset => ({ in: 1, reset }))).values).toEqual(literal.resetBeforeCall));
  it('reset level resets each positive due', () => expect(runScope(scope('hierarchy.resettable', { resetMode: 'level' }), [0, 1, 1, 0].map(reset => ({ in: 1, reset }))).values).toEqual([1, 1, 1, 2]));
  it('action reset occurs only on reactivation and does not reset consecutive true calls', () => expect(runScope(scope('hierarchy.action', { stateOnEnable: 'reset' }), [true, true, false, true, true].map(action => ({ in: 1, action }))).values).toEqual([1, 2, 2, 1, 2]));
  it('function calls advance read-before-write state on every same-time invocation', () => {
    const n = scope('hierarchy.function-call'), initial = m11InitialMemory(n); let state = initial; const values: SignalValue[] = [];
    for (let tick = 0; tick < 3; tick++) { const result = read(n, state, { in: 1, call: 3 }, tick, 7); state = result.publicationMemory!; values.push(result.outputs.out!); }
    expect(values).toEqual(literal.sameTimeCalls); expect(state.banks?.[0]?.calls).toBe(9); expect(initial.banks).toEqual([]);
  });
  it('function-call producer rate gates held counts between genuine hits', () => expect(runScope(scope('hierarchy.function-call', { callEventRate: { period: 2, offset: 0 } }), Array.from({ length: 5 }, () => ({ in: 1, call: 2 }))).values).toEqual(literal.callRate));
  it.each(['carry', 'reset'] as const)('For iteration %s preserves the last commit and uses the declared iteration input', policy => {
    const child = program({ iteration: true }), n = scope('hierarchy.for-iterator', { count: 4, statePerIteration: policy }, child);
    expect(runScope(n, [{}, {}]).values).toEqual(policy === 'carry' ? literal.forCarry : literal.forReset);
  });
  it('zero For calls never reads unavailable body data and never creates a bank', () => { const result = runScope(scope('hierarchy.for-iterator', { count: 0 }), [{}]); expect(result.values).toEqual([0]); expect(result.state.banks).toEqual([]); });
  it('While executes the body until its independent boolean continuation is false', () => expect(runScope(scope('hierarchy.while-iterator', { maxIterations: 4 }, program({ continuing: true })), [{ in: 1, condition: true }, { condition: false }]).values).toEqual(literal.whileFinite));
  it('While-limit failure cannot publish any partial loop bank', () => { const n = scope('hierarchy.while-iterator', { maxIterations: 2 }, program({ continuing: true })), original = m11InitialMemory(n), saved = JSON.stringify(original); failure(() => read(n, original, { in: 1, condition: true }), 'M11_ITERATION_LIMIT'); expect(JSON.stringify(original)).toBe(saved); });
  it('ForEach stores genuinely independent persistent banks', () => { const result = runScope(scope('hierarchy.for-each', { axis: 0 }, program(), { ...real, shape: [2] }), Array.from({ length: 3 }, () => ({ in: [1, 10] }))); expect(result.values).toEqual(literal.foreach); expect(result.state.banks?.map(bank => bank.calls)).toEqual([3, 3]); });
  it('Pixel processing invokes scalar children for actual 2D locations', () => expect(runScope(scope('hierarchy.pixel-processing', {}, program(), { ...real, shape: [2, 2] }), [{ in: [[1, 10], [100, 1000]] }, { in: [[1, 10], [100, 1000]] }]).values).toEqual(literal.pixel));
  it.each(['clamp', 'wrap', 'zero'])('Neighborhood %s creates actual windows with distinct boundaries', boundary => {
    const child = program({ gain: 1, inputShape: [3, 3] }); child.nodes[1] = node('reduce.sum', {}, { out: real }, { in: { nodeId: 'Input', portId: 'out' } }, 'Gain');
    const result = runScope(scope('hierarchy.neighborhood-processing', { window: 3, boundary }, child, { ...real, shape: [2, 2] }), [{ in: [[1, 2], [3, 4]] }]);
    expect(result.values).toEqual(boundary === 'clamp' ? [[[18, 21], [24, 27]]] : boundary === 'wrap' ? [[[27, 24], [21, 18]]] : [[[10, 10], [10, 10]]]);
  });
  it.each(['functions.initialize', 'functions.reinitialize', 'functions.reset', 'functions.terminate'])('%s follows a real selected lifecycle boundary', block => {
    const n = scope(block, { terminalTick: 3 }), inputs = block === 'functions.reinitialize' || block === 'functions.reset' ? [1, 1, 0, 1, 0].map(reset => ({ in: 1, reset })) : Array.from({ length: 4 }, () => ({ in: 1 }));
    expect(runScope(n, inputs).values).toEqual(block === 'functions.initialize' ? literal.initialize : block === 'functions.terminate' ? literal.terminate : block === 'functions.reset' ? literal.resetFunction : literal.reinitialize);
  });
  it('nested scope has owned JSON checkpoints and no hidden live machine cache', () => { const inner = scope('hierarchy.atomic'); inner.id = 'Nested'; inner.inputs = { in: { nodeId: 'Input', portId: 'out' } }; const child = program(); child.nodes = [child.nodes[0]!, inner]; child.stateIds = ['Nested']; child.outputBindings[0]!.source = { nodeId: 'Nested', portId: 'out' }; const n = scope('hierarchy.atomic', {}, child); const one = runScope(n, [{ in: 2 }, { in: 2 }]); expect(one.values).toEqual([2, 4]); const serialized = JSON.parse(JSON.stringify(one.state)) as M11Memory; expect(read(n, serialized, { in: 2 }, 2).outputs.out).toBe(6); expect(runScope(n, [{ in: 2 }]).values).toEqual([2]); });
  it('owned child checkpoint copies preserve legacy signed zero without a lossy JSON intermediary', () => { const child = program(); child.nodes = [child.nodes[0]!, node('discrete.unit-delay', { initial: -0 }, { out: real }, { in: { nodeId: 'Input', portId: 'out' } }, 'Delay')]; child.outputBindings[0]!.source = { nodeId: 'Delay', portId: 'out' }; const result = runScope(scope('hierarchy.atomic', {}, child), [{ in: -0 }, { in: -0 }]); expect(result.values.every(value => Object.is(value, -0))).toBe(true); expect(Object.is(child.nodes[1]!.parameters.initial, -0)).toBe(true); });
  it('budget failure preserves parent input, compiled child IR, and all banks', () => { const n = scope('hierarchy.for-iterator', { count: 4 }), original = m11InitialMemory(n), before = JSON.stringify(n); let work = 0; failure(() => m11Read(n, original, () => 1, 0, 0, 1, (_, cost = 1) => { work += cost; if (work > 50) throw new ModelError([{ code: 'OPERATION_BUDGET', message: 'bounded' }]); }), 'OPERATION_BUDGET'); expect(original.banks).toEqual([]); expect(JSON.stringify(n)).toBe(before); });
  it('nested invocation flags reach the shared outer budget before each child allocation', () => { const inner = scope('hierarchy.for-iterator', { count: 3 }); inner.id = 'Nested'; inner.inputs = { in: { nodeId: 'Input', portId: 'out' } }; const child = program(); child.nodes = [child.nodes[0]!, inner]; child.stateIds = ['Nested']; child.outputBindings[0]!.source = { nodeId: 'Nested', portId: 'out' }; const n = scope('hierarchy.for-iterator', { count: 2 }, child); let calls = 0; const original = m11InitialMemory(n); failure(() => m11Read(n, original, () => 1, 0, 0, 1, (owner, _work, invocation) => { if (invocation && ++calls > 4) throw new ModelError([{ code: 'M11_INVOCATION_LIMIT', nodeId: owner.id, message: 'shared bound' }]); }), 'M11_INVOCATION_LIMIT'); expect(calls).toBe(5); expect(original.banks).toEqual([]); });
});

describe('M11 independent messaging and structured-value oracles', () => {
  it('sender sequence is persistent, owned, and advances only on actual send', () => { const n = node('events.send', { producer: 'P', priority: -2 }), state = m11InitialMemory(n), one = read(n, state, { send: true, payload: 5 }, 0, 7); expect(one.outputs.out).toEqual({ kind: 'messages', items: [{ producer: 'P', sequence: 0, time: 7, priority: -2, payload: 5 }] }); expect(read(n, one.publicationMemory!, { send: false }, 1).outputs.out).toEqual(empty); expect(read(n, one.publicationMemory!, { send: true, payload: 6 }, 2).outputs.out).toEqual({ kind: 'messages', items: [{ producer: 'P', sequence: 1, time: 2, priority: -2, payload: 6 }] }); expect(state.sequence).toBe(0); });
  it('queue reads/dequeues the prior batch before current enqueue and deduplicates held producers', () => { const n = node('events.queue', { capacity: 4, maxDequeue: 2 }), initial = m11InitialMemory(n), first = read(n, initial, { receive: true }); expect(first.outputs).toEqual({ out: empty, size: 0 }); const queued = m11Commit(n, first.publicationMemory!, () => message(0, 5), first.outputs, 0, 0, 1); expect(initial.messageQueue).toEqual([]); const second = read(n, queued, { receive: true }, 1); expect(second.outputs).toEqual({ out: message(0, 5), size: 1 }); const committed = m11Commit(n, second.publicationMemory!, () => message(0, 5), second.outputs, 1, 1, 1); expect(committed.messageQueue).toEqual([]); });
  it('queue priority is ascending with stable arrival ties across producers', () => { const n = node('events.queue', { capacity: 8, maxDequeue: 4 }), batch: MessageSignal = { kind: 'messages', items: [...message(0, 1, 3, 'A').items, ...message(0, 2, -1, 'B').items, ...message(0, 3, -1, 'C').items] }; const state = m11Commit(n, m11InitialMemory(n), () => batch, {}, 0, 0, 1); expect((read(n, state, { receive: true }).outputs.out as MessageSignal).items.map(item => item.payload)).toEqual([2, 3, 1]); });
  it.each(['error', 'drop-newest', 'drop-oldest'])('queue overflow %s is atomic and has an independent result', overflow => { const n = node('events.queue', { capacity: 1, overflow }), state = m11Commit(n, m11InitialMemory(n), () => message(0, 1), {}, 0, 0, 1), before = JSON.stringify(state); if (overflow === 'error') failure(() => m11Commit(n, state, () => message(1, 2), {}, 1, 1, 1), 'M11_QUEUE_OVERFLOW'); else { const next = m11Commit(n, state, () => message(1, 2), {}, 1, 1, 1); expect(next.messageQueue?.map(item => item.payload)).toEqual(overflow === 'drop-newest' ? [1] : [2]); } expect(JSON.stringify(state)).toBe(before); });
  it('receive emits valid once for a held identity and holds its exact payload when empty', () => { const n = node('events.receive', { initial: 0 }), first = read(n, m11InitialMemory(n), { in: message(0, 9) }); expect(first.outputs).toEqual({ out: 9, valid: true }); expect(read(n, first.publicationMemory!, { in: message(0, 9) }).outputs).toEqual({ out: 9, valid: false }); expect(read(n, first.publicationMemory!, { in: empty }).outputs).toEqual({ out: 9, valid: false }); });
  it('message merge rejects conflicting identities instead of silently coalescing data', () => { const n = node('events.message-merge', { count: 2 }); failure(() => evaluateM11Node(n, port => port === 'in1' ? message(0, 1) : message(0, 2)), 'M11_MESSAGE_ID_CONFLICT'); expect((evaluateM11Node(n, () => message(0, 1))!.out as MessageSignal).items).toHaveLength(1); });
  it('feedback latch output never reads current input, and commit copies structured data', () => { const n = node('events.feedback-latch', { initial: 2 }), state = m11InitialMemory(n); expect(read(n, state, {}).outputs).toEqual({ out: 2 }); const input: SignalValue = [4, 5], next = m11Commit(n, state, () => input, {}, 0, 0, 1); (input as number[])[0] = 99; expect(next.value).toEqual([4, 5]); expect(state.value).toBe(2); });
  it('bus selection and nested assignment preserve exact uint64 values and own storage', () => { const bus: SignalValue = { kind: 'bus', fields: [{ name: 'nested', value: { kind: 'bus', fields: [{ name: 'exact', value: { kind: 'typed', dtype: 'uint64', shape: [], data: ['9007199254740993'] } }] } }] }, replacement: SignalValue = { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] }; const n = node('route.structured-assign', { field: 'nested.exact' }); const out = evaluateM11Node(n, port => port === 'in' ? bus : replacement)!.out; expect(evaluateM11Node(node('route.structured-select', { field: 'nested.exact' }), () => out!)!.out).toEqual(replacement); expect(evaluateM11Node(node('route.structured-select', { field: 'nested.exact' }), () => bus)!.out).toEqual({ kind: 'typed', dtype: 'uint64', shape: [], data: ['9007199254740993'] }); });
  it('scheduled hits occur once per exact grid time and not at intervening times', () => { const n = node('events.hit-scheduler', { times: [0, 2], count: 2 }), first = read(n, m11InitialMemory(n), {}, 0); expect(first.outputs.out).toBe(2); expect(read(n, first.publicationMemory!, {}, 0).outputs.out).toBe(0); expect(read(n, first.publicationMemory!, {}, 1).outputs.out).toBe(0); expect(read(n, first.publicationMemory!, {}, 2).outputs.out).toBe(2); });
});

