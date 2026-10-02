import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalcModel, RunResult } from '../packages/model/src/types';

type WorkerMessage = { type: string; requestId: string; model?: CalcModel; budget?: unknown };

class WorkerStub {
  static instances: WorkerStub[] = [];
  static failRunPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  failCancelPost = false;
  failControlPost = false;
  messages: WorkerMessage[] = [];
  terminate = vi.fn();
  postMessage = vi.fn((message: WorkerMessage) => {
    this.messages.push(message);
    if ((message.type === 'run' && WorkerStub.failRunPost) || (message.type === 'cancel' && this.failCancelPost) || ((message.type === 'pause' || message.type === 'resume') && this.failControlPost)) {
      throw new DOMException('The message could not be cloned.', 'DataCloneError');
    }
  });
  constructor() { WorkerStub.instances.push(this); }
  get requestId(): string { return this.messages.find((message) => message.type === 'run')!.requestId; }
  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}

const model: CalcModel = {
  schemaVersion: 1, modelId: 'worker-test', name: 'Worker test',
  nodes: [
    { id: 'source', blockType: 'source.constant', blockVersion: 1, label: 'Source', parameters: { value: 2 } },
    { id: 'result', blockType: 'sink.display', blockVersion: 1, label: 'Result', parameters: {} },
  ],
  edges: [{ id: 'edge', source: { nodeId: 'source', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }],
  layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 },
};
const result: RunResult = { samples: [{ time: 0, values: { result: 2 } }], finalState: {}, status: 'completed', elapsedMs: 1, steps: 1 };
function finish(worker: WorkerStub, requestId = worker.requestId): void {
  worker.emit({ type: 'result', requestId, result, semanticHash: 'test-hash', engineVersion: '0.0.1-m0' });
}

describe('Worker client lifecycle and failed messages', () => {
  let client: typeof import('../apps/web/src/worker-client');
  const clone = globalThis.structuredClone;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    WorkerStub.instances = [];
    WorkerStub.failRunPost = false;
    vi.stubGlobal('Worker', WorkerStub);
    let sequence = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` });
    client = await import('../apps/web/src/worker-client');
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends a bounded shared sweep budget and rejects invalid limits before allocating a Worker', async () => {
    const budget = { maxWallMs: 2500, maxRecordedValues: 1200, maxOperations: 5000, trackOperations: true as const };
    const running = client.executeInWorker(model, undefined, undefined, budget);
    const worker = WorkerStub.instances[0]!; expect(worker.messages[0]!.budget).toEqual(budget); finish(worker); await running;
    await expect(client.executeInWorker(model, undefined, undefined, { ...budget, maxOperations: 50_000_001 })).rejects.toThrow();
    expect(WorkerStub.instances).toHaveLength(1);
    const next = client.executeInWorker(model); const ordinary = WorkerStub.instances[1]!;
    expect(ordinary.messages[0]!.budget).toBeUndefined(); finish(ordinary); await next;
  });

  it('disposes the Worker and clears active/watchdog after the first postMessage fails', async () => {
    WorkerStub.failRunPost = true;
    await expect(client.executeInWorker(model)).rejects.toMatchObject({ diagnostics: [{ code: 'WORKER_MESSAGE_FAILED' }] });
    const failed = WorkerStub.instances[0]!;
    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    client.cancelActiveRun();
    expect(failed.postMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    WorkerStub.failRunPost = false;
    const retry = client.executeInWorker(model);
    finish(WorkerStub.instances[1]!);
    await expect(retry).resolves.toMatchObject({ result });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the last valid continuous record and execution identity on a solver failure', async () => {
    const running = client.executeInWorker({ ...model, execution: { mode: 'continuous', startTime: 0, stopTime: 1, step: 0.1 } });
    const partial: RunResult = { ...result, status: 'failed', solverStatistics: { method: 'rk45', acceptedSteps: 0, rejectedSteps: 1, evaluations: 7, events: 0, lastStep: 0, minAcceptedStep: 0, maxAcceptedStep: 0 }, events: [] };
    const rejected = expect(running).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_MIN_STEP', nodeId: 'source', time: 0 }], partialResult: partial, semanticHash: 'continuous-hash', engineVersion: '0.3.0-m3' });
    const worker = WorkerStub.instances[0]!;
    worker.emit({ type: 'error', requestId: worker.requestId, diagnostics: [{ code: 'RUNTIME_MIN_STEP', nodeId: 'source', time: 0, message: 'Minimum step reached' }], partialResult: partial, semanticHash: 'continuous-hash', engineVersion: '0.3.0-m3' });
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also disposes the Worker when structuredClone fails before the first post', async () => {
    vi.stubGlobal('structuredClone', () => { throw new DOMException('Uncloneable value', 'DataCloneError'); });
    await expect(client.executeInWorker(model)).rejects.toMatchObject({ diagnostics: [{ code: 'WORKER_MESSAGE_FAILED' }] });
    const failed = WorkerStub.instances[0]!;
    expect(failed.postMessage).not.toHaveBeenCalled();
    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    client.cancelActiveRun();
    expect(failed.postMessage).not.toHaveBeenCalled();

    vi.stubGlobal('structuredClone', clone);
    const retry = client.executeInWorker(model);
    finish(WorkerStub.instances[1]!);
    await expect(retry).resolves.toMatchObject({ result });
  });

  it('rejects and cleans up immediately if the cancel message fails', async () => {
    const running = client.executeInWorker(model);
    const aborted = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    const worker = WorkerStub.instances[0]!;
    worker.failCancelPost = true;
    expect(() => client.cancelActiveRun()).not.toThrow();
    await aborted;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    client.cancelActiveRun();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);

    const retry = client.executeInWorker(model);
    finish(WorkerStub.instances[1]!);
    await expect(retry).resolves.toMatchObject({ result });
  });

  it('forces termination at the cancellation deadline when the Worker never responds', async () => {
    const running = client.executeInWorker(model);
    const aborted = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    const worker = WorkerStub.instances[0]!;
    client.cancelActiveRun();
    client.cancelActiveRun();
    expect(worker.messages.filter((message) => message.type === 'cancel')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(799);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await aborted;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores replaced-run messages and queued old watchdog callbacks without harming the new run', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const oldRun = client.executeInWorker(model);
    const oldOutcome = oldRun.catch((error: unknown) => error);
    const oldWorker = WorkerStub.instances[0]!;
    const oldWatchdog = timers.mock.calls[0]![0] as () => void;
    const onProgress = vi.fn();
    const current = client.executeInWorker(model, onProgress);
    const currentWorker = WorkerStub.instances[1]!;
    expect(await oldOutcome).toMatchObject({ name: 'AbortError' });

    // A callback can already be queued when a timer is cleared or a Worker terminates.
    oldWatchdog();
    oldWorker.emit({ type: 'progress', requestId: oldWorker.requestId, progress: { steps: 999, time: 999 } });
    finish(oldWorker);
    oldWorker.onerror?.({} as ErrorEvent);
    currentWorker.emit({ type: 'result', requestId: oldWorker.requestId, result });
    expect(onProgress).not.toHaveBeenCalled();
    expect(currentWorker.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    currentWorker.emit({ type: 'progress', requestId: currentWorker.requestId, progress: { steps: 1, time: 0 } });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({ steps: 1, time: 0 });
    finish(currentWorker);
    await expect(current).resolves.toMatchObject({ result });
    expect(currentWorker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the new run active when a replaced run cancellation deadline fires late', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const oldRun = client.executeInWorker(model);
    const oldOutcome = oldRun.catch((error: unknown) => error);
    client.cancelActiveRun();
    const oldCancelDeadline = timers.mock.calls.find((call) => call[1] === 800)![0] as () => void;
    const current = client.executeInWorker(model);
    const currentWorker = WorkerStub.instances[1]!;
    expect(await oldOutcome).toMatchObject({ name: 'AbortError' });
    oldCancelDeadline();
    expect(currentWorker.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    finish(currentWorker);
    await expect(current).resolves.toMatchObject({ result });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('freezes only after a pause acknowledgement and resumes the remaining active-time watchdog', async () => {
    const onPauseChange = vi.fn();
    const running = client.executeInWorker(model, undefined, onPauseChange);
    const outcome = expect(running).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_WALL_BUDGET' }] });
    const worker = WorkerStub.instances[0]!;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.pauseActiveRun()).toBe(true); expect(client.pauseActiveRun()).toBe(false);
    expect(onPauseChange).not.toHaveBeenCalled();
    worker.emit({ type: 'activity', requestId: worker.requestId, paused: true });
    expect(onPauseChange).toHaveBeenCalledExactlyOnceWith(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(worker.terminate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(client.resumeActiveRun()).toBe(true); expect(client.resumeActiveRun()).toBe(false);
    worker.emit({ type: 'activity', requestId: worker.requestId, paused: false });
    expect(onPauseChange.mock.calls).toEqual([[true], [false]]);
    await vi.advanceTimersByTimeAsync(20_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await outcome;
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores wrong-request and duplicate activity without restarting its execution deadline', async () => {
    const onPauseChange = vi.fn();
    const running = client.executeInWorker(model, undefined, onPauseChange);
    const outcome = expect(running).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_WALL_BUDGET' }] });
    const worker = WorkerStub.instances[0]!;
    worker.emit({ type: 'activity', requestId: 'old-request', paused: true });
    worker.emit({ type: 'activity', requestId: worker.requestId, paused: false });
    await vi.advanceTimersByTimeAsync(15_000);
    worker.emit({ type: 'activity', requestId: worker.requestId, paused: false });
    expect(onPauseChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16_000); await outcome;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('ignores a cleared but queued watchdog while paused and after resumption', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const running = client.executeInWorker(model);
    const worker = WorkerStub.instances[0]!;
    const oldWatchdog = timers.mock.calls[0]![0] as () => void;
    client.pauseActiveRun(); worker.emit({ type: 'activity', requestId: worker.requestId, paused: true });
    oldWatchdog(); expect(worker.terminate).not.toHaveBeenCalled();
    client.resumeActiveRun(); worker.emit({ type: 'activity', requestId: worker.requestId, paused: false });
    oldWatchdog(); expect(worker.terminate).not.toHaveBeenCalled();
    finish(worker); await expect(running).resolves.toMatchObject({ result });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates a paused Worker whose resume control never receives an acknowledgement', async () => {
    const running = client.executeInWorker(model);
    const outcome = expect(running).rejects.toMatchObject({ diagnostics: [{ code: 'WORKER_CONTROL_TIMEOUT' }] });
    const worker = WorkerStub.instances[0]!;
    client.pauseActiveRun(); worker.emit({ type: 'activity', requestId: worker.requestId, paused: true });
    expect(client.resumeActiveRun()).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000); await outcome;
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes failed pause posts and allows a fresh run', async () => {
    const running = client.executeInWorker(model);
    const outcome = expect(running).rejects.toMatchObject({ diagnostics: [{ code: 'WORKER_MESSAGE_FAILED' }] });
    const worker = WorkerStub.instances[0]!; worker.failControlPost = true;
    expect(client.pauseActiveRun()).toBe(false); await outcome;
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    expect(client.resumeActiveRun()).toBe(false);
    const retry = client.executeInWorker(model); finish(WorkerStub.instances[1]!);
    await expect(retry).resolves.toMatchObject({ result });
  });

  it('cancels a paused Worker and clears its control/watchdog deadlines', async () => {
    const running = client.executeInWorker(model);
    const outcome = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    const worker = WorkerStub.instances[0]!;
    client.pauseActiveRun(); worker.emit({ type: 'activity', requestId: worker.requestId, paused: true });
    client.cancelActiveRun();
    expect(client.resumeActiveRun()).toBe(false);
    await vi.advanceTimersByTimeAsync(800); await outcome;
    expect(worker.messages.at(-1)?.type).toBe('cancel');
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the original node, tick and time on runtime diagnostics', async () => {
    const running = client.executeInWorker(model);
    const diagnostics = [{ code: 'DIVIDE_BY_ZERO', message: '분모가 0입니다.', nodeId: 'gain', tick: 3, time: 0.3 }];
    const outcome = expect(running).rejects.toMatchObject({ diagnostics });
    const worker = WorkerStub.instances[0]!;
    worker.emit({ type: 'error', requestId: worker.requestId, diagnostics }); await outcome;
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
