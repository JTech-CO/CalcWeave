import { ModelError } from '../../model/src';
import { analyzeSpectrum, type SpectrumBin, type SpectrumOptions } from './spectrum';
import { analyzeTimeStatistics } from './time-series-statistics';

export const TIME_FREQUENCY_LIMITS = Object.freeze({ samples: 8192, minSamples: 8, segmentLength: 2048, minSegmentLength: 8, frames: 128, bins: 65536, work: 8_000_000, maxValue: 1e12, maxTime: 1e9 });
export interface TimeFrequencyInput { times: number[]; values: number[] }
export interface TimeFrequencyOptions { segmentLength: number; overlap: number; window: SpectrumOptions['window']; removeMean: boolean; tail: 'discard' }
export interface TimeFrequencyPlan {
  count: number; segmentLength: number; overlap: number; hop: number; frameCount: number; binsPerFrame: number; totalBins: number; usedCount: number; discardedCount: number; work: number;
}
export interface WelchBin { index: number; frequency: number; powerDensity: number }
export interface TimeFrequencyFrame {
  index: number; startIndex: number; endIndex: number; startTime: number; endTime: number; centerTime: number; mean: number; rms: number; integratedPower: number; bins: SpectrumBin[];
}
export interface TimeFrequencyReport extends TimeFrequencyPlan {
  method: 'welch-stft-periodogram'; startTime: number; endTime: number; usedEndTime: number; discardedStartTime: number | null; sampleInterval: number; sampleRate: number; frequencyResolution: number; nyquist: number;
  window: SpectrumOptions['window']; removeMean: boolean; tail: 'discard'; averaging: 'arithmetic-periodograms'; normalization: 'one-sided-density'; coefficients: 'unnormalized-forward-dft'; frameTimeConvention: 'midpoint-first-last-sample';
  windowCoherentGain: number; windowPowerGain: number; mean: number; rms: number; integratedPower: number; welchPeak: { index: number; frequency: number; powerDensity: number } | null;
  welchBins: WelchBin[]; frames: TimeFrequencyFrame[]; diagnostics: string[];
}

function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
/** Caller data is inspected through descriptors, before any value can be read. */
function plain(value: unknown, keys: readonly string[], code: string): Record<string, PropertyDescriptor> {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, '일반 데이터 객체만 사용할 수 있습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail(code, '필수 데이터 필드만 사용해 주세요. 접근자·숨김 필드·추가 필드는 허용하지 않습니다.');
  return descriptors;
}
function validatedOptions(value: TimeFrequencyOptions): TimeFrequencyOptions {
  const descriptors = plain(value, ['segmentLength', 'overlap', 'window', 'removeMean', 'tail'], 'TIME_FREQUENCY_OPTIONS');
  const segmentLength = descriptors.segmentLength!.value as unknown, overlap = descriptors.overlap!.value as unknown, window = descriptors.window!.value as unknown, removeMean = descriptors.removeMean!.value as unknown, tail = descriptors.tail!.value as unknown;
  if (typeof segmentLength !== 'number' || !Number.isSafeInteger(segmentLength) || segmentLength < TIME_FREQUENCY_LIMITS.minSegmentLength || segmentLength > TIME_FREQUENCY_LIMITS.segmentLength || (segmentLength & (segmentLength - 1)) !== 0) fail('TIME_FREQUENCY_OPTIONS', '프레임 길이는 8~2048 범위의 2의 거듭제곱이어야 합니다.');
  if (typeof overlap !== 'number' || !Number.isSafeInteger(overlap) || overlap < 0 || overlap >= segmentLength) fail('TIME_FREQUENCY_OPTIONS', '겹침은 0 이상이고 프레임 길이보다 작은 정수여야 합니다.');
  if (window !== 'rectangular' && window !== 'hann' || typeof removeMean !== 'boolean' || tail !== 'discard') fail('TIME_FREQUENCY_OPTIONS', '창과 명시적인 평균 제거 boolean, 완전한 프레임만 사용하는 discard 정책을 선택해 주세요.');
  return { segmentLength, overlap, window, removeMean, tail };
}
function countValue(count: unknown): number {
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < TIME_FREQUENCY_LIMITS.minSamples || count > TIME_FREQUENCY_LIMITS.samples) fail('TIME_FREQUENCY_COUNT', '표본 수는 8~8192 범위의 정수여야 합니다. 자르거나 0으로 채우지 않습니다.');
  return count;
}
function vector(value: unknown, label: string, maximum: number): number[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('TIME_FREQUENCY_INPUT', `${label}은 일반 실수 배열이어야 합니다.`);
  const count = countValue(Object.getOwnPropertyDescriptor(value, 'length')?.value);
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== count + 1 || own.some((key) => typeof key !== 'string' || key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= count || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable))) fail('TIME_FREQUENCY_INPUT', `${label}의 빈 칸·접근자·숨김 원소·추가 필드는 허용하지 않습니다.`);
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const valueAtIndex = descriptors[String(index)]!.value as unknown;
    if (typeof valueAtIndex !== 'number' || !Number.isFinite(valueAtIndex) || Math.abs(valueAtIndex) > maximum) fail('TIME_FREQUENCY_INPUT', `${label}은 절댓값 ${maximum} 이하의 유한한 실수여야 합니다.`);
    result.push(valueAtIndex);
  }
  return result;
}
function compensatedSum(values: readonly number[]): number {
  let total = 0, correction = 0;
  for (const value of values) { const next = total + value; correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total; total = next; }
  return total + correction;
}
function plan(count: number, options: TimeFrequencyOptions): TimeFrequencyPlan {
  const { segmentLength, overlap } = options;
  if (segmentLength > count) fail('TIME_FREQUENCY_OPTIONS', '프레임 길이는 선택한 표본 수 이하여야 합니다.');
  const hop = segmentLength - overlap, frameCount = 1 + Math.floor((count - segmentLength) / hop), binsPerFrame = segmentLength / 2 + 1, totalBins = frameCount * binsPerFrame;
  const usedCount = (frameCount - 1) * hop + segmentLength, discardedCount = count - usedCount, stages = Math.log2(segmentLength);
  // A conservative, deterministic preflight budget; units are not exact FLOPs.
  // The reversal bound also covers every data-dependent inner reversal step.
  const frameFFT = 10 * segmentLength + (segmentLength - 1) * (2 + stages) + 14 * (segmentLength / 2) * stages + 12 * binsPerFrame;
  const work = 24 * count + frameCount * (frameFFT + 2 * segmentLength + 4 * binsPerFrame) + 4 * binsPerFrame;
  if (frameCount > TIME_FREQUENCY_LIMITS.frames) fail('TIME_FREQUENCY_FRAMES', '프레임 수의 상한 128을 초과했습니다. 프레임 길이나 이동 간격을 늘려 주세요.');
  if (totalBins > TIME_FREQUENCY_LIMITS.bins) fail('TIME_FREQUENCY_BINS', '전체 프레임 주파수 행의 상한 65536을 초과했습니다. 선택 구간이나 겹침을 줄여 주세요.');
  if (work > TIME_FREQUENCY_LIMITS.work) fail('TIME_FREQUENCY_WORK_BUDGET', '시간·주파수 분석의 계산 상한을 초과했습니다. 선택 구간이나 겹침을 줄여 주세요.');
  return { count, segmentLength, overlap, hop, frameCount, binsPerFrame, totalBins, usedCount, discardedCount, work };
}

/** Validate allocation and calculation bounds without reading signal samples. */
export function planTimeFrequency(count: number, options: TimeFrequencyOptions): TimeFrequencyPlan { return plan(countValue(count), validatedOptions(options)); }

/** Complete real-signal frames, with Welch averaging of powers rather than complex coefficients. */
export function analyzeTimeFrequency(input: TimeFrequencyInput, options: TimeFrequencyOptions): TimeFrequencyReport {
  const descriptors = plain(input, ['times', 'values'], 'TIME_FREQUENCY_INPUT'), settings = validatedOptions(options);
  const times = vector(descriptors.times!.value, '시간', TIME_FREQUENCY_LIMITS.maxTime), values = vector(descriptors.values!.value, '값', TIME_FREQUENCY_LIMITS.maxValue);
  if (times.length !== values.length) fail('TIME_FREQUENCY_COUNT', '시간과 값의 표본 수가 같아야 합니다.');
  const allocation = plan(values.length, settings), statistics = analyzeTimeStatistics({ times, values });
  const sampleInterval = statistics.sampleInterval, sampleRate = 1 / sampleInterval, frequencyResolution = sampleRate / settings.segmentLength, frames: TimeFrequencyFrame[] = [];
  let windowCoherentGain = 0, windowPowerGain = 0, densityUnderflowFrames = 0, rmsUnderflowFrames = 0;
  const originalSingleFrame = allocation.count === settings.segmentLength;
  for (let index = 0; index < allocation.frameCount; index += 1) {
    const startIndex = index * allocation.hop, endIndex = startIndex + settings.segmentLength - 1;
    const frameValues = values.slice(startIndex, endIndex + 1);
    // The full selection has already passed ONE time-grid check. FFT phase is
    // relative to sample indices, so an internal unit-index coordinate avoids
    // refitting endpoint timestamp roundoff in each accepted subframe. Values
    // are unchanged; original timestamps below remain the report's only times.
    // Keep the original M21 path only when N=L, including its exact bits. A
    // retained single frame with a discarded tail still uses the global grid.
    const frameTimes = originalSingleFrame ? times.slice(startIndex, endIndex + 1) : Array.from({ length: settings.segmentLength }, (_, sample) => sample);
    const frame = analyzeSpectrum({ times: frameTimes, values: frameValues }, { window: settings.window, removeMean: settings.removeMean });
    const bins = frame.bins.map((bin) => {
      if (originalSingleFrame) return { ...bin };
      const factor = bin.index === 0 || bin.index === settings.segmentLength / 2 ? 1 : 2;
      // Normalize magnitude BEFORE squaring. A tiny raw square/unit-grid PSD
      // can underflow although the actual common-rate density is representable.
      const normalized = Math.hypot(bin.real, bin.imag) * Math.sqrt(factor / (sampleRate * settings.segmentLength * frame.windowPowerGain));
      return { ...bin, frequency: bin.index * frequencyResolution, powerDensity: normalized * normalized };
    });
    if (bins.some((bin) => bin.powerDensity === 0 && (bin.real !== 0 || bin.imag !== 0))) densityUnderflowFrames += 1;
    if (frame.rms === 0 && frameValues.some((value) => value !== 0)) rmsUnderflowFrames += 1;
    const integratedPower = compensatedSum(bins.map((bin) => bin.powerDensity)) * frequencyResolution, startTime = times[startIndex]!, endTime = times[endIndex]!;
    if (!Number.isFinite(integratedPower) || bins.some((bin) => !Number.isFinite(bin.frequency) || !Number.isFinite(bin.powerDensity))) fail('TIME_FREQUENCY_NUMERIC', '시간·주파수 분석의 유한한 수치 범위를 초과했습니다.');
    frames.push({ index, startIndex, endIndex, startTime, endTime, centerTime: startTime + (endTime - startTime) / 2, mean: frame.mean, rms: frame.rms, integratedPower, bins });
    windowCoherentGain = frame.windowCoherentGain; windowPowerGain = frame.windowPowerGain;
  }
  const welchBins: WelchBin[] = Array.from({ length: allocation.binsPerFrame }, (_, index) => ({ index, frequency: index * frequencyResolution, powerDensity: compensatedSum(frames.map((frame) => frame.bins[index]!.powerDensity)) / allocation.frameCount }));
  const averageUnderflowBins = welchBins.filter((bin) => bin.powerDensity === 0 && frames.some((frame) => frame.bins[bin.index]!.powerDensity > 0)).length;
  const integratedPower = compensatedSum(welchBins.map((bin) => bin.powerDensity)) * frequencyResolution;
  let welchPeak: TimeFrequencyReport['welchPeak'] = null;
  for (const bin of welchBins) if (bin.index > 0 && bin.powerDensity > 0 && (welchPeak === null || bin.powerDensity > welchPeak.powerDensity)) welchPeak = { ...bin };
  if (!Number.isFinite(integratedPower) || welchBins.some((bin) => !Number.isFinite(bin.powerDensity))) fail('TIME_FREQUENCY_NUMERIC', '평균 전력 밀도의 유한한 수치 범위를 초과했습니다.');
  const diagnostics = [
    'Welch 값은 완전한 각 프레임의 단측 전력 밀도 산술 평균입니다. 복소 계수·진폭을 평균하지 않습니다. DC와 Nyquist 항은 두 배로 늘리지 않습니다.',
    'Hann은 주기형 창입니다. 전력 밀도는 공통 표본 주파수×Σ(w²), 프레임 진폭은 Σw로 정규화합니다.',
    '프레임의 real·imag는 exp(-j2πkn/L)의 정규화하지 않은 원시 DFT입니다. SciPy STFT의 spectrum·psd 계수 스케일과 동일하다고 간주하지 않습니다.',
    '프레임 시간은 실제 첫·마지막 표본 시각의 중점입니다. 창 지지 구간의 중심과 반 표본 차이가 날 수 있습니다.',
    '길이와 겹침은 해상도·프레임 수·분산에 영향을 줍니다. 겹치는 프레임을 독립 표본으로 간주하지 않으며 신뢰구간을 인증하지 않습니다.',
    '부분 마지막 프레임은 폐기합니다. 경계 확장·0 채움·보간·역 STFT·aliasing 자동 보정을 수행하지 않습니다.',
    'mean과 rms는 폐기된 꼬리를 포함한 선택 원시 표본 전체의 통계입니다. 프레임 mean과 rms는 해당 프레임의 평균 제거 전 통계입니다.',
    '표시되는 DC 이외 최대 전력 밀도는 주파수 후보입니다. 위상 표시 문턱 아래의 양수 전력도 보존하며 물리적 유효성을 보증하지 않습니다.',
    '위상은 각 프레임의 첫 표본을 기준으로 합니다. 원시 DFT 크기가 10⁻¹²×max(1, 최대 창 적용 값)×프레임 길이 이하이면 위상을 표시하지 않습니다.',
  ];
  if (!originalSingleFrame) diagnostics.push('시간 격자는 선택 구간 전체에서 한 번 검증합니다. FFT 내부의 표본 순번 좌표는 수치 계산용이며 원시 값·시각을 보간하거나 재표본화하지 않습니다. 모든 주파수와 전력 밀도는 공통 표본 주파수로 정규화합니다.');
  if (densityUnderflowFrames > 0) diagnostics.push(`${densityUnderflowFrames}개 프레임에 원시 DFT가 0이 아닌데 Float64 제곱·정규화 underflow로 전력 밀도가 0인 행이 있습니다. 저장된 0은 물리적으로 신호가 없다는 뜻이 아닙니다. 원시 복소 계수는 보존합니다.`);
  if (rmsUnderflowFrames > 0) diagnostics.push(`${rmsUnderflowFrames}개 프레임의 원시 표본이 0이 아닌데 M21 RMS의 Float64 중간 제곱 underflow로 프레임 rms가 0입니다. 선택 구간 전체 rms는 스케일을 조정한 M24 통계이며 이 값과 다를 수 있습니다.`);
  if (averageUnderflowBins > 0) diagnostics.push(`${averageUnderflowBins}개 Welch 빈에 양수인 프레임 전력이 있지만 Float64 산술 평균 underflow로 평균 PSD가 0입니다. 각 프레임의 양수 원시 PSD는 표와 JSON에 보존합니다.`);
  if (settings.removeMean) diagnostics.push('각 프레임의 산술 평균을 창 적용 전에 따로 제거했습니다. 선택 구간 전체의 평균을 한 번 제거한 결과와 다를 수 있습니다.');
  if (allocation.discardedCount > 0) diagnostics.push(`마지막 ${allocation.discardedCount}개 표본은 불완전한 프레임으로 남아 Welch·프레임 전력에서 제외했습니다. 원시 입력은 보존합니다.`);
  if (welchPeak === null) diagnostics.push('DC 이외에 양수로 표현되는 전력 밀도가 없어 최대 주파수 후보가 없습니다. 0 또는 underflow를 임의의 주파수로 채우지 않습니다.');
  return { ...allocation, method: 'welch-stft-periodogram', startTime: times[0]!, endTime: times[values.length - 1]!, usedEndTime: times[allocation.usedCount - 1]!, discardedStartTime: allocation.discardedCount === 0 ? null : times[allocation.usedCount]!, sampleInterval, sampleRate, frequencyResolution, nyquist: sampleRate / 2, window: settings.window, removeMean: settings.removeMean, tail: 'discard', averaging: 'arithmetic-periodograms', normalization: 'one-sided-density', coefficients: 'unnormalized-forward-dft', frameTimeConvention: 'midpoint-first-last-sample', windowCoherentGain, windowPowerGain, mean: statistics.mean, rms: statistics.rms, integratedPower, welchPeak, welchBins, frames, diagnostics };
}
