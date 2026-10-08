import { describe, expect, it } from 'vitest';
import { analyzeSpectrum, SPECTRUM_LIMITS, type SpectrumInput, type SpectrumOptions } from '../packages/analysis/src/spectrum';
import { ModelError } from '../packages/model/src';

const rectangular: SpectrumOptions = { window: 'rectangular', removeMean: false };
const hann: SpectrumOptions = { window: 'hann', removeMean: false };
const input = (values: number[], sampleRate = 64, start = 0): SpectrumInput => ({ times: values.map((_, index) => start + index / sampleRate), values });
const tone = (count = 64, bin = 5, amplitude = 3, phase = 0): number[] => Array.from({ length: count }, (_, index) => amplitude * Math.cos(2 * Math.PI * bin * index / count + phase));
function code(action: () => unknown, expected: string): void { try { action(); throw new Error('Did not reject'); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.map((item) => item.code)).toContain(expected); } }
function finite(value: unknown): void { if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); else if (Array.isArray(value)) value.forEach(finite); else if (value && typeof value === 'object') Object.values(value).forEach(finite); }
/** An independent O(N²) complex DFT oracle, using no implementation helpers. */
function dft(values: number[]): { real: number; imag: number }[] {
  return Array.from({ length: values.length }, (_, bin) => values.reduce((result, value, sample) => ({ real: result.real + value * Math.cos(-2 * Math.PI * bin * sample / values.length), imag: result.imag + value * Math.sin(-2 * Math.PI * bin * sample / values.length) }), { real: 0, imag: 0 }));
}

describe('M21 independent FFT and one-sided normalization', () => {
  it('matches a bin-centered cosine amplitude, raw DFT, phase, frequency and RMS', () => {
    const report = analyzeSpectrum(input(tone(), 128, 2), rectangular), component = report.bins[5]!;
    expect(report.method).toBe('radix2-periodogram'); expect(report.count).toBe(64); expect(report.startTime).toBe(2); expect(report.endTime).toBe(2 + 63 / 128);
    expect(report.sampleInterval).toBe(1 / 128); expect(report.sampleRate).toBe(128); expect(report.frequencyResolution).toBe(2); expect(report.nyquist).toBe(64);
    expect(component.frequency).toBe(10); expect(component.real).toBeCloseTo(96, 11); expect(component.imag).toBeCloseTo(0, 11); expect(component.amplitude).toBeCloseTo(3, 12); expect(component.phaseDegrees).toBeCloseTo(0, 10);
    expect(component.powerDensity).toBeCloseTo(2.25, 12); expect(report.integratedPower).toBeCloseTo(4.5, 12); expect(report.rms).toBeCloseTo(3 / Math.sqrt(2), 12); expect(report.mean).toBeCloseTo(0, 12); expect(report.peak).toEqual({ index: 5, frequency: 10, amplitude: expect.closeTo(3, 12) });
    expect(report.windowCoherentGain).toBe(1); expect(report.windowPowerGain).toBe(1); expect(report.bins).toHaveLength(33); expect(report.bins[1]!.phaseDegrees).toBeNull();
  });
  it.each([0.4, -1.1, 2.7])('preserves first-sample cosine phase %f despite an absolute-time offset', (phase) => {
    const report = analyzeSpectrum(input(tone(64, 7, 2.5, phase), 256, 17.25), rectangular);
    expect(report.bins[7]!.amplitude).toBeCloseTo(2.5, 11); expect(report.bins[7]!.phaseDegrees).toBeCloseTo(phase * 180 / Math.PI, 10);
  });
  it('uses the forward negative-exponent convention for a sine', () => {
    const values = Array.from({ length: 32 }, (_, index) => 4 * Math.sin(2 * Math.PI * 3 * index / 32)), report = analyzeSpectrum(input(values, 32), rectangular), bin = report.bins[3]!;
    expect(bin.real).toBeCloseTo(0, 11); expect(bin.imag).toBeCloseTo(-64, 11); expect(bin.amplitude).toBeCloseTo(4, 12); expect(bin.phaseDegrees).toBeCloseTo(-90, 11);
  });
  it('never doubles DC or Nyquist amplitudes or powers', () => {
    const values = Array.from({ length: 16 }, (_, index) => 3 + 2 * (index % 2 ? -1 : 1)), report = analyzeSpectrum(input(values, 16), rectangular);
    expect(report.bins[0]!).toMatchObject({ real: 48, imag: 0, amplitude: 3, powerDensity: 9, phaseDegrees: 0 });
    expect(report.bins[8]!).toMatchObject({ real: 32, imag: 0, amplitude: 2, powerDensity: 4, phaseDegrees: 0 }); expect(report.peak).toEqual({ index: 8, frequency: 8, amplitude: 2 });
    expect(report.mean).toBe(3); expect(report.rms).toBeCloseTo(Math.sqrt(13), 12); expect(report.integratedPower).toBe(13);
  });
  it('keeps pure DC and all-zero peak indeterminate', () => {
    const dc = analyzeSpectrum(input(Array(16).fill(4), 16), rectangular), zero = analyzeSpectrum(input(Array(16).fill(0), 16), rectangular);
    expect(dc.bins[0]!.amplitude).toBe(4); expect(dc.integratedPower).toBe(16); expect(dc.peak).toBeNull(); expect(zero.peak).toBeNull(); expect(zero.integratedPower).toBe(0); expect(zero.bins.every((bin) => bin.phaseDegrees === null)).toBe(true); expect(zero.diagnostics.join(' ')).toContain('최대 주파수를 만들어');
  });
  it('matches a unit impulse spectrum and Parseval total power', () => {
    const values = [1, ...Array(15).fill(0)], report = analyzeSpectrum(input(values, 32), rectangular);
    report.bins.forEach((bin) => { expect(bin.real).toBe(1); expect(bin.imag).toBe(0); expect(bin.phaseDegrees).toBe(0); expect(bin.amplitude).toBe(bin.index === 0 || bin.index === 8 ? 1 / 16 : 2 / 16); });
    expect(report.integratedPower).toBeCloseTo(1 / 16, 14); expect(report.rms).toBe(0.25); expect(report.mean).toBe(1 / 16);
  });
  it('applies the periodic Hann coherent and energy gains, including adjacent-bin leakage', () => {
    const report = analyzeSpectrum(input(tone(64, 6, 3), 64), hann);
    expect(report.windowCoherentGain).toBeCloseTo(0.5, 14); expect(report.windowPowerGain).toBeCloseTo(0.375, 14);
    expect(report.bins[6]!.real).toBeCloseTo(48, 11); expect(report.bins[6]!.amplitude).toBeCloseTo(3, 12); expect(report.bins[5]!.amplitude).toBeCloseTo(1.5, 12); expect(report.bins[7]!.amplitude).toBeCloseTo(1.5, 12);
    expect(report.bins[6]!.powerDensity).toBeCloseTo(3, 12); expect(report.bins[5]!.powerDensity).toBeCloseTo(0.75, 12); expect(report.integratedPower).toBeCloseTo(4.5, 11); expect(report.peak!.index).toBe(6);
  });
  it('removes arithmetic mean before Hann windowing and retains raw statistics', () => {
    const values = tone(32, 5, 2).map((value) => value + 12), report = analyzeSpectrum(input(values, 32), { window: 'hann', removeMean: true });
    expect(report.mean).toBeCloseTo(12, 12); expect(report.rms).toBeCloseTo(Math.sqrt(146), 11); expect(report.bins[0]!.amplitude).toBeCloseTo(0, 12); expect(report.bins[5]!.amplitude).toBeCloseTo(2, 11); expect(report.integratedPower).toBeCloseTo(2, 11);
    expect(report.diagnostics.join(' ')).toContain('창을 적용하기 전에');
    const pure = analyzeSpectrum(input(Array(16).fill(3), 16), { window: 'hann', removeMean: true }); expect(pure.peak).toBeNull(); expect(pure.bins.every((bin) => bin.amplitude === 0)).toBe(true);
  });
  it('does not discard an extremely small numerical signal while making its phase null', () => {
    const report = analyzeSpectrum(input(tone(32, 3, 1e-14), 32), rectangular); expect(report.bins[3]!.amplitude).toBeCloseTo(1e-14, 25); expect(report.bins[3]!.powerDensity).toBeGreaterThan(0); expect(report.bins[3]!.phaseDegrees).toBeNull(); expect(report.peak).toBeNull();
  });
  it.each(['rectangular', 'hann'] as const)('matches an independent small DFT and weighted Parseval for %s', (window) => {
    const values = [3, -2, 1.5, 7, 0.25, -4, 2, 1], mean = values.reduce((sum, value) => sum + value, 0) / 8;
    for (const removeMean of [false, true]) {
      const weights = values.map((_, sample) => window === 'hann' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * sample / 8) : 1), weighted = values.map((value, sample) => (value - (removeMean ? mean : 0)) * weights[sample]!), oracle = dft(weighted), sumWeights = weights.reduce((sum, value) => sum + value, 0), sumSquares = weights.reduce((sum, value) => sum + value * value, 0), report = analyzeSpectrum(input(values, 80), { window, removeMean });
      report.bins.forEach((bin) => { const raw = oracle[bin.index]!, factor = bin.index === 0 || bin.index === 4 ? 1 : 2; expect(bin.real).toBeCloseTo(raw.real, 11); expect(bin.imag).toBeCloseTo(raw.imag, 11); expect(bin.amplitude).toBeCloseTo(factor * Math.hypot(raw.real, raw.imag) / sumWeights, 11); expect(bin.powerDensity).toBeCloseTo(factor * (raw.real ** 2 + raw.imag ** 2) / (80 * sumSquares), 11); });
      expect(report.integratedPower).toBeCloseTo(weighted.reduce((sum, value) => sum + value * value, 0) / sumSquares, 11);
    }
  });
});

describe('M21 bounded plain-data inputs and reliable time grids', () => {
  it.each([8, 16, 128, 1024, 8192])('produces deterministic finite bounded outputs for %i samples', (count) => {
    const source = input(tone(count, 2, SPECTRUM_LIMITS.maxValue), 1e9), original = structuredClone(source), report = analyzeSpectrum(source, hann);
    expect(report).toEqual(analyzeSpectrum(source, hann)); expect(source).toEqual(original); expect(report.bins).toHaveLength(count / 2 + 1); expect(report.peak!.index).toBe(2); expect(report.work).toBeGreaterThan(count); expect(report.work).toBeLessThanOrEqual(SPECTRUM_LIMITS.work); finite(report);
  });
  it('does not mutate frozen caller arrays or options and reports private bin data', () => {
    const source = input(tone(16, 2)); Object.freeze(source.times); Object.freeze(source.values); Object.freeze(source); const options = Object.freeze({ ...rectangular }); const report = analyzeSpectrum(source, options); report.bins[0]!.real = 99; expect(source.values[0]).toBe(3); expect(options).toEqual(rectangular);
  });
  it('permits explicit null-prototype plain records, not inherited fields', () => {
    const source = Object.assign(Object.create(null), input(tone(8, 2))), options = Object.assign(Object.create(null), rectangular); expect(analyzeSpectrum(source, options).count).toBe(8);
    code(() => analyzeSpectrum(Object.assign(Object.create({ times: source.times }), { values: source.values }), rectangular), 'SPECTRUM_INPUT');
  });
  it.each([0, 1, 7, 9, 12, 8193, 16384])('rejects sample count %i without truncation or padding', (count) => { code(() => analyzeSpectrum(input(Array(count).fill(1)), rectangular), 'SPECTRUM_COUNT'); });
  it('rejects mismatched time and value counts', () => { code(() => analyzeSpectrum({ times: input(Array(8).fill(1)).times, values: Array(16).fill(1) }, rectangular), 'SPECTRUM_COUNT'); });
  it.each([NaN, Infinity, -Infinity, 1e12 + 1, -1e12 - 1, '3', null])('rejects unsupported sample value %j', (value) => { const source = input(tone(8, 2)); (source.values as unknown[])[1] = value; code(() => analyzeSpectrum(source, rectangular), 'SPECTRUM_INPUT'); });
  it.each([NaN, Infinity, -Infinity, 1e9 + 1, -1e9 - 1, '3', null])('rejects unsupported time value %j', (value) => { const source = input(tone(8, 2)); (source.times as unknown[])[1] = value; code(() => analyzeSpectrum(source, rectangular), 'SPECTRUM_INPUT'); });
  it('rejects duplicate, decreasing, nonuniform and sub-nanosecond time grids', () => {
    const source = input(tone(8, 2), 8);
    for (const times of [[...source.times].reverse(), source.times.map((time, index) => index === 4 ? source.times[3]! : time), source.times.map((time, index) => index === 4 ? time + 1e-6 : time), source.times.map((_, index) => index * 1e-10)]) code(() => analyzeSpectrum({ ...source, times }, rectangular), 'SPECTRUM_TIME_GRID');
  });
  it('accepts representable nanosecond grids and time limits, rejects ambiguous absolute-time precision', () => {
    expect(analyzeSpectrum(input(tone(8, 2), 1e9), rectangular).sampleInterval).toBeCloseTo(1e-9, 20);
    const upper = input(tone(8, 2), 1, SPECTRUM_LIMITS.maxTime - 7); expect(analyzeSpectrum(upper, rectangular).endTime).toBe(1e9);
    const lower = input(tone(8, 2), 1, -SPECTRUM_LIMITS.maxTime); expect(analyzeSpectrum(lower, rectangular).startTime).toBe(-1e9);
    code(() => analyzeSpectrum(input(tone(8, 2), 1e6, 1e8), rectangular), 'SPECTRUM_TIME_PRECISION');
  });
  it.each([16, 32, 8192])('accepts a valid 1ns model grid with %i samples despite endpoint quotient roundoff', (count) => {
    const values = tone(count, 2);
    for (const times of [values.map((_, index) => index * 1e-9), values.map((_, index) => index / 1e9)]) {
      const report = analyzeSpectrum({ times, values }, rectangular); expect(report.sampleInterval).toBeCloseTo(1e-9, 23); expect(report.sampleInterval).toBeGreaterThanOrEqual(1e-9); expect(report.sampleRate).toBeLessThanOrEqual(1e9); expect(report.peak!.index).toBe(2);
    }
  });
  it.each([8, 16, 32, 8192])('rejects a genuinely subminimum 0.999ns grid with %i samples', (count) => {
    const values = tone(count, 2); code(() => analyzeSpectrum({ times: values.map((_, index) => index * 0.999e-9), values }, rectangular), 'SPECTRUM_TIME_GRID');
  });
  it('uses timestamp precision tolerance for ordinary decimal grids without accepting a missing step', () => {
    const source = input(tone(1024, 5), 10, 123.4); expect(analyzeSpectrum(source, rectangular).sampleRate).toBeCloseTo(10, 12);
    source.times[511] = source.times[511]! + 0.01; code(() => analyzeSpectrum(source, rectangular), 'SPECTRUM_TIME_GRID');
  });
  it('rejects object, option and array getters before any accessor executes', () => {
    let called = 0; const source = input(tone(8, 2)); Object.defineProperty(source, 'values', { enumerable: true, get: () => { called += 1; return tone(8, 2); } }); code(() => analyzeSpectrum(source, rectangular), 'SPECTRUM_INPUT');
    const options = { ...rectangular }; Object.defineProperty(options, 'window', { enumerable: true, get: () => { called += 1; return 'rectangular'; } }); code(() => analyzeSpectrum(input(tone(8, 2)), options), 'SPECTRUM_OPTIONS');
    for (const key of ['times', 'values'] as const) { const vectorSource = input(tone(8, 2)); Object.defineProperty(vectorSource[key], '1', { enumerable: true, get: () => { called += 1; return 1; } }); code(() => analyzeSpectrum(vectorSource, rectangular), 'SPECTRUM_INPUT'); }
    expect(called).toBe(0);
  });
  it.each(['times', 'values'] as const)('rejects sparse, hidden, symbol, inherited, extra and typed %s arrays', (key) => {
    const base = input(tone(8, 2));
    for (const mutate of [
      (values: number[]) => { delete values[1]; return values; },
      (values: number[]) => Object.defineProperty(values, '1', { value: 1, enumerable: false }),
      (values: number[]) => Object.assign(values, { extra: 1 }),
      (values: number[]) => Object.assign(values, { [Symbol('extra')]: 1 }),
      (values: number[]) => { Object.setPrototypeOf(values, Object.create(Array.prototype)); return values; },
      (values: number[]) => new Float64Array(values),
      (values: number[]) => Object.defineProperty(values, '__proto__', { value: {}, enumerable: true }),
    ]) code(() => analyzeSpectrum({ ...base, [key]: mutate([...base[key]]) } as SpectrumInput, rectangular), 'SPECTRUM_INPUT');
  });
  it('rejects nonplain inputs, unsafe keys, extra, missing, hidden and symbol fields', () => {
    const base = input(tone(8, 2));
    for (const source of [null, new Date(), [], { ...base, [Symbol('extra')]: 1 }, { ...base, extra: true }, { times: base.times }, Object.defineProperty({ ...base }, 'values', { enumerable: false }), Object.assign(JSON.parse('{"__proto__":{}}'), base)]) code(() => analyzeSpectrum(source as SpectrumInput, rectangular), 'SPECTRUM_INPUT');
  });
  it.each([undefined, null, {}, { window: 'rectangular' }, { removeMean: false }, { ...rectangular, window: 'hamming' }, { ...rectangular, removeMean: 0 }, { ...rectangular, removeMean: 'false' }, { ...rectangular, extra: 1 }, { ...rectangular, [Symbol('extra')]: 1 }, Object.assign(JSON.parse('{"constructor":{}}'), rectangular), new Date()])('rejects unsupported options %j', (options) => { code(() => analyzeSpectrum(input(tone(8, 2)), options as SpectrumOptions), 'SPECTRUM_OPTIONS'); });
});
