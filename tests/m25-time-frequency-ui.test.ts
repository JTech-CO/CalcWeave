import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeTimeFrequency } from '../packages/analysis/src/time-frequency';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { ENGINE_VERSION, type CalcModel } from '../packages/model/src';
import { sha256 } from '../packages/model/src/sha256';
import type { ControlAnalysisRun } from '../apps/web/src/control-analysis-sources';
import { captureTimeFrequencyRequest, timeFrequencyReportExport, timeFrequencyReportStale, timeFrequencyDensityValue, timeFrequencyDisplayBins, timeFrequencyHeatmapCells, TimeFrequencySummary, TimeFrequencyWelchGraph, TimeFrequencyHeatmap, TimeFrequencyPanel, type CapturedTimeFrequencyReport } from '../apps/web/src/components/TimeFrequencyPanel';

const model: CalcModel = { schemaVersion: 1, modelId: 'm25-time-frequency-ui', name: '32개 실수 신호 기록', execution: { mode: 'discrete', startTime: 0, stopTime: 31 / 8, step: 1 / 8 },
  nodes: [{ id: 'wave', blockType: 'source.sine-wave', blockVersion: 1, label: 'DC가 있는 사인', parameters: { amplitude: 2, frequency: 1, phase: 0, bias: 3 } }, { id: 'scope', blockType: 'sink.scope', blockVersion: 1, label: '시간 주파수 기록', parameters: {} }],
  edges: [{ id: 'wave-scope', source: { nodeId: 'wave', portId: 'out' }, target: { nodeId: 'scope', portId: 'in' } }], layout: {} };
let run: ControlAnalysisRun;
beforeAll(async () => { const compiled = compileModel(model); run = { model: structuredClone(compiled.model), result: await runModel(compiled), semanticHash: sha256(compiled.semanticKey) }; });
const draft = { startIndex: '0', count: '31', segmentLength: '8', overlap: '0' };
function capture(previousRun = false): CapturedTimeFrequencyReport { const request = captureTimeFrequencyRequest(run, 'scope', 0, draft, 'rectangular', true, previousRun); return { ...request, result: analyzeTimeFrequency(request.input, request.options) }; }

describe('M25 recorded Welch and STFT presentation', () => {
  it('starts with bounded explicit options, complete-frame policy and no invented report', () => {
    const html = renderToStaticMarkup(createElement(TimeFrequencyPanel, { run, current: true, busy: false, invalidDraft: false }));
    expect(html).toContain('data-testid="time-frequency-panel"'); expect(html).toContain('aria-label="시간 주파수 출력"'); expect(html).toContain('aria-label="시간 주파수 성분"');
    expect(html).toContain('aria-label="시간 주파수 시작 표본"'); expect(html).toContain('aria-label="시간 주파수 표본 수"'); expect(html).toContain('aria-label="시간 주파수 창 길이"'); expect(html).toContain('aria-label="시간 주파수 겹침"');
    expect(html).toContain('8~8192'); expect(html).toContain('완성되지 않은 마지막 프레임은 버립니다'); expect(html).toContain('65536'); expect(html).toContain('8000000'); expect(html).toContain('각 프레임의 평균 제거');
    expect(html).toContain('모델과 원시 실행 기록을 변경하지 않습니다'); expect(html).not.toContain('aria-label="시간·주파수 분석 결과"');
  });
  it('disables missing, partial, static and fewer-than-eight record actions', async () => {
    const empty = renderToStaticMarkup(createElement(TimeFrequencyPanel, { busy: false, invalidDraft: false })); expect(empty).toContain('시간 시뮬레이션을 완료한 뒤'); expect(empty).toMatch(/disabled=""[^>]*>시간·주파수 계산/);
    const partial = renderToStaticMarkup(createElement(TimeFrequencyPanel, { run: { ...run, result: { ...run.result, status: 'cancelled' } }, busy: false, invalidDraft: false })); expect(partial).toContain('부분·실패 기록은 분석하지 않습니다'); expect(partial).toMatch(/disabled=""[^>]*>시간·주파수 계산/);
    const shortModel = structuredClone(model); shortModel.execution.stopTime = 6 / 8; const shortCompiled = compileModel(shortModel), shortRun = { model: shortCompiled.model, result: await runModel(shortCompiled), semanticHash: sha256(shortCompiled.semanticKey) };
    const short = renderToStaticMarkup(createElement(TimeFrequencyPanel, { run: shortRun, busy: false, invalidDraft: false })); expect(short).toContain('value="7"'); expect(short).toMatch(/disabled=""[^>]*>시간·주파수 계산/);
    const staticModel = structuredClone(model); staticModel.execution.mode = 'static'; staticModel.nodes[0] = { ...staticModel.nodes[0], blockType: 'source.constant', parameters: { value: 3 } }; const staticCompiled = compileModel(staticModel), staticRun = { model: staticCompiled.model, result: await runModel(staticCompiled), semanticHash: sha256(staticCompiled.semanticKey) };
    const html = renderToStaticMarkup(createElement(TimeFrequencyPanel, { run: staticRun, busy: false, invalidDraft: false })); expect(html).toContain('완료된 시간 시뮬레이션이 필요합니다'); expect(html).toMatch(/disabled=""[^>]*>시간·주파수 계산/);
  });
  it('disables native settings during execution and warns about previous or invalid model drafts', () => {
    const html = renderToStaticMarkup(createElement(TimeFrequencyPanel, { run, current: false, busy: true, invalidDraft: true })); expect(html).toContain('이전 실행의 기록'); expect(html).toContain('편집 중인 모델 입력값을 먼저 확인');
    expect(html).toMatch(/aria-label="시간 주파수 시작 표본"[^>]*disabled=""/); expect(html).toMatch(/aria-label="시간 주파수 출력"[^>]*disabled=""/); expect(html).toMatch(/disabled=""[^>]*>시간·주파수 계산/);
  });
  it('captures literal non-power-of-two raw samples and settings independently of later edits', () => {
    const copyRun = structuredClone(run), copyDraft = { ...draft }, before = structuredClone(run), request = captureTimeFrequencyRequest(copyRun, 'scope', 0, copyDraft, 'hann', false, true);
    expect(request.input.times).toEqual(run.result.samples.slice(0, 31).map(sample => sample.time)); expect(request.input.values).toEqual(run.result.samples.slice(0, 31).map(sample => sample.values.scope));
    expect(request.source).toMatchObject({ outputId: 'scope', startIndex: 0, count: 31, componentIndex: 0, runStatus: 'completed' }); expect(request.options).toEqual({ segmentLength: 8, overlap: 0, window: 'hann', removeMean: false, tail: 'discard' });
    expect(request.previousRun).toBe(true); expect(request.source.samplesSha256).toBe(sha256(JSON.stringify(request.input, (_key, value: unknown) => typeof value === 'number' && Object.is(value, -0) ? '-0' : value)));
    copyDraft.count = '8'; copyDraft.segmentLength = '16'; copyRun.result.samples[0].values.scope = 99; copyRun.model.name = '수정';
    expect(request.input.values[0]).toBe(3); expect(request.source.modelName).toBe(model.name); expect(request.source.count).toBe(31); expect(request.options.segmentLength).toBe(8); expect(run).toEqual(before);
  });
  it('rejects changed raw model hashes, selected nonfinite components and invalid literal windows', () => {
    expect(() => captureTimeFrequencyRequest({ ...run, semanticHash: 'f'.repeat(64) }, 'scope', 0, draft, 'hann', true)).toThrow();
    const damaged = structuredClone(run); damaged.result.samples[0].values.scope = NaN; expect(() => captureTimeFrequencyRequest(damaged, 'scope', 0, draft, 'hann', true)).toThrow(/비유한/);
    expect(() => captureTimeFrequencyRequest(run, 'scope', 0, draft, 'none' as 'hann', true)).toThrow(); expect(() => captureTimeFrequencyRequest(run, 'scope', 0, draft, 'hann', 'true' as unknown as boolean)).toThrow();
    expect(() => captureTimeFrequencyRequest(run, 'scope', 1, draft, 'hann', true)).toThrow();
  });
  it('exports exact copied inputs, provenance, frame coefficients, powers and all configured settings', () => {
    const record = capture(), exported = timeFrequencyReportExport(record) as CapturedTimeFrequencyReport & { schemaVersion: number; engineVersion: string; kind: string };
    expect(exported.schemaVersion).toBe(1); expect(exported.engineVersion).toBe(ENGINE_VERSION); expect(exported.kind).toBe('recorded-time-frequency'); expect(exported.input).toEqual(record.input); expect(exported.source).toEqual(record.source); expect(exported.options).toEqual(record.options); expect(exported.result).toEqual(record.result);
    const original = structuredClone(record); exported.input.values[0] = 99; exported.source.components[0].label = '수정'; exported.result.frames[0].bins[0].real = 99; exported.options.overlap = 7; expect(record).toEqual(original);
    const json = JSON.parse(JSON.stringify(timeFrequencyReportExport(record))); expect(json.result.frames).toHaveLength(3); expect(json.result.frames[0].bins).toHaveLength(5); expect(json.result.discardedCount).toBe(7); expect(json.result.coefficients).toBe('unnormalized-forward-dft'); expect(json.result.normalization).toBe('one-sided-density');
  });
  it('preserves IEEE zero sign and subnormal values with canonical hash and big-endian Float64 bits', () => {
    const edited = structuredClone(run); edited.result.samples[0].time = -0; edited.result.samples[0].values.scope = -0; edited.result.samples[1].values.scope = 0; edited.result.samples[2].values.scope = Number.MIN_VALUE;
    const request = captureTimeFrequencyRequest(edited, 'scope', 0, draft, 'rectangular', false), record = { ...request, result: analyzeTimeFrequency(request.input, request.options) }, exported = JSON.parse(JSON.stringify(timeFrequencyReportExport(record)));
    expect(exported.samplesHashEncoding).toBe('json-finite-numbers-negative-zero-token-v1'); expect(exported.inputFloat64Bits.times[0]).toBe('8000000000000000'); expect(exported.inputFloat64Bits.values.slice(0, 3)).toEqual(['8000000000000000', '0000000000000000', '0000000000000001']);
    const restored = exported.inputFloat64Bits.values.map((bits: string) => { const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, BigInt(`0x${bits}`), false); return view.getFloat64(0, false); }); expect(restored.every((value: number, index: number) => Object.is(value, request.input.values[index]))).toBe(true);
    expect(request.source.samplesSha256).not.toBe(sha256(JSON.stringify(request.input))); expect(Object.is(exported.input.values[0], -0)).toBe(false);
  });
  it('retains captured previous-run state and detects changed current models without changing old results', () => {
    const record = capture(); expect(timeFrequencyReportStale(record, run, true)).toBe(false); expect(timeFrequencyReportStale(record, run, false)).toBe(true); expect(timeFrequencyReportStale(record, { ...run, semanticHash: 'a'.repeat(64) }, true)).toBe(true); expect(timeFrequencyReportStale(record, null, true)).toBe(true); expect(timeFrequencyReportStale(capture(true), run, true)).toBe(true);
    expect((timeFrequencyReportExport(record, true) as { previousRun: boolean }).previousRun).toBe(true); expect(record.previousRun).toBe(false);
  });
  it('renders known rectangular sine PSD with actual time metadata, immutable meanings and compound units', () => {
    const record = capture(); record.source.unit = 'm/s'; expect(record.result.welchBins[1].powerDensity).toBeCloseTo(2, 12); expect(record.result.integratedPower).toBeCloseTo(2, 12); expect(record.result.frames[0].centerTime).toBe(7 / 16);
    const html = renderToStaticMarkup(createElement(TimeFrequencySummary, { record, stale: true })); expect(html).toContain('이전 실행의 기록'); expect(html).toContain('(m/s)²/Hz'); expect(html).not.toContain('m/s²'); expect(html).toContain('24 / 7'); expect(html).toContain('각 프레임 평균 제거'); expect(html).toContain('비정규화 전방 DFT'); expect(html).toContain('STFT 원시 프레임 · 키보드로 선택');
    expect(html).toContain('aria-label="STFT 프레임"'); expect(html).toContain('중심 0.4375 s'); expect(html).toContain('겹쳐도 독립 표본이나 신뢰구간을 보장하지 않습니다'); expect(html).toContain('원시 RMS²와 창 적용 후 적분 전력은 일반적으로 다릅니다'); expect(html).toContain(record.source.samplesSha256);
    expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity'); expect(html).toContain('aria-label="STFT 선택 프레임 원시 빈"'); expect(html).toContain('aria-label="Welch 원시 PSD"');
  });
  it('keeps bounded Welch display endpoints and the actual peak while preserving all original bins', () => {
    const bins = Array.from({ length: 1025 }, (_, index) => ({ index, frequency: index, powerDensity: index === 777 ? 9 : 1 })), original = structuredClone(bins), display = timeFrequencyDisplayBins(bins, 777);
    expect(display.length).toBeLessThanOrEqual(512); expect(display[0]).toBe(bins[0]); expect(display.at(-1)).toBe(bins.at(-1)); expect(display).toContain(bins[777]); expect(bins).toEqual(original); expect(new Set(display.map(bin => bin.index)).size).toBe(display.length);
    const html = renderToStaticMarkup(createElement(TimeFrequencyWelchGraph, { bins, peakIndex: 777, scale: 'linear', unit: 'V' })); expect(html).toContain('data-bin-count="1025"'); expect(html).toContain('data-display-count="512"'); expect(html).not.toContain('<polyline'); expect(html).not.toContain('<path'); expect(html).toContain('전체 1025개 빈');
  });
  it('samples only actual heatmap cells, includes both endpoints and preserves exact full reports', () => {
    const input = { times: Array.from({ length: 8192 }, (_, index) => index / 8192), values: Array.from({ length: 8192 }, (_, index) => Math.sin(2 * Math.PI * 32 * index / 8192)) }, result = analyzeTimeFrequency(input, { segmentLength: 2048, overlap: 1024, window: 'hann', removeMean: true, tail: 'discard' }), before = structuredClone(result), cells = timeFrequencyHeatmapCells(result);
    expect(result.totalBins).toBeGreaterThan(4096); expect(cells.length).toBeLessThanOrEqual(4096); expect(cells[0]).toMatchObject({ frameIndex: 0, binIndex: 0, centerTime: result.frames[0].centerTime }); expect(cells.at(-1)).toMatchObject({ frameIndex: result.frameCount - 1, binIndex: result.binsPerFrame - 1 });
    for (const cell of cells) { const frame = result.frames[cell.frameIndex], bin = frame.bins[cell.binIndex]; expect(cell.centerTime).toBe(frame.centerTime); expect(cell.frequency).toBe(bin.frequency); expect(cell.powerDensity).toBe(bin.powerDensity); }
    expect(result).toEqual(before); const html = renderToStaticMarkup(createElement(TimeFrequencyHeatmap, { report: result, scale: 'linear', unit: 'V' })); expect(html).toContain(`data-raw-cell-count="${result.totalBins}"`); expect(html).toContain(`data-display-count="${cells.length}"`); expect(html).toContain('빠진 셀은 빈 공간'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
  });
  it('shows every cell when fewer than 4096 exist, including all 128 short frames', () => {
    const input = { times: Array.from({ length: 1024 }, (_, index) => index / 1024), values: Array(1024).fill(1) }, report = analyzeTimeFrequency(input, { segmentLength: 8, overlap: 0, window: 'rectangular', removeMean: false, tail: 'discard' }); expect(report.frameCount).toBe(128); expect(timeFrequencyHeatmapCells(report)).toHaveLength(640);
  });
  it('displays true zero PSD separately from finite dB without adding epsilon or altering raw power', () => {
    expect(timeFrequencyDensityValue(0, 'db')).toBeNull(); expect(timeFrequencyDensityValue(-0, 'db')).toBeNull(); expect(timeFrequencyDensityValue(0, 'linear')).toBe(0); expect(timeFrequencyDensityValue(1, 'db')).toBe(0); expect(timeFrequencyDensityValue(100, 'db')).toBe(20); expect(timeFrequencyDensityValue(Number.MIN_VALUE, 'db')).toBe(10 * Math.log10(Number.MIN_VALUE));
    const result = analyzeTimeFrequency({ times: Array.from({ length: 8 }, (_, index) => index / 8), values: Array(8).fill(0) }, { segmentLength: 8, overlap: 0, window: 'rectangular', removeMean: true, tail: 'discard' }), before = structuredClone(result);
    const heatmap = renderToStaticMarkup(createElement(TimeFrequencyHeatmap, { report: result, scale: 'db', unit: 'V' })), welch = renderToStaticMarkup(createElement(TimeFrequencyWelchGraph, { bins: result.welchBins, scale: 'db', unit: 'V' }));
    expect(heatmap.match(/class="time-frequency-cell time-frequency-zero-cell"/g)).toHaveLength(5); expect(welch.match(/class="time-frequency-zero-point"/g)).toHaveLength(5); expect(heatmap).toContain('정의된 양수 PSD 로그값 없음'); expect(heatmap).toContain('프레임은 1개이며 시간 변화로 해석하지 마세요'); expect(heatmap).toContain('PSD 0'); expect(heatmap).not.toContain('Infinity'); expect(heatmap).not.toContain('NaN'); expect(result).toEqual(before);
  });
  it('escapes recorded text, whole compound units and core diagnostics with React text rendering', () => {
    const raw = '<img src=x onerror=alert(1)>', record = capture(); record.source.label = raw; record.source.modelName = raw; record.source.componentLabel = raw; record.source.unit = raw; record.result.diagnostics.push(raw); const html = renderToStaticMarkup(createElement(TimeFrequencySummary, { record })); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x'); expect(html).not.toContain('<script');
  });
});
