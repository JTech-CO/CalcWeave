import { ModelError, type CompiledModel, type RunOptions, type RunResult } from '../../model/src/types';
import { createContinuousExecution } from './continuous-execution';

/** Cooperative browser runner. Numerical trials stay synchronous and transactional. */
export async function runContinuous(compiled: CompiledModel, options: RunOptions = {}): Promise<RunResult> {
  const started = performance.now();
  const maxWallMs = options.maxWallMs ?? 30_000, maxRecordedValues = options.maxRecordedValues ?? 1_000_000;
  const maxOperations = options.maxOperations ?? 50_000_000;
  if (!Number.isFinite(maxWallMs) || maxWallMs <= 0 || maxWallMs > 120_000 || !Number.isSafeInteger(maxRecordedValues) || maxRecordedValues < 1 || maxRecordedValues > 1_000_000) throw new ModelError([{ code: 'RUNTIME_OPTIONS', message: '실행 시간 또는 기록 한도를 확인해 주세요.' }]);
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > 50_000_000 || (options.trackOperations !== undefined && typeof options.trackOperations !== 'boolean')) throw new ModelError([{ code: 'RUNTIME_OPTIONS', message: '연산 한도와 기록 옵션을 확인해 주세요.' }]);
  let pausedMs = 0, chunkStarted = started, pausedAt: number | undefined;
  const elapsed = (): number => performance.now() - started - pausedMs - (pausedAt === undefined ? 0 : performance.now() - pausedAt);
  const engine = createContinuousExecution(compiled, { maxRecordedValues, maxOperations, trackOperations: options.trackOperations, check: () => { if (elapsed() > maxWallMs) throw new ModelError([{ code: 'RUNTIME_WALL_BUDGET', message: '실행 시간 한도를 초과했습니다.' }]); } });
  async function pause(): Promise<void> {
    const control = options.control;
    if (!control?.isPaused() || options.signal?.aborted) return;
    pausedAt = performance.now(); options.onPauseChange?.(true);
    try {
      while (control.isPaused() && !options.signal?.aborted) {
        let abort: (() => void) | undefined;
        const aborted = new Promise<void>((resolve) => { abort = resolve; options.signal?.addEventListener('abort', abort, { once: true }); });
        try { await Promise.race([control.waitForResume(), aborted]); }
        finally { if (abort) options.signal?.removeEventListener('abort', abort); }
      }
    } finally { pausedMs += performance.now() - pausedAt; pausedAt = undefined; chunkStarted = performance.now(); options.onPauseChange?.(false); }
  }
  let attempts = 0;
  try {
    while (true) {
      if (options.signal?.aborted) return engine.result('cancelled', elapsed());
      await pause();
      if (options.signal?.aborted) return engine.result('cancelled', elapsed());
      const continuing = engine.advance(); attempts += 1;
      const shouldYield = attempts % 64 === 0 || performance.now() - chunkStarted >= 8;
      if (attempts === 1 || shouldYield || !continuing) options.onProgress?.({ steps: engine.sampleCount, time: engine.currentTime });
      if (options.signal?.aborted) return engine.result('cancelled', elapsed());
      if (!continuing) return engine.result('completed', elapsed());
      if (shouldYield) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); chunkStarted = performance.now(); }
    }
  } catch (error) {
    if (error instanceof ModelError) {
      const partial = error.partialResult ?? engine.result('failed');
      throw new ModelError(error.diagnostics, { ...partial, elapsedMs: elapsed() });
    }
    throw error;
  }
}
