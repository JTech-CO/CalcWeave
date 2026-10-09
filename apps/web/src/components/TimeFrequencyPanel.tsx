import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINE_VERSION, ModelError } from '../../../../packages/model/src';
import type { SpectrumInput } from '../../../../packages/analysis/src/spectrum';
import type { TimeFrequencyOptions, TimeFrequencyReport } from '../../../../packages/analysis/src/time-frequency';
import type { ControlAnalysisRun } from '../control-analysis-sources';
import { readTimeSeriesSelection, timeSeriesAnalysisSources, type TimeSeriesSourceSnapshot } from '../time-series-analysis-sources';
import { defaultTimeFrequencyDraft, timeFrequencyDraftSelection, type TimeFrequencyDraft } from '../time-frequency-settings';
import { formatNumber } from './ResultPlot';
import './TimeFrequencyPanel.css';

export interface TimeFrequencyPanelProps { run?: ControlAnalysisRun | null; current?: boolean; busy: boolean; invalidDraft: boolean }
export interface CapturedTimeFrequencyRequest { source: TimeSeriesSourceSnapshot; input: SpectrumInput; options: TimeFrequencyOptions; previousRun: boolean }
export interface CapturedTimeFrequencyReport extends CapturedTimeFrequencyRequest { result: TimeFrequencyReport }
export type TimeFrequencyScale = 'linear' | 'db';
const PAGE_SIZE = 128, DISPLAY_BINS = 512, DISPLAY_CELLS = 4096;

/** Capture the immutable run selection and literal options before asynchronous loading. */
export function captureTimeFrequencyRequest(run: ControlAnalysisRun, outputId: string, componentIndex: number, draft: TimeFrequencyDraft, window: TimeFrequencyOptions['window'], removeMean: boolean, previousRun = false): CapturedTimeFrequencyRequest {
  const source = timeSeriesAnalysisSources(run).sources.find(item => item.outputId === outputId);
  if (!source) throw new Error('분석 가능한 완료 출력 기록을 선택하세요.');
  const selected = timeFrequencyDraftSelection(draft, source.sampleCount);
  if (!['hann', 'rectangular'].includes(window) || typeof removeMean !== 'boolean') throw new Error('창 종류와 평균 제거 설정을 확인하세요.');
  return structuredClone({ ...readTimeSeriesSelection(run, outputId, componentIndex, selected.startIndex, selected.count), options: { segmentLength: selected.segmentLength, overlap: selected.overlap, window, removeMean, tail: 'discard' }, previousRun });
}
export function timeFrequencyReportStale(record: CapturedTimeFrequencyReport, run?: ControlAnalysisRun | null, current?: boolean): boolean { return record.previousRun || current === false || record.source.semanticHash !== run?.semanticHash; }
function float64Bits(values: number[]): string[] { const view = new DataView(new ArrayBuffer(8)); return values.map(value => { view.setFloat64(0, value, false); return view.getBigUint64(0, false).toString(16).padStart(16, '0'); }); }
export function timeFrequencyReportExport(record: CapturedTimeFrequencyReport, stale = false): object {
  return structuredClone({ schemaVersion: 1, engineVersion: ENGINE_VERSION, ...record, kind: 'recorded-time-frequency', previousRun: record.previousRun || stale, samplesHashEncoding: 'json-finite-numbers-negative-zero-token-v1', inputFloat64Bits: { times: float64Bits(record.input.times), values: float64Bits(record.input.values) } });
}
function downloadReport(record: CapturedTimeFrequencyReport, stale: boolean) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(timeFrequencyReportExport(record, stale), null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-time-frequency-analysis.json'; anchor.click(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function failure(error: unknown): string { return error instanceof ModelError ? error.diagnostics.map(item => item.message).join(' · ') : error instanceof Error ? error.message : '완료 기록과 선택 구간을 확인해 주세요.'; }

export function TimeFrequencyPanel({ run, current, busy, invalidDraft }: TimeFrequencyPanelProps) {
  const available = useMemo(() => timeSeriesAnalysisSources(run), [run]);
  const [sourceId, setSourceId] = useState(''), [componentIndex, setComponentIndex] = useState(0), [draft, setDraft] = useState(() => defaultTimeFrequencyDraft(available.sources[0]?.sampleCount ?? 0));
  const [window, setWindow] = useState<TimeFrequencyOptions['window']>('hann'), [removeMean, setRemoveMean] = useState(true), [record, setRecord] = useState<CapturedTimeFrequencyReport | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), generation = useRef(0), source = available.sources.find(item => item.id === sourceId) ?? available.sources[0], component = source?.components.find(item => item.index === componentIndex) ?? source?.components[0];
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { setDraft(defaultTimeFrequencyDraft(source?.sampleCount ?? 0)); setComponentIndex(source?.components[0]?.index ?? 0); setError(''); }, [source?.id, source?.sampleCount]);
  const disabled = pending || busy;
  const calculate = async () => {
    if (!run || !source || !component || disabled || invalidDraft) return;
    const requestId = ++generation.current; setPending(true); setError('');
    try {
      // Malformed form edits retain their report; a valid request clears it before source or budget failure.
      timeFrequencyDraftSelection(draft, source.sampleCount);
      setRecord(null);
      const captured = captureTimeFrequencyRequest(run, source.outputId, component.index, draft, window, removeMean, current === false);
      const api = await import('../../../../packages/analysis/src/time-frequency');
      if (!alive.current || generation.current !== requestId) return;
      const result = api.analyzeTimeFrequency(captured.input, captured.options);
      if (alive.current && generation.current === requestId) setRecord({ ...captured, result });
    } catch (caught) { if (alive.current && generation.current === requestId) setError(failure(caught)); }
    finally { if (alive.current && generation.current === requestId) setPending(false); }
  };
  const stale = record ? timeFrequencyReportStale(record, run, current) : false;
  return <div className="time-frequency-panel" data-testid="time-frequency-panel">
    <p className="field-help">완료된 시간 기록의 8~8192개 실수 표본에서 Welch 평균 PSD와 STFT를 계산합니다. 모델과 원시 실행 기록을 변경하지 않습니다.</p>
    {source ? <><label className="field"><span className="field-label">출력 기록</span><select aria-label="시간 주파수 출력" value={source.id} disabled={disabled} onChange={event => setSourceId(event.target.value)}>{available.sources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="field"><span className="field-label">실수 성분</span><select aria-label="시간 주파수 성분" value={component?.index ?? 0} disabled={disabled} onChange={event => setComponentIndex(Number(event.target.value))}>{source.components.map(item => <option key={item.index} value={item.index}>{item.label}</option>)}</select></label><div className="time-frequency-source"><p>{source.modelName} · {source.label} · 기록 {source.sampleCount}개</p><p>{current === false ? '이전 실행의 기록입니다.' : '완료된 시간 시뮬레이션의 기록입니다.'}</p></div></> : <p className="time-frequency-source">시간 시뮬레이션을 완료한 뒤 분석할 출력 기록을 선택하세요. 정적 계산과 부분 실행은 출처로 사용하지 않습니다.</p>}
    {available.issues.map((issue, index) => <p className="time-frequency-diagnostic" key={index}>{issue}</p>)}
    <div className="time-frequency-fields"><IntegerField label="시작 표본 · 0부터" aria="시간 주파수 시작 표본" value={draft.startIndex} disabled={disabled} onChange={value => setDraft(now => ({ ...now, startIndex: value }))}/><IntegerField label="표본 수 · 8~8192" aria="시간 주파수 표본 수" value={draft.count} disabled={disabled} onChange={value => setDraft(now => ({ ...now, count: value }))}/><IntegerField label="창 길이 · 8~2048, 2의 거듭제곱" aria="시간 주파수 창 길이" value={draft.segmentLength} disabled={disabled} onChange={value => setDraft(now => ({ ...now, segmentLength: value }))}/><IntegerField label="겹침 · 0 이상, 창 길이 미만" aria="시간 주파수 겹침" value={draft.overlap} disabled={disabled} onChange={value => setDraft(now => ({ ...now, overlap: value }))}/></div>
    <label className="field"><span className="field-label">창 종류</span><select aria-label="시간 주파수 창" value={window} disabled={disabled} onChange={event => setWindow(event.target.value as TimeFrequencyOptions['window'])}><option value="hann">주기형 Hann</option><option value="rectangular">직사각형</option></select></label>
    <label className="time-frequency-checkbox"><input type="checkbox" aria-label="시간 주파수 평균 제거" checked={removeMean} disabled={disabled} onChange={event => setRemoveMean(event.target.checked)}/><span>각 프레임의 평균 제거</span></label>
    <p className="field-help">hop = 창 길이 − 겹침. 완성되지 않은 마지막 프레임은 버립니다. 0 채우기·보간·자동 재표본화는 하지 않습니다. 프레임 최대 128개, 전체 빈 최대 65536개, 계산 예산 8000000 단위를 적용합니다.</p>
    {invalidDraft && <p className="dialog-error">편집 중인 모델 입력값을 먼저 확인하세요.</p>}
    <div className="dialog-actions"><button className="button primary" disabled={disabled || invalidDraft || !source || !component || source.sampleCount < 8} onClick={() => void calculate()}>{pending ? '시간·주파수 분석 중' : '시간·주파수 계산'}</button>{record && <button className="button" disabled={disabled} onClick={() => downloadReport(record, stale)}>시간·주파수 JSON</button>}</div>
    {pending && <p role="status">복사한 원시 기록을 프레임별로 분석하고 있습니다.</p>}{error && <p className="dialog-error" role="alert">{error}</p>}
    {record && <TimeFrequencySummary record={record} stale={stale}/>}
  </div>;
}
function IntegerField({ label, aria, value, disabled, onChange }: { label: string; aria: string; value: string; disabled: boolean; onChange: (value: string) => void }) { return <label className="field"><span className="field-label">{label}</span><input type="text" inputMode="numeric" aria-label={aria} maxLength={100} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/></label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function psdUnit(unit: string): string { return `(${unit || '출력 단위'})²/Hz`; }
function PageButtons({ name, page, pages, length, shown, setPage }: { name: string; page: number; pages: number; length: number; shown: number; setPage: (page: number) => void }) { return <div className="time-frequency-pagination"><button className="button" aria-label={`${name} 표 이전 페이지`} disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button><span role="status">{page + 1} / {pages} 페이지 · {page * PAGE_SIZE + 1}~{page * PAGE_SIZE + shown} / {length}개</span><button className="button" aria-label={`${name} 표 다음 페이지`} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>다음</button></div>; }

export function TimeFrequencySummary({ record, stale = false }: { record: CapturedTimeFrequencyReport; stale?: boolean }) {
  const report = record.result, source = record.source, unit = source.unit || '출력 단위';
  const [scale, setScale] = useState<TimeFrequencyScale>('linear'), [frameIndex, setFrameIndex] = useState(0), [welchPage, setWelchPage] = useState(0), [framePage, setFramePage] = useState(0);
  useEffect(() => { setScale('linear'); setFrameIndex(0); setWelchPage(0); setFramePage(0); }, [record]);
  const selectedFrame = report.frames[Math.min(frameIndex, report.frames.length - 1)]!, welchPages = Math.ceil(report.welchBins.length / PAGE_SIZE), safeWelchPage = Math.min(welchPage, welchPages - 1), welchRows = report.welchBins.slice(safeWelchPage * PAGE_SIZE, (safeWelchPage + 1) * PAGE_SIZE);
  const framePages = Math.ceil(selectedFrame.bins.length / PAGE_SIZE), safeFramePage = Math.min(framePage, framePages - 1), frameRows = selectedFrame.bins.slice(safeFramePage * PAGE_SIZE, (safeFramePage + 1) * PAGE_SIZE);
  return <section className="time-frequency-result" aria-label="시간·주파수 분석 결과"><h3>Welch 평균 PSD · STFT · {source.label} · {source.componentLabel}</h3><p className="time-frequency-source">{stale || record.previousRun ? '이전 실행의 기록입니다.' : '완료된 시간 시뮬레이션의 기록입니다.'} {source.modelName}</p><p className="field-help">선택 구간: 표본 {source.startIndex}~{source.startIndex + source.count - 1} · {String(report.startTime)}~{String(report.endTime)} s. {report.window === 'hann' ? '주기형 Hann' : '직사각형'} · 각 프레임 평균 {report.removeMean ? '제거' : '유지'} · 완성되지 않은 꼬리 버림.</p>
    <dl className="time-frequency-metrics"><Metric label="프레임 / 빈 수" value={`${report.frameCount}개 / 프레임당 ${report.binsPerFrame}개 · 전체 ${report.totalBins}개`}/><Metric label="창 길이 / 겹침 / hop" value={`${report.segmentLength} / ${report.overlap} / ${report.hop} 표본`}/><Metric label="사용 / 버린 표본 수" value={`${report.usedCount} / ${report.discardedCount}`}/><Metric label="사용 마지막 시각" value={`${String(report.usedEndTime)} s`}/><Metric label="버린 구간 시작 시각" value={report.discardedStartTime === null ? '없음' : `${String(report.discardedStartTime)} s`}/><Metric label="표본 간격 / 표본율" value={`${String(report.sampleInterval)} s / ${String(report.sampleRate)} Hz`}/><Metric label="주파수 간격 / Nyquist" value={`${String(report.frequencyResolution)} / ${String(report.nyquist)} Hz`}/><Metric label="Welch 적분 전력" value={`${String(report.integratedPower)} (${unit})²`}/><Metric label="DC 제외 최대 PSD 후보" value={report.welchPeak ? `${String(report.welchPeak.frequency)} Hz · ${String(report.welchPeak.powerDensity)} ${psdUnit(unit)}` : '정의된 후보 없음'}/><Metric label="창 coherent / power gain" value={`${String(report.windowCoherentGain)} / ${String(report.windowPowerGain)}`}/></dl>
    <p className="field-help">Welch는 모든 완성 프레임의 단측 periodogram PSD를 산술 평균합니다. PSD 분모는 표본율 × 창 제곱합이며 DC와 Nyquist는 두 배 하지 않습니다. 프레임이 겹쳐도 독립 표본이나 신뢰구간을 보장하지 않습니다.</p>
    <div className="time-frequency-mode" role="group" aria-label="PSD 표시 척도"><button className="button" aria-pressed={scale === 'linear'} onClick={() => setScale('linear')}>선형 PSD</button><button className="button" aria-pressed={scale === 'db'} onClick={() => setScale('db')}>dB PSD</button></div>
    <p className="field-help">{scale === 'linear' ? `선형 PSD · ${psdUnit(unit)}.` : `10 log₁₀(PSD / 1 ${psdUnit(unit)}) · dB re 1 ${psdUnit(unit)}. 정확히 0인 PSD의 dB는 정의되지 않아 별도 표시합니다. 작은 양수를 더하거나 바닥값으로 바꾸지 않습니다.`} 표시 척도는 원시 표와 JSON을 변경하지 않습니다.</p>
    <TimeFrequencyWelchGraph bins={report.welchBins} peakIndex={report.welchPeak?.index} scale={scale} unit={unit}/><TimeFrequencyHeatmap report={report} scale={scale} unit={unit}/>
    {report.diagnostics.map((message, index) => <p className="time-frequency-diagnostic" key={index}>{message}</p>)}
    <details className="time-frequency-details"><summary>Welch 원시 PSD 표 · {report.welchBins.length}개</summary><PageButtons name="Welch" page={safeWelchPage} pages={welchPages} length={report.welchBins.length} shown={welchRows.length} setPage={setWelchPage}/><div className="time-frequency-table-scroll"><table aria-label="Welch 원시 PSD"><thead><tr><th>빈</th><th>주파수 · Hz</th><th>평균 PSD · {psdUnit(unit)}</th></tr></thead><tbody>{welchRows.map(bin => <tr key={bin.index}><td>{bin.index}</td><td>{String(bin.frequency)}</td><td>{String(bin.powerDensity)}</td></tr>)}</tbody></table></div></details>
    <label className="field"><span className="field-label">STFT 원시 프레임 · 키보드로 선택</span><select aria-label="STFT 프레임" value={selectedFrame.index} onChange={event => { setFrameIndex(Number(event.target.value)); setFramePage(0); }}>{report.frames.map(frame => <option value={frame.index} key={frame.index}>{frame.index + 1} / {report.frameCount} · 중심 {String(frame.centerTime)} s</option>)}</select></label>
    <p className="time-frequency-source">선택 프레임 {selectedFrame.index + 1}: 원래 기록 표본 {source.startIndex + selectedFrame.startIndex}~{source.startIndex + selectedFrame.endIndex} · {String(selectedFrame.startTime)}~{String(selectedFrame.endTime)} s · 중심 {String(selectedFrame.centerTime)} s</p><dl className="time-frequency-metrics"><Metric label="프레임 원시 평균 / RMS" value={`${String(selectedFrame.mean)} / ${String(selectedFrame.rms)} ${unit}`}/><Metric label="프레임 적분 전력" value={`${String(selectedFrame.integratedPower)} (${unit})²`}/></dl>
    <details className="time-frequency-details"><summary>STFT 선택 프레임 원시 빈 · {selectedFrame.bins.length}개</summary><p className="field-help">복소 계수는 평균 제거 후 창을 적용한 비정규화 전방 DFT입니다. 진폭은 coherent gain으로 보정하며 PSD 평균과는 다른 양입니다. 프레임 중심은 첫·마지막 실제 표본 시각의 중간값입니다.</p><PageButtons name="STFT" page={safeFramePage} pages={framePages} length={selectedFrame.bins.length} shown={frameRows.length} setPage={setFramePage}/><div className="time-frequency-table-scroll"><table aria-label="STFT 선택 프레임 원시 빈"><thead><tr><th>빈</th><th>주파수 · Hz</th><th>실수 계수 · {unit}</th><th>허수 계수 · {unit}</th><th>단측 진폭 · {unit}</th><th>PSD · {psdUnit(unit)}</th><th>위상 · °</th></tr></thead><tbody>{frameRows.map(bin => <tr key={bin.index}><td>{bin.index}</td><td>{String(bin.frequency)}</td><td>{String(bin.real)}</td><td>{String(bin.imag)}</td><td>{String(bin.amplitude)}</td><td>{String(bin.powerDensity)}</td><td>{bin.phaseDegrees === null ? '—' : String(bin.phaseDegrees)}</td></tr>)}</tbody></table></div></details>
    <details className="time-frequency-details"><summary>기록 출처와 원시 입력</summary><dl className="time-frequency-provenance"><Metric label="모델 ID" value={source.modelId}/><Metric label="출력 ID / 실행 상태" value={`${source.outputId} / ${source.runStatus}`}/><Metric label="모델 의미 해시 · SHA-256" value={source.semanticHash}/><Metric label="선택 표본 해시 · SHA-256" value={source.samplesSha256}/><Metric label="선택 원시 평균 / RMS" value={`${String(report.mean)} / ${String(report.rms)} ${unit}`}/><Metric label="계산 예산 단위 / 상한" value={`${report.work} / 8000000`}/></dl><p className="field-help">JSON은 계산할 때 복사한 원시 시각·값과 정확한 Float64 비트, 출처, 설정, 모든 프레임의 복소 계수·PSD와 Welch 평균을 보존합니다. 폼과 표시 척도 편집은 이 보고서의 입력과 설정을 바꾸지 않습니다. 원시 RMS²와 창 적용 후 적분 전력은 일반적으로 다릅니다.</p></details>
  </section>;
}

/** Zero has no logarithmic display value; no epsilon or arbitrary floor is inserted. */
export function timeFrequencyDensityValue(power: number, scale: TimeFrequencyScale): number | null { return scale === 'db' ? power === 0 ? null : 10 * Math.log10(power) : power; }
function sampleIndices(length: number, maximum: number, preferred: number[] = []): number[] {
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  const indices = new Set([0, length - 1, ...preferred.filter(index => Number.isInteger(index) && index >= 0 && index < length)]);
  for (let index = 0; index < maximum && indices.size < maximum; index++) indices.add(Math.round(index * (length - 1) / (maximum - 1)));
  return [...indices].sort((a, b) => a - b);
}
export function timeFrequencyDisplayBins<T extends { index: number }>(bins: T[], peakIndex?: number): T[] { return sampleIndices(bins.length, DISPLAY_BINS, peakIndex === undefined ? [] : [bins.findIndex(bin => bin.index === peakIndex)]).map(index => bins[index]!); }
export interface TimeFrequencyDisplayCell { frameIndex: number; binIndex: number; centerTime: number; frequency: number; powerDensity: number }
/** Display sampling selects actual cells and leaves omitted cells empty; it never averages values. */
export function timeFrequencyHeatmapCells(report: TimeFrequencyReport): TimeFrequencyDisplayCell[] {
  const frames = sampleIndices(report.frames.length, 128), bins = sampleIndices(report.binsPerFrame, Math.floor(DISPLAY_CELLS / frames.length), report.welchPeak ? [report.welchPeak.index] : []);
  return frames.flatMap(frameIndex => bins.map(binIndex => { const frame = report.frames[frameIndex]!, bin = frame.bins[binIndex]!; return { frameIndex: frame.index, binIndex: bin.index, centerTime: frame.centerTime, frequency: bin.frequency, powerDensity: bin.powerDensity }; }));
}
function densityExtent(values: number[], scale: TimeFrequencyScale, zeroBaseline = false): { min: number; max: number; zeroCount: number; definedCount: number } {
  let min = Infinity, max = -Infinity, zeroCount = 0, definedCount = 0;
  for (const value of values) { if (value === 0) zeroCount++; const shown = timeFrequencyDensityValue(value, scale); if (shown !== null) { min = Math.min(min, shown); max = Math.max(max, shown); definedCount++; } }
  return { min: min === Infinity ? 0 : scale === 'linear' && zeroBaseline ? 0 : min, max: max === -Infinity ? 0 : max, zeroCount, definedCount };
}
function displayedDensity(power: number, scale: TimeFrequencyScale, unit: string): string { const shown = timeFrequencyDensityValue(power, scale); return shown === null ? `PSD 0 ${psdUnit(unit)} · dB 정의되지 않음` : `${String(shown)} ${scale === 'linear' ? psdUnit(unit) : `dB re 1 ${psdUnit(unit)}`}`; }
export function TimeFrequencyWelchGraph({ bins, peakIndex, scale, unit }: { bins: TimeFrequencyReport['welchBins']; peakIndex?: number; scale: TimeFrequencyScale; unit: string }) {
  const display = timeFrequencyDisplayBins(bins, peakIndex), extent = densityExtent(bins.map(bin => bin.powerDensity), scale, true), lastFrequency = bins.at(-1)?.frequency ?? 0;
  const x = (frequency: number) => lastFrequency === 0 ? 320 : 18 + frequency / lastFrequency * 604, y = (value: number) => extent.max === extent.min ? 119 : 220 - (value - extent.min) / (extent.max - extent.min) * 202;
  return <figure className="time-frequency-plot"><figcaption>Welch 평균 PSD · {scale === 'linear' ? psdUnit(unit) : `dB re 1 ${psdUnit(unit)}`}</figcaption><div className="time-frequency-axis-labels">{extent.definedCount ? <><span>세로 최대 {String(extent.max)}</span><span>세로 최소 {String(extent.min)}</span></> : <span>정의된 양수 PSD 로그값 없음</span>}</div><svg viewBox="0 0 640 240" role="img" aria-label="Welch 평균 PSD 그래프" data-bin-count={bins.length} data-display-count={display.length}><title>Welch 평균 PSD, 실제 주파수 빈의 점 표시</title>{[18, 119, 220].map(position => <line className="time-frequency-grid" key={position} x1={18} x2={622} y1={position} y2={position}/>)}{display.map(bin => { const shown = timeFrequencyDensityValue(bin.powerDensity, scale); return <circle className={shown === null ? 'time-frequency-zero-point' : 'time-frequency-point'} key={bin.index} cx={x(bin.frequency)} cy={shown === null ? 232 : y(shown)} r={2.5}><title>빈 {bin.index} · {String(bin.frequency)} Hz · {displayedDensity(bin.powerDensity, scale, unit)}</title></circle>; })}</svg><div className="time-frequency-axis-labels"><span>0 Hz</span><span>{formatNumber(lastFrequency)} Hz</span></div><p className="field-help">최대 512개 실제 빈을 표시하며 DC·Nyquist·피크를 보존합니다. 점 사이를 보간하지 않습니다. 전체 {bins.length}개 빈은 원시 표와 JSON에 유지합니다.{scale === 'db' && ` 회색 아래쪽 점은 PSD 0이며 로그값이 없습니다. 원시 0 빈 ${extent.zeroCount}개.`}</p></figure>;
}
export function TimeFrequencyHeatmap({ report, scale, unit }: { report: TimeFrequencyReport; scale: TimeFrequencyScale; unit: string }) {
  const cells = timeFrequencyHeatmapCells(report), extent = densityExtent(report.frames.flatMap(frame => frame.bins.map(bin => bin.powerDensity)), scale), halfHop = report.hop * report.sampleInterval / 2, firstTime = report.frames[0]!.centerTime - halfHop, lastTime = report.frames.at(-1)!.centerTime + halfHop;
  const x = (time: number) => 18 + (time - firstTime) / (lastTime - firstTime) * 604, y = (frequency: number) => 220 - frequency / report.nyquist * 202;
  return <figure className="time-frequency-plot"><figcaption>STFT · 실제 프레임 중심 시각과 주파수 · {scale === 'linear' ? psdUnit(unit) : `dB re 1 ${psdUnit(unit)}`}</figcaption><div className="time-frequency-axis-labels"><span>주파수 {formatNumber(report.nyquist)} Hz</span>{extent.definedCount ? <span>색상 최소 {String(extent.min)} / 최대 {String(extent.max)}</span> : <span>정의된 양수 PSD 로그값 없음</span>}</div><svg className="time-frequency-heatmap" viewBox="0 0 640 240" role="img" aria-label="STFT 시간·주파수 히트맵" data-raw-cell-count={report.totalBins} data-display-count={cells.length}><title>STFT 프레임별 실제 PSD 빈, 최대 4096개 셀</title>{cells.map(cell => { const shown = timeFrequencyDensityValue(cell.powerDensity, scale), ratio = shown === null ? null : extent.max === extent.min ? 0.5 : (shown - extent.min) / (extent.max - extent.min), bottom = Math.max(0, cell.frequency - report.frequencyResolution / 2), top = Math.min(report.nyquist, cell.frequency + report.frequencyResolution / 2); return <rect className={shown === null ? 'time-frequency-cell time-frequency-zero-cell' : 'time-frequency-cell'} data-frame-index={cell.frameIndex} data-bin-index={cell.binIndex} data-power-density={cell.powerDensity} key={`${cell.frameIndex}:${cell.binIndex}`} x={x(cell.centerTime - halfHop)} y={y(top)} width={Math.max(0, x(cell.centerTime + halfHop) - x(cell.centerTime - halfHop))} height={Math.max(0, y(bottom) - y(top))} fill={ratio === null ? undefined : `hsl(${220 - ratio * 200} 72% ${35 + ratio * 20}%)`}><title>프레임 {cell.frameIndex + 1} · 중심 {String(cell.centerTime)} s · 빈 {cell.binIndex} · {String(cell.frequency)} Hz · {displayedDensity(cell.powerDensity, scale, unit)}</title></rect>; })}</svg><div className="time-frequency-axis-labels"><span>0 Hz · {formatNumber(firstTime)} s</span><span>{formatNumber(lastTime)} s</span></div><p className="field-help">최대 4096개 실제 셀만 선택해 표시합니다. 빠진 셀은 빈 공간으로 두며 평균·보간으로 채우지 않습니다. 가로 폭은 hop 시간, 세로 폭은 주파수 간격입니다. 시간 축은 실제 중심 시각의 양쪽 반 hop까지입니다. {report.frameCount === 1 && '프레임은 1개이며 시간 변화로 해석하지 마세요. '}{scale === 'db' && `회색 셀은 PSD 0 · dB 정의되지 않음이며 원시 0 셀은 ${extent.zeroCount}개입니다. `}전체 {report.totalBins}개 빈은 JSON과 프레임 선택 표에 보존합니다.</p></figure>;
}
