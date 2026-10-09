import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeSignalCorrelation, analyzeTimeStatistics } from '../packages/analysis/src/time-series-statistics';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { ENGINE_VERSION, type CalcModel } from '../packages/model/src';
import { sha256 } from '../packages/model/src/sha256';
import type { ControlAnalysisRun } from '../apps/web/src/control-analysis-sources';
import { defaultTimeSeriesDraft } from '../apps/web/src/time-series-analysis-sources';
import { captureTimeSeriesRequest, CorrelationGraph, correlationDisplayRows, TimeSeriesAnalysisSummary, TimeSeriesStatisticsPanel, timeSeriesReportExport, timeSeriesReportStale, type CapturedTimeSeriesReport } from '../apps/web/src/components/TimeSeriesStatisticsPanel';

const model: CalcModel = { schemaVersion: 1, modelId: 'time-statistics-ui', name: '통계와 상관의 8개 실수 기록',
  execution: { mode: 'discrete', startTime: 0, stopTime: 7, step: 1 },
  nodes: [{ id: 'wave', blockType: 'source.sine-wave', blockVersion: 1, label: '사인 입력', parameters: { amplitude: 2, frequency: 1 / 8, phase: 0, bias: 3 } }, { id: 'gain', blockType: 'math.gain', blockVersion: 1, label: '2배', parameters: { gain: 2 } }, { id: 'x', blockType: 'sink.scope', blockVersion: 1, label: 'X 기록', parameters: {} }, { id: 'y', blockType: 'sink.scope', blockVersion: 1, label: 'Y 기록', parameters: {} }],
  edges: [{ id: 'wave-x', source: { nodeId: 'wave', portId: 'out' }, target: { nodeId: 'x', portId: 'in' } }, { id: 'wave-gain', source: { nodeId: 'wave', portId: 'out' }, target: { nodeId: 'gain', portId: 'in' } }, { id: 'gain-y', source: { nodeId: 'gain', portId: 'out' }, target: { nodeId: 'y', portId: 'in' } }], layout: {} };
let run: ControlAnalysisRun;
beforeAll(async () => { const compiled = compileModel(model); run = { model: structuredClone(compiled.model), result: await runModel(compiled), semanticHash: sha256(compiled.semanticKey) }; });
const draft = { startIndex: '0', count: '8', maxLag: '7', minOverlap: '2' };
function capture(mode: 'statistics' | 'correlation' = 'statistics', previousRun = false): CapturedTimeSeriesReport {
  const request = captureTimeSeriesRequest(run, mode, 'x', 0, 'y', 0, draft, true, previousRun);
  return request.kind === 'statistics' ? { ...request, result: analyzeTimeStatistics(request.input) } : { ...request, result: analyzeSignalCorrelation(request.input, request.options) };
}

describe('M24 captured time statistics and lag correlation presentation', () => {
  it('starts with explicit bounded selection and equal-sample meanings, without inventing a report', () => {
    const html = renderToStaticMarkup(createElement(TimeSeriesStatisticsPanel, { run, current: true, busy: false, invalidDraft: false }));
    expect(html).toContain('data-testid="time-series-statistics-panel"'); expect(html).toContain('aria-label="통계 X 출력"'); expect(html).toContain('aria-label="통계 X 성분"');
    expect(html).toContain('aria-label="통계 시작 표본"'); expect(html).toContain('aria-label="통계 표본 수"'); expect(html).toContain('value="8"');
    expect(html).toContain('2~8192'); expect(html).toContain('시간 가중 평균이나 시간 적분으로 해석하지 마세요'); expect(html).toContain('모집단 분산은 N, 표본 분산은 N−1');
    expect(html).toContain('모델과 실행 결과를 변경하지 않습니다'); expect(html).toContain('aria-pressed="true">구간 통계'); expect(html).not.toContain('aria-label="시계열 분석 결과"');
    expect(html).not.toContain('aria-label="상관 최대 지연"'); expect(html).not.toContain('aria-label="상관 평균 제거"');
  });
  it('rejects missing, static and partial recordings with a disabled action', () => {
    const empty = renderToStaticMarkup(createElement(TimeSeriesStatisticsPanel, { busy: false, invalidDraft: false }));
    expect(empty).toContain('시간 시뮬레이션을 완료한 뒤'); expect(empty).toMatch(/disabled=""[^>]*>구간 통계 계산/);
    const partial = renderToStaticMarkup(createElement(TimeSeriesStatisticsPanel, { run: { ...run, result: { ...run.result, status: 'cancelled' } }, busy: false, invalidDraft: false }));
    expect(partial).toContain('부분·실패 기록은 분석하지 않습니다'); expect(partial).toMatch(/disabled=""[^>]*>구간 통계 계산/);
    const staticModel = structuredClone(run.model); staticModel.execution.mode = 'static'; staticModel.nodes[0] = { ...staticModel.nodes[0], blockType: 'source.constant', parameters: { value: 3 } };
    const compiled = compileModel(staticModel), staticRun = { ...run, model: compiled.model, semanticHash: sha256(compiled.semanticKey) };
    const rejected = renderToStaticMarkup(createElement(TimeSeriesStatisticsPanel, { run: staticRun, busy: false, invalidDraft: false }));
    expect(rejected).toContain('완료된 시간 시뮬레이션이 필요합니다'); expect(rejected).toMatch(/disabled=""[^>]*>구간 통계 계산/);
  });
  it('disables native fields and actions while busy, and explicitly identifies an older run', () => {
    const html = renderToStaticMarkup(createElement(TimeSeriesStatisticsPanel, { run, current: false, busy: true, invalidDraft: true }));
    expect(html).toContain('이전 실행의 기록'); expect(html).toContain('편집 중인 모델 입력값을 먼저 확인'); expect(html).toMatch(/disabled=""[^>]*>구간 통계 계산/);
    expect(html).toMatch(/aria-label="통계 시작 표본"[^>]*disabled=""/); expect(html).toMatch(/aria-label="통계 X 출력"[^>]*disabled=""/);
  });
  it('takes a detached full raw selection, preserving model, run and settings after later edits', () => {
    const before = JSON.stringify(run), mutableDraft = { ...draft }, request = captureTimeSeriesRequest(run, 'correlation', 'x', 0, 'y', 0, mutableDraft, true);
    expect(request.kind).toBe('correlation'); if (request.kind !== 'correlation') throw new Error('correlation expected');
    expect(request.input.times).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); expect(request.input.x).toEqual(run.result.samples.map(sample => sample.values.x));
    expect(request.input.y).toEqual(run.result.samples.map(sample => sample.values.y)); expect(request.options).toEqual({ maxLag: 7, minOverlap: 2, removeMean: true });
    mutableDraft.startIndex = '3'; mutableDraft.maxLag = '0';
    const copiedRun = structuredClone(run); copiedRun.result.samples[0].values.x = 99; copiedRun.model.name = '다른 모델';
    expect(request.input.x[0]).toBe(3); expect(request.xSource.modelName).toBe(model.name); expect(request.xSource.startIndex).toBe(0); expect(request.options.maxLag).toBe(7);
    expect(JSON.stringify(run)).toBe(before); expect(request.xSource.samplesSha256).toMatch(/^[0-9a-f]{64}$/); expect(request.ySource.samplesSha256).not.toBe(request.xSource.samplesSha256);
  });
  it('accepts non-power-of-two windows and does not make hidden correlation drafts block statistics', () => {
    const request = captureTimeSeriesRequest(run, 'statistics', 'x', 0, '', 0, { startIndex: '2', count: '3', maxLag: 'invalid', minOverlap: '-1' }, false);
    expect(request.kind).toBe('statistics'); if (request.kind !== 'statistics') throw new Error('statistics expected');
    expect(request.source.startIndex).toBe(2); expect(request.source.count).toBe(3); expect(request.input.times).toEqual([2, 3, 4]); expect(request.options).toEqual({ weighting: 'equal-samples' });
  });
  for (const patch of [{ startIndex: '-1' }, { startIndex: '1.5' }, { startIndex: '0x1' }, { startIndex: '' }, { count: '1' }, { count: '9' }, { count: '8193' }, { count: '3e0' }, { count: 'NaN' }, { count: '1'.repeat(101) }, { maxLag: '8' }, { maxLag: '-1' }, { maxLag: '513' }, { minOverlap: '1' }, { minOverlap: '9' }, { minOverlap: '2.5' }]) {
    it(`rejects invalid explicit correlation settings ${JSON.stringify(patch)}`, () => { expect(() => captureTimeSeriesRequest(run, 'correlation', 'x', 0, 'y', 0, { ...draft, ...patch }, true)).toThrow(); });
  }
  it('retains literal selected settings for centered and raw cosine correlation', () => {
    const request = captureTimeSeriesRequest(run, 'correlation', 'x', 0, 'y', 0, { startIndex: '1', count: '5', maxLag: '2', minOverlap: '4' }, false);
    if (request.kind !== 'correlation') throw new Error('correlation expected');
    const report = analyzeSignalCorrelation(request.input, request.options);
    expect(report.demeaning).toBe('none'); expect(report.rows.filter(row => row.reason === 'insufficient-overlap').map(row => row.lag)).toEqual([-2, 2]);
    expect(request.xSource.startIndex).toBe(1); expect(request.options.removeMean).toBe(false);
  });
  it('exports exact raw samples, settings, previous-run status and independent nested data', () => {
    const record = capture('correlation', true), exported = timeSeriesReportExport(record) as Record<string, unknown> & { input: { times: number[]; x: number[]; y: number[] }; xSource: { components: { label: string }[] }; options: { maxLag: number }; result: { rows: { coefficient: number | null }[] } };
    expect(exported.schemaVersion).toBe(1); expect(exported.engineVersion).toBe(ENGINE_VERSION); expect(exported.kind).toBe('recorded-signal-correlation'); expect(exported.previousRun).toBe(true);
    expect(exported.input).toEqual(record.input); expect(exported.options).toEqual(record.options); expect(exported.result).toEqual(record.result);
    exported.input.x[0] = 99; exported.input.times[0] = 88; exported.xSource.components[0].label = '변경'; exported.options.maxLag = 0; exported.result.rows[0].coefficient = 1;
    if (record.kind !== 'correlation') throw new Error('correlation expected');
    expect(record.input.x[0]).toBe(3); expect(record.input.times[0]).toBe(0); expect(record.xSource.components[0].label).not.toBe('변경'); expect(record.options.maxLag).toBe(7); expect(record.result.rows[0].coefficient).toBeNull();
    const json = JSON.parse(JSON.stringify(timeSeriesReportExport(record))); expect(json.result.rows[0].reason).toBe('insufficient-overlap'); expect(json.result.rows).toHaveLength(15);
  });
  it('exports statistics using its actual sample weighting and reports stale current hashes', () => {
    const record = capture(), exported = timeSeriesReportExport(record) as { kind: string; input: unknown; options: unknown; result: unknown; previousRun: boolean };
    expect(exported.kind).toBe('recorded-time-series-statistics'); expect(exported.options).toEqual({ weighting: 'equal-samples' }); expect(exported.input).toEqual(record.input); expect(exported.previousRun).toBe(false);
    expect(timeSeriesReportStale(record, run, true)).toBe(false); expect(timeSeriesReportStale(record, run, false)).toBe(true); expect(timeSeriesReportStale(record, { ...run, semanticHash: 'f'.repeat(64) }, true)).toBe(true); expect(timeSeriesReportStale(record, null, true)).toBe(true);
    expect((timeSeriesReportExport(record, true) as { previousRun: boolean }).previousRun).toBe(true);
  });
  it('preserves exact Float64 input bits through JSON, including distinct negative and positive zero', () => {
    const record = capture(); if (record.kind !== 'statistics') throw new Error('statistics expected');
    record.input = { times: [-0, 1, 2], values: [-0, 0, Number.MIN_VALUE] }; record.result = analyzeTimeStatistics(record.input);
    const exported = JSON.parse(JSON.stringify(timeSeriesReportExport(record))) as { samplesHashEncoding: string; input: { times: number[]; values: number[] }; inputFloat64Bits: { times: string[]; values: string[] } };
    expect(exported.samplesHashEncoding).toBe('json-finite-numbers-negative-zero-token-v1'); expect(exported.inputFloat64Bits.values).toEqual(['8000000000000000', '0000000000000000', '0000000000000001']);
    expect(exported.inputFloat64Bits.times[0]).toBe('8000000000000000'); expect(exported.inputFloat64Bits.times).toHaveLength(3);
    const restored = exported.inputFloat64Bits.values.map(bits => { expect(bits).toMatch(/^[0-9a-f]{16}$/); const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, BigInt(`0x${bits}`), false); return view.getFloat64(0, false); });
    expect(Object.is(exported.input.values[0], -0)).toBe(false); expect(restored.every((value, index) => Object.is(value, record.input.values[index]))).toBe(true);
    const pair = capture('correlation'); if (pair.kind !== 'correlation') throw new Error('correlation expected');
    pair.input.x[0] = -0; pair.input.y[0] = 0;
    const pairJSON = JSON.parse(JSON.stringify(timeSeriesReportExport(pair))); expect(pairJSON.inputFloat64Bits.x[0]).toBe('8000000000000000'); expect(pairJSON.inputFloat64Bits.y[0]).toBe('0000000000000000'); expect(pairJSON.inputFloat64Bits.x).toHaveLength(pair.input.x.length);
  });
  it('renders independently known statistics with both variance denominators and squared units', () => {
    const record = capture(); if (record.kind !== 'statistics') throw new Error('statistics expected');
    expect(record.result.mean).toBeCloseTo(3, 12); expect(record.result.variancePopulation).toBeCloseTo(2, 12); expect(record.result.varianceSample).toBeCloseTo(16 / 7, 12); expect(record.result.rms).toBeCloseTo(Math.sqrt(11), 12);
    record.source.unit = 'V'; const html = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record, stale: true }));
    expect(html).toContain('이전 실행의 기록'); expect(html).toContain('분모 N = 8'); expect(html).toContain('분모 N−1 = 7'); expect(html).toContain('(V)²'); expect(html).toContain('표본 0~7'); expect(html).toContain(record.source.samplesSha256); expect(html).toContain(run.semanticHash);
    expect(html).toContain('동일 표본 가중치'); expect(html).toContain('N−1 분모가 독립 표본이나 추론의 적합성을 보장하지 않습니다'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
  });
  it('squares the complete compound unit in statistics and correlation without changing source units', () => {
    const statistics = capture(); if (statistics.kind !== 'statistics') throw new Error('statistics expected');
    statistics.source.unit = 'm/s';
    const statisticsHtml = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record: statistics }));
    expect(statisticsHtml).toContain('(m/s)²'); expect(statisticsHtml).not.toContain('m/s²'); expect(statistics.source.unit).toBe('m/s');
    const pair = capture('correlation'); if (pair.kind !== 'correlation') throw new Error('correlation expected');
    pair.xSource.unit = 'm/s'; pair.ySource.unit = 'm/s';
    const correlationHtml = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record: pair }));
    expect(correlationHtml).toContain('(m/s)²'); expect(correlationHtml).not.toContain('m/s²');
    expect((timeSeriesReportExport(pair) as { xSource: { unit: string } }).xSource.unit).toBe('m/s');
  });
  it('renders real overlap ranges and normalization, never calls a correlation candidate a delay determination', () => {
    const record = capture('correlation'); if (record.kind !== 'correlation') throw new Error('correlation expected');
    expect(record.result.peak?.lag).toBe(0); expect(record.result.peak?.coefficient).toBeCloseTo(1, 12); expect(record.result.rows[0].coefficient).toBeNull();
    const html = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record }));
    expect(html).toContain('양의 지연 k는 X[i]와 Y[i+k]'); expect(html).toContain('각 겹침 구간에서 별도로 계산'); expect(html).toContain('인과관계나 지연의 확정값이 아닙니다'); expect(html).toContain('겹침 부족');
    expect(html).toContain('X 인덱스'); expect(html).toContain('Y 인덱스'); expect(html).toContain('X 시각 · s'); expect(html).toContain('Y 시각 · s'); expect(html).toContain('실제 겹침'); expect(html).toContain('분모'); expect(html).toContain('스케일 X 에너지'); expect(html).toContain('전체 15개 값');
    expect(html.match(/class="time-series-point"/g)).toHaveLength(13); expect(html).not.toContain('<path');
  });
  it('shows zero-energy correlation as undefined, with no graph dots and no invented peak', () => {
    const record = capture('correlation'); if (record.kind !== 'correlation') throw new Error('correlation expected');
    record.input = { times: [0, 1, 2, 3], x: [5, 5, 5, 5], y: [8, 8, 8, 8] }; record.options = { maxLag: 2, minOverlap: 2, removeMean: true }; record.result = analyzeSignalCorrelation(record.input, record.options);
    const html = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record }));
    expect(html).toContain('정의된 후보 없음'); expect(html).toContain('영 에너지'); expect(html).not.toContain('class="time-series-point"'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
  });
  it('keeps tiny nonzero correlation normalized with its actual scaled denominator', () => {
    const record = capture('correlation'); if (record.kind !== 'correlation') throw new Error('correlation expected');
    record.input = { times: [0, 1, 2], x: [1e-200, 2e-200, 3e-200], y: [2e-200, 4e-200, 6e-200] }; record.options = { maxLag: 0, minOverlap: 2, removeMean: true }; record.result = analyzeSignalCorrelation(record.input, record.options);
    expect(record.result.rows[0].denominator).toBe(0); expect(record.result.rows[0].scaledDenominator).toBeGreaterThan(0); expect(record.result.rows[0].coefficient).toBeCloseTo(1, 12); expect(record.result.rows[0].reason).toBeNull();
    const html = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record })); expect(html).toContain('스케일 분모'); expect(html).toContain('상관계수와 영 에너지 판정');
  });
  it('bounds displayed graph points and table rows while preserving every original lag for export', () => {
    const record = capture('correlation'); if (record.kind !== 'correlation') throw new Error('correlation expected');
    record.input = { times: Array.from({ length: 600 }, (_, index) => index), x: Array.from({ length: 600 }, (_, index) => Math.sin(index / 20)), y: Array.from({ length: 600 }, (_, index) => 2 * Math.sin(index / 20)) }; record.options = { maxLag: 512, minOverlap: 2, removeMean: true }; record.result = analyzeSignalCorrelation(record.input, record.options);
    const before = JSON.stringify(record.result.rows), display = correlationDisplayRows(record.result.rows), graph = renderToStaticMarkup(createElement(CorrelationGraph, { rows: record.result.rows })), html = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record }));
    expect(record.result.rows).toHaveLength(1025); expect(display).toHaveLength(512); expect(display[0].lag).toBe(-512); expect(display.at(-1)?.lag).toBe(512); expect(display.some(row => row.lag === 0)).toBe(true); expect(correlationDisplayRows(record.result.rows, 237).some(row => row.lag === 237)).toBe(true); expect(JSON.stringify(record.result.rows)).toBe(before);
    expect(graph).toContain('data-row-count="1025"'); expect(graph).toContain('data-display-count="512"'); expect(graph.match(/class="time-series-point"/g)).toHaveLength(512); expect(graph).not.toContain('<path');
    expect(html).toContain('1 / 9 페이지 · 1~128'); expect(html.match(/<tr>/g)).toHaveLength(129); expect((timeSeriesReportExport(record) as { result: { rows: unknown[] } }).result.rows).toHaveLength(1025);
  });
  it('escapes source text, component labels, units and diagnostics with React text rendering', () => {
    const raw = '<img src=x onerror=alert(1)>', record = capture(); if (record.kind !== 'statistics') throw new Error('statistics expected');
    record.source.modelName = raw; record.source.label = raw; record.source.componentLabel = raw; record.source.unit = raw; record.result.diagnostics.push(raw);
    const html = renderToStaticMarkup(createElement(TimeSeriesAnalysisSummary, { record })); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x'); expect(html).not.toContain('<script');
  });
  it('chooses bounded explicit defaults for short and large recordings', () => {
    expect(defaultTimeSeriesDraft(2)).toMatchObject({ startIndex: '0', count: '2', maxLag: '1', minOverlap: '2' }); expect(Number(defaultTimeSeriesDraft(10000).count)).toBeLessThanOrEqual(8192); expect(Number(defaultTimeSeriesDraft(10000).maxLag)).toBeLessThanOrEqual(512);
  });
});
