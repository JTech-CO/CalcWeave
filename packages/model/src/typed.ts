import { ModelError, type LegacySignalValue, type SignalDescriptor, type TypedCell, type TypedComplex, type TypedDataType, type TypedDType, type TypedFloat, type TypedOverflow, type TypedRounding, type TypedSignal } from './types';

export const TYPED_LIMITS = Object.freeze({ maxRank: 8, maxAxis: 1_024, maxElements: 1_024, maxStringLength: 256, maxEnumLabels: 64, maxEnumLabelLength: 64, maxEnumNameLength: 64, maxIntegerDigits: 20 });
const TYPED_DTYPES: readonly TypedDType[] = ['float64', 'float32', 'boolean', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'complex128', 'fixed', 'string', 'enum'];
const TYPED_INTEGER_TYPES = Object.freeze({ int8: [8, true], uint8: [8, false], int16: [16, true], uint16: [16, false], int32: [32, true], uint32: [32, false], int64: [64, true], uint64: [64, false] } as const);
const TYPED_SPECIAL = new Set(['-0', 'NaN', 'Infinity', '-Infinity']);
function typedInvalid(message: string, code = 'INVALID_TYPED_SIGNAL'): never { throw new ModelError([{ code, message }]); }

/** Read own enumerable data properties only; never execute imported getters or hooks. */
function typedObject(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) typedInvalid('자료형 값은 일반 JSON 객체여야 합니다.');
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key)) || required.some(key => !Object.hasOwn(descriptors, key))) typedInvalid('자료형 객체에 누락되거나 승인하지 않은 필드가 있습니다.');
  return Object.fromEntries(keys.map(key => { const item = descriptors[key as string]!; if (!('value' in item) || !item.enumerable) typedInvalid('자료형 객체에 접근자나 숨김 속성을 사용할 수 없습니다.'); return [key, item.value]; }));
}
function typedArray(input: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < min || input.length > max) typedInvalid('자료형 배열 길이가 허용 범위를 벗어났습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) typedInvalid('자료형 배열에는 빈 칸이나 추가 속성을 사용할 수 없습니다.');
  return Array.from({ length: input.length }, (_, index) => { const item = descriptors[String(index)]; if (!item || !('value' in item) || !item.enumerable) typedInvalid('자료형 배열에 접근자나 빈 칸이 있습니다.'); return item.value as unknown; });
}
function typedInteger(input: unknown, min: number, max: number): number { if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) typedInvalid('자료형 크기 또는 차원은 허용 범위의 정수여야 합니다.'); return input; }
export function validateTypedShape(input: unknown): number[] {
  const shape = typedArray(input, 0, TYPED_LIMITS.maxRank).map(value => typedInteger(value, 1, TYPED_LIMITS.maxAxis));
  if (shape.reduce((count, axis) => count * axis, 1) > TYPED_LIMITS.maxElements) typedInvalid('한 자료형 신호는 1,024개 원소 이하여야 합니다.', 'TYPED_RESOURCE_LIMIT');
  return shape;
}

export function validateDataType(input: unknown): TypedDataType {
  const value = typedObject(input, ['dtype'], ['fixed', 'enum']);
  if (typeof value.dtype !== 'string' || !TYPED_DTYPES.includes(value.dtype as TypedDType)) typedInvalid('알 수 없는 자료형입니다.', 'UNKNOWN_DTYPE');
  const dtype = value.dtype as TypedDType;
  if (dtype === 'fixed') {
    if (Object.hasOwn(value, 'enum')) typedInvalid('고정소수점에 enum 설정을 사용할 수 없습니다.');
    const fixed = typedObject(value.fixed, ['signed', 'wordLength', 'fractionLength']);
    if (typeof fixed.signed !== 'boolean') typedInvalid('고정소수점 signed는 boolean이어야 합니다.');
    return { dtype, fixed: { signed: fixed.signed, wordLength: typedInteger(fixed.wordLength, 1, 64), fractionLength: typedInteger(fixed.fractionLength, -64, 64) } };
  }
  if (dtype === 'enum') {
    if (Object.hasOwn(value, 'fixed')) typedInvalid('enum에 고정소수점 설정을 사용할 수 없습니다.');
    const enumeration = typedObject(value.enum, ['name', 'labels']);
    if (typeof enumeration.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(enumeration.name)) typedInvalid('enum 이름은 영문자로 시작하는 안전한 64자 이하 이름이어야 합니다.');
    const labels = typedArray(enumeration.labels, 1, TYPED_LIMITS.maxEnumLabels).map(label => { if (typeof label !== 'string' || !label.length || label.length > TYPED_LIMITS.maxEnumLabelLength) typedInvalid('enum label은 1~64자 문자열이어야 합니다.'); return label; });
    if (new Set(labels).size !== labels.length) typedInvalid('enum label은 중복될 수 없습니다.');
    return { dtype, enum: { name: enumeration.name, labels } };
  }
  if (Object.hasOwn(value, 'fixed') || Object.hasOwn(value, 'enum')) typedInvalid('해당 자료형에 fixed 또는 enum 설정을 사용할 수 없습니다.');
  return { dtype };
}
export function equalDataType(left: TypedDataType, right: TypedDataType): boolean { return JSON.stringify(validateDataType(left)) === JSON.stringify(validateDataType(right)); }
export function typedDataType(descriptor: SignalDescriptor): TypedDataType { return descriptor.valueType === 'typed' ? validateDataType(descriptor.typed) : { dtype: descriptor.valueType }; }
export function isIntegerDataType(type: TypedDataType): boolean { return Object.hasOwn(TYPED_INTEGER_TYPES, type.dtype); }
export function typedIntegerSpec(type: TypedDataType): { wordLength: number; signed: boolean } {
  const checked = validateDataType(type);
  if (checked.dtype === 'fixed') return { wordLength: checked.fixed!.wordLength, signed: checked.fixed!.signed };
  if (!Object.hasOwn(TYPED_INTEGER_TYPES, checked.dtype)) typedInvalid('정수 또는 고정소수점 자료형이 필요합니다.', 'TYPED_TYPE_MISMATCH');
  const [wordLength, signed] = TYPED_INTEGER_TYPES[checked.dtype as keyof typeof TYPED_INTEGER_TYPES]; return { wordLength, signed };
}
function typedIntegerBounds(type: TypedDataType): { minimum: bigint; maximum: bigint; modulus: bigint } {
  const spec = typedIntegerSpec(type), modulus = 1n << BigInt(spec.wordLength), half = modulus >> 1n;
  return { minimum: spec.signed ? -half : 0n, maximum: spec.signed ? half - 1n : modulus - 1n, modulus };
}
function typedCode(input: unknown, type: TypedDataType): string {
  if (typeof input !== 'string' || input.length > TYPED_LIMITS.maxIntegerDigits + 1 || !/^-?(0|[1-9][0-9]*)$/.test(input) || input === '-0') typedInvalid('정수 코드는 선행 0이 없는 정확한 십진 문자열이어야 합니다.');
  const value = BigInt(input), bounds = typedIntegerBounds(type);
  if (value < bounds.minimum || value > bounds.maximum) typedInvalid('저장 정수 코드가 선언한 자료형 범위를 벗어났습니다.', 'TYPED_OVERFLOW');
  return input;
}
function typedFloat(input: unknown, single = false): TypedFloat {
  if (typeof input === 'string' && TYPED_SPECIAL.has(input)) return input as TypedFloat;
  if (typeof input !== 'number' || !Number.isFinite(input) || Object.is(input, -0)) typedInvalid('IEEE 값은 유한한 JSON 숫자 또는 -0/NaN/Infinity/-Infinity 태그여야 합니다.');
  if (single && !Object.is(Math.fround(input), input)) typedInvalid('float32 데이터는 실제 binary32 반올림 값이어야 합니다. 명시 변환을 사용하세요.', 'TYPED_FLOAT32_REPRESENTATION');
  return input;
}
export function encodeTypedFloat(value: number): TypedFloat { return Number.isNaN(value) ? 'NaN' : value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : Object.is(value, -0) ? '-0' : value; }
export function decodeTypedFloat(value: TypedFloat): number { return typeof value === 'number' ? value : value === '-0' ? -0 : value === 'NaN' ? NaN : value === 'Infinity' ? Infinity : -Infinity; }
export function validateTypedSignal(input: unknown): TypedSignal {
  const value = typedObject(input, ['kind', 'dtype', 'shape', 'data'], ['fixed', 'enum']);
  if (value.kind !== 'typed') typedInvalid('typed 신호 태그를 확인하세요.');
  const type = validateDataType({ dtype: value.dtype, ...(Object.hasOwn(value, 'fixed') ? { fixed: value.fixed } : {}), ...(Object.hasOwn(value, 'enum') ? { enum: value.enum } : {}) });
  const shape = validateTypedShape(value.shape), count = shape.reduce((product, axis) => product * axis, 1);
  const data = typedArray(value.data, count, count).map((item): TypedCell => {
    if (type.dtype === 'float64' || type.dtype === 'float32') return typedFloat(item, type.dtype === 'float32');
    if (type.dtype === 'complex128') { const pair = typedObject(item, ['re', 'im']); return { re: typedFloat(pair.re), im: typedFloat(pair.im) }; }
    if (type.dtype === 'fixed' || isIntegerDataType(type)) return typedCode(item, type);
    if (type.dtype === 'boolean') { if (typeof item !== 'boolean') typedInvalid('boolean 데이터에는 true 또는 false만 사용할 수 있습니다.'); return item; }
    if (typeof item !== 'string' || item.length > TYPED_LIMITS.maxStringLength) typedInvalid('문자열 신호 원소는 256자 이하여야 합니다.');
    if (type.dtype === 'enum' && !type.enum!.labels.includes(item)) typedInvalid('등록되지 않은 enum label입니다.', 'TYPED_ENUM_VALUE');
    return item;
  });
  return { kind: 'typed', ...type, shape, data };
}
export function cloneTypedSignal(value: TypedSignal): TypedSignal { return validateTypedSignal(value); }
export function typedDescriptor(value: TypedSignal, unit = '1'): SignalDescriptor { const checked = validateTypedSignal(value); return { valueType: 'typed', shape: [...checked.shape], unit, typed: validateDataType({ dtype: checked.dtype, ...(checked.fixed ? { fixed: checked.fixed } : {}), ...(checked.enum ? { enum: checked.enum } : {}) }) }; }
/** Conservative storage units include both complex components and bounded text/code payloads. */
function typedUtf8Length(value: string): number {
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    count += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return count;
}
export function typedStorageElements(value: TypedSignal | SignalDescriptor): number {
  const descriptor = 'kind' in value ? typedDescriptor(value) : value, type = typedDataType(descriptor), count = descriptor.shape.reduce((product, axis) => product * axis, 1);
  const metadata = type.dtype === 'enum' ? 16 + typedUtf8Length(type.enum!.name) + type.enum!.labels.reduce((sum, label) => sum + typedUtf8Length(label) + 2, 0) : type.dtype === 'fixed' ? 16 : 0;
  const weight = type.dtype === 'complex128' ? 2 : type.dtype === 'string' ? TYPED_LIMITS.maxStringLength * 4 : type.dtype === 'enum' ? TYPED_LIMITS.maxEnumLabelLength * 4 : type.dtype === 'fixed' || isIntegerDataType(type) ? TYPED_LIMITS.maxIntegerDigits + 1 : 1;
  return count * weight + metadata;
}

export interface TypedCastOptions { rounding?: TypedRounding; overflow?: TypedOverflow; mode?: 'real-world' | 'stored-integer'; special?: 'preserve' | 'error' }
function typedCastOptions(input: TypedCastOptions): Required<TypedCastOptions> {
  let value: Record<string, unknown>;
  try { value = typedObject(input, [], ['rounding', 'overflow', 'mode', 'special']); }
  catch { typedInvalid('자료형 변환 옵션은 승인한 필드의 일반 객체여야 합니다.', 'INVALID_TYPED_OPTIONS'); }
  const rounding = value.rounding ?? 'even', overflow = value.overflow ?? 'error', mode = value.mode ?? 'real-world', special = value.special ?? 'preserve';
  if (!['floor', 'ceil', 'zero', 'nearest', 'away', 'even'].includes(rounding as string) || !['wrap', 'saturate', 'error'].includes(overflow as string) || !['real-world', 'stored-integer'].includes(mode as string) || !['preserve', 'error'].includes(special as string)) typedInvalid('자료형 변환의 rounding/overflow/mode/special 옵션을 확인하세요.', 'INVALID_TYPED_OPTIONS');
  return { rounding: rounding as TypedRounding, overflow: overflow as TypedOverflow, mode: mode as 'real-world' | 'stored-integer', special: special as 'preserve' | 'error' };
}
interface TypedRational { n: bigint; d: bigint }
function typedExactNumber(value: number): TypedRational {
  if (!Number.isFinite(value)) typedInvalid('정수 변환에는 유한한 입력이 필요합니다.', 'TYPED_NONFINITE_CAST');
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value, false); const bits = view.getBigUint64(0, false);
  const fraction = bits & ((1n << 52n) - 1n), exp = Number((bits >> 52n) & 0x7ffn), magnitude = exp ? (1n << 52n) | fraction : fraction;
  const exponent = exp ? exp - 1075 : -1074, n = (bits >> 63n) ? -magnitude : magnitude;
  return exponent >= 0 ? { n: n << BigInt(exponent), d: 1n } : { n, d: 1n << BigInt(-exponent) };
}
function typedScale(value: TypedRational, exponent: number): TypedRational { return exponent >= 0 ? { n: value.n << BigInt(exponent), d: value.d } : { n: value.n, d: value.d << BigInt(-exponent) }; }
function typedRationalCell(cell: TypedCell, type: TypedDataType, stored = false): TypedRational {
  if (type.dtype === 'fixed' || isIntegerDataType(type)) { const value = { n: BigInt(cell as string), d: 1n }; return type.dtype === 'fixed' && !stored ? typedScale(value, -type.fixed!.fractionLength) : value; }
  if (type.dtype === 'boolean') return { n: cell ? 1n : 0n, d: 1n };
  if (type.dtype === 'float64' || type.dtype === 'float32') return typedExactNumber(decodeTypedFloat(cell as TypedFloat));
  typedInvalid('문자열·enum·복소수는 숫자로 조용히 변환할 수 없습니다.', 'TYPED_TYPE_MISMATCH');
}
function typedRoundRational(value: TypedRational, rounding: TypedRounding): bigint {
  if (value.d <= 0n) typedInvalid('정확한 비율의 분모가 잘못되었습니다.');
  let result = value.n / value.d; const remainder = value.n % value.d;
  if (!remainder) return result;
  if (rounding === 'floor' && remainder < 0n) return result - 1n;
  if (rounding === 'ceil' && remainder > 0n) return result + 1n;
  const absolute = remainder < 0n ? -remainder : remainder, twice = absolute * 2n, direction = remainder < 0n ? -1n : 1n;
  if (twice > value.d || twice === value.d && (rounding === 'away' || rounding === 'nearest' && remainder > 0n || rounding === 'even' && result % 2n !== 0n)) { if (rounding === 'nearest' || rounding === 'away' || rounding === 'even') result += direction; }
  return result;
}
export function boundTypedInteger(value: bigint, type: TypedDataType, overflow: TypedOverflow = 'error'): string {
  if (typeof value !== 'bigint' || value <= -(1n << 1_200n) || value >= 1n << 1_200n) typedInvalid('정확한 정수 중간값이 계산 상한을 벗어났습니다.', 'TYPED_RESOURCE_LIMIT');
  if (overflow !== 'wrap' && overflow !== 'saturate' && overflow !== 'error') typedInvalid('정수 overflow 옵션을 확인하세요.', 'INVALID_TYPED_OPTIONS');
  const bounds = typedIntegerBounds(type);
  if (value < bounds.minimum || value > bounds.maximum) {
    if (overflow === 'error') typedInvalid('자료형 연산 결과가 저장 정수 범위를 벗어났습니다.', 'TYPED_OVERFLOW');
    if (overflow === 'saturate') value = value < bounds.minimum ? bounds.minimum : bounds.maximum;
    else { value = ((value % bounds.modulus) + bounds.modulus) % bounds.modulus; if (bounds.minimum < 0n && value > bounds.maximum) value -= bounds.modulus; }
  }
  return value.toString();
}
function typedNumericCell(cell: TypedCell, type: TypedDataType, stored = false): number {
  if (type.dtype === 'float32' || type.dtype === 'float64') return decodeTypedFloat(cell as TypedFloat);
  if (type.dtype === 'boolean') return cell ? 1 : 0;
  const value = typedRationalCell(cell, type, stored); return Number(value.n) / Number(value.d);
}
function typedTypeOf(value: TypedSignal): TypedDataType { return validateDataType({ dtype: value.dtype, ...(value.fixed ? { fixed: value.fixed } : {}), ...(value.enum ? { enum: value.enum } : {}) }); }
function typedCastCell(cell: TypedCell, source: TypedDataType, target: TypedDataType, options: Required<TypedCastOptions>): TypedCell {
  if (target.dtype === 'string' || target.dtype === 'enum' || source.dtype === 'string' || source.dtype === 'enum') {
    if (!equalDataType(source, target)) typedInvalid('문자열과 enum 변환은 동일 자료형 보관만 지원합니다.', 'TYPED_UNSUPPORTED_CAST'); return cell;
  }
  if (target.dtype === 'complex128') {
    const pair = source.dtype === 'complex128' ? cell as TypedComplex : { re: encodeTypedFloat(typedNumericCell(cell, source, options.mode === 'stored-integer')), im: 0 };
    if (options.special === 'error' && (!Number.isFinite(decodeTypedFloat(pair.re)) || !Number.isFinite(decodeTypedFloat(pair.im)))) typedInvalid('특수 IEEE 값은 현재 변환 정책에서 허용하지 않습니다.', 'TYPED_NONFINITE_CAST');
    return { re: pair.re, im: pair.im };
  }
  if (source.dtype === 'complex128') typedInvalid('복소수를 실수로 변환하려면 실수·허수 분리 블럭을 사용하세요.', 'TYPED_UNSUPPORTED_CAST');
  if (target.dtype === 'float64' || target.dtype === 'float32') {
    let value = typedNumericCell(cell, source, options.mode === 'stored-integer'); if (target.dtype === 'float32') value = Math.fround(value);
    if (options.special === 'error' && !Number.isFinite(value)) typedInvalid('특수 IEEE 값은 현재 변환 정책에서 허용하지 않습니다.', 'TYPED_NONFINITE_CAST'); return encodeTypedFloat(value);
  }
  if (target.dtype === 'boolean') { const value = typedNumericCell(cell, source, options.mode === 'stored-integer'); if (!Number.isFinite(value)) typedInvalid('특수 IEEE 값은 boolean으로 변환할 수 없습니다.', 'TYPED_NONFINITE_CAST'); return value !== 0; }
  let value = typedRationalCell(cell, source, options.mode === 'stored-integer'); if (target.dtype === 'fixed' && options.mode === 'real-world') value = typedScale(value, target.fixed!.fractionLength);
  return boundTypedInteger(typedRoundRational(value, options.rounding), target, options.overflow);
}
/** Real-world conversion uses exact rational rounding; stored-integer mode never reinterprets IEEE bits. */
export function typedCast(input: TypedSignal, targetType: TypedDataType, inputOptions: TypedCastOptions = {}): TypedSignal {
  const value = validateTypedSignal(input), source = typedTypeOf(value), target = validateDataType(targetType), options = typedCastOptions(inputOptions);
  return validateTypedSignal({ kind: 'typed', ...target, shape: value.shape, data: value.data.map(cell => typedCastCell(cell, source, target, options)) });
}
export function fromLegacyTypedSignal(input: LegacySignalValue): TypedSignal {
  let dtype: 'float64' | 'boolean' | undefined; const data: TypedCell[] = [];
  const cell = (value: unknown): void => { const kind = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' && Number.isFinite(value) ? 'float64' : undefined; if (!kind || dtype && kind !== dtype) typedInvalid('기존 신호는 동종 유한 숫자 또는 boolean이어야 합니다.'); dtype = kind; data.push(kind === 'float64' ? encodeTypedFloat(value as number) : value as boolean); };
  let shape: number[] = [];
  if (Array.isArray(input)) { const values = typedArray(input, 1, 1_024); if (Array.isArray(values[0])) { let width = 0; for (const row of values) { const items = typedArray(row, 1, 1_024); if (width && items.length !== width) typedInvalid('기존 행렬의 모든 행 길이가 같아야 합니다.'); width = items.length; for (const item of items) cell(item); } shape = [values.length, width]; } else { shape = [values.length]; for (const item of values) cell(item); } } else cell(input);
  return validateTypedSignal({ kind: 'typed', dtype: dtype!, shape, data });
}
/** This explicit boundary emits finite legacy real/boolean scalar, vector, or matrix values. */
export function toLegacyTypedSignal(input: TypedSignal): LegacySignalValue {
  const checked = validateTypedSignal(input); if (checked.shape.length > 2 || checked.dtype === 'complex128' || checked.dtype === 'string' || checked.dtype === 'enum') typedInvalid('기존 블럭 경계는 유한 실수·boolean과 최대 2D 형상만 지원합니다.', 'TYPED_LEGACY_BOUNDARY');
  const value = checked.dtype === 'boolean' ? checked : typedCast(checked, { dtype: 'float64' }, { special: 'error' });
  const data = value.data.map(cell => value.dtype === 'boolean' ? cell as boolean : decodeTypedFloat(cell as TypedFloat));
  if (checked.dtype === 'fixed' || isIntegerDataType(checked)) {
    const type = typedTypeOf(checked);
    for (let index = 0; index < data.length; index++) { const exact = typedRationalCell(checked.data[index]!, type), represented = typedExactNumber(data[index] as number); if (exact.n * represented.d !== represented.n * exact.d) typedInvalid('저장 정수·고정소수점 값을 float64로 정확히 표현할 수 없습니다. 명시 자료형 변환으로 손실 정책을 먼저 선택하세요.', 'TYPED_LEGACY_PRECISION_LOSS'); }
  }
  if (!value.shape.length) return data[0]!;
  if (value.shape.length === 1) return data as number[] | boolean[];
  return Array.from({ length: value.shape[0]! }, (_, row) => data.slice(row * value.shape[1]!, (row + 1) * value.shape[1]!)) as number[][] | boolean[][];
}
/** Scaling Strip returns stored codes using the smallest supported builtin width, preserving signedness. */
export function stripTypedSignal(input: TypedSignal): TypedSignal {
  const value = validateTypedSignal(input); if (value.dtype !== 'fixed') return value;
  const width = [8, 16, 32, 64].find(size => size >= value.fixed!.wordLength)!;
  return typedCast(value, { dtype: `${value.fixed!.signed ? 'int' : 'uint'}${width}` as TypedDType }, { mode: 'stored-integer' });
}

export function reshapeTypedSignal(input: TypedSignal, shapeInput: number[]): TypedSignal { const value = validateTypedSignal(input), shape = validateTypedShape(shapeInput); if (shape.reduce((count, axis) => count * axis, 1) !== value.data.length) typedInvalid('형상 변경은 원소 수를 유지해야 합니다.', 'TYPED_SHAPE_MISMATCH'); return { ...value, shape }; }
function typedStrides(shape: readonly number[]): number[] { return shape.map((_, index) => shape.slice(index + 1).reduce((count, axis) => count * axis, 1)); }
export function permuteTypedSignal(input: TypedSignal, axesInput: number[]): TypedSignal {
  const value = validateTypedSignal(input), axes = typedArray(axesInput, value.shape.length, value.shape.length).map(axis => typedInteger(axis, 0, value.shape.length - 1));
  if (new Set(axes).size !== axes.length) typedInvalid('축 순열에는 각 축을 정확히 한 번 지정해야 합니다.', 'TYPED_AXIS_MISMATCH');
  const shape = axes.map(axis => value.shape[axis]!), before = typedStrides(value.shape), after = typedStrides(shape);
  const data = Array.from({ length: value.data.length }, (_, index) => value.data[axes.reduce((offset, axis, position) => offset + Math.floor(index / after[position]!) % shape[position]! * before[axis]!, 0)]!);
  return validateTypedSignal({ ...value, shape, data });
}
export function squeezeTypedSignal(input: TypedSignal): TypedSignal { const value = validateTypedSignal(input); return { ...value, shape: value.shape.filter(axis => axis !== 1) }; }

export type TypedBinaryOperation = 'add' | 'subtract' | 'multiply' | 'divide';
export function typedBinary(first: TypedSignal, second: TypedSignal, operation: TypedBinaryOperation, inputOptions: TypedCastOptions = {}): TypedSignal {
  const a = validateTypedSignal(first), b = validateTypedSignal(second), type = typedTypeOf(a), options = typedCastOptions(inputOptions);
  if (!equalDataType(type, typedTypeOf(b)) || !['add', 'subtract', 'multiply', 'divide'].includes(operation)) typedInvalid('자료형 산술 입력은 동일한 자료형과 승인한 연산이어야 합니다.', 'TYPED_TYPE_MISMATCH');
  if (a.shape.length && b.shape.length && JSON.stringify(a.shape) !== JSON.stringify(b.shape)) typedInvalid('비scalar 자료형 산술 입력은 같은 형상이어야 합니다.', 'TYPED_SHAPE_MISMATCH');
  const shape = a.shape.length ? a.shape : b.shape, count = shape.reduce((product, axis) => product * axis, 1);
  const data = Array.from({ length: count }, (_, index): TypedCell => {
    const left = a.data[a.shape.length ? index : 0]!, right = b.data[b.shape.length ? index : 0]!;
    if (type.dtype === 'complex128') return typedComplexBinary(left as TypedComplex, right as TypedComplex, operation);
    if (type.dtype === 'float32' || type.dtype === 'float64') { const x = decodeTypedFloat(left as TypedFloat), y = decodeTypedFloat(right as TypedFloat); let output = operation === 'add' ? x + y : operation === 'subtract' ? x - y : operation === 'multiply' ? x * y : x / y; if (type.dtype === 'float32') output = Math.fround(output); if (options.special === 'error' && !Number.isFinite(output)) typedInvalid('IEEE 산술 결과가 유한하지 않습니다.', 'TYPED_NONFINITE_RESULT'); return encodeTypedFloat(output); }
    if (!isIntegerDataType(type) && type.dtype !== 'fixed') typedInvalid('이 자료형은 산술 연산을 지원하지 않습니다.', 'TYPED_TYPE_MISMATCH');
    const x = typedRationalCell(left, type), y = typedRationalCell(right, type);
    let output: TypedRational;
    if (operation === 'add') output = { n: x.n * y.d + y.n * x.d, d: x.d * y.d };
    else if (operation === 'subtract') output = { n: x.n * y.d - y.n * x.d, d: x.d * y.d };
    else if (operation === 'multiply') output = { n: x.n * y.n, d: x.d * y.d };
    else { if (!y.n) typedInvalid('정수·고정소수점은 0으로 나눌 수 없습니다.', 'TYPED_DIVIDE_BY_ZERO'); const sign = y.n < 0n ? -1n : 1n; output = { n: x.n * y.d * sign, d: x.d * y.n * sign }; }
    if (type.dtype === 'fixed') output = typedScale(output, type.fixed!.fractionLength);
    return boundTypedInteger(typedRoundRational(output, options.rounding), type, options.overflow);
  });
  return validateTypedSignal({ kind: 'typed', ...type, shape, data });
}
function typedFiniteComplex(value: TypedComplex): [number, number] { const re = decodeTypedFloat(value.re), im = decodeTypedFloat(value.im); if (!Number.isFinite(re) || !Number.isFinite(im)) typedInvalid('복소수 산술에는 유한한 성분이 필요합니다.', 'TYPED_COMPLEX_NONFINITE'); return [re, im]; }
function typedComplexOutput(re: number, im: number): TypedComplex { if (!Number.isFinite(re) || !Number.isFinite(im)) typedInvalid('복소수 산술 결과가 유한하지 않습니다.', 'TYPED_COMPLEX_NONFINITE'); return { re: encodeTypedFloat(re), im: encodeTypedFloat(im) }; }
function typedComplexBinary(left: TypedComplex, right: TypedComplex, operation: TypedBinaryOperation): TypedComplex {
  const [a, b] = typedFiniteComplex(left), [c, d] = typedFiniteComplex(right);
  if (operation === 'add') return typedComplexOutput(a + c, b + d);
  if (operation === 'subtract') return typedComplexOutput(a - c, b - d);
  if (operation === 'multiply') return typedComplexOutput(a * c - b * d, a * d + b * c);
  if (c === 0 && d === 0) typedInvalid('복소수를 0으로 나눌 수 없습니다.', 'TYPED_DIVIDE_BY_ZERO');
  // Scale the denominator before multiplication to avoid squaring near MAX_VALUE.
  const magnitude = Math.max(Math.abs(c), Math.abs(d)), cs = c / magnitude, ds = d / magnitude, denominator = cs * cs + ds * ds;
  return typedComplexOutput((a / magnitude * cs + b / magnitude * ds) / denominator, (b / magnitude * cs - a / magnitude * ds) / denominator);
}
export type TypedUnaryOperation = 'negate' | 'conjugate' | 'abs' | 'angle' | 'exp' | 'log' | 'sqrt' | 'sin' | 'cos';
export function typedUnary(input: TypedSignal, operation: TypedUnaryOperation, inputOptions: TypedCastOptions = {}): TypedSignal {
  const value = validateTypedSignal(input), type = typedTypeOf(value), options = typedCastOptions(inputOptions);
  if (!['negate', 'conjugate', 'abs', 'angle', 'exp', 'log', 'sqrt', 'sin', 'cos'].includes(operation)) typedInvalid('승인하지 않은 자료형 함수입니다.', 'TYPED_TYPE_MISMATCH');
  const outputType: TypedDataType = type.dtype === 'complex128' && (operation === 'abs' || operation === 'angle') ? { dtype: 'float64' } : type;
  const data = value.data.map((cell): TypedCell => {
    if (type.dtype === 'complex128') {
      const pair = cell as TypedComplex;
      if (operation === 'conjugate' || operation === 'negate') return { re: operation === 'negate' ? encodeTypedFloat(-decodeTypedFloat(pair.re)) : pair.re, im: encodeTypedFloat(-decodeTypedFloat(pair.im)) };
      const [re, im] = typedFiniteComplex(pair), magnitude = Math.hypot(re, im), scale = Math.max(Math.abs(re), Math.abs(im));
      if (operation === 'abs') { if (options.special === 'error' && !Number.isFinite(magnitude)) typedInvalid('복소수 크기가 유한 범위를 벗어났습니다.', 'TYPED_NONFINITE_RESULT'); return encodeTypedFloat(magnitude); }
      if (operation === 'angle') return encodeTypedFloat(Math.atan2(im, re));
      if (operation === 'exp') return typedComplexOutput(Math.exp(re) * Math.cos(im), Math.exp(re) * Math.sin(im));
      if (operation === 'log') { if (re === 0 && im === 0) typedInvalid('복소수 log의 0 입력은 지원하지 않습니다.', 'TYPED_COMPLEX_DOMAIN'); return typedComplexOutput(Math.log(scale) + Math.log(Math.hypot(re / scale, im / scale)), Math.atan2(im, re)); }
      if (operation === 'sqrt') {
        if (!magnitude) return { re: 0, im: encodeTypedFloat(im) };
        const sign = im < 0 || Object.is(im, -0) ? -1 : 1;
        // Scale before addition; r+|re| can overflow although the root is finite.
        const large = Math.sqrt(scale) * Math.sqrt((Math.hypot(re / scale, im / scale) + Math.abs(re) / scale) / 2);
        return re >= 0 ? typedComplexOutput(large, im / (2 * large)) : typedComplexOutput(Math.abs(im) / (2 * large), sign * large);
      }
      return operation === 'sin' ? typedComplexOutput(Math.sin(re) * Math.cosh(im), Math.cos(re) * Math.sinh(im)) : typedComplexOutput(Math.cos(re) * Math.cosh(im), -Math.sin(re) * Math.sinh(im));
    }
    if (isIntegerDataType(type) || type.dtype === 'fixed') { if (operation !== 'negate' && operation !== 'abs' && operation !== 'conjugate') typedInvalid('정수·고정소수점 함수는 negate/abs/conjugate만 지원합니다.', 'TYPED_TYPE_MISMATCH'); const number = BigInt(cell as string); return boundTypedInteger(operation === 'negate' ? -number : operation === 'abs' && number < 0n ? -number : number, type, options.overflow); }
    if (type.dtype !== 'float64' && type.dtype !== 'float32') typedInvalid('이 자료형은 수학 함수를 지원하지 않습니다.', 'TYPED_TYPE_MISMATCH');
    const number = decodeTypedFloat(cell as TypedFloat); let result = operation === 'negate' ? -number : operation === 'abs' ? Math.abs(number) : operation === 'angle' ? Math.atan2(0, number) : operation === 'exp' ? Math.exp(number) : operation === 'log' ? Math.log(number) : operation === 'sqrt' ? Math.sqrt(number) : operation === 'sin' ? Math.sin(number) : operation === 'cos' ? Math.cos(number) : number;
    if (type.dtype === 'float32') result = Math.fround(result); if (options.special === 'error' && !Number.isFinite(result)) typedInvalid('IEEE 함수 결과가 유한하지 않습니다.', 'TYPED_NONFINITE_RESULT'); return encodeTypedFloat(result);
  });
  return validateTypedSignal({ kind: 'typed', ...outputType, shape: value.shape, data });
}
export function complexFromParts(real: TypedSignal, imaginary: TypedSignal): TypedSignal {
  const a = typedCast(real, { dtype: 'float64' }), b = typedCast(imaginary, { dtype: 'float64' });
  if (a.shape.length && b.shape.length && JSON.stringify(a.shape) !== JSON.stringify(b.shape)) typedInvalid('복소수 실수·허수 비scalar 입력 형상이 같아야 합니다.', 'TYPED_SHAPE_MISMATCH');
  const shape = a.shape.length ? a.shape : b.shape, count = shape.reduce((product, axis) => product * axis, 1);
  return validateTypedSignal({ kind: 'typed', dtype: 'complex128', shape, data: Array.from({ length: count }, (_, index) => ({ re: a.data[a.shape.length ? index : 0], im: b.data[b.shape.length ? index : 0] })) });
}
export function complexParts(input: TypedSignal): { re: TypedSignal; im: TypedSignal } {
  const value = validateTypedSignal(input); if (value.dtype !== 'complex128') typedInvalid('complex128 입력이 필요합니다.', 'TYPED_TYPE_MISMATCH');
  return { re: { kind: 'typed', dtype: 'float64', shape: [...value.shape], data: value.data.map(cell => (cell as TypedComplex).re) }, im: { kind: 'typed', dtype: 'float64', shape: [...value.shape], data: value.data.map(cell => (cell as TypedComplex).im) } };
}
export function complexHermitian(input: TypedSignal): TypedSignal { const value = validateTypedSignal(input); if (value.dtype !== 'complex128' || value.shape.length !== 2) typedInvalid('Hermitian 전치에는 complex128 2D 신호가 필요합니다.', 'TYPED_TYPE_MISMATCH'); return typedUnary(permuteTypedSignal(value, [1, 0]), 'conjugate'); }
export function complexIsHermitian(input: TypedSignal, tolerance = 0): boolean { const value = validateTypedSignal(input); if (value.dtype !== 'complex128' || value.shape.length !== 2 || value.shape[0] !== value.shape[1] || !Number.isFinite(tolerance) || tolerance < 0) typedInvalid('Hermitian 확인에는 정방 complex128 행렬과 유한한 비음수 tolerance가 필요합니다.', 'TYPED_TYPE_MISMATCH'); const conjugate = complexHermitian(value); return value.data.every((cell, index) => { const [re, im] = typedFiniteComplex(cell as TypedComplex), [cr, ci] = typedFiniteComplex(conjugate.data[index] as TypedComplex); return Math.abs(re - cr) <= tolerance && Math.abs(im - ci) <= tolerance; }); }
