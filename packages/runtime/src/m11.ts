import { ModelError, type BusSignal, type Endpoint, type IRNode, type MessageItem, type MessageSignal, type SignalDescriptor, type SignalValue, type StateValue } from '../../model/src/types';
import { copyAnySignal, describeAnySignal, sameSignalDescriptor, structuredStorageElements, validateAnySignal, validateStructuredSignal, zeroAnySignal } from '../../model/src/structured';
import { createDiscreteMachine } from './discrete-machine';
import { checkSignal, nodeOperationCost } from './kernels';
import { evaluateExpression } from '../../expression/src';

export const M11_SCOPE_BLOCKS = new Set(['hierarchy.atomic', 'hierarchy.enabled', 'hierarchy.triggered', 'hierarchy.enabled-triggered', 'hierarchy.resettable', 'hierarchy.action', 'hierarchy.function-call', 'hierarchy.for-iterator', 'hierarchy.while-iterator', 'hierarchy.for-each', 'hierarchy.variant', 'hierarchy.array-processing', 'hierarchy.neighborhood-processing', 'hierarchy.pixel-processing', 'functions.call', 'functions.initialize', 'functions.reinitialize', 'functions.reset', 'functions.terminate']);
export const M11_STATE_BLOCKS = new Set([...M11_SCOPE_BLOCKS, 'events.send', 'events.queue', 'events.receive', 'events.feedback-latch', 'events.hit-scheduler', 'route.merge', 'route.data-store-memory']);
export interface M11ScopeProgram {
  kind: 'm11-child'; definitionId: string; version: number; definitionHash: string; depth: number;
  nodes: IRNode[]; stateIds: string[]; outputIds: string[]; outputTypes: Record<string, SignalDescriptor>; stateElements: number;
  execution: { mode: string; startTime: number; stopTime: number; step: number };
  inputBindings: { port: string; nodeId: string }[]; outputBindings: { port: string; source: Endpoint }[]; directFeedthroughPorts: string[];
}
export interface M11Checkpoint { held: [string, Record<string, SignalValue>][]; memory: [string, StateValue][]; randomTicks: [string, number][]; parameters?: [string, Record<string, unknown>][] }
export interface M11ScopeBank { checkpoint?: M11Checkpoint; calls: number }
export interface M11Memory {
  outputs?: Record<string, SignalValue>; banks?: M11ScopeBank[]; previousTrigger?: number; wasEnabled?: boolean;
  messageQueue?: (MessageItem & { arrival: number })[]; seen?: { producer: string; sequence: number }[]; sequence?: number; value?: SignalValue; nextArrival?: number; lastHitTime?: number; initialized?: boolean; publishedTick?: number;
}
export interface M11Frame {
  readMemory(id: string): M11Memory | undefined; writeMemory(id: string, value: M11Memory): void;
  readParameter(id: string, key: string): unknown; writeParameter(id: string, key: string, value: unknown): void;
}
export interface M11ReadResult { outputs: Record<string, SignalValue>; publicationMemory?: M11Memory }
export type M11Charge = (node: IRNode, explicitWork?: number, scopeInvocation?: boolean) => void;
function m11Failure(node: IRNode, code: string, message: string): never { throw new ModelError([{ code, message, nodeId: node.id }]); }
function m11Clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => m11Clone(item)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, m11Clone(item)])) as T;
  return value;
}
function m11CopyOutputs(outputs: Record<string, SignalValue>): Record<string, SignalValue> { return Object.fromEntries(Object.entries(outputs).map(([port, value]) => [port, copyAnySignal(value)])); }
function m11ScopeProgram(node: IRNode): M11ScopeProgram { const program = node.parameters.scopeProgram as M11ScopeProgram | undefined; if (!program || program.kind !== 'm11-child' || program.depth > 8) m11Failure(node, 'M11_INVALID_SCOPE_IR', '검증한 실행 계층 IR이 없습니다.'); return program; }
function m11Control(node: IRNode, value: SignalValue, booleanOnly = false): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (!booleanOnly && typeof value === 'number' && Number.isFinite(value)) return value;
  m11Failure(node, 'M11_CONTROL_TYPE', '제어 포트에는 허용한 scalar boolean 또는 유한 실수가 필요합니다.');
}
function m11Edge(previous: number, current: number, mode: unknown): boolean { return mode === 'falling' ? previous > 0 && current <= 0 : mode === 'either' ? previous <= 0 && current > 0 || previous > 0 && current <= 0 : previous <= 0 && current > 0; }
function m11InitialOutputs(node: IRNode): Record<string, SignalValue> {
  const values = node.parameters.initialOutputs as Record<string, SignalValue> | undefined;
  return Object.fromEntries(Object.entries(node.outputs).map(([port, descriptor]) => [port, values && Object.hasOwn(values, port) ? copyAnySignal(values[port]!) : zeroAnySignal(descriptor)]));
}
export function m11InitialMemory(node: IRNode): M11Memory {
  if (M11_SCOPE_BLOCKS.has(node.blockType)) return { outputs: m11InitialOutputs(node), banks: [], previousTrigger: 0, wasEnabled: false };
  if (node.blockType === 'events.send') return { sequence: 0 };
  if (node.blockType === 'events.queue') return { messageQueue: [], seen: [], nextArrival: 0 };
  if (node.blockType === 'events.hit-scheduler') return { initialized: false };
  if (['events.receive', 'events.feedback-latch', 'route.merge', 'route.data-store-memory'].includes(node.blockType)) return { value: validateAnySignal(node.parameters.initial) };
  return {};
}
export function m11InitialOutput(node: IRNode, memory: M11Memory): Record<string, SignalValue> {
  if (node.blockType === 'events.send') return { out: { kind: 'messages', items: [] } };
  if (node.blockType === 'events.queue') return { out: { kind: 'messages', items: [] }, size: 0 };
  if (node.blockType === 'events.receive') return { out: copyAnySignal(memory.value!), valid: false };
  if (node.blockType === 'events.feedback-latch') return { out: copyAnySignal(memory.value!) };
  if (node.blockType === 'route.merge') return { out: copyAnySignal(memory.value!) };
  if (node.blockType === 'route.data-store-memory') return {};
  if (node.blockType === 'events.hit-scheduler') return { out: 0 };
  return m11CopyOutputs(memory.outputs ?? m11InitialOutputs(node));
}

/** A child machine exists only for this invocation; JSON tuples own all persistent state. */
function m11InvokeScope(node: IRNode, bank: M11ScopeBank, values: Record<string, SignalValue>, time: number, Ts: number, charge: M11Charge, iteration: number): { outputs: Record<string, SignalValue>; bank: M11ScopeBank } {
  const program = m11ScopeProgram(node);
  charge(node, Math.max(1, program.nodes.length + program.stateElements) * 8, true);
  const children = m11Clone(program.nodes), childIds = new Map(children.map(child => [child.id, child]));
  for (const binding of program.inputBindings) {
    const source = childIds.get(binding.nodeId);
    if (!source) m11Failure(node, 'M11_INVALID_SCOPE_IR', '실행 계층 입력 경계가 없습니다.');
    const value = binding.port === node.parameters.iterationPort ? iteration : values[binding.port];
    if (value === undefined) m11Failure(node, 'M11_MISSING_SCOPE_INPUT', `실행 계층 입력 ${binding.port}를 읽을 수 없습니다.`);
    source!.parameters.value = copyAnySignal(value);
  }
  const childCharge: M11Charge = (child, work, invocation) => charge(child, work ?? nodeOperationCost(child, childIds), invocation);
  const machine = createDiscreteMachine(children, program.stateIds, Ts, time, childCharge);
  if (bank.checkpoint) machine.restore({ held: new Map(m11Clone(bank.checkpoint.held)), memory: new Map(m11Clone(bank.checkpoint.memory)) as ReturnType<typeof machine.checkpoint>['memory'], randomTicks: new Map(bank.checkpoint.randomTicks), parameters: new Map(m11Clone(bank.checkpoint.parameters ?? [])) } as ReturnType<typeof machine.checkpoint>);
  try {
    const published = machine.evaluate(bank.calls, time), outputs: Record<string, SignalValue> = {};
    for (const binding of program.outputBindings) {
      const value = published.get(binding.source.nodeId)?.[binding.source.portId];
      if (value === undefined) m11Failure(node, 'M11_INVALID_SCOPE_IR', `실행 계층 출력 ${binding.port}가 없습니다.`);
      outputs[binding.port] = copyAnySignal(value);
    }
    // Every invocation commits, including the last loop iteration at the same physical time.
    machine.transition(published, bank.calls, time);
    const saved = machine.checkpoint();
    const overlay = (saved as typeof saved & { parameters?: Map<string, Record<string, unknown>> }).parameters;
    return { outputs, bank: { calls: bank.calls + 1, checkpoint: { held: m11Clone([...saved.held]), memory: m11Clone([...saved.memory]) as [string, StateValue][], randomTicks: [...saved.randomTicks], ...(overlay ? { parameters: m11Clone([...overlay]) } : {}) } } };
  } catch (error) {
    if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: node.id, hierarchyPath: [node.id, ...(diagnostic.hierarchyPath ?? [])], childNodeId: diagnostic.childNodeId ?? diagnostic.nodeId, iteration, message: `${node.id}/${diagnostic.nodeId ?? 'scope'}: ${diagnostic.message}` })));
    throw error;
  }
}

function m11Slice(node: IRNode, input: SignalValue, axis: number, index: number): SignalValue {
  const descriptor = describeAnySignal(input), shape = descriptor.shape;
  if (axis >= shape.length) m11Failure(node, 'M11_PARTITION_AXIS', 'ForEach 축이 입력 rank를 벗어났습니다.');
  const inner = shape.slice(axis + 1).reduce((size, dimension) => size * dimension, 1), outer = shape.slice(0, axis).reduce((size, dimension) => size * dimension, 1), data: unknown[] = [];
  const typed = typeof input === 'object' && input !== null && !Array.isArray(input) && input.kind === 'typed';
  const flat = typed ? input.data : Array.isArray(input) ? Array.isArray(input[0]) ? (input as number[][] | boolean[][]).flat() : input : [input];
  for (let group = 0; group < outer; group++) for (let cell = 0; cell < inner; cell++) data.push(flat[(group * shape[axis]! + index) * inner + cell]);
  const nextShape = shape.filter((_, position) => position !== axis);
  if (typed) return validateAnySignal({ ...input, shape: nextShape, data });
  if (!nextShape.length) return data[0] as SignalValue;
  if (nextShape.length === 1) return data as SignalValue;
  return Array.from({ length: nextShape[0]! }, (_, row) => data.slice(row * nextShape[1]!, (row + 1) * nextShape[1]!)) as SignalValue;
}
function m11Collect(node: IRNode, outputs: SignalValue[], axis: number): SignalValue {
  const first = outputs[0]; if (first === undefined) m11Failure(node, 'M11_PARTITION_COUNT', 'ForEach에는 하나 이상의 partition이 필요합니다.');
  const descriptor = describeAnySignal(first), shape = [...descriptor.shape]; shape.splice(axis, 0, outputs.length);
  const inner = descriptor.shape.slice(axis).reduce((size, dimension) => size * dimension, 1), outer = descriptor.shape.slice(0, axis).reduce((size, dimension) => size * dimension, 1);
  const typed = typeof first === 'object' && first !== null && !Array.isArray(first) && first.kind === 'typed';
  const data: unknown[][] = outputs.map(output => { if (!sameSignalDescriptor(descriptor, describeAnySignal(output))) m11Failure(node, 'M11_PARTITION_SHAPE', 'ForEach partition 출력 자료형·형상이 다릅니다.'); return (typed ? (output as typeof first).data : Array.isArray(output) ? Array.isArray(output[0]) ? (output as number[][] | boolean[][]).flat() : output : [output]) as unknown[]; });
  const flat = Array.from({ length: outer }, (_, group) => data.flatMap(values => values.slice(group * inner, (group + 1) * inner))).flat();
  if (typed) return validateAnySignal({ ...first, shape, data: flat });
  if (shape.length === 1) return flat as SignalValue;
  return Array.from({ length: shape[0]! }, (_, row) => flat.slice(row * shape[1]!, (row + 1) * shape[1]!)) as SignalValue;
}

function m11ReadScope(node: IRNode, original: M11Memory, input: (port: string) => SignalValue, tick: number, time: number, Ts: number, charge: M11Charge): M11ReadResult {
  const program = m11ScopeProgram(node), p = node.parameters, memory = m11Clone(original), banks = memory.banks ?? [], outputs = memory.outputs ?? m11InitialOutputs(node);
  let enabled = true, execute = true, calls = 1;
  if (['hierarchy.enabled', 'hierarchy.enabled-triggered'].includes(node.blockType)) enabled = m11Control(node, input('enable')) > 0;
  if (node.blockType === 'hierarchy.action') enabled = m11Control(node, input('action'), true) > 0;
  if (['hierarchy.triggered', 'hierarchy.enabled-triggered', 'hierarchy.resettable', 'functions.reinitialize', 'functions.reset'].includes(node.blockType)) {
    const resetting = ['hierarchy.resettable', 'functions.reinitialize', 'functions.reset'].includes(node.blockType);
    const current = m11Control(node, input(resetting ? 'reset' : 'trigger'));
    const edge = m11Edge(memory.previousTrigger ?? 0, current, resetting ? 'rising' : p.trigger);
    memory.previousTrigger = current;
    if (node.blockType === 'hierarchy.resettable') { if (p.resetMode === 'level' ? current > 0 : edge) banks.length = 0; }
    else if (node.blockType === 'functions.reinitialize') { execute = edge; if (edge) banks.length = 0; }
    else if (node.blockType === 'functions.reset') execute = edge;
    else execute = edge;
  }
  if (!enabled) {
    memory.wasEnabled = false; memory.banks = banks;
    memory.outputs = p.disabledOutput === 'reset' ? m11InitialOutputs(node) : m11CopyOutputs(outputs);
    return { outputs: m11CopyOutputs(memory.outputs), publicationMemory: memory };
  }
  if ((p.stateOnEnable === 'reset' && !memory.wasEnabled) || node.blockType === 'hierarchy.action' && p.actionReset === 'reset' && !memory.wasEnabled) banks.length = 0;
  memory.wasEnabled = true;
  if (node.blockType === 'hierarchy.function-call') { const count = m11Control(node, input('call')); if (!Number.isSafeInteger(count) || count < 0 || count > 64) m11Failure(node, 'M11_CALL_COUNT', '함수 호출 개수는0~64 정수여야 합니다.'); const rate = p.callEventRate as { period: number; offset: number } | undefined; calls = rate && (tick < rate.offset || (tick - rate.offset) % rate.period !== 0) ? 0 : count; }
  if (node.blockType === 'functions.initialize') execute = !memory.initialized;
  if (node.blockType === 'functions.terminate') execute = tick === p.terminalTick;
  if (node.blockType === 'hierarchy.for-iterator') calls = p.count as number;
  if (node.blockType === 'hierarchy.while-iterator') { execute = m11Control(node, input('condition'), true) > 0; calls = p.maxIterations as number; }
  if (!execute || calls === 0) { memory.banks = banks; memory.outputs = m11CopyOutputs(outputs); return { outputs: m11CopyOutputs(outputs), publicationMemory: memory }; }
  const inputs: Record<string, SignalValue> = {};
  for (const binding of program.inputBindings) if (binding.port !== p.iterationPort) inputs[binding.port] = copyAnySignal(input(binding.port));
  if (['hierarchy.for-each', 'hierarchy.array-processing'].includes(node.blockType)) {
    if (program.inputBindings.length !== 1 || program.outputBindings.length !== 1) m11Failure(node, 'M11_PARTITION_SIGNATURE', 'ForEach는 데이터 입력·출력 하나씩만 지원합니다.');
    const inBinding = program.inputBindings[0]!, outBinding = program.outputBindings[0]!, axis = p.axis as number, descriptor = describeAnySignal(inputs[inBinding.port]!), count = descriptor.shape[axis];
    if (!count || count > 64) m11Failure(node, 'M11_PARTITION_COUNT', 'ForEach partition은1~64개 이하여야 합니다.');
    charge(node, count! * (structuredStorageElements(inputs[inBinding.port]!) + 8));
    const collected: SignalValue[] = [];
    for (let index = 0; index < count!; index++) { const invoked = m11InvokeScope(node, banks[index] ?? { calls: 0 }, { [inBinding.port]: m11Slice(node, inputs[inBinding.port]!, axis, index) }, time, Ts, charge, index); banks[index] = invoked.bank; collected.push(invoked.outputs[outBinding.port]!); }
    memory.banks = banks; memory.outputs = { [outBinding.port]: m11Collect(node, collected, axis) }; memory.publishedTick = tick; return { outputs: m11CopyOutputs(memory.outputs), publicationMemory: memory };
  }
  if (['hierarchy.pixel-processing', 'hierarchy.neighborhood-processing'].includes(node.blockType)) {
    if (program.inputBindings.length !== 1 || program.outputBindings.length !== 1) m11Failure(node, 'M11_PARTITION_SIGNATURE', '픽셀·이웃 창 실행에는 입력·출력 하나씩이 필요합니다.');
    const inBinding = program.inputBindings[0]!, outBinding = program.outputBindings[0]!, value = inputs[inBinding.port]!, descriptor = describeAnySignal(value), [rows, cols] = descriptor.shape;
    if (descriptor.shape.length !== 2 || !rows || !cols || rows * cols > 64) m11Failure(node, 'M11_PARTITION_COUNT', '픽셀·이웃 창 실행은 최대64 위치의2D 배열을 지원합니다.');
    const width = node.blockType === 'hierarchy.neighborhood-processing' ? p.window as number : 1;
    charge(node, rows! * cols! * width * width * (structuredStorageElements(value) + rows! + cols! + 8));
    const collected: SignalValue[] = [];
    for (let row = 0; row < rows!; row++) for (let col = 0; col < cols!; col++) {
      const window = node.blockType === 'hierarchy.neighborhood-processing' ? p.window as number : 1, radius = (window - 1) / 2, cells: SignalValue[] = [];
      for (let wr = -radius; wr <= radius; wr++) for (let wc = -radius; wc <= radius; wc++) {
        let r = row + wr, c = col + wc;
        if (p.boundary === 'wrap') { r = (r % rows! + rows!) % rows!; c = (c % cols! + cols!) % cols!; }
        else if (p.boundary === 'clamp' || window === 1) { r = Math.max(0, Math.min(rows! - 1, r)); c = Math.max(0, Math.min(cols! - 1, c)); }
        const scalarDescriptor = { ...descriptor, shape: [] };
        cells.push(r < 0 || r >= rows! || c < 0 || c >= cols! ? zeroAnySignal(scalarDescriptor) : m11Slice(node, m11Slice(node, value, 0, r), 0, c));
      }
      const argument = window === 1 ? cells[0]! : m11Reshape(node, m11Collect(node, cells, 0), [window, window]);
      const index = row * cols! + col, invoked = m11InvokeScope(node, banks[index] ?? { calls: 0 }, { [inBinding.port]: argument }, time, Ts, charge, index);
      const result = invoked.outputs[outBinding.port]!; if (describeAnySignal(result).shape.length) m11Failure(node, 'M11_PARTITION_SHAPE', '픽셀·이웃 창 자식 출력은 scalar여야 합니다.');
      banks[index] = invoked.bank; collected.push(result);
    }
    memory.banks = banks; memory.outputs = { [outBinding.port]: m11Reshape(node, m11Collect(node, collected, 0), [rows!, cols!]) }; memory.publishedTick = tick;
    return { outputs: m11CopyOutputs(memory.outputs), publicationMemory: memory };
  }
  let latest = outputs;
  for (let index = 0; index < calls; index++) {
    const bank = p.statePerIteration === 'reset' ? { calls: 0 } : banks[0] ?? { calls: 0 };
    const invoked = m11InvokeScope(node, bank, inputs, time, Ts, charge, index); banks[0] = invoked.bank; latest = invoked.outputs;
    if (node.blockType === 'hierarchy.while-iterator') {
      const continuing = m11Control(node, latest[p.conditionOutput as string]!, true) > 0;
      if (!continuing) break;
      if (index === calls - 1) m11Failure(node, 'M11_ITERATION_LIMIT', 'While body가 최대 반복 횟수에서도 true를 반환했습니다.');
    }
  }
  memory.banks = banks; memory.outputs = Object.fromEntries(Object.entries(latest).filter(([port]) => port !== p.conditionOutput));
  memory.publishedTick = tick; if (node.blockType === 'functions.initialize') memory.initialized = true;
  return { outputs: m11CopyOutputs(memory.outputs), publicationMemory: memory };
}
function m11Reshape(node: IRNode, value: SignalValue, shape: number[]): SignalValue {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'typed') return validateAnySignal({ ...value, shape });
  const flat = Array.isArray(value) ? Array.isArray(value[0]) ? (value as number[][] | boolean[][]).flat() : value : [value];
  if (shape.reduce((size, axis) => size * axis, 1) !== flat.length) m11Failure(node, 'M11_PARTITION_SHAPE', '합성 배열의 원소 수가 다릅니다.');
  return shape.length === 1 ? flat as SignalValue : Array.from({ length: shape[0]! }, (_, row) => flat.slice(row * shape[1]!, (row + 1) * shape[1]!)) as SignalValue;
}

function m11Messages(node: IRNode, input: SignalValue): MessageSignal { const value = validateStructuredSignal(input); if (value.kind !== 'messages') m11Failure(node, 'M11_MESSAGE_TYPE', '메시지 신호가 필요합니다.'); return value as MessageSignal; }
function m11Seen(node: IRNode, seen: { producer: string; sequence: number }[], item: MessageItem): boolean {
  const previous = seen.find(entry => entry.producer === item.producer);
  if (previous && item.sequence <= previous.sequence) return true;
  if (previous) previous.sequence = item.sequence;
  else { if (seen.length >= 128) m11Failure(node, 'M11_MESSAGE_PRODUCER_LIMIT', '한 큐·수신자의 메시지 생산자는128개 이하여야 합니다.'); seen.push({ producer: item.producer, sequence: item.sequence }); }
  return false;
}
function m11QueueMessage(item: MessageItem & { arrival?: number }): MessageItem { return { producer: item.producer, sequence: item.sequence, time: item.time, priority: item.priority, payload: copyAnySignal(item.payload) }; }
export function m11Read(node: IRNode, memory: M11Memory, input: (port: string) => SignalValue, tick: number, time: number, Ts: number, charge: M11Charge = () => {}, frame?: M11Frame): M11ReadResult {
  if (M11_SCOPE_BLOCKS.has(node.blockType)) return m11ReadScope(node, memory, input, tick, time, Ts, charge);
  if (node.blockType === 'route.data-store-memory') return { outputs: {} };
  if (node.blockType === 'route.merge') {
    if (!frame) m11Failure(node, 'M11_FRAME_REQUIRED', '조건 병합에는 실행 frame이 필요합니다.');
    const origins = node.parameters.mergeSources as Record<string, string>, writers = Object.entries(origins).filter(([, origin]) => frame!.readMemory(origin)?.publishedTick === tick);
    if (writers.length > 1) m11Failure(node, 'M11_MERGE_CONFLICT', '같은 due에 두 conditional writer가 출력했습니다.');
    const next = m11Clone(memory); if (writers.length) next.value = copyAnySignal(input(writers[0]![0]));
    return { outputs: { out: copyAnySignal(next.value!) }, publicationMemory: next };
  }
  if (node.blockType === 'events.feedback-latch') return { outputs: { out: copyAnySignal(memory.value!) } };
  if (node.blockType === 'events.send') {
    const next = m11Clone(memory), send = m11Control(node, input('send'), true) > 0;
    if (!send) return { outputs: { out: { kind: 'messages', items: [] } }, publicationMemory: next };
    const sequence = next.sequence ?? 0;
    if (!Number.isSafeInteger(sequence) || sequence >= Number.MAX_SAFE_INTEGER) m11Failure(node, 'M11_MESSAGE_SEQUENCE_LIMIT', '메시지 sequence 상한을 초과했습니다.');
    const message = m11Messages(node, { kind: 'messages', items: [{ producer: node.parameters.producer as string, sequence, time, priority: node.parameters.priority as number, payload: copyAnySignal(input('payload')) }] });
    next.sequence = sequence + 1; return { outputs: { out: message }, publicationMemory: next };
  }
  if (node.blockType === 'events.queue') {
    const next = m11Clone(memory), queue = next.messageQueue ?? [], size = queue.length, receive = m11Control(node, input('receive'), true) > 0;
    queue.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival);
    const dequeued = receive ? queue.splice(0, node.parameters.maxDequeue as number) : [];
    next.messageQueue = queue;
    charge(node, 8 * Math.max(1, size) + dequeued.reduce((sum, item) => sum + structuredStorageElements(item.payload), 0));
    return { outputs: { out: m11Messages(node, { kind: 'messages', items: dequeued.map(m11QueueMessage) }), size }, publicationMemory: next };
  }
  if (node.blockType === 'events.receive') {
    const next = m11Clone(memory), messages = m11Messages(node, input('in')), item = messages.items[0], seen = next.seen ?? [];
    const valid = !!item && !m11Seen(node, seen, item); if (valid) next.value = copyAnySignal(item.payload);
    next.seen = seen;
    return { outputs: { out: copyAnySignal(next.value!), valid }, publicationMemory: next };
  }
  if (node.blockType === 'events.hit-scheduler') {
    const hit = (node.parameters.times as number[]).some(at => Math.abs(at - time) <= 64 * Number.EPSILON * Math.max(1, Math.abs(at), Math.abs(time))), next = m11Clone(memory);
    if (!hit || next.lastHitTime === time) return { outputs: { out: 0 }, publicationMemory: next };
    next.lastHitTime = time; return { outputs: { out: node.parameters.count as number }, publicationMemory: next };
  }
  m11Failure(node, 'M11_UNSUPPORTED_BLOCK', 'M11 실행 경계 계약이 없습니다.');
}
/** Delayed writes are staged only after every current output has been validated. */
export function m11Commit(node: IRNode, memory: M11Memory, input: (port: string) => SignalValue, _outputs: Record<string, SignalValue>, _tick: number, _time: number, _Ts: number, charge: M11Charge = () => {}): M11Memory {
  if (node.blockType === 'events.feedback-latch') return { ...m11Clone(memory), value: copyAnySignal(input('in')) };
  if (node.blockType !== 'events.queue') return memory;
  const next = m11Clone(memory), queue = next.messageQueue ?? [], seen = next.seen ?? [], messages = m11Messages(node, input('in')), capacity = node.parameters.capacity as number;
  for (const item of messages.items) {
    charge(node, structuredStorageElements(item.payload) + Math.max(1, seen.length + queue.length));
    if (m11Seen(node, seen, item)) continue;
    if (queue.length >= capacity) {
      if (node.parameters.overflow === 'error') m11Failure(node, 'M11_QUEUE_OVERFLOW', '메시지 큐가 지정한 용량을 초과했습니다.');
      if (node.parameters.overflow === 'drop-newest') continue;
      const oldest = queue.reduce((index, entry, position) => entry.arrival < queue[index]!.arrival ? position : index, 0); queue.splice(oldest, 1);
    }
    const arrival = next.nextArrival ?? 0; if (!Number.isSafeInteger(arrival) || arrival >= Number.MAX_SAFE_INTEGER) m11Failure(node, 'M11_MESSAGE_SEQUENCE_LIMIT', '메시지 arrival 상한을 초과했습니다.');
    queue.push({ ...m11QueueMessage(item), arrival }); next.nextArrival = arrival + 1;
  }
  next.messageQueue = queue; next.seen = seen; return next;
}
export function m11IndependentOutput(node: IRNode): boolean { return node.blockType === 'events.feedback-latch' || node.blockType === 'events.hit-scheduler'; }
export function m11OperationCost(node: IRNode, inputSize: number, outputSize: number): number | undefined {
  if (M11_SCOPE_BLOCKS.has(node.blockType)) return Math.max(1, inputSize + outputSize + Number(node.parameters.scopeStateElements ?? 0)) * 8;
  if (M11_STATE_BLOCKS.has(node.blockType)) return Math.max(1, inputSize + outputSize + Number(node.parameters.m11StateElements ?? 0)) * 8;
  return undefined;
}

function m11Bus(node: IRNode, input: SignalValue): BusSignal { const bus = validateStructuredSignal(input); if (bus.kind !== 'bus') m11Failure(node, 'M11_BUS_TYPE', '구조화 Bus 신호가 필요합니다.'); return bus as BusSignal; }
function m11BusPath(node: IRNode, bus: BusSignal, path: string[], replace?: SignalValue): SignalValue {
  const [name, ...rest] = path, field = bus.fields.find(entry => entry.name === name);
  if (!field) m11Failure(node, 'M11_BUS_FIELD', `Bus 필드 ${name}이 없습니다.`);
  if (!rest.length) { if (replace === undefined) return copyAnySignal(field!.value); field!.value = copyAnySignal(replace); return bus; }
  const nested = m11Bus(node, field!.value), result = m11BusPath(node, nested, rest, replace);
  if (replace !== undefined) { field!.value = result; return bus; } return result;
}
export function evaluateM11Node(node: IRNode, input: (port: string) => SignalValue, time = 0, frame?: M11Frame, charge: M11Charge = () => {}): Record<string, SignalValue> | undefined {
  const p = node.parameters;
  switch (node.blockType) {
    case 'source.signal': case 'io.structured-input': return { out: validateAnySignal(p.value) };
    case 'functions.element': case 'route.tag-visibility': case 'route.goto': return {};
    case 'io.structured-output': case 'sink.sequence-viewer': return { out: copyAnySignal(input('in')) };
    case 'route.from': return { out: copyAnySignal(input('in')) };
    case 'functions.typed': {
      const value = m11Control(node, input('in')); if (!node.expression) m11Failure(node, 'M11_EXPRESSION_IR', '검증된 수식 AST가 없습니다.');
      const out = evaluateExpression(node.expression!, value); if (!Number.isFinite(out)) m11Failure(node, 'NUMERIC_NONFINITE', '수식 결과가 유한 실수가 아닙니다.'); return { out };
    }
    case 'hierarchy.if': {
      const value = m11Control(node, input('in')), threshold = p.threshold as number;
      const then = p.comparison === 'gt' ? value > threshold : p.comparison === 'ge' ? value >= threshold : p.comparison === 'lt' ? value < threshold : p.comparison === 'le' ? value <= threshold : p.comparison === 'eq' ? value === threshold : value !== threshold;
      return { then, else: !then };
    }
    case 'hierarchy.switch-case': { const value = m11Control(node, input('in')), cases = p.cases as number[], selected = cases.findIndex(item => item === value); return { ...Object.fromEntries(cases.map((_, index) => [`case${index + 1}`, index === selected])), default: selected < 0 }; }
    case 'route.data-store-read': case 'state.reader': {
      if (!frame) m11Failure(node, 'M11_FRAME_REQUIRED', '지역 메모리 접근에는 실행 frame이 필요합니다.');
      const target = node.blockType === 'state.reader' ? p.stateTarget as string : p.storeOwner as string, value = frame!.readMemory(target)?.value;
      if (value === undefined) m11Failure(node, 'M11_STATE_TARGET', '승인된 지역 메모리 값이 없습니다.'); charge(node, structuredStorageElements(value)); return { out: copyAnySignal(value!) };
    }
    case 'route.data-store-write': case 'state.writer': {
      if (!frame) m11Failure(node, 'M11_FRAME_REQUIRED', '지역 메모리 접근에는 실행 frame이 필요합니다.');
      const target = node.blockType === 'state.writer' ? p.stateTarget as string : p.storeOwner as string, descriptor = (node.blockType === 'state.writer' ? p.stateDescriptor : p.storeDescriptor) as SignalDescriptor;
      const value = copyAnySignal(input('in')); checkSignal(value, descriptor, node.id);
      const prior = frame!.readMemory(target); if (!prior) m11Failure(node, 'M11_STATE_TARGET', '승인된 지역 메모리 값이 없습니다.');
      charge(node, structuredStorageElements(value)); frame!.writeMemory(target, { ...m11Clone(prior!), value }); return {};
    }
    case 'state.parameter-writer': {
      if (!frame) m11Failure(node, 'M11_FRAME_REQUIRED', '실행 매개변수 접근에는 실행 frame이 필요합니다.');
      const value = copyAnySignal(input('in')); checkSignal(value, p.parameterDescriptor as SignalDescriptor, node.id); charge(node, structuredStorageElements(value));
      frame!.writeParameter(p.parameterTarget as string, p.parameter as string, value); return {};
    }
    case 'route.structured-bus': { const names = typeof p.fields === 'string' ? JSON.parse(p.fields) as string[] : p.fields as string[]; return { out: validateAnySignal({ kind: 'bus', fields: names.map((name, index) => ({ name, value: copyAnySignal(input(`in${index + 1}`)) })) }) }; }
    case 'route.structured-select': return { out: m11BusPath(node, m11Bus(node, input('in')), (p.field as string).split('.')) };
    case 'route.structured-assign': return { out: m11BusPath(node, m11Bus(node, input('in')), (p.field as string).split('.'), input('value')) };
    case 'events.message-merge': {
      const messages: MessageItem[] = [], identities = new Map<string, MessageItem>();
      for (let port = 1; port <= (p.count as number); port++) for (const item of m11Messages(node, input(`in${port}`)).items) { const identity = `${item.producer}:${item.sequence}`, prior = identities.get(identity); if (prior) { if (JSON.stringify(prior) !== JSON.stringify(item)) m11Failure(node, 'M11_MESSAGE_ID_CONFLICT', '동일 메시지 ID의 내용이 서로 다릅니다.'); continue; } identities.set(identity, item); messages.push(item); }
      messages.sort((a, b) => a.priority - b.priority); return { out: m11Messages(node, { kind: 'messages', items: messages }) };
    }
    case 'events.function-call-generator': return { out: p.count as number };
    case 'events.function-call-split': { const calls = m11Control(node, input('in')); if (!Number.isSafeInteger(calls) || calls < 0 || calls > 64) m11Failure(node, 'M11_CALL_COUNT', '함수 호출 개수는0~64 정수여야 합니다.'); return Object.fromEntries(Array.from({ length: p.count as number }, (_, index) => [`out${index + 1}`, calls])); }
  }
  return undefined;
}


