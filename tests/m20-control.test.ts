import { describe, expect, it } from 'vitest';
import { analyzeContinuousSiso, readLinearizationStateSpace, type ControlAnalysisSpec, type ControlStateSpace } from '../packages/analysis/src/control-system';
import { ModelError } from '../packages/model/src';

const first = (gain = 2): ControlStateSpace => ({ A: [[-1]], B: [[1]], C: [[gain]], D: [[0]] });
const second = (): ControlStateSpace => ({ A: [[0, 1], [-4, -1.2]], B: [[0], [1]], C: [[4, 0]], D: [[0]] });
const third = (gain = 1): ControlStateSpace => ({ A: [[0, 1, 0], [0, 0, 1], [0, -2, -3]], B: [[0], [0], [1]], C: [[gain, 0, 0]], D: [[0]] });
const bus = (state = first()): unknown => ({ kind: 'bus', fields: (['A', 'B', 'C', 'D'] as const).map((name) => ({ name, value: state[name] })) });
const options: ControlAnalysisSpec = { rootLocusGains: [] };
function code(action: () => unknown, expected: string): void { try { action(); throw new Error('Did not reject'); } catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.map((item) => item.code)).toContain(expected); } }
function jsonNumbers(value: unknown): void { if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); else if (Array.isArray(value)) value.forEach(jsonNumbers); else if (value && typeof value === 'object') Object.values(value).forEach(jsonNumbers); }

describe('M20 independent continuous SISO mathematics', () => {
  it('matches first-order complex response, gain and phase against 2/(1+jω)', () => {
    const report = analyzeContinuousSiso(first(), { frequencyMin: 0.1, frequencyMax: 10, frequencyPoints: 3, rootLocusGains: [0, 1, 2] });
    expect(report.denominator).toEqual([1, 1]); expect(report.numerator).toEqual([2]); expect(report.poles).toEqual([{ real: -1, imag: 0 }]); expect(report.zeros).toEqual([]); expect(report.stability).toBe('stable');
    for (const point of report.bode) { const omega = point.omega; expect(point.real).toBeCloseTo(2 / (1 + omega ** 2), 12); expect(point.imag).toBeCloseTo(-2 * omega / (1 + omega ** 2), 12); expect(point.gainDb).toBeCloseTo(20 * Math.log10(2 / Math.hypot(1, omega)), 12); expect(point.phaseDegrees).toBeCloseTo(-Math.atan(omega) * 180 / Math.PI, 12); }
    expect(report.rootLocus.map((item) => item.poles[0]!.real)).toEqual([-1, -3, -5]);
  });
  it('refines analytic first-order gain crossover √3 and phase margin120°', () => {
    const report = analyzeContinuousSiso(first(), options); expect(report.margins.gainCrossovers).toHaveLength(1); expect(report.margins.gainCrossovers[0]!.omega).toBeCloseTo(Math.sqrt(3), 9); expect(report.margins.phaseMarginDegrees).toBeCloseTo(120, 8); expect(report.margins.gainMarginDb).toBeNull(); expect(report.margins.phaseCrossovers).toEqual([]); expect(report.margins.diagnostics.join(' ')).toContain('무한대로 표시하지 않습니다');
  });
  it('keeps negative-gain principal phase margin negative rather than adding360°', () => {
    const report = analyzeContinuousSiso(first(-2), options); expect(report.margins.gainCrossovers[0]!.omega).toBeCloseTo(Math.sqrt(3), 9); expect(report.margins.phaseMarginDegrees).toBeCloseTo(-60, 8); expect(report.bode[0]!.phaseDegrees).toBeGreaterThan(90); expect(report.bode[0]!.phaseDegrees).toBeLessThan(180);
  });
  it('matches an underdamped second-order oscillator and closed-loop roots', () => {
    const report = analyzeContinuousSiso(second(), { frequencyMin: 0.2, frequencyMax: 20, frequencyPoints: 3, rootLocusGains: [0, 1] });
    expect(report.denominator[0]).toBe(1); expect(report.denominator[1]).toBeCloseTo(1.2, 14); expect(report.denominator[2]).toBe(4); expect(report.numerator).toEqual([4]);
    expect(report.poles[0]!.real).toBeCloseTo(-0.6, 14); expect(report.poles[0]!.imag).toBeCloseTo(-Math.sqrt(3.64), 14); expect(report.poles[1]!.imag).toBeCloseTo(Math.sqrt(3.64), 14);
    const resonance = report.bode[1]!; expect(resonance.real).toBeCloseTo(0, 12); expect(resonance.imag).toBeCloseTo(-4 / 2.4, 12); expect(resonance.phaseDegrees).toBeCloseTo(-90, 12);
    expect(report.rootLocus[1]!.poles[0]!.real).toBeCloseTo(-0.6, 14); expect(Math.abs(report.rootLocus[1]!.poles[0]!.imag)).toBeCloseTo(Math.sqrt(7.64), 14);
  });
  it('matches third-order phase crossover√2 and analytic gain margin6', () => {
    const report = analyzeContinuousSiso(third(), { frequencyMin: 0.01, frequencyMax: 100, frequencyPoints: 101, rootLocusGains: [0, 6] });
    expect(report.denominator).toEqual([1, 3, 2, 0]); expect(report.numerator).toEqual([1]); [-2, -1, 0].forEach((value, index) => expect(report.poles[index]!.real).toBeCloseTo(value, 10)); expect(report.stability).toBe('boundary');
    expect(report.margins.phaseCrossovers).toHaveLength(1); const crossing = report.margins.phaseCrossovers[0]!; expect(crossing.omega).toBeCloseTo(Math.sqrt(2), 8); expect(crossing.gainMargin).toBeCloseTo(6, 8); expect(crossing.gainMarginDb).toBeCloseTo(20 * Math.log10(6), 8);
    const gain = report.margins.gainCrossovers[0]!, omega = gain.omega; expect(omega ** 2 * (omega ** 2 + 1) * (omega ** 2 + 4)).toBeCloseTo(1, 8); expect(gain.phaseMarginDegrees).toBeCloseTo(90 - (Math.atan(omega) + Math.atan(omega / 2)) * 180 / Math.PI, 8);
    const closed = report.rootLocus[1]!.poles; expect(closed.find((item) => item.imag === 0)!.real).toBeCloseTo(-3, 8); expect(closed.filter((item) => Math.abs(item.imag) > 0).map((item) => Math.abs(item.imag))).toEqual(expect.arrayContaining([expect.closeTo(Math.sqrt(2), 8)]));
  });
  it('reports gain margin below1 and negative dB for an over-gained open loop', () => {
    const report = analyzeContinuousSiso(third(10), options); expect(report.margins.gainMargin).toBeCloseTo(0.6, 8); expect(report.margins.gainMarginDb).toBeCloseTo(20 * Math.log10(0.6), 8); expect(report.margins.phaseMarginDegrees).toBeLessThan(0);
  });
  it('extracts a feedthrough transfer zero with the correct descending polynomial', () => {
    const report = analyzeContinuousSiso({ A: [[-2]], B: [[3]], C: [[4]], D: [[5]] }, { ...options, frequencyMin: 0.1, frequencyMax: 10, frequencyPoints: 3 });
    expect(report.denominator).toEqual([1, 2]); expect(report.numerator).toEqual([5, 22]); expect(report.zeros).toEqual([{ real: -4.4, imag: 0 }]);
    report.bode.forEach((point) => { expect(point.real).toBeCloseTo(5 + 24 / (4 + point.omega ** 2), 12); expect(point.imag).toBeCloseTo(-12 * point.omega / (4 + point.omega ** 2), 12); });
  });
  it('preserves a cancelled state pole as an explicit state pole and unreduced transfer zero', () => {
    const state: ControlStateSpace = { A: [[-1, 0], [0, -2]], B: [[1], [0]], C: [[1, 0]], D: [[0]] }, report = analyzeContinuousSiso(state, options);
    expect(report.poles.map((item) => item.real)).toEqual([-2, -1]); expect(report.zeros.map((item) => item.real)).toEqual([-2]); expect(report.denominator).toEqual([1, 3, 2]); expect(report.numerator).toEqual([1, 2]); expect(report.diagnostics.join(' ')).toContain('상쇄를 자동 적용하지 않습니다');
  });
  it('computes distinct fourth-order poles and stationary-product transfer zeros', () => {
    const state: ControlStateSpace = { A: [[-1, 0, 0, 0], [0, -2, 0, 0], [0, 0, -3, 0], [0, 0, 0, -4]], B: [[1], [1], [1], [1]], C: [[1, 1, 1, 1]], D: [[0]] }, report = analyzeContinuousSiso(state, { frequencyMin: 0.1, frequencyMax: 10, frequencyPoints: 3, rootLocusGains: [0, 0.5] });
    expect(report.denominator).toEqual([1, 10, 35, 50, 24]); expect(report.numerator).toEqual([4, 30, 70, 50]); report.poles.forEach((item, index) => expect(item.real).toBeCloseTo(index - 4, 8));
    [-2.5 - Math.sqrt(5) / 2, -2.5, -2.5 + Math.sqrt(5) / 2].forEach((value, index) => expect(report.zeros[index]!.real).toBeCloseTo(value, 8));
    report.bode.forEach((point) => { expect(point.real).toBeCloseTo([1, 2, 3, 4].reduce((sum, rate) => sum + rate / (rate ** 2 + point.omega ** 2), 0), 12); expect(point.imag).toBeCloseTo([1, 2, 3, 4].reduce((sum, rate) => sum - point.omega / (rate ** 2 + point.omega ** 2), 0), 12); });
    const closed = report.rootLocus[1]!.poles; expect(closed.reduce((sum, item) => sum + item.real, 0)).toBeCloseTo(-12, 8); expect(closed.reduce((sum, item) => sum + item.imag, 0)).toBeCloseTo(0, 8);
  });
  it('uses direct state solve and determinant expansion for a fast/slow diagonal state spread', () => {
    const state: ControlStateSpace = { A: [[-1e6, 0, 0, 0], [0, -1e5, 0, 0], [0, 0, -1e4, 0], [0, 0, 0, -1e-6]], B: [[0], [0], [0], [1]], C: [[0, 0, 0, 1]], D: [[0]] }, report = analyzeContinuousSiso(state, { frequencyMin: 1e-6, frequencyMax: 1e-4, frequencyPoints: 3, rootLocusGains: [] });
    expect(report.denominator.at(-1)).toBe(1e9); expect(report.poles.at(-1)!.real).toBeCloseTo(-1e-6, 12);
    const first = report.bode[0]!; expect(first.real).toBeCloseTo(500_000, 6); expect(first.imag).toBeCloseTo(-500_000, 6); report.bode.forEach((point) => { const expected = 1 / Math.hypot(point.omega, 1e-6); expect(Math.abs(point.magnitude! / expected - 1)).toBeLessThan(1e-12); });
  });
});

describe('M20 honest singularities, sampled boundaries and root locus', () => {
  it('does not turn a finite-range no-crossing scan into an infinite margin claim', () => {
    const report = analyzeContinuousSiso(first(0.1), options); expect(report.margins.status).toBe('no-crossing-in-range'); expect(report.margins.phaseMarginDegrees).toBeNull(); expect(report.margins.gainMargin).toBeNull(); expect(report.margins.diagnostics.join(' ')).toContain('선택'); jsonNumbers(report); expect(JSON.stringify(report)).not.toContain('Infinity');
  });
  it('marks identically zero transfer magnitude without manufacturing dB, phase or margins', () => {
    const report = analyzeContinuousSiso({ A: [[-1]], B: [[1]], C: [[0]], D: [[0]] }, options); expect(report.zeroTransfer).toBe(true); expect(report.zeros).toEqual([]); expect(report.poles).toEqual([{ real: -1, imag: 0 }]); expect(report.bode.every((point) => point.status === 'zero' && point.magnitude === 0 && point.gainDb === null && point.phaseDegrees === null)).toBe(true); expect(report.margins.phaseMarginDegrees).toBeNull(); jsonNumbers(report);
  });
  it('marks a sampled imaginary-axis pole as a gap instead of a finite curve segment', () => {
    const report = analyzeContinuousSiso({ A: [[0, 1], [-1, 0]], B: [[0], [1]], C: [[1, 0]], D: [[0]] }, { frequencyMin: 1, frequencyMax: 10, frequencyPoints: 3, rootLocusGains: [] }); expect(report.stability).toBe('boundary'); expect(report.bode[0]!.status).toBe('singular'); expect(report.bode[0]!.real).toBeNull(); expect(report.bode[0]!.gainDb).toBeNull(); expect(report.margins.status).toBe('incomplete'); jsonNumbers(report);
  });
  it.each([4, 11])('does not manufacture isolated phase crossovers from an undamped phase plateau, points=%i', (frequencyPoints) => {
    const report = analyzeContinuousSiso({ A: [[0, 1], [-1, 0]], B: [[0], [1]], C: [[1, 0]], D: [[0]] }, { frequencyMin: 0.1, frequencyMax: 10, frequencyPoints, rootLocusGains: [] }); expect(report.margins.phaseCrossovers).toEqual([]); expect(report.margins.gainMargin).toBeNull(); expect(report.margins.gainMarginDb).toBeNull(); expect(report.margins.status).toBe('incomplete');
  });
  it('does not present an all-pass 0dB continuum as hundreds of isolated gain crossings', () => {
    const report = analyzeContinuousSiso({ A: [[-1]], B: [[1]], C: [[-2]], D: [[1]] }, options); expect(report.numerator).toEqual([1, -1]); expect(report.zeros).toEqual([{ real: 1, imag: 0 }]); expect(report.margins.gainCrossovers).toEqual([]); expect(report.margins.phaseMarginDegrees).toBeNull(); expect(report.margins.status).toBe('incomplete');
  });
  it('keeps globally negative-real phase and static unity gain margins indeterminate', () => {
    const negative = analyzeContinuousSiso({ A: [[-1]], B: [[0]], C: [[1]], D: [[-2]] }, options); expect(negative.margins.phaseCrossovers).toEqual([]); expect(negative.margins.gainMargin).toBeNull(); expect(negative.margins.status).toBe('incomplete');
    const unity = analyzeContinuousSiso({ A: [[-1]], B: [[0]], C: [[1]], D: [[1]] }, options); expect(unity.margins.gainCrossovers).toEqual([]); expect(unity.margins.phaseMarginDegrees).toBeNull(); expect(unity.margins.status).toBe('incomplete');
  });
  it('refuses repeated fourth-order axis roots rather than falsely marking them unstable', () => {
    const state: ControlStateSpace = { A: [[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 0, -1], [0, 0, 1, 0]], B: [[1], [0], [0], [0]], C: [[1, 0, 0, 0]], D: [[0]] };
    code(() => analyzeContinuousSiso(state, options), 'CONTROL_ROOT_UNCERTAIN');
  });
  it('refuses coefficient-product underflow rather than contradicting a nonzero raw response', () => {
    code(() => analyzeContinuousSiso({ A: [[0]], B: [[5e-165]], C: [[5e-165]], D: [[0]] }, { frequencyMin: 1e-6, frequencyMax: 1, rootLocusGains: [] }), 'CONTROL_TRANSFER_NUMERIC');
  });
  it('marks positive-real state poles unstable without treating margins as a stability proof', () => {
    const report = analyzeContinuousSiso({ A: [[1]], B: [[1]], C: [[1]], D: [[0]] }, options); expect(report.stability).toBe('unstable'); expect(report.poles[0]!.real).toBe(1); expect(report.margins.diagnostics.join(' ')).toContain('폐루프를 자동 추론하지 않습니다');
  });
  it('keeps ill-posed direct-feedthrough feedback gains as independent root-locus gaps', () => {
    const state: ControlStateSpace = { A: [[-1]], B: [[1]], C: [[1]], D: [[-1]] }, report = analyzeContinuousSiso(state, { rootLocusGains: [0, 0.5, 1, 2] });
    expect(report.rootLocus.map((point) => point.status)).toEqual(['completed', 'completed', 'ill-posed', 'completed']); expect(report.rootLocus[2]!.poles).toEqual([]); expect(report.bode).toHaveLength(201); expect(report.rootLocus[2]!.diagnostics.join(' ')).toContain('1+kD=0'); expect(report.rootLocus[3]!.poles[0]!.real).toBe(1); jsonNumbers(report);
  });
  it('keeps an uncertain repeated cubic root-locus gain separate from the valid Bode and later gains', () => {
    const report = analyzeContinuousSiso(third(), { rootLocusGains: [0, 2 / (3 * Math.sqrt(3)), 1] }); expect(report.rootLocus.map((point) => point.status)).toEqual(['completed', 'unsupported', 'completed']); expect(report.rootLocus[1]!.poles).toEqual([]); expect(report.bode).toHaveLength(201); expect(report.margins.gainMargin).toBeCloseTo(6, 8); expect(report.rootLocus[2]!.poles).toHaveLength(3); jsonNumbers(report);
  });
  it('leaves pole-zero reporting available when root-locus sampling is disabled', () => {
    const report = analyzeContinuousSiso(first(), options); expect(report.rootLocus).toEqual([]); expect(report.diagnostics.join(' ')).not.toContain('피드백'); expect(report.diagnostics.join(' ')).not.toContain('근궤적'); expect(report.margins.diagnostics.join(' ')).toContain('unity 음의 피드백');
  });
});

describe('M20 bounded plain-data contracts and immutability', () => {
  it('reads actual A/B/C/D bus fields by name and copies them without modifying caller data', () => {
    const state = first(), source = bus(state) as { fields: unknown[] }, before = structuredClone(source); source.fields.reverse(); const reversed = structuredClone(source), parsed = readLinearizationStateSpace(source), result = analyzeContinuousSiso(parsed, options);
    expect(source).toEqual(reversed); expect(parsed.A).toEqual([[-1]]); expect(result.stateSpace.A).toEqual([[-1]]); result.stateSpace.A[0]![0] = 99; expect(parsed.A[0]![0]).toBe(-1); expect(state.A[0]![0]).toBe(-1); expect(before.fields).toHaveLength(4);
  });
  it('rejects bus and row getters before executing any accessor', () => {
    let called = false; const source = bus() as { fields: { name: string; value: unknown }[] }; Object.defineProperty(source.fields[0], 'value', { enumerable: true, get: () => { called = true; return [[-1]]; } }); code(() => readLinearizationStateSpace(source), 'CONTROL_LINEARIZATION_BUS'); expect(called).toBe(false);
    const state = first(); Object.defineProperty(state.A[0], '0', { enumerable: true, get: () => { called = true; return -1; } }); code(() => analyzeContinuousSiso(state), 'CONTROL_INPUT'); expect(called).toBe(false);
    const spec = {}; Object.defineProperty(spec, 'frequencyPoints', { enumerable: true, get: () => { called = true; return 2; } }); code(() => analyzeContinuousSiso(first(), spec), 'CONTROL_OPTIONS'); expect(called).toBe(false);
  });
  it.each([
    { kind: 'bus', fields: [{ name: 'A', value: [[-1]] }] },
    { kind: 'bus', fields: ['A', 'A', 'C', 'D'].map((name) => ({ name, value: [[1]] })) },
    { kind: 'bus', fields: ['A', 'B', 'C', 'script'].map((name) => ({ name, value: [[1]] })) },
    { kind: 'typed', dtype: 'float64', shape: [4], data: [-1, 1, 2, 0] },
  ])('rejects invented or unsupported linearization bus %j', (value) => { expect(() => readLinearizationStateSpace(value)).toThrow(ModelError); });
  it.each([
    { ...first(), domain: 'discrete' }, { ...first(), B: [[1, 2]] }, { ...first(), C: [[1], [2]] }, { ...first(), D: [[0, 1]] },
    { ...first(), A: [[-1, 2]] }, { ...first(), A: [[Infinity]] }, { ...first(), A: [[1e7]] }, { ...first(), B: [['1']] },
    { ...first(), A: Array.from({ length: 5 }, () => Array(5).fill(0)) }, { ...first(), A: [new Array(1)] },
  ])('rejects unsupported matrix/domain data %j', (state) => { expect(() => analyzeContinuousSiso(state as unknown as ControlStateSpace)).toThrow(ModelError); });
  it.each([
    { frequencyMin: 0 }, { frequencyMin: 1e-7 }, { frequencyMax: 1e7 }, { frequencyMin: 10, frequencyMax: 1 }, { frequencyPoints: 1 }, { frequencyPoints: 802 }, { frequencyPoints: 2.5 },
    { rootLocusGains: [-1] }, { rootLocusGains: [1e7] }, { rootLocusGains: [0, 0] }, { rootLocusGains: [1, 0] }, { rootLocusGains: Array.from({ length: 82 }, (_, index) => index) }, { script: 'alert(1)' },
  ])('cannot evade bounded options: %j', (spec) => { code(() => analyzeContinuousSiso(first(), spec as ControlAnalysisSpec), 'CONTROL_OPTIONS'); });
  it('rejects nonplain objects, symbol and hidden options, and prototype pollution fields', () => {
    for (const spec of [new Date(), { [Symbol('gain')]: 1 }, Object.defineProperty({}, 'frequencyPoints', { value: 2 }), JSON.parse('{"__proto__":{}}')]) code(() => analyzeContinuousSiso(first(), spec), 'CONTROL_OPTIONS');
    code(() => analyzeContinuousSiso(Object.assign(Object.create({ A: [[-1]] }), { B: [[1]], C: [[2]], D: [[0]] })), 'CONTROL_INPUT');
  });
  it('uses deterministic finite bounded outputs at maximum frequency and root sample counts', () => {
    const state = second(), spec = { frequencyMin: 1e-6, frequencyMax: 1e6, frequencyPoints: 801, rootLocusGains: Array.from({ length: 81 }, (_, index) => index) }, original = structuredClone(state), settings = structuredClone(spec), result = analyzeContinuousSiso(state, spec), repeat = analyzeContinuousSiso(state, spec);
    expect(result).toEqual(repeat); expect(state).toEqual(original); expect(spec).toEqual(settings); expect(result.bode).toHaveLength(801); expect(result.rootLocus).toHaveLength(81); jsonNumbers(result);
  });
});
