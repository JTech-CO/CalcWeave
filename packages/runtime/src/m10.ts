import { ModelError, type IRNode, type LegacySignalValue, type SignalValue, type TypedCell, type TypedComplex, type TypedDataType, type TypedFloat, type TypedOverflow, type TypedRounding, type TypedSignal } from '../../model/src/types';
import { boundTypedInteger, cloneTypedSignal, complexFromParts, complexHermitian, complexIsHermitian, complexParts, decodeTypedFloat, encodeTypedFloat, fromLegacyTypedSignal, permuteTypedSignal, reshapeTypedSignal, squeezeTypedSignal, stripTypedSignal, toLegacyTypedSignal, typedBinary, typedCast, typedIntegerSpec, typedUnary, validateDataType, validateTypedSignal, type TypedCastOptions } from '../../model/src/typed';

const M10_RUNTIME_IDS = new Set(['source.typed', 'source.enum', 'signal.cast', 'signal.cast-inherited', 'signal.to-legacy', 'signal.type-duplicate', 'signal.type-propagation', 'signal.scaling-strip', 'signal.representation', 'signal.specification', 'signal.width', 'signal.bus-to-vector', 'signal.unit-system', 'logic.bit-mask', 'logic.extract-bits', 'logic.float-extract-bits', 'logic.integer-to-bits', 'logic.bits-to-integer', 'logic.shift-arithmetic', 'logic.bitwise-typed', 'fixed.integer-increment', 'fixed.trigonometric', 'fixed.state-space', 'complex.from-parts', 'complex.to-parts', 'complex.from-polar', 'complex.to-polar', 'complex.hermitian', 'complex.is-hermitian', 'complex.dot', 'typed.math', 'tensor.reshape', 'tensor.permute', 'tensor.squeeze']);
function m10Failure(node: IRNode, code: string, message: string): never { throw new ModelError([{ nodeId: node.id, code, message }]); }
function m10Typed(input: SignalValue): TypedSignal { return input !== null && typeof input === 'object' && !Array.isArray(input) ? validateTypedSignal(input) : fromLegacyTypedSignal(input as LegacySignalValue); }
function m10Copy(input: SignalValue): SignalValue { if (input !== null && typeof input === 'object' && !Array.isArray(input)) return cloneTypedSignal(input); if (!Array.isArray(input)) return input; return Array.isArray(input[0]) ? (input as number[][] | boolean[][]).map(row => [...row]) as number[][] | boolean[][] : [...input] as number[] | boolean[]; }
function m10Type(input: TypedSignal): TypedDataType { return validateDataType({ dtype: input.dtype, ...(input.fixed ? { fixed: input.fixed } : {}), ...(input.enum ? { enum: input.enum } : {}) }); }
function m10CastOptions(node: IRNode): TypedCastOptions { const p = node.parameters; return { rounding: (p.rounding === 'nearest-even' ? 'even' : p.rounding === 'toward-zero' ? 'zero' : p.rounding ?? 'even') as TypedRounding, overflow: (p.overflow ?? 'error') as TypedOverflow, mode: (p.mode === 'stored-integer' ? 'stored-integer' : 'real-world'), special: (p.special ?? 'error') as 'error' | 'preserve' }; }
function m10Output(type: TypedDataType, shape: number[], data: TypedCell[]): TypedSignal { return validateTypedSignal({ kind: 'typed', ...type, shape, data }); }
function m10Bits(code: string, width: number): bigint { return BigInt.asUintN(width, BigInt(code)); }
function m10Signed(bits: bigint, type: TypedDataType): string { const spec = typedIntegerSpec(type); return (spec.signed ? BigInt.asIntN(spec.wordLength, bits) : BigInt.asUintN(spec.wordLength, bits)).toString(); }
function m10NumericValues(input: SignalValue): { value: TypedSignal; data: number[] } { const value = typedCast(m10Typed(input), { dtype: 'float64' }, { special: 'error' }); return { value, data: value.data.map(cell => decodeTypedFloat(cell as TypedFloat)) }; }

/** All arithmetic follows compiler-owned metadata; arbitrary model text is never executed. */
export function evaluateM10Node(node: IRNode, input: (port: string) => SignalValue): Record<string, SignalValue> | undefined {
  if (!M10_RUNTIME_IDS.has(node.blockType) || node.blockType === 'fixed.state-space') return undefined;
  const p = node.parameters;
  const read = (port = 'in'): TypedSignal => m10Typed(input(port));
  const emit = (value: SignalValue): Record<string, SignalValue> => ({ out: value });
  try {
    switch (node.blockType) {
      case 'source.typed': case 'source.enum': return emit(validateTypedSignal(p.value));
      case 'signal.cast': return emit(typedCast(read(), validateDataType(p.source === 'propagated' ? p.propagatedTarget : p.target), m10CastOptions(node)));
      case 'signal.cast-inherited': return emit(typedCast(read(), validateDataType(node.outputs.out!.typed), m10CastOptions(node)));
      case 'signal.to-legacy': return emit(toLegacyTypedSignal(read()));
      case 'signal.type-duplicate': case 'signal.type-propagation': case 'signal.unit-system': return {};
      case 'signal.scaling-strip': return emit(stripTypedSignal(read()));
      case 'signal.representation': return emit(p.representation === 'virtual' ? input('in') : m10Copy(input('in')));
      case 'signal.specification': {
        const value = input('in');
        if (p.range === 'finite') {
          const signal = m10Typed(value), type = m10Type(signal), lower = m10ExactNumber(p.lower as number), upper = m10ExactNumber(p.upper as number);
          if (signal.data.some(cell => { const exact = m10Phase(cell, type); return exact.n * lower.d < lower.n * exact.d || exact.n * upper.d > upper.n * exact.d; })) m10Failure(node, 'SIGNAL_RANGE', '신호 값이 지정한 유한 실수 범위를 벗어났습니다.');
        }
        return emit(m10Copy(value));
      }
      case 'signal.width': return emit(read().data.length);
      case 'signal.bus-to-vector': return emit(m10Copy(input('in')));
      case 'logic.bit-mask': {
        const value = read(), type = m10Type(value), width = typedIntegerSpec(type).wordLength, mask = (p.bits as number[]).reduce((bits, position) => bits | 1n << BigInt(position), 0n);
        return emit(m10Output(type, value.shape, value.data.map(cell => m10Signed(p.operation === 'set' ? m10Bits(cell as string, width) | mask : m10Bits(cell as string, width) & ~mask, type))));
      }
      case 'logic.extract-bits': {
        const value = read(), low = p.low as number, high = p.high as number, mask = (1n << BigInt(high - low + 1)) - 1n, width = typedIntegerSpec(m10Type(value)).wordLength;
        return emit(m10Output(node.outputs.out!.typed!, value.shape, value.data.map(cell => ((m10Bits(cell as string, width) >> BigInt(low)) & mask).toString())));
      }
      case 'logic.float-extract-bits': {
        const value = read(), single = value.dtype === 'float32', width = single ? 32 : 64, fraction = single ? 23 : 52, exponent = single ? 8 : 11;
        return emit(m10Output(node.outputs.out!.typed!, value.shape, value.data.map(cell => {
          const number = decodeTypedFloat(cell as TypedFloat), view = new DataView(new ArrayBuffer(8));
          let bits: bigint;
          // The NaN tag carries no payload; its canonical wire bit pattern is positive quiet NaN.
          if (Number.isNaN(number)) bits = single ? 0x7fc00000n : 0x7ff8000000000000n;
          else if (single) { view.setFloat32(0, number, false); bits = BigInt(view.getUint32(0, false)); }
          else { view.setFloat64(0, number, false); bits = view.getBigUint64(0, false); }
          const result = p.part === 'sign' ? bits >> BigInt(width - 1) : p.part === 'exponent' ? bits >> BigInt(fraction) & (1n << BigInt(exponent)) - 1n : p.part === 'fraction' ? bits & (1n << BigInt(fraction)) - 1n : bits;
          return result.toString();
        })));
      }
      case 'logic.integer-to-bits': {
        const value = read(), type = m10Type(value), width = p.width as number, spec = typedIntegerSpec(type), number = BigInt(value.data[0] as string), modulus = 1n << BigInt(width);
        const minimum = spec.signed ? -(modulus >> 1n) : 0n, maximum = spec.signed ? (modulus >> 1n) - 1n : modulus - 1n;
        if (number < minimum || number > maximum) m10Failure(node, 'TYPED_BIT_RANGE', '값을 요청한 비트 폭으로 정확히 표현할 수 없습니다.');
        const bits = BigInt.asUintN(width, number), data = Array.from({ length: width }, (_, index) => (bits >> BigInt(p.order === 'lsb-first' ? index : width - 1 - index) & 1n) !== 0n);
        return emit(m10Output({ dtype: 'boolean' }, [width], data));
      }
      case 'logic.bits-to-integer': {
        const value = read(), type = validateDataType(p.target), spec = typedIntegerSpec(type), width = value.data.length;
        let bits = 0n; for (let index = 0; index < width; index++) if (value.data[index]) bits |= 1n << BigInt(p.order === 'lsb-first' ? index : width - 1 - index);
        const number = spec.signed ? BigInt.asIntN(width, bits) : bits;
        return emit(m10Output(type, [], [boundTypedInteger(number, type)]));
      }
      case 'logic.shift-arithmetic': {
        const value = read(), shift = p.shift as number;
        if (p.mode === 'binary-point') return emit(m10Output(node.outputs.out!.typed!, value.shape, value.data));
        const type = m10Type(value);
        return emit(m10Output(type, value.shape, value.data.map(cell => { const number = BigInt(cell as string); return boundTypedInteger(shift >= 0 ? number >> BigInt(shift) : number << BigInt(-shift), type, p.overflow as TypedOverflow); })));
      }
      case 'logic.bitwise-typed': {
        const a = read('a'), b = p.operation === 'not' ? undefined : read('b'), type = m10Type(a), width = typedIntegerSpec(type).wordLength, shape = a.shape.length ? a.shape : b?.shape ?? [], count = shape.reduce((product, axis) => product * axis, 1);
        const data = Array.from({ length: count }, (_, index) => { const x = m10Bits(a.data[a.shape.length ? index : 0] as string, width), y = b ? m10Bits(b.data[b.shape.length ? index : 0] as string, width) : 0n; const result = p.operation === 'not' ? ~x : p.operation === 'and' ? x & y : p.operation === 'or' ? x | y : x ^ y; return m10Signed(result, type); });
        return emit(m10Output(type, shape, data));
      }
      case 'fixed.integer-increment': { const value = read(), type = m10Type(value); return emit(m10Output(type, value.shape, value.data.map(cell => boundTypedInteger(BigInt(cell as string) + BigInt(p.delta as number), type, p.overflow as TypedOverflow)))); }
      case 'fixed.trigonometric': return emit(m10FixedTrigonometric(node, read()));
      case 'complex.from-parts': return emit(complexFromParts(read('real'), read('imag')));
      case 'complex.to-parts': { const parts = complexParts(read()); return { real: parts.re, imag: parts.im }; }
      case 'complex.from-polar': {
        const magnitude = m10NumericValues(input('magnitude')), angle = m10NumericValues(input('angle')), shape = magnitude.value.shape.length ? magnitude.value.shape : angle.value.shape, count = shape.reduce((product, axis) => product * axis, 1);
        const data = Array.from({ length: count }, (_, index): TypedComplex => { const r = magnitude.data[magnitude.value.shape.length ? index : 0]!, theta = angle.data[angle.value.shape.length ? index : 0]!; if (r < 0) m10Failure(node, 'TYPED_COMPLEX_MAGNITUDE', '복소수 크기는 유한한 비음수여야 합니다.'); return { re: encodeTypedFloat(r * Math.cos(theta)), im: encodeTypedFloat(r * Math.sin(theta)) }; });
        return emit(m10Output({ dtype: 'complex128' }, shape, data));
      }
      case 'complex.to-polar': { const value = read(); return { magnitude: typedUnary(value, 'abs', { special: 'error' }), angle: typedUnary(value, 'angle', { special: 'error' }) }; }
      case 'complex.hermitian': return emit(complexHermitian(read()));
      case 'complex.is-hermitian': return emit(m10Output({ dtype: 'boolean' }, [], [complexIsHermitian(read(), p.tolerance as number)]));
      case 'complex.dot': {
        const a = read('a'), b = read('b'), type = { dtype: 'complex128' } as const;
        let sum = m10Output(type, [], [{ re: 0, im: 0 }]);
        for (let index = 0; index < a.data.length; index++) { let first = m10Output(type, [], [a.data[index]!]); if (p.conjugateFirst !== 'no') first = typedUnary(first, 'conjugate', { special: 'error' }); const product = typedBinary(first, m10Output(type, [], [b.data[index]!]), 'multiply', { special: 'error' }); sum = typedBinary(sum, product, 'add', { special: 'error' }); }
        return emit(sum);
      }
      case 'typed.math': return emit(typedBinary(read('a'), read('b'), p.operation as Parameters<typeof typedBinary>[2], m10CastOptions(node)));
      case 'tensor.reshape': return emit(reshapeTypedSignal(read(), p.dimensions as number[]));
      case 'tensor.permute': return emit(permuteTypedSignal(read(), p.order as number[]));
      case 'tensor.squeeze': return emit(squeezeTypedSignal(read()));
    }
  } catch (error) { if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: node.id }))); throw error; }
  return undefined;
}

export function m10OperationCost(node: IRNode, inputSize: number, outputSize: number): number | undefined {
  if (!M10_RUNTIME_IDS.has(node.blockType)) return undefined;
  const count = Object.values(node.outputs).reduce((sum, descriptor) => sum + descriptor.shape.reduce((size, axis) => size * axis, 1), 0);
  if (node.blockType === 'fixed.state-space') { const A = node.parameters.A as TypedSignal, B = node.parameters.B as TypedSignal, C = node.parameters.C as TypedSignal, D = node.parameters.D as TypedSignal; return 160 * (A.data.length + B.data.length + C.data.length + D.data.length) + inputSize + outputSize; }
  if (node.blockType === 'fixed.trigonometric') return 1_100 * (node.parameters.points as number) + 2_300 * Math.max(1, count) + inputSize + outputSize;
  if (node.blockType === 'complex.dot') return 64 * Math.max(1, inputSize) + outputSize;
  if (['signal.cast', 'signal.cast-inherited', 'signal.to-legacy', 'typed.math'].includes(node.blockType)) return 2_300 * Math.max(1, count) + inputSize + outputSize;
  return 128 * Math.max(1, count) + inputSize + outputSize;
}

export interface M10Memory { value: TypedSignal }
function m10StateAction<T>(node: IRNode, action: () => T): T { try { return action(); } catch (error) { if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: node.id }))); throw error; } }
export function m10InitialMemory(node: IRNode): M10Memory { return m10StateAction(node, () => ({ value: validateTypedSignal(node.parameters.initial) })); }
export function m10IndependentOutput(node: IRNode): boolean { return node.blockType === 'fixed.state-space' && (node.parameters.D as TypedSignal).data.every(cell => cell === '0'); }
function m10StateMatrixProduct(node: IRNode, matrix: TypedSignal, vector: TypedSignal): TypedSignal {
  const type = m10Type(vector), columns = matrix.shape[1]!, rows = matrix.shape[0]!, options = m10CastOptions(node), data: TypedCell[] = [];
  for (let row = 0; row < rows; row++) {
    let sum = m10Output(type, [], ['0']);
    for (let column = 0; column < columns; column++) {
      const coefficient = matrix.data[row * columns + column] as string; if (coefficient === '0') continue;
      const product = typedBinary(m10Output(type, [], [coefficient]), m10Output(type, [], [vector.data[column]!]), 'multiply', options);
      sum = typedBinary(sum, product, 'add', options);
    }
    data.push(sum.data[0]!);
  }
  return m10Output(type, [rows], data);
}
export function m10ReadState(node: IRNode, memory: M10Memory, input: (port: string) => SignalValue): { out: TypedSignal } {
  return m10StateAction(node, () => {
  const state = cloneTypedSignal(memory.value), C = validateTypedSignal(node.parameters.C), result = m10StateMatrixProduct(node, C, state);
  if (m10IndependentOutput(node)) return { out: result };
  const D = validateTypedSignal(node.parameters.D), feedthrough = m10StateMatrixProduct(node, D, m10Typed(input('in')));
  return { out: typedBinary(result, feedthrough, 'add', m10CastOptions(node)) };
  });
}
/** Startup held output excludes D*u because no due input has been published yet. */
export function m10InitialOutput(node: IRNode, memory: M10Memory): { out: TypedSignal } { return m10StateAction(node, () => ({ out: m10StateMatrixProduct(node, validateTypedSignal(node.parameters.C), cloneTypedSignal(memory.value)) })); }
export function m10CommitState(node: IRNode, memory: M10Memory, input: (port: string) => SignalValue): M10Memory {
  return m10StateAction(node, () => {
  const state = cloneTypedSignal(memory.value), A = validateTypedSignal(node.parameters.A), B = validateTypedSignal(node.parameters.B), previous = m10StateMatrixProduct(node, A, state), incoming = m10StateMatrixProduct(node, B, m10Typed(input('in')));
  return { value: typedBinary(previous, incoming, 'add', m10CastOptions(node)) };
  });
}

interface M10Rational { n: bigint; d: bigint }
function m10ExactNumber(number: number): M10Rational {
  if (!Number.isFinite(number)) throw new ModelError([{ code: 'TYPED_NONFINITE_CAST', message: 'LUT 위상은 유한해야 합니다.' }]);
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, number, false); const bits = view.getBigUint64(0, false), exp = Number(bits >> 52n & 0x7ffn), fraction = bits & ((1n << 52n) - 1n), magnitude = exp ? (1n << 52n) | fraction : fraction, exponent = exp ? exp - 1075 : -1074, n = bits >> 63n ? -magnitude : magnitude;
  return exponent >= 0 ? { n: n << BigInt(exponent), d: 1n } : { n, d: 1n << BigInt(-exponent) };
}
function m10Phase(cell: TypedCell, type: TypedDataType): M10Rational {
  if (type.dtype === 'fixed') { const n = BigInt(cell as string), fraction = type.fixed!.fractionLength; return fraction >= 0 ? { n, d: 1n << BigInt(fraction) } : { n: n << BigInt(-fraction), d: 1n }; }
  if (type.dtype.startsWith('int') || type.dtype.startsWith('uint')) return { n: BigInt(cell as string), d: 1n };
  return m10ExactNumber(decodeTypedFloat(cell as TypedFloat));
}
function m10RoundRatio(n: bigint, d: bigint, rounding: TypedRounding): bigint {
  let quotient = n / d, remainder = n % d;
  if (rounding === 'floor' && remainder < 0n) return quotient - 1n;
  if (rounding === 'ceil' && remainder > 0n) return quotient + 1n;
  if (['nearest', 'away', 'even'].includes(rounding)) { const absolute = remainder < 0n ? -remainder : remainder, twice = absolute * 2n; if (twice > d || twice === d && (rounding === 'away' || rounding === 'nearest' && remainder > 0n || rounding === 'even' && quotient % 2n !== 0n)) quotient += remainder < 0n ? -1n : 1n; }
  return quotient;
}
/** Independently configured quarter-wave LUT; source vendor table bit patterns are not claimed. */
function m10FixedTrigonometric(node: IRNode, input: TypedSignal): TypedSignal {
  const p = node.parameters, wordLength = p.wordLength as number, points = p.points as number, outputType = node.outputs.out!.typed!, sourceType = m10Type(input), options = m10CastOptions(node), scale = 2 ** (wordLength - 2);
  // Rebuild bounded local tables for each evaluation; no shared mutable cache or run leakage.
  const table = Array.from({ length: points }, (_, index) => BigInt(typedCast(fromLegacyTypedSignal(index === 0 ? 0 : index === points - 1 ? 1 : Math.sin(Math.PI / 2 * index / (points - 1))), outputType, options).data[0] as string));
  if (table[points - 1] !== BigInt(scale)) m10Failure(node, 'TYPED_LUT_TABLE', 'quarter-wave 경계가 출력 스케일과 다릅니다.');
  const data = input.data.map(cell => {
    const phase = m10Phase(cell, sourceType); let n = phase.n, d = phase.d;
    if (p.operation === 'cos') { n = 4n * n + d; d *= 4n; }
    const turn = ((n % d) + d) % d, quadrant = Number(turn * 4n / d), position = turn * 4n - BigInt(quadrant) * d;
    const mirrored = quadrant % 2 ? d - position : position, scaled = mirrored * BigInt(points - 1), index = Number(scaled / d), remainder = scaled % d;
    const low = table[index]!, high = table[Math.min(points - 1, index + 1)]!, sign = quadrant >= 2 ? -1n : 1n;
    return boundTypedInteger(m10RoundRatio(sign * (low * d + (high - low) * remainder), d, options.rounding!), outputType, options.overflow);
  });
  return m10Output(outputType, input.shape, data);
}
