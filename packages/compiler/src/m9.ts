import { M9_BLOCK_IDS } from '../../block-library/src/m9';
import { ModelError, divideUnits, multiplyUnits, normalizeSolverSettings, signalElementCount, validateSignal, type CalcModel, type IRNode, type SignalDescriptor } from '../../model/src';

const known: ReadonlySet<string> = new Set(M9_BLOCK_IDS);
const fail = (node: IRNode, code: string, message: string, portId?: string): never => { throw new ModelError([{ code, nodeId: node.id, message, ...(portId ? { portId } : {}) }]); };
const copy = (descriptor: SignalDescriptor, shape = descriptor.shape, unit = descriptor.unit): SignalDescriptor => ({ valueType: descriptor.valueType, shape: [...shape], unit });
const scalar = (valueType: SignalDescriptor['valueType'] = 'float64', unit = '1'): SignalDescriptor => ({ valueType, shape: [], unit });
const sameShape = (a: SignalDescriptor, b: SignalDescriptor): boolean => a.shape.length === b.shape.length && a.shape.every((size, axis) => size === b.shape[axis]);
const numericParameter = (node: IRNode, key: string): SignalDescriptor => { const descriptor = validateSignal(node.parameters[key]); if (descriptor.valueType !== 'float64') fail(node, 'TYPE_MISMATCH', `${key}는 유한한 숫자 신호여야 합니다.`); return descriptor; };
function numericElements(value: unknown): number[] { return !Array.isArray(value) ? [value as number] : Array.isArray(value[0]) ? (value as number[][]).flat() : value as number[]; }
function parameterBroadcast(node: IRNode, a: string, b: string): SignalDescriptor { const x = numericParameter(node, a), y = numericParameter(node, b); if (x.shape.length && y.shape.length && !sameShape(x, y)) fail(node, 'SHAPE_MISMATCH', `${a}/${b}의 비scalar 형상이 같아야 합니다.`); return copy(x.shape.length ? x : y); }
function polynomial(node: IRNode, roots: number[]): number[] { return roots.reduce((coefficients, root) => { const next = Array<number>(coefficients.length + 1).fill(0); coefficients.forEach((coefficient, index) => { next[index]! += coefficient; next[index + 1]! -= coefficient * root; }); if (next.some(value => !Number.isFinite(value))) fail(node, 'INVALID_PARAMETERS', '영점·극점의 다항식이 overflow했습니다.'); return next; }, [1]); }
function filterOrder(node: IRNode): number {
  const p = node.parameters;
  if (node.blockType === 'discrete.filter-time-varying') return p.order as number;
  if (node.blockType === 'discrete.zero-pole') return (p.poles as number[]).length;
  const a = (p.denominator as number[]).length, b = p.representation === 'transfer' ? a : (p.numerator as number[]).length;
  return p.structure === 'df1' || p.structure === 'df1t' ? a + b - 2 : Math.max(a, b) - 1;
}

export function validateM9Parameters(node: IRNode, model: CalcModel): void {
  if (!known.has(node.blockType)) return;
  const p = node.parameters, invalid = (message: string): never => fail(node, 'INVALID_PARAMETERS', message);
  const Ts = (model.execution.mode === 'continuous' ? normalizeSolverSettings(model.execution).discreteStep : model.execution.step) * node.sampleTime.period;
  if (!Number.isFinite(Ts) || Ts <= 0) invalid('물리적 샘플시간은 유한한 양수여야 합니다.');
  if (['discrete.filter', 'discrete.filter-time-varying', 'discrete.zero-pole'].includes(node.blockType)) {
    const initial = numericParameter(node, 'initial');
    if (node.blockType === 'discrete.filter') {
      const a = p.denominator as number[], b = p.numerator as number[];
      if (a[0] === 0 || [...a, ...b].some(value => !Number.isFinite(value / a[0]!))) invalid('분모 첫 계수는 영이 아니며 정규화한 계수는 유한해야 합니다.');
      if (p.representation === 'transfer' && b.length > a.length) invalid('descending-z 전달함수의 분자 차수는 분모 차수 이하여야 합니다.');
    }
    if (node.blockType === 'discrete.zero-pole') {
      if ((p.zeros as number[]).length > (p.poles as number[]).length) invalid('실수 영점 개수는 극점 개수 이하여야 합니다.');
      const b = polynomial(node, p.zeros as number[]).map(value => value * (p.gain as number)); polynomial(node, p.poles as number[]);
      if (b.some(value => !Number.isFinite(value))) invalid('영점·극점 gain 적용 계수는 유한해야 합니다.');
    }
    const states = p.stateInitial as number[];
    if (states.length && states.length !== filterOrder(node) * signalElementCount(initial)) invalid('stateInitial 길이는 구조별 delay state 수×채널 수와 같아야 합니다.');
  }
  if (['discrete.pid', 'discrete.pid-2dof', 'discrete.integrator-configured'].includes(node.blockType) && p.limit === 'clamp' && (p.lower as number) > (p.upper as number)) invalid('아래 제한은 위 제한 이하여야 합니다.');
  if (node.blockType === 'discrete.delay-configured') {
    if (p.mode === 'fixed' && (p.steps as number) > (p.maxDelay as number)) invalid('steps는 maxDelay 이하여야 합니다.');
    if (p.mode === 'fixed' && p.steps === 0 && p.allowZero !== 'yes') invalid('영 지연은 allowZero=yes에서만 허용합니다.');
  }
  if (node.blockType === 'discrete.state-space-mimo') {
    const n = (p.initial as number[]).length;
    const matrices = ['A', 'B', 'C', 'D'].map(key => { const descriptor = numericParameter(node, key); if (descriptor.shape.length !== 2 || descriptor.shape.some(size => size > 16)) invalid('상태 공간 행렬의 각 축은 1~16이어야 합니다.'); return descriptor; });
    const [a, b, c, d] = matrices as [SignalDescriptor, SignalDescriptor, SignalDescriptor, SignalDescriptor];
    if (a.shape[0] !== n || a.shape[1] !== n || b.shape[0] !== n || c.shape[1] !== n || d.shape[0] !== c.shape[0] || d.shape[1] !== b.shape[1]) invalid('A NxN, B NxM, C PxN, D PxM과 initial 길이 N을 확인해 주세요.');
  }
  if (node.blockType === 'time.weighted-math' && ['inverse', 'divide'].includes(p.operation as string) && p.weight === 0) invalid('역수·나눗셈의 weighted Ts는 영일 수 없습니다.');
  if (node.blockType === 'source.band-limited-noise') { numericParameter(node, 'noisePower'); if (numericElements(p.noisePower).some(value => value < 0 || !Number.isFinite(value / Ts))) invalid('noisePower/Ts는 영 이상의 유한한 분산이어야 합니다.'); }
  if (node.blockType === 'source.counter') { const limit = p.mode === 'free' ? 2 ** (p.bits as number) - 1 : p.upper as number; if ((p.initial as number) > limit) invalid('카운터 초기값은 순환 상한 이하여야 합니다.'); }
  if (node.blockType === 'source.pwm' && ((p.period as number) < Ts || (p.period as number) > 1e9 || Math.floor((p.period as number) / Ts) > 1_000_000)) invalid('PWM 주기는 Ts 이상·1e9초 이하이며 cycle당 due 수는1,000,000 이하여야 합니다.');
  if (node.blockType === 'source.sine-configured') parameterBroadcast(node, 'amplitude', 'bias');
  if (node.blockType === 'source.random-configured') {
    if (p.distribution === 'normal') { parameterBroadcast(node, 'mean', 'variance'); if (numericElements(p.variance).some(value => value < 0)) invalid('분산은 영 이상이어야 합니다.'); }
    else {
      const descriptor = parameterBroadcast(node, 'min', 'max'), count = signalElementCount(descriptor), a = numericElements(p.min), b = numericElements(p.max);
      for (let index = 0; index < count; index++) if (a[a.length === 1 ? 0 : index]! >= b[b.length === 1 ? 0 : index]!) invalid('각 uniform min은 max보다 작아야 합니다.');
    }
  }
  if (node.blockType === 'verify.resolution' && (p.tolerance as number) > (p.resolution as number)) invalid('허용 나머지는 resolution 이하여야 합니다.');
}

/** Seed outputs before traversing state feedback. These descriptors do not depend on current input. */
export function initialM9Outputs(node: IRNode, unit = '1'): Record<string, SignalDescriptor> | undefined {
  if (!known.has(node.blockType)) return undefined;
  const p = node.parameters;
  let descriptor: SignalDescriptor;
  switch (node.blockType) {
    case 'discrete.pid': case 'discrete.pid-2dof': case 'source.counter': descriptor = scalar(); break;
    case 'discrete.state-space-mimo': descriptor = { valueType: 'float64', shape: [(p.C as number[][]).length], unit: '1' }; break;
    case 'logic.numeric-edge': { const initial = validateSignal(p.initial); descriptor = { valueType: 'boolean', shape: [...initial.shape], unit: '1' }; break; }
    case 'verify.gradient': case 'verify.resolution': descriptor = scalar('boolean'); break;
    case 'discrete.tapped-delay': { const initial = validateSignal(p.initial); if (initial.shape.length) fail(node, 'SHAPE_MISMATCH', '탭 지연의 initial은 scalar여야 합니다.'); descriptor = copy(initial, [p.taps as number], unit); break; }
    case 'source.band-limited-noise': descriptor = copy(numericParameter(node, 'noisePower'), undefined, unit); break;
    case 'source.sine-configured': descriptor = copy(parameterBroadcast(node, 'amplitude', 'bias'), undefined, unit); break;
    case 'source.random-configured': descriptor = copy(parameterBroadcast(node, p.distribution === 'normal' ? 'mean' : 'min', p.distribution === 'normal' ? 'variance' : 'max'), undefined, unit); break;
    case 'source.pwm': case 'source.variable-pulse': case 'source.signal-generator': case 'source.sequence-configured': descriptor = scalar('float64', unit); break;
    case 'time.weighted-math': case 'time.decrement-to-zero': return undefined;
    default: { const initial = validateSignal(p.initial); descriptor = copy(initial, initial.shape, unit); break; }
  }
  if (descriptor.valueType === 'boolean' && descriptor.unit !== '1') fail(node, 'UNIT_MISMATCH', 'boolean 출력 단위는1이어야 합니다.');
  if (!['discrete.delay-configured', 'discrete.tapped-delay', 'signal.initial-condition', 'logic.numeric-edge'].includes(node.blockType) && descriptor.valueType !== 'float64' && !['verify.gradient', 'verify.resolution'].includes(node.blockType)) fail(node, 'TYPE_MISMATCH', '숫자 상태의 initial은 float64여야 합니다.');
  if (node.blockType === 'discrete.integrator-configured' && unit !== '1') fail(node, 'UNIT_MISMATCH', '이 적분 subset은 단위 없는 숫자 채널만 지원합니다.');
  return { out: descriptor };
}

export function inferM9Outputs(node: IRNode, input: (port: string) => SignalDescriptor, declaredUnit = '1'): Record<string, SignalDescriptor> | undefined {
  if (!known.has(node.blockType)) return undefined;
  const p = node.parameters;
  if (node.blockType === 'time.weighted-math') {
    if (p.operation === 'TsOnly') return { out: scalar('float64', 's') };
    if (p.operation === 'inverse') return { out: scalar('float64', 'Hz') };
    const value = input('in'); if (value.valueType !== 'float64') fail(node, 'TYPE_MISMATCH', '샘플시간 계산에는 float64가 필요합니다.', 'in');
    if (['add', 'subtract'].includes(p.operation as string) && value.unit !== 's') fail(node, 'UNIT_MISMATCH', '샘플시간 덧셈·뺄셈의 입력은 초(s)여야 합니다.', 'in');
    const unit = p.operation === 'multiply' ? multiplyUnits(value.unit, 's') : p.operation === 'divide' ? divideUnits(value.unit, 's') : 's'; return { out: copy(value, value.shape, unit) };
  }
  if (node.blockType === 'time.decrement-to-zero') { const value = input('in'); if (value.valueType !== 'float64') fail(node, 'TYPE_MISMATCH', '시간 감소에는 숫자가 필요합니다.', 'in'); if (value.unit !== 's') fail(node, 'UNIT_MISMATCH', '시간 감소 입력은 초(s)여야 합니다.', 'in'); return { out: copy(value) }; }
  if (node.blockType === 'discrete.difference-configured') { const value = input('in'); const initial = validateSignal(p.initial); if (initial.valueType !== 'float64' || value.valueType !== 'float64') fail(node, 'TYPE_MISMATCH', '차분·미분에는 float64가 필요합니다.', 'in'); return { out: copy(value, value.shape, p.operation === 'derivative' ? divideUnits(value.unit, 's') : value.unit) }; }
  return initialM9Outputs(node, declaredUnit);
}

/** New multiinput/no-input/boolean-output states bypass the legacy same in/out state contract. */
export function validateM9StateInputs(node: IRNode, input: (port: string) => SignalDescriptor): boolean {
  if (!known.has(node.blockType)) return false;
  const p = node.parameters, output = node.outputs.out!;
  const numeric = (port: string, shape?: number[], unit?: string): SignalDescriptor => { const value = input(port); if (value.valueType !== 'float64') fail(node, 'TYPE_MISMATCH', 'float64 입력이 필요합니다.', port); if (shape && !sameShape(value, { ...value, shape })) fail(node, 'SHAPE_MISMATCH', '승인된 고정 입력 형상과 다릅니다.', port); if (unit !== undefined && value.unit !== unit) fail(node, 'UNIT_MISMATCH', `입력 단위는${unit}여야 합니다.`, port); return value; };
  const sameInitial = (port = 'in', numbers = true, checkUnit = true): void => { const initial = validateSignal(p.initial), value = input(port); if (value.valueType !== initial.valueType || (numbers && value.valueType !== 'float64')) fail(node, 'TYPE_MISMATCH', '입력 타입은initial과같아야 합니다.', port); if (!sameShape(value, initial)) fail(node, 'SHAPE_MISMATCH', '입력 형상은initial과같아야 합니다.', port); if (checkUnit && value.unit !== output.unit) fail(node, 'UNIT_MISMATCH', '상태 입력과출력단위가같아야 합니다.', port); };
  if (p.reset !== undefined && p.reset !== 'none') { const control = input('reset'); if (control.shape.length || control.unit !== '1') fail(node, 'CONTROL_SIGNAL', 'reset은단위없는boolean 또는숫자scalar여야 합니다.', 'reset'); }
  if (p.enable === 'port') { const control = input('enable'); if (control.shape.length || control.unit !== '1') fail(node, 'CONTROL_SIGNAL', 'enable은단위없는boolean 또는숫자scalar여야 합니다.', 'enable'); }
  switch (node.blockType) {
    case 'discrete.filter': case 'discrete.zero-pole': case 'discrete.integrator-configured': case 'math.running-minmax': sameInitial(); break;
    case 'discrete.filter-time-varying': sameInitial(); numeric('numerator', [(p.order as number) + 1], '1'); numeric('denominator', [p.order as number], '1'); break;
    case 'discrete.pid': numeric('in', [], '1'); break;
    case 'discrete.pid-2dof': numeric('reference', [], '1'); numeric('measurement', [], '1'); break;
    case 'discrete.delay-configured': sameInitial('in', false); if (p.mode === 'variable') numeric('delay', [], '1'); if (p.initialSource === 'port') sameInitial('initial', false); break;
    case 'discrete.tapped-delay': { const initial = validateSignal(p.initial), value = input('in'); if (value.shape.length || value.valueType !== initial.valueType) fail(node, 'SHAPE_MISMATCH', '탭 입력은initial과같은타입scalar여야 합니다.', 'in'); if (value.unit !== output.unit) fail(node, 'UNIT_MISMATCH', '탭 입력·출력단위가같아야 합니다.', 'in'); break; }
    case 'discrete.propagation-delay': sameInitial('in', false); numeric('delay', [], 's'); break;
    case 'discrete.state-space-mimo': numeric('in', [(p.B as number[][])[0]!.length], '1'); break;
    case 'discrete.difference-configured': sameInitial('in', true, false); break;
    case 'logic.numeric-edge': sameInitial('in', p.mode !== 'change', false); break;
    case 'source.pwm': numeric('duty', [], '1'); break;
    case 'source.variable-pulse': numeric('duty', [], '1'); numeric('period', [], 's'); break;
    case 'signal.initial-condition': sameInitial('in', false); break;
    case 'verify.gradient': sameInitial('in', true, false); break;
    case 'verify.resolution': { const value = numeric('in'); if (value.shape.length > 1) fail(node, 'SHAPE_MISMATCH', '해상도검증은scalar 또는1D벡터만허용합니다.', 'in'); break; }
  }
  return true;
}
