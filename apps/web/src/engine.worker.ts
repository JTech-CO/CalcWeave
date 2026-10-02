/// <reference lib="webworker" />
import { z } from 'zod';
import { compileModel } from '../../../packages/compiler/src';
import { ENGINE_VERSION, ModelError } from '../../../packages/model/src/types';
import { runModel } from '../../../packages/runtime/src';

const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run'), requestId: z.string().uuid(), model: z.unknown(), budget: z.object({
    maxWallMs: z.number().finite().positive().max(30_000), maxRecordedValues: z.number().int().min(1).max(1_000_000),
    maxOperations: z.number().int().min(1).max(50_000_000), trackOperations: z.literal(true),
  }).strict().optional() }).strict(),
  z.object({ type: z.literal('cancel'), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('pause'), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('resume'), requestId: z.string().uuid() }).strict(),
]);
let active: { requestId: string; abort: AbortController; paused: boolean; wake?: () => void } | undefined;
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<unknown>) => {
  const parsed = requestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data;
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
  const run = { requestId: request.requestId, abort, paused: false, wake: undefined as (() => void) | undefined };
  active = run;
  let semanticHash = '';
  try {
    // Revalidate imported/UI data inside the execution boundary.
    const compiled = compileModel(request.model);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(compiled.semanticKey));
    semanticHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const result = await runModel(compiled, {
      ...request.budget,
      signal: abort.signal,
      onProgress: progress => scope.postMessage({ type: 'progress', requestId: request.requestId, progress }),
      control: {
        isPaused: () => run.paused,
        waitForResume: () => !run.paused || abort.signal.aborted ? Promise.resolve() : new Promise<void>(resolve => { run.wake = () => { run.wake = undefined; resolve(); }; }),
      },
      onPauseChange: paused => scope.postMessage({ type: 'activity', requestId: request.requestId, paused }),
    });
    scope.postMessage({ type: 'result', requestId: request.requestId, result, semanticHash, engineVersion: ENGINE_VERSION });
  } catch (error) {
    const diagnostics = error instanceof ModelError ? error.diagnostics : [{ code: 'WORKER_FAILURE', message: '계산을 완료하지 못했습니다. 모델과 실행 조건을 확인해 주세요.' }];
    scope.postMessage({ type: 'error', requestId: request.requestId, diagnostics, ...(error instanceof ModelError && error.partialResult ? { partialResult: error.partialResult } : {}), semanticHash, engineVersion: ENGINE_VERSION });
  } finally {
    if (active?.requestId === request.requestId) active = undefined;
  }
};
