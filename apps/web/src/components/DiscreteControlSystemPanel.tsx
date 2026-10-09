import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINE_VERSION, ModelError, type CalcModel } from '../../../../packages/model/src';
import type { ComplexValue, ControlAnalysisSpec } from '../../../../packages/analysis/src/control-system';
import type { DiscreteControlAnalysisReport } from '../../../../packages/analysis/src/discrete-control-system';
import { discreteControlAnalysisSources, type DiscreteControlAnalysisSource } from '../discrete-control-analysis-sources';
import { BodeGraph, ComplexPlane } from './ControlSystemPanel';
import { formatNumber } from './ResultPlot';
import './DiscreteControlSystemPanel.css';

export interface DiscreteControlSystemPanelProps { model: CalcModel; busy: boolean; invalidDraft: boolean }
export type DiscreteControlDraft = { minimum: string; maximum: string; points: string; gainMaximum: string; gainPoints: string };
export interface CapturedDiscreteControlReport { source: DiscreteControlAnalysisSource; options: ControlAnalysisSpec; feedbackAssumptionAccepted: boolean; result: DiscreteControlAnalysisReport }
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numberDraft(value: string): number { return value.length <= 100 && DECIMAL.test(value.trim()) ? Number(value.trim()) : NaN; }
export function discreteControlDefaultDraft(sampleTime: number): DiscreteControlDraft {
  const maximum = Math.min(100, Math.PI / sampleTime), minimum = Math.max(1e-6, Math.min(.01, maximum / 10000));
  return { minimum: String(minimum), maximum: String(maximum), points: '201', gainMaximum: '10', gainPoints: '41' };
}
export function discreteControlDraftOptions(draft: DiscreteControlDraft, feedback: boolean, sampleTime: number): ControlAnalysisSpec {
  const frequencyMin = numberDraft(draft.minimum), frequencyMax = numberDraft(draft.maximum), frequencyPoints = numberDraft(draft.points), nyquist = Math.PI / sampleTime;
  if (!Number.isFinite(sampleTime) || sampleTime < 1e-9 || sampleTime > 1e9 || !Number.isFinite(frequencyMin) || !Number.isFinite(frequencyMax) || frequencyMin < 1e-6 || frequencyMax > Math.min(1e6, nyquist) || frequencyMin >= frequencyMax) throw new Error('주파수는 10⁻⁶ rad/s 이상, Nyquist와 10⁶ rad/s 이하에서 시작 < 종료로 지정하세요.');
  if (!Number.isSafeInteger(frequencyPoints) || frequencyPoints < 2 || frequencyPoints > 801) throw new Error('주파수 표본 수는 2~801의 정수여야 합니다.');
  let rootLocusGains: number[] = [];
  if (feedback) {
    const maximum = numberDraft(draft.gainMaximum), points = numberDraft(draft.gainPoints);
    if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 1e6 || !Number.isSafeInteger(points) || points < 2 || points > 81) throw new Error('근궤적 K의 최댓값은 0 초과~10⁶, 표본 수는 2~81의 정수여야 합니다.');
    rootLocusGains = Array.from({ length: points }, (_, index) => maximum * index / (points - 1));
  }
  return { frequencyMin, frequencyMax, frequencyPoints, rootLocusGains };
}
export function discreteControlReportExport(record: CapturedDiscreteControlReport): object {
  const { margins, rootLocus, ...result } = record.result;
  return structuredClone({ schemaVersion: 1, kind: 'discrete-siso-control-analysis', engineVersion: ENGINE_VERSION,
    source: record.source, options: record.options, feedbackAssumption: record.feedbackAssumptionAccepted ? 'unity-negative-feedback-open-loop' : null,
    result: record.feedbackAssumptionAccepted ? record.result : result,
  });
}
function downloadReport(record: CapturedDiscreteControlReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(discreteControlReportExport(record), null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-discrete-control-analysis.json'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function failureMessage(error: unknown): string { return error instanceof ModelError ? error.diagnostics.map(item => item.message).join(' · ') : error instanceof Error ? error.message : '이산 행렬과 샘플 주기·분석 범위를 확인해 주세요.'; }
export function DiscreteControlSystemPanel({ model, busy, invalidDraft }: DiscreteControlSystemPanelProps) {
  const available = useMemo(() => discreteControlAnalysisSources(model), [model]);
  const [sourceId, setSourceId] = useState(''), [feedback, setFeedback] = useState(false);
  const [draft, setDraft] = useState<DiscreteControlDraft>(() => discreteControlDefaultDraft(available.sources[0]?.system.sampleTime ?? .1));
  const [record, setRecord] = useState<CapturedDiscreteControlReport | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const activeSource = available.sources.find(source => source.id === sourceId) ?? available.sources[0];
  const sourceKey = activeSource ? `${activeSource.id}:${activeSource.semanticHash}` : '';
  const lastSourceKey = useRef(sourceKey);
  useEffect(() => {
    if (lastSourceKey.current === sourceKey) return;
    lastSourceKey.current = sourceKey; generation.current++; setPending(false); setRecord(null); setError('');
    setDraft(discreteControlDefaultDraft(activeSource?.system.sampleTime ?? .1));
  }, [sourceKey, activeSource]);
  const calculate = async () => {
    if (!activeSource || pending || busy || invalidDraft) return;
    const request = ++generation.current;
    setPending(true); setError('');
    try {
      const options = discreteControlDraftOptions(draft, feedback, activeSource.system.sampleTime), source = structuredClone(activeSource), accepted = feedback;
      setRecord(null);
      const api = await import('../../../../packages/analysis/src/discrete-control-system');
      if (!alive.current || generation.current !== request) return;
      const result = api.analyzeDiscreteSiso(source.system, options);
      if (alive.current && generation.current === request) setRecord({ source, options, feedbackAssumptionAccepted: accepted, result });
    } catch (caught) { if (alive.current && generation.current === request) setError(failureMessage(caught)); }
    finally { if (alive.current && generation.current === request) setPending(false); }
  };
  const change = (key: keyof DiscreteControlDraft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  return <div className="control-system-panel discrete-control-system-panel" data-testid="discrete-control-system-panel">
    <p className="field-help">이산 실수 SISO의 A/B/C/D와 샘플 주기 Ts로 주파수 응답과 극점·영점을 계산합니다. 상태 수는 1~4개이며, 모델과 실행 결과를 변경하지 않습니다.</p>
    {available.sources.length ? <><label className="field"><span className="field-label">분석할 이산 행렬 출처</span><select aria-label="이산 제어계 행렬 출처" value={activeSource?.id ?? ''} disabled={pending} onChange={event => { setSourceId(event.target.value); setError(''); }}>{available.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>{activeSource && <DiscreteSourceDescription source={activeSource}/>}</> : <p className="control-source-note">분석할 이산 행렬이 없습니다. 이산 실행 모델에 reset 없는 Discrete State-Space 블록을 추가하고 샘플 주기를 확인하세요.</p>}
    {available.issues.map((issue, index) => <p className="control-diagnostic" key={index}>{issue}</p>)}
    <div className="control-analysis-fields">
      <TextNumber label="주파수 시작 · rad/s" aria="이산 제어계 주파수 시작" value={draft.minimum} disabled={pending} onChange={value => change('minimum', value)}/>
      <TextNumber label="주파수 종료 · rad/s" aria="이산 제어계 주파수 종료" value={draft.maximum} disabled={pending} onChange={value => change('maximum', value)}/>
      <TextNumber label="주파수 표본 수" aria="이산 제어계 주파수 표본 수" value={draft.points} disabled={pending} onChange={value => change('points', value)}/>
    </div>
    <div className="control-feedback-assumption"><label><input type="checkbox" aria-label="이산 단위 음의 피드백 가정" checked={feedback} disabled={pending} onChange={event => setFeedback(event.target.checked)}/><span>선택 행렬을 개루프 L(z)로 두고 단위 음의 피드백 분석</span></label><p className="field-help">이 가정을 선택하면 이득·위상 여유와 1 + K L(z) = 0의 근궤적을 표시합니다. 다중 rate 연결이나 실제 도식의 폐루프를 자동 추론하지 않습니다.</p>
      {feedback && <div className="control-analysis-fields"><TextNumber label="근궤적 K 최댓값" aria="이산 근궤적 K 최댓값" value={draft.gainMaximum} disabled={pending} onChange={value => change('gainMaximum', value)}/><TextNumber label="근궤적 K 표본 수" aria="이산 근궤적 K 표본 수" value={draft.gainPoints} disabled={pending} onChange={value => change('gainPoints', value)}/></div>}
    </div>
    {invalidDraft && <p className="dialog-error">편집 중인 모델 입력값을 먼저 확인하세요.</p>}
    <div className="dialog-actions"><button className="button primary" disabled={pending || busy || invalidDraft || !activeSource} onClick={() => void calculate()}>{pending ? '이산 제어계 분석 중' : '이산 제어계 분석 실행'}</button>{record && <button className="button" onClick={() => downloadReport(record)}>이산 제어계 보고서 JSON</button>}</div>
    {pending && <p role="status">선택 이산 행렬의 주파수와 단위원 극점을 계산하고 있습니다.</p>}{error && <p className="dialog-error" role="alert">{error}</p>}
    {record && <DiscreteControlAnalysisSummary record={record}/>}
  </div>;
}
function TextNumber({ label, aria, value, disabled, onChange }: { label: string; aria: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><input type="text" inputMode="decimal" maxLength={100} aria-label={aria} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/></label>;
}
function DiscreteSourceDescription({ source }: { source: DiscreteControlAnalysisSource }) {
  return <div className="control-source-note"><p>{source.modelName} · {source.label}</p><p>샘플 주기 Ts = {String(source.system.sampleTime)} s · Nyquist = {String(Math.PI / source.system.sampleTime)} rad/s</p><p>기본 간격 {String(source.sampleTime.baseStep)} s × period {String(source.sampleTime.period)} · offset {String(source.sampleTime.offset)} tick</p>{source.assumptions.map((assumption, index) => <p key={index}>{assumption}</p>)}</div>;
}
function complexText(value: ComplexValue): string { return value.imag === 0 ? String(value.real) : `${String(value.real)} ${value.imag < 0 ? '−' : '+'} ${String(Math.abs(value.imag))}i`; }
function displayMargin(value: number | null, unit: string): string { return value === null ? '이 구간에서 확정하지 않음' : `${formatNumber(value)} ${unit}`; }
function stabilityText(value: DiscreteControlAnalysisReport['stability']): string { return value === 'stable' ? '안정 · 모든 |z| < 1' : value === 'unstable' ? '불안정 · |z| > 1인 극점' : '단위원 근방 · 수치 확인 필요'; }
export function DiscreteControlAnalysisSummary({ record }: { record: CapturedDiscreteControlReport }) {
  const { result: report, source, feedbackAssumptionAccepted } = record;
  return <section className="control-result" aria-label="이산 제어계 분석 결과"><h3>{source.label} · {report.stateOrder}상태 이산 SISO</h3><DiscreteSourceDescription source={source}/>
    <dl className="control-result-metrics"><div><dt>상태 극점 · 단위원 기준</dt><dd>{stabilityText(report.stability)}</dd></div><div><dt>샘플 주기 Ts · s</dt><dd>{String(report.sampleTime)}</dd></div><div><dt>Nyquist · rad/s</dt><dd>{String(report.nyquistOmega)}</dd></div><div><dt>주파수 구간 · rad/s</dt><dd>{formatNumber(report.frequencyRange.minimum)} ~ {formatNumber(report.frequencyRange.maximum)}</dd></div></dl>
    <p className="field-help">z = exp(jωTs)에서 평가하며, ω는 rad/s입니다. 극점·영점의 z 좌표와 |z|는 무차원입니다. 단위원 경계는 안정으로 확정하지 않습니다.</p>
    {report.diagnostics.map((diagnostic, index) => <p className="control-diagnostic" key={index}>{diagnostic}</p>)}
    {report.zeroTransfer && <p className="control-diagnostic">선택한 입력에서 출력으로의 전달함수는 0입니다. 상태의 극점과 전달 영점의 의미를 구분해 확인하세요.</p>}
    <h4>이산 주파수 응답</h4><BodeGraph points={report.bode.map(point => ({ x: point.omega, y: point.gainDb }))} label="이산 Bode 크기" unit="dB"/><BodeGraph points={report.bode.map(point => ({ x: point.omega, y: point.phaseDegrees }))} label="이산 Bode 위상" unit="°"/>
    {report.bode.some(point => point.status !== 'finite') && <p className="control-diagnostic">0 응답·특이점·표현할 수 없는 값은 그래프에 빈 구간으로 표시합니다. 해당 주파수의 상태는 원시 주파수 표에서 확인할 수 있습니다.</p>}
    <details className="control-details"><summary>이산 원시 주파수 표 · {report.bode.length}개</summary><div className="control-table-scroll"><table aria-label="이산 제어계 원시 주파수 응답"><thead><tr><th>ω · rad/s</th><th>실수부</th><th>허수부</th><th>크기 · dB</th><th>위상 · °</th><th>상태</th></tr></thead><tbody>{report.bode.map(point => <tr key={point.omega}><td>{String(point.omega)}</td><td>{point.real === null ? '—' : String(point.real)}</td><td>{point.imag === null ? '—' : String(point.imag)}</td><td>{point.gainDb === null ? '—' : String(point.gainDb)}</td><td>{point.phaseDegrees === null ? '—' : String(point.phaseDegrees)}</td><td>{point.status}</td></tr>)}</tbody></table></div></details>
    <h4>이산 극점·영점</h4><ComplexPlane poles={report.poles} zeros={report.zeros} label="이산 상태 극점과 전달 영점" domain="discrete"/>
    <div className="control-table-scroll"><table aria-label="이산 제어계 극점 영점"><thead><tr><th>종류</th><th>복소 z 위치</th><th>|z|</th></tr></thead><tbody>{report.poles.map((value, index) => <tr key={`pole-${index}`}><th>상태 극점 {index + 1}</th><td>{complexText(value)}</td><td>{String(Math.hypot(value.real, value.imag))}</td></tr>)}{report.zeros.map((value, index) => <tr key={`zero-${index}`}><th>전달 영점 {index + 1}</th><td>{complexText(value)}</td><td>{String(Math.hypot(value.real, value.imag))}</td></tr>)}{!report.zeros.length && <tr><th>전달 영점</th><td colSpan={2}>{report.zeroTransfer ? '0 전달함수에서는 정의하지 않음' : '유한 영점 없음'}</td></tr>}</tbody></table></div>
    {feedbackAssumptionAccepted && <><h4>이산 단위 음의 피드백 가정의 여유</h4><p className="field-help">선택 행렬을 개루프 L(z)로 두었습니다. 아래 여유는 선택한 주파수 구간에서 확인한 교차에 대한 값입니다.</p><dl className="control-result-metrics"><div><dt>이득 여유</dt><dd>{displayMargin(report.margins.gainMarginDb, 'dB')}</dd></div><div><dt>위상 여유</dt><dd>{displayMargin(report.margins.phaseMarginDegrees, '°')}</dd></div></dl>
      <p className="control-diagnostic">{report.margins.status === 'incomplete' ? '특이점 또는 불완전한 구간 때문에 여유 판정을 보류합니다.' : report.margins.status === 'no-crossing-in-range' ? '이 주파수 구간에서 교차를 찾지 못했습니다. 무한 여유나 전체 안정성을 의미하지 않습니다.' : '찾은 교차를 아래 표에서 확인하세요.'}</p>
      {report.margins.diagnostics.map((diagnostic, index) => <p className="control-diagnostic" key={index}>{diagnostic}</p>)}
      <details className="control-details"><summary>이산 여유의 교차 표</summary><div className="control-table-scroll"><table aria-label="이산 제어계 여유 교차"><thead><tr><th>교차</th><th>ω · rad/s</th><th>여유</th></tr></thead><tbody>{report.margins.gainCrossovers.map((point, index) => <tr key={`gain-${index}`}><th>0 dB</th><td>{String(point.omega)}</td><td>{String(point.phaseMarginDegrees)} °</td></tr>)}{report.margins.phaseCrossovers.map((point, index) => <tr key={`phase-${index}`}><th>−180°</th><td>{String(point.omega)}</td><td>{String(point.gainMarginDb)} dB</td></tr>)}{!report.margins.gainCrossovers.length && !report.margins.phaseCrossovers.length && <tr><td colSpan={3}>선택 구간에서 확인한 교차 없음</td></tr>}</tbody></table></div></details>
      <details className="control-details"><summary>이산 근궤적 · 1 + K L(z) = 0</summary><p className="field-help">지정한 K마다 폐루프 특성식의 극점을 계산합니다. 점 사이 경로를 보간하지 않습니다.</p><ComplexPlane poles={report.rootLocus.find(point => point.gain === 0)?.poles ?? report.poles} zeros={report.zeros} locus={report.rootLocus.filter(point => point.status === 'completed').flatMap(point => point.poles)} label="이산 K 표본별 폐루프 극점" domain="discrete"/>
        <div className="control-table-scroll"><table aria-label="이산 제어계 근궤적 원시 표"><thead><tr><th>K</th><th>폐루프 극점</th><th>상태</th></tr></thead><tbody>{report.rootLocus.map(point => <tr key={point.gain}><td>{String(point.gain)}</td><td>{point.status === 'completed' ? point.poles.map(complexText).join(' ; ') : '계산을 확정하지 않음'}</td><td>{point.status}{point.diagnostics.length > 0 && ` · ${point.diagnostics.join(' · ')}`}</td></tr>)}</tbody></table></div></details>
    </>}
    <details className="control-details"><summary>이산 분석 행렬과 전달함수 계수</summary><p className="field-help">z의 내림차순 계수입니다. 현재 선택한 상태 표현을 기준으로 계산하며, 연속계로 변환하지 않습니다.</p><p className="control-polynomial">분자: {JSON.stringify(report.numerator)}<br/>분모: {JSON.stringify(report.denominator)}</p><div className="control-table-scroll"><table aria-label="이산 제어계 분석 행렬"><tbody>{(['A', 'B', 'C', 'D'] as const).map(name => <tr key={name}><th>{name}</th><td className="control-polynomial">{JSON.stringify(report.stateSpace[name])}</td></tr>)}</tbody></table></div></details>
  </section>;
}
