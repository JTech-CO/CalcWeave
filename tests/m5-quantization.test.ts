import { describe, expect, it } from 'vitest';
import { ModelError } from '../packages/model/src';
import { quantizeFixed, validateFixedQuantizationOptions, type FixedQuantizationOptions } from '../packages/quantization/src';

const defaults: FixedQuantizationOptions = { wordLength: 8, fractionLength: 0, signedness: 'signed', rounding: 'nearest-even', overflow: 'error' };
function options(overrides: Partial<FixedQuantizationOptions> = {}): FixedQuantizationOptions { return { ...defaults, ...overrides }; }
function code(action: () => unknown, expected: string): void {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.some((item) => item.code === expected)).toBe(true); return; }
  throw new Error(`Expected ${expected}`);
}
/** Independent signed rational oracle: no DataView or input-bit decoding and no runtime helpers. */
function rationalReference(numerator: bigint, denominator: bigint, setting: FixedQuantizationOptions): { stored: number; value: number } | 'overflow' {
  numerator *= 2n ** BigInt(setting.fractionLength);
  let integer = numerator / denominator;
  const remainder = numerator % denominator;
  if (setting.rounding === 'floor' && remainder < 0n) integer--;
  if (setting.rounding === 'ceil' && remainder > 0n) integer++;
  if (setting.rounding === 'nearest-even') {
    const absoluteRemainder = remainder < 0n ? -remainder : remainder;
    if (absoluteRemainder * 2n > denominator || absoluteRemainder * 2n === denominator && integer % 2n !== 0n) integer += numerator < 0n ? -1n : 1n;
  }
  const modulus = 2n ** BigInt(setting.wordLength), half = modulus / 2n;
  const min = setting.signedness === 'signed' ? -half : 0n, max = setting.signedness === 'signed' ? half - 1n : modulus - 1n;
  if (integer < min || integer > max) {
    if (setting.overflow === 'error') return 'overflow';
    if (setting.overflow === 'saturate') integer = integer < min ? min : max;
    else {
      // Euclidean division independent of the production double-modulo expression.
      const quotient = integer < 0n ? (integer - modulus + 1n) / modulus : integer / modulus;
      integer -= quotient * modulus;
      if (setting.signedness === 'signed' && integer >= half) integer -= modulus;
    }
  }
  const stored = Number(integer); return { stored, value: stored / 2 ** setting.fractionLength };
}
function assertRational(mantissa: bigint, exponent: number, setting: FixedQuantizationOptions): void {
  const numerator = exponent >= 0 ? mantissa * 2n ** BigInt(exponent) : mantissa;
  const denominator = exponent < 0 ? 2n ** BigInt(-exponent) : 1n;
  const expected = rationalReference(numerator, denominator, setting);
  const value = Number(mantissa) * 2 ** exponent;
  if (expected === 'overflow') code(() => quantizeFixed(value, setting), 'FIXED_POINT_OVERFLOW');
  else expect(quantizeFixed(value, setting)).toEqual(expected);
}

describe('M5 exact fixed-point boundary rounding', () => {
  it('rounds positive and negative half ties to the nearest even stored code', () => {
    for (const [value, stored] of [[0.5, 0], [1.5, 2], [2.5, 2], [3.5, 4], [-0.5, 0], [-1.5, -2], [-2.5, -2], [-3.5, -4]]) expect(quantizeFixed(value!, defaults)).toEqual({ value: stored, stored });
    expect(quantizeFixed(0.3125, options({ fractionLength: 3 }))).toEqual({ stored: 2, value: 0.25 });
    expect(quantizeFixed(-0.4375, options({ fractionLength: 3 }))).toEqual({ stored: -4, value: -0.5 });
  });
  it.each(['floor', 'ceil', 'toward-zero', 'nearest-even'] as const)('applies %s correctly to signed rational fractions', (rounding) => {
    for (const numerator of [-21n, -20n, -19n, -17n, -1n, 0n, 1n, 17n, 19n, 20n, 21n]) assertRational(numerator, -3, options({ rounding }));
  });
  it('preserves an already quantized value and reports its exact 32bit stored code', () => {
    expect(quantizeFixed((2 ** 32 - 1) / 2 ** 32, options({ wordLength: 32, fractionLength: 32, signedness: 'unsigned' }))).toEqual({ stored: 4294967295, value: 0.9999999997671694 });
    expect(quantizeFixed(-0.5, options({ wordLength: 32, fractionLength: 32 }))).toEqual({ stored: -2147483648, value: -0.5 });
    expect(quantizeFixed(2147483647, options({ wordLength: 32 }))).toEqual({ stored: 2147483647, value: 2147483647 });
    expect(quantizeFixed(-2147483648, options({ wordLength: 32 }))).toEqual({ stored: -2147483648, value: -2147483648 });
  });
  it('normalizes negative zero, including negative tiny values rounded toward zero', () => {
    for (const value of [-0, -Number.MIN_VALUE, -0.1]) {
      const result = quantizeFixed(value, options({ rounding: 'toward-zero', signedness: 'unsigned' }));
      expect(result).toEqual({ stored: 0, value: 0 }); expect(Object.is(result.stored, -0)).toBe(false); expect(Object.is(result.value, -0)).toBe(false);
    }
  });
  it('handles one-bit signed/unsigned codes and fractionLength independent of wordLength', () => {
    expect(quantizeFixed(-1, options({ wordLength: 1 }))).toEqual({ stored: -1, value: -1 });
    expect(quantizeFixed(1, options({ wordLength: 1, signedness: 'unsigned' }))).toEqual({ stored: 1, value: 1 });
    expect(quantizeFixed(2 ** -32, options({ wordLength: 1, fractionLength: 32, signedness: 'unsigned' }))).toEqual({ stored: 1, value: 2 ** -32 });
    code(() => quantizeFixed(1, options({ wordLength: 1 })), 'FIXED_POINT_OVERFLOW');
  });
});

describe('M5 exact overflow policies after rounding', () => {
  it('saturates signed and unsigned codes at both boundaries', () => {
    expect(quantizeFixed(130, options({ overflow: 'saturate' }))).toEqual({ stored: 127, value: 127 });
    expect(quantizeFixed(-130, options({ overflow: 'saturate' }))).toEqual({ stored: -128, value: -128 });
    expect(quantizeFixed(-1, options({ signedness: 'unsigned', overflow: 'saturate' }))).toEqual({ stored: 0, value: 0 });
    expect(quantizeFixed(260, options({ signedness: 'unsigned', overflow: 'saturate' }))).toEqual({ stored: 255, value: 255 });
  });
  it('wraps negative unsigned and signed values modulo the exact word length', () => {
    expect(quantizeFixed(-1, options({ signedness: 'unsigned', overflow: 'wrap' }))).toEqual({ stored: 255, value: 255 });
    expect(quantizeFixed(130, options({ overflow: 'wrap' }))).toEqual({ stored: -126, value: -126 });
    expect(quantizeFixed(-129, options({ overflow: 'wrap' }))).toEqual({ stored: 127, value: 127 });
    expect(quantizeFixed(4294967297, options({ wordLength: 32, signedness: 'unsigned', overflow: 'wrap' }))).toEqual({ stored: 1, value: 1 });
    expect(quantizeFixed(-4294967297, options({ wordLength: 32, signedness: 'unsigned', overflow: 'wrap' }))).toEqual({ stored: 4294967295, value: 4294967295 });
  });
  it('checks overflow after rounding, not before it', () => {
    expect(quantizeFixed(127.25, options({ rounding: 'floor' }))).toEqual({ stored: 127, value: 127 });
    code(() => quantizeFixed(127.25, options({ rounding: 'ceil' })), 'FIXED_POINT_OVERFLOW');
    code(() => quantizeFixed(127.5, defaults), 'FIXED_POINT_OVERFLOW');
    expect(quantizeFixed(-0.5, options({ signedness: 'unsigned' }))).toEqual({ stored: 0, value: 0 });
    code(() => quantizeFixed(-0.5000000000000001, options({ signedness: 'unsigned' })), 'FIXED_POINT_OVERFLOW');
    expect(quantizeFixed(-0.1, options({ signedness: 'unsigned', rounding: 'floor', overflow: 'wrap' }))).toEqual({ stored: 255, value: 255 });
  });
  it('never scales very large finite float64 into Infinity before wrapping/saturating', () => {
    for (const value of [Number.MAX_VALUE, -Number.MAX_VALUE, 2 ** 1000, -(2 ** 1000)]) {
      expect(quantizeFixed(value, options({ wordLength: 32, fractionLength: 32, overflow: 'wrap' }))).toEqual({ stored: 0, value: 0 });
      const saturated = quantizeFixed(value, options({ wordLength: 32, fractionLength: 32, overflow: 'saturate' }));
      expect(saturated.stored).toBe(value < 0 ? -2147483648 : 2147483647); expect(Number.isFinite(saturated.value)).toBe(true);
      code(() => quantizeFixed(value, options({ wordLength: 32, fractionLength: 32 })), 'FIXED_POINT_OVERFLOW');
    }
    expect(quantizeFixed(Number.MAX_SAFE_INTEGER, options({ wordLength: 32, signedness: 'unsigned', overflow: 'wrap' }))).toEqual({ stored: 4294967295, value: 4294967295 });
    expect(quantizeFixed(Number.MAX_SAFE_INTEGER, options({ wordLength: 32, overflow: 'wrap' }))).toEqual({ stored: -1, value: -1 });
    expect(quantizeFixed(-Number.MAX_SAFE_INTEGER, options({ wordLength: 32, signedness: 'unsigned', overflow: 'wrap' }))).toEqual({ stored: 1, value: 1 });
  });
});

describe('M5 IEEE precision and independent rational coverage', () => {
  it('handles minimum subnormal and the normal/subnormal transition without underflowing the rounding decision', () => {
    for (const value of [Number.MIN_VALUE, 2 ** -1022 - Number.MIN_VALUE, 2 ** -1022]) {
      expect(quantizeFixed(value, options({ fractionLength: 32, rounding: 'ceil' }))).toEqual({ stored: 1, value: 2 ** -32 });
      expect(quantizeFixed(-value, options({ fractionLength: 32, rounding: 'floor' }))).toEqual({ stored: -1, value: -(2 ** -32) });
      expect(quantizeFixed(value, options({ fractionLength: 32 }))).toEqual({ stored: 0, value: 0 });
    }
  });
  it('distinguishes the binary64 values just below/above a half tie', () => {
    expect(quantizeFixed(0.5 - 2 ** -54, defaults).stored).toBe(0);
    expect(quantizeFixed(0.5 + 2 ** -53, defaults).stored).toBe(1);
    expect(quantizeFixed(1.5 - 2 ** -52, defaults).stored).toBe(1);
    expect(quantizeFixed(1.5 + 2 ** -52, defaults).stored).toBe(2);
    expect(quantizeFixed(-(0.5 + 2 ** -53), defaults).stored).toBe(-1);
  });
  it('matches independent rational rounding/wrap/saturation for every word length and rounding mode', () => {
    const mantissas = [-1073741823n, -65537n, -513n, -7n, -5n, -3n, -1n, 0n, 1n, 3n, 5n, 7n, 513n, 65537n, 1073741823n];
    const exponents = [-40, -32, -16, -3, -1, 0, 5, 20];
    for (let wordLength = 1; wordLength <= 32; wordLength++) for (const rounding of ['nearest-even', 'floor', 'ceil', 'toward-zero'] as const) for (const signedness of ['signed', 'unsigned'] as const) for (const overflow of ['saturate', 'wrap'] as const) {
      for (const fractionLength of [0, wordLength % 33, 32]) for (const exponent of exponents) for (const mantissa of mantissas) assertRational(mantissa, exponent, options({ wordLength, fractionLength, rounding, signedness, overflow }));
    }
  });
});

describe('M5 bounded untrusted quantization options', () => {
  it.each([
    { wordLength: 0 }, { wordLength: 33 }, { wordLength: 8.5 }, { wordLength: NaN }, { wordLength: '8' },
    { fractionLength: -1 }, { fractionLength: 33 }, { fractionLength: 0.5 }, { fractionLength: Infinity },
    { signedness: 'auto' }, { rounding: 'nearest' }, { overflow: 'ignore' }, { script: 'return value' },
  ])('rejects invalid settings %j', (changes) => {
    code(() => validateFixedQuantizationOptions({ ...defaults, ...changes }), 'INVALID_QUANTIZATION_OPTIONS');
  });
  it.each([NaN, Infinity, -Infinity, '2', null, new Number(2)])('rejects non-finite/non-scalar input %s', (value) => {
    code(() => quantizeFixed(value as number, defaults), 'FIXED_POINT_INPUT');
  });
  it('rejects missing fields, exotic prototypes, hooks, symbols and hidden attributes without invoking getters', () => {
    const missing: Partial<FixedQuantizationOptions> = { ...defaults }; delete missing.wordLength;
    for (const setting of [missing, Object.assign(new Date(), defaults), { ...defaults, toJSON: () => ({}) }, { ...defaults, [Symbol('hidden')]: 1 }]) code(() => validateFixedQuantizationOptions(setting), 'INVALID_QUANTIZATION_OPTIONS');
    const hidden = { ...defaults }; Object.defineProperty(hidden, 'overflow', { value: 'wrap', enumerable: false });
    code(() => validateFixedQuantizationOptions(hidden), 'INVALID_QUANTIZATION_OPTIONS');
    let invoked = false; const getter = { ...defaults }; Object.defineProperty(getter, 'rounding', { enumerable: true, get() { invoked = true; return 'floor'; } });
    code(() => validateFixedQuantizationOptions(getter), 'INVALID_QUANTIZATION_OPTIONS'); expect(invoked).toBe(false);
  });
  it('returns a defensive settings copy and permits ordinary null-prototype/frozen data', () => {
    const parsed = validateFixedQuantizationOptions(defaults); parsed.rounding = 'floor'; expect(defaults.rounding).toBe('nearest-even');
    expect(quantizeFixed(2, Object.freeze({ ...defaults }))).toEqual({ stored: 2, value: 2 });
    expect(quantizeFixed(2, Object.assign(Object.create(null) as FixedQuantizationOptions, defaults))).toEqual({ stored: 2, value: 2 });
  });
});
