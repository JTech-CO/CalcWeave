import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeSpectrum } from '../packages/analysis/src/spectrum';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { ENGINE_VERSION, type CalcModel } from '../packages/model/src';
import { sha256 } from '../packages/model/src/sha256';
import type { ControlAnalysisRun } from '../apps/web/src/control-analysis-sources';
import { readSpectrumSelection } from '../apps/web/src/spectrum-analysis-sources';
import { SpectrumAnalysisSummary, SpectrumGraph, SpectrumPanel, spectrumDraftSelection, spectrumReportExport, type CapturedSpectrumReport } from '../apps/web/src/components/SpectrumPanel';

const model: CalcModel = { schemaVersion: 1, modelId: 'spectrum-ui', name: '정확한 8 Hz 사인 기록',
  execution: { mode: 'discrete', startTime: 0, stopTime: 63 / 64, step: 1 / 64 },
  nodes: [{ id: 'wave', blockType: 'source.sine-wave', blockVersion: 1, label: '사인 입력', parameters: { amplitude: 2, frequency: 8, phase: 0, bias: 3 } }, { id: 'result', blockType: 'sink.scope', blockVersion: 1, label: '주파수 기록', parameters: {} }],
  edges: [{ id: 'wave-result', source: { nodeId: 'wave', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }], layout: {},
};
let run: ControlAnalysisRun;
beforeAll(async () => { const compiled = compileModel(model); run = { model: structuredClone(compiled.model), result: await runModel(compiled), semanticHash: sha256(compiled.semanticKey) }; });
const draft = { startIndex: '0', count: '64' };
function capture(): CapturedSpectrumReport {
  const selected = readSpectrumSelection(run, 'result', 0, 0, 64), options = { window: 'rectangular' as const, removeMean: true };
  return { source: selected.source, options, result: analyzeSpectrum(selected.input, options), previousRun: false };
}

describe('M21 recorded-signal spectrum form, discrete graphs and captured reports', () => {
  it('starts from a completed simulation, showing the bounded interval, window and explicit mean option', () => {
    const html = renderToStaticMarkup(createElement(SpectrumPanel, { run, current: true, busy: false, invalidDraft: false }));
    expect(html).toContain('aria-label="스펙트럼 출력"'); expect(html).toContain('aria-label="스펙트럼 성분"');
    expect(html).toContain('aria-label="스펙트럼 시작 표본"'); expect(html).toContain('aria-label="스펙트럼 표본 수"');
    expect(html).toContain('<option value="hann" selected="">Hann</option>'); expect(html).toContain('aria-label="스펙트럼 평균 제거" checked=""');
    expect(html).toContain('value="64"'); expect(html).toContain('기록 64개'); expect(html).toContain('8~8192'); expect(html).toContain('모델과 실행 결과를 변경하지 않습니다');
    expect(html).not.toContain('aria-label="스펙트럼 분석 결과"');
  });
  it('shows a helpful unavailable state for no recording and rejected partial runs', () => {
    const empty = renderToStaticMarkup(createElement(SpectrumPanel, { busy: false, invalidDraft: false }));
    expect(empty).toContain('시간 시뮬레이션을 완료한 뒤'); expect(empty).toMatch(/disabled=""[^>]*>스펙트럼 계산/);
    const partial = renderToStaticMarkup(createElement(SpectrumPanel, { run: { ...run, result: { ...run.result, status: 'cancelled' } }, busy: false, invalidDraft: false }));
    expect(partial).toContain('부분·실패 기록은 분석하지 않습니다'); expect(partial).toMatch(/disabled=""[^>]*>스펙트럼 계산/);
  });
  it('marks an older run and disables a new calculation while the current model draft is invalid or busy', () => {
    const html = renderToStaticMarkup(createElement(SpectrumPanel, { run, current: false, busy: false, invalidDraft: true }));
    expect(html).toContain('이전 실행의 기록입니다'); expect(html).toContain('편집 중인 모델 입력값을 먼저 확인'); expect(html).toMatch(/disabled=""[^>]*>스펙트럼 계산/);
    const busy = renderToStaticMarkup(createElement(SpectrumPanel, { run, current: true, busy: true, invalidDraft: false }));
    expect(busy).toMatch(/disabled=""[^>]*>스펙트럼 계산/);
  });
  it('accepts only an explicit contiguous power-of-two range inside the recording', () => {
    expect(spectrumDraftSelection(draft, 64)).toEqual({ startIndex: 0, count: 64 });
    expect(spectrumDraftSelection({ startIndex: ' 56 ', count: '8' }, 64)).toEqual({ startIndex: 56, count: 8 });
    expect(spectrumDraftSelection({ startIndex: '0', count: '8192' }, 8192)).toEqual({ startIndex: 0, count: 8192 });
  });
  for (const patch of [{ startIndex: '-1' }, { startIndex: '.5' }, { startIndex: '' }, { startIndex: '1.0' }, { startIndex: '0x10' }, { startIndex: 'Infinity' }, { startIndex: '9007199254740992' }, { startIndex: '1', count: '64' }, { count: '' }, { count: '4' }, { count: '16.5' }, { count: '12' }, { count: '16384' }, { count: '8e0' }, { count: '0x40' }, { count: '64x' }, { count: 'alert(1)' }, { count: 'NaN' }, { count: '8'.repeat(101) }]) {
    it(`rejects an invalid range draft ${JSON.stringify(patch)}`, () => { expect(() => spectrumDraftSelection({ ...draft, ...patch }, 64)).toThrow(); });
  }
  it('rejects an invalid available count without inventing a smaller FFT', () => {
    for (const sampleCount of [-1, .5, Infinity, NaN, 7]) expect(() => spectrumDraftSelection({ startIndex: '0', count: '8' }, sampleCount)).toThrow();
  });
  it('exports the exact captured segment, settings and values with independent nested data', () => {
    const record = capture(), exported = spectrumReportExport(record) as { schemaVersion: number; kind: string; engineVersion: string; source: CapturedSpectrumReport['source']; options: CapturedSpectrumReport['options']; result: CapturedSpectrumReport['result'] };
    expect(exported.schemaVersion).toBe(1); expect(exported.kind).toBe('recorded-signal-spectrum'); expect(exported.engineVersion).toBe(ENGINE_VERSION);
    expect(exported.source.semanticHash).toBe(run.semanticHash); expect(exported.source.samplesSha256).toMatch(/^[0-9a-f]{64}$/); expect(exported.source).toMatchObject({ outputId: 'result', componentIndex: 0, startIndex: 0, count: 64, runStatus: 'completed' });
    expect(exported.options).toEqual({ window: 'rectangular', removeMean: true }); expect(exported.result.peak?.frequency).toBeCloseTo(8, 12); expect(exported.result.peak?.amplitude).toBeCloseTo(2, 12);
    expect(exported.result.mean).toBeCloseTo(3, 12); expect(exported.result.rms).toBeCloseTo(Math.sqrt(11), 12);
    exported.source.components[0].label = '수정'; exported.options.removeMean = false; exported.result.bins[8].amplitude = 99;
    expect(record.source.components[0].label).not.toBe('수정'); expect(record.options.removeMean).toBe(true); expect(record.result.bins[8].amplitude).toBeCloseTo(2, 12);
    const json = JSON.parse(JSON.stringify(spectrumReportExport(record))); expect(json.result.bins[0].phaseDegrees).toBeNull(); expect(json.result.bins).toHaveLength(33);
  });
  it('renders observed statistics, captured provenance and discrete rather than smoothed FFT bins', () => {
    const record = capture(), html = renderToStaticMarkup(createElement(SpectrumAnalysisSummary, { record, stale: true }));
    expect(html).toContain('aria-label="스펙트럼 분석 결과"'); expect(html).toContain('이전 실행의 기록'); expect(html).toContain('주파수 간격'); expect(html).toContain('Nyquist 주파수'); expect(html).toContain('선택 구간 RMS');
    expect(html).toContain('8 Hz'); expect(html).toContain('빈 사이의 피크를 추정하지 않습니다'); expect(html).toContain('표본 0~63'); expect(html).toContain(record.source.samplesSha256); expect(html).toContain(run.semanticHash);
    expect(html).toContain('위상은 0 성분에서 정의하지 않으며 —로 표시'); expect(html).toContain('data-bin-count="33"'); expect(html.match(/class="spectrum-bin"/g)).toHaveLength(33);
    expect(html).not.toContain('<path'); expect(html).not.toContain('Infinity'); expect(html).not.toContain('NaN');
  });
  it('renders PSD using the true density and explicit linear Hz axis', () => {
    const record = capture(), html = renderToStaticMarkup(createElement(SpectrumGraph, { bins: record.result.bins, view: 'powerDensity', unit: 'V' }));
    expect(html).toContain('스펙트럼 전력 밀도'); expect(html).toContain('V²/Hz'); expect(html).toContain('선형 Hz 축'); expect(html).toContain('32 Hz'); expect(html).toContain('빈 사이를 보간하지 않습니다');
    expect(html.match(/class="spectrum-bin"/g)).toHaveLength(33);
  });
  it('renders an all-zero signal without declaring a dominant nonDC frequency', () => {
    const record = capture(); record.result = analyzeSpectrum({ times: Array.from({ length: 64 }, (_, index) => index / 64), values: Array(64).fill(0) }, record.options);
    const html = renderToStaticMarkup(createElement(SpectrumAnalysisSummary, { record }));
    expect(html).toContain('유한한 비DC 성분 없음'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
  });
  it('bounds the raw table to 128 rows even for the maximum 4097 frequency bins', () => {
    const record = capture(); record.result = analyzeSpectrum({ times: Array.from({ length: 8192 }, (_, index) => index / 8192), values: Array.from({ length: 8192 }, (_, index) => Math.sin(2 * Math.PI * 32 * index / 8192)) }, record.options);
    const html = renderToStaticMarkup(createElement(SpectrumAnalysisSummary, { record }));
    expect(record.result.bins).toHaveLength(4097); expect(html).toContain('원시 주파수 표 · 4097개'); expect(html).toContain('1 / 33 페이지 · 1~128'); expect(html.match(/<tr>/g)).toHaveLength(129);
  });
  it('escapes model/output/component labels, units and diagnostics as text', () => {
    const raw = '<img src=x onerror=alert(1)>', record = capture(); record.source.modelName = raw; record.source.label = raw; record.source.componentLabel = raw; record.source.unit = raw; record.result.diagnostics.push(raw);
    const html = renderToStaticMarkup(createElement(SpectrumAnalysisSummary, { record }));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x'); expect(html).not.toContain('<script');
  });
});
