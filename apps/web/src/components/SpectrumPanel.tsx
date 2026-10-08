import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINE_VERSION, ModelError } from '../../../../packages/model/src';
import type { SpectrumBin, SpectrumOptions, SpectrumReport } from '../../../../packages/analysis/src/spectrum';
import type { ControlAnalysisRun } from '../control-analysis-sources';
import { readSpectrumSelection, spectrumAnalysisSources, type SpectrumAnalysisSource, type SpectrumSourceSnapshot } from '../spectrum-analysis-sources';
import { formatNumber } from './ResultPlot';
import './SpectrumPanel.css';

export interface SpectrumPanelProps {
  run?: ControlAnalysisRun | null;
  current?: boolean;
  busy: boolean;
  invalidDraft: boolean;
}
type SpectrumDraft = { startIndex: string; count: string };
export interface CapturedSpectrumReport {
  source: SpectrumSourceSnapshot;
  options: SpectrumOptions;
  result: SpectrumReport;
  previousRun: boolean;
}
const INTEGER = /^(?:0|[1-9]\d*)$/;
const PAGE_SIZE = 128;
function integerDraft(value: string): number { return value.length <= 100 && INTEGER.test(value.trim()) ? Number(value.trim()) : NaN; }
export function spectrumDraftSelection(draft: SpectrumDraft, sampleCount: number): { startIndex: number; count: number } {
  const startIndex = integerDraft(draft.startIndex), count = integerDraft(draft.count);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) throw new Error('시작 표본은 0 이상의 정수 인덱스로 지정하세요.');
  if (!Number.isSafeInteger(count) || count < 8 || count > 8192 || (count & (count - 1)) !== 0) throw new Error('표본 수는 8~8192 사이의 2의 거듭제곱이어야 합니다.');
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || startIndex > sampleCount - count) throw new Error('선택 구간이 기록된 표본 수를 벗어났습니다. 시작 표본과 표본 수를 확인하세요.');
  return { startIndex, count };
}
export function spectrumReportExport(record: CapturedSpectrumReport): object {
  return structuredClone({ schemaVersion: 1, kind: 'recorded-signal-spectrum', engineVersion: ENGINE_VERSION, source: record.source, options: record.options, result: record.result });
}
function downloadReport(record: CapturedSpectrumReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(spectrumReportExport(record), null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-spectrum.json'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function failureMessage(error: unknown): string { return error instanceof ModelError ? error.diagnostics.map(item => item.message).join(' · ') : error instanceof Error ? error.message : '출력 기록과 표본 구간을 확인해 주세요.'; }
function initialCount(sampleCount: number): string { return String(Math.max(8, 2 ** Math.floor(Math.log2(Math.max(1, Math.min(256, sampleCount)))))); }

export function SpectrumPanel({ run, current, busy, invalidDraft }: SpectrumPanelProps) {
  const available = useMemo(() => spectrumAnalysisSources(run), [run]);
  const [sourceId, setSourceId] = useState(''), [componentIndex, setComponentIndex] = useState(0);
  const [draft, setDraft] = useState<SpectrumDraft>({ startIndex: '0', count: initialCount(available.sources[0]?.sampleCount ?? 0) });
  const [window, setWindow] = useState<SpectrumOptions['window']>('hann'), [removeMean, setRemoveMean] = useState(true);
  const [record, setRecord] = useState<CapturedSpectrumReport | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const source = available.sources.find(candidate => candidate.id === sourceId) ?? available.sources[0];
  const component = source?.components.find(candidate => candidate.index === componentIndex) ?? source?.components[0];
  useEffect(() => { setDraft({ startIndex: '0', count: initialCount(source?.sampleCount ?? 0) }); setComponentIndex(source?.components[0]?.index ?? 0); setError(''); }, [source?.id, source?.sampleCount]);
  const calculate = async () => {
    if (!source || !component || !run || pending || busy || invalidDraft) return;
    const request = ++generation.current;
    setPending(true); setError('');
    try {
      const selection = spectrumDraftSelection(draft, source.sampleCount), options: SpectrumOptions = { window, removeMean };
      setRecord(null);
      const selected = readSpectrumSelection(run, source.outputId, component.index, selection.startIndex, selection.count);
      const capturedSource = structuredClone(selected.source), input = structuredClone(selected.input), previousRun = current === false;
      const api = await import('../../../../packages/analysis/src/spectrum');
      if (!alive.current || generation.current !== request) return;
      const result = api.analyzeSpectrum(input, options);
      if (alive.current && generation.current === request) setRecord({ source: capturedSource, options, result, previousRun });
    } catch (caught) { if (alive.current && generation.current === request) setError(failureMessage(caught)); }
    finally { if (alive.current && generation.current === request) setPending(false); }
  };
  return <div className="spectrum-panel" data-testid="spectrum-panel">
    <p className="field-help">완료된 시간 시뮬레이션 기록에서 균등 간격의 실수 신호를 분석합니다. 표본은 8~8192개이며, 모델과 실행 결과를 변경하지 않습니다.</p>
    {source ? <><label className="field"><span className="field-label">분석할 출력 기록</span><select aria-label="스펙트럼 출력" value={source.id} disabled={pending} onChange={event => { setSourceId(event.target.value); setError(''); }}>{available.sources.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label><SourceDescription source={source} stale={current === false}/>
      <label className="field"><span className="field-label">실수 성분</span><select aria-label="스펙트럼 성분" value={component?.index ?? 0} disabled={pending} onChange={event => { setComponentIndex(Number(event.target.value)); setError(''); }}>{source.components.map(candidate => <option key={candidate.index} value={candidate.index}>{candidate.label}</option>)}</select></label>
    </> : <p className="spectrum-source-note">시간 시뮬레이션을 완료한 뒤 분석할 출력 기록을 선택하세요. 정적 계산과 부분 실행은 스펙트럼 출처로 사용하지 않습니다.</p>}
    {available.issues.map((issue, index) => <p className="spectrum-diagnostic" key={index}>{issue}</p>)}
    <div className="spectrum-fields"><TextInteger label="시작 표본 · 0부터" aria="스펙트럼 시작 표본" value={draft.startIndex} disabled={pending} onChange={value => setDraft(valueNow => ({ ...valueNow, startIndex: value }))}/><TextInteger label="표본 수 · 8~8192, 2의 거듭제곱" aria="스펙트럼 표본 수" value={draft.count} disabled={pending} onChange={value => setDraft(valueNow => ({ ...valueNow, count: value }))}/><label className="field"><span className="field-label">창 함수</span><select aria-label="스펙트럼 창 함수" value={window} disabled={pending} onChange={event => setWindow(event.target.value === 'rectangular' ? 'rectangular' : 'hann')}><option value="hann">Hann</option><option value="rectangular">직사각형</option></select></label></div>
    <label className="spectrum-checkbox"><input type="checkbox" aria-label="스펙트럼 평균 제거" checked={removeMean} disabled={pending} onChange={event => setRemoveMean(event.target.checked)}/><span>선택 구간 평균 제거</span></label>
    <p className="field-help">표본은 재보간하지 않습니다. 진폭과 전력 스펙트럼 밀도(PSD)는 단측 값이며, 창 함수의 진폭 이득과 전력 이득을 각각 보정합니다. 주파수는 Hz입니다.</p>
    {source && source.sampleCount < 8 && <p className="spectrum-diagnostic">분석에는 최소 8개의 기록된 표본이 필요합니다.</p>}
    {invalidDraft && <p className="dialog-error">편집 중인 모델 입력값을 먼저 확인하세요.</p>}
    <div className="dialog-actions"><button className="button primary" disabled={pending || busy || invalidDraft || !source || !component || source.sampleCount < 8} onClick={() => void calculate()}>{pending ? '스펙트럼 계산 중' : '스펙트럼 계산'}</button>{record && <button className="button" onClick={() => downloadReport(record)}>스펙트럼 JSON</button>}</div>
    {pending && <p role="status">선택 구간의 주파수 성분을 계산하고 있습니다.</p>}{error && <p className="dialog-error" role="alert">{error}</p>}
    {record && <SpectrumAnalysisSummary record={record} stale={record.previousRun || current === false || record.source.semanticHash !== run?.semanticHash}/>}
  </div>;
}
function TextInteger({ label, aria, value, disabled, onChange }: { label: string; aria: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><input type="text" inputMode="numeric" maxLength={100} aria-label={aria} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/></label>;
}
function SourceDescription({ source, stale = false }: { source: SpectrumAnalysisSource; stale?: boolean }) {
  return <div className="spectrum-source-note"><p>{source.modelName} · {source.label} · 기록 {source.sampleCount}개</p><p>{stale ? '이전 실행의 기록입니다.' : '완료된 시간 시뮬레이션의 기록입니다.'}</p></div>;
}
export function SpectrumAnalysisSummary({ record, stale = false }: { record: CapturedSpectrumReport; stale?: boolean }) {
  const { result: report, source } = record;
  const [view, setView] = useState<'amplitude' | 'powerDensity'>('amplitude'), [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [report]);
  const pages = Math.ceil(report.bins.length / PAGE_SIZE), safePage = Math.min(page, Math.max(0, pages - 1)), rows = report.bins.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE), unit = source.unit || '출력 단위';
  return <section className="spectrum-result" aria-label="스펙트럼 분석 결과"><h3>{source.label} · {source.componentLabel}</h3><SourceDescription source={source} stale={stale || record.previousRun}/>
    <p className="spectrum-source-note">분석 구간: 표본 {source.startIndex}~{source.startIndex + source.count - 1} · {formatNumber(report.startTime)}~{formatNumber(report.endTime)} s</p>
    <dl className="spectrum-metrics"><Metric label="표본 수" value={String(report.count)}/><Metric label="표본 주파수" value={`${formatNumber(report.sampleRate)} Hz`}/><Metric label="주파수 간격" value={`${formatNumber(report.frequencyResolution)} Hz`}/><Metric label="Nyquist 주파수" value={`${formatNumber(report.nyquist)} Hz`}/><Metric label="선택 구간 평균" value={`${formatNumber(report.mean)} ${unit}`}/><Metric label="선택 구간 RMS" value={`${formatNumber(report.rms)} ${unit}`}/><Metric label="우세한 비DC 주파수" value={report.peak ? `${formatNumber(report.peak.frequency)} Hz` : '유한한 비DC 성분 없음'}/><Metric label="우세한 비DC 진폭" value={report.peak ? `${formatNumber(report.peak.amplitude)} ${unit}` : '—'}/></dl>
    <p className="field-help">{record.options.window === 'hann' ? 'Hann' : '직사각형'} 창 · 평균 {record.options.removeMean ? '제거' : '유지'}. 평균과 RMS는 창 적용 전 선택 구간의 값입니다. 우세한 주파수는 기록의 FFT 빈에서 선택하며 빈 사이의 피크를 추정하지 않습니다.</p>
    {report.diagnostics.map((diagnostic, index) => <p className="spectrum-diagnostic" key={index}>{diagnostic}</p>)}
    <div className="spectrum-view" role="group" aria-label="스펙트럼 그래프 종류"><button className={`button${view === 'amplitude' ? ' active' : ''}`} aria-pressed={view === 'amplitude'} onClick={() => setView('amplitude')}>진폭</button><button className={`button${view === 'powerDensity' ? ' active' : ''}`} aria-pressed={view === 'powerDensity'} onClick={() => setView('powerDensity')}>전력 밀도</button></div>
    <SpectrumGraph bins={report.bins} view={view} unit={unit}/>
    <details className="spectrum-details"><summary>정규화와 전력</summary><dl className="spectrum-metrics"><Metric label="표본 간격" value={`${String(report.sampleInterval)} s`}/><Metric label="창 진폭 이득" value={String(report.windowCoherentGain)}/><Metric label="창 전력 이득" value={String(report.windowPowerGain)}/><Metric label="PSD 적분 전력" value={`${String(report.integratedPower)} ${unit}²`}/></dl><p className="field-help">PSD 적분 전력은 창 함수와 평균 제거를 적용한 표본 기준입니다. 원래 신호의 RMS²와 비교할 때 창의 영향과 평균 제거를 고려하세요.</p></details>
    <details className="spectrum-details"><summary>원시 주파수 표 · {report.bins.length}개</summary><p className="field-help">실수부와 허수부는 FFT 원시 계수입니다. 위상은 0 성분에서 정의하지 않으며 —로 표시합니다.</p><div className="spectrum-pagination"><button className="button" aria-label="스펙트럼 표 이전 페이지" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>이전</button><span role="status">{safePage + 1} / {pages} 페이지 · {safePage * PAGE_SIZE + 1}~{safePage * PAGE_SIZE + rows.length}</span><button className="button" aria-label="스펙트럼 표 다음 페이지" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>다음</button></div><div className="spectrum-table-scroll"><table aria-label="스펙트럼 원시 주파수 응답"><thead><tr><th>빈</th><th>Hz</th><th>실수부</th><th>허수부</th><th>진폭</th><th>PSD</th><th>위상 · °</th></tr></thead><tbody>{rows.map(bin => <tr key={bin.index}><td>{bin.index}</td><td>{String(bin.frequency)}</td><td>{String(bin.real)}</td><td>{String(bin.imag)}</td><td>{String(bin.amplitude)}</td><td>{String(bin.powerDensity)}</td><td>{bin.phaseDegrees === null ? '—' : String(bin.phaseDegrees)}</td></tr>)}</tbody></table></div></details>
    <details className="spectrum-details"><summary>기록 출처</summary><dl className="spectrum-provenance"><Metric label="모델 ID" value={source.modelId}/><Metric label="출력 ID" value={source.outputId}/><Metric label="기록 상태" value={source.runStatus}/><Metric label="모델 의미 해시 · SHA-256" value={source.semanticHash}/><Metric label="선택 표본 해시 · SHA-256" value={source.samplesSha256}/></dl></details>
  </section>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
export function SpectrumGraph({ bins, view, unit }: { bins: SpectrumBin[]; view: 'amplitude' | 'powerDensity'; unit: string }) {
  const label = view === 'amplitude' ? '스펙트럼 진폭' : '스펙트럼 전력 밀도', valueUnit = view === 'amplitude' ? unit : `${unit}²/Hz`, maximumFrequency = bins.at(-1)?.frequency ?? 0;
  let maximum = 0;
  for (const bin of bins) if (Number.isFinite(bin[view])) maximum = Math.max(maximum, bin[view]);
  const scale = maximum > 0 ? maximum * 1.08 : 1, x = (frequency: number) => 18 + (maximumFrequency > 0 ? frequency / maximumFrequency : 0) * 604, y = (value: number) => 220 - value / scale * 202;
  return <figure className="spectrum-plot"><figcaption>{label} · {valueUnit} · 주파수는 선형 Hz 축</figcaption><div className="spectrum-axis-labels"><span>{formatNumber(scale)} {valueUnit}</span><span>상단</span></div><svg viewBox="0 0 640 240" role="img" aria-label={`${label} 그래프`} data-bin-count={bins.length}><title>{label}</title>{[0, 1, 2, 3, 4].map(index => <g key={index}><line className="spectrum-grid" x1={18} x2={622} y1={18 + index * 50.5} y2={18 + index * 50.5}/><line className="spectrum-grid" x1={18 + index * 151} x2={18 + index * 151} y1={18} y2={220}/></g>)}{bins.filter(bin => Number.isFinite(bin.frequency) && Number.isFinite(bin[view])).map(bin => <line key={bin.index} className="spectrum-bin" x1={x(bin.frequency)} x2={x(bin.frequency)} y1={220} y2={y(bin[view])}/>)}<line className="spectrum-axis" x1={18} x2={622} y1={220} y2={220}/></svg><div className="spectrum-axis-labels"><span>0 Hz</span><span>{formatNumber(maximumFrequency)} Hz</span></div><p className="field-help">각 선은 FFT 빈 하나의 값입니다. 빈 사이를 보간하지 않습니다.</p></figure>;
}
