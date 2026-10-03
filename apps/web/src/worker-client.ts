import { ModelError, type CalcModel, type Diagnostic, type RunResult, type DashboardAppliedEvent } from '../../../packages/model/src/types';

export interface WorkerRun { result: RunResult; semanticHash: string; engineVersion: string; replayModel?: CalcModel }
export interface WorkerBudget { maxWallMs: number; maxRecordedValues: number; maxOperations: number; trackOperations: true }
export class WorkerRunError extends ModelError {
  constructor(diagnostics: Diagnostic[], partialResult?: RunResult, public readonly semanticHash = '', public readonly engineVersion = '', public readonly replayModel?: CalcModel) { super(diagnostics, partialResult); }
}
type ActiveRun = { worker: Worker; requestId: string; reject: (error: Error) => void; timeout?: ReturnType<typeof setTimeout>; cancelTimeout?: ReturnType<typeof setTimeout>; controlTimeout?: ReturnType<typeof setTimeout>; paused: boolean; controlPending?: 'pause' | 'resume'; remainingMs: number; timerStarted: number; timerRevision: number };
let active: ActiveRun | undefined;

function dispose(run: ActiveRun) {
  clearTimeout(run.timeout);
  if (run.cancelTimeout) clearTimeout(run.cancelTimeout);
  if (run.controlTimeout) clearTimeout(run.controlTimeout);
  run.worker.terminate();
  if (active === run) active = undefined;
}

function armWatchdog(run: ActiveRun) {
  const revision = ++run.timerRevision;
  run.timerStarted = performance.now();
  run.timeout = setTimeout(() => {
    if (active !== run || run.paused || revision !== run.timerRevision) return;
    run.reject(new ModelError([{ code: 'RUNTIME_WALL_BUDGET', message: '실행 시간 한도를 넘었습니다. 시간 범위나 모델 크기를 줄여 주세요.' }]));
    dispose(run);
  }, Math.max(0, run.remainingMs));
}

export function executeInWorker(model: CalcModel, onProgress?: (progress: { steps: number; time: number }) => void, onPauseChange?: (paused: boolean) => void, budget?: WorkerBudget, onDashboardEventApplied?: (event: DashboardAppliedEvent) => void): Promise<WorkerRun> {
  if (budget && (!Number.isFinite(budget.maxWallMs) || budget.maxWallMs <= 0 || budget.maxWallMs > 30_000 || !Number.isSafeInteger(budget.maxRecordedValues) || budget.maxRecordedValues < 1 || budget.maxRecordedValues > 1_000_000 || !Number.isSafeInteger(budget.maxOperations) || budget.maxOperations < 1 || budget.maxOperations > 50_000_000 || budget.trackOperations !== true)) return Promise.reject(new ModelError([{ code: 'RUNTIME_OPTIONS', message: '스윕의 남은 실행 한도를 확인해 주세요.' }]));
  if (active) {
    active.reject(new DOMException('새 실행으로 교체되었습니다.', 'AbortError'));
    dispose(active);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    const requestId = crypto.randomUUID();
    const run: ActiveRun = {
      worker, requestId, reject, paused: false, remainingMs: (budget?.maxWallMs ?? 30_000) + 1_000, timerStarted: 0, timerRevision: 0,
    };
    active = run;
    armWatchdog(run);
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (active !== run || message?.requestId !== requestId) return;
      if (message.type === 'dashboard-event-applied') onDashboardEventApplied?.(message.event as DashboardAppliedEvent);
      if (message.type === 'dashboard-event-rejected') onDashboardEventApplied?.({ nodeId: message.nodeId, value: NaN, time: -1, order: -1 });
      if (message.type === 'progress') onProgress?.(message.progress);
      if (message.type === 'activity' && typeof message.paused === 'boolean') {
        if (run.cancelTimeout || message.paused === run.paused) return;
        if (message.paused) {
          run.remainingMs = Math.max(0, run.remainingMs - (performance.now() - run.timerStarted));
          clearTimeout(run.timeout); run.timeout = undefined; run.timerRevision += 1; run.paused = true;
        } else { run.paused = false; armWatchdog(run); }
        clearTimeout(run.controlTimeout); run.controlTimeout = undefined; run.controlPending = undefined;
        onPauseChange?.(run.paused);
      }
      if (message.type === 'result') {
        resolve({ result: message.result as RunResult, semanticHash: message.semanticHash, engineVersion: message.engineVersion, ...(message.replayModel ? { replayModel: message.replayModel as CalcModel } : {}) });
        dispose(run);
      }
      if (message.type === 'error') {
        reject(new WorkerRunError(message.diagnostics as Diagnostic[], message.partialResult as RunResult | undefined, typeof message.semanticHash === 'string' ? message.semanticHash : '', typeof message.engineVersion === 'string' ? message.engineVersion : '', message.replayModel as CalcModel | undefined));
        dispose(run);
      }
    };
    worker.onerror = () => {
      reject(new ModelError([{ code: 'WORKER_FAILURE', message: '계산 작업을 시작하지 못했습니다. 다시 실행해 주세요.' }]));
      dispose(run);
    };
    try {
      worker.postMessage({ type: 'run', requestId, model: structuredClone(model), ...(budget ? { budget } : {}) });
    } catch {
      reject(new ModelError([{ code: 'WORKER_MESSAGE_FAILED', message: '모델을 계산 작업에 전달하지 못했습니다. 다시 실행해 주세요.' }]));
      dispose(run);
    }
  });
}

function requestControl(type: 'pause' | 'resume'): boolean {
  const run = active;
  if (!run || run.cancelTimeout || run.controlPending || (type === 'pause' ? run.paused : !run.paused)) return false;
  try { run.worker.postMessage({ type, requestId: run.requestId }); }
  catch {
    run.reject(new ModelError([{ code: 'WORKER_MESSAGE_FAILED', message: '실행 제어를 계산 작업에 전달하지 못했습니다. 다시 실행해 주세요.' }]));
    dispose(run); return false;
  }
  run.controlPending = type;
  run.controlTimeout = setTimeout(() => {
    if (active !== run || run.controlPending !== type) return;
    run.reject(new ModelError([{ code: 'WORKER_CONTROL_TIMEOUT', message: '계산 작업이 실행 제어에 응답하지 않았습니다. 다시 실행해 주세요.' }]));
    dispose(run);
  }, 2_000);
  return true;
}

export function pauseActiveRun(): boolean { return requestControl('pause'); }
export function resumeActiveRun(): boolean { return requestControl('resume'); }

export function cancelActiveRun(): void {
  if (!active || active.cancelTimeout) return;
  const run = active;
  try {
    run.worker.postMessage({ type: 'cancel', requestId: run.requestId });
  } catch {
    run.reject(new DOMException('실행을 정지했습니다.', 'AbortError'));
    dispose(run);
    return;
  }
  run.cancelTimeout = setTimeout(() => {
    run.reject(new DOMException('실행을 정지했습니다.', 'AbortError'));
    dispose(run);
  }, 800);
}

/** Queue a numeric source/gain edit for the next discrete execution boundary. */
export function queueDashboardEvent(nodeId: string, value: number): boolean {
  const run = active;
  if (!run || run.cancelTimeout || typeof nodeId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(nodeId) || !Number.isFinite(value)) return false;
  try { run.worker.postMessage({ type: 'dashboard-event', requestId: run.requestId, nodeId, value }); return true; }
  catch { return false; }
}
