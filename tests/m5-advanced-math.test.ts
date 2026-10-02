import { describe, expect, it } from 'vitest';
import { cholesky, determinant, inverse, lookup2D, lu, matrixMultiply, prelookup, selectMatrix, solve, transpose, validateBreakpoints, validateLookup2DOptions, validateMatrix, type Lookup2DOptions, type NumericMatrix } from '../packages/advanced-math/src';
import { ModelError } from '../packages/model/src';

const referenceMultiply = (a: NumericMatrix, b: NumericMatrix): NumericMatrix => a.map(row => b[0]!.map((_, column) => row.reduce((sum, value, index) => sum + value * b[index]![column]!, 0)));
const referenceTranspose = (a: NumericMatrix): NumericMatrix => a[0]!.map((_, column) => a.map(row => row[column]!));
const referenceIdentity = (size: number): NumericMatrix => Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => row === column ? 1 : 0));
const closeMatrix = (actual: NumericMatrix, expected: NumericMatrix, precision = 12): void => {
  expect(actual.length).toBe(expected.length); actual.forEach((row, i) => { expect(row.length).toBe(expected[i]!.length); row.forEach((value, j) => expect(value).toBeCloseTo(expected[i]![j]!, precision)); });
};
const code = (operation: () => unknown, expected: string): void => {
  try { operation(); throw new Error(`Expected ${expected}`); }
  catch (error) { expect(error).toBeInstanceOf(ModelError); const diagnostics = (error as ModelError).diagnostics; expect(diagnostics.some(item => item.code === expected)).toBe(true); diagnostics.forEach(item => expect(Object.keys(item).sort()).toEqual(['code', 'message'])); }
};
const settings = (interpolation: Lookup2DOptions['interpolation'] = 'linear', extrapolation: Lookup2DOptions['extrapolation'] = 'clip'): Lookup2DOptions => ({ rowBreakpoints: [0, 2, 5], columnBreakpoints: [-1, 1, 4], table: [[1, 3, 5], [7, 11, 13], [17, 19, 23]], interpolation, extrapolation });

describe('M5 dense bounded real matrix contracts', () => {
  it('multiplies rectangular matrices against explicit integer equations and transposes without mutating inputs', () => {
    const a = [[1, 2, 3], [4, 5, 6]], b = [[7, 8], [9, 10], [11, 12]], original = JSON.stringify([a, b]);
    expect(matrixMultiply(a, b)).toEqual([[58, 64], [139, 154]]);
    expect(transpose(a)).toEqual([[1, 4], [2, 5], [3, 6]]);
    expect(JSON.stringify([a, b])).toBe(original);
    const copy = validateMatrix(a); copy[0]![0] = 999; expect(a[0]![0]).toBe(1);
  });
  it('accepts the complete 32 by 32 boundary and preserves identity multiplication', () => {
    const a = referenceIdentity(32); expect(matrixMultiply(a, a)).toEqual(a); expect(transpose(a)).toEqual(a);
  });
  it.each([
    { value: [] }, { value: [[]] }, { value: [[1], [2, 3]] }, { value: [[Number.NaN]] }, { value: [[Number.POSITIVE_INFINITY]] }, { value: [[true]] }, { value: [1, 2] },
    { value: Array.from({ length: 33 }, () => [1]) }, { value: [Array.from({ length: 33 }, () => 1)] },
  ])('rejects invalid dense real matrices %j', ({ value }) => { code(() => validateMatrix(value), 'INVALID_MATRIX'); });
  it('rejects holes, hidden fields and accessors without evaluating a getter', () => {
    let accessed = false; const row = [1]; Object.defineProperty(row, '0', { enumerable: true, get: () => { accessed = true; return 1; } });
    code(() => validateMatrix([row]), 'INVALID_MATRIX'); expect(accessed).toBe(false);
    code(() => validateMatrix([new Array(1)]), 'INVALID_MATRIX');
    const extra = [[1]]; Object.defineProperty(extra, 'unexpected', { value: 1 }); code(() => validateMatrix(extra), 'INVALID_MATRIX');
  });
  it('diagnoses rectangular multiplication and square-matrix shape errors before calculating', () => {
    code(() => matrixMultiply([[1, 2]], [[1, 2]]), 'MATRIX_DIMENSION_MISMATCH');
    for (const operation of [determinant, inverse, lu, cholesky]) code(() => operation([[1, 2]]), 'MATRIX_NOT_SQUARE');
    code(() => solve([[1, 2]], [[1]]), 'MATRIX_NOT_SQUARE'); code(() => solve([[1]], [[1], [2]]), 'MATRIX_DIMENSION_MISMATCH');
  });
  it('uses scaled products to preserve cancellation and avoid false overflow in a representable dot product', () => {
    expect(matrixMultiply([[1e308, 1e308, 3]], [[2], [-2], [1]])).toEqual([[3]]);
    expect(matrixMultiply([[1e300, 1e-300]], [[1e-300], [1e300]])[0]![0]).toBeCloseTo(2, 14);
    expect(matrixMultiply([[1e300, 2e300, 1e-300]], [[1e300], [-0.5e300], [1]])).toEqual([[1e-300]]);
    expect(matrixMultiply([[1e300, 1e300, 1e-300]], [[2], [-1], [1]])).toEqual([[1e300]]);
    code(() => matrixMultiply([[1e308]], [[2]]), 'MATRIX_NUMERIC_NONFINITE');
    code(() => matrixMultiply([[1e-300]], [[1e-300]]), 'MATRIX_NUMERIC_UNDERFLOW');
  });
});

describe('M5 partial-pivot LU, determinant, inverse and solve', () => {
  const a = [[0, 2, 1], [1, 1, 0], [2, 0, 1]];
  it('matches a hand-derived pivot permutation and triangular factors satisfying P A = L U', () => {
    const original = JSON.stringify(a), result = lu(a);
    expect(result.permutation).toEqual([2, 0, 1]);
    closeMatrix(result.lower, [[1, 0, 0], [0, 1, 0], [0.5, 0.5, 1]]);
    closeMatrix(result.upper, [[2, 0, 1], [0, 2, 1], [0, 0, -1]]);
    closeMatrix(referenceMultiply(result.lower, result.upper), result.permutation.map(row => a[row]!));
    expect(JSON.stringify(a)).toBe(original);
    expect(determinant(a)).toBeCloseTo(-4, 13);
  });
  it('keeps the first candidate on a pivot magnitude tie', () => {
    expect(lu([[1, 2], [-1, 3]]).permutation).toEqual([0, 1]);
  });
  it('solves multiple right-hand columns against hand-built exact solutions', () => {
    const b = [[11, 14], [4, 6], [7, 10]], before = JSON.stringify([a, b]);
    closeMatrix(solve(a, b), [[1, 2], [3, 4], [5, 6]]);
    expect(JSON.stringify([a, b])).toBe(before);
  });
  it('preserves independent RHS column scales and explicitly rejects lost nonzero values in one column', () => {
    const rhs = [[1e300, 1e-300], [-1e300, -1e-300]], before = JSON.stringify(rhs);
    expect(solve(referenceIdentity(2), rhs)).toEqual(rhs); expect(JSON.stringify(rhs)).toBe(before);
    code(() => solve(referenceIdentity(2), [[1e300], [1e-300]]), 'MATRIX_NUMERIC_UNDERFLOW');
  });
  it('rejects RHS normalization into subnormal precision even when a nonzero rounded value survives', () => {
    // Identity has condition number one and its exact solution is B. Scaling
    // the second entry by 1e300 rounds it to 2*MIN_VALUE, losing about 1.19%.
    const rhs = [[1e300], [1e-23]], snapshot = JSON.stringify(rhs);
    expect(rhs[1]![0]! / rhs[0]![0]!).not.toBe(0);
    code(() => solve(referenceIdentity(2), rhs), 'MATRIX_NUMERIC_UNDERFLOW');
    expect(JSON.stringify(rhs)).toBe(snapshot);
  });
  it('inverts a closed-form two by two matrix and verifies two-sided residuals', () => {
    const matrix = [[4, 7], [2, 6]], result = inverse(matrix);
    closeMatrix(result, [[0.6, -0.7], [-0.2, 0.4]]);
    closeMatrix(referenceMultiply(matrix, result), referenceIdentity(2)); closeMatrix(referenceMultiply(result, matrix), referenceIdentity(2));
    expect(determinant(matrix)).toBeCloseTo(10, 13);
  });
  it('matches an independent Vandermonde determinant product', () => {
    const points = [-2, -1, 0, 1, 2], vandermonde = points.map(point => Array.from({ length: points.length }, (_, power) => point ** power));
    expect(determinant(vandermonde)).toBeCloseTo(288, 10);
  });
  it('verifies inverse and solve residuals on a deterministic diagonally dominant seven by seven system', () => {
    const matrix = Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, (_, column) => row === column ? 12 + row % 3 : ((row + 2) * (column + 3) % 7 - 3) / 20));
    const expected = matrix.map((_, row) => [((row + 1) * 2) / 8, ((row + 1) * 3) / 8]);
    closeMatrix(solve(matrix, referenceMultiply(matrix, expected)), expected, 12);
    closeMatrix(referenceMultiply(matrix, inverse(matrix)), referenceIdentity(7), 12);
  });
  it.each([1e-300, 1e300])('normalizes a well-conditioned matrix at extreme overall scale %s', (scale) => {
    const matrix = [[2 * scale, scale], [scale, 3 * scale]], rhs = [[4 * scale, 2 * scale], [7 * scale, scale]];
    closeMatrix(solve(matrix, rhs), [[1, 1], [2, 0]], 12);
    closeMatrix(referenceMultiply(matrix, inverse(matrix)), referenceIdentity(2), 12);
    const factors = lu(matrix); closeMatrix(factors.upper.map(row => row.map(value => value / scale)), [[2, 1], [0, 2.5]], 12);
  });
  it.each([1e-150, 1e150])('preserves representable determinant scale without premature intermediate loss %s', (scale) => {
    const actual = determinant([[2 * scale, scale], [scale, 3 * scale]]), expected = 5 * scale * scale;
    expect(actual / expected).toBeCloseTo(1, 13);
  });
  it('returns zero only for an exact singular determinant and rejects singular inverse/solve/LU', () => {
    const singular = [[1, 2], [2, 4]]; expect(determinant(singular)).toBe(0); expect(determinant([[0]])).toBe(0);
    code(() => inverse(singular), 'MATRIX_SINGULAR'); code(() => lu(singular), 'MATRIX_SINGULAR'); code(() => solve(singular, [[1], [2]]), 'MATRIX_SINGULAR');
  });
  it('rejects near-singular and unresolvable mixed-scale systems with explicit stability diagnostics', () => {
    const near = [[1, 1], [1, 1 + 1e-15]];
    for (const operation of [determinant, inverse, lu]) code(() => operation(near), 'MATRIX_ILL_CONDITIONED');
    code(() => inverse([[1e300, 0], [0, 1e-300]]), 'MATRIX_ILL_CONDITIONED');
    code(() => determinant([[1e300, 0], [0, 1e-300]]), 'MATRIX_ILL_CONDITIONED');
  });
  it('diagnoses final determinant/inverse range failures and supports zero right-hand sides', () => {
    code(() => determinant([[1e300, 0], [0, 1e300]]), 'MATRIX_NUMERIC_NONFINITE');
    code(() => determinant([[1e-300, 0], [0, 1e-300]]), 'MATRIX_NUMERIC_UNDERFLOW');
    code(() => inverse([[1e-320]]), 'MATRIX_NUMERIC_NONFINITE'); code(() => solve([[1e-320]], [[1]]), 'MATRIX_NUMERIC_NONFINITE');
    expect(solve([[2, 1], [1, 3]], [[0, 0], [0, 0]])).toEqual([[0, 0], [0, 0]]);
    expect(inverse([[4]])).toEqual([[0.25]]); expect(lu([[4]])).toEqual({ lower: [[1]], upper: [[4]], permutation: [0] });
  });
});

describe('M5 real Cholesky and matrix selection', () => {
  it('matches the standard independently specified three by three Cholesky factor', () => {
    const matrix = [[4, 12, -16], [12, 37, -43], [-16, -43, 98]], original = JSON.stringify(matrix), lower = cholesky(matrix);
    closeMatrix(lower, [[2, 0, 0], [6, 1, 0], [-8, 5, 3]], 11);
    closeMatrix(referenceMultiply(lower, referenceTranspose(lower)), matrix, 10); expect(JSON.stringify(matrix)).toBe(original);
  });
  it('recovers independently built lower factors for deterministic positive-definite matrices', () => {
    for (const size of [2, 5, 8]) {
      const lower = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => column > row ? 0 : row === column ? 3 : ((row - column) / 10) * (row % 2 ? -1 : 1)));
      closeMatrix(cholesky(referenceMultiply(lower, referenceTranspose(lower))), lower, 12);
    }
  });
  it.each([1e-300, 1e300])('supports a well-conditioned positive definite matrix at overall scale %s', (scale) => {
    const matrix = [[2 * scale, scale], [scale, 3 * scale]], lower = cholesky(matrix);
    closeMatrix(referenceMultiply(lower, referenceTranspose(lower)).map(row => row.map(value => value / scale)), [[2, 1], [1, 3]], 12);
  });
  it('rejects non-symmetric, indefinite, semidefinite and near-singular positive matrices', () => {
    code(() => cholesky([[2, 1], [0, 2]]), 'MATRIX_NOT_SYMMETRIC');
    for (const matrix of [[[1, 2], [2, 1]], [[1, 1], [1, 1]], [[0]]]) code(() => cholesky(matrix), 'MATRIX_NOT_POSITIVE_DEFINITE');
    code(() => cholesky([[1, 0], [0, 1e-16]]), 'MATRIX_ILL_CONDITIONED');
  });
  it('selects zero-based rows/columns with deliberate reordering and repeats', () => {
    const matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]], selected = selectMatrix(matrix, [2, 0, 2], [2, 0]);
    expect(selected).toEqual([[9, 7], [3, 1], [9, 7]]); selected[0]![0] = 999; expect(matrix[2]![2]).toBe(9);
  });
  it.each([-1, 1.5, 3, Number.NaN])('rejects an invalid matrix selection index %s', (index) => { code(() => selectMatrix([[1, 2], [3, 4]], [index], [0]), 'INVALID_MATRIX_SELECTION'); });
});

describe('M5 2D nonuniform lookup and prelookup', () => {
  it('defines exact breakpoint intervals, final endpoints and all extrapolation modes', () => {
    const points = [-3, -1, 2, 10];
    expect(prelookup(-3, points, 'clip')).toEqual({ index: 0, fraction: 0 });
    expect(prelookup(-1, points, 'clip')).toEqual({ index: 1, fraction: 0 });
    expect(prelookup(2, points, 'clip')).toEqual({ index: 2, fraction: 0 });
    expect(prelookup(10, points, 'clip')).toEqual({ index: 2, fraction: 1 });
    expect(prelookup(-100, points, 'clip')).toEqual({ index: 0, fraction: 0 });
    expect(prelookup(100, points, 'clip')).toEqual({ index: 2, fraction: 1 });
    expect(prelookup(-5, points, 'linear')).toEqual({ index: 0, fraction: -1 });
    expect(prelookup(15, points, 'linear')).toEqual({ index: 2, fraction: 13 / 8 });
    code(() => prelookup(-4, points, 'error'), 'LOOKUP_OUT_OF_RANGE'); code(() => prelookup(11, points, 'error'), 'LOOKUP_OUT_OF_RANGE');
  });
  it('checks nonuniform bilinear interpolation and linear extrapolation against an independent analytic surface', () => {
    const rows = [0, 2, 5], columns = [-1, 1, 4], surface = (row: number, column: number): number => 2 * row + 3 * column + 5 + 7 * row * column;
    const options: Lookup2DOptions = { rowBreakpoints: rows, columnBreakpoints: columns, table: rows.map(row => columns.map(column => surface(row, column))), interpolation: 'linear', extrapolation: 'linear' };
    const original = JSON.stringify(options);
    for (const row of [-1, 0, 0.5, 2, 3.2, 5, 6]) for (const column of [-2, -1, 0, 1, 2.6, 4, 5]) expect(lookup2D(row, column, options)).toBeCloseTo(surface(row, column), 11);
    expect(JSON.stringify(options)).toBe(original);
  });
  it('clips each axis independently and chooses the lower index on nearest ties', () => {
    const options: Lookup2DOptions = { rowBreakpoints: [0, 2], columnBreakpoints: [0, 4], table: [[10, 20], [30, 40]], interpolation: 'nearest', extrapolation: 'clip' };
    expect(lookup2D(1, 2, options)).toBe(10); expect(lookup2D(1.001, 2.001, options)).toBe(40);
    expect(lookup2D(-100, 100, options)).toBe(20); expect(lookup2D(100, -100, options)).toBe(30);
  });
  it('uses previous cells while preserving exact interior and final breakpoint values', () => {
    const options = settings('previous');
    expect(lookup2D(1, 3, options)).toBe(3); expect(lookup2D(2, 1, options)).toBe(11); expect(lookup2D(5, 4, options)).toBe(23);
    expect(lookup2D(-10, 100, options)).toBe(5);
  });
  it('handles representable fractions and interpolation even when direct interval/product differences overflow', () => {
    expect(prelookup(0, [-1e308, 1e308], 'clip')).toEqual({ index: 0, fraction: 0.5 });
    const options: Lookup2DOptions = { rowBreakpoints: [-1e308, 1e308], columnBreakpoints: [-1e308, 1e308], table: [[1e308, -1e308], [-1e308, 1e308]], interpolation: 'linear', extrapolation: 'clip' };
    expect(lookup2D(0, 0, options)).toBe(0); expect(lookup2D(-1e308, -1e308, options)).toBe(1e308);
  });
  it('preserves constant and affine surfaces during extreme finite linear extrapolation', () => {
    const options: Lookup2DOptions = { rowBreakpoints: [0, 1], columnBreakpoints: [0, 1], table: [[1e-300, 1e-300], [1e-300, 1e-300]], interpolation: 'linear', extrapolation: 'linear' };
    expect(lookup2D(1e300, -1e300, options)).toBe(1e-300);
    options.table = [[0, 1], [1, 2]];
    expect(lookup2D(1e300, 1e300, options) / 2e300).toBeCloseTo(1, 14);
    expect(lookup2D(1e300, -1e300, options)).toBe(0);
    options.table = [[1, 1], [2, 2]];
    expect(lookup2D(0.25, 1e300, options)).toBe(1.25);
  });
  it('checks the 32 by 32 table boundary and copies validated options defensively', () => {
    const points = Array.from({ length: 32 }, (_, index) => index), options: Lookup2DOptions = { rowBreakpoints: points, columnBreakpoints: points, table: points.map(row => points.map(column => row + column)), interpolation: 'linear', extrapolation: 'clip' };
    expect(lookup2D(30.5, 30.5, options)).toBe(61);
    const copy = validateLookup2DOptions(options); copy.table[0]![0] = 999; copy.rowBreakpoints[0] = -999; expect(options.table[0]![0]).toBe(0); expect(options.rowBreakpoints[0]).toBe(0);
  });
  it.each([[1], [0, 0], [1, 0], [0, Number.NaN], Array.from({ length: 33 }, (_, index) => index)].map(points => ({ points })))('rejects invalid breakpoints %j', ({ points }) => { code(() => validateBreakpoints(points), 'INVALID_BREAKPOINTS'); });
  it('rejects nonfinite inputs, invalid shapes/options and unsupported nearest/previous linear extrapolation', () => {
    code(() => prelookup(Number.NaN, [0, 1], 'clip'), 'INVALID_LOOKUP_VALUE'); code(() => prelookup(0, [0, 1], 'unknown' as 'clip'), 'INVALID_LOOKUP_EXTRAPOLATION');
    code(() => lookup2D(0, 0, { ...settings(), table: [[1, 2]] }), 'LOOKUP_TABLE_SHAPE');
    for (const interpolation of ['nearest', 'previous'] as const) code(() => lookup2D(0, 0, settings(interpolation, 'linear')), 'INVALID_LOOKUP_2D');
    code(() => lookup2D(-1, 0, settings('linear', 'error')), 'LOOKUP_OUT_OF_RANGE'); code(() => lookup2D(0, 5, settings('linear', 'error')), 'LOOKUP_OUT_OF_RANGE');
    code(() => validateLookup2DOptions({ ...settings(), extra: true }), 'INVALID_LOOKUP_2D');
    let accessed = false; const unsafe = settings(); Object.defineProperty(unsafe, 'table', { enumerable: true, get: () => { accessed = true; return [[1]]; } });
    code(() => validateLookup2DOptions(unsafe), 'INVALID_LOOKUP_2D'); expect(accessed).toBe(false);
  });
});
