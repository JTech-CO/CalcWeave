import { describe, expect, it } from 'vitest';
import { ModelError, type TypedCell, type TypedDataType, type TypedDType, type TypedOverflow, type TypedRounding, type TypedSignal } from '../packages/model/src/types';
import { TYPED_LIMITS, boundTypedInteger, cloneTypedSignal, complexFromParts, complexHermitian, complexIsHermitian, complexParts, decodeTypedFloat, encodeTypedFloat, equalDataType, fromLegacyTypedSignal, permuteTypedSignal, reshapeTypedSignal, squeezeTypedSignal, stripTypedSignal, toLegacyTypedSignal, typedBinary, typedCast, typedDataType, typedDescriptor, typedStorageElements, typedUnary, validateDataType, validateTypedShape, validateTypedSignal } from '../packages/model/src/typed';

const fixed = (wordLength = 8, fractionLength = 3, signed = true): TypedDataType => ({ dtype: 'fixed', fixed: { wordLength, fractionLength, signed } });
const value = (type: TypedDataType, data: TypedCell[], shape: number[] = []): TypedSignal => ({ kind: 'typed', ...type, shape, data });
const fp = (data: TypedCell[], shape: number[] = []): TypedSignal => value({ dtype: 'float64' }, data, shape);
function failure(action: () => unknown, expected: string): void { try { action(); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some(diagnostic => diagnostic.code === expected)).toBe(true); return; } throw new Error(`Expected ${expected}`); }
const integerTypes: TypedDType[] = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'];
const roundings: TypedRounding[] = ['floor', 'ceil', 'zero', 'nearest', 'away', 'even'];
const overflows: TypedOverflow[] = ['error', 'saturate', 'wrap'];

/** Independent small signed-rational oracle: no bit decoding or production helpers. */
function reference(numerator: bigint, denominator: bigint, wordLength: number, signed: boolean, rounding: TypedRounding, overflow: TypedOverflow): string | 'overflow' {
  let result = numerator / denominator, rem = numerator % denominator;
  if (rounding === 'floor' && rem < 0n) result--;
  if (rounding === 'ceil' && rem > 0n) result++;
  const abs = rem < 0n ? -rem : rem;
  if (rounding === 'nearest' || rounding === 'away' || rounding === 'even') {
    const overHalf = 2n * abs > denominator, tie = 2n * abs === denominator;
    if (overHalf || tie && (rounding === 'nearest' && rem > 0n || rounding === 'away' || rounding === 'even' && (result & 1n) !== 0n)) result += rem < 0n ? -1n : 1n;
  }
  const modulus = 2n ** BigInt(wordLength), half = modulus / 2n, lower = signed ? -half : 0n, upper = signed ? half - 1n : modulus - 1n;
  if (result < lower || result > upper) {
    if (overflow === 'error') return 'overflow';
    if (overflow === 'saturate') result = result < lower ? lower : upper;
    else { const q = result < 0n ? (result - modulus + 1n) / modulus : result / modulus; result -= q * modulus; if (signed && result >= half) result -= modulus; }
  }
  return result.toString();
}
function assertReference(number: number, numerator: bigint, denominator: bigint, type: TypedDataType, rounding: TypedRounding, overflow: TypedOverflow): void {
  const word = type.dtype === 'fixed' ? type.fixed!.wordLength : Number(type.dtype.replace(/\D/g, '')), signed = type.dtype === 'fixed' ? type.fixed!.signed : type.dtype.startsWith('int');
  const fraction = type.dtype === 'fixed' ? type.fixed!.fractionLength : 0;
  const expected = reference(fraction >= 0 ? numerator * (2n ** BigInt(fraction)) : numerator, fraction < 0 ? denominator * (2n ** BigInt(-fraction)) : denominator, word, signed, rounding, overflow);
  if (expected === 'overflow') failure(() => typedCast(fp([encodeTypedFloat(number)]), type, { rounding, overflow }), 'TYPED_OVERFLOW');
  else expect(typedCast(fp([encodeTypedFloat(number)]), type, { rounding, overflow }).data).toEqual([expected]);
}

describe('M10 typed wire, metadata and bounded inspection', () => {
  const samples: TypedSignal[] = [fp([1]), fp(['-0', 'NaN', 'Infinity', '-Infinity'], [4]), value({ dtype: 'float32' }, [Math.fround(0.1)]), value({ dtype: 'boolean' }, [true, false], [2]), ...integerTypes.map(dtype => value({ dtype }, ['0'])), value({ dtype: 'complex128' }, [{ re: '-0', im: 'NaN' }]), value(fixed(64, -64), ['-9223372036854775808']), value({ dtype: 'string' }, ['<script>text remains data</script>']), value({ dtype: 'enum', enum: { name: 'Traffic', labels: ['STOP', 'GO'] } }, ['GO'])];
  it.each(samples.map((sample, index) => [index, sample] as const))('round trips valid dtype fixture %i without casting or losing tags', (_index, sample) => {
    const clone = validateTypedSignal(sample); expect(JSON.parse(JSON.stringify(clone))).toEqual(sample); expect(clone).not.toBe(sample); expect(clone.data).not.toBe(sample.data); expect(clone.shape).not.toBe(sample.shape);
    expect(typedDescriptor(sample, 'm').typed).toEqual(validateDataType({ dtype: sample.dtype, ...(sample.fixed ? { fixed: sample.fixed } : {}), ...(sample.enum ? { enum: sample.enum } : {}) }));
  });
  it('copies complex fields and enum tables without sharing nested storage', () => {
    const original = value({ dtype: 'complex128' }, [{ re: 1, im: 2 }]), clone = cloneTypedSignal(original); (clone.data[0] as { re: number }).re = 7; expect(original.data).toEqual([{ re: 1, im: 2 }]);
    const enumeration = value({ dtype: 'enum', enum: { name: 'E', labels: ['a', 'b'] } }, ['a']); const copied = cloneTypedSignal(enumeration); copied.enum!.labels.push('c'); expect(enumeration.enum!.labels).toEqual(['a', 'b']);
  });
  it('handles rank eight, singleton axes and 1,024 actual cells', () => { expect(validateTypedShape([1, 1, 1, 1, 1, 1, 32, 32])).toHaveLength(8); expect(validateTypedSignal(value({ dtype: 'int8' }, Array(1_024).fill('0'), [32, 32])).data).toHaveLength(1_024); });
  it.each([Array(9).fill(1), [0], [-1], [1.1], [1_025], [33, 32], [Number.MAX_SAFE_INTEGER]])('rejects malformed or oversized shape %j', shape => { expect(() => validateTypedShape(shape)).toThrow(ModelError); });
  it.each(['double', 'half', 'int128', 'Float64', '', 'inherit'])('fails closed on unknown dtype %s', dtype => failure(() => validateDataType({ dtype }), 'UNKNOWN_DTYPE'));
  it.each([{ dtype: 'float64', fixed: { signed: true, wordLength: 8, fractionLength: 0 } }, { dtype: 'int8', enum: { name: 'E', labels: ['a'] } }, { dtype: 'fixed' }, { dtype: 'enum' }, { dtype: 'float64', extra: 1 }])('rejects inconsistent metadata %j', type => expect(() => validateDataType(type)).toThrow(ModelError));
  it.each([fixed(0), fixed(65), fixed(8, -65), fixed(8, 65), { dtype: 'fixed', fixed: { signed: 'yes', wordLength: 8, fractionLength: 0 } }])('rejects out-of-bound fixed metadata %j', type => expect(() => validateDataType(type)).toThrow(ModelError));
  it.each([{ name: 'E', labels: [] }, { name: 'E', labels: ['a', 'a'] }, { name: 'E', labels: [''] }, { name: 'E', labels: ['x'.repeat(65)] }, { name: 'E', labels: Array.from({ length: 65 }, (_, index) => String(index)) }, { name: '9E', labels: ['a'] }, { name: 'E', labels: ['a'], codes: [4] }])('rejects malformed enum definition %j', enumeration => expect(() => validateDataType({ dtype: 'enum', enum: enumeration })).toThrow(ModelError));
  it('rejects unregistered enum labels and long strings', () => { failure(() => validateTypedSignal(value({ dtype: 'enum', enum: { name: 'E', labels: ['a'] } }, ['b'])), 'TYPED_ENUM_VALUE'); expect(() => validateTypedSignal(value({ dtype: 'string' }, ['x'.repeat(257)]))).toThrow(ModelError); });
  it.each(['01', '-0', '+1', '1.0', '1e2', ' 1', '1 ', '1234567890123456789012'])('rejects noncanonical integer code %s', cell => expect(() => validateTypedSignal(value({ dtype: 'int64' }, [cell]))).toThrow(ModelError));
  it('rejects direct BigInt, integer numbers, raw negative zero, holes and wrong data count', () => {
    for (const data of [[1], [1n], ['128'], ['-129'], new Array(1)]) expect(() => validateTypedSignal({ kind: 'typed', dtype: 'int8', shape: [], data })).toThrow(ModelError);
    for (const data of [[-0], [Infinity], [NaN], []]) expect(() => validateTypedSignal(fp(data as TypedCell[]))).toThrow(ModelError);
    expect(() => validateTypedSignal(fp([1], [2]))).toThrow(ModelError);
  });
  it('inspects objects and arrays without calling accessor hooks', () => {
    let reads = 0; const signal = Object.defineProperty({}, 'kind', { enumerable: true, get() { reads++; return 'typed'; } });
    expect(() => validateTypedSignal(signal)).toThrow(ModelError); expect(reads).toBe(0);
    const source = fp([1]); Object.defineProperty(source.data, '0', { enumerable: true, get() { reads++; return 1; } }); expect(() => validateTypedSignal(source)).toThrow(ModelError); expect(reads).toBe(0);
    const complex = Object.defineProperty({ im: 0 }, 're', { enumerable: true, get() { reads++; return 1; } }); expect(() => validateTypedSignal(value({ dtype: 'complex128' }, [complex as unknown as TypedCell]))).toThrow(ModelError); expect(reads).toBe(0);
  });
  it('rejects hidden/symbol/prototype/extra array properties', () => {
    const hidden = fp([1]); Object.defineProperty(hidden, 'extra', { value: 1 }); expect(() => validateTypedSignal(hidden)).toThrow(ModelError);
    const symbol = fp([1]); Object.defineProperty(symbol, Symbol('s'), { value: 1, enumerable: true }); expect(() => validateTypedSignal(symbol)).toThrow(ModelError);
    expect(() => validateTypedSignal(Object.create(fp([1])))).toThrow(ModelError);
    const data = [1]; Object.defineProperty(data, 'extra', { value: 3, enumerable: true }); expect(() => validateTypedSignal(fp(data))).toThrow(ModelError);
  });
  it('distinguishes metadata and preserves enum label order', () => { expect(equalDataType(fixed(), fixed())).toBe(true); expect(equalDataType(fixed(), fixed(8, 4))).toBe(false); expect(equalDataType({ dtype: 'enum', enum: { name: 'E', labels: ['a', 'b'] } }, { dtype: 'enum', enum: { name: 'E', labels: ['b', 'a'] } })).toBe(false); expect(typedDataType({ valueType: 'float64', shape: [2], unit: '1' })).toEqual({ dtype: 'float64' }); });
  it('charges complex components, full integer code, UTF8 text and enum tables', () => {
    expect(typedStorageElements(value({ dtype: 'complex128' }, [{ re: 0, im: 1 }]))).toBe(2); expect(typedStorageElements(value({ dtype: 'uint64' }, ['18446744073709551615']))).toBe(21);
    expect(typedStorageElements(value({ dtype: 'string' }, ['😀'.repeat(128)]))).toBe(1_024);
    const small = value({ dtype: 'enum', enum: { name: 'E', labels: ['a'] } }, ['a']), large = value({ dtype: 'enum', enum: { name: 'E', labels: ['가'.repeat(64)] } }, ['가'.repeat(64)]); expect(typedStorageElements(large)).toBeGreaterThan(typedStorageElements(small)); expect(typedStorageElements(typedDescriptor(large))).toBe(typedStorageElements(large));
  });
});

describe('M10 binary32 and tagged IEEE policy', () => {
  it.each([0, -0, Number.MIN_VALUE, 2 ** -149, 2 ** -150, 2 ** -126 - 2 ** -149, 2 ** -126, 1 + 2 ** -24, 1 + 3 * 2 ** -24, -(1 + 2 ** -24), 3.4028234663852886e38, Number.MAX_VALUE, Infinity, -Infinity, NaN])('matches independent float32 storage bits for %s', number => {
    const reference = new DataView(new ArrayBuffer(4)); reference.setFloat32(0, number, false); const actual = typedCast(fp([encodeTypedFloat(number)]), { dtype: 'float32' }); const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, decodeTypedFloat(actual.data[0] as never), false); expect(view.getUint32(0, false)).toBe(reference.getUint32(0, false));
    expect(JSON.parse(JSON.stringify(actual))).toEqual(actual);
  });
  it('rounds every binary32 arithmetic output rather than retaining float64 work', () => { const one = value({ dtype: 'float32' }, [16_777_216]), small = value({ dtype: 'float32' }, [1]); expect(typedBinary(one, small, 'add').data).toEqual([16_777_216]); expect(typedBinary(typedBinary(one, small, 'add'), one, 'subtract').data).toEqual([0]); });
  it('requires actually quantized float32 data', () => { failure(() => validateTypedSignal(value({ dtype: 'float32' }, [0.1])), 'TYPED_FLOAT32_REPRESENTATION'); expect(validateTypedSignal(value({ dtype: 'float32' }, [Math.fround(0.1)]))).toBeTruthy(); });
  it('preserves signed zero, IEEE special arithmetic and finite-only boundary failure', () => {
    expect(typedUnary(fp(['-0']), 'sqrt').data).toEqual(['-0']); expect(typedBinary(fp([1]), fp([0]), 'divide').data).toEqual(['Infinity']); expect(typedBinary(fp([0]), fp([0]), 'divide').data).toEqual(['NaN']);
    failure(() => typedBinary(fp([1]), fp([0]), 'divide', { special: 'error' }), 'TYPED_NONFINITE_RESULT'); failure(() => typedCast(fp(['Infinity']), { dtype: 'float64' }, { special: 'error' }), 'TYPED_NONFINITE_CAST'); failure(() => typedCast(fp(['NaN']), { dtype: 'int32' }), 'TYPED_NONFINITE_CAST'); failure(() => typedCast(fp(['Infinity']), { dtype: 'boolean' }), 'TYPED_NONFINITE_CAST');
  });
});

describe('M10 exact integer/fixed conversion, overflow and real/stored distinction', () => {
  it.each(roundings)('matches independent signed rational oracle with %s at ties and both overflow boundaries', rounding => {
    for (const overflow of overflows) for (const dtype of integerTypes) for (const numerator of [-1_035n, -1_028n, -1_025n, -1_024n, -21n, -20n, -19n, -5n, -4n, -3n, -1n, 0n, 1n, 3n, 4n, 5n, 19n, 20n, 21n, 1_020n, 1_021n, 1_024n, 2_051n]) assertReference(Number(numerator) / 8, numerator, 8n, { dtype }, rounding, overflow);
  });
  it.each(roundings)('matches fixed-point scaling oracle with %s and positive/negative fractional lengths', rounding => { for (const fraction of [-64, -3, 0, 3, 64]) for (const signed of [true, false]) for (const overflow of overflows) for (const numerator of [-21n, -5n, -1n, 0n, 1n, 5n, 21n]) assertReference(Number(numerator) / 8, numerator, 8n, fixed(8, fraction, signed), rounding, overflow); });
  it('preserves 64bit exact codes across arithmetic, JSON and uint64 wrap', () => {
    const large = value({ dtype: 'int64' }, ['9007199254740993']), one = value({ dtype: 'int64' }, ['1']); expect(typedBinary(large, one, 'add').data).toEqual(['9007199254740994']); expect(typedBinary(large, one, 'subtract').data).toEqual(['9007199254740992']);
    const maximum = value({ dtype: 'uint64' }, ['18446744073709551615']); expect(typedBinary(maximum, value({ dtype: 'uint64' }, ['1']), 'add', { overflow: 'wrap' }).data).toEqual(['0']); expect(JSON.parse(JSON.stringify(maximum)).data).toEqual(['18446744073709551615']);
  });
  it('uses exact finite IEEE inputs even at maximum exponent, subnormal and 64bit unsigned boundary', () => {
    expect(typedCast(fp([Number.MAX_VALUE]), { dtype: 'uint64' }, { overflow: 'wrap' }).data).toEqual(['0']); expect(typedCast(fp([Number.MAX_VALUE]), fixed(64, 64, false), { overflow: 'saturate' }).data).toEqual(['18446744073709551615']);
    expect(typedCast(fp([Number.MIN_VALUE]), fixed(64, 64), { rounding: 'ceil' }).data).toEqual(['1']); expect(typedCast(fp([-Number.MIN_VALUE]), fixed(64, 64), { rounding: 'floor' }).data).toEqual(['-1']);
    expect(typedCast(fp([2 ** 64]), { dtype: 'uint64' }, { overflow: 'wrap' }).data).toEqual(['0']); failure(() => typedCast(fp([2 ** 64]), { dtype: 'uint64' }), 'TYPED_OVERFLOW');
  });
  it('distinguishes real-world scaling, stored integers and IEEE bit reinterpretation', () => {
    const input = value(fixed(8, 2), ['12']); expect(typedCast(input, fixed(8, 4)).data).toEqual(['48']); expect(typedCast(input, fixed(8, 4), { mode: 'stored-integer' }).data).toEqual(['12']);
    expect(typedCast(value({ dtype: 'float32' }, [5]), { dtype: 'uint32' }, { mode: 'stored-integer' }).data).toEqual(['5']);
    expect(stripTypedSignal(value(fixed(9, 3), ['-8']))).toEqual(value({ dtype: 'int16' }, ['-8'])); expect(stripTypedSignal(value(fixed(33, 20, false), ['4294967297']))).toEqual(value({ dtype: 'uint64' }, ['4294967297']));
  });
  it('applies arithmetic output fixed scaling and tie rounding at each operation', () => {
    const first = value(fixed(8, 2), ['3']), second = value(fixed(8, 2), ['6']); expect(typedBinary(first, second, 'multiply', { rounding: 'even' }).data).toEqual(['4']); expect(typedBinary(first, second, 'multiply', { rounding: 'away' }).data).toEqual(['5']); expect(typedBinary(first, second, 'divide', { rounding: 'even' }).data).toEqual(['2']);
    expect(typedBinary(value(fixed(8, -2), ['3']), value(fixed(8, -2), ['2']), 'multiply').data).toEqual(['24']);
  });
  it('checks integer overflow after rounding and catches impossible intermediates', () => { expect(typedCast(fp([127.25]), { dtype: 'int8' }, { rounding: 'floor' }).data).toEqual(['127']); failure(() => typedCast(fp([127.25]), { dtype: 'int8' }, { rounding: 'ceil' }), 'TYPED_OVERFLOW'); failure(() => boundTypedInteger(1n << 1_201n, { dtype: 'uint64' }), 'TYPED_RESOURCE_LIMIT'); });
  it('handles typed arithmetic broadcast, unsigned negate and zero division explicitly', () => {
    expect(typedBinary(value({ dtype: 'int8' }, ['1']), value({ dtype: 'int8' }, ['2', '3'], [2]), 'add').data).toEqual(['3', '4']); expect(typedUnary(value({ dtype: 'uint8' }, ['1']), 'negate', { overflow: 'wrap' }).data).toEqual(['255']);
    failure(() => typedBinary(value({ dtype: 'int8' }, ['1']), value({ dtype: 'int8' }, ['0']), 'divide'), 'TYPED_DIVIDE_BY_ZERO'); failure(() => typedBinary(value({ dtype: 'int8' }, ['1']), value({ dtype: 'uint8' }, ['1']), 'add'), 'TYPED_TYPE_MISMATCH'); failure(() => typedBinary(fp([1, 2], [2]), fp([1, 2, 3], [3]), 'add'), 'TYPED_SHAPE_MISMATCH');
  });
  it.each([{ rounding: 'nearest-even' }, { overflow: 'ignore' }, { mode: 'reinterpret' }, { special: 'coerce' }, { extra: 1 }])('rejects unknown conversion options %j', options => failure(() => typedCast(fp([1]), { dtype: 'int8' }, options as never), 'INVALID_TYPED_OPTIONS'));
});

describe('M10 complex branches, conjugation and Hermitian contracts', () => {
  const complex = (re: TypedCell, im: TypedCell): TypedSignal => value({ dtype: 'complex128' }, [{ re, im } as TypedCell]);
  it('keeps signed zero through complex components, conjugation and JSON', () => { const input = complex(-1, '-0'); expect(complexParts(input).im.data).toEqual(['-0']); expect(typedUnary(input, 'conjugate').data).toEqual([{ re: -1, im: 0 }]); expect(complexFromParts(fp([-1]), fp(['-0']))).toEqual(input); expect(complexFromParts(fp([1]), fp([2, 3], [2])).data).toEqual([{ re: 1, im: 2 }, { re: 1, im: 3 }]); expect(JSON.parse(JSON.stringify(typedUnary(input, 'negate'))).data).toEqual([{ re: 1, im: 0 }]); });
  it('uses the principal branch with both sides of the negative real axis', () => { expect(typedUnary(complex(-1, 0), 'log').data).toEqual([{ re: 0, im: Math.PI }]); expect(typedUnary(complex(-1, '-0'), 'log').data).toEqual([{ re: 0, im: -Math.PI }]); expect(typedUnary(complex(-1, 0), 'sqrt').data).toEqual([{ re: 0, im: 1 }]); expect(typedUnary(complex(-1, '-0'), 'sqrt').data).toEqual([{ re: 0, im: -1 }]); });
  it('returns analytic arithmetic with complex division and scalar broadcast', () => { expect(typedBinary(complex(2, 3), complex(4, -1), 'multiply').data).toEqual([{ re: 11, im: 10 }]); const output = typedBinary(complex(2, 3), complex(4, -1), 'divide').data[0] as { re: number; im: number }; expect(output.re).toBeCloseTo(5 / 17, 14); expect(output.im).toBeCloseTo(14 / 17, 14); expect(typedUnary(complex(3, 4), 'abs').data).toEqual([5]); });
  it('scales extreme complex log, square root and division without avoidable overflow', () => {
    const maximum = Number.MAX_VALUE, large = complex(maximum, maximum); const logarithm = typedUnary(large, 'log').data[0] as { re: number; im: number }; expect(logarithm.re).toBeCloseTo(Math.log(maximum) + Math.log(2) / 2, 12); expect(logarithm.im).toBe(Math.PI / 4);
    const root = typedUnary(large, 'sqrt').data[0] as { re: number; im: number }; expect(Number.isFinite(root.re)).toBe(true); expect(Number.isFinite(root.im)).toBe(true); expect(root.im / root.re).toBeCloseTo(Math.sqrt(2) - 1, 14); expect(typedBinary(large, large, 'divide').data).toEqual([{ re: 1, im: 0 }]);
    const tiny = typedUnary(complex(Number.MIN_VALUE, Number.MIN_VALUE), 'sqrt').data[0] as { re: number; im: number }; expect(tiny.re).toBeGreaterThan(0); expect(tiny.im).toBeGreaterThan(0);
  });
  it('transposes and conjugates row-major matrices and distinguishes symmetric from Hermitian', () => { const input = value({ dtype: 'complex128' }, [{ re: 2, im: 0 }, { re: 3, im: 4 }, { re: 3, im: -4 }, { re: 5, im: 0 }], [2, 2]); expect(complexIsHermitian(input)).toBe(true); expect(complexHermitian(input).data).toEqual([{ re: 2, im: '-0' }, { re: 3, im: 4 }, { re: 3, im: -4 }, { re: 5, im: '-0' }]); const modified = cloneTypedSignal(input); modified.data[2] = { re: 3, im: 4 }; expect(complexIsHermitian(modified)).toBe(false); });
  it('rejects silent real coercion, nonfinite complex arithmetic, domain zero and shape mismatch', () => {
    failure(() => typedCast(complex(1, 0), { dtype: 'float64' }), 'TYPED_UNSUPPORTED_CAST'); failure(() => typedBinary(complex(1, 0), complex(0, 0), 'divide'), 'TYPED_DIVIDE_BY_ZERO'); failure(() => typedUnary(complex(0, 0), 'log'), 'TYPED_COMPLEX_DOMAIN'); failure(() => typedUnary(complex('NaN', 0), 'sqrt'), 'TYPED_COMPLEX_NONFINITE'); failure(() => complexFromParts(fp([1, 2], [2]), fp([1, 2, 3], [3])), 'TYPED_SHAPE_MISMATCH');
  });
});

describe('M10 n-D axis order and explicit legacy boundaries', () => {
  it('permutes rank-three row-major data against independent coordinates', () => {
    const input = value({ dtype: 'int16' }, Array.from({ length: 24 }, (_, index) => String(index)), [2, 3, 4]); const output = permuteTypedSignal(input, [2, 0, 1]); const reference: string[] = [];
    for (let z = 0; z < 4; z++) for (let x = 0; x < 2; x++) for (let y = 0; y < 3; y++) reference.push(String(12 * x + 4 * y + z));
    expect(output.shape).toEqual([4, 2, 3]); expect(output.data).toEqual(reference); expect(permuteTypedSignal(output, [1, 2, 0])).toEqual(input);
  });
  it('preserves cell storage under reshape/squeeze and scalar permutation', () => { const input = value({ dtype: 'uint64' }, ['9007199254740993', '9007199254740994'], [1, 2, 1]); expect(squeezeTypedSignal(input).shape).toEqual([2]); expect(reshapeTypedSignal(input, [2, 1]).data).toEqual(input.data); expect(permuteTypedSignal(fp([1]), [])).toEqual(fp([1])); expect(TYPED_LIMITS.maxRank).toBe(8); });
  it('rejects axis duplicates, rank changes, noninteger axes and element-count changes', () => { const input = fp([1, 2, 3, 4], [2, 2]); for (const axes of [[0, 0], [0], [0, 2], [0, 1.5]]) expect(() => permuteTypedSignal(input, axes)).toThrow(ModelError); failure(() => reshapeTypedSignal(input, [3]), 'TYPED_SHAPE_MISMATCH'); });
  it('converts existing real/boolean arrays without changing values or shape', () => { const input = [[1, -0], [3, 4]]; const typed = fromLegacyTypedSignal(input); expect(typed.shape).toEqual([2, 2]); expect(typed.data).toEqual([1, '-0', 3, 4]); const restored = toLegacyTypedSignal(typed); expect(restored).toEqual(input); expect(Object.is((restored as number[][])[0]![1], -0)).toBe(true); expect(toLegacyTypedSignal(fromLegacyTypedSignal([true, false]))).toEqual([true, false]); });
  it('blocks unsupported rank, special values, complex, string and enum at legacy boundary', () => { for (const input of [fp([1], [1, 1, 1]), value({ dtype: 'complex128' }, [{ re: 1, im: 0 }]), value({ dtype: 'string' }, ['1']), value({ dtype: 'enum', enum: { name: 'E', labels: ['a'] } }, ['a'])]) failure(() => toLegacyTypedSignal(input), 'TYPED_LEGACY_BOUNDARY'); failure(() => toLegacyTypedSignal(fp(['Infinity'])), 'TYPED_NONFINITE_CAST'); });
  it('requires bit-exact integer/fixed representation at legacy boundary, including values beyond 53bits', () => {
    failure(() => toLegacyTypedSignal(value({ dtype: 'uint64' }, ['9007199254740993'])), 'TYPED_LEGACY_PRECISION_LOSS'); failure(() => toLegacyTypedSignal(value(fixed(64, 64, false), ['18446744073709551615'])), 'TYPED_LEGACY_PRECISION_LOSS');
    expect(toLegacyTypedSignal(value({ dtype: 'uint64' }, ['9223372036854775808']))).toBe(2 ** 63); expect(toLegacyTypedSignal(value(fixed(64, 64, false), ['9223372036854775808']))).toBe(0.5);
    expect(typedCast(value({ dtype: 'uint64' }, ['9007199254740993']), { dtype: 'float64' }).data).toEqual([9007199254740992]);
  });
  it('preserves string/enum text as data and explicitly refuses numeric coercion', () => { const text = value({ dtype: 'string' }, ['42']); expect(typedCast(text, { dtype: 'string' })).toEqual(text); failure(() => typedCast(text, { dtype: 'int8' }), 'TYPED_UNSUPPORTED_CAST'); expect(() => fromLegacyTypedSignal([[1], [2, 3]])).toThrow(ModelError); expect(() => fromLegacyTypedSignal([true, 1] as never)).toThrow(ModelError); });
});
