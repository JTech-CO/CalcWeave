import type { CompiledModel, IRNode, SignalValue, StateValue } from '../../model/src/types';
import { checkSignal, copySignal, evaluateSignalNode, finiteNumber, interpolateTable, numericFailure, replayDataset } from './kernels';
import { m12AnalysisBus, m12AnalyzePlant, m12CheckDescriptorInitial, m12DescriptorDerivative, m12DescriptorOutput, m12NumericVector, m12PID, m12PIDGains, m12RateClamp, type M12DescriptorReduced } from './m12';
import { m12Newton } from './numerics';

export type ContinuousValues = Map<string, Record<string, SignalValue>>;
export interface ContinuousEvent { nodeId: string; kind: 'crossing' | 'reset' | 'relay'; direction: number; threshold?: number; domain?: 'state' | 'transport' | 'delay' | 'analysis' | 'backlash'; axis?: number }
type ContinuousMemory = { value?: SignalValue; previous?: number; previousTime?: number; priorTime?: number; slope?: number; on?: boolean; history?: { time: number; value: number }[]; historyStart?: number; historyLength?: number; jumpTimes?: number[]; jumpStart?: number; jumpLength?: number; m12History?: { time: number; value: number; phase?: number }[]; m12Jumps?: number[]; m12HistoryLength?: number; m12JumpLength?: number; analysisOutput?: SignalValue; analysisHit?: number; previousTrigger?: boolean };

/** Scalar ODE state and accepted-boundary memory. evaluate/derivative are pure. */
export function createContinuousMachine(compiled: CompiledModel, charge: (node: IRNode, work?: number) => void, resolveNode: (node: IRNode) => IRNode = node => node) {
  const nodes = compiled.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ranges = new Map<string, { start: number; length: number }>();
  const memories = new Map<string, ContinuousMemory>();
  const initial: number[] = [];
  const boundaryEpsilon = (value: number): number => Number.EPSILON * Math.max(1, Math.abs(value)) * 16;
  const initialFor = (node: IRNode): number[] => {
    const p = node.parameters;
    switch (node.blockType) {
      case 'continuous.integrator': return [Number(p.initial)];
      case 'continuous.second-order-integrator': return [Number(p.initialPosition), Number(p.initialVelocity)];
      case 'continuous.state-space': case 'continuous.transfer-function': case 'continuous.zero-pole': return [...p.initial as number[]];
      case 'continuous.pid': return [Number(p.initialIntegral), Number(p.initialFilter)];
      case 'continuous.derivative': return [Number(p.initial)];
      case 'continuous.integrator-limited': return [Number(p.initial)];
      case 'continuous.second-order-limited': return [Number(p.initialPosition), Number(p.initialVelocity)];
      case 'continuous.pid-2dof': return [Number(p.initialIntegral), Number(p.initialFilter)];
      case 'continuous.descriptor': return [...(p.descriptorReduced as M12DescriptorReduced).initial];
      case 'time.variable-transport-delay': return [0];
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
      case 'time.variable-delay': case 'time.variable-transport-delay': memories.set(node.id, { m12History: [], m12Jumps: [] }); break;
      case 'nonlinear.backlash': memories.set(node.id, { value: Number(node.parameters.initial) }); break;
      case 'nonlinear.rate-limiter-continuous': if (node.executionDomain !== 'discrete') memories.set(node.id, {}); break;
      case 'analysis.linearization': memories.set(node.id, { previousTrigger: false }); break;
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
  function m12Delay(node: IRNode, delay: number): number {
    if (node.blockType === 'time.variable-delay' && delay === 0 && node.parameters.handleZero === 'yes') return 0;
    if (!Number.isFinite(delay) || delay < Number(node.parameters.minDelay) || delay > Number(node.parameters.maxDelay)) numericFailure('M12_DELAY_BOUNDS', node.id, '순간 지연은 선언한 양의 최소·최대 범위 안이어야 합니다.');
    return delay;
  }
  function m12Delayed(node: IRNode, target: number, transport: boolean): number {
    const history = memories.get(node.id)!.m12History!, coordinate = (item: { time: number; phase?: number }) => transport ? item.phase! : item.time;
    if (!history.length || target < (transport ? 0 : compiled.model.execution.startTime)) return Number(node.parameters.initial);
    if (target < coordinate(history[0]!)) numericFailure('M12_HISTORY_UNDERRUN', node.id, '선언한 이력에서 지연 입력을 복원할 수 없습니다.');
    let low = 0, high = history.length;
    while (low < high) { const middle = (low + high) >>> 1; if (coordinate(history[middle]!) <= target) low = middle + 1; else high = middle; }
    const a = history[Math.max(0, low - 1)]!;
    if (low === history.length || target === coordinate(a)) return a.value;
    const b = history[low]!, fraction = (target - coordinate(a)) / (coordinate(b) - coordinate(a));
    return finiteNumber(a.value * (1 - fraction) + b.value * fraction, node.id);
  }
  const m12DueAnalysis = (node: IRNode, time: number, trigger: boolean): boolean => node.parameters.mode === 'triggered' ? trigger && !memories.get(node.id)!.previousTrigger : (node.parameters.times as number[]).some(at => Math.abs(at - time) <= Math.max(1, Math.abs(time)) * Number.EPSILON * 16) && memories.get(node.id)!.analysisHit !== time;
  function independent(node: IRNode): boolean {
    switch (node.blockType) {
      case 'continuous.integrator': case 'continuous.second-order-integrator': case 'time.memory': case 'time.transport-delay':
      case 'time.zero-order-hold': case 'time.first-order-hold': case 'logic.hit-crossing': case 'nonlinear.relay': return true;
      case 'continuous.state-space': return node.parameters.D === 0;
      case 'continuous.transfer-function': case 'continuous.zero-pole': return transfers.get(node.id)!.d === 0;
      case 'continuous.pid': return Number(node.parameters.kp) + Number(node.parameters.kd) * Number(node.parameters.filterN) === 0;
      case 'continuous.integrator-limited': case 'continuous.second-order-limited': case 'solver.algebraic-constraint': return true;
      case 'continuous.descriptor': { const p = node.parameters.descriptorReduced as M12DescriptorReduced; return !p.D.some(row => row.some(Boolean)) && !p.algebraicB.some(row => row.some(Boolean)); }
      case 'analysis.linearization': return node.parameters.mode === 'timed';
      case 'continuous.pid-2dof': { const gains = m12PIDGains(node); return gains.p === 0 && gains.d === 0; }
      default: return false;
    }
  }
  function output(node: IRNode, state: number[], time: number, values: ContinuousValues, eventMask: Set<string>, sourceTime = time, reader?: (port: string) => SignalValue): Record<string, SignalValue> {
    node = resolveNode(node);
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
      case 'continuous.integrator-limited': return { out: Math.min(number('upper'), Math.max(number('lower'), x[0]!)), limited: x[0]! <= number('lower') + boundaryEpsilon(number('lower')) || x[0]! >= number('upper') - boundaryEpsilon(number('upper')) };
      case 'continuous.second-order-limited': return { out: Math.min(number('positionUpper'), Math.max(number('positionLower'), x[0]!)), velocity: Math.min(number('velocityUpper'), Math.max(number('velocityLower'), x[1]!)), positionLimited: x[0]! <= number('positionLower') + boundaryEpsilon(number('positionLower')) || x[0]! >= number('positionUpper') - boundaryEpsilon(number('positionUpper')), velocityLimited: x[1]! <= number('velocityLower') + boundaryEpsilon(number('velocityLower')) || x[1]! >= number('velocityUpper') - boundaryEpsilon(number('velocityUpper')) };
      case 'continuous.descriptor': {
        const p = node.parameters.descriptorReduced as M12DescriptorReduced, u = independent(node) ? Array(p.m).fill(0) as number[] : m12NumericVector(read('in'), node.id);
        if (time === compiled.model.execution.startTime) m12CheckDescriptorInitial(node, u);
        return m12DescriptorOutput(node, x, u);
      }
      case 'continuous.pid-2dof': { const gains = m12PIDGains(node), r = gains.p * number('b') !== 0 || gains.d * number('c') !== 0 ? finiteNumber(read('r'), node.id) : 0, y = gains.p !== 0 || gains.d !== 0 ? finiteNumber(read('y'), node.id) : 0; return { out: m12PID(node, x, r, y).output }; }
      case 'time.variable-delay': { const delay = m12Delay(node, finiteNumber(read('delay'), node.id)); return { out: delay === 0 ? scalarInput() : m12Delayed(node, sourceTime - delay, false) }; }
      case 'time.variable-transport-delay': { m12Delay(node, finiteNumber(read('delay'), node.id)); return { out: m12Delayed(node, x[0]! - 1, true) }; }
      case 'nonlinear.backlash': { const held = finiteNumber(memories.get(node.id)!.value, node.id), half = number('width') / 2, u = scalarInput(); return { out: u < held - half ? u + half : u > held + half ? u - half : held }; }
      case 'nonlinear.rate-limiter-continuous': { const memory = memories.get(node.id)!, u = scalarInput(); return { out: memory.previousTime === undefined ? u : m12RateClamp(node, finiteNumber(memory.value, node.id), u, number('rising'), number('falling'), Math.max(0, time - memory.previousTime)) }; }
      case 'solver.algebraic-constraint': return { out: number('initial') };
      case 'analysis.linearization': {
        const memory = memories.get(node.id)!, trigger = p.mode === 'triggered' && read('trigger') === true;
        if (!memory.analysisOutput && m12DueAnalysis(node, time, trigger)) return { out: m12AnalysisBus(m12AnalyzePlant(node, time, charge)) };
        const program = p.analysisProgram as { initialState: number[]; inputBindings: unknown[]; outputBindings: unknown[] }, n = program.initialState.length, m = program.inputBindings.length, size = program.outputBindings.length;
        const zeros = (a: number, b: number) => Array.from({ length: a }, () => Array(b).fill(0) as number[]);
        return { out: memory.analysisOutput ?? m12AnalysisBus({ A: zeros(n, n), B: zeros(n, m), C: zeros(size, n), D: zeros(size, m) }) };
      }
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
  function evaluateNode(node: IRNode, time: number, state: number[], reader: (port: string) => SignalValue, eventMask: Set<string>, externalResolver?: (id: string) => Record<string, SignalValue>): Record<string, SignalValue> {
    if (node.parameters.algebraicComponentId) return evaluate(time, state, new Map(), eventMask, time, externalResolver, node.id).get(node.id)!;
    charge(node); const outputs = output(node, state, time, new Map(), eventMask, time, reader);
    for (const [port, descriptor] of Object.entries(node.outputs)) checkSignal(outputs[port], descriptor, node.id);
    return outputs;
  }
  function evaluate(time: number, state: number[], frozen: ContinuousValues, eventMask = new Set<string>(), sourceTime = time, externalResolver?: (id: string) => Record<string, SignalValue>, target?: string): ContinuousValues {
    const constraints = nodes.filter(node => node.blockType === 'solver.algebraic-constraint');
    const raw = (unknown: number[]): ContinuousValues => {
      const values = new Map(frozen), assigned = new Map(constraints.map((node, index) => [node.id, unknown[index]!]));
      const emit = (node: IRNode): void => {
        charge(node); const outputs = assigned.has(node.id) ? { out: assigned.get(node.id)! } : output(node, state, time, values, eventMask, sourceTime);
        for (const [port, descriptor] of Object.entries(node.outputs)) checkSignal(outputs[port], descriptor, node.id);
        values.set(node.id, outputs);
      };
      for (const node of nodes) if ((node.executionDomain !== 'discrete' || node.blockType === 'time.zero-order-hold') && independent(node)) emit(node);
      for (const node of nodes) if (node.executionDomain !== 'discrete' && !independent(node)) emit(node);
      for (const node of nodes) if (node.blockType === 'time.zero-order-hold') values.set(node.id, output(node, state, time, values, eventMask));
      return values;
    };
    if (!constraints.length) return raw([]);
    type Program = { id: string; unknowns: { nodeId: string; initial: number; constraint: string }[]; residuals: { nodeId: string; portId: string }[]; nodeIds: string[]; orderedNodeIds: string[]; tolerance: number; maxIterations: number };
    const values = new Map(frozen), resolving = new Set<string>(), active = new Set<string>();
    const resolve = (id: string): Record<string, SignalValue> => {
      if (values.has(id)) return values.get(id)!;
      const node = byId.get(id)!;
      if (!node) numericFailure('RUNTIME_INVALID_IR', id, '대수 성분의 producer를 찾을 수 없습니다.');
      if (node.executionDomain === 'discrete' && externalResolver) { const current = externalResolver(id); values.set(id, current); return current; }
      const leader = node.parameters.algebraicComponentId as string | undefined;
      if (leader) {
        const anchor = byId.get(leader)!, program = anchor.parameters.algebraicProgram as Program;
        if (!program || program.unknowns.length > 8 || program.nodeIds.length > 64 || active.has(leader)) numericFailure('M12_ALGEBRAIC_IR', leader, '대수 성분의 bounded 실행 계획이 유효하지 않습니다.');
        active.add(leader);
        const run = (unknown: number[]): ContinuousValues => {
          const local: ContinuousValues = new Map(program.unknowns.map((item, index) => [item.nodeId, { out: unknown[index]! }]));
          for (const memberId of program.orderedNodeIds) {
            const member = byId.get(memberId)!;
            const read = (port: string): SignalValue => { const endpoint = member.inputs[port]!; return (local.get(endpoint.nodeId) ?? resolve(endpoint.nodeId))[endpoint.portId]!; };
            charge(member); const emitted = output(member, state, time, values, eventMask, sourceTime, read);
            for (const [port, descriptor] of Object.entries(member.outputs)) checkSignal(emitted[port], descriptor, member.id);
            local.set(memberId, emitted);
          }
          return local;
        };
        const solved = m12Newton(unknown => {
          charge(anchor); const local = run(unknown);
          return program.residuals.map((endpoint, index) => finiteNumber((local.get(endpoint.nodeId) ?? resolve(endpoint.nodeId))[endpoint.portId], anchor.id) - (program.unknowns[index]!.constraint === 'fixed-point' ? unknown[index]! : 0));
        }, program.unknowns.map(item => item.initial), { nodeId: anchor.id, atol: program.tolerance, rtol: 0, maxIterations: program.maxIterations, charge: work => charge(anchor, work) });
        for (const [memberId, outputs] of run(solved.state)) values.set(memberId, outputs);
        active.delete(leader); return values.get(id)!;
      }
      if (resolving.has(id)) numericFailure('RUNTIME_INVALID_IR', id, '선언한 대수 미지수 밖에서 순환 의존성이 발견되었습니다.');
      resolving.add(id);
      const read = (port: string): SignalValue => { const endpoint = node.inputs[port]!; return resolve(endpoint.nodeId)[endpoint.portId]!; };
      charge(node); const emitted = output(node, state, time, values, eventMask, sourceTime, read);
      for (const [port, descriptor] of Object.entries(node.outputs)) checkSignal(emitted[port], descriptor, id);
      resolving.delete(id); values.set(id, emitted); return emitted;
    };
    if (target) resolve(target); else for (const node of nodes) if (node.executionDomain !== 'discrete' || node.blockType === 'time.zero-order-hold') resolve(node.id);
    return values;
  }
  function derivative(time: number, state: number[], frozen: ContinuousValues, sourceTime = time, acceptedState = state): number[] {
    const values = evaluate(time, state, frozen, new Set(), sourceTime), slopes: number[] = [];
    for (const [id, range] of ranges) {
      const node = resolveNode(byId.get(id)!), p = node.parameters, x = state.slice(range.start, range.start + range.length), accepted = acceptedState.slice(range.start, range.start + range.length), u = ['continuous.descriptor', 'continuous.pid-2dof', 'time.variable-transport-delay'].includes(node.blockType) ? 0 : scalar(values, node);
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
        case 'continuous.integrator-limited': result = [(accepted[0]! >= Number(p.upper) && x[0]! >= Number(p.upper) && u > 0 || accepted[0]! <= Number(p.lower) && x[0]! <= Number(p.lower) && u < 0) ? 0 : u]; break;
        case 'continuous.second-order-limited': {
          const atUpper = accepted[0]! >= Number(p.positionUpper) && x[0]! >= Number(p.positionUpper), atLower = accepted[0]! <= Number(p.positionLower) && x[0]! <= Number(p.positionLower);
          if (atUpper && x[1]! >= 0 && u >= 0 || atLower && x[1]! <= 0 && u <= 0) result = [0, 0];
          else result = [x[1]!, (accepted[1]! >= Number(p.velocityUpper) && x[1]! >= Number(p.velocityUpper) && u > 0 || accepted[1]! <= Number(p.velocityLower) && x[1]! <= Number(p.velocityLower) && u < 0) ? 0 : u];
          break;
        }
        case 'continuous.pid-2dof': result = m12PID(node, x, scalar(values, node, 'r'), scalar(values, node, 'y')).derivative; break;
        case 'continuous.descriptor': { const input = m12NumericVector(inputValue(values, node), node.id); if (time === compiled.model.execution.startTime) m12CheckDescriptorInitial(node, input); result = m12DescriptorDerivative(node, x, input); break; }
        case 'time.variable-transport-delay': result = [1 / m12Delay(node, scalar(values, node, 'delay'))]; break;
        default: result = [];
      }
      slopes.push(...result.map((value) => finiteNumber(value, id)));
    }
    return slopes;
  }
  const inputValue = (values: ContinuousValues, node: IRNode): SignalValue => input(values, node);
  function eventCandidates(before: ContinuousValues, after: ContinuousValues, beforeState?: number[], afterState?: number[], beforeTime = 0, afterTime = beforeTime): ContinuousEvent[] {
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
      if (['continuous.integrator-limited', 'continuous.second-order-limited', 'continuous.pid-2dof'].includes(node.blockType) && node.parameters.reset === 'rising' && input(before, node, 'reset') === false && input(after, node, 'reset') === true) events.push({ nodeId: node.id, kind: 'reset', direction: 1 });
      if (beforeState && afterState && ['continuous.integrator-limited', 'continuous.second-order-limited'].includes(node.blockType)) {
        const a = vector(beforeState, node), b = vector(afterState, node), axes = node.blockType === 'continuous.integrator-limited' ? [['lower', 'upper']] : [['positionLower', 'positionUpper'], ['velocityLower', 'velocityUpper']];
        axes.forEach((keys, axis) => keys.forEach(key => { const threshold = Number(node.parameters[key!]), epsilon = boundaryEpsilon(threshold); if (a[axis]! < threshold - epsilon && b[axis]! >= threshold - epsilon || a[axis]! > threshold + epsilon && b[axis]! <= threshold + epsilon) events.push({ nodeId: node.id, kind: 'crossing', domain: 'state', axis, direction: b[axis]! > a[axis]! ? 1 : -1, threshold }); }));
      }
      if (node.blockType === 'time.variable-transport-delay' && beforeState && afterState) {
        const a = vector(beforeState, node)[0]!, b = vector(afterState, node)[0]!;
        for (const coordinate of memories.get(node.id)!.m12Jumps!) if (a < coordinate + 1 - boundaryEpsilon(coordinate + 1) && b >= coordinate + 1 - boundaryEpsilon(coordinate + 1)) events.push({ nodeId: node.id, kind: 'crossing', domain: 'transport', direction: 1, threshold: coordinate + 1 });
      }
      if (node.blockType === 'time.variable-delay') {
        const a = beforeTime - scalar(before, node, 'delay'), b = afterTime - scalar(after, node, 'delay');
        for (const coordinate of memories.get(node.id)!.m12Jumps!) if (a < coordinate && b >= coordinate || a > coordinate && b <= coordinate) events.push({ nodeId: node.id, kind: 'crossing', domain: 'delay', direction: b > a ? 1 : -1, threshold: coordinate });
      }
      if (node.blockType === 'analysis.linearization' && node.parameters.mode === 'triggered' && input(before, node, 'trigger') === false && input(after, node, 'trigger') === true) events.push({ nodeId: node.id, kind: 'crossing', domain: 'analysis', direction: 1 });
      if (node.blockType === 'nonlinear.backlash') {
        const held = Number(memories.get(node.id)!.value), half = Number(node.parameters.width) / 2, a = scalar(before, node), b = scalar(after, node);
        for (const threshold of [held - half, held + half]) if (a < threshold && b >= threshold || a > threshold && b <= threshold) events.push({ nodeId: node.id, kind: 'crossing', domain: 'backlash', direction: b > a ? 1 : -1, threshold });
      }
    }
    return events;
  }
  function eventReached(event: ContinuousEvent, values: ContinuousValues, state?: number[], time = 0): boolean {
    const node = byId.get(event.nodeId)!;
    if (event.kind === 'reset') return input(values, node, 'reset') === true;
    if (event.domain === 'analysis') return input(values, node, 'trigger') === true;
    if (event.domain === 'state' || event.domain === 'transport') { const value = vector(state!, node)[event.axis ?? 0]!, epsilon = boundaryEpsilon(event.threshold!); return event.direction > 0 ? value >= event.threshold! - epsilon : value <= event.threshold! + epsilon; }
    if (event.domain === 'delay') { const value = time - scalar(values, node, 'delay'); return event.direction > 0 ? value >= event.threshold! : value <= event.threshold!; }
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
    for (const event of [...events].sort((a, b) => (b.axis ?? 0) - (a.axis ?? 0))) if (event.domain === 'state') { const node = byId.get(event.nodeId)!, range = ranges.get(node.id)!; next[range.start + (event.axis ?? 0)] = event.threshold!; if (node.blockType === 'continuous.second-order-limited' && event.axis === 0) next[range.start + 1] = 0; }
    for (const event of events) if (event.domain === 'transport') next[ranges.get(event.nodeId)!.start] = event.threshold!;
    const values = evaluate(time, next, frozen, mask);
    for (const node of nodes) if (node.blockType === 'continuous.integrator' && node.parameters.reset === 'rising' && (events.some((event) => event.nodeId === node.id && event.kind === 'reset') || input(values, node, 'reset') === true && mask.has(node.inputs.reset!.nodeId))) next[ranges.get(node.id)!.start] = Number(node.parameters.initial);
    for (const node of nodes) if (['continuous.integrator-limited', 'continuous.second-order-limited', 'continuous.pid-2dof'].includes(node.blockType) && node.parameters.reset === 'rising' && (events.some(event => event.nodeId === node.id && event.kind === 'reset') || input(values, node, 'reset') === true && mask.has(node.inputs.reset!.nodeId))) { const initial = initialFor(node), range = ranges.get(node.id)!; initial.forEach((value, index) => { next[range.start + index] = value; }); }
    return { state: next, mask };
  }
  function acceptMemory(time: number, previousValues: ContinuousValues, currentValues: ContinuousValues, leftValues?: ContinuousValues, state?: number[]): void {
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
      if (['time.variable-delay', 'time.variable-transport-delay'].includes(node.blockType)) {
        const memory = memories.get(node.id)!, transport = node.blockType === 'time.variable-transport-delay', phase = transport ? vector(state!, node)[0]! : undefined, value = scalar(currentValues, node), old = memory.m12History!;
        charge(node, old.length * (transport ? 3 : 2) + memory.m12Jumps!.length + 8);
        let history = [...old], jumps = [...memory.m12Jumps!];
        if (!history.length) jumps.push(transport ? phase! : time);
        const left = leftValues ? scalar(leftValues, node) : value;
        if (left !== value) { history.push({ time, value: left, ...(transport ? { phase } : {}) }); jumps.push(transport ? phase! : time); }
        history.push({ time, value, ...(transport ? { phase } : {}) });
        const cutoff = time - Number(node.parameters.maxDelay); let start = 0;
        while (history.length - start > 2 && history[start + 1]!.time < cutoff) start += 1;
        history = history.slice(start); const coordinate = transport ? history[0]!.phase! : history[0]!.time;
        jumps = jumps.filter(at => at >= coordinate);
        if (history.length > Number(node.parameters.historyLimit) || jumps.length > Number(node.parameters.historyLimit)) numericFailure('M12_HISTORY_BUDGET', node.id, '승인된 가변 지연 이력 상한을 초과했습니다.');
        memory.m12History = history; memory.m12Jumps = jumps;
      }
      if (node.blockType === 'nonlinear.backlash' || node.blockType === 'nonlinear.rate-limiter-continuous' && node.executionDomain !== 'discrete') { const memory = memories.get(node.id)!; memory.value = finiteNumber(currentValues.get(node.id)!.out, node.id); memory.previousTime = time; }
      if (node.blockType === 'analysis.linearization') { const memory = memories.get(node.id)!, trigger = node.parameters.mode === 'triggered' && input(currentValues, node, 'trigger') === true; if (m12DueAnalysis(node, time, trigger)) { memory.analysisOutput = m12AnalysisBus(m12AnalyzePlant(node, time, charge)); memory.analysisHit = time; } memory.previousTrigger = trigger; }
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
    const result = Object.fromEntries([...ranges].map(([id]) => [id, { state: vector(state, byId.get(id)!) } as StateValue]));
    for (const [id, memory] of memories) {
      const { historyStart, historyLength: _length, jumpTimes: _jumps, jumpStart: _head, jumpLength: _jumpLength, m12HistoryLength: _m12Length, m12JumpLength: _m12JumpLength, ...snapshot } = memory;
      if (snapshot.history) snapshot.history = snapshot.history.slice(historyStart ?? 0);
      result[id] = { ...(result[id] as Record<string, StateValue> ?? {}), ...JSON.parse(JSON.stringify(snapshot)) } as StateValue;
    }
    return result;
  }
  function validateState(state: number[]): void {
    for (const [id, range] of ranges) for (let index = range.start; index < range.start + range.length; index += 1) finiteNumber(state[index], id);
  }
  const maximumDelayStep = nodes.filter((node) => ['time.transport-delay', 'time.variable-delay', 'time.variable-transport-delay'].includes(node.blockType)).reduce((minimum, node) => Math.min(minimum, Number(node.parameters[node.blockType === 'time.transport-delay' ? 'delay' : 'minDelay'])), Infinity);
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
