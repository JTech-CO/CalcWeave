import { ModelError, type AdapterLifecycle, type IRNode, type MessageItem, type MessageSignal, type SignalValue } from '../../model/src/types';
import { copyAnySignal, structuredStorageElements, validateStructuredSignal } from '../../model/src/structured';
import { invokeM14Wasm, m14WasmCost, type M14WasmFunctions } from './m14-wasm';

export const M14_STATE_BLOCKS = new Set(['adapter.wasm-accumulator', 'adapter.entity-transport']);
export interface M14QueueEntry extends MessageItem { deadline: number; earliestTick: number; arrival: number }
export interface M14Memory {
  m14Value?: number; m14PreviousReset?: boolean; m14ResetActive?: boolean; m14Updates?: number; m14Resets?: number; m14Reads?: number; m14Initialized?: boolean;
  m14Queue?: M14QueueEntry[]; m14Seen?: { producer: string; sequence: number }[]; m14Arrival?: number;
}
export interface M14ReadResult { outputs: Record<string, SignalValue>; publicationMemory: M14Memory }
function m14Failure(node: IRNode, code: string, message: string): never { throw new ModelError([{ code, nodeId: node.id, message }]); }
function m14Number(node: IRNode, value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) m14Failure(node, 'M14_ABI_SCALAR_REQUIRED', '고정 어댑터에는 유한한 legacy float64 scalar가 필요합니다.'); return value; }
function m14Increment(node: IRNode, value: number): number { if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) m14Failure(node, 'M14_STATE_COUNTER', '어댑터 상태 카운터가 안전 정수 상한을 벗어났습니다.'); return value + 1; }
function m14CopyItem(item: MessageItem): MessageItem { return { ...item, payload: copyAnySignal(item.payload) }; }

export function evaluateM14Node(node: IRNode, input: (port: string) => SignalValue): Record<string, SignalValue> | undefined {
  if (node.blockType !== 'adapter.wasm-affine') return undefined;
  return { out: invokeM14Wasm(node, 'affine', [m14Number(node, input('in')), m14Number(node, node.parameters.gain), m14Number(node, node.parameters.bias)]) };
}
export function m14OperationCost(node: IRNode, inputSize: number, outputSize: number): number | undefined {
  if (node.blockType === 'adapter.wasm-affine') return m14WasmCost('calcweave.wasm-affine-f64-v1');
  if (node.blockType === 'adapter.wasm-accumulator') return 2 * m14WasmCost('calcweave.wasm-accumulator-f64-v1') + 32;
  if (node.blockType === 'adapter.entity-transport') {
    const payload = structuredStorageElements(node.parameters.entityPayloadDescriptor as Parameters<typeof structuredStorageElements>[0]);
    // Validation/copies, FIFO scans, per-arrival bounded producer search and staged queue copies.
    return 64 * (payload + 128 * 4 + 96) + Number(node.parameters.capacity) * (payload * 4 + 96) + inputSize * 4 + outputSize * 4 + 128 * 4;
  }
  return undefined;
}
/** Includes actual initialize, initial held-output read and the prepaid fixed terminate allowance. */
export function m14InitializationCost(node: IRNode): number { return node.blockType === 'adapter.wasm-accumulator' ? 3 * m14WasmCost('calcweave.wasm-accumulator-f64-v1') : 0; }
export function m14InitialMemory(node: IRNode, bindings?: M14WasmFunctions): M14Memory {
  if (node.blockType === 'adapter.wasm-accumulator') return { m14Value: invokeM14Wasm(node, 'initialize', [m14Number(node, node.parameters.initial)], bindings), m14PreviousReset: false, m14ResetActive: false, m14Updates: 0, m14Resets: 0, m14Reads: 0, m14Initialized: true };
  if (node.blockType === 'adapter.entity-transport') return { m14Queue: [], m14Seen: [], m14Arrival: 0 };
  return {};
}
export function m14InitialOutput(node: IRNode, state: M14Memory, bindings?: M14WasmFunctions): Record<string, SignalValue> {
  if (node.blockType === 'adapter.wasm-accumulator') return { out: invokeM14Wasm(node, 'read', [m14Number(node, state.m14Value)], bindings) };
  if (node.blockType === 'adapter.entity-transport') return { out: { kind: 'messages', items: [] }, count: 0 };
  return {};
}
export function m14IndependentOutput(node: IRNode): boolean { return node.blockType === 'adapter.wasm-accumulator' && !node.inputs.reset; }

export function m14Read(node: IRNode, state: M14Memory, input: (port: string) => SignalValue, tick: number, time: number, bindings?: M14WasmFunctions): M14ReadResult {
  if (node.blockType === 'adapter.wasm-accumulator') {
    const reset = node.inputs.reset ? input('reset') : false;
    if (typeof reset !== 'boolean') m14Failure(node, 'M14_RESET_BOOLEAN_REQUIRED', 'reset에는 boolean scalar가 필요합니다.');
    const active = reset && (node.parameters.resetMode === 'level' || !state.m14PreviousReset);
    const value = active ? invokeM14Wasm(node, 'reset', [m14Number(node, node.parameters.initial)], bindings) : m14Number(node, state.m14Value);
    return { outputs: { out: invokeM14Wasm(node, 'read', [value], bindings) }, publicationMemory: { ...state, m14Value: value, m14PreviousReset: reset, m14ResetActive: active, m14Resets: active ? m14Increment(node, state.m14Resets!) : state.m14Resets, m14Reads: m14Increment(node, state.m14Reads!) } };
  }
  if (node.blockType !== 'adapter.entity-transport') m14Failure(node, 'M14_ADAPTER_ABI', '지원하는 M14 상태 블럭이 아닙니다.');
  const identity = node.parameters.adapterIdentity as { id?: unknown; version?: unknown; abiVersion?: unknown } | undefined;
  if (!identity || identity.id !== 'calcweave.entity-fixed-deadline-v1' || identity.version !== 1 || identity.abiVersion !== 1 || Object.keys(identity).sort().join(',') !== 'abiVersion,id,version') m14Failure(node, 'M14_ADAPTER_ABI', '메시지 운송 identity가 고정 catalog와 다릅니다.');
  const batch = validateStructuredSignal(input('in'));
  if (batch.kind !== 'messages') m14Failure(node, 'M14_MESSAGE_REQUIRED', '운송 입력에는 MessageSignal이 필요합니다.');
  const duration = m14Number(node, input('delay'));
  if (duration < 0) m14Failure(node, 'M14_ENTITY_DELAY', '메시지 도착 시 지연은 0 이상의 유한한 초 값이어야 합니다.');
  const deadline = time + duration, earliestTick = tick + node.sampleTime.period;
  if (!Number.isFinite(deadline) || !Number.isSafeInteger(earliestTick) || earliestTick < 0) m14Failure(node, 'M14_ENTITY_DEADLINE', '메시지 마감 시각·최초 due tick이 유한한 안전 범위를 벗어났습니다.');
  let queue = state.m14Queue!.map(entry => ({ ...entry, payload: copyAnySignal(entry.payload) }));
  const seen = state.m14Seen!.map(entry => ({ ...entry })), released: MessageItem[] = [];
  let arrival = state.m14Arrival!;
  while (queue.length && released.length < Number(node.parameters.maxRelease) && queue[0]!.earliestTick <= tick && queue[0]!.deadline <= time) {
    const entry = queue.shift()!; released.push({ producer: entry.producer, sequence: entry.sequence, time: entry.time, priority: entry.priority, payload: copyAnySignal(entry.payload) });
  }
  for (const item of (batch as MessageSignal).items) {
    const known = seen.find(entry => entry.producer === item.producer);
    // Sequence high-water is deliberate: stale/reordered identities never re-enter on a held batch.
    if (known && item.sequence <= known.sequence) continue;
    if (known) known.sequence = item.sequence;
    else { if (seen.length >= 128) m14Failure(node, 'M14_ENTITY_PRODUCER_BUDGET', '운송 도식의 producer 식별자는128개 이하여야 합니다.'); seen.push({ producer: item.producer, sequence: item.sequence }); }
    arrival = m14Increment(node, arrival);
    if (queue.length >= Number(node.parameters.capacity)) {
      if (node.parameters.overflow === 'error') m14Failure(node, 'M14_ENTITY_CAPACITY', '메시지 FIFO 보관 용량을 초과했습니다.');
      if (node.parameters.overflow === 'drop-newest') continue;
      if (node.parameters.overflow !== 'drop-oldest') m14Failure(node, 'M14_ADAPTER_ABI', '등록한 메시지 초과 처리 정책이 아닙니다.');
      queue = queue.slice(1);
    }
    queue.push({ ...m14CopyItem(item), deadline, earliestTick, arrival });
  }
  return { outputs: { out: { kind: 'messages', items: released }, count: queue.length }, publicationMemory: { m14Queue: queue, m14Seen: seen, m14Arrival: arrival } };
}
export function m14Commit(node: IRNode, state: M14Memory, input: (port: string) => SignalValue, bindings?: M14WasmFunctions): M14Memory {
  if (node.blockType !== 'adapter.wasm-accumulator') return state;
  return { ...state, m14Value: invokeM14Wasm(node, 'accumulate', [m14Number(node, state.m14Value), m14Number(node, input('in')), m14Number(node, node.parameters.gain)], bindings), m14Updates: m14Increment(node, state.m14Updates!) };
}
/** The single straight-line cleanup call is prepaid; published memory never gains a terminated flag. */
export function m14Terminate(node: IRNode, state: M14Memory, reason: AdapterLifecycle['reason'], bindings?: M14WasmFunctions): AdapterLifecycle | undefined {
  if (node.blockType !== 'adapter.wasm-accumulator' || !state.m14Initialized) return undefined;
  invokeM14Wasm(node, 'terminate', [m14Number(node, state.m14Value)], bindings);
  return { nodeId: node.id, profileId: 'calcweave.wasm-accumulator-f64-v1', initialized: true, terminated: true, reason };
}
