import { ModelError } from '../../model/src';

export const SPECTRUM_LIMITS = Object.freeze({ samples: 8192, minSamples: 8, maxValue: 1e12, maxTime: 1e9, work: 2_000_000 });
export interface SpectrumInput { times: number[]; values: number[] }
export interface SpectrumOptions { window: 'rectangular' | 'hann'; removeMean: boolean }
export interface SpectrumBin { index: number; frequency: number; real: number; imag: number; amplitude: number; powerDensity: number; phaseDegrees: number | null }
export interface SpectrumReport {
  method: 'radix2-periodogram'; count: number; startTime: number; endTime: number; sampleInterval: number; sampleRate: number; frequencyResolution: number; nyquist: number;
  window: SpectrumOptions['window']; removeMean: boolean; mean: number; rms: number; windowCoherentGain: number; windowPowerGain: number; integratedPower: number;
  peak: { index: number; frequency: number; amplitude: number } | null; bins: SpectrumBin[]; diagnostics: string[]; work: number;
}

function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
/** Inspect descriptors before reading values: caller-supplied accessors must never execute. */
function plain(value: unknown, keys: readonly string[], code: string): Record<string, PropertyDescriptor> {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, '일반 데이터 객체만 사용할 수 있습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail(code, '필수 데이터 필드만 사용해 주세요. 접근자·숨김 필드·추가 필드는 허용하지 않습니다.');
  return descriptors;
}
function vector(value: unknown, label: string, maximum: number): number[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('SPECTRUM_INPUT', `${label}은 일반 실수 배열이어야 합니다.`);
  // Array length is a non-configurable own data property, including for sparse arrays.
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < SPECTRUM_LIMITS.minSamples || length > SPECTRUM_LIMITS.samples || (length & (length - 1)) !== 0) fail('SPECTRUM_COUNT', '표본 수는 8~8192 범위의 2의 거듭제곱이어야 합니다. 자르거나 0으로 채우지 않습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== length + 1 || own.some((key) => typeof key !== 'string' || key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable))) fail('SPECTRUM_INPUT', `${label}의 빈 칸·접근자·숨김 원소·추가 필드는 허용하지 않습니다.`);
  const result: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const cell = descriptors[String(index)]!.value as unknown;
    if (typeof cell !== 'number' || !Number.isFinite(cell) || Math.abs(cell) > maximum) fail('SPECTRUM_INPUT', `${label}은 절댓값 ${maximum} 이하의 유한한 실수여야 합니다.`);
    result.push(cell);
  }
  return result;
}
function compensatedSum(values: readonly number[]): number {
  let total = 0, correction = 0;
  for (const value of values) { const next = total + value; correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total; total = next; }
  return total + correction;
}
function timeGrid(times: number[]): { interval: number; rate: number } {
  const count = times.length, first = times[0]!, last = times[count - 1]!, rawInterval = (last - first) / (count - 1), minimumInterval = 1e-9;
  // The endpoint quotient can round a valid 1ns grid down by one ULP. Only that
  // boundary roundoff is normalized; a genuinely smaller interval is rejected.
  if (!Number.isFinite(rawInterval) || rawInterval < minimumInterval && minimumInterval - rawInterval > 8 * Number.EPSILON * minimumInterval) fail('SPECTRUM_TIME_GRID', '시간은 증가하는 균일 격자이며 간격은 10⁻⁹초 이상이어야 합니다.');
  const interval = Math.max(minimumInterval, rawInterval);
  // Refuse a grid whose timestamps cannot reliably express the proposed interval.
  const resolution = 8 * Number.EPSILON * Math.max(1, ...times.map(Math.abs));
  if (resolution > interval / 8) fail('SPECTRUM_TIME_PRECISION', '시간의 절댓값에 비해 표본 간격이 작아 균일 격자를 확인할 수 없습니다. 시간 원점을 옮기거나 간격을 늘려 주세요.');
  const tolerance = Math.min(interval / 8, Math.max(resolution, Math.min(1e-12, interval * 1e-6)));
  for (let index = 1; index < count; index += 1) {
    if (times[index]! <= times[index - 1]! || Math.abs(times[index]! - (first + index * interval)) > tolerance) fail('SPECTRUM_TIME_GRID', '시간 격자가 균일하지 않습니다. 보간하거나 균일 표본으로 간주하지 않습니다.');
  }
  return { interval, rate: 1 / interval };
}

/** One-sided real-signal periodogram. FFT is the unnormalized exp(-j2πkn/N) DFT. */
export function analyzeSpectrum(input: SpectrumInput, options: SpectrumOptions): SpectrumReport {
  const inputData = plain(input, ['times', 'values'], 'SPECTRUM_INPUT'), optionData = plain(options, ['window', 'removeMean'], 'SPECTRUM_OPTIONS');
  const window = optionData.window!.value as unknown, removeMean = optionData.removeMean!.value as unknown;
  if (window !== 'rectangular' && window !== 'hann' || typeof removeMean !== 'boolean') fail('SPECTRUM_OPTIONS', '창은 rectangular 또는 hann, 평균 제거는 명시적인 boolean이어야 합니다.');
  const times = vector(inputData.times!.value, '시간', SPECTRUM_LIMITS.maxTime), values = vector(inputData.values!.value, '값', SPECTRUM_LIMITS.maxValue);
  if (times.length !== values.length) fail('SPECTRUM_COUNT', '시간과 값의 표본 수가 같아야 합니다.');
  const count = values.length, { interval, rate } = timeGrid(times), resolution = rate / count, mean = compensatedSum(values) / count, rms = Math.sqrt(compensatedSum(values.map((value) => value * value)) / count);
  let work = 0;
  const charge = (amount: number): void => { work += amount; if (work > SPECTRUM_LIMITS.work) fail('SPECTRUM_WORK_BUDGET', '스펙트럼 분석의 계산 상한을 초과했습니다.'); };
  charge(count * 10);
  const weights = Array.from({ length: count }, (_, index) => window === 'hann' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * index / count) : 1), sumWeights = compensatedSum(weights), sumSquares = compensatedSum(weights.map((weight) => weight * weight));
  const real = values.map((value, index) => (value - (removeMean ? mean : 0)) * weights[index]!), imag = Array<number>(count).fill(0), maximumWindowed = Math.max(...real.map(Math.abs));
  // In-place bit reversal and bounded iterative butterflies; all arrays are private copies.
  for (let index = 1, reversed = 0; index < count; index += 1) {
    charge(2); let bit = count >> 1;
    for (; reversed & bit; bit >>= 1) { charge(1); reversed ^= bit; }
    reversed ^= bit;
    if (index < reversed) [real[index], real[reversed]] = [real[reversed]!, real[index]!];
  }
  for (let size = 2; size <= count; size *= 2) {
    const half = size / 2;
    for (let offset = 0; offset < count; offset += size) for (let index = 0; index < half; index += 1) {
      charge(14);
      const angle = -2 * Math.PI * index / size, cosine = Math.cos(angle), sine = Math.sin(angle), left = offset + index, right = left + half;
      const productReal = real[right]! * cosine - imag[right]! * sine, productImag = real[right]! * sine + imag[right]! * cosine, beforeReal = real[left]!, beforeImag = imag[left]!;
      real[left] = beforeReal + productReal; imag[left] = beforeImag + productImag; real[right] = beforeReal - productReal; imag[right] = beforeImag - productImag;
    }
  }
  const threshold = 1e-12 * Math.max(1, maximumWindowed) * count, bins: SpectrumBin[] = [];
  let peak: SpectrumReport['peak'] = null;
  for (let index = 0; index <= count / 2; index += 1) {
    charge(12);
    const rawReal = real[index]!, rawImag = imag[index]!, magnitude = Math.hypot(rawReal, rawImag), factor = index === 0 || index === count / 2 ? 1 : 2;
    const bin: SpectrumBin = { index, frequency: index * resolution, real: rawReal, imag: rawImag, amplitude: factor * magnitude / sumWeights, powerDensity: factor * (magnitude * magnitude) / (rate * sumSquares), phaseDegrees: magnitude <= threshold ? null : Math.atan2(rawImag, rawReal) * 180 / Math.PI };
    if (![bin.frequency, bin.real, bin.imag, bin.amplitude, bin.powerDensity].every(Number.isFinite)) fail('SPECTRUM_NUMERIC', '스펙트럼 계산의 유한한 수치 범위를 초과했습니다.');
    bins.push(bin);
    if (index > 0 && magnitude > threshold && (peak === null || bin.amplitude > peak.amplitude)) peak = { index, frequency: bin.frequency, amplitude: bin.amplitude };
  }
  const integratedPower = compensatedSum(bins.map((bin) => bin.powerDensity)) * resolution;
  const diagnostics = [
    '실수 표본의 단측 스펙트럼입니다. DC와 Nyquist 항은 두 배로 늘리지 않습니다.',
    '진폭은 Σw, 전력 밀도는 표본 주파수×Σ(w²)로 정규화합니다. Hann은 주기형 창입니다.',
    '위상은 첫 표본을 기준으로 합니다. 창이 적용된 원시 DFT 크기가 10⁻¹²×max(1, 최대 창 적용 값)×N 이하이면 위상을 표시하지 않습니다.',
    '최대 성분은 DC를 제외합니다. 주파수 누설·해상도·aliasing을 자동 보정하지 않습니다.',
  ];
  if (removeMean) diagnostics.push('창을 적용하기 전에 선택 표본의 산술 평균을 제거했습니다. mean과 rms는 평균 제거 전 원시 표본 통계입니다.');
  if (peak === null) diagnostics.push('위상 표시 문턱을 넘는 DC 이외 성분이 없습니다. 최대 주파수를 만들어 표시하지 않습니다.');
  return { method: 'radix2-periodogram', count, startTime: times[0]!, endTime: times[count - 1]!, sampleInterval: interval, sampleRate: rate, frequencyResolution: resolution, nyquist: rate / 2, window, removeMean, mean, rms, windowCoherentGain: sumWeights / count, windowPowerGain: sumSquares / count, integratedPower, peak, bins, diagnostics, work };
}
