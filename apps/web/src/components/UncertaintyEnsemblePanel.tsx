import { useEffect, useState } from 'react';
import { ENGINE_VERSION, ModelError, type CalcModel, type SignalDescriptor } from '../../../../packages/model/src';
import { ENSEMBLE_LIMITS, type EnsemblePoint, type EnsembleResult, type EnsembleSpec } from '../../../../packages/experiments/src/uncertainty';
import type { MultiSweepRecord } from '../../../../packages/experiments/src/multivariable';
import { outputLabels } from '../output-labels';
import { formatNumber } from './ResultPlot';
import './UncertaintyEnsemblePanel.css';

export interface UncertaintyEnsembleProps {
  model: CalcModel;
  outputTypes: Record<string, SignalDescriptor>;
  busy: boolean;
  notice: (message: string) => void;
  onCancelSweep: () => void;
  onEnsemble?: (spec: EnsembleSpec) => Promise<void>;
  ensembleResult?: EnsembleResult | null;
  ensembleModelCurrent?: boolean;
  ensembleProgress?: { completed: number; total: number; attempted?: number; failed?: number; cancelled?: number };
  onApplyEnsemble?: (record: MultiSweepRecord) => void;
}
export interface EnsembleParameterDraft { nodeId: string; kind: 'uniform' | 'triangular'; lower: string; upper: string; mode: string }
export interface EnsembleSettingsDraft { seed: string; sampleCount: string; outputId: string; unit: string }
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER = /^(?:0|[1-9]\d*)$/;
const PAGE_SIZE = 128, GRAPH_POINTS = 512;
function parameterName(node: CalcModel['nodes'][number]): 'gain' | 'value' { return node.blockType === 'math.gain' ? 'gain' : 'value'; }
export function ensembleTargets(model: CalcModel) {
  return model.nodes.filter(node => ['source.constant', 'io.input', 'math.gain'].includes(node.blockType)
    && typeof node.parameters[parameterName(node)] === 'number' && Number.isFinite(node.parameters[parameterName(node)])
    && Math.abs(Number(node.parameters[parameterName(node)])) <= ENSEMBLE_LIMITS.maxParameterMagnitude);
}
export function ensembleOutputIds(outputTypes: Record<string, SignalDescriptor>): string[] {
  return Object.keys(outputTypes).filter(id => outputTypes[id].valueType === 'float64' && outputTypes[id].shape.length === 0 && outputTypes[id].representation === undefined);
}
function newDraft(node?: CalcModel['nodes'][number]): EnsembleParameterDraft {
  const value = node ? Number(node.parameters[parameterName(node)]) : 1, radius = Math.max(1, Math.abs(value));
  return { nodeId: node?.id ?? '', kind: 'uniform', lower: String(Math.max(-ENSEMBLE_LIMITS.maxParameterMagnitude, value - radius)), upper: String(Math.min(ENSEMBLE_LIMITS.maxParameterMagnitude, value + radius)), mode: String(value) };
}
function numericDraft(raw: string, integer = false): number {
  if (typeof raw !== 'string' || raw.length > 100 || !(integer ? INTEGER : DECIMAL).test(raw.trim())) return NaN;
  return Number(raw.trim());
}
/** UI drafts are validated without implicit empty/hex coercion; the worker validates the captured spec again. */
export function ensembleDraftSpec(model: CalcModel, outputTypes: Record<string, SignalDescriptor>, drafts: EnsembleParameterDraft[], settings: EnsembleSettingsDraft): { spec?: EnsembleSpec; error: string } {
  const invalid = (error: string) => ({ error });
  if (!drafts.length || drafts.length > ENSEMBLE_LIMITS.maxParameters) return invalid('서로 다른 1~3개의 숫자 블록을 선택하세요.');
  const targets = ensembleTargets(model);
  if (new Set(drafts.map(draft => draft.nodeId)).size !== drafts.length) return invalid('같은 블록을 두 번 선택할 수 없습니다.');
  const parameters: EnsembleSpec['parameters'] = [];
  for (const draft of drafts) {
    const node = targets.find(item => item.id === draft.nodeId);
    if (!node) return invalid('유한한 스칼라 Constant·Input 값 또는 Gain 배율을 선택하세요.');
    const lower = numericDraft(draft.lower), upper = numericDraft(draft.upper), mode = numericDraft(draft.mode);
    if (![lower, upper].every(value => Number.isFinite(value) && Math.abs(value) <= ENSEMBLE_LIMITS.maxParameterMagnitude) || lower >= upper) return invalid('하한 < 상한이며 절댓값 10¹² 이하인 유한한 숫자를 입력하세요.');
    if (draft.kind === 'uniform') parameters.push({ nodeId: node.id, parameter: parameterName(node), distribution: { kind: 'uniform', lower, upper } });
    else if (draft.kind === 'triangular' && Number.isFinite(mode) && mode >= lower && mode <= upper) parameters.push({ nodeId: node.id, parameter: parameterName(node), distribution: { kind: 'triangular', lower, mode, upper } });
    else return invalid('삼각 분포의 최빈값은 하한~상한 안의 유한한 숫자여야 합니다.');
  }
  const seed = numericDraft(settings.seed, true), sampleCount = numericDraft(settings.sampleCount, true);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) return invalid('seed는 0~4,294,967,295의 십진 정수여야 합니다.');
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 2 || sampleCount > ENSEMBLE_LIMITS.maxSamples) return invalid('표본 수는 2~64의 십진 정수여야 합니다.');
  if (!ensembleOutputIds(outputTypes).includes(settings.outputId)) return invalid('legacy float64 스칼라 출력을 선택하세요. Typed·벡터·bus 출력은 자동 변환하지 않습니다.');
  if (typeof settings.unit !== 'string' || settings.unit.length > 160 || settings.unit !== outputTypes[settings.outputId].unit) return invalid('출력 단위를 선택한 출력의 단위와 정확히 맞추세요.');
  return { spec: { parameters, seed, sampleCount, outputId: settings.outputId, unit: settings.unit }, error: '' };
}
export function ensembleReportExport(result: EnsembleResult) {
  return structuredClone({ schemaVersion: 1, kind: 'uncertainty-ensemble', engineVersion: ENGINE_VERSION, result });
}
function downloadReport(result: EnsembleResult) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(ensembleReportExport(result), null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'calcweave-uncertainty-ensemble.json'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function errorText(error: unknown): string { return error instanceof ModelError ? error.diagnostics[0]?.message ?? error.message : error instanceof Error ? error.message : '앙상블 설정을 확인하세요.'; }
function statusLabel(status: string): string { return ({ completed: '완료', failed: '실패', cancelled: '취소', 'not-started': '미실행', unavailable: '통계 없음' } as Record<string, string>)[status] ?? status; }
export function UncertaintyEnsemblePanel(props: UncertaintyEnsembleProps) {
  const { model, outputTypes, busy, notice, onEnsemble, ensembleResult, ensembleProgress, onCancelSweep } = props;
  const [drafts, setDrafts] = useState<EnsembleParameterDraft[]>(() => [newDraft(ensembleTargets(model)[0])]);
  const [seed, setSeed] = useState('1'), [sampleCount, setSampleCount] = useState('16'), [outputId, setOutputId] = useState(''), [unit, setUnit] = useState<string | null>(null), [error, setError] = useState('');
  const outputs = ensembleOutputIds(outputTypes), activeOutput = outputs.includes(outputId) ? outputId : outputs[0] ?? '', activeUnit = unit ?? outputTypes[activeOutput]?.unit ?? '1', labels = outputLabels(model);
  useEffect(() => { setDrafts([newDraft(ensembleTargets(model)[0])]); setOutputId(''); setUnit(null); setError(''); }, [model.modelId]);
  const prepared = ensembleDraftSpec(model, outputTypes, drafts, { seed, sampleCount, outputId: activeOutput, unit: activeUnit });
  const change = (index: number, patch: Partial<EnsembleParameterDraft>) => setDrafts(drafts.map((draft, position) => position === index ? { ...draft, ...patch } : draft));
  const start = async () => {
    if (!prepared.spec) { setError(prepared.error); notice(prepared.error); return; }
    setError(''); try { await onEnsemble?.(prepared.spec); } catch (caught) { setError(errorText(caught)); }
  };
  return <details className="tool-section ensemble-section" data-testid="ensemble-section"><summary><span>불확실성 앙상블</span><small>seed 재현 · 최대 64개 표본</small></summary><div className="ensemble-content">
    <p className="ensemble-intro">선택한 파라미터의 독립 균등·삼각 분포에서 표본을 뽑아 같은 도식을 반복 실행합니다. 같은 모델·설정·seed의 표본 순서는 같습니다. 이 seed는 계수 표본에만 쓰며 모델 안의 난수 블록 seed는 바꾸지 않습니다.</p>
    <p className="field-help">실험 중에는 대시보드 실시간 값을 변경할 수 없습니다. 예약된 이벤트는 모델 설정대로 실행합니다.</p>
    <div className="ensemble-parameters">{drafts.map((draft, index) => <div className="ensemble-parameter" key={index}>
      <label className="field"><span className="field-label">{index + 1} · 숫자 블록</span><select aria-label={`앙상블 블록 ${index + 1}`} value={draft.nodeId} disabled={busy} onChange={event => change(index, newDraft(ensembleTargets(model).find(node => node.id === event.target.value)))}><option value="">블록 선택</option>{ensembleTargets(model).map(node => <option key={node.id} value={node.id}>{node.label} · {parameterName(node) === 'gain' ? '배율' : '값'}</option>)}</select></label>
      <label className="field"><span className="field-label">분포</span><select aria-label={`앙상블 분포 ${index + 1}`} value={draft.kind} disabled={busy} onChange={event => change(index, { kind: event.target.value as EnsembleParameterDraft['kind'] })}><option value="uniform">균등 분포</option><option value="triangular">삼각 분포</option></select></label>
      <div className="ensemble-bounds">{(['lower', 'upper', ...(draft.kind === 'triangular' ? ['mode'] as const : [])] as const).map(key => <TextField key={key} label={key === 'lower' ? '하한' : key === 'upper' ? '상한' : '최빈값'} aria={`앙상블 ${key === 'lower' ? '하한' : key === 'upper' ? '상한' : '최빈값'} ${index + 1}`} value={draft[key]} disabled={busy} onChange={value => change(index, { [key]: value })}/>)}</div>
      <button className="button ensemble-remove" aria-label={`앙상블 파라미터 ${index + 1} 삭제`} disabled={busy || drafts.length === 1} onClick={() => setDrafts(drafts.filter((_, position) => position !== index))}>삭제</button>
    </div>)}<button className="button ensemble-add" disabled={busy || drafts.length >= ENSEMBLE_LIMITS.maxParameters || ensembleTargets(model).length <= drafts.length} onClick={() => setDrafts([...drafts, newDraft(ensembleTargets(model).find(node => !drafts.some(draft => draft.nodeId === node.id)))])}>앙상블 파라미터 추가</button></div>
    {!ensembleTargets(model).length && <p className="field-help">유한한 스칼라 Constant·Input·Gain 블록을 도식에 추가하세요.</p>}
    <div className="ensemble-fields"><TextField label="seed · uint32" aria="앙상블 seed" value={seed} disabled={busy} integer onChange={setSeed}/><TextField label="표본 수 · 2~64" aria="앙상블 표본 수" value={sampleCount} disabled={busy} integer onChange={setSampleCount}/>
      <label className="field"><span className="field-label">통계를 낼 스칼라 출력</span><select aria-label="앙상블 출력" value={activeOutput} disabled={busy} onChange={event => { setOutputId(event.target.value); setUnit(null); }}><option value="">출력 선택</option>{outputs.map(id => <option key={id} value={id}>{labels[id] ?? id} · {outputTypes[id].unit}</option>)}</select></label>
      <TextField label="출력 단위 · 선택한 출력과 같아야 함" aria="앙상블 출력 단위" value={activeUnit} disabled={busy} maxLength={160} onChange={setUnit}/>
    </div>
    {prepared.error && <p className="field-help">{prepared.error}</p>}{error && <p className="tool-error" role="alert">{error}</p>}
    <div className="tool-actions"><button className="button primary" disabled={busy || !onEnsemble || !prepared.spec} onClick={() => void start()}>앙상블 실행</button>{busy && ensembleProgress && <button className="button" onClick={onCancelSweep}>앙상블 취소</button>}{ensembleProgress && <span role="status">{ensembleProgress.completed} / {ensembleProgress.total} 완료 · 시도 {ensembleProgress.attempted ?? ensembleProgress.completed} · 실패 {ensembleProgress.failed ?? 0} · 취소 {ensembleProgress.cancelled ?? 0}</span>}</div>
    <p className="field-help">전체 표본에 30초·100만 기록 원소·5천만 연산 한도를 공유하며 후보 모델 스냅샷은 합계 32 MiB 이내로 제한합니다. 취소·시간 초과 때는 완료한 실행 기록이 있어도 집계 통계를 제공하지 않을 수 있습니다. 도식은 실행만으로 바뀌지 않으며, 완료한 표본의 모델은 적용 버튼으로 선택합니다. 보고서는 새로고침 전까지 유지되므로 JSON으로 내려받으세요.</p>
    {ensembleResult && <EnsembleAnalysisSummary result={ensembleResult} busy={busy} current={props.ensembleModelCurrent} onApply={props.onApplyEnsemble}/>}
  </div></details>;
}
function TextField({ label, aria, value, disabled, integer = false, maxLength = 100, onChange }: { label: string; aria: string; value: string; disabled: boolean; integer?: boolean; maxLength?: number; onChange: (value: string) => void }) {
  return <label className="field"><span className="field-label">{label}</span><input type="text" inputMode={maxLength === 160 ? 'text' : integer ? 'numeric' : 'decimal'} maxLength={maxLength} aria-label={aria} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/></label>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
export function EnsembleAnalysisSummary({ result, busy = false, current = false, onApply }: { result: EnsembleResult; busy?: boolean; current?: boolean; onApply?: (record: MultiSweepRecord) => void }) {
  const [page, setPage] = useState(0); useEffect(() => setPage(0), [result]);
  const { counts, statistics } = result, labels = outputLabels(result.baseModel), pages = Math.max(1, Math.ceil(statistics.points.length / PAGE_SIZE)), safePage = Math.min(page, pages - 1), rows = statistics.points.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  return <section className="ensemble-report" aria-label="불확실성 앙상블 결과"><h4>{result.baseModel.name} · {statusLabel(result.status)}</h4>
    <p className="field-help">출력 {labels[result.spec.outputId] ?? result.spec.outputId} · {result.spec.unit} · 실행에 사용한 seed {result.spec.seed} · {result.spec.sampleCount}개 표본</p>
    {!current && <p className="field-help ensemble-stale">이전 모델의 앙상블입니다. 현재 도식에서 다시 실행하면 완료한 표본을 적용할 수 있습니다.</p>}
    <dl className="ensemble-metrics"><Metric label="요청" value={String(counts.requested)}/><Metric label="시도" value={String(counts.attempted)}/><Metric label="완료" value={String(counts.completed)}/><Metric label="실패" value={String(counts.failed)}/><Metric label="취소" value={String(counts.cancelled)}/><Metric label="미실행" value={String(counts.notStarted)}/></dl>
    {result.diagnostics.map((diagnostic, index) => <p className="tool-error" role="alert" key={index}>{diagnostic.code} · {diagnostic.message}</p>)}
    <p className="field-help">집계 상태: {statusLabel(statistics.status)}. 취소·시간 초과 때는 완료한 실행 기록이 있어도 집계 통계를 제공하지 않을 수 있습니다.</p>
    <p className="field-help">통계에는 완료한 표본 {statistics.recordIds.length}개만 포함합니다. 실패·취소·미실행 표본은 아래 표에 그대로 남으며 통계에서 제외됩니다. 실패한 표본이 제외되어 통계가 편향될 수 있습니다. 분위수는 유한 표본의 5%·50%·95% 값이며 신뢰구간이나 모집단의 확률·성공 보장이 아닙니다.</p>
    <p className="field-help">표준편차는 n−1로 나눈 표본 표준편차입니다. 완료한 표본이 하나면 표준편차는 정의하지 않아 —로 표시합니다. 분위수는 정렬한 표본의 (n−1)p 위치에서 선형 보간합니다.</p>
    {statistics.diagnostics.map((diagnostic, index) => <p className="tool-error" key={index}>{diagnostic.code} · {diagnostic.message}</p>)}
    <EnsembleEnvelopeGraph points={statistics.points} unit={statistics.unit}/>
    <details className="ensemble-details"><summary>모든 표본 · {result.records.length}개</summary><div className="ensemble-table-scroll"><table aria-label="앙상블 표본별 결과"><thead><tr><th>표본</th><th>파라미터</th><th>마지막 출력</th><th>상태·진단</th><th>모델</th></tr></thead><tbody>{result.records.map((record, index) => {
      const value = record.run?.result.samples.at(-1)?.values[result.spec.outputId];
      return <tr key={record.id}><td>{index + 1}</td><td>{record.parameters.map(parameter => <span className="ensemble-parameter-value" key={`${parameter.nodeId}-${parameter.parameter}`}>{result.baseModel.nodes.find(node => node.id === parameter.nodeId)?.label ?? parameter.nodeId}: {formatNumber(parameter.value)}</span>)}</td><td>{typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value)} ${result.spec.unit}` : '—'}</td><td>{statusLabel(record.status)}{record.diagnostics.map((diagnostic, position) => <span className="ensemble-diagnostic" key={position}>{diagnostic.code} · {diagnostic.message}</span>)}</td><td><button className="button" aria-label={`앙상블 표본 ${index + 1} 모델 적용`} disabled={busy || !current || !onApply || record.status !== 'completed' || !record.run} onClick={() => { if (record.status === 'completed' && record.run) onApply?.(record.run); }}>이 표본 적용</button></td></tr>;
    })}</tbody></table></div></details>
    <details className="ensemble-details"><summary>원시 통계 표 · {statistics.points.length}개 시각</summary><div className="ensemble-pagination"><button className="button" aria-label="앙상블 통계 표 이전 페이지" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>이전</button><span role="status">{safePage + 1} / {pages} 페이지 · {rows.length ? `${safePage * PAGE_SIZE + 1}~${safePage * PAGE_SIZE + rows.length}` : '0개'}</span><button className="button" aria-label="앙상블 통계 표 다음 페이지" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>다음</button></div><div className="ensemble-table-scroll"><table aria-label="앙상블 원시 통계"><thead><tr><th>시각 · s</th><th>완료 n</th><th>평균</th><th>표본 표준편차</th><th>최소</th><th>q05</th><th>중앙값</th><th>q95</th><th>최대</th></tr></thead><tbody>{rows.map((point, index) => <tr key={index}><td>{String(point.time)}</td><td>{point.count}</td><td>{String(point.mean)}</td><td>{point.standardDeviation === null ? '—' : String(point.standardDeviation)}</td><td>{String(point.minimum)}</td><td>{String(point.q05)}</td><td>{String(point.median)}</td><td>{String(point.q95)}</td><td>{String(point.maximum)}</td></tr>)}</tbody></table></div></details>
    <details className="ensemble-details"><summary>실행 설정과 출처</summary><dl className="ensemble-provenance"><Metric label="모델 ID" value={result.baseModel.modelId}/><Metric label="모델 의미 해시 · SHA-256" value={result.baseSemanticHash}/><Metric label="PRNG" value={result.prng.algorithm}/><Metric label="표본 순서" value={result.prng.drawOrder}/><Metric label="uniform 정의" value={result.prng.uniform}/><Metric label="표준편차 규약" value={statistics.standardDeviationConvention}/><Metric label="분위수 규약" value={statistics.quantileConvention}/></dl>{result.spec.parameters.map(parameter => <p className="field-help" key={`${parameter.nodeId}-${parameter.parameter}`}>{result.baseModel.nodes.find(node => node.id === parameter.nodeId)?.label ?? parameter.nodeId} · {parameter.parameter} · {parameter.distribution.kind === 'uniform' ? '균등' : '삼각'} · [{String(parameter.distribution.lower)}, {String(parameter.distribution.upper)}]{parameter.distribution.kind === 'triangular' ? ` · 최빈값 ${String(parameter.distribution.mode)}` : ''}</p>)}</details>
    <dl className="ensemble-metrics"><Metric label="연산 사용량 / 전체 상한" value={`${result.resources.operations.toLocaleString()} / ${ENSEMBLE_LIMITS.maxOperations.toLocaleString()}`}/><Metric label="기록 원소 사용량 / 전체 상한" value={`${result.resources.recordedValues.toLocaleString()} / ${ENSEMBLE_LIMITS.maxRecordedValues.toLocaleString()}`}/><Metric label="시간 사용량 / 전체 상한" value={`${formatNumber(result.resources.wallMs)} / ${ENSEMBLE_LIMITS.maxWallMs.toLocaleString()} ms`}/></dl>
    <p className="field-help">연산·기록 사용량은 검증하여 수신한 실행 결과의 보고량입니다. 응답 없이 중단한 실행의 미보고 사용량이 0이라는 뜻은 아닙니다.</p>
    <button className="button" onClick={() => downloadReport(result)}>앙상블 보고서 JSON</button>
  </section>;
}
/** Use exact recorded times on a linear axis; a bounded display selection leaves full raw data in the table/export. */
export function EnsembleEnvelopeGraph({ points, unit }: { points: EnsemblePoint[]; unit: string }) {
  if (!points.length) return <p className="field-help">동일한 원시 시간축에서 완료한 표본의 통계가 없어 그래프를 표시하지 않습니다.</p>;
  const selected = points.length <= GRAPH_POINTS ? points : Array.from({ length: GRAPH_POINTS }, (_, index) => points[Math.floor(index * (points.length - 1) / (GRAPH_POINTS - 1))]);
  let scale = 1, minimum = Infinity, maximum = -Infinity;
  for (const point of selected) for (const value of [point.q05, point.q95, point.median, point.mean]) scale = Math.max(scale, Math.abs(value));
  for (const point of selected) for (const value of [point.q05, point.q95, point.median, point.mean]) { minimum = Math.min(minimum, value / scale); maximum = Math.max(maximum, value / scale); }
  if (maximum === minimum) { minimum = Math.max(-1, minimum - .5); maximum = Math.min(1, maximum + .5); }
  const start = points[0].time, end = points.at(-1)!.time, x = (time: number) => 18 + (end === start ? .5 : (time - start) / (end - start)) * 604, y = (value: number) => 220 - ((value / scale - minimum) / (maximum - minimum)) * 202;
  const path = (key: 'mean' | 'median') => selected.map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(3)},${y(point[key]).toFixed(3)}`).join(' ');
  const envelope = [...selected.map(point => `${x(point.time).toFixed(3)},${y(point.q05).toFixed(3)}`), ...selected.slice().reverse().map(point => `${x(point.time).toFixed(3)},${y(point.q95).toFixed(3)}`)].join(' ');
  return <figure className="ensemble-plot"><figcaption>완료한 표본의 q05~q95 범위·중앙값·평균 · {unit}</figcaption><div className="ensemble-axis-labels"><span>{formatNumber(Math.min(Number.MAX_VALUE, maximum * scale))} {unit}</span><span>상단</span></div><svg viewBox="0 0 640 240" role="img" aria-label="앙상블 분위수와 평균 그래프" data-point-count={points.length} data-rendered-point-count={selected.length}><title>앙상블 분위수와 평균 · 실제 기록 시각</title>{[0, 1, 2, 3, 4].map(index => <g key={index}><line className="ensemble-grid" x1="18" x2="622" y1={18 + index * 50.5} y2={18 + index * 50.5}/><line className="ensemble-grid" x1={18 + index * 151} x2={18 + index * 151} y1="18" y2="220"/></g>)}<polygon className="ensemble-envelope" points={envelope}/><path className="ensemble-median" d={path('median')}/><path className="ensemble-mean" d={path('mean')}/>{selected.length === 1 && <><line className="ensemble-band-point" x1={x(selected[0].time)} x2={x(selected[0].time)} y1={y(selected[0].q05)} y2={y(selected[0].q95)}/><circle className="ensemble-median-point" cx={x(selected[0].time)} cy={y(selected[0].median)} r="3"/><circle className="ensemble-mean-point" cx={x(selected[0].time)} cy={y(selected[0].mean)} r="3"/></>}</svg><div className="ensemble-axis-labels"><span>{formatNumber(start)} s</span><span>{formatNumber(end)} s</span></div><div className="ensemble-legend"><span className="ensemble-envelope-key">q05~q95 표본 범위</span><span className="ensemble-median-key">중앙값</span><span className="ensemble-mean-key">평균</span></div><p className="field-help">가로축은 실제 기록 시각의 선형 s 축입니다. 표본 분위수 범위는 신뢰구간이 아닙니다.{points.length > GRAPH_POINTS ? ` 그래프에는 ${points.length}개 시각 중 처음·마지막을 포함한 ${GRAPH_POINTS}개 시각을 균등 선택해 표시합니다. 전체 값은 원시 통계 표와 JSON에서 확인하세요.` : ''}</p></figure>;
}
