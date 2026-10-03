import { ModelError, type CompiledModel, type IRNode, type RunResult, type RunSample, type SignalValue, type SimulationEvent, type SolverStatistics } from '../../model/src/types';
import { normalizeSolverSettings } from '../../model/src/continuous';
import { discreteMemoryElementCount } from '../../model/src/discrete';
import { checkSignal, copySignal, finiteNumber, nodeOperationCost, signalElements } from './kernels';
import { createDiscreteMachine } from './discrete-machine';
import { createContinuousMachine, type ContinuousEvent, type ContinuousValues } from './continuous-machine';
import { implicitEulerTrial, implicitNextStep, rkErrorNorm, rkNextStep, rkTrial } from './continuous-solver';
import { m13StopRequest } from './m13';

/** Pure, bounded state machine shared by browser execution and independent TS. */
export function createContinuousExecution(compiled: CompiledModel, hooks: { check?: () => void; maxRecordedValues?: number; maxOperations?: number; trackOperations?: boolean } = {}) {
  const execution = compiled.model.execution, solver = normalizeSolverSettings(execution);
  const nodes = compiled.nodes, byId = new Map(nodes.map((node) => [node.id, node]));
  const intervalCount = Math.round((execution.stopTime - execution.startTime) / execution.step);
  const outputElements = compiled.outputIds.reduce((sum, id) => sum + signalElements(compiled.outputTypes[id]!), 1);
  const fail = (code: string, message: string, nodeId?: string): never => { throw new ModelError([{ code, message, time: failureTime, ...(nodeId === undefined ? {} : { nodeId }) }]); };
  let failureTime = execution.startTime;
  if (hooks.maxOperations !== undefined && (!Number.isSafeInteger(hooks.maxOperations) || hooks.maxOperations < 1 || hooks.maxOperations > 50_000_000)) fail('RUNTIME_OPTIONS', '연산 한도를 확인해 주세요.');
  if (hooks.maxRecordedValues !== undefined && (!Number.isSafeInteger(hooks.maxRecordedValues) || hooks.maxRecordedValues < 1 || hooks.maxRecordedValues > 1_000_000)) fail('RUNTIME_OPTIONS', '기록 한도를 확인해 주세요.');
  if (intervalCount > 10_000 || !Number.isSafeInteger(intervalCount) || intervalCount < 0) fail('RUNTIME_STEP_BUDGET', '출력 시간 격자의 한도를 초과했습니다.');
  if ((intervalCount + 1) * outputElements > (hooks.maxRecordedValues ?? 1_000_000)) fail('RUNTIME_RECORD_BUDGET', '결과 기록 한도를 초과했습니다.');
  const discreteNodes = nodes.filter((node) => node.executionDomain === 'discrete' && node.blockType !== 'time.zero-order-hold');
  const hasDiscreteBoundary = discreteNodes.length > 0 || nodes.some((node) => node.blockType === 'time.zero-order-hold' || node.blockType === 'time.first-order-hold');
  const discreteIds = compiled.stateIds.filter((id) => discreteNodes.some((node) => node.id === id));
  if (compiled.stateElements > 100_000 || discreteMemoryElementCount(discreteNodes) > 100_000) fail('RUNTIME_STATE_BUDGET', '상태 메모리 한도를 초과했습니다.');
  const costs = new Map(nodes.map((node) => [node.id, nodeOperationCost(node, byId)]));
  const minimumTrials = Math.max(intervalCount, Math.ceil((execution.stopTime - execution.startTime) / solver.maxStep));
  const minimumOperations = [...costs.values()].reduce((sum, cost) => sum + cost, 0)
    * (intervalCount + 1 + minimumTrials * (solver.method === 'rk4' ? 4 : solver.method === 'rk45' ? 7 : 1));
  if (minimumOperations > (hooks.maxOperations ?? 50_000_000)) fail('RUNTIME_OPERATION_BUDGET', '최소 계산 연산량이 한도를 초과했습니다.');
  let operations = 0;
  let scopeInvocations = 0;
  const charge = (node: IRNode, explicitWork?: number, scopeInvocation = false): void => {
    if (scopeInvocation && ++scopeInvocations > 4096) throw new ModelError([{ code: 'M11_INVOCATION_LIMIT', nodeId: node.id, message: '한 실행 경계의 계층 호출4096회를 초과했습니다.' }]);
    const cost = explicitWork ?? costs.get(node.id)!;
    if (!Number.isSafeInteger(cost) || cost < 0) throw new ModelError([{ code: 'RUNTIME_INVALID_IR', nodeId: node.id, message: '연산 비용이 유효하지 않습니다.' }]);
    const nextOperations = operations + cost;
    if (nextOperations > (hooks.maxOperations ?? 50_000_000)) fail('RUNTIME_OPERATION_BUDGET', '계산 연산 한도를 초과했습니다.', node.id);
    operations = nextOperations;
    hooks.check?.();
  };
  const discrete = createDiscreteMachine(discreteNodes, discreteIds, solver.discreteStep, execution.startTime, charge, nodes);
  const machine = createContinuousMachine(compiled, charge, discrete.effectiveNode);
  if (solver.method === 'implicit-euler' && machine.initial.length > 64) fail('M12_IMPLICIT_DIMENSION', '밀집 implicit Euler의 전체 연속 상태는64개 이하여야 합니다.');
  const solverAnchor = nodes.find(node => node.executionDomain === 'continuous') ?? nodes[0]!;
  const nextStep = (h: number, error: number, accepted: boolean): number => solver.method === 'implicit-euler' ? implicitNextStep(h, error, accepted, solver.minStep, solver.maxStep) : rkNextStep(h, error, accepted, solver.minStep, solver.maxStep);
  let frozen = discrete.snapshot(), state = [...machine.initial], time = execution.startTime, outputIndex = 0, tick = 0;
  let previousTickValues: ContinuousValues | undefined, previousTick: number | undefined;
  let stepSize = Math.min(solver.initialStep, machine.maximumDelayStep);
  let values: ContinuousValues = new Map(), started = false, finished = false;
  const samples: RunSample[] = [], events: SimulationEvent[] = [];
  let stopReason: RunResult['stopReason'];
  const stats: SolverStatistics = { method: solver.method, acceptedSteps: 0, rejectedSteps: 0, evaluations: 0, events: 0, lastStep: 0, minAcceptedStep: 0, maxAcceptedStep: 0 };
  const near = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8, execution.step * 1e-12);
  const outputTime = (): number => execution.startTime + outputIndex * execution.step;
  const tickTime = (): number => execution.startTime + tick * solver.discreteStep;
  const lastEventTimes = new Map<string, number>();
  const lastRecordedEvents = new Map<string, number>();
  function record(): void {
    samples.push({ time: outputTime(), values: Object.fromEntries(compiled.outputIds.map((id) => [id, copySignal(checkSignal(values.get(id)?.out, compiled.outputTypes[id]!, id))])) });
    outputIndex += 1;
    const stopNodeId = m13StopRequest(nodes, values);
    if (stopNodeId) { stopReason = { nodeId: stopNodeId, tick: outputIndex - 1, time: samples.at(-1)!.time }; finished = true; }
  }
  function tickBoundary(mask = new Set<string>()): Set<string> {
    scopeInvocations = 0;
    // Expose the preceding tick's atomic commit only at its next tick. The
    // frozen published outputs between ticks preserve M2 read-before-write.
    if (previousTickValues && previousTick !== undefined) discrete.transition(previousTickValues, previousTick);
    // Resolve only a capture's producer ancestry before publishing that hold.
    // Temporary initial hold values must never be evaluated by downstream math.
    const evaluateBoundary = (capture: boolean, old = false): ContinuousValues => {
      const resolved: ContinuousValues = new Map(), resolving = new Set<string>();
      const resolve = (id: string): Record<string, SignalValue> => {
        if (resolved.has(id)) return resolved.get(id)!;
        const node = byId.get(id)!;
        if (resolving.has(id)) fail('CYCLIC_CAPTURE_DEPENDENCY', '같은 시각의 샘플 capture에 대수 순환이 있습니다.', id);
        resolving.add(id);
        const read = (port: string) => { const endpoint = node.inputs[port]!; return resolve(endpoint.nodeId)[endpoint.portId]!; };
        const hold = node.blockType === 'time.zero-order-hold' || node.blockType === 'time.first-order-hold';
        if (capture && hold && tick >= node.sampleTime.offset && (tick - node.sampleTime.offset) % node.sampleTime.period === 0) {
          const endpoint = node.inputs.in!; resolve(endpoint.nodeId);
          machine.captureHolds(time, tick, resolved, undefined, node.id);
        }
        const outputs = node.executionDomain === 'discrete' && !hold
          ? old ? frozen.get(id)! : discrete.evaluateNode(node, tick, time, read)
          : machine.evaluateNode(node, time, state, read, mask, resolve);
        resolved.set(id, outputs); resolving.delete(id); return outputs;
      };
      if (old) {
        for (const node of nodes) {
          const guard = node.blockType === 'logic.hit-crossing' || node.blockType === 'nonlinear.relay'
            || node.blockType === 'nonlinear.saturation' && node.outputs.out?.shape.length === 0;
          const endpoint = guard ? node.inputs.in : node.blockType === 'continuous.integrator' && node.parameters.reset === 'rising' ? node.inputs.reset : undefined;
          if (endpoint) {
            try { resolve(endpoint.nodeId); }
            catch (error) {
              // No prior publication exists at initialization. Its guard starts
              // from the actual first value if a placeholder is outside domain.
              if (!(error instanceof ModelError) || !error.diagnostics.every((diagnostic) => diagnostic.code.startsWith('NUMERIC_'))) throw error;
              resolving.clear();
            }
          }
        }
      } else for (const node of nodes) resolve(node.id);
      return resolved;
    };
    let before = values.size ? values : evaluateBoundary(false, true);
    values = evaluateBoundary(true); frozen = discrete.snapshot();
    // Fill only guards that had no meaningful pre-publication value at start.
    for (const node of nodes) for (const endpoint of Object.values(node.inputs)) if (!before.has(endpoint.nodeId)) before.set(endpoint.nodeId, values.get(endpoint.nodeId)!);
    // Settle instantaneous publications without integrating or drawing RNG again.
    // This also initializes a Relay outside its hysteresis band at startTime.
    while (true) {
      const detected = [...machine.eventCandidates(before, values, state, state, time, time), ...machine.relaySettlingEvents(values)];
      const boundary = detected.filter((event, index) => detected.findIndex((other) => other.nodeId === event.nodeId && other.kind === event.kind) === index);
      if (!boundary.length) break;
      const previous = values, applied = machine.applyEvents(state, boundary, time, frozen);
      state = applied.state; mask = new Set([...mask, ...applied.mask]); appendEvents(boundary);
      boundary.forEach((event) => lastEventTimes.set(event.nodeId, time));
      const postEvent = machine.evaluate(time, state, frozen, mask);
      const resets = machine.eventCandidates(previous, postEvent).filter((event) => event.kind === 'reset' && !boundary.some((other) => other.nodeId === event.nodeId));
      if (resets.length) appendEvents(resets);
      before = previous; values = evaluateBoundary(true); frozen = discrete.snapshot();
    }
    previousTickValues = new Map(values); previousTick = tick;
    tick += 1;
    return mask;
  }
  function appendEvents(boundary: ContinuousEvent[]): void {
    for (const kind of ['reset', 'crossing', 'relay'] as const) {
      const nodeIds = [...new Set(boundary.filter((event) => event.kind === kind).map((event) => event.nodeId))]
        .filter((id) => kind === 'relay' || lastRecordedEvents.get(`${kind}:${id}`) !== time).sort();
      if (nodeIds.length) { events.push({ time, nodeIds, kind }); stats.events += nodeIds.length; nodeIds.forEach((id) => lastRecordedEvents.set(`${kind}:${id}`, time)); }
    }
    if (stats.events > solver.maxEvents) fail('RUNTIME_EVENT_BUDGET', '이벤트 처리 한도를 초과했습니다.');
  }
  function settleRelayPublications(mask: Set<string>): Set<string> {
    let detected = machine.relaySettlingEvents(values);
    while (detected.length) {
      const boundary = detected.filter((event, index) => detected.findIndex((other) => other.nodeId === event.nodeId && other.kind === event.kind) === index);
      const previous = values, applied = machine.applyEvents(state, boundary, time, frozen);
      state = applied.state; mask = new Set([...mask, ...applied.mask]); appendEvents(boundary);
      boundary.forEach((event) => lastEventTimes.set(event.nodeId, time));
      values = machine.evaluate(time, state, frozen, mask);
      detected = [...machine.eventCandidates(previous, values), ...machine.relaySettlingEvents(values)];
    }
    return mask;
  }
  function sourceBoundary(): number {
    let next = machine.nextDelayBoundary(time);
    const consider = (value: number): void => { if (value > time && !near(value, time)) next = Math.min(next, value); };
    for (const node of nodes) {
      if (node.blockType === 'source.step') consider(Number(node.parameters.stepTime));
      if (node.blockType === 'source.ramp') consider(Number(node.parameters.startTime));
      if (node.blockType === 'analysis.linearization' && node.parameters.mode === 'timed') for (const at of node.parameters.times as number[]) consider(at);
      if (node.blockType === 'source.dataset' && node.executionDomain === 'continuous') {
        const times = node.parameters.times as number[];
        let low = 0, high = times.length;
        while (low < high) { const middle = (low + high) >>> 1; if (times[middle]! <= time || near(times[middle]!, time)) low = middle + 1; else high = middle; }
        if (low < times.length) consider(times[low]!);
      }
      if (node.blockType === 'source.repeating-sequence') {
        const times = node.parameters.times as number[], period = times.at(-1)!, cycle = Math.floor(time / period);
        for (const offset of times) { consider(cycle * period + offset); consider((cycle + 1) * period + offset); }
      }
    }
    return next;
  }
  function trial(h: number, leftEndpoint?: number): { state: number[]; error: number[] } {
    const derivative = (stageTime: number, trialState: number[]): number[] => {
      failureTime = stageTime;
      stats.evaluations += 1;
      if (stats.evaluations > solver.maxEvaluations) fail('RUNTIME_EVALUATION_BUDGET', '솔버 단계 평가 한도를 초과했습니다.');
      const sourceTime = leftEndpoint !== undefined && near(stageTime, leftEndpoint)
        ? stageTime - Math.max(h * 1e-10, Math.abs(stageTime) * Number.EPSILON * 2, Number.MIN_VALUE)
        : stageTime === time ? rightSourceTime(stageTime) : stageTime;
      return machine.derivative(stageTime, trialState, frozen, sourceTime, state);
    };
    return solver.method === 'implicit-euler' ? implicitEulerTrial(time, state, h, derivative, { nodeId: solverAnchor.id, atol: Math.min(solver.atol * 0.1, solver.newtonTolerance!), rtol: solver.rtol * 0.1, maxIterations: solver.newtonMaxIterations, fdStep: solver.jacobianStep, charge: work => charge(solverAnchor, work) }) : rkTrial(solver.method, time, state, h, derivative);
  }
  function rightSourceTime(at: number): number {
    // Raw playback includes its final knot. After that isolated endpoint, an
    // outside-zero source contributes its right limit to RHS and delay history.
    if (!nodes.some(node => node.blockType === 'source.dataset' && node.executionDomain === 'continuous' && node.parameters.outside === 'zero' && (node.parameters.times as number[]).at(-1) === at)) return at;
    if (at === 0) return Number.MIN_VALUE;
    const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, at);
    bits.setBigUint64(0, bits.getBigUint64(0) + (at > 0 ? 1n : -1n));
    return bits.getFloat64(0);
  }
  function refine(event: ContinuousEvent, h: number): number {
    let low = 0, high = h;
    for (let iteration = 0; iteration < 64 && high - low > Math.max(solver.eventTolerance, Math.abs(time + high) * Number.EPSILON * 8); iteration += 1) {
      const middle = (low + high) / 2, candidate = trial(middle).state;
      const evaluated = machine.evaluate(time + middle, candidate, frozen);
      if (machine.eventReached(event, evaluated, candidate, time + middle)) high = middle; else low = middle;
    }
    return high;
  }
  function advanceInternal(): boolean {
    hooks.check?.();
    if (finished) return false;
    if (!started) {
      started = true;
      tickBoundary();
      const sourceTime = rightSourceTime(time);
      machine.acceptMemory(time, values, sourceTime === time ? values : machine.evaluate(time, state, frozen, new Set(), sourceTime), values, state);
      record();
      if (intervalCount === 0) finished = true;
      return !finished;
    }
    if (stats.acceptedSteps >= solver.maxSteps) fail('RUNTIME_INTERNAL_STEP_BUDGET', '내부 적분 스텝 한도를 초과했습니다.');
    const discontinuity = sourceBoundary();
    const target = Math.min(outputTime(), hasDiscreteBoundary ? tickTime() : Infinity, discontinuity, execution.stopTime);
    let h = Math.min(stepSize, target - time, solver.maxStep, machine.maximumDelayStep);
    if (!(h > 0) || time + h === time) fail('RUNTIME_TIME_RESOLUTION', '현재 시각에서 적분 간격을 표현할 수 없습니다.');
    const atSourceBoundary = near(time + h, discontinuity);
    const before = machine.evaluate(time, state, frozen);
    let candidate: { state: number[]; error: number[] };
    try { candidate = trial(h, atSourceBoundary ? discontinuity : undefined); }
    catch (error) {
      if (solver.method !== 'implicit-euler' || !(error instanceof ModelError) || !error.diagnostics.every(item => ['M12_NEWTON_SINGULAR', 'M12_NEWTON_CONVERGENCE', 'M12_NUMERIC_NONFINITE'].includes(item.code))) throw error;
      stats.rejectedSteps += 1;
      if (stats.rejectedSteps > solver.maxRejects) fail('RUNTIME_REJECTION_BUDGET', 'Newton 단계 거절 한도를 초과했습니다.');
      if (h <= solver.minStep * (1 + 1e-12)) throw error;
      stepSize = Math.max(solver.minStep, h / 2); return true;
    }
    machine.validateState(candidate.state);
    const norm = solver.method !== 'rk4' ? rkErrorNorm(state, candidate.state, candidate.error, solver.atol, solver.rtol) : 0;
    if (!Number.isFinite(norm)) fail('NUMERIC_NONFINITE', '솔버 오차 추정이 유한하지 않습니다.');
    if (norm > 1) {
      stats.rejectedSteps += 1;
      if (stats.rejectedSteps > solver.maxRejects) fail('RUNTIME_REJECTION_BUDGET', '솔버 스텝 거절 한도를 초과했습니다.');
      if (h <= solver.minStep * (1 + 1e-12)) fail('RUNTIME_MIN_STEP', '최소 적분 간격에서도 허용오차를 만족하지 못했습니다.');
      stepSize = nextStep(h, norm, false);
      return true;
    }
    let after = machine.evaluate(time + h, candidate.state, frozen);
    const candidates = machine.eventCandidates(before, after, state, candidate.state, time, time + h).filter((event) => !near(lastEventTimes.get(event.nodeId) ?? -Infinity, time));
    let boundaryEvents: ContinuousEvent[] = [];
    if (candidates.length) {
      const located = candidates.map((event) => ({ event, h: refine(event, h) }));
      const first = Math.min(...located.map((event) => event.h));
      boundaryEvents = located.filter((event) => Math.abs(event.h - first) <= solver.eventTolerance).map((event) => event.event);
      if (first < h && !near(first, h)) { h = first; candidate = trial(h); after = machine.evaluate(time + h, candidate.state, frozen); }
    }
    const previousValues = values;
    const leftValues = machine.evaluate(time + h, candidate.state, frozen, new Set(), near(time + h, discontinuity)
      ? time + h - Math.max(h * 1e-10, Math.abs(time + h) * Number.EPSILON * 2, Number.MIN_VALUE) : time + h);
    state = candidate.state; time = near(time + h, target) ? target : time + h; failureTime = time;
    stats.acceptedSteps += 1; stats.lastStep = h;
    stats.minAcceptedStep = stats.minAcceptedStep === 0 ? h : Math.min(stats.minAcceptedStep, h); stats.maxAcceptedStep = Math.max(stats.maxAcceptedStep, h);
    let mask = new Set<string>();
    if (boundaryEvents.length) {
      const applied = machine.applyEvents(state, boundaryEvents, time, frozen); state = applied.state; mask = applied.mask;
      boundaryEvents.forEach((event) => lastEventTimes.set(event.nodeId, time)); appendEvents(boundaryEvents);
      // Record resets driven by a HitCrossing in the same boundary explicitly.
      const resetEvents = machine.eventCandidates(before, machine.evaluate(time, state, frozen, mask)).filter((event) => event.kind === 'reset' && !boundaryEvents.some((current) => current.nodeId === event.nodeId));
      if (resetEvents.length) appendEvents(resetEvents);
    }
    values = machine.evaluate(time, state, frozen, mask);
    mask = settleRelayPublications(mask);
    if (hasDiscreteBoundary && near(time, tickTime())) mask = tickBoundary(mask);
    const sourceTime = rightSourceTime(time);
    machine.acceptMemory(time, previousValues, sourceTime === time ? values : machine.evaluate(time, state, frozen, mask, sourceTime), leftValues, state);
    values = machine.evaluate(time, state, frozen, mask);
    if (near(time, outputTime())) record();
    stepSize = solver.method !== 'rk4' ? nextStep(h, norm, true) : solver.initialStep;
    if (near(time, execution.stopTime)) finished = true;
    return !finished;
  }
  function result(status: RunResult['status'], elapsedMs = 0): RunResult {
    const projected = values.size ? machine.finalState(state, values) : {};
    return { samples: samples.map((sample) => ({ time: sample.time, values: Object.fromEntries(Object.entries(sample.values).map(([id, value]) => [id, copySignal(value)])) })),
      finalState: { ...projected, ...discrete.finalState() }, stateMemory: { ...machine.stateMemory(state), ...discrete.stateMemory(true) }, stateTime: time, status, elapsedMs, steps: samples.length, ...(hooks.trackOperations ? { resources: { operations } } : {}),
      solverStatistics: { ...stats }, events: events.map((event) => ({ ...event, nodeIds: [...event.nodeIds] })), ...(stopReason ? { stopReason: { ...stopReason } } : {}) };
  }
  function advance(): boolean {
    const saved = { state, time, values, frozen, outputIndex, tick, previousTickValues, previousTick, started, finished, stopReason,
      sampleLength: samples.length, eventLength: events.length, memory: machine.checkpoint(), discrete: discrete.checkpoint(),
      lastEvents: new Map(lastEventTimes), recordedEvents: new Map(lastRecordedEvents), acceptedSteps: stats.acceptedSteps, eventCount: stats.events,
      lastStep: stats.lastStep, minStep: stats.minAcceptedStep, maxStep: stats.maxAcceptedStep };
    try { return advanceInternal(); }
    catch (error) {
      state = saved.state; time = saved.time; values = saved.values; frozen = saved.frozen; outputIndex = saved.outputIndex; tick = saved.tick;
      previousTickValues = saved.previousTickValues; previousTick = saved.previousTick; started = saved.started; finished = saved.finished; stopReason = saved.stopReason;
      samples.length = saved.sampleLength; events.length = saved.eventLength;
      machine.restore(saved.memory); discrete.restore(saved.discrete); lastEventTimes.clear(); saved.lastEvents.forEach((value, id) => lastEventTimes.set(id, value));
      lastRecordedEvents.clear(); saved.recordedEvents.forEach((value, id) => lastRecordedEvents.set(id, value));
      stats.acceptedSteps = saved.acceptedSteps; stats.events = saved.eventCount; stats.lastStep = saved.lastStep; stats.minAcceptedStep = saved.minStep; stats.maxAcceptedStep = saved.maxStep;
      if (error instanceof ModelError) throw new ModelError(error.diagnostics.map((diagnostic) => ({ ...diagnostic, time: diagnostic.time ?? failureTime })), result('failed'));
      if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(item => ({ time: failureTime, ...item })), error.partialResult);
      throw error;
    }
  }
  return { advance, result, get currentTime() { return time; }, get sampleCount() { return samples.length; }, stats };
}
