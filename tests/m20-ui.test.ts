import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeContinuousSiso, type ControlStateSpace } from '../packages/analysis/src/control-system';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import type { CalcModel } from '../packages/model/src';
import { sha256 } from '../packages/model/src/sha256';
import { controlAnalysisSources, type ControlAnalysisSource } from '../apps/web/src/control-analysis-sources';
import { AnalysisDialog } from '../apps/web/src/components/AnalysisDialog';
import { BodeGraph, ComplexPlane, ControlAnalysisSummary, ControlSystemPanel, controlDraftOptions, controlReportExport } from '../apps/web/src/components/ControlSystemPanel';
import { createM12Examples } from '../apps/web/src/m12-examples';

const system: ControlStateSpace = { A: [[-1]], B: [[1]], C: [[1]], D: [[0]] };
const model: CalcModel = { schemaVersion: 1, modelId: 'control-ui', name: '1차 저역 통과',
  execution: { mode: 'continuous', startTime: 0, stopTime: 1, step: .1 },
  nodes: [{ id: 'input', blockType: 'source.constant', blockVersion: 1, label: '입력', parameters: { value: 0 } }, { id: 'plant', blockType: 'continuous.state-space', blockVersion: 1, label: '1차 시스템', parameters: { A: [[-1]], B: [1], C: [1], D: 0, initial: [0] } }, { id: 'result', blockType: 'sink.scope', blockVersion: 1, label: '출력', parameters: {} }],
  edges: [{ id: 'input-plant', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'plant', portId: 'in' } }, { id: 'plant-result', source: { nodeId: 'plant', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }], layout: {},
};
const draft = { minimum: '.01', maximum: '100', points: '201', gainMaximum: '10', gainPoints: '41' };
const options = controlDraftOptions(draft, false);
const source = (): ControlAnalysisSource => controlAnalysisSources(model).sources[0];
describe('M20 readable control analysis UI and explicit feedback assumptions', () => {
  it('keeps both existing analysis modes and adds a closed advanced section', () => {
    const html = renderToStaticMarkup(createElement(AnalysisDialog, { model, busy: false, invalidDraft: false, onClose: () => {} }));
    expect(html).toContain('수식 기울기'); expect(html).toContain('모델 해상도');
    expect(html).toContain('<details class="control-analysis-section"><summary>제어계 분석</summary>');
    expect(html).not.toContain('class="control-analysis-section" open');
  });
  it('starts with Bode and poles only, leaving the feedback assumption unchecked', () => {
    const html = renderToStaticMarkup(createElement(ControlSystemPanel, { model, busy: false, invalidDraft: false }));
    expect(html).toContain('aria-label="단위 음의 피드백 가정"');
    expect(html).not.toContain('checked=""'); expect(html).not.toContain('aria-label="근궤적 K 최댓값"');
    expect(html).toContain('1~4개'); expect(html).toContain('모델과 실행 결과를 변경하지 않습니다');
  });
  it('constructs bounded logarithmic-frequency and explicit linear-gain requests', () => {
    expect(controlDraftOptions(draft, false)).toEqual({ frequencyMin: .01, frequencyMax: 100, frequencyPoints: 201, rootLocusGains: [] });
    expect(controlDraftOptions({ ...draft, gainMaximum: '12', gainPoints: '4' }, true).rootLocusGains).toEqual([0, 4, 8, 12]);
  });
  for (const patch of [{ minimum: '0' }, { minimum: '1e-7' }, { maximum: '1e7' }, { maximum: '.001' }, { points: '1' }, { points: '802' }, { points: '2.5' }, { minimum: '0x10' }, { maximum: 'Infinity' }, { maximum: 'alert(1)' }]) it(`rejects invalid frequency form ${JSON.stringify(patch)}`, () => { expect(() => controlDraftOptions({ ...draft, ...patch }, false)).toThrow(); });
  for (const patch of [{ gainMaximum: '0' }, { gainMaximum: '-1' }, { gainMaximum: '1e7' }, { gainPoints: '1' }, { gainPoints: '82' }, { gainPoints: 'NaN' }]) it(`rejects invalid gain form ${JSON.stringify(patch)}`, () => { expect(() => controlDraftOptions({ ...draft, ...patch }, true)).toThrow(); });
  it('accepts exact resource boundaries and ignores hidden gain drafts until opted in', () => {
    expect(controlDraftOptions({ minimum: '1e-6', maximum: '1e6', points: '801', gainMaximum: '1e6', gainPoints: '81' }, true).rootLocusGains).toHaveLength(81);
    expect(controlDraftOptions({ ...draft, gainMaximum: 'invalid' }, false).rootLocusGains).toEqual([]);
  });
  it('exports immutable matrices and exact analysis options without unaccepted feedback results', () => {
    const captured = { source: source(), options, feedbackAssumptionAccepted: false, result: analyzeContinuousSiso(system, options) };
    const exported = JSON.parse(JSON.stringify(controlReportExport(captured)));
    expect(exported.feedbackAssumption).toBeNull(); expect(exported.result).not.toHaveProperty('margins'); expect(exported.result).not.toHaveProperty('rootLocus');
    expect(exported.source.system).toEqual({ ...system, domain: 'continuous' }); expect(exported.options).toEqual(options);
    expect(exported.source.semanticHash).toBe(sha256(compileModel(model).semanticKey));
    expect(exported.result.bode).toHaveLength(201);
  });
  it('renders real first-order graph values and preserves empty finite-zero and missing-margin meanings', () => {
    const result = analyzeContinuousSiso(system, { frequencyMin: .1, frequencyMax: 10, frequencyPoints: 3, rootLocusGains: [0, 1, 2] });
    expect(result.bode[1].omega).toBeCloseTo(1, 12); expect(result.bode[1].gainDb).toBeCloseTo(-3.010299956639812, 10); expect(result.bode[1].phaseDegrees).toBeCloseTo(-45, 10);
    const html = renderToStaticMarkup(createElement(ControlAnalysisSummary, { record: { source: source(), options, feedbackAssumptionAccepted: true, result } }));
    expect(html).toContain('Bode 크기'); expect(html).toContain('Bode 위상'); expect(html).toContain('유한 영점 없음');
    expect(html).toContain('이 구간에서 확정하지 않음'); expect(html).toContain('무한 여유나 전체 안정성을 의미하지 않습니다');
    expect(html).toContain('근궤적 원시 표'); expect(html).toContain('점 사이 경로를 보간하지 않습니다');
    expect(html).not.toContain('Infinity'); expect(html).not.toContain('NaN');
  });
  it('includes the feedback convention and full exact root-gain report only on explicit acceptance', () => {
    const chosen = controlDraftOptions({ ...draft, gainPoints: '3' }, true), result = analyzeContinuousSiso(system, chosen);
    const exported = JSON.parse(JSON.stringify(controlReportExport({ source: source(), options: chosen, feedbackAssumptionAccepted: true, result })));
    expect(exported.feedbackAssumption).toBe('unity-negative-feedback-open-loop'); expect(exported.result.margins.convention).toBe('unity-negative-feedback-open-loop'); expect(exported.result.rootLocus.map((point: { gain: number }) => point.gain)).toEqual([0, 5, 10]);
  });
  it('plots null gaps without joining across a singular frequency', () => {
    const html = renderToStaticMarkup(createElement(BodeGraph, { label: '간격', unit: 'dB', points: [{ x: .1, y: 0 }, { x: 1, y: null }, { x: 10, y: -20 }] }));
    const path = html.match(/class="control-plot-curve" d="([^"]*)"/)![1];
    expect(path.match(/M/g)).toHaveLength(2); expect(path).not.toContain('L'); expect(html).not.toContain('NaN');
    expect(html.match(/class="control-plot-point"/g)).toHaveLength(2);
  });
  it('describes an all-zero transfer without inventing a logarithmic response', () => {
    const result = analyzeContinuousSiso({ ...system, B: [[0]] }, options);
    const html = renderToStaticMarkup(createElement(ControlAnalysisSummary, { record: { source: source(), options, feedbackAssumptionAccepted: false, result } }));
    expect(html).toContain('전달함수는 0'); expect(html).toContain('표시할 유한한 dB 값이 없습니다'); expect(html).toContain('0 전달함수에서는 정의하지 않음'); expect(html).not.toContain('단위 음의 피드백 가정의 여유');
  });
  it('escapes model labels, diagnostics and SVG captions as text', () => {
    const raw = '<img src=x onerror=alert(1)>', selected = { ...source(), modelName: raw, label: raw }, result = analyzeContinuousSiso(system, options);
    result.diagnostics.push(raw);
    const html = renderToStaticMarkup(createElement(ControlAnalysisSummary, { record: { source: selected, options, feedbackAssumptionAccepted: false, result } }));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x');
    const svg = renderToStaticMarkup(createElement(ComplexPlane, { poles: result.poles, zeros: [], label: raw }));
    expect(svg).toContain('&lt;img'); expect(svg).not.toContain('<img src=x');
  });
  it('reports no source for a static model and disables model analysis for invalid drafts', () => {
    const html = renderToStaticMarkup(createElement(ControlSystemPanel, { model: { ...model, execution: { ...model.execution, mode: 'static' } }, busy: false, invalidDraft: false }));
    expect(html).toContain('분석할 행렬이 없습니다'); expect(html).toMatch(/disabled=""[^>]*>제어계 분석 실행/);
    const invalid = renderToStaticMarkup(createElement(ControlSystemPanel, { model, busy: false, invalidDraft: true }));
    expect(invalid).toContain('편집 중인 모델 입력값'); expect(invalid).toMatch(/disabled=""[^>]*>제어계 분석 실행/);
  });
  it('connects an actually executed M12 request and preserves request time versus recorded time', async () => {
    const capturedModel = createM12Examples().find(example => example.id === 'local-linearization-requests')!.model, compiled = compileModel(capturedModel), result = await runModel(compiled);
    const run = { model: compiled.model, result, semanticHash: sha256(compiled.semanticKey) };
    const candidate = controlAnalysisSources(model, run).sources.find(source => source.kind === 'recorded-linearization')!;
    expect(candidate.requestTime).toBeDefined(); expect(candidate.time).toBe(1);
    const report = analyzeContinuousSiso(candidate.system, options);
    expect(report.poles[0].real).toBeCloseTo(-2, 8);
    const html = renderToStaticMarkup(createElement(ControlSystemPanel, { model: { ...model, execution: { ...model.execution, mode: 'static' } }, linearizationRun: run, linearizationCurrent: false, busy: false, invalidDraft: false }));
    expect(html).toContain('이전 실행의 선형화'); expect(html).toContain('기록 1 s'); expect(html).toContain('선형화 요청');
    const exported = JSON.parse(JSON.stringify(controlReportExport({ source: candidate, options, feedbackAssumptionAccepted: false, result: report })));
    expect(exported.source.semanticHash).toBe(run.semanticHash); expect(exported.source.requestTime).toBe(candidate.requestTime); expect(exported.source.system).toEqual(candidate.system);
  });
});
