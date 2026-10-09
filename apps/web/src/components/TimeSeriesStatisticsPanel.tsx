import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINE_VERSION, ModelError } from '../../../../packages/model/src';
import type { CorrelationInput, CorrelationOptions, CorrelationReport, CorrelationRow, TimeSeriesInput, TimeStatisticsReport } from '../../../../packages/analysis/src/time-series-statistics';
import type { ControlAnalysisRun } from '../control-analysis-sources';
import { defaultTimeSeriesDraft, readCorrelationSelection, readTimeSeriesSelection, timeSeriesAnalysisSources, timeSeriesDraftSelection, type TimeSeriesAnalysisSource, type TimeSeriesDraft, type TimeSeriesSourceSnapshot } from '../time-series-analysis-sources';
import { formatNumber } from './ResultPlot';
import './TimeSeriesStatisticsPanel.css';

export interface TimeSeriesStatisticsPanelProps { run?: ControlAnalysisRun | null; current?: boolean; busy: boolean; invalidDraft: boolean }
type Mode = 'statistics' | 'correlation';
type StatisticsRequest = { kind: 'statistics'; source: TimeSeriesSourceSnapshot; input: TimeSeriesInput; options: { weighting: 'equal-samples' }; previousRun: boolean };
type CorrelationRequest = { kind: 'correlation'; xSource: TimeSeriesSourceSnapshot; ySource: TimeSeriesSourceSnapshot; input: CorrelationInput; options: CorrelationOptions; previousRun: boolean };
export type CapturedTimeSeriesRequest = StatisticsRequest | CorrelationRequest;
export type CapturedTimeSeriesReport = StatisticsRequest & { result: TimeStatisticsReport } | CorrelationRequest & { result: CorrelationReport };
const PAGE_SIZE = 128, DISPLAY_POINTS = 512;

/** Take all input and provenance copies before the asynchronous core import. */
export function captureTimeSeriesRequest(run: ControlAnalysisRun, mode: Mode, xOutputId: string, xComponent: number, yOutputId: string, yComponent: number, draft: TimeSeriesDraft, removeMean: boolean, previousRun = false): CapturedTimeSeriesRequest {
  const source = timeSeriesAnalysisSources(run).sources.find(item => item.outputId === xOutputId);
  if (!source) throw new Error('분석 가능한 완료 출력 기록을 선택하세요.');
  const selection = timeSeriesDraftSelection(mode === 'statistics' ? { ...draft, maxLag: '0', minOverlap: '2' } : draft, source.sampleCount);
  if (mode === 'statistics') return structuredClone({ kind: 'statistics', ...readTimeSeriesSelection(run, xOutputId, xComponent, selection.startIndex, selection.count), options: { weighting: 'equal-samples' }, previousRun });
  return structuredClone({ kind: 'correlation', ...readCorrelationSelection(run, xOutputId, xComponent, yOutputId, yComponent, selection.startIndex, selection.count), options: { maxLag: selection.maxLag, minOverlap: selection.minOverlap, removeMean }, previousRun });
}
export function timeSeriesReportStale(record: CapturedTimeSeriesReport, run?: ControlAnalysisRun | null, current?: boolean): boolean {
  return record.previousRun || current === false || (record.kind === 'statistics' ? record.source.semanticHash : record.xSource.semanticHash) !== run?.semanticHash;
}
function float64Bits(values: number[]): string[] {
  const view = new DataView(new ArrayBuffer(8));
  return values.map(value => { view.setFloat64(0, value, false); return view.getBigUint64(0, false).toString(16).padStart(16, '0'); });
}
export function timeSeriesReportExport(record: CapturedTimeSeriesReport, stale = false): object {
  const inputFloat64Bits = record.kind === 'statistics' ? { times: float64Bits(record.input.times), values: float64Bits(record.input.values) } : { times: float64Bits(record.input.times), x: float64Bits(record.input.x), y: float64Bits(record.input.y) };
  return structuredClone({ schemaVersion: 1, engineVersion: ENGINE_VERSION, ...record, kind: record.kind === 'statistics' ? 'recorded-time-series-statistics' : 'recorded-signal-correlation', previousRun: record.previousRun || stale, samplesHashEncoding: 'json-finite-numbers-negative-zero-token-v1', inputFloat64Bits });
}
function downloadReport(record: CapturedTimeSeriesReport, stale: boolean) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(timeSeriesReportExport(record, stale), null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-time-series-analysis.json'; anchor.click(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function failure(error: unknown): string { return error instanceof ModelError ? error.diagnostics.map(item => item.message).join(' · ') : error instanceof Error ? error.message : '출력 기록과 선택 구간을 확인해 주세요.'; }

export function TimeSeriesStatisticsPanel({ run, current, busy, invalidDraft }: TimeSeriesStatisticsPanelProps) {
  const available = useMemo(() => timeSeriesAnalysisSources(run), [run]);
  const [mode, setMode] = useState<Mode>('statistics'), [xId, setXId] = useState(''), [yId, setYId] = useState('');
  const [xIndex, setXIndex] = useState(0), [yIndex, setYIndex] = useState(0), [draft, setDraft] = useState(() => defaultTimeSeriesDraft(available.sources[0]?.sampleCount ?? 0));
  const [removeMean, setRemoveMean] = useState(true), [record, setRecord] = useState<CapturedTimeSeriesReport | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const xSource = available.sources.find(item => item.id === xId) ?? available.sources[0], ySource = available.sources.find(item => item.id === yId) ?? available.sources[0];
  const xComponent = xSource?.components.find(item => item.index === xIndex) ?? xSource?.components[0], yComponent = ySource?.components.find(item => item.index === yIndex) ?? ySource?.components[0];
  useEffect(() => { setDraft(defaultTimeSeriesDraft(xSource?.sampleCount ?? 0)); setXIndex(xSource?.components[0]?.index ?? 0); setError(''); }, [xSource?.id, xSource?.sampleCount]);
  useEffect(() => { setYIndex(ySource?.components[0]?.index ?? 0); setError(''); }, [ySource?.id]);
  const disabled = pending || busy;
  const calculate = async () => {
    if (!run || !xSource || !xComponent || mode === 'correlation' && (!ySource || !yComponent) || disabled || invalidDraft) return;
    const request = ++generation.current;
    setPending(true); setError('');
    try {
      // A malformed form keeps its last report; a valid new request replaces it even if source/core validation subsequently fails.
      timeSeriesDraftSelection(mode === 'statistics' ? { ...draft, maxLag: '0', minOverlap: '2' } : draft, xSource.sampleCount);
      setRecord(null);
      const captured = captureTimeSeriesRequest(run, mode, xSource.outputId, xComponent.index, ySource?.outputId ?? '', yComponent?.index ?? 0, draft, removeMean, current === false);
      const api = await import('../../../../packages/analysis/src/time-series-statistics');
      if (!alive.current || generation.current !== request) return;
      const next: CapturedTimeSeriesReport = captured.kind === 'statistics' ? { ...captured, result: api.analyzeTimeStatistics(captured.input) } : { ...captured, result: api.analyzeSignalCorrelation(captured.input, captured.options) };
      if (alive.current && generation.current === request) setRecord(next);
    } catch (caught) { if (alive.current && generation.current === request) setError(failure(caught)); }
    finally { if (alive.current && generation.current === request) setPending(false); }
  };
  const stale = record ? timeSeriesReportStale(record, run, current) : false;
  return <div className="time-series-panel" data-testid="time-series-statistics-panel">
    <p className="field-help">완료된 시간 시뮬레이션의 실수 기록에서 2~8192개 표본을 선택합니다. 모델과 실행 결과를 변경하지 않습니다.</p>
    <div className="time-series-mode" role="group" aria-label="시계열 분석 종류"><button className="button" aria-pressed={mode === 'statistics'} disabled={disabled} onClick={() => { setMode('statistics'); setError(''); }}>구간 통계</button><button className="button" aria-pressed={mode === 'correlation'} disabled={disabled} onClick={() => { setMode('correlation'); setError(''); }}>신호 상관</button></div>
    {xSource ? <><SourceSelect label="X 출력 기록" aria="통계 X 출력" source={xSource} sources={available.sources} disabled={disabled} onChange={setXId}/><ComponentSelect aria="통계 X 성분" source={xSource} index={xComponent?.index ?? 0} disabled={disabled} onChange={setXIndex}/><SourceDescription source={xSource} stale={current === false}/></> : <p className="time-series-source">시간 시뮬레이션을 완료한 뒤 분석할 출력 기록을 선택하세요. 정적 계산과 부분 실행은 출처로 사용하지 않습니다.</p>}
    {mode === 'correlation' && ySource && <><SourceSelect label="Y 출력 기록" aria="상관 Y 출력" source={ySource} sources={available.sources} disabled={disabled} onChange={setYId}/><ComponentSelect aria="상관 Y 성분" source={ySource} index={yComponent?.index ?? 0} disabled={disabled} onChange={setYIndex}/><SourceDescription source={ySource} stale={current === false}/></>}
    {available.issues.map((issue, index) => <p className="time-series-diagnostic" key={index}>{issue}</p>)}
    <div className="time-series-fields"><IntegerField label="시작 표본 · 0부터" aria="통계 시작 표본" value={draft.startIndex} disabled={disabled} onChange={value => setDraft(now => ({ ...now, startIndex: value }))}/><IntegerField label="표본 수 · 2~8192" aria="통계 표본 수" value={draft.count} disabled={disabled} onChange={value => setDraft(now => ({ ...now, count: value }))}/>{mode === 'correlation' && <><IntegerField label="최대 지연 · 표본 수−1 이하, 0~512" aria="상관 최대 지연" value={draft.maxLag} disabled={disabled} onChange={value => setDraft(now => ({ ...now, maxLag: value }))}/><IntegerField label="최소 겹침 · 2 이상" aria="상관 최소 겹침" value={draft.minOverlap} disabled={disabled} onChange={value => setDraft(now => ({ ...now, minOverlap: value }))}/></>}</div>
    {mode === 'statistics' ? <p className="field-help">각 표본은 같은 가중치를 갖습니다. 시간 가중 평균이나 시간 적분으로 해석하지 마세요. 모집단 분산은 N, 표본 분산은 N−1로 나눕니다.</p> : <><label className="time-series-checkbox"><input type="checkbox" aria-label="상관 평균 제거" checked={removeMean} disabled={disabled} onChange={event => setRemoveMean(event.target.checked)}/><span>각 지연의 겹침 구간 평균 제거</span></label><p className="field-help">양의 지연 k는 X[i]와 Y[i+k]를 비교하며 Y가 X 뒤에 오는 방향입니다. 같은 기록의 정확히 같은 단위와 시각만 비교합니다. 상관 피크는 인과관계나 지연의 확정값이 아닙니다.</p></>}
    {invalidDraft && <p className="dialog-error">편집 중인 모델 입력값을 먼저 확인하세요.</p>}
    <div className="dialog-actions"><button className="button primary" disabled={disabled || invalidDraft || !xSource || !xComponent || xSource.sampleCount < 2 || mode === 'correlation' && (!ySource || !yComponent)} onClick={() => void calculate()}>{pending ? '시계열 분석 중' : mode === 'statistics' ? '구간 통계 계산' : '신호 상관 계산'}</button>{record && <button className="button" disabled={disabled} onClick={() => downloadReport(record, stale)}>시계열 분석 JSON</button>}</div>
    {pending && <p role="status">선택한 원시 표본을 분석하고 있습니다.</p>}{error && <p className="dialog-error" role="alert">{error}</p>}
    {record && <TimeSeriesAnalysisSummary record={record} stale={stale}/>}
  </div>;
}
function IntegerField({ label, aria, value, disabled, onChange }: { label: string; aria: string; value: string; disabled: boolean; onChange: (value: string) => void }) { return <label className="field"><span className="field-label">{label}</span><input type="text" inputMode="numeric" aria-label={aria} maxLength={100} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/></label>; }
function SourceSelect({ label, aria, source, sources, disabled, onChange }: { label: string; aria: string; source: TimeSeriesAnalysisSource; sources: TimeSeriesAnalysisSource[]; disabled: boolean; onChange: (id: string) => void }) { return <label className="field"><span className="field-label">{label}</span><select aria-label={aria} value={source.id} disabled={disabled} onChange={event => onChange(event.target.value)}>{sources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>; }
function ComponentSelect({ aria, source, index, disabled, onChange }: { aria: string; source: TimeSeriesAnalysisSource; index: number; disabled: boolean; onChange: (value: number) => void }) { return <label className="field"><span className="field-label">실수 성분</span><select aria-label={aria} value={index} disabled={disabled} onChange={event => onChange(Number(event.target.value))}>{source.components.map(item => <option key={item.index} value={item.index}>{item.label}</option>)}</select></label>; }
function SourceDescription({ source, stale = false }: { source: TimeSeriesAnalysisSource; stale?: boolean }) { return <div className="time-series-source"><p>{source.modelName} · {source.label} · 기록 {source.sampleCount}개</p><p>{stale ? '이전 실행의 기록입니다.' : '완료된 시간 시뮬레이션의 기록입니다.'}</p></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function Provenance({ source, label }: { source: TimeSeriesSourceSnapshot; label: string }) { return <div><h4>{label} · {source.label} · {source.componentLabel}</h4><dl className="time-series-provenance"><Metric label="모델 ID" value={source.modelId}/><Metric label="출력 ID" value={source.outputId}/><Metric label="실행 상태" value={source.runStatus}/><Metric label="모델 의미 해시 · SHA-256" value={source.semanticHash}/><Metric label="선택 표본 해시 · SHA-256" value={source.samplesSha256}/><Metric label="선택 구간" value={`표본 ${source.startIndex}~${source.startIndex + source.count - 1} · ${String(source.startTime)}~${String(source.endTime)} s`}/></dl></div>; }

export function TimeSeriesAnalysisSummary({ record, stale = false }: { record: CapturedTimeSeriesReport; stale?: boolean }) {
  const source = record.kind === 'statistics' ? record.source : record.xSource;
  return <section className="time-series-result" aria-label="시계열 분석 결과"><h3>{record.kind === 'statistics' ? '구간 통계' : '신호 상관'} · {source.label} · {source.componentLabel}</h3><SourceDescription source={source} stale={stale || record.previousRun}/><p className="time-series-source">분석 구간: 표본 {source.startIndex}~{source.startIndex + source.count - 1} · {formatNumber(record.result.startTime)}~{formatNumber(record.result.endTime)} s</p>{record.kind === 'statistics' ? <StatisticsSummary report={record.result} unit={source.unit || '출력 단위'}/> : <CorrelationSummary record={record}/>}{record.result.diagnostics.map((message, index) => <p className="time-series-diagnostic" key={index}>{message}</p>)}<details className="time-series-details"><summary>기록 출처와 원시 입력</summary><Provenance source={source} label="X"/>{record.kind === 'correlation' && <Provenance source={record.ySource} label="Y"/>}<p className="field-help">JSON에는 계산할 때 복사한 원시 시각·값, 출처, 설정과 모든 결과를 보존합니다. 폼을 편집해도 이 보고서의 선택 구간과 설정은 바뀌지 않습니다.</p><MetricList count={record.result.count} interval={record.result.sampleInterval} work={record.result.work}/></details></section>;
}
function MetricList({ count, interval, work }: { count: number; interval: number; work: number }) { return <dl className="time-series-metrics"><Metric label="분석 표본 수" value={String(count)}/><Metric label="표본 간격" value={`${String(interval)} s`}/><Metric label="계산 예산 단위 / 상한" value={`${work} / 20000000`}/></dl>; }
function StatisticsSummary({ report, unit }: { report: TimeStatisticsReport; unit: string }) {
  return <><p className="field-help">동일 표본 가중치 · {report.count}개 · 시간 가중 평균이나 시간 적분으로 해석하지 마세요.</p><dl className="time-series-metrics"><Metric label="평균" value={`${formatNumber(report.mean)} ${unit}`}/><Metric label="RMS" value={`${formatNumber(report.rms)} ${unit}`}/><Metric label="최솟값" value={`${formatNumber(report.min)} ${unit}`}/><Metric label="최댓값" value={`${formatNumber(report.max)} ${unit}`}/><Metric label={`모집단 분산 · 분모 N = ${report.populationDivisor}`} value={`${String(report.variancePopulation)} (${unit})²`}/><Metric label={`표본 분산 · 분모 N−1 = ${report.sampleDivisor}`} value={`${String(report.varianceSample)} (${unit})²`}/><Metric label="모집단 표준편차" value={`${String(report.standardDeviationPopulation)} ${unit}`}/><Metric label="표본 표준편차" value={`${String(report.standardDeviationSample)} ${unit}`}/></dl><p className="field-help">N−1 분모가 독립 표본이나 추론의 적합성을 보장하지 않습니다. 값의 단위는 원래 기록을 따르며 분산의 단위는 그 제곱입니다.</p></>;
}
function undefinedReason(reason: CorrelationRow['reason']): string { return reason === 'zero-energy' ? '영 에너지' : reason === 'insufficient-overlap' ? '겹침 부족' : '—'; }
function CorrelationSummary({ record }: { record: CorrelationRequest & { result: CorrelationReport } }) {
  const report = record.result, [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [report]);
  const pages = Math.ceil(report.rows.length / PAGE_SIZE), safePage = Math.min(page, Math.max(0, pages - 1)), rows = report.rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE), unit = record.xSource.unit || '출력 단위';
  return <><p className="field-help">X: {record.xSource.label} · {record.xSource.componentLabel} / Y: {record.ySource.label} · {record.ySource.componentLabel}. 평균 {record.options.removeMean ? '제거 · 각 겹침 구간에서 별도로 계산' : '유지 · 원시 표본 코사인 상관'} · 최대 지연 {record.options.maxLag} · 최소 겹침 {record.options.minOverlap}개.</p><p className="field-help">양의 지연 k는 X[i]와 Y[i+k]를 비교하며 Y가 X 뒤에 오는 방향입니다. 겹침 구간의 에너지로 정규화하며 상관계수는 무차원입니다.</p><dl className="time-series-metrics"><Metric label="최대 절대 상관 후보 지연" value={report.peak ? `${report.peak.lag} 표본 · ${String(report.peak.lagSeconds)} s` : '정의된 후보 없음'}/><Metric label="후보 상관계수" value={report.peak ? String(report.peak.coefficient) : '—'}/><Metric label="후보 실제 겹침" value={report.peak ? `${report.peak.overlapCount}개` : '—'}/></dl><p className="field-help">피크는 요청한 지연 중 |상관계수|가 가장 큰 후보입니다. 인과관계나 지연의 확정값이 아닙니다. 겹침 부족과 영 에너지는 0으로 바꾸지 않고 정의되지 않음(—)으로 표시합니다.</p><CorrelationGraph rows={report.rows} peakLag={report.peak?.lag}/><details className="time-series-details"><summary>지연별 원시 상관 표 · {report.rows.length}개</summary><p className="field-help">인덱스는 원래 기록 기준입니다. X·Y의 시각 범위와 평균·에너지는 각 지연의 실제 겹침 표본에서 계산합니다. 분모는 √(X 에너지 × Y 에너지)이며 분자는 교차곱 합입니다.</p><div className="time-series-pagination"><button className="button" aria-label="상관 표 이전 페이지" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>이전</button><span role="status">{safePage + 1} / {pages} 페이지 · {safePage * PAGE_SIZE + 1}~{safePage * PAGE_SIZE + rows.length}</span><button className="button" aria-label="상관 표 다음 페이지" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>다음</button></div><div className="time-series-table-scroll"><table aria-label="지연별 원시 상관"><thead><tr><th>지연 · 표본</th><th>지연 · s</th><th>상관계수</th><th>정의되지 않은 이유</th><th>실제 겹침</th><th>X 인덱스</th><th>Y 인덱스</th><th>X 시각 · s</th><th>Y 시각 · s</th><th>X 평균 · {unit}</th><th>Y 평균 · {unit}</th><th>분자 · ({unit})²</th><th>X 에너지 · ({unit})²</th><th>Y 에너지 · ({unit})²</th><th>분모 · ({unit})²</th><th>X 스케일 · {unit}</th><th>Y 스케일 · {unit}</th><th>스케일 분자</th><th>스케일 X 에너지</th><th>스케일 Y 에너지</th><th>스케일 분모</th></tr></thead><tbody>{rows.map(row => <tr key={row.lag}><td>{row.lag}</td><td>{String(row.lagSeconds)}</td><td>{row.coefficient === null ? '—' : String(row.coefficient)}</td><td>{undefinedReason(row.reason)}</td><td>{row.overlapCount}</td><td>{record.xSource.startIndex + row.xStartIndex}~{record.xSource.startIndex + row.xEndIndex}</td><td>{record.ySource.startIndex + row.yStartIndex}~{record.ySource.startIndex + row.yEndIndex}</td><td>{String(row.xStartTime)}~{String(row.xEndTime)}</td><td>{String(row.yStartTime)}~{String(row.yEndTime)}</td><td>{String(row.xMean)}</td><td>{String(row.yMean)}</td><td>{String(row.numerator)}</td><td>{String(row.xEnergy)}</td><td>{String(row.yEnergy)}</td><td>{String(row.denominator)}</td><td>{String(row.scaleX)}</td><td>{String(row.scaleY)}</td><td>{String(row.scaledNumerator)}</td><td>{String(row.scaledXEnergy)}</td><td>{String(row.scaledYEnergy)}</td><td>{String(row.scaledDenominator)}</td></tr>)}</tbody></table></div><p className="field-help">극도로 작은 값의 제곱 에너지는 Float64에서 0으로 반올림될 수 있습니다. 상관계수와 영 에너지 판정은 표시된 스케일과 스케일 에너지로 계산합니다. 원시·스케일 수치는 JSON에도 모두 유지합니다.</p></details></>;
}

/** Display-only sampling; original rows remain untouched in the table and export. */
export function correlationDisplayRows(rows: CorrelationRow[], peakLag?: number): CorrelationRow[] {
  if (rows.length <= DISPLAY_POINTS) return rows;
  const indices = new Set([0, rows.length - 1]);
  for (const lag of [0, peakLag]) { const index = rows.findIndex(row => row.lag === lag); if (index >= 0) indices.add(index); }
  for (let index = 0; index < DISPLAY_POINTS && indices.size < DISPLAY_POINTS; index++) indices.add(Math.round(index * (rows.length - 1) / (DISPLAY_POINTS - 1)));
  return [...indices].sort((a, b) => a - b).map(index => rows[index]!);
}
export function CorrelationGraph({ rows, peakLag }: { rows: CorrelationRow[]; peakLag?: number }) {
  const display = correlationDisplayRows(rows, peakLag), minimum = rows[0]?.lagSeconds ?? 0, maximum = rows.at(-1)?.lagSeconds ?? 0;
  const x = (value: number) => maximum === minimum ? 320 : 18 + (value - minimum) / (maximum - minimum) * 604, y = (value: number) => 119 - value * 101;
  return <figure className="time-series-plot"><figcaption>지연별 상관계수 · 무차원 · 세로 축 −1~1</figcaption><div className="time-series-axis-labels"><span>1</span><span>양의 지연: Y가 X 뒤에 옴</span></div><svg viewBox="0 0 640 240" role="img" aria-label="신호 상관 그래프" data-row-count={rows.length} data-display-count={display.length}><title>지연별 상관계수</title>{[18, 119, 220].map(position => <line className="time-series-grid" key={position} x1={18} x2={622} y1={position} y2={position}/>)}{display.filter(row => row.coefficient !== null).map(row => <circle className="time-series-point" key={row.lag} cx={x(row.lagSeconds)} cy={y(row.coefficient!)} r={2.4}><title>{row.lag} 표본 · {String(row.lagSeconds)} s · 상관 {String(row.coefficient)} · 겹침 {row.overlapCount}개</title></circle>)}</svg><div className="time-series-axis-labels"><span>−1 · {formatNumber(minimum)} s</span><span>{formatNumber(maximum)} s</span></div><p className="field-help">점 하나는 요청한 지연 하나입니다. 정의되지 않은 값에는 점을 그리지 않으며 점 사이를 보간하지 않습니다. 그래프는 최대 512개 지연만 표시하고 전체 {rows.length}개 값은 원시 표와 JSON에 보존합니다.</p></figure>;
}
