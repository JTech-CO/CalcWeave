import { ModelError } from '../../model/src/types';

export interface FixedQuantizationOptions {
  wordLength: number;
  fractionLength: number;
  signedness: 'signed' | 'unsigned';
  rounding: 'nearest-even' | 'floor' | 'ceil' | 'toward-zero';
  overflow: 'saturate' | 'wrap' | 'error';
}
export interface QuantizedFixed { value: number; stored: number }

function quantizationFailure(code: string, message: string): never { throw new ModelError([{ code, message }]); }

/** Validate before reading fields: no hooks, accessors, prototype objects, or ignored options. */
export function validateFixedQuantizationOptions(input: unknown): FixedQuantizationOptions {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    quantizationFailure('INVALID_QUANTIZATION_OPTIONS', '고정소수점 설정은 일반 객체여야 합니다.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ['wordLength', 'fractionLength', 'signedness', 'rounding', 'overflow'];
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key)
    || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)
    || fields.some((key) => !Object.hasOwn(descriptors, key))) {
    quantizationFailure('INVALID_QUANTIZATION_OPTIONS', '고정소수점 설정의 필드·접근자·숨김 속성을 확인하세요.');
  }
  const wordLength = descriptors.wordLength!.value as unknown;
  const fractionLength = descriptors.fractionLength!.value as unknown;
  const signedness = descriptors.signedness!.value as unknown;
  const rounding = descriptors.rounding!.value as unknown;
  const overflow = descriptors.overflow!.value as unknown;
  if (typeof wordLength !== 'number' || !Number.isInteger(wordLength) || wordLength < 1 || wordLength > 32
    || typeof fractionLength !== 'number' || !Number.isInteger(fractionLength) || fractionLength < 0 || fractionLength > 32
    || (signedness !== 'signed' && signedness !== 'unsigned')
    || (rounding !== 'nearest-even' && rounding !== 'floor' && rounding !== 'ceil' && rounding !== 'toward-zero')
    || (overflow !== 'saturate' && overflow !== 'wrap' && overflow !== 'error')) {
    quantizationFailure('INVALID_QUANTIZATION_OPTIONS', 'wordLength 1~32, fractionLength 0~32와 승인한 부호·반올림·overflow 방식을 사용하세요.');
  }
  return { wordLength, fractionLength, signedness, rounding, overflow };
}

/**
 * Quantize the exact IEEE-754 input rational, then bound the rounded integer code.
 * BigInt shifts are bounded by binary64 exponents (at most 1,074 bits), never user text.
 * This is one boundary quantizer; subsequent arithmetic remains ordinary float64.
 */
export function quantizeFixed(value: number, inputOptions: FixedQuantizationOptions): QuantizedFixed {
  const options = validateFixedQuantizationOptions(inputOptions);
  if (typeof value !== 'number' || !Number.isFinite(value)) quantizationFailure('FIXED_POINT_INPUT', '고정소수점 입력은 유한한 float64여야 합니다.');
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false), negative = (bits >> 63n) !== 0n;
  const encodedExponent = Number((bits >> 52n) & 0x7ffn), fraction = bits & ((1n << 52n) - 1n);
  const significand = encodedExponent === 0 ? fraction : (1n << 52n) | fraction;
  const exponent = (encodedExponent === 0 ? -1074 : encodedExponent - 1075) + options.fractionLength;
  let magnitude: bigint;
  if (exponent >= 0) magnitude = significand << BigInt(exponent);
  else {
    const shift = BigInt(-exponent), denominator = 1n << shift;
    magnitude = significand >> shift;
    const remainder = significand - (magnitude << shift);
    if (remainder !== 0n) {
      if (options.rounding === 'nearest-even') {
        const twice = remainder << 1n;
        if (twice > denominator || (twice === denominator && (magnitude & 1n) !== 0n)) magnitude += 1n;
      } else if (options.rounding === 'floor' && negative || options.rounding === 'ceil' && !negative) magnitude += 1n;
    }
  }
  let stored = negative ? -magnitude : magnitude;
  const modulus = 1n << BigInt(options.wordLength);
  const signBoundary = modulus >> 1n;
  const minimum = options.signedness === 'signed' ? -signBoundary : 0n;
  const maximum = options.signedness === 'signed' ? signBoundary - 1n : modulus - 1n;
  if (stored < minimum || stored > maximum) {
    if (options.overflow === 'error') quantizationFailure('FIXED_POINT_OVERFLOW', '반올림한 고정소수점 값이 지정한 정수 코드 범위를 벗어났습니다.');
    if (options.overflow === 'saturate') stored = stored < minimum ? minimum : maximum;
    else {
      stored = ((stored % modulus) + modulus) % modulus;
      if (options.signedness === 'signed' && stored >= signBoundary) stored -= modulus;
    }
  }
  const storedNumber = Number(stored);
  // Every stored code is exactly representable in binary64; division by a power of two is exact.
  return { value: storedNumber / (2 ** options.fractionLength), stored: storedNumber };
}
