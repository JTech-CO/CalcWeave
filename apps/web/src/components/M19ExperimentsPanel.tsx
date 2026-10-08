import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ModelError, UNITS, type CalcModel, type SignalDescriptor } from '../../../../packages/model/src';
import { importDataset, inspectDatasetInput, safeCsvCell } from '../../../../packages/data/src';
import type { FitResult, FitSpec, MultiSweepRecord, MultiSweepResult, MultiSweepSpec } from '../../../../packages/experiments/src/multivariable';
import { outputLabels } from '../output-labels';
import { ScopePlot } from './ScopePlot';
import { formatNumber } from './ResultPlot';
import './M19ExperimentsPanel.css';

export interface M19ExperimentsProps {
  model: CalcModel;
  outputTypes: Record<string, SignalDescriptor>;
  busy: boolean;
  notice: (message: string) => void;
  onCancelSweep: () => void;
  onMultiSweep?: (spec: MultiSweepSpec) => Promise<void>;
  onFit?: (spec: FitSpec) => Promise<void>;
  multiSweepResult?: MultiSweepResult | null;
  fitResult?: FitResult | null;
  multiSweepSpec?: MultiSweepSpec;
  fitSpec?: FitSpec;
  experimentProgress?: { completed: number; total: number };
  multiSweepModelCurrent?: boolean;
  fitModelCurrent?: boolean;
  onApplyGrid?: (record: MultiSweepRecord) => void;
  onApplyFit?: () => void;
}
type ParameterDraft = { nodeId: string; values: string; lower: string; upper: string; initial: string };
const CSV_LIMIT = 256 * 1024;
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numericDraft(value: string): number {
  if (!NUMERIC.test(value.trim())) return NaN;
  return Number(value.trim());
}
function parameterName(node: CalcModel['nodes'][number]): 'gain' | 'value' { return node.blockType === 'math.gain' ? 'gain' : 'value'; }
export function experimentTargets(model: CalcModel) {
  return model.nodes.filter(node => ['source.constant', 'io.input', 'math.gain'].includes(node.blockType)
    && typeof node.parameters[parameterName(node)] === 'number' && Number.isFinite(node.parameters[parameterName(node)]) && Math.abs(Number(node.parameters[parameterName(node)])) <= 1e12);
}
function newDraft(node?: CalcModel['nodes'][number]): ParameterDraft {
  const value = node ? Number(node.parameters[parameterName(node)]) : 1;
  const radius = Math.max(1, Math.abs(value));
  return { nodeId: node?.id ?? '', values: '0.5, 1, 2', lower: String(Math.max(-1e12, value - radius)), upper: String(Math.min(1e12, value + radius)), initial: String(value) };
}
export function gridDraftSpec(model: CalcModel, drafts: ParameterDraft[]): { spec?: MultiSweepSpec; count: number; error: string } {
  const targets = experimentTargets(model);
  if (!drafts.length || drafts.length > 3) return { count: 0, error: '1~3개의 숫자 파라미터를 선택하세요.' };
  const axes = drafts.map(draft => {
    const node = targets.find(item => item.id === draft.nodeId);
    const values = draft.values.split(',').map(numericDraft);
    return { nodeId: node?.id ?? '', parameter: node ? parameterName(node) : 'value', values };
  });
  const count = axes.reduce((product, axis) => product * axis.values.length, 1);
  if (axes.some(axis => !axis.nodeId || !axis.values.length || axis.values.length > 64 || axis.values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e12))) return { count, error: '블록을 선택하고 절댓값 10¹² 이하의 유한한 숫자를 쉼표로 입력하세요. 한 축에 최대 64개 값을 지정할 수 있습니다.' };
  if (new Set(axes.map(axis => axis.nodeId)).size !== axes.length) return { count, error: '같은 블록을 두 번 선택할 수 없습니다.' };
  if (axes.some(axis => new Set(axis.values).size !== axis.values.length)) return { count, error: '한 축의 실행 값이 중복되었습니다.' };
  if (count > 64) return { count, error: '전체 조합은 최대 64개입니다. 각 축의 값 개수를 줄이세요.' };
  return { spec: { axes }, count, error: '' };
}
/** Use the bounded data parser; measurement files remain local and never become executable content. */
export function parseMeasurementCsv(text: string, timeColumn: string, valueColumn: string, unit: string): FitSpec['measurements'] {
  if (text.length > CSV_LIMIT || new TextEncoder().encode(text).byteLength > CSV_LIMIT) throw new Error('측정 CSV는 256 KiB 이하여야 합니다.');
  const inspected = inspectDatasetInput(text, 'csv');
  if (inspected.rowCount > 1000) throw new Error('측정 데이터는 최대 1,000행입니다.');
  if (timeColumn === valueColumn || !inspected.columnNames.includes(timeColumn) || !inspected.columnNames.includes(valueColumn)) throw new Error('시간 열과 측정값 열을 서로 다르게 선택하세요.');
  const dataset = importDataset(text, {
    id: 'fit-measurements', name: '피팅 측정 데이터', format: 'csv', timeColumn,
    columns: inspected.columnNames.map(name => ({ name, kind: name === timeColumn || name === valueColumn ? 'number' : 'string', unit: name === timeColumn ? 's' : name === valueColumn ? unit : '1' })),
    missing: 'reject', duplicateTimes: 'reject', sortTime: false,
  });
  const timeIndex = dataset.columns.findIndex(column => column.name === timeColumn), valueIndex = dataset.columns.findIndex(column => column.name === valueColumn);
  const measurements = dataset.rows.map(row => ({ time: row[timeIndex] as number, value: row[valueIndex] as number }));
  if (measurements.some((point, index) => index > 0 && point.time <= measurements[index - 1].time)) throw new Error('측정 시각은 중복 없이 오름차순이어야 합니다.');
  return measurements;
}
function saveText(text: string, filename: string, contentType: string) {
  const url = URL.createObjectURL(new Blob([text], { type: contentType })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function errorText(error: unknown): string { return error instanceof ModelError ? error.diagnostics[0]?.message ?? error.message : error instanceof Error ? error.message : '실험 설정을 확인해 주세요.'; }
function ParameterRows({ model, drafts, setDrafts, fit, busy }: { model: CalcModel; drafts: ParameterDraft[]; setDrafts: (next: ParameterDraft[]) => void; fit: boolean; busy: boolean }) {
  const targets = experimentTargets(model), prefix = fit ? '피팅' : '다변수';
  const change = (index: number, patch: Partial<ParameterDraft>) => setDrafts(drafts.map((draft, position) => position === index ? { ...draft, ...patch } : draft));
  return <div className="m19-parameter-list">
    {drafts.map((draft, index) => <div className="m19-parameter-row" key={index}>
      <label className="field"><span className="field-label">{index + 1} · 숫자 블록</span><select aria-label={`${prefix} 블록 ${index + 1}`} value={draft.nodeId} disabled={busy} onChange={event => { const node = targets.find(item => item.id === event.target.value); change(index, fit ? newDraft(node) : { nodeId: event.target.value }); }}><option value="">블록 선택</option>{targets.map(node => <option key={node.id} value={node.id}>{node.label} · {parameterName(node) === 'gain' ? '배율' : '값'}</option>)}</select></label>
      {fit ? <div className="m19-bounds">{(['lower', 'upper', 'initial'] as const).map((key, position) => <label className="field" key={key}><span className="field-label">{['하한', '상한', '초기값'][position]}</span><input type="text" inputMode="decimal" maxLength={100} aria-label={`피팅 ${['하한', '상한', '초기값'][position]} ${index + 1}`} value={draft[key]} disabled={busy} onChange={event => change(index, { [key]: event.target.value })}/></label>)}</div> : <label className="field"><span className="field-label">실행할 값</span><input aria-label={`다변수 실행 값 ${index + 1}`} maxLength={4096} value={draft.values} disabled={busy} onChange={event => change(index, { values: event.target.value })}/></label>}
      <button className="text-button m19-remove" aria-label={`${prefix} 파라미터 ${index + 1} 삭제`} disabled={busy || drafts.length === 1} onClick={() => setDrafts(drafts.filter((_, position) => index !== position))}>삭제</button>
    </div>)}
    <button className="button m19-add" disabled={busy || drafts.length >= 3 || targets.length <= drafts.length} onClick={() => setDrafts([...drafts, newDraft(targets.find(node => !drafts.some(draft => draft.nodeId === node.id)))])}>{prefix} 파라미터 추가</button>
    {!targets.length && <p className="field-help">유한한 스칼라 값을 가진 Constant·Input·Gain 블록을 도식에 추가하세요.</p>}
  </div>;
}
export function M19ExperimentsPanel(props: M19ExperimentsProps) {
  return <div className="m19-experiments">
    <details className="tool-section m19-section" data-testid="multi-sweep-section"><summary><span>다변수 실험</span><small>최대 3개 파라미터 · 64개 조합</small></summary><div className="m19-section-content"><MultiSweepPanel {...props}/></div></details>
    <details className="tool-section m19-section" data-testid="fit-section"><summary><span>측정 데이터로 파라미터 피팅</span><small>범위 안에서 오차가 작은 후보 찾기</small></summary><div className="m19-section-content"><FitPanel {...props}/></div></details>
  </div>;
}
function ExperimentProgress({ busy, experimentProgress, onCancelSweep }: Pick<M19ExperimentsProps, 'busy' | 'experimentProgress' | 'onCancelSweep'>) {
  return <div className="m19-progress"><span role="status">{experimentProgress?.total ? `${experimentProgress.completed} / ${experimentProgress.total} 평가 완료` : ''}</span>{busy && <button className="button" onClick={onCancelSweep}>실험 취소</button>}</div>;
}
function MultiSweepPanel(props: M19ExperimentsProps) {
  const { model, busy, onMultiSweep, multiSweepResult, onApplyGrid, multiSweepModelCurrent, notice } = props;
  const [drafts, setDrafts] = useState<ParameterDraft[]>(() => [newDraft(experimentTargets(model)[0])]);
  const [outputId, setOutputId] = useState(''), [error, setError] = useState('');
  useEffect(() => { setDrafts([newDraft(experimentTargets(model)[0])]); }, [model.modelId]);
  const prepared = gridDraftSpec(model, drafts), reportTypes = multiSweepResult?.records[0]?.manifest.outputTypes ?? {};
  const outputs = Object.keys(reportTypes).filter(id => reportTypes[id].valueType === 'float64' && reportTypes[id].shape.length === 0);
  const activeOutput = outputs.includes(outputId) ? outputId : outputs[0] ?? '', labels = outputLabels(multiSweepResult?.records[0]?.model ?? model);
  const start = async () => { if (!prepared.spec) { setError(prepared.error); notice(prepared.error); return; } setError(''); try { await onMultiSweep?.(prepared.spec); } catch (caught) { setError(errorText(caught)); } };
  const records = multiSweepResult?.records ?? [];
  return <>
    <p className="m19-intro">각 축의 숫자를 조합해 동일한 도식을 반복 계산합니다. 도식의 현재 파라미터는 실행만으로 바뀌지 않습니다.</p>
    <ParameterRows model={model} drafts={drafts} setDrafts={setDrafts} fit={false} busy={busy}/>
    <p className="m19-combination-count" role="status">전체 조합 <strong>{prepared.count.toLocaleString()} / 64</strong></p>
    {prepared.error && <p className="field-help">{prepared.error}</p>}
    {error && <p className="tool-error" role="alert">{error}</p>}
    <div className="tool-actions"><button className="button primary" disabled={busy || !prepared.spec || !onMultiSweep} onClick={() => void start()}>다변수 실험 실행</button><ExperimentProgress {...props}/></div>
    <p className="field-help">전체 조합에 30초·100만 기록 원소·5천만 연산 한도를 공유합니다. 완료한 실행은 최근 5개 기록에 보관합니다. 전체 조합표·보고서는 새로고침 전까지 유지되므로 파일로 내려받으세요.</p>
    {multiSweepResult && <section className="m19-report" aria-label="다변수 실험 결과">
      <h4>조합별 결과 <small>{records.length}개 · {reportStatus(multiSweepResult.status)}</small></h4>
      {multiSweepResult.diagnostics?.map((diagnostic, index) => <p className="tool-error" role="alert" key={index}>{diagnostic.message}</p>)}
      {records.length > 0 && <>
        <label className="field"><span className="field-label">표에서 볼 출력</span><select aria-label="다변수 결과 출력" value={activeOutput} onChange={event => setOutputId(event.target.value)}>{outputs.map(id => <option key={id} value={id}>{labels[id] ?? id} · {reportTypes[id].unit}</option>)}</select></label>
        <div className="tool-table-scroll"><table className="tool-table" aria-label="다변수 조합별 결과"><thead><tr><th>조합</th><th>파라미터</th><th>마지막 출력</th><th>상태</th><th>모델</th></tr></thead><tbody>{records.map((record, index) => { const value = record.result.samples.at(-1)?.values[activeOutput]; return <tr key={record.id}><td>{index + 1}</td><td>{record.parameters.map(parameter => <span className="m19-parameter-value" key={`${parameter.nodeId}-${parameter.parameter}`}>{record.model.nodes.find(node => node.id === parameter.nodeId)?.label ?? parameter.nodeId}: {formatNumber(parameter.value)}</span>)}</td><td>{typeof value === 'number' ? formatNumber(value) : '수치 출력 없음'}</td><td>{reportStatus(record.result.status)}</td><td><button className="button" disabled={busy || !onApplyGrid || !multiSweepModelCurrent} onClick={() => onApplyGrid?.(record)} aria-label={`조합 ${index + 1} 모델 적용`}>이 조합 적용</button></td></tr>; })}</tbody></table></div>
        {!multiSweepModelCurrent && <p className="field-help">실험 이후 도식이 바뀌었습니다. 현재 도식에서 다시 실행하면 후보를 적용할 수 있습니다.</p>}
        <div className="tool-actions"><button className="button" onClick={() => saveText(JSON.stringify({ schemaVersion: 1, kind: 'multivariable-grid', spec: props.multiSweepSpec, result: multiSweepResult }, null, 2), 'calcweave-multivariable-report.json', 'application/json;charset=utf-8')}>다변수 보고서 JSON</button><button className="button" onClick={() => {
          const header = ['candidate', 'node_id', 'parameter', 'value', 'output_id', 'output_unit', 'final_output', 'status', 'model_sha256'];
          const rows = records.flatMap((record, index) => record.parameters.map(parameter => { const output = record.result.samples.at(-1)?.values[activeOutput]; return [index + 1, parameter.nodeId, parameter.parameter, parameter.value, activeOutput, record.manifest.outputTypes[activeOutput]?.unit ?? '', typeof output === 'number' ? output : '', record.result.status, record.modelHash]; }));
          saveText([header.map(safeCsvCell).join(','), ...rows.map(row => row.map(safeCsvCell).join(','))].join('\r\n') + '\r\n', 'calcweave-multivariable-report.csv', 'text/csv;charset=utf-8');
        }}>조합표 CSV</button></div>
      </>}
    </section>}
  </>;
}
function reportStatus(status: string): string { return status === 'completed' ? '완료' : status === 'cancelled' ? '취소 · 부분 결과' : status === 'failed' ? '실패 · 부분 결과' : status; }
function fitTermination(value: string): string {
  const labels: Record<string, string> = { converged: '잔차 기준 도달', 'evaluation-limit': '평가 횟수 한도', 'no-improvement': '더 작은 오차를 찾지 못함', cancelled: '사용자가 취소', failed: '실행 실패' };
  return labels[value] ?? value;
}
function FitPanel(props: M19ExperimentsProps) {
  const { model, outputTypes, busy, notice, onFit, fitResult, fitModelCurrent, onApplyFit } = props;
  const [drafts, setDrafts] = useState<ParameterDraft[]>(() => [newDraft(experimentTargets(model)[0])]);
  const [outputId, setOutputId] = useState(''), [csv, setCsv] = useState(''), [headers, setHeaders] = useState<string[]>([]);
  const [timeColumn, setTimeColumn] = useState(''), [valueColumn, setValueColumn] = useState(''), [unit, setUnit] = useState(''), [maxEvaluations, setMaxEvaluations] = useState('48');
  const [measurements, setMeasurements] = useState<FitSpec['measurements'] | null>(null), [fileName, setFileName] = useState(''), [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const outputs = Object.keys(outputTypes).filter(id => outputTypes[id].valueType === 'float64' && outputTypes[id].shape.length === 0);
  const activeOutput = outputs.includes(outputId) ? outputId : outputs[0] ?? '', activeUnit = unit || outputTypes[activeOutput]?.unit || '1', labels = outputLabels(model);
  useEffect(() => { setDrafts([newDraft(experimentTargets(model)[0])]); }, [model.modelId]);
  const invalidate = () => { setMeasurements(null); setError(''); };
  const inspectCsv = (text: string, name: string) => {
    if (text.length > CSV_LIMIT || new TextEncoder().encode(text).byteLength > CSV_LIMIT) throw new Error('측정 CSV는 256 KiB 이하여야 합니다.');
    const inspected = inspectDatasetInput(text, 'csv');
    if (inspected.rowCount > 1000) throw new Error('측정 데이터는 최대 1,000행입니다.');
    if (inspected.columnNames.length < 2) throw new Error('시간과 측정값을 담은 열이 각각 필요합니다.');
    const time = inspected.columnNames.find(column => /^(time|t|시간)$/i.test(column)) ?? inspected.columnNames[0];
    setCsv(text); setHeaders(inspected.columnNames); setTimeColumn(time); setValueColumn(inspected.columnNames.find(column => column !== time) ?? ''); setFileName(name); invalidate();
  };
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > CSV_LIMIT) { setError('측정 CSV는 256 KiB 이하여야 합니다.'); return; }
    try { const bytes = new Uint8Array(await file.arrayBuffer()); inspectCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes), file.name.slice(0, 100)); }
    catch (caught) { setError(errorText(caught)); }
  };
  const preview = () => { try { setMeasurements(parseMeasurementCsv(csv, timeColumn, valueColumn, activeUnit)); setError(''); } catch (caught) { setMeasurements(null); setError(errorText(caught)); } };
  const start = async () => {
    try {
      if (!activeOutput) throw new Error('스칼라 수치 출력을 선택하세요.');
      const selected = experimentTargets(model);
      const parameters = drafts.map(draft => { const node = selected.find(item => item.id === draft.nodeId); if (!node) throw new Error('피팅할 숫자 블록을 선택하세요.'); return { nodeId: node.id, parameter: parameterName(node), lower: numericDraft(draft.lower), upper: numericDraft(draft.upper), initial: numericDraft(draft.initial) }; });
      if (!parameters.length || parameters.length > 3 || new Set(parameters.map(parameter => parameter.nodeId)).size !== parameters.length) throw new Error('서로 다른 1~3개의 숫자 블록을 선택하세요.');
      if (parameters.some(parameter => !Number.isFinite(parameter.lower) || !Number.isFinite(parameter.upper) || !Number.isFinite(parameter.initial) || Math.abs(parameter.lower) > 1e12 || Math.abs(parameter.upper) > 1e12 || parameter.lower >= parameter.upper || parameter.initial < parameter.lower || parameter.initial > parameter.upper)) throw new Error('절댓값 10¹² 이하의 유한한 하한 < 상한을 지정하고 초기값을 범위 안에 두세요.');
      const evaluations = numericDraft(maxEvaluations);
      if (!Number.isSafeInteger(evaluations) || evaluations < 1 || evaluations > 96) throw new Error('평가 횟수는 1~96의 정수여야 합니다.');
      const measured = parseMeasurementCsv(csv, timeColumn, valueColumn, activeUnit);
      setMeasurements(measured); setError('');
      await onFit?.({ parameters, outputId: activeOutput, measurements: measured, unit: activeUnit, maxEvaluations: evaluations });
    } catch (caught) { setError(errorText(caught)); }
  };
  return <>
    <p className="m19-intro">측정값과 도식 출력의 제곱 오차를 줄이는 파라미터를 지정 범위에서 탐색합니다. 결과는 후보로 제시되며, 적용 버튼을 누를 때만 도식을 변경합니다.</p>
    <ParameterRows model={model} drafts={drafts} setDrafts={setDrafts} fit={true} busy={busy}/>
    <div className="m19-fit-fields"><label className="field"><span className="field-label">맞출 스칼라 출력</span><select aria-label="피팅 출력" value={activeOutput} disabled={busy} onChange={event => { setOutputId(event.target.value); setUnit(''); invalidate(); }}><option value="">출력 선택</option>{outputs.map(id => <option key={id} value={id}>{labels[id] ?? id} · {outputTypes[id].unit}</option>)}</select></label><label className="field"><span className="field-label">최대 평가 횟수</span><input aria-label="피팅 최대 평가 횟수" type="text" inputMode="numeric" maxLength={3} value={maxEvaluations} disabled={busy} onChange={event => setMaxEvaluations(event.target.value)}/></label></div>
    <div className="m19-measurements">
      <h4>측정 데이터</h4><p className="field-help">시간은 초(s)로 입력하세요. 시뮬레이션의 관측 격자와 같은 시각을 사용하며, 보간 없이 원시 출력을 비교합니다. CSV는 이 브라우저에서만 읽습니다. 최대 256 KiB·1,000행이며 측정 시각은 오름차순이어야 합니다.</p>
      <div className="tool-actions"><button className="button" disabled={busy} onClick={() => fileInput.current?.click()}>측정 CSV 가져오기</button>{fileName && <span className="field-help">{fileName}</span>}</div><input ref={fileInput} className="visually-hidden" type="file" accept=".csv,text/csv" aria-label="피팅 측정 CSV" disabled={busy} onChange={event => void readFile(event)}/>
      <details className="m19-csv-entry"><summary>CSV 텍스트 입력</summary><label className="field"><span className="field-label">시간·측정값 CSV</span><textarea aria-label="피팅 CSV 텍스트" rows={6} maxLength={CSV_LIMIT} disabled={busy} value={csv} placeholder={'time,value\n0,1\n1,0.6\n2,0.36'} onChange={event => { setCsv(event.target.value); setHeaders([]); setFileName(''); invalidate(); }}/></label><button className="button" disabled={busy || !csv.trim()} onClick={() => { try { inspectCsv(csv, '직접 입력'); } catch (caught) { setError(errorText(caught)); } }}>CSV 열 확인</button></details>
      {headers.length > 0 && <><div className="m19-fit-fields"><label className="field"><span className="field-label">시간 열 · s</span><select aria-label="피팅 시간 열" disabled={busy} value={timeColumn} onChange={event => { setTimeColumn(event.target.value); invalidate(); }}>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label><label className="field"><span className="field-label">측정값 열</span><select aria-label="피팅 측정값 열" disabled={busy} value={valueColumn} onChange={event => { setValueColumn(event.target.value); invalidate(); }}>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label><label className="field"><span className="field-label">측정값 단위</span><select aria-label="피팅 측정값 단위" disabled={busy} value={activeUnit} onChange={event => { setUnit(event.target.value); invalidate(); }}>{UNITS.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div><button className="button" disabled={busy} onClick={preview}>측정 데이터 확인</button></>}
      {measurements && <><p className="field-help">확인한 측정값 {measurements.length}개 · {activeUnit} · 앞 5행</p><div className="tool-table-scroll"><table className="tool-table" aria-label="피팅 측정값 미리보기"><thead><tr><th>시간 · s</th><th>측정값 · {activeUnit}</th></tr></thead><tbody>{measurements.slice(0, 5).map(point => <tr key={point.time}><td>{formatNumber(point.time)}</td><td>{formatNumber(point.value)}</td></tr>)}</tbody></table></div></>}
    </div>
    {error && <p className="tool-error" role="alert">{error}</p>}
    <div className="tool-actions"><button className="button primary" disabled={busy || !onFit || !activeOutput || !headers.length || !experimentTargets(model).length} onClick={() => void start()}>파라미터 피팅 실행</button><ExperimentProgress {...props}/></div>
    <p className="field-help">최대 96회 평가와 30초·100만 기록 원소·5천만 연산 한도를 공유합니다. 탐색은 전역 최솟값을 보장하지 않습니다. 완료한 최적 후보의 실행은 기존 기록에 보관합니다. 전체 보고서는 새로고침 전까지 유지되므로 파일로 내려받으세요.</p>
    {fitResult && <FitReport report={fitResult} spec={props.fitSpec} busy={busy} current={!!fitModelCurrent} apply={onApplyFit}/>}
  </>;
}
function FitReport({ report, spec, busy, current, apply }: { report: FitResult; spec?: FitSpec; busy: boolean; current: boolean; apply?: () => void }) {
  const best = report.best;
  const descriptor: SignalDescriptor = { valueType: 'float64', shape: [], unit: spec?.unit ?? (spec?.outputId ? best?.manifest.outputTypes[spec.outputId]?.unit : undefined) ?? '1' };
  const plotSeries = useMemo(() => best ? [
    { id: 'measured', label: '측정값', descriptor, samples: best.residuals.map(point => ({ time: point.time, values: { fit: point.measured } })) },
    { id: 'predicted', label: '후보 예측값', descriptor, samples: best.residuals.map(point => ({ time: point.time, values: { fit: point.predicted } })) },
  ] : [], [best, spec?.unit]);
  const residualSeries = useMemo(() => best ? [{ id: 'residual', label: '잔차 · 예측 − 측정', descriptor, samples: best.residuals.map(point => ({ time: point.time, values: { residual: point.residual } })) }] : [], [best, spec?.unit]);
  return <section className="m19-report" aria-label="파라미터 피팅 결과"><h4>피팅 결과 <small>{reportStatus(report.status)} · {report.evaluations}회 평가</small></h4><p className="field-help">종료 사유: {fitTermination(report.termination)}</p>
    {report.diagnostics?.map((diagnostic, index) => <p className="tool-error" role="alert" key={index}>{diagnostic.message}</p>)}
    {best && <>
      <div className="m19-metrics"><div><span>RMSE · {descriptor.unit}</span><strong>{formatNumber(best.rmse)}</strong></div><div><span>최대 절대 오차 · {descriptor.unit}</span><strong>{formatNumber(best.maxAbsoluteError)}</strong></div></div>
      <div className="tool-table-scroll"><table className="tool-table" aria-label="피팅 후보 파라미터"><thead><tr><th>블록</th><th>파라미터</th><th>후보 값</th></tr></thead><tbody>{best.parameters.map(parameter => <tr key={`${parameter.nodeId}-${parameter.parameter}`}><td>{best.model.nodes.find(node => node.id === parameter.nodeId)?.label ?? parameter.nodeId}</td><td>{parameter.parameter === 'gain' ? '배율' : '값'}</td><td>{String(parameter.value)}</td></tr>)}</tbody></table></div>
      <div className="tool-actions"><button className="button primary" disabled={busy || !current || !apply} onClick={apply}>최적 후보 모델 적용</button><button className="button" onClick={() => saveText(JSON.stringify({ schemaVersion: 1, kind: 'parameter-fit', spec, result: report }, null, 2), 'calcweave-fitting-report.json', 'application/json;charset=utf-8')}>피팅 보고서 JSON</button><button className="button" onClick={() => saveText('time_s,measured,predicted,residual,unit\r\n' + best.residuals.map(point => [point.time, point.measured, point.predicted, point.residual, descriptor.unit].map(safeCsvCell).join(',')).join('\r\n') + '\r\n', 'calcweave-fitting-residuals.csv', 'text/csv;charset=utf-8')}>잔차 CSV</button></div>
      {!current && <p className="field-help">피팅 이후 도식이 바뀌었습니다. 현재 도식에서 다시 피팅하면 후보를 적용할 수 있습니다.</p>}
      <p className="field-help">측정 시각과 일치하는 관측 격자의 원시 예측값으로 오차를 평가합니다. 잔차는 예측값 − 측정값입니다.</p>
      <ScopePlot series={plotSeries} outputId="fit" label="측정값과 후보 예측값"/>
      <details className="m19-residual-details"><summary>잔차 그래프와 원시 표</summary><ScopePlot series={residualSeries} outputId="residual" label="측정 시각의 잔차"/><div className="tool-table-scroll m19-residual-table"><table className="tool-table" aria-label="피팅 원시 잔차"><thead><tr><th>시각 · s</th><th>측정값</th><th>예측값</th><th>잔차</th></tr></thead><tbody>{best.residuals.map(point => <tr key={point.time}><td>{String(point.time)}</td><td>{String(point.measured)}</td><td>{String(point.predicted)}</td><td>{String(point.residual)}</td></tr>)}</tbody></table></div></details>
    </>}
    {!!report.trace.length && <details className="m19-residual-details"><summary>탐색 과정 · {report.trace.length}회</summary><div className="tool-table-scroll m19-residual-table"><table className="tool-table" aria-label="피팅 탐색 과정"><thead><tr><th>평가</th><th>RMSE</th></tr></thead><tbody>{report.trace.map((entry, index) => <tr key={index}><td>{index + 1}</td><td>{formatNumber(entry.rmse)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
