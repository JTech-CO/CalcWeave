import type { CalcNode } from '../../model/src/types';
import type { BlockDefinition, ParameterDefinition } from './index';

export const M9_BLOCK_IDS = [
  'discrete.filter', 'discrete.filter-time-varying', 'discrete.pid', 'discrete.pid-2dof', 'discrete.zero-pole',
  'discrete.delay-configured', 'discrete.tapped-delay', 'discrete.propagation-delay', 'discrete.integrator-configured',
  'discrete.state-space-mimo', 'discrete.difference-configured', 'logic.numeric-edge', 'math.running-minmax',
  'time.weighted-math', 'time.decrement-to-zero', 'signal.initial-condition', 'source.band-limited-noise',
  'source.counter', 'source.pwm', 'source.variable-pulse', 'source.signal-generator', 'source.sine-configured',
  'source.sequence-configured', 'source.random-configured', 'verify.gradient', 'verify.resolution',
] as const;
export type M9BlockType = typeof M9_BLOCK_IDS[number];
const number = (label: string, initial: number, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): ParameterDefinition => ({ kind: 'number', label, default: initial, min, max });
const integer = (label: string, initial: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: initial, min, max });
const choice = (label: string, initial: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: initial, options });
const value = (label: string, initial: unknown): ParameterDefinition => ({ kind: 'value', label, default: initial });
const vector = (label: string, initial: readonly number[], minLength = 0, maxLength = 1024): ParameterDefinition => ({ kind: 'numeric-vector', label, default: [...initial], minLength, maxLength });
const reset = choice('초기화 사건', 'none', ['none', 'rising', 'falling', 'either', 'level', 'level-hold']);
const enable = choice('실행 제어', 'none', ['none', 'port']);
const controls = { reset, enable };
const methods = ['forward', 'backward', 'trapezoid'] as const;
const common = { version: 1, inputs: ['in'], outputs: ['out'], parameters: {}, category: '이산 상태', supportedModes: ['discrete', 'continuous'], directFeedthrough: true, valueType: 'inherited', shape: 'inherited', unit: 'inherited', sampleTime: 'fixed-tick', state: 'discrete-state', exportTargets: ['typescript'] } as const;
const define = (id: M9BlockType, label: string, englishName: string, description: string, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...common, id, label, englishName, description, ...overrides });
const source = { inputs: [], category: '입력', directFeedthrough: false } as const;
const stateless = { state: 'none' } as const;
const pidParameters = { kp: number('P', 1), ki: number('I', 0), kd: number('D', 0), filterN: number('미분 필터 N', 100, 1e-12), integralMethod: choice('적분 방법', 'backward', methods), filterMethod: choice('필터 방법', 'backward', methods), integralInitial: number('초기 적분 상태', 0), filterInitial: number('초기 필터 상태', 0), limit: choice('출력 제한', 'none', ['none', 'clamp']), lower: number('아래 제한', -1e6), upper: number('위 제한', 1e6), antiWindup: choice('적분 포화 대책', 'none', ['none', 'clamping']), ...controls };
export const M9_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  define('discrete.filter', '이산 필터', 'Discrete Filter', '원소별 sample-channel 실수 IIR. DF1/DF1T/DF2/DF2T와 고정 z⁻¹ 계수 또는 descending-z 전달함수 계수를 구분합니다. 프레임 처리는 미지원입니다.', { parameters: { numerator: vector('분자', [1], 1, 33), denominator: vector('분모', [1, -.5], 1, 33), structure: choice('실현 구조', 'df2t', ['df1', 'df1t', 'df2', 'df2t']), representation: choice('계수 순서', 'filter', ['filter', 'transfer']), initial: value('채널별 초기 상태', 0), stateInitial: vector('전체 state 초기값(빈 값은 채널 초기값)', [], 0, 65536), ...controls } }),
  define('discrete.filter-time-varying', '시간변화 DF2', 'Direct Form II Time Varying', 'DF2의 numerator와 leading 1을 생략한 denominator 입력입니다. 차수는 고정되며 계수 변경 후 state를 유지합니다.', { inputs: ['in', 'numerator', 'denominator'], parameters: { order: integer('고정 차수', 1, 1, 32), initial: value('채널별 초기 상태', 0), stateInitial: vector('전체 state 초기값', [], 0, 32768), ...controls } }),
  define('discrete.pid', '이산 PID', 'Discrete PID Controller', '단위 없는 scalar error의 Parallel P/I/D와 유한한 미분 필터, FE/BE/Trapezoid, 고정 제한·clamping을 지원합니다.', { parameters: pidParameters }),
  define('discrete.pid-2dof', '이산 2DOF PID', 'Discrete PID Controller (2DOF)', 'P에는 b·reference−measurement, I에는 reference−measurement, D에는 c·reference−measurement를 사용합니다.', { inputs: ['reference', 'measurement'], parameters: { ...pidParameters, b: number('P setpoint 가중치', 1), c: number('D setpoint 가중치', 1) } }),
  define('discrete.zero-pole', '이산 영점·극점', 'Discrete Zero-Pole', '실수 z 영점·극점과 gain을 descending-z DF2T 전달함수로 실현합니다. 복소근은 미지원입니다.', { parameters: { zeros: vector('실수 영점', [], 0, 16), poles: vector('실수 극점', [.5], 0, 16), gain: number('gain', 1), initial: value('채널별 초기 상태', 0), stateInitial: vector('전체 state 초기값', [], 0, 16384), ...controls } }),
  define('discrete.delay-configured', '제어 가능한 지연', 'Configured Delay', '고정 또는 입력 delay의 정수 due 횟수를 지연합니다. delay=0은 현재 입력입니다. runtime cast는 truncate+clamp 또는 strict error를 선택합니다.', { directFeedthrough: false, parameters: { mode: choice('지연 방식', 'fixed', ['fixed', 'variable']), steps: integer('고정 지연', 1, 0, 1024), maxDelay: integer('최대 지연', 16, 1, 1024), allowZero: choice('영 지연', 'no', ['no', 'yes']), casting: choice('동적 index 처리', 'strict', ['strict', 'truncate-clamp']), initial: value('초기 값', 0), initialSource: choice('초기 값 원본', 'parameter', ['parameter', 'port']), ...controls } }),
  define('discrete.tapped-delay', '탭 지연', 'Tapped Delay', 'scalar 실수·boolean의 이전 due 값들을 고정 벡터로 출력합니다. oldest/newest 순서와 현재 입력 포함 옵션입니다.', { directFeedthrough: false, parameters: { taps: integer('탭 수', 2, 1, 1024), order: choice('탭 순서', 'newest', ['newest', 'oldest']), includeCurrent: choice('현재 값 포함', 'no', ['no', 'yes']), initial: value('초기 scalar', 0), ...controls } }),
  define('discrete.propagation-delay', '발행 예약 지연', 'Propagation Delay (Fixed Interval)', '각 due input의 raw 도착 time+delay가 엄격히 증가해야 하며 time+floor(delay/Ts)·Ts에 발행합니다. 같은 발행 grid에서는 마지막 값을 사용합니다. delay>Ts, 임의 시각 사건 solver 미지원입니다.', { directFeedthrough: false, inputs: ['in', 'delay'], parameters: { initial: value('초기 값', 0), capacity: integer('예약 용량', 1024, 1, 10000) } }),
  define('discrete.integrator-configured', '설정 가능한 이산 적분', 'Configured Discrete-Time Integrator', '단위 없는 실수 채널별 FE/BE/Trapezoid 적분 또는 accumulation, 즉시 reset·enable과 고정 포화를 지원합니다.', { parameters: { initial: value('초기 상태', 0), gain: number('gain', 1), method: choice('적분 방법', 'forward', methods), mode: choice('시간 가중치', 'integration', ['integration', 'accumulation']), limit: choice('상태 제한', 'none', ['none', 'clamp']), lower: number('아래 제한', -1e6), upper: number('위 제한', 1e6), ...controls } }),
  define('discrete.state-space-mimo', '이산 MIMO 상태 공간', 'Discrete State-Space (MIMO)', 'A NxN, B NxM, C PxN, D PxM의 실수 상태 공간. 각 축 1~16, 단위 없는 고정 벡터 입출력입니다.', { parameters: { A: value('A', [[.5]]), B: value('B', [[1]]), C: value('C', [[1]]), D: value('D', [[0]]), initial: vector('초기 상태', [0], 1, 16), ...controls } }),
  define('discrete.difference-configured', '설정 가능한 차분', 'Configured Difference / Derivative', '현재−이전 due 입력에 gain을 곱합니다. derivative는 물리적 Ts로 나누며 초기/제어 상태를 보존합니다.', { parameters: { initial: value('이전 입력 초기값', 0), operation: choice('연산', 'difference', ['difference', 'derivative']), gain: number('gain', 1), ...controls } }),
  define('logic.numeric-edge', '값·부호 변화 검출', 'Numeric Detect', 'change/increase/decrease 및 영 경계의 네 가지 strict·inclusive 부호 전이를 원소별 검출합니다.', { category: '논리', parameters: { initial: value('이전 값', 0), mode: choice('검출', 'change', ['change', 'increase', 'decrease', 'fall-negative', 'fall-nonpositive', 'rise-nonnegative', 'rise-positive']), ...controls } }),
  define('math.running-minmax', '누적 최솟값·최댓값', 'MinMax Running Resettable', '채널별 현재 입력을 포함하여 초기 state와 min/max를 계산합니다.', { parameters: { initial: value('초기 극값', 0), operation: choice('극값', 'min', ['min', 'max']), ...controls } }),
  define('time.weighted-math', '샘플시간 계산', 'Weighted Sample Time Math', 'Ts=baseStep·period 초. weight·Ts, 그 역수, u±weight·Ts 또는 곱·나눗셈을 계산합니다. subtract는 u−weight·Ts입니다.', { ...stateless, category: '신호 처리', parameters: { operation: choice('연산', 'TsOnly', ['TsOnly', 'inverse', 'add', 'subtract', 'multiply', 'divide']), weight: number('가중치', 1) } }),
  define('time.decrement-to-zero', '시간 감소', 'Decrement Time To Zero', '초(s) 입력에 max(input−Ts,0)를 원소별 계산합니다.', { ...stateless, category: '신호 처리' }),
  define('signal.initial-condition', '첫 값 지정', 'Initial Condition', '첫 due 출력은 initial, 이후에는 현재 입력을 보냅니다. scalar·벡터·2D float64/boolean의 같은 형상·단위를 요구합니다.', { category: '신호 처리', parameters: { initial: value('첫 출력', 0) } }),
  define('source.band-limited-noise', '대역 제한 백색잡음', 'Band-Limited White Noise', 'due마다 held Gaussian을 생성합니다. variance=noisePower/Ts이며 자체 PRNG의 seed 재현을 지원합니다.', { ...source, parameters: { noisePower: value('채널별 noise PSD', .1), seed: integer('seed', 1, 0, 4294967295) } }),
  define('source.counter', '순환 카운터', 'Counter', 'safe integer를 due당 1씩 증가시킵니다. free는 2^bits, limited는 upper+1에서0으로 돌아갑니다. 출력 dtype는 float64입니다.', { ...source, parameters: { mode: choice('순환 방식', 'free', ['free', 'limited']), bits: integer('비트 폭', 8, 1, 53), upper: integer('포함 상한', 255, 0, Number.MAX_SAFE_INTEGER), initial: integer('초기 값', 0, 0, Number.MAX_SAFE_INTEGER), ...controls } }),
  define('source.pwm', '펄스 폭 조절', 'PWM', '물리적 period를 due grid에 floor하고 각 cycle 시작에 duty를 latch합니다. duty는0~1이며 cycle안의 변경은 다음cycle에 적용합니다.', { inputs: ['duty'], category: '입력', parameters: { period: number('주기 초', 1, 1e-12), amplitude: number('진폭', 1), delay: number('시작 지연 초', 0, 0) } }),
  define('source.variable-pulse', '가변 펄스', 'Variable Pulse Generator', 'cycle 시작에 duty·period 입력을 latch하는 고정 due grid 펄스입니다. period는초, duty는0~1입니다.', { inputs: ['duty', 'period'], category: '입력', parameters: { amplitude: number('진폭', 1), delay: number('시작 지연 초', 0, 0) } }),
  define('source.signal-generator', '신호 파형', 'Signal Generator', 'held sine/square/sawtooth 또는 seeded uniform random scalar. Hz/rad/s를 명시하며 absolute simulation time을 사용합니다.', { ...source, parameters: { waveform: choice('파형', 'sine', ['sine', 'square', 'sawtooth', 'random']), amplitude: number('진폭', 1), frequency: number('주파수', 1, 0), frequencyUnit: choice('주파수 단위', 'Hz', ['Hz', 'rad/s']), phase: number('위상 rad', 0), bias: number('기준 값', 0), seed: integer('seed', 1, 0, 4294967295) } }),
  define('source.sine-configured', '샘플 사인파', 'Sine Wave (Configured)', 'time 모드는 rad/s의 절대 시간, sample 모드는 첫 due k=0부터 modulo samplesPerPeriod의 사인파를 출력합니다.', { ...source, parameters: { mode: choice('시각 방식', 'sample', ['sample', 'time']), amplitude: value('채널별 진폭', 1), bias: value('채널별 기준 값', 0), phase: number('위상 rad', 0), frequency: number('각 주파수 rad/s', 1, 0), samplesPerPeriod: integer('주기당 샘플', 10, 1, 10000), offset: integer('샘플 위상', 0, -10000, 10000) } }),
  define('source.sequence-configured', '샘플 주기 수열', 'Repeating Sequence (Configured)', '고정 numeric values를 due마다 순서대로 반복하는 stair 또는 위치 사이 linear 보간입니다. first due index0부터 시작합니다.', { ...source, parameters: { values: vector('주기 값', [0, 1], 1, 1024), interpolation: choice('보간', 'previous', ['previous', 'linear']), samplesPerSegment: integer('구간당 due 샘플', 1, 1, 10000) } }),
  define('source.random-configured', '채널 난수', 'Random Number (Configured)', '유한한 scalar·벡터·2D parameters의 독립 element-channel normal/uniform 표본입니다. row-major 순서의 자체 seed stream을 사용합니다.', { ...source, parameters: { distribution: choice('분포', 'normal', ['normal', 'uniform']), mean: value('평균', 0), variance: value('분산', 1), min: value('최소', 0), max: value('최대', 1), seed: integer('seed', 1, 0, 4294967295) } }),
  define('verify.gradient', '이산 변화량 검증', 'Check Discrete Gradient', '각 원소의 abs(current−previous)<abs(maximumGradient)를 모두 검증합니다. Ts로 나누지 않습니다. 실패하면 실행을 중단합니다.', { category: '검증', supportedModes: ['discrete'], parameters: { initial: value('이전 입력', 0), maximumGradient: number('최대 변화량', 1) } }),
  define('verify.resolution', '입력 해상도 검증', 'Check Input Resolution', '양의 scalar resolution에 mod(input,resolution)<tolerance를 모두 검증합니다. vector membership 옵션은 미지원입니다.', { ...stateless, category: '검증', parameters: { resolution: number('해상도', 1, 1e-12), tolerance: number('허용 나머지', .01, 0) } }),
];

export const M9_BLOCK_PRESETS = [
  { id: 'fir-configured', blockType: 'discrete.filter', label: 'Configured FIR', parameters: { denominator: [1], representation: 'filter' } },
  { id: 'transfer-configured', blockType: 'discrete.filter', label: 'Configured Discrete Transfer Fcn', parameters: { representation: 'transfer' } },
  { id: 'direct-form-ii', blockType: 'discrete.filter', label: 'Transfer Fcn Direct Form II', parameters: { structure: 'df2', representation: 'filter' } },
  { id: 'first-order-response', blockType: 'discrete.filter', label: 'First Order Response (Configured)', parameters: { numerator: [.5, 0], denominator: [1, -.5], representation: 'transfer' } },
  { id: 'lead-lag-response', blockType: 'discrete.filter', label: 'Lead / Lag Response (Configured)', parameters: { numerator: [1, -.25], denominator: [1, -.5], representation: 'transfer' } },
  { id: 'real-zero-response', blockType: 'discrete.filter', label: 'Real Zero Response (Configured)', parameters: { numerator: [1, -.5], denominator: [1], representation: 'filter' } },
  { id: 'weighted-sample-time', blockType: 'time.weighted-math', label: 'Weighted Sample Time', parameters: { operation: 'TsOnly' } },
  { id: 'limited-counter', blockType: 'source.counter', label: 'Counter Limited', parameters: { mode: 'limited' } },
  ...(['change', 'increase', 'decrease', 'fall-negative', 'fall-nonpositive', 'rise-nonnegative', 'rise-positive'] as const).map(mode => ({ id: `detect-${mode}`, blockType: 'logic.numeric-edge', label: `Detect ${mode}`, parameters: { mode } })),
] as const;

const known: ReadonlySet<string> = new Set(M9_BLOCK_IDS);
/** Imported schema1 models may omit parameters that have registry defaults. */
function effectiveParameters(node: Pick<CalcNode, 'blockType' | 'parameters'>, definition: BlockDefinition): Record<string, unknown> {
  return Object.fromEntries(Object.entries(definition.parameters).map(([key, parameter]) => [key, Object.hasOwn(node.parameters, key) ? node.parameters[key] : parameter.default]));
}
export function getM9Ports(node: Pick<CalcNode, 'blockType' | 'parameters'>): { inputs: string[]; outputs: string[] } | undefined {
  const definition = M9_BLOCK_DEFINITIONS.find(entry => entry.id === node.blockType);
  if (!definition) return undefined;
  const inputs = [...definition.inputs], p = effectiveParameters(node, definition);
  if (node.blockType === 'time.weighted-math' && ['TsOnly', 'inverse'].includes(p.operation as string)) inputs.length = 0;
  if (node.blockType === 'discrete.delay-configured') {
    if (p.mode === 'variable') inputs.push('delay');
    if (p.initialSource === 'port') inputs.push('initial');
  }
  if (p.reset !== undefined && p.reset !== 'none') inputs.push('reset');
  if (p.enable === 'port') inputs.push('enable');
  return { inputs, outputs: [...definition.outputs] };
}
/** Current output/control validation dependencies; future data capture is absent from this list. */
export function getM9DirectFeedthroughPorts(node: Pick<CalcNode, 'blockType' | 'parameters'>): string[] | undefined {
  if (!known.has(node.blockType)) return undefined;
  const p = effectiveParameters(node, M9_BLOCK_DEFINITIONS.find(entry => entry.id === node.blockType)!);
  let inputs: string[];
  switch (node.blockType) {
    case 'discrete.delay-configured': inputs = p.mode === 'variable' ? ['delay', ...(p.allowZero === 'yes' ? ['in'] : [])] : p.steps === 0 ? ['in'] : []; if (p.initialSource === 'port') inputs.push('initial'); break;
    case 'discrete.tapped-delay': inputs = p.includeCurrent === 'yes' ? ['in'] : []; break;
    case 'discrete.integrator-configured': inputs = p.method === 'forward' ? [] : ['in']; break;
    case 'discrete.propagation-delay': inputs = ['delay']; break;
    case 'source.counter': case 'source.band-limited-noise': case 'source.signal-generator': case 'source.sine-configured': case 'source.sequence-configured': case 'source.random-configured': inputs = []; break;
    case 'discrete.filter': { const b = p.numerator as number[] | undefined, a = p.denominator as number[] | undefined; inputs = b?.[0] === 0 || (p.representation === 'transfer' && (b?.length ?? 0) < (a?.length ?? 0)) ? [] : ['in']; break; }
    case 'discrete.zero-pole': inputs = p.gain === 0 || (p.zeros as number[] | undefined)?.length! < (p.poles as number[] | undefined)?.length! ? [] : ['in']; break;
    case 'discrete.state-space-mimo': inputs = Array.isArray(p.D) && (p.D as number[][]).every(row => Array.isArray(row) && row.every(value => value === 0)) ? [] : ['in']; break;
    case 'time.weighted-math': inputs = ['TsOnly', 'inverse'].includes(p.operation as string) ? [] : ['in']; break;
    default: inputs = [...M9_BLOCK_DEFINITIONS.find(entry => entry.id === node.blockType)!.inputs];
  }
  if (p.reset !== undefined && p.reset !== 'none') inputs.push('reset');
  if (p.enable === 'port') inputs.push('enable');
  return inputs;
}
