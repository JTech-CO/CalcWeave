import type { CalcNode } from '../../model/src/types';
import type { BlockDefinition, ParameterDefinition } from './index';

export const M8_BLOCK_IDS = [
  'nonlinear.friction', 'nonlinear.dead-zone-dynamic', 'nonlinear.saturation-dynamic', 'nonlinear.wrap-to-zero',
  'logic.compare-constant', 'logic.interval-dynamic', 'logic.truth-table',
  'math.signed-sqrt', 'math.reciprocal-sqrt', 'math.negate', 'math.sine-wave-function', 'math.increment',
  'matrix.assign', 'matrix.find-nonzero', 'matrix.permute-dimensions', 'matrix.squeeze', 'matrix.expand-scalar',
  'matrix.is-symmetric', 'matrix.is-triangular', 'matrix.square', 'matrix.permute-rows-cols',
  'route.manual-switch', 'route.multiport-switch', 'verify.assert', 'verify.bounds',
  'lookup.direct', 'lookup.interpolate-prelookup', 'lookup.dynamic', 'lookup.nd',
  'math.gain-matrix', 'math.sum-inputs', 'math.product-inputs', 'logic.combine', 'route.switch-threshold',
  'vector.select-dynamic', 'matrix.select-dynamic', 'route.mux-inputs', 'route.demux-widths',
  'math.concatenate-inputs', 'matrix.reshape-column-major', 'reduce.axis',
] as const;
export type M8BlockType = typeof M8_BLOCK_IDS[number];
const number = (label: string, initial: number, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): ParameterDefinition => ({ kind: 'number', label, default: initial, min, max });
const integer = (label: string, initial: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: initial, min, max });
const choice = (label: string, initial: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: initial, options });
const vector = (label: string, initial: readonly number[], minLength = 1, maxLength = 1024): ParameterDefinition => ({ kind: 'numeric-vector', label, default: [...initial], minLength, maxLength });
const common = { version: 1, inputs: ['in'], outputs: ['out'], parameters: {}, category: '계산', supportedModes: ['static', 'discrete', 'continuous'], directFeedthrough: true, valueType: 'inherited', shape: 'inherited', unit: 'inherited', sampleTime: 'inherited', state: 'none', exportTargets: ['typescript'] } as const;
const define = (id: M8BlockType, label: string, englishName: string, description: string, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...common, id, label, englishName, description, ...overrides });
const bounds = { inputs: ['in', 'lower', 'upper'] } as const;
const closed = { lowerClosed: choice('아래 경계 포함', 'closed', ['closed', 'open']), upperClosed: choice('위 경계 포함', 'closed', ['closed', 'open']) };
const interpolation = choice('보간', 'linear', ['linear', 'nearest', 'previous']);
const outside = choice('범위 밖', 'error', ['error', 'clamp', 'extrapolate']);
export const M8_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  define('nonlinear.friction', '마찰', 'Coulomb and Viscous Friction', 'sign(x)·(gain·abs(x)+offset). 영에서는 0이며 계수는 고정 scalar입니다.', { parameters: { gain: number('점성 계수', 1, 0), offset: number('쿨롱 마찰', 1, 0) } }),
  define('nonlinear.dead-zone-dynamic', '동적 불감대', 'Dead Zone Dynamic', '같은 단위의 lower·upper 입력으로 불감대를 정합니다. 경계는 scalar 또는 입력과 같은 형상입니다.', bounds),
  define('nonlinear.saturation-dynamic', '동적 포화', 'Saturation Dynamic', '같은 단위의 lower·upper 입력 사이로 신호를 제한합니다.', bounds),
  define('nonlinear.wrap-to-zero', '초과 값 영 처리', 'Wrap To Zero', 'threshold 초과(gt) 또는 이상(ge) 값을 0으로 바꿉니다. modulo가 아닙니다.', { parameters: { threshold: number('경계 값', 1), comparator: choice('영 처리 조건', 'gt', ['gt', 'ge']) } }),
  define('logic.compare-constant', '고정 값 비교', 'Compare To Constant', '입력을 같은 단위의 고정 constant와 원소별로 비교합니다.', { category: '논리', parameters: { operator: choice('비교 조건', 'gt', ['gt', 'gte', 'lt', 'lte', 'eq', 'neq']), constant: number('비교 값', 0) } }),
  define('logic.interval-dynamic', '동적 구간 검사', 'Interval Test Dynamic', '동적 경계와 열린·닫힌 구간 조건으로 원소별 boolean을 계산합니다.', { ...bounds, category: '논리', parameters: closed }),
  define('logic.truth-table', '진리표', 'Combinatorial Logic', '길이 1~8 boolean 벡터를 MSB 우선 정수로 읽어 2^width개의 boolean 표에서 값을 선택합니다.', { category: '논리', parameters: { table: { kind: 'value', label: 'boolean 진리표', default: [false, false, false, true] } } }),
  define('math.signed-sqrt', '부호 있는 제곱근', 'Signed Sqrt', 'sign(x)·sqrt(abs(x))를 계산합니다.'),
  define('math.reciprocal-sqrt', '역제곱근', 'Reciprocal Sqrt', '양수 입력에 1/sqrt(x)를 계산합니다. 영과 음수를 거부합니다.'),
  define('math.negate', '부호 반전', 'Unary Minus', '각 숫자 원소의 부호를 반전합니다.'),
  define('math.sine-wave-function', '입력 시간 사인', 'Sine Wave Function', '입력 t에 amplitude·sin(frequency·t+phase)+bias를 계산합니다. t는 단위 없는 숫자 또는 초(s)입니다.', { parameters: { amplitude: number('진폭', 1), frequency: number('각 주파수', 1), phase: number('위상 rad', 0), bias: number('기준 값', 0) } }),
  define('math.increment', '증가·감소', 'Increment / Decrement', '같은 단위의 delta를 원소별로 더하고 선택적으로 영 이상으로 제한합니다.', { parameters: { delta: number('변화량', 1), clamp: choice('영 제한', 'none', ['none', 'zero']) } }),
  define('matrix.assign', '원소 대입', 'Assignment', '행 우선 0-based 고정 indices에 같은 타입·단위의 scalar 또는 벡터 값을 대입하여 새 배열을 만듭니다. 중복 index는 허용하지 않습니다.', { category: '행렬', inputs: ['in', 'value'], parameters: { indices: vector('행 우선 index', [0]) } }),
  define('matrix.find-nonzero', '영이 아닌 원소 찾기', 'Find Nonzero (Padded)', 'CalcWeave 고정 폭 대체: column-major 순서로 찾은 위치와 count를 출력합니다. 원본의 가변 길이 출력과 다릅니다. 0-based 빈 칸은 -1, 1-based는 0입니다.', { category: '행렬', outputs: ['indices', 'rows', 'columns', 'count'], parameters: { indexBase: integer('index 기준', 0, 0, 1) } }),
  define('matrix.permute-dimensions', '축 순서 바꾸기', 'Permute Dimensions', '현재 1D·2D 축의 0-based 순열만 허용합니다. 벡터 [0], 행렬 [0,1] 또는 [1,0]입니다.', { category: '행렬', parameters: { order: vector('축 순열', [1, 0], 1, 2) } }),
  define('matrix.squeeze', '단일 축 정리', 'Squeeze', '원본 Squeeze의 현재 scalar·벡터·2D 계약은 입력 형상을 유지합니다. 3D 이상 신호는 현재 지원하지 않습니다.', { category: '행렬' }),
  define('matrix.expand-scalar', '고정 값 배열', 'Expand Scalar', '고정 ElementValue를 지정한 벡터 또는 행렬 크기로 채웁니다. 입력 포트 없는 배열 생성기입니다.', { category: '입력', inputs: [], directFeedthrough: false, sampleTime: 'constant', parameters: { value: number('원소 값', 1), form: choice('형상', 'vector', ['vector', 'matrix']), length: integer('벡터 길이', 3, 1, 1024), rows: integer('행 수', 2, 1, 32), columns: integer('열 수', 2, 1, 32) } }),
  define('matrix.is-symmetric', '대칭 검사', 'IsSymmetric', '정방 실수 행렬의 전치 대응 원소가 절대 tolerance 안에서 같은지 확인합니다.', { category: '행렬', parameters: { tolerance: number('절대 오차', 0, 0) } }),
  define('matrix.is-triangular', '삼각 행렬 검사', 'IsTriangular', '실수 행렬의 위·아래 또는 어느 한 삼각형 바깥 원소가 tolerance 이하인지 검사합니다.', { category: '행렬', parameters: { part: choice('검사 부분', 'upper', ['upper', 'lower', 'either']), tolerance: number('절대 오차', 0, 0) } }),
  define('matrix.square', '전치 곱', 'Matrix Square', '실수 행렬 A에 AᵀA를 계산합니다. 벡터는 column으로 보아 1×1 내적을 출력합니다.', { category: '행렬' }),
  define('matrix.permute-rows-cols', '행·열 순열', 'Permute Matrix', '0-based 행·열 index의 완전한 순열로 행렬을 재배치합니다.', { category: '행렬', parameters: { rows: vector('행 순열', [0, 1], 1, 32), columns: vector('열 순열', [0, 1], 1, 32) } }),
  define('route.manual-switch', '수동 선택', 'Manual Switch', '선택 파라미터 1 또는 2에 따라 같은 타입·형상·단위의 a 또는 b를 보냅니다.', { category: '신호 처리', inputs: ['a', 'b'], parameters: { selected: integer('선택 입력', 1, 1, 2) } }),
  define('route.multiport-switch', '여러 입력 선택', 'Multiport Switch', 'scalar 정수 index로 2~16개의 같은 타입·형상·단위 입력 중 하나를 선택합니다.', { category: '신호 처리', inputs: ['index', 'in1', 'in2'], parameters: { count: integer('입력 수', 2, 2, 16), indexBase: integer('index 기준', 0, 0, 1), outside: choice('범위 밖', 'error', ['error', 'clamp']) } }),
  define('verify.assert', '참 조건 검증', 'Assertion', 'boolean 입력의 모든 값 또는 한 값 이상이 참인지 검증합니다. 실패하면 실행을 진단과 함께 중단하고 성공하면 scalar true입니다.', { category: '검증', parameters: { mode: choice('검증 조건', 'all', ['all', 'any']) } }),
  define('verify.bounds', '범위 조건 검증', 'Bounds Check', '고정·동적 lower/upper의 범위·범위 밖·아래·위 조건을 검증합니다. 위반하면 실행을 중단하며 성공하면 입력 형상의 true입니다.', { category: '검증', parameters: { source: choice('경계 입력', 'static', ['static', 'dynamic']), kind: choice('검증 조건', 'range', ['range', 'gap', 'lower', 'upper']), lower: number('아래 경계', 0), upper: number('위 경계', 1), ...closed } }),
  define('lookup.direct', '정수 index 표 조회', 'Direct Lookup Table (n-D)', 'rank 1~10, 축 1~32의 행 우선 flat 표를 정수 query로 조회합니다. 마지막 축이 가장 빠릅니다.', { category: '조회 표', parameters: { dimensions: vector('표 크기', [2], 1, 10), table: vector('행 우선 표', [0, 1]), indexBase: integer('index 기준', 0, 0, 1), outside: choice('범위 밖', 'error', ['error', 'clamp']) } }),
  define('lookup.interpolate-prelookup', '사전 조회 보간', 'Interpolation Using Prelookup', '0-based 구간 index와 [0,1] fraction으로 표를 보간합니다.', { category: '조회 표', inputs: ['index', 'fraction'], parameters: { table: vector('표 값', [0, 1], 2), interpolation, outside: choice('범위 밖', 'error', ['error', 'clamp']) } }),
  define('lookup.dynamic', '동적 1D 조회 표', 'Lookup Table Dynamic', 'strictly increasing breakpoints와 같은 길이 표를 입력으로 받아 scalar query를 보간합니다.', { category: '조회 표', inputs: ['in', 'breakpoints', 'table'], parameters: { interpolation, outside } }),
  define('lookup.nd', '다차원 조회 표', 'n-D Lookup Table', 'rank 1~10의 고정 축과 행 우선 flat 표를 scalar 또는 query 벡터로 조회해 scalar를 출력합니다. 표와 보간 corner는 각각 1,024개 이하입니다.', { category: '조회 표', parameters: { rank: integer('표 rank', 2, 1, 10), ...Object.fromEntries(Array.from({ length: 10 }, (_, axis) => [`axis${axis + 1}`, vector(`${axis + 1}번 축`, [0, 1], 2, 32)])), table: vector('행 우선 표', [0, 1, 1, 2]), interpolation, outside } }),
  define('math.gain-matrix', '행렬 배율', 'Matrix Gain', '고정 단위 없는 K를 elementwise 또는 K·u / u·K 행렬 곱으로 적용합니다.', { parameters: { K: { kind: 'value', label: '배율 K', default: [[1, 0], [0, 1]] }, mode: choice('곱 방식', 'left', ['left', 'right', 'elementwise']) } }),
  define('math.sum-inputs', '여러 입력 합', 'N-Input Sum', '1~16개 입력을 scalar 확장하며 signs의 +1/-1로 더하거나 뺍니다.', { inputs: ['in1', 'in2'], parameters: { count: integer('입력 수', 2, 1, 16), signs: vector('입력 부호 ±1', [1, 1], 1, 16) } }),
  define('math.product-inputs', '여러 입력 곱', 'N-Input Product', '1~16개 입력에 operations의 * 또는 /를 적용합니다. 행렬 mode는 순서대로 행렬 곱(*)만 허용합니다.', { inputs: ['in1', 'in2'], parameters: { count: integer('입력 수', 2, 1, 16), operations: { kind: 'text', label: '입력 연산 */', default: '**', maxLength: 16 }, mode: choice('곱 방식', 'elementwise', ['elementwise', 'matrix']) } }),
  define('logic.combine', '여러 입력 논리', 'N-Input Logical Operator', 'boolean 또는 숫자의 nonzero 참 값을 scalar 확장하여 and/or/xor/nand/nor/xnor/not으로 계산합니다.', { category: '논리', inputs: ['in1', 'in2'], parameters: { count: integer('입력 수', 2, 1, 16), operation: choice('논리 연산', 'and', ['and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not']) } }),
  define('route.switch-threshold', '경계 값 선택', 'Threshold Switch', 'condition의 gt/ge/ne 경계 비교 또는 boolean에 따라 a/b를 원소별 선택합니다. scalar 확장을 허용합니다.', { category: '신호 처리', inputs: ['condition', 'a', 'b'], parameters: { criterion: choice('선택 조건', 'gt', ['gt', 'ge', 'ne']), threshold: number('경계 값', 0) } }),
  define('vector.select-dynamic', '동적 벡터 선택', 'Dynamic Selector (1D)', 'scalar 또는 벡터 정수 index 입력으로 같은 형상의 값을 선택합니다.', { category: '신호 처리', inputs: ['in', 'indices'], parameters: { indexBase: integer('index 기준', 0, 0, 1) } }),
  define('matrix.select-dynamic', '동적 행·열 선택', 'Dynamic Selector (2D)', 'scalar 또는 벡터 row/column index 입력의 Cartesian 구간을 2D로 출력합니다.', { category: '신호 처리', inputs: ['in', 'rows', 'columns'], parameters: { indexBase: integer('index 기준', 0, 0, 1) } }),
  define('route.mux-inputs', '여러 입력 묶기', 'N-Input Mux', '같은 타입·단위의 scalar 또는 벡터 입력 1~16개를 순서대로 벡터에 묶습니다.', { category: '신호 처리', inputs: ['in1', 'in2'], parameters: { count: integer('입력 수', 2, 1, 16) } }),
  define('route.demux-widths', '폭 지정 분리', 'Width-Aware Demux', '벡터를 widths의 양의 정수 폭으로 분리합니다. 폭 1은 scalar, 나머지는 벡터입니다.', { category: '신호 처리', outputs: ['out1', 'out2'], parameters: { widths: vector('출력 폭', [1, 1], 1, 16) } }),
  define('math.concatenate-inputs', '여러 배열 결합', 'N-Input Concatenate', '같은 타입·단위의 1~16개 벡터 또는 행렬을 지정한 0-based 축으로 결합합니다.', { category: '행렬', inputs: ['in1', 'in2'], parameters: { count: integer('입력 수', 2, 1, 16), axis: integer('결합 축', 0, 0, 1) } }),
  define('matrix.reshape-column-major', '열 우선 형상 변경', 'Column-Major Reshape', '입력을 column-major 순서로 읽고 같은 원소 수의 벡터·행렬을 column-major로 채웁니다.', { category: '행렬', parameters: { form: choice('형상', 'matrix', ['vector', 'matrix']), length: integer('벡터 길이', 4, 1, 1024), rows: integer('행 수', 2, 1, 32), columns: integer('열 수', 2, 1, 32) } }),
  define('reduce.axis', '축 집계', 'Axis Reduction', 'all은 전체 scalar, rows는 행을 집계한 열별 벡터, columns는 열을 집계한 행별 벡터입니다. bool all/any와 숫자 집계를 구분합니다.', { category: '통계', parameters: { operation: choice('집계', 'sum', ['sum', 'product', 'mean', 'min', 'max', 'all', 'any']), axis: choice('집계 축', 'all', ['all', 'rows', 'columns']) } }),
];

/** Presets reuse existing implementations and are never additional native block counts. */
export const M8_BLOCK_PRESETS = [
  { id: 'ground', blockType: 'source.constant', label: 'Ground', parameters: { value: 0 } },
  { id: 'eulers-number', blockType: 'source.constant', label: 'Euler’s Number', parameters: { value: Math.E } },
  { id: 'one', blockType: 'source.constant', label: 'One', parameters: { value: 1 } },
  { id: 'compare-zero', blockType: 'logic.compare-constant', label: 'Compare To Zero', parameters: { constant: 0 } },
  { id: 'increment', blockType: 'math.increment', label: 'Increment Real World', parameters: { delta: 1, clamp: 'none' } },
  { id: 'decrement', blockType: 'math.increment', label: 'Decrement Real World', parameters: { delta: -1, clamp: 'none' } },
  { id: 'decrement-to-zero', blockType: 'math.increment', label: 'Decrement To Zero', parameters: { delta: -1, clamp: 'zero' } },
  { id: 'square-root', blockType: 'math.sqrt', label: 'Square Root', parameters: {} },
] as const;

export function getM8Ports(node: Pick<CalcNode, 'blockType' | 'parameters'>): { inputs: string[]; outputs: string[] } | undefined {
  if (['math.sum-inputs', 'math.product-inputs', 'logic.combine', 'route.mux-inputs', 'math.concatenate-inputs'].includes(node.blockType)) {
    const count = Number.isSafeInteger(node.parameters.count) && (node.parameters.count as number) >= 1 && (node.parameters.count as number) <= 16 ? node.parameters.count as number : 2;
    return { inputs: Array.from({ length: count }, (_, index) => `in${index + 1}`), outputs: ['out'] };
  }
  if (node.blockType === 'route.demux-widths') {
    const value = node.parameters.widths;
    const count = Array.isArray(value) && value.length >= 1 && value.length <= 16 ? value.length : 2;
    return { inputs: ['in'], outputs: Array.from({ length: count }, (_, index) => `out${index + 1}`) };
  }
  if (node.blockType === 'route.multiport-switch') {
    const count = Number.isSafeInteger(node.parameters.count) && (node.parameters.count as number) >= 2 && (node.parameters.count as number) <= 16 ? node.parameters.count as number : 2;
    return { inputs: ['index', ...Array.from({ length: count }, (_, index) => `in${index + 1}`)], outputs: ['out'] };
  }
  if (node.blockType === 'verify.bounds' && node.parameters.source === 'dynamic') {
    const kind = node.parameters.kind;
    return { inputs: kind === 'lower' ? ['in', 'lower'] : kind === 'upper' ? ['in', 'upper'] : ['in', 'lower', 'upper'], outputs: ['out'] };
  }
  return undefined;
}
