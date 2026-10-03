import type { IRNode, SignalDescriptor, SignalValue } from '../../model/src/types';
import { copySignal, finiteNumber, numericFailure, signalElements } from './kernels';

/** Every field is owned by one execution. Reads never mutate these arrays. */
export type M9Memory = {
  previousReset?: boolean; previousOutput?: SignalValue; value?: SignalValue;
  slots?: number[][]; history?: SignalValue[]; previousInput?: SignalValue;
  seed?: number; count?: number; initialized?: boolean; lastArrival?: number;
  queue?: { arrival: number; tick: number; value: SignalValue }[];
  integral?: number[]; derivative?: number[]; previousError?: number[];
  cycleLength?: number; duty?: number; latchTick?: number;
};
export type M9ReadResult = { outputs: Record<string, SignalValue>; publicationMemory?: M9Memory };

export const M9_BLOCKS = new Set([
  'discrete.filter', 'discrete.filter-time-varying', 'discrete.zero-pole',
  'discrete.pid', 'discrete.pid-2dof', 'discrete.delay-configured', 'discrete.tapped-delay',
  'discrete.propagation-delay', 'discrete.integrator-configured', 'logic.numeric-edge',
  'math.running-minmax', 'time.weighted-math', 'time.decrement-to-zero', 'signal.initial-condition',
  'source.band-limited-noise', 'source.counter', 'source.pwm', 'source.variable-pulse',
  'source.signal-generator', 'verify.gradient', 'verify.resolution',
  'discrete.state-space-mimo', 'discrete.difference-configured', 'source.sine-configured',
  'source.sequence-configured', 'source.random-configured',
]);
export const M9_RANDOM_BLOCKS = new Set(['source.band-limited-noise', 'source.random-configured', 'source.signal-generator']);
export function m9IndependentOutput(node: IRNode): boolean {
  if (node.parameters.reset !== undefined && node.parameters.reset !== 'none' || node.parameters.enable === 'port') return false;
  switch (node.blockType) {
    case 'discrete.filter': { const { b } = filterCoefficients(node); return b[0] === 0; }
    case 'discrete.zero-pole': return node.parameters.gain === 0 || (node.parameters.zeros as number[]).length < (node.parameters.poles as number[]).length;
    case 'discrete.delay-configured': return node.parameters.initialSource !== 'port' && node.parameters.mode === 'fixed' && Number(node.parameters.steps) > 0;
    case 'discrete.tapped-delay': return node.parameters.includeCurrent !== 'yes';
    case 'source.counter': case 'source.band-limited-noise':
    case 'source.signal-generator': case 'source.sine-configured': case 'source.sequence-configured': case 'source.random-configured': return true;
    case 'discrete.integrator-configured': return node.parameters.method === 'forward';
    case 'discrete.state-space-mimo': return (node.parameters.D as number[][]).every(row => row.every(value => value === 0));
    case 'time.weighted-math': return ['TsOnly', 'inverse'].includes(String(node.parameters.operation));
    default: return false;
  }
}

function flat(value: SignalValue, id: string): number[] {
  const values = !Array.isArray(value) ? [value] : Array.isArray(value[0]) ? (value as number[][]).flat() : value;
  return values.map((item) => finiteNumber(item, id));
}
function shape(values: number[] | boolean[], descriptor: SignalDescriptor): SignalValue {
  if (!descriptor.shape.length) return values[0]!;
  if (descriptor.shape.length === 1) return [...values] as number[] | boolean[];
  return Array.from({ length: descriptor.shape[0]! }, (_, row) => values.slice(row * descriptor.shape[1]!, (row + 1) * descriptor.shape[1]!)) as number[][] | boolean[][];
}
function numericSignal(values: number[], node: IRNode): SignalValue {
  return shape(values.map((value) => finiteNumber(value, node.id)), node.outputs.out!);
}
function truth(value: SignalValue, id: string): boolean {
  if (typeof value === 'boolean') return value;
  return finiteNumber(value, id) !== 0;
}
function coefficientVector(value: unknown, id: string): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 33) numericFailure('RUNTIME_INVALID_IR', id, '필터 계수 길이는 1~33이어야 합니다.');
  return value.map((entry) => finiteNumber(entry, id));
}
function filterCoefficients(node: IRNode, input?: (port: string) => SignalValue): { b: number[]; a: number[]; structure: string } {
  let b: number[], a: number[];
  const dynamic = node.blockType === 'discrete.filter-time-varying';
  if (dynamic) {
    if (!input) return { b: Array(Number(node.parameters.order) + 1).fill(0), a: [1, ...Array(Number(node.parameters.order)).fill(0)], structure: 'df2' };
    b = coefficientVector(input('numerator'), node.id);
    a = [1, ...coefficientVector(input('denominator'), node.id)];
    if (b.length !== Number(node.parameters.order) + 1 || a.length !== b.length) numericFailure('RUNTIME_SHAPE_MISMATCH', node.id, '동적 필터 계수 길이가 승인된 차수와 다릅니다.');
  } else if (node.blockType === 'discrete.zero-pole') {
    const polynomial = (roots: number[]): number[] => roots.reduce((coefficients, root) => {
      const next = Array(coefficients.length + 1).fill(0) as number[];
      coefficients.forEach((coefficient, index) => { next[index] = finiteNumber(next[index]! + coefficient, node.id); next[index + 1] = finiteNumber(next[index + 1]! - coefficient * root, node.id); });
      return next;
    }, [1]);
    b = polynomial(node.parameters.zeros as number[]).map(v => finiteNumber(v * Number(node.parameters.gain), node.id));
    a = polynomial(node.parameters.poles as number[]);
    b = [...Array(a.length - b.length).fill(0), ...b];
  } else {
    b = coefficientVector(node.parameters.numerator, node.id);
    a = coefficientVector(node.parameters.denominator, node.id);
    if (node.parameters.representation === 'transfer') {
      if (b.length > a.length) numericFailure('RUNTIME_INVALID_IR', node.id, '내림차순 z 전달함수는 분자 차수가 분모 차수 이하여야 합니다.');
      b = [...Array(a.length - b.length).fill(0), ...b];
    }
  }
  if (a[0] === 0) numericFailure('NUMERIC_DOMAIN', node.id, '필터 분모의 첫 계수는 0일 수 없습니다.');
  const leading = a[0]!;
  return { b: b.map((v) => finiteNumber(v / leading, node.id)), a: a.map((v) => finiteNumber(v / leading, node.id)), structure: dynamic ? 'df2' : node.blockType === 'discrete.zero-pole' ? 'df2t' : String(node.parameters.structure) };
}
function filterSlotCount(b: number[], a: number[], structure: string): number {
  return structure === 'df1' || structure === 'df1t' ? b.length + a.length - 2 : Math.max(b.length, a.length) - 1;
}
function filterStep(b: number[], a: number[], structure: string, old: number[], u: number, id: string): { y: number; next: number[] } {
  const checked = (value: number): number => finiteNumber(value, id);
  if (structure === 'df1') {
    const nu = b.length - 1, ny = a.length - 1;
    let y = checked(b[0]! * u);
    for (let i = 1; i < b.length; i++) y = checked(y + b[i]! * old[i - 1]!);
    for (let i = 1; i < a.length; i++) y = checked(y - a[i]! * old[nu + i - 1]!);
    return { y, next: [...(nu ? [u, ...old.slice(0, nu - 1)] : []), ...(ny ? [y, ...old.slice(nu, nu + ny - 1)] : [])] };
  }
  if (structure === 'df1t') {
    const nr = a.length - 1, ns = b.length - 1;
    const v = checked(u + (nr ? old[0]! : 0));
    const y = checked(b[0]! * v + (ns ? old[nr]! : 0));
    const r = Array.from({ length: nr }, (_, i) => checked((i + 1 < nr ? old[i + 1]! : 0) - a[i + 1]! * v));
    const s = Array.from({ length: ns }, (_, i) => checked((i + 1 < ns ? old[nr + i + 1]! : 0) + b[i + 1]! * v));
    return { y, next: [...r, ...s] };
  }
  const n = Math.max(b.length, a.length) - 1;
  if (structure === 'df2') {
    let w = u;
    for (let i = 1; i < a.length; i++) w = checked(w - a[i]! * old[i - 1]!);
    let y = checked(b[0]! * w);
    for (let i = 1; i < b.length; i++) y = checked(y + b[i]! * old[i - 1]!);
    return { y, next: n ? [w, ...old.slice(0, n - 1)] : [] };
  }
  if (structure !== 'df2t') numericFailure('RUNTIME_INVALID_IR', id, '지원하지 않는 필터 실현 방식입니다.');
  const y = checked(b[0]! * u + (n ? old[0]! : 0));
  return { y, next: Array.from({ length: n }, (_, i) => checked((i + 1 < n ? old[i + 1]! : 0) + (b[i + 1] ?? 0) * u - (a[i + 1] ?? 0) * y)) };
}

function initialSignal(node: IRNode): SignalValue {
  const count = signalElements(node.outputs.out!);
  const initial = node.parameters.initial ?? 0;
  if (Array.isArray(initial)) {
    const values = Array.isArray(initial[0]) ? (initial as (number | boolean)[][]).flat() : initial as (number | boolean)[];
    if (values.length === count && values.every(value => typeof value === (node.outputs.out!.valueType === 'boolean' ? 'boolean' : 'number'))) return copySignal(initial as SignalValue);
  }
  const element = node.outputs.out!.valueType === 'boolean' ? typeof initial === 'boolean' ? initial : false : typeof initial === 'number' ? finiteNumber(initial, node.id) : 0;
  return shape(Array(count).fill(element) as number[] | boolean[], node.outputs.out!);
}
export function m9InitialMemory(node: IRNode, _Ts: number): M9Memory {
  const initial = initialSignal(node);
  const common: M9Memory = { previousReset: false, previousOutput: copySignal(initial) };
  switch (node.blockType) {
    case 'discrete.filter': case 'discrete.filter-time-varying': case 'discrete.zero-pole': {
      const { b, a, structure } = filterCoefficients(node);
      const count = filterSlotCount(b, a, structure), channels = flat(initial, node.id);
      const supplied = node.parameters.stateInitial as number[];
      if (supplied?.length && supplied.length !== count * channels.length) numericFailure('RUNTIME_SHAPE_MISMATCH', node.id, '필터 초기 상태 길이가 실현 방식과 채널 수에 맞지 않습니다.');
      return { ...common, slots: channels.map((value, channel) => Array.from({ length: count }, (_, index) => supplied?.length ? finiteNumber(supplied[channel * count + index], node.id) : value)) };
    }
    case 'discrete.delay-configured': return { ...common, history: Array.from({ length: node.parameters.mode === 'variable' ? Number(node.parameters.maxDelay) : Number(node.parameters.steps) }, () => copySignal(node.parameters.initial as SignalValue)), count: 0 };
    case 'discrete.tapped-delay': return { ...common, history: Array.from({ length: Number(node.parameters.taps) - (node.parameters.includeCurrent === 'yes' ? 1 : 0) }, () => copySignal(node.parameters.initial as SignalValue)) };
    case 'discrete.propagation-delay': return { ...common, value: copySignal(node.parameters.initial as SignalValue), queue: [] };
    case 'discrete.pid': case 'discrete.pid-2dof': return { ...common, integral: [Number(node.parameters.integralInitial)], derivative: [Number(node.parameters.filterInitial)], previousError: [0, 0] };
    case 'discrete.integrator-configured': return { ...common, value: copySignal(node.parameters.initial as SignalValue), previousInput: numericSignal(Array(signalElements(node.outputs.out!)).fill(0), node) };
    case 'discrete.state-space-mimo': return { ...common, previousOutput: (node.parameters.C as number[][]).map(row => finiteNumber(row.reduce((sum, v, i) => finiteNumber(sum + v * (node.parameters.initial as number[])[i]!, node.id), 0), node.id)), value: [...node.parameters.initial as number[]] };
    case 'source.counter': return { ...common, count: Number(node.parameters.initial) };
    case 'source.pwm': case 'source.variable-pulse': return { ...common, count: 0, cycleLength: 1, duty: 0 };
    case 'source.sequence-configured': case 'source.sine-configured': return { ...common, count: 0 };
    case 'source.band-limited-noise': case 'source.random-configured': case 'source.signal-generator': return { ...common, seed: Number(node.parameters.seed) };
    case 'signal.initial-condition': return { ...common, value: copySignal(node.parameters.initial as SignalValue), initialized: false };
    default: return { ...common, value: copySignal((node.parameters.initial ?? initial) as SignalValue) };
  }
}
function control(node: IRNode, memory: M9Memory, input: (port: string) => SignalValue): { reset: boolean; enabled: boolean; currentReset: boolean } {
  const mode = node.parameters.reset ?? 'none';
  const current = mode === 'none' ? false : truth(input('reset'), node.id);
  const previous = memory.previousReset ?? false;
  const reset = mode === 'rising' ? current && !previous : mode === 'falling' ? !current && previous : mode === 'either' ? current !== previous : mode === 'level' ? current || previous : mode === 'level-hold' ? current : false;
  return { reset, enabled: node.parameters.enable !== 'port' || truth(input('enable'), node.id), currentReset: current };
}
function filterRead(node: IRNode, memory: M9Memory, input: (port: string) => SignalValue): SignalValue {
  const { b, a, structure } = filterCoefficients(node, input);
  const current = b[0] === 0 ? Array(memory.slots!.length).fill(0) : flat(input('in'), node.id);
  return numericSignal(memory.slots!.map((state, channel) => {
    const checked = (value: number) => finiteNumber(value, node.id), u = current[channel]!;
    if (structure === 'df2t') return checked((b[0] === 0 ? 0 : b[0]! * u) + (state.length ? state[0]! : 0));
    if (structure === 'df1t') return checked((b[0] === 0 ? 0 : b[0]! * checked(u + (a.length > 1 ? state[0]! : 0))) + (b.length > 1 ? state[a.length - 1]! : 0));
    if (structure === 'df1') {
      let y = b[0] === 0 ? 0 : checked(b[0]! * u);
      for (let i = 1; i < b.length; i++) y = checked(y + b[i]! * state[i - 1]!);
      for (let i = 1; i < a.length; i++) y = checked(y - a[i]! * state[b.length - 1 + i - 1]!);
      return y;
    }
    let y = 0;
    if (b[0] !== 0) {
      let w = u; for (let i = 1; i < a.length; i++) w = checked(w - a[i]! * state[i - 1]!);
      y = checked(b[0]! * w);
    }
    for (let i = 1; i < b.length; i++) y = checked(y + b[i]! * state[i - 1]!);
    return y;
  }), node);
}
function convex(a: number, b: number, ratio: number, id: string): number {
  if (ratio === 0 || a === b) return a;
  if (ratio === 1) return b;
  return finiteNumber(Math.max(Math.abs(a), Math.abs(b)) < 2 ** -1021
    ? ((a * 2 ** 1022) * (1 - ratio) + (b * 2 ** 1022) * ratio) * 2 ** -1022
    : a * (1 - ratio) + b * ratio, id);
}
function scaledSum(values: number[], coefficients: number[], id: string): number {
  const scale = Math.max(...values.map(Math.abs));
  if (scale === 0) return 0;
  let sum = 0, correction = 0;
  for (let i = 0; i < values.length; i++) {
    const term = values[i]! / scale * coefficients[i]!, next = sum + term;
    correction += Math.abs(sum) >= Math.abs(term) ? (sum - next) + term : (term - next) + sum;
    sum = next;
  }
  return finiteNumber((sum + correction) * scale, id);
}
function broadcast(value: unknown, width: number, id: string): number[] {
  if (typeof value === 'number') return Array(width).fill(finiteNumber(value, id));
  const values = flat(value as SignalValue, id);
  if (values.length !== width) numericFailure('RUNTIME_SHAPE_MISMATCH', id, '채널별 값의 형상이 일치하지 않습니다.');
  return values;
}
function limited(node: IRNode, value: number): number {
  if (node.parameters.limit !== 'clamp') return finiteNumber(value, node.id);
  const lower = finiteNumber(node.parameters.lower, node.id), upper = finiteNumber(node.parameters.upper, node.id);
  if (lower > upper) numericFailure('NUMERIC_DOMAIN', node.id, '아래 제한은 위 제한 이하여야 합니다.');
  return Math.max(lower, Math.min(upper, finiteNumber(value, node.id)));
}
function integratorRead(node: IRNode, state: M9Memory, input: (port: string) => SignalValue, Ts: number): SignalValue {
  const previous = flat(state.value!, node.id);
  if (node.parameters.method === 'forward') return numericSignal(previous.map(value => limited(node, value)), node);
  const current = flat(input('in'), node.id), oldInput = flat(state.previousInput!, node.id);
  const scale = finiteNumber(Number(node.parameters.gain) * (node.parameters.mode === 'accumulation' ? 1 : Ts), node.id);
  return numericSignal(previous.map((value, index) => limited(node, value + scale * (node.parameters.method === 'trapezoid' ? convex(oldInput[index]!, current[index]!, .5, node.id) : current[index]!))), node);
}
function pidStep(node: IRNode, state: M9Memory, input: (port: string) => SignalValue, Ts: number): { output: number; integral: number; derivative: number; error: number[] } {
  const f = (value: number): number => finiteNumber(value, node.id), p = (name: string): number => finiteNumber(node.parameters[name], node.id);
  const reference = node.blockType === 'discrete.pid-2dof' ? finiteNumber(input('reference'), node.id) : finiteNumber(input('in'), node.id);
  const measurement = node.blockType === 'discrete.pid-2dof' ? finiteNumber(input('measurement'), node.id) : 0;
  const eI = f(reference - measurement), eP = p('kp') === 0 ? 0 : f((node.blockType === 'discrete.pid-2dof' ? p('b') : 1) * reference - measurement), eD = p('kd') === 0 ? 0 : f((node.blockType === 'discrete.pid-2dof' ? p('c') : 1) * reference - measurement);
  const oldI = state.integral![0]!, oldD = state.derivative![0]!, previous = state.previousError!;
  const increment = p('ki') === 0 ? 0 : f(p('ki') * Ts * (node.parameters.integralMethod === 'trapezoid' ? convex(eI, previous[0]!, .5, node.id) : eI));
  let nextI = f(oldI + increment), visibleI = node.parameters.integralMethod === 'forward' ? oldI : nextI;
  const h = p('kd') === 0 ? 0 : f(p('filterN') * Ts);
  const q = (h / 2) / (1 + h / 2);
  const nextD = p('kd') === 0 ? oldD : node.parameters.filterMethod === 'forward' ? f(oldD + h * (eD - oldD))
    : node.parameters.filterMethod === 'trapezoid' ? scaledSum([oldD, eD, previous[1]!], [1 - 2 * q, q, q], node.id) : convex(oldD, eD, h / (1 + h), node.id);
  const visibleD = node.parameters.filterMethod === 'forward' ? oldD : nextD;
  const pAndD = f(p('kp') * eP + (p('kd') === 0 ? 0 : p('kd') * p('filterN') * (eD - visibleD)));
  let raw = f(pAndD + visibleI);
  if (node.parameters.limit === 'clamp' && node.parameters.antiWindup === 'clamping'
    && (raw > p('upper') && increment > 0 || raw < p('lower') && increment < 0)) {
    nextI = oldI; visibleI = oldI; raw = f(pAndD + visibleI);
  }
  return { output: limited(node, raw), integral: nextI, derivative: nextD, error: [eI, eD] };
}
function delayCount(node: IRNode, input: (port: string) => SignalValue): number {
  if (node.parameters.mode !== 'variable') return Number(node.parameters.steps);
  const raw = finiteNumber(input('delay'), node.id), min = node.parameters.allowZero === 'yes' ? 0 : 1, max = Number(node.parameters.maxDelay);
  if (node.parameters.casting === 'truncate-clamp') return Math.max(min, Math.min(max, Math.trunc(raw)));
  if (!Number.isInteger(raw) || raw < min || raw > max) numericFailure('DELAY_RANGE', node.id, '지연 입력이 승인된 정수 범위 밖입니다.');
  return raw;
}
function normalDraw(seed: number): { value: number; seed: number } {
  const first = (Math.imul(1664525, seed) + 1013904223) >>> 0, second = (Math.imul(1664525, first) + 1013904223) >>> 0;
  return { value: Math.sqrt(-2 * Math.log((first + .5) / 4294967296)) * Math.cos(2 * Math.PI * ((second + .5) / 4294967296)), seed: second };
}
function randomRead(node: IRNode, state: M9Memory, Ts: number): M9ReadResult {
  const width = signalElements(node.outputs.out!), values: number[] = [];
  let seed = state.seed!;
  const noise = node.blockType === 'source.band-limited-noise', normal = noise || node.parameters.distribution === 'normal';
  const means = normal ? broadcast(noise ? 0 : node.parameters.mean, width, node.id) : [];
  const variances = normal ? broadcast(noise ? node.parameters.noisePower : node.parameters.variance, width, node.id) : [];
  const minimum = !normal ? broadcast(node.parameters.min, width, node.id) : [], maximum = !normal ? broadcast(node.parameters.max, width, node.id) : [];
  for (let channel = 0; channel < width; channel++) {
    if (normal) {
      const variance = finiteNumber(variances[channel]! / (noise ? Ts : 1), node.id);
      if (variance < 0) numericFailure('NUMERIC_DOMAIN', node.id, '난수 분산은 0 이상이어야 합니다.');
      const draw = normalDraw(seed); seed = draw.seed;
      values.push(finiteNumber(means[channel]! + Math.sqrt(variance) * draw.value, node.id));
    } else {
      if (minimum[channel]! > maximum[channel]!) numericFailure('NUMERIC_DOMAIN', node.id, '균일 난수의 최소값이 최대값보다 큽니다.');
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const ratio = (seed + .5) / 4294967296;
      values.push(convex(minimum[channel]!, maximum[channel]!, ratio, node.id));
    }
  }
  const out = numericSignal(values, node);
  return { outputs: { out }, publicationMemory: { ...state, seed, previousOutput: copySignal(out) } };
}
function pulseRead(node: IRNode, state: M9Memory, input: (port: string) => SignalValue, tick: number, time: number, Ts: number): M9ReadResult {
  if (time < Number(node.parameters.delay)) return { outputs: { out: 0 } };
  let duty = state.duty!, length = state.cycleLength!;
  if (state.count === 0 && state.latchTick !== tick) {
    duty = finiteNumber(input('duty'), node.id);
    if (duty < 0 || duty > 1) numericFailure('PULSE_DUTY_RANGE', node.id, 'duty는 0~1이어야 합니다.');
    const period = node.blockType === 'source.pwm' ? finiteNumber(node.parameters.period, node.id) : finiteNumber(input('period'), node.id);
    if (period < Ts) numericFailure('PULSE_PERIOD_RANGE', node.id, '펄스 주기는 실제 샘플 시간 이상이어야 합니다.');
    length = Math.floor(period / Ts);
    if (!Number.isSafeInteger(length) || length < 1 || length > 1_000_000) numericFailure('PULSE_PERIOD_RANGE', node.id, '펄스 주기의 due 수가 한도를 벗어났습니다.');
  }
  const out = state.count! < Math.floor(duty * length) ? finiteNumber(node.parameters.amplitude, node.id) : 0;
  return { outputs: { out }, publicationMemory: { ...state, cycleLength: length, duty, latchTick: state.count === 0 ? tick : state.latchTick } };
}
function propagationArrival(node: IRNode, state: M9Memory, input: (port: string) => SignalValue, tick: number, time: number, Ts: number): number {
  const delay = finiteNumber(input('delay'), node.id);
  if (delay <= Ts || delay <= 128 * Number.EPSILON) numericFailure('PROPAGATION_DELAY_RANGE', node.id, '고정 발행 지연은 Ts와 128eps보다 커야 합니다.');
  const arrival = finiteNumber(time + delay, node.id);
  if (state.lastArrival !== undefined && arrival <= state.lastArrival) numericFailure('PROPAGATION_DELAY_ORDER', node.id, '예약 도착 시각은 엄격히 증가해야 합니다.');
  if (state.queue!.filter(entry => entry.tick > tick).length >= Number(node.parameters.capacity)) numericFailure('PROPAGATION_DELAY_CAPACITY', node.id, '발행 예약 용량을 초과했습니다.');
  if (!Number.isSafeInteger(tick + Math.floor(delay / Ts) * node.sampleTime.period)) numericFailure('PROPAGATION_DELAY_RANGE', node.id, '발행 지연의 due index를 안전한 정수로 표현할 수 없습니다.');
  return arrival;
}
export function m9Read(node: IRNode, memory: M9Memory, input: (port: string) => SignalValue, tick: number, time: number, Ts: number): M9ReadResult {
  const controls = control(node, memory, input);
  if (!controls.reset && !controls.enabled) return { outputs: { out: copySignal(memory.previousOutput!) } };
  const state = controls.reset ? m9InitialMemory(node, Ts) : memory;
  switch (node.blockType) {
    case 'discrete.filter': case 'discrete.filter-time-varying': case 'discrete.zero-pole': return { outputs: { out: filterRead(node, state, input) } };
    case 'discrete.pid': case 'discrete.pid-2dof': return { outputs: { out: pidStep(node, state, input, Ts).output } };
    case 'discrete.integrator-configured': return { outputs: { out: integratorRead(node, state, input, Ts) } };
    case 'discrete.delay-configured': {
      const delay = delayCount(node, input);
      const external = node.parameters.initialSource === 'port';
      const captured = external && (!state.initialized || controls.reset) ? copySignal(input('initial')) : state.value ?? node.parameters.initial as SignalValue;
      const out = copySignal(delay === 0 ? input('in') : controls.reset || delay > state.count! ? captured : state.history![delay - 1]!);
      return { outputs: { out }, publicationMemory: external && (!state.initialized || controls.reset) ? { ...state, value: captured, initialized: true, history: state.history!.map(() => copySignal(captured)) } : undefined };
    }
    case 'discrete.tapped-delay': {
      const values = [...(node.parameters.includeCurrent === 'yes' ? [input('in')] : []), ...state.history!];
      if (node.parameters.order === 'oldest') values.reverse();
      return { outputs: { out: values as number[] | boolean[] } };
    }
    case 'discrete.propagation-delay': {
      propagationArrival(node, state, input, tick, time, Ts);
      const queue = state.queue!, delivered = queue.filter(entry => entry.tick <= tick), pending = queue.filter(entry => entry.tick > tick);
      const out = copySignal(delivered.at(-1)?.value ?? state.value!);
      return { outputs: { out }, publicationMemory: delivered.length ? { ...state, value: copySignal(out), queue: pending.map(entry => ({ arrival: entry.arrival, tick: entry.tick, value: copySignal(entry.value) })) } : undefined };
    }
    case 'discrete.state-space-mimo': {
      const C = node.parameters.C as number[][], D = node.parameters.D as number[][], x = flat(state.value!, node.id);
      const u = D.some(row => row.some(v => v !== 0)) ? flat(input('in'), node.id) : Array(D[0]!.length).fill(0);
      const out = C.map((row, index) => finiteNumber(row.reduce((sum, v, j) => finiteNumber(sum + v * x[j]!, node.id), 0) + D[index]!.reduce((sum, v, j) => finiteNumber(sum + v * u[j]!, node.id), 0), node.id));
      return { outputs: { out } };
    }
    case 'discrete.difference-configured': {
      const gain = Number(node.parameters.gain), divisor = node.parameters.operation === 'derivative' ? Ts : 1;
      if (gain === 0) return { outputs: { out: numericSignal(Array(signalElements(node.outputs.out!)).fill(0), node) } };
      const current = flat(input('in'), node.id), previous = flat(state.value!, node.id), scale = gain / divisor;
      return { outputs: { out: numericSignal(current.map((v, i) => {
        const difference = v - previous[i]!, direct = difference * scale;
        if (Number.isFinite(direct) && scale !== 0) return direct;
        const product = difference * gain;
        return Number.isFinite(product) ? product / divisor : difference / divisor * gain;
      }), node) } };
    }
    case 'logic.numeric-edge': {
      if (node.parameters.mode === 'change' && node.parameters.initial !== undefined) {
        const elements = (value: SignalValue): (number | boolean)[] => !Array.isArray(value) ? [value] : Array.isArray(value[0]) ? (value as (number | boolean)[][]).flat() : value as (number | boolean)[];
        const previous = elements(state.value!);
        return { outputs: { out: shape(elements(input('in')).map((value, index) => value !== previous[index]), node.outputs.out!) } };
      }
      const current = flat(input('in'), node.id), previous = flat(state.value!, node.id), mode = node.parameters.mode;
      const out = current.map((v, i) => { const old = previous[i]!; return mode === 'change' ? v !== old : mode === 'increase' ? v > old : mode === 'decrease' ? v < old : mode === 'fall-negative' ? old >= 0 && v < 0 : mode === 'fall-nonpositive' ? old > 0 && v <= 0 : mode === 'rise-nonnegative' ? old < 0 && v >= 0 : old <= 0 && v > 0; });
      return { outputs: { out: shape(out, node.outputs.out!) } };
    }
    case 'math.running-minmax': {
      const current = flat(input('in'), node.id), previous = flat(state.value!, node.id);
      return { outputs: { out: numericSignal(current.map((v, i) => node.parameters.operation === 'min' ? Math.min(v, previous[i]!) : Math.max(v, previous[i]!)), node) } };
    }
    case 'time.weighted-math': {
      const operation = node.parameters.operation, weighted = finiteNumber(Ts * Number(node.parameters.weight), node.id);
      if (['inverse', 'divide'].includes(String(operation)) && weighted === 0) numericFailure('NUMERIC_DOMAIN', node.id, '샘플 시간 가중치의 역수는 0에서 정의되지 않습니다.');
      if (operation === 'TsOnly' || operation === 'inverse') return { outputs: { out: operation === 'TsOnly' ? weighted : finiteNumber(1 / weighted, node.id) } };
      return { outputs: { out: numericSignal(flat(input('in'), node.id).map(v => operation === 'add' ? v + weighted : operation === 'subtract' ? v - weighted : operation === 'multiply' ? v * weighted : v / weighted), node) } };
    }
    case 'time.decrement-to-zero': return { outputs: { out: numericSignal(flat(input('in'), node.id).map(v => Math.max(v - Ts, 0)), node) } };
    case 'signal.initial-condition': return { outputs: { out: copySignal(state.initialized ? input('in') : state.value!) } };
    case 'source.band-limited-noise': case 'source.random-configured': return randomRead(node, state, Ts);
    case 'source.counter': return { outputs: { out: state.count! } };
    case 'source.pwm': case 'source.variable-pulse': return pulseRead(node, state, input, tick, time, Ts);
    case 'source.sine-configured': {
      const width = signalElements(node.outputs.out!), amplitude = broadcast(node.parameters.amplitude, width, node.id), bias = broadcast(node.parameters.bias, width, node.id);
      const angle = node.parameters.mode === 'time' ? Number(node.parameters.frequency) * time + Number(node.parameters.phase) : 2 * Math.PI * ((state.count! + Number(node.parameters.offset)) % Number(node.parameters.samplesPerPeriod)) / Number(node.parameters.samplesPerPeriod) + Number(node.parameters.phase);
      return { outputs: { out: numericSignal(amplitude.map((v, i) => v * Math.sin(angle) + bias[i]!), node) } };
    }
    case 'source.sequence-configured': {
      const values = node.parameters.values as number[], span = Number(node.parameters.samplesPerSegment), position = state.count! % (span * values.length), index = Math.floor(position / span);
      const out = node.parameters.interpolation === 'previous' ? values[index]! : convex(values[index]!, values[(index + 1) % values.length]!, position % span / span, node.id);
      return { outputs: { out: finiteNumber(out, node.id) } };
    }
    case 'source.signal-generator': {
      const amplitude = Number(node.parameters.amplitude), bias = Number(node.parameters.bias);
      if (node.parameters.waveform === 'random') {
        const seed = (Math.imul(1664525, state.seed!) + 1013904223) >>> 0, out = finiteNumber(amplitude * (2 * ((seed + .5) / 4294967296) - 1) + bias, node.id);
        return { outputs: { out }, publicationMemory: { ...state, seed, previousOutput: out } };
      }
      const angle = finiteNumber((node.parameters.frequencyUnit === 'Hz' ? 2 * Math.PI : 1) * Number(node.parameters.frequency) * time + Number(node.parameters.phase), node.id);
      const cycle = ((angle / (2 * Math.PI)) % 1 + 1) % 1;
      const value = node.parameters.waveform === 'square' ? cycle < .5 ? 1 : -1 : node.parameters.waveform === 'sawtooth' ? 2 * cycle - 1 : Math.sin(angle);
      return { outputs: { out: finiteNumber(amplitude * value + bias, node.id) } };
    }
    case 'verify.gradient': {
      const previous = flat(state.value!, node.id), maximum = Math.abs(Number(node.parameters.maximumGradient));
      if (!flat(input('in'), node.id).every((value, index) => Math.abs(value - previous[index]!) < maximum)) numericFailure('VERIFY_VIOLATION', node.id, '이산 입력 변화량이 strict 허용 범위에 없습니다.');
      return { outputs: { out: true } };
    }
    case 'verify.resolution': {
      const resolution = finiteNumber(node.parameters.resolution, node.id), tolerance = finiteNumber(node.parameters.tolerance, node.id);
      if (resolution <= 0) numericFailure('NUMERIC_DOMAIN', node.id, '해상도는 0보다 커야 합니다.');
      if (!flat(input('in'), node.id).every(value => { const remainder = value % resolution; return (remainder < 0 ? remainder + resolution : remainder) < tolerance; })) numericFailure('VERIFY_VIOLATION', node.id, '입력이 선언한 해상도 격자에 없습니다.');
      return { outputs: { out: true } };
    }
    default: return numericFailure('RUNTIME_UNSUPPORTED_BLOCK', node.id, '지원하지 않는 M9 이산 블럭입니다.');
  }
}
export function m9Commit(node: IRNode, memory: M9Memory, input: (port: string) => SignalValue, outputs: Record<string, SignalValue>, tick: number, time: number, Ts: number): M9Memory {
  const controls = control(node, memory, input);
  const tracked = { previousReset: controls.currentReset, previousOutput: copySignal(outputs.out!) };
  if (controls.reset) {
    const initial = m9InitialMemory(node, Ts);
    if (node.blockType === 'discrete.delay-configured' && node.parameters.initialSource === 'port') {
      const value = copySignal(input('initial')); return { ...initial, ...tracked, value, initialized: true, history: initial.history!.map(() => copySignal(value)) };
    }
    return { ...initial, ...tracked };
  }
  if (!controls.enabled) return { ...memory, ...tracked };
  switch (node.blockType) {
    case 'discrete.filter': case 'discrete.filter-time-varying': case 'discrete.zero-pole': {
      const { b, a, structure } = filterCoefficients(node, input), current = flat(input('in'), node.id);
      return { ...memory, ...tracked, slots: memory.slots!.map((state, channel) => filterStep(b, a, structure, state, current[channel]!, node.id).next) };
    }
    case 'discrete.delay-configured': return { ...memory, ...tracked, count: Math.min(memory.count! + 1, memory.history!.length), history: memory.history!.length ? [copySignal(input('in')), ...memory.history!.slice(0, -1).map(copySignal)] : [] };
    case 'discrete.tapped-delay': return { ...memory, ...tracked, history: memory.history!.length ? [copySignal(input('in')), ...memory.history!.slice(0, -1).map(copySignal)] : [] };
    case 'discrete.propagation-delay': {
      const arrival = propagationArrival(node, memory, input, tick, time, Ts), delay = finiteNumber(input('delay'), node.id);
      const queue = memory.queue!.filter(entry => entry.tick > tick).map(entry => ({ arrival: entry.arrival, tick: entry.tick, value: copySignal(entry.value) }));
      queue.push({ arrival: finiteNumber(time + Math.floor(delay / Ts) * Ts, node.id), tick: tick + Math.floor(delay / Ts) * node.sampleTime.period, value: copySignal(input('in')) });
      return { ...memory, ...tracked, queue, lastArrival: arrival };
    }
    case 'discrete.integrator-configured': {
      const current = flat(input('in'), node.id), previous = flat(memory.value!, node.id), scale = Number(node.parameters.gain) * (node.parameters.mode === 'accumulation' ? 1 : Ts);
      const value = node.parameters.method === 'forward' ? numericSignal(previous.map((v, i) => limited(node, v + scale * current[i]!)), node) : copySignal(outputs.out!);
      return { ...memory, ...tracked, value, previousInput: copySignal(input('in')) };
    }
    case 'discrete.pid': case 'discrete.pid-2dof': {
      const step = pidStep(node, memory, input, Ts);
      return { ...memory, ...tracked, integral: [step.integral], derivative: [step.derivative], previousError: step.error };
    }
    case 'discrete.state-space-mimo': {
      const A = node.parameters.A as number[][], B = node.parameters.B as number[][], x = flat(memory.value!, node.id), u = flat(input('in'), node.id);
      const value = A.map((row, i) => finiteNumber(row.reduce((sum, v, j) => finiteNumber(sum + v * x[j]!, node.id), 0) + B[i]!.reduce((sum, v, j) => finiteNumber(sum + v * u[j]!, node.id), 0), node.id));
      return { ...memory, ...tracked, value };
    }
    case 'discrete.difference-configured': case 'logic.numeric-edge': case 'verify.gradient': return { ...memory, ...tracked, value: copySignal(input('in')) };
    case 'math.running-minmax': return { ...memory, ...tracked, value: copySignal(outputs.out!) };
    case 'signal.initial-condition': return { ...memory, ...tracked, initialized: true };
    case 'source.counter': { const upper = node.parameters.mode === 'free' ? 2 ** Number(node.parameters.bits) - 1 : Number(node.parameters.upper); return { ...memory, ...tracked, count: memory.count! >= upper ? 0 : memory.count! + 1 }; }
    case 'source.sine-configured': return { ...memory, ...tracked, count: (memory.count! + 1) % Number(node.parameters.samplesPerPeriod) };
    case 'source.sequence-configured': return { ...memory, ...tracked, count: (memory.count! + 1) % ((node.parameters.values as number[]).length * Number(node.parameters.samplesPerSegment)) };
    case 'source.pwm': case 'source.variable-pulse': return time < Number(node.parameters.delay) ? { ...memory, ...tracked } : { ...memory, ...tracked, count: (memory.count! + 1) % memory.cycleLength! };
    default: return { ...memory, ...tracked };
  }
}

export function m9OperationCost(node: IRNode, inputSize: number, outputSize: number): number | undefined {
  if (!M9_BLOCKS.has(node.blockType)) return undefined;
  const width = Math.max(1, inputSize, outputSize);
  if (node.blockType.startsWith('discrete.filter')) return width * 8 * (node.blockType === 'discrete.filter-time-varying' ? Number(node.parameters.order) + 1 : (node.parameters.numerator as number[]).length + (node.parameters.denominator as number[]).length);
  if (node.blockType === 'discrete.zero-pole') return width * 16 * ((node.parameters.zeros as number[]).length + (node.parameters.poles as number[]).length + 1);
  if (node.blockType === 'discrete.delay-configured') return width * 4 * (node.parameters.mode === 'variable' ? Number(node.parameters.maxDelay) : Number(node.parameters.steps) + 1);
  if (node.blockType === 'discrete.tapped-delay') return 4 * (inputSize + outputSize + Number(node.parameters.taps) + 1);
  if (node.blockType === 'discrete.propagation-delay') return width * 8 * (Number(node.parameters.capacity) + 1);
  if (node.blockType === 'discrete.state-space-mimo') return width * 16 * ((node.parameters.A as number[][]).length ** 2 + (node.parameters.B as number[][])[0]!.length + (node.parameters.C as number[][]).length);
  return width * 64;
}
