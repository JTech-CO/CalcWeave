import type { BlockType, CalcModel, CalcNode, ExecutionMode } from '../../model/src/types';
import { UNITS } from '../../model/src/signal';

export interface ParameterDefinition {
  readonly kind: 'number' | 'integer' | 'value' | 'numeric-vector' | 'enum' | 'expression' | 'text';
  readonly label: string;
  readonly default: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly string[];
  readonly maxLength?: number;
  readonly minLength?: number;
}
export interface BlockDefinition {
  readonly id: BlockType;
  readonly version: 1;
  readonly label: string;
  readonly englishName: string;
  readonly description: string;
  readonly category: string;
  readonly aliases?: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly parameters: Readonly<Record<string, ParameterDefinition>>;
  readonly supportedModes: readonly ExecutionMode[];
  readonly directFeedthrough: boolean;
  readonly valueType: 'float64' | 'boolean' | 'inherited';
  readonly shape: 'scalar' | 'inherited';
  readonly unit: 'dimensionless' | 'inherited';
  readonly sampleTime: 'constant' | 'inherited' | 'fixed-tick' | 'solver-step';
  readonly state: 'none' | 'previous-value' | 'continuous-state' | 'discrete-state';
  readonly exportTargets: readonly 'typescript'[];
}

const modes: readonly ExecutionMode[] = ['static', 'discrete', 'continuous'];
const scalar = (label: string, value: number): ParameterDefinition => ({ kind: 'number', label, default: value, min: -Number.MAX_VALUE, max: Number.MAX_VALUE });
const choice = (label: string, value: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: value, options });
const integer = (label: string, value: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: value, min, max });
const value = (label: string, initial: unknown): ParameterDefinition => ({ kind: 'value', label, default: initial });
const reset = choice('초기화', 'none', ['none', 'level']);
const common = { version: 1, valueType: 'inherited', shape: 'inherited', unit: 'inherited', exportTargets: ['typescript'], supportedModes: modes, directFeedthrough: true, sampleTime: 'inherited', state: 'none' } as const;
const timeSource = { ...common, valueType: 'float64', shape: 'scalar', category: '시간 입력', inputs: [], outputs: ['out'], supportedModes: ['discrete', 'continuous'], directFeedthrough: false, sampleTime: 'fixed-tick' } as const;
const discrete = { ...common, category: '이산 상태', inputs: ['in'], outputs: ['out'], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state' } as const;
const continuous = { ...common, category: '연속 상태', valueType: 'float64', shape: 'scalar', unit: 'dimensionless', inputs: ['in'], outputs: ['out'], supportedModes: ['continuous'], sampleTime: 'solver-step', state: 'continuous-state', directFeedthrough: false } as const;
const roots = (label: string, initial: number[], minLength = 0): ParameterDefinition => ({ kind: 'numeric-vector', label, default: initial, minLength, maxLength: 16 });
const coefficients = (label: string, initial: number[]): ParameterDefinition => ({ kind: 'numeric-vector', label, default: initial, minLength: 1, maxLength: 17 });
const lookupAxis = (label: string): ParameterDefinition => ({ kind: 'numeric-vector', label, default: [0, 1], minLength: 2, maxLength: 32 });
const extrapolation = choice('범위 밖', 'clip', ['clip', 'linear', 'error']);
const matrix = { ...common, category: '행렬', inputs: ['in'], outputs: ['out'], parameters: {} } as const;

const definitions: BlockDefinition[] = [
  { ...common, id: 'source.constant', label: '상수', englishName: 'Constant', description: '숫자·boolean·벡터·2D 값을 보냅니다.', category: '입력', aliases: ['값', '상수 값', '숫자', 'constant'], inputs: [], outputs: ['out'], parameters: { value: { kind: 'value', label: '값', default: 1 } }, supportedModes: modes, directFeedthrough: false, sampleTime: 'constant' },
  { ...common, id: 'io.input', label: '입력', englishName: 'Input', description: '모델 입력을 숫자·boolean·벡터·2D 값으로 설정합니다.', category: '입력', aliases: ['값', '입력값', 'inport', 'input'], inputs: [], outputs: ['out'], parameters: { value: { kind: 'value', label: '입력값', default: 1 } }, supportedModes: modes, directFeedthrough: false, sampleTime: 'constant' },
  { ...common, id: 'math.gain', label: '배율', englishName: 'Gain', description: '숫자 신호의 각 원소에 배율을 곱합니다.', category: '계산', aliases: ['곱배율', '스케일', 'gain'], inputs: ['in'], outputs: ['out'], parameters: { gain: scalar('배율', 2) }, supportedModes: modes },
  { ...common, id: 'math.sum', label: '덧셈', englishName: 'Sum', description: '두 숫자 입력을 부호 설정에 따라 더하거나 뺍니다.', category: '계산', aliases: ['더하기', '빼기', '합계', 'add', 'subtract', 'sum', '+'], inputs: ['a', 'b'], outputs: ['out'], parameters: { signs: choice('입력 부호', '++', ['++', '+-', '-+', '--']) }, supportedModes: modes },
  { ...common, id: 'math.multiply', label: '곱셈', englishName: 'Product', description: '두 숫자 신호를 원소별로 곱하거나 나눕니다.', category: '계산', aliases: ['곱하기', '나누기', 'multiply', 'product', '*'], inputs: ['a', 'b'], outputs: ['out'], parameters: { operation: choice('연산', 'multiply', ['multiply', 'divide']) }, supportedModes: modes },
  { ...common, id: 'math.abs', label: '절댓값', englishName: 'Abs', description: '숫자 신호의 원소별 절댓값을 계산합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: {} },
  { ...common, id: 'math.function', label: '수학 함수', englishName: 'Math Function', description: 'exp, log, log10, square, reciprocal을 원소별로 계산합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: { operation: choice('함수', 'exp', ['exp', 'log', 'log10', 'square', 'reciprocal']) } },
  { ...common, id: 'math.trigonometric', label: '삼각 함수', englishName: 'Trigonometric', description: '단위 없는 radian 숫자에 삼각·역삼각 함수를 적용합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: { operation: choice('함수', 'sin', ['sin', 'cos', 'tan', 'asin', 'acos', 'atan']) } },
  { ...common, id: 'math.round', label: '반올림', englishName: 'Rounding', description: '원소별 반올림·내림·올림·소수점 절삭을 적용합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: { operation: choice('방식', 'round', ['round', 'floor', 'ceil', 'trunc']) } },
  { ...common, id: 'math.minmax', label: '최솟값·최댓값', englishName: 'MinMax', description: '두 입력을 원소별 비교하거나 한 신호 전체를 집계합니다.', category: '계산', inputs: ['a', 'b'], outputs: ['out'], parameters: { operation: choice('연산', 'min', ['min', 'max']), strategy: choice('대상', 'pairwise', ['pairwise', 'reduce']) } },
  { ...common, id: 'math.sqrt', label: '제곱근', englishName: 'Sqrt', description: '음수가 아닌 숫자의 원소별 제곱근을 계산합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: {} },
  { ...common, id: 'logic.compare', label: '비교', englishName: 'Compare', description: '두 숫자 입력을 비교하고 boolean 결과를 보냅니다.', category: '논리', valueType: 'boolean', inputs: ['a', 'b'], outputs: ['out'], parameters: { operation: choice('조건', 'gt', ['eq', 'ne', 'lt', 'le', 'gt', 'ge']) } },
  { ...common, id: 'logic.boolean', label: '논리 연산', englishName: 'Boolean', description: 'boolean 신호에 and, or, xor, not을 적용합니다.', category: '논리', valueType: 'boolean', inputs: ['a', 'b'], outputs: ['out'], parameters: { operation: choice('연산', 'and', ['and', 'or', 'xor', 'not']) } },
  { ...common, id: 'route.switch', label: '선택', englishName: 'Switch', description: 'boolean scalar 조건이 true면 a, false면 b를 선택합니다.', category: '신호 처리', inputs: ['a', 'condition', 'b'], outputs: ['out'], parameters: {} },
  { ...common, id: 'nonlinear.saturation', label: '범위 제한', englishName: 'Saturation', description: '숫자 신호의 각 원소를 하한과 상한 안으로 제한합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: { lower: scalar('하한', 0), upper: scalar('상한', 1) } },
  { ...common, id: 'route.mux', label: '벡터 묶기', englishName: 'Mux', description: '같은 타입·단위의 scalar 또는 vector 두 입력을 한 vector로 묶습니다.', category: '신호 처리', inputs: ['a', 'b'], outputs: ['out'], parameters: {} },
  { ...common, id: 'route.demux', label: '벡터 나누기', englishName: 'Demux', description: '길이 count의 vector를 scalar 출력 포트로 나눕니다.', category: '신호 처리', inputs: ['in'], outputs: ['out1', 'out2'], parameters: { count: integer('출력 개수', 2, 1, 16) } },
  { ...common, id: 'math.concatenate', label: '벡터 연결', englishName: 'Concatenate', description: '같은 타입·단위의 scalar 또는 vector 두 입력을 연결합니다.', category: '신호 처리', inputs: ['a', 'b'], outputs: ['out'], parameters: {} },
  { ...common, id: 'matrix.reshape', label: '형상 변경', englishName: 'Reshape', description: '원소 순서를 유지하며 row-major vector 또는 2D matrix로 변경합니다.', category: '신호 처리', inputs: ['in'], outputs: ['out'], parameters: { form: choice('형상', 'vector', ['vector', 'matrix']), rows: integer('행 수', 1, 1, 1_024), columns: integer('열 수', 2, 1, 1_024) } },
  { ...common, id: 'sink.display', label: '결과', englishName: 'Display', description: '신호 값을 실행 결과에 기록합니다.', category: '결과', aliases: ['값 표시', '값표시', 'display', '그래프'], inputs: ['in'], outputs: [], parameters: {}, supportedModes: modes },
  { ...common, id: 'io.output', label: '출력', englishName: 'Outport', description: '모델 출력을 실행 결과에 기록합니다.', category: '결과', aliases: ['output', 'outport'], inputs: ['in'], outputs: [], parameters: {} },
  { ...common, id: 'io.terminator', label: '신호 종료', englishName: 'Terminator', description: '입력 신호를 검증하고 종료합니다. 결과에는 기록하지 않습니다.', category: '결과', inputs: ['in'], outputs: [], parameters: {} },
  { ...common, id: 'math.expression', label: '수식', englishName: 'Expression', description: 'x와 허용 함수만 사용하는 제한 수식을 각 숫자 원소에 적용합니다.', category: '계산', aliases: ['fcn', 'formula', '함수', '식'], inputs: ['in'], outputs: ['out'], parameters: { expression: { kind: 'expression', label: '수식', default: 'x', maxLength: 512 } } },
  { ...common, id: 'discrete.unit-delay', label: '한 틱 지연', englishName: 'Unit Delay', description: '이전 due 입력을 출력합니다. 숫자·boolean·배열과 다음 commit 초기화를 지원합니다.', category: '이산 상태', aliases: ['지연', '이전 값', '1단계 지연', 'unit delay'], inputs: ['in'], outputs: ['out'], parameters: { initial: value('초기값', 0), reset }, supportedModes: ['discrete', 'continuous'], directFeedthrough: false, sampleTime: 'fixed-tick', state: 'previous-value' },
  { ...continuous, id: 'continuous.integrator', label: '적분', englishName: 'Integrator', description: '단위 없는 scalar 입력을 RK4·RK45로 적분하고 rising 초기화를 지원합니다.', aliases: ['적분', '누적', 'integrator'], parameters: { initial: scalar('초기값', 0), reset: choice('초기화', 'none', ['none', 'rising']) } },
  { ...timeSource, id: 'source.step', label: '계단 입력', englishName: 'Step', description: '지정 시각 전후의 값을 출력합니다. 연속 실행은 실제 변화 시각에 멈추고 이산 실행은 due grid에 맞춥니다.', parameters: { stepTime: scalar('변화 시각', 1), before: scalar('변화 전', 0), after: scalar('변화 후', 1) } },
  { ...timeSource, id: 'source.ramp', label: '선형 증가', englishName: 'Ramp', description: '시작 시각 이후 기울기에 따라 증가합니다.', parameters: { startTime: scalar('시작 시각', 0), slope: scalar('기울기', 1), initial: scalar('초기값', 0) } },
  { ...timeSource, id: 'source.sine-wave', label: '사인파', englishName: 'Sine Wave', description: '주파수 Hz와 위상 rad를 가진 시간 사인파입니다.', parameters: { amplitude: scalar('진폭', 1), frequency: { ...scalar('주파수 (Hz)', 1), min: 0 }, phase: scalar('위상 (rad)', 0), bias: scalar('오프셋', 0) } },
  { ...timeSource, id: 'source.pulse', label: '펄스', englishName: 'Pulse', description: '정수 base tick의 주기·폭·위상으로 펄스를 만듭니다.', parameters: { amplitude: scalar('진폭', 1), period: integer('주기 (base tick)', 10, 1, 10_000), width: integer('폭 (base tick)', 5, 0, 10_000), phase: integer('위상 (base tick)', 0, 0, 9_999) } },
  { ...timeSource, id: 'source.clock', label: '시계', englishName: 'Clock', description: '연속 솔버의 실제 단계 시각 또는 이산 base tick 시각을 초 단위로 출력합니다.', parameters: {} },
  { ...timeSource, id: 'source.digital-clock', label: '이산 시계', englishName: 'Digital Clock', description: 'due 시각을 초 단위로 갱신하고 그 사이에는 유지합니다.', parameters: {} },
  { ...timeSource, id: 'source.random', label: '시드 난수', englishName: 'Random', description: '노드마다 독립적인 LCG32 시드의 uniform/normal 난수입니다.', state: 'discrete-state', parameters: { distribution: choice('분포', 'uniform', ['uniform', 'normal']), seed: integer('시드', 1, 0, 0xffff_ffff), min: scalar('최솟값', 0), max: scalar('최댓값', 1), mean: scalar('평균', 0), variance: { ...scalar('분산', 1), min: 0 } } },
  { ...timeSource, id: 'source.repeating-sequence', label: '반복 수열', englishName: 'Repeating Sequence', description: '엄격히 증가하는 시간 점을 주기적으로 linear/previous 보간합니다.', parameters: { times: value('시간 점', [0, 1]), values: value('값', [0, 1]), interpolation: choice('보간', 'linear', ['linear', 'previous']) } },
  { ...discrete, id: 'discrete.delay', label: '고정 지연', englishName: 'Delay', description: 'FIFO에 입력을 저장해 지정한 due 횟수만큼 지연합니다.', directFeedthrough: false, parameters: { steps: integer('지연 횟수', 2, 1, 1_024), initial: value('초기값', 0), reset } },
  { ...discrete, id: 'discrete.integrator', label: '이산 적분', englishName: 'Discrete Integrator', description: '고정 due 간격의 forward Euler 적분입니다. 단위 없는 숫자만 지원합니다.', directFeedthrough: false, parameters: { initial: value('초기값', 0), gain: scalar('배율', 1), reset } },
  { ...discrete, id: 'discrete.difference', label: '차분', englishName: 'Difference', description: '현재 입력에서 이전 due 입력을 뺍니다.', parameters: { initial: value('초기 입력', 0) } },
  { ...discrete, id: 'discrete.derivative', label: '이산 미분', englishName: 'Discrete Derivative', description: '차분을 period×base step으로 나눕니다. 단위 없는 숫자만 지원합니다.', parameters: { initial: value('초기 입력', 0) } },
  { ...discrete, id: 'discrete.fir', label: 'FIR 필터', englishName: 'FIR', description: '최대 128개 tap의 원소별 이산 FIR 필터입니다.', parameters: { coefficients: value('계수', [1]), initial: value('초기 입력', 0), reset } },
  { ...discrete, id: 'discrete.transfer-function', label: '이산 전달 함수', englishName: 'Discrete Transfer Fcn', description: 'z⁻¹ 계수 차분식의 scalar SISO 전달 함수입니다.', valueType: 'float64', shape: 'scalar', unit: 'dimensionless', parameters: { numerator: value('분자 계수', [1]), denominator: value('분모 계수', [1, -0.5]), initial: scalar('초기 이력', 0), reset } },
  { ...discrete, id: 'discrete.state-space', label: '이산 상태 공간', englishName: 'Discrete State Space', description: '최대 16개 상태의 단위 없는 scalar SISO 상태 공간입니다.', valueType: 'float64', shape: 'scalar', unit: 'dimensionless', parameters: { A: value('A 행렬', [[0.5]]), B: value('B 벡터', [1]), C: value('C 벡터', [1]), D: scalar('D', 0), initial: value('초기 상태', [0]), reset } },
  { ...discrete, id: 'logic.edge-detect', label: '논리 에지 검출', englishName: 'Edge Detect', description: 'boolean scalar의 rising/falling/either 변화를 검출합니다.', category: '논리', valueType: 'boolean', shape: 'scalar', unit: 'dimensionless', parameters: { mode: choice('에지', 'rising', ['rising', 'falling', 'either']), initial: value('이전 값', false) } },
  { ...discrete, id: 'time.rate-transition', label: '샘플시간 연결', englishName: 'Rate Transition', description: '다른 rate를 read-before-write 경계 버퍼로 연결합니다. 동시 hit에도 이전 publication을 읽습니다.', category: '신호 처리', directFeedthrough: false, parameters: { initial: value('초기값', 0) } },
  { ...common, id: 'lookup.interpolated', label: '1D 보간표', englishName: '1D Lookup', description: '단위 없는 입력에 linear/previous 1D 보간표를 적용합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: { breakpoints: value('입력 기준점', [0, 1]), values: value('출력 값', [0, 1]), interpolation: choice('보간', 'linear', ['linear', 'previous']), extrapolation: choice('범위 밖', 'clip', ['clip', 'error']) } },
  { ...common, id: 'logic.bitwise', label: '비트 연산', englishName: 'Bitwise', description: '1~32bit unsigned scalar 정수의 마스크·논리·shift 연산입니다.', category: '논리', valueType: 'float64', shape: 'scalar', unit: 'dimensionless', inputs: ['a', 'b'], outputs: ['out'], parameters: { operation: choice('연산', 'and', ['and', 'or', 'xor', 'not', 'shift-left', 'shift-right']), width: integer('비트 폭', 8, 1, 32), shift: integer('shift 수', 1, 0, 31) } },
  { ...common, id: 'sink.scope', label: '시간 그래프', englishName: 'Scope', description: '전체 원시 typed 시계열을 기록하고 scalar 숫자를 그래프로 봅니다.', category: '결과', inputs: ['in'], outputs: [], parameters: {} },
  { ...continuous, id: 'continuous.second-order-integrator', label: '2차 적분', englishName: 'Second Order Integrator', description: '가속도 입력을 위치와 속도의 두 상태로 적분합니다.', outputs: ['out', 'velocity'], parameters: { initialPosition: scalar('초기 위치', 0), initialVelocity: scalar('초기 속도', 0) } },
  { ...continuous, id: 'continuous.state-space', label: '연속 상태 공간', englishName: 'State Space', description: '최대 16개 상태의 단위 없는 scalar SISO 연속 상태 공간입니다.', parameters: { A: value('A 행렬', [[-1]]), B: roots('B 벡터', [1], 1), C: roots('C 벡터', [1], 1), D: scalar('D', 0), initial: roots('초기 상태', [0], 1) } },
  { ...continuous, id: 'continuous.transfer-function', label: '연속 전달 함수', englishName: 'Transfer Fcn', description: 's의 내림차순 실수 다항식 계수를 제어 정준형으로 계산합니다. 최대 차수 16입니다.', parameters: { numerator: coefficients('분자 계수', [1]), denominator: coefficients('분모 계수', [1, 1]), initial: roots('초기 상태', [0]) } },
  { ...continuous, id: 'continuous.zero-pole', label: '영점·극점', englishName: 'Zero Pole', description: '실수 영점·극점과 gain을 연속 전달 함수로 변환합니다. 최대 극점 16개입니다.', parameters: { zeros: roots('실수 영점', []), poles: roots('실수 극점', [-1]), gain: scalar('배율', 1), initial: roots('초기 상태', [0]) } },
  { ...continuous, id: 'continuous.pid', label: '연속 PID', englishName: 'PID', description: 'parallel PID와 1차 저역 통과 미분 필터를 계산합니다.', directFeedthrough: true, parameters: { kp: scalar('P 배율', 1), ki: scalar('I 배율', 1), kd: scalar('D 배율', 0), filterN: { ...scalar('미분 필터 N', 10), min: 1e-12 }, initialIntegral: scalar('초기 적분', 0), initialFilter: scalar('초기 필터', 0) } },
  { ...continuous, id: 'continuous.derivative', label: '필터 미분', englishName: 'Derivative', description: 'N·(입력−필터 상태)의 causal 1차 필터 미분입니다.', directFeedthrough: true, parameters: { filterN: { ...scalar('미분 필터 N', 10), min: 1e-12 }, initial: scalar('초기 필터', 0) } },
  { ...continuous, id: 'time.memory', label: '연속 메모리', englishName: 'Memory', description: '직전 승인 솔버 단계의 입력을 다음 단계에서 출력합니다.', category: '신호 처리', state: 'discrete-state', parameters: { initial: scalar('초기값', 0) } },
  { ...continuous, id: 'time.zero-order-hold', label: '0차 홀드', englishName: 'Zero Order Hold', description: '지정 due 경계에서 연속 입력을 샘플링하고 다음 publication까지 유지합니다.', category: '신호 처리', state: 'discrete-state', sampleTime: 'fixed-tick', parameters: { initial: scalar('초기값', 0) } },
  { ...continuous, id: 'time.first-order-hold', label: '1차 홀드', englishName: 'First Order Hold', description: '이전 두 due 샘플의 기울기로 다음 구간을 causal 선형 외삽합니다.', category: '신호 처리', state: 'discrete-state', sampleTime: 'fixed-tick', parameters: { initial: scalar('초기값', 0) } },
  { ...continuous, id: 'time.transport-delay', label: '시간 지연', englishName: 'Transport Delay', description: '승인된 단계 이력의 선형 보간으로 양의 시간 지연을 계산합니다.', category: '신호 처리', state: 'discrete-state', parameters: { delay: { ...scalar('지연 (s)', 0.1), min: 1e-12, max: 1e9 }, initial: scalar('초기값', 0) } },
  { ...continuous, id: 'logic.hit-crossing', label: '교차 검출', englishName: 'Hit Crossing', description: '임계값의 rising/falling/either 교차를 사건으로 기록합니다.', category: '논리', valueType: 'boolean', state: 'discrete-state', parameters: { threshold: scalar('임계값', 0), direction: choice('방향', 'either', ['rising', 'falling', 'either']) } },
  { ...continuous, id: 'nonlinear.relay', label: '히스테리시스', englishName: 'Relay', description: 'on/off 임계값을 통과할 때 출력 상태를 바꿉니다.', category: '계산', state: 'discrete-state', parameters: { onThreshold: scalar('켜짐 임계값', 1), offThreshold: scalar('꺼짐 임계값', 0), onValue: scalar('켜짐 값', 1), offValue: scalar('꺼짐 값', 0), initial: choice('초기 상태', 'off', ['off', 'on']) } },
  { ...common, id: 'source.dataset', label: '데이터 재생', englishName: 'Playback', description: '프로젝트에 저장한 숫자·boolean 열을 시간축에 따라 재생합니다.', category: '입력', inputs: [], outputs: ['out'], directFeedthrough: false, aliases: ['from file', 'from workspace', '데이터', '시계열'], parameters: { datasetId: { kind: 'text', label: '데이터 ID', default: 'data', maxLength: 64 }, column: { kind: 'text', label: '값 열', default: 'value', maxLength: 80 }, interpolation: choice('보간', 'linear', ['linear', 'previous']), outside: choice('범위 밖', 'hold', ['hold', 'zero', 'error']) } },
  { ...common, id: 'unit.convert', label: '단위 변환', englishName: 'Unit Conversion', description: '호환 차원의 승인 단위를 명시적으로 변환합니다.', category: '계산', inputs: ['in'], outputs: ['out'], parameters: { from: choice('입력 단위', 'cm', UNITS), to: choice('출력 단위', 'm', UNITS) } },
  { ...common, id: 'route.bus-create', label: '이름으로 묶기', englishName: 'Bus Creator', description: '같은 타입·단위의 scalar 두 개를 이름이 있는 신호로 묶습니다.', category: '신호 처리', inputs: ['a', 'b'], outputs: ['out'], parameters: { first: { kind: 'text', label: '첫 필드', default: 'a', maxLength: 64 }, second: { kind: 'text', label: '둘째 필드', default: 'b', maxLength: 64 } } },
  { ...common, id: 'route.bus-select', label: '이름으로 선택', englishName: 'Bus Selector', description: '이름으로 묶은 신호에서 scalar 필드 하나를 선택합니다.', category: '신호 처리', inputs: ['in'], outputs: ['out'], parameters: { field: { kind: 'text', label: '필드', default: 'a', maxLength: 64 } } },
  { ...common, id: 'hierarchy.subsystem', label: '서브시스템', englishName: 'Subsystem', description: '프로젝트 정의의 입출력과 상태를 독립 인스턴스로 연결합니다.', category: '계층', inputs: [], outputs: [], parameters: { definitionId: { kind: 'text', label: '정의 ID', default: 'subsystem', maxLength: 64 }, version: integer('정의 버전', 1, 1, 1000000) } },
  { ...common, id: 'annotation.note', label: '도식 메모', englishName: 'DocBlock', description: '실행에 영향을 주지 않는 일반 텍스트 메모입니다.', category: '설명', inputs: [], outputs: [], parameters: { text: { kind: 'text', label: '메모', default: '', maxLength: 2000 } } },
  { ...common, id: 'annotation.model-info', label: '모델 정보', englishName: 'Model Info', description: '모델·엔진·데이터·정의의 버전은 작업 공간의 모델 정보에서 확인합니다.', category: '설명', inputs: [], outputs: [], parameters: {} },
  { ...matrix, id: 'math.matrix-multiply', label: '행렬 곱', englishName: 'Matrix Multiply', description: '각 축 32 이하 실수 2D 행렬 A·B를 곱합니다. 원소별 곱과 구분합니다.', aliases: ['행렬', 'product', 'matrix multiply'], inputs: ['a', 'b'] },
  { ...matrix, id: 'matrix.transpose', label: '전치', englishName: 'Transpose', description: '실수 2D 행렬의 행과 열을 바꿉니다. 단위를 유지합니다.' },
  { ...matrix, id: 'matrix.determinant', label: '행렬식', englishName: 'Determinant', description: '단위 없는 실수 정방 행렬의 determinant를 계산합니다.' },
  { ...matrix, id: 'matrix.inverse', label: '역행렬', englishName: 'Inverse', description: '단위 없는 실수 정방 행렬의 inverse를 계산합니다. 특이·조건 불량 입력은 진단합니다.' },
  { ...matrix, id: 'matrix.solve', label: '선형 방정식', englishName: 'Linear Solve', description: 'A·X=B를 partial pivoting으로 풉니다. A는 단위 없는 정방 행렬, B는 2D입니다.', aliases: ['선형', '방정식', 'linear solve', 'ax=b'], inputs: ['a', 'b'] },
  { ...matrix, id: 'matrix.cholesky', label: 'Cholesky 분해', englishName: 'Cholesky', description: '단위 없는 실수 대칭 양의 정부호 행렬 A=L·Lᵀ의 하삼각 L을 출력합니다.' },
  { ...matrix, id: 'matrix.lu', label: 'LU 분해', englishName: 'LU', description: '단위 없는 실수 정방 행렬을 P·A=L·U로 분해하여 세 행렬을 출력합니다.', outputs: ['lower', 'upper', 'permutation'] },
  { ...common, id: 'lookup.2d', label: '2D 보간표', englishName: '2D Lookup', description: '비균일 두 기준점 축에서 bilinear·nearest·previous 보간합니다. 선형 외삽은 linear 보간에만 적용합니다.', category: '계산', inputs: ['row', 'column'], outputs: ['out'], parameters: { rowBreakpoints: lookupAxis('행 기준점'), columnBreakpoints: lookupAxis('열 기준점'), table: value('출력 표 (행×열)', [[0, 1], [1, 2]]), interpolation: choice('보간', 'linear', ['linear', 'nearest', 'previous']), extrapolation } },
  { ...common, id: 'lookup.prelookup', label: '기준점 구간', englishName: 'Prelookup', description: 'scalar 입력의 0부터 시작하는 구간 인덱스와 구간 내 비율을 출력합니다. 마지막 끝점은 마지막 구간·비율 1입니다.', category: '계산', inputs: ['in'], outputs: ['index', 'fraction'], parameters: { breakpoints: lookupAxis('기준점'), extrapolation } },
  { ...common, id: 'fixed.quantize', label: '고정소수점 양자화', englishName: 'Fixed Quantize', description: '1~32bit 정수 코드로 정확히 양자화합니다. out은 복원 float64, stored는 정수 코드이며 다음 연산은 float64입니다.', category: '정밀도', aliases: ['fixed point', 'quantize', '반올림', '고정소수점'], inputs: ['in'], outputs: ['out', 'stored'], parameters: { wordLength: integer('비트 폭', 8, 1, 32), fractionLength: integer('소수 비트', 4, 0, 32), signedness: choice('부호', 'signed', ['signed', 'unsigned']), rounding: choice('반올림', 'nearest-even', ['nearest-even', 'floor', 'ceil', 'toward-zero']), overflow: choice('범위 초과', 'saturate', ['saturate', 'wrap', 'error']) } },
];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Typed algebraic, fixed-tick discrete and bounded continuous/mixed contracts. */
export const blockRegistry: readonly BlockDefinition[] = deepFreeze(definitions);
export const BLOCK_REGISTRY = blockRegistry;
const registryById = new Map<string, BlockDefinition>(blockRegistry.map((definition) => [definition.id, definition]));
export function getBlockDefinition(id: string): BlockDefinition | undefined { return registryById.get(id); }

/** UI may call this before compilation; invalid dynamic values use bounded defaults. */
export function getBlockPorts(node: Pick<CalcNode, 'blockType' | 'parameters'>, context?: Pick<CalcModel, 'subsystems'>): { inputs: string[]; outputs: string[] } {
  const definition = getBlockDefinition(node.blockType);
  if (!definition) return { inputs: [], outputs: [] };
  if (node.blockType === 'hierarchy.subsystem') {
    const subsystem = context?.subsystems?.find(item => item.id === node.parameters.definitionId);
    return subsystem ? { inputs: subsystem.inputs.map(port => port.id), outputs: subsystem.outputs.map(port => port.id) } : { inputs: [], outputs: [] };
  }
  if (node.blockType === 'route.demux') {
    const value = node.parameters.count;
    const count = typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 16 ? value : 2;
    return { inputs: ['in'], outputs: Array.from({ length: count }, (_, index) => `out${index + 1}`) };
  }
  if (node.blockType === 'math.minmax' && node.parameters.strategy === 'reduce') return { inputs: ['in'], outputs: ['out'] };
  if (node.blockType === 'logic.boolean' && node.parameters.operation === 'not') return { inputs: ['a'], outputs: ['out'] };
  if (node.blockType === 'logic.bitwise' && ['not', 'shift-left', 'shift-right'].includes(node.parameters.operation as string)) return { inputs: ['a'], outputs: ['out'] };
  if (Object.hasOwn(definition.parameters, 'reset') && ['level', 'rising'].includes(node.parameters.reset as string)) return { inputs: [...definition.inputs, 'reset'], outputs: [...definition.outputs] };
  return { inputs: [...definition.inputs], outputs: [...definition.outputs] };
}

/** Coefficient-dependent feedthrough is part of the approved discrete realization. */
export function isDirectFeedthrough(node: Pick<CalcNode, 'blockType' | 'parameters'>): boolean {
  if (node.blockType === 'discrete.fir') return (node.parameters.coefficients as unknown[] | undefined)?.[0] !== 0;
  if (node.blockType === 'discrete.transfer-function') return (node.parameters.numerator as unknown[] | undefined)?.[0] !== 0;
  if (node.blockType === 'discrete.state-space') return node.parameters.D !== 0;
  if (node.blockType === 'continuous.state-space') return node.parameters.D !== 0;
  if (node.blockType === 'continuous.transfer-function') return (node.parameters.numerator as unknown[] | undefined)?.length === (node.parameters.denominator as unknown[] | undefined)?.length && (node.parameters.numerator as unknown[] | undefined)?.[0] !== 0;
  if (node.blockType === 'continuous.zero-pole') return (node.parameters.zeros as unknown[] | undefined)?.length === (node.parameters.poles as unknown[] | undefined)?.length && node.parameters.gain !== 0;
  if (node.blockType === 'continuous.pid') return (node.parameters.kp as number) + (node.parameters.kd as number) * (node.parameters.filterN as number) !== 0;
  return getBlockDefinition(node.blockType)?.directFeedthrough ?? false;
}
