import { ModelError } from '../../model/src';

export const TIME_SERIES_LIMITS = Object.freeze({ samples: 8192, minSamples: 2, maxLag: 512, minOverlap: 2, maxValue: 1e12, maxTime: 1e9, work: 20_000_000 });
export interface TimeSeriesInput { times: number[]; values: number[] }
export interface TimeStatisticsReport {
  method: 'sample-statistics'; weighting: 'equal-samples'; count: number; startTime: number; endTime: number; sampleInterval: number;
  mean: number; variancePopulation: number; varianceSample: number; standardDeviationPopulation: number; standardDeviationSample: number;
  rms: number; min: number; max: number; populationDivisor: number; sampleDivisor: number; diagnostics: string[]; work: number;
}
export interface CorrelationInput { times: number[]; x: number[]; y: number[] }
export interface CorrelationOptions { maxLag: number; removeMean: boolean; minOverlap: number }
export interface CorrelationRow {
  lag: number; lagSeconds: number; overlapCount: number; xStartIndex: number; xEndIndex: number; yStartIndex: number; yEndIndex: number;
  xStartTime: number; xEndTime: number; yStartTime: number; yEndTime: number; xMean: number; yMean: number;
  numerator: number; xEnergy: number; yEnergy: number; denominator: number;
  scaleX: number; scaleY: number; scaledNumerator: number; scaledXEnergy: number; scaledYEnergy: number; scaledDenominator: number;
  coefficient: number | null; reason: 'zero-energy' | 'insufficient-overlap' | null;
}
export interface CorrelationReport {
  method: 'overlap-normalized-correlation'; count: number; startTime: number; endTime: number; sampleInterval: number; maxLag: number; removeMean: boolean; minOverlap: number;
  demeaning: 'per-overlap' | 'none'; normalization: 'overlap-energy'; lagConvention: 'positive-y-follows-x'; rows: CorrelationRow[];
  peak: { lag: number; lagSeconds: number; coefficient: number; overlapCount: number } | null; diagnostics: string[]; work: number;
}

function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
/** Check own data descriptors before any supplied property can be read. */
function plain(value: unknown, keys: readonly string[], code: string): Record<string, PropertyDescriptor> {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, '일반 데이터 객체만 사용할 수 있습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail(code, '필수 데이터 필드만 사용해 주세요. 접근자·숨김 필드·추가 필드는 허용하지 않습니다.');
  return descriptors;
}
function vector(value: unknown, label: string, maximum: number): number[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('TIME_SERIES_INPUT', `${label}은 일반 실수 배열이어야 합니다.`);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < TIME_SERIES_LIMITS.minSamples || length > TIME_SERIES_LIMITS.samples) fail('TIME_SERIES_COUNT', '표본 수는 2~8192 범위여야 합니다. 자르거나 0으로 채우지 않습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== length + 1 || own.some((key) => typeof key !== 'string' || key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable))) fail('TIME_SERIES_INPUT', `${label}의 빈 칸·접근자·숨김 원소·추가 필드는 허용하지 않습니다.`);
  const result: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const cell = descriptors[String(index)]!.value as unknown;
    if (typeof cell !== 'number' || !Number.isFinite(cell) || Math.abs(cell) > maximum) fail('TIME_SERIES_INPUT', `${label}은 절댓값 ${maximum} 이하의 유한한 실수여야 합니다.`);
    result.push(cell);
  }
  return result;
}
function sum(values: readonly number[]): number {
  let total = 0, correction = 0;
  for (const value of values) { const next = total + value; correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total; total = next; }
  return total + correction;
}
function timeGrid(times: readonly number[]): number {
  const count = times.length, first = times[0]!, rawInterval = (times[count - 1]! - first) / (count - 1), minimumInterval = 1e-9;
  // As in the spectrum contract, normalize only endpoint-quotient boundary roundoff.
  if (!Number.isFinite(rawInterval) || rawInterval < minimumInterval && minimumInterval - rawInterval > 8 * Number.EPSILON * minimumInterval) fail('TIME_SERIES_TIME_GRID', '시간은 증가하는 균일 격자이며 간격은 10⁻⁹초 이상이어야 합니다.');
  const interval = Math.max(minimumInterval, rawInterval), resolution = 8 * Number.EPSILON * Math.max(1, ...times.map(Math.abs));
  if (resolution > interval / 8) fail('TIME_SERIES_TIME_PRECISION', '시간의 절댓값에 비해 표본 간격이 작아 균일 격자를 확인할 수 없습니다. 시간 원점을 옮기거나 간격을 늘려 주세요.');
  const tolerance = Math.min(interval / 8, Math.max(resolution, Math.min(1e-12, interval * 1e-6)));
  for (let index = 1; index < count; index += 1) if (times[index]! <= times[index - 1]! || Math.abs(times[index]! - (first + index * interval)) > tolerance) fail('TIME_SERIES_TIME_GRID', '시간 격자가 균일하지 않습니다. 보간하거나 균일 표본으로 간주하지 않습니다.');
  return interval;
}
interface ScaledSegment { mean: number; scale: number; values: number[]; energy: number }
function segment(source: readonly number[], start: number, count: number, center: boolean): ScaledSegment {
  const raw = source.slice(start, start + count), mean = sum(raw) / count;
  // Center relative to an actual sample first. Rounding a huge absolute mean must
  // not inject extra variance into a nearly constant signal.
  const shifted = center ? raw.map((value) => value - raw[0]!) : raw;
  const scale = Math.max(...shifted.map(Math.abs));
  if (scale === 0) return { mean, scale: 0, values: Array<number>(count).fill(0), energy: 0 };
  const normalized = shifted.map((value) => value / scale), offset = center ? sum(normalized) / count : 0;
  const values = normalized.map((value) => value - offset), energy = sum(values.map((value) => value * value));
  return { mean, scale, values, energy };
}
/** Multiplying the larger scale first avoids a gratuitous subnormal intermediate. */
function dimensional(value: number, scaleX: number, scaleY: number): number { const result = value * Math.max(scaleX, scaleY) * Math.min(scaleX, scaleY); return result === 0 ? 0 : result; }
function finiteNumbers(values: readonly number[]): void { if (values.some((value) => !Number.isFinite(value))) fail('TIME_SERIES_NUMERIC', '시계열 분석의 유한한 수치 범위를 초과했습니다.'); }

/** Equal-weight sample statistics, with both explicit population and sample divisors. */
export function analyzeTimeStatistics(input: TimeSeriesInput): TimeStatisticsReport {
  const data = plain(input, ['times', 'values'], 'TIME_SERIES_INPUT'), times = vector(data.times!.value, '시간', TIME_SERIES_LIMITS.maxTime), values = vector(data.values!.value, '값', TIME_SERIES_LIMITS.maxValue);
  if (times.length !== values.length) fail('TIME_SERIES_COUNT', '시간과 값의 표본 수가 같아야 합니다.');
  const count = values.length, sampleInterval = timeGrid(times), centered = segment(values, 0, count, true), raw = segment(values, 0, count, false);
  const variancePopulation = dimensional(centered.energy / count, centered.scale, centered.scale), varianceSample = dimensional(centered.energy / (count - 1), centered.scale, centered.scale);
  const standardDeviationPopulation = centered.scale * Math.sqrt(centered.energy / count), standardDeviationSample = centered.scale * Math.sqrt(centered.energy / (count - 1)), rms = raw.scale * Math.sqrt(raw.energy / count);
  finiteNumbers([centered.mean, variancePopulation, varianceSample, standardDeviationPopulation, standardDeviationSample, rms]);
  const diagnostics = [
    '각 표본의 가중치는 같습니다. 시간 적분·보간·결측치 보정은 수행하지 않습니다.',
    '모집단 분산은 편차 제곱합/N, 표본 분산은 편차 제곱합/(N−1)입니다. 표본 분산은 독립 표본 등 통계적 가정을 자동 확인하지 않습니다.',
    '중심화와 제곱합은 스케일 조정 및 보상 합산으로 계산합니다. 제곱 단위 값이 Float64 표현 범위보다 작으면 0으로 반올림될 수 있으며 표준편차와 RMS는 별도로 계산합니다.',
  ];
  if (centered.energy === 0) diagnostics.push('선택 표본이 상수이므로 모집단·표본 분산과 표준편차가 0입니다.');
  return { method: 'sample-statistics', weighting: 'equal-samples', count, startTime: times[0]!, endTime: times[count - 1]!, sampleInterval, mean: centered.mean, variancePopulation, varianceSample, standardDeviationPopulation, standardDeviationSample, rms, min: Math.min(...values), max: Math.max(...values), populationDivisor: count, sampleDivisor: count - 1, diagnostics, work: count * 24 };
}

/** Positive lag k pairs x[i] with y[i+k]; centering uses each actual overlap. */
export function analyzeSignalCorrelation(input: CorrelationInput, options: CorrelationOptions): CorrelationReport {
  const data = plain(input, ['times', 'x', 'y'], 'TIME_SERIES_INPUT'), optionData = plain(options, ['maxLag', 'removeMean', 'minOverlap'], 'TIME_SERIES_OPTIONS');
  const maxLag = optionData.maxLag!.value as unknown, removeMean = optionData.removeMean!.value as unknown, minOverlap = optionData.minOverlap!.value as unknown;
  if (typeof maxLag !== 'number' || !Number.isSafeInteger(maxLag) || maxLag < 0 || maxLag > TIME_SERIES_LIMITS.maxLag || typeof removeMean !== 'boolean' || typeof minOverlap !== 'number' || !Number.isSafeInteger(minOverlap) || minOverlap < TIME_SERIES_LIMITS.minOverlap) fail('TIME_SERIES_OPTIONS', '최대 lag는 0~512 정수, 평균 제거는 명시적인 boolean, 최소 겹침은 2 이상 정수여야 합니다.');
  const times = vector(data.times!.value, '시간', TIME_SERIES_LIMITS.maxTime), x = vector(data.x!.value, 'X', TIME_SERIES_LIMITS.maxValue), y = vector(data.y!.value, 'Y', TIME_SERIES_LIMITS.maxValue), count = times.length;
  if (x.length !== count || y.length !== count) fail('TIME_SERIES_COUNT', '시간과 X·Y의 표본 수가 같아야 합니다.');
  if (maxLag >= count || minOverlap > count) fail('TIME_SERIES_OPTIONS', '최대 lag는 표본 수−1 이하, 최소 겹침은 표본 수 이하여야 합니다.');
  const sampleInterval = timeGrid(times);
  // Exact pair count for symmetric lags, converted into deterministic budget
  // units (not a literal count of JS floating operations). Bound before segment loops,
  // including rows that will be null because their overlap is below minOverlap.
  const pairs = (2 * maxLag + 1) * count - maxLag * (maxLag + 1), work = 24 * count + 30 * pairs + 24 * (2 * maxLag + 1);
  if (work > TIME_SERIES_LIMITS.work) fail('TIME_SERIES_WORK_BUDGET', '상관 분석의 계산 상한 20,000,000을 초과했습니다. 표본 수 또는 최대 lag를 줄여 주세요.');
  const rows: CorrelationRow[] = [], tieTolerance = 32 * Number.EPSILON, boundTolerance = 64 * Number.EPSILON;
  let peak: CorrelationReport['peak'] = null;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const overlapCount = count - Math.abs(lag), xStartIndex = Math.max(0, -lag), yStartIndex = Math.max(0, lag), xEndIndex = xStartIndex + overlapCount - 1, yEndIndex = yStartIndex + overlapCount - 1;
    const xs = segment(x, xStartIndex, overlapCount, removeMean), ys = segment(y, yStartIndex, overlapCount, removeMean), scaledNumerator = sum(xs.values.map((value, index) => value * ys.values[index]!));
    const scaledDenominator = Math.sqrt(xs.energy) * Math.sqrt(ys.energy), numerator = dimensional(scaledNumerator, xs.scale, ys.scale), xEnergy = dimensional(xs.energy, xs.scale, xs.scale), yEnergy = dimensional(ys.energy, ys.scale, ys.scale), denominator = dimensional(scaledDenominator, xs.scale, ys.scale);
    const reason = overlapCount < minOverlap ? 'insufficient-overlap' : xs.energy === 0 || ys.energy === 0 ? 'zero-energy' : null;
    let coefficient: number | null = reason === null ? scaledNumerator / scaledDenominator : null;
    if (coefficient !== null) {
      if (!Number.isFinite(coefficient) || Math.abs(coefficient) > 1 + boundTolerance) fail('TIME_SERIES_NUMERIC', '정규화 상관계수가 허용 수치 범위를 초과했습니다.');
      coefficient = Math.max(-1, Math.min(1, coefficient));
      if (Object.is(coefficient, -0)) coefficient = 0;
    }
    const row: CorrelationRow = { lag, lagSeconds: lag * sampleInterval, overlapCount, xStartIndex, xEndIndex, yStartIndex, yEndIndex, xStartTime: times[xStartIndex]!, xEndTime: times[xEndIndex]!, yStartTime: times[yStartIndex]!, yEndTime: times[yEndIndex]!, xMean: xs.mean, yMean: ys.mean, numerator, xEnergy, yEnergy, denominator, scaleX: xs.scale, scaleY: ys.scale, scaledNumerator, scaledXEnergy: xs.energy, scaledYEnergy: ys.energy, scaledDenominator, coefficient, reason };
    finiteNumbers([row.lagSeconds, row.xMean, row.yMean, numerator, xEnergy, yEnergy, denominator, xs.scale, ys.scale, scaledNumerator, xs.energy, ys.energy, scaledDenominator]);
    rows.push(row);
    if (coefficient === null) continue;
    const difference = peak === null ? Infinity : Math.abs(coefficient) - Math.abs(peak.coefficient), tied = Math.abs(difference) <= tieTolerance;
    if (peak === null || difference > tieTolerance || tied && (overlapCount > peak.overlapCount || overlapCount === peak.overlapCount && (Math.abs(lag) < Math.abs(peak.lag) || Math.abs(lag) === Math.abs(peak.lag) && lag < peak.lag))) peak = { lag, lagSeconds: row.lagSeconds, coefficient, overlapCount };
  }
  const diagnostics = [
    '양의 lag k는 X[i]와 Y[i+k]를 비교하며 Y가 X 뒤에 오는 방향입니다. 보간·신호 외삽·자동 지연 보정은 수행하지 않습니다.',
    removeMean ? '각 lag의 실제 겹침 구간에서 X·Y의 평균을 각각 제거합니다. 전체 선택 구간 평균을 재사용하지 않습니다.' : '평균을 제거하지 않은 원시 표본의 코사인 상관입니다. Pearson 상관으로 해석하지 마세요.',
    '분자는 겹침 곱의 합, 분모는 겹침 X·Y 제곱합의 제곱근 곱입니다. 스케일 조정 값으로 계수를 계산하므로 원시 제곱 단위 값이 0으로 반올림되어도 영 에너지로 간주하지 않습니다.',
    '최대 후보는 유한 계수의 절댓값으로 선택합니다. 32×Number.EPSILON 이내 동률은 더 큰 겹침, 작은 |lag|, 음의 lag 순으로 정합니다. 이 후보는 확정 지연·인과관계 또는 통계적 유의성이 아닙니다.',
    '계산 예산 단위는 24×N + 30×Σ(각 lag 겹침 수) + 24×(2×최대 lag+1)입니다. 실제 부동소수점 연산 횟수는 아닙니다. 겹침 부족 행도 포함하며 시작 전에 상한을 확인합니다.',
  ];
  if (peak === null) diagnostics.push('선택한 최소 겹침을 충족하는 영 에너지 이외 행이 없어 최대 후보를 표시하지 않습니다.');
  return { method: 'overlap-normalized-correlation', count, startTime: times[0]!, endTime: times[count - 1]!, sampleInterval, maxLag, removeMean, minOverlap, demeaning: removeMean ? 'per-overlap' : 'none', normalization: 'overlap-energy', lagConvention: 'positive-y-follows-x', rows, peak, diagnostics, work };
}
