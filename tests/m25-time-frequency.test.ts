import { describe, expect, it } from 'vitest';
import { analyzeSpectrum } from '../packages/analysis/src/spectrum';
import { analyzeTimeFrequency, planTimeFrequency, TIME_FREQUENCY_LIMITS, type TimeFrequencyInput, type TimeFrequencyOptions } from '../packages/analysis/src/time-frequency';
import { ModelError } from '../packages/model/src';

const defaults: TimeFrequencyOptions = { segmentLength: 8, overlap: 0, window: 'rectangular', removeMean: false, tail: 'discard' };
const input = (values: number[], rate = 64, start = 0): TimeFrequencyInput => ({ times: values.map((_, index) => start + index / rate), values });
function code(action: () => unknown, expected: string): void { try { action(); throw new Error('Did not reject'); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.map((item) => item.code)).toContain(expected); } }
function finite(value: unknown): void { if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); else if (Array.isArray(value)) value.forEach(finite); else if (value && typeof value === 'object') Object.values(value).forEach(finite); }
/** Independent O(L²) DFT and weighted Parseval oracle, without FFT helpers. */
function oracle(raw: number[], rate: number, window: TimeFrequencyOptions['window'], removeMean: boolean): { bins: { real: number; imag: number; amplitude: number; powerDensity: number }[]; power: number } {
  const length = raw.length, mean = raw.reduce((total, value) => total + value, 0) / length;
  const weights = raw.map((_, index) => window === 'hann' ? (1 - Math.cos(2 * Math.PI * index / length)) / 2 : 1);
  const values = raw.map((value, index) => (value - (removeMean ? mean : 0)) * weights[index]!);
  const coherent = weights.reduce((total, value) => total + value, 0), energy = weights.reduce((total, value) => total + value ** 2, 0);
  const bins = Array.from({ length: length / 2 + 1 }, (_, index) => {
    let real = 0, imag = 0;
    for (let sample = 0; sample < length; sample += 1) { real += values[sample]! * Math.cos(2 * Math.PI * index * sample / length); imag -= values[sample]! * Math.sin(2 * Math.PI * index * sample / length); }
    const factor = index === 0 || index === length / 2 ? 1 : 2;
    return { real, imag, amplitude: factor * Math.hypot(real, imag) / coherent, powerDensity: factor * (real ** 2 + imag ** 2) / (rate * energy) };
  });
  return { bins, power: values.reduce((total, value) => total + value ** 2, 0) / energy };
}

describe('M25 Welch powers and raw STFT frames', () => {
  it.each(['rectangular', 'hann'] as const)('matches independent DFT and weighted Parseval for overlapping %s frames', (window) => {
    const values = [3, -2, 1.5, 7, 0.25, -4, 2, 1, 5, -7, 3, 0.5, 2, 6, -1, 4, 3, 8, 99, -100, 12];
    for (const removeMean of [false, true]) {
      const report = analyzeTimeFrequency(input(values, 80), { ...defaults, overlap: 3, window, removeMean });
      const expected = [0, 5, 10].map((start) => oracle(values.slice(start, start + 8), 80, window, removeMean));
      expect(report).toMatchObject({ method: 'welch-stft-periodogram', count: 21, segmentLength: 8, overlap: 3, hop: 5, frameCount: 3, binsPerFrame: 5, totalBins: 15, usedCount: 18, discardedCount: 3, averaging: 'arithmetic-periodograms', normalization: 'one-sided-density', coefficients: 'unnormalized-forward-dft', frameTimeConvention: 'midpoint-first-last-sample' });
      report.frames.forEach((frame, index) => {
        expect(frame.startIndex).toBe(index * 5); expect(frame.endIndex).toBe(index * 5 + 7); expect(frame.startTime).toBe(index * 5 / 80); expect(frame.endTime).toBe((index * 5 + 7) / 80);
        expect(frame.centerTime).toBeCloseTo((index * 5 + 3.5) / 80, 14); expect(frame.integratedPower).toBeCloseTo(expected[index]!.power, 11);
        frame.bins.forEach((bin, frequency) => { const direct = expected[index]!.bins[frequency]!; expect(bin.real).toBeCloseTo(direct.real, 11); expect(bin.imag).toBeCloseTo(direct.imag, 11); expect(bin.amplitude).toBeCloseTo(direct.amplitude, 11); expect(bin.powerDensity).toBeCloseTo(direct.powerDensity, 11); expect(bin.frequency).toBe(frequency * report.frequencyResolution); });
      });
      report.welchBins.forEach((bin, frequency) => { expect(bin.powerDensity).toBeCloseTo(expected.reduce((total, frame) => total + frame.bins[frequency]!.powerDensity, 0) / 3, 11); expect(bin.frequency).toBe(frequency * 10); });
      expect(report.integratedPower).toBeCloseTo(expected.reduce((total, frame) => total + frame.power, 0) / 3, 11);
      expect(report.endTime).toBe(20 / 80); expect(report.usedEndTime).toBe(17 / 80); expect(report.discardedStartTime).toBe(18 / 80);
      expect(report.mean).toBeCloseTo(values.reduce((total, value) => total + value, 0) / 21, 12); expect(report.rms).toBeCloseTo(Math.sqrt(values.reduce((total, value) => total + value ** 2, 0) / 21), 12);
      expect(report.windowCoherentGain).toBe(window === 'rectangular' ? 1 : 0.5); expect(report.windowPowerGain).toBeCloseTo(window === 'rectangular' ? 1 : 0.375, 14); finite(report);
    }
  });
  it.each(['rectangular', 'hann'] as const)('keeps single-frame M21 bins and integrated power exactly for %s', (window) => {
    for (const removeMean of [false, true]) {
      const source = input([3, -2, 1.5, 7, 0.25, -4, 2, 1], 80, 2.5), spectrum = analyzeSpectrum(source, { window, removeMean });
      const report = analyzeTimeFrequency(source, { ...defaults, window, removeMean });
      expect(report.frames[0]!.bins).toEqual(spectrum.bins); expect(report.frames[0]!.integratedPower).toBe(spectrum.integratedPower); expect(report.integratedPower).toBe(spectrum.integratedPower);
      expect(report.welchBins).toEqual(spectrum.bins.map(({ index, frequency, powerDensity }) => ({ index, frequency, powerDensity }))); expect(report.discardedStartTime).toBeNull();
    }
  });
  it('averages powers rather than opposite-sign complex coefficients', () => {
    const first = Array.from({ length: 16 }, (_, index) => 3 * Math.cos(2 * Math.PI * 2 * index / 16));
    const report = analyzeTimeFrequency(input([...first, ...first.map((value) => -value)], 64), { ...defaults, segmentLength: 16 });
    expect(report.frames[0]!.bins[2]!.real).toBeCloseTo(24, 12); expect(report.frames[1]!.bins[2]!.real).toBeCloseTo(-24, 12);
    expect(report.welchBins[2]!.powerDensity).toBeCloseTo(1.125, 12); expect(report.integratedPower).toBeCloseTo(4.5, 12); expect(report.welchPeak).toMatchObject({ index: 2, frequency: 8 });
  });
  it('does not double DC or Nyquist, and removes each frame mean separately', () => {
    const first = Array.from({ length: 8 }, (_, index) => 3 + 2 * (index % 2 ? -1 : 1)), second = first.map((value) => value + 10);
    const source = input([...first, ...second], 8), raw = analyzeTimeFrequency(source, defaults), centered = analyzeTimeFrequency(source, { ...defaults, removeMean: true });
    expect(raw.welchBins[0]!.powerDensity).toBeCloseTo(89, 12); expect(raw.welchBins[4]!.powerDensity).toBeCloseTo(4, 12); expect(raw.integratedPower).toBeCloseTo(93, 12);
    expect(centered.frames.map((frame) => frame.mean)).toEqual([3, 13]); expect(centered.welchBins[0]!.powerDensity).toBe(0); expect(centered.welchBins[4]!.powerDensity).toBeCloseTo(4, 12); expect(centered.integratedPower).toBeCloseTo(4, 12);
    expect(centered.mean).toBe(8); expect(centered.rms).toBeCloseTo(Math.sqrt(93), 12); expect(centered.diagnostics.join(' ')).toContain('각 프레임의 산술 평균');
  });
  it('retains changing local frequency, exact raw frame boundaries and partial tails', () => {
    const values = Array.from({ length: 128 }, (_, index) => Math.cos(2 * Math.PI * (index < 64 ? 2 : 7) * index / 32));
    const report = analyzeTimeFrequency(input([...values, 999, -999, 123], 128, 5), { ...defaults, segmentLength: 32 });
    const peaks = report.frames.map((frame) => frame.bins.slice(1).reduce((best, bin) => bin.powerDensity > best.powerDensity ? bin : best).index);
    expect(peaks).toEqual([2, 2, 7, 7]); expect(report.frameCount).toBe(4); expect(report.discardedCount).toBe(3); expect(report.frames[3]).toMatchObject({ startIndex: 96, endIndex: 127, startTime: 5.75, endTime: 5.9921875, centerTime: 5.87109375 }); expect(report.diagnostics.join(' ')).toContain('마지막 3개');
  });
  it('preserves zero and tiny numerical powers without making a physical zero claim', () => {
    const zero = analyzeTimeFrequency(input(Array(16).fill(0)), defaults), tiny = analyzeTimeFrequency(input(Array.from({ length: 16 }, (_, index) => index % 2 ? -1e-165 : 1e-165)), defaults);
    expect(zero.welchPeak).toBeNull(); expect(zero.integratedPower).toBe(0); expect(zero.frames.every((frame) => frame.bins.every((bin) => bin.phaseDegrees === null))).toBe(true);
    expect(tiny.rms).toBeGreaterThan(0); expect(tiny.frames.every((frame) => frame.rms === 0)).toBe(true); expect(tiny.frames[0]!.bins[4]!.real).not.toBe(0); expect(tiny.frames[0]!.bins[4]!.powerDensity).toBe(0);
    expect(tiny.diagnostics.join(' ')).toContain('제곱·정규화 underflow'); expect(tiny.diagnostics.join(' ')).toContain('중간 제곱 underflow'); expect(tiny.diagnostics.join(' ')).toContain('물리적으로 신호가 없다는 뜻이 아닙니다'); finite(tiny);
  });
  it('keeps positive PSD below the phase display threshold', () => {
    const values = Array.from({ length: 16 }, (_, index) => 1e-14 * Math.cos(2 * Math.PI * index / 8)), report = analyzeTimeFrequency(input(values), defaults);
    expect(report.welchBins[1]!.powerDensity).toBeGreaterThan(0); expect(report.frames[0]!.bins[1]!.phaseDegrees).toBeNull(); expect(report.welchPeak!.index).toBe(1);
  });
  it('distinguishes Welch mean underflow from a physically zero frame', () => {
    const values = [...Array.from({ length: 8 }, (_, index) => (index % 2 ? -1 : 1) * 2 ** -537), ...Array<number>(8).fill(0)];
    const report = analyzeTimeFrequency(input(values, 8), defaults);
    expect(report.frames[0]!.bins[4]!.powerDensity).toBe(Number.MIN_VALUE); expect(report.frames[1]!.bins[4]!.powerDensity).toBe(0);
    expect(report.welchBins[4]!.powerDensity).toBe(0); expect(report.diagnostics.join(' ')).toContain('Float64 산술 평균 underflow');
  });
});

describe('M25 bounded planning and immutable plain inputs', () => {
  it('preflights actual full-frame allocation and work before FFT', () => {
    expect(planTimeFrequency(21, { ...defaults, overlap: 3 })).toMatchObject({ count: 21, hop: 5, frameCount: 3, binsPerFrame: 5, totalBins: 15, usedCount: 18, discardedCount: 3 });
    expect(planTimeFrequency(8192, { ...defaults, segmentLength: 64 })).toMatchObject({ frameCount: 128, totalBins: 4224 });
    expect(planTimeFrequency(8192, { ...defaults, segmentLength: 1024, overlap: 927 })).toMatchObject({ frameCount: 74, work: 7928108 });
    code(() => planTimeFrequency(8192, { ...defaults, segmentLength: 64, overlap: 1 }), 'TIME_FREQUENCY_FRAMES');
    code(() => planTimeFrequency(8192, { ...defaults, segmentLength: 2048, overlap: 1952 }), 'TIME_FREQUENCY_BINS');
    code(() => planTimeFrequency(8192, { ...defaults, segmentLength: 1024, overlap: 928 }), 'TIME_FREQUENCY_WORK_BUDGET');
    code(() => planTimeFrequency(8192, { ...defaults, segmentLength: 2048, overlap: 1868 }), 'TIME_FREQUENCY_WORK_BUDGET');
    expect(Object.isFrozen(TIME_FREQUENCY_LIMITS)).toBe(true);
  });
  it.each([8, 9, 17, 65, 1023, 8192])('accepts arbitrary total count %i without zero padding', (count) => {
    const source = input(Array.from({ length: count }, (_, index) => Math.sin(index))), report = analyzeTimeFrequency(source, { ...defaults, segmentLength: count >= 64 ? 64 : 8 });
    expect(report.count).toBe(count); expect(report.frames.at(-1)!.endIndex + 1).toBe(report.usedCount); expect(report.usedCount + report.discardedCount).toBe(count); expect(report.work).toBeLessThanOrEqual(TIME_FREQUENCY_LIMITS.work); finite(report);
  });
  it.each([NaN, Infinity, -Infinity, -1, 0, 1, 7, 8.5, 8193, '8', null])('rejects invalid count %j', (count) => { code(() => planTimeFrequency(count as number, defaults), 'TIME_FREQUENCY_COUNT'); });
  it.each([
    { segmentLength: 7 }, { segmentLength: 12 }, { segmentLength: 4096 }, { segmentLength: '8' }, { overlap: -1 }, { overlap: 8 }, { overlap: 0.5 }, { overlap: '0' },
    { window: 'hamming' }, { removeMean: 'false' }, { tail: 'pad' }, { extra: true }, { [Symbol('extra')]: true },
  ])('rejects invalid options %j', (change) => { code(() => planTimeFrequency(16, { ...defaults, ...change } as TimeFrequencyOptions), 'TIME_FREQUENCY_OPTIONS'); });
  it('rejects oversized frames, missing/nonplain settings, mismatched counts and invalid tail values', () => {
    code(() => planTimeFrequency(8, { ...defaults, segmentLength: 16 }), 'TIME_FREQUENCY_OPTIONS');
    for (const options of [undefined, null, {}, new Date(), Object.defineProperty({ ...defaults }, 'window', { enumerable: false })]) code(() => planTimeFrequency(16, options as TimeFrequencyOptions), 'TIME_FREQUENCY_OPTIONS');
    code(() => analyzeTimeFrequency({ times: Array.from({ length: 8 }, (_, index) => index), values: Array(9).fill(1) }, defaults), 'TIME_FREQUENCY_COUNT');
    const source = input(Array(11).fill(1)); source.values[10] = Infinity; code(() => analyzeTimeFrequency(source, defaults), 'TIME_FREQUENCY_INPUT');
    source.values[10] = 1; source.times[10] = source.times[10]! + 0.001; code(() => analyzeTimeFrequency(source, defaults), 'TIME_SERIES_TIME_GRID');
  });
  it('rejects input/option/array accessors without executing caller getters', () => {
    let called = 0;
    const accessor = () => { called += 1; return 1; };
    const source = input(Array(16).fill(1)); Object.defineProperty(source, 'values', { enumerable: true, get: accessor }); code(() => analyzeTimeFrequency(source, defaults), 'TIME_FREQUENCY_INPUT');
    const options = { ...defaults }; Object.defineProperty(options, 'overlap', { enumerable: true, get: accessor }); code(() => planTimeFrequency(16, options), 'TIME_FREQUENCY_OPTIONS');
    for (const key of ['times', 'values'] as const) { const arraySource = input(Array(16).fill(1)); Object.defineProperty(arraySource[key], '3', { enumerable: true, get: accessor }); code(() => analyzeTimeFrequency(arraySource, defaults), 'TIME_FREQUENCY_INPUT'); }
    expect(called).toBe(0);
  });
  it('rejects sparse/hidden/extra/symbol/typed/inherited arrays and nonplain records', () => {
    const base = input(Array(16).fill(1));
    for (const mutate of [
      (values: number[]) => { delete values[1]; return values; },
      (values: number[]) => Object.defineProperty(values, '1', { value: 1, enumerable: false }),
      (values: number[]) => Object.assign(values, { extra: 1 }),
      (values: number[]) => Object.assign(values, { [Symbol('extra')]: 1 }),
      (values: number[]) => { Object.setPrototypeOf(values, Object.create(Array.prototype)); return values; },
      (values: number[]) => new Float64Array(values),
    ]) code(() => analyzeTimeFrequency({ ...base, values: mutate([...base.values]) } as TimeFrequencyInput, defaults), 'TIME_FREQUENCY_INPUT');
    for (const source of [null, new Date(), { ...base, extra: 1 }, { times: base.times }, Object.assign(Object.create({ values: base.values }), { times: base.times }), Object.assign(JSON.parse('{"__proto__":{}}'), base)]) code(() => analyzeTimeFrequency(source as TimeFrequencyInput, defaults), 'TIME_FREQUENCY_INPUT');
  });
  it.each([NaN, Infinity, -Infinity, 1e12 + 1, -1e12 - 1, '1', null])('rejects unsupported raw value %j even outside used frames', (value) => {
    const source = input(Array(11).fill(1)); (source.values as unknown[])[10] = value; code(() => analyzeTimeFrequency(source, defaults), 'TIME_FREQUENCY_INPUT');
  });
  it('preserves frozen input, keeps independent report arrays, permits null-prototype data records and finite limits', () => {
    const source = input(Array.from({ length: 64 }, (_, index) => (index % 2 ? -1 : 1) * 1e12), 1e9), original = structuredClone(source);
    Object.freeze(source.times); Object.freeze(source.values); Object.freeze(source); const options = Object.freeze({ ...defaults, segmentLength: 32, overlap: 16 });
    const report = analyzeTimeFrequency(source, options); expect(source).toEqual(original); expect(report).toEqual(analyzeTimeFrequency(source, options)); finite(report);
    report.frames[0]!.bins[1]!.real = 999; expect(report.frames[1]!.bins[1]!.real).not.toBe(999); expect(source.values).toEqual(original.values);
    expect(analyzeTimeFrequency(Object.assign(Object.create(null), source), Object.assign(Object.create(null), options)).frameCount).toBe(3);
  });
});
