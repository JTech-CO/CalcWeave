import type { BlockDefinition, ParameterDefinition } from './index';

/** New mathematical operations, not aliases or additional parameter presets of the original registry. */
export const EXPANSION_BLOCK_IDS = [
  'math.bias', 'math.sign', 'math.cbrt', 'math.expm1', 'math.log1p', 'math.log2', 'math.exp2',
  'math.sinh', 'math.cosh', 'math.tanh', 'math.asinh', 'math.acosh', 'math.atanh', 'math.sinc', 'math.polynomial',
  'math.power', 'math.hypot', 'math.atan2', 'math.mod', 'math.remainder',
  'nonlinear.dead-zone', 'nonlinear.quantizer', 'logic.interval', 'logic.is-integer', 'logic.approx-equal',
  'reduce.sum', 'reduce.product', 'reduce.mean', 'reduce.median', 'reduce.variance', 'reduce.std', 'reduce.rms',
  'reduce.norm1', 'reduce.norm2', 'reduce.norm-inf', 'reduce.all', 'reduce.any',
  'vector.dot', 'vector.cross', 'vector.normalize', 'vector.reverse', 'vector.sort', 'vector.cumsum', 'vector.cumprod',
  'vector.difference', 'vector.select', 'vector.slice', 'vector.repeat', 'vector.convolve',
  'matrix.trace', 'matrix.diagonal', 'matrix.diag-create', 'matrix.identity', 'matrix.select', 'matrix.row', 'matrix.column',
  'matrix.horizontal', 'matrix.vertical', 'matrix.triangle', 'matrix.symmetrize', 'matrix.kronecker',
  'source.linspace', 'source.logspace', 'source.zeros',
] as const;
export type ExpansionBlockType = typeof EXPANSION_BLOCK_IDS[number];
const scalar = (label: string, initial: number, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): ParameterDefinition => ({ kind: 'number', label, default: initial, min, max });
const integer = (label: string, initial: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: initial, min, max });
const choice = (label: string, initial: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: initial, options });
const indices = (label: string): ParameterDefinition => ({ kind: 'numeric-vector', label, default: [0], minLength: 1, maxLength: 32 });
const common = { version: 1, inputs: ['in'], outputs: ['out'], parameters: {}, category: '계산',
  supportedModes: ['static', 'discrete', 'continuous'], directFeedthrough: true, valueType: 'inherited', shape: 'inherited',
  unit: 'inherited', sampleTime: 'inherited', state: 'none', exportTargets: ['typescript'] } as const;
const define = (id: ExpansionBlockType, label: string, englishName: string, description: string, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...common, id, label, englishName, description, ...overrides });
const binary = { inputs: ['a', 'b'] } as const;
const source = { inputs: [], category: '입력', directFeedthrough: false, sampleTime: 'constant' } as const;
export const EXPANSION_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  define('math.bias', '값 더하기', 'Bias', '같은 단위의 고정 bias를 각 숫자에 더합니다.', { parameters: { bias: scalar('더할 값', 1) } }),
  define('math.sign', '부호', 'Sign', '각 숫자를 음수 -1, 영 0, 양수 1로 바꿉니다.'),
  define('math.cbrt', '세제곱근', 'Cube Root', '단위 없는 실수의 세제곱근을 계산합니다. 음수도 허용합니다.'),
  define('math.expm1', '작은 지수 차', 'Expm1', '단위 없는 입력에 exp(x)-1을 작은 입력에서도 정확하게 계산합니다.'),
  define('math.log1p', '작은 로그', 'Log1p', '단위 없는 x>-1에 log(1+x)를 계산합니다.'),
  define('math.log2', '밑 2 로그', 'Log2', '단위 없는 양수에 밑 2 로그를 계산합니다.'),
  define('math.exp2', '밑 2 지수', 'Exp2', '단위 없는 실수에 2의 x승을 계산합니다.'),
  ...(['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh'] as const).map((name) => define(`math.${name}`, ({ sinh: '쌍곡 사인', cosh: '쌍곡 코사인', tanh: '쌍곡 탄젠트', asinh: '역쌍곡 사인', acosh: '역쌍곡 코사인', atanh: '역쌍곡 탄젠트' })[name], name, `${name}의 실수 정의역에서 단위 없는 숫자를 계산합니다.`)),
  define('math.sinc', '정규화 sinc', 'Sinc', 'sin(πx)/(πx)를 계산합니다. x=0에서 1이며 정수 영점을 보존합니다.'),
  define('math.polynomial', '다항식', 'Polynomial', '단위 없는 입력에 내림차순 계수의 Horner 다항식을 계산합니다.', { parameters: { coefficients: { kind: 'numeric-vector', label: '내림차순 계수', default: [1, 0], minLength: 1, maxLength: 32 } } }),
  define('math.power', '거듭제곱', 'Power', '단위 없는 두 실수 입력의 거듭제곱입니다. 실수 정의역과 overflow를 검사합니다.', binary),
  define('math.hypot', '직각 거리', 'Hypot', '같은 단위의 두 입력에 sqrt(a²+b²)를 overflow를 줄여 계산합니다.', binary),
  define('math.atan2', '방향각', 'Atan2', '같은 단위의 a=y, b=x에서 방향각 rad를 계산합니다.', binary),
  define('math.mod', '모듈로', 'Modulo', '제수 b와 같은 부호를 가진 나머지를 계산합니다. b=0은 거부합니다.', binary),
  define('math.remainder', '나머지', 'Remainder', '피제수 a와 같은 부호를 가진 나머지를 계산합니다. b=0은 거부합니다.', binary),
  define('nonlinear.dead-zone', '불감대', 'Dead Zone', 'lower~upper 안에서는 0, 밖에서는 가까운 경계까지 차이를 출력합니다.', { parameters: { lower: scalar('아래 경계', -1), upper: scalar('위 경계', 1) } }),
  define('nonlinear.quantizer', '간격 양자화', 'Quantizer', '양의 간격 q로 양자화합니다. 정확한 절반은 영에서 먼 쪽으로 반올림합니다.', { parameters: { step: scalar('양자화 간격', 1, 1e-12) } }),
  define('logic.interval', '구간 검사', 'Interval Test', '각 숫자가 닫힌 lower~upper 구간에 들어가는지 boolean으로 확인합니다.', { category: '논리', parameters: { lower: scalar('아래 경계', 0), upper: scalar('위 경계', 1) } }),
  define('logic.is-integer', '정수 검사', 'Is Integer', '각 유한한 숫자가 정수인지 boolean으로 확인합니다.', { category: '논리' }),
  define('logic.approx-equal', '오차 안에서 같음', 'Approximately Equal', '같은 단위의 두 입력의 절대 오차가 tolerance 이하인지 확인합니다.', { ...binary, category: '논리', parameters: { tolerance: scalar('절대 오차', 1e-9, 0) } }),
  ...(['sum', 'product', 'mean', 'median', 'variance', 'std', 'rms', 'norm1', 'norm2', 'norm-inf', 'all', 'any'] as const).map((name) => define(`reduce.${name}`, ({ sum: '원소 합계', product: '원소 곱', mean: '평균', median: '중앙값', variance: '모집단 분산', std: '모집단 표준편차', rms: '제곱 평균의 제곱근', norm1: 'L1 노름', norm2: 'L2 노름', 'norm-inf': '최대 절댓값 노름', all: '모두 참', any: '하나 이상 참' })[name], name, name === 'all' || name === 'any' ? 'boolean 신호의 모든 원소를 scalar로 집계합니다.' : `숫자 신호의 전체 원소를 행 우선 순서로 ${name} 집계합니다.`, { category: '통계' })),
  define('vector.dot', '내적', 'Dot Product', '같은 길이의 숫자 벡터 두 개의 내적을 계산합니다.', { ...binary, category: '벡터' }),
  define('vector.cross', '외적', 'Cross Product', '길이 3의 숫자 벡터 두 개의 오른손 외적을 계산합니다.', { ...binary, category: '벡터' }),
  define('vector.normalize', '단위 벡터', 'Normalize', '영이 아닌 숫자 벡터를 L2 노름으로 나누어 단위 없는 벡터로 만듭니다.', { category: '벡터' }),
  define('vector.reverse', '순서 뒤집기', 'Reverse', '숫자 또는 boolean 벡터의 원소 순서를 뒤집습니다.', { category: '벡터' }),
  define('vector.sort', '정렬', 'Sort', '숫자 벡터를 오름차순 또는 내림차순으로 정렬합니다.', { category: '벡터', parameters: { order: choice('정렬 순서', 'ascending', ['ascending', 'descending']) } }),
  define('vector.cumsum', '누적 합', 'Cumulative Sum', '숫자 벡터의 누적 합을 계산합니다.', { category: '벡터' }),
  define('vector.cumprod', '누적 곱', 'Cumulative Product', '단위 없는 숫자 벡터의 누적 곱을 계산합니다.', { category: '벡터' }),
  define('vector.difference', '인접 차분', 'Adjacent Difference', '숫자 벡터에서 다음 원소와 현재 원소의 차를 계산합니다.', { category: '벡터' }),
  define('vector.select', '원소 선택', 'Gather', '0부터 시작하는 승인된 정수 index로 벡터 원소를 선택합니다. 반복 선택도 허용합니다.', { category: '신호 처리', parameters: { indices: indices('선택 index') } }),
  define('vector.slice', '벡터 구간', 'Slice', '0부터 시작하는 start에서 count개 벡터 원소를 선택합니다.', { category: '신호 처리', parameters: { start: integer('시작 index', 0, 0, 1023), count: integer('원소 수', 1, 1, 1024) } }),
  define('vector.repeat', '벡터 반복', 'Repeat', '벡터의 전체 순서를 count번 반복합니다. 결과는 1,024개 원소 이하입니다.', { category: '신호 처리', parameters: { count: integer('반복 횟수', 2, 1, 32) } }),
  define('vector.convolve', '유한 합성곱', 'Convolution', '두 숫자 벡터의 full 선형 합성곱을 계산합니다.', { ...binary, category: '신호 처리' }),
  define('matrix.trace', '대각합', 'Trace', '실수 정방 행렬의 주대각 원소를 더합니다.', { category: '행렬' }),
  define('matrix.diagonal', '대각 추출', 'Diagonal', '실수 또는 boolean 2D 행렬의 주대각을 벡터로 추출합니다.', { category: '행렬' }),
  define('matrix.diag-create', '대각 행렬', 'Diagonal Matrix', '길이 32 이하 숫자 또는 boolean 벡터로 정방 대각 행렬을 만듭니다.', { category: '행렬' }),
  define('matrix.identity', '단위 행렬', 'Identity Matrix', '크기 1~32의 단위 없는 단위 행렬을 생성합니다.', { ...source, category: '행렬', parameters: { size: integer('행렬 크기', 2, 1, 32) } }),
  define('matrix.select', '행렬 구간 선택', 'Matrix Select', '각 축 1~32 행렬에서 0부터 시작하는 정수 행·열 index를 선택합니다.', { category: '행렬', parameters: { rows: indices('행 index'), columns: indices('열 index') } }),
  define('matrix.row', '행 추출', 'Matrix Row', '0부터 시작하는 index의 행을 벡터로 추출합니다.', { category: '행렬', parameters: { index: integer('행 index', 0, 0, 31) } }),
  define('matrix.column', '열 추출', 'Matrix Column', '0부터 시작하는 index의 열을 벡터로 추출합니다.', { category: '행렬', parameters: { index: integer('열 index', 0, 0, 31) } }),
  define('matrix.horizontal', '행렬 가로 결합', 'Horizontal Concatenate', '같은 행 수·타입·단위의 행렬을 가로로 결합합니다.', { ...binary, category: '행렬' }),
  define('matrix.vertical', '행렬 세로 결합', 'Vertical Concatenate', '같은 열 수·타입·단위의 행렬을 세로로 결합합니다.', { ...binary, category: '행렬' }),
  define('matrix.triangle', '삼각 부분', 'Triangular Part', '행렬에서 주대각을 포함한 위 또는 아래 삼각 부분을 남깁니다.', { category: '행렬', parameters: { part: choice('남길 부분', 'upper', ['upper', 'lower']) } }),
  define('matrix.symmetrize', '대칭화', 'Symmetrize', '실수 정방 행렬에서 (A+Aᵀ)/2를 계산합니다.', { category: '행렬' }),
  define('matrix.kronecker', '크로네커 곱', 'Kronecker Product', '두 실수 행렬의 Kronecker 곱을 계산합니다. 출력 각 축은 32 이하입니다.', { ...binary, category: '행렬' }),
  define('source.linspace', '균등 간격 벡터', 'Linspace', 'start와 stop을 포함한 count개 숫자를 생성합니다. count=1이면 start입니다.', { ...source, parameters: { start: scalar('시작 값', 0), stop: scalar('마지막 값', 1), count: integer('원소 수', 5, 1, 1024) } }),
  define('source.logspace', '로그 간격 벡터', 'Logspace', '10^start와 10^stop 사이 count개 로그 간격 값을 생성합니다.', { ...source, parameters: { start: scalar('시작 지수', 0, -323, 308), stop: scalar('마지막 지수', 2, -323, 308), count: integer('원소 수', 3, 1, 1024) } }),
  define('source.zeros', '영 배열', 'Zeros', '요청한 크기의 영 벡터 또는 각 축 32 이하 영 행렬을 생성합니다.', { ...source, parameters: { form: choice('배열 형상', 'vector', ['vector', 'matrix']), length: integer('벡터 길이', 3, 1, 1024), rows: integer('행 수', 2, 1, 32), columns: integer('열 수', 2, 1, 32) } }),
];
