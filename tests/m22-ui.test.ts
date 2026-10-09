import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeDiscreteSiso, type DiscreteControlStateSpace } from '../packages/analysis/src/discrete-control-system';
import { compileModel } from '../packages/compiler/src';
import { ENGINE_VERSION } from '../packages/model/src';
import { sha256 } from '../packages/model/src/sha256';
import { createExample } from '../apps/web/src/examples';
import { discreteControlAnalysisSources } from '../apps/web/src/discrete-control-analysis-sources';
import { ComplexPlane } from '../apps/web/src/components/ControlSystemPanel';
import { DiscreteControlAnalysisSummary, DiscreteControlSystemPanel, discreteControlDefaultDraft, discreteControlDraftOptions, discreteControlReportExport, type CapturedDiscreteControlReport } from '../apps/web/src/components/DiscreteControlSystemPanel';

const model = createExample('discrete-state-space');
const system: DiscreteControlStateSpace = { A: [[.5]], B: [[1]], C: [[1]], D: [[0]], domain: 'discrete', sampleTime: 1 };
const draft = { minimum: String(Math.PI / 4), maximum: String(Math.PI), points: '3', gainMaximum: '2', gainPoints: '3' };
const source = () => discreteControlAnalysisSources(model).sources[0]!;
function capture(feedback = false, selected = system): CapturedDiscreteControlReport {
  const options = discreteControlDraftOptions(draft, feedback, selected.sampleTime);
  return { source: { ...source(), system: structuredClone(selected) }, options, feedbackAssumptionAccepted: feedback, result: analyzeDiscreteSiso(selected, options) };
}

describe('M22 discrete SISO UI, explicit sampling and independent captured exports', () => {
  it('opens from current discrete matrices with an explicit sample period and a bounded Nyquist range', () => {
    const html = renderToStaticMarkup(createElement(DiscreteControlSystemPanel, { model, busy: false, invalidDraft: false }));
    expect(html).toContain('data-testid="discrete-control-system-panel"'); expect(html).toContain('이산 실수 SISO');
    expect(html).toContain('샘플 주기 Ts = 1 s'); expect(html).toContain(`Nyquist = ${Math.PI} rad/s`);
    expect(html).toContain('기본 간격 1 s × period 1'); expect(html).toContain('aria-label="이산 제어계 행렬 출처"');
    expect(html).toContain(`aria-label="이산 제어계 주파수 종료" value="${Math.PI}"`);
    expect(html).toContain('모델과 실행 결과를 변경하지 않습니다'); expect(html).toContain('1~4개');
    expect(html).not.toContain('aria-label="이산 제어계 분석 결과"');
  });
  it('starts with a visibly unchecked unity negative feedback assumption and no gain form', () => {
    const html = renderToStaticMarkup(createElement(DiscreteControlSystemPanel, { model, busy: false, invalidDraft: false }));
    expect(html).toContain('aria-label="이산 단위 음의 피드백 가정"'); expect(html).not.toContain('checked=""');
    expect(html).not.toContain('aria-label="이산 근궤적 K 최댓값"'); expect(html).toContain('L(z)');
    expect(html).toContain('다중 rate 연결이나 실제 도식의 폐루프를 자동 추론하지 않습니다');
  });
  it('uses the source Ts to choose defaults without crossing the Nyquist or global limits', () => {
    expect(discreteControlDefaultDraft(1).maximum).toBe(String(Math.PI));
    expect(discreteControlDefaultDraft(1).minimum).toBe(String(Math.PI / 10000));
    expect(discreteControlDefaultDraft(.001).maximum).toBe('100');
    expect(discreteControlDefaultDraft(1e6).minimum).toBe('0.000001');
    expect(() => discreteControlDraftOptions(discreteControlDefaultDraft(1e6), false, 1e6)).not.toThrow();
  });
  it('accepts physical rad/s at exactly Nyquist and generates only the requested K samples', () => {
    expect(discreteControlDraftOptions(draft, false, 1)).toEqual({ frequencyMin: Math.PI / 4, frequencyMax: Math.PI, frequencyPoints: 3, rootLocusGains: [] });
    expect(discreteControlDraftOptions(draft, true, 1).rootLocusGains).toEqual([0, 1, 2]);
    expect(discreteControlDraftOptions({ minimum: '1e-6', maximum: '1e6', points: '801', gainMaximum: '1e6', gainPoints: '81' }, true, 1e-9).rootLocusGains).toHaveLength(81);
  });
  for (const patch of [{ minimum: '0' }, { minimum: '1e-7' }, { maximum: String(Math.PI + 1e-9) }, { maximum: '1e7' }, { maximum: '.1' }, { points: '1' }, { points: '802' }, { points: '2.5' }, { minimum: '0x10' }, { minimum: '' }, { maximum: 'Infinity' }, { maximum: 'alert(1)' }, { maximum: '1'.repeat(101) }]) {
    it(`rejects an invalid physical-frequency form ${JSON.stringify(patch)}`, () => { expect(() => discreteControlDraftOptions({ ...draft, ...patch }, false, 1)).toThrow(); });
  }
  for (const patch of [{ gainMaximum: '0' }, { gainMaximum: '-1' }, { gainMaximum: '1e7' }, { gainPoints: '1' }, { gainPoints: '82' }, { gainPoints: 'NaN' }, { gainMaximum: '' }]) {
    it(`rejects an invalid requested gain form ${JSON.stringify(patch)}`, () => { expect(() => discreteControlDraftOptions({ ...draft, ...patch }, true, 1)).toThrow(); });
  }
  it('rejects unavailable sample periods and ignores unaccepted gain drafts', () => {
    for (const sampleTime of [0, -1, NaN, Infinity, 1e-10, 1e10]) expect(() => discreteControlDraftOptions(draft, false, sampleTime)).toThrow();
    expect(discreteControlDraftOptions({ ...draft, gainMaximum: 'invalid', gainPoints: '' }, false, 1).rootLocusGains).toEqual([]);
  });
  it('keeps source, Ts, exact options and semantic fingerprint in a detached JSON export', () => {
    const record = capture(), exported = discreteControlReportExport(record) as typeof record & { schemaVersion: number; kind: string; engineVersion: string; feedbackAssumption: string | null };
    expect(exported.schemaVersion).toBe(1); expect(exported.kind).toBe('discrete-siso-control-analysis'); expect(exported.engineVersion).toBe(ENGINE_VERSION);
    expect(exported.feedbackAssumption).toBeNull(); expect(exported.result).not.toHaveProperty('margins'); expect(exported.result).not.toHaveProperty('rootLocus');
    expect(exported.result).toMatchObject({ domain: 'discrete', sampleTime: 1, nyquistOmega: Math.PI, stabilityCriterion: 'unit-circle' });
    expect(exported.source.system).toEqual(system); expect(exported.source.sampleTime).toEqual({ period: 1, offset: 0, baseStep: 1 });
    expect(exported.source.semanticHash).toBe(sha256(compileModel(model).semanticKey)); expect(exported.options).toEqual(record.options);
    exported.source.system.A[0][0] = 99; exported.source.assumptions.push('수정'); exported.options.frequencyMax = 99; exported.result.bode[0].real = 99;
    expect(record.source.system.A[0][0]).toBe(.5); expect(record.source.assumptions).not.toContain('수정'); expect(record.options.frequencyMax).toBe(Math.PI); expect(record.result.bode[0].real).not.toBe(99);
  });
  it('exports feedback results only after acceptance and preserves raw discrete root locations', () => {
    const exported = JSON.parse(JSON.stringify(discreteControlReportExport(capture(true))));
    expect(exported.feedbackAssumption).toBe('unity-negative-feedback-open-loop'); expect(exported.result.margins.convention).toBe('unity-negative-feedback-open-loop');
    expect(exported.result.rootLocus.map((point: { poles: { real: number }[] }) => point.poles[0].real)).toEqual([.5, -.5, -1.5]);
    expect(exported.result.stateSpace.domain).toBe('discrete'); expect(exported.result.stateSpace.sampleTime).toBe(1);
  });
  it('renders the independently known first-order IIR response and dimensionless unit-circle meanings', () => {
    const record = capture(), point = record.result.bode[1];
    expect(point.omega).toBeCloseTo(Math.PI / 2, 12); expect(point.real).toBeCloseTo(-.4, 12); expect(point.imag).toBeCloseTo(-.8, 12);
    const html = renderToStaticMarkup(createElement(DiscreteControlAnalysisSummary, { record }));
    expect(html).toContain('이산 Bode 크기'); expect(html).toContain('이산 Bode 위상'); expect(html).toContain('모든 |z| &lt; 1');
    expect(html).toContain('z = exp(jωTs)'); expect(html).toContain('ω는 rad/s'); expect(html).toContain('복소 z 평면 · 무차원');
    expect(html).toContain('class="control-unit-circle"'); expect(html).toContain('단위원 경계는 안정으로 확정하지 않습니다');
    expect(html).toContain('z의 내림차순 계수'); expect(html).not.toContain('복소 s 평면'); expect(html).not.toContain('Infinity'); expect(html).not.toContain('NaN');
    expect(html).not.toContain('이산 단위 음의 피드백 가정의 여유');
  });
  it('shows boundary and outside-circle state poles without relabeling them continuous', () => {
    const boundary = renderToStaticMarkup(createElement(DiscreteControlAnalysisSummary, { record: capture(false, { ...system, A: [[1]] }) }));
    expect(boundary).toContain('단위원 근방 · 수치 확인 필요'); expect(boundary).not.toContain('허수축');
    const outside = renderToStaticMarkup(createElement(DiscreteControlAnalysisSummary, { record: capture(false, { ...system, A: [[1.1]] }) }));
    expect(outside).toContain('불안정 · |z| &gt; 1인 극점');
  });
  it('preserves absence of crossings as an unresolved range and plots sampled root locations', () => {
    const selected = { ...system, B: [[.1]] }, options = { frequencyMin: .01, frequencyMax: 1, frequencyPoints: 3, rootLocusGains: [0, 1, 2] };
    const record = { ...capture(true, selected), options, result: analyzeDiscreteSiso(selected, options) };
    const html = renderToStaticMarkup(createElement(DiscreteControlAnalysisSummary, { record }));
    expect(html).toContain('이 구간에서 확정하지 않음'); expect(html).toContain('무한 여유나 전체 안정성을 의미하지 않습니다');
    expect(html).toContain('1 + K L(z) = 0'); expect(html).toContain('점 사이 경로를 보간하지 않습니다'); expect(html).toContain('이산 제어계 근궤적 원시 표');
    expect(html.match(/class="control-unit-circle"/g)).toHaveLength(2);
  });
  it('distinguishes zero transfer from state poles and undefined logarithmic values', () => {
    const html = renderToStaticMarkup(createElement(DiscreteControlAnalysisSummary, { record: capture(false, { ...system, B: [[0]] }) }));
    expect(html).toContain('전달함수는 0'); expect(html).toContain('표시할 유한한 dB 값이 없습니다'); expect(html).toContain('0 전달함수에서는 정의하지 않음');
    expect(html).not.toContain('Infinity'); expect(html).not.toContain('NaN');
  });
  it('keeps the whole unit circle visible at aspect-preserving scale for small poles', () => {
    const html = renderToStaticMarkup(createElement(ComplexPlane, { poles: [{ real: .01, imag: 0 }], zeros: [], label: '이산 위치', domain: 'discrete' }));
    const match = html.match(/class="control-unit-circle" cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/)!;
    const [cx, cy, radius] = match.slice(1).map(Number);
    expect(radius).toBeGreaterThan(100); expect(cx - radius).toBeGreaterThanOrEqual(20); expect(cx + radius).toBeLessThanOrEqual(460);
    expect(cy - radius).toBeGreaterThanOrEqual(20); expect(cy + radius).toBeLessThanOrEqual(300);
    expect(html).toContain('점선: 단위원 |z| = 1');
    const continuous = renderToStaticMarkup(createElement(ComplexPlane, { poles: [{ real: -1, imag: 0 }], zeros: [], label: '연속 위치' }));
    expect(continuous).toContain('복소 s 평면 · s⁻¹'); expect(continuous).not.toContain('control-unit-circle');
  });
  it('escapes model labels, source assumptions, diagnostics and plane titles through React', () => {
    const raw = '<img src=x onerror=alert(1)>', record = capture(); record.source.modelName = raw; record.source.label = raw; record.source.assumptions.push(raw); record.result.diagnostics.push(raw);
    const html = renderToStaticMarkup(createElement(DiscreteControlAnalysisSummary, { record }));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x'); expect(html).not.toContain('<script');
    const svg = renderToStaticMarkup(createElement(ComplexPlane, { poles: [], zeros: [], label: raw, domain: 'discrete' })); expect(svg).toContain('&lt;img'); expect(svg).not.toContain('<img src=x');
  });
  it('shows an unavailable source for continuous models and blocks analysis for model errors or busy execution', () => {
    const unavailable = renderToStaticMarkup(createElement(DiscreteControlSystemPanel, { model: createExample('continuous-step-response'), busy: false, invalidDraft: false }));
    expect(unavailable).toContain('분석할 이산 행렬이 없습니다'); expect(unavailable).toMatch(/disabled=""[^>]*>이산 제어계 분석 실행/);
    const invalid = renderToStaticMarkup(createElement(DiscreteControlSystemPanel, { model, busy: false, invalidDraft: true }));
    expect(invalid).toContain('편집 중인 모델 입력값'); expect(invalid).toMatch(/disabled=""[^>]*>이산 제어계 분석 실행/);
    const busy = renderToStaticMarkup(createElement(DiscreteControlSystemPanel, { model, busy: true, invalidDraft: false })); expect(busy).toMatch(/disabled=""[^>]*>이산 제어계 분석 실행/);
  });
});
