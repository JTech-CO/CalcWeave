import { describe, expect, it } from 'vitest';
import { analyzeDiscreteSiso, readDiscreteStateSpace, type DiscreteControlStateSpace } from '../packages/analysis/src/discrete-control-system';
import { analyzeContinuousSiso, type ControlAnalysisSpec, type ControlStateSpace } from '../packages/analysis/src/control-system';
import { ModelError } from '../packages/model/src';

const state = (pole = 0.5, gain = 1, sampleTime = 0.1): DiscreteControlStateSpace => ({ A: [[pole]], B: [[1]], C: [[gain]], D: [[0]], domain: 'discrete', sampleTime });
const options: ControlAnalysisSpec = { rootLocusGains: [] };
function code(action: () => unknown, expected: string): void {
  try { action(); throw new Error('Did not reject'); }
  catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics.map((item) => item.code)).toContain(expected); }
}
function finiteNumbers(value: unknown): void {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(finiteNumbers);
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteNumbers);
}

describe('M22 independent physical-frequency SISO oracles', () => {
  it('matches H(z)=1/(z-.5), physical ω and exact Nyquist endpoint', () => {
    const report = analyzeDiscreteSiso(state(), { frequencyMin: 0.1, frequencyMax: Math.PI / 0.1, frequencyPoints: 5, rootLocusGains: [0, 0.5, 1, 2] });
    expect(report.denominator).toEqual([1, -0.5]); expect(report.numerator).toEqual([1]); expect(report.poles).toEqual([{ real: 0.5, imag: 0 }]); expect(report.zeros).toEqual([]);
    expect(report.domain).toBe('discrete'); expect(report.stateSpace.domain).toBe('discrete'); expect(report.sampleTime).toBe(0.1); expect(report.nyquistOmega).toBe(Math.PI / 0.1); expect(report.stabilityCriterion).toBe('unit-circle'); expect(report.stability).toBe('stable');
    expect(report.bode.at(-1)!.omega).toBe(Math.PI / 0.1);
    for (const point of report.bode) {
      const theta = point.omega * 0.1, re = Math.cos(theta) - 0.5, im = Math.sin(theta), denominator = re ** 2 + im ** 2;
      expect(point.real).toBeCloseTo(re / denominator, 12); expect(point.imag).toBeCloseTo(-im / denominator, 12); expect(point.magnitude).toBeCloseTo(1 / Math.sqrt(denominator), 12); expect(point.gainDb).toBeCloseTo(-10 * Math.log10(denominator), 12);
    }
    [0.5, 0, -0.5, -1.5].forEach((value, index) => expect(report.rootLocus[index]!.poles[0]!.real).toBeCloseTo(value, 14));
  });
  it.each([0.01, 0.1, 1, 10])('keeps one analytic normalized response with explicit Ts=%s', (sampleTime) => {
    const report = analyzeDiscreteSiso(state(0.5, 1, sampleTime), { frequencyMin: 0.1 / sampleTime, frequencyMax: Math.PI / sampleTime, frequencyPoints: 3, rootLocusGains: [] });
    const first = report.bode[0]!; expect(first.real).toBeCloseTo((Math.cos(0.1) - 0.5) / (1.25 - Math.cos(0.1)), 12); expect(first.imag).toBeCloseTo(-Math.sin(0.1) / (1.25 - Math.cos(0.1)), 12); expect(report.bode.at(-1)!.magnitude).toBeCloseTo(2 / 3, 12);
  });
  it('matches a two-tap FIR 2z⁻¹+3z⁻² and preserves the repeated zero state pole', () => {
    const input: DiscreteControlStateSpace = { A: [[0, 0], [1, 0]], B: [[1], [0]], C: [[2, 3]], D: [[0]], domain: 'discrete', sampleTime: 1 };
    const report = analyzeDiscreteSiso(input, { frequencyMin: 0.1, frequencyMax: Math.PI, frequencyPoints: 7, rootLocusGains: [] });
    expect(report.denominator).toEqual([1, 0, 0]); expect(report.numerator).toEqual([2, 3]); expect(report.poles).toEqual([{ real: 0, imag: 0 }, { real: 0, imag: 0 }]); expect(report.zeros).toEqual([{ real: -1.5, imag: 0 }]); expect(report.stability).toBe('stable');
    report.bode.forEach((point) => { expect(point.real).toBeCloseTo(2 * Math.cos(point.omega) + 3 * Math.cos(2 * point.omega), 12); expect(point.imag).toBeCloseTo(-2 * Math.sin(point.omega) - 3 * Math.sin(2 * point.omega), 12); });
  });
  it('matches direct feedthrough D+CB/(z-a) and descending z coefficients', () => {
    const report = analyzeDiscreteSiso({ ...state(0.25), B: [[3]], C: [[4]], D: [[5]] }, { ...options, frequencyMax: Math.PI / 0.1, frequencyPoints: 5 });
    expect(report.denominator).toEqual([1, -0.25]); expect(report.numerator).toEqual([5, 10.75]); expect(report.zeros[0]!.real).toBeCloseTo(-2.15, 14);
    report.bode.forEach((point) => { const theta = point.omega * 0.1, denominator = 1.0625 - 0.5 * Math.cos(theta); expect(point.real).toBeCloseTo(5 + 12 * (Math.cos(theta) - 0.25) / denominator, 12); expect(point.imag).toBeCloseTo(-12 * Math.sin(theta) / denominator, 12); });
  });
  it('retains an unobservable unstable state pole instead of claiming transfer stability', () => {
    const report = analyzeDiscreteSiso({ A: [[0.5, 0], [0, 1.2]], B: [[1], [0]], C: [[1, 0]], D: [[0]], domain: 'discrete', sampleTime: 0.1 }, options);
    expect(report.stability).toBe('unstable'); expect(report.poles.map((pole) => pole.real)).toEqual([0.5, 1.2]); expect(report.zeros[0]!.real).toBeCloseTo(1.2, 14); expect(report.diagnostics.join(' ')).toContain('상쇄를 자동 적용하지 않습니다');
  });
  it('matches four distinct diagonal pole responses and unmodified state polynomial', () => {
    const poles = [-0.8, -0.2, 0.3, 0.7];
    const input: DiscreteControlStateSpace = { A: poles.map((value, row) => poles.map((_, column) => row === column ? value : 0)), B: [[1], [1], [1], [1]], C: [[1, 1, 1, 1]], D: [[0]], domain: 'discrete', sampleTime: 0.2 };
    const report = analyzeDiscreteSiso(input, { frequencyMin: 0.1, frequencyMax: Math.PI / 0.2, frequencyPoints: 5, rootLocusGains: [0, 0.1] });
    poles.forEach((value, index) => expect(report.poles[index]!.real).toBeCloseTo(value, 10)); expect(report.stateOrder).toBe(4); expect(report.stability).toBe('stable');
    report.bode.forEach((point) => { const theta = point.omega * 0.2; expect(point.real).toBeCloseTo(poles.reduce((sum, pole) => sum + (Math.cos(theta) - pole) / (1 + pole ** 2 - 2 * pole * Math.cos(theta)), 0), 11); expect(point.imag).toBeCloseTo(poles.reduce((sum, pole) => sum - Math.sin(theta) / (1 + pole ** 2 - 2 * pole * Math.cos(theta)), 0), 11); });
    expect(report.rootLocus[1]!.poles.reduce((sum, pole) => sum + pole.real, 0)).toBeCloseTo(poles.reduce((sum, value) => sum + value, 0) - 0.4, 10);
  });
  it('matches a third-order IIR with three distinct scalar partial fractions', () => {
    const poles = [-0.3, 0.2, 0.8], gains = [1, -2, 3];
    const report = analyzeDiscreteSiso({ A: poles.map((value, row) => poles.map((_, column) => row === column ? value : 0)), B: [[1], [1], [1]], C: [gains], D: [[0]], domain: 'discrete', sampleTime: 0.5 }, { frequencyMin: 0.1, frequencyMax: Math.PI / 0.5, frequencyPoints: 5, rootLocusGains: [] });
    expect(report.stateOrder).toBe(3); poles.forEach((value, index) => expect(report.poles[index]!.real).toBeCloseTo(value, 10));
    report.bode.forEach((point) => { const theta = point.omega * 0.5; expect(point.real).toBeCloseTo(poles.reduce((sum, pole, index) => sum + gains[index]! * (Math.cos(theta) - pole) / (1 + pole ** 2 - 2 * pole * Math.cos(theta)), 0), 11); expect(point.imag).toBeCloseTo(poles.reduce((sum, pole, index) => sum - gains[index]! * Math.sin(theta) / (1 + pole ** 2 - 2 * pole * Math.cos(theta)), 0), 11); });
  });
  it('finds the analytic gain crossing cosθ=.25 and Nyquist gain margin1.5', () => {
    const report = analyzeDiscreteSiso(state(), { frequencyMin: 0.01, frequencyMax: Math.PI / 0.1, frequencyPoints: 101, rootLocusGains: [] });
    const theta = Math.acos(0.25), crossing = report.margins.gainCrossovers[0]!;
    expect(report.margins.gainCrossovers).toHaveLength(1); expect(crossing.omega).toBeCloseTo(theta / 0.1, 8); expect(crossing.phaseMarginDegrees).toBeCloseTo(180 - Math.atan2(Math.sin(theta), Math.cos(theta) - 0.5) * 180 / Math.PI, 8);
    expect(report.margins.phaseCrossovers).toHaveLength(1); expect(report.margins.phaseCrossovers[0]!.omega).toBe(Math.PI / 0.1); expect(report.margins.gainMargin).toBeCloseTo(1.5, 12); expect(report.margins.gainMarginDb).toBeCloseTo(20 * Math.log10(1.5), 12); expect(report.margins.diagnostics.join(' ')).toContain('L(z)');
  });
});

describe('M22 unit-circle, sampled crossings and numerical uncertainty', () => {
  it.each([-1.2, 1.2])('marks pole %s outside the unit circle as unstable', (pole) => { expect(analyzeDiscreteSiso(state(pole), options).stability).toBe('unstable'); });
  it.each([-0.9, 0, 0.9])('marks pole %s inside the unit circle as stable', (pole) => { expect(analyzeDiscreteSiso(state(pole), options).stability).toBe('stable'); });
  it.each([-1, 1, 1 - 1e-10, -1 + 1e-10])('does not call pole %s near/on the unit circle strictly stable', (pole) => { const report = analyzeDiscreteSiso(state(pole), options); expect(report.stability).toBe('boundary'); expect(report.diagnostics.join(' ')).toContain('단위원 경계'); });
  it('keeps a repeated second-order unit pole at the stability boundary', () => {
    const report = analyzeDiscreteSiso({ A: [[1, 1], [0, 1]], B: [[0], [1]], C: [[1, 0]], D: [[0]], domain: 'discrete', sampleTime: 1 }, options);
    expect(report.poles).toEqual([{ real: 1, imag: 0 }, { real: 1, imag: 0 }]); expect(report.stability).toBe('boundary');
  });
  it('reports a sampled complex unit-circle pole as a gap', () => {
    const input: DiscreteControlStateSpace = { A: [[0, -1], [1, 0]], B: [[1], [0]], C: [[1, 0]], D: [[0]], domain: 'discrete', sampleTime: 1 };
    const report = analyzeDiscreteSiso(input, { frequencyMin: Math.PI / 2, frequencyMax: Math.PI, frequencyPoints: 3, rootLocusGains: [] });
    expect(report.stability).toBe('boundary'); expect(report.bode[0]!.status).toBe('singular'); expect(report.bode[0]!.real).toBeNull(); expect(report.bode[0]!.gainDb).toBeNull(); expect(report.margins.status).toBe('incomplete'); finiteNumbers(report);
  });
  it('keeps the Nyquist pole at z=-1 as a gap rather than a huge finite response', () => {
    const report = analyzeDiscreteSiso(state(-1, 1, 1), { ...options, frequencyMin: 0.1, frequencyMax: Math.PI }); expect(report.bode.at(-1)!.status).toBe('singular'); expect(report.bode.at(-1)!.magnitude).toBeNull(); expect(report.margins.status).toBe('incomplete');
  });
  it('refuses repeated fourth-order unit roots rather than manufacturing stability', () => {
    code(() => analyzeDiscreteSiso({ A: [[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 0, -1], [0, 0, 1, 0]], B: [[1], [0], [0], [0]], C: [[1, 0, 0, 0]], D: [[0]], domain: 'discrete', sampleTime: 1 }, options), 'CONTROL_ROOT_UNCERTAIN');
  });
  it('keeps one repeated cubic root-locus gain uncertain without losing later gains', () => {
    const report = analyzeDiscreteSiso({ A: [[0, 1, 0], [0, 0, 1], [0, -0.32, -1.2]], B: [[0], [0], [1]], C: [[1, 0, 0]], D: [[0]], domain: 'discrete', sampleTime: 1 }, { rootLocusGains: [0, 0.4 ** 3 * 2 / (3 * Math.sqrt(3)), 0.1] });
    expect(report.rootLocus.map((point) => point.status)).toEqual(['completed', 'unsupported', 'completed']); expect(report.rootLocus[1]!.poles).toEqual([]); expect(report.rootLocus[1]!.diagnostics.join(' ')).toContain('근'); expect(report.bode).toHaveLength(201); finiteNumbers(report);
  });
  it('does not manufacture phase crossings when phase wraps through the positive real axis', () => {
    const report = analyzeDiscreteSiso(state(0, -2, 1), { ...options, frequencyMin: 0.01, frequencyMax: Math.PI, frequencyPoints: 31 });
    expect(report.margins.phaseCrossovers).toEqual([]); expect(report.margins.gainMargin).toBeNull(); expect(report.bode.at(-1)!.phaseDegrees).toBeCloseTo(0, 12);
  });
  it('keeps constant negative phase and constant 0dB as indeterminate continua', () => {
    const negative = analyzeDiscreteSiso({ ...state(), B: [[0]], D: [[-2]] }, options), unity = analyzeDiscreteSiso(state(0), options);
    expect(negative.margins.phaseCrossovers).toEqual([]); expect(negative.margins.gainMargin).toBeNull(); expect(negative.margins.status).toBe('incomplete'); expect(unity.margins.gainCrossovers).toEqual([]); expect(unity.margins.phaseMarginDegrees).toBeNull(); expect(unity.margins.status).toBe('incomplete');
  });
  it('preserves zero transfer poles and uses null rather than invented phase/dB', () => {
    const report = analyzeDiscreteSiso(state(1.2, 0), options); expect(report.zeroTransfer).toBe(true); expect(report.stability).toBe('unstable'); expect(report.bode.every((point) => point.status === 'zero' && point.magnitude === 0 && point.gainDb === null && point.phaseDegrees === null)).toBe(true); expect(report.margins.gainMargin).toBeNull(); finiteNumbers(report);
  });
  it('keeps a no-crossing finite range distinct from an infinite gain margin', () => {
    const report = analyzeDiscreteSiso(state(0.5, 0.1), { ...options, frequencyMin: 0.01, frequencyMax: 1 }); expect(report.margins.status).toBe('no-crossing-in-range'); expect(report.margins.phaseMarginDegrees).toBeNull(); expect(report.margins.gainMargin).toBeNull(); expect(JSON.stringify(report)).not.toContain('Infinity');
  });
  it('keeps ill-posed 1+kD=0 feedback as an independent root-locus gap', () => {
    const report = analyzeDiscreteSiso({ ...state(), D: [[-1]] }, { rootLocusGains: [0, 0.5, 1, 2] }); expect(report.rootLocus.map((point) => point.status)).toEqual(['completed', 'completed', 'ill-posed', 'completed']); expect(report.rootLocus[2]!.poles).toEqual([]); expect(report.rootLocus[2]!.diagnostics.join(' ')).toContain('1+kD=0'); expect(report.rootLocus[3]!.poles[0]!.real).toBeCloseTo(2.5, 12); finiteNumbers(report);
  });
  it('rejects nonzero coefficient product underflow', () => { code(() => analyzeDiscreteSiso({ ...state(0), B: [[5e-165]], C: [[5e-165]] }, options), 'CONTROL_TRANSFER_NUMERIC'); });
});

describe('M22 bounded plain-data and separate domain contracts', () => {
  it('copies input, options and matrix snapshots without altering caller state', () => {
    const input = state(), original = structuredClone(input), spec = { frequencyPoints: 3, rootLocusGains: [0, 1] }, settings = structuredClone(spec), parsed = readDiscreteStateSpace(input), report = analyzeDiscreteSiso(parsed, spec);
    report.stateSpace.A[0]![0] = 99; expect(input).toEqual(original); expect(parsed.A).toEqual([[0.5]]); expect(spec).toEqual(settings);
  });
  it('never invokes matrix, domain, sample time or options getters', () => {
    let invoked = 0;
    for (const name of ['domain', 'sampleTime', 'A']) { const input = state(); Object.defineProperty(input, name, { enumerable: true, get: () => { invoked++; return name === 'sampleTime' ? 0.1 : name === 'domain' ? 'discrete' : [[0.5]]; } }); code(() => readDiscreteStateSpace(input), 'CONTROL_INPUT'); }
    const input = state(); Object.defineProperty(input.A[0], '0', { enumerable: true, get: () => { invoked++; return 0.5; } }); code(() => analyzeDiscreteSiso(input), 'CONTROL_INPUT');
    const spec = {}; Object.defineProperty(spec, 'frequencyPoints', { enumerable: true, get: () => { invoked++; return 3; } }); code(() => analyzeDiscreteSiso(state(), spec), 'CONTROL_OPTIONS'); expect(invoked).toBe(0);
  });
  it.each([undefined, 'continuous', 'sampled'])('requires explicit discrete domain %s', (domain) => { code(() => readDiscreteStateSpace({ ...state(), domain }), 'CONTROL_DOMAIN'); });
  it('keeps continuous analysis from accepting an explicit discrete model', () => { expect(() => analyzeContinuousSiso(state() as unknown as ControlStateSpace)).toThrow(ModelError); });
  it.each([undefined, 0, -1, 1e-10, 1e10, NaN, Infinity, '0.1'])('rejects invalid sample time %s without coercion', (sampleTime) => { code(() => readDiscreteStateSpace({ ...state(), sampleTime }), 'CONTROL_SAMPLE_TIME'); });
  it.each([1e-9, 1e9])('accepts the explicit sample time reader boundary %s', (sampleTime) => { expect(readDiscreteStateSpace(state(0.5, 1, sampleTime)).sampleTime).toBe(sampleTime); });
  it('refuses a sample time with no supported positive Nyquist frequency interval', () => { code(() => analyzeDiscreteSiso(state(0.5, 1, 1e9), options), 'CONTROL_OPTIONS'); });
  it('chooses a valid bounded default near the low-frequency Nyquist boundary', () => { const report = analyzeDiscreteSiso(state(0.5, 1, 1e6), options); expect(report.frequencyRange.minimum).toBe(1e-6); expect(report.frequencyRange.maximum).toBe(Math.PI / 1e6); });
  it('adapts the omitted minimum to an explicitly narrow physical range', () => { const report = analyzeDiscreteSiso(state(), { ...options, frequencyMax: 1e-4 }); expect(report.frequencyRange.minimum).toBe(1e-6); expect(report.frequencyRange.maximum).toBe(1e-4); });
  it.each([
    { A: [[NaN]] }, { A: [[1e7]] }, { B: [['1']] }, { B: [[1, 2]] }, { C: [[1], [2]] }, { D: [[0, 1]] }, { A: [[1, 2]] }, { A: Array.from({ length: 5 }, () => Array(5).fill(0)) }, { A: [new Array(1)] }, { A: [new Float64Array([0.5])] },
  ])('does not reduce/coerce unsupported matrices %j', (change) => { expect(() => readDiscreteStateSpace({ ...state(), ...change })).toThrow(ModelError); });
  it.each([
    { frequencyMin: 0 }, { frequencyMin: 1e-7 }, { frequencyMax: 1e7 }, { frequencyMin: 2, frequencyMax: 1 }, { frequencyPoints: 1 }, { frequencyPoints: 802 }, { frequencyPoints: 2.5 }, { rootLocusGains: [-1] }, { rootLocusGains: [1e7] }, { rootLocusGains: [0, 0] }, { rootLocusGains: [1, 0] }, { rootLocusGains: Array.from({ length: 82 }, (_, index) => index) }, { script: 'alert(1)' },
  ])('cannot evade options limits %j', (spec) => { code(() => analyzeDiscreteSiso(state(), spec as ControlAnalysisSpec), 'CONTROL_OPTIONS'); });
  it('rejects Nyquist overshoot before wrapping or aliasing an invalid frequency', () => { code(() => analyzeDiscreteSiso(state(), { frequencyMax: Math.PI / 0.1 * (1 + 1e-12) }), 'CONTROL_NYQUIST'); });
  it('retains the physical frequency ceiling even for very small sample time', () => { const report = analyzeDiscreteSiso(state(0.5, 1, 1e-9), { ...options, frequencyMin: 1e-6, frequencyMax: 1e6, frequencyPoints: 3 }); expect(report.frequencyRange.maximum).toBe(1e6); expect(report.nyquistOmega).toBeGreaterThan(1e6); expect(report.bode.at(-1)!.real).toBeCloseTo((Math.cos(0.001) - 0.5) / (1.25 - Math.cos(0.001)), 11); });
  it('rejects prototype pollution, hidden fields and executable-shaped values', () => {
    for (const change of [{ E: [[1]] }, { [Symbol('Ts')]: 0.1 }, JSON.parse('{"__proto__":{}}')]) code(() => readDiscreteStateSpace({ ...state(), ...change }), 'CONTROL_INPUT');
    const hidden = state(); Object.defineProperty(hidden, 'hidden', { value: 1 }); code(() => readDiscreteStateSpace(hidden), 'CONTROL_INPUT'); code(() => readDiscreteStateSpace(Object.assign(Object.create({ script: true }), state())), 'CONTROL_INPUT');
    for (const spec of [new Date(), Object.defineProperty({}, 'frequencyPoints', { value: 2 }), { [Symbol('gain')]: 1 }]) code(() => analyzeDiscreteSiso(state(), spec), 'CONTROL_OPTIONS');
  });
  it('returns deterministic finite JSON at maximum bounded samples', () => {
    const spec = { frequencyMin: 1e-6, frequencyMax: Math.PI / 0.1, frequencyPoints: 801, rootLocusGains: Array.from({ length: 81 }, (_, index) => index / 8) }, report = analyzeDiscreteSiso(state(), spec);
    expect(report).toEqual(analyzeDiscreteSiso(state(), spec)); expect(report.bode).toHaveLength(801); expect(report.rootLocus).toHaveLength(81); finiteNumbers(report); expect(JSON.parse(JSON.stringify(report)).domain).toBe('discrete');
  });
});
