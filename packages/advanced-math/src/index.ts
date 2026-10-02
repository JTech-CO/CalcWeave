import { ModelError } from '../../model/src';

export const ADVANCED_MATH_LIMITS = Object.freeze({ maxAxis: 32, maxElements: 1_024, minBreakpoints: 2, maxBreakpoints: 32, pivotEpsilonMultiplier: 32 });
export type NumericMatrix = number[][];
export type LookupExtrapolation = 'clip' | 'linear' | 'error';
export interface Lookup2DOptions { rowBreakpoints: number[]; columnBreakpoints: number[]; table: NumericMatrix; interpolation: 'linear' | 'nearest' | 'previous'; extrapolation: LookupExtrapolation }
export interface PrelookupResult { index: number; fraction: number }
export interface LUResult { lower: NumericMatrix; upper: NumericMatrix; permutation: number[] }

function advancedFail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
function advancedFinite(value: number): number {
  if (!Number.isFinite(value)) advancedFail('MATRIX_NUMERIC_NONFINITE', '계산 결과가 유한한 float64 범위를 초과했습니다.');
  return value;
}

function advancedDenseArray(input: unknown, min: number, max: number, code: string): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < min || input.length > max) advancedFail(code, `길이 ${min}~${max}의 일반 배열이 필요합니다.`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) advancedFail(code, '배열에는 빈 칸이나 추가 필드를 사용할 수 없습니다.');
  const result: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) advancedFail(code, '배열에는 빈 칸·접근자·숨김 항목을 사용할 수 없습니다.');
    result.push(descriptor.value);
  }
  return result;
}

/** Return a defensive dense finite real matrix, with independently bounded axes. */
export function validateMatrix(input: unknown): NumericMatrix {
  const rows = advancedDenseArray(input, 1, ADVANCED_MATH_LIMITS.maxAxis, 'INVALID_MATRIX');
  let columns = 0;
  return rows.map(row => {
    const values = advancedDenseArray(row, 1, ADVANCED_MATH_LIMITS.maxAxis, 'INVALID_MATRIX');
    if (columns && columns !== values.length) advancedFail('INVALID_MATRIX', '행렬의 모든 행은 같은 길이여야 합니다.');
    columns = values.length;
    return values.map(value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) advancedFail('INVALID_MATRIX', '행렬 원소는 유한한 실수 float64여야 합니다.');
      return value;
    });
  });
}

export function validateBreakpoints(input: unknown): number[] {
  const values = advancedDenseArray(input, ADVANCED_MATH_LIMITS.minBreakpoints, ADVANCED_MATH_LIMITS.maxBreakpoints, 'INVALID_BREAKPOINTS');
  const points: number[] = [];
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (points.length && value <= points.at(-1)!)) advancedFail('INVALID_BREAKPOINTS', 'breakpoint는 유한한 숫자 2~32개이며 엄격하게 증가해야 합니다.');
    points.push(value);
  }
  return points;
}

export function validateLookup2DOptions(input: unknown): Lookup2DOptions {
  if (input === null || typeof input !== 'object' || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) advancedFail('INVALID_LOOKUP_2D', '2D lookup 설정은 일반 객체여야 합니다.');
  const properties = Object.getOwnPropertyDescriptors(input);
  const keys = ['rowBreakpoints', 'columnBreakpoints', 'table', 'interpolation', 'extrapolation'];
  if (Reflect.ownKeys(properties).length !== keys.length || Reflect.ownKeys(properties).some(key => typeof key !== 'string' || !keys.includes(key) || !('value' in properties[key]!) || !properties[key]!.enumerable)) advancedFail('INVALID_LOOKUP_2D', '2D lookup에는 명시적인 breakpoint·table·보간·범위 밖 옵션만 사용할 수 있습니다.');
  const rowBreakpoints = validateBreakpoints(properties.rowBreakpoints!.value), columnBreakpoints = validateBreakpoints(properties.columnBreakpoints!.value);
  const table = validateMatrix(properties.table!.value);
  if (table.length !== rowBreakpoints.length || table[0]!.length !== columnBreakpoints.length) advancedFail('LOOKUP_TABLE_SHAPE', '2D table의 행/열은 각 breakpoint 개수와 같아야 합니다.');
  const interpolation = properties.interpolation!.value, extrapolation = properties.extrapolation!.value;
  if (!['linear', 'nearest', 'previous'].includes(interpolation) || !['clip', 'linear', 'error'].includes(extrapolation) || (extrapolation === 'linear' && interpolation !== 'linear')) advancedFail('INVALID_LOOKUP_2D', '선형 외삽은 linear 보간에서만 사용할 수 있습니다.');
  return { rowBreakpoints, columnBreakpoints, table, interpolation, extrapolation };
}

function advancedCompensatedSum(values: readonly number[]): number {
  let sum = 0, correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return advancedFinite(sum + correction);
}

interface AdvancedScaledNumber { mantissa: number; exponent: number }
function advancedScaledNumber(value: number): AdvancedScaledNumber {
  if (value === 0) return { mantissa: 0, exponent: 0 };
  const exponent = Math.min(1_023, Math.floor(Math.log2(Math.abs(value))));
  return { mantissa: value / 2 ** exponent, exponent };
}
function advancedNormalizeScaled(value: AdvancedScaledNumber): AdvancedScaledNumber {
  if (value.mantissa === 0) return { mantissa: 0, exponent: 0 };
  const part = advancedScaledNumber(value.mantissa);
  return { mantissa: part.mantissa, exponent: value.exponent + part.exponent };
}
function advancedScaledFactors(factors: readonly number[], denominators: readonly number[] = []): AdvancedScaledNumber {
  let value: AdvancedScaledNumber = { mantissa: 1, exponent: 0 };
  for (const factor of factors) {
    if (factor === 0) return { mantissa: 0, exponent: 0 };
    const part = advancedScaledNumber(factor);
    value = advancedNormalizeScaled({ mantissa: value.mantissa * part.mantissa, exponent: value.exponent + part.exponent });
  }
  for (const divisor of denominators) {
    const part = advancedScaledNumber(divisor);
    value = advancedNormalizeScaled({ mantissa: value.mantissa / part.mantissa, exponent: value.exponent - part.exponent });
  }
  return value;
}
function advancedMaterializeScaled(input: AdvancedScaledNumber): number {
  const value = advancedNormalizeScaled(input);
  if (value.mantissa === 0) return 0;
  if (value.exponent > 1_023) advancedFail('MATRIX_NUMERIC_NONFINITE', '계산 결과가 유한한 float64 범위를 초과했습니다.');
  if (value.exponent < -1_074) advancedFail('MATRIX_NUMERIC_UNDERFLOW', '0이 아닌 계산 결과가 float64 최소 표현 범위보다 작습니다.');
  const result = advancedFinite(value.mantissa * 2 ** value.exponent);
  if (result === 0) advancedFail('MATRIX_NUMERIC_UNDERFLOW', '0이 아닌 계산 결과가 float64 최소 표현 범위보다 작습니다.');
  return result;
}
function advancedScaledProduct(factors: readonly number[], denominators: readonly number[] = []): number { return advancedMaterializeScaled(advancedScaledFactors(factors, denominators)); }

/** Group product exponents so large cancelling terms need not overflow before summation. */
function advancedScaledDot(terms: readonly (readonly number[])[]): number {
  const groups = new Map<number, number[]>();
  for (const factors of terms) {
    const part = advancedScaledFactors(factors);
    if (part.mantissa === 0) continue;
    const group = groups.get(part.exponent) ?? [];
    group.push(part.mantissa); groups.set(part.exponent, group);
  }
  let total: AdvancedScaledNumber = { mantissa: 0, exponent: 0 };
  for (const exponent of [...groups.keys()].sort((a, b) => b - a)) {
    const mantissa = advancedCompensatedSum(groups.get(exponent)!);
    if (mantissa === 0) continue;
    const term = advancedNormalizeScaled({ mantissa, exponent });
    if (total.mantissa === 0) { total = term; continue; }
    const scale = Math.max(total.exponent, term.exponent);
    total = advancedNormalizeScaled({ mantissa: advancedCompensatedSum([total.mantissa * 2 ** (total.exponent - scale), term.mantissa * 2 ** (term.exponent - scale)]), exponent: scale });
  }
  return advancedMaterializeScaled(total);
}

export function matrixMultiply(a: NumericMatrix, b: NumericMatrix): NumericMatrix {
  const left = validateMatrix(a), right = validateMatrix(b);
  if (left[0]!.length !== right.length) advancedFail('MATRIX_DIMENSION_MISMATCH', '행렬 곱의 왼쪽 열 수와 오른쪽 행 수가 같아야 합니다.');
  return left.map(row => right[0]!.map((_, column) => advancedScaledDot(row.map((value, index) => [value, right[index]![column]!]))));
}
export function transpose(a: NumericMatrix): NumericMatrix { const matrix = validateMatrix(a); return matrix[0]!.map((_, column) => matrix.map(row => row[column]!)); }

function advancedSquare(a: NumericMatrix): NumericMatrix { const matrix = validateMatrix(a); if (matrix.length !== matrix[0]!.length) advancedFail('MATRIX_NOT_SQUARE', '이 연산에는 정사각 행렬이 필요합니다.'); return matrix; }
function advancedInfinityNorm(a: NumericMatrix): number { return Math.max(...a.map(row => advancedCompensatedSum(row.map(Math.abs)))); }
interface AdvancedLUFactors { lower: NumericMatrix; upper: NumericMatrix; permutation: number[]; scale: number; sign: number; norm: number; singular: boolean }
function advancedFactorize(a: NumericMatrix, allowSingular = false): AdvancedLUFactors {
  const size = a.length, scale = Math.max(...a.flat().map(Math.abs));
  const lower: NumericMatrix = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => row === column ? 1 : 0));
  const permutation = Array.from({ length: size }, (_, index) => index);
  if (scale === 0) {
    if (!allowSingular) advancedFail('MATRIX_SINGULAR', '행렬이 특이하여 역행렬 또는 유일한 해를 구할 수 없습니다.');
    return { lower, upper: a.map(row => [...row]), permutation, scale, sign: 1, norm: 0, singular: true };
  }
  const upper = a.map(row => row.map(value => {
    const normalized = value / scale;
    if (value !== 0 && normalized === 0) advancedFail('MATRIX_ILL_CONDITIONED', '행렬 원소의 척도 차이가 너무 커 안정적으로 계산할 수 없습니다.');
    return normalized;
  }));
  const norm = advancedInfinityNorm(upper), tolerance = ADVANCED_MATH_LIMITS.pivotEpsilonMultiplier * size * Number.EPSILON * norm;
  let sign = 1;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(upper[row]![column]!) > Math.abs(upper[pivot]![column]!)) pivot = row;
    const pivotValue = Math.abs(upper[pivot]![column]!);
    if (pivotValue === 0) {
      if (!allowSingular) advancedFail('MATRIX_SINGULAR', '행렬이 특이하여 역행렬 또는 유일한 해를 구할 수 없습니다.');
      return { lower, upper, permutation, scale, sign, norm, singular: true };
    }
    if (pivotValue <= tolerance) advancedFail('MATRIX_ILL_CONDITIONED', '행렬 pivot가 척도 상대 허용오차보다 작습니다. 행렬의 조건을 개선해 주세요.');
    if (pivot !== column) {
      [upper[column], upper[pivot]] = [upper[pivot]!, upper[column]!];
      [permutation[column], permutation[pivot]] = [permutation[pivot]!, permutation[column]!];
      for (let previous = 0; previous < column; previous += 1) [lower[column]![previous], lower[pivot]![previous]] = [lower[pivot]![previous]!, lower[column]![previous]!];
      sign = -sign;
    }
    for (let row = column + 1; row < size; row += 1) {
      const multiplier = upper[row]![column]! / upper[column]![column]!;
      lower[row]![column] = multiplier; upper[row]![column] = 0;
      for (let following = column + 1; following < size; following += 1) upper[row]![following] = advancedFinite(upper[row]![following]! - multiplier * upper[column]![following]!);
    }
  }
  return { lower, upper, permutation, scale, sign, norm, singular: false };
}
function advancedIdentity(size: number): NumericMatrix { return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => row === column ? 1 : 0)); }
function advancedSolveFactors(factors: AdvancedLUFactors, rhs: NumericMatrix): NumericMatrix {
  const { lower, upper, permutation } = factors, size = upper.length, columns = rhs[0]!.length;
  const result = permutation.map(row => [...rhs[row]!]);
  for (let row = 0; row < size; row += 1) for (let column = 0; column < columns; column += 1) result[row]![column] = advancedFinite(result[row]![column]! - advancedCompensatedSum(Array.from({ length: row }, (_, k) => lower[row]![k]! * result[k]![column]!)));
  for (let row = size - 1; row >= 0; row -= 1) for (let column = 0; column < columns; column += 1) result[row]![column] = advancedFinite((result[row]![column]! - advancedCompensatedSum(Array.from({ length: size - row - 1 }, (_, k) => upper[row]![row + k + 1]! * result[row + k + 1]![column]!))) / upper[row]![row]!);
  return result;
}
function advancedConditionedInverse(factors: AdvancedLUFactors): NumericMatrix {
  const inverse = advancedSolveFactors(factors, advancedIdentity(factors.upper.length));
  const condition = factors.norm * advancedInfinityNorm(inverse);
  const limit = 1 / (ADVANCED_MATH_LIMITS.pivotEpsilonMultiplier * factors.upper.length * Number.EPSILON);
  if (!Number.isFinite(condition) || condition > limit) advancedFail('MATRIX_ILL_CONDITIONED', '행렬의 추정 infinity 조건수가 승인 안정성 범위를 초과했습니다.');
  return inverse;
}

export function determinant(a: NumericMatrix): number {
  const factors = advancedFactorize(advancedSquare(a), true);
  if (factors.singular) return 0;
  return advancedScaledProduct([factors.sign, ...factors.upper.map((row, index) => row[index]!), ...Array.from({ length: factors.upper.length }, () => factors.scale)]);
}
export function inverse(a: NumericMatrix): NumericMatrix {
  const factors = advancedFactorize(advancedSquare(a)), result = advancedConditionedInverse(factors);
  return result.map(row => row.map(value => advancedScaledProduct([value], [factors.scale])));
}
export function solve(a: NumericMatrix, b: NumericMatrix): NumericMatrix {
  const matrix = advancedSquare(a), rhs = validateMatrix(b);
  if (rhs.length !== matrix.length) advancedFail('MATRIX_DIMENSION_MISMATCH', '우변 행 수는 정사각 계수 행렬의 행 수와 같아야 합니다.');
  const factors = advancedFactorize(matrix); advancedConditionedInverse(factors);
  const scales = rhs[0]!.map((_, column) => Math.max(...rhs.map(row => Math.abs(row[column]!))));
  const normalized = rhs.map(row => row.map((value, column) => {
    if (scales[column] === 0) return 0;
    const result = value / scales[column]!;
    if (value !== 0 && Math.abs(result) < 2 ** -1_022) advancedFail('MATRIX_NUMERIC_UNDERFLOW', '같은 우변 열 안의 척도 차이가 너무 커 0 아닌 입력의 유효자리를 보존할 수 없습니다.');
    return result;
  }));
  return advancedSolveFactors(factors, normalized).map(row => row.map((value, column) => advancedScaledProduct([value, scales[column]!], [factors.scale])));
}
export function lu(a: NumericMatrix): LUResult {
  const factors = advancedFactorize(advancedSquare(a)); advancedConditionedInverse(factors);
  return { lower: factors.lower.map(row => [...row]), upper: factors.upper.map(row => row.map(value => advancedScaledProduct([value, factors.scale]))), permutation: [...factors.permutation] };
}
export function cholesky(a: NumericMatrix): NumericMatrix {
  const matrix = advancedSquare(a), size = matrix.length, scale = Math.max(...matrix.flat().map(Math.abs));
  if (scale === 0) advancedFail('MATRIX_NOT_POSITIVE_DEFINITE', 'Cholesky에는 대칭 양의 정부호 행렬이 필요합니다.');
  const normalized = matrix.map(row => row.map(value => {
    const result = value / scale;
    if (value !== 0 && result === 0) advancedFail('MATRIX_ILL_CONDITIONED', '행렬 원소의 척도 차이가 너무 큽니다.');
    return result;
  }));
  const tolerance = ADVANCED_MATH_LIMITS.pivotEpsilonMultiplier * size * Number.EPSILON * advancedInfinityNorm(normalized);
  for (let row = 0; row < size; row += 1) for (let column = 0; column < row; column += 1) if (Math.abs(normalized[row]![column]! - normalized[column]![row]!) > tolerance) advancedFail('MATRIX_NOT_SYMMETRIC', 'Cholesky 입력은 척도 상대 허용오차 이내의 대칭 행렬이어야 합니다.');
  const lower = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      const residual = normalized[row]![column]! - advancedCompensatedSum(Array.from({ length: column }, (_, k) => lower[row]![k]! * lower[column]![k]!));
      if (row === column) {
        if (residual <= 0) advancedFail('MATRIX_NOT_POSITIVE_DEFINITE', 'Cholesky에는 양의 정부호 행렬이 필요합니다.');
        if (residual <= tolerance) advancedFail('MATRIX_ILL_CONDITIONED', 'Cholesky pivot가 척도 상대 허용오차보다 작습니다.');
        lower[row]![column] = Math.sqrt(residual);
      } else lower[row]![column] = advancedFinite(residual / lower[column]![column]!);
    }
  }
  // Use the same condition policy as LU-backed inverse and solve.
  advancedConditionedInverse(advancedFactorize(matrix));
  return lower.map(row => row.map(value => advancedScaledProduct([value, Math.sqrt(scale)])));
}

export function selectMatrix(a: NumericMatrix, rows: number[], columns: number[]): NumericMatrix {
  const matrix = validateMatrix(a);
  const indexes = (input: unknown, size: number): number[] => advancedDenseArray(input, 1, ADVANCED_MATH_LIMITS.maxAxis, 'INVALID_MATRIX_SELECTION').map(value => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= size) advancedFail('INVALID_MATRIX_SELECTION', '선택 index는 범위 안의 0부터 시작하는 정수여야 합니다.');
    return value;
  });
  const selectedRows = indexes(rows, matrix.length), selectedColumns = indexes(columns, matrix[0]!.length);
  return selectedRows.map(row => selectedColumns.map(column => matrix[row]![column]!));
}

function lookupPrelookupValidated(value: number, points: number[], extrapolation: LookupExtrapolation): PrelookupResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) advancedFail('INVALID_LOOKUP_VALUE', 'lookup 입력은 유한한 scalar 실수여야 합니다.');
  if (!['clip', 'linear', 'error'].includes(extrapolation)) advancedFail('INVALID_LOOKUP_EXTRAPOLATION', '범위 밖 옵션은 clip·linear·error여야 합니다.');
  const last = points.length - 1;
  if (value < points[0]! || value > points[last]!) {
    if (extrapolation === 'error') advancedFail('LOOKUP_OUT_OF_RANGE', 'lookup 입력이 breakpoint 범위를 벗어났습니다.');
    if (extrapolation === 'clip') value = Math.max(points[0]!, Math.min(points[last]!, value));
  }
  let index = 0;
  if (value >= points[last]!) index = last - 1;
  else {
    let low = 0, high = last;
    while (low + 1 < high) { const mid = Math.floor((low + high) / 2); if (value >= points[mid]!) low = mid; else high = mid; }
    index = low;
  }
  const lower = points[index]!, upper = points[index + 1]!;
  const numerator = value - lower, denominator = upper - lower;
  let fraction: number;
  if (Number.isFinite(numerator) && Number.isFinite(denominator)) fraction = numerator / denominator;
  else { const scale = Math.max(Math.abs(value), Math.abs(lower), Math.abs(upper)); fraction = (value / scale - lower / scale) / (upper / scale - lower / scale); }
  return { index, fraction: advancedFinite(fraction) };
}
export function prelookup(value: number, breakpoints: number[], extrapolation: LookupExtrapolation): PrelookupResult { return lookupPrelookupValidated(value, validateBreakpoints(breakpoints), extrapolation); }

export function lookup2D(row: number, column: number, input: Lookup2DOptions): number {
  const options = validateLookup2DOptions(input);
  const r = lookupPrelookupValidated(row, options.rowBreakpoints, options.extrapolation), c = lookupPrelookupValidated(column, options.columnBreakpoints, options.extrapolation);
  if (options.interpolation !== 'linear') {
    const offset = (fraction: number): number => options.interpolation === 'nearest' ? (fraction > 0.5 ? 1 : 0) : (fraction === 1 ? 1 : 0);
    return options.table[r.index + offset(r.fraction)]![c.index + offset(c.fraction)]!;
  }
  if (r.fraction < 0 || r.fraction > 1 || c.fraction < 0 || c.fraction > 1) {
    // Expanding the bilinear polynomial preserves its constant and affine terms
    // when extrapolation fractions are so large that float64 rounds 1-f to -f.
    const z00 = options.table[r.index]![c.index]!, z01 = options.table[r.index]![c.index + 1]!;
    const z10 = options.table[r.index + 1]![c.index]!, z11 = options.table[r.index + 1]![c.index + 1]!;
    return advancedScaledDot([
      [z00], [z10, r.fraction], [-z00, r.fraction], [z01, c.fraction], [-z00, c.fraction],
      [z11, r.fraction, c.fraction], [-z10, r.fraction, c.fraction], [-z01, r.fraction, c.fraction], [z00, r.fraction, c.fraction],
    ]);
  }
  return advancedScaledDot([
    [options.table[r.index]![c.index]!, 1 - r.fraction, 1 - c.fraction],
    [options.table[r.index]![c.index + 1]!, 1 - r.fraction, c.fraction],
    [options.table[r.index + 1]![c.index]!, r.fraction, 1 - c.fraction],
    [options.table[r.index + 1]![c.index + 1]!, r.fraction, c.fraction],
  ]);
}
