import type { BlockType, CalcNode, TypedSignal } from '../../model/src/types';
import type { BlockDefinition, ParameterDefinition } from './index';

export const M10_BLOCK_IDS = [
  'source.typed', 'source.enum', 'signal.cast', 'signal.cast-inherited', 'signal.to-legacy',
  'signal.type-duplicate', 'signal.type-propagation', 'signal.scaling-strip', 'signal.representation',
  'signal.specification', 'signal.width', 'signal.bus-to-vector', 'signal.unit-system',
  'logic.bit-mask', 'logic.extract-bits', 'logic.float-extract-bits', 'logic.integer-to-bits',
  'logic.bits-to-integer', 'logic.shift-arithmetic', 'logic.bitwise-typed',
  'fixed.integer-increment', 'fixed.trigonometric', 'fixed.state-space',
  'complex.from-parts', 'complex.to-parts', 'complex.from-polar', 'complex.to-polar',
  'complex.hermitian', 'complex.is-hermitian', 'complex.dot', 'typed.math', 'tensor.reshape', 'tensor.permute', 'tensor.squeeze',
] as const;
export type M10BlockType = typeof M10_BLOCK_IDS[number];
const integer = (label: string, initial: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: initial, min, max });
const number = (label: string, initial: number, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): ParameterDefinition => ({ kind: 'number', label, default: initial, min, max });
const choice = (label: string, initial: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: initial, options });
const vector = (label: string, initial: number[], minLength = 0, maxLength = 8): ParameterDefinition => ({ kind: 'numeric-vector', label, default: initial, minLength, maxLength });
const typed = (label: string, initial: TypedSignal): ParameterDefinition => ({ kind: 'typed-value', label, default: initial });
const type = (label: string, initial: unknown): ParameterDefinition => ({ kind: 'data-type', label, default: initial });
const rounding = choice('반올림', 'nearest-even', ['nearest-even', 'floor', 'ceil', 'toward-zero', 'nearest', 'away']);
const overflow = choice('범위 초과', 'error', ['error', 'wrap', 'saturate']);
const cast = { rounding, overflow, mode: choice('변환 기준', 'real-world', ['real-world', 'stored-integer']), special: choice('특수값', 'error', ['error', 'preserve']) };
const common = { version: 1, inputs: ['in'], outputs: ['out'], parameters: {}, category: '자료형', supportedModes: ['static', 'discrete', 'continuous'], directFeedthrough: true, valueType: 'inherited', shape: 'inherited', unit: 'inherited', sampleTime: 'inherited', state: 'none', exportTargets: ['typescript'] } as const;
const define = (id: M10BlockType, label: string, englishName: string, description: string, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...common, id: id as BlockType, label, englishName, description, ...overrides });
const fixed = { signed: true, wordLength: 16, fractionLength: 8 };
const fixedValue = (shape: number[], data: string[]): TypedSignal => ({ kind: 'typed', dtype: 'fixed', fixed: { ...fixed }, shape, data });

export const M10_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  define('source.typed', '자료형 상수', 'Typed Constant', '자료형과 형상을 보존하는 JSON 신호입니다. 정수·고정소수점은 정확한 저장 코드, IEEE 특수값은 명시 태그로 저장합니다.', { category: '입력', inputs: [], directFeedthrough: false, sampleTime: 'constant', parameters: { value: typed('자료형 값', { kind: 'typed', dtype: 'int8', shape: [], data: ['1'] }) } }),
  define('source.enum', '열거 상수', 'Enumerated Constant', '선언한 이름과 label 목록의 열거 값만 출력합니다. 숫자나 문자열 신호와 자동 변환하지 않습니다.', { category: '입력', inputs: [], directFeedthrough: false, sampleTime: 'constant', parameters: { value: typed('열거 값', { kind: 'typed', dtype: 'enum', enum: { name: 'Mode', labels: ['Off', 'On'] }, shape: [], data: ['Off'] }) } }),
  define('signal.cast', '자료형 변환', 'Data Type Conversion', '명시한 자료형으로 변환합니다. propagated 설정은 Data Type Propagation의 유일한 역방향 constraint로 결정하며 모호한 경우 실행하지 않습니다.', { parameters: { source: choice('자료형 결정', 'explicit', ['explicit', 'propagated']), target: type('출력 자료형', { dtype: 'int8' }), ...cast } }),
  define('signal.cast-inherited', '참조 자료형 변환', 'Data Type Conversion Inherited', 'reference 입력의 자료형·스케일을 상속하여 in을 변환합니다. reference의 값과 형상은 변환 결과에 사용하지 않습니다.', { inputs: ['reference', 'in'], parameters: cast }),
  define('signal.to-legacy', '실수·논리 경계', 'To Legacy Signal', '유한한 float64 또는 boolean scalar·vector·2D로 명시 변환합니다. 정확히 표현할 수 없는 정수·일반 n-D·복소수·문자·열거는 거부합니다.'),
  define('signal.type-duplicate', '자료형 동일성', 'Data Type Duplicate', 'a와 b의 자료형·고정소수점 스케일·열거 선언 동일성을 컴파일 시 검사합니다. 값이나 형상을 변환하지 않습니다.', { inputs: ['a', 'b'], outputs: [] }),
  define('signal.type-propagation', '자료형 역전파', 'Data Type Propagation (Selected Rules)', 'ref1 자료형 또는 두 built-in 정수의 넓은 자료형을 직접 연결된 propagated cast로 역전파합니다. 다른 역전파 경로와 순환·충돌은 진단합니다.', { inputs: ['ref1', 'ref2', 'prop'], outputs: [], parameters: { rule: choice('역전파 규칙', 'reference-1', ['reference-1', 'widest-integer']) } }),
  define('signal.scaling-strip', '저장 정수 추출', 'Data Type Scaling Strip', '고정소수점 신호의 저장 정수를 담을 수 있는 가장 작은 built-in 정수로 출력합니다. 실세계 값 복원과 구분합니다.'),
  define('signal.representation', '신호 표현', 'Signal Conversion (CalcWeave)', 'copy는 값을 방어 복사합니다. virtual/nonvirtual은 기존 동종 scalar named-bus의 compiler 표현만 선언하며 MATLAB bus object는 지원하지 않습니다.', { parameters: { representation: choice('표현', 'copy', ['copy', 'virtual', 'nonvirtual']) } }),
  define('signal.specification', '신호 규격', 'Signal Specification', '선택한 자료형·고정 형상·유한 실수 범위를 검증합니다. 범위는 clipping 없이 위반을 진단하며 자료형·형상은 변환하지 않습니다.', { parameters: { checkType: choice('자료형 검사', 'yes', ['yes', 'no']), type: type('자료형', { dtype: 'float64' }), checkShape: choice('형상 검사', 'no', ['yes', 'no']), dimensions: vector('형상', []), range: choice('범위 검사', 'none', ['none', 'finite']), lower: number('최소', -Number.MAX_VALUE), upper: number('최대', Number.MAX_VALUE) } }),
  define('signal.width', '신호 폭', 'Width', '고정 신호의 전체 원소 수를 출력합니다. 복소수 원소 하나는 폭 하나로 계산합니다.', { valueType: 'float64', shape: 'scalar', unit: 'dimensionless' }),
  define('signal.bus-to-vector', '버스를 벡터로', 'Bus to Vector (Homogeneous)', '기존 동종 scalar named-bus를 필드 순서의 일반 벡터로 바꿉니다. 이종·중첩 bus는 지원하지 않습니다.'),
  define('signal.unit-system', '단위 허용 범위', 'Unit System Configuration (CalcWeave)', '프로젝트 전역에서 선언·추론하는 단위를 선택한 SI 허용 목록으로 제한합니다. MathWorks unit system 객체의 실행과 구분합니다.', { inputs: [], outputs: [], directFeedthrough: false, sampleTime: 'constant', parameters: { allowedUnits: { kind: 'text', label: '허용 단위 JSON 배열', default: '["1","m","s","kg","A","K","mol","cd","rad","V","Hz","N","Pa","J","W","m/s","m/s^2","m^2"]', maxLength: 512 } } }),
  define('logic.bit-mask', '비트 설정·해제', 'Bit Set / Clear', 'built-in 정수의 지정한 0-based 비트를 설정·해제합니다. 폭 밖 index와 암묵적인 float 변환은 거부합니다.', { category: '논리', parameters: { operation: choice('동작', 'set', ['set', 'clear']), bits: vector('비트 위치', [0], 1, 64) } }),
  define('logic.extract-bits', '비트 추출', 'Extract Bits', 'built-in 정수의 포함된 low..high 비트를 추출하여 담을 수 있는 최소 unsigned 정수로 출력합니다.', { category: '논리', parameters: { low: integer('하위 비트', 0, 0, 63), high: integer('상위 비트', 7, 0, 63) } }),
  define('logic.float-extract-bits', 'IEEE 비트 추출', 'Float Extract Bits', 'float32/float64의 raw IEEE 비트 또는 sign·exponent·fraction을 unsigned 정수로 출력합니다. endianness와 독립적인 수치 비트열입니다.', { category: '논리', parameters: { part: choice('비트 부분', 'all', ['all', 'sign', 'exponent', 'fraction']) } }),
  define('logic.integer-to-bits', '정수를 비트로', 'Integer to Bit Converter', 'typed 정수 scalar의 요청 폭을 검증하여 MSB/LSB 우선 boolean 벡터로 출력합니다.', { category: '논리', parameters: { width: integer('폭', 8, 1, 64), order: choice('비트 순서', 'msb-first', ['msb-first', 'lsb-first']) } }),
  define('logic.bits-to-integer', '비트를 정수로', 'Bit to Integer Converter', '1~64개 boolean 벡터를 지정한 built-in 정수로 묶습니다. signed two’s complement와 MSB/LSB 순서를 명시합니다.', { category: '논리', parameters: { target: type('정수 자료형', { dtype: 'uint8' }), order: choice('비트 순서', 'msb-first', ['msb-first', 'lsb-first']) } }),
  define('logic.shift-arithmetic', '산술 시프트', 'Shift Arithmetic', 'bit 모드의 양수 shift는 오른쪽, 음수는 왼쪽입니다. binary-point는 저장 코드를 유지하며 FL−shift로 scale을 바꾸므로 양수에서 실세계 값은 커집니다.', { category: '논리', parameters: { shift: integer('시프트', 1, -63, 63), mode: choice('방식', 'bits', ['bits', 'binary-point']), overflow } }),
  define('logic.bitwise-typed', '자료형 비트 연산', 'Typed Bitwise Operator', '같은 built-in 정수 자료형에 and/or/xor/not를 적용합니다. 정수 폭과 부호를 보존합니다.', { category: '논리', inputs: ['a', 'b'], parameters: { operation: choice('동작', 'and', ['and', 'or', 'xor', 'not']) } }),
  define('fixed.integer-increment', '저장 코드 증가·감소', 'Increment / Decrement Stored Integer', 'fixed 신호의 실세계 값이 아닌 저장 코드에 delta를 더합니다. 지정 폭의 overflow 정책을 적용합니다.', { category: '정밀도', parameters: { delta: integer('저장 코드 변화', 1, -1, 1), overflow } }),
  define('fixed.trigonometric', '고정소수점 사인·코사인', 'Fixed Quarter-Wave Lookup (Alternative)', '독립 quarter-wave LUT로 sin(2πu)·cos(2πu)를 계산합니다. 원본 Speed/Precision bit parity는 미승인이며 output은 signed WL/FL=WL−2입니다.', { category: '정밀도', parameters: { operation: choice('동작', 'sin', ['sin', 'cos']), wordLength: integer('출력 비트 폭', 16, 2, 53), points: integer('quarter-wave 점 수', 17, 2, 1024), interpolation: choice('보간', 'linear', ['linear']), rounding, overflow } }),
  define('fixed.state-space', '고정소수점 상태 공간', 'Fixed-Point State-Space (Selected)', '같은 binary-point fixed 자료형의 1~8축 MIMO 이산 상태입니다. 각 product와 누적 add에 지정 rounding·overflow를 적용하며 due는 read-before-write입니다.', { category: '이산 상태', supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { A: typed('A 행렬', fixedValue([1, 1], ['128'])), B: typed('B 행렬', fixedValue([1, 1], ['256'])), C: typed('C 행렬', fixedValue([1, 1], ['256'])), D: typed('D 행렬', fixedValue([1, 1], ['0'])), initial: typed('초기 상태', fixedValue([1], ['0'])), rounding, overflow } }),
  define('complex.from-parts', '실수·허수 결합', 'Real-Imag to Complex', '같은 형상·단위의 실수 real·imag를 complex128 신호로 만듭니다. scalar만 명시 broadcast합니다.', { category: '복소수', inputs: ['real', 'imag'] }),
  define('complex.to-parts', '실수·허수 분리', 'Complex to Real-Imag', 'complex128 신호의 real·imag를 typed float64로 분리합니다.', { category: '복소수', outputs: ['real', 'imag'] }),
  define('complex.from-polar', '크기·위상 결합', 'Magnitude-Angle to Complex', '유한한 음수가 아닌 magnitude와 radian angle로 complex128을 만듭니다. angle은 단위 1 또는 rad입니다.', { category: '복소수', inputs: ['magnitude', 'angle'] }),
  define('complex.to-polar', '크기·위상 분리', 'Complex to Magnitude-Angle', 'complex128의 hypot 크기와 atan2 위상을 typed float64로 출력합니다. 위상은 rad이며 branch cut과 signed zero를 보존합니다.', { category: '복소수', outputs: ['magnitude', 'angle'] }),
  define('complex.hermitian', '켤레 전치', 'Hermitian Transpose', '2D complex128의 켤레 전치를 계산합니다. 각 축 1~32, 실수 전치와 구분합니다.', { category: '복소수' }),
  define('complex.is-hermitian', '에르미트 검사', 'IsHermitian', 'complex128 정방 행렬의 conjugate symmetry와 실수 diagonal을 절대 tolerance로 검사합니다.', { category: '복소수', parameters: { tolerance: number('절대 오차', 0, 0) } }),
  define('complex.dot', '복소수 내적', 'Complex Dot Product', '동일 길이 complex128 벡터의 내적입니다. 기본값은 첫 입력에 켤레를 적용하고 scalar를 출력합니다.', { category: '복소수', inputs: ['a', 'b'], parameters: { conjugateFirst: choice('첫 입력 켤레', 'yes', ['yes', 'no']) } }),
  define('typed.math', '자료형 산술', 'Typed Arithmetic', '같은 자료형·스케일의 add/subtract/multiply/divide를 계산합니다. scalar만 broadcast하고 각 출력 dtype의 rounding·overflow를 적용합니다.', { category: '계산', inputs: ['a', 'b'], parameters: { operation: choice('동작', 'add', ['add', 'subtract', 'multiply', 'divide']), rounding, overflow, special: choice('특수값', 'error', ['error', 'preserve']) } }),
  define('tensor.reshape', 'n-D 형상 변경', 'Tensor Reshape', 'row-major 원소 순서를 보존하고 동일 원소 수의 rank0~8 형상으로 바꿉니다. 축과 전체 원소는 1~1,024입니다.', { category: '행렬', parameters: { dimensions: vector('형상', [2, 2]) } }),
  define('tensor.permute', 'n-D 축 순열', 'Tensor Permute Dimensions', '0-based 모든 축의 완전 순열로 실제 row-major data를 재배치합니다. dtype와 스케일을 보존합니다.', { category: '행렬', parameters: { order: vector('축 순열', [1, 0], 0, 8) } }),
  define('tensor.squeeze', 'n-D 단일 축 제거', 'Tensor Squeeze (CalcWeave)', '크기1인 축을 제거합니다. 모든 축이1이면 scalar입니다. MATLAB 최소 2D 규칙과 구분합니다.', { category: '행렬' }),
];

export const M10_BLOCK_PRESETS = [
  { id: 'm10-positive-infinity', label: '양의 무한대', englishName: 'Inf', blockType: 'source.typed', parameters: { value: { kind: 'typed', dtype: 'float64', shape: [], data: ['Infinity'] } }, sourceIds: ['21-002'] },
  { id: 'm10-nan', label: '정의되지 않은 수', englishName: 'NaN', blockType: 'source.typed', parameters: { value: { kind: 'typed', dtype: 'float64', shape: [], data: ['NaN'] } }, sourceIds: ['21-003'] },
  { id: 'm10-negative-infinity', label: '음의 무한대', englishName: 'Negative Inf', blockType: 'source.typed', parameters: { value: { kind: 'typed', dtype: 'float64', shape: [], data: ['-Infinity'] } }, sourceIds: ['21-004'] },
  { id: 'm10-bit-clear', label: '비트 해제', englishName: 'Bit Clear', blockType: 'logic.bit-mask', parameters: { operation: 'clear' }, sourceIds: ['06-001'] },
  { id: 'm10-bit-set', label: '비트 설정', englishName: 'Bit Set', blockType: 'logic.bit-mask', parameters: { operation: 'set' }, sourceIds: ['06-002'] },
  { id: 'm10-code-decrement', label: '저장 코드 감소', englishName: 'Decrement Stored Integer', blockType: 'fixed.integer-increment', parameters: { delta: -1, overflow: 'wrap' }, sourceIds: ['20-005'] },
  { id: 'm10-code-increment', label: '저장 코드 증가', englishName: 'Increment Stored Integer', blockType: 'fixed.integer-increment', parameters: { delta: 1, overflow: 'wrap' }, sourceIds: ['20-009'] },
  { id: 'm10-signal-copy', label: '신호 복사', englishName: 'Signal Copy', blockType: 'signal.representation', parameters: { representation: 'copy' }, sourceIds: ['21-011'] },
  { id: 'm10-virtual-bus', label: '가상 버스 표현', englishName: 'To Virtual Bus', blockType: 'signal.representation', parameters: { representation: 'virtual' }, sourceIds: ['21-012'] },
  { id: 'm10-nonvirtual-bus', label: '비가상 버스 표현', englishName: 'To Nonvirtual Bus', blockType: 'signal.representation', parameters: { representation: 'nonvirtual' }, sourceIds: ['21-013'] },
] as const;

export function getM10Ports(node: Pick<CalcNode, 'blockType' | 'parameters'>): { inputs: string[]; outputs: string[] } | undefined {
  if (node.blockType === 'logic.bitwise-typed' && node.parameters.operation === 'not') return { inputs: ['a'], outputs: ['out'] };
  return undefined;
}
export function getM10DirectFeedthroughPorts(node: Pick<CalcNode, 'blockType' | 'parameters'>): string[] | undefined {
  if (node.blockType !== 'fixed.state-space') return undefined;
  const d = node.parameters.D as TypedSignal | undefined;
  return d?.kind === 'typed' && Array.isArray(d.data) && d.data.every(value => value === '0') ? [] : ['in'];
}
