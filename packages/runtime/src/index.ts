import { ModelError } from '../../model/src/types';
import type { CompiledModel, IRNode, RunOptions, RunResult, RunSample, SignalValue } from '../../model/src/types';
import { discreteMemoryElementCount } from '../../model/src/discrete';
import { checkSignal, copySignal, evaluateSignalNode, finiteNumber, nodeOperationCost, signalElements } from './kernels';
import { createDiscreteMachine } from './discrete-machine';
import { runContinuous } from './continuous-runner';

export const RUNTIME_LIMITS = Object.freeze({
  defaultMaxWallMs: 30_000,
  maxWallMs: 120_000,
  maxRecordedValues: 1_000_000,
  maxSteps: 10_000,
  maxOperations: 50_000_000,
  maxStateElements: 100_000,
  yieldAfterMs: 8,
  yieldEverySteps: 64,
});

function fail(code: string, message: string, nodeId?: string): never {
  throw new ModelError([{ code, message, ...(nodeId === undefined ? {} : { nodeId }) }]);
}

const finite = finiteNumber;

function objectValues(values: Map<string, number>): Record<string, number> {
  // Object.fromEntries defines own data properties, including names such as __proto__.
  return Object.fromEntries(values);
}

/**
 * Typed static/discrete execution, retaining M0 scalar RK4. A sample describes
 * the committed state at that time.
 * `steps` counts recorded samples, including the initial sample. No transition is
 * committed after the final sample. The compiler is the model validation boundary.
 */
export async function runModel(compiled: CompiledModel, options: RunOptions = {}): Promise<RunResult> {
  if (compiled.model.execution.mode === 'continuous') return runContinuous(compiled, options);
  const started = performance.now();
  const settings = { ...compiled.model.execution };
  // Compiled IR is deeply immutable. All execution state lives in separate maps.
  const nodes = compiled.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const stateIds = [...compiled.stateIds];
  const outputIds = [...compiled.outputIds];
  const maxWallMs = options.maxWallMs ?? RUNTIME_LIMITS.defaultMaxWallMs;
  const maxRecordedValues = options.maxRecordedValues ?? RUNTIME_LIMITS.maxRecordedValues;
  const maxOperations = options.maxOperations ?? RUNTIME_LIMITS.maxOperations;
  let pausedMs = 0;
  let pauseStarted: number | undefined;
  const activeElapsed = (): number => performance.now() - started - pausedMs - (pauseStarted === undefined ? 0 : performance.now() - pauseStarted);
  if (!Number.isFinite(maxWallMs) || maxWallMs <= 0 || maxWallMs > RUNTIME_LIMITS.maxWallMs) {
    fail('RUNTIME_OPTIONS', `실행 시간 한도는 0 초과 ${RUNTIME_LIMITS.maxWallMs} ms 이하여야 합니다.`);
  }
  if (!Number.isSafeInteger(maxRecordedValues) || maxRecordedValues <= 0 || maxRecordedValues > RUNTIME_LIMITS.maxRecordedValues) {
    fail('RUNTIME_OPTIONS', `기록 한도는 1~${RUNTIME_LIMITS.maxRecordedValues} 정수여야 합니다.`);
  }
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > RUNTIME_LIMITS.maxOperations || (options.trackOperations !== undefined && typeof options.trackOperations !== 'boolean')) fail('RUNTIME_OPTIONS', '연산 한도와 기록 옵션을 확인해 주세요.');
  const intervalCount = settings.mode === 'static' ? 0 : Math.round((settings.stopTime - settings.startTime) / settings.step);
  if (!Number.isSafeInteger(intervalCount) || intervalCount < 0 || intervalCount > RUNTIME_LIMITS.maxSteps) {
    fail('RUNTIME_STEP_BUDGET', '실행 tick 수가 한도를 초과했습니다.');
  }
  // Count timestamps too, so a model without sinks cannot evade the recording budget.
  const recordedElements = outputIds.reduce((count, id) => {
    const descriptor = compiled.outputTypes[id];
    if (!descriptor) fail('RUNTIME_INVALID_IR', '기록 출력의 자료형 정보가 없습니다.', id);
    return count + signalElements(descriptor);
  }, 1);
  if ((intervalCount + 1) * recordedElements > maxRecordedValues) {
    fail('RUNTIME_RECORD_BUDGET', '결과 기록 한도를 초과했습니다. 시간 범위나 기록 신호를 줄여 주세요.');
  }
  if (settings.mode === 'discrete' && discreteMemoryElementCount(nodes) > RUNTIME_LIMITS.maxStateElements) {
    fail('RUNTIME_STATE_BUDGET', '상태와 hold 메모리 한도를 초과했습니다.');
  }
  // Reductions and Terminator still read all input elements. Expression work scales
  // with both AST size and input shape, instead of counting a large array as one op.
  const costs = new Map(nodes.map((node) => [node.id, nodeOperationCost(node, byId)]));
  const perEvaluation = [...costs.values()].reduce((sum, cost) => sum + cost, 0);
  const stateUpdates = settings.mode === 'discrete' ? stateIds.reduce((sum, id) => sum + costs.get(id)!, 0) * intervalCount : 0;
  const estimatedEvaluations = perEvaluation * (intervalCount + 1 + (settings.mode === 'continuous' ? 4 * intervalCount : 0)) + stateUpdates;
  if (estimatedEvaluations > maxOperations) {
    fail('RUNTIME_OPERATION_BUDGET', '계산 연산 한도를 초과했습니다.');
  }
  const states = new Map<string, number>();
  for (const id of settings.mode === 'discrete' ? [] : stateIds) {
    const node = byId.get(id);
    if (!node) fail('RUNTIME_INVALID_IR', '상태 노드가 중간 표현에 없습니다.', id);
    states.set(id, finite(node.parameters.initial, id));
  }
  const samples: RunSample[] = [];
  let operations = 0;
  let scopeInvocations = 0;
  let nextBudgetCheck = 64;
  let chunkStarted = performance.now();
  let steps = 0;

  function checkBudget(): void {
    if (activeElapsed() > maxWallMs) {
      fail('RUNTIME_WALL_BUDGET', '실행 시간 한도를 초과했습니다.');
    }
    if (operations > maxOperations) {
      fail('RUNTIME_OPERATION_BUDGET', '계산 연산 한도를 초과했습니다.');
    }
  }

  function charge(node: IRNode, explicitWork?: number, scopeInvocation = false): void {
    if (scopeInvocation && ++scopeInvocations > 4096) throw new ModelError([{ code: 'M11_INVOCATION_LIMIT', nodeId: node.id, message: '한 실행 경계의 계층 호출4096회를 초과했습니다.' }]);
    const cost = explicitWork ?? costs.get(node.id)!;
    if (!Number.isSafeInteger(cost) || cost < 0) throw new ModelError([{ code: 'RUNTIME_INVALID_IR', nodeId: node.id, message: '연산 비용이 유효하지 않습니다.' }]);
    const nextOperations = operations + cost;
    if (nextOperations > maxOperations) fail('RUNTIME_OPERATION_BUDGET', '계산 연산 한도를 초과했습니다.', node.id);
    operations = nextOperations;
    if (operations >= nextBudgetCheck) { checkBudget(); nextBudgetCheck = operations + 64; }
  }
  function sampleStep<T>(tick: number, time: number, operation: () => T): T {
    try { return operation(); }
    catch (error) {
      if (error instanceof ModelError) throw new ModelError(error.diagnostics.map((diagnostic) => ({ ...diagnostic, tick, time })));
      throw error;
    }
  }
  const discrete = settings.mode === 'discrete' ? sampleStep(0, settings.startTime, () => createDiscreteMachine(nodes, stateIds, settings.step, settings.startTime, charge)) : undefined;

  async function pauseAtBoundary(): Promise<void> {
    const control = options.control;
    if (!control?.isPaused() || options.signal?.aborted) return;
    pauseStarted = performance.now();
    options.onPauseChange?.(true);
    try {
      while (control.isPaused() && !options.signal?.aborted) {
        let abort: (() => void) | undefined;
        const aborted = new Promise<void>((resolve) => { abort = resolve; options.signal?.addEventListener('abort', abort, { once: true }); });
        try { await Promise.race([control.waitForResume(), aborted]); }
        finally { if (abort) options.signal?.removeEventListener('abort', abort); }
      }
    } finally {
      pausedMs += performance.now() - pauseStarted;
      pauseStarted = undefined;
      chunkStarted = performance.now();
      options.onPauseChange?.(false);
    }
  }

  type PortValues = Map<string, Record<string, SignalValue>>;
  function readInput(values: PortValues, node: IRNode, port: string): SignalValue {
    const endpoint = node.inputs[port];
    const value = endpoint && values.get(endpoint.nodeId)?.[endpoint.portId];
    if (value === undefined) fail('RUNTIME_INVALID_IR', '입력에 연결된 출력 값을 읽을 수 없습니다.', node.id);
    return value;
  }

  function evaluate(trialStates: Map<string, number>): PortValues {
    // All state outputs must exist before evaluating any combinational node.
    const values: PortValues = new Map([...trialStates].map(([id, value]) => [id, { out: value }]));
    for (const node of nodes) {
      charge(node);
      const outputs = evaluateSignalNode(node, (port) => readInput(values, node, port), trialStates.get(node.id), settings.startTime);
      for (const [port, descriptor] of Object.entries(node.outputs)) checkSignal(outputs[port], descriptor, node.id);
      values.set(node.id, outputs);
    }
    return values;
  }

  function derivatives(trialStates: Map<string, number>): Map<string, number> {
    const values = evaluate(trialStates);
    return new Map(stateIds.map((id) => {
      const node = byId.get(id)!;
      if (node.blockType !== 'continuous.integrator') {
        fail('RUNTIME_UNSUPPORTED_MODE', '연속 실행은 M0 적분기만 지원합니다.', id);
      }
      return [id, finite(readInput(values, node, 'in'), id)];
    }));
  }

  function stage(base: Map<string, number>, slope: Map<string, number>, scale: number): Map<string, number> {
    return new Map(stateIds.map((id) => [id, finite(base.get(id)! + scale * slope.get(id)!, id)]));
  }

  function transition(values: PortValues): void {
    let next: Map<string, number>;
    if (settings.mode === 'continuous') {
      const k1 = derivatives(states);
      const k2 = derivatives(stage(states, k1, settings.step / 2));
      const k3 = derivatives(stage(states, k2, settings.step / 2));
      const k4 = derivatives(stage(states, k3, settings.step));
      next = new Map(stateIds.map((id) => [id, finite(
        states.get(id)! + settings.step * (k1.get(id)! / 6 + k2.get(id)! / 3 + k3.get(id)! / 3 + k4.get(id)! / 6),
        id,
      )]));
    } else {
      fail('RUNTIME_UNSUPPORTED_MODE', '정적 실행에는 상태 전이가 없습니다.');
    }
    // Atomic commit: every next-state value has been computed from the old state.
    for (const [id, value] of next) states.set(id, value);
  }

  function result(status: RunResult['status']): RunResult {
    const stateMemory = discrete?.stateMemory();
    return { samples, finalState: discrete ? discrete.finalState() : objectValues(states), ...(stateMemory === undefined ? {} : { stateMemory }), status, elapsedMs: activeElapsed(), steps, ...(options.trackOperations ? { resources: { operations } } : {}) };
  }

  let previousValues: PortValues | undefined;
  let tickCheckpoint: ReturnType<NonNullable<typeof discrete>['checkpoint']> | undefined;
  try {
  for (let index = 0; index <= intervalCount; index += 1) {
    if (options.signal?.aborted) return result('cancelled');
    if (settings.mode !== 'static') await pauseAtBoundary();
    if (options.signal?.aborted) return result('cancelled');
    checkBudget();
    scopeInvocations = 0;
    tickCheckpoint = discrete?.checkpoint();
    if (previousValues) {
      if (discrete) sampleStep(index - 1, settings.startTime + (index - 1) * settings.step, () => discrete.transition(previousValues!, index - 1)); else transition(previousValues);
    }
    const time = settings.startTime + index * settings.step;
    const values = discrete ? sampleStep(index, time, () => discrete.evaluate(index, time)) : evaluate(states);
    samples.push({ time, values: Object.fromEntries(outputIds.map((id) => [id, copySignal(checkSignal(values.get(id)?.out, compiled.outputTypes[id]!, id))])) });
    steps += 1;
    // Publish state only with a complete recorded sample. Failed ticks roll back held/rate/random memory.
    tickCheckpoint = undefined;
    const shouldYield = steps % RUNTIME_LIMITS.yieldEverySteps === 0 || performance.now() - chunkStarted >= RUNTIME_LIMITS.yieldAfterMs;
    if (index === 0 || shouldYield || index === intervalCount) options.onProgress?.({ steps, time });
    if (options.signal?.aborted) return result('cancelled');
    if (shouldYield) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      chunkStarted = performance.now();
      if (options.signal?.aborted) return result('cancelled');
    }
    previousValues = values;
  }
  checkBudget();
  } catch (error) {
    if (error instanceof ModelError) {
      if (tickCheckpoint) discrete!.restore(tickCheckpoint);
      throw new ModelError(error.diagnostics, result('failed'));
    }
    throw error;
  }
  return result(options.signal?.aborted ? 'cancelled' : 'completed');
}
