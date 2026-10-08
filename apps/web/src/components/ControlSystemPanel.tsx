import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINE_VERSION, ModelError, type CalcModel } from '../../../../packages/model/src';
import type { ComplexValue, ControlAnalysisReport, ControlAnalysisSpec } from '../../../../packages/analysis/src/control-system';
import { controlAnalysisSources, type ControlAnalysisRun, type ControlAnalysisSource } from '../control-analysis-sources';
import { formatNumber } from './ResultPlot';
import './ControlSystemPanel.css';

export interface ControlSystemPanelProps {
  model: CalcModel;
  linearizationRun?: ControlAnalysisRun | null;
  linearizationCurrent?: boolean;
  busy: boolean;
  invalidDraft: boolean;
}
type Draft = { minimum: string; maximum: string; points: string; gainMaximum: string; gainPoints: string };
type CapturedReport = { source: ControlAnalysisSource; options: ControlAnalysisSpec; feedbackAssumptionAccepted: boolean; result: ControlAnalysisReport };
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numberDraft(value: string): number { return DECIMAL.test(value.trim()) ? Number(value.trim()) : NaN; }
export function controlDraftOptions(draft: Draft, feedback: boolean): ControlAnalysisSpec {
  const frequencyMin = numberDraft(draft.minimum), frequencyMax = numberDraft(draft.maximum), frequencyPoints = numberDraft(draft.points);
  if (!Number.isFinite(frequencyMin) || !Number.isFinite(frequencyMax) || frequencyMin < 1e-6 || frequencyMax > 1e6 || frequencyMin >= frequencyMax) throw new Error('주파수는 10⁻⁶~10⁶ rad/s 안에서 시작 < 종료로 지정하세요.');
  if (!Number.isSafeInteger(frequencyPoints) || frequencyPoints < 2 || frequencyPoints > 801) throw new Error('주파수 표본 수는 2~801의 정수여야 합니다.');
  let rootLocusGains: number[] = [];
  if (feedback) {
    const maximum = numberDraft(draft.gainMaximum), points = numberDraft(draft.gainPoints);
    if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 1e6 || !Number.isSafeInteger(points) || points < 2 || points > 81) throw new Error('근궤적 K의 최댓값은 0 초과~10⁶, 표본 수는 2~81의 정수여야 합니다.');
    rootLocusGains = Array.from({ length: points }, (_, index) => maximum * index / (points - 1));
  }
  return { frequencyMin, frequencyMax, frequencyPoints, rootLocusGains };
}
export function controlReportExport(record: CapturedReport): object {
  const { margins, rootLocus, ...result } = record.result;
  return { schemaVersion: 1, kind: 'continuous-siso-control-analysis', engineVersion: ENGINE_VERSION,
    source: record.source, options: record.options, feedbackAssumption: record.feedbackAssumptionAccepted ? 'unity-negative-feedback-open-loop' : null,
    result: record.feedbackAssumptionAccepted ? record.result : result,
  };
}
function downloadReport(record: CapturedReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(controlReportExport(record), null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-control-analysis.json'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function failureMessage(error: unknown): string { return error instanceof ModelError ? error.diagnostics.map(item => item.message).join(' · ') : error instanceof Error ? error.message : '선형 시스템과 분석 범위를 확인해 주세요.'; }
export function ControlSystemPanel({ model, linearizationRun, linearizationCurrent, busy, invalidDraft }: ControlSystemPanelProps) {
  const available = useMemo(() => controlAnalysisSources(model, linearizationRun), [model, linearizationRun]);
  const [sourceId, setSourceId] = useState(''), [feedback, setFeedback] = useState(false);
  const [draft, setDraft] = useState<Draft>({ minimum: '0.01', maximum: '100', points: '201', gainMaximum: '10', gainPoints: '41' });
  const [record, setRecord] = useState<CapturedReport | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const activeSource = available.sources.find(source => source.id === sourceId) ?? available.sources[0];
  const calculate = async () => {
    if (!activeSource || pending || busy || invalidDraft) return;
    const request = ++generation.current;
    setPending(true); setError('');
    try {
      const options = controlDraftOptions(draft, feedback), source = structuredClone(activeSource), accepted = feedback;
      setRecord(null);
      const api = await import('../../../../packages/analysis/src/control-system');
      if (!alive.current || generation.current !== request) return;
      const result = api.analyzeContinuousSiso(source.system, options);
      if (alive.current && generation.current === request) setRecord({ source, options, feedbackAssumptionAccepted: accepted, result });
    } catch (caught) { if (alive.current && generation.current === request) setError(failureMessage(caught)); }
    finally { if (alive.current && generation.current === request) setPending(false); }
  };
  const change = (key: keyof Draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  return <div className="control-system-panel" data-testid="control-system-panel">
    <p className="field-help">연속 실수 SISO의 A/B/C/D로 주파수 응답과 극점·영점을 계산합니다. 상태 수는 1~4개이며, 모델과 실행 결과를 변경하지 않습니다.</p>
    {available.sources.length ? <><label className="field"><span className="field-label">분석할 행렬 출처</span><select aria-label="제어계 행렬 출처" value={activeSource?.id ?? ''} disabled={pending} onChange={event => { setSourceId(event.target.value); setError(''); }}>{available.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>{activeSource && <SourceDescription source={activeSource} stale={activeSource.kind === 'recorded-linearization' && !linearizationCurrent}/>}</> : <p className="control-source-note">분석할 행렬이 없습니다. 연속 State-Space 블록을 추가하거나 Local Linearization 블록을 실행한 뒤 이 창을 여세요.</p>}
    {available.issues.map((issue, index) => <p className="control-diagnostic" key={index}>{issue}</p>)}
    <div className="control-analysis-fields">
      <TextNumber label="주파수 시작 · rad/s" aria="제어계 주파수 시작" value={draft.minimum} disabled={pending} onChange={value => change('minimum', value)}/>
      <TextNumber label="주파수 종료 · rad/s" aria="제어계 주파수 종료" value={draft.maximum} disabled={pending} onChange={value => change('maximum', value)}/>
      <TextNumber label="주파수 표본 수" aria="제어계 주파수 표본 수" value={draft.points} disabled={pending} onChange={value => change('points', value)}/>
    </div>
    <div className="control-feedback-assumption"><label><input type="checkbox" aria-label="단위 음의 피드백 가정" checked={feedback} disabled={pending} onChange={event => setFeedback(event.target.checked)}/><span>선택 행렬을 개루프 L(s)로 두고 단위 음의 피드백 분석</span></label><p className="field-help">이 가정을 선택하면 이득·위상 여유와 1 + K L(s) = 0의 근궤적을 표시합니다. 도식의 실제 연결에서 개루프를 자동 추론하지 않습니다.</p>
      {feedback && <div className="control-analysis-fields"><TextNumber label="근궤적 K 최댓값" aria="근궤적 K 최댓값" value={draft.gainMaximum} disabled={pending} onChange={value => change('gainMaximum', value)}/><TextNumber label="근궤적 K 표본 수" aria="근궤적 K 표본 수" value={draft.gainPoints} disabled={pending} onChange={value => change('gainPoints', value)}/></div>}
    </div>
    {invalidDraft && <p className="dialog-error">편집 중인 모델 입력값을 먼저 확인하세요.</p>}
    <div className="dialog-actions"><button className="button primary" disabled={pending || busy || invalidDraft || !activeSource} onClick={() => void calculate()}>{pending ? '제어계 분석 중' : '제어계 분석 실행'}</button>{record && <button className="button" onClick={() => downloadReport(record)}>제어계 보고서 JSON</button>}</div>
    {pending && <p role="status">선택 행렬의 주파수와 극점을 계산하고 있습니다.</p>}{error && <p className="dialog-error" role="alert">{error}</p>}
    {record && <ControlAnalysisSummary record={record}/>}
  </div>;
}
function TextNumber({ label, aria, value, disabled, onChange }: { label: string; aria: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><input type="text" inputMode="decimal" maxLength={100} aria-label={aria} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/></label>;
}
function SourceDescription({ source, stale = false }: { source: ControlAnalysisSource; stale?: boolean }) {
  return <div className="control-source-note"><p>{source.modelName} · {source.label}{source.time !== undefined && ` · 기록 ${String(source.time)} s`}{source.requestTime !== undefined && ` · 선형화 요청 ${String(source.requestTime)} s`}</p>{source.kind === 'recorded-linearization' && <p>{stale ? '이전 실행의 선형화 행렬입니다.' : '확인된 실행의 선형화 행렬입니다.'} {source.runStatus !== 'completed' && '부분 실행에서 확인된 기록입니다.'} 요청 사이에는 마지막 행렬이 유지될 수 있습니다.</p>}</div>;
}
function complexText(value: ComplexValue): string { return value.imag === 0 ? String(value.real) : `${String(value.real)} ${value.imag < 0 ? '−' : '+'} ${String(Math.abs(value.imag))}i`; }
function displayMargin(value: number | null, unit: string): string { return value === null ? '이 구간에서 확정하지 않음' : `${formatNumber(value)} ${unit}`; }
function stabilityText(value: ControlAnalysisReport['stability']): string { return value === 'stable' ? '안정' : value === 'unstable' ? '불안정' : '허수축 근방 · 수치 확인 필요'; }
export function ControlAnalysisSummary({ record }: { record: CapturedReport }) {
  const { result: report, source, feedbackAssumptionAccepted } = record;
  return <section className="control-result" aria-label="제어계 분석 결과"><h3>{source.label} · {report.stateOrder}상태 SISO</h3><SourceDescription source={source}/>
    <dl className="control-result-metrics"><div><dt>상태 극점 기준</dt><dd>{stabilityText(report.stability)}</dd></div><div><dt>주파수 구간 · rad/s</dt><dd>{formatNumber(report.frequencyRange.minimum)} ~ {formatNumber(report.frequencyRange.maximum)}</dd></div></dl>
    {report.diagnostics.map((diagnostic, index) => <p className="control-diagnostic" key={index}>{diagnostic}</p>)}
    {report.zeroTransfer && <p className="control-diagnostic">선택한 입력에서 출력으로의 전달함수는 0입니다. 상태의 극점과 전달 영점의 의미를 구분해 확인하세요.</p>}
    <h4>주파수 응답</h4><BodeGraph points={report.bode.map(point => ({ x: point.omega, y: point.gainDb }))} label="Bode 크기" unit="dB"/><BodeGraph points={report.bode.map(point => ({ x: point.omega, y: point.phaseDegrees }))} label="Bode 위상" unit="°"/>
    {report.bode.some(point => point.status !== 'finite') && <p className="control-diagnostic">0 응답·특이점·표현할 수 없는 값은 그래프에 빈 구간으로 표시합니다. 해당 주파수의 상태는 원시 주파수 표에서 확인할 수 있습니다.</p>}
    <details className="control-details"><summary>원시 주파수 표 · {report.bode.length}개</summary><div className="control-table-scroll"><table aria-label="제어계 원시 주파수 응답"><thead><tr><th>ω · rad/s</th><th>실수부</th><th>허수부</th><th>크기 · dB</th><th>위상 · °</th><th>상태</th></tr></thead><tbody>{report.bode.map(point => <tr key={point.omega}><td>{String(point.omega)}</td><td>{point.real === null ? '—' : String(point.real)}</td><td>{point.imag === null ? '—' : String(point.imag)}</td><td>{point.gainDb === null ? '—' : String(point.gainDb)}</td><td>{point.phaseDegrees === null ? '—' : String(point.phaseDegrees)}</td><td>{point.status}</td></tr>)}</tbody></table></div></details>
    <h4>극점·영점</h4><ComplexPlane poles={report.poles} zeros={report.zeros} label="상태 극점과 전달 영점"/>
    <div className="control-table-scroll"><table aria-label="제어계 극점 영점"><thead><tr><th>종류</th><th>복소수 위치</th></tr></thead><tbody>{report.poles.map((value, index) => <tr key={`pole-${index}`}><th>상태 극점 {index + 1}</th><td>{complexText(value)}</td></tr>)}{report.zeros.map((value, index) => <tr key={`zero-${index}`}><th>전달 영점 {index + 1}</th><td>{complexText(value)}</td></tr>)}{!report.zeros.length && <tr><th>전달 영점</th><td>{report.zeroTransfer ? '0 전달함수에서는 정의하지 않음' : '유한 영점 없음'}</td></tr>}</tbody></table></div>
    {feedbackAssumptionAccepted && <><h4>단위 음의 피드백 가정의 여유</h4><p className="field-help">선택 행렬을 개루프 L(s)로 두었습니다. 아래 여유는 선택한 주파수 구간에서 확인한 교차에 대한 값입니다.</p><dl className="control-result-metrics"><div><dt>이득 여유</dt><dd>{displayMargin(report.margins.gainMarginDb, 'dB')}</dd></div><div><dt>위상 여유</dt><dd>{displayMargin(report.margins.phaseMarginDegrees, '°')}</dd></div></dl>
      <p className="control-diagnostic">{report.margins.status === 'incomplete' ? '특이점 또는 불완전한 구간 때문에 여유 판정을 보류합니다.' : report.margins.status === 'no-crossing-in-range' ? '이 주파수 구간에서 교차를 찾지 못했습니다. 무한 여유나 전체 안정성을 의미하지 않습니다.' : '찾은 교차를 아래 표에서 확인하세요.'}</p>
      {report.margins.diagnostics.map((diagnostic, index) => <p className="control-diagnostic" key={index}>{diagnostic}</p>)}
      <details className="control-details"><summary>여유의 교차 표</summary><div className="control-table-scroll"><table aria-label="제어계 여유 교차"><thead><tr><th>교차</th><th>ω · rad/s</th><th>여유</th></tr></thead><tbody>{report.margins.gainCrossovers.map((point, index) => <tr key={`gain-${index}`}><th>0 dB</th><td>{String(point.omega)}</td><td>{String(point.phaseMarginDegrees)} °</td></tr>)}{report.margins.phaseCrossovers.map((point, index) => <tr key={`phase-${index}`}><th>−180°</th><td>{String(point.omega)}</td><td>{String(point.gainMarginDb)} dB</td></tr>)}{!report.margins.gainCrossovers.length && !report.margins.phaseCrossovers.length && <tr><td colSpan={3}>선택 구간에서 확인한 교차 없음</td></tr>}</tbody></table></div></details>
      <details className="control-details"><summary>근궤적 · 1 + K L(s) = 0</summary><p className="field-help">지정한 K마다 폐루프 특성식의 극점을 계산합니다. 점 사이 경로를 보간하지 않습니다.</p><ComplexPlane poles={report.rootLocus.find(point => point.gain === 0)?.poles ?? report.poles} zeros={report.zeros} locus={report.rootLocus.filter(point => point.status === 'completed').flatMap(point => point.poles)} label="K 표본별 폐루프 극점"/>
        <div className="control-table-scroll"><table aria-label="제어계 근궤적 원시 표"><thead><tr><th>K</th><th>폐루프 극점</th><th>상태</th></tr></thead><tbody>{report.rootLocus.map(point => <tr key={point.gain}><td>{String(point.gain)}</td><td>{point.status === 'completed' ? point.poles.map(complexText).join(' ; ') : '계산을 확정하지 않음'}</td><td>{point.status}{point.diagnostics.length > 0 && ` · ${point.diagnostics.join(' · ')}`}</td></tr>)}</tbody></table></div></details>
    </>}
    <details className="control-details"><summary>분석 행렬과 전달함수 계수</summary><p className="field-help">s의 내림차순 계수입니다. 현재 선택한 상태 표현을 기준으로 계산합니다.</p><p className="control-polynomial">분자: {JSON.stringify(report.numerator)}<br/>분모: {JSON.stringify(report.denominator)}</p><div className="control-table-scroll"><table aria-label="제어계 분석 행렬"><tbody>{(['A', 'B', 'C', 'D'] as const).map(name => <tr key={name}><th>{name}</th><td className="control-polynomial">{JSON.stringify(report.stateSpace[name])}</td></tr>)}</tbody></table></div></details>
  </section>;
}
type PlotPoint = { x: number; y: number | null };
function normalized(value: number, minimum: number, maximum: number): number { return maximum > minimum ? (value - minimum) / (maximum - minimum) : .5; }
export function BodeGraph({ points, label, unit }: { points: PlotPoint[]; label: string; unit: string }) {
  const values = points.flatMap(point => point.y !== null && Number.isFinite(point.y) ? [point.y] : []);
  if (!values.length || !points.length) return <figure className="control-plot"><figcaption>{label}</figcaption><p className="control-diagnostic">표시할 유한한 {unit} 값이 없습니다.</p></figure>;
  const minValue = Math.min(...values), maxValue = Math.max(...values), pad = Math.max(1, (maxValue - minValue) * .08), minimum = minValue - pad, maximum = maxValue + pad;
  const minFrequency = points[0].x, maxFrequency = points.at(-1)!.x, logMinimum = Math.log10(minFrequency), logMaximum = Math.log10(maxFrequency);
  const plotX = (value: number) => 18 + normalized(Math.log10(value), logMinimum, logMaximum) * 604, plotY = (value: number) => 220 - normalized(value, minimum, maximum) * 202;
  let down = false;
  const path = points.map(point => { if (point.y === null || !Number.isFinite(point.y)) { down = false; return ''; } const segment = `${down ? 'L' : 'M'}${plotX(point.x).toFixed(3)},${plotY(point.y).toFixed(3)}`; down = true; return segment; }).join(' ');
  const finitePoint = (point: PlotPoint | undefined) => point?.y !== undefined && point.y !== null && Number.isFinite(point.y);
  const isolated = points.filter((point, index) => finitePoint(point) && !finitePoint(points[index - 1]) && !finitePoint(points[index + 1]));
  return <figure className="control-plot"><figcaption>{label} · {unit} · 주파수는 로그 축</figcaption><div className="control-axis-labels"><span>{formatNumber(maximum)} {unit}</span><span>상단</span></div><svg viewBox="0 0 640 240" role="img" aria-label={`${label}, 주파수 ${String(minFrequency)}~${String(maxFrequency)} rad/s`}><title>{label}</title>{[0, 1, 2, 3, 4].map(index => <g key={index}><line className="control-plot-grid" x1={18} x2={622} y1={18 + index * 50.5} y2={18 + index * 50.5}/><line className="control-plot-grid" x1={18 + index * 151} x2={18 + index * 151} y1={18} y2={220}/></g>)}<path className="control-plot-curve" d={path} data-sample-count={points.length}/>{isolated.map(point => <circle className="control-plot-point" key={point.x} cx={plotX(point.x)} cy={plotY(point.y!)} r={3}/>)}</svg><div className="control-axis-labels"><span>{formatNumber(minimum)} {unit}</span><span>하단</span></div><div className="control-axis-labels"><span>{formatNumber(minFrequency)} rad/s</span><span>{formatNumber(maxFrequency)} rad/s</span></div></figure>;
}
export function ComplexPlane({ poles, zeros, locus = [], label }: { poles: ComplexValue[]; zeros: ComplexValue[]; locus?: ComplexValue[]; label: string }) {
  const all = [...poles, ...zeros, ...locus, { real: 0, imag: 0 }], realMin = Math.min(...all.map(value => value.real)), realMax = Math.max(...all.map(value => value.real)), imagMin = Math.min(...all.map(value => value.imag)), imagMax = Math.max(...all.map(value => value.imag));
  const unit = Math.max((realMax - realMin) / 440, (imagMax - imagMin) / 280, 1 / 280) * 1.16, realCenter = (realMin + realMax) / 2, imagCenter = (imagMin + imagMax) / 2;
  const xMin = realCenter - unit * 220, xMax = realCenter + unit * 220, yMin = imagCenter - unit * 140, yMax = imagCenter + unit * 140;
  const x = (value: number) => 20 + normalized(value, xMin, xMax) * 440, y = (value: number) => 300 - normalized(value, yMin, yMax) * 280;
  return <figure className="control-plot"><figcaption>{label} · 복소 s 평면 · s⁻¹</figcaption><div className="control-axis-labels"><span>허수부 {formatNumber(yMax)}</span><span>상단</span></div><svg viewBox="0 0 480 320" role="img" aria-label={label}><title>{label}</title>{[0, 1, 2, 3, 4].map(index => <g key={index}><line className="control-plot-grid" x1={20} x2={460} y1={20 + index * 70} y2={20 + index * 70}/><line className="control-plot-grid" x1={20 + index * 110} x2={20 + index * 110} y1={20} y2={300}/></g>)}<line className="control-plot-axis" x1={x(0)} x2={x(0)} y1={20} y2={300}/><line className="control-plot-axis" x1={20} x2={460} y1={y(0)} y2={y(0)}/>{locus.map((value, index) => <circle key={`locus-${index}`} className="control-locus-point" cx={x(value.real)} cy={y(value.imag)} r={2.5}/>)}{zeros.map((value, index) => <circle key={`zero-${index}`} className="control-zero" cx={x(value.real)} cy={y(value.imag)} r={5}/>)}{poles.map((value, index) => <path key={`pole-${index}`} className="control-pole" d={`M${x(value.real) - 5},${y(value.imag) - 5}l10,10m-10,0l10,-10`}/>)}</svg><div className="control-axis-labels"><span>허수부 {formatNumber(yMin)}</span><span>하단</span></div><div className="control-axis-labels"><span>실수부 {formatNumber(xMin)}</span><span>실수부 {formatNumber(xMax)}</span></div><div className="control-plot-legend"><span>× {locus.length ? 'K = 0 극점' : '상태 극점'}</span><span>○ 전달 영점</span>{locus.length > 0 && <span>● K 표본의 폐루프 극점</span>}</div></figure>;
}
