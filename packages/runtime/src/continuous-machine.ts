import type { CompiledModel, IRNode, SignalValue, StateValue } from '../../model/src/types';
import { checkSignal, copySignal, evaluateSignalNode, finiteNumber, interpolateTable, numericFailure, replayDataset } from './kernels';

export type ContinuousValues = Map<string, Record<string, SignalValue>>;
export interface ContinuousEvent { nodeId: string; kind: 'crossing' | 'reset' | 'relay'; direction: number; threshold?: number }
type ContinuousMemory = { value?: SignalValue; previous?: number; previousTime?: number; priorTime?: number; slope?: number; on?: boolean; history?: { time: number; value: number }[]; historyStart?: number; historyLength?: number; jumpTimes?: number[]; jumpStart?: number; jumpLength?: number };

/** Scalar ODE state and accepted-boundary memory. evaluate/derivative are pure. */
export function createContinuousMachine(compiled: CompiledModel, charge: (node: IRNode) => void) {
  const nodes = compiled.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ranges = new Map<string, { start: number; length: number }>();
  const memories = new Map<string, ContinuousMemory>();
  const initial: number[] = [];
  const initialFor = (node: IRNode): number[] => {
    const p = node.parameters;
    switch (node.blockType) {
      case 'continuous.integrator': return [Number(p.initial)];
      case 'continuous.second-order-integrator': return [Number(p.initialPosition), Number(p.initialVelocity)];
      case 'continuous.state-space': case 'continuous.transfer-function': case 'continuous.zero-pole': return [...p.initial as number[]];
      case 'continuous.pid': return [Number(p.initialIntegral), Number(p.initialFilter)];
      case 'continuous.derivative': return [Number(p.initial)];
      default: return [];
    }
  };
  for (const node of nodes) {
    const values = initialFor(node);
    if (values.length) { ranges.set(node.id, { start: initial.length, length: values.length }); initial.push(...values); }
    switch (node.blockType) {
      case 'time.memory': case 'time.zero-order-hold': memories.set(node.id, { value: copySignal(node.parameters.initial as SignalValue) }); break;
      case 'time.first-order-hold': memories.set(node.id, { value: copySignal(node.parameters.initial as SignalValue), slope: 0 }); break;
      case 'time.transport-delay': memories.set(node.id, { history: [], jumpTimes: [] }); break;
      case 'logic.hit-crossing': memories.set(node.id, {}); break;
      case 'nonlinear.relay': memories.set(node.id, { on: node.parameters.initial === 'on' }); break;
    }
  }
  const input = (values: ContinuousValues, node: IRNode, port = 'in'): SignalValue => {
    const endpoint = node.inputs[port];
    const value = endpoint && values.get(endpoint.nodeId)?.[endpoint.portId];
    if (value === undefined) numericFailure('RUNTIME_INVALID_IR', node.id, '연속 단계의 입력을 읽을 수 없습니다.');
    return value;
  };
  const scalar = (values: ContinuousValues, node: IRNode, port = 'in'): number => finiteNumber(input(values, node, port), node.id);
  const vector = (state: number[], node: IRNode): number[] => {
    const range = ranges.get(node.id);
    return range ? state.slice(range.start, range.start + range.length) : [];
  };
  const dot = (a: number[], b: number[], id: string): number => a.reduce((sum, coefficient, index) => finiteNumber(sum + coefficient * b[index]!, id), 0);
  const polynomial = (roots: number[]): number[] => roots.reduce((coefficients, root) => {
    const next = Array(coefficients.length + 1).fill(0) as number[];
    coefficients.forEach((coefficient, index) => { next[index] += coefficient; next[index + 1] -= coefficient * root; });
    return next;
  }, [1]);
  const transferParameters = (node: IRNode): { a: number[]; b: number[]; d: number } => {
    const p = node.parameters;
    const denominator = node.blockType === 'continuous.zero-pole' ? polynomial(p.poles as number[]) : p.denominator as number[];
    const numerator = node.blockType === 'continuous.zero-pole' ? polynomial(p.zeros as number[]).map((value) => value * Number(p.gain)) : p.numerator as number[];
    const a = denominator.map((value) => finiteNumber(value / denominator[0]!, node.id));
    const b = [...Array(Math.max(0, a.length - numerator.length)).fill(0), ...numerator].map((value) => finiteNumber(value / denominator[0]!, node.id));
    return { a, b, d: b[0]! };
  };
  const transfers = new Map(nodes.filter((node) => node.blockType === 'continuous.transfer-function' || node.blockType === 'continuous.zero-pole').map((node) => [node.id, transferParameters(node)]));
  function delayed(node: IRNode, time: number): number {
    const memory = memories.get(node.id)!, history = memory.history!, start = memory.historyStart ?? 0, target = time - Number(node.parameters.delay);
    if (target < compiled.model.execution.startTime || history.length === start) return Number(node.parameters.initial);
    if (target <= history[start]!.time) return history[start]!.value;
    let low = start, high = history.length - 1;
    while (high - low > 1) { const middle = (low + high) >>> 1; if (history[middle]!.time <= target) low = middle; else high = middle; }
    if (target >= history[high]!.time) return history[high]!.value;
    const a = history[low]!, b = history[high]!, ratio = (target - a.time) / (b.time - a.time);
    return finiteNumber(a.value * (1 - ratio) + b.value * ratio, node.id);
  }
  function independent(node: IRNode): boolean {
    switch (node.blockType) {
      case 'continuous.integrator': case 'continuous.second-order-integrator': case 'time.memory': case 'time.transport-delay':
      case 'time.zero-order-hold': case 'time.first-order-hold': case 'logic.hit-crossing': case 'nonlinear.relay': return true;
      case 'continuous.state-space': return node.parameters.D === 0;
      case 'continuous.transfer-function': case 'continuous.zero-pole': return transfers.get(node.id)!.d === 0;
      case 'continuous.pid': return Number(node.parameters.kp) + Number(node.parameters.kd) * Number(node.parameters.filterN) === 0;
      default: return false;
    }
  }
  function output(node: IRNode, state: number[], time: number, values: ContinuousValues, eventMask: Set<string>, sourceTime = time, reader?: (port: string) => SignalValue): Record<string, SignalValue> {
    const p = node.parameters, x = vector(state, node), number = (key: string) => finiteNumber(p[key], node.id);
    const read = (port: string): SignalValue => reader ? reader(port) : input(values, node, port);
    const scalarInput = (): number => finiteNumber(read('in'), node.id);
    switch (node.blockType) {
      case 'continuous.integrator': return { out: x[0]! };
      case 'continuous.second-order-integrator': return { out: x[0]!, velocity: x[1]! };
      case 'continuous.state-space': return { out: finiteNumber(dot(p.C as number[], x, node.id) + (p.D === 0 ? 0 : number('D') * scalarInput()), node.id) };
      case 'continuous.transfer-function': case 'continuous.zero-pole': {
        const { a, b, d } = transfers.get(node.id)!;
        return { out: finiteNumber(x.reduce((sum, value, index) => sum + (b[a.length - 1 - index]! - d * a[a.length - 1 - index]!) * value, 0) + (d === 0 ? 0 : d * scalarInput()), node.id) };
      }
      case 'continuous.pid': return { out: finiteNumber(number('ki') * x[0]! - number('kd') * number('filterN') * x[1]! + (independent(node) ? 0 : (number('kp') + number('kd') * number('filterN')) * scalarInput()), node.id) };
      case 'continuous.derivative': return { out: finiteNumber(number('filterN') * (scalarInput() - x[0]!), node.id) };
      case 'time.memory': case 'time.zero-order-hold': return { out: memories.get(node.id)!.value! };
      case 'time.first-order-hold': {
        const memory = memories.get(node.id)!;
        return { out: finiteNumber(Number(memory.value) + (memory.previousTime === undefined ? 0 : (time - memory.previousTime) * memory.slope!), node.id) };
      }
      case 'time.transport-delay': return { out: delayed(node, sourceTime) };
      case 'logic.hit-crossing': return { out: eventMask.has(node.id) };
      case 'nonlinear.relay': return { out: memories.get(node.id)!.on ? number('onValue') : number('offValue') };
      case 'source.step': return { out: sourceTime < number('stepTime') ? number('before') : number('after') };
      case 'source.ramp': return { out: finiteNumber(number('initial') + number('slope') * Math.max(0, time - number('startTime')), node.id) };
      case 'source.sine-wave': return { out: finiteNumber(number('amplitude') * Math.sin(2 * Math.PI * number('frequency') * time + number('phase')) + number('bias'), node.id) };
      case 'source.clock': return { out: time };
      case 'source.dataset': return { out: replayDataset(node, sourceTime) };
      case 'source.repeating-sequence': {
        const times = p.times as number[], period = times.at(-1)!, remainder = sourceTime % period, phase = remainder < 0 ? remainder + period : remainder;
        return { out: interpolateTable(phase, times, p.values as number[], String(p.interpolation), 'clip', node.id) };
      }
      default: return evaluateSignalNode(node, read, undefined, sourceTime);
    }
  }
  function evaluateNode(node: IRNode, time: number, state: number[], reader: (port: string) => SignalValue, eventMask: Set<string>): Record<string, SignalValue> {
    charge(node); const outputs = output(node, state, time, new Map(), eventMask, time, reader);
    for (const [port, descriptor] of Object.entries(node.outputs)) checkSignal(outputs[port], descriptor, node.id);
    return outputs;
  }
  function evaluate(time: number, state: number[], frozen: ContinuousValues, eventMask = new Set<string>(), sourceTime = time): ContinuousValues {
    const values = new Map(frozen);
    const emit = (node: IRNode): void => {
      charge(node); const outputs = output(node, state, time, values, eventMask, sourceTime);
      for (const [port, descriptor] of Object.entries(node.outputs)) checkSignal(outputs[port], descriptor, node.id);
      values.set(node.id, outputs);
    };
    for (const node of nodes) if ((node.executionDomain !== 'discrete' || node.blockType === 'time.zero-order-hold') && independent(node)) emit(node);
    for (const node of nodes) if (node.executionDomain !== 'discrete' && !independent(node)) emit(node);
    // Boundary blocks remain available even when their domain is discrete.
    for (const node of nodes) if (node.blockType === 'time.zero-order-hold') values.set(node.id, output(node, state, time, values, eventMask));
    return values;
  }
  function derivative(time: number, state: number[], frozen: ContinuousValues, sourceTime = time): number[] {
    const values = evaluate(time, state, frozen, new Set(), sourceTime), slopes: number[] = [];
    for (const [id, range] of ranges) {
      const node = byId.get(id)!, p = node.parameters, x = state.slice(range.start, range.start + range.length), u = scalar(values, node);
      let result: number[];
      switch (node.blockType) {
        case 'continuous.integrator': result = [u]; break;
        case 'continuous.second-order-integrator': result = [x[1]!, u]; break;
        case 'continuous.state-space': result = (p.A as number[][]).map((row, index) => dot(row, x, id) + (p.B as number[])[index]! * u); break;
        case 'continuous.transfer-function': case 'continuous.zero-pole': {
          const { a } = transfers.get(id)!;
          result = [...x.slice(1), u - x.reduce((sum, value, index) => sum + a[a.length - 1 - index]! * value, 0)]; break;
        }
        case 'continuous.pid': result = [u, Number(p.filterN) * (u - x[1]!)]; break;
        case 'continuous.derivative': result = [Number(p.filterN) * (u - x[0]!)]; break;
        default: result = [];
      }
      slopes.push(...result.map((value) => finiteNumber(value, id)));
    }
    return slopes;
  }
  function eventCandidates(before: ContinuousValues, after: ContinuousValues): ContinuousEvent[] {
    const events: ContinuousEvent[] = [];
    for (const node of nodes) {
      if (node.blockType === 'nonlinear.saturation' && node.executionDomain !== 'discrete' && node.outputs.out?.shape.length === 0) {
        const a = scalar(before, node), b = scalar(after, node);
        for (const threshold of [Number(node.parameters.lower), Number(node.parameters.upper)]) {
          if (a < threshold && b >= threshold || a > threshold && b <= threshold) events.push({ nodeId: node.id, kind: 'crossing', direction: b > a ? 1 : -1, threshold });
        }
      }
      if (node.blockType === 'logic.hit-crossing' || node.blockType === 'nonlinear.relay') {
        const a = scalar(before, node), b = scalar(after, node);
        const on = memories.get(node.id)!.on;
        const threshold = Number(node.parameters[node.blockType === 'logic.hit-crossing' ? 'threshold' : on ? 'offThreshold' : 'onThreshold']);
        const rising = a < threshold && b >= threshold, falling = a > threshold && b <= threshold;
        const direction = node.blockType === 'nonlinear.relay' ? on ? 'falling' : 'rising' : String(node.parameters.direction);
        if ((direction !== 'falling' && rising) || (direction !== 'rising' && falling)) events.push({ nodeId: node.id, kind: node.blockType === 'nonlinear.relay' ? 'relay' : 'crossing', direction: rising ? 1 : -1 });
      }
      if (node.blockType === 'continuous.integrator' && node.parameters.reset === 'rising' && input(before, node, 'reset') === false && input(after, node, 'reset') === true) events.push({ nodeId: node.id, kind: 'reset', direction: 1 });
    }
    return events;
  }
  function eventReached(event: ContinuousEvent, values: ContinuousValues): boolean {
    const node = byId.get(event.nodeId)!;
    if (event.kind === 'reset') return input(values, node, 'reset') === true;
    const threshold = event.threshold ?? Number(node.parameters[event.kind === 'crossing' ? 'threshold' : memories.get(node.id)!.on ? 'offThreshold' : 'onThreshold']);
    const value = scalar(values, node);
    return event.direction > 0 ? value >= threshold : value <= threshold;
  }
  function relaySettlingEvents(values: ContinuousValues): ContinuousEvent[] {
    return nodes.filter((node) => node.blockType === 'nonlinear.relay').flatMap((node) => {
      const on = memories.get(node.id)!.on, value = scalar(values, node);
      return !on && value >= Number(node.parameters.onThreshold) ? [{ nodeId: node.id, kind: 'relay' as const, direction: 1 }]
        : on && value <= Number(node.parameters.offThreshold) ? [{ nodeId: node.id, kind: 'relay' as const, direction: -1 }] : [];
    });
  }
  function applyEvents(state: number[], events: ContinuousEvent[], time: number, frozen: ContinuousValues): { state: number[]; mask: Set<string> } {
    const next = [...state], mask = new Set(events.filter((event) => event.kind === 'crossing' && byId.get(event.nodeId)!.blockType === 'logic.hit-crossing').map((event) => event.nodeId));
    for (const event of events) if (event.kind === 'relay') memories.get(event.nodeId)!.on = event.direction > 0;
    const values = evaluate(time, next, frozen, mask);
    for (const node of nodes) if (node.blockType === 'continuous.integrator' && node.parameters.reset === 'rising' && (events.some((event) => event.nodeId === node.id && event.kind === 'reset') || input(values, node, 'reset') === true && mask.has(node.inputs.reset!.nodeId))) next[ranges.get(node.id)!.start] = Number(node.parameters.initial);
    return { state: next, mask };
  }
  function acceptMemory(time: number, previousValues: ContinuousValues, currentValues: ContinuousValues, leftValues?: ContinuousValues): void {
    for (const node of nodes) {
      if (node.blockType === 'time.memory') memories.get(node.id)!.value = copySignal(input(previousValues, node));
      if (node.blockType === 'time.transport-delay') {
        const memory = memories.get(node.id)!, history = memory.history!, value = scalar(currentValues, node);
        if (leftValues) {
          const left = scalar(leftValues, node);
          if (left !== value) { history.push({ time, value: left }); memory.jumpTimes!.push(time); }
        }
        history.push({ time, value });
        const cutoff = time - Number(node.parameters.delay);
        let start = memory.historyStart ?? 0;
        while (history.length - start > 2 && history[start + 1]!.time < cutoff) start += 1;
        memory.historyStart = start;
        if (start > 1024 && start > history.length / 2) { memory.history = history.slice(start); memory.historyStart = 0; }
        let jumpStart = memory.jumpStart ?? 0;
        while (jumpStart < memory.jumpTimes!.length && memory.jumpTimes![jumpStart]! <= cutoff) jumpStart += 1;
        memory.jumpStart = jumpStart;
        if (jumpStart > 1024 && jumpStart > memory.jumpTimes!.length / 2) { memory.jumpTimes = memory.jumpTimes!.slice(jumpStart); memory.jumpStart = 0; }
        if (history.length - start > 100_000) numericFailure('RUNTIME_HISTORY_BUDGET', node.id, '지연 이력의 보관 한도를 초과했습니다.');
      }
    }
    const stored = [...memories.values()].reduce((count, memory) => count + ((memory.history?.length ?? 0) - (memory.historyStart ?? 0)) * 2 + (memory.jumpTimes?.length ?? 0) - (memory.jumpStart ?? 0), compiled.stateElements);
    if (stored > 100_000) numericFailure('RUNTIME_HISTORY_BUDGET', nodes.find((node) => node.blockType === 'time.transport-delay')?.id ?? nodes[0]!.id, '전체 상태와 지연 이력 한도를 초과했습니다.');
  }
  function captureHolds(time: number, tick: number, values: ContinuousValues, phase?: 'continuous' | 'discrete', only?: string): void {
    for (const node of nodes) if ((!only || node.id === only) && (node.blockType === 'time.zero-order-hold' || node.blockType === 'time.first-order-hold') && tick >= node.sampleTime.offset && (tick - node.sampleTime.offset) % node.sampleTime.period === 0) {
      const producer = byId.get(node.inputs.in!.nodeId)!;
      if (phase && (producer.executionDomain === 'discrete' ? 'discrete' : 'continuous') !== phase) continue;
      const memory = memories.get(node.id)!, value = scalar(values, node);
      if (node.blockType === 'time.zero-order-hold') { memory.value = value; continue; }
      if (memory.previousTime === time) {
        memory.slope = memory.priorTime === undefined ? 0 : finiteNumber((value - Number(memory.previous)) / (time - memory.priorTime), node.id);
      } else {
        memory.slope = memory.previousTime === undefined ? 0 : finiteNumber((value - Number(memory.value)) / (time - memory.previousTime), node.id);
        memory.previous = Number(memory.value); memory.priorTime = memory.previousTime; memory.previousTime = time;
      }
      memory.value = value;
    }
  }
  function finalState(state: number[], values: ContinuousValues): Record<string, SignalValue> {
    return Object.fromEntries(compiled.stateIds.filter((id) => byId.get(id)!.executionDomain !== 'discrete' || byId.get(id)!.blockType === 'time.zero-order-hold').map((id) => [id, copySignal(values.get(id)?.out ?? vector(state, byId.get(id)!)[0] ?? 0)]));
  }
  function stateMemory(state: number[]): Record<string, StateValue> {
    return Object.fromEntries([...ranges].map(([id]) => [id, { state: vector(state, byId.get(id)!) } as StateValue]).concat([...memories].map(([id, memory]) => {
      const { historyStart, historyLength: _length, jumpTimes: _jumps, jumpStart: _head, jumpLength: _jumpLength, ...snapshot } = memory;
      if (snapshot.history) snapshot.history = snapshot.history.slice(historyStart ?? 0);
      return [id, JSON.parse(JSON.stringify(snapshot)) as StateValue];
    })));
  }
  function validateState(state: number[]): void {
    for (const [id, range] of ranges) for (let index = range.start; index < range.start + range.length; index += 1) finiteNumber(state[index], id);
  }
  const maximumDelayStep = nodes.filter((node) => node.blockType === 'time.transport-delay').reduce((minimum, node) => Math.min(minimum, Number(node.parameters.delay)), Infinity);
  function nextDelayBoundary(time: number): number {
    let next = Infinity;
    for (const node of nodes) if (node.blockType === 'time.transport-delay') {
      const delay = Number(node.parameters.delay), memory = memories.get(node.id)!, jumps = memory.jumpTimes!;
      const first = compiled.model.execution.startTime + delay;
      const threshold = time + Math.abs(time) * Number.EPSILON * 8;
      if (first > threshold) next = Math.min(next, first);
      // A separate sorted index keeps lookup logarithmic even with long history.
      let low = memory.jumpStart ?? 0, high = jumps.length;
      while (low < high) { const middle = (low + high) >>> 1; if (jumps[middle]! + delay <= threshold) low = middle + 1; else high = middle; }
      if (low < jumps.length) next = Math.min(next, jumps[low]! + delay);
    }
    return next;
  }
  const checkpoint = (): Map<string, ContinuousMemory> => new Map([...memories].map(([id, memory]) => [id, { ...memory, historyLength: memory.history?.length, jumpLength: memory.jumpTimes?.length }]));
  const restore = (saved: Map<string, ContinuousMemory>): void => { memories.clear(); for (const [id, memory] of saved) {
    if (memory.history && memory.historyLength !== undefined) memory.history.length = memory.historyLength;
    if (memory.jumpTimes && memory.jumpLength !== undefined) memory.jumpTimes.length = memory.jumpLength;
    delete memory.historyLength; delete memory.jumpLength; memories.set(id, memory);
  } };
  return { initial, evaluate, evaluateNode, derivative, eventCandidates, eventReached, relaySettlingEvents, applyEvents, acceptMemory, captureHolds, finalState, stateMemory, validateState, maximumDelayStep, nextDelayBoundary, checkpoint, restore };
}
