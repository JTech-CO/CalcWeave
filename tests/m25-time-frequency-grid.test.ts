import { describe, expect, it } from 'vitest';
import { analyzeSpectrum } from '../packages/analysis/src/spectrum';
import { analyzeTimeStatistics } from '../packages/analysis/src/time-series-statistics';
import { analyzeTimeFrequency, type TimeFrequencyInput, type TimeFrequencyOptions } from '../packages/analysis/src/time-frequency';

function options(window: TimeFrequencyOptions['window'] = 'rectangular', removeMean = false): TimeFrequencyOptions {
  return { segmentLength: 8, overlap: 0, window, removeMean, tail: 'discard' };
}

function alternating(count: number, interval: number, amplitude: number): TimeFrequencyInput {
  return { times: Array.from({ length: count }, (_, index) => index * interval), values: Array.from({ length: count }, (_, index) => index % 2 ? -amplitude : amplitude) };
}

describe('M25 one global time grid and representable density boundaries', () => {
  for (const window of ['rectangular', 'hann'] as const) for (const removeMean of [false, true]) {
    it(`accepts globally uniform boundary jitter without independently refitting each ${window}/${removeMean} frame`, () => {
      // Each interior timestamp is within the existing global-grid 1ps tolerance.
      // Fitting a new line through a frame's endpoints would amplify that jitter
      // and reject some frames, even though the selected record is valid.
      const input = {
        times: Array.from({ length: 32 }, (_, index) => index / 64 + (index === 0 || index === 31 ? 0 : index % 2 ? 9.5e-13 : -9.5e-13)),
        values: Array.from({ length: 32 }, (_, index) => 4 + 2 * Math.cos(2 * Math.PI * index / 8 + .7) + .4 * Math.sin(2 * Math.PI * 3 * index / 8)),
      }, original = structuredClone(input), settings = options(window, removeMean);
      expect(analyzeTimeStatistics(input).sampleInterval).toBe(1 / 64);
      const report = analyzeTimeFrequency(input, settings);
      expect(input).toEqual(original);
      expect(report).toMatchObject({ sampleRate: 64, frequencyResolution: 8, frameCount: 4, usedCount: 32, discardedCount: 0 });
      for (const frame of report.frames) {
        expect(frame.startTime).toBe(input.times[frame.startIndex]);
        expect(frame.endTime).toBe(input.times[frame.endIndex]);
        expect(frame.centerTime).toBe(frame.startTime + (frame.endTime - frame.startTime) / 2);
        // Timestamp normalization must not change the ordered-sample FFT,
        // amplitude, phase or window. The common global fs defines density.
        const reference = analyzeSpectrum({ times: Array.from({ length: 8 }, (_, index) => index), values: input.values.slice(frame.startIndex, frame.endIndex + 1) }, { window, removeMean });
        frame.bins.forEach((bin, index) => {
          expect(bin.frequency).toBe(index * report.frequencyResolution);
          expect(bin.real).toBe(reference.bins[index].real);
          expect(bin.imag).toBe(reference.bins[index].imag);
          expect(bin.amplitude).toBe(reference.bins[index].amplitude);
          expect(bin.phaseDegrees).toBe(reference.bins[index].phaseDegrees);
          expect(bin.powerDensity).toBeCloseTo(reference.bins[index].powerDensity / report.sampleRate, 13);
        });
      }
      report.welchBins.forEach((bin, index) => expect(bin.frequency).toBe(index * report.frequencyResolution));
    });
  }

  it('uses the selected global grid even when one complete frame leaves a discarded tail', () => {
    const input = {
      times: Array.from({ length: 12 }, (_, index) => index / 64 + (index === 0 || index === 11 ? 0 : index % 2 ? 9.5e-13 : -9.5e-13)),
      values: Array.from({ length: 12 }, (_, index) => 2 * Math.cos(2 * Math.PI * index / 8 + .3)),
    }, original = structuredClone(input);
    expect(analyzeTimeStatistics(input).sampleInterval).toBe(1 / 64);
    const report = analyzeTimeFrequency(input, options()), frame = report.frames[0];
    const reference = analyzeSpectrum({ times: Array.from({ length: 8 }, (_, index) => index), values: input.values.slice(0, 8) }, { window: 'rectangular', removeMean: false });
    expect(report).toMatchObject({ frameCount: 1, usedCount: 8, discardedCount: 4, sampleRate: 64, frequencyResolution: 8, usedEndTime: input.times[7], discardedStartTime: input.times[8] });
    expect(frame.startTime).toBe(input.times[0]);
    expect(frame.endTime).toBe(input.times[7]);
    frame.bins.forEach((bin, index) => {
      expect(bin.frequency).toBe(index * report.frequencyResolution);
      expect(bin.real).toBe(reference.bins[index].real);
      expect(bin.imag).toBe(reference.bins[index].imag);
      expect(bin.amplitude).toBe(reference.bins[index].amplitude);
      expect(bin.phaseDegrees).toBe(reference.bins[index].phaseDegrees);
      expect(bin.powerDensity).toBeCloseTo(reference.bins[index].powerDensity / report.sampleRate, 13);
    });
    expect(input).toEqual(original);
  });

  it('keeps a valid shifted raw origin and excluded tail exact, while tail values do not enter Welch', () => {
    const input = {
      times: Array.from({ length: 39 }, (_, index) => 2 ** 28 + index / 1024),
      values: Array.from({ length: 39 }, (_, index) => index < 32 ? 2 * Math.sin(2 * Math.PI * index / 8 + .3) : 1000 + index),
    }, original = structuredClone(input), settings: TimeFrequencyOptions = { segmentLength: 16, overlap: 8, window: 'hann', removeMean: true, tail: 'discard' };
    const report = analyzeTimeFrequency(input, settings), usedOnly = analyzeTimeFrequency({ times: input.times.slice(0, 32), values: input.values.slice(0, 32) }, settings);
    expect(report).toMatchObject({ sampleInterval: 1 / 1024, sampleRate: 1024, frequencyResolution: 64, frameCount: 3, usedCount: 32, discardedCount: 7, startTime: input.times[0], endTime: input.times[38], usedEndTime: input.times[31], discardedStartTime: input.times[32] });
    expect(report.welchBins).toEqual(usedOnly.welchBins);
    expect(report.frames).toEqual(usedOnly.frames);
    expect(report.mean).toBe(analyzeTimeStatistics(input).mean);
    expect(report.mean).not.toBe(usedOnly.mean);
    expect(input).toEqual(original);
  });

  it('still validates an excluded tail against the one global grid', () => {
    const input = alternating(39, 1 / 64, 2);
    input.times[38] += 1e-3;
    expect(() => analyzeTimeFrequency(input, options())).toThrow(/시간 격자가 균일하지 않습니다/);
  });

  it('does not hide inadequate raw timestamp precision behind an FFT index grid', () => {
    const input = alternating(16, 1e-6, 2);
    input.times = input.times.map(time => 1e9 - 1 + time);
    expect(() => analyzeTimeFrequency(input, options())).toThrow(/시간의 절댓값에 비해 표본 간격이 작아/);
  });

  for (const window of ['rectangular', 'hann'] as const) {
    it(`retains bit-identical original M21 bins for a single ${window} frame with shifted times`, () => {
      const input = { times: Array.from({ length: 8 }, (_, index) => 2 ** 20 + index / 32), values: Array.from({ length: 8 }, (_, index) => 3 + 2 * Math.cos(2 * Math.PI * index / 8 + .6)) }, settings = options(window, true);
      const spectrum = analyzeSpectrum(input, { window, removeMean: true }), report = analyzeTimeFrequency(input, settings);
      expect(report.frames[0].bins).toEqual(spectrum.bins);
      expect(report.frames[0].integratedPower).toBe(spectrum.integratedPower);
      expect(report.welchBins).toEqual(spectrum.bins.map(({ index, frequency, powerDensity }) => ({ index, frequency, powerDensity })));
    });
  }

  for (const amplitude of [1e-160, 1e-161]) {
    it(`normalizes representable low-fs PSD before squaring tiny ${amplitude} coefficients`, () => {
      const input = alternating(24, 1e7, amplitude), original = structuredClone(input), report = analyzeTimeFrequency(input, options());
      // Rectangular Nyquist density is A²·L/fs. Scaling before squaring keeps
      // this independent analytic expectation representable in Float64.
      const expected = (amplitude * Math.sqrt(8 / report.sampleRate)) ** 2;
      const tolerance = Math.max(32 * Number.MIN_VALUE, Math.abs(expected) * 2e-12);
      expect(expected).toBeGreaterThan(0);
      expect(report.sampleRate).toBe(1e-7);
      expect(report.frameCount).toBe(3);
      for (const frame of report.frames) {
        expect(frame.bins[4].real).toBe(8 * amplitude);
        expect(frame.bins[4].powerDensity).toBeGreaterThan(0);
        expect(Math.abs(frame.bins[4].powerDensity - expected)).toBeLessThanOrEqual(tolerance);
      }
      expect(Math.abs(report.welchBins[4].powerDensity - expected)).toBeLessThanOrEqual(tolerance);
      expect(input).toEqual(original);
    });
  }

  it('preserves exact positive binary PSD when low fs rescues a squared coefficient that would underflow', () => {
    // A²·L/fs = 2^(-1100+3+24) = 2^-1073, exactly two minimum subnormals.
    // |X|² alone is zero in Float64; a rounded unit-fs density cannot recover it.
    for (const count of [12, 16]) {
      const input = alternating(count, 2 ** 24, 2 ** -550), report = analyzeTimeFrequency(input, options());
      expect(report.sampleRate).toBe(2 ** -24);
      expect(report.frameCount).toBe(Math.floor(count / 8));
      for (const frame of report.frames) expect(frame.bins[4].powerDensity).toBe(2 * Number.MIN_VALUE);
      expect(report.welchBins[4].powerDensity).toBe(2 * Number.MIN_VALUE);
    }
  });
});
