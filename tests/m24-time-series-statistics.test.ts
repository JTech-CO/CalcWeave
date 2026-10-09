import { describe, expect, it } from 'vitest';
import { analyzeSignalCorrelation, analyzeTimeStatistics, TIME_SERIES_LIMITS, type CorrelationInput, type CorrelationOptions, type TimeSeriesInput } from '../packages/analysis/src/time-series-statistics';
import { ModelError } from '../packages/model/src';

const statisticsInput = (values: number[], interval = 0.25, start = 0): TimeSeriesInput => ({ times: values.map((_, index) => start + index * interval), values });
const correlationInput = (x: number[], y: number[], interval = 0.25, start = 0): CorrelationInput => ({ times: x.map((_, index) => start + index * interval), x, y });
const options: CorrelationOptions = { maxLag: 2, removeMean: true, minOverlap: 2 };
function rejects(action: () => unknown, expected: string): void { try { action(); throw new Error('Did not reject'); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.map((item) => item.code)).toContain(expected); } }
function finite(value: unknown): void { if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); else if (Array.isArray(value)) value.forEach(finite); else if (value && typeof value === 'object') Object.values(value).forEach(finite); }
/** Pairwise variance identity is independent of the implementation's centered sum. */
function pairwiseVariance(values: number[]): number {
  let total = 0;
  for (let left = 0; left < values.length; left += 1) for (let right = left + 1; right < values.length; right += 1) total += (values[left]! - values[right]!) ** 2;
  return total / values.length ** 2;
}
/** Direct small-vector overlap oracle, deliberately using no production helpers. */
function correlationOracle(x: number[], y: number[], lag: number, removeMean: boolean): { meanX: number; meanY: number; numerator: number; xEnergy: number; yEnergy: number; coefficient: number | null } {
  const left: number[] = [], right: number[] = [];
  for (let index = 0; index < x.length; index += 1) if (index + lag >= 0 && index + lag < y.length) { left.push(x[index]!); right.push(y[index + lag]!); }
  const meanX = left.reduce((total, value) => total + value, 0) / left.length, meanY = right.reduce((total, value) => total + value, 0) / right.length;
  let numerator = 0, xEnergy = 0, yEnergy = 0;
  for (let index = 0; index < left.length; index += 1) { const a = left[index]! - (removeMean ? meanX : 0), b = right[index]! - (removeMean ? meanY : 0); numerator += a * b; xEnergy += a * a; yEnergy += b * b; }
  return { meanX, meanY, numerator, xEnergy, yEnergy, coefficient: xEnergy && yEnergy ? numerator / Math.sqrt(xEnergy * yEnergy) : null };
}

describe('M24 independent equal-sample statistics', () => {
  it('matches a known population/sample variance example with explicit divisors', () => {
    const report = analyzeTimeStatistics(statisticsInput([2, 4, 4, 4, 5, 5, 7, 9], 0.5, 3));
    expect(report).toMatchObject({ method: 'sample-statistics', weighting: 'equal-samples', count: 8, startTime: 3, endTime: 6.5, sampleInterval: 0.5, mean: 5, variancePopulation: 4, min: 2, max: 9, populationDivisor: 8, sampleDivisor: 7 });
    expect(report.varianceSample).toBeCloseTo(32 / 7, 13); expect(report.standardDeviationPopulation).toBe(2); expect(report.standardDeviationSample).toBeCloseTo(Math.sqrt(32 / 7), 13); expect(report.rms).toBeCloseTo(Math.sqrt(29), 13);
    expect(report.diagnostics.join(' ')).toContain('독립'); expect(report.work).toBe(8 * 24); finite(report);
  });
  it('matches an independent pairwise oracle for asymmetric non-power-of-two samples', () => {
    const values = [3, -2, 7.5, 0.25, 4, -6, 9], report = analyzeTimeStatistics(statisticsInput(values));
    const variance = pairwiseVariance(values), expectedMean = values.reduce((total, value) => total + value, 0) / values.length;
    expect(report.mean).toBeCloseTo(expectedMean, 14); expect(report.variancePopulation).toBeCloseTo(variance, 12); expect(report.varianceSample).toBeCloseTo(variance * 7 / 6, 12);
    expect(report.standardDeviationPopulation).toBeCloseTo(Math.sqrt(variance), 13); expect(report.rms).toBeCloseTo(Math.sqrt(values.reduce((total, value) => total + value ** 2, 0) / 7), 13);
  });
  it('computes two samples, constant values and exact min/max without an invented interval weight', () => {
    const two = analyzeTimeStatistics(statisticsInput([-3, 5], 100)); expect(two.mean).toBe(1); expect(two.variancePopulation).toBe(16); expect(two.varianceSample).toBe(32); expect(two.standardDeviationPopulation).toBe(4); expect(two.rms).toBeCloseTo(Math.sqrt(17), 14);
    for (const value of [0, -4, TIME_SERIES_LIMITS.maxValue, Number.MIN_VALUE]) {
      const report = analyzeTimeStatistics(statisticsInput(Array(3).fill(value))); expect(report.mean).toBe(value); expect(report.rms).toBe(Math.abs(value)); expect(report.min).toBe(value); expect(report.max).toBe(value); expect(report.variancePopulation).toBe(0); expect(report.varianceSample).toBe(0); expect(report.standardDeviationPopulation).toBe(0); expect(report.diagnostics.join(' ')).toContain('상수');
    }
  });
  it('preserves a literal adjacent Float64 variance at a 1e12 offset', () => {
    // The next representable double at 1e12 is exactly 1e12 + 2^-13.
    const step = 0.0001220703125, values = [-1e12, -999999999999.9999, -999999999999.9998], report = analyzeTimeStatistics(statisticsInput(values));
    expect(values[1]! - values[0]!).toBe(step); expect(values[2]! - values[1]!).toBe(step);
    expect(report.mean).toBe(values[1]); expect(report.variancePopulation).toBeCloseTo(2 * step ** 2 / 3, 23); expect(report.varianceSample).toBeCloseTo(step ** 2, 23); expect(report.standardDeviationPopulation).toBeCloseTo(step * Math.sqrt(2 / 3), 18); expect(report.standardDeviationSample).toBe(step);
  });
  it('compensates cancellation when computing the mean', () => {
    const report = analyzeTimeStatistics(statisticsInput([1e12, 1, -1e12])); expect(report.mean).toBe(1 / 3); expect(report.variancePopulation / pairwiseVariance([1e12, 1, -1e12])).toBeCloseTo(1, 14);
  });
  it('preserves tiny standard deviation and RMS when squared variances cannot be represented', () => {
    const report = analyzeTimeStatistics(statisticsInput([1e-200, 3e-200])); expect(report.mean).toBe(2e-200); expect(report.standardDeviationPopulation / 1e-200).toBeCloseTo(1, 14); expect(report.standardDeviationSample / 1e-200).toBeCloseTo(Math.sqrt(2), 14); expect(report.rms / 1e-200).toBeCloseTo(Math.sqrt(5), 14); expect(report.variancePopulation).toBe(0); expect(report.diagnostics.join(' ')).toContain('Float64');
    const subnormal = analyzeTimeStatistics(statisticsInput([Number.MIN_VALUE, 3 * Number.MIN_VALUE])); expect(subnormal.standardDeviationPopulation).toBe(Number.MIN_VALUE); expect(subnormal.mean).toBe(2 * Number.MIN_VALUE); finite(subnormal);
  });
  it.each([2, 3, 17, 8192])('accepts %i arbitrary samples with deterministic bounded finite results', (count) => {
    const values = Array.from({ length: count }, (_, index) => index % 2 ? -1e12 : 1e12), source = statisticsInput(values), before = structuredClone(source), report = analyzeTimeStatistics(source);
    expect(report).toEqual(analyzeTimeStatistics(source)); expect(source).toEqual(before); expect(report.work).toBeLessThanOrEqual(TIME_SERIES_LIMITS.work); finite(report);
  });
});

describe('M24 overlap-normalized correlation with explicit direction and missing values', () => {
  const x = [2, -1, 4, 0, 3, -2, 7, 1, 5, -3, 6];
  it.each([false, true])('matches a small direct overlap oracle for removeMean=%s', (removeMean) => {
    const left = [2, -1, 4, 0, 3, -2, 7], right = [3, 5, -4, 1, 0, 7, 2], report = analyzeSignalCorrelation(correlationInput(left, right, 0.5, 17), { maxLag: 3, removeMean, minOverlap: 2 });
    expect(report).toMatchObject({ method: 'overlap-normalized-correlation', count: 7, startTime: 17, endTime: 20, sampleInterval: 0.5, maxLag: 3, removeMean, minOverlap: 2, demeaning: removeMean ? 'per-overlap' : 'none', normalization: 'overlap-energy', lagConvention: 'positive-y-follows-x' });
    expect(report.rows).toHaveLength(7);
    report.rows.forEach((row) => { const expected = correlationOracle(left, right, row.lag, removeMean); expect(row.xMean).toBeCloseTo(expected.meanX, 13); expect(row.yMean).toBeCloseTo(expected.meanY, 13); expect(row.numerator).toBeCloseTo(expected.numerator, 12); expect(row.xEnergy).toBeCloseTo(expected.xEnergy, 12); expect(row.yEnergy).toBeCloseTo(expected.yEnergy, 12); expect(row.denominator).toBeCloseTo(Math.sqrt(expected.xEnergy * expected.yEnergy), 12); expect(row.coefficient).toBeCloseTo(expected.coefficient!, 13); expect(row.lagSeconds).toBe(row.lag * 0.5); expect(row.overlapCount).toBe(7 - Math.abs(row.lag)); expect(row.reason).toBeNull(); });
  });
  it.each([false, true])('identifies an asymmetric known positive and negative sample delay for removeMean=%s', (removeMean) => {
    const delayed = [13, -8, ...x.slice(0, -2)], advanced = [...x.slice(2), 13, -8], positive = analyzeSignalCorrelation(correlationInput(x, delayed), { maxLag: 4, removeMean, minOverlap: 6 }), negative = analyzeSignalCorrelation(correlationInput(x, advanced), { maxLag: 4, removeMean, minOverlap: 6 });
    expect(positive.peak).toEqual({ lag: 2, lagSeconds: 0.5, coefficient: expect.closeTo(1, 14), overlapCount: 9 }); expect(negative.peak).toEqual({ lag: -2, lagSeconds: -0.5, coefficient: expect.closeTo(1, 14), overlapCount: 9 });
    expect(positive.rows[6]).toMatchObject({ lag: 2, xStartIndex: 0, xEndIndex: 8, yStartIndex: 2, yEndIndex: 10, xStartTime: 0, xEndTime: 2, yStartTime: 0.5, yEndTime: 2.5 });
    expect(positive.diagnostics.join(' ')).toContain('확정 지연');
  });
  it('retains the negative coefficient of a delayed inverted signal while choosing by magnitude', () => {
    const inverted = [13, -8, ...x.slice(0, -2).map((value) => -value)], report = analyzeSignalCorrelation(correlationInput(x, inverted), { maxLag: 4, removeMean: true, minOverlap: 6 });
    expect(report.peak).toMatchObject({ lag: 2, coefficient: expect.closeTo(-1, 14), overlapCount: 9 });
  });
  it('reverses lag and swaps all segment metadata when X and Y are swapped', () => {
    const y = [7, -4, 2, 5, 9, -3, 0, 1, -6, 3, 8], xy = analyzeSignalCorrelation(correlationInput(x, y), { ...options, maxLag: 4 }), yx = analyzeSignalCorrelation(correlationInput(y, x), { ...options, maxLag: 4 });
    xy.rows.forEach((row) => { const reversed = yx.rows.find((item) => item.lag === -row.lag)!; expect(reversed.coefficient).toBeCloseTo(row.coefficient!, 14); expect(reversed.overlapCount).toBe(row.overlapCount); expect(reversed.xStartIndex).toBe(row.yStartIndex); expect(reversed.yStartIndex).toBe(row.xStartIndex); expect(reversed.xMean).toBe(row.yMean); expect(reversed.yMean).toBe(row.xMean); expect(reversed.xEnergy).toBe(row.yEnergy); expect(reversed.yEnergy).toBe(row.xEnergy); });
  });
  it('centers each actual overlap independently, retaining invariance to unequal DC offsets', () => {
    const y = [7, -4, 2, 5, 9, -3, 0, 1, -6, 3, 8], original = analyzeSignalCorrelation(correlationInput(x, y), { maxLag: 4, removeMean: true, minOverlap: 2 }), shifted = analyzeSignalCorrelation(correlationInput(x.map((value) => value + 1e6), y.map((value) => value - 2e6)), { maxLag: 4, removeMean: true, minOverlap: 2 });
    original.rows.forEach((row, index) => { expect(shifted.rows[index]!.coefficient).toBeCloseTo(row.coefficient!, 13); expect(shifted.rows[index]!.xMean - row.xMean).toBeCloseTo(1e6, 8); expect(shifted.rows[index]!.yMean - row.yMean).toBeCloseTo(-2e6, 8); });
    const partial = original.rows.find((row) => row.lag === 4)!; expect(partial.xMean).not.toBeCloseTo(x.reduce((total, value) => total + value, 0) / x.length, 8);
  });
  it('distinguishes raw cosine normalization from centered correlation', () => {
    const raw = analyzeSignalCorrelation(correlationInput([1, 2, 4], [2, 3, 5]), { maxLag: 0, removeMean: false, minOverlap: 2 }), centered = analyzeSignalCorrelation(correlationInput([1, 2, 4], [2, 3, 5]), { maxLag: 0, removeMean: true, minOverlap: 2 });
    expect(centered.rows[0]!.coefficient).toBeCloseTo(1, 14); expect(raw.rows[0]!.coefficient).toBeCloseTo(28 / Math.sqrt(21 * 38), 14); expect(raw.diagnostics.join(' ')).toContain('코사인');
  });
  it('keeps minimum-overlap rows null, their actual metadata and the correct precedence over zero energy', () => {
    const report = analyzeSignalCorrelation(correlationInput([1, 2, 3, 4], [2, 4, 6, 8]), { maxLag: 3, removeMean: true, minOverlap: 3 });
    expect(report.rows.map((row) => row.reason)).toEqual(['insufficient-overlap', 'insufficient-overlap', null, null, null, 'insufficient-overlap', 'insufficient-overlap']);
    expect(report.rows[0]).toMatchObject({ coefficient: null, overlapCount: 1, xMean: 4, yMean: 2, xStartIndex: 3, xEndIndex: 3, yStartIndex: 0, yEndIndex: 0 }); expect(report.peak!.lag).toBe(0);
  });
  it('returns null for true zero centered energy, but a raw nonzero constant remains defined', () => {
    for (const left of [Array(5).fill(0), Array(5).fill(3)]) { const report = analyzeSignalCorrelation(correlationInput(left, [1, 4, -2, 7, 0]), options); expect(report.rows.every((row) => row.coefficient === null && row.reason === 'zero-energy')).toBe(true); expect(report.peak).toBeNull(); }
    const report = analyzeSignalCorrelation(correlationInput(Array(5).fill(3), Array(5).fill(-7)), { ...options, removeMean: false }); report.rows.forEach((row) => { expect(row.reason).toBeNull(); expect(row.coefficient).toBeCloseTo(-1, 14); }); expect(report.peak!.lag).toBe(0);
  });
  it('breaks rounded unit-coefficient ties by overlap, absolute lag, then negative lag', () => {
    const linear = analyzeSignalCorrelation(correlationInput([1, 2, 3, 4, 5], [3, 5, 7, 9, 11]), options); expect(linear.peak!.lag).toBe(0);
    const equalSigned = analyzeSignalCorrelation(correlationInput([0, 1, 2, 4], [1, 2, 4, 6]), { maxLag: 1, removeMean: true, minOverlap: 3 }); expect(equalSigned.rows[0]!.coefficient).toBeCloseTo(1, 14); expect(equalSigned.rows[2]!.coefficient).toBeCloseTo(1, 14); expect(equalSigned.peak!.lag).toBe(-1);
  });
  it('preserves normalized tiny coefficients when every dimensional squared field underflows', () => {
    const report = analyzeSignalCorrelation(correlationInput([1e-200, 2e-200, 4e-200], [3e-200, 5e-200, 9e-200]), { maxLag: 0, removeMean: true, minOverlap: 2 }), row = report.rows[0]!;
    expect(row.reason).toBeNull(); expect(row.coefficient).toBeCloseTo(1, 14); expect(row.xEnergy).toBe(0); expect(row.yEnergy).toBe(0); expect(row.denominator).toBe(0); expect(row.scaledXEnergy).toBeGreaterThan(0); expect(row.scaledYEnergy).toBeGreaterThan(0); expect(row.scaledDenominator).toBeGreaterThan(0); expect(row.scaleX).toBeGreaterThan(0); finite(report);
    const subnormal = analyzeSignalCorrelation(correlationInput([Number.MIN_VALUE, 2 * Number.MIN_VALUE, 4 * Number.MIN_VALUE], [3 * Number.MIN_VALUE, 5 * Number.MIN_VALUE, 9 * Number.MIN_VALUE]), { maxLag: 0, removeMean: true, minOverlap: 2 }); expect(subnormal.rows[0]!.coefficient).toBeCloseTo(1, 14); expect(subnormal.rows[0]!.reason).toBeNull();
  });
  it('does not underflow representable mixed-scale raw products through a small intermediate', () => {
    const report = analyzeSignalCorrelation(correlationInput([Number.MIN_VALUE, 3 * Number.MIN_VALUE], [1e12, -1e12]), { maxLag: 0, removeMean: true, minOverlap: 2 }), row = report.rows[0]!;
    expect(row.numerator).toBeLessThan(0); expect(row.denominator).toBeGreaterThan(0); expect(row.coefficient).toBeCloseTo(-1, 14); expect(row.xEnergy).toBe(0); expect(row.scaledXEnergy).toBeGreaterThan(0); finite(report);
  });
  it('keeps an adjacent-Float64 high-offset centered signal correlated independently of the rounded mean', () => {
    const step = 0.0001220703125, high = [-1e12, -999999999999.9999, -999999999999.9998], report = analyzeSignalCorrelation(correlationInput(high, [0, step, 2 * step]), { maxLag: 0, removeMean: true, minOverlap: 2 }); expect(report.rows[0]!.coefficient).toBeCloseTo(1, 14); expect(report.rows[0]!.xEnergy).toBeCloseTo(2 * step ** 2, 22);
  });
  it.each([false, true])('keeps literal extreme Float64 mixtures finite and normalized for removeMean=%s', (removeMean) => {
    const left = [1e12, -1e12, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-200, -3e-200, 999999999999.9999], right = [-1e12, 1e12, -2 * Number.MIN_VALUE, 3 * Number.MIN_VALUE, -1e-200, 5e-200, -999999999999.9998];
    const report = analyzeSignalCorrelation(correlationInput(left, right), { maxLag: 4, removeMean, minOverlap: 2 }); report.rows.forEach((row) => { if (row.coefficient !== null) { expect(row.coefficient).toBeGreaterThanOrEqual(-1); expect(row.coefficient).toBeLessThanOrEqual(1); } }); finite(report);
  });
});

describe('M24 bounded plain-data and time-grid validation', () => {
  const base = statisticsInput([1, 4, -2, 7]), pair = correlationInput([1, 4, -2, 7], [2, 3, 5, 8]);
  it('copies frozen inputs privately and accepts explicit null-prototype records', () => {
    const source = structuredClone(pair); Object.freeze(source.times); Object.freeze(source.x); Object.freeze(source.y); Object.freeze(source); const settings = Object.freeze({ ...options }), before = structuredClone(source), report = analyzeSignalCorrelation(source, settings); report.rows[0]!.xMean = 99; expect(source).toEqual(before);
    expect(analyzeTimeStatistics(Object.assign(Object.create(null), base)).count).toBe(4); expect(analyzeSignalCorrelation(Object.assign(Object.create(null), pair), Object.assign(Object.create(null), options)).count).toBe(4);
  });
  it.each([0, 1, 8193])('rejects unsupported sample count %i without padding', (count) => { rejects(() => analyzeTimeStatistics(statisticsInput(Array(count).fill(1))), 'TIME_SERIES_COUNT'); });
  it('rejects mismatched statistics and X/Y sample counts', () => {
    rejects(() => analyzeTimeStatistics({ ...base, times: [0, 1] }), 'TIME_SERIES_COUNT'); rejects(() => analyzeSignalCorrelation({ ...pair, x: [1, 2] }, options), 'TIME_SERIES_COUNT'); rejects(() => analyzeSignalCorrelation({ ...pair, y: [1, 2] }, options), 'TIME_SERIES_COUNT');
  });
  it.each([NaN, Infinity, -Infinity, 1e12 + 1, -1e12 - 1, '2', null])('rejects unsupported value %j in statistics and both correlation vectors', (value) => {
    const source = structuredClone(base); (source.values as unknown[])[1] = value; rejects(() => analyzeTimeStatistics(source), 'TIME_SERIES_INPUT');
    for (const key of ['x', 'y'] as const) { const input = structuredClone(pair); (input[key] as unknown[])[1] = value; rejects(() => analyzeSignalCorrelation(input, options), 'TIME_SERIES_INPUT'); }
  });
  it.each([NaN, Infinity, -Infinity, 1e9 + 1, -1e9 - 1, '2', null])('rejects unsupported timestamp %j', (value) => {
    const source = structuredClone(base); (source.times as unknown[])[1] = value; rejects(() => analyzeTimeStatistics(source), 'TIME_SERIES_INPUT'); rejects(() => analyzeSignalCorrelation({ ...pair, times: source.times }, options), 'TIME_SERIES_INPUT');
  });
  it('rejects duplicate, decreasing, nonuniform, genuinely sub-nanosecond and precision-ambiguous grids', () => {
    for (const times of [[0, 1, 1, 3], [3, 2, 1, 0], [0, 1, 2.001, 3], [0, 0.999e-9, 1.998e-9, 2.997e-9]]) { rejects(() => analyzeTimeStatistics({ ...base, times }), 'TIME_SERIES_TIME_GRID'); rejects(() => analyzeSignalCorrelation({ ...pair, times }, options), 'TIME_SERIES_TIME_GRID'); }
    const ambiguous = base.values.map((_, index) => 1e8 + index * 1e-6); rejects(() => analyzeTimeStatistics({ ...base, times: ambiguous }), 'TIME_SERIES_TIME_PRECISION'); rejects(() => analyzeSignalCorrelation({ ...pair, times: ambiguous }, options), 'TIME_SERIES_TIME_PRECISION');
  });
  it.each([2, 3, 32, 8192])('accepts a reliable 1ns grid with %i samples including endpoint quotient roundoff', (count) => {
    const values = Array.from({ length: count }, (_, index) => index % 3 - 1), times = values.map((_, index) => index * 1e-9), stats = analyzeTimeStatistics({ times, values }), correlation = analyzeSignalCorrelation({ times, x: values, y: values }, { maxLag: 0, removeMean: true, minOverlap: 2 });
    expect(stats.sampleInterval).toBeGreaterThanOrEqual(1e-9); expect(stats.sampleInterval).toBeCloseTo(1e-9, 23); expect(correlation.sampleInterval).toBe(stats.sampleInterval); expect(correlation.rows[0]!.coefficient).toBeCloseTo(1, 14);
  });
  it('accepts bounded endpoint times and ordinary decimal grids but rejects a missing step', () => {
    expect(analyzeTimeStatistics(statisticsInput([1, 2], 1, 1e9 - 1)).endTime).toBe(1e9); expect(analyzeTimeStatistics(statisticsInput([1, 2], 1, -1e9)).startTime).toBe(-1e9);
    const source = statisticsInput(Array(127).fill(2), 0.1, 123.4); expect(analyzeTimeStatistics(source).count).toBe(127); source.times[63] = source.times[63]! + 0.01; rejects(() => analyzeTimeStatistics(source), 'TIME_SERIES_TIME_GRID');
  });
  it('rejects record, option and array accessors before any getter executes', () => {
    let called = 0;
    for (const key of ['times', 'values'] as const) { const source = structuredClone(base); Object.defineProperty(source, key, { enumerable: true, get: () => { called += 1; return base[key]; } }); rejects(() => analyzeTimeStatistics(source), 'TIME_SERIES_INPUT'); }
    for (const key of ['times', 'x', 'y'] as const) { const source = structuredClone(pair); Object.defineProperty(source, key, { enumerable: true, get: () => { called += 1; return pair[key]; } }); rejects(() => analyzeSignalCorrelation(source, options), 'TIME_SERIES_INPUT'); const nested = structuredClone(pair); Object.defineProperty(nested[key], '1', { enumerable: true, get: () => { called += 1; return 1; } }); rejects(() => analyzeSignalCorrelation(nested, options), 'TIME_SERIES_INPUT'); }
    for (const key of ['maxLag', 'removeMean', 'minOverlap'] as const) { const settings = { ...options }; Object.defineProperty(settings, key, { enumerable: true, get: () => { called += 1; return options[key]; } }); rejects(() => analyzeSignalCorrelation(pair, settings), 'TIME_SERIES_OPTIONS'); }
    const nested = structuredClone(base); Object.defineProperty(nested.values, '1', { enumerable: true, get: () => { called += 1; return 1; } }); rejects(() => analyzeTimeStatistics(nested), 'TIME_SERIES_INPUT'); expect(called).toBe(0);
  });
  it.each(['times', 'values'] as const)('rejects sparse, hidden, inherited, symbol, extra and typed statistics %s arrays', (key) => {
    for (const mutate of [
      (values: number[]) => { delete values[1]; return values; },
      (values: number[]) => Object.defineProperty(values, '1', { value: 2, enumerable: false }),
      (values: number[]) => Object.assign(values, { extra: 1 }),
      (values: number[]) => Object.assign(values, { [Symbol('extra')]: 1 }),
      (values: number[]) => { Object.setPrototypeOf(values, Object.create(Array.prototype)); return values; },
      (values: number[]) => new Float64Array(values),
      (values: number[]) => Object.defineProperty(values, '__proto__', { value: {}, enumerable: true }),
    ]) rejects(() => analyzeTimeStatistics({ ...base, [key]: mutate([...base[key]]) } as TimeSeriesInput), 'TIME_SERIES_INPUT');
  });
  it.each(['times', 'x', 'y'] as const)('rejects malformed correlation %s arrays', (key) => {
    const source = structuredClone(pair); delete source[key][1]; rejects(() => analyzeSignalCorrelation(source, options), 'TIME_SERIES_INPUT'); rejects(() => analyzeSignalCorrelation({ ...pair, [key]: new Float64Array(pair[key]) } as unknown as CorrelationInput, options), 'TIME_SERIES_INPUT');
  });
  it('rejects nonplain, missing, hidden, symbol and extra input fields', () => {
    for (const source of [null, new Date(), [], { times: base.times }, { ...base, extra: true }, { ...base, [Symbol('extra')]: 1 }, Object.defineProperty({ ...base }, 'values', { enumerable: false }), Object.assign(Object.create({ inherited: true }), base), Object.assign(JSON.parse('{"__proto__":{}}'), base)]) rejects(() => analyzeTimeStatistics(source as TimeSeriesInput), 'TIME_SERIES_INPUT');
    for (const source of [null, new Date(), [], { times: pair.times, x: pair.x }, { ...pair, extra: true }, { ...pair, [Symbol('extra')]: 1 }, Object.defineProperty({ ...pair }, 'y', { enumerable: false }), Object.assign(Object.create({ inherited: true }), pair)]) rejects(() => analyzeSignalCorrelation(source as CorrelationInput, options), 'TIME_SERIES_INPUT');
  });
  it.each([undefined, null, {}, { maxLag: 2 }, { ...options, maxLag: -1 }, { ...options, maxLag: 1.5 }, { ...options, maxLag: 513 }, { ...options, maxLag: 4 }, { ...options, maxLag: NaN }, { ...options, minOverlap: 1 }, { ...options, minOverlap: 5 }, { ...options, minOverlap: Infinity }, { ...options, minOverlap: 2.5 }, { ...options, removeMean: 'false' }, { ...options, removeMean: 0 }, { ...options, extra: true }, { ...options, [Symbol('extra')]: 1 }, new Date()])('rejects malformed or excessive options %j', (settings) => { rejects(() => analyzeSignalCorrelation(pair, settings as CorrelationOptions), 'TIME_SERIES_OPTIONS'); });
  it('accepts maxLag=0 and the literal lag boundary min(512,N−1)', () => {
    expect(analyzeSignalCorrelation(correlationInput([1, 2], [2, 4]), { maxLag: 0, removeMean: true, minOverlap: 2 }).rows).toHaveLength(1);
    const values = Array.from({ length: 513 }, (_, index) => index % 7), report = analyzeSignalCorrelation(correlationInput(values, values), { maxLag: 512, removeMean: true, minOverlap: 2 }); expect(report.rows).toHaveLength(1025); expect(report.rows[0]!.reason).toBe('insufficient-overlap'); expect(report.rows[1024]!.reason).toBe('insufficient-overlap');
  });
  it('preflights the whole lag budget, allowing the exact largest count for a requested range', () => {
    const lag = 64, cost = (count: number): number => 24 * count + 30 * ((2 * lag + 1) * count - lag * (lag + 1)) + 24 * (2 * lag + 1);
    const count = Math.floor((TIME_SERIES_LIMITS.work + 30 * lag * (lag + 1) - 24 * (2 * lag + 1)) / (24 + 30 * (2 * lag + 1))), values = Array.from({ length: count }, (_, index) => index % 7);
    const report = analyzeSignalCorrelation(correlationInput(values, values), { maxLag: lag, removeMean: true, minOverlap: 2 }); expect(report.work).toBe(cost(count)); expect(report.work).toBeLessThanOrEqual(TIME_SERIES_LIMITS.work); expect(cost(count + 1)).toBeGreaterThan(TIME_SERIES_LIMITS.work);
    const tooMany = [...values, 1]; rejects(() => analyzeSignalCorrelation(correlationInput(tooMany, tooMany), { maxLag: lag, removeMean: true, minOverlap: 2 }), 'TIME_SERIES_WORK_BUDGET');
    // Even rows hidden by an enormous minimum-overlap still consume computation.
    rejects(() => analyzeSignalCorrelation(correlationInput(tooMany, tooMany), { maxLag: lag, removeMean: false, minOverlap: tooMany.length }), 'TIME_SERIES_WORK_BUDGET');
  });
});
