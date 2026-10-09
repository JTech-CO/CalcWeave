import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { UNITS, type CalcModel, type DashboardWidget, type Dataset, type SignalDescriptor } from '../../../../packages/model/src';
import { importDataset, inspectDatasetInput, exportDatasetCsv, exportResultCsv, inspectLocalDataFile, workbookSheetSource, importLocalDataSource, type LocalDataSource, type BoundedWorkbook } from '../../../../packages/data/src';
import { compareRuns } from '../../../../packages/experiments/src';
import { ResultPlot, formatNumber } from './ResultPlot';
import { ScopePlot } from './ScopePlot';
import { ScopeTimeRange } from './ScopeTimeRange';
import { signalSummary } from './SignalResult';
import type { HistoryRecord } from '../run-history';
import { SignalScenarioEditor } from './SignalScenarioEditor';
import { M13DashboardPanel } from './M13DashboardPanel';
import { outputLabels } from '../output-labels';
import { M19ExperimentsPanel, type M19ExperimentsProps } from './M19ExperimentsPanel';
import { UncertaintyEnsemblePanel, type UncertaintyEnsembleProps } from './UncertaintyEnsemblePanel';

export type WorkspaceTab = 'diagram' | 'data' | 'experiments' | 'dashboard' | 'notes';
const labels: Record<WorkspaceTab, string> = { diagram: '도식', data: '데이터', experiments: '실험', dashboard: '대시보드', notes: '노트' };
export function WorkspaceTabs({ value, onChange }: { value: WorkspaceTab; onChange: (tab: WorkspaceTab) => void }) {
  return <nav className="workspace-tabs" aria-label="작업 공간"><div role="tablist">{Object.entries(labels).map(([tab, label]) => <button key={tab} role="tab" aria-selected={value === tab} onClick={() => onChange(tab as WorkspaceTab)}>{label}</button>)}</div></nav>;
}
export function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type ColumnSetting = { name: string; kind: 'number' | 'boolean' | 'string'; unit: string };
export interface ToolsProps extends Pick<M19ExperimentsProps, 'onMultiSweep' | 'onFit' | 'multiSweepResult' | 'fitResult' | 'experimentProgress' | 'multiSweepModelCurrent' | 'fitModelCurrent' | 'onApplyGrid' | 'onApplyFit' | 'fitSpec' | 'multiSweepSpec'>, Pick<UncertaintyEnsembleProps, 'onEnsemble' | 'ensembleResult' | 'ensembleProgress' | 'ensembleModelCurrent' | 'onApplyEnsemble'> {
  tab: WorkspaceTab; model: CalcModel; onChange: (next: CalcModel) => void; notice: (message: string) => void;
  onPlayback: (dataset: Dataset, column: string, type?: string) => void;
  onDashboardEvent?: (nodeId: string, value: number) => boolean; dashboardValues?: Record<string, number>; dashboardEventCount?: number; onDashboardAction?: (action: string) => void; history: HistoryRecord[]; historyError: string;
  onDeleteRecord: (id: string) => void; onRestoreRecord: (record: HistoryRecord) => void; onHistoryRecovery: () => void;
  busy: boolean; onSweep: (nodeId: string, parameter: string, values: number[]) => Promise<void>; onCancelSweep: () => void;
  sweepProgress: { completed: number; total: number }; result?: Pick<HistoryRecord, 'model'|'result'|'outputTypes'> | null; resultCurrent: boolean;
  outputTypes: Record<string, SignalDescriptor>;
  onScopeRange: (startTime: number, stopTime: number) => Promise<void>;
}
export function M4WorkspaceTools(props: ToolsProps) {
  return <section className="workspace-tools" role="tabpanel" aria-label={labels[props.tab]}>
    {props.tab === 'data' ? <DataPanel {...props}/> : props.tab === 'experiments' ? <ExperimentPanel {...props}/> : props.tab === 'dashboard' ? <DashboardPanel {...props}/> : <NotesPanel {...props}/>}
  </section>;
}
function DataPanel({ model, onChange, notice, onPlayback }: ToolsProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<LocalDataSource | null>(null);
  const [workbook, setWorkbook] = useState<BoundedWorkbook | null>(null), [workbookName, setWorkbookName] = useState('');
  const [rawRows, setRawRows] = useState<(number | boolean | string | null)[][]>([]);
  const [replaceId, setReplaceId] = useState('');
  const [columns, setColumns] = useState<ColumnSetting[]>([]), [timeColumn, setTimeColumn] = useState('');
  const [missing, setMissing] = useState<'reject'|'drop-row'|'zero'>('reject'), [duplicates, setDuplicates] = useState<'reject'|'keep-first'|'keep-last'>('reject');
  const [trimStrings, setTrimStrings] = useState(true), [lowercaseStrings, setLowercaseStrings] = useState(false), [sortTime, setSortTime] = useState(false);
  const [preview, setPreview] = useState<Dataset | null>(null), [error, setError] = useState(''), [datasetName, setDatasetName] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<Record<string, string>>({});
  const invalidate = () => { setPreview(null); setError(''); };
  const selectSource = (next: LocalDataSource) => {
    const inspected = inspectDatasetInput(next.text, next.format);
    const mapped = inspected.columnNames.map((name, index): ColumnSetting => {
      const cells = inspected.sampleRows.map(row => row[index]).filter(value => value !== null && value !== '');
      const kind = cells.length && cells.every(value => typeof value === 'boolean' || value === 'true' || value === 'false') ? 'boolean'
        : cells.length && cells.every(value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value))) ? 'number' : 'string';
      return { name, kind, unit: '1' };
    });
    setSource(next); setRawRows(inspected.sampleRows); setReplaceId(''); setDatasetName(next.filename.replace(/\.[^.]+$/, '').slice(0, 100)); setColumns(mapped); setTimeColumn(mapped.find(column => column.kind === 'number')?.name ?? mapped[0]!.name); setPreview(null); setError('');
  };
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('데이터 파일은 2 MiB 이하여야 합니다.'); return; }
    try {
      const inspected = await inspectLocalDataFile(new Uint8Array(await file.arrayBuffer()), file.name);
      setWorkbook(inspected.workbook ?? null); setWorkbookName(file.name.slice(0, 100));
      if (inspected.source) selectSource(inspected.source);
      else if (inspected.workbook) selectSource(workbookSheetSource(inspected.workbook, inspected.workbook.sheets[0]!.name, file.name));
    } catch (caught) { setError(caught instanceof Error ? caught.message : '데이터 파일을 읽지 못했습니다.'); }
  };
  const buildPreview = () => {
    if (!source) return;
    try {
      const existing = model.datasets?.find(dataset => dataset.id === replaceId);
      const dataset = importLocalDataSource(source, { id: existing?.id ?? preview?.id ?? `data-${crypto.randomUUID()}`, name: datasetName || '가져온 데이터', version: existing ? existing.version + 1 : 1, timeColumn, columns, missing, trimStrings, lowercaseStrings, sortTime, duplicateTimes: duplicates });
      setPreview(dataset); setError('');
    } catch (caught) { setPreview(null); setError(caught instanceof Error ? caught.message : '정리 옵션을 확인해 주세요.'); }
  };
  const remove = (id: string) => {
    const references = [...model.nodes, ...(model.subsystems ?? []).flatMap(definition => definition.nodes)].filter(node => ['source.dataset', 'data.input-table', 'data.signal-editor'].includes(node.blockType) && node.parameters.datasetId === id);
    if (references.length) { notice(`${references.length}개 재생 블록이 참조하는 데이터입니다. 해당 블록을 먼저 삭제하거나 다른 데이터에 연결하세요.`); return; }
    onChange({ ...model, datasets: model.datasets?.filter(dataset => dataset.id !== id) }); notice('데이터를 삭제했습니다. 실행 취소로 되돌릴 수 있습니다.');
  };
  return <><header className="tool-page-heading"><div><h2>시간과 값을 도식에 연결하세요</h2><p>CSV·JSON·값만 저장된 XLSX 데이터를 미리 보고 타입·단위·정리 규칙을 결정한 다음 모델에 보관합니다.</p></div><button className="button primary" onClick={() => fileInput.current?.click()}>데이터 파일 가져오기</button><input ref={fileInput} className="visually-hidden" type="file" accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="데이터 파일" onChange={event => void readFile(event)}/></header>
    {error && <p className="tool-error" role="alert">{error}</p>}
    {workbook && <label className="field workbook-sheet"><span className="field-label">XLSX 시트</span><select aria-label="XLSX 시트" value={source?.sheet ?? ''} onChange={event => { try { selectSource(workbookSheetSource(workbook, event.target.value, workbookName)); } catch (error) { setError(error instanceof Error ? error.message : '시트를 확인하세요.'); } }}>{workbook.sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}</select></label>}
    {source && <section className="tool-section dataset-import"><h3>가져오기 설정 <small>{source.filename}</small></h3><label className="field"><span className="field-label">보관 방식</span><select aria-label="데이터 보관 방식" value={replaceId} onChange={event => { setReplaceId(event.target.value); invalidate(); }}><option value="">새 데이터로 보관</option>{model.datasets?.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name} 갱신 · v{dataset.version + 1}</option>)}</select></label><details><summary>원본 앞 5행 미리보기</summary><div className="tool-table-scroll"><table className="tool-table"><thead><tr>{columns.map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{rawRows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell === null ? '결측값' : String(cell)}</td>)}</tr>)}</tbody></table></div></details><div className="tool-field-grid"><label className="field"><span className="field-label">데이터 이름</span><input aria-label="데이터 이름" maxLength={100} value={datasetName} onChange={event => { setDatasetName(event.target.value); invalidate(); }}/></label><label className="field"><span className="field-label">시간 열</span><select aria-label="시간 열" value={timeColumn} onChange={event => { setTimeColumn(event.target.value); invalidate(); }}>{columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select></label><label className="field"><span className="field-label">결측값 처리</span><select aria-label="결측값 처리" value={missing} onChange={event => { setMissing(event.target.value as typeof missing); invalidate(); }}><option value="reject">오류로 확인</option><option value="drop-row">해당 행 제외</option><option value="zero">숫자 0 (시간 제외)</option></select></label><label className="field"><span className="field-label">중복 시각</span><select aria-label="중복 시각" value={duplicates} onChange={event => { setDuplicates(event.target.value as typeof duplicates); invalidate(); }}><option value="reject">오류로 확인</option><option value="keep-first">첫 행 보관</option><option value="keep-last">마지막 행 보관</option></select></label></div><div className="tool-checks"><label><input type="checkbox" checked={sortTime} onChange={event => { setSortTime(event.target.checked); invalidate(); }}/>시간순 정렬</label><label><input type="checkbox" checked={trimStrings} onChange={event => { setTrimStrings(event.target.checked); invalidate(); }}/>문자열 양끝 공백 제거</label><label><input type="checkbox" checked={lowercaseStrings} onChange={event => { setLowercaseStrings(event.target.checked); invalidate(); }}/>문자열 소문자 변환</label></div><div className="tool-table-scroll"><table className="tool-table"><thead><tr><th>열</th><th>자료형</th><th>단위</th></tr></thead><tbody>{columns.map((column, index) => <tr key={column.name}><td>{column.name}</td><td><select aria-label={`${column.name} 자료형`} value={column.kind} onChange={event => { setColumns(current => current.map((value, position) => position === index ? { ...value, kind: event.target.value as ColumnSetting['kind'] } : value)); invalidate(); }}><option value="number">숫자</option><option value="boolean">boolean</option><option value="string">문자열</option></select></td><td><select aria-label={`${column.name} 단위`} value={column.unit} onChange={event => { setColumns(current => current.map((value, position) => position === index ? { ...value, unit: event.target.value } : value)); invalidate(); }}>{UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></td></tr>)}</tbody></table></div><div className="tool-actions"><button className="button" onClick={buildPreview}>정리 결과 미리보기</button>{preview && <button className="button primary" onClick={() => { onChange({ ...model, datasets: replaceId ? model.datasets?.map(dataset => dataset.id === replaceId ? preview : dataset) : [...(model.datasets ?? []), preview] }); notice(`${preview.name} v${preview.version} 데이터를 모델에 보관했습니다.`); setPreview(null); setSource(null); }}>이 데이터 보관</button>}</div>{preview && <DatasetPreview dataset={preview}/>}</section>}
    <SignalScenarioEditor model={model} onChange={onChange} notice={notice} onPlayback={onPlayback}/><section className="tool-section"><h3>모델의 데이터 <span className="tag">{model.datasets?.length ?? 0}</span></h3>{!model.datasets?.length && <p className="tool-empty">파일을 가져온 뒤 정리 결과를 확인해 보관하세요. 데이터는 모델 파일과 함께 내보냅니다.</p>}<div className="dataset-cards">{model.datasets?.map(dataset => {
      const playable = dataset.columns.filter(column => column.name !== dataset.timeColumn && column.kind !== 'string'), selected = selectedColumns[dataset.id] ?? playable[0]?.name ?? '';
      return <article className="dataset-card" key={dataset.id}><h4>{dataset.name} <small>v{dataset.version}</small></h4><p>{dataset.rows.length.toLocaleString()}행 · {dataset.columns.length}열 · 시간 {dataset.timeColumn}</p><details><summary>원본과 정리 데이터 hash</summary><dl className="hash-details">{dataset.provenance && <><dt>데이터 출처</dt><dd>{dataset.provenance.format} · {dataset.provenance.filename}{dataset.provenance.sheet && ` / ${dataset.provenance.sheet}`} · {dataset.provenance.transforms.join(', ') || '변환 없음'}</dd></>}<dt>원본 SHA-256</dt><dd>{dataset.sourceHash}</dd><dt>데이터 SHA-256</dt><dd>{dataset.contentHash}</dd></dl></details><DatasetPreview dataset={dataset}/><label className="field"><span className="field-label">재생할 열</span><select aria-label={`${dataset.name} 재생할 열`} value={selected} onChange={event => setSelectedColumns(current => ({ ...current, [dataset.id]: event.target.value }))}>{playable.map(column => <option key={column.name} value={column.name}>{column.name} · {column.kind} · {column.unit}</option>)}</select></label><div className="tool-actions"><button className="button primary" disabled={!selected} onClick={() => onPlayback(dataset, selected)}>도식에 재생 블록 추가</button><button className="button" onClick={() => downloadText(exportDatasetCsv(dataset), `${dataset.id}.csv`, 'text/csv;charset=utf-8')}>CSV 다운로드</button><button className="button" onClick={() => downloadText(JSON.stringify(dataset, null, 2), `${dataset.id}.json`, 'application/json;charset=utf-8')}>JSON 다운로드</button><button className="text-button" onClick={() => remove(dataset.id)}>데이터 삭제</button></div></article>;
    })}</div></section></>;
}
function DatasetPreview({ dataset }: { dataset: Dataset }) {
  return <div className="tool-table-scroll"><table className="tool-table" aria-label={`${dataset.name} 미리보기`}><thead><tr>{dataset.columns.map(column => <th key={column.name}>{column.name} <small>{column.unit}</small></th>)}</tr></thead><tbody>{dataset.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{String(cell)}</td>)}</tr>)}</tbody></table>{dataset.rows.length > 5 && <p className="field-help">앞 5행 미리보기 · 전체 {dataset.rows.length.toLocaleString()}행</p>}</div>;
}
function ExperimentPanel(props: ToolsProps) {
  const { model, history, historyError, onDeleteRecord, onRestoreRecord, onHistoryRecovery, onSweep, onCancelSweep, sweepProgress, busy, notice } = props;
  const targets = model.nodes.filter(node => ['source.constant', 'io.input', 'math.gain'].includes(node.blockType) && typeof node.parameters[node.blockType === 'math.gain' ? 'gain' : 'value'] === 'number');
  const [target, setTarget] = useState(''), [draft, setDraft] = useState('0.5, 1, 2'), [selected, setSelected] = useState<string[]>([]), [output, setOutput] = useState('');
  const activeTarget = targets.find(node => node.id === target) ?? targets[0];
  const historyKey = history.map(record => record.id).join('|');
  useEffect(() => { setSelected(current => current.filter(id => history.some(record => record.id === id))); }, [historyKey]);
  const validSelected = selected.filter(id => history.some(record => record.id === id));
  const compare = validSelected.map(id => history.find(record => record.id === id)!).slice(0, 3);
  const comparison = compare.length ? compareRuns(compare.map(record => ({ ...record, value: 0, modelHash: record.semanticHash }))) : null;
  const commonOutputs = compare.length ? compare[0].outputIds.filter(id => compare.every(record => Object.hasOwn(record.outputTypes, id) && ['float64', 'typed'].includes(record.outputTypes[id].valueType))) : [];
  const activeOutput = commonOutputs.includes(output) ? output : commonOutputs[0] ?? '';
  const start = () => {
    const values = draft.split(',').map(value => Number(value.trim()));
    if (!activeTarget || values.length < 1 || values.length > 16 || values.some(value => !Number.isFinite(value)) || draft.split(',').some(value => !value.trim())) { notice('1~16개의 유한한 숫자를 쉼표로 입력하고 숫자 블록을 선택하세요.'); return; }
    void onSweep(activeTarget.id, activeTarget.blockType === 'math.gain' ? 'gain' : 'value', values);
  };
  return <>
    <header className="tool-page-heading"><div><h2>조건을 바꾸며 결과를 비교하세요</h2><p>실행 당시의 도식과 원시 결과를 보관합니다. 최근 5개 실행을 유지하며, 최대 3개의 곡선을 같은 축에서 비교할 수 있습니다.</p></div></header>
    {historyError && <p className="tool-error" role="alert">{historyError} <button className="text-button" onClick={onHistoryRecovery}>기록 원본 다운로드</button></p>}
    <section className="tool-section"><h3>파라미터 스윕</h3><div className="tool-field-grid"><label className="field"><span className="field-label">바꿀 숫자 블록</span><select aria-label="스윕 블록" value={activeTarget?.id ?? ''} onChange={event => setTarget(event.target.value)}>{targets.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label><label className="field"><span className="field-label">실행할 값</span><input aria-label="스윕 값" maxLength={1000} value={draft} onChange={event => setDraft(event.target.value)}/></label></div><p className="field-help">최대 16개 실행을 순서대로 계산합니다. 전체 실행에 30초·100만 기록 원소·5천만 연산 한도를 공유합니다.</p><div className="tool-actions"><button className="button primary" disabled={busy || !activeTarget} onClick={start}>파라미터 스윕 실행</button>{busy && <button className="button" onClick={onCancelSweep}>스윕 취소</button>}<span role="status">{sweepProgress.total ? `${sweepProgress.completed} / ${sweepProgress.total} 실행 완료` : ''}</span></div></section>
    <M19ExperimentsPanel {...props}/>
    <UncertaintyEnsemblePanel {...props}/>
    <section className="tool-section"><h3>실행 기록</h3>{!history.length && <p className="tool-empty">도식을 실행하면 이곳에 결과가 보관됩니다. 한 기록의 수치·boolean 원소 상한은 20만이며, 전체 20 MiB까지 보관합니다.</p>}<div className="history-list">{history.map(record => <article className="history-card" key={record.id}><label className="history-select"><input type="checkbox" aria-label={`${record.label} 비교 선택`} checked={validSelected.includes(record.id)} onChange={event => { if (event.target.checked && validSelected.length >= 3) { notice('한 번에 최대 3개 실행을 비교합니다.'); return; } setSelected(current => event.target.checked ? [...current.filter(id => history.some(item => item.id === id)), record.id] : current.filter(id => id !== record.id)); }}/><strong>{record.label}</strong></label><p>{new Date(record.createdAt).toLocaleString('ko-KR')} · {record.result.status === 'completed' ? '완료' : record.result.status === 'cancelled' ? '취소 · 부분 기록' : '실패 · 부분 기록'} · {record.result.samples.length} 샘플</p><details><summary>실행 출처</summary><dl className="hash-details"><dt>모델 SHA-256</dt><dd>{record.semanticHash}</dd><dt>엔진</dt><dd>{record.engineVersion}</dd></dl></details><div className="tool-actions"><button className="button" onClick={() => onRestoreRecord(record)}>이 실행의 모델 열기</button><button className="button" onClick={() => downloadText(exportResultCsv(record.result, outputLabels(record.model)), `${record.id}.csv`, 'text/csv;charset=utf-8')}>결과 CSV</button><button className="button" onClick={() => downloadText(JSON.stringify(record, null, 2), `${record.id}.json`, 'application/json;charset=utf-8')}>기록 JSON</button><button className="text-button" onClick={() => onDeleteRecord(record.id)}>기록 삭제</button></div></article>)}</div></section>
    {compare.length > 0 && <section className="tool-section experiment-scope"><h3>선택한 실행 비교 <span className="tag">{compare.length} / 3</span></h3>
      {commonOutputs.length ? <><label className="field experiment-output-field"><span className="field-label">같은 축에서 볼 출력</span><select aria-label="비교 그래프 출력" value={activeOutput} onChange={event => setOutput(event.target.value)}>{commonOutputs.map(id => <option key={id} value={id}>{outputLabels(compare[0].model)[id] ?? id} · {compare[0].outputTypes[id].unit}</option>)}</select></label><ScopePlot series={compare.map(record => ({ id: record.id, label: record.label, samples: record.result.samples, descriptor: record.outputTypes[activeOutput], status: record.result.status }))} outputId={activeOutput} label="선택한 실행 비교"/></> : <p className="field-help">선택한 실행에 공통인 수치 출력이 없습니다. 같은 도식의 실행 기록을 선택하세요.</p>}
      {compare.some(record => record.result.status !== 'completed') && <p className="field-help">부분 기록이 포함되어 있습니다. 아래 수치 비교는 기록된 구간만 사용합니다.</p>}
      {comparison?.status === 'completed' ? <div className="tool-table-scroll"><table className="tool-table" aria-label="실행 수치 비교"><thead><tr><th>출력</th><th>실행</th><th>마지막 값</th><th>기준과 차이</th><th>전체 RMSE</th></tr></thead><tbody>{comparison.outputs.flatMap(item => item.values.map(value => <tr key={`${item.nodeId}-${value.recordId}`}><td>{outputLabels(compare[0].model)[item.nodeId] ?? item.nodeId} · {item.unit}</td><td>{history.find(record => record.id === value.recordId)?.label}</td><td>{formatNumber(value.finalValue)}</td><td>{formatNumber(value.delta)}</td><td>{formatNumber(value.rmse)}</td></tr>))}</tbody></table><p className="field-help">같은 시간 격자의 공통 scalar 출력만 비교합니다. 첫 선택 기록을 기준으로 차이와 RMSE를 계산합니다.</p></div> : <p className="field-help">{comparison?.diagnostics?.[0]?.message}</p>}
    </section>}
  </>;
}
function DashboardPanel(props: ToolsProps) {
  const { model, onChange, result, notice, resultCurrent, outputTypes, busy, onScopeRange } = props;
  return <><M13DashboardPanel {...props}/><LegacyDashboardPanel {...props}/></>;
}
function LegacyDashboardPanel({ model, onChange, result, notice, resultCurrent, outputTypes, busy, onScopeRange }: ToolsProps) {
  const [kind, setKind] = useState<DashboardWidget['kind']>('display'), [target, setTarget] = useState(''), [title, setTitle] = useState('');
  const editable = model.nodes.filter(node => (node.blockType === 'source.constant' || node.blockType === 'io.input') && typeof node.parameters.value === (kind === 'toggle' ? 'boolean' : 'number') || kind === 'slider' && node.blockType === 'math.gain' && typeof node.parameters.gain === 'number');
  const outputs = model.nodes.filter(node => outputTypes[node.id]?.valueType === 'float64' && outputTypes[node.id]!.shape.length === 0);
  const targets = kind === 'slider' || kind === 'toggle' ? editable : outputs, activeTarget = targets.find(node => node.id === target) ?? targets[0];
  const add = () => {
    if (!activeTarget) return;
    const parameter = activeTarget.blockType === 'math.gain' ? 'gain' : 'value', current = activeTarget.parameters[parameter];
    const widget: DashboardWidget = { id: `widget-${crypto.randomUUID()}`, kind, title: title || activeTarget.label, nodeId: activeTarget.id,
      ...(kind === 'slider' || kind === 'toggle' ? { parameter } : {}), ...(kind === 'slider' || kind === 'gauge' ? { min: kind === 'slider' && typeof current === 'number' ? Math.min(0, current) : 0, max: kind === 'slider' && typeof current === 'number' ? Math.max(10, current) : 10, step: 0.1 } : {}) };
    onChange({ ...model, dashboard: [...(model.dashboard ?? []), widget] }); setTitle('');
  };
  const changeValue = (widget: DashboardWidget, value: number | boolean) => { onChange({ ...model, nodes: model.nodes.map(node => node.id === widget.nodeId ? { ...node, parameters: { ...node.parameters, [widget.parameter ?? 'value']: value } } : node) }); notice('대시보드 입력을 바꿨습니다. 다음 실행부터 적용됩니다.'); };
  return <><header className="tool-page-heading"><div><h2>필요한 입력과 결과를 한곳에</h2><p>입력 조절은 모델에 저장되고 다음 실행에 적용됩니다. 표시 위젯은 마지막 실행의 원시 값을 보여 줍니다.</p></div></header><section className="tool-section"><h3>위젯 추가</h3><div className="tool-field-grid"><label className="field"><span className="field-label">위젯 종류</span><select aria-label="위젯 종류" value={kind} onChange={event => { setKind(event.target.value as DashboardWidget['kind']); setTarget(''); }}><option value="slider">숫자 슬라이더</option><option value="toggle">boolean 토글</option><option value="display">값 표시</option><option value="gauge">게이지</option><option value="scope">시계열 그래프</option></select></label><label className="field"><span className="field-label">연결할 블록</span><select aria-label="위젯 블록" value={activeTarget?.id ?? ''} onChange={event => setTarget(event.target.value)}>{targets.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label><label className="field"><span className="field-label">위젯 제목</span><input aria-label="위젯 제목" maxLength={100} value={title} onChange={event => setTitle(event.target.value)}/></label></div><button className="button primary" disabled={!activeTarget || (model.dashboard?.length ?? 0) >= 16} onClick={add}>위젯 추가</button></section>{model.dashboard?.some(widget => widget.kind === 'scope') && <ScopeTimeRange execution={model.execution} samples={result?.result.samples} busy={busy} onApply={onScopeRange}/>}<div className="dashboard-grid">{model.dashboard?.map(widget => {
    const node = model.nodes.find(node => node.id === widget.nodeId), current = node?.parameters[widget.parameter ?? 'value'], value = result?.result.samples.at(-1)?.values[widget.nodeId], stale = result && !resultCurrent;
    return <article className="dashboard-card" key={widget.id}><div className="dashboard-card-heading"><h3>{widget.title}</h3><button className="text-button" aria-label={`${widget.title} 위젯 삭제`} onClick={() => onChange({ ...model, dashboard: model.dashboard?.filter(existing => existing.id !== widget.id) })}>삭제</button></div>{widget.kind === 'slider' && typeof current === 'number' ? <><label className="field"><span className="field-label">{node?.label}</span><input type="range" aria-label={`${widget.title} 슬라이더`} min={widget.min ?? 0} max={widget.max ?? 10} step={widget.step ?? 0.1} value={current} onChange={event => changeValue(widget, Number(event.target.value))}/><strong>{formatNumber(current)}</strong></label><div className="tool-field-grid compact"><label className="field"><span className="field-label">최솟값</span><input type="number" aria-label={`${widget.title} 최솟값`} value={widget.min ?? 0} onChange={event => { const min = Number(event.target.value); if (Number.isFinite(min) && min < (widget.max ?? 10)) onChange({ ...model, dashboard: model.dashboard?.map(existing => existing.id === widget.id ? { ...existing, min } : existing) }); }}/></label><label className="field"><span className="field-label">최댓값</span><input type="number" aria-label={`${widget.title} 최댓값`} value={widget.max ?? 10} onChange={event => { const max = Number(event.target.value); if (Number.isFinite(max) && max > (widget.min ?? 0)) onChange({ ...model, dashboard: model.dashboard?.map(existing => existing.id === widget.id ? { ...existing, max } : existing) }); }}/></label></div></> : widget.kind === 'toggle' && typeof current === 'boolean' ? <label className="dashboard-toggle"><input type="checkbox" aria-label={`${widget.title} 토글`} checked={current} onChange={event => changeValue(widget, event.target.checked)}/>{String(current)}</label> : <><strong className="comparison-value">{value === undefined ? '아직 실행하지 않았습니다' : signalSummary(value)}</strong>{stale && <p className="field-help">이전 실행 결과 · 다음 실행에서 갱신</p>}{widget.kind === 'gauge' && typeof value === 'number' && <meter min={widget.min ?? 0} max={widget.max ?? 10} value={value} aria-label={`${widget.title} 게이지`}/>} {widget.kind === 'scope' && typeof value === 'number' && result && <ResultPlot samples={result.result.samples} outputId={widget.nodeId} label={widget.title} descriptor={result.outputTypes[widget.nodeId]} status={result.result.status}/>}</>}</article>;
  })}</div>{!model.dashboard?.length && <p className="tool-empty">슬라이더·토글·값 표시·게이지·그래프를 추가하세요.</p>}</>;
}
function NotesPanel({ model, onChange }: ToolsProps) {
  return <><header className="tool-page-heading"><div><h2>도식과 함께 생각을 남기세요</h2><p>설명은 계산식으로 실행하지 않으며 모델 파일에 함께 보관합니다.</p></div></header><section className="tool-section"><label className="field"><span className="field-label">모델 노트</span><textarea aria-label="모델 노트" maxLength={2000} rows={14} value={model.notes ?? ''} onChange={event => onChange({ ...model, notes: event.target.value })}/><span className="field-help">{(model.notes ?? '').length} / 2,000자</span></label></section><section className="tool-section model-info"><h3>모델 정보</h3><dl><dt>모델</dt><dd>{model.name}</dd><dt>ID</dt><dd>{model.modelId}</dd><dt>블록과 연결</dt><dd>{model.nodes.length}개 · {model.edges.length}개</dd><dt>데이터</dt><dd>{model.datasets?.length ?? 0}개</dd><dt>하위 도식 정의</dt><dd>{model.subsystems?.length ?? 0}개</dd><dt>실행 방식</dt><dd>{model.execution.mode}</dd></dl></section></>;
}
