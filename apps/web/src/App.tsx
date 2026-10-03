import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Connection, type Edge, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BLOCK_REGISTRY, getBlockDefinition, getBlockPorts } from '../../../packages/block-library/src';
import { ENGINE_VERSION, MODEL_LIMITS, SOLVER_LIMITS, ModelError, normalizeSolverSettings, serializeModel, UNITS, type CalcModel, type CalcNode, type Diagnostic, type ExecutionMode, type ExecutionSettings, type SignalDescriptor, type SolverSettings } from '../../../packages/model/src';
import { compileModel } from '../../../packages/compiler/src';
import { createSubsystemFromSelection } from '../../../packages/compiler/src/hierarchy';
import { runParameterSweep } from '../../../packages/experiments/src';
import { createExportManifest } from '../../../packages/codegen-ts/src/manifest';
import { EXAMPLES, createBlockNode, createEmptyModel, createExample } from './examples';
import { cancelActiveRun, executeInWorker, pauseActiveRun, resumeActiveRun, WorkerRunError, type WorkerRun } from './worker-client';
import { createExportArchive, exportArchiveReadme, EXPORT_RUN_EXAMPLE, pythonArchiveReadme, PYTHON_RUN_EXAMPLE } from './export-download';
import { loadLocalModel, saveLocalModel, loadRecoverySnapshot, loadRunHistory, saveRunHistory, loadRawRunHistory, subscribeLocalWorkspace, waitForLocalWrites, type RecoverySnapshot } from './persistence';
import { appendHistory, historySnapshot, type HistoryRecord } from './run-history';
import { hierarchyView, applyHierarchyView, updateSubsystemInstances } from './hierarchy-editor';
import { outputLabels } from './output-labels';
import { M4WorkspaceTools, WorkspaceTabs, downloadText, type WorkspaceTab } from './components/M4WorkspaceTools';
import { copySelection, deleteSelection, pasteSelection, type ModelClipboard } from './editor-commands';
import { BlockNode, BLOCK_SYMBOLS, blockTone, type FlowBlock } from './components/BlockNode';
import { Icon } from './components/Icon';
import { ResultPlot, formatNumber } from './components/ResultPlot';
import { ScopeTimeRange } from './components/ScopeTimeRange';
import { M5ParameterGuide } from './components/M5ParameterGuide';
import { ResultTable } from './components/ResultTable';
import { RunBrand } from './components/RunBrand';
import { SignalField, ExpressionField, NumericVectorField } from './components/SignalField';
import { descriptorLabel, signalSummary } from './components/SignalResult';
import { TemporalSignalResult } from './components/TemporalSignalResult';
import { SolverRunDetails } from './components/SolverRunDetails';
import { QuickInsert, type InsertItem } from './components/QuickInsert';
import { SupportDialog } from './components/SupportDialog';
import { useModalDialog } from './components/ModalDialog';
import { registerOfflineSupport, type OfflineController, type OfflineStatus } from './offline';
import { OfflineBanner } from './components/OfflineBanner';
import { recordLocalOperation } from './local-operations';
import { LocalDataDialog } from './components/LocalDataDialog';
import { CodeExportDialog, type CodeTarget } from './components/CodeExportDialog';
import { ModelPackageDialog } from './components/ModelPackageDialog';
import { ModelImportReportDialog, type ModelImportReport } from './components/ModelImportReportDialog';
import { ExampleCatalog } from './components/ExampleCatalog';
import './styles.css';

const nodeTypes = { calcBlock: BlockNode };
const READABLE_VIEW = { padding: 0.12, minZoom: 0.8, maxZoom: 1.05 };
const CANVAS_ARIA_LABELS = {
  'node.a11yDescription.default': 'Enter로 블록 속성을 편집합니다. 방향키로 이동하고 Space로 도식을 맞춥니다. Delete로 삭제하고 Esc로 선택을 취소합니다.',
  'node.a11yDescription.keyboardDisabled': 'Enter로 블록 속성을 편집합니다. 방향키로 이동하고 Space로 도식을 맞춥니다. Delete로 삭제하고 Esc로 선택을 취소합니다.',
  'edge.a11yDescription.default': 'Enter로 연결을 선택합니다. Space로 도식을 맞춥니다. Delete로 삭제하고 Esc로 선택을 취소합니다.',
  'controls.ariaLabel': '캔버스 보기 도구',
  'controls.zoomIn.ariaLabel': '캔버스 확대',
  'controls.zoomOut.ariaLabel': '캔버스 축소',
  'controls.fitView.ariaLabel': '도식 맞추기',
  'controls.interactive.ariaLabel': '캔버스 편집 전환',
};
const MODE_LABELS: Record<ExecutionMode, string> = { static: '정적 계산', discrete: '이산 시뮬레이션', continuous: '연속·혼합 시뮬레이션' };
const RUN_LABELS = { ready: '계산 준비', validating: '모델 확인 중', running: '계산 중', paused: '일시정지', completed: '계산 완료', cancelled: '계산 취소됨', failed: '설정 확인 필요' };
const SAVE_LABELS = { loading: '저장 확인 중', changed: '변경됨', saving: '브라우저에 저장 중', saved: '브라우저에 저장됨', failed: '저장 실패 · 파일로 보관하세요' };
const OPTION_LABELS: Record<string, string> = { multiply: '곱하기', divide: '나누기', min: '최솟값', max: '최댓값', pairwise: '두 입력의 원소끼리', reduce: '한 신호 전체 집계', round: '반올림', floor: '내림', ceil: '올림', trunc: '소수점 절삭', eq: '같음 (=)', ne: '다름 (≠)', lt: '작음 (<)', le: '작거나 같음 (≤)', gt: '큼 (>)', ge: '크거나 같음 (≥)', and: 'AND · 모두 참', or: 'OR · 하나 이상 참', xor: 'XOR · 서로 다름', not: 'NOT · 반전', vector: '벡터', matrix: '2D 행렬', none: '사용 안 함', level: 'level · true면 다음 상태 초기화', uniform: '균등 분포', normal: '정규 분포', linear: '선형 보간', previous: '이전 값 유지', clip: '경계값 유지', error: '범위 밖 오류', rising: 'false → true', falling: 'true → false', either: '모든 변화', 'shift-left': '왼쪽 shift · wrap', 'shift-right': '오른쪽 logical shift', nearest: '가장 가까운 값', signed: '부호 있음', unsigned: '부호 없음', 'nearest-even': '최근접 · 절반은 짝수', 'toward-zero': '0 방향 절삭', saturate: '경계 정수로 제한', wrap: '저장 비트 순환' };
type RunState = keyof typeof RUN_LABELS;
type SaveState = keyof typeof SAVE_LABELS;
type RunRecord = WorkerRun & { semanticKey: string; model: CalcModel; outputIds: string[]; outputTypes: Record<string, SignalDescriptor>; completedAt: string };
const NumericValidityContext = createContext<(id: string, invalid: boolean) => void>(() => {});

function isCanvasControl(target: EventTarget | null): boolean {
  return !(target instanceof Element)
    || !!target.closest('button, a[href], input, textarea, select, summary, [role="textbox"], [role="combobox"], [role="slider"], [role="button"]:not(.react-flow__node)')
    || (target instanceof HTMLElement && target.isContentEditable);
}

function initialTheme(): 'light' | 'dark' {
  try {
    const preference = localStorage.getItem('calcweave.theme');
    if (preference === 'light' || preference === 'dark') return preference;
  } catch { /* A blocked preference store must not prevent the editor from opening. */ }
  return 'dark';
}

function errorDiagnostics(error: unknown): Diagnostic[] {
  if (error instanceof ModelError) return error.diagnostics;
  if (error && typeof error === 'object' && 'diagnostics' in error && Array.isArray(error.diagnostics)) return error.diagnostics as Diagnostic[];
  return [{ code: 'ACTION_FAILED', message: error instanceof Error ? error.message : '작업을 완료하지 못했습니다. 다시 시도해 주세요.' }];
}

function NumericField({ label, value, onChange, min = -Number.MAX_VALUE, max = Number.MAX_VALUE, suffix, integer = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; suffix?: string; integer?: boolean }) {
  const fieldId = useId();
  const setValidity = useContext(NumericValidityContext);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(String(value)); setError(''); }, [value]);
  useEffect(() => {
    const number = Number(draft);
    setValidity(fieldId, !draft.trim() || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number)));
    return () => setValidity(fieldId, false);
  }, [draft, fieldId, setValidity, min, max, integer]);
  const apply = () => {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) { setError(`${min} ~ ${max} 범위의 ${integer ? '정수' : '유한한 수'}를 입력하세요.`); return; }
    setError(''); onChange(number);
  };
  return <label className={`field ${error ? 'field-error' : ''}`}><span className="field-label">{label}</span><span className="number-field"><input type="text" inputMode="decimal" aria-label={label} value={draft} aria-invalid={!!error} onChange={(event) => setDraft(event.target.value.slice(0, 64))} onBlur={apply} onKeyDown={(event) => { if (event.key === 'Enter') { apply(); event.currentTarget.blur(); } if (event.key === 'Escape') { setDraft(String(value)); setError(''); } }} />{suffix && <span>{suffix}</span>}</span>{error && <span className="field-message">{error}</span>}</label>;
}

const CONTINUOUS_RATE_LOCKED = new Set(['continuous.integrator', 'continuous.second-order-integrator', 'continuous.state-space', 'continuous.transfer-function', 'continuous.zero-pole', 'continuous.pid', 'continuous.derivative', 'time.memory', 'time.transport-delay', 'source.step', 'source.ramp', 'source.sine-wave', 'source.repeating-sequence', 'source.clock', 'logic.hit-crossing', 'nonlinear.relay']);
const FIXED_DISCRETE_BLOCKS = new Set(['source.random', 'source.digital-clock', 'source.pulse', 'logic.edge-detect', 'time.rate-transition', 'time.zero-order-hold', 'time.first-order-hold']);

function SampleTimeEditor({ node, step, hybrid = false, onChange }: { node: CalcNode; step: number; hybrid?: boolean; onChange: (sampleTime: CalcNode['sampleTime']) => void }) {
  const rate = node.sampleTime ?? { period: 1, offset: 0 };
  const defaultDiscrete = node.blockType.startsWith('discrete.') || FIXED_DISCRETE_BLOCKS.has(node.blockType);
  const inheritedRate = !defaultDiscrete && !node.blockType.startsWith('source.') && node.blockType !== 'io.input';
  const inheritedRateHelp = '일반 계산·Scope의 기본 1배·0 offset은 이산 입력의 주기를 상속합니다. manifest에는 실제 실행 계획의 주기가 기록됩니다.';
  if (hybrid && inheritedRate && !node.sampleTime) return <section className="inspector-section sample-time-section"><h3>샘플시간</h3><p className="field-help">연속 입력은 solver의 각 평가 시점에 계산하고, 이산 입력은 해당 샘플 주기를 따릅니다. 고정 이산 주기를 지정하면 tick 사이에는 마지막 값을 유지합니다.</p><p className="field-help">{inheritedRateHelp}</p><button className="text-button" onClick={() => onChange({ period: 1, offset: 0 })}>고정 이산 주기 지정</button></section>;
  return <section className="inspector-section sample-time-section"><h3>샘플시간</h3>{node.blockType === 'source.clock' ? <p className="field-help">Clock은 모든 base tick의 시간을 표시하며 1배 주기·0 offset으로 실행됩니다.</p> : <><div className="field-pair"><NumericField label="샘플 주기 배수" value={rate.period} min={1} max={10000} integer onChange={period => onChange({ period, offset: Math.min(rate.offset, period - 1) })}/><NumericField label="첫 실행 tick" value={rate.offset} min={0} max={rate.period - 1} integer onChange={offset => onChange({ ...rate, offset })}/></div><p className="field-help">{rate.period} base tick마다 실행 · 주기 {formatNumber(rate.period * step)} s · 첫 실행 offset {rate.offset} tick. 실행 사이에는 마지막 값을 유지합니다.</p>{node.sampleTime && <button className="text-button" onClick={() => onChange(undefined)}>기본 1배 주기로 되돌리기</button>}</>}{inheritedRate && rate.period === 1 && rate.offset === 0 && <p className="field-help">{inheritedRateHelp}</p>}<p className="field-help sample-time-note">{node.blockType === 'time.rate-transition' ? 'Rate Transition은 이 출력 주기에서 이전 발행값을 읽습니다. 입력은 연결한 블록의 주기를 따르며, 동시에 실행해도 이전 발행값을 읽습니다.' : node.blockType === 'source.constant' || node.blockType === 'io.input' ? '이 블록의 설정 값은 서로 다른 주기의 입력에도 직접 연결할 수 있습니다. Rate Transition으로 연결하면 지정한 샘플 주기에 값을 발행합니다.' : '다른 주기의 블록 사이는 Rate Transition으로 연결하세요. 초 단위 주기는 정수 배수 × 실행 시간 간격이며 비정수 배수는 지원하지 않습니다.'}</p></section>;
}

function solverDraftSettings(execution: ExecutionSettings): SolverSettings {
  return { ...normalizeSolverSettings({ ...execution, solver: undefined }), ...execution.solver };
}

function executionForMode(execution: ExecutionSettings, mode: ExecutionMode): ExecutionSettings {
  const { solver, ...timeSettings } = execution;
  return { ...timeSettings, mode, ...(mode === 'continuous' && solver ? { solver } : {}) };
}

function SolverSettingsEditor({ execution, onChange }: { execution: ExecutionSettings; onChange: (solver: Partial<SolverSettings>) => void }) {
  const settings = solverDraftSettings(execution);
  const change = <K extends keyof SolverSettings>(key: K, value: SolverSettings[K]) => onChange({ ...execution.solver, [key]: value });
  return <section className="solver-settings" aria-label="연속 solver 설정"><label className="field"><span className="field-label">적분 방법</span><select aria-label="적분 방법" value={settings.method} onChange={event => change('method', event.target.value as SolverSettings['method'])}><option value="rk4">RK4 · 고정 내부 간격</option><option value="rk45">RK45 · 오차 제어</option></select></label><p className="field-help">위 시간 간격은 결과를 기록하는 출력 격자입니다. solver 내부 간격은 별도로 설정하며 이벤트와 이산 tick에 맞춰 짧아질 수 있습니다.</p><div className="field-pair"><NumericField label="초기 내부 간격" value={settings.initialStep} min={SOLVER_LIMITS.minStep} max={SOLVER_LIMITS.maxStep} suffix="s" onChange={value => change('initialStep', value)}/><NumericField label="최대 내부 간격" value={settings.maxStep} min={SOLVER_LIMITS.minStep} max={SOLVER_LIMITS.maxStep} suffix="s" onChange={value => change('maxStep', value)}/></div><NumericField label="최소 내부 간격" value={settings.minStep} min={SOLVER_LIMITS.minStep} max={SOLVER_LIMITS.maxStep} suffix="s" onChange={value => change('minStep', value)}/>{settings.method === 'rk45' && <div className="field-pair"><NumericField label="절대 오차 허용값" value={settings.atol} min={SOLVER_LIMITS.minTolerance} max={SOLVER_LIMITS.maxTolerance} onChange={value => change('atol', value)}/><NumericField label="상대 오차 허용값" value={settings.rtol} min={SOLVER_LIMITS.minTolerance} max={SOLVER_LIMITS.maxTolerance} onChange={value => change('rtol', value)}/></div>}<NumericField label="이산 기본 간격" value={settings.discreteStep} min={MODEL_LIMITS.minStep} max={MODEL_LIMITS.maxTime} suffix="s" onChange={value => change('discreteStep', value)}/><p className="field-help">혼합 모델의 샘플 주기는 이산 기본 간격 × 정수 배수입니다. 연속 상태는 이 사이에도 적분됩니다.</p><details className="solver-advanced"><summary>이벤트와 실행 상한</summary><NumericField label="이벤트 시간 허용값" value={settings.eventTolerance} min={SOLVER_LIMITS.minEventTolerance} max={SOLVER_LIMITS.maxEventTolerance} suffix="s" onChange={value => change('eventTolerance', value)}/><NumericField label="최대 수락 스텝" value={settings.maxSteps} min={1} max={SOLVER_LIMITS.maxSteps} integer onChange={value => change('maxSteps', value)}/><NumericField label="최대 거절 스텝" value={settings.maxRejects} min={0} max={SOLVER_LIMITS.maxRejects} integer onChange={value => change('maxRejects', value)}/><NumericField label="최대 미분 평가" value={settings.maxEvaluations} min={1} max={SOLVER_LIMITS.maxEvaluations} integer onChange={value => change('maxEvaluations', value)}/><NumericField label="최대 이벤트" value={settings.maxEvents} min={1} max={SOLVER_LIMITS.maxEvents} integer onChange={value => change('maxEvents', value)}/></details></section>;
}

function Workspace() {
  const [rootModel, setRootModel] = useState<CalcModel>(() => createExample(EXAMPLES[0].id));
  const rootRef = useRef(rootModel);
  const [hierarchyPath, setHierarchyPath] = useState<string[]>([]);
  const pathRef = useRef(hierarchyPath);
  const view = hierarchyView(rootModel, hierarchyPath);
  const model = view.model;
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('diagram');
  const [runHistory, setRunHistory] = useState<HistoryRecord[]>([]);
  const historyRef = useRef<HistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState('');
  const historyWritable = useRef(false);
  const historySaveQueue = useRef<Promise<void>>(Promise.resolve());
  const modelSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const storageMaintenance = useRef(false);
  const [sweepProgress, setSweepProgress] = useState({ completed: 0, total: 0 });
  const sweepAbort = useRef<AbortController | null>(null);
  const [nameDraft, setNameDraft] = useState(model.name);
  const modelRef = useRef(model);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedEdgeId = selectedEdgeIds.length === 1 ? selectedEdgeIds[0] : null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  const setSelectedEdgeId = (id: string | null) => setSelectedEdgeIds(id ? [id] : []);
  const [search, setSearch] = useState('');
  const [runState, setRunState] = useState<RunState>('ready');
  const [runMode, setRunMode] = useState<ExecutionMode>('static');
  const [activityKey, setActivityKey] = useState(0);
  const [controlPending, setControlPending] = useState<'pause' | 'resume' | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);
  const [progress, setProgress] = useState({ steps: 0, time: 0 });
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [loaded, setLoaded] = useState(false);
  const [localSavingEnabled, setLocalSavingEnabled] = useState(false);
  const [resetIncomplete, setResetIncomplete] = useState(false);
  const [storageConflict, setStorageConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [codeExportOpen, setCodeExportOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [importReport, setImportReport] = useState<ModelImportReport | null>(null);
  const [importReportOpen, setImportReportOpen] = useState(false);
  const importRequest = useRef(0);
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const offlineController = useRef<OfflineController | null>(null);
  const [quickInsertOpen, setQuickInsertOpen] = useState(false);
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(null);
  const [recoveryError, setRecoveryError] = useState('');
  const recoveryDialog = useRef<HTMLDialogElement>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [resultsTab, setResultsTab] = useState<'results' | 'diagnostics'>('results');
  const [plotId, setPlotId] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [connectingFrom, setConnectingFrom] = useState('');
  const [connectingPort, setConnectingPort] = useState('');
  const [invalidNumericCount, setInvalidNumericCount] = useState(0);
  const invalidNumericIds = useRef(new Set<string>());
  const past = useRef<CalcModel[]>([]);
  const future = useRef<CalcModel[]>([]);
  const dragSnapshot = useRef<CalcModel | null>(null);
  const clipboard = useRef<ModelClipboard | null>(null);
  const pasteOffset = useRef(48);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const examplesTrigger = useRef<HTMLButtonElement>(null);
  const activeRun = useRef(0);
  const { fitView, viewportInitialized } = useReactFlow<FlowBlock>();
  // Measurements live in React Flow; they are deliberately excluded from model/history.
  const nodesMeasured = useStore(state => state.nodeLookup.size === model.nodes.length && model.nodes.every(block => {
    const node = state.nodeLookup.get(block.id);
    return node?.data.block === block && (node.measured.width ?? 0) > 0 && (node.measured.height ?? 0) > 0;
  }));
  const canvasMeasured = useStore(state => state.width > 0 && state.height > 0);
  const initialFitRequested = useRef(false);
  const lastSubsystemClick = useRef<{ id: string; time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('calcweave.theme', theme); } catch { /* Preference is optional. */ }
  }, [theme]);
  useEffect(() => {
    let alive = true;
    void registerOfflineSupport(status => { if (alive) setOfflineStatus(status); }).then(controller => { if (alive) offlineController.current = controller; else controller.dispose(); });
    return () => { alive = false; offlineController.current?.dispose(); offlineController.current = null; };
  }, []);
  useEffect(() => subscribeLocalWorkspace(() => { setStorageConflict(true); setLocalSavingEnabled(false); setSaveState('failed'); historyWritable.current = false; setNotice('다른 탭에서 저장 공간이 바뀌었습니다. 현재 작업을 백업한 뒤 최신 저장본을 불러오세요.'); }), []);
  const setNumericValidity = useCallback((id: string, invalid: boolean) => {
    if (invalid) invalidNumericIds.current.add(id); else invalidNumericIds.current.delete(id);
    setInvalidNumericCount(invalidNumericIds.current.size);
  }, []);
  useEffect(() => setNameDraft(model.name), [model.name]);

  const applyRoot = useCallback((next: CalcModel) => {
    rootRef.current = next; setRootModel(next);
    let nextView = hierarchyView(next, pathRef.current);
    if (nextView.trail.length !== pathRef.current.length) { pathRef.current = []; setHierarchyPath([]); nextView = hierarchyView(next, []); }
    modelRef.current = nextView.model;
  }, []);
  const applyModel = useCallback((next: CalcModel) => applyRoot(applyHierarchyView(rootRef.current, pathRef.current, next)), [applyRoot]);
  const commit = useCallback((transform: (current: CalcModel) => CalcModel) => {
    const current = modelRef.current;
    const next = transform(current);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    past.current = [...past.current.slice(-49), rootRef.current]; future.current = [];
    applyModel(next); setHistoryVersion((value) => value + 1); setDiagnostics([]);
  }, [applyModel]);
  const commitRoot = useCallback((transform: (current: CalcModel) => CalcModel) => {
    const current = rootRef.current, next = transform(current);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    past.current = [...past.current.slice(-49), current]; future.current = [];
    applyRoot(next); setHistoryVersion(value => value + 1); setDiagnostics([]);
  }, [applyRoot]);
  const navigateHierarchy = (path: string[]) => {
    pathRef.current = path; setHierarchyPath(path); modelRef.current = hierarchyView(rootRef.current, path).model;
    setSelectedIds([]); setSelectedEdgeIds([]); setWorkspaceTab('diagram');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => void fitView({ ...READABLE_VIEW, duration: 0 })));
  };
  const replaceRoot = (next: CalcModel) => { navigateHierarchy([]); commitRoot(() => next); };
  const undo = useCallback(() => {
    const previous = past.current.pop(); if (!previous) return;
    future.current.push(rootRef.current); applyRoot(previous); setHistoryVersion((value) => value + 1); setDiagnostics([]);
  }, [applyRoot]);
  const redo = useCallback(() => {
    const next = future.current.pop(); if (!next) return;
    past.current.push(rootRef.current); applyRoot(next); setHistoryVersion((value) => value + 1); setDiagnostics([]);
  }, [applyRoot]);
  // History refs are bounded and this revision makes the controls reflect every command.
  void historyVersion;

  useEffect(() => {
    let alive = true;
    const initial = rootRef.current;
    loadLocalModel().then((saved) => {
      if (!alive) return;
      if (saved && rootRef.current === initial) { applyRoot(saved); setNotice('이 브라우저에 저장한 모델을 불러왔습니다.'); }
      setSaveState(saved ? 'saved' : 'changed'); setLocalSavingEnabled(true); setLoaded(true);
    }).catch(() => { if (alive) { setLoaded(true); setSaveState('failed'); setLocalSavingEnabled(false); setNotice('저장된 모델을 읽지 못해 자동 저장을 멈췄습니다. 기존 저장본은 유지됩니다.'); } });
    return () => { alive = false; activeRun.current += 1; cancelActiveRun(); };
  }, [applyRoot]);
  useEffect(() => {
    let alive = true;
    loadRunHistory().then(records => { if (alive) { historyRef.current = records; setRunHistory(records); historyWritable.current = true; } }).catch(error => { if (alive) { setHistoryError(error instanceof Error ? error.message : '실행 기록을 읽지 못했습니다. 원본은 보존됩니다.'); historyWritable.current = false; } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // Fit the restored model, after both its blocks and the actual canvas are measured.
    // A one-time request preserves subsequent user pan/zoom, including edits and runs.
    if (!loaded || !viewportInitialized || !canvasMeasured || initialFitRequested.current) return;
    if (!model.nodes.length) { initialFitRequested.current = true; return; }
    if (!nodesMeasured) return;
    initialFitRequested.current = true;
    void fitView({ ...READABLE_VIEW, duration: 0 });
  }, [loaded, viewportInitialized, canvasMeasured, nodesMeasured, model.nodes.length, fitView]);

  useEffect(() => {
    if (!loaded || !localSavingEnabled || storageMaintenance.current) return;
    setSaveState('changed');
    let alive = true;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      if (storageMaintenance.current) return;
      modelSaveQueue.current = modelSaveQueue.current.catch(() => {}).then(() => { if (storageMaintenance.current) return; return saveLocalModel(rootModel); });
      modelSaveQueue.current.then(() => { if (alive) setSaveState('saved'); }).catch(() => { if (alive) setSaveState('failed'); });
    }, 500);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [rootModel, loaded, localSavingEnabled]);

  const compiledPreview = useMemo(() => { try { return compileModel(rootModel); } catch { return null; } }, [rootModel]);
  const semanticKey = compiledPreview?.semanticKey ?? null;
  const currentResult = !!lastRun && lastRun.semanticKey === semanticKey && invalidNumericCount === 0;
  const selected = model.nodes.find((node) => node.id === selectedId);
  const selectedBoundary = !!view.definition && [...view.definition.inputs, ...view.definition.outputs].some(port => port.nodeId === selectedId);
  const selectedDefinition = selected ? getBlockDefinition(selected.blockType) : undefined;
  const selectedPorts = selected ? getBlockPorts(selected, model) : { inputs: [], outputs: [] };
  const selectedIR = selected ? compiledPreview?.nodes.find(node => node.id === selected.id) : undefined;
  const selectedType = selectedIR?.outputs.out ?? selectedIR?.outputs[selectedPorts.outputs.includes(connectingPort) ? connectingPort : selectedPorts.outputs[0]];
  const finalSample = lastRun?.result.samples.at(-1);
  const busy = runState === 'running' || runState === 'validating' || runState === 'paused';
  const errorIds = useMemo(() => new Set(diagnostics.flatMap((diagnostic) => diagnostic.nodeId ? [diagnostic.nodeId] : [])), [diagnostics]);
  const nodes = useMemo<FlowBlock[]>(() => model.nodes.map((block, index) => ({
    id: block.id, type: 'calcBlock', position: model.layout[block.id] ?? { x: 100 + index * 240, y: 140 },
    selected: selectedIds.includes(block.id),
    ariaLabel: `${block.label}, ${getBlockDefinition(block.blockType)?.englishName ?? block.blockType}, ${errorIds.has(block.id) ? '설정 확인 필요' : '블록'}`,
    data: { block, boundary: !!view.definition && [...view.definition.inputs, ...view.definition.outputs].some(port => port.nodeId === block.id), ports: getBlockPorts(block, model), error: errorIds.has(block.id), result: finalSample?.values[block.id], current: currentResult },
  })), [model, view.definition, selectedIds, errorIds, finalSample, currentResult]);
  const edges = useMemo<Edge[]>(() => model.edges.map((edge) => ({ id: edge.id, source: edge.source.nodeId, sourceHandle: edge.source.portId, target: edge.target.nodeId, targetHandle: edge.target.portId, selected: selectedEdgeIds.includes(edge.id), type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 }, ariaLabel: `${model.nodes.find((node) => node.id === edge.source.nodeId)?.label ?? '블록'}에서 ${model.nodes.find((node) => node.id === edge.target.nodeId)?.label ?? '블록'} ${edge.target.portId} 입력으로 연결` })), [model, selectedEdgeIds]);

  const filteredBlocks = BLOCK_REGISTRY.filter((definition) => `${definition.label} ${definition.englishName} ${definition.description} ${definition.id} ${definition.aliases?.join(' ') ?? ''} ${BLOCK_SYMBOLS[definition.id] ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const categories = [...new Set(filteredBlocks.map((definition) => definition.category))];

  const addBlock = (type: string, parameters?: Record<string, unknown>) => {
    if (modelRef.current.nodes.length >= 1000) { setNotice('최대 1,000개의 블록을 만들 수 있습니다.'); return; }
    const node = createBlockNode(type, modelRef.current.nodes.length);
    if (parameters) node.parameters = { ...node.parameters, ...parameters };
    commit((current) => ({ ...current, nodes: [...current.nodes, node], layout: { ...current.layout, [node.id]: { x: 100 + current.nodes.length % 3 * 240, y: 100 + Math.floor(current.nodes.length / 3) * 170 } } }));
    setSelectedId(node.id); setSelectedEdgeId(null); setNotice(`${node.label} 블록을 추가했습니다.`);
  };
  const removeSelection = useCallback(() => {
    if (!selectedIds.length && !selectedEdgeIds.length) return;
    commit(current => deleteSelection(current, { nodes: selectedIds, edges: selectedEdgeIds }));
    setSelectedIds([]); setSelectedEdgeIds([]); setNotice('선택한 블록과 연결을 삭제했습니다. 실행 취소로 되돌릴 수 있습니다.');
  }, [selectedIds, selectedEdgeIds, commit]);
  const copyBlocks = useCallback(() => {
    const copied = copySelection(modelRef.current, { nodes: selectedIds, edges: selectedEdgeIds });
    if (!copied) return;
    clipboard.current = copied; pasteOffset.current = 48; setNotice(`${copied.nodes.length}개 블록과 내부 연결을 복사했습니다.`);
  }, [selectedIds, selectedEdgeIds]);
  const pasteBlocks = useCallback((duplicate = false) => {
    const copied = duplicate ? copySelection(modelRef.current, { nodes: selectedIds, edges: selectedEdgeIds }) : clipboard.current;
    if (!copied) { setNotice('블록을 선택해 먼저 복사하세요.'); return; }
    try {
      const pasted = pasteSelection(modelRef.current, copied, duplicate ? 48 : pasteOffset.current);
      commit(() => pasted.model); setSelectedIds(pasted.selectedIds); setSelectedEdgeIds([]); pasteOffset.current = Math.min(pasteOffset.current + 48, 10000);
      setNotice(`${copied.nodes.length}개 블록을 ${duplicate ? '복제' : '붙여넣기'}했습니다.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '블록을 붙여넣지 못했습니다.'); }
  }, [selectedIds, selectedEdgeIds, commit]);
  const updateBlock = (update: Partial<CalcNode>) => {
    if (!selected) return;
    commit(current => {
      const next = { ...selected, ...update };
      if (next.unit === undefined) delete next.unit;
      if (next.sampleTime === undefined) delete next.sampleTime;
      const ports = getBlockPorts(next, current);
      const edges = current.edges.filter(edge => (edge.source.nodeId !== next.id || ports.outputs.includes(edge.source.portId)) && (edge.target.nodeId !== next.id || ports.inputs.includes(edge.target.portId)));
      if (edges.length !== current.edges.length) setNotice('포트 설정을 바꾸면서 없어진 포트의 연결을 정리했습니다. 실행 취소로 복원할 수 있습니다.');
      return { ...current, nodes: current.nodes.map(node => node.id === next.id ? next : node), edges };
    });
  };
  const isValidConnection = (connection: Connection | Edge) => {
    const source = modelRef.current.nodes.find((node) => node.id === connection.source);
    const target = modelRef.current.nodes.find((node) => node.id === connection.target);
    if (!source || !target || !connection.sourceHandle || !connection.targetHandle) return false;
    if (!getBlockPorts(source, modelRef.current).outputs.includes(connection.sourceHandle) || !getBlockPorts(target, modelRef.current).inputs.includes(connection.targetHandle)) return false;
    return !modelRef.current.edges.some((edge) => edge.target.nodeId === target.id && edge.target.portId === connection.targetHandle);
  };
  const connect = (connection: Connection) => {
    if (!isValidConnection(connection)) { setNotice('연결할 입력이 이미 사용 중이거나 포트 방향이 다릅니다. 기존 연결을 지운 뒤 연결하세요.'); return; }
    commit((current) => ({ ...current, edges: [...current.edges, { id: `edge-${crypto.randomUUID()}`, source: { nodeId: connection.source!, portId: connection.sourceHandle! }, target: { nodeId: connection.target!, portId: connection.targetHandle! } }] }));
    setNotice('블록을 연결했습니다.');
  };
  const onNodesChange = (changes: NodeChange<FlowBlock>[]) => {
    for (const change of changes) {
      if (change.type === 'select') setSelectedIds(current => change.selected ? [...new Set([...current, change.id])] : current.filter(id => id !== change.id));
      if (change.type === 'position' && change.position) {
        const current = modelRef.current;
        const next = { ...current, layout: { ...current.layout, [change.id]: change.position } };
        if (dragSnapshot.current) applyModel(next); else commit(() => next);
      }
      if (change.type === 'remove') commit((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== change.id), edges: current.edges.filter((edge) => edge.source.nodeId !== change.id && edge.target.nodeId !== change.id) }));
    }
  };

  const storeHistory = useCallback(async (snapshot: CalcModel, execution: WorkerRun, compiled: ReturnType<typeof compileModel>, label?: string) => {
    try {
      const manifest = await createExportManifest(compiled);
      const record = historySnapshot({ id: `run-${crypto.randomUUID()}`, label: (label ?? snapshot.name).slice(0, 100), createdAt: new Date().toISOString(), model: JSON.parse(serializeModel(compiled.model)) as CalcModel, semanticHash: manifest.modelHash, engineVersion: execution.engineVersion, manifest, result: execution.result, outputIds: compiled.outputIds, outputTypes: compiled.outputTypes });
      const records = appendHistory(historyRef.current, record); historyRef.current = records; setRunHistory(records);
      if (historyWritable.current) historySaveQueue.current = historySaveQueue.current.then(() => saveRunHistory(records)).catch(error => { historyWritable.current = false; setHistoryError(error instanceof Error ? error.message : '실행 기록 저장을 멈췄습니다. 원본은 보존됩니다.'); });
      return record;
    } catch (error) { setNotice(`결과는 표시되지만 실행 기록으로 저장하지 못했습니다: ${error instanceof Error ? error.message : '기록 한도 초과'}`); return null; }
  }, []);

  const run = useCallback(async () => {
    if (busy) return;
    if (invalidNumericIds.current.size) { setRunState('failed'); setDiagnostics([{ code: 'INVALID_NUMBER_DRAFT', message: '편집 중인 입력값이나 수식을 확인한 뒤 다시 계산하세요.' }]); setResultsTab('diagnostics'); return; }
    const sequence = ++activeRun.current;
    setActivityKey(sequence);
    const snapshot = structuredClone(rootRef.current);
    setRunMode(snapshot.execution.mode);
    setRunState('validating'); setControlPending(null); setDiagnostics([]); setResultsTab('results'); setProgress({ steps: 0, time: 0 });
    let compiled: ReturnType<typeof compileModel> | undefined;
    try {
      compiled = compileModel(snapshot);
      setRunState('running');
      const execution = await executeInWorker(snapshot, (next) => { if (activeRun.current === sequence) setProgress(next); }, paused => {
        if (activeRun.current === sequence) { setRunState(paused ? 'paused' : 'running'); setControlPending(null); }
      });
      if (activeRun.current !== sequence) return;
      const outputIds = compiled.outputIds;
      setLastRun({ ...execution, semanticKey: compiled.semanticKey, model: snapshot, outputIds, outputTypes: compiled.outputTypes, completedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Seoul' }) });
      setPlotId(outputIds[0] ?? ''); setRunState(execution.result.status); setControlPending(null);
      await storeHistory(snapshot, execution, compiled);
    } catch (error) {
      if (activeRun.current !== sequence) return;
      setControlPending(null);
      if (error instanceof Error && error.name === 'AbortError') { setRunState('cancelled'); return; }
      recordLocalOperation(compiled ? 'WORKER_RUNTIME_FAILED' : 'MODEL_VALIDATION_FAILED', compiled ? 'run' : 'validation');
      if (error instanceof ModelError && error.partialResult && compiled) {
        setLastRun({ result: error.partialResult, semanticHash: error instanceof WorkerRunError ? error.semanticHash : '', engineVersion: error instanceof WorkerRunError ? error.engineVersion : ENGINE_VERSION, semanticKey: compiled.semanticKey, model: snapshot, outputIds: compiled.outputIds, outputTypes: compiled.outputTypes, completedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Seoul' }) });
        setPlotId(compiled.outputIds[0] ?? '');
        await storeHistory(snapshot, { result: error.partialResult, semanticHash: error instanceof WorkerRunError ? error.semanticHash : '', engineVersion: error instanceof WorkerRunError ? error.engineVersion : ENGINE_VERSION }, compiled);
      }
      setRunState('failed'); setDiagnostics(errorDiagnostics(error)); setResultsTab('diagnostics');
    }
  }, [busy, storeHistory]);
  const applyScopeRange = async (startTime: number, stopTime: number) => {
    if (busy) return;
    if (invalidNumericIds.current.size) throw new ModelError([{ code: 'INVALID_NUMBER_DRAFT', message: '편집 중인 입력값이나 수식을 확인한 뒤 시간 범위를 적용하세요.' }]);
    const current = rootRef.current;
    if (current.execution.mode === 'static') throw new ModelError([{ code: 'SCOPE_TIME_MODE', message: '시간 범위는 이산·연속 시뮬레이션에서 사용할 수 있습니다.' }]);
    const next = { ...current, execution: { ...current.execution, startTime, stopTime } };
    compileModel(next);
    commitRoot(() => next);
    await run();
  };
  const cancel = useCallback(() => { sweepAbort.current?.abort(); cancelActiveRun(); if (!sweepAbort.current) activeRun.current += 1; setControlPending(null); setRunState('cancelled'); setNotice('계산을 취소했습니다.'); }, []);
  const pauseOrResume = () => {
    const requested = runState === 'paused' ? resumeActiveRun() : pauseActiveRun();
    if (requested) { setControlPending(runState === 'paused' ? 'resume' : 'pause'); setNotice(runState === 'paused' ? '같은 실행을 재개하고 있습니다.' : '완료한 실행 경계에서 일시정지하고 있습니다.'); }
  };
  const resetRun = useCallback(() => {
    sweepAbort.current?.abort(); cancelActiveRun(); activeRun.current += 1; setControlPending(null); setRunState('ready'); setLastRun(null); setProgress({ steps: 0, time: 0 }); setDiagnostics([]); setResultsTab('results');
    setNotice('실행 기록을 초기화했습니다. 다음 실행은 모델의 초기값과 seed부터 시작합니다.');
  }, []);

  const sweep = async (nodeId: string, parameter: string, values: number[]) => {
    if (busy || invalidNumericIds.current.size) return;
    const sequence = ++activeRun.current, controller = new AbortController(); sweepAbort.current = controller;
    const snapshot = structuredClone(rootRef.current); setActivityKey(sequence); setRunMode(snapshot.execution.mode); setRunState('running'); setSweepProgress({ completed: 0, total: values.length }); setDiagnostics([]);
    try {
      const sweepResult = await runParameterSweep(snapshot, { nodeId, parameter, values }, { signal: controller.signal, onProgress: next => { if (activeRun.current === sequence) setSweepProgress({ completed: next.completed, total: next.total }); }, execute: async (variant, budget) => (await executeInWorker(variant, next => { if (activeRun.current === sequence) setProgress(next); }, paused => { if (activeRun.current === sequence) { setRunState(paused ? 'paused' : 'running'); setControlPending(null); } }, budget)).result });
      if (activeRun.current !== sequence) return;
      for (const record of sweepResult.records) {
        const compiled = compileModel(record.model), execution = { result: record.result, semanticHash: record.modelHash, engineVersion: record.manifest.engineVersion };
        await storeHistory(record.model, execution, compiled, `${snapshot.name} · ${parameter} = ${record.value}`);
        setLastRun({ ...execution, semanticKey: compiled.semanticKey, model: record.model, outputIds: compiled.outputIds, outputTypes: compiled.outputTypes, completedAt: new Date().toLocaleTimeString('ko-KR') }); setPlotId(compiled.outputIds[0] ?? '');
      }
      setRunState(sweepResult.status); setDiagnostics(sweepResult.diagnostics ?? []); setNotice(`${sweepResult.records.length}개 실험 결과를 기록했습니다.`);
    } catch (error) { if (activeRun.current === sequence) { setRunState('failed'); setDiagnostics(errorDiagnostics(error)); } }
    finally { if (sweepAbort.current === controller) sweepAbort.current = null; }
  };

  const downloadModel = useCallback(() => {
    try {
      const data = serializeModel(rootRef.current);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${modelRef.current.name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 70) || 'CalcWeave'}.cw.json`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('모델 파일을 다운로드했습니다. 이 파일을 가져와 다른 브라우저에서도 열 수 있습니다.');
    } catch (error) { recordLocalOperation('EXPORT_FAILED', 'export'); setDiagnostics(errorDiagnostics(error)); setResultsTab('diagnostics'); }
  }, []);
  const downloadCode = useCallback(async () => {
    try {
      if (invalidNumericIds.current.size) throw new ModelError([{ code: 'INVALID_NUMBER_DRAFT', message: '편집 중인 숫자를 확인한 뒤 코드를 다운로드하세요.' }]);
      const snapshot = structuredClone(rootRef.current);
      const { exportTypeScript } = await import('../../../packages/codegen-ts/src');
      const code = exportTypeScript(compileModel(snapshot));
      const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'model.ts'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('현재 모델의 model.ts를 다운로드했습니다. TypeScript 실행 환경에서 현재 모델의 계산을 독립 실행할 수 있습니다.');
    } catch (error) { recordLocalOperation('EXPORT_FAILED', 'export'); setDiagnostics(errorDiagnostics(error)); setResultsTab('diagnostics'); }
  }, []);
  const downloadExecutionArchive = async () => {
    if (archivePending) return;
    setArchivePending(true);
    try {
      if (invalidNumericIds.current.size) throw new ModelError([{ code: 'INVALID_NUMBER_DRAFT', message: '편집 중인 입력값을 확인한 뒤 실행 묶음을 다운로드하세요.' }]);
      const compiled = compileModel(structuredClone(rootRef.current));
      const manifest = await createExportManifest(compiled);
      const { exportTypeScript } = await import('../../../packages/codegen-ts/src');
      const code = exportTypeScript(compiled, manifest);
      const completed = lastRun?.semanticKey === compiled.semanticKey && lastRun.result.status === 'completed' ? lastRun.result : undefined;
      const files: Record<string, string> = { 'model.ts': code, 'model.cw.json': serializeModel(compiled.model), 'manifest.json': JSON.stringify(manifest, null, 2), 'run-example.ts': EXPORT_RUN_EXAMPLE, 'README.md': exportArchiveReadme(!!completed, compiled.model.execution.mode, manifest.targetVersion === 'typescript-m4-v1', String(manifest.targetVersion) === 'typescript-m5-v1', ['typescript-catalog-v1', 'typescript-m8-v1', 'typescript-m9-v1'].includes(String(manifest.targetVersion))) };
      if (completed) {
        const { elapsedMs: _elapsedMs, ...expected } = completed;
        files['expected-output.json'] = JSON.stringify(expected, null, 2);
      }
      const url = URL.createObjectURL(new Blob([createExportArchive(files)], { type: 'application/zip' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-execution.zip'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`현재 모델의 독립 실행 묶음을 다운로드했습니다.${completed ? ' 완료한 기준 결과를 포함합니다.' : ' 먼저 계산하면 기준 결과도 함께 보관합니다.'}`);
    } catch (error) { recordLocalOperation('EXPORT_FAILED', 'export'); setDiagnostics(errorDiagnostics(error)); setResultsTab('diagnostics'); }
    finally { setArchivePending(false); }
  };
  const downloadTarget = async (target: CodeTarget, archive: boolean) => {
    if (invalidNumericIds.current.size) throw new ModelError([{ code: 'INVALID_NUMBER_DRAFT', message: '편집 중인 입력값을 확인한 뒤 코드를 다운로드하세요.' }]);
    try {
      const compiled = compileModel(structuredClone(rootRef.current));
      if (target === 'typescript') {
        const manifest = archive ? await createExportManifest(compiled) : undefined;
        const api = await import('../../../packages/codegen-ts/src'), code = api.exportTypeScript(compiled, manifest);
        if (!archive) downloadText(code, 'model.ts', 'text/plain');
        else {
          const completed = lastRun?.semanticKey === compiled.semanticKey && lastRun.result.status === 'completed' ? lastRun.result : undefined;
          const files: Record<string, string> = { 'model.ts': code, 'model.cw.json': serializeModel(compiled.model), 'manifest.json': JSON.stringify(manifest, null, 2), 'run-example.ts': EXPORT_RUN_EXAMPLE, 'README.md': exportArchiveReadme(!!completed, compiled.model.execution.mode, manifest!.targetVersion === 'typescript-m4-v1', String(manifest!.targetVersion) === 'typescript-m5-v1', ['typescript-catalog-v1', 'typescript-m8-v1', 'typescript-m9-v1'].includes(String(manifest!.targetVersion))) };
          if (completed) { const { elapsedMs: _elapsedMs, ...expected } = completed; files['expected-output.json'] = JSON.stringify(expected, null, 2); }
          const url = URL.createObjectURL(new Blob([createExportArchive(files)], { type: 'application/zip' }));
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-execution.zip'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        setNotice(archive ? 'TypeScript 독립 실행 묶음을 다운로드했습니다.' : '현재 모델의 model.ts를 다운로드했습니다.'); return;
      }
      const api = await import('../../../packages/codegen-python/src');
      const targetDiagnostics = api.getPythonDiagnostics(compiled);
      if (targetDiagnostics.length) throw new ModelError(targetDiagnostics);
      const manifest = api.createPythonExportManifest(compiled), code = api.exportPython(compiled, manifest);
      const completed = lastRun?.semanticKey === compiled.semanticKey && lastRun.result.status === 'completed' ? lastRun.result : undefined;
      if (!archive) downloadText(code, 'model.py', 'text/plain');
      else {
        const files: Record<string, string> = { 'model.py': code, 'model.cw.json': serializeModel(compiled.model), 'manifest.json': JSON.stringify(manifest, null, 2), 'run-example.py': PYTHON_RUN_EXAMPLE, 'README.md': pythonArchiveReadme(!!completed) };
        if (completed) { const { elapsedMs: _elapsedMs, ...expected } = completed; files['expected-output.json'] = JSON.stringify(expected, null, 2); }
        const url = URL.createObjectURL(new Blob([createExportArchive(files)], { type: 'application/zip' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'CalcWeave-python-execution.zip'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(archive ? `Python 독립 실행 묶음을 다운로드했습니다.${completed ? ' 현재 모델의 완료 결과를 포함합니다.' : ''}` : '현재 모델의 model.py를 다운로드했습니다. Python 3.10 이상에서 독립 실행할 수 있습니다.');
    } catch (error) { recordLocalOperation('EXPORT_FAILED', 'export'); throw error; }
  };
  const importModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const requestId = ++importRequest.current, previousModel = rootRef.current;
    if (file.size > 5 * 1024 * 1024) { setNotice('모델 파일은 5 MiB 이하여야 합니다.'); return; }
    try {
      const api = await import('../../../packages/interop/src');
      const checked = await api.inspectModelImport(await file.text());
      if (requestId !== importRequest.current) return;
      if (rootRef.current !== previousModel) { setNotice('파일을 읽는 동안 모델이 바뀌어 가져오기를 적용하지 않았습니다.'); return; }
      setImportReport({ parsed: checked.parsed, converted: checked.converted, executable: checked.executable, editable: !!checked.model, format: checked.format, diagnostics: checked.diagnostics });
      if (!checked.model) { recordLocalOperation('MODEL_IMPORT_FAILED', 'validation'); setDiagnostics(checked.diagnostics); setResultsTab('diagnostics'); setNotice('파일의 모델 형식을 확인해 주세요.'); return; }
      const imported = checked.model;
      if (busy) resetRun();
      replaceRoot(imported); setSelectedId(null); setSelectedEdgeId(null); setNotice(`${imported.name} 모델을 불러왔습니다.`);
      setDiagnostics(checked.diagnostics); if (!checked.executable) setResultsTab('diagnostics');
      window.requestAnimationFrame(() => void fitView({ ...READABLE_VIEW, duration: 0 }));
    } catch (error) { if (requestId !== importRequest.current || rootRef.current !== previousModel) return; recordLocalOperation('MODEL_IMPORT_FAILED', 'validation'); setDiagnostics(errorDiagnostics(error)); setResultsTab('diagnostics'); setNotice('파일의 모델 형식을 확인해 주세요.'); }
  };
  const openExample = (id: string) => {
    if (busy) resetRun();
    replaceRoot(createExample(id)); setSelectedId(null); setSelectedEdgeId(null); setExamplesOpen(false); setNotice('예제를 불러왔습니다. 값과 연결을 바꿔 직접 계산해 보세요.');
    window.requestAnimationFrame(() => void fitView({ ...READABLE_VIEW, duration: 0 }));
  };
  const newModel = () => {
    if (busy) resetRun();
    replaceRoot(createEmptyModel()); setSelectedIds([]); setSelectedEdgeIds([]); setExamplesOpen(false); setNotice('새 모델을 열었습니다. 이전 모델은 실행 취소로 돌아갈 수 있습니다.');
  };
  const openRecovery = async () => {
    setRecoveryError('복구본을 확인하고 있습니다.'); setRecovery({ checkpoint: null, original: null });
    try { setRecovery(await loadRecoverySnapshot()); setRecoveryError(''); }
    catch (error) { setRecoveryError(error instanceof Error ? error.message : '복구본을 읽지 못했습니다.'); }
  };
  const downloadRecovery = (original: unknown, name: string) => {
    try {
      const json = JSON.stringify(original, null, 2);
      if (typeof json !== 'string') throw new Error('복구본을 JSON 파일로 변환하지 못했습니다. 원본은 저장 공간에 유지됩니다.');
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      if (blob.size > 5 * 1024 * 1024) throw new Error('복구본이 5 MiB 한도를 넘었습니다. 원본은 저장 공간에 유지됩니다.');
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('복구본을 파일로 내려받았습니다. 브라우저의 원본은 유지됩니다.');
    } catch (error) { setRecoveryError(error instanceof Error ? error.message : '복구본을 내려받지 못했습니다.'); }
  };
  useModalDialog(recoveryDialog, !!recovery);
  useEffect(() => {
    const nodeIds = new Set(model.nodes.map(node => node.id)), edgeIds = new Set(model.edges.map(edge => edge.id));
    setSelectedIds(ids => ids.some(id => !nodeIds.has(id)) ? ids.filter(id => nodeIds.has(id)) : ids);
    setSelectedEdgeIds(ids => ids.some(id => !edgeIds.has(id)) ? ids.filter(id => edgeIds.has(id)) : ids);
  }, [model]);

  const focusCanvas = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.button === 0 || event.button === 1) && !isCanvasControl(event.target)) {
      event.currentTarget.focus({ preventScroll: true });
    }
  };
  const handleCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing) {
      const id = (event.target as Element).closest('.react-flow__node')?.getAttribute('data-id');
      if (id) { event.preventDefault(); event.stopPropagation(); setSelectedId(id); setSelectedEdgeId(null); window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.inspector-content input, .inspector-content textarea, .inspector-content select, .inspector-content button')?.focus()); return; }
    }
    if (event.code !== 'Space' && event.key !== ' ') return;
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || quickInsertOpen || recovery || helpOpen || codeExportOpen || packageOpen || importReportOpen || isCanvasControl(event.target)) return;
    // Capture Space before React Flow can select a focused block or scroll the page.
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void fitView({ ...READABLE_VIEW, duration: 0 });
  };
  const openCanvasSubsystem = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const recent = lastSubsystemClick.current;
    const repeatedNodeClick = recent && performance.now() - recent.time < 700 && Math.hypot(event.clientX - recent.x, event.clientY - recent.y) <= 6;
    const id = target.closest('.react-flow__node')?.getAttribute('data-id')
      ?? (target.closest('.react-flow__nodesselection') && selectedIds.length === 1 ? selectedIds[0] : null)
      ?? (target.closest('.react-flow__pane') && repeatedNodeClick ? recent.id : null);
    if (id && model.nodes.find(node => node.id === id)?.blockType === 'hierarchy.subsystem') {
      // React Flow draws a selection overlay after the first click; the second click
      // can land on that overlay instead of the node wrapper.
      event.preventDefault(); event.stopPropagation(); lastSubsystemClick.current = null; navigateHierarchy([...hierarchyPath, id]);
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target as HTMLElement;
      // Native dialogs own focus and Escape; canvas commands must not edit behind them.
      if (quickInsertOpen || recovery || helpOpen || managementOpen || codeExportOpen || packageOpen || importReportOpen) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setQuickInsertOpen(true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void run(); }
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedIds(modelRef.current.nodes.map(node => node.id)); setSelectedEdgeIds([]); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copyBlocks(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteBlocks(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); pasteBlocks(true); }
      if (event.key === '/') { event.preventDefault(); setLibraryOpen(true); searchRef.current?.focus(); }
      if (event.key === 'Delete') { event.preventDefault(); removeSelection(); }
      if (event.key === 'Escape') { setExamplesOpen(false); setHelpOpen(false); if (quickInsertOpen) setQuickInsertOpen(false); else if (recovery) setRecovery(null); else if (busy) cancel(); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [run, undo, redo, removeSelection, copyBlocks, pasteBlocks, quickInsertOpen, recovery, helpOpen, managementOpen, codeExportOpen, packageOpen, importReportOpen, busy, cancel]);

  const displayPlotId = lastRun?.outputIds.includes(plotId) ? plotId : lastRun?.outputIds[0] ?? '';
  const runOutputLabels = useMemo(() => lastRun ? outputLabels(lastRun.model) : {}, [lastRun]);
  const outputLabel = (id: string) => runOutputLabels[id] ?? id;
  const modelOutputOptions = model.nodes.flatMap((node) => getBlockPorts(node, model).outputs.map((port) => ({ value: `${node.id}:${port}`, nodeId: node.id, portId: port, label: `${node.label} · ${port}` })));
  const applyOfflineUpdate = async () => {
    if (busy || updating || !offlineController.current) return;
    if (invalidNumericIds.current.size || !localSavingEnabled) { setNotice('입력값과 저장 상태를 확인한 뒤 업데이트를 적용하세요.'); return; }
    setUpdating(true);
    try { await offlineController.current.applyUpdate(async () => { await modelSaveQueue.current; await historySaveQueue.current; await saveLocalModel(rootRef.current); setSaveState('saved'); }); }
    catch (error) { setNotice(error instanceof Error ? error.message : '업데이트를 적용하지 못했습니다. 현재 작업은 유지됩니다.'); }
    finally { setUpdating(false); }
  };
  const mutateLocalWorkspace = async (action: () => Promise<void>, kind: 'restore' | 'reset' = 'restore') => {
    if (busy || storageMaintenance.current) throw new Error('진행 중인 작업을 마친 뒤 다시 시도하세요.');
    const wasSaving = localSavingEnabled;
    storageMaintenance.current = true; setLocalSavingEnabled(false);
    try { await modelSaveQueue.current.catch(() => {}); await historySaveQueue.current; await waitForLocalWrites(); await action(); location.reload(); }
    catch (error) { storageMaintenance.current = false; if (kind === 'reset') { setResetIncomplete(true); setLocalSavingEnabled(false); setNotice('초기화를 완료하지 못했습니다. 현재 메모리의 작업을 백업한 뒤 삭제를 다시 시도하세요.'); } else setLocalSavingEnabled(wasSaving); throw error; }
  };

  return <NumericValidityContext.Provider value={setNumericValidity}><div className={`app-shell ${theme}`}>
    <a className="skip-link" href="#workspace" onClick={event => { event.preventDefault(); setWorkspaceTab('diagram'); window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.react-flow')?.focus()); }}>편집기로 바로 이동</a>
    <a className="skip-link skip-results" href="#calculation-results" onClick={event => { event.preventDefault(); setWorkspaceTab('diagram'); window.requestAnimationFrame(() => document.getElementById('calculation-results')?.focus()); }}>계산 결과로 바로 이동</a>
    <header className="app-header">
      <RunBrand activityKey={activityKey} phase={runState}/>
      <div className="project-name"><span className="project-divider"/><input aria-label="모델 이름" maxLength={120} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => { const name = nameDraft.trim() || model.name; setNameDraft(name); commit((current) => ({ ...current, name })); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setNameDraft(model.name); }}/><span className={`save-indicator ${saveState === 'failed' ? 'failed' : ''}`} title="이 브라우저에 저장됩니다. 휴대용 백업은 모델 파일을 다운로드하세요."><span className="status-dot"/>{SAVE_LABELS[saveState]}</span></div>
      <nav className="header-actions" aria-label="파일과 보기">
        <button className="button subtle" onClick={() => fileRef.current?.click()}><Icon name="upload"/>가져오기</button>
        <button className="button subtle" onClick={downloadModel}><Icon name="download"/>모델 다운로드</button>
        <button className="button subtle code-download" title="현재 모델의 검증된 실행 계획을 독립 TypeScript 코드로 다운로드합니다." onClick={downloadCode}><span className="code-icon" aria-hidden="true">&lt;/&gt;</span><span>코드 다운로드<span className="code-badge">TS</span></span></button>
        <button className="icon-button" aria-label="코드 타깃 선택" title="TypeScript 또는 Python의 지원 범위를 확인하고 코드를 내보냅니다." onClick={() => setCodeExportOpen(true)}><Icon name="chevron-down" size={16}/></button>
        <button className="button subtle archive-download" disabled={archivePending} onClick={() => void downloadExecutionArchive()} title="정규화 모델, manifest, 독립 코드와 실행 예제를 ZIP으로 보관합니다."><Icon name="download"/><span>{archivePending ? '묶음 준비 중' : '실행 묶음'}</span></button>
        <button className="icon-button" aria-label="모델 패키지 공유" title="서명된 모델 파일과 지문으로 직접 공유합니다." onClick={() => setPackageOpen(true)}><Icon name="link"/></button>
        <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`${theme === 'light' ? '다크' : '라이트'} 테마로 변경`}><Icon name={theme === 'light' ? 'moon' : 'sun'}/></button>
        <button className="icon-button" aria-label="지원·릴리스" onClick={() => setHelpOpen(true)}><Icon name="info"/></button>
        <button className="icon-button" aria-label="로컬 데이터 관리" onClick={() => setManagementOpen(true)}><Icon name="sliders"/></button>
      </nav>
      <input ref={fileRef} className="visually-hidden" type="file" accept=".json,.cw.json,application/json" onChange={(event) => void importModel(event)} aria-label="CalcWeave 모델 파일 선택"/>
    </header>

    <div className="toolbar"><div className="toolbar-left"><button className={`icon-button ${libraryOpen ? 'active' : ''}`} onClick={() => setLibraryOpen(!libraryOpen)} aria-label={`블록 라이브러리 ${libraryOpen ? '접기' : '열기'}`} aria-pressed={libraryOpen}><Icon name="layers"/></button><span className="toolbar-separator"/><button className="icon-button" disabled={!past.current.length} onClick={undo} aria-label="실행 취소 (Ctrl+Z)"><Icon name="undo"/></button><button className="icon-button" disabled={!future.current.length} onClick={redo} aria-label="다시 실행 (Ctrl+Shift+Z)"><Icon name="redo"/></button><span className="toolbar-separator"/><button className="button example-button" onClick={newModel}><Icon name="plus" size={16}/>새 모델</button><button className="button quick-insert-button" onClick={() => setQuickInsertOpen(true)} aria-keyshortcuts="Control+K Meta+K"><Icon name="search" size={16}/>빠른 추가</button><div className="examples-control"><button ref={examplesTrigger} className={`button example-button ${examplesOpen ? 'active' : ''}`} aria-expanded={examplesOpen} aria-controls="examples-catalog" onClick={() => setExamplesOpen(!examplesOpen)}><Icon name="grid"/>예제로 시작<Icon name="chevron-down" size={16}/></button>{examplesOpen && <ExampleCatalog trigger={examplesTrigger} onSelect={openExample} onClose={() => setExamplesOpen(false)}/>}</div></div><button className="button subsystem-button" disabled={!selectedIds.length} onClick={() => { try { if (rootRef.current.dashboard?.some(widget => pathRef.current.length === 0 && selectedIds.includes(widget.nodeId))) { setNotice('대시보드에 연결된 루트 블록입니다. 해당 위젯 연결을 먼저 삭제한 뒤 하위 도식으로 묶으세요.'); return; } const next = createSubsystemFromSelection(modelRef.current, selectedIds); commit(() => next); setSelectedIds([]); setSelectedEdgeIds([]); setNotice('선택한 블록을 하위 도식으로 묶었습니다. 인스턴스를 더블 클릭하면 내부를 편집합니다.'); } catch (error) { setDiagnostics(errorDiagnostics(error)); setResultsTab('diagnostics'); } }}>하위 도식으로 묶기</button><div className="toolbar-right"><span className="execution-label"><span className={`mode-dot ${model.execution.mode}`}/>{MODE_LABELS[busy ? runMode : model.execution.mode]}</span><span className="toolbar-separator"/>{busy ? <div className="execution-controls">{runMode !== 'static' && <button className="button" disabled={runState === 'validating' || !!controlPending} onClick={pauseOrResume}><Icon name={runState === 'paused' ? 'play' : 'pause'} size={16}/>{controlPending === 'pause' ? '일시정지 중…' : controlPending === 'resume' ? '재개 중…' : runState === 'paused' ? '재개' : '일시정지'}</button>}<button className="button stop-button" onClick={cancel}><Icon name="stop" size={16}/>계산 취소</button></div> : <button className="button primary run-button" onClick={() => void run()}><Icon name="play" size={16}/>{model.execution.mode === 'static' ? '계산하기' : '시뮬레이션 실행'}<span className="button-shortcut">⌃ ↵</span></button>}<button className="button reset-button" disabled={!busy && !lastRun && runState === 'ready'} onClick={resetRun}><Icon name="reset" size={16}/>실행 초기화</button></div></div>

    <WorkspaceTabs value={workspaceTab} onChange={setWorkspaceTab}/>
    <OfflineBanner status={offlineStatus} busy={busy} updating={updating} onCheck={() => void offlineController.current?.checkForUpdate()} onApply={() => void applyOfflineUpdate()}/>
    {importReport && <div className="import-report-banner"><span>모델 가져오기 · JSON 구문 {importReport.parsed ? '확인' : '오류'} · {importReport.format === 'calcweave' ? '원본 형식' : '외부 형식'} · {importReport.executable ? '실행 가능' : importReport.editable ? '설정 확인 필요' : '원래 모델 유지'}</span><button className="text-button" onClick={() => setImportReportOpen(true)}>가져오기 보고서</button><button className="icon-button" aria-label="가져오기 보고서 안내 닫기" onClick={() => setImportReport(null)}><Icon name="close" size={16}/></button></div>}
    <main className={`workspace ${libraryOpen ? '' : 'library-collapsed'} ${workspaceTab !== 'diagram' ? 'tools-open' : ''}`} id="workspace">
      {libraryOpen && <aside className="library-panel" aria-label="블록 라이브러리"><div className="panel-heading"><h2>블록 라이브러리 <span className="count-badge">{BLOCK_REGISTRY.length}</span></h2></div><label className="search-field"><Icon name="search" size={16}/><input ref={searchRef} value={search} maxLength={100} placeholder="블록 검색…" aria-label="한국어 또는 영어로 블록 검색" onChange={(event) => setSearch(event.target.value)}/><kbd>/</kbd></label><div className="library-list">{categories.map((category) => <section key={category} className="library-category"><h3>{category}<span>{filteredBlocks.filter((definition) => definition.category === category).length}</span></h3>{filteredBlocks.filter((definition) => definition.category === category).map((definition) => <button className="library-item" key={definition.id} onClick={() => addBlock(definition.id)} title={`${definition.description} · 클릭하여 추가`}><span className={`library-symbol ${blockTone(definition.id)}`} aria-hidden="true">{BLOCK_SYMBOLS[definition.id]}</span><span className="library-copy"><strong>{definition.label}</strong><small>{definition.englishName}</small></span><span className="library-add"><Icon name="plus" size={15}/></span></button>)}</section>)}{filteredBlocks.length === 0 && <div className="search-empty"><Icon name="search" size={24}/><strong>블록을 찾지 못했습니다.</strong><span>‘값’, ‘gain’, ‘적분’으로 검색해 보세요.</span><button className="text-button" onClick={() => setSearch('')}>전체 블록 보기</button></div>}</div><div className="library-footnote"><span className="small-square">0.8</span><p>수학·신호를 연결하고<br/>예제에서 계산을 시작합니다.</p></div></aside>}

      <section className="canvas-column" aria-label="도식 편집 및 계산 결과"><div className="workbench-layout"><div className="canvas-area"><div className="canvas-topline"><div><Icon name="layers" size={14}/><strong>{model.name || '이름 없는 모델'}</strong><span className="breadcrumb-separator">/</span><nav className="hierarchy-breadcrumb" aria-label="도식 경로"><button onClick={() => navigateHierarchy([])}>루트 모델</button>{view.trail.map((entry, index) => <span key={`${entry.nodeId}-${index}`}> / <button onClick={() => navigateHierarchy(hierarchyPath.slice(0, index + 1))}>{entry.label}</button></span>)}</nav></div><span>{model.nodes.length} 블록 <i/> {model.edges.length} 연결</span></div><ReactFlow<FlowBlock> tabIndex={0} aria-label="도식 캔버스" aria-describedby="canvas-interaction-hint" aria-keyshortcuts="Space" onPointerDownCapture={focusCanvas} onKeyDownCapture={handleCanvasKeyDown} onDoubleClickCapture={openCanvasSubsystem} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={changes => { changes.forEach(change => { if (change.type === 'select') setSelectedEdgeIds(current => change.selected ? [...new Set([...current, change.id])] : current.filter(id => id !== change.id)); if (change.type === 'remove') commit(current => ({ ...current, edges: current.edges.filter(edge => edge.id !== change.id) })); }); }} onNodeClick={(event, node) => { lastSubsystemClick.current = node.data.block.blockType === 'hierarchy.subsystem' ? { id: node.id, time: performance.now(), x: event.clientX, y: event.clientY } : null; if (!event.shiftKey && !event.ctrlKey && !event.metaKey) setSelectedId(node.id); setSelectedEdgeId(null); }} onNodeDoubleClick={(_event, node) => { if (node.data.block.blockType === 'hierarchy.subsystem') navigateHierarchy([...hierarchyPath, node.id]); }} onEdgeClick={(event, edge) => { if (!event.shiftKey && !event.ctrlKey && !event.metaKey) { setSelectedEdgeId(edge.id); setSelectedId(null); } }} onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); }} multiSelectionKeyCode={['Shift', 'Control', 'Meta']} selectionOnDrag selectionKeyCode={null} panOnDrag={[1]} panActivationKeyCode={null} onConnect={connect} isValidConnection={isValidConnection} connectOnClick nodesFocusable edgesFocusable onNodeDragStart={() => { dragSnapshot.current = rootRef.current; }} onNodeDragStop={() => { const snapshot = dragSnapshot.current; dragSnapshot.current = null; if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(rootRef.current)) { past.current = [...past.current.slice(-49), snapshot]; future.current = []; setHistoryVersion((value) => value + 1); } }} fitViewOptions={READABLE_VIEW} minZoom={0.25} maxZoom={1.75} snapToGrid snapGrid={[16, 16]} deleteKeyCode={null} proOptions={{ hideAttribution: false }} colorMode={theme} ariaLabelConfig={CANVAS_ARIA_LABELS}><Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--grid-dot)"/><Controls showInteractive={false} position="bottom-right" fitViewOptions={READABLE_VIEW}/>{model.nodes.length === 0 && <div className="empty-canvas"><span className="empty-canvas-icon"><Icon name="layers" size={30}/></span><h2>첫 계산을 연결해 보세요</h2><p>왼쪽에서 값, 배율, 결과 블록을 추가하고<br/>출력 포트와 입력 포트를 연결하세요.</p><button className="button primary" onClick={() => openExample(EXAMPLES[0].id)}>첫 계산 예제 열기<Icon name="arrow" size={16}/></button></div>}</ReactFlow><div className="canvas-hint" id="canvas-interaction-hint"><span className="hint-dot"/><span>휠 버튼 드래그 이동 · 왼쪽 드래그 영역 선택 · Space 도식 맞추기 · Ctrl+C/V 복사</span></div></div>

        <section id="calculation-results" tabIndex={-1} className={`results-panel${lastRun?.model.execution.mode === 'static' ? ' static-results' : ''}`} aria-label="계산 결과"><div className="results-toolbar"><div className="result-tabs"><button className={resultsTab === 'results' ? 'selected' : ''} onClick={() => setResultsTab('results')}><Icon name="chart" size={16}/>계산 결과</button><button className={resultsTab === 'diagnostics' ? 'selected' : ''} onClick={() => setResultsTab('diagnostics')}>진단{diagnostics.length > 0 && <span className="diagnostic-count">{diagnostics.length}</span>}</button></div><span className={`result-status ${runState === 'paused' ? 'paused' : busy ? 'running' : diagnostics.length && runState === 'failed' ? 'failed' : lastRun && !currentResult ? 'stale' : lastRun ? 'current' : ''}`}>{busy ? <>{runState !== 'paused' && <span className="spinner"/>}{RUN_LABELS[runState]}</> : diagnostics.length && runState === 'failed' ? <>! 설정 확인 필요</> : lastRun ? currentResult ? <><Icon name="check" size={14}/>현재 모델의 결과{lastRun.result.status !== 'completed' ? ' · 부분 결과' : ''}</> : <>△ 다시 계산 필요 · 이전 결과</> : '아직 계산하지 않았습니다'}</span></div>{resultsTab === 'diagnostics' ? <div className="diagnostics-content">{diagnostics.length ? <><h3>{diagnostics.some(diagnostic => diagnostic.tick !== undefined || diagnostic.time !== undefined) ? '계산이 멈춘 위치를 확인하세요.' : '계산 전에 다음 항목을 확인하세요.'}</h3>{diagnostics.map((diagnostic, index) => <button key={`${diagnostic.code}-${index}`} className="diagnostic-item" onClick={() => { if (diagnostic.nodeId) { setSelectedId(diagnostic.nodeId); setSelectedEdgeId(null); void fitView({ nodes: [{ id: diagnostic.nodeId }], padding: 0.8, duration: 0 }); } }}><span className="diagnostic-icon">!</span><span><strong>{diagnostic.message}</strong><small>{diagnostic.nodeId ? `${model.nodes.find((node) => node.id === diagnostic.nodeId)?.label ?? diagnostic.nodeId}${diagnostic.portId ? ` · ${diagnostic.portId} 입력` : ''}` : '모델 설정'} · {diagnostic.code}</small>{(diagnostic.tick !== undefined || diagnostic.time !== undefined) && <small className="diagnostic-time">{diagnostic.tick !== undefined && `tick ${diagnostic.tick}`}{diagnostic.tick !== undefined && diagnostic.time !== undefined && ' · '}{diagnostic.time !== undefined && `t = ${formatNumber(diagnostic.time)} s`}</small>}</span>{diagnostic.nodeId && <Icon name="arrow" size={16}/>}</button>)}</> : <div className="result-empty"><Icon name="check" size={24}/><strong>현재 표시할 진단이 없습니다.</strong><span>계산하기를 누르면 연결과 설정을 확인합니다.</span></div>}</div> : busy ? <div className="result-empty">{runState === 'paused' ? <span className="pause-summary"><Icon name="pause" size={28}/></span> : <span className="large-spinner"/>}<strong>{RUN_LABELS[runState]}</strong><span>{progress.steps ? `${progress.steps.toLocaleString()} 샘플 · t = ${formatNumber(progress.time)} s` : '계산을 준비하고 있습니다.'}</span>{runState === 'paused' && <span className="pause-note">재개하면 같은 입력·초기값·seed의 실행을 이어갑니다. 편집한 설정은 다음 실행부터 적용됩니다.</span>}</div> : lastRun && finalSample ? <div className="results-content"><div className="output-values">{lastRun.outputIds.map((id) => <button key={id} className={`output-card ${displayPlotId === id ? 'selected' : ''}`} onClick={() => setPlotId(id)}><span><i/>{outputLabel(id)}</span><strong>{signalSummary(finalSample.values[id])}</strong><small className="result-type">{descriptorLabel(lastRun.outputTypes[id])}</small><small>{lastRun.model.execution.mode === 'static' ? '계산값' : '마지막 샘플'}</small></button>)}<div className="run-metadata"><span>{MODE_LABELS[lastRun.model.execution.mode]}</span><strong>{lastRun.result.samples.length.toLocaleString()} 샘플</strong><small>{formatNumber(lastRun.result.elapsedMs)} ms · {lastRun.completedAt}</small></div></div>{lastRun.result.status === 'failed' && <p className="partial-result-note" role="status">실행이 멈추기 전의 마지막 유효 기록입니다. 진단에서 중단 원인과 시점을 확인하세요.</p>}<SolverRunDetails result={lastRun.result} model={lastRun.model}/>{displayPlotId && <div className="plot-table"><div className="plot-heading"><span><i/>{outputLabel(displayPlotId)}</span><small>실행한 모델의 수치 기록</small></div>{typeof finalSample.values[displayPlotId] === 'number' && <ScopeTimeRange execution={rootModel.execution} samples={lastRun.result.samples} busy={busy} onApply={applyScopeRange}/>} {lastRun.result.samples.length > 1 && typeof finalSample.values[displayPlotId] === 'number' && <ResultPlot samples={lastRun.result.samples} outputId={displayPlotId} label={outputLabel(displayPlotId)}/>}<ResultTable samples={lastRun.result.samples} outputId={displayPlotId} label={outputLabel(displayPlotId)}/>{Array.isArray(finalSample.values[displayPlotId]) && <TemporalSignalResult samples={lastRun.result.samples} outputId={displayPlotId} label={outputLabel(displayPlotId)}/>}</div>}</div> : <div className="result-empty"><span className="empty-result-icon"><Icon name="chart" size={24}/></span><strong>{runState === 'cancelled' ? '계산이 취소되었습니다.' : '연결한 생각이, 수치가 되는 순간'}</strong><span>도식을 확인하고 {model.execution.mode === 'static' ? '계산하기' : '시뮬레이션 실행'}를 눌러 결과를 확인하세요.</span></div>}</section>
        </div>
      </section>

      <aside className="inspector-panel" aria-label="선택한 블록과 실행 설정"><div className="inspector-heading"><Icon name="sliders" size={17}/><h2>{selectedIds.length > 1 || selectedEdgeIds.length > 1 ? '여러 항목 선택' : selected ? '블록 속성' : selectedEdgeId ? '연결 속성' : '모델 설정'}</h2>{selected && <span className="selection-dot"/>}</div><div className="inspector-content">{selectedIds.length > 1 || selectedEdgeIds.length > 1 ? <div className="selection-summary"><Icon name="layers" size={24}/><h3>{selectedIds.length}개 블록 · {selectedEdgeIds.length}개 연결</h3><p>복사하면 선택한 블록 사이의 내부 연결도 함께 보존합니다. Shift+클릭으로 블록을 추가 선택하거나 캔버스의 빈 곳을 왼쪽 버튼으로 드래그하세요.</p><button className="button danger full-width" onClick={removeSelection}><Icon name="trash" size={16}/>선택 삭제</button></div> : selected && selectedDefinition ? <><div className="selected-block-summary"><span className={`large-block-symbol ${blockTone(selected.blockType)}`} aria-hidden="true">{BLOCK_SYMBOLS[selected.blockType]}</span><div><strong>{selectedDefinition.label}</strong><span>{selectedDefinition.englishName}</span></div></div><p className="block-description">{selectedDefinition.description}</p><div className="signal-metadata">{descriptorLabel(selectedType)}</div>{selected.blockType === 'hierarchy.subsystem' && <section className="inspector-section"><h3>하위 도식</h3><button className="button full-width" onClick={() => navigateHierarchy([...hierarchyPath, selected.id])}>하위 도식 열기</button><p className="field-help">현재 참조 버전 {String(selected.parameters.version)} · 정의 버전 {rootModel.subsystems?.find(definition => definition.id === selected.parameters.definitionId)?.version ?? '없음'}</p><button className="button full-width" onClick={() => { commitRoot(updateSubsystemInstances); setNotice('모든 하위 도식 인스턴스를 최신 정의 버전으로 갱신했습니다.'); }}>전체 인스턴스 버전 갱신</button></section>}{selected.blockType === 'annotation.model-info' && <p className="field-help">{rootModel.name} · {rootModel.nodes.length} 블록 · {(rootModel.datasets ?? []).length} 데이터 · {(rootModel.subsystems ?? []).length} 하위 도식</p>}<section className="inspector-section"><h3>기본 설정</h3><label className="field"><span className="field-label">블록 이름</span><input maxLength={100} value={selected.label} onChange={(event) => updateBlock({ label: event.target.value })}/></label>{(selectedBoundary ? [] : Object.entries(selectedDefinition.parameters)).map(([key, parameter]) => { const value = Object.hasOwn(selected.parameters, key) ? selected.parameters[key] : parameter.default; const change = (next: unknown) => updateBlock({ parameters: { ...selected.parameters, [key]: next } }); return selected.blockType === 'hierarchy.subsystem' && key === 'definitionId' ? <label className="field" key={`${selected.id}-${key}`}><span className="field-label">하위 도식 정의</span><select aria-label="하위 도식 정의" value={String(value)} onChange={event => { const definition = rootModel.subsystems?.find(item => item.id === event.target.value); if (definition) updateBlock({ parameters: { definitionId: definition.id, version: definition.version }, label: definition.name }); }}><option value="">정의 선택</option>{rootModel.subsystems?.map(definition => <option key={definition.id} value={definition.id}>{definition.name} · v{definition.version}</option>)}</select></label> : selected.blockType === 'hierarchy.subsystem' && key === 'version' ? null : selected.blockType === 'source.dataset' && (key === 'datasetId' || key === 'column') ? <label className="field" key={`${selected.id}-${key}`}><span className="field-label">{key === 'datasetId' ? '데이터' : '재생 열'}</span><select aria-label={key === 'datasetId' ? '재생 데이터' : '재생 열'} value={String(value)} onChange={event => { if (key === 'datasetId') { const dataset = rootModel.datasets?.find(item => item.id === event.target.value), column = dataset?.columns.find(item => item.name !== dataset.timeColumn && item.kind !== 'string'); if (dataset && column) updateBlock({ parameters: { ...selected.parameters, datasetId: dataset.id, column: column.name, interpolation: column.kind === 'boolean' ? 'previous' : 'linear' } }); } else change(event.target.value); }}><option value="">선택하세요</option>{key === 'datasetId' ? rootModel.datasets?.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name} · v{dataset.version}</option>) : rootModel.datasets?.find(dataset => dataset.id === selected.parameters.datasetId)?.columns.filter(column => column.name !== rootModel.datasets?.find(dataset => dataset.id === selected.parameters.datasetId)?.timeColumn && column.kind !== 'string').map(column => <option key={column.name} value={column.name}>{column.name} · {column.unit}</option>)}</select></label> : parameter.kind === 'text' ? <label className="field" key={`${selected.id}-${key}`}><span className="field-label">{parameter.label}</span>{selected.blockType === 'annotation.note' ? <textarea aria-label={parameter.label} maxLength={parameter.maxLength ?? 2000} value={String(value)} onChange={event => change(event.target.value)}/> : <input aria-label={parameter.label} maxLength={parameter.maxLength ?? 100} value={String(value)} onChange={event => change(event.target.value)}/>}</label> : parameter.kind === 'numeric-vector' ? <NumericVectorField key={`${selected.id}-${key}`} label={parameter.label} value={value} minLength={parameter.minLength} maxLength={parameter.maxLength} onChange={change} setValidity={setNumericValidity}/> : parameter.kind === 'value' ? <SignalField key={`${selected.id}-${key}`} label={parameter.label} value={value} onChange={change} setValidity={setNumericValidity}/> : parameter.kind === 'enum' ? <label className="field" key={`${selected.id}-${key}`}><span className="field-label">{parameter.label}</span><select aria-label={parameter.label} value={String(value)} onChange={event => change(event.target.value)}>{parameter.options?.map(option => <option key={option} value={option}>{key === 'extrapolation' && option === 'linear' ? '선형 외삽' : selected.blockType === 'lookup.2d' && key === 'interpolation' && option === 'linear' ? 'bilinear · 선형 보간' : OPTION_LABELS[option] ?? option}</option>)}</select></label> : parameter.kind === 'expression' ? <ExpressionField key={`${selected.id}-${key}`} label={parameter.label} value={String(value)} maxLength={parameter.maxLength} onChange={change} setValidity={setNumericValidity}/> : <NumericField key={`${selected.id}-${key}`} label={parameter.label} value={typeof value === 'number' ? value : NaN} min={parameter.min} max={parameter.max} integer={parameter.kind === 'integer'} onChange={change}/>; })}{!selectedBoundary && <M5ParameterGuide node={selected}/>} {!selectedBoundary && <label className="field"><span className="field-label">단위</span><select aria-label="단위" value={selected.unit ?? ''} onChange={event => updateBlock({ unit: event.target.value || undefined })}><option value="">{selected.blockType === 'source.clock' || selected.blockType === 'source.digital-clock' ? 's · 시간 단위' : selected.blockType.startsWith('source.') || selected.blockType === 'io.input' ? '단위 없음' : selectedDefinition.state !== 'none' ? '1 · 초기값의 기본 단위' : '입력에서 추론'}</option>{UNITS.map(unit => <option key={unit} value={unit}>{unit === '1' ? '1 · 단위 없음' : unit}</option>)}</select><span className="field-help">{model.execution.mode === 'continuous' && (selected.blockType === 'source.clock' || selected.blockType === 'source.digital-clock') ? '시계의 기본 단위는 s입니다. 단위 없는 ODE 입력으로 시간을 사용할 때 1을 직접 지정하세요. 물리 단위의 자동 변환은 수행하지 않습니다.' : '단위를 자동 변환하지 않습니다. 다른 블록의 지정 단위는 추론된 단위와 같아야 합니다.'}</span></label>}{selectedBoundary && <p className="field-help">하위 도식의 경계 포트입니다. 입력값·단위·주기는 연결된 외부 신호와 실제 계산 블록에서 결정합니다.</p>}</section>{(!selectedBoundary && model.execution.mode === 'discrete' || !selectedBoundary && model.execution.mode === 'continuous' && !CONTINUOUS_RATE_LOCKED.has(selected.blockType)) && <SampleTimeEditor key={selected.id} node={selected} step={model.execution.mode === 'continuous' ? solverDraftSettings(model.execution).discreteStep : model.execution.step} hybrid={model.execution.mode === 'continuous'} onChange={sampleTime => updateBlock({ sampleTime })}/>}<section className="inspector-section"><h3>입력 연결</h3>{selectedPorts.inputs.length ? selectedPorts.inputs.map((port) => { const edge = model.edges.find((connection) => connection.target.nodeId === selected.id && connection.target.portId === port); return <div className="field" key={port}><span className="field-label"><span className="port-label">● {port}</span>{edge && <button type="button" className="text-button" aria-label="연결 해제" onClick={(event) => { event.preventDefault(); commit((current) => ({ ...current, edges: current.edges.filter((connection) => connection.id !== edge.id) })); }}>연결 해제</button>}</span><select aria-label={`${port} 입력 연결`} value={edge ? `${edge.source.nodeId}:${edge.source.portId}` : ''} onChange={(event) => { if (!event.target.value) return; const option = modelOutputOptions.find((entry) => entry.value === event.target.value); if (!option) return; commit((current) => ({ ...current, edges: [...current.edges.filter((connection) => connection.target.nodeId !== selected.id || connection.target.portId !== port), { id: `edge-${crypto.randomUUID()}`, source: { nodeId: option.nodeId, portId: option.portId }, target: { nodeId: selected.id, portId: port } }] })); }}><option value="">연결할 출력 선택</option>{modelOutputOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }) : <p className="muted-copy">이 블록은 입력값을 만듭니다.</p>}</section>{selectedPorts.outputs.length > 0 && <section className="inspector-section"><h3>출력 연결</h3>{selectedPorts.outputs.length > 1 && <label className="field"><span className="field-label">출력 포트</span><select aria-label="출력 포트" value={selectedPorts.outputs.includes(connectingPort) ? connectingPort : selectedPorts.outputs[0]} onChange={event => setConnectingPort(event.target.value)}>{selectedPorts.outputs.map(port => <option key={port} value={port}>{port}</option>)}</select></label>}<label className="field"><span className="field-label">연결할 입력 선택</span><select value={connectingFrom} onChange={(event) => setConnectingFrom(event.target.value)}><option value="">블록과 입력 포트</option>{model.nodes.flatMap((node) => getBlockPorts(node, model).inputs.filter((port) => !model.edges.some((edge) => edge.target.nodeId === node.id && edge.target.portId === port)).map((port) => <option key={`${node.id}:${port}`} value={`${node.id}:${port}`}>{node.label} · {port}</option>))}</select></label><button className="button full-width" disabled={!connectingFrom} onClick={() => { const target = model.nodes.flatMap((node) => getBlockPorts(node, model).inputs.map((port) => ({ value: `${node.id}:${port}`, nodeId: node.id, portId: port }))).find((option) => option.value === connectingFrom); if (target) connect({ source: selected.id, sourceHandle: selectedPorts.outputs.includes(connectingPort) ? connectingPort : selectedPorts.outputs[0], target: target.nodeId, targetHandle: target.portId }); setConnectingFrom(''); }}><Icon name="link" size={15}/>출력 연결하기</button></section>}<div className="support-note"><Icon name="info" size={15}/><span>{selectedDefinition.supportedModes.map((mode) => MODE_LABELS[mode]).join(' · ')}에서 사용합니다.</span></div><button className="button danger full-width" onClick={removeSelection}><Icon name="trash" size={16}/>블록 삭제</button></> : selectedEdgeId ? <><div className="connection-summary"><Icon name="link" size={24}/><h3>블록 사이의 값 연결</h3><p>출력 포트에서 입력 포트로 같은 신호 값을 전달합니다. 타입·크기·단위는 실행 전에 확인합니다.</p></div><button className="button danger full-width" onClick={removeSelection}><Icon name="trash" size={16}/>연결 삭제</button></> : <><div className="model-summary"><span className="model-summary-icon"><Icon name="layers" size={24}/></span><strong>계산의 흐름을 만드세요</strong><p>블록을 선택하면 입력값과 연결을<br/>여기에서 바꿀 수 있습니다.</p></div><section className="inspector-section"><h3>모델 안의 블록 <span className="tag">{model.nodes.length}</span></h3><div className="model-node-list">{model.nodes.map((node) => <button key={node.id} aria-pressed={selectedIds.includes(node.id)} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey) setSelectedIds(ids => ids.includes(node.id) ? ids.filter(id => id !== node.id) : [...ids, node.id]); else setSelectedId(node.id); setSelectedEdgeId(null); }}><span className={`mini-symbol ${blockTone(node.blockType)}`} aria-hidden="true">{BLOCK_SYMBOLS[node.blockType]}</span><span>{node.label}</span><Icon name="arrow" size={14}/></button>)}{!model.nodes.length && <p className="muted-copy">라이브러리에서 블록을 추가하세요.</p>}</div></section></>}
        {selectedIds.length > 0 && <div className="selection-actions"><button className="button" onClick={copyBlocks}>선택 복사</button><button className="button" onClick={() => pasteBlocks(true)}>선택 복제</button></div>}<section className="inspector-section execution-settings"><h3>실행 설정 <span className="tag">0.8</span></h3><label className="field"><span className="field-label">실행 방식</span><select aria-label="실행 방식" value={model.execution.mode} onChange={(event) => commit((current) => ({ ...current, execution: executionForMode(current.execution, event.target.value as ExecutionMode) }))}>{Object.entries(MODE_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select></label>{model.execution.mode !== 'static' && <><div className="field-pair"><NumericField label="시작 시간" value={model.execution.startTime} min={-MODEL_LIMITS.maxTime} max={MODEL_LIMITS.maxTime} suffix="s" onChange={(startTime) => commit((current) => ({ ...current, execution: { ...current.execution, startTime } }))}/><NumericField label="종료 시간" value={model.execution.stopTime} min={-MODEL_LIMITS.maxTime} max={MODEL_LIMITS.maxTime} suffix="s" onChange={(stopTime) => commit((current) => ({ ...current, execution: { ...current.execution, stopTime } }))}/></div><NumericField label="시간 간격" value={model.execution.step} min={MODEL_LIMITS.minStep} max={MODEL_LIMITS.maxTime} suffix="s" onChange={(step) => commit((current) => ({ ...current, execution: { ...current.execution, step } }))}/></>}{model.execution.mode === 'continuous' && <SolverSettingsEditor execution={model.execution} onChange={solver => commit(current => ({ ...current, execution: { ...current.execution, solver } }))}/>}<p className="execution-note">{model.execution.mode === 'static' ? '연결된 값을 한 번 계산합니다. 상태 블록은 시간 실행을 선택하세요.' : model.execution.mode === 'discrete' ? '정수 tick에서 각 블록의 rate에 따라 실행하고 상태를 함께 갱신합니다. 다른 rate 사이는 Rate Transition으로 연결하세요.' : '단위 1의 유한한 scalar ODE를 적분하며 이산 신호는 tick 사이의 값을 유지합니다. 연속 신호를 이산 입력으로 보낼 때는 Zero-Order Hold를 연결하세요.'}</p></section><div className="storage-note"><Icon name="info" size={15}/><span>이 기기의 브라우저에 자동 저장됩니다. 모델 파일을 내려받아 별도로 보관하세요.<button className="text-button" onClick={() => void openRecovery()}>저장 복구본 확인</button></span></div></div></aside>
      {workspaceTab !== 'diagram' && <M4WorkspaceTools tab={workspaceTab} model={rootModel} onChange={next => commitRoot(() => next)} notice={setNotice} onPlayback={(dataset, column) => { navigateHierarchy([]); const node = createBlockNode('source.dataset', rootRef.current.nodes.length); node.label = `${dataset.name} · ${column}`.slice(0, 100); node.parameters = { datasetId: dataset.id, column, interpolation: dataset.columns.find(item => item.name === column)?.kind === 'boolean' ? 'previous' : 'linear', outside: 'hold' }; commitRoot(current => ({ ...current, nodes: [...current.nodes, node], layout: { ...current.layout, [node.id]: { x: 100, y: 120 } } })); setSelectedId(node.id); setNotice('데이터 재생 블록을 추가했습니다. 결과 블록과 연결해 실행하세요.'); }} history={runHistory} historyError={historyError} onDeleteRecord={id => { const records = historyRef.current.filter(record => record.id !== id); historyRef.current = records; setRunHistory(records); if (historyWritable.current) historySaveQueue.current = historySaveQueue.current.then(() => saveRunHistory(records)).catch(error => { historyWritable.current = false; setHistoryError(String(error)); }); }} onRestoreRecord={record => { if (busy) resetRun(); replaceRoot(structuredClone(record.model)); setNotice('실행 당시의 모델 스냅샷을 복원했습니다.'); }} onHistoryRecovery={() => { void loadRawRunHistory().then(raw => downloadText(JSON.stringify(raw, null, 2), 'CalcWeave-history-recovery.json', 'application/json')).catch(error => setNotice(String(error))); }} busy={busy} onSweep={sweep} onCancelSweep={cancel} onScopeRange={applyScopeRange} sweepProgress={sweepProgress} result={lastRun} resultCurrent={currentResult} outputTypes={compiledPreview?.outputTypes ?? {}}/>}
    </main>

    {loaded && !localSavingEnabled && !storageConflict && <div className="save-recovery-banner" role="alert"><span>{resetIncomplete ? '초기화를 완료하지 못해 자동 저장을 중지했습니다. 현재 작업을 백업한 뒤 로컬 데이터 관리를 다시 열어 삭제를 시도하세요.' : '저장된 모델을 읽지 못해 자동 저장을 중지했습니다. 다시 시작하면 기존 원본을 복구본으로 보관한 뒤 현재 모델을 저장합니다.'}</span>{!resetIncomplete && <button className="button" onClick={() => { setLocalSavingEnabled(true); setNotice('기존 원본을 보존하고 현재 모델의 자동 저장을 다시 시작합니다.'); }}>현재 모델 저장 다시 시작</button>}</div>}
    {storageConflict && <div className="save-recovery-banner" role="alert"><span>다른 탭에서 저장 공간이 바뀌어 자동 저장을 중지했습니다. 현재 작업을 먼저 백업하세요.</span><button className="button" onClick={() => setManagementOpen(true)}>현재 작업 백업</button><button className="button" onClick={() => location.reload()}>최신 저장본 불러오기</button></div>}
    <footer className="statusbar"><div><span className={runState === 'failed' ? 'status-dot error' : busy ? 'status-dot working' : 'status-dot'}/><span role="status" aria-live="polite">{notice || RUN_LABELS[runState]}</span></div><div><span>float64 · boolean · 벡터 · 2D</span><span className="status-divider"/><span>Ctrl + Enter 실행</span><span className="status-divider"/><span>로컬 작업 공간</span></div></footer>
    <div className="visually-hidden" aria-live="polite">{RUN_LABELS[runState]} · {SAVE_LABELS[saveState]} {lastRun && !currentResult ? '계산에 영향을 주는 내용이 바뀌었습니다. 다시 계산이 필요합니다.' : ''}</div>
    {quickInsertOpen && <QuickInsert onInsert={(item: InsertItem) => addBlock(item.blockType, item.parameters)} onClose={() => setQuickInsertOpen(false)}/>}
    <dialog ref={recoveryDialog} className="workspace-dialog recovery-dialog" aria-modal="true" tabIndex={-1} aria-labelledby="recovery-title" onCancel={event => { event.preventDefault(); setRecovery(null); }}>{recovery && <><div className="dialog-heading"><div><h2 id="recovery-title">저장 복구본</h2><p>현재 모델을 바꾸기 전에 복구본을 확인하세요.</p></div><button className="icon-button" aria-label="복구본 닫기" onClick={() => setRecovery(null)}><Icon name="close"/></button></div>{recoveryError && <p className="recovery-message" role="status">{recoveryError}</p>}{recovery.checkpoint ? <section className="recovery-entry"><h3>이전 유효 저장본</h3><strong>{recovery.checkpoint.model.name}</strong><p>{recovery.checkpoint.model.nodes.length}개 블록 · {recovery.checkpoint.model.edges.length}개 연결 {recovery.checkpoint.savedAt && `· ${new Date(recovery.checkpoint.savedAt).toLocaleString('ko-KR')}`}</p><div><button className="button primary" onClick={() => { const restored = recovery.checkpoint!.model; replaceRoot(structuredClone(restored)); setSelectedIds([]); setSelectedEdgeIds([]); setRecovery(null); setNotice('이전 저장본을 복원했습니다. 실행 취소로 현재 모델로 돌아갈 수 있습니다.'); window.requestAnimationFrame(() => void fitView({ ...READABLE_VIEW, duration: 0 })); }}>이전 저장본 복원</button><button className="button" onClick={() => downloadRecovery(recovery.checkpoint!.model, 'CalcWeave-checkpoint.cw.json')}>복구본 다운로드</button></div></section> : !recoveryError && <p className="recovery-message">이전 유효 저장본이 아직 없습니다. 변경한 모델이 자동 저장되면 이전 모델을 한 개 보관합니다.</p>}{recovery.original !== null && <section className="recovery-entry"><h3>읽지 못한 원본</h3><p>지원하지 않는 버전이나 손상된 형식의 원본입니다. 자동으로 열지 않으며 파일로 보관할 수 있습니다.</p><button className="button" onClick={() => downloadRecovery(recovery.original, 'CalcWeave-original-recovery.json')}>원본 복구본 다운로드</button></section>}<p className="dialog-footnote">복구본은 같은 브라우저에만 있습니다. 모델 파일을 별도로 내려받아 보관하세요.</p></>}</dialog>
    {managementOpen && <LocalDataDialog model={rootModel} history={runHistory} historyError={historyError} busy={busy} invalidDraft={invalidNumericCount > 0} onClose={() => setManagementOpen(false)} onMutation={mutateLocalWorkspace}/>}
    {codeExportOpen && <CodeExportDialog model={rootModel} invalidDraft={invalidNumericCount > 0} hasExpected={currentResult && lastRun?.result.status === 'completed'} onClose={() => setCodeExportOpen(false)} onDownload={downloadTarget}/>}
    {packageOpen && <ModelPackageDialog model={rootModel} busy={busy} invalidDraft={invalidNumericCount > 0} onClose={() => setPackageOpen(false)} onImport={(next, checkedDiagnostics) => { replaceRoot(next); setSelectedIds([]); setSelectedEdgeIds([]); setDiagnostics(checkedDiagnostics); if (checkedDiagnostics.length) setResultsTab('diagnostics'); setNotice(`${next.name} 공유 모델을 가져왔습니다. 실행 취소로 이전 모델로 돌아갈 수 있습니다.`); window.requestAnimationFrame(() => void fitView({ ...READABLE_VIEW, duration: 0 })); }}/>}
    {importReportOpen && importReport && <ModelImportReportDialog report={importReport} onClose={() => setImportReportOpen(false)}/>}
    {helpOpen && <SupportDialog onClose={() => setHelpOpen(false)} onManage={() => { setHelpOpen(false); setManagementOpen(true); }}/>} 
  </div></NumericValidityContext.Provider>;
}

export default function App() { return <ReactFlowProvider><Workspace/></ReactFlowProvider>; }
