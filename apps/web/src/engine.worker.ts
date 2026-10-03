/// <reference lib="webworker" />
import { z } from 'zod';
import { compileModel } from '../../../packages/compiler/src';
import { ENGINE_VERSION, ModelError, type CalcModel, type DashboardAppliedEvent } from '../../../packages/model/src/types';
import { appendDashboardReplayEvents } from './dashboard-replay';
import { runModel } from '../../../packages/runtime/src';

const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run'), requestId: z.string().uuid(), model: z.unknown(), budget: z.object({
    maxWallMs: z.number().finite().positive().max(30_000), maxRecordedValues: z.number().int().min(1).max(1_000_000),
    maxOperations: z.number().int().min(1).max(50_000_000), trackOperations: z.literal(true),
  }).strict().optional() }).strict(),
  z.object({ type: z.literal('dashboard-event'), requestId: z.string().uuid(), nodeId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('cancel'), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('pause'), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('resume'), requestId: z.string().uuid() }).strict(),
]);
let active: { requestId: string; abort: AbortController; paused: boolean; wake?: () => void; model?: CalcModel; queue: { nodeId: string; value: number }[]; receipts: DashboardAppliedEvent[] } | undefined;
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<unknown>) => {
  const parsed = requestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data;
  if (request.type === 'dashboard-event') {
    const run = active;
    if (run?.requestId !== request.requestId) return;
    const node = run.model?.nodes.find(node => node.id === request.nodeId), count = (node && typeof node.parameters.events === 'string' ? JSON.parse(node.parameters.events).length : 0) + run.queue.filter(event => event.nodeId === request.nodeId).length + run.receipts.filter(event => event.nodeId === request.nodeId).length;
    if (run.model?.execution.mode !== 'discrete' || !node || !['dashboard.control', 'math.slider-gain'].includes(node.blockType) || request.value < Number(node.parameters.min) || request.value > Number(node.parameters.max) || run.receipts.length + run.queue.length >= 256 || count >= 256) {
      scope.postMessage({ type: 'dashboard-event-rejected', requestId: run.requestId, nodeId: request.nodeId }); return;
    }
    run.queue.push({ nodeId: request.nodeId, value: request.value }); return;
  }
  if (request.type === 'cancel') {
    if (active?.requestId === request.requestId) { active.abort.abort(); active.wake?.(); }
    return;
  }
  if (request.type === 'pause' || request.type === 'resume') {
    if (active?.requestId === request.requestId) {
      active.paused = request.type === 'pause';
      if (!active.paused) active.wake?.();
    }
    return;
  }
  if (active) {
    scope.postMessage({ type: 'error', requestId: request.requestId, diagnostics: [{ code: 'RUN_BUSY', message: '실행 중입니다. 먼저 정지해 주세요.' }] });
    return;
  }
  const abort = new AbortController();
  const run = { requestId: request.requestId, abort, paused: false, wake: undefined as (() => void) | undefined, model: undefined as CalcModel | undefined, queue: [] as { nodeId: string; value: number }[], receipts: [] as DashboardAppliedEvent[] };
  active = run;
  let semanticHash = '';
  let replayModel: CalcModel | undefined;
  try {
    // Revalidate imported/UI data inside the execution boundary.
    const compiled = compileModel(request.model); run.model = compiled.model;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(compiled.semanticKey));
    semanticHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const result = await runModel(compiled, {
      ...request.budget,
      signal: abort.signal,
      onProgress: progress => scope.postMessage({ type: 'progress', requestId: request.requestId, progress }),
      control: {
        isPaused: () => run.paused,
        ...(compiled.model.execution.mode === 'discrete' ? { takeDashboardEvents: () => run.queue.splice(0, 32) } : {}),
        waitForResume: () => !run.paused || abort.signal.aborted ? Promise.resolve() : new Promise<void>(resolve => { run.wake = () => { run.wake = undefined; resolve(); }; }),
      },
      onDashboardEventApplied: event => { run.receipts.push(event); scope.postMessage({ type: 'dashboard-event-applied', requestId: request.requestId, event }); },
      onPauseChange: paused => scope.postMessage({ type: 'activity', requestId: request.requestId, paused }),
    });
    if (run.receipts.length) {
      const candidate = appendDashboardReplayEvents(compiled.model, run.receipts);
      const replay = compileModel(candidate); replayModel = replay.model;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(replay.semanticKey));
      semanticHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    scope.postMessage({ type: 'result', requestId: request.requestId, result, semanticHash, engineVersion: ENGINE_VERSION, ...(replayModel ? { replayModel } : {}) });
  } catch (error) {
    if (run.receipts.length && run.model) {
      try {
        const replay = compileModel(appendDashboardReplayEvents(run.model, run.receipts)); replayModel = replay.model;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(replay.semanticKey));
        semanticHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      } catch { /* Do not replace the original diagnostic if constructing the bounded snapshot fails. */ }
    }
    const diagnostics = error instanceof ModelError ? error.diagnostics : [{ code: 'WORKER_FAILURE', message: '계산을 완료하지 못했습니다. 모델과 실행 조건을 확인해 주세요.' }];
    scope.postMessage({ type: 'error', requestId: request.requestId, diagnostics, ...(error instanceof ModelError && error.partialResult ? { partialResult: error.partialResult } : {}), semanticHash, engineVersion: ENGINE_VERSION, ...(replayModel ? { replayModel } : {}) });
  } finally {
    if (active?.requestId === request.requestId) active = undefined;
  }
};
